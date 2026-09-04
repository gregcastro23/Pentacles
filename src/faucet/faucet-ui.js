// ============================================================
// Pentacles — ADR-014 Universal Astrological Faucet Modal UI
// ============================================================

import {
  CANONICAL_TOKENS,
  TOKEN_KEYS,
  DAILY_FAUCET_BUDGET,
  CURRENT_MATTER_DAMPING,
  computeDailySignInYield,
  computeMeleeRoundWinYield,
  computeZoneCaptureYield,
  computeDecanRetentionDividend,
  DECAN_CHAMPION_SOVEREIGN_TREASURY,
} from './discriminant-faucet.js'

let faucetOverlay = null
let activeTab = 'daily'
let cooldownTimer = null

const CLAIM_STORAGE_KEY = 'pentacles_faucet_last_claim'
const COOLDOWN_HOURS = 24

/**
 * Opens the interactive ADR-014 Alchemical Faucet modal.
 */
export function openFaucetModal(playerChart = null, skyWeather = null) {
  if (!faucetOverlay) {
    createFaucetModalDOM()
  }

  renderFaucetContent(playerChart, skyWeather)
  faucetOverlay.classList.add('is-open')
  document.body.classList.add('alchm-open')

  // Close hotkey (Esc)
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      closeFaucetModal()
      document.removeEventListener('keydown', escHandler)
    }
  }
  document.addEventListener('keydown', escHandler)
}

/**
 * Closes the Faucet modal.
 */
export function closeFaucetModal() {
  if (faucetOverlay) {
    faucetOverlay.classList.remove('is-open')
  }
  document.body.classList.remove('alchm-open')
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
    cooldownTimer = null
  }
}

function createFaucetModalDOM() {
  faucetOverlay = document.createElement('div')
  faucetOverlay.id = 'faucet-overlay'
  faucetOverlay.className = 'faucet-overlay'

  faucetOverlay.innerHTML = `
    <div class="faucet-modal" role="dialog" aria-labelledby="faucet-title" aria-modal="true">
      <header class="faucet-header">
        <div class="faucet-title-group">
          <div class="faucet-badge">ADR-014 Standard</div>
          <h2 id="faucet-title" class="faucet-title">✦ Universal Astrological Faucet</h2>
          <p class="faucet-subtitle">Conserved Natal-Ratio Discriminant Allocation · Strictly 24.0000 ESMS Daily</p>
        </div>
        <button class="faucet-close-btn" id="faucet-close-btn" aria-label="Close Faucet">✕</button>
      </header>

      <nav class="faucet-tabs" role="tablist">
        <button class="faucet-tab active" data-tab="daily" role="tab" aria-selected="true">Daily Faucet (24.0000)</button>
        <button class="faucet-tab" data-tab="gameplay" role="tab" aria-selected="false">Melee & Zone Rewards</button>
        <button class="faucet-tab" data-tab="decan" role="tab" aria-selected="false">Decans & Staking</button>
      </nav>

      <main class="faucet-body" id="faucet-body-content">
        <!-- Rendered dynamically -->
      </main>
    </div>
  `

  document.body.appendChild(faucetOverlay)

  // Attach event listeners
  faucetOverlay.querySelector('#faucet-close-btn').onclick = closeFaucetModal
  faucetOverlay.onclick = (e) => {
    if (e.target === faucetOverlay) closeFaucetModal()
  }

  const tabs = faucetOverlay.querySelectorAll('.faucet-tab')
  tabs.forEach((tab) => {
    tab.onclick = () => {
      tabs.forEach((t) => {
        t.classList.remove('active')
        t.setAttribute('aria-selected', 'false')
      })
      tab.classList.add('active')
      tab.setAttribute('aria-selected', 'true')
      activeTab = tab.dataset.tab
      renderFaucetContent()
    }
  })

  injectFaucetStyles()
}

