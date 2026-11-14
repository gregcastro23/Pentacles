/**
 * ============================================================================
 * Pentacles — Seeker Vessel & Natal Astrolabe Stage (Zone 2)
 * ============================================================================
 * Coaxial 3D Seeker Vessel + Interactive 12-Sign Natal Astrolabe Ring.
 *
 * Hermetic Design Principles:
 *   1. Sacred Aspect Chords (120° Trine △, 60° Sextile ⚹, 0° Conjunction ☌)
 *      are inscribed directly inside the 12-sign Natal Astrolabe behind the
 *      Seeker — never as sci-fi HUD wires crossing over the character.
 *   2. Weighted Armillary Camera Choreography (480ms cubic-bezier(0.22, 1, 0.36, 1))
 *      between two clean astronomical framings:
 *        - 'observatory' (full Vessel + Foot Ring + Natal Astrolabe)
 *        - 'crucible'    (centered closer framing for Duplicate Card Fusion)
 *      plus smooth ±6° yaw / ±3° pitch orbital parallax.
 *   3. Zero per-frame heap allocations: pre-allocated Float32Array(72 * 3)
 *      ESMS elemental motes and in-place Fresnel shader uniform updates.
 *   4. Graceful headless fallback when WebGL or ResizeObserver is unavailable.
 */

import * as THREE from 'three';
import {
  createVesselAvatarMesh,
  updateVesselAvatarAnimation,
  refreshVesselFromPayload,
  disposeVesselAvatar,
  setVesselRimUniforms,
  pulseVesselRelics,
} from '../../lib/agents/vessel-avatar-3d';
import { SIGN_GLYPHS, SIGN_NAMES, PLANET_COLORS } from '../card-model.js';
import { buildNatalAstrolabeData } from './seeker-rating-telemetry.js';
import { prefersReducedMotion } from './spring-animator.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PARTICLE_COUNT = 72;

export const ARMILLARY_FRAMINGS = Object.freeze({
  observatory: {
    // Coaxial optical axis (pos.y === lookAt.y === 1.38 = TorsoCore/CoreGem center)
    // guarantees zero vertical drift against the 1:1 SVG Astrolabe across resizes & zoom.
    pos: [0, 1.38, 4.55],
    lookAt: [0, 1.38, 0],
    fov: 35,
    label: 'Observatory Stance',
  },
  crucible: {
    pos: [0, 1.38, 3.25],
    lookAt: [0, 1.38, 0],
    fov: 32,
    label: 'Crucible Alignment',
  },
});

const ESMS_STAGE_PROFILES = Object.freeze({
  spirit: {
    rimHex: '#f59e0b',
    moteHex: 0xfbbf24,
    rimPower: 2.35,
    rimIntensity: 0.82,
    idleCadence: 1.14,
  },
  essence: {
    rimHex: '#22d3ee',
    moteHex: 0x38bdf8,
    rimPower: 2.75,
    rimIntensity: 0.76,
    idleCadence: 0.88,
  },
  substance: {
    rimHex: '#e2e8f0',
    moteHex: 0xf1f5f9,
    rimPower: 3.25,
    rimIntensity: 0.88,
    idleCadence: 1.06,
  },
  matter: {
    rimHex: '#eab308',
    moteHex: 0xfacc15,
    rimPower: 2.6,
    rimIntensity: 0.72,
    idleCadence: 0.84,
  },
});

function createSvgNode(tag, attrs = {}, children = []) {
  const node =
    typeof document !== 'undefined' && typeof document.createElementNS === 'function'
      ? document.createElementNS(SVG_NS, tag)
      : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    node.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function createHtmlNode(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'class') node.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/**
 * Converts ecliptic longitude (0° Aries at 9 o'clock / astrological convention,
 * counter-clockwise or top-anchored 12 o'clock) into SVG coordinates on viewBox 440x440.
 * Uses 0° Aries at top-left ascendant90 (-180° offset) so the wheel matches Hermetic charts.
 */
function polarPoint(cx, cy, radius, eclipticDeg) {
  const rad = ((eclipticDeg - 90) * Math.PI) / 180;
  return {
    x: Number((cx + Math.cos(rad) * radius).toFixed(2)),
    y: Number((cy + Math.sin(rad) * radius).toFixed(2)),
  };
}

/**
 * Cubic-bezier(0.22, 1, 0.36, 1) quintic-like armillary ease-out approximation
 */
function armillaryEaseOut(t) {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - clamped, 3.4);
}

