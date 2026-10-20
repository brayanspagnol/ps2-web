# Low-end hardware mode

Goal: the site runs on weak machines without manual tuning. Emulator side: web-perf 1654ec22
(`setFrameSkip(n)`, `getSkippedFrames()`, `setAudioBufferMs(ms)`). Site side: `public/js/perf.js`,
Configurações > Desempenho, `tools/check-perf.mjs` (self-check of the adaptive rules, `node tools/check-perf.mjs`).

## Hardware profile (startup, ~0.1-0.3 s)
`detectHardware()`: `hardwareConcurrency`, `deviceMemory`, WebGL renderer name (Brave hides it: "unknown",
not "weak"), a short integer/float loop on the main thread (score 1 = 8 ms on the reference 12-thread
Raptor Lake laptop) and the same loop on 1 and then N workers at once, to count the cores that really run
in parallel (Brave reports a random, lower `hardwareConcurrency`). The best result seen in this browser is
kept in localStorage (`ps2web.hwBest`): a machine busy at load time is not misread as a weak one.

Tiers: **basico** (software GL, <= 2 cores, <= 2 GB, score < 0.35, or <= 4 cores with a weak GPU / score < 0.6),
**medio** (<= 4 cores, weak GPU, <= 4 GB or score < 0.6), **alto** otherwise.

`pickDefaults()`:

| | alto | medio | basico |
|---|---|---|---|
| internal resolution | 2x (1x on a weak/old iGPU name) | 2x (1x weak GPU) | 1x |
| CRT | full | full | cheap shader (one texture read, no bloom/aberration/noise/flicker) |
| 3D shelf | as before | no MSAA, pixel ratio <= 1.5 | no MSAA, no shadows, pixel ratio 1 |
| fullscreen TV pixel ratio | <= 2 | <= 1.5 | 1 |
| MTVU (VU1 thread) | on with >= 3 cores | same | same |
| audio queue | 100 ms | 100 ms | 200 ms |

