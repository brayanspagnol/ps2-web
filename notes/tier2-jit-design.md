# Tier-2 optimizing JIT in the browser: design

Status: design only, nothing implemented. Written 2026-10-16 against `play-src` (branch `web-perf`,
cd7a2a58, which includes ee-jit f08f5db1) and CodeGen d8c5b47. This replaces ROADMAP Phase 4
(offline per-game recompilation) and covers Phase 3's superblocks and second tier.
Code references are `file:line` in `play-src/` (CodeGen paths are under `play-src/deps/CodeGen/`).

## TL;DR

- **Tier 1** is today's JIT: one Jitter function per guest block, fast to compile and persisted in
  `BlockCache`. It is unchanged.
- **Tier 2** finds hot code by sampling the EE PC from a spare thread, which costs the VM thread
  nothing. A background pthread groups the hot code into **regions**. A region is one entry plus the
  blocks statically reachable from it inside one MIPS function, capped in size. Tier 2 translates
  each region again from guest RAM, using the **same front end and Jitter IR** as tier 1. It then
  compiles the region into **one wasm function** with:
  - the PC treated as a constant;
  - direct structured branches between blocks;
  - MIPS GPRs kept in wasm locals across the whole region;
  - no per-block dispatch or context traffic inside the region.

  The VM thread checks the code hash and page protection, instantiates the module and switches the
  entry's slot in the function-index table. Results are stored in `BlockCache` under a new category,
  so the second session starts optimized.
- The hard parts are in CodeGen:
  1. a general CFG structurer for the wasm backend, which today only handles if/else plus one loop;
  2. *helper effect classes*, so that memory slow paths no longer spill and reload every promoted
     register. That spilling is what made EE context promotion 10-20% slower in ee-jit.
- **Expected gain:** 1.2-1.8x on the VM (EE) thread, most likely about 1.45x. That is about what GTA
  SA free roam needs to reach 50 vbl/s. Below that the gain is capped by the VU1 thread, which then
  needs its own tier 2.
- **First milestone (M0, 3-4 days):** measure how many block transitions regions could absorb, and
  try the effect-class fix on tier 1. Neither step needs the worker infrastructure, and either can
  stop the project early.
- **VU1:** do not start with VU1 for value, because it is not the bottleneck today. Use VU superblocks
  as the first client of the new CFG structurer (M2a), because VU has the best test harness.

## 1. Goal and constraints

- Anyone opens the link and plays. Nothing is installed, no native toolchain is needed, and nothing
  derived from game code is distributed. All optimization therefore runs in the user's browser, on
  their own dump. The only thing that persists is the user's own OPFS cache.
- Correctness first. Tier 2 must be **bit-identical** to tier 1 in emulated behaviour: the same cycle
  accounting, the same exit points and the same memory side effects. That makes the existing
  deterministic state-hash test (`&hash=N`) a complete oracle.
- The VM thread is the scarce resource, and spare cores are idle (ROADMAP "Where the time goes";
  mtvu.md per-thread CPU). Every expensive step (planning, translation, optimization) runs on another
  thread. The VM thread only verifies and installs the result.

## 2. Where the time goes, and what tier 2 attacks

Numbers for GTA SA free roam (play.zip) are taken from notes/ee-jit.md, notes/mtvu.md and
notes/vu-jit.md.

| VM thread share | Item | Tier 2 effect |
|---|---|---|
| ~40-43% | EE JIT code: 21.7 wasm ops, 2.35 context loads and 1.21 context stores per MIPS instruction, 72 B/instr (after ee-jit; it was ~30 ops before) | Faster code: GPRs in locals, constant PC, no epilog `nDelayedJumpAddr` round trip |
| ~23-29% | `CEeExecutor::Execute` self time: 4.5M blocks/s, so about 60 ns per dispatch; not reduced by chaining | Removed for transitions that stay inside a region |
| ~30-35% | Front VIF1 ~9%, DMA from JIT stores ~8%, SyncVu1 wait ~9%, IOP/SPU/GIF, HLE syscalls | None |

Profile shape: 8.6k distinct hot EE blocks, the top 60 account for 16% of JIT time, 7.2 instructions
per block, 32M instructions/s. Speeding up a few hot spots will not help. Tier 2 must cover thousands
of blocks automatically, which is why compilation runs in the background and results persist.

Lessons already learned in this repo that constrain the design:
- **Code size dominates.** EE context promotion cut context traffic to 0.92 loads and 0.35 stores per
  instruction, but it grew code to 154 B/instr and ran 10-20% slower. The growth came from
  `EmitPromotedStoreDirty` / `EmitPromotedLoadAll` around every page-access slow path
  (`Jitter_CodeGen_Wasm.cpp:551,584,638,665`).
- **Do not build a dispatch loop.** VU superblocks were 10% *slower* than plain blocks. They had to be
  compiled as a single loop that tests `nPC` before each part (`ee/VuBasicBlock.cpp:73-147`), because
  the wasm backend only structures if/else, one loop and fall-through
  (`Jitter_CodeGen_Wasm.cpp:714`, `MarkLabel` at :1271). Every promoted local became loop-carried in
  TurboFan. v86 reports the same issue: "browsers handle deep br_tables and function-wide locals
  poorly". Regions therefore need real structured control flow.
