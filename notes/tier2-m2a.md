# Tier-2 JIT, milestone M2a (CFG structurer, VU superblocks)

Status (2026-10-16): structurer done and tested; VU superblocks compiled through it with 0 differential
mismatches. **Superblocks are still slower than promoted single blocks** (about 25-30% on the VU1 replay),
so the dispatch loop was not the cause. M2b (EE regions) is NOT started; see "Decision" and "Next steps".
Design: notes/tier2-jit-design.md (sections 7.1, 15, 16). Previous milestone: notes/tier2-m0.md.

Branches: Play `tier2` (renamed from `tier2-m0`, worktree `play-t2`, web-perf b3f4a74f merged) and CodeGen
`tier2` (renamed from `tier2-m0`), both pushed to the fork.

## Structurer (CodeGen 3dfa0d0)
- `CCodeGen_Wasm::SetStructuredControlFlow(bool)`, off by default (tier 1 keeps `BuildLabelFlows`).
- `EmitStructured`: nodes = the Jitter's basic blocks (label, statements, optional OP_JMP/OP_CONDJMP, else fall
  through). Reverse postorder, Cooper-Harvey-Kennedy dominators, then Ramsey's dominator-tree emission
  ("Beyond Relooper"): back-edge targets get a `loop`, dominator-tree children with 2+ forward in-edges get a
  `block` closing just before them (latest in RPO outermost), back edges and edges to merge nodes are `br`,
  other forward edges inline the target's subtree. The function body sits in an outer block (exit = `br` to
  it). OP_CONDJMP becomes `if (don't jump) {fall-through edge} else {jump edge}` using the existing emitter.
  Irreducible graphs throw `std::runtime_error`. About 250 lines.
- Tests: `StructuredFlowTest` (nested loops, exit out of both loops, diamond inside a loop, irreducible
  rejection) and the wasm test suite now runs every test twice, the second time with the structurer on.
  All pass (`build_cmake/build/wasm-cgtest`, run `node -e 'require("./CodeGenTestSuite.js")()'`).

## VU superblocks through the structurer (Play)
- `CVuBasicBlock::CompileSuperBlock`: no dispatch loop. Each part gets a label; after a part,
  `if(nHasException == 0)` compares `nPC - base` with the offsets of its static successors that are parts
  and `goto`s their labels, else exits. Parts carry their static successors (`SUPERBLOCK_PART::successors`,
  filled by `PlanSuperBlock`).
- `PlanSuperBlock` rejects part graphs that are not reducible (bitmask dominators, <= 16 parts), so the
  backend never sees an irreducible graph.
- `CompileToStream` turns the structurer on for superblocks; superblock cache variant 0x20000000 ->
  0x24000000 so persisted dispatch-loop code is not reused.
- Replay benchmark prints superblock entries/program and parts/entry (counters in `m_jitFlagScratch[5]`/`[3]`).
  Replay experiment bit 0x100 (`setVuExperiment(0x100)`): superblocks without context promotion.

## Results
Differential test (`&vujit=1,1&vusb=1&vu1thread=0&blockcache=0&hash=40`, build emu-t2sb):
| scene | block runs | mismatches |
|---|---|---|
| play.zip | 549k | 0 |
| car.zip | 657k | 0 |
| gow-fight.zip | 4.27M | 0 |
(Diff mode with superblocks runs ~0.2-0.5 vblank/s; the status line shows vbl=0 while it progresses.)

VU1 replay (play.zip, fresh 300-program capture per run, 40 iterations, us/program; rounds alternate):
| run | reference | promoted | superblocks |
|---|---|---|---|
| old build t2rel (dispatch loop) | 29.4 / 30.1 / 30.8 | 27.2 / 25.5 / 24.9 | 35.2 / 31.1 / 32.3 |
| t2sb (structurer) run 1 | 22.7 / 24.3 / 23.4 | 19.6 / 19.5 / 19.5 | 28.2 / 26.3 / 26.1 |
| t2sb run 2 | 30.8 / 30.9 / 29.5 | 25.2 / 25.1 / 28.1 | 31.7 / 32.6 / 32.8 |
| t2sb, 400 iterations | 31.3 / 31.0 / 30.7 | 25.9 / 26.4 / 26.6 | 32.6 / 32.6 / 31.5 |
| t2sb, superblocks unpromoted (0x100) | 29.6 / 29.8 / 31.7 | 25.9 / 26.0 / 24.9 | 34.5 / 32.4 / 32.2 |
- Superblocks: 22.3 entries/program, 14.3 parts/entry. The structure works: ~320 block transitions per program
  become ~22 function calls. Yet superblocks cost +25-35% over promoted single blocks, as with the dispatch
  loop (old build +22-30%). The longer timed window (400 iterations) gives the same ratio, so it is not tier-up.
- Without promotion superblocks are about as slow as with it: promotion buys ~17% in single blocks and ~0 in
  superblocks.
- Each part costs ~10-20 ns more inside a superblock than as its own function. Block calls themselves are cheap
  (call_indirect ~5 ns, vu-jit.md), so absorbing them cannot pay for that.

State hashes (`&hash=300&vu1thread=0&nolimit=1&blockcache=0`, emu-t2sb): identical with superblocks off and on,
and equal to the M0 published-build digests: play.zip c936a1d9d596 (both), car.zip 58750a0d17a4 (both).

Variant: `public/emu-t2sb` (release build of `tier2`; superblocks off by default, `&vusb=1` turns them on).
Tools (scratchpad t2/): run.mjs now aborts after 30 s without progress, captures console/exceptions (`logs`),
and takes `--evala=<async expression>`; replay.js = capture 300 programs then replay (us/program per round).

## Decision
The M2a gate ("structured multi-block functions with promoted locals are faster in TurboFan") is **not met**
on VU: correctness is fine, speed is worse. Risk #1 is real for this code shape. M2b should not start as
designed until the cause is understood, because EE regions are the same shape (many blocks, promoted state,
loops) and the expected gain (~19% of the VM thread from fewer dispatches) is smaller than the per-part
penalty measured here would eat if it carries over.

## Next steps
1. Find the per-part penalty (cheapest first):
   - Offline: dump one hot superblock module and its parts' standalone modules (`&vujit=p,d,1` names), run them
     in node/d8 with `--print-wasm-code`/`--trace-turbo` and compare instruction counts, spills and moves per
     part. Suspects: register allocation over large functions with many v128 locals (phis at every merge),
     spill code at loop headers, missing load elimination across the `if` merges that the dispatch compares add.
   - Variants to time with the replay: no flag forwarding in superblocks; dispatch comparison replaced by
     direct jumps from the epilogue's taken/not-taken arms (nPC is known on each arm); MAX_PARTS 2/4/8.
2. If the penalty is in TurboFan's handling of big functions, regions need caps chosen by measurement (the M0a
   data shows 16/128 still gives 73% internal transitions on GTA) or Binaryen preprocessing (M6) moves earlier.
3. If it goes away: re-run this replay, then start M2b (EE region former, region epilog/exits, invalidation)
   with the structurer as is.
