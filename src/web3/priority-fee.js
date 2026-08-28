// ============================================================
// Pentacles — Solana compute budget & dynamic priority fees
// ============================================================
// Every Solana transaction Pentacles sends on mainnet carries an explicit
// compute unit limit and a priority fee priced off recent network activity.
// Neither is optional there:
//
//   • Without setComputeUnitLimit a transaction requests the 200k default (or
//     up to 1.4M for multi-instruction transactions), reserving block space it
//     will not use. Validators schedule on the request, not the usage, so an
//     honest limit is what buys inclusion.
//
//   • Without setComputeUnitPrice the transaction bids zero. On a quiet devnet
//     that lands; during mainnet congestion it is simply never picked up and
//     eventually expires past its blockhash.
//
// Shared by the Vite client and the Bun feeders — no env access, no I/O beyond
// the single RPC call the estimator makes.

import { ComputeBudgetProgram } from '@solana/web3.js'

// ── Profiled compute unit limits ────────────────────────────────────────────
//
// ASOL's four profiled limits, reused verbatim so both projects request the
// same budget for the same instruction. Raising one of these without measuring
// wastes block space; lowering it below actual usage fails the transaction with
// `InstructionError::ComputationalBudgetExceeded`, so they are pinned, not guessed.

export const CU_LIMITS = Object.freeze({
  /** ASOL `claim_mint_esms` — the bridge destination mint. */
  claimMint: 135_000,
  /** ASOL `redeem_esms` signed by the holder itself. */
  redeemSelf: 80_000,
  /** ASOL `redeem_for_esms` — includes the Ed25519 precompile verification. */
  redeemSponsored: 115_000,
  /** ASOL `record_persona` JEPA anchoring. */
  recordPersona: 50_000,

  // Pentacles' own StarVault instructions. USDC `transfer_checked` through a
  // PDA vault plus the position checkpoint; the unstake path additionally
  // signs the transfer out of the vault.
  stakeStar: 90_000,
  unstakeStar: 100_000,

  /** Creating an associated token account, added on top when one is missing. */
  createAta: 30_000,
})

// ── Priority fee bounds ─────────────────────────────────────────────────────

export const DEFAULT_FEE_PERCENTILE = 65
export const MIN_MICRO_LAMPORTS = 5_000n
export const MAX_MICRO_LAMPORTS = 2_000_000n

/**
 * Estimate a priority fee in micro-lamports per compute unit from the fees
 * recently paid on the accounts this transaction will write to.
 *
 * Zero-fee samples are dropped before the percentile is taken: on a quiet
 * cluster most slots pay nothing, and including them drags the estimate to the
 * floor exactly when a real spike is starting. The result is clamped at both
 * ends — the floor keeps quiet-period transactions from bidding nothing, the
 * ceiling keeps a congestion spike from draining the fee payer.
 *
 * Any RPC failure returns the floor rather than throwing. A missing fee
 * estimate should degrade the bid, never block settlement.
 */
export async function estimatePriorityFee(connection, accounts = [], options = {}) {
  const {
    percentile = DEFAULT_FEE_PERCENTILE,
    minMicroLamports = MIN_MICRO_LAMPORTS,
    maxMicroLamports = MAX_MICRO_LAMPORTS,
  } = options

  const clamp = (value) => {
    if (value < minMicroLamports) return minMicroLamports
    if (value > maxMicroLamports) return maxMicroLamports
    return value
  }

  let samples
  try {
    samples = await connection.getRecentPrioritizationFees({
      lockedWritableAccounts: accounts,
    })
  } catch {
    return minMicroLamports
  }
  if (!Array.isArray(samples) || samples.length === 0) return minMicroLamports

  const fees = samples
    .map((sample) => BigInt(sample?.prioritizationFee ?? 0))
    .filter((fee) => fee > 0n)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  if (fees.length === 0) return minMicroLamports

  // Nearest-rank percentile, computed on integers so the index never depends on
  // float rounding at the array bounds.
  const rank = (BigInt(fees.length) * BigInt(percentile) + 99n) / 100n
  const index = Number(rank > 0n ? rank - 1n : 0n)
  return clamp(fees[Math.min(index, fees.length - 1)])
}

/**
 * Return `instructions` with compute budget instructions at indices 0 and 1.
 *
 * Any compute budget instruction already present is stripped first. The runtime
 * reads the *last* such instruction it finds, so appending rather than
 * replacing would let a stale limit from a helper silently win. Placing them at
 * the head also keeps them ahead of an Ed25519 precompile instruction, which
 * must itself stay at a known index for `redeem_for_esms` introspection.
 */
export function injectComputeBudget(instructions, { units, microLamports }) {
  if (!Number.isInteger(units) || units <= 0) {
    throw new RangeError(`compute unit limit must be a positive integer, got ${units}`)
  }
  const price = typeof microLamports === 'bigint' ? microLamports : BigInt(microLamports ?? 0)
  if (price < 0n) throw new RangeError('priority fee must not be negative')

  const business = instructions.filter(
    (ix) => !ix.programId.equals(ComputeBudgetProgram.programId),
  )
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: price }),
    ...business,
  ]
}

/**
 * Estimate a fee for the writable accounts these instructions touch, then
 * prepend the budget pair. The convenience wrapper used by every send path.
 */
export async function withComputeBudget(connection, instructions, { units, ...options } = {}) {
  const writable = [
    ...new Set(
      instructions
        .flatMap((ix) => ix.keys ?? [])
        .filter((key) => key.isWritable)
        .map((key) => key.pubkey.toBase58()),
    ),
  ]
    .slice(0, 128) // getRecentPrioritizationFees caps the account list
    .map((address) => instructions.flatMap((ix) => ix.keys ?? []).find(
      (key) => key.pubkey.toBase58() === address,
    ).pubkey)

  const microLamports = await estimatePriorityFee(connection, writable, options)
  return { instructions: injectComputeBudget(instructions, { units, microLamports }), microLamports }
}

export default {
  CU_LIMITS,
  DEFAULT_FEE_PERCENTILE,
  MIN_MICRO_LAMPORTS,
  MAX_MICRO_LAMPORTS,
  estimatePriorityFee,
  injectComputeBudget,
  withComputeBudget,
}
