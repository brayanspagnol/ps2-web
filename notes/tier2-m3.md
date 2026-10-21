# Tier-2 JIT, milestone M3 (faster EE code)

Status (2026-10-21): work split in two.
1. **Branch hints (standalone, ready to publish):** Play `brhint` 63fffd4b (on web-perf e0e7c919), CodeGen
   `brhint` 8231ffa (on 41bed41). Both pushed to the fork, not merged.
2. **Region rework (M3 proper):** Play `tier2` 1ddf3438, CodeGen `tier2`. Pushed, off by default, not ready:
   region creation cost is still too high.

## Main finding: V8 spills everything around the memory slow path call
x86 code from TurboFan for dumped GTA blocks (node 24 `--print-wasm-code`, 60 hot tier-1 blocks and 40 hot
regions):
| | wasm B/instr | x86 B/instr | stack slot refs/instr |
|---|---|---|---|
| tier-1 blocks | 67.5 | 117 | 3.45 |
| regions (GPRs promoted) | 59.7 | 141 | 7.85 |

V8's wasm calling convention has no callee-saved registers. Every guest load/store has an inline fast path
and a `call_indirect` slow path in the same function. Without a hint, TurboFan does not treat the slow path
as cold, so values that live across it are spilled on the fast path too. That is why promoting GPRs to locals
(M0b, M2b, and this milestone) never paid off: the locals end up on the stack.

The fix is the wasm branch hint custom section (`metadata.code.branch_hint`), which marks the fast path
`if` as likely. Brave 151 (V8 15.1) applies it with no flag; node 24 only does with
`--experimental-wasm-branch-hinting`. TurboFan then moves the slow path into deferred code.

## 1. Branch hints (standalone)
- CodeGen: `CCodeGen_Wasm` records the offset of each page-access `if` (load and store fast paths).
  `CWasmModuleBuilder::WriteModule` writes the hint section before the code section; offsets are relative to
  the start of the function body, local declarations included. `BuildBatchModule` keeps the hints when it
  merges functions into batch modules, re-indexed per function. That covers the VM-thread batches, the
  async-compile batches and block-cache loads. `CCodeGen_Wasm::SetBranchHints(bool)`, on by default.
- Play: `g_jitBranchHints = true`. `Module.setJitBranchHints(bool)` (bench `&brhint=0|1`) applies to blocks
  compiled after the call. Turning hints off sets block cache variant bit 0x01000000, so cached code is never
  mixed.
- Hashes (`&hash=300&vu1thread=0&nolimit=1`, variant `public/emu-brh2`): car 55dab76e, play 1f851c1c,
  mtvu-ffx 5927b89c, gow-fight 77f177fc, gow-intro b2119704. All equal to the baselines.
  - car also matches with `&blockcache=0` and with `&brhint=0`.
  - One car run on an earlier build of the same change gave a63e250f once, on its first, cold-cache boot.
    The repeat matched, and two cold `blockcache=0` runs matched. It looks like the known rare car/GoW
    nondeterminism (M2b notes) but is not proven.
- Timing: MTVU on (defaults), `nolimit=1`, warm cache, base = `public/emu` (web-perf e0e7c919). Values are
  medians of 4-5 alternated rounds, ms/vbl. The machine was shared and noisy (single runs varied ±20%).

| state, window | base wall / VM CPU | hints wall / VM CPU | change (VM CPU) |
|---|---|---|---|
| play 100-600 | 28.64 / 28.26 | 25.88 / 25.69 | -9.1% (3 of 4 pairs better) |
| car 600-1100 | 36.28 / 35.00 | 33.49 / 31.58 | -9.8% (4 of 5 pairs better) |
| car 100-600 | ~ / 32.77 | ~ / 35.18 | +7%, inconclusive (noisiest runs; this window is mostly block compiles) |

  Unlimited wall vbl/s: play 34.9 -> 38.6, car (600-1100) 27.6 -> 29.9.
- CPU profiles (VM worker, `vu1thread=0`, EE JIT time divided by VU1 JIT time as a measure of machine speed):
  - tier-1 EE JIT code -5% (0.843 -> 0.803);
  - regions -28% (0.863 -> 0.618), because their promoted GPRs now stay in registers.
- Not done: a clean car 100-600 A/B, and a confirmation profile on the final build (the test Brave went away
  during the last run).

## 2. Region rework on `tier2` (status)
- Regions use a constant PC per part (`SetVariableAsConstant(nPC)`). nPC is stored only in parts that may call
  a helper.
- A region epilog replaces the per-part tier-1 epilog: cycle quota and exception checks, then a direct `goto`
  to the next part or an exit stub that stores nPC. Branch targets come from the instruction.
- JAL calls are followed into the callee. The callee's `JR RA` returns through a run-time check of the return
  address. Parts may be in other pages, so a page -> regions index handles invalidation.
- Idle and wait-loop parts stay tier-1.
- CodeGen promotes GPR pairs to i64 locals, with sign/zero-extension pair peepholes. `BeginIf` takes a branch
  hint.
- Hashes on play and car are equal to the baselines with regions on (`&t2=16`, with and without `&t2promo=1`).
- Regions run 7.0 parts (48 instructions) per entry with `&t2=32&t2hot=16`. EE dispatches drop 71%, but the
  Execute self time only drops ~18%, because the dispatches that remain are the hard-to-predict ones.
- Creation still costs too much: 5-7 ms/vbl at vblank 1000+ with hot=16. Each new region pays a Jitter run or
  cache lookup plus a module compile. Next step: cut that cost (hot set, warm install from the block cache,
  M4) before any timing gate.

Tools were in the scratchpad (m3/: run.mjs, hash.sh, time.sh, round.sh, prof.mjs, agg.mjs, pcmp.sh,
sizes.py). They are lost when /tmp is cleared.
