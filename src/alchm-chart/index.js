/* ============================================================
   AlchmChart — embeddable factory + lifecycle
   ============================================================
   Framework-agnostic. Owns RENDERING + MATH only; all data (chart engine,
   AMM reads, wallet, sky catalog) is injected via `providers`, so the same
   module mounts as a Pentacles overlay and drops into any alchm host.

     const chart = AlchmChart.create({ el, providers, ... })
     chart.mount(); chart.setFrame('natal'); chart.destroy()
   ============================================================ */
import { h, clear } from "./dom.js";
import {
  enrichAspects, transitAspects, blendedSMES, poolPressure, footprintsFromMembers, bodyVelocity,
  DEFAULT_WEIGHTS, compute,
} from "./math.js";
import { renderSmes, renderPools, renderReading, renderTransitStrip } from "./render-pools.js";
import { renderScrubber, syncScrubberThumb, setScrubberDate } from "./scrubber.js";

const DEFAULT_ESMS = {
  names: ["Spirit", "Essence", "Matter", "Substance"],
  glyphs: ["🜂", "🜄", "🜃", "🜁"],
  colors: ["#e0a23a", "#4aa3d8", "#5fb37a", "#b98cd6"],
};

function enrichPool(raw, meta, toNumber) {
  const m = meta || {};
  const aNum = raw.reserveA != null ? toNumber(raw.reserveA) : 0;
  const bNum = raw.reserveB != null ? toNumber(raw.reserveB) : 0;
  const hasLiq = aNum > 0 && bNum > 0;
  return {
    ...m, constId: raw.constId, exists: raw.exists, failed: !!raw.failed,
    elemA: raw.elemA != null ? raw.elemA : (m.pair ? m.pair[0] : 0),
    elemB: raw.elemB != null ? raw.elemB : (m.pair ? m.pair[1] : 3),
    pair: m.pair || [raw.elemA, raw.elemB], feeBps: raw.feeBps,
    aNum, bNum, hasLiq, fracA: hasLiq ? aNum / (aNum + bNum) : 0, spot: hasLiq ? bNum / aNum : null,
  };
}

class AlchmChartInstance {
  constructor(opts) {
    this.opts = opts || {};
    const sky = this.opts.providers && this.opts.providers.sky;
    this.providers = this.opts.providers || {};
    this.poolMeta = (this.opts.pools || (sky && sky.CONSTELLATIONS) || []).map((c) => ({ ...c, constId: c.id != null ? c.id : c.constId }));
    this.esms = this.opts.esms || (sky && sky.ESMS_NAMES ? { names: sky.ESMS_NAMES, glyphs: sky.ESMS_GLYPHS, colors: sky.ESMS_COLORS } : DEFAULT_ESMS);
    this.glyphs = this.opts.glyphs || {
      sign: sky && sky.SIGN_GLYPHS, planet: sky && sky.PLANET_GLYPHS, planetColor: sky && sky.PLANET_COLORS, planetName: sky && sky.PLANET_NAMES,
    };
    const now = this.opts.date instanceof Date ? this.opts.date : new Date();
    this.state = {
      el: this.opts.el || null,
      frame: this.opts.frame || "mundane",
      observer: this.opts.observer || { lat: 40.7128, lon: -74.006 },
      date: now, anchor: new Date(now.getTime()),
      zoom: this.opts.zoom || "month",
      houseSystem: this.opts.houseSystem || "placidus",
      weights: this.opts.weights || DEFAULT_WEIGHTS,
      esms: this.esms, glyphs: this.glyphs,
      poolMeta: this.poolMeta, pools: null,
      chart: null, smes: null, pressures: {}, footprints: null,
      dom: {}, hooks: {},
    };
    this._raf = 0; this._pendingDate = null; this._unsub = []; this._listeners = {};
    // bind hooks the renderers call
    this.state.hooks = {
      onSelect: (p) => this._select(p),
      onScrub: (d) => this._scrub(d),
      onZoom: (z) => this.setZoom(z),
      onNow: () => this.now(),
      refreshPools: () => this.refreshPools(),
    };
  }

  // ── lifecycle ──
  mount(el) {
    if (el) this.state.el = el;
    const host = this.state.el;
    if (!host) throw new Error("AlchmChart.mount: no element");
    clear(host);
    host.classList.add("alchm-chart");
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) host.classList.add("ac-reduced");

