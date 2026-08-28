import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { categoricalChartAnalytics, signVector, elementalDistribution, modalityDistribution, polarityDistribution } from "../src/alchm-chart/sign-character.js";
import { agentDeck } from "../src/alchm-chart/deck.js";

// Load client.js in a mock browser environment
const clientCode = fs.readFileSync(new URL("../public/client.js", import.meta.url), "utf8");

const mockLocalStorage = {};
const mockWindow = {
  localStorage: {
    getItem: (k) => mockLocalStorage[k] || null,
    setItem: (k, v) => { mockLocalStorage[k] = String(v); },
    removeItem: (k) => { delete mockLocalStorage[k]; },
    clear: () => { for (const k in mockLocalStorage) delete mockLocalStorage[k]; }
  },
  toast: () => {},
  CookieSync: { persistAll: () => {}, persist: () => {} }
};

const context = vm.createContext({
  window: mockWindow,
  localStorage: mockWindow.localStorage,
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

vm.runInContext(clientCode, context);

const state = context.window.state;
assert.ok(state, "GameState should be instantiated on window.state");

// Test 1: Fresh Player Registration Mints Complete 25+ Card Starter Deck
state.reset();
const testChart = context.deriveLocalNatalChart("1998-05-14 14:30 New York, US");
state.registerPlayer("AstroSeeker", 0, testChart);

assert.ok(state.player, "Player must be created");
assert.equal(state.player.handle, "AstroSeeker");
assert.ok(state.collection.length >= 25, `Starter deck should have at least 25 cards, got ${state.collection.length}`);
assert.ok(state.deck.length >= 25, `Deck slots should match collection, got ${state.deck.length}`);

// Verify Active Loadout
const activeSlots = state.deck.filter(d => d.loadout === "active");
assert.ok(activeSlots.length >= 8, `At least 8 cards should be in active loadout, got ${activeSlots.length}`);

// Test 2: Lunar Nodes Card Verification
const nnMinor = state.collection.find(c => c.title && c.title.includes("North Node"));
const nnMajor = state.collection.find(c => c.title && c.title.includes("Caput Draconis"));
const snMinor = state.collection.find(c => c.title && c.title.includes("South Node"));
const snMajor = state.collection.find(c => c.title && c.title.includes("Cauda Draconis"));

assert.ok(nnMinor, "North Node Minor card must be in collection");
assert.ok(nnMajor, "North Node Major card (The Star) must be in collection");
assert.ok(snMinor, "South Node Minor card must be in collection");
assert.ok(snMajor, "South Node Major card (The Moon) must be in collection");

// Test 3: AgentDeck Generator Expansion (25+ Cards)
const placements = testChart.placements.map(p => ({
  body: p.body,
  sign: p.sign,
  arcMin: p.arc_minutes,
  retrograde: p.retrograde,
  dignity: p.dignity
}));
const aDeck = agentDeck(placements, testChart.ascendant, testChart.midheaven, testChart.north_node);
assert.ok(aDeck.length >= 25, `agentDeck should generate at least 25 cards, got ${aDeck.length}`);
assert.ok(aDeck.some(c => c.role === "north node"), "agentDeck must include North Node card");
assert.ok(aDeck.some(c => c.role === "south node"), "agentDeck must include South Node card");

// Test 4: Categorical Chart Analytics
const analytics = categoricalChartAnalytics(placements, testChart.ascendant, testChart.midheaven, true);
assert.ok(analytics.elements.fire >= 0 && analytics.elements.fire <= 100, "Fire element valid %");
assert.ok(analytics.modalities.cardinal >= 0 && analytics.modalities.cardinal <= 100, "Cardinal modality valid %");
assert.ok(analytics.polarities.yang >= 0 && analytics.polarities.yang <= 100, "Yang polarity valid %");
assert.ok(analytics.lunarNodes.northNode, "North Node analytics present");
assert.ok(analytics.lunarNodes.southNode, "South Node analytics present");
assert.equal((analytics.lunarNodes.northNode.sign + 6) % 12, analytics.lunarNodes.southNode.sign, "South node is 180° opposite North node");

// Test 5: Self-Healing on Load
// Corrupt the save by having only 20 cards
mockLocalStorage[`pentacles_save_${state.player.handle}`] = JSON.stringify({
  player: state.player,
  collection: state.collection.slice(0, 15),
  deck: state.deck.slice(0, 15),
  map: state.map,
  leaderboard: state.leaderboard
});
mockLocalStorage["pentacles_active_profile"] = state.player.handle;

state.collection = [];
state.deck = [];
const loaded = state.load();

assert.ok(loaded, "Load must succeed");
assert.ok(state.collection.length >= 25, `Collection must be healed to at least 25 cards, got ${state.collection.length}`);
assert.ok(state.deck.length >= 25, `Deck must be healed to at least 25 cards, got ${state.deck.length}`);

console.log("PASS all starter deck, Lunar nodes, 25-card expansion, and categorical analytics tests!");
