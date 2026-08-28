import assert from "node:assert/strict";
import fs from "node:fs";

// Import dignity and sign-character ES modules
import { dignityScore, dignityType, SIGN_RULERS, DOMICILES, EXALTATIONS } from "../src/alchm-chart/dignity.js";
import { signVector, dominantSigns, elementalDistribution } from "../src/alchm-chart/sign-character.js";

// Load ArcanaTrickEngine IIFE into globalThis
const engineCode = fs.readFileSync(new URL("../public/arcanaTrickEngine.js", import.meta.url), "utf8");
new Function("window", "globalThis", "global", engineCode)(globalThis, globalThis, globalThis);

const Engine = globalThis.ArcanaTrickEngine;
assert.ok(Engine, "ArcanaTrickEngine must attach to globalThis / window");

console.log("▶ Testing Section 1: Ladder, Ranks, and Counter Schedule");

// 1.1 Minor Hierarchy: Ace 14 > 10 13 > King 12 > Queen 11 > Knight 10 > Page 9 > 9..2
const powerMap = Engine.MINOR_TRICK_POWER;
assert.equal(powerMap[1], 14, "Ace should have power 14");
assert.equal(powerMap[10], 13, "10 should have power 13 (outranks King)");
assert.equal(powerMap[14], 12, "King should have power 12");
assert.equal(powerMap[13], 11, "Queen should have power 11");
assert.equal(powerMap[12], 10, "Knight (Jack) should have power 10");
assert.equal(powerMap[11], 9, "Page should have power 9");
assert.equal(powerMap[9], 8, "9 should have power 8");
assert.equal(powerMap[2], 1, "2 should have power 1");

// Inversion test: 10 strictly beats King
assert.ok(powerMap[10] > powerMap[14], "Pinochle signature inversion: 10 must outrank King");

// Superset check: Restricted to Pinochle's 6 ranks (1, 10, 14, 13, 12, 9)
const pinochleSubset = [1, 10, 14, 13, 12, 9];
for (let i = 0; i < pinochleSubset.length - 1; i++) {
  assert.ok(powerMap[pinochleSubset[i]] > powerMap[pinochleSubset[i + 1]], `Rank ${pinochleSubset[i]} must outrank ${pinochleSubset[i + 1]}`);
}

// 1.2 Counter Values
assert.equal(Engine.counterValue({ rank: 1, is_major: false }), 10, "Ace is worth 10 counters");
assert.equal(Engine.counterValue({ rank: 10, is_major: false }), 10, "10 is worth 10 counters");
assert.equal(Engine.counterValue({ rank: 14, is_major: false }), 10, "King is worth 10 counters");
assert.equal(Engine.counterValue({ rank: 13, is_major: false }), 0, "Queen is worth 0 counters");
assert.equal(Engine.counterValue({ rank: 12, is_major: false }), 0, "Knight is worth 0 counters");
assert.equal(Engine.counterValue({ rank: 11, is_major: false }), 0, "Page is worth 0 counters");
assert.equal(Engine.counterValue({ rank: 9, is_major: false }), 0, "9 is worth 0 counters");

// Major Honours: 0 (Fool), 1 (Magician), 21 (World) = 10 counters; other Majors = 0
assert.equal(Engine.counterValue({ rank: 0, is_major: true }), 10, "The Fool is worth 10 counters");
assert.equal(Engine.counterValue({ rank: 1, is_major: true }), 10, "The Magician is worth 10 counters");
assert.equal(Engine.counterValue({ rank: 21, is_major: true }), 10, "The World is worth 10 counters");
assert.equal(Engine.counterValue({ rank: 19, is_major: true }), 0, "The Sun is worth 0 counters (power, not points)");
assert.equal(Engine.counterValue({ rank: 4, is_major: true }), 0, "The Emperor is worth 0 counters");

console.log("  ✓ Ladder and counter schedule validated");

console.log("▶ Testing Section 2: WTEN Dignity Parity and Ordering");

