# Original PS2 startup screen from the player's own BIOS

Goal: play the console's real "Sony Computer Entertainment" startup (sound + look) before the disc logo,
taken from a BIOS dump the player made of their own console. The site never ships, downloads or serves
(beyond loopback) a BIOS or anything extracted from it. Tested with SCPH-39001, ROMVER `0160AC20020207`
(v1.60, USA, 2002-02-07).

## Approach chosen and why

- **A. Run the real BIOS (OSDSYS) in Play!: not feasible.** Play! is HLE only, upstream included
  (checked jpd002/Play- master d44bfa18): the EE "BIOS" region `0x1FC00000` holds Play!'s own kernel stubs
  (`CPS2OS` assembles its handlers into `m_bios`), the IOP kernel is `CIopBios` (no IOPBOOT/IOPBTCONF
  path), and the only BIOS-related option is `PREF_PS2_ROM0_DIRECTORY` (a folder of rom0 IRX files).
  OSDSYS needs the real EE kernel, a real IOP boot with the ROM modules and its own sound driver (OSDSND,
  raw SPU2 access), and reads its resources from the ROM table. That is an LLE kernel/IOP port, far beyond
  a ~10 s intro.
- **B/C. Extract the assets at runtime in JS: done.** The sound is sequenced data (bank + MIDI-like
  sequence), so it can be rendered sample-for-sample from the BIOS's own ADPCM samples. The textures
  decode directly. The geometry/camera of the opening lives in OSDSYS code (EE + VU1 microcode), which
  was not reverse-engineered: the motion is a recreation that uses the original textures.

What is original vs recreated (with a BIOS):

| Part | Source |
|---|---|
| Startup sound (`SNDBOOTS` with bank `SNDBOOTH`/`SNDBOOTB`) | original samples + sequence, rendered by our SPU2-style mixer |
| Tower sound (`SNDTNNLS`), logo chime (`SNDLOGOS`) | original, same bank (which scene uses which is inferred from the names) |
| Reverb | approximated (convolution); the SPU2 reverb preset of the OSD driver was not recovered |
| "Sony Computer Entertainment" text (`TEXOSCE`) | original texture, shown at its texel size, centered |
| Fog (`TEXOFOG0-4`), flare ring (`TEXOFLAR`), glow dot (`TEXOCRBL`) | original textures, motion recreated |
| Towers scene | recreation (unchanged) |
| "PlayStation 2" logo | original, from the game disc (unchanged) |

Priority for part 1 (startup screen): a user recording in `public/assets/ps2-boot.mp4|webm` (gitignored; the
player's own capture of their console/BIOS) > the BIOS-driven screen > the recreation (no BIOS, unusable BIOS,
extraction over the 15 s safety cap, or reduced motion). Part 2 is always the disc logo; when a BIOS is
available its logo sound plays with it, also after the user video. The reason for each choice is logged to the
console ("Boot intro: ...").

**Why the player still saw the recreation (fixed in 1814a62):** the intro waited at most 0.6 s for the BIOS.
The extraction only started when the page went idle (1.5 s + requestIdleCallback, no timeout) and, once the
fast-boot change made the emulator boot in parallel with the disc animation, a 4 MB fetch + worker extraction
took 0.4-0.8 s on a busy page. Clicking a game soon after load lost the race and silently fell back. Now the
intro waits for the extraction (black under the TV power-on), the preload has a 2.5 s idle timeout, and failures
are logged. (Separately, even when the BIOS path ran, its motion and towers were a recreation, see below.)

## Code

- `public/js/ps2-bios.js`: ROM table, LZ, bank/sequence parsers, renderer, textures, OPFS storage
  (`bios/bios.bin`), dev fallback `GET /bios/dev.bin`. `ps2-bios-worker.js` runs the extraction
  (~0.2-0.5 s) off the main thread; it starts when the page goes idle, so it is ready by the first boot.
- `public/js/boot-intro.js`: with a BIOS the timeline starts at `t = -8` (the SCE screen, `SCE_LEN`); the
  towers keep `t >= 0`, so skip / reduced motion / the logo logic are untouched. Skip fades the startup and
  tower sounds (pending sources stopped); the logo chime plays when the logo starts fading in.
- `public/js/settings.js`: Configurações > Avançado > "BIOS do seu console" (pick / remove, status).
- `serve.py`: `/bios/dev.bin` = first `bios/*.bin`, only to loopback clients, 404 otherwise.
- `tools/check-ps2-bios.mjs [outdir]`: synthetic LZ/ROM checks; with `bios/*.bin` also extracts and
  checks the sound, and writes WAV/PGM previews to `outdir` (keep it outside the repo).

## Formats (offsets/structures only)

