// ============================================================
// Pentacles — ADR-014 Discriminant Astrological Faucet Engine
// ============================================================
// Authoritative implementation of the Unilateral Alchemical Faucet
// Specification (ADR-014) for Pentacles.
//
// Governs both:
//   1. Tier 1: Universal Baseline Sign-In Faucet (24.0000 ESMS daily)
//   2. Tier 2: Probabilistic & Skill-Based Gameplay Faucet Engine:
//      - Melee trick round victories (War Table 12-trick play)
//      - Contested zone captures (5 Houses, 5 Spires, Crown Zenith)
//      - 10-day Decan solar transit territorial retention & sovereign crown
//      - 14 Alchemical Pillars thermodynamic modulation
//      - StarVault USDC continuous staking yield
// ============================================================

/**
 * ⚠️ MANDATORY CANONICAL TOKEN IDENTITIES & SYMBOL TIERS (ADR-014 §1)
 * Exactly four canonical tokens across all interfaces, databases, and contracts.
 * Under NO circumstances shall element names ever replace token names.
 */
export const CANONICAL_TOKENS = Object.freeze([
  {
    id: 0,
    name: "SPIRIT",
    key: "spirit",
    primaryGlyph: "🝇",      // U+1F747
    triangularVariant: "🜂", // U+1F702
    unicodeFallback: "△",
    atomicCode: "[SPRT]",
    element: "Fire",
    color: "#e0a23a",
    domain: "Combat strike power, kinetic action gas, thermodynamic heat Q",
    mintAddress: "K5kwwomtWYydxJacA7bC5yUEW9TtEuVqBKBoqAWLmhQ",
  },
  {
    id: 1,
    name: "ESSENCE",
    key: "essence",
    primaryGlyph: "🝑",      // U+1F751
    triangularVariant: "🜄", // U+1F704
    unicodeFallback: "▽",
    atomicCode: "[ESNC]",
    element: "Water",
    color: "#4aa3d8",
    domain: "Health regeneration, secret lore decryption, free energy ΔG",
    mintAddress: "3FcpToU7bj4sLD687uecbesEjzjxBfqYn2EcBXJKPaCf",
  },
  {
    id: 2,
    name: "MATTER",
    key: "matter",
    primaryGlyph: "🝙",      // U+1F759
    triangularVariant: "🜃", // U+1F703
    unicodeFallback: "⯛",
    atomicCode: "[MATR]",
    element: "Earth",
    color: "#5fb37a",
    domain: "Garrison defense, star fortification, low entropy S stabilization",
    mintAddress: "7naJZozLrknDF3dguAdEWn7Z4MviUkXitjhaAt57Vkb4",
  },
  {
    id: 3,
    name: "SUBSTANCE",
    key: "substance",
    primaryGlyph: "🝉",      // U+1F749
    triangularVariant: "🜁", // U+1F701
    unicodeFallback: "⯙",
    atomicCode: "[SUBS]",
    element: "Air",
    color: "#b98cd6",
    domain: "Multi-seat melee strategy, conclave deliberation, AMM LP routing",
    mintAddress: "6RY6ZG1eJQ2uEvpyA6XK74WyF1MpTYbw97hdhELqDUsa",
  },
]);

export const TOKEN_NAMES = CANONICAL_TOKENS.map((t) => t.name);
export const TOKEN_KEYS = CANONICAL_TOKENS.map((t) => t.key);

/** ADR-015 Protocol Band Calibration for Pentacles: [6.0000, 48.0000] ESMS (centre 24.0000, z in [0.25, 2.00]) */
export const PROTOCOL_BAND = Object.freeze({
  Y_MIN: 6.0,
  Y_MAX: 48.0,
  CENTRE: 24.0,
  AXIS_FLOOR: 0.5000,
  TOTAL_FLOOR: 2.0000,
});

/** Daily baseline yield budget: 24.0000 ESMS. */
export const DAILY_FAUCET_BUDGET = PROTOCOL_BAND.CENTRE;