- **Chaining did not help.** `return_call_indirect` between blocks moved the dispatcher's time into
  JIT frames instead of removing it. Only staying *inside* one function removes the cost.
- **Many small modules are slow.** Batching 64 functions per module cut call cost from 490 to 185 ns
  in the harness. Tier-2 output should be batched too.

## 3. Architecture

```
 VM thread (EmuThread)                     tier-2 thread (pthread)                 OPFS (JS frontend)
 ─────────────────────                     ───────────────────────                 ──────────────────
 dispatcher: fnTable[pc] ──┐               sampler: reads EE nPC every ~200 µs
   tier-1 block or region  │               hot entries ─► region former (static CFG on a
                           │                               RAM snapshot, protected pages only)
 m_mailBox (PS2VM.cpp:954) │               translate: shadow CMIPS + CMA_EE/COPs + CMipsJitter
   ◄── install(region) ────┼────────────── (thread_local) ─► Jitter IR ─► CCodeGen_Wasm (regions)
   verify hashes + pages   │                               ─► wasm bytes (+ optional Binaryen)
   CreateWasmBatch         │
   fnTable[entry] = idx ───┘
 invalidation hook ──► drop regions on page               BlockCache::Add(ee2 key, desc+bytes) ──► segments
 BlockFactory ──► BlockCache ee2 lookup (warm start)
```

## 4. Hot detection

- **Production:** sample the EE PC from the tier-2 thread. `m_State.nPC` lives in shared wasm memory.
  Tier-1 blocks only write it in their epilog, so a racy read returns the start of the running block
  or the next one, weighted by time. That is the profile we want. There is already a PC sampler in
  PROFILE builds (`CProfiler::SetPcSampler`, `Profiler.cpp:98`, wired in `PS2VM.cpp:940`). Reuse it as
  a small loop on the tier-2 thread:
  - read `nPC` every ~200 µs (about 5k samples/s, sleeping via `usleep`/Atomics.wait);
  - keep a hash map from address to decayed count;
  - every ~250 ms, queue entries above the threshold that have no region yet.

  The VM thread pays nothing. Regions extend to unsampled neighbours through the static CFG (§5), so
  the flat tail of the profile is still covered.
- **Test modes (deterministic):**
  - `tier2=all` compiles a region for every tier-1 block at creation, synchronously on the VM thread
    (from `CEeExecutor::BlockFactory`, `ee/EeExecutor.cpp:265`).
  - `tier2=sync` uses an execution counter in the dispatcher and compiles synchronously when it trips.

  Both make region choice and install time a pure function of the emulated execution, so a hash
  mismatch reproduces exactly.

## 5. Regions: granularity and coverage

A region is **one entry address E** plus the blocks statically reachable from E. It is compiled to
one wasm function that is entered only at E. Other hot addresses inside it get their own regions;
duplication is accepted. There is no `br_table` entry switch.

Region formation is a pure function of instruction words and options, so it can run on the worker:
- Block boundaries use the same rule as tier 1 (`GenericMipsExecutor.h:237`, `PartitionFunction`),
  including the rule that excludes a branch sitting in a delay slot. Tier-2 blocks are therefore
  exactly tier-1 blocks.
- Starting at E, do a breadth-first walk over static successors: fall-through, conditional and
  unconditional branch targets, and `J` targets.
- **Terminators** (the block ends the region, with an exit): JR/JALR (dynamic target), SYSCALL,
  BREAK, ERET and other COP0 control ops that write `nDelayedJumpAddr` (`COP_SCU.cpp:259`), blocks
  that set an exception (VCALLMS), idle-loop blocks (`ee/EeBasicBlock.cpp:32`, GameConfig
  `IdleLoopBlock`), and blocks with a GameConfig FP-rounding override or accurate add/sub hint. The
  last two stay tier-1, because they are rare and keep the cache key simple.
- `JAL` exits the region to the callee in M2. M3 can inline small callees as a `goto`, with a guarded
  `JR RA` (§6.4).
- **Limits** (these are tuning knobs, not constants):
  - ≤ 32 blocks or ≤ 256 instructions per region;
  - successors within ±4 KB of E;
  - only pages that tier 1 currently write-protects. A snapshot of `m_protectedPages`
    (`ee/EeExecutor.h:82`, 8 KB) goes with the job.

  The page rule keeps invalidation behaviour identical to tier 1. Tier 2 never protects a page that
  tier 1 has not, so it never adds new invalidation storms on pages that mix code and data.
- Kernel code below 0x100000 is not protected by tier 1 (`ee/EeExecutor.cpp:269`), which assumes it
  never changes. Tier 2 follows the same assumption, and M1 also excludes this range so the rule is
  simpler.

Coverage target: at least 90% of executed EE instructions run in tier-2 code once warm. The PROFILE
counters measure it, and M0 checks the ceiling first.

