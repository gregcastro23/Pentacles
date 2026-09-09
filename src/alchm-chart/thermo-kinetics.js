/* ============================================================
   AlchmChart — Thermo-Kinetics & Tokenized Economics Engine
   ============================================================
   Authoritative, pure mathematical engine for:
     1. 14 Alchemical Pillars & Kalchm Thermodynamics (Q, S, R, ΔG)
     2. Planetary 12 & Celestial Kinetics runtime scoring
     3. Canonical ADR-014 / ADR-015 Token Quantities & Faucet Yield
     4. Real-time Moment Telemetry Snapshot (Lunation, Solar Decan,
        Chaldean Hour Ruler, Modality & Polarity balance)
   ============================================================ */

import { decanCard } from "./decans.js";

/**
 * The 14 Alchemical Pillars of Elemental Transformation.
 * Authoritative definitions from WTEN & AAE ESMS Kalchm specifications.
 */
export const ALCHEMICAL_PILLARS = Object.freeze([
  {
    id: 1,
    name: "Solution",
    description: "Dissolves solid matter into liquid essence, expanding Spirit & Water affinity.",
    effects: { Spirit: -1, Essence: 1, Matter: 1, Substance: -1 },
    primaryElement: "Water",
    secondaryElement: "Earth",
    sigil: "🜔",
    color: "#5f93d8",
  },
  {
    id: 2,
    name: "Filtration",
    description: "Separates dense impurities, purifying volatile Spirit & Air currents.",
    effects: { Spirit: 1, Essence: 1, Matter: -1, Substance: 1 },
    primaryElement: "Air",
    secondaryElement: "Water",
    sigil: "🜕",
    color: "#aebbd6",
  },
  {
    id: 3,
    name: "Evaporation",
    description: "Thermal vaporisation liberating Essence & Spirit into atmospheric voltage.",
    effects: { Spirit: 1, Essence: 1, Matter: -1, Substance: -1 },
    primaryElement: "Air",
    secondaryElement: "Fire",
    sigil: "🜖",
    color: "#f0a04b",
  },
  {
    id: 4,
    name: "Distillation",
    description: "Cycles of vapor and condensation producing hyper-pure Quintessence.",
    effects: { Spirit: 1, Essence: 1, Matter: -1, Substance: 1 },
    primaryElement: "Water",
    secondaryElement: "Air",
    sigil: "🜗",
    color: "#67d8d6",
  },
  {
    id: 5,
    name: "Separation",
    description: "Breaks complex compounds into raw elemental component forces.",
    effects: { Spirit: 1, Essence: 1, Matter: 1, Substance: -1 },
    primaryElement: "Fire",
    secondaryElement: "Water",
    sigil: "🜘",
    color: "#e85f5f",
  },
  {
    id: 6,
    name: "Rectification",
    description: "Harmonious balancing and elevation of all four elemental vectors.",
    effects: { Spirit: 1, Essence: 1, Matter: 1, Substance: 1 },
    primaryElement: "Fire",
    secondaryElement: "Air",
    sigil: "🜙",
    color: "#f6cf83",
  },
  {
    id: 7,
    name: "Calcination",
    description: "Intense heat reducing matter to purified alchemical ash and salt.",
    effects: { Spirit: -1, Essence: 1, Matter: 1, Substance: -1 },
    primaryElement: "Fire",
    secondaryElement: "Earth",
    sigil: "🜂",
    color: "#db7a47",
  },
  {
    id: 8,
    name: "Comixion",
    description: "Intimate melding of earthly matter and volatile air currents.",
    effects: { Spirit: 1, Essence: -1, Matter: 1, Substance: 1 },
    primaryElement: "Earth",
    secondaryElement: "Air",
    sigil: "🜃",
    color: "#74ab6c",
  },
  {
    id: 9,
    name: "Purification",
    description: "Exorcises dense slag, concentrating ethereal Spirit & Essence.",
    effects: { Spirit: 1, Essence: 1, Matter: -1, Substance: -1 },
    primaryElement: "Fire",
    secondaryElement: "Air",
    sigil: "🜄",
    color: "#e6b3eb",
  },
  {
    id: 10,
    name: "Inhibition",
    description: "Crystalline cooling restraining chaotic reactions into solid structure.",
    effects: { Spirit: -1, Essence: -1, Matter: 1, Substance: 1 },
    primaryElement: "Earth",
    secondaryElement: "Water",
    sigil: "🜅",
    color: "#5b8c85",
  },
  {
    id: 11,
    name: "Fermentation",
    description: "Organic micro-enzymatic transformation generating living Spirit.",
    effects: { Spirit: 1, Essence: 1, Matter: 1, Substance: -1 },
    primaryElement: "Water",
    secondaryElement: "Fire",
    sigil: "🜆",
    color: "#a47bd6",
  },
  {
    id: 12,
    name: "Fixation",
    description: "Anchors volatile ethereal vapors into unshakeable physical form.",
    effects: { Spirit: -1, Essence: -1, Matter: 1, Substance: 1 },
    primaryElement: "Earth",
    secondaryElement: "Air",
    sigil: "🜇",
    color: "#8b9c66",
  },
  {
    id: 13,
    name: "Multiplication",
    description: "Exponential amplification of alchemical potency and yield.",
    effects: { Spirit: 1, Essence: 1, Matter: 1, Substance: -1 },
    primaryElement: "Fire",
    secondaryElement: "Water",
    sigil: "🜈",
    color: "#ffc947",
  },
  {
    id: 14,
    name: "Protection",
    description: "Master culmination sealing and safeguarding the Great Work.",
    effects: { Spirit: 1, Essence: 1, Matter: 1, Substance: 1 },
    primaryElement: "Fire",
    secondaryElement: "Earth",
    sigil: "🜉",
    color: "#ffd700",
  },
]);

