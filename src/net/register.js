// ============================================================
// Pentacles — live player registration (create_player)
// ============================================================
// Online, onboarding also registers a server-side player so cast_word (and the
// rest of the live game) works. The server overrides identity with ctx.sender
// and recomputes house cusps, so we send a ZERO identity + None house Options.
// Encoding validated against the live module: Identity is {__identity__:"0x…"},
// enums are {Variant:[]}, Option None is {none:[]}.

import spacetime from './spacetime.js'

const PLANET_NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']
const planetEnum = (idx) => ({ [PLANET_NAMES[idx] || 'Sun']: [] })
const ZERO_IDENTITY = { __identity__: '0x' + '0'.repeat(64) }

/** Map the client's computed chart → the module's NatalChart SATS-JSON. */
export function chartToNatal(chart, observer) {
  const placements = (chart?.placements || []).map((p) => ({
    body: planetEnum(p.body),
    sign: p.sign | 0,
    arc_minutes: p.arc_minutes | 0,
    retrograde: !!p.retrograde,
    dignity: p.dignity | 0,
  }))
  return {
    identity: ZERO_IDENTITY, // server overrides with ctx.sender
    birth_unix: Number(chart?.birth_unix) || 0,
    birth_lat: Number(observer?.lat ?? chart?.birth_lat ?? 0),
    birth_lon: Number(observer?.lon ?? chart?.birth_lon ?? 0),
    time_known: chart?.time_known !== false,
    placements,
    ascendant: chart?.ascendant | 0,
    midheaven: chart?.midheaven | 0,
    house_cusps: { none: [] }, // server recomputes via populate_houses
    house_system: { Placidus: [] },
    intercepted_signs: { none: [] },
  }
}

/**
 * Register the seeker on the live module: set_location (needed for the trace
 * region-commit) then create_player. Resolves {ok} or throws on a real failure.
 */
export async function registerLive(handle, chart, factionIdx, observer) {
  if (!spacetime.isLive) return { ok: false, reason: 'offline' }
  if (observer && Number.isFinite(observer.lat) && Number.isFinite(observer.lon)) {
    await spacetime.callReducer('set_location', [observer.lat, observer.lon]).catch(() => {})
  }
  await spacetime.callReducer('create_player', [handle, chartToNatal(chart, observer), planetEnum(factionIdx)])
  return { ok: true }
}

export default { chartToNatal, registerLive }
