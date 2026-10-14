// askAgent reads the Oracle's answer through the caller-scoped views, never the
// private oracle tables, and never asks a question it could not read the answer to.
import { describe, expect, test } from "bun:test";
import { askOracle, ORACLE_VIEWS } from "../src/net/oracle-ask.js";
import { waitForRows } from "../src/net/view-wait.js";

type Row = Record<string, any>;

/** The parts of src/net/spacetime.js askOracle uses, backed by in-memory views. */
class FakeClient {
  isLive = true;
  views = new Map<string, Row[] | null>([[ORACLE_VIEWS.requests, []], [ORACLE_VIEWS.replies, []]]);
  listeners = new Map<string, Set<(rows: Row[]) => void>>();
  calls: any[][] = [];
  nextId = 10;
  syncEmit = false; // emit the current snapshot inside subscribe(), like a live table
  answer: ((req: Row) => void) | null = (req) => setTimeout(() => this.insert(ORACLE_VIEWS.replies, { request_id: req.request_id, asker: "0xme", text: `answer to ${req.question}`, model: "haiku" }), 5);

  subscribe(table: string, cb: (rows: Row[]) => void) {
    if (!this.listeners.has(table)) this.listeners.set(table, new Set());
    this.listeners.get(table)!.add(cb);
    const rows = this.views.get(table);
    if (rows) { if (this.syncEmit) cb([...rows]); else queueMicrotask(() => this.listeners.get(table)?.has(cb) && cb([...rows])); }
    return () => { this.listeners.get(table)?.delete(cb); };
  }
  insert(table: string, row: Row) {
    const rows = this.views.get(table)!;
    rows.push(row);
    for (const cb of this.listeners.get(table) || []) cb([...rows]);
  }
  async callReducer(name: string, args: any[]) {
    this.calls.push([name, ...args]);
    const req = { request_id: String(this.nextId++), asker: "0xme", question: args[0], context: args[1], answered: false };
    setTimeout(() => { this.insert(ORACLE_VIEWS.requests, req); this.answer?.(req); }, 3);
  }
  listenerCount() { let n = 0; for (const s of this.listeners.values()) n += s.size; return n; }
}

describe("askOracle", () => {
  test("returns the reply to this question, not an earlier identical one", async () => {
    const c = new FakeClient();
    c.views.set(ORACLE_VIEWS.requests, [{ request_id: "5", question: "what is my sign?", answered: true }]);
    c.views.set(ORACLE_VIEWS.replies, [{ request_id: "5", text: "an old answer" }]);
    const reply = await askOracle(c, "  what is my sign?  ", { context: "Mars (planet)", timeoutMs: 1000 });
    expect(reply).toEqual({ text: "answer to what is my sign?" });
    expect(c.calls).toEqual([["ask_oracle", "what is my sign?", "Mars (planet)", false]]);
    expect(c.listenerCount()).toBe(0); // every wait unsubscribed
  });

  test("works when subscribe() replays a live table synchronously", async () => {
    const c = new FakeClient();
    c.syncEmit = true;
    expect(await askOracle(c, "hello", { timeoutMs: 1000 })).toEqual({ text: "answer to hello" });
    expect(c.listenerCount()).toBe(0);
  });

  test("never asks when the views are unavailable (a module without them)", async () => {
    const c = new FakeClient();
    c.views.set(ORACLE_VIEWS.replies, null); // the subscription was dropped: no snapshot ever
    await expect(askOracle(c, "hello", { timeoutMs: 1000, snapshotMs: 30 })).rejects.toThrow("the Oracle is unavailable");
    expect(c.calls).toEqual([]);
    expect(c.listenerCount()).toBe(0);
  });

  test("times out when no answer arrives", async () => {
    const c = new FakeClient();
    c.answer = null;
    await expect(askOracle(c, "hello", { timeoutMs: 60 })).rejects.toThrow("the oracle is still considering");
    expect(c.listenerCount()).toBe(0);
  });

  test("times out when the request never shows up", async () => {
    const c = new FakeClient();
    c.callReducer = async (name: string, args: any[]) => { c.calls.push([name, ...args]); };
    await expect(askOracle(c, "hello", { timeoutMs: 60 })).rejects.toThrow("oracle did not accept the question");
  });

  test("offline or empty questions are refused without touching the module", async () => {
    const c = new FakeClient();
    c.isLive = false;
    await expect(askOracle(c, "hello")).rejects.toThrow("SpacetimeDB offline");
    c.isLive = true;
    await expect(askOracle(c, "   ")).rejects.toThrow("ask the Oracle something");
    expect(c.calls).toEqual([]);
    expect(c.listenerCount()).toBe(0);
  });

  test("a reducer refusal (e.g. the cooldown) propagates", async () => {
    const c = new FakeClient();
    c.callReducer = async () => { throw new Error("reducer ask_oracle 530: the Oracle is still considering your last question"); };
    await expect(askOracle(c, "hello", { timeoutMs: 200 })).rejects.toThrow("still considering your last question");
  });
});

