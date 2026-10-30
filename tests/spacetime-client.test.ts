import { expect, test } from 'bun:test';

test('application subscriptions deliver camelCase SDK tables as snake_case snapshots and updates', async () => {
  const savedStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
  let client: any;
  try {
    const { spacetime } = await import('../src/net/spacetime.js');
    client = new (spacetime.constructor as any)();
  } finally {
    if (savedStorage) Object.defineProperty(globalThis, 'localStorage', savedStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
  let applied: () => void = () => {};
  let updated: () => void = () => {};
  let rows = [{ agentKey: 'isaac-newton', observedAtMs: 123n }];
  const received: any[] = [];
  const queries: string[][] = [];
  const builder = {
    onApplied(fn: () => void) { applied = fn; return this; },
    onError() { return this; },
    subscribe(sql: string[]) { queries.push(sql); return { unsubscribe() {} }; },
  };
  client.status = 'live';
  client.conn = {
    db: { agentRating: {
      iter: () => rows.values(), onInsert() {}, onDelete() {},
      onUpdate(fn: () => void) { updated = fn; },
    } },
    subscriptionBuilder: () => builder,
  };
  try {
    client.subscribe('agent_rating', (snapshot: unknown) => received.push(snapshot));
    await Promise.resolve();
    expect(queries).toEqual([['SELECT * FROM agent_rating']]);
    applied();
    expect(received).toEqual([[{ agent_key: 'isaac-newton', observed_at_ms: '123' }]]);
    rows = [{ agentKey: 'isaac-newton', observedAtMs: 456n }];
    updated();
    await Promise.resolve();
    expect(received[1]).toEqual([{ agent_key: 'isaac-newton', observed_at_ms: '456' }]);
    expect(client.isApplied('agent_rating')).toBe(true);
  } finally { client.disconnect(); }
});
