// ============================================================
// Pentacles — ask the Oracle and wait for its answer
// ============================================================
// `oracle_request` and `oracle_reply` are private: only the module owner (the
// feeder's companion service) can read them. A player's client reads its own
// rows through the public per-sender views `my_oracle_request` and
// `my_oracle_reply`, subscribed over the WebSocket.
//
// `client` is the spacetime client (src/net/spacetime.js) or anything with the
// same `isLive`, `subscribe(table, cb) → unsubscribe`, `callReducer` and
// (optional) `isApplied(table)` shape.

import { appliedRows, waitForRows } from './view-wait.js'

export const ORACLE_VIEWS = Object.freeze({ requests: 'my_oracle_request', replies: 'my_oracle_reply' })

/** How long to wait for the views' first snapshot before giving up. */
const SNAPSHOT_MS = 5000

// The server stores `question.trim()` (Rust: Unicode White_Space, which includes
// U+0085); JS trim() differs on U+0085 and U+FEFF. Compare with both stripped.
const normQuestion = (s) => String(s ?? '').replace(/^[\s\u0085]+|[\s\u0085]+$/g, '')

/**
 * Ask the Oracle `text` and resolve with `{ text }` once the reply arrives.
 *
 * Both views must deliver a snapshot before the question is sent: against a
 * module without them the question would be accepted and answered (which costs
 * a brain or Claude call) with no way for this client to read the answer.
 */
export async function askOracle(client, text, { context = '', timeoutMs = 30000, snapshotMs = SNAPSHOT_MS } = {}) {
  if (!client.isLive) throw new Error('SpacetimeDB offline')
  const q = String(text).trim()
  if (!q) throw new Error('ask the Oracle something')
  const deadline = Date.now() + timeoutMs

  const snapshotBy = Math.min(deadline, Date.now() + snapshotMs)
  const [before, replies] = await Promise.all([
    appliedRows(client, ORACLE_VIEWS.requests, snapshotBy),
    appliedRows(client, ORACLE_VIEWS.replies, snapshotBy),
  ])
  if (!before || !replies) throw new Error('the Oracle is unavailable')

  // An earlier identical question is told apart by its request id.
  const seen = new Set(before.map((r) => String(r.request_id)))
  await client.callReducer('ask_oracle', [q, String(context || ''), false])

  const want = normQuestion(q)
  const req = await waitForRows(
    client, ORACLE_VIEWS.requests,
    (rows) => rows.find((r) => !seen.has(String(r.request_id)) && normQuestion(r.question) === want),
    deadline,
  )
  if (!req) throw new Error('oracle did not accept the question')

  const id = String(req.request_id)
  const reply = await waitForRows(
    client, ORACLE_VIEWS.replies,
    (rows) => rows.find((r) => String(r.request_id) === id && r.text),
    deadline,
  )
  if (!reply) throw new Error('the oracle is still considering')
  return { text: reply.text }
}
