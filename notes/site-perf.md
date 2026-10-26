# Site (index.html) vs bench: FPS gap and black flashes - working notes

## 2026-10-26: God of War fights at ~20 fps on the site, bench "77 vbl/s"

Report: GoW fights on index.html at ~20 fps with drops, while bench.html on gow-fight.zip measured ~77 vbl/s
unlimited on the same laptop (i5-13420H: 4 P-cores/8 threads + 4 E-cores, Intel iGPU, 16 GB; user screen
3440x1440 at 100 Hz).

### Finding: the gap is mostly units, the limit is the VU1 thread
- bench.html's number is **vblanks/s** (emulated time); the site HUD shows **frames/s** (GS frames presented).
  With VU1 on its own thread (MTVU) the VM keeps ~55-60 vblanks/s while the VU1 thread is 95-98% busy and the
  game only finishes a frame every ~2.5 vblanks: bench.html itself shows the same ~20-27 frames/s.
- Proof: bench `res=2&nolimit=1&vu1thread=0` (VU1 on the VM thread): 21.3 vblanks/s and 21.3 frames/s (one frame
  per vblank, game in slow motion). MTVU: ~57 vblanks/s, ~22 frames/s. The VU1 thread costs ~40-45 ms per GoW
  combat frame on this CPU; 60 fps needs ~2.6x faster VU1 code (emulator work, see notes/vu1b.md), 30 fps ~1.4x.
- The VU1 thread runs on P-cores (E-core samples 2-8%), GPU process CPU ~50% in every variant (mostly the GS).

### Measurements
Runner: scratchpad `siteperf/run.mjs` (own tab on the test Brave, activated + focus emulation, device metrics
3440x1440 dpr 1 = the user's screen, limiter on, state loaded, 15 s warm-up then 30 s; frames/s = `onGsFrame`
bitmaps, vblanks/s from `getTimeline`). Each run's fight goes differently (the state is not deterministic), so
single runs vary ±15%; medians of 2-11 runs. New dev param: `index.html?play=<file in games/>&state=<OPFS file>`
boots through the normal play path and loads a bench state (`window.__site` exposes the page parts).

| variant (gow-fight, 3440x1440) | runs | vblanks/s | frames/s |
|---|---|---|---|
| bench.html res=2 | 5 | 58 | 23.4 |
| bench.html res=1 | 3 | 58 | 36.0 |
| site default (2x, CRT, auto) before | 8 | 55.5 | 21.5 |
| site, TV never redrawn (`tv.update = () => false`) | 11 | 57 | 23.4 |
| site, texture upload only (no draw) | 5 | 57 | 22.8 |
| site, TV on its own small canvas (no full-canvas redraw) | 4 | 55 | 22.9 |
| site, cheap CRT shader | 3 | 56.5 | 22.2 |
| site, 1x (manual) | 2 | 58 | 29.9 |
| **site default after** (adaptive steps to 1x after ~20-30 s) | 3 | 59 | **29.7** |

Smaller window (1253x1295), limiter off: bench res=2 45.7/59.5 vbl/s (19.4/21.7 fps), site 51.8/59 (18.1/20.3),
site without TV draws 53/67 (18.7/23). Main thread busy: site 4-7%, bench 3-4%.

Per suspect:
- three.js scene / TV redraw / CRT passes / texture copy: within noise (<= ~8% frames/s, site 21.5 vs bench 23.1).
  The scene already redraws only the screen while playing (earlier work below). A version drawing the screen on
  a separate small canvas (no MSAA resolve/copy of the 3440x1440 canvas per frame) measured the same, so it was
  not kept.
- **resFactor 2 vs 1: the one big lever.** 1x gives +30-55% frames/s (bench 23 -> 36, site 21.5 -> 30) although the
  GS thread is only ~55% busy at 2x: on this integrated GPU the GS load at 2x slows the CPU threads (shared power
  budget / memory), and the VU1 thread is the limit. Brave hides the GPU name, so the profile can't tell an iGPU.
- Auto profile: picked "alto" (2x, full CRT). The adaptive mode judged speed by the frame limiter (it sleeps
  10-15% here: full vblank speed), so it never stepped the resolution; it sometimes tried the cheap CRT (useless).
