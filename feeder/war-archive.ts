// Pentacles — off-chain War Table archive (Postgres).
//
// The module keeps one `melee_result` row per settled table for 7 days and then
// prunes it (docs/WAR_RESULTS_LIFECYCLE.md). Balance tuning, agent evaluation
// and replays need months, so this copies every result into Postgres, where
// nothing is pruned. It also copies the decan/season `war_epoch` rows and the
// ASOL `agent_melee_turn` audit rows, which the module keeps for 1 day.
//
// It runs inside the indoor-spatial feeder (not as a new supervised service)
// and is off unless WAR_ARCHIVE_DATABASE_URL is set. Every write is one
// Postgres transaction that also moves that stream's cursor, so a crash or a
// redeploy resumes exactly where the last commit stopped. The primary keys
// absorb the small overlap a resumed read can cause.
//
// Streams (a cursor means "everything before this is archived"):
//   melee_result      resolved_at, in µs. While catching up it reads closed
//                     1-hour windows. At the head it reads `resolved_at >=
//                     cursor` every poll, and the cursor trails the newest row
//                     by LAG. A table that committed a moment late with an
//                     earlier timestamp is therefore still read. Never use
//                     table_id: ids are assigned when a table OPENS, so a
//                     human table can settle after higher-numbered ones.
//   agent_melee_turn  requested_at, in µs. Only windows that closed at least
//                     TURN_SETTLE ago, so each turn is archived after ASOL or
//                     the fallback has decided it.
//   war_epoch         epoch_id (auto_inc, so it follows commit order), plus
//                     the settled_at of the cursor row, which detects a reset.
//
// Rows are keyed by the SpacetimeDB database IDENTITY, not its name, and every
// key includes the row's own timestamp. A wiped and re-published database
// restarts table_id at 1. Without the timestamp, its first tables would
// collide with archived ones and be dropped as duplicates.

import { SQL } from "bun";

export type Row = Record<string, any>;
export type Query = (sql: string) => Promise<Row[]>;
export type StreamName = "melee_result" | "war_epoch" | "agent_melee_turn";

const MICROS = 1_000_000;
const DAY_US = 86_400 * MICROS;

export const ARCHIVE_DEFAULTS = {
  pollMs: 15_000,
  /** Window size while catching up (≈ 660 results at the module's max pace). */
  windowUs: 3_600 * MICROS,
  /** A window is closed once its end is this far behind the feeder clock.
   *  It covers clock skew between the feeder and the database. */
  settleUs: 600 * MICROS,
  /** Turns are archived later. ASOL or the fallback decides a turn within
   *  seconds. One left open on a stalled table stays open until that table is
   *  voided at 1 h (MELEE_STALE_VOID_SECS), so this waits past that. */
  turnSettleUs: 4_500 * MICROS,
  /** At the head, the cursor trails the newest resolved_at by this much. */
  lagUs: 60 * MICROS,
  /** First run: melee_result is kept 7 days on chain, agent_melee_turn 1. */
  resultBackfillUs: 8 * DAY_US,
  turnBackfillUs: 2 * DAY_US,
  maxWindowsPerPoll: 96,
  /** How long a resolved database identity is trusted before re-checking. */
  sourceTtlMs: 10 * 60_000,
  eloK: 24,
  eloBase: 1500,
};

/** The module's melee_result retention (MELEE_RESULT_TTL_SECS). */
const RESULT_RETENTION_US = 7 * DAY_US;

// ── Values ──────────────────────────────────────────────────────────────────
//
// Rows arrive through sqlOneShot (feeder/stdb-feed.ts): Timestamp → µs number,
// enum → PascalCase string, Option → value | null, Identity → "0x…", and
// Vec<struct> → array of objects. A missing NOT NULL value becomes NaN or null
// here, so Postgres rejects the batch loudly instead of archiving a zero.

const num = (v: unknown): number => (v === null || v === undefined ? NaN : Number(v));
const optNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const tag = (v: unknown): string | null =>
  typeof v === "string" ? v : v && typeof v === "object" && typeof (v as any).tag === "string" ? (v as any).tag : null;
const optIso = (v: unknown): string | null => (v === null || v === undefined ? null : microsToIso(num(v)));
const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** µs since the Unix epoch → RFC 3339 with all six fractional digits. Both the
 *  module's SQL and Postgres accept it, and neither loses the microseconds. */
export function microsToIso(us: number): string {
  const u = Math.floor(us);
  const secs = Math.floor(u / MICROS);
  const frac = u - secs * MICROS;
  return `${new Date(secs * 1000).toISOString().slice(0, 19)}.${String(frac).padStart(6, "0")}Z`;
}

/** Inverse of microsToIso (UTC "Z" form only). */
export function isoToMicros(iso: string): number {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(iso);
  if (!m) return NaN;
  return (Date.parse(`${m[1]}Z`) / 1000) * MICROS + Number((m[2] ?? "").padEnd(6, "0").slice(0, 6));
}

// ── Archive schema ──────────────────────────────────────────────────────────
//
// One column spec per table drives the DDL, the INSERT column list and the
// jsonb_to_recordset type list, so the three cannot drift apart.

type Col = readonly [name: string, pgType: string, nullable?: boolean];

const RESULT_COLS: Col[] = [
  ["table_id", "BIGINT"],
  ["opened_us", "BIGINT"], // exact µs, part of the key (and the rating-rebuild order)
  ["resolved_us", "BIGINT"],
  ["zone_id", "SMALLINT"],
  ["round_index", "BIGINT"],
  ["opened_at", "TIMESTAMPTZ"],
  ["resolved_at", "TIMESTAMPTZ"],
  ["trump_suit", "TEXT"],
  ["decan_id", "SMALLINT", true],
  ["seat_count", "SMALLINT"],
  ["tricks_played", "SMALLINT"],
  ["refereed", "BOOLEAN"],
  ["is_void", "BOOLEAN"],
  ["winner_seat_id", "BIGINT"],
  ["winner_faction", "TEXT"],
  ["winner_occupant", "TEXT"],
  ["winner_is_human", "BOOLEAN"],
  ["winner_handle", "TEXT"],
  ["winning_score", "INTEGER"],
  ["winner_control_delta", "INTEGER"],
  ["zone_owner_before", "TEXT", true],
  ["zone_control_before", "INTEGER"],
  ["zone_owner_after", "TEXT", true],
  ["zone_control_after", "INTEGER"],
  ["captured", "BOOLEAN"],
  ["flux_active", "BOOLEAN"],
  ["winner_esms", "BIGINT"],
  ["agent_turns", "INTEGER"],
  ["fallback_turns", "INTEGER"],
];

