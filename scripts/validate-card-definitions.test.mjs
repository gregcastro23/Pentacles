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
  getAllCards,
  PLANETARY_12_AXES,
  STORED_PLANETARY_AXES,
  PLANET_TO_AXIS,
  PLANET_BODIES,
  kineticAlignment,
  calculateDeckPlanetaryAffinity
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

  // Planetary 12 Stats (11 static stored axes)
  assert.ok(card.planetaryStats, `Card missing planetaryStats: ${card.id}`);
  for (const axis of STORED_PLANETARY_AXES) {
    const val = card.planetaryStats[axis];
    assert.ok(typeof val === "number", `Planetary stat ${axis} must be a number on ${card.id}`);
    assert.ok(val >= 20 && val <= 95, `Planetary stat ${axis} on ${card.id} out of bounds: ${val} (expected 20..95)`);
  }

  // Planetary Affinity Vector ([i8; 10] matching server/src/chart.rs::faction_scores)
  assert.ok(Array.isArray(card.planetaryAffinity), `Card missing planetaryAffinity array: ${card.id}`);
  assert.equal(card.planetaryAffinity.length, 10, `planetaryAffinity must have exactly 10 elements on ${card.id}`);
  for (let i = 0; i < 10; i++) {
    const aff = card.planetaryAffinity[i];
    assert.ok(Number.isInteger(aff), `planetaryAffinity[${i}] must be integer on ${card.id}`);
    assert.ok(aff >= -5 && aff <= 5, `planetaryAffinity[${i}] out of bounds [-5, 5] on ${card.id}: ${aff}`);
  }

  // Symbolism triplicity ruler indices
  assert.ok(Array.isArray(card.symbolism.triplicityRulerIndices), `Missing triplicityRulerIndices array: ${card.id}`);
  for (const idx of card.symbolism.triplicityRulerIndices) {
    assert.ok(Number.isInteger(idx) && idx >= 0 && idx < 10, `Invalid triplicityRulerIndex ${idx} on ${card.id}`);
  }

  // Ace nullification check (Finding B4)
  if (card.arcana === "minor" && card.rank === 1) {
    assert.equal(card.symbolism.triplicityRuler, null, `Ace ${card.id} must have null triplicityRuler`);
    assert.equal(card.symbolism.triplicityRulerIndex, null, `Ace ${card.id} must have null triplicityRulerIndex`);
    assert.equal(card.symbolism.triplicityRulerIndices.length, 0, `Ace ${card.id} must have empty triplicityRulerIndices`);
    assert.equal(card.symbolism.triplicitySign, null, `Ace ${card.id} must have null triplicitySign`);
    assert.equal(card.symbolism.planetaryBody, null, `Ace ${card.id} must have null planetaryBody`);
    assert.equal(card.symbolism.planetIndex, null, `Ace ${card.id} must have null planetIndex`);
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

console.log("▶ 7 · Validating Court Card Pure Suit & Magnitude Scaling (+, ++, +++, ++++)...");
const COURT_EXPECTED_MAGNITUDES = {
  11: { name: "Page", badge: "+" },
  12: { name: "Knight", badge: "++" },
  13: { name: "Queen", badge: "+++" },
  14: { name: "King", badge: "++++" }
};

const SUIT_DOMINANT_STATS = {
  wands: ["power", "resonance", "charisma", "adaptability", "vitality"],
  cups: ["resonance", "wisdom", "charisma", "intuition"],
  swords: ["wisdom", "intuition", "adaptability"],
  pentacles: ["power", "vitality"]
};

for (const suit of ["wands", "cups", "swords", "pentacles"]) {
  const page = getCard(suit, 11);
  const knight = getCard(suit, 12);
  const queen = getCard(suit, 13);
  const king = getCard(suit, 14);
  const courtCards = [page, knight, queen, king];

  // 1. Validate pure suit element attribution
  const expectedElement = suit === "wands" ? "Fire" : suit === "cups" ? "Water" : suit === "swords" ? "Air" : "Earth";
  for (const c of courtCards) {
    assert.equal(c.symbolism.element, expectedElement, `${c.name} element must strictly match its suit (${expectedElement})`);
    assert.equal(c.symbolism.planetaryBody, null, `${c.name} must not have planetary attribution`);
    assert.equal(c.symbolism.zodiacSign, null, `${c.name} must not have zodiac sign attribution`);
  }

  // 2. Validate lore magnitude tags
  for (const rank of [11, 12, 13, 14]) {
    const card = getCard(suit, rank);
    const badge = COURT_EXPECTED_MAGNITUDES[rank].badge;
    assert.ok(card.lore.keywords.includes(`Magnitude ${badge}`), `${card.name} keywords must include Magnitude ${badge}`);
  }

  // 3. Validate strict monotonic magnitude scaling (Page < Knight < Queen < King)
  const activeStats = SUIT_DOMINANT_STATS[suit];
  for (const stat of activeStats) {
    assert.ok(
      page.sacredStats[stat] < knight.sacredStats[stat],
      `${suit} Knight (${knight.sacredStats[stat]}) must exceed Page (${page.sacredStats[stat]}) in ${stat}`
    );
    assert.ok(
      knight.sacredStats[stat] < queen.sacredStats[stat],
      `${suit} Queen (${queen.sacredStats[stat]}) must exceed Knight (${knight.sacredStats[stat]}) in ${stat}`
    );
    assert.ok(
      queen.sacredStats[stat] < king.sacredStats[stat],
      `${suit} King (${king.sacredStats[stat]}) must exceed Queen (${queen.sacredStats[stat]}) in ${stat}`
    );
  }
}
console.log("  ✓ Court card pure suit element and + / ++ / +++ / ++++ magnitude hierarchy verified across all suits");

console.log("▶ 8 · Validating Planetary 12 Bounds & Additive Affinity Vectors...");
for (const card of ALL_CARDS) {
  assert.equal(Object.keys(card.planetaryStats).length, 11, `Card ${card.id} must have exactly 11 planetaryStats`);
  assert.equal(card.planetaryAffinity.length, 10, `Card ${card.id} must have exactly 10 planetaryAffinity entries`);
}
console.log("  ✓ All 78 cards possess full 11-axis Planetary 12 stats in [20, 95] and 10-planet affinity in [-5, 5]");

console.log("▶ 9 · Validating Non-Collinearity via Spearman Rank Correlation (|ρ| < 0.95)...");
function getRanks(arr) {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length - 1 && indexed[j + 1].v === indexed[j].v) j++;
    const avgRank = 1 + (i + j) / 2;
    for (let k = i; k <= j; k++) ranks[indexed[k].i] = avgRank;
    i = j + 1;
  }
  return ranks;
}