function renderFaucetContent(playerChart = null, skyWeather = null) {
  const container = document.getElementById('faucet-body-content')
  if (!container) return

  // Resolve natal chart and sky weights
  const chart = playerChart || window.__natalChart || null
  const weights = skyWeather || window.__skyWeather || [2.5, 2.5, 2.5, 2.5]

  if (activeTab === 'daily') {
    renderDailyTab(container, chart, weights)
  } else if (activeTab === 'gameplay') {
    renderGameplayTab(container, chart, weights)
  } else if (activeTab === 'decan') {
    renderDecanTab(container, chart, weights)
  }
}

function renderDailyTab(container, chart, weights) {
  const allocation = computeDailySignInYield(chart, weights)
  const lastClaim = getLastClaimTime()
  const now = Date.now()
  const cooldownMs = COOLDOWN_HOURS * 3600 * 1000
  const isCooldown = lastClaim && (now - lastClaim < cooldownMs)

  container.innerHTML = `
    <div class="faucet-daily-view">
      <!-- Status Card -->
      <div class="faucet-matrix-banner">
        <div class="faucet-matrix-col">
          <span class="faucet-lbl">Astrological Transit</span>
          <span class="faucet-val">Equinoctial Equilibrium</span>
        </div>
        <div class="faucet-matrix-col">
          <span class="faucet-lbl">Network Supply Damping</span>
          <span class="faucet-val highlight-amber">Ω_MATTER = 0.750 (Glut -25%)</span>
        </div>
        <div class="faucet-matrix-col">
          <span class="faucet-lbl">Conserved Daily Yield</span>
          <span class="faucet-val highlight-gold">24.0000 ESMS</span>
        </div>
      </div>

      <!-- 4 Token Allocation Cards -->
      <div class="faucet-token-grid">
        ${TOKEN_KEYS.map((key) => {
          const token = CANONICAL_TOKENS[key]
          const amt = allocation[key].toFixed(4)
          const pct = ((allocation[key] / DAILY_FAUCET_BUDGET) * 100).toFixed(1)
          const isDamped = key === 'matter'

          return `
            <div class="faucet-token-card faucet-token-${key}" style="--token-color: ${token.color}">
              <div class="faucet-token-top">
                <span class="faucet-token-glyph" title="${token.symbol}">${token.primaryGlyph}</span>
                <span class="faucet-token-tri" title="Triangular Symbol">${token.triangularGlyph} ${token.geometricSymbol}</span>
              </div>
              <div class="faucet-token-name">${token.name} <span class="faucet-token-ticker">${token.ticker}</span></div>
              <div class="faucet-token-role">${token.role} · ${token.suit}</div>
              <div class="faucet-token-amt">${amt}</div>
              <div class="faucet-token-footer">
                <span class="faucet-token-pct">${pct}% of 24.0000</span>
                ${isDamped ? '<span class="faucet-damped-tag" title="Counter-Cyclical Anti-Glut Damping">Ω 0.750</span>' : ''}
              </div>
            </div>
          `
        }).join('')}
      </div>

      <!-- Claim CTA Section -->
      <div class="faucet-action-area">
        ${isCooldown
          ? `
            <div class="faucet-cooldown-box">
              <span class="faucet-cooldown-icon">⏳</span>
              <span class="faucet-cooldown-text" id="faucet-countdown">Next claim available in calculating...</span>
            </div>
            <button class="faucet-claim-btn is-disabled" disabled>
              ✦ Celestial Allowance Claimed for Today
            </button>
          `
          : `
            <button class="faucet-claim-btn" id="faucet-claim-action-btn">
              ✦ Claim 24.0000 ESMS Daily Celestial Yield
            </button>
          `
        }
        <div class="faucet-footnote">
          Conserved under ADR-014 across all registered players. Zero inflation, micro-quantized to 10⁻⁴.
        </div>
      </div>
    </div>
  `

  if (isCooldown) {
    startCooldownTicker(lastClaim + cooldownMs)
  } else {
    const claimBtn = container.querySelector('#faucet-claim-action-btn')
    if (claimBtn) {
      claimBtn.onclick = () => handleClaim(allocation)
    }
  }
}

