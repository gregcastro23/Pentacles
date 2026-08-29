/* ============================================================
   Faction War — pure model (DOM-free, testable)
   ============================================================
   Turns the raw on-chain rows (zone / player / agent_chart, normalized to
   snake_case by ws-normalize.js) into the view-model the Faction War UI binds
   to: 11 zones, the 10-faction standings, per-faction rosters, derived
   event feed, and War Table seat manifests + round clocks.

   Mirrors the server: zone weight House 1 / Spire 2 / Crown 3 (season standings
   in reducers.rs), control 0..1000 per owner.
   Run: `node src/alchm-chart/__tests__/war-model.test.js`
   ============================================================ */

import { canAccessZone, accessRefusalReason } from "./zone-access.js";
export { canAccessZone, accessRefusalReason };

export const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
export const ZONE_KIND_WEIGHT = { house: 1, spire: 2, crown: 3 };
const ROMAN = ["I", "II", "III", "IV", "V"];
const CONTESTED_BELOW = 200; // owned but a weak hold → flaggable as contested
const CONTROL_MAX = 1000;
const EVENT_DELTA = 60; // control swing per snapshot worth a ticker line

export const FACTION_ARCHETYPES = [
  { idx: 0, name: "Sun", archetype: "Radiance", tactic: "Sweeps high counters and leads dignified trumps." },
  { idx: 1, name: "Moon", archetype: "Tides", tactic: "Intuitive flow — commits power when pot points are high." },
  { idx: 2, name: "Mercury", archetype: "Quicksilver", tactic: "Cunning probe leads; wins with minimum sufficient power." },
  { idx: 3, name: "Venus", archetype: "Concord", tactic: "Harmonious synergy; leads off-suit court pairs without breaking melds." },
  { idx: 4, name: "Mars", archetype: "Onslaught", tactic: "Aggressive attack leads and immediate over-trumping." },
  { idx: 5, name: "Jupiter", archetype: "Expansion", tactic: "Bold early Major Arcana deployment to build table momentum." },
  { idx: 6, name: "Saturn", archetype: "Endurance", tactic: "Defensive hoarding; stores high Majors for the final-trick climax." },
  { idx: 7, name: "Uranus", archetype: "Upheaval", tactic: "Unpredictable plays, tactical Excuse / cross-suit disruption." },
  { idx: 8, name: "Neptune", archetype: "Dissolution", tactic: "Evasive sloughing; lets rivals exhaust trumps against each other." },
  { idx: 9, name: "Pluto", archetype: "Transformation", tactic: "Endgame transformation sweeps once trumps are depleted." },
];

export function factionArchetype(idx) {
  return FACTION_ARCHETYPES[idx] || { idx, name: PLANET_NAMES[idx] || "Neutral", archetype: "Balanced", tactic: "Standard Guardian AI play." };
}

/** Zone 0–4 = Houses, 5–9 = Spires, 10 = Crown. */
export function zoneKindOf(id) { return id <= 4 ? "house" : id <= 9 ? "spire" : "crown"; }
export function zoneName(id) {
  if (id <= 4) return `House ${ROMAN[id]}`;
  if (id <= 9) return `Spire ${ROMAN[id - 5]}`;
  return "The Crown";
}

/** Normalize an owner/faction value ("Jupiter" | "jupiter" | 5 | null) → idx 0–9 | null. */
export function planetIdx(v, names = PLANET_NAMES) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v >= 0 && v < 10 ? v : null;
  const s = String(v).toLowerCase();
  const i = names.findIndex((n) => n.toLowerCase() === s);
  return i >= 0 ? i : null;
}

/** Parse SpacetimeDB timestamp (microseconds / millis / Date string) → milliseconds. */
export function parseTimestampMs(ts) {
  if (ts == null) return null;
  if (typeof ts === "number") {
    // If > 1e14 it's microseconds (SpacetimeDB format)
    return ts > 1e14 ? Math.round(ts / 1000) : ts;
  }
  if (typeof ts === "string") {
    const n = Number(ts);
    if (!isNaN(n) && n > 0) return n > 1e14 ? Math.round(n / 1000) : n;
    const parsed = Date.parse(ts);
    return isNaN(parsed) ? null : parsed;
  }
  if (typeof ts === "object" && ts.toMillis) return ts.toMillis();
  return null;
}

