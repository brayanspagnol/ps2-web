# Resident Evil Code: Veronica X: why testers see it slow (2026-11-05)

Disc: SLUS_201.84, NTSC, 60 vblanks/s. Builds: live `public/emu` (web-perf f35c5ea5) and `public/emu-cvx1` (the same
code plus the state load fix below, needed to load gameplay states at all). Tools: `.claude/bench/cvx/` (`drive.mjs`
key scripts and shots, `meas.mjs` timed window with /proc thread CPU and V8 profiles, `m.sh`, `sum.py`, `cat.mjs`,
`incl.mjs`, raw lines in `runs.jsonl`). Thread CPU comes from `/proc/<pid>/task/*/schedstat`.

## What was and was not measured
Reached: boot, logos, title, new game, opening movie, in-engine scene in the prison, and control of Claire in the
first prison cell (walking, inventory, map, herb). **Not reached: the door out of the cell, so no zombie, no
outdoor area and no heavy scene.** About 20 minutes of scripted walking did not find the exit, so that was stopped.
Every number below is therefore from light scenes. **The testers' slowdown was not reproduced here**: all three
scenes run at full speed on this box. What follows is where the cost sits in those scenes, not a measurement of the
scenes testers complain about.

## Speed per scene
Machine: 12-thread laptop shared with another agent. Load is the 1-minute average at window start, and it lags, so
it partly reflects what ran before the window. Profiled runs are excluded. ms are CPU per emulated vblank; the budget
is 16.7 ms per vblank (33 ms per game frame, the game draws every 2nd vblank in gameplay).

| scene (state) | vblanks/s | game frames/s | VM | GS | VU1 | GPU process | limiter idle | load |
|---|---|---|---|---|---|---|---|---|
| cell, walking, 1x (cvx-cell, cvx1), 3 runs | 58.6-59.4 | 29.4-29.8 | 8.9-11.1 | 4.5-6.8 | 2.8-4.7 | 2.3-4.2 | 6.2-8.3 | 2.3-2.5 |
| cell, 1x, vu1thread=0 | 59.4 | 29.7 | 9.3 | 4.3 | - | 2.0 | 7.9 | 2.6 |
| cell, 2x, vu1thread=0 | 59.4 | 29.7 | 9.6 | 4.6 | - | 2.6 | 7.6 | 2.6 |
| cell, 1x, alternating with the next two, 3 runs | 49.1, 59.4, 59.4 | 24.6, 29.8, 29.8 | 18.3, 9.5, 9.8 | 11.1, 5.2, 5.3 | 7.6, 3.5, 3.7 | 6.5, 2.8, 2.9 | 1.9, 7.7, 7.4 | 1.4-3.6 |
| cell, 2x, alternating, 3 runs | 59.4 | 29.5-29.8 | 9.4-10.4 | 4.6-5.5 | 3.0-3.5 | 2.4-2.9 | 6.7-7.8 | 1.4-3.7 |
| cell, 2x, vu1thread=0, alternating, 3 runs | 59.4 | 29.7-29.8 | 9.6-10.9 | 4.3-5.1 | - | 2.1-2.6 | 6.2-7.5 | 1.5-2.6 |
| cell, 2x, earlier runs, 3 | 52.8-57.6 | 26.4-28.9 | 13.7-17.3 | 7.9-11.8 | 4.9-8.2 | 4.5-7.0 | 1.5-3.9 | 2.6-4.2 |
| prison scene, 1x (cvx-p1, live) | 59.1 | 30.5 | 9.4 | 5.0 | 3.2 | 2.6 | 7.9 | 20, stale |
| prison scene, 2x (live) | 59.4 | 30.7 | 9.5 | 5.1 | 3.2 | 2.6 | 7.7 | 14, stale |
| prison scene, 1x, vu1thread=0 (live) | 59.3 | 30.8 | 9.4 | 4.3 | - | 2.2 | 7.8 | 10, stale |
| opening movie, 1x (cvx-fmv, cvx1), 3 runs | 59.4 | 41.1-41.5 | 8.7-8.8 | 0.9 | 0 | 0.5 | 8.4 | 2-3 |
| opening movie, 2x | 59.4 | 41.2 | 9.3 | 0.9 | 0 | 0.7 | 7.9 | 15, stale |
| opening movie, 1x, vu1thread=0 | 59.4 | 40.4 | 8.5 | 0.8 | - | 0.5 | 8.6 | 7 |
| cell, cold block cache (0-1200) | 56.8 | 28.6 | 12.3 | 6.7 | 4.2 | 3.8 | 4.9 | 7.7 |

