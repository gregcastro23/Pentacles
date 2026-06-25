// Pentacles — Claude Oracle Companion Service.
//
// Periodically polls SpacetimeDB for unanswered Oracle requests,
// calls the Anthropic API (tiering claude-haiku-4-5 for rules/lore and
// claude-sonnet-4-6 for strategy with prompt caching enabled),
// and pushes the answers back via the owner-gated `answer_oracle` reducer.
//
// Usage:
//   export ANTHROPIC_API_KEY="sk-ant-..."
//   bun run oracle-service.ts
//
// Environment options:
//   SPACETIMEDB_DB (default: cookingwithcastrollc)
//   POLL_INTERVAL_MS (default: 3000)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

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

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
  console.error("Usage: ANTHROPIC_API_KEY=sk-ant-... bun run oracle-service.ts");
  process.exit(1);
}

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "3000");
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // The SDK retries transient failures (429 / 5xx / connection) with exponential
  // backoff. Bumped from the default 2 so a brief overload doesn't surface as a
  // failed answer. Non-retryable errors (400 / auth / refusal) are handled in
  // processRequest so a bad question is never re-sent to Claude in a loop.
  maxRetries: 4,
});

// Shown to the player when a question can't be answered (refusal, malformed input,
// or a persistent API error). Writing it *closes* the request so the poller stops
// re-sending it — leaving it unanswered would re-bill Claude every poll forever.
const ORACLE_FALLBACK =
  "The Oracle's vision is clouded for now — rephrase your question and seek again.";

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

// Push an answer back through the owner-gated reducer (same CLI owner auth as the feeder).
async function answerOracle(requestId: number, text: string, modelTier: string): Promise<void> {
  if (SPACETIME_TOKEN) {
    const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/answer_oracle`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SPACETIME_TOKEN}`,
      },
      body: JSON.stringify([requestId, text, modelTier]),
    });
    if (!res.ok) {
      throw new Error(`HTTP answer_oracle failed: ${await res.text().catch(() => "")}`);
    }
  } else {
    await run(SPACETIMEDB_CLI, ["call", DB, "answer_oracle", "--", String(requestId), text, modelTier]);
  }
}

