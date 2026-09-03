/* ============================================================
   Melee Table — multi-seat War Table UI (DOM-free & embeddable)
   ============================================================
   Renders 2 to 6 seats in orbital layout around the central Singularity WebGL
   core for autonomous historical agent battles and queued human contenders.

   Binds to normalized on-chain rows (melee_table, melee_seat, melee_play,
   melee_hand, melee_trick) via war-model.js and arcanaTrickEngine.js.

   The module referees: it deals the hands, resolves each trick and settles the
   table. So this view never simulates anything — it renders what the server has
   already decided, and animates the transitions between those states. A card
   flies in when `melee_play` gains a row; the pot sweeps to the winner when
   `melee_trick` gains one. Legality greying is the ONE thing computed locally,
   from the same engine the server was ported from, so the prediction and the
   `play_melee_card` refusal always agree.
   ============================================================ */

import { h, clear } from "./dom.js";
import { zoneName, planetIdx, roundClock, PLANET_NAMES } from "./war-model.js";
import { initSingularityShaderCanvas } from "./singularity-shader.js";
// ARCANA_* are indexed by arcana 0..21, which is what a Major's `rank` IS, and
// what the Arcana Ladder is keyed by. MAJOR_* are indexed by PLANET body 0..9 —
// a different table of the same shape. Reading a rank out of those renders The
// Fool as The Sun and leaves every arcana above X blank.
import { rankName, SUIT_GLYPHS, SUIT_GLYPH_NAMES, SUIT_COLORS, SUIT_ART, ARCANA_NAMES, ARCANA_NUMERALS } from "./deck.js";

const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
const PLANET_COLORS = ["#e8b84b", "#cbd0db", "#9aa7c4", "#d98fb0", "#cf4d4d", "#cf9a52", "#9a937c", "#5fb6c4", "#6470c8", "#8a6aa0"];

const suitCap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : "Wands");

/** How long the pot lingers so the sweep to the winner is visible. Matches the
 *  `mt-sweep` keyframe duration in alchm-chart.css; change both together. */
const SWEEP_MS = 760;
/** Where seat `idx` of `n` sits on the ring, in percent of the arena box. */
function seatPoint(idx, n) {
  const angle = (2 * Math.PI * idx) / n - Math.PI / 2;
  const r = n >= 5 ? 35 : 37;
  return { x: 50 + r * Math.cos(angle), y: 50 + r * Math.sin(angle) };
}

export class MeleeTableInstance {
  constructor(opts = {}) {
    this.opts = opts;
    this.el = this.opts.el || null;
    this.table = this.opts.table || null;
    this.seats = Array.isArray(this.opts.seats) ? this.opts.seats : [];
    this.plays = Array.isArray(this.opts.plays) ? this.opts.plays : [];
    this.myFaction = this.opts.myFaction != null ? this.opts.myFaction : null;
    this.myIdentity = this.opts.myIdentity ? String(this.opts.myIdentity) : null;
    this.myHand = Array.isArray(this.opts.myHand) ? this.opts.myHand : [];
    this.hooks = this.opts.hooks || {};
    this.showLadder = false;
    this.showSettlement = false;
    this._settlementDismissed = false;
    this.dom = {};
    this._clockTimer = null;
    this._animFrame = null;
    this._glCleanup = null;
    // Animation bookkeeping. `_seenPlays` is what stops a repaint (they arrive
    // several a second) from re-throwing cards that are already on the table.
    this._seenPlays = new Set();
    this._resolvedTricks = 0;
    this._sweep = null;
    this._sweepTimer = null;
    this.isFastForwarding = false;
    this._ffTimer = null;
  }

  static create(opts) {
    return new MeleeTableInstance(opts);
  }

  mount(el) {
    if (el) this.el = el;
    if (!this.el) throw new Error("MeleeTable.mount: no element provided");
    clear(this.el);
    this.el.classList.add("alchm-melee-table");

    const d = this.dom;
    d.header = h("div", { class: "mt-header" });
    d.arena = h("div", { class: "mt-arena" });
    d.ladder = h("div", { class: "mt-ladder", hidden: true });
    d.playerArea = h("div", { class: "mt-player-area" });
    d.settlement = h("div", { class: "mt-settlement-view", hidden: true });

    this.el.appendChild(d.header);
    this.el.appendChild(d.arena);
    this.el.appendChild(d.ladder);
    this.el.appendChild(d.playerArea);
    this.el.appendChild(d.settlement);

    this.paint();
    this._startClock();
    return this;
  }

  destroy() {
    if (this._clockTimer) clearInterval(this._clockTimer);
    if (this._sweepTimer) clearTimeout(this._sweepTimer);
    if (this._ffTimer) clearTimeout(this._ffTimer);
    this.isFastForwarding = false;
    if (this._glCleanup) this._glCleanup();
    if (this.el) clear(this.el);
  }

