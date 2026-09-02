/* ============================================================
   My Pentacles — the player's own profile and celestial deck
   ============================================================
   Framework-agnostic like FactionWar. Renders the local player's sealed natal
   chart, minted deck (Active / Defense / Bench loadouts), decan cards, and
   faction allegiance — all from the live client GameState (window.state):
     • player          → handle, faction, tokens, word_wins, chart
     • collection      → full Card rows
     • deck            → [{card_id, loadout}]  (active|defense|bench)
   The decan pips are derived from the chart placements with the same Golden
   Dawn mapping the server uses (decans.js), matching the on-chain truth.

   Includes interactive deck management (loadout switcher), card inspection,
   filtering, and direct planetary dossier integration.

     const pentacles = MyPentacles.create({ el, hooks:{ onTip, onForge } })
     pentacles.mount(); … pentacles.destroy()
   ============================================================ */
import { h, clear } from "./dom.js";
import { decanCard } from "./decans.js";
import { SUIT_GLYPHS, SUIT_COLORS, SUIT_ART, rankName, MAJOR_NUMERALS, MAJOR_NAMES, ARCANA_NUMERALS, ARCANA_NAMES } from "./deck.js";
import { normalizeTarotCard } from "./card-model.js";
import { categoricalChartAnalytics } from "./sign-character.js";

const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const PLANET_COLORS = ["#e8b84b", "#cbd0db", "#9aa7c4", "#d98fb0", "#cf4d4d", "#cf9a52", "#9a937c", "#5fb6c4", "#6470c8", "#8a6aa0"];
const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const SIGN_ELEMENTS = ["Fire", "Earth", "Air", "Water", "Fire", "Earth", "Air", "Water", "Fire", "Earth", "Air", "Water"];

// One-line faction doctrine (mirrors faction-war.js PASSIVE / server combat passives).
const PASSIVE = [
  "Radiance — vitality and command", "Tides — intuition and reach", "Quicksilver — cunning and signal",
  "Concord — harmony and allure", "Onslaught — +attack, breaks armour", "Expansion — fortune and momentum",
  "Endurance — +health, holds longest", "Upheaval — sudden reversals", "Dissolution — mist and illusion",
  "Transformation — depth and ruin",
];

