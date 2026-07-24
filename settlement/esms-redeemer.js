import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
  verifyTypedData,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { ESMS_ABI, ESMS_ORDER_PREFIX, REDEEM_AUTH_TYPES } from '../src/web3/abis.js'

export const ESMS_ADDRESS =
  process.env.ESMS_TOKEN ||
  process.env.VITE_ESMS_TOKEN ||
  '0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F'
export const SETTLEMENT_WALLET =
  process.env.ESMS_SETTLEMENT_WALLET ||
  '0x8a332B96232f443931cc423DaC86403a6c752475'

const RPC_URL =
  process.env.BASE_SEPOLIA_RPC ||
  process.env.VITE_BASE_SEPOLIA_RPC ||
  'https://sepolia.base.org'
const TX_HASH = /^0x[0-9a-f]{64}$/i
const BYTES32 = /^0x[0-9a-f]{64}$/i
const SIGNATURE = /^0x[0-9a-f]{130}$/i
const MAX_U128 = (1n << 128n) - 1n

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL),
})

function json(body, status = 200) {
  return Response.json(body, { status })
}

function parsePayload(body, nowSeconds) {
  const purpose = body?.purpose ?? 'jing'
  if (purpose !== 'jing' && purpose !== 'bridge') {
    throw new Error('purpose must be jing or bridge')
  }
  const from = getAddress(String(body?.from || ''))
  const orderId = String(body?.orderId || '')
  const signature = String(body?.signature || '')
  if (!BYTES32.test(orderId)) throw new Error('orderId must be bytes32')
  if (orderId.slice(2, 4).toLowerCase() !== ESMS_ORDER_PREFIX[purpose]) {
    throw new Error(`orderId is not bound to the ${purpose} settlement purpose`)
  }
  if (!SIGNATURE.test(signature)) throw new Error('signature must be a 65-byte hex value')
  if (!Array.isArray(body?.ids) || !Array.isArray(body?.amounts) || body.ids.length !== 1 || body.amounts.length !== 1) {
    throw new Error('exactly one ESMS element burn is required')
  }

  const ids = [BigInt(body.ids[0])]
  const amounts = [BigInt(body.amounts[0])]
  const deadline = BigInt(body.deadline)
  if (ids[0] < 0n || ids[0] > 3n) throw new Error('element id must be between 0 and 3')
  if (amounts[0] <= 0n || amounts[0] > MAX_U128) throw new Error('amount is outside the supported u128 range')
  const now = BigInt(nowSeconds())
  if (deadline < now) throw new Error('authorization expired')
  if (deadline > now + 900n) throw new Error('authorization deadline is too far in the future')
  return { purpose, from, orderId, ids, amounts, deadline, signature }
}

async function defaultVerifyAuthorization(payload) {
  return verifyTypedData({
    address: payload.from,
    domain: {
      name: 'EsmsToken',
      version: '1',
      chainId: baseSepolia.id,
      verifyingContract: ESMS_ADDRESS,
    },
    types: REDEEM_AUTH_TYPES,
    primaryType: 'RedeemAuthorization',
    message: {
      from: payload.from,
      orderId: payload.orderId,
      ids: payload.ids,
      amounts: payload.amounts,
      deadline: payload.deadline,
    },
    signature: payload.signature,
  })
}

async function defaultRedeemedOrder(payload) {
  return publicClient.readContract({
    address: ESMS_ADDRESS,
    abi: ESMS_ABI,
    functionName: 'redeemedOrders',
    args: [payload.orderId],
  })
}

async function defaultSubmitRedeem(payload) {
  const privateKey = process.env.REDEEMER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('settlement signer is not configured')
  }
  const account = privateKeyToAccount(privateKey)
  if (account.address.toLowerCase() !== SETTLEMENT_WALLET.toLowerCase()) {
    throw new Error(`settlement key does not match ${SETTLEMENT_WALLET}`)
  }
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(RPC_URL),
  })
  return walletClient.writeContract({
    address: ESMS_ADDRESS,
    abi: ESMS_ABI,
    functionName: 'redeemFor',
    args: [
      payload.from,
      payload.orderId,
      payload.ids,
      payload.amounts,
      payload.deadline,
      payload.signature,
    ],
  })
}

