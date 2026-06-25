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
const BACKEND_URL = process.env.PLANETARY_AGENTS_BACKEND_URL ?? "";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "3000");
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

async function answerJing(duelId: number, move: string, voice: string): Promise<void> {
  const argMove = { [move]: [] };
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

function parseValue(val: any): string {
  if (val == null) return "";
  if (typeof val === "object") return (val as any).__identity__ ?? JSON.stringify(val);
  return String(val);
}

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
    return vname;
  }
  return val;
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

async function processDuel(row: Record<string, string>): Promise<void> {
  const duelId = Number(parseValue(row.duel_id));
  const opening = parseValue(row.opening_move); // variant name, e.g. "Meltdown"
  const agent = parseValue(row.target_agent);   // Option<Planet> → "Mars" or "(none)"-ish
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

async function checkOpenDuels(): Promise<void> {
  try {
    // Open duels aimed at an agent (target_agent set). SpacetimeDB SQL has no rich
    // Option predicate; we fetch OPEN duels and skip player-vs-player ones here.
    const rows = await queryRows(
      "SELECT duel_id, opening_move, target_agent, target_player FROM jing_duel WHERE state = 'Open'"
    );
    const filtered = rows.filter((r) => {
      const ta = parseValue(r.target_agent);
      return ta && ta !== "(none)" && /^[A-Za-z]+$/.test(ta);
    });
    if (!filtered.length) return;
    console.log(`[Jing] ${filtered.length} open agent duel(s).`);
    for (const row of filtered) await processDuel(row);
  } catch (err) {
    console.error("[Jing] poll error:", (err as Error).message.split("\n")[0]);
  }
}

async function main(): Promise<void> {
  console.log(`Pentacles Jing Arena companion starting.`);
  console.log(`  Database: ${DB}`);
  console.log(`  Backend:  ${BACKEND_URL || "(local counter pick)"}`);
  console.log(`  Interval: ${POLL_INTERVAL_MS}ms\n`);
  const loop = async () => { await checkOpenDuels(); setTimeout(loop, POLL_INTERVAL_MS); };
  loop();
}

main();
