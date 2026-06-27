/* Pure-math tests for AlchmChart. Run: `node src/alchm-chart/__tests__/math.test.js`
   No test runner required — exits non-zero on first failure. */
import assert from "node:assert/strict";
import {
  shortestSep, bodyVelocity, applyingState, aspectInfluence, enrichAspects,
  chartRuler, blendedSMES, footprintsFromMembers, poolPressure,
  dateFromThumb, thumbFromDate, ASPECTS,
} from "../math.js";

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("  ✓", name); };

console.log("AlchmChart math:");

t("shortestSep wraps the 0/360 seam", () => {
  assert.equal(shortestSep(359, 1), 2);
  assert.equal(shortestSep(10, 350), 20);
  assert.equal(shortestSep(0, 180), 180);
  assert.equal(shortestSep(100, 100), 0);
});

t("bodyVelocity recovers a known rate through the seam", () => {
  // synthetic body moving +12°/day, crossing 360→0 between samples
  const lonAt = (_b, d) => ((d.getTime() / 86400000) * 12) % 360;
  const v = bodyVelocity(lonAt, 5, new Date(30 * 86400000));
  assert.ok(Math.abs(v - 12) < 1e-6, `expected ~12, got ${v}`);
});

t("applyingState: faster body catching a slower one is applying, then separating", () => {
  // conjunction at angle 0: A behind B, A faster → closing in
  assert.equal(applyingState(10, 20, 5, 1, 0), "applying");
  // A ahead of B and pulling away
  assert.equal(applyingState(20, 10, 5, 1, 0), "separating");
  // equal speed → neither
  assert.equal(applyingState(10, 20, 3, 3, 0), "exact");
});

t("applyingState handles opposition direction correctly", () => {
  // sep just under 180 and widening toward exact opposition = applying
  assert.equal(applyingState(0, 175, 0, 2, 180), "applying");
  assert.equal(applyingState(0, 175, 2, 0, 180), "separating");
});

t("aspectInfluence is monotone in tightness and boosted when applying", () => {
  const conj = ASPECTS[0];
  const tightApplying = aspectInfluence(conj, 0, "applying");
  const looseApplying = aspectInfluence(conj, 6, "applying");
  const tightSeparating = aspectInfluence(conj, 0, "separating");
  assert.ok(tightApplying > looseApplying, "tighter ⇒ stronger");
  assert.ok(tightApplying >= tightSeparating, "applying ⇒ ≥ separating");
  assert.ok(tightApplying <= 1 && looseApplying >= 0, "stays in [0,1]");
});

t("enrichAspects finds a trine and tags direction", () => {
  const positions = [{ body: 0, eclLon: 10 }, { body: 4, eclLon: 130 }];
  const asp = enrichAspects(positions, { 0: 1, 4: 0.5 });
  assert.equal(asp.length, 1);
  assert.equal(asp[0].type, "trine");
  assert.ok(["applying", "separating", "exact"].includes(asp[0].state));
  assert.ok(asp[0].influence >= 0 && asp[0].influence <= 1);
});

t("chartRuler maps the rising sign to its traditional ruler", () => {
  assert.equal(chartRuler(5), 4); // 5° Aries → Mars(4)
  assert.equal(chartRuler(125), 0); // 5° Leo → Sun(0)
  assert.equal(chartRuler(null), 0); // fallback Sun
});

t("blendedSMES normalizes to 100 and caps body weight at 12", () => {
  const chart = {
    asc: 5,
    positions: [
      { body: 0, sign: 4, house: 1, dignity: { score: 5 }, eclLon: 125 }, // Sun, Leo, angular, domicile, ruler
      { body: 1, sign: 3, house: 4, dignity: { score: 0 }, eclLon: 95 }, // Moon, Cancer, angular
      { body: 6, sign: 9, house: 6, dignity: { score: 0 }, eclLon: 285 }, // Saturn, cadent
    ],
  };
  const s = blendedSMES(chart);
  const total = s.pct.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 100) < 1e-6, `pct sums to ${total}`);
  for (const id in s.weights) assert.ok(s.weights[id] <= 12, "cap respected");
  // Sun is chart ruler + light + angular → must out-weigh cadent Saturn
  assert.ok(s.weights[0] > s.weights[6]);
});

t("blendedSMES falls back to uniform 25% on an empty chart", () => {
  const s = blendedSMES({ asc: 0, positions: [] });
  assert.deepEqual(s.pct, [25, 25, 25, 25]);
});

t("footprintsFromMembers clusters across the 0/360 wrap", () => {
  // members straddling Pisces→Aries (≈358° and ≈3°)
  const star = (hip) => ({ 1: [1, "a", 358, 0], 2: [2, "b", 2, 0], 3: [3, "c", 4, 0] })[hip];
  const eq2ecl = (ra) => ra; // identity for the test
  const fp = footprintsFromMembers([{ constId: 0, members: [1, 2, 3] }], star, eq2ecl);
  // circular mean of 358,2,4 ≈ 1.3°, not ~121°
  assert.ok(shortestSep(fp[0].center, 1.3) < 3, `center ${fp[0].center}`);
});

t("poolPressure: floor keeps high-energy pools alive, top normalizes to 1", () => {
  const chart = {
    asc: 5,
    positions: [
      { body: 0, sign: 4, house: 1, dignity: { score: 5 }, eclLon: 125 },
      { body: 4, sign: 0, house: 10, dignity: { score: 5 }, eclLon: 8 },
    ],
  };
  const smes = blendedSMES(chart);
  const pools = [{ constId: 0, pair: [0, 3] }, { constId: 1, pair: [1, 2] }];
  const fps = { 0: { center: 8, half: 12 }, 1: { center: 200, half: 12 } };
  const p = poolPressure(chart, pools, fps, smes);
  const top = Math.max(p[0].pressure, p[1].pressure);
  assert.ok(Math.abs(top - 1) < 1e-9, "a pool reads full");
  for (const id in p) {
    assert.ok(p[id].pressure >= 0, "never negative");
    assert.ok(p[id].raw >= 0, "raw never negative");
  }
});

t("scrubber thumb↔date round-trips and stays put across zoom", () => {
  const anchor = new Date(1_700_000_000_000);
  const d = dateFromThumb(0.75, "month", anchor);
  assert.ok(Math.abs(thumbFromDate(d, "month", anchor) - 0.75) < 1e-9);
  // a date inside the day window maps to the same instant regardless of zoom label
  const near = new Date(anchor.getTime() + 3_600_000); // +1h
  assert.equal(+dateFromThumb(thumbFromDate(near, "day", anchor), "day", anchor), +near);
});

console.log(`\n${passed} passed\n`);
