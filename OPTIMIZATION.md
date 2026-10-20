# Play! WebAssembly: GTA San Andreas (PAL, SLES-52541) performance work

All numbers were measured in Brave (CDP test instance) on a 12-core Linux box that was also
running other work, so they are noisy; "vbl/s" is emulated vertical blanks per wall-clock second
(PAL real time = 50), "fps" is frames the GS presented per second.

## Tooling added

- **Save states in the JS frontend** (`Source/ui_js/Main.cpp`): `Module.saveState(path)`,
  `Module.loadState(path)` and `Module.stateStatus()` (-1 pending, 0 failed, 1 ok). They run on the
  VM thread; the main thread must never block on them (the GS thread proxies GL calls to the main
  thread). Load = boot the disc first, then load the state. States are zstd zip files (~3-13 MB).
- **`public/bench.html`** (dev harness): `?game=<file in /games>&emu=<variant>&state=<name>`
  boots the game from the server, optionally loads a save state kept in OPFS, and samples
  `Module.getProfile()` every second into `window.bench.prof`. `bench.save(name)` /
  `bench.load(name)` store/load states in OPFS.
- **`?emu=<name>`** in `public/js/emulator.js` picks `public/emu-<name>/` for A/B tests
  (`emu-baseline` = build before this work, `emu-prebuilt` = upstream, `emu-prof2` = profiling build).
- **Profiling build** (`build_cmake/build/wasm-prof`, configured with `-DPROFILE=ON`). The upstream
  `CProfiler` timed every zone transition with clock reads, which are JS calls on WebAssembly and
  slowed the emulator 5x. It was rewritten as a **sampling profiler**: the VM thread only publishes
  its current zone (two stores), a sampler pthread attributes elapsed time to it every 0.5 ms and
  also samples the EE/IOP PC. `getProfile()` returns JSON with per-zone ms, EE/IOP busy/idle ticks,
  GS thread busy time, JIT block compiles, EE syscall counts, interrupts, idle slices and a debug
  log (`CProfiler::Log`). Zones: EE (slice loop + HLE syscalls), EEJIT (executor dispatch),
  EEBLOCK (inside compiled EE blocks), EETICKS (DMA/timers/interrupt checks), IPU (+ IPU_VLC,
  IPU_IDCT, IPU_CSC), VU, VIF0/1, GIF, IOP, SPU, GSSYNC, GSWAIT (VM thread waiting for the GS
  thread), LIMITER (frame limiter sleep), COMPILE (JIT), OTHER.
- `PTHREAD_POOL_SIZE` raised from 2 to 4: a third thread (the sampler) created from the VM thread
  while the main thread is blocked in `initVm` deadlocked with a pool of 2.

## Black screen after the intro movies: root cause and fix

**It was a crash, not a slow load.** With the profiling build, the black screen showed emulated
time running at full speed (50 vbl/s), the frame limiter sleeping 80% of the time, zero syscalls and
the EE PC walking through zeroed low memory (0x1004, 0x2008, ...). A block-history trace showed an
RPC end callback (`libsif` dispatcher at 0x53F860, called from the SIF DMA interrupt) jumping into
a pixel buffer, after the game had issued an RPC with a garbage client structure.

The garbage came from **stale JIT code**. After the intro the game loads new code over the memory
that held the movie player (0x88xxxx); on desktop Play! write-protects pages holding compiled code
(`mprotect` + SIGSEGV handler) and drops stale blocks, but WebAssembly has no memory protection, so
the wasm build kept executing the old blocks (a debug check comparing block opcodes at creation vs
execution reported `STALE block 0088ECE0` right before the bad RPC).

Fix (generic, not GTA-specific): **software write protection for EE code pages**.
- `CMIPS` gets a second page table, `m_pageLookupWrite`, used only by JIT stores (SB/SH/SW/SD/SQ,
  SWC1, SQC2). `CEeExecutor::SetMemoryProtected` on WebAssembly clears the write entries of a 4 KB
  page (all RAM mirrors) instead of calling `mprotect`, so stores to pages containing compiled code
  take the slow path. The slow-path store proxies (`MemoryUtils_Set*Proxy`) call
  `CMIPS::m_writeWatchHandler`, which invalidates the blocks of that page exactly like the desktop
  access-fault handler (then the page is writable again until a block is compiled in it).
