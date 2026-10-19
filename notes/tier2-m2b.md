# Tier-2 JIT, milestone M2b (EE regions)

Status (2026-10-19): EE regions are **correct but slower** than tier 1. Committed on Play `tier2` (4e8983f2 +
fadcfea1, not pushed), off by default, **not published**. Design: notes/tier2-jit-design.md; previous milestone:
notes/tier2-m2a.md.

## What is implemented (Play `tier2`)
- 4e8983f2: `CEeExecutor::PlanRegion`: tier-1 blocks statically reachable from an entry inside its 4 KB page (no
  calls/JR, no blocks with per-block game settings), at most N (`setEeRegionParts(N)`, bench `&t2=N`), reducible
  graphs only, plans cached per entry and reused while the part words are unchanged. `CEeBasicBlock::CompileRange`
  compiles the parts into one function through the CodeGen structurer; after each part the region jumps to the
  next part when `nPC - base` matches it, else exits (block chaining). Invalidation while a region runs makes its
  base odd, so it returns after the current part, and keeps it alive until `Execute` returns.
- fadcfea1: only hot entries get regions. The dispatch loop samples one dispatch in 64 (deterministic); an
  address sampled 16 times becomes hot, its tier-1 block is dropped and the next dispatch there builds the region.
  Region cache keys hash only the part words. `eeRegionStats()` = "regions created, total parts". BasicBlock.h back
  to CRLF (4e8983f2 had converted it to LF).

## Correctness: state hashes (`&hash=300&vu1thread=0&nolimit=1&blockcache=0`, sha1 of the 300 hashes, first 12)
Build `public/emu-t2` (tier2 fadcfea1 = web-perf 203fa0fb + regions), baseline `public/emu` as it was before
web-perf 5355c7df (GoW wait-loop patches, which change GoW hashes).
| state | public/emu | emu-t2 off | emu-t2 `&t2=16` | regions created / parts |
|---|---|---|---|---|
| play.zip | c936a1d9d596 | c936a1d9d596 | c936a1d9d596 (x2) | 2426 / 23056 |
| car.zip | 58750a0d17a4 | 58750a0d17a4 | 58750a0d17a4 | 2764 / 25909 |
| gow-fight.zip | e98b6c8a5465 | e98b6c8a5465 (x3) | e98b6c8a5465 in 4 of 5 runs | ~1740 / ~16100 |
| mtvu-ffx.zip | f7d7efe335e6 | f7d7efe335e6 | f7d7efe335e6 | 697 / 5741 |
The one gow-fight outlier (regions on) first differs at vblank 50 in IOP RAM only (EE state and RAM follow at
vblank 52), which matches the known rare pre-existing nondeterminism (ee-jit.md, frame-dips.md); the 4 repeats
matched. Region counts vary a little between runs because the counter also covers the boot before the state load.

GTA SA cold boot from disc, `&t2=16`, no state: reaches the in-engine intro cutscene (police at Grove Street) at
200 s, 38-50 vbl/s throughout, no hang or error. **But 103553 regions were created in those 200 s** (~500/s).

## Speed: wall ms/vbl, vblanks 100-600 after the state load (`&time=100,600&vu1thread=0&nolimit=1`, warm block
cache, one untimed warm-up per variant, then off/on/off/on; shared machine, other agents benching between runs)
| state | off (t2=0) | on (t2=16) | on vs off (means) |
|---|---|---|---|
| play.zip | 40.0, 40.5 | 50.5, 42.4 | +15% |
| car.zip | 45.6, 46.9 | 53.1, 62.5 | +25% |
| gow-fight.zip | 58.4, 59.1 | 80.9, 72.2 | +30% |
| mtvu-ffx.zip | 29.0, 38.8 | 37.9, 33.4 | +5% (noisy) |
car.zip steady state (vblanks 1100-1600): off 34.0, on 35.4 (+4%). Regions created keep rising (3.8k by vblank
600, 5.6k by 1600) and nearly all are block-cache hits (car: 31.6k hits of 31.8k compiles with regions vs 28.3k of
28.3k without), so each one still costs a wasm module compile/instantiation and a Liftoff -> TurboFan tier-up.

## Why it is slower (inferred, not yet measured by profile)
1. Region churn. A region's block range is [entry, last part end], which includes the words between its parts
   (often data); invalidation drops any block whose range overlaps a write, so writes to data in the page drop the
   region, and since the entry stays hot the next dispatch rebuilds it. Cold boot: ~500 regions/s; states: ~5-7/vblank.
2. Every (re)creation costs a module instantiate + Liftoff code for a big function, while tier-1 blocks covering
   the same code are also kept. The 100-600 window is mostly this cost; the steady state is near parity.
3. Even in steady state there is no gain: the dispatch share regions remove is small next to the per-region costs.

## Next steps (if M2b continues)
1. Count region drops by cause (data write in a gap vs code write) and give regions a write range made of their
   parts only (lookup by part ranges), or retire an entry from the hot set after K rebuilds.
2. CPU profile (prof.mjs style, M2a) of steady state, JIT self time per region vs its blocks.
3. Only then re-time; the M2b gate (play.zip -10% ms/vbl) is far away (currently +15%).

Tools (scratchpad t2/): `run.mjs '<bench query>' <secs> '<done expr>'` (own tab on [::1]:9222, 45 s no-vblank abort,
MemAvailable guard, `SHOT=file.png`), `hash.sh <emu|variant> <state> [extra]`, `time.sh` (env `T=from,to`, `N=vblanks`).
Variant `public/emu-t2` = tier2 fadcfea1 (regions off by default, `&t2=16` on).
