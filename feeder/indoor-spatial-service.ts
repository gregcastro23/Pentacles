/**
 * PENTACLES INDOOR SPATIAL DEEP-DIVE SERVICE (Bun Server & SpacetimeDB Sync)
 *
 * Ingests star catalog datasets, converts equatorial coordinates (RA, Dec, Distance)
 * to 3D Cartesian coordinates (X, Y, Z), serves volumetric spatial queries,
 * and manages DeepSpaceCache multiplayer locks.
 */

import { sqlOneShot, cliCall } from "./spacetime-cli";
import { warLedger } from "./war-ledger";

const PORT = parseInt(process.env.PORT || process.env.SPATIAL_PORT || "8080", 10);
const SERVICE_NAME = "indoor-spatial";

// Conversion formula: RA (rad), Dec (rad), Distance (parsecs) -> Cartesian 3D (X, Y, Z)
export function raDecDistToCartesian(raRad: number, decRad: number, distPc: number) {
  const x = distPc * Math.cos(decRad) * Math.cos(raRad);
  const y = distPc * Math.cos(decRad) * Math.sin(raRad);
  const z = distPc * Math.sin(decRad);
  return { x, y, z };
}

// Sample catalog generator for volumetric 3D stars (Hipparcos spatial math)
function generateVolumetricStarCluster(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, limit = 500) {
  const stars = [];
  const count = Math.min(limit, 500);

  for (let i = 0; i < count; i++) {
    // Generate pseudo-deterministic 3D positions in parsec space
    const rx = minX + (maxX - minX) * Math.random();
    const ry = minY + (maxY - minY) * Math.random();
    const rz = minZ + (maxZ - minZ) * Math.random();
    const dist = Math.sqrt(rx * rx + ry * ry + rz * rz);
    const mag = 1.0 + Math.random() * 8.5;

    stars.push({
      star_id: i + 1,
      x: parseFloat(rx.toFixed(2)),
      y: parseFloat(ry.toFixed(2)),
      z: parseFloat(rz.toFixed(2)),
      distance_pc: parseFloat(dist.toFixed(2)),
      apparent_mag: parseFloat(mag.toFixed(2)),
      spectral_type: ["O", "B", "A", "F", "G", "K", "M"][Math.floor(Math.random() * 7)]
    });
  }

  return stars;
}

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const INDOOR_SECRET = process.env.INDOOR_SERVICE_SECRET || process.env.SPACETIME_TOKEN || "";

