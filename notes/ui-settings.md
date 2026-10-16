# Settings panel (branch `ui-settings`)

Site worktree `~/Projetos/ps2-web-ui` (branch `ui-settings`), emulator worktree `~/Projetos/ps2-web/play-ui`
(Play! fork, branch `ui-settings`, based on `web-perf` cd7a2a58 = the build in `public/emu` before this work).
`public/emu/Play.{js,wasm}` in this branch is a TEST build of play-ui `ui-settings` f6a9dee5 (= web-perf 956de846
+ the settings API, release, `-msimd128`), committed so the branch can be reviewed as is; the main agent decides
what to publish. `public/emu-uiprof/` (ignored by git) is the `-DPROFILE=ON` build of the same commit
(`?emu=uiprof`, has `gsBusyMs` in `getProfile()`), built in `play-ui/build_cmake/build/wasm-prof`.

## Status (2026-10-16 ~11:55)
- Done: panel, emulator API, persistence, live apply; rebased on origin/main 800364b (pause on leave);
  play-ui merged web-perf b3f4a74f (GoW green hack + dual-layer fast path) and rebuilt; `public/emu` is
  play-ui `ui-settings` b1674371 (release, `-msimd128`). Default internal resolution is now 2x (measured below).
- "Tela cheia" click doing nothing: not reproduced. Scripted repro (GTA, panel -> change resolution -> Esc ->
  click Tela cheia, 6 times with 1x-4x, pointer/click logging): every time the dialog was closed after Esc,
  the click reached `#b-fs` and the page went fullscreen with the overlay. The two old failures stay
  unexplained (most likely the CDP click landed while the modal was still open, so it hit the backdrop,
  which closes the panel). Watch for it in manual use.
- Open: GoW green artifacts in the fight state should be gone with the web-perf hack, not re-checked on
  the site. Real gamepad check if one is available.

## What the user gets
- "Configurações" in the HUD and in the shelf header (and the gamepad PS/Home button) opens a modal
  `<dialog>`: Imagem, Efeito CRT, Som, Controles, Avançado. Changes apply live and are saved in
  localStorage (`ps2web.settings`, sanitized on load, every access in try/catch).
