/* The Observer's Horizon — a 3D celestial dome that replaces the flat 2D track.
   Unlike the SVG renderer (rebuilt each frame), this owns a persistent Three.js
   scene; `update(state)` only reconciles the data layer (planets · aspect bridges
   · pool footprint arcs). Mundane planets sit on the real horizon via alt/az; a
   natal chart (no horizon data) lays its bodies along the ecliptic ribbon.

     const dome = createDome(container, state, hooks)
     dome.update(state)  ·  dome.resize()  ·  dome.dispose()

   Picking routes through the SAME hooks.onSelect the 2D track used, so the
   inspector popover + live swap panel keep working unchanged. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

const DEG = Math.PI / 180;
const R = 15;                    // dome radius (matches the prototype scale)
const ECL_TILT = 24 * DEG;       // ecliptic ring tilt off the horizon plane
const ECL_RADIUS = R * 0.86;
const ECL_LIFT = R * 0.1;

const cssVar = (el, name, fb) => (getComputedStyle(el).getPropertyValue(name).trim() || fb);
const hexOf = (s) => new THREE.Color(s).getHex();

/** Horizontal coords → scene point. az from north (−z), clockwise; y = up. */
function altAzToVec(alt, az, radius = R) {
  const a = alt * DEG, z = az * DEG, rh = radius * Math.cos(a);
  return new THREE.Vector3(rh * Math.sin(z), radius * Math.sin(a), -rh * Math.cos(z));
}
/** Ecliptic longitude → point on the tilted zodiac ring (natal + pool arcs). */
function eclipticToVec(eclLon, radius = ECL_RADIUS) {
  const t = eclLon * DEG;
  const v = new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius);
  v.applyAxisAngle(new THREE.Vector3(1, 0, 0), ECL_TILT);
  v.y += ECL_LIFT;
  return v;
}

function makeGlowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.__shared = true; return t;
}
function makeGlyphTexture(glyph, color) {
  const S = 128;
  const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");
  g.font = '600 78px "Space Grotesk", system-ui, serif';
  g.textAlign = "center"; g.textBaseline = "middle";
  g.shadowColor = color; g.shadowBlur = 14; g.fillStyle = color;
  g.fillText(glyph, S / 2, S / 2 + 4);
  const t = new THREE.CanvasTexture(c); t.__shared = true; return t;
}

