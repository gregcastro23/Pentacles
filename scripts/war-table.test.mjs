// The War Table — tested against the REAL implementation.
//
// The previous file under this name defined canAccessZone / computeClaim /
// determineSeatOrder inside itself and asserted against those, so it passed no
// matter what the product code did — and it had the Spire adjacency wrong. Every
// function exercised here is imported from feeder/war-table.ts.
//
// Run: bun scripts/war-table.test.mjs   (bun, not node — it imports TypeScript)
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  canAccessZone, computeClaim, opportunity, trumpDepth, chooseChampions,
  seatOrder, seededRandom, dealHand, playMelee, restIsWaived, buildAgents,
  zoneTrump, archetypeMovePicker, MAX_SEATS, MIN_SEATS, HAND_SIZE, MAX_MAJORS_IN_HAND,
} from "../feeder/war-table.ts";

const Engine = globalThis.ArcanaTrickEngine;
assert.ok(Engine, "importing war-table must publish the trick engine on globalThis");

const NEUTRAL = new Array(11).fill(null);
const owned = (pairs) => { const z = new Array(11).fill(null); for (const [i, f] of pairs) z[i] = f; return z; };

// ── 1. Access ladder — PARITY with server/src/reducers.rs:2506 ───────────────
console.log("▶ 1 · Access ladder parity with can_access_zone");
{
  // Houses are always reachable.
  for (let z = 0; z < 5; z++) assert.ok(canAccessZone(z, 6, NEUTRAL), `House ${z} is always open`);

  // A Spire needs one of its TWO adjacent Houses. The Rust is
  //   spire_idx = zone_id - 5 ; house_a = spire_idx ; house_b = (spire_idx + 4) % 5
  // i.e. (zone_id - 1) % 5 — NOT (zone_id - 4) % 5, which the old mock used.
  const rustSource = fs.readFileSync(new URL("../server/src/reducers.rs", import.meta.url), "utf8");
  assert.match(rustSource, /let house_b = \(spire_idx \+ 4\) % 5;/,
    "the Rust adjacency changed — this mirror must be updated with it");

  for (let zone = 5; zone < 10; zone++) {
    const spireIdx = zone - 5;
    const a = spireIdx, b = (spireIdx + 4) % 5;
    assert.ok(!canAccessZone(zone, 6, NEUTRAL), `Spire ${zone} is sealed to a landless faction`);
    assert.ok(canAccessZone(zone, 6, owned([[a, 6]])), `House ${a} opens Spire ${zone}`);
    assert.ok(canAccessZone(zone, 6, owned([[b, 6]])), `House ${b} opens Spire ${zone}`);
    // A House that is adjacent to neither must NOT open it.
    const far = [0, 1, 2, 3, 4].find((h) => h !== a && h !== b);
    assert.ok(!canAccessZone(zone, 6, owned([[far, 6]])), `House ${far} must not open Spire ${zone}`);
    // Another faction's House does not help you.
    assert.ok(!canAccessZone(zone, 6, owned([[a, 3]])), "a rival's House does not open your Spire");
  }

  // The Crown needs two Spires.
  assert.ok(!canAccessZone(10, 6, NEUTRAL), "the Crown is sealed by default");
  assert.ok(!canAccessZone(10, 6, owned([[5, 6]])), "one Spire is not enough for the Crown");
  assert.ok(canAccessZone(10, 6, owned([[5, 6], [7, 6]])), "two Spires open the Crown");
  console.log("  ✓ Houses → Spires → Crown, adjacency matches the reducer");
}

// ── 2. Claim ────────────────────────────────────────────────────────────────
console.log("▶ 2 · Zone Claim");
{
  const vec = new Array(12).fill(0); vec[0] = 40; // an Aries-heavy chart
  const agent = (over = {}) => ({
    identity: "0xa", handle: "A", faction: 4 /* Mars */, signVector: vec,
    active: [{ card_id: 1, suit: "wands", rank: 5, is_major: false }], rested: false, ...over,
  });
  const quiet = { control: 800, owner: 4, inFlux: false };

  // Access is a HARD gate: an unreachable zone scores zero however attractive.
  const hot = { control: 10, owner: 3, inFlux: true };
  assert.equal(computeClaim(agent(), 7, hot, NEUTRAL), 0, "an unreachable Spire claims nothing");
  assert.ok(computeClaim(agent(), 7, hot, owned([[2, 4]])) > 0, "...and claims once the House is held");

  // Monotonic in each term.
  assert.ok(computeClaim(agent(), 0, hot, NEUTRAL) > computeClaim(agent(), 0, quiet, NEUTRAL),
    "opportunity raises a claim");
  assert.ok(computeClaim(agent(), 0, quiet, NEUTRAL) > computeClaim(agent({ rested: true }), 0, quiet, NEUTRAL),
    "rest lowers a claim");
  const flat = new Array(12).fill(100 / 12);
  assert.ok(computeClaim(agent(), 0, quiet, NEUTRAL) > computeClaim(agent({ signVector: flat }), 0, quiet, NEUTRAL),
    "sign affinity raises a claim");
  // Mars is domicile in Aries (zone 0) and in fall in Cancer (zone 3).
  assert.ok(computeClaim(agent(), 0, quiet, NEUTRAL) > computeClaim(agent({ signVector: flat }), 3, quiet, NEUTRAL),
    "dignity in the zone's sign matters");

  assert.ok(opportunity({ control: 10, owner: 3, inFlux: true }, 4) === 1.0, "every opportunity term stacks to 1");
  assert.equal(trumpDepth([{ suit: "wands" }, { suit: "cups" }], 0), 0.5, "trump depth is a share of minors");
  assert.equal(trumpDepth([{ is_major: true, rank: 4 }], 0), 0, "Majors are not trump depth");
  console.log("  ✓ hard access gate, monotone in affinity / dignity / opportunity / rest");
}

