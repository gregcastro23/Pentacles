/**
 * ============================================================================
 * Pentacles — Seeker Centralized Rating, Vernier Telemetry & Aspect Engine
 * ============================================================================
 * Pure, DOM-free calculation engine bridging the local Seeker's natal chart,
 * 3-card Siege loadout, card collection, ESMS balances, and live horizon sky
 * directly into Pentacles' centralized Vessel Rating System (rating-contract.ts).
 *
 * Implements the 3-Tier Anchored Scale (25–99):
 *   1. Natal Vessel Floor (~55% structural weight -> ~48–68 OVR at 0/3 cards)
 *   2. 3-Card Siege Loadout (~35% weight, up to +22 swing) + 1.15x Natal Attunement
 *   3. Soft-curved 92–94 pre-surge ceiling, reserving 95–99 strictly for
 *      Live Horizon / Kalchm Resonance Surge (evaluateSurgeState)
 */

import {
  SACRED_STAT_KEYS,
  ESMS_KEYS,
  clampStat,
  computeOvr,
  computeRelativeAdvantage,
  resolveArchetype,
  evaluateSealTier,
  buildCanonicalSeal,
  evaluateSurgeState,
} from '../../lib/agents/rating-contract';
import { resolveAgentAppearance } from '../../lib/agents/vessel-appearance-manifest';
import { dignityType, dignityScore, DOMICILES } from '../dignity.js';
import { categoricalChartAnalytics } from '../sign-character.js';
import { resolveAlchemicalPillar, computeThermodynamics } from '../thermo-kinetics.js';
import { decanCard } from '../decans.js';
import {
  normalizeTarotCard,
  PLANET_NAMES,
  PLANET_GLYPHS,
  PLANET_COLORS,
  SIGN_NAMES,
  SIGN_GLYPHS,
} from '../card-model.js';
import { getCard, kineticAlignment } from '../../cards/index.js';

export const HARMONIC_ATTUNEMENT_MULTIPLIER = 1.15;
export const PRE_SURGE_KNEE = 82;
export const PRE_SURGE_CEILING = 94;

// Canonical suit -> ESMS key mapping matching Pentacles' elemental architecture:
// Wands (Fire) -> spirit, Cups (Water) -> essence, Pentacles (Earth) -> matter, Swords (Air) -> substance
const SUIT_TO_ESMS = Object.freeze({
  wands: 'spirit',
  cups: 'essence',
  pentacles: 'matter',
  swords: 'substance',
  major: 'spirit',
});

// Planetary body index (0..9) -> Sacred 7 signature weights
const PLANET_STAT_WEIGHTS = Object.freeze({
  0: { charisma: 1.0, vitality: 0.85, power: 0.65 },         // Sun
  1: { intuition: 1.0, resonance: 0.9, adaptability: 0.35 }, // Moon
  2: { adaptability: 1.0, wisdom: 0.75, intuition: 0.35 },   // Mercury
  3: { charisma: 0.9, resonance: 1.0, vitality: 0.3 },       // Venus
  4: { power: 1.0, vitality: 0.65, adaptability: 0.45 },     // Mars
  5: { wisdom: 0.9, charisma: 0.75, intuition: 0.5 },        // Jupiter
  6: { vitality: 0.9, wisdom: 1.0, power: 0.4 },             // Saturn
  7: { adaptability: 0.95, intuition: 0.8, power: 0.35 },    // Uranus
  8: { resonance: 0.95, intuition: 1.0, charisma: 0.3 },     // Neptune
  9: { power: 0.95, intuition: 0.65, vitality: 0.65 },       // Pluto
});

// Faction allegiance bonus (+4 primary, +2.5 secondary)
const FACTION_SIGNATURES = Object.freeze([
  ['charisma', 'vitality'],      // 0 Sun
  ['intuition', 'resonance'],    // 1 Moon
  ['adaptability', 'wisdom'],    // 2 Mercury
  ['resonance', 'charisma'],     // 3 Venus
  ['power', 'vitality'],         // 4 Mars
  ['wisdom', 'charisma'],        // 5 Jupiter
  ['vitality', 'wisdom'],        // 6 Saturn
  ['adaptability', 'intuition'], // 7 Uranus
  ['intuition', 'resonance'],    // 8 Neptune
  ['power', 'intuition'],        // 9 Pluto
]);

/**
 * Mirrors public/client.js::levelMultiplier exactly so fusion previews match live gameplay.
 */
export function levelMultiplier(level) {
  const lv = Math.max(1, Number(level) || 1);
  return 1.0 + 0.5 * (1.0 - Math.pow(0.6, lv - 1));
}

export function planetIndexOf(body) {
  if (body === null || body === undefined) return 0;
  if (typeof body === 'number') return ((body | 0) % 10 + 10) % 10;
  const idx = PLANET_NAMES.findIndex((n) => n.toLowerCase() === String(body).toLowerCase());
  return idx >= 0 ? idx : 0;
}

export function circularDegDistance(degA, degB) {
  const diff = Math.abs((((degA % 360) + 360) % 360) - (((degB % 360) + 360) % 360));
  return Math.min(diff, 360 - diff);
}

/**
 * Soft-curves pre-surge Sacred Stats above 82 so natal + 3 fused cards
 * asymptotically approach 94 without flat-clipping, strictly reserving 95–99
 * for active astronomical Resonance Surge.
 */
export function softCurvePreSurge(rawScore) {
  if (!Number.isFinite(rawScore)) return 46;
  if (rawScore <= PRE_SURGE_KNEE) {
    return Math.max(25, Math.round(rawScore));
  }
  const excess = rawScore - PRE_SURGE_KNEE;
  const span = PRE_SURGE_CEILING - PRE_SURGE_KNEE; // 12 points (82..94)
  const curved = PRE_SURGE_KNEE + span * (1 - Math.exp(-excess / 12.5));
  return Math.min(PRE_SURGE_CEILING, Math.round(curved));
}