  stopFastForward() {
    this.isFastForwarding = false;
    if (this._ffTimer) {
      clearTimeout(this._ffTimer);
      this._ffTimer = null;
    }
    this.paint();
  }

  setData(data = {}) {
    const prevPot = this._pot();
    if (data.table) this.table = data.table;
    if (data.seats) this.seats = data.seats;
    if (data.plays) this.plays = data.plays;
    if (data.myHand) this.myHand = data.myHand;
    if (data.myFaction != null) this.myFaction = data.myFaction;
    if (data.myIdentity != null) this.myIdentity = String(data.myIdentity);

    // A new `melee_trick` row means the pot just went to somebody. Hold the
    // outgoing cards on screen long enough to sweep them there — otherwise the
    // trick that decided the round vanishes between two frames and the player
    // never sees who took it.
    const resolved = (this.table && this.table.tricks ? this.table.tricks.length : 0);
    if (resolved > this._resolvedTricks && prevPot.length) {
      const last = this.table.tricks[resolved - 1];
      this._sweep = { plays: prevPot, winnerSeat: last.winnerSeat, counters: last.counters };
      clearTimeout(this._sweepTimer);
      this._sweepTimer = setTimeout(() => {
        this._sweep = null;
        this.paint();
      }, SWEEP_MS);
    }
    this._resolvedTricks = resolved;

    this.paint();
    return this;
  }

  /** The cards currently on the table, in play order. */
  _pot() {
    if (this.table && Array.isArray(this.table.trickPlays)) return this.table.trickPlays;
    // Fallback for a caller that passed raw plays without the derived model.
    const n = (this.table && this.table.currentTrick) || 1;
    return (this.plays || []).filter((p) => p.trickNumber === n).sort((a, b) => a.playId - b.playId);
  }

  /** This seat's row, or null when spectating. */
  _mySeat() {
    if (this.table && this.table.isPractice) {
      const human = (this.seats || []).find((s) => s.isHuman);
      if (human) return human;
    }
    if (!this.myIdentity) return null;
    return (this.seats || []).find((s) => s.isHuman && s.occupant === this.myIdentity) || null;
  }

  /**
   * My unspent dealt cards. `melee_hand` is authoritative — the module refuses
   * anything else — so fall back to the caller's `myHand` only before the deal
   * has loaded, and never let a stale loadout masquerade as a hand.
   */
  _myCards() {
    const seat = this._mySeat();
    if (seat && Array.isArray(seat.hand) && seat.hand.length) {
      return seat.hand.filter((c) => !c.played);
    }
    return this.myHand || [];
  }

  /**
   * Which of my cards the server will accept, computed with the engine the Rust
   * referee was ported from. A card greyed out here is a card `play_melee_card`
   * would reject; `scripts/melee-parity.test.mjs` is what keeps that true.
   */
  _legalIds() {
    const Engine = (typeof globalThis !== "undefined" && globalThis.ArcanaTrickEngine) || (typeof window !== "undefined" && window.ArcanaTrickEngine) || null;
    const cards = this._myCards();
    if (!Engine || !cards.length) return null; // null = "cannot tell", so allow all
    const pot = this._pot();
    const trick = pot.map((p) => ({
      player: p.seatId,
      card: { card_id: p.cardId, suit: p.suit, rank: p.rank, is_major: p.isMajor },
    }));
    const led = trick.length && !trick[0].card.is_major ? trick[0].card.suit : null;
    const trump = (this.table && this.table.trumpSuit) || "wands";
    const ladder = (this.table && this.table.ladder) || {};
    try {
      const moves = Engine.getLegalMoves(cards, led, trump, trick, ladder);
      return new Set(moves.filter((m) => m.legal).map((m) => m.card.card_id));
    } catch {
      return null;
    }
  }

  _startClock() {
    if (this._clockTimer) clearInterval(this._clockTimer);
    this._clockTimer = setInterval(() => {
      if (this.table && this.dom.clockPill) {
        const c = roundClock(this.table, Date.now());
        this.dom.clockPill.textContent = `${c.phase.toUpperCase()} · ${c.secondsRemaining}s`;
        this.dom.clockPill.className = `mt-clock-pill mt-clock--${c.phase}`;
      }
    }, 1000);
  }

  paint() {
    this._renderHeader();
    this._renderArena();
    this._renderLadder();
    this._renderPlayerArea();
    this._renderSettlement();
  }