const SEAT_COLS: Col[] = [
  ["table_id", "BIGINT"],
  ["opened_us", "BIGINT"],
  ["seat_index", "SMALLINT"], // position in melee_result.seats
  ["seat_id", "BIGINT"],
  ["faction", "TEXT"],
  ["occupant", "TEXT"],
  ["handle", "TEXT"],
  ["is_human", "BOOLEAN"],
  ["claim", "INTEGER"],
  ["counters", "INTEGER"],
  ["melds_value", "INTEGER"],
  ["score", "INTEGER"],
  ["tricks_won", "SMALLINT"],
  ["took_final_trick", "BOOLEAN"],
  ["control_delta", "INTEGER"],
  ["is_winner", "BOOLEAN"], // false on void tables
  ["rating_before", "DOUBLE PRECISION", true], // null on unrated (void / one-seat) tables
  ["rating_after", "DOUBLE PRECISION", true],
];

const EPOCH_COLS: Col[] = [
  ["epoch_id", "BIGINT"],
  ["kind", "TEXT"],
  ["is_decan", "BOOLEAN"],
  ["decan_id", "SMALLINT", true],
  ["season_number", "BIGINT", true],
  ["champion", "TEXT", true],
  ["champion_score", "BIGINT"],
  ["standings", "BIGINT[]"], // ten entries by Planet index
  ["tables_settled", "BIGINT"],
  ["started_at", "TIMESTAMPTZ"],
  ["settled_at", "TIMESTAMPTZ"],
];

const TURN_COLS: Col[] = [
  ["turn_id", "BIGINT"],
  ["table_id", "BIGINT"],
  ["seat_id", "BIGINT"],
  ["occupant", "TEXT"],
  ["trick_number", "SMALLINT"],
  ["legal_card_ids", "BIGINT[]"],
  ["requested_at", "TIMESTAMPTZ"],
  ["expires_at", "TIMESTAMPTZ"],
  ["selected_card_id", "BIGINT", true],
  ["answered_at", "TIMESTAMPTZ", true],
  ["resolved_at", "TIMESTAMPTZ", true],
  ["fallback_used", "BOOLEAN"],
];

const RATING_COLS: Col[] = [
  ["occupant", "TEXT"],
  ["handle", "TEXT"],
  ["faction", "TEXT"],
  ["is_human", "BOOLEAN"],
  ["rating", "DOUBLE PRECISION"],
  ["tables", "INTEGER"],
  ["wins", "INTEGER"],
  ["last_table_id", "BIGINT"],
  ["last_resolved_at", "TIMESTAMPTZ"],
];

const colDefs = (cols: Col[]) => cols.map(([n, t, nullable]) => `${n} ${t}${nullable ? "" : " NOT NULL"}`).join(",\n    ");
const colNames = (cols: Col[]) => cols.map(([n]) => n).join(", ");
const recordset = (cols: Col[]) => cols.map(([n, t]) => `${n} ${t}`).join(", ");

/** Idempotent. A later schema change adds columns with ALTER TABLE … ADD
 *  COLUMN IF NOT EXISTS here; CREATE TABLE IF NOT EXISTS never alters. */
