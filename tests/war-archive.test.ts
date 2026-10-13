import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type ArchiveReader,
  type ArchiveSource,
  type ArchiveStore,
  type Cursor,
  type Row,
  type StreamName,
  PostgresArchiveStore,
  WarArchiver,
  applyRatings,
  archiveApi,
  bunPg,
  cachedSource,
  isoToMicros,
  microsToIso,
  rateTable,
  resultRecord,
  seatRecords,
} from "../feeder/war-archive";

const S = 1_000_000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 9, 13, 12, 0, 0) * 1000; // µs
const SOURCE: ArchiveSource = { sourceDb: `0x${"c2".repeat(32)}`, dbName: "pentacles1", uri: "http://stdb.test" };
const FACTIONS = ["Mars", "Venus", "Sun", "Moon", "Jupiter", "Saturn"];
const silent = { log: () => {}, warn: () => {} };

// ── Chain fixtures, in the shape sqlOneShot delivers ────────────────────────

function seat(i: number, occupant: string, score: number, extra: Row = {}): Row {
  return {
    seat_id: 100 + i, faction: FACTIONS[i % FACTIONS.length], occupant, handle: `agent-${occupant.slice(-2)}`,
    is_human: false, claim: 10 + i, counters: Math.floor(score / 2), melds_value: 0, score, tricks_won: 1,
    took_final_trick: i === 0, control_delta: 0, ...extra,
  };
}

function result(tableId: number, resolvedUs: number, opts: { seats?: Row[]; isVoid?: boolean; openedUs?: number } = {}): Row {
  const seats = opts.seats ?? [seat(0, "0xaa01", 40), seat(1, "0xaa02", 20)];
  let w = 0;
  seats.forEach((s, i) => { if (s.score > seats[w].score) w = i; });
  return {
    table_id: tableId, zone_id: tableId % 12, round_index: 1000 + tableId,
    opened_at: opts.openedUs ?? resolvedUs - MIN, resolved_at: resolvedUs,
    trump_suit: "Cups", decan_id: 19, seat_count: seats.length, tricks_played: opts.isVoid ? 0 : 12,
    refereed: true, is_void: Boolean(opts.isVoid),
    winner_seat_id: seats[w].seat_id, winner_faction: seats[w].faction, winner_occupant: seats[w].occupant,
    winner_is_human: false, winner_handle: seats[w].handle, winning_score: seats[w].score, winner_control_delta: 30,
    seats, zone_owner_before: null, zone_control_before: 0, zone_owner_after: "Mars", zone_control_after: 30,
    captured: false, flux_active: false, winner_esms: 1200, agent_turns: 2, fallback_turns: 1,
  };
}

function epoch(id: number, settledUs: number): Row {
  return {
    epoch_id: id, kind: "Season", is_decan: false, decan_id: null, season_number: id, champion: "Mars",
    champion_score: 7, standings: [0, 0, 0, 0, 7, 0, 0, 0, 0, 0], tables_settled: 12,
    started_at: settledUs - HOUR, settled_at: settledUs,
  };
}

function turn(id: number, requestedUs: number): Row {
  return {
    turn_id: id, table_id: 9, seat_id: 101, occupant: "0xaa02", trick_number: 3, legal_card_ids: [4, 8, 15],
    requested_at: requestedUs, expires_at: requestedUs + 5 * S, selected_card_id: 8,
    answered_at: requestedUs + 2 * S, resolved_at: requestedUs + 2 * S, fallback_used: false,
  };
}

/** The mocked query function: answers exactly the SQL the archiver sends. */
class FakeChain {
  melee_result: Row[] = [];
  war_epoch: Row[] = [];
  agent_melee_turn: Row[] = [];
  queries: string[] = [];
  fail: RegExp | null = null;

  query = async (sql: string): Promise<Row[]> => {
    this.queries.push(sql);
    if (this.fail?.test(sql)) throw new Error("sql 503: unavailable");
    let m = /^SELECT \* FROM (melee_result|agent_melee_turn) WHERE (\w+) >= '([^']+)'(?: AND \2 < '([^']+)')?$/.exec(sql);
    if (m) {
      const lo = isoToMicros(m[3]);
      const hi = m[4] ? isoToMicros(m[4]) : Infinity;
      expect(Number.isFinite(lo)).toBe(true);
      return (this as any)[m[1]].filter((r: Row) => r[m![2]] >= lo && r[m![2]] < hi).map((r: Row) => structuredClone(r));
    }
    m = /^SELECT \* FROM war_epoch WHERE epoch_id > (\d+)$/.exec(sql);
    if (m) return this.war_epoch.filter((e) => e.epoch_id > Number(m![1])).map((e) => structuredClone(e));
    m = /^SELECT epoch_id, settled_at FROM war_epoch WHERE epoch_id = (\d+)$/.exec(sql);
    if (m) return this.war_epoch.filter((e) => e.epoch_id === Number(m![1])).map((e) => ({ epoch_id: e.epoch_id, settled_at: e.settled_at }));
    throw new Error(`unexpected SQL: ${sql}`);
  };
}