function renderGameplayTab(container, chart, weights) {
  const meleeSample = computeMeleeRoundWinYield(85, false, true, true, chart, weights)
  const sweepSample = computeMeleeRoundWinYield(120, true, true, true, chart, weights)
  const houseCapture = computeZoneCaptureYield(2, false, false, 30, chart, weights)
  const crownCapture = computeZoneCaptureYield(10, true, true, 80, chart, weights)

  container.innerHTML = `
    <div class="faucet-info-view">
      <div class="faucet-section-card">
        <h3 class="faucet-sec-title">⚔️ War Table Melee Tricks Payouts (Tier 2)</h3>
        <p class="faucet-p">
          In 12-trick War Table battles (2..6 champions), round winners are rewarded based on counters banked,
          melds, climax tricks, and zone suit weather:
        </p>
        <div class="faucet-mechanic-list">
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Base Winner Bounty:</span>
            <span class="faucet-mech-val">5.0000 ESMS × (1.0 + Score / 100)</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Clean Sweep "Grand Slam" (12/12 tricks):</span>
            <span class="faucet-mech-val highlight-gold">+50% Multiplier (1.50×)</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Zone Favored Suit Match:</span>
            <span class="faucet-mech-val highlight-amber">+35% Weather Alignment (1.35×)</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Oudler Climax Bonus (The Fool / Magician / World):</span>
            <span class="faucet-mech-val highlight-gold">+1.5000 ESMS Flat Climax Bonus</span>
          </div>
        </div>
        <div class="faucet-calc-preview">
          Sample Standard Win (85 pts + Oudler): <b>${meleeSample.total.toFixed(4)} ESMS</b> |
          Grand Slam Sweep (120 pts): <b>${sweepSample.total.toFixed(4)} ESMS</b>
        </div>
      </div>

      <div class="faucet-section-card">
        <h3 class="faucet-sec-title">🏰 Zone Conquest & Tug-of-War Ingress (Tier 2)</h3>
        <p class="faucet-p">
          Flipping the control meter (defender meter driven to ≤ 0) captures the zone for your faction:
        </p>
        <div class="faucet-mechanic-list">
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">The 5 Houses (Root Vaults, Zones 0..4):</span>
            <span class="faucet-mech-val">25.0000 ESMS</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">The 5 Spires (Offensive Conduits, Zones 5..9):</span>
            <span class="faucet-mech-val">35.0000 ESMS</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">The Crown Zenith (Celestial Apex, Zone 10):</span>
            <span class="faucet-mech-val highlight-gold">50.0000 ESMS</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Zone In Dynamic Flux:</span>
            <span class="faucet-mech-val highlight-amber">2.5× Flux Multiplier</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Solar Ingress Alignment:</span>
            <span class="faucet-mech-val highlight-gold">2.0× Ingress Multiplier</span>
          </div>
        </div>
        <div class="faucet-calc-preview">
          House Capture: <b>${houseCapture.total.toFixed(4)} ESMS</b> |
          Apex Ingress Crown Capture: <b>${crownCapture.total.toFixed(4)} ESMS</b>
        </div>
      </div>
    </div>
  `
}

