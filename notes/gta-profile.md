# GTA SA free roam: where the time goes, per thread (2026-10-19)

Goal: pick the next optimization target for GTA SA (PAL) at 50 vbl/s. Build: web-perf 2ed06e87 (same code as
`public/emu`), release, relinked with `--profiling-funcs` (`public/emu-gtaprof`). States play.zip (Grove Street on
foot) and car.zip (police car cutscene), warm block cache (one 2500-vblank warm-up per state first), limiter on,
VU1 threaded (defaults), audio worklet running (canvas clicked through CDP). Window: 30 s starting at vblank 600
after the state load. Shared 12-thread laptop (PL1 28 W); other agents' work changed the speed of the whole box by
~25% between runs, so absolute numbers are given for two machine states and ratios are what matter.

Method: per-vblank timeline (`getTimeline`), per-thread CPU from `/proc/<renderer>/task/*/schedstat` (+ the test
Brave's GPU process), and V8 CPU profiles (250 us) of the page, every worker and the audio worklet over CDP
(`Target.setAutoAttach`). Profiled runs are ~25-45% slower (profiler overhead), so category *shares* come from the
profiles and ms/vbl are those shares times the thread's CPU in an unprofiled run of the same state. Causality was
checked with a throwaway build that burns N us per vblank on the VM thread or on the VU1 thread (`setSpin`).
Tools: scratchpad `gp/` (`gp.mjs` run + profiles, `ana.py` timeline/threads, `cat.mjs` categories, `callers.mjs`,
`sub.mjs`, `pa.mjs`).

## 1. Per-thread load (ms of CPU per emulated vblank)

| thread | play, quiet box (38.0 vbl/s, 26.3 ms/vbl) | play, loaded box (30.3 vbl/s, 32.9 ms/vbl) | car, loaded box (28.4 vbl/s, 35.1 ms/vbl) |
|---|---|---|---|
| VM worker (EE + IOP + SPU2 + front VIF1) | **25.8 (98%)** | **32.2 (98%)** | **33.2 (94%)** |
| VU1 worker (MTVU) | **24.3 (92%)** | **29.8 (91%)** | **31.7 (90%)** |
| GS worker (WebGL2 on OffscreenCanvas) | 18.7 (71%) | 24.2 (73%) | 24.8 (70%) |
| GPU process main thread (executes the GL) | 15.2 (58%) | 20.8 (63%) | 22.3 (63%) |
| audio worklet (WSOLA stretch) | 0.9 (3.5%) | 1.35 (4%) | 1.3 (4%) |
| renderer main thread | 0.9 (3%) | 0.5 (1.5%) | 0.8 (2%) |
| other renderer threads (V8 background compile, IPC IO) | ~4 | ~4.5 | ~4.5 |

Timeline, play quiet / play loaded / car loaded (ms per vblank, means): VM waits for VU1 (`vu1sync`) 0.24-0.47 /
0.51 / 1.94; ring full 0 / 0 / 0; VU1 waits for GS (`vu1gswait`) 0.75 / 1.07 / 0.60; frame limiter 0.01 / 0.01 /
0.04 (never sleeps); disc 0.0 / 0.07 / 0.42; JIT compile on VM 0.13 / 0.22 / 1.07 (warm cache); GS busy 17.5 / 23.0 /
23.5; VU1 busy (includes its GS waits) 25.1 / 31.2 / 32.5; EE busy 30% of EE cycles (the rest is the declared idle
loop). GTA renders every 2nd vblank: work vblanks take ~45 ms (quiet) and the idle ones ~2 ms.

### Critical path
- The **VM thread is the critical path**: ~98% CPU, it almost never waits (VU1 sync 1-2% of its time, limiter 0,
  GS 0). The GS thread (~71%) and the GPU process (~58-63%) have headroom.
- But the **VU1 thread is right behind it**: 90-92% CPU, the same ratio to the VM (0.92-0.95) in every run and
  state. Its slack is ~2-3 ms per vblank.
- Spin test (quiet box, 3 rounds; deltas normalized by GS busy time as a machine-speed proxy because the box drifted):
  +4 ms/vbl on the VM thread -> wall +2.5..+3.9 ms/vbl; +4 ms/vbl on the VU1 thread -> +0.8..+2.0 (absorbed by its
  slack); +8 ms/vbl on VU1 -> +4.6..+6.7 (VU1 becomes the limiter, `vu1sync` jumps from 0.3-0.5 to 5.1-5.4 ms/vbl).
- Consequence: **any VM-only speedup is capped at ~+10% (38 -> ~42 vbl/s quiet, 30 -> ~33 loaded)**, after which
  VU1 limits. 50 vbl/s = 20 ms/vbl needs the VM *and* the VU1 thread each under ~19 ms/vbl (quiet box: -6.8 and
  -6.3 ms); the GS thread (18.7) would then be at ~95% and become the next limit.

## 2. Inside the threads (category shares from profiles, ms/vbl scaled to the unprofiled loaded-box run)

Every sample goes to the first category matching its stack, leaf first; JIT frames (`wasm-function[N]`) go to the
executor that called them (EE: `CEeExecutor::Execute`; IOP: the executor inlined in the VM loop; VU: `CVpu`).

### VM thread (play 32.2 / car 33.2 ms/vbl CPU)
| # | category | play % | play ms | car % | car ms |
|---|---|---|---|---|---|
| 1 | EE JIT code (compiled blocks, incl. inline page-table memory access) | 38.0 | 12.2 | 34.1 | 11.3 |
| 2 | EE dispatcher (`CEeExecutor::Execute` self: lookup, call_indirect, cycle checks) | 21.2 | 6.8 | 20.2 | 6.7 |
| 3 | front VIF1 (decode + UNPACK skip; `Cmd_UNPACK` self alone 4.6%) | 9.2 | 3.0 | 8.5 | 2.8 |
| 4 | IOP JIT code | 7.8 | 2.5 | 7.5 | 2.5 |
| 5 | JS exception trampolines (`invoke_*` / js-to-wasm / wasm-to-js, from `-fexceptions`) | 5.7 | 1.8 | 5.3 | 1.75 |
| 6 | SPU2 render (`CSpuBase::Render`, sample unpack) | 4.3 | 1.4 | 4.3 | 1.4 |
| 7 | VU1 ring push (memcpy of every VIF1/PATH3 qword into the MTVU ring) | 2.8 | 0.9 | 2.4 | 0.8 |
| 8 | EE memory slow paths (`MemoryUtils_*Proxy`, memory map handlers, IO ports, LWL/SWL...) | 2.2 | 0.7 | 2.0 | 0.7 |
| 9 | VU0 JIT + VU0 dispatcher (COP2 macro + micro) | 2.6 | 0.85 | 2.6 | 0.85 |
| 10 | JIT compile / cache-hit instantiation (warm cache) | 0.9 | 0.3 | 4.9 | 1.6 |
| 11 | IOP HLE/BIOS/devices (SIF, CDVD, pads...) | 0.8 | 0.3 | 2.7 | 0.9 |
| 12 | IOP dispatcher | 0.3 | 0.1 | 1.4 | 0.5 |
| 13 | DMAC (EE) | 1.2 | 0.4 | 1.0 | 0.3 |
| 14 | std::function / CSignal / malloc | 1.0 | 0.3 | 1.1 | 0.4 |
| 15 | clock reads (`emscripten_get_now`, steady_clock) | 0.8 | 0.3 | 0.6 | 0.2 |
| 16 | GIF (VM side) | 0.3 | 0.1 | 0.2 | 0.1 |
| 17 | IPU / EE OS HLE / CDVD | <0.2 | <0.1 | <0.2 | <0.1 |
| - | waits for VU1 (WaitVu1, vblank pacing) | (0.5 clean) | | (1.9 clean) | |

IOP side together (JIT + HLE + dispatcher + SPU2 + most of the trampolines, which are the per-IOP-block
`invoke_vi` calls from the inlined VM loop) is ~5-6 ms/vbl, ~17% of the VM thread.

### VU1 thread (play 29.8 / car 31.7 ms/vbl CPU)
| category | play % | play ms | car % | car ms |
|---|---|---|---|---|
| VU1 JIT code | 54.8 | 16.4 | 53.4 | 16.9 |
| VU1 dispatcher (`CGenericMipsExecutor::Execute`, `ExecuteMicroProgram`) | 9.5 | 2.8 | 9.6 | 3.0 |
| VU block invalidation/re-creation after every MPG (`ClearActiveBlocksInRange`, `BlockFactory`, `PartitionFunction`, `SetupBlockLinks`, malloc) | 8.1 | 2.4 | 9.6 | 3.1 |
| VIF1 UNPACK (real) | 6.7 | 2.0 | 7.2 | 2.3 |
| GIF packets / GS write buffer / mailbox sends | 5.9 | 1.8 | 6.0 | 1.9 |
| VIF1 decode/other | 5.1 | 1.5 | 5.0 | 1.6 |
| JS exception trampolines | 3.5 | 1.0 | 3.5 | 1.1 |
| malloc / std::function / memcpy / futex wake | 3.8 | 1.1 | 3.3 | 1.05 |
| ring messages, PATH3 queue, other | 2.4 | 0.7 | 2.4 | 0.75 |
Waits (profiled run): GS mailbox (waitForCompletion calls) 2.1 / 1.3, idle (ring empty) 1.6 / 4.9 ms/vbl.

### GS thread (play 24.2 / car 24.8 ms/vbl CPU; not critical)
GS register writes / primitives 28-32%, host->local transfers (`TransferWriteHandlerGeneric<PSMCT16/32>`,
`ProcessHostToLocalTransfer`, TexUpdater) 19-27%, WebGL calls (JS glue: bufferData, texSubImage2D, texParameteri,
bindTexture...) 22-24%, CLUT sync 7-9%, texture cache search/invalidate 4-5%, rest 11%.

### Others
Main thread 0.3 ms/vbl of JS (transferFromImageBitmap, onmessage). Audio worklet 1.3-2.3 ms/vbl, almost all in
the WSOLA `search` (time-stretching, active because emulation runs below real time). Neither matters.

## 3. Candidates: ceiling and ranking

Model: wall/vbl ~= max(VM, VU1 + ~1 ms coupling), GS/GPU far below. Numbers below are for the quiet box (26.3 ms/vbl,
38 vbl/s; VM 25.8, VU1 24.3, GS 18.7); the loaded box scales by ~1.25.

**Measured quick win: wasm-native exceptions.** The build uses `-fexceptions` (Emscripten JS exceptions), so
every call made from a frame with cleanups goes wasm -> JS `invoke_*` -> wasm; the VM loop (with the IOP executor
inlined) calls every IOP block and every EE slice that way. Throwaway build with `-fwasm-exceptions` on all targets
(scratchpad `weh/build`, `public/emu-gtaweh`, no source change, no `invoke_` left in Play.js): play.zip state hash
(`hash=300`) identical to base (c936a1d9d596). A/B, 3 rounds alternated, 30 s from vblank 600, warm cache:
| | wall ms/vbl | vbl/s | VM CPU | VU1 CPU | GS CPU |
|---|---|---|---|---|---|
| base (emu-gtaprof) | 27.54, 26.82, 26.23 (26.86) | 36.2, 38.4, 38.0 | 26.16 | 24.48 | 18.92 |
| `-fwasm-exceptions` | 25.45, 25.76, 25.85 (25.69) | 39.3, 38.8, 38.6 | 25.29 | 23.47 | 17.78 |
-4.4% ms/vbl (+4.5% vbl/s), all three threads ~1 ms/vbl cheaper (the profile's 1.8 ms on the VM thread overstated it).
Wasm EH needs Chrome 95+/Firefox 100+/Safari 15.2+. To adopt: `-fwasm-exceptions` instead of `-fexceptions` in
`deps/Dependencies/cmake-modules/Header.cmake`, `deps/CodeGen/CMakeLists.txt` and the link flags, full rebuild,
hashes on car/gow-fight/mtvu-ffx, Firefox/Safari check.

| rank | candidate | VM saving | VU1 saving | gain alone | effort | notes |
|---|---|---|---|---|---|---|
| 1 | **`-fwasm-exceptions`** (measured above) | 0.9 | 1.0 | **+4.5% (measured)** | very low (flags + rebuild) | also GS -1.1 ms; keeps the VU1 slack |
| 2 | **VU1 microprogram block cache**: keep VU blocks per micro-memory contents across MPG uploads instead of `ClearActiveBlocksInRange` + `BlockFactory`/`PartitionFunction` after every MPG | 0 | 2.0-2.5 (8-10%) | ~0 alone; raises the VM-only ceiling from ~+10% to ~+20% | low-medium | prerequisite for every VM gain beyond ~10% |
| 3 | **front VIF1 UNPACK skip in closed form for cl < wl** (and other skip modes; GTA uses the per-vector loop, `Cmd_UNPACK` self 4.6% of VM) + lighter front decode | 1.0-1.5 | 0 | +4-5% (fits in the VU1 slack) | low | pure arithmetic on cl/wl/num |
| 4 | **VIF1 unpack with wasm SIMD** (back end, VU1 thread: 6.7-7.2%) | 0 | ~1.0 | ~0 alone; ceiling | low-medium | V4-32/V4-16/V3 paths dominate (`Unpack<13>`, `<5>`, `<12>`, `<14>`) |
| 5 | **EE JIT code quality (tier-2 M3: GPRs in locals, constant PC, inlining, linking without per-part epilog)**: EE JIT + dispatcher = 59% of VM (~15 ms quiet) | 4-5 (if 1.4-1.5x) | 0 | **capped at ~+10% alone** (VU1 slack); ~+20-25% with 2+4+6 | high (weeks) | M2b showed dispatch removal alone ~3%; gains must come from faster code |
| 6 | **VU1 JIT quality**: drop dead MAC/status/clip flag pipeline writes (flag liveness), superblocks/linking via tail calls (dispatcher 9.5%) | 0 | 3-4 (if JIT -20-25%) | ~0 alone; needed for 50 | medium-high | VU1 JIT is 55% of the VU1 thread |
| 7 | VU1 ring push without copying every qword (VM 0.7-0.9 ms) + async VU1->GS waits (`vu1gswait` 0.6-1.1 ms on VU1) | 0.7 | 0.7 | +2-3% | medium | |
| 8 | **IOP + SPU2 on another thread** (IOP JIT 2.5, SPU2 1.4, IOP HLE/dispatcher 0.4-1.4 ms loaded; ~15% of VM after #1) | 3.5-4.5 | 0 | capped at ~+10% alone | very high, risky (SIF/DMA/interrupt timing, determinism) | SPU2 render alone on a thread: -1.1 ms, medium |
| 9 | EE memory fast paths (slow-path self time 2.0-2.2% of VM) | <=0.6 | 0 | <=+2% | medium | page-table inline access already in JIT code |
| 10 | VM<->VU1 sync reduction (VM waits 0.2-0.5 ms/vbl play, 1.9 car) | <=0.5 | 0 | ~+1-2% | medium | not a bottleneck; the 2-flip pacing is fine |
| 11 | GS thread: host->local transfers (19-27%) and CLUT sync (7-9%) | 0 | 0 | 0 now; GS caps at ~53 vbl/s quiet / ~41 loaded | medium | next limit once VM and VU1 are both < 19 ms |

**Path to 50 vbl/s (20 ms/vbl, quiet box)** after #1: VM 25.3 -> <=19 needs #3 (-1.2) + #5 at ~1.4x (-4.3) + #7/#9
(-0.8); VU1 23.5 -> <=18 needs #2 (-2.2) + #4 (-1) + #6 (-2.5); GS 17.8 -> ~17 needs a bit of #11. On the loaded box
(everything x1.25) 50 is out of reach without ~1.6x on all three threads.

**Recommended order:** #1 (now, +4.5%), #3 (+4-5%, cheap), #2 and #4 (cheap, unlock VM gains), then the big pair
#5 + #6 together; #8 only if #5 stalls. Doing #5 without #2/#6 buys at most ~10%.

## Files
- Variants (throwaway, not published): `public/emu-gtaprof` (release 2ed06e87 + function names), `public/emu-gtaspin`
  (+ `setSpin(vmUs, vu1Us)`), `public/emu-gtaweh` (`-fwasm-exceptions`). The spin patch was reverted in play-src.
- Raw runs: scratchpad `gp/*.json` (clean-*, prof-*, spin-*, r3spin-*, eh-*).
