// Performance profile and adaptive quality, so the site runs on weak machines without manual tuning.
// detectHardware(): what the machine looks like (cores, memory, GPU name, a short CPU benchmark on the main
// thread and the same on up to 8 workers to see how many cores really run in parallel; Brave reports fewer cores
// and hides the GPU name, so the benchmark is what counts). pickDefaults(): starting quality for that profile.
// createAdaptive(): while a game runs, steps quality down when the emulator can't hold full speed and back up
// when there is headroom (see the comment above it).

const BENCH_N = 1500000;  // loop iterations: ~8 ms on the reference laptop core, 20+ ms on a weak one
const BENCH_REF_MS = 8;   // ms on the reference machine (12-thread Raptor Lake laptop, Brave, busy box) -> score 1
const BEST_KEY = "ps2web.hwBest"; // best benchmark seen on this browser (detectHardware)

function benchLoop(n) {
  let a = 1, b = 0.5;
  for (let i = 0; i < n; i++) { a = (Math.imul(a, 1103515245) + 12345) | 0; b = b * 0.999 + (a & 0xff) * 1e-3; }
  return b;
}

function benchMs(runs = 4) {
  let best = Infinity, sink = 0;
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    sink += benchLoop(BENCH_N);
    best = Math.min(best, performance.now() - t0);
  }
  return sink === -1 ? 0 : best; // sink keeps the loop from being optimized away
}

// Runs the benchmark on `count` workers at once; resolves with each worker's best time (ms), or null.
function parallelBench(count) {
  const src = `${benchLoop.toString()}
    onmessage = () => { let best = Infinity, s = 0; for (let r = 0; r < 4; r++) { const t = performance.now(); s += benchLoop(${BENCH_N}); best = Math.min(best, performance.now() - t); } postMessage(s === -1 ? 0 : best); };`;
  let url;
  try { url = URL.createObjectURL(new Blob([src], { type: "text/javascript" })); } catch { return Promise.resolve(null); }
  const workers = [];
  const done = new Promise((resolve) => {
    const times = [];
    try {
      for (let i = 0; i < count; i++) {
        const w = new Worker(url);
        w.onmessage = (e) => { times.push(e.data); if (times.length === count) resolve(times); };
        w.onerror = () => resolve(null);
        workers.push(w);
      }
      for (const w of workers) w.postMessage(0); // started together so they overlap
    } catch { resolve(null); }
  });
  const timeout = new Promise((r) => setTimeout(() => r(null), 3000));
  return Promise.race([done, timeout]).finally(() => { workers.forEach((w) => w.terminate()); URL.revokeObjectURL(url); });
}

function gpuName() {
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return { name: "", webgl2: false };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String((ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || "");
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    // Brave answers "Brave" (and Firefox/Safari may give a generic name): unknown, not weak.
    return { name: /^(brave|webkit webgl|mozilla)$/i.test(name) ? "" : name, webgl2: true };
  } catch { return { name: "", webgl2: false }; }
}

// Tier: "alto" (the full look), "medio" (lighter shelf), "basico" (everything cheap).
// remember = false: this run only (bench.html measurements under simulated slow CPUs).
export async function detectHardware({ remember = true } = {}) {
  const reported = navigator.hardwareConcurrency || 2;
  const memGB = navigator.deviceMemory ?? null; // Chromium only, capped at 8
  const gpu = gpuName();
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu.name);
  // Integrated GPUs that struggle with 2x upscaling + the CRT pass; newer Intel Xe/Arc and AMD APUs are not listed.
  const weakGpu = software || !gpu.webgl2 || /\b(U?HD Graphics|GMA|Mali|Adreno|PowerVR|VideoCore)\b/i.test(gpu.name);
  let singleMs = benchMs();
  const tried = Math.min(Math.max(reported, 4), 8);
  const alone = (await parallelBench(1))?.[0];
  const times = alone && (await parallelBench(tried));
  // Cores that really run at once (up to `tried`): each worker counts 1 when it was as fast as a worker alone.
  const parallel = times ? times.reduce((n, t) => n + Math.min(1, alone / t), 0) : tried;
  // Brave reports a random count <= the real one, so a full result keeps the larger of the two.
  let cores = parallel >= tried - 0.5 ? Math.max(reported, tried) : Math.max(1, Math.round(parallel));
  // A busy machine (other tabs, a build) measures slower than it is: keep the best result seen on this browser.
  let best = null;
  if (remember) try { best = JSON.parse(localStorage.getItem(BEST_KEY)); } catch {}
  if (best && Number.isFinite(best.singleMs) && best.singleMs > 0 && Number.isInteger(best.cores) && best.cores > 0 && best.cores <= 256) {
    singleMs = Math.min(singleMs, best.singleMs);
    cores = Math.max(cores, best.cores);
  }
  if (remember) try { localStorage.setItem(BEST_KEY, JSON.stringify({ singleMs, cores })); } catch {}
  const score = BENCH_REF_MS / singleMs; // 1 = reference machine, 0.5 = half as fast per core
  let tier = "alto";
  if (software || cores <= 2 || (memGB && memGB <= 2) || score < 0.35 || (cores <= 4 && (weakGpu || score < 0.6))) tier = "basico";
  else if (cores <= 4 || weakGpu || (memGB && memGB <= 4) || score < 0.6) tier = "medio";
  return { cores, reportedCores: reported, parallel: +parallel.toFixed(1), memGB, gpu: gpu.name, weakGpu, software, score: +score.toFixed(2), singleMs: +singleMs.toFixed(1), tier };
}