/**
 * Canonical ADR-014 / ADR-015 Token Identities.
 */
export const CANONICAL_TOKENS = Object.freeze([
  {
    id: 0,
    name: "SPIRIT",
    key: "spirit",
    primaryGlyph: "🝇",
    triangularVariant: "🜂",
    atomicCode: "[SPRT]",
    element: "Fire",
    color: "#e0a23a",
    domain: "Combat strike power, kinetic action gas, thermodynamic heat Q",
  },
  {
    id: 1,
    name: "ESSENCE",
    key: "essence",
    primaryGlyph: "🝑",
    triangularVariant: "🜄",
    atomicCode: "[ESNC]",
    element: "Water",
    color: "#4aa3d8",
    domain: "Health regeneration, secret lore decryption, free energy ΔG",
  },
  {
    id: 2,
    name: "MATTER",
    key: "matter",
    primaryGlyph: "🝙",
    triangularVariant: "🜃",
    atomicCode: "[MATR]",
    element: "Earth",
    color: "#5fb37a",
    domain: "Garrison defense, star fortification, low entropy S stabilization",
  },
  {
    id: 3,
    name: "SUBSTANCE",
    key: "substance",
    primaryGlyph: "🝉",
    triangularVariant: "🜁",
    atomicCode: "[SUBS]",
    element: "Air",
    color: "#b98cd6",
    domain: "Multi-seat melee strategy, conclave deliberation, AMM LP routing",
  },
]);

export const PROTOCOL_BAND = Object.freeze({
  Y_MIN: 6.0,
  Y_MAX: 48.0,
  CENTRE: 24.0,
  AXIS_FLOOR: 0.5,
  TOTAL_FLOOR: 2.0,
});

export const CURRENT_MATTER_DAMPING = 0.75;

/**
 * 12 Canonical Planetary Axes (Sacred 7 / Planetary 12).
 */
