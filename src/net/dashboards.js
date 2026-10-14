// ============================================================
// Pentacles — live Faction & Zone dashboards (Phase 5)
// ============================================================
// Online, the Faction Standings and Zones panels are driven by subscribed chain
// tables only: `zone` and `star_node` (holdings), `faction_war_standing` (War
// Table decan points and crowns) and `war_state` (the decan those points belong
// to). Nothing local — simulated rounds, practice melees — is added to the live
// board (see live-standings.js). Offline, the classic local renderers are kept
// intact as the fallback.
//
// The SATS-JSON decoding of Option<Planet>/ZoneKind and the region→zone
// mapping (via star_node.region_hint) were validated against the live 2.6
// module (prod cookingwithcastrollc, 2026-07).

import spacetime from './spacetime.js'
import { PLANET_NAMES, kindName, liveStandings, planetIndex } from './live-standings.js'

// Hardcoded (modules can't see client.js's classic consts).
const PLANET_GLYPHS = ['☉', '☽', '☿', '♀', '♂', '♃', '♄', '♅', '♆', '♇']
const PLANET_COLORS = ['#e8b84b', '#cbd0db', '#9aa7c4', '#d98fb0', '#cf4d4d', '#cf9a52', '#9a937c', '#5fb6c4', '#6470c8', '#8a6aa0']
const SIGN_SUITS = ['wands', 'pentacles', 'swords', 'cups', 'wands', 'pentacles', 'swords', 'cups', 'wands', 'pentacles', 'swords', 'cups']
const WEATHERS = ['Clear Sky', 'Meteor Shower', 'Solar Flare', 'Aether Eclipse', 'Galactic Wind']

let zoneCache = null
let starCache = null
let standingCache = null // faction_war_standing rows; null until the first sync
let warStateCache = null // war_state rows
let origLeaderboard = null
let origZones = null

// ---- Server-side Decan Ledger sync (Railway) ------------------------------
const FEEDER_BACKEND_URL = (typeof window !== 'undefined' && window.FEEDER_BACKEND_URL)
  ? window.FEEDER_BACKEND_URL
  : 'https://pentacles-feeders-production.up.railway.app'

let lastLedgerSync = 0
export async function syncServerDecanLedger() {
  const now = Date.now()
  if (now - lastLedgerSync < 15_000) return // Throttle to 15s
  lastLedgerSync = now

  try {
    const res = await fetch(`${FEEDER_BACKEND_URL}/api/v1/war/decan-ledger`, {
      headers: { Accept: 'application/json' }
    })
    if (!res.ok) return
    const data = await res.json()
    if (data?.success && window.state && typeof window.state.syncDecanLedger === 'function') {
      // Live, standings come from faction_war_standing; the ledger only supplies
      // the decan history and recent rounds, never points or crowns.
      window.state.syncDecanLedger(spacetime.isLive ? ledgerHistoryOnly(data) : data)
      // Through the dispatcher: offline this must repaint the classic board, not
      // paint "live · syncing" over it.
      if (typeof window.renderLeaderboard === 'function') window.renderLeaderboard()
    }
  } catch {
    // Non-blocking: fallback gracefully to local simulation state
  }
}

/** The parts of a decan-ledger payload the live board still takes from HTTP. */
export function ledgerHistoryOnly(data) {
  const out = { success: true }
  if (Array.isArray(data?.decanHistory)) out.decanHistory = data.decanHistory
  if (Array.isArray(data?.recentRounds)) out.recentRounds = data.recentRounds
  return out
}

/** The client's own Sun decan (0..35) from the local ephemeris, or null before it runs. */
function sunDecan() {
  const st = window.state
  const lon = st && typeof st.sunLongitude === 'function' ? st.sunLongitude() : null
  if (lon == null || typeof window.getDecanInfo !== 'function') return null
  const d = window.getDecanInfo(lon)
  return d && Number.isInteger(d.absDecan) ? d.absDecan : null
}