- C++ code that writes EE RAM directly calls `CEeExecutor::NotifyRamWritten`: SIF DMA/packets,
  HLE RPC replies, cdvdfsv reads, fileio reads (the one GTA uses to load its code), mcserv, IPU
  (DMA3) and fromSPR (DMA8) transfers.
- Result: from a save state taken just before the black screen, the game reaches the
  "Francis INTL. Airport, Liberty City, 1992" intro and the 3D cutscene in about 1 minute
  instead of hanging forever.

## Idle detection during the movies

The intro FMVs ran at 10-17 fps. Profile (old build): EE JIT ~50%, EE outside JIT (HLE syscalls)
~27%, IPU ~13%, EE PC 35% at the return of `RotateThreadReadyQueue`. Two threads at priority 2
(an idle spinner at 0x89B4A0 and the movie thread polling a buffer with a yield loop) bounced
~550k-950k times/s via `RotateThreadReadyQueue` syscalls, and the existing idle strategies never
fired because the ~4000 interrupts/s reset their counters (500/1000 consecutive rotations needed).

New strategy `STRATEGY_TIGHTROTATE` (`Ee_IdleEvaluator`): rotations that happen within 256
*executed* EE cycles of each other (interrupt handler cycles excluded) for 16 times in a row mean the
EE has nothing to do until an interrupt; the rest of the current 4800-cycle slice is skipped. The
idle state only lasts until the next execution chunk, so a thread doing real work between yields is
never throttled. Movies: 13 -> 36-40 vbl/s.

## IPU (MPEG) decoding

The IDCT used the double-precision reference transform (1024 multiply-adds per 8x8 block). Replaced
with the same separable transform in single precision written so clang vectorizes it with wasm SIMD
(`FastIdct` in `IPU.cpp`). Checked against the reference on 200k random blocks: 0.015% of samples
differ, by 1 (rounding ties); IEEE 1180 tolerance is far larger.

## Polling loop in cutscenes and gameplay (per-game idle loop)

After the fixes above the 3D cutscene ran at 8-12 vbl/s with EE code at ~80% of the VM thread.
75% of the EE samples were in a 3-block loop at 0x34DFD8-0x34E010 that waits for two counters in
the game's render queue (updated by interrupt handlers) to match. Play!'s automatic idle-loop
detection only recognises single-block loops, so the loop is declared in `GameConfig.xml`
(`SLES_525.41;1`, `IdleLoopBlock 0x0034DFD8`): each pass ends the current 4800-cycle slice. The
wasm build never shipped `GameConfig.xml`; it is now embedded (`--embed-file` at
`/usr/local/share/GameConfig.xml`, the path `CGameConfig` reads), which also enables the upstream
per-game fixes for other games. Only the European executable is covered (US is SLUS_206.46 with
different addresses). Cutscene: 8-12 -> 20-45 vbl/s.

## Results (release build in `public/emu/`)

| Scene | Before | After |
|---|---|---|
| Intro movies | 10-17 fps | 22-40 fps |
| After "Executive Producer" | black screen forever (EE crashed into low memory) | game continues to the airport intro |
| Opening 3D cutscene | 8-12 fps | 20-45 fps |
| Gameplay (Grove Street, on foot) | 3-5 fps (user report) | 13-20 fps |

Gameplay profile (profiling build, save state on foot in Grove Street, 40 s average, ms of VM
thread per wall second): EE block code 370-400, VU (VU1 microprograms) 290-330, EE dispatcher
80, VIF1 75, GIF 33, COMPILE 30, IOP 20, SPU 17, HLE syscalls 15, GS wait 4. The EE itself is idle
70% of emulated cycles (the polling loop); the GS thread is ~50% busy but the VM thread almost never
waits for it. Per-thread CPU (`top -H`): the VM worker is at 99-100%, the GS worker and the main
thread at 4-11% each, so one core is the limit.

Heavy in-car police cutscene (Tenpenny/Pulaski, profiling build, ~11 vbl/s there; release ~26 fps):
EE block code 324, VU 318, VIF1 81, EE dispatcher 80, COMPILE 84 (warm-up), GIF 31, IOP 20, SPU 17,
GS wait 2 ms per second: same shape as free roam.

