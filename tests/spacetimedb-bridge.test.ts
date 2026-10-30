import { describe, it, expect, mock } from 'bun:test';
import {
  spacetimedbBridge,
  normalizeOwnerFaction,
  simulateRustVesselCombatRating,
  RUST_VESSEL_CONTEST_MODULE,
  SpacetimeDBBridge,
} from '../src/lib/agents/spacetimedb-bridge';
import { PentacleArena3D } from '../src/lib/agents/pentacle-arena-3d';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';
import { liveWalletSync } from '../src/lib/agents/live-wallet-sync';

describe('SpacetimeDB Client Bridge & Rust Server Reducer Alignment', () => {
  it('uses the new row in SDK update callbacks and removes listeners on disconnect', () => {
    const updates = new Set<Function>();
    const bridge = new SpacetimeDBBridge();
    const arena = new PentacleArena3D();
    bridge.attachArena(arena);
    bridge.connect({ db: { zone: {
      iter: () => [],
      onUpdate: (listener: Function) => updates.add(listener),
      removeOnUpdate: (listener: Function) => updates.delete(listener),
    } } });
    for (const update of updates) update(
      { event: 'update' },
      { zoneId: 0, owner: { tag: 'Sun' }, control: 100 },
      { zoneId: 0, owner: { tag: 'Jupiter' }, control: 800, inFlux: true, fluxLevel: 90 },
    );
    expect(arena.zones.get(0)?.owner).toBe(5);
    expect(arena.zones.get(0)?.control).toBe(800);
    expect(arena.zones.get(0)?.inFlux).toBe(true);
    bridge.disconnect();
    expect(updates.size).toBe(0);
    arena.destroy();
  });

  it('waits for applied snapshots, queues fresh beats once, and rehydrates reconnects without replay', async () => {
    const snapshots: Record<string, any[]> = {
      zone: [{ zone_id: 0, owner: 6, control: 500 }],
      agent_chart: [{ identity: 'newton-id', handle: 'Isaac Newton' }, { identity: 'emily-id', handle: 'Emily Dickinson' }],
      player: [],
      melee_table: [{ table_id: 10n, zone_id: 0, state: 'Seated', round_index: 1n }],
      melee_seat: [
        { seat_id: 1n, table_id: 10n, occupant: 'newton-id', faction: 6, is_human: false },
        { seat_id: 2n, table_id: 10n, occupant: 'emily-id', faction: 3, is_human: false },
      ],
      melee_play: [{ play_id: 1n, table_id: 10n, seat_id: 1n, trick_number: 0 }],
      melee_trick: [],
    };
    const listeners = new Map<string, (rows: any[]) => void>();
    const bridge = new SpacetimeDBBridge();
    const arena = new PentacleArena3D();
    const completed: Array<() => void> = [];
    const clash = mock(() => new Promise<void>(resolve => completed.push(resolve)));
    const outcome = mock(() => new Promise<void>(resolve => completed.push(resolve)));
    arena.animateZoneContest = clash;
    arena.animateTrickOutcome = outcome;
    bridge.attachArena(arena);
    let applied = false;
    const client = { conn: {}, isApplied: () => applied, subscribe: (table: string, callback: (rows: any[]) => void) => {
      listeners.set(table, callback);
      callback([]);
      return () => listeners.delete(table);
    } };
    bridge.connect(client);
    expect(arena.avatarRegistry.size).toBe(0);
    applied = true;
    for (const [table, callback] of listeners) callback(snapshots[table]);
    const newton = arena.avatarRegistry.get('isaac-newton')!.group;
    expect(arena.avatarRegistry.size).toBe(2);
    expect(clash).toHaveBeenCalledTimes(0);
    snapshots.melee_play.push({ play_id: 2n, table_id: 10n, seat_id: 2n, trick_number: 0 });
    listeners.get('melee_play')!(snapshots.melee_play);
    listeners.get('melee_play')!(snapshots.melee_play);
    expect(clash).toHaveBeenCalledTimes(1);
    expect(clash).toHaveBeenLastCalledWith(0, 'emily-dickinson', 'isaac-newton');
    snapshots.melee_trick = [{ trick_id: 1n, table_id: 10n, winner_seat: 1n, trick_number: 0n }];
    listeners.get('melee_trick')!(snapshots.melee_trick);
    listeners.get('melee_trick')!(snapshots.melee_trick);
    expect(clash).toHaveBeenCalledTimes(1);
    expect(outcome).toHaveBeenCalledTimes(0);
    completed.shift()!();
    await Promise.resolve();
    expect(clash).toHaveBeenCalledTimes(1);
    expect(outcome).toHaveBeenCalledTimes(1);
    expect(outcome).toHaveBeenLastCalledWith(0, 'isaac-newton', 'emily-dickinson');
    completed.shift()!();
    await Promise.resolve();
    client.conn = {};
    snapshots.melee_play.push({ play_id: 3n, table_id: 10n, seat_id: 1n, trick_number: 1 });
    snapshots.melee_play.push({ play_id: 4n, table_id: 10n, seat_id: 2n, trick_number: 1 });
    snapshots.melee_trick.push({ trick_id: 2n, table_id: 10n, winner_seat: 2n, trick_number: 1 });
    for (const [table, callback] of listeners) callback(snapshots[table]);
    expect(clash).toHaveBeenCalledTimes(1);
    expect(outcome).toHaveBeenCalledTimes(1);
    listeners.get('melee_table')!([{ ...snapshots.melee_table[0], zone_id: 1 }]);
    for (let i = 0; i < 10; i++) arena.update(0.1);
    expect(arena.avatarRegistry.get('isaac-newton')!.group === newton).toBe(true);
    expect(newton.userData.zoneId).toBe(1);
    expect(arena.avatarRegistry.size).toBe(2);
    listeners.get('melee_seat')!([]);
    expect(arena.avatarRegistry.size).toBe(0);
    bridge.disconnect();
    expect(listeners.size).toBe(0);
    arena.destroy();
  });

  it('notifies agent/table listeners through the connected SDK path', () => {
    const callbacks = new Map<string, Function>();
    const handle = (name: string) => ({
      iter: () => [],
      onUpdate: (callback: Function) => callbacks.set(name, callback),
      removeOnUpdate: () => callbacks.delete(name),
    });
    const bridge = new SpacetimeDBBridge();
    const chartListener = mock(() => {}), tableListener = mock(() => {});
    bridge.onAgentChartUpdate(chartListener);
    bridge.onMeleeTableUpdate(tableListener);
    bridge.connect({ db: { agentChart: handle('chart'), meleeTable: handle('table') } });
    const chart = { identity: 'npc', handle: 'Isaac Newton' };
    const table = { tableId: 1n, zoneId: 0, roundIndex: 1n };
    callbacks.get('chart')!({}, { ...chart, handle: 'old' }, chart);
    callbacks.get('table')!({}, { ...table, zoneId: 4 }, table);
    expect(chartListener).toHaveBeenLastCalledWith(chart);
    expect(tableListener).toHaveBeenLastCalledWith(table);
    bridge.disconnect();
  });
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

    it('supports dispatchTrickResolution with object payload and exposes spacetimeCourtBridge singleton', async () => {
      const bridge = new SpacetimeDBBridge();
      const arena = new PentacleArena3D();
      arena.loadFixtures();
      bridge.attachArena(arena);

      let contestCalled = false;
      arena.animateZoneContest = mock(async () => {
        contestCalled = true;
      });

      await bridge.dispatchTrickResolution({
        zoneId: 2,
        winnerAgentId: 'isaac-newton',
        loserAgentId: 'nikola-tesla',
        winningSuit: 'Cups',
        trickNumber: 1,
      });

      expect(contestCalled).toBe(true);
      arena.destroy();
    });

    it('supports dispatchConversionSettlement and dispatchStarStakeUpdate with object payload', () => {
      const bridge = new SpacetimeDBBridge();
      const arena = new PentacleArena3D();
      arena.loadFixtures();
      bridge.attachArena(arena);

      const timelineEvents: any[] = [];
      bridge.onTimelineEvent(evt => timelineEvents.push(evt));

      // 1. Conversion settlement on Isaac Newton
      bridge.dispatchConversionSettlement({
        escrowId: 'escrow-mainnet-001',
        agentId: 'isaac-newton',
        status: 'settled',
        spiritAtoms: '250000000000000000000',
        essenceAtoms: '120000000000000000000',
        matterAtoms: '95000000000000000000',
        substanceAtoms: '180000000000000000000',
      });

      expect(timelineEvents.length).toBe(1);
      expect(timelineEvents[0].type).toBe('rating');
      expect(timelineEvents[0].agentKey).toBe('isaac-newton');
      expect(timelineEvents[0].summary).toContain('escrow-mainnet-001');

      // 2. Star stake update
      bridge.dispatchStarStakeUpdate({
        stakeId: 42,
        starId: 'regulus-alpha-leonis',
        stakerIdentity: 'isaac-newton',
        usdcPrincipalMicros: '500000000',
        claimedEssenceAtoms: '75000000000000000000',
      });

      expect(timelineEvents.length).toBe(2);
      expect(timelineEvents[1].type).toBe('rating');
      expect(timelineEvents[1].summary).toContain('regulus-alpha-leonis');
      expect(timelineEvents[1].detail).toContain('500.00 USDC');

      arena.destroy();
    });
  });
});
