/* Pure tests for the agent deck builder (mirror of server mint_deck).
   Run: `node src/alchm-chart/__tests__/deck.test.js` */
import assert from "node:assert/strict";
import { agentDeck, TRUMP_NAMES, rankName } from "../deck.js";

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("  ✓", name); };
const SUN = 0, MOON = 1, MERCURY = 2, MARS = 4, JUPITER = 5;
const arc = (deg) => Math.round(deg * 60);

console.log("Agent deck:");

// A small chart: Cancer rising (asc 3*1800+660 = 6060) → chart ruler = Moon.
const ASC = 3 * 1800 + arc(11); // Cancer 11°
const MC = 11 * 1800 + arc(2);  // Pisces 2° (far from the test placements)
const chart = [
  { body: MOON, sign: 8, arcMin: arc(14), retrograde: false, dignity: 0 },  // Sag 14° — the chart RULER
  { body: SUN, sign: 11, arcMin: arc(23), retrograde: false, dignity: 0 },  // Pisces 23° — mid-decan pip
  { body: MARS, sign: 9, arcMin: arc(28), retrograde: false, dignity: 5 },  // Capricorn 28° (exalted) — not angular here
  { body: MERCURY, sign: 2, arcMin: arc(15), retrograde: true, dignity: 5 },// Gemini 15° (domicile) → court (sign ruler)
];

t("yields 20 cards (a minor + a major per placement)", () => {
  const d = agentDeck(chart, ASC, MC);
  assert.equal(d.length, chart.length * 2);
  assert.equal(d.filter((c) => c.kind === "minor").length, chart.length);
  assert.equal(d.filter((c) => c.kind === "major").length, chart.length);
});

t("the chart ruler mints the Ace of its sign's suit", () => {
  const d = agentDeck(chart, ASC, MC);
  const moonMinor = d.find((c) => c.kind === "minor" && c.body === MOON);
  assert.equal(moonMinor.rank, 1);
  assert.equal(moonMinor.name, "Ace of Wands"); // Sagittarius → Fire → Wands
  assert.equal(moonMinor.role, "chart ruler");
});

t("a plain mid-decan placement is its decan pip", () => {
  const d = agentDeck(chart, ASC, MC);
  const sunMinor = d.find((c) => c.kind === "minor" && c.body === SUN);
  // Pisces (mutable) 20–30° → 10 of Cups, Lord of Perfected Success, ruler Mars
  assert.equal(sunMinor.name, "10 of Cups");
  assert.equal(sunMinor.role, "decan pip");
  assert.deepEqual(sunMinor.decan, [20, 30]);
  assert.equal(sunMinor.decanRuler, MARS);
  assert.equal(sunMinor.lord, "Perfected Success");
});

t("a sign-ruling body is elevated to a court by dignity", () => {
  const d = agentDeck(chart, ASC, MC);
  const merc = d.find((c) => c.kind === "minor" && c.body === MERCURY);
  // Mercury in Gemini = domicile (dignity 5) and its own sign's ruler → King
  assert.equal(merc.rank, 14);
  assert.equal(merc.name, "King of Swords"); // Gemini → Air → Swords
  assert.equal(merc.retro, true);
});

t("each placement also mints its planet's Major trump", () => {
  const d = agentDeck(chart, ASC, MC);
  const sunMajor = d.find((c) => c.kind === "major" && c.body === SUN);
  assert.equal(sunMajor.name, TRUMP_NAMES[SUN]); // "The Sun"
  assert.equal(sunMajor.trump, true);
  const marsMajor = d.find((c) => c.kind === "major" && c.body === MARS);
  assert.equal(marsMajor.name, "The Tower");
  assert.equal(marsMajor.suit, "Wands"); // Mars biased suit
});

t("rankName labels the court/ace ranks", () => {
  assert.equal(rankName(1), "Ace");
  assert.equal(rankName(11), "Page");
  assert.equal(rankName(14), "King");
  assert.equal(rankName(6), "6");
});

console.log(`\n${passed} passed`);
