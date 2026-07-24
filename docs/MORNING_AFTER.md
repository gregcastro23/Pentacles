# The Morning After — Pentacles Hackathon Wrap-Up

*A field guide for hardening our SpacetimeDB integration, our AI calls, and our database
situation — written against the code as it actually shipped, and updated 2026-06-08 with the
cross-project plan we set with **planetary-agents**.*

**Status:** post-hackathon retrospective + live cross-project roadmap · **Module:**
`cookingwithcastrollc` (maincloud) · **Date:** 2026-06-08

### Where we are now (read this first)

Two projects, two roles: **Pentacles** is *the game*; **planetary-agents** (`agents.alchm.kitchen`)
is *the brain*. (A third sibling, **scrabblebot**, is a separate sealed-bid tile *auction* game — its
bidding/`decideBid` mechanics are **not** part of Pentacles; don't conflate them.)

As of **2026-06-08** the planetary-agents side of the Word Duel opponent **is built and tested**: a
free-chain, in-character word picker that drops into the `agent_letters` seam and returns the word a
planet would actually play, with a one-line rationale in its voice. The next concrete step **on this
repo** is wiring it in — `duel_challenge` + `answer_duel` + `feeder/duel-service.ts`, reusing the
Oracle companion pattern verbatim ([4.8](#48-the-planetary-agents-word-duel-brain-the-agent_letters-seam)).

**Cost rule for both projects (this corrects the old "default to Opus" guidance):** **free chain
first** — Groq (Llama-70B for the sharp work, 8B-instant for the rest) → Cerebras → Gemini — for
runtime / in-character / high-volume features. Reserve Anthropic/Opus for development and genuinely
hard reasoning, chosen per-feature on a measured sample, never by habit. The Word Duel brain is the
reference implementation of this rule.

---

## 0 · TL;DR — what to do first

Ranked by impact ÷ effort. Each links to its section.

| # | Action | Why | Effort | §
|---|--------|-----|--------|---|
| 1 | **Add `#[index(btree)]` on `card.owner`, `deck_slot.owner`, `trade.proposer/partner`** | Every reducer that touches a player's cards is currently a full-table scan over *all* cards in the game. This is the single biggest scaling cliff. | S | [3.1](#31-indexing--stop-scanning-the-whole-game) |
| 2 | **Verify the Oracle prompt cache is actually caching** | The cached system prompt is ~1.5–2K tokens; Haiku 4.5's cache minimum is **4096** tokens. The `cache_control` marker is probably a silent no-op. | S | [4.3](#43-the-prompt-cache-is-probably-not-firing) |
| 3 | **Fix the Oracle re-billing loop on failed requests** | A request that errors stays `answered = false`, so the poller re-sends it to Claude **every 3 seconds forever** — an unbounded cost leak on one bad question. | S | [4.2](#42-make-the-oracle-service-fail-safe) |
| 4 | **Give the side-services a real owner token** (`SPACETIME_TOKEN`), stop shelling out to `spacetime login` | The feeder and Oracle service authenticate via the interactive CLI login. That can't deploy to cron / a container / serverless. | M | [2.4](#24-the-trusted-side-service-pattern) |
| 5 | **Wire the web client to the live module** via the SpacetimeDB TS SDK | Today `client.js` is a *separate localStorage game* that never talks to `cookingwithcastrollc`. Unity and the web play different universes. | L | [2.3](#23-one-truth-two-clients-the-web-client-gap) |
| 6 | **Replace `spacetime sql` + text-table parsing with an SDK subscription** in the Oracle service | We poll the CLI every 3s and parse fixed-width ASCII tables. Brittle and laggy; the SDK gives reactive inserts. | M | [4.1](#41-stop-polling-the-cli-subscribe-instead) |
| 7 | **Prune unbounded tables** (`oracle_request`, `oracle_reply`, `battle`) | They grow forever. SpacetimeDB bills on state size. | M | [3.2](#32-bound-the-tables-that-grow-forever) |
| 8 | **Wire the planetary-agents Word Duel brain** (`duel_challenge` + `answer_duel` + `feeder/duel-service.ts`) | The PA brain is built & tested; this turns the deterministic greedy opponent into a real in-character planet. Reuses the Oracle pattern, so it's mostly a copy. | M | [4.8](#48-the-planetary-agents-word-duel-brain-the-agent_letters-seam) |

**▶ When you wake up:** the Word-Duel thread is the active one — start at **#8 / [4.8](#48-the-planetary-agents-word-duel-brain-the-agent_letters-seam)** (the PA side is done; this repo's wiring is next). The #1–#7 hardening items still stand and can interleave; #1 (indexes) is the cheapest durable win.

---

## 1 · What we shipped

A location-based AR MMO with a genuinely ambitious backend for a hackathon. The pieces:

### Backend — SpacetimeDB Rust module (`server/`)
- **Authoritative state, 18 tables.** Clients never write; they call **reducers** that validate
  and mutate transactionally. `~3,900` lines across `lib / types / tables / chart / combat / reducers`.
- **Private tables:** `natal_chart`, `player_location`, `oracle_rate` (everything else is `public`
  and streams to clients as the live map).
- **Scheduled reducers:** `tick_sky` (the world clock: weather wheel, `agent_war` automated raids vs defender sentinel garrisons, ephemeris→zone mapping) and `resolve_round` (per-player Ascendant clock that paces the re-draft).
- **Raid Reducers:** `resolve_star_battle` (multi-card Auto-Siege battles) & `strike_star_single` (instant single-card Drag & Drop threshold strikes).
- **Owner-gated reducers:** `push_ephemeris` and `answer_oracle` — only the module owner identity
  may call them. This is the integration seam for our trusted off-module jobs.

### Off-module side-services (`feeder/`, Bun + TypeScript)
- **`push-ephemeris.ts`** — computes all ten bodies' positions + a retrograde flag, calls
  `push_ephemeris`. Auth: shells out to the `spacetime` CLI as the logged-in owner.
- **`oracle-service.ts`** — the Claude companion. Polls `oracle_request`, asks Claude
  (Haiku 4.5 for cacheable rules/lore, Sonnet 4.6 for live strategy), writes the reply back via
  `answer_oracle`, and populates `oracle_cache` for repeat questions.

### Clients
- **Unity (`unity/`)** — the real AR client, wired to the live module through generated C#
  bindings (`unity/Assets/Autogen/`).
- **Web (`client.html` / `client.js` / `client.css`)** — a playable 2D/AR-toggle client that is
  **a self-contained JavaScript re-implementation** of the server's logic, persisting to
  `localStorage`. It does **not** connect to SpacetimeDB. (This is the headline integration gap —
  see [2.3](#23-one-truth-two-clients-the-web-client-gap).)

### Deploy
- Static site on Vercel (`vercel.json` rewrites `/` → `client.html`; GDD at `/Pentacles_GDD.html`).

**The good instincts already in place** (keep doing these): clients-call-reducers-only;
owner-gated trusted feeds; idempotent reducers (`create_player`, `answer_oracle`); a derived
context summary sent to Claude that *never* includes birth data; server-side re-validation of
client-submitted duels/trades; a question-hash answer cache to avoid re-asking Claude.

---

## 2 · SpacetimeDB integration guide

### 2.1 The mental model (the part to carry to other projects)

SpacetimeDB collapses "database + server" into one WASM module. The discipline that makes it work,
and that should be the template for **any** project we put on it:

1. **State lives in tables. Logic lives in reducers. Clients only call reducers.**
   A reducer is a transaction: it either commits a consistent mutation or it errors and nothing
   changes. Never expose a write path that isn't a reducer.
2. **`public` vs private is your authorization model.** A `public` table streams to every
   subscribed client automatically — treat it as world-readable. Anything sensitive
   (`natal_chart`, `player_location`) must be a non-public table keyed by `identity`, and only the
   owner's client receives its rows. We got this right; the rule is *default to private, opt into
   public deliberately.*
3. **`ctx.sender` is the caller's identity — it is the authentication.** Every ownership check
   (`c.owner == ctx.sender`) and every owner-gate (`ctx.sender == cfg.owner`) leans on it. There is
   no separate auth layer to bolt on.
4. **Subscriptions are the client's read API.** The client subscribes to a SQL-ish query and gets a
   live, incrementally-updated view. The client doesn't poll; it reacts to row deltas.

### 2.2 Schema & reducer hygiene checklist

For every new table, ask:

- [ ] Should this be `public`? (If a client never needs it, or it's per-user secret → **no**.)
- [ ] What do reducers **look it up by**? Every such column wants an index (see [3.1](#31-indexing--stop-scanning-the-whole-game)).
- [ ] Does it grow without bound? If yes, design the prune path *now* (see [3.2](#32-bound-the-tables-that-grow-forever)).
- [ ] Is the mutating reducer **idempotent**? Re-delivery and retries happen; design for them.

For every new reducer:

- [ ] Validate `ctx.sender` owns/may-touch every row it mutates.
- [ ] Return `Err(String)` on rejection — don't silently no-op (the client surfaces the message).
- [ ] Keep heavy compute (astronomy, etc.) **out** of the module; precompute and pass it in.
  We already do this for the natal chart and ephemeris — keep that line.

### 2.3 One truth, two clients: the web-client gap

This is the most valuable integration to close. Right now:

- **Unity** ⇄ `cookingwithcastrollc` (real, shared, authoritative).
- **Web** ⇄ `localStorage` (a parallel simulation; `client.js` re-derives combat, minting, and the
  blend in JS). It's an excellent offline demo, but it is **not the same game**.

The fix is to put the web client on the **SpacetimeDB TypeScript/JS SDK** so it subscribes to the
same tables and calls the same reducers Unity does. Sketch:

```ts
import { DbConnection } from "./module_bindings"; // from `spacetime generate --lang typescript`

const conn = await DbConnection.builder()
  .withUri("wss://maincloud.spacetimedb.com")
  .withModuleName("cookingwithcastrollc")
  .onConnect((conn, identity, token) => {
    localStorage.setItem("stdb_token", token);          // reuse identity across sessions
    conn.subscriptionBuilder()
      .subscribe(["SELECT * FROM zone", "SELECT * FROM star_node", "SELECT * FROM ephemeris"]);
  })
  .withToken(localStorage.getItem("stdb_token") ?? undefined)
  .build();

// Reads are reactive — register row callbacks instead of re-reading localStorage:
conn.db.zone.onUpdate((ctx, oldRow, newRow) => repaintZone(newRow));

// Writes go through reducers, exactly like Unity:
conn.reducers.resolveStarBattle(starId, playedCardIds);
```

Recommended path so we don't throw away the offline demo:

1. **Keep `client.js`'s rendering and the local simulation behind a flag** (`?offline=1`).
2. Generate TS bindings (`spacetime generate --lang typescript --out-dir client/module_bindings`)
   and add a thin `net.js` that mirrors the current local API surface but is backed by the live
   connection.
3. Make the local simulation the **fallback** when offline/disconnected, and reconcile on reconnect
   (the server is authoritative; local state is a cache).

This also unlocks a real web Oracle (see [4.5](#45-give-the-web-client-an-oracle-too)).

### 2.4 The trusted-side-service pattern (and how to deploy it)

Our `push_ephemeris` / `answer_oracle` design is the **right** pattern: privileged work runs
off-module as the owner identity; clients never hold a privileged token. Generalize it for every
project — "an untrusted client proposes; a trusted job, authenticated as the owner, disposes."

But the **authentication mechanism today won't deploy.** Both services do:

```ts
await run("spacetime", ["call", DB, "push_ephemeris", "--", ...]);
```

…which relies on the interactive `spacetime login` session on the developer's machine. A cron box,
a container, or a serverless function has no such session.

**Fix — mint an owner token and inject it as a secret:**

```bash
# One-time, as the owner, capture a non-interactive identity token:
spacetime login --server maincloud.spacetimedb.com
spacetime login show --token        # → store this value in your secret manager
```

Then in the service, either set `SPACETIME_TOKEN` and call the CLI non-interactively, **or** move to
the SpacetimeDB **TypeScript SDK** and call reducers directly over the WebSocket with that token —
which also removes the brittle CLI-text parsing (see [4.1](#41-stop-polling-the-cli-subscribe-instead)).
Either way:

- The token is an **owner-equivalent secret** — treat it like the Anthropic key. Secret manager /
  platform env only, never in the repo, rotate on exposure.
- Run feeder + Oracle as small always-on workers (Railway / Fly / a container), **not** in the
  Vercel static project. The browser must never see this token.

> Rule of thumb for all our projects: **the only credential a browser ever holds is its own
> per-user identity token.** Owner tokens and API keys live server-side, behind a reducer or an
> edge function.

### 2.5 Trust boundary on `cacheable`

`ask_oracle(question, context, cacheable)` takes `cacheable` **from the client**, and a `true` value
both (a) serves an instant cached answer and (b) lets `answer_oracle` write into the *shared*
`oracle_cache` that everyone reads. A malicious or buggy client can therefore mislabel a
personalized strategy question as "rules/lore" and **poison the global cache** with a context-specific
answer, or get a stale answer to a live question.

Mitigations (cheap → thorough):
- **Cheap:** only cache answers whose `context` is empty/generic; never cache when the question
  references the asker's faction/zones. Decide *server-side* in `answer_oracle`, not from the flag.
- **Thorough:** classify cacheability server-side in `ask_oracle` (e.g. a keyword/shape heuristic on
  the question), and treat the client `cacheable` as a hint only.

---

## 3 · Database situation

### 3.1 Indexing — stop scanning the whole game

`tables.rs:67` says it out loud:

```rust
pub owner: Identity, // add `#[index(btree)]` for scale; we iterate for now
```

Today, **every** per-player operation is an `O(total rows)` scan. Examples in `reducers.rs`:

- `create_player` clears the old deck by iterating **all cards** filtering `c.owner == sender`.
- `deck_size`, `hero_ceiling`, `active_deck_power`, the draft cull — all iterate the full `card`
  table per call.
- `resolve_round` runs on a **per-player schedule**, so the all-cards scan happens once per player
  per ~minute. With N players holding ~C cards each that's `N` scans of `N·C` rows per minute —
  quadratic in players.

**Fix (low effort, high payoff):** add btree indexes on the columns reducers filter by, and use the
generated index accessors instead of `.iter().filter()`.

```rust
#[spacetimedb::table(name = card, public)]
pub struct Card {
    #[primary_key] #[auto_inc] pub card_id: u64,
    #[index(btree)] pub owner: Identity,   // ← add
    // ...
}
```

```rust
// before: O(all cards)
let n = ctx.db.card().iter().filter(|c| c.owner == owner).count();
// after: O(this player's cards)
let n = ctx.db.card().owner().filter(&owner).count();
```

Index at minimum: `card.owner`, `deck_slot.owner`, `trade.proposer`, `trade.partner`. Audit every
`.iter().filter(|x| x.<col> == …)` in `reducers.rs` — each one is an index waiting to happen.

### 3.2 Bound the tables that grow forever

`oracle_request`, `oracle_reply`, and `battle` are append-only and never pruned. SpacetimeDB bills on
state size, and unbounded public tables also bloat every client's subscription. Add a janitor.

```rust
// In tick_sky (or a dedicated low-frequency schedule): keep recent rows, drop the rest.
fn prune(ctx: &ReducerContext) {
    let cutoff = ctx.timestamp.minus(Duration::from_secs(7 * 24 * 3600));
    for b in ctx.db.battle().iter().filter(|b| b.created_at < cutoff) {
        ctx.db.battle().battle_id().delete(&b.battle_id);
    }
    // Same for answered oracle_request / oracle_reply older than the cutoff.
    // Keep oracle_cache — that's the asset we *want* to retain.
}
```

(Index `battle.created_at` if you prune by time often, so the janitor isn't itself a full scan.)

### 3.3 Other DB notes

- **The sky is now the full naked-eye catalogue (2026-06-11).** `star_node` holds **5,041 stars**
  (HYG-derived, mag ≤ 6.0, embedded in `server/src/catalog.rs`), seeded by `init` (brightest 512)
  + a `tick_sky` backfill batch per tick, cursor on `game_config.star_seed_cursor` (defaulted, so
  the publish was non-destructive). State-size math should assume ~5k public `star_node` rows
  (~400 KB) streaming to every subscriber; `recompute_star_zones` now touches 5k rows per tick
  (reads — writes only on zone crossings, ~6 rows/tick). The web client carries the same
  catalogue (`star-catalog.js` + `sky.js`) and maps the whole visible hemisphere from the
  ascendant to the horizon rim.

- **`oracle_cache` is the crown jewel** — it's the only table you want to *grow*. Pre-warm it (see
  [4.4](#44-pre-warm-the-lore-cache-with-the-batch-api)) and never prune it.
- **Consider a `card_id` btree on `deck_slot.card_id`** — `combine_cards`, `set_loadout`, and the
  loadout checks look slots up by card.
- **Schema migrations are not free.** We already learned to make the natal-chart migration
  non-destructive (`49c2f13`). Keep new columns `#[default(...)]` so a publish doesn't wipe state,
  and regenerate bindings (`spacetime generate`) for **every** client after a schema change.

---

## 4 · AI & Claude API calls

The Oracle service is a solid v1: model tiering by question type, a shared answer cache, and a
context summary that excludes birth data. Here's how to make it production-grade. (Code is
TypeScript / `@anthropic-ai/sdk`, matching `feeder/`.)

### 4.1 Stop polling the CLI; subscribe instead

`checkPendingRequests()` runs `spacetime sql … SELECT … FROM oracle_request WHERE answered = false`
every 3 seconds and then **parses a fixed-width ASCII table** (`parseTable`). This is fragile (any
CLI format tweak breaks it), laggy (≤3s latency), and wasteful (a full query every tick).

Move the service onto the **SpacetimeDB TypeScript SDK** and react to inserts:

```ts
conn.db.oracleRequest.onInsert((ctx, req) => {
  if (!req.answered) void processRequest(req);     // reactive, sub-second, no parsing
});
```

This also lets you call `answerOracle(...)` as a typed reducer over the same socket (using the owner
token from [2.4](#24-the-trusted-side-service-pattern)), retiring the `spacetime call` shell-out and
the table parser in one move.

### 4.2 Make the Oracle service fail-safe

`processRequest` catches errors, logs, and returns — leaving the request `answered = false`. The
poller finds it again next tick and **re-sends it to Claude.** A question that deterministically
errors (a 400 from an over-long context, a refusal, a transient outage that outlasts the SDK's
retries) becomes an **infinite paid retry loop**, and the asker never gets an answer.

Fix three things:

1. **Use typed exceptions + let the SDK retry transient errors.** The SDK already retries 429/5xx
   with backoff (`maxRetries`, default 2). Bump it and classify the rest:

   ```ts
   const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 4 });

   try {
     const response = await anthropic.messages.create({ /* … */ });
     // …
   } catch (err) {
     if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
       return; // transient — leave unanswered, the SDK already backed off; next tick retries
     }
     // Non-retryable (400 / refusal / auth): answer with a graceful message and mark done,
     // so we stop paying to re-ask a question that will never succeed.
     await answerOracle(requestId, "The Oracle's vision is clouded — try rephrasing.", "error");
   }
   ```

2. **Iterate content blocks; don't index `content[0]`.** `response.content[0].type === "text"`
   happens to work today (Haiku/Sonnet with thinking off put text first), but it's a latent bug the
   moment anyone enables adaptive thinking — the first block becomes a `thinking` block and the
   reply goes empty. Pull the text defensively:

   ```ts
   const replyText = response.content.find((b) => b.type === "text")?.text ?? "";
   ```

3. **Add a per-request timeout** (`anthropic.messages.create({...}, { timeout: 30_000 })`) so one
   wedged call can't stall the loop.

### 4.3 The prompt cache is probably *not* firing

`SYSTEM_PROMPT` carries `cache_control: { type: "ephemeral" }` — good intent. But:

- The minimum cacheable prefix is **4096 tokens on Haiku 4.5** and **2048 on Sonnet 4.6**.
- `SYSTEM_PROMPT` is ~90 lines of dense rules/lore — roughly **1.5–2K tokens**.

So on the Haiku tier (the *cacheable rules/lore* path, where caching matters most) the prefix is
almost certainly **below the minimum**, and the cache silently does nothing — no error, just
`cache_creation_input_tokens: 0` and `cache_read_input_tokens: 0` on every call.

**Verify, then decide.** The service already logs these fields — watch them across a few repeats:

- If `cache_read_input_tokens` stays `0`: caching isn't engaging. Either (a) **expand the cached
  prefix past the model's minimum** by folding the full lore/codex into it (worth it only if the
  prefix is large and reused a lot), or (b) **accept no caching** — a ~1.5K system prompt is cheap
  enough that the write premium may not pay back anyway. Don't keep a marker that does nothing and
  call it "optimized."
- Keep stable content first and per-request content (the `context` + `question`) *after* the cached
  prefix. We already do — the volatile parts are in the user turn, not the system prompt. 👍

### 4.4 Pre-warm the lore cache with the Batch API

The 22-card attribution table, the faction doctrines, the zone rules — these are a **finite,
known set of FAQ-shaped questions.** Generate them all once, offline, at **50% cost** via the
Message Batches API and seed `oracle_cache`, so players get instant cached answers from day one and
the live service only ever handles genuinely novel/strategy questions.

```ts
const batch = await anthropic.messages.batches.create({
  requests: KNOWN_LORE_QUESTIONS.map((q, i) => ({
    custom_id: `lore-${i}`,
    params: { model: "claude-haiku-4-5", max_tokens: 1024,
              system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
              messages: [{ role: "user", content: q }] },
  })),
});
// Poll batches.retrieve(batch.id) → ended, then batches.results() → call answer_oracle per row.
```

### 4.5 Give the web client an Oracle too

Once the web client is on the SDK ([2.3](#23-one-truth-two-clients-the-web-client-gap)), the Oracle
chat works for free: the browser calls `ask_oracle`, the same owner-authenticated service answers,
the reply streams back via `oracle_reply`. **No API key in the browser** — it never touches
Anthropic directly; the trusted service does.

If you ever want the web client to call Claude *without* the round-trip through the module, do it
through a **Vercel Edge Function / Cloudflare Worker** that holds the key server-side and proxies
the request. Never `new Anthropic({ apiKey })` in client-side JS.

### 4.6 Cost & safety controls before this goes public

- **The cooldown is 4 seconds** (`ORACLE_COOLDOWN_SECS = 4`). That's fine against accidental
  double-taps, useless against a script. Add a **daily per-identity cap** (extend the existing
  `oracle_rate` row with a rolling count) before opening the chat to the public.
- **No moderation / no token budget per user.** For a public launch, add a daily token budget and
  consider a lightweight moderation pass on free-text questions.
- **Model choice — free chain first (corrected 2026-06-08).** New in-character / runtime AI features
  across our projects default to the **free chain** (Groq Llama-70B for the sharp work, 8B-instant for
  the rest → Cerebras → Gemini), **not** Anthropic. The planetary-agents Word Duel brain
  ([4.8](#48-the-planetary-agents-word-duel-brain-the-agent_letters-seam)) is the reference
  implementation and proves the pattern: a structured, constrained choice (pick one of N candidates +
  one sentence) is well within a free 70B model, and an always-valid deterministic fallback removes the
  quality risk. Reserve Anthropic/Opus for development and genuinely hard reasoning, decided per-feature
  on a measured sample — never as the default by habit. The Oracle's current Haiku/Sonnet split is a
  reasonable cost choice for short chat; when you next touch it, evaluate moving it onto the free chain
  to match this rule.

### 4.7 Model-ID hygiene (when you *do* use Anthropic — dev, hard reasoning, the Oracle)

- Use the **exact** alias strings, no date suffixes: `claude-opus-4-8`, `claude-sonnet-4-6`,
  `claude-haiku-4-5`. (We're clean here — keep it that way.)
- On Opus 4.7/4.8: `temperature` / `top_p` / `top_k` and `budget_tokens` are **removed** (400 if
  sent). Use `thinking: { type: "adaptive" }` + `output_config: { effort: … }` instead of a token
  budget.
- Pin the SDK and re-check model availability from the Models API rather than hardcoding assumptions
  about context windows / pricing.

### 4.8 The planetary-agents Word Duel brain (the `agent_letters` seam)

Today the Word Duel opponent is deterministic: `agent_letters(ctx, opponent)` in `server/src/reducers.rs`
seeds a sky-locked rack and `words::best_word` plays the greedy longest word. The code comment there
marks it as the seam for a "richer, model-driven hand." **As of 2026-06-08, the planetary-agents side
of that seam exists** (Iteration 1):

```
POST https://api.agents.alchm.kitchen/api/agents/word-duel        (and a local desktop surface)
{ planet, rack, candidates: ({word,score} | string)[], context? }
→ { success, planet, move: { word, rationale, score, source }, timestamp }
```

It returns the word a planet would play **in character** (Mars strikes short and high-value, Jupiter
reaches longest, Mercury maximizes), with a one-line rationale in the planet's voice. Key facts that
shape *our* side of the wiring:

- **Thin brain — we own the dictionary.** PA holds no wordlist. We send the legal `candidates`
  (we already compute them: `words::best_word` becomes "rank the legal set"). PA chooses + voices.
  Scoring is byte-compatible with `words.rs` (`CAT=5, STAR=6, SPELL=14`), so `score` agrees.
- **Free chain, fail-safe.** PA runs on Groq (no Anthropic spend) and *always* returns a legal move —
  it races the model against a ~2.5s deadline and falls back to the top-ranked candidate. So a slow or
  down brain degrades to today's greedy behavior, never a stuck duel. (This is exactly the §5.5
  fail-safe pattern, enforced on the other side of the wire.)

**What to build here — reuse the Oracle pattern verbatim ([2.4](#24-the-trusted-side-service-pattern-and-how-to-deploy-it)).**
A reducer cannot make HTTP calls, so don't try to call PA from `cast_word`. Instead:

1. **`duel_challenge` table** — asker identity, opponent planet, sky-seed index, `answered` flag
   (mirror `oracle_request`). When a player opts into a model-driven opponent, enqueue a row.
2. **`answer_duel` reducer (owner-gated)** — posts the AI move (`word`, `rationale`, `score`) into
   `word_duel` and closes the challenge (mirror `answer_oracle`).
3. **`feeder/duel-service.ts` companion** — a near-copy of `feeder/oracle-service.ts`: poll
   `duel_challenge WHERE answered=false`, compute the legal candidates for the seeded rack, `POST` to
   the PA endpoint, then `spacetime call … answer_duel`. Same owner-token auth ([2.4](#24-the-trusted-side-service-pattern-and-how-to-deploy-it)),
   same prune plan ([3.2](#32-bound-the-tables-that-grow-forever)).

This keeps `cast_word` deterministic and offline-capable (greedy default), and lets a player escalate
to a real planetary agent without touching the duel reducer — precisely the seam the README promised.

---

## 5 · Reusable patterns to carry across our projects

Distilled from the above — the parts that aren't Pentacles-specific:

1. **Client proposes, owner disposes.** Untrusted clients call validating reducers; a trusted job
   authenticated as the owner does the privileged writes (feeds, AI answers, settlement). The only
   credential a browser holds is its own identity token.
2. **Secrets live exactly one place: server-side.** Anthropic keys, SpacetimeDB owner tokens →
   secret manager / platform env, never the repo, never the bundle. Browser → edge function → API.
3. **Index every lookup column from day one.** "We iterate for now" is a scaling time-bomb; the fix
   is one attribute per column.
4. **Every append-only table needs a prune plan at birth.** Decide what you keep (caches, ledgers)
   and what you drop (transient requests, event logs) before it grows.
5. **AI calls must be fail-safe and idempotent.** Typed-exception handling, SDK retries for
   transient errors, a terminal answer for non-retryable ones (no infinite re-billing), block-aware
   parsing (never `content[0]`), per-request timeouts, and an answer cache so you never pay twice for
   the same question.
6. **Verify your prompt cache; don't assume it.** Watch `cache_read_input_tokens`. A `cache_control`
   marker on a sub-minimum prefix is a no-op dressed as an optimization.
7. **One authoritative source of truth.** Don't ship two clients that simulate the world
   differently. The server is truth; local state is a cache that reconciles on reconnect.

---

## 6 · Suggested sequencing

- **This week (S):** btree indexes (#1) · verify/fix prompt cache (#2) · Oracle fail-safe loop (#3).
- **Next (M):** owner token + deployable workers (#4) · SDK subscription for the Oracle (#6) ·
  table pruning (#7) · server-side `cacheable` decision.
- **Then (L):** put the web client on the live module (#5) · web Oracle · Batch-API lore pre-warm ·
  public-launch cost/safety caps · wire the planetary-agents Word Duel brain at the `agent_letters`
  seam ([4.8](#48-the-planetary-agents-word-duel-brain-the-agent_letters-seam): `duel_challenge` +
  `answer_duel` + `feeder/duel-service.ts`).

---

*Began as a hackathon retrospective; updated 2026-06-08 into a live cross-project briefing after the
planetary-agents Word Duel session. The Pentacles items are grounded in the code at `server/`,
`feeder/`, and `client.js` as of this branch; §4.8 and the "Where we are now" lead reflect the
planetary-agents brain that is built and tested in that repo (see its
`docs/planetary-agents-word-duel-spec.md` §6). File/line references point at the real thing, not
aspirations.*