## 6. Translation: reuse the tier-1 front end and Jitter IR

**Decision: reuse it. Do not write a separate MIPS translator.** The front end is large and
already proven by the hash tests: `MA_MIPSIV*.cpp`, `ee/MA_EE.cpp` (MMI, 2.2k lines), `COP_FPU.cpp`
(PS2 clamping via `FP_ClampS`), `ee/COP_VU.cpp` + `VUShared` (COP2 macro mode) and `COP_SCU.cpp`.
Tier 2 has to match tier 1 bit for bit, and a second translator would double the semantics to keep
equal. All tier-2 work therefore happens in region assembly on the Play! side and in the CodeGen
backend.

### 6.1 Region assembly (Play side, new `CEeRegionCompiler`)
Each region compiles as **one** `CMipsJitter` function. For every block, in reverse post-order:
1. `MarkLabel(L_b)`, then reset the per-block first/last labels. Add a `BeginBlockLabels()` to
   `CMipsJitter` (`MipsJitter.h:18-38`) so that `BranchLikely`'s `Goto(GetLastBlockLabel())`
   (`MIPSInstructionFactory.cpp:215`) stays local to the block.
2. **Constant PC:** `SetVariableAsConstant(offsetof(CMIPS, m_State.nPC), blockBegin)`. The mechanism
   already exists and makes R0 constant (`MipsJitter.cpp:13,98`). Every `PushRel(nPC)` in the front
   end becomes a constant with no front-end edits: branch targets (`MIPSInstructionFactory.cpp:191,208`),
   J/JAL (`MA_MIPSIV.cpp:290-323`), JALR link (:923), SYSCALL EPC (:954), TLB-check EPC
   (`MIPSInstructionFactory.cpp:68`). A small extension clears or replaces it per block. Tier-2 code
   becomes position dependent: the cache key includes E, and `CEeExecutor::m_cachedBlocks` sharing by
   content (`ee/EeExecutor.cpp:316-331`) must never copy tier-2 functions.
3. Compile the instructions through `m_pArch->CompileInstruction` exactly as `CBasicBlock::CompileRange`
   does (`BasicBlock.cpp:404`).
4. A **region epilog** replaces `CBasicBlock::CompileEpilog` (`BasicBlock.cpp:436`) and keeps its
   semantics exactly:
   - `cycleQuota -= n_b`; if `cycleQuota <= 0`, set `nHasException |= QUOTADONE` and exit.
   - If any slow path ran in this block (a local flag, §7.2), test `nHasException` and the code
     invalidation counter, and exit if either fired.
   - Successor: the branch already wrote `nDelayedJumpAddr` with a constant (or `INVALID`). Emit
     `if (nDelayedJumpAddr == T) goto L_T; else goto L_next`, resetting `nDelayedJumpAddr = INVALID`.
     Successors outside the region go to an exit stub.

   With `nDelayedJumpAddr` promoted to a local and the PC constant, TurboFan reduces this to a
   compare and a branch.
5. **Exit stub** for target `T`:
   - write back the promoted symbols;
   - `nPC = T` (or the dynamic value);
   - `nDelayedJumpAddr = INVALID`;
   - return.

   The dispatcher then continues exactly as if tier-1 blocks had run (`ee/EeExecutor.cpp:69-81`).

### 6.2 Semantics checklist

- **Delay slots:** no special handling. A block ends after its delay slot and region edges sit at
  block ends, as in tier 1. Branch-likely uses its per-block last label.
- **Indirect jumps (JR/JALR):** the region exits with `nPC = target`. The dispatcher's two-level
  `fnTable` is the hash lookup back into compiled code (`BlockLookupTwoWay.h:128`). M3 option: when
  the `JAL` was inlined in the same region, guard `JR RA` with
  `if (ra == knownReturn) goto L_cont else exit`.
- **SYSCALL / exceptions / COP0:** handled as terminators. SYSCALL writes EPC (a constant) and
  `nHasException`, and the region exits after the block. `CSubSystem::ExecuteCpu`
  (`ee/Ee_SubSystem.cpp:278`) handles it exactly as before. TLB exceptions (`JumpTo(HandleTLBException)`)
  only appear when the translator is not `TranslateAddress64`. In that case the function returns
  immediately and a JumpTo inside a region becomes "flush and return". MTC0/EI/DI are allowed
  mid-region, but COP0 symbols are never promoted (§7.2).
- **Cycle counting, quota and interrupts:** quota is decremented per block, with the same exit points
  as tier 1. Interrupts are raised by I/O handlers setting `CHECKPENDINGINT`
  (`ee/Ee_SubSystem.cpp:705`) or `IDLE` (:588). They are seen at the end of the block that triggered
  them, as in tier 1.
