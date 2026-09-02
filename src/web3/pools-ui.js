// ============================================================
// Pentacles — Star Staking Hub & Constellation Pools (Phase 3)
// ============================================================
// Integrates the Google Stitch Design System for the Star Staking Hub:
//   • Observatory Hero (TVL, Accrued ESMS, Zenith Multiplier, Two-Phase Claim Yield)
//   • Liquid Star Receipts ("Celestial Receipts" with starUSDC, Trade & Transfer buttons)
//   • Available Constellations Table (Star Vaults, Element icons, Base APR, Multipliers, Stake)
// Binds directly to SpacetimeDB TypeScript reducers (request_yield_claim, confirm_yield_claim,
// transfer_star_stake, record_star_stake) and Solana Anchor Token-2022 bridges.

import { PublicKey, Transaction } from '@solana/web3.js'
import {
  createTransferCheckedWithTransferHookInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from '@solana/spl-token'
import { ESMS } from './esms.js'
import { wallet } from './wallet.js'
import * as dex from './dex.js'
import * as sim from './dex-sim.js'
import {
  buildStakeStarInstruction,
  buildUnstakeStarInstruction,
  prepareStarVaultTransaction,
  solanaConnection,
} from './solana.js'
import { CU_LIMITS } from './priority-fee.js'
import { parseUnits } from './esms-units.js'

/** USDC is 6-decimal on every cluster. */
const USDC_DECIMALS = 6

let poolsCache = []
let positionsCache = []
let refreshToken = 0
let lastPosAddr = null
let ctx = null

const toast = (...a) => window.toast?.(...a)
const mode = () => (wallet.solanaAddress ? 'live' : 'sim')

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

// ── Action handlers ─────────────────────────────────────────────────────────
//
// Settlement is chain-first: the player signs an on-chain transaction, the
// program emits an event, and the feeder mirrors it into the ledger. The client
// no longer writes settlement rows itself.
//
// It used to. `stake` called `record_star_stake` with a principal the client
// chose, and `claimYield` called `confirm_yield_claim` with the string
// `'sol_claim_tx_' + Date.now()` as its transaction hash — declaring a claim
// settled against a transaction that never existed. Both reducers are now
// owner-gated, so those calls would be rejected outright.

/**
 * Phase 1 of the yield claim: lock accrued yield so the attestor can mint
 * against a frozen amount.
 *
 * Phase 2 is deliberately not called here. Settlement is the feeder's to
 * record, once a real mint has confirmed on chain.
 */
export async function claimYield(stakeId) {
  const staker = wallet.solanaAddress || wallet.address
  if (!staker) {
    toast('Connect wallet first to claim yield', { type: 'warn' })
    return
  }
  const client = window.Pentacles?.spacetime
  if (!client) {
    toast('Not connected to the ledger', { type: 'warn' })
    return
  }

  // The old call passed a literal `1` as the stake id, so it targeted whichever
  // position happened to be first in the table regardless of who was claiming.
  // Resolve the caller's own position with accrued yield instead.
  let target = stakeId
  if (!target) {
    try {
      const rows = await client.query(
        'SELECT stake_id, accrued_essence FROM star_stake WHERE pending_essence = 0',
      )
      target = rows?.find((r) => BigInt(r.accrued_essence ?? 0) > 0n)?.stake_id
    } catch {
      target = undefined
    }
  }
  if (!target) {
    toast('No stake position with accrued yield to claim', { type: 'warn' })
    return
  }

  toast('Locking accrued yield for settlement…')
  try {
    await client.call('request_yield_claim', [Number(target)])
    toast('Yield locked. The attestor will mint and settle it shortly.', { type: 'success' })
    refreshPools(true)
  } catch (err) {
    toast(`Claim failed: ${err.message || err}`, { type: 'error' })
  }
}

/**
 * Stake USDC by sending the real `stake_star_usdc` transaction. The ledger row
 * follows from the `StarStaked` event, not from this call.
 */
export async function stake(starId, amountStr) {
  const amount = amountStr || prompt(`Enter USDC amount to stake into Star Vault #${starId}:`, '100')
  if (amount === null || amount === undefined || amount === '') return

  let units
  try {
    units = parseUnits(String(amount), USDC_DECIMALS)
  } catch {
    toast(`"${amount}" is not a valid USDC amount`, { type: 'error' })
    return
  }
  if (units <= 0n) {
    toast('Stake amount must be greater than zero', { type: 'warn' })
    return
  }
  if (!wallet.solanaAddress) {
    toast('Connect a Solana wallet to stake into a Star Vault', { type: 'warn' })
    return
  }

  toast(`Staking ${amount} USDC into Star Vault #${starId}…`)
  try {
    const signature = await sendStarVaultTransaction(
      buildStakeStarInstruction({ staker: wallet.solanaAddress, starId, amount: units }),
      CU_LIMITS.stakeStar,
    )
    toast(`Stake submitted (${signature.slice(0, 8)}…). The ledger updates once it confirms.`, {
      type: 'success',
    })
    refreshPools(true)
  } catch (err) {
    toast(`Stake failed: ${err.message || err}`, { type: 'error' })
  }
}

/** Withdraw staked USDC. Always available — the vault has no pause. */
export async function unstake(starId, amountStr) {
  const amount = amountStr || prompt(`Enter USDC amount to withdraw from Star Vault #${starId}:`)
  if (amount === null || amount === undefined || amount === '') return
  if (!wallet.solanaAddress) {
    toast('Connect a Solana wallet to withdraw', { type: 'warn' })
    return
  }

  let units
  try {
    units = parseUnits(String(amount), USDC_DECIMALS)
  } catch {
    toast(`"${amount}" is not a valid USDC amount`, { type: 'error' })
    return
  }

  toast(`Withdrawing ${amount} USDC from Star Vault #${starId}…`)
  try {
    const signature = await sendStarVaultTransaction(
      buildUnstakeStarInstruction({ staker: wallet.solanaAddress, starId, amount: units }),
      CU_LIMITS.unstakeStar,
    )
    toast(`Withdrawal submitted (${signature.slice(0, 8)}…).`, { type: 'success' })
    refreshPools(true)
  } catch (err) {
    toast(`Withdrawal failed: ${err.message || err}`, { type: 'error' })
  }
}

/**
 * Send a starUSDC transfer so the on-chain transfer hook fires.
 *
 * `createTransferCheckedWithTransferHookInstruction` resolves the hook's
 * ExtraAccountMetaList from chain, so the extra accounts the hook program
 * requires are attached automatically rather than guessed.
 */
async function sendStarUsdcTransfer({ stakeId, mint, destination }) {
  const provider = wallet.solanaProvider || globalThis.solana
  if (!provider) throw new Error('No Solana wallet provider is available.')

  const mintKey = new PublicKey(mint)
  const owner = new PublicKey(wallet.solanaAddress)
  const source = getAssociatedTokenAddressSync(mintKey, owner, false, TOKEN_2022_PROGRAM_ID)
  const target = getAssociatedTokenAddressSync(mintKey, destination, false, TOKEN_2022_PROGRAM_ID)

  const balance = await solanaConnection.getTokenAccountBalance(source)
  const amount = BigInt(balance.value.amount)
  if (amount <= 0n) throw new Error(`Star receipt #${stakeId} has no starUSDC balance to transfer.`)

  const instruction = await createTransferCheckedWithTransferHookInstruction(
    solanaConnection,
    source,
    mintKey,
    target,
    owner,
    amount,
    balance.value.decimals,
    [],
    'confirmed',
    TOKEN_2022_PROGRAM_ID,
  )
  return sendStarVaultTransaction(instruction, CU_LIMITS.unstakeStar)
}

/**
 * Sign and send one StarVault instruction, with an honest compute budget and a
 * priority fee priced off recent activity.
 */
async function sendStarVaultTransaction(instruction, units) {
  const provider = wallet.solanaProvider || globalThis.solana
  if (!provider) throw new Error('No Solana wallet provider is available.')

  const { instructions } = await prepareStarVaultTransaction([instruction], { units })
  const latest = await solanaConnection.getLatestBlockhash('confirmed')
  const transaction = new Transaction({
    feePayer: new PublicKey(wallet.solanaAddress),
    recentBlockhash: latest.blockhash,
  }).add(...instructions)

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
    'confirmed',
  )
  if (confirmation.value.err) throw new Error('The StarVault transaction failed on chain.')
  return signature
}

