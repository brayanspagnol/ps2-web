// Finds, in the player's own BIOS, the data the console's opening (OSDSYS "BootOpening") is driven
// by: camera keyframes, the tower field and its play-history layout, the tower box, the light orbs,
// the floating cubes and where the "Sony Computer Entertainment" text goes. Nothing here is copied
// from the BIOS: the tables are located at runtime by their shape (see notes/bios-intro.md) and
// returned as plain numbers for ps2-opening.js. No dependencies; tools/check-ps2-bios.mjs runs it.
import { unlz } from "./ps2-bios.js";

const BASE = 0x200000; // where OSDSYS unpacks its payload (EE address of byte 0)

// OSDSYS is a small ELF that LZ-unpacks its real program to 0x200000. The packed payload follows the
// unpacker code; it is found by trying the 16-byte aligned offsets that start with a plausible size.
export function unpackOsdsys(elf) {
  const dv = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  for (let o = 0x80; o + 8 < Math.min(elf.length, 0x8000); o += 16) {
    const size = dv.getUint32(o, true);
    if (size < 0x40000 || size > 0x300000) continue;
    try {
      const out = unlz(elf.subarray(o));
      if (out.length === size && out[0] === 0 && out[4] === 0) return out;
    } catch { /* not the payload */ }
  }
  return null;
}

// ---- small readers ----
const f32 = (dv, o) => dv.getFloat32(o, true);
const i32 = (dv, o) => dv.getInt32(o, true);
const near = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const vec = (dv, o, n = 4) => Array.from({ length: n }, (_, k) => f32(dv, o + k * 4));

// Camera path: 8 int32 z keyframes, strictly rising, the last one repeated, multiples of 8.
function findCameraKeys(dv) {
  outer: for (let o = 0; o + 32 <= dv.byteLength; o += 4) {
    const k = Array.from({ length: 8 }, (_, i) => i32(dv, o + i * 4));
    if (k[0] < 8 || k[0] > 64 || k[6] !== k[7] || k[6] > 4096) continue;
    for (let i = 0; i < 7; i++) if (k[i] % 8 || (i && k[i] <= k[i - 1])) continue outer;
    return k.slice(0, 7);
  }
  return null;
}

// Tower field: 14 rows x 9 columns of vec4 (x, y, z, 0) on a regular 2D grid (x per row, y per
// column, with a few cells nudged), z = per-cell depth offset.
function findTowerGrid(dv) {
  for (let o = 0; o + 126 * 16 <= dv.byteLength; o += 16) {
    const x0 = f32(dv, o), y0 = f32(dv, o + 4), dx = f32(dv, o + 9 * 16) - x0, dy = f32(dv, o + 16 + 4) - y0;
    if (!(Math.abs(dx) > 0.5 && Math.abs(dx) < 4 && Math.abs(dy) > 0.5 && Math.abs(dy) < 4)) continue;
    let ok = true, off = 0;
    const cells = [];
    for (let r = 0; r < 14 && ok; r++) for (let c = 0; c < 9; c++) {
      const v = vec(dv, o + (r * 9 + c) * 16);
      if (v[3] !== 0 || !Number.isFinite(v[2]) || Math.abs(v[2]) > 20) { ok = false; break; }
      if (!near(v[1], y0 + c * dy, 0.01)) { ok = false; break; }
      if (!near(v[0], x0 + r * dx, 0.01) && ++off > 6) { ok = false; break; }
      cells.push(v.slice(0, 3));
    }
    if (ok) return { rows: 14, cols: 9, cells };
  }
  return null;
}

// Play history -> towers: 21 entries x 6 (row, col) int32 pairs, all cells distinct.
function findHistoryMap(dv) {
  outer: for (let o = 0; o + 21 * 48 <= dv.byteLength; o += 16) {
    const seen = new Set(), map = [];
    for (let e = 0; e < 21; e++) {
      const cells = [];
      for (let k = 0; k < 6; k++) {
        const r = i32(dv, o + e * 48 + k * 8), c = i32(dv, o + e * 48 + k * 8 + 4);
        if (r < 0 || r > 13 || c < 0 || c > 8 || seen.has(r * 9 + c)) continue outer;
        seen.add(r * 9 + c);
        cells.push([r, c]);
      }
      map.push(cells);
    }
    return map;
  }
  return null;
}

