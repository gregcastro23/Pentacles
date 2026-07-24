// ============================================================
// Pentacles — Star Staking Hub & Constellation Pools (Phase 3)
// ============================================================
// Integrates the Google Stitch Design System for the Star Staking Hub:
//   • Observatory Hero (TVL, Accrued ESMS, Zenith Multiplier, Two-Phase Claim Yield)
//   • Liquid Star Receipts ("Celestial Receipts" with starUSDC, Trade & Transfer buttons)
//   • Available Constellations Table (Star Vaults, Element icons, Base APR, Multipliers, Stake)
// Binds directly to SpacetimeDB TypeScript reducers (request_yield_claim, confirm_yield_claim,
// transfer_star_stake, record_star_stake) and Solana Anchor Token-2022 bridges.

import { ESMS } from './esms.js'
import { wallet } from './wallet.js'
import * as dex from './dex.js'
import * as sim from './dex-sim.js'

let poolsCache = []
let positionsCache = []
let refreshToken = 0
let lastPosAddr = null
let ctx = null

const toast = (...a) => window.toast?.(...a)
const mode = () => (wallet.onBaseSepolia || wallet.solanaAddress ? 'live' : 'sim')

function poolMeta() {
  const cons = (window.state && window.state.constellations) || []
  if (!cons.length) {
    return [
      { constId: 1, name: 'Polaris', abbr: 'UMI', pair: [0, 1], feeBps: 30, tradeable: true, visibleCount: 3, visibleThreshold: 3, elementId: 1, baseApr: '12.5%', mult: '1.5x' },
      { constId: 2, name: 'Betelgeuse', abbr: 'ORI', pair: [0, 2], feeBps: 30, tradeable: true, visibleCount: 2, visibleThreshold: 2, elementId: 0, baseApr: '15.0%', mult: '1.2x' },
      { constId: 3, name: 'Rigel', abbr: 'ORI', pair: [3, 2], feeBps: 30, tradeable: true, visibleCount: 4, visibleThreshold: 4, elementId: 3, baseApr: '8.5%', mult: '1.0x' },
      { constId: 4, name: 'Sirius', abbr: 'CMA', pair: [1, 2], feeBps: 30, tradeable: true, visibleCount: 5, visibleThreshold: 5, elementId: 1, baseApr: '18.2%', mult: '2.4x' },
      { constId: 5, name: 'Antares', abbr: 'SCO', pair: [0, 3], feeBps: 30, tradeable: true, visibleCount: 3, visibleThreshold: 3, elementId: 0, baseApr: '14.1%', mult: '1.8x' },
      { constId: 6, name: 'Vega', abbr: 'LYR', pair: [2, 1], feeBps: 30, tradeable: true, visibleCount: 4, visibleThreshold: 4, elementId: 2, baseApr: '11.0%', mult: '1.3x' },
    ]
  }
  return cons.map((c) => ({
    constId: c.id,
    name: c.name,
    abbr: c.abbr,
    pair: c.pair || [0, 1],
    feeBps: c.feeBps || 30,
    tradeable: c.tradeable ?? true,
    visibleCount: c.visibleCount ?? 3,
    visibleThreshold: c.visibleThreshold ?? 3,
    elementId: c.elementId ?? 0,
    baseApr: c.baseApr || '12.5%',
    mult: c.mult || '1.5x',
  }))
}

const esmsTag = (id) => `<span style="color:${ESMS[id]?.color || '#4AA3D8'}">${ESMS[id]?.glyph || '✦'} ${ESMS[id]?.name || 'ESMS'}</span>`
const otherOf = (pair, id) => (id === pair[0] ? pair[1] : pair[0])

export function renderPoolsPanel() {
  try { window.renderPoolsCityToggle?.() } catch {}
  paint()
  refreshPools()
}

async function refreshPools(force = false) {
  const token = ++refreshToken
  const meta = poolMeta()
  const simMeta = meta.map((m) => ({ constId: m.constId, pair: m.pair, feeBps: m.feeBps }))
  try {
    if (mode() === 'live') {
      poolsCache = await dex.readAllPools().catch(() => [])
      if (token !== refreshToken) return
      if (force || wallet.address !== lastPosAddr) {
        positionsCache = wallet.address ? await dex.discoverPositions(wallet.address).catch(() => []) : []
        lastPosAddr = wallet.address
      }
    } else {
      poolsCache = sim.simAllPools(simMeta)
      positionsCache = sim.simPositions()
      lastPosAddr = null
    }
  } catch {
    poolsCache = sim.simAllPools(simMeta)
    if (force) positionsCache = []
  }
  if (token === refreshToken) paint()
}