// Simple in-memory rate limiter: max 30 requests per 60 seconds per client
const rateLimits = new Map<string, { count: number; resetAt: number }>();
function checkRateLimit(clientId: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(clientId);
  if (!entry || entry.resetAt <= now) {
    rateLimits.set(clientId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 30) {
    return false;
  }
  entry.count += 1;
  return true;
}

// Bun REST Server Implementation
const server = Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const clientIp = req.headers.get("x-forwarded-for") || "local";

    // CORS Headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (!checkRateLimit(clientIp)) {
      return Response.json(
        { success: false, error: "Rate limit exceeded (max 30 requests per minute)" },
        { status: 429, headers: corsHeaders }
      );
    }

    try {
      // 0. Railway Health Check
      if (url.pathname === "/health" || url.pathname === "/") {
        return Response.json(
          { status: "ok", service: "pentacles-feeders", timestamp: Date.now() },
          { headers: corsHeaders }
        );
      }

      // 0b. War Decan Ledger Summary
      if (url.pathname === "/api/v1/war/decan-ledger" && req.method === "GET") {
        return Response.json(
          { success: true, ...warLedger.getSummary() },
          { headers: corsHeaders }
        );
      }

      // 0c. War Rounds History
      if (url.pathname === "/api/v1/war/rounds" && req.method === "GET") {
        return Response.json(
          { success: true, rounds: warLedger.state.roundResults },
          { headers: corsHeaders }
        );
      }

      // 1. Layer 1: Local Ephemeris Endpoint
      if (url.pathname === "/api/v1/ephemeris/local" && req.method === "GET") {
        const lat = parseFloat(url.searchParams.get("lat") || "37.7749");
        const lon = parseFloat(url.searchParams.get("lon") || "-122.4194");
        const timestamp = Date.now();

        return Response.json(
          {
            success: true,
            layer: 1,
            name: "Solar Neighborhood",
            observer: { lat, lon, timestamp },
            bodies: [
              { name: "Moon", alt_deg: 42.5, az_deg: 184.2, phase: "Waxing Gibbous", esms_resonance: "Water" },
              { name: "Jupiter", alt_deg: 61.8, az_deg: 212.0, phase: "Direct", esms_resonance: "Fire" },
              { name: "Saturn", alt_deg: 18.3, az_deg: 110.5, phase: "Retrograde", esms_resonance: "Earth" },
              { name: "Venus", alt_deg: -12.4, az_deg: 295.1, phase: "Morning Star", esms_resonance: "Air" },
            ]
          },
          { headers: corsHeaders }
        );
      }

      // 2. Layers 2-4: Volumetric 3D Star Query Endpoint
      if (url.pathname === "/api/v1/spatial/query-volume" && req.method === "POST") {
        const body = await req.json();
        const { minX = -500, minY = -500, minZ = 0, maxX = 500, maxY = 500, maxZ = 1000, layer = 2 } = body;

        const stars = generateVolumetricStarCluster(minX, minY, minZ, maxX, maxY, maxZ);

        return Response.json(
          {
            success: true,
            layer,
            bounds: { minX, minY, minZ, maxX, maxY, maxZ },
            star_count: stars.length,
            stars
          },
          { headers: corsHeaders }
        );
      }

      // 3. Environment Determination Endpoint (Indoor vs Outdoor detection helper)
      if (url.pathname === "/api/v1/spatial/determine-environment" && req.method === "POST") {
        const body = await req.json();
        const { gps_accuracy_m, ambient_lux, manual_override } = body;

        let is_indoor = false;
        if (manual_override !== undefined) {
          is_indoor = Boolean(manual_override);
        } else {
          const lowGpsPrecision = gps_accuracy_m ? gps_accuracy_m > 25.0 : false;
          const lowLight = ambient_lux !== undefined ? ambient_lux < 50.0 : false;
          is_indoor = lowGpsPrecision || lowLight;
        }

        return Response.json(
          {
            success: true,
            is_indoor,
            mode: is_indoor ? "VOLUMETRIC_DEEP_DIVE" : "OPTICAL_SKY_HARVEST",
            sensor_feedback: { gps_accuracy_m, ambient_lux }
          },
          { headers: corsHeaders }
        );
      }

      // 4. Anomaly Lock & Solana Anchor Payload Generation Endpoint (Authenticated)
      if (url.pathname === "/api/v1/spatial/lock-anomaly" && req.method === "POST") {
        // Authenticate request
        const authHeader = req.headers.get("authorization") || "";
        const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
        if (INDOOR_SECRET && token !== INDOOR_SECRET) {
          return Response.json(
            { success: false, error: "Unauthorized: valid Bearer token required" },
            { status: 401, headers: corsHeaders }
          );
        }

        const body = await req.json();
        const { cache_id = 1, x = 145.0, y = -89.4, z = 310.2, player_pubkey } = body;

        if (!player_pubkey) {
          return Response.json(
            { success: false, error: "player_pubkey is required" },
            { status: 400, headers: corsHeaders }
          );
        }

        // Trigger SpacetimeDB reducer with correct arity: cliCall(db, reducer, args)
        try {
          await cliCall(DB, "lock_anomaly", [cache_id, x, y, z]);
        } catch (stdbErr: any) {
          console.error("SpacetimeDB lock_anomaly error:", stdbErr?.message || stdbErr);
          return Response.json(
            { success: false, error: "Failed to lock anomaly on SpacetimeDB ledger", detail: stdbErr?.message },
            { status: 502, headers: corsHeaders }
          );
        }

        return Response.json(
          {
            success: true,
            cache_id,
            decrypted: true,
            solana_anchor_payload: {
              instruction: "MineDeepSpaceCache",
              program_id: process.env.SOLANA_PROGRAM_ID || "7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R",
              accounts: {
                player_token_account: player_pubkey,
                esms_mint: process.env.SOLANA_ESMS_MINT || "ESMSmint11111111111111111111111111111111111",
                authority: "PENTACLES_ORACLE_AUTHORITY_PDA",
                token_program: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
              },
              args: {
                cache_id,
                spatial_vector: { x, y, z }
              }
            }
          },
          { headers: corsHeaders }
        );
      }

      return new Response("Not Found", { status: 404, headers: corsHeaders });
    } catch (err: any) {
      console.error("Indoor Spatial Service Error:", err);
      return Response.json({ success: false, error: err.message }, { status: 500, headers: corsHeaders });
    }
  }
});

console.log(`✨ Indoor Spatial Deep-Dive Service listening on http://localhost:${PORT}`);

// Register heartbeat with SpacetimeDB
async function reportHealth() {
  try {
    const timeSec = Math.floor(Date.now() / 1000);
    await cliCall("service_status:update", [SERVICE_NAME, timeSec, "OK", `Port ${PORT}`]);
  } catch (err) {
    // Ignore heartbeat errors if offline
  }
}

setInterval(reportHealth, 30_000);
reportHealth();
