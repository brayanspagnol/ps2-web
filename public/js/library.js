// Game library: curated catalog (metadata + bundled box art in public/covers),
// the user's own dumps streamed from serve.py's games/ folder or imported into
// OPFS, SYSTEM.CNF serial detection, cover/disc art and the shelf UI.
// Nothing here downloads games or BIOS from the internet.

// Kept in sync with SUPPORTED_EXTENSIONS in emulator.js (not imported: that
// module pulls in the whole Play! glue code).
const EXTENSIONS = [".iso", ".cso", ".chd", ".isz", ".bin", ".elf"];
const STORE_DIR = "ps2-library";
const INDEX_FILE = "index.json";
const QUOTA_MARGIN = 16 * 1024 * 1024;

// ---------------------------------------------------------------- catalog
// Serials in canonical form "SLUS-20946". Only serials we're confident about;
// anything else falls back to the manual choice dialog.
export const GAMES = [
  {
    id: "gta-san-andreas", title: "Grand Theft Auto: San Andreas", year: 2004,
    genre: "Ação · mundo aberto",
    description: "Carl Johnson volta para Los Santos e se vê no meio de guerras de gangues, polícia corrupta e uma jornada por três cidades do estado de San Andreas.",
    serials: ["SLUS-20946", "SLES-52541"],
    palette: { bg: ["#2a0f4f", "#ff6a3d"], accent: "#ffd166", ink: "#140a1e", text: "#fff4e0" },
    art: { motif: "sunset", kicker: "Grand Theft Auto", big: "San Andreas", font: "italic 900 {s}px 'Arial Black', 'Helvetica Neue', sans-serif", tagline: "Los Santos · San Fierro · Las Venturas" },
  },
  {
    id: "god-of-war", title: "God of War", year: 2005, genre: "Ação · hack and slash",
    description: "Kratos, um guerreiro espartano atormentado pelo passado, enfrenta monstros e deuses do Olimpo numa vingança brutal contra Ares.",
    serials: ["SCUS-97399", "SCES-53133"],
    palette: { bg: ["#5a0b0b", "#0b0606"], accent: "#e8b04a", ink: "#120404", text: "#f6e7c8" },
    art: { motif: "olympus", big: "God of War", font: "700 {s}px Georgia, 'Times New Roman', serif", spacing: 0.08, tagline: "A vingança de um espartano" },
  },
  {
    id: "shadow-of-the-colossus", title: "Shadow of the Colossus", year: 2005, genre: "Aventura",
    description: "Um jovem cavaleiro atravessa uma terra proibida e silenciosa para derrubar dezesseis colossos e tentar devolver a vida a uma garota.",
    serials: ["SCUS-97472", "SCES-53326", "SCPS-15097"],
    palette: { bg: ["#c9cfd2", "#7f7466"], accent: "#fff8e6", ink: "#2a2a2c", text: "#fbfaf6" },
    art: { motif: "colossus", kicker: "Shadow of the", big: "Colossus", font: "300 {s}px Georgia, 'Times New Roman', serif", spacing: 0.22, tagline: "Dezesseis gigantes · uma espada" },
  },
  {
    id: "mgs3-snake-eater", title: "Metal Gear Solid 3: Snake Eater", year: 2004, genre: "Stealth · ação",
    description: "Em plena Guerra Fria, Naked Snake se infiltra na selva soviética numa missão de espionagem, sobrevivência e lealdade.",
    serials: ["SLUS-20915", "SLES-82013"],
    palette: { bg: ["#3d4a2a", "#141a0e"], accent: "#c7d36f", ink: "#0d1108", text: "#eef0d8" },
    art: { motif: "camo", kicker: "Metal Gear Solid 3", big: "Snake Eater", font: "800 {s}px 'Courier New', 'DejaVu Sans Mono', monospace", spacing: 0.06, tagline: "Operação na selva · 1964" },
  },
  {
    id: "final-fantasy-x", title: "Final Fantasy X", year: 2001, genre: "RPG",
    description: "Tidus é arrancado de sua cidade e lançado em Spira, onde acompanha a invocadora Yuna numa peregrinação para deter a ameaça chamada Sin.",
    serials: ["SLUS-20312", "SCES-50490", "SLPS-25050"],
    palette: { bg: ["#0b2a5b", "#0b8a9a"], accent: "#9ef0ff", ink: "#04142c", text: "#f2fbff" },
    art: { motif: "ocean", kicker: "Final Fantasy", big: "X", font: "italic 600 {s}px Georgia, 'Times New Roman', serif", spacing: 0.04, tagline: "Uma peregrinação por Spira" },
  },
  {
    id: "gran-turismo-4", title: "Gran Turismo 4", year: 2004, genre: "Corrida · simulação",
    description: "Centenas de carros reais e circuitos lendários num simulador de corrida obcecado por detalhes, da carteira de habilitação ao campeonato.",
    serials: ["SCUS-97328", "SCES-51719", "SCPS-17001"],
    palette: { bg: ["#1d2026", "#0b0c0f"], accent: "#ff3b30", ink: "#07080a", text: "#f4f6f8" },
    art: { motif: "racing", kicker: "Gran Turismo", big: "4", font: "italic 800 {s}px 'Helvetica Neue', Arial, sans-serif", spacing: 0.02, tagline: "O simulador de corrida" },
  },
  {
    id: "kingdom-hearts", title: "Kingdom Hearts", year: 2002, genre: "RPG de ação",
    description: "Sora parte numa jornada entre mundos para reencontrar os amigos desaparecidos e enfrentar os Heartless, criaturas nascidas da escuridão.",
    serials: ["SLUS-20370", "SCES-50967", "SLPS-25105"],
    palette: { bg: ["#0c1240", "#4b1d6e"], accent: "#ffd76a", ink: "#060820", text: "#f6f2ff" },
    art: { motif: "hearts", big: "Kingdom Hearts", font: "700 {s}px Georgia, 'Times New Roman', serif", spacing: 0.05, tagline: "Uma jornada entre mundos" },
  },
  {
    id: "resident-evil-4", title: "Resident Evil 4", year: 2005, genre: "Survival horror · ação",
    description: "O agente Leon S. Kennedy chega a um vilarejo rural na Europa para resgatar a filha do presidente e encontra moradores hostis e um culto sinistro.",
    serials: ["SLUS-21134", "SLES-53702"],
    palette: { bg: ["#3b2a1a", "#0c0806"], accent: "#e01e1e", ink: "#0a0605", text: "#efe4d2" },
    art: { motif: "village", kicker: "Resident Evil", big: "4", font: "900 {s}px Georgia, 'Times New Roman', serif", spacing: 0.02, tagline: "Um vilarejo que não dorme" },
  },
];

// ---------------------------------------------------------------- serials
// "SLUS_209.46", "slus-20946", "SLUS20946" -> "SLUS-20946". null if not a serial.
export function normalizeSerial(s) {
  const m = /([A-Z]{4})[\s_-]*(\d{3})\.?(\d{2})/i.exec(String(s ?? ""));
  return m ? `${m[1].toUpperCase()}-${m[2]}${m[3]}` : null;
}

// Extracts the boot serial from SYSTEM.CNF text (BOOT2 for PS2, BOOT for PS1).
export function parseSystemCnf(text) {
  const m = /^\s*BOOT2?\s*=\s*cdrom0?:\\?([^;\r\n]+)/im.exec(text);
  return m ? normalizeSerial(m[1].split("\\").pop()) : null;
}

const findBySerial = (serial) => serial && GAMES.find((g) => g.serials.includes(serial));

// ISO9660 walk on a few small slices. Handles cooked 2048-byte images and raw
// 2352-byte .bin (Mode 1 / Mode 2 Form 1); compressed formats return null.
export async function detectSerial(file) {
  const ext = extOf(file.name ?? "");
  if (![".iso", ".bin", ""].includes(ext)) return null;
  for (const [sectorSize, dataOffset] of [[2048, 0], [2352, 24], [2352, 16]]) {
    const readSectors = async (lba, count) => {
      const raw = new Uint8Array(await file.slice(lba * sectorSize, (lba + count) * sectorSize).arrayBuffer());
      if (sectorSize === 2048) return raw;
      const out = new Uint8Array(count * 2048);
      for (let i = 0; i < count; i++) out.set(raw.subarray(i * 2352 + dataOffset, i * 2352 + dataOffset + 2048), i * 2048);
      return out;
    };
    const pvd = await readSectors(16, 1);
    if (pvd.length < 2048 || pvd[0] !== 1 || ascii(pvd, 1, 5) !== "CD001") continue;
    const dv = new DataView(pvd.buffer);
    const rootLba = dv.getUint32(156 + 2, true);
    const rootLen = Math.min(dv.getUint32(156 + 10, true), 64 * 1024);
    const dir = await readSectors(rootLba, Math.ceil(rootLen / 2048));
    const ddv = new DataView(dir.buffer);
    for (let p = 0; p < dir.length;) {
      const len = dir[p];
      if (len === 0) { p = (Math.floor(p / 2048) + 1) * 2048; continue; } // padding to next sector
      const name = ascii(dir, p + 33, dir[p + 32]).toUpperCase().replace(/;\d+$/, "");
      if (name === "SYSTEM.CNF") {
        const lba = ddv.getUint32(p + 2, true);
        const size = Math.min(ddv.getUint32(p + 10, true), 4096);
        const data = await readSectors(lba, Math.ceil(size / 2048));
        return parseSystemCnf(new TextDecoder("latin1").decode(data.subarray(0, size)));
      }
      p += len;
    }
    return null; // valid ISO9660 but no SYSTEM.CNF
  }
  return null;
}

