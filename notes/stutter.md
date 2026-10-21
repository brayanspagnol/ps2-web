# Stutter: compiling never blocks the game (branch `no-stutter`, merged into web-perf e0e7c919)

Status 2026-10-21: published, steady-state A/B settled (`public/emu` = web-perf e0e7c919). Machine was heavily loaded all day (other
agents' builds/benches, MemAvailable 2-4 GB, the test Brave was OOM-killed once), so frame-time numbers are noisy;
the compile-stall numbers are robust.

## Spike sources (before)
Per-vblank timeline (`getTimeline`), presented-frame intervals hooked on `onGsFrame`, limiter on, MTVU on, 45 s
from the state load. Base = web-perf 50027da9, empty block cache:
- **JIT compile on the VM thread** (Jitter optimizer + wasm codegen, ~0.35-1.5 ms per block): GTA play.zip 15.3 s
  of VM time in 45 s, worst vblank 8.1 s (the burst right after a state load), 40 vblanks with > 33 ms of compile;
  GoW fight 7.2 s / worst 4.2 s / 20; FFX 4.3 s / 1.4 s / 8.
- **VU1 compile on the VU1 thread** (makes the VM wait at vblank): GTA 2.5 s, GoW fight 0.8 s.
- **Warm cache**: cache hits still cost 0.15-0.25 ms each when every block is its own module (GTA 4.3 s,
  14 vblanks > 33 ms); fixed by instantiating cached blocks in groups (no-stutter 41109ebb, in this merge).
- Not compile: VM waits for the VU1 thread (`vu1sync`, heavy scenes; FFX 14-16 s per 45 s, the largest share of
  slow FFX frames, both builds), disc reads 0.15-0.25 s per 45 s, GS waits 0, limiter 0. OPFS block-cache writes
  run on the main thread (async), not on the VM thread; flush period lowered 30 s -> 10 s so blocks compiled at
  the end of a session aren't lost. Audio (worklet) never showed up in slow frames.

## Design (Play `Source/AsyncCompile.{h,cpp}`, CodeGen `Jitter_Interpreter.{h,cpp}`)
- A block not in the block cache runs its front end on the thread that executes it (instruction compilers ->
  Jitter statements, ~0.05-0.1 ms), then `CJitter::BuildInterpreterProgram` turns the statements into a compact
  program and the block **runs at once in the interpreter** (`CInterpreterProgram::Run`, same operations, helper
  calls and results as the wasm code generator; temporaries in a per-thread arena, thread stacks are 64 KB).
- The jitter with the statements goes to **2 helper threads** (`std::thread`), which run the optimizer + wasm
  codegen (`CJitter::End`), add the bytes to the block cache and group finished blocks into batch modules
  (<= 64 functions).
- The owning thread (VM: EE/IOP/VU0; VU1 thread with MTVU) instantiates its batches on its next dispatch
  (`AsyncCompile::Update` at the top of `CEeExecutor::Execute` and `CVpu::Execute`) and the block switches to the
  compiled function (EE function-index table and VU chain index refreshed on the next run). Wasm functions live
  in per-worker tables and a blocking pthread can't receive a module compiled in another worker, so the module
  compile+instantiate (~0.07 ms per block, <= ~6 ms per batch) stays on the owner. Tried: compiling the batch
  in the helper first so V8 would share it (native module cache): no effect on the owner's compile cost, removed.
- Priority: blocks run 32 times in the interpreter go first, then newest first. At most 1024 queued jobs (each
  holds its statements); blocks beyond that get their job when they turn hot (front end again; if the code
  changed meanwhile without the block being dropped, it stays interpreted).
- **mimalloc** (`-sMALLOC=mimalloc`): with dlmalloc's single lock, helpers and the VM thread (both allocation
  heavy) stalled each other: VM-thread front end 10.6 s -> 2.4 s, helpers 22 s -> 12.7 s (GTA cold, 40 s).
  Cost: wasm heap peak 237 -> 443-532 MB.
- Knobs: `setAsyncCompile(0|1|2)` (off / on / interpret only), `setAsyncCompileHelpers(n)`, `asyncCompileStats()`;
  bench.html `&async=`, `&helpers=`.

## Correctness
State hashes (`hash=300&vu1thread=0&nolimit=1`) with an **empty** block cache (blocks interpreted, compiled and
swapped mid-run): car 55dab76e, play 1f851c1c, mtvu-ffx 5927b89c (x2), gow-fight 77f177fc, gow-intro b2119704 =
baseline. Interpret-only (`async=2`): GTA 120 vblanks and FFX 300 vblanks identical. One earlier FFX cold run
(before the "compile what the interpreter runs" fix) diverged at vblank 268; 4 later cold FFX runs matched.
Bugs found on the way: interpreter temporaries on the 64 KB thread stack (VU blocks overflowed it -> memory
corruption), program freed while running (VU0 started from an interpreted EE block swaps blocks in), O(n^2) job
pick, jitter churn.

