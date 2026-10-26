// Self-check for the adaptive quality in public/js/perf.js: node tools/check-perf.mjs
// Drives createAdaptive() with a fake emulator timeline (no browser) and checks the step-down / undo / step-up rules.
import assert from "node:assert/strict";
import { createAdaptive } from "../public/js/perf.js";

globalThis.document = { hidden: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake machine: speed (vblank wall ms) depends on which steps are on.
function run({ cores, gsBusy, wallMs, stepsMs, ticks }) {
  const on = new Set(), log = [];
  let next = 0, frames = 0;
  const mod = {
    getTimeline(from) {
      const wall = wallMs - [...on].reduce((a, s) => a + (stepsMs[s] ?? 0), 0);
      const limiter = Math.max(0, 20 - wall); // PAL: 20 ms per vblank at full speed
      const rows = from >= 1e15 ? [] : Array.from({ length: 50 }, () => [Math.max(wall, 20), limiter, gsBusy * wall, 0, 0]);
      next += rows.length;
      frames += rows.length * (on.has("skip") ? 0.5 : 1); // a frame per vblank; frame skip shows half
      return JSON.stringify({ cols: ["wall", "limiter", "gsbusy", "gswait", "vu1gswait"], next, rows });
    },
  };
  const a = createAdaptive({
    getModule: () => mod, limiterOn: () => true, cores, intervalMs: 1, frames: () => frames,
    canStep: () => true, apply: (s, v) => { log.push(`${s}${v ? "-" : "+"}`); v ? on.add(s) : on.delete(s); },
  });
  a.start();
  return sleep(ticks * 4).then(() => { const r = { log, active: a.active() }; a.stop(); return r; });
}

// GS-bound weak machine: lighter CRT does nothing, 1x resolution brings full speed -> CRT undone, 1x kept.
let r = await run({ cores: 4, gsBusy: 0.95, wallMs: 25, stepsMs: { res: 8 }, ticks: 60 });
assert.deepEqual(r.active, ["res"], JSON.stringify(r));
assert.deepEqual(r.log.slice(0, 3), ["crt-", "crt+", "res-"]);

// VM-bound fast machine (GS mostly idle, 8 cores): only the CRT step is tried, undone, nothing else.
r = await run({ cores: 8, gsBusy: 0.5, wallMs: 26, stepsMs: {}, ticks: 60 });
assert.deepEqual(r.active, []);
assert.deepEqual(r.log, ["crt-", "crt+"]);

// Frame skip with a small gain is undone; with full speed it stays.
r = await run({ cores: 2, gsBusy: 0.9, wallMs: 30, stepsMs: { skip: 2 }, ticks: 80 });
assert.ok(!r.active.includes("skip"), JSON.stringify(r));
r = await run({ cores: 2, gsBusy: 0.9, wallMs: 30, stepsMs: { skip: 15 }, ticks: 80 });
assert.ok(r.active.includes("skip"), JSON.stringify(r));

// VU1 thread saturated (MTVU) at full vblank speed: the game drops frames. Judged by frames shown: the CRT step
// does nothing (undone), 1x shows more frames (kept), although vblanks/s and the GS share don't move.
// Frame skip is never tried for the VU1 thread alone. A 1x that only unloads the VU1 thread a little (no more frames)
// is undone.
async function vu1Run(resFrames) {
  const on = new Set(), log = [];
  let next = 0, frames = 0;
  const mod = {
    getTimeline(from) {
      const rows = from >= 1e15 ? [] : Array.from({ length: 50 }, () => [17, 2, 9, on.has("res") ? 15.1 : 16.6]);
      next += rows.length;
      frames += rows.length * (on.has("res") ? resFrames : 0.38);
      return JSON.stringify({ cols: ["wall", "limiter", "gsbusy", "vu1busy"], next, rows });
    },
  };
  const a = createAdaptive({
    getModule: () => mod, limiterOn: () => true, cores: 8, intervalMs: 1, frames: () => Math.floor(frames),
    canStep: () => true, apply: (s, v) => { log.push(`${s}${v ? "-" : "+"}`); v ? on.add(s) : on.delete(s); },
  });
  a.start();
  await sleep(60 * 4);
  const r = { log, active: a.active() };
  a.stop();
  return r;
}
r = await vu1Run(0.53);
assert.deepEqual(r.active, ["res"], JSON.stringify(r));
assert.deepEqual(r.log.slice(0, 3), ["crt-", "crt+", "res-"]);
assert.ok(!r.log.includes("skip-"), JSON.stringify(r));
r = await vu1Run(0.38);
assert.deepEqual(r.active, [], JSON.stringify(r));
assert.ok(r.log.includes("res+") && !r.log.includes("skip-"), JSON.stringify(r));

// Plenty of headroom after the steps: they are undone again (last first).
r = await run({ cores: 4, gsBusy: 0.95, wallMs: 22, stepsMs: { res: 12 }, ticks: 40 });
assert.ok(r.log.includes("res-") && r.log.includes("res+"), JSON.stringify(r));
console.log("perf adaptive: ok");
