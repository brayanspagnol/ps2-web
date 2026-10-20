# Automatic EE wait loop detection (branch auto-idle, merged into web-perf)

Play fork: `b4789f3c` "EE: automatic wait loop detection", `7230388b` (drops God of War's 4 `IdleLoopBlock`
entries), merged with web-perf 1654ec22 as `a750fd29`; web-perf fast-forwarded to a750fd29, then to d215ce84 (IPU CSC, below), pushed to `fork`
(web-perf and auto-idle) on 2026-10-20. `public/emu` rebuilt from web-perf d215ce84 (CMake reconfigured, version 0.77-62-gd215ce84;
setFrameSkip / getSkippedFrames / setAudioBufferMs still exported).

## What it does
When a block ending with a branch back to an earlier address is created, `CWaitLoopAnalyzer` (EeExecutor.cpp)
walks every path from the loop head back to the head, following calls up to 3 deep. An iteration is safe if it
only does register arithmetic, loads (hardware registers only when the read has no side effect), stores to stack
slots of called functions written before being read, and FlushCache syscalls, and if every register it reads
before writing is unchanged or the same constant at the back edge (no counters). Unsafe paths don't reject the
loop: the block where they start becomes a "taint block". The loop block calls `EeAutoIdleCheck` on the back
edge; with no taint block run and the same registers as the previous pass, the rest of the EE slice is skipped
(like an `IdleLoopBlock`). Loops entered from outside (other than at the head) are rejected; blocks are
invalidated when code read by the analysis changes. `Module.setEeAutoIdle(bool)`, `Module.eeAutoIdleStats(reset)`
("L head branch insts blocks taints checks idles" / "R head branch reason") for testing.

## Loops found (checks / idles over the run)
- God of War: 0x17A200 vsync poll (228k/228k at boot+intro), 0x17A328 flag 0x2AC7D0 poll (2.2M/2.2M),
  0x26C0E0 SIF RPC poll with FlushCache (61k/61k), 0x183890 (3.5k/2.8k, not covered by GameConfig before),
  0x2940F0, 0x21FF20. Same loops the removed GameConfig entries covered, plus two.
- GTA SA (play.zip): 0x53C470 (2049/2048); 0x243C10, 0x28E750 found but never idle (taint paths taken).
  car.zip: none idle. 0x34DFD8 stays a GameConfig `IdleLoopBlock` (left alone by the detector).
- FFX (mtvu-ffx.zip, cold boot): 8 loops found, none idle in these windows.

## Correctness (hash=300, vu1thread=0, nolimit=1)
- car 55dab76e, mtvu-ffx 5927b89c, play 1f851c1c: identical to public/emu (web-perf 1654ec22).
- gow-fight 77f177fc (was 718a88cc): expected, an `IdleLoopBlock` idles on the first pass, the detector on the
  second identical pass, so EE cycles per vblank differ. Reproducible (auto-idle build and the published web-perf
  build give the same hash). Screenshot after 300 vblanks: fight on the ship renders correctly.
- Cold boots (blockcache=0): GoW reaches the menu, difficulty select and the opening movie; GTA SA plays the logos,
  credits, loading screens and the in-engine airport / Grove Street intro; FFX plays the intro movie and reaches
  the title menu and memory card screen.

## Timing
Wall and VM-thread CPU ms/vbl over vblanks 100-600 after the state load (release, MTVU on, no limiter, VM thread
pinned to P-cores 0-7), 2 ABAB rounds. The machine was shared with other agents and the HUB dev server; identical
runs differed by up to 30%, so only the EE busy share (emulated, load-independent) is conclusive:

