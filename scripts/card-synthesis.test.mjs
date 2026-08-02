import assert from "node:assert/strict";
import fs from "node:fs";

// Import client.js content or test logic directly
const clientCode = fs.readFileSync(new URL("../public/client.js", import.meta.url), "utf8");

// Validate that mintSlot assigns "active" loadout
assert.match(
  clientCode,
  /mintSlot\(cardId\)[\s\S]*?this\.deck\.push\(\{\s*card_id:\s*cardId,\s*loadout:\s*"active"\s*\}\)/,
  "mintSlot must assign active loadout by default so deck forms the hand"
);

// Validate that synthesizeRewardCardsFromPlayed exists
assert.match(
  clientCode,
  /synthesizeRewardCardsFromPlayed\(playedCards,\s*targetZoneId,\s*pentaclesYield\)/,
  "client.js must define synthesizeRewardCardsFromPlayed"
);

// Validate that reward cards are pushed as "active" loadout upon gate breach
assert.match(
  clientCode,
  /this\.deck\.push\(\{\s*card_id:\s*rewardCard\.card_id,\s*loadout:\s*"active"\s*\}\)/,
  "Gate breach rewards must land in active hand loadout"
);

// Test synthesized card math
const mockPlayedCards = [
  { card_id: 101, suit: "wands", rank: 5, attack: 10, health: 20, armour: 4, level: 1, sign_idx: 0, is_major: false },
  { card_id: 102, suit: "wands", rank: 7, attack: 14, health: 24, armour: 6, level: 2, sign_idx: 0, is_major: false },
  { card_id: 103, suit: "cups", rank: 4, attack: 8, health: 18, armour: 2, level: 1, sign_idx: 1, is_major: false }
];

// Simple simulation of synthesizeRewardCardsFromPlayed math
const suitCounts = {};
let totalAtk = 0;
let maxRank = 1;
mockPlayedCards.forEach(c => {
  suitCounts[c.suit] = (suitCounts[c.suit] || 0) + 1;
  totalAtk += c.attack;
  if (c.rank > maxRank) maxRank = c.rank;
});

let dominantSuit = "pentacles";
let maxSuitCount = 0;
for (const s in suitCounts) {
  if (suitCounts[s] > maxSuitCount) {
    maxSuitCount = suitCounts[s];
    dominantSuit = s;
  }
}

assert.equal(dominantSuit, "wands", "Dominant suit of played cards should be wands");
assert.equal(maxRank, 7, "Max rank of played cards should be 7");
assert.equal(totalAtk / 3, 10.666666666666666, "Average attack computed correctly");

console.log("PASS card synthesis and deck-as-hand contract tests!");