**Path to a locked 50 fps:** the VM thread needs to get ~2.5-3.5x faster. Rough ceilings: block linking
with wasm tail calls removes the dispatcher share (~8%, about 1.1x); VU1 on its own thread could take
VU + VIF1 (~40%) off the VM thread (at best ~1.6x, realistically 1.3-1.5x, multi-week work with
synchronisation risk). Together that is roughly 25-35 fps in gameplay. A locked 50 would additionally
need about 2x faster JIT output for EE and VU code (a new or heavily reworked wasm backend), which is
research-level work.

## Things tried and rejected

- **Register allocation in the wasm JIT backend** (16 i32 locals as "registers" for the Jitter
  register allocator, `deps/CodeGen`): worked after adding reference moves, but gameplay was within
  noise (13.7 vs 13.2 fps), so it was reverted to keep the CodeGen submodule untouched.
- **Frame skip**: not worth it. GSWAIT (VM thread waiting for the GS thread) is ~0.4% of the VM
  thread in gameplay; skipping GS work would not speed up emulation.
- **`renderer.ramreads.enabled = false`**: not needed for the same reason (GS readbacks don't stall
  the VM thread in these scenes).
- **Multi-threading**: desktop Play! also runs EE, VU0/VU1, VIF, GIF, IOP and SPU in lockstep on one
  thread; only the GS has its own thread, which the wasm build already uses. Moving VU1 (30% in
  gameplay) to its own thread would be the biggest remaining multi-core win but is a multi-week
  project (PCSX2 MTVU-style); not started.

## Persistent JIT block cache ("AOT-lite")

JIT compiling a block costs ~1-3 ms, almost all in the C++ Jitter (optimiser + wasm emitter); turning
the bytes into a callable function (`new WebAssembly.Module` + `Instance` + `addFunction`, zone
COMPILE_WASM) costs ~0.03-0.05 ms. After loading a state GTA compiles ~25k blocks, which used to mean
15-60 s of 0-8 fps.

**Design.** `CBasicBlock::Compile` (wasm only) hashes the block's instruction words with XXH3-128 and
looks up the key (category, hash, size, compile hints, variant) in `BlockCache`
(`Source/BlockCache.{h,cpp}`). On a hit it builds the `CMemoryFunction` straight from the cached wasm
bytes and skips the Jitter; on a miss it compiles as before and appends the bytes to the cache.
- The generated modules are position independent: guest state is addressed relative to the `CMIPS*`
  argument, memory goes through the page tables loaded from the context, branches are PC-relative
  (upstream already reuses EE code for identical contents at other addresses), and calls to C++
  helpers use indexes into `Module.codeGenImportTable`, which are assigned in a fixed order at startup
  (`Ps2VmJs.cpp`). Block linking/trampoline patching is disabled on wasm. So no relocation is needed;
  the salt below protects against a different import order or codegen in another build.
- `variant` carries codegen inputs that are not in the words: per-block FP rounding override and the
  `GameConfig.xml` idle-loop flag (EE), the micro memory size (VU0 vs VU1 differ in the address mask).
  Compile hints (accurate ADD/SUB, VU no-clamping, Tri-Ace ADDI) are part of the key too.
- VU blocks that compile instructions outside their own range (branch-in-delay-slot and E-bit-in-delay-slot
  cases) are not stored. The empty block is not cached.
- Write protection is unchanged: invalidated blocks are dropped as before; when the page is recompiled,
  new contents give a new hash (a hit only happens for identical code).
- Memory: entries live in the wasm heap (~1 KB per block, 25-35 MB for GTA); hard cap 96 MB, after
  which new blocks are simply not added.

**Storage (OPFS, `public/js/emulator.js`).** `boot(file)` calls `setBlockCache("<name>-<size>")`: it reads
`blockcache/<emu variant>-<game>/<n>.bin` and passes each segment to `Module.blockCacheLoad` before
booting (the VM thread only ever looks up memory, no sync OPFS access in the worker). New entries are
taken with `Module.blockCacheTakePending()` and written as a new segment file every 30 s / 1 MB and
when the page is hidden (`createWritable` on a fresh file, so nothing is rewritten). Each segment starts
with a magic + salt (Play.wasm ETag/Last-Modified/size from a HEAD request): a segment from another
build discards the game's cache, an empty/truncated segment (tab closed mid-flush) is dropped alone, and
every entry carries an XXH3-64 checksum and a `\0asm` check; parsing stops at the first bad entry.
More than 16 segments are merged into one at load. API: `setBlockCache(key|null)`,
`flushBlockCache()`, `clearBlockCache(key?)`, `blockCacheUsage()`, `boot(file, {blockCache:false})`.
`bench.html` takes `&blockcache=0|clear`; `getProfile()` reports `cacheHits` (`compiles` includes hits).

