import { describe, expect, test } from "bun:test";
import { TRACE_VIEWS, waitForTraceAttestation } from "../src/net/trace-attestation.js";

type Row = Record<string, any>;
const ME = "0x" + "ab".repeat(32);
const OTHER = "0x" + "cd".repeat(32);
const CONST = 3;
const intent = (id: string | bigint, createdAt = 100, overrides: Row = {}) => ({
  intent_id: id, trader: ME, constellation_id: CONST, created_at: createdAt, ...overrides,
});
const attestation = (id: string | bigint, overrides: Row = {}) => ({
  intent_id: id, trader: ME, constellation_id: CONST, region_commit: "commit",
  visible_stars: "12", nonce: "9007199254740993", deadline: "1812900000", signature: "signed", ...overrides,
});

/** Replay and deltas follow spacetime.js' normalized subscribe contract. */
class FakeClient {
  identity: string | null = ME;
  rows = new Map<string, Row[]>([[TRACE_VIEWS.intents, []], [TRACE_VIEWS.attestations, []]]);
  listeners = new Map<string, Set<(rows: Row[]) => void>>();
  applied = new Set<string>(Object.values(TRACE_VIEWS));
  subscribed: string[] = [];
  syncEmit = true;
  isApplied(table: string) { return this.applied.has(table); }
  query() { throw new Error("Private tables must never be queried over HTTP /sql"); }
  subscribe(table: string, cb: (rows: Row[]) => void) {
    this.subscribed.push(table);
    if (!this.listeners.has(table)) this.listeners.set(table, new Set());
    this.listeners.get(table)!.add(cb);
    const emit = () => this.listeners.get(table)?.has(cb) && cb([...this.rows.get(table)!]);
    if (this.syncEmit) emit();
    else queueMicrotask(emit);
    return () => { this.listeners.get(table)?.delete(cb); };
  }
  push(table: string, rows: Row[]) {
    this.rows.set(table, rows);
    for (const cb of this.listeners.get(table) || []) cb([...rows]);
  }
  listenerCount() { return [...this.listeners.values()].reduce((n, s) => n + s.size, 0); }
}

describe("waitForTraceAttestation", () => {
  test("reads both player views and preserves the DEX's signed attestation shape", async () => {
    const c = new FakeClient();
    c.syncEmit = false;
    c.rows.set(TRACE_VIEWS.intents, [intent("1")]);
    c.rows.set(TRACE_VIEWS.attestations, [attestation("1")]);
    expect(await waitForTraceAttestation(c, CONST, "solana-wallet", { timeoutMs: 500 })).toEqual({
      trader: "solana-wallet", constellationId: CONST, regionCommit: "commit",
      visibleStars: 12, nonce: 9007199254740993n, deadline: 1812900000n, signature: "signed",
    });
    expect(c.subscribed).toEqual(Object.values(TRACE_VIEWS));
    expect(c.listenerCount()).toBe(0);
  });

  test("synchronous cached replay cleans up both subscriptions", async () => {
    const c = new FakeClient();
    c.rows.set(TRACE_VIEWS.intents, [intent("1")]);
    c.rows.set(TRACE_VIEWS.attestations, [attestation("1")]);
    expect((await waitForTraceAttestation(c, CONST, "wallet", { timeoutMs: 100 }))?.signature).toBe("signed");
    expect(c.listenerCount()).toBe(0);
  });

  test("waits for the newest caller intent for this constellation, without losing u64 ID precision", async () => {
    const c = new FakeClient();
    c.rows.set(TRACE_VIEWS.intents, [
      intent("9007199254740992", 101), intent(9007199254740993n, 101), intent("1", 100),
      intent("2", 200, { trader: OTHER }), intent("3", 300, { constellation_id: 4 }),
    ]);
    c.rows.set(TRACE_VIEWS.attestations, [attestation("9007199254740992", { signature: "older" })]);
    const pending = waitForTraceAttestation(c, CONST, "wallet", { timeoutMs: 500 });
    setTimeout(() => c.push(TRACE_VIEWS.attestations, [attestation("9007199254740993", { signature: "newest" })]), 5);
    expect((await pending)?.signature).toBe("newest");
    expect(c.listenerCount()).toBe(0);
  });

  test("skips pre-apply snapshots and selects the intent only after both views apply", async () => {
    const c = new FakeClient();
    c.applied.clear();
    c.rows.set(TRACE_VIEWS.intents, [intent("1")]);
    c.rows.set(TRACE_VIEWS.attestations, [attestation("1", { signature: "stale" })]);
    const pending = waitForTraceAttestation(c, CONST, "wallet", { timeoutMs: 500 });
    c.applied.add(TRACE_VIEWS.intents);
    c.push(TRACE_VIEWS.intents, [intent("1"), intent("2", 200)]);
    c.applied.add(TRACE_VIEWS.attestations);
    c.push(TRACE_VIEWS.attestations, [attestation("1", { signature: "stale" }), attestation("2")]);
    expect((await pending)?.signature).toBe("signed");
    expect(c.listenerCount()).toBe(0);
  });

  test("waits across empty initial snapshots and feeder updates without resubscribing", async () => {
    const c = new FakeClient();
    const pending = waitForTraceAttestation(c, CONST, "wallet", { timeoutMs: 500, intervalMs: 1 });
    c.push(TRACE_VIEWS.intents, [intent("9")]);
    c.push(TRACE_VIEWS.attestations, [attestation("9", { signature: "" })]);
    setTimeout(() => c.push(TRACE_VIEWS.attestations, [attestation(9n)]), 30);
    expect((await pending)?.signature).toBe("signed");
    expect(c.subscribed).toEqual(Object.values(TRACE_VIEWS));
    expect(c.listenerCount()).toBe(0);
  });

  test("cannot use another caller or constellation's signed attestation", async () => {
    const c = new FakeClient();
    c.rows.set(TRACE_VIEWS.intents, [intent("1")]);
    c.rows.set(TRACE_VIEWS.attestations, [attestation("1", { trader: OTHER }), attestation("1", { constellation_id: 4 })]);
    await expect(waitForTraceAttestation(c, CONST, "wallet", { timeoutMs: 20 })).rejects.toThrow("Timed out waiting for the sky-feeder attestation.");
    expect(c.listenerCount()).toBe(0);
  });

  test("missing views time out and clean up with the existing error", async () => {
    const c = new FakeClient();
    c.applied.delete(TRACE_VIEWS.attestations);
    c.rows.set(TRACE_VIEWS.intents, [intent("1")]);
    c.rows.set(TRACE_VIEWS.attestations, [attestation("1")]);
    await expect(waitForTraceAttestation(c, CONST, "wallet", { timeoutMs: 20 })).rejects.toThrow("Timed out waiting for the sky-feeder attestation.");
    expect(c.subscribed).toEqual(Object.values(TRACE_VIEWS));
    expect(c.listenerCount()).toBe(0);
  });

  test("subscription setup failures release the first listener", async () => {
    const c = new FakeClient();
    const subscribe = c.subscribe.bind(c);
    c.subscribe = (table, cb) => {
      if (table === TRACE_VIEWS.attestations) throw new Error("subscription failed");
      return subscribe(table, cb);
    };
    await expect(waitForTraceAttestation(c, CONST, "wallet", { timeoutMs: 50 })).rejects.toThrow("subscription failed");
    expect(c.listenerCount()).toBe(0);
  });
});
