import { describe, it, expect } from 'bun:test';
import {
  computeEffectiveContestRating,
  resolveTileContest,
  ZONE_STAT_WEIGHTS,
} from '../src/lib/agents/tile-contest';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';

describe('Deterministic Tile-Contest Resolution Engine', () => {
  const newton = FIXTURE_AGENTS[0]; // OVR 94, Celestial & Astral seals, inactive surge
  const emily = FIXTURE_AGENTS[1]; // OVR 88, active tempest Surge (meter 86, +12 intuition, +8 resonance)
  const leo = FIXTURE_AGENTS[2]; // OVR 96, 2x Celestial seals, active equilibrium Surge
  const neo = FIXTURE_AGENTS[3]; // OVR 83, Gold & Silver seals

  describe('Zone Stat Affinity & Effective Contest Rating', () => {
    it('applies distinct weights for Houses, Spires, and Crown', () => {
      expect(ZONE_STAT_WEIGHTS.house.power).toBeGreaterThan(ZONE_STAT_WEIGHTS.house.wisdom);
      expect(ZONE_STAT_WEIGHTS.spire.resonance).toBeGreaterThan(ZONE_STAT_WEIGHTS.spire.power);
      expect(ZONE_STAT_WEIGHTS.crown.wisdom).toBeGreaterThan(ZONE_STAT_WEIGHTS.crown.vitality);
    });

    it('gives Emily Dickinson significant boost from active tempest Surge on Spires', () => {
      const emilySpire = computeEffectiveContestRating(emily, 'spire');
      expect(emilySpire.surgeBonus).toBe(0.08); // +8% momentum
      expect(emilySpire.rating).toBeGreaterThan(emily.ovr); // ECR climbs above base OVR
    });

    it('rewards Leonardo da Vinci for equilibrium Surge (+12% momentum) and Celestial seals', () => {
      const leoCrown = computeEffectiveContestRating(leo, 'crown');
      expect(leoCrown.sealBonus).toBeGreaterThan(0.2);
      expect(leoCrown.surgeBonus).toBe(0.12); // +12% for equilibrium
      expect(leoCrown.rating).toBeGreaterThan(leo.ovr);
    });
  });

  describe('Tile Contest Resolution Math', () => {
    it('resolves contest deterministically between Newton and Neo on House 0', () => {
      const result = resolveTileContest(0, 'house', newton, neo, { zoneCurrentControl: 0 });
      expect(result.winner).toBe('challenger');
      expect(result.winnerKey).toBe('isaac-newton');
      expect(result.loserKey).toBe('user-avatar-neo');
      expect(result.margin).toBeGreaterThan(0);
      expect(result.newZoneControl).toBeLessThan(0); // swings in challenger's favor
      expect(result.log.length).toBeGreaterThan(0);
    });

    it('defends position when superior defender holds zone', () => {
      // Neo challenges Leonardo on Crown Zenith (Zone 10) with defender control 400
      const result = resolveTileContest(10, 'crown', neo, leo, { zoneCurrentControl: 400 });
      expect(result.winner).toBe('defender');
      expect(result.winnerKey).toBe('leonardo-da-vinci');
      expect(result.loserKey).toBe('user-avatar-neo');
      expect(result.newZoneControl).toBeGreaterThan(400); // defender fortifies control
    });

    it('clamps zone control strictly within [-1000, 1000]', () => {
      const result = resolveTileContest(5, 'spire', leo, neo, { zoneCurrentControl: -900 });
      expect(result.newZoneControl).toBeGreaterThanOrEqual(-1000);
      expect(result.newZoneControl).toBeLessThanOrEqual(1000);
    });

    it('identifies surge ignition state in contest telemetry', () => {
      const result = resolveTileContest(1, 'house', emily, newton, { zoneCurrentControl: 0 });
      expect(result.challengerSurgeIgnited).toBe(true);
      expect(result.defenderSurgeIgnited).toBe(false);
      expect(result.log.some((l) => l.includes('SURGE ACTIVE'))).toBe(true);
    });
  });
});
