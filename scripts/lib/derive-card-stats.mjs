/**
 * Alchm Sacred 7 & Planetary 12 Pure Derivation Engine
 * Source of Truth: AlchmAgentsSolana / lib/agents/sacred-stats.ts:89-121 & lib/alchm-fbd/planetaryAlchemyMapping.ts:46
 *
 * This module is a pure mathematical library with zero file-system or network side-effects.
 * It is fully importable by build scripts, validation test suites, and simulation pipelines.
 */

// ── 1. Canonical Planetary ESMS 4-Vectors ─────────────────────────────────────
// Sourced from AlchmAgentsSolana/lib/alchm-fbd/planetaryAlchemyMapping.ts:46
export const PLANETARY_ALCHEMY = Object.freeze({
  Sun:     Object.freeze({ Spirit: 1, Essence: 0, Matter: 0, Substance: 0 }),
  Moon:    Object.freeze({ Spirit: 0, Essence: 1, Matter: 1, Substance: 0 }),
  Mercury: Object.freeze({ Spirit: 1, Essence: 0, Matter: 0, Substance: 1 }),
  Venus:   Object.freeze({ Spirit: 0, Essence: 1, Matter: 1, Substance: 0 }),
  Mars:    Object.freeze({ Spirit: 0, Essence: 1, Matter: 1, Substance: 0 }),
  Jupiter: Object.freeze({ Spirit: 1, Essence: 1, Matter: 0, Substance: 0 }),
  Saturn:  Object.freeze({ Spirit: 1, Essence: 0, Matter: 1, Substance: 0 }),
  Uranus:  Object.freeze({ Spirit: 0, Essence: 1, Matter: 1, Substance: 0 }),
  Neptune: Object.freeze({ Spirit: 0, Essence: 1, Matter: 0, Substance: 1 }),
  Pluto:   Object.freeze({ Spirit: 0, Essence: 1, Matter: 1, Substance: 0 })
});

// ── 2. Suit Elemental Vectors ──────────────────────────────────────────────────
export const SUIT_ESMS_VECTORS = Object.freeze({
  wands:     Object.freeze({ Spirit: 1, Essence: 0, Matter: 0, Substance: 0 }),
  cups:      Object.freeze({ Spirit: 0, Essence: 1, Matter: 0, Substance: 0 }),
  swords:    Object.freeze({ Spirit: 0, Essence: 0, Matter: 0, Substance: 1 }),
  pentacles: Object.freeze({ Spirit: 0, Essence: 0, Matter: 1, Substance: 0 })
});

// ── 3. Zodiac Signs & Elements ────────────────────────────────────────────────
export const SIGN_NAMES = Object.freeze([
  "Aries", "Taurus", "Gemini", "Cancer",
  "Leo", "Virgo", "Libra", "Scorpio",
  "Sagittarius", "Capricorn", "Aquarius", "Pisces"
]);

export const SIGN_ELEMENT_VECTORS = Object.freeze({
  Aries:       Object.freeze({ Spirit: 1, Essence: 0, Matter: 0, Substance: 0 }),
  Taurus:      Object.freeze({ Spirit: 0, Essence: 0, Matter: 1, Substance: 0 }),
  Gemini:      Object.freeze({ Spirit: 0, Essence: 0, Matter: 0, Substance: 1 }),
  Cancer:      Object.freeze({ Spirit: 0, Essence: 1, Matter: 0, Substance: 0 }),
  Leo:         Object.freeze({ Spirit: 1, Essence: 0, Matter: 0, Substance: 0 }),
  Virgo:       Object.freeze({ Spirit: 0, Essence: 0, Matter: 1, Substance: 0 }),
  Libra:       Object.freeze({ Spirit: 0, Essence: 0, Matter: 0, Substance: 1 }),
  Scorpio:     Object.freeze({ Spirit: 0, Essence: 1, Matter: 0, Substance: 0 }),
  Sagittarius: Object.freeze({ Spirit: 1, Essence: 0, Matter: 0, Substance: 0 }),
  Capricorn:   Object.freeze({ Spirit: 0, Essence: 0, Matter: 1, Substance: 0 }),
  Aquarius:    Object.freeze({ Spirit: 0, Essence: 0, Matter: 0, Substance: 1 }),
  Pisces:      Object.freeze({ Spirit: 0, Essence: 1, Matter: 0, Substance: 0 })
});

