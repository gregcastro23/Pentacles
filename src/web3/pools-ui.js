// ============================================================
// Pentacles — Constellation DEX panel (Phase 3)
// ============================================================
// Replaces the old window.PentaclesBridge stub. Renders the ✦ Pools tab with
// live (or simulated) reserves + spot price per pool, a swap drawer with live
// quote / price impact / slippage, the trace→seed flow, and an LP-positions list
// with withdraw. Horizon-gating + the multi-city preview are preserved (the
// per-pool risen/set state still comes from window.state.constellations, and we
// still call the classic renderPoolsCityToggle()).
//
// Mode: LIVE when a wallet is connected on Base Sepolia (real reads + txs);
// SIMULATION otherwise (self-contained constant-product sim), clearly labeled.

import { ESMS } from './esms.js'
import { wallet } from './wallet.js'
import { txUrl } from './chain.js'
import * as dex from './dex.js'
import * as sim from './dex-sim.js'

let poolsCache = []
let positionsCache = []
let refreshToken = 0
let lastPosAddr = null
let ctx = null // active swap/seed drawer context

const toast = (...a) => window.toast?.(...a)
const mode = () => (wallet.onBaseSepolia ? 'live' : 'sim')

function poolMeta() {
  const cons = (window.state && window.state.constellations) || []
  return cons.map((c) => ({
    constId: c.id,
    name: c.name,
    abbr: c.abbr,
    pair: c.pair,
    feeBps: c.feeBps,
    tradeable: c.tradeable,
    visibleCount: c.visibleCount,
    visibleThreshold: c.visibleThreshold,
  }))
}

const esmsTag = (id) => `<span style="color:${ESMS[id].color}">${ESMS[id].glyph} ${ESMS[id].name}</span>`
const otherOf = (pair, id) => (id === pair[0] ? pair[1] : pair[0])

// ---- panel render ----------------------------------------------------------
export function renderPoolsPanel() {
  // preserve the classic multi-city horizon preview
  try { window.renderPoolsCityToggle?.() } catch {}
  paint() // immediate paint from cache (status), then refresh reserves async
  refreshPools()
}

async function refreshPools(force = false) {
  const token = ++refreshToken
  const meta = poolMeta()
  const simMeta = meta.map((m) => ({ constId: m.constId, pair: m.pair, feeBps: m.feeBps }))
  try {
    if (mode() === 'live') {
      poolsCache = await dex.readAllPools()
      if (token !== refreshToken) return
      // LP positions need an event scan (Deed isn't enumerable) — only refetch on
      // wallet change or after a tx, never on the routine reserve tick.
      if (force || wallet.address !== lastPosAddr) {
        positionsCache = wallet.address ? await dex.discoverPositions(wallet.address) : []
        lastPosAddr = wallet.address
      }
    } else {
      poolsCache = sim.simAllPools(simMeta)
      positionsCache = sim.simPositions()
      lastPosAddr = null
    }
  } catch (e) {
    // live RPC read failed → show sim reserves so the panel still works
    poolsCache = sim.simAllPools(simMeta)
    if (force) positionsCache = []
  }
  if (token === refreshToken) paint()
}

function paint() {
  const list = document.getElementById('pools-list')
  if (!list) return
  const meta = poolMeta()
  if (!meta.length) {
    list.innerHTML = '<div class="pool-empty">Charting the sky…</div>'
    return
  }
  const m = mode()
  const banner =
    m === 'live'
      ? `<div class="pool-banner pool-banner--live">◉ Live · Base Sepolia — trades send real transactions</div>`
      : `<div class="pool-banner pool-banner--sim">○ Simulation — connect a wallet on Base Sepolia to trade for real</div>`

  const byId = new Map(poolsCache.map((p) => [p.constId, p]))
  const rows = [...meta]
    .sort((a, b) => b.tradeable - a.tradeable || b.visibleCount - a.visibleCount)
    .map((mt) => renderRow(mt, byId.get(mt.constId)))
    .join('')

  list.innerHTML = banner + renderPositions(m) + rows
}

