// ============================================================
// Pentacles — wallet abstraction (injected + Dynamic-ready)
// ============================================================
// A single wallet façade the rest of the app talks to, regardless of whether
// the underlying connector is the injected provider (window.ethereum) or the
// Dynamic React island. Handles connect / disconnect / chain-switch / persistent
// reconnect / account+chain events, and hands out a viem wallet client for signing.

import { createWalletClient, custom, getAddress } from 'viem'
import { CHAIN, RPC_URL, EXPLORER, publicClient } from './chain.js'

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
  async bindToSpacetime() {
    try {
      const spacetime = (await import('../net/spacetime.js')).default
      if (spacetime && spacetime.isLive && (this.address || this.solanaAddress)) {
        await spacetime.callReducer('bind_wallet_address', [this.address || null, this.solanaAddress || null])
      }
    } catch {}
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
