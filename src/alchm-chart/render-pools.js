/* The Tetractys — an Alchemical Temperament instrument (four-quadrant diamond
   gauge + dominant-element hero readout + chart-ruler crown + per-planet
   contribution stack) — plus the 12 constellation pool rows (astrological
   pressure meter, always walletless; live on-chain depth in three states). */
import { h, s, clear } from "./dom.js";
import { elementalComposition, compToEsms } from "./math.js";

// Classical element + a one-word vibe per ESMS id (Spirit/Essence/Matter/Substance).
const ESMS_ELEMENT = ["Fire", "Water", "Earth", "Air"];
const ESMS_VIBE = ["warm & expressive", "fluid & feeling", "grounded & enduring", "airy & connective"];

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