/** Raw zone rows → 11 normalized zone view-objects, ordered by id. */
export function buildZones(zoneRows, names = PLANET_NAMES) {
  const byId = {};
  for (const z of zoneRows || []) byId[Number(z.zone_id)] = z;
  const out = [];
  for (let id = 0; id < 11; id++) {
    const z = byId[id] || {};
    const ownerIdx = planetIdx(z.owner, names);
    const control = Math.max(0, Math.min(CONTROL_MAX, Number(z.control) || 0));
    out.push({
      id,
      kind: zoneKindOf(id),
      name: zoneName(id),
      ownerIdx,
      control,
      pct: control / CONTROL_MAX,
      contested: ownerIdx != null && control > 0 && control < CONTESTED_BELOW,
    });
  }
  return out;
}

/** Set of agent identities (hex) from agent_chart rows — to tell agents from humans. */
export function agentIdentitySet(agentRows) {
  const s = new Set();
  for (const a of agentRows || []) if (a && a.identity != null) s.add(String(a.identity));
  return s;
}
/** identity(hex) → agent_chart row, for roster display names. */
export function agentByIdentity(agentRows) {
  const m = {};
  for (const a of agentRows || []) if (a && a.identity != null) m[String(a.identity)] = a;
  return m;
}

/**
 * Ranked standings for all 10 factions.
 * @returns [{idx,name,zones,weight,control,agents,humans,total}] sorted strongest-first.
 */
export function computeStandings(zones, players, agentIds, names = PLANET_NAMES) {
  const count = Array(10).fill(0), weight = Array(10).fill(0), control = Array(10).fill(0);
  for (const z of zones || []) {
    if (z.ownerIdx == null) continue;
    count[z.ownerIdx]++;
    weight[z.ownerIdx] += ZONE_KIND_WEIGHT[z.kind] || 1;
    control[z.ownerIdx] += z.control;
  }
  const agents = Array(10).fill(0), humans = Array(10).fill(0);
  for (const p of players || []) {
    const fi = planetIdx(p.faction, names);
    if (fi == null) continue;
    if (agentIds && agentIds.has(String(p.identity))) agents[fi]++;
    else humans[fi]++;
  }
  const rows = names.map((name, i) => ({
    idx: i, name, zones: count[i], weight: weight[i], control: control[i],
    agents: agents[i], humans: humans[i], total: agents[i] + humans[i],
  }));
  rows.sort((a, b) => b.weight - a.weight || b.control - a.control || b.zones - a.zones || a.idx - b.idx);
  return rows;
}

/** Roster of a faction: its players, agents first, with display handles. */
export function factionRoster(factionIdx, players, agentMap, names = PLANET_NAMES) {
  const out = [];
  for (const p of players || []) {
    if (planetIdx(p.faction, names) !== factionIdx) continue;
    const a = agentMap && agentMap[String(p.identity)];
    out.push({ identity: String(p.identity), handle: (a && a.handle) || p.handle || "—", isAgent: !!a });
  }
  out.sort((a, b) => Number(b.isAgent) - Number(a.isAgent) || a.handle.localeCompare(b.handle));
  return out;
}

/** Trend per faction idx vs a prior standings snapshot: +1 rising, -1 falling, 0 flat. */
export function standingsTrend(standings, prevStandings) {
  const prev = {};
  for (const r of prevStandings || []) prev[r.idx] = r.weight * 10000 + r.control;
  const t = {};
  for (const r of standings) {
    const now = r.weight * 10000 + r.control;
    const was = prev[r.idx];
    t[r.idx] = was == null || now === was ? 0 : now > was ? 1 : -1;
  }
  return t;
}

/**
 * Events diffed from two zone snapshots (+ standings for join detection).
 * Newest-relevant first. `glyphs`/`names` index by planet idx; `tLabel` stamps each.
 */
