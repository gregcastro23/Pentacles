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
const R = 15;                    // dome radius (celestial sphere scale)
const ECL_TILT = 23.44 * DEG;    // ecliptic ring tilt off the horizon plane
const ECL_RADIUS = R * 0.88;
const ECL_LIFT = R * 0.08;

const SIGN_GLYPHS = ["♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓"];

const cssVar = (el, name, fb) => (getComputedStyle(el).getPropertyValue(name).trim() || fb);
const hexOf = (s) => new THREE.Color(s).getHex();

function hexToRgba(colorStr, alpha) {
  try {
    const c = new THREE.Color(colorStr);
    return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
  } catch {
    return `rgba(216, 180, 106, ${alpha})`;
  }
}

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
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.2, "rgba(255,240,200,0.85)");
  grd.addColorStop(0.5, "rgba(216,180,106,0.35)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.__shared = true; return t;
}

/**
 * High-definition 256x256 planetary emblem with glowing halo, signature glyph,
 * and degree + sign pill readout.
 */
function makePlanetBadgeTexture(pos, up) {
  const S = 256;
  const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");
  const col = pos.color || "#f1dba1";
  const glyph = pos.glyph || "✦";
  const deg = Math.floor(pos.degInSign != null ? pos.degInSign : (pos.eclLon != null ? pos.eclLon % 30 : 0));
  const sign = pos.signGlyph || "";
  const isUp = up !== false;

  // 1. Luminous outer radial aura
  const haloGrd = g.createRadialGradient(128, 92, 16, 128, 92, 94);
  haloGrd.addColorStop(0, hexToRgba(col, isUp ? 0.42 : 0.15));
  haloGrd.addColorStop(0.55, hexToRgba(col, isUp ? 0.16 : 0.05));
  haloGrd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = haloGrd;
  g.fillRect(0, 0, S, S);

  // 2. Circular glassmorphic emblem disc
  const cx = 128, cy = 92, r = 52;
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = isUp ? "rgba(7, 10, 24, 0.94)" : "rgba(9, 12, 22, 0.65)";
  g.fill();

  // Signature color border
  g.lineWidth = isUp ? 3.5 : 2;
  if (!isUp) g.setLineDash([5, 4]);
  g.strokeStyle = col;
  if (isUp) {
    g.shadowColor = col;
    g.shadowBlur = 12;
  }
  g.stroke();
  g.restore();

  // Inner gold hairline rim
  g.save();
  g.beginPath();
  g.arc(cx, cy, r - 5, 0, Math.PI * 2);
  g.lineWidth = 1;
  g.strokeStyle = "rgba(241, 219, 161, 0.32)";
  g.stroke();
  g.restore();

  // 3. Central Planetary Glyph
  g.save();
  g.font = '600 66px "Space Grotesk", "Segoe UI Symbol", system-ui, serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = isUp ? col : hexToRgba(col, 0.7);
  if (isUp) {
    g.shadowColor = col;
    g.shadowBlur = 10;
  }
  g.fillText(glyph, cx, cy + 3);
  g.restore();

  // 4. Retrograde ℞ badge
  if (pos.retrograde) {
    g.save();
    g.beginPath();
    g.arc(cx + 40, cy - 36, 16, 0, Math.PI * 2);
    g.fillStyle = "#e0a23a";
    g.fill();
    g.strokeStyle = "#fff0d0";
    g.lineWidth = 1.5;
    g.stroke();
    g.font = '700 16px "Space Grotesk", sans-serif';
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#1a1204";
    g.fillText("℞", cx + 40, cy - 35);
    g.restore();
  }

  // 5. Degree & Sign Readout Pill
  const pillW = 154, pillH = 38, pillX = cx - pillW / 2, pillY = 168, pillR = 19;
  g.save();
  g.beginPath();
  if (typeof g.roundRect === "function") {
    g.roundRect(pillX, pillY, pillW, pillH, pillR);
  } else {
    g.rect(pillX, pillY, pillW, pillH);
  }
  g.fillStyle = isUp ? "rgba(5, 7, 18, 0.95)" : "rgba(7, 9, 20, 0.75)";
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = isUp ? "rgba(216, 180, 106, 0.5)" : "rgba(216, 180, 106, 0.22)";
  g.stroke();

  // Text inside pill: degree + sign
  g.font = '600 21px "Space Grotesk", system-ui, sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = isUp ? "#f1dba1" : "#a8b0c0";
  const degText = `${deg}° ${sign}`;
  g.fillText(degText, cx, pillY + pillH / 2);
  g.restore();

  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

/**
 * Luminous Cardinal Marker Texture (N, E, S, W).
 */
function makeCardinalTexture(letter, colorHex) {
  const S = 128;
  const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");
  const cx = 64, cy = 64, r = 36;

  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fillStyle = "rgba(7, 10, 24, 0.9)";
  g.fill();

  g.lineWidth = 2.5;
  g.strokeStyle = colorHex;
  g.shadowColor = colorHex;
  g.shadowBlur = 10;
  g.stroke();

  g.font = '700 34px "Space Grotesk", system-ui, sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#fff0d0";
  g.fillText(letter, cx, cy + 2);

  const t = new THREE.CanvasTexture(c);
  t.__shared = true;
  return t;
}

/**
 * Subtle Zodiac Demarcation Texture for the ecliptic ribbon.
 */
function makeZodiacBadgeTexture(glyph) {
  const S = 96;
  const c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");
  g.font = '600 48px "Space Grotesk", "Segoe UI Symbol", serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "rgba(216, 180, 106, 0.65)";
  g.fillText(glyph, 48, 48);
  const t = new THREE.CanvasTexture(c);
  t.__shared = true;
  return t;
}

export function createDome(container, state, hooks) {
  while (container.firstChild) container.removeChild(container.firstChild); // drop loading placeholder

  const gold = cssVar(container, "--ac-gold", "#d8b46a");
  const goldDeep = cssVar(container, "--ac-gold-deep", "#9c7e42");
  const goldBright = cssVar(container, "--ac-gold-bright", "#f1dba1");
  const applyingHex = cssVar(container, "--ac-applying", "#f1dba1");
  const separatingHex = cssVar(container, "--ac-separating", "#7d8aa0");

  let curW = Math.max(1, container.clientWidth);
  let curH = Math.max(1, container.clientHeight || 480);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, curW / curH, 0.1, 2000);
  camera.position.set(0, 11.5, 39);

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(curW, curH);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 3.2, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 14; controls.maxDistance = 85;
  controls.minPolarAngle = 0.08 * Math.PI; controls.maxPolarAngle = 0.58 * Math.PI;
  let userMoved = false;
  controls.addEventListener("start", () => { userMoved = true; });
  controls.update();

  // Pull camera back so entire dome (Zenith 90°, East Rising, West Setting) fits comfortably
  function fitCamera() {
    const m = 1.38, vFov = camera.fov * DEG;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = Math.max((R * m) / Math.tan(vFov / 2), (R * m) / Math.tan(hFov / 2));
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(controls.target).addScaledVector(dir, dist);
    controls.update();
  }

  scene.add(new THREE.AmbientLight(0x404a66, 1.4));
  const keyLight = new THREE.PointLight(0xfff0d0, 1.2, 200); keyLight.position.set(0, 24, 6); scene.add(keyLight);
  const fillLight = new THREE.PointLight(0x5a7099, 0.8, 180); fillLight.position.set(0, -20, -10); scene.add(fillLight);

  // ── static celestial architecture (built once) ──
  const glowTex = makeGlowTexture();
  const sharedTextures = [];

  // 1. Sky & Underworld Spheres
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x080a1c, emissive: 0x0f1128, transparent: true, opacity: 0.32, side: THREE.BackSide }),
  );
  scene.add(sky);
  const underworld = new THREE.Mesh(
    new THREE.SphereGeometry(R, 48, 24, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x090b14, transparent: true, opacity: 0.58, side: THREE.DoubleSide }),
  );
  scene.add(underworld);

  // 2. Translucent Horizon Ground Disc (Earth Plane)
  const groundDisc = new THREE.Mesh(
    new THREE.CircleGeometry(R * 0.995, 64),
    new THREE.MeshBasicMaterial({
      color: 0x050711,
      transparent: true,
      opacity: 0.38,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  );
  groundDisc.rotation.x = Math.PI / 2;
  scene.add(groundDisc);

  // 3. Double Luminous Horizon Ring
  const horizonFlat = circlePts((t) => [Math.cos(t) * R, 0, Math.sin(t) * R], 128);
  const horizonCore = makeLine(horizonFlat, hexOf(gold), 2.5, 0.92);
  scene.add(horizonCore);
  const horizonAura = makeLine(horizonFlat, hexOf(goldBright), 4.8, 0.22);
  scene.add(horizonAura);

  // 4. Ecliptic Ribbon (Tilted Zodiac Track)
  const eclipticFlat = circlePts((t) => { const v = eclipticToVec((t / (Math.PI * 2)) * 360); return [v.x, v.y, v.z]; }, 160);
  const ecliptic = makeLine(eclipticFlat, hexOf(goldDeep), 1.6, 0.55);
  scene.add(ecliptic);

  // 5. Celestial Landmark Badges: Zenith (90°), Rising (East), Setting (West)
  function makeNavBadgeTexture(title, sub, colorHex) {
    const W = 256, H = 128;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const g = c.getContext("2d");

    const bx = 12, by = 16, bw = W - 24, bh = H - 32, br = 20;
    g.beginPath();
    if (typeof g.roundRect === "function") {
      g.roundRect(bx, by, bw, bh, br);
    } else {
      g.moveTo(bx + br, by);
      g.lineTo(bx + bw - br, by);
      g.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
      g.lineTo(bx + bw, by + bh - br);
      g.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
      g.lineTo(bx + br, by + bh);
      g.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
      g.lineTo(bx, by + br);
      g.quadraticCurveTo(bx, by, bx + br, by);
      g.closePath();
    }
    g.fillStyle = "rgba(7, 10, 24, 0.92)";
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = colorHex;
    g.shadowColor = colorHex;
    g.shadowBlur = 10;
    g.stroke();

    g.font = '700 24px "Space Grotesk", sans-serif';
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = colorHex;
    g.fillText(title, W / 2, 50);

    g.font = '600 16px "Space Grotesk", sans-serif';
    g.fillStyle = "#c8d0e0";
    g.fillText(sub, W / 2, 82);

    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    t.__shared = true;
    return t;
  }

  // Zenith crown badge directly overhead (apex of dome)
  const zenithTex = makeNavBadgeTexture("✦ ZENITH", "90° OVERHEAD", goldBright);
  sharedTextures.push(zenithTex);
  const zenithSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: zenithTex,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  }));
  zenithSprite.renderOrder = 99;
  zenithSprite.scale.set(4.2, 2.1, 1);
  zenithSprite.position.set(0, R + 0.6, 0);
  zenithSprite.raycast = () => {};
  scene.add(zenithSprite);

  // Eastern Horizon Rising Gate badge (elevated cleanly above E marker)
  const riseTex = makeNavBadgeTexture("↗ RISING", "EAST HORIZON", "#e0a23a");
  sharedTextures.push(riseTex);
  const riseSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: riseTex,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  }));
  riseSprite.renderOrder = 99;
  riseSprite.scale.set(4.0, 2.0, 1);
  riseSprite.position.set(R * 1.05, 1.8, 0);
  riseSprite.raycast = () => {};
  scene.add(riseSprite);

  // Western Horizon Setting Gate badge (elevated cleanly above W marker)
  const setTex = makeNavBadgeTexture("↘ SETTING", "WEST HORIZON", "#b98cd6");
  sharedTextures.push(setTex);
  const setSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: setTex,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  }));
  setSprite.renderOrder = 99;
  setSprite.scale.set(4.0, 2.0, 1);
  setSprite.position.set(-R * 1.05, 1.8, 0);
  setSprite.raycast = () => {};
  scene.add(setSprite);

  // 6. Cardinal Horizon Markers (N, E, S, W) - tasteful navigational badges
  const cardinals = [
    { label: "N", pos: new THREE.Vector3(0, 0.2, -R) },
    { label: "E", pos: new THREE.Vector3(R, 0.2, 0) },
    { label: "S", pos: new THREE.Vector3(0, 0.2, R) },
    { label: "W", pos: new THREE.Vector3(-R, 0.2, 0) },
  ];
  for (const c of cardinals) {
    const tex = makeCardinalTexture(c.label, goldBright);
    sharedTextures.push(tex);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0.88,
      depthTest: false,
      depthWrite: false,
    }));
    sprite.renderOrder = 98;
    sprite.scale.set(1.4, 1.4, 1);
    sprite.position.copy(c.pos);
    sprite.raycast = () => {};
    scene.add(sprite);
  }

  // 7. Ecliptic 12-Sign Zodiac Demarcations
  for (let s = 0; s < 12; s++) {
    const glyph = SIGN_GLYPHS[s];
    const tex = makeZodiacBadgeTexture(glyph);
    sharedTextures.push(tex);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.45, depthWrite: false }));
    sprite.scale.set(1.3, 1.3, 1);
    sprite.position.copy(eclipticToVec(s * 30 + 15, ECL_RADIUS * 1.04));
    sprite.raycast = () => {};
    scene.add(sprite);
  }

  // 8. Starfield (Atmospheric Stars)
  const stars = makeStarfield();
  scene.add(stars);

  const dyn = new THREE.Group(); scene.add(dyn);
  let pickList = [];

  const raycaster = new THREE.Raycaster();
  raycaster.params.Line2 = { threshold: 12 };
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
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 65 + Math.random() * 45, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random());
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = Math.abs(r * Math.cos(ph)) * 0.92 + 2; // upper hemisphere bias
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.6 }));
  }

  function addPlanet(pos, v, radius, up) {
    const colorHex = pos.color || goldBright;
    const isUp = up !== false;

    // 1. Planet 3D Sphere Core
    const coreMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(colorHex),
      emissive: new THREE.Color(colorHex),
      emissiveIntensity: isUp ? 0.65 : 0.2,
      roughness: 0.25,
      metalness: 0.25,
      transparent: true,
      opacity: isUp ? 1 : 0.45,
    });
    const core = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.95, 24, 24), coreMat);
    core.position.copy(v); core.userData = { kind: "body", pos };
    dyn.add(core); pickList.push(core);

    // 2. Atmospheric Pulsing Halo Sprite
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: isUp ? 0.65 : 0.18,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const glow = new THREE.Sprite(glowMat);
    const gs = radius * 5.8; glow.scale.set(gs, gs, 1); glow.position.copy(v); glow.raycast = () => {};
    dyn.add(glow);

    // 3. High-Definition Billboard Badge (Glyph + Degree/Sign)
    const labelTex = makePlanetBadgeTexture(pos, up);
    const labelMat = new THREE.SpriteMaterial({
      map: labelTex,
      transparent: true,
      opacity: isUp ? 0.98 : 0.58,
      depthWrite: false,
      depthTest: false,
    });
    const label = new THREE.Sprite(labelMat);
    const badgeSize = radius * 2.5 + 0.85;
    label.scale.set(badgeSize, badgeSize, 1);
    label.position.copy(v).add(new THREE.Vector3(0, radius * 1.35 + 0.45, 0));
    label.userData = { kind: "body", pos };
    dyn.add(label);
    pickList.push(label); // allow clicking the badge to select planet

    // 4. Subterranean Nadir Connector Ray (if below horizon)
    if (!isUp) {
      const nadirFlat = [v.x, v.y, v.z, v.x, 0, v.z];
      const nadir = makeLine(nadirFlat, hexOf(goldDeep), 1.2, 0.35, true);
      nadir.raycast = () => {};
      dyn.add(nadir);
    }
  }

  function addAspect(v1, v2, asp, pa, pb) {
    const inf = asp.influence || 0;
    const ctrl = v1.clone().add(v2).multiplyScalar(0.5).multiplyScalar(0.82 - 0.5 * inf);
    const pts = new THREE.QuadraticBezierCurve3(v1, ctrl, v2).getPoints(36);
    const flat = []; for (const p of pts) flat.push(p.x, p.y, p.z);
    const sep = asp.state === "separating";
    const colHex = hexOf(asp.state === "applying" ? applyingHex : sep ? separatingHex : goldBright);
    const line = makeLine(flat, colHex, 1.2 + inf * 3.8, 0.28 + 0.55 * inf, sep);
    line.userData = { kind: "aspect", asp, a: pa, b: pb };
    dyn.add(line); pickList.push(line);
  }

  function addPoolArc(fp, pressure, colorHex, constId) {
    const a0 = fp.center - fp.half, a1 = fp.center + fp.half, steps = 24, flat = [];
    for (let i = 0; i <= steps; i++) { const v = eclipticToVec(a0 + (a1 - a0) * (i / steps), ECL_RADIUS * 1.015); flat.push(v.x, v.y, v.z); }
    const line = makeLine(flat, hexOf(colorHex), 2 + 5 * pressure, 0.14 + 0.5 * pressure);
    line.userData = { kind: "pool", constId };
    dyn.add(line); pickList.push(line);
  }

  function addNatalNode(pos, v) {
    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 16, 16),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(pos.color || goldDeep), transparent: true, opacity: 0.55 }),
    );
    core.position.copy(v); core.userData = { kind: "body", pos };
    dyn.add(core); pickList.push(core);
  }

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
      const radius = 0.32 + 0.68 * ((weights[p.body] || 0) / maxW);
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
  function renderFrame() {
    raf = 0;
    if (disposed) return;
    const moving = controls.update();
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
      for (const m of mats) {
        if (m.map && !m.map.__shared) m.map.dispose();
        m.dispose();
      }
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
      for (const m of mats) {
        if (m.map && !m.map.__shared) m.map.dispose();
        m.dispose();
      }
    });
    glowTex.dispose();
    for (const t of sharedTextures) t.dispose();
    renderer.dispose();
    if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
  }

  update(state); fitCamera(); resize(); requestRender();
  return { update, resize, dispose };
}