**ROM table (ROMDIR).** 16-byte entries `name[10]`, `u16 extinfo size`, `u32 size`, found by the entry
`RESET` followed by `ROMDIR`; files are laid out in table order, each aligned to 16 bytes, starting at 0.
In v1.60 the table is at 0x2740. Relevant files: `OSDSYS` (ELF), `OSDSND` (IOP module "rspu2_driver",
a PS2 port of PS1 libsnd: "PsIIlibsnd2"), `SNDIMAGE`, `TEXIMAGE`, `ICOIMAGE`, `FNTIMAGE`, `PS2LOGO`.
`*IMAGE` files are nested images with the same table at offset 0.

**LZ compression** (from the OSDSYS self-unpacker at 0x100af8, which unpacks the payload at 0x100d80 to
0x200000; the resources use the same scheme): `u32 LE` output size, then groups of 30 items, each group
led by a `u32 BE` flag word read MSB first. Its low 2 bits `k` set `mask = 0x3fff >> k`, `shift = 14 - k`.
Flag 0: copy one literal byte. Flag 1: `u16 BE h`, copy `(h >> shift) + 3` bytes from
`(h & mask) + 1` bytes back.

**Sound bank `SShd`** (the PS1 VAB idea, compacted): `u32` header size, `u32` body size, `u32 0`, "SShd",
`u32` program table offset (0x80), `u32` offset of a 2 + 128 byte velocity curve. Program table: `u16`
max program, then one `u16` per program (0xffff = none), relative to the table. Program: 8 bytes
(byte 1 volume, byte 2 pan), then 16-byte tones until one has bit 7 of its last byte set. Tone:
key low, key high, center note, fine (signed, 1/128 semitone), `u16` sample address / 8 in the body,
`u16` ADSR1, `u16` ADSR2, ?, volume, pan, bend range?, ?, flags (bit 0 = reverb send, bit 7 = last).
Body: SPU ADPCM (16-byte blocks: shift/filter, flags 1 end, 2 repeat, 4 loop start; 28 samples).
Center note plays at pitch 0x1000 (48 kHz on the SPU2); OSDSND carries the libsnd pitch table
(0x1000 .. 0x3fc5, 16 steps per semitone).

**Sequence `SSsq`**: `u16` volume, `u16` ticks per quarter (480), `u16` tempo in BPM (90 for the boot),
`u32 0`, "SSsq"; 0x10: 16 channel records of 16 bytes (byte 1 channel, 2 program, 3 volume, 4 pan); 0x110:
MIDI events as event, delta (VLQ), event, ... `FF 51` = tempo (`u16 LE` BPM), `FF 2F` = end. The boot
sequence uses note on/off, program change, CC7 and CC10 only (`SNDWARNS` also uses NRPN).

**Mixer** (ours): one voice per tone hit, ADSR per psx-spx "SPU ADSR" at 48 kHz, 4-point cubic
interpolation (the SPU2 uses a 4-tap Gaussian), volume = velocity curve x tone x program x channel x
sequence volume, PS1 libsnd style pan (`p < 64: L 1, R p/63`, else `L (127-p)/63, R 1`), reverb-flagged
tones mixed into a separate send bus. Boot render: 9.2 s of events + 3 s tail.

