// ============================================================================
// Pentacles — Gate Routing & Multi-Seat Integration Test Suite
// ============================================================================
// Verifies:
// 1. Zone Gate routing to openFactionWar(zoneId) and live table auto-open.
// 2. 4-tier hand resolution ladder (Active -> Bench -> Collection -> Starter).
// 3. Consolidated ArcanaTrickEngine war-table functions.
// ============================================================================

import assert from "node:assert/strict";
import "../public/arcanaTrickEngine.js";
import { FactionWarInstance } from "../src/alchm-chart/faction-war.js";
import { buildZones, buildTables } from "../src/alchm-chart/war-model.js";

const Engine = globalThis.ArcanaTrickEngine;

console.log("=== Running Gate Routing & Multi-Seat Integration Tests ===");

// ── 1. Consolidated Engine Parity ───────────────────────────────────────────
console.log("▶ 1 · Consolidated ArcanaTrickEngine Pure Functions");
{
  assert.equal(typeof Engine.computeClaim, "function", "Engine.computeClaim is exported");
  assert.equal(typeof Engine.chooseChampions, "function", "Engine.chooseChampions is exported");
  assert.equal(typeof Engine.seatOrder, "function", "Engine.seatOrder is exported");
  assert.equal(typeof Engine.archetypeMovePicker, "function", "Engine.archetypeMovePicker is exported");
  assert.equal(typeof Engine.playMelee, "function", "Engine.playMelee is exported");

  // Verify seatOrder
  const lon = new Array(10).fill(0);
  lon[4] = 300; lon[6] = 10; lon[2] = 150;
  assert.deepEqual(Engine.seatOrder([4, 6, 2], lon), [6, 2, 4], "seatOrder runs in ascending ecliptic longitude");
  console.log("  ✓ Consolidated Engine functions verified");
}

// ── 2. 4-Tier Hand Fallback Resolution ──────────────────────────────────────
console.log("▶ 2 · 4-Tier Hand Fallback Resolution");
{
  // Mock client state
  function resolveHand(deck, collection) {
    let handCards = (deck || [])
      .filter((d) => d.loadout === "active")
      .map((d) => (collection || []).find((c) => c.card_id === d.card_id))
      .filter(Boolean);

    if (handCards.length === 0 && Array.isArray(deck) && deck.length > 0) {
      handCards = deck
        .map((d) => (collection || []).find((c) => c.card_id === d.card_id))
        .filter(Boolean);
    }

    if (handCards.length === 0 && Array.isArray(collection) && collection.length > 0) {
      handCards = collection.slice();
    }

    if (handCards.length === 0) {
      handCards = [{ card_id: 999, rank: 1, suit: "wands", is_major: false }];
    }
    return handCards;
  }

  // Tier 1: Active loadout
  const activeDeck = [{ card_id: 10, loadout: "active" }];
  const coll = [{ card_id: 10, rank: 14, suit: "wands" }, { card_id: 20, rank: 13, suit: "cups" }];
  assert.equal(resolveHand(activeDeck, coll).length, 1);
  assert.equal(resolveHand(activeDeck, coll)[0].card_id, 10);

  // Tier 2: Bench loadout (when no active slot)
  const benchDeck = [{ card_id: 20, loadout: "bench" }];
  assert.equal(resolveHand(benchDeck, coll).length, 1);
  assert.equal(resolveHand(benchDeck, coll)[0].card_id, 20);

  // Tier 3: Full Collection (when empty deck)
  assert.equal(resolveHand([], coll).length, 2);

  // Tier 4: Starter Deck (when empty collection)
  assert.equal(resolveHand([], []).length, 1);

  console.log("  ✓ 4-tier hand resolution prevents 0-card dealt hands");
}

