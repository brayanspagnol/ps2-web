# VU1 JIT code in God of War combat: loop functions (vu1d, 2026-10-26)

Goal (notes/vu1c.md item 1): cut VU1 JIT code time by keeping VU microprogram loops in one wasm function
(structured loop/br, promoted VF/VI state in wasm locals across blocks), without per-game hacks or
accuracy shortcuts.

Play branch `vu1d` (on web-perf ce2b899a), CodeGen branch `vu1d` (on 86c2889), both pushed to the forks.
Clone: `.claude/worktrees/vu1d/play-vu1d`, build dir `build_cmake/build/b`. Scratchpad `vu1d/`
(`build.sh <variant>`, `replay.sh`, `round.sh`, `time.sh`, `hashall.sh`, `cap.mjs`, `tools/cfg.py`,
`tools/asm.sh`, `tools/x64.mjs`, fixed capture `cap2.bin`).

## What the hot code looks like
- Captures of 300 GoW combat programs (`cap.mjs`, or `CAPOUT=` on `replay.mjs`) + per-block counts
  (experiment bit 64): 77-167 block function entries per program, and nearly all of them are loops made
  of **two short blocks branching to each other** (9 instructions each: `2EE0 -> 2F38 -> 2EE0`, exits
  through 2-instruction JR blocks), plus a loop with internal branches (0CD8..0DF8) and a few self loops.
  Micro memory changes over time (GoW overlays), so captures from different moments differ a lot.
- x64 of a hot block (`tools/asm.sh`: dumped wasm -> node `--print-wasm-code`): ~420 instructions for 9
  VU pairs, ~125 of them entry loads / spills / exit stores / chaining. Per FMAC ~25 instructions: 4 clamp
  mins + their constants, the op, a blend, MakeSz (~11, with a duplicated lane shuffle) and, for results
  visible at block end, MAC + sticky ring writes (~12). The VU memory base is reloaded at every LQ/SQ.
  Dead loads at entry of values the block overwrites first (wasm loads can trap, so V8 keeps them).
- Why the old superblocks were 10% slower: written before block chaining, then chaining was added to
  every block epilog, so **a superblock part tail-called the next block** instead of running the next
  part. The dispatch structure itself (sequential `if(nPC == part)` guards in one loop) is fine.

## Changes (Play `vu1d`, CodeGen `vu1d`)
1. **8cb98964 tooling**: VU block dumps (`eeDumpRequest('F0002EE0')`), replay installs helper-compiled
   blocks (experiment rounds used to run interpreted: 120-175 us/program), result fingerprints per round
   (`results <hash>`, third variant `vs promoted N`), per-block entry/run counts (experiment bit 64,
   `VuBlockCount`). `replay.mjs` takes `CAPIN=<file>` (replay a saved capture: same programs across
   builds/sessions), `CAPOUT=`, `DUMP=`/`DUMPOUT=`.
2. **1a89a9bd superblocks**: parts compile their epilog without chaining (`CBasicBlock::CompileChaining`
   split out of `CompileEpilog`, `m_epilogNoChaining`), only the function end chains. A part that branches
   to a part (BFS from the entry, <= 16 parts inside entry + 0x1000, same join rules as before) continues
   inside the function: loop = `Goto(first label)`, state stays in locals. **On by default** (`&vusb=0`
   turns them off). Code per part is the standalone block's code, so results are the chained blocks'.
3. **b914c111 sticky accumulator**: FMACs whose MAC and sticky writes are both skipped OR their result into
   a sign vector and min their magnitudes into a second one (`CMIPS::m_jitStickyAcc`, promoted); MakeSz runs
   once when the sticky value is next needed (next written FMAC, conditional code, block end). Same replay
   fingerprints with/without (experiment bit 8). Small: in short blocks most FMACs are in the last 4 cycles,
   so their writes are not skipped.
