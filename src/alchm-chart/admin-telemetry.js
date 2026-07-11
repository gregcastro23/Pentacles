/* ============================================================
   Admin Telemetry — the Observatory (gregcastro23@gmail.com only)
   ============================================================
   A comprehensive, single-pane operations console for the whole Pentacles stack:
   sky-tick health, player growth & retention, the token economy, the faction war,
   AI engagement (word duels / Jing arena / Claude oracle), the agent roster, and
   the constellation DEX. Framework-agnostic like FactionWar / MyCodex:

     const obs = AdminTelemetry.create({ el, spacetime, hooks })
     obs.mount(); obs.refresh(); … obs.destroy()

   It reads exclusively through TelemetryModel (telemetry-model.js) — every query is
   degrade-safe, so an offline/half-seeded module still paints the full structure.
   Auto-refreshes on an interval and on live table deltas; the SQL console is
   read-only. Visuals flow through --ac-* tokens, so it themes with the rest of the
   alchm surfaces (admin styles live in alchm-chart.css under "Admin Telemetry").

   The actual pixel-polish is handed to a Stitch design pass; this module owns the
   data binding + structure so the design can be dropped in over stable hooks.
   ============================================================ */
import { h, clear } from './dom.js';
import {
  TelemetryModel, fmtAge, fmtNum, toMs, SERVICE_STALE_MS,
  PLANET_NAMES, PLANET_GLYPHS, PLANET_COLORS, ESMS_NAMES,
} from './telemetry-model.js';

const SECTIONS = [
  { id: 'overview', label: 'Overview', glyph: '✦' },
  { id: 'players', label: 'Players', glyph: '☉' },
  { id: 'economy', label: 'Economy', glyph: '⊛' },
  { id: 'war', label: 'Faction War', glyph: '⚔' },
  { id: 'ai', label: 'AI & Duels', glyph: '◈' },
  { id: 'agents', label: 'Agents', glyph: '☿' },
  { id: 'dex', label: 'Constellation DEX', glyph: '♁' },
  { id: 'sky', label: 'Sky', glyph: '☽' },
  { id: 'services', label: 'Services', glyph: '⚚' },
  { id: 'console', label: 'SQL Console', glyph: '⌘' },
];

const REFRESH_MS = 20_000;
// Threshold alerts — surfaced as a banner + a one-shot toast on each transition.
const THRESHOLDS = { oracleBacklog: 10, attestorBacklog: 10, tickStaleMs: 5 * 60_000 };
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const planetTag = (i) => (i >= 0 && i < 10 ? `${PLANET_GLYPHS[i]} ${PLANET_NAMES[i]}` : 'Neutral');

class AdminTelemetryInstance {
  constructor(opts = {}) {
    this.opts = opts;
    this.el = opts.el || null;
    this.hooks = opts.hooks || {};
    this.spacetime = opts.spacetime || (typeof window !== 'undefined' ? window.__spacetime : null);
    this.model = new TelemetryModel({ spacetime: this.spacetime });
    this.section = opts.section || 'overview';
    this.snap = null;
    this.loading = false;
    this.lastError = null;
    this.dom = {};
    this._timer = null;
    this._unsub = [];
    this._firedAlerts = new Set(); // alert keys already toasted (dedupe across refreshes)
    this.alerts = [];
    this._svcTableMissing = false; // service_status probe failed → module predates the table
    this._destroyed = false;
  }

  mount(el) {
    if (el) this.el = el;
    if (!this.el) throw new Error('AdminTelemetry.mount: no element');
    clear(this.el);
    this.el.classList.add('admin-tel');
    this.dom.root = h('div', { class: 'at-root' });
    this.el.appendChild(this.dom.root);
    this._paintShell();
    this.refresh();
    // Auto-refresh on an interval, and (when live) on key table deltas.
    this._timer = setInterval(() => this.refresh(), REFRESH_MS);
    this._bindLive();
    return this;
  }

  _bindLive() {
    const st = this.spacetime;
    if (!st || typeof st.subscribe !== 'function') return;
    let debounce = null;
    const ping = () => { clearTimeout(debounce); debounce = setTimeout(() => this.refresh(), 1200); };
    for (const t of ['player', 'zone', 'oracle_request', 'oracle_reply', 'word_duel', 'trade', 'ephemeris']) {
      try { this._unsub.push(st.subscribe(t, ping)); } catch {}
    }
    // service_status only exists from the 2.x module republish onward — during
    // the mixed-version window the deployed module may not have it yet, and a
    // blind subscribe would make the server reject the app's WHOLE combined
    // query set. Probe cheaply over the one-shot /sql path first; only subscribe
    // live once the table answers.
    this._probeServiceStatus(st, ping);
  }

