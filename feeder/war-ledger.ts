// Pentacles — War Ledger read model.
//
// The decan ledger the client polls (/api/v1/war/decan-ledger) used to be a JSON
// file this feeder wrote when a War Table OPENED, crediting a made-up winner (the
// highest claim, score = claim × 2.2) before a single card was played. It lived
// on container disk, so every Railway redeploy wiped it.
//
// Now every number comes from the module, which writes it in the same
// transaction that settles the table:
//   melee_result          one row per settled table (7 days)
//   faction_war_standing  per-faction decan points + crowns
//   war_epoch             concluded decans (and hourly seasons)
//   ephemeris             the Sun, for the live decan
// This file only reads those rows and shapes them into the payload the client
// already understands. It holds no state worth persisting: a restart re-reads.

export const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
export const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
export const SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
export const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];

// Minor Tarot Card Decan Association (Golden Dawn 10-day Egyptian Decades)
// Suit by triplicity (sign % 4): Fire = Wands, Earth = Pentacles, Air = Swords, Water = Cups
export const DECAN_SUITS = ["Wands", "Pentacles", "Swords", "Cups"];
// Chaldean sub-rulers: Mars (4), Sun (0), Venus (3), Mercury (2), Moon (1), Saturn (6), Jupiter (5)
export const DECAN_CHALDEAN_RULERS = [4, 0, 3, 2, 1, 6, 5];

export interface DecanInfo {
  absDecan: number;
  signIndex: number;
  signName: string;
  signGlyph: string;
  decanIndex: number;
  rank: number;
  suit: string;
  card: string;
  startDeg: number;
  endDeg: number;
  degInSign: number;
  degInDecan: number;
  progressPct: number;
  rulerFaction: number;
  rulerName: string;
  rulerGlyph: string;
  label: string;
}

export interface EsmsYieldSummary {
  total: number;
  spirit: number;
  essence: number;
  matter: number;
  substance: number;
}

export function getDecanInfo(seasonDegree: number): DecanInfo {
  const totalDeg = ((Number(seasonDegree) % 360) + 360) % 360;
  const signIndex = Math.floor(totalDeg / 30) % 12;
  const degInSign = totalDeg % 30;
  const decanIndex = Math.min(2, Math.floor(degInSign / 10));
  const absDecan = signIndex * 3 + decanIndex;

  const suit = DECAN_SUITS[signIndex % 4];
  const isCardinal = [0, 3, 6, 9].includes(signIndex);
  const isFixed = [1, 4, 7, 10].includes(signIndex);
  const baseRank = isCardinal ? 2 : (isFixed ? 5 : 8);
  const rank = baseRank + decanIndex;
  const card = `${rank} of ${suit}`;
  const rulerFaction = DECAN_CHALDEAN_RULERS[absDecan % 7];

  const startDeg = decanIndex * 10;
  const endDeg = (decanIndex + 1) * 10;
  const degInDecan = degInSign - startDeg;
  const progressPct = Math.min(100, Math.max(0, (degInDecan / 10) * 100));

  return {
    absDecan,
    signIndex,
    signName: SIGN_NAMES[signIndex],
    signGlyph: SIGN_GLYPHS[signIndex],
    decanIndex,
    rank,
    suit,
    card,
    startDeg,
    endDeg,
    degInSign: Number(degInSign.toFixed(1)),
    degInDecan: Number(degInDecan.toFixed(1)),
    progressPct: Number(progressPct.toFixed(1)),
    rulerFaction,
    rulerName: PLANET_NAMES[rulerFaction],
    rulerGlyph: PLANET_GLYPHS[rulerFaction],
    label: `${card} (${startDeg}°–${endDeg}° ${SIGN_NAMES[signIndex]})`
  };
}

export interface RoundRecord {
  roundId: number;
  timestamp: number;
  zoneId: number;
  zoneName: string;
  decanId: number;
  card: string;
  rank: number;
  suit: string;
  sunDegree: number;
  degInDecan: number;
  winnerFaction: number;
  winnerName: string;
  winnerAgent: string;
  winningScore: number;
  controlDelta: number;
  capturedZone: boolean;
  /** ESMS the module actually credited the winner (0 when none). */
  winnerEsms?: number;
  /** The settled melee_table this record summarises. */
  tableId?: number;
}

export interface DecanHistoryItem {
  decanId: number;
  card: string;
  rank: number;
  suit: string;
  signName: string;
  range: [number, number];
  rulerFaction: number;
  rulerName: string;
  winnerFaction: number;
  winnerName: string;
  winnerScore: number;
  completedAt: number;
  esmsReward?: {
    sovereignTreasury: number;
    distribution: EsmsYieldSummary;
  };
}


