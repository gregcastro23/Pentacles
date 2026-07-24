// ============================================================
// Pentacles — wallet abstraction (injected + Dynamic-ready)
// ============================================================
// A single wallet façade the rest of the app talks to, regardless of whether
// the underlying connector is the injected provider (window.ethereum) or the
// Dynamic React island. Handles connect / disconnect / chain-switch / persistent
// reconnect / account+chain events, and hands out a viem wallet client for signing.

import { createWalletClient, custom, getAddress } from 'viem'
import bs58 from 'bs58'
import { CHAIN, RPC_URL, EXPLORER, ADDRESSES, publicClient } from './chain.js'
import { WALLET_BINDING_TYPES } from './abis.js'

const RECONNECT_KEY = 'pentacles_wallet_reconnect'

class Wallet {
  constructor() {
    this.address = null
    this.solanaAddress = null
    this.chainId = null
    this.connected = false
    this.provider = null // EIP-1193
    this.solanaProvider = null
    this.source = null // 'injected' | 'dynamic'
    this._listeners = new Set()
    this._wired = false
    this._bindingPromise = null
    this._verifiedBindingKey = null
    this._verifiedSolanaBindingKey = null
  }

  get onBaseSepolia() {
    return this.chainId === CHAIN.id
  }
  snapshot() {
    return {
      address: this.address,
      solanaAddress: this.solanaAddress,
      chainId: this.chainId,
      connected: this.connected,
      source: this.source,
      onBaseSepolia: this.onBaseSepolia,
    }
  }
  onChange(cb) {
    this._listeners.add(cb)
    cb(this.snapshot())
    return () => this._listeners.delete(cb)
  }
  async bindToSpacetime(strict = false) {
    try {
      const spacetime = (await import('../net/spacetime.js')).default
      if (spacetime && spacetime.isLive && (this.address || this.solanaAddress)) {
        await spacetime.callReducer('bind_wallet_address', [this.address || null, this.solanaAddress || null])
        if (this.address && spacetime.identity) {
          await this._verifyEvmOwnership(spacetime)
        }
        if (this.solanaAddress && spacetime.identity) {
          await this._verifySolanaOwnership(spacetime)
        }
      }
    } catch (error) {
      console.warn('[Pentacles] wallet binding verification failed:', error?.message || error)
      if (strict) throw error
    }
  }

  async _verifyEvmOwnership(spacetime) {
    const identity = `0x${String(spacetime.identity).toLowerCase().replace(/^0x/, '')}`
    const bindingKey = `${identity}:${this.address.toLowerCase()}`
    if (this._verifiedBindingKey === bindingKey) return
    if (this._bindingPromise) return this._bindingPromise
    this._bindingPromise = (async () => {
      const rows = await spacetime
        .query('SELECT identity, evm_address FROM verified_evm_wallet')
        .catch(() => [])
      const alreadyVerified = rows.some((row) => {
        const rowIdentity = String(row.identity?.__identity__ ?? row.identity ?? '').toLowerCase()
        return rowIdentity.replace(/^0x/, '') === identity.slice(2)
          && String(row.evm_address || '').toLowerCase() === this.address.toLowerCase()
      })
      if (alreadyVerified) {
        this._verifiedBindingKey = bindingKey
        return
      }
      const client = this.walletClient()
      if (!client?.signTypedData) throw new Error('connected wallet cannot sign a WalletBinding proof')
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
      const message = {
        spacetimeIdentity: identity,
        wallet: this.address,
        deadline,
      }
      const signature = await client.signTypedData({
        account: this.address,
        domain: {
          name: 'PentaclesWalletBinding',
          version: '1',
          chainId: CHAIN.id,
          verifyingContract: ADDRESSES.esms,
        },
        types: WALLET_BINDING_TYPES,
        primaryType: 'WalletBinding',
        message,
      })
      const response = await fetch('/api/web3/verify-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...message,
          deadline: deadline.toString(),
          signature,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.verified) {
        throw new Error(body.error || `wallet verification failed (${response.status})`)
      }
      this._verifiedBindingKey = bindingKey
    })()
    try {
      await this._bindingPromise
    } finally {
      this._bindingPromise = null
    }
  }

  async _verifySolanaOwnership(spacetime) {
    const identity = `0x${String(spacetime.identity).toLowerCase().replace(/^0x/, '')}`
    const bindingKey = `${identity}:${this.solanaAddress}`
    if (this._verifiedSolanaBindingKey === bindingKey) return
    if (this._bindingPromise) return this._bindingPromise
    this._bindingPromise = (async () => {
      const rows = await spacetime
        .query('SELECT identity, solana_pubkey FROM verified_solana_wallet')
        .catch(() => [])
      const alreadyVerified = rows.some((row) => {
        const rowIdentity = String(row.identity?.__identity__ ?? row.identity ?? '').toLowerCase()
        return rowIdentity.replace(/^0x/, '') === identity.slice(2)
          && String(row.solana_pubkey || '') === this.solanaAddress
      })
      if (alreadyVerified) {
        this._verifiedSolanaBindingKey = bindingKey
        return
      }
      const provider = this.solanaProvider || globalThis.solana
      if (typeof provider?.signMessage !== 'function') {
        throw new Error('connected Solana wallet cannot sign a wallet ownership proof')
      }
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
      const message = [
        'Pentacles Solana Wallet Binding',
        `Identity: ${identity}`,
        `Wallet: ${this.solanaAddress}`,
        `Deadline: ${deadline}`,
      ].join('\n')
      const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8')
      const signatureBytes = signed?.signature ?? signed
      const signature = typeof signatureBytes === 'string'
        ? signatureBytes
        : bs58.encode(signatureBytes)
      const response = await fetch('/api/web3/verify-wallet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chain: 'solana',
          spacetimeIdentity: identity,
          wallet: this.solanaAddress,
          deadline: deadline.toString(),
          signature,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.verified) {
        throw new Error(body.error || `Solana wallet verification failed (${response.status})`)
      }
      this._verifiedSolanaBindingKey = bindingKey
    })()
    try {
      await this._bindingPromise
    } finally {
      this._bindingPromise = null
    }
  }