/**
 * Resolves a Tarot card's canonical JSON definition from src/cards/index.js,
 * synthesizing clean fallback sacredStats/planetaryStats for custom mock cards.
 */
export function resolveCardDefinition(rawCard) {
  const norm = normalizeTarotCard(rawCard);
  const lookupSuit = norm.isMajor ? 'major' : norm.suitKey;
  const def = getCard(lookupSuit, norm.rank);
  if (def) return { norm, def };

  // Fallback for synthetic/custom test cards without a registry match
  const atk = Number(norm.attack ?? 12);
  const hp = Number(norm.health ?? 20);
  const arm = Number(norm.armour ?? 6);
  const suit = norm.suitKey;
  const syntheticDef = {
    id: `custom-${norm.cardId}`,
    arcana: norm.isMajor ? 'major' : 'minor',
    rank: norm.rank ?? 1,
    suit,
    symbolism: {
      signIndex: norm.signIdx,
      planetIndex: norm.bodyIdx,
      decanRange: [10, 20],
    },
    styling: {
      audioFrequencyHz: 432 + (norm.bodyIdx * 24),
    },
    sacredStats: {
      power: Math.min(88, 38 + atk * 1.9 + (suit === 'wands' || suit === 'swords' ? 8 : 0)),
      resonance: Math.min(88, 40 + (suit === 'cups' ? 24 : 6) + (norm.isMajor ? 10 : 0)),
      wisdom: Math.min(88, 40 + arm * 2.2 + (suit === 'pentacles' ? 14 : 0)),
      charisma: Math.min(88, 40 + atk * 1.1 + (suit === 'wands' ? 14 : 0)),
      intuition: Math.min(88, 40 + (suit === 'cups' || norm.isMajor ? 20 : 6)),
      adaptability: Math.min(88, 40 + (suit === 'swords' ? 22 : 8)),
      vitality: Math.min(88, 38 + hp * 1.2 + arm * 1.4),
    },
    planetaryStats: {
      mercurialVelocity: suit === 'swords' ? 74 : suit === 'wands' ? 64 : 52,
    },
  };
  return { norm, def: syntheticDef };
}

/**
 * Resolves the card's ecliptic longitude [0, 360) on the 12-sign Natal Astrolabe.
 */
export function resolveCardEclipticDegree(norm, def, chart) {
  if (def?.symbolism?.decanRange && typeof def.symbolism.signIndex === 'number') {
    const [d0, d1] = def.symbolism.decanRange;
    return ((def.symbolism.signIndex % 12 + 12) % 12) * 30 + (d0 + d1) * 0.5;
  }
  if (typeof def?.symbolism?.signIndex === 'number' && def.symbolism.signIndex !== null) {
    return ((def.symbolism.signIndex % 12 + 12) % 12) * 30 + 15;
  }
  if (!norm.isMajor && Number.isFinite(norm.signIdx)) {
    return ((norm.signIdx % 12 + 12) % 12) * 30 + 15;
  }
  // Planetary Major Arcana: anchor at the Seeker's natal placement of that planet if available
  const placements = chart?.placements || [];
  const match = placements.find((p) => planetIndexOf(p.body) === norm.bodyIdx);
  if (match) {
    const sign = ((Number(match.sign) || 0) % 12 + 12) % 12;
    const deg = Math.min(29.9, Math.max(0, (Number(match.arc_minutes) || 0) / 60));
    return sign * 30 + deg;
  }
  return ((norm.signIdx % 12 + 12) % 12) * 30 + 15;
}

/**
 * Evaluates whether a card harmonizes with the Seeker's natal chart via:
 *   - Conjunction (0° / shared sign with key natal body or Ascendant)
 *   - Domicile Match (card's ruling planet is in Domicile in Seeker's chart or card sign)
 *   - Trine (120° / shared elemental triplicity with Sun, Moon, Ascendant, or Faction ruler)
 */
