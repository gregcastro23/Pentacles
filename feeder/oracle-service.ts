// Pentacles — Claude Oracle Companion Service.
//
// Subscribes to SpacetimeDB over WebSocket for unanswered Oracle requests
// (plus a periodic /sql re-sweep for rows a transient failure left behind),
// calls the Anthropic API (tiering claude-haiku-4-5 for rules/lore and
// claude-sonnet-4-6 for strategy with prompt caching enabled),
// and pushes the answers back via the owner-gated `answer_oracle` reducer.
//
// LIVE-SKY ENRICHMENT: before each Claude call the current planetary positions
// are fetched from the planetary-agents backend (GET ${PA_URL}/planetary/current,
// 4s timeout, cached in memory 10 min) and injected as a compact plain-text
// block into the USER message — never into the system prompt, whose
// cache_control block must stay byte-stable for Anthropic prompt caching. On
// fetch failure the enrichment is skipped silently.
//
// Usage:
//   export ANTHROPIC_API_KEY="sk-ant-..."
//   bun run oracle-service.ts
//
// Environment options:
//   SPACETIMEDB_DB (default: cookingwithcastrollc)
//   ORACLE_RATE_PER_HOUR (default: 60) smoothing cap on Claude calls; excess
//                        requests queue FIFO in memory until capacity frees
//   RESWEEP_MS (default: 300000) unanswered-row re-sweep period
//   PLANETARY_AGENTS_BACKEND_URL (default: https://api.agents.alchm.kitchen)
//                        live-sky source for the user-message enrichment

import Anthropic from "@anthropic-ai/sdk";
import { startFeed } from "./stdb-feed";
import { cliCall } from "./spacetime-cli";
import { BRAIN_PRIMARY_URL as PA_URL, brainCall } from "./brain";

// The Oracle answers through the shared planetary-agents brain first (its
// multi-provider fallback works even when a direct Anthropic key is
// unavailable), and only falls back to a direct Anthropic call when the brain
// is unreachable AND a key is configured. So the key is now OPTIONAL: without
// it, the service still runs fully on the brain path.
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // The SDK retries transient failures (429 / 5xx / connection) with
      // exponential backoff. Bumped from the default 2 so a brief overload
      // doesn't surface as a failed answer. Non-retryable errors (400 / auth /
      // refusal) are handled in processRequest so a bad question is never
      // re-sent to Claude in a loop.
      maxRetries: 4,
    })
  : null;
if (!anthropic) {
  console.warn("[Oracle] No ANTHROPIC_API_KEY set — answering via the planetary-agents brain only.");
}

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";

// Shown to the player when a question can't be answered (refusal, malformed input,
// or a persistent API error). Writing it *closes* the request so the re-sweep stops
// re-sending it — leaving it unanswered would re-bill Claude on every sweep forever.
const ORACLE_FALLBACK =
  "The Oracle's vision is clouded for now — rephrase your question and seek again.";

// Push an answer back through the owner-gated reducer (HTTP with the bearer token,
// or the spacetime CLI's logged-in owner identity when the token is blank).
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
    // cliCall JSON-encodes the strings (Claude prose routinely contains quotes
    // and newlines) and passes the id as a bare literal.
    await cliCall(DB, "answer_oracle", [requestId, text, modelTier]);
  }
}

// ── Claude-call rate limiter (smoothing cap) ─────────────────────────────────
//
// At most ORACLE_RATE_PER_HOUR Anthropic calls in any rolling 60-minute window
// (rolling was as simple as fixed here and never produces the 2× burst a fixed
// window allows at the boundary). Requests over the cap are NOT answered with
// the fallback and NOT dropped: processRequest parks on acquireClaudeSlot(),
// which holds them in an in-memory FIFO queue. Because the parked request never
// returns from onRow, its id stays in the feed's in-flight set (stdb-feed.ts),
// so a WS reconnect backlog or the /sql re-sweep can't enqueue a duplicate.
// A timer drains the queue in order as calls age out of the window.
//
// NOTE: the server will soon prune unanswered requests after 24h, so a request
// that sat queued through a long backlog can outlive its row. When that happens
// the answer write fails (answer_oracle returns Err("no such request"), which
// the HTTP /call path surfaces as a non-OK status → answerOracle throws) and
// processRequest logs and drops it gracefully — see the push site below.

// Misconfiguration (NaN, negative, or 0 — which would park every request
// forever) falls back to the default rather than silently wedging the Oracle.
const rawRate = Number(process.env.ORACLE_RATE_PER_HOUR ?? "60");
const ORACLE_RATE_PER_HOUR = Number.isFinite(rawRate) && rawRate >= 1 ? Math.floor(rawRate) : 60;
const HOUR_MS = 3_600_000;

const recentCalls: number[] = []; // Claude call timestamps in the last hour (ascending)
const slotWaiters: Array<{ requestId: number; grant: () => void }> = []; // FIFO park queue
let drainTimer: ReturnType<typeof setTimeout> | null = null;

