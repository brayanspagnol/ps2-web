// Extracts the startup screen from a BIOS image off the main thread (rendering the sound takes ~0.3 s).
import { extractIntro } from "./ps2-bios.js";

onmessage = ({ data }) => {
  try {
    const r = extractIntro(data);
    const bufs = [];
    for (const s of Object.values(r.sounds)) if (s) bufs.push(...s.dry.map((a) => a.buffer), ...s.wet.map((a) => a.buffer));
    const t = r.textures;
    for (const x of [t.sce, t.flare, t.glow, ...t.fog]) if (x) bufs.push(x.rgba.buffer);
    postMessage({ ok: r }, bufs);
  } catch (e) {
    postMessage({ error: e.message });
  }
};
