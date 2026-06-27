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
import { installDashboards } from './net/dashboards.js'
import wallet from './web3/wallet.js'
import { initEsmsHud } from './web3/hud.js'
import { installPoolsUI } from './web3/pools-ui.js'
import AlchmChart from './alchm-chart/index.js'
import './alchm-chart/alchm-chart.css'
import * as dex from './web3/dex.js'
import { ESMS_DECIMALS } from './web3/esms.js'

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
  }
}
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
  ov.onclick = (e) => { if (e.target === ov) closeAlchmChart() }
  acEsc = (e) => { if (e.key === 'Escape') closeAlchmChart() }
  document.addEventListener('keydown', acEsc)
}
function closeAlchmChart() {
  const ov = document.getElementById('alchm-overlay')
  if (ov) ov.classList.remove('is-open')
  if (acEsc) { document.removeEventListener('keydown', acEsc); acEsc = null }
}
window.openAlchmChart = openAlchmChart
window.closeAlchmChart = closeAlchmChart
Pentacles.openChart = openAlchmChart

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
