// jingPool() reads the caller's pool through the caller-scoped my_jing_pool view,
// never the private jing_pool table, and trusts a snapshot only once it applied.
import { describe, expect, test } from "bun:test";
import { JING_POOL_VIEW, readJingPool, watchJingPool } from "../src/net/jing-pool.js";
import { ORACLE_VIEWS } from "../src/net/oracle-ask.js";
import { tables } from "../src/module_bindings";

type Row = Record<string, any>;
const ME = "0x" + "ab".repeat(32);
const OTHER = "0x" + "cd".repeat(32);
const myRow = { identity: ME, sacred7: [100, 100, 85, 100, 100, 100, 100], esms: [80, 80, 70, 80], updated_at: 1 };

/** The parts of src/net/spacetime.js readJingPool uses, with the view applying after `applyAfterMs`. */
class FakeClient {
  isLive = true;
  identity: string | null = ME;
  rows: Row[] = [myRow];
  applied = false;
  applyAfterMs: number | null = 5; // null = never applies (a module without the view)
  emitBeforeApply = true; // an earlier handle applying emits this table from the empty cache
  subscribed: string[] = [];
  listeners = new Set<(rows: Row[]) => void>();

  isApplied(table: string) { return table === JING_POOL_VIEW && this.applied; }
  subscribe(table: string, cb: (rows: Row[]) => void) {
    this.subscribed.push(table);
    this.listeners.add(cb);
    if (this.applied) cb([...this.rows]); // already live: replay the cache synchronously
    else {
      if (this.emitBeforeApply) queueMicrotask(() => this.listeners.has(cb) && cb([]));
      if (this.applyAfterMs != null) setTimeout(() => {
        this.applied = true;
        for (const l of this.listeners) l([...this.rows]);
      }, this.applyAfterMs);
    }
    return () => { this.listeners.delete(cb); };
  }
  /** A server delta: the view's new rows, re-emitted to every listener. */
  push(rows: Row[]) {
    this.rows = rows;
    if (this.applied) for (const l of this.listeners) l([...rows]);
  }
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe("readJingPool", () => {
  test("returns the caller's pool from the view, in the shape agent-page.js reads", async () => {
    const c = new FakeClient();
    expect(await readJingPool(c, { timeoutMs: 500 })).toEqual({ identity: ME, sacred7: myRow.sacred7, esms: myRow.esms });
    expect(c.subscribed).toEqual([JING_POOL_VIEW]);
    expect(c.listeners.size).toBe(0); // unsubscribed
  });

  test("an empty snapshot before the view applies is not taken as the real one", async () => {
    const c = new FakeClient();
    c.applyAfterMs = 20;
    expect((await readJingPool(c, { timeoutMs: 500 }))?.esms).toEqual(myRow.esms);
  });

  test("works when the view is already live (synchronous replay)", async () => {
    const c = new FakeClient();
    c.applied = true;
    expect((await readJingPool(c, { timeoutMs: 500 }))?.sacred7).toEqual(myRow.sacred7);
    expect(c.listeners.size).toBe(0);
  });

  test("a module without the view gives null at the deadline, not a fake pool", async () => {
    const c = new FakeClient();
    c.applyAfterMs = null;
    expect(await readJingPool(c, { timeoutMs: 30 })).toBe(null);
    expect(c.listeners.size).toBe(0);
  });

  test("offline, or asking for another identity's pool, never subscribes", async () => {
    const c = new FakeClient();
    c.isLive = false;
    expect(await readJingPool(c)).toBe(null);
    c.isLive = true;
    expect(await readJingPool(c, { identity: OTHER })).toBe(null);
    c.identity = null;
    expect(await readJingPool(c)).toBe(null);
    expect(c.subscribed).toEqual([]);
  });

  test("matches identities regardless of 0x prefix and case", async () => {
    const c = new FakeClient();
    c.rows = [{ ...myRow, identity: ME.slice(2).toUpperCase() }];
    expect((await readJingPool(c, { identity: ME.toUpperCase(), timeoutMs: 500 }))?.esms).toEqual(myRow.esms);
  });

  test("a cached row for some other identity is never returned", async () => {
    const c = new FakeClient();
    c.rows = [{ ...myRow, identity: OTHER }];
    expect(await readJingPool(c, { timeoutMs: 500 })).toBe(null);
  });

  test("u16 columns come back as numbers", async () => {
    const c = new FakeClient();
    c.rows = [{ ...myRow, sacred7: myRow.sacred7.map(String), esms: myRow.esms.map(String) }];
    const pool = await readJingPool(c, { timeoutMs: 500 });
    expect(pool?.sacred7).toEqual(myRow.sacred7);
    expect(pool?.esms).toEqual(myRow.esms);
  });
});

describe("watchJingPool", () => {
  test("one subscription delivers the pool once applied and after every change", async () => {
    const c = new FakeClient();
    const seen: any[] = [];
    const stop = watchJingPool(c, (p) => seen.push(p));
    await tick();
    c.push([{ ...myRow, sacred7: [100, 100, 85, 100, 100, 85, 100], esms: [80, 70, 70, 80] }]);
    expect(seen.map((p) => p.esms)).toEqual([myRow.esms, [80, 70, 70, 80]]); // the pre-apply empty emit was skipped
    expect(seen[0]).toEqual({ identity: ME, sacred7: myRow.sacred7, esms: myRow.esms });
    expect(c.subscribed).toEqual([JING_POOL_VIEW]); // no resubscription per update
    stop();
    expect(c.listeners.size).toBe(0);
    c.push([myRow]);
    expect(seen.length).toBe(2); // nothing after stop
  });

  test("replays an already-live view synchronously", () => {
    const c = new FakeClient();
    c.applied = true;
    const seen: any[] = [];
    watchJingPool(c, (p) => seen.push(p));
    expect(seen.map((p) => p.sacred7)).toEqual([myRow.sacred7]);
  });

  test("ignores rows for another identity, and a module without the view", async () => {
    const c = new FakeClient();
    c.rows = [{ ...myRow, identity: OTHER }];
    const seen: any[] = [];
    watchJingPool(c, (p) => seen.push(p));
    const old = new FakeClient();
    old.applyAfterMs = null;
    watchJingPool(old, (p) => seen.push(p));
    await tick();
    expect(seen).toEqual([]);
    expect(old.subscribed).toEqual([JING_POOL_VIEW]); // subscribed once, not once per read
  });
});

describe("the per-sender views are in the generated bindings", () => {
  // spacetime.js subscribes by snake_case name; a view missing from
  // src/module_bindings would never bind its delta handlers.
  const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase());
  for (const view of [JING_POOL_VIEW, ORACLE_VIEWS.requests, ORACLE_VIEWS.replies]) {
    test(view, () => {
      expect(Object.hasOwn(tables, camel(view))).toBe(true);
    });
  }
});
