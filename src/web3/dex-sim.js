// ============================================================
// Pentacles — Constellation DEX simulation (dual-mode fallback)
// ============================================================
// A self-contained, deterministic constant-product AMM over the 12 pools, in the
// SAME bigint/18-decimal shape as the live reads so pools-ui treats live and sim
// uniformly. Used (clearly labeled) whenever a wallet isn't connected on Base
// Sepolia. No attestation needed in simulation.

import { parseUnits } from 'viem'

const E = (n) => parseUnits(String(n), 18)
const sim = { pools: new Map(), positions: [], nextDeed: 9001n }

function ensure(constId, elemA, elemB, feeBps) {
  let p = sim.pools.get(constId)
  if (!p) {
    // deterministic, plausible starting reserves so quotes/prices are meaningful
    const a = 60 + ((constId * 37) % 340)
    const b = 60 + ((constId * 53) % 380)
    p = {
      constId,
      elemA,
      elemB,
      feeBps,
      reserveA: E(a),
      reserveB: E(b),
      totalShares: E(Math.max(1, Math.round(Math.sqrt(a * b)))),
      exists: true,
    }
    sim.pools.set(constId, p)
  } else {
    p.elemA = elemA
    p.elemB = elemB
    p.feeBps = feeBps
  }
  return p
}

/** meta: [{constId, pair:[a,b], feeBps}] → pool objects shaped like readAllPools(). */
export function simAllPools(meta) {
  return meta.map((m) => ensure(m.constId, m.pair[0], m.pair[1], m.feeBps))
}

export function simQuote(constId, inId, inAmt) {
  const p = sim.pools.get(constId)
  if (!p || inAmt <= 0n) return null
  const inIsA = inId === p.elemA
  const rIn = inIsA ? p.reserveA : p.reserveB
  const rOut = inIsA ? p.reserveB : p.reserveA
  if (rIn === 0n || rOut === 0n) return null
  const inWithFee = (inAmt * BigInt(10000 - p.feeBps)) / 10000n
  return (rOut * inWithFee) / (rIn + inWithFee)
}

export function simSwap(constId, inId, inAmt, minOutAmt) {
  const p = sim.pools.get(constId)
  const out = simQuote(constId, inId, inAmt)
  if (out == null) throw new Error('Pool has no liquidity (simulation).')
  if (minOutAmt != null && out < minOutAmt) throw new Error('Slippage too high (simulation).')
  if (inId === p.elemA) {
    p.reserveA += inAmt
    p.reserveB -= out
  } else {
    p.reserveB += inAmt
    p.reserveA -= out
  }
  return { out }
}

export function simSeed(constId, amtA, amtB) {
  const p = sim.pools.get(constId)
  if (!p) throw new Error('Unknown pool (simulation).')
  const shares = (amtA + amtB) / 2n
  p.reserveA += amtA
  p.reserveB += amtB
  p.totalShares += shares
  const deedId = sim.nextDeed++
  sim.positions.push({ deedId, constId, shares })
  return { deedId, shares }
}

export function simWithdraw(deedId, shareBps) {
  const i = sim.positions.findIndex((x) => x.deedId === deedId)
  if (i < 0) throw new Error('No such position (simulation).')
  const pos = sim.positions[i]
  const p = sim.pools.get(pos.constId)
  const burn = (pos.shares * BigInt(shareBps)) / 10000n
  if (p && p.totalShares > 0n) {
    p.reserveA -= (p.reserveA * burn) / p.totalShares
    p.reserveB -= (p.reserveB * burn) / p.totalShares
    p.totalShares -= burn
  }
  pos.shares -= burn
  if (pos.shares <= 0n) sim.positions.splice(i, 1)
  return { ok: true }
}

export function simPositions() {
  return sim.positions.map((p) => ({ ...p }))
}
