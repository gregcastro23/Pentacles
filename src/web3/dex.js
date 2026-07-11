// ============================================================
// Pentacles — Constellation DEX logic (Phase 3)
// ============================================================
// Read paths (pools/reserves/quote/nonce/deed discovery) run against the live
// Base Sepolia AMM via viem and are verifiable now. Write paths (trace→seed,
// swap, withdraw) require a wallet on Base Sepolia (and, for trace, the live
// SpacetimeDB feeder); they're built defensively and degrade to a labeled
// simulation when offline. ESMS uses 18 decimals.

import {
  parseUnits,
  formatUnits,
  BaseError,
  ContractFunctionRevertedError,
} from 'viem'
import { publicClient, ADDRESSES, CHAIN } from './chain.js'
import { AMM_ABI, DEED_ABI, AMM_ERROR_TEXT } from './abis.js'
import { wallet } from './wallet.js'
import { ESMS_DECIMALS } from './esms.js'
import spacetime from '../net/spacetime.js'

export const NUM_POOLS = 12

export const fmtEsms = (raw) => {
  const n = Number(formatUnits(raw ?? 0n, ESMS_DECIMALS))
  if (!isFinite(n)) return '0'
  if (n >= 1000) return (n / 1000).toFixed(2) + 'k'
  if (n === 0) return '0'
  if (n < 0.01) return '<0.01'
  return n.toFixed(n < 10 ? 3 : 2)
}
export const toEsms = (human) => parseUnits(String(human || '0'), ESMS_DECIMALS)

// ---- batched live reads ----------------------------------------------------
/** Read all 12 pools in one multicall: {constId, elemA, elemB, feeBps, reserveA, reserveB, totalShares, exists}. */
export async function readAllPools() {
  const calls = Array.from({ length: NUM_POOLS }, (_, id) => ({
    address: ADDRESSES.amm,
    abi: AMM_ABI,
    functionName: 'pools',
    args: [id],
  }))
  const results = await publicClient.multicall({ contracts: calls, allowFailure: true })
  return results.map((r, id) => {
    if (r.status !== 'success') return { constId: id, exists: false, failed: true }
    const [elemA, elemB, feeBps, reserveA, reserveB, totalShares, exists] = r.result
    return {
      constId: id,
      elemA: Number(elemA),
      elemB: Number(elemB),
      feeBps: Number(feeBps),
      reserveA,
      reserveB,
      totalShares,
      exists,
    }
  })
}

/** Spot price of element B per element A (reserveB/reserveA), or null if empty. */
export function spotPrice(pool) {
  if (!pool || pool.reserveA === 0n || pool.reserveB == null) return null
  const a = Number(formatUnits(pool.reserveA, ESMS_DECIMALS))
  const b = Number(formatUnits(pool.reserveB, ESMS_DECIMALS))
  if (!a) return null
  return b / a
}

/** Live quote for an exact-in swap; returns bigint outAmt or null (empty pool reverts). */
export async function quoteSwap(constId, inId, inAmt) {
  if (inAmt <= 0n) return null
  try {
    return await publicClient.readContract({
      address: ADDRESSES.amm,
      abi: AMM_ABI,
      functionName: 'quote',
      args: [constId, inId, inAmt],
    })
  } catch {
    return null
  }
}

/** Price impact (0..1) comparing executed rate to the spot rate. */
export function priceImpact(pool, inId, inAmt, outAmt) {
  if (!pool || !outAmt || inAmt <= 0n) return null
  const inIsA = inId === pool.elemA
  const rIn = inIsA ? pool.reserveA : pool.reserveB
  const rOut = inIsA ? pool.reserveB : pool.reserveA
  if (rIn === 0n || rOut === 0n) return null
  const spotOut = (inAmt * rOut) / rIn // ideal out at spot (no fee/slippage)
  if (spotOut === 0n) return null
  const impact = 1 - Number(outAmt) / Number(spotOut)
  return Math.max(0, impact)
}

export const minOut = (outAmt, slippageBps) =>
  (outAmt * BigInt(10000 - slippageBps)) / 10000n

export async function readUsedNonce(constId, trader) {
  return publicClient.readContract({
    address: ADDRESSES.amm,
    abi: AMM_ABI,
    functionName: 'usedNonce',
    args: [constId, trader],
  })
}

// ---- LP position discovery (Deed is NOT enumerable) ------------------------
// Discover a wallet's deeds via the AMM's PoolSeeded(trader) event, then confirm
// current ownerOf (handles Deed transfers). We scan from the AMM's deploy block
// so no position is ever missed; public RPCs reject huge getLogs spans, so the
// scan chunks the range (MAX_RANGE) up to the head.
// Default is the live Base Sepolia AMM deploy block; env-overridable if redeployed.
const AMM_DEPLOY_BLOCK = 42977141n
const FROM_BLOCK = (() => {
  const b = import.meta.env.VITE_AMM_FROM_BLOCK
  return b ? BigInt(b) : AMM_DEPLOY_BLOCK
})()
const MAX_RANGE = 2000n // Base Sepolia public RPC caps eth_getLogs at 2000 blocks
const LOOKBACK = BigInt(import.meta.env.VITE_AMM_LOOKBACK_BLOCKS || 40000)