export function deriveEvents(prevZones, zones, prevStandings, standings, names = PLANET_NAMES, glyphs = [], tLabel = "") {
  const ev = [];
  const mk = (idx, text, kind) => ({ idx, glyph: glyphs[idx] || "✦", faction: names[idx], text, kind, t: tLabel });
  const prevById = {};
  for (const z of prevZones || []) prevById[z.id] = z;
  for (const z of zones || []) {
    const p = prevById[z.id];
    if (!p) continue;
    if (z.ownerIdx !== p.ownerIdx) {
      if (z.ownerIdx != null) ev.push(mk(z.ownerIdx, `seized ${z.name}`, "capture"));
      else if (p.ownerIdx != null) ev.push(mk(p.ownerIdx, `lost ${z.name} — now neutral`, "loss"));
    } else if (z.ownerIdx != null) {
      const d = z.control - p.control;
      if (d >= EVENT_DELTA) ev.push(mk(z.ownerIdx, `control rising in ${z.name}`, "rise"));
      else if (d <= -EVENT_DELTA) ev.push(mk(z.ownerIdx, `losing grip on ${z.name}`, "fall"));
    }
  }
  if (prevStandings && prevStandings.length) {
    const before = {};
    for (const r of prevStandings) before[r.idx] = r.total;
    for (const r of standings) {
      if (before[r.idx] != null && r.total > before[r.idx]) ev.push(mk(r.idx, "a new ally joined", "join"));
    }
  }
  return ev;
}

// ════════════════════════════════════════════════════════════════════════════
//  WAR TABLE — multi-seat manifests & round clock
// ════════════════════════════════════════════════════════════════════════════

/**
 * Normalizes the War Table's on-chain rows into view-models indexed by
 * `table_id` and by `zone_id`.
 *
 * `melee_hand` and `melee_trick` are what the module writes now that it referees
 * its own tables, and they are what let the UI stop guessing. Before them the
 * client had to infer the current trick from `melee_play.length / seatCount`,
 * which silently broke whenever a seat was dealt short; and it had to show the
 * player their Active loadout and hope it matched what the server had dealt.
 * Both are now read straight off the table.
 *
 * The turn derivation here mirrors `melee_turn` in server/src/reducers.rs — a
 * seat that has run out of cards drops out of the rotation rather than stalling
 * it — so the "your turn" the player sees is the turn the module will accept.
 */
