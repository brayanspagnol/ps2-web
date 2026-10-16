# EE JIT speedups (branch `ee-jit`, worktree `play-eejit/`) - working notes

Status (2026-10-15 evening): module batching + page-table memory ops + index-table dispatch are ON by default
(-12% ms/vbl play.zip, -11% car.zip, in-game 34 -> 40 vbl/s); see "Session 2" below. Block chaining and EE
context promotion are correct but slower, OFF by default. Branch `ee-jit`
contains web-perf (merged at fbed76d8, incl. vu-jit). CodeGen submodule branch `ee-jit` (fork) = vu-jit's
627e10e + 9038252 (indirect tail call op).

## Commits
- bc145720 JIT helper calls without JS (CodeGen 627e10e + Ps2VmJs passes function pointers). Measured: no
  difference (VM-thread CPU ms/vbl, play.zip: 44.6/47.4/43.6 base vs 44.9/47.0/43.8).
- 4059d2b2 block chaining (wasm `return_call_indirect`), state-hash checkpoints.
- 0c64428c EE context promotion switch, vblank-range timer, defaults off.

## Design (as implemented)
- `BlockLookupTwoWay` keeps a parallel two-level table of wasm function-table indexes (missing subtables
  share a static all-zero one); `CMIPS::m_blockFnLookup` points to it (EE only, set in CEeExecutor ctor).
- `CBasicBlock::CompileEpilog`: if `nHasException == 0` after nPC is updated, load
  `fn[(nPC>>16)&0x1FFF][(nPC>>2)&0x3FFF]` and `JumpToIndirect()` (new CodeGen op OP_EXTERNJMP_IDX: `if(idx)
  return_call_indirect (type vi) table 1`; table 1 = `env.blockTable` = main `wasmTable`, imported only by
  functions that use it). Index 0 -> return to the dispatcher (compiles there). Same semantics as one more
  executor loop iteration; nPC == running block start, so write-protection invalidation stays correct.
- EE context promotion: `UsesContextPromotion()` also true for EE when enabled (CodeGen 5ca6ca6/e44a2cf;
  functions taking unregistered context references are not promoted, so it is safe by construction).
- Switches (applied to blocks compiled afterwards, part of the block cache key):
  `Module.setEeBlockChaining(bool)`, `Module.setEeContextPromotion(bool)`; bench `&eechain=1&eepromo=1`.

## Test tooling (bench.html + Main.cpp)
- `&hash=N` -> `Module.eeHashAfterLoad(N)`: XXH3 of EE MIPSSTATE+RAM+SPR and IOP state+RAM at each of the
  first N vblanks after the state load (CPS2VM::OnStateLoaded); `mod.eeHashResult()`. With `&vu1thread=0` the
  emulation is deterministic: play.zip/FFX identical every run; car.zip identical in 6 of 7 runs (one
  outlier with the OLD codegen, i.e. pre-existing rare nondeterminism).
- `&time=from,to` -> wall ms between vblanks [from,to) after load (`mod.eeTimeResult()`); with
  `&vu1thread=0&nolimit=1` the workload is identical across runs.
- `&nolimit=1` frame limiter off; `&vu1thread=0` VU1 on the VM thread.
- Scratchpad tools: cdprun.mjs (CDP runner, worker CPU profiles, per-thread CPU from /proc), profagg/tree/
  parents.mjs (cpuprofile analysis), tbench.sh (alternating deterministic timing), cpuab.sh, linknames.sh
  (relink release with --profiling-funcs).

## Correctness
- Hashes identical chaining on/off and promotion on/off: play.zip, car.zip, FFX (300 vblanks each).
- GTA boots from scratch past the intro movies to the 3D cutscene (chaining on, 280 s). play.zip renders,
  FFX (mtvu-ffx.zip) runs 110 s at ~56-58 vbl/s with both switches on (merged build).

## Measurements (play.zip)
- In-game ABAB vbl/s: unusable today (load 5-18 from other work; same build varied 4..30 vbl/s).
- Deterministic timing, vblanks 100-700, VU1 on VM thread, no limiter, ms/vbl over 4 alternating rounds:
  neither 46.8/53.7/44.8/45.1 (median 46.0), chaining 51.9/51.1/45.8/50.1 (50.6),
  chaining+promotion 56.0/48.2/49.3/50.0 (49.7). Spread +-10% even here; no gain visible, chaining maybe worse.
