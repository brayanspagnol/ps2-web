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

## Phase 4: per-game ahead-of-time recompilation (months, optional)
- Record the blocks a game executes, translate them offline to C, compile with clang -O3 into a
  per-game wasm module loaded next to the emulator; the JIT stays as fallback for unseen code.
  This is the "recomp" approach, used only for flagship games that still miss full speed.

## Rules
- Measure before/after on the reference workloads; no change ships without numbers.
- Correctness first: a faster build that breaks a game does not ship.
- Game images are the user's own dumps; nothing in this project downloads or distributes them.
