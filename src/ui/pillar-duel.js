/**
 * Fourteen Pillars Arena UI Component
 * -----------------------------------
 * Renders the active Fourteen Pillars deck, sky sect indicator,
 * and P = IV alchemical circuit power meter.
 */

import { PILLARS, ELEMENT_THEMES, computePillarCircuitPower, getLegalHand } from '../cards/pillars.js';

export class PillarDuelView {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.sky = options.sky || 'diurnal';
    this.pools = options.pools || [80, 80, 80, 80];
    this.natalEsms = options.natalEsms || [4, 4, 4, 4];
    this.elementCounts = options.elementCounts || { Fire: 3, Water: 3, Air: 2, Earth: 2 };
    this.onCast = options.onCast || (() => {});
    this.selectedPillar = null;
  }

  updateState({ sky, pools, natalEsms, elementCounts }) {
    if (sky) this.sky = sky;
    if (pools) this.pools = pools;
    if (natalEsms) this.natalEsms = natalEsms;
    if (elementCounts) this.elementCounts = elementCounts;
    this.render();
  }

  render() {
    const power = computePillarCircuitPower(this.natalEsms, this.pools);
    const hand = getLegalHand(this.elementCounts, this.sky);

    this.container.innerHTML = `
      <div class="pillar-arena-panel" style="background: rgba(15, 17, 26, 0.95); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 12px; padding: 20px; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <!-- Header & Sky State -->
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 14px; margin-bottom: 16px;">
          <div>
            <h3 style="margin: 0; font-size: 1.25rem; letter-spacing: 0.5px; color: #f0f4f8;">Fourteen Pillars Arena</h3>
            <span style="font-size: 0.8rem; color: #8a99ad;">Alchemical Kinetics & Elemental Transmutation</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; ${this.sky === 'diurnal' ? 'background: rgba(255, 193, 7, 0.15); color: #ffc107; border: 1px solid rgba(255, 193, 7, 0.3);' : 'background: rgba(103, 58, 183, 0.15); color: #b388ff; border: 1px solid rgba(103, 58, 183, 0.3);'}">
              ${this.sky === 'diurnal' ? '☀️ Diurnal Sky' : '🌙 Nocturnal Sky'}
            </span>
          </div>
        </div>

        <!-- Circuit Power Telemetry (P = IV) -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; background: rgba(0, 0, 0, 0.25); border-radius: 8px; padding: 12px;">
          <div>
            <div style="font-size: 0.7rem; color: #8a99ad; text-transform: uppercase;">Current (I)</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #e0e6ed;">${power.current.toFixed(3)} A</div>
          </div>
          <div>
            <div style="font-size: 0.7rem; color: #8a99ad; text-transform: uppercase;">Potential (V)</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #e0e6ed;">${power.voltage.toFixed(3)} V</div>
          </div>
          <div>
            <div style="font-size: 0.7rem; color: #8a99ad; text-transform: uppercase;">Power (P = IV)</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #64ffda;">${power.power.toFixed(4)} W</div>
          </div>
          <div>
            <div style="font-size: 0.7rem; color: #8a99ad; text-transform: uppercase;">Magnitude (m)</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #ffd166;">${power.magnitude.toFixed(2)}x</div>
          </div>
        </div>

        <!-- Available Hand -->
        <div style="margin-bottom: 12px; font-size: 0.85rem; font-weight: 600; color: #b0bec5; text-transform: uppercase; letter-spacing: 0.5px;">
          Playable Hand (${hand.length} available)
        </div>

        <div class="pillar-hand-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 14px;">
          ${hand.map(p => this.renderPillarCard(p, power)).join('')}
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  renderPillarCard(pillar, power) {
    const theme = ELEMENT_THEMES[pillar.primary] || ELEMENT_THEMES.Fire;
    const isSelected = this.selectedPillar === pillar.id;
    const isSelf = pillar.castMode === 'self';

    return `
      <div class="pillar-card" data-id="${pillar.id}" style="
        background: rgba(22, 27, 40, 0.8);
        border: 1px solid ${isSelected ? theme.primary : 'rgba(255, 255, 255, 0.1)'};
        border-radius: 8px;
        padding: 14px;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: ${isSelected ? `0 0 12px ${theme.glow}` : 'none'};
      ">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <div style="font-weight: 700; font-size: 1rem; color: #f0f4f8;">${pillar.name}</div>
          <span style="font-size: 0.65rem; font-weight: 600; padding: 2px 6px; border-radius: 4px; ${isSelf ? 'background: rgba(33, 150, 243, 0.2); color: #90caf9;' : 'background: rgba(244, 67, 54, 0.2); color: #ef9a9a;'}">
            ${pillar.castMode.toUpperCase()}
          </span>
        </div>

        <div style="display: flex; gap: 6px; margin-bottom: 10px;">
          <span style="font-size: 0.7rem; font-weight: 600; padding: 2px 8px; border-radius: 12px; background: ${theme.badge}; color: ${theme.primary}; border: 1px solid ${theme.border};">
            ${pillar.primary}
          </span>
          ${pillar.secondary ? `
            <span style="font-size: 0.7rem; color: #8a99ad; padding: 2px 6px;">
              + ${pillar.secondary}
            </span>
          ` : ''}
        </div>

        <!-- ESMS Delta Vector -->
        <div style="font-size: 0.75rem; color: #8a99ad; margin-bottom: 10px;">
          <div style="display: flex; justify-content: space-between; font-family: monospace;">
            <span style="color: ${pillar.effects[0] >= 0 ? '#4caf50' : '#f44336'};">S: ${pillar.effects[0] > 0 ? '+' : ''}${pillar.effects[0]}</span>
            <span style="color: ${pillar.effects[1] >= 0 ? '#4caf50' : '#f44336'};">E: ${pillar.effects[1] > 0 ? '+' : ''}${pillar.effects[1]}</span>
            <span style="color: ${pillar.effects[2] >= 0 ? '#4caf50' : '#f44336'};">M: ${pillar.effects[2] > 0 ? '+' : ''}${pillar.effects[2]}</span>
            <span style="color: ${pillar.effects[3] >= 0 ? '#4caf50' : '#f44336'};">Sub: ${pillar.effects[3] > 0 ? '+' : ''}${pillar.effects[3]}</span>
          </div>
        </div>

        <button class="cast-btn" data-id="${pillar.id}" style="
          width: 100%;
          background: ${isSelected ? theme.gradient : 'rgba(255, 255, 255, 0.08)'};
          color: #fff;
          border: none;
          padding: 8px 12px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 0.8rem;
          cursor: pointer;
          transition: background 0.2s ease;
        ">
          ${isSelected ? 'Confirm Cast (-10 Q)' : 'Select Pillar'}
        </button>
      </div>
    `;
  }

  attachEventListeners() {
    const cards = this.container.querySelectorAll('.pillar-card');
    cards.forEach(card => {
      card.addEventListener('click', (e) => {
        const id = Number(card.getAttribute('data-id'));
        if (this.selectedPillar === id) {
          // Double click / confirm cast
          this.onCast({ pillarId: id, sky: this.sky });
        } else {
          this.selectedPillar = id;
          this.render();
        }
      });
    });

    const castBtns = this.container.querySelectorAll('.cast-btn');
    castBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = Number(btn.getAttribute('data-id'));
        this.selectedPillar = id;
        this.onCast({ pillarId: id, sky: this.sky });
      });
    });
  }
}