export function buildTables(
  meleeTableRows,
  meleeSeatRows,
  playerRows,
  agentMap,
  names = PLANET_NAMES,
  meleePlayRows = [],
  meleeHandRows = [],
  meleeTrickRows = [],
) {
  const playerMap = {};
  for (const p of playerRows || []) {
    if (p && p.identity != null) playerMap[String(p.identity)] = p;
  }

  const seatsByTable = {};
  for (const s of meleeSeatRows || []) {
    const tid = Number(s.table_id);
    if (!seatsByTable[tid]) seatsByTable[tid] = [];
    const fIdx = planetIdx(s.faction, names);
    const occupantId = String(s.occupant || "");
    const agent = agentMap && agentMap[occupantId];
    const player = playerMap[occupantId];
    const handle = (agent && agent.handle) || (player && player.handle) || (occupantId ? occupantId.slice(0, 10) : "—");
    const arch = fIdx != null ? factionArchetype(fIdx) : { archetype: "Balanced", tactic: "Standard play" };
    seatsByTable[tid].push({
      seatId: Number(s.seat_id),
      tableId: tid,
      occupant: occupantId,
      faction: fIdx,
      factionName: fIdx != null ? names[fIdx] : "Neutral",
      archetype: arch.archetype,
      tactic: arch.tactic,
      isHuman: Boolean(s.is_human),
      claim: Number(s.claim || 0),
      counters: Number(s.counters || 0),
      meldsValue: Number(s.melds_value || 0),
      score: Number(s.score || 0),
      handle,
      isAgent: Boolean(agent),
    });
  }

  const playsByTable = {};
  for (const p of meleePlayRows || []) {
    const tid = Number(p.table_id);
    if (!playsByTable[tid]) playsByTable[tid] = [];
    playsByTable[tid].push({
      playId: Number(p.play_id),
      tableId: tid,
      trickNumber: Number(p.trick_number),
      seatId: Number(p.seat_id),
      cardId: Number(p.card_id),
      isMajor: Boolean(p.is_major),
      rank: Number(p.rank),
      suit: p.suit ? String(p.suit).toLowerCase() : "wands",
      playedAt: parseTimestampMs(p.played_at),
    });
  }

  const handsBySeat = {};
  for (const hRow of meleeHandRows || []) {
    const sid = Number(hRow.seat_id);
    if (!handsBySeat[sid]) handsBySeat[sid] = [];
    handsBySeat[sid].push({
      handId: Number(hRow.hand_id),
      tableId: Number(hRow.table_id),
      seatId: sid,
      // The engine expects snake_case card shapes; keep them wire-identical so a
      // dealt card can be handed straight to getLegalMoves.
      card_id: Number(hRow.card_id),
      suit: hRow.suit ? String(hRow.suit).toLowerCase() : "wands",
      rank: Number(hRow.rank),
      is_major: Boolean(hRow.is_major),
      inverted: Boolean(hRow.inverted),
      played: Boolean(hRow.played),
    });
  }

  const tricksByTable = {};
  for (const tr of meleeTrickRows || []) {
    const tid = Number(tr.table_id);
    if (!tricksByTable[tid]) tricksByTable[tid] = [];
    tricksByTable[tid].push({
      trickId: Number(tr.trick_id),
      tableId: tid,
      trickNumber: Number(tr.trick_number),
      leaderSeat: Number(tr.leader_seat),
      ledSuit: tr.led_suit ? String(tr.led_suit).toLowerCase() : null,
      winnerSeat: Number(tr.winner_seat),
      counters: Number(tr.counters || 0),
      excuseSeat: tr.excuse_seat == null ? null : Number(tr.excuse_seat),
      resolvedAt: parseTimestampMs(tr.resolved_at),
    });
  }

  const tables = [];
  const byId = {};
  const byZone = {};

  for (const t of meleeTableRows || []) {
    const tableId = Number(t.table_id);
    const zoneId = Number(t.zone_id);
    const seats = (seatsByTable[tableId] || []).sort((a, b) => a.seatId - b.seatId);
    const plays = playsByTable[tableId] || [];
    let ladder = {};
    if (t.ladder_raw) {
      try { ladder = typeof t.ladder_raw === "string" ? JSON.parse(t.ladder_raw) : t.ladder_raw; } catch {}
    }

    const tricks = (tricksByTable[tableId] || []).sort((a, b) => a.trickNumber - b.trickNumber);

    // The module derives the open trick from RESOLVED trick rows, never from a
    // play count. Mirror that exactly or the client will disagree with the
    // server about which trick a click belongs to.
    const currentTrick = Math.min(tricks.length + 1, TOTAL_TRICKS);
    const trickPlays = plays
      .filter((p) => p.trickNumber === currentTrick)
      .sort((a, b) => a.playId - b.playId);

    for (const seat of seats) {
      const dealt = handsBySeat[seat.seatId] || [];
      seat.hand = dealt;
      seat.handRemaining = dealt.filter((c) => !c.played).length;
      // Nothing dealt is not the same as nothing left: a spectator sees no hand
      // rows at all for a seat until they load, and must not read that as void.
      seat.hasDeal = dealt.length > 0;
    }

    const lastTrick = tricks.length ? tricks[tricks.length - 1] : null;
    const leaderSeat = lastTrick ? lastTrick.winnerSeat : seats.length ? seats[0].seatId : null;
    const turnSeat = deriveTurnSeat(seats, leaderSeat, trickPlays);

    const stateStr = typeof t.state === "string" ? t.state : Object.keys(t.state || {})[0] || "Mustering";
    const hasHuman = seats.some((s) => s.isHuman);
    const openedAt = parseTimestampMs(t.opened_at);
    const resolvedAt = parseTimestampMs(t.resolved_at);

    const model = {
      tableId,
      zoneId,
      roundIndex: Number(t.round_index || 0),
      trumpSuit: t.trump_suit ? String(t.trump_suit).toLowerCase() : "wands",
      state: stateStr,
      seatCount: Number(t.seat_count || seats.length),
      openedAt,
      resolvedAt,
      ladderRaw: t.ladder_raw || "",
      ladder,
      seats,
      hasHuman,
      plays,
      tricks,
      currentTrick,
      trickPlays,
      leaderSeat,
      turnSeat,
      lastResolvedTrick: lastTrick,
    };

    tables.push(model);
    byId[tableId] = model;

    // Latest table per zone
    if (!byZone[zoneId] || byZone[zoneId].roundIndex < model.roundIndex || byZone[zoneId].tableId < model.tableId) {
      byZone[zoneId] = model;
    }
  }

  return { tables, byId, byZone };
}

