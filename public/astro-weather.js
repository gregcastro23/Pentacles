/* ============================================================
   PENTACLES — Astrological Weather + Jing kernel
   ============================================================
   A pure-JS port of the chart math in server/src/chart.rs (dignity,
   Placidus/Whole-Sign houses) and the Jing Arena metagame from the
   planetary_agents repo (the 5 elemental duel moves). Reads the live
   ephemeris that sky.js already computes (computePlanets / geocentric-
   EclipticLon), so the agent pages can show each body's exact climate —
   degree · sign · dignity · house · retrograde · aspects — for any
   instant and any observer, in BOTH the mundane (here-and-now) and
   natal (the player's birth chart) frames.

   Loads AFTER client.js (reuses SIGN_RULERS / PLANET_* / ESMS_*) and
   sky.js (reuses the projection + ephemeris), BEFORE app.js. No DOM.
   ============================================================ */

(function () {
  "use strict";

  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const EPS_DEG = (typeof OBLIQUITY_DEG !== "undefined") ? OBLIQUITY_DEG : 23.439291;
  const EPS_R = EPS_DEG * D2R;
  const POLAR_CIRCLE_DEG = 66.5; // Placidus is undefined past the polar circle

  // norm360 / deg2rad come from sky.js; provide fallbacks so this file is
  // robust to load-order surprises during testing.
  const n360 = (typeof norm360 === "function") ? norm360 : (d) => ((d % 360) + 360) % 360;

  // ── Bodies (Chiron is the 11th, idx 10) ──────────────────────────────────
  const NAMES = (typeof PLANET_NAMES !== "undefined") ? PLANET_NAMES
    : ["Sun","Moon","Mercury","Venus","Mars","Jupiter","Saturn","Uranus","Neptune","Pluto"];
  const GLYPHS = (typeof PLANET_GLYPHS !== "undefined") ? PLANET_GLYPHS
    : ["☉","☽","☿","♀","♂","♃","♄","♅","♆","♇"];
  const COLORS = (typeof PLANET_COLORS !== "undefined") ? PLANET_COLORS
    : ["#e8b84b","#cbd0db","#9aa7c4","#d98fb0","#cf4d4d","#cf9a52","#9a937c","#5fb6c4","#6470c8","#8a6aa0"];
  // Chiron is the game's first COMET (95P/Chiron) — its own kind, not a planet.
  const CHIRON = { idx: 10, name: "Chiron", glyph: "☄", color: "#86d6b0", kind: "comet" };

  const SIGN_N = (typeof SIGN_NAMES !== "undefined") ? SIGN_NAMES
    : ["Aries","Taurus","Gemini","Cancer","Leo","Virgo","Libra","Scorpio","Sagittarius","Capricorn","Aquarius","Pisces"];
  const SIGN_G = (typeof SIGN_GLYPHS !== "undefined") ? SIGN_GLYPHS
    : ["♈","♉","♊","♋","♌","♍","♎","♏","♐","♑","♒","♓"];
  // body-index rulers per sign (matches client.js SIGN_RULERS exactly)
  const RULERS = (typeof SIGN_RULERS !== "undefined") ? SIGN_RULERS
    : [4, 3, 2, 1, 0, 2, 3, 9, 5, 6, 7, 8];

  const ELEMENTS = ["Fire", "Earth", "Air", "Water"]; // sign % 4 (triplicity cycle)
  const ELEMENT_OF_SIGN = (sign) => ELEMENTS[((sign % 12) + 12) % 12 % 4];

  function bodyName(idx) { return idx === 10 ? CHIRON.name : (NAMES[idx] || "?"); }
  function bodyGlyph(idx) { return idx === 10 ? CHIRON.glyph : (GLYPHS[idx] || "✦"); }
  function bodyColor(idx) { return idx === 10 ? CHIRON.color : (COLORS[idx] || "#cccccc"); }
  function signOf(eclLon) { return Math.floor(n360(eclLon) / 30) % 12; }
  function degInSign(eclLon) { return n360(eclLon) % 30; }

  // ── Essential dignity (port of chart.rs sign_ruler + the classical
  //    exaltation/detriment/fall table; the full client-side version) ───────
  // Exaltation sign per body (null = no classical exaltation).
  const EXALT_SIGN = [0, 1, 5, 11, 9, 3, 6, null, null, null, null];
  //                 Sun Moon Mer Ven Mar Jup Sat Ura Nep Plu Chiron

  /** Essential dignity of a body in a sign → { score:-5..+5, label, key }. */
  function dignity(body, sign) {
    sign = ((sign % 12) + 12) % 12;
    if (body >= 10) return { score: 0, label: "Peregrine", key: "peregrine" }; // Chiron
    if (RULERS[sign] === body) return { score: 5, label: "Domicile", key: "domicile" };
    if (EXALT_SIGN[body] === sign) return { score: 4, label: "Exaltation", key: "exaltation" };
    if (RULERS[(sign + 6) % 12] === body) return { score: -5, label: "Detriment", key: "detriment" };
    if (EXALT_SIGN[body] != null && (EXALT_SIGN[body] + 6) % 12 === sign)
      return { score: -4, label: "Fall", key: "fall" };
    return { score: 0, label: "Peregrine", key: "peregrine" };
  }

  function rulerOfSign(sign) { return RULERS[((sign % 12) + 12) % 12]; }

  // ── Retrograde (mirrors feeder isRetrograde): geocentric λ now vs a day ago.
  function retrograde(body, date) {
    if (body === 0 || body === 1) return false; // Sun & Moon never retrograde
    if (typeof geocentricEclipticLon !== "function" || typeof ephJulianDay !== "function") return false;
    const jd = ephJulianDay(date);
    const lonNow = geocentricEclipticLon(body, jd);
    const lonPrev = geocentricEclipticLon(body, jd - 1);
    let d = ((lonNow - lonPrev + 540) % 360) - 180; // signed delta in (-180,180]
    return d < 0;
  }

  // ── Houses (port of chart.rs Part A) ─────────────────────────────────────
  function eclLonFromRA(raDeg) {
    const ra = raDeg * D2R;
    return n360(Math.atan2(Math.sin(ra), Math.cos(ra) * Math.cos(EPS_R)) * R2D);
  }
  function semidiurnalArc(lonDeg, phiR) {
    const lon = lonDeg * D2R;
    const decl = Math.asin(Math.sin(EPS_R) * Math.sin(lon));
    let x = -Math.tan(phiR) * Math.tan(decl);
    x = Math.max(-1, Math.min(1, x));
    return Math.acos(x) * R2D;
  }
  function placidusCusp(ramc, phiR, base, frac) {
    let ra = n360(ramc + base);
    for (let i = 0; i < 30; i++) {
      const lon = eclLonFromRA(ra);
      const sd = semidiurnalArc(lon, phiR);
      ra = n360(ramc + base + frac * sd);
    }
    return eclLonFromRA(ra);
  }
  /** Whole-Sign cusps in degrees: each house a whole sign from the rising sign. */
  function wholeSignHouses(ascDeg) {
    const rising = Math.floor(n360(ascDeg) / 30) % 12;
    const c = [];
    for (let h = 0; h < 12; h++) c.push(((rising + h) % 12) * 30);
    return c;
  }
  /** Placidus cusps (deg, cusp[0]=Asc, cusp[9]=MC); Whole-Sign past the poles. */
  function placidusHouses(ascDeg, mcDeg, latDeg) {
    if (Math.abs(latDeg) > POLAR_CIRCLE_DEG) return wholeSignHouses(ascDeg);
    const phiR = latDeg * D2R;
    const mcR = mcDeg * D2R;
    // Recover RAMC from MC: tan(RAMC) = tan(MC)·cosε.
    const ramc = n360(Math.atan2(Math.sin(mcR) * Math.cos(EPS_R), Math.cos(mcR)) * R2D);
    const c11 = placidusCusp(ramc, phiR, 0, 1 / 3);
    const c12 = placidusCusp(ramc, phiR, 0, 2 / 3);
    const c2 = placidusCusp(ramc, phiR, 60, 2 / 3);
    const c3 = placidusCusp(ramc, phiR, 120, 1 / 3);
    const c = new Array(12);
    c[0] = n360(ascDeg);          // 1 Asc
    c[1] = c2;                    // 2
    c[2] = c3;                    // 3
    c[3] = n360(mcDeg + 180);     // 4 IC
    c[4] = n360(c11 + 180);       // 5
    c[5] = n360(c12 + 180);       // 6
    c[6] = n360(ascDeg + 180);    // 7 Desc
    c[7] = n360(c2 + 180);        // 8
    c[8] = n360(c3 + 180);        // 9
    c[9] = n360(mcDeg);           // 10 MC
    c[10] = c11;                  // 11
    c[11] = c12;                  // 12
    return c;
  }
  /** Which house (1..12) a longitude falls in, given 12 ordered cusps (deg). */
  function houseOf(eclLon, cusps) {
    const x = n360(eclLon);
    for (let h = 0; h < 12; h++) {
      const a = cusps[h], b = cusps[(h + 1) % 12];
      const span = n360(b - a) || 360;
      const off = n360(x - a);
      if (off < span) return h + 1;
    }
    return 1;
  }
  /** Midheaven ecliptic degree for an observer at `date` (east-lon positive). */
  function mcDeg(date, lonDeg) {
    if (typeof lstDeg !== "function") return 0;
    return eclLonFromRA(lstDeg(date, lonDeg)); // RAMC == LST
  }
  /** Ascendant ecliptic degree (wraps sky.js ascendantNow). */
  function ascendantDeg(latDeg, lonDeg, date) {
    if (typeof ascendantNow !== "function") return 0;
    return ascendantNow(latDeg, lonDeg, date).lambda;
  }

  // ── Aspects ──────────────────────────────────────────────────────────────
  const ASPECTS = [
    { type: "conjunction", angle: 0, glyph: "☌", orb: 8 },
    { type: "sextile", angle: 60, glyph: "⚹", orb: 4 },
    { type: "square", angle: 90, glyph: "□", orb: 6 },
    { type: "trine", angle: 120, glyph: "△", orb: 6 },
    { type: "opposition", angle: 180, glyph: "☍", orb: 8 },
  ];
  /** All major aspects among an array of {body, eclLon} positions. */
  function aspectsAmong(positions) {
    const out = [];
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        let sep = Math.abs(n360(positions[i].eclLon) - n360(positions[j].eclLon));
        if (sep > 180) sep = 360 - sep;
        for (const asp of ASPECTS) {
          const orb = Math.abs(sep - asp.angle);
          if (orb <= asp.orb) {
            out.push({ a: positions[i].body, b: positions[j].body, type: asp.type, glyph: asp.glyph, orb: +orb.toFixed(2), exact: orb < 1 });
            break;
          }
        }
      }
    }
    return out;
  }

  // ── Chart of the moment (mundane) ────────────────────────────────────────
  /** Live chart for an observer + instant. opts.system: 'placidus'|'whole'. */
  function chartOfMoment(latDeg, lonDeg, date, opts) {
    opts = opts || {};
    const asc = ascendantDeg(latDeg, lonDeg, date);
    const mc = mcDeg(date, lonDeg);
    const system = opts.system === "whole" ? "whole" : "placidus";
    const cusps = system === "whole" ? wholeSignHouses(asc) : placidusHouses(asc, mc, latDeg);
    // computePlanets(...,11) includes Chiron (see sky.js). Falls back to 10.
    const raw = (typeof computePlanets === "function") ? computePlanets(latDeg, lonDeg, date, 11) : [];
    const positions = raw.map((p) => {
      const sign = p.sign;
      const dig = dignity(p.body, sign);
      return {
        body: p.body,
        name: bodyName(p.body),
        glyph: bodyGlyph(p.body),
        color: bodyColor(p.body),
        eclLon: p.eclLon,
        sign,
        signName: SIGN_N[sign],
        signGlyph: SIGN_G[sign],
        degInSign: degInSign(p.eclLon),
        element: ELEMENT_OF_SIGN(sign),
        dignity: dig,
        retrograde: retrograde(p.body, date),
        house: houseOf(p.eclLon, cusps),
        alt: p.alt, az: p.az, zone: p.zone, up: p.up,
      };
    });
    return finishChart({ frame: "mundane", asc, mc, cusps, system, positions, observer: { lat: latDeg, lon: lonDeg }, date });
  }

  // ── Chart from the player's natal chart (the "natal" frame) ──────────────
  function natalChart(playerChart, date) {
    if (!playerChart || !Array.isArray(playerChart.placements)) return null;
    const ascDeg = (playerChart.ascendant || 0) / 60;
    const mcD = (playerChart.midheaven || 0) / 60;
    let cusps, system;
    if (Array.isArray(playerChart.house_cusps) && playerChart.house_cusps.length === 12) {
      cusps = playerChart.house_cusps.map((m) => m / 60);
      system = playerChart.house_system === "WholeSign" ? "whole" : "placidus";
    } else {
      cusps = placidusHouses(ascDeg, mcD, playerChart.birth_lat || 40.7128);
      system = "placidus";
    }
    const positions = playerChart.placements.map((p) => {
      const eclLon = p.sign * 30 + (p.arc_minutes || 0) / 60;
      const dig = (typeof p.dignity === "number" && p.dignity !== 0)
        ? { score: p.dignity, label: dignityLabel(p.dignity), key: dignityLabel(p.dignity).toLowerCase() }
        : dignity(p.body, p.sign);
      return {
        body: p.body,
        name: bodyName(p.body),
        glyph: bodyGlyph(p.body),
        color: bodyColor(p.body),
        eclLon,
        sign: p.sign,
        signName: SIGN_N[p.sign],
        signGlyph: SIGN_G[p.sign],
        degInSign: eclLon % 30,
        element: ELEMENT_OF_SIGN(p.sign),
        dignity: dig,
        retrograde: !!p.retrograde,
        house: houseOf(eclLon, cusps),
        up: null,
      };
    });
    return finishChart({ frame: "natal", asc: ascDeg, mc: mcD, cusps, system, positions, date });
  }

  function dignityLabel(score) {
    if (score >= 5) return "Domicile";
    if (score >= 3) return "Exaltation";
    if (score <= -5) return "Detriment";
    if (score <= -3) return "Fall";
    return "Peregrine";
  }

  function finishChart(chart) {
    chart.aspects = aspectsAmong(chart.positions);
    // Dominant element by count of bodies per triplicity.
    const tally = { Fire: 0, Earth: 0, Air: 0, Water: 0 };
    chart.positions.forEach((p) => { tally[p.element] = (tally[p.element] || 0) + 1; });
    chart.elemental = tally;
    chart.dominantElement = Object.keys(tally).reduce((a, b) => (tally[b] > tally[a] ? b : a), "Fire");
    chart.byBody = {};
    chart.positions.forEach((p) => { chart.byBody[p.body] = p; });
    return chart;
  }

  /** One-line plain-language weather for a single body's position. */
  function weatherSummary(pos) {
    if (!pos) return "";
    const retro = pos.retrograde ? ", retrograde" : "";
    const dig = pos.dignity && pos.dignity.label !== "Peregrine" ? ` · ${pos.dignity.label}` : "";
    const house = pos.house ? ` · House ${pos.house}` : "";
    return `${pos.glyph} ${pos.name} in ${pos.signGlyph} ${pos.signName} ${Math.floor(pos.degInSign)}°${retro}${dig}${house}`;
  }

  // ════════════════════════════════════════════════════════════════════════
  //  THE JING ARENA — the 5 elemental duel moves
  //  Ported from planetary_agents-main/components/cosmic-agents/constants.ts
  //  + lib/agents/jing-system.ts. ESMS ids ARE the elements:
  //  0=Spirit/Fire, 1=Essence/Water, 2=Matter/Earth, 3=Substance/Air.
  // ════════════════════════════════════════════════════════════════════════
  const PRIMARY = 15, SECONDARY = 10; // stat / esms drain amounts (constants.ts)
  const JING_MOVES = {
    meltdown: {
      id: "meltdown", name: "Meltdown", glyph: "🜂", element: "Fire", esms: 0, type: "Positive", threshold: 30,
      description: "Shatters structural barriers. Doubles intensity.",
      stat: "vitality", statCost: PRIMARY, esmsCost: SECONDARY,
      counters: ["freeze", "tectonicRoot"], counteredBy: ["vacuum"],
    },
    freeze: {
      id: "freeze", name: "Freeze", glyph: "🜄", element: "Water", esms: 1, type: "Dynamic", threshold: 30,
      description: "Locks the opponent's stance. Forces silence or rigidity.",
      stat: "adaptability", statCost: PRIMARY, esmsCost: SECONDARY,
      counters: ["meltdown"], counteredBy: ["meltdown"],
    },
    tectonicRoot: {
      id: "tectonicRoot", name: "Tectonic Root", glyph: "🜃", element: "Earth", esms: 2, type: "Neutral", threshold: 30,
      description: "Impenetrable defense. Deflects emotional or kinetic attacks.",
      stat: "wisdom", statCost: PRIMARY, esmsCost: SECONDARY,
      counters: ["meltdown"], counteredBy: ["erode"],
    },
    vacuum: {
      id: "vacuum", name: "Vacuum", glyph: "🜁", element: "Air", esms: 3, type: "Negative", threshold: 30,
      description: "Removes oxygen. Neutralizes fiery enthusiasm.",
      stat: "charisma", statCost: PRIMARY, esmsCost: SECONDARY,
      counters: ["meltdown"], counteredBy: ["freeze"],
    },
    erode: {
      id: "erode", name: "Erode", glyph: "🜔", element: "Water·Earth", esms: 1, esms2: 2, type: "Dynamic-Neutral", threshold: 30,
      description: "Dissolves Saturnian logic. Slow, patient wear.",
      stat: "intuition", statCost: SECONDARY, esmsCost: SECONDARY,
      counters: ["tectonicRoot"], counteredBy: ["vacuum"],
    },
  };
  const MOVE_ORDER = ["meltdown", "freeze", "tectonicRoot", "vacuum", "erode"];
  const SACRED7 = ["power", "resonance", "wisdom", "charisma", "intuition", "adaptability", "vitality"];

  /** Elemental composition (%) for a body in a sign at a given dignity.
   *  Blends the sign's triplicity, the planet's nature, and a baseline. */
  function elementalComposition(body, sign, dignityScore) {
    const comp = { Fire: 12, Water: 12, Earth: 12, Air: 12 };
    comp[ELEMENT_OF_SIGN(sign)] += 40;                 // the sign's element dominates
    comp[planetElement(body)] += 24;                   // the planet's own nature
    comp[ELEMENT_OF_SIGN(sign)] += Math.max(0, (dignityScore || 0)) * 2; // dignity sharpens it
    const sum = comp.Fire + comp.Water + comp.Earth + comp.Air;
    ["Fire", "Water", "Earth", "Air"].forEach((k) => { comp[k] = Math.round((comp[k] / sum) * 100); });
    return comp;
  }
  // Planet → element via its classical suit (wands=Fire, cups=Water, swords=Air, pentacles=Earth).
  const PLANET_SUIT_EL = { wands: "Fire", cups: "Water", swords: "Air", pentacles: "Earth" };
  function planetElement(body) {
    if (body >= 10) return "Water"; // Chiron — wounded-healer / water association
    const suits = (typeof PLANET_SUITS !== "undefined") ? PLANET_SUITS
      : ["wands","cups","swords","cups","wands","wands","pentacles","swords","cups","swords"];
    return PLANET_SUIT_EL[suits[body]] || "Fire";
  }

  /** Which Jing moves a composition unlocks (element ≥ threshold). */
  function availableJings(comp) {
    return MOVE_ORDER.filter((id) => {
      const m = JING_MOVES[id];
      if (m.element === "Water·Earth") return Math.max(comp.Water, comp.Earth) >= m.threshold;
      return comp[m.element] >= m.threshold;
    });
  }

  /** Resolve two declared moves → 'a' | 'b' | 'draw' (the counter graph). */
  function resolveJing(aId, bId) {
    const a = JING_MOVES[aId], b = JING_MOVES[bId];
    if (!a || !b) return "draw";
    const bBeatsA = a.counteredBy.includes(bId) || b.counters.includes(aId);
    const aBeatsB = b.counteredBy.includes(aId) || a.counters.includes(bId);
    if (aBeatsB && !bBeatsA) return "a";
    if (bBeatsA && !aBeatsB) return "b";
    return "draw";
  }

  // ── Public surface ───────────────────────────────────────────────────────
  window.AstroWeather = {
    OBLIQUITY_DEG: EPS_DEG, CHIRON,
    SACRED7, JING_MOVES, MOVE_ORDER,
    bodyName, bodyGlyph, bodyColor, signOf, degInSign,
    dignity, dignityLabel, rulerOfSign, retrograde,
    wholeSignHouses, placidusHouses, houseOf, mcDeg, ascendantDeg,
    aspectsAmong, chartOfMoment, natalChart, weatherSummary,
    elementalComposition, planetElement, availableJings, resolveJing,
    ELEMENT_OF_SIGN,
  };
})();