  /** Probe service_status over HTTP /sql before joining the live subscription. */
  async _probeServiceStatus(st, ping) {
    let missing = false;
    // Only probe clients that can actually answer (the real client throws
    // "not configured" when offline — that's not a missing table, so mocks and
    // offline sims keep the old direct-subscribe behavior).
    if (typeof st.query === 'function' && st.configured !== false) {
      try {
        await st.query('SELECT service FROM service_status LIMIT 1'); // cheap: 0–1 rows
      } catch (e) {
        // service_status is live on prod; a probe failure here means an older
        // module or a transient error. Either way: don't subscribe blind.
        missing = true;
        console.warn('[observatory] service_status probe failed — skipping its live subscription:', e.message || e);
      }
    }
    if (this._destroyed) return;
    this._svcTableMissing = missing;
    if (!missing) {
      try { this._unsub.push(st.subscribe('service_status', ping)); } catch {}
    } else if (this.snap) {
      // Surface it through the standing alert/checklist mechanism right away.
      this._computeAlerts(this.snap);
      this._paintBody();
    }
  }

  async refresh() {
    if (this.loading) return;
    this.loading = true;
    this._paintHeader();
    try {
      this.snap = await this.model.snapshot();
      this.lastError = null;
      this._computeAlerts(this.snap);
    } catch (e) {
      this.lastError = e;
    }
    this.loading = false;
    this._paintHeader();
    this._paintBody();
  }

  /** Derive threshold alerts and fire a one-shot toast as each turns active. */
  _computeAlerts(snap) {
    const d = snap.duels || {}, dx = snap.dex || {}, hh = snap.health || {}, sv = snap.services || {};
    const alerts = [];
    if ((d.oracleBacklog || 0) > THRESHOLDS.oracleBacklog)
      alerts.push({ key: 'oracle', msg: `Oracle backlog: ${d.oracleBacklog} unanswered (> ${THRESHOLDS.oracleBacklog}). The companion service may be down.` });
    if ((dx.traceBacklog || 0) > THRESHOLDS.attestorBacklog)
      alerts.push({ key: 'attestor', msg: `Attestor backlog: ${dx.traceBacklog} unsigned traces (> ${THRESHOLDS.attestorBacklog}). The attestor service may be down.` });
    if (hh.lastTickAgeMs != null && hh.lastTickAgeMs > THRESHOLDS.tickStaleMs)
      alerts.push({ key: 'tick', msg: `Sky tick is stale (${fmtAge(hh.lastTickAgeMs)} old). tick_sky / the ephemeris feeder may have stalled.` });
    if (hh.skyTimerArmed === false)
      alerts.push({ key: 'timer', msg: 'Sky tick timer is NOT armed — scheduled ticks have stopped.' });
    if (this._svcTableMissing)
      alerts.push({ key: 'svc-table', msg: 'The service_status table is missing from the connected module — Services telemetry is disabled (live subscription skipped). The connected module may be older than prod.' });
    // Service heartbeats (service_status): a dead service stops reporting, so a
    // stale row is as loud an alarm as an explicit unhealthy report. Keys are
    // per-service so each transition toasts once.
    for (const s of sv.list || []) {
      if (s.stale)
        alerts.push({ key: `svc-stale-${s.service}`, msg: `Service "${s.service}" has gone quiet — last heartbeat ${fmtAge(s.ageMs)} ago (> ${fmtAge(SERVICE_STALE_MS)}). It may be down.` });
      else if (!s.healthy)
        alerts.push({ key: `svc-down-${s.service}`, msg: `Service "${s.service}" reports UNHEALTHY: ${s.detail || 'no detail'}.` });
    }
    this.alerts = alerts;
    const active = new Set(alerts.map((a) => a.key));
    // Fire a toast only on the active-transition; clear the memo when it resolves.
    for (const a of alerts) {
      if (!this._firedAlerts.has(a.key)) {
        this._firedAlerts.add(a.key);
        if (typeof window !== 'undefined' && window.toast) window.toast(a.msg, { type: 'error', title: '🔭 Observatory alert' });
      }
    }
    for (const k of [...this._firedAlerts]) if (!active.has(k)) this._firedAlerts.delete(k);
  }

  // ── shell: header (status + refresh) · nav rail · body ──
  _paintShell() {
    const root = this.dom.root;
    clear(root);
    this.dom.header = h('div', { class: 'at-header' });
    const nav = h('nav', { class: 'at-nav' }, SECTIONS.map((s) => {
      const btn = h('button', {
        class: 'at-nav-btn' + (s.id === this.section ? ' is-active' : ''),
        onClick: () => this._go(s.id),
      }, [h('span', { class: 'at-nav-glyph', text: s.glyph }), h('span', { text: s.label })]);
      btn.dataset.section = s.id;
      return btn;
    }));
    this.dom.nav = nav;
    this.dom.body = h('div', { class: 'at-body' });
    root.appendChild(this.dom.header);
    root.appendChild(h('div', { class: 'at-main' }, [nav, this.dom.body]));
    this._paintHeader();
  }

  _go(id) {
    this.section = id;
    for (const b of this.dom.nav.querySelectorAll('.at-nav-btn')) {
      b.classList.toggle('is-active', b.dataset.section === id);
    }
    this._paintBody();
  }

