// Pentacles — real-ephemeris feeder.
//
// Computes the live geocentric position of all ten bodies and pushes them into
// SpacetimeDB via the owner-gated `push_ephemeris` reducer. Writes go over HTTP
// POST /call with `Authorization: Bearer SPACETIME_TOKEN` (the primary path for
// hosting); when the token is blank it falls back to shelling out to the
// `spacetime` CLI, which authenticates as your logged-in owner identity
// (c2007058…ddb52).
//
//   bun run push-ephemeris.ts          # loop forever (default 15 min)
//   bun run push-ephemeris.ts --once   # single pass (for an external cron)
//
// Env: SPACETIMEDB_DB (default cookingwithcastrollc), FEED_INTERVAL_MIN (15).

import { bodyEquatorial, geocentricEclipticLon, julianDay } from "./ephemeris.ts";
import { cliCall } from "./spacetime-cli";

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const INTERVAL_MIN = Number(process.env.FEED_INTERVAL_MIN ?? "15");
const BODIES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";

// Canonical (global) transit zone: the planet's ecliptic longitude mapped into
// the eleven zones. Each player's AR view anchors the Pentacle to their own
// horizon; this is the shared "which zone is the planet traversing" the server
// uses for home zones, the transit buff, and bot raids.
function zoneForEclipticLon(lonDeg: number): number {
  return Math.min(10, Math.floor((lonDeg / 360) * 11));
}

// Apparent retrograde: ecliptic longitude moving backwards vs a day earlier. The
// signed shortest delta is negative when the body is retrograding. The Sun and Moon
// never reverse, so this naturally reports them direct. Drives a drafted card's
// inversion server-side (a retrograde source mints inverted, with reversed stats).
function isRetrograde(idx: number, jd: number): boolean {
  const lonNow = geocentricEclipticLon(idx, jd);
  const lonPrev = geocentricEclipticLon(idx, jd - 1);
  const delta = ((lonNow - lonPrev + 540) % 360) - 180; // (-180, 180]
  return delta < 0;
}

async function pushOnce(): Promise<void> {
  const jd = julianDay(new Date());
  for (let idx = 0; idx < 10; idx++) {
    const { ra, dec, eclLon } = bodyEquatorial(idx, jd);
    const zone = zoneForEclipticLon(eclLon);
    const retro = isRetrograde(idx, jd);
    try {
      if (SPACETIME_TOKEN) {
        const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/push_ephemeris`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${SPACETIME_TOKEN}`,
          },
          body: JSON.stringify([idx, Number(ra.toFixed(5)), Number(dec.toFixed(5)), zone, retro]),
        });
        if (!res.ok) {
          throw new Error(`HTTP push_ephemeris failed: ${await res.text().catch(() => "")}`);
        }
      } else {
        // All-numeric/bool args — pass as bare literals (a JS string here would
        // be JSON-quoted by cliCall and no longer parse as an f64).
        await cliCall(DB, "push_ephemeris", [
          idx, Number(ra.toFixed(5)), Number(dec.toFixed(5)), zone, retro,
        ]);
      }
      console.log(`✦ ${BODIES[idx].padEnd(8)} RA ${ra.toFixed(2)}°  Dec ${dec.toFixed(2)}°  → zone ${zone}${retro ? "  ℞" : ""}`);
    } catch (e) {
      console.error(`✗ ${BODIES[idx]}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  console.log(`Pentacles ephemeris feeder → ${DB}${once ? " (once)" : ` (every ${INTERVAL_MIN} min)`}`);
  await pushOnce();
  if (once) return;
  setInterval(pushOnce, INTERVAL_MIN * 60_000);
}

main();