- **64/128-bit GPRs and MMI:** symbols are what the front end already emits: 32-bit lanes, 64-bit and
  128-bit. Promotion containers (`Jitter_CodeGen_Wasm.cpp:1846`, `PreparePromotion`) become:
  - an i64 local for a GPR only touched as 32/64-bit;
  - a v128 local when the region uses 128-bit accesses (LQ/SQ/MMI/PCPYUD...), with lane
    extract/replace.

  M3 adds a front-end peephole so the "lo = x; hi = x >> 31" pair (ADDIU and similar) becomes one i64
  sign-extending definition. This is the locals version of ee-jit's store-pair fix.
- **FPU:** unchanged front end, so the PS2 clamping (`FP_ClampS`) and the accurate add/sub hint are
  identical. The rounding mode is identical too: wasm has round-to-nearest only (OPTIMIZATION.md
  "FP rounding"), and blocks with a rounding override stay tier-1.
- **COP2 macro (VU0):** unchanged front end. Helpers called from it default to the "all effects" class
  (§7.2). VCALLMS is a terminator.
- **Memory:** `OP_LOADFROMPAGE` / `OP_STOREATPAGE` exactly as in tier 1 (`MIPSInstructionFactory.cpp:157-166`).
  Stores go through `m_pageLookupWrite`, so the software write protection (`ee/EeExecutor.cpp:372`)
  works unchanged. Extra in tier 2:
  - cache the `m_pageLookup` / `m_pageLookupWrite` table pointers in locals for the region (the
    pointers never change; the entries are still loaded per access);
  - let TurboFan fold constant addresses (LUI-based) through locals.

## 7. Code generation (CodeGen)

### 7.1 General CFG structuring in `CCodeGen_Wasm`
Replace the pattern matcher (`BuildLabelFlows`, `Jitter_CodeGen_Wasm.cpp:714-880`) with a general
structurer **for region functions**. Tier 1 keeps the old path until the new one is proven.
- Build the CFG from the concatenated statement list (labels, `OP_JMP`, `OP_CONDJMP`), then compute
  reverse post-order and dominators.
- Emit with Ramsey's dominator-tree algorithm ("Beyond Relooper", ICFP 2022), the same idea as LLVM's
  `WebAssemblyCFGStackify`:
  - a loop header becomes `loop`;
  - a merge node becomes an enclosing `block`;
  - forward edges become `br` to the block end;
  - back edges become `br` to the loop.

  This takes roughly 300-500 lines.
- **Irreducible CFG:** the region is rejected and the entry stays tier-1. MIPS code from compilers is
  almost always reducible.
- The Jitter already optimizes each basic block in isolation (`Jitter_Optimize.cpp:140-216`). Work
  across blocks (constants, redundant loads) is left to TurboFan's SSA, which sees locals instead of
  linear memory.
- Tests: extend `deps/CodeGen/tests` (GotoTest, LoopTest already exist) with nested loops,
  multi-exit loops, diamonds inside loops and an irreducible rejection case.

### 7.2 Promotion with helper effect classes
EE context promotion already works (`g_eeContextPromotion`, `BasicBlock.cpp:132,597`). In tier 2 it
becomes the "register allocator": wasm locals, with TurboFan doing the real allocation. The flaw is
the full spill and reload around every slow path. Fix:
- `CWasmFunctionRegistry::RegisterFunction` (`Jitter_CodeGen_Wasm.cpp:209`) and the page-access
  handlers (`SetPageAccessHandlers`, registered at `ui_js/Ps2VmJs.cpp:47-75`) get an **effect class**:
  - `NONE`: the helper reads and writes no promotable guest state. This covers the page-access slow
    paths (`MemoryUtils_*Proxy`, `MemoryUtils.cpp:8-165`) and LWL/LWR/SWL/SWR proxies (values are
    passed as arguments).
  - `ALL`: the default. Spill dirty symbols, call, reload.
- **Non-promotable symbols** are those that `NONE` helpers may touch:
  - `nPC`: the I/O read handler uses it for idle detection (`ee/Ee_SubSystem.cpp:584`), and the
    write-watch handler uses it to find the running block (`GenericMipsExecutor.h:128`). It is a
    constant in regions; the cold branch stores the current block's start right before the call.
  - `nHasException` (set by I/O handlers).
  - `nCOP0[]` (STATUS is read by `IOPortWriteHandler`).

  Play registers these offsets with the backend, the same way it registers context arrays today.
- Slow-path calls in a region set a local `slowPathTaken` flag. The block epilog tests
  `nHasException` and the invalidation counter only when the flag is set (§6.1, §10).
- **Checker mode** (debug switch): `NONE` calls also flush first, and a wrapper hashes `MIPSSTATE`
  before and after the call. If the hash changes, or if flush-on/flush-off runs give different
  `&hash` results, a handler is breaking the contract.

This change also helps tier 1 (M0b). It may make EE promotion profitable there, since the reason it
lost was the spills.

### 7.3 Size, compile time, Binaryen
- Region caps (§5) bound the function size and locals. The target is under ~20 KB of wasm per region.
- **Binaryen** (binaryen.js in the tier-2 worker, `readBinary` → `optimize` → `emitBinary`) is optional
  (M6). TurboFan already does SSA, GVN, constant folding and register allocation on locals.
  Binaryen's real value would be smaller code, meaning faster Liftoff/TurboFan and better i-cache use.
  The npm package is large (depscope: about 14 MB minified, 2.7 MB gzipped), so it is loaded lazily
  and only if measurements justify it.

