import { describe, it, expect, beforeEach } from "bun:test";
import { WarLedger, getDecanInfo, PLANET_NAMES } from "../feeder/war-ledger";
import { unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";

const TEST_LEDGER_PATH = join(process.cwd(), "data", "test_war_round_ledger.json");

describe("WarLedger & 10-Day Decan Cycle Tracker", () => {
  beforeEach(() => {
    if (existsSync(TEST_LEDGER_PATH)) {
      try { unlinkSync(TEST_LEDGER_PATH); } catch {}
    }
  });

  it("calculates canonical Minor Tarot Card decan associations without frilly names", () => {
    // 0° Aries: Cardinal Fire -> 2 of Wands
    const aries1 = getDecanInfo(0);
    expect(aries1.card).toBe("2 of Wands");
    expect(aries1.rank).toBe(2);
    expect(aries1.suit).toBe("Wands");
    expect(aries1.startDeg).toBe(0);
    expect(aries1.endDeg).toBe(10);
    expect(aries1.rulerFaction).toBe(4); // Mars

    // 15° Leo: Fixed Fire -> 6 of Wands
    const leo2 = getDecanInfo(4 * 30 + 15);
    expect(leo2.card).toBe("6 of Wands");
    expect(leo2.rank).toBe(6);
    expect(leo2.suit).toBe("Wands");
    expect(leo2.startDeg).toBe(10);
    expect(leo2.endDeg).toBe(20);
    expect(leo2.degInDecan).toBe(5.0);

    // 25° Taurus: Fixed Earth -> 7 of Pentacles
    const taurus3 = getDecanInfo(1 * 30 + 25);
    expect(taurus3.card).toBe("7 of Pentacles");
    expect(taurus3.rank).toBe(7);
    expect(taurus3.suit).toBe("Pentacles");

    // 5° Gemini: Mutable Air -> 8 of Swords
    const gemini1 = getDecanInfo(2 * 30 + 5);
    expect(gemini1.card).toBe("8 of Swords");

    // 15° Cancer: Cardinal Water -> 3 of Cups
    const cancer2 = getDecanInfo(3 * 30 + 15);
    expect(cancer2.card).toBe("3 of Cups");
  });

  it("records rounds and credits winning faction points", () => {
    const ledger = new WarLedger(TEST_LEDGER_PATH);

    ledger.recordRound({
      roundId: 101,
      zoneId: 4,
      zoneName: "House 4",
      decanId: 0,
      card: "2 of Wands",
      rank: 2,
      suit: "Wands",
      sunDegree: 5.0,
      degInDecan: 5.0,
      winnerFaction: 0, // Sun
      winnerName: "Sun",
      winnerAgent: "Newton",
      winningScore: 180,
      controlDelta: 240,
      capturedZone: true
    });

    expect(ledger.state.roundResults.length).toBe(1);
    expect(ledger.state.roundResults[0].roundId).toBe(101);
    expect(ledger.state.roundResults[0].card).toBe("2 of Wands");
    // 180 base score + 50 capture bonus = 230
    expect(ledger.state.factionRoundPoints[0]).toBe(230);
  });

  it("detects 10° boundary crossing, archives Minor Tarot card, awards crown, and resets round scores", () => {
    const ledger = new WarLedger(TEST_LEDGER_PATH);

    // 1. Accumulate points during active decan (0°–10° Aries: 2 of Wands)
    ledger.recordRound({
      roundId: 1,
      zoneId: 0,
      zoneName: "House 0",
      decanId: 0,
      card: "2 of Wands",
      rank: 2,
      suit: "Wands",
      sunDegree: 8.0,
      degInDecan: 8.0,
      winnerFaction: 4, // Mars
      winnerName: "Mars",
      winnerAgent: "Ares",
      winningScore: 350,
      controlDelta: 200,
      capturedZone: false
    });

    expect(ledger.state.factionRoundPoints[4]).toBe(350);
    expect(ledger.state.decanHistory.length).toBe(0);

    // 2. Cross 10° decan boundary (10.5° Aries -> Decan 1: 3 of Wands)
    const crossed = ledger.checkDecanBoundary(10.5);
    expect(crossed).toBe(true);

    // 3. Verify concluded decan archived with Minor Tarot card
    expect(ledger.state.decanHistory.length).toBe(1);
    const archived = ledger.state.decanHistory[0];
    expect(archived.card).toBe("2 of Wands");
    expect(archived.winnerFaction).toBe(4);
    expect(archived.winnerName).toBe("Mars");
    expect(archived.winnerScore).toBe(350);

    // 4. Verify Decan Crown awarded to winner
    expect(ledger.state.decanVictories[4]).toBe(1);

    // 5. Verify round scores RESET to 0 for all factions
    expect(ledger.state.factionRoundPoints.every((pts) => pts === 0)).toBe(true);

    // 6. Verify summary returns clean payload
    const summary = ledger.getSummary(10.5);
    expect(summary.activeDecan.card).toBe("3 of Wands");
    expect(summary.decanVictories[4]).toBe(1);
    expect(summary.recentRounds.length).toBe(1);
  });

  it("syncs cleanly into client GameState representation", () => {
    const ledger = new WarLedger(TEST_LEDGER_PATH);
    ledger.recordRound({
      roundId: 55,
      zoneId: 2,
      zoneName: "House 2",
      decanId: 0,
      card: "2 of Wands",
      rank: 2,
      suit: "Wands",
      sunDegree: 3.0,
      degInDecan: 3.0,
      winnerFaction: 0,
      winnerName: "Sun",
      winnerAgent: "Newton",
      winningScore: 190,
      controlDelta: 220,
      capturedZone: false
    });

    const summary = ledger.getSummary(3.0);

    // Mock client GameState
    const clientMock = {
      factionRoundPoints: new Array(10).fill(0),
      decanVictories: new Array(10).fill(0),
      decanHistory: [] as any[],
      roundResults: [] as any[],
      currentDecanId: null as number | null,
      saved: false,
      recalculated: false,
      syncDecanLedger(payload: any) {
        if (!payload) return;
        if (Array.isArray(payload.factionRoundPoints)) this.factionRoundPoints = [...payload.factionRoundPoints];
        if (Array.isArray(payload.decanVictories)) this.decanVictories = [...payload.decanVictories];
        if (Array.isArray(payload.decanHistory)) this.decanHistory = [...payload.decanHistory];
        if (Array.isArray(payload.recentRounds)) this.roundResults = [...payload.recentRounds];
        if (payload.activeDecan) this.currentDecanId = payload.activeDecan.absDecan;
        this.recalculated = true;
        this.saved = true;
      }
    };

    clientMock.syncDecanLedger(summary);
    expect(clientMock.factionRoundPoints[0]).toBe(190);
    expect(clientMock.roundResults.length).toBe(1);
    expect(clientMock.currentDecanId).toBe(0);
    expect(clientMock.recalculated).toBe(true);
    expect(clientMock.saved).toBe(true);
  });
});
