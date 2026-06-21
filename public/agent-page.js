/* ============================================================
   PENTACLES — Agent Pentacles Page
   ============================================================
   The full-screen surface that opens when you click a planet (or a
   named star). It shows the agent's live ASTROLOGICAL WEATHER — degree ·
   sign · dignity · house · retrograde on a 360°/12-house wheel, in both
   the mundane (here-and-now, adjustable city + time) and natal (the
   player's birth chart) frames — and three ways to interact with the
   agent: CHAT, JINGS (the elemental duel), and SCRABBLE (the Word Duel).

   Pure client + dual-mode: everything runs offline against the bundled
   ephemeris; when the live module/chain is reachable later phases swap
   the simulated chat/jings/pools for the authoritative reducers.

   Reuses globals from app.js / client.js (state, POOL_CITIES, switchTab,
   traceConstellation, state.castWord, renderWordDuel) and the math in
   astro-weather.js (window.AstroWeather) + sky.js.
   ============================================================ */

(function () {
  "use strict";

  const AW = () => window.AstroWeather;
  const EL_COLOR = { Fire: "#db7a47", Earth: "#74ab6c", Air: "#aebbd6", Water: "#5f93d8" };
  const SACRED7_LABEL = ["Power", "Resonance", "Wisdom", "Charisma", "Intuition", "Adaptability", "Vitality"];

  // ── module state for the open page ───────────────────────────────────────
  let cur = null; // { kind:'planet'|'star', body, hip, name, glyph, color, star, frame, cityIdx, offsetH, tab }
  let lastFocus = null;
  let escHandler = null;

  function elById(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function toastMsg(msg, type) { if (window.toast) window.toast(msg, { type: type || "info" }); }

  function cities() {
    const base = (typeof POOL_CITIES !== "undefined") ? POOL_CITIES : [{ name: "New York", lat: 40.7128, lon: -74.006 }];
    return base;
  }
  function observer() {
    if (cur.cityIdx != null && cities()[cur.cityIdx]) return cities()[cur.cityIdx];
    return state.observer || { lat: 40.7128, lon: -74.006 };
  }
  function nowDate() { return new Date(Date.now() + (cur.offsetH || 0) * 3600 * 1000); }
  function tzLabel() {
    const lon = observer().lon;
    const off = Math.round(lon / 15);
    const d = nowDate();
    const local = new Date(d.getTime() + off * 3600 * 1000);
    const hh = String(local.getUTCHours()).padStart(2, "0");
    const mm = String(local.getUTCMinutes()).padStart(2, "0");
    return `${hh}:${mm} (UTC${off >= 0 ? "+" : ""}${off})`;
  }
  function agentKey() { return cur.kind === "star" ? "s" + cur.hip : "p" + cur.body; }

  // ── public entry points ──────────────────────────────────────────────────
  function openPlanetAgentPage(body) {
    if (!AW()) { toastMsg("Astro layer not ready", "error"); return; }
    cur = { kind: "planet", body, name: AW().bodyName(body), glyph: AW().bodyGlyph(body), color: AW().bodyColor(body),
            frame: "mundane", cityIdx: nearestCityIdx(), offsetH: 0, tab: "chat" };
    mount();
  }
  function openStarAgentPage(hip) {
    if (!AW()) return;
    const row = (typeof STAR_CATALOG !== "undefined") ? STAR_CATALOG.find((r) => r[0] === hip) : null;
    if (!row) { toastMsg("Star not in catalogue", "error"); return; }
    cur = { kind: "star", hip, star: { hip, name: row[1], ra: row[2], dec: row[3], mag: row[4] },
            name: row[1], glyph: "✦", color: "#f1dba1", frame: "mundane", cityIdx: nearestCityIdx(), offsetH: 0, tab: "chat" };
    mount();
  }
  function nearestCityIdx() {
    const o = state.observer || { lat: 40.71, lon: -74 };
    const cs = cities();
    let best = 0, bd = Infinity;
    cs.forEach((c, i) => { const d = Math.abs(c.lat - o.lat) + Math.abs(c.lon - o.lon); if (d < bd) { bd = d; best = i; } });
    return bd < 1 ? best : null;
  }

  function closeAgentPage() {
    const ov = elById("agent-page");
    if (ov) { ov.style.display = "none"; ov.innerHTML = ""; }
    if (escHandler) { document.removeEventListener("keydown", escHandler); escHandler = null; }
    cur = null;
    if (window.HologramCamera) window.HologramCamera.autoRotate = !document.documentElement.classList.contains("pt-reduced-motion");
  }

  // ── chart computation ─────────────────────────────────────────────────────
  function computeChart() {
    const o = observer(), d = nowDate();
    if (cur.frame === "natal" && state.player && state.player.chart && Array.isArray(state.player.chart.placements)) {
      const nc = AW().natalChart(state.player.chart, d);
      if (nc) return nc;
    }
    cur.frame = "mundane";
    return AW().chartOfMoment(o.lat, o.lon, d);
  }

  // The focused agent's position (a planet body, or a star projected onto the ecliptic).
  function focusPosition(chart) {
    if (cur.kind === "planet") return chart.byBody[cur.body] || null;
    // Star: project its fixed RA/Dec to ecliptic longitude + horizon for the observer.
    const s = cur.star, o = observer(), d = nowDate();
    const lon = (typeof equatorialToEcliptic === "function") ? equatorialToEcliptic(s.ra, s.dec) : 0;
    const sign = AW().signOf(lon);
    let alt = null, az = null, up = null;
    if (typeof altAzOf === "function" && typeof lstDeg === "function") {
      const aa = altAzOf(s.ra, s.dec, o.lat, lstDeg(d, o.lon));
      alt = aa.alt; az = aa.az; up = aa.alt > 0;
    }
    return {
      body: "star", name: s.name, glyph: "✦", color: "#f1dba1", eclLon: lon, sign,
      signName: SIGN_NAMES[sign], signGlyph: SIGN_GLYPHS[sign], degInSign: lon % 30,
      element: AW().ELEMENT_OF_SIGN(sign), dignity: { score: 0, label: "Fixed star", key: "fixed" },
      retrograde: false, house: AW().houseOf(lon, chart.cusps), alt, az, up, magnitude: s.mag,
    };
  }

  // ── mount + paint ─────────────────────────────────────────────────────────
  function mount() {
    const ov = elById("agent-page");
    if (!ov) return;
    if (window.HologramCamera) window.HologramCamera.autoRotate = false; // pause the dome behind
    ov.style.display = "flex";
    ov.innerHTML = shellHTML();
    wireShell();
    paintAll();
    // a11y: Esc to close, focus the close button.
    escHandler = (e) => { if (e.key === "Escape") closeAgentPage(); };
    document.addEventListener("keydown", escHandler);
    const cb = elById("ag-close"); if (cb) cb.focus();
  }

  function shellHTML() {
    return `
      <div class="ag-window">
        <button id="ag-close" class="ag-close" title="Close (Esc)" aria-label="Close">✕</button>
        <div id="ag-header" class="ag-header"></div>
        <div class="ag-body">
          <div class="ag-left">
            <div id="ag-wheel" class="ag-wheel" role="img" aria-label="Astrological weather wheel"></div>
            <div class="ag-controls">
              <div class="ag-ctl-row">
                <label class="ag-ctl-label">Frame</label>
                <div class="ag-seg" id="ag-frame">
                  <button data-frame="mundane" class="ag-seg-btn">Mundane · now</button>
                  <button data-frame="natal" class="ag-seg-btn">Natal</button>
                </div>
              </div>
              <div class="ag-ctl-row">
                <label class="ag-ctl-label" for="ag-city">Observer / timezone</label>
                <select id="ag-city" class="ag-select"></select>
              </div>
              <div class="ag-ctl-row">
                <label class="ag-ctl-label" for="ag-time">Time <span id="ag-time-val" class="ag-dim"></span></label>
                <input id="ag-time" class="ag-range" type="range" min="-168" max="168" step="1" value="0" />
              </div>
              <div id="ag-clock" class="ag-clock"></div>
            </div>
          </div>
          <div class="ag-right">
            <div class="ag-tabs" id="ag-tabs" role="tablist">
              <button class="ag-tab" data-tab="chat" role="tab">💬 Chat</button>
              <button class="ag-tab" data-tab="jings" role="tab">🜂 Jings</button>
              <button class="ag-tab" data-tab="scrabble" role="tab">✦ Scrabble</button>
              <button class="ag-tab" data-tab="pools" role="tab">◎ Pools</button>
            </div>
            <div id="ag-tab-body" class="ag-tab-body"></div>
          </div>
        </div>
      </div>`;
  }

  function wireShell() {
    elById("ag-close").onclick = closeAgentPage;
    elById("agent-page").onclick = (e) => { if (e.target.id === "agent-page") closeAgentPage(); };
    // City selector
    const sel = elById("ag-city");
    sel.innerHTML = cities().map((c, i) => `<option value="${i}">${esc(c.name)}</option>`).join("") +
      (cur.cityIdx == null ? `<option value="custom" selected>Custom (${observer().lat.toFixed(1)}, ${observer().lon.toFixed(1)})</option>` : "");
    if (cur.cityIdx != null) sel.value = String(cur.cityIdx);
    sel.onchange = () => { const v = sel.value; cur.cityIdx = v === "custom" ? null : parseInt(v, 10); paintAll(); };
    // Time slider (hours from now, ±1 week)
    const t = elById("ag-time");
    t.value = String(cur.offsetH || 0);
    t.oninput = () => { cur.offsetH = parseInt(t.value, 10); paintWeather(); paintClock(); };
    // Frame segmented control
    elById("ag-frame").querySelectorAll(".ag-seg-btn").forEach((b) => {
      b.onclick = () => { cur.frame = b.dataset.frame; paintAll(); };
    });
    // Tabs
    elById("ag-tabs").querySelectorAll(".ag-tab").forEach((b) => {
      b.onclick = () => { cur.tab = b.dataset.tab; paintTabs(); paintTabBody(); };
    });
  }

  function paintAll() { paintWeather(); paintClock(); paintTabs(); paintTabBody(); }

  function paintClock() {
    const c = elById("ag-clock"); if (!c) return;
    const o = observer();
    c.innerHTML = `🕒 ${esc(tzLabel())} · ${esc((cities()[cur.cityIdx] || {}).name || `${o.lat.toFixed(1)}, ${o.lon.toFixed(1)}`)}`;
    const tv = elById("ag-time-val");
    if (tv) tv.textContent = cur.offsetH === 0 ? "(live)" : `(${cur.offsetH > 0 ? "+" : ""}${cur.offsetH}h)`;
    // reflect frame buttons
    elById("ag-frame") && elById("ag-frame").querySelectorAll(".ag-seg-btn").forEach((b) =>
      b.classList.toggle("active", b.dataset.frame === cur.frame));
  }

  function paintWeather() {
    const chart = computeChart();
    const f = focusPosition(chart);
    lastFocus = { chart, f };
    // Header
    const hdr = elById("ag-header");
    if (hdr && f) {
      const dig = f.dignity && f.dignity.label && f.dignity.label !== "Peregrine"
        ? `<span class="ag-dignity ag-dig-${(f.dignity.key || "").replace(/[^a-z]/g, "")}">${esc(f.dignity.label)}</span>` : "";
      const retro = f.retrograde ? `<span class="ag-retro">℞ retrograde</span>` : "";
      const houseTxt = f.house ? `House ${f.house}` : "";
      const horizon = (f.up === true) ? `<span class="ag-up">● above horizon</span>` : (f.up === false) ? `<span class="ag-down">○ below horizon</span>` : "";
      hdr.innerHTML =
        `<span class="ag-glyph" style="color:${f.color}">${f.glyph}</span>` +
        `<div class="ag-title">` +
          `<div class="ag-name">${esc(cur.name)} <span class="ag-kind">${cur.kind === "star" ? "fixed-star agent" : (cur.body === 10 ? "comet agent" : "planetary agent")}</span></div>` +
          `<div class="ag-sub">${f.signGlyph} ${esc(f.signName)} ${Math.floor(f.degInSign)}° ${dig} ${retro}` +
          ` · <span class="ag-dim">${esc(houseTxt)}${f.element ? " · " + esc(f.element) : ""}</span> ${horizon}</div>` +
        `</div>`;
    }
    // Wheel
    const w = elById("ag-wheel");
    if (w) w.innerHTML = wheelSVG(chart, f);
  }

  // ── the 360° / 12-house weather wheel ─────────────────────────────────────
  function wheelSVG(chart, focus) {
    const SZ = 360, cx = 180, cy = 180;
    const rZodOut = 172, rZodIn = 144, rHouseIn = 104, rPlanet = 124, rHub = 100;
    const asc = chart.asc || 0;
    const P = (lam, r) => { const th = (180 + (lam - asc)) * Math.PI / 180; return [cx + r * Math.cos(th), cy - r * Math.sin(th)]; };
    let s = `<svg viewBox="0 0 ${SZ} ${SZ}" xmlns="http://www.w3.org/2000/svg" class="ag-wheel-svg">`;
    // base rings
    s += `<circle cx="${cx}" cy="${cy}" r="${rZodOut}" fill="none" stroke="var(--line-hard)" stroke-width="1"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${rZodIn}" fill="none" stroke="var(--line)" stroke-width="1"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${rHouseIn}" fill="none" stroke="var(--line)" stroke-width="0.8"/>`;
    s += `<circle cx="${cx}" cy="${cy}" r="${rHub}" fill="rgba(8,10,18,0.6)" stroke="var(--line)" stroke-width="0.6"/>`;
    // 12 sign sectors: boundary ticks + glyph colored by element
    for (let sgn = 0; sgn < 12; sgn++) {
      const a0 = P(sgn * 30, rZodIn), a1 = P(sgn * 30, rZodOut);
      s += `<line x1="${a0[0].toFixed(1)}" y1="${a0[1].toFixed(1)}" x2="${a1[0].toFixed(1)}" y2="${a1[1].toFixed(1)}" stroke="var(--line)" stroke-width="0.7"/>`;
      const mid = P(sgn * 30 + 15, (rZodIn + rZodOut) / 2);
      const el = ["Fire", "Earth", "Air", "Water"][sgn % 4];
      s += `<text x="${mid[0].toFixed(1)}" y="${(mid[1] + 4).toFixed(1)}" text-anchor="middle" font-size="14" fill="${EL_COLOR[el]}">${SIGN_GLYPHS[sgn]}</text>`;
    }
    // 12 house cusps + numbers
    const cusps = chart.cusps || [];
    for (let h = 0; h < 12; h++) {
      const c0 = P(cusps[h], rHub), c1 = P(cusps[h], rZodIn);
      const angular = (h === 0 || h === 3 || h === 6 || h === 9);
      s += `<line x1="${c0[0].toFixed(1)}" y1="${c0[1].toFixed(1)}" x2="${c1[0].toFixed(1)}" y2="${c1[1].toFixed(1)}" stroke="${angular ? "var(--gold)" : "var(--line-hard)"}" stroke-width="${angular ? 1.2 : 0.7}" stroke-opacity="${angular ? 0.9 : 0.55}"/>`;
      const nextSpan = ((cusps[(h + 1) % 12] - cusps[h]) % 360 + 360) % 360 || 30;
      const numPos = P(cusps[h] + nextSpan / 2, rHouseIn + 12);
      s += `<text x="${numPos[0].toFixed(1)}" y="${(numPos[1] + 3).toFixed(1)}" text-anchor="middle" font-size="9" fill="var(--dim)">${h + 1}</text>`;
    }
    // ASC / MC labels
    const ascP = P(asc, rZodOut + 0), mcP = P(chart.mc || 0, rZodOut + 0);
    const ascL = P(asc, rZodOut - 14), mcL = P(chart.mc || 0, rZodOut - 14);
    s += `<text x="${ascL[0].toFixed(1)}" y="${(ascL[1] + 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--gold-bright)" font-family="var(--mono)">ASC</text>`;
    s += `<text x="${mcL[0].toFixed(1)}" y="${(mcL[1] + 3).toFixed(1)}" text-anchor="middle" font-size="8" fill="var(--gold-bright)" font-family="var(--mono)">MC</text>`;
    // aspect lines for the focus body, across the hub
    if (focus && chart.aspects) {
      const ASP_COLOR = { conjunction: "#d8b46a", sextile: "#74ab6c", square: "#db7a47", trine: "#5f93d8", opposition: "#c06a90" };
      for (const a of chart.aspects) {
        if (a.a !== focus.body && a.b !== focus.body) continue;
        const other = a.a === focus.body ? a.b : a.a;
        const op = chart.byBody[other]; if (!op) continue;
        const p1 = P(focus.eclLon, rHub - 2), p2 = P(op.eclLon, rHub - 2);
        s += `<line x1="${p1[0].toFixed(1)}" y1="${p1[1].toFixed(1)}" x2="${p2[0].toFixed(1)}" y2="${p2[1].toFixed(1)}" stroke="${ASP_COLOR[a.type] || "#888"}" stroke-width="${a.exact ? 1.4 : 0.8}" stroke-opacity="0.55"/>`;
      }
    }
    // planet markers
    const marks = (chart.positions || []).slice();
    if (focus && cur.kind === "star") marks.push(focus); // the star sits among the wanderers
    for (const p of marks) {
      const isFocus = focus && p.body === focus.body && (cur.kind !== "star" || p === focus);
      const pt = P(p.eclLon, rPlanet);
      const r = isFocus ? 11 : 7.5;
      if (isFocus) s += `<circle cx="${pt[0].toFixed(1)}" cy="${pt[1].toFixed(1)}" r="${r + 3}" fill="none" stroke="${p.color}" stroke-width="1.4"/>`;
      s += `<circle cx="${pt[0].toFixed(1)}" cy="${pt[1].toFixed(1)}" r="${r}" fill="rgba(8,10,18,0.85)" stroke="${p.color}" stroke-width="${isFocus ? 1.4 : 0.9}"/>`;
      s += `<text x="${pt[0].toFixed(1)}" y="${(pt[1] + r * 0.42).toFixed(1)}" text-anchor="middle" font-size="${isFocus ? 13 : 10}" fill="${p.color}">${p.glyph}</text>`;
    }
    s += `</svg>`;
    return s;
  }

  // ── tabs ──────────────────────────────────────────────────────────────────
  function paintTabs() {
    elById("ag-tabs").querySelectorAll(".ag-tab").forEach((b) => {
      const on = b.dataset.tab === cur.tab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    // Scrabble is planet-only (the agent rack is seeded by an ecliptic body).
    const scr = elById("ag-tabs").querySelector('[data-tab="scrabble"]');
    if (scr) scr.style.display = cur.kind === "star" ? "none" : "";
  }

  function paintTabBody() {
    const host = elById("ag-tab-body"); if (!host) return;
    if (cur.tab === "scrabble" && cur.kind === "star") cur.tab = "chat";
    if (cur.tab === "chat") renderChat(host);
    else if (cur.tab === "jings") renderJings(host);
    else if (cur.tab === "scrabble") renderScrabble(host);
    else if (cur.tab === "pools") renderPools(host);
  }

  // ── CHAT ───────────────────────────────────────────────────────────────────
  function chatThread() { return (state.agentChats[agentKey()] = state.agentChats[agentKey()] || []); }

  function renderChat(host) {
    const thread = chatThread();
    host.innerHTML = `
      <div class="ag-chat-log" id="ag-chat-log"></div>
      <div class="ag-chat-input">
        <input id="ag-chat-text" class="ag-input" type="text" maxlength="240" placeholder="Speak to ${esc(cur.name)}…" autocomplete="off" />
        <button id="ag-chat-send" class="ag-btn">Send</button>
      </div>
      <div class="ag-hint">${cur.kind === "star" ? "A fixed-star oracle" : (cur.body === 10 ? "A wandering comet" : "A planetary agent")} — answers from its live weather. Offline: a simulated voice. <span id="ag-chat-mode"></span></div>`;
    paintChatLog();
    const send = () => sendChat();
    elById("ag-chat-send").onclick = send;
    const inp = elById("ag-chat-text");
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); send(); } };
    inp.focus();
    if (!thread.length) appendAgent(openingLine(), null, true);
  }

  function paintChatLog() {
    const log = elById("ag-chat-log"); if (!log) return;
    const thread = chatThread();
    log.innerHTML = thread.map((m) => {
      if (m.role === "you") return `<div class="ag-msg you"><div class="ag-bubble">${esc(m.text)}</div></div>`;
      const move = m.move ? `<div class="ag-move-decl">${jingGlyph(m.move)} <b>${esc(window.AstroWeather.JING_MOVES[m.move].name)}</b> · ${esc(window.AstroWeather.JING_MOVES[m.move].element)}</div>` : "";
      return `<div class="ag-msg agent"><div class="ag-bubble"><span class="ag-msg-glyph" style="color:${cur.color}">${cur.glyph}</span>${esc(m.text)}${move}</div></div>`;
    }).join("");
    log.scrollTop = log.scrollHeight;
  }

  function sendChat() {
    const inp = elById("ag-chat-text"); if (!inp) return;
    const text = inp.value.trim(); if (!text) return;
    chatThread().push({ role: "you", text, ts: Date.now() });
    inp.value = "";
    paintChatLog();
    // Always give an INSTANT in-character reply from the live weather (no hang).
    setTimeout(() => appendAgent(agentReply(text), pickAgentMove()), 240);
    // If a companion Oracle is reachable, deepen it in the background — when its
    // reply arrives it's appended as a "✦ live" reading. Silent on timeout, so a
    // missing feeder never blocks the chat.
    const net = window.Pentacles && window.Pentacles.net;
    if (net && net.isLive && typeof net.askAgent === "function") {
      const mode = elById("ag-chat-mode"); if (mode) mode.innerHTML = '<span class="duel-live">● live oracle</span>';
      const f = lastFocus && lastFocus.f;
      const context = `${cur.name} (${cur.kind === "star" ? "fixed star" : cur.body === 10 ? "comet" : "planet"})` +
        (f ? ` — ${AW().weatherSummary(f)}` : "");
      net.askAgent(agentKey(), text, { context, timeoutMs: 25000 })
        .then((reply) => { if (reply && reply.text) appendAgent("✦ " + reply.text, null); })
        .catch(() => {});
    }
  }

  function appendAgent(text, move, skipSave) {
    chatThread().push({ role: "agent", text, move: move || null, ts: Date.now() });
    if (!skipSave && state.player) state.save();
    paintChatLog();
  }

  function openingLine() {
    const f = lastFocus && lastFocus.f;
    const w = f ? AW().weatherSummary(f) : cur.name;
    return `I am ${cur.name}. ${w}. Speak, and I will answer in the temper of my hour.`;
  }

  // Simulated agent voice templated from the live weather + a declared jing.
  function agentReply(userText) {
    const f = lastFocus && lastFocus.f;
    if (!f) return `${cur.name} is silent — the sky has not yet been charted.`;
    const moods = {
      Domicile: "I speak from my own house, sure and unhurried", Exaltation: "exalted here, I am at my brightest",
      Detriment: "in exile in this sign, my words come harder", Fall: "fallen in this sign, I counsel from the shadow",
      Peregrine: "a wanderer in this sign, I read the omens plainly", "Fixed star": "fixed and ancient, I have watched this long before you asked",
    };
    const mood = moods[f.dignity.label] || moods.Peregrine;
    const elLine = { Fire: "The fire in me answers your heat.", Water: "I let your question settle like water.", Earth: "I weigh it slowly, as earth does.", Air: "I turn it over in the air, all angles." }[f.element] || "";
    const q = userText.length > 60 ? "A long question." : "";
    return `From ${f.signGlyph} ${f.signName} ${Math.floor(f.degInSign)}°${f.retrograde ? ", retrograde" : ""} — ${mood}. ${elLine} ${q}`.trim();
  }

  function pickAgentMove() {
    const comp = agentComposition();
    const avail = AW().availableJings(comp);
    return avail.length ? avail[Math.floor((cur.offsetH + cur.body + (chatThread().length || 0)) % avail.length + avail.length) % avail.length] : "meltdown";
  }
  function jingGlyph(id) { return (AW().JING_MOVES[id] || {}).glyph || "🜂"; }

  // ── JINGS (the elemental duel) ─────────────────────────────────────────────
  function agentComposition() {
    const f = (lastFocus && lastFocus.f) || (cur.kind === "planet" ? { sign: 0, dignity: { score: 0 } } : null);
    if (cur.kind === "star") { const c = { Fire: 12, Water: 12, Earth: 12, Air: 12 }; c[f ? f.element : "Water"] += 56; const sum = 92; ["Fire", "Water", "Earth", "Air"].forEach((k) => c[k] = Math.round(c[k] / sum * 100)); return c; }
    return AW().elementalComposition(cur.body, f.sign, f.dignity.score);
  }
  function playerComposition() {
    if (state.player && state.player.chart && Array.isArray(state.player.chart.placements)) {
      const t = { Fire: 0, Water: 0, Earth: 0, Air: 0 };
      state.player.chart.placements.forEach((p) => { t[AW().ELEMENT_OF_SIGN(p.sign)]++; });
      const sum = Object.values(t).reduce((a, b) => a + b, 0) || 1;
      ["Fire", "Water", "Earth", "Air"].forEach((k) => t[k] = Math.round(t[k] / sum * 100));
      return t;
    }
    return { Fire: 25, Water: 25, Earth: 25, Air: 25 };
  }
  function ensurePool() {
    if (!state.jingPool) state.jingPool = { sacred7: [100, 100, 100, 100, 100, 100, 100], esms: simEsms() };
    // gentle regen each visit
    state.jingPool.sacred7 = state.jingPool.sacred7.map((v) => Math.min(100, v + 6));
    state.jingPool.esms = state.jingPool.esms.map((v) => Math.min(100, v + 6));
    return state.jingPool;
  }
  function simEsms() {
    try { if (window.Pentacles && window.Pentacles.esmsHud && window.Pentacles.esmsHud.balances) {
      const b = window.Pentacles.esmsHud.balances; return [b[0] || 100, b[1] || 100, b[2] || 100, b[3] || 100].map((x) => Math.min(100, Math.max(20, Math.round(x))));
    } } catch (e) {}
    return [80, 80, 80, 80];
  }

  function renderJings(host) {
    const comp = agentComposition();
    const pcomp = playerComposition();
    const pool = ensurePool();
    if (state.player) state.save();
    const avail = AW().availableJings(comp);
    const playerAvailRaw = AW().availableJings(pcomp);
    const playerAvail = playerAvailRaw.length ? playerAvailRaw : AW().MOVE_ORDER.slice(); // peregrine → may attempt any
    const duels = (state.jingDuels[agentKey()] = state.jingDuels[agentKey()] || []);

    const bar = (label, val, col) => `<div class="ag-comp-row"><span>${label}</span><div class="ag-comp-bar"><div style="width:${val}%;background:${col}"></div></div><span class="ag-dim">${val}%</span></div>`;
    const moveCard = (id) => {
      const m = AW().JING_MOVES[id];
      const can = playerAvail.includes(id);
      const stat = AW().SACRED7.indexOf(m.stat);
      const afford = pool.sacred7[stat] >= m.statCost && pool.esms[m.esms] >= m.esmsCost;
      const agentHas = avail.includes(id);
      return `<button class="ag-move ${can && afford ? "" : "disabled"}" data-move="${id}" ${can && afford ? "" : "disabled"} title="${esc(m.description)}">
          <div class="ag-move-top"><span class="ag-move-glyph" style="color:${EL_COLOR[m.element.split("·")[0]] || "#d8b46a"}">${m.glyph}</span><b>${esc(m.name)}</b></div>
          <div class="ag-move-el">${esc(m.element)}${agentHas ? ' <span class="ag-tag">agent ready</span>' : ""}</div>
          <div class="ag-move-cost ag-dim">−${m.statCost} ${esc(m.stat)} · −${m.esmsCost} ${esc(ESMS_NAMES[m.esms])}</div>
        </button>`;
    };

    host.innerHTML = `
      <div class="ag-jing">
        <div class="ag-jing-cols">
          <div class="ag-jing-card">
            <div class="ag-jing-h">${esc(cur.name)}'s composition</div>
            ${bar("🔥 Fire", comp.Fire, EL_COLOR.Fire)}${bar("🌊 Water", comp.Water, EL_COLOR.Water)}
            ${bar("🪨 Earth", comp.Earth, EL_COLOR.Earth)}${bar("💨 Air", comp.Air, EL_COLOR.Air)}
            <div class="ag-hint">Moves unlock at ≥30% of their element.</div>
          </div>
          <div class="ag-jing-card">
            <div class="ag-jing-h">Your consciousness pools</div>
            ${pool.sacred7.map((v, i) => bar(SACRED7_LABEL[i], v, "#d8b46a")).slice(2, 7).join("")}
            <div class="ag-esms-row">${pool.esms.map((v, i) => `<span style="color:${ESMS_COLORS[i]}">${ESMS_GLYPHS[i]} ${v}</span>`).join("")}</div>
          </div>
        </div>
        <div class="ag-jing-h">Cast a Jing at ${esc(cur.name)}</div>
        <div class="ag-moves">${AW().MOVE_ORDER.map(moveCard).join("")}</div>
        <div id="ag-jing-thread" class="ag-jing-thread"></div>
      </div>`;
    host.querySelectorAll(".ag-move[data-move]").forEach((b) => { if (!b.disabled) b.onclick = () => castJing(b.dataset.move); });
    paintJingThread();
  }

  function castJing(playerMove) {
    const pool = state.jingPool;
    const m = AW().JING_MOVES[playerMove];
    const stat = AW().SACRED7.indexOf(m.stat);
    if (pool.sacred7[stat] < m.statCost || pool.esms[m.esms] < m.esmsCost) { toastMsg(`Your ${m.stat} is too depleted to cast ${m.name}.`, "error"); return; }
    // drain
    pool.sacred7[stat] -= m.statCost;
    pool.esms[m.esms] -= m.esmsCost;
    if (m.esms2 != null) pool.esms[m.esms2] = Math.max(0, pool.esms[m.esms2] - m.esmsCost);
    // agent answer: prefer a move it has that counters yours
    const avail = AW().availableJings(agentComposition());
    let agentMove = avail.find((id) => m.counteredBy.includes(id) || AW().JING_MOVES[id].counters.includes(playerMove));
    if (!agentMove) agentMove = avail[0] || "freeze";
    const outcome = AW().resolveJing(playerMove, agentMove); // 'a' player, 'b' agent, 'draw'
    const verdict = outcome === "a" ? "win" : outcome === "b" ? "loss" : "draw";
    const duels = state.jingDuels[agentKey()];
    duels.unshift({ playerMove, agentMove, outcome: verdict, ts: Date.now() });
    if (duels.length > 12) duels.length = 12;
    if (state.player) state.save();
    if (window.synth) { if (verdict === "win" && synth.playWin) synth.playWin(); else if (synth.playSelect) synth.playSelect(); }
    toastMsg(verdict === "win" ? `Your ${m.name} broke ${cur.name}'s ${AW().JING_MOVES[agentMove].name}!` : verdict === "loss" ? `${cur.name}'s ${AW().JING_MOVES[agentMove].name} countered your ${m.name}.` : `${m.name} vs ${AW().JING_MOVES[agentMove].name} — a standoff.`, verdict === "win" ? "success" : verdict === "loss" ? "error" : "info");
    // also voice it in chat
    appendAgent(`${cur.name} answers your ${m.name} with ${AW().JING_MOVES[agentMove].name}.`, agentMove, true);
    // Best-effort live record (the jing feeder resolves it); offline result already shown.
    const net = window.Pentacles && window.Pentacles.net;
    if (net && net.isLive && cur.kind === "planet" && typeof net.castJing === "function") {
      net.castJing(playerMove, { agentBody: cur.body }).catch(() => {});
    }
    renderJings(elById("ag-tab-body")); // refresh pools + thread
  }

  function paintJingThread() {
    const el = elById("ag-jing-thread"); if (!el) return;
    const duels = state.jingDuels[agentKey()] || [];
    if (!duels.length) { el.innerHTML = `<div class="ag-hint">No jings cast yet. Choose a move above.</div>`; return; }
    el.innerHTML = duels.map((d) => {
      const pm = AW().JING_MOVES[d.playerMove], am = AW().JING_MOVES[d.agentMove];
      const cls = d.outcome === "win" ? "win" : d.outcome === "loss" ? "loss" : "draw";
      const sym = d.outcome === "win" ? "✦" : d.outcome === "loss" ? "✗" : "≡";
      return `<div class="ag-thread-line ${cls}">${sym} You ${pm.glyph} <b>${esc(pm.name)}</b> → ${cur.name} ${am.glyph} <b>${esc(am.name)}</b> · ${d.outcome.toUpperCase()}</div>`;
    }).join("");
  }

  // ── SCRABBLE (reuse the Word Duel engine) ──────────────────────────────────
  function renderScrabble(host) {
    const have = state.playerLetters();
    const letters = Object.keys(have).sort();
    host.innerHTML = `
      <div class="ag-scrabble">
        <div class="ag-jing-h">Word Duel vs ${esc(cur.name)}</div>
        <div class="ag-hint">Spell a Word of Power from your Arcana. ${esc(cur.name)} answers with its best word from the sky-seeded rack.</div>
        <div class="ag-rack" id="ag-rack">${letters.length ? letters.map((l) => `<span class="word-tile" data-l="${l}"><b>${l}</b><sub>${LETTER_VALUES[l] || 0}</sub>${have[l] > 1 ? `<i>×${have[l]}</i>` : ""}</span>`).join("") : '<span class="ag-dim">No lettered Arcana yet — win matches to draw tiles.</span>'}</div>
        <div class="ag-chat-input">
          <input id="ag-word" class="ag-input" type="text" maxlength="15" placeholder="Spell a word…" autocomplete="off" spellcheck="false" />
          <button id="ag-word-cast" class="ag-btn">Cast ✦</button>
        </div>
        <div id="ag-word-prev" class="ag-hint"></div>
        <div id="ag-word-result" class="ag-word-result"></div>
      </div>`;
    const inp = elById("ag-word");
    const prev = elById("ag-word-prev");
    const onInput = () => {
      const w = (inp.value || "").trim().toUpperCase();
      if (!w) { prev.textContent = ""; return; }
      const spellable = canSpell(w, state.playerLetters());
      const valid = (typeof WORD_SET !== "undefined" && WORD_SET) ? isValidWord(w) : null;
      let msg = `${w.length} letters · ${wordScore(w)} pts`;
      if (!spellable) msg += " · ✗ missing letters"; else if (valid === null) msg += " · opening Codex…"; else if (!valid) msg += " · ✗ not in Codex"; else msg += " · ✓ ready";
      prev.textContent = msg;
    };
    inp.oninput = onInput;
    inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); doCastWord(); } };
    host.querySelectorAll(".word-tile[data-l]").forEach((t) => { t.onclick = () => { inp.value = (inp.value + t.dataset.l).toUpperCase(); onInput(); inp.focus(); }; });
    elById("ag-word-cast").onclick = doCastWord;
    inp.focus();
  }

  function doCastWord() {
    const inp = elById("ag-word"); if (!inp) return;
    const res = state.castWord(inp.value, cur.body);
    const out = elById("ag-word-result");
    if (res.error) { out.style.color = "#e88a8a"; out.textContent = res.error; return; }
    out.style.color = res.won ? "var(--gold-bright)" : "var(--dim)";
    out.innerHTML = res.won
      ? `✦ <b>Victory!</b> ${esc(res.playerWord)} (${res.playerScore}) bested ${esc(cur.name)}'s ${esc(res.agentWord || "—")} (${res.agentScore}). <b>+${res.tokens}</b> tokens!`
      : `${esc(cur.name)} answered <b>${esc(res.agentWord || "—")}</b> (${res.agentScore}) to your ${esc(res.playerWord)} (${res.playerScore}). +${res.tokens} tokens.`;
    inp.value = ""; elById("ag-word-prev").textContent = "";
    if (window.synth) { if (res.won && synth.playWin) synth.playWin(); else if (synth.playSelect) synth.playSelect(); }
    // keep the rest of the app in sync
    if (typeof renderWordDuel === "function") try { renderWordDuel(); } catch (e) {}
    if (typeof renderUserBanner === "function") try { renderUserBanner(); } catch (e) {}
    // refresh the rack counts
    const have = state.playerLetters();
    const rack = elById("ag-rack");
    if (rack) { const letters = Object.keys(have).sort(); rack.innerHTML = letters.map((l) => `<span class="word-tile" data-l="${l}"><b>${l}</b><sub>${LETTER_VALUES[l] || 0}</sub>${have[l] > 1 ? `<i>×${have[l]}</i>` : ""}</span>`).join(""); rack.querySelectorAll(".word-tile[data-l]").forEach((t) => { t.onclick = () => { inp.value = (inp.value + t.dataset.l).toUpperCase(); inp.focus(); }; }); }
  }

  // ── POOLS this agent is in ─────────────────────────────────────────────────
  function agentZone() {
    if (cur.kind === "planet") { const f = lastFocus && lastFocus.f; return f ? (f.zone != null ? f.zone : zoneOfPos(f)) : -1; }
    const f = lastFocus && lastFocus.f; return f ? zoneOfPos(f) : -1;
  }
  function zoneOfPos(f) { return (f && f.alt != null && f.az != null && typeof zoneForAltAz === "function") ? zoneForAltAz(f.alt, f.az) : -1; }
  // member zones of a constellation, via the live sky (stars carry their zone)
  function conZones(con) {
    const set = new Set();
    const byHip = {}; (state.sky || []).forEach((s) => { byHip[s.hip_id] = s; });
    const cdef = (typeof CONSTELLATIONS !== "undefined") ? CONSTELLATIONS.find((c) => c.id === con.id) : null;
    (cdef ? cdef.members : []).forEach((h) => { const s = byHip[h]; if (s && s.zone >= 0) set.add(s.zone); });
    return set;
  }

  function renderPools(host) {
    const z = agentZone();
    const cons = (state.constellations || []).slice();
    const enriched = cons.map((c) => ({ c, inZone: z >= 0 && conZones(c).has(z) }))
      .sort((a, b) => (b.inZone - a.inZone) || (b.c.tradeable - a.c.tradeable) || (b.c.visibleCount - a.c.visibleCount));
    const esmsTagLocal = (id) => `<span style="color:${ESMS_COLORS[id]};white-space:nowrap;">${ESMS_GLYPHS[id]} ${ESMS_NAMES[id]}</span>`;
    const zoneTxt = z >= 0 ? `zone ${z}` : "below the horizon";
    const rows = enriched.map(({ c, inZone }) => `
      <div class="ag-pool-row ${c.tradeable ? "open" : ""}">
        <div>
          <div class="ag-pool-name">${inZone ? '<span class="ag-tag">★ in agent\'s zone</span> ' : ""}${esc(c.name)}</div>
          <div class="ag-pool-pair">${esmsTagLocal(c.pair[0])} ↔ ${esmsTagLocal(c.pair[1])} · <span class="ag-dim">${c.feeBps}bps</span></div>
          <div class="ag-pool-vis ${c.tradeable ? "risen" : "set"}">${c.tradeable ? `● risen — ${c.visibleCount}/${c.visibleThreshold} stars up` : `○ set — ${c.visibleCount}/${c.visibleThreshold} up`}</div>
        </div>
        <button class="ag-btn ${c.tradeable ? "" : "ghost"}" data-con="${c.id}" ${c.tradeable ? "" : "disabled"}>${c.tradeable ? "Enter ✦" : "Below horizon"}</button>
      </div>`).join("");
    host.innerHTML = `
      <div class="ag-pools">
        <div class="ag-jing-h">Pools ${esc(cur.name)} is in</div>
        <div class="ag-hint">${esc(cur.name)} transits <b>${esc(zoneTxt)}</b>. Pools sharing its zone are starred. "Enter" performs the special preparations — the visibility attestation — then seeds the pool.</div>
        <div class="ag-pool-list">${rows || '<div class="ag-dim">Charting the sky…</div>'}</div>
      </div>`;
    host.querySelectorAll(".ag-btn[data-con]").forEach((b) => { if (!b.disabled) b.onclick = () => enterPool(parseInt(b.dataset.con, 10)); });
  }

  function enterPool(id) {
    // Reuse the existing trace → attestation → seedLiquidity flow. Surface it in
    // the Pools tab so the user sees the attestation/seed result + status line.
    closeAgentPage();
    if (typeof switchTab === "function") switchTab("tab-pools");
    if (typeof traceConstellation === "function") setTimeout(() => traceConstellation(id), 60);
  }

  // ── exports ────────────────────────────────────────────────────────────────
  window.openPlanetAgentPage = openPlanetAgentPage;
  window.openStarAgentPage = openStarAgentPage;
  window.closeAgentPage = closeAgentPage;
})();
