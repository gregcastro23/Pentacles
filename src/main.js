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
import { isAddress, getAddress } from 'viem'
import { toast, confirmToast } from './ui/toast.js'
import { initA11y } from './ui/a11y.js'
import spacetime from './net/spacetime.js'
import { initNetBadge } from './net/status-badge.js'

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

function boot() {
  initA11y()
  initNetBadge()
  // Attempt the live connection in the background; the badge reflects the result
  // and the game keeps running on local simulation either way.
  spacetime.connect().catch(() => {})
  // eslint-disable-next-line no-console
  console.info('[Pentacles] ESM layer ready (Vite) — v' + Pentacles.version)
}

// Deferred modules run during readyState "interactive", before DOMContentLoaded.
// Registering here makes initA11y run AFTER the classic app.js load handler
// (registered earlier), so dialog visibility + HologramCamera are settled.
if (document.readyState === 'complete') boot()
else document.addEventListener('DOMContentLoaded', boot)