export const ARCHIVE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS war_archive_source (
    source_db TEXT PRIMARY KEY,
    db_name TEXT NOT NULL,
    uri TEXT NOT NULL,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS war_archive_cursor (
    source_db TEXT NOT NULL REFERENCES war_archive_source (source_db),
    stream TEXT NOT NULL,
    position BIGINT NOT NULL,
    marker BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_db, stream)
  )`,
  `CREATE TABLE IF NOT EXISTS war_melee_result (
    source_db TEXT NOT NULL,
    ${colDefs(RESULT_COLS)},
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_db, table_id, opened_us)
  )`,
  `CREATE INDEX IF NOT EXISTS war_melee_result_resolved ON war_melee_result (source_db, resolved_us)`,
  `CREATE TABLE IF NOT EXISTS war_melee_seat (
    source_db TEXT NOT NULL,
    ${colDefs(SEAT_COLS)},
    PRIMARY KEY (source_db, table_id, opened_us, seat_index),
    FOREIGN KEY (source_db, table_id, opened_us)
      REFERENCES war_melee_result (source_db, table_id, opened_us) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS war_melee_seat_occupant ON war_melee_seat (source_db, occupant)`,
  `CREATE TABLE IF NOT EXISTS war_epoch_history (
    source_db TEXT NOT NULL,
    ${colDefs(EPOCH_COLS)},
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_db, epoch_id, settled_at)
  )`,
  `CREATE TABLE IF NOT EXISTS war_agent_turn (
    source_db TEXT NOT NULL,
    ${colDefs(TURN_COLS)},
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (source_db, turn_id, requested_at)
  )`,
  `CREATE INDEX IF NOT EXISTS war_agent_turn_table ON war_agent_turn (source_db, table_id)`,
  `CREATE TABLE IF NOT EXISTS war_rating (
    source_db TEXT NOT NULL,
    ${colDefs(RATING_COLS)},
    PRIMARY KEY (source_db, occupant)
  )`,
];

/** Analysis views, for psql (the HTTP endpoints add a time filter). They are
 *  dropped and re-created on every start, so a definition can change freely;
 *  they hold no data. */
export const ARCHIVE_VIEWS: Record<string, string> = {
  // Faction win rate by zone, trump suit and seat count. par_rate is the win
  // rate a perfectly balanced table would give (1 / seats).
  war_faction_win_rate: `
  SELECT s.source_db, s.faction, r.zone_id, r.trump_suit, r.seat_count,
         count(*) AS seats_played,
         count(*) FILTER (WHERE s.is_winner) AS wins,
         round(avg(CASE WHEN s.is_winner THEN 1.0 ELSE 0.0 END), 4) AS win_rate,
         round(1.0 / NULLIF(r.seat_count, 0), 4) AS par_rate,
         round(avg(s.score), 2) AS avg_score
  FROM war_melee_seat s
  JOIN war_melee_result r USING (source_db, table_id, opened_us)
  WHERE NOT r.is_void
  GROUP BY s.source_db, s.faction, r.zone_id, r.trump_suit, r.seat_count`,
  // Does seat order matter? Win rate by seat position for each table size.
  war_seat_win_rate: `
  SELECT s.source_db, r.seat_count, s.seat_index,
         count(*) AS tables,
         count(*) FILTER (WHERE s.is_winner) AS wins,
         round(avg(CASE WHEN s.is_winner THEN 1.0 ELSE 0.0 END), 4) AS win_rate,
         round(1.0 / NULLIF(r.seat_count, 0), 4) AS par_rate
  FROM war_melee_seat s
  JOIN war_melee_result r USING (source_db, table_id, opened_us)
  WHERE NOT r.is_void
  GROUP BY s.source_db, r.seat_count, s.seat_index`,
  // Per UTC day: volume, void rate, captures, ESMS paid, ASOL fallback rate.
  war_daily: `
  SELECT source_db, (resolved_at AT TIME ZONE 'UTC')::date AS day,
         count(*) AS tables,
         count(*) FILTER (WHERE is_void) AS void_tables,
         count(*) FILTER (WHERE captured) AS captures,
         count(*) FILTER (WHERE winner_is_human AND NOT is_void) AS human_wins,
         sum(winner_esms) AS esms_paid,
         sum(agent_turns) AS agent_turns,
         sum(fallback_turns) AS fallback_turns
  FROM war_melee_result
  GROUP BY 1, 2`,
  war_leaderboard: `
  SELECT source_db, occupant, handle, faction, is_human,
         round(rating::numeric, 1) AS rating, tables, wins,
         round(wins::numeric / NULLIF(tables, 0), 4) AS win_rate,
         last_resolved_at,
         rank() OVER (PARTITION BY source_db ORDER BY rating DESC) AS rank
  FROM war_rating`,
};

// ── Row → archive record ────────────────────────────────────────────────────

export interface ResultRecord {
  table_id: number;
  opened_us: number;
  resolved_us: number;
  is_void: boolean;
  resolved_at: string;
  [col: string]: unknown;
}

export interface SeatRecord {
  table_id: number;
  opened_us: number;
  seat_index: number;
  occupant: string;
  handle: string;
  faction: string;
  is_human: boolean;
  score: number;
  is_winner: boolean;
  rating_before: number | null;
  rating_after: number | null;
  [col: string]: unknown;
}

export function resultRecord(r: Row): ResultRecord {
  return {
    table_id: num(r.table_id),
    opened_us: num(r.opened_at),
    resolved_us: num(r.resolved_at),
    zone_id: num(r.zone_id),
    round_index: num(r.round_index),
    opened_at: microsToIso(num(r.opened_at)),
    resolved_at: microsToIso(num(r.resolved_at)),
    trump_suit: tag(r.trump_suit),
    decan_id: optNum(r.decan_id),
    seat_count: num(r.seat_count),
    tricks_played: num(r.tricks_played),
    refereed: Boolean(r.refereed),
    is_void: Boolean(r.is_void),
    winner_seat_id: num(r.winner_seat_id),
    winner_faction: tag(r.winner_faction),
    winner_occupant: r.winner_occupant ?? null,
    winner_is_human: Boolean(r.winner_is_human),
    winner_handle: r.winner_handle ?? null,
    winning_score: num(r.winning_score),
    winner_control_delta: num(r.winner_control_delta),
    zone_owner_before: tag(r.zone_owner_before),
    zone_control_before: num(r.zone_control_before),
    zone_owner_after: tag(r.zone_owner_after),
    zone_control_after: num(r.zone_control_after),
    captured: Boolean(r.captured),
    flux_active: Boolean(r.flux_active),
    winner_esms: num(r.winner_esms),
    agent_turns: num(r.agent_turns),
    fallback_turns: num(r.fallback_turns),
  };
}

/** One record per entry of melee_result.seats. A void table has no winner. */
export function seatRecords(r: Row): SeatRecord[] {
  const seats: any[] = Array.isArray(r.seats) ? r.seats : [];
  const winner = num(r.winner_seat_id);
  return seats.map((s, i) => ({
    table_id: num(r.table_id),
    opened_us: num(r.opened_at),
    seat_index: i,
    seat_id: num(s?.seat_id),
    faction: tag(s?.faction) as string,
    occupant: s?.occupant ?? null,
    handle: s?.handle ?? null,
    is_human: Boolean(s?.is_human),
    claim: num(s?.claim),
    counters: num(s?.counters),
    melds_value: num(s?.melds_value),
    score: num(s?.score),
    tricks_won: num(s?.tricks_won),
    took_final_trick: Boolean(s?.took_final_trick),
    control_delta: num(s?.control_delta),
    is_winner: !r.is_void && num(s?.seat_id) === winner,
    rating_before: null,
    rating_after: null,
  }));
}

export function epochRecord(r: Row): Row {
  return {
    epoch_id: num(r.epoch_id),
    kind: tag(r.kind),
    is_decan: Boolean(r.is_decan),
    decan_id: optNum(r.decan_id),
    season_number: optNum(r.season_number),
    champion: tag(r.champion),
    champion_score: num(r.champion_score),
    standings: Array.isArray(r.standings) ? r.standings.map(num) : null,
    tables_settled: num(r.tables_settled),
    started_at: microsToIso(num(r.started_at)),
    settled_at: microsToIso(num(r.settled_at)),
  };
}

export function turnRecord(r: Row): Row {
  return {
    turn_id: num(r.turn_id),
    table_id: num(r.table_id),
    seat_id: num(r.seat_id),
    occupant: r.occupant ?? null,
    trick_number: num(r.trick_number),
    legal_card_ids: Array.isArray(r.legal_card_ids) ? r.legal_card_ids.map(num) : null,
    requested_at: microsToIso(num(r.requested_at)),
    expires_at: microsToIso(num(r.expires_at)),
    selected_card_id: optNum(r.selected_card_id),
    answered_at: optIso(r.answered_at),
    resolved_at: optIso(r.resolved_at),
    fallback_used: Boolean(r.fallback_used),
  };
}

// ── Ratings ─────────────────────────────────────────────────────────────────
//
// Multi-player Elo: a table of N seats is scored as every pair of seats
// meeting once (higher score wins the pair, equal scores draw), each pair
// weighted K/(N-1). The sum of all changes at a table is zero. Ratings are
// applied as results are archived, oldest first. A table archived late is
// rated against the ratings current at that point. `rebuild-ratings` replays
// everything in settle order.

export interface RatingRow {
  occupant: string;
  handle: string;
  faction: string;
  is_human: boolean;
  rating: number;
  tables: number;
  wins: number;
  last_table_id: number;
  last_resolved_at: string;
}

/** Ratings after one table, per seat. `before[i]` is seat i's rating going in. */
export function rateTable(seats: Array<{ occupant: string; score: number }>, before: number[], k: number): number[] {
  const n = seats.length;
  if (n < 2) return before.slice();
  const delta = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    let d = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const actual = seats[i].score > seats[j].score ? 1 : seats[i].score < seats[j].score ? 0 : 0.5;
      const expected = 1 / (1 + 10 ** ((before[j] - before[i]) / 400));
      d += actual - expected;
    }
    // Keyed by occupant: the same identity in two seats moves once, by the sum.
    delta.set(seats[i].occupant, (delta.get(seats[i].occupant) ?? 0) + (k / (n - 1)) * d);
  }
  return seats.map((s, i) => before[i] + (delta.get(s.occupant) ?? 0));
}

/** Rates `tables` in the given order. Each rated seat gets rating_before and
 *  rating_after, and `ratings` is updated in place. Returns the occupants it
 *  changed. Void and one-seat tables are not rated. */
export function applyRatings(
  tables: Array<{ result: Pick<ResultRecord, "table_id" | "is_void" | "resolved_at">; seats: SeatRecord[] }>,
  ratings: Map<string, RatingRow>,
  opts: { k: number; base: number },
): Set<string> {
  const touched = new Set<string>();
  for (const { result, seats } of tables) {
    if (result.is_void || seats.length < 2) continue;
    const before = seats.map((s) => ratings.get(s.occupant)?.rating ?? opts.base);
    const after = rateTable(seats, before, opts.k);
    const counted = new Set<string>();
    seats.forEach((s, i) => {
      s.rating_before = before[i];
      s.rating_after = after[i];
      const prev = ratings.get(s.occupant);
      ratings.set(s.occupant, {
        occupant: s.occupant,
        handle: s.handle,
        faction: s.faction,
        is_human: s.is_human,
        rating: after[i],
        tables: (prev?.tables ?? 0) + (counted.has(s.occupant) ? 0 : 1),
        wins: (prev?.wins ?? 0) + (s.is_winner ? 1 : 0),
        last_table_id: result.table_id,
        last_resolved_at: result.resolved_at,
      });
      counted.add(s.occupant);
      touched.add(s.occupant);
    });
  }
  return touched;
}

// ── Store ───────────────────────────────────────────────────────────────────

export interface ArchiveSource {
  /** SpacetimeDB database identity, "0x…" (stable across module publishes). */
  sourceDb: string;
  dbName: string;
  uri: string;
}

export interface Cursor {
  position: number;
  /** war_epoch: settled_at (µs) of the epoch at `position`. */
  marker?: number | null;
}

export interface ArchiveStore {
  init(): Promise<void>;
  cursor(sourceDb: string, stream: StreamName): Promise<Cursor | null>;
  /** Archives `rows` (duplicates ignored) and sets the stream's cursor, in one
   *  transaction. Returns how many rows were new. */
  commit(source: ArchiveSource, stream: StreamName, rows: Row[], cursor: Cursor): Promise<number>;
}

export const WIN_RATE_GROUPS: Record<string, string[]> = {
  faction: ["s.faction"],
  zone: ["s.faction", "r.zone_id"],
  trump: ["s.faction", "r.trump_suit"],
  seats: ["s.faction", "r.seat_count"],
  seat: ["r.seat_count", "s.seat_index"],
  all: ["s.faction", "r.zone_id", "r.trump_suit", "r.seat_count"],
};

export interface ArchiveReader {
  status(sourceDb: string): Promise<Row>;
  winRates(opts: { sourceDb: string; by: string; days: number; nowMs?: number }): Promise<Row[]>;
  ratings(opts: { sourceDb: string; limit: number; humans: boolean | null }): Promise<Row[]>;
}

/** The two things the store needs from a Postgres client. */
export interface PgExec {
  query(text: string, params?: unknown[]): Promise<Row[]>;
  transaction<T>(fn: (tx: PgExec) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** Bun's built-in Postgres client. Unnamed statements (prepare: false) also
 *  work behind PgBouncer-style poolers. */
export function bunPg(url: string, max = 4): PgExec {
  const sql = new SQL({ url, max, idleTimeout: 60, prepare: false });
  const wrap = (s: any, top: boolean): PgExec => ({
    query: async (text, params = []) => [...(await s.unsafe(text, params))],
    transaction: (fn) => (top ? sql.begin((tx: any) => fn(wrap(tx, false))) : fn(wrap(s, false))),
    close: async () => {
      if (top) await sql.close();
    },
  });
  return wrap(sql, true);
}

const lockSource = (tx: PgExec, sourceDb: string) =>
  // Two feeder containers overlap during a Railway redeploy. One writer per
  // source at a time keeps the read-modify-write of war_rating consistent.
  tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`war_archive:${sourceDb}`]);

const insertRecords = (
  tx: PgExec,
  table: string,
  cols: Col[],
  key: string,
  sourceDb: string,
  recs: object[],
  returning = key,
) =>
  tx.query(
    `INSERT INTO ${table} (source_db, ${colNames(cols)})
     SELECT $1, ${colNames(cols)} FROM jsonb_to_recordset($2::text::jsonb) AS x(${recordset(cols)})
     ON CONFLICT (source_db, ${key}) DO NOTHING
     RETURNING ${returning}`,
    [sourceDb, JSON.stringify(recs)],
  );

const RATING_UPSERT = `INSERT INTO war_rating (source_db, ${colNames(RATING_COLS)})
  SELECT $1, ${colNames(RATING_COLS)} FROM jsonb_to_recordset($2::text::jsonb) AS x(${recordset(RATING_COLS)})
  ON CONFLICT (source_db, occupant) DO UPDATE SET
    handle = EXCLUDED.handle, faction = EXCLUDED.faction, is_human = EXCLUDED.is_human,
    rating = EXCLUDED.rating, tables = EXCLUDED.tables, wins = EXCLUDED.wins,
    last_table_id = EXCLUDED.last_table_id, last_resolved_at = EXCLUDED.last_resolved_at`;

export class PostgresArchiveStore implements ArchiveStore, ArchiveReader {
  private k: number;
  private base: number;

  constructor(private pg: PgExec, opts: { eloK?: number; eloBase?: number } = {}) {
    this.k = opts.eloK ?? ARCHIVE_DEFAULTS.eloK;
    this.base = opts.eloBase ?? ARCHIVE_DEFAULTS.eloBase;
  }

  async init(): Promise<void> {
    await this.pg.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('war_archive:ddl'))");
      for (const stmt of ARCHIVE_DDL) await tx.query(stmt);
      for (const [name, select] of Object.entries(ARCHIVE_VIEWS)) {
        await tx.query(`DROP VIEW IF EXISTS ${name}`);
        await tx.query(`CREATE VIEW ${name} AS ${select}`);
      }
    });
  }

  async cursor(sourceDb: string, stream: StreamName): Promise<Cursor | null> {
    const rows = await this.pg.query(
      "SELECT position, marker FROM war_archive_cursor WHERE source_db = $1 AND stream = $2",
      [sourceDb, stream],
    );
    if (!rows.length) return null;
    return { position: Number(rows[0].position), marker: optNum(rows[0].marker) };
  }

  async commit(source: ArchiveSource, stream: StreamName, rows: Row[], cursor: Cursor): Promise<number> {
    return this.pg.transaction(async (tx) => {
      await lockSource(tx, source.sourceDb);
      await tx.query(
        `INSERT INTO war_archive_source (source_db, db_name, uri) VALUES ($1, $2, $3)
         ON CONFLICT (source_db) DO UPDATE SET db_name = EXCLUDED.db_name, uri = EXCLUDED.uri, last_seen = now()`,
        [source.sourceDb, source.dbName, source.uri],
      );
      let fresh = 0;
      if (rows.length) {
        if (stream === "melee_result") fresh = await this.insertResults(tx, source.sourceDb, rows);
        else if (stream === "war_epoch")
          fresh = (await insertRecords(tx, "war_epoch_history", EPOCH_COLS, "epoch_id, settled_at", source.sourceDb, rows.map(epochRecord))).length;
        else
          fresh = (await insertRecords(tx, "war_agent_turn", TURN_COLS, "turn_id, requested_at", source.sourceDb, rows.map(turnRecord))).length;
      }
      // A plain set, not GREATEST: a cursor that moves back only causes a
      // re-read the keys absorb, and war_epoch has to rewind after a reset.
      await tx.query(
        `INSERT INTO war_archive_cursor (source_db, stream, position, marker) VALUES ($1, $2, $3::bigint, $4::bigint)
         ON CONFLICT (source_db, stream) DO UPDATE SET position = EXCLUDED.position, marker = EXCLUDED.marker, updated_at = now()`,
        [source.sourceDb, stream, String(Math.floor(cursor.position)), cursor.marker == null ? null : String(Math.floor(cursor.marker))],
      );
      return fresh;
    });
  }

  private async insertResults(tx: PgExec, sourceDb: string, rows: Row[]): Promise<number> {
    const tables = rows
      .map((row) => ({ result: resultRecord(row), seats: seatRecords(row) }))
      .sort((a, b) => a.result.resolved_us - b.result.resolved_us || a.result.table_id - b.result.table_id);
    const inserted = await insertRecords(
      tx, "war_melee_result", RESULT_COLS, "table_id, opened_us", sourceDb, tables.map((t) => t.result),
    );
    const fresh = new Set(inserted.map((r) => `${r.table_id}@${r.opened_us}`));
    const freshTables = tables.filter((t) => fresh.has(`${t.result.table_id}@${t.result.opened_us}`));
    if (!freshTables.length) return 0;

    // Rate only tables that are new to the archive, so a re-read never rates twice.
    const occupants = [...new Set(freshTables.filter((t) => !t.result.is_void).flatMap((t) => t.seats.map((s) => s.occupant)))];
    const ratings = new Map<string, RatingRow>();
    if (occupants.length) {
      const current = await tx.query(
        `SELECT occupant, rating, tables, wins FROM war_rating
         WHERE source_db = $1 AND occupant IN (SELECT jsonb_array_elements_text($2::text::jsonb))`,
        [sourceDb, JSON.stringify(occupants)],
      );
      for (const r of current) {
        ratings.set(r.occupant, { ...(r as RatingRow), rating: Number(r.rating), tables: Number(r.tables), wins: Number(r.wins) });
      }
    }
    const touched = applyRatings(freshTables, ratings, { k: this.k, base: this.base });
    const seats = freshTables.flatMap((t) => t.seats);
    if (seats.length) await insertRecords(tx, "war_melee_seat", SEAT_COLS, "table_id, opened_us, seat_index", sourceDb, seats);
    if (touched.size) await tx.query(RATING_UPSERT, [sourceDb, JSON.stringify([...touched].map((o) => ratings.get(o)))]);
    return freshTables.length;
  }

  /** Replays every archived table of `sourceDb` in settle order with the
   *  current K, rewriting war_rating and each seat's rating columns. */
  async rebuildRatings(sourceDb: string): Promise<{ tables: number; occupants: number }> {
    return this.pg.transaction(async (tx) => {
      await lockSource(tx, sourceDb);
      await tx.query("DELETE FROM war_rating WHERE source_db = $1", [sourceDb]);
      await tx.query("UPDATE war_melee_seat SET rating_before = NULL, rating_after = NULL WHERE source_db = $1", [sourceDb]);
      const ratings = new Map<string, RatingRow>();
      let rated = 0;
      let after = { resolved: "0", table: "0", opened: "0" };
      for (;;) {
        const page = await tx.query(
          `SELECT table_id, opened_us, resolved_us, resolved_at FROM war_melee_result
           WHERE source_db = $1 AND NOT is_void AND (resolved_us, table_id, opened_us) > ($2::bigint, $3::bigint, $4::bigint)
           ORDER BY resolved_us, table_id, opened_us LIMIT 1000`,
          [sourceDb, after.resolved, after.table, after.opened],
        );
        if (!page.length) break;
        const keys = page.map((r) => ({ table_id: String(r.table_id), opened_us: String(r.opened_us) }));
        const seatRows = await tx.query(
          `SELECT s.table_id, s.opened_us, s.seat_index, s.occupant, s.handle, s.faction, s.is_human, s.score, s.is_winner
           FROM war_melee_seat s
           JOIN jsonb_to_recordset($2::text::jsonb) AS k(table_id bigint, opened_us bigint)
             ON s.table_id = k.table_id AND s.opened_us = k.opened_us
           WHERE s.source_db = $1 ORDER BY s.table_id, s.opened_us, s.seat_index`,
          [sourceDb, JSON.stringify(keys)],
        );
        const byKey = new Map<string, SeatRecord[]>();
        for (const s of seatRows) {
          const key = `${s.table_id}@${s.opened_us}`;
          const list = byKey.get(key) ?? [];
          list.push({
            table_id: Number(s.table_id), opened_us: Number(s.opened_us), seat_index: Number(s.seat_index),
            occupant: s.occupant, handle: s.handle, faction: s.faction, is_human: Boolean(s.is_human),
            score: Number(s.score), is_winner: Boolean(s.is_winner), rating_before: null, rating_after: null,
          });
          byKey.set(key, list);
        }
        const tables = page.map((r) => ({
          result: { table_id: Number(r.table_id), is_void: false, resolved_at: microsToIso(Number(r.resolved_us)) },
          seats: byKey.get(`${r.table_id}@${r.opened_us}`) ?? [],
        }));
        applyRatings(tables, ratings, { k: this.k, base: this.base });
        const updates = tables.flatMap((t) => t.seats).filter((s) => s.rating_after !== null);
        if (updates.length) {
          await tx.query(
            `UPDATE war_melee_seat s SET rating_before = x.rating_before, rating_after = x.rating_after
             FROM jsonb_to_recordset($2::text::jsonb) AS x(table_id bigint, opened_us bigint, seat_index smallint, rating_before float8, rating_after float8)
             WHERE s.source_db = $1 AND s.table_id = x.table_id AND s.opened_us = x.opened_us AND s.seat_index = x.seat_index`,
            [sourceDb, JSON.stringify(updates.map((s) => ({
              table_id: s.table_id, opened_us: s.opened_us, seat_index: s.seat_index,
              rating_before: s.rating_before, rating_after: s.rating_after,
            })))],
          );
        }
        rated += tables.filter((t) => t.seats.length >= 2).length;
        const last = page[page.length - 1];
        after = { resolved: String(last.resolved_us), table: String(last.table_id), opened: String(last.opened_us) };
      }
      if (ratings.size) await tx.query(RATING_UPSERT, [sourceDb, JSON.stringify([...ratings.values()])]);
      return { tables: rated, occupants: ratings.size };
    });
  }

  async status(sourceDb: string): Promise<Row> {
    const [cursors, results, epochs, turns, rated] = await Promise.all([
      this.pg.query("SELECT stream, position, marker, updated_at FROM war_archive_cursor WHERE source_db = $1 ORDER BY stream", [sourceDb]),
      this.pg.query(
        `SELECT count(*)::bigint AS n, min(resolved_at) AS oldest, max(resolved_at) AS newest
         FROM war_melee_result WHERE source_db = $1`, [sourceDb]),
      this.pg.query("SELECT count(*)::bigint AS n FROM war_epoch_history WHERE source_db = $1", [sourceDb]),
      this.pg.query("SELECT count(*)::bigint AS n FROM war_agent_turn WHERE source_db = $1", [sourceDb]),
      this.pg.query("SELECT count(*)::bigint AS n FROM war_rating WHERE source_db = $1", [sourceDb]),
    ]);
    return {
      cursors: cursors.map((c) => ({
        stream: c.stream,
        position: Number(c.position),
        at: c.stream === "war_epoch" ? null : microsToIso(Number(c.position)),
        updated_at: c.updated_at,
      })),
      results: Number(results[0]?.n ?? 0),
      oldest_result: results[0]?.oldest ?? null,
      newest_result: results[0]?.newest ?? null,
      epochs: Number(epochs[0]?.n ?? 0),
      agent_turns: Number(turns[0]?.n ?? 0),
      rated_occupants: Number(rated[0]?.n ?? 0),
    };
  }

  async winRates(opts: { sourceDb: string; by: string; days: number; nowMs?: number }): Promise<Row[]> {
    const groups = WIN_RATE_GROUPS[opts.by];
    if (!groups) throw new Error(`unknown grouping "${opts.by}"`);
    const sinceUs = Math.floor(((opts.nowMs ?? Date.now()) - opts.days * 86_400_000) * 1000);
    const g = groups.join(", ");
    return this.pg.query(
      `SELECT ${g},
              count(*)::int AS seats_played,
              count(*) FILTER (WHERE s.is_winner)::int AS wins,
              round(avg(CASE WHEN s.is_winner THEN 1.0 ELSE 0.0 END), 4)::float8 AS win_rate,
              round(avg(1.0 / NULLIF(r.seat_count, 0)), 4)::float8 AS par_rate,
              round(avg(s.score), 2)::float8 AS avg_score
       FROM war_melee_seat s
       JOIN war_melee_result r ON r.source_db = s.source_db AND r.table_id = s.table_id AND r.opened_us = s.opened_us
       WHERE r.source_db = $1 AND NOT r.is_void AND r.resolved_us >= $2::bigint
       GROUP BY ${g} ORDER BY ${g}`,
      [opts.sourceDb, String(sinceUs)],
    );
  }

  async ratings(opts: { sourceDb: string; limit: number; humans: boolean | null }): Promise<Row[]> {
    const rows = await this.pg.query(
      `SELECT occupant, handle, faction, is_human, round(rating::numeric, 1)::float8 AS rating,
              tables, wins, round(wins::numeric / NULLIF(tables, 0), 4)::float8 AS win_rate, last_resolved_at
       FROM war_rating
       WHERE source_db = $1 AND ($3::boolean IS NULL OR is_human = $3::boolean)
       ORDER BY rating DESC, occupant LIMIT $2::int`,
      [opts.sourceDb, opts.limit, opts.humans],
    );
    return rows.map((r) => ({ ...r, tables: Number(r.tables), wins: Number(r.wins) }));
  }
}

// ── Source identity ─────────────────────────────────────────────────────────

/** Name → database identity, from GET /v1/database/:name. */
export async function fetchSourceIdentity(uri: string, db: string, token?: string): Promise<ArchiveSource> {
  const res = await fetch(`${uri}/v1/database/${encodeURIComponent(db)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`database info ${res.status}`);
  const info = (await res.json()) as any;
  const raw = info?.database_identity?.__identity__ ?? info?.database_identity;
  if (typeof raw !== "string" || !/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) throw new Error("database info has no identity");
  const hex = raw.toLowerCase().replace(/^0x/, "");
  return { sourceDb: `0x${hex}`, dbName: db, uri };
}

