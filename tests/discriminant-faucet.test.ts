import { describe, expect, it } from "bun:test";
import {
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
} from "../src/faucet/discriminant-faucet.js";
import {
  checkAndNotifyDailyLoginReward,
  notifyDailySignInReward,
  DAILY_CLAIM_STORAGE_KEY,
} from "../src/faucet/login-notifier.js";

// Canonical transit configurations from ADR-014 benchmark
const CELESTIAL_MOMENTS = {
  fireSky: [5.0, 1.5, 1.5, 2.0],        // Moment 1: Fire Sky Transit
  waterSky: [1.0, 5.5, 2.0, 1.5],       // Moment 2: Water Sky Transit
  earthStellium: [1.5, 2.0, 5.0, 1.5],  // Moment 3: Earth Stellium
  airSolstice: [2.0, 1.5, 1.5, 5.0],    // Moment 4: Air Solstice
  equinox: [2.5, 2.5, 2.5, 2.5],        // Moment 5: Equinoctial Equilibrium
};

// Canonical Archetypal Natal Vectors (Spirit, Essence, Matter, Substance)
const ARCHETYPES = {
  fireDominant: { alchemicalElements: { spirit: 50, essence: 15, matter: 15, substance: 20 } },
  waterDominant: { alchemicalElements: { spirit: 10, essence: 55, matter: 20, substance: 15 } },
  earthDominant: { alchemicalElements: { spirit: 15, essence: 20, matter: 50, substance: 15 } },
  airDominant: { alchemicalElements: { spirit: 20, essence: 15, matter: 15, substance: 50 } },
  neutral: { alchemicalElements: { spirit: 25, essence: 25, matter: 25, substance: 25 } },
};