/** The live board from chain rows, or null before the zones have synced. */
export function currentLiveStandings() {
  if (!zoneCache) return null
  return liveStandings({
    zones: zoneCache,
    stars: starCache,
    standings: standingCache,
    warState: warStateCache,
    sunDecan: sunDecan(),
  })
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
  const live = currentLiveStandings()
  // Render live decan battle banner if container exists
  const banner = document.getElementById('decan-status-banner')
  if (banner && typeof window.state?.getCurrentDecan === 'function') {
    const decan = window.state.getCurrentDecan()
    const rulerCol = PLANET_COLORS[decan.rulerFaction] || 'var(--gold)'
    banner.innerHTML = `
      <div style="background: rgba(216,180,106,0.08); border: 1px solid rgba(216,180,106,0.25); border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; font-size: 11px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
          <span style="font-weight: bold; color: var(--gold-bright); font-size: 12px;">🎴 ${decan.card}</span>
          <span style="font-family: var(--font-mono); color: #ffd700; font-size: 11px; font-weight: bold;">☉ ${decan.degInSign}° ${decan.signGlyph}</span>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; color: var(--dim); font-size: 10px; margin-bottom: 6px;">
          <span>${decan.startDeg}°–${decan.endDeg}° ${decan.signName} (10-day round)</span>
          <span style="color: ${rulerCol}; font-weight: 600;">Ruler: ${decan.rulerGlyph} ${decan.rulerName}</span>
        </div>
        <div style="width: 100%; height: 5px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
          <div style="width: ${decan.progressPct}%; height: 100%; background: linear-gradient(90deg, #d8b46a, #ffd700); border-radius: 3px; transition: width 0.3s ease;"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size: 9.5px; color: var(--dim); margin-top: 4px;">
          <span>Bounds: ${decan.startDeg}°</span>
          <span style="color: #fff; font-weight: 500;">${decan.degInDecan}° / 10° (${decan.progressPct}%)</span>
          <span>${decan.endDeg}°</span>
        </div>
        ${warClockNote(live)}
      </div>
    `
  }

  const myFaction = window.state?.player?.faction
  container.innerHTML =
    liveFlag(live.standingsSynced ? '' : 'War Table standings not synced') +
    live.ranked
      .map(
        (item) => {
          const crowns = item.decanCrowns
          return `<div class="standings-item ${myFaction === item.id ? 'me' : ''}">
            <div style="display:flex; align-items:center; gap:6px;">
              <span>#${item.rank} &nbsp; ${PLANET_GLYPHS[item.id]} ${PLANET_NAMES[item.id]}</span>
              ${crowns > 0 ? `<span style="font-size:9.5px; color:#ffd700; background:rgba(255,215,0,0.15); padding:1px 5px; border-radius:10px; border:1px solid rgba(255,215,0,0.3);" title="${crowns} decan crown${crowns === 1 ? '' : 's'}">👑 ${crowns}</span>` : ''}
            </div>
            <span title="${item.decanPoints} War Table points this decan">${item.score} pts</span>
          </div>`
        }
      )
      .join('')
}

// When the module's war clock is not on the Sun's decan, its decan points are
// left off the board (they belong to another decan, and the module zeroes them
// when it crowns); say so rather than show a silent drop.
function warClockNote(live) {
  if (!live || !live.standingsSynced || live.chainDecan == null || live.decanIsCurrent || live.sunDecan == null) return ''
  const info = typeof window.getDecanInfo === 'function' ? window.getDecanInfo(live.chainDecan * 10 + 5) : null
  const label = info && info.card ? info.card : `decan ${live.chainDecan}`
  return `<div style="font-size: 9.5px; color: var(--dim); margin-top: 6px;">War Table clock is on ${label}, not the Sun's decan, so its decan points are left off the board.</div>`
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
  spacetime.subscribe('faction_war_standing', (rows) => {
    standingCache = rows
    repaintIfLive()
  })
  spacetime.subscribe('war_state', (rows) => {
    warStateCache = rows
    repaintIfLive()
  })
  // Faction dossier pages read the same chain-only board while live.
  window.Pentacles = window.Pentacles || {}
  window.Pentacles.liveStandings = currentLiveStandings

  // When the connection flips live, switch the panels over.
  spacetime.onStatus((s) => {
    if (s === 'live') {
      try { window.renderLeaderboard(); window.renderZonesList() } catch {}
      syncServerDecanLedger()
    }
  })

  // Periodically sync server decan ledger (every 30s)
  syncServerDecanLedger()
  setInterval(syncServerDecanLedger, 30_000)
}

export default { installDashboards, currentLiveStandings }