/** Same contract as PostgresArchiveStore: keyed rows, atomic row+cursor commit. */
class MemoryStore implements ArchiveStore {
  rows: Record<StreamName, Map<string, Row>> = { melee_result: new Map(), war_epoch: new Map(), agent_melee_turn: new Map() };
  cursors = new Map<string, Cursor>();
  commits = 0;
  failCommits = 0;

  async init() {}
  async cursor(sourceDb: string, stream: StreamName) {
    const c = this.cursors.get(`${sourceDb}/${stream}`);
    return c ? { ...c } : null;
  }
  async commit(source: ArchiveSource, stream: StreamName, rows: Row[], cursor: Cursor) {
    if (this.failCommits > 0) {
      this.failCommits--;
      throw new Error("pg: connection refused");
    }
    this.commits++;
    const key = (r: Row) =>
      stream === "melee_result" ? `${r.table_id}@${r.opened_at}` : stream === "war_epoch" ? `${r.epoch_id}@${r.settled_at}` : `${r.turn_id}@${r.requested_at}`;
    const target = this.rows[stream];
    let fresh = 0;
    for (const r of rows) {
      const k = `${source.sourceDb}/${key(r)}`;
      if (!target.has(k)) {
        target.set(k, r);
        fresh++;
      }
    }
    this.cursors.set(`${source.sourceDb}/${stream}`, { ...cursor });
    return fresh;
  }
  ids(stream: StreamName, field: string) {
    return [...this.rows[stream].values()].map((r) => r[field]).sort((a, b) => a - b);
  }
}

function harness(opts: { maxWindowsPerPoll?: number; source?: () => Promise<ArchiveSource> } = {}) {
  const chain = new FakeChain();
  const store = new MemoryStore();
  const clock = { ms: T0 / 1000 };
  const make = () =>
    new WarArchiver({
      query: chain.query, store, source: opts.source ?? (async () => SOURCE), now: () => clock.ms, log: silent,
      maxWindowsPerPoll: opts.maxWindowsPerPoll,
    });
  return { chain, store, clock, archiver: make(), make };
}

async function pollUntilCaughtUp(a: WarArchiver) {
  for (let i = 0; i < 20; i++) {
    const r = await a.pollOnce();
    expect(r.errors).toEqual([]);
    if (r.caughtUp) return r;
  }
  throw new Error("never caught up");
}

// ── Values and records ──────────────────────────────────────────────────────

describe("War archive values", () => {
  test("microsToIso keeps all six fractional digits and round-trips", () => {
    expect(microsToIso(T0 + 166_495)).toBe("2026-10-13T12:00:00.166495Z");
    expect(microsToIso(T0)).toBe("2026-10-13T12:00:00.000000Z");
    expect(microsToIso(T0 - 1)).toBe("2026-10-13T11:59:59.999999Z");
    for (const us of [T0, T0 + 1, T0 + 999_999, T0 - 1]) expect(isoToMicros(microsToIso(us))).toBe(us);
  });

  test("a settled table flattens to one result and one row per seat", () => {
    const row = result(7, T0, { seats: [seat(0, "0xaa01", 20), seat(1, "0xaa02", 45), seat(2, "0xaa03", 45)] });
    const rec = resultRecord(row);
    expect(rec).toMatchObject({
      table_id: 7, opened_us: T0 - MIN, resolved_us: T0, resolved_at: "2026-10-13T12:00:00.000000Z",
      trump_suit: "Cups", winner_faction: "Venus", zone_owner_before: null, zone_owner_after: "Mars", is_void: false,
    });
    const seats = seatRecords(row);
    expect(seats.map((s) => s.seat_index)).toEqual([0, 1, 2]);
    // The winner is the module's winner_seat_id (first strictly-highest), not every top score.
    expect(seats.map((s) => s.is_winner)).toEqual([false, true, false]);
    expect(seats[1]).toMatchObject({ table_id: 7, opened_us: T0 - MIN, occupant: "0xaa02", faction: "Venus", score: 45 });
  });

  test("a void table has no winner seat", () => {
    expect(seatRecords(result(8, T0, { isVoid: true })).some((s) => s.is_winner)).toBe(false);
  });

  test("a missing NOT NULL value is never archived as zero or false", () => {
    const row = result(9, T0);
    delete row.zone_id;
    delete row.is_void;
    delete row.seats[0].score;
    delete row.seats[0].is_human;
    // NaN and null serialise to null, which the NOT NULL column rejects, failing the batch loudly.
    const rec = JSON.parse(JSON.stringify(resultRecord(row)));
    expect(rec.zone_id).toBeNull();
    expect(rec.is_void).toBeNull();
    const s0 = JSON.parse(JSON.stringify(seatRecords(row)[0]));
    expect(s0.score).toBeNull();
    expect(s0.is_human).toBeNull();
    expect(() => seatRecords({ ...row, seats: undefined })).toThrow("seats is not an array");
  });
});