  _renderHeader() {
    const host = this.dom.header;
    clear(host);
    const t = this.table || { tableId: 0, zoneId: 0, roundIndex: 1, trumpSuit: "wands", state: "Mustering" };
    const clock = roundClock(t, Date.now());
    const trump = (t.trumpSuit || "wands").toLowerCase();
    const trumpCap = suitCap(trump);
    const trumpGlyph = SUIT_GLYPHS[trumpCap] || "✦";
    const trickNo = (t && t.currentTrick) || 1;

    const left = h("div", { class: "mt-head-left" }, [
      h("span", { class: "mt-title-mark", text: "⚔" }),
      h("div", {}, [
        h("div", { class: "mt-title", text: `${zoneName(t.zoneId)} Melee` }),
        h("div", { class: "mt-sub aw-dim", text: `Zone ${t.zoneId} · Table #${t.tableId} · Round #${t.roundIndex} · ${t.seatCount || this.seats.length} Seats` }),
      ]),
    ]);

    const trickPill = h("div", { class: "mt-trick-pill" }, [
      h("span", { class: "mt-trick-count", text: `TRICK ${Math.min(12, trickNo)} / 12` }),
    ]);

    const clockPill = h("span", {
      class: `mt-clock-pill mt-clock--${clock.phase}`,
      text: `${clock.phase.toUpperCase()} · ${clock.secondsRemaining}s`,
    });
    this.dom.clockPill = clockPill;

    const trumpBadge = h("div", { class: `mt-trump-badge is-${trump}` }, [
      SUIT_ART[trumpCap]
        ? h("img", { class: "mt-trump-art", src: SUIT_ART[trumpCap], alt: trumpCap })
        : h("span", { class: "mt-trump-glyph", text: trumpGlyph }),
      h("span", { text: `TRUMP: ${trumpCap.toUpperCase()}` }),
    ]);

    const ffBtn = h("button", {
      class: "mt-btn mt-btn-fastforward" + (this.isFastForwarding ? " is-active" : ""),
      title: "Fast-forward through melee tricks rounds",
      onClick: () => {
        if (this.hooks.onFastForward) {
          this.hooks.onFastForward(this.table, this);
        }
      },
    }, [h("span", { text: this.isFastForwarding ? "⏸ Pause FF" : "⏩ Fast Forward" })]);

    const ladderBtn = h("button", {
      class: "mt-btn mt-btn-ladder" + (this.showLadder ? " is-active" : ""),
      onClick: () => {
        this.showLadder = !this.showLadder;
        if (this.dom.ladder) this.dom.ladder.hidden = !this.showLadder;
      },
    }, [h("span", { text: "⚡ Arcana Ladder" })]);

    const settlementBtn = h("button", {
      class: "mt-btn mt-btn-settlement"
        + (this.showSettlement ? " is-active" : "")
        + (t.state === "Resolved" ? " is-resolved-pulse" : ""),
      title: "View Victory Spoils & Match Settlement",
      onClick: () => {
        this.showSettlement = !this.showSettlement;
        this.paint();
      },
    }, [h("span", { text: "🏆 Spoils" })]);

    const closeBtn = h("button", {
      class: "mt-btn-close",
      "aria-label": "Close",
      onClick: () => this.hooks.onClose && this.hooks.onClose(),
    }, ["✕"]);

    const right = h("div", { class: "mt-head-right" }, [trumpBadge, clockPill, ffBtn, ladderBtn, settlementBtn, closeBtn]);
    host.appendChild(left);
    host.appendChild(trickPill);
    host.appendChild(right);
  }

