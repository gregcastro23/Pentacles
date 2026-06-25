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
//   PLANETARY_AGENTS_BACKEND_URL (default: https://api.agents.alchm.kitchen)
//   POLL_INTERVAL_MS (default: 3000)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

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
const BACKEND_URL = process.env.PLANETARY_AGENTS_BACKEND_URL ?? "https://api.agents.alchm.kitchen";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "3000");

// Read via the HTTP SQL API (clean JSON). The CLI's ASCII-table output wraps long
// string columns (e.g. the candidates JSON array), which the fixed-width
// parseTable below can't recover; the HTTP rows are positional SATS values we
// decode by schema. Writes still go through `spacetime call` (owner-gated).
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";

function decodeSats(type: any, val: any): any {
  if (!type) return val;
  if (type.Sum) {
    const variants = type.Sum.variants ?? [];
    if (!Array.isArray(val)) return val;
    const [tag, payload] = val;
    const variant = variants[tag];
    const vname = (variant && (variant.name?.some ?? variant.name)) ?? String(tag);
    const isOption = variants.length === 2 && variants.some((v: any) => (v?.name?.some ?? v?.name) === "none");
    if (isOption) return vname === "none" ? null : decodeSats(variant?.algebraic_type, payload);
    return vname; // enum → variant name (e.g. "Mars")
  }
  return val; // Product (Identity → {__identity__}) + primitives pass through
}

async function queryRows(sql: string): Promise<Array<Record<string, any>>> {
  const headers: Record<string, string> = { "Content-Type": "text/plain" };
  if (SPACETIME_TOKEN) {
    headers["Authorization"] = `Bearer ${SPACETIME_TOKEN}`;
  }
  const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/sql`, {
    method: "POST",
    headers,
    body: sql,
  });
  if (!res.ok) throw new Error(`sql ${res.status}: ${await res.text().catch(() => "")}`);
  const json: any = await res.json();
  const stmt = Array.isArray(json) ? json[json.length - 1] : json;
  const els = stmt?.schema?.elements ?? [];
  const cols = els.map((e: any, i: number) => (typeof e?.name === "string" ? e.name : e?.name?.some ?? `col${i}`));
  const types = els.map((e: any) => e?.algebraic_type);
  return (stmt?.rows ?? []).map((row: any[]) => {
    const o: Record<string, any> = {};
    row.forEach((v, i) => (o[cols[i] ?? `col${i}`] = decodeSats(types[i], v)));
    return o;
  });
}

// Push a move back through the owner-gated reducer.
async function answerDuel(
  challengeId: number,
  word: string,
  rationale: string,
  score: number
): Promise<void> {
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

// Parser for SpacetimeDB CLI's plaintext table format
function parseTable(output: string): Array<Record<string, string>> {
  const lines = output.split("\n").map((l) => l.trimEnd());
  const separatorIndex = lines.findIndex((l) => {
    const trimmed = l.trim();
    return trimmed.length > 0 && /^[-\+]+$/.test(trimmed);
  });
  if (separatorIndex === -1) return [];
  const separatorLine = lines[separatorIndex];

  const boundaries: number[] = [];
  for (let i = 0; i < separatorLine.length; i++) {
    if (separatorLine[i] === "+") {
      boundaries.push(i);
    }
  }

  const headerLine = lines[separatorIndex - 1];
  if (!headerLine) return [];

  const colRanges: { start: number; end: number }[] = [];
  let start = 0;
  for (const b of boundaries) {
    colRanges.push({ start, end: b });
    start = b + 1;
  }
  colRanges.push({ start, end: headerLine.length });

  const headers = colRanges.map((r) => headerLine.substring(r.start, r.end).trim());

  const rows: Array<Record<string, string>> = [];
  for (let i = separatorIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    const row: Record<string, string> = {};
    colRanges.forEach((r, idx) => {
      const header = headers[idx];
      const val = line.substring(r.start, r.end).trim();
      row[header] = val;
    });
    rows.push(row);
  }
  return rows;
}

// Decode SpacetimeDB SQL string quotes
function parseValue(val: any): string {
  if (val == null) return "";
  if (typeof val === "object") return (val as any).__identity__ ?? JSON.stringify(val);
  return String(val);
}

async function processChallenge(row: Record<string, any>): Promise<void> {
  const rawId = parseValue(row.challenge_id);
  const player = parseValue(row.player);
  const opponent = parseValue(row.opponent);
  const playerWord = parseValue(row.player_word);
  const playerScore = Number(parseValue(row.player_score));
  const agentRack = parseValue(row.agent_rack);
  const rawCandidates = parseValue(row.candidates);

  const challengeId = Number(rawId);
  if (isNaN(challengeId)) {
    console.error(`[WordDuel] Skipping invalid challenge ID: ${rawId}`);
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

async function checkPendingChallenges(): Promise<void> {
  try {
    const rows = await queryRows(
      "SELECT challenge_id, player, opponent, player_word, player_score, agent_rack, candidates FROM duel_challenge WHERE answered = false"
    );
    if (rows.length === 0) return;

    console.log(`[WordDuel] Found ${rows.length} pending challenge(s).`);
    for (const row of rows) {
      await processChallenge(row);
    }
  } catch (err) {
    console.error("[WordDuel] Error checking pending challenges:", (err as Error).message.split("\n")[0]);
  }
}

async function main(): Promise<void> {
  console.log(`Pentacles Word Duel Companion service starting.`);
  console.log(`  Database: ${DB}`);
  console.log(`  Backend URL: ${BACKEND_URL}`);
  console.log(`  Polling interval: ${POLL_INTERVAL_MS}ms\n`);

  const runLoop = async () => {
    await checkPendingChallenges();
    setTimeout(runLoop, POLL_INTERVAL_MS);
  };

  runLoop();
}

main();