- VM-thread CPU ms/vbl (MTVU off), chaining off vs on (same build): 42.7/39.7, 39.2/39.4, 40.9/39.8 (~-2%).

## Profiles (release + --profiling-funcs, CDP, VM worker)
- Step 1 (MTVU on): JIT blocks 43% self, EmuThread 22.8% self (dispatcher inlined), SyncVu1 wait 9%
  (VM waits for the VU1 thread at vblank: VU1 thread is co-bottleneck in GTA), DMA from JIT stores 8.4%,
  steady-state block compiles 4% (real Jitter runs, not cache hits - unexplained, check with a PROFILE build).
- No `wasm-to-js` between JIT code and memory helpers any more. The remaining `js-to-wasm:*` self time sits
  in the thread entry frame (invoke_vi from __thread_proxy), most likely a sampling attribution artifact,
  not real overhead.
- Chaining (MTVU off): EmuThread self 5.9%, JIT 64% (EE+VU); dispatcher time moved into JIT frames.
  Interpretation: dispatch was cheap already; V8 cross-instance call/tail call cost is similar either way.

## Next
1. Find why blocks are recompiled in steady state (PROFILE build: compiles vs cacheHits; m_cachedBlocks).
2. The JIT code itself dominates: measure per-block hot spots (ee_* names via vu-jit name section) and look
   at codegen quality (memory fast path, 64-bit GPR ops); bigger superblocks/traces would need real
   register allocation across blocks to pay off.
3. VU1 thread is close to saturated in GTA (SyncVu1 waits), so EE-only gains are capped.
4. Re-measure chaining/promotion on a quiet machine with tbench.sh (more rounds) before deleting them.

## Session 2 (2026-10-15 afternoon): codegen analysis, batching, page ops
Branch `ee-jit` = f08f5db1 (Play) / d8c5b47 (CodeGen), web-perf 3925aa4b merged (10746098). Pushed to `fork`.

### Findings (GTA play.zip)
- Profile is flat: 8.6k distinct EE blocks, top 60 = 16% of EE JIT time. PROFILE counters: ~4.5M blocks/s,
  ~32M instructions/s, 7.2 instructions per block.
- Old codegen (25 hottest blocks, wasm-dis): 30 wasm ops per MIPS instruction, 3.6 context loads + 1.9 context
  stores per instruction, 97 wasm bytes per instruction. 40% of the instructions are loads/stores and each was
  ~50-70 ops: page lookup computed twice (Jitter stack must be empty across BeginIf), slow path inline with the
  sign extension/stores duplicated, LQ/SQ slow path = 4 inline helper calls.
- Store forwarding: 32-bit results stored as two i32 (lo, hi) then read with i64.load (BEQ/BNE compares, DADDU)
  -> store-forwarding stall. Block harness (dumped blocks run in Brave against a fake context): -26% body time.
- Many tiny modules: harness with 4096 real blocks called in random order: one module per block ~490 ns/call,
  64 per module ~185 ns/call (V8 code locality: per-module code space + jump table). The cross-instance call
  itself costs only ~3-4 ns more than a same-instance call.
- Steady-state recompiles: none. 0 write-protection invalidations and 0 recompiles of the same address in free
  roam; every steady-state Jitter run is code reached for the first time (persistent cache covers it next session).
- CEeExecutor::Execute self time stays ~26-29% of the VM thread (likely dependent cache misses: lookup table ->
  block -> V8 dispatch table -> jump table) and is not reduced by chaining.
- Code size matters more than context traffic: EE context promotion on top of the new codegen cuts context
  loads/stores to 0.92/0.35 per instruction but grows code to 154 bytes/instr (store/reload around every slow
  path) and is 10-20% SLOWER. Chaining on top of batching: also slower (every round). Both stay off.

