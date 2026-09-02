// ============================================================
// Pentacles — Constellation DEX logic (Solana-native / dual-mode)
// ============================================================
// Read and quote paths for Constellation AMM pools. Write paths
// interface with SpacetimeDB horizon trace verification and Solana StarVaults.

import { wallet } from './wallet.js'
import { ESMS_DECIMALS } from './esms.js'
import { simAllPools, simQuote, simSwap, simSeed, simWithdraw, simPositions } from './dex-sim.js'
import spacetime from '../net/spacetime.js'

export const NUM_POOLS = 12

export const fmtEsms = (raw) => {
  const n = Number(raw ?? 0n) / (10 ** ESMS_DECIMALS)
  if (!isFinite(n)) return '0'
  if (n >= 1000) return (n / 1000).toFixed(2) + 'k'
  if (n === 0) return '0'
  if (n < 0.01) return '<0.01'
  return n.toFixed(n < 10 ? 3 : 2)
}

export const toEsms = (human) => {
  const num = Number(human || '0')
  return BigInt(Math.round(num * (10 ** ESMS_DECIMALS)))
}

/** Read all 12 pools. Returns simulated/cached pool states. */
export async function readAllPools() {
  const meta = Array.from({ length: NUM_POOLS }, (_, id) => ({
    constId: id,
    pair: [id % 4, (id + 1) % 4],
    feeBps: 30,
  }))
  return simAllPools(meta)
}

/** Spot price of element B per element A (reserveB/reserveA), or null if empty. */
export function spotPrice(pool) {
  if (!pool || pool.reserveA === 0n || pool.reserveB == null) return null
  const a = Number(pool.reserveA) / (10 ** ESMS_DECIMALS)
  const b = Number(pool.reserveB) / (10 ** ESMS_DECIMALS)
  if (!a) return null
  return b / a
}

/** Quote for an exact-in swap; returns bigint outAmt or null. */
export async function quoteSwap(constId, inId, inAmt) {
  if (inAmt <= 0n) return null
  return simQuote(constId, inId, inAmt)
}

/** Price impact (0..1) comparing executed rate to the spot rate. */
export function priceImpact(pool, inId, inAmt, outAmt) {
  if (!pool || !outAmt || inAmt <= 0n) return null
  const inIsA = inId === pool.elemA
  const rIn = inIsA ? pool.reserveA : pool.reserveB
  const rOut = inIsA ? pool.reserveB : pool.reserveA
  if (rIn === 0n || rOut === 0n) return null
  const spotOut = (inAmt * rOut) / rIn
  if (spotOut === 0n) return null
  const impact = 1 - Number(outAmt) / Number(spotOut)
  return Math.max(0, impact)
}

export const minOut = (outAmt, slippageBps) =>
  (outAmt * BigInt(10000 - slippageBps)) / 10000n

export async function discoverPositions(trader) {
  if (!trader) return []
  return simPositions()
}

// ---- trace → attestation (SpacetimeDB) -------------------------------------
/** Ask the module to emit a trace_intent so the attestor signs a visibility attestation. */
export async function requestTrace(constId) {
  const sol = wallet.solanaAddress
  if (!sol) throw new Error('Connect a Solana wallet first.')
  if (!spacetime.isLive) throw new Error('SpacetimeDB offline — cannot request an attestation.')
  await spacetime.callReducer('trace_constellation', [constId, sol])
}

const identityHex = (v) => String(v?.__identity__ ?? v ?? '').toLowerCase().replace(/^0x/, '')
const sameIdentity = (a, b) => !!a && !!b && identityHex(a) === identityHex(b)

/** My newest trace_intent for this constellation. */
async function myLatestIntentId(constId) {
  const me = spacetime.identity
  if (!me) return null
  const rows = await spacetime
    .query(`SELECT * FROM trace_intent WHERE constellation_id = ${constId}`)
    .catch(() => [])
  const mine = rows
    .filter((r) => sameIdentity(r.trader, me))
    .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0))[0]
  return mine != null ? Number(mine.intent_id) : null
}

export async function awaitAttestationFor(constId, trader, { timeoutMs = 30000, intervalMs = 2500 } = {}) {
  const deadline = Date.now() + timeoutMs
  let intentId = null
  while (Date.now() < deadline) {
    if (intentId == null) intentId = await myLatestIntentId(constId)
    if (intentId != null) {
      const rows = await spacetime
        .query(`SELECT * FROM trace_attestation WHERE intent_id = ${intentId}`)
        .catch(() => [])
      const row = rows[0]
      if (row && row.signature) {
        return {
          trader,
          constellationId: constId,
          regionCommit: row.region_commit,
          visibleStars: Number(row.visible_stars),
          nonce: BigInt(row.nonce),
          deadline: BigInt(row.deadline),
          signature: row.signature,
        }
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('Timed out waiting for the sky-feeder attestation.')
}

export async function awaitAttestation(constId, opts = {}) {
  return awaitAttestationFor(constId, wallet.solanaAddress, opts)
}

export async function seedLiquidity({ constId, amtA, amtB }) {
  return simSeed(constId, amtA, amtB)
}

export async function swap({ constId, inId, inAmt, minOutAmt }) {
  return simSwap(constId, inId, inAmt, minOutAmt)
}

export async function withdraw(deedId, shareBps) {
  return simWithdraw(deedId, shareBps)
}

export function explainRevert(err) {
  return err?.message || String(err)
}