describe("War archive ratings", () => {
  test("two equal players: the winner gains K/2 and the loser loses it", () => {
    expect(rateTable([{ occupant: "a", score: 30 }, { occupant: "b", score: 10 }], [1500, 1500], 24)).toEqual([1512, 1488]);
  });

  test("equal scores draw and leave equal ratings unchanged", () => {
    expect(rateTable([{ occupant: "a", score: 9 }, { occupant: "b", score: 9 }], [1500, 1500], 24)).toEqual([1500, 1500]);
  });

  test("a six-seat table conserves rating and orders changes by score", () => {
    const seats = [40, 10, 30, 0, 20, 50].map((score, i) => ({ occupant: `o${i}`, score }));
    const before = [1500, 1620, 1450, 1500, 1580, 1400];
    const after = rateTable(seats, before, 24);
    const deltas = after.map((r, i) => r - before[i]);
    expect(Math.abs(deltas.reduce((a, b) => a + b, 0))).toBeLessThan(1e-9);
    expect(deltas[5]).toBeGreaterThan(0); // top score, lowest rating: the biggest gain
    expect(deltas[3]).toBeLessThan(0); // scored nothing
    expect(Math.max(...deltas)).toBe(deltas[5]);
  });

  test("the favourite gains less for a win than the underdog would", () => {
    const fav = rateTable([{ occupant: "a", score: 1 }, { occupant: "b", score: 0 }], [1700, 1500], 24);
    const dog = rateTable([{ occupant: "a", score: 0 }, { occupant: "b", score: 1 }], [1700, 1500], 24);
    expect(fav[0] - 1700).toBeLessThan(dog[1] - 1500);
  });

  test("void and one-seat tables are not rated; tables and wins are counted once", () => {
    const ratings = new Map();
    const t = (row: Row) => ({ result: resultRecord(row), seats: seatRecords(row) });
    const played = t(result(1, T0));
    const voided = t(result(2, T0 + S, { isVoid: true }));
    const solo = t(result(3, T0 + 2 * S, { seats: [seat(0, "0xaa09", 50)] }));
    const touched = applyRatings([played, voided, solo], ratings, { k: 24, base: 1500 });
    expect([...touched].sort()).toEqual(["0xaa01", "0xaa02"]);
    expect(ratings.get("0xaa01")).toMatchObject({ rating: 1512, tables: 1, wins: 1, last_table_id: 1 });
    expect(ratings.get("0xaa02")).toMatchObject({ rating: 1488, tables: 1, wins: 0 });
    expect(played.seats.map((s) => [s.rating_before, s.rating_after])).toEqual([[1500, 1512], [1500, 1488]]);
    expect(voided.seats.every((s) => s.rating_after === null)).toBe(true);
  });
});

// ── The archiver, against a mocked query function ───────────────────────────

