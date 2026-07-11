// ============================================================
// Pentacles — Alchm Chart trade provider
// ============================================================
// The bridge the (framework-agnostic) chart calls to trade a constellation pool:
// read the burner's ESMS balances, quote a swap, and execute it with SPONSORED
// gas. ESMS is soulbound + earned in-game, so the chart gates the swap UI on a
// non-zero balance; with zero it shows the earn-guidance instead.

import { formatUnits, encodeFunctionData } from 'viem'
import { ADDRESSES } from './chain.js'
import { AMM_ABI } from './abis.js'
import { ESMS, ESMS_DECIMALS, readEsmsBalances } from './esms.js'
import { quoteSwap, toEsms, minOut, awaitAttestationFor } from './dex.js'
import { burner } from './burner.js'
import spacetime from '../net/spacetime.js'

export function makeTradeProvider() {
  return {
    capabilities: () => burner.capabilities(),
    address: () => burner.address,
    traderAddress: () => burner.traderAddress(),
    esmsMeta: ESMS,

    /** The trading account's four ESMS balances as numbers. Balances are read
     * for traderAddress() — the smart account when sponsored gas is on — since
     * that is the account the AMM debits (msg.sender), and soulbound ESMS can
     * never be moved from the EOA to it. */
    async esmsBalances() {
      try {
        const r = await readEsmsBalances(await burner.traderAddress())
        return r.map((b, i) => ({ id: i, name: ESMS[i].name, glyph: ESMS[i].glyph, color: ESMS[i].color, raw: b.raw, num: Number(b.formatted) }))
      } catch {
        return ESMS.map((m, i) => ({ id: i, name: m.name, glyph: m.glyph, color: m.color, raw: 0n, num: 0, error: true }))
      }
    },

    /** Quote an exact-in swap; returns {outNum, outRaw, impact} or null. */
    async quote(pool, inId, inAmtHuman) {
      const inAmt = toEsms(inAmtHuman)
      if (inAmt <= 0n) return null
      const out = await quoteSwap(pool.constId, inId, inAmt)
      if (out == null) return null
      const outNum = Number(formatUnits(out, ESMS_DECIMALS))
      const inNum = Number(inAmtHuman)
      const spot = pool.spot // element B per element A
      let ideal = null
      if (spot) ideal = inId === pool.elemA ? inNum * spot : inNum / spot
      const impact = ideal && ideal > 0 ? Math.max(0, 1 - outNum / ideal) : null
      return { outNum, outRaw: out, impact }
    },

    /** Execute a sponsored swap (burner smart account + paymaster) after attestation. */
    async swap({ pool, inId, inAmtHuman, slippageBps = 100 }) {
      if (!burner.capabilities().sponsored) throw new Error('Sponsored gas isn’t configured (set VITE_BUNDLER_URL).')
      if (!spacetime.isLive) throw new Error('SpacetimeDB offline — can’t fetch a visibility attestation.')
      const trader = await burner.traderAddress()
      await spacetime.callReducer('trace_constellation', [pool.constId, trader])
      const att = await awaitAttestationFor(pool.constId, trader)
      const inAmt = toEsms(inAmtHuman)
      const out = await quoteSwap(pool.constId, inId, inAmt)
      const minOutAmt = minOut(out ?? 0n, slippageBps)
      const data = encodeFunctionData({
        abi: AMM_ABI,
        functionName: 'swap',
        args: [pool.constId, inId, inAmt, minOutAmt, {
          trader: att.trader, constellationId: att.constellationId, regionCommit: att.regionCommit,
          visibleStars: att.visibleStars, nonce: att.nonce, deadline: att.deadline,
        }, att.signature],
      })
      return burner.sendSponsored([{ to: ADDRESSES.amm, data }])
    },
  }
}
