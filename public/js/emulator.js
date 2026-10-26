// Thin wrapper around the Play! WebAssembly build (public/emu/Play.js + Play.wasm).
// The wasm side renders into the element with id "outputCanvas" (640x480) and
// listens for keyboard events on it, so that canvas must exist before init().
// ?emu=<name> picks the build in public/emu-<name>/ (A/B tests); default public/emu/.
const EMU_VARIANT = new URLSearchParams(location.search).get("emu");
// ?gs=webgpu picks the WebGPU GS renderer (builds that have it); WebGL2 when absent or without a GPU adapter.
const GS_BACKEND = new URLSearchParams(location.search).get("gs");
const EMU_DIR = new URL(/^[a-z0-9-]+$/.test(EMU_VARIANT ?? "") ? `../emu-${EMU_VARIANT}/` : "../emu/", import.meta.url).href;

// Play! asks JS for disc sectors through this object and polls isDone().
class DiscImageDevice {
  constructor(module) { this.module = module; this.file = null; this.done = false; }
  setFile(file) { this.file = file; }
  getFileSize() { return this.file.size; }
  isDone() { return this.done; }
  read(dstPtr, offset, size) {
    this.done = false;
    this.file.slice(offset, offset + size).arrayBuffer().then((buf) => {
      this.module.HEAPU8.set(new Uint8Array(buf), dstPtr);
      this.done = true;
    }, (e) => {
      // RemoteFile already retried: give the VM zeros (it polls isDone forever otherwise) and tell the page
      console.error(`Falha ao ler o disco (${offset}+${size}):`, e);
      this.module.HEAPU8.fill(0, dstPtr, dstPtr + size);
      this.done = true;
      dispatchEvent(new CustomEvent("ps2-disc-error", { detail: e }));
    });
  }
}

let mod = null;
let discBlobUrl = null;
let gameKey = null; // "<file name>-<size>" of the booted game (save-state slot name)

export const SUPPORTED_EXTENSIONS = [".iso", ".cso", ".chd", ".isz", ".bin", ".elf"];

export async function init() {
  if (mod) return mod;
  if (!crossOriginIsolated) {
    throw new Error("Página sem cross-origin isolation (COOP/COEP): SharedArrayBuffer indisponível.");
  }
  if (!document.getElementById("outputCanvas")) {
    throw new Error('Canvas #outputCanvas ausente no DOM.');
  }
  const { default: Play } = await import(EMU_DIR + "Play.js");
  mod = await Play({
    locateFile: (path) => EMU_DIR + path,
    mainScriptUrlOrBlob: EMU_DIR + "Play.js",
  });
  mod.FS.mkdir("/work");
  // Remember what the page asks for, so a fast start (see boot) can override and then restore it.
  for (const k of ["setFrameLimit", "setAudioVolume"]) {
    const f = mod[k];
    if (f) mod[k] = (v) => { wanted[k] = v; if (!fast && !held) f(v); };
    if (f) direct[k] = f;
  }
  mod.discImageDevice = new DiscImageDevice(mod);
  // The GS thread renders on its own OffscreenCanvas and sends every frame here as an ImageBitmap.
  // Builds before that create a WebGL context on #outputCanvas in initVm (so "bitmaprenderer" is null)
  // and draw into it themselves.
  // The frame size follows the GS output (it grows with the internal resolution, see setGsOptions).
  let firstFrame;
  const gsReady = new Promise((r) => (firstFrame = r));
  const canvas = document.getElementById("outputCanvas");
  mod.onGsFrame = (bitmap) => {
    if (fast && !isBlack(bitmap)) endFastStart(true);
    if (held && !held.paused && !isBlack(bitmap)) { held.paused = true; mod.pauseVm(); } // first picture: wait for the page
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    out.transferFromImageBitmap(bitmap);
    if (gsFrames++ === 0) firstFrame();
  };
  if (GS_BACKEND === "webgpu" && (await navigator.gpu?.requestAdapter().catch(() => null))) mod.gsBackend = "webgpu";
  mod.ccall("initVm", "", [], []);
  const out = canvas.getContext("bitmaprenderer");
  if (out) await gsReady; // the GS thread sets up its context once initVm returned; boot after that
  return mod;
}

// ---- Fast start ------------------------------------------------------------------------------
// Most games show a black screen for seconds after boot while they load. Until the first frame with
// something on it, boot() runs the emulator without the frame limiter (emulated timing is the same,
// it just isn't held to wall-clock speed) and with the sound muted, then restores both.
const wanted = { setFrameLimit: true, setAudioVolume: 1 }; // last values the page set
const direct = {};
const FAST_START_MAX_MS = 30000;
const FAST_START = new URLSearchParams(location.search).get("faststart") !== "0"; // ?faststart=0 turns it off (A/B)
let fast = false, fastTimer = 0, quietUntil = null, lastProbe = 0;
const probe = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(16, 12).getContext("2d", { willReadFrequently: true }) : null;

