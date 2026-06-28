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
import { SUIT_GLYPHS, SUIT_COLORS, rankName, TRUMP_ARCANA, TRUMP_NAMES } from "./deck.js";

const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const PLANET_COLORS = ["#e8b84b", "#cbd0db", "#9aa7c4", "#d98fb0", "#cf4d4d", "#cf9a52", "#9a937c", "#5fb6c4", "#6470c8", "#8a6aa0"];
const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
// One-line faction doctrine (mirrors faction-war.js PASSIVE / server combat passives).
const PASSIVE = [
  "Radiance — vitality and command", "Tides — intuition and reach", "Quicksilver — cunning and signal",
  "Concord — harmony and allure", "Onslaught — +attack, breaks armour", "Expansion — fortune and momentum",
  "Endurance — +health, holds longest", "Upheaval — sudden reversals", "Dissolution — mist and illusion",
  "Transformation — depth and ruin",
];
const ACTIVE_CAP = 8, DEFENSE_CAP = 8;
const suitCap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : "Wands");
const planetIdxOf = (v) => (typeof v === "number" ? v : Math.max(0, PLANET_NAMES.findIndex((n) => n.toLowerCase() === String(v).toLowerCase())));

function dignityChip(d) {
  if (d >= 5) return { t: "Rulership", c: "favor" };
  if (d >= 4) return { t: "Exalted", c: "favor" };
  if (d >= 1) return { t: "Dignified", c: "favor" };
  if (d <= -5) return { t: "Detriment", c: "diff" };
  if (d <= -4) return { t: "Fall", c: "diff" };
  if (d < 0) return { t: "Weak", c: "diff" };
  return null;
}

class MyCodexInstance {
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
    const deck = (st && st.deck) || [];

    root.appendChild(this._header(player, factionIdx));
    root.appendChild(this._chartSection(player.chart));
    root.appendChild(this._deckSection(collection, deck));
    root.appendChild(this._decanSection(player.chart));
    root.appendChild(this._factionSection(player, factionIdx));
  }

  // ── Seeker header ──
  _header(player, factionIdx) {
    const col = PLANET_COLORS[factionIdx] || "var(--ac-gold)";
    return h("div", { class: "mc-header" }, [
      h("span", { class: "mc-medallion", style: { color: col, borderColor: col }, text: PLANET_GLYPHS[factionIdx] || "✦" }),
      h("div", { class: "mc-head-id" }, [
        h("div", { class: "mc-handle", text: player.handle || "Seeker" }),
        h("div", { class: "mc-faction" }, [
          h("span", { style: { color: col }, text: `${PLANET_GLYPHS[factionIdx]} ${PLANET_NAMES[factionIdx]}` }),
          h("span", { class: "mc-dim", text: ` — ${PASSIVE[factionIdx]}` }),
        ]),
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

  // ── My Deck: Active / Defense / Bench loadout columns ──
  _deckSection(collection, deck) {
    const byId = new Map(collection.map((c) => [Number(c.card_id), c]));
    const cols = { active: [], defense: [], bench: [] };
    for (const slot of deck) {
      const c = byId.get(Number(slot.card_id));
      const lo = String(slot.loadout || "bench").toLowerCase();
      if (c && cols[lo]) cols[lo].push(c);
    }
    const wrap = h("div", { class: "mc-panel" });
    wrap.appendChild(h("div", { class: "mc-section-label", text: "My Deck" }));
    wrap.appendChild(h("div", { class: "mc-deck" }, [
      this._loadoutCol("Active Vanguard", cols.active, ACTIVE_CAP, "Drag onto a war zone to deploy"),
      this._loadoutCol("Defense Garrison", cols.defense, DEFENSE_CAP, "Sentinels — defend held stars"),
      this._loadoutCol("The Bench", cols.bench, null, "Reserves"),
    ]));
    return wrap;
  }
  _loadoutCol(title, cards, cap, hint) {
    const full = cap != null && cards.length >= cap;
    const col = h("div", { class: "mc-col" + (full ? " is-full" : "") });
    col.appendChild(h("div", { class: "mc-col-head" }, [
      h("span", { class: "mc-col-title", text: title }),
      h("span", { class: "mc-col-count mc-dim", text: cap != null ? `${cards.length} / ${cap}` : `${cards.length}` }),
    ]));
    col.appendChild(h("div", { class: "mc-col-hint mc-dim", text: hint }));
    const list = h("div", { class: "mc-col-cards" });
    if (!cards.length) list.appendChild(h("div", { class: "mc-dim mc-col-empty", text: "—" }));
    else for (const c of cards) list.appendChild(this._card(c));
    col.appendChild(list);
    return col;
  }
  _card(c) {
    const cap = suitCap(c.suit);
    const scol = SUIT_COLORS[cap] || "var(--ac-gold)";
    const pcol = PLANET_COLORS[c.source_body] || scol;
    const isTrump = !!c.is_trump;
    const rank = isTrump ? (TRUMP_ARCANA[c.source_body] || "trump") : rankName(c.rank);
    const name = c.title || (isTrump ? (TRUMP_NAMES[c.source_body] || "Trump") : `${rank} of ${cap}`);
    const cls = "mc-card mc-card--" + (c.suit || "wands") + (isTrump ? " mc-card--trump" : "") + (c.inverted ? " mc-card--inv" : "");
    return h("div", { class: cls, style: isTrump ? null : { borderColor: scol } }, [
      h("div", { class: "mc-card-top" }, [
        h("span", { class: "mc-card-glyph", style: { color: pcol }, text: SUIT_GLYPHS[cap] || "✦" }),
        h("span", { class: "mc-card-rank mc-dim", text: rank }),
      ]),
      h("div", { class: "mc-card-title", text: name }),
      h("div", { class: "mc-card-stats" }, [
        h("span", { title: "attack", text: `⚔ ${c.attack}` }),
        h("span", { title: "health", text: `♥ ${c.health}` }),
        h("span", { title: "armour", text: `🛡 ${c.armour}` }),
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
