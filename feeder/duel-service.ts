// Pentacles — AI Planetary Agent Word Duel Companion Service.
//
// Subscribes to SpacetimeDB over WebSocket for unanswered Word Duel challenges
// (plus a periodic /sql re-sweep for rows a transient failure left behind),
// asks the agent brain for a move via brainCall (primary FastAPI backend, then
// the Vercel Next.js fallback — see brain.ts), and pushes the agent's move
// back via the owner-gated `answer_duel` reducer. If BOTH brains fail, the
// local greedy candidate closes the challenge so the queue never wedges.
//
// Usage:
//   bun run duel-service.ts
//
// Environment options:
//   SPACETIMEDB_DB (default: cookingwithcastrollc)
//   PLANETARY_AGENTS_BACKEND_URL (default: https://api.agents.alchm.kitchen) primary brain
//   BRAIN_FALLBACK_URL (default: https://alchm-agents-eth.vercel.app) fallback brain
//   RESWEEP_MS (default: 300000) unanswered-row re-sweep period

import { startFeed } from "./stdb-feed";
import { cliCall } from "./spacetime-cli";
import { brainCall, BRAIN_PRIMARY_URL, BRAIN_FALLBACK_URL } from "./brain";

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";

// Reads arrive over the WebSocket feed (stdb-feed.ts) already normalized to
// snake_case rows — long string columns like the candidates JSON array come
// through intact, unlike the CLI's wrapped ASCII tables of old. Writes go over
// HTTP POST /call with the bearer token, falling back to `spacetime call`
// (owner-gated) when the token is blank.
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
    // cliCall JSON-encodes the strings (rationales can contain quotes) and
    // passes the numbers as bare literals.
    await cliCall(DB, "answer_duel", [challengeId, word, rationale, score]);
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

  // Ask the brain: primary (FastAPI) → fallback (Vercel Next.js) → null.
  // Contract: 200 {success, planet, move:{word,rationale,score,source,latencyMs}, timestamp}.
  const brainMove = await brainCall<{ word: string; rationale: string; score: number }>({
    path: "/api/agents/word-duel",
    label: "WordDuel",
    body: {
      planet: opponent,
      rack: agentRack,
      candidates: candidates,
      context: {
        playerWord: playerWord,
        playerScore: playerScore,
      },
      source: "pentacles-companion-feeder",
    },
    validate: (json) =>
      json?.success === true && json.move && typeof json.move.word === "string" && json.move.word
        ? {
            word: json.move.word,
            rationale: String(json.move.rationale ?? ""),
            score: Number(json.move.score ?? 0),
          }
        : null,
  });

  // Pick the brain's move, or the local greedy candidate when BOTH brains failed
  // (brainCall already logged the primary→fallback failure chain).
  let word: string, rationale: string, score: number;
  if (brainMove) {
    ({ word, rationale, score } = brainMove);
    console.log(`[WordDuel] Agent selected "${word}" scoring ${score} pts.`);
    console.log(`  Rationale: "${rationale}"`);
  } else {
    console.log(`[WordDuel] Invoking greedy fallback solver for #${challengeId}...`);
    word = candidates[0] ?? "";
    score = word ? Math.round(word.length * 1.5) : 0; // Simple fallback score
    rationale = `The cosmic alignments shift. ${opponent} relies on the structural path of least resistance.`;
  }

  try {
    await answerDuel(challengeId, word, rationale, score);
    console.log(`[WordDuel] Challenge #${challengeId} answered in SpacetimeDB${brainMove ? "" : " (greedy fallback)"}.`);
  } catch (err) {
    // Row stays answered=false — the RESWEEP_MS re-sweep re-delivers it.
    console.error(`[WordDuel] Failed to write answer for #${challengeId}:`, (err as Error).message.split("\n")[0]);
  }
}

async function main(): Promise<void> {
  console.log(`Pentacles Word Duel Companion service starting.`);
  console.log(`  Database: ${DB}`);
  console.log(`  Brain: ${BRAIN_PRIMARY_URL} (fallback ${BRAIN_FALLBACK_URL})`);
  console.log(`  Transport: WebSocket subscription (reactive) + periodic /sql re-sweep\n`);

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
