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

// Planet is a unit C-style enum; SpacetimeDB 2.x encodes a sum value as
// { camelCaseVariant: [] } (lower-first-letter: Mars→mars). PascalCase is rejected.
function planetArg(idx) {
  const n = PLANET_NAMES[idx] || 'Sun'
  return { [n.charAt(0).toLowerCase() + n.slice(1)]: [] }
}

const sqlEscape = (s) => String(s).replace(/'/g, "''")

// The 98-tile bag — mirrors words::letter_for / the client letterFor so we can
// compute the player's rack from their (public) card ids.
const LETTER_BAG = [
  ['A', 9], ['B', 2], ['C', 2], ['D', 4], ['E', 12], ['F', 2], ['G', 3], ['H', 2], ['I', 9],
  ['J', 1], ['K', 1], ['L', 4], ['M', 2], ['N', 6], ['O', 8], ['P', 2], ['Q', 1], ['R', 6],
  ['S', 4], ['T', 6], ['U', 4], ['V', 2], ['W', 2], ['X', 1], ['Y', 2], ['Z', 1],
]
function letterFor(cardId) {
  let n = ((cardId % 98) + 98) % 98
  for (const [ch, c] of LETTER_BAG) {
    if (n < c) return ch
    n -= c
  }
  return 'E'
}
const sameIdentity = (a, b) =>
  a && b && String(a).toLowerCase().replace(/^0x/, '') === String(b).toLowerCase().replace(/^0x/, '')

/**
 * The live player's AUTHORITATIVE rack (letter counts) from the public card
 * table — what the server validates cast_word against (may differ from the
 * client's local collection).
 */
export async function getServerRack() {
  const id = spacetime.identity
  const rows = await spacetime.query('SELECT card_id, owner FROM card')
  const have = {}
  for (const r of rows) {
    const owner = r.owner && (r.owner.__identity__ ?? r.owner)
    if (id && owner && !sameIdentity(owner, id)) continue
    const ch = letterFor(Number(r.card_id))
    have[ch] = (have[ch] || 0) + 1
  }
  return have
}

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
    // SpacetimeDB SQL has no ORDER BY; fetch matches and find the unseen one.
    const rows = await spacetime
      .query(`SELECT * FROM word_duel WHERE player_word = '${sqlEscape(w)}'`)
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

export const duels = { castWordLive, getServerRack }
export default duels