function renderDecanTab(container, chart, weights) {
  const houseDividend = computeDecanRetentionDividend(1, 500, false, false, chart, weights)
  const crownFortified = computeDecanRetentionDividend(10, 1000, true, true, chart, weights)

  container.innerHTML = `
    <div class="faucet-info-view">
      <div class="faucet-section-card">
        <h3 class="faucet-sec-title">👑 10-Day Decan Cycle Territorial Dividends (Tier 3)</h3>
        <p class="faucet-p">
          Every 10° of solar transit (~10 days), the server crowns the champion of that Minor Tarot Card
          and settles territorial dividends for all 11 zones:
        </p>
        <div class="faucet-mechanic-list">
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Decan Sovereign Champion Treasury:</span>
            <span class="faucet-mech-val highlight-gold">${DECAN_CHAMPION_SOVEREIGN_TREASURY.toFixed(4)} ESMS Pool</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">House Retention Dividend:</span>
            <span class="faucet-mech-val">100.0000 ESMS × (Control / 500)</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Spire Retention Dividend:</span>
            <span class="faucet-mech-val">150.0000 ESMS × (Control / 500)</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Crown Zenith Apex Dividend:</span>
            <span class="faucet-mech-val">250.0000 ESMS × (Control / 500)</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Contiguous Zodiac Seal Bonus:</span>
            <span class="faucet-mech-val highlight-amber">+15% Multiplier (1.15×)</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Triplicity Suit Resonance:</span>
            <span class="faucet-mech-val highlight-gold">+25% Resonance Dividend (1.25×)</span>
          </div>
        </div>
        <div class="faucet-calc-preview">
          Base House Dividend (500 ctrl): <b>${houseDividend.total.toFixed(4)} ESMS</b> |
          Fortified Apex Crown (1000 ctrl + Seal + Suit): <b>${crownFortified.total.toFixed(4)} ESMS</b>
        </div>
      </div>

      <div class="faucet-section-card">
        <h3 class="faucet-sec-title">✨ StarVault USDC Staking & Ascendant Burst</h3>
        <p class="faucet-p">
          Staking USDC on fixed stars accrues ESMS continuous elemental yields. Claiming during your star's
          Ascendant pass triggers the "Golden Minute":
        </p>
        <div class="faucet-mechanic-list">
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Horizon Altitude Gate:</span>
            <span class="faucet-mech-val">Accrues strictly while star altitude &gt; 0</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Golden Minute Ascendant Burst:</span>
            <span class="faucet-mech-val highlight-gold">+100% Burst Multiplier (2.0× yield)</span>
          </div>
          <div class="faucet-mech-row">
            <span class="faucet-mech-name">Orb Window:</span>
            <span class="faucet-mech-val">Within ±2 arc-minutes of Ascendant</span>
          </div>
        </div>
      </div>
    </div>
  `
}

function handleClaim(allocation) {
  const claimBtn = document.getElementById('faucet-claim-action-btn')
  if (claimBtn) {
    claimBtn.disabled = true
    claimBtn.textContent = '✦ Invoking Astrological Faucet...'
  }

  // Attempt SpacetimeDB reducer call if connected
  try {
    if (window.__spacetime && window.__spacetime.reducers && window.__spacetime.reducers.claimDailyFaucet) {
      window.__spacetime.reducers.claimDailyFaucet()
    }
  } catch (err) {
    console.warn('[faucet] SpacetimeDB reducer invoke caught:', err)
  }

  // Record client claim timestamp
  localStorage.setItem(CLAIM_STORAGE_KEY, Date.now().toString())

  setTimeout(() => {
    if (window.toast) {
      window.toast(
        `✦ 24.0000 ESMS Claimed! (${allocation.spirit.toFixed(2)} SPRT · ${allocation.essence.toFixed(2)} ESNC · ${allocation.matter.toFixed(2)} MATR · ${allocation.substance.toFixed(2)} SUBS)`,
        { type: 'success' }
      )
    }
    renderFaucetContent()
  }, 600)
}

function getLastClaimTime() {
  const raw = localStorage.getItem(CLAIM_STORAGE_KEY)
  return raw ? parseInt(raw, 10) : null
}

