import { describe, expect, test } from 'bun:test'
import {
  LEDGER_PER_SOLANA_ATOM,
  MAX_U64,
  assertU64,
  formatUnits,
  fromSolanaAtoms,
  parseUnits,
  splitForSolana,
  toBigIntStrict,
  toSolanaAtomsExact,
} from '../src/web3/esms-units.js'
import {
  ASOL_ESMS_DECIMALS,
  ASOL_PROGRAM_ID,
  CAIP2,
  asolEsmsMint,
  asolEsmsMints,
  asolProgramConfig,
  bridgeChainToCaip2,
  caip2ToBridgeChain,
  isMainnet,
  processedTxChain,
  txUrl,
} from '../src/web3/chains.js'

describe('ESMS unit boundary (18-dp ledger ↔ 4-dp Solana atoms)', () => {
  test('scale factor is exactly 10^14', () => {
    expect(LEDGER_PER_SOLANA_ATOM).toBe(10n ** 14n)
    expect(ASOL_ESMS_DECIMALS).toBe(4)
  })

  test('round-trips an exactly representable amount', () => {
    const oneEsms = 10n ** 18n
    expect(toSolanaAtomsExact(oneEsms)).toBe(10_000n)
    expect(fromSolanaAtoms(10_000n)).toBe(oneEsms)
  })

  test('refuses an amount that is not representable at 4 decimals', () => {
    // One wei of ESMS: real on the 18-dp ledger, unrepresentable on Solana.
    expect(() => toSolanaAtomsExact(1n)).toThrow(/not representable/)
    expect(() => toSolanaAtomsExact(10n ** 18n + 1n)).toThrow(/not representable/)
  })

  test('splitForSolana reconstructs its input exactly', () => {
    const awkward = 123_456_789_012_345_678_901n
    const { atoms, dust } = splitForSolana(awkward)
    expect(atoms * LEDGER_PER_SOLANA_ATOM + dust).toBe(awkward)
    expect(dust).toBeLessThan(LEDGER_PER_SOLANA_ATOM)
  })

  test('rejects a ledger amount whose atom count would overflow u64', () => {
    const overflow = (MAX_U64 + 1n) * LEDGER_PER_SOLANA_ATOM
    expect(() => splitForSolana(overflow)).toThrow(/u64/)
    expect(() => assertU64(MAX_U64 + 1n)).toThrow(/u64/)
    expect(assertU64(MAX_U64)).toBe(MAX_U64)
  })

  test('documents the 18-decimal ceiling this migration removes', () => {
    // The retired Pentacles mints used 18 decimals against a u64 amount field,
    // so one token account could hold at most ~18.45 ESMS. At 4 decimals the
    // same u64 holds over 1.8e15 whole ESMS.
    expect(MAX_U64 / 10n ** 18n).toBe(18n)
    expect(MAX_U64 / 10n ** 4n).toBeGreaterThan(10n ** 15n)
  })

  test('refuses JS numbers at the boundary even when they look safe', () => {
    expect(() => toBigIntStrict(1)).toThrow(/not a JS number/)
    expect(() => toBigIntStrict(0)).toThrow(/not a JS number/)
    expect(toBigIntStrict('9007199254740993')).toBe(9007199254740993n)
    expect(toBigIntStrict(9007199254740993n)).toBe(9007199254740993n)
  })

  test('formats and parses without floating point at any magnitude', () => {
    expect(formatUnits(10n ** 18n)).toBe('1')
    expect(formatUnits(1n)).toBe('0.000000000000000001')
    expect(formatUnits(10_001n, 4)).toBe('1.0001')
    expect(parseUnits('1', 18)).toBe(10n ** 18n)
    expect(parseUnits('1.0001', 4)).toBe(10_001n)
    // The regression amount from the verified testnet mint, above 2^53.
    expect(formatUnits(9007199254740993n, 0)).toBe('9007199254740993')
  })

  test('parseUnits refuses more precision than the scale can hold', () => {
    expect(() => parseUnits('1.00001', 4)).toThrow(/representable/)
    expect(parseUnits('1.0000', 4)).toBe(10_000n)
  })
})

describe('CAIP-2 chain registry', () => {
  test('separates testnets from value-bearing chains', () => {
    expect(isMainnet(CAIP2.solanaMainnet)).toBe(true)
    expect(isMainnet(CAIP2.solanaDevnet)).toBe(false)
  })

  test('maps legacy BridgeChain variants without relabelling history', () => {
    expect(bridgeChainToCaip2('SolanaToken2022')).toBe(CAIP2.solanaDevnet)
    expect(bridgeChainToCaip2('SolanaMainnetToken2022')).toBe(CAIP2.solanaMainnet)
    expect(caip2ToBridgeChain(CAIP2.solanaMainnet)).toBe('SolanaMainnetToken2022')
    expect(() => bridgeChainToCaip2('Nonsense')).toThrow(/Unknown BridgeChain/)
  })

  test('gives devnet and mainnet distinct processed_tx namespaces', () => {
    expect(processedTxChain(CAIP2.solanaDevnet)).toBe('solana_devnet')
    expect(processedTxChain(CAIP2.solanaMainnet)).toBe('solana_mainnet_beta')
    expect(processedTxChain(CAIP2.solanaDevnet)).not.toBe(processedTxChain(CAIP2.solanaMainnet))
  })

  test('builds cluster-correct explorer links', () => {
    expect(txUrl(CAIP2.solanaDevnet, 'sig')).toContain('?cluster=devnet')
    expect(txUrl(CAIP2.solanaMainnet, 'sig')).not.toContain('cluster=')
  })
})

describe('ASOL is the sole ESMS issuer', () => {
  test('derives the four ESMS mints recorded in the ASOL Phase 4 runbook', () => {
    // PDAs at [b"esms_mint", &[id]] — identical on every cluster, so they are
    // derived rather than configured and a mistyped env var cannot exist.
    expect(asolEsmsMints().map((m) => m.toBase58())).toEqual([
      'K5kwwomtWYydxJacA7bC5yUEW9TtEuVqBKBoqAWLmhQ',
      '3FcpToU7bj4sLD687uecbesEjzjxBfqYn2EcBXJKPaCf',
      '7naJZozLrknDF3dguAdEWn7Z4MviUkXitjhaAt57Vkb4',
      '6RY6ZG1eJQ2uEvpyA6XK74WyF1MpTYbw97hdhELqDUsa',
    ])
  })

  test('derives the ProgramConfig PDA and rejects invalid element ids', () => {
    expect(asolProgramConfig().toBase58()).toBe('4YCVh9KHrhN6mFSMvybGVqLeGfaRkfUtqrn19mLLJGku')
    expect(ASOL_PROGRAM_ID.toBase58()).toBe('5QheuqaicKvPPRFEoEXwaE5xaFp7gauvJCfsjpQv8WzD')
    expect(() => asolEsmsMint(4)).toThrow(/Invalid ESMS element id/)
    expect(() => asolEsmsMint(-1)).toThrow(/Invalid ESMS element id/)
  })
})