/** Caches a resolved source for `ttlMs`. A failed refresh keeps the last
 *  good value; it never invents one. */
export function cachedSource(
  resolve: () => Promise<ArchiveSource>,
  ttlMs = ARCHIVE_DEFAULTS.sourceTtlMs,
  now: () => number = Date.now,
): () => Promise<ArchiveSource> {
  let cached: ArchiveSource | null = null;
  let at = 0;
  return async () => {
    if (cached && now() - at < ttlMs) return cached;
    try {
      cached = await resolve();
      at = now();
    } catch (err) {
      if (!cached) throw err;
    }
    return cached;
  };
}

// ── Archiver ────────────────────────────────────────────────────────────────

export interface ArchiverOptions {
  query: Query;
  store: ArchiveStore;
  source: () => Promise<ArchiveSource>;
  now?: () => number; // ms
  log?: Pick<Console, "log" | "warn">;
  archiveTurns?: boolean;
  windowUs?: number;
  settleUs?: number;
  turnSettleUs?: number;
  lagUs?: number;
  resultBackfillUs?: number;
  turnBackfillUs?: number;
  maxWindowsPerPoll?: number;
}

export interface PollReport {
  results: number;
  epochs: number;
  turns: number;
  queries: number;
  caughtUp: boolean;
  errors: string[];
}

