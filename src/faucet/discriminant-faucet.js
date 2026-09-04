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

/** Daily baseline yield budget: strictly 24.0000 ESMS (zero premium tiers). */
export const DAILY_FAUCET_BUDGET = 24.0;

/** Counter-cyclical anti-glut damping parameters (ADR-014 §3.3). */
export const ANTI_GLUT_THRESHOLD = 0.3; // 30% healthy supply ceiling
export const ANTI_GLUT_MIN_DAMPING = 0.65;
export const CURRENT_MATTER_DAMPING = 0.75; // authoritatively calibrated for 37.51% MATTER supply

// ── 1. Pure ADR-014 Mathematical Core ──────────────────────────────────────

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
 * Conserved ADR-014 Proportional Allocation Formula with exact residual pass.
 * Guarantees that sum(allocation) is EXACTLY equal to totalYield.
 */
export function allocateConservedYield(totalYield, natalRatios, transitWeights, damping) {
  const r = natalRatios;
  const w = transitWeights;
  const omega = damping || [1.0, 1.0, CURRENT_MATTER_DAMPING, 1.0];

  const unnormalizedWeights = [0, 1, 2, 3].map((i) => r[i] * w[i] * omega[i]);
  const totalWeight = unnormalizedWeights.reduce((a, b) => a + b, 0);

  if (totalWeight <= 0) {
    const perAxis = Number((totalYield / 4).toFixed(4));
    return {
      spirit: perAxis,
      essence: perAxis,
      matter: perAxis,
      substance: perAxis,
      total: totalYield,
    };
  }

  // Quantize to 10^4 (4 decimal places)
  const quantized = unnormalizedWeights.map((w_i) => {
    const exact = (totalYield * w_i) / totalWeight;
    return Math.floor(exact * 10000) / 10000;
  });

  const subtotal = quantized.reduce((a, b) => a + b, 0);
  const diff = Number((totalYield - subtotal).toFixed(4));

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

// ── 2. Tier 1: Baseline Sign-In Daily Faucet ───────────────────────────────

/**
 * Computes the universal baseline sign-in reward (strictly 24.0000 ESMS).
 */
export function computeDailySignInYield(natalChart, liveTransitSky, supplyState) {
  const r = deriveNatalRatios(natalChart);
  const w = normalizeTransitWeights(liveTransitSky);
  const omega = computeAntiGlutDamping(supplyState);

  return allocateConservedYield(DAILY_FAUCET_BUDGET, r, w, omega);
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
export function computeMeleeRoundWinYield(params) {
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
  } = params;

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

  const allocation = allocateConservedYield(totalYield, r, w, omega);
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
export function computeZoneCaptureYield(params) {
  const {
    zoneId = 0,
    inFlux = false,
    isIngress = false,
    overshootControl = 100,
    natalChart = null,
    liveTransitSky = null,
    supplyState = null,
  } = params;

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

  const allocation = allocateConservedYield(totalYield, r, w, omega);
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
export function computeDecanRetentionDividend(params) {
  const {
    zoneId = 0,
    control = 500,
    hasZodiacSeal = false,
    decanSuitMatch = false,
  } = params;

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
  DAILY_FAUCET_BUDGET,
  CURRENT_MATTER_DAMPING,
  DECAN_CHAMPION_SOVEREIGN_TREASURY,
  computeAntiGlutDamping,
  deriveNatalRatios,
  normalizeTransitWeights,
  allocateConservedYield,
  computeDailySignInYield,
  computeMeleeRoundWinYield,
  computeZoneCaptureYield,
  computeDecanRetentionDividend,
  computeStarStakingAccrualRate,
};
