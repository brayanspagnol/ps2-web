# VU1 thread (MTVU) on GTA SA: profile and cuts (2026-10-26)

Goal: with MTVU on, GTA SA's VM thread waited 7-10% of its time for the VU1 thread (notes/hotpath.md), so VU1 was
the next limit. Profile the VU1 thread (VU JIT code, back VIF1 decoder, ring, XGKICK/GIF, block lookup/compile) and
cut the biggest costs without changing emulation results.

Branch `vu1b` (worktree `play-vu1b`, from web-perf e757dae9), pushed to `fork`. CodeGen: branch `vu1b` at 5981aab
(on 8231ffa), pushed to the CodeGen fork. Build dir `play-vu1b/build_cmake/build/b`; profile link
`build_cmake/build/linkprof.cmd` (-O1 --profiling-funcs) -> `build/prof`.

## Method
- V8 CPU profiles (250 us) of every worker over CDP, 20 s from vblank 300, MTVU on, no limiter,
  `&blockcache=0&vujit=1,0,1` (each build compiles its own blocks, JIT functions named `vu1p_<begin>_<end>`).
  Scratchpad `vu1b/`: `prof.sh`/`prof.mjs` (run + profiles), `cat.mjs` (VU1-thread categories, leaf-first rules),
  `profms.py` (category ms/vbl = share x 20 s / vblanks), `callers.mjs`.
- Timing: `time.sh` / `round.sh` (ABAB, `&time=100,600&nolimit=1`, warm cache, per-thread CPU from /proc).
- Block cache: it is shared by all variants of a game and keyed by `CODEGEN_VERSION`, so a codegen change must bump
  it, or a variant silently runs the other build's cached code. The first runs of the previous attempt (variants
  vu1bsz/vu1bup) had this problem; the GTA cache was cleared (`blockcache=clear`) and re-warmed for base and new.

## VU1 thread profile (play.zip / car.zip, % of VU1 busy samples; ms/vbl = profiled, ~1.3x slower than unprofiled)

| category | play base | play new | car base | car new |
|---|---|---|---|---|
| VU JIT code (blocks, chained) | 71.7% (19.3 ms) | 76.5% (17.0 ms*) | 71.0% (24.3 ms) | 75.9% (21.6 ms*) |
| VIF1 unpack (back decoder) | 10.3% (2.8) | 3.5% (0.8) | 10.5% (3.6) | 3.7% (1.0) |
| XGKICK / GIF PACKED + GS write buffer | 8.1% (2.2) | 8.4% (1.95) | 7.8% (2.7) | 8.6% (2.5) |
| VIF1 back decode (ProcessPacket, commands, MPG) | 4.8% (1.3) | 5.6% (1.3) | 5.3% (1.8) | 6.1% (1.7) |
| ring / messages (ThreadProc, ProcessMessage, GS mailbox) | 3.4% (0.9) | 3.9% (0.9) | 3.2% (1.1) | 3.4% (1.0) |
| VU dispatcher (CVuExecutor::Execute, block sets) | 1.2% (0.3) | 1.5% (0.3) | 1.3% (0.4) | 1.4% (0.4) |
| JIT compile / block lookup | 0.5% | 0.7% | 0.9% | 1.0% |
| idle (waiting for VIF1 data / GS) | 13.7% of samples | 24.2% | 13.9% | 23.8% |

\* from the quietest profile of each (x-play2, x-car2); the box was loaded (3-8) by other agents.
Top self outside JIT code (new): `CGIF::ProcessPacked` ~3%, `CVif::ProcessPacket` 1.7%, `CGSHandler::ProcessWriteBuffer`
1.3%, `CMailBox::SendCall` 1.2-1.4% (GS submits + the in-flight frame wait in `Finish`), `CVu1Thread::ThreadProc` 1.2%.
The hottest single blocks are 3-5% each (`vu1p_000002B0_0000032C` ~4.5%); block lookup/compile is negligible with
block sets + chaining.

