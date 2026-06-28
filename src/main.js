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
import './alchm-chart/alchm-chart.css'
import * as dex from './web3/dex.js'
import { ESMS_DECIMALS } from './web3/esms.js'
import { makeTradeProvider } from './web3/chart-trade.js'
import { burner } from './web3/burner.js'

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
    if (window.toast) window.toast('Deploy needs a live connection — running local simulation.', { type: 'info', title: 'Faction War' })
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

// ── ✦ My Codex: the player's own natal profile + deck, in its own overlay ──
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
    console.error('[Pentacles] My Codex failed to mount', e)
    if (window.toast) window.toast('My Codex failed to open — see console.', { type: 'error' })
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

function boot() {
  initA11y()
  initNetBadge()
  // Attempt the live connection in the background; the badge reflects the result
  // and the game keeps running on local simulation either way.
  spacetime.connect()
    .then((isLive) => {
      if (isLive && window.state) {
        import('./net/restore.js')
          .then((m) => m.restoreProfileFromSpacetimeDB(spacetime, window.state))
          .catch((e) => console.warn('[Pentacles] Profile restore failed', e))
      }
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

  // eslint-disable-next-line no-console
  console.info('[Pentacles] ESM layer ready (Vite) — v' + Pentacles.version)
}

// Deferred modules run during readyState "interactive", before DOMContentLoaded.
// Registering here makes initA11y run AFTER the classic app.js load handler
// (registered earlier), so dialog visibility + HologramCamera are settled.
if (document.readyState === 'complete') boot()
else document.addEventListener('DOMContentLoaded', boot)