4. **CodeGen 7bcaeab**: promoted containers written (whole) before any read on every path from the entry
   are not loaded at entry. Scan of the unconditional code from the start; stops at jumps, calls, page
   slow paths, exits. Same fingerprints.
5. **8edc38c9** `CODEGEN_VERSION` 32 + submodule.

## Results
Replay, fixed capture `cap2.bin` (GoW combat, 300 programs), 6 rounds each, medians, us/program
(machine slower than earlier in the day; ratios are what counts):

| build | promoted (old default) | superblocks |
|---|---|---|
| base (public/emu = web-perf ce2b899a) | 9.2 | 7.8 (old superblocks) |
| vu1d4 | 8.85 | **6.65 (new default)** |

-> default path 9.2 -> 6.65 us/program (-28%). All new rounds: same fingerprint (`d7713dcb178fb3e5`),
superblocks vs promoted 0 mismatches.

In game (release, warm cache, ABAB, medians; VU1 ms/frame = timeline vu1busy / frames per vblank):

| state | runs | frames/s base -> vu1d4 | VU1 ms/frame base -> vu1d4 | notes |
|---|---|---|---|---|
| gow-fight, limiter on, vbl 100-1300 | 4+4 | 33.5 -> 35.0 (+4.5%) | 27.1 -> 26.0 (-4%) | VU1 still ~92% busy; 59 vbl/s |
| gow-fight, same build `&vusb=0` vs default | 3+3 | 34.2 -> 34.7 | 26.7 -> 26.2 | superblocks alone |
| mtvu-ffx, limiter on, vbl 100-900 | 3+3 | 22.1 -> 22.9 (+3%) | vu1busy 22.5 -> 21.8 ms/vbl | game caps at 0.5 frames/vbl |
| gow-intro, limiter on | 3+3 | 29.7 -> 29.7 | VU1 idle (0.15 ms/vbl) | at the 30 fps cap |

The in-game gain is much smaller than the replay gain. Not explained yet: either the replay capture
overweights the two-block loops (captures from different moments range 77-167 calls/program) or the
JIT share of VU1 time is smaller than the 66% measured in vu1c. First step of the next round: CPU profile
(vu1c `prof.sh`) with vu1d4 to get the JIT share and the hot functions again.

Hash gate (`hash=300&vu1thread=0&nolimit=1`), vu1d4: car 55dab76e, play 1f851c1c, mtvu-ffx 5927b89c,
gow-fight 77f177fc, gow-intro b2119704; MTVU on: play 1f851c1c, car 55dab76e. All match.

Variants in public/: emu-vu1d1 (superblock fix), emu-vu1d2 (+sticky), emu-vu1d3 (+entry loads),
emu-vu1d4 (final, superblocks default on), emu-vu1ddump/emu-vu1dcnt (tooling).

## Plan for the rest (60 fps still needs ~2.2x less VU1 work per frame)
1. Profile vu1d4 in game (JIT share, hot functions, superblock vs block functions), check that the
   loops seen in the replay are the hot ones in game.
2. Flag writes in loop functions: each part keeps MakeSz + 2 ring writes for FMACs in its last 4 cycles,
   because the hint analysis assumes unknown readers after every block end. In a loop function the next
   part is known on the in-function edges; the exits (JR blocks) still need the pipeline as the chained
   blocks would leave it. Needs either per-edge materialization (keep the result vectors of the skipped
   FMACs live and write the ring entries on the exit path) or a different pipeline representation (raw
   results, flags built at read time - touches MIPSSTATE, save states, the interpreter).
3. Smaller CodeGen items: promote `CMIPS::m_vuMem` (one load per LQ/SQ, two per masked SQ), one lane
   shuffle in MakeSz (needs a v128 scratch local), clamp constants hoisted, stall-check prologue
   (pipeFmacWrite tests) folded across part transitions.
4. GIF PACKED decode on the GS thread (vu1c item 2, ~3 ms/frame) is likely the larger single lever now.
