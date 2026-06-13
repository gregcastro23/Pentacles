/* ============================================================
   PENTACLES — The Real Sky
   ============================================================
   Celestial math + the horizon-disk projection + the eleven-zone
   pentagram partition. A JS port of unity/SkyMath.cs and
   unity/PentacleGrid.cs, sharing the server's GMST clock
   (server/src/reducers.rs), so every client agrees on the sky.

   The visible hemisphere is projected azimuthal-equidistant from
   the zenith: r = (90 − altitude) / 90 — zenith at the centre of
   the disk, the horizon ("the edge of the sky") at the rim. The
   pentagram overlay partitions that disk into the eleven zones:
   0–4 Arc-Houses (rim), 5–9 Spires (star points), 10 Crown
   (centre pentagon). Every star above the horizon — from the
   ascendant rising in the east all the way around the rim — lands
   in exactly one zone.
   ============================================================ */

const OBLIQUITY_DEG = 23.439291; // mean obliquity of the ecliptic (deg, J2000)

// The SVG horizon disk (matches the pentacle paths in client.html).
const SKY_CX = 300, SKY_CY = 300, SKY_R = 250;

// The server's engagement gate: a star must clear this altitude to be struck.
const MIN_ENGAGE_ALT_DEG = 10;

function deg2rad(d) { return d * Math.PI / 180; }
function rad2deg(r) { return r * 180 / Math.PI; }
function norm360(d) { d %= 360; return d < 0 ? d + 360 : d; }

// Greenwich Mean Sidereal Time in degrees — the same series as the server's
// gmst_deg and SkyMath.GmstDeg, so all three clocks agree.
function gmstDeg(date) {
  const jd = date.getTime() / 86400000 + 2440587.5; // Unix epoch → Julian Day
  const d = jd - 2451545.0;
  const t = d / 36525.0;
  return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - t * t * t / 38710000.0);
}

// Local sidereal time in degrees (east longitude positive).
function lstDeg(date, eastLonDeg) { return norm360(gmstDeg(date) + eastLonDeg); }

// Equatorial (RA/Dec deg) → horizontal {alt, az} (deg; az from North → East).
// Pass the precomputed LST so a 5,000-star sweep does the clock math once.
function altAzOf(raDeg, decDeg, latDeg, lst) {
  const ha = deg2rad(norm360(lst - raDeg)); // hour angle
  const dec = deg2rad(decDeg), lat = deg2rad(latDeg);
  const sinAlt = Math.min(1, Math.max(-1,
    Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha)));
  const alt = Math.asin(sinAlt);
  const y = -Math.cos(dec) * Math.cos(lat) * Math.sin(ha);
  const x = Math.sin(dec) - Math.sin(lat) * sinAlt;
  return { alt: rad2deg(alt), az: norm360(rad2deg(Math.atan2(y, x))) };
}

// Ecliptic longitude (deg, β = 0) → equatorial {ra, dec} (deg).
function eclipticToEquatorial(lonDeg) {
  const e = deg2rad(OBLIQUITY_DEG), l = deg2rad(lonDeg);
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  const ra = Math.atan2(Math.sin(l) * Math.cos(e), Math.cos(l));
  return { ra: norm360(rad2deg(ra)), dec: rad2deg(dec) };
}

// Ecliptic longitude (deg, 0..360) of an equatorial point — the inverse of the
// above, mirroring the server's `equatorial_to_ecliptic_min` (chart.rs). A star's
// sign = floor(lon/30); the sign's element is its ESMS suit. (Preview/tooltips;
// the chain trusts the server's value, which is what freezes each pool's pair.)
function equatorialToEcliptic(raDeg, decDeg) {
  const e = deg2rad(OBLIQUITY_DEG), ra = deg2rad(raDeg), dec = deg2rad(decDeg);
  const lon = Math.atan2(Math.sin(ra) * Math.cos(e) + Math.tan(dec) * Math.sin(e), Math.cos(ra));
  return norm360(rad2deg(lon));
}

// The Ascendant: the ecliptic degree rising on the observer's eastern horizon
// right now (same formula as the server's ascendant_deg / ChartCalculator.AscMc).
// Returns { lambda, sign, signGlyph, degInSign, az } — az is the rim azimuth
// where the ecliptic is rising, for the ASC marker on the disk's edge.
function ascendantNow(latDeg, lonDeg, date) {
  const ramc = deg2rad(lstDeg(date, lonDeg));
  const e = deg2rad(OBLIQUITY_DEG);
  const lat = deg2rad(latDeg);
  const lambda = norm360(rad2deg(
    Math.atan2(Math.cos(ramc), -(Math.sin(e) * Math.tan(lat) + Math.cos(e) * Math.sin(ramc)))));
  const eq = eclipticToEquatorial(lambda);
  const aa = altAzOf(eq.ra, eq.dec, latDeg, lstDeg(date, lonDeg));
  const sign = Math.floor(lambda / 30) % 12;
  return {
    lambda,
    sign,
    degInSign: Math.floor(lambda % 30),
    az: aa.az,
  };
}

