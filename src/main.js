// ============================================================
// Pentacles — ESM layer entry (bundled by Vite)
// ============================================================
// The legacy game runs as CLASSIC global scripts from public/
// (star-catalog.js, constellations.js, sky.js, client.js, app.js).
// This module is the seam where the new, npm-backed systems attach:
//   • toasts + accessibility helpers     (cross-cutting)
//   • the live SpacetimeDB connection     (Phase 1)
//   • the Dynamic wallet + ESMS HUD       (Phase 2)
//   • the on-chain Constellation DEX       (Phase 3)
// Each subsystem bridges onto `window` / `window.Pentacles` so the existing
// inline `onclick="fn()"` handlers and classic scripts can call it.

import './ui/ui.css'
import { isAddress, getAddress, formatUnits } from 'viem'
import { toast, confirmToast } from './ui/toast.js'
import { initA11y } from './ui/a11y.js'
import spacetime from './net/spacetime.js'
import { initNetBadge } from './net/status-badge.js'
import { initAuth } from './net/auth.js'
import { initAuthButton } from './net/auth-button.js'
import duels from './net/duels.js'
import register from './net/register.js'
import deploy from './net/deploy.js'
import { installDashboards } from './net/dashboards.js'
import wallet from './web3/wallet.js'
import { initEsmsHud } from './web3/hud.js'
import { installPoolsUI } from './web3/pools-ui.js'
import AlchmChart from './alchm-chart/index.js'
import FactionWar from './alchm-chart/faction-war.js'
import MyCodex from './alchm-chart/my-codex.js'
import AdminTelemetry from './alchm-chart/admin-telemetry.js'
import './alchm-chart/alchm-chart.css'
import * as dex from './web3/dex.js'
import { ESMS_DECIMALS } from './web3/esms.js'
import { makeTradeProvider } from './web3/chart-trade.js'
import { burner, burnEsmsForJing } from './web3/burner.js'

const Pentacles = (window.Pentacles = window.Pentacles || {})
Pentacles.version = '0.2.0'

// Small shared utilities backed by real npm deps.
Pentacles.util = {
  isAddress,
  /** Checksum an address, or return null if it isn't a valid EVM address. */
  toChecksum(addr) {
    try {
      return isAddress(addr) ? getAddress(addr) : null
    } catch {
      return null
    }
  },
}

// Bridge the toast API onto the global scope so the classic scripts can call it
// exactly where alert()/confirm() used to live.
window.toast = toast
window.confirmToast = confirmToast
Pentacles.toast = toast
Pentacles.confirmToast = confirmToast

// Live SpacetimeDB connection (dual-mode). Exposed for later phases to read
// tables / call reducers; falls back silently to local simulation when offline.
Pentacles.net = spacetime

// Live Word Duels (cast_word → word_duel); app.js falls back to the offline solver.
Pentacles.duels = duels

// Live player registration (create_player) wired into onboarding by app.js.
Pentacles.register = register

// Live card deploy (deploy_card) — drag an Active card onto a zone to push your
// faction's control + garrison it. app.js routes zone-drops here when live.
Pentacles.deploy = deploy

// Wallet façade (injected now; Dynamic island layers on top in dynamic.js).
Pentacles.wallet = wallet

