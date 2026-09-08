/**
 * Alchm Planetary 12 & Kinetics Runtime Module
 * Hand-authored, permanent module for live celestial kinetics and faction affinity.
 *
 * Source: AlchmAgentsSolana / lib/sacred-7-stats.ts:18 & lib/agents/sacred-stats.ts:89-121
 */

/**
 * All 12 canonical Planetary axes in the authoritative order defined in Sacred7Stats (lib/sacred-7-stats.ts:18).
 */
export const PLANETARY_12_AXES = Object.freeze([
  "solarAgency",
  "lunarReceptivity",
  "mercurialVelocity",
  "venusianCoherence",
  "martialImpetus",
  "jovianExpansion",
  "saturnianStructure",
  "chironicAdaptation",
  "uranianSurprisal",
  "neptunianResonance",
  "plutonicIntegration",
  "kineticAlignment"
]);

/**
 * The 11 static, stored planetary axes on card definitions.
 * Note: kineticAlignment is omitted from static card storage because it is a live transit quantity.
 */
export const STORED_PLANETARY_AXES = Object.freeze([
  "solarAgency",
  "lunarReceptivity",
  "mercurialVelocity",
  "venusianCoherence",
  "martialImpetus",
  "jovianExpansion",
  "saturnianStructure",
  "chironicAdaptation",
  "uranianSurprisal",
  "neptunianResonance",
  "plutonicIntegration"
]);

/**
 * Map of the 10 astrological planets to their corresponding Planetary 12 consciousness axis.
 * Note: Chiron is an asteroid with no planet body entry; kineticAlignment is runtime-only.
 */
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

/**
 * The 10 canonical planetary bodies matching Pentacles server/src/types.rs::Planet::idx (0..9).
 */
export const PLANET_BODIES = Object.freeze([
  "Sun",     // 0
  "Moon",    // 1
  "Mercury", // 2
  "Venus",   // 3
  "Mars",    // 4
  "Jupiter", // 5
  "Saturn",  // 6
  "Uranus",  // 7
  "Neptune", // 8
  "Pluto"    // 9
]);

/**
 * Calculate the live transit kinetic alignment for a card given a sky transit state.
 *
 * In Alchm, kineticAlignment = powerAlignment * 50 + kineticResonance * 50 (lib/agents/sacred-stats.ts:117).
 * In Pentacles, this is the dynamic resonance between the card's astrological degree span
 * and the live celestial transit positions (e.g. transiting Sun, Moon, or chart ruler).
 *
 * @param {object} card - TarotCard JSON definition
 * @param {object|number} skyTransit - Live transit longitude in degrees [0, 360) or transit context { sunLon, ... }
 * @returns {number} Kinetic alignment score bounded [0, 100]
 */
export function kineticAlignment(card, skyTransit) {
  if (!card) return 0;

  // Extract reference transit longitude (supports number, { signIndex, degreeInSign }, or { sunLon / longitude })
  const transitDeg = typeof skyTransit === "number"
    ? skyTransit
    : (typeof skyTransit?.signIndex === "number" && typeof skyTransit?.degreeInSign === "number"
      ? ((skyTransit.signIndex * 30 + skyTransit.degreeInSign) % 360 + 360) % 360
      : (skyTransit?.sunLon ?? skyTransit?.longitude ?? 0));

  // If card is a Decan Pip (has decanRange and signIndex)
  if (card.symbolism?.decanRange && typeof card.symbolism.signIndex === "number") {
    const startDeg = card.symbolism.signIndex * 30 + card.symbolism.decanRange[0];
    const endDeg = card.symbolism.signIndex * 30 + card.symbolism.decanRange[1];
    const midDeg = (startDeg + endDeg) / 2;

    // Angular circular distance on 360° wheel
    const diff = Math.abs((transitDeg % 360) - midDeg);
    const circularDist = Math.min(diff, 360 - diff);

    // Direct alignment when within the 10° decan window
    if (circularDist <= 5) {
      return Math.round(90 + (1 - circularDist / 5) * 10); // 90..100
    }
    // Trine harmony (120°) or Sextile (60°)
    const trineDist = Math.min(Math.abs(circularDist - 120), Math.abs(circularDist - 240));
    if (trineDist <= 6) {
      return Math.round(70 + (1 - trineDist / 6) * 15); // 70..85
    }
    const sextileDist = Math.min(Math.abs(circularDist - 60), Math.abs(circularDist - 300));
    if (sextileDist <= 5) {
      return Math.round(55 + (1 - sextileDist / 5) * 15); // 55..70
    }

    // Default distance falloff
    return Math.max(10, Math.round(50 - (circularDist / 180) * 40));
  }

  // For Planetary Majors, resonate strongly with transit through its domicile or exaltation
  if (card.arcana === "major" && card.symbolism?.planetaryBody) {
    const planet = card.symbolism.planetaryBody;
    const isPrimaryTransit = skyTransit?.activePlanet === planet;
    return isPrimaryTransit ? 95 : 60;
  }

  // Base fallback for courts/aces
  return 50;
}

/**
 * Aggregate the planetaryAffinity vectors of a collection of cards into a 10-planet faction alignment vector.
 * Directly mirrors the additive dignity accumulator in server/src/chart.rs::faction_scores.
 *
 * @param {Array<object>} cards - Array of Tarot card objects
 * @returns {Array<number>} 10-element vector indexed by Planet::idx (0=Sun .. 9=Pluto)
 */
export function calculateDeckPlanetaryAffinity(cards) {
  const scores = new Array(10).fill(0);
  if (!Array.isArray(cards) || cards.length === 0) return scores;

  for (const card of cards) {
    const affinity = card?.planetaryAffinity;
    if (Array.isArray(affinity) && affinity.length === 10) {
      for (let i = 0; i < 10; i++) {
        scores[i] += affinity[i];
      }
    }
  }

  return scores;
}

export default {
  PLANETARY_12_AXES,
  STORED_PLANETARY_AXES,
  PLANET_TO_AXIS,
  PLANET_BODIES,
  kineticAlignment,
  calculateDeckPlanetaryAffinity
};
