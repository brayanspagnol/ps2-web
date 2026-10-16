// 3D console scene: a procedural model of the original "fat" PlayStation 2
// (SCPH-3xxxx/5xxxx) on a dark surface, with disc insert/eject animations and
// camera moves. No external assets: logos and markings are drawn into canvases.
// Layout follows reference photos of the SCPH-30001: an upper slab with stacked
// fins wrapping the front and right side (tray, memory cards, controller ports,
// reset/eject buttons), a recessed lower base (USB/i.LINK panel, vent grille),
// "PS2" + "PlayStation 2" logo on the matte top, rotatable PS logo on the tray.
//
// Units: 1 unit = 1 metre. The console is life-size (0.301 W x 0.078 H x 0.182 D),
// sitting on the floor plane y = 0, centred at the origin, front facing +Z.
//
// tvAnchor: an Object3D at the bottom-centre of the TV footprint, on y = 0,
// behind the console. The TV attached to it should be built in the anchor's
// local space as: x in [-0.35, 0.35], y in [0, 0.55], z in [-0.25, 0.25]
// (0.70 W x 0.55 H x 0.50 D), screen facing +Z. focusTv() frames the screen
// and its bezel (centre about local (0, 0.32, 0.25)) from slightly above.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Layer of objects that redraw every frame (the TV screen, see frame()).
export const LIVE_LAYER = 1;
const MM = 0.001;
const TV_POS = new THREE.Vector3(0, 0, -0.44);
// What focusTv() keeps in view, in TV-anchor space: tube + bezel (crt-tv.js:
// 0.488 x 0.366 screen centred at y 0.327 incl. its feet).
const TV_FRAME = { center: new THREE.Vector3(0, 0.312, 0.25), w: 0.62, h: 0.5 };

// Console dimensions (mm). Upper slab y 40..78, base y 2.5..40.
const W = 301, D = 182;
const XL = -W / 2, XR = W / 2, ZB = -D / 2, ZF = D / 2;   // upper slab extents
const BASE = { x1: 130, zf: 72, y0: 2.5, y1: 40 };          // base is set back at the front/right
const LID = [71, 78];
const FINS = [[64.5, 69], [58, 62.5], [51.5, 56], [45, 49.5], [40, 43]];
const GROOVE_DEPTH = 3.5;

// Disc tray (mm): lower three fins between the memory cards and the buttons.
const TRAY = { x0: -4.5, x1: 126.5, y0: 40, y1: 56 };
const TRAY_X = ((TRAY.x0 + TRAY.x1) / 2) * MM;
const TRAY_W = TRAY.x1 - TRAY.x0;
const TRAY_LEN = 0.15, TRAY_TRAVEL = 0.142;
const TRAY_Y = 0.0475;                      // top surface of the tray bed
const DISC_R = 0.06, DISC_HOLE = 0.0075, DISC_T = 0.0012;

const LED_OFF = new THREE.Color("#ff2a1a"); // standby
const LED_ON = new THREE.Color("#2bff6a");  // disc loaded
const LED_EJECT = new THREE.Color("#2a7bff");
const EJECT_DIM = new THREE.Color("#0c1a3a");

const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
};