describe("War archiver", () => {
  test("first run backfills the 7 days the module keeps, then reads the head", async () => {
    const h = harness();
    h.chain.melee_result.push(result(1, T0 - 7 * DAY + HOUR), result(2, T0 - 3 * HOUR), result(3, T0 - 30 * S));
    h.chain.melee_result.push(result(4, T0 - 9 * DAY)); // already pruned on a real chain; outside the backfill
    const r = await pollUntilCaughtUp(h.archiver);
    expect(h.store.ids("melee_result", "table_id")).toEqual([1, 2, 3]);
    expect(h.archiver.stats.archived.results).toBe(3);
    expect(r.caughtUp).toBe(true);
    // The head is an open-ended read; the cursor trails the newest row by the lag.
    expect(h.chain.queries.filter((q) => q.includes("FROM melee_result")).at(-1)).toMatch(/^SELECT \* FROM melee_result WHERE resolved_at >= '[^']+'$/);
    expect(h.store.cursors.get(`${SOURCE.sourceDb}/melee_result`)!.position).toBe(T0 - 30 * S - MIN);
  });

  test("catching up is spread over polls and never skips a window", async () => {
    const h = harness({ maxWindowsPerPoll: 10 });
    for (let i = 0; i < 48; i++) h.chain.melee_result.push(result(i + 1, T0 - 8 * DAY + i * 4 * HOUR + 17 * S));
    const first = await h.archiver.pollOnce();
    expect(first.caughtUp).toBe(false);
    await pollUntilCaughtUp(h.archiver);
    expect(h.store.ids("melee_result", "table_id")).toEqual(Array.from({ length: 48 }, (_, i) => i + 1));
  });

  test("a table settled since the last poll is archived on the next poll", async () => {
    const h = harness();
    await pollUntilCaughtUp(h.archiver);
    h.clock.ms += 10_000;
    h.chain.melee_result.push(result(10, h.clock.ms * 1000 - 2 * S));
    h.clock.ms += 15_000; // one poll interval later
    const r = await h.archiver.pollOnce();
    expect(r.results).toBe(1);
    expect(h.store.ids("melee_result", "table_id")).toEqual([10]);
  });

  test("ids are assigned at open: a low id that settles late is still archived", async () => {
    const h = harness();
    h.chain.melee_result.push(result(50, T0 - 40 * S));
    await pollUntilCaughtUp(h.archiver);
    h.clock.ms += 15_000;
    h.chain.melee_result.push(result(7, T0 + 5 * S, { openedUs: T0 - 20 * MIN })); // a slow human table
    await h.archiver.pollOnce();
    expect(h.store.ids("melee_result", "table_id")).toEqual([7, 50]);
  });

  test("a row that commits late with an earlier timestamp (inside the lag) is not lost", async () => {
    const h = harness();
    h.chain.melee_result.push(result(20, T0 - 5 * S));
    await pollUntilCaughtUp(h.archiver);
    // Committed after the poll, but stamped before the newest row we saw.
    h.chain.melee_result.push(result(19, T0 - 20 * S));
    h.clock.ms += 15_000;
    await h.archiver.pollOnce();
    expect(h.store.ids("melee_result", "table_id")).toEqual([19, 20]);
  });

  test("a restart resumes from the stored cursor: no gap, no duplicate", async () => {
    const h = harness();
    h.chain.melee_result.push(result(1, T0 - 2 * HOUR), result(2, T0 - 10 * S));
    await pollUntilCaughtUp(h.archiver);
    const cursor = h.store.cursors.get(`${SOURCE.sourceDb}/melee_result`)!.position;
    h.archiver.stop();

    // Down for 3 hours; tables keep settling.
    h.clock.ms += 3 * 3600_000;
    h.chain.melee_result.push(result(3, T0 + HOUR), result(4, h.clock.ms * 1000 - 20 * S));
    h.chain.queries = [];
    const restarted = h.make();
    await pollUntilCaughtUp(restarted);
    expect(h.chain.queries[0]).toContain(`'${microsToIso(cursor)}'`);
    expect(h.store.ids("melee_result", "table_id")).toEqual([1, 2, 3, 4]);
    expect(restarted.stats.archived.results).toBe(2);
  });

  test("a failed read or write leaves the cursor where it was", async () => {
    const h = harness();
    await pollUntilCaughtUp(h.archiver);
    const before = { ...h.store.cursors.get(`${SOURCE.sourceDb}/melee_result`)! };
    h.chain.melee_result.push(result(30, T0 + 5 * S));
    h.clock.ms += 15_000;

    h.chain.fail = /FROM melee_result/;
    let r = await h.archiver.pollOnce();
    expect(r.errors.join()).toContain("melee_result: sql 503");
    expect(h.archiver.stats.lastError).toContain("sql 503");
    expect(h.store.cursors.get(`${SOURCE.sourceDb}/melee_result`)).toEqual(before);

    h.chain.fail = null;
    h.store.failCommits = 1;
    r = await h.archiver.pollOnce();
    expect(r.errors.join()).toContain("connection refused");
    expect(h.store.cursors.get(`${SOURCE.sourceDb}/melee_result`)).toEqual(before);

    r = await h.archiver.pollOnce();
    expect(r.errors).toEqual([]);
    expect(h.archiver.stats.lastError).toBeNull();
    expect(h.store.ids("melee_result", "table_id")).toEqual([30]);
  });

  test("one failing stream does not hold back the others", async () => {
    const h = harness();
    h.chain.fail = /FROM agent_melee_turn/;
    h.chain.melee_result.push(result(1, T0 - 10 * S));
    h.chain.war_epoch.push(epoch(1, T0 - HOUR));
    for (let i = 0; i < 3; i++) {
      const r = await h.archiver.pollOnce();
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toStartWith("agent_melee_turn:");
    }
    expect(h.store.ids("melee_result", "table_id")).toEqual([1]);
    expect(h.store.ids("war_epoch", "epoch_id")).toEqual([1]);
  });

  test("an idle head does not commit again", async () => {
    const h = harness();
    h.chain.melee_result.push(result(1, T0 - 10 * S));
    await pollUntilCaughtUp(h.archiver);
    const commits = h.store.commits;
    h.clock.ms += 15_000;
    await h.archiver.pollOnce();
    expect(h.store.commits).toBe(commits);
  });

  test("epochs are archived by id, and a reset database is read again from the start", async () => {
    const h = harness();
    h.chain.war_epoch.push(epoch(1, T0 - 3 * HOUR), epoch(2, T0 - 2 * HOUR), epoch(3, T0 - HOUR));
    await h.archiver.pollOnce();
    expect(h.store.ids("war_epoch", "epoch_id")).toEqual([1, 2, 3]);
    expect(h.store.cursors.get(`${SOURCE.sourceDb}/war_epoch`)).toEqual({ position: 3, marker: T0 - HOUR });

    // Wiped and re-published: ids restart, and id 3 already exists again.
    h.chain.war_epoch = [epoch(1, T0 + HOUR), epoch(2, T0 + 2 * HOUR), epoch(3, T0 + 3 * HOUR), epoch(4, T0 + 4 * HOUR)];
    h.clock.ms += 5 * 3600_000;
    const r = await h.archiver.pollOnce();
    expect(r.epochs).toBe(4);
    expect(h.store.rows.war_epoch.size).toBe(7);
    expect(h.store.cursors.get(`${SOURCE.sourceDb}/war_epoch`)).toEqual({ position: 4, marker: T0 + 4 * HOUR });
  });

  test("turns are archived once their window has settled", async () => {
    const h = harness();
    h.chain.agent_melee_turn.push(turn(1, T0 - 3 * HOUR), turn(2, T0 - 5 * MIN));
    await pollUntilCaughtUp(h.archiver);
    expect(h.store.ids("agent_melee_turn", "turn_id")).toEqual([1]);
    h.clock.ms += 20 * 60_000; // its window [T0-1h, T0) is not 30 minutes old yet
    await pollUntilCaughtUp(h.archiver);
    expect(h.store.ids("agent_melee_turn", "turn_id")).toEqual([1]);
    h.clock.ms += 40 * 60_000;
    await pollUntilCaughtUp(h.archiver);
    expect(h.store.ids("agent_melee_turn", "turn_id")).toEqual([1, 2]);
  });

  test("without a database identity nothing is written", async () => {
    const h = harness({ source: async () => { throw new Error("database info 503"); } });
    h.chain.melee_result.push(result(1, T0 - 10 * S));
    const r = await h.archiver.pollOnce();
    expect(r.errors).toEqual(["setup: database info 503"]);
    expect(h.store.commits).toBe(0);
    expect(h.chain.queries).toEqual([]);
  });

  test("reads go to the identity the rows are filed under, even while the name is cached", async () => {
    // pentacles1 is deleted and re-created as a new database while the old
    // identity is still cached. No row of the new database may land under the old id.
    const A = SOURCE.sourceDb;
    const B = `0x${"d4".repeat(32)}`;
    const dbs: Record<string, FakeChain> = { [A]: new FakeChain(), [B]: new FakeChain() };
    const clock = { ms: T0 / 1000 };
    let named = A;
    const store = new MemoryStore();
    const archiver = new WarArchiver({
      query: (sql, source) => dbs[source.sourceDb].query(sql),
      store,
      source: cachedSource(async () => ({ ...SOURCE, sourceDb: named }), 60_000, () => clock.ms),
      now: () => clock.ms,
      log: silent,
    });
    dbs[A].melee_result.push(result(1, T0 - 10 * S));
    await pollUntilCaughtUp(archiver);

    named = B;
    dbs[A].fail = /./; // the old database is gone
    dbs[B].melee_result.push(result(1, T0 + 5 * S), result(2, T0 + 6 * S));
    dbs[B].war_epoch.push(epoch(1, T0 + 7 * S));
    clock.ms += 15_000; // inside the cache TTL: still labelled A, so it reads A
    const stale = await archiver.pollOnce();
    expect(stale.errors.length).toBeGreaterThan(0);
    expect([...store.rows.melee_result.keys()].every((k) => k.startsWith(`${A}/1@`))).toBe(true);
    expect(store.rows.war_epoch.size).toBe(0);

    clock.ms += 60_000; // the name is resolved again
    await pollUntilCaughtUp(archiver);
    const keys = [...store.rows.melee_result.keys()];
    expect(keys.filter((k) => k.startsWith(A))).toHaveLength(1);
    expect(keys.filter((k) => k.startsWith(B))).toHaveLength(2);
    expect([...store.rows.war_epoch.keys()].every((k) => k.startsWith(B))).toBe(true);
    expect(archiver.stats.sourceDb).toBe(B);
  });
});