## 8. The tier-2 worker

- It is an emscripten pthread (`std::thread`), so it shares the wasm memory and all C++ code.
  `PTHREAD_POOL_SIZE` is 6 (`ui_js/CMakeLists.txt:59`); count live threads and raise it by one. A pool
  of 2 deadlocked earlier (OPTIMIZATION.md). On machines with `hardwareConcurrency <= 4`, use one
  worker with a duty-cycle limit.
- **Guest code:** the worker copies each region's instruction words from EE RAM (shared memory) into a
  snapshot. The read is racy on purpose, which is fine because the VM thread re-checks the hash at
  install. It computes XXH3 per block, as `BlockFactory` does (`ee/EeExecutor.cpp:285`).
- **IR:** the worker rebuilds it itself. No IR crosses threads. It owns:
  - a shadow `CMIPS`, whose `CMemoryMap` instruction map points at the snapshot and whose
    `m_pAddrTranslator`, `m_TLBExceptionChecker` and `m_pageLookup` (non-null flag) match the EE
    (`ee/Ee_SubSystem.cpp:115-123`);
  - its own `CMA_EE`, `CCOP_SCU`, `CCOP_FPU` and `CCOP_VU` instances. These objects hold per-compile
    state (`SetupQuickVariables`, `MIPSInstructionFactory.cpp:25`), so they cannot be shared with the
    VM thread.

  The Jitter is already `thread_local` (`BasicBlock.cpp:566`). Per-block options come with the job:
  compile hints, plus copies of `m_blockFpRoundingModes`, `m_blockFpUseAccurateAddSub` and
  `m_idleLoopBlocks`.
- **Thread-safety audit:**
  - read-only after startup: `CWasmFunctionRegistry::m_functions` and the page-access handlers;
  - read when compiling: the globals `g_jitPageAccess` and `g_eeContextPromotion`;
  - VU only: `VUShared` flag forwarding state (check it is thread-local before compiling VU on the
    worker).

  The worker produces **bytes only** (`CMemStream`) and never touches JS objects or tables.
- **Output:** wasm bytes, plus a region descriptor (entry, block ranges, per-block XXH3-64), handed to
  the VM thread with `m_mailBox.SendCall(f)` (non-blocking, `MailBox.h`). The worker's own job queue
  is another `CMailBox` waited on with `WaitForCall`.

## 9. Install and hot swap (VM thread)

Each wasm worker has its own function table and JS `Module` (mtvu.md), and the VM thread never
returns to its event loop. Two consequences:
- A worker cannot `postMessage` a compiled `WebAssembly.Module` to the VM thread, because it would
  never be delivered.
- The VM thread must therefore compile the module synchronously, exactly as tier 1 does today:
  `CMemoryFunction::CreateWasmBatch` → `WasmCreateBatch` (`MemoryFunction.cpp:62`), with `env.memory`,
  `env.fctTable` and `env.blockTable` imports, then `addFunction`.

The bytes are valid on this thread because helper imports are indexes into the per-thread
`Module.codeGenImportTable`, which is filled in the same fixed order on every thread
(`ui_js/Ps2VmJs.cpp:20-75`). `BlockCache` already relies on this.

Install steps, run between blocks in `EmuThread`'s mailbox loop (`PS2VM.cpp:952-957`), so it is
atomic without locks:
1. Drop the job if the executor epoch changed (Reset or state load).
2. For every block in the descriptor, hash the current RAM words and compare. Check that every page is
   still in `m_protectedPages`, and that the tier-1 block at E still exists. Any failure discards the
   region (its code changed in between).
3. Instantiate (batched, up to N regions per module) under a time budget per vblank (start at
   ~1 ms). Tier 1 measured COMPILE_WASM at 0.03-0.05 ms per block module; region install cost must be
   measured in M1. V8 compiles with Liftoff synchronously and tiers up to TurboFan in background
   threads.
4. Attach the region to the tier-1 `CBasicBlock` at E as a new member `m_tier2` (`CMemoryFunction`).
   `GetFunctionIndex()` (`BasicBlock.h:117`) returns the tier-2 index when one is attached, so
   `AddBlock` and `UpdateFunctionIndex` (batching, `BlockLookupTwoWay.h:61,91`) cannot overwrite it.
   Set `fnTable[E]`. `CBasicBlock::Execute` (`BasicBlock.cpp:660`) calls `m_tier2` when present, so
   PROFILE and DEBUGGER builds, which use the generic loop, run tier 2 too.
5. Add the region to a `page → regions` index covering every page it spans.

## 10. Invalidation

- **Writes from JIT code:** `WriteWatchHandler` → `InvalidateWrittenRange` → `ClearActiveBlocksInRange`
  (`ee/EeExecutor.cpp:91,144,258`).
