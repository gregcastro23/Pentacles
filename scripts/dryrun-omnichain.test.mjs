import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

const { burnEsmsForJing } = await import('../src/web3/burner.js')

let signedPayload
let settlementPayload
const evmWallet = {
  address: '0x1111111111111111111111111111111111111111',
  onBaseSepolia: true,
  walletClient: () => ({
    signTypedData: async (payload) => {
      signedPayload = payload
      return `0x${'ab'.repeat(65)}`
    },
  }),
}

const evmResult = await burnEsmsForJing(
  { elementId: 2, amount: 10n },
  {
    wallet: evmWallet,
    nowSeconds: () => 1_800_000_000,
    createOrderId: () => `0x${'12'.repeat(32)}`,
    settleEvmBurn: async (payload) => {
      settlementPayload = payload
      return { txHash: `0x${'34'.repeat(32)}`, spacetimeSynced: true }
    },
  },
)

assert.equal(signedPayload.primaryType, 'RedeemAuthorization')
assert.deepEqual(signedPayload.message.ids, [2n])
assert.deepEqual(signedPayload.message.amounts, [10n])
assert.equal(settlementPayload.signature, `0x${'ab'.repeat(65)}`)
assert.equal(evmResult.chain, 'evm_base_sepolia')
assert.equal(evmResult.hash, `0x${'34'.repeat(32)}`)
assert.equal(evmResult.spacetimeSynced, true)

console.log('PASS omnichain EVM redeemFor dispatcher')

let solanaPayload
const solanaResult = await burnEsmsForJing(
  { elementId: 1, amount: 9n },
  {
    wallet: {
      address: null,
      solanaAddress: '7YVYdyiZzSw64Xy2VJbZEZFwXFPVQtRejv5q8fYynWnK',
    },
    sendSolanaBurn: async (payload) => {
      solanaPayload = payload
      return { signature: '5'.repeat(88), spacetimeSynced: true }
    },
  },
)

assert.equal(solanaPayload.elementId, 1)
assert.equal(solanaPayload.amount, 9n)
assert.equal(solanaResult.chain, 'solana_token_2022')
assert.equal(solanaResult.signature, '5'.repeat(88))
assert.equal(solanaResult.spacetimeSynced, true)

console.log('PASS omnichain Solana Token-2022 dispatcher')

const { createBurnSettlementHandler } = await import('../settlement/esms-redeemer.js')

const settlementCalls = []
const handleSettlement = createBurnSettlementHandler({
  verifyAuthorization: async () => true,
  redeemedOrder: async () => false,
  submitRedeem: async (payload) => {
    settlementCalls.push(['submit', payload])
    return `0x${'56'.repeat(32)}`
  },
  verifyReceipt: async (payload) => {
    settlementCalls.push(['verify', payload])
    return true
  },
  syncSpacetime: async (payload) => {
    settlementCalls.push(['sync', payload])
  },
  nowSeconds: () => 1_800_000_000,
})
const settlementRequest = new Request('http://localhost/api/web3/burn-esms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: evmWallet.address,
    orderId: `0x${'12'.repeat(32)}`,
    ids: ['2'],
    amounts: ['10'],
    deadline: '1800000600',
    signature: `0x${'ab'.repeat(65)}`,
  }),
})
const settlementResponse = await handleSettlement(settlementRequest)
const settlementBody = await settlementResponse.json()

assert.equal(settlementResponse.status, 200)
assert.equal(settlementBody.txHash, `0x${'56'.repeat(32)}`)
assert.equal(settlementBody.spacetimeSynced, true)
assert.deepEqual(settlementCalls.map(([name]) => name), ['submit', 'verify', 'sync'])

console.log('PASS sponsored redeemFor settlement and SpacetimeDB sync')

const { createWalletVerificationHandler } = await import('../settlement/wallet-verifier.js')
let verifiedBinding
const verifyWallet = createWalletVerificationHandler({
  verifyBinding: async () => `0x${'78'.repeat(32)}`,
  recordBinding: async (payload) => {
    verifiedBinding = payload
  },
  nowSeconds: () => 1_800_000_000,
})
const walletVerificationResponse = await verifyWallet(new Request('http://localhost/api/web3/verify-wallet', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    spacetimeIdentity: `0x${'90'.repeat(32)}`,
    wallet: evmWallet.address,
    deadline: '1800000600',
    signature: `0x${'ab'.repeat(65)}`,
  }),
}))
assert.equal(walletVerificationResponse.status, 200)
assert.equal(verifiedBinding.wallet, evmWallet.address)
assert.equal(verifiedBinding.proofHash, `0x${'78'.repeat(32)}`)

