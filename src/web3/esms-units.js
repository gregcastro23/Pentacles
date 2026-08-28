// ============================================================
// Pentacles — ESMS unit boundary (18-dp ledger ↔ 4-dp Solana atoms)
// ============================================================
// Pentacles' authoritative ledger counts ESMS in 18-decimal base units,
// matching the Base ERC-1155 whose uint256 balances have no practical ceiling.
// AlchmAgentsSolana issues the same four elements as Token-2022 mints at 4
// decimals, where balances are u64. Every value crossing between them passes
// through this module.
//
// Two rules hold everywhere below, and both are load-bearing:
//
//   1. No IEEE-754. Not one `Number`, not one `parseFloat`, not one `*`/`/` on
//      a JS number. 2^53 is far below both u64 and the 18-dp ledger's range, so
//      a single accidental Number() silently corrupts balances. Everything is
//      BigInt end to end.
//
//   2. Truncation is never silent. Going from 18 dp to 4 dp discards 14 digits
//      of precision, so a value like 1 wei of ESMS is not representable on
//      Solana at all. `toSolanaAtomsExact` refuses such a value; `splitForSolana`
//      returns the remainder so a caller can leave it on the ledger. Rounding it
//      away by default would leak value on every crossing.

import { ASOL_ESMS_DECIMALS } from './chains.js'

/** The ledger's own precision — Base ERC-1155 ESMS convention. */
export const LEDGER_DECIMALS = 18

/** 10^14: the exact factor between one 4-dp Solana atom and the 18-dp ledger. */
export const LEDGER_PER_SOLANA_ATOM = 10n ** BigInt(LEDGER_DECIMALS - ASOL_ESMS_DECIMALS)

export const MAX_U64 = (1n << 64n) - 1n
export const MAX_U128 = (1n << 128n) - 1n

/**
 * Coerce to BigInt while rejecting every lossy input shape.
 *
 * Accepts BigInt and integer-valued strings only. A JS number is refused even
 * when it happens to be a safe integer: accepting it here is what lets a
 * `Number(amount)` slip in upstream and go unnoticed until a balance is wrong.
 */
export function toBigIntStrict(value, field = 'amount') {
  if (typeof value === 'bigint') return value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!/^-?\d+$/.test(trimmed)) {
      throw new TypeError(`${field} must be an integer string, got ${JSON.stringify(value)}`)
    }
    return BigInt(trimmed)
  }
  if (typeof value === 'number') {
    throw new TypeError(
      `${field} must be a BigInt or integer string, not a JS number — ` +
        'numbers lose precision above 2^53 and this value crosses a token boundary',
    )
  }
  throw new TypeError(`${field} must be a BigInt or integer string, got ${typeof value}`)
}

/** Assert a value fits Token-2022's u64 amount field. */
export function assertU64(value, field = 'amount') {
  const amount = toBigIntStrict(value, field)
  if (amount < 0n) throw new RangeError(`${field} must not be negative`)
  if (amount > MAX_U64) throw new RangeError(`${field} exceeds the Token-2022 u64 range`)
  return amount
}

/** Assert a value fits the SpacetimeDB ledger's u128 columns. */
export function assertU128(value, field = 'amount') {
  const amount = toBigIntStrict(value, field)
  if (amount < 0n) throw new RangeError(`${field} must not be negative`)
  if (amount > MAX_U128) throw new RangeError(`${field} exceeds the ledger u128 range`)
  return amount
}

/**
 * Split an 18-dp ledger amount into the Solana atoms it can carry and the
 * remainder it cannot.
 *
 * `atoms + dust * 1` reconstructs the input exactly:
 *   ledger === atoms * LEDGER_PER_SOLANA_ATOM + dust
 *
 * Callers that bridge should send `atoms` and leave `dust` credited on the
 * ledger, never drop it.
 */
export function splitForSolana(ledgerAmount) {
  const amount = assertU128(ledgerAmount, 'ledgerAmount')
  const atoms = amount / LEDGER_PER_SOLANA_ATOM
  const dust = amount % LEDGER_PER_SOLANA_ATOM
  if (atoms > MAX_U64) {
    throw new RangeError(
      `ledgerAmount converts to ${atoms} Solana atoms, which exceeds the Token-2022 u64 range`,
    )
  }
  return { atoms, dust }
}

/**
 * Convert an 18-dp ledger amount to 4-dp Solana atoms, refusing any value that
 * is not exactly representable.
 *
 * Use this on settlement paths where a partial transfer would desynchronise the
 * two ledgers. Use `splitForSolana` where carrying a remainder forward is the
 * correct behaviour.
 */
export function toSolanaAtomsExact(ledgerAmount) {
  const { atoms, dust } = splitForSolana(ledgerAmount)
  if (dust !== 0n) {
    throw new RangeError(
      `ledgerAmount ${ledgerAmount} is not representable at ${ASOL_ESMS_DECIMALS} decimals ` +
        `(${dust} base units of remainder); round to a multiple of ${LEDGER_PER_SOLANA_ATOM} first`,
    )
  }
  return atoms
}

/**
 * Convert 4-dp Solana atoms up to the 18-dp ledger. Always exact — widening
 * precision cannot lose information — but still range-checked on the way out.
 */
export function fromSolanaAtoms(atoms) {
  const raw = assertU64(atoms, 'atoms')
  const ledger = raw * LEDGER_PER_SOLANA_ATOM
  return assertU128(ledger, 'ledgerAmount')
}

/**
 * Format an amount in either scale for display. Returns a decimal string; the
 * fractional part is produced by string slicing, never by division, so the
 * result is exact at any magnitude.
 */
export function formatUnits(value, decimals = LEDGER_DECIMALS) {
  const amount = toBigIntStrict(value, 'value')
  const negative = amount < 0n
  const digits = (negative ? -amount : amount).toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals).replace(/0+$/, '') : ''
  const sign = negative ? '-' : ''
  return fraction ? `${sign}${whole}.${fraction}` : `${sign}${whole}`
}

/**
 * Parse a human decimal string into base units at the given precision. Rejects
 * more fractional digits than the scale can hold rather than truncating, so a
 * UI cannot quietly stake less than the user typed.
 */
export function parseUnits(text, decimals = LEDGER_DECIMALS) {
  const trimmed = String(text ?? '').trim()
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(trimmed)
  if (!match || (!match[2] && !match[3])) {
    throw new TypeError(`Cannot parse ${JSON.stringify(text)} as a decimal amount`)
  }
  const [, sign, wholeText = '', fractionText = ''] = match
  if (fractionText.length > decimals) {
    throw new RangeError(
      `${trimmed} has ${fractionText.length} fractional digits but only ${decimals} are representable`,
    )
  }
  const padded = fractionText.padEnd(decimals, '0')
  const amount = BigInt(`${wholeText || '0'}${padded}`)
  return sign === '-' ? -amount : amount
}

export default {
  LEDGER_DECIMALS,
  LEDGER_PER_SOLANA_ATOM,
  MAX_U64,
  MAX_U128,
  toBigIntStrict,
  assertU64,
  assertU128,
  splitForSolana,
  toSolanaAtomsExact,
  fromSolanaAtoms,
  formatUnits,
  parseUnits,
}