/** Operational Gas Floor: guaranteed 0.5000 ESMS per axis (2.0000 ESMS total floor). */
export const AXIS_GAS_FLOOR = PROTOCOL_BAND.AXIS_FLOOR;
export const TOTAL_GAS_FLOOR = PROTOCOL_BAND.TOTAL_FLOOR;

/** Counter-cyclical anti-glut damping parameters (ADR-014 §3.3). */
export const ANTI_GLUT_THRESHOLD = 0.3; // 30% healthy supply ceiling
export const ANTI_GLUT_MIN_DAMPING = 0.65;
export const CURRENT_MATTER_DAMPING = 0.75; // authoritatively calibrated for 37.51% MATTER supply

// ── 1. Pure ADR-015 Mathematical Core ──────────────────────────────────────

/**
 * Computes the Counter-Cyclical Anti-Glut Damping Factor (Ω_i).
 * Dampens any token whose global supply share exceeds 30%.
 */
export function computeAntiGlutDamping(supplyShares) {
  const damp = [1.0, 1.0, 1.0, 1.0];
  if (!supplyShares || !Array.isArray(supplyShares)) {
    // Authoritative network state: MATTER is in 37.51% glut -> Ω_MATTER = 0.750
    damp[2] = CURRENT_MATTER_DAMPING;
    return damp;
  }

  const total = supplyShares.reduce((a, b) => a + Number(b || 0), 0);
  if (total <= 0) {
    damp[2] = CURRENT_MATTER_DAMPING;
    return damp;
  }

  for (let i = 0; i < 4; i++) {
    const share = Number(supplyShares[i] || 0) / total;
    if (share > ANTI_GLUT_THRESHOLD) {
      damp[i] = Math.max(
        ANTI_GLUT_MIN_DAMPING,
        Number((1.0 - 2.0 * (share - 0.25)).toFixed(4))
      );
    }
  }
  return damp;
}

/**
 * Computes the normalized Natal Chart Ratio Vector (r_i(N)).
 * Returns [r_Spirit, r_Essence, r_Matter, r_Substance], where sum = 1.0.
 */
export function deriveNatalRatios(natalChart) {
  if (!natalChart) {
    return [0.25, 0.25, 0.25, 0.25]; // Neutral fallback
  }

  // If chart provides direct elemental score vector { spirit, essence, matter, substance }
  if (natalChart.alchemicalElements) {
    const el = natalChart.alchemicalElements;
    const scores = [
      Number(el.spirit ?? el.Spirit ?? 0),
      Number(el.essence ?? el.Essence ?? 0),
      Number(el.matter ?? el.Matter ?? 0),
      Number(el.substance ?? el.Substance ?? 0),
    ];
    const sum = scores.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      return scores.map((s) => s / sum);
    }
  }

  // If chart provides positions array (standard NatalChart / AstroWeather)
  const positions = natalChart.positions || natalChart.placements;
  if (Array.isArray(positions) && positions.length > 0) {
    const scores = [0, 0, 0, 0]; // Fire(0), Water(1), Earth(2), Air(3)
    for (const p of positions) {
      const sign = Number(p.sign ?? 0);
      const signEl = [0, 2, 3, 1][((sign % 4) + 4) % 4]; // 0:Fire, 1:Earth->2, 2:Air->3, 3:Water->1
      const body = Number(p.body ?? 0);
      const weight = body === 0 || body === 1 ? 3.0 : 1.0; // Sun/Moon lights 3x
      scores[signEl] += weight;
    }

    if (natalChart.time_known || natalChart.timeKnown) {
      const asc = Number(natalChart.ascendant ?? natalChart.asc ?? 0);
      const ascSign = Math.floor((asc / (natalChart.ascendant > 360 ? 1800 : 30)) % 12);
      const ascEl = [0, 2, 3, 1][((ascSign % 4) + 4) % 4];
      scores[ascEl] += 3.0; // Ascendant weight
    }

    const sum = scores.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      return scores.map((s) => s / sum);
    }
  }

  return [0.25, 0.25, 0.25, 0.25];
}