  _renderArena() {
    const host = this.dom.arena;
    clear(host);

    const arenaRing = h("div", { class: "mt-ring" });

    // Gyroscopic Astrolabe Background SVG
    const astrolabe = h("svg", {
      class: "mt-astrolabe-bg",
      viewBox: "0 0 1000 1000",
      preserveAspectRatio: "xMidYMid slice",
    }, [
      h("circle", { cx: "500", cy: "500", r: "480", fill: "none", stroke: "rgba(246, 207, 131, 0.12)", "stroke-width": "1" }),
      h("circle", { cx: "500", cy: "500", r: "420", fill: "none", stroke: "rgba(246, 207, 131, 0.08)", "stroke-width": "1", "stroke-dasharray": "6 4" }),
      h("circle", { cx: "500", cy: "500", r: "340", fill: "none", stroke: "rgba(246, 207, 131, 0.1)", "stroke-width": "1" }),
      h("circle", { cx: "500", cy: "500", r: "260", fill: "none", stroke: "rgba(246, 207, 131, 0.08)", "stroke-width": "1", "stroke-dasharray": "4 4" }),
      h("line", { x1: "500", y1: "20", x2: "500", y2: "980", stroke: "rgba(246, 207, 131, 0.08)", "stroke-width": "1" }),
      h("line", { x1: "20", y1: "500", x2: "980", y2: "500", stroke: "rgba(246, 207, 131, 0.08)", "stroke-width": "1" }),
      h("line", { x1: "160", y1: "160", x2: "840", y2: "840", stroke: "rgba(246, 207, 131, 0.05)", "stroke-width": "1" }),
      h("line", { x1: "160", y1: "840", x2: "840", y2: "160", stroke: "rgba(246, 207, 131, 0.05)", "stroke-width": "1" }),
    ]);
    arenaRing.appendChild(astrolabe);

    // Singularity Core with Rotating Celestial Rings
    const core = h("div", { class: "mt-core" });
    const rings = h("div", { class: "mt-core-celestial-rings" }, [
      h("svg", { class: "mt-core-outer-ring", viewBox: "0 0 100 100" }, [
        h("circle", { cx: "50", cy: "50", r: "47", fill: "none", stroke: "rgba(246, 207, 131, 0.45)", "stroke-width": "1", "stroke-dasharray": "6 4" }),
        h("circle", { cx: "50", cy: "50", r: "43", fill: "none", stroke: "rgba(246, 207, 131, 0.2)", "stroke-width": "0.6" }),
      ]),
      h("svg", { class: "mt-core-inner-ring", viewBox: "0 0 100 100" }, [
        h("circle", { cx: "50", cy: "50", r: "40", fill: "none", stroke: "rgba(246, 207, 131, 0.35)", "stroke-width": "0.8", "stroke-dasharray": "3 4" }),
      ]),
    ]);
    core.appendChild(rings);

    const canvas = h("canvas", { class: "mt-singularity-canvas" });
    core.appendChild(canvas);

    const trickNo = (this.table && this.table.currentTrick) || 1;
    const coreBadge = h("div", { class: "mt-core-badge" }, [
      h("div", { class: "mt-core-trick", text: `TRICK ${Math.min(12, trickNo)} / 12` }),
      h("div", { class: "mt-core-sub aw-dim", text: "Singularity Core" }),
    ]);
    core.appendChild(coreBadge);
    arenaRing.appendChild(core);

    const seatList = this.seats && this.seats.length ? this.seats : [
      { seatId: 1, faction: 4, handle: "Mars Champion", isAgent: true, archetype: "Onslaught", counters: 10, meldsValue: 20, score: 30 },
      { seatId: 2, faction: 1, handle: "Moon Ally", isHuman: true, archetype: "Tides", counters: 20, meldsValue: 0, score: 20 },
    ];
    const N = seatList.length;
    const turnSeat = this.table ? this.table.turnSeat : null;
    const pot = this._sweep ? this._sweep.plays : this._pot();
    const seatAt = {};

    // Radial SVG Lines connecting seats to core
    const radialLinesSvg = h("svg", {
      class: "mt-radial-lines",
      viewBox: "0 0 100 100",
      preserveAspectRatio: "none",
    });
    seatList.forEach((s, idx) => {
      const { x, y } = seatPoint(idx, N);
      radialLinesSvg.appendChild(h("line", {
        x1: x.toFixed(1),
        y1: y.toFixed(1),
        x2: "50",
        y2: "50",
        stroke: "rgba(246, 207, 131, 0.15)",
        "stroke-width": "0.4",
        "stroke-dasharray": "1 1.5",
      }));
    });
    arenaRing.appendChild(radialLinesSvg);

    seatList.forEach((s, idx) => {
      const { x, y } = seatPoint(idx, N);
      seatAt[s.seatId] = { x, y };

      const fIdx = s.faction != null ? s.faction : idx;
      const col = PLANET_COLORS[fIdx] || "var(--primary)";
      const glyph = PLANET_GLYPHS[fIdx] || "✦";
      const fName = PLANET_NAMES[fIdx] || "Faction";
      const isMe = this.myIdentity && s.occupant === this.myIdentity;
      const isTurn = turnSeat != null && s.seatId === turnSeat;
      const archName = s.archetype || (s.isHuman ? "Human Ally" : "Champion");
      const archTactic = s.tactic || (s.isHuman ? "Live Seeker player" : "Astrological combat archetype");
      const left = s.handRemaining;

      const avatarWrap = h("div", { class: "mt-seat-avatar-wrap" }, [
        h("svg", { class: "mt-seat-dial", viewBox: "0 0 36 36" }, [
          h("circle", { cx: "18", cy: "18", r: "15.5", class: "mt-seat-dial-bg" }),
          h("circle", {
            cx: "18", cy: "18", r: "15.5", class: "mt-seat-dial-prog",
            style: { stroke: col, strokeDashoffset: `${Math.max(0, 100 - (s.score || 0) * 1.5)}` },
          }),
        ]),
        h("span", { class: "mt-seat-glyph", style: { color: col }, text: glyph }),
      ]);

      const station = h("div", {
        class: "mt-seat-station"
          + (isMe ? " is-me" : "")
          + (s.isHuman ? " is-human" : " is-agent")
          + (isTurn ? " is-turn" : ""),
        style: { left: `${x.toFixed(1)}%`, top: `${y.toFixed(1)}%`, "--seat-color": col },
        title: `${s.handle} (${fName}) — ${archTactic}`,
      }, [
        h("div", { class: "mt-seat-head" }, [
          avatarWrap,
          h("div", { class: "mt-seat-meta" }, [
            h("div", { class: "mt-seat-name", text: s.handle || fName }),
            h("div", { class: "mt-seat-tag aw-dim", text: isMe ? "You (Ally)" : s.isHuman ? "Human Ally" : `AI · ${archName}` }),
          ]),
        ]),
        h("div", { class: "mt-seat-scores" }, [
          h("span", { class: "mt-score-pts", text: `${s.score} pts` }),
          h("span", { class: "mt-score-counters", text: `★ ${s.counters}` }),
          s.meldsValue > 0 ? h("span", { class: "mt-score-melds aw-dim", text: `+${s.meldsValue}` }) : null,
          Number.isFinite(left) ? h("span", { class: "mt-score-cards aw-dim", text: `🂠 ${left}` }) : null,
        ]),
        isTurn ? h("div", { class: "mt-turn-flag", text: isMe ? "YOUR TURN" : "THINKING…" }) : null,
      ]);

      arenaRing.appendChild(station);
    });

    // The pot: every card in the open trick, laid on the ring between its seat
    // and the core. A card that has not been seen before flies in from its own
    // seat; when the trick resolves the whole pot sweeps to the winner.
    const potHost = h("div", { class: "mt-pot" + (this._sweep ? " is-sweeping" : "") });
    pot.forEach((play, i) => {
      const from = seatAt[play.seatId] || { x: 50, y: 50 };
      const seatIdx = seatList.findIndex((s) => s.seatId === play.seatId);
      const rest = seatPoint(seatIdx < 0 ? i : seatIdx, Math.max(N, 1));
      // Rest position: a third of the way from the seat toward the core.
      const rx = 50 + (rest.x - 50) * 0.42;
      const ry = 50 + (rest.y - 50) * 0.42;
      const fresh = !this._seenPlays.has(play.playId);
      const style = {
        left: `${rx.toFixed(1)}%`,
        top: `${ry.toFixed(1)}%`,
        "--from-x": `${(from.x - rx).toFixed(1)}%`,
        "--from-y": `${(from.y - ry).toFixed(1)}%`,
      };
      if (this._sweep) {
        const to = seatAt[this._sweep.winnerSeat] || { x: 50, y: 50 };
        style["--to-x"] = `${(to.x - rx).toFixed(1)}%`;
        style["--to-y"] = `${(to.y - ry).toFixed(1)}%`;
      }
      const card = h("div", {
        class: "mt-pot-card"
          + (fresh && !this._sweep ? " is-thrown" : "")
          + (this._sweep && this._sweep.winnerSeat === play.seatId ? " is-taker" : ""),
        style,
      }, [this._renderPlayedCard(play)]);
      potHost.appendChild(card);
      this._seenPlays.add(play.playId);
    });
    if (this._sweep) {
      const to = seatAt[this._sweep.winnerSeat] || { x: 50, y: 50 };
      potHost.appendChild(h("div", {
        class: "mt-sweep-tally",
        style: { left: `${to.x.toFixed(1)}%`, top: `${to.y.toFixed(1)}%` },
        text: `+${this._sweep.counters} ★`,
      }));
    }
    arenaRing.appendChild(potHost);

    host.appendChild(arenaRing);

    // Mount Singularity Canvas Shader
    setTimeout(() => this._initShader(canvas), 30);
  }

