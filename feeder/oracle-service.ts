// Pentacles — the Oracle's Claude companion service.
//
// The heuristic Oracle (client-side) handles all tactics for free. THIS service
// is the chat/teaching half: it watches `oracle_request` for unanswered
// questions, asks Claude, and writes the reply back through the owner-gated
// `answer_oracle` reducer (which also populates the shared answer cache).
//
// Like the ephemeris feeder, it shells out to the `spacetime` CLI, so it
// authenticates as your logged-in module owner — no token plumbing. It only ever
// sees the derived context summary the client attached (faction, dominant suit,
// seals, zone counts) — never birth data.
//
//   ANTHROPIC_API_KEY=sk-ant-... bun run oracle-service.ts
//
// Env: SPACETIMEDB_DB (default cookingwithcastrollc), ORACLE_POLL_MS (3000),
//      ANTHROPIC_API_KEY (required).
//
// Tiering (your spec): cacheable rules/lore questions → Haiku 4.5 (short, cheap);
// live strategy questions → Sonnet 4.6. The system prompt is prompt-cached so the
// rules context is near-free on repeat calls.

import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const POLL_MS = Number(process.env.ORACLE_POLL_MS ?? "3000");

const SHORT_MODEL = "claude-haiku-4-5";    // rules/lore, short
const STRATEGY_MODEL = "claude-sonnet-4-6"; // live strategy

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// Stable persona + rules digest — kept byte-identical so it caches across calls.
const SYSTEM = `You are "the Oracle", the in-world astrologer-advisor of Pentacles, an
augmented-reality territory game played against the real night sky. Speak in a wry,
warm, encouraging oracle voice — brief (2-4 sentences), concrete, never flowery
filler. You ADVISE; the player always casts. Never invent rules; if unsure, say so.

You are given only a derived summary of the player's situation (faction, the suit
their deck leans on, their zodiac seals, how many zones they hold) — never their
birth data. Address them as a seeker.

The rules you teach and reason from:
- The sky is the board: eleven zones (five Houses, five Spires, one Crown). Each
  carries a zodiac sign that rotates in real time.
- Suits are elemental — Cups/Water, Swords/Air, Pentacles/Earth, Wands/Fire — and
  do NOT counter each other. The sign rising over a zone favors its element's suit
  (x1.35) and weakens the opposite (x0.75). This "weather" sweeps the zodiac live,
  so where and WHEN you fight matters more than the cards.
- Hold a zone while a sign sits in it and you master that element — a "zodiac
  seal": your cards of that suit fight x1.15 everywhere, until the wheel moves on.
- Each zone is a single tug-of-war meter; winning battles there pushes it your way
  and eventually flips the zone to your faction. Held zones slowly decay.
- Stars are the prizes. A star must be risen past ten degrees over the player's
  real horizon before they can strike it; brighter stars resist harder but pull
  their zone further when taken.
- Every card is minted from a moment in the sky — the player's natal chart for
  starters, the live sky at the instant of a win for the rest — so no two of the
  same card are alike. Copies of a card can be fused to level it up (diminishing
  returns to a ceiling), and cards can be traded between players (both confirm).

Give the single most useful thing for THIS seeker now. If they ask about rules,
teach plainly. If they ask what to do, weigh their suit, seals, and the live
weather, and point them somewhere.`;

interface Req {
  request_id: string;
  question: string;
  context: string;
  cacheable: boolean;
}

function toBool(v: unknown): boolean {
  return v === true || v === "true" || v === 1 || v === "1";
}

function normalizeRow(r: any): Req | null {
  // `spacetime sql --json` may return row objects, or positional arrays matching
  // the SELECT order (request_id, question, context, cacheable). Handle both.
  if (Array.isArray(r)) {
    return { request_id: String(r[0]), question: String(r[1] ?? ""), context: String(r[2] ?? ""), cacheable: toBool(r[3]) };
  }
  if (r && typeof r === "object") {
    const id = r.request_id ?? r.RequestId ?? r.requestId;
    if (id === undefined) return null;
    return { request_id: String(id), question: String(r.question ?? ""), context: String(r.context ?? ""), cacheable: toBool(r.cacheable) };
  }
  return null;
}

function parseRows(stdout: string): Req[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let data: any;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error(
      "Expected JSON from `spacetime sql`. Ensure your CLI emits JSON (this service runs it with --json); got: " +
        trimmed.slice(0, 160),
    );
  }
  // Possible shapes: [{rows:[...], schema:...}] | {rows:[...]} | [rowObj, ...]
  let rows: any[];
  if (Array.isArray(data)) {
    rows = data.length && data[0] && Array.isArray(data[0].rows) ? data.flatMap((d: any) => d.rows) : data;
  } else if (data && Array.isArray(data.rows)) {
    rows = data.rows;
  } else {
    rows = [];
  }
  return rows.map(normalizeRow).filter((r): r is Req => r !== null);
}

async function pending(): Promise<Req[]> {
  const query =
    "SELECT request_id, question, context, cacheable FROM oracle_request WHERE answered = false";
  const { stdout } = await run("spacetime", ["sql", "--json", DB, query], { encoding: "utf8" });
  return parseRows(stdout);
}

async function reply(id: string, text: string, model: string): Promise<void> {
  // execFile (not a shell) passes `text` as a single argv element, so quotes and
  // newlines in the reply need no escaping.
  await run("spacetime", ["call", DB, "answer_oracle", id, text, model]);
}

async function ask(req: Req): Promise<{ text: string; model: string }> {
  const model = req.cacheable ? SHORT_MODEL : STRATEGY_MODEL;
  const resp = await client.messages.create({
    model,
    max_tokens: model === SHORT_MODEL ? 400 : 700,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [
      { role: "user", content: `Seeker's situation: ${req.context}\n\nTheir question: ${req.question}` },
    ],
  });
  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text: text || "The sky is clouded just now, seeker — ask me again in a moment.", model };
}

async function tick(): Promise<void> {
  let reqs: Req[];
  try {
    reqs = await pending();
  } catch (e) {
    console.error(`read failed: ${(e as Error).message.split("\n")[0]}`);
    return;
  }
  for (const req of reqs) {
    try {
      const { text, model } = await ask(req);
      await reply(req.request_id, text, model);
      console.log(`✦ #${req.request_id} answered via ${model}`);
    } catch (e) {
      console.error(`✗ #${req.request_id}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Set ANTHROPIC_API_KEY to run the Oracle service.");
    process.exit(1);
  }
  console.log(`Pentacles Oracle service → ${DB} (poll ${POLL_MS}ms; Haiku rules / Sonnet strategy)`);
  // Sequential loop: finish each batch before polling again, so no request is
  // picked up twice (answer_oracle is idempotent server-side regardless).
  for (;;) {
    await tick();
    await sleep(POLL_MS);
  }
}

main();
