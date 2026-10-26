# VU1 thread in God of War combat: profile and first cuts (2026-10-26)

Goal: GoW combat (gow-fight.zip) runs ~59 vblanks/s but shows ~22-31 frames/s because the VU1 thread (MTVU) is
~95% busy. Find where VU1-thread time goes and cut it without per-game hacks or accuracy shortcuts.

Branch `vu1c` of the Play fork (from web-perf 75a0d770, CodeGen unchanged at 5981aab), pushed to `fork`. Clone in
`.claude/worktrees/agent-a7da556b3aaa5decc/play-vu1c` (the harness kept git out of play-src, so it is a clone with
submodules cloned from play-src's), build dir `build_cmake/build/b`, profile link `build_cmake/build/linkprof.cmd`
(-O1 --profiling-funcs -> `build_cmake/build/prof`).

## Method
- Scratchpad `vu1c/` (copied from `vu1b/`): `prof.sh`/`prof.mjs` (V8 CPU profiles of all workers, 20 s from vblank
  300, blockcache=0, JIT names), `cat.mjs` (VU1 categories), `tree.mjs` (self leaves under a frame), `callers.mjs`,
  `cnt.sh` (VUCNT console counters, `counters.patch` = block set counters), `replay.sh` (VU1 replay benchmark, see
  notes/vu-jit.md), `time.sh`/`round.sh` (ABAB).
- `run.mjs` now counts game frames: `emulator.js` `frameId()` (GS frames sent to the page) at the start and end of the
  `&time` window -> `fps` (frames/s wall) and `fpv` (frames per vblank). `time.sh` takes `NOLIM=0` for limiter-on runs.
  **VU1 ms/frame = timeline `vu1busy` (ms/vbl) / fpv.** (The /proc per-thread pick is ambiguous in GoW: the VM thread
  is as busy as VU1.)

## Where the VU1 thread goes (gow-fight, % of VU1 busy samples; ms/frame = share x vu1busy/frame, limiter on)

| category | base (75a0d770) | new (vu1c) |
|---|---|---|
| VU JIT code (blocks, chained) | 60.7% (18.5 ms) | 66.6% (18.7 ms) |
| XGKICK -> GIF PACKED + GS write buffer | 19.5% (5.9 ms) | 13.0% (3.7 ms) |
| VIF1 unpack | 8.7% (2.6 ms) | 9.5% (2.7 ms) |
| VIF1 back decode (ProcessPacket, commands) | 5.8% (1.8 ms) | 6.2% (1.7 ms) |
| block set switch + partition/lookup (EmptyBlockHandler) | 3.2% + 0.3% (1.1 ms) | 2.6% (0.7 ms) |
| VU dispatcher (CVuExecutor::Execute etc.) | 1.9% | 1.8% |
| ring/messages | 0.2% | 0.2% |
| idle | 3.9% of samples | 3.9% |

Base details: XGKICK = `CGIF::ProcessPacked` 9.5% + `CGSHandler::ProcessWriteBuffer` 8.3% (of which
`CMailBox::SendCall` 4.0%: one GS-thread call per packet over 0x100 writes, the rest the per-write scan for
SIGNAL/FINISH/LABEL) + `FinishAndFlip` wait 1.7%. Hottest JIT blocks: `vu1p_00002B90_00002C84` 7.6%,
`00002EE0_00002F24` 6.0%, `00002F38_00002F7C` 5.6%, `00002840_000028EC` 5.1% (short blocks: ~37 promoted loads at
entry, ~29 stores at each exit, 10 FMACs each with min_s/min_u clamps and MakeSz).
Block sets: VUCNT counters in 15 s of combat: 8.1k contents switches made a **new** set, 90 found an old one
(GoW rewrites part of micro memory with nearly every MPG), so every block was partitioned again after each switch.
VU1 replay benchmark (300 consecutive GoW programs, XGKICK suppressed): reference 20.4 us/program, promoted 15.6.

## Changes (Play `vu1c`)
1. **a261e7cb GS write buffer**: writers flag SIGNAL/FINISH/LABEL (`WriteRegister`, GIF PACKED A+D), so
   `ProcessWriteBuffer` only scans when one of them was written; submit to the GS thread every 0x1000 writes instead of
   0x100 (fewer mailbox calls; order and contents unchanged, `Finish`/`FeedImageData`/`ReadImageData` still submit
   everything first).
2. **8c3c7344 VU block sets carry-over**: a new set (contents not seen before) starts with the current set's blocks
   whose 256-byte pages kept their contents (a block's code and extent depend only on its own words), held in a vector
   next to the set's block store. EmptyBlockHandler + SelectBlockSet 5.3% -> 3.8% of VU1 samples.
3. **98b876da ITOF4/12/15** multiply by 1/16, 1/4096, 1/32768 instead of a SIMD divide (exact power-of-2 scaling:
   same bits). `CODEGEN_VERSION` 14 (not 4, to stay apart from other branches sharing the block cache).

## Results
Release builds `public/emu-vu1cbase` (75a0d770) vs `public/emu-vu1c2` (= 98b876da), warm cache, ABAB, medians,
bench.html default resolution, load 2-4.5.

| state | runs | frames/s base -> new | VU1 busy ms/frame base -> new | notes |
|---|---|---|---|---|
| gow-fight, limiter on (vbl 100-1300) | 4+4 | 30.9 -> 33.3 (+8%) | 30.5 -> 28.1 (-8%) | 59 vbl/s both; VU1 94-95% busy |
| gow-fight, no limiter (vbl 100-600) | 5+5 | 30.2 -> 32.9 (+9%) | 32.9 -> 30.2 | |
| mtvu-ffx, limiter on | 3+3 | 20.5 -> 21.7 (+6%) | VU1 CPU 17.4 -> 16.6 ms/vbl | game caps at 0.5 frames/vbl; VM waits for VU1 10 -> 8.6 ms/vbl |
| gow-intro, limiter on | 3+3 | 28.2 -> 28.2 | VU1 ~idle (0.15 ms/vbl) | at the game's 30 fps cap (0.5 frames/vbl) |

Hash gate (`hash=300&vu1thread=0&nolimit=1`), vu1c1 (changes 1+3 + set carry-over in a hash set) and vu1c2 (final):
car 55dab76e, play 1f851c1c, gow-fight 77f177fc, gow-intro b2119704, MTVU play 1f851c1c / car 55dab76e: all match.
mtvu-ffx: vu1c1 5927b89c (match); vu1c2 5dcbf8bd, ad7bda03, 71e096b9, f5f48646, db706021 - but **the base build is
just as flaky right now**: feb7e529, 14de30af, a7cf4e1a, db706021 (base and new share db706021).

## What is left: 60 fps needs ~2.4x less VU1 work per frame (28 -> ~11.7 ms), and JIT code alone is 18.7 ms
In order of size:
1. **VU JIT code (18.7 ms/frame).** Blocks are short and chained: each transition stores ~29 promoted symbols and the
   next block reloads ~37 (VF regs, VI regs, pipeline state); per FMAC: 2 clamp ops per operand, MakeSz
   (bitmask) + sticky OR + MAC ring write when not skipped. Real gains need compiling a whole microprogram (or a loop
   nest) into one wasm function with structured control flow (loop/br), so VF/VI stay in locals across blocks; the
   earlier "superblock" try used a dispatch loop and was 10% slower (all locals loop-carried). Smaller: keep sticky
   S/Z as an OR of lane masks in a v128 local and materialize at block end when no status read is in the block.
   Measure each with `replay.sh` (stable to ~3%) before in-game runs; experiment bit 1 (no SZ flags) changes program
   flow in GoW (161 vs 16 us/program), so it is no cost bound.
2. **GIF PACKED decode (ProcessPacked ~10.6%, ~3 ms/frame)**: could move to the GS thread (XGKICK copies raw qwords,
   GS thread decodes; GS thread is ~55-60% busy). SIGNAL/A+D handling must stay ordered on the VU1 side.
3. VIF1 unpack + back decode (~4.4 ms/frame): already SIMD/batched; `Unpack<V4-32>` alone 2.4%.
4. Block partition after contents switches (still ~0.7 ms): blocks in rewritten pages are re-partitioned and found by
   content hash in `BlockFactory` (~1% self, multimap + make_shared + CopyFunctionFrom).

Variants in public/: emu-vu1cbase(+p), emu-vu1ccnt (counters), emu-vu1c1(+p), emu-vu1c2(+p).
