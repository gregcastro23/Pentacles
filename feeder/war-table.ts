// Pentacles — The War Table: autonomous multi-seat zone melee.
//
// Every 60s each of the eleven zones musters the factions that want it and seats
// their champions (2..6). That is now the WHOLE job: `open_melee_round` deals the
// hands, freezes the Arcana ladder from the module's own ephemeris, plays every
// agent seat through `melee::archetype_pick`, resolves each trick and settles the
// table. This daemon picks who sits down; the module referees.
//
// It used to play the twelve tricks here in JavaScript and report the totals —
// which meant a compromised feeder could misreport who harvested what. The rules
// moved into server/src/melee.rs, `scripts/melee-parity.test.mjs` keeps the two
// engines byte-identical, and the trust boundary shrank to "the feeder chooses
// seats", bounded further by `can_access_zone` and the one-seat-per-faction rule
// the module enforces on every call.
//
// The file is deliberately split in two:
//   · PURE  — claims, champions, seat order, dealing. No I/O, exported, and
//             covered by scripts/war-table.test.mjs against these real functions.
//             Seat order and dealing are now mirrored in Rust and re-derived
//             there; they stay exported because the client predicts with them.
//   · LOOP  — SQL reads and reducer calls.
//
// See docs/ZONE_MELEE_ARCANA_TRICK_PLAN.md §9.

import { sqlOneShot } from "./stdb-feed";
import { cliCall } from "./spacetime-cli";
import { signVector } from "../src/alchm-chart/sign-character.js";
import { dignityScore } from "../src/alchm-chart/dignity.js";
import { canAccessZone, accessRefusalReason } from "../src/alchm-chart/zone-access.js";
export { canAccessZone, accessRefusalReason };

// The engine is a classic IIFE; importing it for its side effect publishes it on
// globalThis, exactly as the browser and the engine test suite do.
import "../public/arcanaTrickEngine.js";
const Engine: any = (globalThis as any).ArcanaTrickEngine;
if (!Engine) throw new Error("war-table: arcanaTrickEngine.js did not attach to globalThis");

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";
const ROUND_MS = Number(process.env.WAR_ROUND_MS ?? "60000");

export const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
/** Zone n has sign n % 12; a sign's suit is its triplicity. Mirrors client SIGN_SUITS. */
export const SIGN_SUITS = ["wands", "pentacles", "swords", "cups", "wands", "pentacles", "swords", "cups", "wands", "pentacles", "swords", "cups"];
export const zoneSign = (zoneId: number) => ((zoneId % 12) + 12) % 12;
export const zoneTrump = (zoneId: number) => SIGN_SUITS[zoneSign(zoneId)];

export const MIN_SEATS = 2;
export const MAX_SEATS = 6;
export const HAND_SIZE = 12;
export const MAX_MAJORS_IN_HAND = 3;

// ════════════════════════════════════════════════════════════════════════════
//  PURE — claims, champions, seating (delegating to canonical arcanaTrickEngine)
// ════════════════════════════════════════════════════════════════════════════

export interface Agent {
  identity: string;
  handle: string;
  faction: number;          // 0..9, already the chart's top faction
  signVector: number[];     // 12 percentages summing to 100 (Asc suppressed on solar charts)
  active: Array<{ card_id: number; suit?: string; rank: number; is_major?: boolean; inverted?: boolean; title?: string }>;
  rested: boolean;          // held a seat last round
}

export interface SeatPlan { faction: number; occupant: string; handle: string; claim: number }
export interface TablePlan { zoneId: number; trumpSuit: string; seats: SeatPlan[] }

/** How much of this zone is up for grabs: flux, a weak hold, a rival's flag. */
export const opportunity: (zone: { control: number; owner: number | null; inFlux: boolean }, faction: number) => number = Engine.opportunity;

/** Share of an agent's Active MINORS that are the zone's trump suit (0..1). */
export const trumpDepth: (activeCards: Array<{ suit?: string; is_major?: boolean }>, zoneId: number) => number = Engine.trumpDepth;

/** How badly this agent wants this zone, 0..100. */
export const computeClaim: (
  agent: Agent,
  zoneId: number,
  zone: { control: number; owner: number | null; inFlux: boolean },
  zoneOwners: Array<number | null>,
) => number = Engine.computeClaim;

