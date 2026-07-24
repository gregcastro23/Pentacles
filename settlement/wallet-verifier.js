import { PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { getAddress, hashTypedData, keccak256, stringToHex, verifyTypedData } from 'viem'
import { baseSepolia } from 'viem/chains'
import { WALLET_BINDING_TYPES } from '../src/web3/abis.js'

const ESMS_ADDRESS =
  process.env.ESMS_TOKEN ||
  process.env.VITE_ESMS_TOKEN ||
  '0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F'
const IDENTITY = /^0x[0-9a-f]{64}$/i
const EVM_SIGNATURE = /^0x[0-9a-f]{130}$/i
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/

const domain = {
  name: 'PentaclesWalletBinding',
  version: '1',
  chainId: baseSepolia.id,
  verifyingContract: ESMS_ADDRESS,
}

function json(body, status = 200) {
  return Response.json(body, { status })
}

function parsePayload(body, nowSeconds) {
  const spacetimeIdentity = String(body?.spacetimeIdentity || '').toLowerCase()
  const chain = body?.chain ?? 'evm'
  if (chain !== 'evm' && chain !== 'solana') throw new Error('chain must be evm or solana')
  const wallet = chain === 'solana'
    ? new PublicKey(String(body?.wallet || '')).toBase58()
    : getAddress(String(body?.wallet || ''))
  const signature = String(body?.signature || '')
  const deadline = BigInt(body?.deadline)
  if (!IDENTITY.test(spacetimeIdentity)) {
    throw new Error('spacetimeIdentity must be a 32-byte hex identity')
  }
  if (chain === 'evm' && !EVM_SIGNATURE.test(signature)) {
    throw new Error('EVM signature must be a 65-byte hex value')
  }
  if (chain === 'solana' && !SOLANA_SIGNATURE.test(signature)) {
    throw new Error('Solana signature must be a base58-encoded 64-byte value')
  }
  const now = BigInt(nowSeconds())
  if (deadline < now) throw new Error('wallet binding authorization expired')
  if (deadline > now + 900n) throw new Error('wallet binding deadline is too far in the future')
  return { chain, spacetimeIdentity, wallet, deadline, signature }
}

function bindingMessage(payload) {
  return {
    spacetimeIdentity: payload.spacetimeIdentity,
    wallet: payload.wallet,
    deadline: payload.deadline,
  }
}

function solanaBindingMessage(payload) {
  return [
    'Pentacles Solana Wallet Binding',
    `Identity: ${payload.spacetimeIdentity}`,
    `Wallet: ${payload.wallet}`,
    `Deadline: ${payload.deadline}`,
  ].join('\n')
}

async function defaultVerifyBinding(payload) {
  if (payload.chain === 'solana') {
    const message = solanaBindingMessage(payload)
    const signature = bs58.decode(payload.signature)
    if (signature.length !== 64) return null
    const publicKey = await crypto.subtle.importKey(
      'raw',
      new PublicKey(payload.wallet).toBytes(),
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      signature,
      new TextEncoder().encode(message),
    )
    return valid ? keccak256(stringToHex(message)) : null
  }
  const message = bindingMessage(payload)
  const valid = await verifyTypedData({
    address: payload.wallet,
    domain,
    types: WALLET_BINDING_TYPES,
    primaryType: 'WalletBinding',
    message,
    signature: payload.signature,
  })
  if (!valid) return null
  return hashTypedData({
    domain,
    types: WALLET_BINDING_TYPES,
    primaryType: 'WalletBinding',
    message,
  })
}

async function defaultRecordBinding({ chain, spacetimeIdentity, wallet, proofHash }) {
  const uri = (process.env.SPACETIMEDB_URI || process.env.VITE_SPACETIMEDB_URI || '').replace(/\/+$/, '')
  const db = process.env.SPACETIMEDB_DB || process.env.VITE_SPACETIMEDB_DB || 'cookingwithcastrollc'
  const token = process.env.SPACETIME_TOKEN || ''
  if (!uri || !token) throw new Error('SpacetimeDB wallet verifier is not configured')
  const reducer = chain === 'solana'
    ? 'verify_solana_wallet_binding'
    : 'verify_evm_wallet_binding'
  const res = await fetch(`${uri}/v1/database/${db}/call/${reducer}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify([{ __identity__: spacetimeIdentity }, wallet, proofHash]),
  })
  if (!res.ok) {
    throw new Error(`wallet binding record failed (${res.status}): ${await res.text().catch(() => '')}`)
  }
}

export function createWalletVerificationHandler(overrides = {}) {
  const deps = {
    verifyBinding: defaultVerifyBinding,
    recordBinding: defaultRecordBinding,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    ...overrides,
  }
  return async function handleWalletVerification(req) {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
    let payload
    try {
      const declaredLength = Number(req.headers.get('content-length') || 0)
      if (declaredLength > 16_384) return json({ error: 'Request body is too large' }, 413)
      const rawBody = await req.text()
      if (rawBody.length > 16_384) return json({ error: 'Request body is too large' }, 413)
      payload = parsePayload(JSON.parse(rawBody), deps.nowSeconds)
    } catch (error) {
      return json({ error: error?.message || 'Invalid wallet verification request' }, 400)
    }
    let proofHash
    try {
      proofHash = await deps.verifyBinding(payload)
    } catch {
      proofHash = null
    }
    if (!proofHash) {
      return json({ error: 'WalletBinding signer does not match the EVM wallet' }, 401)
    }
    try {
      await deps.recordBinding({ ...payload, proofHash })
      return json({ verified: true, wallet: payload.wallet, proofHash })
    } catch (error) {
      return json(
        { error: error?.message || 'Wallet verification could not be recorded', retryable: true },
        502,
      )
    }
  }
}

export const handleWalletVerification = createWalletVerificationHandler()