Caching compiled `WebAssembly.Module` objects (IndexedDB) was not done: with the bytes cached the
remaining COMPILE_WASM cost is ~20 ms per second of play right after a load and ~1 ms/s later.

**Results** (GTA SA, play.zip = Grove Street on foot, first 75 s after loading the state; cold = empty
cache, warm = cache filled by the previous run; profiling build, quiet machine):

| | cold | warm | cache disabled |
|---|---|---|---|
| time until fps stays near its final value | 19-34 s | 1-2 s | 24-46 s |
| samples < 10 fps in the first 60 s | 18 | 1 | 26 |
| COMPILE + COMPILE_WASM, ms/s (first 60 s) | 335 | 24 | 436 |
| cache hits / block compiles | 202 / 25165 | 24935 / 25074 | - |
| fps median, last 30 s | 20 | 22 | 20 |

Release build, car.zip (police car cutscene): cold run 29 s to stable and 13 samples < 10 fps, warm run
1 s and 1 sample. A cache filled from car.zip still served 21.8k hits when loading play.zip (stable after
3 s). With other load on the machine (a second emulator tab) a cold run took ~56-73 s to stabilise and
a warm one 6 s. Cache size on disk: 25 MB after one play.zip session, 34 MB after car + play.

## God of War: wait loops (see notes/gow-perf.md)

GoW (SCUS_973.99) polls the vsync counter and an interrupt-cleared flag with 2000/20000-iteration delay
loops between polls (~77% of EE time in combat). `GameConfig.xml` patches the delay counts to 1 and marks
the poll blocks as idle loops; patches are re-applied after a state load. The MTVU front VIF1
`SkipUnpack` also skips contiguous (cl == wl) UNPACK vectors in one step. Release, MTVU on, no limiter,
wall ms/vbl over vblanks 100-700 (2 ABAB rounds): gow-fight 28.4 -> 18.9 (-33%, 34 -> 53 vbl/s),
gow-title 12.1 -> 8.5 (-30%); car.zip 39.4 -> 38.6 and mtvu-ffx 26.1 -> 24.5 (noise, hashes identical).

## Native wasm exceptions, front VIF1 cl < wl skip (see notes/gta-profile.md)