// How a played title grows its tower: two adjacent tables of 14 floats in (0, 1], rising, ending at 1
// (brightness, then height, indexed by the play count).
function findGrowth(dv) {
  const ok = (o) => {
    let prev = 0;
    for (let i = 0; i < 14; i++) { const v = f32(dv, o + i * 4); if (!(v > 0 && v <= 1 && v >= prev - 1e-6)) return false; prev = v; }
    return prev === 1;
  };
  for (let o = 0; o + 112 <= dv.byteLength; o += 4) if (ok(o) && ok(o + 56) && f32(dv, o) !== f32(dv, o + 56)) {
    return { alpha: Array.from({ length: 14 }, (_, i) => f32(dv, o + i * 4)), height: Array.from({ length: 14 }, (_, i) => f32(dv, o + 56 + i * 4)) };
  }
  return null;
}

// The tower box: six GS packets (GIF tag: 4 vertices, triangle strip, ST/RGBAQ/XYZ2) each followed by
// 4 positions and 4 normals, reached through a table of 6 pointers (face 0 = the lit cap).
function findTowerFaces(dv) {
  const isPacket = (o) => o >= 0 && o + 0x50 <= dv.byteLength && i32(dv, o) === 0x8004 && (i32(dv, o + 8) & 0xfff) === 0x412;
  for (let o = 0; o + 24 <= dv.byteLength; o += 4) {
    const ptr = Array.from({ length: 6 }, (_, k) => i32(dv, o + k * 4) - BASE);
    if (!ptr.every(isPacket) || new Set(ptr).size !== 6) continue;
    return ptr.map((p) => ({
      pos: Array.from({ length: 4 }, (_, k) => vec(dv, p + 0x10 + k * 16, 3)),
      normal: vec(dv, p + 0x50, 3),
    }));
  }
  return null;
}

// Light orbs: 4 colours (float r, g, b, 0) followed by two sprite quads (4 x vec4 (+-a, +-a, 0, 1)),
// their texture corners, then the five floating cubes (vec4 x, y, z, 0) after a (0, 0, 0, 1).
function findLights(dv) {
  const quad = (o) => {
    const a = f32(dv, o + 48); // x of the last corner
    if (!(a > 0.05 && a < 4)) return 0;
    const want = [[-a, -a], [a, -a], [-a, a], [a, a]];
    for (let k = 0; k < 4; k++) {
      const v = vec(dv, o + k * 16);
      if (!near(v[0], want[k][0]) || !near(v[1], want[k][1]) || v[2] !== 0 || v[3] !== 1) return 0;
    }
    return a;
  };
  for (let o = 64; o + 0x110 <= dv.byteLength; o += 16) {
    const big = quad(o), small = big && quad(o + 64);
    if (!small || small >= big) continue;
    const colors = Array.from({ length: 4 }, (_, k) => vec(dv, o - 64 + k * 16));
    if (!colors.every((c) => c.slice(0, 3).every((v) => v >= 0 && v <= 255) && c[3] === 0)) continue;
    const cubesAt = o + 0x80 + 0x40 + 0x10; // after the corners and the (0, 0, 0, 1) origin
    if (f32(dv, cubesAt - 4) !== 1) continue;
    const cubes = Array.from({ length: 5 }, (_, k) => vec(dv, cubesAt + k * 16));
    if (!cubes.every((v) => v[3] === 0 && Math.abs(v[0]) < 10 && Math.abs(v[1]) < 10 && v[2] > 0 && v[2] < 10)) continue;
    return { colors: colors.map((c) => c.slice(0, 3)), quads: [big, small], cubes: cubes.map((v) => v.slice(0, 3)) };
  }
  return null;
}

