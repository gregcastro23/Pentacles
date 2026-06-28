/* The Tetractys — an Alchemical Temperament instrument (four-quadrant diamond
   gauge + dominant-element hero readout + chart-ruler crown + per-planet
   contribution stack) — plus the 12 constellation pool rows (astrological
   pressure meter, always walletless; live on-chain depth in three states). */
import { h, s, clear } from "./dom.js";
import { elementalComposition, compToEsms } from "./math.js";
import { decanCard } from "./decans.js";

// Classical element + a one-word vibe per ESMS id (Spirit/Essence/Matter/Substance).
const ESMS_ELEMENT = ["Fire", "Water", "Earth", "Air"];
const ESMS_VIBE = ["warm & expressive", "fluid & feeling", "grounded & enduring", "airy & connective"];

/* Body glyph/name resolver that prefers each chart position's own glyph/name —
   so Chiron (idx 10, deliberately absent from the 10-planet arrays) shows ☄, not ✦. */
function bodyLabels(state) {
  const pg = (state.glyphs && state.glyphs.planet) || [];
  const pn = (state.glyphs && state.glyphs.planetName) || [];
  const gmap = {}, nmap = {};
  const add = (arr) => { for (const p of arr || []) if (p) { if (p.glyph != null) gmap[p.body] = p.glyph; if (p.name != null) nmap[p.body] = p.name; } };
  add(state.chart && state.chart.positions);
  add(state.chart && state.chart.natalPositions);
  return { glyph: (b) => gmap[b] || pg[b] || "✦", name: (b) => nmap[b] || pn[b] || ("#" + b) };
}

export function renderSmes(container, state) {
  clear(container);
  const esms = state.esms;
  const smes = state.smes || { pct: [25, 25, 25, 25], weights: {}, ruler: 0 };
  const pct = smes.pct || [25, 25, 25, 25];
  const dominant = pct.indexOf(Math.max(...pct));
  const planetGlyphs = (state.glyphs && state.glyphs.planet) || ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
  const planetNames = (state.glyphs && state.glyphs.planetName) || [];

  container.appendChild(h("div", { class: "ac-section-label", text: "Alchemical temperament — blended SMES" }));

  // ── hero readout + chart-ruler crown ──
  const ruler = smes.ruler != null ? smes.ruler : 0;
  container.appendChild(h("div", { class: "ac-temp-hero" }, [
    h("div", { class: "ac-temp-dom" }, [
      `${esms.names[dominant]}-dominant `,
      h("span", { class: "ac-temp-dom-glyph", style: { color: esms.colors[dominant] }, text: esms.glyphs[dominant] }),
    ]),
    h("div", { class: "ac-temp-sub", text: `${ESMS_ELEMENT[dominant]} · ${Math.round(pct[dominant])}% · ${ESMS_VIBE[dominant]}` }),
    h("div", { class: "ac-temp-crown" }, [
      h("span", { class: "ac-crown-mark", text: "♔" }),
      h("span", { text: `${planetGlyphs[ruler] || "✦"} ${planetNames[ruler] || "Ruler"} — chart ruler` }),
    ]),
  ]));

  // ── four-quadrant diamond gauge ──
  container.appendChild(buildDiamond(pct, esms, dominant));

  // ── per-planet contribution stack ──
  container.appendChild(buildContribution(state, esms, smes, planetGlyphs, planetNames));
}

