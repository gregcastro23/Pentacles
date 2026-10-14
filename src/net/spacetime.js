// ============================================================
// Pentacles — dual-mode SpacetimeDB connection (WebSocket, SpacetimeDB 2.x)
// ============================================================
// Live reads now flow over a real WebSocket subscription via the SpacetimeDB 2.6
// TS SDK (`spacetimedb`) + generated bindings (../module_bindings). subscribe()
// is a true reactive subscription: the SDK maintains a client-side row cache and
// fires onInsert/onUpdate/onDelete deltas, which we fan out to listeners as the
// full snapshot — preserving the original `subscribe(table, cb => rows)` contract
// so dashboards/duels/agent panels need no changes.
//
// One-shot reads (query/fetchTable) and reducer writes (callReducer) stay on the
// STABLE HTTP API (/v1/database/<db>/sql, /call/<reducer>, /v1/identity): it is
// proven, version-tolerant, and orthogonal to the push path. The same anonymous
// identity token authenticates both the HTTP calls and the WebSocket.
//
// DUAL-MODE: live only when VITE_SPACETIMEDB_URI is set AND the WebSocket connects;
// otherwise the game runs exactly as before on local simulation. Never hard-fails.
//
// ROW SHAPE: the SDK decodes rows to camelCase keys with typed values (Planet →
// { tag, value }, Identity → instance, Timestamp → instance, u64 → bigint). The
// HTTP /sql path (and every consumer) expects snake_case keys with plain values
// (enum → variant-name string, Option → value|null). `normalizeWsRow` bridges the
// two so the WebSocket path is a drop-in behind the existing interface.

import { DbConnection } from '../module_bindings'
import { normalizeWsRow } from './ws-normalize.js'
import { normalizeSqlResult } from './sats-json.js'
import { askOracle } from './oracle-ask.js'
import { readJingPool, watchJingPool } from './jing-pool.js'

const RAW_URI = (import.meta.env.VITE_SPACETIMEDB_URI || 'https://maincloud.spacetimedb.com').trim()
const DB_NAME = (import.meta.env.VITE_SPACETIMEDB_DB || 'pentacles').trim()
const TOKEN_KEY = 'pentacles_stdb_token'
// A signed-in OIDC token (minted by the Pentacles OIDC issuer from a Google
// session). When present it takes precedence over the anonymous token, so the
// SpacetimeDB identity becomes Identity::from_claims(issuer, user-id) — stable
// across devices. The anonymous token is always kept as a fallback and is never
// overwritten by the signed-in session.
const OIDC_TOKEN_KEY = 'pentacles_oidc_token'

