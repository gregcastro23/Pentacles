import { describe, expect, it } from "bun:test";
import {
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
} from "../src/faucet/discriminant-faucet.js";
import {
  checkAndNotifyDailyLoginReward,
  notifyDailySignInReward,
  DAILY_CLAIM_STORAGE_KEY,
} from "../src/faucet/login-notifier.js";

// Canonical transit configurations from ADR-015 benchmark
const CELESTIAL_MOMENTS = {
  fireSky: [5.0, 1.5, 1.5, 2.0],        // Moment 1: Fire Sky Transit
  waterSky: [1.0, 5.5, 2.0, 1.5],       // Moment 2: Water Sky Transit
  earthStellium: [1.5, 2.0, 5.0, 1.5],  // Moment 3: Earth Stellium
  airSolstice: [2.0, 1.5, 1.5, 5.0],    // Moment 4: Air Solstice
  equinox: [2.5, 2.5, 2.5, 2.5],        // Moment 5: Equinoctial Equilibrium
  piscesSupermoonZeroFire: [0.0, 6.0, 2.0, 2.0], // Zero-Fire Sky (Pisces Supermoon)
};

// Canonical Archetypal Natal Vectors (Spirit, Essence, Matter, Substance)
const ARCHETYPES = {
  fireDominant: { alchemicalElements: { spirit: 50, essence: 15, matter: 15, substance: 20 } },
  waterDominant: { alchemicalElements: { spirit: 10, essence: 55, matter: 20, substance: 15 } },
  earthDominant: { alchemicalElements: { spirit: 15, essence: 20, matter: 50, substance: 15 } },
  airDominant: { alchemicalElements: { spirit: 20, essence: 15, matter: 15, substance: 50 } },
  neutral: { alchemicalElements: { spirit: 25, essence: 25, matter: 25, substance: 25 } },
  degenerateStellium: { alchemicalElements: { spirit: 100, essence: 0, matter: 0, substance: 0 } },
};