async function defaultFindRedeemTransaction(payload) {
  const event = ESMS_ABI.find((item) => item.type === 'event' && item.name === 'Redeemed')
  const latest = await publicClient.getBlockNumber()
  const floor = latest > 50_000n ? latest - 50_000n : 0n
  for (let toBlock = latest; toBlock >= floor;) {
    const fromBlock = toBlock > floor + 1_999n ? toBlock - 1_999n : floor
    const logs = await publicClient.getLogs({
      address: ESMS_ADDRESS,
      event,
      args: { from: payload.from, orderId: payload.orderId },
      fromBlock,
      toBlock,
    })
    if (logs.length) return logs.at(-1).transactionHash
    if (fromBlock === floor) break
    toBlock = fromBlock - 1n
  }
  return null
}

async function defaultVerifyReceipt({ txHash, ...payload }) {
  if (!TX_HASH.test(txHash)) return false
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 })
  if (receipt.status !== 'success') return false
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ESMS_ADDRESS.toLowerCase()) continue
    try {
      const decoded = decodeEventLog({ abi: ESMS_ABI, data: log.data, topics: log.topics })
      if (decoded.eventName !== 'Redeemed') continue
      const args = decoded.args
      if (args.from.toLowerCase() !== payload.from.toLowerCase()) continue
      if (args.orderId.toLowerCase() !== payload.orderId.toLowerCase()) continue
      if (args.ids.length !== 1 || args.ids[0] !== payload.ids[0]) continue
      if (args.amounts.length !== 1 || args.amounts[0] !== payload.amounts[0]) continue
      return true
    } catch {
      // A different ESMS event; keep scanning.
    }
  }
  return false
}

async function defaultSyncSpacetime({ txHash, from, ids, amounts }) {
  const uri = (process.env.SPACETIMEDB_URI || process.env.VITE_SPACETIMEDB_URI || '').replace(/\/+$/, '')
  const db = process.env.SPACETIMEDB_DB || process.env.VITE_SPACETIMEDB_DB || 'cookingwithcastrollc'
  const token = process.env.SPACETIME_TOKEN || ''
  if (!uri || !token) throw new Error('SpacetimeDB settlement sync is not configured')
  const res = await fetch(`${uri}/v1/database/${db}/call/sync_evm_event`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify([txHash, from, 'burn', Number(ids[0]), amounts[0].toString()]),
  })
  if (res.ok) return
  const detail = await res.text().catch(() => '')
  if (/already processed/i.test(detail)) return
  throw new Error(`SpacetimeDB sync failed (${res.status}): ${detail}`)
}

export function createBurnSettlementHandler(overrides = {}) {
  const deps = {
    verifyAuthorization: defaultVerifyAuthorization,
    redeemedOrder: defaultRedeemedOrder,
    submitRedeem: defaultSubmitRedeem,
    findRedeemTransaction: defaultFindRedeemTransaction,
    verifyReceipt: defaultVerifyReceipt,
    syncSpacetime: defaultSyncSpacetime,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    ...overrides,
  }

  return async function handleBurnSettlement(req) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    let payload
    try {
      const declaredLength = Number(req.headers.get('content-length') || 0)
      if (declaredLength > 65_536) return json({ error: 'Request body is too large' }, 413)
      const rawBody = await req.text()
      if (rawBody.length > 65_536) return json({ error: 'Request body is too large' }, 413)
      payload = parsePayload(JSON.parse(rawBody), deps.nowSeconds)
    } catch (error) {
      return json({ error: error.message || 'Invalid burn request' }, 400)
    }

    let authorizationValid = false
    try {
      authorizationValid = await deps.verifyAuthorization(payload)
    } catch {
      authorizationValid = false
    }
    if (!authorizationValid) {
      return json({ error: 'RedeemAuthorization signer does not match the ESMS holder' }, 401)
    }

    try {
      let txHash
      if (await deps.redeemedOrder(payload)) {
        txHash = await deps.findRedeemTransaction(payload)
        if (!txHash) throw new Error('redeemed order transaction could not be reconciled')
      } else {
        txHash = await deps.submitRedeem(payload)
      }
      if (!(await deps.verifyReceipt({ ...payload, txHash }))) {
        throw new Error('redeemFor receipt did not contain the expected Redeemed event')
      }
      if (payload.purpose === 'jing') {
        await deps.syncSpacetime({ ...payload, txHash })
      }
      return json({
        txHash,
        orderId: payload.orderId,
        purpose: payload.purpose,
        spacetimeSynced: payload.purpose === 'jing',
      })
    } catch (error) {
      return json({ error: error.message || 'ESMS settlement failed', retryable: true }, 502)
    }
  }
}

export const handleBurnSettlement = createBurnSettlementHandler()
