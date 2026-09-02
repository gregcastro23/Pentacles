// Pentacles — Jing Arena Companion Service.
//
// Subscribes to SpacetimeDB over WebSocket for OPEN Jing duels aimed at a
// planetary agent (plus a periodic /sql re-sweep for duels a transient failure
// left open), asks the agent brain for the counter via brainCall (primary
// FastAPI backend, then the Vercel Next.js fallback — see brain.ts), and
// answers each via the owner-gated `answer_jing` reducer: the agent declares a
// counter move (a move that beats the opening, from the Jing counter graph)
// and a voice line, which resolves the duel. If BOTH brains fail, the local
// counter-graph pick still wins the duel (no persona voice). Mirrors
// duel-service.ts.
//
// Usage:   bun run jing-service.ts
// Env:     SPACETIMEDB_DB (default cookingwithcastrollc), RESWEEP_MS (300000),
//          PLANETARY_AGENTS_BACKEND_URL (default https://api.agents.alchm.kitchen)
//          primary brain, BRAIN_FALLBACK_URL (default
//          https://alchm-agents-eth.vercel.app) fallback brain.

import { startFeed } from "./stdb-feed";
import { cliCall, resolveFeederEnv } from "./spacetime-cli";
import { brainCall, BRAIN_PRIMARY_URL, BRAIN_FALLBACK_URL } from "./brain";

const { db: DB, uri: SPACETIMEDB_URI, token: SPACETIME_TOKEN } = resolveFeederEnv();

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
    // Enum args pass as SATS-JSON sum values: { "variant": [] }. The sum is
    // pre-encoded, so it goes through as {raw} to reach the CLI verbatim (its
    // param type is a sum, not String); the voice line is a plain string and
    // gets JSON-encoded by cliCall (it can contain quotes).
    await cliCall(DB, "answer_jing", [duelId, { raw: JSON.stringify(argMove) }, voice]);
  }
}

// Ask the agent brain (primary → fallback, see brain.ts) for the move/voice.
// Returns null when both brains fail, so the caller uses the local counter pick.
// Contract: 200 {success, planet, move, voice, element, source, timestamp};
// a move the counter graph doesn't know is contract-violating (never play a
// move the server would reject).
async function backendMove(planet: string, opening: string): Promise<{ move: string; voice: string } | null> {
  return brainCall<{ move: string; voice: string }>({
    path: "/api/agents/jing",
    label: "Jing",
    body: { planet, opening, source: "pentacles-jing-feeder" },
    // Object.hasOwn (not a truthiness/undefined check): COUNTER_OF is a plain
    // object literal, so inherited Object.prototype keys ("constructor",
    // "toString", …) coming back as json.move would otherwise pass validation,
    // get posted as an unknown JingMove variant, be rejected by the server, and
    // wedge the duel with the local fallback bypassed.
    validate: (json) =>
      json?.success === true && typeof json.move === "string" && Object.hasOwn(COUNTER_OF, json.move)
        ? { move: json.move, voice: String(json.voice ?? "") }
        : null,
  });
}

export interface JingDuelRow {
  duel_id: number | string;
  opening_move?: string;
  target_agent?: string | null;
  state?: string;
}

// Open agent-targeted duel: state Open AND target_agent is a Planet variant name.
function isOpenAgentDuel(row: JingDuelRow): boolean {
  const agent = row.target_agent;
  return row.state === "Open" && typeof agent === "string" && /^[A-Za-z]+$/.test(agent);
}

async function processDuel(row: JingDuelRow): Promise<void> {
  // Rows arrive normalized: opening_move/target_agent are variant-name strings
  // ("Meltdown" / "Mars"), target_agent is null for player-vs-player duels.
  const duelId = Number(row.duel_id);
  const opening = String(row.opening_move ?? "");
  const agent = typeof row.target_agent === "string" ? row.target_agent : "";
  if (isNaN(duelId) || !Object.hasOwn(COUNTER_OF, opening)) {
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
    // Duel stays Open — the RESWEEP_MS re-sweep re-delivers it.
    console.error(`[Jing] Failed to answer #${duelId}:`, (err as Error).message.split("\n")[0]);
  }
}

async function main(): Promise<void> {
  console.log(`Pentacles Jing Arena companion starting.`);
  console.log(`  Database: ${DB}`);
  console.log(`  Brain: ${BRAIN_PRIMARY_URL} (fallback ${BRAIN_FALLBACK_URL}; local counter graph last)`);
  console.log(`  Transport: WebSocket subscription (reactive) + periodic /sql re-sweep\n`);

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