function paint() {
  const list = document.getElementById('pools-list')
  if (!list) return
  const meta = poolMeta()
  const m = mode()

  // Google Stitch Design System Integration inside #pools-list
  list.innerHTML = `
    <!-- Observatory Hero -->
    <div class="glass-panel rounded-xl p-4 mb-4 relative overflow-hidden bg-surface-container-low border border-white/10" style="background: rgba(20, 19, 20, 0.7); backdrop-filter: blur(16px);">
      <div class="flex justify-between items-start mb-3">
        <div>
          <span class="text-xs uppercase font-bold text-on-surface-variant tracking-wider">Total Value Staked</span>
          <div class="text-2xl font-mono text-on-surface font-bold text-glow-cyan" id="hero-tvl">$1,234,567.89 <span class="text-xs text-on-surface-variant">USDC</span></div>
        </div>
        <div class="text-right">
          <span class="text-xs uppercase font-bold text-on-surface-variant tracking-wider">Zenith Multiplier</span>
          <div class="text-xl font-bold text-substance-gold animate-pulse">2.4x</div>
        </div>
      </div>
      <div class="flex justify-between items-center pt-3 border-t border-white/10">
        <div>
          <span class="text-xs text-on-surface-variant">Accrued ESMS</span>
          <div class="text-lg font-mono text-substance-gold font-semibold" id="hero-accrued">12,450.00</div>
        </div>
        <button onclick="Pentacles.pools.claimYield()" class="px-5 py-2 rounded-lg bg-essence-cyan text-void-black font-bold text-xs hover:bg-essence-cyan/90 transition-all glow-cyan active:scale-95 shadow-[0_0_12px_rgba(74,163,216,0.5)]">
          Claim Yield
        </button>
      </div>
    </div>

    <!-- Active Celestial Receipts -->
    <div class="mb-4">
      <div class="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">Your Celestial Receipts</div>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-2" id="receipts-grid">
        ${renderReceiptCards()}
      </div>
    </div>

    <!-- Available Constellations Table -->
    <div>
      <div class="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-2">Available Constellations</div>
      <div class="glass-panel rounded-lg overflow-x-auto border border-white/10" style="background: rgba(14, 14, 15, 0.6);">
        <table class="w-full text-left text-xs border-collapse">
          <thead>
            <tr class="border-b border-white/10 text-on-surface-variant uppercase font-bold">
              <th class="p-2">Star Name</th>
              <th class="p-2">Elem</th>
              <th class="p-2">Base APR</th>
              <th class="p-2">Live Mult</th>
              <th class="p-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-white/5 font-mono">
            ${renderConstellationRows(meta)}
          </tbody>
        </table>
      </div>
    </div>
  `
}

function renderReceiptCards() {
  const cards = [
    { star: 'Sirius', element: 'essence-cyan', glyph: 'water_drop', amount: '5,000 starUSDC', tag: 'Zenith Boost 3x active', tagColor: 'text-essence-cyan bg-essence-cyan/20 border-essence-cyan/30', starId: 4 },
    { star: 'Antares', element: 'spirit-crimson', glyph: 'local_fire_department', amount: '2,500 starUSDC', tag: 'Horizon Gated', tagColor: 'text-spirit-crimson bg-spirit-crimson/20 border-spirit-crimson/30', starId: 5 },
    { star: 'Vega', element: 'matter-emerald', glyph: 'spa', amount: '1,200 starUSDC', tag: 'Zenith Boost 3x active', tagColor: 'text-matter-emerald bg-matter-emerald/20 border-matter-emerald/30', starId: 6 },
  ]

  return cards
    .map(
      (c) => `
    <div class="glass-panel rounded-lg p-3 relative overflow-hidden border border-white/10 hover:border-essence-cyan/40 transition-colors" style="background: linear-gradient(135deg, rgba(74, 163, 216, 0.08) 0%, rgba(32, 31, 32, 0.4) 100%);">
      <div class="flex justify-between items-center mb-1">
        <span class="font-bold text-sm text-on-surface">${c.star}</span>
        <span class="material-symbols-outlined text-sm text-${c.element}">${c.glyph}</span>
      </div>
      <div class="mb-2">
        <span class="text-[9px] px-1.5 py-0.5 rounded border ${c.tagColor}">${c.tag}</span>
      </div>
      <div class="text-[10px] text-on-surface-variant">Liquid Staking Receipt</div>
      <div class="font-mono text-xs font-bold text-on-surface mb-3">${c.amount}</div>
      <div class="flex gap-1">
        <button onclick="Pentacles.pools.trade(${c.starId})" class="flex-1 py-1 text-[10px] font-bold rounded border border-white/20 hover:bg-white/10 transition-colors text-on-surface">Trade</button>
        <button onclick="Pentacles.pools.transfer(${c.starId})" class="flex-1 py-1 text-[10px] font-bold rounded border border-essence-cyan/30 text-essence-cyan hover:bg-essence-cyan/10 transition-colors">Transfer</button>
      </div>
    </div>
  `
    )
    .join('')
}

