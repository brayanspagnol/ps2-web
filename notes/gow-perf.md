# God of War performance (branch gow-perf, merged into web-perf)

Commit 5355c7df "God of War: idle wait loops, front VIF1 unpack skip in one step" (on top of 203fa0fb),
fast-forwarded into `web-perf` and pushed to `fork` on 2026-10-19; `public/emu` rebuilt from it.

## What it does
- `GameConfig.xml`, `SCUS_973.99;1` (God of War USA): the game waits for the vsync counter (0x17A1D0) and for
  the flag at 0x2AC7D0 (cleared by an interrupt) with polling loops that run a 2000 / 20000 iteration delay
  between polls (~77% of EE time in combat). Three `Patch` entries cut the delay counts to 1, three
  `IdleLoopBlock` entries mark the poll blocks so each pass ends the EE slice.
- `CPS2VM::LoadState`: game config RAM patches are applied again after a state load (states saved before a
  patch existed get it too).
- `CVif::SkipUnpack` (MTVU front VIF1): with CYCLE cl == wl and read tick == write tick the vectors of an
  UNPACK are contiguous; they are skipped in one step instead of one cycle group at a time. Same end state
  as the loop (read/write tick = (tick + count) mod wl).

## Correctness (hash=300, vu1thread=0, nolimit=1)
- car.zip, mtvu-ffx.zip: identical to the baseline (public/emu at 203fa0fb).
- gow-fight.zip, gow-title.zip: differ from vblank 0, as expected: the patches change three words of EE RAM
  and the idle-loop skip changes how many EE cycles run per vblank. The new build is reproducible
  (gow-fight: 2 of 3 runs identical; the third diverged at vblank 50 in the IOP RAM hash only, the same rare
  nondeterminism seen before on car.zip; the merged web-perf build matches gow-perf). Screenshots after 300
  vblanks: title screen identical; fight on the ship renders correctly (HUD, rain, blood, soldiers), the fight
  has just progressed differently.

## Timing (release builds, MTVU on, frame limiter off, wall ms/vbl over vblanks 100-700 after the state
load, median vbl/s from bench.prof; ABAB, 2 rounds, machine load 3-5 from other agents)

| state | base ms/vbl | gow-perf ms/vbl | base vbl/s | gow-perf vbl/s |
|---|---|---|---|---|
| gow-fight.zip | 30.37 / 26.42 | 18.51 / 19.34 (-33%) | 32 / 36 | 51.5 / 54 |
| gow-title.zip | 12.44 / 11.69 | 8.48 / 8.53 (-30%) | 86 / 83 | 118.5 / 123.5 |
| car.zip (GTA) | 39.37 / 39.46 | 37.61 / 39.49 | 26 / 26 | 28 / 28 |
| mtvu-ffx.zip | 27.61 / 24.63 | 24.29 / 24.65 | 38 / 41 | 42 / 41 |

GTA and FFX: no regression (their code paths only see the SkipUnpack change).
In-game gow-fight with the limiter on (45 s, median vbl/s, noisy): merged 56 / 45, base 49 / 47 (a first
merged run with a cold block cache for the new build variant was 35).

## Open
- Only the USA executable (SCUS_973.99) is covered; PAL/other regions need their own addresses.
- Remaining combat cost is VU1/GS work, not the EE wait loops (EE ~17-40% busy after the change).