describe("ADR-014 Universal Astrological Faucet — Protocol Invariant Matrix", () => {
  // TEST-01: Exact Total Conservation
  it("[TEST-01] enforces exact mathematical conservation of 24.0000 ESMS daily yield", () => {
    for (const [mName, weights] of Object.entries(CELESTIAL_MOMENTS)) {
      for (const [aName, chart] of Object.entries(ARCHETYPES)) {
        const result = computeDailySignInYield(chart, weights);
        const sum = Number((result.spirit + result.essence + result.matter + result.substance).toFixed(4));
        expect(sum).toBe(DAILY_FAUCET_BUDGET);
        expect(result.total).toBe(DAILY_FAUCET_BUDGET);
      }
    }
  });

  // TEST-02: Symmetric Neutral Baseline
  it("[TEST-02] produces exact symmetric 6.0000 payout under neutral chart and equinoctial sky", () => {
    // When supply is balanced (all Ω_i = 1.0)
    const balancedSupply = [25000, 25000, 25000, 25000];
    const result = computeDailySignInYield(ARCHETYPES.neutral, CELESTIAL_MOMENTS.equinox, balancedSupply);

    expect(result.spirit).toBe(6.0);
    expect(result.essence).toBe(6.0);
    expect(result.matter).toBe(6.0);
    expect(result.substance).toBe(6.0);
    expect(result.total).toBe(24.0);
  });

  // TEST-03: Fire Transit Kinetic Gas Elevation
  it("[TEST-03] elevates SPIRIT yield in Fire sky to provide conversational/combat kinetic gas", () => {
    const result = computeDailySignInYield(ARCHETYPES.fireDominant, CELESTIAL_MOMENTS.fireSky);
    // In Fire sky, Fire-dominant agent yields > 12.0000 SPIRIT
    expect(result.spirit).toBeGreaterThanOrEqual(12.0);
    expect(result.matter).toBeLessThan(4.0);
  });

  // TEST-04: Counter-Cyclical Anti-Glut Damping Suppression
  it("[TEST-04] compresses MATTER yield via Ω_MATTER = 0.750 when MATTER exceeds 30% supply", () => {
    // Under live network state (37.51% MATTER glut)
    const resultFire = computeDailySignInYield(ARCHETYPES.neutral, CELESTIAL_MOMENTS.fireSky);
    const resultAir = computeDailySignInYield(ARCHETYPES.neutral, CELESTIAL_MOMENTS.airSolstice);
    const resultWater = computeDailySignInYield(ARCHETYPES.neutral, CELESTIAL_MOMENTS.waterSky);
    const resultEquinox = computeDailySignInYield(ARCHETYPES.neutral, CELESTIAL_MOMENTS.equinox);

    // Fire, Air, and Water skies compress MATTER to <= 4.20
    expect(resultFire.matter).toBeLessThanOrEqual(4.2);
    expect(resultAir.matter).toBeLessThanOrEqual(4.2);
    expect(resultWater.matter).toBeLessThanOrEqual(4.2);

    // Equinox is compressed from 6.0000 baseline down to 4.8000
    expect(resultEquinox.matter).toBe(4.8);

    // Average MATTER across the diverse transit moments is compressed <= 4.20
    const avgTransitMatter = (resultFire.matter + resultAir.matter + resultWater.matter + resultEquinox.matter) / 4;
    expect(avgTransitMatter).toBeLessThanOrEqual(4.2);
  });

  // TEST-05: Earth Stellium Safety Ceiling
  it("[TEST-05] caps runaway accumulation of MATTER strictly below 9.0000 during an Earth Stellium", () => {
    // Earth Stellium moment with damped network supply across diverse population
    const fireYield = computeDailySignInYield(ARCHETYPES.fireDominant, CELESTIAL_MOMENTS.earthStellium);
    const waterYield = computeDailySignInYield(ARCHETYPES.waterDominant, CELESTIAL_MOMENTS.earthStellium);
    const airYield = computeDailySignInYield(ARCHETYPES.airDominant, CELESTIAL_MOMENTS.earthStellium);

    // Non-earth archetypes remain strictly <= 9.0000
    expect(fireYield.matter).toBeLessThanOrEqual(9.0);
    expect(waterYield.matter).toBeLessThanOrEqual(9.0);
    expect(airYield.matter).toBeLessThanOrEqual(9.0);

    // Damping suppresses runaway accumulation compared to un-damped
    const undampedNeutral = computeDailySignInYield(ARCHETYPES.neutral, CELESTIAL_MOMENTS.earthStellium, [25000, 25000, 25000, 25000]);
    const dampedNeutral = computeDailySignInYield(ARCHETYPES.neutral, CELESTIAL_MOMENTS.earthStellium);
    expect(dampedNeutral.matter).toBeLessThan(undampedNeutral.matter);
    expect(dampedNeutral.total).toBe(24.0);
  });

  // TEST-06: Inter-Player Archetype Differentiation
  it("[TEST-06] produces authentic individualized payouts across distinct natal archetypes", () => {
    const fireClaim = computeDailySignInYield(ARCHETYPES.fireDominant, CELESTIAL_MOMENTS.equinox);
    const earthClaim = computeDailySignInYield(ARCHETYPES.earthDominant, CELESTIAL_MOMENTS.equinox);
    const waterClaim = computeDailySignInYield(ARCHETYPES.waterDominant, CELESTIAL_MOMENTS.equinox);
    const airClaim = computeDailySignInYield(ARCHETYPES.airDominant, CELESTIAL_MOMENTS.equinox);

    expect(fireClaim.spirit).toBeGreaterThan(earthClaim.spirit);
    expect(earthClaim.matter).toBeGreaterThan(airClaim.matter);
    expect(waterClaim.essence).toBeGreaterThan(fireClaim.essence);
    expect(airClaim.substance).toBeGreaterThan(waterClaim.substance);
  });

  // TEST-07: Token Naming Purity & Symbol Codification
  it("[TEST-07] verifies strictly canonical token identities and glyph tiers", () => {
    expect(CANONICAL_TOKENS).toHaveLength(4);
    expect(TOKEN_NAMES).toEqual(["SPIRIT", "ESSENCE", "MATTER", "SUBSTANCE"]);
    expect(TOKEN_KEYS).toEqual(["spirit", "essence", "matter", "substance"]);

    const spirit = CANONICAL_TOKENS[0];
    expect(spirit.name).toBe("SPIRIT");
    expect(spirit.primaryGlyph).toBe("🝇");
    expect(spirit.triangularVariant).toBe("🜂");
    expect(spirit.atomicCode).toBe("[SPRT]");

    const matter = CANONICAL_TOKENS[2];
    expect(matter.name).toBe("MATTER");
    expect(matter.primaryGlyph).toBe("🝙");
    expect(matter.triangularVariant).toBe("🜃");
    expect(matter.atomicCode).toBe("[MATR]");
  });
});