  _paintHeader() {
    const hd = this.dom.header;
    if (!hd) return;
    clear(hd);
    const status = (this.snap && this.snap.status) || this.model.status;
    const dot = h('span', { class: 'at-dot at-dot--' + status });
    const updated = this.snap ? new Date(this.snap.at).toLocaleTimeString() : '—';
    hd.appendChild(h('div', { class: 'at-title' }, [
      h('span', { class: 'at-title-mark', text: '✦' }),
      h('div', {}, [
        h('div', { class: 'at-title-main', text: 'The Observatory' }),
        h('div', { class: 'at-title-sub at-dim', text: 'Pentacles admin telemetry' }),
      ]),
    ]));
    hd.appendChild(h('div', { class: 'at-head-right' }, [
      h('div', { class: 'at-status' }, [dot, h('span', { text: status }),
        h('span', { class: 'at-dim', text: ` · updated ${updated}` })]),
      h('button', {
        class: 'at-refresh' + (this.loading ? ' is-loading' : ''),
        onClick: () => this.refresh(),
        text: this.loading ? '⟳ Refreshing…' : '⟳ Refresh',
      }),
    ]));
  }

  _paintBody() {
    const body = this.dom.body;
    if (!body) return;
    clear(body);
    if (!this.snap) {
      body.appendChild(h('div', { class: 'at-empty at-dim', text: this.loading ? 'Gathering telemetry…' : 'No data yet.' }));
      return;
    }
    if (this.lastError) {
      body.appendChild(h('div', { class: 'at-banner at-banner--err', text: 'Telemetry error: ' + (this.lastError.message || this.lastError) }));
    }
    if (this.alerts && this.alerts.length) {
      body.appendChild(h('div', { class: 'at-alerts' }, this.alerts.map((a) =>
        h('div', { class: 'at-alert' }, [h('span', { class: 'at-alert-mark', text: '▲' }), h('span', { text: a.msg })]))));
    }
    if (!this.snap.live) {
      body.appendChild(h('div', { class: 'at-banner', text: 'Offline / no live host — showing the empty structure. Connect to a SpacetimeDB host to populate.' }));
    }
    const fn = this['_sec_' + this.section];
    if (fn) fn.call(this, body, this.snap);
  }