function buildDiamond(pct, esms, dominant) {
  const C = 100, RMAX = 80;
  const svg = s("svg", { class: "ac-diamond", viewBox: "0 0 200 200", role: "img", "aria-label": "Alchemical temperament diamond gauge" });
  for (const r of [20, 40, 60, 80]) svg.appendChild(s("circle", { class: "ac-ring", cx: C, cy: C, r }));
  svg.appendChild(s("line", { class: "ac-axis2", x1: C, y1: C - RMAX, x2: C, y2: C + RMAX }));
  svg.appendChild(s("line", { class: "ac-axis2", x1: C - RMAX, y1: C, x2: C + RMAX, y2: C }));
  // tinted spokes: Spirit top / Essence right / Matter bottom / Substance left
  const tips = [[C, C - RMAX, 0], [C + RMAX, C, 1], [C, C + RMAX, 2], [C - RMAX, C, 3]];
  for (const [x, y, e] of tips) svg.appendChild(s("line", { class: "ac-spoke", x1: C, y1: C, x2: x, y2: y, stroke: esms.colors[e] }));
  // value polygon (kite)
  const v = [
    [C, C - (pct[0] / 100) * RMAX], [C + (pct[1] / 100) * RMAX, C],
    [C, C + (pct[2] / 100) * RMAX], [C - (pct[3] / 100) * RMAX, C],
  ];
  svg.appendChild(s("polygon", {
    class: "ac-poly", points: v.map((p) => p.map((n) => n.toFixed(1)).join(",")).join(" "),
    fill: esms.colors[dominant], "fill-opacity": 0.22, stroke: esms.colors[dominant],
  }));
  // tip labels (glyph + %)
  const labels = [[C, C - RMAX - 9, 0], [C + RMAX + 12, C + 4, 1], [C, C + RMAX + 17, 2], [C - RMAX - 12, C + 4, 3]];
  for (const [x, y, e] of labels) {
    svg.appendChild(s("text", { class: "ac-tip" + (e === dominant ? " ac-tip--dom" : ""), x, y, "text-anchor": "middle", fill: esms.colors[e], text: `${esms.glyphs[e]} ${Math.round(pct[e])}%` }));
  }
  return h("div", { class: "ac-diamond-wrap" }, [svg]);
}

function buildContribution(state, esms, smes, planetGlyphs, planetNames) {
  const weights = smes.weights || {};
  const byBody = {};
  for (const p of (state.chart && state.chart.positions) || []) byBody[p.body] = p;
  const ruler = smes.ruler;
  const bodies = Object.keys(weights).map(Number).sort((a, b) => weights[b] - weights[a]);
  const maxW = Math.max(1e-6, ...bodies.map((b) => weights[b]));

  const list = h("div", { class: "ac-contrib-list" });
  for (const body of bodies) {
    const p = byBody[body];
    const comp = p ? compToEsms(elementalComposition(body, p.sign, p.dignity ? p.dignity.score : 0)) : [25, 25, 25, 25];
    const sumc = comp[0] + comp[1] + comp[2] + comp[3] || 1;
    const isRuler = body === ruler;
    const seg = h("div", { class: "ac-contrib-bar", style: { width: ((weights[body] / maxW) * 100).toFixed(1) + "%" } });
    for (let e = 0; e < 4; e++) {
      const w = (comp[e] / sumc) * 100;
      if (w > 0) seg.appendChild(h("span", { style: { width: w.toFixed(1) + "%", background: esms.colors[e] } }));
    }
    list.appendChild(h("div", { class: "ac-contrib-row" + (isRuler ? " ac-contrib-row--ruler" : "") }, [
      h("span", { class: "ac-contrib-glyph", title: planetNames[body] || "" }, [
        (planetGlyphs[body] || "✦"),
        isRuler ? h("span", { class: "ac-contrib-crown", text: "♔" }) : null,
        p && p.retrograde ? h("span", { class: "ac-contrib-retro", text: "℞" }) : null,
      ]),
      h("div", { class: "ac-contrib-track" }, [seg]),
    ]));
  }
  return h("div", { class: "ac-contrib" }, [
    h("div", { class: "ac-contrib-label", text: "Planetary contribution weight" }),
    list,
  ]);
}

