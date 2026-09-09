/* Pure-math tests for AlchmChart thermo-kinetics engine.
   Run: `node src/alchm-chart/__tests__/thermo-kinetics.test.js`
   No test runner required — exits non-zero on first failure. */
import assert from "node:assert/strict";
import {
  ALCHEMICAL_PILLARS,
  CANONICAL_TOKENS,
  resolveAlchemicalPillar,
  computeThermodynamics,
  computeKineticSpectrum,
  computeTokenizedQuantities,
  computeMomentTelemetry,
  computePlanetaryEvents,
} from "../thermo-kinetics.js";

let passed = 0;
const t = (name, fn) => {
  fn();
  passed++;
  console.log("  ✓", name);
};

console.log("AlchmChart thermo-kinetics:");

t("14 canonical Alchemical Pillars defined with valid properties", () => {
  assert.equal(ALCHEMICAL_PILLARS.length, 14);
  for (const p of ALCHEMICAL_PILLARS) {
    assert.ok(p.id >= 1 && p.id <= 14);
    assert.ok(p.name);
    assert.ok(p.sigil);
    assert.ok(p.description);
    assert.ok(p.effects);
  }
});

t("resolveAlchemicalPillar resolves Fire/Earth dominance to Calcination", () => {
  // Fire dominant (40%), Earth secondary (30%), Water (15%), Air (15%)
  const pillar = resolveAlchemicalPillar([40, 15, 30, 15]);
  assert.equal(pillar.id, 7);
  assert.equal(pillar.name, "Calcination");
  assert.equal(pillar.sigil, "🜂");
});

t("resolveAlchemicalPillar resolves Water/Earth to Solution", () => {
  const pillar = resolveAlchemicalPillar([10, 45, 30, 15]);
  assert.equal(pillar.id, 1);
  assert.equal(pillar.name, "Solution");
});

t("resolveAlchemicalPillar resolves equal distribution to Rectification", () => {
  const pillar = resolveAlchemicalPillar([25, 25, 25, 25]);
  assert.equal(pillar.id, 6);
  assert.equal(pillar.name, "Rectification");
});

t("computeThermodynamics calculates Heat, Entropy, Reactivity, and Free Energy ΔG", () => {
  const pillar = ALCHEMICAL_PILLARS.find((p) => p.id === 7); // Calcination
  const res = computeThermodynamics([35, 20, 30, 15], pillar);
  assert.ok(typeof res.heat === "number" && res.heat > 0);
  assert.ok(typeof res.entropy === "number" && res.entropy > 0);
  assert.ok(typeof res.reactivity === "number" && res.reactivity > 0);
  assert.ok(typeof res.freeEnergy === "number");
  assert.ok(res.potencyRating);
});

t("computeKineticSpectrum populates all 12 canonical consciousness axes", () => {
  const mockChart = {
    byBody: {
      0: { body: 0, sign: 5, degInSign: 18, house: 10, dignity: { score: 2, label: "Peregrine" } },
      1: { body: 1, sign: 3, degInSign: 10, house: 4, dignity: { score: 5, label: "Domicile" } },
      2: { body: 2, sign: 5, degInSign: 2, house: 11, retrograde: true, dignity: { score: 5, label: "Domicile" } },
    },
    positions: [],
  };
  const velocities = { 0: 0.98, 1: 12.5, 2: -0.45 };
  const smes = { weights: { 0: 6.0, 1: 5.0, 2: 4.0 } };

  const { axes, overallKinetic } = computeKineticSpectrum(mockChart, velocities, smes);
  assert.equal(axes.length, 12);
  assert.ok(overallKinetic >= 20 && overallKinetic <= 100);

  const merc = axes.find((a) => a.id === "mercurialVelocity");
  assert.ok(merc);
  assert.equal(merc.status, "retrograde ℞");

  const align = axes.find((a) => a.id === "kineticAlignment");
  assert.ok(align);
  assert.equal(align.val, overallKinetic);
});

t("computeTokenizedQuantities conserves total yield and enforces gas floor", () => {
  const { tokens, totalYield, baselineBudget, gasFloor } = computeTokenizedQuantities([35, 20, 25, 20]);
  assert.equal(tokens.length, 4);
  assert.equal(baselineBudget, 24.0);
  assert.equal(gasFloor, 0.5);

  const sum = Number(tokens.reduce((acc, t) => acc + t.amount, 0).toFixed(4));
  assert.equal(sum, totalYield);

  for (const tok of tokens) {
    assert.ok(tok.amount >= gasFloor, `${tok.name} must be >= gas floor`);
  }

  // Matter token must be marked as anti-glut damped
  const matterTok = tokens.find((t) => t.name === "MATTER");
  assert.equal(matterTok.damped, true);
});

