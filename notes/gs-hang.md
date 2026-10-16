# GS "hang" on GTA SA cold boot (site-gs / OffscreenCanvas GS) - working notes

Status (2026-10-16): root cause found and fixed (Play fork, branch `site-gs`, commit 0d7c07ea, pushed).
Test builds: `public/emu-sitegsfix/` (release), `public/emu-sitegsfixdbg/` (same, `--profiling-funcs`).

## Symptom
Builds containing 3925aa4b (public/emu-sitegs, emu-eeqbase3, emu-eeqg) stopped answering 20-140 s into
GTA San Andreas' intro movies on a cold boot (CDP Runtime.evaluate timed out, renderer CPU low).
fbed76d8 (public/emu) did not.

## Root cause: a shared-memory leak, not a deadlock
- It was never a hang: the page's renderer process was killed by the kernel OOM killer
  (`Inspector.targetCrashed` on the page; `journalctl -k`: global OOM, `shmem:10214900kB`). The OOM
  killer also took down unrelated processes on the machine (vesktop, other Brave processes).
- `/proc/meminfo` Shmem grew ~90 MB/s from the boot on (~1.2 MB = one 640x480 RGBA frame per present).
  Closing the tab freed it.
- Cause: with 3925aa4b the GS thread renders on its own OffscreenCanvas and posts each presented frame as
  an ImageBitmap (`transferToImageBitmap`) to the page. Chromium frees the memory behind a transferred
  bitmap with a task posted back to the worker that created it. The GS thread is an emscripten pthread that
  blocks on its mailbox forever and never returns to its event loop, so those tasks never ran.
- Standalone repro (`public/gsleak-test.html`, removed afterwards): worker WebGL2 OffscreenCanvas ->
  transferToImageBitmap -> postMessage -> page `bitmaprenderer`. Worker that never yields (Atomics.wait
  loop): Shmem +120 MB/s. Same worker driven by setTimeout or by a MessageChannel self-post: flat.
- Why it looked like a hang during the movies: that's simply when memory ran out (time depends on free
  RAM at the start).

## Fix (Source/gs/GSHandler.{h,cpp}, emscripten only)
`CGSHandler::ThreadProc` returns to JS after each flip (`m_flipped`, set by `CGSHandler::FlipImpl`, is
otherwise only used by the non-threaded `ProcessSingleFrame`) and is resumed by a MessageChannel task on
the same worker (`GsJs_ResumeSoon`: no setTimeout clamping, no relay through the main thread like
`emscripten_set_immediate`/proxying from a worker would). `emscripten_runtime_keepalive_push/pop` keeps
the worker alive across the yield; when `m_threadDone` is set the loop returns with the counter at 0 and
`callUserCallback`/`maybeExit` exits the thread normally, so `join()` still works.

## Verification (public/emu-sitegsfix, Brave CDP [::1]:9222, visible tab, exclusive bench lock)
- GTA cold boot 260 s: responsive throughout, 36-50 vbl/s (dips while loading), Shmem flat at ~1.3-1.5 GB
  (system-wide); before: +90 MB/s and renderer OOM-killed at ~130 s.
- GTA play.zip 120 s (16-34 vbl/s), car.zip 120 s (12-38 vbl/s): no exception, Shmem flat.
- FFX mtvu-ffx.zip 200 s: 38-60 vbl/s, no exception.
- index.html: GTA picked on the shelf, disc/TV animation, boot, F5 ("Estado salvo.") and F8 ("Estado
  carregado."), emulation continues after the load. Luma probe on #outputCanvas: 0 black frames between lit
  frames (3000+ probed frames in the first run). Caveat: Brave's rAF on this desktop drops to ~1 Hz at times
  (window occluded?), so the probe saw fewer frames in the second run.

## Tools (scratchpad, session-specific)
`tools/hang.py <url> <s> <log>`: visible tab, auto-attach to workers (Runtime/Log only; Debugger.enable on
the workers tiers wasm down and slowed GTA to ~15 vbl/s, so it is only enabled when pausing), logs Shmem /
MemAvailable / per-process RSS every 5 s and aborts below 2.5 GB available. `tools/site.py` drives index.html.

## Integrated candidate (2026-10-16)
play-src `web-perf` = cd7a2a58 (fast-forward to site-gs 0d7c07ea, then `git merge ee-jit` f08f5db1;
deps/CodeGen at d8c5b47), pushed to fork. Release wasm-simd build in `public/emu-cand/` (public/emu untouched).

Regressions on emu-cand (same method as above): GTA cold boot 260 s responsive, 32-50 vbl/s, Shmem flat;
play.zip 120 s 30-40 vbl/s; car.zip 120 s 25-46 vbl/s; FFX mtvu-ffx.zip 200 s 35-60 vbl/s; no worker
exceptions; index.html flow + F5/F8 OK, luma probe 0 black frames between lit frames in ~5300 rAF frames.

Measurements (machine NOT quiet: load 3.4-7.4, another agent active; alternating runs):
- In-game play.zip (MTVU on, limiter on, median vbl/s t=40-72 s): public/emu 29, 22, 24 -> emu-cand 32, 32, 34.
- Deterministic play.zip (&time=100,600&vu1thread=0&nolimit=1, wall ms/vbl), 3 rounds:
  eeqbase3 41.82 / 42.93 / 41.48, eeqg 40.52 / 41.29 / 41.32, cand 36.69 / 36.38 / 37.10.
  (public/emu has no eeTimeAfterLoad. eeqg has the same EE code as cand but the GS leak; the gap between
  them, ~10%, is presumably the leak's memory pressure; yesterday on a quiet machine eeqg measured 34.43.)
