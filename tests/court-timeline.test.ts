import { describe, expect, it, mock } from 'bun:test';
import {
  SpacetimeDBBridge,
  type CourtTimelineEvent,
  suitToEsmsElement,
  suitToSuitName,
} from '../src/lib/agents/spacetimedb-bridge';
import {
  formatCourtTimeAgo,
  EXAMPLE_TIMELINE_EVENTS,
  openPentacleCourt,
} from '../src/lib/agents/court-view';
import { PentacleArena3D } from '../src/lib/agents/pentacle-arena-3d';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';
import { setupVesselDomGlobals } from './helpers/vessel-dom';
import { liveWalletSync } from '../src/lib/agents/live-wallet-sync';

describe('Court Event Timeline (Arrivals & Contests)', () => {
  it('formats relative timestamps cleanly', () => {
    const now = Date.now();
    expect(formatCourtTimeAgo(now - 4000)).toBe('Just now');
    expect(formatCourtTimeAgo(now - 25000)).toBe('25s ago');
    expect(formatCourtTimeAgo(now - 180000)).toBe('3m ago');
    expect(formatCourtTimeAgo(now - 7200000)).toBe('2h ago');
  });

  it('exposes deterministic example events featuring canonical court vessels', () => {
    expect(EXAMPLE_TIMELINE_EVENTS.length).toBe(4);
    const keys = EXAMPLE_TIMELINE_EVENTS.map(e => e.agentKey);
    expect(keys).toContain('leonardo-da-vinci');
    expect(keys).toContain('isaac-newton');
    expect(keys).toContain('hypatia');
    expect(keys).toContain('emily-dickinson');

    const crownEvent = EXAMPLE_TIMELINE_EVENTS.find(e => e.zoneId === 10);
    expect(crownEvent).toBeDefined();
    expect(crownEvent?.type).toBe('contest');
    expect(crownEvent?.summary).toContain('Leonardo da Vinci');
  });

  it('records, queries, and dispatches timeline events through SpacetimeDBBridge', () => {
    const bridge = new SpacetimeDBBridge();
    expect(bridge.getTimeline()).toEqual([]);

    const events: CourtTimelineEvent[] = [];
    const unsubscribe = bridge.onTimelineEvent(evt => events.push(evt));

    const event1 = bridge.recordTimelineEvent({
      type: 'arrival',
      zoneId: 0,
      agentKey: 'isaac-newton',
      agentHandle: 'Isaac Newton',
      faction: 6,
      summary: 'Isaac Newton arrived at House of Aries',
      detail: 'Took owner position in House 0',
    });

    expect(bridge.getTimeline().length).toBe(1);
    expect(bridge.getTimeline()[0].id).toBe(event1.id);
    expect(events.length).toBe(1);
    expect(events[0].agentHandle).toBe('Isaac Newton');

    // Caps at 50 events
    for (let i = 0; i < 55; i++) {
      bridge.recordTimelineEvent({
        type: 'contest',
        zoneId: i % 11,
        agentKey: `agent-${i}`,
        agentHandle: `Agent ${i}`,
        faction: i % 10,
        summary: `Contest beat ${i}`,
      });
    }

    expect(bridge.getTimeline().length).toBe(50);
    unsubscribe();

    bridge.recordTimelineEvent({
      type: 'arrival',
      zoneId: 1,
      agentKey: 'hypatia',
      agentHandle: 'Hypatia',
      faction: 5,
      summary: 'Hypatia arrived at House 2',
    });
    // Listener should not receive events after unsubscribe
    expect(events.length).toBe(56);

    bridge.disconnect();
    expect(bridge.getTimeline()).toEqual([]);
  });

  it('automatically logs arrival events during arena avatar placement and movement', async () => {
    const bridge = new SpacetimeDBBridge();
    const arena = new PentacleArena3D();
    bridge.attachArena(arena);

    const snapshots: Record<string, any[]> = {
      zone: [{ zone_id: 0, owner: 6, control: 500 }],
      agent_chart: [{ identity: 'newton-id', handle: 'Isaac Newton' }],
      player: [],
      melee_table: [{ table_id: 10n, zone_id: 0, state: 'Seated', round_index: 0n }],
      melee_seat: [{ seat_id: 1n, table_id: 10n, occupant: 'newton-id', faction: 6, is_human: false }],
      melee_play: [],
      melee_trick: [],
    };

    const listeners = new Map<string, (rows: any[]) => void>();
    const client = {
      conn: {},
      isApplied: () => true,
      subscribe: (table: string, callback: (rows: any[]) => void) => {
        listeners.set(table, callback);
        callback(snapshots[table] ?? []);
        return () => listeners.delete(table);
      },
    };

    bridge.connect(client);

    // Initial placement on zone 0
    const timelineAfterPlacement = bridge.getTimeline();
    expect(timelineAfterPlacement.length).toBeGreaterThanOrEqual(1);
    const arrival1 = timelineAfterPlacement.find(e => e.agentKey === 'isaac-newton');
    expect(arrival1?.type).toBe('arrival');
    expect(arrival1?.zoneId).toBe(0);
    expect(arrival1?.summary).toContain('Isaac Newton');

    // Relocating table to zone 1 triggers deployment arrival
    snapshots.melee_table = [{ table_id: 10n, zone_id: 1, state: 'Seated', round_index: 0n }];
    listeners.get('melee_table')!(snapshots.melee_table);

    const timelineAfterMove = bridge.getTimeline();
    const arrival2 = timelineAfterMove[0];
    expect(arrival2.type).toBe('arrival');
    expect(arrival2.fromZoneId).toBe(0);
    expect(arrival2.targetZoneId).toBe(1);
    expect(arrival2.summary).toContain('deployed to');

    bridge.disconnect();
    arena.destroy();
  });

  it('automatically logs contest events when melee plays and tricks resolve', () => {
    const bridge = new SpacetimeDBBridge();
    const arena = new PentacleArena3D();
    bridge.attachArena(arena);

    const snapshots: Record<string, any[]> = {
      zone: [{ zone_id: 0, owner: 6, control: 500 }],
      agent_chart: [
        { identity: 'newton-id', handle: 'Isaac Newton' },
        { identity: 'emily-id', handle: 'Emily Dickinson' },
      ],
      player: [],
      melee_table: [{ table_id: 20n, zone_id: 0, state: 'Seated', round_index: 1n }],
      melee_seat: [
        { seat_id: 1n, table_id: 20n, occupant: 'newton-id', faction: 6, is_human: false },
        { seat_id: 2n, table_id: 20n, occupant: 'emily-id', faction: 3, is_human: false },
      ],
      melee_play: [{ play_id: 100n, table_id: 20n, seat_id: 1n, trick_number: 0 }],
      melee_trick: [],
    };

    const listeners = new Map<string, (rows: any[]) => void>();
    const client = {
      conn: {},
      isApplied: () => true,
      subscribe: (table: string, callback: (rows: any[]) => void) => {
        listeners.set(table, callback);
        callback(snapshots[table] ?? []);
        return () => listeners.delete(table);
      },
    };

    bridge.connect(client);

    // Dispatching a melee play produces a contest event
    snapshots.melee_play.push({ play_id: 101n, table_id: 20n, seat_id: 2n, trick_number: 0 });
    listeners.get('melee_play')!(snapshots.melee_play);

    const timelineAfterPlay = bridge.getTimeline();
    const playContest = timelineAfterPlay.find(e => e.type === 'contest');
    expect(playContest).toBeDefined();
    expect(playContest?.zoneId).toBe(0);
    expect(playContest?.agentKey).toBe('emily-dickinson');
    expect(playContest?.rivalKey).toBe('isaac-newton');
    expect(playContest?.summary).toContain('Emily Dickinson engaged Isaac Newton');

    // Resolving a trick produces a trick contest event
    snapshots.melee_trick.push({ trick_id: 50n, table_id: 20n, winner_seat: 1n, trick_number: 0 });
    listeners.get('melee_trick')!(snapshots.melee_trick);

    const timelineAfterTrick = bridge.getTimeline();
    const trickContest = timelineAfterTrick[0];
    expect(trickContest.type).toBe('contest');
    expect(trickContest.agentKey).toBe('isaac-newton');
    expect(trickContest.rivalKey).toBe('emily-dickinson');
    expect(trickContest.summary).toContain('Isaac Newton triumphed over Emily Dickinson in trick 0');

    bridge.disconnect();
    arena.destroy();
  });

  it('renders interactive timeline feed in Court View inspector and filters by territory and category', () => {
    const { cleanup } = setupVesselDomGlobals();
    try {
      const court = openPentacleCourt();
      const dialog = document.querySelector('dialog.pk-court') as HTMLElement;
      expect(dialog).toBeTruthy();

      // Switch to example vessels mode
      const exampleButton = dialog.querySelector('button[data-mode="examples"]') as HTMLButtonElement;
      exampleButton.click();

      const timelineHost = dialog.querySelector('.pk-court-timeline') as HTMLElement;
      const timelineCount = dialog.querySelector('.pk-court-timeline-count') as HTMLElement;
      expect(timelineHost).toBeTruthy();
      expect(timelineCount.textContent).toBe('4 / 4');

      const items = dialog.querySelectorAll('.pk-court-timeline-item');
      expect(items.length).toBe(4);

      // Verify first event is Leonardo da Vinci on Crown
      const firstItem = items[0] as HTMLButtonElement;
      expect(firstItem.textContent).toContain('CONTEST');
      expect(firstItem.textContent).toContain('Crown');
      expect(firstItem.textContent).toContain('Leonardo da Vinci');

      // Category filter: Contests only
      const contestCatBtn = dialog.querySelector('button[data-timeline-category="contest"]') as HTMLButtonElement;
      contestCatBtn.click();
      const contestItems = dialog.querySelectorAll('.pk-court-timeline-item');
      expect(contestItems.length).toBe(3);
      expect(timelineCount.textContent).toBe('3 / 4');

      // Category filter: Arrivals only
      const arrivalCatBtn = dialog.querySelector('button[data-timeline-category="arrival"]') as HTMLButtonElement;
      arrivalCatBtn.click();
      const arrivalItems = dialog.querySelectorAll('.pk-court-timeline-item');
      expect(arrivalItems.length).toBe(1);
      expect(timelineCount.textContent).toBe('1 / 4');
      expect(arrivalItems[0].textContent).toContain('Hypatia');

      // Reset Category filter: All
      const allCatBtn = dialog.querySelector('button[data-timeline-category="all"]') as HTMLButtonElement;
      allCatBtn.click();
      expect(dialog.querySelectorAll('.pk-court-timeline-item').length).toBe(4);

      // Territory filter to Crown (zone 10)
      const territorySelect = dialog.querySelector('select') as HTMLSelectElement;
      territorySelect.value = '10';
      territorySelect.dispatchEvent(new Event('change'));

      const filteredItems = dialog.querySelectorAll('.pk-court-timeline-item');
      expect(filteredItems.length).toBe(1);
      expect(filteredItems[0].textContent).toContain('Crown');
      expect(timelineCount.textContent).toBe('1 / 4');

      // Clicking the item triggers selection
      (filteredItems[0] as HTMLButtonElement).click();
      const detail = dialog.querySelector('.pk-court-detail') as HTMLElement;
      expect(detail.textContent).toContain('Crown');

      court.destroy();
      expect(document.querySelector('dialog.pk-court')).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('records rating shifts in timeline when agent ratings update live', () => {
    const bridge = new SpacetimeDBBridge();
    const arena = new PentacleArena3D();
    bridge.attachArena(arena);

    // Initial placement of avatar
    arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0], 'owner');

    // Simulate rating update on Newton
    const updatedNewton = {
      ...FIXTURE_AGENTS[0],
      ovr: 88,
      ratings: { ...FIXTURE_AGENTS[0].ratings, power: 90 },
    };

    arena.refreshAvatar(updatedNewton);
    const timeline = bridge.getTimeline();
    expect(timeline).toBeDefined();

    bridge.disconnect();
    arena.destroy();
  });

  it('maps winning card suits to elemental ESMS attack choreographies', () => {
    expect(suitToEsmsElement('wands')).toBe('spirit');
    expect(suitToEsmsElement('cups')).toBe('essence');
    expect(suitToEsmsElement('pentacles')).toBe('matter');
    expect(suitToEsmsElement('swords')).toBe('substance');

    expect(suitToSuitName('wands')).toBe('Wands');
    expect(suitToSuitName('cups')).toBe('Cups');
    expect(suitToSuitName('pentacles')).toBe('Pentacles');
    expect(suitToSuitName('swords')).toBe('Swords');

    const bridge = new SpacetimeDBBridge();
    const arena = new PentacleArena3D();
    bridge.attachArena(arena);
    arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0], 'owner');
    arena.placeAvatarOnZone(0, FIXTURE_AGENTS[3], 'challenger');

    // Dispatch a trick won with Swords (substance element)
    void bridge.dispatchTrickResolution(0, FIXTURE_AGENTS[0].key, FIXTURE_AGENTS[3].key, 'swords', 3);
    const event = bridge.getTimeline()[0];
    expect(event).toBeDefined();
    expect(event.type).toBe('contest');
    expect(event.summary).toContain('Swords');
    expect(event.detail).toContain('SUBSTANCE');

    bridge.disconnect();
    arena.destroy();
  });

  it('fast-forwards rapid successive pedestal clashes without dropped animations or state desync', async () => {
    const arena = new PentacleArena3D();
    const winner = arena.placeAvatarOnZone(1, FIXTURE_AGENTS[0], 'owner')!;
    const rival = arena.placeAvatarOnZone(1, FIXTURE_AGENTS[1], 'challenger')!;

    // Start trick 1 outcome
    const trick1 = arena.animateTrickOutcome(1, FIXTURE_AGENTS[0].key, FIXTURE_AGENTS[1].key, 'spirit');
    arena.update(0.1);
    expect(winner.userData.animationState).toBe('victory');
    expect(rival.userData.animationState).toBe('stagger');

    // While trick 1 is still ongoing, a rapid trick 2 resolves on the same pedestal
    let trick1Settled = false;
    trick1.then(() => { trick1Settled = true; });

    const trick2 = arena.animateTrickOutcome(1, FIXTURE_AGENTS[1].key, FIXTURE_AGENTS[0].key, 'essence');
    // Trick 1 should have been fast-forwarded / settled immediately by cancelContestsForZone
    await Promise.resolve();
    expect(trick1Settled).toBe(true);

    // Trick 2 roles should be active without delay
    arena.update(0.1);
    expect(rival.userData.animationState).toBe('victory');
    expect(winner.userData.animationState).toBe('stagger');

    arena.update(1.6);
    await trick2;
    expect(winner.userData.animationState).toBe('idle');
    expect(rival.userData.animationState).toBe('surge'); // Emily Dickinson restores to active surge state
    arena.destroy();
  });

  it('follows live combat in spectator mode when Follow Action toggle is enabled', () => {
    const { cleanup } = setupVesselDomGlobals();
    try {
      const court = openPentacleCourt({ faction: 0 });
      const dialog = court.getDialog();
      expect(court.isFollowingLive()).toBe(false);

      // Click spectator button
      const spectateBtn = dialog.querySelector('button[data-action="spectate"]') as HTMLButtonElement;
      expect(spectateBtn).toBeDefined();
      spectateBtn.click();
      expect(court.isFollowingLive()).toBe(true);
      expect(spectateBtn.getAttribute('aria-pressed')).toBe('true');

      // Trigger a live contest event through bridge
      const bridge = court.getBridge()!;
      const arena = court.getArena()!;
      arena.placeAvatarOnZone(2, FIXTURE_AGENTS[1], 'owner');
      arena.placeAvatarOnZone(2, FIXTURE_AGENTS[2], 'challenger');

      void bridge.dispatchTrickResolution(2, FIXTURE_AGENTS[1].key, FIXTURE_AGENTS[2].key, 'cups', 1);

      // Because followAction is true, the active pedestal was auto-selected
      expect(arena.selection?.agentId).toBe(FIXTURE_AGENTS[1].key);

      court.destroy();
    } finally {
      cleanup();
    }
  });

  it('handles Solana conversion escrow settlements, updating live wallet ESMS and seated court seals', () => {
    const bridge = new SpacetimeDBBridge();
    const arena = new PentacleArena3D();
    bridge.attachArena(arena);

    try {
      // Place Newton in zone 0
      const seated = arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0], 'owner')!;
      const initialShards = seated.userData.sealOrbiters.children.length;
      expect(initialShards).toBe(12); // Celestial (5) + Gold (3) + Astral (4)

      // Dispatch a confirmed Solana conversion escrow with high Spirit & Matter (15,000 ESMS each = 150000000 atoms)
      bridge.dispatchConversionSettlement('conv-sol-9821', FIXTURE_AGENTS[0].key, [
        '150000000', // 15,000 Spirit (4-dp atoms)
        '0',
        '200000000', // 20,000 Matter (4-dp atoms)
        '0',
      ]);

      // Check timeline event was recorded under 'rating'
      const timeline = bridge.getTimeline();
      const event = timeline.find(e => e.summary.includes('conv-sol-9821'));
      expect(event).toBeDefined();
      expect(event?.type).toBe('rating');
      expect(event?.agentHandle).toBe(FIXTURE_AGENTS[0].handle);
      expect(event?.detail).toContain('Spirit: 15000.0000');
      expect(event?.detail).toContain('Matter: 20000.0000');

      // LiveWalletSync was updated
      const cached = liveWalletSync.getCachedAgent(FIXTURE_AGENTS[0].key);
      expect(cached?.esms.spirit).toBe(15000);
      expect(cached?.esms.matter).toBe(20000);
      // Seal tiers upgraded from ESMS thresholds
      expect(cached?.seals.length).toBeGreaterThanOrEqual(3);

      // Seated court avatar was refreshed in-place
      expect(seated.userData.sealOrbiters.children.length).toBeGreaterThanOrEqual(initialShards);
      expect(arena.avatarRegistry.get(FIXTURE_AGENTS[0].key)?.group).toBe(seated);
    } finally {
      liveWalletSync.clearCache();
      arena.destroy();
    }
  });

  it('handles Solana Star Stake updates and formats USDC principal and claimed essence atoms accurately', () => {
    const bridge = new SpacetimeDBBridge();
    const arena = new PentacleArena3D();
    bridge.attachArena(arena);

    try {
      arena.placeAvatarOnZone(3, FIXTURE_AGENTS[1], 'owner');

      // Dispatch Star Stake position update for Hipparcos Star 44248
      // Principal: 50,000,000 (50 USDC at 6-dp), Claimed: 25000000000000000000 (25 ESMS at 18-dp)
      bridge.dispatchStarStakeUpdate(
        '77',
        FIXTURE_AGENTS[1].key,
        44248,
        '50000000', // 50 USDC
        '25000000000000000000', // 25 ESMS
        1 // Essence
      );

      const timeline = bridge.getTimeline();
      const event = timeline.find(e => e.summary.includes('Star stake #77'));
      expect(event).toBeDefined();
      expect(event?.type).toBe('rating');
      expect(event?.agentHandle).toBe(FIXTURE_AGENTS[1].handle);
      expect(event?.detail).toContain('Principal: 50.00 USDC');
      expect(event?.detail).toContain('Claimed: 250000 atoms (Essence)');
    } finally {
      arena.destroy();
    }
  });
});
