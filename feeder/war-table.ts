// Pentacles — The War Table: autonomous multi-seat zone melee.
//
// Every 60s each of the eleven zones musters the factions that want it, seats
// their champions (2..6), plays twelve tricks with the SAME rules file the browser
// runs (public/arcanaTrickEngine.js), and submits the result. The module owns
// scoring, control and zone access; this daemon is only the referee.
//
// The file is deliberately split in two:
//   · PURE  — claims, champions, seat order, dealing. No I/O, exported, and
//             covered by scripts/war-table.test.mjs against these real functions.
//   · LOOP  — SQL reads and reducer calls.
//
// Trust boundary: a compromised feeder can misreport counters, but not invent a
// score (the module derives it) nor exceed the bounded zero-sum control swing.
// See docs/ZONE_MELEE_ARCANA_TRICK_PLAN.md §9.

import { sqlOneShot } from "./stdb-feed";
import { cliCall } from "./spacetime-cli";
import { signVector } from "../src/alchm-chart/sign-character.js";
import { dignityScore } from "../src/alchm-chart/dignity.js";

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
//  PURE — claims, champions, seating
// ════════════════════════════════════════════════════════════════════════════

/**
 * Mirror of `can_access_zone` in server/src/reducers.rs:2506. Houses (0-4) are
 * always reachable; a Spire (5-9) needs one of its two adjacent Houses; the Crown
 * (10) needs two Spires.
 *
 * The adjacency MUST match the Rust exactly — `house_b = (spire_idx + 4) % 5`,
 * i.e. `(zone_id - 1) % 5`, not `(zone_id - 4) % 5`. A parity test pins it, because
 * a mirror that drifts sends champions at zones the reducer will refuse.
 *
 * @param zoneOwners zone_id → owning faction index, or null when neutral
 */
export function canAccessZone(zoneId: number, faction: number, zoneOwners: Array<number | null>): boolean {
  const owns = (z: number) => zoneOwners[z] === faction;
  if (zoneId < 5) return true;
  if (zoneId < 10) {
    const spireIdx = zoneId - 5;
    return owns(spireIdx) || owns((spireIdx + 4) % 5);
  }
  let ownedSpires = 0;
  for (let s = 5; s < 10; s++) if (owns(s)) ownedSpires++;
  return ownedSpires >= 2;
}

/** How much of this zone is up for grabs: flux, a weak hold, a rival's flag. */
export function opportunity(zone: { control: number; owner: number | null; inFlux: boolean }, faction: number): number {
  let o = 0;
  if (zone.inFlux) o += 0.4;
  if (zone.control < 200) o += 0.3;
  if (zone.owner !== null && zone.owner !== faction) o += 0.3;
  return o;
}

/** Share of an agent's Active MINORS that are the zone's trump suit (0..1). */
export function trumpDepth(activeCards: Array<{ suit?: string; is_major?: boolean }>, zoneId: number): number {
  const minors = activeCards.filter((c) => !c.is_major);
  if (!minors.length) return 0;
  const trump = zoneTrump(zoneId);
  return minors.filter((c) => (c.suit || "").toLowerCase() === trump).length / minors.length;
}

export interface Agent {
  identity: string;
  handle: string;
  faction: number;          // 0..9, already the chart's top faction
  signVector: number[];     // 12 percentages summing to 100 (Asc suppressed on solar charts)
  active: Array<{ card_id: number; suit?: string; rank: number; is_major?: boolean; inverted?: boolean; title?: string }>;
  rested: boolean;          // held a seat last round
}

/**
 * How badly this agent wants this zone, 0..100. Access is a HARD gate: an
 * unreachable zone scores zero however attractive it looks.
 *
 *   35 × signAffinity   the agent's own chart
 *    4 × dignity        its faction planet in the zone's sign  (±5 → ±20)
 *   20 × trumpDepth     can it actually field trump here
 *   15 × opportunity    flux, a weak hold, a rival's flag
 *  − 8 × rest           seated last round
 */
export function computeClaim(
  agent: Agent,
  zoneId: number,
  zone: { control: number; owner: number | null; inFlux: boolean },
  zoneOwners: Array<number | null>,
): number {
  if (!canAccessZone(zoneId, agent.faction, zoneOwners)) return 0;
  const sign = zoneSign(zoneId);
  const raw =
    35 * ((agent.signVector[sign] ?? 0) / 100) +
    4 * dignityScore(agent.faction, sign) +
    20 * trumpDepth(agent.active, zoneId) +
    15 * opportunity(zone, agent.faction) -
    8 * (agent.rested ? 1 : 0);
  return Math.max(0, Math.min(100, Math.round(raw)));
}

