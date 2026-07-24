// ============================================================
// Pentacles — live card deploy into the faction war
// ============================================================
// Dragging an Active card onto a zone calls the deploy_card reducer: it pushes
// the player's faction control on that zone (offense) AND converts the card into
// the faction's Defense sentinel garrison (defense vs rival raids). card_id and
// zone_id are plain numbers — the faction is derived server-side from ctx.sender,
// so (unlike duels) there is NO Planet enum to SATS-encode here.
import spacetime from './spacetime.js'

/** Deploy a card onto a zone. Resolves {ok} or throws on a real reducer error. */
export async function deployCardLive(cardId, zoneId) {
  if (!spacetime.isLive) return { ok: false, reason: 'offline' }
  await spacetime.callReducer('deploy_card', [Number(cardId), Number(zoneId)])
  return { ok: true }
}

/** Strike a star directly with a single card. Resolves {ok} or throws on a real reducer error. */
export async function strikeStarSingleLive(hipId, cardId) {
  if (!spacetime.isLive) return { ok: false, reason: 'offline' }
  await spacetime.callReducer('strike_star_single', [Number(hipId), Number(cardId)])
  return { ok: true }
}

export default { deployCardLive, strikeStarSingleLive }