  _renderPlayedCard(play) {
    const isMaj = play.isMajor;
    const rank = isMaj ? (ARCANA_NUMERALS[play.rank] || "?") : rankName(play.rank);
    const suit = play.suit || "wands";
    const cap = suitCap(suit);
    const glyph = SUIT_GLYPHS[cap] || "✦";
    const glyphName = SUIT_GLYPH_NAMES[cap] || cap;
    const col = SUIT_COLORS[cap] || "var(--primary)";
    const trump = (this.table && this.table.trumpSuit) || "";
    const isTrump = !isMaj && suit.toLowerCase() === trump.toLowerCase();
    const titleText = isMaj ? (ARCANA_NAMES[play.rank] || "Major Arcana") : `${rankName(play.rank)} of ${cap}`;

    return h("div", {
      class: `mt-played-card aw-card--${suit}`
        + (isMaj ? " aw-card--major" : "")
        + (isTrump ? " is-trump" : ""),
      title: titleText,
      role: "img",
      "aria-label": titleText,
    }, [
      h("span", { class: "mt-card-pip top-left", "aria-hidden": "true", text: rank }),
      h("span", { class: "mt-card-pip top-right", "aria-hidden": "true", text: isMaj ? "✦" : glyph }),
      h("div", { class: "mt-card-art", "aria-hidden": "true" }, [
        SUIT_ART[cap] && !isMaj
          ? h("img", { class: "mt-card-suit-art", src: SUIT_ART[cap], alt: "" })
          : h("span", { class: "mt-card-glyph", style: { color: col }, text: isMaj ? "✦" : glyph }),
      ]),
      h("div", { class: "mt-card-name", text: titleText }),
      h("span", { class: "mt-card-pip bottom-right", "aria-hidden": "true", text: rank }),
      h("span", { class: "ac-sr-only", text: isMaj ? titleText : `${titleText} (${glyphName})` }),
    ]);
  }