/* ---- The pentagram partition (port of unity/PentacleGrid.cs) ----
   Disk coords: +y = North, +x = East, r = 1 at the horizon rim.
   The SVG maps these as x = CX + R·px, y = CY − R·py (checked against the
   zone paths in client.html — they are this exact pentagram). */

const PENT_T = [ // outer star points (spire tips) at r = 1, every 72° from North
  [0.000, 1.000], [0.951, 0.309], [0.588, -0.809], [-0.588, -0.809], [-0.951, 0.309],
];
const PENT_V = [ // inner pentagon vertices (the Crown) — pentagram intersections
  [0.2244, 0.3088], [0.3632, -0.118], [0.000, -0.382], [-0.3632, -0.118], [-0.2244, 0.3088],
];

function zonePolygon(zoneId) {
  if (zoneId === 10) return PENT_V;                       // Crown
  if (zoneId >= 5) {                                      // Spire k = [T_k, V_{k-1}, V_k]
    const k = zoneId - 5;
    return [PENT_T[k], PENT_V[(k + 4) % 5], PENT_V[k]];
  }
  // Arc-House k = [T_k, V_k, T_{k+1}] (outer edge rides the horizon rim).
  return [PENT_T[zoneId], PENT_V[zoneId], PENT_T[(zoneId + 1) % 5]];
}

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if ((poly[i][1] > py) !== (poly[j][1] > py) &&
        px < (poly[j][0] - poly[i][0]) * (py - poly[i][1]) / (poly[j][1] - poly[i][1]) + poly[i][0]) {
      inside = !inside;
    }
  }
  return inside;
}

// Which zone a sky direction falls in (−1 below the horizon).
function zoneForAltAz(altDeg, azDeg) {
  if (altDeg < 0) return -1;
  const r = (90 - altDeg) / 90;
  const a = deg2rad(azDeg);
  const px = r * Math.sin(a), py = r * Math.cos(a); // +y = North

  if (pointInPoly(px, py, PENT_V)) return 10;             // Crown first (innermost)
  for (let k = 0; k < 5; k++)                             // then Spires
    if (pointInPoly(px, py, zonePolygon(5 + k))) return 5 + k;
  for (let k = 0; k < 5; k++)                             // then Arc-Houses
    if (pointInPoly(px, py, zonePolygon(k))) return k;

  // Numerical fallback: nearest rim sector by angle.
  const deg = norm360(azDeg);
  return Math.min(4, Math.max(0, Math.floor(((deg + 36) % 360) / 72)));
}

// Sky direction → SVG point on the horizon disk (zenith centre, horizon rim).
function skyProject(altDeg, azDeg) {
  const r = Math.min(1, (90 - altDeg) / 90);
  const a = deg2rad(azDeg);
  return { x: SKY_CX + SKY_R * r * Math.sin(a), y: SKY_CY - SKY_R * r * Math.cos(a) };
}

/* ---- The wanderers: low-precision geocentric ephemeris ----
   A port of feeder/ephemeris.ts (JPL Keplerian planets + truncated Sun/Moon
   series, mirroring unity/ChartCalculator.cs). Game-grade: sub-degree for the
   Sun/planets — plenty to place a body on the disk and in a zone. Bodies ride
   the ecliptic (β ≈ 0), their own plane drawn across the star field. */

