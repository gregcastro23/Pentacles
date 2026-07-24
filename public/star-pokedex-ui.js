/* ============================================================
   PENTACLES — Star Pokédex & Registry UI Controller
   ============================================================
   Provides the interactive Star Pokédex modal overlay with real-time
   semantic search, preset filter chips, spectral star canvas visualization,
   astrophysical metrics grid, live sky positioning, and game map actions.
   ============================================================ */

(function (global) {
  "use strict";

  let escHandler = null;
  let animReq = null;

  // Local state
  const state = {
    query: "",
    selectedHip: 32349, // Sirius default
    conFilter: "",
    spectFilter: "",
    visibleOnly: false,
    maxMag: null,
    maxDistLy: null,
    activePreset: "all",
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function getSkyLive() {
    return (global.state && global.state.sky) ? global.state.sky : [];
  }

  function getLiveStar(hipId) {
    const live = getSkyLive();
    return live.find((s) => s.hip_id === hipId) || null;
  }

  // Open Star Pokédex modal (optionally targeting a specific HIP ID)
  function openStarPokedex(targetHip) {
    const ov = document.getElementById("star-pokedex-overlay");
    if (!ov) return;

    if (targetHip) {
      state.selectedHip = Number(targetHip);
    } else if (global.state && global.state.selectedStarHip) {
      state.selectedHip = Number(global.state.selectedStarHip);
    }

    if (global.HologramCamera) global.HologramCamera.autoRotate = false;

    ov.style.display = "flex";
    renderOverlayHtml();

    escHandler = (e) => {
      if (e.key === "Escape") closeStarPokedex();
    };
    document.addEventListener("keydown", escHandler);

    // Focus search input
    const input = document.getElementById("pokedex-search-input");
    if (input) input.focus();

    startStarCanvasAnimation();
  }

  function closeStarPokedex() {
    const ov = document.getElementById("star-pokedex-overlay");
    if (ov) {
      ov.style.display = "none";
      ov.innerHTML = "";
    }
    if (escHandler) {
      document.removeEventListener("keydown", escHandler);
      escHandler = null;
    }
    if (animReq) {
      cancelAnimationFrame(animReq);
      animReq = null;
    }
    if (global.HologramCamera) {
      global.HologramCamera.autoRotate = !document.documentElement.classList.contains("pt-reduced-motion");
    }
  }

  function selectPreset(presetKey) {
    state.activePreset = presetKey;
    state.conFilter = "";
    state.spectFilter = "";
    state.visibleOnly = false;
    state.maxMag = null;
    state.maxDistLy = null;

    if (presetKey === "brightest") {
      state.maxMag = 2.5;
    } else if (presetKey === "nearest") {
      state.maxDistLy = 50.0;
    } else if (presetKey === "visible") {
      state.visibleOnly = true;
    } else if (presetKey === "supergiants") {
      state.query = "red supergiant";
    } else if (presetKey === "yellow") {
      state.query = "yellow dwarf";
    } else if (presetKey === "all") {
      state.query = "";
    }
    renderResultsList();
  }

  function onSearchInput(val) {
    state.query = val;
    state.activePreset = "custom";
    renderResultsList();
  }

  function clearSearch() {
    state.query = "";
    state.activePreset = "all";
    state.conFilter = "";
    state.spectFilter = "";
    state.visibleOnly = false;
    state.maxMag = null;
    state.maxDistLy = null;
    const input = document.getElementById("pokedex-search-input");
    if (input) input.value = "";
    renderResultsList();
  }

  function selectStarItem(hipId) {
    state.selectedHip = Number(hipId);
    renderPokedexEntryCard();
    highlightSelectedListItem();
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      showMobileTab("entry");
    }
  }

  function showMobileTab(tab) {
    const sidebar = document.getElementById("pokedex-results-sidebar");
    const container = document.getElementById("pokedex-entry-container");
    const listBtn = document.getElementById("pokedex-tab-list");
    const entryBtn = document.getElementById("pokedex-tab-entry");

    if (sidebar && container) {
      if (tab === "list") {
        sidebar.classList.remove("mobile-hidden");
        container.classList.add("mobile-hidden");
        if (listBtn) listBtn.classList.add("active");
        if (entryBtn) entryBtn.classList.remove("active");
      } else {
        sidebar.classList.add("mobile-hidden");
        container.classList.remove("mobile-hidden");
        if (listBtn) listBtn.classList.remove("active");
        if (entryBtn) entryBtn.classList.add("active");
      }
    }
  }

  function highlightSelectedListItem() {
    const items = document.querySelectorAll(".pokedex-star-item");
    items.forEach((el) => {
      const hip = Number(el.getAttribute("data-hip"));
      el.classList.toggle("active", hip === state.selectedHip);
    });
  }

  // ── MAIN OVERLAY STRUCTURE ────────────────────────────────────────────────
  function renderOverlayHtml() {
    const ov = document.getElementById("star-pokedex-overlay");
    if (!ov) return;

    ov.innerHTML = `
      <div class="pokedex-window">
        <!-- HEADER BAR -->
        <header class="pokedex-header">
          <div class="pokedex-title-group">
            <h2 class="pokedex-title">✦ REAL-SKY STARDEX & CELESTIAL REGISTRY ✦</h2>
            <div class="pokedex-subtitle">8,870 Naked-Eye Stars Cataloged (HYG v4.1) · Real-Time Celestial Ephemeris</div>
          </div>
          <button class="pokedex-close-btn" title="Close (Esc)" onclick="closeStarPokedex()">✕</button>
        </header>

        <!-- MOBILE VIEW TABS -->
        <div id="pokedex-mobile-tabs" class="pokedex-mobile-tabs">
          <button id="pokedex-tab-list" class="pokedex-mobile-tab-btn active" onclick="StarPokedexUI.showMobileTab('list')">📋 Catalog List</button>
          <button id="pokedex-tab-entry" class="pokedex-mobile-tab-btn" onclick="StarPokedexUI.showMobileTab('entry')">⭐ Star Entry</button>
        </div>

        <!-- CONTROLS & SEARCH BAR -->
        <div class="pokedex-controls-bar">
          <div class="pokedex-search-box">
            <span class="pokedex-search-icon">🔍</span>
            <input type="text" id="pokedex-search-input" class="pokedex-search-input" 
                   placeholder="Search by Star Name, HIP/HD/HR ID, Constellation, Spectral Class (e.g. 'Sirius', 'Betelgeuse', '32349', 'red supergiants in Orion')..."
                   value="${esc(state.query)}"
                   oninput="StarPokedexUI.onSearchInput(this.value)">
            ${state.query ? `<button class="pokedex-search-clear" onclick="StarPokedexUI.clearSearch()">✕</button>` : ""}
          </div>

          <!-- PRESET FILTER CHIPS -->
          <div class="pokedex-preset-chips">
            <button class="pokedex-chip ${state.activePreset === 'all' ? 'active' : ''}" onclick="StarPokedexUI.selectPreset('all')">✦ All Stars</button>
            <button class="pokedex-chip ${state.activePreset === 'brightest' ? 'active' : ''}" onclick="StarPokedexUI.selectPreset('brightest')">⭐ Brightest (m ≤ 2.5)</button>
            <button class="pokedex-chip ${state.activePreset === 'nearest' ? 'active' : ''}" onclick="StarPokedexUI.selectPreset('nearest')">📍 Nearest (< 50 ly)</button>
            <button class="pokedex-chip ${state.activePreset === 'visible' ? 'active' : ''}" onclick="StarPokedexUI.selectPreset('visible')">🌅 Visible Above Horizon</button>
            <button class="pokedex-chip ${state.activePreset === 'supergiants' ? 'active' : ''}" onclick="StarPokedexUI.selectPreset('supergiants')">🔴 Red Supergiants</button>
            <button class="pokedex-chip ${state.activePreset === 'yellow' ? 'active' : ''}" onclick="StarPokedexUI.selectPreset('yellow')">🟡 Yellow Dwarfs</button>
          </div>
        </div>

        <!-- MAIN SPLIT VIEW -->
        <div class="pokedex-split-view">
          <!-- LEFT SIDEBAR RESULTS -->
          <aside id="pokedex-results-sidebar" class="pokedex-results-sidebar">
            <div id="pokedex-results-count" class="pokedex-results-count">Searching catalogue...</div>
            <div id="pokedex-results-list" class="pokedex-results-list"></div>
          </aside>

          <!-- RIGHT DETAIL CARD ENTRY -->
          <main id="pokedex-entry-container" class="pokedex-entry-container"></main>
        </div>
      </div>
    `;

    renderResultsList();
    renderPokedexEntryCard();
  }

  // ── RENDER RESULTS LIST ───────────────────────────────────────────────────
  function renderResultsList() {
    const container = document.getElementById("pokedex-results-list");
    const countEl = document.getElementById("pokedex-results-count");
    if (!container) return;

    const skyLive = getSkyLive();
    const results = StarRegistry.search(state.query, {
      limit: 100,
      conFilter: state.conFilter || null,
      spectFilter: state.spectFilter || null,
      maxMag: state.maxMag,
      maxDistLy: state.maxDistLy,
      visibleOnly: state.visibleOnly,
      skyLiveList: skyLive,
    });

    if (countEl) {
      countEl.textContent = `Catalog Match: ${results.length} Star${results.length === 1 ? '' : 's'}${state.visibleOnly ? ' (Visible Now)' : ''}`;
    }

    if (!results.length) {
      container.innerHTML = `<div class="pokedex-empty-state">No celestial bodies match query "${esc(state.query)}". Try searching for "Sirius", "32349", "Orion", or "Red Supergiant".</div>`;
      return;
    }

    // Ensure selected hip is in results or default to first
    if (!results.some((s) => s.hip_id === state.selectedHip)) {
      state.selectedHip = results[0].hip_id;
      renderPokedexEntryCard();
    }

    container.innerHTML = results.map((star) => {
      const activeClass = star.hip_id === state.selectedHip ? "active" : "";
      const spect = star.spectMeta;
      const live = getLiveStar(star.hip_id);

      return `
        <div class="pokedex-star-item ${activeClass}" data-hip="${star.hip_id}" onclick="StarPokedexUI.selectStarItem(${star.hip_id})">
          <div class="pokedex-star-dot" style="background:${spect.color}; box-shadow:0 0 10px ${spect.glow};"></div>
          <div class="pokedex-star-info">
            <div class="pokedex-star-name-row">
              <span class="pokedex-star-name">${esc(star.name)}</span>
              <span class="pokedex-star-mag">m ${star.magnitude.toFixed(2)}</span>
            </div>
            <div class="pokedex-star-sub">
              ${star.conName ? `${esc(star.conName)} (${star.con})` : "Deep Sky"} · ${esc(spect.className)}
            </div>
            <div class="pokedex-star-ids">
              HIP ${star.hip_id} ${star.hd ? `· HD ${star.hd}` : ""} ${star.dist_ly ? `· ${star.dist_ly} ly` : ""}
              ${live ? `<span class="pokedex-badge-visible">🌅 ${live.alt.toFixed(0)}° UP</span>` : ""}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  // ── RENDER POKÉDEX ENTRY CARD ─────────────────────────────────────────────
  function renderPokedexEntryCard() {
    const container = document.getElementById("pokedex-entry-container");
    if (!container) return;

    const star = StarRegistry.getByHip(state.selectedHip);
    if (!star) {
      container.innerHTML = `<div class="pokedex-empty-state">Select a star to inspect its Pokédex entry.</div>`;
      return;
    }

    const spect = star.spectMeta;
    const live = getLiveStar(star.hip_id);

    // Staking pool / holding status in Pentacles engine
    const holdings = global.state ? (global.state.holdings || {}) : {};
    const holdingPlanet = holdings[star.hip_id] || star.held_by || null;
    const planetNames = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
    const holdingName = holdingPlanet !== null ? (planetNames[holdingPlanet] || `Faction ${holdingPlanet}`) : "Unclaimed Neutral Node";

    container.innerHTML = `
      <div class="pokedex-card">
        <!-- VISUAL HEADER CANVAS STAGE -->
        <div class="pokedex-visual-stage" style="background: radial-gradient(circle at center, ${spect.bg} 0%, rgba(5,7,15,0.95) 75%);">
          <canvas id="pokedex-star-canvas" class="pokedex-star-canvas" width="300" height="180"></canvas>
          <div class="pokedex-stage-overlay">
            <span class="pokedex-stage-badge" style="border-color:${spect.color}; color:${spect.color};">
              ${esc(spect.categoryTitle)}
            </span>
            <span class="pokedex-stage-badge">
              Apparent Mag: ${star.magnitude.toFixed(2)}
            </span>
            ${star.dist_ly ? `<span class="pokedex-stage-badge">Distance: ${star.dist_ly} light-years</span>` : ""}
          </div>
        </div>

        <!-- IDENTITY & TITLES -->
        <div class="pokedex-identity-block">
          <div class="pokedex-identity-main">
            <h1 class="pokedex-hero-name">${esc(star.name)}</h1>
            <div class="pokedex-hero-designation">${esc(star.bayerFull || star.name)}</div>
          </div>
          <div class="pokedex-catalog-ids">
            <span class="pokedex-id-tag">HIP ${star.hip_id}</span>
            ${star.hd ? `<span class="pokedex-id-tag">HD ${star.hd}</span>` : ""}
            ${star.hr ? `<span class="pokedex-id-tag">HR ${star.hr}</span>` : ""}
            ${star.con ? `<span class="pokedex-id-tag con-tag">${esc(star.conName)} (${star.con})</span>` : ""}
          </div>
        </div>

        <!-- ASTROLOGICAL ECLIPTIC & ZODIAC SIGN SECTION -->
        <div class="pokedex-stats-section">
          <h3 class="pokedex-section-title">✦ Astrological Ecliptic & Zodiac Sign Alignment</h3>
          <div class="pokedex-stats-grid">
            <div class="pokedex-stat-card">
              <div class="pokedex-stat-label">Zodiac Sign & Symbol</div>
              <div class="pokedex-stat-value" style="color:var(--gold-bright);">${star.ecliptic ? `${star.ecliptic.signSymbol} ${star.ecliptic.signName}` : "N/A"}</div>
              <div class="pokedex-stat-sub">${star.ecliptic ? `${star.ecliptic.deg}° ${star.ecliptic.min}' within sign` : ""}</div>
            </div>

            <div class="pokedex-stat-card">
              <div class="pokedex-stat-label">Exact Ecliptic Longitude</div>
              <div class="pokedex-stat-value">${star.ecliptic ? star.ecliptic.formatted : "N/A"}</div>
              <div class="pokedex-stat-sub">${star.ecliptic ? `λ = ${star.ecliptic.lambda.toFixed(4)}° ecliptic` : ""}</div>
            </div>

            <div class="pokedex-stat-card">
              <div class="pokedex-stat-label">Ecliptic Latitude (β)</div>
              <div class="pokedex-stat-value">${star.ecliptic ? `${star.ecliptic.beta >= 0 ? '+' : ''}${star.ecliptic.beta.toFixed(4)}°` : "N/A"}</div>
              <div class="pokedex-stat-sub">Angular distance from celestial ecliptic</div>
            </div>
          </div>
        </div>

        <!-- ASTROPHYSICAL STATISTICS GRID -->
        <div class="pokedex-stats-section">
          <h3 class="pokedex-section-title">✦ Astrophysical Properties & Classification</h3>
          <div class="pokedex-stats-grid">
            <div class="pokedex-stat-card">
              <div class="pokedex-stat-label">Spectral Class & Type</div>
              <div class="pokedex-stat-value" style="color:${spect.color};">${esc(spect.fullSpect)}</div>
              <div class="pokedex-stat-sub">${esc(spect.desc)}</div>
            </div>

            <div class="pokedex-stat-card">
              <div class="pokedex-stat-label">Surface Temperature</div>
              <div class="pokedex-stat-value">${spect.tempK.toLocaleString()} K</div>
              <div class="pokedex-stat-sub">${star.ci !== null ? `B-V Color Index: ${star.ci}` : "Estimated Effective Temp"}</div>
            </div>

            <div class="pokedex-stat-card">
              <div class="pokedex-stat-label">Absolute Mag & Luminosity</div>
              <div class="pokedex-stat-value">M = ${star.absmag !== null ? star.absmag.toFixed(2) : "N/A"}</div>
              <div class="pokedex-stat-sub">${star.lum !== null ? `${star.lum.toLocaleString()} × Solar (L☉)` : "Luminosity uncalibrated"}</div>
            </div>

            <div class="pokedex-stat-card">
              <div class="pokedex-stat-label">Distance from Earth</div>
              <div class="pokedex-stat-value">${star.dist_ly ? `${star.dist_ly.toLocaleString()} ly` : "N/A"}</div>
              <div class="pokedex-stat-sub">${star.dist_pc ? `${star.dist_pc.toLocaleString()} parsecs` : ""}</div>
            </div>

            <div class="pokedex-stat-card">
              <div class="pokedex-stat-label">Right Ascension (RA)</div>
              <div class="pokedex-stat-value">${star.raSex}</div>
              <div class="pokedex-stat-sub">${star.ra.toFixed(4)}° equatorial</div>
            </div>

            <div class="pokedex-stat-card">
              <div class="pokedex-stat-label">Declination (Dec)</div>
              <div class="pokedex-stat-value">${star.decSex}</div>
              <div class="pokedex-stat-sub">${star.dec.toFixed(4)}° equatorial</div>
            </div>
          </div>
        </div>

        <!-- LIVE OBSERVER & GAME STATE -->
        <div class="pokedex-game-section">
          <h3 class="pokedex-section-title">✦ Live Observer Ephemeris & Horizon Encounter</h3>
          <div class="pokedex-game-grid">
            <div class="pokedex-game-card">
              <div class="pokedex-game-label">Sexagesimal Refracted Altitude</div>
              <div class="pokedex-game-value ${live ? 'text-gold' : 'text-dim'}">
                ${live && live.altSexagesimal ? live.altSexagesimal : (live ? `${live.alt >= 0 ? '+' : ''}${live.alt.toFixed(1)}°` : '🌌 BELOW HORIZON EDGE')}
              </div>
              <div class="pokedex-stat-sub">Apparent Alt (Refraction & Dip Applied)</div>
            </div>

            <div class="pokedex-game-card">
              <div class="pokedex-game-label">Sexagesimal Azimuth Heading</div>
              <div class="pokedex-game-value ${live ? 'text-gold' : 'text-dim'}">
                ${live && live.azSexagesimal ? live.azSexagesimal : (live ? `${live.az.toFixed(1)}°` : 'N/A')}
              </div>
              <div class="pokedex-stat-sub">True Horizon Azimuth Bearing</div>
            </div>

            <div class="pokedex-game-card">
              <div class="pokedex-game-label">Live Horizon Encounter Status</div>
              <div class="pokedex-game-value ${live ? 'text-gold' : 'text-dim'}">
                ${live ? (live.horizonEncounter || (live.alt >= 0 && live.alt <= 15) ? `🌅 ON HORIZON BAND` : `⬆ ABOVE HORIZON EDGE`) : '🌌 BELOW HORIZON EDGE'}
              </div>
            </div>

            <div class="pokedex-game-card">
              <div class="pokedex-game-label">Pentacle Sky Zone</div>
              <div class="pokedex-game-value">
                ${live && live.zone !== null ? `Zone ${live.zone} (${getZoneName(live.zone)})` : `Equatorial Zone (Unanchored)`}
              </div>
            </div>

            <div class="pokedex-game-card">
              <div class="pokedex-game-label">Faction Control Status</div>
              <div class="pokedex-game-value">${holdingName}</div>
            </div>

            <div class="pokedex-game-card">
              <div class="pokedex-game-label">Node Weight (Capture Value)</div>
              <div class="pokedex-game-value">✦ ${star.weight.toFixed(3)}</div>
            </div>
          </div>
        </div>

        <!-- ACTIONS BAR -->
        <div class="pokedex-actions-bar">
          <button class="btn btn-primary" onclick="StarPokedexUI.centerStarOnMap(${star.hip_id})">📍 Center on Sky Map</button>
          <button class="btn" onclick="StarPokedexUI.aimCameraAtHorizon(${star.hip_id})">🎥 Point Camera at Horizon</button>
          <button class="btn" onclick="StarPokedexUI.syncSpacetimeDB()">⚡ Sync StarDex to SpacetimeDB</button>
          <button class="btn" onclick="StarPokedexUI.targetStarForSiege(${star.hip_id})">⚔ Target for Siege</button>
        </div>
      </div>
    `;

    startStarCanvasAnimation();
  }

  function getZoneName(zone) {
    const names = [
      "Ascendant Arc", "Zenith Arc", "Descendant Arc", "Nadir Arc", "Horizon Arc",
      "Spire I", "Spire II", "Spire III", "Spire IV", "Spire V", "Central Crown"
    ];
    return names[zone] || `Zone ${zone}`;
  }

  // ── STAR CANVAS ANIMATION ─────────────────────────────────────────────────
  function startStarCanvasAnimation() {
    if (animReq) {
      cancelAnimationFrame(animReq);
      animReq = null;
    }

    const canvas = document.getElementById("pokedex-star-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const star = StarRegistry.getByHip(state.selectedHip);
    if (!star) return;

    const spect = star.spectMeta;
    let frame = 0;

    function renderFrame() {
      frame += 0.03;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;

      ctx.clearRect(0, 0, w, h);

      // Pulsating corona radius
      const r = 28 + Math.sin(frame) * 2;

      // Outer atmosphere glow
      const outerGlow = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r * 3.5);
      outerGlow.addColorStop(0, spect.color);
      outerGlow.addColorStop(0.4, spect.bg);
      outerGlow.addColorStop(1, "rgba(5,7,15,0)");

      ctx.fillStyle = outerGlow;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Stellar Core
      const coreGrad = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r);
      coreGrad.addColorStop(0, "#ffffff");
      coreGrad.addColorStop(0.6, spect.color);
      coreGrad.addColorStop(1, spect.glow);

      ctx.fillStyle = coreGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();

      // Diffraction rays
      ctx.strokeStyle = spect.color;
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = 0.4 + Math.sin(frame * 1.5) * 0.15;

      for (let i = 0; i < 4; i++) {
        const angle = (Math.PI / 4) * i + frame * 0.05;
        const len = r * 2.8 + Math.sin(frame + i) * 6;
        ctx.beginPath();
        ctx.moveTo(cx - Math.cos(angle) * len, cy - Math.sin(angle) * len);
        ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len);
        ctx.stroke();
      }

      ctx.globalAlpha = 1.0;

      animReq = requestAnimationFrame(renderFrame);
    }

    renderFrame();
  }

  // ── ACTIONS ───────────────────────────────────────────────────────────────
  function centerStarOnMap(hipId) {
    closeStarPokedex();
    if (global.selectStarByHip) {
      global.selectStarByHip(hipId);
    } else if (global.state) {
      global.state.selectedStarHip = hipId;
      const live = getLiveStar(hipId);
      if (live && global.HologramCamera) {
        global.HologramCamera.targetYaw = live.az;
        global.HologramCamera.targetPitch = 0;
        global.HologramCamera.targetScale = 2.5;
        global.HologramCamera.isZoomed = true;
      }
      if (global.renderActiveHand) global.renderActiveHand();
    }
  }

  function targetStarForSiege(hipId) {
    centerStarOnMap(hipId);
    if (global.switchTab) global.switchTab("tab-duel");
  }

  function aimCameraAtHorizon(hipId) {
    closeStarPokedex();
    const video = document.getElementById("ar-video-bg");
    if (global.toggleARMode && (!video || !video.classList.contains("active"))) {
      global.toggleARMode();
    }
    const live = getLiveStar(hipId);
    if (live) {
      if (global.HorizonTracker && global.HorizonTracker.state) {
        global.HorizonTracker.state.gyro.camAz = live.az;
        global.HorizonTracker.state.gyro.camAlt = live.alt;
        if (global.HorizonTrackerUI) global.HorizonTrackerUI.updateHUD();
      }
      if (global.selectStarByHip) global.selectStarByHip(hipId);
    }
  }

  function syncSpacetimeDB() {
    const net = global.Pentacles && global.Pentacles.net;
    if (net && net.isLive && typeof net.callReducer === "function") {
      const observer = global.state ? global.state.observer : { lat: 0, lon: 0, alt_m: 0 };
      net.callReducer("set_location", [observer.lat, observer.lon])
        .then(() => {
          if (global.toast) global.toast("Location synced. Complete a horizon trace to attest the StarDex ephemeris.", { type: "success" });
        })
        .catch((error) => {
          if (global.toast) global.toast(error && error.message ? error.message : "Location sync failed.", { type: "error" });
        });
    } else if (global.toast) {
      global.toast("Connect to SpacetimeDB before syncing your horizon.", { type: "info" });
    }
  }

  // Export UI Controller
  const StarPokedexUI = {
    openStarPokedex,
    closeStarPokedex,
    selectPreset,
    onSearchInput,
    clearSearch,
    selectStarItem,
    showMobileTab,
    centerStarOnMap,
    aimCameraAtHorizon,
    syncSpacetimeDB,
    targetStarForSiege,
  };

  global.openStarPokedex = openStarPokedex;
  global.closeStarPokedex = closeStarPokedex;
  global.StarPokedexUI = StarPokedexUI;
})(typeof window !== "undefined" ? window : this);