describe("ADR-015 Universal Astrological Faucet — Protocol Invariant Matrix", () => {
  // TEST-01: INV-1 Daily Total Elastic Band Invariant [6.0000, 48.0000]
  it("[TEST-01] enforces daily total within [6.0000, 48.0000] and exact 10^4 quantization", () => {
    for (const [mName, weights] of Object.entries(CELESTIAL_MOMENTS)) {
      for (const [aName, chart] of Object.entries(ARCHETYPES)) {
        const result = computeDailySignInYield(chart, weights);
        const sum = Number((result.spirit + result.essence + result.matter + result.substance).toFixed(4));
        
        // Exact sum equality
        expect(sum).toBe(result.total);
        
        // Invariant 1: Within Protocol Band [6.0, 48.0]
        expect(result.total).toBeGreaterThanOrEqual(PROTOCOL_BAND.Y_MIN);
        expect(result.total).toBeLessThanOrEqual(PROTOCOL_BAND.Y_MAX);

        // Invariant 2: Operational Gas Floor on EVERY axis
        expect(result.spirit).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
        expect(result.essence).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
        expect(result.matter).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
        expect(result.substance).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
      }
    }
  });

  // TEST-02: Symmetric Neutral Baseline
  it("[TEST-02] produces exact symmetric 6.0000 payout under neutral chart and equinoctial sky", () => {
    const balancedSupply = [25000, 25000, 25000, 25000];
    const result = computeDailySignInYield(ARCHETYPES.neutral, CELESTIAL_MOMENTS.equinox, balancedSupply);

    expect(result.resonanceMultiplier).toBe(1.0);
    expect(result.total).toBe(24.0);
    expect(result.spirit).toBe(6.0);
    expect(result.essence).toBe(6.0);
    expect(result.matter).toBe(6.0);
    expect(result.substance).toBe(6.0);
  });

  // TEST-03: INV-2 Operational Gas Floor (Resolving 19-Day Fire Outage)
  it("[TEST-03] guarantees SPIRIT >= 0.5000 kinetic gas even under 0% celestial Fire sky", () => {
    // Under zero Fire celestial sky (Pisces Supermoon)
    const resultZeroFire = computeDailySignInYield(
      ARCHETYPES.waterDominant,
      CELESTIAL_MOMENTS.piscesSupermoonZeroFire
    );

    // In ADR-014, this would collapse to 0.0000 SPIRIT (breaking game combat)
    // Under ADR-015, operational gas floor guarantees >= 0.5000 SPIRIT
    expect(resultZeroFire.spirit).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
    expect(resultZeroFire.essence).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
    expect(resultZeroFire.matter).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
    expect(resultZeroFire.substance).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
  });

  // TEST-04: Counter-Cyclical Anti-Glut Damping Suppression
  it("[TEST-04] compresses MATTER yield via Ω_MATTER = 0.750 when MATTER exceeds 30% supply", () => {
    // Under live network state (37.51% MATTER glut)
    const undampedSupply = [25000, 25000, 25000, 25000];
    const dampedSupply = null; // defaults to 37.51% MATTER glut (0.750)

    const dampedResult = computeDailySignInYield(ARCHETYPES.neutral, CELESTIAL_MOMENTS.earthStellium, dampedSupply);
    const undampedResult = computeDailySignInYield(ARCHETYPES.neutral, CELESTIAL_MOMENTS.earthStellium, undampedSupply);

    // Damping compresses MATTER allocation
    expect(dampedResult.matter).toBeLessThan(undampedResult.matter);
    expect(dampedResult.matter).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
  });

  // TEST-05: INV-3 Annual Emission Neutrality
  it("[TEST-05] ensures annual integrated yield stays within ±5% of 365 * 24 = 8,760 ESMS", () => {
    // Simulate 365 days cycling through celestial moments
    const momentsList = [
      CELESTIAL_MOMENTS.fireSky,
      CELESTIAL_MOMENTS.waterSky,
      CELESTIAL_MOMENTS.earthStellium,
      CELESTIAL_MOMENTS.airSolstice,
      CELESTIAL_MOMENTS.equinox,
    ];

    for (const [aName, chart] of Object.entries(ARCHETYPES)) {
      let annualTotal = 0;
      for (let day = 0; day < 365; day++) {
        const moment = momentsList[day % momentsList.length];
        const claim = computeDailySignInYield(chart, moment);
        annualTotal += claim.total;
      }

      const expectedAnnual = 365 * 24.0; // 8,760 ESMS
      const ratio = annualTotal / expectedAnnual;

      // Within ±5% of annual neutrality (ADR-015 INV-3)
      expect(ratio).toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.05);
    }
  });

  // TEST-06: INV-5 Stellium Normalisation (Cancels Chart-Shape Min-Maxing)
  it("[TEST-06] eliminates the degenerate stellium exploit via self-normalisation S̄(N)", () => {
    // An honest neutral chart vs a degenerate 100% Fire stellium chart
    const momentsList = [
      CELESTIAL_MOMENTS.fireSky,
      CELESTIAL_MOMENTS.waterSky,
      CELESTIAL_MOMENTS.earthStellium,
      CELESTIAL_MOMENTS.airSolstice,
      CELESTIAL_MOMENTS.equinox,
    ];

    let neutralAnnual = 0;
    let stelliumAnnual = 0;

    for (let day = 0; day < 365; day++) {
      const moment = momentsList[day % momentsList.length];
      neutralAnnual += computeDailySignInYield(ARCHETYPES.neutral, moment).total;
      stelliumAnnual += computeDailySignInYield(ARCHETYPES.degenerateStellium, moment).total;
    }

    // Degenerate stellium cannot extract > 5% annual excess over an honest chart (ADR-015 INV-5)
    const divergence = Math.abs(stelliumAnnual - neutralAnnual) / neutralAnnual;
    expect(divergence).toBeLessThan(0.05);
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
    const regularWin = computeMeleeRoundWinYield({
      winningScore: 120,
      tricksWon: 7,
      cleanSweep: false,
      favoredSuitMatch: false,
      natalChart: ARCHETYPES.fireDominant,
      liveTransitSky: CELESTIAL_MOMENTS.fireSky,
    });

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

    // Verify mathematical conservation of the round payout and gas floors
    const sum = Number((grandSlam.spirit + grandSlam.essence + grandSlam.matter + grandSlam.substance).toFixed(4));
    expect(sum).toBe(grandSlam.total);
    expect(grandSlam.spirit).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
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

    expect(crownCap.breakdown.inFluxMultiplier).toBe(2.5);
    expect(crownCap.breakdown.ingressMultiplier).toBe(2.0);
    expect(crownCap.total).toBeGreaterThan(250.0);

    // Verify mathematical conservation and gas floors
    const sum = Number((crownCap.spirit + crownCap.essence + crownCap.matter + crownCap.substance).toFixed(4));
    expect(sum).toBe(crownCap.total);
    expect(crownCap.spirit).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
    expect(crownCap.essence).toBeGreaterThanOrEqual(AXIS_GAS_FLOOR);
  });

  // TEST-10: 10-Day Decan Boundary Zone Retention & Sovereign Treasury
  it("[TEST-10] calculates Decan Boundary zone retention dividends and crowns sovereign champion", () => {
    const baseHouse = computeDecanRetentionDividend({
      zoneId: 1,
      control: 500,
      hasZodiacSeal: false,
    });
    expect(baseHouse.totalYield).toBe(100.0);

    const fortifiedSpire = computeDecanRetentionDividend({
      zoneId: 6,
      control: 1000,
      hasZodiacSeal: true,
      decanSuitMatch: true,
    });
    expect(fortifiedSpire.totalYield).toBe(431.25);

    const crownRetention = computeDecanRetentionDividend({
      zoneId: 10,
      control: 1000,
      hasZodiacSeal: false,
    });
    expect(crownRetention.totalYield).toBe(500.0);
    expect(DECAN_CHAMPION_SOVEREIGN_TREASURY).toBe(500.0);
  });

  // TEST-11: StarVault Continuous Staking Accrual Rate (ADR-014 §5.3)
  it("[TEST-11] calculates StarVault staking yield accrual rate and triggers Ascendant burst", () => {
    const normalRate = computeStarStakingAccrualRate({
      starElement: 0,
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
      isAscendantBurst: true,
    });

    expect(normalRate).toBeGreaterThan(0.0006);
    expect(burstRate).toBeCloseTo(normalRate * 2.0, 6);
  });

  // TEST-12: Automated Daily Login Notification System
  it("[TEST-12] automatically awards and notifies users of daily login ESMS with dynamic resonance", async () => {
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

    // 1. Initial login: should reward dynamic ESMS and trigger notification
    const reward = await checkAndNotifyDailyLoginReward(ARCHETYPES.fireDominant, CELESTIAL_MOMENTS.equinox);
    expect(reward).not.toBeNull();
    expect(reward?.total).toBeGreaterThanOrEqual(PROTOCOL_BAND.Y_MIN);
    expect(reward?.total).toBeLessThanOrEqual(PROTOCOL_BAND.Y_MAX);
    expect(toastCalled).toBe(true);
    expect(toastPayload.opts.title).toBe("✦ Daily Celestial Sign-In Grant");
    expect(toastPayload.msg).toContain(`${reward?.total.toFixed(4)} ESMS`);

    // Verify claim timestamp was persisted
    const storedClaim = storage.get(DAILY_CLAIM_STORAGE_KEY);
    expect(storedClaim).toBeDefined();

    // 2. Second login within 24h: should return null (cooldown active)
    toastCalled = false;
    const secondLogin = await checkAndNotifyDailyLoginReward(ARCHETYPES.fireDominant, CELESTIAL_MOMENTS.equinox);
    expect(secondLogin).toBeNull();
    expect(toastCalled).toBe(false);

    // 3. Fast-forward past 24 hours: should reward and notify again with dynamic resonance
    storage.set(DAILY_CLAIM_STORAGE_KEY, (Date.now() - 25 * 3600 * 1000).toString());
    const nextDayLogin = await checkAndNotifyDailyLoginReward(ARCHETYPES.waterDominant, CELESTIAL_MOMENTS.waterSky);
    expect(nextDayLogin).not.toBeNull();
    expect(nextDayLogin?.total).toBeGreaterThanOrEqual(PROTOCOL_BAND.Y_MIN);
    expect(toastCalled).toBe(true);
    expect(nextDayLogin?.essence).toBeGreaterThan(nextDayLogin?.spirit || 0); // Water dominant in Water sky
  });
});