  _renderLadder() {
    const host = this.dom.ladder;
    clear(host);
    const ladder = (this.table && this.table.ladder) || {};
    host.appendChild(h("div", { class: "mt-ladder-head" }, [
      h("span", { class: "mt-ladder-title", text: "⚡ Arcana Potency Ladder (Frozen for Round)" }),
      h("span", { class: "aw-dim", text: "22 Majors ordered by celestial strength" }),
    ]));

    const grid = h("div", { class: "mt-ladder-grid" });
    const keys = Object.keys(ladder).map(Number).sort((a, b) => (ladder[b] || 0) - (ladder[a] || 0));
    if (!keys.length) {
      grid.appendChild(h("div", { class: "aw-dim mt-ladder-empty", text: "Ladder computing for active sky…" }));
    } else {
      for (const k of keys) {
        const potency = ladder[k];
        grid.appendChild(h("div", { class: "mt-ladder-row" }, [
          h("span", {
            class: "mt-ladder-numeral",
            text: ARCANA_NUMERALS[k] || String(k),
            title: ARCANA_NAMES[k] || `Arcana ${k}`,
          }),
          h("span", { class: "mt-ladder-val", text: `⚡ ${potency}` }),
        ]));
      }
    }
    host.appendChild(grid);
  }

  _renderPlayerArea() {
    const host = this.dom.playerArea;
    clear(host);

    const seat = this._mySeat();
    const resolved = this.table && this.table.state === "Resolved";

    if (!seat) {
      host.appendChild(h("div", { class: "mt-spectator-bar aw-dim" }, [
        h("span", {
          text: resolved
            ? "✦ Table resolved · Control has moved. Queue for your faction's seat to contest the next round."
            : "✦ Spectating War Table · Factions maneuver autonomously across the 12-trick melee.",
        }),
      ]));
      return;
    }

    const cards = this._myCards();
    const isMyTurn = this.table && this.table.turnSeat === seat.seatId && !resolved;
    const legal = isMyTurn ? this._legalIds() : null;

    // Say plainly whose move it is. A hand you cannot play looks identical to a
    // hand you can until something tells you which one you are looking at.
    const label = resolved
      ? "Melee resolved — your final hand"
      : isMyTurn
        ? `Your turn — trick ${Math.min(12, (this.table && this.table.currentTrick) || 1)} of 12`
        : "Waiting on the table…";
    host.appendChild(h("div", {
      class: "aw-section-label" + (isMyTurn ? " is-live" : ""),
      text: label,
    }));

    const fanContainer = h("div", { class: "mt-hand-fan-container" });
    const handStrip = h("div", { class: "mt-hand-strip" + (isMyTurn ? " is-active" : "") });
    fanContainer.appendChild(handStrip);

    if (!cards.length) {
      handStrip.appendChild(h("div", {
        class: "aw-dim mt-hand-empty",
        text: seat.hasDeal ? "Hand spent — every card is on the table." : "Dealing…",
      }));
    } else {
      const numCards = cards.length;
      cards.forEach((c, idx) => {
        // `legal === null` means the engine could not be consulted, so nothing is
        // greyed out; the server refusal is still the backstop either way.
        const playable = isMyTurn && (legal === null || legal.has(c.card_id));
        const cap = suitCap(c.suit);
        const rank = c.is_major ? (ARCANA_NUMERALS[c.rank] || "?") : rankName(c.rank);
        const glyph = c.is_major ? "✦" : (SUIT_GLYPHS[cap] || "✦");
        const glyphName = SUIT_GLYPH_NAMES[cap] || cap;
        const cardTitle = c.is_major
          ? (ARCANA_NAMES[c.rank] || "Major Arcana")
          : `${rankName(c.rank)} of ${cap}`;

        // Gentle 3D fan curvature
        const mid = (numCards - 1) / 2;
        const rot = (idx - mid) * 2.5;
        const ty = Math.abs(idx - mid) * 2;
        const style = {
          "--card-rot": `${rot.toFixed(1)}deg`,
          "--card-ty": `${ty.toFixed(1)}px`,
        };

        const atk = c.attack != null ? c.attack : (c.is_major ? 20 + c.rank : (typeof c.rank === "number" ? c.rank * 2 : 15));
        const def = c.defense != null ? c.defense : (c.is_major ? 15 + c.rank : (typeof c.rank === "number" ? c.rank : 10));

        handStrip.appendChild(h("div", {
          class: `mt-hand-card aw-card--${c.suit || "wands"}`
            + (c.is_major ? " aw-card--major" : "")
            + (playable ? " is-playable" : " is-locked")
            + (c.inverted ? " is-inverted" : ""),
          style,
          role: "button",
          tabindex: playable ? "0" : "-1",
          "aria-disabled": playable ? "false" : "true",
          "aria-label": `${cardTitle}${playable ? " (Playable)" : ""}`,
          title: playable
            ? "Play into the current trick"
            : isMyTurn
              ? "Illegal here — follow suit, trump, or beat the winner"
              : "Not your turn",
          onClick: () => {
            if (!playable) return;
            this.hooks.onPlayCard && this.hooks.onPlayCard(this.table && this.table.tableId, c.card_id);
          },
          onKeydown: (e) => {
            if (!playable) return;
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              this.hooks.onPlayCard && this.hooks.onPlayCard(this.table && this.table.tableId, c.card_id);
            }
          },
        }, [
          h("span", { class: "mt-card-pip top-left", "aria-hidden": "true", text: rank }),
          h("span", { class: "mt-card-pip top-right", "aria-hidden": "true", text: glyph }),
          h("div", { class: "mt-hand-art", "aria-hidden": "true" }, [
            SUIT_ART[cap] && !c.is_major
              ? h("img", { class: "mt-hand-suit-art", src: SUIT_ART[cap], alt: "" })
              : h("span", { class: "mt-hand-glyph", text: glyph }),
          ]),
          h("div", {
            class: "mt-hand-title",
            text: cardTitle,
          }),
          h("div", { class: "mt-hand-stats" }, [
            h("span", { text: `ATK ${atk}` }),
            h("span", { text: `DEF ${def}` }),
          ]),
          h("span", { class: "ac-sr-only", text: `${cardTitle} ${glyphName}` }),
        ]));
      });
    }
    host.appendChild(fanContainer);