export function evaluateCardNatalAttunement(rawCard, chart, factionIdx = 0) {
  if (!rawCard || !chart) {
    return { attuned: false, multiplier: 1.0, aspect: null, label: null, targetBody: null, cardDeg: 0 };
  }
  const { norm, def } = resolveCardDefinition(rawCard);
  const cardDeg = resolveCardEclipticDegree(norm, def, chart);
  const cardSign = Math.floor(((cardDeg % 360) + 360) % 360 / 30);
  const placements = chart.placements || [];
  const keyBodies = new Set([0, 1, 2, 3, 4, planetIndexOf(factionIdx)]);

  // 1. Check Conjunction with natal placements or Ascendant
  for (const p of placements) {
    const bIdx = planetIndexOf(p.body);
    const pSign = ((Number(p.sign) || 0) % 12 + 12) % 12;
    const pDeg = pSign * 30 + ((Number(p.arc_minutes) || 0) / 60);
    const dist = circularDegDistance(cardDeg, pDeg);
    if (dist <= 12 || (pSign === cardSign && keyBodies.has(bIdx))) {
      return {
        attuned: true,
        multiplier: HARMONIC_ATTUNEMENT_MULTIPLIER,
        aspect: 'conjunction',
        glyph: '☌',
        label: `☌ Natal ${PLANET_NAMES[bIdx]}`,
        targetBody: bIdx,
        targetDeg: pDeg,
        cardDeg,
      };
    }
  }

  if (chart.time_known !== false && chart.ascendant != null) {
    const ascDeg = (((Number(chart.ascendant) || 0) / 60) % 360 + 360) % 360;
    const ascSign = Math.floor(ascDeg / 30);
    if (circularDegDistance(cardDeg, ascDeg) <= 12 || ascSign === cardSign) {
      return {
        attuned: true,
        multiplier: HARMONIC_ATTUNEMENT_MULTIPLIER,
        aspect: 'conjunction',
        glyph: '☌',
        label: '☌ Natal Ascendant',
        targetBody: 'ASC',
        targetDeg: ascDeg,
        cardDeg,
      };
    }
  }

  // 2. Check Domicile match
  const rulerPlacement = placements.find((p) => planetIndexOf(p.body) === norm.bodyIdx);
  if (rulerPlacement) {
    const rSign = ((Number(rulerPlacement.sign) || 0) % 12 + 12) % 12;
    if (DOMICILES[norm.bodyIdx]?.includes(rSign) && DOMICILES[norm.bodyIdx]?.includes(cardSign)) {
      const rDeg = rSign * 30 + ((Number(rulerPlacement.arc_minutes) || 0) / 60);
      return {
        attuned: true,
        multiplier: HARMONIC_ATTUNEMENT_MULTIPLIER,
        aspect: 'domicile',
        glyph: '⌂',
        label: `⌂ ${PLANET_NAMES[norm.bodyIdx]} Domicile`,
        targetBody: norm.bodyIdx,
        targetDeg: rDeg,
        cardDeg,
      };
    }
  }

  // 3. Check Trine (120° / shared elemental triplicity with key natal bodies)
  for (const p of placements) {
    const bIdx = planetIndexOf(p.body);
    if (!keyBodies.has(bIdx)) continue;
    const pSign = ((Number(p.sign) || 0) % 12 + 12) % 12;
    const pDeg = pSign * 30 + ((Number(p.arc_minutes) || 0) / 60);
    const dist = circularDegDistance(cardDeg, pDeg);
    const isExactTrine = Math.abs(dist - 120) <= 12;
    const isSignTrine = pSign !== cardSign && (pSign % 4) === (cardSign % 4);
    if (isExactTrine || isSignTrine) {
      return {
        attuned: true,
        multiplier: HARMONIC_ATTUNEMENT_MULTIPLIER,
        aspect: 'trine',
        glyph: '△',
        label: `△ Natal ${PLANET_NAMES[bIdx]}`,
        targetBody: bIdx,
        targetDeg: pDeg,
        cardDeg,
      };
    }
  }

  return { attuned: false, multiplier: 1.0, aspect: null, glyph: null, label: null, targetBody: null, cardDeg };
}

/**
 * Tier 1: Computes the Seeker's Natal Vessel Baseline (55% structural weight).
 * Yields coherent [46, 71] Sacred Stats (~50–68 OVR) when 0/3 Siege cards are slotted.
 */
export function computeNatalBaselineRatings(chart, factionIdx = 0) {
  const base = {
    power: 52,
    resonance: 52,
    wisdom: 52,
    charisma: 52,
    intuition: 52,
    adaptability: 52,
    vitality: 52,
  };

  if (!chart || !Array.isArray(chart.placements)) {
    return base;
  }

  const placements = chart.placements;
  const timeKnown = chart.time_known !== false;
  const ascMin = Number(chart.ascendant) || 0;
  const mcMin = Number(chart.midheaven) || 0;
  const analytics = categoricalChartAnalytics(placements, ascMin, mcMin, timeKnown);

  // 1. Planetary essential dignities & angular prominence
  for (const p of placements) {
    const bIdx = planetIndexOf(p.body);
    const sign = ((Number(p.sign) || 0) % 12 + 12) % 12;
    const dig = typeof p.dignity === 'number' ? p.dignity : dignityScore(bIdx, sign);
    const weights = PLANET_STAT_WEIGHTS[bIdx] || {};

    let angularBoost = 0;
    if (timeKnown) {
      const posDeg = sign * 30 + ((Number(p.arc_minutes) || 0) / 60);
      const ascDeg = ((ascMin / 60) % 360 + 360) % 360;
      const mcDeg = ((mcMin / 60) % 360 + 360) % 360;
      if (circularDegDistance(posDeg, ascDeg) <= 15 || circularDegDistance(posDeg, mcDeg) <= 15) {
        angularBoost = 1.8;
      }
    }

    // Dignity ranges [-5, +5]; scale gently so dignified charts shape the archetype
    const digFactor = dig * 0.72 + angularBoost;
    for (const [statKey, w] of Object.entries(weights)) {
      base[statKey] += digFactor * w;
    }
  }

  // 2. Elemental triplicity & modality shaping
  const { fire, earth, air, water } = analytics.elements;
  const { cardinal, fixed, mutable } = analytics.modalities;
  base.power += (fire - 25) * 0.14 + (cardinal - 33.3) * 0.08;
  base.charisma += (fire - 25) * 0.12 + (air - 25) * 0.06;
  base.resonance += (water - 25) * 0.16;
  base.intuition += (water - 25) * 0.14 + (mutable - 33.3) * 0.07;
  base.wisdom += (earth - 25) * 0.14 + (fixed - 33.3) * 0.08;
  base.vitality += (earth - 25) * 0.12 + (fixed - 33.3) * 0.08;
  base.adaptability += (air - 25) * 0.16 + (mutable - 33.3) * 0.10;

  // 3. Chosen Planetary Faction allegiance signature
  const fIdx = planetIndexOf(factionIdx);
  const [fPrimary, fSecondary] = FACTION_SIGNATURES[fIdx] || FACTION_SIGNATURES[0];
  base[fPrimary] += 3.8;
  base[fSecondary] += 2.2;

  // 4. Kalchm thermodynamic balance nuance
  const esmsPct = [fire, water, earth, air];
  const pillar = resolveAlchemicalPillar(esmsPct);
  const thermo = computeThermodynamics(esmsPct, pillar);
  if (thermo.freeEnergy > 50) {
    base.power += 1.2;
    base.adaptability += 0.8;
  } else if (thermo.freeEnergy < 10) {
    base.vitality += 1.2;
    base.wisdom += 0.8;
  }

  // Clamp structural natal floor cleanly inside [45, 69] so 0/3 Siege OVR stays in ~48–68
  const out = {};
  for (const key of SACRED_STAT_KEYS) {
    out[key] = Math.max(45, Math.min(69, Math.round(base[key])));
  }
  return out;
}