export class SeekerVesselStage {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container
   * @param {object} opts.telemetry - Initial output of computeSeekerTelemetry()
   * @param {object} [opts.chart] - Seeker natal chart
   * @param {import('../../lib/agents/court-audio-synth').CourtAudioSynth} [opts.audioSynth]
   * @param {(planetNode: object | null) => void} [opts.onPlanetSelect]
   */
  constructor(opts) {
    this.container = opts.container;
    this.telemetry = opts.telemetry;
    this.chart = opts.chart || { placements: [] };
    this.audioSynth = opts.audioSynth || null;
    this.onPlanetSelect = opts.onPlanetSelect || null;

    this.framing = 'observatory';
    this.armillaryPaused = prefersReducedMotion();
    this.focusedPlanet = null;
    this.webglActive = false;
    this._disposed = false;

    // Camera interpolation state (zero per-frame allocations)
    const initialFrame = ARMILLARY_FRAMINGS.observatory;
    this._camFromPos = new THREE.Vector3(...initialFrame.pos);
    this._camToPos = new THREE.Vector3(...initialFrame.pos);
    this._camCurrPos = new THREE.Vector3(...initialFrame.pos);
    this._camFromLook = new THREE.Vector3(...initialFrame.lookAt);
    this._camToLook = new THREE.Vector3(...initialFrame.lookAt);
    this._camCurrLook = new THREE.Vector3(...initialFrame.lookAt);
    this._camFromFov = initialFrame.fov;
    this._camToFov = initialFrame.fov;
    this._camTransitionElapsed = 0.48;
    this._camTransitionDuration = 0.48;

    // Pointer parallax state (±6° yaw, ±3° pitch)
    this._pointerTargetX = 0;
    this._pointerTargetY = 0;
    this._pointerCurrX = 0;
    this._pointerCurrY = 0;
    this._gazeWorldTarget = new THREE.Vector3(0, 1.55, 3.8);
    this._animOpts = { lookAtWorldPos: this._gazeWorldTarget };

    // Pre-allocated particle typed arrays
    this._particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    this._particleSeeds = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      this._particleSeeds[i] = (i / PARTICLE_COUNT) * Math.PI * 2 + (i % 7) * 0.37;
    }

    this._rafId = null;
    this._elapsedTime = 0;
    this._lastFrameTs = 0;
    this._resizeObserver = null;