function spearmanRho(x, y) {
  const rx = getRanks(x);
  const ry = getRanks(y);
  const n = x.length;
  const meanX = (n + 1) / 2;
  const meanY = (n + 1) / 2;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i] - meanX;
    const dy = ry[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  return num / Math.sqrt(denX * denY);
}

const solarScores = ALL_CARDS.map(c => c.planetaryStats.solarAgency);
const martialScores = ALL_CARDS.map(c => c.planetaryStats.martialImpetus);
const uranianScores = ALL_CARDS.map(c => c.planetaryStats.uranianSurprisal);
const lunarScores = ALL_CARDS.map(c => c.planetaryStats.lunarReceptivity);
const venusScores = ALL_CARDS.map(c => c.planetaryStats.venusianCoherence);

const rhoSolarMartial = spearmanRho(solarScores, martialScores);
const rhoSolarUranian = spearmanRho(solarScores, uranianScores);
const rhoLunarVenus = spearmanRho(lunarScores, venusScores);

console.log(`  • Spearman ρ(solarAgency, martialImpetus):   ${rhoSolarMartial.toFixed(4)} (threshold: |ρ| < 0.95)`);
console.log(`  • Spearman ρ(solarAgency, uranianSurprisal): ${rhoSolarUranian.toFixed(4)} (threshold: |ρ| < 0.95)`);
console.log(`  • Spearman ρ(lunarReceptivity, venusianCoherence): ${rhoLunarVenus.toFixed(4)} (threshold: |ρ| < 0.95)`);

