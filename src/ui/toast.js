// ============================================================
// Pentacles — themed, non-blocking, stacking toast system
// ============================================================
// Replaces every alert()/confirm() in the game. The classic global
// scripts (public/app.js, public/client.js) call the bare globals
// `toast(...)` and `await confirmToast(...)`, which are bridged onto
// window from src/main.js. Accessible: live region, role per severity,
// keyboard-dismissable, pause-on-hover, prefers-reduced-motion aware.

const CONTAINER_ID = 'pentacles-toasts'
const ICONS = { info: '✦', success: '✦', warn: '⚠', error: '✗' }

const prefersReducedMotion = () =>
  !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function ensureContainer() {
  let c = document.getElementById(CONTAINER_ID)
  if (!c) {
    c = document.createElement('div')
    c.id = CONTAINER_ID
    c.className = 'pt-toasts'
    // Additions are announced politely; individual error/warn toasts escalate
    // to role="alert" themselves.
    c.setAttribute('aria-live', 'polite')
    c.setAttribute('aria-relevant', 'additions text')
    document.body.appendChild(c)
  }
  return c
}

function buildToast({ type, title, message, sticky, role }) {
  const el = document.createElement('div')
  el.className = `pt-toast pt-toast--${type}` + (prefersReducedMotion() ? ' pt-no-anim' : '')
  el.setAttribute('role', role || (type === 'error' || type === 'warn' ? 'alert' : 'status'))

  const icon = document.createElement('div')
  icon.className = 'pt-toast__icon'
  icon.setAttribute('aria-hidden', 'true')
  icon.textContent = ICONS[type] || ICONS.info

  const body = document.createElement('div')
  body.className = 'pt-toast__body'
  if (title) {
    const t = document.createElement('div')
    t.className = 'pt-toast__title'
    t.textContent = title
    body.appendChild(t)
  }
  const msg = document.createElement('div')
  msg.className = 'pt-toast__msg'
  // Messages may carry light markup (<b>) from the game's status strings.
  msg.innerHTML = sanitize(message)
  body.appendChild(msg)

  const close = document.createElement('button')
  close.className = 'pt-toast__close'
  close.type = 'button'
  close.setAttribute('aria-label', 'Dismiss notification')
  close.textContent = '×'

  el.append(icon, body, close)
  return { el, body, close }
}

// Allow only <b>/<strong>/<em>/<br> from internal status strings; strip the rest.
function sanitize(html) {
  if (html == null) return ''
  const s = String(html)
  if (!/[<&]/.test(s)) return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
  const tmpl = document.createElement('template')
  tmpl.innerHTML = s
  const ALLOWED = new Set(['B', 'STRONG', 'EM', 'I', 'BR'])
  tmpl.content.querySelectorAll('*').forEach((node) => {
    if (!ALLOWED.has(node.tagName)) node.replaceWith(...node.childNodes)
    else [...node.attributes].forEach((a) => node.removeAttribute(a.name))
  })
  return tmpl.innerHTML
}

/**
 * Show a non-blocking toast.
 * @param {string} message  text (light <b>/<em> markup allowed)
 * @param {object} [opts]
 * @param {'info'|'success'|'warn'|'error'} [opts.type='info']
 * @param {string} [opts.title]
 * @param {number} [opts.duration]  ms; 0 = sticky. Defaults by type.
 * @param {Array<{label,onClick,primary,href}>} [opts.actions]
 * @returns {{dismiss: () => void, el: HTMLElement}}
 */
