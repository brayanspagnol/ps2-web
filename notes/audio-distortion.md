# Audio distortion ("estourado") investigation (2026-11-16)

Live build f35c5ea5 (`public/emu`), bench.html, test Brave, 12 s captures after a 6-8 s settle, AudioContext started by
a CDP mouse click. Tools: `.claude/bench/audio/` (`capture.mjs` + `run.sh` memory gate, `analyze.mjs`, `spectral.py`,
`sim.mjs` offline worklet, `model/resample.py` exact model of the SPU readers, `build.sh`).

## Summary
- The user hears every game as "a bit blown out", including GTA at -7.9 dBFS peak with no clipped sample, and it is
  already in the SPU output (before WebAudio and the time stretch). The main cause is not level but **resampling
  distortion inside the SPU emulation**, common to all games:
  1. voices are resampled with **linear interpolation** (hardware: 4-point Gaussian);
  2. the web build mixed at **44.1 kHz**, while the SPU2 runs at 48 kHz, so every voice played at its native rate
     went through a 48 -> 44.1 kHz linear resample, and the **sound data input** (streams, movie audio) was decimated
     by **dropping one sample in ~12** (nearest neighbour).
- Fix (branch `audio-fix`, commit `ea953cb6`): Gaussian interpolation for voices, and the web build renders the SPU,
  the ring and the AudioContext at 48 kHz. Candidate build: `public/emu-audiofix2` (`?emu=audiofix2`).
- God of War also clips inside the mix (a separate, game-specific problem): Play ignores the per-voice dry gates
  (VMIXL/VMIXR). Not fixed: doing it right needs a correct effect (reverb) return path first.

## How it was measured
- **SPU stage**: the int16 samples the VM writes into the audio ring, read losslessly from the shared wasm memory on
  the main thread (`tapLost` 0 everywhere). **Worklet output**: the worklet's own capture (input of the volume
  GainNode, gain 1.0; the GainNode never amplifies). Full-speed behaviour: SPU captures replayed offline through the
  same WebAudio.js at 1.0 / 0.6 / 0.45 speed (`sim.mjs`).
