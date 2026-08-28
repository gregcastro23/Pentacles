/* ============================================================
   AlchmChart — Essential Planetary Dignities (Ptolemy / Lilly)
   ============================================================
   DOM-free, dependency-free ES module.
   Shared canonical source of truth for planetary dignities across
   Pentacles and Alchm chart tooling (WTEN canonical order: Domicile > Exaltation).

   Planet indices:
     Sun 0 · Moon 1 · Mercury 2 · Venus 3 · Mars 4 ·
     Jupiter 5 · Saturn 6 · Uranus 7 · Neptune 8 · Pluto 9
   Sign indices:
     Aries 0 · Taurus 1 · Gemini 2 · Cancer 3 · Leo 4 · Virgo 5 ·
     Libra 6 · Scorpio 7 · Sagittarius 8 · Capricorn 9 · Aquarius 10 · Pisces 11
   ============================================================ */

// Rulerships (Domiciles): sign index → ruling planet index
export const SIGN_RULERS = [4, 3, 2, 1, 0, 2, 3, 9, 5, 6, 7, 8];

// Domicile signs for each body (0..9)
export const DOMICILES = [
  [4],      // Sun: Leo
  [3],      // Moon: Cancer
  [2, 5],   // Mercury: Gemini, Virgo
  [1, 6],   // Venus: Taurus, Libra
  [0, 7],   // Mars: Aries, Scorpio
  [8, 11],  // Jupiter: Sagittarius, Pisces
  [9, 10],  // Saturn: Capricorn, Aquarius
  [10],     // Uranus: Aquarius
  [11],     // Neptune: Pisces
  [7]       // Pluto: Scorpio
];

// Exaltation sign for each body (0..9)
export const EXALTATIONS = [
  0,  // Sun: Aries
  1,  // Moon: Taurus
  5,  // Mercury: Virgo
  11, // Venus: Pisces
  9,  // Mars: Capricorn
  3,  // Jupiter: Cancer
  6,  // Saturn: Libra
  7,  // Uranus: Scorpio
  3,  // Neptune: Cancer
  4   // Pluto: Leo
];

// Detriment signs: opposite of domicile
export const DETRIMENTS = DOMICILES.map(signs => signs.map(s => (s + 6) % 12));

// Fall signs: opposite of exaltation
export const FALLS = EXALTATIONS.map(s => s !== null ? (s + 6) % 12 : null);

/**
 * Evaluates the dignity type of a planetary body in a given zodiac sign.
 * @param {number} body  0..9 (Sun..Pluto)
 * @param {number} sign  0..11 (Aries..Pisces)
 * @returns {"Domicile" | "Exaltation" | "Neutral" | "Detriment" | "Fall"}
 */
export function dignityType(body, sign) {
  const b = ((body | 0) % 10 + 10) % 10;
  const s = ((sign | 0) % 12 + 12) % 12;

  // Domicile check (highest dignity)
  if (DOMICILES[b] && DOMICILES[b].includes(s)) {
    return "Domicile";
  }
  // Exaltation check
  if (EXALTATIONS[b] === s) {
    return "Exaltation";
  }
  // Detriment check
  if (DETRIMENTS[b] && DETRIMENTS[b].includes(s)) {
    return "Detriment";
  }
  // Fall check
  if (FALLS[b] === s) {
    return "Fall";
  }
  return "Neutral";
}

/**
 * Returns the numeric dignity score on Pentacles' standard ±5 scale.
 * Domicile +5 · Exaltation +3 · Neutral 0 · Detriment −3 · Fall −5
 * @param {number} body
 * @param {number} sign
 * @returns {number}
 */
export function dignityScore(body, sign) {
  const type = dignityType(body, sign);
  switch (type) {
    case "Domicile": return 5;
    case "Exaltation": return 3;
    case "Detriment": return -3;
    case "Fall": return -5;
    default: return 0;
  }
}

/**
 * Returns the ESMS scale modifier on WTEN's ±10 / ±7 scale.
 * Domicile +10 · Exaltation +7 · Neutral 0 · Detriment −7 · Fall −10
 * @param {number} body
 * @param {number} sign
 * @returns {number}
 */
export function esmsScale(body, sign) {
  const type = dignityType(body, sign);
  switch (type) {
    case "Domicile": return 10;
    case "Exaltation": return 7;
    case "Detriment": return -7;
    case "Fall": return -10;
    default: return 0;
  }
}

export default {
  SIGN_RULERS,
  DOMICILES,
  EXALTATIONS,
  DETRIMENTS,
  FALLS,
  dignityType,
  dignityScore,
  esmsScale
};