/**
 * Computes normalized celestial transit weights (w_i(t)).
 * [w_Spirit, w_Essence, w_Matter, w_Substance], where sum = 1.0.
 */
export function normalizeTransitWeights(rawWeights) {
  if (!rawWeights) {
    return [0.25, 0.25, 0.25, 0.25];
  }
  const w = Array.isArray(rawWeights)
    ? rawWeights.map(Number)
    : [
        Number(rawWeights.Fire ?? rawWeights.fire ?? rawWeights.spirit ?? 0),
        Number(rawWeights.Water ?? rawWeights.water ?? rawWeights.essence ?? 0),
        Number(rawWeights.Earth ?? rawWeights.earth ?? rawWeights.matter ?? 0),
        Number(rawWeights.Air ?? rawWeights.air ?? rawWeights.substance ?? 0),
      ];

  const sum = w.reduce((a, b) => a + b, 0);
  if (sum <= 0) return [0.25, 0.25, 0.25, 0.25];
  return w.map((x) => x / sum);
}

/**
 * Computes the chart's self-normalisation baseline S̄(N) under equinoctial / neutral sky (0.25 per axis).
 * Cancels chart-shape min-maxing (INV-5), ensuring annual emission neutrality (INV-3).
 *
 * @param {Array<number>} natalRatios - Normalized 4-element natal ratios
 * @param {Array<number>} [damping] - Optional 4-element damping factors
 * @returns {number} S̄(N) baseline
 */
export function calculateChartBaseline(natalRatios, damping) {
  const omega = damping || [1.0, 1.0, CURRENT_MATTER_DAMPING, 1.0];
  let baseline = 0;
  for (let i = 0; i < 4; i++) {
    baseline += natalRatios[i] * 0.25 * omega[i];
  }
  return baseline > 0 ? baseline : 0.25;
}

/**
 * Computes instantaneous synastry resonance S(N, t), baseline S̄(N), and resonance factor z.
 *
 * @param {Array<number>} natalRatios - Normalized 4-element natal ratios
 * @param {Array<number>} transitWeights - Normalized 4-element transit weights
 * @param {Array<number>} [damping] - Optional 4-element damping factors
 * @returns {{ synastry: number, baseline: number, z: number }}
 */
export function computeSynastryResonance(natalRatios, transitWeights, damping) {
  const omega = damping || [1.0, 1.0, CURRENT_MATTER_DAMPING, 1.0];
  let synastry = 0;
  for (let i = 0; i < 4; i++) {
    synastry += natalRatios[i] * transitWeights[i] * omega[i];
  }
  const baseline = calculateChartBaseline(natalRatios, omega);
  const z = baseline > 0 ? synastry / baseline : 1.0;
  return { synastry, baseline, z };
}

/**
 * ADR-015 Floored Elemental Allocation Formula with operational gas floors and exact 10^4 residual pass.
 * Guarantees that:
 * 1. Every axis receives AT LEAST AXIS_GAS_FLOOR (0.5000 ESMS).
 * 2. Discretionary pool (totalYield - 2.0000) is distributed via r_i * w_i * omega_i.
 * 3. Sum of all four axes is EXACTLY equal to totalYield (residual added to dominant axis).
 */
