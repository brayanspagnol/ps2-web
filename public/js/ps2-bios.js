// Reads the player's own PS2 BIOS dump (never shipped with the site) and pulls out what the console's
// startup screen is made of: the original startup sound (sequence + instrument bank, rendered here
// to PCM the way the SPU2 plays it) and the original textures (the "Sony Computer Entertainment"
// text, fog, glow and flare). No dependencies; tools/check-ps2-bios.mjs runs it under Node.
//
// Layout (see notes/bios-intro.md): the ROM starts with a file table (ROMDIR: 16-byte entries
// name[10], extinfo size u16, size u32, files 16-byte aligned, the first entry "RESET"). SNDIMAGE and
// TEXIMAGE are nested images with the same table. Their files are LZ-compressed (unlz below).
// Sound: *H = instrument bank header ("SShd"), *B = ADPCM sample body, *S = sequence ("SSsq"), the
// formats of the console's PS1-style "libsnd2" driver (IOP module OSDSND).

const td = new TextDecoder("latin1");

// ---- ROM file table --------------------------------------------------------------------------------
// Returns Map name -> Uint8Array (subarray views), or null when this is not a PS2 ROM image.
export function readRomdir(u8) {
  let at = -1;
  for (let i = 0; i + 32 <= Math.min(u8.length, 0x10000); i += 16) {
    if (u8[i] === 0x52 && td.decode(u8.subarray(i, i + 6)) === "RESET\0" && td.decode(u8.subarray(i + 16, i + 22)) === "ROMDIR") { at = i; break; }
  }
  if (at < 0) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const files = new Map();
  let off = 0;
  for (let i = at; i + 16 <= u8.length; i += 16) {
    if (u8[i] === 0) break;
    let n = td.decode(u8.subarray(i, i + 10));
    n = n.slice(0, n.indexOf("\0") >>> 0);
    const size = dv.getUint32(i + 12, true);
    if (off + size > u8.length) return null;
    if (!files.has(n)) files.set(n, u8.subarray(off, off + size));
    off += (size + 15) & ~15;
  }
  return files.has("ROMDIR") ? files : null;
}

// ---- LZ decompression (same routine as the BIOS: OSDSYS unpacks itself and its resources with it) ----
// u32 LE output size, then groups of 30 items led by a u32 BE flag word (MSB first; its low 2 bits
// set the offset/length split). Flag 0: one literal byte. Flag 1: u16 BE, copy (h >> (14 - k)) + 3
// bytes from (h & (0x3fff >> k)) + 1 bytes back.
export function unlz(src) {
  const size = src[0] | (src[1] << 8) | (src[2] << 16) | (src[3] << 24);
  if (size <= 0 || size > 1 << 24) throw new Error("bad LZ size");
  const out = new Uint8Array(size);
  let p = 4, o = 0, n = 0, flags = 0, mask = 0, lsh = 0;
  while (o < size) {
    if (n === 0) {
      if (p + 4 > src.length) throw new Error("LZ data truncated");
      flags = ((src[p] << 24) | (src[p + 1] << 16) | (src[p + 2] << 8) | src[p + 3]) >>> 0;
      p += 4; n = 30;
      const k = flags & 3;
      mask = 0x3fff >> k; lsh = 14 - k;
    }
    if (p >= src.length) throw new Error("LZ data truncated");
    if (flags & 0x80000000) {
      const h = (src[p] << 8) | src[p + 1];
      p += 2;
      const dist = (h & mask) + 1;
      if (dist > o) throw new Error("bad LZ back-reference");
      for (let len = (h >> lsh) + 3; len > 0 && o < size; len--, o++) out[o] = out[o - dist];
    } else out[o++] = src[p++];
    n--; flags = (flags << 1) >>> 0;
  }
  return out;
}

// ---- SPU2 voice emulation ------------------------------------------------------------------------
const F0 = [0, 60, 115, 98, 122], F1 = [0, 0, -52, -55, -60];

