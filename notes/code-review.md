# Code review: web-perf branch (Play! fork) + site

Scope: `git diff d44bfa18..web-perf -- Source tools ':!*.md'`, CodeGen commits 5ca6ca6..d8c5b47 (ours), site
`serve.py`, `public/js/*.js`, `public/index.html`. Read-only review (nothing built or run). Line numbers refer to
`web-perf` (play-src) and `main` (site). Items already listed as known in `notes/*.md` (pending flips after
discard, GIF_STAT/VIF1_STAT unsynced, `g_discImageUrl` race, audio limitations) are not repeated.

Severity: H = crash/hang/corruption in normal use, M = plausible in real games or rare but bad, L = edge case or
hardening. Confidence: how sure I am the scenario can really happen.

## Summary

| # | Finding | Sev | Conf |
|---|---|---|---|
| 1 | MTVU `Sync()` returns while the VU1 thread is "stalled", but a stalled thread resumes on its own 1 ms timer: the VM thread's "exclusive" sections race with it | H | high (mechanism), medium (frequency) |
| 2 | `SetVu1Threaded(false)` after a stalled `Sync()` leaves data in the ring and swaps executors under the VU1 thread | H | medium |
| 3 | Save state while VU1 is stalled drops the ring contents (data the front already consumed) | M | medium |
| 4 | `Reserve()` can deadlock: ring full while the consumer is stalled on a SIGNAL only the VM thread can acknowledge | M | low-medium |
| 5 | `RunSync()` in `~CSubSystem` hangs if the VU1 thread is stalled | L | medium |
| 6 | SIGNAL acknowledge does not wake the VU1 thread (up to 1 ms per SIGNAL, plus #1 window) | L | high |
| 7 | GS download (VIF1 FIFO read to EE RAM) skips `NotifyRamWritten` | L | high (missing), low (impact) |
| 8 | Disc XHR reader: no Content-Range/length check, worker cache keyed only by URL | L | medium |
| 9 | Booting an ELF after a disc keeps the old disc URL / blob alive | L | high |
| 10 | `serve.py` does not check the Host header (DNS rebinding can read `games/`) | L | medium |
| 11 | Dual-layer fast path trusts a single sector match | L | low |

Count: H 2, M 2, L 7.

## Findings

### 1. Stalled VU1 thread is treated as idle, then resumes by itself (H)
`Source/ee/Vu1Thread.cpp:144-159` (`Sync`), `:239-254` (`SleepStalled`), `:375-380`.

`Sync()` returns when `m_idle && m_stalled && m_stalledPublishedPos == published`. But a stalled thread waits
with `wait_for(1 ms)` and then goes around the loop again: if the stall cause went away (GIF SIGNAL acknowledged via
CSR, PATH3 packet finished), it sets `m_idle = false` and processes the rest of the ring (UNPACK into VU1 memory,
microprograms, XGKICK) *while the VM thread is already inside a section it believes exclusive*. `Sync()` only
excludes the thread if it is called again after the thread woke up; sections that start right after `Sync()`
returned are not protected. Only `SyncAndLockGif()` callers are safe, because processing needs `m_gifMutex`.

Concrete scenario: game's SIGNAL handler writes CSR (clears SIGNAL), then the EE writes VU1 data memory
(`IoWriteHandler`, Ee_SubSystem.cpp:804) or reads it (`Vu1MemReadHandler`, :787). `Sync()` sees "stalled" and
returns at once; within 1 ms the VU1 thread wakes, runs a queued UNPACK/microprogram on the same memory: EE writes
lost/overwritten, order inverted vs. the front decoder's view. Same race for `SaveState` (:415, serialises VU1
memory/state while it changes), `SetVu1BlockNoClamping` (:844, mutates the `std::set` the VU1 executor reads:
UB/crash), VU1 register access via VU0, ROW reads.

Fix (small): make the exclusive sections hold `m_gifMutex` (the VU1 thread cannot process without it). E.g. have
`SyncVu1()` return the `unique_lock` from `SyncAndLockGif()` and keep it for the duration of the access; or keep
`Sync()` but have it take `m_gifMutex` and re-check `isDone` under it, returning the lock. Alternatively drop the
timed retry: wake the stalled thread explicitly from the CSR write / GIF paths, and in `Sync()` wait for that
re-evaluation.

### 2. Turning MTVU off while VU1 is stalled (H)
`Source/ee/Ee_SubSystem.cpp:895-902`.

