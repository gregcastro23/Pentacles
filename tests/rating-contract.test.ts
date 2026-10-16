import { describe, it, expect } from 'bun:test';
import {
  clampStat,
  computeOvr,
  computeRelativeAdvantage,
  resolveArchetype,
  evaluateSealTier,
  evaluateSurgeState,
  determineMonicaState,
  computeMeanAlignedRating,
  buildCanonicalSeal,
  ROSTER_BASELINE_RATINGS,
  GLOBAL_ROSTER_MEAN,
  FIXTURE_AGENTS,
  SACRED_STAT_KEYS,
  SEAL_STAT_GATES,
  SEAL_ESMS_GATES,
  CANONICAL_SEAL_CATALOG,
} from '../src/lib/agents/rating-contract';

describe('Vessel Rating & Resonance Surge Contract', () => {
  describe('Sacred 7 Stats & Clamping', () => {
    it('has exactly 7 canonical sacred stat keys', () => {
      expect(SACRED_STAT_KEYS).toEqual([
        'power',
        'resonance',
        'wisdom',
        'charisma',
        'intuition',
        'adaptability',
        'vitality',
      ]);
    });

    it('clamps values strictly onto [25, 99]', () => {
      expect(clampStat(10)).toBe(25);
      expect(clampStat(-50)).toBe(25);
      expect(clampStat(25)).toBe(25);
      expect(clampStat(88)).toBe(88);
      expect(clampStat(99)).toBe(99);
      expect(clampStat(120)).toBe(99);
      expect(clampStat(NaN)).toBe(25);
    });
  });

  describe('OWA OVR Calculation', () => {
    it('calculates OVR with 1.6 top stat, 1.3 second stat, 1.0 rest', () => {
      const flat50 = {
        power: 50,
        resonance: 50,
        wisdom: 50,
        charisma: 50,
        intuition: 50,
        adaptability: 50,
        vitality: 50,
      };
      expect(computeOvr(flat50)).toBe(50);

      // Top stat 99, second 90, rest 50
      // weightedSum = 99*1.6 (158.4) + 90*1.3 (117) + 50*5 (250) = 525.4
      // 525.4 / 7.9 = 66.506 -> rounds to 67
      const skewed = {
        power: 99,
        resonance: 90,
        wisdom: 50,
        charisma: 50,
        intuition: 50,
        adaptability: 50,
        vitality: 50,
      };
      expect(computeOvr(skewed)).toBe(67);
    });
  });

  describe('Relative Advantage & Archetype Title Resolution', () => {
    it('computes relative advantage deltas against roster baseline', () => {
      const stats = {
        power: 73,
        resonance: 62,
        wisdom: 84,
        charisma: 61,
        intuition: 72,
        adaptability: 63,
        vitality: 72,
      };
      const relAdv = computeRelativeAdvantage(stats);
      expect(relAdv.power).toBe(10.0);
      expect(relAdv.resonance).toBe(0.0);
      expect(relAdv.wisdom).toBe(20.0);
      expect(relAdv.charisma).toBe(0.0);
    });

    it('resolves primary and secondary signature archetype from relative advantage', () => {
      const relAdv = {
        power: 5.0,
        resonance: 25.0, // secondary
        wisdom: 10.0,
        charisma: 8.0,
        intuition: 32.0, // primary
        adaptability: 12.0,
        vitality: 4.0,
      };
      const arch = resolveArchetype(relAdv);
      expect(arch.primary).toBe('intuition');
      expect(arch.secondary).toBe('resonance');
      expect(arch.title).toBe('Reclusive Visionary');
    });

    it('resolves archetype when power is raw tallest bar but wisdom has highest relAdv', () => {
      const relAdv = {
        power: 27.0,
        resonance: 10.0,
        wisdom: 38.0,
        charisma: 12.0,
        intuition: 8.0,
        adaptability: 14.0,
        vitality: 15.0,
      };
      const arch = resolveArchetype(relAdv);
      expect(arch.primary).toBe('wisdom');
      expect(arch.secondary).toBe('power');
      expect(arch.title).toBe('Celestial Mechanist');
    });
  });

  describe('Mean-Aligned Seal Stat Gates & ESMS Gates', () => {
    it('aligns stat gates using roster baseline means to normalize power', () => {
      // Power has mean 76.5 while global mean is 68.0
      // So a raw power of 80 aligns to: 80 - 76.5 + 68.0 = 71.5 (does not reach 74 Copper gate)
      const alignedPower = computeMeanAlignedRating('power', 80);
      expect(alignedPower).toBeCloseTo(71.5, 1);

      // Raw wisdom 80 with mean 68.5 aligns to: 80 - 68.5 + 68.0 = 79.5 (qualifies for Copper >= 74)
      const alignedWisdom = computeMeanAlignedRating('wisdom', 80);
      expect(alignedWisdom).toBeCloseTo(79.5, 1);
    });

    it('evaluates seal tiers using exact planetary-agents thresholds (0.5 / 2.0 / 10.0 / 50.0 / 250.0)', () => {
      expect(SEAL_ESMS_GATES.Copper).toBe(0.5);
      expect(SEAL_ESMS_GATES.Silver).toBe(2.0);
      expect(SEAL_ESMS_GATES.Gold).toBe(10.0);
      expect(SEAL_ESMS_GATES.Aether).toBe(50.0);
      expect(SEAL_ESMS_GATES.Celestial).toBe(250.0);

      // Wisdom: raw 98 -> aligned 97.5 (>= 96), ESMS 250 -> Celestial
      expect(evaluateSealTier('wisdom', 98, 250, false)).toBe('Celestial');

      // Wisdom: raw 98 -> aligned 97.5, ESMS 60 -> Aether
      expect(evaluateSealTier('wisdom', 98, 60, false)).toBe('Aether');

      // Wisdom: raw 98 -> aligned 97.5, ESMS 15 -> Gold
      expect(evaluateSealTier('wisdom', 98, 15, false)).toBe('Gold');

      // Wisdom: raw 98 -> aligned 97.5, ESMS 3 -> Silver
      expect(evaluateSealTier('wisdom', 98, 3, false)).toBe('Silver');

      // Wisdom: raw 98 -> aligned 97.5, ESMS 1 -> Copper
      expect(evaluateSealTier('wisdom', 98, 1, false)).toBe('Copper');
    });

    it('strictly denies Celestial to placeholder charts (caps at Aether)', () => {
      expect(evaluateSealTier('wisdom', 98, 300, true)).toBe('Aether');
    });

    it('maps all 7 canonical seals correctly', () => {
      expect(CANONICAL_SEAL_CATALOG.power.name).toBe('Crucible Finisher');
      expect(CANONICAL_SEAL_CATALOG.intuition.name).toBe('Astral Vision');
      expect(CANONICAL_SEAL_CATALOG.vitality.name).toBe('Immovable Foundation');
      expect(CANONICAL_SEAL_CATALOG.charisma.name).toBe('Harmonic Sovereign');
      expect(CANONICAL_SEAL_CATALOG.resonance.name).toBe('Tidal Chorus');
      expect(CANONICAL_SEAL_CATALOG.adaptability.name).toBe('Quicksilver Pivot');
      expect(CANONICAL_SEAL_CATALOG.wisdom.name).toBe('Philosopher\'s Stone');

      const built = buildCanonicalSeal('power', 'Gold');
      expect(built.name).toBe('Crucible Finisher');
      expect(built.category).toBe('substance');
      expect(built.tier).toBe('Gold');
    });
  });

  describe('Resonance Surge & Monica Harmonics', () => {
    it('evaluates monica state accurately', () => {
      expect(determineMonicaState(null)).toBe('absent');
      expect(determineMonicaState(undefined)).toBe('absent');
      expect(determineMonicaState(1.618)).toBe('equilibrium');
      expect(determineMonicaState(0.75)).toBe('convergent');
      expect(determineMonicaState(-0.4)).toBe('divergent');
    });

    it('activates inferno surge when heat >= reactivity and meter >= 70', () => {
      const surge = evaluateSurgeState(75, 0.8, 0.4, 'wisdom', 'power', 0.5);
      expect(surge.active).toBe(true);
      expect(surge.surgeType).toBe('inferno');
      expect(surge.statBoosts.wisdom).toBe(12);
      expect(surge.statBoosts.power).toBe(8);
      expect(surge.statBoosts.vitality).toBe(4);
    });

    it('activates tempest surge when reactivity > heat and meter >= 70', () => {
      const surge = evaluateSurgeState(82, 0.3, 0.9, 'intuition', 'resonance', null);
      expect(surge.active).toBe(true);
      expect(surge.surgeType).toBe('tempest');
      expect(surge.statBoosts.intuition).toBe(12);
      expect(surge.statBoosts.resonance).toBe(8);
      expect(surge.statBoosts.power).toBe(4);
    });

    it('activates equilibrium surge when monica is 1.618 and applies dual stat boosts', () => {
      const surge = evaluateSurgeState(78, 0.7, 0.7, 'adaptability', 'wisdom', 1.618);
      expect(surge.active).toBe(true);
      expect(surge.surgeType).toBe('equilibrium');
      expect(surge.monicaState).toBe('equilibrium');
      // Dual harmonic boosts
      expect(surge.statBoosts.adaptability).toBe(16);
      expect(surge.statBoosts.wisdom).toBe(12);
      expect(surge.statBoosts.power).toBe(8);
    });

    it('remains inactive when meter < 70', () => {
      const surge = evaluateSurgeState(68, 0.9, 0.9, 'power', 'vitality', 1.618);
      expect(surge.active).toBe(false);
      expect(Object.keys(surge.statBoosts).length).toBe(0);
    });
  });

  describe('Deterministic Fixtures', () => {
    it('provides exactly 4 deterministic test fixtures', () => {
      expect(FIXTURE_AGENTS.length).toBe(4);
      const keys = FIXTURE_AGENTS.map((a) => a.key);
      expect(keys).toContain('isaac-newton');
      expect(keys).toContain('emily-dickinson');
      expect(keys).toContain('leonardo-da-vinci');
      expect(keys).toContain('user-avatar-neo');
    });

    it('has Leonardo da Vinci in equilibrium surge with monica 1.618', () => {
      const leo = FIXTURE_AGENTS.find((a) => a.key === 'leonardo-da-vinci')!;
      expect(leo.surge.active).toBe(true);
      expect(leo.surge.surgeType).toBe('equilibrium');
      expect(leo.surge.monica).toBe(1.618);
      expect(leo.surge.monicaState).toBe('equilibrium');
      expect(leo.surge.statBoosts.adaptability).toBe(16);
      expect(leo.surge.statBoosts.wisdom).toBe(12);
    });
  });
});
