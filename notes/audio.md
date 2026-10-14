# Audio time-stretching (branch `audio`, worktree `play-audio/`)

Variants: `public/emu-audio/` (new output), `public/emu-audiobase/` (web-perf HEAD built from the same tree, for A/B).

## Problem (measured)
Old path: VM thread -> `CSH_OpenALProxy` -> `emscripten_async_run_in_main_runtime_thread` -> `CSH_OpenAL` on the main
thread -> Emscripten's OpenAL emulation (AudioBufferSourceNodes scheduled 100 ms ahead from a main-thread timer).
The VM handed over one buffer per 100 SPU blocks = 4500 frames = 102 ms. Below full speed the producer delivers
102 ms of audio every 102/speed ms, so the queue is always empty: play 102 ms, silence, play 102 ms...
The gaps are plain underruns (not main-thread jitter); the 102 ms buffer granularity only makes them longer.

Measured by hooking `AudioBufferSourceNode.prototype.start` (scheduled start/duration of every buffer), GTA SA play.zip, 30 s:

| build | vbl/s | buffers | gaps | silent time |
|---|---|---|---|---|
| audiobase | 19.6 | 199 | 85 | 9.4 s (32%), median gap 95 ms |
| audiobase | 11.1 | 96 | 63 | 19.0 s (66%), median gap 284 ms |

## Design
- `Source/ui_js/SH_WebAudio.{h,cpp}`: `CSoundHandler` whose `Write` (VM thread) memcpys the samples into a static
  lock-free SPSC ring in wasm memory (32768 stereo frames; header write/read/overflow/frames). No main-thread call.
  Main.cpp sets `PREF_AUDIO_SPUBLOCKCOUNT` to 10, so the VM writes every ~10 ms (450 frames) instead of every 102 ms.
- `Source/ui_js/WebAudio.js` (`--pre-js`): `Module.webAudioStart(ringPtr)` creates an `AudioContext` at 44.1 kHz and an
  AudioWorklet (source = `playAudioWorkletMain.toString()` in a Blob URL) that gets the wasm memory SharedArrayBuffer
  and reads the ring with Atomics. OpenAL is no longer linked in the web build (Play.js -30 KB).
- Worklet = WSOLA time-stretcher: Hann frames of 1024 with 50% overlap (hop 512 = 11.6 ms), splice point searched
  +/-512 frames around the nominal position by normalized cross-correlation of the mono mix with the natural
  continuation of the previous frame (coarse pass every 4th sample/position, then +/-3 at full resolution).
- Tempo control: producer rate = EMA (0.5 s) of frames written per frame played; tempo = rate + (queued - 100 ms) /
  (0.5 s if below target, 2 s if above), clamped to [0.1, 1.5], slew-limited to 2.0/s. Within 5% of 1.0 the tempo is
  exactly 1.0 and the stretcher takes the exact continuation (bit-exact passthrough, no search, ~0 CPU), so there is
  no pumping at full speed. "queued" = ring + stretcher input not yet consumed.
- Underrun (producer stopped: loading, state load, VM stall, <10% speed): the tail of the last frame is played (Hann
  fade-out), then silence until 100 ms are queued again, restart with a fade-in. Queue > 600 ms (should not happen):
  restart at the newest audio.
- Tab hidden -> `ctx.suspend()`, visible -> `resume()`; a worklet that has not run for >250 ms (suspended context)
  flushes the stale queue. Autoplay: `resume()` on pointerdown/keydown/touchstart (capture phase, window).
- JS API: `Module.audioStats()` (cumulative counters: underruns, silentFrames, stretchedFrames, drops, overflowFrames,
  flushes, tempo, rate, fillMs, 10 ms fill histogram, 0.1 tempo histogram), `Module.audioCapture(seconds)` +
  `Module.audioCaptureWav()` (records the worklet output, returns WAV bytes), `Module.audioContext`.
- Offline check: `node Source/ui_js/WebAudioTest.mjs` (simulated producer at 1.0 / 0.8 / 0.45 / 0.25, bursty, speed
  steps; checks gaps, bit-exact passthrough at 1.0, pitch via zero-crossing rate, no sample jumps).

## Results (GTA SA, 30 s windows; the machine was shared with two other agents, so vbl/s is noisy)

| build / state | vbl/s | underruns | silence | stretched | tempo | wav (8 s capture) |
|---|---|---|---|---|---|---|
| audio play.zip | 21.8 | 0 | 0.00 s (0%) | 100% | 0.3-0.5 | no zero runs, no jumps |
| audio play.zip | 10.8 | 4 | 3.1 s (10%) | 89% | 0.1-0.4 | no zero runs (gaps were VM stalls at 1-2 vbl/s) |
| audio car.zip | 11.8 | 1 | 1.6 s (6%) | 94% | 0.1-0.3 | no zero runs (one gap = 2 s with 0 vbl) |

Fill stays mostly 70-150 ms. The remaining gaps are periods where the VM produced (almost) nothing (0-2 vbl/s).

CPU: VM thread does less than before (one memcpy per 10 ms instead of a proxied call + 9000-sample copy per 102 ms).
Worklet (node, same code): ~13-15 ms per second of audio when stretching (~1.4% of one core, on the audio thread),
~1-3 ms at full speed. FPS A/B (vbl/s, same state): audiobase 19.6 / 11.1 / 10.3, audio 21.8 / 10.8 / 3.1 (that run
was under heavy external load) - no regression visible above the noise.

Checked in the browser: hidden -> context suspended, visible -> running again (one flush, short refill), loadState
while running (short gap while the VM loads, then continuous), save state / block cache unaffected (no code change there).

## Limitations / ideas
- Below 10% speed audio gaps (tempo floor 0.1). Very slow speeds sound smeared (each piece repeated up to 10x).
- WSOLA with 23 ms frames: fine for music/ambience, some phasiness on transients at strong stretch (like PCSX2's
  TimeStretch). A sudden speed drop from 1.0 to <0.5 can cause one underrun while the rate estimate converges.
- Gamepad buttons do not count as a user gesture: the context starts on the first click/key (the index.html flow
  has a click before boot, so this is fine there).
- No volume/mute API yet (the page has none); `Module.audioContext.suspend()` works.
