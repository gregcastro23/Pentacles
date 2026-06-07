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
import Anthropic from "@anthropic-ai/sdk";

const run = promisify(execFile);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Error: ANTHROPIC_API_KEY environment variable is not set.");
  console.error("Usage: ANTHROPIC_API_KEY=sk-ant-... bun run oracle-service.ts");
  process.exit(1);
}

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "3000");

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

2. TEN PLANETARY FACTIONS & DOCTRINES
- Sun (☉): Sovereignty. Wands bias. Bonus capture rate when Sun is above horizon. Hero: The Sun (XIX).
- Moon (☽): Tides. Cups bias. Slowed zone decay during lunar night. Hero: The High Priestess (II).
- Mercury (☿): Cunning. Swords bias. Reduced cooldowns; acts first in duels. Hero: The Magician (I).
- Venus (♀): Harmony. Cups bias. Shares partial control points with allies in adjacent zones. Hero: The Empress (III).
- Mars (♂): War. Wands bias. Highest base attack, poor defense. Hero: The Tower (XVI).
- Jupiter (♃): Expansion. Wands bias. Contests buff adjacent zones. Hero: Wheel of Fortune (X).
- Saturn (♄): Dominion. Pentacles bias. Strongest defense; hardest zones to retake. Hero: The World (XXI).
- Uranus (♅): Chaos. Swords bias. Random-effect cards; can swap zone contest states. Hero: The Fool (0).
- Neptune (♆): Illusion. Cups bias. Invisible zone fortification. Hero: The Hanged Man (XII).
- Pluto (♇): Transformation. Swords bias. Attrition; converts destroyed cards into temporary power. Hero: Judgement (XX).

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

When responding:
- Stay in character as the celestial, mysterious, yet highly tactical Oracle.
- Be accurate about the game's mechanics and lore.
- Keep answers concise and directly useful to the player.
- Reference the user's specific context (their faction, owned zones, current planetary transits) to provide tailored strategy.`;

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
    const response = await anthropic.messages.create({
      model: modelId,
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Context:\n${context}\n\nQuestion:\n${question}`,
        },
      ],
    });

    const replyText = response.content[0].type === "text" ? response.content[0].text : "";
    if (!replyText) {
      console.warn(`[Oracle] Empty response generated for request #${requestId}`);
      return;
    }

    console.log(`[Oracle] Reply generated successfully.`);
    if (response.usage) {
      console.log(`  Tokens: ${response.usage.input_tokens} input, ${response.usage.output_tokens} output`);
      if (response.usage.cache_creation_input_tokens) {
        console.log(`  ✦ Cache created: ${response.usage.cache_creation_input_tokens} tokens`);
      }
      if (response.usage.cache_read_input_tokens) {
        console.log(`  ✦ Cache read: ${response.usage.cache_read_input_tokens} tokens`);
      }
    }

    // Submit the reply back to SpacetimeDB
    console.log(`[Oracle] Pushing reply back to SpacetimeDB...`);
    await run("spacetime", [
      "call",
      DB,
      "answer_oracle",
      "--",
      String(requestId),
      replyText,
      modelTier,
    ]);
    console.log(`[Oracle] Request #${requestId} successfully answered.`);
  } catch (err) {
    console.error(`[Oracle] Error processing request #${requestId}:`, err);
  }
}

async function checkPendingRequests(): Promise<void> {
  try {
    const { stdout } = await run("spacetime", [
      "sql",
      DB,
      "SELECT request_id, question, context, cacheable FROM oracle_request WHERE answered = false",
    ]);

    const rows = parseTable(stdout);
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
