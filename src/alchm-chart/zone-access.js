/* ============================================================
   Zone Access Rules & Refusal Reasons (DOM-free, pure module)
   ============================================================
   Single canonical source of truth for Pentacles Zone Melee access.
   Imported by:
     - server test parity (scripts/war-table.test.mjs)
     - feeder daemon (feeder/war-table.ts)
     - client war model (src/alchm-chart/war-model.js)
     - faction war UI (src/alchm-chart/faction-war.js)

   Rule ladder:
     - Houses (0–4): always accessible to all factions.
     - Spires (5–9): accessible if the faction holds at least ONE adjacent House:
         spire_idx = zone_id - 5;
         house_a = spire_idx;
         house_b = (spire_idx + 4) % 5; // i.e. (zone_id - 1) % 5
     - Crown (10): accessible only if the faction holds AT LEAST TWO Spires (5..9).
   ============================================================ */

export const PLANET_NAMES = [
  "Sun", "Moon", "Mercury", "Venus", "Mars",
  "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
];

/**
 * Determine if a faction can legally access a zone.
 * @param {number} zoneId - 0..10
 * @param {number} faction - 0..9 faction index
 * @param {Array<number|null>} zoneOwners - array of length 11 mapping zoneId -> owning faction index (or null)
 * @returns {boolean}
 */
export function canAccessZone(zoneId, faction, zoneOwners) {
  if (zoneId < 0 || zoneId > 10) return false;
  const owns = (z) => zoneOwners && zoneOwners[z] === faction;
  if (zoneId < 5) return true;
  if (zoneId < 10) {
    const spireIdx = zoneId - 5;
    return owns(spireIdx) || owns((spireIdx + 4) % 5);
  }
  let ownedSpires = 0;
  for (let s = 5; s < 10; s++) {
    if (owns(s)) ownedSpires++;
  }
  return ownedSpires >= 2;
}

/**
 * Return human-friendly refusal reason if a faction cannot access a zone.
 * Returns null if access is granted.
 * @param {number} zoneId - 0..10
 * @param {number|string} faction - faction index (0..9) or name
 * @param {Array<number|null>} zoneOwners - array of length 11
 * @param {string[]} names - list of 10 planet names
 * @returns {string|null}
 */
export function accessRefusalReason(zoneId, faction, zoneOwners, names = PLANET_NAMES) {
  const fIdx = typeof faction === "number" ? faction : names.findIndex((n) => n.toLowerCase() === String(faction).toLowerCase());
  if (fIdx < 0 || fIdx > 9) return "Unknown faction.";
  if (canAccessZone(zoneId, fIdx, zoneOwners)) return null;

  const factionName = names[fIdx] || "Your faction";
  if (zoneId === 10) {
    return "The Crown is sealed to your faction — hold two Spires first.";
  }
  if (zoneId >= 5 && zoneId <= 9) {
    return `Spire ${zoneId - 5} is out of reach — ${factionName} must hold an adjacent House first.`;
  }
  return `Zone ${zoneId} is currently inaccessible.`;
}

export default {
  PLANET_NAMES,
  canAccessZone,
  accessRefusalReason,
};
