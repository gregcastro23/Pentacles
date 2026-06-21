// ============================================================
// Pentacles — connection-status badge (the dual-mode indicator)
// ============================================================
// A small fixed pill (bottom-left, clear of the bottom-right toasts) that always
// tells the player whether they're on the live module or local simulation.

import spacetime, { STATUS } from './spacetime.js'

const LABELS = {
  [STATUS.OFFLINE]: { dot: '○', text: 'Local sim', title: 'Offline — running on local simulation' },
  [STATUS.CONNECTING]: { dot: '◐', text: 'Connecting…', title: 'Connecting to the SpacetimeDB module…' },
  [STATUS.LIVE]: { dot: '◉', text: 'Live', title: 'Connected to the live SpacetimeDB module' },
  [STATUS.ERROR]: { dot: '⚠', text: 'Local sim', title: 'Live connection failed — using local simulation' },
}

export function initNetBadge() {
  const badge = document.createElement('button')
  badge.id = 'pentacles-net'
  badge.type = 'button'
  badge.className = 'pt-net pt-net--offline'
  badge.setAttribute('aria-live', 'polite')
  document.body.appendChild(badge)

  let first = true
  spacetime.onStatus((s) => {
    const m = LABELS[s] || LABELS[STATUS.OFFLINE]
    badge.className = `pt-net pt-net--${s}`
    badge.innerHTML = `<span class="pt-net__dot" aria-hidden="true">${m.dot}</span><span>${m.text}</span>`
    badge.title = m.title
    badge.setAttribute('aria-label', m.title)
    if (!first) {
      if (s === STATUS.LIVE) {
        window.toast?.('Connected to the live module.', { type: 'success', title: 'SpacetimeDB' })
      } else if (s === STATUS.ERROR) {
        window.toast?.(
          `Live connection failed — ${spacetime.lastError?.message || 'unreachable'}. Running on local simulation.`,
          { type: 'warn', title: 'SpacetimeDB' }
        )
      }
    }
    first = false
  })

  badge.addEventListener('click', () => {
    const s = spacetime.status
    let detail
    if (!spacetime.configured) {
      detail = 'No SpacetimeDB host configured (set VITE_SPACETIMEDB_URI). Running on local simulation.'
    } else if (s === STATUS.LIVE) {
      detail = `Live · db <b>${spacetime.db}</b>`
    } else {
      detail = `${s}${spacetime.lastError ? ' · ' + spacetime.lastError.message : ''} · db <b>${spacetime.db}</b>`
    }
    window.toast?.(detail, { type: s === STATUS.LIVE ? 'success' : 'info', title: 'Connection' })
  })
}