export function allocateFlooredYield(totalYield, natalRatios, transitWeights, damping) {
  const r = natalRatios;
  const w = transitWeights;
  const omega = damping || [1.0, 1.0, CURRENT_MATTER_DAMPING, 1.0];

  const effectiveTotal = Math.max(TOTAL_GAS_FLOOR, totalYield);
  const discretionary = Math.max(0, effectiveTotal - TOTAL_GAS_FLOOR);

  const unnormalizedWeights = [0, 1, 2, 3].map((i) => r[i] * w[i] * omega[i]);
  const totalWeight = unnormalizedWeights.reduce((a, b) => a + b, 0);

  const quantized = [AXIS_GAS_FLOOR, AXIS_GAS_FLOOR, AXIS_GAS_FLOOR, AXIS_GAS_FLOOR];

  if (totalWeight > 0 && discretionary > 0) {
    for (let i = 0; i < 4; i++) {
      const share = (discretionary * unnormalizedWeights[i]) / totalWeight;
      quantized[i] = Math.floor((AXIS_GAS_FLOOR + share) * 10000) / 10000;
    }
  } else if (discretionary > 0) {
    const perAxisDisc = Math.floor((discretionary / 4) * 10000) / 10000;
    for (let i = 0; i < 4; i++) {
      quantized[i] = AXIS_GAS_FLOOR + perAxisDisc;
    }
  }

  const subtotal = quantized.reduce((a, b) => a + b, 0);
  const diff = Number((effectiveTotal - subtotal).toFixed(4));

  // Residual conservation pass: assign rounding difference to dominant axis
  let dominantIdx = 0;
  for (let i = 1; i < 4; i++) {
    if (unnormalizedWeights[i] > unnormalizedWeights[dominantIdx]) {
      dominantIdx = i;
    }
  }

  quantized[dominantIdx] = Number((quantized[dominantIdx] + diff).toFixed(4));

  return {
    spirit: quantized[0],
    essence: quantized[1],
    matter: quantized[2],
    substance: quantized[3],
    total: Number((quantized[0] + quantized[1] + quantized[2] + quantized[3]).toFixed(4)),
    weights: {
      natal: r,
      transit: w,
      damping: omega,
      unnormalized: unnormalizedWeights,
    },
  };
}

/** Backwards-compatible alias for allocateFlooredYield */
export function allocateConservedYield(totalYield, natalRatios, transitWeights, damping) {
  return allocateFlooredYield(totalYield, natalRatios, transitWeights, damping);
}

// ── 2. Tier 1: Baseline Sign-In Daily Faucet ───────────────────────────────

/**
 * Computes the ADR-015 untethered daily sign-in reward.
 * Dynamically scales total grant in [6.0000, 48.0000] based on self-normalised synastry resonance z.
 */
export function computeDailySignInYield(natalChart, liveTransitSky, supplyState) {
  const r = deriveNatalRatios(natalChart);
  const w = normalizeTransitWeights(liveTransitSky);
  const omega = computeAntiGlutDamping(supplyState);

  const { synastry, baseline, z } = computeSynastryResonance(r, w, omega);
  const rawYield = PROTOCOL_BAND.CENTRE * z;
  const clampedYield = Math.min(PROTOCOL_BAND.Y_MAX, Math.max(PROTOCOL_BAND.Y_MIN, rawYield));
  const totalYield = Number(clampedYield.toFixed(4));

  const allocation = allocateFlooredYield(totalYield, r, w, omega);
  return {
    ...allocation,
    resonanceMultiplier: Number(z.toFixed(4)),
    baseline: Number(baseline.toFixed(4)),
    synastry: Number(synastry.toFixed(4)),
  };
}

// ── 3. Tier 2: Gameplay Faucet Calculations ────────────────────────────────

/**
 * Computes the reward for winning a 12-trick Melee Table round.
 *
 * Base: 5.0000 ESMS
 * + Score multiplier: 1.0 + (winningScore / 100)
 * + Clean Sweep Grand Slam: +50% (1.50x)
 * + Trick Majority: +20% (1.20x)
 * + Zone Favored Suit Alignment: +35% (1.35x) / -25% (0.75x)
 * + Oudler Climax (12th trick win with Fool/Magician/World): +1.5000 ESMS flat
 */