    const d = this.state.dom;
    d.header = h("div", { class: "ac-header" });
    d.track = h("div", { class: "ac-track ac-dome-host" });
    d.transitStrip = h("div", { class: "ac-transit" });
    d.smes = h("div", { class: "ac-smes" });
    d.reading = h("div", { class: "ac-reading-host" });
    d.pools = h("div", { class: "ac-pools" });
    d.scrubber = h("div", { class: "ac-scrubber" });
    d.pop = h("div", { class: "ac-pop", hidden: true });
    // app-shell: header / 3-column body [temperament+reading · dome+transit · pools] / scrubber.
    // The render layer still targets d.smes/d.reading/d.track/etc.; only the wrappers are new.
    d.empty = h("div", { class: "ac-empty", hidden: true });
    d.colLeft = h("div", { class: "ac-col ac-col--left", dataset: { pane: "temperament" } }, [d.smes, d.reading]);
    d.colCenter = h("div", { class: "ac-col ac-col--center", dataset: { pane: "dome" } }, [d.track, d.transitStrip, d.empty]);
    d.colRight = h("div", { class: "ac-col ac-col--right", dataset: { pane: "pools" } }, [d.pools]);
    d.body = h("div", { class: "ac-body" }, [d.colLeft, d.colCenter, d.colRight]);
    host.appendChild(d.header);
    host.appendChild(d.body);
    host.appendChild(d.scrubber);
    host.appendChild(d.pop);
    d.mobileNav = this._buildMobileNav();
    host.appendChild(d.mobileNav);