/**
 * Rest is a luxury only deep rosters can afford. A faction with fewer agents than
 * zones it can legally reach never rests — otherwise Neptune's two agents vanish
 * from the war every other round while Saturn's fifteen rotate comfortably.
 */
export function restIsWaived(rosterSize: number, reachableZones: number): boolean {
  return rosterSize <= reachableZones;
}

export interface SeatPlan { faction: number; occupant: string; handle: string; claim: number }
export interface TablePlan { zoneId: number; trumpSuit: string; seats: SeatPlan[] }

/**
 * Greedy descending assignment: strongest claims are placed first, so the most
 * wanted zones fill before the leftovers. One seat per agent per round, one seat
 * per faction per zone, at most six seats, and a zone that cannot muster two
 * factions does not open a table at all (the caller seats the Zone Guardian).
 */
export function chooseChampions(
  agents: Agent[],
  zones: Array<{ zoneId: number; control: number; owner: number | null; inFlux: boolean }>,
  zoneOwners: Array<number | null>,
): TablePlan[] {
  const claims: Array<{ agent: Agent; zoneId: number; claim: number }> = [];
  for (const agent of agents) {
    for (const z of zones) {
      const claim = computeClaim(agent, z.zoneId, z, zoneOwners);
      if (claim > 0) claims.push({ agent, zoneId: z.zoneId, claim });
    }
  }
  // Descending claim; ties broken on identity so a round is reproducible.
  claims.sort((a, b) => b.claim - a.claim || a.agent.identity.localeCompare(b.agent.identity));

  const seated = new Set<string>();
  const byZone = new Map<number, SeatPlan[]>();
  for (const c of claims) {
    if (seated.has(c.agent.identity)) continue;
    const seats = byZone.get(c.zoneId) ?? [];
    if (seats.length >= MAX_SEATS) continue;
    if (seats.some((s) => s.faction === c.agent.faction)) continue;
    seats.push({ faction: c.agent.faction, occupant: c.agent.identity, handle: c.agent.handle, claim: c.claim });
    byZone.set(c.zoneId, seats);
    seated.add(c.agent.identity);
  }

  const plans: TablePlan[] = [];
  for (const [zoneId, seats] of [...byZone.entries()].sort((a, b) => a[0] - b[0])) {
    if (seats.length < MIN_SEATS) continue; // caller seats the Guardian instead
    plans.push({ zoneId, trumpSuit: zoneTrump(zoneId), seats });
  }
  return plans;
}

/**
 * Seat order is the ascending ecliptic longitude of each faction's planet at deal
 * time — deterministic, astrological, and it rotates as the sky turns.
 */
export function seatOrder(factions: number[], planetLon: number[]): number[] {
  return [...factions].sort((a, b) => (planetLon[a] ?? 0) - (planetLon[b] ?? 0) || a - b);
}

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

export interface SeatOutcome { faction: number; occupant: string; counters: number; meldsValue: number; tookFinalTrick: boolean }

/**
 * Play one table to completion with the shared engine. Every play is filtered
 * through `getLegalMoves`, so a seat can never make an illegal move even if the
 * AI misbehaves — the filter, not the AI, is authoritative.
 */
