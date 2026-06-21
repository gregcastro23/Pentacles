// ============================================================
// Pentacles — dual-mode SpacetimeDB connection (Phase 1)
// ============================================================
// Connects to the deployed module over the STABLE HTTP API rather than the
// WebSocket SDK + generated bindings, because the local CLI (2.4.x) emits
// 2.x-style bindings that the installed SDK (1.3.3, matching the server's 1.x
// crate) does not export, and SDK 2.0.0 fails to install. The HTTP API
// (/v1/database/<db>/sql, /call/<reducer>, /v1/identity) is version-tolerant and
// verifiable the moment a host is configured. @clockworklabs/spacetimedb-sdk
// stays a dependency for a later WebSocket-subscription upgrade.
//
// DUAL-MODE: live only when VITE_SPACETIMEDB_URI is set AND reachable; otherwise
// the game runs exactly as before on local simulation. Never hard-fails.
//
// NOTE: reducer-call argument serialization for sum/product types (the Planet
// enum, NatalChart) is SpacetimeDB-version-specific and must be validated
// against a live host before the write paths (trace/cast_word) are trusted —
// the read path (SQL) and status/dual-mode plumbing are what Phase 1 verifies.

const RAW_URI = (import.meta.env.VITE_SPACETIMEDB_URI || '').trim()
const DB_NAME = (import.meta.env.VITE_SPACETIMEDB_DB || 'cookingwithcastrollc').trim()
const POLL_MS = Number(import.meta.env.VITE_SPACETIMEDB_POLL_MS || 6000)
const TOKEN_KEY = 'pentacles_stdb_token'

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

class SpacetimeClient {
  constructor() {
    this.base = normalizeBase(RAW_URI)
    this.db = DB_NAME
    this.status = STATUS.OFFLINE
    this.lastError = null
    this.token = localStorage.getItem(TOKEN_KEY) || null
    this.identity = null
    this._statusListeners = new Set()
    this._tableListeners = new Map() // table -> Set<cb>
    this._pollTimer = null
    this._subscribed = new Set()
  }

  /** Is a host even configured? */
  get configured() {
    return !!this.base
  }
  get isLive() {
    return this.status === STATUS.LIVE
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

  /** Attempt to go live. Resolves to true if connected, false if offline/failed. */
  async connect() {
    if (!this.configured) {
      this._setStatus(STATUS.OFFLINE)
      return false
    }
    this._setStatus(STATUS.CONNECTING)
    try {
      await this.ensureIdentity()
      // Health probe: a cheap read against a public table.
      await this.query('SELECT zone_id FROM zone LIMIT 1')
      this._setStatus(STATUS.LIVE)
      this._startPolling()
      return true
    } catch (e) {
      this._setStatus(STATUS.ERROR, e)
      return false
    }
  }

  /** Create (once) an anonymous SpacetimeDB identity + token for a stable sender. */
  async ensureIdentity() {
    if (!this.token) {
      const res = await fetch(`${this.base}/v1/identity`, { method: 'POST' })
      if (!res.ok) throw new Error(`identity ${res.status}: ${await res.text().catch(() => '')}`)
      const j = await res.json()
      this.token = j.token || j.Token || null
      if (j.identity || j.Identity) this.identity = j.identity || j.Identity
      if (this.token) localStorage.setItem(TOKEN_KEY, this.token)
    }
    // Always derive the identity from the JWT (hex_identity claim) so it's set
    // even when a token was restored from localStorage.
    if (this.token && !this.identity) this.identity = identityFromToken(this.token)
    return this.token
  }

  _authHeaders(extra = {}) {
    return this.token ? { Authorization: `Bearer ${this.token}`, ...extra } : { ...extra }
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

  // ---- lightweight polled "subscriptions" -----------------------------------
  // HTTP has no push; we poll the registered tables on an interval and fan rows
  // out to listeners. Good enough for this game's cadence (it already ticked at
  // 15s); a WebSocket upgrade can replace this behind the same interface.
  subscribe(table, cb) {
    if (!this._tableListeners.has(table)) this._tableListeners.set(table, new Set())
    this._tableListeners.get(table).add(cb)
    this._subscribed.add(table)
    if (this.isLive) this._pollTable(table).catch(() => {})
    return () => {
      this._tableListeners.get(table)?.delete(cb)
    }
  }

  async _pollTable(table) {
    try {
      const rows = await this.query(`SELECT * FROM ${table}`)
      this._tableListeners.get(table)?.forEach((cb) => {
        try { cb(rows) } catch {}
      })
    } catch (e) {
      // a single failed poll shouldn't tear down the connection
      if (this.status === STATUS.LIVE) this._setStatus(STATUS.ERROR, e)
    }
  }

  _startPolling() {
    this._stopPolling()
    if (!this._subscribed.size) return
    const tick = () => {
      if (!this.isLive && this.status !== STATUS.ERROR) return
      this._subscribed.forEach((t) => this._pollTable(t))
    }
    tick()
    this._pollTimer = setInterval(tick, POLL_MS)
  }
  _stopPolling() {
    if (this._pollTimer) clearInterval(this._pollTimer)
    this._pollTimer = null
  }

  /** One-shot poll helper used by phases that need fresh rows on demand. */
  async fetchTable(table, whereSql = '') {
    return this.query(`SELECT * FROM ${table}${whereSql ? ' WHERE ' + whereSql : ''}`)
  }

  // ---- live reducer helpers (Phases 5–6) ------------------------------------
  // Arg encoding mirrors duels.js: a unit enum is { Variant: [] }; an Option is
  // { some: <value> } / { none: [] }. UNVALIDATED-live until a host + feeder run;
  // the agent/constellation pages gate every call behind `isLive` and fall back
  // to the bundled simulation when offline.

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

// SATS-JSON arg encoders for the unit enums the reducers take.
const JING_VARIANT = {
  meltdown: 'Meltdown', freeze: 'Freeze', tectonicRoot: 'TectonicRoot', vacuum: 'Vacuum', erode: 'Erode',
}
function jingMoveArg(id) {
  return { [JING_VARIANT[id] || 'Meltdown']: [] }
}
const PLANET_VARIANT = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto']
function planetVariant(idx) {
  return { [PLANET_VARIANT[idx] || 'Sun']: [] }
}
const sameIdentity = (a, b) =>
  !!a && !!b && String(a).toLowerCase().replace(/^0x/, '') === String(b).toLowerCase().replace(/^0x/, '')

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
