# Frame-rate dips (branch `frame-dips`, worktree `play-dips/`) - working notes

Status (2026-10-16 11:10, paused mid-work): instrumentation done, dips classified on GTA play.zip (walking),
car.zip and FFX; three fixes committed as WIP (Play `7fc2f6a8`, CodeGen `frame-dips` `70937f3`, both pushed),
fix A/B and state hashes NOT measured yet. Base: web-perf cd7a2a58.

## Tooling
- `Module.getTimeline(fromIndex)` (all builds, commit b0b998a9): one row per emulated vblank in a 16384-row ring:
  wall ms, limiter sleep, VM waits for VU1 (`vu1sync`, `ringfull`), GS waits (VM / VU1 thread), disc read ms,
  compile ms (VM / other threads), GS and VU1 thread busy ms, compiles, Jitter runs, disc KB, 1 MB XHR fetches,
  VU1 ring fill, EE busy %. Profiling builds add PCNT counters and per-zone ms of the VM (`z:`) and VU1 (`v:`) threads.
  JSON: `{cols, first, next, t0 (Date.now of row t=0), rows}`.
- Profiling builds: `SLOWCOMPILE` lines in the profiler log (`bench.log`) for block compiles > 10 ms
  (category 4CC, range, words, wasm bytes, Jitter ms, wasm ms, cacheable). Zone switching fixed (the VU1 thread
  used to switch the VM thread's zone).
- Scratchpad tools (`/tmp/claude-1000/-home-brayan-spagnol/d44e6a54-b666-4287-bcd6-59e04ff885ad/scratchpad/tools/`):
  `drun.sh <emu> <play|car|ffx|gow-fight> <secs> <tag> [extra query] [--walk]` (bench-run lock, own tab,
  dips.py: timeline + per-thread schedstat/CPU id every 50 ms + per-CPU busy/MHz; `--walk` holds T, taps Z,
  turns with H), `dipan.py <run.json> [--top=N]` (vbl/s percentiles, slow vblanks = > 1.5x median of *work*
  vblanks, cause shares of the spike excess, low-second vs median-second comparison, E-core / HT-sibling / MHz),
  `dhash.sh <emu> <scenario>` (hash=300 vu1thread=0 via run.mjs), `deploy.sh <rel|prof> <variant>`.
  Results in `scratchpad/dips/*.json`.
- Variants: `emu-dipsbase` (release, cd7a2a58 + timeline = baseline), `emu-dipsfix1` (release, + Jitter passes
  + flip wait; WITHOUT the dual-layer change), `emu-dipsprof*` (profiling builds).
- GTA renders every 2nd vblank: the idle vblank takes ~2 ms, so "slow" is relative to the median of vblanks with
  EE busy > 5%. FFX intro alternates the same way.

## Dip breakdown (release baseline dipsbase, warm block cache, 90 s runs, limiter on, shared machine)
Share of the excess wall time of slow vblanks (each slow vblank's excess over the median is split over the
categories that exceed their normal-vblank median):

| cause | play.zip (walking) | car.zip | FFX intro |
|---|---|---|---|
| VM waits for the VU1 thread (vblank drain, ring full) | 26.4% | 34.2% | 53.4% |
| JIT compile on the VM thread | 37.6% | 9.6% | 13.7% |
| emulation work (heavier frames, CPU speed changes) | 31.8% | 52.2% | 28.0% |
| disc reads (sync XHR) | 4.0% | 3.2% | 0.2% |
| CPU contention (VM thread runnable, not running) | 0.2% | 0.8% | 4.2% |
| GS wait | 0% | 0% | 0.4% |

Baseline distribution: play p5/p10/p50 = 15/18/28 vbl/s, 117 slow work vblanks (5.4%), 99 > 100 ms;
car 14/16/28, 262 slow (11.1%), 131 > 100 ms; FFX 22/28/36, 167 slow (5.1%), 56 > 100 ms.

What is behind each cause:
- **VU1 wait**: two kinds. (1) The VU1 thread compiling a huge VU block while the VM waits at vblank: one VU1
  compile of 821 ms in a warm run, 0.3-3.4 s in cold runs (VU blocks of 160-430 instructions, ~3500 Jitter
  statements, O(n^2) passes). (2) Heavy stretches where the VU1 thread (and the GS thread behind it) is
  saturated: VM runs ahead until 2 flips are pending, then `SyncVu1(SYNC_VBLANK)` drained the whole queue
  (100-185 ms waits every few frames; ring 1.5-7.5 MB), leaving the VU1 thread idle afterwards. GS busy reached
  60-300 ms per frame in those stretches (VU1 thread then waits on the GS: `vu1gswait` up to 216 ms).
- **JIT compile (VM)**: real Jitter runs for code not in the persistent cache (~1-1.7 ms per EE block; single EE
  blocks up to 160-240 ms) and cache hits (0.14-0.17 ms each: wasm module instantiation + batching; a scene cut
  in car.zip instantiated 908 cached blocks = 97 ms). Warm runs still had thousands of Jitter runs: new code on
  a different walk path, and the block cache only flushes every 30 s / 1 MB, so blocks compiled in the last
  < 30 s of a session are lost when the tab closes.
- **Emulation work**: in low seconds the same EE instruction count took ~20% longer (GTA) or the frame had 2x
  the EE/VIF/XGKICK work (FFX heavy scenes). Machine effects are large here: the laptop is power-limited
  (PL1 28 W, a single busy core runs ~2.1 GHz with other load), the VM thread core averaged ~1.2-1.5 GHz in the
  runs, slow vblanks coincide with a busier hyperthread sibling (22-39% vs 11-21%) and more busy cores, and the
  VM thread sometimes lands on an E-core (cpu 8-11: 3-20% of vblanks, 2x more in slow ones).
- **Disc**: GTA free roam reads little (4-9 KB/vblank, one 1 MB XHR every ~1-2 s, 7-16 ms each).
  **God of War**: at boot, `COpticalMedia::CheckDualLayerDvd` scanned every sector from 35% of the 8.5 GB image
  to the layer break: 1225 synchronous 1 MB XHRs (1.2 GB) = ~14 s before the first vblank.

## Fixes (WIP commit 7fc2f6a8, not yet A/B measured)
1. **Jitter passes (CodeGen 70937f3)**: DeadcodeElimination as one backward pass (set of (symbol, version) read
   later + ordered set of relatives read later for the overlap check), CoalesceTemporaries with per-temporary
   reference positions, CSE bucketed by op, AllocateRegisters skipped when the codegen has no registers (wasm).
   Equivalence: a build compiling every block with the old and new passes and comparing the wasm bytes:
   0 mismatches in ~50k blocks (GTA play walk, FFX, GoW fight, block cache off).
   Pass timings before (no-cache GTA, profiling build): VU slow compiles 2.7 s total, of which coalesce 1.0 s,
   DCE 0.65 s, regalloc 0.35 s, CSE 0.25 s; EE 1.55 s (coalesce 0.43, DCE 0.53, regalloc 0.2).
   First release check (block cache off, GTA walk 60 s, noisy): VU1 compile total 4.8 s -> 2.5 s, max VU compile
   in one vblank 3.4 s -> 1.4 s, EE compile 23.3 -> 20.4 s. A 0.8-1.4 s VU compile remains: next step below.
2. **Vblank pacing with VU1 threaded** (`CVu1Thread::WaitFor`, `CSubSystem::WaitVu1`, PS2VM.cpp): with 2 flips
   pending, wait until the older one is done instead of draining the queue. VM can still be at most 2 vblanks
   ahead; no change with VU1 on the VM thread (hash runs unaffected by construction).
3. **Dual-layer layer break**: use the layer-0 PVD volume space size as the first candidate (GoW: 2080560, PVD
   found there), fall back to the scan. Not built/tested yet.

## Next steps (exact)
1. Build release (`wasm-rel`) with all three fixes -> `emu-dipsfix2`; build-run wrapper for builds, bench-run
   for game runs.
2. Hashes: `dhash.sh dipsbase|dipsfix2 play|car|ffx` must be identical (hash=300, vu1thread=0). Deterministic
   time: run.mjs `&vu1thread=0&nolimit=1&time=100,600`, alternated, ms/vbl unchanged or better.
3. Find the remaining 0.8-1.4 s VU compile: apply the temporary pass/front-end timers
   (`scratchpad/passtimers-play.patch` + `passtimers-codegen.patch`, generated against the WIP tree; re-create if
   they don't apply), build `wasm-prof`, run `drun.sh dipsprofN play 50 nocache "&blockcache=0" --walk` and read
   the `PASSES front=...` lines (fields: clamp, version, constprop, fold+reorder, copyprop, deadcode, cse,
   collapse, prune/merge, coalesce, prunesym, regalloc+norm, concat, codegen, iterations, max statements).
   Suspects: VU front end (`CVuBasicBlock::CompileBody`, ComputeFmacStallDelays/ComputeSkipFlagsHints),
   ConstantPropagation (O(n x constant movs)), the optimize loop iteration count (26-90 iterations seen).
4. Dip A/B: warm-up each variant once per scenario (60 s; `--walk` for play), then alternate dipsbase/dipsfix2
   x2 for play(walk)/car/ffx/gow-fight, 90 s each; compare p5/p10, slow work vblanks, > 100 ms count, max.
5. GoW: boot from scratch with dipsfix2 and check the first vblank comes ~14 s earlier and the game runs
   (`drun.sh ... gow` scenario), then the gow-fight dip runs (disc share there is still unknown).
6. Then, by measured share: cache-hit instantiation cost (0.15 ms/block; prefetch/batch cached successors),
   block-cache flush of the session tail (emulator.js flushes every 30 s / 1 MB: flush sooner after Jitter runs),
   GS thread spikes behind VU1 waits (shader/program creation?), disc read-ahead on a worker if GoW shows it.