- **Writes from C++** (DMA, HLE): `NotifyRamWritten` (:102).
- Both paths add one hook: for each invalidated page, detach every region in `page → regions`
  (restore `fnTable[E]` to the tier-1 index, or 0 if that block is gone), increment
  `g_codeInvalidationCount`, and unprotect as today. Regions are dropped even when their entry block
  lives in another page; that is why the page index exists.
- **A region invalidating its own code while running:** the slow-path wrapper returns, the region
  finishes the current guest block (as the running tier-1 block does today), sees `slowPathTaken`, and
  exits because the invalidation counter changed. In wasm it is safe for the region's table slot to be
  freed and reused while its frame is live.
  - Debug builds assert that a block exists at `nPC` (`GenericMipsExecutor.h:128`). For internal
    blocks without one, relax the assert to allow an empty block.
- **Reset and state load:** `CEeExecutor::Reset` clears regions and bumps the epoch.
- **Invalidation storms:** count invalidations per page. A page invalidated more than K times in T
  seconds stops being tier-2 eligible. PCSX2 solves the same problem with "manual protection" (blocks
  check their own code at entry) for pages written often; that is a later option.

## 11. Persistence (BlockCache)

- New category `0x65653200` ("ee2"). The key hash is XXH3-128 over: entry E, block ranges, all
  instruction words, and per-block options. `variant` carries the codegen switches plus a region
  format version. The value is the descriptor followed by the wasm bytes.
- At load, `BlockCache::Load` also builds an index `E → [keys]` for ee2 entries (a small addition to
  `BlockCache.{h,cpp}`).
- **Warm start:** when `BlockFactory` creates the tier-1 block at E, look up the ee2 candidates for E
  and run install steps 2-5 immediately (rate-limited). The game starts with tier-2 code for
  everything it ran last time.
- The salt from the `Play.wasm` ETag/size and the per-entry checksums work unchanged (OPTIMIZATION.md
  "Storage"). Any codegen change produces a new build, which discards old entries. The 96 MB cap
  still applies; ee2 needs an estimated 5-10 MB per game.

## 12. Correctness tooling

1. **State hashes** (`ui_js/Main.cpp:74`, `&hash=N&vu1thread=0`, deterministic):
   - tier 2 off vs `tier2=all` vs `tier2=sync` on play.zip, car.zip and mtvu-ffx.zip, 300 vblanks;
     results must be identical;
   - normal background mode must also match. Install timing varies there but semantics do not, which
     makes it a good stress test.
2. **Bisection:** `Module.setTier2Range(lo, hi)` / bench `&t2range=lo,hi` limits which entries may get
   regions. A script halves ranges until it finds the first diverging region. This is deterministic in
   `all`/`sync` modes.
3. **Dumps:** extend `&eedump=` (`BasicBlock.cpp:161,215`) to regions: descriptor, MIPS disassembly per
   block and wasm.
4. **Effect checker mode** (§7.2).
5. **CodeGen unit tests** for the structurer (§7.1).
6. **Performance:** deterministic timing `&time=100,600&vu1thread=0&nolimit=1` and VM-thread CPU
   ms/vbl (cbench.sh / tbench.sh, alternating rounds as in ee-jit.md), plus in-game vbl/s. Add PROFILE
   counters:
   - regions installed and rejected (with the reason);
   - instructions executed in tier 2 vs tier 1;
   - dispatches per second;
   - install ms.

## 13. Expected gain

Model of the VM thread in GTA free roam, today = 1.0: EE code E ≈ 0.42, dispatcher D ≈ 0.25, other
O ≈ 0.33. Tier 2 covers a fraction c of EE instructions, speeds covered code by s, and turns a
fraction i of block transitions into internal branches.

| | c | s | i | VM thread time | Speedup |
|---|---|---|---|---|---|
| Pessimistic | 0.80 | 1.3 | 0.40 | 0.26 + 0.08 + 0.15 + 0.33 = 0.82 | 1.22x |
| Central | 0.90 | 1.75 | 0.70 | 0.22 + 0.04 + 0.09 + 0.33 = 0.68 | 1.47x |
| Optimistic | 0.95 | 2.5 | 0.85 | 0.16 + 0.02 + 0.05 + 0.33 = 0.56 | 1.79x |

Reasoning behind s:
- Today's code is 21.7 ops/instr, including 3.56 context memory ops.
- With GPRs in locals, a constant PC and no epilog `nPC`/`nDelayedJumpAddr` traffic, ALU instructions
  drop to roughly 3-6 ops and memory instructions to ~10-14 (page lookup and branch remain). Since 40%
  of instructions are memory accesses, the mix comes to ~8-12 ops/instr.
- TurboFan already handles today's context loads as cheap L1 hits, so time falls less than op count.
- The VU promotion result in this repo (1.22x, where flag rings dominate) and the ee-jit block harness
  (-26% from fixing store forwarding alone) put the plausible range at 1.5-2.5x.

Reasoning behind i: it is unknown, which is why M0 measures it. Loops and if/else inside functions
become internal; calls and returns stay external unless inlined in M3.

Ceiling: the "other" third does not move. Tier 2 alone cannot exceed about 2x on this thread.