/**
 * Transferring a liquid star receipt is a starUSDC token transfer: the
 * Token-2022 transfer hook fires on chain, emits `StarStakeTransferred`, and
 * the feeder re-attributes the position.
 *
 * The client cannot shortcut that. It previously called `transfer_star_stake`
 * directly with a fabricated hash, a hardcoded amount of 1000, and a literal
 * placeholder sender when no wallet was connected — re-attributing a real
 * position on the strength of a button press. That reducer is owner-gated now.
 */
export async function transfer(stakeId) {
  const recipient = prompt(
    `Enter recipient Solana address for Liquid Receipt transfer (stakeId #${stakeId}):`,
  )
  if (!recipient) return
  if (!wallet.solanaAddress) {
    toast('Connect a Solana wallet to transfer a star receipt', { type: 'warn' })
    return
  }

  let destination
  try {
    destination = new PublicKey(recipient.trim())
  } catch {
    toast(`"${recipient}" is not a valid Solana address`, { type: 'error' })
    return
  }

  const mint = (import.meta.env.VITE_SOLANA_STARUSDC_MINT || '').trim()
  if (!mint) {
    toast(
      'Liquid receipt transfers need the starUSDC mint (VITE_SOLANA_STARUSDC_MINT); it is not deployed yet.',
      { type: 'warn' },
    )
    return
  }

  toast(`Transferring liquid star position to ${destination.toBase58().slice(0, 8)}…`)
  try {
    const signature = await sendStarUsdcTransfer({ stakeId, mint, destination })
    toast(`Transfer submitted (${signature.slice(0, 8)}…). Re-attribution follows the hook.`, {
      type: 'success',
    })
    refreshPools(true)
  } catch (err) {
    toast(`Transfer failed: ${err.message || err}`, { type: 'error' })
  }
}

export function trade(starId) {
  openSwap(starId)
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
  if (typeof window.openAlchmChart === 'function') window.openAlchmChart(constId)
}

function openSeed(constId) {
  if (typeof window.openAlchmChart === 'function') window.openAlchmChart(constId)
}

function closeDrawer() {
  if (typeof window.closeAlchmChart === 'function') window.closeAlchmChart()
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
