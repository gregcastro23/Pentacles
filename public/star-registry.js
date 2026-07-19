/* ============================================================
   PENTACLES — Star Registry Engine & Semantic Search Module
   ============================================================
   Provides astronomical reference tables (88 IAU constellations,
   Morgan-Keenan spectral classification, Greek letter expansions),
   coordinate transformations (sexagesimal RA/Dec), and a high-performance
   in-memory semantic search engine for the real-sky star catalogue.
   ============================================================ */

(function (global) {
  "use strict";

  // ── 88 IAU CONSTELLATION REGISTRY ─────────────────────────────────────────
  const CONSTELLATIONS = {
    And: { name: "Andromeda", genitive: "Andromedae", english: "The Chained Maiden" },
    Ant: { name: "Antlia", genitive: "Antliae", english: "The Air Pump" },
    Aps: { name: "Apus", genitive: "Apodis", english: "The Bird of Paradise" },
    Aqr: { name: "Aquarius", genitive: "Aquarii", english: "The Water Bearer" },
    Aql: { name: "Aquila", genitive: "Aquilae", english: "The Eagle" },
    Ara: { name: "Ara", genitive: "Arae", english: "The Altar" },
    Ari: { name: "Aries", genitive: "Arietis", english: "The Ram" },
    Aur: { name: "Auriga", genitive: "Aurigae", english: "The Charioteer" },
    Boo: { name: "Boötes", genitive: "Boötis", english: "The Herdsman" },
    Cae: { name: "Caelum", genitive: "Caeli", english: "The Chisel" },
    Cam: { name: "Camelopardalis", genitive: "Camelopardalis", english: "The Giraffe" },
    Cnc: { name: "Cancer", genitive: "Cancri", english: "The Crab" },
    CVn: { name: "Canes Venatici", genitive: "Canum Venaticorum", english: "The Hunting Dogs" },
    CMa: { name: "Canis Major", genitive: "Canis Majoris", english: "The Greater Dog" },
    CMi: { name: "Canis Minor", genitive: "Canis Minoris", english: "The Lesser Dog" },
    Cap: { name: "Capricornus", genitive: "Capricorni", english: "The Sea Goat" },
    Car: { name: "Carina", genitive: "Carinae", english: "The Keel" },
    Cas: { name: "Cassiopeia", genitive: "Cassiopeiae", english: "Queen Cassiopeia" },
    Cen: { name: "Centaurus", genitive: "Centauri", english: "The Centaur" },
    Cep: { name: "Cepheus", genitive: "Cephei", english: "King Cepheus" },
    Cet: { name: "Cetus", genitive: "Ceti", english: "The Sea Monster" },
    Cha: { name: "Chamaeleon", genitive: "Chamaeleontis", english: "The Chameleon" },
    Cir: { name: "Circinus", genitive: "Circini", english: "The Compasses" },
    Col: { name: "Columba", genitive: "Columbae", english: "The Dove" },
    Com: { name: "Coma Berenices", genitive: "Comae Berenices", english: "Berenice's Hair" },
    CrA: { name: "Corona Australis", genitive: "Coronae Australis", english: "The Southern Crown" },
    CrB: { name: "Corona Borealis", genitive: "Coronae Borealis", english: "The Northern Crown" },
    Crv: { name: "Corvus", genitive: "Corvi", english: "The Crow" },
    Crt: { name: "Crater", genitive: "Crateris", english: "The Cup" },
    Cru: { name: "Crux", genitive: "Crucis", english: "The Southern Cross" },
    Cyg: { name: "Cygnus", genitive: "Cygni", english: "The Swan" },
    Del: { name: "Delphinus", genitive: "Delphini", english: "The Dolphin" },
    Dor: { name: "Dorado", genitive: "Doradus", english: "The Dolphinfish" },
    Dra: { name: "Draco", genitive: "Draconis", english: "The Dragon" },
    Eqw: { name: "Equuleus", genitive: "Equulei", english: "The Little Horse" },
    Eri: { name: "Eridanus", genitive: "Eridani", english: "The River" },
    For: { name: "Fornax", genitive: "Fornacis", english: "The Furnace" },
    Gem: { name: "Gemini", genitive: "Geminorum", english: "The Twins" },
    Gru: { name: "Grus", genitive: "Gruis", english: "The Crane" },
    Her: { name: "Hercules", genitive: "Herculis", english: "Hercules" },
    Hor: { name: "Horologium", genitive: "Horologii", english: "The Pendulum Clock" },
    Hya: { name: "Hydra", genitive: "Hydrae", english: "The Female Water Snake" },
    Hyi: { name: "Hydrus", genitive: "Hydri", english: "The Male Water Snake" },
    Ind: { name: "Indus", genitive: "Indi", english: "The Indian" },
    Lac: { name: "Lacerta", genitive: "Lacertae", english: "The Lizard" },
    Leo: { name: "Leo", genitive: "Leonis", english: "The Lion" },
    LMi: { name: "Leo Minor", genitive: "Leonis Minoris", english: "The Lesser Lion" },
    Lep: { name: "Lepus", genitive: "Leporis", english: "The Hare" },
    Lib: { name: "Libra", genitive: "Librae", english: "The Scales" },
    Lup: { name: "Lupus", genitive: "Lupi", english: "The Wolf" },
    Lyn: { name: "Lynx", genitive: "Lyncis", english: "The Lynx" },
    Lyr: { name: "Lyra", genitive: "Lyrae", english: "The Lyre" },
    Men: { name: "Mensa", genitive: "Mensae", english: "Table Mountain" },
    Mic: { name: "Microscopium", genitive: "Microscopii", english: "The Microscope" },
    Mon: { name: "Monoceros", genitive: "Monocerotis", english: "The Unicorn" },
    Mus: { name: "Musca", genitive: "Muscae", english: "The Fly" },
    Nor: { name: "Norma", genitive: "Normae", english: "The Surveyor's Level" },
    Oct: { name: "Octans", genitive: "Octantis", english: "The Octant" },
    Oph: { name: "Ophiuchus", genitive: "Ophiuchi", english: "The Serpent Bearer" },
    Ori: { name: "Orion", genitive: "Orionis", english: "The Hunter" },
    Pav: { name: "Pavo", genitive: "Pavonis", english: "The Peacock" },
    Peg: { name: "Pegasus", genitive: "Pegasi", english: "The Winged Horse" },
    Per: { name: "Perseus", genitive: "Persei", english: "The Hero" },
    Phe: { name: "Phoenix", genitive: "Phoenicis", english: "The Phoenix" },
    Pic: { name: "Pictor", genitive: "Pictoris", english: "The Painter's Easel" },
    Psc: { name: "Pisces", genitive: "Piscium", english: "The Fishes" },
    PsA: { name: "Piscis Austrinus", genitive: "Piscis Austrini", english: "The Southern Fish" },
    Pup: { name: "Puppis", genitive: "Puppis", english: "The Poop Deck" },
    Pyx: { name: "Pyxis", genitive: "Pyxidis", english: "The Mariner's Compass" },
    Ret: { name: "Reticulum", genitive: "Reticuli", english: "The Reticle" },
    Sge: { name: "Sagitta", genitive: "Sagittae", english: "The Arrow" },
    Sgr: { name: "Sagittarius", genitive: "Sagittarii", english: "The Archer" },
    Sco: { name: "Scorpius", genitive: "Scorpii", english: "The Scorpion" },
    Scl: { name: "Sculptor", genitive: "Sculptoris", english: "The Sculptor" },
    Sct: { name: "Scutum", genitive: "Scuti", english: "The Shield" },
    Ser: { name: "Serpens", genitive: "Serpentis", english: "The Serpent" },
    Sex: { name: "Sextans", genitive: "Sextantis", english: "The Sextant" },
    Tau: { name: "Taurus", genitive: "Tauri", english: "The Bull" },
    Tel: { name: "Telescopium", genitive: "Telescopii", english: "The Telescope" },
    Tri: { name: "Triangulum", genitive: "Trianguli", english: "The Triangle" },
    TrA: { name: "Triangulum Australe", genitive: "Trianguli Australis", english: "The Southern Triangle" },
    Tuc: { name: "Tucana", genitive: "Tucanae", english: "The Toucan" },
    UMa: { name: "Ursa Major", genitive: "Ursae Majoris", english: "The Great Bear" },
    UMi: { name: "Ursa Minor", genitive: "Ursae Minoris", english: "The Little Bear" },
    Vel: { name: "Vela", genitive: "Velorum", english: "The Sails" },
    Vir: { name: "Virgo", genitive: "Virginis", english: "The Virgin" },
    Vol: { name: "Volans", genitive: "Volantis", english: "The Flying Fish" },
    Vul: { name: "Vulpecula", genitive: "Vulpeculae", english: "The Little Fox" },
  };

  // ── GREEK BAYER DESIGNATION DICTIONARY ────────────────────────────────────
  const GREEK = {
    Alp: "Alpha", Bet: "Beta", Gam: "Gamma", Del: "Delta",
    Eps: "Epsilon", Zet: "Zeta", Eta: "Eta", The: "Theta",
    Iot: "Iota", Kap: "Kappa", Lam: "Lambda", Mu: "Mu",
    Nu: "Nu", Xi: "Xi", Omi: "Omicron", Pi: "Pi",
    Rho: "Rho", Sig: "Sigma", Tau: "Tau", Ups: "Upsilon",
    Phi: "Phi", Chi: "Chi", Psi: "Psi", Ome: "Omega",
  };

  // ── MORGAN-KEENAN SPECTRAL CLASSIFIER ─────────────────────────────────────
  function getSpectralDetails(spect, ci, absmag) {
    let raw = (spect || "").trim().toUpperCase();
    let letter = "G";
    if (/^O/.test(raw)) letter = "O";
    else if (/^B/.test(raw)) letter = "B";
    else if (/^A/.test(raw)) letter = "A";
    else if (/^F/.test(raw)) letter = "F";
    else if (/^G/.test(raw)) letter = "G";
    else if (/^K/.test(raw)) letter = "K";
    else if (/^M/.test(raw)) letter = "M";
    else if (/^D|^WD/.test(raw)) letter = "D";

    // Estimate effective surface temperature T_eff (Kelvin) from B-V color index if present
    let tempK = 5778; // Sun default
    if (ci !== null && ci !== undefined && !isNaN(ci)) {
      let bv = Math.max(-0.4, Math.min(2.5, ci));
      tempK = Math.round(4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62)));
    } else {
      const classTemps = { O: 35000, B: 18000, A: 8500, F: 6500, G: 5700, K: 4500, M: 3200, D: 12000 };
      tempK = classTemps[letter] || 5700;
    }

    // Determine Luminosity Class (Ia, Ib, II, III, IV, V)
    let lumClass = "V"; // Main Sequence default
    let lumTitle = "Main Sequence Dwarf";
    if (/IA|IAB/i.test(raw)) { lumClass = "Ia"; lumTitle = "Luminous Supergiant"; }
    else if (/IB/i.test(raw)) { lumClass = "Ib"; lumTitle = "Supergiant"; }
    else if (/II\b/i.test(raw)) { lumClass = "II"; lumTitle = "Bright Giant"; }
    else if (/III\b/i.test(raw)) { lumClass = "III"; lumTitle = "Giant"; }
    else if (/IV\b/i.test(raw)) { lumClass = "IV"; lumTitle = "Subgiant"; }
    else if (/V\b/i.test(raw)) { lumClass = "V"; lumTitle = "Main Sequence Dwarf"; }
    else if (/DA|DB|DC|DQ|DZ|D\b/i.test(raw)) { lumClass = "WD"; lumTitle = "White Dwarf"; }
    else if (absmag !== null && absmag < -2.5) { lumClass = "I"; lumTitle = "Supergiant"; }
    else if (absmag !== null && absmag < 1.0) { lumClass = "III"; lumTitle = "Giant"; }

    const classMeta = {
      O: { name: "Class O", color: "#8a9eff", bg: "rgba(138, 158, 255, 0.2)", glow: "rgba(138, 158, 255, 0.6)", desc: "Blue Hyper-Hot Star" },
      B: { name: "Class B", color: "#aabfff", bg: "rgba(170, 191, 255, 0.2)", glow: "rgba(170, 191, 255, 0.6)", desc: "Blue-White Luminous Star" },
      A: { name: "Class A", color: "#cad7ff", bg: "rgba(202, 215, 255, 0.2)", glow: "rgba(202, 215, 255, 0.6)", desc: "White Main-Sequence Star" },
      F: { name: "Class F", color: "#f8f7ff", bg: "rgba(248, 247, 255, 0.2)", glow: "rgba(248, 247, 255, 0.6)", desc: "Yellow-White Star" },
      G: { name: "Class G", color: "#fff4ea", bg: "rgba(255, 244, 234, 0.2)", glow: "rgba(255, 244, 234, 0.6)", desc: "Yellow Dwarf Star (Solar Class)" },
      K: { name: "Class K", color: "#ffd2a1", bg: "rgba(255, 210, 161, 0.2)", glow: "rgba(255, 210, 161, 0.6)", desc: "Orange Giant/Dwarf Star" },
      M: { name: "Class M", color: "#ffaa6e", bg: "rgba(255, 170, 110, 0.2)", glow: "rgba(255, 170, 110, 0.6)", desc: "Red Giant / Supergiant Star" },
      D: { name: "White Dwarf", color: "#e3f2fd", bg: "rgba(227, 242, 253, 0.2)", glow: "rgba(227, 242, 253, 0.6)", desc: "Degenerate Stellar Remnant" },
    };

    const meta = classMeta[letter] || classMeta["G"];
    return {
      code: letter,
      fullSpect: raw || letter,
      className: meta.name,
      color: meta.color,
      bg: meta.bg,
      glow: meta.glow,
      desc: meta.desc,
      tempK,
      lumClass,
      lumTitle,
      categoryTitle: `${meta.name} ${lumTitle}`,
    };
  }

  // ── ASTRONOMICAL COORDINATE FORMATTERS ────────────────────────────────────
  function degToRA(deg) {
    if (deg == null || isNaN(deg)) return "00h 00m 00s";
    let hours = (deg / 15.0) % 24;
    if (hours < 0) hours += 24;
    const h = Math.floor(hours);
    const mFrac = (hours - h) * 60;
    const m = Math.floor(mFrac);
    const s = Math.round((mFrac - m) * 60);
    return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  }

  function degToDec(deg) {
    if (deg == null || isNaN(deg)) return "+00° 00' 00\"";
    const sign = deg >= 0 ? "+" : "-";
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const mFrac = (abs - d) * 60;
    const m = Math.floor(mFrac);
    const s = Math.round((mFrac - m) * 60);
    return `${sign}${String(d).padStart(2, "0")}° ${String(m).padStart(2, "0")}' ${String(s).padStart(2, "0")}"`;
  }

  function pcToLy(pc) {
    if (pc == null || isNaN(pc)) return null;
    return Math.round(pc * 3.26156 * 100) / 100;
  }

  function getEclipticCoordinates(ra_deg, dec_deg) {
    const ra_rad = (ra_deg * Math.PI) / 180.0;
    const dec_rad = (dec_deg * Math.PI) / 180.0;
    const eps_rad = (23.4392911 * Math.PI) / 180.0;

    const sinDec = Math.sin(dec_rad);
    const cosDec = Math.cos(dec_rad);
    const sinEps = Math.sin(eps_rad);
    const cosEps = Math.cos(eps_rad);
    const sinRa = Math.sin(ra_rad);
    const cosRa = Math.cos(ra_rad);

    const sinBeta = sinDec * cosEps - cosDec * sinEps * sinRa;
    const beta_rad = Math.asin(Math.max(-1, Math.min(1, sinBeta)));
    const beta_deg = (beta_rad * 180.0) / Math.PI;

    const y = sinRa * cosEps + (sinDec / Math.max(0.000001, cosDec)) * sinEps;
    const x = cosRa;
    let lambda_deg = (Math.atan2(y, x) * 180.0) / Math.PI;
    if (lambda_deg < 0) lambda_deg += 360.0;

    const ZODIAC_SIGNS = [
      { name: "Aries", symbol: "♈" },
      { name: "Taurus", symbol: "♉" },
      { name: "Gemini", symbol: "♊" },
      { name: "Cancer", symbol: "♋" },
      { name: "Leo", symbol: "♌" },
      { name: "Virgo", symbol: "♍" },
      { name: "Libra", symbol: "♎" },
      { name: "Scorpio", symbol: "♏" },
      { name: "Sagittarius", symbol: "♐" },
      { name: "Capricorn", symbol: "♑" },
      { name: "Aquarius", symbol: "♒" },
      { name: "Pisces", symbol: "♓" }
    ];

    const signIdx = Math.floor(lambda_deg / 30.0) % 12;
    const sign = ZODIAC_SIGNS[signIdx];
    const remDeg = lambda_deg % 30.0;
    const deg = Math.floor(remDeg);
    const remMin = (remDeg - deg) * 60.0;
    const min = Math.floor(remMin);
    const sec = Math.min(59, Math.round((remMin - min) * 60.0));

    return {
      lambda: lambda_deg,
      beta: beta_deg,
      signName: sign.name,
      signSymbol: sign.symbol,
      deg,
      min,
      sec,
      formatted: `${deg}° ${String(min).padStart(2, '0')}' ${String(sec).padStart(2, '0')}" ${sign.symbol} ${sign.name}`
    };
  }

  function getHorizonEphemeris(ra, dec, lat, lon, elev_m = 0, date = new Date()) {
    const now = date || new Date();
    const d = (now.getTime() / 86400000.0) - 10957.5;
    const gmst_deg = ((280.46061837 + 360.98564736629 * d) % 360 + 360) % 360;
    const lst_deg = ((gmst_deg + lon) % 360 + 360) % 360;

    const ha_deg = ((lst_deg - ra) % 360 + 360) % 360;
    const ha_rad = (ha_deg * Math.PI) / 180.0;
    const lat_rad = (lat * Math.PI) / 180.0;
    const dec_rad = (dec * Math.PI) / 180.0;

    const sinAlt = Math.sin(dec_rad) * Math.sin(lat_rad) + Math.cos(dec_rad) * Math.cos(lat_rad) * Math.cos(ha_rad);
    const trueAlt_deg = (Math.asin(Math.max(-1, Math.min(1, sinAlt))) * 180.0) / Math.PI;

    let ref_arcmin = 0;
    if (trueAlt_deg > -0.5) {
      ref_arcmin = 1.02 / Math.tan(((trueAlt_deg + 10.3 / (trueAlt_deg + 5.11)) * Math.PI) / 180.0);
    }
    const dip_deg = 0.0293 * Math.sqrt(Math.max(0, elev_m));
    const apparentAlt = trueAlt_deg + (ref_arcmin / 60.0) - dip_deg;

    const y = -Math.sin(ha_rad);
    const x = Math.cos(dec_rad) * Math.sin(lat_rad) * Math.cos(ha_rad) - Math.sin(dec_rad) * Math.cos(lat_rad);
    let az = (Math.atan2(y, x) * 180.0) / Math.PI;
    if (az < 0) az += 360.0;

    const altSign = apparentAlt >= 0 ? "+" : "-";
    const absAlt = Math.abs(apparentAlt);
    const altD = Math.floor(absAlt);
    const altM = Math.floor((absAlt - altD) * 60.0);
    const altS = Math.min(59, Math.round(((absAlt - altD) * 60.0 - altM) * 60.0));

    const azD = Math.floor(az);
    const azM = Math.floor((az - azD) * 60.0);

    const card = az < 22.5 || az >= 337.5 ? "N" : (az < 67.5 ? "NE" : (az < 112.5 ? "E" : (az < 157.5 ? "SE" : (az < 202.5 ? "S" : (az < 247.5 ? "SW" : (az < 292.5 ? "W" : "NW"))))));

    const horizonEncounter = apparentAlt >= 0.0 && apparentAlt <= 15.0;
    const horizonState = horizonEncounter ? "ON_HORIZON_BAND" : (apparentAlt > 15.0 ? "ABOVE_HORIZON" : "BELOW_HORIZON");

    return {
      trueAlt: trueAlt_deg,
      refractedAlt: apparentAlt,
      altSexagesimal: `${altSign}${String(altD).padStart(2, "0")}° ${String(altM).padStart(2, "0")}' ${String(altS).padStart(2, "0")}"`,
      azimuth: az,
      azSexagesimal: `${String(azD).padStart(3, "0")}° ${String(azM).padStart(2, "0")}' ${card}`,
      horizonEncounter,
      horizonState
    };
  }

  // ── STAR RECORD NORMALIZER ────────────────────────────────────────────────
  function normalizeStarRow(row) {
    if (!row || !Array.isArray(row)) return null;
    const hip = row[0];
    const name = row[1] || `HIP ${hip}`;
    const ra = row[2];
    const dec = row[3];
    const mag = row[4];
    const hd = row[5] || null;
    const hr = row[6] || null;
    const proper = row[7] || "";
    const bayerRaw = row[8] || "";
    const flam = row[9] || null;
    const con = row[10] || "";
    const dist_pc = row[11] || null;
    const spect = row[12] || "";
    const absmag = row[13] || null;
    const ci = row[14] || null;
    const lum = row[15] || null;

    // Bayer expansion (e.g. "Alp-1" -> "Alpha-1 Canis Majoris")
    let bayerFull = "";
    if (bayerRaw && con) {
      const parts = bayerRaw.split("-", 1);
      const grk = GREEK[parts[0]] || parts[0];
      const suf = bayerRaw.includes("-") ? `-${bayerRaw.split("-")[1]}` : "";
      const conInfo = CONSTELLATIONS[con];
      bayerFull = `${grk}${suf} ${conInfo ? conInfo.genitive : con}`;
    }

    const conInfo = CONSTELLATIONS[con] || { name: con || "Unknown", genitive: con || "", english: "" };
    const spectMeta = getSpectralDetails(spect, ci, absmag);
    const ecliptic = getEclipticCoordinates(ra, dec);
    const dist_ly = pcToLy(dist_pc);
    const weight = Math.pow(10, -0.4 * mag);

    return {
      hip_id: hip,
      name,
      ra,
      dec,
      magnitude: mag,
      hd,
      hr,
      proper,
      bayer: bayerRaw,
      bayerFull,
      flam,
      con,
      conName: conInfo.name,
      conGenitive: conInfo.genitive,
      conEnglish: conInfo.english,
      dist_pc,
      dist_ly,
      spect,
      spectMeta,
      ecliptic,
      absmag,
      ci,
      lum,
      raSex: degToRA(ra),
      decSex: degToDec(dec),
      weight,
    };
  }

  // ── IN-MEMORY SEMANTIC SEARCH ENGINE ─────────────────────────────────────
  class StarRegistryEngine {
    constructor() {
      this._normalized = null;
      this._byHip = new Map();
      this._byHd = new Map();
      this._byHr = new Map();
      this._searchTokens = []; // [{ star, searchStr, tokens }]
    }

    _ensureIndex() {
      if (this._normalized) return;
      const cat = typeof STAR_CATALOG !== "undefined" ? STAR_CATALOG : (typeof window !== "undefined" ? window.STAR_CATALOG : (typeof global !== "undefined" ? global.STAR_CATALOG : null));
      if (!cat || !Array.isArray(cat)) return;

      this._normalized = [];
      for (const row of cat) {
        const star = normalizeStarRow(row);
        if (!star) continue;

        this._normalized.push(star);
        this._byHip.set(star.hip_id, star);
        if (star.hd) this._byHd.set(star.hd, star);
        if (star.hr) this._byHr.set(star.hr, star);

        // Build tokenized search string
        const tokens = [
          String(star.hip_id),
          `hip${star.hip_id}`,
          `hip ${star.hip_id}`,
          star.name.toLowerCase(),
          star.proper.toLowerCase(),
          star.bayer.toLowerCase(),
          star.bayerFull.toLowerCase(),
          star.con.toLowerCase(),
          star.conName.toLowerCase(),
          star.conEnglish.toLowerCase(),
          star.spectMeta.code.toLowerCase(),
          star.spectMeta.lumTitle.toLowerCase(),
          star.spectMeta.desc.toLowerCase(),
        ];
        if (star.hd) tokens.push(`hd${star.hd}`, `hd ${star.hd}`, String(star.hd));
        if (star.hr) tokens.push(`hr${star.hr}`, `hr ${star.hr}`, String(star.hr));
        if (star.flam) tokens.push(`${star.flam} ${star.con}`.toLowerCase(), `${star.flam} ${star.conName}`.toLowerCase());

        const searchStr = tokens.join(" ");
        this._searchTokens.push({ star, searchStr, tokens });
      }
    }

    getAllStars() {
      this._ensureIndex();
      return this._normalized || [];
    }

    getByHip(hip) {
      this._ensureIndex();
      return this._byHip.get(Number(hip)) || null;
    }

    getByHd(hd) {
      this._ensureIndex();
      return this._byHd.get(Number(hd)) || null;
    }

    // Semantic query search processor
    search(query, options = {}) {
      this._ensureIndex();
      if (!this._normalized) return [];

      const q = (query || "").trim().toLowerCase();
      const {
        limit = 50,
        conFilter = null,
        spectFilter = null,
        maxMag = null,
        maxDistLy = null,
        visibleOnly = false,
        skyLiveList = null,
      } = options;

      // Filter base set
      let candidates = this._searchTokens;

      // Optional hard filters
      if (conFilter) {
        const cLower = conFilter.toLowerCase();
        candidates = candidates.filter((item) => item.star.con.toLowerCase() === cLower || item.star.conName.toLowerCase() === cLower);
      }
      if (spectFilter) {
        const sLower = spectFilter.toLowerCase();
        candidates = candidates.filter((item) => item.star.spectMeta.code.toLowerCase() === sLower);
      }
      if (maxMag !== null) {
        candidates = candidates.filter((item) => item.star.magnitude <= maxMag);
      }
      if (maxDistLy !== null) {
        candidates = candidates.filter((item) => item.star.dist_ly !== null && item.star.dist_ly <= maxDistLy);
      }

      // Live sky filter
      let visibleHips = null;
      if (visibleOnly && skyLiveList) {
        visibleHips = new Set(skyLiveList.map((s) => s.hip_id));
        candidates = candidates.filter((item) => visibleHips.has(item.star.hip_id));
      }

      if (!q) {
        // Empty query -> sort by brightness
        return candidates
          .slice(0, limit)
          .map((item) => item.star);
      }

      // Natural Query Semantic Parser
      const isRedSupergiant = /red supergiant|supergiant|red giant/i.test(q);
      const isBlueStar = /blue giant|blue star|class o|class b/i.test(q);
      const isYellowDwarf = /yellow dwarf|sun|solar|class g/i.test(q);
      const isBrightest = /bright|brightest|naked eye/i.test(q);
      const isNearest = /near|nearest|close|closest|earth/i.test(q);

      // Extract numeric magnitude / distance constraints
      let queryMaxMag = null;
      const magMatch = q.match(/mag(?:nitude)?\s*<\s*(\d+(?:\.\d+)?)/i);
      if (magMatch) queryMaxMag = parseFloat(magMatch[1]);

      let queryMaxDist = null;
      const distMatch = q.match(/(?:within|<)\s*(\d+)\s*(?:ly|light years|pc)/i);
      if (distMatch) queryMaxDist = parseFloat(distMatch[1]);

      const rawWords = q.split(/\s+/).filter(Boolean);

      const scored = [];
      for (const item of candidates) {
        const star = item.star;
        let score = 0;

        // Numeric catalog ID exact matching
        if (q === String(star.hip_id) || q === `hip${star.hip_id}` || q === `hip ${star.hip_id}`) score += 200;
        else if (star.hd && (q === String(star.hd) || q === `hd${star.hd}` || q === `hd ${star.hd}`)) score += 180;
        else if (star.hr && (q === String(star.hr) || q === `hr${star.hr}` || q === `hr ${star.hr}`)) score += 160;

        // Proper Name Match
        if (star.proper) {
          const propLower = star.proper.toLowerCase();
          if (propLower === q) score += 150;
          else if (propLower.startsWith(q)) score += 100;
          else if (propLower.includes(q)) score += 60;
        }

        // Display Name Match
        const nameLower = star.name.toLowerCase();
        if (nameLower === q) score += 140;
        else if (nameLower.startsWith(q)) score += 90;
        else if (nameLower.includes(q)) score += 50;

        // Bayer & Flamsteed Match
        if (star.bayerFull.toLowerCase().includes(q)) score += 70;
        if (star.conName.toLowerCase().includes(q) || star.con.toLowerCase() === q) score += 40;

        // Semantic concepts
        if (isRedSupergiant && (star.spectMeta.code === "M" || star.spectMeta.lumClass.includes("I"))) score += 35;
        if (isBlueStar && (star.spectMeta.code === "O" || star.spectMeta.code === "B")) score += 35;
        if (isYellowDwarf && star.spectMeta.code === "G" && star.spectMeta.lumClass === "V") score += 35;
        if (isBrightest && star.magnitude <= 2.0) score += 30;
        if (isNearest && star.dist_ly !== null && star.dist_ly < 30) score += 30;

        if (queryMaxMag !== null && star.magnitude > queryMaxMag) continue;
        if (queryMaxDist !== null && (star.dist_ly === null || star.dist_ly > queryMaxDist)) continue;

        // Word substring matches
        for (const w of rawWords) {
          if (w.length <= 1) continue;
          if (item.searchStr.includes(w)) score += 15;
        }

        if (score > 0) {
          scored.push({ star, score });
        }
      }

      scored.sort((a, b) => b.score - a.score || a.star.magnitude - b.star.magnitude);
      return scored.slice(0, limit).map((item) => item.star);
    }
  }

  const engine = new StarRegistryEngine();
  const StarRegistry = {
    CONSTELLATIONS,
    GREEK,
    getSpectralDetails,
    getEclipticCoordinates,
    getHorizonEphemeris,
    degToRA,
    degToDec,
    pcToLy,
    normalizeStarRow,
    getAllStars: () => engine.getAllStars(),
    getByHip: (hip) => engine.getByHip(hip),
    getByHd: (hd) => engine.getByHd(hd),
    search: (query, options) => engine.search(query, options),
  };

  global.StarRegistry = StarRegistry;
})(typeof window !== "undefined" ? window : this);
