# PS2 in the browser: roadmap

Goal: run PS2 games at full speed (50/60 fps) in a regular browser, on the player's own machine,
with no install. Base: the Play! emulator compiled to WebAssembly (see BUILD.md, OPTIMIZATION.md).

Reference workloads (save states in the test profile's OPFS): GTA San Andreas PAL free roam
(`play.zip`, ~18-22 vbl/s today, needs 50), GTA SA car cutscene (`car.zip`), Final Fantasy X NTSC
(menus 60, 3D intro 12-16). Every change is measured on these before/after and recorded in
OPTIMIZATION.md. `public/emu/` always holds the best working build.

Where the time goes today (GTA SA free roam, VM thread, ms per second): EE JIT code ~400,
VU1 ~320, EE dispatcher ~85, VIF1 ~75, GIF ~33, compile ~30, IOP ~20, SPU ~17. One core at 100%,
the rest idle. Target: ~2.5-3x faster VM thread for GTA SA; lighter games need less.

## Status (2026-10-14, end of day)
Shipped in public/emu (Play! fork, branch web-perf): stale-JIT fix (software write protection), idle
detection, IPU IDCT, persistent JIT block cache, quick save/load, AudioWorklet audio with WSOLA
time-stretching, VU1 on its own thread (MTVU). FFX intro 3D ~58/60 vbl/s; GTA SA free roam ~22-24/50
(EE/VM thread bound).
Update 2026-10-15: VU JIT context promotion (~1.25x VU1), FFX freeze fix (LQC2/SQC2), GS thread with its
own WebGL context on an OffscreenCanvas (frames to the page as ImageBitmap: no black flashes, main thread
3-7% busy) and a site that only redraws the TV screen while playing. GTA SA ~28-32 vbl/s in free roam, ~40-45
in the intros; FFX intro 37 (site) with drops. EE block chaining/context promotion gave no gain (off).
Update 2026-10-15 evening: public/emu rolled back to fbed76d8 because the OffscreenCanvas GS build
(3925aa4b, web-perf HEAD) hangs the page main thread during GTA's intro movies on a cold boot (being fixed
on branch site-gs, notes/gs-hang.md). ee-jit (f08f5db1: module batching, page-table memory ops, dispatch via
index table) is ready: -12% ms/vbl on play.zip/car.zip, ~+18% in-game; integrate after the GS hang fix.
In progress (fork branches, see notes/): `vu-jit` (VU codegen: context promotion, differential test,
VU1 replay benchmark), `ee-jit` (EE dispatcher/block linking/traces — the GTA bottleneck).
Next: finish ee-jit and vu-jit, merge into web-perf with ABAB measurements, then Phase 3 traces.

## Phase 1: quick wins (days)
- Persistent compiled-block cache in OPFS: no JIT stutter or warm-up on the second run. (in progress)
- Direct block linking with wasm tail calls (`return_call`), removing most dispatcher round trips.
- Save/load buttons on the site (save states already work in the frontend).
- Expected: ~1.1x, far fewer stutters.

## Phase 2: use more cores (weeks)
- VU1 on its own thread, like PCSX2's MTVU: VIF1 + VU1 microprograms + XGKICK run on a VU1
  worker fed by a ring buffer; sync points for VPU_STAT/VBS1, TOP/ITOP, VIF1_STAT, VU1 memory
  reads, FBRST, savestates. Each thread must compile its own JIT blocks (per-worker function table).
- GS on its own WebGL context (OffscreenCanvas on the GS thread, frames sent as ImageBitmap), so GL
  calls stop being proxied through the main thread.
- Expected: ~1.3-1.5x on VU-heavy games.

## Phase 3: better generated code (weeks to months)
- Superblocks/traces: compile hot chains of EE blocks into one wasm function, keep MIPS registers
  in wasm locals across the trace instead of loading/storing the context on every instruction.
- Second tier for hot code: re-optimize hot traces (e.g. with Binaryen running in the page) after
  they prove hot; keep the fast Jitter as tier 1.
- Same for VU microprograms (they are small and very hot: ideal for aggressive optimization).
- Fast paths for memory access (RAM/scratchpad without the page-table indirection when the
  address is known to be in RAM).
- Expected: the big multiplier, ~1.5-2x on EE/VU code.

## Phase 3b: in-browser tier-2 JIT (weeks to months) — see notes/tier2-jit-design.md
- Tier 1 = today's JIT. A sampler thread finds hot code; a background worker recompiles hot single-entry
  regions (same front end/IR, general CFG structuring, effect classes for helpers so promoted registers
  survive slow paths), the VM thread installs them; persisted in the OPFS block cache. Works for every game
  in any browser with nothing installed. Expected 1.2-1.8x on the VM thread. First milestone M0 (3-4 days):
  edge counters + region simulation, effect classes for the memory slow path.

## Phase 4 (rejected): per-game offline recompilation via C + clang
Needs a native toolchain per player and produces code derived from the game; doesn't fit "open the link
and play". Kept only as a reference in notes/tier2-jit-design.md.

## Old Phase 4 text: per-game ahead-of-time recompilation (months, optional)
- Record the blocks a game executes, translate them offline to C, compile with clang -O3 into a
  per-game wasm module loaded next to the emulator; the JIT stays as fallback for unseen code.
  This is the "recomp" approach, used only for flagship games that still miss full speed.

## Rules
- Measure before/after on the reference workloads; no change ships without numbers.
- Correctness first: a faster build that breaks a game does not ship.
- Game images are the user's own dumps; nothing in this project downloads or distributes them.
