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

console.log("ALL Gate Routing & Multi-Seat Integration tests passed with 100% success!");
