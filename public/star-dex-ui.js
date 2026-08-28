/* ============================================================
   PENTACLES — Real-Sky Star-Dex & Celestial Registry UI Controller
   ============================================================
   Provides the interactive Star-Dex modal overlay with real-time
   semantic search, preset filter chips, constellation filtering,
   multi-criteria sorting, animated spectral star canvas,
   astrophysical metrics grid, zodiac ecliptic alignment, live
   horizon observer positioning, and sky map/AR actions.
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
    sortBy: "mag", // mag | dist | ecliptic | name
    visibleOnly: false,
    maxMag: null,
    maxDistLy: null,
    activePreset: "all",
  };

  const CONSTELLATIONS_LIST = [
    { code: "", name: "✦ All Constellations (88 IAU)" },
    { code: "Ari", name: "Aries (Ram) ♈" },
    { code: "Tau", name: "Taurus (Bull) ♉" },
    { code: "Gem", name: "Gemini (Twins) ♊" },
    { code: "Cnc", name: "Cancer (Crab) ♋" },
    { code: "Leo", name: "Leo (Lion) ♌" },
    { code: "Vir", name: "Virgo (Maiden) ♍" },
    { code: "Lib", name: "Libra (Scales) ♎" },
    { code: "Sco", name: "Scorpio (Scorpion) ♏" },
    { code: "Sgr", name: "Sagittarius (Archer) ♐" },
    { code: "Cap", name: "Capricornus (Sea-Goat) ♑" },
    { code: "Aqr", name: "Aquarius (Water-Bearer) ♒" },
    { code: "Psc", name: "Pisces (Fishes) ♓" },
    { code: "Ori", name: "Orion (Hunter)" },
    { code: "UMa", name: "Ursa Major (Great Bear)" },
    { code: "UMi", name: "Ursa Minor (Little Bear)" },
    { code: "Cas", name: "Cassiopeia (Queen)" },
    { code: "Cyg", name: "Cygnus (Swan)" },
    { code: "Lyr", name: "Lyra (Harp)" },
    { code: "Aql", name: "Aquila (Eagle)" },
    { code: "CMa", name: "Canis Major (Great Dog)" },
    { code: "CMi", name: "Canis Minor (Lesser Dog)" },
    { code: "Cru", name: "Crux (Southern Cross)" },
    { code: "Cen", name: "Centaurus (Centaur)" },
    { code: "Car", name: "Carina (Keel)" },
    { code: "Peg", name: "Pegasus (Winged Horse)" },
    { code: "And", name: "Andromeda (Princess)" },
    { code: "Per", name: "Perseus (Hero)" },
    { code: "Aur", name: "Auriga (Charioteer)" },
    { code: "Boo", name: "Boötes (Herdsman)" },
    { code: "Her", name: "Hercules (Hero)" },
    { code: "Oph", name: "Ophiuchus (Serpent-Bearer)" },
    { code: "Eri", name: "Eridanus (River)" },
    { code: "Hya", name: "Hydra (Sea Serpent)" },
  ];

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

  function getOverlayEl() {
    return document.getElementById("star-dex-overlay") || document.getElementById("star-pokedex-overlay");
  }

  // Open Star-Dex modal (optionally targeting a specific HIP ID)
  function openStarDex(targetHip) {
    const ov = getOverlayEl();
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
      if (e.key === "Escape") closeStarDex();
    };
    document.addEventListener("keydown", escHandler);

    // Focus search input
    const input = document.getElementById("stardex-search-input") || document.getElementById("pokedex-search-input");
    if (input) input.focus();

    startStarCanvasAnimation();
  }

  function closeStarDex() {
    const ov = getOverlayEl();
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
    } else if (presetKey === "zodiac") {
      state.query = "zodiac";
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

  function onConstellationChange(code) {
    state.conFilter = code;
    renderResultsList();
  }

  function onSortChange(sortVal) {
    state.sortBy = sortVal;
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
    const input = document.getElementById("stardex-search-input") || document.getElementById("pokedex-search-input");
    if (input) input.value = "";
    const conSelect = document.getElementById("stardex-con-select");
    if (conSelect) conSelect.value = "";
    renderResultsList();
  }

  function selectStarItem(hipId) {
    state.selectedHip = Number(hipId);
    renderStarDexEntryCard();
    highlightSelectedListItem();
    if (typeof window !== "undefined" && window.innerWidth <= 768) {
      showMobileTab("entry");
    }
  }

  function showMobileTab(tab) {
    const sidebar = document.getElementById("stardex-results-sidebar") || document.getElementById("pokedex-results-sidebar");
    const container = document.getElementById("stardex-entry-container") || document.getElementById("pokedex-entry-container");
    const listBtn = document.getElementById("stardex-tab-list") || document.getElementById("pokedex-tab-list");
    const entryBtn = document.getElementById("stardex-tab-entry") || document.getElementById("pokedex-tab-entry");

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
    const items = document.querySelectorAll(".stardex-star-item, .pokedex-star-item");
    items.forEach((el) => {
      const hip = Number(el.getAttribute("data-hip"));
      el.classList.toggle("active", hip === state.selectedHip);
    });
  }

  // ── MAIN OVERLAY STRUCTURE ────────────────────────────────────────────────
  function renderOverlayHtml() {
    const ov = getOverlayEl();
    if (!ov) return;

    ov.innerHTML = `
      <div class="stardex-window pokedex-window">
        <!-- HEADER BAR -->
        <header class="stardex-header pokedex-header">
          <div class="stardex-title-group pokedex-title-group">
            <h2 class="stardex-title pokedex-title">✦ REAL-SKY STAR-DEX & CELESTIAL REGISTRY ✦</h2>
            <div class="stardex-subtitle pokedex-subtitle">8,870 Naked-Eye Stars Cataloged (HYG v4.1) · Real-Time Celestial Ephemeris</div>
          </div>
          <button class="stardex-close-btn pokedex-close-btn" title="Close (Esc)" onclick="StarDexUI.closeStarDex()">✕</button>
        </header>

        <!-- MOBILE VIEW TABS -->
        <div id="stardex-mobile-tabs" class="stardex-mobile-tabs pokedex-mobile-tabs">
          <button id="stardex-tab-list" class="stardex-mobile-tab-btn pokedex-mobile-tab-btn active" onclick="StarDexUI.showMobileTab('list')">📋 Catalog List</button>
          <button id="stardex-tab-entry" class="stardex-mobile-tab-btn pokedex-mobile-tab-btn" onclick="StarDexUI.showMobileTab('entry')">⭐ Star Entry</button>
        </div>

        <!-- CONTROLS & SEARCH BAR -->
        <div class="stardex-controls-bar pokedex-controls-bar">
          <div class="stardex-search-row">
            <div class="stardex-search-box pokedex-search-box">
              <span class="stardex-search-icon pokedex-search-icon">🔍</span>
              <input type="text" id="stardex-search-input" class="stardex-search-input pokedex-search-input" 
                     placeholder="Search by Star Name, HIP/HD/HR ID, Constellation, Spectral Class (e.g. 'Sirius', 'Betelgeuse', '32349', 'red supergiants in Orion')..."
                     value="${esc(state.query)}"
                     oninput="StarDexUI.onSearchInput(this.value)">
              ${state.query ? `<button class="stardex-search-clear pokedex-search-clear" onclick="StarDexUI.clearSearch()">✕</button>` : ""}
            </div>

            <!-- Constellation & Sort Selectors -->
            <div class="stardex-dropdowns-bar">
              <select id="stardex-con-select" class="stardex-select" onchange="StarDexUI.onConstellationChange(this.value)">
                ${CONSTELLATIONS_LIST.map((c) => `<option value="${c.code}" ${state.conFilter === c.code ? 'selected' : ''}>${esc(c.name)}</option>`).join("")}
              </select>

              <select id="stardex-sort-select" class="stardex-select" onchange="StarDexUI.onSortChange(this.value)">
                <option value="mag" ${state.sortBy === 'mag' ? 'selected' : ''}>⭐ Sort: Brightest First</option>
                <option value="dist" ${state.sortBy === 'dist' ? 'selected' : ''}>📍 Sort: Nearest First</option>
                <option value="ecliptic" ${state.sortBy === 'ecliptic' ? 'selected' : ''}>♈ Sort: Zodiac Ecliptic Order</option>
                <option value="name" ${state.sortBy === 'name' ? 'selected' : ''}>🔤 Sort: Alphabetical (A-Z)</option>
              </select>
            </div>
          </div>

          <!-- PRESET FILTER CHIPS -->
          <div class="stardex-preset-chips pokedex-preset-chips">
            <button class="stardex-chip pokedex-chip ${state.activePreset === 'all' ? 'active' : ''}" onclick="StarDexUI.selectPreset('all')">✦ All Stars</button>
            <button class="stardex-chip pokedex-chip ${state.activePreset === 'brightest' ? 'active' : ''}" onclick="StarDexUI.selectPreset('brightest')">⭐ Brightest (m ≤ 2.5)</button>
            <button class="stardex-chip pokedex-chip ${state.activePreset === 'nearest' ? 'active' : ''}" onclick="StarDexUI.selectPreset('nearest')">📍 Nearest (< 50 ly)</button>
            <button class="stardex-chip pokedex-chip ${state.activePreset === 'visible' ? 'active' : ''}" onclick="StarDexUI.selectPreset('visible')">🌅 Visible Above Horizon</button>
            <button class="stardex-chip pokedex-chip ${state.activePreset === 'supergiants' ? 'active' : ''}" onclick="StarDexUI.selectPreset('supergiants')">🔴 Red Supergiants</button>
            <button class="stardex-chip pokedex-chip ${state.activePreset === 'yellow' ? 'active' : ''}" onclick="StarDexUI.selectPreset('yellow')">🟡 Yellow Dwarfs</button>
            <button class="stardex-chip pokedex-chip ${state.activePreset === 'zodiac' ? 'active' : ''}" onclick="StarDexUI.selectPreset('zodiac')">♈ Zodiac Alignments</button>
          </div>
        </div>

        <!-- MAIN SPLIT VIEW -->
        <div class="stardex-split-view pokedex-split-view">
          <!-- LEFT SIDEBAR RESULTS -->
          <aside id="stardex-results-sidebar" class="stardex-results-sidebar pokedex-results-sidebar">
            <div id="stardex-results-count" class="stardex-results-count pokedex-results-count">Searching catalog...</div>
            <div id="stardex-results-list" class="stardex-results-list pokedex-results-list"></div>
          </aside>

          <!-- RIGHT DETAIL CARD ENTRY -->
          <main id="stardex-entry-container" class="stardex-entry-container pokedex-entry-container"></main>
        </div>
      </div>
    `;

    renderResultsList();
    renderStarDexEntryCard();
  }

  // ── RENDER RESULTS LIST ───────────────────────────────────────────────────
  function renderResultsList() {
    const container = document.getElementById("stardex-results-list") || document.getElementById("pokedex-results-list");
    const countEl = document.getElementById("stardex-results-count") || document.getElementById("pokedex-results-count");
    if (!container) return;

    const skyLive = getSkyLive();
    let results = StarRegistry.search(state.query, {
      limit: 150,
      conFilter: state.conFilter || null,
      spectFilter: state.spectFilter || null,
      maxMag: state.maxMag,
      maxDistLy: state.maxDistLy,
      visibleOnly: state.visibleOnly,
      skyLiveList: skyLive,
    });

    // Custom sorting
    if (state.sortBy === "dist") {
      results.sort((a, b) => (a.dist_ly || 99999) - (b.dist_ly || 99999));
    } else if (state.sortBy === "ecliptic") {
      results.sort((a, b) => ((a.ecliptic && a.ecliptic.lambda) || 0) - ((b.ecliptic && b.ecliptic.lambda) || 0));
    } else if (state.sortBy === "name") {
      results.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    } else {
      // Default: mag
      results.sort((a, b) => a.magnitude - b.magnitude);
    }

    if (countEl) {
      countEl.textContent = `Catalog Match: ${results.length} Star${results.length === 1 ? '' : 's'}${state.visibleOnly ? ' (Visible Now)' : ''}`;
    }

    if (!results.length) {
      container.innerHTML = `<div class="stardex-empty-state pokedex-empty-state">No celestial bodies match query "${esc(state.query)}". Try searching for "Sirius", "Betelgeuse", "32349", "Orion", or "Red Supergiant".</div>`;
      return;
    }

    // Ensure selected hip is in results or default to first
    if (!results.some((s) => s.hip_id === state.selectedHip)) {
      state.selectedHip = results[0].hip_id;
      renderStarDexEntryCard();
    }

    container.innerHTML = results.map((star) => {
      const activeClass = star.hip_id === state.selectedHip ? "active" : "";
      const spect = star.spectMeta;
      const live = getLiveStar(star.hip_id);

      return `
        <div class="stardex-star-item pokedex-star-item ${activeClass}" data-hip="${star.hip_id}" onclick="StarDexUI.selectStarItem(${star.hip_id})">
          <div class="stardex-star-dot pokedex-star-dot" style="background:${spect.color}; box-shadow:0 0 10px ${spect.glow};"></div>
          <div class="stardex-star-info pokedex-star-info">
            <div class="stardex-star-name-row pokedex-star-name-row">
              <span class="stardex-star-name pokedex-star-name">${esc(star.name)}</span>
              <span class="stardex-star-mag pokedex-star-mag">m ${star.magnitude.toFixed(2)}</span>
            </div>
            <div class="stardex-star-sub pokedex-star-sub">
              ${star.conName ? `${esc(star.conName)} (${star.con})` : "Deep Sky"} · ${esc(spect.className)}
            </div>
            <div class="stardex-star-ids pokedex-star-ids">
              HIP ${star.hip_id} ${star.hd ? `· HD ${star.hd}` : ""} ${star.dist_ly ? `· ${star.dist_ly} ly` : ""}
              ${live ? `<span class="stardex-badge-visible pokedex-badge-visible">🌅 ${live.alt.toFixed(0)}° UP</span>` : ""}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  // ── RENDER STAR-DEX ENTRY CARD ────────────────────────────────────────────
  function renderStarDexEntryCard() {
    const container = document.getElementById("stardex-entry-container") || document.getElementById("pokedex-entry-container");
    if (!container) return;

    const star = StarRegistry.getByHip(state.selectedHip);
    if (!star) {
      container.innerHTML = `<div class="stardex-empty-state pokedex-empty-state">Select a star to inspect its Star-Dex entry.</div>`;
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
      <div class="stardex-card pokedex-card">
        <!-- VISUAL HEADER CANVAS STAGE -->
        <div class="stardex-visual-stage pokedex-visual-stage" style="background: radial-gradient(circle at center, ${spect.bg} 0%, rgba(5,7,15,0.95) 75%);">
          <canvas id="stardex-star-canvas" class="stardex-star-canvas pokedex-star-canvas" width="320" height="190"></canvas>
          <div class="stardex-stage-overlay pokedex-stage-overlay">
            <span class="stardex-stage-badge pokedex-stage-badge" style="border-color:${spect.color}; color:${spect.color};">
              ${esc(spect.categoryTitle)}
            </span>
            <span class="stardex-stage-badge pokedex-stage-badge">
              Apparent Mag: ${star.magnitude.toFixed(2)}
            </span>
            ${star.dist_ly ? `<span class="stardex-stage-badge pokedex-stage-badge">Distance: ${star.dist_ly} light-years</span>` : ""}
          </div>
        </div>

        <!-- IDENTITY & TITLES -->
        <div class="stardex-identity-block pokedex-identity-block">
          <div class="stardex-identity-main pokedex-identity-main">
            <h1 class="stardex-hero-name pokedex-hero-name">${esc(star.name)}</h1>
            <div class="stardex-hero-designation pokedex-hero-designation">${esc(star.bayerFull || star.name)}</div>
          </div>
          <div class="stardex-catalog-ids pokedex-catalog-ids">
            <span class="stardex-id-tag pokedex-id-tag">HIP ${star.hip_id}</span>
            ${star.hd ? `<span class="stardex-id-tag pokedex-id-tag">HD ${star.hd}</span>` : ""}
            ${star.hr ? `<span class="stardex-id-tag pokedex-id-tag">HR ${star.hr}</span>` : ""}
            ${star.con ? `<span class="stardex-id-tag pokedex-id-tag con-tag">${esc(star.conName)} (${star.con})</span>` : ""}
          </div>
        </div>

        <!-- ASTROLOGICAL ECLIPTIC & ZODIAC SIGN SECTION -->
        <div class="stardex-stats-section pokedex-stats-section">
          <h3 class="stardex-section-title pokedex-section-title">✦ Astrological Ecliptic & Zodiac Sign Alignment</h3>
          <div class="stardex-stats-grid pokedex-stats-grid">
            <div class="stardex-stat-card pokedex-stat-card">
              <div class="stardex-stat-label pokedex-stat-label">Zodiac Sign & Symbol</div>
              <div class="stardex-stat-value pokedex-stat-value" style="color:var(--gold-bright);">${star.ecliptic ? `${star.ecliptic.signSymbol} ${star.ecliptic.signName}` : "N/A"}</div>
              <div class="stardex-stat-sub pokedex-stat-sub">${star.ecliptic ? `${star.ecliptic.deg}° ${star.ecliptic.min}' within sign` : ""}</div>
            </div>

            <div class="stardex-stat-card pokedex-stat-card">
              <div class="stardex-stat-label pokedex-stat-label">Exact Ecliptic Longitude</div>
              <div class="stardex-stat-value pokedex-stat-value">${star.ecliptic ? star.ecliptic.formatted : "N/A"}</div>
              <div class="stardex-stat-sub pokedex-stat-sub">${star.ecliptic ? `λ = ${star.ecliptic.lambda.toFixed(4)}° ecliptic` : ""}</div>
            </div>

            <div class="stardex-stat-card pokedex-stat-card">
              <div class="stardex-stat-label pokedex-stat-label">Ecliptic Latitude (β)</div>
              <div class="stardex-stat-value pokedex-stat-value">${star.ecliptic ? `${star.ecliptic.beta >= 0 ? '+' : ''}${star.ecliptic.beta.toFixed(4)}°` : "N/A"}</div>
              <div class="stardex-stat-sub pokedex-stat-sub">Angular distance from celestial ecliptic</div>
            </div>
          </div>
        </div>

        <!-- ASTROPHYSICAL STATISTICS GRID -->
        <div class="stardex-stats-section pokedex-stats-section">
          <h3 class="stardex-section-title pokedex-section-title">✦ Astrophysical Properties & Classification</h3>
          <div class="stardex-stats-grid pokedex-stats-grid">
            <div class="stardex-stat-card pokedex-stat-card">
              <div class="stardex-stat-label pokedex-stat-label">Spectral Class & Type</div>
              <div class="stardex-stat-value pokedex-stat-value" style="color:${spect.color};">${esc(spect.fullSpect)}</div>
              <div class="stardex-stat-sub pokedex-stat-sub">${esc(spect.desc)}</div>
            </div>

            <div class="stardex-stat-card pokedex-stat-card">
              <div class="stardex-stat-label pokedex-stat-label">Surface Temperature</div>
              <div class="stardex-stat-value pokedex-stat-value">${spect.tempK.toLocaleString()} K</div>
              <div class="stardex-stat-sub pokedex-stat-sub">${star.ci !== null ? `B-V Color Index: ${star.ci}` : "Estimated Effective Temp"}</div>
            </div>

            <div class="stardex-stat-card pokedex-stat-card">
              <div class="stardex-stat-label pokedex-stat-label">Absolute Mag & Luminosity</div>
              <div class="stardex-stat-value pokedex-stat-value">M = ${star.absmag !== null ? star.absmag.toFixed(2) : "N/A"}</div>
              <div class="stardex-stat-sub pokedex-stat-sub">${star.lum !== null ? `${star.lum.toLocaleString()} × Solar (L☉)` : "Luminosity uncalibrated"}</div>
            </div>

            <div class="stardex-stat-card pokedex-stat-card">
              <div class="stardex-stat-label pokedex-stat-label">Distance from Earth</div>
              <div class="stardex-stat-value pokedex-stat-value">${star.dist_ly ? `${star.dist_ly.toLocaleString()} ly` : "N/A"}</div>
              <div class="stardex-stat-sub pokedex-stat-sub">${star.dist_pc ? `${star.dist_pc.toLocaleString()} parsecs` : ""}</div>
            </div>

            <div class="stardex-stat-card pokedex-stat-card">
              <div class="stardex-stat-label pokedex-stat-label">Right Ascension (RA)</div>
              <div class="stardex-stat-value pokedex-stat-value">${star.raSex}</div>
              <div class="stardex-stat-sub pokedex-stat-sub">${star.ra.toFixed(4)}° equatorial</div>
            </div>

            <div class="stardex-stat-card pokedex-stat-card">
              <div class="stardex-stat-label pokedex-stat-label">Declination (Dec)</div>
              <div class="stardex-stat-value pokedex-stat-value">${star.decSex}</div>
              <div class="stardex-stat-sub pokedex-stat-sub">${star.dec.toFixed(4)}° equatorial</div>
            </div>
          </div>
        </div>

        <!-- LIVE OBSERVER & GAME STATE -->
        <div class="stardex-game-section pokedex-game-section">
          <h3 class="stardex-section-title pokedex-section-title">✦ Live Observer Ephemeris & Horizon Encounter</h3>
          <div class="stardex-game-grid pokedex-game-grid">
            <div class="stardex-game-card pokedex-game-card">
              <div class="stardex-game-label pokedex-game-label">Sexagesimal Refracted Altitude</div>
              <div class="stardex-game-value pokedex-game-value ${live ? 'text-gold' : 'text-dim'}">
                ${live && live.altSexagesimal ? live.altSexagesimal : (live ? `${live.alt >= 0 ? '+' : ''}${live.alt.toFixed(1)}°` : '🌌 BELOW HORIZON EDGE')}
              </div>
              <div class="stardex-stat-sub pokedex-stat-sub">Apparent Alt (Refraction & Dip Applied)</div>
            </div>

            <div class="stardex-game-card pokedex-game-card">
              <div class="stardex-game-label pokedex-game-label">Sexagesimal Azimuth Heading</div>
              <div class="stardex-game-value pokedex-game-value ${live ? 'text-gold' : 'text-dim'}">
                ${live && live.azSexagesimal ? live.azSexagesimal : (live ? `${live.az.toFixed(1)}°` : 'N/A')}
              </div>
              <div class="stardex-stat-sub pokedex-stat-sub">True Horizon Azimuth Bearing</div>
            </div>

            <div class="stardex-game-card pokedex-game-card">
              <div class="stardex-game-label pokedex-game-label">Live Horizon Encounter Status</div>
              <div class="stardex-game-value pokedex-game-value ${live ? 'text-gold' : 'text-dim'}">
                ${live ? (live.horizonEncounter || (live.alt >= 0 && live.alt <= 15) ? `🌅 ON HORIZON BAND` : `⬆ ABOVE HORIZON EDGE`) : '🌌 BELOW HORIZON EDGE'}
              </div>
            </div>

            <div class="stardex-game-card pokedex-game-card">
              <div class="stardex-game-label pokedex-game-label">Pentacle Sky Zone</div>
              <div class="stardex-game-value pokedex-game-value">
                ${live && live.zone !== null ? `Zone ${live.zone} (${getZoneName(live.zone)})` : `Equatorial Zone (Unanchored)`}
              </div>
            </div>

            <div class="stardex-game-card pokedex-game-card">
              <div class="stardex-game-label pokedex-game-label">Faction Control Status</div>
              <div class="stardex-game-value pokedex-game-value">${holdingName}</div>
            </div>

            <div class="stardex-game-card pokedex-game-card">
              <div class="stardex-game-label pokedex-game-label">Node Weight (Capture Value)</div>
              <div class="stardex-game-value pokedex-game-value">✦ ${star.weight.toFixed(3)}</div>
            </div>
          </div>
        </div>

        <!-- ACTIONS BAR -->
        <div class="stardex-actions-bar pokedex-actions-bar">
          <button class="btn btn-primary" onclick="StarDexUI.centerStarOnMap(${star.hip_id})">📍 Center on Sky Map</button>
          <button class="btn" onclick="StarDexUI.aimCameraAtHorizon(${star.hip_id})">🎥 Point Camera at Horizon</button>
          <button class="btn" onclick="StarDexUI.syncSpacetimeDB()">⚡ Sync StarDex to SpacetimeDB</button>
          <button class="btn" onclick="StarDexUI.targetStarForSiege(${star.hip_id})">⚔ Target for Siege</button>
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

    const canvas = document.getElementById("stardex-star-canvas") || document.getElementById("pokedex-star-canvas");
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
      const r = 30 + Math.sin(frame) * 2.5;

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

      // Magnetic field flare loops
      ctx.strokeStyle = spect.glow;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = 0.3 + Math.sin(frame * 2.0) * 0.1;
      for (let j = 0; j < 3; j++) {
        const theta = (Math.PI * 2 / 3) * j + frame * 0.1;
        const loopR = r * 1.4;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(theta) * (r * 0.8), cy + Math.sin(theta) * (r * 0.8), loopR * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.globalAlpha = 1.0;

      animReq = requestAnimationFrame(renderFrame);
    }

    renderFrame();
  }

  // ── ACTIONS ───────────────────────────────────────────────────────────────
  function centerStarOnMap(hipId) {
    closeStarDex();
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
    closeStarDex();
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
  const StarDexUI = {
    openStarDex,
    closeStarDex,
    selectPreset,
    onSearchInput,
    onConstellationChange,
    onSortChange,
    clearSearch,
    selectStarItem,
    showMobileTab,
    centerStarOnMap,
    aimCameraAtHorizon,
    syncSpacetimeDB,
    targetStarForSiege,
  };

  // Modern globals
  global.openStarDex = openStarDex;
  global.closeStarDex = closeStarDex;
  global.StarDexUI = StarDexUI;

  // Backward-compatibility aliases
  global.openStarPokedex = openStarDex;
  global.closeStarPokedex = closeStarDex;
  global.StarPokedexUI = StarDexUI;
})(typeof window !== "undefined" ? window : this);