- Imagem: internal resolution 1x-4x, forced bilinear filtering, widescreen 16:9, "preencher a tela"
  (Play!'s FILL presentation mode instead of FIT). Disabled with a note on builds without the API.
- Efeito CRT: on/off (same state as the HUD button and the fullscreen button) and three strengths
  (scanlines + aperture mask, curvature + chromatic aberration, bloom), 0-200 %, 100 % = previous look.
- Som: volume 0-100 % and mute (a GainNode after the AudioWorklet).
- Controles: table of every PS2 control with its keyboard key and gamepad button; click a cell and press
  the new key / gamepad button (Esc, ◯/B or 10 s cancel). A key/button already used by another control
  is swapped with it. "Restaurar controles padrão". Connected gamepads are listed. Stick directions can
  be remapped on the keyboard; the gamepad sticks stay the analog sticks.
- Avançado: frame limiter on/off (`Module.setFrameLimit`).
- Gamepad in the panel: D-pad / left stick move focus, left/right change sliders and selects, ✕/A
  activates, ◯/B closes. While the panel is open the gamepad does not reach the game; it is given back
  once every button is released (the B that closed the panel never reaches the game).
- The HUD key hint follows the keyboard mapping.

## Emulator API (play-ui `ui-settings`)
- `setGsOptions(resolutionFactor 1-4, forceBilinear, widescreen, presentationMode)`: sets the Play!
  preferences (`renderer.opengl.resfactor`, `renderer.opengl.forcebilineartextures`, `renderer.widescreen`,
  `renderer.presentationmode`) and queues on the GS thread: resize of the GS OffscreenCanvas to
  640x480 (854x480 widescreen) x factor, new presentation params, `NotifyPreferencesChangedImpl()`
  (framebuffers rebuilt at the new scale). The page receives bigger ImageBitmaps; `emulator.js` resizes
  `#outputCanvas` to each frame's size and `crt-tv.js` reallocates its texture when the size changes
  (three.js textures cannot change size in place) and takes the picture aspect from it (16:9 output
  is letterboxed on the 4:3 tube, pillar/letterboxed to 16:9 in fullscreen). The CRT shader keeps 240
  scanlines whatever the frame size.
- `setInputBindings(keys, pad)`: `keys` = `[[KeyboardEvent.code, PS2 button, positive], ...]`,
  `pad` = PS2 button per W3C standard gamepad button (-1 = none; 16 is never bound by the page).
  Replaces all bindings and releases held keys. `setGamepadEnabled(bool)`.
- `Module.setAudioVolume(0..1)` / `getAudioVolume()` (WebAudio.js, 15 ms ramp).
- Bug fixed on the way: the default keys for L1/L2/L3/R1/R2/R3 were `"Key1"`.. (`KeyboardEvent.code` is
  `"Digit1"`), so those buttons never worked from the keyboard.
The page feature-detects each function, so older builds keep working (their options are disabled).

## Upscaling cost
Site on :8081, Brave CDP 1280x720, release build b1674371, `bench-run`. Per run: boot, F8 state, 40 s warm-up,
then per factor: set it in the panel, F8, skip 40 s, measure 30 s (vblanks / wall time from `getProfile()`).
Factor order 1,3,2 | 4,2,1 | 4,3 (two samples per factor, shuffled ABAB), machine shared (load ~5).
| scene | 1x | 2x | 3x | 4x |
|---|---|---|---|---|
| GTA play.zip, vbl/s (samples) | 31.8, 27.7 | 31.5, 31.9 | 27.7, 35.5 | 26.4, 26.0 |
| GTA median | 29.8 | 31.7 | 31.6 | 26.2 |
| FFX mtvu-ffx.zip, vbl/s (samples) | 56.0, 58.9 | 53.7, 56.3 | 53.2, 54.7 | 48.4, 50.0 |
| FFX median | 57.5 | 55.0 | 54.0 | 49.2 |
| GPU awake (1 - RC6), typical | ~31 % | 44-67 % | 55-59 % | 52-96 % |
2x costs nothing measurable on GTA and ~4 % on FFX (inside the run-to-run noise of ~4 vbl/s); 4x costs
10-15 %. Default = 2x. GPU clock stays far below max (<= 480 of 1400 MHz) at every factor.
Script: scratchpad ui/run_site.py (env GAME, FACTORS, SECS, SKIP, WARM) driven by ui/upscale.sh.

## Checks done (Brave CDP instance, 1280x720 viewport)
- Panel from the shelf at desktop and phone width (390 px: full-screen sheet, no horizontal scroll);
  with the old build the emulator sections show "not supported" and are disabled.
- Resolution factor: `#outputCanvas` follows 640x480 / 1280x960 / 1920x1440 / 2560x1920, TV and fullscreen
  show the sharper frame; widescreen gives 854x480 and a letterboxed picture on the tube.
- Persistence: settings (keys, volume 0.4, bloom 0) survive a reload; `getAudioVolume()` = 0.4.
- Keyboard remap through the panel capture (Start -> P, Down -> M); reset to defaults works.
- Gamepad (stubbed): PS/Home opens the panel, D-pad moves focus, right on the resolution select changes it,
  A on a binding + Y assigns Y to Start (Triangle takes the old Start button), B closes; in GTA the remapped
  Y opened the pause menu and button 9 (now Triangle) closed it.
- Fullscreen via a CDP click: real fullscreen (DIV), CRT button toggles and syncs with the HUD button,
  Esc leaves it (no overlay left). F5/F8 work. "Trocar jogo" GoW -> GTA -> FFX runs (59 vbl/s in FFX).
- Frame limiter toggle reaches the emulator, but GTA/GoW pause menus are VM-bound (no change visible);
  needs a light scene to show >60 vbl/s.
- Keyboard remap inside a game: the CDP key presses were too short for GTA at first; with 0.3-0.4 s holds the
  run is in ui-f3-gta-*.png (not yet reviewed).

## Not done / limits
- The shelf itself is not gamepad-navigable (only the panel is); the PS/Home button opens the panel.
- Real gamepads were not available: panel navigation, pad capture and the emulator's pad remap were
  checked with a stubbed `navigator.getGamepads()` (both the panel and Play!'s poll read it).
- "Original" presentation mode is not offered (1:1 pixels makes no sense once the output is upscaled).
