/* ============================================================
   AlchmChart — pure compute core
   ============================================================
   DOM-free, chain-free, globals-free. Every number the chart shows
   originates here, so it is unit-testable in isolation (run
   `node src/alchm-chart/__tests__/math.test.js`).

   The four alchemical quantities (ESMS) ARE the four elements:
     0 = Spirit   (Fire)   1 = Essence  (Water)
     2 = Matter   (Earth)  3 = Substance (Air)

   Formulas here were adversarially reviewed; the two fixes that
   matter are called out inline:
     • blended weight uses a POSITIVE dignity factor (a debilitated
       planet must not flip the sign of its own contribution);
     • pool coverage uses a SHARED gaussian width so the 12 bars
       are comparable.
   ============================================================ */

// ── element / sign tables (mirror astro-weather.js verbatim) ───────────────
// triplicity cycle by sign % 4
const ELEMENTS = ["Fire", "Earth", "Air", "Water"];
export const ESMS_OF_ELEMENT = { Fire: 0, Water: 1, Earth: 2, Air: 3 };
const ELEMENT_OF_ESMS = ["Fire", "Water", "Earth", "Air"];

const SIGN_RULERS = [4, 3, 2, 1, 0, 2, 3, 9, 5, 6, 7, 8];
const PLANET_SUITS = ["wands", "cups", "swords", "cups", "wands", "wands", "pentacles", "swords", "cups", "swords"];
const SUIT_ELEMENT = { wands: "Fire", cups: "Water", swords: "Air", pentacles: "Earth" };

// The 5 Ptolemaic majors with the game's fixed orbs + per-type influence weight.
export const ASPECTS = [
  { type: "conjunction", angle: 0, glyph: "☌", orb: 8, w: 1.0 },
  { type: "sextile", angle: 60, glyph: "⚹", orb: 4, w: 0.5 },
  { type: "square", angle: 90, glyph: "□", orb: 6, w: 0.8 },
  { type: "trine", angle: 120, glyph: "△", orb: 6, w: 0.8 },
  { type: "opposition", angle: 180, glyph: "☍", orb: 8, w: 0.9 },
];

export const DEFAULT_WEIGHTS = { chartRuler: 3, lights: 2, angular: 1.5, cap: 12 };
const APPLYING_BONUS = 1.15;
const COVERAGE_SIGMA = 10; // deg — SHARED kernel width, so pool coverage is comparable
const COVERAGE_NORM = 6.0; // ~two heavy transits saturate coverage
const PRESSURE_FLOOR = 0.35; // residual pressure when no transit lights a pool

// ── small helpers ──────────────────────────────────────────────────────────
export const n360 = (d) => ((d % 360) + 360) % 360;
export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const clamp01 = (x) => clamp(x, 0, 1);
const ELEMENT_OF_SIGN = (sign) => ELEMENTS[(((sign % 12) + 12) % 12) % 4];
const planetElement = (body) => (body >= 10 ? "Water" : SUIT_ELEMENT[PLANET_SUITS[body]] || "Fire");

/** Shortest angular separation in [0,180]. */
export function shortestSep(lonA, lonB) {
  let d = Math.abs(n360(lonA) - n360(lonB));
  if (d > 180) d = 360 - d;
  return d;
}
/** Signed delta lonA→lonB folded to (-180,180]. */
function signedDelta(lonA, lonB) {
  return ((n360(lonB) - n360(lonA) + 540) % 360) - 180;
}

/** Elemental composition (%) for a body in a sign at a dignity — astro-weather port. */
export function elementalComposition(body, sign, dignityScore) {
  const comp = { Fire: 12, Water: 12, Earth: 12, Air: 12 };
  comp[ELEMENT_OF_SIGN(sign)] += 40;
  comp[planetElement(body)] += 24;
  comp[ELEMENT_OF_SIGN(sign)] += Math.max(0, dignityScore || 0) * 2;
  const sum = comp.Fire + comp.Water + comp.Earth + comp.Air;
  return {
    Fire: (comp.Fire / sum) * 100,
    Water: (comp.Water / sum) * 100,
    Earth: (comp.Earth / sum) * 100,
    Air: (comp.Air / sum) * 100,
  };
}
/** {Fire,Water,Earth,Air} → [Spirit,Essence,Matter,Substance]. */
export const compToEsms = (c) => [c.Fire, c.Water, c.Earth, c.Air];

// ── velocity (signed deg/day) ───────────────────────────────────────────────
/**
 * Central-difference velocity. `lonAt(body, date)` returns ecliptic longitude (deg).
 * ε defaults to 0.5d (0.25d for the Moon, which moves ~13°/day).
 */
export function bodyVelocity(lonAt, body, date, eps) {
  const e = eps != null ? eps : body === 1 ? 0.25 : 0.5;
  const ms = e * 86400000;
  const before = lonAt(body, new Date(date.getTime() - ms));
  const after = lonAt(body, new Date(date.getTime() + ms));
  return signedDelta(before, after) / (2 * e);
}

/**
 * Applying vs separating from velocities (no extra ephemeris probes).
 * sep changes at rate sign(diff)·(vB−vA); distance-to-exact shrinks ⇒ applying.
 * Returns 'applying' | 'separating' | 'exact'.
 */
