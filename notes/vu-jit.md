# VU JIT on WebAssembly (Phase 3) — work notes

Branch `vu-jit` in worktree `play-vujit` (pushed to `fork`). CodeGen submodule commits are on its
local branch `vu-jit` (upstream remote only, not pushed); same changes as `notes/vu-jit-codegen.patch`
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

## In progress (uncommitted-quality WIP in the last commit)
VU superblocks (idea 3): CVuBasicBlock::CompileSuperBlock compiles several VU blocks into one function: dispatch
loop on (nPC - entry nPC) using only Jitter ifs + its single loop; each part = normal block body + epilogue;
back edges goto the loop, forward parts fall through, anything else returns. Part counter in m_jitFlagScratch[3]
for the differential test (CVuBasicBlock::ExecuteDiff runs N reference blocks one by one).
NOT DONE / NOT BUILT yet:
- CVuExecutor: factor block-end computation out of PartitionFunction (FindBlockEnd), plan parts in BlockFactory
  (BFS from head over static successors, parts inside [head, head+0x1000), <=16 parts; skip blocks with
  compile hints/no-clamping keys, branch-in-delay-slot and E-bit-in-delay-slot blocks), key/hash over
  [head, maxEnd], SetSuperBlockParts, SetReferenceBlockProvider (map of reference blocks compiled with
  m_forceReference, cleared in ClearActiveBlocksInRange/Reset), m_diffDataSize.
- Global toggle (g_vuSuperBlocks) + bench param; build; diff test; replay A/B.

## Next steps
1. Finish superblocks as above; verify 0 mismatches; measure replay + PROFILE VUBLOCK.
2. Then: measure EE effect of the helper-call fix; consider promotion for EE blocks (needs diff harness for EE).
3. Flag ring writes: only last <=5 entries matter for later queries (needs query-equivalence diff instead of
   byte equality).
