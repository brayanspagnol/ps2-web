// Self-check for public/js/ps2-bios.js: node tools/check-ps2-bios.mjs [out dir]
// Synthetic checks always run; with the player's own BIOS in bios/*.bin (gitignored) it also extracts
// the startup sound and textures and, given an out dir, writes WAV/PGM previews there (keep that dir
// out of the repo: it is the console's copyrighted data).
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { readRomdir, unlz, extractIntro } from "../public/js/ps2-bios.js";
import { unpackOsdsys, findOpeningData } from "../public/js/ps2-osd.js";

// LZ: 3 literals "abc", then a copy of 6 bytes from 3 back -> "abcabcabc" (flag word: bits 0,0,0,1, k = 0).
const lz = Uint8Array.from([9, 0, 0, 0, 0x10, 0, 0, 0, 0x61, 0x62, 0x63, 0xc0, 0x02]); // copy: len field 3 (6 bytes), distance 3
assert.equal(new TextDecoder().decode(unlz(lz)), "abcabcabc");
assert.throws(() => unlz(Uint8Array.from([4, 0, 0, 0, 0x80, 0, 0, 0, 0, 0])), /back-reference/);
assert.equal(readRomdir(new Uint8Array(4096)), null, "zeros are not a ROM");
assert.throws(() => extractIntro(new Uint8Array(4096)), /BIOS/);

const dir = path.join(import.meta.dirname, "..", "bios");
const out = process.argv[2];
for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
  if (!name.toLowerCase().endsWith(".bin")) continue;
  const t0 = performance.now();
  const r = extractIntro(fs.readFileSync(path.join(dir, name)));
  const ms = Math.round(performance.now() - t0);
  const secs = Object.fromEntries(Object.entries(r.sounds).map(([k, s]) => [k, s && +(s.dry[0].length / s.rate).toFixed(2)]));
  console.log(`${name}: ${r.version} sounds ${JSON.stringify(secs)} sce ${r.textures.sce.width}x${r.textures.sce.height} fog ${r.textures.fog.length} (${ms} ms)`);
  const boot = r.sounds.boot;
  assert.ok(boot && boot.dry[0].length > boot.rate * 5, "startup sound shorter than 5 s");
  let peak = 0, energy = 0;
  for (const ch of [...boot.dry, ...boot.wet]) for (const v of ch) { peak = Math.max(peak, Math.abs(v)); energy += v * v; }
  assert.ok(peak > 0.01 && peak < 4, `startup sound level out of range (peak ${peak})`);
  assert.ok(energy > 100, "startup sound is (nearly) silent");
  // the opening's tables (OSDSYS): located by shape, only counts are printed
  const osd = unpackOsdsys(readRomdir(new Uint8Array(fs.readFileSync(path.join(dir, name)))).get("OSDSYS"));
  assert.ok(osd, "OSDSYS payload not found");
  const op = findOpeningData(osd);
  assert.equal(op.cameraKeys.length, 7);
  assert.equal(op.grid.cells.length, 126);
  assert.equal(op.history.length, 21);
  assert.equal(op.faces.length, 6);
  assert.equal(op.lights.colors.length, 4);
  assert.equal(op.lights.cubes.length, 5);
  assert.equal(op.fog.length, 6);
  console.log(`  opening data: OSDSYS ${osd.length} bytes, all tables found`);
  if (!out) continue;
  fs.mkdirSync(out, { recursive: true });
  for (const [k, s] of Object.entries(r.sounds)) if (s) fs.writeFileSync(path.join(out, `${k}.wav`), wav(s));
  const t = r.textures.sce;
  fs.writeFileSync(path.join(out, "sce.pgm"), Buffer.concat([Buffer.from(`P5 ${t.width} ${t.height} 255\n`), Buffer.from(t.rgba.filter((_, i) => i % 4 === 3))]));
}

// 16-bit stereo WAV of dry + wet (no reverb here)
function wav({ rate, dry, wet }) {
  const n = dry[0].length, b = Buffer.alloc(44 + n * 4);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 4, 4); b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) {
    const v = Math.max(-1, Math.min(1, dry[c][i] + wet[c][i]));
    b.writeInt16LE(Math.round(v * 32767), 44 + i * 4 + c * 2);
  }
  return b;
}
console.log("check-ps2-bios OK");