// Normalize the host into an http(s) base URL (accept ws/wss/host forms).
function normalizeBase(uri) {
  if (!uri) return ''
  let u = uri.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://')
  if (!/^https?:\/\//.test(u)) u = 'https://' + u
  return u.replace(/\/+$/, '')
}

export const STATUS = Object.freeze({
  OFFLINE: 'offline',
  CONNECTING: 'connecting',
  LIVE: 'live',
  ERROR: 'error',
})

// Bounded budget for subscription-error recovery (see _onSubscribeError): each
// missing-table drop consumes one; a clean apply or a fresh connect resets it.
// Past the cap we fall back to the old fail-hard STATUS.ERROR behavior instead
// of looping.
const MAX_SUB_RETRIES = 4
// How long a table with no listeners stays subscribed before it is dropped.
const UNSUBSCRIBE_DEBOUNCE_MS = 5000

class SpacetimeClient {
  constructor() {
    this.base = normalizeBase(RAW_URI)
    this.db = DB_NAME
    this.status = STATUS.OFFLINE
    this.lastError = null
    this.token = localStorage.getItem(TOKEN_KEY) || null
    this.authToken = localStorage.getItem(OIDC_TOKEN_KEY) || null // signed-in OIDC token
    this.identity = null
    this._statusListeners = new Set()
    this._tableListeners = new Map() // table -> Set<cb>
    // WebSocket subscription state
    this.conn = null // the live DbConnection (SDK), or null when offline
    this._subscribed = new Set() // table names with at least one listener
    this._boundTables = new Set() // tables whose onInsert/onUpdate/onDelete are wired
    this._appliedTables = new Set() // tables a subscription has actually applied on this connection
    this._pendingEmits = new Set() // tables with deltas awaiting one coalesced emit
    this._pendingDrops = new Set() // tables whose last listener left, awaiting unsubscribe
    this._dropTimer = null
    this._subHandle = null // active SubscriptionHandle (covers all subscribed tables)
    this._retiring = [] // superseded handles, unsubscribed once the replacement applies
    this._resubPending = false // a coalesced _resubscribe is queued
    this._droppedTables = new Set() // tables the module rejected ("no such table") — retried on reconnect
    this._subRetries = 0 // error-recovery re-subscribes since the last clean apply/connect (bounded)
    this._wantLive = false // intent: keep trying to stay connected
    this._reconnectTimer = null
    this._reconnectAttempts = 0
  }

  /** Is a host even configured? */
  get configured() {
    return !!this.base
  }
  get isLive() {
    return this.status === STATUS.LIVE
  }
  /** True when connected under a Google/OIDC identity (vs. anonymous). */
  get signedIn() {
    return !!this.authToken
  }
  /** The token to connect with: the signed-in OIDC token wins over anonymous. */
  get activeToken() {
    return this.authToken || this.token
  }

  onStatus(cb) {
    this._statusListeners.add(cb)
    cb(this.status, this)
    return () => this._statusListeners.delete(cb)
  }
  _setStatus(s, err = null) {
    if (this.status === s && err === this.lastError) return
    this.status = s
    this.lastError = err
    this._statusListeners.forEach((cb) => {
      try { cb(s, this) } catch {}
    })
  }

  /**
   * Attempt to go live over a WebSocket subscription. Resolves to true once the
   * connection is established, false if offline/failed. Idempotent: a second call
   * while already live/connecting is a no-op.
   */
  async connect() {
    if (!this.configured) {
      this._setStatus(STATUS.OFFLINE)
      return false
    }
    if (this.conn && (this.isLive || this.status === STATUS.CONNECTING)) return this.isLive
    this._wantLive = true
    this._setStatus(STATUS.CONNECTING)
    try {
      // Reuse a stable anonymous identity/token for both the WS and HTTP paths.
      await this.ensureIdentity()
    } catch (e) {
      // Identity is best-effort: the SDK can mint one on connect. Carry on.
      this.lastError = e
    }
    return new Promise((resolve) => {
      let settled = false
      const done = (ok) => { if (!settled) { settled = true; resolve(ok) } }
      try {
        let builder = DbConnection.builder()
          .withUri(this.base)
          .withDatabaseName(this.db)
          .onConnect((conn, identity, token) => {
            this.conn = conn
            try {
              this.identity = identity?.toHexString?.() || this.identity
              // Persist the echoed token only when connecting ANONYMOUSLY — the
              // server mints a long-lived token for anonymous connects. When
              // signed in, onConnect echoes back our own OIDC token, which must
              // NOT overwrite the stable anonymous fallback token.
              if (token && !this.authToken) {
                this.token = token
                if (window.CookieSync) {
                  window.CookieSync.persist(TOKEN_KEY, token)
                } else {
                  localStorage.setItem(TOKEN_KEY, token)
                }
              }
            } catch {}
            this._reconnectAttempts = 0
            this._restoreDroppedTables()
            this._setStatus(STATUS.LIVE)
            this._resubscribe()
            done(true)
          })
          .onConnectError((_ctx, err) => {
            this._setStatus(STATUS.ERROR, err)
            this._scheduleReconnect()
            done(false)
          })
          .onDisconnect((_ctx, err) => {
            this.conn = null
            this._subHandle = null
            this._boundTables.clear()
    this._appliedTables.clear()
            this._retiring = [] // handles of the old connection
            if (this._wantLive) {
              this._setStatus(STATUS.ERROR, err || new Error('disconnected'))
              this._scheduleReconnect()
            } else {
              this._setStatus(STATUS.OFFLINE)
            }
            done(false)
          })
        if (this.activeToken) builder = builder.withToken(this.activeToken)
        builder.build()
      } catch (e) {
        this._setStatus(STATUS.ERROR, e)
        done(false)
      }
    })
  }

  /** Tear down the live connection and stop reconnecting (back to offline sim). */
  disconnect() {
    this._wantLive = false
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null }
    try { this._subHandle?.unsubscribe?.() } catch {}
    try { this.conn?.disconnect?.() } catch {}
    this.conn = null
    this._subHandle = null
    this._boundTables.clear()
    this._appliedTables.clear()
    this._retiring = [] // handles of the old connection
    this._setStatus(STATUS.OFFLINE)
  }

  _scheduleReconnect() {
    if (!this._wantLive || this._reconnectTimer) return
    const delay = Math.min(30000, 1500 * 2 ** Math.min(this._reconnectAttempts, 4))
    this._reconnectAttempts += 1
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      if (this._wantLive && !this.conn) this.connect().catch(() => {})
    }, delay)
  }

  /** Create (once) an anonymous SpacetimeDB identity + token for a stable sender. */
  async ensureIdentity() {
    if (!this.token) {
      const res = await fetch(`${this.base}/v1/identity`, { method: 'POST' })
      if (!res.ok) throw new Error(`identity ${res.status}: ${await res.text().catch(() => '')}`)
      const j = await res.json()
      this.token = j.token || j.Token || null
      if (j.identity || j.Identity) this.identity = j.identity || j.Identity
      if (this.token) {
        if (window.CookieSync) {
          window.CookieSync.persist(TOKEN_KEY, this.token)
        } else {
          localStorage.setItem(TOKEN_KEY, this.token)
        }
      }
    }
    // Derive the identity from the active JWT (signed-in OIDC token if present,
    // else anonymous). For an OIDC token the hex_identity claim is absent, so
    // this stays null here and is set authoritatively from onConnect's identity.
    if (this.activeToken && !this.identity) this.identity = identityFromToken(this.activeToken)
    return this.activeToken
  }

  _authHeaders(extra = {}) {
    const t = this.activeToken
    return t ? { Authorization: `Bearer ${t}`, ...extra } : { ...extra }
  }

  /**
   * Sign in with an OIDC token (minted by the Pentacles issuer from a Google
   * session): persist it, then reconnect so the SDK presents it and the module
   * sees the signed-in identity. Callers that want to keep the current
   * anonymous profile should run the link/claim flow (see net/auth.js) BEFORE
   * calling this, while still connected anonymously.
   */
  async signInWithToken(oidcToken) {
    if (!oidcToken) throw new Error('No token.')
    this.authToken = oidcToken
    try { localStorage.setItem(OIDC_TOKEN_KEY, oidcToken) } catch {}
    this.identity = identityFromToken(oidcToken) || this.identity
    return this._reconnectFresh()
  }

  /** Sign out: drop the OIDC token and reconnect as the anonymous identity. */
  async signOut() {
    this.authToken = null
    try { localStorage.removeItem(OIDC_TOKEN_KEY) } catch {}
    this.identity = this.token ? identityFromToken(this.token) : null
    return this._reconnectFresh()
  }

  /** Fully tear down and re-establish the live connection with the current token. */
  async _reconnectFresh() {
    const wasLive = this._wantLive
    try { this._subHandle?.unsubscribe?.() } catch {}
    try { this.conn?.disconnect?.() } catch {}
    this.conn = null
    this._subHandle = null
    this._boundTables.clear()
    this._appliedTables.clear()
    this._retiring = [] // handles of the old connection
    if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null }
    this._reconnectAttempts = 0
    if (!wasLive && !this.configured) return false
    return this.connect()
  }

  /**
   * Run a read-only SQL query against the module. Returns an array of plain row
   * objects (column-name → value), normalized across SpacetimeDB response shapes.
   */
  async query(sql) {
    if (!this.configured) throw new Error('SpacetimeDB not configured')
    const res = await fetch(`${this.base}/v1/database/${this.db}/sql`, {
      method: 'POST',
      headers: this._authHeaders({ 'Content-Type': 'text/plain' }),
      body: sql,
    })
    if (!res.ok) throw new Error(`sql ${res.status}: ${await res.text().catch(() => '')}`)
    const json = await res.json()
    return normalizeSqlResult(json)
  }

  /**
   * Call a reducer by name with positional args (already in the module's JSON
   * arg format). Throws on non-2xx with the server's error text.
   */
  async callReducer(name, args = []) {
    if (!this.configured) throw new Error('SpacetimeDB not configured')
    if (!this.token) await this.ensureIdentity()
    const res = await fetch(`${this.base}/v1/database/${this.db}/call/${name}`, {
      method: 'POST',
      headers: this._authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(args),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`reducer ${name} ${res.status}: ${txt}`)
    }
    return res.status
  }

  // ---- reactive WebSocket subscriptions -------------------------------------
  // Register a callback for a table. The callback is invoked with the FULL set of
  // rows (snake_case, normalized) on the initial sync and again on every delta —
  // the SDK keeps the client cache, we re-emit the snapshot. Same contract as the
  // old polled version, so consumers (dashboards, etc.) are unchanged.
  subscribe(table, cb) {
    if (!this._tableListeners.has(table)) this._tableListeners.set(table, new Set())
    this._tableListeners.get(table).add(cb)
    // An explicit (re-)subscribe gives a previously dropped table another chance
    // (e.g. the module has been republished with it since).
    this._droppedTables.delete(table)
    const isNewTable = !this._subscribed.has(table)
    this._subscribed.add(table)
    if (this.isLive && this.conn) {
      if (isNewTable) this._scheduleResubscribe() // server replication set changed
      else this._emitTable(table, cb) // catch this listener up immediately
    }
    return () => {
      const listeners = this._tableListeners.get(table)
      listeners?.delete(cb)
      if (listeners && listeners.size === 0) this._scheduleDrop(table)
    }
  }

  /**
   * Stop replicating a table once nobody listens to it. Before this, opening the
   * Faction War overlay once kept every melee_* insert and delete streaming for
   * the rest of the session. Debounced so an overlay that closes and reopens (or
   * two views handing a table over) keeps its subscription instead of churning it.
   */
  _scheduleDrop(table) {
    this._pendingDrops.add(table)
    if (this._dropTimer) clearTimeout(this._dropTimer)
    this._dropTimer = setTimeout(() => {
      this._dropTimer = null
      let changed = false
      for (const t of this._pendingDrops) {
        if ((this._tableListeners.get(t)?.size ?? 0) === 0) {
          // A table nobody listens to is not worth retrying on reconnect either.
          this._droppedTables.delete(t)
          this._appliedTables.delete(t)
          if (this._subscribed.delete(t)) changed = true
        }
      }
      this._pendingDrops.clear()
      if (changed && this.isLive && this.conn) this._scheduleResubscribe()
    }, UNSUBSCRIBE_DEBOUNCE_MS)
  }

  /**
   * (Re)issue a single subscription covering every registered table, and wire the
   * per-table delta handlers once. Called on connect and whenever a new table is
   * subscribed. Idempotent on the handler binding.
   */
  /**
   * One `_resubscribe` per microtask, however many tables were added or dropped
   * in it. Faction War subscribes nine tables in one loop; each used to send its
   * own Subscribe + Unsubscribe pair, re-shipping every table each time.
   */
  _scheduleResubscribe() {
    if (this._resubPending) return
    this._resubPending = true
    queueMicrotask(() => {
      this._resubPending = false
      if (this.isLive && this.conn) this._resubscribe()
    })
  }

  /** Unsubscribe every superseded handle that is still live. */
  _retireHandles() {
    const old = this._retiring
    this._retiring = []
    for (const h of old) {
      try { if (h && !h.isEnded?.()) h.unsubscribe?.() } catch {}
    }
  }

  _resubscribe() {
    if (!this.conn) return
    if (!this._subscribed.size) {
      // Every table was dropped: end the live subscription rather than leave it running.
      if (this._subHandle) this._retiring.push(this._subHandle)
      this._subHandle = null
      this._retireHandles()
      return
    }
    // Bind delta handlers once per table; each delta re-emits the snapshot.
    for (const table of this._subscribed) {
      if (this._boundTables.has(table)) continue
      const handle = this.conn.db?.[table]
      if (!handle) continue
      const onChange = () => this._scheduleEmit(table)
      try { handle.onInsert?.(onChange) } catch {}
      try { handle.onDelete?.(onChange) } catch {}
      try { handle.onUpdate?.(onChange) } catch {}
      this._boundTables.add(table)
    }
    // Replace the active subscription with one covering all registered tables —
    // make before break: the previous handle is retired only once this one has
    // applied. The SDK refcounts rows across query sets, so rows of tables in
    // both sets never leave the cache (and never flash empty in the UI). An
    // errored handle has already ended server-side — unsubscribing it again
    // throws / sends a bogus Unsubscribe — so only still-live ones are retired.
    const tables = [...this._subscribed]
    const queries = tables.map((t) => `SELECT * FROM ${t}`)
    if (this._subHandle) this._retiring.push(this._subHandle)
    this._subHandle = null
    try {
      let handle = null
      handle = this.conn
        .subscriptionBuilder()
        .onApplied(() => {
          this._subRetries = 0 // clean apply → reset the recovery budget
          if (handle === this._subHandle) this._retireHandles()
          // Only this handle's tables have rows in the cache now. A table added
          // after it was sent is still emitted below, but from an empty cache.
          for (const t of tables) if (this._subscribed.has(t)) this._appliedTables.add(t)
          for (const t of this._subscribed) this._emitTable(t)
        })
        // The SDK calls onError(ctx, err) with ctx.event = the server Error.
        .onError((ctx, err) => this._onSubscribeError(handle, ctx?.event || err))
        .subscribe(queries)
      this._subHandle = handle
    } catch (e) {
      this._setStatus(STATUS.ERROR, e)
    }
  }

  /**
   * The server rejected (or dropped) our combined subscription. The failure mode
   * this must survive is a MIXED-VERSION window: the client bindings know a table
   * the deployed module does not have yet (e.g. `service_status` before a module
   * republish). The server rejects the WHOLE query set in that case, the old
   * handle is already gone, and without recovery every live table silently
   * freezes for the rest of the session (the WS stays open, so no reconnect
   * fires). Recovery: when the error names a table we subscribe to, drop just
   * that table, warn once, and re-issue the remaining queries — status stays
   * LIVE. Dropped tables get retried on the next (re)connect: a module republish
   * severs the WS, so the reconnect lands exactly when the table is likely to
   * exist. An error that names no table, or more than MAX_SUB_RETRIES recoveries
   * without a clean apply, keeps the old fail-hard behavior (STATUS.ERROR).
   */
  _onSubscribeError(handle, err) {
    // A late error from a handle we already replaced — the current subscription
    // is what matters; ignore the stale one.
    if (handle && this._subHandle && handle !== this._subHandle) return
    this._subHandle = null // an errored handle is dead; never unsubscribe it again
    const error = err instanceof Error ? err : new Error(String(err || 'subscription error'))
    const table = unknownTableFromError(error)
    if (table && this._subscribed.has(table) && this._subRetries < MAX_SUB_RETRIES) {
      this._subRetries += 1
      this._subscribed.delete(table)
      this._appliedTables.delete(table)
      this._droppedTables.add(table)
      // NOTE: deliberately KEEP the _boundTables entry — the delta handlers are
      // registered on this connection's client cache and stay valid, so a later
      // successful subscribe (republish + reconnect, or an explicit subscribe())
      // must not double-bind them. _tableListeners also stays put: listeners
      // resume firing as soon as the table subscribes cleanly again.
      console.warn(
        `[spacetime] module "${this.db}" has no table "${table}" (module older than the client bindings?) — ` +
          `dropped it from the live subscription; keeping the other ${this._subscribed.size} table(s) live. ` +
          `It will be retried on the next reconnect. Server said: ${error.message}`,
      )
      if (this._subscribed.size) this._resubscribe()
      return
    }
    this._setStatus(STATUS.ERROR, error)
  }

  /**
   * Give tables dropped in a previous mixed-version window another chance on a
   * fresh connection, and reset the recovery budget. Called from onConnect.
   */
  _restoreDroppedTables() {
    this._subRetries = 0
    // Only tables someone still listens to are worth another try.
    for (const t of this._droppedTables) if (this._tableListeners.get(t)?.size) this._subscribed.add(t)
    this._droppedTables.clear()
  }

  /**
   * Coalesce row deltas into ONE emit per table per microtask. The SDK fires a
   * callback per row, and every emit re-reads and re-normalizes the whole cached
   * table — so a War Table that plays 72 cards in one transaction, or a prune
   * that deletes a few thousand rows, used to cost that many full snapshots and
   * repaints. All deltas of a transaction arrive synchronously, so a microtask
   * flush sees the finished state exactly once.
   */
  _scheduleEmit(table) {
    if (this._pendingEmits.has(table)) return
    this._pendingEmits.add(table)
    if (this._pendingEmits.size > 1) return // a flush is already queued
    queueMicrotask(() => {
      const tables = [...this._pendingEmits]
      this._pendingEmits.clear()
      for (const t of tables) this._emitTable(t)
    })
  }

  /** Read the current cache for a table, normalize, and fan out to listeners. */
  _emitTable(table, onlyCb = null) {
    if (!this.conn) return
    const targets = onlyCb ? [onlyCb] : this._tableListeners.get(table)
    if (!targets || (targets.size ?? targets.length) === 0) return // nobody to tell: skip the snapshot
    let rows
    try {
      rows = [...this.conn.db[table].iter()].map(normalizeWsRow)
    } catch {
      return
    }
    targets.forEach((cb) => {
      try { cb(rows) } catch {}
    })
  }

  /**
   * True once a subscription covering `table` has applied on this connection.
   * Until then an emitted snapshot of it is just the empty client cache.
   */
  isApplied(table) {
    return this._appliedTables.has(table)
  }

  /** One-shot poll helper used by phases that need fresh rows on demand. */
  async fetchTable(table, whereSql = '') {
    return this.query(`SELECT * FROM ${table}${whereSql ? ' WHERE ' + whereSql : ''}`)
  }

  // ---- live reducer helpers (Phases 5–6) ------------------------------------
  // Arg encoding (SpacetimeDB 2.x): a unit enum is { camelCaseVariant: [] } (e.g.
  // { mars: [] }, { vacuum: [] } — see jingMoveArg/planetVariant); an Option is
  // { some: <value> } / { none: [] }. Verified live against the 2.x module; the
  // agent/constellation pages gate every call behind `isLive` and fall back to the
  // bundled simulation when offline.

  /** Add a star to a constellation → raises resolution, mints a block. */
  async addStarToConstellation(constellationId, hipId) {
    return this.callReducer('add_star_to_constellation', [Number(constellationId), Number(hipId)])
  }

  /** Cast a Jing at a planetary agent (body idx 0–9) or a player (identity hex). */
  async castJing(moveId, { agentBody = null, playerIdentity = null } = {}) {
    // planetVariant falls back to the Sun; a body the module has no Planet for
    // (Chiron is 10) must not become a cast at the Sun.
    if (agentBody != null && !PLANET_VARIANT[agentBody]) throw new Error(`no module planet for body ${agentBody}`)
    const tp = playerIdentity ? { some: playerIdentity } : { none: [] }
    const ta = agentBody != null ? { some: planetVariant(agentBody) } : { none: [] }
    return this.callReducer('cast_jing', [jingMoveArg(moveId), tp, ta])
  }

  /** Counter an open Jing duel you are the target of. */
  async counterJing(duelId, moveId) {
    return this.callReducer('counter_jing', [Number(duelId), jingMoveArg(moveId)])
  }

  /** The bright star-agent roster (live). */
  async starAgents() {
    return this.query('SELECT hip_id, display_name, element, specialty FROM star_agent WHERE active = true')
  }

  /** The comet registry (Chiron + any future comets), with osculating elements. */
  async comets() {
    return this.query('SELECT comet_id, name, designation, element, specialty FROM comet WHERE active = true')
  }

  /** Authoritative minted blocks for a constellation (onchain_block = Deed.mintedAtBlock). */
  async constellationBlocks(constId) {
    const rows = await this.query(
      `SELECT block_id, constellation_id, hip_id, level_after, onchain_block, created_at FROM constellation_block WHERE constellation_id = ${Number(constId)}`,
    ).catch(() => [])
    return rows.sort((a, b) => Number(a.block_id) - Number(b.block_id))
  }

  /** Authoritative resolution row for a constellation (or null). */
  async constellationResolution(constId) {
    const r = await this.query(
      `SELECT constellation_id, baseline_members, added_members, resolution_level FROM constellation_resolution WHERE constellation_id = ${Number(constId)}`,
    ).catch(() => [])
    return r[0] || null
  }

  /** This identity's Jing duels (initiated), newest first. */
  async jingDuelsFor(identity) {
    const id = identity || this.identity
    const rows = await this.query(
      'SELECT duel_id, initiator, target_agent, opening_move, state, winner_is_initiator, created_at FROM jing_duel',
    ).catch(() => [])
    return rows
      .filter((r) => sameIdentity(r.initiator && (r.initiator.__identity__ ?? r.initiator), id))
      .sort((a, b) => Number(b.duel_id) - Number(a.duel_id))
  }

  /** Casts in a Jing duel thread, in cast order. */
  async jingCasts(duelId) {
    const rows = await this.query(
      `SELECT cast_id, duel_id, caster, caster_agent, mv, deflects, voice, created_at FROM jing_cast WHERE duel_id = ${Number(duelId)}`,
    ).catch(() => [])
    return rows.sort((a, b) => Number(a.cast_id) - Number(b.cast_id))
  }

  /**
   * The player's authoritative Jing pools `{ identity, sacred7, esms }`, or null.
   * Read through the caller-scoped my_jing_pool view (jing-pool.js; jing_pool
   * itself is owner-only), so only the caller's own pool is readable.
   */
  async jingPool(identity) {
    return readJingPool(this, { identity })
  }

  /**
   * Call `onPool({ identity, sacred7, esms })` with the player's Jing pools now
   * and whenever they change, until the returned stop function runs. Cheaper
   * than calling jingPool() on every refresh (see jing-pool.js).
   */
  watchJingPool(onPool) {
    return watchJingPool(this, onPool)
  }

  /**
   * Ask an agent a question live: queue it via ask_oracle, then wait for the
   * companion service's answer on the caller-scoped my_oracle_request /
   * my_oracle_reply views (oracle-ask.js; the oracle tables are owner-only).
   * Returns { text }. Throws on timeout, or before asking when the views are
   * unavailable, so the agent page keeps its bundled (offline) voice. `context`
   * is a derived weather summary — never birth data.
   */
  async askAgent(agentKey, text, { context = '', timeoutMs = 30000 } = {}) {
    return askOracle(this, text, { context, timeoutMs })
  }
}