export function createDome(container, state, hooks) {
  while (container.firstChild) container.removeChild(container.firstChild); // drop loading placeholder

  const gold = cssVar(container, "--ac-gold", "#d8b46a");
  const goldDeep = cssVar(container, "--ac-gold-deep", "#9c7e42");
  const goldBright = cssVar(container, "--ac-gold-bright", "#f1dba1");
  const applyingHex = cssVar(container, "--ac-applying", "#f1dba1");
  const separatingHex = cssVar(container, "--ac-separating", "#7d8aa0");

  let curW = Math.max(1, container.clientWidth);
  let curH = Math.max(1, container.clientHeight || 400);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, curW / curH, 0.1, 2000);
  camera.position.set(0, 6, 40);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(curW, curH);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.5, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 12; controls.maxDistance = 90;
  controls.minPolarAngle = 0.16 * Math.PI; controls.maxPolarAngle = 0.64 * Math.PI;
  let userMoved = false;
  controls.addEventListener("start", () => { userMoved = true; });
  controls.update();

  // Pull the camera back along its current orbit direction until the whole dome
  // (radius R, + margin) fits the viewport — vertical or horizontal, whichever binds.
  function fitCamera() {
    const m = 1.18, vFov = camera.fov * DEG;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = Math.max((R * m) / Math.tan(vFov / 2), (R * m) / Math.tan(hFov / 2));
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.update();
  }

  scene.add(new THREE.AmbientLight(0x404a66, 1.2));
  const key = new THREE.PointLight(0xfff0d0, 1.1, 200); key.position.set(0, 24, 6); scene.add(key);

  // ── static dome (built once) ──
  const glowTex = makeGlowTexture();
  const glyphCache = new Map();

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x0a0b1e, emissive: 0x12132e, transparent: true, opacity: 0.28, side: THREE.BackSide }),
  );
  scene.add(sky);
  const underworld = new THREE.Mesh(
    new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x14161f, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  scene.add(underworld);

  const horizon = makeLine(circlePts((t) => [Math.cos(t) * R, 0, Math.sin(t) * R], 128), hexOf(gold), 2.4, 0.85);
  scene.add(horizon);
  const ecliptic = makeLine(circlePts((t) => { const v = eclipticToVec((t / (Math.PI * 2)) * 360); return [v.x, v.y, v.z]; }, 160), hexOf(goldDeep), 1.4, 0.4);
  scene.add(ecliptic);

  const stars = makeStarfield();
  scene.add(stars);

  const dyn = new THREE.Group(); scene.add(dyn);
  let pickList = [];

  const raycaster = new THREE.Raycaster();
  raycaster.params.Line2 = { threshold: 10 };
  const ndc = new THREE.Vector2();
  let needsRender = true, disposed = false, raf = 0, down = null;

  // ── builders ──
  function makeLine(flatPts, colorHex, width, opacity, dashed) {
    const geo = new LineGeometry(); geo.setPositions(flatPts);
    const mat = new LineMaterial({ color: colorHex, linewidth: width, transparent: true, opacity, dashed: !!dashed, dashSize: 0.6, gapSize: 0.5 });
    mat.resolution.set(curW, curH);
    const line = new Line2(geo, mat); if (dashed) line.computeLineDistances();
    return line;
  }
  function circlePts(at, steps) {
    const out = [];
    for (let i = 0; i <= steps; i++) { const p = at((i / steps) * Math.PI * 2); out.push(p[0], p[1], p[2]); }
    return out;
  }
  function makeStarfield() {
    const n = 1400, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 60 + Math.random() * 40, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random());
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.9 + 2; // bias to upper sky
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.55 }));
  }
  function addPlanet(pos, v, radius, up) {
    const colorHex = pos.color || goldBright;
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 20, 20),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colorHex), transparent: true, opacity: up === false ? 0.4 : 1 }),
    );
    core.position.copy(v); core.userData = { kind: "body", pos };
    dyn.add(core); pickList.push(core);

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(colorHex), transparent: true, opacity: up === false ? 0.18 : 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    const gs = radius * 6.5; glow.scale.set(gs, gs, 1); glow.position.copy(v); glow.raycast = () => {};
    dyn.add(glow);

    const glyph = pos.glyph || "✦";
    let tex = glyphCache.get(glyph);
    if (!tex) { tex = makeGlyphTexture(glyph, goldBright); glyphCache.set(glyph, tex); }
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: up === false ? 0.5 : 0.95, depthWrite: false, depthTest: false }));
    const ls = radius * 3.2 + 0.8; label.scale.set(ls, ls, 1);
    label.position.copy(v).add(new THREE.Vector3(0, radius * 1.6 + 0.4, 0)); label.raycast = () => {};
    dyn.add(label);
  }
  function addAspect(v1, v2, asp, pa, pb) {
    const inf = asp.influence || 0;
    const ctrl = v1.clone().add(v2).multiplyScalar(0.5).multiplyScalar(0.82 - 0.5 * inf); // bow inward, deeper = stronger
    const pts = new THREE.QuadraticBezierCurve3(v1, ctrl, v2).getPoints(36);
    const flat = []; for (const p of pts) flat.push(p.x, p.y, p.z);
    const sep = asp.state === "separating";
    const colHex = hexOf(asp.state === "applying" ? applyingHex : sep ? separatingHex : goldBright);
    const line = makeLine(flat, colHex, 1 + inf * 3.5, 0.25 + 0.5 * inf, sep);
    line.userData = { kind: "aspect", asp, a: pa, b: pb };
    dyn.add(line); pickList.push(line);
  }
  function addPoolArc(fp, pressure, colorHex, constId) {
    const a0 = fp.center - fp.half, a1 = fp.center + fp.half, steps = 24, flat = [];
    for (let i = 0; i <= steps; i++) { const v = eclipticToVec(a0 + (a1 - a0) * (i / steps), ECL_RADIUS * 1.012); flat.push(v.x, v.y, v.z); }
    const line = makeLine(flat, hexOf(colorHex), 2 + 5 * pressure, 0.12 + 0.5 * pressure);
    line.userData = { kind: "pool", constId };
    dyn.add(line); pickList.push(line);
  }
  // Transit mode: faint natal body on the zodiac ring.
  function addNatalNode(pos, v) {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 12, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(pos.color || goldDeep), transparent: true, opacity: 0.5 }),
    );
    core.position.copy(v); core.userData = { kind: "body", pos };
    dyn.add(core); pickList.push(core);
  }
  // Transit mode: a line from a transiting body to the natal point it aspects.
  function addTransitLine(v1, v2, a, pa, pb) {
    const inf = a.influence || 0, sep = a.state === "separating";
    const colHex = hexOf(a.state === "applying" ? applyingHex : sep ? separatingHex : goldBright);
    const line = makeLine([v1.x, v1.y, v1.z, v2.x, v2.y, v2.z], colHex, 1 + inf * 3, 0.28 + 0.5 * inf, sep);
    line.userData = { kind: "aspect", asp: a, a: pa, b: pb };
    dyn.add(line); pickList.push(line);
  }

  // ── reconcile data layer ──
  function update(st) {
    disposeGroup(dyn); pickList = [];
    const chart = st.chart;
    if (!chart) { requestRender(); return; }
    const weights = (st.smes && st.smes.weights) || {};
    const maxW = Math.max(1, ...Object.values(weights));
    const mundane = st.frame !== "natal";
    const esms = st.esms || {}, foot = st.footprints || {}, pressures = st.pressures || {};

    for (const pool of st.poolMeta || []) {
      const id = pool.constId != null ? pool.constId : pool.id;
      const fp = foot[id]; if (!fp) continue;
      const pr = pressures[id] ? pressures[id].pressure : 0;
      const col = (esms.colors && esms.colors[pool.pair ? pool.pair[0] : 0]) || gold;
      addPoolArc(fp, pr, col, id);
    }

    const vecByBody = {};
    for (const p of chart.positions || []) {
      const radius = 0.28 + 0.62 * ((weights[p.body] || 0) / maxW);
      const v = (mundane && p.alt != null && p.az != null) ? altAzToVec(p.alt, p.az, R * 0.985) : eclipticToVec(p.eclLon);
      vecByBody[p.body] = v;
      addPlanet(p, v, radius, mundane ? p.up : null);
    }
    for (const a of chart.aspects || []) {
      const va = vecByBody[a.a], vb = vecByBody[a.b];
      if (!va || !vb) continue;
      addAspect(va, vb, a, chart.byBody && chart.byBody[a.a], chart.byBody && chart.byBody[a.b]);
    }

    // Transit frame: faint natal ring + lines from transiting bodies to natal points.
    if (st.frame === "transit" && chart.natalPositions) {
      const natalVec = {};
      for (const p of chart.natalPositions) {
        const v = eclipticToVec(p.eclLon, ECL_RADIUS);
        natalVec[p.body] = v;
        addNatalNode(p, v);
      }
      for (const a of chart.transitAspects || []) {
        const vt = vecByBody[a.t], vn = natalVec[a.n];
        if (!vt || !vn) continue;
        addTransitLine(vt, vn, a, chart.byBody && chart.byBody[a.t], chart.natalByBody && chart.natalByBody[a.n]);
      }
    }
    requestRender();
  }

  // ── picking (click, not drag) → existing onSelect hook ──
  function onDown(e) { down = { x: e.clientX, y: e.clientY }; }
  function onUp(e) {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y); down = null;
    if (moved > 6) return; // it was an orbit drag
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(pickList, false)[0];
    const ud = hit && hit.object.userData;
    if (!ud || !hooks || !hooks.onSelect) return;
    if (ud.kind === "body") hooks.onSelect({ kind: "body", pos: ud.pos });
    else if (ud.kind === "aspect") hooks.onSelect({ kind: "aspect", asp: ud.asp, a: ud.a, b: ud.b });
    else if (ud.kind === "pool") hooks.onSelect({ kind: "pool", constId: ud.constId });
  }
  renderer.domElement.addEventListener("pointerdown", onDown);
  renderer.domElement.addEventListener("pointerup", onUp);

  // ── render loop (on-demand) ──
  // Renders on interaction / data change, keeps the rAF alive only while the
  // orbit damping is still settling, then idles. No perpetual loop → the page
  // stays stable (cheap on CPU, and automation tools can reach it).
  function renderFrame() {
    raf = 0;
    if (disposed) return;
    const moving = controls.update(); // applies damping; true while still settling
    if (needsRender || moving) { renderer.render(scene, camera); needsRender = false; }
    if (moving) raf = requestAnimationFrame(renderFrame);
  }
  function requestRender() { needsRender = true; if (!raf) raf = requestAnimationFrame(renderFrame); }
  controls.addEventListener("change", requestRender);

  function setResolution(w, h) { scene.traverse((o) => { if (o.material && o.material.resolution) o.material.resolution.set(w, h); }); }
  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    if (w === curW && h === curH) return;
    curW = w; curH = h;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); setResolution(w, h);
    if (!userMoved) fitCamera();
    requestRender();
  }
  const ro = new ResizeObserver(resize); ro.observe(container);

  function disposeGroup(group) {
    for (const obj of group.children.slice()) {
      group.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
      for (const m of mats) { if (m.map && !m.map.__shared) m.map.dispose(); m.dispose(); }
    }
  }
  function dispose() {
    disposed = true; if (raf) cancelAnimationFrame(raf); ro.disconnect();
    renderer.domElement.removeEventListener("pointerdown", onDown);
    renderer.domElement.removeEventListener("pointerup", onUp);
    controls.removeEventListener("change", requestRender);
    controls.dispose(); disposeGroup(dyn);
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) { if (m.map && !m.map.__shared) m.map.dispose(); m.dispose(); }
    });
    glowTex.dispose(); for (const t of glyphCache.values()) t.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  update(state); fitCamera(); resize(); requestRender();
  return { update, resize, dispose };
}
