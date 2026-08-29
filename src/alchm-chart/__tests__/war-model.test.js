/* Pure tests for the Faction War model.
   Run: `node src/alchm-chart/__tests__/war-model.test.js` */
import assert from "node:assert/strict";
import {
  buildZones, computeStandings, factionRoster, deriveEvents, standingsTrend,
  agentIdentitySet, agentByIdentity, planetIdx, zoneName, zoneKindOf, PLANET_NAMES,
  canAccessZone, accessRefusalReason, buildTables, roundClock, factionArchetype, FACTION_ARCHETYPES,
  deriveTurnSeat, TOTAL_TRICKS,
} from "../war-model.js";

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("  ✓", name); };
const JUP = 5, MOON = 1, MARS = 4, SAT = 6;

console.log("Faction War model:");

t("zone naming + kind split (5 House / 5 Spire / 1 Crown)", () => {
  assert.equal(zoneName(0), "House I");
  assert.equal(zoneName(4), "House V");
  assert.equal(zoneName(5), "Spire I");
  assert.equal(zoneName(10), "The Crown");
  assert.equal(zoneKindOf(2), "house");
  assert.equal(zoneKindOf(7), "spire");
  assert.equal(zoneKindOf(10), "crown");
});

t("planetIdx normalizes name/case/index/null", () => {
  assert.equal(planetIdx("Jupiter"), 5);
  assert.equal(planetIdx("jupiter"), 5);
  assert.equal(planetIdx(5), 5);
  assert.equal(planetIdx(null), null);
  assert.equal(planetIdx("Chiron"), null); // not a faction
});

t("buildZones fills all 11, clamps control, flags contested", () => {
  const z = buildZones([
    { zone_id: 6, owner: "Jupiter", control: 668 },
    { zone_id: 2, owner: "Moon", control: 120 },   // weak hold → contested
    { zone_id: 0, owner: "Mars", control: 5000 },  // clamps to 1000
  ]);
  assert.equal(z.length, 11);
  assert.equal(z[6].ownerIdx, JUP);
  assert.equal(z[6].contested, false);
  assert.equal(z[2].contested, true);
  assert.equal(z[0].control, 1000);
  assert.equal(z[9].ownerIdx, null); // unfilled → neutral
});

t("computeStandings ranks by weight then control; counts agents vs humans", () => {
  const zones = buildZones([
    { zone_id: 10, owner: "Jupiter", control: 400 }, // crown weight 3
    { zone_id: 5, owner: "Moon", control: 900 },     // spire weight 2
    { zone_id: 6, owner: "Moon", control: 100 },     // spire weight 2 → Moon weight 4
    { zone_id: 0, owner: "Mars", control: 300 },     // house weight 1
  ]);
  const players = [
    { identity: "0xA", faction: "Jupiter" },
    { identity: "0xB", faction: "Jupiter" },
    { identity: "0xH", faction: "Jupiter" }, // human (not in agent set)
    { identity: "0xC", faction: "Moon" },
  ];
  const agents = agentIdentitySet([{ identity: "0xA" }, { identity: "0xB" }, { identity: "0xC" }]);
  const s = computeStandings(zones, players, agents);
  assert.equal(s[0].idx, MOON);   // weight 4 → champion
  assert.equal(s[1].idx, JUP);    // weight 3
  const jup = s.find((r) => r.idx === JUP);
  assert.equal(jup.agents, 2);
  assert.equal(jup.humans, 1);
  assert.equal(jup.total, 3);
  assert.equal(s.find((r) => r.idx === MARS).zones, 1);
});

t("factionRoster lists faction members, agents first, with handles", () => {
  const players = [
    { identity: "0xA", faction: "Jupiter", handle: "raw" },
    { identity: "0xH", faction: "Jupiter", handle: "Ada (human)" },
    { identity: "0xC", faction: "Moon", handle: "x" },
  ];
  const map = agentByIdentity([{ identity: "0xA", handle: "Carl Sagan" }]);
  const r = factionRoster(JUP, players, map);
  assert.equal(r.length, 2);
  assert.equal(r[0].handle, "Carl Sagan"); // agent first, name from agent_chart
  assert.equal(r[0].isAgent, true);
  assert.equal(r[1].isAgent, false);
});

