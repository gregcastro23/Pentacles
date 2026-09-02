import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  ASOL_PROGRAM_ID,
  ASOL_ESMS_DECIMALS,
  ASOL_ESMS_ATOMS_PER_TOKEN,
  asolEsmsMints,
  asolProgramConfig,
  CAIP2,
  isMainnet,
  processedTxChain,
} from '../src/web3/chains.js'
import {
  formatUnits,
  parseUnits,
  toSolanaAtomsExact,
  fromSolanaAtoms,
} from '../src/web3/esms-units.js'

console.log('=== Pentacles Solana Architecture Test Suite ===\n')

// 1. Test Solana Token-2022 4-decimal unit conversions
console.log('▶ 1 · Testing Token-2022 4-decimal units...')
assert.equal(ASOL_ESMS_DECIMALS, 4)
assert.equal(ASOL_ESMS_ATOMS_PER_TOKEN, 10_000n)
assert.equal(toSolanaAtomsExact(10n ** 18n), 10_000n)
assert.equal(fromSolanaAtoms(10_000n), 10n ** 18n)
assert.equal(formatUnits(10_000n, 4), '1')
assert.equal(parseUnits('1.5', 4), 15_000n)
console.log('  ✓ 4-decimal conversions accurate')

// 2. Test ASOL ESMS PDA mint derivation
console.log('▶ 2 · Testing ASOL ESMS PDA mint addresses...')
const mints = asolEsmsMints()
assert.equal(mints.length, 4)
assert.equal(mints[0].toBase58(), 'K5kwwomtWYydxJacA7bC5yUEW9TtEuVqBKBoqAWLmhQ')
assert.equal(mints[1].toBase58(), '3FcpToU7bj4sLD687uecbesEjzjxBfqYn2EcBXJKPaCf')
assert.equal(mints[2].toBase58(), '7naJZozLrknDF3dguAdEWn7Z4MviUkXitjhaAt57Vkb4')
assert.equal(mints[3].toBase58(), '6RY6ZG1eJQ2uEvpyA6XK74WyF1MpTYbw97hdhELqDUsa')
assert.equal(asolProgramConfig().toBase58(), '4YCVh9KHrhN6mFSMvybGVqLeGfaRkfUtqrn19mLLJGku')
console.log('  ✓ All 4 element PDAs match ASOL Phase 4 canonical addresses')

// 3. Test Domain-Separated Wallet Binding Challenge & Ed25519 Signature
console.log('▶ 3 · Testing domain-separated challenge signing & verification...')
const { publicKey: edPubKey, privateKey: edPrivKey } = crypto.generateKeyPairSync('ed25519')
const rawPubKeyBytes = edPubKey.export({ type: 'spki', format: 'der' }).subarray(-32)
const pubkey = bs58.encode(rawPubKeyBytes)
const identity = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
const cluster = 'devnet'
const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)

const message = [
  'Pentacles Solana Wallet Binding',
  'Domain: pentacles.alchm.kitchen',
  `Cluster: ${cluster}`,
  `Identity: ${identity}`,
  `Pubkey: ${pubkey}`,
  `Deadline: ${deadline}`,
].join('\n')

const msgBytes = Buffer.from(message, 'utf8')
const sigBytes = crypto.sign(null, msgBytes, edPrivKey)
const sigB58 = bs58.encode(sigBytes)

// Verify Ed25519 signature
const verified = crypto.verify(null, msgBytes, edPubKey, sigBytes)
assert.equal(verified, true, 'Ed25519 signature must verify against domain challenge')

// Replay with wrong cluster must fail
const wrongClusterMsg = Buffer.from(
  message.replace('Cluster: devnet', 'Cluster: mainnet-beta'),
  'utf8'
)
assert.equal(
  crypto.verify(null, wrongClusterMsg, edPubKey, sigBytes),
  false,
  'Altered cluster must invalidate signature'
)
console.log('  ✓ Domain-separated challenge signs and verifies cryptographically')

// 4. Test Idempotency Scoping
console.log('▶ 4 · Testing idempotency scoping for devnet and mainnet...')
assert.equal(isMainnet(CAIP2.solanaMainnet), true)
assert.equal(isMainnet(CAIP2.solanaDevnet), false)
assert.equal(processedTxChain(CAIP2.solanaDevnet), 'solana_devnet')
assert.equal(processedTxChain(CAIP2.solanaMainnet), 'solana_mainnet_beta')
console.log('  ✓ Cluster-scoped idempotency keys configured correctly')

console.log('\n✅ ALL Solana architecture dryrun tests passed!\n')
