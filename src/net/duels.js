// ============================================================
// Pentacles — live Word Duels (Phase 4)
// ============================================================
// Online, castWord goes through the cast_word reducer instead of the local
// solver. The flow is async: cast_word inserts a duel_challenge, the duel-service
// feeder asks the planetary agent and calls answer_duel, which writes a word_duel
// row that we poll for. Offline, app.js falls back to the bundled solver.
//
// NOTE: the Planet enum SATS-JSON encoding and the word_duel match query are
// SpacetimeDB-version-specific and must be validated against a live host + a
// running duel-service feeder before this path is trusted.

import spacetime from './spacetime.js'

const PLANET_NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']

// Planet is a unit C-style enum; SATS JSON encodes a sum value as { Variant: [] }.
function planetArg(idx) {
  return { [PLANET_NAMES[idx] || 'Sun']: [] }
}

const sqlEscape = (s) => String(s).replace(/'/g, "''")

/**
 * Cast a word against a planetary agent on the live module and wait for the
 * server-scored reply. Returns the same shape as the offline solver result,
 * plus the agent's rationale.
 */
export async function castWordLive(word, opponentIdx, { timeoutMs = 35000, intervalMs = 2000 } = {}) {
  if (!spacetime.isLive) throw new Error('SpacetimeDB offline — cannot duel live.')
  const w = String(word).trim().toUpperCase()

  // Note existing duels for this word so we can detect the fresh reply.
  const before = await spacetime
    .query(`SELECT duel_id FROM word_duel WHERE player_word = '${sqlEscape(w)}'`)
    .catch(() => [])
  const seen = new Set(before.map((r) => String(r.duel_id)))

  await spacetime.callReducer('cast_word', [w, planetArg(opponentIdx)])

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs))
    const rows = await spacetime
      .query(`SELECT * FROM word_duel WHERE player_word = '${sqlEscape(w)}' ORDER BY created_at DESC LIMIT 3`)
      .catch(() => [])
    const fresh = rows.find((r) => !seen.has(String(r.duel_id)))
    if (fresh) {
      return {
        opponent: opponentIdx,
        playerWord: fresh.player_word,
        playerScore: Number(fresh.player_score),
        agentWord: fresh.agent_word || '',
        agentScore: Number(fresh.agent_score),
        won: !!fresh.won,
        tokens: Number(fresh.tokens_awarded),
        rationale: fresh.agent_rationale || null,
        at: Date.now(),
        live: true,
      }
    }
  }
  throw new Error('The planetary agent did not answer in time (is the duel-service feeder running?).')
}

export const duels = { castWordLive }
export default duels
