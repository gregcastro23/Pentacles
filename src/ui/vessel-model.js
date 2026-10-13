// ============================================================
// Pentacles — Alchm Vessel model (pure, no DOM)
// ============================================================
// Folds this realm's own SpacetimeDB rows into the arena half of the Vessel,
// and normalizes the cross-app treasury from agents.alchm.kitchen
// /api/vessel/summary. Kept DOM-free so it runs under `bun test`.
//
// Nothing here estimates: a table that could not be read is `null` and the
// drawer says so; simulated balances (web3/esms.js simEsmsBalances) are never
// shown as treasury.

export const VESSEL_STREAMS = [
  { key: 'jingDuels', label: 'Jing & 14 Pillars Duels', tag: 'Jing' },
  { key: 'staking', label: 'Yields, Streaks & Sky Drops', tag: 'StarVault' },
  { key: 'pentaclesMelee', label: 'Pentacles War Table', tag: 'Pentacles' },
  { key: 'kitchenAchievements', label: 'Kitchen Achievements', tag: 'Kitchen' },
]

const hex = (v) => {
  const raw = v && typeof v === 'object' ? v.__identity__ ?? v : v
  return raw == null ? '' : String(raw).replace(/^0x/i, '').toLowerCase().trim()
}

/** Wins/resolved for `identity` across duel rows, from either side of the duel. */
export function foldDuelRows(rows, identity) {
  if (!Array.isArray(rows)) return null
  const me = hex(identity)
  let wins = 0
  let resolved = 0
  let fought = 0
  for (const row of rows) {
    const asInitiator = hex(row.initiator) === me
    const asTarget = !asInitiator && hex(row.target_player) === me
    if (!me || (!asInitiator && !asTarget)) continue
    fought += 1
    if (row.state !== 'Resolved') continue
    resolved += 1
    const outcome = row.winner_is_initiator
    if (typeof outcome !== 'boolean') continue
    if (asInitiator ? outcome : !outcome) wins += 1
  }
  return { wins, resolved, fought }
}

/**
 * The arena half of the Vessel. Each input is the raw row array, or null when
 * that table could not be read (offline, paused, or not yet published).
 */
export function foldArenaStats({ identity, player, jingDuels, pillarDuels, seats, pillarPool, career = null }) {
  const me = hex(identity)
  // Raw seats are pruned minutes after a table settles, so these are this
  // player's current/most recent tables; take the newest, not the first found.
  const seat = Array.isArray(seats)
    ? seats
        .filter((s) => hex(s.occupant) === me)
        .reduce((best, s) => (!best || Number(s.table_id) > Number(best.table_id) ? s : best), null)
    : null
  const careerRow = Array.isArray(career) ? career.find((c) => hex(c.identity) === me) || null : null
  const pool = Array.isArray(pillarPool)
    ? pillarPool.find((p) => hex(p.identity) === me)?.esms ?? null
    : null
  return {
    identity: me || null,
    arenaTokens: player ? Number(player.tokens ?? 0) : null,
    wordWins: player ? Number(player.word_wins ?? 0) : null,
    jing: foldDuelRows(jingDuels, me),
    pillars: foldDuelRows(pillarDuels, me),
    pillarPool: Array.isArray(pool) && pool.length === 4 ? pool.map((v) => Math.round(Number(v) * 1e4) / 1e4) : null,
    seat: seat
      ? {
          tableId: String(seat.table_id),
          counters: Number(seat.counters ?? 0),
          melds: Number(seat.melds_value ?? 0),
          score: Number(seat.score ?? 0),
        }
      : null,
    // Lifetime War Table record from `melee_career`. null = unreadable/offline;
    // a readable table with no row for this player is a zero record.
    career: Array.isArray(career)
      ? {
          tablesPlayed: Number(careerRow?.tables_played ?? 0),
          wins: Number(careerRow?.wins ?? 0),
          totalScore: Number(careerRow?.total_score ?? 0),
          bestScore: Number(careerRow?.best_score ?? 0),
          tricksWon: Number(careerRow?.tricks_won ?? 0),
          zonesCaptured: Number(careerRow?.zones_captured ?? 0),
        }
      : null,
  }
}

/** Accept only a well-formed v1 Vessel from the agents API. */
export function parseTreasury(body) {
  const v = body && body.ok ? body.vessel : null
  if (!v || v.version !== 1 || !v.balances || !v.streams) return null
  for (const s of VESSEL_STREAMS) {
    if (!Array.isArray(v.streams[s.key]?.ledgerEsms)) return null
  }
  return v
}

export function streamTotal(esms) {
  return Array.isArray(esms) ? Math.round(esms.reduce((a, b) => a + Number(b || 0), 0) * 1e4) / 1e4 : 0
}
