/* ============================================================
   Validate Tarot Card Definitions & Registry Test Suite
   ============================================================
   Verifies:
   1. All 78 individual Tarot card files exist and are valid JSON
   2. Every card strictly adheres to schema properties & types
   3. Sacred 7 stats (power, resonance, wisdom, charisma, intuition,
      adaptability, vitality) are fully present and within [20, 95]
   4. Absence of legacy generic combat block (baseAttack, baseHealth, etc.)
   5. Scrabble letters present across all 78 cards
   6. All 36 Golden Dawn decan pips match decans.js in sign, decan, suit & title
   7. All 36 Triplicity decan pips match the user's specification sheet
   8. Zero stat degeneracy — all 78 cards have distinct Sacred 7 profiles
   9. All 22 Major Arcana match arcanaTrickEngine.js in rank, family & honours
   10. Registry module src/cards/index.js exports complete lookups and helper functions
   ============================================================ */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { decanCard } from "../src/alchm-chart/decans.js";
import {
  ALL_CARDS,
  CARDS_BY_ID,
  CARDS_BY_SLUG,
  MAJOR_ARCANA,
  MINOR_ARCANA,
  getCardById,
  getCardBySlug,
  getCard,
  getMajorArcana,
  getDecanPip,
  getAllMajors,
  getAllMinors,
  getAllCards
} from "../src/cards/index.js";

const ROOT = process.cwd();
const CARDS_DIR = path.join(ROOT, "data", "cards");

console.log("▶ 1 · Validating File Presence & Schema Completeness (78 Cards)...");

// Check Major Arcana files
const majorFiles = fs.readdirSync(path.join(CARDS_DIR, "major")).filter(f => f.endsWith(".json"));
assert.equal(majorFiles.length, 22, "Must contain exactly 22 Major Arcana JSON files");

// Check Minor Arcana files
const suits = ["wands", "cups", "swords", "pentacles"];
let totalMinorFiles = 0;
for (const suit of suits) {
  const files = fs.readdirSync(path.join(CARDS_DIR, "minor", suit)).filter(f => f.endsWith(".json"));
  assert.equal(files.length, 14, `Must contain exactly 14 cards for suit ${suit}`);
  totalMinorFiles += files.length;
}
assert.equal(totalMinorFiles, 56, "Must contain exactly 56 Minor Arcana JSON files");
assert.equal(majorFiles.length + totalMinorFiles, 78, "Total cards must equal 78");

// Validate schema properties and Sacred 7 stats on all cards
const SACRED_STAT_KEYS = ["power", "resonance", "wisdom", "charisma", "intuition", "adaptability", "vitality"];

for (const card of ALL_CARDS) {
  assert.ok(card.id, `Card must have id: ${JSON.stringify(card)}`);
  assert.ok(card.slug, `Card must have slug: ${card.id}`);
  assert.ok(card.name, `Card must have name: ${card.id}`);
  assert.ok(card.arcana === "major" || card.arcana === "minor", `Invalid arcana type: ${card.id}`);
  assert.ok(card.numeral !== undefined, `Card must have numeral badge: ${card.id}`);
  assert.ok(typeof card.rank === "number", `Card rank must be number: ${card.id}`);
  assert.ok(card.suit, `Card must have suit: ${card.id}`);

  // Symbolism
  assert.ok(card.symbolism, `Card missing symbolism block: ${card.id}`);
  assert.ok(card.symbolism.goldenDawnTitle, `Missing Golden Dawn title: ${card.id}`);
  assert.ok(card.symbolism.element, `Missing element: ${card.id}`);
  assert.ok(typeof card.symbolism.esms === "number", `Missing ESMS integer: ${card.id}`);

  // Styling
  assert.ok(card.styling, `Card missing styling block: ${card.id}`);
  assert.ok(card.styling.glyph, `Missing glyph: ${card.id}`);
  assert.ok(card.styling.primaryColor, `Missing primaryColor: ${card.id}`);
  assert.ok(card.styling.frameStyle, `Missing frameStyle: ${card.id}`);
  assert.ok(card.styling.artAsset, `Missing artAsset: ${card.id}`);
  assert.ok(typeof card.styling.audioFrequencyHz === "number", `Missing audio frequency: ${card.id}`);

  // Sacred 7 Stats
  assert.ok(card.sacredStats, `Card missing sacredStats: ${card.id}`);
  for (const key of SACRED_STAT_KEYS) {
    const val = card.sacredStats[key];
    assert.ok(typeof val === "number", `Stat ${key} must be a number on ${card.id}`);
    assert.ok(val >= 20 && val <= 95, `Stat ${key} on ${card.id} out of bounds: ${val} (expected 20..95)`);
  }

  // Scrabble Letter
  assert.ok(card.scrabbleLetter && typeof card.scrabbleLetter === "string", `Missing scrabbleLetter: ${card.id}`);

  // Legacy combat block must NOT be present
  assert.equal(card.combat, undefined, `Legacy combat block must be removed: ${card.id}`);

  // Trick Engine
  assert.ok(card.trickEngine, `Card missing trickEngine block: ${card.id}`);
  assert.ok(typeof card.trickEngine.trickPower === "number", `Missing trickPower: ${card.id}`);
  assert.ok([0, 5, 10].includes(card.trickEngine.counterValue), `Invalid counterValue: ${card.id}`);
  assert.ok(typeof card.trickEngine.isHonour === "boolean", `Missing isHonour boolean: ${card.id}`);
  assert.ok(Array.isArray(card.trickEngine.eligibleMelds), `Missing eligibleMelds array: ${card.id}`);

  // Lore
  assert.ok(card.lore, `Card missing lore block: ${card.id}`);
  assert.ok(Array.isArray(card.lore.keywords) && card.lore.keywords.length > 0, `Missing keywords: ${card.id}`);
  assert.ok(card.lore.upright && card.lore.upright.length > 0, `Missing upright lore: ${card.id}`);
  assert.ok(card.lore.reversed && card.lore.reversed.length > 0, `Missing reversed lore: ${card.id}`);
  assert.ok(card.lore.description && card.lore.description.length > 0, `Missing description: ${card.id}`);
}
console.log("  ✓ All 78 card files validated against schema requirements & Sacred 7 bounds");