/**
 * Evaluates live astronomical sky telemetry for Horizon Dignity & Surge readiness.
 */
export function evaluateHorizonDignity(state, factionIdx = 0, dominantEsmsKey = 'spirit') {
  const fIdx = planetIndexOf(factionIdx);
  const planetName = PLANET_NAMES[fIdx] || 'Sun';
  const planetGlyph = PLANET_GLYPHS[fIdx] || '☉';

  const planets = Array.isArray(state?.planets) ? state.planets : [];
  const constellations = Array.isArray(state?.constellations) ? state.constellations : [];
  const sky = Array.isArray(state?.sky) ? state.sky : [];

  const rulingBody = planets[fIdx] || null;
  const rulingAlt = rulingBody
    ? Number(rulingBody.apparentAlt ?? rulingBody.alt ?? -90)
    : -90;
  const rulingAbove = Number.isFinite(rulingAlt) && rulingAlt > 0;
  const rulingOnHorizonBand = rulingAbove && rulingAlt <= 15;

  const esmsIdx = Math.max(0, ESMS_KEYS.indexOf(dominantEsmsKey));
  const matchingPools = constellations.filter(
    (c) => c && c.tradeable && Array.isArray(c.pair) && c.pair.includes(esmsIdx)
  );
  const anyTradeablePool = matchingPools[0] || constellations.find((c) => c?.tradeable) || null;

  const horizonBrightStar = sky.find(
    (s) => s && s.horizonEncounter && typeof s.magnitude === 'number' && s.magnitude < 1.5
  ) || null;

  const isExalted = Boolean(rulingAbove || matchingPools.length > 0 || horizonBrightStar);

  let headline = `${planetGlyph} ${planetName} Sub-Horizon`;
  let detail = 'Awaiting ruling transit or rising constellation pool';
  let skyBonusMeter = 0;

  if (rulingAbove) {
    const altRounded = Math.round(rulingAlt * 10) / 10;
    headline = rulingOnHorizonBand
      ? `🌅 ${planetGlyph} ${planetName} Rising (+${altRounded}°)`
      : `✦ ${planetGlyph} ${planetName} Exalted (+${altRounded}°)`;
    detail = rulingOnHorizonBand
      ? 'Ascendant Horizon Band · Peak Refracted Dignity'
      : 'Ruling Planet Above Observer Horizon';
    skyBonusMeter += rulingOnHorizonBand ? 42 : Math.min(40, 28 + rulingAlt * 0.2);
  }

  if (matchingPools.length > 0) {
    const pool = matchingPools[0];
    if (!rulingAbove) {
      headline = `✦ ${pool.name} Pool Open`;
      detail = `${pool.visibleCount}/${pool.memberCount} stars above 10° engagement gate`;
    } else {
      detail += ` · ${pool.name} Pool Open`;
    }
    skyBonusMeter += 24;
  } else if (anyTradeablePool) {
    skyBonusMeter += 8;
  }

  if (horizonBrightStar) {
    if (!rulingAbove && matchingPools.length === 0) {
      headline = `🌅 ${horizonBrightStar.name} on Horizon`;
      detail = `1st-Magnitude Horizon Star (+${Math.round(horizonBrightStar.alt * 10) / 10}°)`;
    }
    skyBonusMeter += 18;
  }

  return {
    exalted: isExalted,
    rulingAbove,
    rulingAlt: Number.isFinite(rulingAlt) ? rulingAlt : null,
    rulingOnHorizonBand,
    matchingPoolCount: matchingPools.length,
    activePoolName: matchingPools[0]?.name || anyTradeablePool?.name || null,
    horizonStarName: horizonBrightStar?.name || null,
    headline,
    detail,
    skyBonusMeter,
  };
}

/**
 * Extracts normalized ESMS balances for the Seeker from state / liveWalletSync / treasury cache.
 */
export function resolveSeekerEsmsBalances(state, explicitEsms = null) {
  if (explicitEsms && typeof explicitEsms === 'object') {
    return {
      spirit: Math.max(0, Number(explicitEsms.spirit) || 0),
      essence: Math.max(0, Number(explicitEsms.essence) || 0),
      matter: Math.max(0, Number(explicitEsms.matter) || 0),
      substance: Math.max(0, Number(explicitEsms.substance) || 0),
    };
  }
  const jp = state?.jingPool?.esms || state?.esmsBalances || null;
  if (Array.isArray(jp) && jp.length >= 4) {
    return {
      spirit: Math.max(0, Number(jp[0]) || 0),
      essence: Math.max(0, Number(jp[1]) || 0),
      matter: Math.max(0, Number(jp[2]) || 0),
      substance: Math.max(0, Number(jp[3]) || 0),
    };
  }
  if (jp && typeof jp === 'object') {
    return {
      spirit: Math.max(0, Number(jp.spirit ?? jp.Spirit) || 0),
      essence: Math.max(0, Number(jp.essence ?? jp.Essence) || 0),
      matter: Math.max(0, Number(jp.matter ?? jp.Matter) || 0),
      substance: Math.max(0, Number(jp.substance ?? jp.Substance) || 0),
    };
  }
  // Derive baseline elemental reserve from Seeker arena tokens when cross-app ledger is offline
  const tokens = Math.max(0, Number(state?.player?.tokens) || 0);
  const unit = tokens > 0 ? Math.round((tokens / 250) * 100) / 100 : 1.0;
  return { spirit: unit, essence: unit, matter: unit, substance: unit };
}

/**
 * Computes Sacred Aspect Chords (120° Trine, 60° Sextile, 0° Conjunction)
 * connecting the active/preview Siege cards to each other and to natal placements.
 */