export const SIGN_MODALITY = Object.freeze({
  Aries: "cardinal", Taurus: "fixed", Gemini: "mutable", Cancer: "cardinal",
  Leo: "fixed", Virgo: "mutable", Libra: "cardinal", Scorpio: "fixed",
  Sagittarius: "mutable", Capricorn: "cardinal", Aquarius: "fixed", Pisces: "mutable"
});

// ── 4. Astrological Essential Dignities (Hybrid Model) ─────────────────────────
// Classical 7: from AlchmAgentsSolana/lib/astrological-dignities-engine.ts:94
// Modern 3 (Uranus, Neptune, Pluto): from Pentacles server/src/chart.rs:32 (sign_ruler)
export const DIGNITY_RULES = Object.freeze({
  Sun:     Object.freeze({ domicile: [4],       exaltation: [0],  detriment: [10],    fall: [6] }),
  Moon:    Object.freeze({ domicile: [3],       exaltation: [1],  detriment: [9],     fall: [7] }),
  Mercury: Object.freeze({ domicile: [2, 5],    exaltation: [5],  detriment: [8, 11], fall: [11] }),
  Venus:   Object.freeze({ domicile: [1, 6],    exaltation: [11], detriment: [0, 7],  fall: [5] }),
  Mars:    Object.freeze({ domicile: [0, 7],    exaltation: [9],  detriment: [1, 6],  fall: [3] }),
  Jupiter: Object.freeze({ domicile: [8, 11],   exaltation: [3],  detriment: [2, 5],  fall: [9] }),
  Saturn:  Object.freeze({ domicile: [9, 10],   exaltation: [6],  detriment: [3, 4],  fall: [0] }),
  Uranus:  Object.freeze({ domicile: [10],      exaltation: [7],  detriment: [4],     fall: [1] }),
  Neptune: Object.freeze({ domicile: [11],      exaltation: [3],  detriment: [5],     fall: [9] }),
  Pluto:   Object.freeze({ domicile: [7],       exaltation: [4],  detriment: [1],     fall: [10] })
});

/**
 * Multiplicative essential dignity multiplier for ESMS weight calculation.
 * Domicile: 1.25, Exaltation: 1.35, Peregrine: 1.00, Detriment: 0.80, Fall: 0.70.
 */
export function getDignityMultiplier(planet, signIdx) {
  const d = DIGNITY_RULES[planet];
  if (!d || signIdx === null || signIdx === undefined || signIdx < 0) return 1.0;
  if (d.domicile.includes(signIdx)) return 1.25;
  if (d.exaltation.includes(signIdx)) return 1.35;
  if (d.detriment.includes(signIdx)) return 0.80;
  if (d.fall.includes(signIdx)) return 0.70;
  return 1.0;
}

/**
 * Additive essential dignity score matching Pentacles server/src/chart.rs::sky_dignity & faction_scores.
 * Domicile: +5, Exaltation: +4, Peregrine: 0, Fall: -4, Detriment: -5.
 */
export function getAdditiveDignity(planet, signIdx) {
  const d = DIGNITY_RULES[planet];
  if (!d || signIdx === null || signIdx === undefined || signIdx < 0) return 0;
  if (d.domicile.includes(signIdx)) return 5;
  if (d.exaltation.includes(signIdx)) return 4;
  if (d.detriment.includes(signIdx)) return -5;
  if (d.fall.includes(signIdx)) return -4;
  return 0;
}

// ── 5. Canonical Sacred 7 Weight Matrix ────────────────────────────────────────
// Sourced from AlchmAgentsSolana/lib/agents/sacred-stats.ts:47-75
export function esmsToSacred7(esms) {
  return {
    power:        5 * esms.Spirit + 3 * esms.Matter,
    resonance:    6 * esms.Essence + 4 * esms.Spirit,
    wisdom:       5 * esms.Substance + 3 * esms.Essence,
    charisma:     5 * esms.Spirit + 4 * esms.Essence,
    intuition:    7 * esms.Essence + 3 * esms.Substance,
    adaptability: 6 * esms.Substance + 2 * esms.Spirit,
    vitality:     6 * esms.Matter + 4 * esms.Spirit
  };
}

