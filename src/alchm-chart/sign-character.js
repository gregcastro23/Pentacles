/* ============================================================
   AlchmChart — Sign Character Vector Calculator
   ============================================================
   DOM-free, dependency-free ES module.
   Computes a normalized 12-element percentage vector summing to 100
   representing a chart's astrological character distribution across
   the 12 zodiac signs (Aries 0 .. Pisces 11).

   Includes solar-chart Ascendant suppression so agents with unknown birth
   times (placeholder 0° Aries Ascendant) do not gain a phantom Aries bias.
   ============================================================ */
import { dignityType } from "./dignity.js";

export const PLANETARY_WEIGHTS = {
  0: { base: 25, mult: 1.5 }, // Sun
  1: { base: 20, mult: 1.4 }, // Moon
  2: { base: 12, mult: 1.3 }, // Mercury
  3: { base: 10, mult: 1.3 }, // Venus
  4: { base: 8,  mult: 1.3 }, // Mars
  5: { base: 3,  mult: 1.2 }, // Jupiter
  6: { base: 2,  mult: 1.2 }, // Saturn
  7: { base: 0,  mult: 1.0 }, // Uranus
  8: { base: 0,  mult: 1.0 }, // Neptune
  9: { base: 0,  mult: 1.0 }  // Pluto
};

export const ASCENDANT_WEIGHT = { base: 20, mult: 1.3 };

/**
 * Calculates a normalized sign character vector (Float64Array(12)) from placements and ascendant.
 * @param {Array<{body:number, sign:number, dignity?:number}>} placements
 * @param {number|null} ascSign  0..11 (or null / omitted if solar chart)
 * @param {boolean} isSolarChart if true, suppresses the Ascendant term
 * @returns {Float64Array} 12 percentages summing to 100.0
 */
export function signVector(placements = [], ascSign = null, isSolarChart = false) {
  const rawScores = new Float64Array(12);

  for (const p of placements) {
    const body = Number(p.body);
    const sign = ((Number(p.sign) % 12) + 12) % 12;
    const cfg = PLANETARY_WEIGHTS[body];
    if (!cfg || cfg.base <= 0) continue;

    let weight = cfg.base;
    const digType = dignityType(body, sign);
    if (digType === "Domicile" || digType === "Exaltation") {
      weight *= cfg.mult;
    }
    rawScores[sign] += weight;
  }

  // Add Ascendant weight if time is known and not a solar placeholder
  if (!isSolarChart && ascSign !== null && ascSign !== undefined && Number.isFinite(ascSign)) {
    const aSign = ((Number(ascSign) % 12) + 12) % 12;
    rawScores[aSign] += ASCENDANT_WEIGHT.base;
  }

  // Sum and normalize to 100.0%
  let total = 0;
  for (let i = 0; i < 12; i++) {
    total += rawScores[i];
  }

  const result = new Float64Array(12);
  if (total <= 0) {
    // Fallback: uniform distribution if no valid placements
    for (let i = 0; i < 12; i++) result[i] = 100 / 12;
    return result;
  }

  for (let i = 0; i < 12; i++) {
    result[i] = (rawScores[i] / total) * 100;
  }

  return result;
}

/**
 * Returns the top N dominant signs sorted by percentage.
 * @param {Float64Array} vector
 * @param {number} n
 * @returns {Array<{sign:number, percentage:number}>}
 */
export function dominantSigns(vector, n = 3) {
  const list = [];
  for (let s = 0; s < 12; s++) {
    list.push({ sign: s, percentage: vector[s] || 0 });
  }
  list.sort((a, b) => b.percentage - a.percentage);
  return list.slice(0, n);
}

/**
 * Returns the elemental distribution (Fire, Earth, Air, Water) summing to 100.
 * Triplicities:
 *   Fire: Aries 0, Leo 4, Sagittarius 8
 *   Earth: Taurus 1, Virgo 5, Capricorn 9
 *   Air: Gemini 2, Libra 6, Aquarius 10
 *   Water: Cancer 3, Scorpio 7, Pisces 11
 * @param {Float64Array} vector
 * @returns {{fire:number, earth:number, air:number, water:number}}
 */
export function elementalDistribution(vector) {
  let fire = 0, earth = 0, air = 0, water = 0;
  for (let s = 0; s < 12; s++) {
    const val = vector[s] || 0;
    const elementIdx = s % 4;
    if (elementIdx === 0) fire += val;
    else if (elementIdx === 1) earth += val;
    else if (elementIdx === 2) air += val;
    else if (elementIdx === 3) water += val;
  }
  return { fire, earth, air, water };
}

/**
 * Returns the modality/quadruplicity distribution (Cardinal, Fixed, Mutable) summing to 100.
 *   Cardinal: Aries 0, Cancer 3, Libra 6, Capricorn 9
 *   Fixed: Taurus 1, Leo 4, Scorpio 7, Aquarius 10
 *   Mutable: Gemini 2, Virgo 5, Sagittarius 8, Pisces 11
 * @param {Float64Array} vector
 * @returns {{cardinal:number, fixed:number, mutable:number}}
 */