Some runs were slower with every thread up together, VM included (VM 13.7-18.3 instead of about 9.5, and frames/s
down to 24.6). They hit 1x as well as 2x: the slowest run of all is a 1x one, and three alternating rounds show 2x
at full speed. So they are not a cost of 2x. The cause is unknown: game runs are serialized by the lock, but the
laptop's other work and power limits were not ruled out. Load average did not predict them.

Limiting thread: **none here, the limiter still sleeps about half of each vblank.** The VM thread is the closest to
its limit (about 55% of the budget), then GS (about 30%), VU1 (about 20%), GPU (about 15%). If a slower PC scales
every thread evenly (a guess, not measured), VM runs out first, at about 1.8x slower than this box.

2x costs almost nothing and vu1thread=0 too, so **GPU and fill rate do not matter in these scenes**; res=2 was
checked to really give a 1280x960 canvas. VU1 threading gains nothing here either, because VU1 is so light.

## Compared with God of War and GTA (same tool and day, live build, loaded runs)
| state | vblanks/s | frames/s | top threads ms/vbl | load |
|---|---|---|---|---|
| gow-fight 1x | 44.7 | 31.0 | 21.4, 21.0, 17.2, GPU 9.5 | 2.7 |
| gow-fight 2x | 48.7 | 21.3 | 19.5, 18.6, 15.3, GPU 8.2 | 19 |
| play 1x | 33.3 | 16.8 | 28.8, 20.9, 18.2, GPU 17.4 | 8.7 |
| CVX cell 1x | 59.4 | 29.8 | 8.9, 4.5, 2.8, GPU 2.3 | 2.3 |

These scenes of CVX cost about a third of GTA play per vblank. Single runs; only the ratio means anything.

## Where the time goes (V8 profiles, names build, 250 us, 34 s and 27 s; profiled runs are slower, so shares only)
VM thread, cell, percent of the thread's time (inclusive where it says so):
- EE executor inclusive 37.8% (JIT EE alone 22.9%)
- **VU0 micro programs inclusive 24.9%** (`CVpu::ExecuteMicroProgram`; JIT VU 14.6%), against 2.6% in GTA play
  (notes/gta-profile.md). This is the one thing unique to this game. Inside it, `Vu0StateChanged` is 5.1%: the full COP2
  register copy between EE and VU0 at every micro program start and stop, plus `CSignal` 1.8%.
- `CPS2VM::EmuThread` self 9.4% (IOP executor inlined there, see gta-profile)
- SPU 7.4% (`UpdateSpu`)
- DMAC source chain 5.2%, memory slow paths 4.6%, ring push to VU1 3.6%, `CTimer::Count` 2.8%
- IPU 1.9% with no video playing. It looks like the pending FDEC (see Bugs) being retried by `ExecuteIpu` on EE
  slices and IO writes; inferred from the profile and the code, not traced.

VM thread, opening movie: IPU 35% (BDEC, ReadDct, dequantise, CSC), JIT EE 21%, SPU 10%, idle 10%. The movie is not
expensive: about 8.8 ms per vblank, the same as gameplay. EE busy is about 15%, GS and VU1 are almost idle.