/** Mean obliquity — matches server chart.rs OBLIQUITY_DEG and SkyMath.Obliquity. */
export const OBLIQUITY_DEG = 23.439291;

/** Points a won table adds to its faction when it also captured the zone. Mirrors
 *  DECAN_CAPTURE_BONUS in server/src/reducers.rs. */
export const DECAN_CAPTURE_BONUS = 50;

/**
 * True ecliptic longitude (degrees, 0..360) from equatorial RA/Dec in degrees.
 * The ephemeris table stores RA/Dec only; the feeder pushes them from an ecliptic
 * longitude at latitude 0, so this inverse is exact. Same formula as the server's
 * chart::equatorial_to_ecliptic_min. Never use RA itself as a longitude: it strays
 * up to ~2.5°, which put the old ledger in the wrong decan ~15% of the year.
 */
export function eclipticLonFromEquatorial(raDeg: number, decDeg: number): number {
  const eps = (OBLIQUITY_DEG * Math.PI) / 180;
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const lon = (Math.atan2(Math.sin(ra) * Math.cos(eps) + Math.tan(dec) * Math.sin(eps), Math.cos(ra)) * 180) / Math.PI;
  return ((lon % 360) + 360) % 360;
}

export function zoneName(zoneId: number): string {
  if (zoneId === 10) return "Crown Zenith";
  return zoneId >= 5 ? `Spire ${zoneId}` : `House ${zoneId}`;
}

/** A Planet enum as decoded by stdb-feed (PascalCase name), a number, or null. */
export function factionIndex(v: unknown): number {
  if (v === null || v === undefined || v === "") return -1;
  if (typeof v === "number") return v >= 0 && v < 10 ? v : -1;
  if (typeof v === "object") {
    const key = Object.keys(v as object)[0];
    return key ? factionIndex(key) : -1;
  }
  return PLANET_NAMES.findIndex((n) => n.toLowerCase() === String(v).toLowerCase());
}

