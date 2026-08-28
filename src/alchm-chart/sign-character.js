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

export default {
  PLANETARY_WEIGHTS,
  ASCENDANT_WEIGHT,
  signVector,
  dominantSigns,
  elementalDistribution
};
