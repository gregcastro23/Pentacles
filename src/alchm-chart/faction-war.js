/* ============================================================
   Faction War — embeddable view (Sky Board · Standings · Faction Detail · Ticker)
   ============================================================
   Framework-agnostic, like AlchmChart. Renders the live faction war from the
   on-chain zone / player / agent_chart tables. Pass a `spacetime` client and it
   subscribes itself; or drive it headlessly with `setData({zones,players,agents})`
   (used by the test harness). All numbers come from war-model.js.

     const war = FactionWar.create({ el, spacetime, hooks:{ onJoin } })
     war.mount(); … war.destroy()
   ============================================================ */
import { h, clear } from "./dom.js";
import {
  buildZones, computeStandings, factionRoster, deriveEvents, standingsTrend,
  agentIdentitySet, agentByIdentity, PLANET_NAMES,
} from "./war-model.js";
import { agentDeck, TRUMP_ARCANA, SUIT_GLYPHS, SUIT_COLORS, rankName } from "./deck.js";

const suitCap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : "Wands");

const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
const PLANET_COLORS = ["#e8b84b", "#cbd0db", "#9aa7c4", "#d98fb0", "#cf4d4d", "#cf9a52", "#9a937c", "#5fb6c4", "#6470c8", "#8a6aa0"];
const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const planetIdxOf = (v) => (typeof v === "number" ? v : Math.max(0, PLANET_NAMES.findIndex((n) => n.toLowerCase() === String(v).toLowerCase())));
// One-line faction doctrine (mirrors the server combat passives / element bias).
const PASSIVE = [
  "Radiance — vitality and command", "Tides — intuition and reach", "Quicksilver — cunning and signal",
  "Concord — harmony and allure", "Onslaught — +attack, breaks armour", "Expansion — fortune and momentum",
  "Endurance — +health, holds longest", "Upheaval — sudden reversals", "Dissolution — mist and illusion",
  "Transformation — depth and ruin",
];
const KIND_ORDER = { crown: 0, spire: 1, house: 2 };
const EVENT_CAP = 40;

function nowLabel() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

class FactionWarInstance {
  constructor(opts) {
    this.opts = opts || {};
    this.el = this.opts.el || null;
    this.spacetime = this.opts.spacetime || (typeof window !== "undefined" && window.Pentacles ? window.Pentacles.net || window.Pentacles.spacetime : null);
    const g = this.opts.glyphs || {};
    this.PG = g.planet || PLANET_GLYPHS;
    this.PN = g.planetName || PLANET_NAMES;
    this.PC = g.planetColor || PLANET_COLORS;
    this.hooks = this.opts.hooks || {};
    this.myFaction = this.opts.myFaction != null ? this.opts.myFaction : null; // viewer's faction idx
    this.myCards = Array.isArray(this.opts.myCards) ? this.opts.myCards : []; // viewer's Active hand (deployable)
    this._dragging = null;
    this.data = { zones: [], players: [], agents: [] };
    this.events = this.opts.events ? this.opts.events.slice() : [];
    this.selected = this.opts.selected != null ? this.opts.selected : null;
    this._prev = null;
    this._unsub = [];
    this.dom = {};
  }

  mount(el) {
    if (el) this.el = el;
    if (!this.el) throw new Error("FactionWar.mount: no element");
    clear(this.el);
    this.el.classList.add("alchm-war");
    const d = this.dom;
    d.header = h("div", { class: "aw-header" });
    d.board = h("div", { class: "aw-board" });
    d.standings = h("div", { class: "aw-standings" });
    d.detail = h("div", { class: "aw-detail" });
    d.ticker = h("div", { class: "aw-ticker" });
    d.left = h("div", { class: "aw-col aw-col--left" }, [d.board, d.standings]);
    d.right = h("div", { class: "aw-col aw-col--right" }, [d.detail, d.ticker]);
    d.body = h("div", { class: "aw-body" }, [d.left, d.right]);
    d.tray = h("div", { class: "aw-card-tray" });
    d.pop = h("div", { class: "aw-pop", hidden: true });
    this.el.appendChild(d.header);
    this.el.appendChild(d.body);
    this.el.appendChild(d.tray);
    this.el.appendChild(d.pop);
    this._popEsc = (e) => { if (e.key === "Escape" && !d.pop.hidden) this.closeAgentProfile(); };
    document.addEventListener("keydown", this._popEsc);
    this._subscribeLive();
    this.paint();
    return this;
  }

