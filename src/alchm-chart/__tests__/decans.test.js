/* Pure tests for the decan → Minor Arcana mapping (Golden Dawn).
   Run: `node src/alchm-chart/__tests__/decans.test.js`
   No test runner required — exits non-zero on first failure. */
import assert from "node:assert/strict";
import { decanCard, decanCardsFor } from "../decans.js";

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("  ✓", name); };

console.log("AlchmChart decans:");

// Planet indices: Sun 0, Moon 1, Mercury 2, Venus 3, Mars 4, Jupiter 5, Saturn 6.
const SUN = 0, MOON = 1, MERCURY = 2, VENUS = 3, MARS = 4, JUPITER = 5, SATURN = 6;

t("Aries decans run 2–4 of Wands with Mars/Sun/Venus rulers", () => {
  const a1 = decanCard(0, 3);   // Aries 0–10°
  assert.equal(a1.card, "2 of Wands");
  assert.equal(a1.title, "Dominion");
  assert.equal(a1.ruler, MARS);
  assert.deepEqual(a1.range, [0, 10]);

  const a2 = decanCard(0, 15);  // Aries 10–20°
  assert.equal(a2.card, "3 of Wands");
  assert.equal(a2.ruler, SUN);

  const a3 = decanCard(0, 27);  // Aries 20–30°
  assert.equal(a3.card, "4 of Wands");
  assert.equal(a3.ruler, VENUS);
});

t("fixed signs run 5–7; Leo 10–20° = 6 of Wands · Victory · Jupiter", () => {
  const leo2 = decanCard(4, 12);
  assert.equal(leo2.card, "6 of Wands");
  assert.equal(leo2.title, "Victory");
  assert.equal(leo2.ruler, JUPITER);
});

t("mutable signs run 8–10; Pisces 20–30° = 10 of Cups · Mars", () => {
  const pi3 = decanCard(11, 29);
  assert.equal(pi3.card, "10 of Cups");
  assert.equal(pi3.title, "Perfected Success");
  assert.equal(pi3.ruler, MARS);
});

t("suits track the triplicity (Fire/Earth/Air/Water)", () => {
  assert.equal(decanCard(0, 5).suit, "Wands");      // Aries — Fire
  assert.equal(decanCard(1, 5).suit, "Pentacles");  // Taurus — Earth
  assert.equal(decanCard(2, 5).suit, "Swords");     // Gemini — Air
  assert.equal(decanCard(3, 5).suit, "Cups");       // Cancer — Water
});

t("ESMS id matches the suit's element", () => {
  assert.equal(decanCard(0, 5).esms, 0); // Wands → Spirit/Fire
  assert.equal(decanCard(3, 5).esms, 1); // Cups → Essence/Water
  assert.equal(decanCard(1, 5).esms, 2); // Pentacles → Matter/Earth
  assert.equal(decanCard(2, 5).esms, 3); // Swords → Substance/Air
});

t("decan rulers follow continuous Chaldean order across the wheel", () => {
  // Aries 1 starts at Mars; the 36 faces cycle Mars·Sun·Venus·Mercury·Moon·Saturn·Jupiter.
  const expected = [MARS, SUN, VENUS, MERCURY, MOON, SATURN, JUPITER];
  for (let abs = 0; abs < 36; abs++) {
    const sign = Math.floor(abs / 3), decan = abs % 3;
    const dc = decanCard(sign, decan * 10 + 5);
    assert.equal(dc.ruler, expected[abs % 7], `decan ${abs} ruler`);
  }
});

t("36 decans yield exactly the 36 distinct Minor pips (4 suits × 2–10)", () => {
  const seen = new Set();
  for (let abs = 0; abs < 36; abs++) {
    const dc = decanCard(Math.floor(abs / 3), (abs % 3) * 10 + 5);
    assert.ok(dc.rank >= 2 && dc.rank <= 10, "rank in 2..10");
    seen.add(dc.card);
  }
  assert.equal(seen.size, 36);
});

t("degree is clamped into the sign and snaps to the right decan", () => {
  assert.equal(decanCard(0, -3).decanIndex, 0);
  assert.equal(decanCard(0, 9.99).decanIndex, 0);
  assert.equal(decanCard(0, 10).decanIndex, 1);
  assert.equal(decanCard(0, 30).decanIndex, 2);   // clamped to last decan
  assert.equal(decanCard(0, 999).decanIndex, 2);
});

t("sign normalizes out of range", () => {
  assert.equal(decanCard(12, 5).card, decanCard(0, 5).card);
  assert.equal(decanCard(-1, 5).card, decanCard(11, 5).card);
});

t("decanCardsFor maps an array of positions", () => {
  const rows = decanCardsFor([{ sign: 0, degInSign: 3 }, { sign: 4, degInSign: 12 }]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].card.card, "2 of Wands");
  assert.equal(rows[1].card.card, "6 of Wands");
});

console.log(`\n${passed} passed`);
