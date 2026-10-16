/**
 * ============================================================================
 * Pentacles — Vessel Card HUD Component
 * ============================================================================
 *
 * Renders the Vessel Card HUD overlay displaying:
 *   - Bold Vessel OVR Badge with tier styling (Copper -> Celestial)
 *   - Archetype Title & Primary/Secondary signature stats with relativeAdvantage pills
 *   - 7 Sacred Stats raw [25, 99] rating bars
 *   - Earned Alchemical Seals (Copper, Silver, Gold, Aether, Celestial)
 *   - Live Resonance Surge Meter (0-100%) and active Resonance Surge banner (meter >= 70)
 *   - Four ESMS token balances
 */

import type { RatedAgentPayload, SealTier, EsmsBalances } from './rating-contract';
import { SACRED_STAT_KEYS } from './rating-contract';
import { FACTION_HEX_COLORS } from './avatar-foot-ring';

// Safe stylesheet injection for browsers & tests
if (typeof document !== 'undefined') {
  try {
    import('./player-card-hud.css');
  } catch {
    // Ignore in non-bundler test runner environments
  }
}

const PLANET_GLYPHS = ['☉', '☽', '☿', '♀', '♂', '♃', '♄', '♅', '♆', '♇'];

export function getOvrTierClass(ovr: number): string {
  if (ovr >= 96) return 'tier-celestial';
  if (ovr >= 91) return 'tier-aether';
  if (ovr >= 86) return 'tier-gold';
  if (ovr >= 80) return 'tier-silver';
  return 'tier-copper';
}

export function getSealTierClass(tier: SealTier): string {
  switch (tier) {
    case 'Celestial':
      return 'tier-celestial';
    case 'Aether':
      return 'tier-aether';
    case 'Gold':
      return 'tier-gold';
    case 'Silver':
      return 'tier-silver';
    case 'Copper':
    default:
      return 'tier-copper';
  }
}

export class VesselCardHUD {
  private container: HTMLElement;
  private currentPayload: RatedAgentPayload | null = null;
  private roster: RatedAgentPayload[] = [];
  private currentIndex = 0;
  private visible = false;

