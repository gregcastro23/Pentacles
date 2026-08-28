// Pentacles — Historical ALCHM Agents Gameplay & Zone Flux Companion Service.
//
// Historical agents (e.g. Newton, Paracelsus, Dee, Flamel, Hypatia, etc.) actively
// participate in setting the table for Pentacles gameplay.
// This daemon service evaluates live planetary ephemeris transits and historical agent
// natal placements to dynamically bring zones IN FLUX (`trigger_zone_flux`).
//
// Usage:
//   bun run historical-agent-service.ts
//
// Environment:
//   SPACETIMEDB_DB       (default: cookingwithcastrollc)
//   FLUX_SWEEP_MS        (default: 60000) interval for checking and triggering zone flux

import { sqlOneShot } from "./stdb-feed";
import { cliCall } from "./spacetime-cli";

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";
const FLUX_SWEEP_MS = Number(process.env.FLUX_SWEEP_MS ?? "60000");

// `sqlOneShot` takes (uri, db, token, query). This file used to call it with two
// arguments, so `query` was undefined and the URI was the bare database name —
// the fetch threw "cannot be parsed as a URL" on every sweep, straight into the
// catch below, and the service silently did nothing. Same shape as the helper in
// constellation-service.ts.
const sql = (query: string) => sqlOneShot(SPACETIMEDB_URI, DB, SPACETIME_TOKEN || undefined, query);

// Known historical constellation mapping per zone (0..10)
const ZONE_CONSTELLATIONS: Record<number, number> = {
  0: 1,  // Aries / Andromeda
  1: 2,  // Taurus / Orion
  2: 3,  // Gemini / Canis Major
  3: 4,  // Cancer / Ursa Major
  4: 5,  // Leo / Leo
  5: 6,  // Virgo / Boötes
  6: 7,  // Libra / Corona Borealis
  7: 8,  // Scorpio / Scorpius
  8: 9,  // Sagittarius / Cygnus
  9: 10, // Capricorn / Pegasus
  10: 11 // Aquarius/Pisces / Cassiopeia
};

async function callTriggerZoneFlux(
  zoneId: number,
  constellationId: number,
  intensity: number,
  durationSecs: number
): Promise<void> {
  if (SPACETIME_TOKEN) {
    const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/trigger_zone_flux`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SPACETIME_TOKEN}`,
      },
      body: JSON.stringify([zoneId, constellationId, intensity, durationSecs]),
    });
    if (!res.ok) {
      console.warn(`[historical-agents] HTTP trigger_zone_flux failed: ${await res.text().catch(() => "")}`);
    }
  } else {
    await cliCall(DB, "trigger_zone_flux", [zoneId, constellationId, intensity, durationSecs]);
  }
}

async function reportHealth(detail: string): Promise<void> {
  try {
    if (SPACETIME_TOKEN) {
      await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/report_service_health`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SPACETIME_TOKEN}`,
        },
        body: JSON.stringify(["historical-agents", true, detail, 0]),
      });
    } else {
      await cliCall(DB, "report_service_health", ["historical-agents", true, detail, 0]);
    }
  } catch {
    // Non-critical heartbeat write failure
  }
}

export async function evaluateHistoricalAgentFlux(): Promise<void> {
  try {
    // Query active zones, ephemeris transits, and agent war presence
    const [zoneRows, ephemerisRows, agentRows, tableRows] = await Promise.all([
      sql("SELECT zone_id, in_flux, control FROM zone"),
      sql("SELECT body, transiting_zone FROM ephemeris"),
      sql("SELECT identity FROM agent_chart").catch(() => [] as any[]),
      sql("SELECT table_id, state FROM melee_table").catch(() => [] as any[]),
    ]);

    if (!zoneRows || zoneRows.length === 0) return;

    // Identify zones that are candidate for FLUX
    // Planets transiting high-friction zones trigger FLUX to make the landscape competitive
    const transitingZones = new Set(ephemerisRows.map((e) => Number(e.transiting_zone)));

    for (const z of zoneRows) {
      const zoneId = Number(z.zone_id);
      const inFlux = Boolean(z.in_flux);
      const isTransited = transitingZones.has(zoneId);

      // If zone is not currently in flux and is being transited by historical agent planets
      if (!inFlux && isTransited) {
        const constellationId = ZONE_CONSTELLATIONS[zoneId] ?? 1;
        const intensity = 75 + Math.floor(Math.random() * 25);
        const durationSecs = 1800; // 30 minutes of zone flux

        console.log(`[historical-agents] Historical agents triggering FLUX on Zone ${zoneId} (Constellation ${constellationId})`);
        await callTriggerZoneFlux(zoneId, constellationId, intensity, durationSecs);
      }
    }

    const agentCount = agentRows ? agentRows.length : 0;
    const activeTables = tableRows ? tableRows.filter((t: any) => String(t.state).toLowerCase() !== "resolved").length : 0;
    await reportHealth(`active (${agentCount} agents, ${activeTables} active tables, ${zoneRows.length} zones)`);
  } catch (err) {
    console.error("[historical-agents] Error during historical agent flux sweep:", err);
  }
}

export function startHistoricalAgentService(): void {
  console.log(`[historical-agents] Starting Historical ALCHM Agent Flux companion service (interval ${FLUX_SWEEP_MS}ms)`);
  
  // Initial sweep
  evaluateHistoricalAgentFlux();

  // Periodic interval
  setInterval(() => {
    evaluateHistoricalAgentFlux();
  }, FLUX_SWEEP_MS);
}

if (import.meta.main) {
  startHistoricalAgentService();
}
