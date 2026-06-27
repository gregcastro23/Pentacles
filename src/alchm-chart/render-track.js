/* The horizontal ecliptic landscape: signs · zone ticks · pool footprints ·
   axis + Asc/MC · salience-sized planet nodes (collision lanes) · aspect
   bridges (bow depth + width + opacity = influence, dash = separating). */
import { s, clear } from "./dom.js";
import { n360 } from "./math.js";

export const VB_W = 1200, VB_H = 540;
const PAD_L = 44, PAD_R = 24, TRACK_W = VB_W - PAD_L - PAD_R;
const SIGN_Y = 26, SIGN_H = 30;
const FP_Y = 60, FP_H = 16;
const AXIS_Y = 150;
const NODE_TOP = AXIS_Y - 16, LANE_H = 26, MIN_GAP = 22;
const BRIDGE_MAX_DEPTH = 300;

const xOf = (lon) => PAD_L + (n360(lon) / 360) * TRACK_W;

/** One or two [x,w] rects for a degree span, split across the 0/360 seam. */
function bandRects(centerDeg, halfDeg) {
  const lo = centerDeg - halfDeg, hi = centerDeg + halfDeg;
  const segs = [];
  const push = (a, b) => segs.push([xOf(a), ((b - a) / 360) * TRACK_W]);
  if (lo < 0) { push(0, hi); push(n360(lo), 360); }
  else if (hi > 360) { push(lo, 360); push(0, hi - 360); }
  else push(lo, hi);
  return segs;
}

/** Greedy lane assignment so nodes closer than MIN_GAP stack upward. */
function assignLanes(items) {
  const sorted = items.slice().sort((a, b) => a.x - b.x);
  const laneLastX = [];
  for (const it of sorted) {
    let lane = 0;
    while (laneLastX[lane] != null && it.x - laneLastX[lane] < MIN_GAP) lane++;
    laneLastX[lane] = it.x;
    it.lane = lane;
  }
}