## Results (base web-perf 50027da9 vs e0e7c919; mean of 2 rounds, 45 s, limiter on, loaded machine)
Presented-frame interval ms; cmpVM = VM-thread compile s per run; c>33 = vblanks with > 33 ms of compile.

| state | cache | build | mean | p95 | p99 | max | >50 | >100 | cmpVM | c>33 |
|---|---|---|---|---|---|---|---|---|---|---|
| GTA play | cold | base | 103.0 | 188 | 456 | 986 | 100% | 29.6% | 15.3 | 40 |
| GTA play | cold | new | 95.4 | 144 | 197 | 607 | 100% | 28.6% | 4.0 | 13 |
| GTA play | warm | base | 90.1 | 142 | 313 | 638 | 100% | 18.2% | 4.3 | 14 |
| GTA play | warm | new | 64.7 | 92 | 118 | 246 | 82% | 3.6% | 0.5 | 1 |
| GoW fight | cold | base | 54.8 | 74 | 148 | 880 | 50% | 2.4% | 7.2 | 20 |
| GoW fight | cold | new | 56.8 | 87 | 114 | 391 | 64% | 2.1% | 1.7 | 5 |
| GoW fight | warm | base | 46.7 | 69 | 89 | 319 | 41% | 0.7% | 1.7 | 6 |
| GoW fight | warm | new | 51.4 | 65 | 78 | 123 | 55% | 0.3% | 0.2 | 1 |
| FFX mtvu | cold | base | 82.2 | 104 | 143 | 1788 | 96% | 6.5% | 4.3 | 8 |
| FFX mtvu | cold | new | 90.3 | 155 | 260 | 1037 | 84% | 26.9% | 1.8 | 6 |
| FFX mtvu | warm | base | 64.3 | 81 | 93 | 526 | 81% | 1.1% | 0.9 | 5 |
| FFX mtvu | warm | new | 77.6 | 104 | 120 | 173 | 93% | 9.8% | 0.1 | 0 |
| GoW intro | cold | base | 68.5 | 96 | 129 | 175 | 98% | 4.5% | 1.3 | 3 |
| GoW intro | cold | new | 70.0 | 100 | 136 | 194 | 100% | 5.6% | 0.5 | 2 |
| GoW intro | warm | base | 63.5 | 81 | 95 | 118 | 99% | 0.9% | 0.1 | 1 |
| GoW intro | warm | new | 77.6 | 119 | 142 | 163 | 87% | 19.7% | 0.0 | 0 |

(> 33 ms is ~100% everywhere: these games present at 25-30 fps on this machine.)
- Compile stalls fall 3-10x everywhere (VM compile time, worst vblank, vblanks > 33 ms of compile); worst frame
  falls in 6 of 8 cases (GTA cold 986 -> 607, warm 638 -> 246; GoW fight cold 880 -> 391).
- **Steady-state check (2026-10-21, settled)**: the FFX / GoW intro warm slowdown above was machine noise.
  Warm cache, no limiter, wall ms/vbl over vblanks 100-600 after the state load, 5 rounds with the build order
  rotated (plus a discarded warm-up round), quieter machine (one other agent). Base = 992afde4 (50027da9 only adds
  the resumeVm export), pub = published e0e7c919 (mimalloc), pubdl = e0e7c919 relinked with dlmalloc:

  | state | build | median ms/vbl | min | mean | GS busy | VU1 busy |
  |---|---|---|---|---|---|---|
  | gow-fight | base | 17.69 | 14.91 | 19.78 | 11.10 | 19.53 |
  | gow-fight | pub | 15.42 | 15.22 | 17.48 | 9.07 | 17.28 |
  | gow-fight | pubdl | 16.31 | 15.02 | 16.73 | 8.58 | 16.64 |
  | gow-intro | base | 25.46 | 20.88 | 26.31 | 2.29 | 0.24 |
  | gow-intro | pub | 25.62 | 19.19 | 27.53 | 2.55 | 0.27 |
  | gow-intro | pubdl | 24.35 | 19.63 | 26.04 | 2.39 | 0.24 |
  | mtvu-ffx | base | 31.23 | 27.73 | 34.34 | 16.28 | 26.80 |
  | mtvu-ffx | pub | 30.95 | 29.62 | 31.42 | 14.51 | 24.78 |
  | mtvu-ffx | pubdl | 32.79 | 29.24 | 31.83 | 17.53 | 30.35 |

  Run-to-run spread is +-30% and GS busy (code these builds share) moves with wall time, i.e. the machine's speed,
  not the build. No build is consistently slower; mimalloc costs nothing measurable in steady state and is what
  keeps the cold-compile gain (dlmalloc: VM-thread front end 4x slower), so the published build stays.

## Files
Scratchpad `stutter/`: `run.mjs` (CDP runner: own tab closed in finally/on signals, frame hook, worker errors,
`--prof=` V8 profiles of every worker), `go.sh` (memory/user-playing gate + bench-run), `matrix.sh`, `ana.py`,
`agg.py`, `causes.py`, `pa.py`/`pb.py` (profiles), results in `stutter/r/`.
