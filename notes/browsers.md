# Cross-browser check (2026-10-16)

Tested the launcher (`/`) and `bench.html` outside Brave, on this Linux box (Intel Gen12 iGPU, 15 GB RAM, heavy memory pressure from other apps: ~3-4 GB available).

Browsers installed in the user's home, with dedicated profiles:
- Chrome for Testing 155.0.8059.84 in `~/.local/opt/chrome` (zip from googlechromelabs, md5 checked against the GCS `x-goog-hash`), profile `~/.config/ps2-test-chrome`, driven over CDP on port 9333.
- Firefox 158.0 in `~/.local/opt/firefox` (ftp.mozilla.org tarball; SHA256SUMS signature verified with the Mozilla release key 14F2 6682 D091 6CDD 81E3 7B6D 61B7 B526 D98F 0353, tarball sha256 matched), profile `~/.config/ps2-test-firefox`, driven over WebDriver BiDi on port 9334.

Both ran with autoplay allowed (Chrome `--autoplay-policy=no-user-gesture-required`, Firefox `media.autoplay.default=0`), so the AudioContext gesture rule was not exercised.
Each game was booted from scratch (no save states), with Enter/Z pressed every 1.5 s for ~70 s. vbl/s is the mean of the last 45 s of `bench.prof`.

| | Chrome 155 | Firefox 158 |
|---|---|---|
| crossOriginIsolated / SAB | yes | yes |
| WebGL2 on OffscreenCanvas in a worker | yes | yes |
| AudioWorklet | yes | yes |
| WebGPU (`navigator.gpu`) | yes, adapter "intel gen-12lp" | no (`navigator.gpu` missing; Firefox ships WebGPU on Windows/macOS only) |
| GTA SA vbl/s | 47.0 | 35-43, then dropped as memory ran low |
| FFX vbl/s | 59.4 | 60 for ~25 s, then 0 (emulator worker died: out of memory) |
| GoW vbl/s | 59.0 | 0 (out of memory during boot) |
| Audio | running, 0-6 underruns | running; 1-6 underruns, then silent after the crash |
| F5 / F8 (launcher) | "Estado salvo." / "Estado carregado." | same (GTA) |
| "Trocar jogo" GTA -> GoW | works, GoW title screen at 56 FPS | back to the shelf works; GoW then hits the out-of-memory error (0 FPS) |

## Issues

- Firefox, emulator side: `JIT batch module failed: InternalError: out of memory`, then
  `worker sent an error! .../emu/Play.js:8: out of memory`, which kills the emulator (vbl/s 0, audio silent).
  It happens in FFX after ~25 s and in GoW during boot. GTA survived 70 s but slowed down while memory got low.
  The machine had only ~3.2 GB available at the start, so system memory pressure plays a part, but Chrome
  ran all three games on the same machine without it. Likely Firefox's wasm limits (executable code per process,
  or the address space it reserves for each compiled module or shared memory) are hit by the EE JIT's many small modules.
  Not fixed. Next steps: retest Firefox with more free RAM; see if the EE batch size changes it (`&eebatch=`) and compare `about:memory` before and after.
- Chrome, emulator side: the GS context logs `WebGL: INVALID_OPERATION: texParameter: no texture bound to target` and
  `INVALID_ENUM: texParameter: invalid parameter name` until Chrome reports "too many errors". Rendering looks correct.
  Probably a texParameter call made with no texture bound, or with a pname that WebGL2 rejects; harmless but worth cleaning up.
- Site side (fixed): no favicon was declared, so Chrome logged a 404 for `/favicon.ico` on every load.
  `index.html` now has `<link rel="icon" href="data:,">`.

The driver script (CDP + BiDi, Node built-in WebSocket) lived in the session scratchpad and was not committed.