### Changes (all hash-identical on play.zip, car.zip, mtvu-ffx.zip, 300 vblanks, VU1 on VM thread)
- CodeGen: two 32-bit context stores of one 64-bit value -> one i64 store.
- CodeGen: OP_LOADFROMPAGE/OP_STOREATPAGE (one wasm if/else per guest access, slow path handler registered with
  CCodeGen_Wasm::SetPageAccessHandlers); front end uses them for LB..LD, SB..SD, LQ/SQ, LWC1/SWC1, LQC2/SQC2.
  New codegen: 21.7 ops/instr, 2.35 ctx loads + 1.21 stores per instr, 72 bytes/instr. Bug found while doing it:
  Jitter CSE merged two page loads with a store in between (page loads now excluded from CSE/copy propagation).
  Switch: Module.setJitPageAccess(mask) / bench `&pageacc=0` (mask bits per access kind, debug).
- CodeGen: canonical type numbering + CWasmModuleBuilder::BuildBatchModule; Play: EE module batching, 64 blocks
  per module by default (Module.setEeBatchSize, bench `&eebatch=N`, 0 = off).
- EE dispatch through the function index table; fall-through-only EE blocks skip the delayed-jump epilogue.
- Tooling: `&eedump=addr,...` (wasm + disassembly of EE blocks), eeStateDump, component state hashes,
  PROFILE counters (eeBlocks/eeInsns/eeInval/eeJit + compile/invalidation log), `eeTimeVblank()` for CPU-time
  windows (scratchpad tools/cbench.sh: VM-thread CPU ms/vbl over the window, renderer pinned to P-cores).

### Measurements (after the 15:45 power-profile switch; VU1 on VM thread, no limiter, vblanks 100-600, ms/vbl,
5 alternating rounds, wall / VM-thread CPU medians; variants emu-eeqbase3 = pre-session ee-jit + web-perf,
emu-eeqg = f08f5db1)
| config | play.zip | car.zip |
|---|---|---|
| base (eeqbase3) | 38.97 / 38.66 | 47.92 / 47.29 |
| batch64, no page ops (eeqg &pageacc=0) | 35.07 / 34.78 (-10%) | - |
| page ops, no batch (eeqg &eebatch=0) | 36.99 / 36.64 (-5%) | - |
| everything (eeqg) | 34.43 / 34.00 (-12%) | 42.85 / 42.27 (-11%) |
(The batch/page rows also include store pairs, index-table dispatch and the fall-through epilogue, which were
not measured alone.) In-game play.zip, MTVU on, limiter on, median vbl/s t=40-72 s: base 34, 34 -> eeqg 40, 40.

### Open
- Cold boot from scratch on the merged tree: the page stops updating during the intro movies (~22-60 s) with
  emu-eeqg AND with the merged baseline emu-eeqbase3; the pre-merge build with batching (emu-eeqc &eebatch=64)
  boots fine for 150 s. Points at the web-perf site-gs merge (OffscreenCanvas GS) in a background CDP tab, not
  at the EE changes; needs checking by whoever owns site-gs.
- Next levers: Execute self time (~29%): bigger compilation units (EE superblocks over PartitionFunction regions
  without promotion), leaner branch epilogue (select instead of nDelayedJumpAddr store + reload).

## Session 3 (2026-10-16): where the "dispatcher" time really goes, EE regions
Branch `ee-jit` on top of f08f5db1 (Play) / d8c5b47 (CodeGen); new work in new commits only.

### Tooling (scratchpad `tools/`, session-specific; the old cdprun/cbench were lost with /tmp)
- `run.mjs '<bench query>' [--pmc] [--wait=s] [--eval=expr] [--shot=png]`: own tab on [::1]:9222, waits for
  &time/&hash results, VM thread = hottest thread of the test Brave, pins the renderer to P-cores (0-7) and
  reports wall ms/vbl, VM-thread CPU ms/vbl, executor dispatches/vbl (`Module.eeDispatchCount`) and, with
  --pmc, hardware counters of the VM thread over the window (`pmc.c`: perf_event_open, user space, cpu_core
  PMU: cycles, instructions, branch misses, L1i/iTLB misses, ICACHE_DATA/TAG stall cycles, L2 code reads).
  `ab.sh <rounds> <state> <variant query>...` alternates variants. Game runs go through `locks/bench-run`.