- Frame limiter / audio pacing: limiter on vs off doesn't change frames/s (VU1-bound).
- Cold block cache: not measured (the test profile's cache is warm; compile share 0.1-0.3%).
- Main-thread jank: 4-7% busy, no long tasks seen in the frame-time p95 (36-50 ms on both pages).

### Change: adaptive mode reacts to a saturated VU1 thread (public/js/perf.js)
- Slow = limiter < 2% **or VU1 thread > 90% busy** (MTVU: the game drops frames at full vblank speed).
- Steps are judged by **frames shown per second** (`hooks.frames`, the site passes `emu.frameId`), frame skip by
  vblanks/s as before (it hides frames on purpose).
- With the VU1 thread saturated, the resolution step (1x) may be tried (not frame skip: it only drops host drawing).
  A step taken for the VU1 thread must bring >= 3% more frames shown, even if the VU1 thread is no longer
  saturated, or it is undone for this game session. Status line shows frames/s.
- `tools/check-perf.mjs`: VU1-saturated cases (1x kept when it shows more frames, undone when not, no frame skip).

## 2026-10-15: first site vs bench pass

Emulator branch `site-gs` in `play-sitegs/` (worktree of the Play! fork, based on `web-perf` fbed76d8).
Test build: `public/emu-sitegs/` (release, same flags as `public/emu`).

## Causes (measured)
1. **FPS gap.** The GS thread used a WebGL context created on the main thread, so every GL call was
   proxied to the browser main thread (`-sOFFSCREEN_FRAMEBUFFER`; glDrawElements, glGen*, glGet*,
   glReadPixels, glVertexAttribPointer... synchronously). On the bench this alone kept the main thread
   25-40% busy. On the site the main thread (and the GPU) also rendered the whole three.js scene every
   frame (PCF soft shadows, physical materials, MSAA, 1080p), and the GS thread and then the VM waited.
   In-page A/B in one session (FFX intro, old build): scene rendering on 18-39 vbl/s, scene stopped
   53-58, texture upload alone (no scene) 50-54, so the cost was the scene render, not the copy.
2. **Black flashes.** `CGSH_OpenGL::FlipImpl` clears the visible framebuffer and then draws the frame;
   with the calls proxied to the main thread both ran in separate main-thread tasks, so a compositor
   frame or the TV's `texImage2D(canvas)` taken in between got a black frame. Luma probe (every rAF,
   32x24 copy of `#outputCanvas`, the TV's source): GTA boot/intro on the site, old build: 37 black
   frames between lit frames in 60 s (pattern 15,15,0,15,15); FFX on the bench: 1 in 40 s.

## Fixes
- Emulator (`Source/ui_js/GSH_OpenGLJs.*`, `Main.cpp`): the GS thread creates its own WebGL2 context on
  an `OffscreenCanvas` (registered in `specialHTMLTargets` so `emscripten_webgl_create_context` finds
  it, `PROXY_DISALLOW`), runs GL calls directly, and at each present transfers the canvas as an
  ImageBitmap to the main thread (`postMessage({cmd:'callHandler', handler:'onGsFrame'})`).
  Gotcha: Chromium creates a worker's WebGL context through the main thread, so creating it in
  `InitializeImpl` (which `initVm` waits for) deadlocks; `InitializeImpl` is empty and the context is
  made by a GS call queued at the end of `initVm`, not waited for.
- `public/js/emulator.js`: `mod.onGsFrame` puts each bitmap into `#outputCanvas` with a
  `bitmaprenderer` context (only whole frames are ever shown); `init()` waits for the first frame
  (the GS is ready then). Older builds still work (their `initVm` takes a WebGL context on the canvas,
  so `bitmaprenderer` is null and nothing waits). `frameId()` changes on each new frame.
- `public/js/console-scene.js`: renderer with `preserveDrawingBuffer`; objects on `LIVE_LAYER` (1)
  are redrawn alone over the previous frame when no tween runs and nothing called `invalidate()`
  (no clear: `scene.background` is nulled for that pass, a Color background always clears; lights are
  culled by layer, so no shadow pass). `onFrame` callbacks returning `false` skip even that.
- `public/js/crt-tv.js`: `frameId` option; the texture is uploaded only for a new frame; `update()`
  returns whether the screen changed; the fullscreen renderer also draws only then (an undrawn WebGL
  canvas keeps its last frame). The screen mesh is on layer 1.

## Results (Brave CDP instance, viewport 1920x1080 dpr 1, warm block cache, 30-40 s windows,
median vbl/s, alternating runs; machine shared, load 2-7)
| Scene | site before | site after | bench before | bench after |
|---|---|---|---|---|
| FFX 3D intro (mtvu-ffx.zip) | 20, 19 | 36, 32 | 39.5, 36 | 37, 37 |
| GTA play.zip (free roam) | 14, 14 | 28, 32, 24 | 18.5, 26 | 31, 30.5, 26 |
| GTA boot -> intro (no state, t=5..45 s) | 20.5, 23 | 44, 38 | 45, 45 | 39, 45 |
Main thread busy (CDP TaskDuration/wall): site 0.41-0.47 -> 0.03-0.07; bench 0.24-0.40 -> 0.02-0.03.
Decomposition (FFX, site): new site + old emulator 32, 34; new site + new emulator 32, 32: on the site
the scene change is most of the gain; the GS change matters most for GTA (bench 18.5/26 -> 31/30.5).
Black frames (luma probe): after the change 0 in GTA boot 60 s (2559 frames), FFX bench 40 s, FFX site.

## Checked on the new site + build
Keyboard (Enter opened the GTA pause menu), F5/F8 save/load, CRT toggle, fullscreen (overlay
fallback; GTA 48-50 vbl/s in the pause menu), Esc out of fullscreen, power off / back to library.

## Known issue (not from this change)
"Trocar jogo" from GTA (after a state load) to FFX: the second boot stalls at 0 vblanks, with the old
site + `public/emu` too. Not investigated here.