/* ── Reading card: a data-driven narrative of the current sky ── */
export function renderReading(container, state) {
  clear(container);
  const esms = state.esms, smes = state.smes;
  if (!state.chart || !smes) return;
  const { glyph, name } = bodyLabels(state);

  const pct = smes.pct, dom = pct.indexOf(Math.max(...pct));
  const ruler = smes.ruler != null ? smes.ruler : 0;

  // the chart ruler's own decan card (Minor Arcana) — a one-line tarot touch
  const rulerPos = (state.chart.byBody || {})[ruler];
  const rulerDc = rulerPos ? decanCard(rulerPos.sign, rulerPos.degInSign) : null;

  // tightest aspect (mundane/natal: among sky; transit: transit→natal)
  let aspLine = "—";
  if (state.frame === "transit" && state.chart.transitAspects && state.chart.transitAspects[0]) {
    const a = state.chart.transitAspects[0];
    aspLine = `${glyph(a.t)} ${a.glyph} ${glyph(a.n)} · ${a.type} · orb ${a.orb}° · ${a.state}`;
  } else if (state.chart.aspects && state.chart.aspects.length) {
    const a = state.chart.aspects.slice().sort((x, y) => x.orb - y.orb)[0];
    aspLine = `${glyph(a.a)} ${a.glyph} ${glyph(a.b)} · ${a.type} · orb ${a.orb}° · ${a.state}`;
  }

  // hottest pool
  const pressures = state.pressures || {};
  let topId = null, topPr = -1;
  for (const id in pressures) if (pressures[id].pressure > topPr) { topPr = pressures[id].pressure; topId = id; }
  const topPool = topId != null ? (state.poolMeta.find((m) => m.constId === Number(topId)) || {}) : null;

  const row = (label, valueNode) => h("div", { class: "ac-read-row" }, [
    h("span", { class: "ac-read-k", text: label }), valueNode,
  ]);

  const card = h("div", { class: "ac-reading" }, [
    h("div", { class: "ac-reading-head" }, [
      h("span", { class: "ac-reading-title", text: "Reading" }),
      h("span", { class: "ac-reading-frame", text: state.frame }),
    ]),
    row("dominant", h("span", { style: { color: esms.colors[dom] }, text: `${esms.glyphs[dom]} ${esms.names[dom]} · ${ESMS_ELEMENT[dom]} ${Math.round(pct[dom])}%` })),
    row("chart ruler", h("span", { class: "ac-read-v", text: `${glyph(ruler)} ${name(ruler)}` })),
    rulerDc ? row("ruler's card", h("span", { class: "ac-read-v" }, [
      h("span", { style: { color: esms.colors[rulerDc.esms] }, text: `🎴 ${rulerDc.card}` }),
      h("span", { class: "ac-dim", text: ` · ${rulerDc.title}` }),
    ])) : null,
    row(state.frame === "transit" ? "tightest transit" : "tightest aspect", h("span", { class: "ac-read-v", text: aspLine })),
    topPool ? row("hottest pool", h("span", {}, [
      h("span", { class: "ac-read-v", text: `${topPool.abbr || topPool.name || "—"} ` }),
      h("span", { class: "ac-read-pr" }, [h("span", { class: "ac-read-pr-fill", style: { width: Math.round(topPr * 100) + "%" } })]),
      h("span", { class: "ac-read-v", text: ` ${Math.round(topPr * 100)}%` }),
    ])) : null,
    h("p", { class: "ac-reading-prose", text: readingProse(esms.names[dom], ESMS_ELEMENT[dom], Math.round(pct[dom]), name(ruler), topPool && (topPool.abbr || topPool.name)) }),
  ]);
  container.appendChild(card);
}

function readingProse(domName, domEl, domPct, rulerName, poolName) {
  const tone = { Fire: "drive and expression run high", Water: "feeling and intuition dominate", Earth: "structure and persistence prevail", Air: "ideas and connection circulate" }[domEl] || "the elements are balanced";
  return `The sky is ${domName}-leaning (${domPct}% ${domEl}) — ${tone}. ${rulerName} rules the chart, coloring how that energy expresses.${poolName ? ` Pressure concentrates on the ${poolName} pool right now.` : ""}`;
}

