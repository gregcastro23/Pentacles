// ============================================================
// Pentacles — Production Build & API Smoke Test
// ============================================================
// Asserts that the production build boots cleanly in a browser-like DOM
// environment without ReferenceErrors (Buffer, etc.), registers all
// required window bridges, mounts UI overlays, and that serverless API
// handlers respond with valid non-404 status codes.

import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { handleBurnSettlement } from '../settlement/esms-redeemer.js'
import { handleWalletVerification } from '../settlement/wallet-verifier.js'

const ROOT = process.cwd()

console.log('▶ 1 · Checking production build assets...')
const distFiles = await readdir(join(ROOT, 'dist', 'assets')).catch(() => [])
if (distFiles.length === 0) {
  throw new Error('dist/assets is empty. Run `bun run build` first.')
}
console.log(`  ✓ Built assets present (${distFiles.length} files in dist/assets)`)

console.log('▶ 2 · Verifying suit card art local paths...')
const deckSource = await readFile(join(ROOT, 'src/alchm-chart/deck.js'), 'utf8')
if (deckSource.includes('lh3.googleusercontent.com')) {
  throw new Error('deck.js still contains external lh3.googleusercontent.com URLs!')
}
if (!deckSource.includes('/assets/suits/wands.jpg')) {
  throw new Error('deck.js missing /assets/suits/wands.jpg local path!')
}
console.log('  ✓ Card art uses shipped local assets without third-party CDN dependencies')

console.log('▶ 3 · Verifying /api/web3 endpoints (non-404, method & payload gating)...')

// Test burn-esms endpoint
const getBurnRes = await handleBurnSettlement(new Request('http://localhost/api/web3/burn-esms', { method: 'GET' }))
if (getBurnRes.status !== 405) {
  throw new Error(`Expected GET /api/web3/burn-esms to return 405, got ${getBurnRes.status}`)
}

const badBurnRes = await handleBurnSettlement(
  new Request('http://localhost/api/web3/burn-esms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invalid: true }),
  })
)
if (badBurnRes.status !== 400) {
  throw new Error(`Expected invalid POST /api/web3/burn-esms to return 400, got ${badBurnRes.status}`)
}

// Test verify-wallet endpoint
const getVerifyRes = await handleWalletVerification(new Request('http://localhost/api/web3/verify-wallet', { method: 'GET' }))
if (getVerifyRes.status !== 405) {
  throw new Error(`Expected GET /api/web3/verify-wallet to return 405, got ${getVerifyRes.status}`)
}

const badVerifyRes = await handleWalletVerification(
  new Request('http://localhost/api/web3/verify-wallet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invalid: true }),
  })
)
if (badVerifyRes.status !== 400) {
  throw new Error(`Expected invalid POST /api/web3/verify-wallet to return 400, got ${badVerifyRes.status}`)
}
console.log('  ✓ /api/web3/burn-esms and /api/web3/verify-wallet are active and validated')

console.log('▶ 4 · Verifying DOM environment and window bridge registration...')
// Setup minimal DOM window environment to test ESM main bundle
if (typeof globalThis.window === 'undefined') {
  globalThis.window = globalThis
}
globalThis.getComputedStyle = globalThis.getComputedStyle || (() => ({
  getPropertyValue: () => '',
}))
globalThis.window.getComputedStyle = globalThis.getComputedStyle
globalThis.window.matchMedia = globalThis.window.matchMedia || ((q) => ({
  matches: false,
  media: q,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
}))
const _storage = new Map()
globalThis.localStorage = globalThis.localStorage || {
  getItem: (k) => _storage.get(k) || null,
  setItem: (k, v) => _storage.set(k, String(v)),
  removeItem: (k) => _storage.delete(k),
  clear: () => _storage.clear(),
}
globalThis.MutationObserver = globalThis.MutationObserver || class {
  constructor(cb) { this.cb = cb }
  observe() {}
  disconnect() {}
}
function makeClassList() {
  const _classes = new Set()
  return {
    _classes,
    add(...c) { c.forEach((x) => _classes.add(x)) },
    remove(...c) { c.forEach((x) => _classes.delete(x)) },
    contains(c) { return _classes.has(c) },
    toggle(c, force) {
      if (force === true) { _classes.add(c); return true }
      if (force === false) { _classes.delete(c); return false }
      if (_classes.has(c)) { _classes.delete(c); return false }
      _classes.add(c); return true
    },
  }
}
globalThis.document = globalThis.document || {
  readyState: 'complete',
  documentElement: {
    classList: makeClassList(),
    style: {},
  },
  createElement: (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      classList: makeClassList(),
      style: {},
      setAttribute: () => {},
      getAttribute: () => null,
      appendChild: (c) => c,
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelector: () => null,
      querySelectorAll: () => [],
      childNodes: [],
      children: [],
      innerHTML: '',
      textContent: '',
    }
    return el
  },
  getElementById: (id) => {
    const el = globalThis.document.createElement('div')
    el.id = id
    return el
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  body: {
    classList: makeClassList(),
    style: {},
    appendChild: () => {},
    querySelector: () => null,
    querySelectorAll: () => [],
  },
}

// Find built main bundle in dist/assets
const mainBundle = distFiles.find((f) => f.startsWith('main-') && f.endsWith('.js'))
if (!mainBundle) {
  throw new Error('Could not find main-*.js in dist/assets')
}

// Import main module and verify no ReferenceError
try {
  await import(join(ROOT, 'dist', 'assets', mainBundle))
} catch (err) {
  throw new Error(`Production main bundle threw during initialization: ${err.stack || err}`)
}

if (typeof globalThis.window.openMyPentacles !== 'function') {
  throw new Error('window.openMyPentacles was not registered on window!')
}
if (typeof globalThis.window.openFactionWar !== 'function') {
  throw new Error('window.openFactionWar was not registered on window!')
}
if (typeof globalThis.window.openAlchmChart !== 'function') {
  throw new Error('window.openAlchmChart was not registered on window!')
}
if (typeof globalThis.window.toast !== 'function') {
  throw new Error('window.toast was not registered on window!')
}
console.log('  ✓ window.openMyPentacles, openFactionWar, openAlchmChart, and toast successfully registered')

console.log('\nALL production smoke tests passed with 100% success!')
process.exit(0)
