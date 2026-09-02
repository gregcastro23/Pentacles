// ============================================================
// Pentacles — Alchm Chart trade provider (Solana-native)
// ============================================================
// The bridge the chart calls to quote and execute trades on constellation pools.

import { ESMS, ESMS_DECIMALS, readEsmsBalances } from './esms.js'
import { quoteSwap, toEsms, swap as execSwap } from './dex.js'
import wallet from './wallet.js'

export function makeTradeProvider() {
  return {
    capabilities: () => ({ sponsored: false, solana: true }),
    address: () => wallet.solanaAddress,
    traderAddress: () => wallet.solanaAddress,
    esmsMeta: ESMS,

    /** The trading account's four ESMS balances as numbers. */
    async esmsBalances() {
      try {
        const r = await readEsmsBalances(wallet.solanaAddress)
        return r.map((b, i) => ({
          id: i,
          name: ESMS[i].name,
          glyph: ESMS[i].glyph,
          color: ESMS[i].color,
          raw: b.raw,
          num: Number(b.formatted),
        }))
      } catch {
        return ESMS.map((m, i) => ({
          id: i,
          name: m.name,
          glyph: m.glyph,
          color: m.color,
          raw: 0n,
          num: 0,
          error: true,
        }))
      }
    },

    /** Quote an exact-in swap; returns {outNum, outRaw, impact} or null. */
    async quote(pool, inId, inAmtHuman) {
      const inAmt = toEsms(inAmtHuman)
      if (inAmt <= 0n) return null
      const out = await quoteSwap(pool.constId, inId, inAmt)
      if (out == null) return null
      const outNum = Number(out) / (10 ** ESMS_DECIMALS)
      const inNum = Number(inAmtHuman)
      const spot = pool.spot
      let ideal = null
      if (spot) ideal = inId === pool.elemA ? inNum * spot : inNum / spot
      const impact = ideal && ideal > 0 ? Math.max(0, 1 - outNum / ideal) : null
      return { outNum, outRaw: out, impact }
    },

    /** Execute a swap on the constellation pool. */
    async swap({ pool, inId, inAmtHuman, slippageBps = 100 }) {
      const inAmt = toEsms(inAmtHuman)
      const out = await quoteSwap(pool.constId, inId, inAmt)
      const minOutAmt = (out ?? 0n) * BigInt(10000 - slippageBps) / 10000n
      return execSwap({ constId: pool.constId, inId, inAmt, minOutAmt })
    },
  }
}