export function computeMeleeRoundWinYield(params, ...rest) {
  let opts = {};
  if (typeof params === 'number') {
    opts = {
      winningScore: params,
      cleanSweep: Boolean(rest[0]),
      favoredSuitMatch: Boolean(rest[1]),
      oudlerClimax: Boolean(rest[2]),
      natalChart: rest[3] || null,
      liveTransitSky: rest[4] || null,
      supplyState: rest[5] || null,
    };
  } else {
    opts = params || {};
  }

  const {
    winningScore = 100,
    tricksWon = 7,
    cleanSweep = false,
    favoredSuitMatch = false,
    oppositeSuit = false,
    oudlerClimax = false,
    natalChart = null,
    liveTransitSky = null,
    supplyState = null,
  } = opts;

  let baseAmount = 5.0;
  const scoreMult = 1.0 + Math.min(2.5, winningScore / 100.0);
  const sweepMult = cleanSweep || tricksWon >= 12 ? 1.5 : tricksWon >= 7 ? 1.2 : 1.0;
  const weatherMult = favoredSuitMatch ? 1.35 : oppositeSuit ? 0.75 : 1.0;

  let totalYield = baseAmount * scoreMult * sweepMult * weatherMult;
  if (oudlerClimax) {
    totalYield += 1.5;
  }

  totalYield = Number(totalYield.toFixed(4));

  const r = deriveNatalRatios(natalChart);
  const w = normalizeTransitWeights(liveTransitSky);
  const omega = computeAntiGlutDamping(supplyState);

  const allocation = allocateFlooredYield(totalYield, r, w, omega);
  return {
    ...allocation,
    breakdown: {
      baseAmount,
      winningScore,
      scoreMult: Number(scoreMult.toFixed(2)),
      sweepMult,
      weatherMult,
      oudlerBonus: oudlerClimax ? 1.5 : 0.0,
      totalYield,
    },
  };
}

/**
 * Computes the bounty awarded for capturing a contested zone (flipping the meter past 0).
 *
 * Base by Topography:
 *   The 5 Houses (Zones 0..4):   25.0000 ESMS (Affinity: Earth / Water)
 *   The 5 Spires (Zones 5..9):   35.0000 ESMS (Affinity: Fire / Air)
 *   The Crown Zenith (Zone 10):  50.0000 ESMS (Quintessence)
 *
 * Modifiers:
 *   In Flux (astronomical flux): 2.5x multiplier
 *   Ingress Zone:                2.0x multiplier
 *   Control Margin Overshoot:    +1.5 ESMS per 100 overshoot (capped at +15.0)
 */
export function computeZoneCaptureYield(params, ...rest) {
  let opts = {};
  if (typeof params === 'number') {
    opts = {
      zoneId: params,
      inFlux: Boolean(rest[0]),
      isIngress: Boolean(rest[1]),
      overshootControl: typeof rest[2] === 'number' ? rest[2] : 100,
      natalChart: rest[3] || null,
      liveTransitSky: rest[4] || null,
      supplyState: rest[5] || null,
    };
  } else {
    opts = params || {};
  }

  const {
    zoneId = 0,
    inFlux = false,
    isIngress = false,
    overshootControl = 100,
    natalChart = null,
    liveTransitSky = null,
    supplyState = null,
  } = opts;

  // Base by topography
  let baseBounty = 25.0; // Houses 0..4
  if (zoneId === 10) {
    baseBounty = 50.0; // Crown Zenith
  } else if (zoneId >= 5) {
    baseBounty = 35.0; // Spires 5..9
  }

  const marginBonus = Math.min(15.0, (Math.max(0, overshootControl) / 100.0) * 1.5);
  let totalYield = baseBounty + marginBonus;

  if (inFlux) totalYield *= 2.5;
  if (isIngress) totalYield *= 2.0;

  totalYield = Number(totalYield.toFixed(4));

  const r = deriveNatalRatios(natalChart);
  const w = normalizeTransitWeights(liveTransitSky);
  const omega = computeAntiGlutDamping(supplyState);

  const allocation = allocateFlooredYield(totalYield, r, w, omega);
  return {
    ...allocation,
    zoneId,
    breakdown: {
      baseBounty,
      marginBonus: Number(marginBonus.toFixed(4)),
      inFluxMultiplier: inFlux ? 2.5 : 1.0,
      ingressMultiplier: isIngress ? 2.0 : 1.0,
      totalYield,
    },
  };
}

