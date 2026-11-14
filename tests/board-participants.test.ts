import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { BoardParticipantFeed, boardViewport, boardSeatDirections, resolveBoardParticipants, type BoardTables } from '../src/lib/agents/board-participants';
import { HISTORICAL_AGENTS } from '../src/alchm-chart/historical-agents.js';
import { ratingFeedStatus } from '../src/lib/agents/agent-rating-feed';

const agents = HISTORICAL_AGENTS.slice(0, 5);
function rows(): BoardTables {
  return {
    melee_table: [{ table_id: '9007199254740993', zone_id: 5, state: { Seated: [] } }, { table_id: '9007199254740994', zone_id: 10, state: { tag: 'Mustering' } }],
    melee_seat: agents.map((agent: any, i: number) => ({ seat_id: String(i + 1), table_id: i < 3 ? '9007199254740993' : '9007199254740994',
      occupant: `npc-${i}`, faction: agent.faction, is_human: false, score: i * 10 })),
    agent_chart: agents.map((agent: any, i: number) => ({ identity: `npc-${i}`, handle: agent.handle })), agent_rating: [],
  };
}

describe('Participating historical agents on the game board', () => {
  it('renders every actual NPC seat, including multiple agents at one zone, without requiring ownership', () => {
    const participants = resolveBoardParticipants(rows());
    expect(participants).toHaveLength(5);
    expect(participants.map(p => p.zoneId)).toEqual([5, 5, 5, 10, 10]);
    expect(participants.map(p => p.payload.key)).toEqual(agents.map((a: any) => a.key));
    expect(new Set(participants.map(p => p.id)).size).toBe(5);
    expect(participants.every(p => ratingFeedStatus(p.payload) === 'pending')).toBe(true);
  });

  it('does not populate owned zones or unseated roster entries with representatives', () => {
    const data = rows(); data.melee_seat = [];
    expect(resolveBoardParticipants(data)).toEqual([]);
  });

  it('keeps all 66 seats across eleven full tables, with no faction or per-zone representative cap', () => {
    const data: BoardTables = {
      melee_table: Array.from({ length: 11 }, (_, zone_id) => ({ table_id: zone_id + 1, zone_id, state: 'Seated' })),
      melee_seat: HISTORICAL_AGENTS.slice(0, 66).map((a: any, i: number) => ({
        seat_id: i + 1, table_id: Math.floor(i / 6) + 1, occupant: `npc-${i}`, faction: a.faction, is_human: false,
      })),
      agent_chart: HISTORICAL_AGENTS.map((a: any, i: number) => ({ identity: `npc-${i}`, handle: a.handle })),
      agent_rating: [],
    };
    const participants = resolveBoardParticipants(data);
    expect(participants).toHaveLength(66);
    expect(new Set(participants.map(p => p.payload.key)).size).toBe(66);
    for (let zone = 0; zone < 11; zone++) expect(participants.filter(p => p.zoneId === zone)).toHaveLength(6);
  });

  it('removes resolved, deleted, unknown-state and missing tables without reviving historical seats', () => {
    for (const state of ['Resolved', { tag: 'Resolved' }, { Resolved: [] }, undefined, 'Unknown']) {
      const data = rows(); data.melee_table[0].state = state;
      expect(resolveBoardParticipants(data).map(p => p.zoneId)).toEqual([10, 10]);
    }
    const data = rows(); data.melee_table = [];
    expect(resolveBoardParticipants(data)).toEqual([]);
  });

  it('moves positions with the table zone and removes departing seats independently', () => {
    const data = rows(); const before = resolveBoardParticipants(data);
    data.melee_table[0].zone_id = 2;
    const moved = resolveBoardParticipants(data);
    expect(moved.slice(0,3).map(p => p.id)).toEqual(before.slice(0,3).map(p => p.id));
    expect(moved.slice(0,3).map(p => p.zoneId)).toEqual([2,2,2]);
    data.melee_seat.splice(1,1);
    expect(resolveBoardParticipants(data)).toHaveLength(4);
  });

  it('joins actual identities and excludes humans, unknown agents and missing chart identities', () => {
    const data = rows();
    data.melee_seat[0].is_human = true;
    data.agent_chart[1].handle = 'Unknown NPC';
    data.melee_seat[2].occupant = 'not-the-chart';
    expect(resolveBoardParticipants(data).map(p => p.payload.key)).toEqual(agents.slice(3).map((a:any) => a.key));
  });

  it('supports SDK casing and tagged values without losing large table IDs', () => {
    const data = rows();
    const camel = (row: any) => Object.fromEntries(Object.entries(row).map(([k,v]) => [k.replace(/_([a-z])/g, (_,c) => c.toUpperCase()), v]));
    const converted = Object.fromEntries(Object.entries(data).map(([k,v]) => [k, v.map(camel)])) as BoardTables;
    converted.melee_seat[0].occupant = { toHexString: () => '0xABC123' };
    converted.agent_chart[0].identity = { __identity__: 'abc123' };
    converted.melee_seat[0].faction = { tag: 'Sun' };
    expect(resolveBoardParticipants(converted)).toHaveLength(5);
    expect(resolveBoardParticipants(converted)[0].payload.faction).toBe(0);
    expect(resolveBoardParticipants(converted)[0].tableId).toBe('9007199254740993');
  });

  it('only applies ratings matching both the occupant identity and canonical source key', () => {
    const data = rows(), key = agents[0].key;
    const snapshot = { version: 1, sourceKey: key, chartPlaceholder: false, ratings: [75,76,77,78,79,80,81],
      esms: [0,0,0,0], esmsSource: 'unavailable', seals: [], surge: null };
    const rating = { identity: 'npc-0', agent_key: key, snapshot_json: JSON.stringify(snapshot), observed_at_ms: Date.now() };
    const resolve = (row: any) => { data.agent_rating = [row]; return resolveBoardParticipants(data)[0].payload; };
    expect(ratingFeedStatus(resolve(rating))).toBe('partial');
    expect(resolve(rating).ratings.power).toBe(75);
    expect(ratingFeedStatus(resolve({ ...rating, identity: 'npc-1' }))).toBe('pending');
    expect(ratingFeedStatus(resolve({ ...rating, snapshot_json: JSON.stringify({ ...snapshot, sourceKey: 'different-agent' }) }))).toBe('pending');
    expect(ratingFeedStatus(resolve({ ...rating, snapshot_json: '{}' }))).toBe('pending');
    expect(ratingFeedStatus(resolve({ ...rating, observed_at_ms: Date.now() - 360000 }))).toBe('stale');
  });

  it('clears incomplete, disconnected and reconnected snapshots and unsubscribes on disposal', () => {
    const listeners = new Map<string, (rows: any[]) => void>();
    let status: () => void = () => {}, stops = 0;
    const client = { isLive: false, conn: {}, applied: true, isApplied() { return this.applied; },
      onStatus(cb: () => void) { status = cb; cb(); return () => { stops++; }; },
      subscribe(table: string, cb: (rows: any[]) => void) { listeners.set(table, cb); return () => { stops++; }; } };
    const updates: any[] = [], data = rows();
    const feed = new BoardParticipantFeed(client, (participants, source) => updates.push({ participants, source }));
    expect(updates.at(-1)).toEqual({ participants: [], source: 'offline' });
    client.isLive = true; status();
    listeners.get('melee_table')!(data.melee_table);
    listeners.get('melee_seat')!(data.melee_seat);
    expect(updates.at(-1).source).toBe('syncing');
    listeners.get('agent_chart')!(data.agent_chart);
    expect(updates.at(-1).participants).toHaveLength(5);
    client.isLive = false; status();
    expect(updates.at(-1)).toEqual({ participants: [], source: 'offline' });
    client.isLive = true; client.conn = {}; status();
    listeners.get('melee_table')!(data.melee_table);
    expect(updates.at(-1)).toEqual({ participants: [], source: 'syncing' });
    client.applied = false; listeners.get('melee_seat')!(data.melee_seat);
    expect(updates.at(-1).source).toBe('syncing');
    client.applied = true; listeners.get('melee_seat')!([]); listeners.get('agent_chart')!(data.agent_chart);
    expect(updates.at(-1)).toEqual({ participants: [], source: 'live' });
    feed.destroy(); expect(stops).toBe(5);
    const count = updates.length; listeners.get('melee_seat')!(data.melee_seat);
    expect(updates).toHaveLength(count);
  });

  it('keeps every seat anchor inside its actual sky-board zone and stable under row ordering', () => {
    const classify = runInNewContext(readFileSync('public/sky.js','utf8') + '\nzoneForAltAz;', { window: {} });
    for (let zone = 0; zone < 11; zone++) for (let count = 1; count <= 6; count++) {
      const slots = boardSeatDirections(zone, count);
      expect(slots).toHaveLength(count);
      expect(new Set(slots.map(s => `${s.alt}:${s.az}`)).size).toBe(count);
      expect(slots.every(s => classify(s.alt, s.az) === zone)).toBe(true);
    }
    const data = rows(); const first = resolveBoardParticipants(data);
    data.melee_seat.reverse(); expect(resolveBoardParticipants(data)).toEqual(first);
    expect(boardViewport(800,600)).toEqual({ size:600,left:100,top:0,unit:1 });
  });
});
