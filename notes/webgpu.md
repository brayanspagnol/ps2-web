# WebGPU GS renderer (port of Play!'s Vulkan GS) - working notes

Goal: a GS backend for the WebAssembly build that works on GS local memory directly (like
`Source/gs/GSH_Vulkan`), so format aliasing (CT16 views of CT32 buffers, God of War's channel-shuffle
shadows, Sly) is exact. WebGL2 (`GSH_OpenGLJs`) stays the default; WebGPU is picked at runtime.

Branch `webgpu` of the Play! fork (worktree `play-webgpu/`, based on web-perf 6229ce4a).
Test builds: `public/emu-webgpu*/` (never `public/emu/`).

## M0: availability (2026-10-16)
Test Brave (Chrome/151, Linux, Intel Raptor Lake-P UHD iGPU), default flags, no `--enable-unsafe-webgpu`
needed: `navigator.gpu` present, `requestAdapter()` returns a non-fallback adapter (adapter.info strings
are empty: privacy), preferred canvas format `rgba8unorm`. Features include `timestamp-query`,
`subgroups`, `shader-f16`, `float32-filterable`. Limits: storage buffers up to 4 GB, 16 storage buffers
per stage (also in the fragment stage), 49152 B workgroup storage, 1024 invocations/workgroup,
`maxImmediateSize` 64. In a dedicated worker: `requestAdapter`/`requestDevice`, `OffscreenCanvas`
`getContext('webgpu')`, render pass, `transferToImageBitmap` all work.
Check script: scratchpad `wgpu/gpucheck.js` (run with `wgpu/cdpeval.mjs <url> gpucheck.js`).

## Decisions

### API path: plain JS WebGPU from the GS thread (no emdawnwebgpu)
Emscripten 4.0.1 only has the old, deprecated `-sUSE_WEBGPU` (library_webgpu.js, old webgpu.h); the
emdawnwebgpu port came later. WebGPU objects can't move between workers, so the device must live on the
GS thread anyway. The C++ side (GS thread) records a compact command list + an upload arena in wasm
memory and calls one JS function per flush; JS (`Source/ui_js/GSH_WebGPU.js`, linked with `--pre-js`, so
it exists in every pthread worker) decodes it and issues `writeBuffer` / compute passes / copies /
present. Few JS<->wasm crossings, no binding layer to maintain.

### Shaders: hand-written WGSL, not Nuanceur
Nuanceur has SPIR-V, GLSL and HLSL generators, no WGSL. Converting SPIR-V offline (Tint/Naga) would only
work for a fixed set of pipelines, but Play! generates one pipeline per PIPELINE_CAPS combination at run
time. More importantly the Vulkan draw path can't be reused as-is (below), so the draw shader is new code
anyway. The transfer/CLUT/present shaders are small and are ported by hand to WGSL, following
GSH_VulkanTransferHost/TransferLocal/ClutLoad/Present/MemoryUtils/DrawUtils line by line. Pipeline
specialization, if needed for speed, via WGSL `override` constants (one module, few pipelines), avoiding
per-caps pipeline compiles (Dawn/Tint compiles are slow and would stutter).

