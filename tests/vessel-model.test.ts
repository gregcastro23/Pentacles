import { describe, expect, test } from "bun:test";
import { foldArenaStats, foldDuelRows, parseTreasury, streamTotal } from "../src/ui/vessel-model.js";

const ME = "a".repeat(64);
const THEM = "b".repeat(64);

describe("foldDuelRows", () => {
  test("credits wins from either side and skips other players' duels", () => {
    const rows = [
      { duel_id: 1, initiator: { __identity__: `0x${ME}` }, state: "Resolved", winner_is_initiator: true },
      { duel_id: 2, initiator: THEM, target_player: ME, state: "Resolved", winner_is_initiator: false },
      { duel_id: 3, initiator: THEM, target_player: ME, state: "Resolved", winner_is_initiator: true },
      { duel_id: 4, initiator: ME, state: "Pending", winner_is_initiator: null },
      { duel_id: 5, initiator: THEM, state: "Resolved", winner_is_initiator: true },
    ];
    expect(foldDuelRows(rows, ME)).toEqual({ wins: 2, resolved: 3, fought: 4 });
  });

  test("an unreadable table stays null rather than zero", () => {
    expect(foldDuelRows(null, ME)).toBeNull();
  });

  test("counts completed draws without counting pending or cancelled duels", () => {
    const rows = [
      { initiator: ME, state: "Resolved", winner_is_initiator: null },
      { initiator: THEM, target_player: ME, state: "Resolved", winner_is_initiator: false },
      { initiator: ME, state: "Pending", winner_is_initiator: null },
      { initiator: ME, state: "Cancelled", winner_is_initiator: null },
    ];
    expect(foldDuelRows(rows, ME)).toEqual({ wins: 1, resolved: 2, fought: 4 });
  });
});

describe("foldArenaStats", () => {
  test("reads the seat, pool and player for this identity only", () => {
    const stats = foldArenaStats({
      identity: `0x${ME.toUpperCase()}`,
      player: { tokens: 1250, word_wins: 3 },
      jingDuels: [],
      pillarDuels: null,
      seats: [
        { table_id: 9, occupant: THEM, counters: 40, melds_value: 20, score: 70 },
        { table_id: 9, occupant: ME, counters: 12, melds_value: 5, score: 27 },
      ],
      pillarPool: [{ identity: ME, esms: [80.12345, 80, 79.5, 80] }],
    });
    expect(stats.arenaTokens).toBe(1250);
    expect(stats.wordWins).toBe(3);
    expect(stats.jing).toEqual({ wins: 0, resolved: 0, fought: 0 });
    expect(stats.pillars).toBeNull();
    expect(stats.seat).toEqual({ tableId: "9", counters: 12, melds: 5, score: 27 });
    expect(stats.pillarPool).toEqual([80.1235, 80, 79.5, 80]);
  });

  test("offline arena reads report null, not simulated values", () => {
    const stats = foldArenaStats({ identity: ME, player: null, jingDuels: null, pillarDuels: null, seats: null, pillarPool: null });
    expect(stats).toMatchObject({ arenaTokens: null, wordWins: null, jing: null, pillars: null, seat: null, pillarPool: null });
  });
});

describe("parseTreasury", () => {
  const stream = { ledgerEsms: [1, 2, 3, 4] };
  const vessel = {
    version: 1,
    balances: { spirit: 1, essence: 2, matter: 3, substance: 4, totalUsdEquivalent: null },
    streams: { jingDuels: stream, staking: stream, pentaclesMelee: stream, kitchenAchievements: stream },
  };

  test("accepts a v1 vessel envelope", () => {
    expect(parseTreasury({ ok: true, vessel })).toBe(vessel);
  });

  test("rejects errors, other versions and incomplete streams", () => {
    expect(parseTreasury({ ok: false, error: "Unauthorized" })).toBeNull();
    expect(parseTreasury({ ok: true, vessel: { ...vessel, version: 2 } })).toBeNull();
    expect(parseTreasury({ ok: true, vessel: { ...vessel, streams: { jingDuels: stream } } })).toBeNull();
  });

  test("streamTotal sums on the 4-decimal unit", () => {
    expect(streamTotal([0.1, 0.2, 0, 0])).toBe(0.3);
  });
});
