// ============================================================
// Pentacles — Browser Polyfill Entry
// ============================================================
// Ensures Buffer and global are defined on window and globalThis
// before any dependency (e.g. @solana/web3.js) evaluates.

import { Buffer } from 'buffer'

if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer
  window.global = window.global || window
}

if (typeof globalThis !== 'undefined') {
  globalThis.Buffer = globalThis.Buffer || Buffer
  globalThis.global = globalThis.global || globalThis
}

export { Buffer }