export const PLANETARY_12_AXES = Object.freeze([
  { id: "solarAgency", name: "Solar Agency", body: 0, glyph: "☉", color: "#f1dba1" },
  { id: "lunarReceptivity", name: "Lunar Receptivity", body: 1, glyph: "☽", color: "#cfd6e6" },
  { id: "mercurialVelocity", name: "Mercurial Velocity", body: 2, glyph: "☿", color: "#9ad0c0" },
  { id: "venusianCoherence", name: "Venusian Coherence", body: 3, glyph: "♀", color: "#7fd1a8" },
  { id: "martialImpetus", name: "Martial Impetus", body: 4, glyph: "♂", color: "#e0a23a" },
  { id: "jovianExpansion", name: "Jovian Expansion", body: 5, glyph: "♃", color: "#d8b46a" },
  { id: "saturnianStructure", name: "Saturnian Structure", body: 6, glyph: "♄", color: "#b98cd6" },
  { id: "chironicAdaptation", name: "Chironic Adaptation", body: 10, glyph: "⚷", color: "#67d8d6" },
  { id: "uranianSurprisal", name: "Uranian Surprisal", body: 7, glyph: "♅", color: "#5fb37a" },
  { id: "neptunianResonance", name: "Neptunian Resonance", body: 8, glyph: "♆", color: "#4aa3d8" },
  { id: "plutonicIntegration", name: "Plutonic Integration", body: 9, glyph: "♇", color: "#a47bd6" },
  { id: "kineticAlignment", name: "Kinetic Alignment", body: null, glyph: "⚡", color: "#ffd700" },
]);

/**
 * Resolve the matching Alchemical Pillar based on elemental weights.
 * @param {Array<number>} esmsPct - [Spirit, Essence, Matter, Substance] percentages
 * @returns {object} Canonical Pillar definition
 */
export function resolveAlchemicalPillar(esmsPct) {
  const pct = esmsPct || [25, 25, 25, 25];
  const elements = [
    { name: "Fire", val: pct[0] },
    { name: "Water", val: pct[1] },
    { name: "Earth", val: pct[2] },
    { name: "Air", val: pct[3] },
  ].sort((a, b) => b.val - a.val);

  const dom = elements[0].name;
  const sec = elements[1].name;
  const diff = elements[0].val - elements[3].val;

  let pillarId = 1;
  if (diff < 6) {
    pillarId = 6; // Rectification (near perfect harmony)
  } else if (dom === "Fire" && sec === "Water") {
    pillarId = elements[0].val > 35 ? 13 : 5; // Multiplication or Separation
  } else if (dom === "Fire" && sec === "Earth") {
    pillarId = 7; // Calcination
  } else if (dom === "Water" && sec === "Air") {
    pillarId = 4; // Distillation
  } else if (dom === "Water" && sec === "Earth") {
    pillarId = 1; // Solution
  } else if (dom === "Air" && sec === "Fire") {
    pillarId = 3; // Evaporation
  } else if (dom === "Air" && sec === "Water") {
    pillarId = 2; // Filtration
  } else if (dom === "Earth" && sec === "Air") {
    pillarId = diff > 15 ? 8 : 12; // Comixion or Fixation
  } else if (dom === "Earth" && sec === "Water") {
    pillarId = 10; // Inhibition
  } else if (dom === "Water" && sec === "Fire") {
    pillarId = 11; // Fermentation
  } else if (dom === "Fire" && sec === "Air") {
    pillarId = 9; // Purification
  } else {
    pillarId = 14; // Protection fallback
  }

  return ALCHEMICAL_PILLARS.find((p) => p.id === pillarId) || ALCHEMICAL_PILLARS[0];
}

/**
 * Compute Kalchm Thermodynamic Quantities (Q, S, R, ΔG).
 * @param {Array<number>} esmsPct - [Spirit, Essence, Matter, Substance] percentages
 * @param {object} pillar - The resolved Alchemical Pillar
 * @returns {object} Heat, Entropy, Reactivity, Free Energy, and Potency State
 */
export function computeThermodynamics(esmsPct, pillar) {
  const pct = esmsPct || [25, 25, 25, 25];
  const p = pillar || resolveAlchemicalPillar(pct);
  const fx = p.effects || { Spirit: 0, Essence: 0, Matter: 0, Substance: 0 };

  const tSpirit = Math.max(1, pct[0] + fx.Spirit * 3);
  const tEssence = Math.max(1, pct[1] + fx.Essence * 3);
  const tMatter = Math.max(1, pct[2] + fx.Matter * 3);
  const tSubstance = Math.max(1, pct[3] + fx.Substance * 3);

  const heat = Math.round(tSpirit * 4.5 + tEssence * 3.2);
  const entropy = Math.round(Math.abs(tSpirit - tMatter) * 2.8 + 8);
  const reactivity = Number(((heat / (entropy + 8)) * (1.0 + (p.id % 5) * 0.12)).toFixed(2));
  const freeEnergy = Math.round(heat - 0.45 * entropy * (1 + reactivity));

  let potencyRating = "Equilibrium";
  if (freeEnergy > 80) potencyRating = "Exergonic Potency · Spontaneous Great Work";
  else if (freeEnergy > 30) potencyRating = "Active Metamorphosis · Favorable Reaction";
  else if (freeEnergy >= 0) potencyRating = "Harmonic Equilibrium · Stable State";
  else potencyRating = "Endergonic Fixation · Crystalline Stabilization";

  return {
    pillar: p,
    transformed: [tSpirit, tEssence, tMatter, tSubstance],
    heat,
    entropy,
    reactivity,
    freeEnergy,
    potencyRating,
  };
}