// One ADPCM sample stream from the body: decoded once per start address (loop point included).
function decodeVag(bd, start) {
  const pcm = [];
  let s1 = 0, s2 = 0, loop = -1;
  for (let b = start; b + 16 <= bd.length; b += 16) {
    const shift = bd[b] & 15, filt = Math.min(4, (bd[b] >> 4) & 7), fl = bd[b + 1];
    if (fl & 4) loop = pcm.length;
    for (let i = 0; i < 28; i++) {
      const byte = bd[b + 2 + (i >> 1)];
      let s = ((i & 1 ? byte >> 4 : byte & 15) << 28) >> 28; // sign-extend the nibble
      s = ((s << 12) >> shift) + ((s1 * F0[filt] + s2 * F1[filt] + 32) >> 6);
      s = Math.max(-32768, Math.min(32767, s));
      s2 = s1; s1 = s;
      pcm.push(s / 32768);
    }
    if (fl & 1) return { pcm: Float32Array.from(pcm), loop: fl & 2 ? Math.max(0, loop) : -1 };
  }
  return { pcm: Float32Array.from(pcm), loop: -1 };
}

// ADSR envelope (psx-spx "SPU ADSR"): level 0..0x7fff advanced once per 48 kHz tick.
function envStep(level, rate, decrease, exp, phase) {
  const shift = rate >> 2;
  let step = decrease ? -8 + (rate & 3) : 7 - (rate & 3);
  let cycles = 1 << Math.max(0, shift - 11);
  step <<= Math.max(0, 11 - shift);
  if (exp && !decrease && level > 0x6000) cycles *= 4;
  if (exp && decrease) step = (step * level) >> 15;
  phase.c += 1;
  if (phase.c < cycles) return level;
  phase.c = 0;
  return Math.max(0, Math.min(0x7fff, level + step));
}

// ---- instrument bank ("SShd") ----------------------------------------------------------------------
// 0x10: u32 offset of the program table; table: u16 max program, then u16 per program (0xffff =
// none), relative to the table. Program: 8 bytes (volume, pan, ...) then 16-byte tones until the
// one with bit 7 of its last byte set. Tone: key low, key high, center note, fine (signed, 1/128
// semitone), u16 sample address / 8 in the body, u16 ADSR1, u16 ADSR2, ?, volume, pan, bend range, ?,
// flags (bit 0: reverb send).
export function parseBank(hd) {
  const dv = new DataView(hd.buffer, hd.byteOffset, hd.byteLength);
  if (td.decode(hd.subarray(12, 16)) !== "SShd") throw new Error("not an SShd bank");
  const tab = dv.getUint32(16, true), max = dv.getUint16(tab, true);
  const velCurveAt = dv.getUint32(20, true) + 2;
  const vel = (v) => (velCurveAt + v < hd.length ? hd[velCurveAt + v] : v);
  const progs = [];
  for (let p = 0; p <= max; p++) {
    const rel = dv.getUint16(tab + 2 + p * 2, true);
    if (rel === 0xffff) continue;
    const a = tab + rel;
    const tones = [];
    for (let t = a + 8; t + 16 <= hd.length; t += 16) {
      tones.push({ lo: hd[t], hi: hd[t + 1], center: hd[t + 2], fine: (hd[t + 3] << 24) >> 24, addr: dv.getUint16(t + 4, true) * 8,
        adsr1: dv.getUint16(t + 6, true), adsr2: dv.getUint16(t + 8, true), vol: hd[t + 11], pan: hd[t + 12], reverb: hd[t + 15] & 1 });
      if (hd[t + 15] & 0x80) break;
    }
    progs[p] = { vol: hd[a + 1], pan: hd[a + 2], tones };
  }
  return { progs, vel };
}

// ---- sequence ("SSsq") ---------------------------------------------------------------------------
// u16 volume, u16 ticks per quarter, u16 tempo (BPM); 0x10: 16 channel entries of 16 bytes (byte 2:
// program, 3: volume, 4: pan); 0x110: MIDI events (event, delta, event, ...), FF 51 = tempo
// (u16 LE BPM), FF 2F = end.
export function parseSeq(sq) {
  const dv = new DataView(sq.buffer, sq.byteOffset, sq.byteLength);
  if (td.decode(sq.subarray(12, 16)) !== "SSsq") throw new Error("not an SSsq sequence");
  const ppq = dv.getUint16(2, true);
  let bpm = dv.getUint16(4, true) || 120;
  const chans = [];
  for (let c = 0; c < 16; c++) chans.push({ prog: sq[0x10 + c * 16 + 2], vol: sq[0x10 + c * 16 + 3], pan: sq[0x10 + c * 16 + 4] });
  const ev = [];
  let p = 0x110, t = 0, status = 0;
  const vlq = () => { let v = 0, b; do { b = sq[p++]; v = (v << 7) | (b & 127); } while (b & 128 && p < sq.length); return v; };
  while (p < sq.length) {
    let s = sq[p];
    if (s & 0x80) { p++; status = s; } else s = status; // running status
    if (s === 0xff) {
      const type = sq[p++];
      if (type === 0x2f) break;
      if (type === 0x51) { bpm = sq[p] | (sq[p + 1] << 8) || bpm; p += 2; ev.push({ t, tempo: bpm }); }
      else break; // unknown meta: stop rather than misparse
    } else {
      const hi = s & 0xf0, ch = s & 15;
      if (hi === 0xc0 || hi === 0xd0) ev.push({ t, hi, ch, a: sq[p++] });
      else ev.push({ t, hi, ch, a: sq[p++], b: sq[p++] });
    }
    if (p >= sq.length) break;
    t += vlq();
  }
  return { ppq, bpm: dv.getUint16(4, true) || 120, vol: sq[0], chans, ev };
}