  // ── small render primitives ──
  _kpiGrid(items) {
    return h('div', { class: 'at-kpis' }, items.map((it) => h('div', { class: 'at-kpi' + (it.warn ? ' is-warn' : '') }, [
      h('div', { class: 'at-kpi-v', text: it.value, style: it.color ? { color: it.color } : null }),
      h('div', { class: 'at-kpi-k at-dim', text: it.label }),
      it.sub ? h('div', { class: 'at-kpi-sub at-dim', text: it.sub }) : null,
    ])));
  }
  _panel(title, children, sub) {
    return h('div', { class: 'at-panel' }, [
      h('div', { class: 'at-panel-head' }, [
        h('span', { class: 'at-panel-title', text: title }),
        sub ? h('span', { class: 'at-panel-sub at-dim', text: sub }) : null,
      ]),
      ...(Array.isArray(children) ? children : [children]),
    ].filter(Boolean));
  }
  _bars(rows, opts = {}) {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return h('div', { class: 'at-bars' }, rows.map((r) => h('div', { class: 'at-bar-row' }, [
      h('span', { class: 'at-bar-label', text: r.label, style: r.color ? { color: r.color } : null }),
      h('div', { class: 'at-bar-track' }, [h('div', { class: 'at-bar-fill', style: { width: `${(r.value / max) * 100}%`, background: r.color || 'var(--ac-gold)' } })]),
      h('span', { class: 'at-bar-val', text: opts.fmt ? opts.fmt(r.value) : fmtNum(r.value) }),
    ])));
  }
  _table(head, rows) {
    return h('table', { class: 'at-table' }, [
      h('thead', {}, h('tr', {}, head.map((c) => h('th', { text: c })))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => (c && c.nodeType ? h('td', {}, c) : h('td', { text: c == null ? '—' : String(c) })))))),
    ]);
  }
  _factionBars(arr, fmt) {
    return this._bars(arr.map((v, i) => ({ label: planetTag(i), value: v, color: PLANET_COLORS[i] })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value), { fmt });
  }

  // ════════ SECTIONS ════════

  _sec_overview(body, snap) {
    const hh = snap.health || {}, p = snap.players || {}, w = snap.war || {}, d = snap.duels || {}, dx = snap.dex || {}, sv = snap.services || {};
    const tickWarn = hh.lastTickAgeMs != null && hh.lastTickAgeMs > 5 * 60_000;
    body.appendChild(this._kpiGrid([
      { label: 'Players', value: fmtNum(p.total), sub: `${fmtNum(p.active24)} active 24h` },
      { label: 'New (24h)', value: fmtNum(p.new24), sub: `${fmtNum(p.new7d)} this week` },
      { label: 'Token supply', value: fmtNum(p.tokenSupply), sub: 'in circulation' },
      { label: 'Sky tick age', value: fmtAge(hh.lastTickAgeMs), warn: tickWarn, sub: `${hh.ephemerisBodies || 0} bodies · ${hh.retrogradeBodies || 0} ℞` },
      { label: 'Oracle backlog', value: fmtNum(d.oracleBacklog), warn: (d.oracleBacklog || 0) > 0, sub: `${fmtNum(d.oracleRequests)} asked` },
      { label: 'Attestor backlog', value: fmtNum(dx.traceBacklog), warn: (dx.traceBacklog || 0) > 0, sub: `${fmtNum(dx.traceIntents)} traces` },
      { label: 'Zones held', value: `${10 - (w.neutralZones ?? 0)}/${(w.zones || []).length || 11}`, sub: `${fmtNum(w.neutralZones)} neutral` },
      { label: 'Blocks minted', value: fmtNum(dx.blocks), sub: `${fmtNum(dx.blocksOnchain)} on-chain` },
    ]));
    // System health checklist
    const checks = [
      ['Live connection', snap.live, snap.status],
      ['Sky tick timer armed', hh.skyTimerArmed, hh.skyTimerArmed ? 'scheduled' : 'NOT armed'],
      ['Sky tick fresh (<5m)', !tickWarn && hh.lastTickAgeMs != null, fmtAge(hh.lastTickAgeMs)],
      ['Stars seeded', hh.seeded, `cursor ${fmtNum(hh.starSeedCursor)}`],
      ['Constellations seeded', hh.constellationsSeeded, dx.pools ? `${dx.pools} pools` : ''],
      ['Oracle service keeping up', (d.oracleBacklog || 0) === 0, `${fmtNum(d.oracleBacklog)} pending`],
      ['Attestor service keeping up', (dx.traceBacklog || 0) === 0, `${fmtNum(dx.traceBacklog)} pending`],
      ['Service heartbeats fresh', (sv.total || 0) > 0 && (sv.stale || 0) === 0 && (sv.unhealthy || 0) === 0,
        this._svcTableMissing ? 'awaiting module publish (no service_status table)'
          : (sv.total || 0) ? `${fmtNum(sv.healthy)}/${fmtNum(sv.total)} healthy${sv.stale ? ` · ${fmtNum(sv.stale)} stale` : ''}` : 'none reporting'],
    ];
    body.appendChild(this._panel('System health', h('div', { class: 'at-checks' }, checks.map(([label, ok, note]) =>
      h('div', { class: 'at-check' }, [
        h('span', { class: 'at-check-mark ' + (ok ? 'ok' : 'bad'), text: ok ? '✓' : '✕' }),
        h('span', { class: 'at-check-label', text: label }),
        h('span', { class: 'at-check-note at-dim', text: note || '' }),
      ])))));
    body.appendChild(this._panel('Season', this._kpiGrid([
      { label: 'Season degree', value: hh.seasonDegree != null ? `${hh.seasonDegree}°` : '—' },
      { label: 'World ascendant', value: hh.ascendantDegree != null ? `${hh.ascendantDegree}°` : '—' },
      { label: 'Owner', value: hh.owner ? short(hh.owner) : '—', sub: 'module owner identity' },
    ])));
  }

  _sec_players(body, snap) {
    const p = snap.players || {};
    body.appendChild(this._kpiGrid([
      { label: 'Total players', value: fmtNum(p.total) },
      { label: 'Active (24h)', value: fmtNum(p.active24), sub: `${pct(p.retention24)} retention · ${fmtNum(p.active1h)} in 1h` },
      { label: 'New (24h)', value: fmtNum(p.new24), sub: `${fmtNum(p.new7d)} in 7d` },
      { label: 'Token supply', value: fmtNum(p.tokenSupply), sub: `${fmtNum(p.avgTokens)} avg / player` },
      { label: 'Whale share', value: pct(p.topHolderShare), warn: (p.topHolderShare || 0) > 0.5, sub: 'top holder of supply' },
      { label: 'Duelists', value: fmtNum(p.withWins), sub: `${fmtNum(p.totalWins)} total wins` },
    ]));
    body.appendChild(this._panel('Faction distribution', this._factionBars(p.factions || []), `${(p.factions || []).filter((v) => v > 0).length}/10 factions represented`));
    const lb = (rows, valKey, valLabel) => this._table(['#', 'Seeker', 'Faction', valLabel], (rows || []).map((r, i) => [
      String(i + 1), r.handle || '—',
      h('span', { style: { color: PLANET_COLORS[r.faction] }, text: planetTag(r.faction) }),
      fmtNum(r[valKey]),
    ]));
    body.appendChild(h('div', { class: 'at-two' }, [
      this._panel('Top by tokens', lb(p.topByTokens, 'tokens', 'Tokens')),
      this._panel('Top by duel wins', lb(p.topByWins, 'wins', 'Wins')),
    ]));
  }

  _sec_economy(body, snap) {
    const e = snap.economy || {};
    const ELEM_COLORS = ['#cba6f7', '#94e2d5', '#a6adc8', '#f9e2af'];
    const SUIT_COLORS = { Wands: '#cf6a4d', Cups: '#5fb6c4', Swords: '#9aa7c4', Pentacles: '#cf9a52' };
    body.appendChild(this._kpiGrid([
      { label: 'Cards minted', value: fmtNum(e.cards), sub: e.cardComposed ? `${fmtNum(e.trumps)} trumps · ${fmtNum(e.inverted)} ℞` : null },
      { label: 'Lettered cards', value: e.cardComposed ? fmtNum(e.lettered) : '—', sub: 'word-duel tiles' },
      { label: 'Decan cards', value: fmtNum(e.decanCards), sub: `${fmtNum(e.deckSlots)} deck slots` },
      { label: 'Trades', value: fmtNum(e.trades), sub: `${fmtNum(e.openTrades)} open · ${fmtNum(e.cardsEscrowed)} cards escrowed` },
      { label: 'Jing pools', value: fmtNum(e.jingPools) },
      { label: 'Star stakes', value: fmtNum(e.stakes) },
      { label: 'Staked USDC', value: '$' + fmtNum(e.stakePrincipalUsdc) },
      { label: 'Essence accrued', value: fmtNum(e.stakeAccruedEssence), sub: `${fmtNum(e.stakeClaimedEssence)} claimed` },
    ]));
    if (e.cardComposed) {
      body.appendChild(h('div', { class: 'at-two' }, [
        this._panel('Cards by suit', this._bars(Object.entries(e.cardsBySuit || {}).map(([k, v]) => ({ label: k, value: v, color: SUIT_COLORS[k] })))),
        this._panel('Cards by combine level', this._bars(Object.entries(e.cardsByLevel || {}).map(([k, v]) => ({ label: k, value: v })))),
      ]));
    }
    const ts = e.tradeStates || {};
    body.appendChild(h('div', { class: 'at-two' }, [
      this._panel('Trades by state', Object.keys(ts).length ? this._bars(Object.entries(ts).map(([k, v]) => ({ label: k, value: v }))) : h('div', { class: 'at-dim', text: 'No trades yet.' })),
      this._panel('Star stakes by element', this._bars((e.stakesByElement || []).map((v, i) => ({ label: ESMS_NAMES[i], value: v, color: ELEM_COLORS[i] })))),
    ]));
  }

  _sec_war(body, snap) {
    const w = snap.war || {};
    const kinds = w.heldByKind || {};
    body.appendChild(this._kpiGrid([
      { label: 'Zones held', value: `${(w.zones || []).length - (w.neutralZones ?? 0)}/${(w.zones || []).length}`, sub: `H${kinds.House || 0} · S${kinds.Spire || 0} · ${kinds.Crown ? '👑' : '—'}` },
      { label: 'Contested', value: fmtNum(w.contestedZones), warn: (w.contestedZones || 0) > 0, sub: 'within ±200 of flipping' },
      { label: 'War leader', value: w.leadFaction >= 0 ? planetTag(w.leadFaction) : '—', color: PLANET_COLORS[w.leadFaction], sub: `${fmtNum(w.leadFactionZones)} zones` },
      { label: 'Crown holder', value: w.crownOwner >= 0 ? planetTag(w.crownOwner) : 'Neutral', color: PLANET_COLORS[w.crownOwner] },
      { label: 'Stars held', value: `${fmtNum(w.starsHeld)}/${fmtNum(w.starsTotal)}`, sub: pct(w.starsTotal ? w.starsHeld / w.starsTotal : 0) },
      { label: 'Battles', value: fmtNum(w.battles), sub: `${pct(w.battleWinRate)} attacker wins` },
      { label: 'Live PvP duels', value: fmtNum(w.pvpDuels), sub: `${fmtNum(w.queueDepth)} queued` },
      { label: 'Control pressure', value: fmtNum(w.totalPressure), sub: 'Σ|control| across zones' },
    ]));
    body.appendChild(this._panel('Zone board', this._table(['Zone', 'Kind', 'Owner', 'Control'], (w.zones || []).map((z) => [
      `#${z.id}`, z.kind,
      h('span', { style: { color: PLANET_COLORS[z.owner] }, text: planetTag(z.owner) }),
      h('div', { class: 'at-meter' }, [
        h('div', { class: 'at-meter-fill', style: { width: `${((z.control + 1000) / 2000) * 100}%`, background: PLANET_COLORS[z.owner] || 'var(--ac-dim)' } }),
        h('span', { class: 'at-meter-num', text: String(z.control) }),
      ]),
    ]))));
    body.appendChild(h('div', { class: 'at-two' }, [
      this._panel('Zones by faction', this._factionBars(w.zonesByFaction || [])),
      this._panel('Stars by faction', this._factionBars(w.starsByFaction || [])),
    ]));
  }

  _sec_ai(body, snap) {
    const d = snap.duels || {};
    const lat = d.oracleLatencyMs || {};
    body.appendChild(this._kpiGrid([
      { label: 'Oracle requests', value: fmtNum(d.oracleRequests), sub: `${fmtNum(d.oracle24)} in 24h` },
      { label: 'Oracle backlog', value: fmtNum(d.oracleBacklog), warn: (d.oracleBacklog || 0) > 0, sub: `${pct(d.oracleAnsweredRate)} answered` },
      { label: 'Cache hit rate', value: pct(d.oracleCacheHitRate), sub: `${fmtNum(d.oracleCache)} cached answers` },
      { label: 'Oracle latency', value: lat.p50 != null ? fmtAge(lat.p50) : '—', sub: `p95 ${lat.p95 != null ? fmtAge(lat.p95) : '—'}` },
      { label: 'Word duels', value: fmtNum(d.word), sub: `${pct(d.wordWinRate)} win · ${fmtNum(d.word24)} today` },
      { label: 'Tokens awarded', value: fmtNum(d.wordTokensAwarded), sub: 'via word duels' },
      { label: 'Jing duels', value: fmtNum(d.jingDuels), sub: `${fmtNum(d.jingCasts)} casts · ${fmtNum(d.jing24)} today` },
      { label: 'Open challenges', value: fmtNum(d.openChallenges) },
    ]));
    body.appendChild(h('div', { class: 'at-two' }, [
      this._panel('Oracle answers by model', this._bars(Object.entries(d.oracleByModel || {}).map(([k, v]) => ({ label: k, value: v }))), 'which Claude tier / cache served each reply'),
      this._panel('Jing arena by state', this._bars(Object.entries(d.jingStates || {}).map(([k, v]) => ({ label: k, value: v })))),
    ]));
  }

  _sec_agents(body, snap) {
    const a = snap.agents || {};
    const ELEM_COLORS = ['#cba6f7', '#94e2d5', '#a6adc8', '#f9e2af'];
    body.appendChild(this._kpiGrid([
      { label: 'Agent charts', value: fmtNum(a.agentCharts), sub: `${fmtNum(a.agentTimed)} timed · ${fmtNum(a.agentSolar)} solar` },
      { label: 'Star agents', value: `${fmtNum(a.starAgentsActive)}/${fmtNum(a.starAgents)}`, sub: 'active / total' },
      { label: 'Comets', value: `${fmtNum(a.cometsActive)}/${fmtNum(a.comets)}`, sub: (a.cometNames || []).join(', ') || null },
    ]));
    if ((a.starByElement || []).some((v) => v > 0)) {
      body.appendChild(this._panel('Star agents by element', this._bars((a.starByElement || []).map((v, i) => ({ label: ESMS_NAMES[i], value: v, color: ELEM_COLORS[i] })))));
    }
    body.appendChild(this._panel('Agent roster', h('div', { class: 'at-chips' },
      (a.agentNames || []).length ? a.agentNames.map((n) => h('span', { class: 'at-chip', text: n }))
        : [h('span', { class: 'at-dim', text: 'No agent charts seeded.' })]),
      `${fmtNum(a.agentCharts)} total`));
  }

  _sec_dex(body, snap) {
    const dx = snap.dex || {};
    body.appendChild(this._kpiGrid([
      { label: 'Pools', value: fmtNum(dx.pools), sub: `${fmtNum(dx.degeneratePools)} single-element` },
      { label: 'Member stars', value: fmtNum(dx.memberStars), sub: `${fmtNum(dx.memberStarsSeed)} seeded slots` },
      { label: 'Blocks minted', value: fmtNum(dx.blocks), sub: `${fmtNum(dx.blocksOnchain)} on-chain · ${fmtNum(dx.uniqueMinters)} minters` },
      { label: 'Resolved figures', value: `${fmtNum(dx.resolvedPools)}/${fmtNum(dx.resolutions)}`, sub: `avg Lv ${(dx.avgResolution || 0).toFixed(1)}` },
      { label: 'Trace intents', value: fmtNum(dx.traceIntents), sub: `${fmtNum(dx.traceAttested)} attested` },
      { label: 'Attestor backlog', value: fmtNum(dx.traceBacklog), warn: (dx.traceBacklog || 0) > 0 },
      { label: 'Attestations', value: fmtNum(dx.attestations) },
    ]));
    body.appendChild(h('div', { class: 'at-two' }, [
      this._panel('Pools by ESMS pair', this._bars(Object.entries(dx.esmsPairs || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v }))), 'the AMM token pair each figure trades'),
      this._panel('Fee tiers', this._bars(Object.entries(dx.feeTiers || {}).sort((a, b) => Number(a[0].replace('%', '')) - Number(b[0].replace('%', ''))).map(([k, v]) => ({ label: k, value: v })))),
    ]));
    if ((dx.topResolved || []).length) {
      body.appendChild(this._panel('Top resolved figures', this._table(['Figure', 'Resolution', 'Stars added'],
        (dx.topResolved || []).map((r) => [r.name, `Lv ${r.level}`, fmtNum(r.added)])),
        'constellations growing on-chain via minted blocks'));
    }
  }

  _sec_sky(body, snap) {
    const s = snap.sky || {}, hh = snap.health || {};
    const bodies = s.bodies || [];
    const retro = bodies.filter((b) => b.retrograde);
    if (!bodies.length) {
      body.appendChild(h('div', { class: 'at-banner at-banner--err', text: 'No ephemeris rows — the sky tick / feeder is not pushing positions to this module.' }));
    }
    body.appendChild(this._kpiGrid([
      { label: 'Bodies tracked', value: fmtNum(bodies.length), sub: 'of 10 planets' },
      { label: 'Retrograde', value: fmtNum(retro.length), sub: retro.map((b) => PLANET_GLYPHS[b.body]).join(' ') || 'none' },
      { label: 'Last tick', value: fmtAge(hh.lastTickAgeMs), warn: hh.lastTickAgeMs == null || hh.lastTickAgeMs > 5 * 60_000 },
      { label: 'Tick timer', value: hh.skyTimerArmed ? 'Armed' : 'Stopped', warn: !hh.skyTimerArmed },
    ]));
    // Transit occupancy: how many bodies are currently buffing each of the 11 zones.
    const occ = new Array(11).fill(0);
    for (const b of bodies) if (b.zone >= 0 && b.zone < 11) occ[b.zone] += 1;
    if (bodies.length) {
      body.appendChild(this._panel('Transit occupancy by zone', this._bars(occ.map((v, i) => ({ label: `Zone #${i}`, value: v })).filter((r) => r.value > 0)), 'bodies currently transiting each zone (the capture buff)'));
    }
    body.appendChild(this._panel('Ephemeris', bodies.length ? this._table(['Body', 'RA', 'Dec', 'Zone', '℞', 'Tick age'],
      bodies.map((b) => [
        h('span', { style: { color: PLANET_COLORS[b.body] }, text: `${b.body != null ? PLANET_GLYPHS[b.body] : '·'} ${b.name || '—'}` }),
        b.ra.toFixed(2), b.dec.toFixed(2), `#${b.zone}`, b.retrograde ? '℞' : '', fmtAge(b.ageMs),
      ])) : h('div', { class: 'at-dim', text: 'Empty — no live positions.' })));
  }

  // Service heartbeats (service_status rows, fed by `report_service_health`).
  // A dead feeder cannot report its own death — it just stops upserting — so a
  // row older than SERVICE_STALE_MS is flagged STALE: staleness IS the signal.
  _sec_services(body, snap) {
    const sv = snap.services || {};
    const list = sv.list || [];
    if (this._svcTableMissing) {
      body.appendChild(h('div', { class: 'at-banner', text: 'The service_status table is not in the connected module yet — awaiting module publish. Its live subscription was skipped (probe failed); this panel populates once the republish lands.' }));
    }
    body.appendChild(this._kpiGrid([
      { label: 'Services reporting', value: fmtNum(sv.total), sub: 'via report_service_health' },
      { label: 'Healthy', value: fmtNum(sv.healthy), sub: 'fresh + healthy' },
      { label: 'Unhealthy', value: fmtNum(sv.unhealthy), warn: (sv.unhealthy || 0) > 0, sub: 'self-reported down' },
      { label: `Stale (>${fmtAge(SERVICE_STALE_MS)})`, value: fmtNum(sv.stale), warn: (sv.stale || 0) > 0, sub: 'no heartbeat — presumed down' },
    ]));
    const badge = (s) => {
      if (s.stale) return h('span', {}, [
        h('span', { class: 'at-check-mark bad', text: '✕' }),
        h('span', { text: ` STALE — last said ${s.healthy ? 'healthy' : 'unhealthy'}` }),
      ]);
      return h('span', {}, [
        h('span', { class: 'at-check-mark ' + (s.healthy ? 'ok' : 'bad'), text: s.healthy ? '✓' : '✕' }),
        h('span', { text: s.healthy ? ' Healthy' : ' Unhealthy' }),
      ]);
    };
    body.appendChild(this._panel('Service heartbeats', list.length
      ? this._table(['Service', 'Status', 'Detail', 'Latency', 'Last report'], list.map((s) => [
          s.service,
          badge(s),
          s.detail || '—',
          s.latencyMs > 0 ? `${fmtNum(s.latencyMs)} ms` : 'self-report',
          h('span', { class: s.stale ? '' : 'at-dim', text: s.ageMs != null ? `${fmtAge(s.ageMs)} ago` : '—' }),
        ]))
      : h('div', { class: 'at-dim', text: 'No services have reported yet — the feeders call report_service_health on their heartbeat.' }),
      `a row goes STALE after ${fmtAge(SERVICE_STALE_MS)} without a heartbeat`));
  }

  _sec_console(body) {
    body.appendChild(h('div', { class: 'at-banner', text: 'Read-only SQL against the live module. SELECT only — writes are rejected here.' }));
    const input = h('textarea', { class: 'at-sql', rows: '3', placeholder: 'SELECT handle, tokens FROM player' });
    const out = h('div', { class: 'at-sql-out at-dim', text: 'Results appear here.' });
    const run = async () => {
      const sql = String(input.value || '').trim();
      if (!sql) return;
      if (!/^\s*select/i.test(sql)) { clear(out); out.appendChild(h('div', { class: 'at-banner at-banner--err', text: 'Only SELECT queries are allowed.' })); return; }
      clear(out); out.appendChild(h('div', { class: 'at-dim', text: 'Running…' }));
      try {
        const rows = await this.spacetime.query(sql);
        clear(out);
        if (!rows.length) { out.appendChild(h('div', { class: 'at-dim', text: '(0 rows)' })); return; }
        const cols = Object.keys(rows[0]);
        out.appendChild(this._table(cols, rows.slice(0, 200).map((r) => cols.map((c) => fmtCell(r[c])))));
        out.appendChild(h('div', { class: 'at-dim', text: `${rows.length} row(s)${rows.length > 200 ? ' — showing first 200' : ''}` }));
      } catch (err) {
        clear(out); out.appendChild(h('div', { class: 'at-banner at-banner--err', text: String(err.message || err) }));
      }
    };
    input.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') run(); });
    const presets = [
      ['Players', 'SELECT handle, faction, tokens, word_wins FROM player'],
      ['Oracle backlog', 'SELECT request_id, question, answered FROM oracle_request WHERE answered = false'],
      ['Zones', 'SELECT zone_id, kind, owner, control FROM zone'],
      ['Recent word duels', 'SELECT duel_id, player_word, won, tokens_awarded FROM word_duel'],
    ];
    body.appendChild(this._panel('Query', [
      h('div', { class: 'at-sql-presets' }, presets.map(([label, q]) => h('button', { class: 'at-chip at-chip--btn', text: label, onClick: () => { input.value = q; } }))),
      input,
      h('div', { class: 'at-sql-actions' }, [
        h('button', { class: 'at-refresh', text: 'Run (⌘↵)', onClick: run }),
        h('span', { class: 'at-dim', text: 'read-only' }),
      ]),
      out,
    ]));

    this._adminActions(body);
  }

  // ── Owner-gated admin actions (the server enforces sender == game_config.owner;
  //    a non-owner call just returns "admin only"). Confirm-guarded; mutate prod. ──
  _adminActions(body) {
    const status = h('div', { class: 'at-action-status at-dim', text: '' });
    const setStatus = (msg, err) => { clear(status); status.appendChild(h('span', { class: err ? 'at-action-err' : 'at-action-ok', text: msg })); };
    const call = async (name, args, label) => {
      try {
        setStatus(`Calling ${name}…`);
        await this.spacetime.callReducer(name, args);
        setStatus(`✓ ${label} sent`, false);
        if (window.toast) window.toast(`${label} dispatched.`, { type: 'success', title: '🔭 Observatory' });
        setTimeout(() => this.refresh(), 800);
      } catch (e) {
        setStatus(`✕ ${e.message || e}`, true);
      }
    };

    const keepInput = h('input', { class: 'at-action-input', type: 'text', placeholder: 'agent keys to KEEP, comma-separated (e.g. jung,hypatia,chiron)' });

    const backfill = h('button', { class: 'at-action-btn', text: 'Backfill decans', onClick: () => {
      if (!confirm('Run backfill_decans? Idempotent — recomputes every player\'s natal_decan rows from their chart.')) return;
      call('backfill_decans', [], 'Backfill decans');
    } });

    const purge = h('button', { class: 'at-action-btn at-action-btn--danger', text: 'Purge stale agents', onClick: () => {
      const keys = String(keepInput.value || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!keys.length) { setStatus('Enter the agent keys to KEEP before purging.', true); return; }
      const typed = prompt(`This DELETES every seeded agent whose key is NOT in:\n${keys.join(', ')}\n\nReal human players are never touched. Type PURGE to confirm.`);
      if (typed !== 'PURGE') { setStatus('Purge cancelled.', false); return; }
      call('purge_stale_agents', [keys], 'Purge stale agents');
    } });

    body.appendChild(this._panel('Admin actions', [
      h('div', { class: 'at-banner', text: 'Owner-gated reducers — they mutate live state. Only the module owner identity can run them.' }),
      h('div', { class: 'at-action-row' }, [backfill, h('span', { class: 'at-dim', text: 'recompute decan cards · safe & idempotent' })]),
      h('div', { class: 'at-action-row' }, [purge, keepInput]),
      h('div', { class: 'at-dim', text: 'Note: the sky tick (tick_sky) runs automatically on its schedule — there is no manual trigger.' }),
      status,
    ], 'owner only'));
  }

  destroy() {
    this._destroyed = true; // stops a still-in-flight service_status probe from subscribing late
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    for (const u of this._unsub) { try { u(); } catch {} }
    this._unsub = [];
    if (this.el) clear(this.el);
  }
}

function short(id) { const s = String(id); return s.length > 12 ? s.slice(0, 6) + '…' + s.slice(-4) : s; }
function fmtCell(v) {
  if (v == null) return '—';
  if (typeof v === 'object') {
    const inner = v.__identity__ ?? v.__connection_id__;
    if (inner) return short(inner);
    if (v.__timestamp_micros_since_unix_epoch__ != null || v.microsSinceUnixEpoch != null) {
      const ms = toMs(v);
      return ms != null ? new Date(ms).toLocaleString() : JSON.stringify(v);
    }
    return JSON.stringify(v);
  }
  if (typeof v === 'string' && v.length > 48) return v.slice(0, 46) + '…';
  return String(v);
}

export function create(opts) { return new AdminTelemetryInstance(opts); }
export const version = '0.1.0';
const AdminTelemetry = { create, version };
export default AdminTelemetry;
if (typeof window !== 'undefined') window.AdminTelemetry = AdminTelemetry;