// ── ✦ Alchm Chart: the embeddable SMES landscape, mounted into a full-screen overlay ──
Pentacles.dex = dex
let acEsc = null
function acObserver() {
  const o = window.state && window.state.observer
  return o && Number.isFinite(o.lat) ? { lat: o.lat, lon: o.lon } : { lat: 40.7128, lon: -74.006 }
}
function acNatalProfile() {
  const ch = window.state && window.state.player && window.state.player.chart
  if (!ch) return null
  return {
    ...ch,
    birth_unix: Number(ch.birth_unix) || 0,
    birth_lat: Number(ch.birth_lat ?? acObserver().lat),
    birth_lon: Number(ch.birth_lon ?? acObserver().lon),
  }
}
function acProviders() {
  const sky = window.PentaclesSky || {}
  return {
    sky,
    chart: {
      mundane: (lat, lon, date, opts) => window.AstroWeather && window.AstroWeather.chartOfMoment(lat, lon, date, opts),
      natal: (date) => (window.buildRealNatal ? window.buildRealNatal(acNatalProfile(), date) : null),
      lonAt: (body, date) => (sky.lonAt ? sky.lonAt(body, date) : 0),
    },
    amm: {
      readAllPools: () => dex.readAllPools(),
      toNumber: (raw) => {
        try { return Number(formatUnits(raw ?? 0n, ESMS_DECIMALS)) } catch { return 0 }
      },
      onChange: (cb) => wallet.onChange(() => cb()),
    },
    wallet,
    trade: makeTradeProvider(),
    // City search for the chart's Observer Selector (free, keyless Open-Meteo).
    geocode: async (q) => {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`
      const r = await fetch(url)
      if (!r.ok) throw new Error('geocode http ' + r.status)
      const j = await r.json()
      return (j.results || []).map((c) => ({
        name: c.name,
        label: [c.name, c.admin1, c.country_code].filter(Boolean).join(', '),
        lat: c.latitude, lon: c.longitude,
      }))
    },
  }
}
Pentacles.burner = burner
Pentacles.burnEsmsForJing = burnEsmsForJing
function openAlchmChart() {
  const ov = document.getElementById('alchm-overlay')
  const host = document.getElementById('alchm-chart-host')
  if (!ov || !host) return
  try {
    if (!Pentacles.chart) {
      Pentacles.chart = AlchmChart.create({
        el: host,
        providers: acProviders(),
        pools: (window.PentaclesSky || {}).CONSTELLATIONS,
        observer: acObserver(),
        // "Add birth chart" CTA (natal empty state) → close chart, open onboarding.
        onRequestNatal: () => {
          closeAlchmChart()
          const ob = document.getElementById('onboarding-overlay')
          if (ob) {
            ob.style.display = 'flex'
            const s1 = document.getElementById('onboarding-step-1'), s2 = document.getElementById('onboarding-step-2')
            if (s1) s1.style.display = 'flex'
            if (s2) s2.style.display = 'none'
          }
        },
      })
      Pentacles.chart.mount()
    } else {
      Pentacles.chart.update({ date: new Date(), observer: acObserver() })
      Pentacles.chart.refreshPools()
    }
  } catch (e) {
    console.error('[Pentacles] Alchm Chart failed to mount', e)
    if (window.toast) window.toast('Alchm Chart failed to open — see console.', { type: 'error' })
    return
  }
  ov.classList.add('is-open')
  document.body.classList.add('alchm-open')
  ov.onclick = (e) => { if (e.target === ov) closeAlchmChart() }
  acEsc = (e) => { if (e.key === 'Escape') closeAlchmChart() }
  document.addEventListener('keydown', acEsc)
}
function closeAlchmChart() {
  const ov = document.getElementById('alchm-overlay')
  if (ov) ov.classList.remove('is-open')
  document.body.classList.remove('alchm-open')
  if (acEsc) { document.removeEventListener('keydown', acEsc); acEsc = null }
}
window.openAlchmChart = openAlchmChart
window.closeAlchmChart = closeAlchmChart
Pentacles.openChart = openAlchmChart

// ── ✦ Faction War: the always-on planetary-agent war, in its own overlay ──
const WAR_PLANETS = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']
let warInst = null, warEsc = null
/** The local player's faction idx (0–9), or null — read from the classic app state. */
function warMyFaction() {
  try {
    const f = window.state && window.state.player && window.state.player.faction
    if (f == null) return null
    if (typeof f === 'number') return f >= 0 && f < 10 ? f : null
    const i = WAR_PLANETS.findIndex((n) => n.toLowerCase() === String(f).toLowerCase())
    return i >= 0 ? i : null
  } catch { return null }
}
/** The local player's Active hand (full card objects) — the deployable cards. */
function warActiveCards() {
  try {
    const st = window.state
    if (!st || !Array.isArray(st.deck) || !Array.isArray(st.collection)) return []
    const activeIds = new Set(st.deck.filter((d) => d.loadout === 'active').map((d) => Number(d.card_id)))
    return st.collection.filter((c) => activeIds.has(Number(c.card_id)))
  } catch { return null }
}
/** Deploy a card onto a zone; keep local loadout state in sync (card → Defense). */
async function warDeploy(cardId, zoneId) {
  if (!Pentacles.deploy || !(spacetime && spacetime.isLive)) {
    if (window.toast) window.toast('Deploying a card needs a live connection — reconnect and try again.', { type: 'info', title: 'Faction War' })
    return { ok: false, reason: 'offline' }
  }
  await Pentacles.deploy.deployCardLive(cardId, zoneId)
  // Mirror the server: the deployed card leaves Active for the Defense garrison.
  try {
    const slot = window.state && window.state.deck && window.state.deck.find((d) => Number(d.card_id) === Number(cardId))
    if (slot) { slot.loadout = 'defense'; if (typeof window.state.save === 'function') window.state.save() }
  } catch {}
  return { ok: true }
}
function openFactionWar() {
  let ov = document.getElementById('aw-overlay')
  if (!ov) {
    ov = document.createElement('div')
    ov.id = 'aw-overlay'
    const win = document.createElement('div'); win.className = 'aw-window'
    const close = document.createElement('button'); close.className = 'aw-window-close'; close.textContent = '✕'
    close.setAttribute('aria-label', 'Close'); close.onclick = closeFactionWar
    const host = document.createElement('div'); host.id = 'aw-host'
    win.appendChild(close); win.appendChild(host); ov.appendChild(win)
    document.body.appendChild(ov)
  }
  try {
    if (warInst) warInst.destroy()
    warInst = FactionWar.create({
      el: document.getElementById('aw-host'),
      spacetime,
      myFaction: warMyFaction(),
      myCards: warActiveCards(),
      hooks: {
        // Drag a card onto a zone → deploy_card (control push + Defense garrison).
        onDeploy: (cardId, zoneId) => warDeploy(cardId, zoneId),
        // Faction is bound at registration (create_player); there is no live
        // switch reducer, so "join" routes a non-player to onboarding.
        onJoin: (idx, name) => {
          closeFactionWar()
          if (window.toast) window.toast(`Forge your chart to ride with ${name}.`, { type: 'info', title: 'Faction War' })
          const ob = document.getElementById('onboarding-overlay')
          if (ob) {
            ob.style.display = 'flex'
            const s1 = document.getElementById('onboarding-step-1'), s2 = document.getElementById('onboarding-step-2')
            if (s1) s1.style.display = 'flex'
            if (s2) s2.style.display = 'none'
          }
        },
      },
    })
    warInst.mount()
    // Belt-and-suspenders initial paint if a one-shot read is available.
    if (spacetime && spacetime.isLive && spacetime.fetchTable) {
      Promise.all(['zone', 'player', 'agent_chart'].map((t) => spacetime.fetchTable(t).catch(() => [])))
        .then(([zones, players, agents]) => warInst && warInst.setData({ zones, players, agents }))
        .catch(() => {})
    }
  } catch (e) {
    console.error('[Pentacles] Faction War failed to mount', e)
    if (window.toast) window.toast('Faction War failed to open — see console.', { type: 'error' })
    return
  }
  ov.classList.add('is-open')
  document.body.classList.add('alchm-open')
  ov.onclick = (e) => { if (e.target === ov) closeFactionWar() }
  warEsc = (e) => { if (e.key === 'Escape') closeFactionWar() }
  document.addEventListener('keydown', warEsc)
}
function closeFactionWar() {
  const ov = document.getElementById('aw-overlay')
  if (ov) ov.classList.remove('is-open')
  document.body.classList.remove('alchm-open')
  if (warInst) { try { warInst.destroy() } catch {} warInst = null }
  if (warEsc) { document.removeEventListener('keydown', warEsc); warEsc = null }
}
window.openFactionWar = openFactionWar
window.closeFactionWar = closeFactionWar
Pentacles.openWar = openFactionWar

// ── ✦ Deck: the player's natal profile + full card collection ──
let codexInst = null, codexEsc = null
function openMyCodex() {
  let ov = document.getElementById('mc-overlay')
  if (!ov) {
    ov = document.createElement('div')
    ov.id = 'mc-overlay'
    const win = document.createElement('div'); win.className = 'mc-window'
    const close = document.createElement('button'); close.className = 'mc-window-close'; close.textContent = '✕'
    close.setAttribute('aria-label', 'Close'); close.onclick = closeMyCodex
    const host = document.createElement('div'); host.id = 'mc-host'
    win.appendChild(close); win.appendChild(host); ov.appendChild(win)
    document.body.appendChild(ov)
  }
  try {
    if (codexInst) codexInst.destroy()
    codexInst = MyCodex.create({
      el: document.getElementById('mc-host'),
      hooks: {
        // "Tip the Scales" → carry the player into the live war board (deploy lives there).
        onTip: () => { closeMyCodex(); openFactionWar() },
        // No chart yet → route to onboarding to forge one.
        onForge: () => {
          closeMyCodex()
          const ob = document.getElementById('onboarding-overlay')
          if (ob) {
            ob.style.display = 'flex'
            const s1 = document.getElementById('onboarding-step-1'), s2 = document.getElementById('onboarding-step-2')
            if (s1) s1.style.display = 'flex'
            if (s2) s2.style.display = 'none'
          }
        },
      },
    })
    codexInst.mount()
  } catch (e) {
    console.error('[Pentacles] Deck failed to mount', e)
    if (window.toast) window.toast('Deck failed to open — see console.', { type: 'error' })
    return
  }
  ov.classList.add('is-open')
  document.body.classList.add('alchm-open')
  ov.onclick = (e) => { if (e.target === ov) closeMyCodex() }
  codexEsc = (e) => { if (e.key === 'Escape') closeMyCodex() }
  document.addEventListener('keydown', codexEsc)
}
function closeMyCodex() {
  const ov = document.getElementById('mc-overlay')
  if (ov) ov.classList.remove('is-open')
  document.body.classList.remove('alchm-open')
  if (codexInst) { try { codexInst.destroy() } catch {} codexInst = null }
  if (codexEsc) { document.removeEventListener('keydown', codexEsc); codexEsc = null }
}
window.openMyCodex = openMyCodex
window.closeMyCodex = closeMyCodex
Pentacles.openCodex = openMyCodex

// ── ✦ The Observatory: admin-only telemetry console ──
// Expose the live client so the telemetry model can default to it (console use).
window.__spacetime = spacetime
const ADMIN_EMAIL = 'gregcastro23@gmail.com'
const ADMIN_KEY = 'pentacles_admin'
// Authoritative gate: this client IS the SpacetimeDB module owner. Verified live
// against game_config.owner on connect (see verifyOwnerIdentity). The email /
// localStorage / ?admin paths remain as a convenience for offline/dev use.
let ownerUnlocked = false

const sameId = (a, b) =>
  !!a && !!b && String(a).replace(/^0x/, '').toLowerCase() === String(b).replace(/^0x/, '').toLowerCase()

/** Already-unlocked? Owner-identity match (authoritative), env allowlist, or email. */
function isAdmin() {
  try {
    if (ownerUnlocked) return true
    const envId = import.meta.env && import.meta.env.VITE_ADMIN_IDENTITY
    if (envId && sameId(spacetime.identity, envId)) return true
    if (localStorage.getItem(ADMIN_KEY) === ADMIN_EMAIL) return true
    const qp = new URLSearchParams(location.search)
    if (qp.has('admin') && qp.get('admin') === ADMIN_EMAIL) { localStorage.setItem(ADMIN_KEY, ADMIN_EMAIL); return true }
  } catch {}
  return false
}

/** Live owner check: if our identity == game_config.owner, this is the real admin. */
async function verifyOwnerIdentity() {
  try {
    if (!spacetime.isLive || !spacetime.identity) return false
    const rows = await spacetime.query('SELECT owner FROM game_config')
    const owner = rows && rows[0] && (rows[0].owner?.__identity__ ?? rows[0].owner)
    if (sameId(spacetime.identity, owner)) {
      ownerUnlocked = true
      revealAdminButton()
      return true
    }
  } catch {}
  return false
}
/** Gate: unlock if already admin, else prompt once for the admin email. */
function ensureAdmin() {
  if (isAdmin()) return true
  let entered = null
  try { entered = window.prompt('Admin email to unlock The Observatory:') } catch {}
  if (entered && entered.trim().toLowerCase() === ADMIN_EMAIL) {
    try { localStorage.setItem(ADMIN_KEY, ADMIN_EMAIL) } catch {}
    revealAdminButton()
    return true
  }
  if (entered != null && window.toast) window.toast('Not authorized for the admin console.', { type: 'error', title: 'The Observatory' })
  return false
}
/** Show the gated nav button once we know this client is the admin. */
function revealAdminButton() {
  const btn = document.getElementById('observatory-btn')
  if (btn) btn.style.display = ''
}

let obsInst = null, obsEsc = null
function openAdminTelemetry() {
  if (!ensureAdmin()) return
  let ov = document.getElementById('obs-overlay')
  if (!ov) {
    ov = document.createElement('div')
    ov.id = 'obs-overlay'
    const win = document.createElement('div'); win.className = 'obs-window'
    const close = document.createElement('button'); close.className = 'obs-window-close'; close.textContent = '✕'
    close.setAttribute('aria-label', 'Close'); close.onclick = closeAdminTelemetry
    const host = document.createElement('div'); host.id = 'obs-host'
    win.appendChild(close); win.appendChild(host); ov.appendChild(win)
    document.body.appendChild(ov)
  }
  try {
    if (obsInst) obsInst.destroy()
    obsInst = AdminTelemetry.create({ el: document.getElementById('obs-host'), spacetime })
    obsInst.mount()
  } catch (e) {
    console.error('[Pentacles] The Observatory failed to mount', e)
    if (window.toast) window.toast('The Observatory failed to open — see console.', { type: 'error' })
    return
  }
  ov.classList.add('is-open')
  document.body.classList.add('alchm-open')
  ov.onclick = (e) => { if (e.target === ov) closeAdminTelemetry() }
  obsEsc = (e) => { if (e.key === 'Escape') closeAdminTelemetry() }
  document.addEventListener('keydown', obsEsc)
}
function closeAdminTelemetry() {
  const ov = document.getElementById('obs-overlay')
  if (ov) ov.classList.remove('is-open')
  document.body.classList.remove('alchm-open')
  if (obsInst) { try { obsInst.destroy() } catch {} obsInst = null }
  if (obsEsc) { document.removeEventListener('keydown', obsEsc); obsEsc = null }
}
window.openAdminTelemetry = openAdminTelemetry
window.closeAdminTelemetry = closeAdminTelemetry
Pentacles.openObservatory = openAdminTelemetry
// Hidden hotkey: ⌘/Ctrl + Shift + O opens the console from anywhere.
document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'O' || e.key === 'o')) { e.preventDefault(); openAdminTelemetry() }
})

function boot() {
  initA11y()
  initNetBadge()
  initAuthButton()
  // Reveal the admin console entry only for the unlocked admin client.
  if (isAdmin()) revealAdminButton()
  // Attempt the live connection in the background; the badge reflects the result
  // and the game keeps running on local simulation either way.
  spacetime.connect()
    .then(async (isLive) => {
      // If a shared Google session exists, adopt it and carry the anonymous
      // profile over (link/claim) BEFORE restore, then continue with whichever
      // identity we end up on. Best-effort: stays anonymous if anything fails.
      try { await initAuth() } catch (e) { console.warn('[Pentacles] Auth init failed', e) }
      const live = spacetime.isLive
      if (live && window.state) {
        import('./net/restore.js')
          .then((m) => m.restoreProfileFromSpacetimeDB(spacetime, window.state))
          .catch((e) => console.warn('[Pentacles] Profile restore failed', e))
      }
      // Authoritative admin unlock: are we the module owner identity?
      if (live) verifyOwnerIdentity().catch(() => {})
    })
    .catch(() => {})

  // ESMS balance HUD (live balanceOfBatch when a wallet is on Base Sepolia, else
  // labeled simulation). Silent reconnect if the user connected before.
  Pentacles.esmsHud = initEsmsHud()
  wallet.tryReconnect().catch(() => {})

  // Constellation DEX: replace the dead PentaclesBridge stub with the real panel
  // (runs after the classic app.js defined renderPoolsPanel/traceConstellation).
  installPoolsUI()
  if (document.getElementById('tab-pools')?.classList.contains('active')) {
    window.renderPoolsPanel?.()
  }

  // Faction Standings + Zones: live from subscribed tables when online, classic
  // local derivation otherwise.
  installDashboards()

  // Optional Dynamic React island — only when VITE_DYNAMIC_ENV_ID is configured.
  if (import.meta.env.VITE_DYNAMIC_ENV_ID) {
    import('./web3/dynamic.js')
      .then((m) => m.mountDynamic())
      .catch((e) => console.warn('[Pentacles] Dynamic island failed to load', e))
  }

   
  console.info('[Pentacles] ESM layer ready (Vite) — v' + Pentacles.version)
}

// Deferred modules run during readyState "interactive", before DOMContentLoaded.
// Registering here makes initA11y run AFTER the classic app.js load handler
// (registered earlier), so dialog visibility + HologramCamera are settled.
if (document.readyState === 'complete') boot()
else document.addEventListener('DOMContentLoaded', boot)