interface WindowStream {
  table: string;
  column: string;
  backfillUs: number;
  settleUs: number;
  head: boolean; // also read the open window at the head
  count: "results" | "turns";
}

export class WarArchiver {
  private query: Query;
  private store: ArchiveStore;
  private source: () => Promise<ArchiveSource>;
  private now: () => number;
  private log: Pick<Console, "log" | "warn">;
  private archiveTurns: boolean;
  private windowUs: number;
  private lagUs: number;
  private maxWindows: number;
  private streams: Record<"melee_result" | "agent_melee_turn", WindowStream>;
  private initialized = false;
  private inflight: Promise<PollReport> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private warnedGap = false;
  private lastLogged = { text: "", at: 0 };
  // Head rows already committed (key → resolved µs), so an idle head does not
  // re-commit the same lag-zone rows on every poll.
  private headSeen = new Map<string, number>();

  readonly stats = {
    sourceDb: null as string | null,
    polls: 0,
    lastPollAt: 0,
    lastSuccessAt: 0,
    lastError: null as string | null,
    caughtUp: false,
    archived: { results: 0, epochs: 0, turns: 0 },
  };

  constructor(opts: ArchiverOptions) {
    const d = ARCHIVE_DEFAULTS;
    this.query = opts.query;
    this.store = opts.store;
    this.source = opts.source;
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? console;
    this.archiveTurns = opts.archiveTurns ?? true;
    this.windowUs = opts.windowUs ?? d.windowUs;
    this.lagUs = opts.lagUs ?? d.lagUs;
    this.maxWindows = opts.maxWindowsPerPoll ?? d.maxWindowsPerPoll;
    this.streams = {
      melee_result: {
        table: "melee_result", column: "resolved_at", head: true, count: "results",
        backfillUs: opts.resultBackfillUs ?? d.resultBackfillUs, settleUs: opts.settleUs ?? d.settleUs,
      },
      agent_melee_turn: {
        table: "agent_melee_turn", column: "requested_at", head: false, count: "turns",
        backfillUs: opts.turnBackfillUs ?? d.turnBackfillUs, settleUs: opts.turnSettleUs ?? d.turnSettleUs,
      },
    };
  }