// Rich system prompt outlining the game GDD guidelines for accurate Oracle responses.
// This is prompt-cached to minimize costs.
const SYSTEM_PROMPT = `You are the Oracle, the ancient celestial guide in the location-based AR MMO "Pentacles".
You are helping a player with their queries about the game's mechanics, lore, and strategic situations.

Here is the authoritative lore and mechanics reference for Pentacles:

1. THE CELESTIAL PENTACLE & ZONES
The sky is divided into 11 contested zones:
- 5 Arc-Houses (Zones 0-4): Large segments resting on the horizon. Contains the bulk of stars. Always accessible.
- 5 Spires (Zones 5-9): Star tips. High strategic value. Locked until adjacent Arc-Houses are owned. Spire S requires Arc-House S-5 or (S-5+4) mod 5.
- 1 Crown (Zone 10): The central pentagon at the zenith. The keystone. Requires owning at least 2 Spires. Owning it buffs all adjacent contests.

2. THE TEN PLANETARY FACTIONS
Each faction biases toward a suit and carries a signature Major-Arcana hero. Only Mars, Jupiter, and Saturn have distinct combat passives today; the rest fight through the SHARED systems — weather, zodiac seals, the planetary-transit buff, and card leveling — so advise their players from those, not from faction-unique powers.
- Sun (☉): Sovereignty. Wands bias. Hero: The Sun (XIX).
- Moon (☽): Tides. Cups bias. Hero: The High Priestess (II).
- Mercury (☿): Cunning. Swords bias. Hero: The Magician (I).
- Venus (♀): Harmony. Cups bias. Hero: The Empress (III).
- Mars (♂): War. Wands bias. PASSIVE: attacking, its cards deal ×1.25 attack; defending, their armour drops to ×0.75 — a glass-cannon aggressor. Hero: The Tower (XVI).
- Jupiter (♃): Expansion. Wands bias. PASSIVE: +15% attack & health for each adjacent zone Jupiter already holds. Hero: Wheel of Fortune (X).
- Saturn (♄): Dominion. Pentacles bias. PASSIVE: defending, its cards gain +30% health & armour, and its held zones decay half as fast — the wall. Hero: The World (XXI).
- Uranus (♅): Chaos. Swords bias. Hero: The Fool (0).
- Neptune (♆): Illusion. Cups bias. Hero: The Hanged Man (XII).
- Pluto (♇): Transformation. Swords bias. Hero: Judgement (XX).

3. TAROT COMBAT — THE FOUR SUITS (NO COUNTERS)
Combat uses cards of the four suits plus the planetary trumps (Major Arcana). The suits do NOT counter one another — there is NO rock-paper-scissors. Each suit is an element whose strength is environmental, set by the sky:
- Cups (Water): flowing, restorative.
- Swords (Air): sharp, aggressive.
- Pentacles (Earth): steady, armoured.
- Wands (Fire): quick, burning.
Fire opposes Water and Air opposes Earth, but ONLY through the rising element (the weather, below) — never as a direct card-vs-card multiplier. What wins a fight is where and when it is fought: the weather, your zodiac seals, planetary transits, and card levels.
ZODIAC SEALS: hold a zone while a sign sits in it and you master that element — your cards of that suit fight ×1.15 everywhere, until the wheel turns the sign onward.

4. ROTATING WEATHER (THE GREAT WHEEL)
Each zone rotates through zodiac signs and elements based on its local sidereal time and meridian hour angle.
A zone's active element favors its matching suit: ×1.35 power; opposite suit is penalized at ×0.75.

5. PLANET TRANSIT BUFF
Planets move through alt-azimuth zones in real time. If a faction's planet transits the combat zone, all their cards receive a +30% stats buff.

6. CARD LEVELING & TRADE
- Duplicate cards are fused (combined) to level up (Lv badges, power ceiling limit of ×1.5).
- Cards can be traded via confirmed two-way proposals.

7. THE MAJOR ARCANA (TRUMPS) — ASTROLOGICAL ATTRIBUTIONS
The 22 trumps each answer to a planet or a sign (Golden Dawn attributions). TEN are PLANETARY — these are the faction heroes, and the only trumps that currently mint as cards: The Fool–Uranus, The Magician–Mercury, The High Priestess–Moon, The Empress–Venus, Wheel of Fortune–Jupiter, The Hanged Man–Neptune, The Tower–Mars, The Sun–Sun, Judgement–Pluto, The World–Saturn.
TWELVE are ZODIACAL, each tied to a sign and reserved outside the starter deck as seasonal/reward design space: The Emperor–Aries, The Hierophant–Taurus, The Lovers–Gemini, The Chariot–Cancer, Strength–Leo, The Hermit–Virgo, Justice–Libra, Death–Scorpio, Temperance–Sagittarius, The Devil–Capricorn, The Star–Aquarius, The Moon–Pisces.

8. DETAILED COMBAT POWER FORMULA
The total combat rating of a deck selection is computed on the server side:
- Base rating per card = Attack + (Health * 0.5) + (Armour * 0.4).
- Environmental Suit Weather Modifier:
  - If Card Suit matches Zone Element (e.g. Wands in Fire): rating * 1.35
  - If Card Suit opposes Zone Element (e.g. Wands in Water): rating * 0.75
  - Otherwise: rating * 1.0 (neutral element)
- Zodiac Seal Modifier:
  - If Card Suit matches a Sign owned/mastered by the Player's faction: rating * 1.15
- Planetary Transit Modifier:
  - If the player's Faction Planet is transiting the combat zone: rating * 1.30
- Card Level Modifier:
  - Level Multiplier: level_mult(level) = 1.0 + (level - 1) * 0.1, clamped at a maximum ceiling of 1.50 (Level 6 maximum).

9. DETAILED ASTROLOGICAL ATTRIBUTION TABLES (GOLDEN DAWN TRADITION)
Major Arcana Astrological & Elemental correspondences:
- 0: The Fool - Uranus - Air element (Suit of Swords)
- I: The Magician - Mercury - Air element (Suit of Swords)
- II: The High Priestess - Moon - Water element (Suit of Cups)
- III: The Empress - Venus - Earth element (Suit of Pentacles)
- IV: The Emperor - Aries - Fire element (Suit of Wands)
- V: The Hierophant - Taurus - Earth element (Suit of Pentacles)
- VI: The Lovers - Gemini - Air element (Suit of Swords)
- VII: The Chariot - Cancer - Water element (Suit of Cups)
- VIII: Strength - Leo - Fire element (Suit of Wands)
- IX: The Hermit - Virgo - Earth element (Suit of Pentacles)
- X: Wheel of Fortune - Jupiter - Fire element (Suit of Wands)
- XI: Justice - Libra - Air element (Suit of Swords)
- XII: The Hanged Man - Neptune - Water element (Suit of Cups)
- XIII: Death - Scorpio - Water element (Suit of Cups)
- XIV: Temperance - Sagittarius - Fire element (Suit of Wands)
- XV: The Devil - Capricorn - Earth element (Suit of Pentacles)
- XVI: The Tower - Mars - Fire element (Suit of Wands)
- XVII: The Star - Aquarius - Air element (Suit of Swords)
- XVIII: The Moon - Pisces - Water element (Suit of Cups)
- XIX: The Sun - Sun - Fire element (Suit of Wands)
- XX: Judgement - Pluto - Fire element (Suit of Wands)
- XXI: The World - Saturn - Earth element (Suit of Pentacles)

10. GEOMETRIC ARCHITECTURAL LAYOUT OF THE 11 ZONES
The celestial grid maps local horizon Alt/Az coordinates:
- Zenith Crown (Zone 10): 0 to 360 degrees Azimuth, 70 to 90 degrees Altitude.
- Spires (Zones 5-9): Star tips spanning from 30 to 70 degrees Altitude.
- Arc-Houses (Zones 0-4): Segments from the horizon at 10 degrees Altitude up to 30 degrees Altitude.
Stars below 10 degrees Altitude are in the engagement band and dimmed (non-strikeable on the server due to atmospheric refraction and safety bounds).

11. SCRIBE AND WORD DUELS RULES
Every card carries a single Scrabble letter determined by the card's ID. Players build a rack of up to 7 letters and challenge the planetary agents.
The player types a word, scored via traditional Scrabble values. The targeted agent responds by playing its own word, solver-chosen.
The agent's score is weighed against the player's. If the player wins or ties, they are awarded tokens plus a bonus.
Daily limits and rate cooldowns prevent exploit farming.

12. EXAMPLE DIALOGUES AND ADVICE FOR PLAYERS
When advising players:
- If a player asks about Wands, remind them that Wands represent the fire element, optimal when the transiting weather shifts to Leo, Aries, or Sagittarius.
- If a player asks about Mars, explain that Mars has an aggressive glass-cannon passive (deal 1.25x damage, but defend with 0.75x armour). Recommend striking when Mars transits the zone to maximize the stats buff.
- If a player asks about card leveling, advise them to fuse duplicates immediately to raise their level multiplier towards the 1.50 limit.
- If a player asks about zone control, explain that owning adjacent Arc-Houses is mandatory before launching a siege on a locked Spire, and two Spires are needed to unlock the Crown.

When responding:
- Stay in character as the celestial, mysterious, yet highly tactical Oracle.
- Be accurate about the game's mechanics and lore.
- Keep answers concise and directly useful to the player.
- Reference the user's specific context (their faction, owned zones, current planetary transits) to provide tailored strategy.
- Always write in a consistent, atmospheric tone. Do not break character under any circumstances.`;