export function computeAstrolabeAspectChords(siegeCards, chart, previewCard = null) {
  const chords = [];
  if (!chart || !Array.isArray(chart.placements)) return chords;

  const placements = chart.placements;
  const allEntries = (siegeCards || []).filter(Boolean).map((c, idx) => {
    const { norm, def } = resolveCardDefinition(c);
    return {
      card: c,
      norm,
      def,
      deg: resolveCardEclipticDegree(norm, def, chart),
      isPreview: false,
      slotIdx: idx,
    };
  });

  if (previewCard) {
    const alreadyIn = allEntries.some((e) => Number(e.norm.cardId) === Number(previewCard.card_id ?? previewCard.cardId));
    if (!alreadyIn) {
      const { norm, def } = resolveCardDefinition(previewCard);
      allEntries.push({
        card: previewCard,
        norm,
        def,
        deg: resolveCardEclipticDegree(norm, def, chart),
        isPreview: true,
        slotIdx: -1,
      });
    }
  }

  // 1. Card <-> Card Ptolemaic chords across the Siege Triad
  for (let i = 0; i < allEntries.length; i++) {
    for (let j = i + 1; j < allEntries.length; j++) {
      const a = allEntries[i];
      const b = allEntries[j];
      const dist = circularDegDistance(a.deg, b.deg);
      const signA = Math.floor(a.deg / 30) % 12;
      const signB = Math.floor(b.deg / 30) % 12;
      const signDiff = Math.min(Math.abs(signA - signB), 12 - Math.abs(signA - signB));

      let aspect = null;
      if (dist <= 12 || signDiff === 0) {
        aspect = { type: 'conjunction', glyph: '☌', name: 'Conjunction', color: '#f6e7c1' };
      } else if (Math.abs(dist - 120) <= 14 || signDiff === 4) {
        aspect = { type: 'trine', glyph: '△', name: 'Harmonic Trine', color: '#eab308' };
      } else if (Math.abs(dist - 60) <= 11 || signDiff === 2) {
        aspect = { type: 'sextile', glyph: '⚹', name: 'Astral Sextile', color: '#cbd5e1' };
      }

      if (aspect) {
        chords.push({
          id: `card-${a.norm.cardId}-${b.norm.cardId}`,
          ...aspect,
          degA: a.deg,
          degB: b.deg,
          isPreview: a.isPreview || b.isPreview,
          source: 'triad',
          label: `${aspect.glyph} ${a.norm.title} · ${b.norm.title}`,
        });
      }
    }
  }

  // 2. Card <-> Key Natal Placement chords (cap to strongest aspect per card to keep geometry crisp)
  for (const entry of allEntries) {
    const signCard = Math.floor(entry.deg / 30) % 12;
    let bestChord = null;
    let bestScore = -1;

    for (const p of placements) {
      const bIdx = planetIndexOf(p.body);
      const pSign = ((Number(p.sign) || 0) % 12 + 12) % 12;
      const pDeg = pSign * 30 + ((Number(p.arc_minutes) || 0) / 60);
      const dist = circularDegDistance(entry.deg, pDeg);
      const signDiff = Math.min(Math.abs(signCard - pSign), 12 - Math.abs(signCard - pSign));
      const bodyWeight = bIdx <= 4 ? 3 : 1;

      if (dist <= 12 || signDiff === 0) {
        const score = 30 + bodyWeight - dist * 0.2;
        if (score > bestScore) {
          bestScore = score;
          bestChord = {
            id: `natal-${entry.norm.cardId}-${bIdx}`,
            type: 'conjunction',
            glyph: '☌',
            name: 'Natal Conjunction',
            color: '#f6e7c1',
            degA: entry.deg,
            degB: pDeg,
            isPreview: entry.isPreview,
            source: 'natal',
            planetIdx: bIdx,
            label: `☌ ${entry.norm.title} · Natal ${PLANET_GLYPHS[bIdx]} ${PLANET_NAMES[bIdx]}`,
          };
        }
      } else if (Math.abs(dist - 120) <= 12 || signDiff === 4) {
        const score = 20 + bodyWeight - Math.abs(dist - 120) * 0.2;
        if (score > bestScore) {
          bestScore = score;
          bestChord = {
            id: `natal-${entry.norm.cardId}-${bIdx}`,
            type: 'trine',
            glyph: '△',
            name: 'Natal Trine',
            color: '#eab308',
            degA: entry.deg,
            degB: pDeg,
            isPreview: entry.isPreview,
            source: 'natal',
            planetIdx: bIdx,
            label: `△ ${entry.norm.title} · Natal ${PLANET_GLYPHS[bIdx]} ${PLANET_NAMES[bIdx]}`,
          };
        }
      } else if (Math.abs(dist - 60) <= 9 || signDiff === 2) {
        const score = 12 + bodyWeight - Math.abs(dist - 60) * 0.2;
        if (score > bestScore) {
          bestScore = score;
          bestChord = {
            id: `natal-${entry.norm.cardId}-${bIdx}`,
            type: 'sextile',
            glyph: '⚹',
            name: 'Natal Sextile',
            color: '#cbd5e1',
            degA: entry.deg,
            degB: pDeg,
            isPreview: entry.isPreview,
            source: 'natal',
            planetIdx: bIdx,
            label: `⚹ ${entry.norm.title} · Natal ${PLANET_GLYPHS[bIdx]} ${PLANET_NAMES[bIdx]}`,
          };
        }
      }
    }

    if (bestChord) {
      chords.push(bestChord);
    }
  }

  return chords;
}

/**
 * Builds the complete Natal Astrolabe Ring descriptor (12 signs + 10 natal bodies + Decan mappings).
 */