  _subscribeLive() {
    const st = this.spacetime;
    if (!st || typeof st.subscribe !== "function") return;
    const sub = (table, key) => {
      try { this._unsub.push(st.subscribe(table, (rows) => this.setData({ [key]: rows }))); } catch {}
    };
    sub("zone", "zones");
    sub("player", "players");
    sub("agent_chart", "agents");
  }

  /** Merge new rows and repaint. Partial = any of {zones, players, agents}. */
  setData(partial) {
    Object.assign(this.data, partial || {});
    this.paint();
    return this;
  }

  _model() {
    const zones = buildZones(this.data.zones, this.PN);
    const agentIds = agentIdentitySet(this.data.agents);
    const agentMap = agentByIdentity(this.data.agents);
    const standings = computeStandings(zones, this.data.players, agentIds, this.PN);
    return { zones, standings, agentIds, agentMap };
  }

  paint() {
    const m = this._model();
    const hasData = (this.data.zones && this.data.zones.length) || (this.data.players && this.data.players.length);
    // derive ticker events vs the previous snapshot — but only once a baseline
    // exists, so the first real load doesn't emit "seized everything" at once.
    if (this._prev && this._baselined) {
      const fresh = deriveEvents(this._prev.zones, m.zones, this._prev.standings, m.standings, this.PN, this.PG, nowLabel());
      if (fresh.length) this.events = fresh.concat(this.events).slice(0, EVENT_CAP);
    }
    this._trend = this._baselined ? standingsTrend(m.standings, this._prev && this._prev.standings) : {};
    this._prev = { zones: m.zones, standings: m.standings };
    if (hasData) this._baselined = true;
    // detail pane follows the current champion until the user picks a faction
    const champ = m.standings.find((r) => r.weight > 0);
    if (!this._manual && champ) this.selected = champ.idx;
    else if (this.selected == null && champ) this.selected = champ.idx;

    this._renderHeader(m);
    this._renderBoard(m.zones);
    this._renderStandings(m.standings);
    this._renderDetail(m);
    this._renderTicker();
    this._renderCardTray();
  }

  _renderHeader(m) {
    const champ = m.standings.find((r) => r.weight > 0);
    clear(this.dom.header);
    this.dom.header.appendChild(h("div", { class: "aw-title" }, [
      h("span", { class: "aw-title-mark", text: "⚔" }),
      h("span", { text: "Faction War" }),
    ]));
    this.dom.header.appendChild(h("div", { class: "aw-sub", text: "Planetary agents hold the sky · historical agents & allies tip the scales" }));
    this.dom.header.appendChild(h("div", { class: "aw-champ" }, champ ? [
      h("span", { class: "aw-champ-k", text: "Champion" }),
      h("span", { class: "aw-champ-glyph", style: { color: this.PC[champ.idx] }, text: this.PG[champ.idx] }),
      h("span", { class: "aw-champ-name", text: this.PN[champ.idx] }),
    ] : [h("span", { class: "aw-dim", text: "the sky is neutral" })]));
  }

