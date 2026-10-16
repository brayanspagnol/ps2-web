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
  Sprites sampling their own frame buffer use the Vulkan backend's memory-copy scheme (copy the texture
  range first; start a new copy when a sprite overlaps the area written since).
- Workgroup = 16x16 pixel tile over the batch's bounding box. Binning on the GPU: the workgroup tests 256
  primitive bounding boxes at a time, keeps an ordered bitmask, then every invocation shades the
  overlapping primitives in order.
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
  frame/depth buffer; binned per 8x8 tile in `FlushBatch`. Host transfers are queued (`m_pendingXfers`) and
  dispatched together; CLUTs use a 1024-slot ring; CLUTs that come from a recent small host transfer are built
  on the CPU (`LoadClutFromTransfer`).
- `Source/ui_js/GSH_WebGPU.js` (`--pre-js`): `GsWgpu` (device, buffers, pipelines, `execute()`), all WGSL.
  `drawConfig` = shader tuning knobs; `drawFeatures` = override constants of the specialized draw pipelines.
- `Source/ui_js/Main.cpp`: `Module.gsBackend = "webgpu"` before `initVm` picks the backend;
  `Module.setGsDebug(1)` logs stats from the GS worker every 2 s, `setGsDebug(2|1)` captures a frame
  (`Module.onGsCapture(object)` on the page).
- Site: `public/js/emulator.js` `?gs=webgpu`.

## Tools (scratchpad `wgpu/`, session-specific; recreate from here if lost)
- `wrun.mjs '<bench query>' <secs> [--shot=prefix --shotAt=a,b] [--pre=expr] [--captureAt=s --captureDir=dir]`:
  own tab on the test Brave, worker console capture, vbl/s samples, abort rules; `--captureAt` saves a frame
  capture (memory/copy/CLUT/swizzle buffers + command lists) into `public/emu-webgpu-replay/<name>/`.
- `public/emu-webgpu-replay/replay.html?cap=<name>&iter=N[&tile=8&primCache=0&pixelCache=1&exit=k&profile=1]`
  (gitignored dir): replays the capture with the current `GSH_WebGPU.js` copied next to it; prints wall
  ms per frame, a hash of GS memory after the frame (must not change with optimizations), per-dispatch GPU
  times with `profile=1`, `exit=k` stops shading at stage k (profiling). `replay.sh <name> [iter] [shot] [query]`.
- `cmp.sh <emu> <play|car|ffx|gow-fight> <secs> <tag> [shotAt]`: WebGPU run then WebGL2 run of the same state.
- Note: every new Play.wasm invalidates the JIT block cache, so the first in-game run of a build compiles a
  lot (jit=600+); compare builds on a second run. The GPU is shared (other agents' tabs): use the replay
  minimum and repeat.

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