describe("War archive plumbing", () => {
  test("cachedSource keeps the last good identity when a refresh fails", async () => {
    let calls = 0;
    let now = 0;
    const get = cachedSource(async () => {
      calls++;
      if (calls > 1) throw new Error("down");
      return SOURCE;
    }, 1000, () => now);
    expect(await get()).toEqual(SOURCE);
    now = 5000;
    expect(await get()).toEqual(SOURCE);
    expect(calls).toBe(2);
    await expect(cachedSource(async () => { throw new Error("down"); })()).rejects.toThrow("down");
  });

  test("archiveApi validates its parameters", async () => {
    const seen: Row[] = [];
    const reader: ArchiveReader = {
      status: async () => ({ results: 3 }),
      winRates: async (o) => { seen.push(o); return []; },
      ratings: async (o) => { seen.push(o); return []; },
    };
    const archiver = new WarArchiver({ query: async () => [], store: new MemoryStore(), source: async () => SOURCE, log: silent });
    const api = (path: string, handle = { archiver, store: reader }) => archiveApi(handle, new URL(`http://x${path}`));

    expect((await api("/api/v1/war/archive/status", null as any)).status).toBe(503);
    expect((await api("/api/v1/war/archive/ratings")).status).toBe(503); // not connected yet
    await archiver.pollOnce();
    expect((await api("/api/v1/war/archive/status")).body).toMatchObject({ success: true, sourceDb: SOURCE.sourceDb, archive: { results: 3 } });
    expect((await api("/api/v1/war/archive/win-rates?by=elo;drop")).status).toBe(400);
    expect((await api("/api/v1/war/archive/win-rates?by=constructor")).status).toBe(400);
    expect((await api("/api/v1/war/archive/win-rates?by=__proto__")).status).toBe(400);
    expect((await api("/api/v1/war/archive/nope")).status).toBe(404);
    await api("/api/v1/war/archive/win-rates?by=zone&days=99999");
    await api("/api/v1/war/archive/ratings?limit=0&humans=1");
    expect(seen).toEqual([
      { sourceDb: SOURCE.sourceDb, by: "zone", days: 3650 },
      { sourceDb: SOURCE.sourceDb, limit: 1, humans: true },
    ]);
    // Answers are cached, so a burst of identical requests reads Postgres once.
    await api("/api/v1/war/archive/win-rates?by=zone&days=99999");
    expect(seen).toHaveLength(2);
  });

  test("archiveApi reports a failed start, and /status survives a Postgres outage", async () => {
    const failed = await archiveApi({ startError: "Invalid URL" }, new URL("http://x/api/v1/war/archive/status"));
    expect(failed.status).toBe(503);
    expect(failed.body.error).toContain("failed to start: Invalid URL");

    const archiver = new WarArchiver({ query: async () => [], store: new MemoryStore(), source: async () => SOURCE, log: silent });
    await archiver.pollOnce();
    const down: ArchiveReader = {
      status: async () => { throw new Error("Connection closed"); },
      winRates: async () => [],
      ratings: async () => [],
    };
    const r = await archiveApi({ archiver, store: down }, new URL("http://x/api/v1/war/archive/status"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, sourceDb: SOURCE.sourceDb, polls: 1, archive: null, archive_error: "Connection closed" });
  });
});

