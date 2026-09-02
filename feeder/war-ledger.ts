// Pentacles — Server-Side War Round Ledger & 10-Day Decan Cycle Tracker.
//
// Maintains the authoritative ledger of agent zone battles, assigns round points
// to factions, and regulates the 10-day decan rounds (10° of solar transit).
// When the Sun crosses a 10° boundary, crowns the champion of that Minor Tarot Card,
// archives the triumph to decan history, and resets round scores to 0.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
export const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
export const SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
export const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];

// Minor Tarot Card Decan Association (Golden Dawn 10-day Egyptian Decades)
// Suit by triplicity (sign % 4): Fire = Wands, Earth = Pentacles, Air = Swords, Water = Cups
export const DECAN_SUITS = ["Wands", "Pentacles", "Swords", "Cups"];
// Chaldean sub-rulers: Mars (4), Sun (0), Venus (3), Mercury (2), Moon (1), Saturn (6), Jupiter (5)
export const DECAN_CHALDEAN_RULERS = [4, 0, 3, 2, 1, 6, 5];

export interface DecanInfo {
  absDecan: number;
  signIndex: number;
  signName: string;
  signGlyph: string;
  decanIndex: number;
  rank: number;
  suit: string;
  card: string;
  startDeg: number;
  endDeg: number;
  degInSign: number;
  degInDecan: number;
  progressPct: number;
  rulerFaction: number;
  rulerName: string;
  rulerGlyph: string;
  label: string;
}

export function getDecanInfo(seasonDegree: number): DecanInfo {
  const totalDeg = ((Number(seasonDegree) % 360) + 360) % 360;
  const signIndex = Math.floor(totalDeg / 30) % 12;
  const degInSign = totalDeg % 30;
  const decanIndex = Math.min(2, Math.floor(degInSign / 10));
  const absDecan = signIndex * 3 + decanIndex;

  const suit = DECAN_SUITS[signIndex % 4];
  const isCardinal = [0, 3, 6, 9].includes(signIndex);
  const isFixed = [1, 4, 7, 10].includes(signIndex);
  const baseRank = isCardinal ? 2 : (isFixed ? 5 : 8);
  const rank = baseRank + decanIndex;
  const card = `${rank} of ${suit}`;
  const rulerFaction = DECAN_CHALDEAN_RULERS[absDecan % 7];

  const startDeg = decanIndex * 10;
  const endDeg = (decanIndex + 1) * 10;
  const degInDecan = degInSign - startDeg;
  const progressPct = Math.min(100, Math.max(0, (degInDecan / 10) * 100));

  return {
    absDecan,
    signIndex,
    signName: SIGN_NAMES[signIndex],
    signGlyph: SIGN_GLYPHS[signIndex],
    decanIndex,
    rank,
    suit,
    card,
    startDeg,
    endDeg,
    degInSign: Number(degInSign.toFixed(1)),
    degInDecan: Number(degInDecan.toFixed(1)),
    progressPct: Number(progressPct.toFixed(1)),
    rulerFaction,
    rulerName: PLANET_NAMES[rulerFaction],
    rulerGlyph: PLANET_GLYPHS[rulerFaction],
    label: `${card} (${startDeg}°–${endDeg}° ${SIGN_NAMES[signIndex]})`
  };
}

export interface RoundRecord {
  roundId: number;
  timestamp: number;
  zoneId: number;
  zoneName: string;
  decanId: number;
  card: string;
  rank: number;
  suit: string;
  sunDegree: number;
  degInDecan: number;
  winnerFaction: number;
  winnerName: string;
  winnerAgent: string;
  winningScore: number;
  controlDelta: number;
  capturedZone: boolean;
}

export interface DecanHistoryItem {
  decanId: number;
  card: string;
  rank: number;
  suit: string;
  signName: string;
  range: [number, number];
  rulerFaction: number;
  rulerName: string;
  winnerFaction: number;
  winnerName: string;
  winnerScore: number;
  completedAt: number;
}

export interface DecanLedgerState {
  currentDecanId: number;
  lastSunDegree: number;
  factionRoundPoints: number[];
  decanVictories: number[];
  roundResults: RoundRecord[];
  decanHistory: DecanHistoryItem[];
  lastUpdated: number;
}

export class WarLedger {
  public state: DecanLedgerState;
  private filePath: string;

  constructor(customPath?: string) {
    this.filePath = customPath || join(import.meta.dir, "data", "war_round_ledger.json");
    this.state = this.load();
  }

  private load(): DecanLedgerState {
    try {
      if (existsSync(this.filePath)) {
        const raw = readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw);
        return {
          currentDecanId: typeof parsed.currentDecanId === "number" ? parsed.currentDecanId : -1,
          lastSunDegree: typeof parsed.lastSunDegree === "number" ? parsed.lastSunDegree : 0,
          factionRoundPoints: Array.isArray(parsed.factionRoundPoints) && parsed.factionRoundPoints.length === 10
            ? parsed.factionRoundPoints
            : new Array(10).fill(0),
          decanVictories: Array.isArray(parsed.decanVictories) && parsed.decanVictories.length === 10
            ? parsed.decanVictories
            : new Array(10).fill(0),
          roundResults: Array.isArray(parsed.roundResults) ? parsed.roundResults : [],
          decanHistory: Array.isArray(parsed.decanHistory) ? parsed.decanHistory : [],
          lastUpdated: typeof parsed.lastUpdated === "number" ? parsed.lastUpdated : Date.now()
        };
      }
    } catch (err) {
      console.warn("[war-ledger] Warning loading ledger file, initializing fresh state:", (err as Error).message);
    }

