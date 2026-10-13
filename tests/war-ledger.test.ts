import { describe, it, expect } from "bun:test";
import {
  getDecanInfo,
  buildDecanLedgerSummary,
  eclipticLonFromEquatorial,
  roundRecordFromResult,
  decanHistoryFromEpoch,
  WarLedgerReader,
} from "../feeder/war-ledger";

// Rows as feeder/stdb-feed.ts decodeSats hands them over: enums as PascalCase
// names, Option as value|null, Identity as 0x-hex, Timestamp as micros.
const MICROS = (ms: number) => ms * 1000;
const result = (over: Record<string, unknown> = {}) => ({
  table_id: 7,
  zone_id: 4,
  round_index: 101,
  opened_at: MICROS(1_700_000_000_000),
  resolved_at: MICROS(1_700_000_030_000),
  trump_suit: "Wands",
  decan_id: 0,
  seat_count: 2,
  tricks_played: 12,
  refereed: true,
  winner_seat_id: 11,
  winner_faction: "Sun",
  winner_occupant: "0xabc",
  winner_is_human: false,
  winner_handle: "Newton",
  winning_score: 180,
  winner_control_delta: 54,
  is_void: false,
  seats: [
    { seat_id: 11, faction: "Sun", occupant: "0xabc", is_human: false, claim: 40, counters: 170, melds_value: 10, score: 180, tricks_won: 8, control_delta: 54 },
    { seat_id: 12, faction: "Mars", occupant: "0xdef", is_human: false, claim: 30, counters: 60, melds_value: 0, score: 60, tricks_won: 4, control_delta: -24 },
  ],
  zone_owner_before: "Mars",
  zone_control_before: 20,
  zone_owner_after: "Sun",
  zone_control_after: 34,
  captured: true,
  flux_active: false,
  winner_esms: 25_000,
  agent_turns: 0,
  fallback_turns: 0,
  ...over,
});
const standing = (idx: number, decan_points: number, decan_crowns = 0) => ({
  faction_idx: idx, faction: "x", decan_points, decan_tables_won: 0, lifetime_points: decan_points,
  tables_played: 0, tables_won: 0, zones_captured: 0, decan_crowns, season_crowns: 0, updated_at: 0,
});
const epoch = (over: Record<string, unknown> = {}) => ({
  epoch_id: 1, kind: "Decan", is_decan: true, decan_id: 0, season_number: null, champion: "Mars", champion_score: 350,
  standings: [0, 0, 0, 0, 350, 0, 0, 0, 0, 0], tables_settled: 3,
  started_at: MICROS(1_699_000_000_000), settled_at: MICROS(1_700_000_000_000), ...over,
});

