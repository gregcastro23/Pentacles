// ============================================================
// Pentacles — read the player's own Jing pools
// ============================================================
// `jing_pool` is private: only the module owner can read it, so the HTTP /sql
// read the agent page used to make was always refused and the Jing tab kept a
// simulated pool. A player's client reads its own pool through the public
// per-sender view `my_jing_pool`, subscribed over the WebSocket. Before the
// player's first cast the view holds the starter pool the server will create.
//
// `client` is the spacetime client (src/net/spacetime.js) or anything with the
// same `isLive`, `identity`, `subscribe(table, cb) → unsubscribe` and
// (optional) `isApplied(table)` shape.

import { appliedRows } from './view-wait.js'

export const JING_POOL_VIEW = 'my_jing_pool'

/** How long to wait for the view's first snapshot before giving up. */
const SNAPSHOT_MS = 5000

const hex = (v) => String(v ?? '').toLowerCase().replace(/^0x/, '')

/** `who`'s row among the view's rows as `{ identity, sacred7, esms }`, or null. */
function poolFor(rows, who) {
  const row = rows.find((r) => hex(r.identity) === hex(who))
  return row ? { identity: row.identity, sacred7: (row.sacred7 || []).map(Number), esms: (row.esms || []).map(Number) } : null
}

/**
 * The caller's authoritative Jing pools `{ identity, sacred7, esms }`, or null
 * when they cannot be read: offline, another identity's pool (the view only
 * holds the caller's own), or a module without the view.
 */
export async function readJingPool(client, { identity, timeoutMs = SNAPSHOT_MS } = {}) {
  if (!client || !client.isLive) return null
  const who = identity || client.identity
  if (!who || (client.identity && hex(who) !== hex(client.identity))) return null
  const rows = await appliedRows(client, JING_POOL_VIEW, Date.now() + timeoutMs)
  return rows ? poolFor(rows, who) : null
}

/**
 * Keep the caller's pool current while a page shows it: `onPool(pool)` runs on
 * every applied snapshot of the view, so on the first and after each change.
 * Returns the stop function. Prefer this to `readJingPool` per refresh: each
 * read adds the view to the combined subscription and drops it again 5 s later,
 * and every add or drop re-sends every live table. One long-lived listener
 * costs one add, and against a module without the view the client retries it
 * only on reconnect.
 */
export function watchJingPool(client, onPool) {
  return client.subscribe(JING_POOL_VIEW, (rows) => {
    if (typeof client.isApplied === 'function' && !client.isApplied(JING_POOL_VIEW)) return
    const pool = client.identity ? poolFor(rows || [], client.identity) : null
    if (pool) onPool(pool)
  })
}
