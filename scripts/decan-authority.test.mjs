// ============================================================================
// Pentacles — Decan Authority Tests
// ============================================================================
// The active decan battle follows the local Sun alone. A stalled server ledger
// reporting an older decan must not flip it back and forth (which used to wipe
// zone control and faction points every sync), a forward crossing concludes
// exactly once, and a backwards reading never moves the decan.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const clientCode = fs.readFileSync(new URL("../public/client.js", import.meta.url), "utf8");
const engineCode = fs.readFileSync(new URL("../public/arcanaTrickEngine.js", import.meta.url), "utf8");

const mockLocalStorage = {};
const toasts = [];
const mockWindow = {
  localStorage: {
    getItem: (k) => mockLocalStorage[k] || null,
    setItem: (k, v) => { mockLocalStorage[k] = String(v); },
    removeItem: (k) => { delete mockLocalStorage[k]; },
    clear: () => { for (const k in mockLocalStorage) delete mockLocalStorage[k]; }
  },
  toast: (message, opts = {}) => { toasts.push({ message, title: opts.title }); },
  CookieSync: { persistAll: () => {}, persist: () => {} },
  renderLeaderboard: () => {},
  renderZonesList: () => {}
};

const context = vm.createContext({
  window: mockWindow,
  localStorage: mockWindow.localStorage,
  globalThis: mockWindow,
  console,
  Math,
  Date,
  Array,
  Object,
  Set,
  Map,
  Number,
  String,
  parseInt,
  parseFloat,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
});

vm.runInContext(engineCode, context);
vm.runInContext(clientCode, context);
const state = context.window.state;
const getDecanInfo = context.window.getDecanInfo;
assert.ok(state, "GameState must be instantiated on window.state");

// The VM has no star catalogue, so recomputeSky() leaves planets alone and the
// test can place the Sun wherever it needs.
const setSun = (eclLon) => { state.planets = [{ eclLon }]; };
const resetToasts = () => toasts.splice(0, toasts.length);
const decanResets = () => toasts.filter((t) => t.title === "Decan Round Reset").length;

function freshState() {
  state.reset();
  state.planets = [];
  state.currentDecanId = null;
  state.decanHistory = [];
  state.decanVictories = new Array(10).fill(0);
  state.factionRoundPoints = new Array(10).fill(0);
  resetToasts();
}

// Mirrors the stalled Railway ledger observed on 2026-09-13.
function staleLedger(overrides = {}) {
  return {
    success: true,
    activeDecan: getDecanInfo(169.04), // 19° Virgo → decan 16
    factionRoundPoints: [152416, 155846, 156819, 134130, 312096, 23746, 59763, 12654, 7120, 3965],
    decanVictories: new Array(10).fill(0),
    recentRounds: [{ roundId: 1683, zoneId: 7, decanId: 16, winnerFaction: 5, winningScore: 80 }],
    ...overrides,
  };
}

console.log("▶ 1 · A stale server ledger never concludes or moves the decan");
{
  freshState();
  setSun(171.17); // 21° Virgo → decan 17
  state.tick();
  assert.equal(state.currentDecanId, 17, "first ephemeris tick adopts the Sun's decan without concluding");
  assert.equal(state.decanHistory.length, 0);

  for (let i = 0; i < 5; i++) {
    // tick() plays autonomous zone rounds, so local points move between syncs;
    // the sync itself must leave them exactly as they were.
    const before = [...state.factionRoundPoints];
    state.syncDecanLedger(staleLedger());
    assert.equal(state.currentDecanId, 17, `ledger sync ${i + 1} must not set the decan`);
    assert.deepEqual([...state.factionRoundPoints], before, `ledger sync ${i + 1} must ignore stale round points`);
    assert.equal(state.roundResults[0].roundId, 1683, "ledger rounds still merge");
    state.tick();
  }
  assert.equal(state.decanHistory.length, 0, "no decan battle concludes while the ledger is stale");
  assert.equal(decanResets(), 0, "no 'Decan Round Reset' toast fires");

  state.syncDecanLedger(staleLedger({ activeDecan: getDecanInfo(171.5) }));
  assert.equal(state.factionRoundPoints[4], 312096, "points apply once the ledger scores the same decan");
  assert.equal(state.currentDecanId, 17);

  // With no ephemeris and no active decan yet there is nothing to verify against.
  freshState();
  state.syncDecanLedger(staleLedger());
  assert.equal(state.currentDecanId, null, "ledger sync before the ephemeris leaves the decan unset");
  assert.deepEqual([...state.factionRoundPoints], new Array(10).fill(0), "unverifiable ledger points are not applied");
  console.log("  ✓ stale ledger ignored across 5 sync/tick cycles");
}