describe("War ledger read model & decan cards", () => {
  it("calculates canonical Minor Tarot Card decan associations without frilly names", () => {
    // 0° Aries: Cardinal Fire -> 2 of Wands
    const aries1 = getDecanInfo(0);
    expect(aries1.card).toBe("2 of Wands");
    expect(aries1.rank).toBe(2);
    expect(aries1.suit).toBe("Wands");
    expect(aries1.startDeg).toBe(0);
    expect(aries1.endDeg).toBe(10);
    expect(aries1.rulerFaction).toBe(4); // Mars

    // 15° Leo: Fixed Fire -> 6 of Wands
    const leo2 = getDecanInfo(4 * 30 + 15);
    expect(leo2.card).toBe("6 of Wands");
    expect(leo2.rank).toBe(6);
    expect(leo2.suit).toBe("Wands");
    expect(leo2.startDeg).toBe(10);
    expect(leo2.endDeg).toBe(20);
    expect(leo2.degInDecan).toBe(5.0);

    // 25° Taurus: Fixed Earth -> 7 of Pentacles
    const taurus3 = getDecanInfo(1 * 30 + 25);
    expect(taurus3.card).toBe("7 of Pentacles");
    expect(taurus3.rank).toBe(7);
    expect(taurus3.suit).toBe("Pentacles");

    // 5° Gemini: Mutable Air -> 8 of Swords
    const gemini1 = getDecanInfo(2 * 30 + 5);
    expect(gemini1.card).toBe("8 of Swords");

    // 15° Cancer: Cardinal Water -> 3 of Cups
    const cancer2 = getDecanInfo(3 * 30 + 15);
    expect(cancer2.card).toBe("3 of Cups");
  });

  it("recovers the true ecliptic longitude from RA/Dec (not RA itself)", () => {
    // λ = 46.25° on the ecliptic (β = 0) → RA/Dec, then back. RA alone is ~2.47° off here.
    const eps = (23.439291 * Math.PI) / 180;
    const lam = (46.25 * Math.PI) / 180;
    const ra = (Math.atan2(Math.sin(lam) * Math.cos(eps), Math.cos(lam)) * 180) / Math.PI;
    const dec = (Math.asin(Math.sin(eps) * Math.sin(lam)) * 180) / Math.PI;
    expect(Math.abs(ra - 46.25)).toBeGreaterThan(2);
    expect(eclipticLonFromEquatorial(ra, dec)).toBeCloseTo(46.25, 6);
    expect(eclipticLonFromEquatorial(0, 0)).toBeCloseTo(0, 6);
  });

  it("maps a settled melee_result into a RoundRecord with the REAL winner", () => {
    const r = roundRecordFromResult(result());
    expect(r.roundId).toBe(101);
    expect(r.tableId).toBe(7);
    expect(r.zoneName).toBe("House 4");
    expect(r.card).toBe("2 of Wands");
    expect(r.winnerFaction).toBe(0);
    expect(r.winnerName).toBe("Sun");
    expect(r.winnerAgent).toBe("Newton");
    expect(r.winningScore).toBe(180);
    expect(r.controlDelta).toBe(54);
    expect(r.capturedZone).toBe(true);
    expect(r.winnerEsms).toBeCloseTo(2.5, 6);
    expect(r.timestamp).toBe(1_700_000_030_000);
    // Unknown decan (no Sun row yet) is -1, not a fake Aries.
    expect(roundRecordFromResult(result({ decan_id: null })).decanId).toBe(-1);
  });

  it("maps decan epochs, and a scoreless decan is a no-contest (never a free Sun crown)", () => {
    const won = decanHistoryFromEpoch(epoch());
    expect(won.card).toBe("2 of Wands");
    expect(won.winnerFaction).toBe(4);
    expect(won.winnerName).toBe("Mars");
    expect(won.winnerScore).toBe(350);
    const none = decanHistoryFromEpoch(epoch({ champion: null, champion_score: 0 }));
    expect(none.winnerFaction).toBe(-1);
    expect(none.winnerName).toBe("No contest");
  });

  it("builds the decan-ledger payload from chain rows (same keys the client reads)", () => {
    const summary = buildDecanLedgerSummary({
      sunLon: 10.5,
      standings: [standing(0, 230), standing(4, 0, 1)],
      results: [result(), result({ table_id: 8, resolved_at: MICROS(1_700_000_090_000), round_index: 102 })],
      epochs: [epoch(), epoch({ epoch_id: 2, kind: "Season", is_decan: false, decan_id: null, season_number: 4 })],
      lastUpdated: 123,
    });
    expect(Object.keys(summary).sort()).toEqual(
      ["activeDecan", "decanHistory", "decanVictories", "factionRoundPoints", "lastUpdated", "recentRounds"],
    );
    expect(summary.activeDecan.card).toBe("3 of Wands");
    expect(summary.factionRoundPoints[0]).toBe(230);
    expect(summary.decanVictories[4]).toBe(1);
    expect(summary.decanHistory.length).toBe(1); // seasons are not decans
    expect(summary.recentRounds.map((r) => r.tableId)).toEqual([8, 7]); // newest first
  });

  it("never reports a void table (nobody played) as a won round", () => {
    const summary = buildDecanLedgerSummary({
      sunLon: 5,
      standings: [],
      results: [result({ table_id: 9, is_void: true, winning_score: 0 }), result()],
      epochs: [],
      lastUpdated: 0,
    });
    expect(summary.recentRounds.map((r) => r.tableId)).toEqual([7]);
  });

  it("withholds points while the war clock still credits the previous decan", () => {
    const base = { standings: [standing(4, 350)], results: [], epochs: [], lastUpdated: 0 };
    // The Sun is in decan 1 (10.5°) but the module has not rolled its clock yet.
    const lagging = buildDecanLedgerSummary({ ...base, sunLon: 10.5, currentDecan: 0 });
    expect(lagging.activeDecan.absDecan).toBe(1);
    expect(lagging.factionRoundPoints[4]).toBe(0);
    const rolled = buildDecanLedgerSummary({ ...base, sunLon: 10.5, currentDecan: 1 });
    expect(rolled.factionRoundPoints[4]).toBe(350);
  });

  it("reads through a cursor and keeps serving the last snapshot when SQL fails", async () => {
    let now = 1_700_000_100_000;
    const seen: string[] = [];
    let fail = false;
    const reader = new WarLedgerReader({
      ttlMs: 1000,
      now: () => now,
      query: async (sql: string) => {
        seen.push(sql);
        if (fail) throw new Error("maincloud 503");
        if (sql.includes("faction_war_standing")) return [standing(0, 230)];
        if (sql.includes("war_epoch")) return [epoch()];
        if (sql.includes("melee_result")) return [result()];
        if (sql.includes("ephemeris")) return [{ body: "Sun", ra: 0, dec: 0 }];
        if (sql.includes("war_state")) return [{ current_decan: 0 }];
        return [];
      },
    });
    const first = await reader.summary();
    // u64 columns reject negative literals: the first epoch read must not send one.
    expect(seen.some((q) => /> -\d/.test(q))).toBe(false);
    expect(first.factionRoundPoints[0]).toBe(230);
    expect(first.recentRounds.length).toBe(1);
    expect(first.activeDecan.absDecan).toBe(0);

    // Second refresh asks only for newer rows.
    now += 5000;
    await reader.summary();
    expect(seen.some((q) => q.includes("is_decan = true AND epoch_id > 1"))).toBe(true);
    expect(seen.some((q) => q.includes("table_id >"))).toBe(false); // resolved_at cursor, not ids
    expect(seen.filter((q) => q.includes("melee_result")).length).toBe(2);

    // A failed refresh serves the cached snapshot instead of throwing.
    fail = true;
    now += 5000;
    const cached = await reader.summary();
    expect(cached.factionRoundPoints[0]).toBe(230);
    expect((await reader.rounds()).length).toBe(1);
  });

  it("one missing table degrades only its own part of the payload", async () => {
    const reader = new WarLedgerReader({
      query: async (sql: string) => {
        if (sql.includes("war_epoch")) throw new Error("no such table: `war_epoch`");
        if (sql.includes("faction_war_standing")) return [standing(4, 120, 2)];
        if (sql.includes("melee_result")) return [result()];
        if (sql.includes("ephemeris")) return [{ body: "Sun", ra: 0, dec: 0 }];
        if (sql.includes("war_state")) return [{ current_decan: 0 }];
        return [];
      },
    });
    const s = await reader.summary();
    expect(s.factionRoundPoints[4]).toBe(120);
    expect(s.decanVictories[4]).toBe(2);
    expect(s.recentRounds.length).toBe(1);
    expect(s.decanHistory).toEqual([]);
  });

  it("rate-limits a failing database instead of re-querying on every poll", async () => {
    let now = 1_000_000;
    let calls = 0;
    const reader = new WarLedgerReader({
      ttlMs: 10_000,
      now: () => now,
      query: async () => { calls += 1; throw new Error("maincloud 503"); },
    });
    await expect(reader.summary()).rejects.toThrow();
    const afterFirst = calls;
    await expect(reader.summary()).rejects.toThrow(); // inside the TTL: no new queries
    expect(calls).toBe(afterFirst);
    now += 10_000;
    await expect(reader.summary()).rejects.toThrow();
    expect(calls).toBe(afterFirst * 2);
  });

  it("syncs cleanly into client GameState representation", () => {
    const summary = buildDecanLedgerSummary({
      sunLon: 3.0,
      standings: [standing(0, 190)],
      results: [result({ winning_score: 190, captured: false })],
      epochs: [],
      lastUpdated: 1,
    });

    // Mock client GameState. Mirrors public/client.js: the local Sun owns the
    // active decan, so the ledger never sets it, and round points only apply
    // when the ledger is scoring that same decan.
    const clientMock = {
      factionRoundPoints: new Array(10).fill(0),
      decanVictories: new Array(10).fill(0),
      decanHistory: [] as any[],
      roundResults: [] as any[],
      currentDecanId: 0 as number | null,
      saved: false,
      recalculated: false,
      syncDecanLedger(payload: any) {
        if (!payload) return;
        const ledgerIsCurrent = payload.activeDecan?.absDecan === this.currentDecanId;
        if (ledgerIsCurrent && Array.isArray(payload.factionRoundPoints)) this.factionRoundPoints = [...payload.factionRoundPoints];
        if (Array.isArray(payload.decanVictories)) this.decanVictories = [...payload.decanVictories];
        if (Array.isArray(payload.decanHistory)) this.decanHistory = [...payload.decanHistory];
        if (Array.isArray(payload.recentRounds)) this.roundResults = [...payload.recentRounds];
        this.recalculated = true;
        this.saved = true;
      }
    };

    expect(summary.activeDecan.absDecan).toBe(0);
    clientMock.syncDecanLedger(summary);
    expect(clientMock.factionRoundPoints[0]).toBe(190);
    expect(clientMock.roundResults.length).toBe(1);
    expect(clientMock.currentDecanId).toBe(0);
    expect(clientMock.recalculated).toBe(true);
    expect(clientMock.saved).toBe(true);
  });
});
