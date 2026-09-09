/* ============================================================
   AlchmChart — Render Layer & Celestial Instrumentation
   ============================================================
   Renders:
     1. Left Column: Alchemical Core
        - Segmented switcher: [Temperament & Tokens] vs [Thermodynamics & Kinetics]
        - Diamond gauge, canonical token quantities, faucet yield economics,
          Alchemical Pillar, Heat/Entropy/Reactivity/ΔG, Planetary 12 spectrum
     2. Center Column: Aspects & Transits Lower Deck
        - Filterable active aspects (Exact, Conjunctions, Trines, Sextiles, Squares, Oppositions)
        - Transits feed and cosmic synthesis reading
     3. Right Column: Constellation DEX Pools vs Decan Minor Arcana
     4. Moment Telemetry HUD: Moon phase, Solar Decan, Hour Ruler, Active Pillar
   ============================================================ */

import { h, s, clear } from "./dom.js";
import { elementalComposition, compToEsms } from "./math.js";
import { decanCard } from "./decans.js";
import {
  resolveAlchemicalPillar,
  computeThermodynamics,
  computeKineticSpectrum,
  computeTokenizedQuantities,
  computeMomentTelemetry,
  computePlanetaryEvents,
} from "./thermo-kinetics.js";

const ESMS_ELEMENT = ["Fire", "Water", "Earth", "Air"];
const ESMS_VIBE = ["warm & expressive", "fluid & feeling", "grounded & enduring", "airy & connective"];

function bodyLabels(state) {
  const pg = (state.glyphs && state.glyphs.planet) || [];
  const pn = (state.glyphs && state.glyphs.planetName) || [];
  const gmap = {}, nmap = {};
  const add = (arr) => {
    for (const p of arr || []) {
      if (p) {
        if (p.glyph != null) gmap[p.body] = p.glyph;
        if (p.name != null) nmap[p.body] = p.name;
      }
    }
  };
  add(state.chart && state.chart.positions);
  add(state.chart && state.chart.natalPositions);
  return { glyph: (b) => gmap[b] || pg[b] || "✦", name: (b) => nmap[b] || pn[b] || "#" + b };
}

// ── 1. Moment Telemetry Ribbon (HUD) ─────────────────────────────────────────

export function renderMomentHUD(container, state) {
  clear(container);
  if (!state.chart) return;
  const tel = computeMomentTelemetry(state.chart, state.date);
  const smes = state.smes || { pct: [25, 25, 25, 25] };
  const pillar = resolveAlchemicalPillar(smes.pct);
  const esms = state.esms;

  const ribbon = h("div", { class: "ac-hud-ribbon" }, [
    // Moon Phase
    h("div", { class: "ac-hud-item", title: `Lunar phase: ${tel.moon.phaseName} (${tel.moon.illumination}% illuminated, ${tel.moon.phaseAngle}°)` }, [
      h("span", { class: "ac-hud-glyph", text: tel.moon.phaseGlyph }),
      h("div", { class: "ac-hud-info" }, [
        h("span", { class: "ac-hud-k", text: "Lunation" }),
        h("span", { class: "ac-hud-v", text: `${tel.moon.phaseName} ${tel.moon.illumination}%` }),
      ]),
    ]),

    // Solar Decan Locus
    tel.solarDecan ? h("div", { class: "ac-hud-item", title: `Sun transiting Decan ${tel.solarDecan.decanRoman} of ${tel.solarDecan.signName} (${tel.solarDecan.range[0]}°–${tel.solarDecan.range[1]}°) · 🎴 ${tel.solarDecan.card}` }, [
      h("span", { class: "ac-hud-glyph", text: "☉" }),
      h("div", { class: "ac-hud-info" }, [
        h("span", { class: "ac-hud-k", text: `Decan ${tel.solarDecan.decanRoman} · ${tel.solarDecan.signName}` }),
        h("span", { class: "ac-hud-v", style: { color: esms.colors[tel.solarDecan.esms] }, text: `🎴 ${tel.solarDecan.card}` }),
      ]),
    ]) : null,

    // Planetary Hour & Day Ruler
    h("div", { class: "ac-hud-item", title: `Chaldean planetary hour ruler: ${tel.hourRuler.name} · Day ruler: ${tel.dayRuler.name}` }, [
      h("span", { class: "ac-hud-glyph", text: tel.hourRuler.glyph }),
      h("div", { class: "ac-hud-info" }, [
        h("span", { class: "ac-hud-k", text: `Day: ${tel.dayRuler.name}` }),
        h("span", { class: "ac-hud-v", text: `Hour: ${tel.hourRuler.name}` }),
      ]),
    ]),

    // Active Alchemical Pillar
    h("div", { class: "ac-hud-item ac-hud-item--pillar", title: `${pillar.name}: ${pillar.description}` }, [
      h("span", { class: "ac-hud-glyph", style: { color: pillar.color }, text: pillar.sigil }),
      h("div", { class: "ac-hud-info" }, [
        h("span", { class: "ac-hud-k", text: "Active Pillar" }),
        h("span", { class: "ac-hud-v", style: { color: pillar.color }, text: pillar.name }),
      ]),
    ]),

    // Celestial Modality Balance
    h("div", { class: "ac-hud-item ac-hud-item--mod", title: `Modalities: ${tel.modalities.cardinal}% Cardinal · ${tel.modalities.fixed}% Fixed · ${tel.modalities.mutable}% Mutable | Polarity: ${tel.polarities.diurnal}% Diurnal (Yang) · ${tel.polarities.nocturnal}% Nocturnal (Yin)` }, [
      h("div", { class: "ac-hud-info" }, [
        h("span", { class: "ac-hud-k", text: "Polarity & Modality" }),
        h("span", { class: "ac-hud-v", text: `☉ ${tel.polarities.diurnal}% / ☽ ${tel.polarities.nocturnal}% · C${tel.modalities.cardinal} F${tel.modalities.fixed} M${tel.modalities.mutable}` }),
      ]),
    ]),
  ]);

  container.appendChild(ribbon);
}

