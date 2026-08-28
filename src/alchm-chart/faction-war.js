/* ============================================================
   Faction War — embeddable view (Sky Board · Standings · Faction Detail · Ticker · War Tables)
   ============================================================
   Framework-agnostic, like AlchmChart. Renders the live faction war from the
   on-chain zone / player / agent_chart / melee_table / melee_seat / melee_queue tables.
   Pass a `spacetime` client and it subscribes itself; or drive it headlessly with
   `setData({zones,players,agents,tables,seats,queue})` (used by the test harness).
   All numbers come from war-model.js and zone-access.js.

     const war = FactionWar.create({ el, spacetime, hooks:{ onJoin, onJoinQueue, onLeaveQueue } })
     war.mount(); … war.destroy()
   ============================================================ */
import { h, clear } from "./dom.js";
import {
  buildZones, computeStandings, factionRoster, deriveEvents, standingsTrend,
  agentIdentitySet, agentByIdentity, buildTables, roundClock, canAccessZone,
  accessRefusalReason, PLANET_NAMES,
} from "./war-model.js";
import { agentDeck, MAJOR_NUMERALS, SUIT_GLYPHS, SUIT_COLORS, rankName } from "./deck.js";
import MeleeTable from "./melee-table.js";

const suitCap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : "Wands");

const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
const PLANET_COLORS = ["#e8b84b", "#cbd0db", "#9aa7c4", "#d98fb0", "#cf4d4d", "#cf9a52", "#9a937c", "#5fb6c4", "#6470c8", "#8a6aa0"];
const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];
const SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const planetIdxOf = (v) => (typeof v === "number" ? v : Math.max(0, PLANET_NAMES.findIndex((n) => n.toLowerCase() === String(v).toLowerCase())));

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

