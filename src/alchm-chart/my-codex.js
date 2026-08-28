/* ============================================================
   My Codex — the player's own profile (the human mirror of the Agent Codex)
   ============================================================
   Framework-agnostic like FactionWar. Renders the local player's sealed natal
   chart, minted deck (Active / Defense / Bench loadouts), decan cards, and
   faction allegiance — all from the live client GameState (window.state):
     • player          → handle, faction, tokens, word_wins, chart
     • collection      → full Card rows
     • deck            → [{card_id, loadout}]  (active|defense|bench)
   The decan pips are derived from the chart placements with the same Golden
   Dawn mapping the server uses (decans.js), so they match the on-chain truth.

     const codex = MyCodex.create({ el, hooks:{ onTip, onForge } })
     codex.mount(); … codex.destroy()
   ============================================================ */
import { h, clear } from "./dom.js";
import { decanCard } from "./decans.js";
import { SUIT_GLYPHS, SUIT_COLORS, rankName, MAJOR_NUMERALS, MAJOR_NAMES, ARCANA_NUMERALS, ARCANA_NAMES } from "./deck.js";
import { categoricalChartAnalytics } from "./sign-character.js";

const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const PLANET_COLORS = ["#e8b84b", "#cbd0db", "#9aa7c4", "#d98fb0", "#cf4d4d", "#cf9a52", "#9a937c", "#5fb6c4", "#6470c8", "#8a6aa0"];
const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
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

export class MyCodexInstance {
  constructor(opts) {
    this.opts = opts || {};
    this.el = this.opts.el || null;
    this.hooks = this.opts.hooks || {};
    this._stateOf = this.opts.state ? () => this.opts.state : () => (typeof window !== "undefined" ? window.state : null);
    this.dom = {};
  }