// ── 6. Canonical Planetary 12 Projection Formulas ──────────────────────────────
// Sourced from AlchmAgentsSolana/lib/agents/sacred-stats.ts:89-121
// Every runtime agent term (mc, stage, momentum, powerAlignment) is dropped for static cards.
export function esmsToPlanetary12(esms) {
  return {
    solarAgency:         10 * esms.Spirit,                             // lib/agents/sacred-stats.ts:89
    lunarReceptivity:    10 * esms.Essence,                            // lib/agents/sacred-stats.ts:90
    mercurialVelocity:    4 * esms.Spirit    + 6 * esms.Substance,     // lib/agents/sacred-stats.ts:94
    venusianCoherence:    8 * esms.Essence,                            // lib/agents/sacred-stats.ts:100
    martialImpetus:       8 * esms.Spirit,                             // lib/agents/sacred-stats.ts:101
    jovianExpansion:      5 * esms.Substance + 5 * esms.Matter,        // lib/agents/sacred-stats.ts:105
    saturnianStructure:  12 * esms.Matter,                             // lib/agents/sacred-stats.ts:109
    chironicAdaptation:   8 * esms.Substance + 4 * esms.Essence,       // lib/agents/sacred-stats.ts:110
    uranianSurprisal:     9 * esms.Spirit,                             // lib/agents/sacred-stats.ts:114
    neptunianResonance:   9 * esms.Essence   + 3 * esms.Substance,     // lib/agents/sacred-stats.ts:115
    plutonicIntegration:  6 * esms.Matter    + 6 * esms.Spirit         // lib/agents/sacred-stats.ts:116
    // kineticAlignment is omitted from static cards (runtime transit only, line 117)
  };
}

// Map from the 10 astrological planets to their corresponding Planetary 12 axis
export const PLANET_TO_AXIS = Object.freeze({
  Sun:     "solarAgency",
  Moon:    "lunarReceptivity",
  Mercury: "mercurialVelocity",
  Venus:   "venusianCoherence",
  Mars:    "martialImpetus",
  Jupiter: "jovianExpansion",
  Saturn:  "saturnianStructure",
  Uranus:  "uranianSurprisal",
  Neptune: "neptunianResonance",
  Pluto:   "plutonicIntegration"
});

export const PLANET_BODIES = Object.freeze([
  "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"
]);

// Ruler resonance and host sign environment weights
export const RULER_RESONANCE = 15;
export const SIGN_ENV_WEIGHT = 10;

/**
 * Derive the additive planetary affinity vector [10] centered on 0.
 * Directly aligns with Pentacles server/src/chart.rs::faction_scores.
 *
 * @param {object} card - TarotCard definition with symbolism block
 * @returns {Array<number>} 10-element vector indexed by Planet::idx (0=Sun .. 9=Pluto)
 */
export function derivePlanetaryAffinity(card) {
  const affinity = new Array(10).fill(0);

  // 1. Planetary Majors: supreme resonance on their own ruling planet
  if (card.arcana === "major" && card.symbolism?.planetaryBody) {
    const pIdx = card.symbolism.planetIndex;
    if (typeof pIdx === "number" && pIdx >= 0 && pIdx < 10) {
      affinity[pIdx] = 5; // Domicile +5
    }
    return affinity;
  }

  // 2. Cards with host zodiac sign (Sign Majors and Decan Pips)
  const signIdx = card.symbolism?.signIndex;
  if (typeof signIdx === "number" && signIdx >= 0 && signIdx < 12) {
    for (let i = 0; i < 10; i++) {
      affinity[i] = getAdditiveDignity(PLANET_BODIES[i], signIdx);
    }
    return affinity;
  }

  // 3. Court cards and Aces (pure elemental suit expressions)
  // Biased toward suit planetary rulers (+3):
  // Wands (Fire): Sun (0) + Mars (4)
  // Cups (Water): Moon (1) + Neptune (8)
  // Swords (Air): Mercury (2) + Uranus (7)
  // Pentacles (Earth): Saturn (6) + Venus (3)
  const suit = card.suit?.toLowerCase();
  if (suit === "wands") {
    affinity[0] = 3;
    affinity[4] = 3;
  } else if (suit === "cups") {
    affinity[1] = 3;
    affinity[8] = 3;
  } else if (suit === "swords") {
    affinity[2] = 3;
    affinity[7] = 3;
  } else if (suit === "pentacles") {
    affinity[6] = 3;
    affinity[3] = 3;
  }

  return affinity;
}

export default {
  PLANETARY_ALCHEMY,
  SUIT_ESMS_VECTORS,
  SIGN_NAMES,
  SIGN_ELEMENT_VECTORS,
  SIGN_MODALITY,
  DIGNITY_RULES,
  getDignityMultiplier,
  getAdditiveDignity,
  esmsToSacred7,
  esmsToPlanetary12,
  PLANET_TO_AXIS,
  PLANET_BODIES,
  RULER_RESONANCE,
  SIGN_ENV_WEIGHT,
  derivePlanetaryAffinity
};
