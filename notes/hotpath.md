# VM thread outside guest JIT code: where it goes, what was cut (2026-10-26)

Goal: GTA SA's VM (EE) thread is the limit at ~23-28 ms/vbl, it needs < 19 for 50 vbl/s. Find what the VM thread
spends outside the guest JIT code (memory slow paths, DMA/VIF/GIF, IOP, dispatch, timers, SIF) and cut the
biggest costs without changing emulation results. Dispatch (tier-2 regions) and idle loops are other agents' work.

Play `hotpath` (from web-perf 63fffd4b, CodeGen 8231ffa), worktree `play-hot`, build dir `build_cmake/build/hot`.

## Method
- V8 CPU profiles (250 us) of every worker over CDP (`Target.setAutoAttach` + `Profiler`), 20 s from vblank 300
  after the state load, MTVU on, no limiter, warm block cache. Scratchpad `hot/`: `prof.mjs` (run + profiles),
  `cat.mjs` (VM-thread categories), `tree.mjs` (merged callee tree under a frame), `callers.mjs`.
- Names: the release link relinked with `--profiling-funcs`, and JIT functions named (`&vujit=1,0,1`, the block
  cache must be refilled with names once). With the normal `-O3` link, binaryen inlines the whole VM loop into the
  thread entry (`__thread_proxy` self = 25%); the profile builds are linked with `-O1` instead (same objects,
  ~same speed) so `CEeExecutor::Execute`, `UpdateSpu`, VIF/DMAC frames stay separate. V8 still inlines some wasm
  calls (IOP executor, CountTicks...), which land in `CPS2VM::EmuThread` self.
- Categories: a sample whose leaf is JIT code is "JIT"; otherwise the frames below the deepest JIT frame (or below
  the VM loop) are matched leaf-first against subsystem patterns.
- Counters (temporary build, not committed): per-frame VIF1 DMA/command/UNPACK counts.
- Profiled runs are ~1.4x slower than unprofiled ones: ms/vbl below are profiled ms scaled by
  (unprofiled VM CPU / profiled VM busy). Shares are averaged over 3 profiles per state (base) and 2 (new).

## VM thread breakdown (base = web-perf 63fffd4b)

Unprofiled VM-thread CPU: play ~27.7 ms/vbl, car ~29-30 ms/vbl (quiet box, MTVU on, no limiter).

| category | play % | play ms/vbl | car % | car ms/vbl | notes |
|---|---|---|---|---|---|
| EE JIT code (incl. inline page-table accesses) | 41.6 | 11.5 | 38.5 | 11.4 | |
| EE dispatch (`CEeExecutor::Execute` self) | 22.3 | 6.2 | 21.5 | 6.4 | tier-2 agent's area |
| VM loop + V8-inlined calls (`EmuThread` self: slices, EE/IOP CountTicks, IOP executor, part of EE dispatch) | 4.2 | 1.2 | 3.9 | 1.2 | |
| **front VIF1 (MTVU decoder: commands + UNPACK skip)** | **9.4** | **2.6** | **9.5** | **2.8** | `SkipUnpack` self alone 4.9% |
| SPU2 render (`UpdateSpu`) | 4.7 | 1.3 | 4.6 | 1.4 | SPU thread tried (vm-trim), ~2% |
| VU1 ring push (memcpy of VIF1/PATH3 data, 8.8k messages, 2.1 MB per frame) | 2.5 | 0.7 | 2.4 | 0.7 | |
| EE memory slow paths (`MemoryUtils_*Proxy` excluding DMA kicks: LD/LDR/LDL, GetWord) | 2.1 | 0.6 | 2.2 | 0.7 | unaligned fast paths tried |
| DMAC (source chain, tag fetch, std::function to the device) | 1.2 | 0.3 | 1.2 | 0.4 | |
| disc reads (sync XHR of 1 MB blocks in `Js_ReadDiscUrl`) | 0.5 | 0.1 | 1.3 | 0.4 | car: 0.84 ms/vbl wall in the timeline |
| EE timers + INTC (`CTimer::Count`, IOP root counters) | 0.7 | 0.2 | 0.7 | 0.2 | |
| VU0 (micro JIT + executor + VU state callbacks) | 1.5 | 0.4 | 1.7 | 0.5 | CSignal tried |
| IOP JIT code | 0.8 | 0.2 | 0.6 | 0.2 | IOP is cheap in GTA |
| IOP HLE (BIOS, CDVD, SIF) | 0.5 | 0.1 | 0.5 | 0.15 | SIF itself < 0.1% |
| GIF + GS register writes on the VM thread | 0.5 | 0.1 | 0.4 | 0.1 | |
| JIT compile / async batch install (warm cache) | 0.2 | 0.05 | 0.6 | 0.2 | |
| waits for the VU1 thread (vblank pacing, `WaitVu1`) + timed-wait clock reads | 6.9 | (1.9) | 10.2 | (3.0) | not CPU: VU1 is behind |