- **Resampler model** (`model/resample.py`): exact re-implementations of `CSampleReader::GetSample` (linear,
  PITCH_BASE 0x1000, truncated step) and `CBlockSampleReader` (nearest), against the hardware path (PCSX2's Gaussian
  table from Near's generator, output at 48 kHz). Test tones; "spur" = all energy outside the tone, in dBc.

## Resampling results
Model (spurious energy, dBc; lower is cleaner):

| case | Play before (linear @ 44.1k) | hardware / after (Gaussian @ 48k) |
|---|---|---|
| voice, 48 kHz sample at pitch 1.0, 3 kHz | -44.6 | -86.7 |
| voice, 48 kHz sample at pitch 1.0, 6 kHz | -32.1 | -90.0 |
| voice, 48 kHz sample at pitch 1.0, 9 kHz | -24.3 | -85.5 |
| voice, 24 kHz sample (pitch 0.5), 3 kHz | -32.1 | -55.2 |
| voice, 11 kHz sample (pitch 0.23), 1 kHz | -38.0 | -61.0 |
| stream input 48 kHz, 1 kHz | -28.5 | none (no resampling at 48 kHz) |
| stream input 48 kHz, 6 kHz | -12.8 | none |

In-game, SPU stage (band level relative to total; natural content falls off with frequency, so a rising top band
means images):

| state | 10-14 kHz before / after | 14-22 kHz before / after | large steps (>20000) before / after |
|---|---|---|---|
| play (GTA) | -39.1 / -61.2 dB | **-34.0 / -73.8 dB** | 0 / 0 |
| car (GTA) | -37.7 / -42.8 | -37.4 / -47.7 | 0 / 0 |
| mtvu-ffx | -45.2 / -52.6 | -36.7 / -50.8 | 0 / 0 |
| gow-fight | -32.5 / -36.8 | -37.4 / -46.6 | 0 / 0 |
| gow-intro (stream) | -20.6 / -20.2 | -27.3 / -30.1 | 103 / 23 |
| cvx-fmv (stream) | -17.9 / -17.6 | -23.6 / -25.2 | 826 / 164 |

Before the fix GTA and FFX had more energy at 14-22 kHz than at 10-14 kHz (images); after, the top falls off. In the
streamed scenes the large sample-to-sample steps (spaced on multiples of ~11.3 samples, the drop period) fell 4-5x.
Peak/RMS levels are unchanged within ~1 dB. The captures before/after are the same scenes but not sample-aligned.

## Level, clipping, gaps (before; after in brackets)

| state | speed | SPU peak / RMS dBFS | SPU samples on the rail | clip runs (longest) | underruns / silence |
|---|---|---|---|---|---|
| gow-fight | 0.59 | 0.0 / -9.9 [0.0 / -10.1] | 0.27 % [0.24 %] | 505 (41) [449] | 1 / 276 ms |
| gow-intro | 0.70 | -0.2 / -14.8 | 0 | 0 | 0 |
| play | 0.91 | -7.9 / -27.6 | 0 | 0 | 1 / 136 ms |
| car | 0.45 | -4.0 / -26.3 | 0 | 0 | 0 |
| mtvu-ffx | 0.60 | -13.7 / -28.2 | 0 | 0 | 2 / 189 ms |
| cvx-fmv | 0.99 | 0.0 / -11.1 | 0 | 0 | 0 |
| cvx-p1 | 0.89 | silent in both builds: no voice keyed on and no stream input during the 12 s | | | |

Running speed does not matter for any of this: the offline worklet at 1.0 / 0.6 / 0.45 keeps peak and RMS within 0.3 dB,
adds no clipping, and at 1.0 is a bit-exact passthrough. The time stretch is in use 38-100 % of the time on this
machine (tempo 0.3-0.9) and can sound smeared at strong stretch, but it does not distort levels.

Ruled out: site gain (1.0, range 0..1), sample-rate mismatch (context = SPU rate), byte order / stereo (normal spectra),
underruns (rare, short), int16 wraparound (every sum in the SPU path saturates), ADPCM decode (same filters and
shift as PCSX2's `XA_decode_block`; Play keeps the predictor history unclamped, which only differs after an overflow).

## God of War clipping (not fixed)
`spuMixDebug()` (diagnostic commit `8588ff39`) in gow-fight: the game writes VMIX ~1,600 times (core 0) and ~1,000
times (core 1) in 12 s. Core 1 keeps one voice dry (VMIXL/R = 0x10) and routes voices 3-5 and 9-11 to the effect path
only (VMIXEL/ER = 0x0E38). Play mixes every voice dry: core 1's unclamped dry sum peaks at 47,802 (2,179 samples over
range) versus 90 with the gates applied. In PCSX2 (`Mixer.cpp` `MixCoreVoices`) those voices reach the output only
through the reverb at EVOL. Play also ignores EVOL (fixed 0.333 return), MVOL, VMIXEL and MMIX, and its reverb return
in this scene peaks at ~20, so honouring the dry gates alone would make GoW nearly silent. Proper fix: dry/wet gates,
MMIX, EVOL/MVOL (all defaulting to "open/max" for states saved before they existed) and a check of the reverb level
against PCSX2. GTA writes none of these registers in its scenes.

## Hashes and speed
- Fix build (48 kHz + Gaussian): car dc21d31e, play 3aab5b0d, gow-fight 06ec370c, gow-intro 892620c8, mtvu-ffx
  ec588f3b; car and play with vu1thread=1 identical to vu1thread=0 (deterministic).
- Gaussian alone at 44.1 kHz (`emu-audiogauss`): car 55dab76e, gow-fight 77f177fc = expected. So the interpolation does
  not touch emulated state; the change comes from the 48 kHz SPU rate: `UpdateSpu` now runs 1067 times per second
  instead of 980 and the sound input is consumed one sample per output sample, so SPU IRQs, end flags and input-buffer
  refills fall at slightly different IOP times. That is closer to hardware (SPU2 ticks at 48 kHz), but it does
  change timing.
- Frame rate (live vs audiofix2, 2 rounds, noisy machine): gow-fight 55.5/56.3 vs 52.8/50.8 vbl/s, car 40.1/49.6 vs
  30.4/49.6 vbl/s. Car swung 30 -> 50 between rounds of the same build, so this does not show a regression or rule a
  small one out. Expected cost: about 9 % more SPU samples plus 4 taps instead of 2 per voice sample.
- Latency: unchanged (the queue target is still 100 ms; at 48 kHz that is 4800 frames).

## Not done
- Site path `index.html?play=` with the new build: not tested (the change is inside the emulator; the site only
  passes volume and buffer ms, which are rate-independent).
- GoW mix gates / effect path (above). cvx-p1 silence: the scene plays no voice at all in either build; not an output
  problem, not investigated further.
