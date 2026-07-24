import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'

const { bridgeEsmsCrosschain, burnEsmsForJing } = await import('../src/web3/burner.js')

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
    settleEvmBurn: async (payload) => {
      settlementPayload = payload
      return { txHash: `0x${'34'.repeat(32)}`, spacetimeSynced: true }
    },
  },
)

assert.equal(signedPayload.primaryType, 'RedeemAuthorization')
assert.equal(signedPayload.message.orderId.slice(2, 4), 'a1')
assert.deepEqual(signedPayload.message.ids, [2n])
assert.deepEqual(signedPayload.message.amounts, [10n])
assert.equal(settlementPayload.signature, `0x${'ab'.repeat(65)}`)
assert.equal(settlementPayload.purpose, 'jing')
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

let registeredBridge
const evmBridgeLifecycle = []
const evmBridgeResult = await bridgeEsmsCrosschain(
  { elementId: 2, amount: 10n },
  {
    wallet: evmWallet,
    nowSeconds: () => 1_800_000_000,
    ensureWalletBinding: async () => evmBridgeLifecycle.push('bind-source'),
    assertBridgeReady: async (payload) => {
      evmBridgeLifecycle.push('preflight')
      assert.equal(payload.sourceChain, 'evm_base_sepolia')
      assert.equal(payload.targetChain, 'solana_token_2022')
    },
    settleEvmBurn: async (payload) => {
      evmBridgeLifecycle.push('burn')
      assert.equal(payload.purpose, 'bridge')
      assert.equal(payload.orderId.slice(2, 4), 'b1')
      return { txHash: `0x${'35'.repeat(32)}`, spacetimeSynced: false }
    },
    registerBridge: async (payload) => {
      evmBridgeLifecycle.push('register')
      registeredBridge = payload
    },
  },
)
assert.deepEqual(evmBridgeLifecycle, ['bind-source', 'preflight', 'burn', 'register'])
assert.equal(evmBridgeResult.status, 'pending_mint')
assert.equal(registeredBridge.sourceChain, 'evm_base_sepolia')
assert.equal(registeredBridge.targetChain, 'solana_token_2022')
assert.equal(registeredBridge.burnTxHash, `0x${'35'.repeat(32)}`)

let registeredSolanaBridge
const solanaBridgeResult = await bridgeEsmsCrosschain(
  { elementId: 1, amount: 9n },
  {
    wallet: {
      address: null,
      solanaAddress: '7YVYdyiZzSw64Xy2VJbZEZFwXFPVQtRejv5q8fYynWnK',
    },
    ensureWalletBinding: async () => {},
    assertBridgeReady: async () => {},
    sendSolanaBridgeBurn: async () => ({ signature: '6'.repeat(88) }),
    registerBridge: async (payload) => {
      registeredSolanaBridge = payload
    },
  },
)
assert.equal(solanaBridgeResult.burnTxHash, '6'.repeat(88))
assert.equal(registeredSolanaBridge.sourceChain, 'solana_token_2022')
assert.equal(registeredSolanaBridge.targetChain, 'evm_base_sepolia')

let burnedWithoutPreflight = false
await assert.rejects(
  () => bridgeEsmsCrosschain(
    { elementId: 0, amount: 1n },
    {
      wallet: evmWallet,
      ensureWalletBinding: async () => {},
      assertBridgeReady: async () => {
        throw new Error('verify the bound Solana wallet before bridging')
      },
      settleEvmBurn: async () => {
        burnedWithoutPreflight = true
        return { txHash: `0x${'36'.repeat(32)}` }
      },
    },
  ),
  /verify the bound Solana wallet/,
)
assert.equal(burnedWithoutPreflight, false, 'a failed bridge preflight must stop before source burn')

console.log('PASS dedicated EVM and Solana bridge burn registration')

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
    orderId: `0xa1${'12'.repeat(31)}`,
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

let bridgeSyncCalled = false
const handleBridgeSettlement = createBurnSettlementHandler({
  verifyAuthorization: async () => true,
  redeemedOrder: async () => false,
  submitRedeem: async () => `0x${'57'.repeat(32)}`,
  verifyReceipt: async () => true,
  syncSpacetime: async () => {
    bridgeSyncCalled = true
  },
  nowSeconds: () => 1_800_000_000,
})
const bridgeSettlementResponse = await handleBridgeSettlement(new Request('http://localhost/api/web3/burn-esms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    purpose: 'bridge',
    from: evmWallet.address,
    orderId: `0xb1${'13'.repeat(31)}`,
    ids: ['2'],
    amounts: ['10'],
    deadline: '1800000600',
    signature: `0x${'ab'.repeat(65)}`,
  }),
}))
const bridgeSettlementBody = await bridgeSettlementResponse.json()
assert.equal(bridgeSettlementResponse.status, 200)
assert.equal(bridgeSettlementBody.purpose, 'bridge')
assert.equal(bridgeSettlementBody.spacetimeSynced, false)
assert.equal(bridgeSyncCalled, false, 'bridge burns must not be consumed as Jing events')
const mismatchedPurposeResponse = await handleBridgeSettlement(new Request('http://localhost/api/web3/burn-esms', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    purpose: 'bridge',
    from: evmWallet.address,
    orderId: `0xa1${'14'.repeat(31)}`,
    ids: ['2'],
    amounts: ['10'],
    deadline: '1800000600',
    signature: `0x${'ab'.repeat(65)}`,
  }),
}))
assert.equal(mismatchedPurposeResponse.status, 400)

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

