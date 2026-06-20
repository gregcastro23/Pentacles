    // ---- WEB CLIENT UI RENDERING BINDINGS ----

    const ZONE_CENTERS = {
      10: { alt: 75, az: 0 },
      0: { alt: 22, az: 36 },
      1: { alt: 22, az: 108 },
      2: { alt: 22, az: 180 },
      3: { alt: 22, az: 252 },
      4: { alt: 22, az: 324 },
      5: { alt: 42, az: 0 },
      6: { alt: 42, az: 72 },
      7: { alt: 42, az: 144 },
      8: { alt: 42, az: 216 },
      9: { alt: 42, az: 288 }
    };

    const HologramCamera = {
      pitch: 20,
      yaw: 0,
      scale: 1.0,
      targetPitch: 20,
      targetYaw: 0,
      targetScale: 1.0,
      isZoomed: false,
      autoRotate: true,
      lastInteraction: 0,
      get enabled() {
        return !arActive;
      },
      project(alt, az) {
        return project3D(alt, az, this.pitch, this.yaw, this.scale, 1.8);
      },
      update() {
        if (!this.enabled) return;
        const ease = 0.08;
        this.pitch += (this.targetPitch - this.pitch) * ease;
        let dy = this.targetYaw - this.yaw;
        dy = ((dy + 180) % 360 + 360) % 360 - 180;
        this.yaw += dy * ease;
        this.scale += (this.targetScale - this.scale) * ease;

        // Auto rotation when idle
        if (this.autoRotate && !this.isZoomed && Date.now() - this.lastInteraction > 5000) {
          this.targetYaw += 0.08;
        }
      }
    };
    window.HologramCamera = HologramCamera;

    function resetCameraView() {
      state.selectedZone = null;
      state.selectedStarHip = null;
      for (let i = 0; i < 11; i++) {
        const el = document.getElementById(`zone-shape-${i}`);
        if (el) el.classList.remove("selected");
      }
      renderZonesList();
      renderStarsNodes();
      updateCombatPreview();
      
      HologramCamera.targetPitch = 20;
      HologramCamera.targetScale = 1.0;
      HologramCamera.isZoomed = false;
      document.getElementById("reset-view-btn").style.display = "none";
      synth.playSelect();
    }

    function diskToAltAz(px, py) {
      const r = Math.min(1.0, Math.hypot(px, py));
      const alt = 90 * (1.0 - r);
      const az = norm360(rad2deg(Math.atan2(px, py)));
      return { alt, az };
    }

    function interpolateDiskLine(p1, p2, segments = 8) {
      const pts = [];
      for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const px = p1[0] + (p2[0] - p1[0]) * t;
        const py = p1[1] + (p2[1] - p1[1]) * t;
        const { alt, az } = diskToAltAz(px, py);
        pts.push(skyProject(alt, az));
      }
      return pts;
    }

    const PENT_T_ALTAZ = PENT_T.map(pt => diskToAltAz(pt[0], pt[1]));
    const PENT_V_ALTAZ = PENT_V.map(pt => diskToAltAz(pt[0], pt[1]));

    function update3DOverlays() {
      // 1. Update the 11 zone shapes (curved along the hemisphere surface)
      for (let zoneId = 0; zoneId < 11; zoneId++) {
        const pathEl = document.getElementById(`zone-shape-${zoneId}`);
        if (!pathEl) continue;
        
        let pathStr = "";
        if (zoneId === 10) {
          // Crown (pentagon)
          let pts = [];
          for (let i = 0; i < 5; i++) {
            const edge = interpolateDiskLine(PENT_V[i], PENT_V[(i + 1) % 5], 4);
            if (i > 0) edge.shift();
            pts = pts.concat(edge);
          }
          pathStr = "M " + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ") + " Z";
        } else if (zoneId >= 5) {
          // Spire k = [T_k, V_{k-1}, V_k]
          const k = zoneId - 5;
          let pts = [];
          pts = pts.concat(interpolateDiskLine(PENT_T[k], PENT_V[(k + 4) % 5], 6));
          const edge2 = interpolateDiskLine(PENT_V[(k + 4) % 5], PENT_V[k], 6);
          edge2.shift();
          pts = pts.concat(edge2);
          const edge3 = interpolateDiskLine(PENT_V[k], PENT_T[k], 6);
          edge3.shift();
          pts = pts.concat(edge3);
          pathStr = "M " + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ") + " Z";
        } else {
          // Arc-House k = [T_k, V_k, T_{k+1}] + horizon arc from T_{k+1} to T_k
          let pts = [];
          pts = pts.concat(interpolateDiskLine(PENT_T[zoneId], PENT_V[zoneId], 6));
          const edge2 = interpolateDiskLine(PENT_V[zoneId], PENT_T[(zoneId + 1) % 5], 6);
          edge2.shift();
          pts = pts.concat(edge2);
          
          const startAz = (zoneId + 1) * 72;
          for (let i = 1; i <= 8; i++) {
            const az = startAz - (i / 8) * 72;
            pts.push(skyProject(0, az));
          }
          pathStr = "M " + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ") + " Z";
        }
        
        pathEl.setAttribute("d", pathStr);
      }

      // 2. Update horizon rim path
      const rimPath = document.getElementById("horizon-rim-path");
      if (rimPath) {
        const pts = [];
        for (let i = 0; i <= 64; i++) {
          const az = (i / 64) * 360;
          pts.push(skyProject(0, az));
        }
        const pathStr = "M " + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ");
        rimPath.setAttribute("d", pathStr);
      }

      // 3. Update pentagram star path (curved along the hemisphere surface)
      const starPath = document.getElementById("pentagram-star-path");
      if (starPath) {
        let pts = [];
        const order = [0, 2, 4, 1, 3, 0];
        for (let i = 0; i < 5; i++) {
          const edge = interpolateDiskLine(PENT_T[order[i]], PENT_T[order[i+1]], 8);
          if (i > 0) edge.shift();
          pts = pts.concat(edge);
        }
        const pathStr = "M " + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L ");
        starPath.setAttribute("d", pathStr);
      }

      // 4. Update Crown label text position
      const crownLbl = document.getElementById("crown-label-text");
      if (crownLbl) {
        const zenith = skyProject(90, 0);
        crownLbl.setAttribute("x", zenith.x.toFixed(1));
        crownLbl.setAttribute("y", (zenith.y + 4).toFixed(1));
        if (window.HologramCamera && window.HologramCamera.enabled) {
          const fs = Math.max(5, Math.min(14, 10 * HologramCamera.scale));
          crownLbl.setAttribute("font-size", fs.toFixed(1));
        } else {
          crownLbl.setAttribute("font-size", "10");
        }
      }
    }

    function projectSky3D() {
      if (!HologramCamera.enabled) return;
      
      for (const star of state.sky) {
        const proj = skyProject(star.alt, star.az);
        star.x = proj.x;
        star.y = proj.y;
      }
      
      for (const p of state.planets) {
        const proj = skyProject(p.alt, p.az);
        p.x = proj.x;
        p.y = proj.y;
      }
      
      const now = new Date();
      const { lat, lon } = state.observer;
      state.ecliptic = eclipticSegments(lat, lon, now);
      
      const lst = lstDeg(now, lon);
      state.recomputeConstellations(now, lat, lon, lst);
    }

    function animateFrame() {
      if (HologramCamera.enabled) {
        HologramCamera.update();
        projectSky3D();
        update3DOverlays();
        renderStarsNodes();
      }
      requestAnimationFrame(animateFrame);
    }

    function initHologramControls() {
      const wrapper = document.getElementById("sky-map-wrapper");
      if (!wrapper) return;

      let isDragging = false;
      let startX = 0, startY = 0;
      let startYaw = 0, startPitch = 0;

      const onStart = (clientX, clientY) => {
        if (arActive) return;
        isDragging = true;
        startX = clientX;
        startY = clientY;
        startYaw = HologramCamera.targetYaw;
        startPitch = HologramCamera.targetPitch;
        HologramCamera.lastInteraction = Date.now();
        wrapper.style.cursor = "grabbing";
      };

      const onMove = (clientX, clientY) => {
        if (!isDragging) return;
        const dx = clientX - startX;
        const dy = clientY - startY;
        HologramCamera.targetYaw = startYaw - dx * 0.4;
        HologramCamera.targetPitch = Math.max(5, Math.min(85, startPitch + dy * 0.4));
        HologramCamera.lastInteraction = Date.now();
      };

      const onEnd = () => {
        if (isDragging) {
          isDragging = false;
          wrapper.style.cursor = "grab";
        }
      };

      wrapper.addEventListener("mousedown", (e) => onStart(e.clientX, e.clientY));
      window.addEventListener("mousemove", (e) => onMove(e.clientX, e.clientY));
      window.addEventListener("mouseup", onEnd);

      wrapper.addEventListener("touchstart", (e) => {
        if (e.touches.length > 0) onStart(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: true });
      window.addEventListener("touchmove", (e) => {
        if (e.touches.length > 0) onMove(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: true });
      window.addEventListener("touchend", onEnd);

      // Add cursor styling
      wrapper.style.cursor = "grab";

      // Background reset click listener on the SVG itself
      const svg = document.querySelector(".pentacle-svg");
      if (svg) {
        svg.addEventListener("click", (e) => {
          if (e.target === svg || e.target.id === "stars-nodes-g" || (e.target.tagName === "circle" && e.target.getAttribute("r") === "250")) {
            resetCameraView();
          }
        });
      }
    }


    // Background stars canvas animation
    (function() {
      const c = document.getElementById("canvas-stars-bg");
      const ctx = c.getContext("2d");
      let w, h, stars = [];

      function size() {
        w = c.width = window.innerWidth;
        h = c.height = window.innerHeight;
        stars = Array.from({ length: 150 }, () => ({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.2 + 0.2,
          a: Math.random() * 0.5 + 0.1,
          tw: Math.random() * 0.02 + 0.005,
          ph: Math.random() * Math.PI * 2
        }));
      }

      function draw(t) {
        ctx.clearRect(0, 0, w, h);
        stars.forEach(s => {
          const alpha = s.a * (0.6 + 0.4 * Math.sin(t * s.tw + s.ph));
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(232, 225, 205, ${alpha})`;
          ctx.fill();
        });
        requestAnimationFrame(draw);
      }

      size();
      window.addEventListener("resize", size);
      requestAnimationFrame(draw);
    })();

    // Geolocation → observer inputs (anchors the live star map to where you stand)
    function useMyLocation() {
      if (!navigator.geolocation) { toast("Geolocation is not available in this browser.", { type: "warn" }); return; }
      navigator.geolocation.getCurrentPosition(
        pos => {
          document.getElementById("ob-lat").value = pos.coords.latitude.toFixed(4);
          document.getElementById("ob-lon").value = pos.coords.longitude.toFixed(4);
          synth.playSelect();
        },
        err => toast("Could not read your location (" + err.message + ") — enter lat/lon manually.", { type: "warn" })
      );
    }

    // Onboarding Calculation
    function calculateNatalOnboarding() {
      const handle = document.getElementById("ob-handle").value.trim();
      const date = document.getElementById("ob-date").value;
      const time = document.getElementById("ob-time").value;
      const loc = document.getElementById("ob-loc").value;

      if (!handle) { toast("Enter a seeker name!", { type: "warn" }); return; }

      // Anchor the live sky to the observer before the map first renders.
      const lat = parseFloat(document.getElementById("ob-lat").value);
      const lon = parseFloat(document.getElementById("ob-lon").value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        state.observer = {
          lat: Math.max(-90, Math.min(90, lat)),
          lon: Math.max(-180, Math.min(180, lon))
        };
      }
      state.recomputeSky();

      // Calculate deterministic local placements.
      const chart = deriveLocalNatalChart(`${date} ${time} ${loc}`);
      const picks = scoreFactions(chart);
      
      // Populate choices Grid
      const grid = document.getElementById("faction-picks-grid");
      grid.innerHTML = "";
      picks.forEach(pick => {
        const name = PLANET_NAMES[pick.id];
        const glyph = PLANET_GLYPHS[pick.id];
        const color = PLANET_COLORS[pick.id];
        
        grid.innerHTML += `
          <div class="faction-choice-card" onclick="selectFactionPick(${pick.id})" id="faction-pick-${pick.id}">
            <div class="faction-choice-sigil" style="color: ${color}">${glyph}</div>
            <div class="faction-choice-name">${name}</div>
            <div style="font-size:9px; color:var(--dim); margin-top:4px">Score: ${pick.score}</div>
          </div>
        `;
      });

      // Show step 2
      document.getElementById("onboarding-step-1").style.display = "none";
      document.getElementById("onboarding-step-2").style.display = "flex";
      
      // Save temp chart
      window.tempChart = chart;
      window.tempHandle = handle;
      synth.playSelect();
    }

    window.chosenFaction = null;
    function selectFactionPick(factionId) {
      document.querySelectorAll(".faction-choice-card").forEach(el => el.classList.remove("selected"));
      document.getElementById(`faction-pick-${factionId}`).classList.add("selected");
      window.chosenFaction = factionId;
      document.getElementById("faction-confirm-btn").removeAttribute("disabled");
      synth.playClick();
    }

    function confirmFactionOnboarding() {
      if (window.chosenFaction === null) return;
      state.registerPlayer(window.tempHandle, window.chosenFaction, window.tempChart);
      if (window.tempEvmAddress) {
        state.player.evm_address = window.tempEvmAddress;
        window.tempEvmAddress = null;
      }
      state.save();
      
      // Dismiss overlay
      document.getElementById("onboarding-overlay").style.display = "none";
      synth.playFanfare();
      
      // Full UI Render
      renderAll();
    }

    // App Navigation tabs
    function switchTab(tabId) {
      document.querySelectorAll(".tab-btn[data-tab]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tabId);
      });
      document.querySelectorAll(".sidebar-content > .tab-pane").forEach(pane => {
        pane.classList.toggle("active", pane.id === tabId);
      });
      if (tabId === 'tab-word') renderWordDuel();
      if (tabId === 'tab-pools') renderPoolsPanel();
      synth.playClick();
    }

    // Sound toggle
    function toggleSound() {
      const isMuted = synth.toggleMute();
      event.target.innerText = isMuted ? "🔇 Sound: OFF" : "🔊 Sound: ON";
      event.target.classList.toggle("active", !isMuted);
    }

    // AR Mode Camera Toggle
    let arActive = false;
    async function toggleARMode() {
      const originalTarget = event ? event.target : null;
      arActive = await toggleARCamera();
      const btn = originalTarget || document.querySelector("button[onclick='toggleARMode()']");
      if (btn) {
        btn.innerText = arActive ? "📹 Camera: ON" : "📹 Toggle AR Mode";
        btn.classList.toggle("active", arActive);
      }

      const wrapper = document.getElementById("sky-map-wrapper");
      if (wrapper) {
        if (!arActive) {
          wrapper.style.transform = ""; // clear gyro transform for 3D Hologram
          window.needsFullStarRebuild = true;
          if (window.HologramCamera) {
            HologramCamera.pitch = 20;
            HologramCamera.yaw = 0;
            HologramCamera.scale = 1.0;
            HologramCamera.targetPitch = 20;
            HologramCamera.targetYaw = 0;
            HologramCamera.targetScale = 1.0;
            HologramCamera.isZoomed = false;
          }
          state.recomputeSky();
          renderStarsNodes();
        } else {
          // In AR mode, force full rebuild once to flatten coordinates
          window.needsFullStarRebuild = true;
          state.recomputeSky();
          renderStarsNodes();
        }
      }
    }

    // Render Web Card Component HTML
    function buildCardHTML(c, loadout, isSelectionMode = false) {
      const isSelected = state.selectedCards.has(c.card_id);
      const selClass = isSelected ? "selected" : "";
      const isTrump = c.is_trump;
      const detailText = isTrump ? `Trump ${TRUMP_ARCANA[c.source_body]}` : `${SIGN_GLYPHS[c.sign_idx]} ${SIGN_NAMES[c.sign_idx]}`;
      const actionFn = isSelectionMode ? `toggleActiveSelection(${c.card_id})` : `handleCollectionCardClick(${c.card_id})`;
      const badge = loadout === "active" ? `<span class="web-card-chip">Active</span>` : (loadout === "defense" ? `<span class="web-card-chip defense">Defense</span>` : "");

      return `
        <div class="web-card ${c.suit} ${selClass} ${isTrump ? 'trump' : ''} ${c.inverted ? 'inverted' : ''}" onclick="${actionFn}">
          ${badge}
          <div class="web-card-glyph" style="color: ${PLANET_COLORS[c.source_body]};">${SUIT_GLYPHS[c.suit]}</div>
          <div class="web-card-title">${c.title}</div>
          <div class="web-card-subtitle">${detailText} ${c.inverted ? '(rev)' : ''}</div>
          <div class="web-card-sep"></div>
          <div class="web-card-stats">
            ⚔ ${c.attack} &nbsp; ♥ ${c.health}<br>
            🛡 ${c.armour} &nbsp; ⏳ ${c.cooldown_ms}
          </div>
          <div class="web-card-footnote" style="color: ${PLANET_COLORS[c.source_body]};">
            ${PLANET_GLYPHS[c.source_body]} Lv ${c.level}
          </div>
        </div>
      `;
    }

    // Render Active selection hand (scroller strip)
    function renderActiveHand() {
      const container = document.getElementById("active-deck-strip");
      container.innerHTML = "";

      const activeSlots = state.deck.filter(d => d.loadout === "active");
      activeSlots.forEach(slot => {
        const c = state.collection.find(card => card.card_id === slot.card_id);
        if (c) {
          container.innerHTML += buildCardHTML(c, "active", true);
        }
      });

      document.getElementById("active-hand-count").innerText = `${state.selectedCards.size} / ${activeSlots.length} Selected`;
    }

    // Toggle active card selection
    function toggleActiveSelection(cardId) {
      if (state.selectedCards.has(cardId)) {
        state.selectedCards.delete(cardId);
      } else {
        state.selectedCards.add(cardId);
      }
      renderActiveHand();
      updateCombatPreview();
      synth.playClick();
    }

    // Render Faction Leaderboard
    function renderLeaderboard() {
      const container = document.getElementById("leaderboard-container");
      container.innerHTML = "";

      state.leaderboard.forEach((item, index) => {
        const name = PLANET_NAMES[item.id];
        const glyph = PLANET_GLYPHS[item.id];
        const isMe = state.player && state.player.faction === item.id;
        
        container.innerHTML += `
          <div class="standings-item ${isMe ? 'me' : ''}">
            <span>#${index + 1} &nbsp; ${glyph} ${name}</span>
            <span>${item.score} pts</span>
          </div>
        `;
      });
    }

    // Render Zones List
    function renderZonesList() {
      const container = document.getElementById("zones-list-container");
      container.innerHTML = "";

      // Local weather rotation based on the same suit elements as the server clock.
      const weathers = ["Clear Sky", "Meteor Shower", "Solar Flare", "Aether Eclipse", "Galactic Wind"];

      state.map.forEach(zone => {
        const ownerStr = zone.owner !== null ? `${PLANET_GLYPHS[zone.owner]} ${PLANET_NAMES[zone.owner]}` : "Neutral";
        const zoneName = zone.kind === "house" ? `House ${zone.zone_id}` : (zone.kind === "spire" ? `Spire ${zone.zone_id}` : "Crown Zenith");

        // Compute meter fills
        const valPercent = ((zone.control + 1000) / 2000) * 100;
        const fillCol = zone.owner !== null ? PLANET_COLORS[zone.owner] : "#6a6c84";
        const wIdx = (zone.zone_id + Math.floor(state.seasonDegree / 72)) % weathers.length;
        const zoneStars = state.starsInZone(zone.zone_id);
        const heldCount = zoneStars.filter(s => s.held_by !== null).length;

        container.innerHTML += `
          <div class="panel" style="padding: 10px; cursor: pointer; border-color: ${state.selectedZone === zone.zone_id ? 'var(--gold-bright)' : 'var(--line)'}" onclick="selectZone(${zone.zone_id})">
            <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:bold;">
              <span>${zoneName}</span>
              <span style="color: ${fillCol}">${ownerStr}</span>
            </div>
            <div style="font-size:10px; color:var(--dim); margin-top:2px;">
              Weather: ${weathers[wIdx]} · Favored Suit: ${SIGN_SUITS[zone.zone_id % 12].toUpperCase()}
            </div>
            <div style="font-size:10px; color:var(--dim); margin-top:2px;">
              ★ ${zoneStars.length} stars overhead${heldCount > 0 ? ` · ${heldCount} claimed` : ""}
            </div>
            <div class="control-meter-bar">
              <div class="control-meter-fill" style="width: ${valPercent}%; background: ${fillCol};"></div>
            </div>
          </div>
        `;
      });
    }

    // Select zone click
    function selectZone(zoneId) {
      state.selectedZone = zoneId;
      state.selectedStarHip = null;

      // Update zone SVG paths selections
      for (let i = 0; i < 11; i++) {
        const el = document.getElementById(`zone-shape-${i}`);
        if (el) el.classList.toggle("selected", i === zoneId);
      }

      if (zoneId !== null && window.HologramCamera) {
        const center = ZONE_CENTERS[zoneId];
        HologramCamera.targetYaw = -center.az;
        HologramCamera.targetPitch = 90 - center.alt;
        HologramCamera.targetScale = 2.2;
        HologramCamera.isZoomed = true;
        document.getElementById("reset-view-btn").style.display = "inline-flex";
      } else if (zoneId === null && window.HologramCamera) {
        HologramCamera.targetPitch = 20;
        HologramCamera.targetScale = 1.0;
        HologramCamera.isZoomed = false;
        document.getElementById("reset-view-btn").style.display = "none";
      }

      renderZonesList();
      renderStarsNodes();
      updateCombatPreview();
      synth.playSelect();
    }

    // ---- CONSTELLATION LIQUIDITY POOLS (the sky DEX) ----
    // The stick figures are drawn under the stars; a pool is OPEN only while enough
    // of its member stars are above the observer's horizon. Toggle the city and the
    // open set changes — liquidity literally rises and sets.

    const POOL_CITIES = [
      { name: "New York", lat: 40.7128, lon: -74.0060 },
      { name: "London", lat: 51.5074, lon: -0.1278 },
      { name: "Reykjavík", lat: 64.1466, lon: -21.9426 },
      { name: "Tokyo", lat: 35.6762, lon: 139.6503 },
      { name: "Sydney", lat: -33.8688, lon: 151.2093 },
      { name: "Cape Town", lat: -33.9249, lon: 18.4241 },
    ];

    function esmsTag(id) {
      return `<span style="color:${ESMS_COLORS[id]}; white-space:nowrap;">${ESMS_GLYPHS[id]} ${ESMS_NAMES[id]}</span>`;
    }

    function renderConstellations() {
      const g = document.getElementById("constellations-g");
      if (!g) return;
      g.innerHTML = "";
      if (!state.constellations || !state.constellations.length) return;
      const NS = "http://www.w3.org/2000/svg";
      const frag = document.createDocumentFragment();
      for (const con of state.constellations) {
        if (!con.segments.length) continue;
        const col = ESMS_COLORS[con.pair[0]];
        const tradeable = con.tradeable;
        for (const [a, b] of con.segments) {
          const line = document.createElementNS(NS, "line");
          line.setAttribute("x1", a.x.toFixed(1)); line.setAttribute("y1", a.y.toFixed(1));
          line.setAttribute("x2", b.x.toFixed(1)); line.setAttribute("y2", b.y.toFixed(1));
          line.setAttribute("stroke", tradeable ? col : "#5a6172");
          line.setAttribute("stroke-width", tradeable ? "1.2" : "0.6");
          line.setAttribute("stroke-opacity", tradeable ? "0.85" : "0.28");
          line.setAttribute("stroke-linecap", "round");
          if (tradeable) line.setAttribute("filter", `drop-shadow(0 0 2px ${col})`);
          frag.appendChild(line);
        }
        const up = Object.values(con.nodes).filter(n => n.up);
        if (tradeable && up.length) {
          const cx = up.reduce((s, n) => s + n.x, 0) / up.length;
          const cy = up.reduce((s, n) => s + n.y, 0) / up.length;
          const t = document.createElementNS(NS, "text");
          t.setAttribute("x", cx.toFixed(1)); t.setAttribute("y", cy.toFixed(1));
          t.setAttribute("text-anchor", "middle"); t.setAttribute("fill", col);
          t.setAttribute("font-size", "8"); t.setAttribute("font-family", "Space Grotesk");
          t.setAttribute("opacity", "0.75"); t.setAttribute("letter-spacing", "1");
          t.textContent = con.abbr.toUpperCase();
          frag.appendChild(t);
        }
      }
      g.appendChild(frag);
    }

    function renderPoolsCityToggle() {
      const el = document.getElementById("pools-city-toggle");
      if (!el) return;
      el.innerHTML = "";
      for (const c of POOL_CITIES) {
        const active = Math.abs(state.observer.lat - c.lat) < 0.5 && Math.abs(state.observer.lon - c.lon) < 0.5;
        const b = document.createElement("button");
        b.className = "btn";
        b.style.cssText = "padding:4px 9px; font-size:10px;" + (active ? "background:var(--gold); color:#1a1206;" : "");
        b.textContent = c.name;
        b.onclick = () => setObserverCity(c);
        el.appendChild(b);
      }
    }

    function setObserverCity(c) {
      state.observer = { lat: c.lat, lon: c.lon };
      if (state.player) state.save();
      state.recomputeSky();
      renderStarsNodes();
      renderPoolsPanel();
      if (synth.playSelect) synth.playSelect();
    }

    function renderPoolsPanel() {
      renderPoolsCityToggle();
      const list = document.getElementById("pools-list");
      if (!list) return;
      const cons = (state.constellations || []).slice().sort((a, b) =>
        (b.tradeable - a.tradeable) || (b.visibleCount - a.visibleCount));
      if (!cons.length) { list.innerHTML = '<div style="color:var(--dim); font-size:11px;">Charting the sky…</div>'; return; }
      list.innerHTML = "";
      for (const con of cons) {
        const row = document.createElement("div");
        row.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px; padding:7px 9px; border:1px solid " +
          (con.tradeable ? "rgba(216,180,106,0.4)" : "rgba(120,128,150,0.18)") + "; border-radius:4px; background:" +
          (con.tradeable ? "rgba(216,180,106,0.06)" : "transparent") + ";";
        const left = document.createElement("div");
        left.innerHTML =
          `<div style="font-size:12px; color:${con.tradeable ? 'var(--gold-bright)' : 'var(--dim)'};">${con.name}</div>` +
          `<div style="font-size:10px; margin-top:2px;">${esmsTag(con.pair[0])} <span style="color:#667;">↔</span> ${esmsTag(con.pair[1])} · <span style="color:var(--dim);">${con.feeBps}bps</span></div>` +
          `<div style="font-size:10px; margin-top:2px; color:${con.tradeable ? '#7fc08a' : '#9aa3b5'};">` +
          (con.tradeable ? `● risen — ${con.visibleCount}/${con.visibleThreshold} stars up` : `○ set — ${con.visibleCount}/${con.visibleThreshold} up`) + `</div>`;
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = con.tradeable ? "Trace ✦" : "Below horizon";
        btn.disabled = !con.tradeable;
        btn.style.cssText = "padding:6px 11px; font-size:11px; white-space:nowrap;" + (con.tradeable ? "" : "opacity:0.5;");
        btn.onclick = () => traceConstellation(con.id);
        row.appendChild(left);
        row.appendChild(btn);
        list.appendChild(row);
      }
    }

    async function traceConstellation(id) {
      const con = (state.constellations || []).find(c => c.id === id);
      const status = document.getElementById("pools-status");
      if (!con || !status) return;
      if (!con.tradeable) {
        status.innerHTML = `<span style="color:#e88a8a;">${con.name} is below your horizon (${con.visibleCount}/${con.visibleThreshold} stars up). Wait for it to climb — or move to a city where it's risen.</span>`;
        return;
      }
      const pairTxt = `${esmsTag(con.pair[0])} ↔ ${esmsTag(con.pair[1])}`;
      // Live path: wired to the module + chain, this calls trace_constellation, polls
      // trace_attestation, then submits seedLiquidity via the Dynamic wallet.
      if (window.PentaclesBridge && window.PentaclesBridge.trace) {
        status.innerHTML = `Tracing <b>${con.name}</b>… signing visibility attestation.`;
        try {
          const res = await window.PentaclesBridge.trace(con);
          status.innerHTML = `✦ Seeded <b>${con.name}</b> — Constellation Deed #${res.deedId} minted.`;
        } catch (e) {
          status.innerHTML = `<span style="color:#e88a8a;">Trace failed: ${e.message || e}</span>`;
        }
        return;
      }
      // Demo mode (no chain configured): show exactly what would happen on-chain.
      status.innerHTML =
        `✦ <b>${con.name}</b> is risen (${con.visibleCount}/${con.visibleThreshold} stars up) — its ${pairTxt} pool is <b style="color:#7fc08a;">OPEN</b>.<br>` +
        `<span style="color:var(--dim); font-size:11px;">Live build: the sky-feeder signs a visibility attestation, then your wallet seeds liquidity and mints a Constellation Deed. Switch to a city where ${con.name} has set to watch the trace get refused.</span>`;
      if (synth.playWin) synth.playWin();
    }

    // Render the real sky inside the SVG Pentacle: every catalogue star above
    // the horizon, at its true projected position — zenith at the centre, the
    // horizon (and the rising ascendant) at the rim. Brightness sets size;
    // stars below the 10° engagement band render dimmed, like the AR client.
    const starElementMap = new Map();
    const starLabelMap = new Map();
    window.needsFullStarRebuild = true;

    function renderStarsNodes() {
      renderConstellations();
      const container = document.getElementById("stars-nodes-g");
      const NS = "http://www.w3.org/2000/svg";

      const stars = [...state.sky].sort((a, b) => b.magnitude - a.magnitude);

      // Rebuild DOM nodes if requested or container is empty
      if (window.needsFullStarRebuild || container.children.length === 0) {
        container.innerHTML = "";
        window.needsFullStarRebuild = false;
        starElementMap.clear();
        starLabelMap.clear();

        const frag = document.createDocumentFragment();

        for (const star of stars) {
          const held = star.held_by !== null;
          const fillCol = held ? PLANET_COLORS[star.held_by] : "#e8e1cd";
          const isSelected = state.selectedStarHip === star.hip_id;
          const inZone = state.selectedZone !== null && star.zone === state.selectedZone;
          const r = Math.max(0.6, Math.min(3.2, 2.6 - star.magnitude * 0.42));
          const engageable = star.alt >= MIN_ENGAGE_ALT_DEG;
          
          let opacity = Math.max(0.3, Math.min(1, 1.15 - star.magnitude * 0.13));
          if (held || inZone) opacity = Math.min(1, opacity + 0.25);
          if (!engageable) opacity *= 0.45;

          const circle = document.createElementNS(NS, "circle");
          circle.setAttribute("cx", star.x.toFixed(1));
          circle.setAttribute("cy", star.y.toFixed(1));
          circle.setAttribute("r", (held ? r + 0.8 : r).toFixed(1));
          circle.setAttribute("fill", fillCol);
          circle.setAttribute("fill-opacity", opacity.toFixed(2));
          circle.setAttribute("class", `star-node-dot ${isSelected ? 'selected' : ''}`);
          circle.style.color = fillCol;

          const tip = document.createElementNS(NS, "title");
          const zoneName = star.zone === 10 ? "Crown Zenith" : (star.zone >= 5 ? `Spire ${star.zone}` : `House ${star.zone}`);
          tip.textContent = `${star.name} · mag ${star.magnitude} · alt ${Math.round(star.alt)}° · ${zoneName}` +
            (held ? ` · held by ${PLANET_NAMES[star.held_by]}` : "") +
            (engageable ? "" : " · below the 10° engage band");
          circle.appendChild(tip);

          circle.onclick = (e) => {
            e.stopPropagation();
            selectStar(star);
          };

          starElementMap.set(star.hip_id, circle);
          frag.appendChild(circle);
        }

        // Labels for the brightest beacons
        for (const star of stars) {
          if (star.magnitude > 0.8) continue;
          const label = document.createElementNS(NS, "text");
          label.setAttribute("x", (star.x + 6).toFixed(1));
          label.setAttribute("y", (star.y - 5).toFixed(1));
          label.setAttribute("class", "star-name-label");
          label.textContent = star.name;

          starLabelMap.set(star.hip_id, label);
          frag.appendChild(label);
        }

        container.appendChild(frag);
      } else {
        // Fast-path: update positions of existing nodes
        for (const star of stars) {
          const circle = starElementMap.get(star.hip_id);
          if (circle) {
            circle.setAttribute("cx", star.x.toFixed(1));
            circle.setAttribute("cy", star.y.toFixed(1));
            
            const held = star.held_by !== null;
            const isSelected = state.selectedStarHip === star.hip_id;
            const inZone = state.selectedZone !== null && star.zone === state.selectedZone;
            const engageable = star.alt >= MIN_ENGAGE_ALT_DEG;
            let opacity = Math.max(0.3, Math.min(1, 1.15 - star.magnitude * 0.13));
            if (held || inZone) opacity = Math.min(1, opacity + 0.25);
            if (!engageable) opacity *= 0.45;
            
            circle.setAttribute("fill-opacity", opacity.toFixed(2));
            circle.setAttribute("class", `star-node-dot ${isSelected ? 'selected' : ''}`);
          }

          const label = starLabelMap.get(star.hip_id);
          if (label) {
            label.setAttribute("x", (star.x + 6).toFixed(1));
            label.setAttribute("y", (star.y - 5).toFixed(1));
          }
        }
      }

      renderPlanets();
      renderSkyChrome();
    }

    // The wanderers share the stars' sky — same plane, same projection — but
    // at exaggerated scale: they are far closer than any star, so they appear
    // much larger (glyph medallions vs pinpricks). Each planet is the
    // planetary agent of its current degree (the planetary-agents project);
    // tapping one targets that agent in the Word Duels of the Spheres. The
    // dashed ecliptic is the road the agents walk across that same sky.
    const PLANET_DISC_R = [13, 11, 8, 9, 9, 10, 10, 8, 8, 7]; // Sun..Pluto — closer = larger
    function renderPlanets() {
      const g = document.getElementById("planets-g");
      if (!g) return;
      g.innerHTML = "";
      const NS = "http://www.w3.org/2000/svg";
      const frag = document.createDocumentFragment();

      // The plane itself: the visible arc(s) of the ecliptic.
      for (const seg of state.ecliptic) {
        if (seg.length < 2) continue;
        const path = document.createElementNS(NS, "path");
        path.setAttribute("d", "M" + seg.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L"));
        path.setAttribute("class", "ecliptic-line");
        frag.appendChild(path);
      }

      for (const p of state.planets) {
        if (!p.up) continue;
        const col = PLANET_COLORS[p.body];
        const zoneName = p.zone === 10 ? "Crown Zenith" : (p.zone >= 5 ? `Spire ${p.zone}` : `House ${p.zone}`);

        const node = document.createElementNS(NS, "g");
        node.setAttribute("class", "planet-node");
        node.style.color = col;

        const halo = document.createElementNS(NS, "circle");
        halo.setAttribute("cx", p.x.toFixed(1));
        halo.setAttribute("cy", p.y.toFixed(1));
        halo.setAttribute("r", (PLANET_DISC_R[p.body] + 4).toFixed(1));
        halo.setAttribute("class", "planet-halo");
        halo.setAttribute("fill", col);
        node.appendChild(halo);

        const disc = document.createElementNS(NS, "circle");
        disc.setAttribute("cx", p.x.toFixed(1));
        disc.setAttribute("cy", p.y.toFixed(1));
        disc.setAttribute("r", PLANET_DISC_R[p.body]);
        disc.setAttribute("class", "planet-disc");
        disc.setAttribute("fill", col);
        node.appendChild(disc);

        const glyph = document.createElementNS(NS, "text");
        glyph.setAttribute("x", p.x.toFixed(1));
        glyph.setAttribute("y", (p.y + PLANET_DISC_R[p.body] * 0.42).toFixed(1));
        glyph.setAttribute("class", "planet-glyph");
        glyph.setAttribute("font-size", Math.round(PLANET_DISC_R[p.body] * 1.25));
        glyph.textContent = PLANET_GLYPHS[p.body];
        node.appendChild(glyph);

        const tip = document.createElementNS(NS, "title");
        tip.textContent = `${PLANET_NAMES[p.body]} — planetary agent of ${SIGN_GLYPHS[p.sign]} ${SIGN_NAMES[p.sign]} ${Math.floor(p.eclLon % 30)}° · alt ${Math.round(p.alt)}° · transiting ${zoneName} · tap to challenge`;
        node.appendChild(tip);

        node.onclick = (e) => {
          e.stopPropagation();
          challengePlanetaryAgent(p);
        };

        frag.appendChild(node);
      }

      g.appendChild(frag);
    }

    // Compass rose + the live Ascendant marker on the horizon rim, and the
    // sky-status HUD line. The ascendant is where the zodiac is rising in the
    // east right now — the leading edge of the mapped sky.
    function renderSkyChrome() {
      const g = document.getElementById("sky-chrome-g");
      if (!g) return;
      g.innerHTML = "";
      const NS = "http://www.w3.org/2000/svg";

      const rimPoint = (azDeg, radius) => {
        const p = skyProject(0, azDeg);
        if (window.HologramCamera && window.HologramCamera.enabled) {
          const dx = p.x - 300;
          const dy = p.y - 300;
          const factor = radius / 250;
          return { x: 300 + dx * factor, y: 300 + dy * factor };
        } else {
          const a = azDeg * Math.PI / 180;
          return { x: 300 + radius * Math.sin(a), y: 300 - radius * Math.cos(a) };
        }
      };

      [["N", 0], ["E", 90], ["S", 180], ["W", 270]].forEach(([t, az]) => {
        const p = rimPoint(az, 264);
        const el = document.createElementNS(NS, "text");
        el.setAttribute("x", p.x.toFixed(1));
        el.setAttribute("y", (p.y + 4).toFixed(1));
        el.setAttribute("class", "compass-label");
        el.textContent = t;
        g.appendChild(el);
      });

      if (state.asc) {
        const az = state.asc.az;
        const p1 = rimPoint(az, 240), p2 = rimPoint(az, 258);
        const tick = document.createElementNS(NS, "line");
        tick.setAttribute("x1", p1.x.toFixed(1)); tick.setAttribute("y1", p1.y.toFixed(1));
        tick.setAttribute("x2", p2.x.toFixed(1)); tick.setAttribute("y2", p2.y.toFixed(1));
        tick.setAttribute("class", "asc-marker-line");
        g.appendChild(tick);

        const pt = rimPoint(az + (az > 180 ? -8 : 8), 236);
        const lbl = document.createElementNS(NS, "text");
        lbl.setAttribute("x", pt.x.toFixed(1));
        lbl.setAttribute("y", pt.y.toFixed(1));
        lbl.setAttribute("class", "asc-marker-label");
        lbl.textContent = `ASC ${SIGN_GLYPHS[state.asc.sign]}`;
        g.appendChild(lbl);
      }

      const status = document.getElementById("sky-status");
      if (status) {
        const inReach = state.sky.filter(s => s.alt >= MIN_ENGAGE_ALT_DEG).length;
        const ascStr = state.asc ? ` · ASC ${SIGN_GLYPHS[state.asc.sign]} ${SIGN_NAMES[state.asc.sign]} ${state.asc.degInSign}° rising` : "";
        status.innerHTML = `✦ ${state.sky.length.toLocaleString()} stars overhead — ${inReach.toLocaleString()} in reach${ascStr}`;
      }
    }

    // A planet IS the planetary agent of its current degree. Tapping it opens
    // the Words tab with that agent targeted, ready for a Word of Power.
    function challengePlanetaryAgent(p) {
      if (!state.player) return;
      switchTab("tab-word");
      const sel = document.getElementById("word-opponent");
      if (sel.options.length) sel.value = String(p.body);
      const out = document.getElementById("word-result");
      out.style.color = "var(--gold-bright)";
      out.innerHTML = `${PLANET_GLYPHS[p.body]} <b>${PLANET_NAMES[p.body]}</b> — agent of ${SIGN_GLYPHS[p.sign]} ${SIGN_NAMES[p.sign]} ${Math.floor(p.eclLon % 30)}° — awaits your Word of Power.`;
      document.getElementById("word-input").focus();
      synth.playSelect();
    }

    // Select star click
    function selectStar(star) {
      state.selectedZone = star.zone;
      state.selectedStarHip = star.hip_id;

      // Toggle shapes selections
      for (let i = 0; i < 11; i++) {
        const el = document.getElementById(`zone-shape-${i}`);
        if (el) el.classList.toggle("selected", i === star.zone);
      }

      if (window.HologramCamera) {
        HologramCamera.targetYaw = -star.az;
        HologramCamera.targetPitch = 90 - star.alt;
        HologramCamera.targetScale = 2.5;
        HologramCamera.isZoomed = true;
        document.getElementById("reset-view-btn").style.display = "inline-flex";
      }

      renderZonesList();
      renderStarsNodes();
      updateCombatPreview();
      switchTab("tab-duel");
      synth.playSelect();
    }

    // Update Duel combat details
    function updateCombatPreview() {
      const details = document.getElementById("duel-target-details");
      const btn = document.getElementById("strike-btn");

      const star = state.getSelectedStar();
      if (!star) {
        details.innerHTML = "Select a star in the sky map to coordinate a siege target.";
        btn.setAttribute("disabled", "true");
        return;
      }

      const zone = state.map[star.zone];
      const zoneName = zone.kind === "house" ? `House ${zone.zone_id}` : (zone.kind === "spire" ? `Spire ${zone.zone_id}` : "Crown Zenith");
      const ownerStr = star.held_by !== null ? `${PLANET_GLYPHS[star.held_by]} ${PLANET_NAMES[star.held_by]}` : "Neutral";
      const suitSign = SIGN_SUITS[zone.zone_id % 12];
      const engageable = star.alt >= MIN_ENGAGE_ALT_DEG;

      // Get contesters list
      const contesters = getStarContesters(zone, star);
      const contestersNames = contesters.map(id => {
        const isMe = state.player && id === state.player.faction;
        const name = `${PLANET_GLYPHS[id]} ${PLANET_NAMES[id]}`;
        return isMe ? `<strong>${name} (You)</strong>` : name;
      }).join(", ");

      // Calculate selected strike power
      let totalAtk = 0;
      let handCount = 0;
      state.selectedCards.forEach(id => {
        const c = state.collection.find(card => card.card_id === id);
        if (c) {
          totalAtk += c.attack;
          handCount++;
        }
      });

      // If no cards selected, default to all Active
      if (handCount === 0) {
        state.deck.filter(d => d.loadout === "active").forEach(slot => {
          const c = state.collection.find(card => card.card_id === slot.card_id);
          if (c) totalAtk += c.attack;
        });
      }

      details.innerHTML = `
        <strong>Target Node:</strong> ${star.name} (${star.magnitude} mag)<br>
        <strong>Sky Position:</strong> alt ${Math.round(star.alt)}° · az ${Math.round(star.az)}°${engageable ? "" : ` — <span style="color:#e88a8a">below the ${MIN_ENGAGE_ALT_DEG}° engage band; wait for it to climb</span>`}<br>
        <strong>Zone Location:</strong> ${zoneName} (Favored Suit: ${suitSign.toUpperCase()})<br>
        <strong>Current Node Owner:</strong> ${ownerStr}<br>
        <strong>Round Contesters (${contesters.length}):</strong> ${contestersNames}<br>
        <strong>Attack Cards:</strong> ${handCount > 0 ? handCount : 'All Active'} (${totalAtk} Base Power)
      `;

      if (engageable) btn.removeAttribute("disabled");
      else btn.setAttribute("disabled", "true");
    }

    // Execute Auto-resolve strike siege
    function initiateSiegeStrike() {
      const star = state.getSelectedStar();
      if (!star) return;
      if (star.alt < MIN_ENGAGE_ALT_DEG) return; // mirror the server's horizon gate

      const zone = state.map[star.zone];
      const zoneElement = SIGN_SUITS[zone.zone_id % 12];

      const contesters = getStarContesters(zone, star);
      const teams = [];

      contesters.forEach(factionId => {
        let cards = [];
        const isPlayer = state.player && factionId === state.player.faction;

        if (isPlayer) {
          if (state.selectedCards.size > 0) {
            state.selectedCards.forEach(id => {
              const c = state.collection.find(card => card.card_id === id);
              if (c) cards.push(JSON.parse(JSON.stringify(c)));
            });
          } else {
            state.deck.filter(d => d.loadout === "active").forEach(slot => {
              const c = state.collection.find(card => card.card_id === slot.card_id);
              if (c) cards.push(JSON.parse(JSON.stringify(c)));
            });
          }
        } else {
          // Generate 3 defender cards if this faction is current owner, else 2 attacker cards
          const isOwner = factionId === star.held_by;
          const count = isOwner ? 3 : 2;
          for (let i = 0; i < count; i++) {
            const degree = 4 + i * 2 + Math.floor(Math.random() * 3);
            cards.push(state.createCard(factionId, false, degree, 10, 0, false, pipRank(zone.zone_id % 12, degree), zone.zone_id % 12));
          }
        }

        teams.push({
          faction: factionId,
          name: PLANET_NAMES[factionId],
          glyph: PLANET_GLYPHS[factionId],
          color: PLANET_COLORS[factionId],
          isPlayer: isPlayer,
          cards: cards
        });
      });

      // Play Sound
      synth.playStrike();

      // Resolve Auto-Siege with all participating contesters
      const result = runAutoSiege(teams, zoneElement);

      // Render Console Logs
      const consoleEl = document.getElementById("combat-log-console");
      consoleEl.innerHTML = "";
      
      // Stream logs with a delay for visual impact
      let logIdx = 0;
      function streamLog() {
        if (logIdx < result.logs.length) {
          const item = result.logs[logIdx];
          consoleEl.innerHTML += `<div class="log-line ${item.type}">${item.text}</div>`;
          consoleEl.scrollTop = consoleEl.scrollHeight;
          logIdx++;
          setTimeout(streamLog, 80);
        } else {
          // Log finished - apply state changes on success
          if (result.winnerFactionId !== null) {
            state.holdings[star.hip_id] = result.winnerFactionId;
            star.held_by = result.winnerFactionId;

            // The star's brightness sets its pull on the zone meter (server parity:
            // combat::control_delta — Sirius swings ~5× more than a mag-6 spark).
            const swing = starControlDelta(star.magnitude, 0);
            const isMyFaction = state.player && result.winnerFactionId === state.player.faction;
            if (isMyFaction) {
              zone.control = Math.min(1000, zone.control + swing);
              if (zone.control >= 600) {
                zone.owner = state.player.faction;
              }

              // Victory spoils: the conquered star yields a fresh Arcana — suit
              // from its zone, rank from its sky position, a Letter for your rack.
              const spoils = state.draftVictoryCard(star, zone);
              if (spoils) {
                consoleEl.innerHTML += `<div class="log-line victory">★ ${star.name} yields <b>${spoils.title}</b> — ⚔ ${spoils.attack} · ♥ ${spoils.health} · Letter <b>${spoils.letter}</b> joins your rack</div>`;
              } else {
                consoleEl.innerHTML += `<div class="log-line system">★ Your collection is at its cap — ${star.name}'s gift dissolves into the aether.</div>`;
              }
              consoleEl.scrollTop = consoleEl.scrollHeight;
              synth.playFanfare();
            } else {
              // Shift control away from player or towards winner
              const delta = Math.round(swing * 0.75);
              if (zone.owner === state.player.faction) {
                zone.control = Math.max(-1000, zone.control - delta);
                if (zone.control <= -200) {
                  zone.owner = result.winnerFactionId;
                }
              } else {
                if (zone.owner === null) {
                  zone.control = -delta;
                  zone.owner = result.winnerFactionId;
                } else if (zone.owner === result.winnerFactionId) {
                  zone.control = Math.max(-1000, zone.control - delta);
                } else {
                  zone.control = Math.max(-1000, Math.min(1000, zone.control - delta));
                  if (Math.abs(zone.control) < 100) {
                    zone.owner = null;
                  }
                }
              }
            }
          }

          // Clear contesters cache on capture so next battle gets a fresh set
          delete state._contesters[star.hip_id];

          state.recalculateLeaderboard();
          state.save();
          renderAll();
        }
      }

      streamLog();
    }

    // Render Fusions and Deck Collection Tab
    function renderCollection() {
      const container = document.getElementById("collection-grid");
      container.innerHTML = "";

      state.collection.forEach(c => {
        const slot = state.deck.find(d => d.card_id === c.card_id);
        const loadout = slot ? slot.loadout : "bench";
        container.innerHTML += buildCardHTML(c, loadout, false);
      });
    }

    // Tap card on collection panel
    window.tempFuseCard = null;
    function handleCollectionCardClick(cardId) {
      const c = state.collection.find(card => card.card_id === cardId);
      if (!c) return;

      if (window.tempFuseCard === null) {
        // Tapped first copy - prepare for fusion
        window.tempFuseCard = cardId;
        
        const fuseBar = document.getElementById("fuse-controls-bar");
        const label = document.getElementById("fuse-label");
        fuseBar.style.display = "flex";
        label.innerHTML = `Pick matching copy of <strong>${c.title}</strong> to fuse:`;
        synth.playClick();
      } else {
        // Tapped second copy - execute fuse if matches
        if (window.tempFuseCard === cardId) {
          cancelFuse();
          return;
        }

        const first = state.collection.find(card => card.card_id === window.tempFuseCard);
        if (first.suit === c.suit && first.rank === c.rank && first.is_trump === c.is_trump) {
          // Match - Fuse keep stronger
          const keepId = first.level >= c.level ? first.card_id : c.card_id;
          const consumeId = keepId === first.card_id ? c.card_id : first.card_id;
          
          state.fuseCards(keepId, consumeId);
          cancelFuse();
          renderAll();
        } else {
          // Mismatch - re-anchor to new card
          window.tempFuseCard = cardId;
          const label = document.getElementById("fuse-label");
          label.innerHTML = `Pick matching copy of <strong>${c.title}</strong> to fuse:`;
          synth.playSelect();
        }
      }
    }

    function cancelFuse() {
      window.tempFuseCard = null;
      document.getElementById("fuse-controls-bar").style.display = "none";
      synth.playSelect();
    }

    // Helper: double tap / hold cycles loadouts
    // Since uGUI client double tap cycles, let's implement long-press or double click on Web Collection Cards
    // In our Web client, let's make double-clicking a collection card cycle its loadout!
    window.addEventListener("dblclick", (e) => {
      const cardEl = e.target.closest(".web-card");
      if (cardEl) {
        // Parse Action function from onclick: handleCollectionCardClick(id) -> id
        const onclickStr = cardEl.getAttribute("onclick");
        if (onclickStr && onclickStr.includes("handleCollectionCardClick")) {
          const match = onclickStr.match(/\d+/);
          if (match) {
            const cardId = parseInt(match[0]);
            state.cycleLoadout(cardId);
            renderAll();
          }
        }
      }
    });

    // Populate user profile info in banner
    function renderUserBanner() {
      const banner = document.getElementById("player-banner");
      if (!state.player) return;
      const fIdx = state.player.faction;
      const evmStr = state.player.evm_address 
        ? `<span style="font-size: 9px; color: var(--gold); font-family: var(--mono); background: rgba(216,180,106,0.1); border: 1px solid rgba(216,180,106,0.25); padding: 2px 6px; border-radius: 2px; text-shadow: none;">Wallet: ${state.player.evm_address.slice(0,6)}...${state.player.evm_address.slice(-4)}</span>` 
        : "";
      banner.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px;">
          <span style="font-size: 14px; font-weight: bold; color: #fff;">${state.player.handle}</span>
          ${evmStr}
          <span style="font-size: 10px; color: var(--gold); cursor:pointer; text-decoration:underline;" onclick="openSignInModal()">[Switch]</span>
        </div>
        <span style="font-size: 10px; color: ${PLANET_COLORS[fIdx]}; letter-spacing: 0.05em; text-transform: uppercase;">
          Faction: ${PLANET_GLYPHS[fIdx]} ${PLANET_NAMES[fIdx]}
        </span>
        <span style="font-size: 10px; color: var(--gold); letter-spacing: 0.05em;">
          ✦ ${(state.player.tokens || 0).toLocaleString()} tokens · ${state.player.word_wins || 0} word wins
        </span>
      `;
    }

    // ---- ASTRAL SIGN IN & MULTI-PROFILE HANDLERS ----
    function openSignInModal() {
      document.getElementById("signin-modal").style.display = "flex";
      switchModalTab('select');
      renderProfilesList();
      
      const astralKeyTextarea = document.getElementById("astral-key-textarea");
      if (state.player && state.player.handle) {
        const rawSave = localStorage.getItem(`pentacles_save_${state.player.handle}`);
        if (rawSave) {
          try {
            const base64 = btoa(unescape(encodeURIComponent(rawSave)));
            astralKeyTextarea.value = base64;
          } catch(e) {
            astralKeyTextarea.value = "Error generating Astral Key.";
          }
        }
      } else {
        astralKeyTextarea.value = "No active seeker profile to backup.";
      }
      
      document.getElementById("astral-key-import-input").value = "";
      synth.playSelect();
    }

    function closeSignInModal() {
      document.getElementById("signin-modal").style.display = "none";
      synth.playSelect();
    }

    function switchModalTab(tabId) {
      document.getElementById("modal-tab-select").classList.toggle("active", tabId === 'select');
      document.getElementById("modal-tab-key").classList.toggle("active", tabId === 'key');
      document.getElementById("modal-tab-web3").classList.toggle("active", tabId === 'web3');
      
      document.getElementById("modal-pane-select").style.display = tabId === 'select' ? 'flex' : 'none';
      document.getElementById("modal-pane-key").style.display = tabId === 'key' ? 'flex' : 'none';
      document.getElementById("modal-pane-web3").style.display = tabId === 'web3' ? 'flex' : 'none';
      synth.playClick();
    }

    function renderProfilesList() {
      const container = document.getElementById("profiles-list-container");
      container.innerHTML = "";
      
      const list = state.getProfilesList();
      if (list.length === 0) {
        container.innerHTML = `<div style="font-size:12px; color:var(--dim); text-align:center; padding:20px;">No saved astral profiles. Create a new seeker below!</div>`;
        return;
      }
      
      list.forEach(handle => {
        const isActive = state.player && state.player.handle === handle;
        const profileRaw = localStorage.getItem(`pentacles_save_${handle}`);
        let subtitle = "Incomplete Profile";
        
        if (profileRaw) {
          try {
            const data = JSON.parse(profileRaw);
            const factionId = data.player.faction;
            subtitle = `Faction: ${PLANET_GLYPHS[factionId]} ${PLANET_NAMES[factionId]}`;
          } catch(e) {}
        }
        
        container.innerHTML += `
          <div class="standings-item ${isActive ? 'me' : ''}" style="cursor:pointer; margin-bottom: 6px;" onclick="selectProfile('${handle}')">
            <div style="display:flex; flex-direction:column; gap:2px;">
              <span style="font-weight:bold; color:#fff;">${handle} ${isActive ? '✦' : ''}</span>
              <span style="font-size:10px; color:var(--dim);">${subtitle}</span>
            </div>
            <button class="btn" style="padding:4px 8px; font-size:9px; border-color:var(--wands); color:var(--wands); background:transparent;" onclick="deleteProfileClick('${handle}', event)">Discard</button>
          </div>
        `;
      });
    }

    function selectProfile(handle) {
      state.switchProfile(handle);
      closeSignInModal();
      renderAll();
      synth.playFanfare();
    }

    async function deleteProfileClick(handle, event) {
      event.stopPropagation();
      const ok = await confirmToast(`Discard seeker profile <b>${handle}</b>? This is permanent.`, { title: "Discard profile", confirmLabel: "Discard", cancelLabel: "Keep", danger: true });
      if (!ok) return;
      {
        state.deleteProfile(handle);
        
        const loaded = state.load();
        if (!loaded) {
          closeSignInModal();
          document.getElementById("onboarding-overlay").style.display = "flex";
        } else {
          renderProfilesList();
          renderAll();
        }
        synth.playClick();
      }
    }

    function createNewSeekerProfile() {
      closeSignInModal();
      document.getElementById("onboarding-overlay").style.display = "flex";
      document.getElementById("onboarding-step-1").style.display = "flex";
      document.getElementById("onboarding-step-2").style.display = "none";
      
      document.getElementById("ob-handle").value = "NewSeeker";
      synth.playSelect();
    }

    function importAstralKey() {
      const input = document.getElementById("astral-key-import-input").value.trim();
      if (!input) {
        toast("Please paste an Astral Key!", { type: "warn" });
        return;
      }
      
      try {
        const decoded = decodeURIComponent(escape(atob(input)));
        const data = JSON.parse(decoded);
        if (data.player && data.player.handle) {
          localStorage.setItem(`pentacles_save_${data.player.handle}`, decoded);
          state.addProfileToList(data.player.handle);
          state.switchProfile(data.player.handle);
          
          closeSignInModal();
          renderAll();
          synth.playFanfare();
        } else {
          toast("Invalid Astral Key structure.", { type: "error" });
        }
      } catch(e) {
        console.error("Import failed", e);
        toast("Failed to decode Astral Key. Make sure you copied the entire key string.", { type: "error" });
      }
    }

    let web3Address = null;

    function renderWeb3Status() {
      const status = document.getElementById("web3-wallet-status");
      if (!status || !web3Address) return;
      const onBase = window.Pentacles?.wallet?.onBaseSepolia;
      status.innerHTML =
        `Connected EVM Wallet:<br><strong style="font-family: var(--mono); color: var(--gold-bright); font-size: 11px;">${web3Address}</strong>` +
        (onBase
          ? `<br><span style="color:var(--pentacles);font-size:11px;">● Base Sepolia · live</span>`
          : `<br><button class="btn" style="margin-top:6px;font-size:11px;padding:4px 8px;" onclick="switchWalletToBaseSepolia()">Switch to Base Sepolia ⚡</button>`);
    }

    async function connectWeb3Wallet() {
      const wallet = window.Pentacles && window.Pentacles.wallet;
      if (!wallet || typeof window.ethereum === 'undefined') {
        toast("No EVM wallet extension (e.g. MetaMask) detected. Please install one to use Web3 login.", { type: "warn" });
        return;
      }

      const status = document.getElementById("web3-wallet-status");
      const btn = document.getElementById("web3-connect-btn");

      try {
        status.innerHTML = "Requesting account access…";
        btn.disabled = true;

        // Route through the wallet façade: wires account/chain events, persistence,
        // and updates the ESMS HUD automatically.
        web3Address = await wallet.connectInjected();
        renderWeb3Status();
        btn.innerText = "Disconnect Wallet";
        btn.setAttribute("onclick", "disconnectWeb3Wallet()");
        btn.disabled = false;

        // Local profile associated with this wallet?
        const handle = getHandleForWallet(web3Address);
        const profileSection = document.getElementById("web3-profile-section");
        const profileInfo = document.getElementById("web3-profile-info");
        const loginBtn = document.getElementById("web3-login-btn");

        profileSection.style.display = "flex";
        if (handle) {
          profileInfo.innerHTML = `Profile: <strong>${handle}</strong>`;
          loginBtn.innerText = `Sign In as ${handle} ⚡`;
        } else {
          profileInfo.innerHTML = `No seeker profile associated with this wallet. Sign in to create a new profile.`;
          loginBtn.innerText = `Create New Profile for Wallet ✦`;
        }

        if (!wallet.onBaseSepolia) {
          toast("Connected — switch to Base Sepolia for live ESMS balances and pool trading.", { type: "info" });
        }
        synth.playFanfare();
      } catch (e) {
        console.error("Wallet connection failed", e);
        status.innerHTML = `<span style="color:#e88a8a;">Connection failed: ${e.message || e}</span>`;
        btn.disabled = false;
        btn.innerText = "Connect EVM Wallet 🦊";
        btn.setAttribute("onclick", "connectWeb3Wallet()");
        synth.playClick();
      }
    }

    async function switchWalletToBaseSepolia() {
      try {
        await window.Pentacles.wallet.switchToBaseSepolia();
        toast("Switched to Base Sepolia.", { type: "success" });
        renderWeb3Status();
      } catch (e) {
        toast(`Could not switch network: ${e.message || e}`, { type: "error" });
      }
    }

    function disconnectWeb3Wallet() {
      web3Address = null;
      window.Pentacles?.wallet?.disconnect();
      document.getElementById("web3-wallet-status").innerHTML = "Connect your EVM wallet to authenticate and register on-chain.";
      const btn = document.getElementById("web3-connect-btn");
      btn.innerText = "Connect EVM Wallet 🦊";
      btn.setAttribute("onclick", "connectWeb3Wallet()");
      document.getElementById("web3-profile-section").style.display = "none";
      synth.playSelect();
    }

    function getHandleForWallet(address) {
      const list = state.getProfilesList();
      for (const handle of list) {
        const profileRaw = localStorage.getItem(`pentacles_save_${handle}`);
        if (profileRaw) {
          try {
            const data = JSON.parse(profileRaw);
            if (data.player && data.player.evm_address && data.player.evm_address.toLowerCase() === address.toLowerCase()) {
              return handle;
            }
          } catch(e) {}
        }
      }
      return null;
    }

    function loginWithWeb3Wallet() {
      if (!web3Address) return;
      
      const handle = getHandleForWallet(web3Address);
      if (handle) {
        // Log in to existing profile
        selectProfile(handle);
      } else {
        // Create new profile for this wallet
        closeSignInModal();
        document.getElementById("onboarding-overlay").style.display = "flex";
        document.getElementById("onboarding-step-1").style.display = "flex";
        document.getElementById("onboarding-step-2").style.display = "none";
        
        // Prefill handle with first 6 chars of address
        document.getElementById("ob-handle").value = `Seeker_${web3Address.slice(2, 8)}`;
        
        // Store temp address so onboarding registers it
        window.tempEvmAddress = web3Address;
        synth.playSelect();
      }
    }

    // Master render call
    function renderAll() {
      renderActiveHand();
      renderLeaderboard();
      renderZonesList();
      renderStarsNodes();
      renderCollection();
      renderUserBanner();
      renderWordDuel();
      renderPoolsPanel();
    }

    // ---- WORD DUELS OF THE SPHERES (the Lettered Arcana) ----
    function renderWordDuel() {
      if (!state.player) return;
      document.getElementById("word-token-balance").innerText = "✦ " + (state.player.tokens || 0).toLocaleString();

      const have = state.playerLetters();
      const rackEl = document.getElementById("word-rack");
      const letters = Object.keys(have).sort();
      rackEl.innerHTML = letters.length === 0
        ? `<span style="font-size:11px;color:var(--dim)">No lettered Arcana yet — win matches to draw tiles.</span>`
        : letters.map(l => {
            const val = LETTER_VALUES[l] || 0;
            const count = have[l];
            return `<span class="word-tile" onclick="appendLetter('${l}')"><b>${l}</b><sub>${val}</sub>${count > 1 ? `<i>×${count}</i>` : ""}</span>`;
          }).join("");

      const sel = document.getElementById("word-opponent");
      if (!sel.options.length) {
        sel.innerHTML = PLANET_NAMES.map((n, i) => `<option value="${i}">${PLANET_GLYPHS[i]} ${n}</option>`).join("");
      }

      const log = document.getElementById("word-log-console");
      log.innerHTML = state.wordDuels.length === 0
        ? `<span class="log-line system">No words cast yet. Spell your first Word of Power…</span>`
        : state.wordDuels.map(d => {
            const opp = PLANET_GLYPHS[d.opponent] + " " + PLANET_NAMES[d.opponent];
            return `<span class="log-line ${d.won ? "win" : "loss"}">${d.won ? "✦" : "✗"} <b>${d.playerWord}</b> (${d.playerScore}) vs ${opp} ${d.agentWord || "—"} (${d.agentScore}) → +${d.tokens} ✦</span>`;
          }).join("");

      onWordInput();
    }

    function appendLetter(l) {
      const inp = document.getElementById("word-input");
      inp.value = (inp.value + l).toUpperCase();
      onWordInput();
      inp.focus();
    }

    function onWordInput() {
      const w = (document.getElementById("word-input").value || "").trim().toUpperCase();
      const prev = document.getElementById("word-preview");
      if (!w) { prev.innerText = ""; return; }
      const spellable = canSpell(w, state.playerLetters());
      const valid = isValidWord(w);
      let msg = `${w.length} letters · ${wordScore(w)} pts`;
      if (!spellable) msg += " · ✗ missing letters";
      else if (WORD_SET === null) msg += " · opening Codex…";
      else if (!valid) msg += " · ✗ not in Codex";
      else msg += " · ✓ ready";
      prev.style.color = (spellable && valid) ? "var(--gold-bright)" : "var(--dim)";
      prev.innerText = msg;
    }

    function castWordOfPower() {
      if (!state.player) return;
      const inp = document.getElementById("word-input");
      const opp = parseInt(document.getElementById("word-opponent").value || "0", 10);
      const res = state.castWord(inp.value, opp);
      const out = document.getElementById("word-result");
      if (res.error) {
        out.style.color = "#e88a8a";
        out.innerText = "✗ " + res.error;
        synth.playClick();
        return;
      }
      out.style.color = res.won ? "var(--gold-bright)" : "var(--dim)";
      out.innerHTML = res.won
        ? `✦ <b>Victory!</b> ${res.playerWord} (${res.playerScore}) bested ${PLANET_NAMES[opp]}'s ${res.agentWord || "—"} (${res.agentScore}). <b>+${res.tokens}</b> tokens!`
        : `${PLANET_NAMES[opp]} answered <b>${res.agentWord || "—"}</b> (${res.agentScore}) to your ${res.playerWord} (${res.playerScore}). +${res.tokens} tokens.`;
      inp.value = "";
      if (res.won) synth.playFanfare(); else synth.playClick();
      renderWordDuel();
      renderUserBanner();
    }

    // Init Page setup
    document.addEventListener("DOMContentLoaded", () => {
      initHologramControls();
      requestAnimationFrame(animateFrame);
      // Open the Codex (shared wordlist.txt) for Word Duels; re-render when it lands.
      loadCodex().then(() => { if (state.player) renderWordDuel(); });

      const loaded = state.load();
      if (loaded && state.player) {
        // Load direct to board
        document.getElementById("onboarding-overlay").style.display = "none";
        renderAll();
      } else {
        // No seeker yet — still chart the live sky behind the onboarding veil.
        state.recomputeSky();
        renderStarsNodes();
      }

      // Periodically trigger state tick updates every 15s (sky drift, decay & bot raids)
      setInterval(() => {
        if (state.player) {
          state.tick();
          renderLeaderboard();
          renderZonesList();
          renderStarsNodes();
          updateCombatPreview();
          renderPoolsPanel();
        } else {
          state.recomputeSky();
          renderStarsNodes();
          renderPoolsPanel();
        }
      }, 15000);
    });