const suitCap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "Wands");
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
  }

  mount(el) {
    if (el) this.el = el;
    if (!this.el) throw new Error("MyPentacles.mount: no element");
    clear(this.el);
    this.el.classList.add("alchm-pentacles", "alchm-codex");
    this.dom.root = h("div", { class: "mc-root" });
    this.el.appendChild(this.dom.root);
    this.paint();
    return this;
  }

  /** Re-read the live GameState and re-render (called on open + on demand). */
  paint() {
    const st = this._stateOf();
    if (st && st.player && typeof st.ensureStarterDeck === "function") {
      st.ensureStarterDeck();
    }
    const player = st && st.player;
    const root = this.dom.root;
    if (!root) return;
    clear(root);

    if (!player || !player.chart) {
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

    const ascMin = Number(player.chart.ascendant) || 0;
    const mcMin = Number(player.chart.midheaven) || 0;
    const timeKnown = player.chart.time_known !== false;
    const analytics = categoricalChartAnalytics(player.chart.placements || [], ascMin, mcMin, timeKnown);

    root.appendChild(this._header(player, factionIdx));
    root.appendChild(this._chartSection(player.chart));
    root.appendChild(this._analyticsSection(analytics));
    root.appendChild(this._lunarNodesSection(analytics.lunarNodes, player.chart));
    root.appendChild(this._deckSection(collection, deck, player.chart));
    root.appendChild(this._decanSection(player.chart));
    root.appendChild(this._factionSection(player, factionIdx));

    // If a card is currently selected for inspection, render the modal
    if (this.inspectedCard) {
      root.appendChild(this._cardInspectorModal(this.inspectedCard, deck, collection));
    }
  }

  // ── Seeker header ──
  _header(player, factionIdx) {
    const col = PLANET_COLORS[factionIdx] || "var(--ac-gold)";
    const kitchenUrl = `https://agents.alchm.kitchen/profile?agent=${encodeURIComponent(player.handle || "seeker")}&faction=${factionIdx}`;
    
    return h("div", { class: "mc-header" }, [
      h("span", { class: "mc-medallion", style: { color: col, borderColor: col }, text: PLANET_GLYPHS[factionIdx] || "✦" }),
      h("div", { class: "mc-head-id" }, [
        h("div", { class: "mc-handle-row" }, [
          h("span", { class: "mc-handle", text: player.handle || "Seeker" }),
          h("span", { class: "mc-seeker-badge", text: "Sealed Seeker" }),
        ]),
        h("div", { class: "mc-faction" }, [
          h("span", { style: { color: col, fontWeight: "600" }, text: `${PLANET_GLYPHS[factionIdx]} ${PLANET_NAMES[factionIdx]}` }),
          h("span", { class: "mc-dim", text: ` — ${PASSIVE[factionIdx]}` }),
        ]),
      ]),
      h("div", { class: "mc-head-actions" }, [
        h("button", {
          class: "mc-action-pill",
          text: "📋 Copy Coordinates",
          title: "Copy your astrological signature coordinates to clipboard",
          onClick: () => this._copyCoordinates(player),
        }),
        h("a", {
          class: "mc-kitchen-btn",
          href: kitchenUrl,
          target: "_blank",
          rel: "noopener noreferrer",
          text: "agents.alchm.kitchen/profile ↗",
          title: "Inspect your full seeker dossier on Planetary Kitchen"
        }),
      ]),
      h("div", { class: "mc-trophies" }, [
        this._trophy(Number(player.tokens) || 0, "tokens"),
        this._trophy(Number(player.word_wins) || 0, "duel wins"),
      ]),
    ]);
  }

  _copyCoordinates(player) {
    if (!player || !player.chart) return;
    const placements = (player.chart.placements || []).map((p) => {
      const b = PLANET_NAMES[planetIdxOf(p.body)] || p.body;
      const s = SIGN_NAMES[Number(p.sign) || 0] || p.sign;
      const deg = Math.floor((Number(p.arc_minutes) || 0) / 60);
      return `${b}: ${s} ${deg}°${p.retrograde ? " (Rx)" : ""}`;
    }).join(", ");
    const text = `Pentacles Seeker [${player.handle || "Seeker"}] | Faction: ${PLANET_NAMES[planetIdxOf(player.faction)]} | Chart Placements: ${placements}`;
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
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
      grid.appendChild(h("div", { class: "mc-place" }, [
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
      h("span", { class: "mc-dim", text: `Dominant Element: ${analytics.elements.dominant.toUpperCase()} · Mode: ${analytics.modalities.dominant.toUpperCase()}` })
    ]));

    const grid = h("div", { class: "mc-analytics-grid" });

    // 1. Elements
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

    // 2. Modalities & Polarities
    const modCol = h("div", { class: "mc-analytics-col" }, [
      h("div", { class: "mc-analytics-title", text: "Modalities & Polarities" }),
      h("div", { class: "mc-bar-wrap" }, [
        this._metricBar("Cardinal", analytics.modalities.cardinal, "#e8b84b", "⚡"),
        this._metricBar("Fixed", analytics.modalities.fixed, "#d98fb0", "🏛"),
        this._metricBar("Mutable", analytics.modalities.mutable, "#5fb6c4", "🌀"),
      ]),
      h("div", { class: "mc-polarity-row mc-dim" }, [
        h("span", { text: `Yang ${analytics.polarities.yang}% · Yin ${analytics.polarities.yin}%` }),
        h("span", { text: ` · ${analytics.diurnal ? "Diurnal (Day ☉)" : "Nocturnal (Night ☽)"}` }),
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
        h("div", { class: "mc-metric-fill", style: { width: `${Math.min(100, Math.max(0, pct))}%`, background: color } })
      ]),
      h("span", { class: "mc-metric-val mc-dim", text: `${pct}%` }),
    ]);
  }

  // ── Lunar Nodes (Karmic Axis) ──
  _lunarNodesSection(nodes, chart) {
    const wrap = h("div", { class: "mc-panel" });
    wrap.appendChild(h("div", { class: "mc-panel-head" }, [
      h("span", { class: "mc-section-label", text: "Lunar Nodes · Karmic Axis" }),
      h("span", { class: "mc-dim", text: "Caput & Cauda Draconis" })
    ]));

    const grid = h("div", { class: "mc-nodes-grid" });

    // North Node ☊
    const nn = (chart && chart.north_node) || nodes.northNode;
    const nnDeg = Math.floor(((Number(nn.arc_minutes || nn.arcMin) || 0) % 1800) / 60);
    const nnCard = h("div", { class: "mc-node-card north" }, [
      h("div", { class: "mc-node-head" }, [
        h("span", { class: "mc-node-glyph", text: "☊" }),
        h("div", {}, [
          h("div", { class: "mc-node-name", text: "North Node · Destiny Vector" }),
          h("div", { class: "mc-dim mc-node-sub", text: "Caput Draconis / Rahu" }),
        ]),
      ]),
      h("div", { class: "mc-node-pos", text: `${SIGN_GLYPHS[nn.sign]} ${SIGN_NAMES[nn.sign]} ${nnDeg}°` }),
      h("div", { class: "mc-node-desc mc-dim", text: "Aspiration and evolutionary horizon. Your highest creative summit." }),
    ]);
    grid.appendChild(nnCard);

    // South Node ☋
    const sn = (chart && chart.south_node) || nodes.southNode;
    const snDeg = Math.floor(((Number(sn.arc_minutes || sn.arcMin) || 0) % 1800) / 60);
    const snCard = h("div", { class: "mc-node-card south" }, [
      h("div", { class: "mc-node-head" }, [
        h("span", { class: "mc-node-glyph", text: "☋" }),
        h("div", {}, [
          h("div", { class: "mc-node-name", text: "South Node · Karmic Origin" }),
          h("div", { class: "mc-dim mc-node-sub", text: "Cauda Draconis / Ketu" }),
        ]),
      ]),
      h("div", { class: "mc-node-pos", text: `${SIGN_GLYPHS[sn.sign]} ${SIGN_NAMES[sn.sign]} ${snDeg}°` }),
      h("div", { class: "mc-node-desc mc-dim", text: "Innate mastery and foundational memory. The bedrock of your power." }),
    ]);
    grid.appendChild(snCard);

    wrap.appendChild(grid);
    return wrap;
  }

  // ── My Deck: Interactive Loadouts, Filter Chips, Search & Zodiac View ──
  _deckSection(collection, deck, chart) {
    const byId = new Map(collection.map((c) => [Number(c.card_id), c]));
    const loadoutMap = new Map(deck.map((d) => [Number(d.card_id), d.loadout || "bench"]));

    const activeCount = deck.filter((d) => d.loadout === "active").length;
    const defenseCount = deck.filter((d) => d.loadout === "defense").length;
    const benchCount = collection.length - activeCount - defenseCount;

    const wrap = h("div", { class: "mc-panel mc-deck-panel" });
    wrap.appendChild(h("div", { class: "mc-panel-head" }, [
      h("div", { class: "mc-deck-title-group" }, [
        h("span", { class: "mc-section-label", text: "Celestial Pentacles Deck" }),
        h("div", { class: "mc-deck-counts" }, [
          h("span", { class: "mc-deck-pill active", text: `Active Hand: ${activeCount}/8` }),
          h("span", { class: "mc-deck-pill defense", text: `Defense: ${defenseCount}` }),
          h("span", { class: "mc-deck-pill bench", text: `Bench: ${Math.max(0, benchCount)}` }),
          h("span", { class: "mc-deck-pill total", text: `${collection.length} Total Cards` }),
        ]),
      ]),
    ]));

    // Deck Filter Bar & Search
    const filterBar = h("div", { class: "mc-filter-bar" }, [
      h("div", { class: "mc-filter-chips" }, [
        this._filterChip("all", `✦ All (${collection.length})`),
        this._filterChip("active", `⚔ Active Hand (${activeCount}/8)`),
        this._filterChip("defense", `🛡 Defense (${defenseCount})`),
        this._filterChip("bench", `📦 Bench (${Math.max(0, benchCount)})`),
        this._filterChip("majors", `⭐ Majors`),
        this._filterChip("minors", `🃏 Minors`),
      ]),
      h("div", { class: "mc-deck-search" }, [
        h("input", {
          class: "mc-deck-input",
          type: "text",
          placeholder: "Search cards by name, suit, letter...",
          value: this.cardSearchQuery,
          oninput: (e) => {
            this.cardSearchQuery = e.target.value;
            this.paint();
          }
        }),
      ]),
    ]);
    wrap.appendChild(filterBar);

    // Group cards according to filter
    const placementsBySign = Array.from({ length: 12 }, () => []);
    if (chart && chart.placements) {
      for (const p of chart.placements) {
        const sign = Number(p.sign) || 0;
        placementsBySign[sign % 12].push(p);
      }
    }
    
    const ascSign = (chart && chart.ascendant != null && chart.time_known !== false) ? Math.floor((Number(chart.ascendant) / 1800) % 12) : null;
    const mcSign = (chart && chart.midheaven != null && chart.time_known !== false) ? Math.floor((Number(chart.midheaven) / 1800) % 12) : null;

    const cardsBySign = Array.from({ length: 12 }, () => []);
    const query = this.cardSearchQuery.trim().toLowerCase();

    for (const c of collection) {
      const l = loadoutMap.get(Number(c.card_id)) || "bench";
      
      // Filter logic
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

      const signIdx = (c.sign_idx !== undefined && c.sign_idx !== null) ? Number(c.sign_idx) % 12 : 0;
      cardsBySign[signIdx].push({ ...c, currentLoadout: l });
    }

    const grid = h("div", { class: "mc-zodiac-deck-grid" });

    for (let s = 0; s < 12; s++) {
      const cards = cardsBySign[s];
      const placements = placementsBySign[s];
      const isAsc = ascSign === s;
      const isMc = mcSign === s;
      
      const hasPlacements = placements.length > 0 || isAsc || isMc;
      const signCol = h("div", { class: "mc-zodiac-col" + (hasPlacements ? " has-natal" : "") });
      
      const head = h("div", { class: "mc-zodiac-head" }, [
        h("div", { class: "mc-zodiac-title" }, [
          h("span", { class: "mc-zodiac-glyph", text: SIGN_GLYPHS[s] }),
          h("span", { class: "mc-zodiac-name", text: SIGN_NAMES[s] }),
          h("span", { class: "mc-zodiac-elem mc-dim", text: ` · ${SIGN_ELEMENTS[s]}` })
        ]),
        h("span", { class: "mc-zodiac-count mc-dim", text: `${cards.length}` })
      ]);
      signCol.appendChild(head);

      if (hasPlacements) {
        const badges = h("div", { class: "mc-natal-badges" });
        if (isAsc) {
          const deg = Math.floor((Number(chart.ascendant) % 1800) / 60);
          badges.appendChild(h("span", { class: "mc-natal-badge asc", text: `ASC ${deg}°` }));
        }
        if (isMc) {
          const deg = Math.floor((Number(chart.midheaven) % 1800) / 60);
          badges.appendChild(h("span", { class: "mc-natal-badge mc", text: `MC ${deg}°` }));
        }
        for (const p of placements) {
          const bi = planetIdxOf(p.body);
          const deg = Math.floor((Number(p.arc_minutes) || 0) / 60);
          const col = PLANET_COLORS[bi] || "var(--ac-gold)";
          badges.appendChild(h("span", { class: "mc-natal-badge", style: { color: col, borderColor: col }, text: `${PLANET_GLYPHS[bi]} ${PLANET_NAMES[bi]} ${deg}°` }));
        }
        signCol.appendChild(badges);
      }

      const list = h("div", { class: "mc-col-cards" });
      if (cards.length === 0) {
        list.appendChild(h("div", { class: "mc-dim mc-col-empty", text: "—" }));
      } else {
        for (const c of cards) {
          list.appendChild(this._card(c));
        }
      }
      signCol.appendChild(list);

      grid.appendChild(signCol);
    }

    wrap.appendChild(grid);
    return wrap;
  }

  _filterChip(key, label) {
    const isActive = this.deckFilter === key;
    return h("button", {
      class: "mc-chip" + (isActive ? " active" : ""),
      text: label,
      onClick: () => {
        this.deckFilter = key;
        this.paint();
      }
    });
  }

  _card(rawCard) {
    const card = normalizeTarotCard(rawCard, rawCard.currentLoadout || "bench");
    const isMajor = card.isMajor;
    const l = card.loadout;
    const cls = "mc-card mc-card--" + card.suitKey + (isMajor ? " mc-card--major" : "") + (card.isInverted ? " mc-card--inv" : "") + ` is-loadout-${l}`;

    // Art Stage element (45-55% height)
    let artEl;
    if (isMajor) {
      artEl = h("div", { class: "mc-card-art major-art" }, [
        h("div", { class: "mc-card-art-frame major-frame" }, [
          h("div", { class: "mc-card-major-sigil" }, [
            h("div", { class: "sigil-ring sigil-ring-outer" }),
            h("div", { class: "sigil-ring sigil-ring-inner" }),
            h("span", { class: "sigil-glyph", text: card.planetGlyph }),
          ]),
          h("div", { class: "mc-card-major-tag", text: card.planetName }),
        ]),
      ]);
    } else {
      const imgEl = h("img", {
        class: "mc-card-suit-art",
        src: card.suitArtSrc || `/assets/suits/${card.suitKey}.jpg`,
        alt: `${card.suitName} art`,
        loading: "lazy",
      });
      const fallbackEl = h("div", { class: "mc-card-art-fallback", style: { display: "none", color: card.suitColor } }, [
        h("span", { class: "mc-card-fallback-glyph", text: card.suitGlyph }),
        h("span", { class: "mc-card-fallback-label", text: card.suitElement }),
      ]);
      imgEl.onerror = () => {
        imgEl.style.display = "none";
        fallbackEl.style.display = "flex";
      };
      artEl = h("div", { class: "mc-card-art" }, [
        h("div", { class: "mc-card-art-frame" }, [imgEl, fallbackEl]),
      ]);
    }

    const ariaLabel = `${card.title}, ${card.subline}${card.attack !== null ? `, Attack ${card.attack}` : ""}${card.health !== null ? `, Health ${card.health}` : ""}`;

    return h("div", {
      class: cls,
      style: isMajor ? null : { borderColor: card.suitColor },
      role: "button",
      tabindex: "0",
      "aria-label": ariaLabel,
      title: "Click to inspect card and assign loadout slot",
      onClick: () => {
        this.inspectedCard = rawCard;
        this.paint();
      },
      onKeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.inspectedCard = rawCard;
          this.paint();
        }
      }
    }, [
      h("div", { class: "mc-card-top" }, [
        h("span", { class: "mc-card-rank-badge mc-dim", text: card.rankCorner }),
        h("span", { class: "mc-card-loadout-tag " + l, text: l.toUpperCase() }),
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
        card.isInverted ? h("span", { text: "℞" }) : null,
      ]),
    ]);
  }

  // ── Card Inspector Popover Modal ──
  _cardInspectorModal(c, deck, collection) {
    const card = normalizeTarotCard(c);
    const isMajor = card.isMajor;
    const currentLoadout = (deck.find((d) => Number(d.card_id) === Number(c.card_id)) || {}).loadout || "bench";

    return h("div", { class: "mc-inspector-overlay", onClick: (e) => { if (e.target.classList.contains("mc-inspector-overlay")) { this.inspectedCard = null; this.paint(); } } }, [
      h("div", { class: "mc-inspector-card" }, [
        h("button", { class: "mc-inspector-close", text: "✕", onClick: () => { this.inspectedCard = null; this.paint(); } }),
        
        h("div", { class: "mc-inspector-head" }, [
          isMajor
            ? h("span", { class: "mc-inspector-glyph", style: { color: card.planetColor }, text: card.planetGlyph })
            : (card.suitArtSrc
                ? h("img", { class: "mc-inspector-suit-icon", src: card.suitArtSrc, alt: card.suitName })
                : h("span", { class: "mc-inspector-glyph", style: { color: card.planetColor }, text: card.suitGlyph })),
          h("div", {}, [
            h("div", { class: "mc-inspector-title", text: card.title }),
            h("div", { class: "mc-inspector-sub mc-dim", text: `${card.subline} · ${card.planetName} Ruled` }),
          ]),
        ]),

        h("div", { class: "mc-inspector-art-stage" }, [
          isMajor
            ? h("div", { class: "mc-card-major-sigil" }, [
                h("div", { class: "sigil-ring sigil-ring-outer" }),
                h("div", { class: "sigil-ring sigil-ring-inner" }),
                h("span", { class: "sigil-glyph", text: card.planetGlyph }),
              ])
            : h("img", {
                class: "mc-inspector-suit-art",
                src: card.suitArtSrc || `/assets/suits/${card.suitKey}.jpg`,
                alt: `${card.suitName} art`
              })
        ]),

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
          h("p", { text: isMajor 
            ? `Archetypal vector aligned with ${PLANET_NAMES[c.source_body] || "the Cosmos"}. Holds sovereign priority over minor suits in battle tricks.`
            : `Astrological minor arcana pip derived from natal decan degrees. Imbued with tile letter '${c.letter || "✦"}' for word duel synthesis.`
          }),
        ]),

        h("div", { class: "mc-inspector-loadout-section" }, [
          h("div", { class: "mc-inspector-loadout-label", text: "Assign Card Loadout Slot:" }),
          h("div", { class: "mc-inspector-loadout-buttons" }, [
            h("button", {
              class: "mc-loadout-btn active-btn" + (currentLoadout === "active" ? " is-current" : ""),
              text: currentLoadout === "active" ? "✓ Active Hand (In Battle)" : "⚔ Set to Active Hand (Max 8)",
              onClick: () => this._setCardLoadout(c.card_id, "active")
            }),
            h("button", {
              class: "mc-loadout-btn defense-btn" + (currentLoadout === "defense" ? " is-current" : ""),
              text: currentLoadout === "defense" ? "✓ Defense Garrison" : "🛡 Set to Defense Garrison",
              onClick: () => this._setCardLoadout(c.card_id, "defense")
            }),
            h("button", {
              class: "mc-loadout-btn bench-btn" + (currentLoadout === "bench" ? " is-current" : ""),
              text: currentLoadout === "bench" ? "✓ In Bench Reserve" : "📦 Move to Bench Reserve",
              onClick: () => this._setCardLoadout(c.card_id, "bench")
            }),
          ]),
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

    // If active loadout selected, ensure max 8 active cards limit
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

    if (typeof window !== "undefined" && window.toast) {
      window.toast(`${title} assigned to ${newLoadout.toUpperCase()} loadout.`, { type: "success" });
    }

    this.inspectedCard = null;
    this.paint();
  }

  // ── Decan cards: the astrological pips (derived from the chart placements) ──
  _decanSection(chart) {
    const wrap = h("div", { class: "mc-panel" });
    wrap.appendChild(h("div", { class: "mc-section-label", text: "Decan Cards" }));
    wrap.appendChild(h("div", { class: "mc-dim mc-decan-note", text: "Your placement-by-degree Minor Arcana — the Golden Dawn truth behind the deck." }));
    const grid = h("div", { class: "mc-decan-grid" });
    const placements = (chart.placements || []).slice().sort((a, b) => planetIdxOf(a.body) - planetIdxOf(b.body));
    for (const p of placements) {
      const bi = planetIdxOf(p.body);
      const sign = Number(p.sign) || 0;
      const deg = (Number(p.arc_minutes) || 0) / 60;
      const dc = decanCard(sign, deg); // {rank(2-10), suit, title, ruler, range}
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
    const wrap = h("div", { class: "mc-panel mc-allegiance" });
    wrap.appendChild(h("div", { class: "mc-section-label", text: "Allegiance" }));
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
    wrap.appendChild(h("button", {
      class: "mc-cta mc-tip",
      text: "⚖ Tip the Scales",
      onClick: () => this.hooks.onTip && this.hooks.onTip(factionIdx),
    }));
    return wrap;
  }

  destroy() { if (this.el) clear(this.el); }
}

export function create(opts) { return new MyPentaclesInstance(opts); }
export const version = "0.2.0";
const MyPentacles = { create, version, MyPentaclesInstance };
export { MyPentacles, MyPentacles as MyCodex, MyPentaclesInstance as MyCodexInstance };
export default MyPentacles;
if (typeof window !== "undefined") {
  window.MyPentacles = MyPentacles;
  window.MyCodex = MyPentacles; // Backward-compatibility alias
}