// Drop timestamps that have aged out of the rolling window.
function pruneWindow(): void {
  const cutoff = Date.now() - HOUR_MS;
  while (recentCalls.length && recentCalls[0] <= cutoff) recentCalls.shift();
}

// Arm (once) a wake-up for when the oldest in-window call expires, then hand
// freed slots to the queue head. Strictly FIFO: waiters only ever leave from
// the front, and new arrivals can't jump them (see acquireClaudeSlot).
function scheduleDrain(): void {
  if (drainTimer) return;
  pruneWindow();
  const wakeMs = recentCalls.length ? Math.max(1_000, recentCalls[0] + HOUR_MS - Date.now()) : 1_000;
  drainTimer = setTimeout(() => {
    drainTimer = null;
    pruneWindow();
    while (slotWaiters.length && recentCalls.length < ORACLE_RATE_PER_HOUR) {
      recentCalls.push(Date.now());
      const w = slotWaiters.shift()!;
      console.log(`[Oracle] Capacity freed; resuming queued request #${w.requestId} (${slotWaiters.length} still queued).`);
      w.grant();
    }
    if (slotWaiters.length) scheduleDrain();
  }, wakeMs);
}

// Resolve immediately if under the cap (and nobody is queued ahead), otherwise
// park until the drain timer grants a slot. The returned promise never rejects.
function acquireClaudeSlot(requestId: number): Promise<void> {
  pruneWindow();
  if (slotWaiters.length === 0 && recentCalls.length < ORACLE_RATE_PER_HOUR) {
    recentCalls.push(Date.now());
    return Promise.resolve();
  }
  console.log(
    `[Oracle] Hourly cap (${ORACLE_RATE_PER_HOUR}/h) reached — queueing request #${requestId} ` +
      `(position ${slotWaiters.length + 1}).`,
  );
  return new Promise<void>((grant) => {
    slotWaiters.push({ requestId, grant });
    scheduleDrain();
  });
}

// ── Live-sky enrichment (planetary-agents backend) ──────────────────────────
//
// GET ${PA_URL}/planetary/current → {planetary_positions:{Sun:{sign,degree,
// isRetrograde,…},…}}, rendered as a compact one-line block (~200 chars for 10
// bodies, hard-capped at 600) that is appended to the USER message. It must
// NEVER touch the system prompt: that block is cache_control-marked and any
// byte drift would invalidate the Anthropic prompt cache. Cached (success or
// failure) for 10 minutes so a dead backend costs at most one 4s stall per
// window instead of one per request.

const SKY_CACHE_MS = 600_000; // 10 min
const SKY_FETCH_TIMEOUT_MS = 4_000;
let skyCache: { text: string | null; fetchedAt: number } = { text: null, fetchedAt: 0 };