/** Rest is a luxury only deep rosters can afford. */
export const restIsWaived: (rosterSize: number, reachableZones: number) => boolean = Engine.restIsWaived;

/** Greedy descending assignment: strongest claims are placed first. */
export const chooseChampions: (
  agents: Agent[],
  zones: Array<{ zoneId: number; control: number; owner: number | null; inFlux: boolean }>,
  zoneOwners: Array<number | null>,
) => TablePlan[] = Engine.chooseChampions;

/** Seat order is the ascending ecliptic longitude of each faction's planet at deal time. */
export const seatOrder: (factions: number[], planetLon: number[]) => number[] = Engine.seatOrder;

/** Deterministic PRNG so a round replays identically from (zone, round). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deal one seat's twelve cards from its Active loadout: at most three Majors (the
 * Arcana Slots), the rest minors, shuffled deterministically. A collection smaller
 * than twelve deals what it has — the caller equalises hand sizes across seats.
 */
export function dealHand(active: Agent["active"], rng: () => number): Agent["active"] {
  const shuffle = <T,>(xs: T[]) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const majors = shuffle(active.filter((c) => c.is_major)).slice(0, MAX_MAJORS_IN_HAND);
  const minors = shuffle(active.filter((c) => !c.is_major));
  return [...majors, ...minors].slice(0, HAND_SIZE);
}

export interface SeatOutcome {
  faction: number;
  occupant: string;
  counters: number;
  meldsValue: number;
  tookFinalTrick: boolean;
  plays?: Array<{ trickNumber: number; card: any }>;
}

export type MovePicker = (
  faction: number,
  hand: Agent["active"],
  ledSuit: string | null,
  trick: Array<{ player: number; card: any }>,
  ladder: Record<number, number>,
  trickNumber?: number,
) => any | null;

/**
 * 10 Astrological Combat Archetypes for automated historical agents.
 * 
 * - Sun (0): Sweeps high counters and leads dignified trumps.
 * - Moon (1): Tides — scales aggressiveness with current trick pot value.
 * - Mercury (2): Quicksilver — cunning probe leads, saves top cards with minimum winning plays.
 * - Venus (3): Concord — harmonious play, leads off-suit kings/queens without breaking marriages.
 * - Mars (4): Onslaught — aggressive top-card attacks and immediate over-trumps.
 * - Jupiter (5): Expansion — bold early Major Arcana deployment to seize table momentum.
 * - Saturn (6): Endurance — hoards high Majors/trumps for late tricks (10-12) to clinch final-trick bonus.
 * - Uranus (7): Upheaval — unpredictable plays, tactical Excuse / cross-trump plays.
 * - Neptune (8): Dissolution — evasive sloughing, lets rivals burn trumps against each other.
 * - Pluto (9): Transformation — late-game sweeps once trumps have been depleted.
 */
export interface SeatOutcome {
  faction: number;
  occupant: string;
  counters: number;
  meldsValue: number;
  tookFinalTrick: boolean;
  plays: Array<{ trickNumber: number; card: any }>;
}

export type MovePicker = (
  faction: number,
  hand: Agent["active"],
  ledSuit: string | null,
  trick: Array<{ player: number; card: any }>,
  ladder: Record<number, number>,
  trickNumber?: number,
) => any | null;

/** 10 Astrological Combat Archetypes move picker — delegated to arcanaTrickEngine. */
export const archetypeMovePicker: MovePicker = Engine.archetypeMovePicker;

/** Play one table to completion with the shared engine. */
export const playMelee: (
  hands: Map<number, Agent["active"]>,
  order: number[],
  trumpSuit: string,
  ladder: Record<number, number>,
  movePicker?: MovePicker,
  onPlay?: (play: { trickNumber: number; faction: number; card: any }) => void,
) => SeatOutcome[] = Engine.playMelee;

// ════════════════════════════════════════════════════════════════════════════
//  LOOP — SQL reads and reducer calls
// ════════════════════════════════════════════════════════════════════════════

const sql = (q: string) => sqlOneShot(SPACETIMEDB_URI, DB, SPACETIME_TOKEN || undefined, q);

