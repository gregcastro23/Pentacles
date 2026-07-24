import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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

const reducers = await readFile(new URL('../server/src/reducers.rs', import.meta.url), 'utf8')
const tables = await readFile(new URL('../server/src/tables.rs', import.meta.url), 'utf8')

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
assert.match(tables, /pub struct BridgeTransfer[\s\S]*pub status:\s*String/)

const evmSyncReducer = reducers.match(/pub fn sync_evm_event\([\s\S]*?\n\}/m)?.[0] || ''
assert.match(evmSyncReducer, /admin\/feeder only/)
assert.match(evmSyncReducer, /ensure_unprocessed\(/)
assert.match(
  reducers,
  /fn ensure_unprocessed\([\s\S]*?processed_tx\(\)\.tx_hash\(\)\.find/,
  'shared replay guard must read ProcessedTx by transaction hash',
)

console.log('PASS hardened Stardex and pending omnichain bridge reducer contracts')
