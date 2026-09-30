// ============================================================
// Pentacles — The Alchm Vessel drawer
// ============================================================
// An illuminated-manuscript folio for the player's elemental treasury:
//   • Arena folio — live from this realm's SpacetimeDB (arena tokens, word
//     wins, Jing & 14-Pillars duel record, pillar pool, current War Table seat).
//   • Treasury folio — the cross-app ESMS ledger from agents.alchm.kitchen
//     /api/vessel/summary, reached with the shared `.alchm.kitchen` sign-in.
//
// Refreshes every 10s while open. A failed treasury refresh keeps the last
// snapshot (per signed-in user) under a "reconnecting" halo; nothing is
// simulated to fill a gap.
//
//   openVesselDrawer() / closeVesselDrawer()

import { h, clear } from '../alchm-chart/dom.js'
import spacetime from '../net/spacetime.js'
import { currentUser, onAuth, signIn } from '../net/auth.js'
import { ESMS } from '../web3/esms.js'
import { VESSEL_STREAMS, foldArenaStats, parseTreasury, streamTotal } from './vessel-model.js'
import './vessel-drawer.css'

const AGENTS = (import.meta.env.VITE_AGENTS_ORIGIN || 'https://agents.alchm.kitchen').replace(/\/+$/, '')
const KITCHEN = (import.meta.env.VITE_KITCHEN_ORIGIN || 'https://alchm.kitchen').replace(/\/+$/, '')
const CACHE_PREFIX = 'pentacles:vessel:v1:'
const REFRESH_MS = 10_000

const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })
const stat = (n) => (n == null ? '—' : fmt(n))

function userKey() {
  const u = currentUser()
  return u ? String(u.id || u.sub || u.email || '') || null : null
}

function readCache(key) {
  if (!key) return null
  try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + key) || 'null') } catch { return null }
}
function writeCache(key, value) {
  if (!key) return
  try {
    if (value) localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value))
    else localStorage.removeItem(CACHE_PREFIX + key)
  } catch {}
}

async function tryQuery(sql) {
  if (!spacetime.configured) return null
  try { return await spacetime.query(sql) } catch { return null }
}

async function readArena() {
  const identity = spacetime.identity
  if (!identity) return null
  const statePlayer = typeof window !== 'undefined' ? window.state?.player : null
  const [players, jingDuels, pillarDuels, seats, pillarPool] = await Promise.all([
    statePlayer ? Promise.resolve(null) : tryQuery('SELECT identity, tokens, word_wins FROM player'),
    tryQuery('SELECT duel_id, initiator, target_player, winner_is_initiator FROM jing_duel'),
    tryQuery('SELECT duel_id, initiator, target_player, winner_is_initiator FROM pillar_duel'),
    tryQuery('SELECT table_id, occupant, counters, melds_value, score FROM melee_seat'),
    tryQuery('SELECT identity, esms FROM pillar_pool'),
  ])
  const player =
    statePlayer ||
    (players || []).find((p) => String(p.identity?.__identity__ ?? p.identity).replace(/^0x/, '').toLowerCase() ===
      String(identity).replace(/^0x/, '').toLowerCase()) ||
    null
  return foldArenaStats({ identity, player, jingDuels, pillarDuels, seats, pillarPool })
}

async function readTreasury() {
  const res = await fetch(`${AGENTS}/api/vessel/summary`, { credentials: 'include', headers: { accept: 'application/json' } })
  if (res.status === 401) return { signedOut: true }
  const body = await res.json().catch(() => null)
  const vessel = parseTreasury(body)
  if (!res.ok || !vessel) throw new Error(body?.error || `HTTP ${res.status}`)
  return { vessel }
}

export class VesselDrawer {
  constructor(el) {
    this.el = el
    this.arena = null
    this.treasury = null
    this.treasuryState = 'loading' // loading | live | reconnecting | signed-out | error
    this._timer = null
    this._offAuth = null
  }

  mount() {
    this.el.classList.add('pv-vessel')
    this.treasury = readCache(userKey())
    this._offAuth = onAuth(() => this.refresh())
    this._timer = setInterval(() => this.refresh(), REFRESH_MS)
    this.paint()
    return this
  }

