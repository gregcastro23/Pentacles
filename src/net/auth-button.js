// ============================================================
// Pentacles — sign-in pill (Google identity)
// ============================================================
// A small fixed pill (bottom-left, above the connection badge) showing the
// signed-in Google account, or a "Sign in" prompt when anonymous. Uses the same
// visual language as the net badge (pt-net). Clicking signs in (redirect) or
// opens an account menu with sign-out.

import { onAuth, signIn, signOut, currentUser } from './auth.js'
import spacetime from './spacetime.js'

function firstName(u) {
  const n = (u && (u.name || u.email)) || ''
  return String(n).split(/[ @]/)[0] || 'Account'
}

export function initAuthButton() {
  const btn = document.createElement('button')
  btn.id = 'pentacles-auth'
  btn.type = 'button'
  btn.className = 'pt-net pt-auth'
  document.body.appendChild(btn)

  const paint = (u) => {
    if (u && spacetime.signedIn) {
      const label = firstName(u)
      btn.classList.add('pt-auth--in')
      btn.innerHTML = `<span class="pt-net__dot" aria-hidden="true">◈</span><span>${label}</span>`
      btn.title = `Signed in as ${u.email || label} — click to sign out`
      btn.setAttribute('aria-label', btn.title)
    } else {
      btn.classList.remove('pt-auth--in')
      btn.innerHTML = `<span class="pt-net__dot" aria-hidden="true">◇</span><span>Sign in</span>`
      btn.title = 'Sign in with Google to save your deck across devices'
      btn.setAttribute('aria-label', btn.title)
    }
  }
  onAuth(paint)

  btn.addEventListener('click', async () => {
    const u = currentUser()
    if (u && spacetime.signedIn) {
      const ok = window.confirmToast
        ? await window.confirmToast('Sign out of this Google account? Your deck stays saved to it.', { title: 'Sign out', confirmText: 'Sign out' })
        : window.confirm('Sign out?')
      if (ok) {
        await signOut()
        window.toast?.('Signed out — back to a guest identity.', { type: 'info', title: 'Account' })
      }
    } else {
      signIn()
    }
  })
}
