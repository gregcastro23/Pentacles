// Trace tables are private. Hold the caller-scoped views for the whole wait so
// feeder updates arrive over the WebSocket without repeatedly replacing the
// client's combined subscription. Kept free of browser globals for unit tests.

export const TRACE_VIEWS = Object.freeze({ intents: 'my_trace_intent', attestations: 'my_trace_attestation' })

const identityHex = (v) => String(v?.__identity__ ?? v ?? '').toLowerCase().replace(/^0x/, '')
const sameIdentity = (a, b) => !!a && !!b && identityHex(a) === identityHex(b)
const integer = (v) => BigInt(v ?? 0)

function newestIntent(rows, identity, constId) {
  let newest = null
  for (const row of rows) {
    if (!sameIdentity(row.trader, identity) || Number(row.constellation_id) !== Number(constId)) continue
    // normalizeWsRow supplies epoch micros as a number and u64 IDs as strings.
    // Compare integers directly; converting an intent ID to Number loses bits.
    if (!newest || integer(row.created_at) > integer(newest.created_at) ||
      (integer(row.created_at) === integer(newest.created_at) && integer(row.intent_id) > integer(newest.intent_id))) {
      newest = row
    }
  }
  return newest
}

/** Resolve with the newest trace's signed attestation, preserving the DEX shape. */
export function waitForTraceAttestation(client, constId, trader, { timeoutMs = 30000 } = {}) {
  // intervalMs from the former HTTP polling API remains harmless in options;
  // incoming view snapshots now trigger checks immediately.
  return new Promise((resolve, reject) => {
    let done = false
    const stops = []
    const snapshots = new Map()
    let intentId = null
    const finish = (value, error = null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      for (const stop of stops) stop()
      if (error) reject(error)
      else resolve(value)
    }
    const timer = setTimeout(() => finish(null, new Error('Timed out waiting for the sky-feeder attestation.')), Math.max(0, timeoutMs))
    const check = () => {
      if (done || !snapshots.has(TRACE_VIEWS.intents) || !snapshots.has(TRACE_VIEWS.attestations)) return
      if (intentId == null) {
        const intent = newestIntent(snapshots.get(TRACE_VIEWS.intents), client.identity, constId)
        if (intent) intentId = String(intent.intent_id)
      }
      if (intentId == null) return
      const row = snapshots.get(TRACE_VIEWS.attestations).find((r) =>
        String(r.intent_id) === intentId && sameIdentity(r.trader, client.identity) &&
        Number(r.constellation_id) === Number(constId) && r.signature,
      )
      if (!row) return
      finish({
        trader,
        constellationId: constId,
        regionCommit: row.region_commit,
        visibleStars: Number(row.visible_stars),
        nonce: BigInt(row.nonce),
        deadline: BigInt(row.deadline),
        signature: row.signature,
      })
    }
    try {
      for (const table of Object.values(TRACE_VIEWS)) {
        const stop = client.subscribe(table, (rows) => {
          if (done || (typeof client.isApplied === 'function' && !client.isApplied(table))) return
          try {
            snapshots.set(table, rows || [])
            check()
          } catch (error) { finish(null, error) }
        })
        // A cached view may replay synchronously inside subscribe(). If the
        // second callback finished the wait, its unsubscribe is only available now.
        if (done) stop()
        else stops.push(stop)
      }
    } catch (error) { finish(null, error) }
  })
}
