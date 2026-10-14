// ============================================================
// Pentacles — wait on a subscribed table or view
// ============================================================
// Private tables are readable only by the module owner, so a player's client
// reads its own rows through public per-sender views (`my_oracle_request`,
// `my_oracle_reply`, `my_jing_pool`) subscribed over the WebSocket. These
// helpers wait on such a subscription.
//
// `client` is the spacetime client (src/net/spacetime.js) or anything with the
// same `subscribe(table, cb) → unsubscribe` and (optional) `isApplied(table)`
// shape. Kept free of Vite/browser globals so it can be unit-tested headlessly.

/**
 * Subscribe to `table` until `pick(rows)` returns something truthy, then resolve
 * with it; resolve null at `deadline`. Always unsubscribes. `subscribe` may call
 * back synchronously (a table that is already live replays its cache at once).
 */
export function waitForRows(client, table, pick, deadline) {
  return new Promise((resolve) => {
    let done = false
    let unsub = null
    const finish = (value) => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (unsub) unsub()
      resolve(value)
    }
    const timer = setTimeout(() => finish(null), Math.max(0, deadline - Date.now()))
    const off = client.subscribe(table, (rows) => {
      let value = null
      try { value = pick(rows || []) } catch {}
      if (value) finish(value)
    })
    if (done) off()
    else unsub = off
  })
}

/**
 * Resolve with `table`'s rows once a subscription covering it has applied, or
 * null at `deadline` (e.g. a module without that view). An earlier handle
 * applying first emits every subscribed table, this one from an empty cache, so
 * a snapshot counts only once the table's own subscription has applied.
 */
export function appliedRows(client, table, deadline) {
  const applied = () => typeof client.isApplied !== 'function' || client.isApplied(table)
  return waitForRows(client, table, (rows) => (applied() ? rows : null), deadline)
}