| state | base cpu ms/vbl | auto-idle cpu ms/vbl | base EE busy % | auto-idle EE busy % |
|---|---|---|---|---|
| play.zip | 43.4 / 31.5 | 35.8 / 36.6 | 30.8 / 31.3 | 30.7 / 31.0 |
| car.zip | 38.0 | 40.4 | 36.8 | 36.8 |
| gow-fight.zip | 17.1 / 21.5 | 17.2 | 21.7 / 19.1 | 20.5 |
| gow-title.zip | 10.7 / 7.8 | 11.8 / 8.2 | 15.2 / 11.3 | 11.5 / 10.7 |
| mtvu-ffx.zip | 23.0 / 21.8 | 20.7 / 24.7 | 34.2 / 34.1 | 34.4 / 34.7 |
| gow-intro.zip | 25.3 | 28.5 | 100 | 100 |

GoW boot to the menu (nolimit, first 40 s): same vbl/s and ~10% EE busy for both. Result: same speed as the
per-game entries, without per-game entries; it should help other regions/games whose loops have no GameConfig.

## God of War opening movie (user report: ~16 vbl/s)
State `gow-intro.zip` (OPFS of the test Brave): New Game -> Hero -> opening movie, saved ~18 s into the movie
(Kratos on the cliff). ~25-38 ms/vbl (26-40 vbl/s) here with no limiter, both builds; EE 100% busy.
Not a wait loop: EE PC samples (profiling build) are ~80% in byte-by-byte bitstream refill loops at
0x271FC0-0x273DB0 (`lbu`, `dsllv`, `or` into a 64-bit buffer, 8 bits per pass; real work). VM-thread profile:
IPU ~26% (CSC 15% self, BDEC ~9%), the rest EE JIT code. CSC was sped up next (see below).

## IPU CSC (branch ipu-fast d215ce84 = web-perf d215ce84, published in public/emu)
- `CINFIFO::ReadAlignedBytes`: CSC copies its 384 macroblock bytes in one step when the FIFO position is byte
  aligned (same FIFO end state as 384 `TryGetBits_MSBF(8)` calls); unaligned falls back to the byte loop.
- `ConvertBlockSimd` (wasm only): YCbCr -> RGBA 4 pixels at a time, same float ops in the same order (no FMA in
  wasm), bit identical. Self-check: scratchpad `idle/csc/test.cpp` (em++ -msimd128, node): 200k random macroblocks
  and thresholds plus every Cb/Cr pair, 0 differences. Other platforms keep the scalar loop.
- Hashes on top of a750fd29 (public/emu-ipu1): car 55dab76e, mtvu-ffx 5927b89c, gow-fight 77f177fc,
  gow-intro b2119704: all identical to a750fd29.
- gow-intro wall ms/vbl over 100-600 (VM thread = wall, EE 100% busy), 3 ABAB rounds, quiet box:
  a750fd29 22.4 / 22.9 / 24.6, ipu-fast 19.1 / 21.8 / 19.3 (about -15%, ~44 -> ~52 vbl/s with no limiter).
- Left: BDEC (~9% of the VM thread in the movie) decodes VLC bit by bit through the virtual CBitStream calls; a
  bulk read does not apply there.
- A local web-perf merge with vu1-fast (2d94c7e5, never pushed; kept as local branch `backup-wp-2d94c7e5` in
  play-src) changed the EE hashes of car / play / gow-fight (cb5ff465 / 1cabfadc / ccb6de53; mtvu-ffx and gow-intro
  unchanged). The ipu change alone keeps them, so the change comes from vu1-fast; web-perf was reset to d215ce84
  (auto-idle + ipu-fast only) and vu1-fast stays unmerged until that is explained.
- Published build (web-perf d215ce84): car 55dab76e, play 1f851c1c, mtvu-ffx 5927b89c, gow-fight 77f177fc,
  gow-intro b2119704.

## Tools (scratchpad, session-specific)
`idle/run.mjs` (CDP runner: own tab, &hash md5 short hash, &time wall + VM-thread CPU, pins the VM thread, eeBusy,
screenshots, `--script` hook), `idle/drive.mjs` (key presses via Input.dispatchKeyEvent, periodic screenshots,
state save, worker CPU profiles), `idle/prof.mjs` (cpuprofile self/inclusive), `idle/ab.sh` (ABAB),
`idle/dis.py` (capstone EE disassembly of the state's `ram`).
