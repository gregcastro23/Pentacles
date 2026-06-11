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

// A star's pull on the zone meter — mirrors server combat::node_weight.
function starWeight(magnitude) { return Math.max(0.4, 6.5 - magnitude); }

// Zone-meter swing from a captured star — mirrors server combat::control_delta.
function starControlDelta(magnitude, margin) {
  const base = starWeight(magnitude) * 40.0;
  const bonus = Math.min(base, Math.max(0, margin * 0.1));
  return Math.floor(base + bonus);
}
