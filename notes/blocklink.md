# EE block linking (branch `blocklink`, worktree `play-link/`)

Status (2026-10-26): Play `blocklink` (on web-perf 98b876da), CodeGen `blocklink` (on 5981aab). Pushed to the fork,
not merged, not published. On by default (`Module.setEeBlockLinking`, bench `&eelink=0` to turn it off).

Goal: GTA SA VM thread ~23 ms/vbl, target < 20. "EE dispatch" (`CEeExecutor::Execute` self) was ~22% of the VM
thread in V8 profiles. Cut it without tier-2 regions (their creation cost killed M3, see tier2-m3.md).

## What the 22% is (measured first)
- Dispatch counts (temporary counter build, play.zip, 300 vblanks): ~300k EE block dispatches per vblank, ~94 per
  `Execute` call. Exit kinds: fall-through / not-taken 28%, taken direct branch or J/JAL 59%, JR/JALR 12%, other
  (syscall, ERET...) < 0.1%. So 87% of dispatches go to an address known when the block is compiled. Last-target hit
  rates (an inline cache would hit): fall-through 90%, direct 95%, JR 71%.
- The old chaining (`&eechain=1`, tail call through the function index table looked up from nPC) moves the time,
  it does not remove it: V8 profile, VM worker, `vu1thread=0`, relative to VU1 JIT time:
  dispatcher 0.52 -> 0.16-0.22, EE JIT 0.84 -> 1.22-1.24, EE total 2.01-2.14 -> 2.17-2.27. The "dispatch" cost is
  the cost of entering a block function through `call_indirect`, wherever that call is.
- Micro benchmark (scratchpad `link/micro/`, Brave 151, block bodies of ~7 guest ops, ns per block transition):

  | blocks, order | dispatcher loop | tail call via table (nPC) | tail call via table (constant address) | constant table slot | direct `return_call` |
  |---|---|---|---|---|---|
  | 256, fixed cycle | 8.4 | 8.8 | 6.3 | 6.4 | 5.0 |
  | 2048, random cycle | 50.4 | 61.6 | 59.6 | 54.9 | 9.4 |

  Every indirect form (dispatch table, signature check, code pointer table, indirect branch) costs about the same;
  only a direct call to a function of the same module is clearly cheaper, and much cheaper when targets are hard to
  predict. Typed (`ref $t`) tables did not help.

## Design
- Link site (CodeGen `OP_EXTERNJMP_LINK`, `CJitter::JumpToLinked`): at a block exit whose next address T is known
  (fall-through, or the block's only branch is the one before the delay slot and has a constant target, no COP0),
  after the cycle quota and nPC update and guarded by `nHasException == 0`:
  `if(fnTable[T >> 16][(T & 0xFFFF) / 4] == linkBase + k) return_call f` with k and f as padded LEBs.
  As compiled (k = 0x3FFFFFFF) it never matches.
- Sites are listed in a `play.link` custom section with the block's own guest address. `BuildBatchModule` (EE
  batches, async compile batches and block cache groups) patches sites whose target is another function of the same
  module into a direct `return_call`, and turns the others into nops. Branch hint offsets stay valid (same length).
- The guard is the dispatcher's own lookup: the direct call only happens when the dispatcher would have called that
  very function. Batches with link sites get consecutive, new table slots (`env.linkBase` = `wasmTable.grow(n)`),
  never handed to another function later (deleted ones are set to null, block cache group slots stay), so a stale
  index can never match. Invalidation, async swaps (the table entry is refreshed lazily, which only means no link
  until then) and replaced blocks need nothing else.
- Link sites hold guest addresses, so (1) the block cache key includes the block address for EE blocks, (2)
  `CEeExecutor::BlockFactory` no longer copies a function to a block with the same code at another address (that was
  the bug that broke the first build: wrong code ran at once). Codegen version 20.
- Block cache groups are formed by guest address (sorted) and hold 256 blocks (was 64 in file order): more link
  sites end in the same module. Hit rate of same-module targets for constant exits was ~45% with 64-block groups in
  file order.
- The dispatcher loop is unchanged: it still runs for JR/JALR, exceptions, quota ends, interpreted blocks and
  targets in other modules. A fallback `return_call_indirect` for those was not built: the micro benchmark and the
  chaining profile say it would not pay.