export function createConsoleScene(container, opts = {}) {
  // ---------- renderer / scene ----------
  // preserveDrawingBuffer: while nothing but the live layer changes, frames only redraw that layer
  // over the previous one (see frame()).
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.maxPixelRatio ?? 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = opts.exposure ?? 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
  container.appendChild(renderer.domElement);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const bg = new THREE.Color("#07080b");
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 1.6, 4.2);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = 0.32;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 20);

  // ---------- lights ----------
  const key = new THREE.SpotLight("#fff1e0", 6, 4, 0.55, 0.85, 1.6);
  key.position.set(0.75, 1.25, 0.9);
  key.target.position.set(0, 0.05, -0.12);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 3;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.003;
  scene.add(key, key.target);

  const rim = new THREE.DirectionalLight("#a9bfff", 1.0);
  rim.position.set(-1.2, 0.8, -1.4);
  scene.add(rim);
  const rim2 = new THREE.DirectionalLight("#ffd2a8", 0.8);
  rim2.position.set(1.4, 0.4, -0.9);
  scene.add(rim2);
  const fill = new THREE.DirectionalLight("#dfe6ff", 0.35); // lifts the black front a little
  fill.position.set(0.2, 0.3, 1.5);
  scene.add(fill);
  scene.add(new THREE.HemisphereLight("#9fb4ff", "#0b0b0e", 0.25));

  // ---------- floor ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshLambertMaterial({ color: "#24252b" }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // ---------- textures & materials ----------
  const textures = [];
  const canvasTex = (w, h, draw) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    textures.push(t);
    return t;
  };
  const grain = grainTexture();
  textures.push(grain);

  const BODY = "#111214";
  const mat = {
    // Matte, finely grained shell (top lid, base).
    shell: new THREE.MeshPhysicalMaterial({ color: BODY, roughness: 0.7, bumpMap: grain, bumpScale: 0.6, clearcoat: 0.08, clearcoatRoughness: 0.6 }),
    // The fins are smoother and catch thin highlights.
    fin: new THREE.MeshPhysicalMaterial({ color: "#121316", roughness: 0.34, clearcoat: 0.45, clearcoatRoughness: 0.3 }),
    core: new THREE.MeshStandardMaterial({ color: "#060607", roughness: 0.9 }),
    hole: new THREE.MeshBasicMaterial({ color: "#020203" }),
    button: new THREE.MeshPhysicalMaterial({ color: "#16171b", roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
    tray: new THREE.MeshStandardMaterial({ color: "#09090b", roughness: 0.85, envMapIntensity: 0.4 }),
  };
  const decalMat = (map, extra = {}) => new THREE.MeshStandardMaterial({
    map, transparent: true, depthWrite: false, roughness: 0.45, polygonOffset: true, polygonOffsetFactor: -2, ...extra,
  });

  // ---------- console ----------
  const consoleGroup = new THREE.Group();
  scene.add(consoleGroup);
  const addMesh = (geo, m, parent = consoleGroup, shadow = true) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = shadow; mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };

  // Upper slab: lid + fins (merged into one mesh) around a dark inset core that
  // shows through the grooves on the front and right side.
  const lidGeo = box(XL, XR, LID[0], LID[1], ZB, ZF, 2.5);
  const lidN = lidGeo.attributes.position.count;
  const finGeos = [lidGeo];
  for (const [y0, y1] of FINS) {
    const inTray = y1 <= TRAY.y1 + 0.01;
    if (!inTray) { finGeos.push(box(XL, XR, y0, y1, ZB, ZF, 1.2)); continue; }
    finGeos.push(box(XL, TRAY.x0 - 1, y0, y1, ZB, ZF, 1.2));   // left of the tray
    finGeos.push(box(TRAY.x1 + 1, XR, y0, y1, ZB, ZF, 1.2));   // right of the tray
    finGeos.push(box(TRAY.x0 - 1, TRAY.x1 + 1, y0, y1, ZB, ZF - 30, 1.2)); // behind it
  }
  finGeos.push(box(XL, XL + 4, FINS.at(-1)[0] + 0.5, LID[0], ZB + 0.5, ZF - 6, 0.5)); // left side is flat
  const lidFins = mergeGeometries(finGeos);
  finGeos.forEach((g) => g.dispose());
  // The lid gets the grained shell, the fins the smoother plastic.
  lidFins.addGroup(0, lidN, 0);
  lidFins.addGroup(lidN, Infinity, 1);
  addMesh(lidFins, [mat.shell, mat.fin]);
  addMesh(box(XL, XR - GROOVE_DEPTH, FINS.at(-1)[0], LID[0], ZB, ZF - GROOVE_DEPTH, 0.5), mat.core, consoleGroup, false);
  // Base, set back from the front and the right side.
  addMesh(box(XL, BASE.x1, BASE.y0, BASE.y1 + 0.5, ZB, BASE.zf, 1.5), mat.shell);
  // Feet + the rubber tabs on the left side used when standing vertically.
  const tabs = [];
  for (const [x, z] of [[-130, -70], [110, -70], [-130, 55], [110, 55]]) tabs.push(box(x - 6, x + 6, 0, BASE.y0 + 0.5, z - 6, z + 6, 0.8));
  for (const [y, z] of [[60, -78], [60, 76], [20, -78], [20, 60]]) tabs.push(box(XL - 0.8, XL + 1, y - 5, y + 5, z - 4, z + 4, 0.5));
  addMesh(mergeGeometries(tabs), mat.core, consoleGroup, false);
  tabs.forEach((g) => g.dispose());

  // Top: "PS2" logo with "PlayStation 2" embossed under it, DVD marks near the front.
  const topTex = canvasTex(2048, Math.round(2048 * D / W), drawTop);
  const top = addMesh(new THREE.PlaneGeometry((W - 4) * MM, (D - 4) * MM), decalMat(topTex, { emissive: "#ffffff", emissiveMap: topTex, emissiveIntensity: 0.06 }), consoleGroup, false);
  top.rotation.x = -Math.PI / 2;
  top.position.y = LID[1] * MM + 0.00005;

  // Upper front markings: memory card slots, controller ports, labels, SONY.
  const frontH = LID[1] - FINS.at(-1)[0];
  const frontTex = canvasTex(4096, Math.round(4096 * frontH / W), drawUpperFront);
  const frontDecal = addMesh(new THREE.PlaneGeometry(W * MM, frontH * MM), decalMat(frontTex), consoleGroup, false);
  frontDecal.position.set(0, (FINS.at(-1)[0] + frontH / 2) * MM, ZF * MM + 0.0003);

  // Base front: blue USB / i.LINK panel and the vent grille.
  const baseW = BASE.x1 - XL, baseH = BASE.y1 - BASE.y0;
  const baseTex = canvasTex(2048, Math.round(2048 * baseH / baseW), drawBaseFront);
  const baseFront = addMesh(new THREE.PlaneGeometry((baseW - 2) * MM, (baseH - 1.5) * MM),
    new THREE.MeshStandardMaterial({ map: baseTex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }), consoleGroup, false);
  baseFront.position.set(((XL + BASE.x1) / 2) * MM, ((BASE.y0 + BASE.y1) / 2 + 0.25) * MM, BASE.zf * MM + 0.0002);

  // Dark opening behind the tray front (seen when the tray is out).
  const opening = addMesh(new THREE.PlaneGeometry((TRAY_W + 2) * MM, (TRAY.y1 - TRAY.y0) * MM), mat.hole, consoleGroup, false);
  opening.position.set(TRAY_X, ((TRAY.y0 + TRAY.y1) / 2) * MM, (ZF - GROOVE_DEPTH + 0.1) * MM);

  // Buttons (right end): power/reset on top, eject below. Their icons are the LEDs.
  const btnGeo = new RoundedBoxGeometry(15 * MM, 10.5 * MM, 3 * MM, 2, 1 * MM);
  const btnPower = addMesh(btnGeo, mat.button);
  btnPower.position.set(137 * MM, 63.6 * MM, (ZF + 0.2) * MM);
  const btnEject = addMesh(btnGeo, mat.button);
  btnEject.position.set(137 * MM, 47.3 * MM, (ZF + 0.2) * MM);

  const iconPlane = new THREE.PlaneGeometry(7 * MM, 7 * MM);
  const powerIcon = canvasTex(128, 128, (g, s) => drawPowerIcon(g, s));
  const ejectIcon = canvasTex(128, 128, (g, s) => drawEjectIcon(g, s));
  const ledMat = new THREE.MeshBasicMaterial({ map: powerIcon, color: LED_OFF.clone(), transparent: true, depthWrite: false });
  const ejectLedMat = new THREE.MeshBasicMaterial({ map: ejectIcon, color: EJECT_DIM.clone(), transparent: true, depthWrite: false });
  const led = new THREE.Mesh(iconPlane, ledMat);
  led.position.set(0, 1.4 * MM, 1.55 * MM);
  btnPower.add(led);
  const ejectLed = new THREE.Mesh(iconPlane, ejectLedMat);
  ejectLed.position.set(0, 0.6 * MM, 1.55 * MM);
  btnEject.add(ejectLed);
  const resetTex = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = "#3fc2c9"; g.font = `600 ${h * 0.62}px Arial, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("RESET", w / 2, h / 2);
  });
  const reset = new THREE.Mesh(new THREE.PlaneGeometry(9 * MM, 2.25 * MM), new THREE.MeshBasicMaterial({ map: resetTex, transparent: true, depthWrite: false }));
  reset.position.set(0, -3.3 * MM, 1.55 * MM);
  btnPower.add(reset);

  // Additive glow sprites for LEDs (cheaper than lights, no post-processing).
  const glowTex = radialTexture();
  textures.push(glowTex);
  const makeGlow = (color, size) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true, opacity: 0.55,
    }));
    s.scale.setScalar(size);
    s.renderOrder = 10;
    return s;
  };
  const ledGlow = makeGlow(LED_OFF.clone(), 0.016);
  ledGlow.position.z = 0.001; led.add(ledGlow);
  const ejectGlow = makeGlow(LED_EJECT.clone(), 0.016);
  ejectGlow.position.z = 0.001; ejectGlow.material.opacity = 0; ejectLed.add(ejectGlow);

  // ---------- tray ----------
  // Local frame: x centred on the tray, z = 0 at the front face of the closed tray.
  const tray = new THREE.Group();
  const trayClosedZ = ZF * MM;
  tray.position.set(TRAY_X, 0, trayClosedZ);
  consoleGroup.add(tray);
  const hw = TRAY_W / 2;
  const trayFins = [];
  for (const [y0, y1] of FINS) if (y1 <= TRAY.y1 + 0.01) trayFins.push(box(-hw, hw, y0, y1, -GROOVE_DEPTH, 0, 1.0));
  trayFins.push(box(-hw + 0.5, hw - 0.5, TRAY.y0, TRAY.y1, -GROOVE_DEPTH - 1.5, -GROOVE_DEPTH + 0.6, 0.3)); // groove backing
  addMesh(mergeGeometries(trayFins), mat.fin, tray);
  trayFins.forEach((g) => g.dispose());
  // PS logo on the tray front (it can be turned for the vertical stance).
  const psTex = canvasTex(256, 256, drawPsLogo);
  const psLogo = addMesh(new THREE.PlaneGeometry(10 * MM, 10 * MM), decalMat(psTex, { roughness: 0.3 }), tray, false);
  psLogo.position.set(6 * MM, 47.25 * MM, 0.0003);
  // Tray bed with the 12 cm / 8 cm disc recesses.
  const seatZ = -(GROOVE_DEPTH + 1.5) * MM - TRAY_LEN / 2;
  const bed = addMesh(new THREE.BoxGeometry((TRAY_W - 3) * MM, 3 * MM, TRAY_LEN), mat.tray, tray);
  bed.position.set(0, TRAY_Y - 0.0015, seatZ);
  const recessTex = canvasTex(512, 512, drawRecess);
  const well = addMesh(new THREE.PlaneGeometry(TRAY_W * MM - 0.004, TRAY_W * MM - 0.004), new THREE.MeshStandardMaterial({ map: recessTex, roughness: 0.7, transparent: true }), tray, false);
  well.rotation.x = -Math.PI / 2;
  well.position.set(0, TRAY_Y + 0.0001, seatZ);
  const seatLocal = new THREE.Vector3(0, TRAY_Y + DISC_T / 2 + 0.0003, seatZ);

  // ---------- TV anchor ----------
  const tvAnchor = new THREE.Object3D();
  tvAnchor.name = "tvAnchor";
  tvAnchor.position.copy(TV_POS);
  scene.add(tvAnchor);

  // ---------- render loop (on demand) ----------
  const tweens = new Set();
  const frameCbs = new Set();
  let raf = 0, poll = 0, idle = 0, last = 0, disposed = false, fullRender = true;

  // Objects on LIVE_LAYER (besides layer 0) change on their own (the TV screen). When no tween runs and
  // nothing called invalidate(), only they are redrawn over the last full frame, and only if an onFrame
  // callback did not return false: the full scene (shadows, physical materials, MSAA) costs GPU time
  // the emulator needs while playing.
  // On the console view (the shelf) the TV is off: once nothing has changed for a moment, the callbacks
  // are polled a few times a second instead of every display frame, so an idle page costs ~nothing.
  // Starting a tween or calling invalidate() goes back to full rate at once.
  function schedule(slow) {
    if (raf || poll || disposed) return;
    if (slow) poll = setTimeout(() => { poll = 0; frame(performance.now()); }, 200);
    else raf = requestAnimationFrame(frame);
  }
  function frame(now) {
    raf = 0;
    if (disposed) return;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 0;
    last = now;
    const full = fullRender || tweens.size > 0;
    fullRender = false;
    for (const tw of [...tweens]) {
      const p = Math.min((now - tw.t0) / tw.ms, 1);
      tw.fn(tw.ease(p));
      if (p >= 1) { tweens.delete(tw); tw.done(); }
    }
    let live = false; // a callback returning false means its live objects did not change
    for (const cb of frameCbs) if (cb(dt) !== false) live = true;
    applyCamera();
    if (full) {
      renderer.render(scene, camera);
    } else if (live) {
      renderer.autoClear = false;
      scene.background = null; // a Color background always clears
      camera.layers.set(LIVE_LAYER);
      renderer.render(scene, camera);
      camera.layers.set(0);
      scene.background = bg;
      renderer.autoClear = true;
    }
    idle = full || live ? 0 : idle + dt;
    if (tweens.size || frameCbs.size) schedule(view === "console" && idle > 0.5);
    else last = 0;
  }
  function invalidate() {
    fullRender = true;
    clearTimeout(poll); poll = 0;
    schedule(false);
  }

  function tween(ms, fn, easing = ease.inOut) {
    return new Promise((done) => {
      tweens.add({ t0: performance.now(), ms, fn, ease: easing, done });
      invalidate();
    });
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- camera ----------
  const cam = { pos: new THREE.Vector3(), target: new THREE.Vector3() };
  const camOffset = new THREE.Vector3(); // transient offset (insert "nudge")
  let view = "console";

  function fitDistance(w, h) {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    return Math.max(h / 2 / t, w / 2 / (t * camera.aspect));
  }
  function viewPose(name) {
    if (name === "tv") {
      // Straight on but from a little above, so the console (on the floor in
      // front of the TV) stays under the bottom of the bezel at any aspect.
      const c = TV_FRAME.center.clone().add(tvAnchor.position);
      const d = fitDistance(TV_FRAME.w, TV_FRAME.h);
      const tilt = THREE.MathUtils.degToRad(7);
      return { target: c, pos: c.clone().add(new THREE.Vector3(0, Math.sin(tilt) * d, Math.cos(tilt) * d)) };
    }
    // Hero: three-quarter view of the console, TV looming behind.
    const target = new THREE.Vector3(-0.005, 0.05, 0.0);
    const dir = new THREE.Vector3(0.48, 0.42, 1).normalize();
    const d = fitDistance(0.52, 0.4);
    return { target, pos: target.clone().addScaledVector(dir, d) };
  }
  function applyCamera() {
    camera.position.copy(cam.pos).add(camOffset);
    camera.lookAt(cam.target);
  }
  function moveCamera(name, ms = 1400) {
    view = name;
    const to = viewPose(name);
    const p0 = cam.pos.clone(), t0 = cam.target.clone();
    // Arc slightly upward in the middle so the move feels like a dolly, not a zoom.
    return tween(ms, (t) => {
      cam.pos.lerpVectors(p0, to.pos, t);
      cam.pos.y += Math.sin(Math.PI * t) * 0.04;
      cam.target.lerpVectors(t0, to.target, t);
    });
  }

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!tweens.size) { const p = viewPose(view); cam.pos.copy(p.pos); cam.target.copy(p.target); }
    invalidate();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---------- disc ----------
  let disc = null;
  const discUnderTex = canvasTex(512, 512, drawDiscUnderside);
  discUnderTex.userData.shared = true;

  function makeDisc(game) {
    const tex = canvasTex(1024, 1024, (g, s) => drawDiscLabel(g, s, game));
    textures.splice(textures.indexOf(tex), 1); // owned by the disc, freed with it
    const g = new THREE.Group();
    const ring = new THREE.RingGeometry(DISC_HOLE, DISC_R, 96, 1);
    const top = new THREE.Mesh(ring, new THREE.MeshPhysicalMaterial({
      map: tex, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.3, transparent: true,
    }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = DISC_T / 2;
    const bottom = new THREE.Mesh(ring, new THREE.MeshPhysicalMaterial({
      map: discUnderTex, color: "#cfd6ff", roughness: 0.1, metalness: 1, iridescence: 0.8, iridescenceIOR: 1.5,
      iridescenceThicknessRange: [250, 650], transparent: true,
    }));
    bottom.rotation.x = Math.PI / 2;
    bottom.position.y = -DISC_T / 2;
    const edge = new THREE.Mesh(
      new THREE.CylinderGeometry(DISC_R, DISC_R, DISC_T, 96, 1, true),
      new THREE.MeshStandardMaterial({ color: "#9aa0ad", roughness: 0.3, metalness: 0.6, transparent: true }),
    );
    g.add(top, bottom, edge);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.userData.setOpacity = (a) => g.traverse((o) => { if (o.isMesh) o.material.opacity = a; });
    return g;
  }

  // ---------- animations ----------
  const trayOpenPos = () => trayClosedZ + TRAY_TRAVEL;
  const ejectZ = btnEject.position.z;
  function moveTray(open, ms = 750) {
    const z0 = tray.position.z, z1 = open ? trayOpenPos() : trayClosedZ;
    return Promise.all([
      tween(ms, (t) => { tray.position.z = lerp(z0, z1, t); }, ease.inOut),
      // tiny button press
      tween(220, (t) => { btnEject.position.z = ejectZ - Math.sin(Math.PI * t) * 0.0012; }),
    ]);
  }
  function setLed(color, ms = 500) {
    const c0 = ledMat.color.clone();
    return tween(ms, (t) => {
      ledMat.color.copy(c0).lerp(color, t);
      ledGlow.material.color.copy(ledMat.color);
    });
  }
  function blinkEject(ms) {
    return tween(ms, (t) => {
      const on = t < 1 && Math.sin(t * ms / 1000 * Math.PI * 2 * 2.2) > 0;
      ejectLedMat.color.copy(on ? LED_EJECT : EJECT_DIM);
      ejectGlow.material.opacity = on ? 0.8 : 0;
    }, (t) => t);
  }
  function nudgeCamera(ms, amount) {
    const dir = new THREE.Vector3().subVectors(cam.target, cam.pos).normalize();
    return tween(ms, (t) => { camOffset.copy(dir).multiplyScalar(Math.sin(Math.PI * t) * amount); }, (t) => t);
  }

  let queue = Promise.resolve();
  const serial = (fn) => (...args) => (queue = queue.then(() => fn(...args), () => fn(...args)));

  async function doEject() {
    if (!disc) return;
    const d = disc;
    blinkEject(1700);
    setLed(LED_OFF, 600);
    await moveTray(true);
    // Lift the disc out of the tray and fly it toward the camera while fading.
    scene.attach(d);
    d.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    const p0 = d.position.clone();
    const p1 = camera.position.clone().lerp(p0, 0.55).add(new THREE.Vector3(0, 0.08, 0));
    const r0 = d.rotation.clone();
    await tween(850, (t) => {
      d.position.lerpVectors(p0, p1, t);
      d.rotation.set(r0.x + t * 0.9, r0.y + t * 2.5, r0.z + t * 0.3);
      d.userData.setOpacity(1 - ease.in(t));
    }, ease.inOut);
    disposeObject(d);
    scene.remove(d);
    disc = null;
    await moveTray(false);
  }

  async function doInsert(game) {
    if (disc) await doEject();
    const d = makeDisc(game);
    disc = d;
    d.userData.game = game;
    scene.add(d);

    // Where the disc ends up (in world space) when the tray is fully open.
    const seatWorld = seatLocal.clone();
    seatWorld.z += trayOpenPos();
    seatWorld.x += TRAY_X;
    consoleGroup.localToWorld(seatWorld);
    // Start: floating between the camera and the tray, tilted toward the viewer.
    const start = camera.position.clone().lerp(seatWorld, 0.5).add(new THREE.Vector3(0, 0.12, 0));
    d.position.copy(start);
    d.userData.setOpacity(0);

    blinkEject(1100);
    const trayP = moveTray(true, 800);
    const camP = nudgeCamera(2600, 0.06);
    await tween(1300, (t) => {
      const p = ease.out(t);
      d.position.lerpVectors(start, seatWorld, p);
      d.position.y += Math.sin(Math.PI * p) * 0.03; // slight arc
      const tilt = (1 - p) * 0.9;
      d.rotation.set(tilt, (1 - p) * Math.PI * 2.2, -tilt * 0.4);
      d.userData.setOpacity(Math.min(1, t * 3));
    }, (t) => t);
    await trayP;
    // Settle bounce.
    await tween(180, (t) => { d.position.y = seatWorld.y + Math.sin(Math.PI * t) * 0.002; }, (t) => t);
    d.userData.setOpacity(1);
    tray.attach(d);
    await moveTray(false, 850);
    await Promise.all([setLed(LED_ON, 600), camP]);
  }

  // ---------- public API ----------
  const api = {
    scene, camera, renderer, tvAnchor,
    insertDisc: serial(doInsert),
    ejectDisc: serial(doEject),
    focusTv: serial(() => moveCamera("tv")),
    focusConsole: serial(() => moveCamera("console")),
    onFrame(cb) {
      frameCbs.add(cb);
      invalidate();
      return () => frameCbs.delete(cb);
    },
    invalidate, // request one re-render after external changes (e.g. TV texture updated once)
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf); clearTimeout(poll);
      ro.disconnect();
      tweens.clear(); frameCbs.clear();
      disposeObject(scene);
      for (const t of textures) t.dispose();
      envTex.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  invalidate();
  return api;
}

// ---------- geometry helpers ----------
// Rounded box from min/max extents in millimetres (non-indexed, so boxes can be merged).
function box(x0, x1, y0, y1, z0, z1, r) {
  const g = new RoundedBoxGeometry((x1 - x0) * MM, (y1 - y0) * MM, (z1 - z0) * MM, 1, r * MM);
  g.translate(((x0 + x1) / 2) * MM, ((y0 + y1) / 2) * MM, ((z0 + z1) / 2) * MM);
  return g;
}

// ---------- canvas art ----------
function grainTexture() {
  const S = 256, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 110 + Math.random() * 60;
    img.data.set([v, v, v, 255], i * 4);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  return t;
}

function radialTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.2, "rgba(255,255,255,0.5)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const SANS = "'Helvetica Neue', Arial, sans-serif";

// Text that looks moulded into black plastic: dark fill with a faint lit edge.
function emboss(g, text, x, y, px) {
  g.fillStyle = "rgba(255,255,255,0.10)";
  g.fillText(text, x - px * 0.04, y - px * 0.04);
  g.fillStyle = "#0a0b0d";
  g.fillText(text, x, y);
}

// Top of the console, canvas x = world +X, canvas down = world +Z (front).
function drawTop(g, w, h) {
  const k = w / W; // px per mm
  const X = (mm) => (mm - XL) * k, Z = (mm) => (mm - ZB) * k;
  // The logo reads from back to front with its top toward the right side,
  // as on the real console (upright when it stands vertically).
  g.save();
  g.translate(X(16), Z(-4));
  g.rotate(Math.PI / 2);
  const len = 128 * k, s = len / 1575; // logo artwork units (PS2 glyphs 1575 x 272)
  g.scale(s, s);
  g.translate(-952, -640);
  const grd = g.createLinearGradient(0, 500, 0, 770);
  grd.addColorStop(0, "#2a3bd8");
  grd.addColorStop(1, "#39bdf0");
  g.strokeStyle = grd;
  g.lineWidth = 15;
  g.lineJoin = "miter"; g.lineCap = "butt";
  const poly = (pts) => { g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke(); };
  poly([[168, 505], [645, 505], [645, 630], [180, 630], [180, 768]]);                 // P
  poly([[662, 760], [940, 760], [940, 510], [1228, 510]]);                             // S
  poly([[1253, 505], [1730, 505], [1730, 630], [1265, 630], [1265, 760], [1738, 760]]); // 2
  g.font = `400 112px ${SANS}`;
  g.textAlign = "center"; g.textBaseline = "alphabetic";
  emboss(g, "PlayStation 2", 945, 975, 112);
  g.restore();
  // Format marks along the front edge, right half.
  g.font = `700 ${4 * k}px ${SANS}`;
  g.textAlign = "left"; g.textBaseline = "middle";
  let x = X(28);
  for (const t of ["disc COMPACT", "DIGITAL AUDIO", "dts", "DVD VIDEO", "DVD"]) {
    emboss(g, t, x, Z(84), 4 * k);
    x += g.measureText(t).width + 5 * k;
  }
}

// Upper front (y 40..78 mm): memory cards, controller ports, labels, SONY.
function drawUpperFront(g, w, h) {
  const k = w / W;
  const X = (mm) => (mm - XL) * k, Y = (mm) => (LID[1] - mm) * k;
  const rr = (x, y, ww, hh, r) => { g.beginPath(); g.roundRect(X(x - ww / 2), Y(y + hh / 2), ww * k, hh * k, r * k); };
  g.textAlign = "center"; g.textBaseline = "middle";
  for (const [i, cx] of [[1, -105], [2, -52]]) {
    // Memory card slot: grey frame, black slot, label.
    rr(cx, 60.25, 44, 4.3, 0.8); g.fillStyle = "#1f2024"; g.fill();
    rr(cx, 61.1, 40, 1.5, 0.5); g.fillStyle = "#010101"; g.fill();
    g.fillStyle = "#8d9097"; g.font = `500 ${1.35 * k}px ${SANS}`;
    g.fillText("MEMORY CARD", X(cx), Y(59.3));
    g.font = `500 ${2.6 * k}px ${SANS}`;
    g.fillText(String(i), X(cx), Y(66.8));
    // Controller port: black capsule with three groups of three pins.
    rr(cx, 50.5, 37, 6.4, 2.6); g.fillStyle = "#26272c"; g.fill();
    rr(cx, 50.5, 35, 4.8, 2); g.fillStyle = "#020203"; g.fill();
    for (let gi = -1; gi <= 1; gi++) for (let p = -1; p <= 1; p++) {
      rr(cx + gi * 10 + p * 2.7, 50.5, 1.6, 2.1, 0.7); g.fillStyle = "#5b5e66"; g.fill();
    }
  }
  g.fillStyle = "#8d9097"; g.font = `700 ${1.7 * k}px ${SANS}`;
  g.fillText("MAGICGATE", X(-78.5), Y(63.4));
  // SONY, reading top to bottom on the right end.
  g.save();
  g.translate(X(148.3), Y(57));
  g.rotate(Math.PI / 2);
  g.font = `700 ${3.4 * k}px 'Times New Roman', serif`;
  g.fillStyle = "#d6d7da";
  g.fillText("SONY", 0, 0);
  g.restore();
}

// Base front (x -150.5..130, y 2.5..40 mm): USB / i.LINK panel and vent grille.
function drawBaseFront(g, w, h) {
  const k = w / (BASE.x1 - XL);
  const X = (mm) => (mm - XL) * k, Y = (mm) => (BASE.y1 - mm) * k;
  const rect = (x0, y0, x1, y1, fill, r = 0) => { g.beginPath(); g.roundRect(X(x0), Y(y1), (x1 - x0) * k, (y1 - y0) * k, r * k); g.fillStyle = fill; g.fill(); };
  rect(XL - 1, BASE.y0 - 1, BASE.x1 + 1, BASE.y1 + 1, "#151619");
  // Blue panel.
  rect(-146, 7, -113, 36, "#2a56b8", 1);
  const pg = g.createLinearGradient(0, Y(36), 0, Y(7));
  pg.addColorStop(0, "rgba(255,255,255,0.18)"); pg.addColorStop(1, "rgba(0,0,0,0.15)");
  rect(-146, 7, -113, 36, pg, 1);
  for (const y of [28.5, 19.5]) {          // two USB ports
    rect(-143, y - 3, -130, y + 3, "#0b0c10", 0.6);
    rect(-141.5, y - 0.2, -131.5, y + 1.6, "#9aa0aa", 0.2);
  }
  rect(-125, 28.5 - 2.3, -119, 28.5 + 2.3, "#0b0c10", 0.8); // i.LINK
  g.fillStyle = "#cfe0ff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = `700 ${4 * k}px ${SANS}`;
  g.fillText("i", X(-122), Y(20));
  g.font = `700 ${2.6 * k}px ${SANS}`;
  g.fillText("⇆", X(-127.5), Y(13));
  // Vent grille: a grid of dark slots.
  rect(-104, 6, 124, 35, "#1e1f23", 0.8);
  const cols = 15, rows = 8, gx = 1.6, gy = 1.3;
  const cw = (228 - gx * (cols + 1)) / cols, ch = (29 - gy * (rows + 1)) / rows;
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    const x0 = -104 + gx + c * (cw + gx), y0 = 6 + gy + r * (ch + gy);
    rect(x0, y0, x0 + cw, y0 + ch, "#000000", 0.3);
    rect(x0, y0, x0 + cw, y0 + ch * 0.22, "rgba(255,255,255,0.06)");
  }
}

// PlayStation logo: red P standing on a flattened, skewed S (yellow / blue / green).
function drawPsLogo(g, s) {
  g.clearRect(0, 0, s, s);
  g.save();
  g.translate(s * 0.5, s * 0.5);
  // S: three skewed bars forming a flattened S, under the P.
  g.save();
  g.translate(0, s * 0.2);
  g.transform(1, 0, -0.9, 0.35, 0, 0);
  g.lineWidth = s * 0.15; g.lineCap = "round";
  const seg = (col, pts) => { g.strokeStyle = col; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts.slice(1)) g.lineTo(...p); g.stroke(); };
  seg("#00a3e0", [[s * 0.32, -s * 0.28], [-s * 0.1, -s * 0.28], [-s * 0.26, -s * 0.12]]);
  seg("#00a650", [[-s * 0.26, -s * 0.12], [-s * 0.1, 0], [s * 0.18, 0], [s * 0.3, s * 0.14]]);
  seg("#f5b400", [[s * 0.3, s * 0.14], [s * 0.14, s * 0.28], [-s * 0.32, s * 0.28]]);
  g.restore();
  // P.
  g.fillStyle = "#e4141b";
  g.beginPath();
  g.moveTo(-s * 0.16, s * 0.2);
  g.lineTo(-s * 0.16, -s * 0.42);
  g.bezierCurveTo(s * 0.3, -s * 0.42, s * 0.32, -s * 0.02, -s * 0.02, -s * 0.06);
  g.lineTo(-s * 0.02, -s * 0.16);
  g.bezierCurveTo(s * 0.12, -s * 0.16, s * 0.12, -s * 0.3, -s * 0.02, -s * 0.3);
  g.lineTo(-s * 0.02, s * 0.26);
  g.closePath();
  g.fill();
  g.restore();
}

function drawPowerIcon(g, s) {
  g.strokeStyle = "#fff"; g.lineWidth = s * 0.09; g.lineCap = "round";
  g.beginPath(); g.arc(s / 2, s * 0.54, s * 0.24, -Math.PI * 0.3, Math.PI * 1.3); g.stroke();
  g.beginPath(); g.moveTo(s / 2, s * 0.2); g.lineTo(s / 2, s * 0.5); g.stroke();
}
function drawEjectIcon(g, s) {
  g.fillStyle = "#fff";
  g.beginPath(); g.moveTo(s / 2, s * 0.22); g.lineTo(s * 0.78, s * 0.56); g.lineTo(s * 0.22, s * 0.56); g.closePath(); g.fill();
  g.fillRect(s * 0.22, s * 0.64, s * 0.56, s * 0.1);
}

// Tray bed seen from above: 12 cm and 8 cm recesses with a centre hole.
function drawRecess(g, s) {
  const c = s / 2, k = s / TRAY_W; // px per mm
  g.clearRect(0, 0, s, s);
  g.fillStyle = "#050506"; g.beginPath(); g.arc(c, c, 61 * k, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(255,255,255,0.07)"; g.lineWidth = 0.8 * k;
  g.beginPath(); g.arc(c, c, 61 * k, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(c, c, 40.5 * k, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#000"; g.beginPath(); g.arc(c, c, 16 * k, 0, Math.PI * 2); g.fill();
}

// Label side. labelCanvas can be any image (round disc art or a square cover):
// it is cover-fitted and clipped to the printable ring, around a clear hub.
function drawDiscLabel(g, S, game) {
  const c = S / 2, R = S / 2, mm = R / (DISC_R / MM);
  const ring = (r0, r1) => { g.beginPath(); g.arc(c, c, r1, 0, Math.PI * 2); g.arc(c, c, r0, 0, Math.PI * 2, true); };
  // Silver base (shows where the art is transparent).
  g.fillStyle = "#c3c7cf"; ring(0, R); g.fill();
  const art = game.labelCanvas || proceduralLabel(game);
  g.save();
  ring(19 * mm, R * 0.995); g.clip();
  const sc = Math.max(S / art.width, S / art.height);
  g.drawImage(art, c - (art.width * sc) / 2, c - (art.height * sc) / 2, art.width * sc, art.height * sc);
  g.restore();
  // Clear plastic hub with the stacking ring.
  const hub = g.createRadialGradient(c, c, 7 * mm, c, c, 19 * mm);
  hub.addColorStop(0, "#9ea3ad"); hub.addColorStop(0.55, "#d9dce2"); hub.addColorStop(1, "#aeb3bc");
  g.fillStyle = hub; ring(7.5 * mm, 19 * mm); g.fill();
  g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 1.2 * mm;
  g.beginPath(); g.arc(c, c, 11 * mm, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = "rgba(255,255,255,0.35)"; g.lineWidth = 0.5 * mm;
  g.beginPath(); g.arc(c, c, 19 * mm, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(c, c, R - 0.4 * mm, 0, Math.PI * 2); g.stroke();
}

// Data side: blue-silver with a clear hub, as on PS2 DVD-ROMs.
function drawDiscUnderside(g, S) {
  const c = S / 2, R = S / 2, mm = R / (DISC_R / MM);
  const grd = g.createRadialGradient(c, c, 22 * mm, c, c, R);
  grd.addColorStop(0, "#8a96c8"); grd.addColorStop(0.5, "#6f7fc4"); grd.addColorStop(1, "#9aa6d6");
  g.fillStyle = grd; g.beginPath(); g.arc(c, c, R, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#d4d7de"; g.beginPath(); g.arc(c, c, 22 * mm, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#b5b9c2"; g.beginPath(); g.arc(c, c, 17 * mm, 0, Math.PI * 2); g.fill();
}

// Circular label art used when the game brings no labelCanvas.
function proceduralLabel(game) {
  const S = 512, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const base = new THREE.Color(game.color || "#3366ff");
  const hex = (col) => "#" + col.getHexString();
  const mid = S / 2, R = S / 2;
  const grd = g.createRadialGradient(mid * 0.7, mid * 0.6, R * 0.1, mid, mid, R);
  grd.addColorStop(0, hex(base.clone().lerp(new THREE.Color("#ffffff"), 0.15)));
  grd.addColorStop(0.55, hex(base));
  grd.addColorStop(1, hex(base.clone().multiplyScalar(0.3)));
  g.fillStyle = grd;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = "rgba(255,255,255,0.07)";
  for (let rr = R * 0.38; rr < R; rr += 9) { g.lineWidth = 2; g.beginPath(); g.arc(mid, mid, rr, 0, Math.PI * 2); g.stroke(); }
  // Title, wrapped into up to 3 lines above the hub.
  const title = String(game.title || "Untitled").toUpperCase();
  g.fillStyle = "#ffffff";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = 8;
  let size = 52;
  g.font = `800 ${size}px system-ui, sans-serif`;
  if (wrap(g, title, S * 0.62).length > 2) { size = 40; g.font = `800 ${size}px system-ui, sans-serif`; }
  const ls = wrap(g, title, S * 0.62).slice(0, 3);
  ls.forEach((l, i) => g.fillText(l, mid, mid - R * 0.55 + (i - (ls.length - 1) / 2) * size * 1.05));
  g.shadowBlur = 0;
  g.font = "600 20px system-ui, sans-serif";
  g.fillStyle = "rgba(255,255,255,0.75)";
  g.fillText("PlayStation 2", mid, mid + R * 0.55);
  return c;
}

function wrap(g, text, maxW) {
  const words = text.split(/\s+/), lines = [];
  let line = "";
  for (const w of words) {
    const t = line ? line + " " + w : w;
    if (g.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function disposeObject(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of ms) { if (m.map && !m.map.userData.shared) m.map.dispose(); m.dispose(); }
  });
}
