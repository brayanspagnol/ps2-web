# VU JIT on WebAssembly (Phase 3) — work notes

Branch `vu-jit` in worktree `play-vujit` (pushed to `fork`). CodeGen submodule commits are on its
local branch `vu-jit`, pushed to `fork` (https://github.com/brayanspagnol/Play--CodeGen.git); same changes as `notes/vu-jit-codegen.patch`
(apply with `git am` inside deps/CodeGen).

## Findings
- VU blocks: every op loads/stores VF/VI/flags/pipeline state from the CMIPS context; per FMAC op the
  sticky (always) + MAC + clip flag ring buffers are written (2 indexed stores + index update) and the
  previous sticky value is re-loaded from the ring; each block starts with pipeFmacWrite stall checks.
- Block calls are cheap per se (cross-instance call_indirect ~5 ns, node microbench). Self-loops already
  loop inside the function. A GTA VU1 program runs ~283 block calls (replay, PROFILE build).
- In-game fps is too noisy to see VU changes (VU1 is ~25% of the VM thread; machine shared with other
  agents). Use the VU1 replay benchmark below (same captured programs, both codegens, alternating rounds).
- V8 tier-up matters: right after (re)instantiation blocks run in Liftoff; replay rounds warm up 1.5 s.
- JIT -> C++ helper calls (memory proxies, XTOP/XITOP) went wasm->JS->wasm through convertJsFunctionToWasm.
  Fixed in CodeGen (helpers' own table entries). Mostly an EE win; not measured yet.
- CBasicBlock::Execute shows ~12-14% self time in CPU profiles of gameplay: EE block calls (VU share is small).

## Done (all behind the optimized VU codegen = "promotion", default on; off with setVuJitOptions)
1. CodeGen wasm "context promotion": context symbols accessed only as whole symbols live in wasm locals for
   the whole function (load at entry, store at exit/around calls). Registered context arrays (VI file, flag
   pipeline arrays) stay in memory. Then: 128-bit symbols with 32/64-bit lane accesses and f32-over-i32
   bitcasts are promoted too (lane extract/replace).
2. Flag forwarding (VUShared): latest value queued in MAC/sticky/clip pipelines kept in CMIPS::m_jitFlagScratch
   (promoted) so the next FMAC/CLIP doesn't reload values[index-1].
3. Tooling: differential test (`&vujit=1,1` in bench.html: every VU block runs reference and optimized code
   from the same state, compares MIPSSTATE + VU data memory; XGKICK only once), VU1 replay benchmark
   (`vuCapture(n)`, `vuReplay(iters)`, `vuReplayResult()`; captures saved to /work/vucap.bin, OPFS copy
   `vucap-gta-play.bin`, 300 GTA play.zip programs incl. TOP/ITOP), PROFILE zones VUBLOCK + vuBlocks counter,
   JIT function names (`&vujit=p,d,1`) for CPU profiles; scripts in scratchpad tools/ (vjrun.sh, replay.sh,
   replayprof.sh, cdpprof.mjs, profagg.mjs).

## Numbers
- Differential test, GTA play.zip: 9.58M block runs (promotion) and 2.73M (promotion+lanes+forwarding), 0 mismatches;
  replay hash comparison 0 mismatches every run. Screenshots OK.
- VU1 replay (fixed 300-program GTA capture, median of 4 rounds, us/program): reference 31.6 -> optimized 25.9
  (x1.22). Earlier sets: x1.14-1.18.
- In-game GTA play.zip release fps: vujitbase 20-22, vujit 20 (noise; not yet measured on a quiet machine).
  car.zip / FFX: not measured yet.

## 2026-10-15: merged web-perf (MTVU), superblocks finished
- Merge commit fff360f2 on `vu-jit` (pushed to `fork`); CodeGen unchanged (627e10e, branch `vu-jit` pushed to `fork`).
- MTVU: the VU1 thread's executor compiles with the same promoted codegen (thread_local jitter); diff-test state is
  thread_local. Replay benchmark runs on the VU1 thread when threaded (capture TOP/ITOP read through the VU memory map).
- Bug found: the executor's *empty block* was compiled for the diff test; it runs the real block, so diff mode ran
  blocks twice and kicked GIF packets twice -> with VU1 threaded the GIF got stuck on a bogus PATH1 packet and the VM
  thread blocked in CVu1Thread::Reserve (ring full). Fixed (empty block never diffed). Side finding (not changed): MTVU
  can deadlock if the VU1 thread stalls on the GIF waiting for data the VM thread has not pushed yet while the ring is
  full (Reserve blocks the VM thread). Only seen with this bug, but a stalled-DMA fallback in CVif/CGIF::ReceiveDMA
  (return 0 when the ring lacks room) would make it robust.
- Superblocks (executor side done): planning in CVuExecutor::PartitionFunction (BFS over static successors, <=16 parts,
  inside [entry, entry+MAX_BLOCK_SIZE)), reference-block provider for the diff test (reference blocks without self
  loops), `Module.setVuSuperBlocks(bool)` / bench `&vusb=1`, default OFF.
- Diff test (GTA play.zip, release): VU1 threaded 5.06M block runs / 0 mismatches; unthreaded 12.1M / 0;
  superblocks threaded 205k superblock runs / 0, unthreaded 222k / 0. Replay hashes: 0 mismatches every round.
- Replay (us/program, quietest run, rounds alternate): reference 33.9/32.0, promoted 26.0/25.9, superblocks 28.7/28.7.
  Superblocks are ~10% SLOWER than plain promoted blocks (4-part cap: no better within noise). Likely cause: the
  dispatch loop makes every promoted local loop-carried (big v128 phi sets in TurboFan) and the union of promoted
  symbols is stored/reloaded around every helper call and at exit.
- CPU profile (GTA free roam, release + names, threaded): VM thread VU0 JIT 0.4% (the VUBLOCK zone in PROFILE builds is
  mostly profiler overhead); VU1 thread ~59% busy: VU1 JIT 31%, VU dispatcher (CGenericMipsExecutor::Execute) 5.2%,
  GIF 1.9%, BlockFactory 1.2%. => the most superblocks could save is ~5% of the VU1 thread, and the VU1 thread is
  not the bottleneck in GTA (VM/EE thread is).
- In-game ABAB (release, warm cache, median vbl/s t=15-45 s, machine loaded 3-8 by other agents -> noisy):
  FFX mtvu-ffx.zip: public/emu (web-perf) 25, 32 vs emu-vujit 36, 30; GTA car.zip: emu 4 (stall outlier), 20 vs
  emu-vujit 20, 24. No regression; no gain measurable above noise (expected: VU1 thread is not the limit).
- Variants: public/emu-vujit (release, superblocks off, `&vusb=1` to enable), emu-vujitprof, emu-vujitnames.
  bench.html: new `&vusb=0|1`. Scripts: scratchpad vujit/ (vj.mjs, run.sh, replay.sh, abab.sh, profagg.mjs).
- PROFILE builds: vuBlocks / "blocks/program" counter is meaningless with VU1 threaded (exchanged by getProfile on
  another thread), and per-block zone swaps inflate VU time a lot.

## 2026-10-20: VU1 thread for GTA SA (branch `vu1-fast`, worktree `play-vu1`, merged into web-perf 992afde4)
- Block sets per micro memory contents (8c94acd4): `CVuExecutor` marks 256-byte micro memory pages dirty on writes,
  rehashes them before the next run and switches the block lookup table to the set for those contents (<= 64 sets).
  Replaces ClearActiveBlocksInRange + BlockFactory after every MPG (8-10% of the VU1 thread in notes/gta-profile.md).
- VIF unpack runs with wasm SIMD (5bb13f63). Measured: within noise on the VU1 thread (~0.0-0.3 ms/vbl).
- VU block chaining (2c5d9300): epilog tail calls the block at nPC through `CMIPS::m_blockFnLookup` = the executor's
  `CBasicBlock*` table (refreshed every Execute: MTVU has two executors on the VU1 context; block sets switch it);
  the wasm function index is read from `CBasicBlock::m_chainFunctionIndex`. Empty block returns to the executor.
  Off in diff mode. VU blocks are batched into modules like EE blocks (`CBasicBlock::BatchModules`).
- Flag writes (135e48b2; VU1 code only after the follow-up fix: VU0 flag pipelines are copied into the EE context,
  so skipping there changed EE state hashes): `ComputeSkipFlagsHints` (upstream, MAC only) extended to sticky/status (same writers and
  readers as MAC) and clip (CLIP / FCEQ FCAND FCOR FCGET via new `OPERANDSET::read/writeClipFlags`). Skipped entries
  are never selected by `CheckFlagPipeline` (a newer entry is visible before any read and by block end + 4); the
  next sticky/clip update takes the latest value from the forwarding scratch, so skipping needs promotion and is off
  in diff mode. Validation: `vuHashResult` has 3 extra components after `/` (EE, VU0, VU1 state without flag
  pipeline arrays); identical with `setVuSkipFlagWrites(false)` vs default on car/play/gow-fight; bench.html
  `&vuflagskip=0`. Block cache CODEGEN_VERSION 2.
- Result (quiet box, OPTIMIZATION.md table): VU1 thread CPU play 20.4 -> 18.4 ms/vbl, car 29.0 -> ~26 (-10%):
  block sets ~-6..-12%, chaining ~-2%, flags ~-2%. Wall unchanged (VM thread is the limit at ~25.8 ms/vbl on play).
- Tools: scratchpad `vu1/run.mjs` (CDP runner: one tab, `hash` or `time` mode, per-thread CPU of the tab's renderer),
  `abab.sh`, `masked.sh`. Variants: public/emu-vu1c (block sets), -vu1s (+SIMD), -vu1j (+chaining), -vu1f (+flags),
  -vu1wp (web-perf merge).

## Next steps
1. VU1 is now ~18.4 ms/vbl on play (quiet box): under the ~19 needed for 50 vbl/s. The VM thread is next.
2. More flag work: MAC/sticky/clip values are still computed when unused (only the ring writes are skipped).
3. Superblocks: obsolete with chaining unless a loop-shaped variant is tried.
