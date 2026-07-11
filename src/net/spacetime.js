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

const RAW_URI = (import.meta.env.VITE_SPACETIMEDB_URI || '').trim()
const DB_NAME = (import.meta.env.VITE_SPACETIMEDB_DB || 'cookingwithcastrollc').trim()
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
    this._subHandle = null // active SubscriptionHandle (covers all subscribed tables)
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
      if (isNewTable) this._resubscribe() // server replication set changed
      else this._emitTable(table, cb) // catch this listener up immediately
    }
    return () => {
      this._tableListeners.get(table)?.delete(cb)
    }
  }

  /**
   * (Re)issue a single subscription covering every registered table, and wire the
   * per-table delta handlers once. Called on connect and whenever a new table is
   * subscribed. Idempotent on the handler binding.
   */
  _resubscribe() {
    if (!this.conn || !this._subscribed.size) return
    // Bind delta handlers once per table; each delta re-emits the snapshot.
    for (const table of this._subscribed) {
      if (this._boundTables.has(table)) continue
      const handle = this.conn.db?.[table]
      if (!handle) continue
      const onChange = () => this._emitTable(table)
      try { handle.onInsert?.(onChange) } catch {}
      try { handle.onDelete?.(onChange) } catch {}
      try { handle.onUpdate?.(onChange) } catch {}
      this._boundTables.add(table)
    }
    // Replace the active subscription with one covering all registered tables.
    // An errored handle has already ended server-side — unsubscribing it again
    // throws / sends a bogus Unsubscribe — so only tear down a still-live one.
    const queries = [...this._subscribed].map((t) => `SELECT * FROM ${t}`)
    const prev = this._subHandle
    this._subHandle = null
    try { if (prev && !prev.isEnded?.()) prev.unsubscribe?.() } catch {}
    try {
      let handle = null
      handle = this.conn
        .subscriptionBuilder()
        .onApplied(() => {
          this._subRetries = 0 // clean apply → reset the recovery budget
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
    for (const t of this._droppedTables) this._subscribed.add(t)
    this._droppedTables.clear()
  }

  /** Read the current cache for a table, normalize, and fan out to listeners. */
  _emitTable(table, onlyCb = null) {
    if (!this.conn) return
    let rows
    try {
      rows = [...this.conn.db[table].iter()].map(normalizeWsRow)
    } catch {
      return
    }
    const targets = onlyCb ? [onlyCb] : this._tableListeners.get(table)
    targets?.forEach((cb) => {
      try { cb(rows) } catch {}
    })
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

  /** The player's authoritative Jing pools (sacred7 + esms), or null. Needs jing_pool public. */
  async jingPool(identity) {
    const id = identity || this.identity
    const rows = await this.query('SELECT identity, sacred7, esms FROM jing_pool').catch(() => [])
    return rows.find((r) => sameIdentity(r.identity && (r.identity.__identity__ ?? r.identity), id)) || null
  }

  /**
   * Ask an agent a question live: queue it via ask_oracle, then poll oracle_reply
   * for the companion service's answer. Returns { text }. Throws on timeout so the
   * agent page falls back to its bundled (offline) voice. Mirrors duels.js: note
   * existing rows, fire, detect the fresh one. `context` is a derived weather
   * summary — never birth data.
   */
  async askAgent(agentKey, text, { context = '', timeoutMs = 30000, intervalMs = 2000 } = {}) {
    if (!this.isLive) throw new Error('SpacetimeDB offline')
    const q = String(text).trim()
    const esc = (s) => String(s).replace(/'/g, "''")
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const seen = new Set(
      (await this.query(`SELECT request_id FROM oracle_request WHERE question = '${esc(q)}'`).catch(() => []))
        .map((r) => String(r.request_id)),
    )
    await this.callReducer('ask_oracle', [q, String(context || ''), false])
    const deadline = Date.now() + timeoutMs
    let reqId = null
    while (Date.now() < deadline && reqId == null) {
      await sleep(900)
      const rows = await this.query(`SELECT request_id FROM oracle_request WHERE question = '${esc(q)}'`).catch(() => [])
      const fresh = rows.find((r) => !seen.has(String(r.request_id)))
      if (fresh) reqId = fresh.request_id
    }
    if (reqId == null) throw new Error('oracle did not accept the question')
    while (Date.now() < deadline) {
      await sleep(intervalMs)
      const rep = await this.query(`SELECT text FROM oracle_reply WHERE request_id = ${Number(reqId)}`).catch(() => [])
      if (rep.length && rep[0].text) return { text: rep[0].text }
    }
    throw new Error('the oracle is still considering')
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

// ---- SQL response normalization --------------------------------------------
// SpacetimeDB's /sql returns an array of statement results. Across versions a
// result is `{ schema, rows }` where rows are positional arrays and column names
// live in schema.elements[].name (sometimes wrapped as {some:"x"}). We map each
// row to a {col: value} object, and pass through already-object rows untouched.
// SpacetimeDB /sql returns [{ schema, rows }]. Rows are positional arrays in SATS
// JSON: enums/Options encode as [tagIndex, payload] (e.g. owner [0,[1,[]]] =
// some(Moon); none = [1,[]]). We use the schema's AlgebraicType to decode each
// value: plain enums → variant name ("Mars"), Option → inner value or null,
// primitives → through (u64/u128 may be strings; callers coerce).
function normalizeSqlResult(json) {
  const stmt = Array.isArray(json) ? json[json.length - 1] : json
  if (!stmt) return []
  const schema = stmt.schema || stmt.Schema
  const rows = stmt.rows || stmt.Rows || []
  if (!rows.length) return []
  const elements = schema?.elements || schema?.Elements || []
  const cols = elements.map((el, i) => elName(el, i))
  const types = elements.map((el) => el?.algebraic_type ?? el?.algebraicType)
  if (!Array.isArray(rows[0])) return rows // already objects (defensive)
  return rows.map((row) => {
    const obj = {}
    row.forEach((val, i) => {
      obj[cols[i] ?? `col${i}`] = decodeSats(types[i], val)
    })
    return obj
  })
}

function elName(el, i) {
  const n = el?.name ?? el?.Name
  if (typeof n === 'string') return n
  if (n && typeof n === 'object') return n.some ?? n.Some ?? `col${i}`
  return `col${i}`
}

function decodeSats(type, val) {
  if (!type) return val
  if (type.Sum) {
    const variants = type.Sum.variants || []
    if (!Array.isArray(val)) return val
    const [tag, payload] = val
    const variant = variants[tag]
    const vname = (variant && (variant.name?.some ?? variant.name)) ?? String(tag)
    const isOption = variants.length === 2 && variants.some((v) => (v?.name?.some ?? v?.name) === 'none')
    if (isOption) {
      if (vname === 'none') return null
      return decodeSats(variant?.algebraic_type ?? variant?.algebraicType, payload) // unwrap some
    }
    return vname // plain enum → variant name (e.g. "Mars", "House")
  }
  if (type.Product) {
    const els = type.Product.elements || []
    if (Array.isArray(val)) {
      const o = {}
      els.forEach((e, i) => {
        o[elName(e, i)] = decodeSats(e?.algebraic_type ?? e?.algebraicType, val[i])
      })
      return o
    }
    return val
  }
  return val // primitives
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
