// ============================================================
// Pentacles — Google sign-in (OIDC) on top of SpacetimeDB identities
// ============================================================
// Auth reuses the shared alchm.kitchen Google login. The flow:
//
//   1. signIn() redirects to the kitchen Google sign-in, callbackUrl → back here.
//   2. On return, the browser holds the `.alchm.kitchen` session cookie. We POST
//      it (credentials:'include') to the Pentacles OIDC issuer
//      (api.agents.alchm.kitchen/oidc/token), which validates the kitchen session
//      and mints an RS256 JWT (iss = the issuer, sub = the user id).
//   3. SpacetimeDB derives Identity::from_claims(iss, sub) from that JWT — a
//      stable, cross-device identity. Before switching to it we run the
//      open_identity_link → claim_profile handshake so the player's existing
//      anonymous profile (chart, cards, pools, stakes, trophies) follows them.
//
// Everything degrades gracefully: with no backend, no cookie, or offline
// SpacetimeDB, the app stays on the anonymous identity exactly as before.

import spacetime from './spacetime.js'

const ISSUER = (import.meta.env.VITE_OIDC_ISSUER || 'https://api.agents.alchm.kitchen').replace(/\/+$/, '')
const KITCHEN = (import.meta.env.VITE_KITCHEN_ORIGIN || 'https://alchm.kitchen').replace(/\/+$/, '')
const USER_KEY = 'pentacles_auth_user'

const listeners = new Set()
let user = loadUser()

function loadUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null }
}
function setUser(u) {
  user = u
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u))
    else localStorage.removeItem(USER_KEY)
  } catch {}
  listeners.forEach((cb) => { try { cb(u) } catch {} })
}

/** Subscribe to auth-user changes; fires immediately with the current user. */
export function onAuth(cb) {
  listeners.add(cb)
  try { cb(user) } catch {}
  return () => listeners.delete(cb)
}
export function currentUser() {
  return user
}
export function isSignedIn() {
  return !!user && spacetime.signedIn
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function randomCode() {
  const a = new Uint8Array(32)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Redirect to the shared Google sign-in, returning here afterward. */
export function signIn(returnTo = window.location.href) {
  const cb = encodeURIComponent(returnTo)
  window.location.href = `${KITCHEN}/login?callbackUrl=${cb}`
}

/** Sign out: forget the Google identity and reconnect anonymously. */
export async function signOut() {
  setUser(null)
  try { await spacetime.signOut() } catch {}
}

/**
 * Exchange the shared kitchen session cookie for a Pentacles OIDC token.
 * Returns { token, user } when signed in on alchm.kitchen, or null otherwise.
 * Never throws — a missing backend/cookie just yields null (stay anonymous).
 */
async function fetchOidcToken() {
  try {
    const res = await fetch(`${ISSUER}/oidc/token`, {
      method: 'POST',
      credentials: 'include',
      headers: { accept: 'application/json' },
    })
    if (res.status === 401) return null // not signed in on the kitchen
    if (!res.ok) return null // 503 kitchen unreachable, etc. — stay anonymous
    const j = await res.json()
    return j && j.token ? j : null
  } catch {
    return null
  }
}

/**
 * Called once on startup (after the first SpacetimeDB connect attempt). If a
 * shared Google session exists, mint the OIDC token, link the current anonymous
 * profile, and reconnect under the Google identity. Idempotent and best-effort.
 */
export async function initAuth() {
  // Already signed in with a valid-looking token: just refresh the user card.
  if (spacetime.signedIn && user) return user

  const got = await fetchOidcToken()
  if (!got) {
    // No shared session. If we were previously "signed in" but the cookie is
    // gone, fall back to anonymous cleanly.
    if (user && !spacetime.signedIn) setUser(null)
    return null
  }

  // If we already hold this exact identity, nothing to migrate.
  const alreadyThis = spacetime.signedIn
  // Try to carry the anonymous profile across, but only if we have a live
  // anonymous session with a registered player to migrate.
  let code = null
  if (!alreadyThis && spacetime.isLive && spacetime.identity) {
    try {
      const rows = await spacetime.query(
        `SELECT identity FROM player WHERE identity = 0x${String(spacetime.identity).replace(/^0x/, '')}`
      )
      if (rows && rows.length) {
        code = randomCode()
        await spacetime.callReducer('open_identity_link', [await sha256Hex(code)])
      }
    } catch {
      code = null // linking is best-effort; sign-in still proceeds
    }
  }

  await spacetime.signInWithToken(got.token)
  setUser(got.user || null)

  // After reconnecting under the Google identity, claim the staged profile.
  if (code) {
    const claimed = await tryClaim(code)
    if (claimed && window.toast) {
      window.toast('Your deck is now saved to your Google account.', { type: 'success', title: 'Signed in' })
    }
  }
  return user
}

/** Poll briefly for the live signed-in connection, then call claim_profile. */
async function tryClaim(code, { attempts = 8, intervalMs = 750 } = {}) {
  for (let i = 0; i < attempts; i++) {
    if (spacetime.isLive) {
      try {
        await spacetime.callReducer('claim_profile', [code])
        return true
      } catch (e) {
        const msg = String(e?.message || e)
        // "already has a profile" / "already linked" are terminal, not retryable.
        if (/already|invalid|expired/i.test(msg)) return false
      }
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return false
}

export default { onAuth, currentUser, isSignedIn, signIn, signOut, initAuth }
