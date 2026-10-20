// Self-check for the adaptive quality in public/js/perf.js: node tools/check-perf.mjs
// Drives createAdaptive() with a fake emulator timeline (no browser) and checks the step-down / undo / step-up rules.
import assert from "node:assert/strict";
import { createAdaptive } from "../public/js/perf.js";

globalThis.document = { hidden: false };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fake machine: speed (vblank wall ms) depends on which steps are on.
function run({ cores, gsBusy, wallMs, stepsMs, ticks }) {
  const on = new Set(), log = [];
  let next = 0;
  const mod = {
    getTimeline(from) {
      const wall = wallMs - [...on].reduce((a, s) => a + (stepsMs[s] ?? 0), 0);
      const limiter = Math.max(0, 20 - wall); // PAL: 20 ms per vblank at full speed
      const rows = from >= 1e15 ? [] : Array.from({ length: 50 }, () => [Math.max(wall, 20), limiter, gsBusy * wall, 0, 0]);
      next += rows.length;
      return JSON.stringify({ cols: ["wall", "limiter", "gsbusy", "gswait", "vu1gswait"], next, rows });
    },
  };
  const a = createAdaptive({
    getModule: () => mod, limiterOn: () => true, cores, intervalMs: 1,
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

// Plenty of headroom after the steps: they are undone again (last first).
r = await run({ cores: 4, gsBusy: 0.95, wallMs: 22, stepsMs: { res: 12 }, ticks: 40 });
assert.ok(r.log.includes("res-") && r.log.includes("res+"), JSON.stringify(r));
console.log("perf adaptive: ok");