    return {
      currentDecanId: -1,
      lastSunDegree: 0,
      factionRoundPoints: new Array(10).fill(0),
      decanVictories: new Array(10).fill(0),
      roundResults: [],
      decanHistory: [],
      lastUpdated: Date.now()
    };
  }

  public save(): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      this.state.lastUpdated = Date.now();
      writeFileSync(this.filePath, JSON.stringify(this.state, null, 2), "utf-8");
    } catch (err) {
      // Fallback: don't crash if filesystem is read-only in certain container setups
      console.warn("[war-ledger] Warning saving ledger file:", (err as Error).message);
    }
  }

  public recordRound(round: Omit<RoundRecord, "timestamp">): RoundRecord {
    const decan = getDecanInfo(round.sunDegree);
    const fullRecord: RoundRecord = {
      ...round,
      decanId: decan.absDecan,
      card: decan.card,
      rank: decan.rank,
      suit: decan.suit,
      degInDecan: decan.degInDecan,
      timestamp: Date.now()
    };

    // 1. Credit round points to winning faction
    if (fullRecord.winnerFaction >= 0 && fullRecord.winnerFaction < 10) {
      this.state.factionRoundPoints[fullRecord.winnerFaction] += fullRecord.winningScore;
      if (fullRecord.capturedZone) {
        this.state.factionRoundPoints[fullRecord.winnerFaction] += 50; // Capture bonus
      }
    }

    // 2. Add to rolling round results (capped at 500)
    this.state.roundResults.unshift(fullRecord);
    if (this.state.roundResults.length > 500) {
      this.state.roundResults.length = 500;
    }

    // 3. Check for 10° decan boundary crossing
    this.checkDecanBoundary(round.sunDegree);

    this.save();
    return fullRecord;
  }

  public checkDecanBoundary(sunDegree: number): boolean {
    const decan = getDecanInfo(sunDegree);
    this.state.lastSunDegree = sunDegree;

    // First initialization
    if (this.state.currentDecanId === -1 || this.state.currentDecanId === undefined) {
      this.state.currentDecanId = decan.absDecan;
      this.save();
      return false;
    }

    // Decan boundary crossing detected (new 10-day period begins)
    if (decan.absDecan !== this.state.currentDecanId) {
      this.concludeDecanBattle(this.state.currentDecanId, decan);
      this.state.currentDecanId = decan.absDecan;
      this.save();
      return true;
    }

    return false;
  }

  public concludeDecanBattle(completedDecanId: number, nextDecan: DecanInfo): void {
    const completedInfo = getDecanInfo(completedDecanId * 10);

    // Find winning faction with highest round points in this decan
    let winnerId = 0;
    let maxScore = -1;
    for (let i = 0; i < 10; i++) {
      if (this.state.factionRoundPoints[i] > maxScore) {
        maxScore = this.state.factionRoundPoints[i];
        winnerId = i;
      }
    }

    // Archive completed Minor Tarot Card decan round
    const triumph: DecanHistoryItem = {
      decanId: completedDecanId,
      card: completedInfo.card,
      rank: completedInfo.rank,
      suit: completedInfo.suit,
      signName: completedInfo.signName,
      range: [completedInfo.startDeg, completedInfo.endDeg],
      rulerFaction: completedInfo.rulerFaction,
      rulerName: completedInfo.rulerName,
      winnerFaction: winnerId,
      winnerName: PLANET_NAMES[winnerId],
      winnerScore: maxScore > 0 ? maxScore : 0,
      completedAt: Date.now()
    };

    this.state.decanHistory.unshift(triumph);
    if (this.state.decanHistory.length > 36) {
      this.state.decanHistory.length = 36;
    }

    // Award Decan Crown
    this.state.decanVictories[winnerId] = (this.state.decanVictories[winnerId] || 0) + 1;

    console.log(`[war-ledger] ✦ Decan Round Concluded! ${PLANET_NAMES[winnerId]} won the ${completedInfo.card} (${completedInfo.startDeg}°–${completedInfo.endDeg}° ${completedInfo.signName}) with ${maxScore} pts! Scores reset for ${nextDecan.card}.`);

    // Reset scores for the new 10-day decan round
    this.state.factionRoundPoints = new Array(10).fill(0);
  }

  public reload(): void {
    const fresh = this.load();
    if (fresh.lastUpdated >= this.state.lastUpdated) {
      this.state = fresh;
    }
  }

  public getSummary(currentSunDeg?: number) {
    this.reload();
    const deg = typeof currentSunDeg === "number" && currentSunDeg > 0 ? currentSunDeg : this.state.lastSunDegree;
    const activeDecan = getDecanInfo(deg);

    return {
      activeDecan,
      factionRoundPoints: [...this.state.factionRoundPoints],
      decanVictories: [...this.state.decanVictories],
      recentRounds: this.state.roundResults.slice(0, 30),
      decanHistory: this.state.decanHistory.slice(0, 36),
      lastUpdated: this.state.lastUpdated
    };
  }
}

// Global shared ledger instance for companion services
export const warLedger = new WarLedger();