  /** One pass over every stream. Never throws: failures are in `errors`, and
   *  a failing stream does not hold the others back. Concurrent calls share
   *  one pass. */
  pollOnce(): Promise<PollReport> {
    if (!this.inflight) this.inflight = this.poll().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** Polls every `intervalMs`, or right away while it is still catching up. */
  start(intervalMs = ARCHIVE_DEFAULTS.pollMs): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      const report = await this.pollOnce();
      if (this.running) this.timer = setTimeout(tick, report.caughtUp || report.errors.length ? intervalMs : 250);
    };
    this.timer = setTimeout(tick, 0);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private async poll(): Promise<PollReport> {
    const report: PollReport = { results: 0, epochs: 0, turns: 0, queries: 0, caughtUp: true, errors: [] };
    this.stats.polls++;
    this.stats.lastPollAt = this.now();
    let source: ArchiveSource;
    try {
      if (!this.initialized) {
        await this.store.init();
        this.initialized = true;
      }
      source = await this.source();
      if (this.stats.sourceDb && this.stats.sourceDb !== source.sourceDb) {
        this.log.warn(`[war-archive] ${source.dbName} is now database ${source.sourceDb} (was ${this.stats.sourceDb}); archiving it as a new source.`);
        this.headSeen.clear();
      }
      this.stats.sourceDb = source.sourceDb;
    } catch (err) {
      report.caughtUp = false;
      report.errors.push(`setup: ${errText(err)}`);
      return this.finish(report);
    }
    const steps: Array<[string, () => Promise<void>]> = [
      ["melee_result", () => this.pollWindows(source, "melee_result", report)],
      ["war_epoch", () => this.pollEpochs(source, report)],
    ];
    if (this.archiveTurns) steps.push(["agent_melee_turn", () => this.pollWindows(source, "agent_melee_turn", report)]);
    for (const [name, step] of steps) {
      try {
        await step();
      } catch (err) {
        report.caughtUp = false;
        report.errors.push(`${name}: ${errText(err)}`);
      }
    }
    return this.finish(report);
  }

