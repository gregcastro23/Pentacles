// ============================================================
// Pentacles — Solana wallet abstraction (injected + Dynamic-ready)
// ============================================================
// A single wallet façade the rest of the app talks to, supporting injected
// Solana providers (window.solana, Phantom, Solflare) and the Dynamic React island.
// Handles connect / disconnect / persistent reconnect / account events,
// and direct authenticated SpacetimeDB wallet binding via Ed25519 signatures.

import bs58 from 'bs58'
import { SOLANA_CAIP2, SOLANA_CHAIN, SOLANA_RPC_URL } from './solana.js'

const RECONNECT_KEY = 'pentacles_wallet_reconnect'

class Wallet {
  constructor() {
    this.solanaAddress = null
    this.address = null // Alias for compatibility with UI components
    this.connected = false
    this.solanaProvider = null
    this.source = null // 'injected' | 'dynamic'
    this._listeners = new Set()
    this._wired = false
    this._bindingPromise = null
    this._verifiedSolanaBindingKey = null
  }

  snapshot() {
    return {
      address: this.solanaAddress,
      solanaAddress: this.solanaAddress,
      connected: this.connected,
      source: this.source,
      cluster: SOLANA_CAIP2,
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
      if (spacetime && spacetime.isLive && this.solanaAddress && spacetime.identity) {
        await this._verifySolanaOwnership(spacetime)
      }
    } catch (error) {
      console.warn('[Pentacles] Solana wallet binding failed:', error?.message || error)
      if (strict) throw error
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

      const cluster = SOLANA_CHAIN.includes('mainnet') ? 'mainnet-beta' : 'devnet'
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 600)
      const message = [
        'Pentacles Solana Wallet Binding',
        'Domain: pentacles.alchm.kitchen',
        `Cluster: ${cluster}`,
        `Identity: ${identity}`,
        `Pubkey: ${this.solanaAddress}`,
        `Deadline: ${deadline}`,
      ].join('\n')

      const signed = await provider.signMessage(new TextEncoder().encode(message), 'utf8')
      const signatureBytes = signed?.signature ?? signed
      const signature = typeof signatureBytes === 'string'
        ? signatureBytes
        : bs58.encode(signatureBytes)

      await spacetime.callReducer('bind_solana_wallet', [
        cluster,
        this.solanaAddress,
        signature,
        deadline,
      ])

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

  // ---- injected (window.solana / Phantom / Solflare) ----
  async connectInjected() {
    const sol = window.solana
    if (!sol) throw new Error('No Solana wallet extension (e.g. Phantom, Solflare) detected.')
    this.solanaProvider = sol
    this.source = 'injected'
    const resp = await sol.connect()
    const pubkey = resp?.publicKey ? resp.publicKey.toString() : sol.publicKey?.toString()
    if (!pubkey) throw new Error('No public key returned from Solana wallet.')
    this.solanaAddress = pubkey
    this.address = pubkey
    this.connected = true
    if (window.CookieSync) {
      window.CookieSync.persist(RECONNECT_KEY, '1')
    } else {
      localStorage.setItem(RECONNECT_KEY, '1')
    }
    this._wire(sol)
    this._emit()
    return this.solanaAddress
  }

  _wire(sol) {
    if (this._wired || !sol?.on) return
    this._wired = true
    sol.on('accountChanged', (pk) => {
      if (!pk) return this.disconnect()
      const newAddress = pk.toString()
      this.solanaAddress = newAddress
      this.address = newAddress
      this._emit()
    })
    sol.on('disconnect', () => {
      this.disconnect()
    })
  }

  disconnect() {
    this.solanaAddress = null
    this.address = null
    this.connected = false
    this.solanaProvider = null
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
    const sol = window.solana
    if (!sol) return
    try {
      if (sol.isPhantom && sol.connect) {
        const resp = await sol.connect({ onlyIfTrusted: true })
        if (resp?.publicKey) {
          this.solanaProvider = sol
          this.source = 'injected'
          this.solanaAddress = resp.publicKey.toString()
          this.address = this.solanaAddress
          this.connected = true
          this._wire(sol)
          this._emit()
        }
      }
    } catch {}
  }

  /** Called by the Dynamic React island when its primary wallet changes. */
  setDynamicWallet({ address, solanaAddress, provider, solanaProvider } = {}) {
    this.source = 'dynamic'
    this.solanaProvider = solanaProvider || provider || null
    this._verifiedSolanaBindingKey = null
    const effective = solanaAddress || address || null
    this.solanaAddress = effective
    this.address = effective
    this.connected = !!effective
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
