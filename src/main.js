// ============================================================
// Pentacles — ESM layer entry (bundled by Vite)
// ============================================================
// The legacy game runs as CLASSIC global scripts from public/
// (star-catalog.js, constellations.js, sky.js, client.js, app.js).
// This module is the seam where the new, npm-backed systems attach:
//   • toasts + accessibility helpers (cross-cutting)
//   • the live SpacetimeDB connection (Phase 1)
//   • the Dynamic wallet + ESMS HUD     (Phase 2)
//   • the on-chain Constellation DEX     (Phase 3)
// Each subsystem lands as a module imported here and bridges onto
// `window.Pentacles` so the existing inline `onclick="fn()"` handlers
// and the classic scripts can call it without being rewritten.

import { isAddress, getAddress } from 'viem'

const Pentacles = (window.Pentacles = window.Pentacles || {})
Pentacles.version = '0.1.0'

// Small shared utilities backed by real npm deps (proves the bundle graph).
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

// eslint-disable-next-line no-console
console.info('[Pentacles] ESM layer ready (Vite) — v' + Pentacles.version)
