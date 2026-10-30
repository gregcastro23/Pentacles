import { describe, test, expect, afterEach } from 'bun:test';
import { FIXTURE_AGENTS, computeOvr } from '../src/lib/agents/rating-contract';
import { normalizeApiRating, parseRatingSnapshot, applyRatingSnapshot, ratingFeedStatus, RATING_MAX_AGE_MS } from '../src/lib/agents/agent-rating-feed';
import { syncAgentRatings, resolveRosterEntry, RatingHttpError, createRatingFeedDependencies } from '../feeder/agent-rating-service';
import { SpacetimeDBBridge } from '../src/lib/agents/spacetimedb-bridge';
import { PentacleArena3D } from '../src/lib/agents/pentacle-arena-3d';
import { liveWalletSync } from '../src/lib/agents/live-wallet-sync';

const api = () => {
  const fixture = structuredClone(FIXTURE_AGENTS.find(p => p.key === 'isaac-newton')!);
  return { ...fixture, ovr: computeOvr(fixture.ratings), key: 'isaac-newton-1643',
    provenance: 'historical', isPlaceholder: false, esmsSource: 'database' };
};
afterEach(() => liveWalletSync.clearCache());

describe('authoritative NPC rating feed', () => {
  test('projects the source contract without private fields, preserving OWA, seals and surge', () => {
    const source = { ...api(), wallet: 'must-not-cross', natalChart: { secret: true } };
    const snapshot = normalizeApiRating(source, source.key);
    const wire = JSON.stringify(snapshot);
    expect(wire).not.toContain('must-not-cross');
    expect(wire).not.toContain('natalChart');
    const p = applyRatingSnapshot(FIXTURE_AGENTS[0], wire, Date.now());
    expect(p.ovr).toBe(source.ovr);
    expect(p.ratings).toEqual(source.ratings);
    expect(p.seals).toEqual(source.seals);
    expect(p.surge).toEqual(source.surge);
    expect(ratingFeedStatus(p)).toBe('current');
    expect(ratingFeedStatus(p, p.ratingFeed!.receivedAt + RATING_MAX_AGE_MS + 1)).toBe('stale');
  });
  test('keeps chart provenance separate from missing ratings and makes unavailable holdings/sky explicit', () => {
    const source = { ...api(), isPlaceholder: true, esmsSource: 'fallback', surge: null,
      degraded: { esms: 'ledger unavailable', sky: 'sky unavailable' } };
    const snapshot = normalizeApiRating(source, source.key);
    expect(snapshot.esms).toEqual([0, 0, 0, 0]);
    expect(snapshot.seals).toEqual([]);
    const p = applyRatingSnapshot(FIXTURE_AGENTS[0], JSON.stringify(snapshot), Date.now());
    expect(p.isPlaceholder).toBe(true);
    expect(ratingFeedStatus(p)).toBe('partial');
    expect(p.ratingFeed?.skyAvailable).toBe(false);
    expect(p.surge.active).toBe(false);
  });
  test('shows a rated provisional chart on its 3D badge rather than labelling it pending', () => {
    const arena = new PentacleArena3D();
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    const labels: string[] = [];
    const ctx = new Proxy({ fillText: (text: string) => labels.push(text) } as any, {
      get: (target, key) => key in target ? target[key] : () => {},
    });
    Object.defineProperty(globalThis, 'document', { configurable: true,
      value: { createElement: () => ({ getContext: () => ctx }) } });
    try {
      const source = { ...api(), isPlaceholder: true, esmsSource: 'fallback', surge: null };
      const p = applyRatingSnapshot({ ...FIXTURE_AGENTS[0], ratingSource: 'live' },
        JSON.stringify(normalizeApiRating(source, source.key)), Date.now());
      arena.placeAvatarOnZone(0, p, 'owner');
      expect(labels).toContain(String(p.ovr));
      expect(labels).not.toContain('Ratings pending');
    } finally {
      arena.destroy();
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });
  test('rejects wrong identity, forged users, malformed ratings, mismatched OWA, unbounded and bad seals', () => {
    const p = api();
    for (const changes of [{ key: 'someone-else' }, { provenance: 'user' }, { ratings: { ...p.ratings, power: 100 } },
      { ovr: 25 }, { esms: { ...p.esms, spirit: -1 } }, { surge: {} },
      { seals: [{ ...p.seals[0], multiplier: 500 }] }, { esmsSource: 'invented' }]) {
      expect(() => normalizeApiRating({ ...p, ...changes }, p.key)).toThrow();
    }
    expect(() => parseRatingSnapshot(' '.repeat(32769))).toThrow();
  });
  test('matches canonical roster keys or one unambiguous normalized name', () => {
    const figure = { key: 'isaac-newton', handle: 'Isaac Newton' };
    const roster = [{ key: 'isaac-newton-1643', handle: 'Sir Isaac Newton' }];
    expect(resolveRosterEntry(figure, roster)?.key).toBe('isaac-newton-1643');
    expect(resolveRosterEntry(figure, [...roster, { key: 'other', handle: 'Isaac Newton' }])).toBeUndefined();
  });
  test('runs API → normalized snapshot → owner reducer arguments, without requesting humans', async () => {
    const source = api(); const writes: any[] = []; const paths: string[] = [];
    const result = await syncAgentRatings({
      charts: async () => [{ handle: 'Isaac Newton' }, { handle: 'A human' }], now: () => 123456,
      get: async path => { paths.push(path); return path === '?roster=true'
        ? { success: true, agents: [{ key: source.key, handle: 'Isaac Newton' }] } : source; },
      publish: async (...args) => { writes.push(args); },
    });
    expect(result).toMatchObject({ published: 1, failed: 0, unmatched: 0 });
    expect(paths).toEqual(['?roster=true', '?agentId=isaac-newton-1643']);
    expect(writes[0]).toEqual(['isaac-newton', normalizeApiRating(source, source.key), 123456]);
  });
  test('does not publish a failed read and stops the sweep on rate limiting', async () => {
    let writes = 0;
    const result = await syncAgentRatings({
      charts: async () => [{ handle: 'Isaac Newton' }],
      get: async path => { if (path === '?roster=true') return { success: true, agents: [{ key: 'isaac-newton', handle: 'Isaac Newton' }] };
        throw new RatingHttpError(429); },
      publish: async () => { writes++; },
    });
    expect(writes).toBe(0);
    expect(result).toMatchObject({ failed: 1, rateLimited: true });
  });
  test('keeps owner credentials on the database write and uses the public frontend for reads', async () => {
    const keys = ['SPACETIMEDB_URI', 'SPACETIMEDB_DB', 'SPACETIME_TOKEN', 'PLANETARY_AGENTS_FRONTEND_URL'];
    const saved = keys.map(key => process.env[key]); const originalFetch = globalThis.fetch;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    try {
      process.env.SPACETIMEDB_URI = 'http://127.0.0.1:3000'; process.env.SPACETIMEDB_DB = 'rating-test';
      process.env.SPACETIME_TOKEN = 'test-owner-token'; process.env.PLANETARY_AGENTS_FRONTEND_URL = 'http://localhost:3001';
      globalThis.fetch = (async (url: any, init: any) => {
        calls.push({ url: String(url), init }); return Response.json(api());
      }) as typeof fetch;
      const deps = createRatingFeedDependencies(); const source = api();
      await deps.get('?agentId=isaac-newton-1643');
      const snapshot = normalizeApiRating(source, source.key);
      await deps.publish('isaac-newton', snapshot, 123456);
      expect(calls[0].url).toBe('http://localhost:3001/api/agents/rating?agentId=isaac-newton-1643');
      expect(new Headers(calls[0].init.headers).has('authorization')).toBe(false);
      expect(calls[0].init.redirect).toBe('error');
      expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
      expect(calls[1].url).toBe('http://127.0.0.1:3000/v1/database/rating-test/call/publish_agent_rating');
      expect(new Headers(calls[1].init.headers).get('authorization')).toBe('Bearer test-owner-token');
      expect(JSON.parse(calls[1].init.body as string)).toEqual(['isaac-newton', JSON.stringify(snapshot), 123456]);
      globalThis.fetch = (async () => new Response('x'.repeat(64_001))) as typeof fetch;
      await expect(deps.get('?agentId=isaac-newton')).rejects.toThrow('too large');
    } finally {
      globalThis.fetch = originalFetch;
      keys.forEach((key, i) => { if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i]; });
    }
  });
  test('hydrates and updates the seated model in place; examples, humans, deletion and reconnect remain isolated', () => {
    const listeners = new Map<string, (rows: any[]) => void>();
    const arena = new PentacleArena3D(); const bridge = new SpacetimeDBBridge();
    const client = { conn: {}, subscribe: (table: string, callback: (rows: any[]) => void) => {
      listeners.set(table, callback); callback([]); return () => listeners.delete(table);
    } };
    try {
      // Even an authoritative cache entry from another screen cannot populate this live court.
      liveWalletSync.syncAgentRatingPayload(FIXTURE_AGENTS[0]);
      bridge.attachArena(arena); bridge.connect(client);
      const emit = (table: string, rows: any[]) => listeners.get(table)!(rows);
      emit('agent_chart', [{ identity: 'npc', handle: 'Isaac Newton' }]);
      emit('player', [{ identity: 'human', handle: 'Isaac Newton' }]);
      emit('melee_table', [{ table_id: 1, zone_id: 0 }]);
      emit('melee_seat', [{ seat_id: 1, table_id: 1, occupant: 'npc', faction: 6, is_human: false },
        { seat_id: 2, table_id: 1, occupant: 'human', faction: 6, is_human: true }]);
      const model = arena.avatarRegistry.get('isaac-newton')!;
      expect(ratingFeedStatus(model.payload)).toBe('pending');
      const group = model.group; const source = api();
      const row = { identity: 'npc', agent_key: 'isaac-newton', observed_at_ms: BigInt(Date.now()), snapshot_json: JSON.stringify(normalizeApiRating(source, source.key)) };
      emit('agent_rating', [row, { ...row, identity: 'human' }]);
      expect(arena.avatarRegistry.get('isaac-newton')!.group).toBe(group);
      expect(ratingFeedStatus(model.payload)).toBe('current');
      expect(ratingFeedStatus(arena.avatarRegistry.get('seeker-human')!.payload)).toBe('pending');
      source.ratings.power = 80; source.ovr = computeOvr(source.ratings);
      emit('agent_rating', [{ ...row, snapshot_json: JSON.stringify(normalizeApiRating(source, source.key)) }]);
      expect(model.payload.ratings.power).toBe(80);
      liveWalletSync.syncAgentRatingPayload(FIXTURE_AGENTS[0]); arena.update(0);
      expect(model.payload.ratings.power).toBe(80);
      emit('agent_rating', []);
      expect(ratingFeedStatus(model.payload)).toBe('pending');
      emit('agent_rating', [row]);
      bridge.disconnect(); bridge.connect(client);
      expect(arena.avatarRegistry.size).toBe(0);
      expect(group.userData.disposed).toBe(true);
    } finally { bridge.disconnect(); arena.destroy(); }
    expect(listeners.size).toBe(0);
  });
});