const failedWalletRecord = createWalletVerificationHandler({
  verifyBinding: async () => `0x${'78'.repeat(32)}`,
  recordBinding: async () => {
    throw new Error('SpacetimeDB unavailable')
  },
  nowSeconds: () => 1_800_000_000,
})
const failedWalletResponse = await failedWalletRecord(new Request('http://localhost/api/web3/verify-wallet', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    spacetimeIdentity: `0x${'90'.repeat(32)}`,
    wallet: evmWallet.address,
    deadline: '1800000600',
    signature: `0x${'ab'.repeat(65)}`,
  }),
}))
assert.equal(failedWalletResponse.status, 502)

const solanaBindingKeys = await crypto.subtle.generateKey(
  { name: 'Ed25519' },
  true,
  ['sign', 'verify'],
)
const solanaBindingWallet = new PublicKey(
  new Uint8Array(await crypto.subtle.exportKey('raw', solanaBindingKeys.publicKey)),
)
const solanaIdentity = `0x${'91'.repeat(32)}`
const solanaDeadline = 1_800_000_600n
const solanaBindingMessage = [
  'Pentacles Solana Wallet Binding',
  `Identity: ${solanaIdentity}`,
  `Wallet: ${solanaBindingWallet.toBase58()}`,
  `Deadline: ${solanaDeadline}`,
].join('\n')
let verifiedSolanaBinding
const verifySolanaWallet = createWalletVerificationHandler({
  recordBinding: async (payload) => {
    verifiedSolanaBinding = payload
  },
  nowSeconds: () => 1_800_000_000,
})
const solanaVerificationResponse = await verifySolanaWallet(new Request('http://localhost/api/web3/verify-wallet', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chain: 'solana',
    spacetimeIdentity: solanaIdentity,
    wallet: solanaBindingWallet.toBase58(),
    deadline: solanaDeadline.toString(),
    signature: bs58.encode(new Uint8Array(await crypto.subtle.sign(
      { name: 'Ed25519' },
      solanaBindingKeys.privateKey,
      new TextEncoder().encode(solanaBindingMessage),
    ))),
  }),
}))
assert.equal(solanaVerificationResponse.status, 200)
assert.equal(verifiedSolanaBinding.chain, 'solana')
assert.match(verifiedSolanaBinding.proofHash, /^0x[0-9a-f]{64}$/)

const { bridgeClaimId, parsePendingBridge } = await import('../feeder/bridge-service.ts')
const bridgeRow = {
  burn_tx_hash: `0x${'cd'.repeat(32)}`,
  source_chain: 'EvmBaseSepolia',
  target_chain: 'SolanaToken2022',
  source_address: evmWallet.address,
  target_address: '7YVYdyiZzSw64Xy2VJbZEZFwXFPVQtRejv5q8fYynWnK',
  element_id: 2,
  amount: '10000000000000000000',
  status: 'PendingMint',
}
const parsedBridge = parsePendingBridge(bridgeRow)
assert.equal(parsedBridge.amount, 10_000_000_000_000_000_000n)
assert.equal(bridgeClaimId(parsedBridge), bridgeClaimId(parsedBridge), 'bridge claim IDs must be deterministic')
assert.throws(
  () => parsePendingBridge({ ...bridgeRow, amount: (1n << 64n).toString() }),
  /exceeds Solana u64/,
)
assert.throws(
  () => parsePendingBridge({
    ...bridgeRow,
    source_chain: 'SolanaToken2022',
    target_chain: 'EvmBaseSepolia',
    amount: (1n << 64n).toString(),
  }),
  /exceeds Solana u64/,
)

const rejectedAuthorization = createBurnSettlementHandler({
  verifyAuthorization: async () => {
    throw new Error('malformed signature')
  },
  nowSeconds: () => 1_800_000_000,
})
const rejectedResponse = await rejectedAuthorization(new Request('http://localhost/api/web3/burn-esms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    from: evmWallet.address,
    orderId: `0x${'12'.repeat(32)}`,
    ids: ['2'],
    amounts: ['10'],
    deadline: '1800000600',
    signature: `0x${'ab'.repeat(65)}`,
  }),
}))
assert.equal(rejectedResponse.status, 401)

const reducers = await readFile(new URL('../server/src/reducers.rs', import.meta.url), 'utf8')
const tables = await readFile(new URL('../server/src/tables.rs', import.meta.url), 'utf8')
const types = await readFile(new URL('../server/src/types.rs', import.meta.url), 'utf8')
const serve = await readFile(new URL('../serve.ts', import.meta.url), 'utf8')
const ui = await readFile(new URL('../public/agent-page.js', import.meta.url), 'utf8')
const solanaProgram = await readFile(new URL('../programs/pentacles-solana/src/lib.rs', import.meta.url), 'utf8')
const solanaFeeder = await readFile(new URL('../feeder/solana-sync-service.ts', import.meta.url), 'utf8')
const solanaClient = await readFile(new URL('../src/web3/solana.js', import.meta.url), 'utf8')
const bridgeFeeder = await readFile(new URL('../feeder/bridge-service.ts', import.meta.url), 'utf8')
const walletVerifier = await readFile(new URL('../settlement/wallet-verifier.js', import.meta.url), 'utf8')
const dynamicBridge = await readFile(new URL('../src/web3/dynamic.js', import.meta.url), 'utf8')

