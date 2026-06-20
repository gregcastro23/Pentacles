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
    if (this.token) return this.token
    const res = await fetch(`${this.base}/v1/identity`, { method: 'POST' })
    if (!res.ok) throw new Error(`identity ${res.status}: ${await res.text().catch(() => '')}`)
    const j = await res.json()
    this.token = j.token || j.Token || null
    this.identity = j.identity || j.Identity || null
    if (this.token) localStorage.setItem(TOKEN_KEY, this.token)
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
}

// ---- SQL response normalization --------------------------------------------
// SpacetimeDB's /sql returns an array of statement results. Across versions a
// result is `{ schema, rows }` where rows are positional arrays and column names
// live in schema.elements[].name (sometimes wrapped as {some:"x"}). We map each
// row to a {col: value} object, and pass through already-object rows untouched.
function normalizeSqlResult(json) {
  const stmt = Array.isArray(json) ? json[json.length - 1] : json
  if (!stmt) return []
  const rows = stmt.rows || stmt.Rows || []
  if (!rows.length) return []
  if (!Array.isArray(rows[0])) return rows // already objects

  const cols = extractColumnNames(stmt.schema || stmt.Schema)
  return rows.map((row) => {
    const obj = {}
    row.forEach((val, i) => {
      obj[cols[i] ?? `col${i}`] = unwrapValue(val)
    })
    return obj
  })
}

function extractColumnNames(schema) {
  const els = schema?.elements || schema?.Elements || []
  return els.map((el, i) => {
    const n = el?.name ?? el?.Name
    if (typeof n === 'string') return n
    if (n && typeof n === 'object') return n.some ?? n.Some ?? `col${i}`
    return `col${i}`
  })
}

// SpacetimeDB JSON wraps Option/enum values; unwrap the common shapes.
function unwrapValue(v) {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    if ('some' in v) return unwrapValue(v.some)
    if ('Some' in v) return unwrapValue(v.Some)
    if ('none' in v || 'None' in v) return null
  }
  return v
}

export const spacetime = new SpacetimeClient()
export default spacetime
