# FFX freeze ~70-80 s after loading mtvu-ffx.zip (2026-10-15)

## Symptom
Final Fantasy X NTSC (SLUS-20312), state `mtvu-ffx.zip`: intro 3D runs ~35-60 vbl/s, then vblanks drop to 0
for good at t~72-78 s. Same with public/emu (web-perf) and the previous published build.

## Root cause (not MTVU)
The page console shows `worker sent an error! ... Uncaught RuntimeError: unreachable`. With a
`--profiling-funcs` build and CDP `Runtime.exceptionThrown` on the workers, the trap is in JIT code called
from `CEeExecutor::Execute` on the VM (EE) thread: an EE block hit a wasm `unreachable`.

The only JIT `unreachable` is `OP_BREAK`. `CCOP_VU::LQC2/SQC2` emit it in the slow path (page not directly
mapped) when the codegen has no 128-bit call operands, which is always the case on wasm
(`CCodeGen_Wasm::Has128BitsCallOperands() == false`). Upstream this path is rarely hit, but our software
write protection of EE code pages (`CEeExecutor::SetMemoryProtected`, emscripten branch) nulls
`m_pageLookupWrite` for every RAM page holding compiled code, so a SQC2 into such a page goes to the slow
path and traps. Temporary logging showed it: pc 0x002DEC88, address 0x01B004D0 (EE RAM), repeatedly.
LQ/SQ (MA_EE) already had a word-wise fallback for wasm; LQC2/SQC2 did not.

The suspected MTVU ring/GIF deadlock (VU1 thread stalled on the GIF while the VM thread blocks in
`CVu1Thread::Reserve`) was not involved: the VM thread was dead (trapped), not blocked.

## Fix
Play fork, branch `mtvu`, commit fbed76d8: LQC2/SQC2 fall back to four `MemoryUtils_GetWordProxy` /
`MemoryUtils_SetWordProxy` calls (address aligned to 16), like LQ/SQ. The word proxies run the EE write
watch, so stores into protected code pages still invalidate the compiled blocks.

## Regression check (release `public/emu-fix/`, cold block cache, VU1 threaded)
- FFX mtvu-ffx.zip, 268 s: no stall (min 18 vbl/s, mostly 40-60), no worker error, intro renders correctly.
- GTA play.zip, 110 s, save at 60 s + load at 75 s: runs 20-34 vbl/s after load, renders correctly.
- GTA car.zip, 80 s: 20-38 vbl/s, renders correctly.
Repro/check tool: scratchpad `ffx/run.sh <emu> <state> <gta|ffx> <secs> "" --exc=1` (vj.mjs with worker
exception capture). Variants: `emu-fix` (release), `emu-fixdbg` (release + function names).

## Still open
The MTVU robustness idea (VIF1/GIF ReceiveDMA returning 0 when the ring lacks room instead of blocking in
Reserve) was not done: no observed deadlock needs it.