for (const reducer of [
  'sync_stardex_ephemeris',
  'stardex_claim_constellation',
  'stardex_fortify_node',
]) {
  const body = reducers.match(new RegExp(`pub fn ${reducer}\\([\\s\\S]*?\\n\\}`, 'm'))?.[0] || ''
  assert.match(body, /tx_hash:\s*String/, `${reducer} must accept an idempotency transaction hash`)
  assert.match(body, /horizon_intent_id:\s*u64/, `${reducer} must bind an attested EVM horizon intent`)
  assert.match(body, /ensure_unprocessed\(/, `${reducer} must reject a replayed transaction hash`)
}

const bridgeReducer = reducers.match(/pub fn bridge_esms_crosschain\([\s\S]*?\n\}/m)?.[0] || ''
assert.match(bridgeReducer, /burn_tx_hash:\s*String/)
assert.match(bridgeReducer, /source_chain:\s*String/)
assert.match(bridgeReducer, /target_chain:\s*String/)
assert.match(bridgeReducer, /amount:\s*u128/)
assert.match(bridgeReducer, /bridge_transfer\(\)\.insert/)
assert.match(bridgeReducer, /ensure_unprocessed\(/)
assert.match(bridgeReducer, /amount exceeds the Solana Token-2022 u64 range/)
assert.match(bridgeReducer, /record_processed\(/)
assert.match(tables, /pub struct BridgeTransfer[\s\S]*pub status:\s*BridgeStatus/)
assert.match(types, /pub enum BridgeStatus\s*\{\s*PendingMint,\s*Completed\s*\}/)
assert.match(reducers, /pub fn verify_evm_wallet_binding\(/)
assert.match(reducers, /pub fn verify_solana_wallet_binding\(/)
assert.match(reducers, /verified_evm_wallet\(\)[\s\S]*EVM wallet ownership has not been verified/)
assert.match(tables, /pub struct VerifiedSolanaWallet/)
const completionReducer = reducers.match(/pub fn complete_esms_bridge\([\s\S]*?\n\}/m)?.[0] || ''
assert.match(completionReducer, /BridgeStatus::Completed/)
assert.match(completionReducer, /ensure_unprocessed\(/)
assert.match(completionReducer, /bridge_destination_mint/)

const evmSyncReducer = reducers.match(/pub fn sync_evm_event\([\s\S]*?\n\}/m)?.[0] || ''
assert.match(evmSyncReducer, /admin\/feeder only/)
assert.match(evmSyncReducer, /ensure_unprocessed\(/)
assert.match(
  reducers,
  /fn ensure_unprocessed\([\s\S]*?processed_tx\(\)\.tx_hash\(\)\.find/,
  'shared replay guard must read ProcessedTx by transaction hash',
)
assert.match(serve, /path === "\/api\/web3\/burn-esms"/)
assert.match(serve, /path === "\/api\/web3\/verify-wallet"/)
assert.match(ui, /await pentacles\.burnEsmsForJing\(/)
assert.match(ui, /walletConnected/)
assert.match(solanaProgram, /for Jing cast by \{\}/)
assert.match(solanaProgram, /pub fn bridge_mint_esms\(/)
assert.match(solanaProgram, /seeds = \[b"bridge_mint", claim_id\.as_ref\(\)\]/)
assert.match(solanaFeeder, /player: match\[3\]/)
assert.match(solanaFeeder, /event\.amount\.toString\(\)/)
assert.match(bridgeFeeder, /verifyEvmBurn/)
assert.match(bridgeFeeder, /verifySolanaBurn/)
assert.match(bridgeFeeder, /mintEvmDestination/)
assert.match(bridgeFeeder, /mintSolanaDestination/)
assert.match(bridgeFeeder, /compiledInstructionMatches/)
assert.match(walletVerifier, /__identity__:\s*spacetimeIdentity/)
assert.match(dynamicBridge, /connector\?\.getSigner/)
const burnDiscriminator = [...createHash('sha256').update('global:burn_esms_for_jing').digest().subarray(0, 8)]
assert.match(solanaClient, new RegExp(`Buffer\\.from\\(\\[${burnDiscriminator.join(', ')}\\]\\)`))

console.log('PASS hardened Stardex and pending omnichain bridge reducer contracts')