// "Sony Computer Entertainment": two sprites (x, y, 256, h) per video mode, NTSC then PAL.
function findTextRects(dv) {
  for (let o = 0; o + 64 <= dv.byteLength; o += 8) {
    const v = Array.from({ length: 16 }, (_, k) => i32(dv, o + k * 4));
    if (v[2] !== 256 || v[6] !== 256 || v[10] !== 256 || v[14] !== 256) continue;
    if (v[1] !== v[5] || v[9] !== v[13] || v[3] !== v[7] || v[11] !== v[15] || v[0] !== v[8] || v[4] !== v[12]) continue;
    if (!(v[0] > 0 && v[4] > v[0] && v[4] < 640 && v[3] > 4 && v[3] < 64)) continue;
    return { ntsc: [v.slice(0, 4), v.slice(4, 8)], pal: [v.slice(8, 12), v.slice(12, 16)] };
  }
  return null;
}

// The texture list of the opening: 0xf0-byte descriptors (resource index, ..., width, height), and the
// ROM resource names they point to. Returns descriptor index -> resource name.
function findTextureNames(dv, u8) {
  const td = new TextDecoder("latin1");
  const str = (a) => { const o = a - BASE; if (o < 0 || o >= u8.length) return null; let e = o; while (e < u8.length && u8[e] && e - o < 16) e++; return td.decode(u8.subarray(o, e)); };
  // resource table: 16-byte entries whose first word points to a name
  const at = td.decode(u8).indexOf("TEXOSCE\0");
  if (at < 0) return null;
  let entry = -1;
  for (let o = 0; o + 4 <= u8.length; o += 4) if (i32(dv, o) === BASE + at) { entry = o; break; }
  if (entry < 0) return null;
  let first = entry;
  while (first >= 16 && /^[A-Z0-9]{3,9}$/.test(str(i32(dv, first - 16)) ?? "")) first -= 16;
  const names = [];
  for (let o = first; o + 16 <= u8.length; o += 16) { const n = str(i32(dv, o)); if (!n || !/^[A-Z0-9]{3,9}$/.test(n)) break; names.push(n); }
  // descriptors: field 1 = resource index of a TEX* name, fields 6/7 = power-of-two width/height
  const isDesc = (o) => {
    const r = i32(dv, o + 4), w = i32(dv, o + 24), h = i32(dv, o + 28);
    return o + 0xf0 <= u8.length && names[r]?.startsWith("TEX") && w >= 8 && w <= 1024 && !(w & (w - 1)) && h >= 8 && h <= 1024 && !(h & (h - 1));
  };
  for (let o = 0; o + 0xf0 * 4 <= u8.length; o += 16) {
    if (!isDesc(o) || !isDesc(o + 0xf0) || !isDesc(o + 0x1e0) || isDesc(o - 0xf0)) continue;
    const out = [];
    for (let p = o; isDesc(p); p += 0xf0) out.push(names[i32(dv, p + 4)]);
    if (out.includes("TEXOSCE") && out.includes("TEXOWAL0")) return out;
  }
  return null;
}

// Fog layer textures: 6 descriptor indices a, b, c, a, b, c (one per layer).
function findFogList(dv, texNames) {
  for (let o = 0; o + 24 <= dv.byteLength; o += 8) {
    const v = Array.from({ length: 6 }, (_, k) => i32(dv, o + k * 4));
    if (v[0] !== v[3] || v[1] !== v[4] || v[2] !== v[5] || new Set(v).size !== 3) continue;
    const n = v.map((i) => texNames[i]);
    if (n.every((x) => x?.startsWith("TEXOFOG"))) return n;
  }
  return null;
}

// -> { cameraKeys, grid, history, growth, faces, lights, text, fog } or throws (unknown OSDSYS).
export function findOpeningData(osd) {
  const dv = new DataView(osd.buffer, osd.byteOffset, osd.byteLength);
  const tex = findTextureNames(dv, osd);
  const d = {
    cameraKeys: findCameraKeys(dv), grid: findTowerGrid(dv), history: findHistoryMap(dv), growth: findGrowth(dv),
    faces: findTowerFaces(dv), lights: findLights(dv), text: findTextRects(dv), fog: tex && findFogList(dv, tex),
  };
  const missing = Object.keys(d).filter((k) => !d[k]);
  if (missing.length) throw new Error("abertura da BIOS em formato desconhecido (" + missing.join(", ") + ")");
  return d;
}
