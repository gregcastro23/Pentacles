// ============================================================
// Pentacles — live Faction & Zone dashboards (Phase 5)
// ============================================================
// Online, the Faction Standings and Zones panels are driven by the subscribed
// `zone` and `star_node` tables (polled). There is no faction table — standings
// are DERIVED from zone ownership/control + per-star holdings (faction = Planet).
// Offline, the classic local renderers are kept intact as the fallback.
//
// NOTE: the SATS-JSON decoding of Option<Planet>/ZoneKind and the region→zone
// mapping (via star_node.region_hint) are version-specific and should be
// validated against a live host.

import spacetime from './spacetime.js'

// Hardcoded (modules can't see client.js's classic consts).
const PLANET_NAMES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']
const PLANET_GLYPHS = ['☉', '☽', '☿', '♀', '♂', '♃', '♄', '♅', '♆', '♇']
const PLANET_COLORS = ['#e8b84b', '#cbd0db', '#9aa7c4', '#d98fb0', '#cf4d4d', '#cf9a52', '#9a937c', '#5fb6c4', '#6470c8', '#8a6aa0']
const SIGN_SUITS = ['wands', 'pentacles', 'swords', 'cups', 'wands', 'pentacles', 'swords', 'cups', 'wands', 'pentacles', 'swords', 'cups']
const WEATHERS = ['Clear Sky', 'Meteor Shower', 'Solar Flare', 'Aether Eclipse', 'Galactic Wind']

let zoneCache = null
let starCache = null
let origLeaderboard = null
let origZones = null

// ---- enum decoding helpers -------------------------------------------------
function planetIndex(v) {
  if (v == null) return null
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const i = PLANET_NAMES.indexOf(v)
    return i >= 0 ? i : null
  }
  if (typeof v === 'object') {
    const key = Object.keys(v)[0]
    const i = PLANET_NAMES.indexOf(key)
    return i >= 0 ? i : null
  }
  return null
}
function kindName(v) {
  let s = v
  if (v && typeof v === 'object') s = Object.keys(v)[0]
  return String(s || '').toLowerCase()
}

// ---- live render -----------------------------------------------------------
function liveFlag(text) {
  return `<div class="dash-live">◉ live${text ? ' · ' + text : ''}</div>`
}

function renderLeaderboardLive() {
  const container = document.getElementById('leaderboard-container')
  if (!container) return
  if (!zoneCache) {
    container.innerHTML = liveFlag('') + `<div class="dash-loading">Syncing standings…</div>`
    return
  }
  // score = Σ positive control on owned zones  +  5 × stars held
  const score = Array.from({ length: 10 }, () => 0)
  for (const z of zoneCache) {
    const o = planetIndex(z.owner)
    if (o != null) score[o] += Math.max(0, Number(z.control) || 0)
  }
  if (starCache) {
    for (const s of starCache) {
      const h = planetIndex(s.held_by)
      if (h != null) score[h] += 5
    }
  }
  const myFaction = window.state?.player?.faction
  const ranked = score.map((s, id) => ({ id, score: s })).sort((a, b) => b.score - a.score)
  container.innerHTML =
    liveFlag('') +
    ranked
      .map(
        (item, i) =>
          `<div class="standings-item ${myFaction === item.id ? 'me' : ''}">
            <span>#${i + 1} &nbsp; ${PLANET_GLYPHS[item.id]} ${PLANET_NAMES[item.id]}</span>
            <span>${item.score} pts</span>
          </div>`
      )
      .join('')
}

function renderZonesListLive() {
  const container = document.getElementById('zones-list-container')
  if (!container) return
  if (!zoneCache) {
    container.innerHTML = liveFlag('') + `<div class="dash-loading">Syncing zones…</div>`
    return
  }
  const season = window.state?.seasonDegree || 0
  const starsByRegion = new Map()
  const heldByRegion = new Map()
  if (starCache) {
    for (const s of starCache) {
      const r = Number(s.region_hint)
      starsByRegion.set(r, (starsByRegion.get(r) || 0) + 1)
      if (planetIndex(s.held_by) != null) heldByRegion.set(r, (heldByRegion.get(r) || 0) + 1)
    }
  }
  const sorted = [...zoneCache].sort((a, b) => Number(a.zone_id) - Number(b.zone_id))
  container.innerHTML =
    liveFlag('') +
    sorted
      .map((z) => {
        const zid = Number(z.zone_id)
        const owner = planetIndex(z.owner)
        const ownerStr = owner != null ? `${PLANET_GLYPHS[owner]} ${PLANET_NAMES[owner]}` : 'Neutral'
        const fillCol = owner != null ? PLANET_COLORS[owner] : '#6a6c84'
        const kind = kindName(z.kind)
        const zoneName = kind === 'house' ? `House ${zid}` : kind === 'spire' ? `Spire ${zid}` : 'Crown Zenith'
        const control = Number(z.control) || 0
        const valPercent = ((control + 1000) / 2000) * 100
        const wIdx = (zid + Math.floor(season / 72)) % WEATHERS.length
        const stars = starsByRegion.get(zid) || 0
        const held = heldByRegion.get(zid) || 0
        const selected = window.state?.selectedZone === zid
        return `<div class="panel" style="padding:10px; cursor:pointer; border-color:${selected ? 'var(--gold-bright)' : 'var(--line)'}" onclick="selectZone(${zid})">
          <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:bold;">
            <span>${zoneName}</span><span style="color:${fillCol}">${ownerStr}</span>
          </div>
          <div style="font-size:10px; color:var(--dim); margin-top:2px;">
            Weather: ${WEATHERS[wIdx]} · Favored Suit: ${SIGN_SUITS[zid % 12].toUpperCase()} · control ${control}
          </div>
          <div style="font-size:10px; color:var(--dim); margin-top:2px;">
            ★ ${stars} stars overhead${held > 0 ? ` · ${held} claimed` : ''}
          </div>
          <div class="control-meter-bar"><div class="control-meter-fill" style="width:${valPercent}%; background:${fillCol};"></div></div>
        </div>`
      })
      .join('')
}

function repaintIfLive() {
  if (!spacetime.isLive) return
  renderLeaderboardLive()
  renderZonesListLive()
}

// ---- install ---------------------------------------------------------------
export function installDashboards() {
  origLeaderboard = window.renderLeaderboard
  origZones = window.renderZonesList

  window.renderLeaderboard = function () {
    if (spacetime.isLive) return renderLeaderboardLive()
    return origLeaderboard && origLeaderboard()
  }
  window.renderZonesList = function () {
    if (spacetime.isLive) return renderZonesListLive()
    return origZones && origZones()
  }

  // Drive live panels from the subscribed tables.
  spacetime.subscribe('zone', (rows) => {
    zoneCache = rows
    repaintIfLive()
  })
  spacetime.subscribe('star_node', (rows) => {
    starCache = rows
    repaintIfLive()
  })

  // When the connection flips live, switch the panels over.
  spacetime.onStatus((s) => {
    if (s === 'live') {
      try { window.renderLeaderboard(); window.renderZonesList() } catch {}
    }
  })
}

export default { installDashboards }