function renderRow(mt, pool) {
  const pair = `${esmsTag(mt.pair[0])} <span class="pool-x">↔</span> ${esmsTag(mt.pair[1])}`
  const status = mt.tradeable
    ? `<span class="pool-up">● risen — ${mt.visibleCount}/${mt.visibleThreshold} stars</span>`
    : `<span class="pool-down">○ set — ${mt.visibleCount}/${mt.visibleThreshold} stars</span>`

  let reserves = '<span class="pool-muted">—</span>'
  if (pool && pool.exists) {
    if (pool.reserveA === 0n && pool.reserveB === 0n) {
      reserves = `<span class="pool-muted">no liquidity — seed to open</span>`
    } else {
      const price = dex.spotPrice(pool)
      reserves =
        `${dex.fmtEsms(pool.reserveA)} ${ESMS[mt.pair[0]].glyph} · ${dex.fmtEsms(pool.reserveB)} ${ESMS[mt.pair[1]].glyph}` +
        (price != null
          ? ` <span class="pool-muted">· 1${ESMS[mt.pair[0]].glyph} = ${price.toFixed(3)}${ESMS[mt.pair[1]].glyph}</span>`
          : '')
    }
  } else if (pool && pool.failed) {
    reserves = '<span class="pool-muted">read failed</span>'
  }

  const actions = mt.tradeable
    ? `<button class="btn pool-btn" onclick="Pentacles.dex.openSwap(${mt.constId})">Swap</button>` +
      `<button class="btn pool-btn" onclick="Pentacles.dex.openSeed(${mt.constId})">Seed ✦</button>`
    : `<button class="btn pool-btn" disabled title="Rises again when ${mt.visibleThreshold - mt.visibleCount} more of its stars clear the horizon">Below horizon</button>`

  return `<div class="pool-row ${mt.tradeable ? '' : 'pool-row--set'}">
    <div class="pool-row__top"><b>${mt.name}</b> <span class="pool-fee">${mt.feeBps} bps</span> ${status}</div>
    <div class="pool-row__pair">${pair}</div>
    <div class="pool-row__res">${reserves}</div>
    <div class="pool-row__actions">${actions}</div>
  </div>`
}

function renderPositions(m) {
  if (!positionsCache.length) {
    return `<div class="pool-positions pool-positions--empty">No LP positions yet — seed a risen pool to mint a Constellation Deed${m === 'sim' ? ' (simulation)' : ''}.</div>`
  }
  const meta = new Map(poolMeta().map((x) => [x.constId, x]))
  const items = positionsCache
    .map((pos) => {
      const mt = meta.get(pos.constId)
      return `<div class="pool-pos">
        <span>Deed #${pos.deedId} · <b>${mt ? mt.name : 'Pool ' + pos.constId}</b> · ${dex.fmtEsms(pos.shares)} shares</span>
        <button class="btn pool-btn" onclick="Pentacles.dex.withdrawPosition('${pos.deedId}')">Withdraw</button>
      </div>`
    })
    .join('')
  return `<div class="pool-positions"><div class="pool-positions__title">Your liquidity</div>${items}</div>`
}

// ---- drawer (swap / seed) --------------------------------------------------
function drawer(html) {
  let d = document.getElementById('pools-drawer')
  if (!d) {
    d = document.createElement('div')
    d.id = 'pools-drawer'
    d.className = 'pool-drawer'
    document.body.appendChild(d)
  }
  d.innerHTML =
    `<div class="pool-drawer__backdrop" onclick="Pentacles.dex.closeDrawer()"></div>` +
    `<div class="pool-drawer__card" role="dialog" aria-modal="true">${html}</div>`
  d.style.display = 'block'
  return d
}
function closeDrawer() {
  const d = document.getElementById('pools-drawer')
  if (d) d.style.display = 'none'
  ctx = null
}

function modePill() {
  return mode() === 'live'
    ? `<span class="mode-pill mode-pill--live">◉ Live · Base Sepolia</span>`
    : `<span class="mode-pill mode-pill--sim">○ Simulation</span>`
}

function openSwap(constId) {
  const mt = poolMeta().find((x) => x.constId === constId)
  if (!mt) return
  ctx = { constId, mt, kind: 'swap', lastQuote: null }
  const inId = mt.pair[0]
  const outId = otherOf(mt.pair, inId)
  drawer(`
    <div class="pool-drawer__head"><b>Swap · ${mt.name}</b> ${modePill()}
      <button class="pool-drawer__x" aria-label="Close" onclick="Pentacles.dex.closeDrawer()">×</button></div>
    <label class="swap-lbl">Pay</label>
    <div class="swap-row">
      <select id="swap-in" onchange="Pentacles.dex.onSwapInput()">
        ${mt.pair.map((id) => `<option value="${id}" ${id === inId ? 'selected' : ''}>${ESMS[id].glyph} ${ESMS[id].name}</option>`).join('')}
      </select>
      <input id="swap-amt" type="number" min="0" step="any" placeholder="0.0" oninput="Pentacles.dex.onSwapInput()"/>
    </div>
    <div class="swap-out">Receive ≈ <b id="swap-out">—</b> <span id="swap-out-glyph">${ESMS[outId].glyph}</span></div>
    <div class="swap-meta"><span id="swap-impact"></span><span id="swap-min"></span></div>
    <label class="swap-lbl">Max slippage</label>
    <select id="swap-slip" onchange="Pentacles.dex.onSwapInput()">
      ${[50, 100, 300].map((b) => `<option value="${b}" ${b === 50 ? 'selected' : ''}>${b / 100}%</option>`).join('')}
    </select>
    <button class="btn pool-go" id="swap-go" onclick="Pentacles.dex.doSwap()">${mode() === 'live' ? 'Trace & Swap ✦' : 'Swap (sim) ✦'}</button>
    <div class="swap-note" id="swap-note"></div>
  `)
}

