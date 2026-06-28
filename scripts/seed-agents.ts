// ============================================================================
// Pentacles — seed historical-agent players (NPCs)
// ============================================================================
// Computes a real natal chart for each historical figure (planets via
// feeder/ephemeris.ts, Ascendant/MC + dignities ported from the client) and
// calls the admin-gated `seed_agent_player` reducer over the HTTP /call API —
// the same transport src/net/spacetime.js uses, with the owner Bearer token.
//
// Each agent maps to a DETERMINISTIC identity server-side (Identity::from_claims
// "pentacles:agent" / agent_key), so re-running is idempotent.
//
// Usage:
//   SPACETIMEDB_DB=pentacles2xtest bun run scripts/seed-agents.ts          # seed all
//   SPACETIMEDB_DB=pentacles2xtest bun run scripts/seed-agents.ts einstein # one key
//   ...append --dry to compute + print charts without calling the reducer.
// Auth: SPACETIME_TOKEN env, else spacetimedb_token from ~/.config/spacetime/cli.toml.
// ============================================================================
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { julianDay, geocentricEclipticLon } from "../feeder/ephemeris.ts";
import { FIGURES, Figure } from "./agents-data.ts";

const URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const DB = process.env.SPACETIMEDB_DB ?? "pentacles2xtest";

// ── astronomy (ported verbatim from public/sky.js + astro-weather.js) ────────
const OBLIQUITY_DEG = 23.439291;
const D2R = Math.PI / 180, R2D = 180 / Math.PI, EPS_R = OBLIQUITY_DEG * D2R;
const n360 = (d: number) => ((d % 360) + 360) % 360;

function gmstDeg(date: Date): number {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const d = jd - 2451545.0, t = d / 36525.0;
  return n360(280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000.0);
}
const lstDeg = (date: Date, eastLon: number) => n360(gmstDeg(date) + eastLon);
const eclLonFromRA = (raDeg: number) => {
  const ra = raDeg * D2R;
  return n360(Math.atan2(Math.sin(ra), Math.cos(ra) * Math.cos(EPS_R)) * R2D);
};
const mcLambda = (date: Date, lon: number) => eclLonFromRA(lstDeg(date, lon));
function ascLambda(latDeg: number, lonDeg: number, date: Date): number {
  const ramc = lstDeg(date, lonDeg) * D2R, lat = latDeg * D2R;
  return n360(Math.atan2(Math.cos(ramc), -(Math.sin(EPS_R) * Math.tan(lat) + Math.cos(EPS_R) * Math.sin(ramc))) * R2D);
}

// ── dignity (ported from public/astro-weather.js) ────────────────────────────
const SIGN_RULERS = [4, 3, 2, 1, 0, 2, 3, 9, 5, 6, 7, 8]; // body idx ruling each sign
const EXALT_SIGN: (number | null)[] = [0, 1, 5, 11, 9, 3, 6, null, null, null]; // exaltation sign per body
function dignityScore(body: number, sign: number): number {
  sign = ((sign % 12) + 12) % 12;
  if (body >= 10) return 0;
  if (SIGN_RULERS[sign] === body) return 5;          // domicile
  if (EXALT_SIGN[body] === sign) return 4;           // exaltation
  if (SIGN_RULERS[(sign + 6) % 12] === body) return -5; // detriment
  if (EXALT_SIGN[body] != null && ((EXALT_SIGN[body] as number) + 6) % 12 === sign) return -4; // fall
  return 0;
}

// ── chart assembly ───────────────────────────────────────────────────────────
const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const SIGN_NAMES = ["Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo", "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces"];
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const planetEnum = (idx: number) => ({ [lowerFirst(PLANET_NAMES[idx] || "Sun")]: [] });
const ZERO_IDENTITY = { __identity__: "0x" + "0".repeat(64) };
const degToMin = (deg: number) => ((Math.round(n360(deg) * 60) % 21600) + 21600) % 21600;

/** Signed shortest delta a→b in (-180,180]. */
const signedDelta = (a: number, b: number) => ((n360(b) - n360(a) + 540) % 360) - 180;
const circDist = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, 21600 - d); };

