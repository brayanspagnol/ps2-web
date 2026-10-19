# Tier-2 JIT, milestone M2b (EE regions)

Status (2026-10-19, session 2): **gate not met, and regions as designed cannot meet it.** Region churn was not
the cause (there is none); regions cut EE dispatches by ~60% but the dispatcher is only ~13% of the VM thread, so
the ceiling is a few percent, and region creation eats it. Play `tier2` 63195ab1 (pushed), off by default, **not
published, not merged**. See "Session 2" at the end. Session 1 text below is kept as written.
Committed on Play `tier2` (4e8983f2 + fadcfea1), off by default. Design: notes/tier2-jit-design.md; previous milestone:
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

## Session 2 (2026-10-19): churn measured, hot set fixed, profiles, final timing
Play `tier2` 63195ab1 (on top of fadcfea1, web-perf not rebased: not needed). Variants: `public/emu-t2c` (release
63195ab1 minus a comment move), `public/emu-t2cn` (same, `--profiling-funcs`). Bench params added to bench.html:
`&t2hot=N` (hot threshold in samples, default now 64), `&t2promo=1` (regions with context promotion).
`eeRegionStats()` = created, parts, distinct entries, rebuilt entries, entries rebuilt >8x, max builds per entry,
compiled, reused from m_cachedBlocks, protected-page clears, EE dispatches, region Jitter runs (cache misses).

### 1. Churn: refuted
- car.zip, 300 vblanks, hot=16: 2778 regions for 2777 distinct entries (1 rebuilt), 2 page clears. Invalidation is
  per 4 KB page anyway (`InvalidateWrittenRange` clears every block of a written protected page), so "data words
  between parts" never mattered: tier-1 blocks of the page go too. GTA free roam writes to code pages ~never.
- The region count grows because new code keeps getting hot (threshold 16 samples x 64 = ~1k executions).
- Real problem found instead: **the hot set was not stable between runs**, so ~20% of each run's regions were new
  and missed the persistent block cache (Jitter + module compile in the timed window, ~3 ms per region). Causes:
  fixed sampling period 64 (loops whose length divides it send every sample to one block, which one depends on
  phase) and sample counts carried over from the boot before the state load. Fixed with a xorshift period
  (32..95) and a restart of hot detection on a whole-RAM clear (state load). After: run N+1 rebuilds exactly run N's
  regions (cache misses 336 -> ~0-24 per run).
- Sample counts moved from an unordered_map (~1 ms/vbl in a profile) to a flat uint16 table.
- Hot threshold 16 -> 64 (play, 600 vblanks: 3.4k -> 1.7k regions; dispatches 157M off -> 56M at 16, 67M at 64).
- Latent bug fixed: a reused plan was checked against its part words only, but FindBlockEnd also reads the word
  after a part (branch in a delay slot ends the block early); the plan hash now covers it. Also a region copied
  from the same code at another address now keeps its parts (invalidation must see it as a region).

### 2. Profiles (CDP CPU profile of the VM worker, play.zip, bench vblanks ~450-715, warm cache, ms/vbl)
Comparable runs (VU JIT time equal in both, 11.7 ms/vbl, so the machine state matched):
| | off | regions (hot 64) |
|---|---|---|
| EE JIT code | 11.16 | 10.96 (6.22 regions + 4.74 blocks) |
| CEeExecutor::Execute self (dispatch) | 5.87 | 4.39 |
| compile/translate (block creation) | 2.20 | 2.69 (+ JS Module 0.50 -> 0.78) |
| total VM thread | 43.35 | 43.66 |
- Regions remove ~57-61% of EE dispatches, but Execute self time only drops ~25% (1.5 ms/vbl): per dispatch it is
  ~22 ns, not 60 ns, and region parts keep the full tier-1 epilog plus an nPC compare per transition.
- EE JIT code time is unchanged: regions run the same code as the blocks, just without the dispatcher.
- Region context promotion (`&t2promo=1`, hash-identical): region JIT time 6.24 vs 6.22, no gain.
- Ceiling: the whole dispatcher is ~13.5% of the VM thread; absorbing all of it with code no slower than tier 1
  would barely pass a 10% gate. With ~60% absorbed the steady-state best case is ~3-4%, before creation costs.

### 3. Final timing (wall ms/vbl, `&time=100,600&vu1thread=0&nolimit=1`, warm block cache, one warm-up run per
state, then off/on/off/on; renderer pinned to P-cores 0-7 via taskset; machine quieter than session 1)
| state | off | on (`&t2=16`, hot 64) | on vs off |
|---|---|---|---|
| play.zip | 34.72, 34.71 | 36.05, 35.74 | +3.4% |
| car.zip | 43.36, 43.40 | 45.08, 45.32 | +4.2% |
| gow-fight.zip | 50.83, 49.78 | 52.46, 52.34 | +4.2% |
| mtvu-ffx.zip | 29.65, 29.65 | 29.15, 29.12 | -1.7% |
play.zip steady state (vblanks 1100-1600 after load): off 32.53, 33.41; on 32.19 (warm) -> about -2%.
Dispatches over the run: 403M off vs 159M on.
The 100-600 window still pays for ~1.7k region creations (module compile + instantiate + Liftoff/TurboFan, even
with every region a cache hit), which costs more than the ~1.5 ms/vbl the dispatcher saves.

### 4. Hashes (`&hash=300&vu1thread=0&nolimit=1&blockcache=0`, emu-t2c, regions on)
play c936a1d9d596, car 58750a0d17a4 (x2), gow-fight e98b6c8a5465, mtvu-ffx f7d7efe335e6: all equal to regions off.
**Open issue:** during one ~30 min window an earlier build (same logic plus counters) gave car e76ed0dfcfb2 twice in
a row (first difference at vblank 2, EE RAM + IOP RAM, EE registers equal) and 3 of ~10 short hash=6 runs mismatched;
regions-off runs never did (8/8). It did not reproduce in the next 27 region runs (debug and final builds), and an
index bisection could not catch it. Suspects (unverified): something carried across the state load (pre-load
plans/cached regions, now partly fixed by the plan-hash fix), or a Liftoff/TurboFan difference in a region that
shows up depending on tier-up timing under load.

### Decision
The M2b gate (play.zip -10%) is not reachable with this region design: regions only remove dispatches, the
dispatcher is ~13% of the VM thread, and creation costs eat the ~3% steady-state saving. Getting more needs regions
whose code is faster than the blocks (GPRs in locals that actually pay off, constant PC, no per-part epilog/nPC
round trip, call inlining so regions don't stop at every JAL/JR), i.e. M3-type work with a much larger scope, and
the VU1 thread caps EE-only gains in GTA anyway. Recommendation: stop M2b here, keep regions off (code stays on
`tier2` for reference), don't merge.

Tools (scratchpad t2/): `prof.mjs '<query>' <startVbl> <secs> <out>` (CPU profile of the VM worker over a window,
flushes the block cache before closing), `agg.mjs` (ms/vbl per category: JIT EE region/block via `&vujit=1,0,1`
names, Execute, compile), `tree.mjs`/`aggc.mjs` (inclusive trees), `linknames.sh <dir>` (relink with
`--profiling-funcs`), `run.mjs` now flushes the block cache before closing its tab and `PIN=0-7` pins the busiest
renderer to the P-cores.
