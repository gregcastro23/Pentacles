// Pentacles — low-precision geocentric ephemeris (TypeScript).
//
// Mirrors unity/ChartCalculator.cs: JPL Keplerian planets + truncated Sun/Moon
// series. Game-grade (sub-degree for Sun/planets). Returns equatorial RA/Dec and
// ecliptic longitude for body index 0 Sun .. 9 Pluto.

const OBLIQUITY = 23.439291;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const norm360 = (d: number) => ((d % 360) + 360) % 360;

export function julianDay(date: Date): number {
  return date.getTime() / 86400000 + 2440587.5;
}
function tCenturies(jd: number): number {
  return (jd - 2451545.0) / 36525.0;
}

export function eclipticToEquatorial(lonDeg: number, latDeg: number) {
  const e = OBLIQUITY * D2R, l = lonDeg * D2R, b = latDeg * D2R;
  const dec = Math.asin(Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l));
  const ra = Math.atan2(
    Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e),
    Math.cos(l),
  );
  return { ra: norm360(ra * R2D), dec: dec * R2D };
}

// a(AU) e I(deg) L(deg) ϖ(deg) Ω(deg) — rows: Mercury,Venus,Earth,Mars,Jupiter,Saturn,Uranus,Neptune,Pluto
const EL = [
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
const RATE = [
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

function helio(row: number, jd: number) {
  const t = tCenturies(jd);
  const a = EL[row][0] + RATE[row][0] * t;
  const e = EL[row][1] + RATE[row][1] * t;
  const I = (EL[row][2] + RATE[row][2] * t) * D2R;
  const L = EL[row][3] + RATE[row][3] * t;
  const peri = EL[row][4] + RATE[row][4] * t;
  const node = (EL[row][5] + RATE[row][5] * t) * D2R;

  const M = norm360(L - peri) * D2R;
  const w = peri * D2R - node;

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

function sunLon(jd: number): number {
  const t = tCenturies(jd);
  const L0 = norm360(280.46646 + 36000.76983 * t + 0.0003032 * t * t);
  const M = norm360(357.52911 + 35999.05029 * t - 0.0001537 * t * t) * D2R;
  const c =
    (1.914602 - 0.004817 * t) * Math.sin(M) +
    (0.019993 - 0.000101 * t) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);
  return norm360(L0 + c);
}

function moonLon(jd: number): number {
  const t = tCenturies(jd);
  const Lp = 218.3164477 + 481267.88123421 * t;
  const D = (297.8501921 + 445267.1114034 * t) * D2R;
  const M = (357.5291092 + 35999.0502909 * t) * D2R;
  const Mp = (134.9633964 + 477198.8675055 * t) * D2R;
  const F = (93.272095 + 483202.0175233 * t) * D2R;
  const lon =
    Lp +
    6.288774 * Math.sin(Mp) +
    1.274027 * Math.sin(2 * D - Mp) +
    0.658314 * Math.sin(2 * D) +
    0.213618 * Math.sin(2 * Mp) -
    0.185116 * Math.sin(M) -
    0.114332 * Math.sin(2 * F);
  return norm360(lon);
}

const PLANET_ROW = [0, 1, 3, 4, 5, 6, 7]; // for body idx 2..8 (Mercury..Neptune)

export function geocentricEclipticLon(p: number, jd: number): number {
  if (p === 0) return sunLon(jd);
  if (p === 1) return moonLon(jd);
  const row = p === 9 ? 8 : PLANET_ROW[p - 2];
  const b = helio(row, jd);
  const earth = helio(2, jd);
  return norm360(Math.atan2(b.y - earth.y, b.x - earth.x) * R2D);
}

/** Equatorial RA/Dec + ecliptic longitude for body idx 0..9. */
export function bodyEquatorial(p: number, jd: number) {
  const lon = geocentricEclipticLon(p, jd);
  const { ra, dec } = eclipticToEquatorial(lon, 0);
  return { ra, dec, eclLon: lon };
}