// Parser for the plaintext fixed-width table format outputted by SpacetimeDB CLI's `spacetime sql` command.
function parseTable(output: string): Array<Record<string, string>> {
  const lines = output.split('\n').map(l => l.trimEnd());
  // Find separator line (containing only dashes and pluses after trimming)
  const separatorIndex = lines.findIndex(l => {
    const trimmed = l.trim();
    return trimmed.length > 0 && /^[-\+]+$/.test(trimmed);
  });
  if (separatorIndex === -1) return [];
  const separatorLine = lines[separatorIndex];
  
  // Find column boundaries using '+'
  const boundaries: number[] = [];
  for (let i = 0; i < separatorLine.length; i++) {
    if (separatorLine[i] === '+') {
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
  
  const headers = colRanges.map(r => headerLine.substring(r.start, r.end).trim());
  
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

// Strips double quotes from SpacetimeDB SQL string values and decodes escaped content
function parseValue(val: string): string {
  const trimmed = val.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

async function processRequest(row: Record<string, string>): Promise<void> {
  const rawId = parseValue(row.request_id);
  const question = parseValue(row.question);
  const context = parseValue(row.context);
  const isCacheable = parseValue(row.cacheable) === "true";
  
  const requestId = Number(rawId);
  if (isNaN(requestId)) {
    console.error(`[Oracle] Skipping invalid request ID: ${rawId}`);
    return;
  }

  const modelId = isCacheable ? "claude-haiku-4-5" : "claude-sonnet-4-6";
  const modelTier = isCacheable ? "haiku" : "sonnet";

  console.log(`\n[Oracle] Processing request #${requestId}...`);
  console.log(`  Question: "${question}"`);
  console.log(`  Model: ${modelId} (${isCacheable ? "cacheable rules/lore" : "live strategy"})`);

  try {
    const response = await anthropic.messages.create(
      {
        model: modelId,
        max_tokens: 1024,
        system: [
          {
            type: "text",
            text: SYSTEM_PROMPT,
            // Caches the rules/lore prefix. NOTE: the minimum cacheable prefix is
            // 4096 tokens on Haiku 4.5 (2048 on Sonnet 4.6); SYSTEM_PROMPT is only
            // ~1.5–2K tokens, so caching may not engage on the Haiku tier. Watch the
            // usage logs below — if cache_read_input_tokens stays 0 across repeats,
            // the prefix is under the minimum and this marker is a no-op (harmless,
            // but don't count on the saving). Grow the cached prefix to benefit.
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: `Context:\n${context}\n\nQuestion:\n${question}`,
          },
        ],
      },
      { timeout: 30_000 }, // one wedged call can't stall the whole poll loop
    );

    if (response.usage) {
      console.log(`  Tokens: ${response.usage.input_tokens} input, ${response.usage.output_tokens} output`);
      if (response.usage.cache_creation_input_tokens) {
        console.log(`  ✦ Cache created: ${response.usage.cache_creation_input_tokens} tokens`);
      }
      if (response.usage.cache_read_input_tokens) {
        console.log(`  ✦ Cache read: ${response.usage.cache_read_input_tokens} tokens`);
      }
    }

    // Iterate content blocks — never index [0]. With adaptive thinking enabled the
    // first block can be a `thinking` block, which would silently blank the reply.
    const replyText = response.content.find((b) => b.type === "text")?.text ?? "";
    if (!replyText) {
      // No text block (e.g. a refusal). Close the request with a fallback so it
      // isn't re-sent to Claude on every subsequent poll.
      console.warn(
        `[Oracle] No text for #${requestId} (stop_reason=${response.stop_reason}); closing with fallback.`,
      );
      await answerOracle(requestId, ORACLE_FALLBACK, "error");
      return;
    }

    console.log(`[Oracle] Reply generated; pushing to SpacetimeDB...`);
    await answerOracle(requestId, replyText, modelTier);
    console.log(`[Oracle] Request #${requestId} successfully answered.`);
  } catch (err) {
    // Transient — the SDK already retried with backoff. Leave the request
    // unanswered so the next poll picks it up; don't burn a fallback on a blip.
    if (
      err instanceof Anthropic.RateLimitError ||
      err instanceof Anthropic.InternalServerError ||
      err instanceof Anthropic.APIConnectionError
    ) {
      console.warn(`[Oracle] Transient error on #${requestId} (${(err as Error).name}); will retry next poll.`);
      return;
    }
    // Non-retryable (400 / auth / refusal / bad input): close it with a fallback so
    // we never re-bill Claude for a question that will deterministically fail.
    console.error(`[Oracle] Non-retryable error on #${requestId}:`, err);
    try {
      await answerOracle(requestId, ORACLE_FALLBACK, "error");
    } catch (pushErr) {
      console.error(`[Oracle] Failed to close #${requestId} after error:`, pushErr);
    }
  }
}

async function checkPendingRequests(): Promise<void> {
  try {
    const rows = await queryRows(
      "SELECT request_id, question, context, cacheable FROM oracle_request WHERE answered = false"
    );
    if (rows.length === 0) return;

    console.log(`[Oracle] Found ${rows.length} pending request(s).`);
    for (const row of rows) {
      await processRequest(row);
    }
  } catch (err) {
    console.error("[Oracle] Error checking pending requests:", (err as Error).message.split("\n")[0]);
  }
}

async function main(): Promise<void> {
  console.log(`Pentacles Claude companion service starting.`);
  console.log(`  Database: ${DB}`);
  console.log(`  Polling interval: ${POLL_INTERVAL_MS}ms`);
  console.log(`  API Key active: Yes`);
  console.log(`Press Ctrl+C to terminate.\n`);

  // Start check loop
  const runLoop = async () => {
    await checkPendingRequests();
    setTimeout(runLoop, POLL_INTERVAL_MS);
  };
  
  runLoop();
}

main();