/**
 * Compute the Planetary 12 Consciousness Spectrum & Kinetic Alignment.
 * @param {object} chart - Celestial chart with positions
 * @param {object} velocities - Velocity map body -> deg/day
 * @param {object} smes - Blended SMES object
 * @returns {object} { axes: Array<{ id, name, val, glyph, color, status }>, overallKinetic }
 */
export function computeKineticSpectrum(chart, velocities, smes) {
  const byBody = (chart && chart.byBody) || {};
  const vel = velocities || {};
  const weights = (smes && smes.weights) || {};

  let sumResonance = 0;
  let count = 0;

  const axes = PLANETARY_12_AXES.map((axis) => {
    if (axis.id === "kineticAlignment") {
      // Calculated dynamically after other axes
      return null;
    }

    const pos = byBody[axis.body];
    const w = weights[axis.body] != null ? weights[axis.body] : 1.0;
    const v = vel[axis.body] != null ? vel[axis.body] : 1.0;
    const dign = pos && pos.dignity ? pos.dignity.score : 0;
    const isAngular = pos && [1, 4, 7, 10].includes(pos.house);

    // Base score in [20, 100]
    let score = 50 + dign * 4 + (isAngular ? 12 : 0) + (w > 3 ? 10 : 0);
    if (pos && pos.retrograde) {
      score -= 8; // Retrograde internalization
    }

    // Modulate by velocity dynamism
    const speedRatio = Math.min(2.0, Math.max(0.2, Math.abs(v)));
    score = Math.round(score * (0.85 + speedRatio * 0.15));
    score = Math.max(10, Math.min(99, score));

    sumResonance += score;
    count++;

    let status = "direct";
    if (pos && pos.retrograde) status = "retrograde ℞";
    else if (Math.abs(v) < 0.15) status = "station";
    else if (speedRatio > 1.2) status = "accelerated";

    return {
      ...axis,
      val: score,
      status,
      speed: Number(v.toFixed(2)),
      house: pos ? pos.house : "—",
      dignity: pos && pos.dignity ? pos.dignity.label : "Peregrine",
    };
  }).filter(Boolean);

  // Overall kinetic alignment score
  const avg = count > 0 ? sumResonance / count : 50;
  const overallKinetic = Math.round(Math.min(99, Math.max(20, avg * 1.05)));

  axes.push({
    id: "kineticAlignment",
    name: "Kinetic Alignment",
    body: null,
    glyph: "⚡",
    color: "#ffd700",
    val: overallKinetic,
    status: overallKinetic >= 75 ? "hyper-resonant" : overallKinetic >= 50 ? "coherent" : "damped",
    speed: 1.0,
    house: "Sky",
    dignity: "Cosmic",
  });

  return { axes, overallKinetic };
}

/**
 * Compute Tokenized ESMS Quantities & Daily Faucet Yield (ADR-014/ADR-015).
 * @param {Array<number>} esmsPct - [Spirit, Essence, Matter, Substance] percentages
 * @param {object} chart - Celestial chart
 * @returns {object} Token quantities and faucet metrics
 */