export function toast(message, opts = {}) {
  const type = opts.type || 'info'
  const sticky = opts.duration === 0 || (opts.actions && opts.actions.length > 0 && opts.duration == null)
  const duration = sticky ? 0 : opts.duration ?? (type === 'error' ? 8000 : type === 'warn' ? 6000 : 4500)

  const container = ensureContainer()
  const { el, body, close } = buildToast({ type, title: opts.title, message, sticky, role: opts.role })

  let done = false
  const dismiss = () => {
    if (done) return
    done = true
    if (prefersReducedMotion()) {
      el.remove()
    } else {
      el.classList.add('pt-leaving')
      el.addEventListener('animationend', () => el.remove(), { once: true })
      // Safety net if animationend never fires.
      setTimeout(() => el.remove(), 400)
    }
  }
  close.addEventListener('click', dismiss)
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); dismiss() }
  })

  // Optional action buttons.
  if (opts.actions && opts.actions.length) {
    const row = document.createElement('div')
    row.className = 'pt-toast__actions'
    opts.actions.forEach((a) => {
      const btn = document.createElement(a.href ? 'a' : 'button')
      btn.className = 'pt-toast__action' + (a.primary ? ' pt-toast__action--primary' : '')
      btn.textContent = a.label
      if (a.href) { btn.href = a.href; btn.target = '_blank'; btn.rel = 'noopener noreferrer' }
      else btn.type = 'button'
      btn.addEventListener('click', () => {
        try { a.onClick && a.onClick() } finally { if (a.dismiss !== false) dismiss() }
      })
      row.appendChild(btn)
    })
    el.appendChild(row)
  }

  // Auto-dismiss: the progress bar's animation IS the timer, so hover/focus
  // pause it for free (CSS). Reduced-motion falls back to a plain timeout.
  if (duration > 0) {
    if (prefersReducedMotion()) {
      setTimeout(dismiss, duration)
    } else {
      const bar = document.createElement('div')
      bar.className = 'pt-toast__bar'
      const fill = document.createElement('i')
      fill.style.animation = `pt-bar ${duration}ms linear forwards`
      fill.addEventListener('animationend', dismiss)
      bar.appendChild(fill)
      el.appendChild(bar)
    }
  }

  container.appendChild(el)
  return { dismiss, el }
}

/**
 * Promise-based replacement for window.confirm(). Non-blocking: the caller
 * awaits the user's choice. Esc / Cancel resolve false; restores focus.
 * @returns {Promise<boolean>}
 */
export function confirmToast(message, opts = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement
    const container = ensureContainer()
    const { el, close } = buildToast({
      type: opts.type || 'warn',
      title: opts.title || 'Confirm',
      message,
      sticky: true,
      role: 'alertdialog',
    })
    el.setAttribute('aria-modal', 'false')

    let settled = false
    const settle = (val) => {
      if (settled) return
      settled = true
      el.classList.add('pt-leaving')
      el.addEventListener('animationend', () => el.remove(), { once: true })
      setTimeout(() => el.remove(), 400)
      if (prevFocus && prevFocus.focus) { try { prevFocus.focus() } catch {} }
      resolve(val)
    }

    const row = document.createElement('div')
    row.className = 'pt-toast__actions'
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.className = 'pt-toast__action'
    cancelBtn.textContent = opts.cancelLabel || 'Cancel'
    cancelBtn.addEventListener('click', () => settle(false))
    const okBtn = document.createElement('button')
    okBtn.type = 'button'
    okBtn.className = 'pt-toast__action pt-toast__action--primary' + (opts.danger ? ' pt-toast__action--danger' : '')
    okBtn.textContent = opts.confirmLabel || 'Confirm'
    okBtn.addEventListener('click', () => settle(true))
    row.append(cancelBtn, okBtn)
    el.appendChild(row)

    close.addEventListener('click', () => settle(false))
    // Keyboard: Esc cancels; trap Tab between the two buttons + close.
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); settle(false) }
      else if (e.key === 'Tab') {
        const focusables = [cancelBtn, okBtn, close]
        const i = focusables.indexOf(document.activeElement)
        if (i !== -1) {
          e.preventDefault()
          const next = e.shiftKey ? (i - 1 + focusables.length) % focusables.length : (i + 1) % focusables.length
          focusables[next].focus()
        }
      }
    })

    container.appendChild(el)
    // Safe default: focus Cancel.
    cancelBtn.focus()
  })
}

export const Toast = { toast, confirmToast }
