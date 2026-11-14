/* ============================================================
   My Pentacles — 3-Zone Hermetic Astral Observatory & Tarot Engine
   ============================================================
   Transforms the Seeker's profile & celestial deck into a living spatial
   diagram anchored to Pentacles' centralized Vessel Rating System
   (src/lib/agents/rating-contract.ts):
     • Zone 1 (Left)   → Natal Identity, Centralized OVR [25–99], 4-Point ESMS
                         Alchemical Diamond, Honest Siege Output, Sacred 7
                         Vernier Bars, and full Natal & Decan Dossier tabs
     • Zone 2 (Center) → Coaxial 12-Sign Natal Astrolabe Ring (inscribed with
                         Sacred Aspect Chords △/⚹/☌) + 3D Articulated Vessel
     • Zone 3 (Right)  → 3-Card Siege Triad (I·II·III), Crucible Duplicate
                         Card Fusion, and Container-Responsive Celestial Deck
   ============================================================ */

import { h, clear } from "./dom.js";
import { decanCard } from "./decans.js";
import { SUIT_GLYPHS, SUIT_COLORS, SUIT_ART } from "./deck.js";
import { normalizeTarotCard, SHIPPED_CARD_ART } from "./card-model.js";
import { categoricalChartAnalytics } from "./sign-character.js";
import { getCard, kineticAlignment } from "../cards/index.js";
import { SACRED_STAT_KEYS } from "../lib/agents/rating-contract";
import { CourtAudioSynth } from "../lib/agents/court-audio-synth";
import { liveWalletSync } from "../lib/agents/live-wallet-sync";
import { SpringAnimator } from "./seeker-stage/spring-animator.js";
import {
  computeSeekerTelemetry,
  computeSeekerPreview,
  evaluateCardNatalAttunement,
  resolveCardDefinition,
  levelMultiplier,
} from "./seeker-stage/seeker-rating-telemetry.js";
import { SeekerVesselStage } from "./seeker-stage/seeker-vessel-stage.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const PLANET_COLORS = ["#e8b84b", "#cbd0db", "#9aa7c4", "#d98fb0", "#cf4d4d", "#cf9a52", "#9a937c", "#5fb6c4", "#6470c8", "#8a6aa0"];
const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const SIGN_ELEMENTS = ["Fire", "Earth", "Air", "Water", "Fire", "Earth", "Air", "Water", "Fire", "Earth", "Air", "Water"];

const SACRED_STAT_LABELS = Object.freeze({
  power: "Power",
  resonance: "Resonance",
  wisdom: "Wisdom",
  charisma: "Charisma",
  intuition: "Intuition",
  adaptability: "Adaptability",
  vitality: "Vitality",
});

const SACRED_ICONS = Object.freeze({
  power: "⚔",
  resonance: "✦",
  wisdom: "📜",
  charisma: "☉",
  intuition: "☽",
  adaptability: "☿",
  vitality: "♥",
});

const SACRED_BAR_COLORS = Object.freeze({
  power: "#d96b52",
  resonance: "#4fb8d6",
  wisdom: "#d8b46a",
  charisma: "#e5989b",
  intuition: "#818cf8",
  adaptability: "#6bc4a6",
  vitality: "#cfa358",
});

// One-line faction doctrine (mirrors faction-war.js PASSIVE / server combat passives).
const PASSIVE = [
  "Radiance — vitality and command", "Tides — intuition and reach", "Quicksilver — cunning and signal",
  "Concord — harmony and allure", "Onslaught — +attack, breaks armour", "Expansion — fortune and momentum",
  "Endurance — +health, holds longest", "Upheaval — sudden reversals", "Dissolution — mist and illusion",
  "Transformation — depth and ruin",
];

const ROMAN_SLOTS = ["I", "II", "III"];

const dignityChip = (d) =>
  d >= 5 ? { t: "+5 dom", c: "ruler" } :
  d >= 3 ? { t: "+3 exa", c: "exalt" } :
  d <= -5 ? { t: "-5 fall", c: "fall" } :
  d <= -3 ? { t: "-3 det", c: "detriment" } :
  null;

const planetIdxOf = (f) => {
  if (f == null) return 0;
  if (typeof f === "number") return f >= 0 && f < 10 ? f : 0;
  const i = PLANET_NAMES.findIndex((n) => n.toLowerCase() === String(f).toLowerCase());
  return i >= 0 ? i : 0;
};

function svgNode(tag, attrs = {}, children = []) {
  const el =
    typeof document !== "undefined" && typeof document.createElementNS === "function"
      ? document.createElementNS(SVG_NS, tag)
      : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    el.setAttribute(k, String(v));
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return el;
}

function diamondPolygonPoints(vals) {
  const cx = 100;
  const cy = 92;
  const maxR = 66;
  const rSpirit = Math.max(10, Math.min(maxR, ((Number(vals.spirit) || 20) / 100) * maxR));
  const rSubstance = Math.max(10, Math.min(maxR, ((Number(vals.substance) || 20) / 100) * maxR));
  const rMatter = Math.max(10, Math.min(maxR, ((Number(vals.matter) || 20) / 100) * maxR));
  const rEssence = Math.max(10, Math.min(maxR, ((Number(vals.essence) || 20) / 100) * maxR));

  const top = `${cx},${(cy - rSpirit).toFixed(1)}`;
  const right = `${(cx + rSubstance).toFixed(1)},${cy}`;
  const bottom = `${cx},${(cy + rMatter).toFixed(1)}`;
  const left = `${(cx - rEssence).toFixed(1)},${cy}`;
  return `${top} ${right} ${bottom} ${left}`;
}

function cardDupeSignature(c) {
  if (!c) return "";
  const norm = normalizeTarotCard(c);
  return `${norm.isMajor ? "major" : norm.suitKey}:${norm.rank}`;
}

export class MyPentaclesInstance {
  constructor(opts) {
    this.opts = opts || {};
    this.el = this.opts.el || null;
    this.hooks = this.opts.hooks || {};
    this._stateOf = this.opts.state ? () => this.opts.state : () => (typeof window !== "undefined" ? window.state : null);
    this.dom = {};
    this.deckFilter = "all"; // all | active | defense | bench | majors | minors
    this.cardSearchQuery = "";
    this.inspectedCard = null;
    this.inspectorFlipped = false;
    this.inspectorStatTab = "planetary12"; // planetary12 | sacred7

    // 3-Zone Hermetic Observatory state
    this.leftTab = "observatory"; // observatory | natal
    this.activeSlotIndex = null;  // 0 | 1 | 2 | null
    this.fuseMode = false;
    this.fuseAnchorCardId = null;
    this.mobileDrawerOpen = false;
    this.mobileStatsExpanded = false;
    this.highlightedBodyIdx = null;

    this._cardsData = null;
    this._cardDefCache = new Map();
    this._telemetry = null;
    this._liveEsms = null;
    this._metricRefs = null;
    this._vesselStage = null;
    this._lastHoverCardId = null;
    this._lastBrushTs = 0;
    this._walletUnsub = null;

    this._audioSynth = new CourtAudioSynth();
    this._spring = new SpringAnimator({
      stiffness: 320,
      damping: 30,
      onFrame: (vals) => this._applyDiamondSpring(vals),
    });
  }

  mount(el) {
    if (el) this.el = el;
    if (!this.el) throw new Error("MyPentacles.mount: no element");
    clear(this.el);
    this.el.classList.add("alchm-pentacles", "alchm-codex");
    this.dom.root = h("div", { class: "mc-root mc-observatory-root" });
    this.el.appendChild(this.dom.root);

    // Subscribe to live cross-app Vessel ESMS updates while mounted
    if (!this._walletUnsub && liveWalletSync && typeof liveWalletSync.onAgentSync === "function") {
      this._walletUnsub = liveWalletSync.onAgentSync((_agentId, updatedPayload) => {
        if (updatedPayload?.esms) {
          this._liveEsms = updatedPayload.esms;
          this._refreshTelemetryInPlace();
        }
      });
    }

    this.paint();
    return this;
  }

  /** Re-read the live GameState and render the 3-Zone Hermetic Observatory. */
  paint() {
    const st = this._stateOf();
    if (st && st.player && typeof st.ensureStarterDeck === "function") {
      st.ensureStarterDeck();
    }
    const player = st && st.player;
    const root = this.dom.root;
    if (!root) return;

    if (!player || !player.chart) {
      this._destroyVesselStage();
      clear(root);
      root.className = "mc-root";
      root.appendChild(h("div", { class: "mc-empty" }, [
        h("div", { class: "mc-empty-mark", text: "✦" }),
        h("div", { class: "mc-empty-title", text: "No natal chart sealed yet" }),
        h("div", { class: "mc-dim", text: "Forge your natal chart to mint your celestial card deck and claim a planetary faction." }),
        this.hooks.onForge ? h("button", { class: "mc-cta", text: "Forge your chart", onClick: () => this.hooks.onForge() }) : null,
      ]));
      return;
    }

    const factionIdx = planetIdxOf(player.faction);
    const collection = (st && st.collection) || [];
    let deck = (st && st.deck) || [];
    if (deck.length === 0 && collection.length > 0) {
      deck = collection.map((c, i) => ({ card_id: c.card_id, loadout: i < 8 ? "active" : "bench" }));
      if (st) st.deck = deck;
    }

    // Ensure selectedCards is a Set on state so 3-card Siege slotting works everywhere
    if (st && !(st.selectedCards instanceof Set)) {
      st.selectedCards = new Set(Array.isArray(st.selectedCards) ? st.selectedCards : []);
    }
    // Prune any selectedCards no longer in collection
    if (st?.selectedCards instanceof Set) {
      const validIds = new Set(collection.map((c) => Number(c.card_id)));
      for (const id of [...st.selectedCards]) {
        if (!validIds.has(Number(id))) st.selectedCards.delete(id);
      }
    }

    // Compute centralized RatedAgentPayload & Seeker telemetry
    this._telemetry = computeSeekerTelemetry({
      state: st,
      esmsOverride: this._liveEsms,
    });

    const ascMin = Number(player.chart.ascendant) || 0;
    const mcMin = Number(player.chart.midheaven) || 0;
    const timeKnown = player.chart.time_known !== false;
    const analytics = categoricalChartAnalytics(player.chart.placements || [], ascMin, mcMin, timeKnown);

    // Ensure persistent Zone 2 stage host survives re-paints without recreating WebGL context
    if (!this.dom.stageHost) {
      this.dom.stageHost = h("div", { class: "mc-stage-host" });
    }

    root.className =
      "mc-root mc-observatory-root" +
      (this.mobileDrawerOpen ? " is-drawer-open" : "") +
      (this.mobileStatsExpanded ? " is-stats-expanded" : "") +
      (this.fuseMode ? " is-fuse-mode" : "");

    const zoneLeft = this._buildZoneLeft(player, factionIdx, analytics);
    const zoneCenter = this._buildZoneCenter(player);
    const zoneRight = this._buildZoneRight(collection, deck, player.chart);

    clear(root);
    root.appendChild(zoneLeft);
    root.appendChild(zoneCenter);
    root.appendChild(zoneRight);

    // Mount or update persistent 3D Vessel + Natal Astrolabe Stage
    if (!this._vesselStage) {
      this._vesselStage = new SeekerVesselStage({
        container: this.dom.stageHost,
        telemetry: this._telemetry,
        chart: player.chart,
        audioSynth: this._audioSynth,
        onPlanetSelect: (node) => this._highlightNatalPlacement(node),
      });
    } else {
      this._vesselStage.updateTelemetry(this._telemetry, null, player.chart);
    }
    this._vesselStage.setFraming(this.fuseMode ? "crucible" : "observatory");

    // Seed spring diamond to current ESMS balance
    this._spring.setTargets(this._telemetry.esmsDiamond, { immediate: !this._hasPaintedOnce });
    this._hasPaintedOnce = true;

    // Render 3D flippable inspector modal on document.body if a card is open
    this._cleanupInspector();
    if (this.inspectedCard && typeof document !== "undefined" && document.body) {
      this._inspectorEl = this._cardInspectorModal(this.inspectedCard, deck, collection);
      this._inspectorEl.classList.add("alchm-pentacles", "alchm-codex");
      document.body.appendChild(this._inspectorEl);
    }
  }

