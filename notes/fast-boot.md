# Game start time ("long black screen after inserting the disc") - working notes

Site: `public/index.html` (`play()`), `public/js/emulator.js` (fast start). Emulator: Play fork branch
`fast-boot` (worktree `play-boot/`, based on web-perf 53b18fe3), test build `public/emu-fastboot/`,
not published to `public/emu/`.

## How it was measured
Driver (scratchpad, session-specific): opens index.html in its own tab on the test Brave ([::1]:9222),
viewport 1920x1080, clicks a game on the shelf and records, on the page clock from the click:
- `lit`: first non-black frame of `#outputCanvas` (32x24 copy every rAF, max luma > 24 or mean > 4);
- `hud`: when `play()` finished (TV signal on, HUD shown);
- console times of `Block cache ... loaded`, `Loading '...'` and `Starting...`;
- `getTimeline(0)`: time of the first emulated vblank and, up to `lit`, disc ms / sync XHR count / KB,
  JIT compile ms and block count;
- rAF frame rate of the page in 2 s windows.
Cold = this game's OPFS block cache directory deleted first; warm = cache written by a previous run
(30 s of play, then `flushBlockCache()`). Same emulator build for old and new site (copy of `public/emu`
= web-perf 53b18fe3). The PS2 intro (boot-intro.js) was off for the main table (settings read with
`intro: false` in the test tab only), because with it on the intro sets the time (see below).
Machine shared with other agents (load 4-5, builds running), so single numbers swing by 2x; two rounds.

## Where the time went (old site, numbers from the click)
| Phase | GTA SA (PAL) | FFX | God of War (8.5 GB DL) |
|---|---|---|---|
| Disc insert + TV power-on + camera animations, then `boot()` | 4.5-4.8 s | 4.5-4.9 s | 4.5-4.8 s |
| `setBlockCache` (HEAD Play.wasm + OPFS read) | 20-60 ms | 20-60 ms | 50-650 ms (18.8k blocks) |
| `Loading` -> `Starting` (reset, disc open/ISO9660, dual-layer check, SYSTEM.CNF, ELF load) | 0.1-0.2 s | 0.1-0.2 s | 0.1 s (0.8 s once, cold server cache) |
| `Starting` -> first vblank | 0.1-0.5 s (cold JIT) | 0.1-0.3 s | 0.1-0.3 s |
| First vblank -> first picture (game's own black screen) | 11 vblanks, 0.3-3.5 s (JIT) | ~500 vblanks = 8.3 s emulated, 8.6-17 s wall | 96 vblanks, 5-12 s wall |
| Disc reads up to the first picture | 8 XHR (1 MB), 6.3 MB, 60-200 ms | 21 XHR, 7.1 MB, 170-340 ms | 9 XHR, 5.8 MB, 100-120 ms |
| JIT compile up to the first picture | cold 1.0-2.9 s / warm 0.2-0.8 s | cold 2.7-9 s / warm 0.6-0.7 s | cold 4.4-5.4 s / warm 0.7-1.0 s |
- Emulator init (Play.wasm 2.9 MB download + compile + `initVm` + first GS frame) runs at page load and
  was always done before the click (~1.2 s after navigation).
- Disc I/O is not a cost on this server: few, large reads (1 MB blocks, the LRU in the VM worker keeps
  them); the dual-layer fast path finds GoW's second layer with one read.
- The animations were the whole cost for GTA: the game shows a picture 11 vblanks after boot.
- FFX: the game itself is black for ~8.3 s of emulated time (~500 vblanks at 60 Hz) after boot.
- God of War: 96 vblanks, but each took 30-60 ms (EE 100% busy, `eeBusy` column). EE profile (profiling
  build): 30% at the return of syscall 0x64 (FlushCache) from a poll loop at 0x26C0E0
  (`jal 0x26BB98; beq v0,zero,0x26C0E0`): it calls FlushCache and checks a SIF RPC status until the IOP
  finishes the disc read (64 KB per vblank). Play!'s idle detection does not catch it (multi-block loop
  with a syscall). Later in the boot the EE is busy with real work (decompression), which only a faster
  JIT would help.