// Starting quality for a profile. resFactor/crt are settings defaults (the player's own choices win);
// the rest is applied by the page (scene at load, crtCheap/mtvu/audioMs once the emulator is up).
export function pickDefaults(hw) {
  const low = hw.tier === "basico", mid = hw.tier === "medio";
  return {
    resFactor: low || hw.weakGpu ? 1 : 2,
    crt: !hw.software,
    crtCheap: low,
    scene: low ? { antialias: false, shadows: false, maxPixelRatio: 1 } : mid ? { antialias: false, shadows: true, maxPixelRatio: 1.5 } : {},
    fsMaxPixelRatio: low ? 1 : mid ? 1.5 : 2,
    // VU1 on its own thread needs a free core next to the VM and GS threads (measured: see notes/low-end.md).
    mtvu: hw.cores >= 3,
    audioMs: low ? 200 : 100,
  };
}

export const TIER_NAMES = { alto: "Alto", medio: "Intermediário", basico: "Básico" };

// ---- Adaptive quality ----------------------------------------------------------------------------------
// Every 2 s it reads the emulator's per-vblank timeline. The frame limiter's sleep time says whether the game
// runs at full speed: a limiter that never sleeps means the machine can't keep up (whatever the game's frame
// rate is). With VU1 on its own thread there is a second kind of slow: the VU1 thread busy all the time while the
// VM still keeps full speed; the game then drops frames (God of War fights: 60 vblanks/s but ~22 frames/s), so a
// saturated VU1 thread counts as slow too, and steps are judged by frames shown per second (hooks.frames) when
// known, not by vblanks (frame skip, which hides frames on purpose: by vblanks). Slow for 3 windows in a row ->
// next step down; limiter sleeping >= 25% of the time (VU1 not saturated) for 5 windows -> undo the last step.
// A step-up that leads back to slow within 20 s blocks step-ups for 30 s, doubling each time (no flapping). Steps: lighter CRT shader, internal resolution 1x, frame skip (1 of 2 frames not drawn).
// The resolution and frame-skip steps only help when the GS thread / GPU is the bottleneck (GS busy most of
// the vblank, or the VM/VU1 waiting for it), on machines with <= 4 cores where every thread competes, or with
// the VU1 thread saturated (on an integrated GPU the GS load at 2x slows the CPU threads too: gow-fight at 1x
// went from ~22 to ~30 frames/s with the GS only ~55% busy, notes/site-perf.md); a
// step that did not raise the speed (frame skip: by 20%, or to full speed) is undone and not tried again until
// the next game.
// hooks: { getModule, limiterOn() -> bool, cores, canStep(step) -> bool, apply(step, on), onStatus(text),
//   hidden() -> bool (default: document.hidden; bench.html runs in background tabs),
//   frames() -> count of frames shown so far, or null (optional) }
export const STEPS = ["crt", "res", "skip"];
const STEP_NAMES = { crt: "efeito CRT leve", res: "resolução 1x", skip: "pulando 1 de cada 2 quadros" };