  mount(el) {
    if (el) this.el = el;
    if (!this.el) throw new Error("MyCodex.mount: no element");
    clear(this.el);
    this.el.classList.add("alchm-codex");
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
    clear(root);

    if (!player || !player.chart) {
      root.appendChild(h("div", { class: "mc-empty" }, [
        h("div", { class: "mc-empty-mark", text: "✦" }),
        h("div", { class: "mc-empty-title", text: "No chart sealed yet" }),
        h("div", { class: "mc-dim", text: "Forge your natal chart to mint a deck and claim a faction." }),
        this.hooks.onForge ? h("button", { class: "mc-cta", text: "Forge your chart", onClick: () => this.hooks.onForge() }) : null,
      ]));
      return;
    }

    const factionIdx = planetIdxOf(player.faction);
    const collection = (st && st.collection) || [];
    let deck = (st && st.deck) || [];
    if (deck.length === 0 && collection.length > 0) {
      deck = collection.map((c, i) => ({ card_id: c.card_id, loadout: i < 8 ? "active" : "bench" }));
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
  }

  // ── Seeker header ──
  _header(player, factionIdx) {
    const col = PLANET_COLORS[factionIdx] || "var(--ac-gold)";
    const kitchenUrl = `https://agents.alchm.kitchen/profile?agent=${encodeURIComponent(player.handle || "seeker")}&faction=${factionIdx}`;
    return h("div", { class: "mc-header" }, [
      h("span", { class: "mc-medallion", style: { color: col, borderColor: col }, text: PLANET_GLYPHS[factionIdx] || "✦" }),
      h("div", { class: "mc-head-id" }, [
        h("div", { class: "mc-handle", text: player.handle || "Seeker" }),
        h("div", { class: "mc-faction" }, [
          h("span", { style: { color: col }, text: `${PLANET_GLYPHS[factionIdx]} ${PLANET_NAMES[factionIdx]}` }),
          h("span", { class: "mc-dim", text: ` — ${PASSIVE[factionIdx]}` }),
        ]),
      ]),
      h("div", { class: "mc-kitchen-action" }, [
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
  _trophy(v, label) {
    return h("div", { class: "mc-trophy" }, [
      h("span", { class: "mc-trophy-v", text: v.toLocaleString() }),
      h("span", { class: "mc-trophy-k mc-dim", text: label }),
    ]);
  }

  // ── Natal chart: Asc/MC + placements (solar variant when time unknown) ──
  _chartSection(chart) {
    const wrap = h("div", { class: "mc-panel" });
    const timeKnown = chart.time_known !== false;
    wrap.appendChild(h("div", { class: "mc-panel-head" }, [
      h("span", { class: "mc-section-label", text: "Natal Chart" }),
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

  // ── My Deck: Sorted by Zodiac Sign (showing natal chart in cards) ──
  _deckSection(collection, deck, chart) {
    const byId = new Map(collection.map((c) => [Number(c.card_id), c]));

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
    for (const slot of deck) {
      const c = byId.get(Number(slot.card_id));
      if (c) {
        const signIdx = (c.sign_idx !== undefined && c.sign_idx !== null) ? Number(c.sign_idx) % 12 : 0;
        cardsBySign[signIdx].push(c);
      }
    }

    const wrap = h("div", { class: "mc-panel" });
    wrap.appendChild(h("div", { class: "mc-panel-head" }, [
      h("span", { class: "mc-section-label", text: "My Deck · Chart in Cards" }),
      h("span", { class: "mc-dim", text: `${deck.length} Cards Total` })
    ]));
    wrap.appendChild(h("div", { class: "mc-dim mc-decan-note", text: "Cards sorted by Zodiac Sign, highlighting your natal placements and active hand." }));

    const grid = h("div", { class: "mc-zodiac-deck-grid" });

    const SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
    const SIGN_ELEMENTS = ["Fire", "Earth", "Air", "Water", "Fire", "Earth", "Air", "Water", "Fire", "Earth", "Air", "Water"];

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
  _card(c) {
    const cap = suitCap(c.suit);
    const scol = SUIT_COLORS[cap] || "var(--ac-gold)";
    const pcol = PLANET_COLORS[c.source_body] || scol;
    const isMajor = !!c.is_major;
    const numeral = (c.rank !== undefined && ARCANA_NUMERALS[c.rank]) || (c.source_body !== undefined && MAJOR_NUMERALS[c.source_body]) || "major";
    const rank = isMajor ? numeral : rankName(c.rank);
    const name = c.title || (isMajor ? (ARCANA_NAMES[c.rank] || MAJOR_NAMES[c.source_body] || "Major Arcana") : `${rank} of ${cap}`);
    const cls = "mc-card mc-card--" + (c.suit || "wands").toLowerCase() + (isMajor ? " mc-card--major" : "") + (c.inverted ? " mc-card--inv" : "");
    return h("div", { class: cls, style: isMajor ? null : { borderColor: scol } }, [
      h("div", { class: "mc-card-top" }, [
        h("span", { class: "mc-card-glyph", style: { color: pcol }, text: SUIT_GLYPHS[cap] || "✦" }),
        h("span", { class: "mc-card-rank mc-dim", text: rank }),
      ]),
      h("div", { class: "mc-card-title", text: name }),
      h("div", { class: "mc-card-stats" }, [
        h("span", { title: "attack", text: `⚔ ${c.attack || 0}` }),
        h("span", { title: "health", text: `♥ ${c.health || 0}` }),
        h("span", { title: "armour", text: `🛡 ${c.armour || 0}` }),
      ]),
      h("div", { class: "mc-card-foot mc-dim" }, [
        h("span", { style: { color: pcol }, text: `${PLANET_GLYPHS[c.source_body] || ""} Lv ${c.level || 1}` }),
        c.letter ? h("span", { class: "mc-card-letter", text: String(c.letter) }) : null,
        c.inverted ? h("span", { text: "℞" }) : null,
      ]),
    ]);
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
          h("span", { class: "mc-decan-glyph", style: { color: scol }, text: SUIT_GLYPHS[dc.suit] || "✦" }),
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

export function create(opts) { return new MyCodexInstance(opts); }
export const version = "0.1.0";
const MyCodex = { create, version };
export default MyCodex;
if (typeof window !== "undefined") window.MyCodex = MyCodex;
