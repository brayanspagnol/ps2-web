// Settings panel: picture (emulator GS options), CRT effect, sound, controls and advanced options,
// in a modal <dialog> that works with mouse, keyboard and gamepad. Saved in localStorage and applied
// live to the TV (crt-tv.js) and to the emulator. Emulator settings need a build with the settings API
// (setGsOptions, setAudioVolume, setInputBindings, setGamepadEnabled); with older builds those
// controls are disabled. Gamepad: D-pad/left stick move, ✕/A activates, ◯/B closes, the PS/Home
// button opens the panel.

const STORE_KEY = "ps2web.settings";

// PS2::CControllerInfo::BUTTON (Play! source)
const B = { LX: 0, LY: 1, RX: 2, RY: 3, UP: 4, DOWN: 5, LEFT: 6, RIGHT: 7, SELECT: 8, START: 9,
  SQUARE: 10, TRIANGLE: 11, CIRCLE: 12, CROSS: 13, L1: 14, L2: 15, L3: 16, R1: 17, R2: 18, R3: 19 };

// Same defaults as the emulator (InputProviderEmscripten.cpp). pad = W3C "standard" gamepad button;
// stick directions only have keys (the gamepad sticks are always the analog sticks).
const CONTROLS = [
  { id: "up", label: "Direcional ↑", button: B.UP, key: "ArrowUp", pad: 12 },
  { id: "down", label: "Direcional ↓", button: B.DOWN, key: "ArrowDown", pad: 13 },
  { id: "left", label: "Direcional ←", button: B.LEFT, key: "ArrowLeft", pad: 14 },
  { id: "right", label: "Direcional →", button: B.RIGHT, key: "ArrowRight", pad: 15 },
  { id: "cross", label: "✕ Xis", button: B.CROSS, key: "KeyZ", pad: 0 },
  { id: "circle", label: "◯ Bola", button: B.CIRCLE, key: "KeyX", pad: 1 },
  { id: "square", label: "▢ Quadrado", button: B.SQUARE, key: "KeyA", pad: 2 },
  { id: "triangle", label: "△ Triângulo", button: B.TRIANGLE, key: "KeyS", pad: 3 },
  { id: "start", label: "Start", button: B.START, key: "Enter", pad: 9 },
  { id: "select", label: "Select", button: B.SELECT, key: "Backspace", pad: 8 },
  { id: "l1", label: "L1", button: B.L1, key: "Digit1", pad: 4 },
  { id: "l2", label: "L2", button: B.L2, key: "Digit2", pad: 6 },
  { id: "r1", label: "R1", button: B.R1, key: "Digit8", pad: 5 },
  { id: "r2", label: "R2", button: B.R2, key: "Digit9", pad: 7 },
  { id: "l3", label: "L3 (clique do analógico esq.)", button: B.L3, key: "Digit3", pad: 10 },
  { id: "r3", label: "R3 (clique do analógico dir.)", button: B.R3, key: "Digit0", pad: 11 },
  { id: "lsl", label: "Analógico esq. ←", button: B.LX, positive: false, key: "KeyF" },
  { id: "lsr", label: "Analógico esq. →", button: B.LX, positive: true, key: "KeyH" },
  { id: "lsu", label: "Analógico esq. ↑", button: B.LY, positive: false, key: "KeyT" },
  { id: "lsd", label: "Analógico esq. ↓", button: B.LY, positive: true, key: "KeyG" },
  { id: "rsl", label: "Analógico dir. ←", button: B.RX, positive: false, key: "KeyJ" },
  { id: "rsr", label: "Analógico dir. →", button: B.RX, positive: true, key: "KeyL" },
  { id: "rsu", label: "Analógico dir. ↑", button: B.RY, positive: false, key: "KeyI" },
  { id: "rsd", label: "Analógico dir. ↓", button: B.RY, positive: true, key: "KeyK" },
];
const PAD_NAMES = ["A / ✕", "B / ◯", "X / ▢", "Y / △", "LB / L1", "RB / R1", "LT / L2", "RT / R2", "Back / Select",
  "Start", "L3", "R3", "D-pad ↑", "D-pad ↓", "D-pad ←", "D-pad →"];
const PAD_HOME = 16; // opens this panel; never bound to the game
const RESERVED_KEY = /^(Escape|Tab|F\d+)$/; // panel / site shortcuts (F5 save, F8 load, F11 fullscreen)