function ascii(bytes, start, len) {
  let s = "";
  for (let i = start; i < start + len && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function extOf(name) {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

// ---------------------------------------------------------------- storage (OPFS)
function libError(message, code, extra) {
  return Object.assign(new Error(message), { code }, extra);
}

async function storeDir() {
  if (!navigator.storage?.getDirectory) {
    throw libError("Este navegador não oferece armazenamento local de arquivos (OPFS). Use uma versão recente do Chrome, Edge, Brave ou Firefox.", "NO_OPFS");
  }
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(STORE_DIR, { create: true });
}

async function readIndex(dir) {
  try {
    const file = await (await dir.getFileHandle(INDEX_FILE)).getFile();
    return JSON.parse(await file.text());
  } catch (e) {
    if (e.name === "NotFoundError") return {};
    throw e;
  }
}

// ponytail: index rewritten whole and imports aren't locked against each other; fine for one tab.
async function writeIndex(dir, index) {
  const w = await (await dir.getFileHandle(INDEX_FILE, { create: true })).createWritable();
  await w.write(JSON.stringify(index));
  await w.close();
}

export function formatBytes(n) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toLocaleString("pt-BR", { maximumFractionDigits: i > 1 ? 1 : 0 })} ${units[i]}`;
}

// onProgress(bytesWritten, totalBytes). gameId: catalog id, an existing
// "custom-*" id, or "custom" to create a new entry titled after the file.
export async function importFile(file, { onProgress, gameId, signal } = {}) {
  if (!file || typeof file.stream !== "function") throw libError("Nenhum arquivo selecionado.", "NO_FILE");
  const ext = extOf(file.name);
  if (!EXTENSIONS.includes(ext)) {
    throw libError(`Formato não suportado (${ext || file.name}). Use ${EXTENSIONS.join(", ")}.`, "UNSUPPORTED_FORMAT");
  }
  const dir = await storeDir();
  const serial = await detectSerial(file).catch(() => null);

  let id = gameId;
  let title;
  if (!id) {
    id = findBySerial(serial)?.id;
    if (!id) {
      throw libError(
        serial ? `O disco ${serial} não está no catálogo. Escolha qual jogo é.` : "Não foi possível identificar o jogo automaticamente. Escolha qual jogo é.",
        "NEEDS_GAME_CHOICE", { serial });
    }
  }
  if (id === "custom") {
    id = `custom-${Date.now().toString(36)}`;
    title = file.name.slice(0, file.name.length - ext.length).replace(/[_.]+/g, " ").trim() || "Jogo importado";
  } else if (!id.startsWith("custom-") && !GAMES.some((g) => g.id === id)) {
    throw libError(`Jogo desconhecido: ${id}.`, "UNKNOWN_GAME");
  }

  const index = await readIndex(dir);
  const previous = index[id];
  const { quota = 0, usage = 0 } = await navigator.storage.estimate();
  const free = quota - usage + (previous?.size ?? 0);
  if (file.size + QUOTA_MARGIN > free) {
    throw libError(
      `Espaço insuficiente: o arquivo tem ${formatBytes(file.size)}, mas o navegador só libera ${formatBytes(Math.max(0, free))} para este site. Libere espaço no disco ou remova jogos da biblioteca.`,
      "QUOTA_EXCEEDED", { gameId: id, title, serial });
  }
  await navigator.storage.persist?.().catch(() => false);

  const fileName = id + ext;
  const handle = await dir.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable(); // writes go to a swap file until close()
  let written = 0;
  onProgress?.(0, file.size);
  try {
    await file.stream()
      .pipeThrough(new TransformStream({
        transform(chunk, ctrl) { written += chunk.byteLength; onProgress?.(written, file.size); ctrl.enqueue(chunk); },
      }))
      .pipeTo(writable, { signal });
  } catch (e) {
    await writable.abort().catch(() => {});
    if (!previous || previous.fileName !== fileName) await dir.removeEntry(fileName).catch(() => {});
    if (e.name === "AbortError") throw libError("Importação cancelada.", "ABORTED");
    if (e.name === "QuotaExceededError") throw libError("O espaço de armazenamento acabou durante a cópia. Libere espaço e tente de novo.", "QUOTA_EXCEEDED");
    throw libError(`Falha ao copiar o arquivo: ${e.message}`, "WRITE_FAILED");
  }
  if (previous && previous.fileName !== fileName) await dir.removeEntry(previous.fileName).catch(() => {});

  index[id] = { fileName, size: file.size, serial, importedAt: Date.now(), originalName: file.name, ...(title ? { title } : previous?.title ? { title: previous.title } : {}) };
  await writeIndex(dir, index);
  return { gameId: id, serial };
}

export async function listOwned() {
  const index = await readIndex(await storeDir());
  return new Map(Object.entries(index));
}

export async function getGameFile(gameId) {
  const dir = await storeDir();
  const entry = (await readIndex(dir))[gameId];
  if (!entry) throw libError("Este jogo não está na biblioteca. Importe o seu disco primeiro.", "NOT_OWNED");
  try {
    return await (await dir.getFileHandle(entry.fileName)).getFile();
  } catch (e) {
    if (e.name === "NotFoundError") throw libError("O arquivo deste jogo sumiu do armazenamento do navegador. Importe o disco de novo.", "MISSING_FILE");
    throw e;
  }
}

export async function removeGame(gameId) {
  const dir = await storeDir();
  const index = await readIndex(dir);
  const entry = index[gameId];
  if (!entry) return;
  await dir.removeEntry(entry.fileName).catch((e) => { if (e.name !== "NotFoundError") throw e; });
  delete index[gameId];
  await writeIndex(dir, index);
}

// ---------------------------------------------------------------- local games folder (serve.py /games/)
// File-like view of a dump served over HTTP with Range requests. Implements the
// subset emulator.boot()/DiscImageDevice and detectSerial use: name, size,
// slice(start, end).arrayBuffer() and arrayBuffer(). Play! reads ~2 KB sectors
// one at a time, so reads go through a read-ahead block cache: fixed blocks, a
// small LRU, and one shared promise per block so concurrent reads merge.
export const REMOTE_BLOCK = 1024 * 1024;
const REMOTE_CACHE_BLOCKS = 24; // ~24 MB per open file

export class RemoteFile {
  constructor(url, name, size, { fetchImpl = (...a) => fetch(...a) } = {}) {
    this.url = url; this.name = name; this.size = size;
    this.blocks = new Map(); // block index -> Promise<Uint8Array>, insertion order = LRU
    this.requests = 0;       // HTTP requests made (for tests/diagnostics)
    this.fetchImpl = fetchImpl;
  }

  async fetchRange(start, end) { // [start, end) -> Uint8Array; retries transient failures
    for (let attempt = 0; ; attempt++) {
      try {
        this.requests++;
        const res = await this.fetchImpl(this.url, { headers: { Range: `bytes=${start}-${end - 1}` } });
        if (res.status !== 206) throw new Error(`HTTP ${res.status} ao ler ${this.name}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.length !== end - start) throw new Error(`Leitura curta em ${this.name}`);
        return buf;
      } catch (e) {
        if (attempt >= 2) throw e;
        await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
      }
    }
  }

  block(i) {
    let p = this.blocks.get(i);
    if (p) { this.blocks.delete(i); this.blocks.set(i, p); return p; } // touch
    const start = i * REMOTE_BLOCK, end = Math.min(this.size, start + REMOTE_BLOCK);
    p = this.fetchRange(start, end);
    p.catch(() => this.blocks.get(i) === p && this.blocks.delete(i)); // don't cache failures
    this.blocks.set(i, p);
    while (this.blocks.size > REMOTE_CACHE_BLOCKS) this.blocks.delete(this.blocks.keys().next().value);
    return p;
  }

  async read(start, end) {
    start = Math.max(0, Math.min(this.size, start));
    end = Math.max(start, Math.min(this.size, end));
    if (end - start > 4 * REMOTE_BLOCK) return this.fetchRange(start, end); // big one-off (ELF): bypass cache
    if (end === start) return new Uint8Array(0);
    const first = Math.floor(start / REMOTE_BLOCK), last = Math.floor((end - 1) / REMOTE_BLOCK);
    const next = last + 1; // read-ahead: discs are mostly read sequentially
    if (next * REMOTE_BLOCK < this.size && !this.blocks.has(next)) this.block(next).catch(() => {});
    const parts = [];
    for (let i = first; i <= last; i++) parts.push(this.block(i));
    const blocks = await Promise.all(parts);
    if (blocks.length === 1) return blocks[0].slice(start - first * REMOTE_BLOCK, end - first * REMOTE_BLOCK);
    const out = new Uint8Array(end - start);
    blocks.forEach((b, k) => {
      const base = (first + k) * REMOTE_BLOCK;
      const s = Math.max(start, base), e = Math.min(end, base + b.length);
      out.set(b.subarray(s - base, e - base), s - start);
    });
    return out;
  }

  slice(start = 0, end = this.size) {
    return { size: Math.max(0, Math.min(end, this.size) - start), arrayBuffer: () => this.read(start, end).then((u) => u.buffer) };
  }

  arrayBuffer() { return this.read(0, this.size).then((u) => u.buffer); }
}

const GAMES_URL = new URL("../../games/", import.meta.url);
const serialMemo = new Map(); // "name|size|mtime" -> serial (avoids re-reading on every refresh)

// Lists the user's dumps in the server's games/ folder. Each entry is
// { gameId, game, file: RemoteFile, serial }. Empty when there is no such server.
export async function listServerGames() {
  let list;
  try {
    const res = await fetch(new URL("index.json", GAMES_URL), { cache: "no-store" });
    if (!res.ok) return [];
    list = await res.json();
  } catch { return []; }
  const out = [], used = new Set();
  for (const { name, size, mtime } of list) {
    const ext = extOf(name);
    if (!EXTENSIONS.includes(ext)) continue;
    const file = new RemoteFile(new URL(encodeURIComponent(name), GAMES_URL).href, name, size);
    const key = `${name}|${size}|${mtime}`;
    if (!serialMemo.has(key)) serialMemo.set(key, await detectSerial(file).catch(() => null));
    const serial = serialMemo.get(key);
    let game = findBySerial(serial);
    if (!game || used.has(game.id)) { // unknown disc (or a second copy): own entry titled from the file name
      const title = name.slice(0, name.length - ext.length).replace(/[_.]+/g, " ").trim() || name;
      game = customGame(`server-${name}`, { title, originalName: name, serial });
      game.description = `Disponível na pasta games/ do servidor: ${name}${serial ? ` (disco ${serial})` : ""}.`;
    }
    used.add(game.id);
    out.push({ gameId: game.id, game, file, serial });
  }
  return out;
}

// ---------------------------------------------------------------- box art
// Original front covers for the catalog (public/covers/<id>.jpg, 512x736, from
// the xlenore/ps2-covers set PCSX2 uses). Loaded once; render* stay synchronous.
const coverImages = new Map(); // id -> decoded HTMLImageElement
let coversPromise = null;

export function preloadCovers() {
  coversPromise ??= Promise.all(GAMES.map(async (g) => {
    const img = new Image();
    img.src = new URL(`../covers/${g.id}.jpg`, import.meta.url).href;
    try { await img.decode(); coverImages.set(g.id, img); } catch { /* no cover: procedural art */ }
  }));
  return coversPromise;
}