Where the slow-path memory handler time goes: `MemoryUtils_SetWordProxy` is 14% of the VM thread, and nearly all
of it is one thing, the D1_CHCR write that starts a VIF1 DMA chain, which runs the whole front VIF1 decode and the
ring push inline (`SetWord -> IOPortWriteHandler -> CDMAC::SetRegister -> WriteCHCR -> ExecuteSourceChain ->
CVif::ReceiveDMA -> ProcessPacket`). Other hardware register reads/writes (GS, INTC, timers, GIF, SIF) are < 1%
together; the timer/event code per 4800-cycle slice is < 1%.

Per frame (play.zip, counters): 7.8k VIF1 `ReceiveDMA` calls (half of them DMA tags with TTE), 65k qwords, 37k VIF
commands (27k NOP, 3k STCYCL, 3k UNPACK V4-x, ~2k others), 4.7k UNPACKs with 162k vectors, of which 3.2k UNPACKs
(160k vectors) used the cl >= wl skip loop one cycle group per iteration (GTA's groups are one vector).

## Changes (Play `hotpath` e757dae9)
1. **Front VIF1 `SkipUnpack`, cl >= wl**: at a cycle-group boundary, all but the last whole group with data are
   consumed in one step (each leaves the ticks at 0 and a vector still to read); the existing loop does the rest, so
   the end state is the loop's. 160k -> 3.2k iterations per frame. Self-check (scratchpad `hot/skiptest.cpp`) against
   the old loop: cl/wl 1..16 (cl >= wl), every read/write tick state, num 1..256, 34 data sizes incl. partial
   vectors: 217M cases, identical ticks, num and bytes consumed.
2. **VIF NOP fast path** in `ProcessPacket`: a NOP without the I bit only sets NUM (what `ExecuteCommand` did after
   two virtual/switch dispatches). Front and back decoders.

Front VIF1 share of the VM thread: play 9.4% -> 4.0%, car 9.5% -> 3.4% (averaged profiles); everything else in the
table unchanged within noise, and the VM thread's wait for the VU1 thread grows by the same amount (play 6.0 ->
9.4%, car 9.0 -> 18.2% of samples).

State hashes (`hash=300&vu1thread=0&nolimit=1`): car 55dab76e, play 1f851c1c, mtvu-ffx 5927b89c, gow-fight 77f177fc,
gow-intro b2119704 (= base). With MTVU on (front decoder path, `hash=300&nolimit=1`): play 1f851c1c, car 55dab76e,
same as base.

## Timing
Release builds `public/emu-hotbase` (63fffd4b) and `public/emu-hot1` (e757dae9), MTVU on, no limiter, vblanks
100-600, warm cache, ABAB alternated; VM = CPU ms/vbl of the VM worker thread (`/proc` schedstat), wall = ms/vbl.
The box was shared with other agents (load 3-17): single runs vary 25-95 ms/vbl, medians below.

| state | pairs | VM CPU base -> new | wall ms/vbl base -> new | vbl/s base -> new |
|---|---|---|---|---|
| play.zip | 8 | 27.6 -> 26.9 (-2.5%) | 28.0 -> 27.4 | 35.7 -> 36.5 |
| car.zip | 4 (quiet part; 5 more taken at load 10-17 not used) | 31.3 -> 30.4 (-2.7%) | 33.0 -> 32.5 | 30.3 -> 30.8 |
| gow-fight.zip | 5 | 17.2 -> 16.5 (-4.2%) | 17.8 -> 16.9 | 56.2 -> 59.1 |

Steadier estimate from the profiles (VM busy samples excluding waits, relative to EE JIT code samples, which are the
same code in both builds): play 2.24 -> 2.10 (-6.3%), car 2.33 -> 2.16 (-7.1%), i.e. ~1.7-2 ms/vbl less VM work.
Part of it turns into VM waits for the VU1 thread rather than wall time: in car.zip the VM thread now waits for VU1
in ~18% of its samples, so VU1 is the limit there as often as the VM thread.

## What is left outside JIT code and dispatch (not done)
- SPU2 render (~4.7%): per-voice per-sample loop with ADSR/volume calls; reordering to voice-outer loops changes the
  order of SPU RAM reads vs reverb writes, so not provably identical. Rendering on its own thread gave ~2% (vm-trim).
- VU1 ring push (~2.5%): one ring message per `ReceiveDMA` (tags with TTE make it two per DMA tag); merging the tag
  and its data into one message changes where the back decoder's packet boundaries fall.
- Disc reads in streaming scenes (car: 0.84 ms/vbl wall, ~20 ms per 1 MB sync XHR): read-ahead would need a helper
  worker (the VM worker never yields to its event loop).
- Everything else is < 1% each. The real lever left on the VM thread is EE JIT code + dispatch (~65%), and car is
  already VU1-bound part of the time (the VM thread waits for it 3+ ms/vbl).