Only `resFactor` and `crt` are settings; they take the profile value until the player changes them (then
`touched` keeps the player's value, also across "Automático" off/on). Settings saved before this existed
count as touched when they differ from the old defaults.

## Adaptive quality (while playing, "Automático" on)
Every 2 s the per-vblank timeline (`getTimeline`) gives speed (vblanks/s), limiter sleep share, GS busy and
GS wait shares. Slow = limiter slept < 2% for 3 windows in a row -> next step down; headroom = limiter >= 25%
for 5 windows -> undo the last step. Hysteresis: a step-up followed by "slow" within 20 s blocks step-ups for
30 s, doubling up to 10 min. Steps, in order: cheap CRT shader, resolution 1x, frame skip 1 (1 of 2 frames
not drawn). Resolution and frame skip are only tried when the GS is the bottleneck (GS busy > 80% of the
vblank, VM/VU1 waiting on the GS > 5%) or with <= 4 cores. After a step the first window is ignored (a
resolution change rebuilds the GS framebuffers) and the next 3 must be >= 3% faster (frame skip: 20%), or
the step is undone and not retried in this game session. The player choosing a resolution by hand removes
the resolution step. State shown under Desempenho ("Agora: 42 quadros/s · reduzido: ...").

Frame skip only skips host drawing/present of whole frames (see the web-perf commit): the emulated machine
runs the same, so game speed and audio are unchanged and frame hashes with frame skip off are unchanged.

## Measurements (2026-10-20)
Test Brave over CDP, bench.html (new params `&res=N`, `&auto=1` = perf.js profile + adaptive with the
resolution and frame-skip steps, `&frameskip=N`), limiter on, 40 s per run after 20 s of warm-up, one run
each, machine shared with other agents' builds/benches (load average 8-15): differences under ~10% are noise.
vbl/s = emulated vblanks per wall second; p95 = 95th percentile of wall ms per vblank.

**Correctness** (`hash=300&vu1thread=0&nolimit=1`, sha1 of the 300 per-vblank hashes, first 12): identical for the
previous published build (web-perf 83f0271f) and 1654ec22 with frame skip off: car 58750a0d17a4, play
c936a1d9d596, gow-fight 9ceb425f418a, mtvu-ffx f7d7efe335e6. mtvu-ffx is also identical with `&frameskip=1`.
(The 8-hex digests in OPTIMIZATION.md were made by a runner lost in the reboot; same states, other digest.)

**Full power** (this laptop, profile "alto": 2x, full CRT, MTVU on): previous build `&res=2` vs new build `&auto=1`

| state | before vbl/s, p95 | after vbl/s, p95 |
|---|---|---|
| play.zip | 35.2, 66.5 ms | 40.7, 50.1 ms |
| gow-fight.zip | 41.2, 62.3 ms | 42.8, 50.2 ms |
| mtvu-ffx.zip | 45.6, 60.9 ms | 50.6, 47.1 ms |

Not slower (the gain is mostly load noise; no step fired, as expected at full speed or VM-bound).

**Simulated weak machine**: `Emulation.setCPUThrottlingRate` 4x, MTVU forced off, 1x. Caveat: Chromium throttles
only the page's main thread (workers answer "Operation is only supported for pages, not workers"), so the
emulator threads run at full speed and this mostly tests the profile detection (main-thread benchmark ->
score 0.26-0.43, tier basico/medio) and the main-thread cost. Off = no auto; auto = profile + adaptive.

| state | off vbl/s, p95 | auto vbl/s, p95 |
|---|---|---|
| play.zip | 23.6, 102.8 ms | 25.8, 88.6 ms |
| gow-fight.zip | 15.4, 112.2 ms | 18.3, 68.8 ms |
| mtvu-ffx.zip | 41.4, 61.4 ms | 47.4, 60.1 ms |

In these runs the adaptive never stepped (bench tabs are background tabs and the adaptive paused while
`document.hidden`; bench.html now passes `hidden: () => false`). The VM thread is the bottleneck there
(GS busy 35-49%, GS wait ~0), where neither 1x nor frame skip can help, and the adaptive leaves them alone
(re-run of gow-fight weak-auto with the fix: no step; that run was at 4.6 vbl/s under load 15, not comparable).

**GPU-bound case** (the one frame skip and 1x are for): gow-fight at `&res=4`, no throttling:
- off: 10.7 vbl/s, p95 356 ms (GS busy 97%, VM waiting on the GS 66% of the time);
  an earlier, less loaded run: 18.6 vbl/s, p95 69.7 ms.
- auto: resolution step at 13 s, kept; 25.2 vbl/s, p95 88 ms; afterwards GS busy 46%, wait 1.5% -> no frame skip.
- `&frameskip=1` fixed (earlier run, same conditions as the 18.6 one): 33.0 vbl/s, p95 73.5 ms, 259 frames
  skipped in 40 s.
- The first version of the trial rule judged a step on the 3 windows right after it; the resolution change
  rebuilds the GS framebuffers and that window is slow, so 1x was undone and frame skip kept instead (42.5
  vbl/s but at 4x with half the frames). Now the first window is ignored.

Runner: CDP script in the session scratchpad (opens one background tab in the test Brave at [::1]:9222,
throttles, runs bench.html, reads `getTimeline`, closes its tab); not kept in the repo.

## Limits / next
- No real low-end machine was tested; CPU throttling cannot slow the emulator workers. Worth a run on a
  4-core laptop or with the test Brave pinned to 2-4 cores (taskset) when nobody else uses it.
- The GPU name list for "weak GPU" is a guess (old Intel HD/UHD, mobile GPUs); Brave hides the name anyway.
- The public Play.js still prints "Version 0.77-56-g83f0271f": the version string comes from `git describe` at
  CMake configure time and the build was only relinked. The source is web-perf 1654ec22 (`setFrameSkip` present).