/* ── Decan cards: each placement's Minor Arcana (Golden Dawn decans) ──
   Shows the user's natal cards (or the current sky's, in mundane). In the
   transit frame the user's own natal placements are the meaningful set, so
   we read those when present. */
export function renderDecans(container, state) {
  clear(container);
  const chart = state.chart;
  if (!chart) return;
  const positions = state.frame === "transit" && chart.natalPositions ? chart.natalPositions : chart.positions;
  if (!positions || !positions.length) return;
  const { glyph, name } = bodyLabels(state);
  const esms = state.esms;
  const sub = state.frame === "mundane" ? "the current sky" : "your natal placements";

  container.appendChild(h("div", { class: "ac-section-label", text: "Decan cards — minor arcana" }));
  const list = h("div", { class: "ac-decan-list" });
  for (const p of positions) {
    const dc = decanCard(p.sign, p.degInSign);
    list.appendChild(h("div", { class: "ac-decan-row", title: `${name(p.body)} · ${p.signName || ""} ${Math.floor(p.degInSign)}° (decan ${dc.range[0]}–${dc.range[1]}°)` }, [
      h("span", { class: "ac-decan-planet" }, [glyph(p.body)]),
      h("span", { class: "ac-decan-pos ac-dim", text: `${p.signGlyph || ""}${Math.floor(p.degInSign)}°` }),
      h("span", { class: "ac-decan-card", style: { borderColor: esms.colors[dc.esms] } }, [
        h("span", { class: "ac-decan-rank", style: { color: esms.colors[dc.esms] }, text: dc.card }),
        h("span", { class: "ac-decan-title ac-dim", text: dc.title }),
      ]),
      h("span", { class: "ac-decan-ruler", title: `decan ruler — ${name(dc.ruler)}` }, [
        h("span", { class: "ac-decan-ruler-glyph", text: glyph(dc.ruler) }),
        h("span", { class: "ac-decan-ruler-name ac-dim", text: name(dc.ruler) }),
      ]),
    ]));
  }
  container.appendChild(h("div", { class: "ac-decan-sub ac-dim", text: sub }));
  container.appendChild(list);
}

/* ── Transit strip: the tightest transit-to-natal aspects ── */
export function renderTransitStrip(container, state) {
  clear(container);
  if (state.frame !== "transit") return;
  const { glyph } = bodyLabels(state);
  const chart = state.chart;
  if (!chart || !chart.natalPositions) {
    container.appendChild(h("div", { class: "ac-transit-empty" }, [
      h("span", { text: "No birth chart on file — set a birth time to read transits." }),
    ]));
    return;
  }
  const tops = (chart.transitAspects || []).slice(0, 3);
  const strip = h("div", { class: "ac-transit-strip" });
  if (!tops.length) strip.appendChild(h("div", { class: "ac-transit-empty", text: "No close transits to your natal chart right now." }));
  const natalByBody = chart.natalByBody || {};
  for (const a of tops) {
    const np = natalByBody[a.n];
    const ndc = np ? decanCard(np.sign, np.degInSign) : null;
    strip.appendChild(h("div", { class: "ac-transit-pill ac-transit-pill--" + (a.state === "applying" ? "app" : a.state === "separating" ? "sep" : "exact") }, [
      h("div", { class: "ac-tp-line" }, [
        h("span", { class: "ac-tp-glyphs", text: `${glyph(a.t)} ${a.glyph} ${glyph(a.n)}` }),
        h("span", { class: "ac-tp-orb", text: `orb ${a.orb}°` }),
        h("span", { class: "ac-tp-state", text: a.state }),
      ]),
      ndc ? h("div", { class: "ac-tp-card ac-dim", title: `your natal ${glyph(a.n)} decan card` }, [
        h("span", { text: `🎴 ${ndc.card}` }),
        h("span", { text: ` · ${ndc.title}` }),
      ]) : null,
    ]));
  }
  container.appendChild(strip);
}