const {
  bridgeClaimId,
  createBridgeProcessor,
  hasExactEvmBridgeBurn,
  parsePendingBridge,
} = await import('../feeder/bridge-service.ts')
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
const exactTransferBatch = {
  eventName: 'TransferBatch',
  args: {
    from: parsedBridge.sourceAddress,
    to: '0x0000000000000000000000000000000000000000',
    ids: [BigInt(parsedBridge.elementId)],
    values: [parsedBridge.amount],
  },
}
const jingRedeemed = {
  eventName: 'Redeemed',
  args: {
    from: parsedBridge.sourceAddress,
    orderId: `0xa1${'01'.repeat(31)}`,
    ids: [BigInt(parsedBridge.elementId)],
    amounts: [parsedBridge.amount],
  },
}
const bridgeRedeemed = {
  ...jingRedeemed,
  args: { ...jingRedeemed.args, orderId: `0xb1${'02'.repeat(31)}` },
}
assert.equal(
  hasExactEvmBridgeBurn([exactTransferBatch, jingRedeemed], parsedBridge),
  false,
  'a Jing redeem must not become bridge-eligible via its ERC-1155 burn log',
)
assert.equal(hasExactEvmBridgeBurn([exactTransferBatch, bridgeRedeemed], parsedBridge), true)
assert.equal(
  hasExactEvmBridgeBurn([exactTransferBatch], parsedBridge),
  true,
  'raw BURNER_ROLE gateway burns remain bridge-eligible when no Redeemed event exists',
)

const bridgeLifecycle = []
const processBridge = createBridgeProcessor({
  verifyEvmBurn: async () => bridgeLifecycle.push('verify-source'),
  mintSolanaDestination: async () => {
    bridgeLifecycle.push('mint-destination')
    return '7'.repeat(88)
  },
  completeBridge: async (burnTxHash, destinationTxHash) => {
    bridgeLifecycle.push('complete')
    assert.equal(burnTxHash, bridgeRow.burn_tx_hash)
    assert.equal(destinationTxHash, '7'.repeat(88))
  },
})
await processBridge(bridgeRow)
assert.deepEqual(bridgeLifecycle, ['verify-source', 'mint-destination', 'complete'])

const failedBridgeLifecycle = []
const rejectUnverifiedBridge = createBridgeProcessor({
  verifyEvmBurn: async () => {
    failedBridgeLifecycle.push('verify-source')
    throw new Error('source not final')
  },
  mintSolanaDestination: async () => {
    failedBridgeLifecycle.push('mint-destination')
    return '8'.repeat(88)
  },
  completeBridge: async () => failedBridgeLifecycle.push('complete'),
})
await assert.rejects(() => rejectUnverifiedBridge(bridgeRow), /source not final/)
assert.deepEqual(failedBridgeLifecycle, ['verify-source'])
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
    orderId: `0xa1${'12'.repeat(31)}`,
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
  assert.match(
    body,
    /ensure_horizon_action_unspent\(/,
    `${reducer} must consume each attested action independently of caller-supplied hashes`,
  )
  assert.match(body, /record_horizon_action\(/)
}
assert.match(tables, /pub struct HorizonActionReceipt/)

const bridgeReducer = reducers.match(/pub fn bridge_esms_crosschain\([\s\S]*?\n\}/m)?.[0] || ''
const bridgeValidator = reducers.match(/fn validate_bridge_request\([\s\S]*?\n\}/m)?.[0] || ''
assert.match(bridgeReducer, /burn_tx_hash:\s*String/)
assert.match(bridgeReducer, /source_chain:\s*String/)
assert.match(bridgeReducer, /target_chain:\s*String/)
assert.match(bridgeReducer, /amount:\s*u128/)
assert.match(bridgeReducer, /bridge_transfer\(\)\.insert/)
assert.match(bridgeReducer, /ensure_unprocessed\(/)
assert.match(bridgeReducer, /validate_bridge_request\(/)
assert.match(bridgeValidator, /amount exceeds the Solana Token-2022 u64 range/)
assert.match(reducers, /pub fn assert_esms_bridge_ready\([\s\S]*validate_bridge_request\(/)
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
assert.match(solanaProgram, /pub fn bridge_burn_esms\(/)
assert.match(solanaProgram, /pub fn bridge_mint_esms\(/)
assert.match(solanaProgram, /seeds = \[b"bridge_mint", claim_id\.as_ref\(\)\]/)
assert.match(solanaFeeder, /player: match\[3\]/)
assert.doesNotMatch(solanaFeeder, /event\.amount\.toString\(\)/)
assert.match(bridgeFeeder, /verifyEvmBurn/)
assert.match(bridgeFeeder, /verifySolanaBurn/)
assert.match(bridgeFeeder, /mintEvmDestination/)
assert.match(bridgeFeeder, /mintSolanaDestination/)
assert.match(bridgeFeeder, /compiledInstructionMatches/)
assert.match(bridgeFeeder, /"bridge_burn_esms"/)
assert.match(bridgeFeeder, /commitment:\s*"finalized"/)
assert.match(bridgeFeeder, /EVM_CONFIRMATIONS/)
assert.match(walletVerifier, /__identity__:\s*spacetimeIdentity/)
assert.match(dynamicBridge, /connector\?\.getSigner/)
const burnDiscriminator = [...createHash('sha256').update('global:burn_esms_for_jing').digest().subarray(0, 8)]
assert.match(solanaClient, new RegExp(`discriminator:\\s*\\[${burnDiscriminator.join(', ')}\\]`))
const bridgeBurnDiscriminator = [...createHash('sha256').update('global:bridge_burn_esms').digest().subarray(0, 8)]
assert.match(solanaClient, new RegExp(`discriminator:\\s*\\[${bridgeBurnDiscriminator.join(', ')}\\]`))

console.log('PASS hardened Stardex and pending omnichain bridge reducer contracts')