// ── 3. Champions ────────────────────────────────────────────────────────────
console.log("▶ 3 · Champion selection");
{
  const vec = new Array(12).fill(100 / 12);
  const mk = (i, faction) => ({
    identity: `0x${String(i).padStart(3, "0")}`, handle: `agent${i}`, faction, signVector: vec,
    active: [{ card_id: i, suit: "wands", rank: 5, is_major: false }], rested: false,
  });
  // Ten factions × 3 agents, all Houses open.
  const agents = [];
  for (let f = 0; f < 10; f++) for (let k = 0; k < 3; k++) agents.push(mk(f * 3 + k, f));
  const zones = [0, 1, 2, 3, 4].map((z) => ({ zoneId: z, control: 100, owner: null, inFlux: false }));
  const plans = chooseChampions(agents, zones, NEUTRAL);

  const seatedIds = new Set();
  for (const p of plans) {
    assert.ok(p.seats.length >= MIN_SEATS && p.seats.length <= MAX_SEATS,
      `zone ${p.zoneId} seated ${p.seats.length}, outside ${MIN_SEATS}..${MAX_SEATS}`);
    const factions = p.seats.map((s) => s.faction);
    assert.equal(new Set(factions).size, factions.length, `zone ${p.zoneId} seated a faction twice`);
    assert.equal(p.trumpSuit, zoneTrump(p.zoneId), "trump is the zone's element");
    for (const s of p.seats) {
      assert.ok(!seatedIds.has(s.occupant), `${s.occupant} took two seats in one round`);
      seatedIds.add(s.occupant);
    }
  }
  // Deterministic: same input, same manifest.
  assert.deepEqual(JSON.stringify(chooseChampions(agents, zones, NEUTRAL)), JSON.stringify(plans),
    "champion selection must replay identically");

  // A zone nobody can reach opens no table.
  const sealed = chooseChampions(agents, [{ zoneId: 10, control: 100, owner: null, inFlux: false }], NEUTRAL);
  assert.equal(sealed.length, 0, "the Crown opens no table while it is sealed");
  console.log(`  ✓ ${plans.length} tables · one seat per agent · one seat per faction · deterministic`);
}

// ── 4. Rest is roster-relative (the measured 12 : 2 spread) ──────────────────
console.log("▶ 4 · Roster-relative rest");
{
  // Every faction can reach the five Houses, so a roster of 5 or fewer never rests.
  assert.ok(restIsWaived(2, 5), "Neptune's two agents never rest");
  assert.ok(!restIsWaived(12, 5), "Saturn's twelve rotate");

  const vec = new Array(12).fill(100 / 12);
  const mk = (i, faction) => ({ identity: `0x${i}`, handle: `a${i}`, faction, placements: [], time_known: false });
  const rows = [...Array(12)].map((_, i) => mk(i, 6)).concat([...Array(2)].map((_, i) => mk(100 + i, 8)));
  const factionOf = new Map(rows.map((r) => [r.identity, r.faction]));
  const active = new Map(rows.map((r) => [r.identity, [{ card_id: 1, suit: "wands", rank: 5, is_major: false }]]));
  const restedAll = new Set(rows.map((r) => r.identity));

  const built = buildAgents(rows, factionOf, active, restedAll, NEUTRAL);
  const neptune = built.filter((a) => a.faction === 8);
  const saturn = built.filter((a) => a.faction === 6);
  assert.ok(neptune.every((a) => !a.rested), "a thin faction's rest is waived — Neptune plays every round");
  assert.ok(saturn.every((a) => a.rested), "a deep faction still rests");
  console.log("  ✓ Saturn (12) rotates · Neptune (2) is never benched");
}

