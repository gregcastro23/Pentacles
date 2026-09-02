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
  const r = n >= 5 ? 39 : 42;
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

    this.el.appendChild(d.header);
    this.el.appendChild(d.arena);
    this.el.appendChild(d.ladder);
    this.el.appendChild(d.playerArea);

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
  }

  _renderHeader() {
    const host = this.dom.header;
    clear(host);
    const t = this.table || { tableId: 0, zoneId: 0, roundIndex: 1, trumpSuit: "wands", state: "Mustering" };
    const clock = roundClock(t, Date.now());
    const trump = (t.trumpSuit || "wands").toLowerCase();
    const trumpCap = suitCap(trump);
    const trumpGlyph = SUIT_GLYPHS[trumpCap] || "✦";

    const left = h("div", { class: "mt-head-left" }, [
      h("span", { class: "mt-title-mark", text: "⚔" }),
      h("div", {}, [
        h("div", { class: "mt-title", text: `${zoneName(t.zoneId)} Melee` }),
        h("div", { class: "mt-sub aw-dim", text: `Table #${t.tableId} · Round #${t.roundIndex} · ${t.seatCount || this.seats.length} Seats` }),
      ]),
    ]);

    const clockPill = h("span", {
      class: `mt-clock-pill mt-clock--${clock.phase}`,
      text: `${clock.phase.toUpperCase()} · ${clock.secondsRemaining}s`,
    });
    this.dom.clockPill = clockPill;

    const trumpBadge = h("div", { class: "mt-trump-badge" }, [
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

    const closeBtn = h("button", {
      class: "mt-btn-close",
      "aria-label": "Close",
      onClick: () => this.hooks.onClose && this.hooks.onClose(),
    }, ["✕"]);

    const right = h("div", { class: "mt-head-right" }, [trumpBadge, clockPill, ffBtn, ladderBtn, closeBtn]);
    host.appendChild(left);
    host.appendChild(right);
  }

  _renderArena() {
    const host = this.dom.arena;
    clear(host);

    const arenaRing = h("div", { class: "mt-ring" });
    const core = h("div", { class: "mt-core" });
    const canvas = h("canvas", { class: "mt-singularity-canvas" });
    core.appendChild(canvas);

    // The trick number is the module's, read off resolved `melee_trick` rows —
    // never inferred from how many cards happen to be on the table.
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

    seatList.forEach((s, idx) => {
      const { x, y } = seatPoint(idx, N);
      seatAt[s.seatId] = { x, y };

      const fIdx = s.faction != null ? s.faction : idx;
      const col = PLANET_COLORS[fIdx] || "var(--ac-gold)";
      const glyph = PLANET_GLYPHS[fIdx] || "✦";
      const fName = PLANET_NAMES[fIdx] || "Faction";
      const isMe = this.myIdentity && s.occupant === this.myIdentity;
      const isTurn = turnSeat != null && s.seatId === turnSeat;
      const archName = s.archetype || (s.isHuman ? "Human Ally" : "Champion");
      const archTactic = s.tactic || (s.isHuman ? "Live Seeker player" : "Astrological combat archetype");
      const left = s.handRemaining;

      const station = h("div", {
        class: "mt-seat-station"
          + (isMe ? " is-me" : "")
          + (s.isHuman ? " is-human" : " is-agent")
          + (isTurn ? " is-turn" : ""),
        style: { left: `${x.toFixed(1)}%`, top: `${y.toFixed(1)}%`, "--seat-color": col },
        title: `${s.handle} (${fName}) — ${archTactic}`,
      }, [
        h("div", { class: "mt-seat-head" }, [
          h("span", { class: "mt-seat-glyph", style: { color: col, borderColor: col }, text: glyph }),
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
    const col = SUIT_COLORS[cap] || "var(--ac-gold)";
    const trump = (this.table && this.table.trumpSuit) || "";
    const isTrump = !isMaj && suit === trump;
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
      h("span", { class: "mt-card-pip bottom-right", "aria-hidden": "true", text: rank }),
      SUIT_ART[cap] && !isMaj
        ? h("img", { class: "mt-card-suit-art", src: SUIT_ART[cap], alt: "", "aria-hidden": "true" })
        : h("span", { class: "mt-card-glyph", style: { color: col }, "aria-hidden": "true", text: isMaj ? "✦" : glyph }),
      h("span", { class: "mt-card-rank", "aria-hidden": "true", text: rank }),
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

    const handStrip = h("div", { class: "mt-hand-strip" + (isMyTurn ? " is-active" : "") });
    if (!cards.length) {
      handStrip.appendChild(h("div", {
        class: "aw-dim mt-hand-empty",
        text: seat.hasDeal ? "Hand spent — every card is on the table." : "Dealing…",
      }));
    } else {
      for (const c of cards) {
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

        handStrip.appendChild(h("div", {
          class: `mt-hand-card aw-card--${c.suit || "wands"}`
            + (c.is_major ? " aw-card--major" : "")
            + (playable ? " is-playable" : " is-locked")
            + (c.inverted ? " is-inverted" : ""),
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
              : h("span", { class: "mt-hand-glyph", text: glyph })
          ]),
          h("div", {
            class: "mt-hand-title",
            text: cardTitle,
          }),
          h("span", { class: "ac-sr-only", text: `${cardTitle} ${glyphName}` }),
        ]));
      }
    }
    host.appendChild(handStrip);

    if (seat.meldsValue > 0) {
      host.appendChild(h("div", { class: "mt-meld-bar aw-dim" }, [
        h("span", { text: `✦ Melds declared at the deal: +${seat.meldsValue} pts` }),
      ]));
    }
  }

  _initShader(canvas) {
    if (!canvas) return;
    this._glCleanup = initSingularityShaderCanvas(canvas);
  }
}

export default MeleeTableInstance;
