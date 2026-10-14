// ============================================================
// Pentacles — live faction standings, from chain rows only
// ============================================================
// Pure: takes subscribed rows (normalized snake_case) and returns the ranked
// board. Nothing here reads the local GameState, so simulated or practice rounds
// can never reach the live leaderboard.
//
//   score = Σ zone weight (House 100, Spire 200, Crown 400) of zones held
//         + positive control / 10 on zones held
//         + 5 per star held
//         + faction_war_standing.decan_points   (only while the module's war
//           clock is on the Sun's current decan; otherwise they belong to a
//           decan that is already over)
//         + 50 per decan crown (faction_war_standing.decan_crowns)

export const PLANET_NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']
export const DECAN_CROWN_POINTS = 50
const ZONE_WEIGHT = { house: 100, spire: 200, crown: 400 }

// ---- enum decoding helpers -------------------------------------------------
export function planetIndex(v) {
  if (v == null) return null
  if (typeof v === 'number') return (v >= 0 && v < 10) ? v : null
  if (typeof v === 'string') {
    const s = v.toLowerCase()
    const i = PLANET_NAMES.findIndex(n => n.toLowerCase() === s)
    return i >= 0 ? i : null
  }
  if (typeof v === 'object') {
    if ('__identity__' in v) return null
    const key = Object.keys(v)[0]
    if (!key) return null
    const s = key.toLowerCase()
    const i = PLANET_NAMES.findIndex(n => n.toLowerCase() === s)
    return i >= 0 ? i : null
  }
  return null
}
export function kindName(v) {
  let s = v
  if (v && typeof v === 'object') s = Object.keys(v)[0]
  return String(s || '').toLowerCase()
}

function zoneLabel(kind, id) {
  return kind === 'house' ? `House ${id}` : kind === 'spire' ? `Spire ${id}` : 'Crown Zenith'
}

/** `war_state.current_decan` (Option<u8>) as 0..35, or null. */
export function warDecan(warState) {
  const row = Array.isArray(warState) ? warState[0] : warState
  const d = row ? row.current_decan : null
  if (d == null || d === '') return null
  const n = Number(d)
  return Number.isInteger(n) && n >= 0 && n < 36 ? n : null
}

/**
 * Rank the ten factions from chain rows.
 *
 * @param {object} rows
 * @param {object[]|null} rows.zones      `zone` rows
 * @param {object[]|null} rows.stars      `star_node` rows
 * @param {object[]|null} rows.standings  `faction_war_standing` rows (null = not synced)
 * @param {object[]|null} rows.warState   `war_state` rows
 * @param {number|null}   rows.sunDecan   the client's own Sun decan (0..35), null if unknown
 */
export function liveStandings({ zones = null, stars = null, standings = null, warState = null, sunDecan = null } = {}) {
  const board = Array.from({ length: 10 }, (_, id) => ({
    id, score: 0, zonePoints: 0, starPoints: 0, decanPoints: 0, decanCrowns: 0, zonesHeld: [],
  }))

  for (const z of zones || []) {
    const o = planetIndex(z.owner)
    if (o == null) continue
    const kind = kindName(z.kind)
    const control = Number(z.control) || 0
    board[o].zonePoints += (ZONE_WEIGHT[kind] || ZONE_WEIGHT.house) + Math.max(0, Math.floor(control / 10))
    board[o].zonesHeld.push({ zoneId: Number(z.zone_id), name: zoneLabel(kind, Number(z.zone_id)), control })
  }
  for (const s of stars || []) {
    const h = planetIndex(s.held_by)
    if (h != null) board[h].starPoints += 5
  }

  const chainDecan = warDecan(warState)
  const decanIsCurrent = chainDecan != null && Number.isInteger(sunDecan) && chainDecan === sunDecan
  for (const row of standings || []) {
    const i = row.faction_idx != null ? Number(row.faction_idx) : planetIndex(row.faction)
    if (!Number.isInteger(i) || i < 0 || i >= 10) continue
    board[i].decanCrowns = Number(row.decan_crowns) || 0
    board[i].decanPoints = decanIsCurrent ? Number(row.decan_points) || 0 : 0
  }

  for (const f of board) {
    f.zonesHeld.sort((a, b) => a.zoneId - b.zoneId)
    f.score = f.zonePoints + f.starPoints + f.decanPoints + f.decanCrowns * DECAN_CROWN_POINTS
  }
  const ranked = board.slice().sort((a, b) => b.score - a.score || a.id - b.id)
  ranked.forEach((f, i) => { f.rank = i + 1 })
  return {
    ranked,
    standingsSynced: Array.isArray(standings),
    chainDecan,
    sunDecan: Number.isInteger(sunDecan) ? sunDecan : null,
    decanIsCurrent,
  }
}