  destroy() {
    if (this._timer) clearInterval(this._timer)
    if (this._offAuth) this._offAuth()
    this._timer = null
    this._offAuth = null
    clear(this.el)
  }

  async refresh() {
    const key = userKey()
    const [arena] = await Promise.all([readArena().catch(() => null), this._refreshTreasury(key)])
    this.arena = arena
    if (this._timer) this.paint() // skip if destroyed mid-flight
  }

  async _refreshTreasury(key) {
    if (!key) {
      this.treasury = null
      this.treasuryState = 'signed-out'
      return
    }
    try {
      const got = await readTreasury()
      if (got.signedOut) {
        writeCache(key, null)
        this.treasury = null
        this.treasuryState = 'signed-out'
        return
      }
      this.treasury = got.vessel
      writeCache(key, got.vessel)
      this.treasuryState = 'live'
    } catch {
      this.treasury = this.treasury || readCache(key)
      this.treasuryState = this.treasury ? 'reconnecting' : 'error'
    }
  }

  paint() {
    clear(this.el)
    this.el.appendChild(
      h('div', { class: `pv-folio${this.treasuryState === 'reconnecting' ? ' is-reconnecting' : ''}` }, [
        this._title(),
        this._treasury(),
        this._arena(),
        h('footer', { class: 'pv-foot' }, [
          h('a', { href: `${AGENTS}/profile#alchm-vessel`, target: '_blank', rel: 'noopener noreferrer', text: 'Full Vessel on agents.alchm.kitchen ↗' }),
          h('a', { href: `${KITCHEN}/profile`, target: '_blank', rel: 'noopener noreferrer', text: 'Kitchen ledger ↗' }),
        ]),
      ]),
    )
  }

  _title() {
    const chip = {
      live: ['Treasury live', 'is-live'],
      reconnecting: ['Reconnecting · cached', 'is-warn'],
      loading: ['Unsealing…', ''],
      'signed-out': ['Arena only', ''],
      error: ['Treasury unreachable', 'is-err'],
    }[this.treasuryState]
    return h('header', { class: 'pv-title' }, [
      h('span', { class: 'pv-dropcap', text: 'V' }),
      h('div', {}, [
        h('h2', { text: 'The Alchm Vessel' }),
        h('p', { class: 'pv-dim', text: 'The great alembic of your elemental wealth — arena, agents, and kitchen in one folio.' }),
      ]),
      h('span', { class: `pv-chip ${chip[1]}`, text: chip[0] }),
    ])
  }

  _treasury() {
    const v = this.treasury
    if (!v) {
      return h('section', { class: 'pv-section' }, [
        h('h3', { text: 'Treasury' }),
        this.treasuryState === 'signed-out'
          ? h('div', { class: 'pv-empty' }, [
              h('p', { text: 'Sign in with your Alchm account to unseal the cross-app treasury.' }),
              h('button', { class: 'pv-btn', text: 'Sign in', onClick: () => signIn() }),
            ])
          : h('p', { class: 'pv-dim', text: this.treasuryState === 'error' ? 'The treasury could not be read right now.' : 'Unsealing the treasury…' }),
      ])
    }

    const total = ESMS.reduce((sum, e) => sum + Number(v.balances[e.key] || 0), 0)
    return h('section', { class: 'pv-section' }, [
      h('h3', { text: 'Treasury' }),
      h('div', { class: 'pv-flask', 'aria-label': 'ESMS holdings' },
        ESMS.map((e) => {
          const amount = Number(v.balances[e.key] || 0)
          return h('div', { class: 'pv-layer', style: { '--c': e.color, flexGrow: String(total > 0 ? Math.max(amount / total, 0.02) : 1) }, title: `${e.name} ${fmt(amount)}` }, [
            h('span', { class: 'pv-glyph', text: e.glyph }),
            h('span', { text: `${e.name} · ${e.element}` }),
            h('b', { text: fmt(amount) }),
          ])
        }),
      ),
      h('p', { class: 'pv-dim', text: v.balances.totalUsdEquivalent != null ? `≈ $${fmt(v.balances.totalUsdEquivalent)} at the published redeem rail` : 'No USD rail published — valued in elements only.' }),
      h('ul', { class: 'pv-streams' },
        VESSEL_STREAMS.map((s) =>
          h('li', {}, [
            h('span', { class: `pv-tag pv-tag--${s.key}`, text: s.tag }),
            h('span', { class: 'pv-stream-label', text: s.label }),
            h('span', { class: 'pv-esms' },
              ESMS.map((e, i) => h('i', { style: { '--c': e.color }, title: e.name, text: `${e.glyph}${fmt(v.streams[s.key].ledgerEsms[i])}` })),
            ),
            h('b', { text: fmt(streamTotal(v.streams[s.key].ledgerEsms)) }),
          ]),
        ),
      ),
      v.ledger && v.ledger.length
        ? h('ol', { class: 'pv-ledger' },
            v.ledger.slice(0, 6).map((entry) =>
              h('li', {}, [
                h('span', { class: `pv-tag pv-tag--${entry.stream}`, text: entry.stream === 'other' ? 'Ledger' : VESSEL_STREAMS.find((s) => s.key === entry.stream)?.tag || entry.stream }),
                h('span', { class: 'pv-stream-label', text: entry.description || entry.sourceType.replace(/_/g, ' ') }),
                h('b', { text: `${fmt(entry.amount)} ${entry.tokenType}` }),
              ]),
            ),
          )
        : null,
    ])
  }