// Draws img over (x, y, w, h) like CSS object-fit: cover.
function drawCover(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

// ---------------------------------------------------------------- procedural art
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.round(w);
  c.height = Math.round(h);
  return c;
}

function linear(ctx, x0, y0, x1, y1, stops) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

function radial(ctx, x, y, r0, r1, stops) {
  const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
  stops.forEach(([o, c]) => g.addColorStop(o, c));
  return g;
}

function glowDot(ctx, x, y, r, color, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = radial(ctx, x, y, 0, r, [[0, color], [0.25, color], [1, "rgba(0,0,0,0)"]]);
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

function blob(ctx, cx, cy, rad, r, points = 8) {
  const pts = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2;
    const rr = rad * (0.55 + r() * 0.7);
    pts.push([cx + Math.cos(a) * rr * 1.4, cy + Math.sin(a) * rr]);
  }
  ctx.beginPath();
  const mid = (i) => { const p = pts[i % points], q = pts[(i + 1) % points]; return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; };
  ctx.moveTo(...mid(0));
  for (let i = 1; i <= points; i++) ctx.quadraticCurveTo(...pts[i % points], ...mid(i));
  ctx.fill();
}

function palm(ctx, x, y, h, lean, r) {
  const tx = x + h * lean, ty = y - h;
  ctx.lineCap = "round";
  ctx.lineWidth = h * 0.035;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + h * lean * 0.1, y - h * 0.6, tx, ty);
  ctx.stroke();
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (i / 8 - 0.5) * Math.PI * 1.9 + (r() - 0.5) * 0.2;
    const len = h * (0.32 + r() * 0.12);
    const ex = tx + Math.cos(a) * len, ey = ty + Math.sin(a) * len * 0.55 + len * 0.35;
    ctx.lineWidth = h * 0.028;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(tx + Math.cos(a) * len * 0.6, ty + Math.sin(a) * len * 0.6 - len * 0.15, ex, ey);
    ctx.stroke();
  }
}

function branch(ctx, x, y, len, angle, width, depth, r) {
  const x2 = x + Math.cos(angle) * len, y2 = y + Math.sin(angle) * len;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  if (depth <= 0) return;
  const n = 2 + (r() < 0.3 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    branch(ctx, x2, y2, len * (0.62 + r() * 0.18), angle + (r() - 0.5) * 1.3, width * 0.66, depth - 1, r);
  }
}

function heartPath(ctx, cx, cy, s) {
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.55);
  ctx.bezierCurveTo(cx - s * 0.9, cy - s * 0.05, cx - s * 0.55, cy - s * 0.75, cx, cy - s * 0.32);
  ctx.bezierCurveTo(cx + s * 0.55, cy - s * 0.75, cx + s * 0.9, cy - s * 0.05, cx, cy + s * 0.55);
  ctx.closePath();
}