export function buildNatalAstrolabeData(chart) {
  if (!chart || !Array.isArray(chart.placements)) {
    return { placements: [], ascDeg: null, mcDeg: null };
  }
  const timeKnown = chart.time_known !== false;
  const ascDeg = timeKnown && chart.ascendant != null
    ? (((Number(chart.ascendant) || 0) / 60) % 360 + 360) % 360
    : null;
  const mcDeg = timeKnown && chart.midheaven != null
    ? (((Number(chart.midheaven) || 0) / 60) % 360 + 360) % 360
    : null;

  const nodes = chart.placements.map((p) => {
    const bIdx = planetIndexOf(p.body);
    const sign = ((Number(p.sign) || 0) % 12 + 12) % 12;
    const degInSign = Math.min(29.99, Math.max(0, (Number(p.arc_minutes) || 0) / 60));
    const lonDeg = sign * 30 + degInSign;
    const digType = dignityType(bIdx, sign);
    const digScore = typeof p.dignity === 'number' ? p.dignity : dignityScore(bIdx, sign);
    const decan = decanCard(sign, degInSign);
    return {
      bodyIdx: bIdx,
      planetName: PLANET_NAMES[bIdx],
      planetGlyph: PLANET_GLYPHS[bIdx],
      planetColor: PLANET_COLORS[bIdx],
      signIdx: sign,
      signName: SIGN_NAMES[sign],
      signGlyph: SIGN_GLYPHS[sign],
      degInSign: Math.floor(degInSign),
      lonDeg,
      retrograde: Boolean(p.retrograde),
      dignityType: digType,
      dignityScore: digScore,
      decanCardTitle: `${decan.rank} of ${decan.suit}`,
      decanLordTitle: decan.title || '',
      decanRange: decan.range || '',
    };
  });

  return { placements: nodes, ascDeg, mcDeg };
}

/**
 * Full Seeker Telemetry & Centralized RatedAgentPayload Synthesizer.
 *
 * @param {object} params
 * @param {object} params.state - Live GameState (player, collection, deck, selectedCards, sky, planets, constellations)
 * @param {Array<object>} [params.siegeCardsOverride] - Explicit 0..3 Siege cards (used for base or candidate hover preview)
 * @param {object} [params.esmsOverride] - Optional live ESMS balances from liveWalletSync / Vessel treasury
 * @param {number} [params.skyTransitDeg] - Optional transit longitude in degrees [0, 360)
 */