// a(AU) e I(deg) L(deg) ϖ(deg) Ω(deg) — rows: Mercury,Venus,Earth,Mars,Jupiter,Saturn,Uranus,Neptune,Pluto
const EPH_EL = [
  [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
  [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
  [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0.0],
  [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
  [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
  [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
  [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
  [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
  [39.48211675, 0.2488273, 17.14001206, 238.92903833, 224.06891629, 110.30393684],
];
const EPH_RATE = [
  [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081],
  [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418],
  [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0.0],
  [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343],
  [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106],
  [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794],
  [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589],
  [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.00508664],
  [-0.00031596, 0.0000517, 0.00004818, 145.20780515, -0.04062942, -0.01183482],
];

function ephJulianDay(date) { return date.getTime() / 86400000 + 2440587.5; }
function ephCenturies(jd) { return (jd - 2451545.0) / 36525.0; }

function ephHelio(row, jd) {
  const t = ephCenturies(jd);
  const a = EPH_EL[row][0] + EPH_RATE[row][0] * t;
  const e = EPH_EL[row][1] + EPH_RATE[row][1] * t;
  const I = deg2rad(EPH_EL[row][2] + EPH_RATE[row][2] * t);
  const L = EPH_EL[row][3] + EPH_RATE[row][3] * t;
  const peri = EPH_EL[row][4] + EPH_RATE[row][4] * t;
  const node = deg2rad(EPH_EL[row][5] + EPH_RATE[row][5] * t);

  const M = deg2rad(norm360(L - peri));
  const w = deg2rad(peri) - node;

  let E = M;
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));

  const xv = a * (Math.cos(E) - e);
  const yv = a * (Math.sqrt(1 - e * e) * Math.sin(E));
  const v = Math.atan2(yv, xv);
  const r = Math.hypot(xv, yv);
  const u = v + w;
  return {
    x: r * (Math.cos(node) * Math.cos(u) - Math.sin(node) * Math.sin(u) * Math.cos(I)),
    y: r * (Math.sin(node) * Math.cos(u) + Math.cos(node) * Math.sin(u) * Math.cos(I)),
  };
}

function ephSunLon(jd) {
  const t = ephCenturies(jd);
  const L0 = norm360(280.46646 + 36000.76983 * t + 0.0003032 * t * t);
  const M = deg2rad(norm360(357.52911 + 35999.05029 * t - 0.0001537 * t * t));
  const c = (1.914602 - 0.004817 * t) * Math.sin(M)
    + (0.019993 - 0.000101 * t) * Math.sin(2 * M)
    + 0.000289 * Math.sin(3 * M);
  return norm360(L0 + c);
}

function ephMoonLon(jd) {
  const t = ephCenturies(jd);
  const Lp = 218.3164477 + 481267.88123421 * t;
  const D = deg2rad(297.8501921 + 445267.1114034 * t);
  const M = deg2rad(357.5291092 + 35999.0502909 * t);
  const Mp = deg2rad(134.9633964 + 477198.8675055 * t);
  const F = deg2rad(93.272095 + 483202.0175233 * t);
  const lon = Lp
    + 6.288774 * Math.sin(Mp)
    + 1.274027 * Math.sin(2 * D - Mp)
    + 0.658314 * Math.sin(2 * D)
    + 0.213618 * Math.sin(2 * Mp)
    - 0.185116 * Math.sin(M)
    - 0.114332 * Math.sin(2 * F);
  return norm360(lon);
}

const EPH_PLANET_ROW = [0, 1, 3, 4, 5, 6, 7]; // for body idx 2..8 (Mercury..Neptune)

// Geocentric ecliptic longitude for body idx 0 Sun .. 9 Pluto.
function geocentricEclipticLon(p, jd) {
  if (p === 0) return ephSunLon(jd);
  if (p === 1) return ephMoonLon(jd);
  const row = p === 9 ? 8 : EPH_PLANET_ROW[p - 2];
  const b = ephHelio(row, jd);
  const earth = ephHelio(2, jd);
  return norm360(rad2deg(Math.atan2(b.y - earth.y, b.x - earth.x)));
}

// All ten bodies for an observer: ecliptic λ → RA/Dec → alt/az → disk + zone.
// Returns every body with an `up` flag; the renderer draws the risen ones.
function computePlanets(latDeg, lonDeg, date) {
  const jd = ephJulianDay(date);
  const lst = lstDeg(date, lonDeg);
  const out = [];
  for (let p = 0; p < 10; p++) {
    const lambda = geocentricEclipticLon(p, jd);
    const eq = eclipticToEquatorial(lambda);
    const aa = altAzOf(eq.ra, eq.dec, latDeg, lst);
    const proj = skyProject(aa.alt, aa.az);
    out.push({
      body: p,
      eclLon: lambda,
      sign: Math.floor(lambda / 30) % 12,
      ra: eq.ra, dec: eq.dec,
      alt: aa.alt, az: aa.az,
      x: proj.x, y: proj.y,
      zone: zoneForAltAz(aa.alt, aa.az),
      up: aa.alt > 0,
    });
  }
  return out;
}

// The visible arc of the ecliptic — the plane the planets ride — as polyline
// segments on the disk (it breaks where the plane dips below the horizon).
function eclipticSegments(latDeg, lonDeg, date, stepDeg = 3) {
  const lst = lstDeg(date, lonDeg);
  const segs = [];
  let cur = null;
  for (let lambda = 0; lambda <= 360; lambda += stepDeg) {
    const eq = eclipticToEquatorial(lambda % 360);
    const aa = altAzOf(eq.ra, eq.dec, latDeg, lst);
    if (aa.alt > 0) {
      const p = skyProject(aa.alt, aa.az);
      (cur ??= []).push(p);
    } else if (cur) {
      segs.push(cur);
      cur = null;
    }
  }
  if (cur) segs.push(cur);
  return segs;
}

// A star's pull on the zone meter — mirrors server combat::node_weight.
function starWeight(magnitude) { return Math.max(0.4, 6.5 - magnitude); }

// Zone-meter swing from a captured star — mirrors server combat::control_delta.
function starControlDelta(magnitude, margin) {
  const base = starWeight(magnitude) * 40.0;
  const bonus = Math.min(base, Math.max(0, margin * 0.1));
  return Math.floor(base + bonus);
}