export function applyingState(lonA, lonB, vA, vB, angle) {
  const diff = signedDelta(lonA, lonB); // (-180,180]
  const sep = Math.abs(diff);
  const dSep = Math.sign(diff || 1) * (vB - vA); // d(sep)/dt
  const dDist = Math.sign(sep - angle || 1) * dSep; // d|sep-angle|/dt
  if (Math.abs(dDist) < 0.01) return "exact"; // station / standoff → neither
  return dDist < 0 ? "applying" : "separating";
}

/** Influence 0..1 = aspectWeight · orbTightness · applyingBonus. */
export function aspectInfluence(asp, orb, state) {
  const tight = clamp01(1 - orb / asp.orb);
  const bonus = state === "applying" ? APPLYING_BONUS : 1.0;
  const w = typeof asp.w === "number" ? asp.w : 0.5; // NaN-safe default
  return clamp01(w * tight * bonus);
}

/**
 * All major aspects among positions [{body,eclLon}], enriched with direction +
 * influence. `velByBody` maps body→deg/day (omit ⇒ every aspect 'exact').
 */
export function enrichAspects(positions, velByBody) {
  const vel = velByBody || {};
  const out = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      const A = positions[i], B = positions[j];
      const sep = shortestSep(A.eclLon, B.eclLon);
      for (const asp of ASPECTS) {
        const orb = Math.abs(sep - asp.angle);
        if (orb <= asp.orb) {
          const state = applyingState(A.eclLon, B.eclLon, vel[A.body] || 0, vel[B.body] || 0, asp.angle);
          out.push({
            a: A.body, b: B.body, type: asp.type, glyph: asp.glyph,
            orb: +orb.toFixed(2), exact: orb < 1, applying: state === "applying",
            state, influence: +aspectInfluence(asp, orb, state).toFixed(4),
          });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Transit-to-natal aspects: each transiting body vs each (fixed) natal body.
 * Natal is stationary, so the transiting body's velocity alone drives applying/
 * separating. `velByBody` maps the TRANSITING body → deg/day. Sorted tightest-first.
 */
export function transitAspects(transit, natal, velByBody) {
  const vel = velByBody || {};
  const out = [];
  for (const T of transit) {
    for (const N of natal) {
      const sep = shortestSep(T.eclLon, N.eclLon);
      for (const asp of ASPECTS) {
        const orb = Math.abs(sep - asp.angle);
        if (orb <= asp.orb) {
          const state = applyingState(T.eclLon, N.eclLon, vel[T.body] || 0, 0, asp.angle);
          out.push({
            t: T.body, n: N.body, type: asp.type, glyph: asp.glyph,
            orb: +orb.toFixed(2), exact: orb < 1, applying: state === "applying",
            state, influence: +aspectInfluence(asp, orb, state).toFixed(4),
          });
          break;
        }
      }
    }
  }
  return out.sort((a, b) => a.orb - b.orb);
}

// ── chart ruler + blended SMES ──────────────────────────────────────────────
export function chartRuler(ascDeg) {
  if (ascDeg == null || !isFinite(ascDeg)) return 0; // anchor to Sun if no Asc
  return SIGN_RULERS[Math.floor(n360(ascDeg) / 30) % 12];
}

const houseClass = (house) =>
  house == null ? "succedent"
    : [1, 4, 7, 10].includes(house) ? "angular"
      : [2, 5, 8, 11].includes(house) ? "succedent" : "cadent";
const SAL1_BY_CLASS = { angular: 1.0, succedent: 0.6, cadent: 0.35 };

/** The locked stacked blend, capped. Dignity enters as a POSITIVE factor. */
export function blendedBodyWeight(pos, rulerBody, weights) {
  const W = weights || DEFAULT_WEIGHTS;
  const cls = houseClass(pos.house);
  const dignScore = pos.dignity && typeof pos.dignity.score === "number" ? pos.dignity.score : 0;
  const dignFactor = clamp(1 + 0.08 * dignScore, 0.6, 1.4); // FIX: never negative
  const sal1 = SAL1_BY_CLASS[cls] * dignFactor;
  const sal2 =
    (pos.body === rulerBody ? W.chartRuler : 1) *
    (pos.body === 0 || pos.body === 1 ? W.lights : 1) *
    (cls === "angular" ? W.angular : 1);
  return Math.min(sal1 * sal2, W.cap);
}

/**
 * Chart-wide blended SMES. Returns {raw:[4], pct:[4], weights:{body:w}, ruler}.
 * `compOf(body,sign,dignityScore)` defaults to the bundled elementalComposition.
 */
export function blendedSMES(chart, weights, compOf) {
  const comp = compOf || elementalComposition;
  const ruler = chartRuler(chart.asc);
  const raw = [0, 0, 0, 0];
  const wByBody = {};
  for (const p of chart.positions) {
    const w = blendedBodyWeight(p, ruler, weights);
    wByBody[p.body] = w;
    if (w <= 0) continue;
    const esms = compToEsms(comp(p.body, p.sign, p.dignity ? p.dignity.score : 0));
    for (let e = 0; e < 4; e++) raw[e] += w * esms[e];
  }
  const sum = raw[0] + raw[1] + raw[2] + raw[3];
  const pct = sum > 0 ? raw.map((r) => (r / sum) * 100) : [25, 25, 25, 25];
  return { raw, pct, weights: wByBody, ruler };
}

// ── constellation footprints (visual + coverage) ────────────────────────────
/** Circular mean of degrees. */
function circularMean(degs) {
  let x = 0, y = 0;
  for (const d of degs) { x += Math.cos((d * Math.PI) / 180); y += Math.sin((d * Math.PI) / 180); }
  return n360((Math.atan2(y, x) * 180) / Math.PI);
}
/**
 * Footprint per pool from member-star ecliptic longitudes.
 * `pools` = [{constId|id, members:[hip]}], `starByHip(hip)→[hip,name,ra,dec,mag]`,
 * `eq2ecl(ra,dec)→lon`. Outliers (>45° off centre) are dropped, then recomputed.
 */
export function footprintsFromMembers(pools, starByHip, eq2ecl) {
  const out = {};
  for (const pool of pools) {
    const id = pool.constId != null ? pool.constId : pool.id;
    const lons = [];
    for (const hip of pool.members || []) {
      const s = starByHip(hip);
      if (!s) continue;
      lons.push(eq2ecl(s[2], s[3]));
    }
    if (!lons.length) { out[id] = { constId: id, center: 0, half: 15, span: 30, members: 0 }; continue; }
    let center = circularMean(lons);
    const kept = lons.filter((l) => shortestSep(l, center) <= 45);
    if (kept.length >= 2) center = circularMean(kept);
    const used = kept.length ? kept : lons;
    let half = 0;
    for (const l of used) half = Math.max(half, shortestSep(l, center));
    half = clamp(half + 2, 6, 60); // ±2° pad, sane bounds
    out[id] = { constId: id, center, half, span: half * 2, members: used.length };
  }
  return out;
}

// ── pool pressure (combined: element-energy × transit-coverage × dignity) ────
const gauss = (x, sigma) => Math.exp(-(x * x) / (2 * sigma * sigma));

/**
 * Per-pool astrological pressure.
 * @param chart       finished chart (positions need eclLon + dignity)
 * @param pools       [{constId|id, pair:[e0,e1]}]
 * @param footprints  map constId→{center,half} from footprintsFromMembers
 * @param smes        {raw,weights} from blendedSMES
 * Returns map constId→{E, coverage, dignity, raw, pressure(0..1)}.
 */
export function poolPressure(chart, pools, footprints, smes) {
  const wByBody = smes.weights || {};
  const rows = {};
  let maxRaw = 0;
  for (const pool of pools) {
    const id = pool.constId != null ? pool.constId : pool.id;
    const fp = footprints[id] || { center: 0, half: 15 };
    const E = (smes.raw[pool.pair[0]] || 0) + (smes.raw[pool.pair[1]] || 0);
    let cov = 0, digAccum = 0;
    for (const p of chart.positions) {
      const g = gauss(shortestSep(p.eclLon, fp.center), COVERAGE_SIGMA);
      cov += (wByBody[p.body] || 0) * g;
      digAccum += Math.max(0, p.dignity ? p.dignity.score : 0) * g;
    }
    const coverage = clamp01(cov / COVERAGE_NORM);
    const dignity = clamp(1 + digAccum / 10, 0.5, 1.5);
    const raw = E * (PRESSURE_FLOOR + (1 - PRESSURE_FLOOR) * coverage) * dignity;
    rows[id] = { constId: id, E, coverage, dignity, raw };
    if (raw > maxRaw) maxRaw = raw;
  }
  for (const id in rows) rows[id].pressure = maxRaw > 0 ? rows[id].raw / maxRaw : 0;
  return rows;
}

// ── scrubber date mapping ────────────────────────────────────────────────────
export const HALF_MS = { day: 4.32e7, month: 1.296e9, year: 1.5768e10 }; // ±12h / ±15d / ±182.5d
/** thumb t∈[0,1] → Date around a fixed anchor instant. */
export function dateFromThumb(t, zoom, anchor) {
  return new Date(anchor.getTime() + (t - 0.5) * 2 * (HALF_MS[zoom] || HALF_MS.month));
}
/** Date → thumb t∈[0,1] (keeps the thumb put across zoom changes). */
export function thumbFromDate(date, zoom, anchor) {
  return clamp01(0.5 + (date.getTime() - anchor.getTime()) / (2 * (HALF_MS[zoom] || HALF_MS.month)));
}

export const compute = {
  shortestSep, bodyVelocity, applyingState, aspectInfluence, enrichAspects, transitAspects,
  chartRuler, blendedBodyWeight, blendedSMES, elementalComposition, compToEsms,
  footprintsFromMembers, poolPressure, dateFromThumb, thumbFromDate,
  ASPECTS, DEFAULT_WEIGHTS, ESMS_OF_ELEMENT, ELEMENT_OF_ESMS, n360, clamp, clamp01,
};
export default compute;