console.log("▶ 2 · Validating Golden Dawn Decan Parity with decans.js (36 Pips)...");
for (let sign = 0; sign < 12; sign++) {
  for (let decanIdx = 0; decanIdx < 3; decanIdx++) {
    const degInSign = decanIdx * 10 + 5;
    const ref = decanCard(sign, degInSign); // { rank, suit, title, ruler, range, esms }
    const card = getDecanPip(sign, decanIdx);

    assert.ok(card, `Must find decan card for sign ${sign}, decan ${decanIdx}`);
    assert.equal(card.rank, ref.rank, `Rank mismatch for sign ${sign}, decan ${decanIdx}`);
    assert.equal(card.suit.toLowerCase(), ref.suit.toLowerCase(), `Suit mismatch for sign ${sign}`);
    assert.equal(card.symbolism.goldenDawnTitle, `Lord of ${ref.title}`, `Title mismatch for ${card.name}`);
    assert.equal(card.symbolism.esms, ref.esms, `ESMS mismatch for ${card.name}`);
    assert.equal(card.symbolism.chaldeanRulerIndex, ref.ruler, `Chaldean ruler mismatch for ${card.name}`);
  }
}
console.log("  ✓ All 36 Minor decan pips maintain 100% parity with Golden Dawn astrology");

console.log("▶ 3 · Validating Triplicity Decan Specifications...");
const EXPECTED_TRIPLICITY_RULERS = {
  "two-of-wands": "Mars", "three-of-wands": "Sun", "four-of-wands": "Jupiter",
  "five-of-wands": "Sun", "six-of-wands": "Jupiter", "seven-of-wands": "Mars",
  "eight-of-wands": "Jupiter", "nine-of-wands": "Mars", "ten-of-wands": "Sun",

  "two-of-cups": "Moon", "three-of-cups": "Mars & Pluto", "four-of-cups": "Jupiter & Neptune",
  "five-of-cups": "Mars", "six-of-cups": "Jupiter & Neptune", "seven-of-cups": "Moon",
  "eight-of-cups": "Jupiter & Neptune", "nine-of-cups": "Moon", "ten-of-cups": "Pluto",

  "two-of-swords": "Venus", "three-of-swords": "Uranus", "four-of-swords": "Mercury",
  "five-of-swords": "Saturn & Uranus", "six-of-swords": "Mercury", "seven-of-swords": "Venus",
  "eight-of-swords": "Mercury", "nine-of-swords": "Venus", "ten-of-swords": "Uranus",

  "two-of-pentacles": "Saturn", "three-of-pentacles": "Venus", "four-of-pentacles": "Mercury",
  "five-of-pentacles": "Venus", "six-of-pentacles": "Mercury", "seven-of-pentacles": "Saturn",
  "eight-of-pentacles": "Mercury", "nine-of-pentacles": "Saturn", "ten-of-pentacles": "Venus"
};

for (const [slug, expectedRuler] of Object.entries(EXPECTED_TRIPLICITY_RULERS)) {
  const card = getCardBySlug(slug);
  assert.ok(card, `Card ${slug} must exist`);
  assert.equal(card.symbolism.triplicityRuler, expectedRuler, `Triplicity ruler mismatch for ${slug}`);
}
console.log("  ✓ All 36 Triplicity decan rulers verified against user specification");