The off path does `m_vu1Thread->Sync()` and then swaps executors, switches the front to `ROLE_NORMAL`, clears
`m_gif.SetVu1Thread`. If the thread was stalled, the ring still holds unprocessed VIF1/PATH3 messages (and the PATH3
side queue). Results: (a) that data is never processed by the now-normal VIF/GIF (lost geometry, PATH3 packet
half-sent, GIF state stuck in `m_activePath`); (b) worse, the VU1 thread can wake (#1) and run `m_vpu1` with
`m_VU1.m_executor` already swapped to the VM thread's executor, calling wasm table indexes from another worker's
table (the "table index out of bounds" crash in notes/mtvu.md). Triggered by `Module.setVu1Threaded(false)` or a
GameConfig switch at vblank.

Fix: in `SetVu1Threaded(false)` refuse (return false, retried next vblank) unless the ring is fully drained and
the PATH3 queue empty (a `Sync` variant that does not accept "stalled"), and do the switch while holding
`m_gifMutex`.

### 3. Save state drops stalled ring data (M)
`Source/ee/Ee_SubSystem.cpp:415-420` (+ `PS2VM.cpp` save path, `SyncVu1()`).

When VU1 is stalled, messages after the stall point (VIF1 data, PATH3 chunks, queued flip/functions) are in the
ring, but the saved state has the *front* decoder state, which already consumed that data. On load,
`SyncAndDiscard` + `CopyStateFrom(front)` starts clean, so the consumed-but-unprocessed VIF1/PATH3 data is gone:
missing draws, or a game waiting for a VU1 result / PATH3 completion hangs after load. Happens only if the save
lands in a stall window, so intermittent ("this save state hangs").

Fix: before saving, wait for a fully drained ring (not "stalled"): e.g. loop {acknowledge nothing, just `Sync`
until `readPos == published && path3Queue.empty()`}; if the stall needs EE action, run the VM a little and retry,
or save the remaining ring bytes + back VIF state in the archive. Simplest acceptable: refuse the save
(`future` = false) while stalled and let the UI retry next frame.

### 4. Producer can deadlock on a full ring (M, low-medium confidence)
`Source/ee/Vu1Thread.cpp:65-79` (`Reserve`).

`Reserve()` blocks until the consumer frees space. If the consumer is stalled on the GIF waiting for a SIGNAL
acknowledge (CSR write by EE code on the VM thread), it never frees space and the VM thread never runs the EE:
deadlock. Requires ~16 MB pushed during one stall. The flip throttle (`m_vu1PendingFlips >= 2` -> `SyncVu1`) does not
bound this, since `Sync` returns immediately when stalled. Heavy PATH3 texture streaming / FMV games make it
plausible.

Fix: in the wait loop, also return/handle when the consumer is stalled with `m_stalledPublishedPos ==
m_publishedPos`: e.g. grow into an overflow `std::vector` message list, or let `Reserve` run pending VM-side work.
At minimum, log + `assert` so a hang is diagnosable.

### 5. `RunSync` hang on destruction (L)
`Source/ee/Ee_SubSystem.cpp:184-196`, `Vu1Thread.cpp:134-142`.

`~CSubSystem` posts a function and `future.wait()`s. The function sits behind any stalled message, so if the VU1
thread is stalled the wait never ends (VM destruction/power off hangs the worker). Same for `SetVu1Threaded(true)`
`RunSync` calls if the thread is ever stalled at that point. Fix: `SyncAndDiscard()` before `RunSync` in the
destructor (state does not matter any more).

### 6. SIGNAL acknowledge does not wake the VU1 thread (L, perf + widens #1)
`Source/gs/GSHandler.cpp:504-512`, `Vu1Thread.cpp:251`.

Clearing `CSR_SIGNAL_EVENT` does not notify `m_workCondition`; the stalled thread retries only after its 1 ms
timeout. Games that use SIGNAL several times per frame lose up to 1 ms each on the VU1/GS path. Fix: after a CSR
write that clears SIGNAL (or in `CGIF` when the signal state changes) call a `CVu1Thread::Wake()` that notifies
`m_workCondition` under `m_mutex`.

### 7. GS download to EE RAM is not reported to write protection (L)
`Source/ee/Vif1.cpp:106` (`gs->ReadImageData(source + address, size)`).

All other C++ writers to EE RAM call `CEeExecutor::NotifyRamWritten`; this one does not, so a JIT block on a
protected page overwritten by a GS->memory transfer keeps running stale code. Data, not code, in practice, so
impact is low, but it is a one-liner: `if(source == m_ram) CEeExecutor::NotifyRamWritten(address, size);`.
(`PS2OS::LoadExecutable` writes code directly but flushes the instruction cache right after: fine.)

### 8. Disc XHR reader robustness (L)
`Source/Js_DiscImageDeviceStream.cpp:15-70`.

- Accepts any 206 body as block `bi` without checking `Content-Range` start. A server/proxy that answers with a
  different range (or a blob that changed) silently feeds wrong sectors. Check
  `x.getResponseHeader("Content-Range")` starts with `bytes ${start}-` (blob: URLs set it too) and that the length
  is `BS` unless it is the last block.
- The worker-global LRU (`globalThis.__ps2Disc`) is keyed only by URL. Server games keep the same URL for the same
  file name, so replacing `games/foo.iso` with another dump of the same name serves up to 48 MB of stale blocks for
  the rest of the session. Key on `url + size` (pass the size) or clear it in `Js_SetDiscImageUrl`.
- A failure after a partial copy returns 0 and the main-thread fallback re-reads the whole range: fine, but the
  fallback `DiscImageDevice.read` (emulator.js:14-20) never sets `done` on error, so a failed fallback read hangs the
  VM thread polling forever. Set `this.done = true` (and fill zeros / report) on error.

### 9. ELF boot keeps the previous disc URL (L)
`public/js/emulator.js:77-80`.

`boot()` of an `.elf` does not call `setDiscImageUrl("")` nor revoke the previous `discBlobUrl`. An ELF that
touches `cdrom0:` reads the previously booted disc through the old URL, and the old blob stays alive. Fix: in the
ELF branch, `mod.setDiscImageUrl("")` and revoke/null `discBlobUrl`.

### 10. serve.py: no Host check (L, security hardening)
`serve.py:46-123`.

Binding to 127.0.0.1 does not stop DNS rebinding: a web page can rebind its own hostname to 127.0.0.1 and then
read `/games/index.json` and stream the user's dumps same-origin (no Host validation). Path traversal and Range
parsing look correct (`game_path` resolves and checks parent; suffix/open/overlong ranges clamp; 416 on bad
ranges; selftest covers them). Fix: reject requests whose `Host` is not `localhost[:port]`, `127.0.0.1[:port]`,
`[::1][:port]` or the explicit `--host` value (send 421/403).

### 11. Dual-layer fast path (L, low confidence)
`Source/OpticalMedia.cpp:145-164`.

Takes `volumeSpaceSize` of the layer-0 PVD and accepts the layer-1 PVD only if it sits exactly at that LBA. Some
DVD9 dumps put the layer-1 PVD at `layer1Start + 16` with `layer1Start = volumeSpaceSize`, i.e. at `vss + 16`; the
fast path then misses and falls back to the scan (correct, just slow). No false positive found: a `CD001` type-1
descriptor at exactly `vss` is the layer-1 PVD. Optional: also probe `vss + 16` before scanning (and set
`m_dvdSecondLayerStart` accordingly).

## Checked, no issue found

- Ring buffer wrap-around (`Reserve`/`Commit`/consumer): offsets stay 16-aligned so the `MESSAGE_WRAP` header always
  fits; free-space math uses free-running 64-bit positions; the payload of a stalled VIFDATA message is not
  reclaimed because `m_readPos` advances only after it completes; seq_cst publish/sleep handshake is correct.
- `SH_WebAudio` / `WebAudio.js` ring: free-running uint32 counters with `>>> 0`, power-of-two mask, copy split at
  wrap, overflow counted; worklet search bounds stay inside the held input.
- `EeExecutor` software write protection: mirrors 0/0x2000/0x3000/0x8000 updated together; `UpdateFunctionIndex`
  refuses stale batched blocks; `InvalidateWrittenRange` clamps to RAM; Reset unprotects everything.
- `FastIdct`: same transform and rounding as `CIEEE1180` (which does not clamp either).
- CodeGen page ops: alignment masking matches the old proxies; 128-bit slow path splits into 4 word handler calls
  like the old path; promoted symbols are stored before / reloaded after handler calls; 64-bit store pairing
  refuses promoted destinations and the sign-store aliasing case.
- `blockCacheTakePending` copies into a new `Uint8Array` before the vector dies; `BlockCache::Load` validates size,
  magic and checksum per entry.
- GS thread yield to the event loop: keepalive push/pop balanced, exits normally once `m_threadDone` is set.
- Site HTML sinks: `innerHTML` only with static titles or `escapeHtml`'d gamepad ids.