// Each motif paints the whole w x h rect; covers are portrait, disc labels square.
const MOTIFS = {
  sunset(ctx, w, h, p, r) {
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, p.bg[0]], [0.45, "#b8327a"], [0.68, p.bg[1]], [0.75, "#ffb347"]]);
    ctx.fillRect(0, 0, w, h);
    // striped sun on its own layer so the stripes cut through to the sky
    const sun = canvas(w, h), s = sun.getContext("2d");
    const cx = w * 0.5, cy = h * 0.6, rad = Math.min(w, h) * 0.3;
    s.fillStyle = linear(s, 0, cy - rad, 0, cy + rad, [[0, "#fff1a8"], [0.5, p.accent], [1, "#ff4f6d"]]);
    s.beginPath(); s.arc(cx, cy, rad, 0, Math.PI * 2); s.fill();
    s.globalCompositeOperation = "destination-out";
    for (let i = 0; i < 7; i++) {
      const y = cy + rad * (0.05 + i * 0.14);
      s.fillRect(0, y, w, rad * (0.025 + i * 0.012));
    }
    ctx.drawImage(sun, 0, 0);
    glowDot(ctx, cx, cy, rad * 2.2, "rgba(255,190,120,0.35)");
    // skyline
    const base = h * 0.76;
    ctx.fillStyle = p.ink;
    for (let x = -5; x < w;) {
      const bw = w * (0.035 + r() * 0.07), bh = h * (0.03 + r() * (x > w * 0.3 && x < w * 0.7 ? 0.2 : 0.09));
      ctx.fillRect(x, base - bh, bw + 1, bh + 1);
      ctx.fillStyle = "rgba(255,210,140,0.55)";
      for (let k = 0; k < bh / 9; k++) if (r() < 0.35) ctx.fillRect(x + r() * (bw - 3), base - bh + 4 + r() * (bh - 6), 2, 2);
      ctx.fillStyle = p.ink;
      x += bw + w * 0.004;
    }
    ctx.fillRect(0, base, w, h - base);
    ctx.strokeStyle = p.ink;
    palm(ctx, w * 0.12, h * 0.98, h * 0.42, 0.18, r);
    palm(ctx, w * 0.9, h * 0.98, h * 0.34, -0.22, r);
    palm(ctx, w * 0.78, h * 0.98, h * 0.26, -0.05, r);
  },

  olympus(ctx, w, h, p, r) {
    ctx.fillStyle = radial(ctx, w * 0.5, h * 0.42, 0, Math.max(w, h) * 0.75, [[0, "#a3221a"], [0.35, p.bg[0]], [1, p.bg[1]]]);
    ctx.fillRect(0, 0, w, h);
    // chained blades: dashed arcs sweeping around the center
    ctx.save();
    ctx.lineCap = "round";
    for (const [rad, a0, a1, lw] of [[0.42, 3.6, 6.1, 0.012], [0.36, 0.3, 2.6, 0.01], [0.5, 4.2, 5.4, 0.008]]) {
      ctx.strokeStyle = "rgba(240,180,90,0.55)";
      ctx.lineWidth = w * lw;
      ctx.setLineDash([w * 0.028, w * 0.014]);
      ctx.beginPath(); ctx.arc(w * 0.5, h * 0.42, w * rad, a0, a1); ctx.stroke();
    }
    ctx.restore();
    // lightning bolt
    let pts = [[w * 0.62, 0], [w * 0.4, h * 0.85]];
    for (let pass = 0; pass < 6; pass++) {
      const next = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
        next.push(pts[i], [(ax + bx) / 2 + (r() - 0.5) * w * 0.16 / (pass + 1), (ay + by) / 2]);
      }
      next.push(pts[pts.length - 1]);
      pts = next;
    }
    ctx.save();
    ctx.shadowColor = "#ffd9a0"; ctx.shadowBlur = w * 0.05;
    ctx.strokeStyle = "rgba(255,240,215,0.9)"; ctx.lineWidth = w * 0.006; ctx.lineJoin = "round";
    ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    ctx.restore();
    // embers
    for (let i = 0; i < 90; i++) glowDot(ctx, r() * w, h * (0.3 + r() * 0.7), w * (0.004 + r() * 0.012), "rgba(255,150,60,0.9)", 0.4 + r() * 0.6);
    // greek key band
    const u = w * 0.06, y0 = h * 0.07;
    ctx.strokeStyle = p.accent; ctx.lineWidth = u * 0.12; ctx.globalAlpha = 0.85;
    for (let x = -u * 0.3; x < w; x += u) {
      ctx.beginPath();
      ctx.moveTo(x, y0 + u * 0.8); ctx.lineTo(x, y0); ctx.lineTo(x + u * 0.75, y0); ctx.lineTo(x + u * 0.75, y0 + u * 0.55);
      ctx.lineTo(x + u * 0.3, y0 + u * 0.55); ctx.lineTo(x + u * 0.3, y0 + u * 0.3); ctx.lineTo(x + u * 0.5, y0 + u * 0.3);
      ctx.moveTo(x, y0 + u * 0.8); ctx.lineTo(x + u, y0 + u * 0.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  colossus(ctx, w, h, p, r) {
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, "#e9ecec"], [0.5, p.bg[0]], [0.78, "#a59a88"], [1, p.bg[1]]]);
    ctx.fillRect(0, 0, w, h);
    // light shafts
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 6; i++) {
      const x = w * (-0.1 + i * 0.13 + r() * 0.05);
      ctx.fillStyle = `rgba(255,250,235,${0.05 + r() * 0.05})`;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + w * 0.06, 0); ctx.lineTo(x + w * 0.55, h); ctx.lineTo(x + w * 0.3, h); ctx.fill();
    }
    ctx.restore();
    // a standing giant, softened by haze
    ctx.save();
    ctx.filter = `blur(${Math.max(1, w * 0.005)}px)`;
    ctx.fillStyle = "rgba(52,50,52,0.86)";
    const gx = w * 0.6, top = h * 0.14, foot = h * 0.82, H = foot - top;
    ctx.beginPath(); ctx.ellipse(gx, top + H * 0.07, w * 0.05, H * 0.06, 0, 0, Math.PI * 2); ctx.fill(); // head
    const side = (k) => { // one half of an organic body silhouette, mirrored by k = ±1
      const X = (f) => gx + k * w * f, Y = (f) => top + H * f;
      ctx.lineTo(X(0.04), Y(0.12));
      ctx.bezierCurveTo(X(0.2), Y(0.1), X(0.3), Y(0.16), X(0.3), Y(0.3)); // shoulder hump
      ctx.bezierCurveTo(X(0.32), Y(0.45), X(0.3), Y(0.58), X(0.26), Y(0.64)); // arm
      ctx.lineTo(X(0.21), Y(0.62));
      ctx.bezierCurveTo(X(0.22), Y(0.5), X(0.2), Y(0.4), X(0.18), Y(0.36));
      ctx.bezierCurveTo(X(0.19), Y(0.5), X(0.2), Y(0.55), X(0.17), Y(0.6)); // hip
      ctx.bezierCurveTo(X(0.2), Y(0.75), X(0.18), Y(0.9), X(0.16), Y(1)); // leg
      ctx.lineTo(X(0.06), Y(1));
      ctx.bezierCurveTo(X(0.06), Y(0.85), X(0.05), Y(0.7), X(0.02), Y(0.6));
      ctx.lineTo(X(0), Y(0.6));
    };
    ctx.beginPath();
    ctx.moveTo(gx, top + H * 0.12);
    side(1);
    ctx.moveTo(gx, top + H * 0.12);
    side(-1);
    ctx.fill();
    ctx.strokeStyle = "rgba(52,50,52,0.7)"; ctx.lineWidth = Math.max(1, w * 0.004);
    for (let i = 0; i < 80; i++) { // fur along the shoulders
      const x = gx + (r() - 0.5) * w * 0.52, y = top + H * (0.14 + r() * 0.1);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (r() - 0.5) * w * 0.02, y - H * 0.03 - r() * H * 0.03); ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,250,220,0.5)"; // the glowing weak points
    ctx.beginPath(); ctx.arc(gx - w * 0.02, top + H * 0.02, w * 0.008, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // ground mist
    ctx.fillStyle = linear(ctx, 0, h * 0.62, 0, h, [[0, "rgba(235,232,225,0)"], [0.4, "rgba(225,220,210,0.75)"], [1, "rgba(120,110,95,0.9)"]]);
    ctx.fillRect(0, h * 0.62, w, h * 0.38);
    // tiny hero with the sword's beam
    const hx = w * 0.36, hy = h * 0.86;
    ctx.fillStyle = "#2b2725";
    ctx.fillRect(hx - w * 0.005, hy - h * 0.024, w * 0.01, h * 0.024);
    ctx.beginPath(); ctx.arc(hx, hy - h * 0.028, w * 0.006, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.shadowColor = "#fff"; ctx.shadowBlur = w * 0.03;
    ctx.strokeStyle = "rgba(255,255,250,0.95)"; ctx.lineWidth = w * 0.004;
    ctx.beginPath(); ctx.moveTo(hx + w * 0.006, hy - h * 0.03); ctx.lineTo(hx + w * 0.2, hy - h * 0.4); ctx.stroke();
    ctx.restore();
  },

  camo(ctx, w, h, p, r) {
    ctx.fillStyle = p.bg[0];
    ctx.fillRect(0, 0, w, h);
    for (const [color, n, size] of [["#55613a", 26, 0.12], ["#2a331c", 30, 0.1], ["#6d6a44", 18, 0.07], ["#171d10", 22, 0.06]]) {
      ctx.fillStyle = color;
      for (let i = 0; i < n; i++) blob(ctx, r() * w, r() * h, Math.min(w, h) * size * (0.5 + r()), r, 9);
    }
    ctx.fillStyle = radial(ctx, w * 0.5, h * 0.45, Math.min(w, h) * 0.2, Math.max(w, h) * 0.8, [[0, "rgba(0,0,0,0)"], [1, "rgba(5,8,3,0.85)"]]);
    ctx.fillRect(0, 0, w, h);
    // soliton-radar style rings
    const cx = w * 0.68, cy = h * 0.34, R = Math.min(w, h) * 0.3;
    ctx.strokeStyle = "rgba(199,211,111,0.45)"; ctx.lineWidth = Math.max(1, w * 0.003);
    for (let k = 1; k <= 4; k++) { ctx.beginPath(); ctx.arc(cx, cy, (R * k) / 4, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.fillStyle = "rgba(199,211,111,0.18)";
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, -1.9, -1.2); ctx.fill();
    glowDot(ctx, cx + R * 0.35, cy - R * 0.4, w * 0.03, "rgba(255,80,60,0.95)");
    // red bandana stripe
    ctx.fillStyle = "rgba(160,24,24,0.85)";
    ctx.save(); ctx.translate(0, h * 0.62); ctx.rotate(-0.12);
    ctx.fillRect(-w * 0.1, 0, w * 1.3, h * 0.018);
    ctx.restore();
  },

  ocean(ctx, w, h, p, r) {
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, "#050b24"], [0.35, p.bg[0]], [1, p.bg[1]]]);
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let j = 0; j < 26; j++) {
      const y0 = h * (0.3 + j * 0.028), amp = h * (0.006 + r() * 0.012), f = 2 + r() * 4, ph = r() * 6;
      ctx.strokeStyle = `rgba(158,240,255,${0.04 + r() * 0.12})`;
      ctx.lineWidth = Math.max(1, w * 0.002);
      ctx.beginPath();
      for (let x = 0; x <= w; x += w / 60) {
        const y = y0 + Math.sin((x / w) * f * Math.PI + ph) * amp;
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    // ripples
    const rx = w * 0.5, ry = h * 0.66;
    for (let k = 1; k < 7; k++) {
      ctx.strokeStyle = `rgba(200,250,255,${0.3 - k * 0.04})`;
      ctx.beginPath(); ctx.ellipse(rx, ry, w * 0.06 * k, h * 0.012 * k, 0, 0, Math.PI * 2); ctx.stroke();
    }
    // pyreflies
    for (let i = 0; i < 60; i++) {
      const hue = 170 + r() * 140;
      glowDot(ctx, r() * w, h * (0.05 + r() * 0.6), w * (0.008 + r() * 0.03), `hsla(${hue},90%,70%,0.9)`, 0.35 + r() * 0.65);
    }
    ctx.restore();
    // sphere glyph ring
    ctx.strokeStyle = "rgba(240,250,255,0.35)"; ctx.lineWidth = Math.max(1, w * 0.004);
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.3, Math.min(w, h) * 0.2, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.3, Math.min(w, h) * 0.16, 0, Math.PI * 2); ctx.stroke();
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2, R1 = Math.min(w, h) * 0.16, R2 = Math.min(w, h) * 0.2;
      ctx.beginPath(); ctx.moveTo(w * 0.5 + Math.cos(a) * R1, h * 0.3 + Math.sin(a) * R1); ctx.lineTo(w * 0.5 + Math.cos(a) * R2, h * 0.3 + Math.sin(a) * R2); ctx.stroke();
    }
  },

  racing(ctx, w, h, p, r) {
    ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, p.bg[0]], [1, p.bg[1]]]);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < (w * h) / 300; i++) {
      ctx.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
      ctx.fillRect(r() * w, r() * h, 1.5, 1.5);
    }
    // racing stripes
    ctx.fillStyle = p.accent;
    ctx.fillRect(w * 0.36, 0, w * 0.1, h);
    ctx.fillStyle = "#f4f6f8";
    ctx.fillRect(w * 0.5, 0, w * 0.1, h);
    // speed streaks
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < 40; i++) {
      const y = r() * h, x = r() * w, len = w * (0.1 + r() * 0.5);
      ctx.strokeStyle = `rgba(255,255,255,${0.04 + r() * 0.12})`;
      ctx.lineWidth = Math.max(1, r() * w * 0.004);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y - len * 0.25); ctx.stroke();
    }
    ctx.restore();
    // tachometer
    const cx = w * 0.5, cy = h * 0.4, R = Math.min(w, h) * 0.34;
    ctx.fillStyle = "rgba(8,9,12,0.88)";
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2); ctx.fill();
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    ctx.lineWidth = R * 0.05;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.92, a0, a1); ctx.stroke();
    ctx.strokeStyle = p.accent;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.92, a0 + (a1 - a0) * 0.78, a1); ctx.stroke();
    for (let k = 0; k <= 40; k++) {
      const a = a0 + ((a1 - a0) * k) / 40, big = k % 5 === 0;
      ctx.strokeStyle = k > 31 ? p.accent : "#e8ecf2";
      ctx.lineWidth = big ? R * 0.025 : R * 0.01;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R * (big ? 0.7 : 0.78), cy + Math.sin(a) * R * (big ? 0.7 : 0.78));
      ctx.lineTo(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86);
      ctx.stroke();
    }
    const na = a0 + (a1 - a0) * 0.86;
    ctx.save();
    ctx.shadowColor = p.accent; ctx.shadowBlur = R * 0.15;
    ctx.strokeStyle = p.accent; ctx.lineWidth = R * 0.03; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(cx - Math.cos(na) * R * 0.12, cy - Math.sin(na) * R * 0.12); ctx.lineTo(cx + Math.cos(na) * R * 0.8, cy + Math.sin(na) * R * 0.8); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#e8ecf2"; ctx.beginPath(); ctx.arc(cx, cy, R * 0.06, 0, Math.PI * 2); ctx.fill();
    // checker band
    const sq = w / 24, by = h * 0.72;
    for (let row = 0; row < 2; row++) for (let i = 0; i < 24; i++) {
      ctx.fillStyle = (i + row) % 2 ? "rgba(240,242,245,0.9)" : "rgba(10,10,12,0.9)";
      ctx.fillRect(i * sq, by + row * sq, sq + 0.5, sq + 0.5);
    }
  },

  hearts(ctx, w, h, p, r) {
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, "#03051a"], [0.5, p.bg[0]], [1, p.bg[1]]]);
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.2 + r() * 0.8})`;
      const s = r() < 0.92 ? 1 : 2;
      ctx.fillRect(r() * w, r() * h * 0.75, s * Math.max(1, w / 512), s * Math.max(1, w / 512));
    }
    glowDot(ctx, w * 0.78, h * 0.14, w * 0.3, "rgba(255,240,200,0.25)");
    ctx.fillStyle = "#fff6dc";
    ctx.beginPath(); ctx.arc(w * 0.78, h * 0.14, w * 0.09, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = p.bg[0];
    ctx.beginPath(); ctx.arc(w * 0.74, h * 0.125, w * 0.085, 0, Math.PI * 2); ctx.fill();
    // stained-glass disc rising from the bottom
    const sx = w * 0.5, sy = h * 1.02, SR = w * 0.62;
    const colors = ["#f2c14e", "#5fa8d3", "#e76f51", "#8ac926", "#c77dff", "#ffd6a5", "#4cc9f0", "#f15bb5"];
    ctx.save();
    ctx.globalAlpha = 0.7;
    for (let ring = 0; ring < 3; ring++) {
      const n = 10 + ring * 6;
      for (let k = 0; k < n; k++) {
        ctx.fillStyle = colors[Math.floor(r() * colors.length)];
        ctx.beginPath();
        ctx.arc(sx, sy, SR * (1 - ring * 0.28), Math.PI + (k / n) * Math.PI, Math.PI + ((k + 1) / n) * Math.PI);
        ctx.arc(sx, sy, SR * (0.72 - ring * 0.28), Math.PI + ((k + 1) / n) * Math.PI, Math.PI + (k / n) * Math.PI, true);
        ctx.closePath(); ctx.fill();
        ctx.strokeStyle = "#0a0a14"; ctx.lineWidth = Math.max(1, w * 0.006); ctx.stroke();
      }
    }
    ctx.restore();
    // glowing heart
    ctx.save();
    heartPath(ctx, w * 0.5, h * 0.42, Math.min(w, h) * 0.32);
    ctx.fillStyle = "rgba(255,215,106,0.08)"; ctx.fill();
    ctx.shadowColor = p.accent; ctx.shadowBlur = w * 0.06;
    ctx.strokeStyle = p.accent; ctx.lineWidth = w * 0.012; ctx.stroke();
    ctx.restore();
  },

  village(ctx, w, h, p, r) {
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, "#1a1310"], [0.55, p.bg[0]], [0.8, "#6b5238"], [1, p.bg[1]]]);
    ctx.fillRect(0, 0, w, h);
    glowDot(ctx, w * 0.3, h * 0.3, w * 0.6, "rgba(230,190,140,0.18)");
    // bare trees
    ctx.strokeStyle = "rgba(14,9,6,0.92)"; ctx.lineCap = "round";
    for (const [x, s] of [[0.08, 1], [0.86, 0.9], [0.66, 0.6], [0.25, 0.55]]) {
      branch(ctx, w * x, h * 0.86, h * 0.13 * s, -Math.PI / 2 + (r() - 0.5) * 0.2, w * 0.025 * s, 6, r);
    }
    // houses
    ctx.fillStyle = "#0d0907";
    for (let i = 0; i < 6; i++) {
      const x = w * (0.1 + i * 0.15 + r() * 0.04), bw = w * (0.08 + r() * 0.05), bh = h * (0.04 + r() * 0.04), base = h * 0.84;
      ctx.beginPath();
      ctx.moveTo(x, base); ctx.lineTo(x, base - bh); ctx.lineTo(x + bw / 2, base - bh - bw * 0.45); ctx.lineTo(x + bw, base - bh); ctx.lineTo(x + bw, base);
      ctx.fill();
      if (r() < 0.6) { ctx.fillStyle = "rgba(255,170,80,0.7)"; ctx.fillRect(x + bw * 0.4, base - bh * 0.7, bw * 0.15, bh * 0.25); ctx.fillStyle = "#0d0907"; }
    }
    ctx.fillRect(0, h * 0.84, w, h * 0.16);
    // fog
    ctx.fillStyle = linear(ctx, 0, h * 0.6, 0, h * 0.95, [[0, "rgba(170,140,110,0)"], [0.6, "rgba(150,120,95,0.35)"], [1, "rgba(30,20,15,0.4)"]]);
    ctx.fillRect(0, h * 0.6, w, h * 0.4);
    // laser sight
    const tx = w * 0.62, ty = h * 0.36;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(255,40,40,0.55)"; ctx.lineWidth = Math.max(1, w * 0.003);
    ctx.beginPath(); ctx.moveTo(0, h * 0.95); ctx.lineTo(tx, ty); ctx.stroke();
    glowDot(ctx, tx, ty, w * 0.06, "rgba(255,30,30,1)");
    ctx.restore();
    // splatter
    ctx.fillStyle = "rgba(150,10,10,0.85)";
    for (let i = 0; i < 40; i++) {
      const a = r() * Math.PI * 2, d = r() ** 2 * w * 0.22;
      ctx.beginPath(); ctx.arc(w * 0.18 + Math.cos(a) * d, h * 0.18 + Math.sin(a) * d, w * (0.003 + r() * 0.018) * (1 - d / (w * 0.3)), 0, Math.PI * 2); ctx.fill();
    }
  },

  custom(ctx, w, h, p, r) {
    ctx.fillStyle = linear(ctx, 0, 0, w, h, [[0, p.bg[0]], [1, p.bg[1]]]);
    ctx.fillRect(0, 0, w, h);
    const cx = w * (0.3 + r() * 0.4), cy = h * (0.25 + r() * 0.2);
    ctx.strokeStyle = p.accent; ctx.lineWidth = Math.max(1, w * 0.004);
    for (let k = 1; k < 14; k++) {
      ctx.globalAlpha = 0.5 - k * 0.03;
      ctx.beginPath(); ctx.arc(cx, cy, k * Math.min(w, h) * 0.05, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 0.12;
    for (let i = -h; i < w; i += w * 0.04) { ctx.beginPath(); ctx.moveTo(i, h); ctx.lineTo(i + h, 0); ctx.stroke(); }
    ctx.globalAlpha = 1;
  },
};

function grain(ctx, w, h, amount, r) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const n = (r() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

// Catalog game, or a custom entry ({ id, title, custom: true }) — fills art defaults.
function artOf(game) {
  if (game.art && game.palette) return { art: game.art, palette: game.palette };
  const hue = hashStr(game.id + game.title) % 360;
  return {
    palette: { bg: [`hsl(${hue},45%,22%)`, `hsl(${(hue + 50) % 360},55%,8%)`], accent: `hsl(${(hue + 180) % 360},80%,70%)`, ink: "#08080c", text: "#f5f5f7" },
    art: { motif: "custom", big: game.title, font: "800 {s}px 'Helvetica Neue', Arial, sans-serif", spacing: 0.02, tagline: "Disco do jogador" },
  };
}

// Shrinks the font until `text` fits in maxW. Returns the font size used.
function fitText(ctx, text, maxW, size, fontTpl, spacing = 0) {
  let s = size;
  for (;;) {
    ctx.font = fontTpl.replace("{s}", s.toFixed(1));
    ctx.letterSpacing = `${(s * spacing).toFixed(1)}px`;
    if (ctx.measureText(text).width <= maxW || s < 8) return s;
    s *= 0.94;
  }
}

function wrapTitle(ctx, text, maxW, size, fontTpl, spacing) {
  const words = text.split(" ");
  if (words.length > 1) {
    ctx.font = fontTpl.replace("{s}", size);
    ctx.letterSpacing = `${size * spacing}px`;
    if (ctx.measureText(text).width > maxW * 1.25) {
      const half = Math.ceil(words.length / 2);
      return [words.slice(0, half).join(" "), words.slice(half).join(" ")];
    }
  }
  return [text];
}

const COVER_ASPECT = 190 / 135;

export function renderCover(game, { width = 512 } = {}) {
  const w = width, h = Math.round(width * COVER_ASPECT);
  const c = canvas(w, h), ctx = c.getContext("2d", { willReadFrequently: true });
  const img = coverImages.get(game.id);
  if (img) {
    ctx.imageSmoothingQuality = "high";
    drawCover(ctx, img, 0, 0, w, h);
    return c;
  }
  const { art, palette: p } = artOf(game);
  const r = rng(hashStr(game.id));
  MOTIFS[art.motif](ctx, w, h, p, r);

  // legibility gradient behind the title block
  ctx.fillStyle = linear(ctx, 0, h * 0.55, 0, h, [[0, "rgba(0,0,0,0)"], [0.55, "rgba(0,0,0,0.55)"], [1, "rgba(0,0,0,0.85)"]]);
  ctx.fillRect(0, h * 0.55, w, h * 0.45);

  // top band: collection number + genre (no publisher/platform marks)
  const bandH = Math.round(h * 0.062);
  ctx.fillStyle = "rgba(6,6,9,0.92)";
  ctx.fillRect(0, 0, w, bandH);
  ctx.fillStyle = p.accent;
  ctx.fillRect(0, bandH, w, Math.max(1, h * 0.004));
  const pos = GAMES.findIndex((g) => g.id === game.id);
  const num = pos === -1 ? "EXTRA" : `Nº ${String(pos + 1).padStart(2, "0")}`;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#e9e9ee";
  ctx.font = `700 ${Math.round(bandH * 0.36)}px 'Helvetica Neue', Arial, sans-serif`;
  ctx.letterSpacing = `${bandH * 0.08}px`;
  ctx.textAlign = "left";
  ctx.fillText(game.year ? `${num}  ·  ${game.year}` : num, w * 0.05, bandH / 2);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(233,233,238,0.7)";
  ctx.fillText(String(game.genre || "Jogo").split("·")[0].trim().toUpperCase(), w * 0.95, bandH / 2);

  // title block
  const pad = w * 0.07, maxW = w - pad * 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = p.text;
  ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = w * 0.02; ctx.shadowOffsetY = w * 0.004;
  const spacing = art.spacing ?? 0;
  const big = art.big.toUpperCase();
  const lines = wrapTitle(ctx, big, maxW, w * 0.16, art.font, spacing);
  const sizes = lines.map((l) => fitText(ctx, l, maxW, big.length <= 2 ? w * 0.42 : w * 0.16, art.font, spacing));
  const size = Math.min(...sizes);
  let y = h - pad * 1.25 - w * 0.05;
  ctx.font = `500 ${Math.round(w * 0.032)}px 'Helvetica Neue', Arial, sans-serif`;
  ctx.letterSpacing = `${w * 0.006}px`;
  ctx.fillStyle = "rgba(255,255,255,0.72)";
  ctx.fillText(art.tagline.toUpperCase(), pad, y + w * 0.05);
  ctx.fillStyle = p.text;
  ctx.font = art.font.replace("{s}", size.toFixed(1));
  ctx.letterSpacing = `${(size * spacing).toFixed(1)}px`;
  for (let i = lines.length - 1; i >= 0; i--) {
    ctx.fillText(lines[i], pad, y);
    y -= size * 0.95;
  }
  if (art.kicker) {
    const ks = fitText(ctx, art.kicker.toUpperCase(), maxW, w * 0.055, "600 {s}px 'Helvetica Neue', Arial, sans-serif", 0.25);
    ctx.fillStyle = p.accent;
    ctx.fillText(art.kicker.toUpperCase(), pad, y + size * 0.95 - size * 0.8 - ks * 0.5);
  }
  // accent rule
  ctx.shadowColor = "transparent";
  ctx.fillStyle = p.accent;
  ctx.fillRect(pad, h - pad * 0.7, w * 0.12, Math.max(2, w * 0.006));

  ctx.letterSpacing = "0px";
  grain(ctx, w, h, 14, rng(7));
  return c;
}

function arcText(ctx, text, cx, cy, radius, centerAngle) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const total = widths.reduce((a, b) => a + b, 0) / radius;
  let a = centerAngle + total / 2; // bottom arc: text runs right-to-left in angle
  [...text].forEach((ch, i) => {
    const step = widths[i] / radius;
    const mid = a - step / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(mid) * radius, cy + Math.sin(mid) * radius);
    ctx.rotate(mid - Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a -= step;
  });
}

// Clear plastic hub (partly see-through) + stacking rings + center hole.
function discHub(ctx, S) {
  const R = S / 2;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.beginPath(); ctx.arc(R, R, R * 0.27, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = radial(ctx, R, R, R * 0.07, R * 0.27, [[0, "rgba(150,160,175,0.55)"], [0.7, "rgba(90,98,110,0.45)"], [1, "rgba(200,208,218,0.6)"]]);
  ctx.beginPath(); ctx.arc(R, R, R * 0.27, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = S * 0.002;
  for (const k of [0.27, 0.2, 0.17, 0.1]) { ctx.beginPath(); ctx.arc(R, R, R * k, 0, Math.PI * 2); ctx.stroke(); }
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath(); ctx.arc(R, R, R * 0.075, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

export function renderDiscLabel(game, size = 1024) {
  const S = size, R = S / 2, c = canvas(S, S), ctx = c.getContext("2d", { willReadFrequently: true });
  const { art, palette: p } = artOf(game);
  const img = coverImages.get(game.id);
  if (img) return coverDiscLabel(game, img, S, p);
  const r = rng(hashStr(game.id) ^ 0x9e3779b9);

  ctx.save();
  ctx.beginPath(); ctx.arc(R, R, R * 0.995, 0, Math.PI * 2); ctx.clip();
  MOTIFS[art.motif](ctx, S, S, p, r);
  ctx.filter = "none"; ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.setLineDash([]);
  ctx.fillStyle = radial(ctx, R, R, R * 0.2, R, [[0, "rgba(0,0,0,0.35)"], [0.6, "rgba(0,0,0,0.05)"], [0.85, "rgba(0,0,0,0.35)"], [1, "rgba(0,0,0,0.7)"]]);
  ctx.fillRect(0, 0, S, S);

  // title across the upper half
  const big = art.big.toUpperCase();
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  ctx.shadowColor = "rgba(0,0,0,0.7)"; ctx.shadowBlur = S * 0.015;
  const spacing = art.spacing ?? 0;
  const ts = fitText(ctx, big, R * 1.3, big.length <= 2 ? S * 0.2 : S * 0.1, art.font, spacing);
  ctx.fillStyle = p.text;
  ctx.fillText(big, R + (ts * spacing) / 2, R - R * 0.36);
  if (art.kicker) {
    fitText(ctx, art.kicker.toUpperCase(), R * 1.1, S * 0.032, "600 {s}px 'Helvetica Neue', Arial, sans-serif", 0.25);
    ctx.fillStyle = p.accent;
    ctx.fillText(art.kicker.toUpperCase(), R, R - R * 0.36 - ts * 0.95);
  }
  // rim text
  ctx.shadowBlur = S * 0.006;
  ctx.font = `600 ${Math.round(S * 0.022)}px 'Helvetica Neue', Arial, sans-serif`;
  ctx.letterSpacing = `${S * 0.004}px`;
  ctx.fillStyle = "rgba(255,255,255,0.82)";
  const serial = game.serials?.[0] ?? "CÓPIA DO JOGADOR";
  arcText(ctx, `${game.title.toUpperCase()}  ·  ${game.year || ""}  ·  ${serial}  ·  DISCO 1`, R, R, R * 0.86, Math.PI / 2);
  ctx.letterSpacing = "0px";
  ctx.shadowColor = "transparent";
  // thin outer rings
  ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.lineWidth = S * 0.002;
  ctx.beginPath(); ctx.arc(R, R, R * 0.93, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = p.accent; ctx.lineWidth = S * 0.004;
  ctx.beginPath(); ctx.arc(R, R, R * 0.975, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  grain(ctx, S, S, 10, rng(11));

  discHub(ctx, S);
  return c;
}

// PS2 DVD-style label: the cover art printed on the disc, a black rim band with
// the title/serial running around it, then the clear hub and center hole.
function coverDiscLabel(game, img, S, p) {
  const R = S / 2, c = canvas(S, S), ctx = c.getContext("2d");
  ctx.save();
  ctx.beginPath(); ctx.arc(R, R, R * 0.995, 0, Math.PI * 2); ctx.clip();
  ctx.imageSmoothingQuality = "high";
  // art spans the printable area (inside the rim band), centered on the disc
  const art = R * 0.9;
  drawCover(ctx, img, R - art, R - art, art * 2, art * 2);
  // printed ink gets a soft vignette towards the band
  ctx.fillStyle = radial(ctx, R, R, R * 0.55, R * 0.9, [[0, "rgba(0,0,0,0)"], [1, "rgba(0,0,0,0.45)"]]);
  ctx.fillRect(0, 0, S, S);
  // rim band
  ctx.fillStyle = "#0b0c10";
  ctx.beginPath(); ctx.arc(R, R, R, 0, Math.PI * 2); ctx.arc(R, R, R * 0.9, 0, Math.PI * 2, true); ctx.fill();
  ctx.strokeStyle = p.accent; ctx.lineWidth = S * 0.003;
  ctx.beginPath(); ctx.arc(R, R, R * 0.9, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(S * 0.026)}px 'Helvetica Neue', Arial, sans-serif`;
  ctx.letterSpacing = `${S * 0.005}px`;
  arcText(ctx, game.title.toUpperCase(), R, R, R * 0.95, Math.PI / 2);
  ctx.font = `600 ${Math.round(S * 0.02)}px 'Helvetica Neue', Arial, sans-serif`;
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  arcTextTop(ctx, `${game.serials?.[0] ?? ""}  ·  DVD-ROM  ·  DISCO 1`, R, R, R * 0.95);
  ctx.letterSpacing = "0px";
  ctx.restore();
  discHub(ctx, S);
  return c;
}