export function computeTokenizedQuantities(esmsPct, chart) {
  const pct = esmsPct || [25, 25, 25, 25];
  const r = pct.map((p) => p / 100);
  const w = [r[0], r[1], r[2], r[3]]; // Live sky transit weights

  // Anti-glut damping: Matter dampened by CURRENT_MATTER_DAMPING (0.75x)
  const omega = [1.0, 1.0, CURRENT_MATTER_DAMPING, 1.0];

  let synastry = 0;
  let baseline = 0;
  for (let i = 0; i < 4; i++) {
    synastry += r[i] * w[i] * omega[i];
    baseline += r[i] * 0.25 * omega[i];
  }

  const z = baseline > 0 ? synastry / baseline : 1.0;
  const rawYield = PROTOCOL_BAND.CENTRE * z;
  const clampedYield = Math.min(PROTOCOL_BAND.Y_MAX, Math.max(PROTOCOL_BAND.Y_MIN, rawYield));
  const totalYield = Number(clampedYield.toFixed(4));

  // Allocations with operational gas floor (0.5000 per axis)
  const discretionary = Math.max(0, totalYield - PROTOCOL_BAND.TOTAL_FLOOR);
  const unnorm = [0, 1, 2, 3].map((i) => r[i] * w[i] * omega[i]);
  const totWeight = unnorm.reduce((a, b) => a + b, 0) || 1;

  const allocated = [0, 1, 2, 3].map((i) => {
    const share = (discretionary * unnorm[i]) / totWeight;
    return Math.floor((PROTOCOL_BAND.AXIS_FLOOR + share) * 10000) / 10000;
  });

  const sub = allocated.reduce((a, b) => a + b, 0);
  const residual = Number((totalYield - sub).toFixed(4));
  let dominantIdx = 0;
  for (let i = 1; i < 4; i++) {
    if (unnorm[i] > unnorm[dominantIdx]) dominantIdx = i;
  }
  allocated[dominantIdx] = Number((allocated[dominantIdx] + residual).toFixed(4));

  return {
    tokens: [
      { ...CANONICAL_TOKENS[0], amount: allocated[0], rawShare: pct[0] },
      { ...CANONICAL_TOKENS[1], amount: allocated[1], rawShare: pct[1] },
      { ...CANONICAL_TOKENS[2], amount: allocated[2], rawShare: pct[2], damped: true, factor: CURRENT_MATTER_DAMPING },
      { ...CANONICAL_TOKENS[3], amount: allocated[3], rawShare: pct[3] },
    ],
    totalYield,
    baselineBudget: PROTOCOL_BAND.CENTRE,
    resonanceMultiplier: Number(z.toFixed(4)),
    gasFloor: PROTOCOL_BAND.AXIS_FLOOR,
  };
}

/**
 * Compute Real-Time Celestial Moment Telemetry (Lunation, Solar Decan, Planetary Hour).
 * @param {object} chart - Celestial chart with positions
 * @param {Date} date - Instant of time
 * @returns {object} Telemetry snapshot
 */