async function call(reducer: string, args: any[]): Promise<void> {
  if (SPACETIME_TOKEN) {
    const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/${reducer}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SPACETIME_TOKEN}` },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`${reducer} → ${res.status}: ${await res.text().catch(() => "")}`);
    return;
  }
  await cliCall(DB, reducer, args as any);
}

const planetEnum = (idx: number) => ({ [PLANET_NAMES[idx].toLowerCase()]: [] });
const planetIdx = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v >= 0 && v < 10 ? v : null;
  const i = PLANET_NAMES.findIndex((n) => n.toLowerCase() === String(v).toLowerCase());
  return i >= 0 ? i : null;
};

/** One read of everything a round needs. */
export async function loadWorld() {
  const [zoneRows, playerRows, agentRows, slotRows, cardRows, ephemRows] = await Promise.all([
    sql("SELECT zone_id, owner, control, in_flux FROM zone"),
    sql("SELECT identity, handle, faction FROM player"),
    sql("SELECT identity, handle, placements, ascendant, time_known FROM agent_chart"),
    sql("SELECT owner, card_id, loadout FROM deck_slot"),
    sql("SELECT card_id, owner, suit, rank, is_major, inverted FROM card"),
    sql("SELECT body, transiting_zone FROM ephemeris"),
  ]);

  const zoneOwners: Array<number | null> = new Array(11).fill(null);
  const zones = [] as Array<{ zoneId: number; control: number; owner: number | null; inFlux: boolean }>;
  for (const z of zoneRows) {
    const id = Number(z.zone_id);
    const owner = planetIdx(z.owner);
    zoneOwners[id] = owner;
    zones.push({ zoneId: id, control: Number(z.control) || 0, owner, inFlux: Boolean(z.in_flux) });
  }

  const activeByOwner = new Map<string, any[]>();
  const cardById = new Map<number, any>();
  for (const c of cardRows) cardById.set(Number(c.card_id), c);
  for (const s of slotRows) {
    if (String(s.loadout).toLowerCase() !== "active") continue;
    const card = cardById.get(Number(s.card_id));
    if (!card) continue;
    const key = String(s.owner);
    (activeByOwner.get(key) ?? activeByOwner.set(key, []).get(key)!).push({
      card_id: Number(card.card_id),
      suit: card.suit ? String(card.suit).toLowerCase() : undefined,
      rank: Number(card.rank),
      is_major: Boolean(card.is_major),
      inverted: Boolean(card.inverted),
    });
  }

  const factionOf = new Map<string, number>();
  for (const p of playerRows) {
    const f = planetIdx(p.faction);
    if (f !== null) factionOf.set(String(p.identity), f);
  }

  return { zones, zoneOwners, agentRows, activeByOwner, factionOf, ephemRows };
}

/**
 * Ensures an agent has a rich, legal active hand of cards (≤ 3 Majors, rest Minors)
 * even if their database rows are sparse or in offline/testing mode.
 */
export function ensureActiveHand(
  active: Agent["active"],
  faction: number,
): Agent["active"] {
  if (active && active.length >= HAND_SIZE) return active;
  const cards = [...(active || [])];
  const existingIds = new Set(cards.map((c) => c.card_id));

  const favSuit = SIGN_SUITS[faction % 12] || "wands";
  const suits = ["wands", "cups", "swords", "pentacles"];

  let majorCount = cards.filter((c) => c.is_major).length;
  let nextCardId = 900_000 + faction * 1000;

  while (majorCount < MAX_MAJORS_IN_HAND) {
    const majorRank = (faction * 2 + majorCount * 7) % 22;
    cards.push({
      card_id: nextCardId++,
      rank: majorRank,
      is_major: true,
      inverted: false,
      title: Engine.ARCANA_NAMES[majorRank] || `Major ${majorRank}`,
    });
    majorCount++;
  }

  const rankSeq = [1, 14, 13, 10, 12, 11, 9, 8, 7, 6, 5, 4, 3, 2];
  let sIdx = 0;
  while (cards.length < 20) {
    const suit = sIdx % 2 === 0 ? favSuit : suits[sIdx % 4];
    const rank = rankSeq[cards.length % rankSeq.length];
    const cid = nextCardId++;
    if (!existingIds.has(cid)) {
      cards.push({
        card_id: cid,
        suit,
        rank,
        is_major: false,
        inverted: false,
      });
      existingIds.add(cid);
    }
    sIdx++;
  }

  return cards;
}

/** Build the Agent list a round reasons over, with rest applied roster-relatively. */
export function buildAgents(
  agentRows: any[],
  factionOf: Map<string, number>,
  activeByOwner: Map<string, any[]>,
  restedIds: Set<string>,
  zoneOwners: Array<number | null>,
): Agent[] {
  const agents: Agent[] = [];
  for (const row of agentRows) {
    const id = String(row.identity);
    const faction = factionOf.get(id);
    if (faction === undefined) continue;
    const placements = Array.isArray(row.placements) ? row.placements : [];
    const timeKnown = Boolean(row.time_known);
    const ascSign = timeKnown ? Math.floor((Number(row.ascendant) || 0) / 1800) % 12 : null;
    agents.push({
      identity: id,
      handle: String(row.handle ?? id.slice(0, 10)),
      faction,
      // Solar charts have a placeholder Ascendant; sign-character.js suppresses its
      // weight-20 term when ascSign is null, as faction_scores already does.
      signVector: Array.from(signVector(placements.map((p: any) => ({
        body: planetIdx(p.body) ?? 0, sign: Number(p.sign) || 0,
        dignity: Number(p.dignity) || 0,
      })), ascSign)),
      active: ensureActiveHand(activeByOwner.get(id) ?? [], faction),
      rested: restedIds.has(id),
    });
  }

  // Rest is roster-relative: waive it for any faction thinner than its reach.
  const reachable = (f: number) => [0,1,2,3,4,5,6,7,8,9,10].filter((z) => canAccessZone(z, f, zoneOwners)).length;
  const rosterSize = new Map<number, number>();
  for (const a of agents) rosterSize.set(a.faction, (rosterSize.get(a.faction) ?? 0) + 1);
  for (const a of agents) {
    if (a.rested && restIsWaived(rosterSize.get(a.faction) ?? 0, reachable(a.faction))) a.rested = false;
  }
  return agents;
}

/** One full round: muster, seat, deal, play twelve tricks, settle. */
export async function runRound(roundIndex: number): Promise<number> {
  const world = await loadWorld();
  const restedIds = new Set<string>(); // populated from agent_rest once a round has run
  try {
    const rest = await sql(`SELECT identity, rested_at_round FROM agent_rest`);
    for (const r of rest) if (Number(r.rested_at_round) === roundIndex - 1) restedIds.add(String(r.identity));
  } catch { /* first round: no rest rows yet */ }

  const agents = buildAgents(world.agentRows, world.factionOf, world.activeByOwner, restedIds, world.zoneOwners);
  const plans = chooseChampions(agents, world.zones, world.zoneOwners);

  // Live planet longitudes still drive the FALLBACK ladder. The module computes
  // its own from `ephemeris` and ignores this whenever it has a sky — we send it
  // so a cold database (no ephemeris rows yet) still opens a playable table.
  const planets = world.ephemRows.map((e: any, i: number) => ({
    body: planetIdx(e.body) ?? i, sign: (Number(e.transiting_zone) || 0) % 12,
    eclLon: ((Number(e.transiting_zone) || 0) % 12) * 30, up: true, retrograde: false,
  }));

  let opened = 0;
  for (const plan of plans) {
    const byId = new Map(agents.map((a) => [a.identity, a]));
    const lead = byId.get(plan.seats[0].occupant);
    const fallbackLadder = Engine.buildArcanaLadder(planets, lead ? lead.signVector : null);

    await call("open_melee_round", [
      plan.zoneId,
      roundIndex,
      JSON.stringify(fallbackLadder),
      plan.seats.map((s) => ({ faction: planetEnum(s.faction), occupant: { __identity__: s.occupant }, claim: s.claim })),
    ]);
    opened++;
  }
  return opened;
}

export function startWarTable(): void {
  let round = 1;
  console.log(`[war-table] round loop every ${ROUND_MS}ms on ${DB}`);
  const tick = async () => {
    try {
      const opened = await runRound(round);
      console.log(`[war-table] round ${round}: ${opened} table(s)`);
    } catch (err) {
      console.error(`[war-table] round ${round} failed:`, err);
    }
    round++;
  };
  tick();
  setInterval(tick, ROUND_MS);
}

if (import.meta.main) startWarTable();