function isBlack(bitmap) {
  if (!probe) return false;
  const now = performance.now();
  if (now - lastProbe < 100) return true; // a readback per frame is not free; 10 checks/s are plenty
  lastProbe = now;
  probe.drawImage(bitmap, 0, 0, 16, 12);
  const px = probe.getImageData(0, 0, 16, 12).data;
  let lit = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 48) lit++;
  return lit < 4;
}

// True while the frame limiter holds the game to real time (not during a fast start or with the limiter off).
export const limiterActive = () => !fast && wanted.setFrameLimit !== false;

function startFastStart(quiet) {
  if (!direct.setFrameLimit || !probe) return;
  fast = true;
  quietUntil = quiet;
  direct.setFrameLimit(false);
  direct.setAudioVolume?.(0);
  clearTimeout(fastTimer);
  fastTimer = setTimeout(() => endFastStart(true), FAST_START_MAX_MS); // a game that stays black (or an old build without onGsFrame)
}

// waitQuiet: keep the sound muted until the boot's quietUntil settles (not when booting again / pausing).
function endFastStart(waitQuiet = false) {
  if (!fast) return;
  fast = false;
  clearTimeout(fastTimer);
  direct.setFrameLimit(wanted.setFrameLimit);
  const unmute = () => { if (!fast) direct.setAudioVolume?.(wanted.setAudioVolume); };
  if (waitQuiet && quietUntil) quietUntil.then(unmute, unmute); else unmute();
  quietUntil = null;
}

// Boots a user-supplied disc image or ELF: a File, or a library RemoteFile
// (same name/size/slice().arrayBuffer()/arrayBuffer() surface, streamed over HTTP).
// options.blockCache = false disables the persistent JIT block cache for this boot.
// options.fastStart = false boots at normal speed with sound (see "Fast start" above).
// options.quietUntil: a promise; the sound stays muted until it settles (e.g. while the page still
// animates before showing the game).
// options.holdUntil: a promise (e.g. a boot intro playing on the TV); until it settles the game boots
// at normal speed with no sound and stops at its first picture, so it starts from there afterwards.
export async function boot(file, { blockCache = true, fastStart = true, quietUntil = null, holdUntil = null } = {}) {
  if (!mod) throw new Error("Chame init() antes de boot().");
  const dot = file.name.lastIndexOf(".");
  const ext = dot === -1 ? "" : file.name.slice(dot).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new Error(`Formato não suportado: "${ext || file.name}". Use ${SUPPORTED_EXTENSIONS.join(", ")}.`);
  }
  gameKey = `${file.name}-${file.size}`;
  await setBlockCache(blockCache ? gameKey : null);
  endFastStart();
  held = null; // a hold from an earlier boot ends with this one (bootDiscImage resumes the VM)
  direct.setAudioVolume?.(wanted.setAudioVolume);
  if (holdUntil && mod.resumeVm) holdBoot(holdUntil);
  else if (fastStart && FAST_START) startFastStart(quietUntil);
  if (ext === ".elf") {
    const data = new Uint8Array(await file.arrayBuffer());
    mod.FS.writeFile(file.name, data);
    mod.bootElf(file.name);
  } else {
    mod.discImageDevice.setFile(file);
    // Let the emulation thread fetch sectors itself (sync XHR + 1 MB block cache in
    // its worker) instead of a main-thread round trip + polling per sector.
    // Server games have a URL; local Files get a blob: URL (Range works on those too).
    if (discBlobUrl) URL.revokeObjectURL(discBlobUrl);
    discBlobUrl = file.url ? null : URL.createObjectURL(file);
    mod.setDiscImageUrl(new URL(file.url ?? discBlobUrl, location.href).href);
    mod.bootDiscImage(file.name);
  }
  document.getElementById("outputCanvas").focus();
}

// Stops emulation until the next boot() (emulation threads idle, audio suspended). Older builds keep running.
export function pause() {
  endFastStart();
  if (held) held = null; // stays paused; the next boot resets the VM
  mod?.pauseVm?.();
}

// ---- Hold (see boot's holdUntil) ------------------------------------------------------------------
let held = null; // { paused } while the page holds the game

function holdBoot(until) {
  const h = (held = { paused: false });
  direct.setFrameLimit?.(wanted.setFrameLimit);
  direct.setAudioVolume?.(0);
  const release = () => { if (held === h) releaseHold(); };
  until.then(release, release);
}