    this._buildHeader();
    renderScrubber(d.scrubber, this.state);
    this.recompute();
    this.paint();
    this._mountDome();
    this.refreshPools();
    if (this.providers.amm && this.providers.amm.onChange) this._unsub.push(this.providers.amm.onChange(() => this.refreshPools()));
    this._esc = (e) => { if (e.key === "Escape" && !d.pop.hidden) this._closePop(); };
    document.addEventListener("keydown", this._esc);
    return this;
  }

  /** Lazy-load the Three.js dome (keeps `three` out of the host's initial bundle). */
  _mountDome() {
    const host = this.state.dom.track;
    host.appendChild(h("div", { class: "ac-dome-loading", text: "rendering sky…" }));
    import("./render-dome.js").then(({ createDome }) => {
      if (this._destroyed) return;
      this._dome = createDome(host, this.state, this.state.hooks);
      this._dome.update(this.state);
      host.appendChild(this._buildLegend());
    }).catch((e) => {
      console.warn("[AlchmChart] dome failed to load", e);
      clear(host);
      host.appendChild(h("div", { class: "ac-dome-fail" }, [
        h("div", { class: "ac-empty-card" }, [
          h("div", { class: "ac-empty-glyph", text: "☁" }),
          h("div", { class: "ac-empty-title", text: "Sky unavailable" }),
          h("div", { class: "ac-empty-sub", text: "Couldn’t load the celestial renderer." }),
          h("button", { class: "ac-empty-cta", text: "Retry", onclick: () => { clear(host); this._mountDome(); } }),
        ]),
      ]));
    });
  }

  _buildLegend() {
    const items = [
      ["ac-lg-horizon", "gold ellipse — the horizon"],
      ["ac-lg-above", "bright dot — above horizon"],
      ["ac-lg-below", "dim dot — below horizon"],
      ["ac-lg-size", "dot size — chart salience"],
      ["ac-lg-applying", "gold curve — applying aspect"],
      ["ac-lg-separating", "dashed grey — separating"],
      ["ac-lg-pool", "colored arc — pool pressure"],
    ];
    const body = h("div", { class: "ac-legend-body", hidden: true });
    for (const [cls, label] of items) {
      body.appendChild(h("div", { class: "ac-legend-row" }, [h("span", { class: "ac-legend-key " + cls }), h("span", { text: label })]));
    }
    const chip = h("button", { class: "ac-legend-chip", "aria-label": "Toggle legend" }, [
      h("span", { class: "ac-legend-i", text: "ⓘ" }), h("span", { text: "Legend" }),
    ]);
    const wrap = h("div", { class: "ac-legend" }, [chip, body]);
    chip.onclick = () => { body.hidden = !body.hidden; wrap.classList.toggle("is-open", !body.hidden); };
    return wrap;
  }

  // ── mobile bottom nav (CSS-hidden on desktop) ──
  _buildMobileNav() {
    const items = [
      { id: "live", glyph: "◉", label: "Live View" },
      { id: "scrubber", glyph: "⏱", label: "Scrubber" },
      { id: "presets", glyph: "📍", label: "Presets" },
      { id: "data", glyph: "≣", label: "Data Feed" },
    ];
    const nav = h("div", { class: "ac-mobile-nav" });
    this.state.dom.navBtns = {};
    for (const it of items) {
      const btn = h("button", {
        class: "ac-mnav-btn" + (it.id === "live" ? " is-active" : ""), dataset: { nav: it.id },
        "aria-label": it.label, onclick: () => this._mobileAction(it.id),
      }, [h("span", { class: "ac-mnav-glyph", text: it.glyph }), h("span", { class: "ac-mnav-label", text: it.label })]);
      this.state.dom.navBtns[it.id] = btn;
      nav.appendChild(btn);
    }
    return nav;
  }
  _setMobileNavActive(which) {
    const btns = this.state.dom.navBtns || {};
    for (const k in btns) btns[k].classList.toggle("is-active", k === which);
  }
  _closeScrubSheet() { if (this.state.el) this.state.el.classList.remove("ac-scrub-open"); }
  _mobileAction(which) {
    const d = this.state.dom;
    const scrollTo = (el) => el && el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    if (which === "scrubber") {
      const open = this.state.el.classList.toggle("ac-scrub-open");
      this._setMobileNavActive(open ? "scrubber" : "live");
      return;
    }
    this._closeScrubSheet();
    if (which === "live") { this.now(); scrollTo(d.colCenter); }
    else if (which === "presets") { this._toggleObserver(); }
    else if (which === "data") { scrollTo(d.colRight); }
    this._setMobileNavActive(which);
  }

  _buildHeader() {
    const d = this.state.dom;
    clear(d.header);
    const frames = h("div", { class: "ac-frames" });
    for (const f of [{ id: "mundane", label: "Mundane" }, { id: "natal", label: "Natal" }, { id: "transit", label: "Transit" }]) {
      frames.appendChild(h("button", {
        class: "ac-frame-pill" + (this.state.frame === f.id ? " is-active" : ""), text: f.label, dataset: { frame: f.id },
        onclick: () => this.setFrame(f.id),
      }));
    }
    const houses = h("select", {
      class: "ac-house-sel", title: "House system", onchange: (e) => this.setHouseSystem(e.target.value),
    }, [
      h("option", { value: "placidus", text: "Placidus", selected: this.state.houseSystem === "placidus" }),
      h("option", { value: "whole", text: "Whole Sign", selected: this.state.houseSystem === "whole" }),
    ]);
    d.accuracy = h("span", { class: "ac-badge", hidden: true });
    d.caveat = h("span", { class: "ac-badge ac-badge--warn", hidden: true, text: "low-precision at this range" });
    d.observerChip = h("button", {
      class: "ac-observer-chip", title: "Set observer location", onclick: () => this._toggleObserver(),
    }, [h("span", { class: "ac-obs-pin", text: "📍" }), h("span", { class: "ac-obs-label" })]);
    d.observerPop = h("div", { class: "ac-obs-pop", hidden: true });
    d.header.appendChild(h("div", { class: "ac-title", text: "✦ Alchm Chart" }));
    d.header.appendChild(frames);
    d.header.appendChild(houses);
    d.header.appendChild(d.accuracy);
    d.header.appendChild(d.caveat);
    d.header.appendChild(h("div", { class: "ac-obs-wrap" }, [d.observerChip, d.observerPop]));
    this._updateObserverChip();
  }

  _updateObserverChip() {
    const o = this.state.observer, el = this.state.dom.observerChip;
    if (el) el.querySelector(".ac-obs-label").textContent = `${o.lat.toFixed(2)}°, ${o.lon.toFixed(2)}°`;
  }

  // ── observer selector popover ──
  _toggleObserver() {
    const pop = this.state.dom.observerPop;
    if (!pop.hidden) { pop.hidden = true; return; }
    this._buildObserverPop(pop);
    pop.hidden = false;
  }
  _buildObserverPop(pop) {
    clear(pop);
    const o = this.state.observer;
    const latIn = h("input", { class: "ac-obs-input", type: "number", step: "0.0001", value: String(o.lat.toFixed(4)) });
    const lonIn = h("input", { class: "ac-obs-input", type: "number", step: "0.0001", value: String(o.lon.toFixed(4)) });
    const apply = (lat, lon) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      lat = Math.max(-90, Math.min(90, lat)); lon = Math.max(-180, Math.min(180, lon));
      this.setObserver({ lat, lon });
      this._updateObserverChip();
      if (window.state) { window.state.observer = { lat, lon }; if (window.state.recomputeSky) try { window.state.recomputeSky(); } catch {} }
      pop.hidden = true;
    };
    const presets = [
      { name: "New York", lat: 40.7128, lon: -74.006 }, { name: "London", lat: 51.5074, lon: -0.1278 },
      { name: "Reykjavík", lat: 64.1466, lon: -21.9426 }, { name: "Cairo", lat: 30.0444, lon: 31.2357 },
      { name: "Tokyo", lat: 35.6762, lon: 139.6503 }, { name: "Equator", lat: 0, lon: 0 },
    ];
    const chips = h("div", { class: "ac-obs-presets" });
    for (const p of presets) chips.appendChild(h("button", { class: "ac-obs-preset", text: p.name, onclick: () => apply(p.lat, p.lon) }));
    pop.appendChild(h("div", { class: "ac-obs-title", text: "Observer" }));

    // city search — only when a geocode provider is wired (host supplies it)
    if (this.providers.geocode) {
      const results = h("div", { class: "ac-obs-results", hidden: true });
      const search = h("input", { class: "ac-obs-search", type: "text", placeholder: "Search city…", autocomplete: "off", spellcheck: "false" });
      let to, seq = 0;
      search.oninput = () => {
        clearTimeout(to);
        const q = search.value.trim();
        if (q.length < 2) { results.hidden = true; clear(results); return; }
        results.hidden = false; clear(results);
        results.appendChild(h("div", { class: "ac-obs-result ac-dim", text: "searching…" }));
        const my = ++seq;
        to = setTimeout(() => this._geoSearch(q, results, apply, () => my === seq), 320);
      };
      pop.appendChild(h("div", { class: "ac-obs-search-wrap" }, [h("span", { class: "ac-obs-search-i", text: "⌕" }), search]));
      pop.appendChild(results);
    }

    const geoStatus = h("div", { class: "ac-obs-geostatus", hidden: true });
    const setGeo = (msg, err) => { geoStatus.hidden = false; geoStatus.className = "ac-obs-geostatus" + (err ? " ac-obs-geostatus--err" : ""); geoStatus.textContent = msg; };
    pop.appendChild(h("button", {
      class: "ac-obs-geo", text: "📍 Use my location",
      onclick: () => {
        if (!navigator.geolocation) { setGeo("⊘ Geolocation unavailable in this browser.", true); return; }
        setGeo("locating…", false);
        navigator.geolocation.getCurrentPosition(
          (pos) => apply(pos.coords.latitude, pos.coords.longitude),
          () => setGeo("⊘ Location access denied — enter coordinates or pick a preset.", true),
        );
      },
    }));
    pop.appendChild(geoStatus);
    pop.appendChild(h("div", { class: "ac-obs-coords" }, [
      h("label", {}, ["Lat", latIn]), h("label", {}, ["Lon", lonIn]),
    ]));
    pop.appendChild(chips);
    pop.appendChild(h("div", { class: "ac-obs-actions" }, [
      h("button", { class: "ac-obs-cancel", text: "Cancel", onclick: () => { pop.hidden = true; } }),
      h("button", { class: "ac-obs-apply", text: "Set observer", onclick: () => apply(parseFloat(latIn.value), parseFloat(lonIn.value)) }),
    ]));
    pop.appendChild(h("div", { class: "ac-obs-note", text: "The observer anchors the live sky — every body above this horizon maps into the dome." }));
  }

  /** Resolve a city query via the injected geocode provider into clickable rows. */
  async _geoSearch(q, box, apply, isCurrent) {
    let res;
    try { res = await this.providers.geocode(q); }
    catch { if (isCurrent()) { clear(box); box.appendChild(h("div", { class: "ac-obs-result ac-dim", text: "Search unavailable." })); } return; }
    if (!isCurrent()) return; // a newer keystroke superseded this query
    clear(box);
    if (!res || !res.length) { box.appendChild(h("div", { class: "ac-obs-result ac-dim", text: "No matches." })); return; }
    for (const c of res.slice(0, 6)) {
      box.appendChild(h("button", { class: "ac-obs-result", onclick: () => apply(c.lat, c.lon) }, [
        h("span", { class: "ac-obs-result-name", text: c.label || c.name }),
        h("span", { class: "ac-obs-result-ll", text: `${c.lat.toFixed(1)}°, ${c.lon.toFixed(1)}°` }),
      ]));
    }
  }

  // ── compute ──
  _velocities(chart) {
    const lonAt = this.providers.chart && this.providers.chart.lonAt;
    if (!lonAt) return {};
    const when = chart.velDate || chart.date || this.state.date;
    const vel = {};
    for (const p of chart.positions) {
      try { vel[p.body] = bodyVelocity(lonAt, p.body, when); } catch { vel[p.body] = 0; }
    }
    return vel;
  }

  recompute() {
    const st = this.state, cp = this.providers.chart;
    let chart = null;
    try {
      if (st.frame === "natal" && cp && cp.natal) {
        chart = cp.natal(st.date);
      } else if (st.frame === "transit") {
        chart = cp && cp.mundane ? cp.mundane(st.observer.lat, st.observer.lon, st.date, { system: st.houseSystem }) : null;
        const natal = cp && cp.natal ? cp.natal(st.date) : null;
        if (chart) {
          chart.frame = "transit";
          if (natal && natal.positions) {
            chart.natalPositions = natal.positions;
            chart.natalByBody = {}; natal.positions.forEach((p) => { chart.natalByBody[p.body] = p; });
          }
        }
      } else if (cp && cp.mundane) {
        chart = cp.mundane(st.observer.lat, st.observer.lon, st.date, { system: st.houseSystem });
      }
    } catch (e) { console.warn("[AlchmChart] chart compute failed", e); }
    st.chart = chart;
    if (!chart) return;
    if (!chart.byBody) { chart.byBody = {}; chart.positions.forEach((p) => { chart.byBody[p.body] = p; }); }
    const vel = this._velocities(chart);
    if (st.frame === "transit" && chart.natalPositions) {
      chart.aspects = [];
      chart.transitAspects = transitAspects(chart.positions, chart.natalPositions, vel);
    } else {
      chart.aspects = enrichAspects(chart.positions, vel);
    }
    if (!st.footprints && this.providers.sky && this.providers.sky.starByHip && this.providers.sky.equatorialToEcliptic) {
      st.footprints = footprintsFromMembers(st.poolMeta, this.providers.sky.starByHip, this.providers.sky.equatorialToEcliptic);
    }
    st.smes = blendedSMES(chart, st.weights);
    st.pressures = poolPressure(chart, st.poolMeta, st.footprints || {}, st.smes);
  }

  paint() {
    const st = this.state;
    if (this._dome) this._dome.update(st);
    renderTransitStrip(st.dom.transitStrip, st);
    renderSmes(st.dom.smes, st);
    renderReading(st.dom.reading, st);
    renderPools(st.dom.pools, st);
    this._updateEmptyState();
    this._updateHeader();
    syncScrubberThumb(st);
  }

  /** Prominent "no birth chart" CTA over the dome when the natal frame has no chart. */
  _updateEmptyState() {
    const st = this.state, d = st.dom;
    if (!d.empty) return;
    const cp = this.providers.chart;
    let hasNatal = false;
    try { hasNatal = !!(cp && cp.natal && cp.natal(st.date)); } catch { hasNatal = false; }
    const show = st.frame === "natal" && !hasNatal;
    d.empty.hidden = !show;
    if (show && !d.empty.firstChild) {
      d.empty.appendChild(h("div", { class: "ac-empty-card" }, [
        h("div", { class: "ac-empty-glyph", text: "✶" }),
        h("div", { class: "ac-empty-title", text: "No birth chart on file" }),
        h("div", { class: "ac-empty-sub", text: "Set your birth time and place to read your natal sky and personal transits." }),
        h("button", { class: "ac-empty-cta", text: "✦ Add birth chart", onclick: () => this._requestNatal() }),
      ]));
    }
  }
  _requestNatal() {
    this._emit("requestnatal");
    if (this.opts.onRequestNatal) { try { this.opts.onRequestNatal(); return; } catch {} }
    if (window.toast) window.toast("Add your birth details to unlock natal & transit.", { type: "info" });
  }

  _updateHeader() {
    const st = this.state, d = st.dom;
    const frameBtns = d.header.querySelectorAll(".ac-frame-pill");
    frameBtns.forEach((b) => b.classList.toggle("is-active", b.dataset.frame === st.frame));
    // accuracy badge for natal
    if (st.frame === "natal" && st.chart) {
      d.accuracy.hidden = false;
      d.accuracy.textContent = st.chart.accuracy === "real" ? "real natal" : "stored chart — set a birth time";
      d.accuracy.classList.toggle("ac-badge--warn", st.chart.accuracy !== "real");
    } else { d.accuracy.hidden = true; }
    const far = Math.abs(st.date.getTime() - Date.now()) > 120 * 864e5;
    d.caveat.hidden = !(st.zoom === "year" || far);
  }

  // ── interactions ──
  _scrub(date) {
    if (this.state.frame === "natal" && this.state.chart && this.state.chart.fixed) {
      // natal is a fixed birth chart; the scrubber doesn't move natal planets
      this.state.date = date; setScrubberDate(this.state); return;
    }
    this._pendingDate = date;
    setScrubberDate(Object.assign(this.state, { date }));
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this.state.date = this._pendingDate;
      this.recompute();
      if (this._dome) this._dome.update(this.state);
      renderTransitStrip(this.state.dom.transitStrip, this.state);
      renderSmes(this.state.dom.smes, this.state);
      renderReading(this.state.dom.reading, this.state);
      renderPools(this.state.dom.pools, this.state);
      this._updateHeader();
    });
  }
  setZoom(zoom) { this.state.zoom = zoom; syncScrubberThumb(this.state); this._updateHeader(); this._emit("scrub", this.state.date, zoom); }
  setFrame(frame) {
    // Natal with no chart on file is allowed — the dome shows the "add birth chart" CTA.
    this.state.frame = frame; this.recompute(); this.paint(); this._emit("framechange", frame);
  }
  setHouseSystem(sys) { this.state.houseSystem = sys; this.recompute(); this.paint(); }
  setObserver(o) { this.state.observer = o; this._updateObserverChip(); if (this.state.frame !== "natal") { this.recompute(); this.paint(); } }
  setDate(date) { this.state.date = date; this.recompute(); this.paint(); }
  now() { const n = new Date(); this.state.anchor = new Date(n.getTime()); this.state.date = n; this.recompute(); this.paint(); }

  async refreshPools() {
    const amm = this.providers.amm;
    if (!amm || !amm.readAllPools) { this.state.pools = null; renderPools(this.state.dom.pools, this.state); return; }
    const toNumber = amm.toNumber || ((x) => Number(x));
    try {
      const raw = await amm.readAllPools();
      if (!raw) { this.state.pools = null; renderPools(this.state.dom.pools, this.state); return; }
      const byId = {}; this.poolMeta.forEach((m) => { byId[m.constId] = m; });
      this.state.pools = raw.map((r) => enrichPool(r, byId[r.constId], toNumber));
      renderPools(this.state.dom.pools, this.state);
      this._emit("poolsloaded", this.state.pools);
    } catch (e) {
      console.warn("[AlchmChart] pool read failed", e);
      this.state.pools = (this.poolMeta || []).map((m) => ({ ...m, failed: true }));
      renderPools(this.state.dom.pools, this.state);
      this._emit("poolserror", e);
    }
  }

  // ── inspector popover ──
  _select(payload) {
    const st = this.state, pop = st.dom.pop;
    clear(pop); pop.hidden = false;
    const close = h("button", { class: "ac-pop-close", text: "✕", "aria-label": "Close", onclick: () => this._closePop() });
    let body;
    if (payload.kind === "body") body = this._inspectBody(payload.pos);
    else if (payload.kind === "aspect") body = this._inspectAspect(payload);
    else if (payload.kind === "pool") body = this._inspectPool(payload.constId);
    pop.appendChild(close); pop.appendChild(body);
    if (this.opts.onSelect) this.opts.onSelect(payload);
    this._emit("select", payload);
  }
  _closePop() { this.state.dom.pop.hidden = true; clear(this.state.dom.pop); }
  _inspectBody(p) {
    const w = (this.state.smes.weights || {})[p.body];
    return h("div", { class: "ac-pop-body" }, [
      h("div", { class: "ac-pop-head", text: `${p.glyph || ""} ${p.name}` }),
      h("div", { class: "ac-pop-row", text: `${p.signGlyph || ""} ${p.signName} ${Math.floor(p.degInSign)}°${p.retrograde ? " ℞" : ""}` }),
      h("div", { class: "ac-pop-row", text: `House ${p.house} · ${p.dignity ? p.dignity.label : "Peregrine"}` }),
      h("div", { class: "ac-pop-row ac-dim", text: `chart weight ${w != null ? w.toFixed(2) : "—"}×` }),
    ]);
  }
  _inspectAspect(payload) {
    const a = payload.asp;
    return h("div", { class: "ac-pop-body" }, [
      h("div", { class: "ac-pop-head", text: `${payload.a.name} ${a.glyph} ${payload.b.name}` }),
      h("div", { class: "ac-pop-row", text: `${a.type} · orb ${a.orb}°` }),
      h("div", { class: "ac-pop-row", text: `${a.state}${a.exact ? " · exact" : ""}` }),
      h("div", { class: "ac-pop-row ac-dim", text: `influence ${Math.round(a.influence * 100)}%` }),
    ]);
  }
  _inspectPool(id) {
    const st = this.state;
    const meta = st.poolMeta.find((m) => m.constId === id) || {};
    const pr = st.pressures[id] || {};
    const live = (st.pools || []).find((p) => p.constId === id);
    const esms = st.esms, pair = meta.pair || [0, 3];
    const rows = [
      h("div", { class: "ac-pop-head", text: `${meta.name || meta.abbr || "Pool #" + id}` }),
      h("div", { class: "ac-pop-row", text: `${esms.glyphs[pair[0]]} ${esms.names[pair[0]]} / ${esms.glyphs[pair[1]]} ${esms.names[pair[1]]}` }),
      h("div", { class: "ac-pop-row", text: `pressure ${Math.round((pr.pressure || 0) * 100)}%  ·  energy ${(pr.E || 0).toFixed(0)}` }),
      h("div", { class: "ac-pop-row ac-dim", text: `coverage ${Math.round((pr.coverage || 0) * 100)}% · dignity ×${(pr.dignity || 1).toFixed(2)}` }),
    ];
    if (live && live.failed) rows.push(h("div", { class: "ac-pop-row ac-dim", text: "live reserves unavailable" }));
    else if (live && live.hasLiq) rows.push(h("div", { class: "ac-pop-row", text: `live depth ${live.aNum.toFixed(1)} / ${live.bNum.toFixed(1)} · spot ${live.spot.toFixed(3)}` }));
    else if (live) rows.push(h("div", { class: "ac-pop-row ac-dim", text: "unseeded — no liquidity yet" }));
    const swap = h("div", { class: "ac-swap" });
    rows.push(swap);
    this._fillSwap(swap, { pair, live, esms });
    return h("div", { class: "ac-pop-body" }, rows);
  }

  /** Async, balance-gated swap panel. Uses only the injected `trade` provider. */
  async _fillSwap(box, ctx) {
    const trade = this.providers.trade;
    const earn = "Trades use in-game ESMS — earn it via daily login grants on the agents & kitchen sites and by completing objectives.";
    if (!trade) { box.appendChild(h("div", { class: "ac-pop-trade ac-dim", text: earn })); return; }
    box.appendChild(h("div", { class: "ac-pop-row ac-dim", text: "loading wallet…" }));
    let balances, caps;
    try { balances = await trade.esmsBalances(); caps = trade.capabilities(); }
    catch { clear(box); box.appendChild(h("div", { class: "ac-pop-trade ac-dim", text: earn })); return; }
    clear(box);
    const { pair, live, esms } = ctx;
    const b0 = balances[pair[0]] || { num: 0 }, b1 = balances[pair[1]] || { num: 0 };
    const addr = (trade.address && trade.address()) || "";
    const short = addr ? addr.slice(0, 6) + "…" + addr.slice(-4) : "—";
    box.appendChild(h("div", { class: "ac-swap-head" }, [h("span", { class: "ac-dim", text: "burner " }), h("span", { text: short })]));
    box.appendChild(h("div", { class: "ac-swap-bal" }, [
      h("span", { text: `${esms.glyphs[pair[0]]} ${b0.num.toFixed(2)}` }),
      h("span", { text: `${esms.glyphs[pair[1]]} ${b1.num.toFixed(2)}` }),
    ]));
    if (b0.num <= 0 && b1.num <= 0) {
      box.appendChild(h("div", { class: "ac-pop-trade ac-dim", text: earn }));
      if (!caps.sponsored) box.appendChild(h("div", { class: "ac-pop-row ac-dim", text: "Sponsored swaps off — set VITE_BUNDLER_URL." }));
      return;
    }
    if (!live || !live.hasLiq) { box.appendChild(h("div", { class: "ac-pop-row ac-dim", text: "Pool unseeded — no liquidity to trade into yet." })); return; }
    const outOf = (i) => (i === pair[0] ? pair[1] : pair[0]);
    const st = { inId: b0.num >= b1.num ? pair[0] : pair[1] };
    const dir = h("button", { class: "ac-swap-dir", title: "Flip direction" });
    const amt = h("input", { class: "ac-swap-amt", type: "number", min: "0", step: "any", placeholder: "amount" });
    const btn = h("button", { class: "ac-swap-go", text: "Swap" });
    const quoteLine = h("div", { class: "ac-swap-quote ac-dim", text: "" });
    const note = h("div", { class: "ac-swap-note ac-dim" });
    let qto;
    const paint = () => { dir.textContent = `${esms.glyphs[st.inId]} → ${esms.glyphs[outOf(st.inId)]}`; amt.max = String((balances[st.inId] || { num: 0 }).num); };
    const doQuote = () => {
      clearTimeout(qto);
      qto = setTimeout(async () => {
        const v = parseFloat(amt.value);
        if (!(v > 0)) { quoteLine.textContent = `balance ${(balances[st.inId] || { num: 0 }).num.toFixed(2)}`; return; }
        quoteLine.textContent = "quoting…";
        const q = await trade.quote(live, st.inId, amt.value).catch(() => null);
        quoteLine.textContent = q ? `≈ ${q.outNum.toFixed(4)} ${esms.glyphs[outOf(st.inId)]}${q.impact != null ? ` · impact ${(q.impact * 100).toFixed(1)}%` : ""}` : "no quote (pool too thin)";
      }, 350);
    };
    dir.onclick = () => { st.inId = outOf(st.inId); paint(); doQuote(); };
    amt.oninput = doQuote;
    btn.disabled = !caps.sponsored;
    btn.onclick = async () => {
      const v = parseFloat(amt.value);
      if (!(v > 0)) return;
      btn.disabled = true; btn.textContent = "swapping…";
      try {
        const r = await trade.swap({ pool: live, inId: st.inId, inAmtHuman: amt.value });
        if (window.toast) window.toast(`Swapped — ${r && r.hash ? r.hash.slice(0, 10) + "…" : "done"}`, { type: "success", title: "Constellation DEX" });
        this.refreshPools(); this._closePop();
      } catch (e) {
        if (window.toast) window.toast((e && e.message) || "Swap failed", { type: "error", title: "Swap" });
        btn.disabled = false; btn.textContent = "Swap";
      }
    };
    box.appendChild(h("div", { class: "ac-swap-row" }, [dir, amt, btn]));
    box.appendChild(quoteLine);
    if (!caps.sponsored) note.textContent = "Sponsored swaps off — set VITE_BUNDLER_URL to enable gasless trading.";
    box.appendChild(note);
    paint();
    quoteLine.textContent = `balance ${(balances[st.inId] || { num: 0 }).num.toFixed(2)}`;
  }

  // ── event bus ──
  on(evt, cb) { (this._listeners[evt] = this._listeners[evt] || []).push(cb); return this; }
  off(evt, cb) { if (this._listeners[evt]) this._listeners[evt] = this._listeners[evt].filter((f) => f !== cb); return this; }
  _emit(evt, ...args) { (this._listeners[evt] || []).forEach((f) => { try { f(...args); } catch {} }); }

  getState() { return this.state; }
  update(patch) {
    patch = patch || {};
    if (patch.date) this.state.date = patch.date;
    if (patch.frame) this.state.frame = patch.frame;
    if (patch.zoom) this.state.zoom = patch.zoom;
    if (patch.observer) this.state.observer = patch.observer;
    this.recompute(); this.paint();
    return this;
  }
  destroy() {
    this._destroyed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._dome) { try { this._dome.dispose(); } catch {} this._dome = null; }
    if (this._esc) document.removeEventListener("keydown", this._esc);
    this._unsub.forEach((u) => { try { u(); } catch {} });
    this._unsub = [];
    if (this.state.el) clear(this.state.el);
  }
}

export function create(opts) { return new AlchmChartInstance(opts); }
export { compute };
export const version = "0.1.0";
const AlchmChart = { create, compute, version };
export default AlchmChart;
if (typeof window !== "undefined") window.AlchmChart = AlchmChart;