Translated to games:
- **GTA free roam** runs at 34-40 vbl/s in-game after ee-jit, with MTVU on. 50 vbl/s needs 1.25-1.5x
  on the VM thread, so the central estimate reaches it.
- **VU1:** the VU1 thread then needs to run at about 75% (59% busy at about 40 vbl/s, vu-jit.md) up to
  over 100% busy at 50 vbl/s (83% at 30 vbl/s, mtvu.md). VU1 tier 2 (§15) therefore follows EE tier 2.
- **FFX** is already near 58/60 and gains little.

There are no hard numbers from other browser emulators to reuse:
- v86 compiles hot 4 KB pages into one wasm function with a `br_table` entry switch and structured
  control flow (stackifier). It reports that big `br_table`s and function-wide locals hurt, which is
  why this design uses one entry per function and caps sizes.
- qemu-wasm (NTT, 2025 patch series) runs translation blocks in an interpreter and compiles a block
  to wasm after about 1500 executions. It also hit per-module overhead, which we handle by batching.

Both support the tiered shape. Neither publishes a comparable speedup for region-level code.

## 14. Risks (ranked)

1. **TurboFan on big multi-block functions.** Many locals plus loops may cause register-pressure
   spills, longer compiles and slow Liftoff code until tier-up. Mitigations: size caps, promoting only
   symbols used two or more times or in loops, and measuring early. M2a answers this on VU first.
2. **Transitions turn out cheaper or less avoidable than the 60 ns/dispatch suggests.** Part of the
   self time may be a profiler attribution artifact, and short regions pay entry loads and exit stores.
   M0 measures the ceiling, and M2 has a hard gate.
3. **Silent corruption** from a wrong effect class, a missed non-promotable symbol, or a wrong exit
   write-back. Mitigations: default `ALL`, a whitelist only for `NONE`, the checker mode, hashes on 3
   workloads, and bisection.
4. **Install stalls on the VM thread** (synchronous module compile) and growth of V8's code space.
   Mitigations: batching, a per-vblank budget, the persistent cache, and measurement in M1.
5. **Invalidation complexity** (multi-page regions, own-page writes, storms). Mitigations: the
   page→regions index, the "protected pages only" rule, and storm blacklisting.
6. **Few spare cores** on 4-core machines. Mitigations: a duty-cycle limit, and the warm cache, which
   shifts the work to the first session.
7. **Debuggability:** wrong code shows up later and elsewhere. Mitigation: deterministic modes and
   dumps from day one.

## 15. VU1 microprograms

What tier 2 would do for VU1:
- **Unit:** one microprogram region, entered at the MSCAL/MSCNT entry and ending at the E bit (and its
  delay slot). It uses `CVuExecutor::PlanSuperBlock`'s static-successor walk (`ee/VuExecutor.cpp:201`),
  but is compiled with the §7.1 structurer instead of the dispatch loop (`ee/VuBasicBlock.cpp:73`).
- **Extra wins beyond EE:**
  - Lazy flags: MAC, sticky and clip flag-ring writes are dead unless a later FMAND/FMEQ/FMOR,
    FSxxx, FCxxx or FCGET reads them before they are overwritten, or the program ends (the last entries
    are architectural). This is the "only the last ≤5 entries matter" idea from vu-jit.md.
  - Static stall analysis across blocks, instead of the per-block `pipeFmacWrite` checks.
  - Cached programs keyed by micro-memory content survive MPG re-uploads (MPG re-JIT costs ~3% of the
    VU1 thread).
- **Install:** on the VU1 thread, which owns its table, via `CVu1Thread::PushFunction`
  (`ee/Vu1Thread.h:58`).
- **Tests:** VU diff mode (`&vujit=1,1`), the VU1 replay benchmark (`vuCapture`/`vuReplay`) and hashes
  with `vu1thread=0`.

**Should we start with VU1? Not for value.** In both reference workloads the VM/EE thread is the limit,
not VU1. Tier-2 VU1 would show no fps change until EE tier 2 lands (§13). It is, however, the cheapest
**testbed** for the new structurer:
- programs are small with simple CFGs;
- the replay benchmark is deterministic and gives a number in minutes;
- superblock planning and the diff mode already exist.

So M2a structures VU superblocks without the dispatch loop. That tells us within days whether
structured multi-block functions with promoted locals are faster in TurboFan, which is risk #1. The
full VU1 tier 2 waits until the VU1 thread is the limit (M5).

## 16. Milestones

Effort assumes the pace of the ee-jit and vu-jit work (one agent plus review). "Verify" names the gate
each milestone must pass.