// WTEN rule: Domicile strictly outranks Exaltation
for (let body = 0; body < 10; body++) {
  for (let sign = 0; sign < 12; sign++) {
    const type = dignityType(body, sign);
    const score = dignityScore(body, sign);
    if (type === "Domicile") assert.equal(score, 5, `Body ${body} in sign ${sign} Domicile must score +5`);
    if (type === "Exaltation") assert.equal(score, 3, `Body ${body} in sign ${sign} Exaltation must score +3`);
    if (type === "Detriment") assert.equal(score, -3, `Body ${body} in sign ${sign} Detriment must score -3`);
    if (type === "Fall") assert.equal(score, -5, `Body ${body} in sign ${sign} Fall must score -5`);
    if (type === "Neutral") assert.equal(score, 0, `Body ${body} in sign ${sign} Neutral must score 0`);
  }
}
// Specific canonical checks
assert.equal(dignityType(0, 4), "Domicile", "Sun in Leo is Domicile (+5)");
assert.equal(dignityType(0, 0), "Exaltation", "Sun in Aries is Exaltation (+3)");
assert.ok(dignityScore(0, 4) > dignityScore(0, 0), "Domicile (+5) strictly outranks Exaltation (+3)");

console.log("  ✓ WTEN Dignity parity and Domicile > Exaltation validated");

console.log("▶ Testing Section 3: Sign Character Vector Calculator");

const mockPlacements = [
  { body: 0, sign: 0 }, // Sun in Aries (Exaltation, weight 25*1.5 = 37.5)
  { body: 1, sign: 3 }, // Moon in Cancer (Domicile, weight 20*1.4 = 28.0)
  { body: 2, sign: 0 }, // Mercury in Aries (weight 12)
  { body: 4, sign: 0 }  // Mars in Aries (Domicile, weight 8*1.3 = 10.4)
];
const vecSolar = signVector(mockPlacements, 0, true); // Solar chart (Asc suppressed)
assert.equal(vecSolar.length, 12, "Sign vector must have 12 signs");
let sum = 0;
for (let i = 0; i < 12; i++) sum += vecSolar[i];
assert.ok(Math.abs(sum - 100.0) < 0.001, `Sign vector must sum to 100% (got ${sum})`);
assert.ok(vecSolar[0] > vecSolar[1], "Aries should be highest due to Sun, Mercury, Mars stellium");

const top = dominantSigns(vecSolar, 2);
assert.equal(top[0].sign, 0, "Aries must be dominant sign");

console.log("  ✓ Sign character vector calculator validated");

console.log("▶ Testing Section 4: Arcana Potency Ladder (22 Majors)");

const mockPlanets = [
  { body: 0, sign: 4, retrograde: false, up: true }, // Sun in Leo (Domicile -> high potency)
  { body: 4, sign: 3, retrograde: true, up: false }  // Mars in Cancer (Fall + retrograde + down -> low potency)
];
const ladder = Engine.buildArcanaLadder(mockPlanets, vecSolar);
assert.equal(Object.keys(ladder).length, 22, "Must compute potency for all 22 Majors");

for (let a = 0; a < 22; a++) {
  assert.ok(ladder[a] >= 1 && ladder[a] <= 100, `Arcana ${a} potency must be within 1..100 (got ${ladder[a]})`);
}

// XIX The Sun (body 0 in Leo domicile) vs XVI The Tower (body 4 in Cancer fall + retro)
assert.ok(ladder[19] > ladder[16], `The Sun in Leo (${ladder[19]}) must have higher potency than Tower in Cancer fall (${ladder[16]})`);

// Major power beats any minor power
const highMajorPower = Engine.power({ rank: 19, is_major: true }, "wands", ladder);
const trumpAcePower = Engine.power({ rank: 1, suit: "wands", is_major: false }, "wands", ladder);
assert.ok(highMajorPower > trumpAcePower, "Any Major power must exceed Trump Ace power");

console.log("  ✓ Arcana Potency ladder validated");

console.log("▶ Testing Section 5: Strict Legality Filter Rules");

const testLadder = { 0: 50, 1: 80, 4: 60, 19: 90, 21: 95 };

// 5.1 The Lead: any card is legal
const fullHand = [
  { card_id: 1, suit: "wands", rank: 10, is_major: false, title: "10 of Wands" },
  { card_id: 2, suit: "cups", rank: 13, is_major: false, title: "Queen of Cups" },
  { card_id: 3, suit: "swords", rank: 1, is_major: false, title: "Ace of Swords" },
  { card_id: 4, is_major: true, rank: 19, title: "The Sun" },
  { card_id: 5, is_major: true, rank: 0, title: "The Fool" }
];
const leadMoves = Engine.getLegalMoves(fullHand, null, "wands", [], testLadder);
assert.ok(leadMoves.every(m => m.legal), "All cards must be legal when leading");