export function createAdaptive(hooks) {
  let timer = 0, next = null, active = [], slowRun = 0, fastRun = 0, cooldown = 0;
  let upBackoff = 30000, upBlockedUntil = 0, lastUpAt = 0, trial = null;
  const useless = new Set(); // steps that did not help in this game session
  let last = null, recent = []; // last window's metrics, the last 3 windows' metrics
  let frames0 = null; // hooks.frames() at the start of the window

  function windowMetrics(mod) {
    let tl;
    try { tl = JSON.parse(mod.getTimeline(next ?? 1e15)); } catch { return null; }
    const first = next === null;
    next = tl.next;
    const f = hooks.frames?.() ?? null, f0 = frames0;
    frames0 = f;
    if (first || !tl.rows.length) return null;
    const c = Object.fromEntries(tl.cols.map((n, i) => [n, i]));
    const sum = (k) => tl.rows.reduce((a, r) => a + (r[c[k]] || 0), 0);
    const wall = sum("wall");
    if (wall <= 0) return null;
    const vbl = tl.rows.length * 1000 / wall;
    return {
      vbl,
      speed: f !== null && f0 !== null ? (f - f0) * 1000 / wall : vbl, // frames/s shown, or vblanks/s
      vu1Busy: sum("vu1busy") / wall,
      limiter: sum("limiter") / wall,
      gsBusy: sum("gsbusy") / wall,
      gsWait: (sum("gswait") + sum("vu1gswait")) / wall,
    };
  }

  function status() {
    const parts = active.map((s) => STEP_NAMES[s]);
    hooks.onStatus?.(last ? `${Math.round(last.speed)} quadros/s${parts.length ? ` · reduzido: ${parts.join(", ")}` : " · qualidade completa"}` : "");
  }

  const rate = (step, m) => step === "skip" ? m.vbl : m.speed; // what a step is judged by
  function stepDown(m, now) {
    const gsBound = m.gsBusy > 0.8 || m.gsWait > 0.05 || hooks.cores <= 4;
    const vu1Bound = m.vu1Busy > 0.9;
    for (const s of STEPS) {
      if (active.includes(s) || !hooks.canStep(s)) continue;
      // frame skip only drops host drawing: it can't help a saturated VU1 thread, and halves the frames shown
      if (s === "res" ? !gsBound && !vu1Bound : s === "skip" && !gsBound) continue;
      if (useless.has(s)) continue;
      active.push(s);
      hooks.apply(s, true);
      // byVu1: taken for the VU1 thread alone; it must show more frames even if the VU1 thread is no longer saturated
      trial = { step: s, before: recent.reduce((a, r) => a + rate(s, r), 0) / recent.length, windows: 0, sum: 0, byVu1: !gsBound && vu1Bound };
      return true;
    }
    return false;
  }

  function tick() {
    const mod = hooks.getModule();
    if (!mod?.getTimeline || (hooks.hidden ?? (() => document.hidden))() || !hooks.limiterOn()) { next = null; return; } // restart the window after a gap
    const m = windowMetrics(mod);
    if (!m) return;
    last = m;
    recent = [...recent.slice(-2), m]; // speed over the last 3 windows (before a step)
    const now = performance.now();
    const slow = m.limiter < 0.02 || m.vu1Busy > 0.9;
    const headroom = m.limiter >= 0.25 && !slow;
    slowRun = slow ? slowRun + 1 : 0;
    fastRun = headroom ? fastRun + 1 : 0;
    // The first window after a step is skipped (a resolution change rebuilds the GS framebuffers), the next 3 count.
    if (trial && ++trial.windows <= 4) {
      if (trial.windows > 1) trial.sum += rate(trial.step, m);
      // Did not help: undo, try the next step. Frame skip halves the frames shown, so it must bring full speed
      // or a big gain to stay.
      const need = trial.step === "skip" ? 1.2 : 1.03;
      if (trial.windows === 4 && (slow || trial.byVu1) && trial.sum / 3 < trial.before * need) {
        active = active.filter((s) => s !== trial.step);
        hooks.apply(trial.step, false);
        useless.add(trial.step);
        trial = null;
        slowRun = 3;
        cooldown = 0;
      } else if (trial.windows === 4) trial = null;
    }
    if (cooldown > 0) cooldown--;
    else if (slowRun >= 3) {
      if (now - lastUpAt < 20000) { upBackoff = Math.min(upBackoff * 2, 600000); upBlockedUntil = now + upBackoff; }
      if (stepDown(m, now)) { slowRun = 0; cooldown = 4; }
    } else if (fastRun >= 5 && active.length && now >= upBlockedUntil) {
      hooks.apply(active.pop(), false);
      trial = null;
      lastUpAt = now;
      fastRun = 0;
      cooldown = 3;
    }
    status();
  }

  return {
    // Starts watching (on game start); stop() undoes every step.
    start() { if (!timer) { next = null; frames0 = null; timer = setInterval(tick, hooks.intervalMs ?? 2000); } },
    stop() {
      clearInterval(timer); timer = 0; next = null; last = null; trial = null; recent = [];
      for (const s of active.reverse()) hooks.apply(s, false);
      active = []; slowRun = fastRun = cooldown = 0; useless.clear(); upBackoff = 30000; upBlockedUntil = 0;
      status();
    },
    // Drops a step without touching what it controls (e.g. the player chose that setting by hand).
    forget(step) { active = active.filter((s) => s !== step); status(); },
    active: () => [...active],
  };
}