  _arena() {
    const a = this.arena
    const duel = (d) => (d ? `${d.wins} won / ${d.resolved} resolved` : 'unavailable')
    return h('section', { class: 'pv-section' }, [
      h('h3', { text: 'Arena folio · this realm' }),
      !a
        ? h('p', { class: 'pv-dim', text: spacetime.isLive || spacetime.configured ? 'Reading the arena…' : 'Offline — the arena folio needs a live SpacetimeDB connection.' })
        : h('dl', { class: 'pv-stats' }, [
            h('dt', { text: 'Arena tokens' }), h('dd', { text: stat(a.arenaTokens) }),
            h('dt', { text: 'Word duel wins' }), h('dd', { text: stat(a.wordWins) }),
            h('dt', { text: 'Jing duels' }), h('dd', { text: duel(a.jing) }),
            h('dt', { text: '14 Pillars duels' }), h('dd', { text: duel(a.pillars) }),
            h('dt', { text: 'Pillar pool (10 = 1.0 ESMS)' }),
            h('dd', { text: a.pillarPool ? a.pillarPool.map((v, i) => `${ESMS[i].glyph}${fmt(v)}`).join('  ') : 'unavailable' }),
            h('dt', { text: 'War Table seat' }),
            h('dd', { text: a.seat ? `table ${a.seat.tableId} · ${a.seat.counters} counters · ${a.seat.melds} meld pts · score ${a.seat.score}` : 'not seated' }),
          ]),
      h('p', { class: 'pv-dim pv-note', text: 'War Table tricks and melds score in the arena; they are not credited to the ESMS ledger yet.' }),
    ])
  }
}

// ── overlay wiring (mirrors My Pentacles in main.js) ──
let drawer = null
let escHandler = null

export function openVesselDrawer() {
  let ov = document.getElementById('pv-overlay')
  if (!ov) {
    ov = h('div', { id: 'pv-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'The Alchm Vessel' }, [
      h('div', { class: 'pv-window' }, [
        h('button', { class: 'pv-close', 'aria-label': 'Close', text: '✕', onClick: closeVesselDrawer }),
        h('div', { id: 'pv-host' }),
      ]),
    ])
    ov.addEventListener('click', (e) => { if (e.target === ov) closeVesselDrawer() })
    document.body.appendChild(ov)
  }
  if (drawer) drawer.destroy()
  // mount() subscribes to auth, which fires immediately and runs the first refresh.
  drawer = new VesselDrawer(document.getElementById('pv-host')).mount()
  ov.classList.add('is-open')
  escHandler = (e) => { if (e.key === 'Escape') closeVesselDrawer() }
  document.addEventListener('keydown', escHandler)
}

export function closeVesselDrawer() {
  document.getElementById('pv-overlay')?.classList.remove('is-open')
  if (drawer) { drawer.destroy(); drawer = null }
  if (escHandler) { document.removeEventListener('keydown', escHandler); escHandler = null }
}
