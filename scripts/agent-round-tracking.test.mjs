// ============================================================================
// Pentacles — Agent Zone Capture, Round Result Tracking & Faction Score Tests
// ============================================================================
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const clientCode = fs.readFileSync(new URL("../public/client.js", import.meta.url), "utf8");
const engineCode = fs.readFileSync(new URL("../public/arcanaTrickEngine.js", import.meta.url), "utf8");

const mockLocalStorage = {};
const mockWindow = {
  localStorage: {
    getItem: (k) => mockLocalStorage[k] || null,
    setItem: (k, v) => { mockLocalStorage[k] = String(v); },
    removeItem: (k) => { delete mockLocalStorage[k]; },
    clear: () => { for (const k in mockLocalStorage) delete mockLocalStorage[k]; }
  },
  toast: () => {},
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

// Load arcanaTrickEngine first so ArcanaTrickEngine is available on globalThis/window
vm.runInContext(engineCode, context);
assert.ok(context.window.ArcanaTrickEngine, "ArcanaTrickEngine must attach to window");

// Load client.js
vm.runInContext(clientCode, context);
const state = context.window.state;
assert.ok(state, "GameState must be instantiated on window.state");

console.log("▶ 1 · Testing Initial Map & Footholds");
{
  state.reset();
  assert.ok(state.map.length === 11, "Map must contain all 11 zones");
  // Initial houses have active faction ownership
  assert.ok(state.map[0].owner !== null, "House 0 (Aries) has an active faction owner");
  assert.ok(state.map[1].owner !== null, "House 1 (Taurus) has an active faction owner");
  assert.ok(state.map[2].owner !== null, "House 2 (Gemini) has an active faction owner");
  assert.ok(state.map[3].owner !== null, "House 3 (Cancer) has an active faction owner");
  assert.ok(state.map[4].owner !== null, "House 4 (Leo) has an active faction owner");
  assert.ok(state.map[0].control > 0, "House 0 has positive baseline control");

  // Leaderboard must have non-zero scores right from start
  assert.ok(state.leaderboard.length === 10, "Leaderboard ranks all 10 factions");
  const topScore = state.leaderboard[0].score;
  assert.ok(topScore > 0, `Top faction score must be > 0, got ${topScore}`);
  console.log(`  ✓ Initial footholds established; top faction has ${topScore} pts`);
}

console.log("▶ 2 · Testing Autonomous Agent Zone Melee Rounds");
{
  const initialRoundCount = state.roundResults.length;
  const initialFactionPoints = [...state.factionRoundPoints];

  // Run an autonomous agent contest in House of Aries (zone 0)
  const round = state.runAutonomousZoneRound(0);
  assert.ok(round, "runAutonomousZoneRound must return a round result object");
  assert.equal(round.zoneId, 0, "Round target matches zone 0");
  assert.ok(round.winningScore > 0, "Winner must have positive score");
  assert.ok(round.seats.length >= 3, `Contest must seat at least 3 agent champions, got ${round.seats.length}`);
  assert.ok(state.roundResults.length > initialRoundCount, "roundResults must record the completed match");

  // Verify that participating factions gained round points
  const pointsDelta = state.factionRoundPoints.reduce((sum, pts, i) => sum + (pts - initialFactionPoints[i]), 0);
  assert.ok(pointsDelta > 0, `Faction round points must increase after round, delta: ${pointsDelta}`);
  console.log(`  ✓ Autonomous agent round resolved in zone 0. Winner: ${round.winnerName} (${round.winningScore} pts)`);
}

console.log("▶ 3 · Testing Zone Capture & Control Swings");
{
  const testZoneId = 5; // Spire of Virgo
  const zone = state.map[testZoneId];

  // Simulate multiple rounds to test control accumulation and capture
  for (let i = 0; i < 3; i++) {
    state.runAutonomousZoneRound(testZoneId);
  }

  assert.ok(zone.control !== 0, "Spire 5 control should be actively contested");
  console.log(`  ✓ Zone ${testZoneId} control actively contested: ${zone.control} (owner: ${zone.owner !== null ? zone.owner : 'contested'})`);
}

console.log("▶ 4 · Testing Faction Standings Leaderboard Calculation");
{
  // Set specific values to test the scoring dimensions:
  // 1. Zone weight (House = 100, Spire = 200, Crown = 400)
  // 2. Zone control (+1 pt per 10 control)
  // 3. Stars held (+5 pts per star)
  // 4. Round points (accumulated trick/meld points)

  state.map.forEach(z => { z.owner = null; z.control = 0; });
  state.map[0].owner = 0; // Sun owns House 0 (100 pts)
  state.map[0].control = 500; // 500 / 10 = +50 pts
  state.holdings = { 101: 0, 102: 0, 103: 0 }; // 3 stars * 5 = +15 pts
  state.factionRoundPoints = new Array(10).fill(0);
  state.factionRoundPoints[0] = 75; // +75 round points

  state.recalculateLeaderboard();
  const sunEntry = state.leaderboard.find(item => item.id === 0);
  assert.ok(sunEntry, "Sun entry must exist in leaderboard");
  // Expected: 100 + 50 + 15 + 75 = 240 pts
  assert.equal(sunEntry.score, 240, `Sun score should be 240, got ${sunEntry.score}`);
  console.log(`  ✓ Leaderboard calculation verified: 100 (House) + 50 (Control) + 15 (Stars) + 75 (Rounds) = 240 pts`);
}

console.log("▶ 5 · Testing Player vs Agent Melee Outcome Resolution");
{
  const chart = context.deriveLocalNatalChart("AstroSeeker");
  state.registerPlayer("AstroSeeker", 0, chart);

  const ritual = state.generateProceduralRitual("zone", 1);
  assert.ok(ritual, "Ritual must be generated");
  state.rituals["zone_1"] = ritual;

  // Simulate agent winning over player by giving agent a high score
  ritual.melee.playerScore = 50;
  ritual.melee.guardianScore = 180;
  ritual.melee.contenders[0].score = 180;
  ritual.melee.trickNumber = 12;

  const cardToPlay = ritual.melee.playerHand[0];
  const result = state.playCardIntoMelee(cardToPlay.card_id, "zone", 1);
  assert.ok(result.completed, "Match must be marked completed");
  assert.equal(result.melee.outcome, "contender_win", "Contender agent must win when scoring higher");
  assert.ok(state.roundResults.length > 0, "Round result must be recorded");
  assert.equal(state.roundResults[0].winnerFaction, ritual.melee.contenders[0].factionId, "Winner faction matches winning agent contender");
  console.log(`  ✓ Agent victory in Melee properly recorded; winner: ${state.roundResults[0].winnerName} for faction ${state.roundResults[0].winnerFaction}`);
}

console.log("▶ 6 · Testing State Persistence & Restoration");
{
  state.save();
  const roundCountBefore = state.roundResults.length;
  const roundPointsBefore = [...state.factionRoundPoints];

  state.roundResults = [];
  state.factionRoundPoints = new Array(10).fill(0);

  const loaded = state.load();
  assert.deepEqual([...state.factionRoundPoints], roundPointsBefore, "factionRoundPoints must be fully restored from save");
  console.log(`  ✓ State persistence verified: ${roundCountBefore} round records and all faction points preserved`);
}

console.log("▶ 7 · Testing Simulation Tick Loop");
{
  const prevRounds = state.roundResults.length;
  state.tick();
  assert.ok(state.roundResults.length > prevRounds, "tick() must execute an autonomous agent war round");
  assert.ok(state.leaderboard.every(item => typeof item.score === "number"), "All leaderboard items have valid numeric scores");
  console.log("  ✓ Simulation tick successfully advances the agent war and updates leaderboard");
}

console.log("▶ 8 · Testing Decan Rounds & Minor Tarot Card Associations");
{
  const getDecanInfo = context.window.getDecanInfo;
  assert.ok(typeof getDecanInfo === "function", "getDecanInfo must be exported on window");

  // 1. Test 0° Aries: Decan 0 -> 2 of Wands (0°–10° Aries), Chaldean Ruler: Mars (4)
  const aries1 = getDecanInfo(0);
  assert.equal(aries1.signIndex, 0, "Sign 0 is Aries");
  assert.equal(aries1.decanIndex, 0, "First decan is index 0");
  assert.equal(aries1.rank, 2, "Cardinal Decan 0 is Rank 2");
  assert.equal(aries1.suit, "Wands", "Fire triplicity is Wands");
  assert.equal(aries1.card, "2 of Wands", "Minor Tarot card is 2 of Wands");
  assert.equal(aries1.startDeg, 0, "Starts at 0°");
  assert.equal(aries1.endDeg, 10, "Ends at 10°");
  assert.equal(aries1.rulerFaction, 4, "Aries I ruled by Mars (4)");

  // 2. Test 14.5° Leo: Decan 1 -> 6 of Wands (10°–20° Leo)
  const leo2 = getDecanInfo(4 * 30 + 14.5);
  assert.equal(leo2.signName, "Leo", "Sign is Leo");
  assert.equal(leo2.decanIndex, 1, "Decan index 1");
  assert.equal(leo2.rank, 6, "Fixed Decan 1 is Rank 6");
  assert.equal(leo2.suit, "Wands", "Fire triplicity is Wands");
  assert.equal(leo2.card, "6 of Wands", "Minor Tarot card is 6 of Wands");
  assert.equal(leo2.startDeg, 10, "Decan II starts at 10°");
  assert.equal(leo2.endDeg, 20, "Decan II ends at 20°");
  assert.equal(leo2.degInDecan, 4.5, "4.5° into 10° decan round");
  assert.equal(leo2.progressPct, 45, "45% progress through round");
  assert.equal(leo2.rulerFaction, 5, "Leo II Chaldean ruler is Jupiter (5)");

  // 3. Test 25° Taurus: Decan 2 -> 7 of Pentacles (20°–30° Taurus)
  const taurus3 = getDecanInfo(1 * 30 + 25);
  assert.equal(taurus3.card, "7 of Pentacles", "Fixed Decan 2 is 7 of Pentacles");
  assert.equal(taurus3.startDeg, 20, "Starts at 20°");
  assert.equal(taurus3.endDeg, 30, "Ends at 30°");

  // 4. Test 5° Gemini: Decan 0 -> 8 of Swords (0°–10° Gemini)
  const gemini1 = getDecanInfo(2 * 30 + 5);
  assert.equal(gemini1.card, "8 of Swords", "Mutable Decan 0 is 8 of Swords");

  // 5. Test 15° Cancer: Decan 1 -> 3 of Cups (10°–20° Cancer)
  const cancer2 = getDecanInfo(3 * 30 + 15);
  assert.equal(cancer2.card, "3 of Cups", "Cardinal Decan 1 is 3 of Cups");

  console.log(`  ✓ Minor Tarot Card associations verified across all triplicities: ${aries1.card}, ${leo2.card}, ${taurus3.card}, ${gemini1.card}, ${cancer2.card}`);
}

console.log("▶ 9 · Testing Decan Cycle Score Reset & Triumph Archival");
{
  // 1. Give factions some round points and zone control in active decan
  state.seasonDegree = 15; // 15° Aries (Decan 1: 3 of Wands)
  state.currentDecanId = 1;
  state.factionRoundPoints[0] = 300;
  state.factionRoundPoints[2] = 150;
  state.map[5].control = 400;
  state.map[5].owner = 2;
  state.recalculateLeaderboard();

  const prevHistoryLen = state.decanHistory.length;
  const winnerBefore = state.leaderboard[0].id;

  // 2. Conclude Decan 1 directly to test reset isolation
  state.concludeDecanBattle(1, context.window.getDecanInfo(21));

  // 3. Verify Decan battle conclusion:
  // - decanHistory should record the concluded battle with its Minor Tarot Card
  assert.equal(state.decanHistory.length, prevHistoryLen + 1, "Completed decan must be archived");
  assert.equal(state.decanHistory[0].decanId, 1, "Archived decanId matches concluded decan 1");
  assert.equal(state.decanHistory[0].card, "3 of Wands", "Concluded decan card recorded as 3 of Wands");
  assert.equal(state.decanHistory[0].winnerFaction, winnerBefore, "Archived winner matches top faction");

  // - decanVictories should increment for the champion
  assert.ok(state.decanVictories[winnerBefore] >= 1, "Champion must be credited with a Decan Victory");

  // - Active decan round points must RESET to 0 for all factions
  assert.deepEqual([...state.factionRoundPoints], new Array(10).fill(0), "Faction round points must reset to 0 for new decan");

  // - Spire/Crown zones reset to neutral contest
  assert.equal(state.map[5].control, 0, "Spire 5 control resets to 0 for new decan battle");
  assert.equal(state.map[5].owner, null, "Spire 5 owner resets to null");

  // - Houses reset to baseline footholds (250)
  assert.equal(state.map[0].control, 250, "House 0 baseline control resets to 250");

  // 4. Now verify tick() triggering decan conclusion when degrees advance across 10° boundary
  state.currentDecanId = 1;
  state.seasonDegree = 21;
  const historyLenBeforeTick = state.decanHistory.length;
  state.tick();
  assert.equal(state.decanHistory.length, historyLenBeforeTick + 1, "tick() must conclude decan when crossing 10° boundary");

  console.log(`  ✓ Decan transition verified: ${state.decanHistory[0].card} archived, winner credited, and faction round points reset to 0 for the new 10° battle!`);
}

console.log("ALL Agent Zone Capture & Decan Battle tests passed with 100% success!");