export const DEFAULTS = {
  resFactor: 1, bilinear: false, widescreen: false, fill: false,
  crt: true, scanlines: 1, curvature: 1, bloom: 1,
  volume: 1, muted: false,
  frameLimit: true,
  keys: {}, pad: {}, // control id -> key code / gamepad button, only where it differs from the default
};
const RANGES = { resFactor: [1, 4], scanlines: [0, 2], curvature: [0, 2], bloom: [0, 2], volume: [0, 1] };
const GROUP = { resFactor: "gs", bilinear: "gs", widescreen: "gs", fill: "gs", crt: "crt", scanlines: "crt",
  curvature: "crt", bloom: "crt", volume: "audio", muted: "audio", frameLimit: "limit" };

// localStorage is untrusted input (old versions, edits by hand): keep only valid values.
function sanitize(raw) {
  const s = { ...DEFAULTS, keys: {}, pad: {} };
  if (!raw || typeof raw !== "object") return s;
  for (const [k, def] of Object.entries(DEFAULTS)) {
    const v = raw[k];
    if (typeof def === "boolean" && typeof v === "boolean") s[k] = v;
    else if (typeof def === "number" && Number.isFinite(v)) s[k] = Math.min(RANGES[k][1], Math.max(RANGES[k][0], v));
  }
  s.resFactor = Math.round(s.resFactor);
  for (const c of CONTROLS) {
    const k = raw.keys?.[c.id], p = raw.pad?.[c.id];
    if (typeof k === "string" && /^[A-Za-z0-9]{1,32}$/.test(k) && !RESERVED_KEY.test(k)) s.keys[c.id] = k;
    if (c.pad !== undefined && Number.isInteger(p) && p >= 0 && p < PAD_NAMES.length) s.pad[c.id] = p;
  }
  return s;
}

function load() {
  try { return sanitize(JSON.parse(localStorage.getItem(STORE_KEY))); } catch { return sanitize(null); }
}

function save(s) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* private mode / quota: settings last this visit */ }
}

const keyOf = (s, c) => s.keys[c.id] ?? c.key;
const padOf = (s, c) => s.pad[c.id] ?? c.pad;

export function keyName(code) {
  const arrows = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  if (arrows[code]) return arrows[code];
  if (code === "Space") return "Espaço";
  return code.replace(/^Key|^Digit/, "").replace(/^Numpad/, "Num ").replace(/(Left|Right)$/, (m) => (m === "Left" ? " esq." : " dir."));
}

// [[code, PS2 button, positive], ...] and PS2 button per standard gamepad button, for setInputBindings.
function bindings(s) {
  const pad = new Array(PAD_HOME + 1).fill(-1);
  for (const c of CONTROLS) if (c.pad !== undefined) pad[padOf(s, c)] = c.button;
  return [CONTROLS.map((c) => [keyOf(s, c), c.button, !!c.positive]), pad];
}

// One line for the HUD, e.g. "↑↓←→ direcional · Z ✕ · X ◯ · … · FTGH / IJKL analógicos".
export function keyHint(s) {
  const k = (id) => keyName(keyOf(s, CONTROLS.find((c) => c.id === id)));
  const join = (ids) => { const n = ids.map(k); return n.every((x) => x.length === 1) ? n.join("") : n.join("/"); };
  return [`${join(["up", "down", "left", "right"])} direcional`, `${k("cross")} ✕`, `${k("circle")} ◯`, `${k("square")} ▢`,
    `${k("triangle")} △`, `${k("start")} Start`, `${k("select")} Select`, `${k("l1")}/${k("l2")} L1/L2`, `${k("r1")}/${k("r2")} R1/R2`,
    `${join(["lsl", "lsu", "lsd", "lsr"])} / ${join(["rsl", "rsu", "rsd", "rsr"])} analógicos`].join(" · ");
}

