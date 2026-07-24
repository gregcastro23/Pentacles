// ============================================================
// Pentacles — auto burner wallet + ERC-4337 sponsored gas
// ============================================================
// Every device gets a freshly generated burner EOA (NEVER derived from the
// SpacetimeDB identity, which is public → guessable), persisted in localStorage.
// For real swaps the EOA owns a Coinbase Smart Account; gas is sponsored by an
// ERC-4337 paymaster so the user never holds ETH. Bundler + paymaster come from
// VITE_* env; with neither set, sponsorship is unavailable and we say so plainly.
//
//   VITE_BUNDLER_URL    — ERC-4337 bundler RPC (Base Sepolia)
//   VITE_PAYMASTER_URL  — paymaster service (optional; else the bundler sponsors)

import { http, createWalletClient, keccak256, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createBundlerClient, createPaymasterClient, toCoinbaseSmartAccount } from 'viem/account-abstraction'
import { PublicKey, Transaction } from '@solana/web3.js'
import { CHAIN, RPC_URL, ADDRESSES, publicClient } from './chain.js'
import { ESMS_ORDER_PREFIX, REDEEM_AUTH_TYPES } from './abis.js'
import {
  buildBridgeBurnEsmsInstruction,
  buildBurnEsmsInstruction,
  solanaConnection,
} from './solana.js'
import wallet from './wallet.js'

const KEY = 'pentacles_burner_key'
const BUNDLER_URL = (import.meta.env.VITE_BUNDLER_URL || '').trim()
const PAYMASTER_URL = (import.meta.env.VITE_PAYMASTER_URL || '').trim()
const isHex32 = (k) => /^0x[0-9a-fA-F]{64}$/.test(k || '')
const MAX_U64 = (1n << 64n) - 1n
const MAX_U128 = (1n << 128n) - 1n

function loadOrCreateKey() {
  let k = null
  try { k = localStorage.getItem(KEY) } catch {}
  if (!isHex32(k)) {
    k = generatePrivateKey()
    try { localStorage.setItem(KEY, k) } catch {}
  }
  return k
}

class Burner {
  constructor() {
    this._account = null
    this._smart = null
    this._bundler = null
  }

  /** The persisted burner EOA (viem account). Created on first access. */
  get account() {
    if (!this._account) this._account = privateKeyToAccount(loadOrCreateKey())
    return this._account
  }
  get address() { return this.account.address }

  capabilities() { return { hasBurner: true, sponsored: !!BUNDLER_URL } }

  /** Direct EOA wallet client (only useful if the EOA itself holds gas). */
  walletClient() {
    return createWalletClient({ account: this.account, chain: CHAIN, transport: http(RPC_URL) })
  }

  /** Lazily build the Coinbase Smart Account owned by the burner EOA. */
  async smartAccount() {
    if (!this._smart) {
      this._smart = await toCoinbaseSmartAccount({ client: publicClient, owners: [this.account] })
    }
    return this._smart
  }
  async smartAddress() { return (await this.smartAccount()).address }

  /** Bundler client (with paymaster) — null when sponsorship isn't configured. */
  bundler() {
    if (!BUNDLER_URL) return null
    if (!this._bundler) {
      const paymaster = PAYMASTER_URL ? createPaymasterClient({ transport: http(PAYMASTER_URL) }) : true
      this._bundler = createBundlerClient({ client: publicClient, transport: http(BUNDLER_URL), paymaster })
    }
    return this._bundler
  }

  /**
   * The address that appears on-chain as the trader. When sponsorship is
   * configured this is the smart-account address (msg.sender of the userOp);
   * otherwise it's the bare EOA.
   */
  async traderAddress() {
    return BUNDLER_URL ? this.smartAddress() : this.address
  }

  /** Send sponsored calls as one userOperation; throws clearly if unconfigured. */
  async sendSponsored(calls) {
    const b = this.bundler()
    if (!b) throw new Error('Sponsored gas isn’t configured (set VITE_BUNDLER_URL).')
    const account = await this.smartAccount()
    const hash = await b.sendUserOperation({ account, calls })
    const receipt = await b.waitForUserOperationReceipt({ hash })
    return { hash, receipt }
  }

  /** Wipe the burner (new key next time). */
  reset() {
    try { localStorage.removeItem(KEY) } catch {}
    this._account = this._smart = this._bundler = null
  }
}

export const burner = new Burner()
export default burner

