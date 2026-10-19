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

Without a BIOS (or if it is not ready within 0.6 s, or with reduced motion) the previous recreation runs
unchanged; a user video in `public/assets/ps2-boot.*` still takes priority.

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

## Open

- The real opening's camera, particle motion and tower geometry (OSDSYS code + VU1 microcode) are not
  recovered; a disassembly of the opening routine near "BootOpening" would give exact timings.
- Which sequence plays in the towers scene is inferred from names; verify by ear against a real console.
- SPU2 reverb preset and Gaussian interpolation are approximated.