// Renders a sequence with its bank to stereo PCM at 48 kHz (the SPU2's rate): dry and reverb-send
// buses separately (the SPU2 reverb is applied by the caller). Returns { rate, dry: [L, R], wet: [L, R] }.
export function renderSequence(hd, bd, sq, { tail = 3 } = {}) {
  const rate = 48000;
  const bank = parseBank(hd), seq = parseSeq(sq);
  const chans = seq.chans.map((c) => ({ ...c }));
  // event times in samples
  let bpm = seq.bpm, lastT = 0, lastS = 0;
  const at = (t) => lastS + ((t - lastT) * 60 * rate) / (bpm * seq.ppq);
  const events = [];
  for (const e of seq.ev) {
    const s = at(e.t);
    if (e.tempo) { lastS = s; lastT = e.t; bpm = e.tempo; continue; }
    events.push({ ...e, s: Math.round(s) });
  }
  const len = Math.ceil((events.at(-1)?.s ?? 0) + tail * rate);
  const out = [new Float32Array(len), new Float32Array(len), new Float32Array(len), new Float32Array(len)];
  const cache = new Map();
  const voices = [];
  const panLR = (p) => (p < 64 ? [1, p / 63] : [(127 - p) / 63, 1]);
  const clamp = (v) => Math.max(0, Math.min(127, v));

  const run = (v, from, to) => { // mixes one voice into out[from, to)
    const { pcm, loop } = v.smp;
    const [ol, or] = v.reverb ? [out[2], out[3]] : [out[0], out[1]];
    const a1 = v.tone.adsr1, a2 = v.tone.adsr2;
    const sl = ((a1 & 15) + 1) * 0x800;
    for (let i = from; i < to; i++) {
      // envelope
      if (v.stage === 0) { v.env = envStep(v.env, (a1 >> 8) & 0x7f, false, a1 & 0x8000, v.ph); if (v.env >= 0x7fff) { v.env = 0x7fff; v.stage = 1; v.ph.c = 0; } }
      else if (v.stage === 1) { v.env = envStep(v.env, ((a1 >> 4) & 15) * 4, true, true, v.ph); if (v.env <= sl) { v.stage = 2; v.ph.c = 0; } }
      else if (v.stage === 2) v.env = envStep(v.env, (a2 >> 6) & 0x7f, a2 & 0x4000, a2 & 0x8000, v.ph);
      else { v.env = envStep(v.env, (a2 & 31) * 4, true, a2 & 0x20, v.ph); if (v.env <= 0) { v.done = true; return; } }
      // 4-point cubic interpolation (the SPU2 uses a Gaussian kernel of the same width)
      const k = v.pos | 0, f = v.pos - k;
      const s = (j) => { let idx = k + j; if (idx >= pcm.length) { if (loop < 0) return 0; idx = loop + ((idx - loop) % (pcm.length - loop)); } return idx < 0 ? 0 : pcm[idx]; };
      const y0 = s(-1), y1 = s(0), y2 = s(1), y3 = s(2);
      const smp = y1 + 0.5 * f * (y2 - y0 + f * (2 * y0 - 5 * y1 + 4 * y2 - y3 + f * (3 * (y1 - y2) + y3 - y0)));
      const g = (smp * v.env) / 0x7fff;
      ol[i] += g * v.gl; or[i] += g * v.gr;
      v.pos += v.step;
      if (v.pos >= pcm.length) {
        if (loop < 0) { v.done = true; return; }
        v.pos = loop + ((v.pos - loop) % (pcm.length - loop));
      }
    }
  };

  let cur = 0;
  const advance = (to) => {
    if (to <= cur) return;
    for (const v of voices) if (!v.done) run(v, cur, Math.min(to, len));
    for (let i = voices.length - 1; i >= 0; i--) if (voices[i].done) voices.splice(i, 1);
    cur = to;
  };
  for (const e of events) {
    advance(e.s);
    const c = chans[e.ch];
    if (e.hi === 0xc0) c.prog = e.a;
    else if (e.hi === 0xb0) { if (e.a === 7) c.vol = e.b; else if (e.a === 10) c.pan = e.b; }
    else if (e.hi === 0x80 || (e.hi === 0x90 && e.b === 0)) {
      for (const v of voices) if (v.ch === e.ch && v.key === e.a && v.stage < 3) { v.stage = 3; v.ph.c = 0; }
    } else if (e.hi === 0x90) {
      const prog = bank.progs[c.prog];
      if (!prog) continue;
      for (const tone of prog.tones) {
        if (e.a < tone.lo || e.a > tone.hi) continue;
        if (!cache.has(tone.addr)) cache.set(tone.addr, decodeVag(bd, tone.addr));
        const vol = (bank.vel(e.b) / 127) * (tone.vol / 127) * (prog.vol / 127) * (c.vol / 127) * (seq.vol / 127);
        const [l, r] = panLR(clamp(c.pan + (prog.pan - 64) + (tone.pan - 64)));
        voices.push({ ch: e.ch, key: e.a, tone, smp: cache.get(tone.addr), reverb: tone.reverb, pos: 0,
          step: Math.min(4, 2 ** ((e.a - tone.center + tone.fine / 128) / 12)), // pitch 0x1000 = 48 kHz, capped at 0x3fff
          env: 0, stage: 0, ph: { c: 0 }, gl: vol * l * 0.5, gr: vol * r * 0.5 });
      }
    }
  }
  advance(len);
  return { rate, dry: [out[0], out[1]], wet: [out[2], out[3]] };
}

