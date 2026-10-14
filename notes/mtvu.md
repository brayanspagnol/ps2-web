# MTVU (VU1 on its own thread) - working notes

Branch `mtvu` in `play-mtvu/` (worktree of the Play! fork, based on `web-perf`).
Variants: `public/emu-mtvu/` (release), `public/emu-mtvuprof/` (profiling), `public/emu-mtvubase/`
(web-perf baseline built from the same tree), `public/emu-mtvudbg/` (release + function names, for stack traces).

## Design
- VM thread keeps a *front* CVif1 (ROLE_FRONT): decodes the VIF1 stream for registers, STAT, interrupts (I bit),
  MSKPATH3, DMA stalls. It skips the work: UNPACK (SkipUnpack: same control flow, no reads/writes), MPG, DIRECT
  (consumes the data as if the GIF took it), microprogram execution (never waits for VU1).
- Every qword the front's stream loads is pushed (memcpy) into a 16 MB ring (CVu1Thread). A *back* CVif1
  (ROLE_BACK) on the VU1 thread decodes the same qwords for real (VU1 memory, micro memory, microprograms run to
  completion, XGKICK and DIRECT to the GIF). Same input, same order -> same decoder state, except ROW in
  difference mode (only the back has it; VIF1_R0-3 reads sync and read the back).
- PATH3 (GIF DMA) is pushed into the same ring; the VM thread decides how much goes through by following the
  PATH3 GIF tags itself (mask applies at packet boundaries). The back keeps a PATH3 side queue so VIF1 data can
  finish a PATH2 packet while PATH3 waits (GIF arbitration) and vice versa.
- JIT: each wasm worker has its own function table and JS Module. The VU1 thread registers the codegen import
  table in the same order (CVu1Thread::ThreadInitHandler, set in Ps2VmJs) and has its own CVuExecutor
  (created on that thread, swapped into m_VU1 when threading is on). Executor ops go through RunSync.
  The static CMipsJitter in CBasicBlock::Compile is now thread_local.
- Sync points (VM waits for the VU1 thread to be idle or stalled on the GIF): vblank flip (GS write buffer),
  GIF FIFO PIO writes, VIF1 GS downloads, EE reads/writes of VU1 data/micro memory (read handlers + EE store
  hook), VU1 registers via VU0 (0x1000FBxx), VU FBRST, ROW reads, save/load/reset (with discard), game config.
- INTC_STAT is atomic (GS SIGNAL/FINISH from PATH1 on the VU1 thread); GS CSR updates take the register mutex.
- Switch: Module.setVu1Threaded(bool) (default on), applied at the next vblank; GameConfig
  `<Vu1Threaded Enabled="false"/>` turns it off per game.

## Log
- First version synced on PATH3: GTA does ~15k PATH3 DMAs/s and ~9k MSKPATH3/s (per object), VM thread waited
  336 ms/s (VU1SYNC) -> slower than baseline. Fixed by queueing PATH3 (see design).
- Vblank sync (VM waiting for the VU1 thread to finish the frame before Finish/Flip) replaced by a flip message
  run on the VU1 thread (display info captured at vblank on the VM thread); VM waits only if 2 flips are pending.
- Bugs hit: VU executor block lookup table is uninitialized until Reset (crash "memory access out of bounds");
  executor empty block compiled on the VM thread called from the VU1 worker ("table index out of bounds") ->
  one executor per thread. Line endings: Profiler.*, PS2VM.cpp are CRLF upstream, edit binary-safe.
- CDP sampling profile (release + --profiling-funcs, GTA free roam, threaded): VM worker ~100% busy:
  JIT EE code 39%, CEeExecutor::Execute 23% (dispatcher), js-to-wasm 8%, front VIF1 ~9% (Cmd_UNPACK skip 4%),
  SPU 2%. VU1 worker ~73% busy (VU JIT 42%, ExecuteMicroProgram 5%, GIF 2%, unpack ~4%, VU block
  invalidation/recompile on MPG ~3%). GS worker ~50% busy. => after MTVU the VM thread (EE) is the limit.
- Machine was heavily loaded during most measurements (load 8-15: other agents' builds and benches), so absolute
  fps are noisy; compare alternating runs only.

## Results (commit 7659fc1d, release `emu-mtvu` vs `emu-mtvubase`, warm block cache, alternating runs, 30 s windows, median vbl/s; load avg 3-6)
| Scene | baseline | MTVU |
|---|---|---|
| GTA play.zip (free roam) | 24, 24 | 30, 30 |
| GTA car.zip | 10, 18 | 20, 22 |
| FFX 3D intro (state mtvu-ffx.zip, saved at ~150 s) | 30, 20 | 58, 58 (NTSC cap 60) |
Per-thread CPU (top -H, GTA free roam): baseline VM 99% + GS 34%; MTVU VM 97%, VU1 83%, GS 62%.
- Runtime toggle on->off->on and save/load with MTVU on: OK, geometry correct, 4 min without hang.
- Remaining limit in GTA: the VM thread (EE JIT code + dispatcher ~60%, front VIF1 ~9%).

## Ideas not done yet
- Front VIF1 still ~9% of the VM thread (120k DMA chunks/s in GTA): could batch chunks per DMAC chain.
- VU1 microcode re-JIT after every MPG (ClearActiveBlocksInRange + BlockFactory ~3% of the VU1 thread).
- GIF_STAT / VIF1_STAT are read without syncing (fine for GTA/FFX; a game polling VIF1_STAT.VEW to wait for VU1
  would need a sync there -> use <Vu1Threaded Enabled="false"/>).
