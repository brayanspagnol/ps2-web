# Credits

Everything this site ships (the `public/` folder) and where it comes from.

| What | Where in the repo | Origin | License |
| --- | --- | --- | --- |
| Site code (HTML, JS, CSS, procedural 3D console, TV, room, boot intro recreation, generated covers and disc labels) | `public/index.html`, `public/js/`, `public/*.html` | This project | BSD 2-Clause ([LICENSE](LICENSE)) |
| 3D PS2 console model | `public/js/console-scene.js` | Built in code by this project from reference photos; no model file or texture is loaded | BSD 2-Clause (this project) |
| Play! emulator, compiled to WebAssembly | `public/emu/Play.js`, `public/emu/Play.wasm` | [jpd002/Play-](https://github.com/jpd002/Play-) by Jean-Philip Desjardins, built from the fork [brayanspagnol/Play-](https://github.com/brayanspagnol/Play-), branch `web-perf`, commit `1654ec227eba48ccab9106725b4186ba11b8ce1c` (see [BUILD.md](BUILD.md)) | BSD 2-Clause ([public/emu/LICENSE-Play.txt](public/emu/LICENSE-Play.txt)) |
| Libraries compiled into `Play.wasm` | `public/emu/Play.wasm` | Play--Framework, Play--CodeGen (fork [brayanspagnol/Play--CodeGen](https://github.com/brayanspagnol/Play--CodeGen)), Nuanceur (jpd002); libchdr; zlib; zstd; bzip2; LZMA SDK; SQLite; xxHash; Emscripten runtime | BSD 2-Clause (jpd002 libraries); BSD 3-Clause (libchdr, zstd); zlib License (zlib); bzip2 License (bzip2); public domain (LZMA SDK, SQLite); BSD 2-Clause (xxHash); MIT / University of Illinois NCSA (Emscripten) |
| three.js r170 | `public/vendor/three.module.js` | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT ([public/vendor/LICENSE-three.txt](public/vendor/LICENSE-three.txt)) |
| three.js add-ons: OrbitControls, RoomEnvironment, RoundedBoxGeometry, BufferGeometryUtils | `public/vendor/addons/` | three.js examples (RoomEnvironment is adapted by three.js from Google's model-viewer) | MIT ([public/vendor/LICENSE-three.txt](public/vendor/LICENSE-three.txt)) |
| Box art of the 8 catalog games | `public/covers/*.jpg` | Front cover scans from the [xlenore/ps2-covers](https://github.com/xlenore/ps2-covers) set used by PCSX2 | No license given by that set; the artwork is © its respective publishers. Shown only to identify the player's own discs |

## Not included

- No games, BIOS or Sony assets are in this repository or downloaded by the site. Players use disc
  images they dumped from their own games; the file stays on their computer.
- The optional boot video/sound/logo (`public/assets/ps2-boot.*`, `public/assets/ps2-logo.*`) and a BIOS
  dump are only ever supplied by the user for their own copy and are kept out of the repository.
- Fonts: the site uses the fonts already installed on the visitor's system; no web fonts are loaded.

"PlayStation" and "PS2" are trademarks of Sony Interactive Entertainment. This project is not affiliated
with or endorsed by Sony.
