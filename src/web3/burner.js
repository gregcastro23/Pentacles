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

import { http, createWalletClient } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createBundlerClient, createPaymasterClient, toCoinbaseSmartAccount } from 'viem/account-abstraction'
import { CHAIN, RPC_URL, publicClient } from './chain.js'

const KEY = 'pentacles_burner_key'
const BUNDLER_URL = (import.meta.env.VITE_BUNDLER_URL || '').trim()
const PAYMASTER_URL = (import.meta.env.VITE_PAYMASTER_URL || '').trim()
const isHex32 = (k) => /^0x[0-9a-fA-F]{64}$/.test(k || '')

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