// 5.2 Minor Led (Wands) — Player holds Wands minors
// Hand has 10 of Wands and 5 of Wands
const handWithLedSuit = [
  { card_id: 10, suit: "wands", rank: 10, is_major: false, title: "10 of Wands" },
  { card_id: 11, suit: "wands", rank: 5, is_major: false, title: "5 of Wands" },
  { card_id: 12, suit: "cups", rank: 1, is_major: false, title: "Ace of Cups" },
  { card_id: 13, is_major: true, rank: 21, title: "The World" } // Major
];

// Lead is 7 of Wands (power 6). 10 of Wands (power 13) beats it, 5 of Wands (power 4) does not.
const currentTrickWands = [
  { player: "agent", card: { card_id: 99, suit: "wands", rank: 7, is_major: false, title: "7 of Wands" } }
];
const wandsMoves = Engine.getLegalMoves(handWithLedSuit, "wands", "swords", currentTrickWands, testLadder);

// Must Follow Suit: Queen of Cups and The World are NOT legal!
const worldPlay = wandsMoves.find(m => m.card.card_id === 13);
assert.equal(worldPlay.legal, false, "The World is NOT legal when holding the led Minor suit (Must-Follow)");
const cupsPlay = wandsMoves.find(m => m.card.card_id === 12);
assert.equal(cupsPlay.legal, false, "Ace of Cups is NOT legal when holding the led Minor suit");

// Must Win: 10 of Wands beats 7 of Wands, so 10 of Wands is legal and 5 of Wands is illegal
const tenWandsPlay = wandsMoves.find(m => m.card.card_id === 10);
assert.equal(tenWandsPlay.legal, true, "10 of Wands is legal (beats 7 of Wands)");
const fiveWandsPlay = wandsMoves.find(m => m.card.card_id === 11);
assert.equal(fiveWandsPlay.legal, false, "5 of Wands is illegal because 10 of Wands can beat 7 of Wands (Must-Win)");

// 5.3 Void in led suit, holding Trump Minors and Majors
// Trump is Swords. Hand has Ace of Swords, Queen of Cups, and The Sun (Major)
const handVoidInWands = [
  { card_id: 20, suit: "swords", rank: 1, is_major: false, title: "Ace of Swords (Trump)" },
  { card_id: 21, suit: "cups", rank: 13, is_major: false, title: "Queen of Cups" },
  { card_id: 22, is_major: true, rank: 19, title: "The Sun" },
  { card_id: 23, is_major: true, rank: 0, title: "The Fool" }
];
const voidMoves = Engine.getLegalMoves(handVoidInWands, "wands", "swords", currentTrickWands, testLadder);

const trumpPlay = voidMoves.find(m => m.card.card_id === 20);
assert.equal(trumpPlay.legal, true, "Trump Minor is legal when void in led suit");
const sunPlay = voidMoves.find(m => m.card.card_id === 22);
assert.equal(sunPlay.legal, true, "Major Arcana is legal when void in led suit");
const foolPlay = voidMoves.find(m => m.card.card_id === 23);
assert.equal(foolPlay.legal, true, "The Fool is ALWAYS legal");

// 5.4 Major Led (Arcana Lead)
// Lead is The Emperor (potency 60). Hand has The Sun (potency 90), The Fool (0), and King of Wands (minor)
const currentTrickMajor = [
  { player: "agent", card: { card_id: 98, is_major: true, rank: 4, title: "The Emperor" } }
];
const majorLeadMoves = Engine.getLegalMoves(
  [
    { card_id: 30, is_major: true, rank: 19, title: "The Sun" },
    { card_id: 31, is_major: false, suit: "wands", rank: 14, title: "King of Wands" },
    { card_id: 32, is_major: true, rank: 0, title: "The Fool" }
  ],
  null, "wands", currentTrickMajor, testLadder
);
assert.equal(majorLeadMoves.find(m => m.card.card_id === 30).legal, true, "The Sun may contest an Arcana lead");
// Majors are PERMITTED, never COMPELLED: holding The Sun must not make the
// King of Wands illegal, or an opponent could lead a Major purely to strip a
// player's Arcana onto a zero-counter trick. See Section 9.
assert.equal(majorLeadMoves.find(m => m.card.card_id === 31).legal, true, "A minor stays a legal slough on an Arcana lead");
assert.equal(majorLeadMoves.find(m => m.card.card_id === 32).legal, true, "The Fool is always legal");