- Precise attribution without the V8 profiler: a scratch headless Brave (127.0.0.1:9333, own profile with the
  states copied over, `--js-flags=--perf-basic-prof`) + `psample.c` (perf_event_open IP sampling of the VM
  thread) + `/tmp/perf-<pid>.map` -> per-function and per-instruction histograms; `memhelper.py` launches
  that Brave as its child so it can read JIT code from /proc/<pid>/mem (ptrace scope 1) for objdump.
- The machine clock wanders (P-cores 1.2-2.0 GHz under load, other agents running): compare cycles/vbl and
  instructions/vbl from the counters, not only wall ms.

### Findings (play.zip, VU1 on the VM thread, vblanks 150-400, IP samples)
- The ~29% "CEeExecutor::Execute self time" of the V8 CPU profiles was a sampling artifact. With IP samples:
  the executor loop is 7-9% of the VM thread. Inside it (disassembled TurboFan code) the time sits on a chain
  of dependent loads per call: block table (2 loads, ~30%), V8's call_indirect dispatch table (bounds +
  signature, ~20%), V8's code pointer table entry (~30%), the indirect call and the reload after it.
- 8.7% of the VM thread ran EE blocks in Liftoff (+3.5% WasmLiftoffFrameSetup): 7900 batch functions hit
  were Liftoff vs 1200 TurboFan. V8 15.1's tier-up budget is 13M "bytes executed" per function and Liftoff
  spends it by machine code offset at the return, so a ~2 KB block needs ~6000 calls before TurboFan, and
  batching restarts it. Scratch Brave with `--wasm-tiering-budget=1000000`: -6% cycles/vbl. (`--no-liftoff`
  was slower: synchronous TurboFan compiles on the VM thread.)
- Generated code per EE block is large (TurboFan ~2.5-3.8 KB, Liftoff ~2-3 KB machine code for ~7 MIPS
  instructions); L1i misses ~3.6M/vbl, ICACHE_DATA stalls ~10% and ICACHE_TAG stalls ~6% of cycles.
- Branch misses ~0.2M/vbl (~5% of cycles at ~20 cycles each).
- ~246k executor dispatches per vblank (= EE blocks executed, 7.2 instructions each).

### EE regions (on by default: Module.setEeRegionSpan(16384), bench `&eeregion=N`, 0 = off)
- At batch flush (now 128 blocks, `&eebatch`), the pending blocks are sorted by address and runs of live
  blocks within 16 KB (max 64 blocks) become one wasm function. CodeGen `BuildBatchModule(modules,
  functions, exports, REGION_PARAMS)` stitches the existing per-block bodies (decoder for the Jitter's
  instruction subset; locals renumbered per type, so no recompilation): `loop { block x N { br_table on
  ((pc & mask) - start) >> 2 } <block i body> ; if (exception | generation changed) return; next block in
  address order falls through, anything else re-dispatches via the br_table }`. Same semantics as the
  executor loop; blocks that use chaining can't be members (the batch falls back to plain functions).
- Every member keeps its own table slot (no addFunction dedup) to the region function. `CMIPS::m_blockGeneration`
  is bumped by CEeExecutor::ClearActiveBlocksInRange, which also dissolves overlapping regions (members get a
  new instance of their own module); a region function already on the stack leaves at its next block exit.
- Executor dispatches 246k -> ~97k per vblank (61% of block transitions stay inside a function); batch Liftoff
  time 8.7% -> 1.3% (big functions tier up fast); executor loop 8.8% -> 5.9% of the VM thread.
- Offline check: `rtest.cpp` (scratchpad) runs the region builder over all 25.6k EE modules of a block cache
  dump; every body rewrites and all generated modules validate in Node.

### Tried and left off
- `Module.setJitBranchSelect(true)` / bench `&brsel=1`: MIPS branches and the delayed-jump epilogue with
  wasm `select` instead of if/else (hash-identical). More instructions, no cycle gain on play.zip. Off.
  (Needed: OP_SELECT now accepts a constant condition, e.g. `beq zero, zero`.)