  _emit() {
    const snap = this.snapshot()
    this._listeners.forEach((cb) => {
      try { cb(snap) } catch {}
    })
    this.bindToSpacetime()
  }

  // ---- injected (window.ethereum) ----
  async connectInjected() {
    const eth = window.ethereum
    if (!eth) throw new Error('No EVM wallet extension (e.g. MetaMask) detected.')
    this.provider = eth
    this.solanaProvider = null
    this.solanaAddress = null
    this.source = 'injected'
    const accounts = await eth.request({ method: 'eth_requestAccounts' })
    if (!accounts?.length) throw new Error('No accounts returned.')
    this.address = getAddress(accounts[0])
    this.chainId = Number(await eth.request({ method: 'eth_chainId' }))
    this.connected = true
    if (window.CookieSync) {
      window.CookieSync.persist(RECONNECT_KEY, '1')
    } else {
      localStorage.setItem(RECONNECT_KEY, '1')
    }
    this._wire(eth)
    this._emit()
    return this.address
  }

  _wire(eth) {
    if (this._wired || !eth?.on) return
    this._wired = true
    eth.on('accountsChanged', (accs) => {
      if (!accs?.length) return this.disconnect()
      this.address = getAddress(accs[0])
      this._emit()
    })
    eth.on('chainChanged', (cid) => {
      this.chainId = typeof cid === 'string' ? parseInt(cid, 16) : Number(cid)
      this._emit()
    })
  }

  /** Switch the connected wallet to Base Sepolia (adds the chain if missing). */
  async switchToBaseSepolia() {
    const eth = this.provider
    if (!eth) throw new Error('No wallet connected.')
    const hexId = '0x' + CHAIN.id.toString(16)
    try {
      await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] })
    } catch (e) {
      if (e && (e.code === 4902 || e.code === -32603)) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: hexId,
            chainName: CHAIN.name,
            nativeCurrency: CHAIN.nativeCurrency,
            rpcUrls: [RPC_URL],
            blockExplorerUrls: [EXPLORER],
          }],
        })
      } else {
        throw e
      }
    }
    this.chainId = CHAIN.id
    this._emit()
  }

  /** viem wallet client for signing/sending (null until connected). */
  walletClient() {
    if (!this.provider || !this.address) return null
    return createWalletClient({ account: this.address, chain: CHAIN, transport: custom(this.provider) })
  }
  publicClient() {
    return publicClient
  }

  disconnect() {
    this.address = null
    this.solanaAddress = null
    this.connected = false
    this.chainId = null
    this.provider = null
    this.solanaProvider = null
    this._verifiedBindingKey = null
    this._verifiedSolanaBindingKey = null
    this.source = null
    if (window.CookieSync) {
      window.CookieSync.persist(RECONNECT_KEY, null)
    } else {
      localStorage.removeItem(RECONNECT_KEY)
    }
    this._emit()
  }

  /** Silent reconnect on load (no wallet prompt) if previously connected. */
  async tryReconnect() {
    const reconnectVal = window.CookieSync ? window.CookieSync.getCookie(RECONNECT_KEY) : localStorage.getItem(RECONNECT_KEY)
    if (reconnectVal !== '1') return
    const eth = window.ethereum
    if (!eth) return
    try {
      const accounts = await eth.request({ method: 'eth_accounts' })
      if (accounts?.length) {
        this.provider = eth
        this.solanaProvider = null
        this.solanaAddress = null
        this.source = 'injected'
        this.address = getAddress(accounts[0])
        this.chainId = Number(await eth.request({ method: 'eth_chainId' }))
        this.connected = true
        this._wire(eth)
        this._emit()
      }
    } catch {}
  }

  /** Called by the Dynamic React island when its primary wallet changes. */
  setDynamicWallet({ address, solanaAddress, chainId, provider, solanaProvider } = {}) {
    this.source = 'dynamic'
    this.provider = provider || null
    this.solanaProvider = solanaProvider || null
    this._verifiedBindingKey = null
    this._verifiedSolanaBindingKey = null
    this.address = address ? getAddress(address) : null
    this.solanaAddress = solanaAddress || null
    this.chainId = chainId ?? null
    this.connected = !!(address || solanaAddress)
    if (this.connected) {
      if (window.CookieSync) {
        window.CookieSync.persist(RECONNECT_KEY, '1')
      } else {
        localStorage.setItem(RECONNECT_KEY, '1')
      }
    } else {
      if (window.CookieSync) {
        window.CookieSync.persist(RECONNECT_KEY, null)
      } else {
        localStorage.removeItem(RECONNECT_KEY)
      }
    }
    this._emit()
  }
}

export const wallet = new Wallet()
export default wallet