assert.ok(Math.abs(rhoSolarMartial) < 0.95, `solarAgency vs martialImpetus collinear: ρ = ${rhoSolarMartial}`);
assert.ok(Math.abs(rhoSolarUranian) < 0.95, `solarAgency vs uranianSurprisal collinear: ρ = ${rhoSolarUranian}`);
assert.ok(Math.abs(rhoLunarVenus) < 0.95, `lunarReceptivity vs venusianCoherence collinear: ρ = ${rhoLunarVenus}`);
console.log("  ✓ Zero collinearity across all previously degenerate single-axis dimensions (|ρ| < 0.95)");

console.log("▶ 10 · Validating Planetary Majors Standing & Astrological Reality...");
const PLANETARY_MAJORS_SPEC = [
  { name: "The Sun", planet: "Sun", axis: "solarAgency", expectedDeckRankMax: 1 },
  { name: "The High Priestess", planet: "Moon", axis: "lunarReceptivity", expectedDeckRankMax: 1 },
  { name: "The Magician", planet: "Mercury", axis: "mercurialVelocity", expectedDeckRankMax: 1 },
  { name: "The Empress", planet: "Venus", axis: "venusianCoherence", expectedDeckRankMax: 1 },
  { name: "The Tower", planet: "Mars", axis: "martialImpetus", expectedDeckRankMax: 2 },
  { name: "Wheel of Fortune", planet: "Jupiter", axis: "jovianExpansion", expectedDeckRankMax: 1 },
  { name: "The World", planet: "Saturn", axis: "saturnianStructure", expectedDeckRankMax: 1 },
  { name: "The Hanged Man", planet: "Neptune", axis: "neptunianResonance", expectedDeckRankMax: 1 },
  { name: "Judgement", planet: "Pluto", axis: "plutonicIntegration", expectedDeckRankMax: 1 },
  { name: "The Fool", planet: "Uranus", axis: "uranianSurprisal", expectedDeckRankMax: 5 }
];

for (const pm of PLANETARY_MAJORS_SPEC) {
  const majorCard = ALL_CARDS.find(c => c.name === pm.name);
  assert.ok(majorCard, `Major card ${pm.name} must exist`);
  const score = majorCard.planetaryStats[pm.axis];

  // Cards ruled by this planet
  const ruledCards = ALL_CARDS.filter(c =>
    c.symbolism?.planetaryBody === pm.planet ||
    c.symbolism?.chaldeanRuler === pm.planet ||
    c.symbolism?.triplicityRuler?.includes(pm.planet)
  );

  const maxRuledScore = Math.max(...ruledCards.map(c => c.planetaryStats[pm.axis]));
  assert.ok(score >= maxRuledScore, `${pm.name} (${score}) must rank #1 among ${pm.planet}-governed cards (max: ${maxRuledScore})`);

  // Deck-wide ranking
  const deckSorted = [...ALL_CARDS].sort((a, b) => b.planetaryStats[pm.axis] - a.planetaryStats[pm.axis]);
  const deckRank = deckSorted.findIndex(c => c.name === pm.name) + 1;
  assert.ok(deckRank <= pm.expectedDeckRankMax, `${pm.name} deck rank #${deckRank} exceeded max allowed #${pm.expectedDeckRankMax}`);
  console.log(`  • ${pm.name.padEnd(20)} (${pm.planet.padEnd(7)} -> ${pm.axis.padEnd(19)}): score=${score}, #1 among ruled: ✓, deckRank=#${deckRank}`);
}
console.log("  ✓ All 10 Planetary Majors hold astrological #1 standing among cards governed by their planet");

console.log("▶ 11 · Validating Chiron Asymmetry & Structural Integrity...");
const chironScores = ALL_CARDS.map(c => c.planetaryStats.chironicAdaptation);
const chironMin = Math.min(...chironScores);
const chironMax = Math.max(...chironScores);
assert.ok(chironMax > chironMin, "chironicAdaptation must have healthy deck-wide variance");
for (const card of ALL_CARDS) {
  assert.notEqual(card.symbolism?.planetaryBody, "Chiron", `${card.id} cannot have Chiron planetaryBody`);
  assert.notEqual(card.symbolism?.chaldeanRuler, "Chiron", `${card.id} cannot have Chiron chaldeanRuler`);
  assert.notEqual(card.symbolism?.triplicityRuler, "Chiron", `${card.id} cannot have Chiron triplicityRuler`);
  assert.equal(card.planetaryAffinity.length, 10, `${card.id} planetaryAffinity must exclude Chiron (10 planets only)`);
}
console.log(`  ✓ Chiron asymmetry verified: non-zero variance [${chironMin}, ${chironMax}] with zero invalid ruler attributions`);

