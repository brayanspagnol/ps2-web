// Self-check for public/js/ps2-logo.js: node tools/check-ps2-logo.mjs [preview dir]
// Decodes the boot logo of every games/*.iso (region must match the file name when it says
// USA/Europe), checks that non-logo data is rejected, and optionally writes PGM previews.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { decodeDiscLogo, LOGO_BYTES } from "../public/js/ps2-logo.js";

const games = path.join(import.meta.dirname, "..", "games");
const out = process.argv[2];

assert.equal(decodeDiscLogo(new Uint8Array(LOGO_BYTES)), null, "all-zero sectors are not a logo");
assert.equal(decodeDiscLogo(Uint8Array.from({ length: LOGO_BYTES }, () => Math.random() * 256)), null, "noise is not a logo");
assert.equal(decodeDiscLogo(new Uint8Array(100)), null, "short data is rejected");

let n = 0;
for (const name of fs.existsSync(games) ? fs.readdirSync(games) : []) {
  if (!name.toLowerCase().endsWith(".iso")) continue;
  const buf = Buffer.alloc(LOGO_BYTES);
  const fd = fs.openSync(path.join(games, name), "r");
  fs.readSync(fd, buf, 0, LOGO_BYTES, 0);
  fs.closeSync(fd);
  const logo = decodeDiscLogo(buf);
  assert.ok(logo, `${name}: logo not found`);
  if (/\b(USA|NTSC)\b/i.test(name)) assert.equal(logo.region, "NTSC", name);
  if (/\b(Europe|PAL)\b/i.test(name)) assert.equal(logo.region, "PAL", name);
  // black corners around the letters
  const { width: w, height: h, pixels: p } = logo;
  for (const i of [0, w - 1, (h - 1) * w, h * w - 1]) assert.equal(p[i], 0, `${name}: corner is not black`);
  console.log(`${name}: ${logo.region} ${w}x${h}`);
  if (out) fs.writeFileSync(path.join(out, name.replace(/\W+/g, "_") + ".pgm"), Buffer.concat([Buffer.from(`P5 ${w} ${h} 255\n`), Buffer.from(p)]));
  n++;
}
console.log(`ok (${n} disc image${n === 1 ? "" : "s"})`);