// ── 2. Left Column: Alchemical Core (Temperament, Tokens, Thermo-Kinetics) ───

export function renderSmes(container, state) {
  clear(container);
  const esms = state.esms;
  const smes = state.smes || { pct: [25, 25, 25, 25], weights: {}, ruler: 0 };
  const pct = smes.pct || [25, 25, 25, 25];
  const dominant = pct.indexOf(Math.max(...pct));
  const planetGlyphs = (state.glyphs && state.glyphs.planet) || ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
  const planetNames = (state.glyphs && state.glyphs.planetName) || [];

  state.leftTab = state.leftTab || "temperament";

  // Tab Header
  const tabWrap = h("div", { class: "ac-deck-tabs" }, [
    h("button", {
      class: "ac-deck-tab" + (state.leftTab === "temperament" ? " is-active" : ""),
      text: "Temperament & Tokens",
      onclick: () => { state.leftTab = "temperament"; renderSmes(container, state); },
    }),
    h("button", {
      class: "ac-deck-tab" + (state.leftTab === "thermodynamics" ? " is-active" : ""),
      text: "Thermodynamics & Kinetics",
      onclick: () => { state.leftTab = "thermodynamics"; renderSmes(container, state); },
    }),
  ]);
  container.appendChild(tabWrap);

  if (state.leftTab === "temperament") {
    // ── Hero readout + chart-ruler crown ──
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

    // ── Four-quadrant diamond gauge ──
    container.appendChild(buildDiamond(pct, esms, dominant));

    // ── Tokenized ESMS Quantities & Faucet Economics (ADR-014/ADR-015) ──
    container.appendChild(buildTokenizedYield(pct, state));

    // ── Per-planet contribution stack ──
    container.appendChild(buildContribution(state, esms, smes, planetGlyphs, planetNames));
  } else {
    // ── Thermodynamics & Kinetics Tab ──
    container.appendChild(buildThermodynamicsDeck(state, pct, smes));
  }
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

/** Tokenized ESMS Quantities & Faucet Yield Display (ADR-014/015) */
function buildTokenizedYield(pct, state) {
  const tokenData = computeTokenizedQuantities(pct, state.chart);
  const card = h("div", { class: "ac-token-card" });

  const head = h("div", { class: "ac-token-head" }, [
    h("span", { class: "ac-token-title", text: "Tokenized ESMS Quantities" }),
    h("span", { class: "ac-token-badge", text: `z = ${tokenData.resonanceMultiplier}×` }),
  ]);

  const grid = h("div", { class: "ac-token-grid" });
  for (const tok of tokenData.tokens) {
    grid.appendChild(h("div", { class: "ac-token-item" }, [
      h("div", { class: "ac-token-row1" }, [
        h("span", { class: "ac-token-glyph", style: { color: tok.color }, text: tok.primaryGlyph }),
        h("span", { class: "ac-token-code", style: { color: tok.color }, text: tok.atomicCode }),
        tok.damped ? h("span", { class: "ac-token-damp", title: "Counter-cyclical 0.75x damping active on global supply glut" }, "0.75×") : null,
      ]),
      h("div", { class: "ac-token-amt", text: tok.amount.toFixed(4) }),
      h("div", { class: "ac-token-sub ac-dim", text: `${Math.round(tok.rawShare)}% · floor ${tokenData.gasFloor.toFixed(2)}` }),
    ]));
  }

  const foot = h("div", { class: "ac-token-foot ac-dim" }, [
    h("span", { text: `Baseline Daily Grant: ${tokenData.totalYield.toFixed(4)} ESMS` }),
    h("span", { class: "ac-token-adr", text: "ADR-015 Conserved Yield" }),
  ]);

  card.appendChild(head);
  card.appendChild(grid);
  card.appendChild(foot);
  return card;
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

/** Thermodynamics & Kinetics Panel */
function buildThermodynamicsDeck(state, pct, smes) {
  const chart = state.chart;
  const vel = chart ? (state._velocities ? state._velocities(chart) : {}) : {};
  const pillar = resolveAlchemicalPillar(pct);
  const thermo = computeThermodynamics(pct, pillar);
  const kinetics = computeKineticSpectrum(chart, vel, smes);

  const wrap = h("div", { class: "ac-thermo-deck" });

  // 1. Resolved Alchemical Pillar Card
  const pCard = h("div", { class: "ac-pillar-card" }, [
    h("div", { class: "ac-pillar-head" }, [
      h("span", { class: "ac-pillar-sigil", style: { color: pillar.color }, text: pillar.sigil }),
      h("div", { class: "ac-pillar-titles" }, [
        h("div", { class: "ac-pillar-name", style: { color: pillar.color }, text: `${pillar.name} — Pillar #${pillar.id}` }),
        h("div", { class: "ac-pillar-elements ac-dim", text: `${pillar.primaryElement} ⇄ ${pillar.secondaryElement}` }),
      ]),
    ]),
    h("div", { class: "ac-pillar-desc", text: pillar.description }),
    h("div", { class: "ac-pillar-delta" }, [
      h("span", { class: "ac-p-badge", text: `🜂 Spirit ${pillar.effects.Spirit > 0 ? "+" + pillar.effects.Spirit : pillar.effects.Spirit}` }),
      h("span", { class: "ac-p-badge", text: `🜄 Essence ${pillar.effects.Essence > 0 ? "+" + pillar.effects.Essence : pillar.effects.Essence}` }),
      h("span", { class: "ac-p-badge", text: `🜃 Matter ${pillar.effects.Matter > 0 ? "+" + pillar.effects.Matter : pillar.effects.Matter}` }),
      h("span", { class: "ac-p-badge", text: `🜁 Substance ${pillar.effects.Substance > 0 ? "+" + pillar.effects.Substance : pillar.effects.Substance}` }),
    ]),
  ]);
  wrap.appendChild(pCard);

  // 2. Kalchm Thermodynamic Gauges
  const thermoCard = h("div", { class: "ac-thermo-card" }, [
    h("div", { class: "ac-thermo-head" }, [
      h("span", { class: "ac-thermo-title", text: "Kalchm Thermodynamics" }),
      h("span", { class: "ac-thermo-rating", text: thermo.potencyRating }),
    ]),
    h("div", { class: "ac-thermo-grid" }, [
      h("div", { class: "ac-t-stat" }, [
        h("span", { class: "ac-t-k ac-dim", text: "Heat (Q)" }),
        h("span", { class: "ac-t-v ac-t-v--heat", text: String(thermo.heat) }),
        h("span", { class: "ac-t-sub ac-dim", text: "kinetic strike power" }),
      ]),
      h("div", { class: "ac-t-stat" }, [
        h("span", { class: "ac-t-k ac-dim", text: "Entropy (S)" }),
        h("span", { class: "ac-t-v ac-t-v--entropy", text: String(thermo.entropy) }),
        h("span", { class: "ac-t-sub ac-dim", text: "elemental dispersion" }),
      ]),
      h("div", { class: "ac-t-stat" }, [
        h("span", { class: "ac-t-k ac-dim", text: "Reactivity (R)" }),
        h("span", { class: "ac-t-v ac-t-v--react", text: thermo.reactivity.toFixed(2) }),
        h("span", { class: "ac-t-sub ac-dim", text: "transmutation rate" }),
      ]),
      h("div", { class: "ac-t-stat" }, [
        h("span", { class: "ac-t-k ac-dim", text: "Free Energy (ΔG)" }),
        h("span", { class: "ac-t-v ac-t-v--dg" + (thermo.freeEnergy > 0 ? " is-pos" : ""), text: `${thermo.freeEnergy > 0 ? "+" : ""}${thermo.freeEnergy}` }),
        h("span", { class: "ac-t-sub ac-dim", text: "alchemical work potency" }),
      ]),
    ]),
  ]);
  wrap.appendChild(thermoCard);

  // 3. Kinetic Spectrum & Planetary 12 Axes
  const kinCard = h("div", { class: "ac-kinetics-card" }, [
    h("div", { class: "ac-kinetics-head" }, [
      h("span", { class: "ac-kinetics-title", text: "Planetary 12 & Kinetic Alignment" }),
      h("span", { class: "ac-kinetics-badge", text: `⚡ ${kinetics.overallKinetic}%` }),
    ]),
    h("div", { class: "ac-kinetics-list" }, kinetics.axes.map((a) => {
      return h("div", { class: "ac-k-row" }, [
        h("span", { class: "ac-k-glyph", style: { color: a.color }, text: a.glyph }),
        h("div", { class: "ac-k-name-col" }, [
          h("span", { class: "ac-k-name", text: a.name }),
          h("span", { class: "ac-k-status ac-dim", text: `${a.status} · H${a.house}` }),
        ]),
        h("div", { class: "ac-k-bar-wrap" }, [
          h("div", { class: "ac-k-bar", style: { width: a.val + "%", background: a.color } }),
        ]),
        h("span", { class: "ac-k-val", text: `${a.val}%` }),
      ]);
    })),
  ]);
  wrap.appendChild(kinCard);

  return wrap;
}

// ── 3. Center Column: Aspects & Transits Lower Deck ──────────────────────────

export function renderTransitStrip(container, state) {
  clear(container);
  if (!state.chart) return;
  const { glyph, name } = bodyLabels(state);
  const chart = state.chart;
  const aspects = chart.aspects || [];
  const transits = chart.transitAspects || [];

  state.aspectFilter = state.aspectFilter || "all";
  state.centerTab = state.centerTab || (state.frame === "transit" ? "transits" : "aspects");

  const deck = h("div", { class: "ac-aspects-deck" });

  // Center Tab Controls
  const tabs = h("div", { class: "ac-deck-tabs" }, [
    h("button", {
      class: "ac-deck-tab" + (state.centerTab === "aspects" ? " is-active" : ""),
      text: `Active Aspects (${aspects.length})`,
      onclick: () => { state.centerTab = "aspects"; renderTransitStrip(container, state); },
    }),
    h("button", {
      class: "ac-deck-tab" + (state.centerTab === "transits" ? " is-active" : ""),
      text: `Transits (${transits.length})`,
      onclick: () => { state.centerTab = "transits"; renderTransitStrip(container, state); },
    }),
    h("button", {
      class: "ac-deck-tab" + (state.centerTab === "reading" ? " is-active" : ""),
      text: "Cosmic Reading",
      onclick: () => { state.centerTab = "reading"; renderTransitStrip(container, state); },
    }),
  ]);
  deck.appendChild(tabs);

  if (state.centerTab === "aspects") {
    // Filter Pills
    const filters = [
      { id: "all", label: "All" },
      { id: "exact", label: "✦ Exact (<1°)" },
      { id: "conjunction", label: "☌ Conjunction" },
      { id: "trine", label: "△ Trine" },
      { id: "sextile", label: "⚹ Sextile" },
      { id: "square", label: "□ Square" },
      { id: "opposition", label: "☍ Opposition" },
    ];
    const filterRow = h("div", { class: "ac-aspect-filters" });
    for (const f of filters) {
      filterRow.appendChild(h("button", {
        class: "ac-filter-pill" + (state.aspectFilter === f.id ? " is-active" : ""),
        text: f.label,
        onclick: () => { state.aspectFilter = f.id; renderTransitStrip(container, state); },
      }));
    }
    deck.appendChild(filterRow);

    // Aspect Cards
    const filtered = aspects.filter((a) => {
      if (state.aspectFilter === "exact") return a.orb < 1.0;
      if (state.aspectFilter !== "all") return a.type === state.aspectFilter;
      return true;
    });

    if (filtered.length === 0) {
      deck.appendChild(h("div", { class: "ac-empty-aspects", text: "No aspects match the active filter in this moment." }));
    } else {
      const grid = h("div", { class: "ac-aspects-grid" });
      for (const a of filtered) {
        const bodyA = (chart.byBody || {})[a.a];
        const bodyB = (chart.byBody || {})[a.b];
        const isApp = a.state === "applying";
        const isExact = a.orb < 1.0;

        const row = h("div", {
          class: "ac-aspect-card" + (isExact ? " is-exact" : isApp ? " is-app" : ""),
          tabindex: "0",
          role: "button",
          onclick: () => state.hooks.onSelect && state.hooks.onSelect({ kind: "aspect", asp: a, a: bodyA, b: bodyB }),
        }, [
          h("div", { class: "ac-asp-pair" }, [
            h("span", { class: "ac-asp-glyphs", text: `${glyph(a.a)} ${a.glyph} ${glyph(a.b)}` }),
            h("span", { class: "ac-asp-names", text: `${name(a.a)} — ${name(a.b)}` }),
          ]),
          h("div", { class: "ac-asp-meta" }, [
            h("span", { class: "ac-asp-type", text: a.type }),
            h("span", { class: "ac-asp-orb", text: `orb ${a.orb}°` }),
            h("span", { class: "ac-asp-state" + (isExact ? " ac-asp-state--exact" : isApp ? " ac-asp-state--app" : ""), text: isExact ? "✦ Exact" : a.state }),
          ]),
          h("div", { class: "ac-asp-bar-wrap", title: `Influence: ${Math.round(a.influence * 100)}%` }, [
            h("div", { class: "ac-asp-bar", style: { width: Math.round(a.influence * 100) + "%" } }),
          ]),
        ]);
        grid.appendChild(row);
      }
      deck.appendChild(grid);
    }
  } else if (state.centerTab === "transits") {
    // Transits list
    if (transits.length === 0) {
      deck.appendChild(h("div", { class: "ac-empty-aspects", text: state.frame === "transit" ? "No close transits to your natal chart right now." : "Switch to Transit mode to read current celestial transits against your natal chart." }));
    } else {
      const grid = h("div", { class: "ac-aspects-grid" });
      const natalByBody = chart.natalByBody || {};
      for (const a of transits.slice(0, 12)) {
        const np = natalByBody[a.n];
        const ndc = np ? decanCard(np.sign, np.degInSign) : null;
        const row = h("div", { class: "ac-aspect-card is-transit" }, [
          h("div", { class: "ac-asp-pair" }, [
            h("span", { class: "ac-asp-glyphs", text: `${glyph(a.t)} ${a.glyph} ${glyph(a.n)}` }),
            h("span", { class: "ac-asp-names", text: `Transit ${name(a.t)} → Natal ${name(a.n)}` }),
          ]),
          h("div", { class: "ac-asp-meta" }, [
            h("span", { class: "ac-asp-type", text: a.type }),
            h("span", { class: "ac-asp-orb", text: `orb ${a.orb}°` }),
            h("span", { class: "ac-asp-state", text: a.state }),
          ]),
          ndc ? h("div", { class: "ac-asp-card-ref ac-dim", text: `natal: 🎴 ${ndc.card} (${ndc.title})` }) : null,
        ]);
        grid.appendChild(row);
      }
      deck.appendChild(grid);
    }
  } else if (state.centerTab === "reading") {
    // Cosmic Reading embedded
    const readingBox = h("div", { class: "ac-reading-embedded" });
    renderReading(readingBox, state);
    deck.appendChild(readingBox);
  }

  container.appendChild(deck);
}

// ── 4. Reading Prose & Synthesis ─────────────────────────────────────────────

export function renderReading(container, state) {
  clear(container);
  const esms = state.esms, smes = state.smes;
  if (!state.chart || !smes) return;
  const { glyph, name } = bodyLabels(state);

  const pct = smes.pct, dom = pct.indexOf(Math.max(...pct));
  const ruler = smes.ruler != null ? smes.ruler : 0;
  const rulerPos = (state.chart.byBody || {})[ruler];
  const rulerDc = rulerPos ? decanCard(rulerPos.sign, rulerPos.degInSign) : null;

  let aspLine = "—";
  if (state.frame === "transit" && state.chart.transitAspects && state.chart.transitAspects[0]) {
    const a = state.chart.transitAspects[0];
    aspLine = `${glyph(a.t)} ${a.glyph} ${glyph(a.n)} · ${a.type} · orb ${a.orb}° · ${a.state}`;
  } else if (state.chart.aspects && state.chart.aspects.length) {
    const a = state.chart.aspects.slice().sort((x, y) => x.orb - y.orb)[0];
    aspLine = `${glyph(a.a)} ${a.glyph} ${glyph(a.b)} · ${a.type} · orb ${a.orb}° · ${a.state}`;
  }

  const pressures = state.pressures || {};
  let topId = null, topPr = -1;
  for (const id in pressures) if (pressures[id].pressure > topPr) { topPr = pressures[id].pressure; topId = id; }
  const topPool = topId != null ? (state.poolMeta.find((m) => m.constId === Number(topId)) || {}) : null;

  const row = (label, valueNode) => h("div", { class: "ac-read-row" }, [
    h("span", { class: "ac-read-k", text: label }), valueNode,
  ]);

  const card = h("div", { class: "ac-reading" }, [
    h("div", { class: "ac-reading-head" }, [
      h("span", { class: "ac-reading-title", text: "Reading of the Moment" }),
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

// ── 5. Right Column: Constellation DEX Pools & Decans Switcher ──────────────

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

// ── 6. Right Column: Planetary Horizons, Aspect Ingress, & DEX Pools ────────

function buildHorizonsTable(state, compact = false) {
  if (!state.chart) return h("div", { class: "ac-dim ac-pad-sm", text: "Computing planetary events…" });
  const { horizons } = computePlanetaryEvents(state.chart, state.observer, state.date);

  const wrap = h("div", { class: "ac-horizons-container" });
  wrap.appendChild(h("div", {
    class: "ac-section-label",
    text: compact ? "Planetary Horizon Gates" : "Planetary Horizons & Gates (Rise · Culmination · Set)",
  }));

  const list = h("div", { class: "ac-horizon-list" });
  for (const hItem of horizons) {
    const isRisen = hItem.isRisen;
    const pos = (state.chart.positions || []).find((p) => p.body === hItem.body);
    const row = h("div", {
      class: "ac-horizon-row" + (isRisen ? " is-risen" : " is-subterranean"),
      role: "button",
      tabindex: "0",
      title: `${hItem.name} in ${hItem.signName} (${hItem.degInSign}°)\nCelestial Journey: ${hItem.progressionText} (${hItem.progressionLabel})\nAltitude: ${hItem.alt.toFixed(1)}° · Azimuth: ${hItem.az.toFixed(1)}°\nRise: ${hItem.riseTime} | Culmination: ${hItem.transitTime} | Set: ${hItem.setTime}\n${hItem.nextEvent}`,
      onclick: () => { if (pos && state.hooks.onSelect) state.hooks.onSelect({ kind: "body", pos }); },
      onkeydown: (e) => { if ((e.key === "Enter" || e.key === " ") && pos && state.hooks.onSelect) { e.preventDefault(); state.hooks.onSelect({ kind: "body", pos }); } },
    }, [
      // Left: Glyph + Name + Sign + Altitude status
      h("div", { class: "ac-h-main" }, [
        h("span", { class: "ac-h-glyph", style: { color: hItem.color, borderColor: hItem.color }, text: hItem.glyph }),
        h("div", { class: "ac-h-identity" }, [
          h("div", { class: "ac-h-name-line" }, [
            h("span", { class: "ac-h-name", text: hItem.name }),
            h("span", { class: "ac-h-pos ac-dim", text: `${hItem.degInSign}° ${hItem.signGlyph}` }),
          ]),
          h("div", { class: "ac-h-alt-line" }, [
            h("span", {
              class: "ac-h-alt-badge " + (isRisen ? "is-up" : "is-down"),
              text: `${isRisen ? "▲" : "▼"} ${Math.abs(hItem.alt).toFixed(1)}° ${isRisen ? "Risen" : "Below"}`,
            }),
          ]),
        ]),
      ]),

      // Center-Left: 3 Celestial Horizon Gate Times
      h("div", { class: "ac-h-times" }, [
        h("div", { class: "ac-h-time-col", title: `Point of Rising (East Horizon): ${hItem.riseTime}` }, [
          h("span", { class: "ac-h-time-k", text: "↗ Rise" }),
          h("span", { class: "ac-h-time-v", text: hItem.riseTime }),
        ]),
        h("div", { class: "ac-h-time-col", title: `Zenith / Solar Noon / Culmination: ${hItem.transitTime}` }, [
          h("span", { class: "ac-h-time-k", text: "✦ Culm" }),
          h("span", { class: "ac-h-time-v", text: hItem.transitTime }),
        ]),
        h("div", { class: "ac-h-time-col", title: `Point of Setting (West Horizon): ${hItem.setTime}` }, [
          h("span", { class: "ac-h-time-k", text: "↘ Set" }),
          h("span", { class: "ac-h-time-v", text: hItem.setTime }),
        ]),
      ]),

      // Center-Right: Celestial Journey Progression Gauge (0% risen -> 100% setting, -100 set -> -1 about to rise)
      h("div", {
        class: "ac-h-prog",
        title: `Journey Across Sky: ${hItem.progressionText} (${hItem.progressionLabel})\n0% = Just risen at East\n50% = Culmination / Solar Noon\n100% = Setting at West\n-100 = Fully set below horizon\n-1 = About to rise`,
      }, [
        h("div", { class: "ac-h-prog-head" }, [
          h("span", { class: "ac-h-prog-k", text: isRisen ? "Sky Journey" : "Underworld" }),
          h("span", {
            class: "ac-h-prog-val " + (isRisen ? "is-up" : "is-down"),
            text: hItem.progressionText,
          }),
        ]),
        h("div", { class: "ac-h-prog-rail" }, [
          h("div", {
            class: "ac-h-prog-fill " + (isRisen ? "is-up" : "is-down"),
            style: { width: `${(hItem.progressionFraction * 100).toFixed(1)}%` },
          }),
          h("div", {
            class: "ac-h-prog-bead " + (isRisen ? "is-up" : "is-down"),
            style: {
              left: `${(hItem.progressionFraction * 100).toFixed(1)}%`,
              backgroundColor: hItem.color,
            },
          }),
        ]),
        h("div", { class: "ac-h-prog-sub ac-dim", text: hItem.progressionLabel }),
      ]),

      // Right: Countdown status badge
      h("div", { class: "ac-h-status" }, [
        h("span", {
          class: "ac-h-countdown " + (isRisen ? "is-setting" : "is-rising"),
          text: hItem.nextEvent,
        }),
      ]),
    ]);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

function buildAspectTimeline(state, limit = 8) {
  if (!state.chart) return h("div", { class: "ac-dim ac-pad-sm", text: "Tracking aspect timeline…" });
  const { aspectTimeline } = computePlanetaryEvents(state.chart, state.observer, state.date);
  const items = (aspectTimeline || []).slice(0, limit);

  const wrap = h("div", { class: "ac-aspect-timeline-container" });
  wrap.appendChild(h("div", { class: "ac-section-label", text: "Aspect Ingress Chronology (Timing to Exact)" }));

  if (!items.length) {
    wrap.appendChild(h("div", { class: "ac-dim ac-pad-sm", text: "No major Ptolemaic aspects within orb." }));
    return wrap;
  }

  const list = h("div", { class: "ac-aspect-timeline-list" });
  for (const item of items) {
    const asp = item.asp;
    const aPos = (state.chart.positions || []).find((p) => p.body === asp.a);
    const bPos = (state.chart.positions || []).find((p) => p.body === asp.b);

    const row = h("div", {
      class: "ac-atl-row" + (item.isExact ? " is-exact" : "") + (item.isApp ? " is-applying" : " is-separating"),
      role: "button",
      tabindex: "0",
      title: `${item.pairName} · ${item.type} (${item.orbText})\nState: ${item.isApp ? "Applying (approaching peak)" : "Separating (receding)"}\nTimeline: ${item.timeText}`,
      onclick: () => {
        if (state.hooks.onSelect && asp) {
          state.hooks.onSelect({
            kind: "aspect",
            asp,
            a: aPos || { name: `Body ${asp.a}` },
            b: bPos || { name: `Body ${asp.b}` },
          });
        }
      },
      onkeydown: (e) => {
        if ((e.key === "Enter" || e.key === " ") && state.hooks.onSelect && asp) {
          e.preventDefault();
          state.hooks.onSelect({
            kind: "aspect",
            asp,
            a: aPos || { name: `Body ${asp.a}` },
            b: bPos || { name: `Body ${asp.b}` },
          });
        }
      },
    }, [
      // Left: Pair glyphs + Name
      h("div", { class: "ac-atl-left" }, [
        h("span", { class: "ac-atl-glyphs", text: item.pairGlyphs }),
        h("div", { class: "ac-atl-pair-info" }, [
          h("span", { class: "ac-atl-pair-name", text: item.pairName }),
          h("span", { class: "ac-atl-type ac-dim", text: item.type }),
        ]),
      ]),

      // Center: Orb badge with applying/separating arrow
      h("div", { class: "ac-atl-center" }, [
        h("span", {
          class: "ac-atl-orb-pill" + (item.isExact ? " is-exact" : (item.isApp ? " is-applying" : " is-separating")),
          text: `${item.isApp ? "↗" : "↘"} ${item.orbText}`,
        }),
      ]),

      // Right: Timing countdown to exact angle
      h("div", { class: "ac-atl-right" }, [
        h("span", { class: "ac-atl-time" + (item.isExact ? " is-exact" : ""), text: item.timeText }),
      ]),
    ]);
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

export function renderPools(container, state) {
  clear(container);
  const esms = state.esms;
  state.rightTab = state.rightTab || "horizons";

  // Segmented control: Ephemeris & Horizons vs Constellation DEX Pools vs Decan Arcana
  const tabs = h("div", { class: "ac-deck-tabs" }, [
    h("button", {
      class: "ac-deck-tab" + (state.rightTab === "horizons" ? " is-active" : ""),
      text: "✦ Ephemeris & Horizons",
      onclick: () => { state.rightTab = "horizons"; renderPools(container, state); },
    }),
    h("button", {
      class: "ac-deck-tab" + (state.rightTab === "pools" ? " is-active" : ""),
      text: "DEX Pools",
      onclick: () => { state.rightTab = "pools"; renderPools(container, state); },
    }),
    h("button", {
      class: "ac-deck-tab" + (state.rightTab === "decans" ? " is-active" : ""),
      text: "Minor Arcana",
      onclick: () => { state.rightTab = "decans"; renderPools(container, state); },
    }),
  ]);
  container.appendChild(tabs);

  if (state.rightTab === "horizons") {
    container.appendChild(buildHorizonsTable(state, false));
    container.appendChild(buildAspectTimeline(state, 8));
    return;
  }

  if (state.rightTab === "decans") {
    const decanHost = h("div", { class: "ac-decans-hosted" });
    renderDecans(decanHost, state);
    container.appendChild(decanHost);
    container.appendChild(buildAspectTimeline(state, 4));
    return;
  }

  // Constellation Pools List
  container.appendChild(h("div", { class: "ac-section-label", text: "Astro-Pressure vs Live AMM Depth" }));

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
        h("span", { class: "ac-pool-abbr", text: pool.abbr || "#" + id }),
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

  // Fill remaining space under pools with Planetary Horizons & Aspect Ingress Brief
  container.appendChild(buildHorizonsTable(state, true));
  container.appendChild(buildAspectTimeline(state, 4));
}
