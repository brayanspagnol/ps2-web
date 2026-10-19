// Procedural late-90s CRT TV for three.js. The emulator canvas (#outputCanvas)
// is shown live on the tube through a CRT shader, and the same shader doubles
// as a full-viewport post-process for the fullscreen mode.
//
// Frame copy (emulator canvas -> three texture): a plain THREE.Texture over the
// source canvas, re-uploaded (GPU-side texImage2D) from our rAF when frameId()
// reports a new frame. Current emulator builds render on their own GS thread
// (OffscreenCanvas) and hand each finished frame to #outputCanvas as an
// ImageBitmap ("bitmaprenderer"), so the canvas only ever holds whole frames.
// Older builds drew into a WebGL canvas through GL calls proxied to the main
// thread; a copy taken between their clear and their draw showed a black frame.
// The source canvas is hidden with opacity:0.01 under the page (still rendered,
// presented and focusable; display:none / visibility:hidden would break focus).
// Caveat: in a background tab rAF stops, so the TV freezes there (as expected).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// Base model is built for width 0.7 and scaled to the requested width.
const BASE_W = 0.7;
const SCREEN_W = 0.488, SCREEN_H = 0.366;   // 4:3 tube face
const SCREEN_Y = 0.315;                     // centre height of the tube
const FRONT_Z = 0.25;                       // front face plane (depth 0.5, centred)
const BULGE = 0.022;

const CRT_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 srcSize;
uniform vec2 viewRes;
uniform float time;
uniform float crt;
uniform vec3 crtParams;  // x: scanlines + mask, y: curvature, z: bloom (each 0..2, 1 = default look; scaled by crt)
uniform float aspect;    // source picture aspect (4:3, or 16:9 with the emulator's widescreen option)
uniform float signal;
uniform vec3 power;      // x: horizontal open, y: vertical open, z: brightness
varying vec2 vUv;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

vec2 barrel(vec2 uv) {
  vec2 c = uv * 2.0 - 1.0;
  c += c * (c.yx * c.yx) * vec2(0.045, 0.06) * crt * crtParams.y;
  return c * 0.5 + 0.5;
}

vec3 src(vec2 uv) {
  vec2 d = (uv - 0.5) * 0.0045 * crt * crtParams.y; // radial chromatic aberration
  return vec3(texture2D(tSrc, uv + d).r, texture2D(tSrc, uv).g, texture2D(tSrc, uv - d).b);
}

vec3 glow(vec2 uv) {
  vec2 t = 2.5 / srcSize;
  vec3 s = texture2D(tSrc, uv + vec2(t.x, 0.0)).rgb + texture2D(tSrc, uv - vec2(t.x, 0.0)).rgb
         + texture2D(tSrc, uv + vec2(0.0, t.y)).rgb + texture2D(tSrc, uv - vec2(0.0, t.y)).rgb
         + texture2D(tSrc, uv + t).rgb + texture2D(tSrc, uv - t).rgb
         + texture2D(tSrc, uv + vec2(t.x, -t.y)).rgb + texture2D(tSrc, uv - vec2(t.x, -t.y)).rgb;
  return s / 8.0;
}