/**
 * Like spacetime.js: a view joins `_subscribed` at once, so an earlier handle
 * applying emits it from the empty cache before its own subscription applies.
 */
class UnappliedFirstClient extends FakeClient {
  applied = new Set<string>();
  applyAfterMs: number | null = 15; // null = never applies (a module without the views)
  isApplied(table: string) { return this.applied.has(table); }
  subscribe(table: string, cb: (rows: Row[]) => void) {
    if (!this.listeners.has(table)) this.listeners.set(table, new Set());
    this.listeners.get(table)!.add(cb);
    if (this.applied.has(table)) cb([...this.views.get(table)!]);
    else {
      queueMicrotask(() => this.listeners.get(table)?.has(cb) && cb([])); // the empty-cache emit
      if (this.applyAfterMs != null) setTimeout(() => {
        this.applied.add(table);
        for (const l of this.listeners.get(table) || []) l([...this.views.get(table)!]);
      }, this.applyAfterMs);
    }
    return () => { this.listeners.get(table)?.delete(cb); };
  }
}

describe("askOracle and the subscription lifecycle", () => {
  test("an empty snapshot before the view applies is not taken as the real one", async () => {
    const c = new UnappliedFirstClient();
    c.views.set(ORACLE_VIEWS.requests, [{ request_id: "5", question: "what is my sign?", answered: true }]);
    c.views.set(ORACLE_VIEWS.replies, [{ request_id: "5", text: "an old answer" }]);
    expect(await askOracle(c, "what is my sign?", { timeoutMs: 1000 })).toEqual({ text: "answer to what is my sign?" });
  });

  test("views that never apply mean no question is sent", async () => {
    const c = new UnappliedFirstClient();
    c.applyAfterMs = null;
    await expect(askOracle(c, "hello", { timeoutMs: 1000, snapshotMs: 40 })).rejects.toThrow("the Oracle is unavailable");
    expect(c.calls).toEqual([]);
    expect(c.listenerCount()).toBe(0);
  });

  test("matches the stored question despite JS/Rust trim differences", async () => {
    const c = new FakeClient();
    // Rust's str::trim strips U+0085 (JS keeps it) and keeps U+FEFF (JS strips it).
    const rustTrim = (s: string) => s.replace(/^[\s\u0085]+|[\s\u0085]+$/g, "").replace(/^﻿|﻿$/g, "");
    const send = c.callReducer.bind(c);
    c.callReducer = async (name: string, args: any[]) => send(name, [rustTrim(args[0]) + (args[0].includes("\u0085") ? "" : "﻿"), ...args.slice(1)]);
    expect(await askOracle(c, "what is my sign?\u0085", { timeoutMs: 1000 })).toEqual({ text: "answer to what is my sign?" });
    expect(await askOracle(c, "﻿hello", { timeoutMs: 1000 })).toEqual({ text: "answer to hello﻿" });
  });
});

describe("waitForRows", () => {
  test("resolves null at the deadline and unsubscribes", async () => {
    const c = new FakeClient();
    expect(await waitForRows(c, ORACLE_VIEWS.replies, () => null, Date.now() + 20)).toBe(null);
    expect(c.listenerCount()).toBe(0);
  });
});
