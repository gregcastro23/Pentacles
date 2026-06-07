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
import { bodyEquatorial, julianDay } from "./ephemeris.ts";

const run = promisify(execFile);

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const INTERVAL_MIN = Number(process.env.FEED_INTERVAL_MIN ?? "15");
const BODIES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

// Canonical (global) transit zone: the planet's ecliptic longitude mapped into
// the eleven zones. Each player's AR view anchors the Pentacle to their own
// horizon; this is the shared "which zone is the planet traversing" the server
// uses for home zones, the transit buff, and bot raids.
function zoneForEclipticLon(lonDeg: number): number {
  return Math.min(10, Math.floor((lonDeg / 360) * 11));
}

async function pushOnce(): Promise<void> {
  const jd = julianDay(new Date());
  for (let idx = 0; idx < 10; idx++) {
    const { ra, dec, eclLon } = bodyEquatorial(idx, jd);
    const zone = zoneForEclipticLon(eclLon);
    try {
      await run("spacetime", [
        "call", DB, "push_ephemeris", "--",
        String(idx), ra.toFixed(5), dec.toFixed(5), String(zone),
      ]);
      console.log(`✦ ${BODIES[idx].padEnd(8)} RA ${ra.toFixed(2)}°  Dec ${dec.toFixed(2)}°  → zone ${zone}`);
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