## Changes (Play `vu1b`)
1. **VU JIT MakeSz / ExpandW (CodeGen 5981aab, Play e1d85671)**: MakeSz (sign/zero bits of every FMAC result) reverses
   the lanes once and takes both masks with `i32x4.bitmask` (pshufd + movmskps) instead of a two-operand byte shuffle +
   `i16x8.bitmask` (two pshufb with materialized masks); ExpandW (broadcast operand) is one `i8x16.shuffle` (pshufd)
   instead of extract_lane + splat through a GPR. Bit-identical results. Block cache `CODEGEN_VERSION` 3.
2. **VIF unpack, cl > wl without mask (68da6b9c)**: at a cycle group start, whole groups (wl vectors from the source,
   cl - wl slots stepped over) per loop step; mid-group, the rest of the skipped slots in one step. If the last vector
   ends the command, the ticks and address are left where the tick loop stops. GTA's VIF1 stream is mostly wl = 1
   groups, which went one vector + (cl - wl) empty ticks per iteration. Self-check (`vu1b/unpackcheck.py`, model of
   the old and new control flow): cl 1..9, wl 1..cl, num 1..39, 0..44 vectors available, every start tick, two base
   addresses: 1.0M cases, identical writes, bytes consumed, num left, ticks and address.
3. **GIF PACKED (63c749a2)**: loop state (loops, regsTemp, qtemp) in locals, GS register writes straight into the
   write buffer tail (same drop-when-full rule as `WriteRegister`), committed once; state written back on every exit
   (incl. the SIGNAL pending return).

## Results
Hashes (`hash=300&vu1thread=0&nolimit=1`): car 55dab76e, play 1f851c1c, mtvu-ffx 5927b89c, gow-fight 77f177fc,
gow-intro b2119704 (= base). MTVU on: play 1f851c1c, car 55dab76e. VU state hashes (`vuHashResult`, VU1 on the VM
thread): play 64b389ca, car 5a75a9c7, same as base.

Timing, release builds `public/emu-vu1bbase` (e757dae9) vs `public/emu-vu1bx` (63c749a2), MTVU on, warm cache, ABAB,
medians (load 3-8, so single runs vary a lot; the paired ratio is the steadier number):

| state | pairs | VU1 CPU ms/vbl base -> new | paired | wall ms/vbl base -> new | vbl/s base -> new | VM waits for VU1 (vu1sync ms/vbl) |
|---|---|---|---|---|---|---|
| play.zip | 10 | 21.4 -> 18.7 | -16% | 23.5 -> 23.2 (-3% paired) | 42.5 -> 43.1 | 0.07 -> 0.00 |
| car.zip | 10 | 31.7 -> 28.2 | -16% | 35.2 -> 32.6 (-12% paired) | 28.4 -> 30.7 | 3.5 -> 1.2 |
| gow-fight.zip | 5 | 10.9 -> 11.4 | +1% | 14.3 -> 12.9 (-12% paired) | 70.1 -> 77.5 | 4.0 -> 1.7 |

play is VM-bound again (VU1 now idles 24% of the time), so its wall moves little; car and gow-fight, where the VM
thread waited for VU1, gain ~8-10% wall.

## Left (not done)
- VU JIT code is ~76% of VU1 busy. Seen in the x64 code of the hottest block: ~40 context loads/stores at block entry
  and exit (promoted state, every chained block), the VU memory base (`CMIPS::m_vuMem`) reloaded at every LQ/SQ,
  per-FMAC operand clamps (min_s + min_u) and the MakeSz/sticky OR that status needs. Promoting `m_vuMem` per block
  is a small CodeGen change (~1-2% of JIT time, not measurable on this box).
- `CGSHandler::ProcessWriteBuffer` scans every register write for SIGNAL/FINISH/LABEL (~1.3%); only A+D and REGLIST
  can produce them.
- GIF PACKED is still ~3% (per-qword switch); back decoder ~5%; each < 1.3 ms/vbl.
