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
      pitch: 0,
      yaw: 0,
      scale: 1.0,
      targetPitch: 0,
      targetYaw: 0,
      targetScale: 1.0,
      isZoomed: false,
      autoRotate: false,
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
      HologramCamera.targetPitch = 0;
      HologramCamera.targetScale = 1.0;
      HologramCamera.isZoomed = false;
      window.needsFullStarRebuild = true; // re-apply the density cull for the wide view
      renderZonesList();
      renderStarsNodes();
      updateCombatPreview();
      document.getElementById("reset-view-btn").style.display = "none";
      
      const overlay = document.getElementById("ritual-hud-overlay");
      if (overlay) overlay.style.display = "none";
      window.activeRitualTarget = null;
      
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
      if (state.chiron) {
        const proj = skyProject(state.chiron.alt, state.chiron.az);
        state.chiron.x = proj.x; state.chiron.y = proj.y;
      }

      const now = new Date();
      const { lat, lon } = state.observer;
      state.ecliptic = eclipticSegments(lat, lon, now);
      
      const lst = lstDeg(now, lon);
      state.recomputeConstellations(now, lat, lon, lst);
    }

    // Re-projecting ~thousands of star nodes is the dominant cost, so cap the
    // dome to ~30fps. At 60Hz this work ran twice as often for no visible gain;
    // 30fps halves CPU/GPU with an imperceptible difference on a slow rotation.
    let _lastSkyFrame = 0;
    const SKY_FRAME_MS = 32;
    function animateFrame(ts) {
      requestAnimationFrame(animateFrame);
      if (!HologramCamera.enabled) return;
      if (ts && ts - _lastSkyFrame < SKY_FRAME_MS) return;
      _lastSkyFrame = ts || 0;
      HologramCamera.update();
      projectSky3D();
      update3DOverlays();
      renderStarsNodes();
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
        HologramCamera.targetPitch = Math.max(0, Math.min(70, startPitch + dy * 0.25));
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

      // Setup zone paths drag & drop
      for (let z = 0; z < 11; z++) {
        const el = document.getElementById(`zone-shape-${z}`);
        if (el) {
          el.addEventListener("dragover", (e) => {
            e.preventDefault();
            el.classList.add("drag-over");
          });
          el.addEventListener("dragleave", () => {
            el.classList.remove("drag-over");
          });
          el.addEventListener("drop", (e) => {
            e.preventDefault();
            el.classList.remove("drag-over");
            const cardId = parseInt(e.dataTransfer.getData("text/plain"));
            if (!isNaN(cardId)) {
              playCardIntoRitual(cardId, "zone", z);
            }
          });
        }
      }

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
      requestGeolocationConsent(
        () => useMyLocationImpl(),
        () => {
          document.getElementById("ob-lat").value = "40.7128";
          document.getElementById("ob-lon").value = "-74.0060";
        }
      );
    }

    function useMyLocationImpl() {
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
      try {
        const handleInput = document.getElementById("ob-handle");
        let handle = handleInput ? handleInput.value.trim() : "";
        if (!handle) {
          handle = "Cryptonym_" + Math.floor(1000 + Math.random() * 9000);
          if (handleInput) handleInput.value = handle;
        }

        const dateInput = document.getElementById("ob-date");
        const timeInput = document.getElementById("ob-time");
        const locInput = document.getElementById("ob-loc");
        const date = (dateInput && dateInput.value) || "1998-05-14";
        const time = (timeInput && timeInput.value) || "14:30";
        const loc = (locInput && locInput.value) || "New York, US";

        // Anchor the live sky to the observer before the map first renders.
        const latInput = document.getElementById("ob-lat");
        const lonInput = document.getElementById("ob-lon");
        const lat = latInput ? parseFloat(latInput.value) : 40.7128;
        const lon = lonInput ? parseFloat(lonInput.value) : -74.0060;
        if (Number.isFinite(lat) && Number.isFinite(lon) && window.state) {
          window.state.observer = {
            lat: Math.max(-90, Math.min(90, lat)),
            lon: Math.max(-180, Math.min(180, lon))
          };
        }
        if (window.state && typeof window.state.recomputeSky === "function") {
          window.state.recomputeSky();
        }

        // Calculate deterministic local placements.
        const chart = (typeof deriveLocalNatalChart === "function")
          ? deriveLocalNatalChart(`${date} ${time} ${loc}`)
          : { placements: [], ascendant: 0, midheaven: 0 };

        const birthMs = Date.parse(`${date}T${time || "12:00"}`);
        if (Number.isFinite(birthMs)) chart.birth_unix = Math.floor(birthMs / 1000);
        if (Number.isFinite(lat)) chart.birth_lat = lat;
        if (Number.isFinite(lon)) chart.birth_lon = lon;

        const picks = (typeof scoreFactions === "function")
          ? scoreFactions(chart)
          : [{ id: 0, score: 5 }, { id: 1, score: 3 }, { id: 2, score: 2 }];
        
        // Populate choices Grid
        const grid = document.getElementById("faction-picks-grid");
        if (grid) {
          grid.innerHTML = "";
          const P_NAMES = window.PLANET_NAMES || ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'];
          const P_GLYPHS = window.PLANET_GLYPHS || ['☉', '☽', '☿', '♀', '♂', '♃', '♄', '♅', '♆', '♇'];
          const P_COLORS = window.PLANET_COLORS || ['#F59E0B', '#E2E8F0', '#38BDF8', '#EC4899', '#EF4444', '#10B981', '#F59E0B', '#06B6D4', '#6366F1', '#8B5CF6'];

          picks.forEach(pick => {
            const name = P_NAMES[pick.id] || "Planet";
            const glyph = P_GLYPHS[pick.id] || "✦";
            const color = P_COLORS[pick.id] || "#f1dba1";
            
            grid.innerHTML += `
              <div class="faction-choice-card" onclick="selectFactionPick(${pick.id})" id="faction-pick-${pick.id}">
                <div class="faction-choice-sigil" style="color: ${color}">${glyph}</div>
                <div class="faction-choice-name">${name}</div>
                <div style="font-size:9px; color:var(--dim); margin-top:4px">Score: ${pick.score}</div>
              </div>
            `;
          });
        }

        // Show step 2
        const s1 = document.getElementById("onboarding-step-1");
        const s2 = document.getElementById("onboarding-step-2");
        if (s1) s1.style.display = "none";
        if (s2) s2.style.display = "flex";
        
        // Save temp chart
        window.tempChart = chart;
        window.tempHandle = handle;

        // Auto-select the top recommendation so the confirm button is immediately ready
        if (picks && picks.length > 0) {
          selectFactionPick(picks[0].id);
        }

        if (window.synth && window.synth.playSelect) window.synth.playSelect();
      } catch (err) {
        console.error("[Pentacles] Onboarding step 1 error:", err);
        const s1 = document.getElementById("onboarding-step-1");
        const s2 = document.getElementById("onboarding-step-2");
        if (s1) s1.style.display = "none";
        if (s2) s2.style.display = "flex";
        if (typeof selectFactionPick === "function") selectFactionPick(0);
      }
    }

    window.chosenFaction = null;
    function selectFactionPick(factionId) {
      document.querySelectorAll(".faction-choice-card").forEach(el => el.classList.remove("selected"));
      const targetCard = document.getElementById(`faction-pick-${factionId}`);
      if (targetCard) targetCard.classList.add("selected");
      window.chosenFaction = factionId;
      const confirmBtn = document.getElementById("faction-confirm-btn");
      if (confirmBtn) confirmBtn.removeAttribute("disabled");
      if (window.synth && window.synth.playClick) window.synth.playClick();
    }

    function confirmFactionOnboarding() {
      try {
        if (window.chosenFaction === null || window.chosenFaction === undefined) {
          window.chosenFaction = 0; // Default to Sun if unselected
        }
        let handle = window.tempHandle;
        if (!handle) {
          const handleInput = document.getElementById("ob-handle");
          handle = (handleInput && handleInput.value.trim()) || "Cryptonym_108";
        }
        if (!window.tempChart) {
          window.tempChart = (typeof deriveLocalNatalChart === "function")
            ? deriveLocalNatalChart("1998-05-14 14:30 New York, US")
            : { placements: [], ascendant: 0, midheaven: 0 };
        }

        if (window.state && typeof window.state.registerPlayer === "function") {
          window.state.registerPlayer(handle, window.chosenFaction, window.tempChart);
          if (window.tempEvmAddress && window.state.player) {
            window.state.player.evm_address = window.tempEvmAddress;
            window.tempEvmAddress = null;
          }
          if (typeof window.state.save === "function") window.state.save();
        }
        
        // Dismiss overlay
        const ob = document.getElementById("onboarding-overlay");
        if (ob) ob.style.display = "none";
        if (window.synth && window.synth.playFanfare) window.synth.playFanfare();

        // Full UI Render
        if (typeof renderAll === "function") renderAll();

        // Online: also register a server-side player so cast_word + the live game
        // work. Fire-and-forget so it never blocks onboarding; toast the result.
        const reg = window.Pentacles && window.Pentacles.register;
        if (reg && window.Pentacles.net && window.Pentacles.net.isLive && window.state && window.state.player) {
          reg.registerLive(window.state.player.handle, window.state.player.chart, window.state.player.faction, window.state.observer)
            .then(() => { if (typeof toast === "function") toast(`Registered ${window.state.player.handle} on live module.`, { type: "success", title: "SpacetimeDB" }); })
            .catch((e) => { if (typeof toast === "function") toast(`Live registration failed: ${e.message || e}`, { type: "warn", title: "SpacetimeDB" }); });
        }
      } catch (err) {
        console.error("[Pentacles] Confirm onboarding error:", err);
        const ob = document.getElementById("onboarding-overlay");
        if (ob) ob.style.display = "none";
        if (typeof renderAll === "function") renderAll();
      }
    }

    window.calculateNatalOnboarding = calculateNatalOnboarding;
    window.selectFactionPick = selectFactionPick;
    window.confirmFactionOnboarding = confirmFactionOnboarding;

    // App Navigation tabs
    function switchTab(tabId) {
      document.querySelectorAll(".tab-btn[data-tab]").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.tab === tabId);
      });
      document.querySelectorAll(".sidebar-content > .tab-pane").forEach(pane => {
        pane.classList.toggle("active", pane.id === tabId);
      });
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

      const hud = document.getElementById("ar-horizon-hud");
      if (hud) {
        hud.style.display = arActive ? "flex" : "none";
        if (arActive && window.HorizonTracker) {
          window.HorizonTracker.requestOrientationPermission();
          if (window.HorizonTrackerUI) window.HorizonTrackerUI.updateHUD();
        }
      }

      const wrapper = document.getElementById("sky-map-wrapper");
      if (wrapper) {
        if (!arActive) {
          wrapper.style.transform = ""; // clear gyro transform for 3D Hologram
          window.needsFullStarRebuild = true;
          if (window.HologramCamera) {
            HologramCamera.pitch = 0;
            HologramCamera.yaw = 0;
            HologramCamera.scale = 1.0;
            HologramCamera.targetPitch = 0;
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

    // ── SIEGE BOARD & HAND SORTING STATE ───────────────────────────────────────
    let handSortMode = "rank";
    let handFilterMode = "all";
    window.draggingCardId = null;

    function setHandSort(mode) {
      handSortMode = mode;
      const chips = ["rank", "suit", "affinity", "power", "sign"];
      chips.forEach(m => {
        const btn = document.getElementById(`sort-${m}`);
        if (btn) btn.classList.toggle("active", m === mode);
      });
      renderActiveHand();
    }

    function setHandFilter(filter) {
      handFilterMode = filter;
      const filters = ["all", "wands", "cups", "swords", "pentacles"];
      filters.forEach(f => {
        const btn = document.getElementById(`filter-${f}`);
        if (btn) btn.classList.toggle("active", f === filter);
      });
      renderActiveHand();
    }

    // Render Web Card Component HTML
    function buildCardHTML(c, loadout, isSelectionMode = false) {
      const isSelected = state.selectedCards.has(c.card_id) || state.selectedCards.has(Number(c.card_id));
      const selClass = isSelected ? "selected" : "";
      const isMajor = !!c.is_major;
      const bodyIdx = typeof c.source_body === "number" ? c.source_body : (typeof c.source_body === "string" ? PLANET_NAMES.indexOf(c.source_body) : 0);
      const planetColor = PLANET_COLORS[bodyIdx] || "#e8b84b";
      const planetGlyph = PLANET_GLYPHS[bodyIdx] || "✦";
      const suitKey = (c.suit || "wands").toLowerCase();
      const suitGlyph = SUIT_GLYPHS[suitKey] || "✦";
      const numeral = (c.rank !== undefined && ARCANA_NUMERALS[c.rank]) || (bodyIdx >= 0 && MAJOR_NUMERALS[bodyIdx]) || "✦";
      const signIdx = (c.sign_idx !== undefined && c.sign_idx !== null) ? Number(c.sign_idx) : 0;
      const detailText = isMajor ? `Major ${numeral}` : `${SIGN_GLYPHS[signIdx] || "✦"} ${SIGN_NAMES[signIdx] || ""}`;
      const actionFn = isSelectionMode ? `autoPlaceCardInSiege(${c.card_id})` : `handleCollectionCardClick(${c.card_id})`;
      const normLoadout = (loadout || "").toLowerCase();
      const badge = normLoadout === "active" ? `<span class="web-card-chip">Active</span>` : (normLoadout === "defense" ? `<span class="web-card-chip defense">Defense</span>` : "");

      const dragAttr = isSelectionMode
        ? `draggable="true" ondragstart="handleCardDragStart(event, ${c.card_id})" ondragend="handleCardDragEnd(event, ${c.card_id})"`
        : "";

      const title = c.title || (isMajor ? (ARCANA_NAMES[c.rank] || MAJOR_NAMES[bodyIdx] || "Major Arcana") : `${rankName(c.rank)} of ${SUIT_NAMES[suitKey] || suitKey}`);

      return `
        <div class="web-card ${suitKey} ${selClass} ${isMajor ? 'major' : ''} ${c.inverted ? 'inverted' : ''}" data-card-id="${c.card_id}" ${dragAttr} onclick="${actionFn}">
          ${badge}
          <div class="web-card-glyph" style="color: ${planetColor};">${suitGlyph}</div>
          <div class="web-card-title">${title}</div>
          <div class="web-card-subtitle">${detailText} ${c.inverted ? '(rev)' : ''}</div>
          <div class="web-card-sep"></div>
          <div class="web-card-stats">
            ⚔ ${c.attack || 0} &nbsp; ♥ ${c.health || 0}<br>
            🛡 ${c.armour || 0} &nbsp; ⏳ ${c.cooldown_ms || 1000}
          </div>
          <div class="web-card-footnote" style="color: ${planetColor};">
            ${planetGlyph} Lv ${c.level || 1}
          </div>
        </div>
      `;
    }

    // Render only the authoritative Active Hand. Ritual validation uses this same
    // loadout, so every card shown here is guaranteed to be playable.
    function renderActiveHand() {
      const container = document.getElementById("active-deck-strip");
      if (!container) return;
      container.innerHTML = "";

      if (state.player && typeof state.ensureStarterDeck === "function") {
        state.ensureStarterDeck();
      }

      let cards = (state.deck || [])
        .filter(d => d.loadout === "active")
        .map(d => state.collection.find(c => c.card_id === d.card_id))
        .filter(Boolean);
      const activeTotal = cards.length;

      // Apply Filter
      if (handFilterMode !== "all") {
        cards = cards.filter(c => c.suit && c.suit.toLowerCase() === handFilterMode);
      }

      // Apply Sort
      cards.sort((a, b) => {
        if (handSortMode === "rank") {
          return (a.rank || 0) - (b.rank || 0) || (b.attack || 0) - (a.attack || 0);
        } else if (handSortMode === "suit") {
          return (a.suit || "").localeCompare(b.suit || "") || (b.attack || 0) - (a.attack || 0);
        } else if (handSortMode === "affinity") {
          return (a.source_body || 0) - (b.source_body || 0) || (b.attack || 0) - (a.attack || 0);
        } else if (handSortMode === "power") {
          return (b.attack || 0) - (a.attack || 0);
        } else if (handSortMode === "sign") {
          return (a.sign_idx !== undefined ? a.sign_idx : 0) - (b.sign_idx !== undefined ? b.sign_idx : 0) || (b.attack || 0) - (a.attack || 0);
        }
        return 0;
      });

      const handCards = cards;
      handCards.forEach(c => {
        container.innerHTML += buildCardHTML(c, "active", true);
      });
      if (handCards.length === 0) {
        const message = activeTotal === 0
          ? "Your Active Hand is empty. Open My Pentacles and assign cards to Active."
          : "No Active Hand cards match this filter.";
        const emptyAction = activeTotal === 0
          ? '<button class="btn" onclick="openMyPentacles()">Open My Pentacles</button>'
          : '<button class="btn" onclick="setHandFilter(\'all\')">Clear Filter</button>';
        container.innerHTML = `
          <div class="hand-empty">
            <span>✦</span>
            <p>${message}</p>
            ${emptyAction}
          </div>
        `;
      }

      const cardCountEl = document.getElementById("hand-card-count");
      if (cardCountEl) cardCountEl.innerText = handCards.length;

      const placedCount = state.siegeSlots ? state.siegeSlots.filter(Boolean).length : 0;
      const activeHandCountEl = document.getElementById("active-hand-count");
      if (activeHandCountEl) activeHandCountEl.innerText = `${placedCount} / 3 Slots Placed`;

      renderSiegeBoardSlots();
    }

    // ── 3-CARD BATTLE BOARD & SIEGE SLOTS ─────────────────────────────────────
    function autoPlaceCardInSiege(cardId) {
      if (!state.siegeSlots) state.siegeSlots = [null, null, null];

      const existingIdx = state.siegeSlots.indexOf(cardId);
      if (existingIdx !== -1) {
        removeCardFromSiegeSlot(existingIdx);
        return;
      }

      const emptyIdx = state.siegeSlots.indexOf(null);
      if (emptyIdx !== -1) {
        placeCardInSiegeSlot(cardId, emptyIdx);
      } else {
        placeCardInSiegeSlot(cardId, 0); // Replace slot 0 if full
      }
    }

    function placeCardInSiegeSlot(cardId, slotIdx) {
      if (!state.siegeSlots) state.siegeSlots = [null, null, null];

      const prevIdx = state.siegeSlots.indexOf(cardId);
      if (prevIdx !== -1) state.siegeSlots[prevIdx] = null;

      state.siegeSlots[slotIdx] = cardId;
      state.selectedCards.add(cardId);

      renderSiegeBoardSlots();
      renderActiveHand();
      updateCombatPreview();
      if (synth && synth.playSelect) synth.playSelect();
    }

    function removeCardFromSiegeSlot(slotIdx) {
      if (!state.siegeSlots) state.siegeSlots = [null, null, null];
      const removedId = state.siegeSlots[slotIdx];
      if (removedId) {
        state.siegeSlots[slotIdx] = null;
        state.selectedCards.delete(removedId);
        renderSiegeBoardSlots();
        renderActiveHand();
        updateCombatPreview();
        if (synth && synth.playClick) synth.playClick();
      }
    }

    function calculateSiegeSynergies() {
      if (!state.siegeSlots) state.siegeSlots = [null, null, null];
      const targetStar = state.getSelectedStar();

      let baseAtk = 0;
      let cardCount = 0;
      const suits = [];

      state.siegeSlots.forEach(id => {
        if (id) {
          const c = state.collection.find(card => card.card_id === id);
          if (c) {
            baseAtk += c.attack;
            cardCount++;
            suits.push(c.suit);
          }
        }
      });

      if (cardCount === 0) {
        return { baseAtk: 0, totalAtk: 0, multiplier: 1.0, synergyText: "", badges: [] };
      }

      let multiplier = 1.0;
      const badges = [];

      const suitCounts = {};
      suits.forEach(s => { suitCounts[s] = (suitCounts[s] || 0) + 1; });

      let maxSuitCount = 0;
      let dominantSuit = "";
      for (const [s, cnt] of Object.entries(suitCounts)) {
        if (cnt > maxSuitCount) { maxSuitCount = cnt; dominantSuit = s; }
      }

      if (maxSuitCount === 3) {
        multiplier += 0.50; // +50% Tri-suit Triplicity Synergy
        badges.push(`🔥 TRI-SUIT ${dominantSuit.toUpperCase()} (+50%)`);
      } else if (maxSuitCount === 2) {
        multiplier += 0.25; // +25% Dual-suit Pair
        badges.push(`✦ DUAL-SUIT ${dominantSuit.toUpperCase()} (+25%)`);
      }

      if (targetStar && targetStar.zone !== null) {
        const favoredSuit = SIGN_SUITS[targetStar.zone % 12];
        if (dominantSuit === favoredSuit) {
          multiplier += 0.25;
          badges.push(`⭐ FAVORED ${favoredSuit.toUpperCase()} AFFINITY (+25%)`);
        }
      }

      const totalAtk = Math.round(baseAtk * multiplier);
      return { baseAtk, totalAtk, multiplier, synergyText: badges.join(" · "), badges };
    }

    function renderSiegeBoardSlots() {
      if (!state.siegeSlots) state.siegeSlots = [null, null, null];

      for (let i = 0; i < 3; i++) {
        const slotEl = document.getElementById(`siege-slot-${i}`);
        if (!slotEl) continue;

        const cardId = state.siegeSlots[i];
        if (cardId) {
          const card = state.collection.find(c => c.card_id === cardId);
          if (card) {
            slotEl.innerHTML = `
              <div class="siege-placed-card card-placed-anim">
                <button class="slot-remove-btn" title="Remove Card" onclick="event.stopPropagation(); removeCardFromSiegeSlot(${i})">✕</button>
                <div class="placed-card-glyph" style="color:${PLANET_COLORS[card.source_body]}">${SUIT_GLYPHS[card.suit]}</div>
                <div class="placed-card-title">${card.title}</div>
                <div class="placed-card-stats">⚔ ${card.attack}</div>
              </div>
            `;
            slotEl.classList.add("occupied");
          }
        } else {
          slotEl.innerHTML = `
            <div class="slot-placeholder">✦ SLOT ${["I", "II", "III"][i]}<br><span style="font-size:10px; opacity:0.6;">Drag / Click Card</span></div>
          `;
          slotEl.classList.remove("occupied");
        }
      }

      const syn = calculateSiegeSynergies();
      const powerEl = document.getElementById("siege-board-power");
      if (powerEl) {
        powerEl.innerHTML = syn.multiplier > 1.0
          ? `⚔ <span style="color:var(--gold-bright)">${syn.totalAtk} ATK</span> <span style="font-size:10px; color:var(--gold)">(${syn.baseAtk} × ${syn.multiplier.toFixed(2)})</span>`
          : `⚔ ${syn.totalAtk} ATK`;
      }

      const synBanner = document.getElementById("siege-synergy-banner");
      if (synBanner) {
        if (syn.badges.length > 0) {
          synBanner.style.display = "block";
          synBanner.innerHTML = syn.synergyText;
        } else {
          synBanner.style.display = "none";
        }
      }
    }

    // ── DRAG & DROP & TOUCH LISTENERS ──────────────────────────────────────────
    function handleCardDragStart(e, cardId) {
      e.dataTransfer.setData("text/plain", String(cardId));
      e.dataTransfer.effectAllowed = "move";
      window.draggingCardId = cardId;
    }

    function handleCardDragEnd(e, cardId) {
      window.draggingCardId = null;
    }

    function allowSlotDrop(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
    }

    function highlightSlot(e) {
      e.preventDefault();
      const slot = e.currentTarget;
      if (slot) slot.classList.add("drag-over");
    }

    function unhighlightSlot(e) {
      const slot = e.currentTarget;
      if (slot) slot.classList.remove("drag-over");
    }

    function handleSlotDrop(e, slotIdx) {
      e.preventDefault();
      unhighlightSlot(e);
      const cardId = getDraggedCardId(e);
      if (cardId !== null) {
        placeCardInSiegeSlot(cardId, slotIdx);
      }
    }

    function getDraggedCardId(e) {
      const transferred = e && e.dataTransfer ? e.dataTransfer.getData("text/plain") : "";
      const raw = transferred || window.draggingCardId || window.draggedCardId;
      if (raw === undefined || raw === null || raw === "") return null;
      const cardId = Number(raw);
      return Number.isFinite(cardId) ? cardId : null;
    }

    function allowRitualDrop(e) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      e.currentTarget?.classList.add("drag-over");
    }

    function handleRitualDrop(e) {
      e.preventDefault();
      e.currentTarget?.classList.remove("drag-over");
      const cardId = getDraggedCardId(e);
      const target = window.activeRitualTarget;
      if (cardId === null || !target) {
        toast("Select a zone or planet ritual before dropping a card.", { type: "warn", title: "Ritual Chain" });
        return;
      }
      playCardIntoRitual(cardId, target.type, target.id);
    }

    function attachTouchDragListeners() {
      let touchedCardId = null;

      window.addEventListener("touchstart", (e) => {
        const cardEl = e.target.closest(".web-card");
        if (!cardEl) return;
        const cardId = cardEl.getAttribute("data-card-id");
        if (cardId) touchedCardId = Number(cardId);
      }, { passive: true });

      window.addEventListener("touchmove", (e) => {
        if (!touchedCardId) return;
        const touch = e.touches[0];
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        const slotEl = targetEl ? targetEl.closest(".siege-slot") : null;
        const zoneEl = targetEl ? targetEl.closest(".zone-shape") : null;

        document.querySelectorAll(".siege-slot, .zone-shape").forEach(s => s.classList.remove("drag-over"));
        if (slotEl) slotEl.classList.add("drag-over");
        if (zoneEl) zoneEl.classList.add("drag-over");
      }, { passive: true });

      window.addEventListener("touchend", (e) => {
        if (!touchedCardId) return;
        const touch = e.changedTouches[0];
        const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
        const slotEl = targetEl ? targetEl.closest(".siege-slot") : null;
        const zoneEl = targetEl ? targetEl.closest(".zone-shape") : null;

        document.querySelectorAll(".siege-slot, .zone-shape").forEach(s => s.classList.remove("drag-over"));
        if (slotEl) {
          const slotIdx = Number(slotEl.getAttribute("data-slot"));
          if (!isNaN(slotIdx)) placeCardInSiegeSlot(touchedCardId, slotIdx);
        } else if (zoneEl) {
          const zoneId = Number(zoneEl.id.replace("zone-shape-", ""));
          if (Number.isInteger(zoneId)) playCardIntoRitual(touchedCardId, "zone", zoneId);
        }
        touchedCardId = null;
      });
    }

    // Export Drag & Drop functions to window scope
    window.handleCardDragStart = handleCardDragStart;
    window.handleCardDragEnd = handleCardDragEnd;
    window.allowSlotDrop = allowSlotDrop;
    window.highlightSlot = highlightSlot;
    window.unhighlightSlot = unhighlightSlot;
    window.handleSlotDrop = handleSlotDrop;
    window.getDraggedCardId = getDraggedCardId;
    window.allowRitualDrop = allowRitualDrop;
    window.handleRitualDrop = handleRitualDrop;
    window.autoPlaceCardInSiege = autoPlaceCardInSiege;
    window.removeCardFromSiegeSlot = removeCardFromSiegeSlot;
    window.setHandSort = setHandSort;
    window.setHandFilter = setHandFilter;

    // Attach Touch drag listeners
    if (typeof window !== "undefined") {
      attachTouchDragListeners();
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
      // Tap fallback: if exactly 1 card selected, play it into the zone ritual!
      if (state.player && state.selectedCards.size === 1) {
        const cardId = Array.from(state.selectedCards)[0];
        playCardIntoRitual(cardId, "zone", zoneId);
        state.selectedCards.clear();
        renderActiveHand();
        return;
      }

      state.selectedZone = zoneId;
      state.selectedStarHip = null;

      // Select the zone in our ritual overlay
      if (state.player && state.rituals && zoneId !== null) {
        showRitualOverlay("zone", zoneId);
      }

      // Update zone SVG paths selections
      for (let i = 0; i < 11; i++) {
        const el = document.getElementById(`zone-shape-${i}`);
        if (el) el.classList.toggle("selected", i === zoneId);
      }

      if (zoneId !== null && window.HologramCamera) {
        const center = ZONE_CENTERS[zoneId];
        // Rotate the chosen zone toward the top while keeping the observer-up dome.
        HologramCamera.targetYaw = center.az;
        HologramCamera.targetPitch = 0;
        HologramCamera.targetScale = 2.2;
        HologramCamera.isZoomed = true;
        document.getElementById("reset-view-btn").style.display = "inline-flex";
      } else if (zoneId === null && window.HologramCamera) {
        HologramCamera.targetPitch = 0;
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

    const SIGN_ELEMENT_COLORS = {
      wands: "#db7a47",
      pentacles: "#74ab6c",
      swords: "#aebbd6",
      cups: "#5f93d8"
    };

    function signElementColor(sign) {
      return SIGN_ELEMENT_COLORS[SIGN_SUITS[sign % 12]] || "#d8b46a";
    }

    function projectedEclipticPoint(lambdaDeg, betaDeg, lat, lst) {
      const eq = eclipticToEquatorialLat(lambdaDeg, betaDeg);
      const aa = altAzOf(eq.ra, eq.dec, lat, lst);
      if (aa.alt <= 0) return null;
      return skyProject(aa.alt, aa.az);
    }

    function appendZodiacPath(g, pts, className, color, width) {
      if (pts.length < 2) return;
      const NS = "http://www.w3.org/2000/svg";
      const path = document.createElementNS(NS, "path");
      path.setAttribute("d", "M " + pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L "));
      path.setAttribute("class", className);
      path.setAttribute("stroke", color);
      path.style.color = color;
      if (width) path.setAttribute("stroke-width", width);
      g.appendChild(path);
    }

    function renderZodiacSigns() {
      const g = document.getElementById("zodiac-signs-g");
      if (!g) return;
      g.innerHTML = "";
      const NS = "http://www.w3.org/2000/svg";
      const now = new Date();
      const { lat, lon } = state.observer;
      const lst = lstDeg(now, lon);

      // Great-circle sign boundaries: constant ecliptic longitude divides the
      // whole overhead hemisphere, not just the planet road.
      for (let sign = 0; sign < 12; sign++) {
        const color = signElementColor(sign);
        let pts = [];
        for (let beta = -88; beta <= 88; beta += 4) {
          const p = projectedEclipticPoint(sign * 30, beta, lat, lst);
          if (p) {
            pts.push(p);
          } else {
            appendZodiacPath(g, pts, "zodiac-boundary", color);
            pts = [];
          }
        }
        appendZodiacPath(g, pts, "zodiac-boundary", color);
      }

      // The visible half of the ecliptic is the observer's zodiac band. Split it
      // into sign-sized arcs and tint each by its element color.
      for (let sign = 0; sign < 12; sign++) {
        const color = signElementColor(sign);
        const start = sign * 30;
        const end = start + 30;
        let pts = [];
        let labelPoint = null;
        let bestMid = Infinity;

        for (let lambda = start; lambda <= end + 0.001; lambda += 1.5) {
          const p = projectedEclipticPoint(lambda, 0, lat, lst);
          if (p) {
            pts.push(p);
            const midDelta = Math.abs(lambda - (start + 15));
            if (midDelta < bestMid) {
              bestMid = midDelta;
              labelPoint = p;
            }
          } else {
            appendZodiacPath(g, pts, "zodiac-sign-band", color, "15");
            appendZodiacPath(g, pts, "zodiac-sign-line", color, "2.2");
            pts = [];
          }
        }
        appendZodiacPath(g, pts, "zodiac-sign-band", color, "15");
        appendZodiacPath(g, pts, "zodiac-sign-line", color, "2.2");

        if (labelPoint) {
          const label = document.createElementNS(NS, "text");
          label.setAttribute("x", labelPoint.x.toFixed(1));
          label.setAttribute("y", (labelPoint.y - 10).toFixed(1));
          label.setAttribute("class", "zodiac-sign-label");
          label.setAttribute("fill", color);
          label.textContent = SIGN_NAMES[sign].slice(0, 3).toUpperCase();
          g.appendChild(label);
        }
      }
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
        // Each figure is its own clickable cluster → the constellation pentacles
        // page. The group overrides the layer's pointer-events:none; wide invisible
        // hit-lines make the stick figure pickable, while the visible lines stay
        // non-interactive so a star dot on top still wins its own click.
        const group = document.createElementNS(NS, "g");
        group.setAttribute("class", "constellation-cluster");
        group.setAttribute("id", "con-" + con.id);
        group.style.cursor = "pointer";
        group.style.pointerEvents = "auto";
        for (const [a, b] of con.segments) {
          const line = document.createElementNS(NS, "line");
          line.setAttribute("x1", a.x.toFixed(1)); line.setAttribute("y1", a.y.toFixed(1));
          line.setAttribute("x2", b.x.toFixed(1)); line.setAttribute("y2", b.y.toFixed(1));
          line.setAttribute("stroke", tradeable ? col : "#5a6172");
          line.setAttribute("stroke-width", tradeable ? "1.2" : "0.6");
          line.setAttribute("stroke-opacity", tradeable ? "0.85" : "0.28");
          line.setAttribute("stroke-linecap", "round");
          line.setAttribute("pointer-events", "none");
          if (tradeable) line.setAttribute("filter", `drop-shadow(0 0 2px ${col})`);
          group.appendChild(line);
          const hit = document.createElementNS(NS, "line");
          hit.setAttribute("x1", a.x.toFixed(1)); hit.setAttribute("y1", a.y.toFixed(1));
          hit.setAttribute("x2", b.x.toFixed(1)); hit.setAttribute("y2", b.y.toFixed(1));
          hit.setAttribute("stroke", "transparent");
          hit.setAttribute("stroke-width", "12");
          // visiblePainted (the default) ignores a transparent stroke — force the
          // stroke band to capture clicks regardless of paint so EVERY figure is pickable.
          hit.setAttribute("pointer-events", "stroke");
          group.appendChild(hit);
        }
        const up = Object.values(con.nodes).filter(n => n.up);
        if (up.length) {
          const cx = up.reduce((s, n) => s + n.x, 0) / up.length;
          const cy = up.reduce((s, n) => s + n.y, 0) / up.length;
          const t = document.createElementNS(NS, "text");
          t.setAttribute("x", cx.toFixed(1)); t.setAttribute("y", cy.toFixed(1));
          t.setAttribute("text-anchor", "middle"); t.setAttribute("fill", tradeable ? col : "#7c8398");
          t.setAttribute("font-size", "8"); t.setAttribute("font-family", "Space Grotesk");
          t.setAttribute("opacity", tradeable ? "0.8" : "0.4"); t.setAttribute("letter-spacing", "1");
          t.setAttribute("pointer-events", "auto"); // the label is a click target too
          t.style.cursor = "pointer";
          t.textContent = con.abbr.toUpperCase();
          group.appendChild(t);
        }
        const tip = document.createElementNS(NS, "title");
        tip.textContent = `${con.name} — ${tradeable ? "pool OPEN" : "below horizon"} · tap for its stars & pool`;
        group.appendChild(tip);
        group.onclick = (e) => {
          e.stopPropagation();
          if (typeof window.openConstellationPage === "function") window.openConstellationPage(con);
        };
        frag.appendChild(group);
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

    // Magnitude cap for what we draw, so a denser catalogue doesn't flood the SVG
    // with tens of thousands of nodes. Wide view shows the bright field; zooming
    // in reveals the faint stars in the focused region. Held/selected/in-zone
    // stars always draw regardless of the cap.
    function starRenderCap() {
      const cam = window.HologramCamera;
      const sc = cam ? (cam.isZoomed ? (cam.targetScale || cam.scale || 1) : 1) : 1;
      if (sc >= 2.0) return 99;    // zoomed in — show everything in the focused region
      // Wide view: cull to the brightest field (~mag 5.0). Rendering the full
      // ~8k-star catalogue meant re-projecting thousands of SVG nodes every
      // animation frame (~64ms/pass → ~13fps). mag ≤ 5.0 keeps a rich sky at a
      // fraction of the node count; the zoomed view still reveals the faint stars.
      return 5.0;
    }

    function renderStarsNodes() {
      renderZodiacSigns();
      renderConstellations();
      const container = document.getElementById("stars-nodes-g");
      const NS = "http://www.w3.org/2000/svg";

      const magCap = starRenderCap();

      // Only the rebuild path needs magnitude-sorted draw order; the fast path
      // updates existing nodes by hip id, so iterate state.sky directly and skip
      // sorting ~8k stars on every animation frame.
      const doRebuild = window.needsFullStarRebuild || container.children.length === 0;
      const stars = doRebuild ? [...state.sky].sort((a, b) => b.magnitude - a.magnitude) : state.sky;

      // Rebuild DOM nodes if requested or container is empty
      if (doRebuild) {
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
          if (star.magnitude > magCap && !held && !isSelected && !inZone) continue; // density cull
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
          let starRitualText = "";
          if (state.player && state.rituals) {
            const rit = state.rituals[`zone_${star.zone}`];
            if (rit) {
              starRitualText = ` · Manifold: ${rit.manifold ? rit.manifold.cards.length : 0}/4 Reagents`;
            }
          }
          tip.textContent = `${star.name} · mag ${star.magnitude} · alt ${Math.round(star.alt)}° · ${zoneName}${starRitualText}` +
            (held ? ` · held by ${PLANET_NAMES[star.held_by]}` : "") +
            (engageable ? "" : " · below the 10° engage band");
          circle.appendChild(tip);

          // Drag and drop events for stars (plays into zone ritual)
          circle.addEventListener("dragover", (e) => {
            e.preventDefault();
            circle.classList.add("drag-over");
          });
          circle.addEventListener("dragleave", () => {
            circle.classList.remove("drag-over");
          });
          circle.addEventListener("drop", (e) => {
            e.preventDefault();
            circle.classList.remove("drag-over");
            const cardId = parseInt(e.dataTransfer.getData("text/plain"));
            if (!isNaN(cardId)) {
              playCardIntoRitual(cardId, "zone", star.zone);
            }
          });

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

      // Include Chiron (idx 10) beside the ten classical wanderers — an
      // astrology-only agent: a sky glyph + its own pentacles page, never a faction.
      const wanderers = state.chiron ? state.planets.concat([state.chiron]) : state.planets;
      for (const p of wanderers) {
        if (!p.up) continue;
        const AWlib = window.AstroWeather;
        const col = PLANET_COLORS[p.body] || (AWlib && AWlib.bodyColor(p.body)) || "#86d6b0";
        const discR = PLANET_DISC_R[p.body] || 7;
        const glyphCh = PLANET_GLYPHS[p.body] || (AWlib && AWlib.bodyGlyph(p.body)) || "⚷";
        const nameCh = PLANET_NAMES[p.body] || (AWlib && AWlib.bodyName(p.body)) || "Body";
        const zoneName = p.zone === 10 ? "Crown Zenith" : (p.zone >= 5 ? `Spire ${p.zone}` : `House ${p.zone}`);

        const node = document.createElementNS(NS, "g");
        node.setAttribute("class", "planet-node" + (p.body === 10 ? " comet-node" : ""));
        node.style.color = col;

        // Chiron is a comet: draw a tail streaming away from the Sun (else outward).
        if (p.body === 10) {
          let ax = p.x - 300, ay = p.y - 300;
          const sun = state.planets[0];
          if (sun && sun.up) { ax = p.x - sun.x; ay = p.y - sun.y; }
          const tl = Math.hypot(ax, ay) || 1; ax /= tl; ay /= tl;
          const tail = document.createElementNS(NS, "line");
          tail.setAttribute("x1", p.x.toFixed(1)); tail.setAttribute("y1", p.y.toFixed(1));
          tail.setAttribute("x2", (p.x + ax * 28).toFixed(1)); tail.setAttribute("y2", (p.y + ay * 28).toFixed(1));
          tail.setAttribute("stroke", col); tail.setAttribute("stroke-width", "3");
          tail.setAttribute("stroke-linecap", "round"); tail.setAttribute("stroke-opacity", "0.4");
          tail.setAttribute("class", "comet-tail");
          node.appendChild(tail);
        }

        const halo = document.createElementNS(NS, "circle");
        halo.setAttribute("cx", p.x.toFixed(1));
        halo.setAttribute("cy", p.y.toFixed(1));
        halo.setAttribute("r", (discR + 4).toFixed(1));
        halo.setAttribute("class", "planet-halo");
        halo.setAttribute("fill", col);
        node.appendChild(halo);

        const disc = document.createElementNS(NS, "circle");
        disc.setAttribute("cx", p.x.toFixed(1));
        disc.setAttribute("cy", p.y.toFixed(1));
        disc.setAttribute("r", discR);
        disc.setAttribute("class", "planet-disc");
        disc.setAttribute("fill", col);
        node.appendChild(disc);

        const glyph = document.createElementNS(NS, "text");
        glyph.setAttribute("x", p.x.toFixed(1));
        glyph.setAttribute("y", (p.y + discR * 0.42).toFixed(1));
        glyph.setAttribute("class", "planet-glyph");
        glyph.setAttribute("font-size", Math.round(discR * 1.25));
        glyph.textContent = glyphCh;
        node.appendChild(glyph);

        const tip = document.createElementNS(NS, "title");
        const role = p.body === 10 ? "comet — the wounded healer" : "planetary agent";
        let ritualText = "";
        if (state.player && state.rituals) {
          const rit = state.rituals[`planet_${p.body}`];
          if (rit) {
            ritualText = `\n✦ Ritual: ${rit.description} (${rit.chain.length}/${rit.cardsNeeded} spent)`;
          }
        }
        tip.textContent = `${nameCh} — ${role} of ${SIGN_GLYPHS[p.sign]} ${SIGN_NAMES[p.sign]} ${Math.floor(p.eclLon % 30)}° · alt ${Math.round(p.alt)}° · transiting ${zoneName}${ritualText} · tap to open or drag card here`;
        node.appendChild(tip);

        // Drag and drop events
        node.addEventListener("dragover", (e) => {
          e.preventDefault();
          node.classList.add("drag-over");
        });
        node.addEventListener("dragleave", () => {
          node.classList.remove("drag-over");
        });
        node.addEventListener("drop", (e) => {
          e.preventDefault();
          node.classList.remove("drag-over");
          const cardId = parseInt(e.dataTransfer.getData("text/plain"));
          if (!isNaN(cardId)) {
            playCardIntoRitual(cardId, "planet", p.body);
          }
        });

        node.onclick = (e) => {
          e.stopPropagation();
          // Tap fallback: if exactly 1 card selected, play it into the planet ritual!
          if (state.player && state.selectedCards.size === 1) {
            const cardId = Array.from(state.selectedCards)[0];
            playCardIntoRitual(cardId, "planet", p.body);
            state.selectedCards.clear();
            renderActiveHand();
          } else {
            // Show/select the ritual HUD overlay first, then trigger standard page
            const ritKey = `planet_${p.body}`;
            if (state.player && state.rituals && state.rituals[ritKey]) {
              showRitualOverlay("planet", p.body);
            }
            if (typeof window.openPlanetAgentPage === "function") window.openPlanetAgentPage(p.body);
            else challengePlanetaryAgent(p);
          }
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
      // Tap fallback: if exactly 1 card selected, play it into the zone ritual!
      if (state.player && state.selectedCards.size === 1) {
        const cardId = Array.from(state.selectedCards)[0];
        playCardIntoRitual(cardId, "zone", star.zone);
        state.selectedCards.clear();
        renderActiveHand();
        return;
      }

      state.selectedZone = star.zone;
      state.selectedStarHip = star.hip_id;

      // Select the zone in our ritual overlay
      if (state.player && state.rituals && star.zone !== null) {
        showRitualOverlay("zone", star.zone);
      }

      // Toggle shapes selections
      for (let i = 0; i < 11; i++) {
        const el = document.getElementById(`zone-shape-${i}`);
        if (el) el.classList.toggle("selected", i === star.zone);
      }

      if (window.HologramCamera) {
        HologramCamera.targetYaw = star.az;
        HologramCamera.targetPitch = 0;
        HologramCamera.targetScale = 2.5;
        HologramCamera.isZoomed = true;
        document.getElementById("reset-view-btn").style.display = "inline-flex";
      }

      window.needsFullStarRebuild = true; // reveal faint stars in the zoomed region
      renderZonesList();
      renderStarsNodes();
      updateCombatPreview();
      switchTab("tab-duel");
      synth.playSelect();
    }

    // A star is a "named agent" (its own pentacles page) when it carries a real
    // proper name — not a Bayer/Flamsteed designation or a bare HIP id.
    const GREEK_RE = /^(Alpha|Beta|Gamma|Delta|Epsilon|Zeta|Eta|Theta|Iota|Kappa|Lambda|Mu|Nu|Xi|Omicron|Pi|Rho|Sigma|Tau|Upsilon|Phi|Chi|Psi|Omega)\b/;
    function isNamedStar(name) {
      return !!name && !/^HIP /.test(name) && !GREEK_RE.test(name) && !/\d/.test(name);
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

      const syn = calculateSiegeSynergies();
      const named = isNamedStar(star.name);
      const isHorizon = star.horizonEncounter || (star.alt >= 0 && star.alt <= 15);
      const eclText = star.ecliptic ? star.ecliptic.formatted : "";

      details.innerHTML = `
        <strong>StarDex Node:</strong> <span style="color:var(--gold-bright); font-weight:bold;">${star.name}</span> (Mag ${star.magnitude.toFixed(2)})<br>
        <strong>Horizon Status:</strong> ${isHorizon ? '🌅 ON HORIZON BAND' : `⬆ ABOVE HORIZON (${star.alt.toFixed(1)}° Alt · ${star.az.toFixed(1)}° Az)`}<br>
        ${eclText ? `<strong>Zodiac Ecliptic:</strong> ${eclText}<br>` : ''}
        <strong>Zone Location:</strong> ${zoneName} (Favored Suit: ${suitSign.toUpperCase()})<br>
        <strong>Node Faction Control:</strong> ${ownerStr}<br>
        <strong>Contesting Factions (${contesters.length}):</strong> ${contestersNames}<br>
        <strong>Board Attack Power:</strong> ⚔ <strong style="color:var(--gold-bright);">${syn.totalAtk} ATK</strong> ${syn.multiplier > 1.0 ? `(${syn.baseAtk} × ${syn.multiplier.toFixed(2)})` : ''}
        <div style="margin-top:9px; display:flex; gap:6px; flex-wrap:wrap;">
          ${named ? `<button id="open-star-agent" class="btn" style="padding:5px 11px;font-size:11px;border-color:var(--gold);color:var(--gold-bright);background:transparent;">✦ Commune with ${star.name}</button>` : ""}
          <button id="open-star-dex" class="btn" style="padding:5px 11px;font-size:11px;border-color:var(--gold);color:var(--gold-bright);background:transparent;">⭐ Inspect in Star-Dex</button>
        </div>
      `;
      if (named) {
        const sab = document.getElementById("open-star-agent");
        if (sab) sab.onclick = () => { if (window.openStarAgentPage) window.openStarAgentPage(star.hip_id); };
      }
      const spb = document.getElementById("open-star-dex") || document.getElementById("open-star-pokedex");
      if (spb) spb.onclick = () => {
        if (window.openStarDex) window.openStarDex(star.hip_id);
        else if (window.openStarPokedex) window.openStarPokedex(star.hip_id);
      };

      if (engageable) btn.removeAttribute("disabled");
      else btn.setAttribute("disabled", "true");
    }

    // Expose selectStarByHip helper for external components
    window.selectStarByHip = function (hipId) {
      const hip = Number(hipId);
      const star = state.sky ? state.sky.find((s) => s.hip_id === hip) : null;
      if (star) {
        selectStar(star);
      } else {
        state.selectedStarHip = hip;
        renderZonesList();
        renderStarsNodes();
        updateCombatPreview();
      }
    };

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
      if (!container) return;
      container.innerHTML = "";

      if (state.player && typeof state.ensureStarterDeck === "function") {
        state.ensureStarterDeck();
      }

      (state.collection || []).forEach(c => {
        const slot = (state.deck || []).find(d => Number(d.card_id) === Number(c.card_id));
        const loadout = slot ? (slot.loadout || "bench") : "bench";
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
        if (first.suit === c.suit && first.rank === c.rank && first.is_major === c.is_major) {
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
      if (state && state.natal && state.natal.birthUnix && isMinor(state.natal.birthUnix)) {
        toast("Minor age restriction: Web3 / Token-2022 wallet binding requires verified parental consent under NY SAFE Kids Act.", { type: "warn" });
        return;
      }

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
      renderPoolsPanel();
    }

    // Init Page setup
    document.addEventListener("DOMContentLoaded", () => {
      initHologramControls();
      requestAnimationFrame(animateFrame);

      // Explicitly attach click handlers to onboarding action buttons
      const startBtn = document.getElementById("ob-start-btn");
      if (startBtn) {
        startBtn.addEventListener("click", (e) => {
          e.preventDefault();
          calculateNatalOnboarding();
        });
      }

      const confirmBtn = document.getElementById("faction-confirm-btn");
      if (confirmBtn) {
        confirmBtn.addEventListener("click", (e) => {
          e.preventDefault();
          confirmFactionOnboarding();
        });
      }

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

    // ---- DRAG AND DROP RITUAL PLAY HANDLERS ----
    window.draggedCardId = null;
    window.activeRitualTarget = null; // { type, id }

    window.handleCardDragStart = function(event, cardId) {
      event.dataTransfer.setData("text/plain", cardId);
      event.dataTransfer.effectAllowed = "move";
      event.target.classList.add("dragging");
      
      // Highlight valid drop targets
      document.querySelectorAll(".planet-node, .zone-shape, .star-node-dot").forEach(el => {
        el.classList.add("potential-target");
      });
      
      window.draggedCardId = cardId;
      window.draggingCardId = cardId;
    };

    window.handleCardDragEnd = function(event, cardId) {
      event.target.classList.remove("dragging");
      document.querySelectorAll(".planet-node, .zone-shape, .star-node-dot").forEach(el => {
        el.classList.remove("potential-target", "drag-over");
      });
      window.draggedCardId = null;
      window.draggingCardId = null;
    };

    window.playCardIntoRitual = function(cardId, targetType, targetId) {
      // LIVE: a card dragged onto a STAR or ZONE executes an instant raid strike or deploy
      const net = window.Pentacles && window.Pentacles.net;
      if ((targetType === "star" || targetType === "hip") && net && net.isLive && window.Pentacles.deploy && window.Pentacles.deploy.strikeStarSingleLive) {
        if (synth.playSelect) synth.playSelect();
        window.Pentacles.deploy.strikeStarSingleLive(targetId, cardId)
          .then((r) => {
            if (r && r.ok === false) return;
            toast(`Instant Raid Strike launched against Star HIP ${targetId}! Chipping away at control threshold...`, { type: "success", title: "Star Strike" });
            renderActiveHand();
          })
          .catch((e) => toast((e && e.message) || "Star strike failed", { type: "error", title: "Star Strike" }));
        return;
      }
      if (targetType === "zone" && net && net.isLive && window.Pentacles.deploy) {
        if (synth.playSelect) synth.playSelect();
        window.Pentacles.deploy.deployCardLive(cardId, targetId)
          .then((r) => {
            if (r && r.ok === false) return;
            toast(`Deployed to Zone ${targetId} — your faction pushes the meter and the card joins the garrison.`, { type: "success", title: "Faction War" });
            renderActiveHand();
          })
          .catch((e) => toast((e && e.message) || "Deploy failed", { type: "error", title: "Faction War" }));
        return;
      }
      const result = state.playCardIntoRitual(cardId, targetType, targetId);
      if (result.error) {
        toast(result.error, { type: "warn", title: "Ritual Chain" });
        if (synth.playSelect) synth.playSelect();
        return;
      }

      // Refresh hand
      renderActiveHand();
      
      const key = `${targetType}_${targetId}`;
      const ritual = state.rituals[key];
      
      if (synth.playSelect) synth.playSelect();

      // Log to combat log
      const consoleEl = document.getElementById("combat-log-console");
      if (consoleEl) {
        const targetName = targetType === "planet" ? PLANET_NAMES[targetId] : `Zone ${targetId}`;
        const card = state.collection.find(c => c.card_id === cardId) || ritual.chain[ritual.chain.length - 1];
        const cardName = card ? card.title : "Card";
        consoleEl.innerHTML += `<div class="log-line system">[Ritual] Played ${cardName} (Letter ${card ? card.letter : '?'}) into ${targetName} chain! (${ritual.chain.length}/${ritual.cardsNeeded})</div>`;
        consoleEl.scrollTop = consoleEl.scrollHeight;
      }

      // If completed, show rewards
      if (result.completed && result.reward) {
        const rew = result.reward;
        if (synth.playWin) synth.playWin();
        
        const cardList = (rew.cards || (rew.card ? [rew.card] : [])).filter(Boolean);
        const cardText = cardList.map(c => `<b>${c.title}</b> (Lv ${c.level}, ⚔ ${c.attack} ♥ ${c.health})`).join(", ");

        if (consoleEl) {
          consoleEl.innerHTML += `<div class="log-line victory">🌟 Zone Gate Breached for ${targetType === "planet" ? PLANET_NAMES[targetId] : `Zone ${targetId}`} in ${rew.zoneName}!</div>`;
          consoleEl.innerHTML += `<div class="log-line victory">✦ Yielded +${rew.pentaclesYield || 0} Pentacles & Faction gains +500 Control!</div>`;
          consoleEl.innerHTML += `<div class="log-line victory">✦ Earned +${rew.tokens} Tokens!</div>`;
          if (cardText) {
            consoleEl.innerHTML += `<div class="log-line victory">✦ Synthesized Card(s): ${cardText} added to your Active Hand!</div>`;
          }
          consoleEl.scrollTop = consoleEl.scrollHeight;
        }

        const cardSummary = cardList.length > 0 ? ` + ${cardList.length} Synthesized Card(s)` : "";
        toast(`Zone Gate Breached! Yielded +${rew.pentaclesYield || 0} Pentacles${cardSummary}!`, { type: "success", title: "Zone Gate Breached" });
        
        renderLeaderboard();
        renderZonesList();
        renderStarsNodes();
        renderPoolsPanel();
      }

      // Update the active Ritual UI Panel
      updateActiveRitualPanel(targetType, targetId);
    };

    window.showRitualOverlay = function(targetType, targetId) {
      window.activeRitualTarget = { type: targetType, id: targetId };
      const overlay = document.getElementById("ritual-hud-overlay");
      if (!overlay) return;
      
      overlay.style.display = "flex";
      updateActiveRitualPanel(targetType, targetId);
    };

    window.resetActiveRitual = function() {
      if (!window.activeRitualTarget) return;
      const { type, id } = window.activeRitualTarget;
      state.resetRitualChain(type, id);
      
      renderActiveHand();
      updateActiveRitualPanel(type, id);
      if (synth.playClick) synth.playClick();
      
      const consoleEl = document.getElementById("combat-log-console");
      if (consoleEl) {
        const targetName = type === "planet" ? PLANET_NAMES[id] : `Zone ${id}`;
        consoleEl.innerHTML += `<div class="log-line system">[Ritual] Cleared chain for ${targetName}.</div>`;
        consoleEl.scrollTop = consoleEl.scrollHeight;
      }
    };

    window.initSingularityShaderCanvas = function(canvas) {
      if (!canvas || canvas.dataset.initialized) return;
      canvas.dataset.initialized = "true";

      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return;

      function syncSize() {
        const rect = canvas.getBoundingClientRect();
        const w = Math.max(120, rect.width || 320);
        const h = Math.max(120, rect.height || 320);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
      }
      syncSize();

      const vs = `attribute vec2 a_position;
varying vec2 v_texCoord;
void main() {
  v_texCoord = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
      const fs = `precision highp float;
uniform float u_time;
uniform vec2 u_resolution;

varying vec2 v_texCoord;

void main() {
    vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
    float dist = length(uv);
    
    // Gravitational Lensing effect
    float distort = 1.0 / (dist + 0.1);
    vec2 distortedUv = uv * (1.0 + 0.05 * sin(dist * 10.0 - u_time * 2.0) * distort);
    float dist2 = length(distortedUv);

    // Singularity Core (The Black Hole)
    float core = smoothstep(0.35, 0.34, dist2);
    
    // Accretion Disk (Rotating Glow)
    float angle = atan(distortedUv.y, distortedUv.x);
    float disk = smoothstep(0.7, 0.35, dist2) * smoothstep(0.34, 0.45, dist2);
    disk *= 0.5 + 0.5 * sin(angle * 3.0 + u_time * 1.5 + dist2 * 5.0);
    
    // Photon Sphere Ring (Gold Accents)
    float ring = smoothstep(0.01, 0.0, abs(dist2 - 0.48 + 0.02 * sin(u_time * 4.0 + angle * 5.0)));
    
    // Event Horizon Particles (Shimmer)
    float particles = 0.0;
    for(float i = 0.0; i < 3.0; i++) {
        float t = u_time * (0.5 + i * 0.2);
        float r = 0.5 + 0.1 * sin(t + angle * (2.0 + i));
        particles += smoothstep(0.02, 0.0, abs(dist2 - r)) * (0.3 / (dist2 + 0.5));
    }

    vec3 backgroundColor = vec3(0.02, 0.023, 0.047);
    vec3 goldColor = vec3(0.847, 0.706, 0.416);
    vec3 glowColor = vec3(0.4, 0.3, 0.1);
    
    vec3 color = backgroundColor;
    color = mix(color, glowColor * 1.5, disk);
    color = mix(color, goldColor, ring * 0.8);
    color = mix(color, goldColor, particles * 0.5);
    color *= (1.0 - core);
    
    gl_FragColor = vec4(color, 1.0);
}`;

      function cs(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        return s;
      }
      const prog = gl.createProgram();
      gl.attachShader(prog, cs(gl.VERTEX_SHADER, vs));
      gl.attachShader(prog, cs(gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(prog);
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
      const pos = gl.getAttribLocation(prog, 'a_position');
      gl.enableVertexAttribArray(pos);
      gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

      const uTime = gl.getUniformLocation(prog, 'u_time');
      const uRes = gl.getUniformLocation(prog, 'u_resolution');

      function render(t) {
        if (!document.body.contains(canvas)) return;
        syncSize();
        gl.viewport(0, 0, canvas.width, canvas.height);
        if (uTime) gl.uniform1f(uTime, t * 0.001);
        if (uRes) gl.uniform2f(uRes, canvas.width, canvas.height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        requestAnimationFrame(render);
      }
      requestAnimationFrame(render);
    };

    window.updateActiveRitualPanel = function(targetType, targetId) {
      const overlay = document.getElementById("ritual-hud-overlay");
      if (!overlay) return;
      
      const key = `${targetType}_${targetId}`;
      let ritual = state.rituals ? state.rituals[key] : null;
      if (!ritual || state.isObsoleteRitual(ritual)) {
        ritual = state.generateProceduralRitual(targetType, targetId);
        if (state.rituals) state.rituals[key] = ritual;
      }
      if (!ritual) {
        overlay.style.display = "none";
        return;
      }

      const melee = ritual.melee;
      if (!melee) return;

      const Engine = window.ArcanaTrickEngine || globalThis.ArcanaTrickEngine;
      const sigil = targetType === "planet" ? PLANET_GLYPHS[targetId] : "✦";
      const name = targetType === "planet" ? `${PLANET_NAMES[targetId]} Alignment Melee` : `Zone ${targetId} Gate Melee`;
      const titleColor = targetType === "planet" ? PLANET_COLORS[targetId] : "var(--gold-bright)";
      const trumpSuitCap = (melee.trumpSuit || "wands").toUpperCase();
      const trumpGlyph = SUIT_GLYPHS[melee.trumpSuit] || "✦";

      // If Melee completed, show Climax / Post-Match Summary Screen
      if (melee.status === "completed") {
        const isWin = melee.outcome === "player_win";
        const rew = ritual.lastReward || null;
        overlay.className = "ritual-hud-overlay melee-hud-container";
        overlay.innerHTML = `
          <div class="ritual-header">
            <div class="ritual-target-info">
              <span class="ritual-target-sigil" style="color: ${titleColor};">${sigil}</span>
              <span class="ritual-target-title" style="color: ${titleColor};">${name}</span>
            </div>
            <button class="btn btn-reset-ritual" onclick="resetActiveRitual()">Rematch</button>
          </div>

          <div style="text-align:center; padding: 16px 8px;">
            <div style="font-size:24px; font-weight:bold; font-family:var(--display); color:${isWin ? '#ffd700' : '#f26262'}; text-shadow:0 0 20px ${isWin ? 'rgba(255,215,0,0.6)' : 'rgba(242,98,98,0.6)'};">
              ${isWin ? '👑 ZONE GATE BREACHED — VICTORY' : '⚔ GUARDIAN REPUDIATION — DEFEAT'}
            </div>
            <div style="font-size:12px; color:var(--dim); margin-top:4px;">
              ${isWin ? 'You have triumphed across the 12-trick Melee and seized control of the zone!' : 'The Zone Guardian defended the threshold. Restructure your loadout and challenge again.'}
            </div>

            <div style="display:flex; justify-content:center; gap:24px; margin:16px 0;">
              <div style="text-align:center;">
                <span style="font-size:11px; color:var(--dim); text-transform:uppercase; display:block;">Your Final Score</span>
                <span style="font-size:24px; font-weight:bold; color:#ffd700; font-family:var(--font-mono);">${melee.playerScore}</span>
                <span style="font-size:10px; color:var(--dim); display:block;">(${melee.playerTricksWon} Tricks Won)</span>
              </div>
              <div style="font-size:20px; align-self:center; color:var(--dim);">VS</div>
              <div style="text-align:center;">
                <span style="font-size:11px; color:var(--dim); text-transform:uppercase; display:block;">Guardian Score</span>
                <span style="font-size:24px; font-weight:bold; color:#f26262; font-family:var(--font-mono);">${melee.guardianScore}</span>
                <span style="font-size:10px; color:var(--dim); display:block;">(${melee.guardianTricksWon} Tricks Won)</span>
              </div>
            </div>

            ${isWin ? `
              <div style="background:rgba(216,180,106,0.1); border:1px solid rgba(216,180,106,0.3); border-radius:8px; padding:10px; font-size:11.5px; color:var(--gold-bright); margin-bottom:12px;">
                ✦ Yielded <b>+500 Tokens</b> · Zone Control <b>+500</b> · Synthesized Spoils in Deck
              </div>
            ` : ''}

            <button class="btn btn-primary" style="padding:8px 24px; font-size:12px; font-weight:bold;" onclick="resetActiveRitual()">
              Challenge Again
            </button>
          </div>
        `;
        return;
      }

      // Live Melee Active Stage
      const playerLegalMoves = Engine ? Engine.getLegalMoves(
        melee.playerHand,
        melee.ledSuit,
        melee.trumpSuit,
        melee.currentTrick,
        melee.arcanaLadder
      ) : melee.playerHand.map(c => ({ card: c, legal: true }));

      // Melds pills HTML
      let meldsHTML = "";
      if (melee.playerMelds && melee.playerMelds.length > 0) {
        meldsHTML = melee.playerMelds.map(m => `<span class="melee-meld-pill" title="${m.name}">✦ ${m.name} (+${m.value})</span>`).join("");
      } else {
        meldsHTML = `<span style="color:var(--dim); font-size:10px;">No starting melds detected in hand</span>`;
      }

      // Trick cards played on table
      const playerPlayed = melee.currentTrick.find(t => t.player === "player");
      const guardianPlayed = melee.currentTrick.find(t => t.player === "guardian");

      function renderTrickSlot(play, label) {
        if (play && play.card) {
          const c = play.card;
          const cSuit = c.suit || "wands";
          const glyph = SUIT_GLYPHS[cSuit] || "✦";
          const isTrump = c.suit && c.suit.toLowerCase() === (melee.trumpSuit || "").toLowerCase();
          const pot = c.is_major && melee.arcanaLadder ? (melee.arcanaLadder[c.rank] || 50) : null;
          return `
            <div class="melee-trick-card-slot played ${cSuit}">
              <span style="font-size:9px; color:var(--dim); text-transform:uppercase;">${label}</span>
              <span style="font-size:18px; margin:2px 0;">${glyph}</span>
              <span style="font-size:11px; font-weight:bold; color:${c.is_major ? '#ffd700' : (isTrump ? 'var(--gold-bright)' : '#fff')}; text-align:center; padding:0 2px; line-height:1.1;">
                ${c.is_major ? c.title : `${rankName(c.rank)}`}
              </span>
              ${pot !== null ? `<span class="melee-potency-badge">⚡${pot}</span>` : ''}
              <span style="font-size:9px; color:var(--dim); margin-top:2px;">${Engine ? Engine.counterValue(c) : 0} pts</span>
            </div>
          `;
        }
        return `
          <div class="melee-trick-card-slot">
            <span style="font-size:9px; color:var(--dim); text-transform:uppercase;">${label}</span>
            <span style="font-size:18px; color:rgba(216,180,106,0.2); margin:4px 0;">✦</span>
            <span style="font-size:10px; color:var(--dim);">Awaiting Play</span>
          </div>
        `;
      }

      // Turn instructions banner
      let turnInstruction = "";
      if (melee.currentTrick.length === 0) {
        turnInstruction = `✦ YOUR LEAD: Play any Minor Card or Major Arcana from your hand`;
      } else if (melee.ledSuit) {
        const hasLedMinor = melee.playerHand.some(c => !c.is_major && c.suit && c.suit.toLowerCase() === melee.ledSuit.toLowerCase());
        if (hasLedMinor) {
          turnInstruction = `⚔ MUST FOLLOW SUIT: Guardian led ${melee.ledSuit.toUpperCase()}. You must play a ${melee.ledSuit.toUpperCase()} Minor!`;
        } else {
          turnInstruction = `⚡ VOID IN ${melee.ledSuit.toUpperCase()}: Play Zone Trump (${trumpSuitCap}) or any Major Arcana!`;
        }
      } else {
        turnInstruction = `⚡ ARCANA LEAD: Follow with a Major Arcana or slough a Minor if void`;
      }

      if (melee.trickNumber === 12) {
        turnInstruction += ` <b style="color:#ffd700;">(✦ FINAL TRICK: +10 CLIMAX BONUS)</b>`;
      }

      // Player hand chips HTML
      let handHTML = "";
      for (const opt of playerLegalMoves) {
        const c = opt.card;
        const legal = opt.legal;
        const reason = opt.reason || "Illegal move";
        const cSuit = c.suit || "wands";
        const glyph = SUIT_GLYPHS[cSuit] || "✦";
        const isTrump = c.suit && c.suit.toLowerCase() === (melee.trumpSuit || "").toLowerCase();
        const pot = c.is_major && melee.arcanaLadder ? (melee.arcanaLadder[c.rank] || 50) : null;
        const counters = Engine ? Engine.counterValue(c) : 0;

        handHTML += `
          <div class="melee-card-chip ${legal ? 'legal' : 'illegal'} ${cSuit}"
               data-reason="${reason}"
               ${legal ? `onclick="window.playCardIntoRitual(${c.card_id}, '${targetType}', ${targetId})"` : ''}
               title="${legal ? 'Click to Play' : reason}">
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
              <span style="font-size:11px;">${glyph}</span>
              ${counters > 0 ? `<span style="font-size:8.5px; font-weight:bold; color:#ffd700;">★${counters}</span>` : ''}
            </div>
            <div style="font-size:10px; font-weight:bold; text-align:center; line-height:1.1; color:${c.is_major ? '#ffd700' : (isTrump ? 'var(--gold-bright)' : '#fff')};">
              ${c.is_major ? c.title : rankName(c.rank)}
            </div>
            <div style="font-size:8.5px; color:var(--dim); display:flex; justify-content:space-between; width:100%;">
              <span>${c.is_major ? 'Major' : (isTrump ? 'TRUMP' : cSuit)}</span>
              ${pot !== null ? `<span style="color:#ffd700; font-weight:bold;">⚡${pot}</span>` : `<span>⚔${c.attack || 5}</span>`}
            </div>
          </div>
        `;
      }

      overlay.className = "ritual-hud-overlay melee-hud-container";
      overlay.innerHTML = `
        <div class="ritual-header">
          <div class="ritual-target-info">
            <span class="ritual-target-sigil" style="color: ${titleColor};">${sigil}</span>
            <span class="ritual-target-title" style="color: ${titleColor};">${name}</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:11px; font-weight:bold; color:var(--gold-bright); background:rgba(216,180,106,0.15); padding:2px 8px; border-radius:4px; border:1px solid rgba(216,180,106,0.3);">
              TRUMP: ${trumpGlyph} ${trumpSuitCap}
            </span>
            <button class="btn btn-reset-ritual" onclick="resetActiveRitual()">Reset Table</button>
          </div>
        </div>

        <!-- Scoreboard Strip -->
        <div class="melee-scoreboard">
          <div class="melee-player-score">
            <span class="melee-score-label">You (Seeker)</span>
            <span class="melee-score-val">${melee.playerScore}</span>
            <span style="font-size:9.5px; color:var(--dim);">${melee.playerTricksWon} Tricks Won</span>
          </div>

          <div class="melee-trick-badge">
            <div class="melee-trick-num">TRICK ${melee.trickNumber} / 12</div>
            <div style="font-size:9.5px; color:var(--dim);">
              ${melee.ledSuit ? `Led: <b style="color:#fff; text-transform:uppercase;">${melee.ledSuit}</b>` : 'Open Lead'}
            </div>
          </div>

          <div class="melee-guardian-score" style="text-align:right;">
            <span class="melee-score-label">Zone Guardian ${melee.guardianHandicap > 0 ? `(+${melee.guardianHandicap})` : ''}</span>
            <span class="melee-score-val" style="color:#f26262;">${melee.guardianScore}</span>
            <span style="font-size:9.5px; color:var(--dim);">${melee.guardianTricksWon} Tricks Won</span>
          </div>
        </div>

        <!-- Dynamic Turn Action Banner -->
        <div class="melee-turn-banner">
          ${turnInstruction}
        </div>

        <!-- Celestial Singularity Trick Arena Ring -->
        <div class="melee-arena-ring">
          ${renderTrickSlot(playerPlayed, "Your Play")}

          <!-- Central WebGL Singularity Core -->
          <div class="melee-center-core">
            <canvas id="singularity-shader-canvas" style="width:100%; height:100%; display:block;"></canvas>
          </div>

          ${renderTrickSlot(guardianPlayed, "Guardian")}
        </div>

        <!-- Melds Strip -->
        <div style="display:flex; flex-direction:column; gap:3px;">
          <span style="font-size:9.5px; font-weight:bold; color:var(--dim); text-transform:uppercase; letter-spacing:0.5px;">Your Melds & Honours</span>
          <div class="melee-melds-strip">
            ${meldsHTML}
          </div>
        </div>

        <!-- Player Active Hand Strip -->
        <div style="display:flex; flex-direction:column; gap:3px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:9.5px; font-weight:bold; color:var(--dim); text-transform:uppercase; letter-spacing:0.5px;">Your Hand (${melee.playerHand.length} Cards)</span>
            <span style="font-size:9.5px; color:var(--gold-bright);">Click any glowing card to play</span>
          </div>
          <div class="melee-hand-row">
            ${handHTML}
          </div>
        </div>
      `;

      // Initialize WebGL shader canvas
      setTimeout(() => {
        const cvs = document.getElementById("singularity-shader-canvas");
        if (cvs && window.initSingularityShaderCanvas) {
          window.initSingularityShaderCanvas(cvs);
        }
      }, 20);
    };

// ── LEGAL COMPLIANCE & PRIVACY REMEDIATION API ────────────────────────────
function isMinor(birthUnix) {
  if (!birthUnix) return false;
  const ageSecs = (Date.now() / 1000) - birthUnix;
  return ageSecs < (18 * 365.25 * 86400);
}

let pendingGeoAllowCb = null;
let pendingGeoFixedCb = null;

function requestGeolocationConsent(onAllow, onFixed) {
  const consent = localStorage.getItem("pentacles_location_consent");
  if (consent === "granted") {
    if (onAllow) onAllow();
  } else if (consent === "denied") {
    if (onFixed) onFixed();
  } else {
    pendingGeoAllowCb = onAllow;
    pendingGeoFixedCb = onFixed;
    const modal = document.getElementById("geolocation-consent-modal");
    if (modal) modal.style.display = "flex";
  }
}

function setGeolocationConsent(status) {
  try {
    localStorage.setItem("pentacles_location_consent", status);
  } catch (e) {}
  const modal = document.getElementById("geolocation-consent-modal");
  if (modal) modal.style.display = "none";

  if (status === "granted") {
    if (typeof toast === "function") toast("Live Geolocation granted. Horizon anchored to your position.", { type: "info" });
    if (pendingGeoAllowCb) {
      pendingGeoAllowCb();
      pendingGeoAllowCb = null;
    }
  } else {
    if (typeof toast === "function") toast("Fixed sky view selected. Using default horizon coordinates.", { type: "info" });
    if (pendingGeoFixedCb) {
      pendingGeoFixedCb();
      pendingGeoFixedCb = null;
    }
  }
}

async function deleteSeekerIdentity() {
  if (!confirm("Are you sure you want to delete your Seeker identity & on-chain links? This action is permanent and irreversible under GDPR Art. 17 (Right to Erasure).")) {
    return;
  }

  try {
    const net = window.Pentacles && window.Pentacles.net;
    if (net && net.isLive && typeof net.callReducer === "function") {
      await net.callReducer("delete_player_data", []);
    }

    const activeHandle = localStorage.getItem("pentacles_active_profile");
    if (activeHandle) {
      localStorage.removeItem(`pentacles_save_${activeHandle}`);
    }
    localStorage.removeItem("pentacles_active_profile");
    localStorage.removeItem("pentacles_profiles_list");
    localStorage.removeItem("pentacles_astral_key");

    if (typeof toast === "function") toast("Seeker identity & on-chain links permanently deleted.", { type: "info" });
    if (typeof closeSignInModal === "function") closeSignInModal();
    setTimeout(() => {
      window.location.reload();
    }, 1200);
  } catch (e) {
    console.error("Right to erasure request failed:", e);
    if (typeof toast === "function") toast("Erasure request failed: " + (e.message || e), { type: "warn" });
  }
}

function getLocalStorageConsent() {
  return localStorage.getItem("pentacles_storage_consent") !== "denied";
}

function toggleLocalStorageConsent() {
  const current = getLocalStorageConsent();
  const nextStatus = current ? "denied" : "granted";
  try {
    localStorage.setItem("pentacles_storage_consent", nextStatus);
  } catch (e) {}

  const btn = document.getElementById("storage-consent-toggle-btn");
  if (nextStatus === "denied") {
    if (btn) {
      btn.innerText = "✦ Storage Consent: Disabled";
      btn.style.color = "#ff6b6b";
    }
    const activeHandle = localStorage.getItem("pentacles_active_profile");
    if (activeHandle) {
      localStorage.removeItem(`pentacles_save_${activeHandle}`);
    }
    localStorage.removeItem("pentacles_profiles_list");
    localStorage.removeItem("pentacles_astral_key");
    if (typeof toast === "function") toast("Local storage persistence disabled & cached credentials purged.", { type: "info" });
  } else {
    if (btn) {
      btn.innerText = "✦ Storage Consent: Active";
      btn.style.color = "var(--gold-bright)";
    }
    if (typeof toast === "function") toast("Local storage persistence enabled.", { type: "info" });
  }
}

window.isMinor = isMinor;
window.requestGeolocationConsent = requestGeolocationConsent;
window.setGeolocationConsent = setGeolocationConsent;
window.deleteSeekerIdentity = deleteSeekerIdentity;
window.getLocalStorageConsent = getLocalStorageConsent;
window.toggleLocalStorageConsent = toggleLocalStorageConsent;
window.useMyLocation = useMyLocation;
window.calculateNatalOnboarding = calculateNatalOnboarding;
window.confirmFactionOnboarding = confirmFactionOnboarding;
window.resetCameraView = resetCameraView;
window.toggleSound = toggleSound;
window.toggleARMode = toggleARMode;
window.selectZone = selectZone;
window.allowRitualDrop = allowRitualDrop;
window.handleRitualDrop = handleRitualDrop;
window.switchTab = switchTab;
window.setHandSort = setHandSort;
window.setHandFilter = setHandFilter;
window.cancelFuse = cancelFuse;
window.allowSlotDrop = allowSlotDrop;
window.highlightSlot = highlightSlot;
window.unhighlightSlot = unhighlightSlot;
window.handleSlotDrop = handleSlotDrop;
window.removeCardFromSiegeSlot = removeCardFromSiegeSlot;
window.initiateSiegeStrike = initiateSiegeStrike;
window.switchModalTab = switchModalTab;
window.createNewSeekerProfile = createNewSeekerProfile;
window.closeSignInModal = closeSignInModal;
window.importAstralKey = importAstralKey;
window.connectWeb3Wallet = connectWeb3Wallet;
window.loginWithWeb3Wallet = loginWithWeb3Wallet;