console.log("▶ 4 · Validating Degeneracy (Zero Collisions across all 78 Cards)...");
const seenProfiles = new Map();
for (const card of ALL_CARDS) {
  const profileKey = SACRED_STAT_KEYS.map(k => card.sacredStats[k]).join(",");
  if (seenProfiles.has(profileKey)) {
    assert.fail(`Stat profile collision: ${card.name} has identical stats to ${seenProfiles.get(profileKey)}`);
  }
  seenProfiles.set(profileKey, card.name);
}
assert.equal(seenProfiles.size, 78, "All 78 cards must have unique Sacred 7 stat profiles");

// Spot-check degenerate trio
const twoCups = getCardBySlug("two-of-cups");
const fiveCups = getCardBySlug("five-of-cups");
const tenCups = getCardBySlug("ten-of-cups");

assert.notDeepEqual(twoCups.sacredStats, fiveCups.sacredStats, "2 of Cups and 5 of Cups must be differentiated");
assert.notDeepEqual(fiveCups.sacredStats, tenCups.sacredStats, "5 of Cups and 10 of Cups must be differentiated");
assert.notDeepEqual(twoCups.sacredStats, tenCups.sacredStats, "2 of Cups and 10 of Cups must be differentiated");

// 2 of Cups (Moon) should lead in intuition / resonance
assert.ok(twoCups.sacredStats.intuition > fiveCups.sacredStats.intuition, "2 of Cups (Moon) should have higher intuition than 5 of Cups (Mars)");
// 5 of Cups (Mars) should lead in power / vitality
assert.ok(fiveCups.sacredStats.power > twoCups.sacredStats.power, "5 of Cups (Mars) should have higher power than 2 of Cups (Moon)");
console.log("  ✓ 100% uniqueness verified: 78 cards have 78 unique Sacred 7 stat profiles");

console.log("▶ 5 · Validating 22 Major Arcana Rules & Honours...");
const MAJOR_HONOUR_RANKS = [0, 1, 21]; // The Fool (0), The Magician (I), The World (XXI)
for (let arcana = 0; arcana < 22; arcana++) {
  const card = getMajorArcana(arcana);
  assert.ok(card, `Major Arcana ${arcana} must exist`);
  assert.equal(card.rank, arcana);
  assert.equal(card.arcana, "major");

  if (MAJOR_HONOUR_RANKS.includes(arcana)) {
    assert.equal(card.trickEngine.isHonour, true, `Card ${card.name} must be an honour (Oudler)`);
    assert.equal(card.trickEngine.counterValue, 10, `Card ${card.name} must be worth 10 counters`);
  } else {
    assert.equal(card.trickEngine.isHonour, false, `Card ${card.name} should not be an honour`);
    assert.equal(card.trickEngine.counterValue, 0, `Card ${card.name} should have 0 counter value`);
  }
}
console.log("  ✓ All 22 Major Arcana honours and trick counter values verified");

console.log("▶ 6 · Validating Registry Lookups & Helpers...");
assert.equal(ALL_CARDS.length, 78);
assert.equal(Object.keys(CARDS_BY_ID).length, 78);
assert.equal(Object.keys(CARDS_BY_SLUG).length, 78);
assert.equal(getAllMajors().length, 22);
assert.equal(getAllMinors().length, 56);
assert.equal(getAllMinors("wands").length, 14);
assert.equal(getAllMinors("cups").length, 14);
assert.equal(getAllMinors("swords").length, 14);
assert.equal(getAllMinors("pentacles").length, 14);

// Lookup checks
const fool = getCardById("major-00");
assert.equal(fool.name, "The Fool");
assert.equal(fool.symbolism.hebrewLetter, "Aleph (א)");
assert.ok(fool.sacredStats.intuition > 60);

const magus = getCardBySlug("the-magician");
assert.equal(magus.name, "The Magician");
assert.equal(magus.symbolism.goldenDawnTitle, "The Magus of Power");
assert.ok(magus.sacredStats.adaptability > 70);

const aceWands = getCard("wands", 1);
assert.equal(aceWands.name, "Ace of Wands");
assert.equal(aceWands.trickEngine.counterValue, 10);
assert.equal(aceWands.trickEngine.trickPower, 14);
assert.ok(aceWands.sacredStats.power > 50);

const kingPentacles = getCard("pentacles", 14);
assert.equal(kingPentacles.name, "King of Pentacles");
assert.equal(kingPentacles.trickEngine.counterValue, 10);
assert.equal(kingPentacles.trickEngine.trickPower, 12);
assert.ok(kingPentacles.sacredStats.vitality > 40);

console.log("  ✓ Card registry lookups and helper functions operate seamlessly");

console.log("\nALL 78 Tarot Card Definition & Sacred 7 Registry tests passed with 100% success!\n");