export function computeSeekerTelemetry({
  state,
  siegeCardsOverride = null,
  esmsOverride = null,
  skyTransitDeg = null,
} = {}) {
  const player = state?.player || {};
  const chart = player.chart || { placements: [] };
  const factionIdx = planetIndexOf(player.faction);
  const factionName = PLANET_NAMES[factionIdx] || 'Sun';
  const collection = Array.isArray(state?.collection) ? state.collection : [];
  const deck = Array.isArray(state?.deck) ? state.deck : [];

  // Resolve active 8-card hand & 3-card Siege loadout
  const activeIds = new Set(
    deck
      .filter((d) => String(d.loadout || '').toLowerCase() === 'active')
      .map((d) => Number(d.card_id))
  );
  const activeDeckCards = collection.filter((c) => activeIds.has(Number(c.card_id)));

  let siegeCards;
  if (Array.isArray(siegeCardsOverride)) {
    siegeCards = siegeCardsOverride.filter(Boolean).slice(0, 3);
  } else {
    const selectedSet = state?.selectedCards instanceof Set
      ? state.selectedCards
      : new Set(Array.isArray(state?.selectedCards) ? state.selectedCards : []);
    siegeCards = [];
    for (const id of selectedSet) {
      const found = collection.find((c) => Number(c.card_id) === Number(id));
      if (found) siegeCards.push(found);
      if (siegeCards.length >= 3) break;
    }
  }

  // Transit degree for kineticAlignment
  let transitDeg = skyTransitDeg;
  if (transitDeg === null || transitDeg === undefined) {
    const sunBody = Array.isArray(state?.planets) ? state.planets[0] : null;
    if (sunBody && typeof sunBody.eclLon === 'number') {
      transitDeg = sunBody.eclLon;
    } else if (chart.ascendant != null) {
      transitDeg = ((Number(chart.ascendant) || 0) / 60) % 360;
    } else {
      transitDeg = 0;
    }
  }

  // 1. Natal Baseline Ratings (55% structural weight -> 45..72)
  const natalRatings = computeNatalBaselineRatings(chart, factionIdx);
  const combinedRaw = { ...natalRatings };

  // 2. 3-Card Siege Loadout Instrumentation (~35% weight, up to +22 swing) + 1.15x Natal Attunement
  const slottedDetails = [];
  let totalAttack = 0;
  let totalHealth = 0;
  let totalArmour = 0;
  let cooldownSumMs = 0;
  let cooldownCount = 0;
  let velocitySum = 0;

  const suitCounts = { spirit: 0, essence: 0, matter: 0, substance: 0 };
  for (const c of activeDeckCards) {
    const sKey = String(c.suit || 'wands').toLowerCase();
    const eKey = SUIT_TO_ESMS[sKey] || 'spirit';
    suitCounts[eKey] += 0.35;
  }

  for (const rawCard of siegeCards) {
    const { norm, def } = resolveCardDefinition(rawCard);
    const lvlMult = levelMultiplier(norm.level);
    const attunement = evaluateCardNatalAttunement(rawCard, chart, factionIdx);
    const kScore = kineticAlignment(def, transitDeg);
    const kineticBonus = kScore >= 75 ? 0.75 : kScore >= 60 ? 0.35 : 0;

    for (const statKey of SACRED_STAT_KEYS) {
      const cardStat = Number(def.sacredStats?.[statKey] ?? 50);
      // Centered around 38 so signature axes (+60..85) yield crisp +3..+9 vernier deltas per card
      const scaledAxis = ((cardStat * lvlMult - 38) / 48) * 7.2;
      combinedRaw[statKey] += (scaledAxis + kineticBonus) * attunement.multiplier;
    }

    totalAttack += Number(norm.attack || 0);
    totalHealth += Number(norm.health || 0);
    totalArmour += Number(norm.armour || 0);
    const cdMs = Number(norm.cooldownMs || rawCard.cooldown_ms || 2400);
    cooldownSumMs += cdMs;
    cooldownCount += 1;
    velocitySum += Number(def.planetaryStats?.mercurialVelocity ?? 54);

    const eKey = SUIT_TO_ESMS[norm.suitKey] || 'spirit';
    suitCounts[eKey] += 1.25 * attunement.multiplier;

    slottedDetails.push({
      card: rawCard,
      norm,
      def,
      attunement,
      kineticScore: kScore,
    });
  }

  // Soft-curve pre-surge ratings cleanly below 94
  const preSurgeRatings = {};
  for (const statKey of SACRED_STAT_KEYS) {
    preSurgeRatings[statKey] = softCurvePreSurge(combinedRaw[statKey]);
  }

  // 3. ESMS Alchemical Balance Diamond (4-point normalized [14..96])
  const ascMin = Number(chart.ascendant) || 0;
  const mcMin = Number(chart.midheaven) || 0;
  const analytics = categoricalChartAnalytics(
    chart.placements || [],
    ascMin,
    mcMin,
    chart.time_known !== false
  );
  const esmsBalances = resolveSeekerEsmsBalances(state, esmsOverride);
  const totalEsmsTokens =
    esmsBalances.spirit + esmsBalances.essence + esmsBalances.matter + esmsBalances.substance;

  const rawDiamond = {
    spirit: analytics.elements.fire * 0.55 + suitCounts.spirit * 11 + (totalEsmsTokens > 0 ? (esmsBalances.spirit / totalEsmsTokens) * 25 : 6),
    essence: analytics.elements.water * 0.55 + suitCounts.essence * 11 + (totalEsmsTokens > 0 ? (esmsBalances.essence / totalEsmsTokens) * 25 : 6),
    matter: analytics.elements.earth * 0.55 + suitCounts.matter * 11 + (totalEsmsTokens > 0 ? (esmsBalances.matter / totalEsmsTokens) * 25 : 6),
    substance: analytics.elements.air * 0.55 + suitCounts.substance * 11 + (totalEsmsTokens > 0 ? (esmsBalances.substance / totalEsmsTokens) * 25 : 6),
  };

  const diamondSum = Math.max(1, rawDiamond.spirit + rawDiamond.essence + rawDiamond.matter + rawDiamond.substance);
  const esmsPctArray = [
    (rawDiamond.spirit / diamondSum) * 100,
    (rawDiamond.essence / diamondSum) * 100,
    (rawDiamond.matter / diamondSum) * 100,
    (rawDiamond.substance / diamondSum) * 100,
  ];
  const esmsDiamond = {
    spirit: Math.max(16, Math.min(96, Math.round(esmsPctArray[0] * 2.1))),
    essence: Math.max(16, Math.min(96, Math.round(esmsPctArray[1] * 2.1))),
    matter: Math.max(16, Math.min(96, Math.round(esmsPctArray[2] * 2.1))),
    substance: Math.max(16, Math.min(96, Math.round(esmsPctArray[3] * 2.1))),
  };

  let dominantEsms = 'spirit';
  let bestDiamondVal = -1;
  for (const key of ESMS_KEYS) {
    if (esmsDiamond[key] > bestDiamondVal) {
      bestDiamondVal = esmsDiamond[key];
      dominantEsms = key;
    }
  }

  // 4. Kalchm Thermodynamics + Live Horizon Dignity -> Centralized evaluateSurgeState
  const pillar = resolveAlchemicalPillar(esmsPctArray);
  const thermo = computeThermodynamics(esmsPctArray, pillar);
  const normHeat = Math.max(0, Math.min(1, Number((thermo.heat / 420).toFixed(3))));
  const normReactivity = Math.max(0, Math.min(1, Number((thermo.reactivity / 8.5).toFixed(3))));

  const preRelAdv = computeRelativeAdvantage(preSurgeRatings);
  const preArchetype = resolveArchetype(preRelAdv);

  const horizonDignity = evaluateHorizonDignity(state, factionIdx, dominantEsms);
  const loadoutReadiness = siegeCards.length * 4;
  const baseThermoMeter = Math.round((normHeat * 0.52 + normReactivity * 0.48) * 52) + loadoutReadiness;
  const surgeMeter = Math.max(0, Math.min(100, baseThermoMeter + Math.round(horizonDignity.skyBonusMeter)));

  const surge = evaluateSurgeState(
    surgeMeter,
    normHeat,
    normReactivity,
    preArchetype.primary,
    preArchetype.secondary,
    null
  );

  // Apply astronomical surge boosts ONLY when surge is active; this is the sole gate into 95–99
  const finalRatings = {};
  for (const statKey of SACRED_STAT_KEYS) {
    const boost = surge.active ? Number(surge.statBoosts?.[statKey] || 0) : 0;
    finalRatings[statKey] = clampStat(preSurgeRatings[statKey] + boost);
  }

  const relativeAdvantage = computeRelativeAdvantage(finalRatings);
  const archetype = resolveArchetype(relativeAdvantage);
  const ovr = computeOvr(finalRatings);

  // Evaluate canonical Alchemical Seals using centralized mean-aligned gates
  const isPlaceholder = !player.chart || !Array.isArray(player.chart.placements) || player.chart.placements.length === 0;
  const seals = [];
  for (const statKey of SACRED_STAT_KEYS) {
    const tier = evaluateSealTier(statKey, finalRatings[statKey], totalEsmsTokens, isPlaceholder);
    if (tier) {
      seals.push(buildCanonicalSeal(statKey, tier));
    }
  }

  const handleSlug = String(player.handle || 'seeker')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'seeker';
  const agentKey = `seeker-${handleSlug}`;
  const appearance = resolveAgentAppearance(agentKey, factionIdx, archetype);

  /** @type {import('../../lib/agents/rating-contract').RatedAgentPayload} */
  const ratedPayload = {
    key: agentKey,
    handle: player.handle || 'Seeker',
    faction: factionIdx,
    factionName,
    isPlaceholder,
    provenance: 'user',
    appearance,
    ratings: finalRatings,
    relativeAdvantage,
    ovr,
    archetype,
    esms: esmsBalances,
    seals,
    surge,
  };

  // Honest Siege Output (Attack, Health, Armour, Cast Cadence in seconds + Mercurial Velocity)
  const avgCadenceSec = cooldownCount > 0
    ? Number((cooldownSumMs / cooldownCount / 1000).toFixed(2))
    : null;
  const avgVelocity = cooldownCount > 0
    ? Math.round(velocitySum / cooldownCount)
    : 0;

  const siegeOutput = {
    slotCount: siegeCards.length,
    attack: totalAttack,
    health: totalHealth,
    armour: totalArmour,
    cadenceSec: avgCadenceSec,
    mercurialVelocity: avgVelocity,
  };

  const aspectChords = computeAstrolabeAspectChords(siegeCards, chart, null);

  return {
    ratedPayload,
    natalRatings,
    preSurgeRatings,
    siegeCards,
    slottedDetails,
    siegeOutput,
    esmsDiamond,
    esmsPct: esmsPctArray,
    dominantEsms,
    pillar,
    thermo,
    horizonDignity,
    aspectChords,
  };
}

