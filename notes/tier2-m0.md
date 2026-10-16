# Tier-2 JIT, milestone M0 (measurements)

Status (2026-10-16 ~11:30): M0a done (GO). M0b implemented, committed and pushed; correctness and timing only
partly measured (stopped early to save tokens, see "M0b status" and "Next steps"). Design: notes/tier2-jit-design.md. Worktree `play-t2`, branch
`tier2-m0` (Play fork, from web-perf cd7a2a58) and CodeGen branch `tier2-m0` (from d8c5b47).

## M0a: how many block transitions can regions absorb?

### Tooling
- PROFILE builds record EE block transitions during the bench `&time=from,to` window
  (`CEeExecutor::StartEdgeProfile/StopEdgeProfile`, hook `ProfileBlockExecuted` in the profiling dispatcher
  loop): counts per (src block, dst block, exit kind of src), exit kind = none / cycle quota / other
  exception (syscall, interrupt check, idle), plus a trace of the first 8M blocks run (block start | exit
  kind), the instruction words and branch info (`IsInstructionBranch`, `GetInstructionEffectiveAddress`)
  of every page that held a profiled block or is write-protected, and the protected-page flags.
  `Module.eeEdgeProfile()` returns the bytes (a view; copy it) once `eeTimeResult()` is ready.
- `tools/tier2/regions.py profile.bin [--sweep]` (Play repo): re-partitions blocks with tier 1's rule
  (0 mismatches against the blocks that ran), classifies exits (direct / call / indirect / exception),
  builds the section 5 regions (entry + static successors inside one function: fall-through, conditional
  branches, J/B; JR/JALR/ERET/SYSCALL/VCALLMS and calls end the region; caps 32 blocks / 256 instructions,
  successors within +-4 KB of the entry; only blocks >= 0x100000 on write-protected pages; every eligible
  block gets a region, i.e. the `tier2=all` ceiling) and replays the trace exactly: a transition is
  internal when the running region holds the next block as a static successor of the current one and
  the block did not exit with an exception; otherwise the dispatcher enters the next block's region.
  `--selftest` checks the classifier and the replay on a hand-made page.
- Runs: PROFILE build `emu-t2prof`, `&vu1thread=0&nolimit=1&time=100,600` (deterministic), 4 scenes:
  GTA SA free roam (play.zip), GTA SA car cutscene (car.zip), FFX intro (mtvu-ffx.zip), God of War first
  fight on the ship (gow-fight.zip, NTSC).

### Results (vblanks 100-600; replay over the first 8M transitions, whose exit mix matches the window)

| | play.zip | car.zip | FFX | GoW fight |
|---|---|---|---|---|
| transitions in the window | 122.6M | 139.1M | 100.2M | 90.0M |
| exits: direct (non-call) | 78.0% | 77.2% | 88.5% | 82.1% |
| exits: call (JAL/BAL) | 8.6% | 8.8% | 5.0% | 5.9% |
| exits: indirect (JR/JALR/ERET) | 12.5% | 13.0% | 5.5% | 11.2% |
| exits: exception (quota + other) | 0.9% | 0.9% | 0.6% | 0.6% |
| **internal transitions, 32 blocks / 256 insns / 4 KB** | **76.1%** | **75.3%** | **89.3%** | **80.5%** |
| blocks run per dispatch (was 1) | 4.18 | 4.06 | 9.37 | 5.13 |
| distinct regions entered | 9231 | 9556 | 3760 | 5105 |
| region size (weighted by entries) | 8.3 blocks / 60 insns | 8.0 / 58 | 6.8 / 57 | 9.6 / 78 |
| internal transitions in the top 100 / 1000 regions | 55% / 94% | 58% / 94% | 90% / 100% | 62% / 97% |
| instructions run inside regions | ~100% | ~100% | 99.5% | 99.9% |

- Caps barely matter: 16/128 gives 73.3% (play), 64/512 gives 77.0%, unlimited 78.0%. Doubling the span
  to 8 KB adds 0.4 points. The static bound (every direct non-call edge between eligible blocks) is 78% on
  play.zip, so the remaining loss is calls and returns, not region shape.
- Exceptions (quota, syscalls, interrupt checks, idle loops) are under 1% of transitions; kernel and
  unprotected code is about 0.1-0.4%.
- What stays external is calls (5-9%) and indirect jumps, mostly `JR RA` returns (5-13%): the M3 targets
  (JAL inlining with a guarded `JR RA`).
- Still flat: 9-10k regions are entered in GTA, the top 100 hold only 55-58% of the internal transitions.
  Tier 2 has to be automatic and cover thousands of entries, as the design assumed.

### Decision: GO
Internal transitions are 75-89% on all four scenes, far above the 40% stop threshold (the design's central
case assumed 70%). Dispatches fall 4-9x. With the dispatcher at ~25% of the VM thread (23-29% measured in
ee-jit), that is up to ~19% of the VM thread on GTA (22% FFX, 20% GoW) before region entry/exit costs.
Section 13's model with the measured i (c ~ 0.95-1.0) gives 1.39x / 1.55x / 1.73x for s = 1.3 / 1.75 / 2.5
on play.zip (car.zip the same, GoW 1.42x / 1.62x / 1.83x).

