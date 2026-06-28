// Pentacles — Jing Arena Companion Service.
//
// Polls SpacetimeDB for OPEN Jing duels aimed at a planetary agent and answers
// each via the owner-gated `answer_jing` reducer: the agent declares a counter
// move (a move that beats the opening, from the Jing counter graph) and a voice
// line, which resolves the duel. Mirrors duel-service.ts.
//
// Usage:   bun run jing-service.ts
// Env:     SPACETIMEDB_DB (default cookingwithcastrollc), POLL_INTERVAL_MS (3000),
//          PLANETARY_AGENTS_BACKEND_URL (optional — if its /api/agents/jing
//          endpoint answers, that move/voice is used instead of the local pick).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { startFeed } from "./stdb-feed";

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
// AlchmAgents Next.js jing brain (app/api/agents/jing). Defaults to the deployed
// app; if unreachable, jing-service still answers from its local counter graph.
const BACKEND_URL = process.env.PLANETARY_AGENTS_BACKEND_URL ?? "https://alchm-agents-eth.vercel.app";
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";

// The counter graph (mirrors server JingMove::countered_by): the move that beats
// each opening. The agent plays to win by declaring it.
const COUNTER_OF: Record<string, string> = {
  Meltdown: "Vacuum",
  Freeze: "Meltdown",
  TectonicRoot: "Erode",
  Vacuum: "Freeze",
  Erode: "Vacuum",
};
const ELEMENT_OF: Record<string, string> = {
  Meltdown: "fire", Freeze: "water", TectonicRoot: "earth", Vacuum: "air", Erode: "water·earth",
};

function agentVoice(planet: string, opening: string, counter: string): string {
  const el = ELEMENT_OF[counter] ?? "elemental";
  return `${planet} answers your ${opening} with ${counter} — ${el} folding back on ${el === "water" ? "your heat" : "your stance"}.`;
}

// SpacetimeDB 2.x names sum variants in camelCase (lower-first: Vacuum→vacuum,
// TectonicRoot→tectonicRoot); PascalCase is rejected by the reducer.
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

async function answerJing(duelId: number, move: string, voice: string): Promise<void> {
  const argMove = { [lowerFirst(move)]: [] };
  if (SPACETIME_TOKEN) {
    const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/answer_jing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SPACETIME_TOKEN}`,
      },
      body: JSON.stringify([duelId, argMove, voice]),
    });
    if (!res.ok) {
      throw new Error(`HTTP answer_jing failed: ${await res.text().catch(() => "")}`);
    }
  } else {
    // Enum args pass as SATS-JSON sum values: { "Variant": [] }.
    await run(SPACETIMEDB_CLI, [
      "call", DB, "answer_jing", "--",
      String(duelId), JSON.stringify(argMove), voice,
    ]);
  }
}

// Optional: ask the planetary-agents backend for the move/voice. Falls back to
// the local counter pick on any failure.
async function backendMove(planet: string, opening: string): Promise<{ move: string; voice: string } | null> {
  if (!BACKEND_URL) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/api/agents/jing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planet, opening, source: "pentacles-jing-feeder" }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { move?: string; voice?: string };
    if (data.move && COUNTER_OF[data.move] !== undefined) return { move: data.move, voice: data.voice ?? "" };
    return null;
  } catch {
    return null;
  }
}

// Open agent-targeted duel: state Open AND target_agent is a Planet variant name.
function isOpenAgentDuel(row: Record<string, any>): boolean {
  const agent = row.target_agent;
  return row.state === "Open" && typeof agent === "string" && /^[A-Za-z]+$/.test(agent);
}

async function processDuel(row: Record<string, any>): Promise<void> {
  // Rows arrive normalized: opening_move/target_agent are variant-name strings
  // ("Meltdown" / "Mars"), target_agent is null for player-vs-player duels.
  const duelId = Number(row.duel_id);
  const opening = String(row.opening_move ?? "");
  const agent = typeof row.target_agent === "string" ? row.target_agent : "";
  if (isNaN(duelId) || !COUNTER_OF[opening]) {
    console.error(`[Jing] Skipping duel ${row.duel_id} (opening "${opening}")`);
    return;
  }
  const planet = agent && /^[A-Za-z]+$/.test(agent) ? agent : "The agent";
  console.log(`[Jing] Duel #${duelId}: ${planet} faces ${opening}`);
  const fromBackend = await backendMove(planet, opening);
  const move = fromBackend?.move ?? COUNTER_OF[opening];
  const voice = fromBackend?.voice || agentVoice(planet, opening, move);
  try {
    await answerJing(duelId, move, voice);
    console.log(`[Jing] Duel #${duelId} answered with ${move}.`);
  } catch (err) {
    console.error(`[Jing] Failed to answer #${duelId}:`, (err as Error).message.split("\n")[0]);
  }
}

async function main(): Promise<void> {
  console.log(`Pentacles Jing Arena companion starting.`);
  console.log(`  Database: ${DB}`);
  console.log(`  Backend:  ${BACKEND_URL || "(local counter pick)"}`);
  console.log(`  Transport: WebSocket subscription (reactive)\n`);

  // React to open agent-targeted Jing duels. Subscribe to the whole table and
  // filter client-side (enum + Option predicates aren't expressed in the query).
  startFeed({
    uri: SPACETIMEDB_URI,
    db: DB,
    token: SPACETIME_TOKEN || undefined,
    table: "jing_duel",
    query: "SELECT * FROM jing_duel",
    idField: "duel_id",
    accept: isOpenAgentDuel,
    label: "Jing",
    onRow: processDuel,
  });
}

main();