  private finish(report: PollReport): PollReport {
    const a = this.stats.archived;
    a.results += report.results;
    a.epochs += report.epochs;
    a.turns += report.turns;
    this.stats.caughtUp = report.caughtUp;
    if (report.results || report.epochs || report.turns) {
      this.log.log(
        `[war-archive] archived ${report.results} result(s), ${report.epochs} epoch(s), ${report.turns} turn(s)` +
          (report.caughtUp ? "" : " — catching up"),
      );
    }
    if (report.errors.length) {
      this.stats.lastError = report.errors.join("; ");
      // A down database fails every poll; say so when it changes, or every 5 min.
      const now = this.now();
      if (this.stats.lastError !== this.lastLogged.text || now - this.lastLogged.at > 300_000) {
        this.log.warn(`[war-archive] ${this.stats.lastError}`);
        this.lastLogged = { text: this.stats.lastError, at: now };
      }
    } else {
      if (this.stats.lastError) this.log.log("[war-archive] recovered.");
      this.stats.lastError = null;
      this.lastLogged = { text: "", at: 0 };
      this.stats.lastSuccessAt = this.now();
    }
    return report;
  }

  private async pollWindows(source: ArchiveSource, stream: "melee_result" | "agent_melee_turn", report: PollReport): Promise<void> {
    const spec = this.streams[stream];
    const nowUs = this.now() * 1000;
    const stored = await this.store.cursor(source.sourceDb, stream);
    let cursor = stored ? stored.position : Math.floor(nowUs - spec.backfillUs);
    if (stored && stream === "melee_result" && stored.position < nowUs - RESULT_RETENTION_US && !this.warnedGap) {
      this.warnedGap = true;
      this.log.warn(
        `[war-archive] the melee_result cursor is ${((nowUs - stored.position) / DAY_US).toFixed(1)} days old. ` +
          `Results settled before ${microsToIso(nowUs - RESULT_RETENTION_US)} were pruned on chain and are missing from the archive.`,
      );
    }
    const where = (from: number, to?: number) =>
      `SELECT * FROM ${spec.table} WHERE ${spec.column} >= '${microsToIso(from)}'` +
      (to === undefined ? "" : ` AND ${spec.column} < '${microsToIso(to)}'`);

    for (let i = 0; i < this.maxWindows; i++) {
      const end = cursor + this.windowUs;
      if (end <= nowUs - spec.settleUs) {
        // A closed window: everything in it has committed, so it is final.
        const rows = await this.query(where(cursor, end));
        report.queries++;
        report[spec.count] += await this.store.commit(source, stream, rows, { position: end });
        cursor = end;
        continue;
      }
      if (spec.head) await this.pollHead(source, stream, cursor, where(cursor), report);
      return;
    }
    report.caughtUp = false;
  }