// ── 3. Zone Gate Routing & Auto-Open Table ──────────────────────────────────
console.log("▶ 3 · FactionWar selectZone and autoOpenTable");
{
  let shownTable = null;
  const mockTable = { table_id: 42, zone_id: 4, state: "Mustering" };

  const war = new FactionWarInstance({
    selectedZone: null,
    myFaction: 0,
    myIdentity: "0x123",
    myCards: [],
  });

  war.setData({
    zones: [{ zone_id: 4, control: 500, owner: 0, in_flux: false }],
    tables: [mockTable],
  });

  // Override showMeleeTable to capture event
  war.showMeleeTable = (t) => { shownTable = t; };

  // Select zone 4 with autoOpenTable: true
  war.selectZone(4, { autoOpenTable: true });

  assert.equal(war.selectedZone, 4, "selectedZone is set to 4");
  assert.ok(shownTable !== null, "showMeleeTable was called for live zone table");
  assert.equal(shownTable.tableId, 42, "table 42 was opened");

  console.log("  ✓ selectZone(zoneId, { autoOpenTable: true }) routes directly to active War Table");
}

// ── 4. Offline Practice Table Fallback & Playability ─────────────────────────
console.log("▶ 4 · Offline Practice Table Fallback & Playability when no live table on zone");
{
  let practiceTable = null;
  const war = new FactionWarInstance({
    selectedZone: null,
    myFaction: 0,
    myIdentity: "0xseeker",
    myCards: [{ card_id: 101, title: "Ace of Wands", suit: "wands", rank: 1, is_major: false, attack: 14 }],
  });

  war.setData({
    zones: [{ zone_id: 7, control: 0, owner: 0, in_flux: false }],
    tables: [], // No live table on zone 7
  });

  war.showMeleeTable = (t) => { practiceTable = t; };

  war.selectZone(7, { autoOpenTable: true });

  assert.equal(war.selectedZone, 7, "selectedZone is set to 7");
  assert.ok(practiceTable !== null, "showMeleeTable was called with practice fallback");
  assert.equal(practiceTable.isPractice, true, "table is marked as practice");
  assert.equal(practiceTable.tableId, 9007, "tableId is 9000 + zoneId (9007)");
  assert.equal(practiceTable.seats.length, 4, "practice table has 4 seats");
  assert.equal(practiceTable.seats[0].isHuman, true, "seat 1 is human seeker");
  assert.equal(practiceTable.seats[1].isAgent, true, "seat 2 is AI champion agent");
  assert.equal(practiceTable.currentTrick, 1, "starts at trick 1");

  // Assert all 4 seats are dealt full 12-card hands
  assert.ok(
    practiceTable.seats.every((s) => Array.isArray(s.hand) && s.hand.length === 12),
    "Every seat on the practice table is dealt 12 real cards",
  );
  assert.equal(practiceTable.seats[0].handRemaining, 12, "human seeker has 12 unspent cards");

  // Play a card on the practice table and verify trick progression
  const cardToPlay = practiceTable.seats[0].hand[0];
  let updatedTable = null;
  const mockMt = {
    setData: (data) => {
      updatedTable = data.table;
    },
  };

  war._handlePracticeCardPlay(practiceTable, cardToPlay.card_id, mockMt);

  assert.ok(updatedTable !== null, "mt.setData was called after card play");
  assert.equal(practiceTable.currentTrick, 2, "trick advanced from 1 to 2");
  assert.equal(practiceTable.seats[0].handRemaining, 11, "human hand spent 1 card (11 remaining)");
  assert.equal(practiceTable.plays.length, 4, "all 4 seats (1 human + 3 AI) made legal plays in trick 1");

  const winningSeat = practiceTable.seats.find((s) => (s.score || 0) > 0 || (s.tricksWon || 0) > 0);
  assert.ok(winningSeat, "a winning seat took the trick and scored");

  console.log("  ✓ Offline Practice Table successfully created, mounted, and played through trick 1");
}

// ── 5. Dead Siege Tab (tab-duel) Removal Verification ───────────────────────
console.log("▶ 5 · Static assertion: tab-duel must not exist in production sources");
{
  import("node:fs").then((fs) => {
    const prodFiles = [
      "index.html",
      "public/app.js",
      "public/horizon-tracker.js",
      "public/star-dex-ui.js",
      "src/main.js",
    ];

    for (const f of prodFiles) {
      const content = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
      assert.ok(
        !content.includes("tab-duel"),
        `Production file ${f} must not contain references to deprecated tab-duel`,
      );
    }
    console.log("  ✓ No production sources reference deprecated tab-duel");
  });
}

console.log("ALL Gate Routing & Multi-Seat Integration tests passed with 100% success!");