export function renderTrack(container, state, hooks) {
  clear(container);
  const { chart, esms } = state;
  const glyphs = state.glyphs || {};
  const svg = s("svg", {
    class: "ac-svg", viewBox: `0 0 ${VB_W} ${VB_H}`, preserveAspectRatio: "xMidYMid meet",
    role: "img", "aria-label": "Ecliptic landscape with planets and aspect bridges",
  });
  if (!chart) { container.appendChild(svg); return; }

  const gBands = s("g", { class: "ac-g-bands" });
  const gFoot = s("g", { class: "ac-g-foot" });
  const gAxis = s("g", { class: "ac-g-axis" });
  const gBridges = s("g", { class: "ac-g-bridges" });
  const gNodes = s("g", { class: "ac-g-nodes" });

  // ── sign cells + glyphs + zone/degree ticks ──
  const signGlyphs = glyphs.sign || ["♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓"];
  const cellW = TRACK_W / 12;
  for (let i = 0; i < 12; i++) {
    const x = PAD_L + i * cellW;
    gBands.appendChild(s("rect", { class: "ac-sign" + (i % 2 ? " ac-sign--alt" : ""), x, y: SIGN_Y, width: cellW, height: SIGN_H }));
    gBands.appendChild(s("text", { class: "ac-sign-glyph", x: x + cellW / 2, y: SIGN_Y + SIGN_H / 2 + 5, "text-anchor": "middle", text: signGlyphs[i] }));
    gAxis.appendChild(s("line", { class: "ac-tick", x1: x, y1: AXIS_Y - 5, x2: x, y2: AXIS_Y + 5 }));
  }

  // ── pool footprint bands (ambient; brightness ∝ live pressure) ──
  const pressures = state.pressures || {};
  for (const pool of state.pools || []) {
    const id = pool.constId != null ? pool.constId : pool.id;
    const fp = (state.footprints || {})[id];
    if (!fp) continue;
    const p = pressures[id] ? pressures[id].pressure : 0;
    const color = esms.colors[pool.pair[0]];
    const op = 0.05 + 0.22 * p;
    for (const [bx, bw] of bandRects(fp.center, fp.half)) {
      gFoot.appendChild(s("rect", {
        class: "ac-foot", x: bx, y: FP_Y, width: Math.max(2, bw), height: FP_H,
        fill: color, "fill-opacity": op.toFixed(3),
        dataset: { pool: id }, onclick: () => hooks.onSelect && hooks.onSelect({ kind: "pool", constId: id }),
      }));
    }
  }

  // ── axis + Asc/MC ──
  gAxis.appendChild(s("line", { class: "ac-axis", x1: PAD_L, y1: AXIS_Y, x2: PAD_L + TRACK_W, y2: AXIS_Y }));
  const angle = (deg, label) => {
    if (deg == null || !isFinite(deg)) return;
    const x = xOf(deg);
    gAxis.appendChild(s("line", { class: "ac-angle", x1: x, y1: SIGN_Y, x2: x, y2: AXIS_Y }));
    gAxis.appendChild(s("text", { class: "ac-angle-label", x, y: SIGN_Y - 4, "text-anchor": "middle", text: label }));
  };
  angle(chart.asc, "Asc");
  angle(chart.mc, "MC");

  // ── aspect bridges (behind nodes) ──
  const maxInfluence = (chart.aspects || []).reduce((m, a) => Math.max(m, a.influence || 0), 0.001);
  for (const a of chart.aspects || []) {
    const pa = chart.byBody[a.a], pb = chart.byBody[a.b];
    if (!pa || !pb) continue;
    const x1 = xOf(pa.eclLon), x2 = xOf(pb.eclLon);
    const inf = a.influence || 0;
    const depth = AXIS_Y + 26 + inf * BRIDGE_MAX_DEPTH;
    const path = s("path", {
      class: "ac-bridge ac-bridge--" + (a.state === "applying" ? "applying" : a.state === "separating" ? "separating" : "exact"),
      d: `M${x1.toFixed(1)},${AXIS_Y} Q${((x1 + x2) / 2).toFixed(1)},${depth.toFixed(1)} ${x2.toFixed(1)},${AXIS_Y}`,
      fill: "none", "stroke-width": (1 + inf * 4).toFixed(2), "stroke-opacity": (0.28 + 0.55 * (inf / maxInfluence)).toFixed(3),
      dataset: { type: a.type },
      onclick: () => hooks.onSelect && hooks.onSelect({ kind: "aspect", asp: a, a: pa, b: pb }),
    });
    const title = s("title", { text: `${pa.name} ${a.glyph} ${pb.name} · ${a.type} · ${a.state} · orb ${a.orb}° · influence ${(inf * 100) | 0}` });
    path.appendChild(title);
    gBridges.appendChild(path);
  }

  // ── planet nodes (salience-sized, collision lanes, on top) ──
  const planetGlyphs = glyphs.planet || ["☉","☽","☿","♀","♂","♃","♄","♅","♆","♇"];
  const planetColors = glyphs.planetColor || [];
  const weights = (state.smes && state.smes.weights) || {};
  const maxW = Math.max(1, ...Object.values(weights));
  const items = (chart.positions || []).map((p) => ({ p, x: xOf(p.eclLon) }));
  assignLanes(items);
  for (const it of items) {
    const { p, x, lane } = it;
    const cy = NODE_TOP - lane * LANE_H;
    const w = weights[p.body] || 0;
    const r = 7 + 9 * (w / maxW);
    const color = p.color || planetColors[p.body] || "var(--ac-gold)";
    gNodes.appendChild(s("line", { class: "ac-stem", x1: x, y1: AXIS_Y, x2: x, y2: cy }));
    const g = s("g", {
      class: "ac-node", dataset: { body: p.body }, tabindex: "0", role: "button",
      "aria-label": `${p.name} in ${p.signName} ${Math.floor(p.degInSign)}°`,
      onclick: () => hooks.onSelect && hooks.onSelect({ kind: "body", pos: p }),
      onkeydown: (e) => { if ((e.key === "Enter" || e.key === " ") && hooks.onSelect) { e.preventDefault(); hooks.onSelect({ kind: "body", pos: p }); } },
    });
    g.appendChild(s("circle", { class: "ac-node-disc" + (p.retrograde ? " ac-node-disc--retro" : ""), cx: x, cy, r, stroke: color }));
    g.appendChild(s("text", { class: "ac-node-glyph", x, y: cy + r * 0.4, "text-anchor": "middle", "font-size": (r + 3).toFixed(0), text: p.glyph || planetGlyphs[p.body] || "✦" }));
    g.appendChild(s("title", { text: `${p.glyph || ""} ${p.name} · ${p.signName} ${Math.floor(p.degInSign)}°${p.retrograde ? " ℞" : ""}${p.dignity && p.dignity.label !== "Peregrine" ? " · " + p.dignity.label : ""}` }));
    gNodes.appendChild(g);
  }

  svg.appendChild(gBands); svg.appendChild(gFoot); svg.appendChild(gAxis);
  svg.appendChild(gBridges); svg.appendChild(gNodes);
  container.appendChild(svg);
}