void main() {
  vec2 uv = vUv;
#ifdef FULLSCREEN
  vec2 fc = gl_FragCoord.xy / viewRes;
  float va = viewRes.x / viewRes.y, a = aspect;
  vec2 box = va > a ? vec2(a / va, 1.0) : vec2(1.0, va / a);   // letterbox / pillarbox
  uv = (fc - 0.5) / box + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
#else
  uv.y = (uv.y - 0.5) * max(aspect * 0.75, 1.0) + 0.5;   // wider picture: letterboxed on the 4:3 tube
#endif
  vec2 q = barrel(uv);
  vec2 open = max(power.xy, vec2(0.004, 0.006));
  vec2 p = (q - 0.5) / open + 0.5;              // image squeezed by the power animation
  vec3 col = vec3(0.0);

  if (p.x >= 0.0 && p.y >= 0.0 && p.x <= 1.0 && p.y <= 1.0) {
    if (signal > 0.5) {
      col = src(p);
      col += glow(p) * 0.15 * crt * crtParams.z;
    } else {
      float n = hash(floor(p * vec2(320.0, 240.0)) + fract(time * 7.13) * 91.0);
      col = vec3(n * 0.75 + 0.1) * (0.9 + 0.1 * sin(p.y * 40.0 + time * 30.0));
    }
    if (crt > 0.0) {
      float sl = crt * crtParams.x;
      // scanlines (240 beam lines), faded out where they would alias
      float lines = srcSize.y * 0.5;
      float s = 0.5 + 0.5 * cos(p.y * lines * 6.2831853);
      float aa = clamp(1.6 - fwidth(p.y * lines) * 1.6, 0.0, 1.0);
      col *= 1.0 - min(sl * 0.38, 0.9) * aa * (1.0 - s) * (1.0 - 0.5 * dot(col, vec3(0.33)));
      // aperture grille on the physical pixels
      float m = mod(floor(gl_FragCoord.x), 3.0);
      vec3 mask = m < 1.0 ? vec3(1.0, 0.78, 0.78) : (m < 2.0 ? vec3(0.78, 1.0, 0.78) : vec3(0.78, 0.78, 1.0));
      col *= mix(vec3(1.0), mask * 1.12, min(sl * 0.6, 1.0));
      col *= 1.0 + 0.1 * min(sl, 1.5);            // compensate scanline/mask darkening
      // vignette, rolling bar, flicker, noise
      vec2 v = q * (1.0 - q);
      col *= mix(1.0, pow(clamp(v.x * v.y * 16.0, 0.0, 1.0), 0.22), crt);
      col *= 1.0 + crt * (0.018 * sin((q.y - time * 0.12) * 6.2831853) - 0.012 * sin(time * 113.0));
      col += crt * (hash(gl_FragCoord.xy + fract(time) * 61.0) - 0.5) * 0.035;
    }
    // power line/dot: thin beam glows white
    col = mix(col, vec3(1.0), clamp(1.0 - power.y * 6.0, 0.0, 1.0) * 0.9);
    col *= power.z;
  }
#ifndef FULLSCREEN
  // dark tube glass + soft reflection
  vec2 h = (vUv - vec2(0.27, 0.78)) * vec2(1.0, 1.5);
  col += vec3(0.018, 0.022, 0.02) + vec3(0.05) * smoothstep(0.32, 0.0, length(h));
#endif
  gl_FragColor = vec4(col, 1.0);
}`;

const VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FS_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function woodTexture() {
  const c = document.createElement("canvas");
  c.width = 512; c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#6b4426"; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 140; i++) {
    const y = Math.random() * 512, amp = 2 + Math.random() * 6, f = 0.004 + Math.random() * 0.01;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? "40,22,10" : "140,95,55"},${0.15 + Math.random() * 0.3})`;
    g.lineWidth = 0.5 + Math.random() * 2.5;
    g.beginPath();
    for (let x = 0; x <= 512; x += 8) g.lineTo(x, y + Math.sin(x * f + i) * amp);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function roundedRect(shape, w, h, r) {
  const x = -w / 2, y = -h / 2;
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y); shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r); shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h); shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r); shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