console.log("  ✓ Priority filter rules validated");

console.log("▶ Testing Section 6: Trick Winner Evaluation & Climax Bonus");

// Trick with Trump Minor vs Non-Trump Minor
const trick1 = [
  { player: "P1", card: { suit: "wands", rank: 1, is_major: false, title: "Ace of Wands" } }, // Led non-trump (10 pts)
  { player: "P2", card: { suit: "swords", rank: 2, is_major: false, title: "2 of Swords (Trump)" } } // Trump minor (0 pts)
];
const res1 = Engine.evaluateTrick(trick1, "swords", testLadder, 1);
assert.equal(res1.winner, "P2", "Trump minor must beat non-trump Ace");
assert.equal(res1.counters, 10, "Harvested counters should be 10 (Ace of Wands)");

// Trick with Major vs Trump Minor
const trick2 = [
  { player: "P1", card: { suit: "swords", rank: 1, is_major: false, title: "Ace of Swords (Trump)" } },
  { player: "P2", card: { is_major: true, rank: 19, title: "The Sun" } }
];
const res2 = Engine.evaluateTrick(trick2, "swords", testLadder, 1);
assert.equal(res2.winner, "P2", "Major Arcana must beat Trump Ace");

// Trick 12: Final Trick Climax Bonus (+10 pts)
const res12 = Engine.evaluateTrick(trick1, "swords", testLadder, 12);
assert.equal(res12.counters, 20, "Trick 12 must award +10 point climax bonus (10 + 10 = 20)");

// The Excuse (The Fool): never wins, banks to owner
const trickFool = [
  { player: "P1", card: { is_major: true, rank: 0, title: "The Fool" } },
  { player: "P2", card: { suit: "wands", rank: 5, is_major: false, title: "5 of Wands" } }
];
const resFool = Engine.evaluateTrick(trickFool, "wands", testLadder, 1);
assert.equal(resFool.winner, "P2", "The Fool never wins a trick");
assert.equal(resFool.excusePlayer, "P1", "The Fool banks to its player");

console.log("  ✓ Trick evaluation and climax bonus validated");

console.log("▶ Testing Section 7: Melds Detection (8 Melds)");

const meldHand = [
  { suit: "wands", rank: 14, is_major: false }, // King of Wands (Trump)
  { suit: "wands", rank: 13, is_major: false }, // Queen of Wands (Trump)
  { suit: "swords", rank: 13, is_major: false }, // Queen of Swords
  { suit: "pentacles", rank: 12, is_major: false }, // Knight of Pentacles -> Pinochle!
  { suit: "cups", rank: 2, is_major: false },
  { suit: "cups", rank: 3, is_major: false },
  { suit: "cups", rank: 4, is_major: false }, // Decan Trine of Cancer (2·3·4 Cups)!
  { is_major: true, rank: 0 },  // The Fool
  { is_major: true, rank: 1 },  // The Magician
  { is_major: true, rank: 21 }  // The World -> The Great Work!
];

const melds = Engine.detectMelds(meldHand, "wands", testLadder);
const meldIds = melds.map(m => m.id);

assert.ok(meldIds.includes("marriage_wands"), "Must detect Royal Marriage in Trump (40 pts)");
assert.equal(melds.find(m => m.id === "marriage_wands").value, 40);

assert.ok(meldIds.includes("pinochle"), "Must detect Pinochle (40 pts)");
assert.equal(melds.find(m => m.id === "pinochle").value, 40);

assert.ok(meldIds.includes("decan_trine_cancer"), "Must detect Decan Trine of Cancer (40 pts)");
assert.equal(melds.find(m => m.id === "decan_trine_cancer").value, 40);

assert.ok(meldIds.includes("arcana_trine"), "Must detect Arcana Trine (50 pts)");
assert.ok(meldIds.includes("the_great_work"), "Must detect The Great Work (100 pts)");

console.log("  ✓ Melds detection validated");

console.log("▶ Testing Section 8: Full Melee Match Simulation");