async function onSwapInput() {
  if (!ctx || ctx.kind !== 'swap') return
  const inSel = document.getElementById('swap-in')
  const amtEl = document.getElementById('swap-amt')
  const outEl = document.getElementById('swap-out')
  const glyphEl = document.getElementById('swap-out-glyph')
  const impactEl = document.getElementById('swap-impact')
  const minEl = document.getElementById('swap-min')
  if (!inSel || !amtEl) return
  const inId = Number(inSel.value)
  const outId = otherOf(ctx.mt.pair, inId)
  if (glyphEl) glyphEl.textContent = ESMS[outId].glyph
  const amt = amtEl.value
  if (!amt || Number(amt) <= 0) {
    outEl.textContent = '—'
    impactEl.textContent = ''
    minEl.textContent = ''
    ctx.lastQuote = null
    return
  }
  const inAmt = dex.toEsms(amt)
  const slip = Number(document.getElementById('swap-slip').value)
  const out = mode() === 'live' ? await dex.quoteSwap(ctx.constId, inId, inAmt) : sim.simQuote(ctx.constId, inId, inAmt)
  if (out == null) {
    outEl.textContent = 'no liquidity'
    impactEl.textContent = ''
    minEl.textContent = ''
    ctx.lastQuote = null
    return
  }
  outEl.textContent = dex.fmtEsms(out)
  const pool = poolsCache.find((p) => p.constId === ctx.constId)
  const impact = dex.priceImpact(pool, inId, inAmt, out)
  impactEl.textContent = impact != null ? `Impact ${(impact * 100).toFixed(2)}%` : ''
  const mo = dex.minOut(out, slip)
  minEl.textContent = `Min received ${dex.fmtEsms(mo)}`
  ctx.lastQuote = { inId, outId, inAmt, out, minOut: mo, slip }
}

async function doSwap() {
  if (!ctx || ctx.kind !== 'swap') return
  if (!ctx.lastQuote) return toast('Enter an amount first.', { type: 'warn' })
  const { inId, inAmt, minOut } = ctx.lastQuote
  const note = document.getElementById('swap-note')
  const go = document.getElementById('swap-go')
  go.disabled = true
  try {
    if (mode() === 'live') {
      note.textContent = 'Requesting visibility attestation from the sky-feeder…'
      await dex.requestTrace(ctx.constId)
      const att = await dex.awaitAttestation(ctx.constId)
      note.textContent = 'Submitting swap…'
      const { hash } = await dex.swap({ constId: ctx.constId, inId, inAmt, minOutAmt: minOut, att, sig: att.signature })
      toast('Swap confirmed.', { type: 'success', title: 'Constellation DEX', actions: [{ label: 'View on Basescan', href: txUrl(hash) }] })
    } else {
      sim.simSwap(ctx.constId, inId, inAmt, minOut)
      toast('Swap executed (simulation).', { type: 'success', title: 'Constellation DEX' })
    }
    closeDrawer()
    refreshPools(true)
    window.Pentacles?.esmsHud?.refresh?.()
  } catch (e) {
    const msg = dex.explainRevert(e)
    if (note) note.innerHTML = `<span class="swap-err">${msg}</span>`
    toast(msg, { type: 'error', title: 'Swap failed' })
  } finally {
    if (go) go.disabled = false
  }
}

