// Pentacles — AI Planetary Agent Word Duel Companion Service.
//
// Periodically polls SpacetimeDB for unanswered Word Duel challenges,
// calls the Planetary Agents AI backend's `/api/agents/word-duel` endpoint,
// and pushes the agent's move back via the owner-gated `answer_duel` reducer.
//
// Usage:
//   bun run duel-service.ts
//
// Environment options:
//   SPACETIMEDB_DB (default: cookingwithcastrollc)
//   PLANETARY_AGENTS_BACKEND_URL (default: https://alchm-agents-eth.vercel.app)
//   POLL_INTERVAL_MS (default: 3000)

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
// The AlchmAgents Next.js move-brain (app/api/agents/word-duel). NOT the Python
// FastAPI at api.agents.alchm.kitchen — that host has no move endpoint.
const BACKEND_URL = process.env.PLANETARY_AGENTS_BACKEND_URL ?? "https://alchm-agents-eth.vercel.app";

// Read via the HTTP SQL API (clean JSON). The CLI's ASCII-table output wraps long
// string columns (e.g. the candidates JSON array), which the fixed-width
// parseTable below can't recover; the HTTP rows are positional SATS values we
// decode by schema. Writes still go through `spacetime call` (owner-gated).
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";

// Push a move back through the owner-gated reducer.
async function answerDuel(
  challengeId: number,
  word: string,
  rationale: string,
  score: number
): Promise<void> {
  // Clamp to a valid u32 — the reducer's agent_score is u32, so a negative,
  // fractional, or over-range score from the brain would reject the call and
  // wedge the queue. The backend's scorer is a positive int in practice; this
  // is defense-in-depth so a malformed move can never stall the duel.
  score = Math.max(0, Math.min(0xffffffff, Math.round(Number(score) || 0)));
  if (SPACETIME_TOKEN) {
    const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/answer_duel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SPACETIME_TOKEN}`,
      },
      body: JSON.stringify([challengeId, word, rationale, score]),
    });
    if (!res.ok) {
      throw new Error(`HTTP answer_duel failed: ${await res.text().catch(() => "")}`);
    }
  } else {
    await run(SPACETIMEDB_CLI, [
      "call",
      DB,
      "answer_duel",
      "--",
      String(challengeId),
      word,
      rationale,
      String(score),
    ]);
  }
}

async function processChallenge(row: Record<string, any>): Promise<void> {
  // Rows arrive already normalized (snake_case keys, plain values) from the WS feed:
  // `player` is a hex identity string, `opponent` a Planet variant name, `candidates`
  // the JSON-array string the server stored.
  const player = String(row.player ?? "");
  const opponent = String(row.opponent ?? "");
  const playerWord = String(row.player_word ?? "");
  const playerScore = Number(row.player_score);
  const agentRack = String(row.agent_rack ?? "");
  const rawCandidates = String(row.candidates ?? "");

  const challengeId = Number(row.challenge_id);
  if (isNaN(challengeId)) {
    console.error(`[WordDuel] Skipping invalid challenge ID: ${row.challenge_id}`);
    return;
  }

  let candidates: string[] = [];
  try {
    candidates = JSON.parse(rawCandidates);
  } catch (e) {
    console.error(`[WordDuel] Failed to parse candidates JSON: ${rawCandidates}`, e);
    return;
  }

  console.log(`\n[WordDuel] Processing challenge #${challengeId}...`);
  console.log(`  Opponent Faction: ${opponent}`);
  console.log(`  Agent Rack: "${agentRack}"`);
  console.log(`  Candidates Count: ${candidates.length}`);

  try {
    const targetUrl = `${BACKEND_URL}/api/agents/word-duel`;
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        planet: opponent,
        rack: agentRack,
        candidates: candidates,
        context: {
          playerWord: playerWord,
          playerScore: playerScore,
        },
        source: "pentacles-companion-feeder",
      }),
    });

    if (!response.ok) {
      throw new Error(`AI Backend returned status ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      success: boolean;
      move?: { word: string; rationale: string; score: number };
      error?: string;
    };

    if (!data.success || !data.move) {
      throw new Error(data.error ?? "AI Backend returned unsuccessful response");
    }

    const { word, rationale, score } = data.move;
    console.log(`[WordDuel] Agent selected "${word}" scoring ${score} pts.`);
    console.log(`  Rationale: "${rationale}"`);

    await answerDuel(challengeId, word, rationale, score);
    console.log(`[WordDuel] Challenge #${challengeId} successfully answered in SpacetimeDB.`);
  } catch (err) {
    console.error(`[WordDuel] Failed to process challenge #${challengeId}:`, err);
    // On failure, fall back to the greedy move to prevent wedging the queue
    console.log(`[WordDuel] Invoking greedy fallback solver for #${challengeId}...`);
    const fallbackWord = candidates[0] ?? "";
    const fallbackScore = fallbackWord ? Math.round(fallbackWord.length * 1.5) : 0; // Simple fallback score
    const fallbackRationale = `The cosmic alignments shift. ${opponent} relies on the structural path of least resistance.`;
    
    try {
      await answerDuel(challengeId, fallbackWord, fallbackRationale, fallbackScore);
      console.log(`[WordDuel] Challenge #${challengeId} closed via greedy fallback.`);
    } catch (fallbackErr) {
      console.error(`[WordDuel] Critical: Failed to write fallback for #${challengeId}:`, fallbackErr);
    }
  }
}

async function main(): Promise<void> {
  console.log(`Pentacles Word Duel Companion service starting.`);
  console.log(`  Database: ${DB}`);
  console.log(`  Backend URL: ${BACKEND_URL}`);
  console.log(`  Transport: WebSocket subscription (reactive)\n`);

  // React to new unanswered Word Duel challenges as they arrive (plus the startup backlog).
  startFeed({
    uri: SPACETIMEDB_URI,
    db: DB,
    token: SPACETIME_TOKEN || undefined,
    table: "duel_challenge",
    query: "SELECT * FROM duel_challenge WHERE answered = false",
    idField: "challenge_id",
    accept: (r) => r.answered === false,
    label: "WordDuel",
    onRow: processChallenge,
  });
}

main();
