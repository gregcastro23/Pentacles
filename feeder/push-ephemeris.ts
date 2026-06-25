// Pentacles — real-ephemeris feeder.
//
// Computes the live geocentric position of all ten bodies and pushes them into
// SpacetimeDB via the owner-gated `push_ephemeris` reducer. It shells out to the
// `spacetime` CLI, so it authenticates as your logged-in owner identity
// (c2007058…ddb52) — no token plumbing required.
//
//   bun run push-ephemeris.ts          # loop forever (default 15 min)
//   bun run push-ephemeris.ts --once   # single pass (for an external cron)
//
// Env: SPACETIMEDB_DB (default cookingwithcastrollc), FEED_INTERVAL_MIN (15).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { bodyEquatorial, geocentricEclipticLon, julianDay } from "./ephemeris.ts";

const run = promisify(execFile);

function getSpacetimeCli(): string {
  if (process.env.SPACETIMEDB_CLI) return process.env.SPACETIMEDB_CLI;
  if (process.env.HOME) {
    const localBin = join(process.env.HOME, ".local", "bin", "spacetime");
    if (existsSync(localBin)) return localBin;
  }
  return "spacetime";
}
const SPACETIMEDB_CLI = getSpacetimeCli();

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
        await run(SPACETIMEDB_CLI, [
          "call", DB, "push_ephemeris", "--",
          String(idx), ra.toFixed(5), dec.toFixed(5), String(zone), String(retro),
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