function startCooldownTicker(targetTime) {
  if (cooldownTimer) clearInterval(cooldownTimer)

  const update = () => {
    const el = document.getElementById('faucet-countdown')
    if (!el) return
    const remaining = targetTime - Date.now()
    if (remaining <= 0) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
      renderFaucetContent()
      return
    }

    const hrs = Math.floor(remaining / (3600 * 1000))
    const mins = Math.floor((remaining % (3600 * 1000)) / (60 * 1000))
    const secs = Math.floor((remaining % (60 * 1000)) / 1000)
    el.textContent = `Next daily claim available in ${hrs}h ${mins}m ${secs}s`
  }

  update()
  cooldownTimer = setInterval(update, 1000)
}

function injectFaucetStyles() {
  if (document.getElementById('faucet-styles')) return

  const style = document.createElement('style')
  style.id = 'faucet-styles'
  style.textContent = `
    .faucet-overlay {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(3, 7, 18, 0.82);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.25s ease;
      padding: 1rem;
    }
    .faucet-overlay.is-open {
      opacity: 1;
      pointer-events: auto;
    }
    .faucet-modal {
      width: 100%;
      max-width: 780px;
      max-height: 90vh;
      background: linear-gradient(135deg, rgba(17, 24, 39, 0.95), rgba(9, 14, 28, 0.98));
      border: 1px solid rgba(224, 162, 58, 0.35);
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7), 0 0 35px rgba(224, 162, 58, 0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #f3f4f6;
      font-family: system-ui, -apple-system, sans-serif;
    }
    .faucet-header {
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      background: rgba(255, 255, 255, 0.02);
    }
    .faucet-badge {
      display: inline-block;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #e0a23a;
      background: rgba(224, 162, 58, 0.12);
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid rgba(224, 162, 58, 0.3);
      margin-bottom: 0.35rem;
    }
    .faucet-title {
      font-size: 1.35rem;
      font-weight: 700;
      color: #fff;
      margin: 0;
      letter-spacing: -0.01em;
    }
    .faucet-subtitle {
      font-size: 0.85rem;
      color: #9ca3af;
      margin: 0.25rem 0 0;
    }
    .faucet-close-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #9ca3af;
      border-radius: 8px;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 1rem;
      transition: all 0.15s;
    }
    .faucet-close-btn:hover {
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
    }
    .faucet-tabs {
      display: flex;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(0, 0, 0, 0.2);
    }
    .faucet-tab {
      flex: 1;
      padding: 0.85rem 1rem;
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      color: #9ca3af;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .faucet-tab:hover {
      color: #e5e7eb;
    }
    .faucet-tab.active {
      color: #e0a23a;
      border-bottom-color: #e0a23a;
      background: rgba(224, 162, 58, 0.05);
    }
    .faucet-body {
      padding: 1.5rem;
      overflow-y: auto;
      flex: 1;
    }
    .faucet-matrix-banner {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
      padding: 0.85rem 1rem;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.06);
      border-radius: 10px;
      margin-bottom: 1.25rem;
    }
    .faucet-matrix-col {
      display: flex;
      flex-direction: column;
    }
    .faucet-lbl {
      font-size: 0.72rem;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .faucet-val {
      font-size: 0.88rem;
      font-weight: 600;
      color: #e5e7eb;
      margin-top: 2px;
    }
    .highlight-gold { color: #f59e0b; }
    .highlight-amber { color: #e0a23a; }
    .faucet-token-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    @media (min-width: 640px) {
      .faucet-token-grid {
        grid-template-columns: repeat(4, 1fr);
      }
    }
    .faucet-token-card {
      background: rgba(17, 24, 39, 0.6);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      position: relative;
      overflow: hidden;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    }
    .faucet-token-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0; height: 3px;
      background: var(--token-color, #e0a23a);
    }
    .faucet-token-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .faucet-token-glyph {
      font-size: 1.5rem;
      color: var(--token-color, #e0a23a);
    }
    .faucet-token-tri {
      font-size: 0.85rem;
      color: #9ca3af;
      font-weight: 600;
    }
    .faucet-token-name {
      font-size: 0.95rem;
      font-weight: 700;
      color: #fff;
    }
    .faucet-token-ticker {
      font-size: 0.72rem;
      color: #6b7280;
      font-weight: 500;
    }
    .faucet-token-role {
      font-size: 0.7rem;
      color: #9ca3af;
      margin: 0.15rem 0 0.65rem;
    }
    .faucet-token-amt {
      font-size: 1.4rem;
      font-weight: 800;
      color: #fff;
      font-family: monospace;
      letter-spacing: -0.02em;
    }
    .faucet-token-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    .faucet-token-pct {
      font-size: 0.7rem;
      color: #6b7280;
    }
    .faucet-damped-tag {
      font-size: 0.65rem;
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border: 1px solid rgba(239, 68, 68, 0.3);
      padding: 1px 4px;
      border-radius: 4px;
    }
    .faucet-action-area {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
    }
    .faucet-claim-btn {
      width: 100%;
      max-width: 480px;
      padding: 0.95rem 1.5rem;
      background: linear-gradient(135deg, #d97706, #b45309);
      color: #fff;
      border: 1px solid rgba(245, 158, 11, 0.5);
      border-radius: 12px;
      font-size: 1.05rem;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(217, 119, 6, 0.35);
      transition: all 0.2s ease;
    }
    .faucet-claim-btn:hover:not(:disabled) {
      background: linear-gradient(135deg, #f59e0b, #d97706);
      box-shadow: 0 6px 25px rgba(245, 158, 11, 0.5);
      transform: translateY(-1px);
    }
    .faucet-claim-btn.is-disabled {
      background: rgba(55, 65, 81, 0.5);
      border-color: rgba(75, 85, 99, 0.5);
      color: #9ca3af;
      cursor: not-allowed;
      box-shadow: none;
    }
    .faucet-cooldown-box {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.85rem;
      color: #fbbf24;
      background: rgba(245, 158, 11, 0.1);
      padding: 0.5rem 1rem;
      border-radius: 8px;
      border: 1px solid rgba(245, 158, 11, 0.2);
    }
    .faucet-footnote {
      font-size: 0.75rem;
      color: #6b7280;
      text-align: center;
    }
    .faucet-section-card {
      background: rgba(17, 24, 39, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .faucet-sec-title {
      font-size: 1.1rem;
      color: #fff;
      margin: 0 0 0.5rem;
    }
    .faucet-p {
      font-size: 0.85rem;
      color: #9ca3af;
      line-height: 1.5;
      margin: 0 0 0.85rem;
    }
    .faucet-mechanic-list {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      background: rgba(0, 0, 0, 0.25);
      padding: 0.75rem;
      border-radius: 8px;
    }
    .faucet-mech-row {
      display: flex;
      justify-content: space-between;
      font-size: 0.82rem;
    }
    .faucet-mech-name {
      color: #d1d5db;
    }
    .faucet-mech-val {
      font-weight: 600;
      color: #e5e7eb;
    }
    .faucet-calc-preview {
      margin-top: 0.75rem;
      font-size: 0.82rem;
      color: #9ca3af;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
      padding-top: 0.6rem;
    }
    .faucet-calc-preview b {
      color: #f59e0b;
    }
    .pt-esms__faucet-btn {
      background: linear-gradient(135deg, rgba(224, 162, 58, 0.25), rgba(245, 158, 11, 0.15));
      border: 1px solid rgba(224, 162, 58, 0.45);
      color: #f59e0b;
      border-radius: 6px;
      padding: 3px 8px;
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
      margin-left: 6px;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pt-esms__faucet-btn:hover {
      background: linear-gradient(135deg, rgba(224, 162, 58, 0.45), rgba(245, 158, 11, 0.25));
      box-shadow: 0 0 10px rgba(224, 162, 58, 0.3);
      color: #fff;
    }
  `
  document.head.appendChild(style)
}