  // ── Sky Board: 11 zones, Crown first, then Spires, then Houses ──
  _renderBoard(zones) {
    const host = this.dom.board;
    clear(host);
    host.appendChild(h("div", { class: "aw-section-label", text: "Sky Board — zones of the heavens" }));
    const grid = h("div", { class: "aw-zone-grid" });
    const ordered = zones.slice().sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.id - b.id);
    for (const z of ordered) grid.appendChild(this._zoneCard(z));
    host.appendChild(grid);
  }

  _zoneCard(z) {
    const owned = z.ownerIdx != null;
    const col = owned ? this.PC[z.ownerIdx] : "var(--ac-dim)";
    const cls = "aw-zone aw-zone--" + z.kind + (z.contested ? " is-contested" : "") + (owned ? "" : " is-neutral");
    return h("div", {
      class: cls, tabindex: "0", role: "button",
      "aria-label": `${z.name}, ${owned ? this.PN[z.ownerIdx] + " control " + z.control : "neutral"}`,
      onClick: () => owned && this.selectFaction(z.ownerIdx),
      onKeydown: (e) => { if ((e.key === "Enter" || e.key === " ") && owned) { e.preventDefault(); this.selectFaction(z.ownerIdx); } },
      onDragover: (e) => { if (this._dragging != null) { e.preventDefault(); e.currentTarget.classList.add("is-drop-active"); } },
      onDragleave: (e) => { e.currentTarget.classList.remove("is-drop-active"); },
      onDrop: (e) => {
        e.preventDefault(); e.currentTarget.classList.remove("is-drop-active");
        const raw = (e.dataTransfer && e.dataTransfer.getData("text/plain")) || this._dragging;
        const id = parseInt(raw, 10);
        if (!isNaN(id)) this._deployCard(id, z);
      },
    }, [
      h("div", { class: "aw-zone-top" }, [
        h("span", { class: "aw-zone-kind", text: z.kind }),
        z.contested ? h("span", { class: "aw-zone-flag", text: "contested" }) : null,
      ]),
      h("div", { class: "aw-zone-mid" }, [
        h("span", { class: "aw-zone-glyph", style: { color: col, borderColor: col }, text: owned ? this.PG[z.ownerIdx] : "·" }),
        h("div", { class: "aw-zone-id" }, [
          h("div", { class: "aw-zone-name", text: z.name }),
          h("div", { class: "aw-zone-owner aw-dim", text: owned ? this.PN[z.ownerIdx] : "neutral" }),
        ]),
      ]),
      h("div", { class: "aw-zone-meter" }, [
        h("span", { class: "aw-zone-fill", style: { width: Math.round(z.pct * 100) + "%", background: col } }),
      ]),
      h("div", { class: "aw-zone-ctrl aw-dim", text: `${z.control} / 1000` }),
    ]);
  }

  // ── Standings leaderboard ──
  _renderStandings(standings) {
    const host = this.dom.standings;
    clear(host);
    host.appendChild(h("div", { class: "aw-section-label", text: "Faction Standings" }));
    const maxCtrl = Math.max(1, ...standings.map((r) => r.control));
    const list = h("div", { class: "aw-rank-list" });
    standings.forEach((r, i) => {
      const tr = (this._trend && this._trend[r.idx]) || 0;
      const isChamp = i === 0 && r.weight > 0;
      list.appendChild(h("div", {
        class: "aw-rank" + (isChamp ? " is-champ" : "") + (r.idx === this.selected ? " is-selected" : ""),
        tabindex: "0", role: "button", onClick: () => this.selectFaction(r.idx),
        onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.selectFaction(r.idx); } },
      }, [
        h("span", { class: "aw-rank-n", text: String(i + 1).padStart(2, "0") }),
        h("span", { class: "aw-rank-glyph", style: { color: this.PC[r.idx], borderColor: this.PC[r.idx] }, text: this.PG[r.idx] }),
        h("div", { class: "aw-rank-id" }, [
          h("div", { class: "aw-rank-name", text: this.PN[r.idx] }, isChamp ? [h("span", { class: "aw-rank-crown", text: " ♔" })] : null),
          h("div", { class: "aw-rank-sub aw-dim", text: `${r.zones} zones · ${r.agents}⊙ ${r.humans}☺` }),
        ]),
        h("div", { class: "aw-rank-meter" }, [
          h("span", { class: "aw-rank-fill", style: { width: Math.round((r.control / maxCtrl) * 100) + "%", background: this.PC[r.idx] } }),
        ]),
        h("span", { class: "aw-rank-trend aw-trend--" + (tr > 0 ? "up" : tr < 0 ? "down" : "flat"), text: tr > 0 ? "▲" : tr < 0 ? "▼" : "—" }),
      ]));
    });
    host.appendChild(list);
  }

  // ── Faction detail + Join ──
  _renderDetail(m) {
    const host = this.dom.detail;
    clear(host);
    const idx = this.selected;
    if (idx == null) { host.appendChild(h("div", { class: "aw-dim aw-detail-empty", text: "Select a faction" })); return; }
    const col = this.PC[idx];
    const st = m.standings.find((r) => r.idx === idx) || { zones: 0, control: 0, agents: 0, humans: 0 };
    const roster = factionRoster(idx, this.data.players, m.agentMap, this.PN);

    host.appendChild(h("div", { class: "aw-detail-hero" }, [
      h("span", { class: "aw-detail-glyph", style: { color: col, borderColor: col }, text: this.PG[idx] }),
      h("div", {}, [
        h("div", { class: "aw-detail-name", text: this.PN[idx] }),
        h("div", { class: "aw-detail-passive aw-dim", text: PASSIVE[idx] }),
      ]),
    ]));
    host.appendChild(h("div", { class: "aw-detail-stats" }, [
      this._stat(st.zones, "zones"), this._stat(st.control, "control"),
      this._stat(st.agents, "agents"), this._stat(st.humans, "allies"),
    ]));

    host.appendChild(h("div", { class: "aw-section-label", text: `Roster — ${roster.length} node${roster.length === 1 ? "" : "s"}` }));
    const list = h("div", { class: "aw-roster" });
    if (!roster.length) list.appendChild(h("div", { class: "aw-dim", text: "No agents yet — held by the planetary agent alone." }));
    for (const a of roster) {
      const openable = a.isAgent && m.agentMap[a.identity]; // agents carry a public chart
      list.appendChild(h("div", {
        class: "aw-roster-row" + (openable ? " is-open" : ""),
        tabindex: openable ? "0" : null, role: openable ? "button" : null,
        title: openable ? "View Tarot codex" : null,
        onClick: openable ? () => this.showAgentProfile(a, m.agentMap) : null,
        onKeydown: openable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.showAgentProfile(a, m.agentMap); } } : null,
      }, [
        h("span", { class: "aw-roster-mark", style: { borderColor: col, color: col }, text: (a.handle[0] || "✦").toUpperCase() }),
        h("span", { class: "aw-roster-name", text: a.handle }),
        h("span", { class: "aw-roster-tag aw-dim", text: a.isAgent ? "agent" : "ally" }),
        openable ? h("span", { class: "aw-roster-go", text: "⤢" }) : null,
      ]));
    }
    host.appendChild(list);

    const mine = this.myFaction === idx;
    host.appendChild(h("button", {
      class: "aw-join" + (mine ? " is-mine" : ""), disabled: mine,
      onClick: () => !mine && this.hooks.onJoin && this.hooks.onJoin(idx, this.PN[idx]),
    }, [mine ? `✦ Your faction — ${this.PN[idx]}` : `Join ${this.PN[idx]} — tip the scales`]));
  }
  _stat(v, label) {
    return h("div", { class: "aw-stat" }, [
      h("span", { class: "aw-stat-v", text: String(v) }),
      h("span", { class: "aw-stat-k aw-dim", text: label }),
    ]);
  }

  // ── Live war ticker ──
  _renderTicker() {
    const host = this.dom.ticker;
    clear(host);
    host.appendChild(h("div", { class: "aw-section-label" }, [
      h("span", { class: "aw-live-dot" }), h("span", { text: "Live War Ticker" }),
    ]));
    const feed = h("div", { class: "aw-feed" });
    if (!this.events.length) feed.appendChild(h("div", { class: "aw-dim aw-feed-empty", text: "Awaiting movement across the sky…" }));
    for (const e of this.events) {
      feed.appendChild(h("div", { class: "aw-feed-row aw-feed--" + e.kind }, [
        h("span", { class: "aw-feed-t aw-dim", text: e.t }),
        h("span", { class: "aw-feed-glyph", style: { color: this.PC[e.idx] }, text: e.glyph }),
        h("span", { class: "aw-feed-text", text: `${e.faction} ${e.text}` }),
      ]));
    }
    host.appendChild(feed);
  }

  // ── Deploy card-tray: drag an Active card onto a zone (deploy_card) ──
  setMyCards(cards) { this.myCards = Array.isArray(cards) ? cards : []; this._renderCardTray(); return this; }

  _renderCardTray() {
    const host = this.dom.tray;
    if (!host) return;
    clear(host);
    const canDeploy = !!this.hooks.onDeploy;
    host.appendChild(h("div", { class: "aw-section-label" }, [
      h("span", { text: "Your Hand — drag a card onto a zone to deploy" }),
      canDeploy ? null : h("span", { class: "aw-dim aw-tray-hint", text: " · connect to deploy" }),
    ]));
    const strip = h("div", { class: "aw-tray-strip" });
    const cards = this.myCards || [];
    if (!cards.length) {
      strip.appendChild(h("div", {
        class: "aw-dim aw-tray-empty",
        text: canDeploy ? "No Active cards in hand — draft a deck to deploy." : "Forge your chart to field a hand.",
      }));
    } else {
      for (const c of cards) strip.appendChild(this._trayCard(c));
    }
    host.appendChild(strip);
  }

  _trayCard(c) {
    const cap = suitCap(c.suit);
    const scol = SUIT_COLORS[cap] || "var(--ac-gold)";
    const pcol = this.PC[c.source_body] || scol;
    const rank = c.is_trump ? (TRUMP_ARCANA[c.source_body] || "trump") : rankName(c.rank);
    const cls = "aw-tray-card aw-card--" + (c.suit || "wands") + (c.is_trump ? " aw-card--trump" : "") + (c.inverted ? " aw-card--inv" : "");
    return h("div", {
      class: cls, draggable: "true", title: "Drag onto a zone to deploy",
      dataset: { cardId: String(c.card_id) },
      onDragstart: (e) => this._onCardDragStart(e, c.card_id),
      onDragend: () => this._onCardDragEnd(),
    }, [
      h("div", { class: "aw-tray-top" }, [
        h("span", { class: "aw-tray-glyph", style: { color: pcol }, text: SUIT_GLYPHS[cap] || "✦" }),
        h("span", { class: "aw-tray-rank aw-dim", text: rank }),
      ]),
      h("div", { class: "aw-tray-title", text: c.title || `${rank} of ${cap}` }),
      h("div", { class: "aw-tray-stats" }, [
        h("span", { text: `⚔ ${c.attack}` }),
        h("span", { text: `♥ ${c.health}` }),
        h("span", { text: `🛡 ${c.armour}` }),
      ]),
      h("div", { class: "aw-tray-foot aw-dim" }, [
        h("span", { style: { color: pcol }, text: `${this.PG[c.source_body] || ""} Lv ${c.level || 1}` }),
        c.letter ? h("span", { class: "aw-tray-letter", text: String(c.letter) }) : null,
        c.inverted ? h("span", { text: "℞" }) : null,
      ]),
    ]);
  }

  _onCardDragStart(e, cardId) {
    try { e.dataTransfer.setData("text/plain", String(cardId)); e.dataTransfer.effectAllowed = "move"; } catch {}
    this._dragging = Number(cardId);
    if (this.dom.board) this.dom.board.classList.add("is-deploy-mode");
  }
  _onCardDragEnd() {
    this._dragging = null;
    if (this.dom.board) this.dom.board.classList.remove("is-deploy-mode");
    if (this.el && this.el.querySelectorAll) this.el.querySelectorAll(".aw-zone.is-drop-active").forEach((n) => n.classList.remove("is-drop-active"));
  }
  _deployCard(cardId, z) {
    const onDeploy = this.hooks.onDeploy;
    if (!onDeploy) { if (typeof window !== "undefined" && window.toast) window.toast("Connect to deploy a card.", { type: "info", title: "Faction War" }); return; }
    Promise.resolve(onDeploy(cardId, z.id)).then((r) => {
      if (r && r.ok === false) return;
      this.myCards = (this.myCards || []).filter((c) => Number(c.card_id) !== Number(cardId));
      this._renderCardTray();
      if (typeof window !== "undefined" && window.toast) window.toast(`Deployed to ${z.name} — your faction pushes the meter and the card joins the garrison.`, { type: "success", title: "Faction War" });
    }).catch((err) => {
      if (typeof window !== "undefined" && window.toast) window.toast((err && err.message) || "Deploy failed", { type: "error", title: "Faction War" });
    });
  }

  selectFaction(idx) {
    this.selected = idx;
    this._manual = true;
    const m = this._model();
    this._renderStandings(m.standings);
    this._renderDetail(m);
    if (this.hooks.onSelect) this.hooks.onSelect(idx);
  }

  // ── Agent Codex: birth chart + on-the-fly 20-card Tarot deck ──
  showAgentProfile(a, agentMap) {
    const chart = agentMap[a.identity];
    const pop = this.dom.pop;
    if (!chart || !pop) return;
    const factionIdx = this.selected;
    const col = this.PC[factionIdx] || "var(--ac-gold)";
    // normalize placements (body string→idx, arc_minutes→arcMin) for the deck math
    const placements = (chart.placements || []).map((p) => ({
      body: planetIdxOf(p.body), sign: Number(p.sign) || 0, arcMin: Number(p.arc_minutes) || 0,
      retrograde: !!p.retrograde, dignity: Number(p.dignity) || 0,
    }));
    const ascMin = Number(chart.ascendant) || 0, mcMin = Number(chart.midheaven) || 0;
    const timeKnown = chart.time_known !== false;
    const deck = agentDeck(placements, ascMin, mcMin);

    clear(pop);
    pop.appendChild(h("button", { class: "aw-pop-close", text: "✕", "aria-label": "Close", onClick: () => this.closeAgentProfile() }));
    const card = h("div", { class: "aw-pop-card" });

    // header
    const birth = this._birthLine(chart);
    card.appendChild(h("div", { class: "aw-pop-head" }, [
      h("span", { class: "aw-pop-medallion", style: { color: col, borderColor: col }, text: this.PG[factionIdx] || "✦" }),
      h("div", { class: "aw-pop-id" }, [
        h("div", { class: "aw-pop-name", text: a.handle }),
        h("div", { class: "aw-pop-faction aw-dim" }, [
          h("span", { style: { color: col }, text: `${this.PG[factionIdx]} ${this.PN[factionIdx]}` }),
          h("span", { text: " · agent" }),
        ]),
        h("div", { class: "aw-pop-birth aw-dim", text: birth }),
      ]),
      h("div", { class: "aw-pop-angles" }, timeKnown ? [
        this._angle("ASC", ascMin), this._angle("MC", mcMin),
      ] : [h("span", { class: "aw-pop-solar", text: "solar chart" })]),
    ]));

    // placements → decan table
    card.appendChild(h("div", { class: "aw-section-label", text: "Placements · decans" }));
    card.appendChild(this._decanTable(deck));

    // the 20-card deck grid
    card.appendChild(h("div", { class: "aw-section-label", text: `The Deck · ${deck.length} cards` }));
    const grid = h("div", { class: "aw-deck-grid" });
    for (const c of deck) grid.appendChild(this._tarotCard(c));
    card.appendChild(grid);

    pop.appendChild(card);
    pop.hidden = false;
    pop.scrollTop = 0;
  }
  closeAgentProfile() { const p = this.dom.pop; if (p) { p.hidden = true; clear(p); } }

  _birthLine(chart) {
    const lat = Number(chart.birth_lat), lon = Number(chart.birth_lon);
    let date = "";
    const unix = Number(chart.birth_unix);
    if (isFinite(unix) && unix !== 0) {
      const d = new Date(unix * 1000);
      date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
    const ll = isFinite(lat) && isFinite(lon) && (lat || lon)
      ? `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}` : "place unknown";
    return [date, ll].filter(Boolean).join("  ·  ");
  }
  _angle(label, min) {
    const sign = Math.floor((min / 1800) % 12), deg = Math.floor((min % 1800) / 60);
    return h("div", { class: "aw-pop-angle" }, [
      h("span", { class: "aw-pop-angle-k aw-dim", text: label }),
      h("span", { class: "aw-pop-angle-v", text: `${SIGN_GLYPHS[sign]} ${deg}°` }),
    ]);
  }
  _decanTable(deck) {
    const rows = deck.filter((c) => c.kind === "minor");
    const tbl = h("div", { class: "aw-decan-tbl" });
    tbl.appendChild(h("div", { class: "aw-decan-h aw-dim" }, [
      h("span", { text: "body" }), h("span", { text: "sign" }), h("span", { text: "decan" }),
      h("span", { text: "ruler" }), h("span", { text: "Lord of…" }), h("span", { text: "card" }),
    ]));
    for (const c of rows) {
      tbl.appendChild(h("div", { class: "aw-decan-r" }, [
        h("span", {}, [h("span", { style: { color: this.PC[c.body] }, text: this.PG[c.body] + " " }), this.PN[c.body]]),
        h("span", { text: `${SIGN_GLYPHS[c.sign]} ${Math.floor(c.deg)}°${c.retro ? "℞" : ""}` }),
        h("span", { text: `${c.decan[0]}–${c.decan[1]}°` }),
        h("span", { style: { color: this.PC[c.decanRuler] }, text: this.PG[c.decanRuler] }),
        h("span", { class: "aw-dim", text: c.lord }),
        h("span", { style: { color: c.color }, text: c.name }),
      ]));
    }
    return tbl;
  }
  _tarotCard(c) {
    const sub = c.kind === "major"
      ? `${this.PG[c.body]} ${this.PN[c.body]}`
      : (c.role === "decan pip" ? c.lord : `${this.PG[c.body]} ${SIGN_GLYPHS[c.sign]} ${Math.floor(c.deg)}°`);
    const foot = c.kind === "major" ? `trump · ${TRUMP_ARCANA[c.body]}` : c.role;
    return h("div", { class: "aw-card aw-card--" + c.suit.toLowerCase() + (c.kind === "major" ? " aw-card--trump" : "") + (c.retro ? " aw-card--inv" : "") }, [
      h("div", { class: "aw-card-glyph", style: { color: c.color }, text: c.glyph }),
      h("div", { class: "aw-card-title", text: c.name }),
      h("div", { class: "aw-card-sub aw-dim", text: sub }),
      h("div", { class: "aw-card-sep" }),
      h("div", { class: "aw-card-foot aw-dim", text: foot + (c.retro ? " · rev" : "") }),
    ]);
  }

  setMyFaction(idx) { this.myFaction = idx; this.paint(); }
  destroy() {
    this._unsub.forEach((u) => { try { u(); } catch {} });
    this._unsub = [];
    if (this._popEsc) { document.removeEventListener("keydown", this._popEsc); this._popEsc = null; }
    if (this.el) clear(this.el);
  }
}

export function create(opts) { return new FactionWarInstance(opts); }
export const version = "0.1.0";
const FactionWar = { create, version };
export default FactionWar;
if (typeof window !== "undefined") window.FactionWar = FactionWar;