export function playMelee(
  hands: Map<number, Agent["active"]>,
  order: number[],
  trumpSuit: string,
  ladder: Record<number, number>,
): SeatOutcome[] {
  const live = new Map(order.map((f) => [f, [...(hands.get(f) ?? [])]]));
  const counters = new Map(order.map((f) => [f, 0]));
  const melds = new Map(order.map((f) => [f, 0]));

  for (const f of order) {
    const detected = Engine.detectMelds(live.get(f) ?? [], trumpSuit, ladder) ?? [];
    melds.set(f, detected.reduce((a: number, m: any) => a + (m.value || 0), 0));
  }

  const tricks = Math.max(...order.map((f) => (live.get(f) ?? []).length));
  let leader = 0;
  let finalTrickWinner = order[0];

  for (let t = 1; t <= tricks; t++) {
    const trick: Array<{ player: number; card: any }> = [];
    let ledSuit: string | null = null;
    for (let k = 0; k < order.length; k++) {
      const f = order[(leader + k) % order.length];
      const hand = live.get(f) ?? [];
      if (!hand.length) continue;
      const card = Engine.GuardianAI.choose(hand, ledSuit, trumpSuit, trick, ladder);
      const legal = Engine.getLegalMoves(hand, ledSuit, trumpSuit, trick, ladder);
      // The filter is authoritative: fall back to its first legal card if the AI
      // ever proposes something the rules reject.
      const chosen = legal.find((m: any) => m.legal && m.card.card_id === card?.card_id)?.card
        ?? legal.find((m: any) => m.legal)?.card;
      if (!chosen) continue;
      live.set(f, hand.filter((c) => c.card_id !== chosen.card_id));
      if (trick.length === 0 && !chosen.is_major) ledSuit = (chosen.suit || "").toLowerCase();
      trick.push({ player: f, card: chosen });
    }
    if (!trick.length) break;

    const res = Engine.evaluateTrick(trick, trumpSuit, ladder, t);
    const winner = res.winner ?? trick[0].player;
    // `evaluateTrick` folds the final-trick climax INTO `counters` and also reports
    // it as `climaxBonus`. The module adds that ten itself, from `took_final_trick`
    // in `seat_score` — so strip it here or the last trick is worth twenty.
    const gained = (res.counters || 0) - (res.climaxBonus || 0);
    counters.set(winner, (counters.get(winner) ?? 0) + gained);
    // The Excuse banks its counters for whoever played it, not the trick winner.
    if (res.excusePlayer !== null && res.excusePlayer !== undefined) {
      const ex = res.excusePlayer as number;
      counters.set(ex, (counters.get(ex) ?? 0) + Engine.counterValue({ is_major: true, rank: 0 }));
    }
    leader = order.indexOf(winner) >= 0 ? order.indexOf(winner) : leader;
    finalTrickWinner = winner;
  }

  return order.map((f) => ({
    faction: f,
    occupant: "",
    counters: counters.get(f) ?? 0,
    meldsValue: melds.get(f) ?? 0,
    tookFinalTrick: f === finalTrickWinner,
  }));
}

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
      active: activeByOwner.get(id) ?? [],
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

  // Live planet longitudes drive seat order and the Arcana ladder.
  const planets = world.ephemRows.map((e: any, i: number) => ({
    body: planetIdx(e.body) ?? i, sign: (Number(e.transiting_zone) || 0) % 12,
    eclLon: ((Number(e.transiting_zone) || 0) % 12) * 30, up: true, retrograde: false,
  }));
  const planetLon = new Array(10).fill(0);
  for (const p of planets) planetLon[p.body] = p.eclLon;

  let opened = 0;
  for (const plan of plans) {
    const byId = new Map(agents.map((a) => [a.identity, a]));
    const order = seatOrder(plan.seats.map((s) => s.faction), planetLon);
    const rng = seededRandom(plan.zoneId * 1_000_003 + roundIndex);

    // Ladder is frozen ONCE per table, before the deal — card power must not shift
    // between trick 3 and trick 4 because a planet crossed a cusp.
    const lead = byId.get(plan.seats[0].occupant);
    const ladder = Engine.buildArcanaLadder(planets, lead ? lead.signVector : null);

    await call("open_melee_round", [
      plan.zoneId,
      roundIndex,
      plan.seats.map((s) => ({ faction: planetEnum(s.faction), occupant: { __identity__: s.occupant }, claim: s.claim })),
    ]);
    opened++;

    const hands = new Map<number, Agent["active"]>();
    for (const s of plan.seats) hands.set(s.faction, dealHand(byId.get(s.occupant)?.active ?? [], rng));
    const outcomes = playMelee(hands, order, plan.trumpSuit, ladder);

    const seatRows = await sql(`SELECT seat_id, faction FROM melee_seat WHERE table_id = (SELECT MAX(table_id) FROM melee_table WHERE zone_id = ${plan.zoneId})`)
      .catch(() => [] as any[]);
    const seatIdOf = new Map<number, number>();
    for (const r of seatRows) {
      const f = planetIdx(r.faction);
      if (f !== null) seatIdOf.set(f, Number(r.seat_id));
    }
    const results = outcomes
      .filter((o) => seatIdOf.has(o.faction))
      .map((o) => ({
        seat_id: seatIdOf.get(o.faction)!,
        counters: o.counters,
        melds_value: o.meldsValue,
        took_final_trick: o.tookFinalTrick,
      }));
    if (results.length) {
      const tableId = [...seatIdOf.values()].length ? Number(seatRows[0]?.table_id ?? 0) : 0;
      await call("submit_melee_result", [tableId || (await latestTableId(plan.zoneId)), results]);
    }
  }
  return opened;
}

async function latestTableId(zoneId: number): Promise<number> {
  const rows = await sql(`SELECT table_id FROM melee_table WHERE zone_id = ${zoneId}`).catch(() => [] as any[]);
  return rows.reduce((m: number, r: any) => Math.max(m, Number(r.table_id) || 0), 0);
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