    this._buildDom();
    this._renderNatalAstrolabe();
    this._updateAstrolabeChords(this.telemetry?.aspectChords || [], this.telemetry?.siegeCards || []);
    this._syncStageIndicators();
    this._initWebGL();
  }

  _buildDom() {
    this.rootEl = createHtmlNode('div', {
      class: 'svs-root',
      'data-framing': this.framing,
      'data-exalted': this.telemetry?.horizonDignity?.exalted ? 'true' : 'false',
      'data-armillary-paused': this.armillaryPaused ? 'true' : 'false',
    });

    // 1. Parhelion Horizon Halo (illuminates when ruling planet / ESMS pool is exalted)
    this.parhelionEl = createHtmlNode('div', {
      class: 'svs-parhelion-halo',
      'aria-hidden': 'true',
    });

    // 2. Coaxial 12-Sign Natal Astrolabe SVG
    this.svgEl = createSvgNode('svg', {
      class: 'svs-astrolabe',
      viewBox: '0 0 440 440',
      role: 'img',
      'aria-label': 'Seeker 12-Sign Natal Astrolabe and Sacred Aspect Chords',
    });
    this.wheelGroupEl = createSvgNode('g', { class: 'svs-zodiac-wheel' });
    this.axesGroupEl = createSvgNode('g', { class: 'svs-horizon-axes' });
    this.chordsGroupEl = createSvgNode('g', { class: 'svs-aspect-chords' });
    this.planetsGroupEl = createSvgNode('g', { class: 'svs-natal-nodes' });
    this.svgEl.appendChild(this.wheelGroupEl);
    this.svgEl.appendChild(this.axesGroupEl);
    this.svgEl.appendChild(this.chordsGroupEl);
    this.svgEl.appendChild(this.planetsGroupEl);

    // 3. Three.js WebGL Canvas Host
    this.canvasWrapEl = createHtmlNode('div', { class: 'svs-canvas-wrap' });
    this.canvasEl = createHtmlNode('canvas', {
      class: 'svs-canvas',
      'aria-label': 'Seeker 3D Alchemical Vessel',
    });
    this.canvasWrapEl.appendChild(this.canvasEl);

    // 4. Top-Corner Stage Framing & Armillary Lock Bar
    this.framingBadgeEl = createHtmlNode(
      'span',
      { class: 'svs-framing-pill' },
      [ARMILLARY_FRAMINGS[this.framing].label]
    );
    this.motionToggleBtn = createHtmlNode(
      'button',
      {
        type: 'button',
        class: 'svs-armillary-btn',
        title: 'Toggle slow 60s armillary zodiac rotation',
        onClick: () => {
          this.armillaryPaused = !this.armillaryPaused;
          this.rootEl.setAttribute('data-armillary-paused', this.armillaryPaused ? 'true' : 'false');
          this.motionToggleBtn.textContent = this.armillaryPaused ? '⏸ Ring Locked' : '⟳ Armillary';
          this.audioSynth?.triggerAstrolabeDetent(360);
        },
      },
      [this.armillaryPaused ? '⏸ Ring Locked' : '⟳ Armillary']
    );
    this.controlsEl = createHtmlNode(
      'div',
      { class: 'svs-stage-controls' },
      [this.framingBadgeEl, this.motionToggleBtn]
    );

    // 5. Bottom Astrolabe Readout Bar (interactive planet degree/dignity/decan or aspect summary)
    this.readoutEl = createHtmlNode('div', {
      class: 'svs-readout-bar',
      'aria-live': 'polite',
    });

    // Pointer parallax handlers on root stage (fine mouse/pen pointers only;
    // never hijack touch-scroll or planet glyph taps on mobile/tablet widths)
    this._onPointerMove = (e) => {
      if (e.pointerType === 'touch') return;
      if (
        e.target &&
        typeof e.target.closest === 'function' &&
        e.target.closest('.svs-planet-node, .svs-stage-controls, .svs-readout-bar')
      ) {
        return;
      }
      if (!this.rootEl || typeof this.rootEl.getBoundingClientRect !== 'function') return;
      const rect = this.rootEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      this._pointerTargetX = Math.max(-1, Math.min(1, nx));
      this._pointerTargetY = Math.max(-1, Math.min(1, ny));
    };
    this._onPointerLeave = () => {
      this._pointerTargetX = 0;
      this._pointerTargetY = 0;
    };

    this.rootEl.addEventListener('pointermove', this._onPointerMove);
    this.rootEl.addEventListener('pointerleave', this._onPointerLeave);

    this.rootEl.appendChild(this.parhelionEl);
    this.rootEl.appendChild(this.svgEl);
    this.rootEl.appendChild(this.canvasWrapEl);
    this.rootEl.appendChild(this.controlsEl);
    this.rootEl.appendChild(this.readoutEl);

    if (this.container) {
      this.container.replaceChildren(this.rootEl);
    }
  }

  _renderNatalAstrolabe() {
    const cx = 220;
    const cy = 220;
    const outerR = 206;
    const zodiacR = 186;
    const innerR = 164;
    const chordR = 150;

    // Clear wheel & planet layers
    this.wheelGroupEl.replaceChildren();
    this.axesGroupEl.replaceChildren();
    this.planetsGroupEl.replaceChildren();

    // Outer & inner brass armillary rings
    this.wheelGroupEl.appendChild(
      createSvgNode('circle', {
        cx,
        cy,
        r: outerR,
        class: 'svs-ring-outer',
      })
    );
    this.wheelGroupEl.appendChild(
      createSvgNode('circle', {
        cx,
        cy,
        r: innerR,
        class: 'svs-ring-inner',
      })
    );
    this.wheelGroupEl.appendChild(
      createSvgNode('circle', {
        cx,
        cy,
        r: chordR,
        class: 'svs-ring-chord-track',
      })
    );

    // 36 Decan vernier ticks (every 10°) + 12 Zodiac sector dividers & glyphs
    for (let dec = 0; dec < 36; dec++) {
      const deg = dec * 10;
      const isSignBoundary = dec % 3 === 0;
      const p1 = polarPoint(cx, cy, outerR, deg);
      const p2 = polarPoint(cx, cy, isSignBoundary ? innerR : outerR - 8, deg);
      this.wheelGroupEl.appendChild(
        createSvgNode('line', {
          x1: p1.x,
          y1: p1.y,
          x2: p2.x,
          y2: p2.y,
          class: isSignBoundary ? 'svs-tick-sign' : 'svs-tick-decan',
        })
      );
    }

    for (let s = 0; s < 12; s++) {
      const midDeg = s * 30 + 15;
      const pt = polarPoint(cx, cy, zodiacR, midDeg);
      const elemClass = ['fire', 'earth', 'air', 'water'][s % 4];
      const signNode = createSvgNode(
        'text',
        {
          x: pt.x,
          y: pt.y,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          class: `svs-sign-glyph svs-sign-glyph--${elemClass}`,
        },
        [SIGN_GLYPHS[s]]
      );
      signNode.appendChild(createSvgNode('title', {}, [SIGN_NAMES[s]]));
      this.wheelGroupEl.appendChild(signNode);
    }

    // Natal Placements & Ascendant / Midheaven axes
    const astrolabeData = buildNatalAstrolabeData(this.chart);
    if (astrolabeData.ascDeg !== null) {
      const ascA = polarPoint(cx, cy, innerR + 4, astrolabeData.ascDeg);
      const ascB = polarPoint(cx, cy, innerR - 14, astrolabeData.ascDeg);
      this.axesGroupEl.appendChild(
        createSvgNode('line', {
          x1: ascA.x,
          y1: ascA.y,
          x2: ascB.x,
          y2: ascB.y,
          class: 'svs-axis-asc',
        })
      );
    }

    // Stagger closely conjunct natal planets slightly in radius so glyphs never overlap
    const sorted = [...astrolabeData.placements].sort((a, b) => a.lonDeg - b.lonDeg);
    for (let i = 0; i < sorted.length; i++) {
      const node = sorted[i];
      const prev = i > 0 ? sorted[i - 1] : sorted[sorted.length - 1];
      const closeToPrev =
        sorted.length > 1 &&
        prev !== node &&
        Math.min(Math.abs(node.lonDeg - prev.lonDeg), 360 - Math.abs(node.lonDeg - prev.lonDeg)) < 9;
      const nodeRadius = closeToPrev && i % 2 === 1 ? innerR - 18 : innerR - 4;
      const pt = polarPoint(cx, cy, nodeRadius, node.lonDeg);

      const g = createSvgNode('g', {
        class: 'svs-planet-node',
        tabindex: '0',
        role: 'button',
        'data-body-idx': node.bodyIdx,
        'aria-label': `${node.planetName} in ${node.signName} ${node.degInSign} degrees, ${node.decanCardTitle}`,
        transform: `translate(${pt.x}, ${pt.y})`,
      });

      const dot = createSvgNode('circle', {
        cx: 0,
        cy: 0,
        r: 10.5,
        class: 'svs-planet-disc',
        style: `--planet-accent: ${node.planetColor || PLANET_COLORS[node.bodyIdx] || '#eab308'}`,
      });
      const label = createSvgNode(
        'text',
        {
          x: 0,
          y: 0.5,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          class: 'svs-planet-glyph',
          fill: node.planetColor || '#f8fafc',
        },
        [node.planetGlyph]
      );

      const handleFocus = () => {
        this.focusedPlanet = node;
        this._syncReadoutBar();
        this.audioSynth?.triggerAstrolabeDetent(280 + node.bodyIdx * 22);
        this.onPlanetSelect?.(node);
      };
      const handleBlur = () => {
        if (this.focusedPlanet === node) {
          this.focusedPlanet = null;
          this._syncReadoutBar();
          this.onPlanetSelect?.(null);
        }
      };

      g.addEventListener('pointerenter', handleFocus);
      g.addEventListener('focus', handleFocus);
      g.addEventListener('click', (ev) => {
        ev.stopPropagation();
        handleFocus();
      });
      g.addEventListener('pointerleave', handleBlur);
      g.addEventListener('blur', handleBlur);

      g.appendChild(dot);
      g.appendChild(label);
      this.planetsGroupEl.appendChild(g);
    }
  }

  _updateAstrolabeChords(chords = [], siegeCards = [], previewCard = null) {
    if (!this.chordsGroupEl) return;
    const cx = 220;
    const cy = 220;
    const chordR = 150;
    const children = [];

    for (const chord of chords) {
      const pA = polarPoint(cx, cy, chordR, chord.degA);
      const pB = polarPoint(cx, cy, chordR, chord.degB);

      if (chord.type === 'conjunction') {
        // Radial golden alignment ray + subtle aureole on the astrolabe track
        const innerPt = polarPoint(cx, cy, chordR - 28, chord.degA);
        children.push(
          createSvgNode('line', {
            x1: innerPt.x,
            y1: innerPt.y,
            x2: pA.x,
            y2: pA.y,
            stroke: chord.color || '#f6e7c1',
            class: `svs-chord svs-chord--conjunction${chord.isPreview ? ' is-preview' : ''}`,
          })
        );
        children.push(
          createSvgNode('circle', {
            cx: pA.x,
            cy: pA.y,
            r: chord.isPreview ? 5.5 : 4.5,
            stroke: chord.color || '#f6e7c1',
            class: `svs-chord-aureole${chord.isPreview ? ' is-preview' : ''}`,
          })
        );
      } else {
        // Inscribed Trine (120°) or Sextile (60°) sacred chord across the astrolabe
        children.push(
          createSvgNode('line', {
            x1: pA.x,
            y1: pA.y,
            x2: pB.x,
            y2: pB.y,
            stroke: chord.color || '#eab308',
            class: `svs-chord svs-chord--${chord.type}${chord.isPreview ? ' is-preview' : ''}`,
          })
        );
        const midX = Number(((pA.x + pB.x) * 0.5).toFixed(2));
        const midY = Number(((pA.y + pB.y) * 0.5).toFixed(2));
        children.push(
          createSvgNode(
            'text',
            {
              x: midX,
              y: midY,
              'text-anchor': 'middle',
              'dominant-baseline': 'central',
              fill: chord.color || '#eab308',
              class: `svs-chord-glyph${chord.isPreview ? ' is-preview' : ''}`,
            },
            [chord.glyph || '△']
          )
        );
      }
    }

    // Mark active slotted card ecliptic anchors along the inner chord ring
    const slottedDetails = this.telemetry?.slottedDetails || [];
    for (const item of slottedDetails) {
      const deg = item.attunement?.cardDeg ?? 0;
      const pt = polarPoint(cx, cy, chordR, deg);
      children.push(
        createSvgNode('circle', {
          cx: pt.x,
          cy: pt.y,
          r: 3.6,
          class: 'svs-slot-anchor-pip',
        })
      );
    }

    this.chordsGroupEl.replaceChildren(...children);
    this._activeChords = chords;
    this._hasPreviewChord = Boolean(previewCard);
    this._syncReadoutBar();
  }

  _syncReadoutBar() {
    if (!this.readoutEl) return;

    if (this.focusedPlanet) {
      const p = this.focusedPlanet;
      const retro = p.retrograde ? ' ℞' : '';
      const digStr =
        p.dignityType && p.dignityType !== 'peregrine'
          ? ` · ${p.dignityType.toUpperCase()} (${p.dignityScore > 0 ? `+${p.dignityScore}` : p.dignityScore})`
          : ' · Peregrine';
      const lord = p.decanLordTitle ? ` — ${p.decanLordTitle}` : '';
      this.readoutEl.textContent = `${p.planetGlyph} ${p.planetName} in ${p.signGlyph} ${p.signName} ${p.degInSign}°${retro}${digStr} · ${p.decanCardTitle}${lord}`;
      this.readoutEl.setAttribute('data-mode', 'planet');
      return;
    }

    const chords = this._activeChords || [];
    const previewChord = chords.find((c) => c.isPreview);
    if (previewChord) {
      this.readoutEl.textContent = `Preview Aspect · ${previewChord.label}`;
      this.readoutEl.setAttribute('data-mode', 'preview');
      return;
    }

    if (chords.length > 0) {
      const primary = chords[0];
      const extra = chords.length > 1 ? ` (+${chords.length - 1} harmonic)` : '';
      this.readoutEl.textContent = `${primary.label}${extra}`;
      this.readoutEl.setAttribute('data-mode', 'aspect');
      return;
    }

    const hd = this.telemetry?.horizonDignity;
    if (hd) {
      this.readoutEl.textContent = `${hd.headline} · ${hd.detail}`;
      this.readoutEl.setAttribute('data-mode', hd.exalted ? 'exalted' : 'horizon');
    }
  }

  _syncStageIndicators() {
    if (!this.rootEl) return;
    const exalted = Boolean(this.telemetry?.horizonDignity?.exalted);
    const domEsms = this.telemetry?.dominantEsms || 'spirit';
    this.rootEl.setAttribute('data-exalted', exalted ? 'true' : 'false');
    this.rootEl.setAttribute('data-esms', domEsms);
    this.rootEl.setAttribute('data-framing', this.framing);
    if (this.framingBadgeEl) {
      this.framingBadgeEl.textContent = ARMILLARY_FRAMINGS[this.framing]?.label || 'Observatory Stance';
    }
    this._syncReadoutBar();
  }

  _canCreateWebGLContext() {
    if (typeof window === 'undefined' || !this.canvasEl || typeof this.canvasEl.getContext !== 'function') {
      return false;
    }
    try {
      const gl =
        this.canvasEl.getContext('webgl2', { alpha: true, antialias: true }) ||
        this.canvasEl.getContext('webgl', { alpha: true, antialias: true });
      return Boolean(gl);
    } catch {
      return false;
    }
  }

  _initWebGL() {
    if (!this._canCreateWebGLContext()) {
      this.webglActive = false;
      this.rootEl?.setAttribute('data-webgl', 'fallback');
      return;
    }

    try {
      const renderer = new THREE.WebGLRenderer({
        canvas: this.canvasEl,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      renderer.setPixelRatio(dpr);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.12;

      const scene = new THREE.Scene();
      const frame = ARMILLARY_FRAMINGS[this.framing];
      const camera = new THREE.PerspectiveCamera(frame.fov, 1, 0.1, 40);
      camera.position.set(...frame.pos);
      camera.lookAt(...frame.lookAt);

      // Observatory lighting rig (warm brass key + astral cyan fill + nadir bounce)
      const hemi = new THREE.HemisphereLight(0xdbeafe, 0x0f172a, 0.82);
      const keyLight = new THREE.DirectionalLight(0xfff3d6, 1.48);
      keyLight.position.set(2.4, 4.2, 3.6);
      const fillLight = new THREE.DirectionalLight(0x7dd3fc, 0.58);
      fillLight.position.set(-2.8, 2.2, 2.2);
      const brassRim = new THREE.PointLight(0xeab308, 0.72, 9);
      brassRim.position.set(0, 2.5, -2.2);

      scene.add(hemi, keyLight, fillLight, brassRim);
      this._brassRimLight = brassRim;

      // Mount centralized Seeker Vessel Avatar
      this.avatar = createVesselAvatarMesh(this.telemetry.ratedPayload, {
        footRingRadius: 1.52,
        loadModelAsync: false,
      });
      // Hide contest-only WardShield in Observatory idle/surge so its wireframe
      // never casts translucent alpha artifacts over the SVG Aspect Chords
      if (this.avatar.userData?.wardShield) {
        this.avatar.userData.wardShield.visible = false;
      }
      scene.add(this.avatar);

      // Zero-allocation ESMS Elemental Motes (72 points)
      const pGeom = new THREE.BufferGeometry();
      const posAttr = new THREE.BufferAttribute(this._particlePositions, 3);
      posAttr.setUsage(THREE.DynamicDrawUsage);
      pGeom.setAttribute('position', posAttr);

      const profile = ESMS_STAGE_PROFILES[this.telemetry.dominantEsms] || ESMS_STAGE_PROFILES.spirit;
      const pMat = new THREE.PointsMaterial({
        color: profile.moteHex,
        size: 0.036,
        transparent: true,
        opacity: 0.68,
        blending: THREE.NormalBlending,
        depthWrite: false,
      });
      this._motePoints = new THREE.Points(pGeom, pMat);
      this._motePoints.name = 'SeekerEsmsMotes';
      scene.add(this._motePoints);

      this.renderer = renderer;
      this.scene = scene;
      this.camera = camera;
      this.webglActive = true;
      this.rootEl?.setAttribute('data-webgl', 'active');

      this._applyVesselShaderState(this.telemetry, null);
      this._handleResize();

      if (typeof ResizeObserver === 'function' && this.canvasWrapEl) {
        this._resizeObserver = new ResizeObserver(() => this._handleResize());
        this._resizeObserver.observe(this.canvasWrapEl);
      }

      this._lastFrameTs = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this._tickBound = (ts) => this._tick(ts);
      if (typeof requestAnimationFrame === 'function') {
        this._rafId = requestAnimationFrame(this._tickBound);
      }
    } catch {
      this.webglActive = false;
      this.rootEl?.setAttribute('data-webgl', 'fallback');
    }
  }

  _computeAspectCompensatedFov(baseFovDeg) {
    const aspect = this.camera?.aspect || 1;
    if (aspect >= 1) return baseFovDeg;
    // When stage is narrower than 1:1, widen vertical FOV so horizontal frustum
    // stays locked to the 1:1 SVG Natal Astrolabe Ring without coaxial drift.
    const halfRad = THREE.MathUtils.degToRad(baseFovDeg * 0.5);
    const compensatedRad = 2 * Math.atan(Math.tan(halfRad) / Math.max(0.55, aspect));
    return THREE.MathUtils.radToDeg(compensatedRad);
  }

  _handleResize() {
    if (!this.webglActive || !this.renderer || !this.camera || !this.canvasWrapEl) return;
    if (typeof this.canvasWrapEl.getBoundingClientRect !== 'function') return;
    const rect = this.canvasWrapEl.getBoundingClientRect();
    const width = Math.max(180, Math.floor(rect.width || 360));
    const height = Math.max(220, Math.floor(rect.height || 440));
    this.camera.aspect = width / height;
    const baseFov = ARMILLARY_FRAMINGS[this.framing]?.fov || 35;
    this.camera.fov = this._computeAspectCompensatedFov(baseFov);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  _applyVesselShaderState(telemetry, preview = null) {
    if (!this.avatar || !telemetry) return;
    const activeSource = preview?.projected || telemetry;
    const domEsms = activeSource.dominantEsms || 'spirit';
    const profile = ESMS_STAGE_PROFILES[domEsms] || ESMS_STAGE_PROFILES.spirit;
    const exaltedBoost = activeSource.horizonDignity?.exalted ? 0.18 : 0;

    setVesselRimUniforms(this.avatar, {
      color: profile.rimHex,
      power: profile.rimPower,
      intensity: profile.rimIntensity + exaltedBoost,
    });

    const chords = preview?.aspectChords || telemetry.aspectChords || [];
    const hasConj = chords.some((c) => c.type === 'conjunction');
    const hasTrine = chords.some((c) => c.type === 'trine');
    const hasSextile = chords.some((c) => c.type === 'sextile');
    const slotCount = activeSource.siegeCards?.length || 0;

    pulseVesselRelics(this.avatar, {
      crownBoost: (hasConj ? 0.55 : 0) + (activeSource.horizonDignity?.exalted ? 0.25 : 0),
      coreBoost: (hasTrine ? 0.5 : 0) + slotCount * 0.1,
      relicBoost: (hasSextile ? 0.35 : 0) + slotCount * 0.12,
    });

    if (this._motePoints?.material) {
      this._motePoints.material.color.setHex(profile.moteHex);
      this._motePoints.material.opacity = activeSource.horizonDignity?.exalted ? 0.85 : 0.65;
    }
    if (this._brassRimLight) {
      this._brassRimLight.intensity = activeSource.horizonDignity?.exalted ? 1.15 : 0.68;
    }
  }

  _stepParticles(t, domEsms) {
    const pos = this._particlePositions;
    const seeds = this._particleSeeds;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const idx = i * 3;
      const s = seeds[i];

      if (domEsms === 'spirit') {
        // Wands / Fire: Rising solar sparks spiraling gently around the Vessel
        const cycle = ((t * 0.42 + s * 0.16) % 1 + 1) % 1;
        const radius = 0.62 + (1 - cycle) * 0.72 + Math.sin(t * 1.8 + s) * 0.08;
        const angle = s + t * 0.48;
        pos[idx] = Math.cos(angle) * radius;
        pos[idx + 1] = 0.12 + cycle * 2.75;
        pos[idx + 2] = Math.sin(angle) * radius;
      } else if (domEsms === 'essence') {
        // Cups / Water: Fluid tidal caustic figure-eight drift
        const angle = s + t * 0.28;
        const radius = 0.88 + Math.sin(t * 1.1 + s * 2) * 0.34;
        pos[idx] = Math.cos(angle) * radius;
        pos[idx + 1] = 0.45 + ((i / PARTICLE_COUNT) * 2.1) + Math.sin(t * 1.4 + s) * 0.18;
        pos[idx + 2] = Math.sin(angle) * radius;
      } else if (domEsms === 'substance') {
        // Swords / Air: Crisp high-orbit silver wind arcs
        const angle = s + t * 0.95;
        const radius = 0.78 + (i % 5) * 0.15;
        pos[idx] = Math.cos(angle) * radius;
        pos[idx + 1] = 0.35 + ((i / PARTICLE_COUNT) * 2.35) + Math.cos(angle * 2) * 0.09;
        pos[idx + 2] = Math.sin(angle) * radius;
      } else {
        // Pentacles / Earth: Grounded gold-leaf motes orbiting near the ecliptic foot ring
        const angle = s + t * 0.2;
        const radius = 0.82 + (i % 6) * 0.13;
        pos[idx] = Math.cos(angle) * radius;
        pos[idx + 1] = 0.14 + (i % 8) * 0.24 + Math.sin(t * 0.8 + s) * 0.06;
        pos[idx + 2] = Math.sin(angle) * radius;
      }
    }

    const attr = this._motePoints?.geometry?.getAttribute('position');
    if (attr) attr.needsUpdate = true;
  }

  _tick(ts) {
    this._rafId = null;
    if (this._disposed || !this.webglActive) return;

    const rawDt = this._lastFrameTs > 0 ? (ts - this._lastFrameTs) / 1000 : 1 / 60;
    this._lastFrameTs = ts;
    const dt = Math.min(0.05, Math.max(0.001, rawDt));

    const domEsms = this.telemetry?.dominantEsms || 'spirit';
    const profile = ESMS_STAGE_PROFILES[domEsms] || ESMS_STAGE_PROFILES.spirit;
    const motionScale = prefersReducedMotion() ? 0.25 : 1.0;
    this._elapsedTime += dt * profile.idleCadence * motionScale;

    // 1. Armillary Camera Transition (480ms ease-out) + Orbital Pointer Parallax (±6° yaw, ±3° pitch)
    if (this._camTransitionElapsed < this._camTransitionDuration) {
      this._camTransitionElapsed = Math.min(
        this._camTransitionDuration,
        this._camTransitionElapsed + dt
      );
    }
    const progress = armillaryEaseOut(this._camTransitionElapsed / this._camTransitionDuration);
    this._camCurrPos.lerpVectors(this._camFromPos, this._camToPos, progress);
    this._camCurrLook.lerpVectors(this._camFromLook, this._camToLook, progress);
    const rawFov = THREE.MathUtils.lerp(this._camFromFov, this._camToFov, progress);
    const nextFov = this._computeAspectCompensatedFov(rawFov);
    if (Math.abs(this.camera.fov - nextFov) > 0.02) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }

    this._pointerCurrX += (this._pointerTargetX - this._pointerCurrX) * Math.min(1, dt * 6.5);
    this._pointerCurrY += (this._pointerTargetY - this._pointerCurrY) * Math.min(1, dt * 6.5);

    const yawOffset = this._pointerCurrX * 0.105 * motionScale; // ~±6°
    const pitchOffset = -this._pointerCurrY * 0.052 * motionScale; // ~±3°
    const radiusZ = this._camCurrPos.z;
    this.camera.position.set(
      this._camCurrPos.x + Math.sin(yawOffset) * radiusZ,
      this._camCurrPos.y + pitchOffset * 2.2,
      Math.cos(yawOffset) * radiusZ
    );
    this.camera.lookAt(this._camCurrLook);

    // 2. Subtle Gaze IK toward pointer + Vessel Articulated Idle/Surge Update
    this._gazeWorldTarget.set(
      this._pointerCurrX * 0.85,
      1.55 - this._pointerCurrY * 0.35,
      3.6
    );
    updateVesselAvatarAnimation(
      this.avatar,
      dt * profile.idleCadence * motionScale,
      this._elapsedTime,
      this._animOpts
    );

    // 3. Step ESMS Elemental Motes
    this._stepParticles(this._elapsedTime, domEsms);

    this.renderer.render(this.scene, this.camera);

    if (!this._disposed && typeof requestAnimationFrame === 'function') {
      this._rafId = requestAnimationFrame(this._tickBound);
    }
  }

  /**
   * Smoothly transitions between 'observatory' and 'crucible' armillary framings.
   * @param {'observatory' | 'crucible'} framingName
   */
  setFraming(framingName) {
    const target = ARMILLARY_FRAMINGS[framingName] ? framingName : 'observatory';
    if (target === this.framing) return;
    this.framing = target;

    const spec = ARMILLARY_FRAMINGS[target];
    this._camFromPos.copy(this._camCurrPos);
    this._camFromLook.copy(this._camCurrLook);
    this._camFromFov = this.camera ? this.camera.fov : this._camToFov;

    this._camToPos.set(...spec.pos);
    this._camToLook.set(...spec.lookAt);
    this._camToFov = spec.fov;
    this._camTransitionElapsed = prefersReducedMotion() ? this._camTransitionDuration : 0;

    this._syncStageIndicators();
  }

  /**
   * Updates the Vessel rig, rim shaders, relic pulse, and Sacred Aspect Chords in-place.
   * @param {object} telemetry - Base telemetry from computeSeekerTelemetry()
   * @param {object | null} [preview] - Optional hover preview from computeSeekerPreview()
   * @param {object} [chart] - Optional updated natal chart
   */
  updateTelemetry(telemetry, preview = null, chart = null) {
    if (this._disposed || !telemetry) return;
    const chartChanged = chart && chart !== this.chart;
    this.telemetry = telemetry;
    if (chartChanged) {
      this.chart = chart;
      this._renderNatalAstrolabe();
    }

    if (this.webglActive && this.avatar) {
      const payloadToRender = preview?.projected?.ratedPayload || telemetry.ratedPayload;
      refreshVesselFromPayload(this.avatar, payloadToRender);
      this._applyVesselShaderState(telemetry, preview);
    }

    const chords = preview ? preview.aspectChords : telemetry.aspectChords;
    this._updateAstrolabeChords(chords || [], telemetry.siegeCards || [], preview ? true : null);
    this._syncStageIndicators();
  }

  destroy() {
    if (this._disposed) return;
    this._disposed = true;

    if (this._rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this.rootEl) {
      this.rootEl.removeEventListener('pointermove', this._onPointerMove);
      this.rootEl.removeEventListener('pointerleave', this._onPointerLeave);
    }
    if (this.avatar) {
      disposeVesselAvatar(this.avatar);
      this.avatar = null;
    }
    if (this._motePoints) {
      this._motePoints.geometry?.dispose();
      this._motePoints.material?.dispose();
      this._motePoints = null;
    }
    if (this.renderer) {
      try {
        this.renderer.dispose();
      } catch {
        // Ignored in headless environments
      }
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
  }
}
