# Site (index.html) vs bench: FPS gap and black flashes - working notes

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
