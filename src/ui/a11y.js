// ============================================================
// Pentacles — accessibility layer
// ============================================================
// Non-invasive enhancements layered over the classic markup:
//   • tabs       → role=tablist/tab/tabpanel + roving arrow-key nav, ARIA kept
//                  in sync by wrapping the global switchTab()
//   • dialogs    → focus trap + Esc-to-close + focus restore for the sign-in
//                  modal and onboarding overlay (driven by a visibility observer)
//   • motion     → prefers-reduced-motion disables the sky dome's idle auto-rotate
//                  and (via CSS) toast animations

export function initA11y() {
  setupReducedMotion()
  setupTabs()
  setupDialogs()
}

// ---- prefers-reduced-motion -------------------------------------------------
function setupReducedMotion() {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
  const apply = () => {
    document.documentElement.classList.toggle('pt-reduced-motion', mq.matches)
    // The hologram camera slowly auto-rotates when idle — the one piece of
    // continuous, non-user-initiated motion. Suppress it for reduced motion.
    if (window.HologramCamera) window.HologramCamera.autoRotate = !mq.matches
  }
  apply()
  mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener?.(apply)
}

// ---- Tabs -------------------------------------------------------------------
// There are two independent tablists: the main game tabs and the sign-in modal
// tabs. Enhance each generically; keep aria-selected synced via a class observer
// so it tracks whichever switcher (switchTab / switchModalTab) toggled .active.
function setupTabs() {
  const lists = document.querySelectorAll('.tab-headers')
  lists.forEach((list, idx) => enhanceTablist(list, idx === 0 ? 'Game sections' : 'Sign-in options'))
}

function enhanceTablist(list, label) {
  const tabs = [...list.querySelectorAll('.tab-btn')]
  if (!tabs.length) return
  list.setAttribute('role', 'tablist')
  list.setAttribute('aria-label', label)

  tabs.forEach((tab) => {
    tab.setAttribute('role', 'tab')
    const paneId = tab.dataset.tab
    if (paneId) {
      if (!tab.id) tab.id = 'tabbtn-' + paneId
      tab.setAttribute('aria-controls', paneId)
      const pane = document.getElementById(paneId)
      if (pane) {
        pane.setAttribute('role', 'tabpanel')
        pane.setAttribute('aria-labelledby', tab.id)
        if (!pane.hasAttribute('tabindex')) pane.setAttribute('tabindex', '0')
      }
    }
  })

  const sync = () =>
    tabs.forEach((t) => {
      const active = t.classList.contains('active')
      t.setAttribute('aria-selected', active ? 'true' : 'false')
      t.tabIndex = active ? 0 : -1
    })
  sync()

  // Roving arrow-key navigation per the WAI-ARIA tabs pattern.
  list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement)
    if (i === -1) return
    let j = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') j = (i + 1) % tabs.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') j = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') j = 0
    else if (e.key === 'End') j = tabs.length - 1
    if (j !== null) {
      e.preventDefault()
      tabs[j].focus()
      tabs[j].click() // activates via the inline onclick (switchTab/switchModalTab)
    }
  })

  // Keep aria-selected correct no matter who toggles .active (filtered to class
  // changes only, so our own aria/tabindex writes don't re-trigger it).
  new MutationObserver(sync).observe(list, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class'],
  })
}

// ---- Dialogs (focus trap) ---------------------------------------------------
const DIALOG_IDS = ['signin-modal', 'onboarding-overlay']

function isShown(el) {
  return el.style.display !== 'none' && getComputedStyle(el).display !== 'none'
}

function focusables(container) {
  return [
    ...container.querySelectorAll(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    ),
  ].filter((n) => n.offsetParent !== null || n === document.activeElement)
}

function focusFirst(container) {
  const f = focusables(container)
  ;(f[0] || container).focus?.()
}

function trapTab(container, e) {
  const f = focusables(container)
  if (!f.length) return
  const first = f[0]
  const last = f[f.length - 1]
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first.focus()
  }
}

function setupDialogs() {
  DIALOG_IDS.forEach((id) => {
    const el = document.getElementById(id)
    if (!el) return
    el.setAttribute('role', 'dialog')
    el.setAttribute('aria-modal', 'true')
    let lastFocus = null

    document.addEventListener('keydown', (e) => {
      if (!isShown(el)) return
      if (e.key === 'Escape') {
        // The sign-in modal is dismissable; onboarding is mandatory (no closer).
        if (id === 'signin-modal' && typeof window.closeSignInModal === 'function') {
          e.preventDefault()
          window.closeSignInModal()
        }
        return
      }
      if (e.key === 'Tab') trapTab(el, e)
    })

    const onVisibilityChange = () => {
      const shown = isShown(el)
      if (shown && !el.__ptOpen) {
        el.__ptOpen = true
        lastFocus = document.activeElement
        focusFirst(el)
      } else if (!shown && el.__ptOpen) {
        el.__ptOpen = false
        if (lastFocus && lastFocus.focus) {
          try { lastFocus.focus() } catch {}
        }
      }
    }
    new MutationObserver(onVisibilityChange).observe(el, {
      attributes: true,
      attributeFilter: ['style', 'class'],
    })
    if (isShown(el)) { el.__ptOpen = true; focusFirst(el) }
  })
}
