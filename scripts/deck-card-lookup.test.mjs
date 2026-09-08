// Deck Card Lookup & Modal Model Resolution Test Suite
// Verifies that all deck cards (Majors 0..21 and Minors 1..14 across 4 suits)
// correctly resolve via getCard(suit, rank) with valid Sacred 7, Planetary 12,
// and Planetary Dignity Affinity vectors — preventing empty card modals in production.

import assert from "node:assert/strict";
import { getCard, getAllCards, kineticAlignment } from "../src/cards/index.js";
import { STORED_PLANETARY_AXES } from "../src/cards/kinetics.js";

console.log("==================================================");
console.log("✦ Pentacles Deck Card Lookup & Inspector Test ✦");
console.log("==================================================");

// 1. Verify all 22 Major Arcana resolve
console.log("▶ 1 · Major Arcana resolution (ranks 0..21)...");
for (let rank = 0; rank <= 21; rank++) {
  const card = getCard("major", rank);
  assert.ok(card, `Major Arcana rank ${rank} must resolve`);
  assert.equal(card.arcana, "major", `Card ${rank} must be major arcana`);
  assert.ok(card.name, `Major ${rank} must have a title`);
  assert.ok(Array.isArray(card.planetaryAffinity) && card.planetaryAffinity.length === 10,
    `Major ${rank} must have 10-element planetaryAffinity vector`);
}
console.log("  ✓ All 22 Major Arcana resolve with title and 10-planet affinity");

// 2. Verify all 56 Minor Arcana resolve across 4 suits
console.log("▶ 2 · Minor Arcana resolution (4 suits × 14 ranks)...");
const suits = ["wands", "cups", "swords", "pentacles"];
for (const suit of suits) {
  for (let rank = 1; rank <= 14; rank++) {
    const card = getCard(suit, rank);
    assert.ok(card, `Minor Arcana ${suit} rank ${rank} must resolve`);
    assert.equal(card.arcana, "minor", `${suit} ${rank} must be minor arcana`);
    assert.equal(card.suit, suit, `${suit} ${rank} suit mismatch`);

    // Verify Sacred 7 stats
    assert.ok(card.sacredStats, `${card.name} must have sacredStats`);
    for (const stat of ["power", "resonance", "wisdom", "charisma", "intuition", "adaptability", "vitality"]) {
      const val = card.sacredStats[stat];
      assert.ok(typeof val === "number" && val >= 20 && val <= 95,
        `${card.name} sacredStat ${stat} (${val}) out of band [20, 95]`);
    }

    // Verify Planetary 12 stored stats
    assert.ok(card.planetaryStats, `${card.name} must have planetaryStats`);
    for (const axis of STORED_PLANETARY_AXES) {
      const val = card.planetaryStats[axis];
      assert.ok(typeof val === "number" && val >= 10 && val <= 95,
        `${card.name} planetaryStat ${axis} (${val}) out of band [10, 95]`);
    }
  }
}
console.log("  ✓ All 56 Minor Arcana resolve with complete Sacred 7 and Planetary 12 stats");

// 3. Verify Live Transit Resonance calculation
console.log("▶ 3 · Live Transit Resonance (kineticAlignment)...");
const allCards = getAllCards();
assert.equal(allCards.length, 78, "Must test across all 78 Tarot cards");

for (const card of allCards) {
  // Test across equinox (0°), solstice (90°), and transit context
  for (const deg of [0, 90, 180, 270]) {
    const score = kineticAlignment(card, deg);
    assert.ok(typeof score === "number" && score >= 0 && score <= 100,
      `${card.name} at transit ${deg}° gave invalid score: ${score}`);
  }
}
console.log("  ✓ kineticAlignment computes bounded scores [0, 100] across all 78 cards");

console.log("==================================================");
console.log("ALL 78 Tarot card lookups and modal models verified!");
console.log("==================================================\n");