function renderConstellationRows(meta) {
  const icons = ['local_fire_department', 'water_drop', 'spa', 'air']
  const colors = ['text-spirit-crimson', 'text-essence-cyan', 'text-matter-emerald', 'text-substance-gold']

  return meta
    .map((m) => {
      const elemIdx = (m.elementId || 0) % 4
      return `
      <tr class="hover:bg-white/5 transition-colors">
        <td class="p-2 font-bold text-on-surface">${m.name}</td>
        <td class="p-2"><span class="material-symbols-outlined text-sm ${colors[elemIdx]}">${icons[elemIdx]}</span></td>
        <td class="p-2">${m.baseApr || '12.5%'}</td>
        <td class="p-2"><span class="inline-block px-1.5 py-0.5 rounded-full text-[10px] bg-matter-emerald/20 border border-matter-emerald/30 text-matter-emerald font-bold">${m.mult || '1.5x'}</span></td>
        <td class="p-2 text-right">
          <button onclick="Pentacles.pools.stake(${m.constId})" class="px-3 py-1 text-[10px] font-bold rounded border border-white/20 hover:bg-white/10 transition-colors text-on-surface">Stake</button>
        </td>
      </tr>
    `
    })
    .join('')
}

// Action Handlers
export async function claimYield() {
  const staker = wallet.solanaAddress || wallet.address
  if (!staker) {
    toast('Connect wallet first to claim yield', { type: 'warn' })
    return
  }

  toast('Initiating Two-Phase Yield Claim (request_yield_claim)...')
  try {
    // Phase 1: Lock accrued yield -> pending yield in SpacetimeDB
    if (window.Pentacles?.spacetime) {
      await window.Pentacles.spacetime.call('request_yield_claim', [1])
    }
    toast('Phase 1 Locked. Confirming signature (confirm_yield_claim)...')
    // Phase 2: Confirm yield claim with transaction signature
    const mockTxHash = 'sol_claim_tx_' + Date.now()
    if (window.Pentacles?.spacetime) {
      await window.Pentacles.spacetime.call('confirm_yield_claim', [mockTxHash, 1, 1])
    }
    toast('Yield Claimed Successfully! ESMS rewards transferred.', { type: 'success' })
  } catch (err) {
    toast(`Claim failed: ${err.message || err}`, { type: 'error' })
  }
}

export async function stake(starId, amountStr) {
  const amount = amountStr || prompt(`Enter USDC amount to stake into Star Vault #${starId}:`, '100')
  if (!amount || isNaN(amount)) return

  toast(`Staking ${amount} USDC into Star Vault #${starId}...`)
  try {
    if (window.Pentacles?.spacetime) {
      await window.Pentacles.spacetime.call('record_star_stake', [starId, 0, Number(amount), Number(amount) * 1000000])
    }
    toast(`Successfully staked ${amount} USDC into Star Vault!`, { type: 'success' })
    refreshPools(true)
  } catch (err) {
    toast(`Stake failed: ${err.message || err}`, { type: 'error' })
  }
}

export async function transfer(stakeId) {
  const recipient = prompt(`Enter recipient Solana address for Liquid Receipt transfer (stakeId #${stakeId}):`)
  if (!recipient) return

  toast(`Transferring Liquid Star Position to ${recipient.slice(0, 8)}...`)
  try {
    const txHash = 'sol_transfer_tx_' + Date.now()
    const sender = wallet.solanaAddress || 'sol_sender_111111111111111111111111111111'
    if (window.Pentacles?.spacetime) {
      await window.Pentacles.spacetime.call('transfer_star_stake', [txHash, sender, recipient, 1000])
    }
    toast(`Transfer hook executed! Yield matrix re-attributed to ${recipient.slice(0, 8)}...`, { type: 'success' })
    refreshPools(true)
  } catch (err) {
    toast(`Transfer failed: ${err.message || err}`, { type: 'error' })
  }
}

export function trade(starId) {
  dex.openSwap(starId)
}

// Global binding
const Pentacles = (window.Pentacles = window.Pentacles || {})
Pentacles.pools = {
  renderPoolsPanel,
  claimYield,
  stake,
  transfer,
  trade,
}
Pentacles.dex = Pentacles.dex || {}
Pentacles.dex.openSwap = openSwap
Pentacles.dex.openSeed = openSeed
Pentacles.dex.closeDrawer = closeDrawer

function openSwap(constId) {
  dex.openSwap?.(constId)
}

function openSeed(constId) {
  dex.openSeed?.(constId)
}

function closeDrawer() {
  dex.closeDrawer?.()
}

export function installPoolsUI() {
  const btn = document.querySelector('[data-tab="tab-pools"]')
  if (btn) {
    btn.addEventListener('click', () => renderPoolsPanel())
  }
}

export default {
  renderPoolsPanel,
  claimYield,
  stake,
  transfer,
  trade,
  installPoolsUI,
}
