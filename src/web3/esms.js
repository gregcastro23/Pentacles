// ============================================================
// Pentacles — ESMS balances (live Solana Token-2022 read + simulation)
// ============================================================

import { readSolanaEsmsBalances } from './solana.js'

export const ESMS_DECIMALS = 4 // Solana Token-2022 ASOL mints

// The four elements — matches client.js ESMS_NAMES/GLYPHS/COLORS exactly.
export const ESMS = [
  { id: 0, name: 'Spirit', glyph: '🜂', color: '#e0a23a' },
  { id: 1, name: 'Essence', glyph: '🜄', color: '#4aa3d8' },
  { id: 2, name: 'Matter', glyph: '🜃', color: '#5fb37a' },
  { id: 3, name: 'Substance', glyph: '🜁', color: '#b98cd6' },
]

/** Read the wallet's four ESMS balances from Solana Token-2022 mints. Returns formatted strings. */
export async function readEsmsBalances(solanaAddress) {
  if (!solanaAddress) return simEsmsBalances('guest')
  const rawBalances = await readSolanaEsmsBalances(solanaAddress)
  return rawBalances.map((atoms) => {
    const formatted = (Number(atoms) / 10_000).toFixed(2)
    return { raw: atoms, formatted }
  })
}

/** Deterministic, clearly-labeled simulated balances (stable per seed). */
export function simEsmsBalances(seed = 'guest') {
  let h = 2166136261
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0
  return ESMS.map(() => {
    h = (Math.imul(h, 1103515245) + 12345) >>> 0
    const amt = (5 + (h % 5000) / 100).toFixed(2) // ~5.00 – 55.00
    return { raw: null, formatted: amt }
  })
}