  // ── Zone 1 (Left): Identity, Centralized Rating, ESMS Diamond & Natal Dossier ──
  _buildZoneLeft(player, factionIdx, analytics) {
    const tel = this._telemetry;
    const payload = tel.ratedPayload;
    const col = PLANET_COLORS[factionIdx] || "var(--ac-gold)";
    const placements = player.chart?.placements || [];

    const findBodyText = (bodyIdx) => {
      const p = placements.find((pl) => planetIdxOf(pl.body) === bodyIdx);
      if (!p) return "—";
      const s = Number(p.sign) || 0;
      const d = Math.floor((Number(p.arc_minutes) || 0) / 60);
      return `${SIGN_GLYPHS[s]} ${SIGN_NAMES[s]} ${d}°`;
    };
    const ascText =
      player.chart?.time_known !== false && player.chart?.ascendant != null
        ? (() => {
            const m = Number(player.chart.ascendant) || 0;
            const s = Math.floor((m / 1800) % 12);
            const d = Math.floor((m % 1800) / 60);
            return `${SIGN_GLYPHS[s]} ${SIGN_NAMES[s]} ${d}°`;
          })()
        : "Solar Chart";

    // Permanent Celestial Header
    const ovrValueEl = h("span", { class: "mc-ovr-value", text: String(payload.ovr) });
    const ovrDeltaEl = h("span", { class: "mc-vernier-delta mc-ovr-delta", text: "" });
    const archetypeEl = h("div", { class: "mc-archetype-title", text: payload.archetype.title });

    const sealsRow =
      payload.seals.length > 0
        ? h(
            "div",
            { class: "mc-seals-strip" },
            payload.seals.slice(0, 4).map((seal) =>
              h("span", {
                class: `mc-seal-pill mc-seal-pill--${seal.tier.toLowerCase()}`,
                title: `${seal.name || seal.title}: ${seal.description}`,
                text: `✦ ${seal.tier} · ${SACRED_STAT_LABELS[seal.statKey] || seal.name}`,
              })
            )
          )
        : null;

    const headerCard = h("div", { class: "mc-obs-identity" }, [
      h("div", { class: "mc-obs-id-top" }, [
        h("span", {
          class: "mc-medallion mc-medallion--compact",
          style: { color: col, borderColor: col },
          text: PLANET_GLYPHS[factionIdx] || "✦",
        }),
        h("div", { class: "mc-obs-id-main" }, [
          h("div", { class: "mc-handle-row" }, [
            h("span", { class: "mc-handle", text: player.handle || "Seeker" }),
            h("span", { class: "mc-seeker-badge", text: `${PLANET_GLYPHS[factionIdx]} ${PLANET_NAMES[factionIdx]}` }),
          ]),
          archetypeEl,
        ]),
        h("div", { class: "mc-ovr-crest", title: "Centralized Pentacles Vessel Rating (25–99)" }, [
          h("span", { class: "mc-ovr-label", text: "OVR" }),
          h("div", { class: "mc-ovr-num-wrap" }, [ovrValueEl, ovrDeltaEl]),
        ]),
      ]),

      // Natal Big Three Strip (always visible)
      h("div", { class: "mc-big-three" }, [
        h("div", { class: "mc-trinity-cell" }, [
          h("span", { class: "mc-trinity-k mc-dim", text: "☉ Sun" }),
          h("span", { class: "mc-trinity-v", text: findBodyText(0) }),
        ]),
        h("div", { class: "mc-trinity-cell" }, [
          h("span", { class: "mc-trinity-k mc-dim", text: "☽ Moon" }),
          h("span", { class: "mc-trinity-v", text: findBodyText(1) }),
        ]),
        h("div", { class: "mc-trinity-cell" }, [
          h("span", { class: "mc-trinity-k mc-dim", text: "↑ Ascendant" }),
          h("span", { class: "mc-trinity-v", text: ascText }),
        ]),
      ]),

      // Live Horizon Dignity Banner
      h(
        "div",
        {
          class: "mc-horizon-banner" + (tel.horizonDignity.exalted ? " is-exalted" : ""),
        },
        [
          h("div", { class: "mc-horizon-headline", text: tel.horizonDignity.headline }),
          h("div", { class: "mc-horizon-detail mc-dim", text: tel.horizonDignity.detail }),
        ]
      ),

      sealsRow,

      // Mobile-only expand stats toggle
      h(
        "button",
        {
          type: "button",
          class: "mc-mobile-stats-toggle",
          text: this.mobileStatsExpanded ? "▴ Collapse Seeker Telemetry" : "▾ Inspect Ratings, Diamond & Natal Chart",
          onClick: () => {
            this.mobileStatsExpanded = !this.mobileStatsExpanded;
            if (this.dom.root) {
              this.dom.root.classList.toggle("is-stats-expanded", this.mobileStatsExpanded);
            }
            this.paint();
          },
        }
      ),
    ]);

    // First-Class Inline Tab Bar: Observatory | Natal & Decans
    const tabBar = h("div", { class: "mc-zone-tabs", role: "tablist" }, [
      h("button", {
        type: "button",
        role: "tab",
        "aria-selected": String(this.leftTab === "observatory"),
        class: "mc-zone-tab" + (this.leftTab === "observatory" ? " is-active" : ""),
        text: "✦ Observatory",
        onClick: () => {
          if (this.leftTab === "observatory") return;
          this.leftTab = "observatory";
          this._audioSynth.triggerAstrolabeDetent(340);
          this.paint();
        },
      }),
      h("button", {
        type: "button",
        role: "tab",
        "aria-selected": String(this.leftTab === "natal"),
        class: "mc-zone-tab" + (this.leftTab === "natal" ? " is-active" : ""),
        text: "♈ Natal & Decans",
        onClick: () => {
          if (this.leftTab === "natal") return;
          this.leftTab = "natal";
          this._audioSynth.triggerAstrolabeDetent(390);
          this.paint();
        },
      }),
    ]);

    const tabBody = h("div", { class: "mc-zone-left-scroll" });
    if (this.leftTab === "observatory") {
      tabBody.appendChild(this._buildObservatoryMetricsPanel(tel, ovrValueEl, ovrDeltaEl, archetypeEl));
    } else {
      this._metricRefs = null;
      tabBody.appendChild(this._chartSection(player.chart));
      tabBody.appendChild(this._decanSection(player.chart));
      tabBody.appendChild(this._lunarNodesSection(analytics.lunarNodes, player.chart));
      tabBody.appendChild(this._analyticsSection(analytics));
      tabBody.appendChild(this._factionSection(player, factionIdx));
    }

    return h("section", { class: "mc-zone mc-zone--left", "aria-label": "Seeker Telemetry and Natal Dossier" }, [
      headerCard,
      tabBar,
      tabBody,
    ]);
  }

  _buildObservatoryMetricsPanel(tel, ovrValueEl, ovrDeltaEl, archetypeEl) {
    const payload = tel.ratedPayload;
    const refs = {
      ovrValueEl,
      ovrDeltaEl,
      archetypeEl,
      diamondPoly: null,
      diamondGhostPoly: null,
      pillarLabelEl: null,
      siegeCells: {},
      sacredRows: {},
    };

    // 1. 4-Point ESMS Alchemical Balance Diamond
    const diamondSvg = svgNode("svg", {
      class: "mc-esms-diamond-svg",
      viewBox: "0 0 200 184",
      role: "img",
      "aria-label": "4-Point ESMS Alchemical Balance Diamond",
    });

    // Outer & mid calibration octagons/diamonds
    diamondSvg.appendChild(
      svgNode("polygon", {
        points: "100,24 168,92 100,160 32,92",
        class: "mc-diamond-grid-outer",
      })
    );
    diamondSvg.appendChild(
      svgNode("polygon", {
        points: "100,58 134,92 100,126 66,92",
        class: "mc-diamond-grid-inner",
      })
    );
    diamondSvg.appendChild(svgNode("line", { x1: 100, y1: 24, x2: 100, y2: 160, class: "mc-diamond-axis" }));
    diamondSvg.appendChild(svgNode("line", { x1: 32, y1: 92, x2: 168, y2: 92, class: "mc-diamond-axis" }));

    const primaryPoly = svgNode("polygon", {
      points: diamondPolygonPoints(tel.esmsDiamond),
      class: "mc-diamond-fill",
    });
    const ghostPoly = svgNode("polygon", {
      points: diamondPolygonPoints(tel.esmsDiamond),
      class: "mc-diamond-ghost",
      style: "opacity: 0",
    });
    refs.diamondPoly = primaryPoly;
    refs.diamondGhostPoly = ghostPoly;
    diamondSvg.appendChild(primaryPoly);
    diamondSvg.appendChild(ghostPoly);

    // Axis labels: Top Spirit, Right Substance, Bottom Matter, Left Essence
    diamondSvg.appendChild(svgNode("text", { x: 100, y: 14, "text-anchor": "middle", class: "mc-diamond-lbl spirit" }, ["🔥 SPIRIT"]));
    diamondSvg.appendChild(svgNode("text", { x: 194, y: 95, "text-anchor": "end", class: "mc-diamond-lbl substance" }, ["💨 AIR"]));
    diamondSvg.appendChild(svgNode("text", { x: 100, y: 177, "text-anchor": "middle", class: "mc-diamond-lbl matter" }, ["🪨 MATTER"]));
    diamondSvg.appendChild(svgNode("text", { x: 6, y: 95, "text-anchor": "start", class: "mc-diamond-lbl essence" }, ["💧 CUPS"]));

    refs.pillarLabelEl = h("span", {
      class: "mc-pillar-badge",
      text: `${tel.pillar.symbol} ${tel.pillar.name} · K ${tel.thermo.kalchm}`,
    });

    const diamondPanel = h("div", { class: "mc-panel mc-obs-card" }, [
      h("div", { class: "mc-obs-card-head" }, [
        h("span", { class: "mc-section-label", text: "Alchemical Balance" }),
        refs.pillarLabelEl,
      ]),
      h("div", { class: "mc-diamond-wrap" }, [diamondSvg]),
    ]);

    // 2. Honest Siege Triad Output (Attack, Health, Armour, Cast Cadence in seconds)
    const buildSiegeCell = (key, label, icon, baseVal, suffix = "") => {
      const valEl = h("span", { class: "mc-siege-stat-val", text: baseVal === null ? "—" : `${baseVal}${suffix}` });
      const deltaEl = h("span", { class: "mc-vernier-delta", text: "" });
      refs.siegeCells[key] = { valEl, deltaEl, suffix };
      return h("div", { class: "mc-siege-cell" }, [
        h("span", { class: "mc-siege-cell-k mc-dim", text: `${icon} ${label}` }),
        h("div", { class: "mc-siege-cell-v-row" }, [valEl, deltaEl]),
      ]);
    };

    const siegePanel = h("div", { class: "mc-panel mc-obs-card" }, [
      h("div", { class: "mc-obs-card-head" }, [
        h("span", { class: "mc-section-label", text: `Siege Triad Output (${tel.siegeOutput.slotCount}/3)` }),
        h("span", {
          class: "mc-dim mc-vel-note",
          text: tel.siegeOutput.mercurialVelocity > 0 ? `☿ Vel ${tel.siegeOutput.mercurialVelocity}` : "Select up to 3 cards",
        }),
      ]),
      h("div", { class: "mc-siege-grid" }, [
        buildSiegeCell("attack", "Attack", "⚔", tel.siegeOutput.attack),
        buildSiegeCell("health", "Health", "♥", tel.siegeOutput.health),
        buildSiegeCell("armour", "Armour", "🛡", tel.siegeOutput.armour),
        buildSiegeCell("cadenceSec", "Cast Cadence", "⏳", tel.siegeOutput.cadenceSec, "s"),
      ]),
    ]);

    // 3. Centralized Sacred 7 Ratings [25–99] with Brass Vernier Hairlines & Surge Meter
    const sacredList = h("div", { class: "mc-sacred-bars" });
    for (const key of SACRED_STAT_KEYS) {
      const val = payload.ratings[key];
      const rel = payload.relativeAdvantage[key];
      const pct = ((val - 25) / (99 - 25)) * 100;

      const fillEl = h("div", {
        class: "mc-sacred-fill",
        style: {
          width: `${Math.max(2, Math.min(100, pct)).toFixed(1)}%`,
          background: SACRED_BAR_COLORS[key] || "var(--ac-gold)",
        },
      });
      const vernierBarEl = h("div", { class: "mc-vernier-hairline", style: { opacity: "0" } });
      const valNumEl = h("span", { class: "mc-sacred-val", text: String(val) });
      const deltaTagEl = h("span", { class: "mc-vernier-delta", text: "" });

      refs.sacredRows[key] = { fillEl, vernierBarEl, valNumEl, deltaTagEl };

      sacredList.appendChild(
        h("div", { class: "mc-sacred-row" }, [
          h("div", { class: "mc-sacred-head" }, [
            h("span", { class: "mc-sacred-lbl", text: `${SACRED_ICONS[key]} ${SACRED_STAT_LABELS[key]}` }),
            h("div", { class: "mc-sacred-nums" }, [
              rel !== 0
                ? h("span", {
                    class: "mc-rel-pill" + (rel > 0 ? " is-pos" : " is-neg"),
                    title: "Relative Advantage vs Seeker Mean",
                    text: rel > 0 ? `+${rel}` : String(rel),
                  })
                : null,
              valNumEl,
              deltaTagEl,
            ]),
          ]),
          h("div", { class: "mc-sacred-track" }, [fillEl, vernierBarEl]),
        ])
      );
    }

    const surge = payload.surge;
    const surgeRow = h("div", { class: "mc-surge-strip" + (surge.active ? " is-active" : "") }, [
      h("div", { class: "mc-surge-top" }, [
        h("span", {
          class: "mc-surge-title",
          text: surge.active ? `✦ ${surge.label} Active (95–99 Gate Open)` : "Kalchm Resonance Surge",
        }),
        h("span", { class: "mc-surge-pct", text: `${surge.meter}%` }),
      ]),
      h("div", { class: "mc-surge-track" }, [
        h("div", { class: "mc-surge-fill", style: { width: `${Math.min(100, Math.max(0, surge.meter))}%` } }),
        h("div", { class: "mc-surge-gate-tick", style: { left: "70%" }, title: "70% Astronomical Surge Threshold" }),
      ]),
    ]);

    const sacredPanel = h("div", { class: "mc-panel mc-obs-card" }, [
      h("div", { class: "mc-obs-card-head" }, [
        h("span", { class: "mc-section-label", text: "Sacred 7 Vessel Ratings" }),
        h("span", { class: "mc-dim mc-scale-note", text: "25–99 Scale" }),
      ]),
      sacredList,
      surgeRow,
    ]);

    this._metricRefs = refs;
    const container = h("div", { class: "mc-obs-stack" }, [diamondPanel, siegePanel, sacredPanel]);
    return container;
  }