## M0b: helper effect classes and EE context promotion on tier 1

### Change
- CodeGen 873a387 (`tier2-m0`): `CWasmFunctionRegistry::RegisterFunction(..., FUNCTION_EFFECT)`.
  `FUNCTION_EFFECT_ALL` (default) = old behaviour (store dirty promoted symbols, call, reload all).
  `FUNCTION_EFFECT_NONE` = the helper may only touch ranges registered with
  `CCodeGen_Wasm::RegisterVolatileContextRange`. `PreparePromotion` does not promote those ranges in a
  function that calls a NONE helper (page access slow paths count), and such calls skip the spill/reload.
  Functions without NONE calls (VU blocks) are unchanged.
- Play 6630dbbd: memory helpers (MemoryUtils_* page-access handlers, LWL/LWR/LDL/LDR/SWL/SWR/SDL/SDR proxies)
  are NONE. Volatile ranges (what the EE memory map handlers touch): nPC (idle detection, write-watch
  current block), nHasException (interrupt check, idle), nCOP0..nCOP1 (STATUS read, DMAC writes CPCOND0,
  perf counters), nCOP2..end of MIPSSTATE (VIF0 writes can start VU0 -> `Vu0StateChanged` copies the COP2
  state; TLB entries for address translation). GPRs, HI/LO, SA, COP1, nDelayedJumpAddr, cycleQuota stay
  promoted across slow paths. Promotion is still OFF by default (`&eepromo=1` / `Module.setEeContextPromotion`).
- Not done: the design's checker mode (flush + hash MIPSSTATE around NONE calls); the 3-4 state hashes are
  the only oracle so far.

### Code size (60 hottest play.zip blocks by executed instructions, 25% of them; static per MIPS instruction,
weighted by executions; tool scratchpad t2/dumpstat.py over `&eedump`)
| codegen | code bytes | wasm loads | wasm stores |
|---|---|---|---|
| no promotion (t2rel `&eepromo=0`, = published codegen) | 69.7 | 3.05 | 1.68 |
| old promotion (published build `&eepromo=1`) | 122.3 | 6.45 | 4.59 |
| new promotion (t2rel `&eepromo=1`) | **65.8** | **2.42** | **1.34** |
The slow-path bloat is gone: promoted code is now smaller than unpromoted code.

### M0b status (measured so far)
- State hashes, 300 vblanks, `&vu1thread=0&nolimit=1`: play.zip identical for published build, t2rel promo
  off and t2rel promo on (digest c936a1d9d596, last 0034DFFC:C12C.4057.27A3.E16F.1EAE). car.zip: published
  and promo off identical (58750a0d17a4); promo on, FFX and GoW NOT run yet.
- Timing: one round only (play.zip, vblanks 100-600, ms/vbl wall / VM CPU): off 45.3/44.8, new promo
  53.9/53.3, old promo 51.2/50.8. Not conclusive (first round, block cache partly cold for the promo
  variants, machine shared) but it does NOT show a win yet: smaller code alone may not be enough (entry
  loads of every promoted container, exit stores of every dirty one, the per-block window is short).
  The second round was refused by run.mjs (MemAvailable < 2.5 GB).

## Variants (public/)
- `emu-t2prof`: PROFILE build of tier2-m0 (edge profile, `Module.eeEdgeProfile()`).
- `emu-t2rel`: release build of tier2-m0 (promotion off by default; `&eepromo=1` = new promotion).
- `emu-t2base`: copy of the published build (cd7a2a58) for A/B.

## Next steps
1. Finish M0b measurements (tools in scratchpad t2/: run.mjs, hash.sh, ab.sh, dumpstat.py):
   `hash.sh car|ffx|gow "pub=t2base:" "off=t2rel:&eepromo=0" "on=t2rel:&eepromo=1"` and
   `ab.sh 5 play|car "off=t2rel:&eepromo=0" "on=t2rel:&eepromo=1" "old=t2base:&eepromo=1"` (one round per
   lock hold; discard round 1 as cache warm-up). Edge profiles: scratchpad t2/m0a/{play,car,ffx,gow}.bin.
2. If promotion is still slower with the smaller code: promote only containers used 2+ times, load only
   containers read before written (entry loads are trapping wasm loads TurboFan cannot drop), store only
   on paths that wrote. If faster: set `g_eeContextPromotion = true` (BasicBlock.cpp) and re-hash 4 scenes.
3. Recommended next milestone regardless of M0b: **M1** (tier-2 plumbing with single-block regions) can start,
   since M0a is a clear GO; or **M2a** (CFG structurer + VU superblocks) first to retire risk #1 (TurboFan on
   multi-block functions). M3's JAL inlining is worth 5-9% more internal transitions (calls) plus most of
   the 5-13% indirect ones (returns).
4. Note: play-eejit is experimenting with `&eeregion=N` (blocks within N bytes in one function) and
   `&brsel` in bench.html; these M0a numbers apply to that work too.