### Draws: compute rasterizer, because WebGPU has no fragment interlock
The Vulkan desktop path draws with the hardware rasterizer and a fragment shader that does the whole GS
pixel pipeline as read-modify-write on the GS memory storage buffer, ordered by
`VK_EXT_fragment_shader_interlock` plus a by-region barrier between draws. The mobile path uses input
attachments (framebuffer fetch). WebGPU has neither: storage writes from overlapping fragments race,
and there are no barriers inside a render pass. Splitting into a render pass per overlapping primitive
is far too slow (triangle strips overlap their neighbours' bounding boxes).

So draws are rasterized in a compute shader where each invocation owns one pixel of the current frame
buffer and walks the primitives of a batch in order: per-pixel ordering is exact and there are no races
on the frame/depth buffer words a pixel owns (16-bit formats share words between pixels: atomics, as in
the Vulkan shader).
- Batch = run of primitives with the same frame buffer and depth buffer (FBP/FBW/PSM, ZBP/PSM). GS
  state changes inside a batch just add a state record (tex/clut/blend/test/fog/scissor...) referenced
  by each primitive; a batch is one dispatch. Batches end at FRAME/ZBUF changes, transfers, CLUT loads,
  flips, and when a primitive's texture range overlaps the batch's frame/depth memory (the dispatch
  boundary gives the same "previous draws are visible" guarantee as the Vulkan barrier between draws).
  Primitives whose texture overlaps the frame/depth area they write use the Vulkan backend's memory-copy
  scheme (copy the texture range first; sprites start a new copy when they overlap the area written since);
  a batch also ends when its write range grows over a texture one of its primitives read.
- Workgroup = 8x8 pixel tile (16x16 for batches whose primitives average >= 256 pixels: full screen
  effects), invocations mapped to 4x4 pixel blocks (one SIMD16 thread each on Intel). Binning on the CPU
  (`FlushBatch`): per tile, the primitives whose bounding box touches it, minus triangles with all the
  tile's sample points outside one edge; only non-empty tiles get a workgroup, longest lists first. The
  workgroup takes the list 64 (256) primitives at a time: each invocation computes one primitive's coverage
  mask of the tile, then every invocation shades the primitives covering its pixel, in order.
- Per fragment: depth test, DATE and scan mask first (a fragment failing them is dropped whatever the alpha
  test says), then color/texture interpolation, texturing, TFX, fog, alpha test, blending. Frame/depth
  values stay in registers for the whole batch (one read and one write per pixel per batch). Sub-word
  writes (16/8/4-bit) are one atomic XOR with the read value (each bit has one writer per dispatch).
- Draw pipelines are specialized (override constants) per batch for the features it uses and for its
  texture formats (32/16-bit, T8, T4, 16/32-bit CLUT); unused paths compile out (fewer registers/spills).
- Coverage/interpolation follow what the Vulkan path gets from the hardware: pixel (x, y) is sampled at
  GS coordinate (x, y) (vertex + 0.5 in Vulkan), top-left fill rule on 12.4 fixed-point edges, sprites
  cover [x1, x2) x [y1, y2), attributes interpolated linearly in screen space (STQ divided per pixel).
- Per-pixel logic = GSH_VulkanDrawDesktop::CreateFragmentShader + GSH_VulkanDrawUtils ported to WGSL with
  runtime branches on the state record instead of per-caps code generation.

### GS memory, CLUT, readback
- GS memory: 4 MB storage buffer (`array<atomic<u32>>`), plus a copy buffer (texture self-reads,
  local->local self copies) and a 32-slot CLUT buffer, exactly as the Vulkan backend. Swizzle tables are
  one storage buffer with the 8 page-offset tables (CGsPixelFormats::CPixelIndexor<...>::GetPageOffsets).
- CPU copy `m_memoryCache` (GetRam), WriteBackMemoryCache/SyncMemoryCache as in Vulkan.
- Readback (local->host transfers, save states) is asynchronous in WebGPU (`mapAsync`). The GS thread
  suspends: it returns to the worker's event loop after the call that started the readback, and JS
  resumes `ThreadProc` once the map resolved (same mechanism as the per-flip yield in notes/gs-hang.md).
  Calls queued meanwhile wait in the mailbox; SaveState adds an empty waited call after the sync so the
  VM thread only reads GetRam() once the data is there.
- Device creation is async too: the init GS call starts it and suspends the thread until it's done.

### Present / page integration
Present = port of GSH_VulkanPresent (fragment shader reading the display frame buffer out of GS memory)
into a render pass on the GS thread's OffscreenCanvas `webgpu` context, then the existing
`transferToImageBitmap` + `onGsFrame` path. Runtime selection: `?gs=webgpu` (bench/site) ->
`emulator.js` checks `navigator.gpu.requestAdapter()` on the page and sets `Module.gsBackend` before
`initVm`; anything else, or no adapter, keeps WebGL2.

## Milestones
- M0 (done): availability + decisions (this file).
- M1: GS memory, host->local / local->local transfers, local->host readback, CLUT loads, present; a
  game's boot screens visible where they are made from transfers (FMVs are host->local transfers).
- M2: draws (triangles, sprites, lines, points; texturing incl. CLUT, mipmaps, filtering; blending, alpha
  and destination alpha tests, depth, FBMSK, fog, FBA, COLCLAMP, scan mask).
- M3: correctness: God of War gow-fight.zip (colors and shadows; reference: Vulkan screenshot in
  jpd002/Play-Compatibility#199), GTA play.zip, FFX mtvu-ffx.zip vs WebGL2.
- M4: performance vs WebGL2 (alternated runs), GPU time (timestamp queries), optimizations (tile-local
  frame buffer cache in workgroup memory, specialized pipelines, fewer dispatches).

## Code map (Play! fork, branch `webgpu`)
- `Source/gs/GSHandler.{h,cpp}`: `SuspendThreadProc()` (GS thread returns to the worker event loop until JS
  calls `ResumeThreadProc(this)`).
- `Source/ui_js/GSH_WebGPU.{h,cpp}`: CGSH_WebGPU (GS thread). Register/primitive handling ported from
  GSH_Vulkan.cpp; records a command list (`OP_*`), an upload arena, primitives (`PRIM_WORDS` = 28 words) and
  state records (`STATE_WORDS` = 40, layout in `STATE_*`). Batches = runs of primitives with the same
  frame/depth buffer; binned per tile in `FlushBatch`. Command lists are submitted at flips and every
  `SUBMIT_PRIMS` primitives. Host transfers are queued (`m_pendingXfers`) and dispatched together; CLUTs use a
  1024-slot ring (32-bit CLUTs stored as whole colors); CLUTs whose memory the CPU copy holds (small host
  transfers, `m_cpuValid`) are built on the CPU (`LoadClutFromCpu`).
- `Source/ui_js/GSH_WebGPU.js` (`--pre-js`): `GsWgpu` (device, buffers, pipelines, `execute()`), all WGSL;
  one compute module (8x8 draw tiles). `drawFeatures` = override constants of the specialized draw pipelines.
  `drawConfig.noDecode` ignores the decoded textures (A/B on the same capture: hashes must match).
- Decoded textures (`CGSH_WebGPU::DecodeBatchTextures`, `texDecode` shader): per batch, textures whose primitives'
  bounding box area >= texel count (level 0, repeat/clamp, not memory copies) are decoded to 32-bit colors (CLUT
  and TEXA applied) in a 16 MB buffer before the draw; `STATE_TEX_DECODED` (state word 36) = 1 + offset. State
  records are per batch (`m_batch.stateStart`). `DRAW_FEATURE_TEXDECODED` (bit 19); the format bits are then
  those of the non-decoded textures only.
- `Source/ui_js/Main.cpp`: `Module.gsBackend = "webgpu"` before `initVm` picks the backend;
  `Module.setGsDebug(1)` logs stats from the GS worker every 2 s (frames/s, submits, batches, prims, upload,
  JS time and GPU time per submit), `setGsDebug(2|1)` captures a frame (`Module.onGsCapture(object)` on the
  page), `setGsDebug(4|1)` skips draws (CPU-bound speed of the rest).
- Site: `public/js/emulator.js` `?gs=webgpu`.

## Tools (scratchpad `wgpu/`, session-specific; recreate from here if lost)
- `wrun.mjs '<bench query or url>' <secs> [--shot=prefix --shotAt=a,b] [--debug | --gsdebug=N]
  [--captureAt=s --captureDir=dir] [--done=expr]`: own tab on the test Brave ([::1]:9222), worker console
  capture (GSH_WebGPU stats lines), vbl/s samples, abort rules, `time=` results; `--captureAt` saves a frame
  capture (memory/copy/CLUT/swizzle buffers + every command list of the frame) into
  `public/emu-webgpu-replay/<name>/` (gitignored). `t1.sh <emu> <state> <label> [--gl] [wrun args]`: one
  `nolimit=1&time=100,700` run (ms per vblank over vblanks 100-700).
- Offline replays without the browser, on the same Dawn + Mesa/ANV stack (npm `webgpu` 0.6.1 = Dawn node
  bindings, in scratchpad `dawn/`): `nreplay.mjs <capdir> [src=GSH_WebGPU.js] [profile=1 all=1]` prints wall ms,
  per-dispatch GPU times and the GS memory hash; `nab.mjs <capdir> A.js B.js [n]` interleaves A and B runs
  in one process and prints the median per-pair ratio B/A plus both hashes (equal hash = same output). Run
  them under `locks/bench-run` (the GPU is shared). Captures only replay with a `GSH_WebGPU.js` whose
  command/upload layout matches the build that made them.
- `isa.sh <src.js> [features hex...]` (`nisa.mjs`): compiles draw pipelines under
  `MESA_SHADER_CACHE_DISABLE=true INTEL_DEBUG=cs` and prints Intel SIMD width, instruction count, spills.
- Measuring: the iGPU clock is managed by SLPC/PL1 and varies 300-1400 MHz with the load of the machine
  (`/sys/class/drm/card1/gt/gt0/rps_act_freq_mhz`, `throttle_reason_*`): absolute times move 2x between runs.
  Decide with interleaved A/B ratios (`nab.mjs`) and alternate WebGPU/WebGL2 game runs.
- Note: every new Play.wasm invalidates the JIT block cache, so the first in-game run of a build compiles a
  lot (jit=600+); compare builds on a second run. The `--pre-js` file is not a build dependency: delete
  `Release/Play.js` to relink after editing only `GSH_WebGPU.js`.

## Log
- 2026-10-16 M1: transfers/present working (emu-webgpu1), black frames. M2: draws (emu-webgpu2): GTA play.zip
  looks like WebGL2 (slightly warmer colors), GoW gow-fight has correct colors without the green hack and
  draws its shadows. Performance first pass: GoW 14-20 vbl/s, GTA 17-26 (WebGL2 30-50).
- Perf findings (replay, Intel UHD): the GPU is latency-bound, not ALU-bound. Testing every primitive of a
  batch against every tile was O(tiles x prims) (CPU binning fixed it); CLUT loads split GoW's main pass into
  ~60 dispatches (CLUT ring fixed it); per-lane coverage tests were the biggest cost: each primitive's 8x8
  coverage mask is now computed once per tile by one invocation (incremental edge functions), lanes skip
  uncovered primitives (GoW frame 91 -> 52 ms). Workgroup-memory copies of primitives were slower (dropped).
  GTA streams ~500 small texture/CLUT uploads per frame: transfers are now merged into one dispatch and
  hoisted over the open batch when it doesn't touch their memory; CLUTs from those uploads are built on the CPU.
- 2026-10-19 M4 performance (commits 05618372..771c87dd on `webgpu`). What was slow, measured with offline
  replays (Dawn node + ISA dumps) and in-game `nolimit` runs:
  - GoW was GPU-bound: with draws skipped (`setGsDebug(5)`) the emulator ran 20.6 ms/vblank, i.e. faster than
    WebGL2; with draws 32 ms. GPU 35-60 ms per GoW frame, only ~60% busy, and the Intel GPU clock (SLPC,
    shared PL1 power with the CPU) sat at 300-700 MHz most of the time.
  - Draw shader: the unrolled bilinear CLUT path spilled (37 spills / 132 fills in the GoW variant); scalar
    `prims`/`states` loads were bounds-checked one by one and not merged (137 sends). Atomic loads cost nothing
    extra on ANV (same ISA as plain loads); the swizzle table lookup is cheaper than computing the swizzle;
    a bilinear tap loop (no spills) was 1.5x slower (serialized latency); workgroup-memory copies of primitives
    and a "dense fragments" variant (fragments of a chunk computed one per invocation, then resolved per pixel)
    were slower too.
  - 44% of the tile entries of a GoW frame covered no pixel (bounding box only); a third of the GPU time went
    to ~40 small full-screen sprite passes (shadows) whose cost is the fixed per-workgroup chain of loads;
    16x16 tiles for such batches did not help in game (reverted).
  - Sub-word writes were two atomics; FFX streams ~1M PSMT8/PSMT4 texels per frame through per-texel atomics.
  - GTA SA had a real race (texture read while another tile writes it): replays gave different results.
  Fixes (each checked on replays: same GS memory hash, interleaved A/B ratio): vec4 loads of prims/states
  (~0.85x), depth test + DATE + scan mask before texturing (0.84x), CPU culling of empty tile entries,
  non-empty tiles only and longest first, single-atomic XOR sub-word writes (GoW 0.92x, FFX 0.83x),
  pipelines specialized by texture format (0.93x), whole-word PSMT8/PSMT4 transfers (FFX frame 63 -> 38 ms
  unlocked), 32-bit CLUT entries in one word, lazy frame buffer reads, mid-frame submits. Race fixes: split the
  batch when its write range grows over a texture it read; memory copy for any primitive whose texture
  overlaps the area it writes.
  In game (`nolimit=1&time=100,700`, ms per vblank, WebGPU vs WebGL2 of the same build, two alternated rounds;
  machine shared with other agents, +-15% between rounds): before (HEAD 2adc2ef3 + previous session's work):
  GoW gow-fight 29.4 vs 22.9, car 41.3 vs 59.6. After (6698b549): GoW 27.9 / 25.9 vs 27.7 / 21.5 (~9% slower),
  car 37.8 / 34.6 vs 40.8 / 34.7 (~4% faster), FFX mtvu-ffx 32.7 / 25.2 vs 31.7 / 24.6 (parity). GoW GPU time
  per frame ~40 -> ~21 ms.
  771c87dd (race fixes) on a quieter machine: GoW 27.0 / 24.8 vs WebGL2 19.7, so GoW is still 10-30% behind
  (GPU-bound on this iGPU); next candidates: the per-workgroup fixed cost of the many small sprite passes
  and texture sampling (~25% of a GoW frame).
  M3: FFX mtvu-ffx renders like WebGL2 (credits scene, field + characters + text); GoW gow-fight shows the
  shadows and correct colors (WebGL2 shows shadow artifacts there); gow-title and car match WebGL2.
- 2026-10-19 (later) GoW parity attempt (commits 28d708a7, bb5bc818 on `webgpu`, then merges of web-perf 2ed06e87
  and 83f0271f). Replay breakdown of a GoW gow-fight frame (`v/` variants in scratchpad `wgpu/`, ratios vs base):
  no shading 0.38 (tile setup + coverage + write back; coverage alone ~1/4 of that), shading up to the depth
  test 0.72 (prim loads 0.16, state loads + depth 0.18), texturing 0.22, bilinear vs point 0.18; ALU parts
  (weights, blending, interpolation) 1-4% each. 58% of shaded fragments pass the depth test, 98% of those blend.
  Main triangle pass = 60-75% of the frame GPU time, ~40 full screen passes (shadow channel shuffles) most of the
  rest; 32 MB of OP_MEMORY_TO_COPY and 7 MB of uploads per frame (copies ~1%, prim upload ~7% of replay wall).
  Kept: decoded textures (frame replay 0.83x, same hash), analytic coverage rows (0.97x, same hash).
  Tried and dropped: per-pixel "direct" draws without tile lists for batches of <= 4/16 full screen primitives
  (no gain, and worse with 16 strips: the cost is the per-pixel shading chain, not the tile setup); software
  pipelined primitive loads (108 spills, 1.5x slower). Note: shader changes outside shade() can still change the
  output hash slightly (codegen of the float interpolation), so hash equality only holds for changes that keep
  shade()'s code.
  In game (in-game GPU time: the GS thread waits 8-16 ms per frame for the GPU with MAX_FRAMES_IN_FLIGHT = 2, so
  GoW is GPU-bound; the iGPU clock sits at 350-950 MHz while the CPU is busy), ms per vblank, `nolimit=1&time=100,700`,
  alternated, machine shared with another agent:
  gow-fight GL 19.4 / 19.1 vs WebGPU 25.7 / 25.7 (+33%); car GL 41.5 / 40.4 / 45.8 vs 40.4 / 42.0 (one 54.9 outlier),
  about parity to -5%; mtvu-ffx GL 29.0 / 28.6 vs 29.6 / 30.6 / 29.6 (+3%); gow-title GL 9.7 / 9.9 vs 12.7 / 11.0 (+12-31%). The merged build (web-perf 83f0271f) renders GoW fine.
  Decision: WebGPU is NOT the default (GoW 30% slower, overall slower; visuals are only better in GoW's shadows).
  The site keeps WebGL2 with `?gs=webgpu` opt-in. Prepared but not applied (emulator.js): pick WebGPU when
  `requestAdapter()` + `requestDevice()` succeed, `?gs=webgl` forces WebGL2, and `Module.onGsDeviceLost` (sent by
  GsWgpu on device loss or failed init since bb5bc818) sets a sessionStorage flag and reloads on WebGL2.
  What would close the gap: the per-fragment chain (prim + state loads, then texture) is ~5-10x a hardware
  rasterizer's cost on this iGPU; remaining ideas are a hardware-rasterized path for batches whose result doesn't
  depend on order (no blending/alpha test, depth test with writes) and smaller primitive records.
