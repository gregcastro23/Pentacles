/* ============================================================
   PENTACLES — real-ephemeris natal builder + sky bridge
   ============================================================
   Loads AFTER sky.js / client.js / astro-weather.js and BEFORE app.js
   (classic script, same global scope as those files).

   Two jobs:
   1. window.buildRealNatal(profile, viewDate) — a TRUE natal chart computed
      from the real ephemeris at the stored birth instant + birthplace
      (retires the deterministic seed PRNG for THIS chart). Falls back to
      AstroWeather.natalChart(storedPlacements) when no birth time is on file.
   2. window.PentaclesSky — bridges the celestial `const` data + functions onto
      `window` so the ESM layer (src/main.js → AlchmChart) can read them. The
      data tables are lexical consts, invisible to modules without this seam.
   ============================================================ */
(function () {
  "use strict";

  var AW = window.AstroWeather || null;
  var num = function (v, d) { return typeof v === "number" && isFinite(v) ? v : d; };

  /** Real natal chart from a birth instant, or a labelled stored-placements fallback. */
  function buildRealNatal(profile, viewDate) {
    profile = profile || {};
    var view = viewDate instanceof Date ? viewDate : new Date();
    var birthUnix = num(Number(profile.birth_unix), 0);
    var canReal = birthUnix > 0 && typeof computePlanets === "function" && AW && typeof AW.chartOfMoment === "function";

    if (canReal) {
      var birthDate = new Date(birthUnix * 1000);
      var lat = num(Number(profile.birth_lat), 40.7128);
      var lon = num(Number(profile.birth_lon), -74.006);
      var system = profile.house_system === "WholeSign" ? "whole" : "placidus";
      // The real natal chart IS the live chart of the birth moment at the birthplace.
      var chart = AW.chartOfMoment(lat, lon, birthDate, { system: system });
      chart.frame = "natal";
      chart.accuracy = "real";
      chart.birth = { date: birthDate, lat: lat, lon: lon };
      chart.velDate = birthDate; // applying/separating sampled at the birth instant
      chart.fixed = true;        // natal planets do not move with the scrubber
      return chart;
    }

    // Fallback: the stored (deterministic) placements — clearly labelled so the UI
    // can prompt the seeker to set a birth time for a real chart.
    if (Array.isArray(profile.placements) && AW && typeof AW.natalChart === "function") {
      var c = AW.natalChart(profile, view);
      if (c) { c.accuracy = "stored-placements"; c.velDate = null; c.fixed = true; }
      return c;
    }
    return null;
  }

  // ── star index for footprint math (STAR_CATALOG rows: [hip,name,ra,dec,mag,...]) ──
  var starIndex = null;
  function buildStarIndex() {
    var m = new Map();
    if (typeof STAR_CATALOG !== "undefined") {
      for (var i = 0; i < STAR_CATALOG.length; i++) m.set(STAR_CATALOG[i][0], STAR_CATALOG[i]);
    }
    return m;
  }
  function starByHip(hip) {
    if (!starIndex) starIndex = buildStarIndex();
    return starIndex.get(hip) || null;
  }

  // ── the bridge: expose celestial consts + fns to the ESM layer ─────────────
  // These are lexical `const`s from client.js / constellations.js (same classic
  // global scope as this file), invisible to ES modules without this seam.
  window.PentaclesSky = {
    CONSTELLATIONS: (typeof CONSTELLATIONS !== "undefined") ? CONSTELLATIONS : [],
    starByHip: starByHip,
    ESMS_NAMES: (typeof ESMS_NAMES !== "undefined") ? ESMS_NAMES : ["Spirit", "Essence", "Matter", "Substance"],
    ESMS_GLYPHS: (typeof ESMS_GLYPHS !== "undefined") ? ESMS_GLYPHS : ["🜂", "🜄", "🜃", "🜁"],
    ESMS_COLORS: (typeof ESMS_COLORS !== "undefined") ? ESMS_COLORS : ["#e0a23a", "#4aa3d8", "#5fb37a", "#b98cd6"],
    PLANET_NAMES: (typeof PLANET_NAMES !== "undefined") ? PLANET_NAMES : undefined,
    PLANET_GLYPHS: (typeof PLANET_GLYPHS !== "undefined") ? PLANET_GLYPHS : undefined,
    PLANET_COLORS: (typeof PLANET_COLORS !== "undefined") ? PLANET_COLORS : undefined,
    SIGN_NAMES: (typeof SIGN_NAMES !== "undefined") ? SIGN_NAMES : undefined,
    SIGN_GLYPHS: (typeof SIGN_GLYPHS !== "undefined") ? SIGN_GLYPHS : undefined,
    // functions (already on window, but collected here for one tidy handle)
    equatorialToEcliptic: window.equatorialToEcliptic,
    geocentricEclipticLon: window.geocentricEclipticLon,
    ephJulianDay: window.ephJulianDay,
    computePlanets: window.computePlanets,
    ascendantNow: window.ascendantNow,
    /** Ecliptic longitude (deg) of a body at an instant — the velocity primitive. */
    lonAt: function (body, date) {
      if (typeof geocentricEclipticLon !== "function" || typeof ephJulianDay !== "function") return 0;
      return geocentricEclipticLon(body, ephJulianDay(date));
    },
  };

  window.buildRealNatal = buildRealNatal;
})();
