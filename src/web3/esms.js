// ============================================================
// Pentacles — ESMS balances (live read + labeled simulation)
// ============================================================
// ESMS is a soulbound ERC-1155 (ids 0..3), 18 decimals by convention. We read
// the connected wallet's four balances via balanceOfBatch; with no wallet/chain
// we show clearly-tagged deterministic simulated balances.

import { formatUnits } from 'viem'
import { publicClient, ADDRESSES } from './chain.js'
import { ESMS_ABI } from './abis.js'

export const ESMS_DECIMALS = 18

// The four elements — matches client.js ESMS_NAMES/GLYPHS/COLORS exactly.
export const ESMS = [
  { id: 0, name: 'Spirit', glyph: '🜂', color: '#e0a23a' },
  { id: 1, name: 'Essence', glyph: '🜄', color: '#4aa3d8' },
  { id: 2, name: 'Matter', glyph: '🜃', color: '#5fb37a' },
  { id: 3, name: 'Substance', glyph: '🜁', color: '#b98cd6' },
]

/** Read the wallet's four ESMS balances from Base Sepolia. Returns formatted strings. */
export async function readEsmsBalances(address) {
  const accounts = [address, address, address, address]
  const ids = [0n, 1n, 2n, 3n]
  const raw = await publicClient.readContract({
    address: ADDRESSES.esms,
    abi: ESMS_ABI,
    functionName: 'balanceOfBatch',
    args: [accounts, ids],
  })
  return raw.map((b) => ({ raw: b, formatted: formatUnits(b, ESMS_DECIMALS) }))
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