const STYLE = `
.ps2s{--fg:#eef0f6;--muted:#9aa1b2;--line:rgba(255,255,255,.1);--accent:#5aa9ff;
  width:min(660px,calc(100vw - 32px));max-width:none;max-height:min(88dvh,860px);padding:0;border:1px solid var(--line);border-radius:18px;
  background:#0e1016;color:var(--fg);box-shadow:0 30px 80px rgba(0,0,0,.7);
  font:15px/1.45 'Inter','Segoe UI',Roboto,'Helvetica Neue','Adwaita Sans','Noto Sans','DejaVu Sans',Arial,sans-serif}
.ps2s[open]{display:flex;flex-direction:column}
.ps2s::backdrop{background:rgba(3,4,8,.6);backdrop-filter:blur(3px)}
.ps2s *{box-sizing:border-box}
.ps2s :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.ps2s-head{display:flex;align-items:center;gap:12px;padding:16px 16px 14px 22px;border-bottom:1px solid var(--line)}
.ps2s-head h2{margin:0;font-size:20px;flex:1}
.ps2s-body{overflow:auto;padding:4px 22px 18px;overscroll-behavior:contain}
.ps2s section{padding:14px 0;border-bottom:1px solid var(--line)}
.ps2s section:last-child{border-bottom:0}
.ps2s h3{margin:0 0 6px;font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:var(--accent);font-weight:600}
.ps2s-row{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:48px;padding:4px 0;cursor:pointer}
.ps2s-row small,.ps2s-note{display:block;color:var(--muted);font-size:12.5px;line-height:1.35}
.ps2s-note{margin:4px 0 0}
.ps2s-note[hidden]{display:none}
.ps2s-ctl{display:flex;align-items:center;gap:10px;flex:none}
.ps2s output{min-width:4.5ch;text-align:right;font:13px ui-monospace,monospace;color:var(--muted)}
.ps2s input[type=range]{width:min(200px,38vw);accent-color:var(--accent);margin:0;height:28px;cursor:pointer}
.ps2s select{font:inherit;font-size:14px;color:var(--fg);background:#161922;border:1px solid var(--line);border-radius:10px;min-height:40px;padding:0 10px;cursor:pointer}
.ps2s input[type=checkbox]{appearance:none;-webkit-appearance:none;margin:0;flex:none;width:46px;height:28px;border-radius:999px;background:rgba(255,255,255,.16);
  position:relative;cursor:pointer;transition:background .2s}
.ps2s input[type=checkbox]::after{content:"";position:absolute;top:4px;left:4px;width:20px;height:20px;border-radius:50%;background:#c9ceda;transition:translate .2s,background .2s}
.ps2s input[type=checkbox]:checked{background:var(--accent)}
.ps2s input[type=checkbox]:checked::after{translate:18px 0;background:#fff}
.ps2s-row:has(:disabled),.ps2s-bind:disabled,.ps2s-btn:disabled{opacity:.5;cursor:not-allowed}
.ps2s-btn{min-height:40px;padding:0 16px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.06);color:inherit;font:inherit;font-size:14px;font-weight:600;cursor:pointer}
.ps2s-btn:hover,.ps2s-bind:hover{background:rgba(255,255,255,.12)}
.ps2s-x{width:40px;padding:0;font-size:20px;line-height:1}
.ps2s table{width:100%;border-collapse:collapse;font-size:14px;margin:4px 0 10px}
.ps2s th,.ps2s td{padding:3px 4px;text-align:left;vertical-align:middle}
.ps2s thead th{font-size:12px;color:var(--muted);font-weight:600}
.ps2s tbody th{font-weight:500}
.ps2s-bind{width:100%;min-width:76px;min-height:36px;border-radius:8px;border:1px solid var(--line);background:rgba(255,255,255,.04);color:inherit;
  font:inherit;font-size:13px;font-weight:600;line-height:1.2;cursor:pointer;padding:2px 8px}
.ps2s-bind[data-capturing]{border-color:var(--accent);background:rgba(90,169,255,.2);color:#fff}
.ps2s-fixed{color:var(--muted);font-size:12.5px}
.ps2s-pads{margin:0 0 8px;padding:0;list-style:none;color:var(--muted);font-size:13px}
.ps2s-pads li::before{content:"🎮 "}
.ps2s-live{margin:0;padding:10px 22px;border-top:1px solid var(--line);font-size:13px;color:var(--muted);min-height:1.35em}
.ps2s-live:empty{display:none}
@media (max-width:600px){
  .ps2s{width:100vw;height:100dvh;max-height:100dvh;margin:0;border-radius:0;border:0}
  .ps2s-body{padding:0 16px 16px}
  .ps2s-head{padding-left:16px}
  .ps2s-row{gap:10px}
}
@media (prefers-reduced-motion:reduce){.ps2s *{transition:none !important}}`;