// ── Postgres (runs when WAR_ARCHIVE_TEST_DATABASE_URL is set) ───────────────

const PG_URL = process.env.WAR_ARCHIVE_TEST_DATABASE_URL;

describe.skipIf(!PG_URL)("War archive on Postgres", () => {
  const pg = PG_URL ? bunPg(PG_URL, 1) : (null as any);
  const src: ArchiveSource = { ...SOURCE, sourceDb: `0xtest${process.pid}${Math.floor(performance.now())}` };
  const store = new PostgresArchiveStore(pg);
  const purge = async () => {
    for (const t of ["war_melee_seat", "war_melee_result", "war_epoch_history", "war_agent_turn", "war_rating", "war_archive_cursor", "war_archive_source"]) {
      await pg.query(`DELETE FROM ${t} WHERE source_db = $1`, [src.sourceDb]);
    }
  };

  beforeAll(async () => {
    await store.init();
    await store.init(); // idempotent
    await purge();
  });
  afterAll(async () => {
    await purge();
    await pg.close();
  });

  test("rows and cursor commit together; a re-read inserts and rates nothing twice", async () => {
    const rows = [
      result(1, T0, { seats: [seat(0, "0xbb01", 40), seat(1, "0xbb02", 20), seat(2, "0xbb03", 30)] }),
      result(2, T0 + S, { isVoid: true }),
    ];
    expect(await store.commit(src, "melee_result", rows, { position: T0 + 2 * S })).toBe(2);
    expect(await store.commit(src, "melee_result", rows, { position: T0 + 3 * S })).toBe(0);
    expect(await store.cursor(src.sourceDb, "melee_result")).toEqual({ position: T0 + 3 * S, marker: null });

    const seats = await pg.query(
      "SELECT table_id, seat_index, is_winner, rating_before, rating_after FROM war_melee_seat WHERE source_db = $1 ORDER BY table_id, seat_index",
      [src.sourceDb],
    );
    expect(seats).toHaveLength(5);
    expect(seats.filter((s: Row) => s.is_winner).map((s: Row) => Number(s.table_id))).toEqual([1]);
    expect(seats.filter((s: Row) => Number(s.table_id) === 2).every((s: Row) => s.rating_after === null)).toBe(true);

    const ratings = await pg.query("SELECT occupant, rating, tables, wins FROM war_rating WHERE source_db = $1", [src.sourceDb]);
    expect(ratings).toHaveLength(3); // the void table rated no one
    expect(Math.abs(ratings.reduce((a: number, r: Row) => a + Number(r.rating) - 1500, 0))).toBeLessThan(1e-9);
    expect(ratings.find((r: Row) => r.occupant === "0xbb01")).toMatchObject({ tables: 1, wins: 1 });

    const [stored] = await pg.query(
      "SELECT (resolved_at AT TIME ZONE 'UTC')::text AS resolved, seat_count, trump_suit, zone_owner_before FROM war_melee_result WHERE source_db = $1 AND table_id = 1",
      [src.sourceDb],
    );
    expect(stored).toMatchObject({ seat_count: 3, trump_suit: "Cups", zone_owner_before: null });
    expect(stored.resolved).toContain("12:00:00");
  });

  test("a reset database's table 1 is a new row, not a duplicate", async () => {
    const again = result(1, T0 + DAY, { openedUs: T0 + DAY - MIN });
    expect(await store.commit(src, "melee_result", [again], { position: T0 + DAY })).toBe(1);
  });

  test("epochs and turns round-trip, including arrays and nullable timestamps", async () => {
    expect(await store.commit(src, "war_epoch", [epoch(1, T0), epoch(2, T0 + HOUR)], { position: 2, marker: T0 + HOUR })).toBe(2);
    expect(await store.cursor(src.sourceDb, "war_epoch")).toEqual({ position: 2, marker: T0 + HOUR });
    const pending = { ...turn(2, T0), answered_at: null, resolved_at: null, selected_card_id: null };
    expect(await store.commit(src, "agent_melee_turn", [turn(1, T0), pending], { position: T0 + HOUR })).toBe(2);
    const [e] = await pg.query("SELECT standings[5] AS mars, champion FROM war_epoch_history WHERE source_db = $1 AND epoch_id = 1", [src.sourceDb]);
    expect(e).toMatchObject({ champion: "Mars" });
    expect(Number(e.mars)).toBe(7);
    const turns = await pg.query("SELECT turn_id, legal_card_ids, resolved_at FROM war_agent_turn WHERE source_db = $1 ORDER BY turn_id", [src.sourceDb]);
    expect(turns.map((t: Row) => t.resolved_at === null)).toEqual([false, true]);
    expect(turns[0].legal_card_ids.map(Number)).toEqual([4, 8, 15]);
  });

  test("the archiver resumes on a fresh store instance after a restart", async () => {
    const chain = new FakeChain();
    const clock = { ms: (T0 + 2 * DAY) / 1000 };
    const mk = () => new WarArchiver({
      query: chain.query, store: new PostgresArchiveStore(pg), source: async () => src, now: () => clock.ms, log: silent,
      archiveTurns: false,
    });
    const base = T0 + 2 * DAY;
    chain.melee_result.push(result(101, base - 5 * HOUR), result(102, base - 20 * S));
    let a = mk();
    await pollUntilCaughtUp(a);
    clock.ms += 3600_000;
    chain.melee_result.push(result(103, base + 30 * MIN), result(104, clock.ms * 1000 - 10 * S));
    a = mk();
    await pollUntilCaughtUp(a);
    const ids = await pg.query("SELECT table_id FROM war_melee_result WHERE source_db = $1 AND table_id > 100 ORDER BY table_id", [src.sourceDb]);
    expect(ids.map((r: Row) => Number(r.table_id))).toEqual([101, 102, 103, 104]);
  });

  test("the analysis views and read endpoints answer", async () => {
    for (const v of ["war_faction_win_rate", "war_seat_win_rate", "war_daily", "war_leaderboard"]) {
      const rows = await pg.query(`SELECT * FROM ${v} WHERE source_db = $1`, [src.sourceDb]);
      expect(rows.length).toBeGreaterThan(0);
    }
    const byFaction = await store.winRates({ sourceDb: src.sourceDb, by: "faction", days: 30, nowMs: (T0 + 3 * DAY) / 1000 });
    expect(byFaction.find((r) => r.faction === "Mars")).toMatchObject({ wins: expect.any(Number), par_rate: expect.any(Number) });
    const bySeat = await store.winRates({ sourceDb: src.sourceDb, by: "seat", days: 30, nowMs: (T0 + 3 * DAY) / 1000 });
    expect(bySeat.every((r) => typeof r.seat_index === "number")).toBe(true);
    const top = await store.ratings({ sourceDb: src.sourceDb, limit: 2, humans: false });
    expect(top).toHaveLength(2);
    expect(top[0].rating).toBeGreaterThanOrEqual(top[1].rating);
    const status = await store.status(src.sourceDb);
    expect(status.results).toBe(7);
    expect(status.epochs).toBe(2);
  });

  test("views are left alone on restart, and a view that cannot be replaced never blocks archiving", async () => {
    const warnings: string[] = [];
    const quiet = new PostgresArchiveStore(pg, { log: { warn: (m: string) => warnings.push(m) } });
    // Someone builds on a view; restarts must not drop it (or its grants).
    await pg.query("CREATE OR REPLACE VIEW test_war_weekly AS SELECT * FROM war_daily");
    await quiet.init();
    await pg.query("UPDATE war_archive_meta SET value = 'old' WHERE key = 'views'");
    await quiet.init(); // definitions "changed": CREATE OR REPLACE keeps the dependent view
    expect(warnings).toEqual([]);
    expect((await pg.query("SELECT to_regclass('test_war_weekly') IS NOT NULL AS ok"))[0].ok).toBe(true);
    await pg.query("DROP VIEW test_war_weekly");

    // An incompatible definition is reported, and init still succeeds.
    await pg.query("DROP VIEW war_daily");
    await pg.query("CREATE VIEW war_daily AS SELECT 1 AS x");
    await pg.query("UPDATE war_archive_meta SET value = 'old' WHERE key = 'views'");
    await quiet.init();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("analysis views not updated");
    // (void, so it rates no one and the rebuild check below is unaffected)
    expect(await quiet.commit(src, "melee_result", [result(900, T0 + 4 * DAY, { isVoid: true })], { position: T0 + 4 * DAY })).toBe(1);
    await pg.query("DELETE FROM war_melee_result WHERE source_db = $1 AND table_id = 900", [src.sourceDb]);
    await pg.query("DROP VIEW war_daily");
    await pg.query("UPDATE war_archive_meta SET value = 'old' WHERE key = 'views'");
    await quiet.init();
    expect((await pg.query("SELECT count(*)::int AS n FROM war_daily WHERE source_db = $1", [src.sourceDb]))[0].n).toBeGreaterThan(0);
  });

  test("rebuild-ratings replays the archive to the same ratings", async () => {
    const before = await pg.query("SELECT occupant, rating, tables, wins FROM war_rating WHERE source_db = $1 ORDER BY occupant", [src.sourceDb]);
    const r = await store.rebuildRatings(src.sourceDb);
    expect(r.occupants).toBe(before.length);
    const after = await pg.query("SELECT occupant, rating, tables, wins FROM war_rating WHERE source_db = $1 ORDER BY occupant", [src.sourceDb]);
    expect(after.map((x: Row) => [x.occupant, x.tables, x.wins])).toEqual(before.map((x: Row) => [x.occupant, x.tables, x.wins]));
    after.forEach((x: Row, i: number) => expect(Number(x.rating)).toBeCloseTo(Number(before[i].rating), 9));
  });
});
