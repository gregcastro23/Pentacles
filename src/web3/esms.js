// ============================================================
// Pentacles — ESMS balances (live Solana Token-2022 read + simulation)
// ============================================================

import { readSolanaEsmsBalances } from './solana.js'

export const ESMS_DECIMALS = 4 // Solana Token-2022 ASOL mints

// Canonical ADR-014 ESMS Token Definitions
export const ESMS = [
  {
    id: 0,
    key: 'spirit',
    name: 'SPIRIT',
    ticker: 'SPRT',
    symbol: '[SPRT]',
    glyph: '🝇',
    glyphTriangular: '🜂',
    glyphGeometric: '△',
    element: 'Fire',
    suit: 'Wands',
    color: '#e0a23a',
    description: 'Kinetic Gas, Combat Actions, Chat & Transmutation Power',
  },
  {
    id: 1,
    key: 'essence',
    name: 'ESSENCE',
    ticker: 'ESNC',
    symbol: '[ESNC]',
    glyph: '🝑',
    glyphTriangular: '🜄',
    glyphGeometric: '▽',
    element: 'Water',
    suit: 'Cups',
    color: '#4aa3d8',
    description: 'Emotional Liquidity, Oracle Inquiries & Alchemical Reaction Energy',
  },
  {
    id: 2,
    key: 'matter',
    name: 'MATTER',
    ticker: 'MATR',
    symbol: '[MATR]',
    glyph: '🝙',
    glyphTriangular: '🜃',
    glyphGeometric: '⯛',
    element: 'Earth',
    suit: 'Pentacles',
    color: '#5fb37a',
    description: 'Physical Manifestation, Star Staking & Territorial Anchor',
  },
  {
    id: 3,
    key: 'substance',
    name: 'SUBSTANCE',
    ticker: 'SUBS',
    symbol: '[SUBS]',
    glyph: '🝉',
    glyphTriangular: '🜁',
    glyphGeometric: '⯙',
    element: 'Air',
    suit: 'Swords',
    color: '#b98cd6',
    description: 'Mental Velocity, Word Duels & Elemental Reactivity',
  },
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
