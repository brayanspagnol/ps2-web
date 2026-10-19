// PlayStation 2 boot intro shown on the TV while the emulator boots the game.
// 0. With the player's own BIOS dump (Configurações > Avançado, ps2-bios.js): the "Sony Computer
//    Entertainment" screen with the console's original startup sound, text, fog, flare and glow
//    textures taken from that BIOS (the motion is a recreation), then the towers with the BIOS's
//    tower sound and the logo with its chime.
// 1. Startup screen: a recreation (flash of light, dark-blue field of glowing translucent cube towers
//    with drifting light, synthesized pad + chime; without a BIOS). Users can also supply their own
//    recording (gitignored, never in the repo):
//    public/assets/ps2-boot.mp4|.webm (video + audio, replaces the recreation) or
//    public/assets/ps2-boot.ogg|.mp3|.wav (audio only, replaces the synthesized sound).
// 2. The "PlayStation 2" logo: the original one, decoded from the disc itself (ps2-logo.js), faded in
//    on black like the console does. Fallbacks: public/assets/ps2-logo.png (gitignored), then text.
//
// The intro renders into a 640x480 render target with the page's renderer and is shown through the
// TV's CRT shader (tv.setOverlay). It ends once the logo was up for 2 s (2 s in all with reduced
// motion) AND the game showed its first non-black frame; until then it holds on the logo. Any key,
// click or gamepad button skips (as soon as the game has a frame). Everything is disposed at the end.
import * as THREE from "three";
import { decodeDiscLogo, LOGO_BYTES } from "./ps2-logo.js";
import { biosIntro } from "./ps2-bios.js";

const W = 640, H = 480;
const LOGO_T = 4.6;          // logo starts fading in (synthetic timeline, seconds)
const LOGO_IN = 1;           // fade-in length
const LOGO_HOLD = 2;         // minimum time on the logo
const MIN_T_REDUCED = 2;
const HOLD_CAP = 20;         // s past the end: give up waiting for a non-black frame (game shows black)
const FADE_MS = 450;
const BIOS_WAIT_MS = 15000; // safety cap only (extraction takes ~0.5 s, a few s while the game boots)
const SCE_LEN = 8;           // BIOS startup screen length; the timeline starts at -SCE_LEN (towers at 0)
const ASSETS = new URL("../assets/", import.meta.url);

// ---- optional user assets (probed once per page; a missing file is one 404 in the network log) ----
const exists = (name) => fetch(new URL(name, ASSETS), { method: "HEAD" }).then((r) => (r.ok ? r.url : null), () => null);
const first = async (names) => (await Promise.all(names.map(exists))).find(Boolean) ?? null;
let assetsP = null;
function probeAssets() {
  assetsP ??= (async () => {
    const video = await first(["ps2-boot.mp4", "ps2-boot.webm"]);
    const audioUrl = video ? null : await first(["ps2-boot.ogg", "ps2-boot.mp3", "ps2-boot.wav"]);
    const audio = audioUrl ? await fetch(audioUrl).then((r) => r.arrayBuffer()).catch(() => null) : null;
    return { video, audio };
  })();
  return assetsP;
}
// The BIOS intro is extracted in a worker once the page is idle (at most 2.5 s after load), so it is
// usually ready when a game starts; startBootIntro waits for it otherwise.
(window.requestIdleCallback ?? setTimeout)(() => biosIntro(), { timeout: 2500 });
let pngP = null;
const loadPng = () => (pngP ??= new Promise((res) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => res(null);
  img.src = new URL("ps2-logo.png", ASSETS).href;
}));

// ---- shaders (raw sRGB output, like the emulator frames the CRT shader expects) ------------------
const COMMON = /* glsl */ `uniform float time, fade, bg, flare, logo, master; uniform vec3 lightPos;`;

const CUBE_VERT = /* glsl */ `${COMMON}
attribute float aRnd;
varying vec2 vUv; varying float vFog, vLit, vRnd, vTop;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec4 mv = viewMatrix * wp;
  vFog = clamp(1.0 - (-mv.z - 5.0) / 24.0, 0.0, 1.0);
  vFog *= vFog;
  float d = distance(wp.xz, lightPos.xz);
  vLit = exp(-d * d / 10.0) + 0.6 * exp(-d * d / 60.0);
  vRnd = aRnd;
  vTop = clamp(wp.y / 6.0, 0.0, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const CUBE_FRAG = /* glsl */ `${COMMON}