t("deriveEvents diffs captures, control swings, and joins", () => {
  const prev = buildZones([{ zone_id: 6, owner: "Moon", control: 300 }, { zone_id: 0, owner: "Mars", control: 500 }]);
  const now = buildZones([{ zone_id: 6, owner: "Jupiter", control: 200 }, { zone_id: 0, owner: "Mars", control: 600 }]);
  const prevSt = computeStandings(prev, [{ identity: "0xC", faction: "Moon" }], new Set());
  const nowSt = computeStandings(now, [{ identity: "0xC", faction: "Moon" }, { identity: "0xD", faction: "Moon" }], new Set());
  const ev = deriveEvents(prev, now, prevSt, nowSt, PLANET_NAMES, ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"], "now");
  assert.ok(ev.some((e) => e.kind === "capture" && e.idx === JUP), "Jupiter capture");
  assert.ok(ev.some((e) => e.kind === "rise" && e.idx === MARS), "Mars control rise");
  assert.ok(ev.some((e) => e.kind === "join" && e.idx === MOON), "Moon ally joined");
});

t("standingsTrend marks rising/falling vs prior snapshot", () => {
  const a = [{ idx: JUP, weight: 3, control: 400 }, { idx: MOON, weight: 2, control: 100 }];
  const b = [{ idx: JUP, weight: 3, control: 500 }, { idx: MOON, weight: 2, control: 100 }];
  const tr = standingsTrend(b, a);
  assert.equal(tr[JUP], 1);
  assert.equal(tr[MOON], 0);
});

t("canAccessZone & accessRefusalReason gate access correctly", () => {
  const zoneOwners = new Array(11).fill(null);
  // Houses always open
  for (let h = 0; h < 5; h++) {
    assert.equal(canAccessZone(h, SAT, zoneOwners), true);
    assert.equal(accessRefusalReason(h, SAT, zoneOwners), null);
  }

  // Spire 0 (zone 5) needs House 0 or House 4
  assert.equal(canAccessZone(5, SAT, zoneOwners), false);
  assert.equal(accessRefusalReason(5, SAT, zoneOwners), "Spire 0 is out of reach — Saturn must hold an adjacent House first.");

  zoneOwners[0] = SAT; // Saturn holds House 0
  assert.equal(canAccessZone(5, SAT, zoneOwners), true);
  assert.equal(accessRefusalReason(5, SAT, zoneOwners), null);

  // Crown (zone 10) needs two Spires
  assert.equal(canAccessZone(10, SAT, zoneOwners), false);
  assert.equal(accessRefusalReason(10, SAT, zoneOwners), "The Crown is sealed to your faction — hold two Spires first.");

  zoneOwners[5] = SAT; // 1 spire
  assert.equal(canAccessZone(10, SAT, zoneOwners), false);
  zoneOwners[6] = SAT; // 2 spires
  assert.equal(canAccessZone(10, SAT, zoneOwners), true);
  assert.equal(accessRefusalReason(10, SAT, zoneOwners), null);
});

t("buildTables normalizes melee table, seat, and play manifests", () => {
  const tables = [{ table_id: 1, zone_id: 2, round_index: 42, trump_suit: "swords", state: "Seated", seat_count: 3, opened_at: 1000000000, ladder_raw: '{"0":50,"1":80}' }];
  const seats = [
    { seat_id: 101, table_id: 1, occupant: "0x111", faction: "Mars", is_human: false, claim: 85, counters: 20, melds_value: 40, score: 60 },
    { seat_id: 102, table_id: 1, occupant: "0x222", faction: "Moon", is_human: true, claim: 70, counters: 30, melds_value: 0, score: 30 },
  ];
  const players = [{ identity: "0x222", handle: "PlayerOne" }];
  const agents = { "0x111": { handle: "Marie Curie" } };
  const plays = [
    { play_id: 1, table_id: 1, trick_number: 1, seat_id: 101, card_id: 55, is_major: false, rank: 14, suit: "swords", played_at: 1000005000 },
  ];

  const m = buildTables(tables, seats, players, agents, PLANET_NAMES, plays);
  assert.equal(m.tables.length, 1);
  const t1 = m.byId[1];
  assert.ok(t1);
  assert.equal(t1.zoneId, 2);
  assert.equal(t1.hasHuman, true);
  assert.equal(t1.seats.length, 2);
  assert.equal(t1.seats[0].handle, "Marie Curie");
  assert.equal(t1.seats[0].isAgent, true);
  assert.equal(t1.seats[1].handle, "PlayerOne");
  assert.equal(t1.seats[1].isHuman, true);
  assert.equal(t1.ladder[1], 80);
  assert.equal(m.byZone[2].tableId, 1);
});

t("roundClock determines phase and progress for 60s and 120s tables", () => {
  const baseTime = 1700000000000;
  const agentTable = { tableId: 1, openedAt: baseTime, hasHuman: false, state: "Seated" };

  // 5s in -> muster
  const c1 = roundClock(agentTable, baseTime + 5000);
  assert.equal(c1.phase, "muster");
  assert.equal(c1.secondsRemaining, 55);

  // 12s in -> seating
  const c2 = roundClock(agentTable, baseTime + 12000);
  assert.equal(c2.phase, "seating");

  // 30s in -> play
  const c3 = roundClock(agentTable, baseTime + 30000);
  assert.equal(c3.phase, "play");

  // 57s in -> resolve
  const c4 = roundClock(agentTable, baseTime + 57000);
  assert.equal(c4.phase, "resolve");

  // resolved state
  const resolvedTable = { tableId: 1, openedAt: baseTime, resolvedAt: baseTime + 58000, hasHuman: false, state: "Resolved" };
  const c5 = roundClock(resolvedTable, baseTime + 65000);
  assert.equal(c5.phase, "resolved");
  assert.equal(c5.progressPct, 100);

  // human table (120s) at 70s -> play
  const humanTable = { tableId: 2, openedAt: baseTime, hasHuman: true, state: "Seated" };
  const c6 = roundClock(humanTable, baseTime + 70000);
  assert.equal(c6.phase, "play");
  assert.equal(c6.totalDuration, 120);
});

t("factionArchetype returns all 10 combat doctrines and tags seats", () => {
  assert.equal(FACTION_ARCHETYPES.length, 10);
  assert.equal(factionArchetype(4).archetype, "Onslaught");
  assert.equal(factionArchetype(6).archetype, "Endurance");
  assert.equal(factionArchetype(2).archetype, "Quicksilver");
  assert.equal(factionArchetype(0).archetype, "Radiance");

  const tables = [{ table_id: 1, zone_id: 0, round_index: 1, trump_suit: "wands", state: "Seated", seat_count: 2, opened_at: 1000000000 }];
  const seats = [
    { seat_id: 1, table_id: 1, occupant: "0x1", faction: "Mars", is_human: false, claim: 90, counters: 0, melds_value: 0, score: 0 },
    { seat_id: 2, table_id: 1, occupant: "0x2", faction: "Saturn", is_human: false, claim: 80, counters: 0, melds_value: 0, score: 0 },
  ];
  const m = buildTables(tables, seats, [], {}, PLANET_NAMES, []);
  assert.equal(m.byId[1].seats[0].archetype, "Onslaught");
  assert.equal(m.byId[1].seats[1].archetype, "Endurance");
});


// ── The refereed table: dealt hands, resolved tricks, whose turn it is ──────
//
// The module owns all three now. Everything below asserts the client reads them
// the same way server/src/reducers.rs writes them — a disagreement here is a
// player told it is their turn when `play_melee_card` will refuse them.

const TABLE = [{
  table_id: 7, zone_id: 3, round_index: 9, trump_suit: "cups", state: "Seated",
  seat_count: 3, opened_at: 1000000000, ladder_raw: '{"0":50}',
}];
const SEATS3 = [
  { seat_id: 1, table_id: 7, occupant: "0xa", faction: "Mars", is_human: false, claim: 90, counters: 0, melds_value: 0, score: 0 },
  { seat_id: 2, table_id: 7, occupant: "0xb", faction: "Moon", is_human: true, claim: 80, counters: 0, melds_value: 0, score: 0 },
  { seat_id: 3, table_id: 7, occupant: "0xc", faction: "Saturn", is_human: false, claim: 70, counters: 0, melds_value: 0, score: 0 },
];
const hand = (seat_id, ids, played = []) =>
  ids.map((card_id, i) => ({
    hand_id: seat_id * 100 + i, table_id: 7, seat_id, card_id,
    suit: "cups", rank: (i % 14) + 1, is_major: false, inverted: false,
    played: played.includes(card_id),
  }));
const play = (play_id, trick_number, seat_id, card_id) => ({
  play_id, table_id: 7, trick_number, seat_id, card_id,
  is_major: false, rank: 5, suit: "cups", played_at: 1000005000,
});
const build = (plays, hands, tricks) =>
  buildTables(TABLE, SEATS3, [], {}, PLANET_NAMES, plays, hands, tricks).byId[7];

t("buildTables attaches each seat's dealt hand and what is left of it", () => {
  const hands = [...hand(1, [11, 12, 13], [11]), ...hand(2, [21, 22, 23])];
  const m = build([], hands, []);
  assert.equal(m.seats[0].hand.length, 3);
  assert.equal(m.seats[0].handRemaining, 2, "a spent card leaves the hand");
  assert.equal(m.seats[0].hasDeal, true);
  // Seat 3 has no rows yet. "Not dealt" must not read as "out of cards".
  assert.equal(m.seats[2].handRemaining, 0);
  assert.equal(m.seats[2].hasDeal, false);
});

t("the open trick comes from resolved trick rows, never from a play count", () => {
  const hands = [...hand(1, [11, 12]), ...hand(2, [21, 22]), ...hand(3, [31, 32])];
  // Trick 1 is resolved; trick 2 has one card down. A play-count guess
  // (4 plays / 3 seats + 1) would also say 2 here — so make the counts disagree
  // by resolving a SHORT trick, which is exactly where the old guess broke.
  const tricks = [{
    trick_id: 1, table_id: 7, trick_number: 1, leader_seat: 1, led_suit: "cups",
    winner_seat: 3, counters: 20, excuse_seat: null, resolved_at: 1000006000,
  }];
  const plays = [play(1, 1, 1, 11), play(2, 1, 2, 21), play(3, 2, 3, 31)];
  const m = build(plays, hands, tricks);
  assert.equal(m.currentTrick, 2);
  assert.equal(m.trickPlays.length, 1, "only the open trick is on the table");
  assert.equal(m.trickPlays[0].seatId, 3);
  assert.equal(m.leaderSeat, 3, "the seat that took trick 1 leads trick 2");
  assert.equal(m.lastResolvedTrick.counters, 20);
});

t("the turn walks from the leader and lands on the first seat yet to play", () => {
  const hands = [...hand(1, [11, 12]), ...hand(2, [21, 22]), ...hand(3, [31, 32])];
  const fresh = build([], hands, []);
  assert.equal(fresh.turnSeat, 1, "seat one leads trick one");

  const oneDown = build([play(1, 1, 1, 11)], hands, []);
  assert.equal(oneDown.turnSeat, 2);

  const full = build([play(1, 1, 1, 11), play(2, 1, 2, 21), play(3, 1, 3, 31)], hands, []);
  assert.equal(full.turnSeat, null, "a full trick has nobody on turn");
});

t("the rotation wraps past the last seat back to the first", () => {
  const hands = [...hand(1, [11]), ...hand(2, [21]), ...hand(3, [31])];
  const tricks = [{
    trick_id: 1, table_id: 7, trick_number: 1, leader_seat: 1, led_suit: "cups",
    winner_seat: 3, counters: 0, excuse_seat: null, resolved_at: 1,
  }];
  // Seat 3 leads trick 2 and has played; the turn must wrap to seat 1.
  const m = build([play(9, 2, 3, 31)], hands, tricks);
  assert.equal(m.leaderSeat, 3);
  assert.equal(m.turnSeat, 1, "after the last seat the rotation wraps");
});

t("a seat dealt short drops out of the rotation instead of stalling it", () => {
  // Seat 2 has spent everything. `melee_turn` in reducers.rs skips it; so must we,
  // or the client waits forever on a player with no card to play.
  const hands = [...hand(1, [11, 12]), ...hand(2, [21], [21]), ...hand(3, [31, 32])];
  const m = build([play(1, 1, 1, 11)], hands, []);
  assert.equal(m.turnSeat, 3, "the exhausted seat is skipped");

  const both = build([play(1, 1, 1, 11), play(2, 1, 3, 31)], hands, []);
  assert.equal(both.turnSeat, null, "two of two live seats have played");
});

t("deriveTurnSeat is the standalone mirror of the server rotation", () => {
  const seats = [
    { seatId: 1, handRemaining: 2, hasDeal: true },
    { seatId: 2, handRemaining: 0, hasDeal: true },
    { seatId: 3, handRemaining: 2, hasDeal: true },
  ];
  assert.equal(deriveTurnSeat(seats, 3, []), 3);
  assert.equal(deriveTurnSeat(seats, 3, [{ seatId: 3 }]), 1);
  assert.equal(deriveTurnSeat(seats, 3, [{ seatId: 3 }, { seatId: 1 }]), null);
  assert.equal(deriveTurnSeat([], 1, []), null, "no seats, no turn");
});

t("the trick counter never runs past the twelve a melee holds", () => {
  const tricks = Array.from({ length: TOTAL_TRICKS }, (_, i) => ({
    trick_id: i + 1, table_id: 7, trick_number: i + 1, leader_seat: 1,
    led_suit: "cups", winner_seat: 2, counters: 0, excuse_seat: null, resolved_at: 1,
  }));
  assert.equal(build([], [], tricks).currentTrick, TOTAL_TRICKS);
});

console.log(`\n${passed} passed`);