function buildBody(style, screenMaterial) {
  const g = new THREE.Group();
  const shellMat = style === "wood"
    ? new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.45 })
    : new THREE.MeshStandardMaterial({ color: style === "black" ? 0x1d1d20 : 0xb8b4aa, roughness: 0.55 });
  const trimMat = new THREE.MeshStandardMaterial({ color: style === "grey" ? 0x8f8c84 : 0x202023, roughness: 0.6 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.8 });

  // front shell
  const front = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.55, 0.2, 4, 0.03), shellMat);
  front.position.set(0, 0.275, FRONT_Z - 0.1);
  g.add(front);

  // tapered rear housing for the tube
  const rearGeo = new RoundedBoxGeometry(0.62, 0.46, 0.32, 4, 0.06);
  const pos = rearGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = THREE.MathUtils.lerp(1, 0.62, (0.16 - pos.getZ(i)) / 0.32);
    pos.setX(i, pos.getX(i) * k); pos.setY(i, pos.getY(i) * k);
  }
  rearGeo.computeVertexNormals();
  const rear = new THREE.Mesh(rearGeo, shellMat);
  rear.position.set(0, 0.29, FRONT_Z - 0.2 - 0.14);
  g.add(rear);

  // bezel frame around the tube
  const outer = roundedRect(new THREE.Shape(), SCREEN_W + 0.05, SCREEN_H + 0.05, 0.03);
  outer.holes.push(roundedRect(new THREE.Path(), SCREEN_W, SCREEN_H, 0.02));
  const bezelGeo = new THREE.ExtrudeGeometry(outer, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 3, curveSegments: 6 });
  const bezel = new THREE.Mesh(bezelGeo, trimMat);
  bezel.position.set(0, SCREEN_Y, FRONT_Z);
  g.add(bezel);

  // black cavity behind the glass so nothing shows through the edges
  const cavity = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W + 0.01, SCREEN_H + 0.01), darkMat);
  cavity.position.set(0, SCREEN_Y, FRONT_Z + 0.001);
  g.add(cavity);

  // bulging glass: corners flush with the bezel, centre pushed out
  const sg = new THREE.PlaneGeometry(SCREEN_W, SCREEN_H, 32, 24);
  const sp = sg.attributes.position;
  for (let i = 0; i < sp.count; i++) {
    const nx = sp.getX(i) / (SCREEN_W / 2), ny = sp.getY(i) / (SCREEN_H / 2);
    sp.setZ(i, BULGE * (1 - 0.5 * (nx * nx + ny * ny)));
  }
  sg.computeVertexNormals();
  const screen = new THREE.Mesh(sg, screenMaterial);
  screen.position.set(0, SCREEN_Y, FRONT_Z + 0.004);
  g.add(screen);

  // control strip: speaker grill (left), knobs + power button + LED (right)
  const ctrlY = 0.058;
  const slot = new THREE.InstancedMesh(new THREE.BoxGeometry(0.15, 0.004, 0.004), darkMat, 7);
  const m = new THREE.Matrix4();
  for (let i = 0; i < 7; i++) slot.setMatrixAt(i, m.makeTranslation(-0.2, ctrlY - 0.03 + i * 0.01, FRONT_Z + 0.001));
  g.add(slot);

  const knobGeo = new THREE.CylinderGeometry(0.011, 0.012, 0.012, 20);
  knobGeo.rotateX(Math.PI / 2);
  for (const x of [0.12, 0.155]) {
    const k = new THREE.Mesh(knobGeo, trimMat);
    k.position.set(x, ctrlY, FRONT_Z + 0.006);
    g.add(k);
  }
  const btn = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.022, 0.012, 2, 0.004), trimMat);
  btn.position.set(0.225, ctrlY, FRONT_Z + 0.004);
  g.add(btn);
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, roughness: 0.3 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 8), ledMat);
  led.position.set(0.268, ctrlY, FRONT_Z + 0.001);
  g.add(led);

  g.traverse((c) => { if (c.isMesh && c !== screen) { c.castShadow = true; c.receiveShadow = true; } });

  // feet lift the body 12 mm
  const root = new THREE.Group();
  g.position.y = 0.012;
  root.add(g);
  const footGeo = new THREE.BoxGeometry(0.06, 0.012, 0.06);
  for (const [x, z] of [[-0.27, 0.17], [0.27, 0.17], [-0.2, -0.15], [0.2, -0.15]]) {
    const f = new THREE.Mesh(footGeo, darkMat);
    f.position.set(x, 0.006, z);
    root.add(f);
  }
  return { group: root, screen, ledMat };
}

// Power animation keyframes: [time, open.x, open.y, brightness]
const ON_KEYS = [[0, 0, 0, 1.6], [0.12, 1, 0, 1.6], [0.42, 1, 1, 1.25], [1.2, 1, 1, 1]];
const OFF_KEYS = [[0, 1, 1, 1], [0.14, 1, 0, 1.5], [0.28, 0, 0, 1.8], [0.7, 0, 0, 0]];
function sampleKeys(keys, t) {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const a = keys[i - 1], b = keys[i], f = THREE.MathUtils.smoothstep(t, a[0], b[0]);
      return [1, 2, 3].map((j) => a[j] + (b[j] - a[j]) * f);
    }
  }
  return keys[keys.length - 1].slice(1);
}