export function computeMomentTelemetry(chart, date) {
  const d = date instanceof Date ? date : new Date();
  const byBody = (chart && chart.byBody) || {};
  const sun = byBody[0];
  const moon = byBody[1];

  // 1. Lunation / Moon Phase
  let phaseName = "New Moon";
  let phaseGlyph = "🌑";
  let illumination = 0;
  let phaseAngle = 0;

  if (sun && moon) {
    phaseAngle = ((moon.eclLon - sun.eclLon) % 360 + 360) % 360;
    illumination = Math.round(((1 - Math.cos((phaseAngle * Math.PI) / 180)) / 2) * 100);

    // Exact New Moon is within ±6° of conjunction (< 1% illumination).
    // The four cardinal phases (New, 1st Qtr, Full, Last Qtr) take ~12h windows (±6°),
    // and the four intermediate phases span the remaining arcs.
    if (phaseAngle < 6 || phaseAngle >= 354) {
      phaseName = "New Moon";
      phaseGlyph = "🌑";
    } else if (phaseAngle < 84) {
      phaseName = "Waxing Crescent";
      phaseGlyph = "🌒";
    } else if (phaseAngle < 96) {
      phaseName = "First Quarter";
      phaseGlyph = "🌓";
    } else if (phaseAngle < 174) {
      phaseName = "Waxing Gibbous";
      phaseGlyph = "🌔";
    } else if (phaseAngle < 186) {
      phaseName = "Full Moon";
      phaseGlyph = "🌕";
    } else if (phaseAngle < 264) {
      phaseName = "Waning Gibbous";
      phaseGlyph = "🌖";
    } else if (phaseAngle < 276) {
      phaseName = "Last Quarter";
      phaseGlyph = "🌗";
    } else {
      phaseName = "Waning Crescent";
      phaseGlyph = "🌘";
    }
  }

  // 2. Solar Decan Locus
  let solarDecan = null;
  if (sun) {
    const dc = decanCard(sun.sign, sun.degInSign);
    const decanRoman = ["I", "II", "III"][dc.decanIndex || 0];
    solarDecan = {
      signName: sun.signName || "Aries",
      signGlyph: sun.signGlyph || "♈",
      degInSign: Math.floor(sun.degInSign),
      decanRoman,
      range: dc.range,
      rulerName: dc.rulerName || "—",
      card: dc.card,
      title: dc.title,
      esms: dc.esms,
    };
  }

  // 3. Chaldean Planetary Day & Hour Ruler
  // Day of week: 0=Sun (Sun ☉), 1=Mon (Moon ☽), 2=Tue (Mars ♂), 3=Wed (Mercury ☿), 4=Thu (Jupiter ♃), 5=Fri (Venus ♀), 6=Sat (Saturn ♄)
  const DAY_RULERS = [
    { body: 0, name: "Sun", glyph: "☉" },
    { body: 1, name: "Moon", glyph: "☽" },
    { body: 4, name: "Mars", glyph: "♂" },
    { body: 2, name: "Mercury", glyph: "☿" },
    { body: 5, name: "Jupiter", glyph: "♃" },
    { body: 3, name: "Venus", glyph: "♀" },
    { body: 6, name: "Saturn", glyph: "♄" },
  ];
  const dayRuler = DAY_RULERS[d.getDay()];

  // Chaldean Order: Saturn, Jupiter, Mars, Sun, Venus, Mercury, Moon
  const CHALDEAN_ORDER = [
    { body: 6, name: "Saturn", glyph: "♄" },
    { body: 5, name: "Jupiter", glyph: "♃" },
    { body: 4, name: "Mars", glyph: "♂" },
    { body: 0, name: "Sun", glyph: "☉" },
    { body: 3, name: "Venus", glyph: "♀" },
    { body: 2, name: "Mercury", glyph: "☿" },
    { body: 1, name: "Moon", glyph: "☽" },
  ];
  const dayStartIdx = CHALDEAN_ORDER.findIndex((r) => r.body === dayRuler.body);
  const hourOfDay = d.getHours();
  const hourRuler = CHALDEAN_ORDER[(dayStartIdx + hourOfDay) % 7];

  // 4. Modality & Polarity Balances
  let cardinal = 0, fixed = 0, mutable = 0;
  let diurnal = 0, nocturnal = 0;
  const positions = (chart && chart.positions) || [];

  for (const p of positions) {
    const s = ((p.sign % 12) + 12) % 12;
    const mod = s % 3; // 0=Cardinal, 1=Fixed, 2=Mutable
    if (mod === 0) cardinal++;
    else if (mod === 1) fixed++;
    else mutable++;

    const elem = s % 4; // 0=Fire, 1=Earth, 2=Air, 3=Water
    if (elem === 0 || elem === 2) diurnal++; // Fire + Air = Yang/Diurnal
    else nocturnal++; // Earth + Water = Yin/Nocturnal
  }

  const totPos = positions.length || 1;
  const modalities = {
    cardinal: Math.round((cardinal / totPos) * 100),
    fixed: Math.round((fixed / totPos) * 100),
    mutable: Math.round((mutable / totPos) * 100),
  };
  const polarities = {
    diurnal: Math.round((diurnal / totPos) * 100),
    nocturnal: Math.round((nocturnal / totPos) * 100),
  };

  return {
    moon: {
      phaseName,
      phaseGlyph,
      illumination,
      phaseAngle: Math.round(phaseAngle),
    },
    solarDecan,
    dayRuler,
    hourRuler,
    modalities,
    polarities,
  };
}

/**
 * Compute Daily Planetary Horizon Events (Rise, Solar Noon/Culmination, Set)
 * and Upcoming Aspect Timeline.
 * @param {object} chart - Celestial chart with positions and aspects
 * @param {object} observer - { lat, lon }
 * @param {Date} date - Selected timestamp
 * @returns {object} { horizons, aspectTimeline }
 */
