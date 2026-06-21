// ============================================================
// Pentacles — persistent ESMS balance HUD (top-right)
// ============================================================
// Always-on readout of the four ESMS balances. Live (on-chain balanceOfBatch)
// when a wallet is connected on Base Sepolia; clearly-tagged simulation otherwise.

import { wallet } from './wallet.js'
import { ESMS, readEsmsBalances, simEsmsBalances } from './esms.js'

let renderToken = 0

export function initEsmsHud() {
  const hud = document.createElement('div')
  hud.id = 'pentacles-esms'
  hud.className = 'pt-esms'
  hud.setAttribute('aria-label', 'ESMS balances')
  document.body.appendChild(hud)

  const paint = (mode, balances) => {
    const tagTitle =
      mode === 'live'
        ? 'Live on-chain ESMS balances (Base Sepolia)'
        : 'Simulated balances — connect a wallet on Base Sepolia for live ESMS'
    hud.innerHTML =
      `<span class="pt-esms__tag pt-esms__tag--${mode}" title="${tagTitle}">ESMS · ${mode}</span>` +
      ESMS.map(
        (e, i) =>
          `<span class="pt-esms__chip" style="--c:${e.color}" title="${e.name}: ${balances[i].formatted}">` +
          `<b class="pt-esms__glyph">${e.glyph}</b><span class="pt-esms__amt">${fmtAmt(balances[i].formatted)}</span></span>`
      ).join('')
  }

  async function render(snap) {
    const token = ++renderToken
    const live = snap.connected && snap.address && snap.onBaseSepolia
    if (live) {
      try {
        const balances = await readEsmsBalances(snap.address)
        if (token === renderToken) paint('live', balances)
      } catch {
        if (token === renderToken) paint('sim', simEsmsBalances(snap.address))
      }
    } else {
      paint('sim', simEsmsBalances(snap.address || 'guest'))
    }
  }

  wallet.onChange(render)

  // Periodic refresh of live balances (cheap; only when connected on the chain).
  setInterval(() => {
    const s = wallet.snapshot()
    if (s.connected && s.onBaseSepolia) render(s)
  }, 30000)

  return { refresh: () => render(wallet.snapshot()) }
}

function fmtAmt(s) {
  const n = Number(s)
  if (!isFinite(n)) return '0'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  if (n >= 100) return n.toFixed(0)
  return n.toFixed(1)
}
