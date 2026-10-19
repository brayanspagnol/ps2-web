# Building Play! (WebAssembly) for ps2-web

`public/emu/Play.js` + `Play.wasm` are built from the `web-perf` branch of the Play! fork
(https://github.com/brayanspagnol/Play-), whose `deps/CodeGen` submodule points at
https://github.com/brayanspagnol/Play--CodeGen. `play-gamepad.patch` is an older snapshot of the
first changes against upstream commit d44bfa18, kept for reference. The upstream prebuilt from playjs.purei.org is kept in
`public/emu-prebuilt/` as a fallback (to use it, copy its files back over `public/emu/`).

## Toolchain (one-time)

```sh
git clone --depth 1 https://github.com/emscripten-core/emsdk.git ~/.local/share/emsdk
~/.local/share/emsdk/emsdk install 4.0.1      # same version as upstream CI
~/.local/share/emsdk/emsdk activate 4.0.1
```
cmake and ninja come from the system (/usr/bin).

## Source

```sh
cd ps2-web   # this repository
git clone --recursive -b web-perf https://github.com/brayanspagnol/Play- play-src
```

## Build (release, -O3 + wasm SIMD)

```sh
cd play-src
source ~/.local/share/emsdk/emsdk_env.sh
F="-msimd128"
emcmake cmake -S . -B build_cmake/build/wasm-simd -G "Ninja Multi-Config" \
  -DBUILD_PSFPLAYER=OFF -DBUILD_TESTS=OFF -DUSE_QT=OFF \
  -DCMAKE_C_FLAGS="$F" -DCMAKE_CXX_FLAGS="$F" -DCMAKE_EXE_LINKER_FLAGS="$F"
cmake --build build_cmake/build/wasm-simd --config Release --target Play -j12
cp build_cmake/build/wasm-simd/Source/ui_js/Release/Play.{js,wasm} ../public/emu/
```
Full build ~5-6 min on 12 cores; after editing only `Source/ui_js/*` it relinks in ~30 s.
Upstream-identical build (no SIMD flag): `emcmake cmake --preset wasm-ninja && cmake --build --preset wasm-ninja-release --target Play`
(output in `build_cmake/build/wasm-ninja/Source/ui_js/Release/`).

Notes on flags: Release already uses `-O3`. `-msimd128` is free (Play's JIT already emits wasm SIMD, so
browsers without SIMD could not run it anyway). `-flto` was tried: builds and runs, wasm +4%, no
measurable gain, so it is not used.

## Gamepad patch (Source/ui_js)

- `InputProviderEmscripten` now merges keyboard + every connected browser gamepad (W3C "standard"
  mapping) into one binding per PS2 control; `Main.cpp` polls `navigator.getGamepads()` through
  `emscripten_sample_gamepad_data()` every animation frame on the main thread.
- Mapping: A=Cross, B=Circle, X=Square, Y=Triangle, LB/RB=L1/R1, LT/RT=L2/R2 (digital, >30%),
  Back/Share=Select, Start/Options=Start, L3/R3 stick clicks, D-pad, left/right sticks = real analog
  (radial deadzone 15%, rescaled to full range). Keyboard keys unchanged.
- No JS integration required; hot-plug works (state re-read every frame).

## Disc read patch (Source/Js_DiscImageDeviceStream.cpp)
Also in `play-gamepad.patch`. The page calls `Module.setDiscImageUrl(url)` before
`bootDiscImage`; the emulation thread then reads the disc itself with synchronous XHR
(HTTP Range, 1 MB blocks, 48-block LRU in the worker) instead of one main-thread round
trip plus `isDone()` polling per sector. Local Files use a `blob:` URL. If the URL read
fails it falls back to the original main-thread path. Measured on GTA SA: disc reads were
not the bottleneck (the game only pulls 6–15 MB/min while loading); boot time unchanged.

## Performance / correctness changes (see OPTIMIZATION.md)
Also in `play-gamepad.patch`: software write protection of EE code pages (fixes the GTA SA crash
after the intro movies), a new idle-loop strategy for `RotateThreadReadyQueue` spinning, a faster
IPU IDCT, `GameConfig.xml` embedded in the wasm (plus a GTA SA PAL idle loop entry), save states
(`saveState`/`loadState`/`stateStatus`) and a sampling profiler for `-DPROFILE=ON` builds
(`getProfile`). `PTHREAD_POOL_SIZE` is 4. `public/emu-prof/` is the profiling build,
`public/emu-baseline/` the build before this work; pick one with `?emu=<name>`.

## Persistent JIT block cache (Source/BlockCache.cpp, public/js/emulator.js)
Also in `play-gamepad.patch` (with the new files `Source/BlockCache.{h,cpp}`). `CBasicBlock::Compile`
looks every EE/VU/IOP block up by (category, XXH3-128 of its instruction words, size, compile hints,
variant) and on a hit builds the `CMemoryFunction` from the cached wasm bytes, skipping the Jitter.
Storage is OPFS, owned by `emulator.js`: `boot(file)` loads `blockcache/<variant>-<file name>-<size>/`
before booting and appends new entries every 30 s / 1 MB and when the page is hidden. Segments carry a
salt made of the `Play.wasm` ETag/Last-Modified/size (from a HEAD request), so a rebuilt emulator
discards old code automatically. JS API: `setBlockCache(key|null)`, `flushBlockCache()`,
`clearBlockCache(key?)` (all games, or one), `blockCacheUsage()`; `boot(file, { blockCache: false })` disables it.
Bump nothing by hand: any change to the codegen produces a new Play.wasm and thus a new salt.
See OPTIMIZATION.md for the design and measurements.

## Source of the emulator
The emulator changes live on the `web-perf` branch of the Play! fork
(https://github.com/brayanspagnol/Play-). `play-gamepad.patch` is the same change set as a
patch against upstream commit d44bfa18, kept for reference.