t("computeMomentTelemetry derives Lunation, Decan, and Hour Ruler", () => {
  const mockChart = {
    positions: [
      { body: 0, sign: 5, degInSign: 18, eclLon: 168 }, // Sun in Virgo 18°
      { body: 1, sign: 3, degInSign: 10, eclLon: 100 }, // Moon in Cancer 10°
    ],
    byBody: {
      0: { body: 0, sign: 5, signName: "Virgo", signGlyph: "♍", degInSign: 18, eclLon: 168 },
      1: { body: 1, sign: 3, signName: "Cancer", signGlyph: "♋", degInSign: 10, eclLon: 100 },
    },
  };
  const testDate = new Date("2026-09-09T17:00:00Z");
  const tel = computeMomentTelemetry(mockChart, testDate);

  assert.ok(tel.moon);
  assert.ok(tel.moon.phaseName);
  assert.ok(tel.moon.illumination >= 0 && tel.moon.illumination <= 100);

  // Exact check for astronomical moment of Sep 9, 2026:
  // Sun at Virgo ~17° (167.07°), Moon at Leo ~28.8° (148.82°), elongation 341.75° → Waning Crescent 🌘
  const sep9Chart = {
    byBody: {
      0: { body: 0, sign: 5, signName: "Virgo", signGlyph: "♍", degInSign: 17, eclLon: 167.07 },
      1: { body: 1, sign: 4, signName: "Leo", signGlyph: "♌", degInSign: 28.8, eclLon: 148.82 },
    },
  };
  const sep9Tel = computeMomentTelemetry(sep9Chart, testDate);
  assert.equal(sep9Tel.moon.phaseName, "Waning Crescent");
  assert.equal(sep9Tel.moon.phaseGlyph, "🌘");
  assert.ok(sep9Tel.moon.illumination <= 4 && sep9Tel.moon.illumination >= 2, `Expected ~3% illumination, got ${sep9Tel.moon.illumination}%`);

  // Conjunction / New Moon check (< 6° elongation)
  const newMoonChart = {
    byBody: {
      0: { body: 0, eclLon: 170 },
      1: { body: 1, eclLon: 172 }, // 2° elongation
    },
  };
  const newMoonTel = computeMomentTelemetry(newMoonChart, testDate);
  assert.equal(newMoonTel.moon.phaseName, "New Moon");
  assert.equal(newMoonTel.moon.phaseGlyph, "🌑");

  assert.ok(tel.solarDecan);
  assert.equal(tel.solarDecan.signName, "Virgo");
  assert.equal(tel.solarDecan.decanRoman, "II");
  assert.ok(tel.solarDecan.card);

  assert.ok(tel.dayRuler);
  assert.ok(tel.hourRuler);
  assert.ok(tel.modalities);
  assert.ok(tel.polarities);
});

t("computePlanetaryEvents computes Rise, Culmination, Set, and Aspect Chronology", () => {
  const mockChart = {
    positions: [
      { body: 0, name: "Sun", glyph: "☉", eclLon: 167.1, alt: 52.7, az: 195.4, up: true, ra: 168.1, dec: 4.8 },
      { body: 1, name: "Moon", glyph: "☽", eclLon: 148.8, alt: 51.1, az: 220.2, up: true, ra: 151.2, dec: 10.5 },
      { body: 2, name: "Mercury", glyph: "☿", eclLon: 155.0, alt: 48.0, az: 200.0, up: true },
      { body: 3, name: "Venus", glyph: "♀", eclLon: 210.0, alt: 35.0, az: 160.0, up: true },
      { body: 4, name: "Mars", glyph: "♂", eclLon: 108.0, alt: -12.0, az: 40.0, up: false },
      { body: 5, name: "Jupiter", glyph: "♃", eclLon: 80.0, alt: -25.0, az: 55.0, up: false },
      { body: 6, name: "Saturn", glyph: "♄", eclLon: 355.0, alt: -43.1, az: 75.0, up: false },
    ],
    byBody: {
      0: { body: 0, name: "Sun", glyph: "☉", eclLon: 167.1 },
      1: { body: 1, name: "Moon", glyph: "☽", eclLon: 148.8 },
      6: { body: 6, name: "Saturn", glyph: "♄", eclLon: 355.0 },
    },
    aspects: [
      { a: 0, b: 6, type: "opposition", orb: 7.9, state: "applying", typeSymbol: "☍", influence: 0.8 },
      { a: 0, b: 1, type: "conjunction", orb: 18.3, state: "separating", typeSymbol: "☌", influence: 0.3 },
    ],
  };
  const testDate = new Date("2026-09-09T18:00:00Z");
  const observer = { lat: 40.7128, lon: -74.006 }; // NYC

  const { horizons, aspectTimeline } = computePlanetaryEvents(mockChart, observer, testDate);

  assert.equal(horizons.length, 7, "All 7 classical planets must have horizon telemetry");
  for (const h of horizons) {
    assert.ok(h.name, "Horizon item must have name");
    assert.ok(h.riseTime, "Must have rise time");
    assert.ok(h.transitTime, "Must have culmination/transit time");
    assert.ok(h.setTime, "Must have set time");
    assert.ok(h.nextEvent, "Must have countdown string");
    assert.equal(typeof h.isRisen, "boolean");
  }

  // Sun check (risen in afternoon sky: positive percentage between 0 and 100)
  const sunH = horizons.find((h) => h.body === 0);
  assert.equal(sunH.name, "Sun");
  assert.equal(sunH.isRisen, true);
  assert.ok(sunH.progression >= 0 && sunH.progression <= 100, `Sun progression must be between 0 and 100, got ${sunH.progression}`);
  assert.ok(sunH.progressionText.startsWith("+"), `Sun progression text must start with +, got ${sunH.progressionText}`);
  assert.ok(sunH.progressionFraction >= 0 && sunH.progressionFraction <= 1);

  // Saturn check (subterranean in mid-afternoon: negative progression between -100 and -1)
  const satH = horizons.find((h) => h.body === 6);
  assert.equal(satH.name, "Saturn");
  assert.equal(satH.isRisen, false);
  assert.ok(satH.progression >= -100 && satH.progression <= -1, `Saturn progression must be between -100 and -1, got ${satH.progression}`);
  assert.ok(satH.progressionText.startsWith("-"), `Saturn progression text must start with -, got ${satH.progressionText}`);
  assert.ok(satH.progressionFraction >= 0 && satH.progressionFraction <= 1);

  // Aspect timeline check
  assert.ok(aspectTimeline.length >= 1, "Should contain aspect timeline entries");
  const topAsp = aspectTimeline[0];
  assert.ok(topAsp.pairName.includes("Sun"));
  assert.ok(topAsp.timeText);
  assert.ok(topAsp.orbText);
});

console.log(`\n${passed} passed\n`);