Two game-independent items from the GTA SA per-thread profile (Play `web-perf` 9301cd51 + 83f0271f, CodeGen 5e3b752):
- **`-fwasm-exceptions`** (root `CMakeLists.txt`, compile + link, all targets; CodeGen's own build too). Play-Dependencies'
  `Header.cmake` still adds `-fexceptions` (upstream submodule, no fork), but emcc lets `-fwasm-exceptions` win. With
  JS exceptions every call that may throw from a frame with cleanups went wasm -> JS `invoke_*` -> wasm (the VM loop
  calls every IOP block and EE slice that way): ~5.5% of the VM thread, 3.5% of VU1. Play.js now has no `invoke_`,
  Play.wasm is 8% smaller. Needs Chrome 95+ / Firefox 100+ / Safari 15.2+ (the JIT already needs wasm SIMD, which is
  newer). Error paths checked in Brave and Firefox: a C++ exception caught on the VM thread still fails cleanly
  (`loadState` of a missing file -> `stateStatus()` 0, the game keeps running); an uncaught one thrown into JS
  surfaces as a `WebAssembly.Exception`; an uncaught one on a pthread reaches the page's `error` event ("worker sent
  an error!") as before.
- **Front VIF1 `SkipUnpack` with CYCLE cl < wl** (filling write; GTA uses it): computed in one step instead of one
  vector at a time (`Cmd_UNPACK` self was 4.6% of the VM thread). Read ticks are the first cl of each wl-tick group,
  the first read without data stops it. A self-check against the loop (cl/wl 0..16 and wl = 0, all tick start
  states, num 1..256, partial data: 280M cases; plus 20M random over cl/wl 0..255) gives identical num, ticks and
  bytes consumed.

State hashes (`hash=300&vu1thread=0&nolimit=1`) identical: car 55dab76e, mtvu-ffx 5927b89c, play 1f851c1c,
gow-fight 718a88cc; play and car also identical with MTVU on (front path). Timing, release, MTVU on, no limiter,
wall ms/vbl over vblanks 100-600, ABAB, 2 rounds, load 3-5 from other agents:

| state | before | after |
|---|---|---|
| play.zip | 30.99 / 30.93 | 30.59 / 30.40 (-1.5%) |
| car.zip | 42.00 / 39.32 | 39.65 / 40.41 (-1.5%, noisy) |

The earlier A/B of the flag alone with the limiter on (30 s from vblank 600) gave -4.4% ms/vbl on play.zip.

## VU1 thread: microprogram block cache, block chaining, fewer flag writes (see notes/vu-jit.md)

Branch `vu1-fast` (merged into web-perf as 992afde4). GTA SA's VU1 thread was ~24 ms/vbl (quiet box), right
behind the VM thread; 50 vbl/s needs both under ~19.
- **Block sets per micro memory contents** (8c94acd4): MPG uploads no longer drop the compiled VU blocks; dirty
  256-byte pages are rehashed before the next run and the executor switches to the block table of those contents
  (up to 64 sets kept). GTA swaps microprograms all the time and now finds its blocks again.
- **VIF unpack with wasm SIMD** (5bb13f63): runs of contiguous read+written vectors converted with SIMD.
- **VU block chaining** (2c5d9300): a VU block without exception tail calls (`return_call_indirect`) the block at
  nPC from the executor's block table instead of returning to the dispatcher; VU blocks are also batched into
  shared modules like EE blocks. `Module.setVuBlockChaining(bool)`.
- **Status/clip flag writes nothing reads** (135e48b2, VU1 only since a later fix): the existing MAC-flag liveness
  analysis now also drops sticky (status) and clip flag pipeline writes no reader can see, in VU1 code. `Module.setVuSkipFlagWrites(bool)`; block cache
  codegen version 2 (old cached blocks are recompiled once).

State hashes (`hash=300&vu1thread=0&nolimit=1`): block cache, SIMD and chaining identical (car 55dab76e, play
1f851c1c, mtvu-ffx 5927b89c, gow-fight 718a88cc, VU memories too). With flag skipping the EE/VU state hashes of
car and play change only in the flag pipeline arrays: `vuHashResult` now also prints EE/VU0/VU1 state hashes
without those arrays, identical with skipping on and off (car, play, gow-fight), all memories identical;
mtvu-ffx and gow-fight EE hashes unchanged. The first version also skipped them in VU0 code, whose pipelines are
copied into the EE context, so the EE state bytes changed; restricted to VU1, EE hashes are identical again (car,
play, gow-fight, mtvu-ffx), only the VU1 state hash differs. Merged build (web-perf 992afde4): car 55dab76e, play
1f851c1c, mtvu-ffx 5927b89c, gow-fight 77f177fc, gow-intro b2119704 (= web-perf d215ce84).

Timing, release, MTVU on, no limiter, vblanks 100-600, warm cache, quiet box (load ~3, last 2 ABAB rounds; earlier
rounds were taken with load 13-17 and swap full and are not used). VU1 = CPU ms/vbl of the VU1 worker thread
(`/proc/<renderer>/task/*/schedstat`):

| play.zip | base (public/emu) | + block sets | + SIMD unpack | + chaining | + flags |
|---|---|---|---|---|---|
| wall ms/vbl | 26.26 / 26.78 | 26.05 / 25.60 | 25.99 / 26.10 | 26.15 / 26.15 | 25.83 / 25.59 |
| VU1 CPU ms/vbl | 20.24 / 20.62 | 18.95 / 19.25 | 19.33 / 19.10 | 18.64 / 18.72 | 18.24 / 18.62 |

| car.zip | base | + block sets | + SIMD unpack | + chaining | + flags |
|---|---|---|---|---|---|
| wall ms/vbl | 31.62 / 35.27 | 32.65 / 32.36 | 31.94 / 31.63 | 33.11 / 31.79 | 31.10 / 32.81 |
| VU1 CPU ms/vbl | 28.93 / 29.05 | 25.59 / 25.57 | 26.41 / 25.67 | 24.97 / 25.24 | 25.37 / 26.82 |

VU1 thread -10% (play 20.4 -> 18.4, car 29.0 -> ~26); most of it from the block sets, chaining and flags ~2% each,
the SIMD unpack within noise. Wall time is unchanged: the VM thread (25.8 ms/vbl on play) is the limit, so this
buys headroom for VM-thread work rather than speed by itself. gow-fight wall times varied 7-31 ms/vbl between runs
of the same build (not usable).

## Tier-2 EE regions (not published, see notes/tier2-m2b.md)

Hot EE entries compiled as regions (up to 16 tier-1 blocks of one 4 KB page in one structured wasm function,
Play `tier2` fadcfea1, `public/emu-t2`, `&t2=16`). State hashes identical on play/car/gow-fight/mtvu-ffx, GTA SA
cold boot reaches the intro, but slower: wall ms/vbl over vblanks 100-600 (VU1 on VM thread, no limiter, 2 ABAB
rounds) play.zip 40.3 -> 46.5 (+15%), car.zip 46.3 -> 57.8 (+25%), gow-fight 58.8 -> 76.6 (+30%), mtvu-ffx
33.9 -> 35.7 (noise); car.zip steady state (1100-1600) 34.0 -> 35.4. Likely cause: region churn (regions span data
between their parts, data writes drop them, hot entries rebuild them; ~500 regions/s at GTA cold boot). Off by default.

## Automatic EE wait loops, IPU CSC (Play `web-perf` d215ce84, see notes/auto-idle.md)

- **Wait loop detection** (`CWaitLoopAnalyzer`, EeExecutor.cpp): loops whose iterations only read memory / side
  effect free hardware registers and leave their registers unchanged end the EE slice like a GameConfig
  `IdleLoopBlock`; multi-block loops, calls (3 deep) and FlushCache syscalls are covered, unsafe side paths only
  mark the pass as not idle. It finds God of War's vsync / flag / SIF RPC polls, so its 4 `IdleLoopBlock` entries
  were removed. Same speed as the per-game entries on every bench state (EE busy share identical), generic for
  other games and regions. Hashes identical on car/play/mtvu-ffx; gow-fight 718a88cc -> 77f177fc (the detector
  idles on the second identical pass, an IdleLoopBlock on the first).
- **IPU CSC**: the 384 bytes of a macroblock are read from the input FIFO in one copy instead of one
  `TryGetBits_MSBF(8)` per byte, and YCbCr -> RGBA runs 4 pixels at a time with wasm SIMD (same float operations,
  bit identical, self-checked against the scalar loop). God of War opening movie (gow-intro.zip, EE 100% busy,
  VM thread bound): 22.4 / 22.9 / 24.6 -> 19.1 / 21.8 / 19.3 ms/vbl (about -15%, ~44 -> ~52 vbl/s without limiter).
  Hashes unchanged (gow-intro b2119704). Left: BDEC VLC decoding (~9% of the VM thread in movies) and the game's own
  EE bitstream code (~80% of EE samples in that movie).

## Remaining bottlenecks / next steps

1. EE JIT code quality and dispatch: every block returns to the C++ dispatcher (no block linking on
   wasm) and every compiled block is its own WebAssembly module called through `call_indirect`.
   Block linking with `return_call_indirect` (wasm tail calls) would remove the dispatcher share.
2. VU1 microprograms (~30%): same JIT; VU1 on its own thread would use a second core.
3. JIT compile cost: ~1-3 ms per block, almost all in the C++ Jitter optimiser, not in V8. The
   persistent block cache above removes it for code seen in an earlier session; code never seen
   before still stutters the first time.
4. FP rounding: the wasm build cannot set round-toward-zero like desktop (no FP environment).

## How to reproduce

```sh
# release (public/emu) and profiling (public/emu-prof) builds
cmake --build build_cmake/build/wasm-simd --config Release --target Play -j12
emcmake cmake -S . -B build_cmake/build/wasm-prof -G "Ninja Multi-Config" -DBUILD_PSFPLAYER=OFF \
  -DBUILD_TESTS=OFF -DUSE_QT=OFF -DPROFILE=ON -DCMAKE_C_FLAGS=-msimd128 -DCMAKE_CXX_FLAGS=-msimd128 \
  -DCMAKE_EXE_LINKER_FLAGS=-msimd128
cmake --build build_cmake/build/wasm-prof --config Release --target Play -j12
```
Then open `http://localhost:8080/bench.html?emu=prof&game=GTA%20San%20Andreas%20(Europe).iso`,
call `bench.save("x.zip")` in the console at an interesting point and later reload with
`&state=x.zip`; `bench.prof` holds one sample per second. Save states are per-origin OPFS data in
the browser profile.
