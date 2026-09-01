/* ============================================================
   PENTACLES — High-Precision Geolocation & Virtual Horizon Tracker
   ============================================================
   Provides continuous high-accuracy GPS tracking (latitude, longitude,
   altitude above sea level, GPS accuracy radius) and real-time device
   gyroscope/motion tracking for virtual horizon alignment, camera
   sky pointing, reticle target locking, and horizon star encounters.
   ============================================================ */

(function (global) {
  "use strict";

  const state = {
    active: false,
    watchId: null,
    gps: {
      lat: 40.7128,
      lon: -74.0060,
      alt_m: 0,
      accuracy_m: null,
      heading: null,
      timestamp: null,
    },
    gyro: {
      alpha: 0, // Heading / compass
      beta: 0,  // Tilt / pitch
      gamma: 0, // Roll
      camAz: 0,
      camAlt: 0,
    },
    reticleTargetStar: null,
    horizonEncounterStars: [],
    listeners: [],
  };

  // ── HIGH-PRECISION GEOLOCATION WATCH ──────────────────────────────────────
  function startGPSWatch(onUpdate) {
    const consent = localStorage.getItem("pentacles_location_consent");
    if (consent === "denied") {
      console.log("GPS Watch skipped: user selected Fixed Sky View.");
      return false;
    }
    if (consent !== "granted") {
      if (global.requestGeolocationConsent) {
        global.requestGeolocationConsent(
          () => startGPSWatch(onUpdate),
          () => {}
        );
      }
      return false;
    }

    if (!navigator.geolocation) {
      if (global.toast) global.toast("Geolocation is unavailable in this browser.", { type: "warn" });
      return false;
    }

    if (state.watchId !== null) return true;

    state.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const coords = pos.coords;
        state.gps.lat = coords.latitude;
        state.gps.lon = coords.longitude;
        state.gps.alt_m = coords.altitude !== null && !isNaN(coords.altitude) ? coords.altitude : 0;
        state.gps.accuracy_m = coords.accuracy;
        state.gps.heading = coords.heading;
        state.gps.timestamp = pos.timestamp;

        // Sync with global Pentacles state
        if (global.state) {
          global.state.observer = {
            lat: coords.latitude,
            lon: coords.longitude,
            alt_m: state.gps.alt_m,
            accuracy_m: coords.accuracy,
          };
          if (global.state.recomputeSky) global.state.recomputeSky();
        }

        // Keep the location current. NY Child Data Protection Act: minors have exact GPS coarsened.
        const isUserMinor = global.isMinor && global.state && global.state.natal && global.isMinor(global.state.natal.birthUnix);
        const sendLat = isUserMinor ? Math.round(coords.latitude * 10) / 10 : coords.latitude;
        const sendLon = isUserMinor ? Math.round(coords.longitude * 10) / 10 : coords.longitude;

        const net = global.Pentacles && global.Pentacles.net;
        if (net && net.isLive && typeof net.callReducer === "function") {
          net.callReducer("set_location", [sendLat, sendLon]).catch(() => {});
        }

        if (onUpdate) onUpdate(state.gps);
        notifyListeners("gps", state.gps);
      },
      (err) => {
        console.warn("GPS watch warning:", err.message);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );

    return true;
  }

  function stopGPSWatch() {
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
  }

  // ── DEVICE ORIENTATION & VIRTUAL HORIZON TRACKER ──────────────────────────
  function requestOrientationPermission(cb) {
    if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
      DeviceOrientationEvent.requestPermission()
        .then((response) => {
          if (response === "granted") {
            startGyroListeners();
            if (cb) cb(true);
          } else {
            if (cb) cb(false);
          }
        })
        .catch((err) => {
          console.error("Orientation permission error:", err);
          if (cb) cb(false);
        });
    } else {
      startGyroListeners();
      if (cb) cb(true);
    }
  }

  function startGyroListeners() {
    window.addEventListener("deviceorientation", handleOrientationEvent, true);
    window.addEventListener("deviceorientationabsolute", handleOrientationEvent, true);
  }

  function handleOrientationEvent(event) {
    // Heading alpha (0=North, 90=East, 180=South, 270=West)
    let alpha = event.alpha || 0;
    if (event.webkitCompassHeading) {
      alpha = event.webkitCompassHeading;
    }

    const beta = event.beta || 0;   // Tilt (-180..+180)
    const gamma = event.gamma || 0; // Roll (-90..+90)

    state.gyro.alpha = alpha;
    state.gyro.beta = beta;
    state.gyro.gamma = gamma;

    // Convert device tilt/heading to sky azimuth & altitude
    const pointing = global.cameraAltAz ? global.cameraAltAz(alpha, beta, gamma) : { camAz: alpha, camAlt: 90 - beta };
    state.gyro.camAz = pointing.camAz;
    state.gyro.camAlt = pointing.camAlt;

    // Update target locking & horizon encounters
    updateReticleAndEncounters();
    notifyListeners("gyro", state.gyro);
  }

  // ── RETICLE TARGET LOCKING & HORIZON ENCOUNTERS ──────────────────────────
  function updateReticleAndEncounters() {
    const sky = global.state ? global.state.sky || [] : [];
    if (!sky.length) return;

    const { camAz, camAlt } = state.gyro;
    const dip = global.horizonDip ? global.horizonDip(state.gps.alt_m) : 0;

    let bestTarget = null;
    let minAngle = 12.0; // 12 degree reticle cone FOV
    const horizonStars = [];

    const rad = Math.PI / 180;
    const camAltRad = camAlt * rad;
    const camAzRad = camAz * rad;

    for (const star of sky) {
      const alt = star.alt;
      const az = star.az;

      // Check if star is in Horizon Encounter Band (0° <= alt <= 15°)
      const appAlt = global.refractedAlt ? global.refractedAlt(alt) : alt;
      if (global.isHorizonEncounter ? global.isHorizonEncounter(appAlt, dip) : (appAlt >= 0 && appAlt <= 15)) {
        horizonStars.push(star);
      }

      // Angular distance calculation between camera vector and star vector
      const starAltRad = alt * rad;
      const starAzRad = az * rad;

      const cosDist = Math.sin(camAltRad) * Math.sin(starAltRad) +
                      Math.cos(camAltRad) * Math.cos(starAltRad) * Math.cos(starAzRad - camAzRad);

      const distDeg = Math.acos(Math.max(-1, Math.min(1, cosDist))) / rad;

      if (distDeg < minAngle) {
        minAngle = distDeg;
        bestTarget = { star, distDeg };
      }
    }

    // Sort horizon stars by brightness (magnitude asc)
    horizonStars.sort((a, b) => a.magnitude - b.magnitude);

    state.reticleTargetStar = bestTarget ? bestTarget.star : null;
    state.horizonEncounterStars = horizonStars;

    notifyListeners("encounter", {
      target: state.reticleTargetStar,
      horizonStars: state.horizonEncounterStars,
    });
  }

  // ── LISTENERS REGISTRATION ────────────────────────────────────────────────
  function addListener(fn) {
    if (typeof fn === "function" && !state.listeners.includes(fn)) {
      state.listeners.push(fn);
    }
  }

  function removeListener(fn) {
    state.listeners = state.listeners.filter((f) => f !== fn);
  }

  function notifyListeners(type, data) {
    for (const fn of state.listeners) {
      try {
        fn(type, data, state);
      } catch (e) {
        console.error("HorizonTracker listener error:", e);
      }
    }
  }

  // ── INITIALIZATION & EXPORTS ──────────────────────────────────────────────
  function init() {
    startGPSWatch();
    startGyroListeners();
  }

  // ── UI CONTROLLER & AR VIEWFINDER BINDINGS ────────────────────────────────
  const HorizonTrackerUI = {
    openStardexForTarget() {
      const star = state.reticleTargetStar || (state.horizonEncounterStars[0] || null);
      if (star) {
        if (global.openStarDex) global.openStarDex(star.hip_id);
        else if (global.openStarPokedex) global.openStarPokedex(star.hip_id);
      }
    },

    siegeEncounteredStar() {
      const star = state.reticleTargetStar || (state.horizonEncounterStars[0] || null);
      if (star) {
        if (global.selectStarByHip) global.selectStarByHip(star.hip_id);
        const zoneId = star.zone !== undefined ? star.zone : (star.region_hint ?? 0);
        if (typeof global.openFactionWar === "function") {
          global.openFactionWar(zoneId);
        } else if (typeof global.openMeleeManifold === "function") {
          global.openMeleeManifold(zoneId);
        }
      }
    },
    executeARHarvest(constellationId, zoneId) {
      const az = Math.round(state.gyro.camAz || 0);
      const alt = Math.round(state.gyro.camAlt || 0);
      const target = state.reticleTargetStar;
      const precision = target ? Math.min(100, Math.max(70, Math.round(100 - (target.distDeg || 0) * 2.5))) : 85;

      const constId = constellationId || (target ? target.conId || 1 : 1);
      const zId = zoneId !== undefined ? zoneId : (target ? target.region_hint || 0 : 0);

      const net = global.Pentacles && global.Pentacles.net;
      const tokensAwarded = precision * 15;

      if (net && net.isLive && typeof net.callReducer === "function") {
        net.callReducer("capture_ar_constellation", [constId, zId, precision, az, alt])
          .then(() => {
            if (global.toast) {
              global.toast(`✨ AR OPTICAL TELEMETRY HARVESTED!\nAZ: ${az}° | ALT: ${alt}° | Precision: ${precision}%\nAwarded +${tokensAwarded} ESMS Tokens & 4X Human Surge!`, { type: "success" });
            }
          })
          .catch((err) => {
            console.warn("AR Harvest Reducer:", err);
            if (global.toast) {
              global.toast(`✨ Virtual AR Telemetry Captured!\nAZ: ${az}° | ALT: ${alt}° | Precision: ${precision}%\n+${tokensAwarded} ESMS Tokens (Offline Simulation)`, { type: "info" });
            }
          });
      } else {
        if (global.toast) {
          global.toast(`✨ Virtual AR Telemetry Captured!\nAZ: ${az}° | ALT: ${alt}° | Precision: ${precision}%\n+${tokensAwarded} ESMS Tokens`, { type: "info" });
        }
      }

      return { azimuth: az, altitude: alt, precision, tokensAwarded };
    },

    toggleVolumetricDeepDive() {
      const currentMode = state.isIndoorMode || false;
      state.isIndoorMode = !currentMode;

      const net = global.Pentacles && global.Pentacles.net;
      const x = parseFloat(((state.gyro.camAz || 0) * 0.5).toFixed(2));
      const y = parseFloat(((state.gyro.camAlt || 0) * 0.5).toFixed(2));
      const z = state.isIndoorMode ? 310.2 : 0.0;
      const layer = state.isIndoorMode ? 3 : 1;

      if (net && net.isLive && typeof net.callReducer === "function") {
        net.callReducer("update_seeker_environment", [state.isIndoorMode, x, y, z, layer])
          .catch((err) => console.warn("Seeker environment reducer:", err));
      }

      if (global.toast) {
        if (state.isIndoorMode) {
          global.toast(`🌌 INDOOR VOLUMETRIC DEEP DIVE ACTIVATED!\nParsec Depth: ${z} pc | Layer 3: Galactic Arm\nState Synced to SpacetimeDB`, { type: "success" });
        } else {
          global.toast(`🌅 OPTICAL SKY HARVEST MODE ACTIVATED!\nGround-Truthing Sensor Network Active`, { type: "info" });
        }
      }

      return state.isIndoorMode;
    },

    updateHUD() {
      const hud = document.getElementById("ar-horizon-hud");
      if (!hud || hud.style.display === "none") return;

      // Compass & GPS status
      const compDeg = document.getElementById("ar-compass-deg");
      if (compDeg) {
        const az = Math.round(state.gyro.camAz);
        const card = az < 22.5 || az >= 337.5 ? "N" : (az < 67.5 ? "NE" : (az < 112.5 ? "E" : (az < 157.5 ? "SE" : (az < 202.5 ? "S" : (az < 247.5 ? "SW" : (az < 292.5 ? "W" : "NW"))))));
        compDeg.textContent = `${card} ${String(az).padStart(3, "0")}° · ALT ${Math.round(state.gyro.camAlt)}°`;
      }

      const gpsTag = document.getElementById("ar-gps-tag");
      if (gpsTag) {
        const acc = state.gps.accuracy_m ? `±${Math.round(state.gps.accuracy_m)}m` : "STATIONARY";
        const elev = state.gps.alt_m ? ` · ELEV ${Math.round(state.gps.alt_m)}m` : "";
        gpsTag.textContent = `GPS ACCURACY ${acc}${elev} · REFRACTED VIRTUAL HORIZON`;
      }

      // Virtual Horizon Line tilt/displacement
      const line = document.getElementById("ar-horizon-line");
      if (line) {
        // Shift line up/down based on pitch tilt (camAlt)
        const shiftY = (state.gyro.camAlt / 90.0) * (window.innerHeight * 0.45);
        const rollDeg = state.gyro.gamma;
        line.style.transform = `translate(-50%, calc(-50% + ${shiftY}px)) rotate(${rollDeg}deg)`;
      }

      // Reticle Label & Target Star
      const target = state.reticleTargetStar;
      const label = document.getElementById("ar-reticle-label");
      const banner = document.getElementById("ar-encounter-banner");

      if (target) {
        if (label) label.innerHTML = `✦ TARGET LOCKED: <strong style="color:var(--gold-bright)">${target.name}</strong> (${target.magnitude.toFixed(1)}m)`;

        if (banner) {
          banner.style.display = "flex";
          const nameEl = document.getElementById("ar-encounter-name");
          const subEl = document.getElementById("ar-encounter-sub");
          if (nameEl) nameEl.textContent = target.name;
          if (subEl) {
            const isHorizon = target.horizonEncounter;
            subEl.textContent = `${target.conName || "Sky"} · ${isHorizon ? "🌅 ON HORIZON" : "⬆ ELEVATED"} · Alt ${target.alt.toFixed(1)}° · Mag ${target.magnitude.toFixed(2)}`;
          }
        }
      } else {
        const encounterStar = state.horizonEncounterStars[0];
        if (label) {
          label.textContent = encounterStar ? `AIM AT HORIZON STAR: ${encounterStar.name}` : "AIM AT SKY / VIRTUAL HORIZON";
        }

        if (encounterStar && banner) {
          banner.style.display = "flex";
          const nameEl = document.getElementById("ar-encounter-name");
          const subEl = document.getElementById("ar-encounter-sub");
          if (nameEl) nameEl.textContent = encounterStar.name;
          if (subEl) subEl.textContent = `${encounterStar.conName || "Sky"} · 🌅 ON HORIZON · Alt ${encounterStar.alt.toFixed(1)}° · Mag ${encounterStar.magnitude.toFixed(2)}`;
        } else if (banner) {
          banner.style.display = "none";
        }
      }
    }
  };

  // ── DESKTOP MANUAL PANNING & ARROW KEY CONTROLS ───────────────────────────
  function manualPan(deltaAz, deltaAlt) {
    let newAz = (state.gyro.camAz || 0) + deltaAz;
    newAz = ((newAz % 360) + 360) % 360;
    const newAlt = Math.max(-90, Math.min(90, (state.gyro.camAlt || 0) + deltaAlt));

    state.gyro.camAz = newAz;
    state.gyro.camAlt = newAlt;

    updateReticleAndEncounters();
    notifyListeners("gyro", state.gyro);
  }

  function resetPan() {
    state.gyro.camAz = 0;
    state.gyro.camAlt = 0;
    updateReticleAndEncounters();
    notifyListeners("gyro", state.gyro);
  }

  // Desktop Mouse Drag & Arrow Keys Listeners
  function attachDesktopViewfinderControls() {
    let isDragging = false;
    let lastX = 0, lastY = 0;

    const hud = document.getElementById("ar-horizon-hud");
    if (!hud) return;

    hud.addEventListener("mousedown", (e) => {
      // Don't drag if clicking buttons
      if (e.target.closest("button") || e.target.closest("input")) return;
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      // Sensitivity factor: 0.3° per pixel
      manualPan(-dx * 0.3, dy * 0.3);
    });

    window.addEventListener("mouseup", () => {
      isDragging = false;
    });

    // Keyboard Arrow Keys Panning
    window.addEventListener("keydown", (e) => {
      const hud = document.getElementById("ar-horizon-hud");
      if (!hud || hud.style.display === "none") return;
      if (["input", "textarea"].includes(document.activeElement.tagName.toLowerCase())) return;

      if (e.key === "ArrowLeft") { manualPan(-4, 0); e.preventDefault(); }
      else if (e.key === "ArrowRight") { manualPan(4, 0); e.preventDefault(); }
      else if (e.key === "ArrowUp") { manualPan(0, 4); e.preventDefault(); }
      else if (e.key === "ArrowDown") { manualPan(0, -4); e.preventDefault(); }
      else if (e.key === "r" || e.key === "R") { resetPan(); }
    });
  }

  // Attach HUD update listener
  addListener(() => {
    HorizonTrackerUI.updateHUD();
  });

  const HorizonTracker = {
    init: () => {
      init();
      attachDesktopViewfinderControls();
    },
    startGPSWatch,
    stopGPSWatch,
    requestOrientationPermission,
    manualPan,
    resetPan,
    addListener,
    removeListener,
    getGPS: () => ({ ...state.gps }),
    getGyro: () => ({ ...state.gyro }),
    getReticleTargetStar: () => state.reticleTargetStar,
    getHorizonEncounterStars: () => [...state.horizonEncounterStars],
    state,
  };

  global.HorizonTracker = HorizonTracker;
  global.HorizonTrackerUI = HorizonTrackerUI;

  // Auto-start tracking on script load
  if (typeof window !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", HorizonTracker.init);
    } else {
      HorizonTracker.init();
    }
  }
})(typeof window !== "undefined" ? window : this);