**Textures.** Files starting `u32 0x10` have a 0x18-byte header with `u16 width, u16 height` at 0x10;
16-bit pixels (5:5:5:1), e.g. `TEXOFOG0` 128x128, `TEXOFOG1-4` 64x64, `TEXOFLAR` 128x128, `TEXOWAL0`
256x256 (tower walls, unused). `TEXOSCE` and `TEXOPNG*` (the "Please insert a PlayStation or PlayStation 2
format disc" message per language D/E/F/G/I/J/P/S) are raw 8-bit alpha, 512x64, two lines of text.
`TEXOCRBL`/`TEXOCRLE` are raw RGBA8 64x64 (soft dot / hard circle). Sound/texture names used by the
opening are listed in the unpacked OSDSYS next to the string "BootOpening".

## Tests (2026-10-19, test Brave, FFX/GTA boot under the bench lock)

- `node tools/check-ps2-bios.mjs <scratch>`: boot 12.17 s, towers 4.25 s, logo 3.67 s; text 409x60 after
  cropping; 0.2-0.5 s per full extraction in Node.
- In the page: extraction preloaded at idle (ready before the first click); AudioBufferSourceNode log shows
  the startup sound at 0.05 s, the tower sound at 8.05 s and the chime when the logo appears (12.6 s);
  context running, 48 kHz buffers. Skip at 6.2 s stopped the pending tower sound and faded the rest.
- Page rAF during the intro while the game boots: 56 fps with the BIOS intro, 57.5 fps with the
  recreation (same run conditions; the dip is the emulator booting).
- Settings: random 4 MiB file rejected ("não é um arquivo de BIOS de PS2"), real dump saved to OPFS and
  listed as "v1.60 EUA (2002-02-07)", Remover deletes the OPFS folder; dev BIOS blocked -> recreation.

## Reverse engineering of the OSDSYS opening (v1.60)

Tools: the payload unpacked by our `unlz` (EE code at 0x200000, gp = 0x2af070, BSS up to 0x3f32b0), Ghidra 12.1.4
headless + ghidra-emotionengine-reloaded (R5900) in the developer's home, raw-binary import with every `jal`
target seeded as a function. OSDSND (IOP, R3000, relocatable IRX) imported raw at 0 (its code is position
dependent on 0). Addresses below are v1.60 EE addresses; `public/js/ps2-osd.js` finds the tables by shape.

**Flow.** `BootOpening` (argv) sets boot mode 1 (`BootWarning` = 4 = "insert disc" variant). The opening thread
runs one scene state machine; state 0 is the whole opening: the "Sony Computer Entertainment" text, light orbs,
glass cubes, fog and the tower field are one 3D scene that the camera flies through. It ends when the camera
passes the third keyframe; OSDSYS then boots the disc (the "PlayStation 2" logo is drawn by the separate
`PS2LOGO` program from the disc's logo sectors, so the BIOS has no logo image).

**Camera (0x215fd0, per 60 Hz frame; PAL scales steps by 1.2).** Position (x, y, z) starts at (0, 0, 16),
looking +z with up = (sin a, cos a, 0) (sceVu0CameraMatrix), so the camera looks down onto the towers and rolls.
Initial vz = 0.04/frame, roll a = -0.12 rad with rate 0.001. Phase advances when z passes the keyframe table
(int32 x 8: 16, 56, 104, ...). Phase 1: jerk 4e-7 on vz; once >2 s have passed and the disc type is known, the
"trigger" fires. Phase 2: constant accelerations (z 0.0099/frame², roll 0.000195) - the dive into the towers.
Integration is trapezoidal (v += (a*2 + j)/2, p += (v*2 + a)/2). z > 104 ends the opening (~2.1 s after the
trigger). Projection: sceVu0ViewScreenMatrix(scrz 1024, ax 1, ay 0.4576 NTSC / 0.5263 PAL, centre 2048,2048),
field rendering 640x224.

**Timeline (state 0, 0x218d80 each frame).** Towers; then feedback: the previous frame, kept at half width in a
work buffer, is blended over the towers with (Cs-Cd)*0x50/128 + Cd (62.5 % persistence: trails); the frame is
copied again at half width; six fog layers; while z < 73 the light orbs and five glass cubes; while z > 56 a
resample blur (shrink to 7/8 and back, up to 3 times, |z-56|/12); fade to black from z 72 to 104 (black sprite,
alpha (z-72)*4/128); first two frames black. After the scene: the text (when z > 18 an alpha counter runs +4/frame
to 240 and back to 0; alpha shown = min(counter, 112)/128, i.e. 28 frames in, ~64 held, 28 out), letterbox bars
in 16:9 mode, flip. No frame clear in the scene code (libgraph double buffer clears on swap).

**Text.** `TEXOSCE` is IA8 (intensity, alpha) 256x64: "Sony Computer" in rows 0-31, "Entertainment" in 32-63.
Drawn as two sprites on ONE line: field rects (x, y, 256, h) = (120, 105, 256, 16) and (326, 105, 256, 16) NTSC
(PAL y 120, h 18), uv (0, 0)-(256, 32) and (0, 32)-(256, 64), normal alpha blending. (The current BIOS screen
draws it as two centred lines: wrong.)

**Tower field (init 0x218e00, draw 0x2185c8 + VU1).** 14 x 9 grid (vec4 table 0x27a670); cell (r, c) world
position ((x + 4.8) * 4, (y - 6.5) * 4, (z + 4) * 12 + 150). Only cells owned by a play-history entry are drawn.
History (memory card, 21 entries of 0x16 bytes at 0x1f0138: name[16], count, cell bits, growing cell, date):
entry e owns 6 cells (int32 pairs table 0x27a260). The growing cell gets brightness/height from two 14-float
tables (0x27aee0 / 0x27af18) by play count (count >= 14: ((count-14) % 10) + 4); cells whose bit is set are full
(1, 1). On each boot the count goes up; at 14, 24, 34... a new random cell starts growing. Height h = max(3,
H*30); z += A*30 - h. Tower = 4x4 column along z from -h to +h (six GS packets with 4 vertices + normals, pointer
table 0x27a650; vertex z replaced by +-h): the -h cap is lit with brightness b, sides 0.8 b, vertices at +h black
(fade into depth). b = a fixed 20x20 radial brightness map (0x217e30: 32..220 with a small integer dither) times
H (full cells) or (1-A). Rotation about z by k*90 deg (k from the cell indices), +-10 deg wobble for growing cells.
Texture `TEXOWAL0` (256x256, mipmapped) over each face, uv offset n/256 per cell. Drawn far-to-near by |dx|+|dy|
with z-buffer. VU1 microcode (229 instructions, not disassembled) gets a light matrix: directions (0,0,-1),
(0.5,0.5,0), (-0.5,-0.5,0), colours 1.0/0.8/0.8, ambient 0.4 (libvu0 Normal/LightColor matrices) - assumed
standard Sony "point light" style shading.

**Fog (0x215238, mesh 0x214f78).** 17x17 grid, 6 units apart, z = 134; per-vertex blue intensity I by radial
falloff (R = I/4, G = 2I/5, B = I); six layers at z 134 - 5L with textures from a 6-entry list (FOG4, FOG2, FOG1
twice), 64x64 wrapped, each grid cell = half the texture, u scrolling (14-L)*0.0001*(L+1)/2 per frame. Additive
Cs*20/128.

**Light orbs (0x2166c8).** 4 orbs, colours (float RGB table 0x27a100, halved), orbit x = (10-i) cos(...), y = (i+3)
sin(...), z = 12 cos + 88, phase = frame + random(3456..5800). Each drawn at its last 4 positions (alpha 1/5..4/5)
as two `TEXOCRBL` sprites (+-0.8 and +-0.25 world units, colour / white), additive Cs*As. Plus a 128-frame trail
of screen positions drawn as an antialiased line strip every 8th point, fading.

**Glass cubes (0x217520, 0x21bf88...).** 5 cubes, half-size 1.8, positions table 0x27a210 (x*3.5, y*3.5,
150-15z), spinning (per-axis rates). Per cube: copy the frame to a work buffer; back faces into the work buffer
(refracted frame: screen uv + view normal offset, tint (112,112,152)), alpha-mask passes (`TEXOBLPR`/`TEXOBLP`
write only alpha) each followed by an environment pass (`TEXOREF`, sphere-map uv from view normal and position,
blended Cs*Ad + Cd); then the same for front faces into the frame, refracting the work buffer. Pass table:
10 entries (frame buffer, texture, ABE, alpha mode, FIX, AA, uv mode, colour mode).

**Sound (EE 0x200250/0x2004b8, IOP OSDSND).** Sequences are opened in slots 0-7 = BOOTS, TNNLS, CLOKS, TM30S,
TM60S, LOGOS, WARNS, RCLKS, with sequence volumes (command 0x5013) 0x42, 0x2a, 0x2d, 0x1b, 0x1b, 0x1b, 0x36,
0x36 (overriding the header byte). Boot: slot 0 (BOOTS) at frame 0. At the trigger: PS2 disc (CDVD type 0x12-0x14)
-> play RCLKS and stop BOOTS with release rate 0x11 (command 0x5015 mode 0); PS1/CDDA -> stop BOOTS (0xf);
no disc -> TNNLS. So with a game the tower sound is SNDRCLKS, not SNDTNNLS (the BIOS screen plays TNNLS: to fix).
SNDLOGOS is not used by the opening. Reverb: both cores type 4 (Studio Large, the libspu preset table in OSDSND,
0x44-byte entries), depth ramped by the EE over the first 60 frames to 20/127 of 0x7fff on core 1.
**Pitch: settled.** OSDSND's note->pitch is PS1 libsnd's (`_spu_note2pitch`: 12-entry note table x 128-entry
fine table, shifted): the centre note gives 0x1000, which the SPU2 plays at 48 kHz - no 44.1 kHz correction.
Voice volumes are squared (v*v/0x3fff) after the velocity/tone/program/channel products and pans (our mixer is
linear: to fix).

## Open

- Re-implementing the opening from the findings above (`ps2-osd.js` already locates the tables at runtime;
  the renderer is not written). Until then the user's own recording (`public/assets/ps2-boot.mp4`) is the
  faithful part 1, and the BIOS screen remains an approximation.
- Not settled: the trigger time on real hardware (depends on the drive identifying the disc; >= 2 s), the VU1
  tower shading (microcode not disassembled), a sensible default play history.
- Sound fixes known but not applied: RCLKS instead of TNNLS, sequence volumes, squared voice volume,
  Studio Large reverb at depth 20/127 (psx-spx algorithm), Gaussian interpolation.