  // ── Zone 2 (Center): Coaxial 3D Seeker Vessel & Natal Astrolabe Stage ──
  _buildZoneCenter(player) {
    const quickActions = h("div", { class: "mc-center-quickbar" }, [
      this.hooks.onTip
        ? h("button", {
            type: "button",
            class: "mc-action-pill",
            text: "⚖ Faction War",
            title: "Deploy your garrison on the live Faction War board",
            onClick: () => this.hooks.onTip(planetIdxOf(player.faction)),
          })
        : null,
      this.hooks.onVessel
        ? h("button", {
            type: "button",
            class: "mc-action-pill",
            text: "⚗ Alchm Vessel",
            title: "Open your cross-app ESMS elemental treasury",
            onClick: () => this.hooks.onVessel(),
          })
        : null,
      h("button", {
        type: "button",
        class: "mc-action-pill",
        text: "📋 Coordinates",
        title: "Copy your astrological signature coordinates",
        onClick: () => this._copyCoordinates(player),
      }),
    ]);

    return h("section", { class: "mc-zone mc-zone--center", "aria-label": "Seeker 3D Astral Observatory" }, [
      this.dom.stageHost,
      quickActions,
    ]);
  }

  // ── Zone 3 (Right): 3-Card Siege Loadout, Crucible Fusion & Celestial Deck ──
  _buildZoneRight(collection, deck, chart) {
    const st = this._stateOf();
    const factionIdx = planetIdxOf(st?.player?.faction);
    const selectedSet = st?.selectedCards instanceof Set ? st.selectedCards : new Set();
    const siegeIds = [...selectedSet].slice(0, 3);

    // Count duplicate groups eligible for Crucible Fusion
    const dupeCounts = new Map();
    for (const c of collection) {
      const sig = cardDupeSignature(c);
      dupeCounts.set(sig, (dupeCounts.get(sig) || 0) + 1);
    }
    let fusablePairCount = 0;
    for (const count of dupeCounts.values()) {
      if (count >= 2) fusablePairCount += Math.floor(count / 2);
    }

    // 1. 3-Card Siege Loadout Cradles (I · II · III)
    const slotsGrid = h("div", { class: "mc-siege-slots-row" });
    for (let i = 0; i < 3; i++) {
      const cid = siegeIds[i];
      const rawCard = cid !== undefined ? collection.find((c) => Number(c.card_id) === Number(cid)) : null;
      const isTargeted = this.activeSlotIndex === i;

      if (rawCard) {
        const norm = normalizeTarotCard(rawCard);
        const att = evaluateCardNatalAttunement(rawCard, chart, factionIdx);
        slotsGrid.appendChild(
          h(
            "div",
            {
              class: "mc-siege-slot is-filled" + (isTargeted ? " is-targeted" : ""),
              style: { borderColor: norm.isMajor ? "var(--ac-gold-bright)" : norm.suitColor },
              role: "button",
              tabindex: "0",
              title: "Click to target this Siege slot for replacement, or ✕ to unslot",
              onPointerenter: () => {
                this._triggerBrushOnce(`slot-${norm.cardId}`);
              },
              onClick: () => {
                this.activeSlotIndex = this.activeSlotIndex === i ? null : i;
                this._audioSynth.triggerAstrolabeDetent(320 + i * 35);
                this.paint();
              },
            },
            [
              h("div", { class: "mc-siege-slot-top" }, [
                h("span", { class: "mc-slot-numeral", text: ROMAN_SLOTS[i] }),
                h("button", {
                  type: "button",
                  class: "mc-slot-remove",
                  text: "✕",
                  title: "Remove from Siege Hand",
                  "aria-label": `Unslot ${norm.title}`,
                  onClick: (e) => {
                    e.stopPropagation();
                    this._toggleSiegeCard(norm.cardId);
                  },
                }),
              ]),
              h("div", { class: "mc-siege-slot-glyph", style: { color: norm.planetColor }, text: norm.isMajor ? norm.planetGlyph : norm.suitGlyph }),
              h("div", { class: "mc-siege-slot-title", text: norm.title }),
              h("div", { class: "mc-siege-slot-meta mc-dim", text: `⚔${norm.attack ?? 0} ♥${norm.health ?? 0} · Lv${norm.level}` }),
              att.attuned
                ? h("div", { class: "mc-attune-chip", title: `${att.label} (1.15x Harmonic Attunement)`, text: `${att.glyph} 1.15×` })
                : null,
            ]
          )
        );
      } else {
        slotsGrid.appendChild(
          h(
            "button",
            {
              type: "button",
              class: "mc-siege-slot is-empty" + (isTargeted ? " is-targeted" : ""),
              onClick: () => {
                this.activeSlotIndex = this.activeSlotIndex === i ? null : i;
                this._audioSynth.triggerAstrolabeDetent(300 + i * 30);
                this.paint();
              },
            },
            [
              h("span", { class: "mc-slot-numeral", text: ROMAN_SLOTS[i] }),
              h("span", { class: "mc-slot-plus", text: isTargeted ? "✦" : "+" }),
              h("span", { class: "mc-slot-hint mc-dim", text: isTargeted ? "Pick Card Below" : "Empty Cradle" }),
            ]
          )
        );
      }
    }

    // 2. Crucible Duplicate Fusion Bar
    const anchorCard =
      this.fuseAnchorCardId !== null
        ? collection.find((c) => Number(c.card_id) === Number(this.fuseAnchorCardId))
        : null;

    const crucibleBar = h("div", { class: "mc-crucible-bar" + (this.fuseMode ? " is-active" : "") }, [
      h("button", {
        type: "button",
        class: "mc-crucible-toggle" + (this.fuseMode ? " is-active" : ""),
        text: this.fuseMode
          ? "✕ Exit Crucible Alignment"
          : `⚗ Fuse Duplicate Cards (${fusablePairCount})`,
        onClick: () => {
          this.fuseMode = !this.fuseMode;
          this.fuseAnchorCardId = null;
          this._clearCardHover();
          this._audioSynth.triggerAstrolabeDetent(this.fuseMode ? 432 : 290);
          this.paint();
        },
      }),
      this.fuseMode
        ? h("div", { class: "mc-crucible-instruction mc-dim" }, [
            h("span", {
              text: anchorCard
                ? `Anchor: ${anchorCard.title} (Lv ${anchorCard.level || 1}) — hover & click matching copy to fuse into Lv ${(anchorCard.level || 1) + 1}.`
                : fusablePairCount > 0
                  ? "Select a highlighted duplicate card to anchor the Alchemical Crucible."
                  : "No duplicate pairs in your collection yet — win duels or mint packs to gather copies.",
            }),
          ])
        : null,
    ]);

    const siegeHeader = h("div", { class: "mc-panel mc-siege-header-panel" }, [
      h("div", { class: "mc-obs-card-head" }, [
        h("span", { class: "mc-section-label", text: "Tarot Siege Loadout (3 Cards)" }),
        h("button", {
          type: "button",
          class: "mc-mobile-drawer-btn",
          text: this.mobileDrawerOpen ? "▾ Close Deck Tray" : `▴ Open Deck (${collection.length})`,
          onClick: () => {
            this.mobileDrawerOpen = !this.mobileDrawerOpen;
            this.paint();
          },
        }),
      ]),
      slotsGrid,
      crucibleBar,
    ]);

    // 3. Container-Responsive Deck Browser
    const deckBrowser = this._deckSection(collection, deck, chart, dupeCounts);

    return h("section", { class: "mc-zone mc-zone--right", "aria-label": "Tarot Siege Loadout and Celestial Deck" }, [
      siegeHeader,
      deckBrowser,
    ]);
  }