// ── 5. Deal ─────────────────────────────────────────────────────────────────
console.log("▶ 5 · The deal");
{
  const active = [];
  for (let i = 0; i < 10; i++) active.push({ card_id: i, suit: "wands", rank: (i % 9) + 2, is_major: false });
  for (let i = 0; i < 10; i++) active.push({ card_id: 100 + i, rank: i, is_major: true });

  const hand = dealHand(active, seededRandom(42));
  assert.equal(hand.length, HAND_SIZE, "twelve cards");
  assert.ok(hand.filter((c) => c.is_major).length <= MAX_MAJORS_IN_HAND, "at most three Arcana Slots");
  assert.equal(new Set(hand.map((c) => c.card_id)).size, hand.length, "no card dealt twice");
  assert.deepEqual(dealHand(active, seededRandom(42)), hand, "the same seed deals the same hand");
  assert.notDeepEqual(dealHand(active, seededRandom(43)), hand, "a different seed deals differently");

  const thin = dealHand(active.slice(0, 4), seededRandom(1));
  assert.equal(thin.length, 4, "a small collection deals what it has");
  console.log("  ✓ 12 cards · ≤3 Majors · seeded and reproducible");
}

// ── 6. A melee at every seat count ──────────────────────────────────────────
console.log("▶ 6 · Melee at 2..6 seats");
{
  const ladder = {}; for (let i = 0; i <= 21; i++) ladder[i] = 40 + i * 2;
  for (let n = MIN_SEATS; n <= MAX_SEATS; n++) {
    const order = [...Array(n)].map((_, i) => i);
    const hands = new Map();
    for (const f of order) {
      const h = [];
      for (let k = 0; k < HAND_SIZE - 1; k++) {
        h.push({ card_id: f * 100 + k, suit: ["wands", "cups", "swords", "pentacles"][k % 4], rank: (k % 9) + 2, is_major: false });
      }
      h.push({ card_id: f * 100 + 99, rank: (f * 3) % 22, is_major: true });
      hands.set(f, h);
    }
    const out = playMelee(hands, order, "wands", ladder);
    assert.equal(out.length, n, `n=${n}: one outcome per seat`);
    assert.equal(out.filter((o) => o.tookFinalTrick).length, 1, `n=${n}: exactly one seat takes the final trick`);
    for (const o of out) assert.ok(o.counters >= 0 && o.meldsValue >= 0, `n=${n}: no negative score components`);
    // Counters are CONSERVED exactly: every counter dealt into the table is
    // harvested by somebody, and none are created. The final-trick ten is NOT in
    // here — the module adds it from `took_final_trick`, so a feeder that leaked
    // it in would show up as harvested > dealt.
    const dealt = [...hands.values()].flat().reduce((a, c) => a + Engine.counterValue(c), 0);
    const harvested = out.reduce((a, o) => a + o.counters, 0);
    assert.equal(harvested, dealt, `n=${n}: harvested ${harvested} counters from ${dealt} dealt`);
  }
  console.log("  ✓ 2, 3, 4, 5 and 6 seats all resolve · counters conserved · one final trick");
}

// ── 7. Seat order ───────────────────────────────────────────────────────────
console.log("▶ 7 · Seat order");
{
  const lon = new Array(10).fill(0);
  lon[4] = 300; lon[6] = 10; lon[2] = 150;
  assert.deepEqual(seatOrder([4, 6, 2], lon), [6, 2, 4], "seats run in ascending ecliptic longitude");
  assert.deepEqual(seatOrder([4, 6, 2], new Array(10).fill(0)), [2, 4, 6], "ties fall back to faction index");
  console.log("  ✓ ascending ecliptic longitude, deterministic on ties");
}

// ── 8. Astrological Combat Archetypes ───────────────────────────────────────
console.log("▶ 8 · Astrological combat archetypes");
{
  const ladder = {}; for (let i = 0; i <= 21; i++) ladder[i] = 50;
  // Mars (4): leads highest power card
  const marsHand = [
    { card_id: 1, suit: "wands", rank: 1, is_major: false },
    { card_id: 2, suit: "wands", rank: 5, is_major: false },
  ];
  const marsLead = archetypeMovePicker(4, marsHand, null, [], ladder, 1);
  assert.equal(marsLead.rank, 1, "Mars leads highest power card");

  // Saturn (6): hoards court cards and leads low probe early
  const saturnHand = [
    { card_id: 10, suit: "wands", rank: 14, is_major: false },
    { card_id: 11, suit: "wands", rank: 2, is_major: false },
  ];
  const saturnLeadEarly = archetypeMovePicker(6, saturnHand, null, [], ladder, 2);
  assert.equal(saturnLeadEarly.rank, 2, "Saturn hoards court card and leads low probe early");

  // Mercury (2): leads probe minor
  const mercHand = [
    { card_id: 20, suit: "wands", rank: 14, is_major: false },
    { card_id: 21, suit: "wands", rank: 3, is_major: false },
  ];
  const mercLead = archetypeMovePicker(2, mercHand, null, [], ladder, 1);
  assert.equal(mercLead.rank, 3, "Mercury leads low probe minor");

  console.log("  ✓ Mars aggression · Saturn hoarding · Mercury probes");
}

console.log("ALL War Table tests passed — against the real implementation.");