const num = (v: unknown): number => {
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** stdb-feed decodes Timestamp to micros since the epoch. */
const microsToMs = (v: unknown): number => Math.floor(num(v) / 1000);

/** One `melee_result` row → the RoundRecord shape the client keeps in roundResults. */
export function roundRecordFromResult(row: any): RoundRecord {
  const decanId = row.decan_id === null || row.decan_id === undefined ? -1 : num(row.decan_id);
  const decan = decanId >= 0 ? getDecanInfo(decanId * 10) : null;
  const winnerFaction = factionIndex(row.winner_faction);
  const esms = num(row.winner_esms) / 10_000;
  return {
    roundId: num(row.round_index),
    timestamp: microsToMs(row.resolved_at),
    zoneId: num(row.zone_id),
    zoneName: zoneName(num(row.zone_id)),
    decanId,
    card: decan ? decan.card : "",
    rank: decan ? decan.rank : 0,
    suit: decan ? decan.suit : "",
    sunDegree: decan ? decan.absDecan * 10 : 0,
    degInDecan: 0,
    winnerFaction,
    winnerName: winnerFaction >= 0 ? PLANET_NAMES[winnerFaction] : "",
    winnerAgent: String(row.winner_handle || "") || "Agent Champion",
    winningScore: num(row.winning_score),
    // Top-level copy of the winner's share: no need to decode the nested seats.
    controlDelta: num(row.winner_control_delta),
    capturedZone: Boolean(row.captured),
    winnerEsms: esms,
    tableId: num(row.table_id),
  };
}

/** One Decan `war_epoch` row → the DecanHistoryItem shape. A decan nobody scored
 *  in is a "no contest" (winnerFaction -1), never a default crown for the Sun. */
export function decanHistoryFromEpoch(row: any): DecanHistoryItem {
  const decanId = num(row.decan_id);
  const info = getDecanInfo(decanId * 10);
  const winnerFaction = factionIndex(row.champion);
  return {
    decanId,
    card: info.card,
    rank: info.rank,
    suit: info.suit,
    signName: info.signName,
    range: [info.startDeg, info.endDeg],
    rulerFaction: info.rulerFaction,
    rulerName: info.rulerName,
    winnerFaction,
    winnerName: winnerFaction >= 0 ? PLANET_NAMES[winnerFaction] : "No contest",
    winnerScore: num(row.champion_score),
    completedAt: microsToMs(row.settled_at),
  };
}

export const isDecanEpoch = (row: any): boolean => {
  if (typeof row?.is_decan === "boolean") return row.is_decan;
  const k = row?.kind;
  if (typeof k === "string") return k.toLowerCase() === "decan";
  if (k && typeof k === "object") return Object.keys(k)[0]?.toLowerCase() === "decan";
  return false;
};

export interface DecanLedgerSummary {
  activeDecan: DecanInfo;
  factionRoundPoints: number[];
  decanVictories: number[];
  recentRounds: RoundRecord[];
  decanHistory: DecanHistoryItem[];
  lastUpdated: number;
}

/** A void table (nobody played) is a record, not a round anyone won. */
export const isPlayedResult = (row: any): boolean => !row?.is_void;

/**
 * Pure: chain rows in, the decan-ledger payload out (same keys the client's
 * syncDecanLedger reads). `sunLon` is the Sun's true ecliptic longitude.
 *
 * `currentDecan` is the module's war clock (war_state.current_decan): the decan
 * the standings' points belong to. Right after the Sun crosses a boundary the
 * clock lags it by up to one sky tick; in that window the points still belong
 * to the old decan, so they are reported as zero rather than handed to the new
 * one (the client applies factionRoundPoints only when activeDecan matches its
 * own Sun).
 */
export function buildDecanLedgerSummary(input: {
  sunLon: number;
  currentDecan?: number | null;
  standings: any[];
  results: any[];
  epochs: any[];
  lastUpdated: number;
}): DecanLedgerSummary {
  const activeDecan = getDecanInfo(input.sunLon);
  const pointsAreCurrent =
    input.currentDecan === undefined || input.currentDecan === null || num(input.currentDecan) === activeDecan.absDecan;
  const factionRoundPoints = new Array(10).fill(0);
  const decanVictories = new Array(10).fill(0);
  for (const s of input.standings || []) {
    const i = num(s.faction_idx);
    if (i < 0 || i > 9) continue;
    if (pointsAreCurrent) factionRoundPoints[i] = num(s.decan_points);
    decanVictories[i] = num(s.decan_crowns);
  }
  const recentRounds = [...(input.results || [])]
    .filter(isPlayedResult)
    .sort((a, b) => num(b.resolved_at) - num(a.resolved_at) || num(b.table_id) - num(a.table_id))
    .slice(0, 30)
    .map(roundRecordFromResult);
  const decanHistory = (input.epochs || [])
    .filter(isDecanEpoch)
    .sort((a, b) => num(b.settled_at) - num(a.settled_at))
    .slice(0, 36)
    .map(decanHistoryFromEpoch);
  return {
    activeDecan,
    factionRoundPoints,
    decanVictories,
    recentRounds,
    decanHistory,
    lastUpdated: input.lastUpdated,
  };
}

type Query = (sql: string) => Promise<any[]>;

/**
 * Cached chain reads behind the two war endpoints. Each refresh costs five small
 * SQL calls: standings (10 rows), new decan epochs (by id cursor), new results
 * (by resolved_at cursor — table ids are assigned at OPEN, so a human table can
 * settle after higher-numbered ones and an id cursor would skip it), the
 * ephemeris, and the war clock. Results are kept as a 100-row ring, so nothing
 * grows with history.
 */
export class WarLedgerReader {
  private query: Query;
  private ttlMs: number;
  private now: () => number;
  private refreshedAt = 0;
  private attemptedAt = 0;
  private inflight: Promise<void> | null = null;
  private results = new Map<number, any>();
  private epochs = new Map<number, any>();
  // epoch_id is an auto_inc u64 starting at 1, so 0 means "from the start".
  // (A negative literal against a u64 column is a SQL error.)
  private epochCursor = 0;
  private resultCursorMicros: number | null = null;
  private standings: any[] = [];
  private currentDecan: number | null = null;
  private sunLon = 0;
  private lastUpdated = 0;
  static RING = 100;
  static INITIAL_WINDOW_MS = 30 * 60 * 1000;

  constructor(opts: { query: Query; ttlMs?: number; now?: () => number }) {
    this.query = opts.query;
    this.ttlMs = opts.ttlMs ?? 20_000;
    this.now = opts.now ?? Date.now;
  }

  private async refresh(): Promise<void> {
    const sinceMs = this.resultCursorMicros === null
      ? this.now() - WarLedgerReader.INITIAL_WINDOW_MS
      : Math.floor(this.resultCursorMicros / 1000);
    // `>=` on a millisecond-floored cursor re-reads the boundary rows; the
    // table_id map dedupes them.
    const since = new Date(sinceMs).toISOString();
    // Each read stands alone: a table that is missing (module older than the
    // feeder) or failing degrades only its own part of the payload.
    const [standings, epochs, results, ephem, warState] = await Promise.allSettled([
      this.query("SELECT * FROM faction_war_standing"),
      // Decan epochs only (36 a year), by id cursor — never the hourly seasons.
      this.query(`SELECT * FROM war_epoch WHERE is_decan = true AND epoch_id > ${this.epochCursor}`),
      this.query(`SELECT * FROM melee_result WHERE resolved_at >= '${since}'`),
      this.query("SELECT body, ra, dec FROM ephemeris"),
      this.query("SELECT current_decan FROM war_state"),
    ]);
    const ok = (r: PromiseSettledResult<any[]>) => (r.status === "fulfilled" ? r.value || [] : null);
    const failed = [standings, epochs, results, ephem, warState].filter((r) => r.status === "rejected");
    if (failed.length === 5) throw (failed[0] as PromiseRejectedResult).reason;
    for (const f of failed) console.warn("[war-ledger] read failed:", (f as PromiseRejectedResult).reason?.message ?? f);

    const standingRows = ok(standings);
    if (standingRows) this.standings = standingRows;

    const stateRows = ok(warState);
    if (stateRows) {
      const cd = stateRows[0]?.current_decan;
      this.currentDecan = cd === null || cd === undefined ? null : num(cd);
    }

    for (const e of ok(epochs) || []) {
      this.epochCursor = Math.max(this.epochCursor, num(e.epoch_id));
      if (isDecanEpoch(e)) this.epochs.set(num(e.epoch_id), e);
    }
    if (this.epochs.size > 36) {
      const keep = [...this.epochs.keys()].sort((a, b) => b - a).slice(0, 36);
      this.epochs = new Map(keep.map((k) => [k, this.epochs.get(k)]));
    }

    const resultRows = ok(results);
    if (resultRows) {
      for (const r of resultRows) {
        this.results.set(num(r.table_id), r);
        const at = num(r.resolved_at);
        if (this.resultCursorMicros === null || at > this.resultCursorMicros) this.resultCursorMicros = at;
      }
      if (this.resultCursorMicros === null) this.resultCursorMicros = sinceMs * 1000;
    }
    if (this.results.size > WarLedgerReader.RING) {
      const keep = [...this.results.values()]
        .sort((a, b) => num(b.resolved_at) - num(a.resolved_at))
        .slice(0, WarLedgerReader.RING);
      this.results = new Map(keep.map((r) => [num(r.table_id), r]));
    }

    const sun = (ok(ephem) || []).find((e: any) => factionIndex(e.body) === 0);
    if (sun) this.sunLon = eclipticLonFromEquatorial(num(sun.ra), num(sun.dec));
    this.lastUpdated = this.now();
    this.refreshedAt = this.now();
  }

  private async ensureFresh(): Promise<void> {
    if (this.refreshedAt && this.now() - this.refreshedAt < this.ttlMs) return;
    // A failed attempt is rate-limited too, so a down database is not hit with
    // five queries on every poll from every viewer.
    if (!this.inflight && this.attemptedAt && this.now() - this.attemptedAt < this.ttlMs) {
      if (this.refreshedAt) return; // serve the last good snapshot
      throw new Error("war ledger unavailable (retrying shortly)");
    }
    if (!this.inflight) {
      this.attemptedAt = this.now();
      this.inflight = this.refresh().finally(() => { this.inflight = null; });
    }
    try {
      await this.inflight;
    } catch (err) {
      // Serve the last good snapshot; a transient SQL failure is not a blank ledger.
      if (!this.refreshedAt) throw err;
      console.warn("[war-ledger] refresh failed, serving cached ledger:", (err as Error).message);
    }
  }

  async summary(): Promise<DecanLedgerSummary> {
    await this.ensureFresh();
    return buildDecanLedgerSummary({
      sunLon: this.sunLon,
      currentDecan: this.currentDecan,
      standings: this.standings,
      results: [...this.results.values()],
      epochs: [...this.epochs.values()],
      lastUpdated: this.lastUpdated,
    });
  }

  async rounds(limit = WarLedgerReader.RING): Promise<RoundRecord[]> {
    await this.ensureFresh();
    return [...this.results.values()]
      .filter(isPlayedResult)
      .sort((a, b) => num(b.resolved_at) - num(a.resolved_at))
      .slice(0, Math.max(0, Math.min(limit, WarLedgerReader.RING)))
      .map(roundRecordFromResult);
  }
}