const playerDeck = [
  { card_id: 101, suit: "wands", rank: 1, is_major: false, title: "Ace of Wands" },
  { card_id: 102, suit: "wands", rank: 10, is_major: false, title: "10 of Wands" },
  { card_id: 103, suit: "wands", rank: 14, is_major: false, title: "King of Wands" },
  { card_id: 104, suit: "wands", rank: 13, is_major: false, title: "Queen of Wands" },
  { card_id: 105, suit: "cups", rank: 5, is_major: false, title: "5 of Cups" },
  { card_id: 106, suit: "cups", rank: 6, is_major: false, title: "6 of Cups" },
  { card_id: 107, suit: "swords", rank: 8, is_major: false, title: "8 of Swords" },
  { card_id: 108, suit: "swords", rank: 9, is_major: false, title: "9 of Swords" },
  { card_id: 109, suit: "pentacles", rank: 2, is_major: false, title: "2 of Pentacles" },
  { card_id: 110, is_major: true, rank: 0, title: "The Fool" },
  { card_id: 111, is_major: true, rank: 19, title: "The Sun" },
  { card_id: 112, is_major: true, rank: 21, title: "The World" }
];

const melee = Engine.createMelee("zone", 0, playerDeck, { zone_id: 0 }, { planets: mockPlanets, signVector: vecSolar });
assert.equal(melee.totalTricks, 12, "Melee must have 12 tricks");
assert.equal(melee.playerHand.length, 12, "Player hand must have 12 cards");
assert.equal(melee.guardianHand.length, 12, "Guardian hand must have 12 cards");
assert.equal(melee.trumpSuit, "wands", "Zone 0 (Aries) must have Wands as Trump");

// Simulate 12 tricks between Player AI and Guardian AI
let pScore = melee.playerScore;
let gScore = melee.guardianScore;
let currentLeader = melee.leader;

for (let t = 1; t <= 12; t++) {
  const pCard = Engine.GuardianAI.choose(melee.playerHand, melee.ledSuit, melee.trumpSuit, [], melee.arcanaLadder);
  melee.playerHand = melee.playerHand.filter(c => c.card_id !== pCard.card_id);

  const trick = [{ player: "player", card: pCard }];
  const ledSuit = pCard.is_major ? null : pCard.suit;

  const gCard = Engine.GuardianAI.choose(melee.guardianHand, ledSuit, melee.trumpSuit, trick, melee.arcanaLadder);
  melee.guardianHand = melee.guardianHand.filter(c => c.card_id !== gCard.card_id);
  trick.push({ player: "guardian", card: gCard });

  const result = Engine.evaluateTrick(trick, melee.trumpSuit, melee.arcanaLadder, t);
  if (result.winner === "player") {
    pScore += result.counters;
    currentLeader = "player";
  } else {
    gScore += result.counters;
    currentLeader = "guardian";
  }

  if (result.excusePlayer === "player") pScore += 10;
  if (result.excusePlayer === "guardian") gScore += 10;
}

assert.equal(melee.playerHand.length, 0, "All player cards played");
assert.equal(melee.guardianHand.length, 0, "All guardian cards played");
assert.ok(pScore >= 0 && gScore >= 0, "Scores calculated successfully");

console.log(`  ✓ 12-Trick Melee Simulation passed. Final Score -> Player: ${pScore} ⚔ Guardian: ${gScore}`);

// ── Section 8b: the simulation must be LEGAL and CONSERVING ─────────────────
// The bare "it ran to completion" assertions above cannot catch a filter bug —
// an engine that returns nonsense legal sets still empties both hands. These
// two invariants are what actually pin the rules down.
console.log("▶ Testing Section 8b: Melee legality + counter conservation");
{
  const m2 = Engine.createMelee("zone", 0, playerDeck, { zone_id: 0 }, { planets: mockPlanets, signVector: vecSolar });
  const dealt = [...m2.playerHand, ...m2.guardianHand].reduce((a, c) => a + Engine.counterValue(c), 0);
  let ph = [...m2.playerHand], gh = [...m2.guardianHand], harvested = 0;

  for (let t = 1; t <= 12; t++) {
    const pc = Engine.GuardianAI.choose(ph, null, m2.trumpSuit, [], m2.arcanaLadder);
    const pLegal = Engine.getLegalMoves(ph, null, m2.trumpSuit, [], m2.arcanaLadder);
    assert.ok(pLegal.some(x => x.card.card_id === pc.card_id && x.legal),
      `trick ${t}: leader played an ILLEGAL card (${pc.title})`);
    ph = ph.filter(c => c.card_id !== pc.card_id);

    const tr = [{ player: "player", card: pc }];
    const led = pc.is_major ? null : pc.suit;
    const gc = Engine.GuardianAI.choose(gh, led, m2.trumpSuit, tr, m2.arcanaLadder);
    const gLegal = Engine.getLegalMoves(gh, led, m2.trumpSuit, tr, m2.arcanaLadder);
    assert.ok(gLegal.some(x => x.card.card_id === gc.card_id && x.legal),
      `trick ${t}: follower played an ILLEGAL card (${gc.title})`);
    gh = gh.filter(c => c.card_id !== gc.card_id);
    tr.push({ player: "guardian", card: gc });

    harvested += Engine.evaluateTrick(tr, m2.trumpSuit, m2.arcanaLadder, t).counters;
  }
  // Every counter harvested came from a dealt card, plus the single +10 climax.
  assert.ok(harvested <= dealt + 10,
    `counters not conserved: harvested ${harvested} from ${dealt} dealt (+10 climax)`);
  console.log(`  ✓ 12 tricks, every play legal · ${harvested} counters harvested from ${dealt} dealt (+10 climax)`);
}