// ---- textures ------------------------------------------------------------------------------------
// Files with a 0x18-byte header (u32 0x10, u32 ?, u32 ?, u32 ?, u16 width, u16 height) hold 16-bit
// PS2 pixels (5:5:5 + 1); the "Sony Computer Entertainment" text is raw 8-bit gray, 512 x 64
// (two lines). Returned as RGBA8, top row first.
function tex16(x) {
  const w = x[16] | (x[17] << 8), h = x[18] | (x[19] << 8);
  if (x.length < 0x18 + w * h * 2) throw new Error("short texture");
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = x[0x18 + i * 2] | (x[0x19 + i * 2] << 8);
    rgba[i * 4] = (v & 31) << 3; rgba[i * 4 + 1] = ((v >> 5) & 31) << 3; rgba[i * 4 + 2] = ((v >> 10) & 31) << 3; rgba[i * 4 + 3] = 255;
  }
  return { width: w, height: h, rgba };
}
// 8-bit alpha picture cropped to its content (+2 px), so it can be centered.
function gray(x, w, h) {
  let x0 = w, x1 = -1, y0 = h, y1 = -1;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) if (x[y * w + i] > 8) { x0 = Math.min(x0, i); x1 = Math.max(x1, i); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 >= 0) { x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(w - 1, x1 + 2); y1 = Math.min(h - 1, y1 + 2); } else { x0 = y0 = 0; x1 = w - 1; y1 = h - 1; }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
  const rgba = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let i = 0; i < cw; i++) {
    const o = (y * cw + i) * 4;
    rgba[o] = rgba[o + 1] = rgba[o + 2] = 255; rgba[o + 3] = x[(y + y0) * w + i + x0];
  }
  return { width: cw, height: ch, rgba };
}

// "0160AC20020207" -> "v1.60 EUA (2002-02-07)"
export function describeRomver(v) {
  const m = /^(\d\d)(\d\d)([JAEHC])[CDTP](\d{4})(\d\d)(\d\d)/.exec(v ?? "");
  if (!m) return v || "versão desconhecida";
  const region = { J: "Japão", A: "EUA", E: "Europa", H: "Ásia", C: "China" }[m[3]];
  return `v${+m[1]}.${m[2]} ${region} (${m[4]}-${m[5]}-${m[6]})`;
}