/** Tricks in a melee. Mirrors `melee::TOTAL_TRICKS`. */
export const TOTAL_TRICKS = 12;

/**
 * The seat on turn, or null when the trick is full.
 *
 * Mirrors `melee_turn` in server/src/reducers.rs: the rotation is the seats that
 * held a card when the trick began — those that still hold one, plus those that
 * have already played into it — walked from the leader. A seat dealt short drops
 * out instead of freezing the table, and the client has to agree about that or
 * it will point at the wrong player.
 */
export function deriveTurnSeat(seats, leaderSeat, trickPlays) {
  const expected = (seats || [])
    .filter((s) => trickPlays.some((p) => p.seatId === s.seatId) || s.handRemaining > 0 || !s.hasDeal)
    .map((s) => s.seatId);
  if (!expected.length || trickPlays.length >= expected.length) return null;
  const start = Math.max(0, expected.indexOf(leaderSeat));
  for (let k = 0; k < expected.length; k++) {
    const id = expected[(start + k) % expected.length];
    if (!trickPlays.some((p) => p.seatId === id)) return id;
  }
  return null;
}

/**
 * Calculates current round phase and seconds remaining from table timestamps.
 * 
 * Cadence:
 *   - Agent-only (60s round):
 *       0–10s: Muster
 *      10–15s: Seating
 *      15–55s: Play
 *      55–60s: Resolve
 *   - Human-seated (120s round):
 *       0–10s: Muster
 *      10–15s: Seating
 *      15–115s: Play
 *     115–120s: Resolve
 */
export function roundClock(table, nowMs = Date.now(), roundDurationMs = 60000, humanRoundDurationMs = 120000) {
  if (!table || !table.openedAt) {
    return { phase: "idle", secondsRemaining: 0, elapsedSeconds: 0, totalDuration: 0, progressPct: 0 };
  }

  const isResolved = String(table.state).toLowerCase() === "resolved" || table.resolvedAt != null;
  const totalMs = table.hasHuman ? humanRoundDurationMs : roundDurationMs;
  const totalSec = Math.round(totalMs / 1000);

  if (isResolved) {
    const elapsed = Math.round(((table.resolvedAt || nowMs) - table.openedAt) / 1000);
    return {
      phase: "resolved",
      secondsRemaining: 0,
      elapsedSeconds: Math.max(0, elapsed),
      totalDuration: totalSec,
      progressPct: 100,
    };
  }

  const elapsedMs = Math.max(0, nowMs - table.openedAt);
  const elapsedSec = Math.floor(elapsedMs / 1000);
  const remainingMs = Math.max(0, totalMs - elapsedMs);
  const secondsRemaining = Math.ceil(remainingMs / 1000);
  const progressPct = Math.min(100, Math.round((elapsedMs / totalMs) * 100));

  let phase = "muster";
  if (elapsedSec < 10) {
    phase = "muster";
  } else if (elapsedSec < 15) {
    phase = "seating";
  } else if (elapsedSec < (totalSec - 5)) {
    phase = "play";
  } else {
    phase = "resolve";
  }

  return {
    phase,
    secondsRemaining,
    elapsedSeconds: elapsedSec,
    totalDuration: totalSec,
    progressPct,
  };
}

export default {
  TOTAL_TRICKS,
  deriveTurnSeat,
  PLANET_NAMES, ZONE_KIND_WEIGHT, zoneKindOf, zoneName, planetIdx, parseTimestampMs, buildZones,
  agentIdentitySet, agentByIdentity, computeStandings, factionRoster, standingsTrend, deriveEvents,
  canAccessZone, accessRefusalReason, buildTables, roundClock,
};
