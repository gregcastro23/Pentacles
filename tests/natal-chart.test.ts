import { afterEach, describe, expect, test } from 'bun:test';
import { NATAL_CHART_VIEW, readNatalChart } from '../src/net/natal-chart.js';
import { restoreProfileFromSpacetimeDB } from '../src/net/restore.js';
import { tables } from '../src/module_bindings';

const ME = '0x' + 'ab'.repeat(32);
const OTHER = '0x' + 'cd'.repeat(32);
const chart = {
  identity: ME,
  birth_unix: '1234', birth_lat: '40.7', birth_lon: '-74', time_known: true,
  ascendant: '18', midheaven: '22', house_system: 'WholeSign', house_cusps: [0, 1800],
  placements: [{ body: 'Mars', sign: '3', arc_minutes: '7200', retrograde: false, dignity: '2' }],
};

/** Mirrors a new subscription's pre-apply cache emit and an already-live replay. */
class FakeClient {
  isLive = true;
  identity: string | null = ME;
  rows: any[] = [chart];
  applied = false;
  applyAfterMs: number | null = 5;
  subscribed: string[] = [];
  listeners = new Set<(rows: any[]) => void>();
  isApplied(table: string) { return table === NATAL_CHART_VIEW && this.applied; }
  subscribe(table: string, cb: (rows: any[]) => void) {
    this.subscribed.push(table);
    if (table !== NATAL_CHART_VIEW) return () => {};
    this.listeners.add(cb);
    if (this.applied) cb([...this.rows]);
    else {
      queueMicrotask(() => this.listeners.has(cb) && cb([]));
      if (this.applyAfterMs !== null) setTimeout(() => {
        this.applied = true;
        for (const l of this.listeners) l([...this.rows]);
      }, this.applyAfterMs);
    }
    return () => { this.listeners.delete(cb); };
  }
}

describe('readNatalChart', () => {
  test('waits for its own applied snapshot and preserves the natal row shape', async () => {
    const c = new FakeClient();
    expect(await readNatalChart(c, { timeoutMs: 500 })).toEqual(chart);
    expect(c.subscribed).toEqual([NATAL_CHART_VIEW]);
    expect(c.listeners.size).toBe(0);
  });

  test('unsubscribes after a synchronous replay from an already-live view', async () => {
    const c = new FakeClient();
    c.applied = true;
    expect(await readNatalChart(c, { timeoutMs: 500 })).toEqual(chart);
    expect(c.listeners.size).toBe(0);
  });

  test('accepts a truly empty applied view without waiting for the timeout', async () => {
    const c = new FakeClient();
    c.rows = [];
    c.applied = true;
    expect(await readNatalChart(c, { timeoutMs: 500 })).toBeNull();
    expect(c.listeners.size).toBe(0);
  });

  test('a missing view times out and releases its listener', async () => {
    const c = new FakeClient();
    c.applyAfterMs = null;
    expect(await readNatalChart(c, { timeoutMs: 20 })).toBeNull();
    expect(c.listeners.size).toBe(0);
  });

  test('null, offline, or unidentified clients do not subscribe', async () => {
    expect(await readNatalChart(null)).toBeNull();
    const c = new FakeClient();
    c.isLive = false;
    expect(await readNatalChart(c)).toBeNull();
    c.isLive = true;
    c.identity = null;
    expect(await readNatalChart(c)).toBeNull();
    expect(c.subscribed).toEqual([]);
  });

  test('matches normalized identities and ignores a cached chart for another player', async () => {
    const c = new FakeClient();
    c.applied = true;
    c.rows = [{ ...chart, identity: OTHER }, { ...chart, identity: { __identity__: ME.slice(2).toUpperCase() } }];
    expect((await readNatalChart(c))?.birth_unix).toBe(chart.birth_unix);
    c.rows = [{ ...chart, identity: OTHER }];
    expect(await readNatalChart(c)).toBeNull();
  });

  test('the view is available to the WebSocket generated bindings', () => {
    expect(Object.hasOwn(tables, 'myNatalChart')).toBe(true);
  });
});

const originalWindow = globalThis.window;
const originalStorage = globalThis.localStorage;
afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.localStorage = originalStorage;
});

describe('restoreProfileFromSpacetimeDB', () => {
  test('restores the private chart and card signs using the view with no natal SQL', async () => {
    const stored = new Map<string, string>([['pentacles_save_aster', JSON.stringify({ player: {} })]]);
    globalThis.localStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
    } as Storage;
    globalThis.window = {} as Window & typeof globalThis;
    const c = new FakeClient();
    c.applied = true;
    const queries: string[] = [];
    const net = Object.assign(c, {
      async query(sql: string) {
        queries.push(sql);
        if (sql === 'SELECT * FROM player') return [{ identity: ME, handle: 'aster', faction: 'Mars', tokens: 9 }];
        if (sql === 'SELECT * FROM card') return [{
          owner: ME, card_id: 1, suit: 'Wands', rank: 2, source_body: 'Mars',
          health: 10, attack: 2, armour: 1, cooldown_ms: 500, minted_at: 1,
        }];
        if (sql === 'SELECT * FROM deck_slot') return [];
        throw new Error('unexpected SQL ' + sql);
      },
    });
    const state = { player: {} as any, collection: [] as any[], save() {} };
    await restoreProfileFromSpacetimeDB(net, state);
    const expectedChart = {
      birth_unix: 1234, birth_lat: 40.7, birth_lon: -74, time_known: true,
      ascendant: 18, midheaven: 22, house_system: 'WholeSign', house_cusps: [0, 1800],
      placements: [{ body: 4, sign: 3, arc_minutes: 7200, retrograde: false, dignity: 2 }],
    };
    expect(state.player.chart).toEqual(expectedChart);
    expect(state.collection[0].sign_idx).toBe(3);
    expect(JSON.parse(stored.get('pentacles_save_aster')!).player.chart).toEqual(expectedChart);
    expect(queries).toEqual(['SELECT * FROM player', 'SELECT * FROM card', 'SELECT * FROM deck_slot']);
    expect(c.subscribed).toContain(NATAL_CHART_VIEW);
    expect(c.listeners.size).toBe(0);
  });
});
