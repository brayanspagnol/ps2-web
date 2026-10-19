// Decodes the "PlayStation 2" boot logo stored on every PS2 game disc: the first 12 sectors
// (12 x 2048 bytes) hold an 8-bit grayscale picture, each byte XORed with a per-disc key and
// rotated by 3 bits. NTSC discs carry a 384x64 logo (shown on a 640x448 frame), PAL discs a
// 344x71 one (640x512 frame). No dependencies (tools/check-ps2-logo.mjs runs it under Node).

export const LOGO_BYTES = 12 * 2048;
const LAYOUTS = [
  { region: "NTSC", width: 384, height: 64, frameH: 448 },
  { region: "PAL", width: 344, height: 71, frameH: 512 },
];

// bytes: the first LOGO_BYTES of a raw disc image (ArrayBuffer or Uint8Array).
// Returns { region, width, height, frameH, pixels (Uint8Array, row-major, top row first) } or null
// when the data is not a logo (compressed images, ELFs, homebrew without a logo, read errors).
export function decodeDiscLogo(bytes) {
  const d = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? 0);
  if (d.length < LOGO_BYTES) return null;
  // The black background dominates, so the most common byte is the key (it decodes to 0).
  const hist = new Uint32Array(256);
  for (let i = 0; i < LOGO_BYTES; i++) hist[d[i]]++;
  let key = 0;
  for (let i = 1; i < 256; i++) if (hist[i] > hist[key]) key = i;
  if (hist[key] < LOGO_BYTES * 0.5) return null;
  const px = new Uint8Array(LOGO_BYTES);
  let white = 0;
  for (let i = 0; i < LOGO_BYTES; i++) {
    const v = d[i] ^ key;
    px[i] = ((v << 3) | (v >> 5)) & 255;
    if (px[i] === 255) white++;
  }
  if (white < LOGO_BYTES * 0.03) return null; // no solid letters: not a logo
  // The right layout makes consecutive rows line up: far smaller vertical differences.
  const scores = LAYOUTS.map((l) => {
    let diff = 0;
    const n = l.width * l.height;
    for (let i = l.width; i < n; i++) diff += Math.abs(px[i] - px[i - l.width]);
    return diff / n;
  });
  const best = scores[0] <= scores[1] ? 0 : 1;
  if (scores[best] * 2 > scores[1 - best]) return null; // neither layout fits clearly
  const l = LAYOUTS[best];
  return { ...l, pixels: px.subarray(0, l.width * l.height) };
}
