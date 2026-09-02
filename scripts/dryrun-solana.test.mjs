import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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

// Deterministic cross-language test vectors loaded from shared fixture (Rust ↔ JS)
const fixturePath = new URL('../tests/fixtures/wallet-binding-vectors.json', import.meta.url)
const fixtureData = JSON.parse(readFileSync(fixturePath, 'utf8'))
assert.equal(fixtureData.version, '1.0.0')
assert.ok(Array.isArray(fixtureData.vectors) && fixtureData.vectors.length > 0)

for (const vector of fixtureData.vectors) {
  // 1. Validate identity big-endian hex formatting from raw bytes
  const rawBytes = Buffer.from(vector.identity_be_bytes_hex, 'hex')
  const identityHex = `0x${rawBytes.toString('hex').toLowerCase()}`
  assert.equal(
    identityHex,
    vector.expected_identity_hex,
    `Identity hex conversion must match for ${vector.name}`
  )

  if (vector.expected_valid) {
    // 2. Pure challenge construction verification
    const message = [
      'Pentacles Solana Wallet Binding',
      `Domain: ${fixtureData.domain}`,
      `Cluster: ${vector.cluster}`,
      `Identity: ${identityHex}`,
      `Pubkey: ${vector.solana_pubkey}`,
      `Deadline: ${vector.deadline_secs}`,
    ].join('\n')

    assert.equal(
      message,
      vector.expected_challenge_message,
      `Challenge message for ${vector.name} must match shared fixture byte-for-byte`
    )

    // 3. Cryptographic Ed25519 signature verification
    const pubKeyBytes = bs58.decode(vector.solana_pubkey)
    assert.equal(pubKeyBytes.length, 32)
    const sigBytes = bs58.decode(vector.signature_b58)
    assert.equal(sigBytes.length, 64)

    // Convert raw 32-byte Ed25519 pubkey to SPKI DER
    const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex')
    const spkiDer = Buffer.concat([spkiPrefix, Buffer.from(pubKeyBytes)])
    const publicKey = crypto.createPublicKey({ key: spkiDer, format: 'der', type: 'spki' })

    const verified = crypto.verify(null, Buffer.from(message, 'utf8'), publicKey, sigBytes)
    assert.equal(verified, true, `Signature must verify for ${vector.name}`)
  } else {
    // Validate failure modes
    switch (vector.failure_reason) {
      case 'signature_mismatch': {
        const pubKeyBytes = bs58.decode(vector.solana_pubkey)
        const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex')
        const publicKey = crypto.createPublicKey({
          key: Buffer.concat([spkiPrefix, Buffer.from(pubKeyBytes)]),
          format: 'der',
          type: 'spki',
        })
        const sigBytes = bs58.decode(vector.signature_b58)
        const verified = crypto.verify(
          null,
          Buffer.from(vector.expected_challenge_message, 'utf8'),
          publicKey,
          sigBytes
        )
        assert.equal(verified, false, 'Tampered message must fail signature verification')
        break
      }
      case 'invalid_pubkey_b58': {
        assert.throws(() => bs58.decode(vector.solana_pubkey), 'Invalid base58 must throw')
        break
      }
      case 'invalid_pubkey_len': {
        const decoded = bs58.decode(vector.solana_pubkey)
        assert.notEqual(decoded.length, 32, 'Invalid pubkey length must not equal 32')
        break
      }
      case 'invalid_sig_len': {
        const decoded = bs58.decode(vector.signature_b58)
        assert.notEqual(decoded.length, 64, 'Invalid signature length must not equal 64')
        break
      }
      case 'unsupported_cluster': {
        const clean = vector.cluster.trim().toLowerCase()
        assert.ok(clean !== 'devnet' && clean !== 'mainnet-beta')
        break
      }
      case 'expired_deadline': {
        assert.ok(vector.deadline_secs < 1756800000)
        break
      }
      case 'overlong_deadline': {
        assert.ok(vector.deadline_secs > 1756800000 + 900)
        break
      }
    }
  }
}
console.log('  ✓ Shared deterministic test vectors fixture validated across all vectors (Rust ↔ JS)')

// 4. Test Idempotency Scoping
console.log('▶ 4 · Testing idempotency scoping for devnet and mainnet...')
assert.equal(isMainnet(CAIP2.solanaMainnet), true)
assert.equal(isMainnet(CAIP2.solanaDevnet), false)
assert.equal(processedTxChain(CAIP2.solanaDevnet), 'solana_devnet')
assert.equal(processedTxChain(CAIP2.solanaMainnet), 'solana_mainnet_beta')
console.log('  ✓ Cluster-scoped idempotency keys configured correctly')

console.log('\n✅ ALL Solana architecture dryrun tests passed!\n')