console.log("▶ 2 · A forward crossing concludes exactly once");
{
  freshState();
  setSun(179.9); // 29.9° Virgo → decan 17
  state.tick();
  assert.equal(state.currentDecanId, 17);

  state.factionRoundPoints[2] = 500;
  setSun(180.1); // 0.1° Libra → decan 18
  for (let i = 0; i < 4; i++) state.tick();
  assert.equal(state.decanHistory.length, 1, "crossing 180° concludes one battle");
  assert.equal(state.decanHistory[0].decanId, 17);
  assert.equal(state.currentDecanId, 18);
  assert.equal(decanResets(), 1, "exactly one reset toast");

  // Wrap: 29.5° Pisces (decan 35) → 0.5° Aries (decan 0).
  freshState();
  setSun(359.5);
  state.tick();
  assert.equal(state.currentDecanId, 35);
  setSun(0.5);
  state.tick();
  state.tick();
  assert.equal(state.decanHistory.length, 1, "35 → 0 wraps as a forward crossing");
  assert.equal(state.decanHistory[0].decanId, 35);
  assert.equal(state.currentDecanId, 0);
  console.log("  ✓ single conclusion on 17 → 18 and 35 → 0");
}

console.log("▶ 3 · A backwards reading is ignored");
{
  freshState();
  setSun(171.17); // decan 17
  state.tick();
  setSun(165.0); // 15° Virgo → decan 16
  state.tick();
  assert.equal(state.currentDecanId, 17, "the decan never moves backwards");
  assert.equal(state.decanHistory.length, 0, "a backwards reading concludes nothing");

  setSun(171.17);
  state.tick();
  assert.equal(state.decanHistory.length, 0, "returning to the active decan concludes nothing");
  assert.equal(decanResets(), 0);
  console.log("  ✓ 17 held against a decan-16 reading");
}

console.log("▶ 4 · The seasonDegree fallback never concludes a battle");
{
  freshState();
  state.currentDecanId = 1;
  state.seasonDegree = 21; // would read as decan 2 through the fallback
  for (let i = 0; i < 12; i++) state.tick();
  assert.equal(state.currentDecanId, 1, "no ephemeris → the active decan is untouched");
  assert.equal(state.decanHistory.length, 0);

  freshState();
  state.seasonDegree = 100;
  state.tick();
  assert.equal(state.currentDecanId, null, "the fallback clock never initialises the decan");
  assert.equal(state.getCurrentDecan().absDecan, getDecanInfo(state.seasonDegree).absDecan,
    "getCurrentDecan still falls back for display");
  console.log("  ✓ seasonDegree drives display only");
}

console.log("▶ 5 · A multi-decan jump catches up without concluding");
{
  freshState();
  state.currentDecanId = 14; // e.g. a save from three decans ago
  setSun(171.17); // decan 17
  state.tick();
  assert.equal(state.currentDecanId, 17, "a returning player catches up to the Sun");
  assert.equal(state.decanHistory.length, 0, "skipped battles are not concluded retroactively");
  console.log("  ✓ 14 → 17 resynced silently");
}

console.log("ALL Decan Authority tests passed with 100% success!");