  _highlightNatalPlacement(planetNode) {
    this.highlightedBodyIdx = planetNode ? planetNode.bodyIdx : null;
    if (!this.dom.root || typeof this.dom.root.querySelectorAll !== "function") return;
    const cards = this.dom.root.querySelectorAll(".mc-place[data-body-idx]");
    cards.forEach((el) => {
      const match =
        this.highlightedBodyIdx !== null &&
        Number(el.getAttribute("data-body-idx")) === Number(this.highlightedBodyIdx);
      el.classList.toggle("is-astrolabe-focus", match);
    });
  }

  _triggerBrushOnce(hoverKey) {
    if (this._lastHoverCardId === hoverKey) return;
    this._lastHoverCardId = hoverKey;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - this._lastBrushTs >= 42) {
      this._lastBrushTs = now;
      this._audioSynth.triggerCardBrush();
    }
  }

  _handleCardHover(rawCard, collection) {
    const st = this._stateOf();
    if (!st || !this._telemetry || !rawCard) return;

    this._triggerBrushOnce(`card-${rawCard.card_id}`);

    let previewAction = null;
    if (this.fuseMode) {
      const anchor =
        this.fuseAnchorCardId !== null
          ? collection.find((c) => Number(c.card_id) === Number(this.fuseAnchorCardId))
          : null;
      if (
        anchor &&
        Number(anchor.card_id) !== Number(rawCard.card_id) &&
        cardDupeSignature(anchor) === cardDupeSignature(rawCard)
      ) {
        const keepCard = (anchor.level || 1) >= (rawCard.level || 1) ? anchor : rawCard;
        const consumeCard = keepCard === anchor ? rawCard : anchor;
        previewAction = { mode: "fuse", keepCard, consumeCard };
      } else {
        // Preview what fusing this card with its twin would yield if a twin exists
        const twin = collection.find(
          (c) =>
            Number(c.card_id) !== Number(rawCard.card_id) &&
            cardDupeSignature(c) === cardDupeSignature(rawCard)
        );
        if (twin) {
          const keepCard = (rawCard.level || 1) >= (twin.level || 1) ? rawCard : twin;
          const consumeCard = keepCard === rawCard ? twin : rawCard;
          previewAction = { mode: "fuse", keepCard, consumeCard };
        }
      }
    } else {
      previewAction = {
        mode: "slot",
        card: rawCard,
        slotIndex: this.activeSlotIndex,
      };
    }

    if (!previewAction) return;
    const preview = computeSeekerPreview(this._telemetry, st, previewAction, this._liveEsms);
    if (!preview) return;

    this._applyVernierPreview(preview);
    this._vesselStage?.updateTelemetry(this._telemetry, preview);
  }

  _clearCardHover() {
    this._lastHoverCardId = null;
    if (!this._telemetry) return;
    this._applyVernierPreview(null);
    this._vesselStage?.updateTelemetry(this._telemetry, null);
  }

  _applyDiamondSpring(vals) {
    if (!this._metricRefs?.diamondPoly) return;
    this._metricRefs.diamondPoly.setAttribute("points", diamondPolygonPoints(vals));
  }

  /**
   * Updates Zone 1's brass vernier hairline projections & Ghost Deltas in-place
   * without panel bounce or DOM teardown.
   */
  _applyVernierPreview(preview) {
    const refs = this._metricRefs;
    const base = this._telemetry;
    if (!refs || !base) return;

    if (!preview) {
      refs.ovrValueEl.textContent = String(base.ratedPayload.ovr);
      refs.ovrDeltaEl.textContent = "";
      refs.ovrDeltaEl.className = "mc-vernier-delta mc-ovr-delta";
      refs.archetypeEl.textContent = base.ratedPayload.archetype.title;

      if (refs.diamondGhostPoly) {
        refs.diamondGhostPoly.style.opacity = "0";
      }
      this._spring.setTargets(base.esmsDiamond);

      for (const [k, cell] of Object.entries(refs.siegeCells)) {
        const v = base.siegeOutput[k];
        cell.valEl.textContent = v === null ? "—" : `${v}${cell.suffix}`;
        cell.deltaEl.textContent = "";
        cell.deltaEl.className = "mc-vernier-delta";
      }

      for (const key of SACRED_STAT_KEYS) {
        const row = refs.sacredRows[key];
        if (!row) continue;
        row.valNumEl.textContent = String(base.ratedPayload.ratings[key]);
        row.deltaTagEl.textContent = "";
        row.deltaTagEl.className = "mc-vernier-delta";
        row.vernierBarEl.style.opacity = "0";
      }
      return;
    }

    const projPayload = preview.projected.ratedPayload;
    refs.ovrValueEl.textContent = String(projPayload.ovr);
    if (preview.ovrDelta !== 0) {
      const isGain = preview.ovrDelta > 0;
      refs.ovrDeltaEl.textContent = isGain ? `+${preview.ovrDelta}` : String(preview.ovrDelta);
      refs.ovrDeltaEl.className = "mc-vernier-delta mc-ovr-delta " + (isGain ? "is-gain" : "is-tradeoff");
    } else {
      refs.ovrDeltaEl.textContent = "";
      refs.ovrDeltaEl.className = "mc-vernier-delta mc-ovr-delta";
    }
    refs.archetypeEl.textContent = projPayload.archetype.title;

    // Dashed ivory/gold hover ghost polygon on the 4-Point ESMS Diamond
    if (refs.diamondGhostPoly) {
      refs.diamondGhostPoly.setAttribute("points", diamondPolygonPoints(preview.projected.esmsDiamond));
      refs.diamondGhostPoly.style.opacity = "1";
    }

    // Siege Triad Vernier Deltas (note: for cadenceSec, negative delta = faster cast = gain)
    for (const [k, cell] of Object.entries(refs.siegeCells)) {
      const nextVal = preview.projected.siegeOutput[k];
      cell.valEl.textContent = nextVal === null ? "—" : `${nextVal}${cell.suffix}`;
      const d = preview.siegeDeltas[k];
      if (d !== null && d !== undefined && d !== 0) {
        const isGain = k === "cadenceSec" ? d < 0 : d > 0;
        const sign = d > 0 ? "+" : "";
        cell.deltaEl.textContent = `${sign}${d}${cell.suffix}`;
        cell.deltaEl.className = "mc-vernier-delta " + (isGain ? "is-gain" : "is-tradeoff");
      } else {
        cell.deltaEl.textContent = "";
        cell.deltaEl.className = "mc-vernier-delta";
      }
    }

    // Sacred 7 Brass Vernier Hairlines
    for (const key of SACRED_STAT_KEYS) {
      const row = refs.sacredRows[key];
      if (!row) continue;
      const baseStat = base.ratedPayload.ratings[key];
      const nextStat = projPayload.ratings[key];
      const delta = preview.sacredDeltas[key];

      row.valNumEl.textContent = String(nextStat);
      if (delta !== 0) {
        const isGain = delta > 0;
        row.deltaTagEl.textContent = isGain ? `+${delta}` : String(delta);
        row.deltaTagEl.className = "mc-vernier-delta " + (isGain ? "is-gain" : "is-tradeoff");

        const p0 = ((Math.min(baseStat, nextStat) - 25) / 74) * 100;
        const p1 = ((Math.max(baseStat, nextStat) - 25) / 74) * 100;
        row.vernierBarEl.style.left = `${Math.max(0, Math.min(100, p0)).toFixed(1)}%`;
        row.vernierBarEl.style.width = `${Math.max(1.2, Math.min(100 - p0, p1 - p0)).toFixed(1)}%`;
        row.vernierBarEl.className = "mc-vernier-hairline " + (isGain ? "is-gain" : "is-tradeoff");
        row.vernierBarEl.style.opacity = "1";
      } else {
        row.deltaTagEl.textContent = "";
        row.deltaTagEl.className = "mc-vernier-delta";
        row.vernierBarEl.style.opacity = "0";
      }
    }
  }

  _refreshTelemetryInPlace() {
    const st = this._stateOf();
    if (!st || !st.player?.chart) return;
    this._telemetry = computeSeekerTelemetry({ state: st, esmsOverride: this._liveEsms });
    this._applyVernierPreview(null);
    this._spring.setTargets(this._telemetry.esmsDiamond);
    this._vesselStage?.updateTelemetry(this._telemetry, null);
  }

  /**
   * Equips or unslots a card in the 3-Card Siege Loadout (`state.selectedCards`),
   * ensuring the card is also in the 8-card Active Hand when possible.
   */
  _toggleSiegeCard(cardId, explicitSlotIdx = null) {
    const st = this._stateOf();
    if (!st) return;
    const idNum = Number(cardId);
    if (!(st.selectedCards instanceof Set)) {
      st.selectedCards = new Set(Array.isArray(st.selectedCards) ? st.selectedCards : []);
    }

    const currentIds = [...st.selectedCards].map(Number);
    const existingIdx = currentIds.indexOf(idNum);

    if (existingIdx >= 0 && explicitSlotIdx === null) {
      currentIds.splice(existingIdx, 1);
      st.selectedCards = new Set(currentIds);
      this._audioSynth.triggerAstrolabeDetent(260);
    } else {
      const targetSlot =
        explicitSlotIdx !== null
          ? explicitSlotIdx
          : this.activeSlotIndex !== null
            ? this.activeSlotIndex
            : null;

      if (existingIdx < 0) {
        if (targetSlot !== null && targetSlot >= 0 && targetSlot < 3) {
          if (targetSlot < currentIds.length) {
            currentIds[targetSlot] = idNum;
          } else {
            currentIds.push(idNum);
          }
        } else if (currentIds.length < 3) {
          currentIds.push(idNum);
        } else {
          currentIds[2] = idNum;
        }
      }
      st.selectedCards = new Set(currentIds.slice(0, 3));
      this.activeSlotIndex = null;

      // Ensure equipped Siege card is in 'active' deck loadout if under 8-card cap
      const deck = st.deck || [];
      const slotEntry = deck.find((d) => Number(d.card_id) === idNum);
      if (!slotEntry || slotEntry.loadout !== "active") {
        const activeCount = deck.filter((d) => d.loadout === "active").length;
        if (activeCount < 8) {
          if (slotEntry) slotEntry.loadout = "active";
          else deck.push({ card_id: idNum, loadout: "active" });
          st.deck = deck;
        }
      }

      const cardObj = (st.collection || []).find((c) => Number(c.card_id) === idNum);
      const { def } = cardObj ? resolveCardDefinition(cardObj) : { def: null };
      this._audioSynth.triggerAstrolabeDetent(def?.styling?.audioFrequencyHz || 352);
    }

    if (typeof st.save === "function") {
      try { st.save(); } catch {}
    }
    if (typeof window !== "undefined" && typeof window.renderActiveHand === "function") {
      try { window.renderActiveHand(); } catch {}
    }

    this._lastHoverCardId = null;
    this.paint();
  }

  /**
   * Executes Duplicate Card Fusion in the Alchemical Crucible:
   * updates local GameState, invokes SpacetimeDB `combine_cards` when live,
   * and triggers warm Pythagorean fifth resonance on CourtAudioSynth.
   */
  _executeCardFusion(cardA, cardB) {
    const st = this._stateOf();
    if (!st || !cardA || !cardB) return false;
    if (Number(cardA.card_id) === Number(cardB.card_id)) return false;
    if (cardDupeSignature(cardA) !== cardDupeSignature(cardB)) return false;

    const keepCard = (Number(cardA.level) || 1) >= (Number(cardB.level) || 1) ? cardA : cardB;
    const consumeCard = keepCard === cardA ? cardB : cardA;
    const keepId = Number(keepCard.card_id);
    const consumeId = Number(consumeCard.card_id);

    const { def } = resolveCardDefinition(keepCard);
    const baseHz = def?.styling?.audioFrequencyHz || 432;

    if (typeof st.fuseCards === "function") {
      st.fuseCards(keepId, consumeId);
    } else {
      // Pure fallback for lightweight test states without client.js::fuseCards
      const prevMult = levelMultiplier(keepCard.level || 1);
      keepCard.level = (Number(keepCard.level) || 1) + 1;
      const nextMult = levelMultiplier(keepCard.level);
      const ratio = nextMult / prevMult;
      keepCard.attack = Math.round((Number(keepCard.attack) || 0) * ratio);
      keepCard.health = Math.round((Number(keepCard.health) || 0) * ratio);
      keepCard.armour = Math.round((Number(keepCard.armour) || 0) * ratio);
      st.collection = (st.collection || []).filter((c) => Number(c.card_id) !== consumeId);
      st.deck = (st.deck || []).filter((d) => Number(d.card_id) !== consumeId);
      if (st.selectedCards instanceof Set && st.selectedCards.has(consumeId)) {
        st.selectedCards.delete(consumeId);
        st.selectedCards.add(keepId);
      }
      if (typeof st.save === "function") {
        try { st.save(); } catch {}
      }
    }

    // Invoke live SpacetimeDB combine_cards reducer if connected
    const net =
      typeof window !== "undefined" && window.Pentacles && window.Pentacles.net
        ? window.Pentacles.net
        : null;
    if (net && net.isLive && typeof net.callReducer === "function") {
      net.callReducer("combine_cards", [keepId, consumeId]).catch((err) => {
        console.warn("[MyPentacles] combine_cards reducer warning:", err);
      });
    }

    this._audioSynth.triggerCrucibleHarmonic(baseHz);

    if (typeof window !== "undefined") {
      window.renderActiveHand?.();
      window.renderCollection?.();
      window.toast?.(
        `⚗ Crucible Fusion: ${keepCard.title} ascended to Lv ${keepCard.level}!`,
        { type: "success" }
      );
    }

    this.fuseAnchorCardId = null;
    this._lastHoverCardId = null;
    this.paint();
    return true;
  }

  _cleanupInspector() {
    if (this._inspectorEl && this._inspectorEl.parentNode) {
      this._inspectorEl.parentNode.removeChild(this._inspectorEl);
    }
    this._inspectorEl = null;
  }

  _copyCoordinates(player) {
    if (!player || !player.chart) return;
    const placements = (player.chart.placements || []).map((p) => {
      const b = PLANET_NAMES[planetIdxOf(p.body)] || p.body;
      const s = SIGN_NAMES[Number(p.sign) || 0] || p.sign;
      const deg = Math.floor((Number(p.arc_minutes) || 0) / 60);
      return `${b}: ${s} ${deg}°${p.retrograde ? " (Rx)" : ""}`;
    }).join(", ");
    const text = `Pentacles Seeker [${player.handle || "Seeker"}] | Faction: ${PLANET_NAMES[planetIdxOf(player.faction)]} | OVR: ${this._telemetry?.ratedPayload?.ovr ?? "—"} | Chart Placements: ${placements}`;

    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        if (typeof window !== "undefined" && window.toast) {
          window.toast("Seeker celestial coordinates copied to clipboard!", { type: "success" });
        }
      });
    }
  }

  _trophy(v, label) {
    return h("div", { class: "mc-trophy" }, [
      h("span", { class: "mc-trophy-v", text: v.toLocaleString() }),
      h("span", { class: "mc-trophy-k mc-dim", text: label }),
    ]);
  }

  // ── Natal chart: Asc/MC + placements ──
  _chartSection(chart) {
    const wrap = h("div", { class: "mc-panel" });
    const timeKnown = chart.time_known !== false;
    wrap.appendChild(h("div", { class: "mc-panel-head" }, [
      h("span", { class: "mc-section-label", text: "Natal Chart Placements" }),
      h("div", { class: "mc-angles" }, timeKnown
        ? [this._angle("ASC", Number(chart.ascendant) || 0), this._angle("MC", Number(chart.midheaven) || 0)]
        : [h("span", { class: "mc-solar", text: "birth time unknown · solar chart" })]),
    ]));
    const grid = h("div", { class: "mc-placements" });
    const placements = (chart.placements || []).slice().sort((a, b) => planetIdxOf(a.body) - planetIdxOf(b.body));
    for (const p of placements) {
      const bi = planetIdxOf(p.body);
      const sign = Number(p.sign) || 0;
      const deg = Math.floor((Number(p.arc_minutes) || 0) / 60);
      const dig = dignityChip(Number(p.dignity) || 0);
      const isFocused = this.highlightedBodyIdx !== null && Number(this.highlightedBodyIdx) === bi;
      grid.appendChild(h("div", {
        class: "mc-place" + (isFocused ? " is-astrolabe-focus" : ""),
        "data-body-idx": String(bi),
      }, [
        h("div", { class: "mc-place-top" }, [
          h("span", { class: "mc-place-glyph", style: { color: PLANET_COLORS[bi] }, text: PLANET_GLYPHS[bi] }),
          h("span", { class: "mc-place-pos mc-dim", text: `${SIGN_GLYPHS[sign]} ${deg}°${p.retrograde ? "℞" : ""}` }),
        ]),
        h("div", { class: "mc-place-name", text: PLANET_NAMES[bi] }),
        dig ? h("span", { class: "mc-dignity mc-dignity--" + dig.c, text: dig.t }) : h("span", { class: "mc-dim mc-dignity--none", text: "peregrine" }),
      ]));
    }
    wrap.appendChild(grid);
    return wrap;
  }

  _angle(label, min) {
    const sign = Math.floor((min / 1800) % 12), deg = Math.floor((min % 1800) / 60);
    return h("div", { class: "mc-angle" }, [
      h("span", { class: "mc-angle-k mc-dim", text: label }),
      h("span", { class: "mc-angle-v", text: `${SIGN_GLYPHS[sign]} ${deg}°` }),
    ]);
  }

  // ── Categorical Chart Analytics (Elements & Modalities) ──
  _analyticsSection(analytics) {
    const wrap = h("div", { class: "mc-panel" });
    wrap.appendChild(h("div", { class: "mc-panel-head" }, [
      h("span", { class: "mc-section-label", text: "Categorical Chart Analytics" }),
      h("span", { class: "mc-dim", text: `${analytics.elements.dominant.toUpperCase()} · ${analytics.modalities.dominant.toUpperCase()}` }),
    ]));

    const grid = h("div", { class: "mc-analytics-grid" });
    const elemCol = h("div", { class: "mc-analytics-col" }, [
      h("div", { class: "mc-analytics-title", text: "Elemental Triplicities" }),
      h("div", { class: "mc-bar-wrap" }, [
        this._metricBar("Fire", analytics.elements.fire, "#cf4d4d", "🔥"),
        this._metricBar("Earth", analytics.elements.earth, "#74ab6c", "🌍"),
        this._metricBar("Air", analytics.elements.air, "#aebbd6", "💨"),
        this._metricBar("Water", analytics.elements.water, "#5f93d8", "🌊"),
      ]),
    ]);
    grid.appendChild(elemCol);

    const modCol = h("div", { class: "mc-analytics-col" }, [
      h("div", { class: "mc-analytics-title", text: "Modalities & Polarities" }),
      h("div", { class: "mc-bar-wrap" }, [
        this._metricBar("Cardinal", analytics.modalities.cardinal, "#e8b84b", "⚡"),
        this._metricBar("Fixed", analytics.modalities.fixed, "#d98fb0", "🏛"),
        this._metricBar("Mutable", analytics.modalities.mutable, "#5fb6c4", "🌀"),
      ]),
      h("div", { class: "mc-polarity-row mc-dim" }, [
        h("span", { text: `Yang ${analytics.polarities.yang}% · Yin ${analytics.polarities.yin}%` }),
        h("span", { text: ` · ${analytics.diurnal ? "Diurnal ☉" : "Nocturnal ☽"}` }),
      ]),
    ]);
    grid.appendChild(modCol);
    wrap.appendChild(grid);
    return wrap;
  }

  _metricBar(label, pct, color, icon) {
    return h("div", { class: "mc-metric-row" }, [
      h("span", { class: "mc-metric-label", text: `${icon} ${label}` }),
      h("div", { class: "mc-metric-track" }, [
        h("div", { class: "mc-metric-fill", style: { width: `${Math.min(100, Math.max(0, pct))}%`, background: color } }),
      ]),
      h("span", { class: "mc-metric-val mc-dim", text: `${pct}%` }),
    ]);
  }

  // ── Lunar Nodes (Karmic Axis) ──
  _lunarNodesSection(nodes, chart) {
    const wrap = h("div", { class: "mc-panel" });
    wrap.appendChild(h("div", { class: "mc-panel-head" }, [
      h("span", { class: "mc-section-label", text: "Lunar Nodes · Karmic Axis" }),
      h("span", { class: "mc-dim", text: "Caput & Cauda Draconis" }),
    ]));

    const grid = h("div", { class: "mc-nodes-grid" });
    const nn = (chart && chart.north_node) || nodes.northNode;
    const nnDeg = Math.floor(((Number(nn.arc_minutes || nn.arcMin) || 0) % 1800) / 60);
    grid.appendChild(h("div", { class: "mc-node-card north" }, [
      h("div", { class: "mc-node-head" }, [
        h("span", { class: "mc-node-glyph", text: "☊" }),
        h("div", {}, [
          h("div", { class: "mc-node-name", text: "North Node · Destiny Vector" }),
          h("div", { class: "mc-dim mc-node-sub", text: "Caput Draconis / Rahu" }),
        ]),
      ]),
      h("div", { class: "mc-node-pos", text: `${SIGN_GLYPHS[nn.sign]} ${SIGN_NAMES[nn.sign]} ${nnDeg}°` }),
    ]));

    const sn = (chart && chart.south_node) || nodes.southNode;
    const snDeg = Math.floor(((Number(sn.arc_minutes || sn.arcMin) || 0) % 1800) / 60);
    grid.appendChild(h("div", { class: "mc-node-card south" }, [
      h("div", { class: "mc-node-head" }, [
        h("span", { class: "mc-node-glyph", text: "☋" }),
        h("div", {}, [
          h("div", { class: "mc-node-name", text: "South Node · Karmic Origin" }),
          h("div", { class: "mc-dim mc-node-sub", text: "Cauda Draconis / Ketu" }),
        ]),
      ]),
      h("div", { class: "mc-node-pos", text: `${SIGN_GLYPHS[sn.sign]} ${SIGN_NAMES[sn.sign]} ${snDeg}°` }),
    ]));

    wrap.appendChild(grid);
    return wrap;
  }

  // ── Celestial Deck Browser (Zone 3 Scrollable Container) ──
  _deckSection(collection, deck, chart, dupeCounts = null) {
    const activeCount = deck.filter((d) => d.loadout === "active").length;
    const defenseCount = deck.filter((d) => d.loadout === "defense").length;
    const benchCount = Math.max(0, collection.length - activeCount - defenseCount);

    const wrap = h("div", { class: "mc-panel mc-deck-panel" });
    wrap.appendChild(h("div", { class: "mc-obs-card-head" }, [
      h("span", { class: "mc-section-label", text: `Celestial Deck (${collection.length})` }),
      h("div", { class: "mc-deck-counts" }, [
        h("span", { class: "mc-deck-pill active", text: `Active ${activeCount}/8` }),
        h("span", { class: "mc-deck-pill defense", text: `Def ${defenseCount}` }),
      ]),
    ]));

    const gridHost = h("div", { class: "mc-deck-browser-host" });
    const renderFilteredGrid = () => {
      clear(gridHost);
      gridHost.appendChild(this._buildFilteredDeckContent(collection, deck, chart, dupeCounts));
    };

    const filterBar = h("div", { class: "mc-filter-bar" }, [
      h("div", { class: "mc-filter-chips" }, [
        this._filterChip("all", `✦ All (${collection.length})`),
        this._filterChip("active", `⚔ Active (${activeCount}/8)`),
        this._filterChip("defense", `🛡 Def (${defenseCount})`),
        this._filterChip("bench", `📦 Bench (${benchCount})`),
        this._filterChip("majors", "⭐ Majors"),
        this._filterChip("minors", "🃏 Minors"),
      ]),
      h("div", { class: "mc-deck-search" }, [
        h("input", {
          class: "mc-deck-input",
          type: "text",
          placeholder: "Search cards by name, suit, letter...",
          value: this.cardSearchQuery,
          onInput: (e) => {
            this.cardSearchQuery = e.target.value;
            renderFilteredGrid();
          },
        }),
      ]),
    ]);

    wrap.appendChild(filterBar);
    renderFilteredGrid();
    wrap.appendChild(gridHost);
    return wrap;
  }

  _buildFilteredDeckContent(collection, deck, chart, dupeCounts) {
    const loadoutMap = new Map(deck.map((d) => [Number(d.card_id), d.loadout || "bench"]));
    const query = this.cardSearchQuery.trim().toLowerCase();
    const counts = dupeCounts || (() => {
      const m = new Map();
      for (const c of collection) {
        const sig = cardDupeSignature(c);
        m.set(sig, (m.get(sig) || 0) + 1);
      }
      return m;
    })();

    const filtered = [];
    for (const c of collection) {
      const l = loadoutMap.get(Number(c.card_id)) || "bench";
      if (this.deckFilter === "active" && l !== "active") continue;
      if (this.deckFilter === "defense" && l !== "defense") continue;
      if (this.deckFilter === "bench" && l !== "bench") continue;
      if (this.deckFilter === "majors" && !c.is_major) continue;
      if (this.deckFilter === "minors" && c.is_major) continue;

      if (query) {
        const title = (c.title || "").toLowerCase();
        const suit = (c.suit || "").toLowerCase();
        const letter = (c.letter || "").toLowerCase();
        if (!title.includes(query) && !suit.includes(query) && !letter.includes(query)) {
          continue;
        }
      }

      const sig = cardDupeSignature(c);
      const isFusable = (counts.get(sig) || 0) >= 2;
      if (this.fuseMode && !isFusable) continue;

      filtered.push({ ...c, currentLoadout: l, isFusable });
    }

    if (filtered.length === 0) {
      return h("div", { class: "mc-dim mc-col-empty", text: this.fuseMode ? "No fusable duplicate cards match this filter." : "No cards match this filter." });
    }

    // Sort attuned & higher-level cards first for ergonomic deckbuilding
    const st = this._stateOf();
    const factionIdx = planetIdxOf(st?.player?.faction);
    const grid = h("div", {
      class: "mc-observatory-card-grid",
      onPointerleave: () => this._clearCardHover(),
    });

    for (const c of filtered) {
      grid.appendChild(this._card(c, collection, chart, factionIdx));
    }
    return grid;
  }

  _filterChip(key, label) {
    const isActive = this.deckFilter === key;
    return h("button", {
      type: "button",
      class: "mc-chip" + (isActive ? " active" : ""),
      text: label,
      onClick: () => {
        this.deckFilter = key;
        this._audioSynth.triggerCardBrush();
        this.paint();
      },
    });
  }

  _card(rawCard, collection = [], chart = null, factionIdx = 0) {
    const st = this._stateOf();
    const card = normalizeTarotCard(rawCard, rawCard.currentLoadout || "bench");
    const isMajor = card.isMajor;
    const l = card.loadout;
    const isInSiege = st?.selectedCards instanceof Set && st.selectedCards.has(Number(card.cardId));
    const isFuseAnchor = this.fuseMode && Number(this.fuseAnchorCardId) === Number(card.cardId);

    let isMatchingTwin = false;
    if (this.fuseMode && this.fuseAnchorCardId !== null && !isFuseAnchor) {
      const anchor = collection.find((c) => Number(c.card_id) === Number(this.fuseAnchorCardId));
      if (anchor && cardDupeSignature(anchor) === cardDupeSignature(rawCard)) {
        isMatchingTwin = true;
      }
    }

    const attunement = chart ? evaluateCardNatalAttunement(rawCard, chart, factionIdx) : null;

    const cls =
      "mc-card mc-card--" +
      card.suitKey +
      (isMajor ? " mc-card--major" : "") +
      (card.isInverted ? " mc-card--inv" : "") +
      ` is-loadout-${l}` +
      (isInSiege ? " is-siege-equipped" : "") +
      (rawCard.isFusable ? " is-fusable" : "") +
      (isFuseAnchor ? " is-fuse-anchor" : "") +
      (isMatchingTwin ? " is-fuse-target" : "");

    const cardArtSrc = card.artAsset || null;
    let artEl;

    if (isMajor) {
      const sigilFallback = h("div", { class: "mc-card-major-sigil", style: cardArtSrc ? { display: "none" } : {} }, [
        h("div", { class: "sigil-ring sigil-ring-outer" }),
        h("div", { class: "sigil-ring sigil-ring-inner" }),
        h("span", { class: "sigil-glyph", text: card.planetGlyph }),
      ]);
      const imgEl = cardArtSrc ? h("img", {
        class: "mc-card-suit-art mc-card-major-art",
        src: cardArtSrc,
        alt: `${card.title} art`,
        loading: "lazy",
      }) : null;
      if (imgEl) {
        imgEl.onerror = () => {
          imgEl.style.display = "none";
          sigilFallback.style.display = "flex";
        };
      }
      artEl = h("div", { class: "mc-card-art major-art" }, [
        h("div", { class: "mc-card-art-frame major-frame" }, [
          imgEl,
          sigilFallback,
          h("div", { class: "mc-card-major-tag", text: card.planetName }),
        ]),
      ]);
    } else {
      const imgEl = cardArtSrc ? h("img", {
        class: "mc-card-suit-art",
        src: cardArtSrc,
        alt: `${card.title} art`,
        loading: "lazy",
      }) : null;
      const fallbackEl = h("div", {
        class: "mc-card-art-fallback",
        style: cardArtSrc ? { display: "none", color: card.suitColor } : { display: "flex", color: card.suitColor },
      }, [
        h("div", { class: "mc-card-major-sigil" }, [
          h("div", { class: "sigil-ring sigil-ring-outer", style: { borderColor: `${card.suitColor}55` } }),
          h("div", { class: "sigil-ring sigil-ring-inner", style: { borderColor: `${card.suitColor}88` } }),
          h("span", { class: "sigil-glyph", style: { color: card.suitColor }, text: card.suitGlyph }),
        ]),
        h("div", { class: "mc-card-major-tag", style: { color: card.suitColor }, text: `${card.signGlyph} ${card.suitElement}` }),
      ]);
      if (imgEl) {
        imgEl.onerror = () => {
          imgEl.style.display = "none";
          fallbackEl.style.display = "flex";
        };
      }
      artEl = h("div", { class: "mc-card-art" }, [
        h("div", { class: "mc-card-art-frame", style: { borderColor: `${card.suitColor}44` } }, imgEl ? [imgEl, fallbackEl] : [fallbackEl]),
      ]);
    }

    const handleCardPrimaryActivate = () => {
      if (this.fuseMode) {
        if (this.fuseAnchorCardId === null) {
          this.fuseAnchorCardId = Number(card.cardId);
          this._audioSynth.triggerAstrolabeDetent(380);
          this.paint();
          return;
        }
        if (Number(this.fuseAnchorCardId) === Number(card.cardId)) {
          this.fuseAnchorCardId = null;
          this.paint();
          return;
        }
        const anchor = collection.find((c) => Number(c.card_id) === Number(this.fuseAnchorCardId));
        if (anchor && cardDupeSignature(anchor) === cardDupeSignature(rawCard)) {
          this._executeCardFusion(anchor, rawCard);
          return;
        }
        this.fuseAnchorCardId = Number(card.cardId);
        this._audioSynth.triggerAstrolabeDetent(380);
        this.paint();
        return;
      }

      // If user clicked a Siege Cradle first, clicking any card slots it directly
      if (this.activeSlotIndex !== null) {
        this._toggleSiegeCard(card.cardId, this.activeSlotIndex);
        return;
      }

      this.inspectedCard = rawCard;
      this.inspectorFlipped = false;
      this.paint();
    };

    const quickActionBtn = h("button", {
      type: "button",
      class:
        "mc-card-quick-btn" +
        (this.fuseMode ? " is-fuse" : isInSiege ? " is-equipped" : ""),
      text: this.fuseMode
        ? isFuseAnchor
          ? "✦ Anchor"
          : isMatchingTwin
            ? "⚗ Fuse Lv+1"
            : "⚗ Select"
        : isInSiege
          ? "✓ Siege"
          : "⚔ Equip",
      title: this.fuseMode
        ? "Fuse matching card copies in the Crucible"
        : isInSiege
          ? "Remove from 3-card Siege Hand"
          : "Equip into 3-card Siege Hand",
      onClick: (e) => {
        e.stopPropagation();
        if (this.fuseMode) {
          handleCardPrimaryActivate();
        } else {
          this._toggleSiegeCard(card.cardId);
        }
      },
    });

    const ariaLabel = `${card.title}, ${card.subline}${card.attack !== null ? `, Attack ${card.attack}` : ""}${card.health !== null ? `, Health ${card.health}` : ""}`;

    return h("div", {
      class: cls,
      style: isMajor ? null : { borderColor: card.suitColor },
      role: "button",
      tabindex: "0",
      "aria-label": ariaLabel,
      onPointerenter: () => this._handleCardHover(rawCard, collection),
      onFocus: () => this._handleCardHover(rawCard, collection),
      onBlur: () => this._clearCardHover(),
      onClick: handleCardPrimaryActivate,
      onKeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardPrimaryActivate();
        }
      },
    }, [
      h("div", { class: "mc-card-top" }, [
        h("span", { class: "mc-card-rank-badge mc-dim", text: card.rankCorner }),
        attunement?.attuned
          ? h("span", { class: "mc-card-attune-dot", title: `${attunement.label} (1.15x)`, text: attunement.glyph })
          : h("span", { class: "mc-card-loadout-tag " + l, text: l.toUpperCase() }),
        h("span", { class: "mc-card-glyph-badge", style: { color: card.planetColor }, text: card.suitGlyph }),
      ]),
      h("div", { class: "mc-card-header" }, [
        h("div", { class: "mc-card-title", text: card.title }),
        h("div", { class: "mc-card-subline mc-dim", text: card.subline }),
      ]),
      artEl,
      h("div", { class: "mc-card-stats" }, [
        h("span", { title: "attack", text: `⚔ ${card.attack !== null ? card.attack : "—"}` }),
        h("span", { title: "health", text: `♥ ${card.health !== null ? card.health : "—"}` }),
        h("span", { title: "armour", text: `🛡 ${card.armour !== null ? card.armour : "—"}` }),
      ]),
      h("div", { class: "mc-card-foot mc-dim" }, [
        h("span", { style: { color: card.planetColor }, text: `${card.planetGlyph} Lv ${card.level}` }),
        card.letter ? h("span", { class: "mc-card-letter", text: String(card.letter) }) : null,
        quickActionBtn,
      ]),
    ]);
  }

  _getCardDefinition(suitKey, rank, isMajor) {
    const suit = isMajor ? "major" : (suitKey || "wands");
    const r = Number(rank !== undefined && rank !== null ? rank : 0);
    const key = `${suit}:${r}`;
    if (this._cardDefCache.has(key)) {
      return this._cardDefCache.get(key);
    }
    const def = getCard(suit, r);
    if (def) this._cardDefCache.set(key, def);
    return def || null;
  }

  _getSkyTransit() {
    const st = this._stateOf();
    if (!st) return null;
    if (st.ephemeris && Array.isArray(st.ephemeris)) {
      const sun = st.ephemeris.find((e) => e.body === 0 || e.body === "Sun");
      if (sun) {
        return typeof sun.ra === "number" ? sun.ra : ((Number(sun.transiting_zone) || 0) % 12) * 30;
      }
    }
    if (st.player?.chart) {
      return (Number(st.player.chart.ascendant) || 0) / 60;
    }
    return 0;
  }

  _renderInspectorStatBars(cardDef, kineticScore) {
    const isPlanetary = this.inspectorStatTab === "planetary12";
    const axes = isPlanetary ? [
      { k: "Solar Agency", v: cardDef.planetaryStats?.solarAgency || 50, col: "#e8b84b", g: "☉" },
      { k: "Lunar Receptivity", v: cardDef.planetaryStats?.lunarReceptivity || 50, col: "#cbd0db", g: "☽" },
      { k: "Mercurial Velocity", v: cardDef.planetaryStats?.mercurialVelocity || 50, col: "#9aa7c4", g: "☿" },
      { k: "Venusian Coherence", v: cardDef.planetaryStats?.venusianCoherence || 50, col: "#d98fb0", g: "♀" },
      { k: "Martial Impetus", v: cardDef.planetaryStats?.martialImpetus || 50, col: "#cf4d4d", g: "♂" },
      { k: "Jovian Expansion", v: cardDef.planetaryStats?.jovianExpansion || 50, col: "#cf9a52", g: "♃" },
      { k: "Saturnian Structure", v: cardDef.planetaryStats?.saturnianStructure || 50, col: "#9a937c", g: "♄" },
      { k: "Chironic Adaptation", v: cardDef.planetaryStats?.chironicAdaptation || 50, col: "#40c057", g: "⚷" },
      { k: "Uranian Surprisal", v: cardDef.planetaryStats?.uranianSurprisal || 50, col: "#5fb6c4", g: "♅" },
      { k: "Neptunian Resonance", v: cardDef.planetaryStats?.neptunianResonance || 50, col: "#6470c8", g: "♆" },
      { k: "Plutonic Integration", v: cardDef.planetaryStats?.plutonicIntegration || 50, col: "#8a6aa0", g: "♇" },
      { k: "Kinetic Alignment", v: kineticScore, col: "#f1dba1", g: "⚡" },
    ] : [
      { k: "Power", v: cardDef.sacredStats?.power || 50, col: "#cf4d4d", g: "⚔" },
      { k: "Resonance", v: cardDef.sacredStats?.resonance || 50, col: "#5fb6c4", g: "✦" },
      { k: "Wisdom", v: cardDef.sacredStats?.wisdom || 50, col: "#e8b84b", g: "📜" },
      { k: "Charisma", v: cardDef.sacredStats?.charisma || 50, col: "#d98fb0", g: "✨" },
      { k: "Intuition", v: cardDef.sacredStats?.intuition || 50, col: "#6470c8", g: "👁" },
      { k: "Adaptability", v: cardDef.sacredStats?.adaptability || 50, col: "#40c057", g: "🌀" },
      { k: "Vitality", v: cardDef.sacredStats?.vitality || 50, col: "#cf9a52", g: "♥" },
    ];

    return h("div", { class: "mc-stat-bars" }, axes.map((a) => h("div", { class: "mc-stat-bar-row" }, [
      h("span", { class: "mc-stat-bar-label", text: `${a.g} ${a.k}` }),
      h("div", { class: "mc-stat-bar-track" }, [
        h("div", { class: "mc-stat-bar-fill", style: { width: `${Math.min(100, Math.max(5, a.v))}%`, background: a.col } }),
      ]),
      h("span", { class: "mc-stat-bar-val", text: String(a.v) }),
    ])));
  }

  _renderAffinityBadges(cardDef) {
    const affinityVec = cardDef.planetaryAffinity || [];
    return h("div", { class: "mc-affinity-section" }, [
      h("div", { class: "mc-affinity-title", text: "✦ Planetary Dignity Affinities" }),
      h("div", { class: "mc-affinity-grid" }, PLANET_NAMES.map((name, i) => {
        const score = affinityVec[i] ?? 0;
        const isDom = score >= 5;
        const isExa = score === 4;
        const cls = "mc-affinity-badge" + (isDom ? " is-domicile" : (isExa ? " is-exaltation" : ""));
        return h("div", { class: cls, title: `${name}: +${score} dignity (${isDom ? "Domicile +5" : (isExa ? "Exaltation +4" : "Affinity")})` }, [
          h("span", { class: "badge-glyph", style: { color: PLANET_COLORS[i] }, text: PLANET_GLYPHS[i] }),
          h("span", { class: "badge-name", text: name }),
          h("span", { class: "badge-score", text: score > 0 ? `+${score}` : "0" }),
        ]);
      })),
    ]);
  }

  // ── Card Inspector Popover Modal (Preserves exact 3D Flipper Contract) ──
  _cardInspectorModal(c, deck, _collection) {
    const st = this._stateOf();
    const card = normalizeTarotCard(c);
    const isMajor = card.isMajor;
    const currentLoadout = (deck.find((d) => Number(d.card_id) === Number(c.card_id)) || {}).loadout || "bench";
    const isInSiege = st?.selectedCards instanceof Set && st.selectedCards.has(Number(c.card_id));
    const cardDef = this._getCardDefinition(card.suitKey, card.rank, isMajor);
    const transit = this._getSkyTransit();
    const kineticScore = cardDef ? kineticAlignment(cardDef, transit) : 50;

    const artKey = isMajor ? `major:${card.rank}` : `${card.suitKey}:${card.rank}`;
    const specificArt = card.artAsset || (SHIPPED_CARD_ART[artKey] || null);
    const artSrc = specificArt || null;

    // --- FRONT SIDE: Maximized Tarot Card Art ---
    const sigilFallback = h("div", { class: "mc-card-major-sigil", style: artSrc ? { display: "none" } : {} }, [
      h("div", { class: "sigil-ring sigil-ring-outer", style: isMajor ? {} : { borderColor: `${card.suitColor}55` } }),
      h("div", { class: "sigil-ring sigil-ring-inner", style: isMajor ? {} : { borderColor: `${card.suitColor}88` } }),
      h("span", { class: "sigil-glyph", style: isMajor ? { color: card.planetColor } : { color: card.suitColor }, text: isMajor ? card.planetGlyph : card.suitGlyph }),
    ]);
    const frontImg = artSrc ? h("img", {
      class: "mc-inspector-full-art",
      src: artSrc,
      alt: `${card.title} art`,
      title: "Click to flip card and view stats",
    }) : null;
    if (frontImg) {
      frontImg.onerror = () => {
        frontImg.style.display = "none";
        sigilFallback.style.display = "flex";
      };
    }

    const frontSide = h("div", { class: "mc-inspector-side mc-inspector-side--front" }, [
      h("button", {
        class: "mc-inspector-close",
        text: "✕",
        "aria-label": "Close",
        onClick: (e) => { e.stopPropagation(); this.inspectedCard = null; this.inspectorFlipped = false; this.paint(); },
      }),
      h("div", { class: "mc-inspector-front-header" }, [
        isMajor
          ? h("span", { class: "mc-inspector-glyph", style: { color: card.planetColor }, text: card.planetGlyph })
          : (card.suitArtSrc
              ? h("img", { class: "mc-inspector-suit-icon", src: card.suitArtSrc, alt: card.suitName })
              : h("span", { class: "mc-inspector-glyph", style: { color: card.planetColor }, text: card.suitGlyph })),
        h("div", { class: "mc-inspector-front-title-wrap" }, [
          h("div", { class: "mc-inspector-title", text: card.title }),
          h("div", { class: "mc-inspector-sub mc-dim", text: `${card.subline} · ${card.planetName} Ruled` }),
        ]),
      ]),
      h("div", {
        class: "mc-inspector-front-stage",
        onClick: () => { this.inspectorFlipped = true; this.paint(); },
        title: "Click to flip card to view stats and assign loadout",
      }, [
        h("div", { class: "mc-inspector-art-wrapper", style: "width:100%; height:100%; display:flex; align-items:center; justify-content:center; position:relative;" }, frontImg ? [frontImg, sigilFallback] : [sigilFallback]),
      ]),
      h("div", { class: "mc-inspector-front-footer" }, [
        h("button", {
          class: "mc-flip-btn",
          onClick: (e) => { e.stopPropagation(); this.inspectorFlipped = true; this.paint(); },
          title: "Flip card to view stats and assign loadout",
        }, [
          h("span", { class: "mc-flip-icon", text: "↺" }),
          h("span", { text: "View Stats & Loadout" }),
        ]),
      ]),
    ]);

    // --- BACK SIDE: Comprehensive Card Stats & Controls ---
    const backSide = h("div", { class: "mc-inspector-side mc-inspector-side--back" }, [
      h("button", {
        class: "mc-inspector-close",
        text: "✕",
        "aria-label": "Close",
        onClick: (e) => { e.stopPropagation(); this.inspectedCard = null; this.inspectorFlipped = false; this.paint(); },
      }),
      h("div", { class: "mc-inspector-back-header" }, [
        h("button", {
          class: "mc-flip-back-btn",
          onClick: () => { this.inspectorFlipped = false; this.paint(); },
          title: "Flip back to card art",
        }, [
          h("span", { class: "mc-flip-icon", text: "↺" }),
          h("span", { text: "View Card Art" }),
        ]),
        h("div", { class: "mc-inspector-back-title-wrap" }, [
          isMajor
            ? h("span", { class: "mc-inspector-glyph", style: { color: card.planetColor }, text: card.planetGlyph })
            : h("span", { class: "mc-inspector-glyph", style: { color: card.planetColor }, text: card.suitGlyph }),
          h("span", { class: "mc-inspector-back-title", text: card.title }),
        ]),
      ]),
      h("div", { class: "mc-inspector-back-body" }, [
        cardDef ? h("div", { class: "mc-transit-resonance" }, [
          h("div", { class: "mc-transit-resonance-label" }, [
            h("span", { text: "⚡" }),
            h("span", { text: "Celestial Transit Resonance" }),
          ]),
          h("div", { class: "mc-transit-resonance-score", text: `${kineticScore}% · ${kineticScore >= 80 ? "Harmonious Peak" : (kineticScore >= 60 ? "Resonant" : "Attuned")}` }),
        ]) : null,

        cardDef ? h("div", { class: "mc-inspector-tabs" }, [
          h("button", {
            class: "mc-inspector-tab" + (this.inspectorStatTab === "planetary12" ? " is-active" : ""),
            text: "✦ Planetary 12",
            onClick: () => { this.inspectorStatTab = "planetary12"; this.paint(); },
          }),
          h("button", {
            class: "mc-inspector-tab" + (this.inspectorStatTab === "sacred7" ? " is-active" : ""),
            text: "⬡ Sacred 7",
            onClick: () => { this.inspectorStatTab = "sacred7"; this.paint(); },
          }),
        ]) : null,

        cardDef ? this._renderInspectorStatBars(cardDef, kineticScore) : null,
        cardDef ? this._renderAffinityBadges(cardDef) : null,

        h("div", { class: "mc-inspector-stats-grid" }, [
          h("div", { class: "mc-inspector-stat" }, [
            h("span", { class: "mc-stat-k mc-dim", text: "Attack Power" }),
            h("span", { class: "mc-stat-v", text: `⚔ ${c.attack || 0}` }),
          ]),
          h("div", { class: "mc-inspector-stat" }, [
            h("span", { class: "mc-stat-k mc-dim", text: "Health / Vitality" }),
            h("span", { class: "mc-stat-v", text: `♥ ${c.health || 0}` }),
          ]),
          h("div", { class: "mc-inspector-stat" }, [
            h("span", { class: "mc-stat-k mc-dim", text: "Defense Armour" }),
            h("span", { class: "mc-stat-v", text: `🛡 ${c.armour || 0}` }),
          ]),
          h("div", { class: "mc-inspector-stat" }, [
            h("span", { class: "mc-stat-k mc-dim", text: "Arcana Level" }),
            h("span", { class: "mc-stat-v", text: `Lv ${c.level || 1}` }),
          ]),
        ]),

        h("div", { class: "mc-inspector-lore mc-dim" }, [
          h("p", {
            text: isMajor
              ? `Archetypal vector aligned with ${PLANET_NAMES[c.source_body] || "the Cosmos"}. Holds sovereign priority over minor suits in battle tricks.`
              : `Astrological minor arcana pip derived from natal decan degrees. Imbued with tile letter '${c.letter || "✦"}' for word duel synthesis.`,
          }),
        ]),

        h("div", { class: "mc-inspector-loadout-section" }, [
          h("div", { class: "mc-inspector-loadout-label", text: "Assign Card Loadout Slot:" }),
          h("div", { class: "mc-inspector-loadout-buttons" }, [
            h("button", {
              class: "mc-loadout-btn siege-btn" + (isInSiege ? " is-current" : ""),
              text: isInSiege ? "✓ Equipped in 3-Card Siege Triad (Click to Unslot)" : "✦ Equip in 3-Card Siege Triad",
              onClick: () => {
                this.inspectedCard = null;
                this.inspectorFlipped = false;
                this._toggleSiegeCard(c.card_id);
              },
            }),
            h("button", {
              class: "mc-loadout-btn active-btn" + (currentLoadout === "active" ? " is-current" : ""),
              text: currentLoadout === "active" ? "✓ Active Hand (In Battle)" : "⚔ Set to Active Hand (Max 8)",
              onClick: () => this._setCardLoadout(c.card_id, "active"),
            }),
            h("button", {
              class: "mc-loadout-btn defense-btn" + (currentLoadout === "defense" ? " is-current" : ""),
              text: currentLoadout === "defense" ? "✓ Defense Garrison" : "🛡 Set to Defense Garrison",
              onClick: () => this._setCardLoadout(c.card_id, "defense"),
            }),
            h("button", {
              class: "mc-loadout-btn bench-btn" + (currentLoadout === "bench" ? " is-current" : ""),
              text: currentLoadout === "bench" ? "✓ In Bench Reserve" : "📦 Move to Bench Reserve",
              onClick: () => this._setCardLoadout(c.card_id, "bench"),
            }),
          ]),
        ]),
      ]),
    ]);

    return h("div", {
      class: "mc-inspector-overlay",
      onClick: (e) => {
        if (e.target.classList.contains("mc-inspector-overlay")) {
          this.inspectedCard = null;
          this.inspectorFlipped = false;
          this.paint();
        }
      },
    }, [
      h("div", { class: "mc-inspector-flipper-container" }, [
        h("div", { class: "mc-inspector-flipper" + (this.inspectorFlipped ? " is-flipped" : "") }, [
          frontSide,
          backSide,
        ]),
      ]),
    ]);
  }

  _setCardLoadout(cardId, newLoadout) {
    const st = this._stateOf();
    if (!st) return;
    let deck = st.deck || [];
    const collection = st.collection || [];
    const cardIdNum = Number(cardId);

    // Enforce max 8 active cards limit
    if (newLoadout === "active") {
      const activeCount = deck.filter((d) => d.loadout === "active" && Number(d.card_id) !== cardIdNum).length;
      if (activeCount >= 8) {
        if (typeof window !== "undefined" && window.toast) {
          window.toast("Active hand is full (maximum 8 cards). Move a card to Defense or Bench first.", { type: "warn" });
        }
        return;
      }
    }

    const existingIdx = deck.findIndex((d) => Number(d.card_id) === cardIdNum);
    const prevLoadout = existingIdx >= 0 ? deck[existingIdx].loadout : "bench";
    if (existingIdx >= 0) {
      deck[existingIdx].loadout = newLoadout;
    } else {
      deck.push({ card_id: cardIdNum, loadout: newLoadout });
    }
    st.deck = deck;

    if (typeof st.save === "function") {
      try { st.save(); } catch {}
    }
    if (typeof window !== "undefined" && window.renderActiveHand) {
      try { window.renderActiveHand(); } catch {}
    }

    const card = collection.find((c) => Number(c.card_id) === cardIdNum);
    const title = card ? (card.title || "Card") : "Card";

    // Call live SpacetimeDB set_loadout reducer if connected
    const net = (typeof window !== "undefined" && window.Pentacles && window.Pentacles.net) ? window.Pentacles.net : null;
    if (net && net.isLive && typeof net.callReducer === "function") {
      const variant = newLoadout.toLowerCase();
      net.callReducer("set_loadout", [cardIdNum, { [variant]: [] }])
        .catch((err) => {
          console.warn("[MyPentacles] set_loadout reducer failed, rolling back:", err);
          if (existingIdx >= 0) {
            deck[existingIdx].loadout = prevLoadout;
          } else {
            const rollbackIdx = deck.findIndex((d) => Number(d.card_id) === cardIdNum);
            if (rollbackIdx >= 0) deck.splice(rollbackIdx, 1);
          }
          st.deck = deck;
          if (typeof st.save === "function") {
            try { st.save(); } catch {}
          }
          if (typeof window !== "undefined" && window.renderActiveHand) {
            try { window.renderActiveHand(); } catch {}
          }
          if (typeof window !== "undefined" && window.toast) {
            window.toast(`Failed to update loadout on server: ${err?.message || err}`, { type: "error" });
          }
          this.paint();
        });
    }

    this._audioSynth.triggerAstrolabeDetent(330);
    if (typeof window !== "undefined" && window.toast) {
      window.toast(`${title} assigned to ${newLoadout.toUpperCase()} loadout.`, { type: "success" });
    }

    this.inspectedCard = null;
    if (this.dom.root) {
      this.paint();
    }
  }

  // ── Decan cards: the astrological pips (derived from the chart placements) ──
  _decanSection(chart) {
    const wrap = h("div", { class: "mc-panel" });
    wrap.appendChild(h("div", { class: "mc-section-label", text: "Golden Dawn Decan Cards" }));
    wrap.appendChild(h("div", { class: "mc-dim mc-decan-note", text: "Your placement-by-degree Minor Arcana — the Hermetic root of your deck." }));
    const grid = h("div", { class: "mc-decan-grid" });
    const placements = (chart.placements || []).slice().sort((a, b) => planetIdxOf(a.body) - planetIdxOf(b.body));
    for (const p of placements) {
      const bi = planetIdxOf(p.body);
      const sign = Number(p.sign) || 0;
      const deg = (Number(p.arc_minutes) || 0) / 60;
      const dc = decanCard(sign, deg);
      const scol = SUIT_COLORS[dc.suit] || "var(--ac-gold)";
      grid.appendChild(h("div", { class: "mc-decan", style: { borderColor: scol } }, [
        h("div", { class: "mc-decan-top" }, [
          SUIT_ART[dc.suit]
            ? h("img", { class: "mc-decan-suit-art", src: SUIT_ART[dc.suit], alt: dc.suit })
            : h("span", { class: "mc-decan-glyph", style: { color: scol }, text: SUIT_GLYPHS[dc.suit] || "✦" }),
          h("span", { class: "mc-decan-card", style: { color: scol }, text: `${dc.rank} of ${dc.suit}` }),
        ]),
        h("div", { class: "mc-decan-lord", text: dc.title || "" }),
        h("div", { class: "mc-decan-sub mc-dim" }, [
          h("span", { style: { color: PLANET_COLORS[bi] }, text: `${PLANET_GLYPHS[bi]} ` }),
          h("span", { text: `${SIGN_GLYPHS[sign]} ${Math.floor(deg)}°${p.retrograde ? "℞" : ""}` }),
          h("span", { class: "mc-decan-ruler", style: { color: PLANET_COLORS[dc.ruler] }, text: ` · ${PLANET_GLYPHS[dc.ruler]}` }),
        ]),
      ]));
    }
    wrap.appendChild(grid);
    return wrap;
  }

  // ── Faction allegiance + war contribution ──
  _factionSection(player, factionIdx) {
    const col = PLANET_COLORS[factionIdx] || "var(--ac-gold)";
    const kitchenUrl = `https://agents.alchm.kitchen/profile?agent=${encodeURIComponent(player.handle || "seeker")}&faction=${factionIdx}`;
    const wrap = h("div", { class: "mc-panel mc-allegiance" });
    wrap.appendChild(h("div", { class: "mc-section-label", text: "Allegiance & Dossier" }));
    wrap.appendChild(h("div", { class: "mc-alleg-hero" }, [
      h("span", { class: "mc-medallion", style: { color: col, borderColor: col }, text: PLANET_GLYPHS[factionIdx] || "✦" }),
      h("div", {}, [
        h("div", { class: "mc-alleg-name", text: `Faction ${PLANET_NAMES[factionIdx]}` }),
        h("div", { class: "mc-dim", text: PASSIVE[factionIdx] }),
      ]),
    ]));
    wrap.appendChild(h("div", { class: "mc-contrib" }, [
      this._trophy(Number(player.word_wins) || 0, "duel wins"),
      this._trophy(Number(player.tokens) || 0, "tokens staked"),
    ]));
    wrap.appendChild(h("div", { class: "mc-head-actions", style: { marginTop: "10px" } }, [
      this.hooks.onTip ? h("button", {
        class: "mc-cta mc-tip",
        style: { marginTop: "0" },
        text: "⚖ Tip the Scales",
        onClick: () => this.hooks.onTip(factionIdx),
      }) : null,
      h("a", {
        class: "mc-kitchen-btn",
        href: kitchenUrl,
        target: "_blank",
        rel: "noopener noreferrer",
        text: "agents.alchm.kitchen/profile ↗",
      }),
    ]));
    return wrap;
  }

  _destroyVesselStage() {
    if (this._vesselStage) {
      this._vesselStage.destroy();
      this._vesselStage = null;
    }
    this.dom.stageHost = null;
  }

  destroy() {
    this._cleanupInspector();
    if (this._walletUnsub) {
      try { this._walletUnsub(); } catch {}
      this._walletUnsub = null;
    }
    if (this._spring) {
      this._spring.dispose();
    }
    this._destroyVesselStage();
    if (this._audioSynth) {
      this._audioSynth.dispose();
    }
    if (this.el) clear(this.el);
  }
}

export function create(opts) { return new MyPentaclesInstance(opts); }
export const version = "0.3.0";
const MyPentacles = { create, version, MyPentaclesInstance };
export { MyPentacles, MyPentacles as MyCodex, MyPentaclesInstance as MyCodexInstance };
export default MyPentacles;
if (typeof window !== "undefined") {
  window.MyPentacles = MyPentacles;
  window.MyCodex = MyPentacles; // Backward-compatibility alias
}