function releaseHold() {
  const h = held;
  if (!h) return;
  held = null;
  if (h.paused) mod.resumeVm();
  direct.setAudioVolume?.(wanted.setAudioVolume);
}

// The Play! module (debugging / measurements from the console), or null before init().
export const getModule = () => mod;

// Changes whenever #outputCanvas gets a new frame; null when unknown (older builds draw into it directly).
let gsFrames = 0;
export const frameId = () => gsFrames || null;

// Frames presented since the previous call; call once per interval to get FPS.
export function takeFrames() {
  if (!mod) return 0;
  const n = mod.getFrames();
  mod.clearStats();
  return n;
}

// ---- Quick save / load ---------------------------------------------------------------------
// One save-state slot per game, kept in OPFS (savestates/<game>.zip). States run on the
// emulation thread; we poll stateStatus() instead of blocking the main thread.
async function waitState() {
  for (;;) {
    const s = mod.stateStatus();
    if (s !== -1) return s === 1;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function stateFile(create) {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("savestates", { create: true });
  return dir.getFileHandle(gameKey.replace(/[^\w.-]+/g, "_").slice(0, 120) + ".zip", { create });
}

export async function saveState() {
  if (!mod || !gameKey) throw new Error("Nenhum jogo rodando.");
  mod.saveState("/work/quick.zip");
  if (!(await waitState())) throw new Error("Não foi possível salvar o estado.");
  const data = mod.FS.readFile("/work/quick.zip");
  const w = await (await stateFile(true)).createWritable();
  await w.write(data);
  await w.close();
}

export async function hasSavedState() {
  if (!gameKey) return false;
  try { await stateFile(false); return true; } catch { return false; }
}

// fh (optional): another OPFS file handle to load instead of this game's slot (dev: index.html ?state=).
export async function loadState(fh) {
  if (!mod || !gameKey) throw new Error("Nenhum jogo rodando.");
  if (!fh) try { fh = await stateFile(false); } catch { throw new Error("Este jogo ainda não tem um estado salvo."); }
  mod.FS.writeFile("/work/quick.zip", new Uint8Array(await (await fh.getFile()).arrayBuffer()));
  mod.loadState("/work/quick.zip");
  if (!(await waitState())) throw new Error("Não foi possível carregar o estado.");
}

// ---- Persistent JIT block cache -------------------------------------------------------------
// The emulator compiles each new block of PS2 code to a small WebAssembly module (1-3 ms each),
// which stutters when new code shows up and after loading a state. Compiled modules are kept in
// OPFS (blockcache/<game>/<n>.bin: header + entries appended by the emulator) and fed back
// before the next boot, so already-seen code skips the compiler. Every segment carries a salt
// that changes when the code generator changes; segments with another salt are deleted on load.
const BC_MAGIC = "PLAYBLK1";
const BC_MAX_SEGMENTS = 16; // merged into one file at load beyond this
let bc = null;              // { dirName, next, header, lastFlush }
let bcTimer = null;
let bcFlushing = null;

async function bcHeader() {
  // Builds with blockCacheSalt() name their code generator (hash of the JIT sources + context layout), so
  // the cache survives rebuilds that cannot change the generated code. Older builds: the Play.wasm file.
  let saltText = mod.blockCacheSalt ? `src:${mod.blockCacheSalt()}` : null;
  if (!saltText) {
    const r = await fetch(EMU_DIR + "Play.wasm", { method: "HEAD", cache: "no-store" });
    const h = (k) => r.headers.get(k) ?? "";
    if (!r.ok || !(h("etag") || h("last-modified"))) return null; // can't tell builds apart
    saltText = `${h("etag")}|${h("last-modified")}|${h("content-length")}`;
  }
  const salt = new TextEncoder().encode(saltText);
  const header = new Uint8Array(12 + salt.length);
  header.set(new TextEncoder().encode(BC_MAGIC));
  new DataView(header.buffer).setUint32(8, salt.length, true);
  header.set(salt, 12);
  return header;
}

const bcRoot = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("blockcache", { create: true });
// One directory per game and per build variant (?emu=), so A/B builds don't evict each other.
const bcDirName = (gameKey) => `${EMU_VARIANT ?? "emu"}-${gameKey}`.replace(/[^\w.-]+/g, "_").slice(0, 120);

// Loads the cache of one game (any string; null disables the cache) into the emulator.
// boot() calls it; call it yourself only to boot without boot().
export async function setBlockCache(gameKey) {
  if (!mod) throw new Error("Chame init() antes de setBlockCache().");
  await flushBlockCache();
  clearInterval(bcTimer);
  bc = null;
  mod.blockCacheEnable(false);
  mod.blockCacheClear();
  if (!gameKey) return;
  try {
    const header = await bcHeader();
    if (!header) return;
    const dirName = bcDirName(gameKey);
    const dir = await (await bcRoot()).getDirectoryHandle(dirName, { create: true });
    const files = [];
    for await (const [name, handle] of dir.entries()) {
      if (/^\d+\.bin$/.test(name)) files.push({ n: parseInt(name, 10), name, handle });
    }
    files.sort((a, b) => a.n - b.n);
    const bodies = [];
    let stale = false, bad = 0;
    for (const f of files) {
      const buf = new Uint8Array(await (await f.handle.getFile()).arrayBuffer());
      if (buf.length >= header.length && header.every((b, i) => buf[i] === b)) {
        bodies.push(buf.subarray(header.length));
      } else if (buf.length >= 8 && BC_MAGIC.split("").every((c, i) => buf[i] === c.charCodeAt(0))) {
        stale = true; // written by another emulator build: drop everything
        break;
      } else {
        bad++; // empty/truncated (e.g. page closed during a flush): drop just this segment
        await dir.removeEntry(f.name).catch(() => {});
      }
    }
    let next = files.length ? files[files.length - 1].n + 1 : 0;
    if (stale) bodies.length = 0;
    let entries = 0;
    for (const body of bodies) entries += mod.blockCacheLoad(body); // entries are checksummed in C++
    if (stale || bodies.length > BC_MAX_SEGMENTS) {
      if (bodies.length) { // merge into one segment
        const merged = new Uint8Array(bodies.reduce((n, b) => n + b.length, 0));
        let o = 0;
        for (const b of bodies) { merged.set(b, o); o += b.length; }
        await bcWrite(dir, `${next++}.bin`, header, merged);
      }
      for (const f of files) await dir.removeEntry(f.name).catch(() => {});
    }
    bc = { dirName, next, header, lastFlush: performance.now() };
    mod.blockCacheEnable(true);
    bcTimer = setInterval(() => {
      // (10 s: blocks compiled near the end of a session are lost if the tab closes before a flush)
      if (mod.blockCachePendingSize() >= (1 << 20) || performance.now() - bc.lastFlush > 10000) flushBlockCache();
    }, 5000);
    console.log(`Block cache "${gameKey}": ${entries} blocks loaded${stale ? " (old build discarded)" : ""}${bad ? `, ${bad} bad segment(s) dropped` : ""}.`);
  } catch (e) {
    console.warn("Block cache unavailable:", e);
  }
}

async function bcWrite(dir, name, header, body) {
  // Resolve by name: another tab may have cleared the cache since this one opened it.
  if (typeof dir === "string") dir = await (await bcRoot()).getDirectoryHandle(dir, { create: true });
  const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await w.write(header);
  await w.write(body);
  await w.close();
}

// Writes blocks compiled since the last flush to OPFS (runs every 10 s / 1 MB and when the page hides).
export function flushBlockCache() {
  bcFlushing ??= (async () => {
    const cur = bc;
    const data = cur && mod.blockCacheTakePending();
    if (!data) return;
    cur.lastFlush = performance.now();
    await bcWrite(cur.dirName, `${cur.next++}.bin`, cur.header, data);
  })().catch((e) => console.warn("Block cache flush failed:", e)).finally(() => { bcFlushing = null; });
  return bcFlushing;
}

// Deletes the cache of every game, or only of gameKey (same key as setBlockCache: boot() uses
// "<file name>-<size>"). If the running game's cache is deleted it keeps caching from scratch.
export async function clearBlockCache(gameKey) {
  await bcFlushing;
  if (gameKey) await (await bcRoot()).removeEntry(bcDirName(gameKey), { recursive: true }).catch(() => {});
  else await (await navigator.storage.getDirectory()).removeEntry("blockcache", { recursive: true }).catch(() => {});
  if (bc && (!gameKey || bc.dirName === bcDirName(gameKey))) {
    mod.blockCacheClear();
    bc.next = 0;
  }
}

// Cache size on disk in bytes, per game.
export async function blockCacheUsage() {
  const r = {};
  for await (const [game, dir] of (await bcRoot()).entries()) {
    r[game] = 0;
    for await (const [, f] of dir.entries()) r[game] += (await f.getFile()).size;
  }
  return r;
}

addEventListener("visibilitychange", () => { if (document.hidden) flushBlockCache(); });
addEventListener("pagehide", () => flushBlockCache());