// buf: the BIOS image (ArrayBuffer / Uint8Array). Returns { version, sounds: { boot, towers, logo }
// (renderSequence results or null), textures: { sce, fog: [...], flare } } or throws with a message
// fit for the player.
export function extractIntro(buf) {
  const rom = readRomdir(buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  if (!rom) throw new Error("não é um arquivo de BIOS de PS2");
  const snd = rom.get("SNDIMAGE") && readRomdir(rom.get("SNDIMAGE"));
  const tex = rom.get("TEXIMAGE") && readRomdir(rom.get("TEXIMAGE"));
  if (!snd || !tex || !snd.has("SNDBOOTH") || !tex.has("TEXOSCE")) throw new Error("esta BIOS não tem a abertura no formato conhecido");
  const version = rom.has("ROMVER") ? td.decode(rom.get("ROMVER")).replace(/[^\x20-\x7e]/g, "").trim() : "";
  const hd = unlz(snd.get("SNDBOOTH")), bd = unlz(snd.get("SNDBOOTB"));
  const song = (name) => (snd.has(name) ? renderSequence(hd, bd, unlz(snd.get(name))) : null);
  const sce = unlz(tex.get("TEXOSCE"));
  const textures = {
    sce: gray(sce, 512, sce.length / 512),
    fog: ["TEXOFOG0", "TEXOFOG1", "TEXOFOG2", "TEXOFOG3", "TEXOFOG4"].filter((n) => tex.has(n)).map((n) => tex16(unlz(tex.get(n)))),
    flare: tex.has("TEXOFLAR") ? tex16(unlz(tex.get("TEXOFLAR"))) : null,
    glow: tex.has("TEXOCRBL") ? { width: 64, height: 64, rgba: unlz(tex.get("TEXOCRBL")).slice(0, 64 * 64 * 4) } : null, // RGBA8 soft dot
  };
  return { version, sounds: { boot: song("SNDBOOTS"), towers: song("SNDTNNLS"), logo: song("SNDLOGOS") }, textures };
}

// ---- browser side: the player's BIOS file and the extracted intro --------------------------------------
// Stored in this browser's private storage (OPFS) only; on localhost the dev server also offers
// ../bios/*.bin (gitignored) at /bios/dev.bin to loopback clients.
const OPFS_DIR = "bios", OPFS_FILE = "bios.bin";
const opfsDir = async (create) => (await navigator.storage.getDirectory()).getDirectoryHandle(OPFS_DIR, { create });
const isLocal = () => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(location.hostname);

// -> { buf: ArrayBuffer, source: "opfs" | "dev" } or null
async function readBios() {
  try {
    const f = await (await (await opfsDir(false)).getFileHandle(OPFS_FILE)).getFile();
    return { buf: await f.arrayBuffer(), source: "opfs" };
  } catch { /* none saved */ }
  if (!isLocal()) return null;
  try {
    const r = await fetch("/bios/dev.bin");
    return r.ok ? { buf: await r.arrayBuffer(), source: "dev" } : null;
  } catch { return null; }
}

function extractInWorker(buf) {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL("./ps2-bios-worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => { w.terminate(); data.ok ? resolve(data.ok) : reject(new Error(data.error)); };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || "worker failed")); };
    w.postMessage(buf, [buf]);
  });
}

let introP = null;
// The extracted startup screen ({ version, source, sounds, textures }) or null (no BIOS / unusable).
// Cached for the page; forgetBiosIntro() after the file changes.
export function biosIntro() {
  introP ??= readBios().then((b) => b && extractInWorker(b.buf).then((r) => ({ ...r, source: b.source }))).catch((e) => {
    console.warn("BIOS intro unavailable, using the recreation:", e.message);
    return null;
  });
  return introP;
}
export const forgetBiosIntro = () => { introP = null; };

// Checks and stores a file the player picked. Resolves to the extracted intro; rejects with a
// message for the player (nothing is stored then).
export async function saveBios(file) {
  if (file.size < 1 << 20 || file.size > 32 << 20) throw new Error("o arquivo não tem o tamanho de uma BIOS de PS2 (normalmente 4 MB)");
  const buf = await file.arrayBuffer();
  const intro = await extractInWorker(buf.slice(0));
  const w = await (await (await opfsDir(true)).getFileHandle(OPFS_FILE, { create: true })).createWritable();
  await w.write(buf);
  await w.close();
  introP = Promise.resolve({ ...intro, source: "opfs" });
  return intro;
}

export async function removeBios() {
  await (await navigator.storage.getDirectory()).removeEntry(OPFS_DIR, { recursive: true }).catch(() => {});
  introP = null;
}