export function computePlanetaryEvents(chart, observer, date) {
  const d = date instanceof Date ? date : new Date();
  const obs = observer || { lat: 40.7128, lon: -74.006 };
  const lat = obs.lat != null ? obs.lat : 40.7128;
  const lon = obs.lon != null ? obs.lon : -74.006;
  const DEG = Math.PI / 180;
  const phi = lat * DEG;
  const h0 = -0.833 * DEG;

  // Local Sidereal Time
  const jd = d.getTime() / 86400000 + 2440587.5;
  const dd = jd - 2451545.0;
  const tt = dd / 36525.0;
  const gmst = ((280.46061837 + 360.98564736629 * dd + 0.000387933 * tt * tt - tt * tt * tt / 38710000.0) % 360 + 360) % 360;
  const lst = ((gmst + lon) % 360 + 360) % 360;
  const nowMs = d.getTime();

  const OBLIQUITY = 23.439291 * DEG;

  function eqFromLon(lonDeg) {
    const l = lonDeg * DEG;
    const x = Math.cos(l);
    const y = Math.sin(l) * Math.cos(OBLIQUITY);
    const z = Math.sin(l) * Math.sin(OBLIQUITY);
    const ra = (((Math.atan2(y, x) / DEG) % 360) + 360) % 360;
    const dec = Math.asin(Math.max(-1, Math.min(1, z))) / DEG;
    return { ra, dec };
  }

  const positions = (chart && chart.positions) || [];
  const SACRED_7 = [0, 1, 2, 3, 4, 5, 6];

  const horizons = SACRED_7.map((bId) => {
    const p = positions.find((pos) => pos.body === bId) || {
      body: bId,
      name: ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"][bId],
      glyph: ["☉", "☽", "☿", "♀", "♂", "♃", "♄"][bId],
      color: ["#f1dba1", "#cfd6e6", "#9ad0c0", "#7fd1a8", "#e0a23a", "#d8b46a", "#b98cd6"][bId],
      eclLon: bId * 30,
      signName: "Aries",
      signGlyph: "♈",
      degInSign: 0,
      alt: 0,
      az: 0,
      up: true,
    };

    const eq = (p.ra != null && p.dec != null) ? { ra: p.ra, dec: p.dec } : eqFromLon(p.eclLon || 0);
    const decRad = eq.dec * DEG;
    const cosH0 = (Math.sin(h0) - Math.sin(phi) * Math.sin(decRad)) / (Math.cos(phi) * Math.cos(decRad));
    const clampedCos = Math.max(-1, Math.min(1, cosH0));
    const H0 = Math.acos(clampedCos) / DEG;

    let diff = ((eq.ra - lst) % 360 + 360) % 360;
    if (diff > 180) diff -= 360;

    const transitMs = nowMs + (diff / 15) * 0.9972696 * 3600 * 1000;
    const riseMs = transitMs - (H0 / 15) * 0.9972696 * 3600 * 1000;
    const setMs = transitMs + (H0 / 15) * 0.9972696 * 3600 * 1000;

    const isRisen = p.alt != null ? p.alt > 0 : p.up !== false;
    let nextEvent = "";
    if (isRisen) {
      const hToSet = (setMs - nowMs) / 3600000;
      if (hToSet > 0) {
        const hrs = Math.floor(hToSet);
        const mins = Math.round((hToSet % 1) * 60);
        nextEvent = `Sets in ${hrs}h ${mins}m`;
      } else {
        nextEvent = "Setting Now ↘";
      }
    } else {
      let hToRise = (riseMs - nowMs) / 3600000;
      if (hToRise < 0) hToRise += 24;
      const hrs = Math.floor(hToRise);
      const mins = Math.round((hToRise % 1) * 60);
      nextEvent = `Rises in ${hrs}h ${mins}m`;
    }

    // Celestial Arc Progression:
    // Above horizon: 0% (just risen at East) -> 50% (zenith/culmination) -> 100% (setting at West)
    // Under horizon: -100 (fully set) -> -50 (nadir/midnight) -> -1 (about to rise at East)
    const H = -diff; // local hour angle in degrees (-180..+180)
    let progression = 0;
    let progressionFraction = 0;

    if (H0 > 0 && H0 < 180) {
      if (isRisen) {
        const clampedH = Math.max(-H0, Math.min(H0, H));
        const frac = (clampedH + H0) / (2 * H0);
        progressionFraction = Math.max(0, Math.min(1, frac));
        progression = Math.round(progressionFraction * 100);
      } else {
        const W_under = 360 - 2 * H0;
        const H_pos = ((H - H0) % 360 + 360) % 360;
        const fracUnder = Math.max(0, Math.min(1, H_pos / W_under));
        progressionFraction = fracUnder;
        progression = -Math.max(1, Math.min(100, Math.round(100 * (1 - fracUnder))));
      }
    } else if (H0 >= 180) {
      // circumpolar, always up
      progressionFraction = (H + 180) / 360;
      progression = Math.round(progressionFraction * 100);
    } else {
      // always down
      const f = (H + 180) / 360;
      progressionFraction = f;
      progression = -Math.max(1, Math.min(100, Math.round(100 * (1 - f))));
    }

    const progressionText = progression >= 0 ? `+${progression}%` : `${progression}%`;
    const progressionLabel = isRisen
      ? (progression === 0 ? "Risen ↗" : progression === 50 ? "Zenith / Noon ✦" : progression === 100 ? "Setting ↘" : `${progression}% Diurnal`)
      : (progression === -100 ? "Fully Set ↘" : progression === -1 ? "Rising Imminent ↗" : `${progression}% to Dawn`);

    const fmtT = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    return {
      body: p.body,
      name: p.name,
      glyph: p.glyph,
      color: p.color,
      signName: p.signName || "",
      signGlyph: p.signGlyph || "",
      degInSign: Math.floor(p.degInSign || 0),
      alt: p.alt != null ? p.alt : 0,
      az: p.az != null ? p.az : 0,
      isRisen,
      riseTime: fmtT(riseMs),
      transitTime: fmtT(transitMs),
      setTime: fmtT(setMs),
      nextEvent,
      progression,
      progressionFraction,
      progressionText,
      progressionLabel,
    };
  });

  // Upcoming / Active Aspects Timeline
  const dailySpeeds = { 0: 0.985, 1: 13.17, 2: 1.38, 3: 1.2, 4: 0.52, 5: 0.08, 6: 0.03 };
  const aspects = (chart && chart.aspects) || [];
  const aspectTimeline = aspects.slice().sort((a, b) => a.orb - b.orb).slice(0, 8).map((asp) => {
    const isApp = asp.state === "applying";
    const bodyA = (chart.byBody && chart.byBody[asp.a]) || { name: `Body ${asp.a}`, glyph: "✦" };
    const bodyB = (chart.byBody && chart.byBody[asp.b]) || { name: `Body ${asp.b}`, glyph: "✦" };
    const speedA = dailySpeeds[asp.a] || 1.0;
    const speedB = dailySpeeds[asp.b] || 1.0;
    const relSpeed = Math.max(0.1, Math.abs(speedA - speedB));
    const hToExact = (asp.orb / relSpeed) * 24;

    let timeText = "";
    if (asp.orb < 0.5) {
      timeText = "Peak Alignment Now ✦";
    } else if (isApp) {
      if (hToExact < 24) {
        timeText = `Exact in ~${Math.round(hToExact)}h`;
      } else {
        timeText = `Exact in ~${(hToExact / 24).toFixed(1)}d`;
      }
    } else {
      timeText = `Separating (${asp.orb.toFixed(1)}° past)`;
    }

    return {
      asp,
      pairName: `${bodyA.name} — ${bodyB.name}`,
      pairGlyphs: `${bodyA.glyph || ""} ${asp.typeSymbol || asp.symbol || "⚹"} ${bodyB.glyph || ""}`,
      type: asp.type || "Aspect",
      orbText: `orb ${asp.orb.toFixed(2)}°`,
      isApp,
      isExact: asp.orb < 1.0,
      timeText,
      influence: asp.influence || 0,
    };
  });

  return {
    horizons,
    aspectTimeline,
  };
}

export default {
  ALCHEMICAL_PILLARS,
  CANONICAL_TOKENS,
  PROTOCOL_BAND,
  PLANETARY_12_AXES,
  resolveAlchemicalPillar,
  computeThermodynamics,
  computeKineticSpectrum,
  computeTokenizedQuantities,
  computeMomentTelemetry,
  computePlanetaryEvents,
};