// SATS-JSON arg encoders for the unit enums the reducers take. SpacetimeDB 2.x
// names sum variants in camelCase (lower-first-letter: Mars→mars, TectonicRoot→
// tectonicRoot), so reducer args must use the camelCase variant name — PascalCase
// is rejected ("unknown variant `Vacuum`"). Reads are unaffected (the generated
// bindings decode variants by index back to their PascalCase labels).
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1)
const JING_VARIANT = {
  meltdown: 'Meltdown', freeze: 'Freeze', tectonicRoot: 'TectonicRoot', vacuum: 'Vacuum', erode: 'Erode',
}
function jingMoveArg(id) {
  return { [lowerFirst(JING_VARIANT[id] || 'Meltdown')]: [] }
}
const PLANET_VARIANT = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']
function planetVariant(idx) {
  return { [lowerFirst(PLANET_VARIANT[idx] || 'Sun')]: [] }
}
const sameIdentity = (a, b) =>
  !!a && !!b && String(a).toLowerCase().replace(/^0x/, '') === String(b).toLowerCase().replace(/^0x/, '')

// Parse the offending table name out of a server subscription error, defensively
// across SpacetimeDB versions. Verified live against maincloud (1.12 /sql):
//   "no such table: `service_status`. If the table exists, it may be marked private."
// Returns the table name, or null when the error doesn't name one (in which case
// the caller keeps the fail-hard STATUS.ERROR path).
function unknownTableFromError(err) {
  const msg = String((err && (err.message ?? err)) || '')
  const m =
    msg.match(/no such table:?\s*`?([A-Za-z_][A-Za-z0-9_]*)`?/i) ||
    msg.match(/unknown table:?\s*`?([A-Za-z_][A-Za-z0-9_]*)`?/i) ||
    msg.match(/table\s+`?([A-Za-z_][A-Za-z0-9_]*)`?\s+(?:does not exist|doesn't exist|not found|is not known)/i)
  return m ? m[1] : null
}

// Decode the hex identity from a SpacetimeDB JWT (the `hex_identity` claim),
// so spacetime.identity is available even from a restored token.
function identityFromToken(jwt) {
  try {
    const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const claims = JSON.parse(atob(part))
    return claims.hex_identity || claims.identity || null
  } catch {
    return null
  }
}

export const spacetime = new SpacetimeClient()
export default spacetime