/**
 * Computes the 10-day Decan Territorial Retention Dividend awarded when the
 * Sun crosses a 10° boundary.
 *
 * Base per zone held:
 *   Houses (0..4):   100.0000 ESMS
 *   Spires (5..9):   150.0000 ESMS
 *   Crown (10):      250.0000 ESMS
 *
 * Control Scaling: control / 500 (1000 max control = 2.0x base dividend)
 * Zodiac Seal:     +15% dividend for contiguous sector hold
 */
export function computeDecanRetentionDividend(params, ...rest) {
  let opts = {};
  if (typeof params === 'number') {
    opts = {
      zoneId: params,
      control: typeof rest[0] === 'number' ? rest[0] : 500,
      hasZodiacSeal: Boolean(rest[1]),
      decanSuitMatch: Boolean(rest[2]),
    };
  } else {
    opts = params || {};
  }

  const {
    zoneId = 0,
    control = 500,
    hasZodiacSeal = false,
    decanSuitMatch = false,
  } = opts;

  let baseDividend = 100.0;
  if (zoneId === 10) baseDividend = 250.0;
  else if (zoneId >= 5) baseDividend = 150.0;

  const controlMult = Math.min(2.0, Math.max(0.2, Number(control) / 500.0));
  const sealMult = hasZodiacSeal ? 1.15 : 1.0;
  const suitResonance = decanSuitMatch ? 1.25 : 1.0;

  const totalYield = Number((baseDividend * controlMult * sealMult * suitResonance).toFixed(4));

  return {
    zoneId,
    totalYield,
    breakdown: {
      baseDividend,
      controlMult: Number(controlMult.toFixed(2)),
      sealMult,
      suitResonance,
    },
  };
}

/**
 * Decan Minor Tarot Card Champion Sovereign Treasury (500.0000 ESMS pool).
 */
export const DECAN_CHAMPION_SOVEREIGN_TREASURY = 500.0;

/**
 * Computes Continuous StarVault Staking Yield Rate (ADR-014 §5.3).
 * Modulated by the staker's chart ratio for the star's element, live transit weights,
 * and anti-glut damping.
 */
export function computeStarStakingAccrualRate(params) {
  const {
    starElement = 0, // 0:Spirit, 1:Essence, 2:Matter, 3:Substance
    baseDailyRate = 0.0006, // BASE_DAILY_RATE in server/reducers.rs
    natalChart = null,
    liveTransitSky = null,
    supplyState = null,
    isAscendantBurst = false,
  } = params;

  const r = deriveNatalRatios(natalChart);
  const w = normalizeTransitWeights(liveTransitSky);
  const omega = computeAntiGlutDamping(supplyState);

  const starElemIdx = Math.min(3, Math.max(0, starElement));
  const numerator = r[starElemIdx] * w[starElemIdx] * omega[starElemIdx];
  const denominator = [0, 1, 2, 3].reduce((sum, j) => sum + r[j] * w[j] * omega[j], 0);

  const ratioFactor = denominator > 0 ? (numerator / denominator) * 4.0 : 1.0;
  const burstMultiplier = isAscendantBurst ? 2.0 : 1.0; // "Golden Minute" 2x boost

  return baseDailyRate * ratioFactor * burstMultiplier;
}

export default {
  CANONICAL_TOKENS,
  TOKEN_NAMES,
  TOKEN_KEYS,
  PROTOCOL_BAND,
  DAILY_FAUCET_BUDGET,
  AXIS_GAS_FLOOR,
  TOTAL_GAS_FLOOR,
  CURRENT_MATTER_DAMPING,
  DECAN_CHAMPION_SOVEREIGN_TREASURY,
  computeAntiGlutDamping,
  deriveNatalRatios,
  normalizeTransitWeights,
  calculateChartBaseline,
  computeSynastryResonance,
  allocateFlooredYield,
  allocateConservedYield,
  computeDailySignInYield,
  computeMeleeRoundWinYield,
  computeZoneCaptureYield,
  computeDecanRetentionDividend,
  computeStarStakingAccrualRate,
};
