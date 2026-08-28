/* Pure tests for the Faction War model.
   Run: `node src/alchm-chart/__tests__/war-model.test.js` */
import assert from "node:assert/strict";
import {
  buildZones, computeStandings, factionRoster, deriveEvents, standingsTrend,
  agentIdentitySet, agentByIdentity, planetIdx, zoneName, zoneKindOf, PLANET_NAMES,
  canAccessZone, accessRefusalReason, buildTables, roundClock,
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

console.log(`\n${passed} passed`);
