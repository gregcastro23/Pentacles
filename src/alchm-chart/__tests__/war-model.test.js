/* Pure tests for the Faction War model.
   Run: `node src/alchm-chart/__tests__/war-model.test.js` */
import assert from "node:assert/strict";
import {
  buildZones, computeStandings, factionRoster, deriveEvents, standingsTrend,
  agentIdentitySet, agentByIdentity, planetIdx, zoneName, zoneKindOf, PLANET_NAMES,
} from "../war-model.js";

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log("  ✓", name); };
const JUP = 5, MOON = 1, MARS = 4;

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

console.log(`\n${passed} passed`);