| | Scope | Effort | Verify / gate |
|---|---|---|---|
| **M0a** | PROFILE counters for block-transition edges (src→dst counts) on play.zip/car.zip, plus an offline script that simulates §5 region formation: share of internal transitions, coverage, region count and size | 2 days | Decision: if internal transitions < 40%, drop regions and keep only §7.2 (+ per-block constant PC) |
| **M0b** | Effect classes (`NONE` for page-access slow paths, non-promotable `nPC`/`nHasException`/COP0), then re-measure EE promotion in tier 1 | 1-2 days | Hashes identical (3 states); code bytes/instr back near 72; cbench ms/vbl. Ship if faster |
| **M1** | Tier-2 plumbing with single-block regions: worker thread, sampler, shadow context and snapshot, constant PC via `SetVariableAsConstant`, mailbox install with hash/page/epoch checks, `m_tier2` + `GetFunctionIndex`, page→regions invalidation, `tier2=off/on/sync/all` switches, PROFILE counters | 1.5 weeks | Hashes identical in all modes; installs ms/s measured; no perf goal yet |
| **M2a** | §7.1 structurer in CodeGen + unit tests; VU superblocks compiled through it (no dispatch loop) | 1 week | VU diff mode 0 mismatches; replay us/program vs promoted blocks (today 25.9 vs superblocks 28.7) |
| **M2b** | EE regions: region former, region epilog and exits, `slowPathTaken`/invalidation exits | 1.5-2 weeks | Hashes identical; play.zip VM-thread ms/vbl down at least 10% (else stop and analyse) |
| **M3** | Region quality: JAL inlining with a guarded `JR RA`, i64 sign-extension definitions, cached page-table pointers, tuning of caps and the promotion policy, re-test exit tail calls (`OP_EXTERNJMP_IDX`) | 2 weeks | Hashes; ms/vbl; ops/instr from wasm dumps |
| **M4** | Persistence: ee2 category, `E → keys` index, warm-start install | 1 week | Cold vs warm: time to stable fps; hashes |
| **M5** | VU1 tier 2 (§15), when the VU1 thread exceeds ~85% at the target speed | 2-3 weeks | VU diff, replay, hashes |
| **M6** | Optional Binaryen pass in the worker | 3-5 days to evaluate | Code size and compile time vs speed |

The EE path through M4 is about 7-9 weeks. M0 is the first step: 3-4 days that need no
infrastructure, and either half can stop or redirect the project.

## 17. Rejected alternative: offline per-game recompilation (C + clang)

The original Phase 4 idea was:
- record hot blocks;
- emit C, either through a Jitter "C backend" or from a separate MIPS→C translator, in the style of
  N64Recomp, PS2Recomp or XenonRecomp;
- compile with clang -O3 into a per-game wasm side module;
- load it next to the emulator, keyed by content hash, with the JIT as fallback.

Rejected because:
- **It conflicts with the project goal.** Players should open a link and play any game with nothing
  installed. A recomp needs either per-game modules built by someone, or a native toolchain on the
  player's machine, or a clang-in-wasm download of tens of MB plus minutes of compile time.
- **Legal and distribution:** a recompiled module is derived from game code. The project rule is that
  nothing derived from dumps is distributed (ROADMAP "Rules"), so modules could not be shipped.
- **Per-game manual work:** static recompilers need it for jump tables, overlays, self-modifying code
  and threads. PS2Recomp describes itself as experimental, with many stubbed paths and poor VU
  performance. A JIT fallback would be needed anyway.
- **Little left over clang:** the gain clang would bring over TurboFan is mostly alias analysis, which
  is irrelevant once guest registers live in locals. Constant folding, GVN and register allocation
  already happen in TurboFan on the client.

Ideas kept from it:
- content-hash keying of compiled code;
- region and function granularity driven by a profile;
- a constant-PC, position-dependent tier;
- "registers in locals" as the core speedup;
- the differential-testing discipline.

## 18. References

- notes/ee-jit.md, notes/vu-jit.md, notes/mtvu.md, OPTIMIZATION.md, BUILD.md, ROADMAP.md (this repo).
- [v86, "How it works"](https://github.com/copy/v86/blob/master/docs/how-it-works.md): x86 to wasm
  JIT, page-level hot code, one function per module with a `br_table` entry switch and a stackifier
  for control flow.
- [qemu-wasm TCG backend cover letter (qemu-arm, 2025-04)](https://lists.libreplanet.org/archive/html/qemu-arm/2025-04/msg00153.html)
  and the [FOSDEM 2025 slides](https://fosdem.org/2025/events/attachments/fosdem-2025-6290-running-qemu-inside-browser/slides/237638/slides_1dDtpcS.pdf):
  hybrid interpreter plus wasm for hot translation blocks, with the cost of creating many modules.
- N. Ramsey, "Beyond Relooper: recursive translation of unstructured control flow to structured
  control flow", ICFP 2022. LLVM `WebAssemblyCFGStackify`. A. Zakai, "Emscripten: an LLVM-to-JavaScript
  compiler" (Relooper), 2011.
- PCSX2 EE recompiler (iR5900): per-block register caching, constant propagation, cycle counting at
  block ends, and page protection with "manual" self-checking blocks for pages that are written often.
- [PS2Recomp](https://github.com/ran-j/PS2Recomp) (experimental static recompiler), N64Recomp,
  XenonRecomp: static recompilation, kept for §17.
- [binaryen npm package size (depscope)](https://depscope.dev/pkg/npm/binaryen).