async function liveSkyBlock(): Promise<string | null> {
  if (Date.now() - skyCache.fetchedAt < SKY_CACHE_MS) return skyCache.text;
  skyCache = { text: null, fetchedAt: Date.now() }; // negative-cache until proven otherwise
  try {
    const res = await fetch(`${PA_URL}/planetary/current`, {
      signal: AbortSignal.timeout(SKY_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      planetary_positions?: Record<string, { sign: string; degree: number; isRetrograde?: boolean }>;
    };
    const positions = json?.planetary_positions;
    if (!positions || typeof positions !== "object") throw new Error("no planetary_positions in body");
    const parts: string[] = [];
    for (const [body, p] of Object.entries(positions)) {
      if (!p || typeof p.sign !== "string") continue;
      parts.push(`${body} ${Math.trunc(Number(p.degree) || 0)}°${p.sign}${p.isRetrograde ? " Rx" : ""}`);
    }
    if (!parts.length) throw new Error("no usable positions in body");
    skyCache.text = `Live sky (planetary-agents): ${parts.join("; ")}`.slice(0, 600);
  } catch (err) {
    // Enrichment is best-effort — skip silently (single debug line per cache window).
    console.debug(`[Oracle] live-sky fetch skipped (${(err as Error).message.split("\n")[0]}).`);
  }
  return skyCache.text;
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

async function processRequest(row: Record<string, any>): Promise<void> {
  // Rows arrive already normalized (snake_case keys, plain values) from the WS feed.
  const question = String(row.question ?? "");
  const context = String(row.context ?? "");
  const isCacheable = row.cacheable === true;

  const requestId = Number(row.request_id);
  if (isNaN(requestId)) {
    console.error(`[Oracle] Skipping invalid request ID: ${row.request_id}`);
    return;
  }

  const modelId = isCacheable ? "claude-haiku-4-5" : "claude-sonnet-4-6";
  const modelTier = isCacheable ? "haiku" : "sonnet";

  // Smoothing cap: over ORACLE_RATE_PER_HOUR this parks (FIFO) until capacity
  // frees. While parked the request stays in the feed's in-flight set, which is
  // what dedupes it against reconnect backlogs and the re-sweep.
  await acquireClaudeSlot(requestId);

  console.log(`\n[Oracle] Processing request #${requestId}...`);
  console.log(`  Question: "${question}"`);
  console.log(`  Model: ${modelId} (${isCacheable ? "cacheable rules/lore" : "live strategy"})`);

  // Best-effort live-sky enrichment — goes into the USER message only (the
  // system prompt's cache_control block must stay byte-stable). Null on failure.
  const sky = await liveSkyBlock();

  // Primary path: the shared planetary-agents brain. Its provider chain
  // (anthropic → groq → cerebras → gemini → openrouter → openai) answers even
  // when the direct key is down, so the Oracle stays live.
  const brainAnswer = await brainCall<string>({
    path: "/api/agents/oracle",
    label: "Oracle",
    body: {
      question,
      context: (sky ? `${sky}\n\n` : "") + context,
    },
    validate: (j) => {
      const a = j && typeof j.answer === "string" ? j.answer.trim() : "";
      return a || null;
    },
    timeoutMs: 30_000,
  });
  if (brainAnswer) {
    console.log(`[Oracle] Reply via brain; pushing to SpacetimeDB...`);
    try {
      await answerOracle(requestId, brainAnswer, "brain");
      console.log(`[Oracle] Request #${requestId} successfully answered (brain).`);
    } catch (pushErr) {
      console.error(
        `[Oracle] Answer write failed for #${requestId} (row pruned, or transient — re-sweep will retry); dropping:`,
        (pushErr as Error).message,
      );
    }
    return;
  }

  // The brain was unreachable. Without a direct Anthropic key there's nothing
  // left to try — close with the fallback so the re-sweep stops re-delivering.
  if (!anthropic) {
    console.warn(`[Oracle] Brain unreachable and no Anthropic key for #${requestId}; closing with fallback.`);
    await answerOracle(requestId, ORACLE_FALLBACK, "error");
    return;
  }

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
            content:
              (sky ? `${sky}\n\n` : "") + `Context:\n${context}\n\nQuestion:\n${question}`,
          },
        ],
      },
      { timeout: 30_000 }, // one wedged call can't hold its request slot forever
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
      // No text block (e.g. a refusal). Close the request with a fallback so the
      // re-sweep never re-sends it to Claude.
      console.warn(
        `[Oracle] No text for #${requestId} (stop_reason=${response.stop_reason}); closing with fallback.`,
      );
      await answerOracle(requestId, ORACLE_FALLBACK, "error");
      return;
    }

    console.log(`[Oracle] Reply generated; pushing to SpacetimeDB...`);
    try {
      await answerOracle(requestId, replyText, modelTier);
    } catch (pushErr) {
      // The server will prune unanswered requests after 24h, so a request that
      // waited in the rate-limit queue (or through a long outage) can outlive
      // its row: answer_oracle then returns Err("no such request"), the HTTP
      // /call path responds non-OK, and answerOracle throws (the CLI path exits
      // non-zero — same throw). Nothing is left to answer, so log and drop.
      // If the row DOES still exist (a transient write failure), it stays
      // answered=false and the RESWEEP_MS re-sweep re-delivers it.
      console.error(
        `[Oracle] Answer write failed for #${requestId} (row pruned, or transient — re-sweep will retry); dropping:`,
        (pushErr as Error).message,
      );
      return;
    }
    console.log(`[Oracle] Request #${requestId} successfully answered.`);
  } catch (err) {
    // Transient — the SDK already retried with backoff. Leave the request
    // unanswered; the periodic re-sweep (RESWEEP_MS, default 5 min) or a WS
    // reconnect backlog re-delivers it. Don't burn a fallback on a blip.
    if (
      err instanceof Anthropic.RateLimitError ||
      err instanceof Anthropic.InternalServerError ||
      err instanceof Anthropic.APIConnectionError
    ) {
      console.warn(`[Oracle] Transient error on #${requestId} (${(err as Error).name}); the re-sweep will retry it.`);
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

async function main(): Promise<void> {
  console.log(`Pentacles Claude companion service starting.`);
  console.log(`  Database: ${DB}`);
  console.log(`  Transport: WebSocket subscription (reactive) + periodic /sql re-sweep`);
  console.log(`  Claude cap: ${ORACLE_RATE_PER_HOUR} calls/hour (excess queues FIFO)`);
  console.log(`  API Key active: Yes`);
  console.log(`Press Ctrl+C to terminate.\n`);

  // React to new unanswered Oracle requests as they arrive (plus the startup backlog).
  startFeed({
    uri: SPACETIMEDB_URI,
    db: DB,
    token: SPACETIME_TOKEN || undefined,
    table: "oracle_request",
    query: "SELECT * FROM oracle_request WHERE answered = false",
    idField: "request_id",
    accept: (r) => r.answered === false,
    label: "Oracle",
    onRow: processRequest,
  });
}

main();
