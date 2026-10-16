import { describe, it, expect } from 'bun:test';
import {
  spacetimedbBridge,
  normalizeOwnerFaction,
  simulateRustVesselCombatRating,
  RUST_VESSEL_CONTEST_MODULE,
} from '../src/lib/agents/spacetimedb-bridge';
import { PentacleArena3D } from '../src/lib/agents/pentacle-arena-3d';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';
import { liveWalletSync } from '../src/lib/agents/live-wallet-sync';

describe('SpacetimeDB Client Bridge & Rust Server Reducer Alignment', () => {
  describe('Client-Side Bridge & Offline Fallback', () => {
    it('operates safely in offline mock mode without active connection', () => {
      spacetimedbBridge.connect();
      expect(spacetimedbBridge.isOnline()).toBe(false);
    });

    it('normalizes owner factions from numbers, strings, and tagged unions', () => {
      expect(normalizeOwnerFaction(null)).toBeNull();
      expect(normalizeOwnerFaction(0)).toBe(0);
      expect(normalizeOwnerFaction(6)).toBe(6);
      expect(normalizeOwnerFaction({ tag: 'Sun' })).toBe(0);
      expect(normalizeOwnerFaction({ tag: 'Moon' })).toBe(1);
      expect(normalizeOwnerFaction({ tag: 'Saturn' })).toBe(6);
      expect(normalizeOwnerFaction({ tag: 'Unknown' })).toBeNull();
    });

    it('updates 3D Pentacle Arena zone pedestals when Zone table rows update', () => {
      const arena = new PentacleArena3D();
      spacetimedbBridge.attachArena(arena);

      // Push SpacetimeDB table update for Crown (Zone 10)
      spacetimedbBridge.handleZoneUpdate({
        zoneId: 10,
        owner: { tag: 'Jupiter' }, // Faction 5
        control: 650,
      });

      const zone10 = arena.zones.get(10)!;
      expect(zone10.owner).toBe(5);
      expect(zone10.control).toBe(650);

      // Push update for Spire 5 (Saturn held)
      spacetimedbBridge.handleZoneUpdate({
        zoneId: 5,
        owner: 6,
        control: -800,
      });

      const zone5 = arena.zones.get(5)!;
      expect(zone5.owner).toBe(6);
      expect(zone5.control).toBe(-800);

      spacetimedbBridge.detachArena();
      arena.destroy();
    });

    it('pipes live ESMS balance updates into Live Wallet Sync', () => {
      let notifiedKey = '';
      const unsubscribe = liveWalletSync.onAgentSync((agent) => {
        notifiedKey = agent.key;
      });

      const updated = spacetimedbBridge.handleAgentEsmsUpdate('isaac-newton', {
        spirit: 250.0,
        essence: 250.0,
        matter: 250.0,
        substance: 250.0,
      });

      expect(updated).not.toBeNull();
      expect(updated?.esms.spirit).toBe(250.0);
      expect(notifiedKey).toBe('isaac-newton');
      unsubscribe();
    });

    it('dispatches notifications to registered table listeners', () => {
      let receivedZone = -1;
      const unbind = spacetimedbBridge.onZoneUpdate((row) => {
        receivedZone = row.zoneId;
      });

      spacetimedbBridge.handleZoneUpdate({
        zoneId: 3,
        owner: 0,
        control: 500,
      });

      expect(receivedZone).toBe(3);
      unbind();
    });
  });

  describe('Rust Server Companion Reducer 1:1 Parity', () => {
    it('exports complete Rust reducer module code', () => {
      expect(RUST_VESSEL_CONTEST_MODULE).toContain('pub fn resolve_vessel_zone_contest');
      expect(RUST_VESSEL_CONTEST_MODULE).toContain('OWA_WEIGHT_PRIMARY: i32 = 1600');
      expect(RUST_VESSEL_CONTEST_MODULE).toContain('SEAL_MULT_CELESTIAL: i32 = 1250');
    });

    it('computes integer-scaled combat ratings with exact OWA weights and multipliers', () => {
      // 1. Base vessel without surge or seals
      const baseScore = simulateRustVesselCombatRating({
        ovr: 80,
        primaryStat: 90,
        secondaryStat: 80,
        tertiaryStat: 70,
        surgeActive: false,
        isEquilibrium: false,
        sealTier: 'Copper',
      });
      // OWA = (90*1600 + 80*1300 + 70*1000) / 3900 = (144000 + 104000 + 70000) / 3900 = 318000 / 3900 = 81
      // base = (81*60 + 80*40) / 100 = (4860 + 3200) / 100 = 80
      // withSeal (Copper 1.0) = 80
      // surge (1.0) = 80
      expect(baseScore).toBe(80);

      // 2. Celestial seal tier gives +25% boost (1.25x scale)
      const celestialScore = simulateRustVesselCombatRating({
        ovr: 80,
        primaryStat: 90,
        secondaryStat: 80,
        tertiaryStat: 70,
        surgeActive: false,
        isEquilibrium: false,
        sealTier: 'Celestial',
      });
      expect(celestialScore).toBe(Math.floor((80 * 1250) / 1000)); // 100

      // 3. Equilibrium surge gives additional +18% momentum boost
      const eqSurgeScore = simulateRustVesselCombatRating({
        ovr: 80,
        primaryStat: 90,
        secondaryStat: 80,
        tertiaryStat: 70,
        surgeActive: true,
        isEquilibrium: true,
        sealTier: 'Celestial',
      });
      expect(eqSurgeScore).toBe(Math.floor((100 * 1180) / 1000)); // 118
    });
  });
});