/**
 * Computes brass vernier Ghost Delta projections when hovering a candidate card
 * (for Siege slotting) or hovering a duplicate copy in Crucible Fusion mode.
 */
export function computeSeekerPreview(baseTelemetry, state, previewAction, esmsOverride = null) {
  if (!baseTelemetry || !previewAction) return null;

  let nextSiegeCards = [...baseTelemetry.siegeCards];
  let previewCardForChords = null;
  let fusedPreviewCard = null;

  if (previewAction.mode === 'fuse' && previewAction.keepCard && previewAction.consumeCard) {
    const keep = previewAction.keepCard;
    const prevMult = levelMultiplier(keep.level || 1);
    const nextLv = (Number(keep.level) || 1) + 1;
    const nextMult = levelMultiplier(nextLv);
    const ratio = nextMult / prevMult;

    fusedPreviewCard = {
      ...keep,
      level: nextLv,
      attack: Math.round((Number(keep.attack) || 0) * ratio),
      health: Math.round((Number(keep.health) || 0) * ratio),
      armour: Math.round((Number(keep.armour) || 0) * ratio),
    };
    previewCardForChords = fusedPreviewCard;

    const keepIdx = nextSiegeCards.findIndex(
      (c) => Number(c.card_id) === Number(keep.card_id)
    );
    const consumeIdx = nextSiegeCards.findIndex(
      (c) => Number(c.card_id) === Number(previewAction.consumeCard.card_id)
    );

    if (keepIdx >= 0) {
      nextSiegeCards[keepIdx] = fusedPreviewCard;
      if (consumeIdx >= 0 && consumeIdx !== keepIdx) {
        nextSiegeCards.splice(consumeIdx, 1);
      }
    } else if (consumeIdx >= 0) {
      nextSiegeCards[consumeIdx] = fusedPreviewCard;
    } else if (nextSiegeCards.length < 3) {
      nextSiegeCards.push(fusedPreviewCard);
    } else {
      nextSiegeCards[nextSiegeCards.length - 1] = fusedPreviewCard;
    }
  } else if (previewAction.mode === 'slot' && previewAction.card) {
    const candidate = previewAction.card;
    previewCardForChords = candidate;
    const candId = Number(candidate.card_id ?? candidate.cardId);
    const existingIdx = nextSiegeCards.findIndex((c) => Number(c.card_id) === candId);

    if (existingIdx >= 0) {
      // Hovering an already-slotted card previews unslotting or inspecting without self-duplication
      if (previewAction.previewUnslot) {
        nextSiegeCards.splice(existingIdx, 1);
      }
    } else if (
      typeof previewAction.slotIndex === 'number' &&
      previewAction.slotIndex >= 0 &&
      previewAction.slotIndex < 3
    ) {
      if (previewAction.slotIndex < nextSiegeCards.length) {
        nextSiegeCards[previewAction.slotIndex] = candidate;
      } else {
        nextSiegeCards.push(candidate);
      }
    } else if (nextSiegeCards.length < 3) {
      nextSiegeCards.push(candidate);
    } else {
      nextSiegeCards[2] = candidate;
    }
  } else {
    return null;
  }

  const projected = computeSeekerTelemetry({
    state,
    siegeCardsOverride: nextSiegeCards,
    esmsOverride,
  });

  const ovrDelta = projected.ratedPayload.ovr - baseTelemetry.ratedPayload.ovr;
  const sacredDeltas = {};
  for (const key of SACRED_STAT_KEYS) {
    sacredDeltas[key] = projected.ratedPayload.ratings[key] - baseTelemetry.ratedPayload.ratings[key];
  }

  const siegeDeltas = {
    attack: projected.siegeOutput.attack - baseTelemetry.siegeOutput.attack,
    health: projected.siegeOutput.health - baseTelemetry.siegeOutput.health,
    armour: projected.siegeOutput.armour - baseTelemetry.siegeOutput.armour,
    // For cadenceSec, lower seconds = faster cast cadence
    cadenceSec:
      projected.siegeOutput.cadenceSec !== null && baseTelemetry.siegeOutput.cadenceSec !== null
        ? Number((projected.siegeOutput.cadenceSec - baseTelemetry.siegeOutput.cadenceSec).toFixed(2))
        : null,
  };

  const aspectChords = computeAstrolabeAspectChords(
    baseTelemetry.siegeCards,
    state?.player?.chart,
    previewCardForChords
  );

  return {
    projected,
    fusedPreviewCard,
    ovrDelta,
    sacredDeltas,
    siegeDeltas,
    aspectChords,
  };
}