describe("Pentacles Tier 2 Gameplay Faucet Mechanics", () => {
  // TEST-08: Melee Round Winning Rewards & Clean Sweep
  it("[TEST-08] computes War Table melee round rewards with Clean Sweep and favored suit alignment", () => {
    // Normal round win with 7 tricks
    const regularWin = computeMeleeRoundWinYield({
      winningScore: 120,
      tricksWon: 7,
      cleanSweep: false,
      favoredSuitMatch: false,
      natalChart: ARCHETYPES.fireDominant,
      liveTransitSky: CELESTIAL_MOMENTS.fireSky,
    });

    // Clean Sweep Grand Slam (all 12 tricks) + favored suit weather alignment (+35%) + Oudler climax (+1.5)
    const grandSlam = computeMeleeRoundWinYield({
      winningScore: 160,
      tricksWon: 12,
      cleanSweep: true,
      favoredSuitMatch: true,
      oudlerClimax: true,
      natalChart: ARCHETYPES.fireDominant,
      liveTransitSky: CELESTIAL_MOMENTS.fireSky,
    });

    expect(regularWin.total).toBeGreaterThan(5.0);
    expect(grandSlam.total).toBeGreaterThan(regularWin.total);
    expect(grandSlam.breakdown.sweepMult).toBe(1.5);
    expect(grandSlam.breakdown.weatherMult).toBe(1.35);
    expect(grandSlam.breakdown.oudlerBonus).toBe(1.5);

    // Verify mathematical conservation of the round payout
    const sum = Number((grandSlam.spirit + grandSlam.essence + grandSlam.matter + grandSlam.substance).toFixed(4));
    expect(sum).toBe(grandSlam.total);
  });

  // TEST-09: Contested Zone Capture Bounties
  it("[TEST-09] calculates differentiated bounties for capturing Houses, Spires, and Crown Zenith", () => {
    const houseCap = computeZoneCaptureYield({
      zoneId: 2, // House 2
      inFlux: false,
      isIngress: false,
      overshootControl: 50,
      natalChart: ARCHETYPES.neutral,
      liveTransitSky: CELESTIAL_MOMENTS.equinox,
    });

    const spireCap = computeZoneCaptureYield({
      zoneId: 7, // Spire 7
      inFlux: false,
      isIngress: false,
      overshootControl: 50,
      natalChart: ARCHETYPES.neutral,
      liveTransitSky: CELESTIAL_MOMENTS.equinox,
    });

    const crownCap = computeZoneCaptureYield({
      zoneId: 10, // Crown Zenith
      inFlux: true, // In Flux: 2.5x multiplier
      isIngress: true, // Ingress: 2.0x multiplier
      overshootControl: 100,
      natalChart: ARCHETYPES.neutral,
      liveTransitSky: CELESTIAL_MOMENTS.equinox,
    });

    expect(houseCap.breakdown.baseBounty).toBe(25.0);
    expect(spireCap.breakdown.baseBounty).toBe(35.0);
    expect(crownCap.breakdown.baseBounty).toBe(50.0);

    // Crown Zenith with Flux (2.5x) and Ingress (2.0x) -> 5.0x multiplier on base + margin
    expect(crownCap.breakdown.inFluxMultiplier).toBe(2.5);
    expect(crownCap.breakdown.ingressMultiplier).toBe(2.0);
    expect(crownCap.total).toBeGreaterThan(250.0);

    // Verify mathematical conservation
    const sum = Number((crownCap.spirit + crownCap.essence + crownCap.matter + crownCap.substance).toFixed(4));
    expect(sum).toBe(crownCap.total);
  });

  // TEST-10: 10-Day Decan Boundary Zone Retention & Sovereign Treasury
  it("[TEST-10] calculates Decan Boundary zone retention dividends and crowns sovereign champion", () => {
    // Holding a House at baseline control (500)
    const baseHouse = computeDecanRetentionDividend({
      zoneId: 1,
      control: 500,
      hasZodiacSeal: false,
    });
    expect(baseHouse.totalYield).toBe(100.0);

    // Holding a fully fortified Spire (1000 control = 2.0x) with Zodiac Seal (+15%)
    const fortifiedSpire = computeDecanRetentionDividend({
      zoneId: 6,
      control: 1000,
      hasZodiacSeal: true,
      decanSuitMatch: true, // +25% suit resonance
    });
    // 150 base * 2.0 (control) * 1.15 (seal) * 1.25 (resonance) = 431.25
    expect(fortifiedSpire.totalYield).toBe(431.25);

    // Holding the Crown Zenith (10) at 1000 control
    const crownRetention = computeDecanRetentionDividend({
      zoneId: 10,
      control: 1000,
      hasZodiacSeal: false,
    });
    // 250 base * 2.0 = 500.0
    expect(crownRetention.totalYield).toBe(500.0);

    // Sovereign treasury pool
    expect(DECAN_CHAMPION_SOVEREIGN_TREASURY).toBe(500.0);
  });

  // TEST-11: StarVault Continuous Staking Accrual Rate (ADR-014 §5.3)
  it("[TEST-11] calculates StarVault staking yield accrual rate and triggers Ascendant burst", () => {
    const normalRate = computeStarStakingAccrualRate({
      starElement: 0, // Sirius / Antares -> SPIRIT
      baseDailyRate: 0.0006,
      natalChart: ARCHETYPES.fireDominant,
      liveTransitSky: CELESTIAL_MOMENTS.fireSky,
      isAscendantBurst: false,
    });

    const burstRate = computeStarStakingAccrualRate({
      starElement: 0,
      baseDailyRate: 0.0006,
      natalChart: ARCHETYPES.fireDominant,
      liveTransitSky: CELESTIAL_MOMENTS.fireSky,
      isAscendantBurst: true, // Golden Minute Ascendant crossing
    });

    expect(normalRate).toBeGreaterThan(0.0006);
    expect(burstRate).toBeCloseTo(normalRate * 2.0, 6);
  });

  // TEST-12: Automated Daily Login Notification System
  it("[TEST-12] automatically awards and notifies users of daily login ESMS without needing a button", async () => {
    // Setup mock window environment for toast and storage
    const storage = new Map();
    globalThis.localStorage = {
      getItem: (k: string) => storage.get(k) || null,
      setItem: (k: string, v: string) => storage.set(k, String(v)),
      removeItem: (k: string) => storage.delete(k),
      clear: () => storage.clear(),
    } as any;

    let toastCalled = false;
    let toastPayload: any = null;
    (globalThis as any).window = {
      toast: (msg: string, opts: any) => {
        toastCalled = true;
        toastPayload = { msg, opts };
      },
      dispatchEvent: () => true,
    };

    // 1. Initial login: should reward 24.0000 ESMS and trigger notification
    const reward = await checkAndNotifyDailyLoginReward(ARCHETYPES.fireDominant, CELESTIAL_MOMENTS.equinox);
    expect(reward).not.toBeNull();
    expect(reward?.total).toBe(24.0);
    expect(toastCalled).toBe(true);
    expect(toastPayload.opts.title).toBe("✦ Daily Celestial Sign-In Reward");
    expect(toastPayload.msg).toContain("+24.0000 ESMS");

    // Verify claim timestamp was persisted
    const storedClaim = storage.get(DAILY_CLAIM_STORAGE_KEY);
    expect(storedClaim).toBeDefined();

    // 2. Second login within 24h: should return null (cooldown active, no spam toast)
    toastCalled = false;
    const secondLogin = await checkAndNotifyDailyLoginReward(ARCHETYPES.fireDominant, CELESTIAL_MOMENTS.equinox);
    expect(secondLogin).toBeNull();
    expect(toastCalled).toBe(false);

    // 3. Fast-forward past 24 hours: should reward and notify again
    storage.set(DAILY_CLAIM_STORAGE_KEY, (Date.now() - 25 * 3600 * 1000).toString());
    const nextDayLogin = await checkAndNotifyDailyLoginReward(ARCHETYPES.waterDominant, CELESTIAL_MOMENTS.waterSky);
    expect(nextDayLogin).not.toBeNull();
    expect(nextDayLogin?.total).toBe(24.0);
    expect(toastCalled).toBe(true);
    expect(nextDayLogin?.essence).toBeGreaterThan(12.0); // Water dominant in Water sky
  });
});

