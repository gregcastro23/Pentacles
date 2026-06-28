/* ============================================================
   Faction War — pure model (DOM-free, testable)
   ============================================================
   Turns the raw on-chain rows (zone / player / agent_chart, normalized to
   snake_case by ws-normalize.js) into the view-model the Faction War UI binds
   to: 11 zones, the 10-faction standings, per-faction rosters, and a derived
   event feed (there is no event table — events are diffed from zone snapshots).

   Mirrors the server: zone weight House 1 / Spire 2 / Crown 3 (season standings
   in reducers.rs), control 0..1000 per owner.
   Run: `node src/alchm-chart/__tests__/war-model.test.js`
   ============================================================ */

export const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
export const ZONE_KIND_WEIGHT = { house: 1, spire: 2, crown: 3 };
const ROMAN = ["I", "II", "III", "IV", "V"];
const CONTESTED_BELOW = 200; // owned but a weak hold → flaggable as contested
const CONTROL_MAX = 1000;
const EVENT_DELTA = 60; // control swing per snapshot worth a ticker line

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

export default {
  PLANET_NAMES, ZONE_KIND_WEIGHT, zoneKindOf, zoneName, planetIdx, buildZones,
  agentIdentitySet, agentByIdentity, computeStandings, factionRoster, standingsTrend, deriveEvents,
};
