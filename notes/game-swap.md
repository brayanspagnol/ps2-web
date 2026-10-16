# Game swap ("Trocar jogo") hang and background emulation - working notes

Status (2026-10-16): fixed on the Play fork, branch `swap-fix` (based on web-perf cd7a2a58), pushed.
Test build: `public/emu-swap/` (release, same flags as `public/emu`). Site: `index.html`, `js/emulator.js`.

## Symptom
On index.html, booting a second game after "Trocar jogo" stayed at 0 vblanks / 0 FPS. Reported for
GTA SA (after F8) -> FFX, but it happens on **any** second boot, with or without save states, in any
order (GTA -> FFX, GTA -> GTA, ...), on every build since MTVU (2b70158a, "VU1 on its own thread"):
reproduced on emu-cand / public/emu as of 8a69a76 and on web-perf cd7a2a58; fbed76d8 has the same code.

## Root cause: VM thread crash in the VIF1 forwarding path (MTVU)
- The emulation thread died with `RuntimeError: memory access out of bounds` right after
  "Loading '<second game>'..." (seen only by attaching to the workers; the page itself just shows 0 FPS).
  Stack (build with `--profiling-funcs`): `CPs2VmJs::BootDiscImage` -> `CPS2VM::Reset` -> `ResetVM` ->
  `Ee::CSubSystem::Reset` (inlined) -> `CVu1Thread::RunSync` -> flush handler -> `CVif::ForwardConsumedData`
  -> `CVu1Thread::PushVifData`.
- With VU1 threaded, the front VIF1 forwards what its `CFifoStream` loaded since the last call
  (`TakeLoaded`: range `[m_forwardAddress, m_nextAddress)`). `CFifoStream::Reset()` cleared
  `m_nextAddress`/`m_source` but not `m_forwardAddress`. `Ee::CSubSystem::Reset` resets the front VIF1
  (`m_vpu1->Reset()` through `RunSync`) and `RunSync`'s following `Sync()` calls the flush handler:
  `size = 0 - m_forwardAddress` wraps to ~4 GB and `PushVifData` memcpys from a null source.
- First boot was fine because VU1 threading only turns on at the first vblank (the reset of a fresh VM
  runs unthreaded); every later boot resets with MTVU on. A state load does not reset the stream
  addresses, which is why it never showed up on F8.

## Fix
- `Source/ee/Vif.cpp`: `CFifoStream::Reset()` also clears `m_forwardAddress` and `m_initialTagIncluded`.

## Related: emulation kept running in the library
"Trocar jogo" only blanked the TV; the VM (and VU1/GS threads, audio) kept running the old game until
the next boot. Now:
- `Module.pauseVm()` (Main.cpp): `CPS2VM::PauseAsync()` (VM loop sleeps 100 ms per iteration) and
  `Module.audioSetPaused(true)` (WebAudio.js: `AudioContext.suspend()`, the gesture/visibility handlers
  no longer resume it while paused). `bootDiscImage`/`bootElf` unpause audio; the boot itself resets and
  resumes the VM (`Reset` + `ResumeImpl`). Samples left in the ring are flushed by the worklet on resume
  (its >250 ms gap check). Audio also starts paused until the first boot.
- `js/emulator.js`: `pause()` (no-op on builds without `pauseVm`); `index.html` `backToLibrary()` calls it.

## Verification (public/emu-swap, Brave CDP [::1]:9222, visible tab, exclusive bench lock)
Driver: `swap.py` (scratchpad, session-specific): drives the shelf and HUD, samples `getProfile().vblanks`,
site FPS and `audioStats()` every 5 s, per-thread CPU of the renderers, worker console/exceptions.

| Sequence | before (public/emu = emu-cand, cd7a2a58) | after (emu-swap) |
|---|---|---|
| GTA -> F5, F8 -> FFX | crash, 0 vbl/s | FFX 52-60 vbl/s |
| GTA -> FFX (no states) | crash, 0 vbl/s | OK |
| FFX -> F5, F8 -> GTA | - | GTA ~40-45 vbl/s (intro) |
| GTA -> GTA, FFX -> FFX, FFX -> GTA -> FFX | - | OK |
| single boot + F5/F8 (GTA, FFX) | OK | OK |
| GTA -> F5, F8 -> GoW -> F5, F8 -> FFX; FFX -> GoW | - | OK (GoW ~50-59 vbl/s once past its boot) |

bench.html GTA play.zip, median vbl/s over t=40-72 s: emu-swap 38, emu-cand 36 (same code otherwise; noise).
God of War (USA, 8.5 GB dual layer): every boot, first one included, spends ~12 s between "Loading" and
"Starting" with 0 vblanks: `COpticalMedia::CheckDualLayerDvd` scans 2 KB headers from 35% of the image
up to the layer break (~1.3 GB through the 1 MB sync-XHR reader). Not a swap problem; could be cut by
reading the layer-break volume descriptor directly or caching the result per image.
Library after "Trocar jogo": 0 vblanks, `audioStats().state` "suspended" with `outFrames` frozen, the
emulator workers below 0.5% CPU each (in game: three workers at 98/10/7%, audio worklet thread 2%).
The renderer still uses ~60-75% of a core in the library (compositor ~45%, main ~15%), the same as a
fresh page that never booted a game: that is the shelf UI, not emulation (likely the infinite CSS float animation on the
selected card with 3D transforms/backdrop blur, and the always-on `view.onFrame` rAF loop; not measured).

## Not done / known
- Pause on page hide: not added (the audio context already suspends when hidden).
- `CVu1Thread::SyncAndDiscard` drops queued flip functions, so `CPS2VM::m_vu1PendingFlips` can stay
  incremented if a reset/state load happens while the VU1 thread is stalled on the GIF (it then syncs at
  every vblank). Logged at reset/load in these runs: always 0. Fix if it shows up: set it to 0 after
  `m_ee->Reset`/`m_ee->LoadState` when VU1 is threaded (the ring is empty then).
- `Js_SetDiscImageUrl` writes `g_discImageUrl` on the main thread while the VM thread may read it (old
  game still running); harmless now that the VM is paused before the next boot.