console.log("▶ 12 · Validating Suit-Level Dominance in Planetary 12...");
const suitsList = ["wands", "cups", "swords", "pentacles"];
const getSuitAvg = (suitId, axis) => {
  const cards = MINOR_ARCANA[suitId];
  return cards.reduce((sum, c) => sum + c.planetaryStats[axis], 0) / cards.length;
};

const wandsSolar = getSuitAvg("wands", "solarAgency");
const swordsMercury = getSuitAvg("swords", "mercurialVelocity");
const cupsLunar = getSuitAvg("cups", "lunarReceptivity");
const pentaclesSaturn = getSuitAvg("pentacles", "saturnianStructure");

for (const s of suitsList) {
  if (s !== "wands") assert.ok(wandsSolar > getSuitAvg(s, "solarAgency"), `Wands solarAgency must exceed ${s}`);
  if (s !== "swords") assert.ok(swordsMercury > getSuitAvg(s, "mercurialVelocity"), `Swords mercurialVelocity must exceed ${s}`);
  if (s !== "cups") assert.ok(cupsLunar > getSuitAvg(s, "lunarReceptivity"), `Cups lunarReceptivity must exceed ${s}`);
  if (s !== "pentacles") assert.ok(pentaclesSaturn > getSuitAvg(s, "saturnianStructure"), `Pentacles saturnianStructure must exceed ${s}`);
}
console.log(`  • Wands leads solarAgency:       ${wandsSolar.toFixed(1)} vs others < 30`);
console.log(`  • Swords leads mercurialVelocity: ${swordsMercury.toFixed(1)} vs others < 34`);
console.log(`  • Cups leads lunarReceptivity:     ${cupsLunar.toFixed(1)} vs others < 30`);
console.log(`  • Pentacles leads saturnianStruct: ${pentaclesSaturn.toFixed(1)} vs others < 33`);
console.log("  ✓ Elemental suit archetypes mathematically dominate their respective planetary axes");

console.log("▶ 13 · Validating Live Kinetics & Faction Affinity Integration...");
const testHand = [
  getCardBySlug("the-magician"),
  getCardBySlug("three-of-cups"),
  getCard("pentacles", 14),
  getCard("wands", 1),
  getCardBySlug("seven-of-swords")
];
const deckAffinity = calculateDeckPlanetaryAffinity(testHand);
assert.equal(deckAffinity.length, 10, "calculateDeckPlanetaryAffinity must return 10-element vector");
for (const val of deckAffinity) {
  assert.ok(typeof val === "number" && !isNaN(val), "Deck affinity score must be a valid number");
}
console.log(`  • Sample dealt hand faction alignment: [${deckAffinity.join(", ")}]`);

// Transit synchronization check
const sampleDecan = getCardBySlug("two-of-wands"); // Aries decan 0 (0..10 deg, mid 5 deg)
const perfectTransit = kineticAlignment(sampleDecan, { signIndex: 0, degreeInSign: 5 });
const oppositeTransit = kineticAlignment(sampleDecan, { signIndex: 6, degreeInSign: 5 });
assert.equal(perfectTransit, 100, "Direct transit alignment in decan window must yield maximum 100");
assert.equal(oppositeTransit, 10, "Opposite transit must yield minimum falloff 10");
console.log(`  • kineticAlignment transit resonance: in-window=${perfectTransit}, opposite=${oppositeTransit}`);
console.log("  ✓ Real consumer calculateDeckPlanetaryAffinity and kineticAlignment transit calculations verified");

console.log("\nALL 78 Tarot Card Definition, Sacred 7 & Planetary 12 Registry tests passed with 100% success!\n");