## Results
Dispatcher iterations (counter build, same 300-vblank runs): play 89-102M -> 52M (-49%), car 116M -> 36M (-69%),
gow-fight 80M -> 46M (-42%).

V8 profile, VM worker, `vu1thread=0`, relative to VU1 JIT time (machine-speed independent), base -> linking:

| state | dispatcher self | EE JIT | EE total (JIT + dispatcher + called from EE) | VM non-VU1 total |
|---|---|---|---|---|
| play | 0.52 -> 0.22-0.39 | 0.85 -> 0.83-0.85 | 2.13 -> 1.75-1.88 | ~ -13% |
| car | 0.48 -> 0.18-0.33 | 0.75 -> 0.70-0.73 | 2.00 -> 1.60-1.63 | ~ -18% |

Timing: vblanks 100-600, MTVU on, `nolimit=1`, warm cache, 5 alternated rounds, VM = VM worker CPU ms/vbl, medians.
Base = web-perf 75a0d770 build (`emu-linkbase3`); link3 = linking, 64-block groups in file order; link4 = + groups
by address; link5 = + 256-block groups (final). Quiet box (load 2.5-4.7).

| state | base VM | link3 | link4 | link5 | wall vbl/s base -> link5 |
|---|---|---|---|---|---|
| play | 21.15 / 21.19 | 19.98 (-5.5%) | 19.60-19.68 (-7%) | 19.14 (-9.7%) | 47.0 -> 51.2 |
| car | 25.20 / 25.36 | 23.52 (-6.7%) | 23.88-24.06 (-5%) | 24.08 (-5.0%) | 38.6 -> 38.9 |
| gow-fight | 11.21 | | | 11.06 (-1.3%) | 87.2 -> 89.4 |
| mtvu-ffx | 22.76 | | | 23.27 (+2%, 3 of 5 pairs better, noise) | 39.5 -> 38.5 |

Final check on the rebased branch (web-perf 98b876da, base = clean build of 98b876da `emu-linkbase6`, final =
`emu-link6`, 5 alternated rounds, same settings):

| state | base VM | linking VM | change | wall ms/vbl (vbl/s) base -> linking |
|---|---|---|---|---|
| play | 21.09 (21.14, 21.09, 20.84, 21.47, 20.86) | 19.29 (19.19, 19.29, 18.86, 19.35, 19.90) | -8.5% | 21.35 (46.8) -> 19.65 (50.9) |
| car | 25.09 (25.15, 24.92, 25.07, 25.33, 25.09) | 23.56 (23.53, 23.61, 23.42, 23.69, 23.56) | -6.1% | 25.61 (39.0) -> 25.27 (39.6) |

car is VU1-bound now: wall stays ~25.5 ms/vbl (VU1 busy ~25 ms/vbl) and the VM thread waits for VU1 2-3.5 ms/vbl
instead of 0.3-0.5. Those waits are condition-variable wakeups per VU1 message, which cost VM CPU, so the MTVU-on
CPU number understates the VM work cut; with `vu1thread=0` (profile above) car's VM work drops more than play's.
FFX is VU1-bound (VM waits 10-14 ms/vbl), gow-fight too.

Hashes (`hash=300&vu1thread=0&nolimit=1`): see the hand-back; play/car/gow/intro equal to the baselines cold and
warm. mtvu-ffx: cold equal; warm runs after the first give varying hashes **on the base build too** (75a0d770:
e072a015, db706021, 6354c871 in three runs), so it is a pre-existing FFX nondeterminism with a warm cache, not from
linking.

## Risks
- Table growth: every linked batch or group takes n new slots and deleted batch slots are never reused (a few
  bytes each). Code invalidation churn would grow the table; GTA free roam has none.
- Blocks with the same code at different addresses are compiled once per address now (cache and in-session).
- Groups of 256 compile more unused functions at instantiation if V8 compiles eagerly (no stall seen).
- The block cache must never give a function compiled for one address to a block at another one: any new reuse path
  (CopyFunctionFrom, cache key) has to keep the address.

## Files
Scratchpad `link/`: run.mjs (`--console` collects worker console), prof.mjs, pr.sh + vm.mjs (VM profile ratios),
time.sh, abab.sh, hash.sh, hashall.sh, stats.patch (dispatch counters), dump.mjs + chk.mjs (dump and check patched
batch modules), micro/ (dispatch micro benchmark).