  private async pollHead(source: ArchiveSource, stream: "melee_result", cursor: number, sql: string, report: PollReport): Promise<void> {
    const rows = await this.query(sql);
    report.queries++;
    let next = cursor;
    for (const r of rows) {
      const at = num(r.resolved_at);
      if (Number.isFinite(at)) next = Math.max(next, Math.floor(at - this.lagUs));
    }
    const key = (r: Row) => `${num(r.table_id)}@${num(r.opened_at)}`;
    const unseen = rows.filter((r) => !this.headSeen.has(key(r)));
    if (!unseen.length && next === cursor) return;
    report.results += await this.store.commit(source, stream, unseen, { position: next });
    for (const r of unseen) this.headSeen.set(key(r), num(r.resolved_at));
    for (const [k, at] of this.headSeen) if (!(at >= next)) this.headSeen.delete(k);
  }

  private async pollEpochs(source: ArchiveSource, report: PollReport): Promise<void> {
    const stored = await this.store.cursor(source.sourceDb, "war_epoch");
    let from = stored?.position ?? 0;
    if (stored && stored.position > 0) {
      // war_epoch is never pruned, so the cursor row is always on chain with
      // the settled_at we saved. If not, the database was reset and its ids
      // restarted: read it from the start (keys include settled_at).
      const here = await this.query(`SELECT epoch_id, settled_at FROM war_epoch WHERE epoch_id = ${stored.position}`);
      report.queries++;
      const same = here.length > 0 && (stored.marker == null || num(here[0].settled_at) === stored.marker);
      if (!same) {
        this.log.warn(`[war-archive] war_epoch ${stored.position} is gone or different on chain; the database was reset. Re-reading epochs from the start.`);
        from = 0;
      }
    }
    // epoch_id is a u64: 0 means "from the start" (a negative literal is a SQL error).
    const rows = await this.query(`SELECT * FROM war_epoch WHERE epoch_id > ${from}`);
    report.queries++;
    if (!rows.length && from === (stored?.position ?? 0)) return;
    let last: Row | null = null;
    for (const r of rows) if (!last || num(r.epoch_id) > num(last.epoch_id)) last = r;
    const next: Cursor = last
      ? { position: num(last.epoch_id), marker: num(last.settled_at) }
      : { position: from, marker: null };
    report.epochs += await this.store.commit(source, "war_epoch", rows, next);
  }
}

// ── HTTP read API (served by indoor-spatial-service.ts) ─────────────────────

export interface ArchiveHandle {
  archiver: WarArchiver;
  store: ArchiveReader;
}

const intParam = (v: string | null, dflt: number, min: number, max: number) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
};

/** GET /api/v1/war/archive/{status | win-rates | ratings}. */
export async function archiveApi(archive: ArchiveHandle | null, url: URL): Promise<{ status: number; body: Row }> {
  if (!archive) {
    return { status: 503, body: { success: false, error: "The War Table archive is off (WAR_ARCHIVE_DATABASE_URL is not set)." } };
  }
  const route = url.pathname.replace(/^\/api\/v1\/war\/archive\/?/, "");
  const sourceDb = archive.archiver.stats.sourceDb;
  if (route === "status") {
    return {
      status: 200,
      body: { success: true, ...archive.archiver.stats, archive: sourceDb ? await archive.store.status(sourceDb) : null },
    };
  }
  if (route !== "win-rates" && route !== "ratings") return { status: 404, body: { success: false, error: "Not Found" } };
  if (!sourceDb) return { status: 503, body: { success: false, error: "The archive has not connected yet." } };
  if (route === "win-rates") {
    const by = url.searchParams.get("by") ?? "faction";
    if (!WIN_RATE_GROUPS[by]) {
      return { status: 400, body: { success: false, error: `by must be one of: ${Object.keys(WIN_RATE_GROUPS).join(", ")}` } };
    }
    const days = intParam(url.searchParams.get("days"), 30, 1, 3650);
    return { status: 200, body: { success: true, by, days, rows: await archive.store.winRates({ sourceDb, by, days }) } };
  }
  const limit = intParam(url.searchParams.get("limit"), 50, 1, 500);
  const h = url.searchParams.get("humans");
  const humans = h === "1" || h === "true" ? true : h === "0" || h === "false" ? false : null;
  return { status: 200, body: { success: true, rows: await archive.store.ratings({ sourceDb, limit, humans }) } };
}

// ── Maintenance CLI ─────────────────────────────────────────────────────────
//
//   WAR_ARCHIVE_DATABASE_URL=… bun run feeder/war-archive.ts rebuild-ratings [source_db]
//
// Replays the ratings of one source (default: every source) with the current
// WAR_ARCHIVE_ELO_K. Safe while the feeder runs: it takes the same per-source
// lock as the archiver.
if (import.meta.main) {
  const [cmd, only] = process.argv.slice(2);
  const url = process.env.WAR_ARCHIVE_DATABASE_URL;
  if (cmd !== "rebuild-ratings" || !url) {
    console.error("usage: WAR_ARCHIVE_DATABASE_URL=… bun run feeder/war-archive.ts rebuild-ratings [source_db]");
    process.exit(2);
  }
  const pg = bunPg(url, 1);
  const store = new PostgresArchiveStore(pg, { eloK: Number(process.env.WAR_ARCHIVE_ELO_K) || undefined });
  await store.init();
  const sources = only ? [only] : (await pg.query("SELECT source_db FROM war_archive_source ORDER BY source_db")).map((r) => r.source_db);
  for (const s of sources) {
    const r = await store.rebuildRatings(s);
    console.log(`${s}: rated ${r.tables} table(s), ${r.occupants} occupant(s)`);
  }
  await pg.close();
}