// frameId (optional): returns an id that changes when the source has a new frame (null = unknown);
// the texture is only re-uploaded then. Without it the source is uploaded every frame.
// The source canvas may change size (emulator upscaling); the shader's scanlines stay at 240 lines.
// onCrtChange(on) (optional): called when the CRT effect is switched (also by the fullscreen button).
export function createCrtTv({ sourceCanvas, frameId, onCrtChange, width = 0.7, style = "grey" } = {}) {
  if (!sourceCanvas) throw new Error("createCrtTv: sourceCanvas é obrigatório.");

  const tex = new THREE.Texture(sourceCanvas);
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  let texW = sourceCanvas.width, texH = sourceCanvas.height;

  const uniforms = {
    tSrc: { value: tex },
    srcSize: { value: new THREE.Vector2(640, 480) }, // native PS2 frame (scanline count, glow radius)
    viewRes: { value: new THREE.Vector2(1, 1) },
    time: { value: 0 },
    crt: { value: 1 },
    crtParams: { value: new THREE.Vector3(1, 1, 1) },
    aspect: { value: sourceCanvas.width / sourceCanvas.height },
    signal: { value: 0 },
    power: { value: new THREE.Vector3(0, 0, 0) },
  };
  const screenMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: CRT_FRAG });
  const { group: model, screen, ledMat } = buildBody(style, screenMaterial);
  screen.layers.enable(1); // console-scene's LIVE_LAYER: redrawn without the rest of the scene
  model.scale.setScalar(width / BASE_W);
  const object3d = new THREE.Group();
  object3d.name = "crt-tv";
  object3d.add(model);

  // Keep the source canvas rendering and focusable but invisible (see top comment).
  const prevStyle = sourceCanvas.getAttribute("style");
  Object.assign(sourceCanvas.style, { position: "fixed", left: "0", top: "0", opacity: "0.01", zIndex: "-1", pointerEvents: "none", outline: "none" });

  // Keys pressed while something else has focus (buttons, body, the fullscreen
  // overlay) are re-dispatched to the emulator canvas, where emscripten listens.
  const onKey = (e) => {
    // Esc leaves fullscreen even when the browser lets it through (or in the overlay fallback).
    if (e.key === "Escape" && fs.active) { if (e.type === "keydown") exitFullscreen(); return; }
    if (e.target === sourceCanvas) return;
    const t = e.target;
    if (t?.closest?.("dialog[open]")) return; // settings and other modal panels keep their keys
    if (t && (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT" ||
        (t.tagName === "INPUT" && !["file", "button", "checkbox", "range", "submit"].includes(t.type)))) return;
    const ev = new KeyboardEvent(e.type, {
      key: e.key, code: e.code, location: e.location, repeat: e.repeat, bubbles: true, cancelable: true,
      ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
    });
    Object.defineProperty(ev, "keyCode", { value: e.keyCode });
    Object.defineProperty(ev, "which", { value: e.which });
    Object.defineProperty(ev, "charCode", { value: e.charCode });
    sourceCanvas.dispatchEvent(ev);
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !/^F\d+$/.test(e.key)) e.preventDefault();
  };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("keyup", onKey, true);

  let powered = false, signal = false, lastFrameId = null, dirty = false;
  let anim = null; // { keys, t, resolve }

  function setPower(on) {
    on = !!on;
    if (anim) anim.resolve();
    if (on === powered && !anim) return Promise.resolve();
    powered = on;
    ledMat.emissive.setHex(on ? 0x33ff44 : 0x000000);
    ledMat.color.setHex(on ? 0x0a3310 : 0x220000);
    return new Promise((resolve) => { anim = { keys: on ? ON_KEYS : OFF_KEYS, t: 0, resolve }; });
  }

  function setSignal(on) { signal = !!on; uniforms.signal.value = signal || overlay ? 1 : 0; }

  // Shows another texture (e.g. the boot intro's render target, 4:3, raw sRGB values) instead of the
  // emulator, redrawn every frame; null goes back to the emulator.
  let overlay = null;
  function setOverlay(texture) {
    overlay = texture || null;
    uniforms.tSrc.value = overlay ?? tex;
    if (overlay) uniforms.aspect.value = 4 / 3; else uniforms.aspect.value = texW / texH;
    setSignal(signal);
    dirty = true;
  }

  // ---- fullscreen -------------------------------------------------------------
  const fs = { active: false, el: null, renderer: null, scene: null, cam: null, crtBtn: null, idle: 0 };
  let crtOn = true;

  function setCrtEffect(on) {
    const changed = crtOn !== !!on;
    crtOn = !!on;
    uniforms.crt.value = crtOn ? 1 : 0;
    dirty = true;
    if (fs.crtBtn) {
      fs.crtBtn.textContent = crtOn ? "CRT: ligado" : "CRT: desligado";
      fs.crtBtn.setAttribute("aria-pressed", String(crtOn));
    }
    if (changed) onCrtChange?.(crtOn);
  }

  // Strength of each part of the effect, 0 (off) .. 2; 1 is the default look.
  function setCrtParams({ scanlines = 1, curvature = 1, bloom = 1 } = {}) {
    const k = (v) => Math.max(0, Math.min(2, Number(v) || 0));
    uniforms.crtParams.value.set(k(scanlines), k(curvature), k(bloom));
    dirty = true;
  }


  function buildFullscreen() {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;inset:0;background:#000;z-index:2147483647;cursor:none";
    const bar = document.createElement("div");
    bar.style.cssText = "position:absolute;top:12px;right:12px;display:flex;gap:8px;transition:opacity .4s;font:14px system-ui,sans-serif";
    const mkBtn = (label, fn) => {
      const b = document.createElement("button");
      b.type = "button"; b.textContent = label;
      b.style.cssText = "background:rgba(20,20,20,.75);color:#eee;border:1px solid #555;border-radius:6px;padding:6px 12px;cursor:pointer";
      b.addEventListener("click", fn);
      bar.append(b);
      return b;
    };
    fs.crtBtn = mkBtn("", () => setCrtEffect(!crtOn));
    mkBtn("Sair (Esc)", () => exitFullscreen());
    setCrtEffect(crtOn);
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
    el.append(renderer.domElement, bar);
    el.addEventListener("mousemove", () => { fs.idle = 0; bar.style.opacity = "1"; el.style.cursor = "default"; });
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, fragmentShader: CRT_FRAG, defines: { FULLSCREEN: "" }, depthTest: false });
    const scene = new THREE.Scene();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    scene.add(quad);
    Object.assign(fs, { el, bar, renderer, scene, cam: new THREE.Camera() });
  }

  async function enterFullscreen() {
    if (fs.active) return;
    if (!fs.el) buildFullscreen();
    document.body.append(fs.el);
    fs.active = true;
    fs.idle = 0;
    fs.drawn = false;
    screen.visible = false; // TV is hidden behind the overlay; avoid a second upload
    try {
      await fs.el.requestFullscreen({ navigationUI: "hide" });
    } catch (e) {
      // No user gesture / not allowed: stay as a maximized overlay (Esc still exits).
      console.warn("Fullscreen API recusada, usando overlay maximizado:", e.message);
    }
    sourceCanvas.focus({ preventScroll: true });
  }

  async function exitFullscreen() {
    if (!fs.active) return;
    fs.active = false;
    screen.visible = true;
    fs.el.remove();
    if (document.fullscreenElement === fs.el) await document.exitFullscreen().catch(() => {});
    sourceCanvas.focus({ preventScroll: true });
  }

  const onFsChange = () => { if (fs.active && document.fullscreenElement !== fs.el) exitFullscreen(); };
  document.addEventListener("fullscreenchange", onFsChange);

  // ---- per frame ---------------------------------------------------------------
  // Returns false when the screen looks the same as last frame (no new emulator frame, no animation),
  // so the caller can skip redrawing it.
  function update(dt /* , renderer */) {
    uniforms.time.value += dt;
    let changed = dirty || !!anim || !!overlay || (powered && !signal); // power animation / static noise / overlay move every frame
    dirty = false;
    let p;
    if (anim) {
      anim.t += dt;
      p = sampleKeys(anim.keys, anim.t);
      if (anim.t >= anim.keys[anim.keys.length - 1][0]) { anim.resolve(); anim = null; }
    } else {
      p = powered ? [1, 1, 1] : [0, 0, 0];
    }
    uniforms.power.value.set(p[0], p[1], p[2]);

    // Upload the emulator's latest frame only when it can be seen and is new.
    if (signal && !overlay && (powered || anim)) {
      const id = frameId?.() ?? null;
      if (id === null || id !== lastFrameId) {
        // A texture's size is fixed once allocated: drop it so three.js reallocates at the new size.
        if (sourceCanvas.width !== texW || sourceCanvas.height !== texH) {
          texW = sourceCanvas.width; texH = sourceCanvas.height;
          uniforms.aspect.value = texW / texH; // 16:9 when the emulator outputs widescreen
          tex.dispose();
        }
        tex.needsUpdate = true; changed = true;
      }
      lastFrameId = id;
    }

    if (fs.active) {
      const r = fs.renderer;
      const w = fs.el.clientWidth, h = fs.el.clientHeight;
      const size = r.getSize(new THREE.Vector2());
      const resized = size.x !== w || size.y !== h || !fs.drawn;
      if (resized) r.setSize(w, h, false);
      r.getDrawingBufferSize(uniforms.viewRes.value);
      fs.idle += dt;
      if (fs.idle > 2.5) { fs.bar.style.opacity = "0"; fs.el.style.cursor = "none"; }
      // An undrawn WebGL canvas keeps showing its last frame.
      if (changed || resized) { r.render(fs.scene, fs.cam); fs.drawn = true; }
      return false; // the TV screen is hidden behind the overlay
    }
    return changed;
  }

  function dispose() {
    if (fs.active) exitFullscreen();
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("keyup", onKey, true);
    document.removeEventListener("fullscreenchange", onFsChange);
    if (fs.renderer) { fs.renderer.dispose(); fs.scene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); }); }
    object3d.removeFromParent();
    object3d.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
    tex.dispose();
    if (prevStyle === null) sourceCanvas.removeAttribute("style"); else sourceCanvas.setAttribute("style", prevStyle);
  }

  return {
    object3d, update, setPower, setSignal, setOverlay, setCrtEffect, setCrtParams,
    enterFullscreen, exitFullscreen, isFullscreen: () => fs.active, dispose,
  };
}
