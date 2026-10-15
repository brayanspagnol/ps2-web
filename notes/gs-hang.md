# GS hang on GTA SA cold boot (site-gs / OffscreenCanvas GS) - working notes

Status (2026-10-15): investigation paused at the very start (stopped by request). No code changed,
nothing committed, no runs done yet.

## Bug
Builds containing 3925aa4b (public/emu-sitegs, emu-eeqbase3, emu-eeqg) hang the PAGE MAIN THREAD
20-110 s into GTA San Andreas' intro movies on a cold boot (no save state). CDP Runtime.evaluate on the
page times out, renderer CPU is low (blocked, not spinning). fbed76d8 (public/emu, ex emu-fix) boots
fine for 120 s. Repro: `bench.html?emu=emu-sitegs&game=GTA%20San%20Andreas%20(Europe).iso`, foreground tab.

## What 3925aa4b changes (the whole diff: GSH_OpenGLJs.{h,cpp}, Main.cpp)
- `initVm` no longer creates a WebGL context on `#outputCanvas`; it queues
  `gs->InitializeContext()` on the GS thread (not waited for).
- `InitializeContext` (GS thread): `new OffscreenCanvas(640,480)` registered as
  `specialHTMLTargets["#gsCanvas"]`, `emscripten_webgl_create_context` with PROXY_DISALLOW.
- `PresentBackbuffer` (GS thread): `GLctx.canvas.transferToImageBitmap()` and
  `postMessage({cmd:'callHandler', handler:'onGsFrame'}, [bitmap])`; the page draws it with a
  `bitmaprenderer` context (public/js/emulator.js `mod.onGsFrame`).
- Main.cpp has no other proxied/sync call into the GS (grep of SendGSCall/sync/MAIN_THREAD_EM_ASM).

## Hypotheses (unverified, in order of what to check)
1. Something on the main thread waits synchronously on the GS or VM thread (futex / Atomics.wait,
   e.g. a `SendGSCall(..., true)` or a sync call through CPs2VmJs from an exported function the page
   calls periodically: frameId/stateStatus/getProfile/bench stats), while that thread waits on the main
   thread (a proxied emscripten call: `emscripten_webgl_*` that falls back to proxying, `MAIN_THREAD_EM_ASM`,
   `emscripten_set_canvas_element_size` on a resize/mode change, or a GL call that Chromium routes through
   the main thread). Intro movies = frequent GS mode/resolution changes -> look at the CGSH_OpenGL paths
   that resize the canvas/framebuffer or recreate GL objects.
2. `onGsFrame` handling on the page (`bitmaprenderer.transferFromImageBitmap`) throwing or piling up
   bitmaps (hundreds of un-closed ImageBitmaps -> GPU memory pressure / GPU process stall). Check
   Runtime.exceptionThrown and memory.
3. Old builds proxied all GL to the main thread, so any code that assumed "GL context lives on the
   main thread" (e.g. readbacks via glReadPixels for GS RAM downloads in the movie path, or
   `emscripten_webgl_get_current_context` checks) may now take a different branch.

## Next steps (exact)
1. Debug build with names: in play-sitegs, relink release with `--profiling-funcs`
   (scratchpad tools/linknames.sh from the ee-jit work, or add it to CMAKE_EXE_LINKER_FLAGS in a separate
   build dir), deploy to public/emu-sitegsdbg/. Wrap the build in the shared bench.lock (`flock -s`).
2. Reproduce under `flock -o` bench.lock in a NEW foreground tab on http://[::1]:9222 (never 127.0.0.1),
   Emulation.setFocusEmulationEnabled(true), unique run id in the URL. Before it hangs, enable on the page and
   on every worker target (Target.setAutoAttach flatten): Runtime.exceptionThrown, Log.entryAdded, Debugger.
3. When the page stops answering: Debugger.pause on the page target (works even when Runtime.evaluate
   times out if the thread is in a wait; if not, use the renderer's `kill -SIGQUIT`-free route:
   `gdb`-less -> record a Performance trace from the browser target, or check `/proc/<renderer>/task/*/wchan`
   to see which threads are futex-waiting). Then Debugger.pause on each worker (VM, GS, VU1, audio) and read
   call frames. Identify what the main thread waits on and who waits on it.
4. Fix the cycle at its root (likely: make the GS-thread side never need the main thread, or make the main
   thread's call asynchronous), not a timeout.
5. Verify: GTA cold boot >= 4 min responsive (sample bench.prof every 20 s); play.zip, car.zip; FFX
   mtvu-ffx.zip >= 3 min; index.html flow without black flashes (site-perf.md luma probe); F5/F8.
6. Only then: play-src web-perf `git merge site-gs` + `git merge ee-jit` (f08f5db1), deps/CodeGen at
   d8c5b47, build wasm-simd, deploy to public/emu-cand/, repeat step 5 and deterministic timing
   (`&time=100,600&vu1thread=0&nolimit=1`). Do not overwrite public/emu/.