varying vec2 vUv; varying float vFog, vLit, vRnd, vTop;
void main() {
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.09, 0.0, min(e.x, e.y));
  float shimmer = 0.8 + 0.2 * sin(time * 1.1 + vRnd * 40.0);
  vec3 col = vec3(0.05, 0.13, 0.42) * (0.10 + 0.14 * vRnd) + vec3(0.25, 0.5, 1.0) * edge * 0.30;
  col *= shimmer * (0.35 + 0.5 * vTop + 1.8 * vLit);
  col += vec3(0.55, 0.78, 1.0) * vLit * edge * 0.45;
  gl_FragColor = vec4(col * vFog * fade * master, 1.0);
}`;

const QUAD_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const BG_FRAG = /* glsl */ `${COMMON}
varying vec2 vUv;
void main() {
  vec2 p = (vUv - vec2(0.5, 0.6)) * vec2(1.333, 1.0);
  vec3 col = mix(vec3(0.0, 0.0, 0.012), vec3(0.03, 0.07, 0.22), exp(-dot(p, p) * 2.6)) * bg;
  // the opening flash: a point of light that blooms with a soft cross
  vec2 q = (vUv - 0.5) * vec2(1.333, 1.0);
  float r = length(q);
  float f = exp(-r * r * mix(900.0, 14.0, flare)) + 0.25 * exp(-r * r * 6.0) * flare;
  f += flare * (exp(-abs(q.y) * 260.0) * exp(-abs(q.x) * 3.0) + exp(-abs(q.x) * 260.0) * exp(-abs(q.y) * 4.0)) * 0.5;
  col += vec3(0.65, 0.82, 1.0) * f * flare * 1.4;
  gl_FragColor = vec4(col * master, 1.0);
}`;

const LOGO_VERT = /* glsl */ `uniform vec2 halfSize; varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy * halfSize, 0.0, 1.0); }`;
const LOGO_FRAG = /* glsl */ `${COMMON}
uniform sampler2D map;
uniform float sweepAmt;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  float sweep = exp(-pow((vUv.x - mod(time * 0.35, 1.8) + 0.4) * 7.0, 2.0)) * 0.6 * sweepAmt; // light running along the text logo
  c.rgb += vec3(0.6, 0.8, 1.0) * sweep * c.a;
  gl_FragColor = vec4(c.rgb, c.a * logo * master);
}`;

const VIDEO_FRAG = /* glsl */ `${COMMON}
uniform sampler2D map;
uniform float on;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb * on * master, 1.0); }`;

const MOTE_VERT = /* glsl */ `${COMMON}
attribute float aRnd;
varying float vA;
void main() {
  vec3 p = position;
  p.y = mod(p.y + time * (0.25 + 0.35 * aRnd), 9.0) - 0.5;
  p.x += sin(time * 0.4 + aRnd * 30.0) * 0.6;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (2.0 + 5.0 * aRnd) * 60.0 / -mv.z;
  vA = clamp(1.0 - (-mv.z - 3.0) / 22.0, 0.0, 1.0) * smoothstep(-0.5, 1.0, p.y) * (1.0 - smoothstep(6.5, 8.5, p.y));
  gl_Position = projectionMatrix * mv;
}`;
const MOTE_FRAG = /* glsl */ `${COMMON}
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  gl_FragColor = vec4(vec3(0.5, 0.75, 1.0) * exp(-d * d * 22.0) * vA * fade * master, 1.0);
}`;

// BIOS startup screen ("Sony Computer Entertainment"): drifting fog layers, the flare ring opening
// at the start, glowing motes and the text, all with the BIOS's own textures (motion recreated).
const SCE_U = /* glsl */ `uniform float sceT, sceA, master, flareA, flareScale, textA, moteA;`;
const SCE_FRAG = /* glsl */ `${SCE_U}
uniform sampler2D fogA, fogB, fogC, flareMap;
varying vec2 vUv;
vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c) * p; }
void main() {
  vec2 p = (vUv - 0.5) * vec2(1.333, 1.0);
  float f1 = texture2D(fogA, rot(p, sceT * 0.035) * 0.8 + vec2(0.5, 0.5 + sceT * 0.02)).r;
  float f2 = texture2D(fogB, rot(p, -sceT * 0.05) * 1.3 + vec2(0.3 - sceT * 0.025, 0.5)).r;
  float f3 = texture2D(fogC, p * 2.0 + vec2(sceT * 0.012, -sceT * 0.03)).r;
  float fog = f1 * 0.5 + f2 * 0.35 + f3 * 0.25;
  vec3 col = vec3(0.0, 0.004, 0.02) + vec3(0.07, 0.17, 0.45) * fog * fog * exp(-dot(p, p) * 2.0) * 1.4;
  vec2 fq = p / flareScale + 0.5;
  if (all(greaterThan(fq, vec2(0.0))) && all(lessThan(fq, vec2(1.0)))) col += texture2D(flareMap, fq).rgb * vec3(0.8, 0.9, 1.0) * flareA;
  gl_FragColor = vec4(col * sceA * master, 1.0);
}`;
const SCE_TEXT_FRAG = /* glsl */ `${SCE_U}
uniform sampler2D map;
varying vec2 vUv;
void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  float a = texture2D(map, uv).a, halo = texture2D(map, uv, 3.0).a;
  gl_FragColor = vec4(vec3(1.0) * a + vec3(0.35, 0.55, 1.0) * halo * 0.6, 1.0) * textA * master;
}`;
const SCE_MOTE_VERT = /* glsl */ `${SCE_U}
attribute float aRnd;
varying float vA;
void main() {
  vec2 p = vec2(position.x + sin(sceT * 0.3 + aRnd * 20.0) * 0.05, mod(position.y + sceT * (0.02 + 0.03 * aRnd) + 1.0, 2.0) - 1.0);
  gl_PointSize = 3.0 + 9.0 * aRnd * aRnd;
  vA = (0.25 + 0.75 * fract(aRnd * 7.0)) * (0.6 + 0.4 * sin(sceT * 2.0 + aRnd * 50.0)) * moteA;
  gl_Position = vec4(p, 0.0, 1.0);
}`;
const SCE_MOTE_FRAG = /* glsl */ `${SCE_U}
uniform sampler2D map;
varying float vA;
void main() { gl_FragColor = vec4(vec3(0.6, 0.8, 1.0) * texture2D(map, gl_PointCoord).a * vA * master, 1.0); }`;

function dataTex({ width, height, rgba }, wrap = false, mips = false) {
  const t = new THREE.DataTexture(rgba, width, height);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = mips ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  t.generateMipmaps = mips;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// Logo textures as { tex, half: [x, y] (half size in clip space), sweep }.
// The disc logo keeps the console's size: its pixels on a 640 x 448 (NTSC) / 512 (PAL) frame.
function discLogoTexture({ width, height, frameH, pixels }) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const o = ((height - 1 - y) * width + x) * 4; // DataTexture rows go bottom-up
    rgba[o] = rgba[o + 1] = rgba[o + 2] = 255;
    rgba[o + 3] = pixels[y * width + x];
  }
  const tex = new THREE.DataTexture(rgba, width, height);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { tex, half: [width / 640, height / frameH], sweep: 0 };
}

const fitHalf = (aspect) => { // at most 62% of the width / 30% of the height
  const hw = Math.min(0.62, 0.3 * aspect * (H / W));
  return [hw, hw * (W / H) / aspect];
};

function logoTexture(img) {
  if (img) {
    const t = new THREE.Texture(img);
    t.needsUpdate = true;
    return { tex: t, half: fitHalf(img.naturalWidth / img.naturalHeight), sweep: 0 };
  }
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 256;
  const g = c.getContext("2d");
  const font = "'Inter','Segoe UI','Helvetica Neue',Arial,sans-serif";
  g.textBaseline = "alphabetic";
  g.font = `600 112px ${font}`;
  const w1 = g.measureText("PlayStation").width;
  g.font = `300 150px ${font}`;
  const w2 = g.measureText("2").width;
  const x0 = (1024 - (w1 + 22 + w2)) / 2, y = 168;
  for (const [blur, color] of [[40, "rgba(70,140,255,.9)"], [12, "rgba(150,200,255,.8)"], [0, ""]]) {
    g.shadowBlur = blur;
    g.shadowColor = color || "transparent";
    g.fillStyle = "#f4f8ff";
    g.font = `600 112px ${font}`;
    g.fillText("PlayStation", x0, y);
    g.font = `300 150px ${font}`;
    g.fillText("2", x0 + w1 + 22, y + 4);
  }
  g.shadowBlur = 0;
  const line = g.createLinearGradient(x0, 0, x0 + w1 + w2, 0);
  line.addColorStop(0, "rgba(120,180,255,0)");
  line.addColorStop(0.5, "rgba(170,210,255,.85)");
  line.addColorStop(1, "rgba(120,180,255,0)");
  g.fillStyle = line;
  g.fillRect(x0, y + 26, w1 + 22 + w2, 2);
  const t = new THREE.CanvasTexture(c);
  return { tex: t, half: fitHalf(4), sweep: 1 };
}

// ---- sound ---------------------------------------------------------------------------------------
// Deep swelling pad (detuned saws through an opening low-pass + sub) that peaks into a shimmering
// bell chime when the logo appears. Returns the time the last sound ends.
// Noise-tail convolution reverb into out; returns its input.
function reverb(ctx, out, secs, gain) {
  const sr = ctx.sampleRate, irLen = Math.floor(sr * secs);
  const ir = ctx.createBuffer(2, irLen, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3);
  }
  const verb = ctx.createConvolver();
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = gain;
  verb.connect(wet).connect(out);
  return verb;
}

function synth(ctx, out, t0) {
  const sr = ctx.sampleRate;
  const verb = reverb(ctx, out, 3, 0.45);
  const dry = ctx.createGain();
  dry.connect(out);
  dry.connect(verb);

  const osc = (type, f, t, stop, dest, gain, detune = 0) => {
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = f; o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g).connect(dest);
    o.start(t); o.stop(stop);
    return g;
  };

  const end = t0 + 8.5;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass"; lp.Q.value = 2;
  lp.frequency.setValueAtTime(80, t0);
  lp.frequency.exponentialRampToValueAtTime(1800, t0 + 4.5);
  lp.frequency.exponentialRampToValueAtTime(400, t0 + 7.5);
  const pad = ctx.createGain();
  pad.gain.setValueAtTime(0.0001, t0);
  pad.gain.exponentialRampToValueAtTime(0.2, t0 + 4.4);
  pad.gain.setTargetAtTime(0, t0 + 4.7, 0.8);
  lp.connect(pad).connect(dry);
  for (const f of [73.42, 110, 146.83, 185, 220, 293.66]) for (const det of [-9, 9]) osc("sawtooth", f, t0, end, lp, 0.08, det);

  const sub = ctx.createGain();
  sub.gain.setValueAtTime(0.0001, t0);
  sub.gain.exponentialRampToValueAtTime(0.45, t0 + 4.5);
  sub.gain.setTargetAtTime(0, t0 + 4.7, 0.6);
  sub.connect(out);
  osc("sine", 36.71, t0, end, sub, 1);

  const tc = t0 + 4.6;
  [587.33, 880, 1174.66, 1479.98, 1760, 2349.32].forEach((f, i) => {
    const t = tc + i * 0.075;
    for (const [m, a, dec] of [[1, 1, 2.6], [2.76, 0.35, 1.3], [5.4, 0.14, 0.6]]) {
      const g = osc("sine", f * m, t, t + dec + 0.1, dry, 0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a * 0.07, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    }
  });

  const noise = ctx.createBuffer(1, sr * 2, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const ns = ctx.createBufferSource();
  ns.buffer = noise;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass"; hp.frequency.value = 7000;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, tc - 0.3);
  ng.gain.exponentialRampToValueAtTime(0.05, tc + 0.05);
  ng.gain.exponentialRampToValueAtTime(0.0001, tc + 1.9);
  ns.connect(hp).connect(ng).connect(verb);
  ns.start(tc - 0.3); ns.stop(tc + 2);
  return end + 1;
}

// ---- intro ---------------------------------------------------------------------------------------
// view: console-scene (renderer, onFrame); tv: crt-tv (setOverlay, setSignal); disc: the File /
// RemoteFile being booted (its first sectors hold the logo); sourceCanvas + frameId: the emulator
// output (frameId() changes per frame, null on old builds); volume(): 0..1.
// Returns { done, cancel }: done resolves when the TV switched to the game (also after cancel).
export function startBootIntro({ view, tv, disc, sourceCanvas, frameId, volume = () => 1 }) {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const renderer = view.renderer;
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const U = {
    time: { value: 0 }, fade: { value: 0 }, bg: { value: 0 }, flare: { value: 0 }, logo: { value: 0 },
    master: { value: 1 }, lightPos: { value: new THREE.Vector3() },
  };
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(50, W / H, 0.1, 60);
  const disposables = [rt];
  const mat = (o) => { const m = new THREE.ShaderMaterial({ uniforms: U, depthWrite: false, ...o }); disposables.push(m); return m; };
  const quad = (material, order) => {
    const g = new THREE.PlaneGeometry(2, 2);
    disposables.push(g);
    const m = new THREE.Mesh(g, material);
    m.frustumCulled = false; m.renderOrder = order;
    scene.add(m);
    return m;
  };

  quad(mat({ vertexShader: QUAD_VERT, fragmentShader: BG_FRAG, depthTest: false }), -1);

  // Towers: stacks of unit cubes on a grid, drawn additively (translucent glowing glass).
  const N = 26, cubes = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    if (Math.random() < 0.45) continue;
    const h = 1 + Math.floor(Math.random() ** 2 * 7);
    for (let k = 0; k < h; k++) cubes.push([(i - N / 2) * 1.5, k * 1.0 + 0.45, (j - N / 2) * 1.5 - 4, Math.random()]);
  }
  const cubeGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  cubeGeo.setAttribute("aRnd", new THREE.InstancedBufferAttribute(new Float32Array(cubes.map((c) => c[3])), 1));
  const towers = new THREE.InstancedMesh(cubeGeo, mat({ vertexShader: CUBE_VERT, fragmentShader: CUBE_FRAG,
    transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }), cubes.length);
  const m4 = new THREE.Matrix4();
  cubes.forEach((c, i) => towers.setMatrixAt(i, m4.makeTranslation(c[0], c[1], c[2])));
  towers.frustumCulled = false;
  scene.add(towers);
  disposables.push(cubeGeo, towers);

  const MOTES = 180;
  const mp = new Float32Array(MOTES * 3), mr = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    mp.set([(Math.random() - 0.5) * 26, Math.random() * 9, (Math.random() - 0.5) * 26 - 4], i * 3);
    mr[i] = Math.random();
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(mp, 3));
  moteGeo.setAttribute("aRnd", new THREE.BufferAttribute(mr, 1));
  const motes = new THREE.Points(moteGeo, mat({ vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG, transparent: true, blending: THREE.AdditiveBlending }));
  motes.frustumCulled = false;
  scene.add(motes);
  disposables.push(moteGeo);

  // ---- BIOS startup screen (built when the player's BIOS is available) ----
  const SU = { sceT: { value: 0 }, sceA: { value: 0 }, master: U.master, flareA: { value: 0 }, flareScale: { value: 1 },
    textA: { value: 0 }, moteA: { value: 0 } };
  let bios = null, sceObjs = [], logoSounded = false, chime = null; // chime: BIOS logo sound (also with the video)
  function buildSce(b) {
    const T = b.textures;
    const tex = (x, wrap, mips) => { const t = dataTex(x, wrap, mips); disposables.push(t); return t; };
    const fog = T.fog.map((f) => tex(f, true));
    const pick = (i) => fog[i % fog.length];
    const bgU = { ...SU, fogA: { value: pick(0) }, fogB: { value: pick(2) }, fogC: { value: pick(3) },
      flareMap: { value: T.flare ? tex(T.flare) : pick(1) } };
    const bgMesh = quad(mat({ uniforms: bgU, vertexShader: QUAD_VERT, fragmentShader: SCE_FRAG, depthTest: false }), -0.5);
    // the text keeps its texel size on the 640 x 448 frame, centered
    const textU = { ...SU, map: { value: tex(T.sce, false, true) }, halfSize: { value: new THREE.Vector2(T.sce.width / 640, T.sce.height / 448) } };
    const textMesh = quad(mat({ uniforms: textU, vertexShader: LOGO_VERT, fragmentShader: SCE_TEXT_FRAG, depthTest: false,
      transparent: true, blending: THREE.AdditiveBlending }), 3);
    const n = 90, pos = new Float32Array(n * 3), rnd = new Float32Array(n);
    for (let i = 0; i < n; i++) { pos.set([Math.random() * 2 - 1, Math.random() * 2 - 1, 0], i * 3); rnd[i] = Math.random(); }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aRnd", new THREE.BufferAttribute(rnd, 1));
    disposables.push(g);
    const glow = T.glow ? tex(T.glow) : null;
    const pts = new THREE.Points(g, mat({ uniforms: { ...SU, map: { value: glow } }, vertexShader: SCE_MOTE_VERT, fragmentShader: SCE_MOTE_FRAG,
      depthTest: false, transparent: true, blending: THREE.AdditiveBlending }));
    pts.frustumCulled = false; pts.renderOrder = 2;
    if (glow) scene.add(pts);
    sceObjs = [bgMesh, textMesh, pts];
  }

  // ---- logo: disc > ps2-logo.png > text ----
  const logoU = { ...U, map: { value: null }, halfSize: { value: new THREE.Vector2() }, sweepAmt: { value: 0 } };
  const logoMesh = quad(mat({ uniforms: logoU, vertexShader: LOGO_VERT, fragmentShader: LOGO_FRAG, depthTest: false, transparent: true }), 10);
  logoMesh.visible = false;
  let finished = false, logoStart = LOGO_T;
  let t = 0;                                  // animation time (frozen with reduced motion / during the video)
  let assetsKnown = false, noField = false;
  const setLogo = ({ tex, half, sweep }) => {
    if (finished || videoUsed) return tex.dispose();
    logoU.map.value = tex;
    logoU.halfSize.value.set(half[0], half[1]);
    logoU.sweepAmt.value = sweep;
    logoMesh.visible = true;
    if (t > logoStart && !reduced) logoStart = t; // arrived late: fade in from now
  };
  (async () => {
    try {
      const logo = decodeDiscLogo(await disc.slice(0, LOGO_BYTES).arrayBuffer());
      if (logo) return setLogo(discLogoTexture(logo));
    } catch (e) {
      console.warn("Boot intro: could not read the disc logo:", e);
    }
    setLogo(logoTexture(await loadPng()));
  })();

  // ---- user video (replaces the recreated startup screen) ----
  const videoU = { ...U, map: { value: null }, halfSize: { value: new THREE.Vector2(1, 1) }, on: { value: 0 } };
  const videoMesh = quad(mat({ uniforms: videoU, vertexShader: LOGO_VERT, fragmentShader: VIDEO_FRAG, depthTest: false }), 5);
  videoMesh.visible = false;
  let video = null, videoTex = null, videoUsed = false;
  function startVideo(url) {
    video = document.createElement("video");
    video.src = url;
    video.playsInline = true;
    video.volume = Math.min(1, Math.max(0, volume()));
    videoTex = new THREE.VideoTexture(video);
    videoTex.minFilter = videoTex.magFilter = THREE.LinearFilter;
    videoU.map.value = videoTex;
    video.addEventListener("loadedmetadata", () => {
      const a = video.videoWidth / video.videoHeight || 4 / 3;
      videoU.halfSize.value.set(Math.min(1, a / (W / H)), Math.min(1, (W / H) / a)); // letter/pillarbox into 4:3
    });
    video.addEventListener("ended", endVideo);
    video.addEventListener("error", () => { console.warn("Boot intro: assets/ps2-boot video failed, using the recreation."); endVideo(true); });
    videoMesh.visible = true;
    videoU.on.value = 1;
    return video.play();
  }
  // After the video: black, then the disc logo (t jumps to just before the logo). fallback: the video
  // never played, run the recreation with its sound instead.
  function endVideo(fallback = false) {
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
    video = null;
    videoTex.dispose();
    videoTex = null;
    videoU.map.value = null;
    videoMesh.visible = false;
    videoU.on.value = 0;
    if (fallback === true) { t = 0; startSound(null); return; }
    // The video is the whole original sequence, logo and chime included: no second logo, then
    // black (like the console while the game loads) until the game's first frame.
    videoUsed = true;
    logoMesh.visible = false;
    logoU.map.value?.dispose();
    logoU.map.value = null;
    chime = null;
    noField = true;
    logoStart = t - LOGO_IN - LOGO_HOLD;
  }

  // ---- sound ----
  let ctx = null, master = null, soundEnd = 0, lastVol = -1;
  try {
    ctx = new AudioContext();
    ctx.resume?.();
    master = ctx.createGain();
    master.gain.value = lastVol = volume();
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  } catch (e) {
    console.warn("Boot intro without sound:", e);
    ctx = null;
  }
  // BIOS sounds (rendered PCM, 48 kHz): dry + reverb send. The SPU2 reverb is approximated.
  let biosBus = null, verbIn = null, scheduled = [];
  function playBios(snd, when, bus) {
    if (!snd) return;
    verbIn ??= reverb(ctx, master, 2.5, 0.5);
    for (const [pcm, dest] of [[snd.dry, bus], [snd.wet, verbIn]]) {
      const buf = ctx.createBuffer(2, pcm[0].length, snd.rate);
      buf.copyToChannel(pcm[0], 0);
      buf.copyToChannel(pcm[1], 1);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
      src.start(when);
      scheduled.push({ src, when });
      soundEnd = Math.max(soundEnd, when + buf.duration);
    }
  }
  function startBiosSound() {
    if (!ctx || finished) return;
    biosBus = ctx.createGain();
    biosBus.connect(master);
    const t0 = ctx.currentTime + 0.05;
    playBios(bios.sounds.boot, t0, biosBus);
    playBios(bios.sounds.towers, t0 + SCE_LEN, biosBus);
  }
  // skip: the startup / tower sounds fade out (the logo chime still plays)
  function stopBiosSound() {
    if (!biosBus) return;
    const now = ctx.currentTime;
    biosBus.gain.setTargetAtTime(0, now, 0.08);
    for (const s of scheduled) if (s.when > now) s.src.stop();
    soundEnd = now + 0.5;
  }

  async function startSound(audio) {
    if (!ctx || finished) return;
    if (audio) {
      try {
        const buf = await ctx.decodeAudioData(audio.slice(0));
        if (finished) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(master);
        src.start();
        soundEnd = ctx.currentTime + buf.duration;
        return;
      } catch (e) {
        console.warn("Boot intro: assets/ps2-boot audio could not be decoded, using the built-in sound:", e);
      }
    }
    soundEnd = synth(ctx, master, ctx.currentTime + 0.05);
  }

  // The timeline waits (t = 0, black under the TV power-on) until the optional assets are known and,
  // with a BIOS, until it is extracted: a BIOS that is still being read is waited for, never replaced
  // by the recreation (only a missing or unusable BIOS falls back, with the reason in the console).
  const waitCap = new Promise((r) => setTimeout(() => r("timeout"), BIOS_WAIT_MS));
  Promise.all([probeAssets(), Promise.race([biosIntro(), waitCap])]).then(([{ video: url, audio }, b]) => {
    if (finished) return;
    if (b === "timeout") { console.warn(`Boot intro: the BIOS was not extracted within ${BIOS_WAIT_MS / 1000} s, using the recreation.`); b = null; }
    if (b && (url || reduced)) console.info(`Boot intro: BIOS intro not used (${url ? "user video in assets/" : "reduced motion"}).`);
    assetsKnown = true;
    t = reduced || skip ? Math.max(t, LOGO_T + LOGO_IN) : 0;
    if (skip) return;
    chime = b?.sounds.logo ?? null;
    if (b && !url && !reduced) {
      bios = b;
      buildSce(b);
      t = -SCE_LEN;
      return startBiosSound();
    }
    // Without a user gesture (autoplay policy) the video may only play muted; the sound is lost either way.
    if (url && !reduced) startVideo(url).catch(() => { if (video) { video.muted = true; return video.play(); } })
      .catch((e) => { console.warn("Boot intro: video blocked:", e.message); endVideo(true); });
    else startSound(audio);
  });

  // ---- timeline / readiness ----
  const start = performance.now();
  let last = start, ready = false, anyNew = false, lastId = frameId?.() ?? null, lastCheck = 0;
  let skip = false, fadeStart = 0, rendered = false, stillDrawn = false, resolveDone;
  const done = new Promise((r) => (resolveDone = r));
  if (lastId === null) ready = true;          // old emulator builds: no frame signal, end on time

  const probe = document.createElement("canvas");
  probe.width = 32; probe.height = 24;
  const pg = probe.getContext("2d", { willReadFrequently: true });
  function checkReady(now) {
    if (ready || now - lastCheck < 150) return;
    const id = frameId();
    if (id === lastId) return;
    lastId = id; lastCheck = now; anyNew = true;
    try {
      pg.drawImage(sourceCanvas, 0, 0, probe.width, probe.height);
      const px = pg.getImageData(0, 0, probe.width, probe.height).data;
      let lit = 0;
      for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 48) lit++;
      if (lit >= 6) ready = true;
    } catch { ready = true; }
  }

  const onSkip = (e) => {
    if (e.type === "keydown" && (e.repeat || document.querySelector("dialog[open]"))) return;
    skip = true;
    if (video) endVideo();
    stopBiosSound();
    noField = true;
    if (t < logoStart + LOGO_IN) t = logoStart + LOGO_IN;
  };
  addEventListener("keydown", onSkip, true);
  addEventListener("pointerdown", onSkip, true);
  let padPrev = true; // ignore a button already held when the intro starts
  function pollPad() {
    const pads = navigator.getGamepads?.() ?? [];
    let down = false;
    for (const p of pads) if (p?.buttons.some((b, i) => i !== 16 && b.pressed)) down = true;
    if (down && !padPrev && !document.querySelector("dialog[open]")) onSkip({ type: "pad" });
    padPrev = down;
  }

  const smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
  function frame() {
    const now = performance.now();
    const elapsed = (now - start) / 1000;
    if (assetsKnown && !reduced && !video) t += (now - last) / 1000;
    last = now;
    pollPad();
    checkReady(now);

    if (!fadeStart) {
      const minDone = reduced ? elapsed >= MIN_T_REDUCED : assetsKnown && !video && t >= logoStart + LOGO_IN + LOGO_HOLD;
      if ((minDone && ready) || (skip && (ready || anyNew)) || (minDone && anyNew && t > logoStart + HOLD_CAP)) {
        fadeStart = now;
        if (ctx && skip) master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      }
    }
    let k = 1;
    if (fadeStart) {
      k = reduced ? 0 : 1 - (now - fadeStart) / FADE_MS;
      if (k <= 0) return finish(true);
    }
    const v = Math.min(1, Math.max(0, volume()));
    if (ctx && !skip && v !== lastVol) { master.gain.setTargetAtTime(v, ctx.currentTime, 0.05); lastVol = v; }
    if (video) video.volume = v * k;

    // startup screen fades to black, then the logo fades in on black (as on the console)
    const out = noField ? 0 : 1 - smooth(LOGO_T - 0.6, LOGO_T, t);
    U.time.value = t;
    U.master.value = Math.max(0, k);
    U.flare.value = smooth(0.4, 1.3, t) * (1 - smooth(1.5, 2.8, t));
    U.bg.value = smooth(0.8, 2.2, t) * out;
    U.fade.value = smooth(1.2, 2.8, t) * out;
    U.logo.value = smooth(logoStart, logoStart + LOGO_IN, t);
    // camera glides over the field
    const z = 15 - t * 1.1, x = Math.sin(t * 0.3) * 1.6;
    cam.position.set(x, 7.5 - t * 0.25, z);
    cam.lookAt(x * 0.4, 0, z - 12);
    U.lightPos.value.set(-11 + t * 3.2, 0, z - 9 + Math.sin(t * 0.9) * 3);
    towers.visible = motes.visible = t > 0 && !noField;
    if (bios) {
      const st = t + SCE_LEN, on = t < 0;
      for (const o of sceObjs) o.visible = on;
      SU.sceT.value = st;
      const out = 1 - smooth(SCE_LEN - 1.4, SCE_LEN - 0.2, st);
      SU.sceA.value = smooth(0.1, 1.8, st) * out;
      SU.flareA.value = smooth(0.15, 0.45, st) * (1 - smooth(0.9, 2.2, st)) * 1.1;
      SU.flareScale.value = 0.15 + 1.4 * smooth(0.15, 2.2, st);
      SU.textA.value = smooth(1.2, 2.8, st) * (1 - smooth(SCE_LEN - 1.9, SCE_LEN - 0.6, st));
      SU.moteA.value = smooth(0.6, 2.4, st) * out;
    }

    if (chime && !logoSounded && ctx && logoMesh.visible && t >= logoStart) { logoSounded = true; playBios(chime, ctx.currentTime, master); }

    // Static on the logo (disc / png logo, reduced motion): the render target keeps the last picture.
    const still = rendered && !fadeStart && !video && t > logoStart + LOGO_IN + 0.1 && !logoU.sweepAmt.value && logoMesh.visible;
    if (still && stillDrawn) return;
    stillDrawn = still;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    rendered = true;
  }

  tv.setOverlay(rt.texture);
  const offFrame = view.onFrame(frame);

  // show: switch the TV to the game in the same frame (no flash of static); false when cancelled.
  function finish(show) {
    if (finished) return;
    finished = true;
    offFrame();
    if (show) tv.setSignal(true);
    tv.setOverlay(null);
    removeEventListener("keydown", onSkip, true);
    removeEventListener("pointerdown", onSkip, true);
    if (video) endVideo();
    logoU.map.value?.dispose();
    for (const d of disposables) d.dispose();
    if (ctx) {
      // let the sound ring out (the synthesized one is ~8 s long), then free the audio graph
      const left = Math.max(0, soundEnd - ctx.currentTime);
      if (skip || !left) master.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      setTimeout(() => ctx.close().catch(() => {}), (skip || !left ? 0.5 : left + 0.2) * 1000);
    }
    resolveDone();
  }

  return { done, cancel: () => finish(false) };
}