// ── Section 9: Majors are permitted, NEVER compelled ────────────────────────
// Regression guard. An earlier build compelled a Major on an Arcana lead, which
// let an opponent strip a player's Arcana onto a zero-counter trick.
console.log("▶ Testing Section 9: Majors permitted, never compelled");
{
  const ladder9 = { 0: 70, 16: 60, 19: 55, 21: 90 };
  const towerLed = [{ player: "x", card: { card_id: 900, is_major: true, rank: 16, title: "The Tower" } }];

  // (a) A minor is always a legal slough when a Major is led, even holding Majors.
  const mixed = [
    { card_id: 1, suit: "cups", rank: 3, is_major: false, title: "3 of Cups" },
    { card_id: 2, suit: "wands", rank: 5, is_major: false, title: "5 of Wands" }, // trump minor
    { card_id: 3, is_major: true, rank: 21, title: "The World" },
  ];
  const mMoves = Engine.getLegalMoves(mixed, null, "wands", towerLed, ladder9);
  for (const mv of mMoves.filter(x => !x.card.is_major)) {
    assert.ok(mv.legal, `Arcana lead must not compel: ${mv.card.title} should stay legal (${mv.reason || ""})`);
  }
  assert.ok(mMoves.find(x => x.card.card_id === 3).legal, "a beating Major stays permitted");

  // (b) Holding a beating Major never makes a minor illegal.
  assert.ok(mMoves.find(x => x.card.card_id === 1).legal,
    "holding The World must not force it — the 3 of Cups stays legal");

  // (c) The Excuse never counts as a Major that "could have beaten" the winner.
  //     Fool 70 looks higher than Tower 60, but it can never win a trick, so the
  //     Sun (55) must NOT be marked illegal for failing to beat.
  const foolCase = [
    { card_id: 4, is_major: true, rank: 0, title: "The Fool" },
    { card_id: 5, is_major: true, rank: 19, title: "The Sun" },
  ];
  const fMoves = Engine.getLegalMoves(foolCase, null, "wands", towerLed, ladder9);
  assert.ok(fMoves.find(x => x.card.rank === 0).legal, "The Excuse is always legal");
  assert.ok(fMoves.find(x => x.card.rank === 19).legal,
    "The Excuse must not count as a beating Major — The Sun must stay legal");

  // (d) But a genuine higher Major still binds a player who chooses to contest.
  const realHigher = [
    { card_id: 6, is_major: true, rank: 21, title: "The World" }, // 90 > 60, beats
    { card_id: 7, is_major: true, rank: 19, title: "The Sun" },   // 55 < 60, cannot
    { card_id: 8, suit: "cups", rank: 3, is_major: false, title: "3 of Cups" },
  ];
  const rMoves = Engine.getLegalMoves(realHigher, null, "wands", towerLed, ladder9);
  assert.ok(!rMoves.find(x => x.card.card_id === 7).legal,
    "contesting with a Major means contesting properly — the weaker Sun is illegal");
  assert.ok(rMoves.find(x => x.card.card_id === 8).legal,
    "...but the minor slough is still there, so no Major is ever forced");
  console.log("  ✓ Arcana lead compels nothing; the Excuse never counts as a beater");
}

console.log("ALL Arcana Trick Engine tests passed with 100% success!");
