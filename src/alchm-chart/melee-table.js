/* ============================================================
   Melee Table — multi-seat War Table UI (DOM-free & embeddable)
   ============================================================
   Renders 2 to 6 seats in orbital layout around the central Singularity WebGL
   core for autonomous historical agent battles and queued human contenders.

   Binds to normalized on-chain rows (melee_table, melee_seat, melee_play)
   via war-model.js and arcanaTrickEngine.js.
   ============================================================ */

import { h, clear } from "./dom.js";
import { zoneName, planetIdx, roundClock, PLANET_NAMES } from "./war-model.js";
import { rankName, SUIT_GLYPHS, SUIT_COLORS, MAJOR_NUMERALS } from "./deck.js";

const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
const PLANET_COLORS = ["#e8b84b", "#cbd0db", "#9aa7c4", "#d98fb0", "#cf4d4d", "#cf9a52", "#9a937c", "#5fb6c4", "#6470c8", "#8a6aa0"];

const suitCap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : "Wands");

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
    if (this._glCleanup) this._glCleanup();
    if (this.el) clear(this.el);
  }

  setData(data = {}) {
    if (data.table) this.table = data.table;
    if (data.seats) this.seats = data.seats;
    if (data.plays) this.plays = data.plays;
    if (data.myHand) this.myHand = data.myHand;
    if (data.myFaction != null) this.myFaction = data.myFaction;
    if (data.myIdentity != null) this.myIdentity = String(data.myIdentity);
    this.paint();
    return this;
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
      h("span", { class: "mt-trump-glyph", text: trumpGlyph }),
      h("span", { text: `TRUMP: ${trumpCap.toUpperCase()}` }),
    ]);

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

    const right = h("div", { class: "mt-head-right" }, [trumpBadge, clockPill, ladderBtn, closeBtn]);
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

    // Center trick badge
    const currentTrickNum = Math.min(12, Math.max(1, (this.plays && this.plays.length ? Math.floor(this.plays.length / Math.max(1, this.seats.length)) + 1 : 1)));
    const coreBadge = h("div", { class: "mt-core-badge" }, [
      h("div", { class: "mt-core-trick", text: `TRICK ${currentTrickNum} / 12` }),
      h("div", { class: "mt-core-sub aw-dim", text: "Singularity Core" }),
    ]);
    core.appendChild(coreBadge);
    arenaRing.appendChild(core);

    // Orbital Seats
    const seatList = this.seats && this.seats.length ? this.seats : [
      { seatId: 1, faction: 4, handle: "Mars Champion", isAgent: true, counters: 10, meldsValue: 20, score: 30 },
      { seatId: 2, faction: 1, handle: "Moon Ally", isHuman: true, counters: 20, meldsValue: 0, score: 20 },
    ];
    const N = seatList.length;
    const radiusPct = 42; // percent from center

    seatList.forEach((s, idx) => {
      const angle = (2 * Math.PI * idx) / N - Math.PI / 2;
      const x = 50 + radiusPct * Math.cos(angle);
      const y = 50 + radiusPct * Math.sin(angle);

      const fIdx = s.faction != null ? s.faction : idx;
      const col = PLANET_COLORS[fIdx] || "var(--ac-gold)";
      const glyph = PLANET_GLYPHS[fIdx] || "✦";
      const fName = PLANET_NAMES[fIdx] || "Faction";
      const isMe = this.myIdentity && s.occupant === this.myIdentity;

      // Find latest play for this seat in current trick
      const latestPlay = (this.plays || []).filter((p) => p.seatId === s.seatId).pop();

      const station = h("div", {
        class: "mt-seat-station" + (isMe ? " is-me" : "") + (s.isHuman ? " is-human" : " is-agent"),
        style: { left: `${x.toFixed(1)}%`, top: `${y.toFixed(1)}%` },
      }, [
        h("div", { class: "mt-seat-head" }, [
          h("span", { class: "mt-seat-glyph", style: { color: col, borderColor: col }, text: glyph }),
          h("div", { class: "mt-seat-meta" }, [
            h("div", { class: "mt-seat-name", text: s.handle || fName }),
            h("div", { class: "mt-seat-tag aw-dim", text: isMe ? "You (Ally)" : s.isHuman ? "Human Ally" : "AI Champion" }),
          ]),
        ]),
        h("div", { class: "mt-seat-scores" }, [
          h("span", { class: "mt-score-pts", text: `${s.score} pts` }),
          h("span", { class: "mt-score-counters", text: `★ ${s.counters}` }),
          s.meldsValue > 0 ? h("span", { class: "mt-score-melds aw-dim", text: `+${s.meldsValue}` }) : null,
        ]),
        h("div", { class: "mt-trick-slot" }, [
          latestPlay ? this._renderPlayedCard(latestPlay) : h("span", { class: "mt-slot-empty aw-dim", text: "·" }),
        ]),
      ]);

      arenaRing.appendChild(station);
    });

    host.appendChild(arenaRing);

    // Mount Singularity Canvas Shader
    setTimeout(() => this._initShader(canvas), 30);
  }

  _renderPlayedCard(play) {
    const isMaj = play.isMajor;
    const rank = isMaj ? (MAJOR_NUMERALS[play.rank] || "Major") : rankName(play.rank);
    const suit = play.suit || "wands";
    const glyph = SUIT_GLYPHS[suitCap(suit)] || "✦";
    const col = SUIT_COLORS[suitCap(suit)] || "var(--ac-gold)";
    return h("div", { class: `mt-played-card aw-card--${suit}` + (isMaj ? " aw-card--major" : "") }, [
      h("span", { class: "mt-card-glyph", style: { color: col }, text: glyph }),
      h("span", { class: "mt-card-rank", text: rank }),
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
          h("span", { class: "mt-ladder-numeral", text: MAJOR_NUMERALS[k] || String(k) }),
          h("span", { class: "mt-ladder-val", text: `⚡ ${potency}` }),
        ]));
      }
    }
    host.appendChild(grid);
  }

  _renderPlayerArea() {
    const host = this.dom.playerArea;
    clear(host);

    const isSeated = this.seats.some((s) => s.isHuman && this.myIdentity && s.occupant === this.myIdentity);
    if (!isSeated) {
      host.appendChild(h("div", { class: "mt-spectator-bar aw-dim" }, [
        h("span", { text: "✦ Spectating War Table · Factions maneuver autonomously across the 12-trick melee." }),
      ]));
      return;
    }

    // Interactive hand for seated player
    host.appendChild(h("div", { class: "aw-section-label", text: "Your Hand — Play into current trick" }));
    const handStrip = h("div", { class: "mt-hand-strip" });
    const cards = this.myHand || [];
    if (!cards.length) {
      handStrip.appendChild(h("div", { class: "aw-dim mt-hand-empty", text: "Hand dealt for round." }));
    } else {
      for (const c of cards) {
        handStrip.appendChild(h("div", {
          class: `mt-hand-card aw-card--${c.suit || "wands"}` + (c.is_major ? " aw-card--major" : ""),
          role: "button",
          onClick: () => this.hooks.onPlayCard && this.hooks.onPlayCard(this.table?.tableId, c.card_id),
        }, [
          h("div", { class: "mt-hand-top" }, [
            h("span", { text: SUIT_GLYPHS[suitCap(c.suit)] || "✦" }),
            h("span", { text: c.is_major ? "MAJOR" : rankName(c.rank) }),
          ]),
          h("div", { class: "mt-hand-title", text: c.title || rankName(c.rank) }),
        ]));
      }
    }
    host.appendChild(handStrip);
  }

  _initShader(canvas) {
    if (!canvas) return;
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return;

    const vs = `attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv=a_pos*0.5+0.5; gl_Position=vec4(a_pos,0.0,1.0); }`;
    const fs = `precision highp float; uniform float u_time; uniform vec2 u_res; varying vec2 v_uv;
void main(){
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res.xy) / min(u_res.x, u_res.y);
  float d = length(uv);
  float distort = 1.0 / (d + 0.1);
  vec2 duv = uv * (1.0 + 0.05 * sin(d * 10.0 - u_time * 2.0) * distort);
  float d2 = length(duv);
  float core = smoothstep(0.35, 0.34, d2);
  float angle = atan(duv.y, duv.x);
  float disk = smoothstep(0.7, 0.35, d2) * smoothstep(0.34, 0.45, d2) * (0.5 + 0.5 * sin(angle * 3.0 + u_time * 1.5 + d2 * 5.0));
  float ring = smoothstep(0.01, 0.0, abs(d2 - 0.48 + 0.02 * sin(u_time * 4.0 + angle * 5.0)));
  vec3 col = vec3(0.02, 0.023, 0.047);
  col = mix(col, vec3(0.6, 0.45, 0.15), disk);
  col = mix(col, vec3(0.95, 0.82, 0.48), ring * 0.8);
  col *= (1.0 - core);
  gl_FragColor = vec4(col, 1.0);
}`;

    const compile = (src, type) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };

    const prog = gl.createProgram();
    gl.attachShader(prog, compile(vs, gl.VERTEX_SHADER));
    gl.attachShader(prog, compile(fs, gl.FRAGMENT_SHADER));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const uTime = gl.getUniformLocation(prog, "u_time");
    const uRes = gl.getUniformLocation(prog, "u_res");

    let start = Date.now();
    let alive = true;

    const render = () => {
      if (!alive) return;
      const w = canvas.clientWidth || 240, h = canvas.clientHeight || 240;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
      gl.uniform1f(uTime, (Date.now() - start) * 0.001);
      gl.uniform2f(uRes, gl.canvas.width, gl.canvas.height);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      this._animFrame = requestAnimationFrame(render);
    };
    render();

    this._glCleanup = () => {
      alive = false;
      if (this._animFrame) cancelAnimationFrame(this._animFrame);
    };
  }
}

export default MeleeTableInstance;