function openSeed(constId) {
  const mt = poolMeta().find((x) => x.constId === constId)
  if (!mt) return
  ctx = { constId, mt, kind: 'seed' }
  drawer(`
    <div class="pool-drawer__head"><b>Seed liquidity · ${mt.name}</b> ${modePill()}
      <button class="pool-drawer__x" aria-label="Close" onclick="Pentacles.dex.closeDrawer()">×</button></div>
    <p class="seed-note">Deposit both elements to mint a Constellation Deed (LP NFT). The sky-feeder signs a visibility attestation for your risen constellation first.</p>
    <label class="swap-lbl">${ESMS[mt.pair[0]].glyph} ${ESMS[mt.pair[0]].name}</label>
    <input id="seed-a" type="number" min="0" step="any" placeholder="0.0"/>
    <label class="swap-lbl">${ESMS[mt.pair[1]].glyph} ${ESMS[mt.pair[1]].name}</label>
    <input id="seed-b" type="number" min="0" step="any" placeholder="0.0"/>
    <button class="btn pool-go" id="seed-go" onclick="Pentacles.dex.doSeed()">${mode() === 'live' ? 'Trace & Seed ✦' : 'Seed (sim) ✦'}</button>
    <div class="swap-note" id="seed-note"></div>
  `)
}

async function doSeed() {
  if (!ctx || ctx.kind !== 'seed') return
  const aEl = document.getElementById('seed-a')
  const bEl = document.getElementById('seed-b')
  const note = document.getElementById('seed-note')
  const go = document.getElementById('seed-go')
  const a = aEl.value
  const b = bEl.value
  if (!a || !b || Number(a) <= 0 || Number(b) <= 0) return toast('Enter both amounts.', { type: 'warn' })
  const amtA = dex.toEsms(a)
  const amtB = dex.toEsms(b)
  go.disabled = true
  try {
    if (mode() === 'live') {
      note.textContent = 'Requesting visibility attestation from the sky-feeder…'
      await dex.requestTrace(ctx.constId)
      const att = await dex.awaitAttestation(ctx.constId)
      note.textContent = 'Submitting seedLiquidity…'
      const { hash, receipt } = await dex.seedLiquidity({ constId: ctx.constId, amtA, amtB, minShares: 0n, att, sig: att.signature })
      toast('Liquidity seeded — Constellation Deed minted.', {
        type: 'success',
        title: ctx.mt.name,
        actions: [{ label: 'View on Basescan', href: txUrl(hash) }],
      })
    } else {
      const { deedId } = sim.simSeed(ctx.constId, amtA, amtB)
      toast(`Seeded — Constellation Deed #${deedId} minted (simulation).`, { type: 'success', title: ctx.mt.name })
    }
    closeDrawer()
    refreshPools(true)
    window.Pentacles?.esmsHud?.refresh?.()
  } catch (e) {
    const msg = dex.explainRevert(e)
    if (note) note.innerHTML = `<span class="swap-err">${msg}</span>`
    toast(msg, { type: 'error', title: 'Seed failed' })
  } finally {
    if (go) go.disabled = false
  }
}

async function withdrawPosition(deedIdStr) {
  const ok = await window.confirmToast?.('Withdraw 100% of this position?', {
    title: 'Withdraw liquidity',
    confirmLabel: 'Withdraw',
    cancelLabel: 'Keep',
  })
  if (!ok) return
  const deedId = BigInt(deedIdStr)
  try {
    if (mode() === 'live') {
      const { hash } = await dex.withdraw(deedId, 10000)
      toast('Withdrawal confirmed.', { type: 'success', title: 'Constellation DEX', actions: [{ label: 'View on Basescan', href: txUrl(hash) }] })
    } else {
      sim.simWithdraw(deedId, 10000)
      toast('Withdrew position (simulation).', { type: 'success', title: 'Constellation DEX' })
    }
    refreshPools(true)
    window.Pentacles?.esmsHud?.refresh?.()
  } catch (e) {
    toast(dex.explainRevert(e), { type: 'error', title: 'Withdraw failed' })
  }
}

// ---- install: override the classic globals ---------------------------------
export function installPoolsUI() {
  const api = { openSwap, openSeed, doSwap, doSeed, onSwapInput, withdrawPosition, closeDrawer, render: renderPoolsPanel }
  window.Pentacles = window.Pentacles || {}
  window.Pentacles.dex = api
  // Replace the stub renderer + the old trace handler (function-declared globals,
  // so this intercepts the classic internal calls too).
  window.renderPoolsPanel = renderPoolsPanel
  window.traceConstellation = (id) => openSeed(id)
  // refresh reserves on wallet/chain changes so the mode + numbers track the wallet
  wallet.onChange(() => {
    if (document.getElementById('tab-pools')?.classList.contains('active')) renderPoolsPanel()
  })
}