export class FactionWarInstance {
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
    this.myIdentity = this.opts.myIdentity ? String(this.opts.myIdentity) : null;
    this.myCards = Array.isArray(this.opts.myCards) ? this.opts.myCards : []; // viewer's Active hand (deployable)
    this._dragging = null;
    this.data = { zones: [], players: [], agents: [], tables: [], seats: [], queue: [], plays: [] };
    this.events = this.opts.events ? this.opts.events.slice() : [];
    this.selected = this.opts.selected != null ? this.opts.selected : null; // selected faction idx
    this.selectedZone = this.opts.selectedZone != null ? this.opts.selectedZone : null; // selected zone id (0..10)
    this._prev = null;
    this._unsub = [];
    this.dom = {};
  }

  static create(opts) {
    return new FactionWarInstance(opts);
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

  destroy() {
    if (this._popEsc) document.removeEventListener("keydown", this._popEsc);
    for (const u of this._unsub) { try { if (typeof u === "function") u(); } catch {} }
    this._unsub = [];
    if (this.el) clear(this.el);
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
    sub("melee_table", "tables");
    sub("melee_seat", "seats");
    sub("melee_queue", "queue");
    sub("melee_play", "plays");
  }

  /** Merge new rows and repaint. Partial = any of {zones, players, agents, tables, seats, queue, plays}. */
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
    const tables = buildTables(this.data.tables, this.data.seats, this.data.players, agentMap, this.PN, this.data.plays);
    const zoneOwners = new Array(11).fill(null);
    for (const z of zones) zoneOwners[z.id] = z.ownerIdx;
    return { zones, standings, agentIds, agentMap, tables, zoneOwners };
  }

  paint() {
    const m = this._model();
    const hasData = (this.data.zones && this.data.zones.length) || (this.data.players && this.data.players.length);
    if (this._prev && this._baselined) {
      const fresh = deriveEvents(this._prev.zones, m.zones, this._prev.standings, m.standings, this.PN, this.PG, nowLabel());
      if (fresh.length) this.events = fresh.concat(this.events).slice(0, EVENT_CAP);
    }
    this._trend = this._baselined ? standingsTrend(m.standings, this._prev && this._prev.standings) : {};
    this._prev = { zones: m.zones, standings: m.standings };
    if (hasData) this._baselined = true;

    const champ = m.standings.find((r) => r.weight > 0);
    if (!this._manual && champ && this.selected == null) this.selected = champ.idx;
    else if (this.selected == null && champ) this.selected = champ.idx;

    this._renderHeader(m);
    this._renderBoard(m);
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
  _renderBoard(m) {
    const host = this.dom.board;
    clear(host);
    host.appendChild(h("div", { class: "aw-section-label", text: "Sky Board — zones of the heavens" }));
    const grid = h("div", { class: "aw-zone-grid" });
    const ordered = m.zones.slice().sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || a.id - b.id);
    for (const z of ordered) {
      const activeTable = m.tables && m.tables.byZone && m.tables.byZone[z.id];
      grid.appendChild(this._zoneCard(z, activeTable));
    }
    host.appendChild(grid);
  }

  _zoneCard(z, table) {
    const owned = z.ownerIdx != null;
    const col = owned ? this.PC[z.ownerIdx] : "var(--ac-dim)";
    const isSelected = this.selectedZone === z.id;
    const cls = "aw-zone aw-zone--" + z.kind + (z.contested ? " is-contested" : "") + (owned ? "" : " is-neutral") + (isSelected ? " is-selected" : "");

    let tableBadge = null;
    if (table) {
      const c = roundClock(table, Date.now());
      tableBadge = h("div", { class: "aw-zone-table-badge" }, [
        h("span", { class: "aw-table-dot" }),
        h("span", { text: `⚔ Round ${table.roundIndex} · ${table.seats.length} Seats · ${c.phase.toUpperCase()}` }),
      ]);
    }

    return h("div", {
      class: cls, tabindex: "0", role: "button",
      "aria-label": `${z.name}, ${owned ? this.PN[z.ownerIdx] + " control " + z.control : "neutral"}`,
      onClick: () => this.selectZone(z.id),
      onKeydown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); this.selectZone(z.id); } },
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
      tableBadge,
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
        class: "aw-rank" + (isChamp ? " is-champ" : "") + (r.idx === this.selected && this.selectedZone == null ? " is-selected" : ""),
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

  // ── Faction / Zone Detail + War Table Queue ──
  _renderDetail(m) {
    const host = this.dom.detail;
    clear(host);

    // If a zone is selected, render Zone Detail + Melee Table manifest + Queue
    if (this.selectedZone != null) {
      this._renderZoneDetail(host, m, this.selectedZone);
      return;
    }

    // Otherwise render Faction detail
    const idx = this.selected;
    if (idx == null) { host.appendChild(h("div", { class: "aw-dim aw-detail-empty", text: "Select a faction or zone" })); return; }
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
      const openable = a.isAgent && m.agentMap[a.identity];
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

  _renderZoneDetail(host, m, zoneId) {
    const z = m.zones.find((zn) => zn.id === zoneId) || { id: zoneId, name: zoneName(zoneId), control: 0 };
    const owned = z.ownerIdx != null;
    const col = owned ? this.PC[z.ownerIdx] : "var(--ac-dim)";
    const table = m.tables && m.tables.byZone && m.tables.byZone[zoneId];
    const clock = table ? roundClock(table, Date.now()) : null;

    // Header with back button
    host.appendChild(h("div", { class: "aw-zone-detail-head" }, [
      h("button", { class: "aw-back-btn", text: "← Back to Factions", onClick: () => { this.selectedZone = null; this.paint(); } }),
      h("div", { class: "aw-zone-detail-title" }, [
        h("span", { class: "aw-zone-glyph", style: { color: col, borderColor: col }, text: owned ? this.PG[z.ownerIdx] : "·" }),
        h("div", {}, [
          h("div", { class: "aw-detail-name", text: z.name }),
          h("div", { class: "aw-dim", text: `${owned ? this.PN[z.ownerIdx] : "Neutral"} · Control ${z.control}/1000` }),
        ]),
      ]),
    ]));

    // War Table Manifest
    if (table) {
      host.appendChild(h("div", { class: "aw-section-label", text: `War Table #${table.tableId} · Round ${table.roundIndex}` }));
      host.appendChild(h("div", { class: "aw-table-status-bar" }, [
        h("span", { class: `mt-clock-pill mt-clock--${clock.phase}`, text: `${clock.phase.toUpperCase()} · ${clock.secondsRemaining}s` }),
        h("span", { class: "aw-dim", text: `Trump: ${(table.trumpSuit || "wands").toUpperCase()}` }),
      ]));

      const seatList = h("div", { class: "aw-seat-list" });
      for (const s of table.seats) {
        const scol = this.PC[s.faction] || "var(--ac-gold)";
        seatList.appendChild(h("div", { class: "aw-seat-row" }, [
          h("span", { class: "aw-seat-glyph", style: { color: scol, borderColor: scol }, text: this.PG[s.faction] || "✦" }),
          h("div", { class: "aw-seat-id" }, [
            h("div", { class: "aw-seat-name", text: s.handle }),
            h("div", { class: "aw-seat-tag aw-dim", text: `${this.PN[s.faction]} · Claim ${s.claim}` }),
          ]),
          h("div", { class: "aw-seat-score", text: `${s.score} pts (★${s.counters})` }),
        ]));
      }
      host.appendChild(seatList);

      // Watch Table button
      host.appendChild(h("button", {
        class: "aw-watch-btn",
        onClick: () => this.showMeleeTable(table),
      }, ["👁 Watch Live Melee Table"]));
    } else {
      host.appendChild(h("div", { class: "aw-dim aw-detail-empty", text: "No active War Table mustering at this zone." }));
    }

    // Join Queue button & Access Refusal Logic
    const myF = this.myFaction;
    const queueRows = this.data.queue || [];
    const isQueuedHere = this.myIdentity && queueRows.some((q) => Number(q.zone_id) === zoneId && String(q.identity) === this.myIdentity);
    const isSeatedHere = table && table.seats.some((s) => s.isHuman && this.myIdentity && s.occupant === this.myIdentity);

    if (myF == null) {
      host.appendChild(h("div", { class: "aw-dim aw-queue-note", text: "Join a faction to queue for Zone Melees." }));
    } else if (isSeatedHere) {
      host.appendChild(h("div", { class: "aw-queue-badge is-seated", text: `★ You are seated for ${this.PN[myF]} this round!` }));
    } else if (isQueuedHere) {
      host.appendChild(h("button", {
        class: "aw-queue-btn is-queued",
        onClick: () => this._leaveQueue(),
      }, ["✓ Queued for Next Deal · Click to Leave Queue"]));
    } else {
      const canAccess = canAccessZone(zoneId, myF, m.zoneOwners);
      const refusalReason = accessRefusalReason(zoneId, myF, m.zoneOwners, this.PN);

      host.appendChild(h("button", {
        class: "aw-queue-btn" + (canAccess ? "" : " is-locked"),
        disabled: !canAccess,
        title: canAccess ? "Queue for next deal" : refusalReason,
        onClick: () => canAccess && this._joinQueue(zoneId),
      }, [canAccess ? `⚔ Join Queue — Take ${this.PN[myF]} Seat at Next Deal` : `🔒 Locked — ${refusalReason}`]));
    }
  }

  _stat(v, label) {
    return h("div", { class: "aw-stat" }, [
      h("span", { class: "aw-stat-v", text: String(v) }),
      h("span", { class: "aw-stat-k aw-dim", text: label }),
    ]);
  }

  _joinQueue(zoneId) {
    const onJoinQueue = this.hooks.onJoinQueue;
    if (onJoinQueue) {
      Promise.resolve(onJoinQueue(zoneId)).then(() => this.paint());
      return;
    }
    const net = typeof window !== "undefined" && window.Pentacles && window.Pentacles.net;
    if (net && typeof net.callReducer === "function") {
      net.callReducer("join_melee_queue", [zoneId]).then(() => {
        if (typeof window !== "undefined" && window.toast) window.toast(`Queued for Zone ${zoneId} Melee table.`, { type: "success" });
      }).catch((err) => {
        if (typeof window !== "undefined" && window.toast) window.toast((err && err.message) || "Queue failed", { type: "error" });
      });
    }
  }

  _leaveQueue() {
    const onLeaveQueue = this.hooks.onLeaveQueue;
    if (onLeaveQueue) {
      Promise.resolve(onLeaveQueue()).then(() => this.paint());
      return;
    }
    const net = typeof window !== "undefined" && window.Pentacles && window.Pentacles.net;
    if (net && typeof net.callReducer === "function") {
      net.callReducer("leave_melee_queue", []).then(() => {
        if (typeof window !== "undefined" && window.toast) window.toast("Left Melee queue.", { type: "info" });
      });
    }
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

  // ── Deploy card-tray ──
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
    const rank = c.is_major ? (MAJOR_NUMERALS[c.source_body] || "major") : rankName(c.rank);
    const cls = "aw-tray-card aw-card--" + (c.suit || "wands") + (c.is_major ? " aw-card--major" : "") + (c.inverted ? " aw-card--inv" : "");
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
    this.selectedZone = null;
    this._manual = true;
    const m = this._model();
    this._renderBoard(m);
    this._renderStandings(m.standings);
    this._renderDetail(m);
    if (this.hooks.onSelect) this.hooks.onSelect(idx);
  }

  selectZone(zoneId) {
    this.selectedZone = zoneId;
    const m = this._model();
    this._renderBoard(m);
    this._renderDetail(m);
    if (this.hooks.onSelectZone) this.hooks.onSelectZone(zoneId);
  }

  // ── Show Melee Table Modal ──
  showMeleeTable(table) {
    const pop = this.dom.pop;
    if (!pop) return;
    clear(pop);
    pop.appendChild(h("button", { class: "aw-pop-close", text: "✕", "aria-label": "Close", onClick: () => this.closeAgentProfile() }));
    const wrap = h("div", { class: "aw-pop-table-wrap" });
    pop.appendChild(wrap);
    pop.hidden = false;

    const mt = MeleeTable.create({
      el: wrap,
      table,
      seats: table.seats,
      plays: table.plays,
      myFaction: this.myFaction,
      myIdentity: this.myIdentity,
      myHand: this.myCards,
      hooks: {
        onClose: () => this.closeAgentProfile(),
      },
    });
    mt.mount();
  }

  // ── Agent Codex ──
  showAgentProfile(a, agentMap) {
    const chart = agentMap[a.identity];
    const pop = this.dom.pop;
    if (!chart || !pop) return;
    const factionIdx = this.selected != null ? this.selected : 0;
    const col = this.PC[factionIdx] || "var(--ac-gold)";
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

    card.appendChild(h("div", { class: "aw-section-label", text: "Placements · decans" }));
    card.appendChild(this._decanTable(deck));

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
    const unix = Number(chart.birth_unix);
    if (!unix) return "Birth data unrecorded";
    const d = new Date(unix * 1000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  }
  _angle(label, min) {
    const sign = Math.floor((min % 21600) / 1800);
    const deg = Math.floor((min % 1800) / 60);
    return h("div", { class: "aw-pop-angle" }, [
      h("span", { class: "aw-pop-angle-k aw-dim", text: label }),
      h("span", { class: "aw-pop-angle-v", text: `${SIGN_GLYPHS[sign]} ${deg}°` }),
    ]);
  }
  _decanTable(deck) {
    const wrap = h("div", { class: "aw-decan-tbl" });
    wrap.appendChild(h("div", { class: "aw-decan-h aw-dim" }, [
      h("span", { text: "Body" }), h("span", { text: "Sign" }), h("span", { text: "Decan" }),
      h("span", { text: "Ruler" }), h("span", { text: "Card" }), h("span", { text: "Suit" }),
    ]));
    for (const c of deck.filter((c) => !c.is_major).slice(0, 10)) {
      const cap = suitCap(c.suit);
      wrap.appendChild(h("div", { class: "aw-decan-r" }, [
        h("span", { text: this.PN[c.source_body] || "—" }),
        h("span", { text: SIGN_NAMES[c.sign] || "—" }),
        h("span", { text: `${c.decan || 1}st` }),
        h("span", { text: this.PN[c.decan_ruler] || "—" }),
        h("span", { text: c.title || rankName(c.rank) }),
        h("span", { style: { color: SUIT_COLORS[cap] }, text: `${SUIT_GLYPHS[cap] || ""} ${cap}` }),
      ]));
    }
    return wrap;
  }
  _tarotCard(c) {
    const cap = suitCap(c.suit);
    const rank = c.is_major ? (MAJOR_NUMERALS[c.source_body] || "major") : rankName(c.rank);
    return h("div", {
      class: "aw-card aw-card--" + (c.suit || "wands") + (c.is_major ? " aw-card--major" : "") + (c.inverted ? " aw-card--inv" : ""),
    }, [
      h("span", { class: "aw-card-glyph", style: { color: SUIT_COLORS[cap] }, text: SUIT_GLYPHS[cap] || "✦" }),
      h("div", { class: "aw-card-title", text: c.title || rank }),
      h("div", { class: "aw-card-sub aw-dim", text: c.is_major ? "Major Arcana" : `${rank} of ${cap}` }),
      h("div", { class: "aw-card-sep" }),
      h("div", { class: "aw-card-foot aw-dim", text: `⚔ ${c.attack || 5} · ♥ ${c.health || 10}` }),
    ]);
  }
}

export default FactionWarInstance;