  constructor(parent: HTMLElement = document.body) {
    this.container = document.createElement('div');
    this.container.className = 'pk-vessel-card-hud-overlay';
    this.container.style.display = 'none';
    parent.appendChild(this.container);

    // Keyboard listener: Escape to close
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.visible) {
          this.hide();
        }
      });
    }
  }

  public setRoster(agents: RatedAgentPayload[]): void {
    this.roster = agents;
  }

  public show(payload: RatedAgentPayload): void {
    this.currentPayload = payload;
    this.currentIndex = this.roster.findIndex((a) => a.key === payload.key);
    if (this.currentIndex === -1 && this.roster.length > 0) {
      this.currentIndex = 0;
    }
    this.visible = true;
    this.container.style.display = 'flex';
    this.render();
  }

  public hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
  }

  public toggle(payload: RatedAgentPayload): void {
    if (this.visible && this.currentPayload?.key === payload.key) {
      this.hide();
    } else {
      this.show(payload);
    }
  }

  public next(): void {
    if (this.roster.length === 0) return;
    this.currentIndex = (this.currentIndex + 1) % this.roster.length;
    this.show(this.roster[this.currentIndex]);
  }

  public prev(): void {
    if (this.roster.length === 0) return;
    this.currentIndex = (this.currentIndex - 1 + this.roster.length) % this.roster.length;
    this.show(this.roster[this.currentIndex]);
  }

  public getCurrentPayload(): RatedAgentPayload | null {
    return this.currentPayload;
  }

  public isVisible(): boolean {
    return this.visible;
  }

  /**
   * Update ESMS balances in-place and re-render if the active card matches
   */
  public updateAgentEsms(agentKey: string, esms: EsmsBalances): void {
    if (this.currentPayload && this.currentPayload.key === agentKey) {
      this.currentPayload.esms = { ...esms };
      this.render();
    }
    for (const a of this.roster) {
      if (a.key === agentKey) {
        a.esms = { ...esms };
      }
    }
  }

  private render(): void {
    if (!this.currentPayload) return;
    const p = this.currentPayload;

    const factionColor = FACTION_HEX_COLORS[p.faction] || '#38bdf8';
    const factionGlyph = PLANET_GLYPHS[p.faction] || '★';
    const ovrTier = getOvrTierClass(p.ovr);

    const isSurgeActive = p.surge.active;
    const surgeTypeStr = p.surge.surgeType;

    // Stat bars HTML
    const statsHtml = SACRED_STAT_KEYS.map((key) => {
      const val = p.ratings[key] ?? 25;
      const relAdv = p.relativeAdvantage[key] ?? 0;
      const isPrimary = p.archetype.primary === key;
      const isSecondary = p.archetype.secondary === key;

      const rowClass = isPrimary ? 'pk-stat-row is-primary' : isSecondary ? 'pk-stat-row is-secondary' : 'pk-stat-row';
      const pct = Math.round(((val - 25) / (99 - 25)) * 100);

      let pillHtml = '';
      if (isPrimary) {
        pillHtml = `<span class="pk-stat-pill" title="Primary Archetype Signature">+${relAdv > 0 ? relAdv.toFixed(1) : 0} RelAdv</span>`;
      } else if (isSecondary) {
        pillHtml = `<span class="pk-stat-pill" style="border-color:#38bdf8; color:#38bdf8;" title="Secondary Signature">+${relAdv > 0 ? relAdv.toFixed(1) : 0} RelAdv</span>`;
      }

      return `
        <div class="${rowClass}">
          <span class="pk-stat-name">${key}</span>
          <div class="pk-stat-track">
            <div class="pk-stat-fill" style="width: ${pct}%;"></div>
          </div>
          <span class="pk-stat-val">${val}</span>
          ${pillHtml}
        </div>
      `;
    }).join('');

    // Surge boost pills HTML
    let boostPillsHtml = '';
    if (isSurgeActive && p.surge.statBoosts) {
      boostPillsHtml = Object.entries(p.surge.statBoosts)
        .map(([k, b]) => `<span class="pk-boost-pill">+${b} ${k}</span>`)
        .join('');
    }

    // Seals HTML
    const sealsHtml = p.seals.map((s) => {
      const tierClass = getSealTierClass(s.tier);
      return `
        <div class="pk-seal-card" title="${s.description}">
          <span class="pk-seal-tier-tag ${tierClass}">${s.tier}</span>
          <span class="pk-seal-name">${s.name}</span>
        </div>
      `;
    }).join('');

    this.container.innerHTML = `
      <div class="pk-vessel-card-hud" style="--faction-color: ${factionColor};">
        <!-- Header -->
        <div class="pk-vessel-header">
          <div class="pk-vessel-ovr-badge ${ovrTier}">
            <span class="pk-vessel-ovr-val">${p.ovr}</span>
            <span class="pk-vessel-ovr-lbl">OVR</span>
          </div>
          <div class="pk-vessel-meta">
            <div class="pk-vessel-handle">
              <span class="pk-vessel-faction-glyph">${factionGlyph}</span>
              <span>${p.handle}</span>
            </div>
            <div class="pk-vessel-archetype">${p.archetype.title}</div>
            <div class="pk-vessel-provenance">${p.factionName} Faction • ${p.provenance || 'vessel'}</div>
          </div>
          <button class="pk-vessel-close-btn" id="pk_hud_close" aria-label="Close Vessel Card">✕</button>
        </div>

        <!-- Body -->
        <div class="pk-vessel-body">
          <!-- Live Resonance Surge Meter -->
          <div class="pk-surge-banner ${isSurgeActive ? 'is-active' : ''}">
            <div class="pk-surge-header">
              <div class="pk-surge-title">
                <span>${isSurgeActive ? '⚡' : '🔥'}</span>
                <span>${isSurgeActive ? 'SURGE IGNITED' : 'Resonance Surge Meter'}</span>
              </div>
              <span class="pk-surge-type">${surgeTypeStr}</span>
            </div>
            <div class="pk-surge-track">
              <div class="pk-surge-fill" style="width: ${p.surge.meter}%;"></div>
            </div>
            ${boostPillsHtml ? `<div class="pk-surge-boosts">${boostPillsHtml}</div>` : ''}
          </div>

          <!-- Sacred 7 Ratings -->
          <div class="pk-stats-section">
            <div class="pk-section-title">Sacred 7 Ratings (25–99)</div>
            ${statsHtml}
          </div>

          <!-- Earned Alchemical Seals -->
          <div class="pk-section-title">Alchemical Seals (${p.seals.length})</div>
          <div class="pk-seals-grid">
            ${sealsHtml || '<div style="font-size:11px;color:#94a3b8;">No seals earned</div>'}
          </div>

          <!-- ESMS Holdings Tray -->
          <div class="pk-esms-tray">
            <div class="pk-esms-item spirit">
              <span class="pk-esms-k">Spirit</span>
              <span class="pk-esms-v">${p.esms.spirit.toFixed(1)}</span>
            </div>
            <div class="pk-esms-item essence">
              <span class="pk-esms-k">Essence</span>
              <span class="pk-esms-v">${p.esms.essence.toFixed(1)}</span>
            </div>
            <div class="pk-esms-item matter">
              <span class="pk-esms-k">Matter</span>
              <span class="pk-esms-v">${p.esms.matter.toFixed(1)}</span>
            </div>
            <div class="pk-esms-item substance">
              <span class="pk-esms-k">Substance</span>
              <span class="pk-esms-v">${p.esms.substance.toFixed(1)}</span>
            </div>
          </div>
        </div>

        <!-- Roster Navigation Footer -->
        ${
          this.roster.length > 1
            ? `
          <div class="pk-vessel-footer">
            <button class="pk-nav-btn" id="pk_prev_agent">‹ Prev Vessel</button>
            <span style="font-size:11px;color:#94a3b8;">${this.currentIndex + 1} of ${this.roster.length}</span>
            <button class="pk-nav-btn" id="pk_next_agent">Next Vessel ›</button>
          </div>
        `
            : ''
        }
      </div>
    `;

    // Bind event handlers
    const closeBtn = this.container.querySelector('#pk_hud_close');
    closeBtn?.addEventListener('click', () => this.hide());

    const prevBtn = this.container.querySelector('#pk_prev_agent');
    prevBtn?.addEventListener('click', () => this.prev());

    const nextBtn = this.container.querySelector('#pk_next_agent');
    nextBtn?.addEventListener('click', () => this.next());
  }

  public destroy(): void {
    if (this.container.parentElement) {
      this.container.parentElement.removeChild(this.container);
    }
  }
}

// Backward-compatible alias
export const PlayerCardHUD = VesselCardHUD;
