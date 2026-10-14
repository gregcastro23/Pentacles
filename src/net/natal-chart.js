// The natal_chart table is private. Read the caller's chart from its public
// per-sender view over the WebSocket, once the view's snapshot has applied.
import { appliedRows } from './view-wait.js'

export const NATAL_CHART_VIEW = 'my_natal_chart'
const SNAPSHOT_MS = 5000
const hex = (v) => String(v?.__identity__ ?? v ?? '').toLowerCase().replace(/^0x/, '')

/** The caller's natal chart row, or null while offline or without the view. */
export async function readNatalChart(client, { timeoutMs = SNAPSHOT_MS } = {}) {
  if (!client?.isLive || !client.identity || typeof client.subscribe !== 'function') return null
  const who = hex(client.identity)
  const rows = await appliedRows(client, NATAL_CHART_VIEW, Date.now() + timeoutMs)
  return rows?.find((row) => hex(row.identity) === who) ?? null
}