export async function discoverPositions(trader) {
  if (!trader || trader === '0x0000000000000000000000000000000000000000') return []
  const event = AMM_ABI.find((x) => x.type === 'event' && x.name === 'PoolSeeded')
  let latest
  try {
    latest = await publicClient.getBlockNumber()
  } catch {
    return []
  }
  // Scan from the deploy block (full history) in ≤2000-block chunks. The range
  // spans the AMM's whole life, so fetch chunks with bounded concurrency rather
  // than one slow sequential sweep.
  const start = FROM_BLOCK > 0n ? FROM_BLOCK : latest > LOOKBACK ? latest - LOOKBACK : 0n
  const ranges = []
  for (let from = start; from <= latest; from += MAX_RANGE) {
    const to = from + MAX_RANGE - 1n > latest ? latest : from + MAX_RANGE - 1n
    ranges.push([from, to])
  }
  const logs = []
  let failures = 0
  const CONCURRENCY = 8
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = ranges.slice(i, i + CONCURRENCY).map(([from, to]) =>
      publicClient
        .getLogs({ address: ADDRESSES.amm, event, args: { trader }, fromBlock: from, toBlock: to })
        .then((part) => logs.push(...part))
        .catch(() => { failures++ })
    )
    await Promise.all(batch)
  }
  if (failures && !logs.length) return []
  const deedIds = [...new Set(logs.map((l) => l.args.deedId))]
  const positions = []
  for (const deedId of deedIds) {
    try {
      const owner = await publicClient.readContract({
        address: ADDRESSES.deed,
        abi: DEED_ABI,
        functionName: 'ownerOf',
        args: [deedId],
      })
      if (owner.toLowerCase() !== trader.toLowerCase()) continue
      const [constellationId, shares] = await publicClient.readContract({
        address: ADDRESSES.deed,
        abi: DEED_ABI,
        functionName: 'positionOf',
        args: [deedId],
      })
      positions.push({ deedId, constId: Number(constellationId), shares })
    } catch {
      /* deed burned / not found */
    }
  }
  return positions
}

// ---- trace → attestation (SpacetimeDB) -------------------------------------
/** Ask the module to emit a trace_intent so the feeder signs a visibility attestation. */
export async function requestTrace(constId) {
  const evm = wallet.address
  if (!evm) throw new Error('Connect a wallet first.')
  if (!spacetime.isLive) throw new Error('SpacetimeDB offline — cannot request an attestation.')
  // reducer trace_constellation(constellation_id: u16, evm_address: String)
  await spacetime.callReducer('trace_constellation', [constId, evm])
}

const identityHex = (v) => String(v?.__identity__ ?? v ?? '').toLowerCase().replace(/^0x/, '')
const sameIdentity = (a, b) => !!a && !!b && identityHex(a) === identityHex(b)

/** My newest trace_intent for this constellation — the row requestTrace just created. */
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

/**
 * Poll for the attestation answering *my* trace of this constellation, for the
 * given EVM trader address. Matching goes through my newest trace_intent's
 * intent_id (1:1 with trace_attestation) so a concurrent trace by another
 * player — or a stale attestation from an earlier trade — can never be
 * picked up (either would revert on-chain with a trader/nonce mismatch).
 */
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

/** Poll trace_attestation for a fresh signature for this constellation (wallet path). */
export async function awaitAttestation(constId, opts = {}) {
  return awaitAttestationFor(constId, wallet.address, opts)
}

// ---- on-chain writes (wallet required) -------------------------------------
function requireWallet() {
  const wc = wallet.walletClient()
  if (!wc) throw new Error('Connect a wallet on Base Sepolia first.')
  if (!wallet.onBaseSepolia) throw new Error('Switch your wallet to Base Sepolia first.')
  return wc
}

export async function seedLiquidity({ constId, amtA, amtB, minShares, att, sig }) {
  const wc = requireWallet()
  const attTuple = {
    trader: att.trader,
    constellationId: att.constellationId,
    regionCommit: att.regionCommit,
    visibleStars: att.visibleStars,
    nonce: att.nonce,
    deadline: att.deadline,
  }
  const hash = await wc.writeContract({
    address: ADDRESSES.amm,
    abi: AMM_ABI,
    functionName: 'seedLiquidity',
    args: [constId, amtA, amtB, minShares, attTuple, sig],
    account: wallet.address,
    chain: CHAIN,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  return { hash, receipt }
}

export async function swap({ constId, inId, inAmt, minOutAmt, att, sig }) {
  const wc = requireWallet()
  const attTuple = {
    trader: att.trader,
    constellationId: att.constellationId,
    regionCommit: att.regionCommit,
    visibleStars: att.visibleStars,
    nonce: att.nonce,
    deadline: att.deadline,
  }
  const hash = await wc.writeContract({
    address: ADDRESSES.amm,
    abi: AMM_ABI,
    functionName: 'swap',
    args: [constId, inId, inAmt, minOutAmt, attTuple, sig],
    account: wallet.address,
    chain: CHAIN,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  return { hash, receipt }
}

export async function withdraw(deedId, shareBps) {
  const wc = requireWallet()
  const hash = await wc.writeContract({
    address: ADDRESSES.amm,
    abi: AMM_ABI,
    functionName: 'withdraw',
    args: [deedId, shareBps],
    account: wallet.address,
    chain: CHAIN,
  })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  return { hash, receipt }
}

/** Map a viem revert to friendly text using the AMM's custom error names. */
export function explainRevert(err) {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName || revert.reason
      if (name && AMM_ERROR_TEXT[name]) return AMM_ERROR_TEXT[name]
      if (name) return name
    }
    if (err.shortMessage) return err.shortMessage
  }
  return err?.message || String(err)
}