function buildChart(fig: Figure) {
  const jd = julianDay(fig.date);
  const placements = [];
  const positions: { body: number; lon: number; sign: number; deg: number; retro: boolean; dig: number }[] = [];
  for (let body = 0; body < 10; body++) {
    const lon = n360(geocentricEclipticLon(body, jd));
    // retrograde from a ±0.5d central difference (Sun/Moon never retrograde)
    const before = n360(geocentricEclipticLon(body, jd - 0.5));
    const after = n360(geocentricEclipticLon(body, jd + 0.5));
    const retro = body > 1 && signedDelta(before, after) < 0;
    const sign = Math.floor(lon / 30) % 12;
    const within = lon - sign * 30;
    const arc_minutes = Math.max(0, Math.min(1799, Math.round(within * 60)));
    const dig = dignityScore(body, sign);
    placements.push({ body: planetEnum(body), sign, arc_minutes, retrograde: retro, dignity: dig });
    positions.push({ body, lon, sign, deg: within, retro, dig });
  }
  const ascDeg = fig.timeKnown ? ascLambda(fig.lat, fig.lon, fig.date) : 0;
  const mcDeg = fig.timeKnown ? mcLambda(fig.date, fig.lon) : 0;
  const ascendant = degToMin(ascDeg), midheaven = degToMin(mcDeg);

  const chart = {
    identity: ZERO_IDENTITY,
    birth_unix: Math.round(fig.date.getTime() / 1000),
    birth_lat: fig.lat,
    birth_lon: fig.lon,
    time_known: fig.timeKnown,
    placements,
    ascendant,
    midheaven,
    house_cusps: { none: [] },
    house_system: { placidus: [] },
    intercepted_signs: { none: [] },
  };

  // faction = top of faction_scores (mirrors server) → always passes top-3 gate
  const faction = topFaction(positions, ascendant, midheaven);
  return { chart, faction, positions, ascDeg, mcDeg };
}

/** Exact mirror of server chart::faction_scores (incl. its solar-chart quirks:
 *  ascendant=0 → Aries ruler bonus); returns the highest-scoring body idx, which
 *  is therefore guaranteed inside the reducer's top-3 gate. */
function topFaction(pos: { body: number; sign: number; deg: number; dig: number }[], ascMin: number, mcMin: number): number {
  const s = new Array(10).fill(0);
  s[SIGN_RULERS[Math.floor((ascMin / 1800) % 12)]] += 3.0; // chart-ruler ×3 (uses ascendant as-passed)
  for (const p of pos) {
    s[p.body] += 1.0 + p.dig * 0.4;
    const absMin = p.sign * 1800 + Math.round(p.deg * 60);
    if (circDist(absMin, ascMin) < 600 || circDist(absMin, mcMin) < 600) s[p.body] += 1.5;
    if (p.body === 0) s[SIGN_RULERS[p.sign]] += 2.0; // Sun's sign ruler
    if (p.body === 1) s[SIGN_RULERS[p.sign]] += 2.0; // Moon's sign ruler
  }
  let best = 0;
  for (let i = 1; i < 10; i++) if (s[i] > s[best]) best = i;
  return best;
}

// ── reducer call (HTTP /call + owner Bearer token) ───────────────────────────
function ownerToken(): string {
  if (process.env.SPACETIME_TOKEN) return process.env.SPACETIME_TOKEN;
  const toml = readFileSync(`${homedir()}/.config/spacetime/cli.toml`, "utf8");
  const m = toml.match(/^spacetimedb_token\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error("no owner token (set SPACETIME_TOKEN or `spacetime login`)");
  return m[1];
}

async function seed(fig: Figure, token: string, dry: boolean) {
  const { chart, faction, positions, ascDeg } = buildChart(fig);
  const summary = positions
    .map((p) => `${PLANET_NAMES[p.body]} ${SIGN_NAMES[p.sign]} ${Math.floor(p.deg)}°${p.retro ? "℞" : ""}`)
    .join(", ");
  console.log(`\n▸ ${fig.handle}  [${fig.key}]  ${fig.note ?? ""}`);
  console.log(`  ${summary}`);
  console.log(`  ASC ${SIGN_NAMES[Math.floor(n360(ascDeg) / 30) % 12]} ${Math.floor(n360(ascDeg) % 30)}° · faction ${PLANET_NAMES[faction]}`);
  if (dry) return;

  const res = await fetch(`${URI}/v1/database/${DB}/call/seed_agent_player`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify([fig.key, fig.handle, chart, planetEnum(faction)]),
  });
  if (!res.ok) throw new Error(`  ✗ ${fig.key} → ${res.status}: ${await res.text().catch(() => "")}`);
  console.log(`  ✓ seeded → ${DB}`);
}

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const keys = args.filter((a) => !a.startsWith("--"));
const roster = keys.length ? FIGURES.filter((f) => keys.includes(f.key)) : FIGURES;
if (!roster.length) { console.error("no matching figures"); process.exit(1); }

const token = dry ? "" : ownerToken();
for (const fig of roster) {
  await seed(fig, token, dry).catch((e) => { console.error(String(e.message ?? e)); process.exitCode = 1; });
}
console.log(`\nDone (${dry ? "dry-run" : "seeded " + roster.length} ).`);
