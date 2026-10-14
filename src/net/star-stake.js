// The star_stake table is private. Resolve yield claims from the caller's
// per-sender view, on the claim action rather than on each pool UI refresh.
import { appliedRows } from './view-wait.js'

export const STAR_STAKE_VIEW = 'my_star_stake'
const SNAPSHOT_MS = 5000
const hex = (v) => String(v?.__identity__ ?? v ?? '').toLowerCase().replace(/^0x/, '')

/** The caller's first unlocked position with accrued yield, or null. */
export async function readClaimableStarStake(client, { timeoutMs = SNAPSHOT_MS } = {}) {
  if (!client?.isLive || !client.identity || typeof client.subscribe !== 'function') return null
  const who = hex(client.identity)
  const rows = await appliedRows(client, STAR_STAKE_VIEW, Date.now() + timeoutMs)
  return rows?.find((row) => (
    hex(row.staker) === who &&
    BigInt(row.pending_essence ?? 0) === 0n &&
    BigInt(row.accrued_essence ?? 0) > 0n
  )) ?? null
}