## Fixes
1. `index.html` `play()`: `emu.boot()` starts right at the click (once `emuReady`), in parallel with
   the disc/TV animations (and the intro), instead of after them. Game sound stays muted until the TV
   shows the game (`quietUntil`).
2. `emulator.js` fast start: from `boot()` until the first non-black GS frame (16x12 readback of the
   frame bitmap, at most 10 per second, >= 4 pixels with r+g+b > 48) the frame limiter is off and the
   volume is 0; then the page's values are restored (`setFrameLimit` / `setAudioVolume` are wrapped so the
   settings dialog keeps working). Ends after 30 s regardless, on `pause()` and on the next `boot()`.
   Emulated timing is unchanged (the limiter only sleeps between vblanks). `boot(file, { fastStart: false })`
   or `?faststart=0` turns it off.
3. Emulator (`fast-boot` 2ed06e87, GameConfig.xml): `IdleLoopBlock 0x0026C0E0` for God of War (SCUS_973.99),
   so each pass of the RPC poll ends the EE slice.

## Results (click -> first picture, intro off, two rounds; s)
| Game | old cold | new cold | old warm | new warm |
|---|---|---|---|---|
| GTA SA | 5.9, 8.6 | 2.2, 5.1 | 5.1, 6.8 | 1.0, 1.9 |
| FFX | 14.6, 22.6 | 6.9, 13.2 | 13.3, 13.7 | 3.9, 11.8 (other runs 2.8, 3.6, 4.6) |
| God of War (public/emu build) | 16.8, 14.4 | 14.3, 12.1 | 12.1, 10.1 | 10.0, 8.8 |
| God of War, new site + fast-boot build | - | 6.3 | - | 5.1, 6.3, 4.1 (same-session control without the idle loop: 8.4, 9.5, 12.4) |
- The TV comes on at ~4.6 s (end of the animations) in both versions. Old site: the game then booted, so
  the TV showed black until the first picture. New site: GTA warm/cold and FFX warm are already showing a
  picture when the TV comes on.
- FFX warm, same session, fast start on/off: 3.6 / 10.3 s and 4.6 / 9.8 s. 59-60 vbl/s after the picture
  (limiter back on).
- With the PS2 intro on (default; it now plays the BIOS startup video), `play()` ends at ~19.2 s for every
  game, old and new: the intro sets the time and the game is already running behind it. Skipping the intro
  (any key, allowed once the game has a picture) now works seconds earlier.
- Page frame rate during the animations: 52-58 fps new vs 54-60 old (emulator booting in parallel).
- "Trocar jogo" GTA -> FFX works with the new flow (no errors).

## Correctness
bench.html `hash=300&vu1thread=0&nolimit=1`: car.zip 55dab76e and mtvu-ffx.zip 5927b89c with fast start
on, with `?faststart=0`, and with the fast-boot build (emu-fastboot), same as public/emu.

Gotcha found on the way: a fast-boot build whose new GameConfig entry had a longer Description gave a
different, reproducible car.zip hash (a63e250f, from vblank 2, fields 2 and 5) although GameConfig only
applies to the booted executable; with a shorter Description the hash is back to 55dab76e. The only
difference is the size of the embedded GameConfig.xml, i.e. the memory layout: something in the emulator
depends on layout (uninitialised memory or similar). Not investigated; keep it in mind when a hash changes
after an unrelated edit.

## Not seen
`Play.wasm: memory access out of bounds` (reported by the intro agent): not hit in ~40 boots here (GTA, FFX,
GoW, cold and warm block cache, public/emu = web-perf 53b18fe3, fast-boot build, one game swap).

## Notes on testing
- A tab that becomes hidden stops rAF: the old `play()` then never reached `boot()` (all animations wait on
  rAF/dt), which looked like 20-100 s "boots" in early runs when the test tab was not in front.
- Remaining time with the intro off is the animation length (~4.6 s) for games that have a picture by then.
