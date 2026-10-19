# Firefox out of memory with the JIT (2026-10-19)

Branch `firefox-mem` (Play 53b18fe3, CodeGen cc7f1eb), worktree `play-firefox/`, both pushed to `fork`.
**Shipped 2026-10-19:** fast-forwarded into web-perf (Play 53b18fe3, CodeGen web-perf cc7f1eb), both pushed to `fork`;
build live in `public/emu/` (Brave hashes car/mtvu-ffx/gow-fight identical, car.zip timing unchanged). `public/emu-firefox/` removed.

## Root cause
- Firefox (SpiderMonkey) allocates executable memory for each wasm module in 64 KiB chunks and caps a
  process at 1 GiB. Microtest in Firefox 158 (tiny 1-function modules, kept alive): `InternalError: out of
  memory` after **16350 modules**. Modules that are no longer referenced get collected (200k created
  without keeping them: no error), so only the *live* count matters.
- Every JIT block is first compiled as its own module. EE blocks are then moved into 64-block batch
  modules, but `CMemoryFunction` kept an emval handle to the block's own module forever
  (`m_wasmModule`), so batching never freed anything: live modules = every EE block + the batches + VU/IOP blocks.
- Measured with a `WebAssembly.Module` counter injected into Play.js (scratch only): GTA car.zip in
  Firefox died at ~13.7k modules on the VM thread, ~10 s after the state load (cold block cache).
  Chrome/Brave have no such per-module floor, which is why they never hit it.

## Fix (CodeGen `MemoryFunction.cpp`)
- `ReplaceWasmFunction` drops the block's own module (`m_wasmModule = val()`), so it is collectable once
  its instance's table slot is removed.
- `CreateInstance` (block copies with the same code at another address, EE `CopyFunctionFrom`) on a batched
  function now shares it through a new table slot (`WasmCloneFunction`: `getEmptyTableSlot` +
  `setWasmTableEntry`), since there is no module left to re-instantiate. Unbatched blocks behave as before.
- VU and IOP blocks are still one module each; they stayed in the hundreds-to-low-thousands in these runs.
  If a game ever pushes them near 16k, batch them like EE blocks.

## Results
Firefox 158 headless, fresh temp profile, no block cache (worst case: everything compiles), 120-150 s:
| run | before | after |
|---|---|---|
| GTA car.zip | OOM at ~10 s (0 vbl/s) | runs 150 s, 24-34 vbl/s, 37k modules created |
| FFX cold boot | OOM after ~25 s (notes/browsers.md) | runs 150 s, 30-60 vbl/s, 16.8k modules created |
| FFX mtvu-ffx.zip | ran 150 s (few compiles) | - |
| GoW cold boot | OOM during boot (notes/browsers.md) | runs 120 s, ~60 vbl/s, 19.4k modules created |
Firefox process RSS stayed ~1.9-2.2 GB in all runs. (vbl/s in headless Firefox is not comparable with Brave.)

Brave (same tree built with and without the fix):
- Hashes (`&hash=300&vu1thread=0&nolimit=1`): car.zip and mtvu-ffx.zip identical, all 300 vblanks.
- car.zip `&time=100,600&vu1thread=0&nolimit=1`, ABABAB: base 29728/26682/28130 ms, fix 24888/26398/25600 ms
  (no regression; the small gain is within noise).

## Tooling (session scratchpad `ff/`, not committed)
- `ffrun.mjs`: headless Firefox from `~/.local/opt/firefox` with a throwaway profile, driven over WebDriver
  BiDi (port 9334); copies save states into its OPFS, logs status, RSS, MemAvailable and live module counts,
  aborts on 0 vblanks for 30 s or MemAvailable < 2.5 GB, kills its own Firefox by PID.
- `modtest.js` + `ffeval.mjs`: the module-count microtest. `brun.mjs`: Brave hash/time runner over CDP [::1]:9222.