GS thread, cell: **`FeedImageData` is 45.5% of the thread's samples, 58% of its busy time** (timed waits are 21.7%):
`TransferWriteHandlerGeneric<PSMCT32>` 26.6% and `<PSMT8>` 7.9% self, walking every pixel through
`GetPixelAddress` with divisions by page size and a compare before each store. Then render passes 13.7%,
`ProcessHostToLocalTransfer` 10.7%, `PrepareTexture` 9.4%. GL calls themselves are small. It looks like a large image is uploaded every frame (a guess: the transfer sizes
were not measured, and neither was how this share compares with GTA or God of War).

Other things checked: EE wait loops are not burning time (EE busy 13-16% in all three scenes). Block compile is
small: 0.01-0.12 ms per vblank warm, 0.4 ms per vblank cold in the cell (compiles at room changes were not timed).
Disc 0.2 ms per vblank in the movie. No large recompile load seen.

## Generic levers, ranked
All are for the VM thread except 2. None was implemented or measured as a speedup.
1. VU0 micro program start/stop cost: `Vu0StateChanged` copy and `CSignal`, 7% of VM measured. Evidence: profile.
   Upper bound about 0.6 ms per vblank. Whether it can be made lazy without changing results is a guess, and this
   game's share (25%) is 10x GTA's, so it may matter more in scenes with more characters, also a guess.
2. GS transfer fast path for PSMCT32 and PSMT8 (a span per row in a page, no per-pixel division). Evidence: 58% of GS
   busy in the cell, exact by construction. It helps only the GS thread, which does not limit anything here, so it
   would not change frame rate on this evidence. Worth doing if heavier scenes turn out GS-bound (unknown).
3. VU JIT work already underway for God of War applies to VU0 here too (14.6% of VM). Evidence: profile only.
4. Skip the FDEC retry until the IPU input FIFO has data: 1.9% of VM measured, cheap, small.
5. Known EE and IOP dispatcher work from gta-profile.md applies as usual.

Biggest open question, ahead of all of these: **measure a real zombie or outdoor scene.** Testers may be seeing a
scene with a very different profile. The levers above are ranked for the cell, not for that scene.

## Bugs seen
- **In-game save states crash on load in the live build** (`RuntimeError: null function` in
  `CIPU::CFDECCommand::Execute`). The game leaves an FDEC pending during play, the state keeps the command id, but the
  command object is not initialised after a fresh boot, so it dereferences a null FIFO. Reproduced with `cvx-cell.zip`
  and `cvx-p2.zip` on `public/emu`. Fixed on branch `cvx` in `.claude/worktrees/cvx/play`. Other pending IPU commands
  (BDEC, IDEC, VDEC...) were not looked at and could crash the same way.
- Rendering: nothing wrong seen in boot, logos, title, inventory, map, movie, prison scene, cell (dark by design),
  at the sizes checked. Subtitle text seen at full size at 1x and 2x only (`shots/res1-*`, `res2-*`).

## Fix on branch `cvx`
One commit on f35c5ea5 (`Source/ee/IPU.cpp`), not published. Hash gate on `emu-cvx1`: car 55dab76e, play 1f851c1c, gow-fight
77f177fc, gow-intro b2119704, mtvu-ffx 5927b89c, car and play with vu1thread=1 the same: all as expected. It only
runs on a state load with an FDEC pending; no speedup is claimed.

## State files (OPFS of the test Brave, localhost:8080)
`game()` in common.sh maps `cvx-*` to this disc.
- `cvx-fmv.zip`: early in the opening movie. Loads on live.
- `cvx-p1.zip`: end of the movie, about 60 s before Claire gets control. Loads on live. From it, key script
  `w62000 kKeyZ:150 w3000 kKeyX:150 w1000 kKeyX:150` reaches control.
- `cvx-cell.zip`: Claire in the cell, in control. Needs a build with the fix (`emu=cvx1`).
- `cvx-p2.zip`: inventory manual screen, same note; not useful.

Run: `EMU=cvx1 KEYS="$(cat walk.txt)" .claude/bench/cvx/m.sh cvx-cell.zip 200,1400 res=1`.
Note: `emu=emu` loads `public/emu-emu`, which does not exist. The live build is `emu=` empty or absent.