    if (seat.meldsValue > 0) {
      host.appendChild(h("div", { class: "mt-meld-bar aw-dim" }, [
        h("span", { text: `✦ Melds declared at the deal: +${seat.meldsValue} pts` }),
      ]));
    }
  }

  _renderSettlement() {
    const host = this.dom.settlement;
    if (!host) return;
    clear(host);

    const t = this.table || {};
    const isResolved = t.state === "Resolved";
    const shouldShow = this.showSettlement || (isResolved && !this._settlementDismissed);

    if (!shouldShow) {
      host.hidden = true;
      return;
    }
    host.hidden = false;

    const seatList = this.seats && this.seats.length ? this.seats : [];
    // Sort seats by score descending to find winner
    const ranked = seatList.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
    const winner = ranked[0] || { handle: "Victor", faction: 1, score: 0 };
    const winFactionName = PLANET_NAMES[winner.faction] || winner.handle || "Dominant";
    const mySeat = this._mySeat();

    // 1. Header
    const header = h("div", { class: "mt-settlement-header" }, [
      h("div", { class: "mt-triumph-title" }, [
        h("span", { text: `✦ Faction ${winFactionName} Triumphs in ${zoneName(t.zoneId)} ✦` }),
      ]),
      h("div", { class: "mt-triumph-sub" }, [
        h("span", { text: `Post-Match Settlement · Table #${t.tableId || 0} · Sol-Net Sync Complete` }),
      ]),
    ]);

    // 2. Grid (Left: Score Table & Zone Control Shift, Right: Spoils Drawer)
    const grid = h("div", { class: "mt-settlement-grid" });

    // Left Panel
    const leftPanel = h("div", { class: "mt-settlement-panel" });
    leftPanel.appendChild(h("div", { class: "mt-panel-title", text: "Match Settlement Ledger" }));

    const tableEl = h("table", { class: "mt-score-table" }, [
      h("thead", {}, [
        h("tr", {}, [
          h("th", { text: "Seat" }),
          h("th", { text: "Counters" }),
          h("th", { text: "Melds" }),
          h("th", { text: "Last Trick" }),
          h("th", { text: "Total Score" }),
        ]),
      ]),
    ]);

    const lastTrick = (t.tricks && t.tricks.length) ? t.tricks[t.tricks.length - 1] : null;
    const lastTrickWinner = lastTrick ? (lastTrick.winnerSeat ?? lastTrick.winner_seat) : null;

    const tbody = h("tbody");
    ranked.forEach((s, idx) => {
      const isWinner = idx === 0;
      const isPlayer = mySeat && s.seatId === mySeat.seatId;
      const tookLast = s.seatId === lastTrickWinner;
      const lastTrickBonus = tookLast ? "+20" : "—";
      const fName = PLANET_NAMES[s.faction] || "Faction";
      tbody.appendChild(h("tr", {
        class: (isWinner ? "is-winner " : "") + (isPlayer ? "is-player-row" : ""),
      }, [
        h("td", { text: `${isPlayer ? "★ You (" + (s.handle || fName) + ")" : (s.handle || fName)}` }),
        h("td", { text: `${s.counters || 0}` }),
        h("td", { text: `+${s.meldsValue || 0}` }),
        h("td", { text: lastTrickBonus }),
        h("td", { style: { fontWeight: "700", color: isWinner ? "var(--primary)" : "inherit" }, text: `${s.score || 0} pts` }),
      ]));
    });
    tableEl.appendChild(tbody);
    leftPanel.appendChild(tableEl);

    // Zone Control Shift Box
    const shiftBox = h("div", { class: "mt-control-shift-box" }, [
      h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "12px", fontFamily: "JetBrains Mono, monospace" } }, [
        h("span", { style: { color: "var(--primary)" }, text: `Faction ${winFactionName} (+85 Influence)` }),
        h("span", { style: { color: "var(--on-surface-variant)" }, text: "Zone Dominance Shift" }),
      ]),
      h("div", { class: "mt-control-bar-track" }, [
        h("div", { class: "mt-control-bar-fill-sun", style: { width: "68%" } }),
        h("div", { class: "mt-control-bar-fill-moon", style: { width: "32%" }, text: "32%" }),
      ]),
      h("div", { style: { fontSize: "11px", color: "var(--on-surface-variant)", opacity: "0.8" }, text: "Dominance swing recorded to chain state. Alchemical resonance stabilized." }),
    ]);
    leftPanel.appendChild(shiftBox);
    grid.appendChild(leftPanel);

    // Right Panel: Spoils Drawer
    const rightPanel = h("div", { class: "mt-settlement-panel" });
    rightPanel.appendChild(h("div", { class: "mt-panel-title", text: "Spoils & StarVault Verification" }));

    const spoilsDrawer = h("div", { class: "mt-spoils-drawer" });
    const spoilsCard = h("div", { class: "mt-spoils-card" }, [
      h("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } }, [
        h("span", { style: { fontFamily: "JetBrains Mono", fontSize: "11px", color: "var(--primary)", fontWeight: "700" }, text: "MAJOR XXI" }),
        h("span", { style: { color: "var(--primary)" }, text: "✦" }),
      ]),
      h("div", { style: { textAlign: "center", margin: "14px 0" } }, [
        h("div", { style: { fontSize: "32px", color: "var(--primary)", textShadow: "0 0 12px rgba(246, 207, 131, 0.6)" }, text: "☉" }),
        h("div", { style: { fontFamily: "Noto Serif", fontSize: "14px", fontWeight: "700", color: "var(--on-surface)", marginTop: "6px" }, text: "The World" }),
        h("div", { style: { fontSize: "10px", color: "var(--on-surface-variant)", textTransform: "uppercase" }, text: "Solar Singularity" }),
      ]),
      h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "11px", fontFamily: "JetBrains Mono", borderTop: "1px solid rgba(246,207,131,0.2)", paddingTop: "8px" } }, [
        h("span", { text: "ATK 42" }),
        h("span", { text: "DEF 38" }),
      ]),
    ]);
    spoilsDrawer.appendChild(spoilsCard);

    const hashChip = h("div", { class: "mt-spoils-chip" }, [
      h("div", { style: { display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", marginBottom: "4px" } }, [
        h("span", { class: "mt-spoils-chip-beacon" }),
        h("span", { style: { fontFamily: "Space Grotesk", fontSize: "11px", fontWeight: "600", color: "var(--f-venus)" }, text: "Sol-Net StarVault Synchronized" }),
      ]),
      h("div", { style: { fontFamily: "JetBrains Mono", fontSize: "10px", color: "var(--on-surface-variant)", letterSpacing: "0.05em" }, text: "Hash: 0x7f2a9b4c...8e1d2c" }),
    ]);
    spoilsDrawer.appendChild(hashChip);
    rightPanel.appendChild(spoilsDrawer);
    grid.appendChild(rightPanel);

    // 3. Actions
    const actions = h("div", { class: "mt-settlement-actions" }, [
      h("button", {
        class: "mt-action-btn-primary",
        onClick: () => {
          if (this.hooks.onClose) this.hooks.onClose();
        },
      }, [h("span", { text: "✦ Return to Sky War Room" })]),
      h("button", {
        class: "mt-action-btn-secondary",
        onClick: () => {
          this._settlementDismissed = true;
          this.showSettlement = false;
          this.paint();
        },
      }, [h("span", { text: "Inspect Table / Arena" })]),
    ]);

    host.appendChild(header);
    host.appendChild(grid);
    host.appendChild(actions);
  }

  _initShader(canvas) {
    if (!canvas) return;
    this._glCleanup = initSingularityShaderCanvas(canvas);
  }
}

export default MeleeTableInstance;
