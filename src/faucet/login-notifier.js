// ============================================================
// Pentacles — Daily Login ESMS Reward Notification System
// ============================================================
// Authoritative automated daily sign-in reward notifier for ADR-014.
// When a player logs in or boots the game, checks if their 24-hour
// celestial allowance has been granted. If due, credits the account,
// invokes SpacetimeDB (if connected), and triggers a rich toast notification.

import { computeDailySignInYield, DAILY_FAUCET_BUDGET } from './discriminant-faucet.js'

export const DAILY_CLAIM_STORAGE_KEY = 'pentacles_daily_esms_login_claim'
export const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000 // 24 hours

/**
 * Checks if the user is eligible for their daily sign-in ESMS reward.
 * If eligible, computes the ADR-014 conserved 24.0000 yield, executes the
 * SpacetimeDB claim (if online), updates storage, and displays an elegant toast.
 *
 * @param {Object} [playerChart] - Optional player natal chart
 * @param {Array|Object} [skyWeights] - Optional ephemeris transit weights
 * @returns {Promise<Object|null>} The awarded allocation or null if on cooldown
 */
export async function checkAndNotifyDailyLoginReward(playerChart = null, skyWeights = null) {
  const now = Date.now()
  const lastClaimRaw = localStorage.getItem(DAILY_CLAIM_STORAGE_KEY)
  const lastClaim = lastClaimRaw ? parseInt(lastClaimRaw, 10) : 0

  // 24-hour cooldown check
  if (lastClaim > 0 && now - lastClaim < DAILY_COOLDOWN_MS) {
    return null
  }

  // Resolve player natal chart from parameters or global state
  const chart =
    playerChart ||
    window.__natalChart ||
    (window.state && (window.state.chart || window.state.natal_chart)) ||
    null

  // Resolve sky transit weights from parameters or window
  const weights = skyWeights || window.__skyWeather || null

  // Compute conserved 24.0000 ESMS allocation
  const allocation = computeDailySignInYield(chart, weights)

  // Invoke SpacetimeDB claim_daily_faucet reducer if live
  try {
    if (window.__spacetime?.isLive && window.__spacetime?.reducers?.claimDailyFaucet) {
      await window.__spacetime.reducers.claimDailyFaucet()
    }
  } catch (err) {
    console.debug('[faucet-notifier] SpacetimeDB claim reducer call:', err)
  }

  // Save successful claim timestamp
  localStorage.setItem(DAILY_CLAIM_STORAGE_KEY, now.toString())

  // Fire notification toast
  notifyDailySignInReward(allocation)

  // Dispatch custom event for HUD and local state listeners
  try {
    window.dispatchEvent(
      new CustomEvent('pentacles:esms-reward', {
        detail: {
          type: 'daily_sign_in',
          total: DAILY_FAUCET_BUDGET,
          allocation,
          timestamp: now,
        },
      })
    )
  } catch {}

  return allocation
}

/**
 * Triggers a rich, formatted toast notifying the user of their daily ESMS reward.
 *
 * @param {Object} allocation - Result from computeDailySignInYield
 */
export function notifyDailySignInReward(allocation) {
  if (typeof window.toast !== 'function') {
    console.log(
      `[Pentacles] ✦ Daily Sign-In Reward: +24.0000 ESMS (${allocation.spirit} SPRT, ${allocation.essence} ESNC, ${allocation.matter} MATR, ${allocation.substance} SUBS)`
    )
    return
  }

  const s = allocation.spirit.toFixed(2)
  const e = allocation.essence.toFixed(2)
  const m = allocation.matter.toFixed(2)
  const sub = allocation.substance.toFixed(2)

  const message =
    `<b>+24.0000 ESMS</b> earned for logging in today!<br>` +
    `<span style="font-size:0.85em; opacity:0.95; display:inline-block; margin-top:3px;">` +
    `<span style="color:#e0a23a">🝇 ${s} SPRT</span> · ` +
    `<span style="color:#4aa3d8">🝑 ${e} ESNC</span> · ` +
    `<span style="color:#5fb37a">🝙 ${m} MATR</span> · ` +
    `<span style="color:#b98cd6">🝉 ${sub} SUBS</span>` +
    `</span>`

  window.toast(message, {
    type: 'success',
    title: '✦ Daily Celestial Sign-In Reward',
    sticky: false,
  })
}