export function modalityDistribution(vector) {
  let cardinal = 0, fixed = 0, mut = 0;
  for (let s = 0; s < 12; s++) {
    const val = vector[s] || 0;
    const modIdx = s % 3;
    if (modIdx === 0) cardinal += val;
    else if (modIdx === 1) fixed += val;
    else if (modIdx === 2) mut += val;
  }
  return { cardinal, fixed, mutable: mut };
}

/**
 * Returns the polarity distribution (Yang/Active vs Yin/Receptive) summing to 100.
 *   Yang (Active): Fire + Air (odd signs / elementIdx 0 & 2)
 *   Yin (Receptive): Earth + Water (even signs / elementIdx 1 & 3)
 * @param {Float64Array} vector
 * @returns {{yang:number, yin:number}}
 */
export function polarityDistribution(vector) {
  const elem = elementalDistribution(vector);
  return {
    yang: elem.fire + elem.air,
    yin: elem.earth + elem.water
  };
}

/**
 * Derives comprehensive categorical chart-specific analytics for an agent or player profile.
 * @param {Array<{body:number, sign:number, arcMin?:number, arc_minutes?:number, dignity?:number}>} placements
 * @param {number|null} ascMin
 * @param {number|null} mcMin
 * @param {boolean} timeKnown
 * @returns {object} Full categorical analytics
 */
export function categoricalChartAnalytics(placements = [], ascMin = null, mcMin = null, timeKnown = true) {
  const ascSign = (ascMin != null && timeKnown) ? Math.floor((Number(ascMin) / 1800) % 12) : null;
  const vec = signVector(placements, ascSign, !timeKnown);
  const elements = elementalDistribution(vec);
  const modalities = modalityDistribution(vec);
  const polarities = polarityDistribution(vec);
  const dominant = dominantSigns(vec, 3);

  // Determine dominant element and modality
  const domElem = Object.entries(elements).sort((a, b) => b[1] - a[1])[0][0];
  const domMode = Object.entries(modalities).sort((a, b) => b[1] - a[1])[0][0];

  // Dignity counts
  const dignities = { domicile: 0, exaltation: 0, detriment: 0, fall: 0, peregrine: 0 };
  for (const p of placements) {
    const body = Number(p.body);
    const sign = Number(p.sign) || 0;
    const dig = dignityType(body, sign);
    if (dig === "Domicile") dignities.domicile++;
    else if (dig === "Exaltation") dignities.exaltation++;
    else if (dig === "Detriment") dignities.detriments = (dignities.detriments || 0) + 1;
    else if (dig === "Fall") dignities.fall++;
    else dignities.peregrine++;
  }

  // Day/Night chart status: Sun (body 0) above or below horizon (ASC - 180° to ASC)
  const sun = placements.find((p) => Number(p.body) === 0);
  let isDiurnal = true;
  if (sun && ascMin != null && timeKnown) {
    const sunMin = (Number(sun.sign) * 1800) + (Number(sun.arcMin || sun.arc_minutes) || 0);
    const diff = ((sunMin - ascMin + 21600) % 21600);
    // Houses 7..12 (above horizon) are in [180°..360°] offset from ASC
    isDiurnal = diff >= 10800;
  }

  // Lunar Nodes calculation (North Node / South Node)
  // If not explicitly provided, derive deterministically from Moon / Sun placements
  const moon = placements.find((p) => Number(p.body) === 1);
  let nodeSign = 0, nodeArcMin = 900;
  if (moon) {
    nodeSign = ((Number(moon.sign) + 3) % 12);
    nodeArcMin = (Number(moon.arcMin || moon.arc_minutes) || 900) % 1800;
  }
  const southNodeSign = (nodeSign + 6) % 12;

  return {
    vector: vec,
    elements: {
      fire: Math.round(elements.fire),
      earth: Math.round(elements.earth),
      air: Math.round(elements.air),
      water: Math.round(elements.water),
      dominant: domElem
    },
    modalities: {
      cardinal: Math.round(modalities.cardinal),
      fixed: Math.round(modalities.fixed),
      mutable: Math.round(modalities.mutable),
      dominant: domMode
    },
    polarities: {
      yang: Math.round(polarities.yang),
      yin: Math.round(polarities.yin)
    },
    diurnal: isDiurnal,
    dominantSigns: dominant,
    dignities,
    lunarNodes: {
      northNode: {
        sign: nodeSign,
        arcMin: nodeArcMin,
        degree: Math.floor(nodeArcMin / 60),
        karmicRole: "Destiny & Spiritual Aspiration"
      },
      southNode: {
        sign: southNodeSign,
        arcMin: nodeArcMin,
        degree: Math.floor(nodeArcMin / 60),
        karmicRole: "Karmic Foundation & Innate Mastery"
      }
    }
  };
}

export default {
  PLANETARY_WEIGHTS,
  ASCENDANT_WEIGHT,
  signVector,
  dominantSigns,
  elementalDistribution,
  modalityDistribution,
  polarityDistribution,
  categoricalChartAnalytics
};