function burnAmount(value) {
  let amount
  try {
    amount = BigInt(value)
  } catch {
    throw new Error('amount must be a positive integer')
  }
  if (amount <= 0n) throw new Error('amount must be a positive integer')
  return amount
}

function burnElement(value) {
  const elementId = Number(value)
  if (!Number.isInteger(elementId) || elementId < 0 || elementId > 3) {
    throw new Error('elementId must be an integer between 0 and 3')
  }
  return elementId
}

function defaultOrderId({ address, elementId, amount, purpose = 'jing' }) {
  const nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}:${Math.random()}`
  const digest = keccak256(
    toHex(`pentacles-${purpose}:${address.toLowerCase()}:${elementId}:${amount}:${nonce}`),
  )
  return `0x${ESMS_ORDER_PREFIX[purpose]}${digest.slice(4)}`
}

async function defaultSettleEvmBurn(payload) {
  const res = await fetch('/api/web3/burn-esms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      ids: payload.ids.map(String),
      amounts: payload.amounts.map(String),
      deadline: payload.deadline.toString(),
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(body.error || `ESMS settlement failed (${res.status})`)
  }
  return body
}

async function sendSolanaBurn({
  address,
  elementId,
  amount,
  wallet: activeWallet,
  buildInstruction,
  commitment,
}) {
  const provider = activeWallet.solanaProvider || globalThis.solana
  if (!provider) throw new Error('No Solana wallet provider is available.')

  const instruction = buildInstruction({
    elementId,
    amount,
    playerPublicKey: address,
  })
  const latest = await solanaConnection.getLatestBlockhash('confirmed')
  const transaction = new Transaction({
    feePayer: new PublicKey(address),
    recentBlockhash: latest.blockhash,
  }).add(instruction)

  let signature
  if (typeof provider.signAndSendTransaction === 'function') {
    const sent = await provider.signAndSendTransaction(transaction)
    signature = typeof sent === 'string' ? sent : sent?.signature
  } else if (typeof provider.signTransaction === 'function') {
    const signed = await provider.signTransaction(transaction)
    signature = await solanaConnection.sendRawTransaction(signed.serialize())
  }
  if (!signature) throw new Error('The Solana wallet returned no transaction signature.')

  const confirmation = await solanaConnection.confirmTransaction(
    { signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    commitment,
  )
  if (confirmation.value.err) throw new Error('The Solana ESMS burn transaction failed.')
  return { signature, spacetimeSynced: false }
}

async function defaultSendSolanaBurn(args) {
  return sendSolanaBurn({
    ...args,
    buildInstruction: buildBurnEsmsInstruction,
    commitment: 'confirmed',
  })
}

async function defaultSendSolanaBridgeBurn(args) {
  return sendSolanaBurn({
    ...args,
    buildInstruction: buildBridgeBurnEsmsInstruction,
    commitment: 'finalized',
  })
}

async function submitEvmBurn({ activeWallet, elementId, amount, purpose, deps }) {
  if (!activeWallet.onBaseSepolia) {
    throw new Error('Switch your wallet to Base Sepolia first.')
  }
  const walletClient = activeWallet.walletClient?.()
  if (!walletClient?.signTypedData) {
    throw new Error('The connected EVM wallet cannot sign ESMS burn authorizations.')
  }
  const orderId = deps.createOrderId({
    address: activeWallet.address,
    elementId,
    amount,
    purpose,
  })
  const deadline = BigInt(deps.nowSeconds() + 600)
  const ids = [BigInt(elementId)]
  const amounts = [amount]
  const signature = await walletClient.signTypedData({
    account: activeWallet.address,
    domain: {
      name: 'EsmsToken',
      version: '1',
      chainId: CHAIN.id,
      verifyingContract: ADDRESSES.esms,
    },
    types: REDEEM_AUTH_TYPES,
    primaryType: 'RedeemAuthorization',
    message: {
      from: activeWallet.address,
      orderId,
      ids,
      amounts,
      deadline,
    },
  })
  const settled = await deps.settleEvmBurn({
    purpose,
    from: activeWallet.address,
    orderId,
    ids,
    amounts,
    deadline,
    signature,
  })
  return { ...settled, orderId }
}

async function defaultAssertBridgeReady() {
  const spacetime = (await import('../net/spacetime.js')).default
  if (!spacetime?.isLive) {
    throw new Error('Connect to SpacetimeDB before starting a bridge burn.')
  }
}

export async function registerEsmsBridge({
  burnTxHash,
  sourceChain,
  targetChain,
  elementId,
  amount,
}) {
  const spacetime = (await import('../net/spacetime.js')).default
  if (!spacetime?.isLive) throw new Error('SpacetimeDB is not connected.')
  await spacetime.callReducer('bridge_esms_crosschain', [
    burnTxHash,
    sourceChain,
    targetChain,
    elementId,
    BigInt(amount).toString(),
  ])
}

/**
 * Burn ESMS base units to power a Jing. Solana burns are signed by the active
 * Solana provider; Base Sepolia burns use a holder-signed RedeemAuthorization
 * submitted by the server-side BURNER_ROLE settlement wallet.
 */
export async function burnEsmsForJing({ elementId: rawElementId, amount: rawAmount }, overrides = {}) {
  const deps = {
    wallet,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    createOrderId: defaultOrderId,
    settleEvmBurn: defaultSettleEvmBurn,
    sendSolanaBurn: defaultSendSolanaBurn,
    ensureWalletBinding: async (activeWallet) => activeWallet.bindToSpacetime?.(true),
    ...overrides,
  }
  const elementId = burnElement(rawElementId)
  const amount = burnAmount(rawAmount)
  if (amount > MAX_U128) throw new Error('amount exceeds the supported u128 range')
  const activeWallet = deps.wallet
  await deps.ensureWalletBinding(activeWallet)

  if (activeWallet.solanaAddress) {
    if (amount > MAX_U64) throw new Error('amount exceeds the Solana u64 range')
    const settled = await deps.sendSolanaBurn({
      address: activeWallet.solanaAddress,
      elementId,
      amount,
      wallet: activeWallet,
    })
    return {
      chain: 'solana_token_2022',
      signature: settled.signature,
      spacetimeSynced: settled.spacetimeSynced === true,
    }
  }

  if (activeWallet.address) {
    const settled = await submitEvmBurn({
      activeWallet,
      elementId,
      amount,
      purpose: 'jing',
      deps,
    })
    return {
      chain: 'evm_base_sepolia',
      hash: settled.txHash,
      orderId: settled.orderId,
      spacetimeSynced: settled.spacetimeSynced === true,
    }
  }

  throw new Error('Connect a wallet on Solana Devnet or Base Sepolia first.')
}

/**
 * Burn ESMS on the active chain, then register the confirmed source hash as a
 * pending transfer to the opposite ledger. Bridge burns are distinct
 * from Jing burns, so ProcessedTx can enforce one purpose per source hash.
 */
export async function bridgeEsmsCrosschain(
  { elementId: rawElementId, amount: rawAmount },
  overrides = {},
) {
  const deps = {
    wallet,
    nowSeconds: () => Math.floor(Date.now() / 1000),
    createOrderId: defaultOrderId,
    settleEvmBurn: defaultSettleEvmBurn,
    sendSolanaBridgeBurn: defaultSendSolanaBridgeBurn,
    ensureWalletBinding: async (activeWallet) => activeWallet.bindToSpacetime?.(true),
    assertBridgeReady: defaultAssertBridgeReady,
    registerBridge: registerEsmsBridge,
    ...overrides,
  }
  const elementId = burnElement(rawElementId)
  const amount = burnAmount(rawAmount)
  if (amount > MAX_U64) throw new Error('amount exceeds the Solana u64 bridge range')
  const activeWallet = deps.wallet
  await deps.assertBridgeReady()
  await deps.ensureWalletBinding(activeWallet)

  let burnTxHash
  let orderId
  let sourceChain
  let targetChain
  if (activeWallet.solanaAddress) {
    const settled = await deps.sendSolanaBridgeBurn({
      address: activeWallet.solanaAddress,
      elementId,
      amount,
      wallet: activeWallet,
    })
    burnTxHash = settled.signature
    sourceChain = 'solana_token_2022'
    targetChain = 'evm_base_sepolia'
  } else if (activeWallet.address) {
    const settled = await submitEvmBurn({
      activeWallet,
      elementId,
      amount,
      purpose: 'bridge',
      deps,
    })
    burnTxHash = settled.txHash
    orderId = settled.orderId
    sourceChain = 'evm_base_sepolia'
    targetChain = 'solana_token_2022'
  } else {
    throw new Error('Connect a wallet on Solana Devnet or Base Sepolia first.')
  }

  try {
    await deps.registerBridge({ burnTxHash, sourceChain, targetChain, elementId, amount })
  } catch (error) {
    if (error && typeof error === 'object') error.burnTxHash = burnTxHash
    throw error
  }
  return { burnTxHash, orderId, sourceChain, targetChain, status: 'pending_mint' }
}