// Text along the top arc, reading left to right (arcText handles the bottom).
function arcTextTop(ctx, text, cx, cy, radius) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  let a = -Math.PI / 2 - widths.reduce((x, y) => x + y, 0) / radius / 2;
  [...text].forEach((ch, i) => {
    const step = widths[i] / radius, mid = a + step / 2;
    ctx.save();
    ctx.translate(cx + Math.cos(mid) * radius, cy + Math.sin(mid) * radius);
    ctx.rotate(mid + Math.PI / 2);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    a += step;
  });
}

// ---------------------------------------------------------------- UI
const STYLE = `
.ps2l{--bg:#07080c;--fg:#eef0f6;--muted:#9aa1b2;--line:rgba(255,255,255,.1);--accent:#5aa9ff;--ok:#5fe0a1;--warn:#ffb454;--danger:#ff6b6b;
  --cw:clamp(128px,22vw,240px);--ch:calc(var(--cw)*1.407);
  position:absolute;inset:0;display:grid;grid-template-rows:auto minmax(0,1fr) auto;color:var(--fg);
  font:15px/1.45 'Inter','Segoe UI',Roboto,'Helvetica Neue','Adwaita Sans','Noto Sans','DejaVu Sans',Arial,sans-serif;overflow-x:hidden;overflow-y:auto;
  background:radial-gradient(120% 70% at 50% 110%,rgba(90,169,255,.12),transparent 60%),linear-gradient(180deg,rgba(7,8,12,.55),rgba(7,8,12,.85));}
.ps2l[hidden]{display:none}
.ps2l *{box-sizing:border-box}
.ps2l button{font:inherit;color:inherit}
.ps2l :focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.ps2l-head{display:flex;align-items:flex-end;gap:16px;flex-wrap:wrap;padding:24px clamp(16px,4vw,48px) 0}
.ps2l-kicker{margin:0;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--accent);font-weight:600}
.ps2l-h{margin:2px 0 0;font-size:clamp(24px,3.4vw,34px);font-weight:700;letter-spacing:-.01em}
.ps2l-count{margin:0 0 4px;color:var(--muted);font-size:14px;flex:1;min-width:140px}
.ps2l-stage{position:relative;overflow-x:clip;min-height:calc(var(--ch) + 90px);perspective:1100px;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.ps2l-shelf{position:absolute;left:0;right:0;top:50%;height:2px;margin-top:calc(var(--ch)/2 + 10px);
  background:linear-gradient(90deg,transparent,rgba(255,255,255,.18) 20%,rgba(255,255,255,.18) 80%,transparent);box-shadow:0 0 30px 6px rgba(90,169,255,.08)}
.ps2l-card{position:absolute;left:50%;top:50%;width:var(--cw);height:var(--ch);padding:0;border:0;background:none;cursor:pointer;
  transform:translate(-50%,-50%) translateX(calc(var(--x)*var(--cw))) translateZ(calc(var(--z)*1px)) rotateY(calc(var(--ry)*1deg));
  transition:transform .55s cubic-bezier(.2,.8,.2,1),opacity .4s,filter .4s;transform-style:preserve-3d;
  -webkit-box-reflect:below 14px linear-gradient(transparent 72%,rgba(255,255,255,.14))}
.ps2l-card[data-sel]{transform:translate(-50%,-50%) translateY(-16px) translateZ(80px) rotateY(-7deg) rotateX(3deg)}
.ps2l-card[data-far]{opacity:0;pointer-events:none}
.ps2l-case{position:absolute;inset:0;border-radius:3px 7px 7px 3px;overflow:hidden;background:#111;
  box-shadow:0 30px 50px -18px rgba(0,0,0,.9),0 0 0 1px rgba(255,255,255,.08) inset;transition:box-shadow .4s}
.ps2l-case canvas{position:absolute;inset:0 0 0 7%;width:93%;height:100%;display:block}
.ps2l-case::before{content:"";position:absolute;inset:0 auto 0 0;width:7%;background:linear-gradient(90deg,#050506,#22242a 45%,#0b0b0d);
  box-shadow:inset -1px 0 0 rgba(255,255,255,.12)}
.ps2l-case::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,rgba(255,255,255,.18),rgba(255,255,255,0) 28%,rgba(255,255,255,0) 62%,rgba(255,255,255,.07) 80%,rgba(255,255,255,0));pointer-events:none}
.ps2l-card:not([data-owned]) .ps2l-case canvas{filter:saturate(.35) brightness(.55)}
.ps2l-card:not([data-owned])[data-sel] .ps2l-case canvas{filter:saturate(.6) brightness(.75)}
.ps2l-card[data-sel] .ps2l-case{box-shadow:0 40px 60px -20px rgba(0,0,0,.95),0 0 0 1px rgba(255,255,255,.14) inset,0 0 60px -10px var(--glow,rgba(90,169,255,.5))}
.ps2l-card:focus-visible{outline:none}
.ps2l-card:focus-visible .ps2l-case{outline:3px solid var(--accent);outline-offset:4px}
.ps2l-tag:empty{display:none}
.ps2l-tag{position:absolute;left:50%;bottom:-11px;translate:-50% 0;white-space:nowrap;padding:3px 8px;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  background:rgba(8,10,14,.86);border:1px solid var(--line)}
.ps2l-card[data-owned] .ps2l-tag{color:var(--ok);border-color:rgba(95,224,161,.45)}
.ps2l-card:not([data-owned]) .ps2l-tag{color:var(--muted)}
.ps2l-nav{position:absolute;top:50%;transform:translateY(-50%);z-index:5;width:44px;height:44px;border-radius:50%;border:1px solid var(--line);
  background:rgba(12,14,20,.7);cursor:pointer;display:grid;place-items:center;backdrop-filter:blur(6px)}
.ps2l-nav:hover{background:rgba(30,34,46,.9)}
.ps2l-nav[data-dir="-1"]{left:clamp(8px,3vw,40px)}.ps2l-nav[data-dir="1"]{right:clamp(8px,3vw,40px)}
.ps2l-nav svg{width:18px;height:18px}
.ps2l-info{margin:0 auto;width:100%;max-width:820px;padding:8px clamp(16px,4vw,48px) 28px;display:grid;gap:6px;text-align:center;justify-items:center}
.ps2l-meta{margin:0;color:var(--muted);font-size:13px;letter-spacing:.08em;text-transform:uppercase}
.ps2l-title{margin:0;font-size:clamp(22px,3vw,32px);line-height:1.15;font-weight:700;letter-spacing:-.01em;text-wrap:balance}
.ps2l-status{margin:2px 0 0;display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
.ps2l-status::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor;box-shadow:0 0 10px currentColor}
.ps2l-status[data-owned]{color:var(--ok)}.ps2l-status:not([data-owned]){color:var(--warn)}
.ps2l-desc{margin:4px 0 6px;color:#c6cad6;max-width:62ch;text-wrap:pretty}
.ps2l-actions{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.ps2l-btn{min-height:44px;padding:0 22px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.06);cursor:pointer;font-weight:600;letter-spacing:.02em;transition:background .2s,border-color .2s,transform .2s}
.ps2l-btn:hover{background:rgba(255,255,255,.12)}
.ps2l-btn:active{transform:translateY(1px)}
.ps2l-btn:disabled{opacity:.45;cursor:not-allowed}
.ps2l-primary{background:var(--accent);border-color:transparent;color:#03101f !important;box-shadow:0 8px 30px -8px rgba(90,169,255,.7)}
.ps2l-primary:hover{background:#7dbcff}
.ps2l-danger[data-confirm]{background:rgba(255,107,107,.18);border-color:rgba(255,107,107,.6);color:#ffd2d2}
.ps2l-progress{width:min(100%,460px);display:grid;grid-template-columns:1fr auto;gap:6px 12px;align-items:center;font-size:13px;color:var(--muted)}
.ps2l-progress[hidden]{display:none}
.ps2l-progress progress{grid-column:1/-1;width:100%;height:6px;appearance:none;-webkit-appearance:none;border:0;border-radius:999px;background:rgba(255,255,255,.1);overflow:hidden}
.ps2l-progress progress::-webkit-progress-bar{background:rgba(255,255,255,.1)}
.ps2l-progress progress::-webkit-progress-value{background:linear-gradient(90deg,#3d8bff,#7fd1ff);border-radius:999px}
.ps2l-progress progress::-moz-progress-bar{background:linear-gradient(90deg,#3d8bff,#7fd1ff)}
.ps2l-progress .ps2l-btn{min-height:32px;padding:0 14px;font-size:13px}
.ps2l-msg{margin:0;min-height:1.4em;font-size:14px}
.ps2l-msg[data-kind="error"]{color:var(--danger)}.ps2l-msg[data-kind="ok"]{color:var(--ok)}
.ps2l-hint{margin:0;color:var(--muted);font-size:12px}
.ps2l-drop{position:absolute;inset:12px;z-index:20;border:2px dashed rgba(90,169,255,.7);border-radius:20px;display:grid;place-items:center;
  background:rgba(5,10,20,.82);font-size:clamp(18px,3vw,26px);font-weight:600;pointer-events:none;text-align:center;padding:16px}
.ps2l-drop[hidden]{display:none}
.ps2l-dialog{max-width:min(520px,calc(100vw - 32px));width:100%;border:1px solid var(--line);border-radius:18px;padding:0;background:#0e1016;color:var(--fg);
  box-shadow:0 30px 80px rgba(0,0,0,.7);font:15px/1.45 'Inter','Segoe UI',Roboto,'Helvetica Neue','Adwaita Sans','Noto Sans','DejaVu Sans',Arial,sans-serif}
.ps2l-dialog::backdrop{background:rgba(0,0,0,.65);backdrop-filter:blur(3px)}
.ps2l-dialog form{padding:22px;display:grid;gap:14px}
.ps2l-dialog h2{margin:0;font-size:20px}
.ps2l-dialog p{margin:0;color:var(--muted);font-size:14px}
.ps2l-choices{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;max-height:min(50vh,360px);overflow:auto;padding:4px}
.ps2l-choice{min-height:44px;padding:8px 12px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.04);cursor:pointer;text-align:left;font-size:14px;color:var(--fg)}
.ps2l-choice:hover{background:rgba(90,169,255,.14);border-color:rgba(90,169,255,.5)}
.ps2l-dialog .ps2l-row{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.ps2l-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@keyframes ps2l-float{50%{translate:0 -6px}}
/* plays when a card gets selected, then rests: an endless loop kept the compositor busy on an idle shelf */
.ps2l-card[data-sel] .ps2l-case{animation:ps2l-float 5s ease-in-out 2}
@media (max-width:600px){
  .ps2l{--cw:clamp(118px,40vw,170px)}
  .ps2l-head{padding-top:16px;gap:8px}
  .ps2l-nav{display:none}
  .ps2l-hint{display:none}
}
@media (prefers-reduced-motion:reduce){
  .ps2l *,.ps2l *::before,.ps2l *::after{transition:none !important;animation:none !important}
}`;

const ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;

function customGame(id, entry) {
  return { id, title: entry.title || entry.originalName || "Jogo importado", year: "", genre: "Importado", custom: true, serials: entry.serial ? [entry.serial] : [],
    description: `Jogo adicionado por você a partir do arquivo ${entry.originalName || entry.fileName}${entry.serial ? ` (disco ${entry.serial})` : ""}.` };
}

export function createLibraryUI(container, { onPlay, onSettings } = {}) {
  if (!document.getElementById("ps2l-style")) {
    const st = document.createElement("style");
    st.id = "ps2l-style";
    st.textContent = STYLE;
    document.head.append(st);
  }
  const root = document.createElement("section");
  root.className = "ps2l";
  root.setAttribute("aria-label", "Biblioteca de jogos");
  root.innerHTML = `
    <header class="ps2l-head">
      <div><p class="ps2l-kicker">Biblioteca</p><h1 class="ps2l-h">Seus jogos</h1></div>
      <p class="ps2l-count"></p>
      <p class="ps2l-hint">Jogos da pasta games/ aparecem sozinhos · ou arraste um .iso, .cso, .chd ou .bin para cá</p>
      <button type="button" class="ps2l-btn" data-act="import-any">Importar arquivo</button>
      ${onSettings ? `<button type="button" class="ps2l-btn" data-act="settings" aria-haspopup="dialog">Configurações</button>` : ""}
    </header>
    <div class="ps2l-stage" role="group" aria-roledescription="carrossel" aria-label="Estante de jogos. Use as setas para navegar.">
      <div class="ps2l-shelf" aria-hidden="true"></div>
      <button type="button" class="ps2l-nav" data-dir="-1" aria-label="Jogo anterior">${ICON("M15 18l-6-6 6-6")}</button>
      <button type="button" class="ps2l-nav" data-dir="1" aria-label="Próximo jogo">${ICON("M9 6l6 6-6 6")}</button>
    </div>
    <div class="ps2l-info">
      <p class="ps2l-meta"></p>
      <h2 class="ps2l-title"></h2>
      <p class="ps2l-status"></p>
      <p class="ps2l-desc"></p>
      <div class="ps2l-actions">
        <button type="button" class="ps2l-btn ps2l-primary" data-act="main"></button>
        <button type="button" class="ps2l-btn ps2l-danger" data-act="remove">Remover</button>
      </div>
      <div class="ps2l-progress" hidden>
        <progress max="1" value="0" aria-label="Progresso da importação"></progress>
        <span class="ps2l-ptext" aria-live="polite"></span>
        <button type="button" class="ps2l-btn" data-act="cancel">Cancelar</button>
      </div>
      <p class="ps2l-msg" role="status" aria-live="polite"></p>
    </div>
    <div class="ps2l-drop" hidden>Solte o arquivo do seu disco para importar</div>
    <dialog class="ps2l-dialog" aria-labelledby="ps2l-dlg-h">
      <form method="dialog">
        <h2 id="ps2l-dlg-h">Qual jogo é este?</h2>
        <p class="ps2l-dlg-p"></p>
        <div class="ps2l-choices"></div>
        <div class="ps2l-row">
          <button class="ps2l-btn" value="">Cancelar</button>
          <button class="ps2l-btn ps2l-primary" value="custom">Outro jogo</button>
        </div>
      </form>
    </dialog>
    <input type="file" hidden accept="${EXTENSIONS.join(",")}">`;
  container.append(root);

  const $ = (s) => root.querySelector(s);
  const stage = $(".ps2l-stage"), input = $("input[type=file]"), dialog = $(".ps2l-dialog");
  const mainBtn = $('[data-act="main"]'), removeBtn = $('[data-act="remove"]');
  const progress = $(".ps2l-progress"), bar = progress.querySelector("progress"), ptext = $(".ps2l-ptext"), msg = $(".ps2l-msg");

  let games = [], owned = new Map(), server = new Map(), sel = 0, busy = false, abort = null, pendingGameId = null, confirmTimer = 0;
  const cards = new Map(); // id -> button, covers rendered once
  const coverCache = new Map();

  dialog.querySelector(".ps2l-choices").innerHTML = GAMES.map((g) => `<button class="ps2l-choice" value="${g.id}">${g.title}</button>`).join("");

  const available = (id) => server.has(id) || owned.has(id);

  function say(text, kind = "") { msg.textContent = text; msg.dataset.kind = kind; }

  function cardFor(game) {
    let b = cards.get(game.id);
    if (!b) {
      b = document.createElement("button");
      b.type = "button";
      b.className = "ps2l-card";
      b.innerHTML = `<span class="ps2l-case"></span><span class="ps2l-tag" aria-hidden="true"></span>`;
      if (!coverCache.has(game.id)) coverCache.set(game.id, renderCover(game, { width: 360 }));
      const cv = coverCache.get(game.id);
      cv.setAttribute("aria-hidden", "true");
      b.firstChild.append(cv);
      b.style.setProperty("--glow", (game.palette?.accent ?? "#5aa9ff") + "88");
      b.addEventListener("click", () => {
        if (swiped) return;
        const i = games.findIndex((g) => g.id === game.id);
        if (i === sel) activate(); else select(i);
      });
      cards.set(game.id, b);
      stage.append(b);
    }
    return b;
  }

  function layout() {
    games.forEach((g, i) => {
      const b = cardFor(g), d = i - sel, ad = Math.abs(d), own = available(g.id);
      b.style.setProperty("--x", d === 0 ? 0 : Math.sign(d) * (0.78 + ad * 0.46));
      b.style.setProperty("--z", -ad * 90);
      b.style.setProperty("--ry", d === 0 ? 0 : -Math.sign(d) * 42);
      b.style.zIndex = 100 - ad;
      b.toggleAttribute("data-sel", d === 0);
      b.toggleAttribute("data-far", ad > 4);
      b.toggleAttribute("data-owned", own);
      b.tabIndex = d === 0 ? 0 : -1;
      b.setAttribute("aria-current", d === 0 ? "true" : "false");
      b.setAttribute("aria-label", `${g.title}${g.year ? `, ${g.year}` : ""}: ${server.has(g.id) ? "disponível" : own ? "na biblioteca" : "disco não importado"}. ${i + 1} de ${games.length}.`);
      b.lastChild.textContent = server.has(g.id) ? "Disponível" : own ? "Na biblioteca" : "";
    });
    const g = games[sel];
    if (!g) return;
    const own = available(g.id);
    $(".ps2l-meta").textContent = [g.year, g.genre].filter(Boolean).join(" · ");
    $(".ps2l-title").textContent = g.title;
    const status = $(".ps2l-status");
    status.textContent = server.has(g.id) ? `Disponível · ${formatBytes(server.get(g.id).file.size)}`
      : own ? `Na biblioteca · ${formatBytes(owned.get(g.id).size)}` : "Coloque o arquivo na pasta games/ ou importe seu disco";
    status.toggleAttribute("data-owned", own);
    $(".ps2l-desc").textContent = g.description;
    mainBtn.textContent = own ? "Jogar" : "Importar disco";
    mainBtn.disabled = busy;
    removeBtn.hidden = !owned.has(g.id); // only browser (OPFS) copies can be removed from here
    removeBtn.disabled = busy;
    resetRemove();
    const n = GAMES.filter((x) => available(x.id)).length;
    $(".ps2l-count").textContent = `${n} de ${GAMES.length} jogos do catálogo disponíveis` + (games.length > GAMES.length ? ` · ${games.length - GAMES.length} extra` : "");
  }

  function select(i, focus = true) {
    if (!games.length) return;
    sel = Math.max(0, Math.min(games.length - 1, i));
    layout();
    if (focus && root.contains(document.activeElement) && document.activeElement.classList.contains("ps2l-card")) cards.get(games[sel].id).focus({ preventScroll: true });
  }

  async function refresh() {
    const current = games[sel]?.id;
    const serverList = listServerGames();
    try { owned = await listOwned(); } catch (e) { owned = new Map(); say(e.message, "error"); }
    const fromServer = await serverList;
    server = new Map(fromServer.map((s) => [s.gameId, s]));
    const customs = [...owned].filter(([id]) => id.startsWith("custom-")).map(([id, e]) => customGame(id, e));
    games = [...GAMES, ...customs, ...fromServer.filter((s) => s.game.custom).map((s) => s.game)];
    for (const [id, b] of cards) if (!games.some((g) => g.id === id)) { b.remove(); cards.delete(id); }
    const i = games.findIndex((g) => g.id === current);
    sel = i === -1 ? Math.min(sel, games.length - 1) : i;
    layout();
  }

  function resetRemove() {
    clearTimeout(confirmTimer);
    removeBtn.removeAttribute("data-confirm");
    removeBtn.textContent = "Remover";
  }

  async function activate() {
    const g = games[sel];
    if (!g || busy) return;
    if (server.has(g.id)) { onPlay?.(g, server.get(g.id).file); return; } // streamed from games/
    if (!owned.has(g.id)) { pendingGameId = g.id; input.click(); return; }
    try {
      const file = await getGameFile(g.id);
      onPlay?.(g, file);
    } catch (e) { say(e.message, "error"); }
  }

  function chooseGame(serial, file) {
    dialog.querySelector(".ps2l-dlg-p").textContent = serial
      ? `O disco ${serial} não está no catálogo. Escolha o jogo ou use “Outro jogo” para adicioná-lo com o nome do arquivo.`
      : `Não deu para identificar “${file.name}” automaticamente (isso é normal em .cso, .chd e .isz). Escolha qual jogo é:`;
    dialog.returnValue = "";
    dialog.showModal();
    return new Promise((res) => dialog.addEventListener("close", () => res(dialog.returnValue || null), { once: true }));
  }

  async function handleFile(file, gameId) {
    if (busy || !file) return;
    busy = true;
    abort = new AbortController();
    say("");
    layout();
    const onProgress = (done, total) => {
      bar.value = total ? done / total : 0;
      ptext.textContent = `${Math.floor((done / (total || 1)) * 100)}% · ${formatBytes(done)} de ${formatBytes(total)}`;
    };
    try {
      let result;
      try {
        progress.hidden = false;
        bar.value = 0;
        ptext.textContent = "Lendo o disco…";
        result = await importFile(file, { gameId, onProgress, signal: abort.signal });
      } catch (e) {
        if (e.code !== "NEEDS_GAME_CHOICE") throw e;
        progress.hidden = true;
        const choice = await chooseGame(e.serial, file);
        if (!choice) { say("Importação cancelada."); return; }
        progress.hidden = false;
        result = await importFile(file, { gameId: choice, onProgress, signal: abort.signal });
      }
      await refresh();
      const i = games.findIndex((g) => g.id === result.gameId);
      if (i !== -1) select(i, false);
      say(`${games[sel].title} está na biblioteca.${result.serial ? ` Disco ${result.serial}.` : ""}`, "ok");
    } catch (e) {
      // No room to keep a copy: play straight from the picked file (not saved).
      if (e.code === "QUOTA_EXCEEDED" && e.gameId && onPlay) {
        const g = GAMES.find((x) => x.id === e.gameId)
          ?? customGame(e.gameId, { title: e.title, originalName: file.name, serial: e.serial });
        say(`Sem espaço para salvar ${g.title} no navegador. Rodando direto do arquivo (será preciso escolhê-lo de novo na próxima vez).`);
        onPlay(g, file);
        return;
      }
      say(e.message, e.code === "ABORTED" ? "" : "error");
      if (e.code !== "ABORTED") console.error(e);
    } finally {
      busy = false;
      abort = null;
      progress.hidden = true;
      layout();
    }
  }

  // ---- events
  const onClick = (e) => {
    const act = e.target.closest("[data-act],[data-dir]");
    if (!act || !root.contains(act)) return;
    if (act.dataset.dir) return select(sel + Number(act.dataset.dir), false);
    switch (act.dataset.act) {
      case "import-any": pendingGameId = null; input.click(); break;
      case "settings": onSettings?.(); break;
      case "main": activate(); break;
      case "cancel": abort?.abort(); break;
      case "remove": {
        if (!removeBtn.hasAttribute("data-confirm")) {
          removeBtn.setAttribute("data-confirm", "");
          removeBtn.textContent = "Confirmar remoção";
          confirmTimer = setTimeout(resetRemove, 4000);
          return;
        }
        const g = games[sel];
        removeGame(g.id).then(refresh).then(() => say(`${g.title} foi removido da biblioteca.`)).catch((err) => say(err.message, "error"));
      }
    }
  };
  root.addEventListener("click", onClick);

  input.addEventListener("change", () => {
    const f = input.files[0];
    input.value = "";
    handleFile(f, pendingGameId);
  });

  const onKey = (e) => {
    if (dialog.open || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target.closest?.("input,textarea,select,dialog")) return;
    const k = e.key;
    if (k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      select(sel + (k === "ArrowLeft" ? -1 : 1));
    } else if (k === "Home" || k === "End") {
      e.preventDefault();
      select(k === "Home" ? 0 : games.length - 1);
    }
  };
  root.addEventListener("keydown", onKey);

  let wheelAt = 0;
  stage.addEventListener("wheel", (e) => {
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 4) return;
    e.preventDefault();
    const now = performance.now();
    if (now - wheelAt < 180) return;
    wheelAt = now;
    select(sel + Math.sign(d), false);
  }, { passive: false });

  let downX = null, swiped = false;
  stage.addEventListener("pointerdown", (e) => { downX = e.clientX; swiped = false; });
  stage.addEventListener("pointerup", (e) => {
    if (downX === null) return;
    const dx = e.clientX - downX;
    downX = null;
    if (Math.abs(dx) > 36) {
      swiped = true;
      select(sel - Math.sign(dx) * Math.max(1, Math.round(Math.abs(dx) / 140)), false);
      setTimeout(() => (swiped = false), 0);
    }
  });
  stage.addEventListener("pointercancel", () => (downX = null));

  // drag & drop anywhere on the overlay
  const drop = $(".ps2l-drop");
  let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
  root.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; drop.hidden = false; });
  root.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  root.addEventListener("dragleave", () => { if (--dragDepth <= 0) { dragDepth = 0; drop.hidden = true; } });
  root.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    drop.hidden = true;
    handleFile(e.dataTransfer.files[0], null);
  });

  preloadCovers().finally(refresh); // covers first, so cards render with the real art

  return {
    refresh,
    show() { root.hidden = false; },
    hide() { root.hidden = true; },
    destroy() { abort?.abort(); clearTimeout(confirmTimer); root.remove(); },
  };
}