function depthCell(pool, state) {
  const esms = state.esms;
  if (!state.pools) return h("div", { class: "ac-depth ac-depth--muted", text: "live depth loading…" });
  if (pool.failed) {
    return h("div", { class: "ac-depth ac-depth--fail" }, [
      h("span", { text: "reserves unavailable" }),
      h("button", { class: "ac-retry", text: "retry", onclick: (e) => { e.stopPropagation(); state.hooks.refreshPools && state.hooks.refreshPools(); } }),
    ]);
  }
  if (!pool.exists || !pool.hasLiq) {
    return h("div", { class: "ac-depth ac-depth--empty", text: "unseeded — no liquidity yet" });
  }
  const fa = (pool.fracA * 100).toFixed(1);
  const wrap = h("div", { class: "ac-depth" });
  const split = h("div", { class: "ac-depth-bar", title: `${esms.glyphs[pool.elemA]} ${fa}% · ${esms.glyphs[pool.elemB]} ${(100 - pool.fracA * 100).toFixed(1)}%` }, [
    h("span", { class: "ac-depth-a", style: { width: fa + "%", background: esms.colors[pool.elemA] } }),
    h("span", { class: "ac-depth-b", style: { width: (100 - fa) + "%", background: esms.colors[pool.elemB] } }),
  ]);
  wrap.appendChild(split);
  if (pool.spot != null) wrap.appendChild(h("span", { class: "ac-depth-spot", text: pool.spot < 0.001 ? "<0.001" : pool.spot.toFixed(pool.spot < 10 ? 3 : 2) }));
  return wrap;
}

export function renderPools(container, state) {
  clear(container);
  const esms = state.esms;
  container.appendChild(h("div", { class: "ac-section-label", text: "Constellation pools — astro-pressure vs live depth" }));

  const meta = state.pools && state.pools.length ? state.pools : state.poolMeta;
  const pressures = state.pressures || {};
  const rows = (meta || []).slice().sort((a, b) => {
    const ia = a.constId != null ? a.constId : a.id, ib = b.constId != null ? b.constId : b.id;
    return (pressures[ib] ? pressures[ib].pressure : 0) - (pressures[ia] ? pressures[ia].pressure : 0);
  });

  const list = h("div", { class: "ac-pool-list" });
  for (const pool of rows) {
    const id = pool.constId != null ? pool.constId : pool.id;
    const pr = pressures[id] ? pressures[id].pressure : 0;
    const pair = pool.pair || [pool.elemA, pool.elemB];
    const row = h("div", {
      class: "ac-pool-row", tabindex: "0", role: "button",
      "aria-label": `${pool.name || pool.abbr} pool, pressure ${Math.round(pr * 100)}%`,
      onclick: () => state.hooks.onSelect && state.hooks.onSelect({ kind: "pool", constId: id }),
      onkeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); state.hooks.onSelect && state.hooks.onSelect({ kind: "pool", constId: id }); } },
    }, [
      h("div", { class: "ac-pool-id" }, [
        h("span", { class: "ac-pool-abbr", text: pool.abbr || ("#" + id) }),
        h("span", { class: "ac-pool-pair" }, [
          h("span", { class: "ac-swatch ac-swatch--sm", style: { background: esms.colors[pair[0]] }, title: esms.names[pair[0]] }),
          h("span", { class: "ac-swatch ac-swatch--sm", style: { background: esms.colors[pair[1]] }, title: esms.names[pair[1]] }),
        ]),
      ]),
      h("div", { class: "ac-pool-pressure" }, [
        h("div", { class: "ac-meter" }, [h("span", { class: "ac-meter-fill", style: { width: (pr * 100).toFixed(1) + "%" } })]),
        h("span", { class: "ac-meter-val", text: Math.round(pr * 100) + "%" }),
      ]),
      depthCell(pool, state),
    ]);
    list.appendChild(row);
  }
  container.appendChild(list);
}