const pct = (v) => `${Math.round(v * 100)}%`;
const row = (name, title, hint, control) =>
  `<label class="ps2s-row"><span>${title}${hint ? `<small>${hint}</small>` : ""}</span><span class="ps2s-ctl">${control}</span></label>`;
const toggle = (name) => `<input type="checkbox" role="switch" name="${name}">`;
const range = (name, max) => `<input type="range" name="${name}" min="0" max="${max}" step="5"><output data-for="${name}"></output>`;

// tv: crt-tv.js instance; getModule(): the Play! module or null; onChange(settings): after every change;
// onClose(): after the panel closes.
export function createSettings({ tv, getModule, onChange, onClose } = {}) {
  if (!document.getElementById("ps2s-style")) {
    const st = document.createElement("style");
    st.id = "ps2s-style";
    st.textContent = STYLE;
    document.head.append(st);
  }
  const s = load();
  const dlg = document.createElement("dialog");
  dlg.className = "ps2s";
  dlg.setAttribute("aria-labelledby", "ps2s-h");
  dlg.innerHTML = `
    <header class="ps2s-head">
      <h2 id="ps2s-h">Configurações</h2>
      <button type="button" class="ps2s-btn ps2s-x" data-act="close" aria-label="Fechar configurações">×</button>
    </header>
    <div class="ps2s-body">
      <section aria-labelledby="ps2s-h-img" data-group="gs">
        <h3 id="ps2s-h-img">Imagem</h3>
        ${row("resFactor", "Resolução interna", "Acima de 1x a imagem fica mais nítida (sobretudo em tela cheia), mas pesa mais na placa de vídeo.",
          `<select name="resFactor"><option value="1">1x nativa · 640×480</option><option value="2">2x · 1280×960</option><option value="3">3x · 1920×1440</option><option value="4">4x · 2560×1920</option></select>`)}
        ${row("bilinear", "Forçar filtro bilinear", "Suaviza as texturas; em alguns jogos a imagem fica borrada.", toggle("bilinear"))}
        ${row("widescreen", "Widescreen 16:9", "Para jogos com opção 16:9 (ou patch); nos outros a imagem fica esticada.", toggle("widescreen"))}
        ${row("fill", "Preencher a tela", "Estica a imagem do jogo até as bordas, sem faixas pretas.", toggle("fill"))}
        <p class="ps2s-note" data-unsupported hidden>Esta versão do emulador não permite mudar estas opções.</p>
      </section>
      <section aria-labelledby="ps2s-h-crt">
        <h3 id="ps2s-h-crt">Efeito CRT</h3>
        ${row("crt", "Efeito de TV de tubo", "", toggle("crt"))}
        ${row("scanlines", "Linhas de varredura", "", range("scanlines", 200))}
        ${row("curvature", "Curvatura da tela", "", range("curvature", 200))}
        ${row("bloom", "Brilho difuso (bloom)", "", range("bloom", 200))}
      </section>
      <section aria-labelledby="ps2s-h-snd" data-group="audio">
        <h3 id="ps2s-h-snd">Som</h3>
        ${row("volume", "Volume", "", range("volume", 100))}
        ${row("muted", "Sem som", "", toggle("muted"))}
        <p class="ps2s-note" data-unsupported hidden>Esta versão do emulador não tem controle de volume.</p>
      </section>
      <section aria-labelledby="ps2s-h-ctl" data-group="input">
        <h3 id="ps2s-h-ctl">Controles</h3>
        <ul class="ps2s-pads" aria-live="polite"></ul>
        <p class="ps2s-note">Escolha um botão da tabela e aperte a nova tecla ou o novo botão do controle (Esc cancela). O botão PS/Home do controle abre este painel.</p>
        <table>
          <thead><tr><th scope="col">PS2</th><th scope="col">Teclado</th><th scope="col">Controle</th></tr></thead>
          <tbody>${CONTROLS.map((c) => `<tr><th scope="row">${c.label}</th>
            <td><button type="button" class="ps2s-bind" data-key="${c.id}"></button></td>
            <td>${c.pad === undefined ? `<span class="ps2s-fixed">${c.id.startsWith("l") ? "analógico esq." : "analógico dir."}</span>`
              : `<button type="button" class="ps2s-bind" data-pad="${c.id}"></button>`}</td></tr>`).join("")}</tbody>
        </table>
        <button type="button" class="ps2s-btn" data-act="reset-controls">Restaurar controles padrão</button>
        <p class="ps2s-note" data-unsupported hidden>Esta versão do emulador não permite trocar os controles.</p>
      </section>
      <section aria-labelledby="ps2s-h-adv">
        <h3 id="ps2s-h-adv">Avançado</h3>
        ${row("frameLimit", "Limitar a velocidade", "Desligado, jogos leves rodam acelerados e o som pode falhar. Para testes.", toggle("frameLimit"))}
      </section>
    </div>
    <p class="ps2s-live" role="status" aria-live="polite"></p>`;
  document.body.append(dlg);

  const $ = (sel) => dlg.querySelector(sel);
  const $$ = (sel) => [...dlg.querySelectorAll(sel)];
  const live = $(".ps2s-live");
  const say = (text) => { live.textContent = text; };
  let capture = null; // { kind: "key" | "pad", id, btn, timer }

  // ---- applying -------------------------------------------------------------------------------
  const support = (mod) => ({
    gs: !mod || typeof mod.setGsOptions === "function",
    audio: !mod || typeof mod.setAudioVolume === "function",
    input: !mod || typeof mod.setInputBindings === "function",
  });

  function apply(group) {
    const mod = getModule?.();
    const all = !group;
    if (all || group === "crt") {
      tv?.setCrtEffect(s.crt);
      tv?.setCrtParams(s);
    }
    if (!mod) return; // applied once the emulator is ready (applyEmulator)
    if ((all || group === "gs") && mod.setGsOptions) mod.setGsOptions(s.resFactor, s.bilinear, s.widescreen, s.fill ? 0 : 1);
    if ((all || group === "audio") && mod.setAudioVolume) mod.setAudioVolume(s.muted ? 0 : s.volume);
    if ((all || group === "limit") && mod.setFrameLimit) mod.setFrameLimit(s.frameLimit);
    if ((all || group === "input") && mod.setInputBindings) mod.setInputBindings(...bindings(s));
  }

  function changed(group) {
    save(s);
    apply(group);
    onChange?.(s);
  }

  function render() {
    for (const el of $$("[name]")) {
      const v = s[el.name];
      if (el.type === "checkbox") el.checked = v;
      else if (el.type === "range") el.value = Math.round(v * 100);
      else el.value = String(v);
    }
    for (const o of $$("output")) o.textContent = pct(s[o.dataset.for]);
    for (const c of CONTROLS) {
      const k = $(`[data-key="${c.id}"]`), p = $(`[data-pad="${c.id}"]`);
      if (capture?.id !== c.id || capture.kind !== "key") { k.textContent = keyName(keyOf(s, c)); k.setAttribute("aria-label", `${c.label}: tecla ${keyName(keyOf(s, c))}. Trocar`); }
      if (p && (capture?.id !== c.id || capture.kind !== "pad")) { p.textContent = PAD_NAMES[padOf(s, c)]; p.setAttribute("aria-label", `${c.label}: botão ${PAD_NAMES[padOf(s, c)]} do controle. Trocar`); }
    }
    const sup = support(getModule?.());
    for (const sec of $$("section[data-group]")) {
      const ok = sup[sec.dataset.group];
      for (const el of sec.querySelectorAll("input,select,.ps2s-bind,[data-act]")) el.disabled = !ok;
      sec.querySelector("[data-unsupported]").hidden = ok;
    }
    for (const name of ["scanlines", "curvature", "bloom"]) $(`[name=${name}]`).disabled = !s.crt;
    $("[name=volume]").disabled ||= s.muted;
  }

  function renderPads() {
    const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean);
    $(".ps2s-pads").innerHTML = pads.length
      ? pads.map((p) => `<li>${escapeHtml(p.id)}${p.mapping === "standard" ? "" : " (layout não padrão: botões podem não bater)"}</li>`).join("")
      : "<li>Nenhum controle detectado. Conecte um e aperte qualquer botão dele.</li>";
  }

  dlg.addEventListener("input", (e) => {
    const el = e.target;
    if (!el.name || !(el.name in GROUP)) return;
    s[el.name] = el.type === "checkbox" ? el.checked : el.type === "range" ? Number(el.value) / 100 : Number(el.value);
    render();
    changed(GROUP[el.name]);
  });

  // ---- remapping ------------------------------------------------------------------------------
  function assign(kind, id, value) {
    const map = kind === "key" ? s.keys : s.pad;
    const cur = (c) => (kind === "key" ? keyOf(s, c) : padOf(s, c));
    const set = (c, v) => { if (v === c[kind]) delete map[c.id]; else map[c.id] = v; };
    const ctrl = CONTROLS.find((c) => c.id === id);
    const old = cur(ctrl);
    // The key/button can only drive one control: the one that had it takes this control's old one.
    const other = CONTROLS.find((c) => c !== ctrl && c[kind] !== undefined && cur(c) === value);
    if (other) set(other, old);
    set(ctrl, value);
    const name = kind === "key" ? keyName(value) : PAD_NAMES[value];
    say(`${ctrl.label}: ${name}.${other ? ` ${other.label} passou para ${kind === "key" ? keyName(old) : PAD_NAMES[old]}.` : ""}`);
    changed("input");
  }

  function startCapture(kind, id, btn) {
    stopCapture();
    capture = { kind, id, btn, timer: setTimeout(() => { stopCapture(); say("Tempo esgotado: nada mudou."); }, 10000) };
    btn.setAttribute("data-capturing", "");
    btn.textContent = kind === "key" ? "tecla…" : "botão…";
    const label = CONTROLS.find((c) => c.id === id).label;
    say(kind === "key" ? `Aperte a nova tecla para ${label} (Esc cancela).` : `Aperte o botão do controle para ${label} (Esc cancela).`);
  }

  function stopCapture() {
    if (!capture) return;
    clearTimeout(capture.timer);
    capture.btn.removeAttribute("data-capturing");
    capture = null;
    render();
  }

  dlg.addEventListener("keydown", (e) => {
    if (!capture) return;
    e.preventDefault(); // also keeps Esc from closing the dialog
    e.stopPropagation();
    if (e.repeat) return;
    if (e.code === "Escape") { stopCapture(); say("Nada mudou."); return; }
    if (capture.kind !== "key") return;
    if (RESERVED_KEY.test(e.code) || !/^[A-Za-z0-9]{1,32}$/.test(e.code)) { say(`A tecla ${e.key} é reservada. Escolha outra.`); return; }
    const { id, btn } = capture;
    stopCapture();
    assign("key", id, e.code);
    render();
    btn.focus();
  }, true);
  dlg.addEventListener("cancel", (e) => { if (capture) { e.preventDefault(); stopCapture(); } });

  dlg.addEventListener("click", (e) => {
    const el = e.target.closest("button");
    if (!el || el.disabled) return;
    if (el.dataset.act === "close") return close();
    if (el.dataset.act === "reset-controls") {
      stopCapture();
      s.keys = {};
      s.pad = {};
      render();
      changed("input");
      say("Controles voltaram ao padrão.");
      return;
    }
    const kind = el.dataset.key ? "key" : el.dataset.pad ? "pad" : null;
    if (!kind) return;
    const id = el.dataset.key ?? el.dataset.pad;
    if (capture?.btn === el) { stopCapture(); say("Nada mudou."); return; }
    startCapture(kind, id, el);
  });
  // Backdrop click closes (the dialog box itself fills its border box).
  dlg.addEventListener("pointerdown", (e) => { if (e.target === dlg) { const r = dlg.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close(); } });

  // ---- gamepad: navigation, capture, PS button ----------------------------------------------------
  let prev = [], held = null, raf = 0;
  const focusables = () => $$("button,input,select").filter((el) => !el.disabled && el.offsetParent !== null);
  function moveFocus(d) {
    const list = focusables();
    const i = list.indexOf(document.activeElement);
    list[(i === -1 ? 0 : (i + d + list.length) % list.length)]?.focus();
  }
  function adjust(d) {
    const el = document.activeElement;
    if (el?.type === "range") { d > 0 ? el.stepUp() : el.stepDown(); el.dispatchEvent(new Event("input", { bubbles: true })); }
    else if (el?.tagName === "SELECT") {
      const i = Math.max(0, Math.min(el.options.length - 1, el.selectedIndex + d));
      if (i !== el.selectedIndex) { el.selectedIndex = i; el.dispatchEvent(new Event("input", { bubbles: true })); }
    } else moveFocus(d);
  }
  function poll(now) {
    raf = 0;
    const pads = [...(navigator.getGamepads?.() ?? [])].filter(Boolean);
    if (!pads.length) { prev = []; held = null; return; }
    const down = [];
    let ax = 0, ay = 0;
    for (const p of pads) {
      p.buttons.forEach((b, i) => { if (b.pressed || b.value > 0.5) down[i] = true; });
      if (Math.abs(p.axes[0] ?? 0) > 0.6) ax = Math.sign(p.axes[0]);
      if (Math.abs(p.axes[1] ?? 0) > 0.6) ay = Math.sign(p.axes[1]);
    }
    const edge = (i) => down[i] && !prev[i];
    if (!dlg.open) {
      if (edge(PAD_HOME)) open();
    } else if (capture?.kind === "pad") {
      const i = down.findIndex((d, i) => d && !prev[i] && i < PAD_NAMES.length);
      if (i !== -1) { const { id, btn } = capture; stopCapture(); assign("pad", id, i); render(); btn.focus(); }
      else if (edge(PAD_HOME)) { stopCapture(); say("Nada mudou."); }
    } else if (capture) { // waiting for a key: ◯/B or PS/Home cancels
      if (edge(1) || edge(PAD_HOME)) { const { btn } = capture; stopCapture(); say("Nada mudou."); btn.focus(); }
    } else {
      if (edge(1) || edge(PAD_HOME)) close();
      else if (edge(0)) document.activeElement?.closest?.(".ps2s") && document.activeElement.click();
      else {
        // Directions repeat while held: first move at once, then after 400 ms every 110 ms.
        const dir = down[12] || ay < 0 ? "u" : down[13] || ay > 0 ? "d" : down[14] || ax < 0 ? "l" : down[15] || ax > 0 ? "r" : null;
        if (!dir) held = null;
        else if (!held || held.dir !== dir || now >= held.next) {
          held = { dir, next: now + (held?.dir === dir ? 110 : 400) };
          if (dir === "u" || dir === "d") moveFocus(dir === "u" ? -1 : 1);
          else adjust(dir === "l" ? -1 : 1);
        }
      }
    }
    prev = down;
    raf = requestAnimationFrame(poll);
  }
  const startPoll = () => { if (!raf) raf = requestAnimationFrame(poll); };
  addEventListener("gamepadconnected", () => { startPoll(); if (dlg.open) renderPads(); });
  addEventListener("gamepaddisconnected", () => { if (dlg.open) renderPads(); });

  // While the panel is open the gamepad drives it, not the game. Give the pad back only once every
  // button is released (the ◯/B that closed the panel must not reach the game).
  function gamepadToGame() {
    const mod = getModule?.();
    if (!mod?.setGamepadEnabled || dlg.open) return;
    const pressed = [...(navigator.getGamepads?.() ?? [])].some((p) => p?.buttons.some((b) => b.pressed));
    if (pressed) requestAnimationFrame(gamepadToGame);
    else mod.setGamepadEnabled(true);
  }

  function open() {
    if (dlg.open) return;
    render();
    renderPads();
    say("");
    getModule?.()?.setGamepadEnabled?.(false);
    dlg.showModal();
    startPoll();
  }

  function close() {
    if (!dlg.open) return;
    stopCapture();
    dlg.close();
  }
  dlg.addEventListener("close", () => { stopCapture(); gamepadToGame(); onClose?.(); });

  startPoll();
  apply("crt");

  return {
    settings: s,
    open, close, isOpen: () => dlg.open,
    // Call once the emulator is initialized (and it keeps the settings across boots).
    applyEmulator() { apply(); if (dlg.open) { getModule?.()?.setGamepadEnabled?.(false); render(); } },
    // Changes one setting from outside (HUD buttons), e.g. set("crt", false).
    set(name, value) {
      if (!(name in GROUP) || s[name] === value) return;
      s[name] = value;
      if (dlg.open) render();
      changed(GROUP[name]);
    },
  };
}

function escapeHtml(t) {
  return String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
