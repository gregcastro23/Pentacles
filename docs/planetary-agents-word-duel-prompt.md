# Prompt — Wire the Planetary Agents into Pentacles' Word Duels

> **Where to run this:** paste it as the task into Claude Code (or your agent) running in
> the **`gregcastro23/planetary-agents`** repository. It builds the *planetary-agents side*
> of the integration; the Pentacles side already ships the seam (`agent_letters` /
> `best_word` / `cast_word`) on branch `claude/gallant-ride-436PI` (PR #4).

---

## PROMPT (copy from here down)

You are working in the **planetary-agents** project — an AI platform of ten astrological
"planetary agents." A sister game, **Pentacles** (a SpacetimeDB AR MMO), just shipped a
feature called **Word Duels of the Spheres / The Lettered Arcana**: every Tarot card
carries a Scrabble letter, a player's collection is their rack, and they spell a "Word of
Power" against a **planetary agent** opponent for token rewards. Today that opponent is a
deterministic greedy word-finder baked into the Pentacles module. **Your job: replace it
with real, in-character AI planetary agents from this project.**

### Goal
Implement a **Planetary Duelist** capability: given a planet, a letter rack, and optional
game context, return a **valid, spellable** word that reflects that planet's personality
and strategy — exposed through a clean interface Pentacles can call.

### The contract (must match Pentacles exactly)

```ts
// One of the ten factions.
type Planet = "Sun"|"Moon"|"Mercury"|"Venus"|"Mars"|"Jupiter"|"Saturn"|"Uranus"|"Neptune"|"Pluto";

// A rack is the letters available, either a multiset count map or a plain string.
type Rack = Record<string, number> | string;

interface DuelContext {
  round?: number;
  seasonDegree?: number;   // the world Ascendant (0..359), the rotating sky
  playerWord?: string;     // what the human just played (for flavor / pressure)
  playerScore?: number;
}

interface AgentMove {
  word: string;       // UPPERCASE, A-Z only, >= 2 letters
  rationale: string;  // one in-character sentence ("Mars strikes fast and hard.")
  score: number;      // computed with the scoring below — must equal Pentacles'
}

// The core entry point.
function chooseWord(planet: Planet, rack: Rack, ctx?: DuelContext): Promise<AgentMove>;

// Optional (for the future "Astral Auction" mode — mirrors clockworklabs/scrabblebot):
function decideBid(planet: Planet, letter: string, balance: number, rack: Rack): Promise<number>;
```

**Scoring — copy verbatim from Pentacles so scores agree:**
- Standard Scrabble `LETTER_VALUES` (A=1,B=3,C=3,D=2,E=1,F=4,G=2,H=4,I=1,J=8,K=5,L=1,M=3,
  N=1,O=1,P=3,Q=10,R=1,S=1,T=1,U=1,V=4,W=4,X=8,Y=4,Z=10).
- `lengthMult(len)` = 1.0 (≤3), 1.5 (4), 2.0 (5), 2.5 (6), 3.0 (≥7).
- `wordScore(word)` = round(sum(values) × lengthMult(len)).
- **Validity:** the word must be in the ENABLE wordlist (the full ~173k list scrabblebot
  ships in `spacetimedb/wordlist.txt`; Pentacles embeds a curated subset in
  `server/src/wordlist.txt`). Use the full ENABLE list here.
- **Spellability:** the word's letter multiset must be ⊆ the rack.

### The ten planetary personas (strategy + voice)

Each agent picks among *valid, spellable* words by its temperament — the persona shapes
**which** legal word it plays, it never bends the rules.

| Planet | Suit | Temperament → word preference |
|---|---|---|
| ☉ Sun | Wands | Sovereign, radiant — confident high-value words; plays to dominate. |
| ☽ Moon | Cups | Intuitive, tidal — soft, flowing, rhythmic words. |
| ☿ Mercury | Swords | Cunning — the sharpest duelist; maximizes score with long, clever, high-value words. |
| ♀ Venus | Cups | Harmonious — elegant, pleasing, well-balanced words. |
| ♂ Mars | Wands | Aggressive — short, punchy, high-impact strikes; favors letter value over length. |
| ♃ Jupiter | Wands | Expansive — grand; favors the **longest** word it can form. |
| ♄ Saturn | Pentacles | Disciplined — solid, structured, dependable words; never reckless. |
| ♅ Uranus | Swords | Chaotic — surprising, unusual, off-beat words. |
| ♆ Neptune | Cups | Illusory — dreamy, ambiguous, mystical words. |
| ♇ Pluto | Swords | Transformative — intense, dark, powerful words. |

### How to build it (model + architecture)

Use the **Anthropic SDK** (`@anthropic-ai/sdk`) — this is a Claude integration.
- **Default model `claude-opus-4-8`.** You may tier for cost: the strategic planets
  (Mercury, Jupiter, Saturn) on a stronger model, the quick ones on `claude-haiku-4-5`.
- **Prompt-cache the per-planet persona** system prompt (it's stable; the rack/context is
  the volatile suffix — keep it after the cache breakpoint). Verify with
  `usage.cache_read_input_tokens`; note the prefix must clear the model's cache minimum
  (4096 tokens on Haiku, 2048 on Sonnet) or caching silently no-ops.
- **Constrain the output** with structured outputs (`output_config.format`, or
  `messages.parse()`) to `{ word: string, rationale: string }`. Give the model the rack
  and a short list of strong candidate words (precompute the top-N legal words by your
  scoring) so it *chooses in character* rather than inventing letters.
- **NEVER trust the model's word blind.** After every call: uppercase it, check it's in the
  ENABLE dictionary AND spellable from the rack. If it fails (or the call errors/times
  out), **fall back to a deterministic greedy solver** — port `best_word` from Pentacles
  `server/src/words.rs` (the longest playable word, ties broken by base value). The agent
  must always return a legal move within ~2s.

### Delivery surfaces (build A; B is optional)

**A) HTTP API (required).** `POST /api/planetary-duel` with `{ planet, rack, context }` →
`AgentMove`. This is what the Pentacles **web client** will call to get a richer opponent
than its local greedy bot, and what a Pentacles companion service can call. Make it
stateless, validated, and fast (cache personas, cap latency, fall back on error).

**B) SpacetimeDB companion worker (optional, mirrors `feeder/oracle-service.ts`).** A worker
that connects to the Pentacles module `cookingwithcastrollc`, watches for duel challenges,
and submits the agent's word via an **owner-gated reducer** (same trusted-side-service
pattern as the ephemeris feeder and the Oracle). *This requires a small Pentacles-side
change* — a `duel_challenge` table + `answer_duel` owner-gated reducer — so list it as a
cross-repo follow-up, don't assume it exists yet.

### Deliverables
1. A `planetary-duelist` module: `chooseWord` (+ optional `decideBid`), the scoring, the
   ENABLE dictionary loader, and the greedy fallback solver.
2. The ten persona system prompts (one per planet), prompt-cached.
3. The `POST /api/planetary-duel` endpoint with input validation.
4. Tests: scoring parity with Pentacles (CAT=5, STAR=6, SPELL=14); every returned word is
   dictionary-valid and rack-spellable; the fallback triggers on an invalid model word;
   distinct planets produce distinguishable choices on the same rack.
5. A short README section: the contract, how Pentacles consumes it, env vars
   (`ANTHROPIC_API_KEY`), and the cross-repo follow-up for surface B.

### Guardrails / acceptance criteria
- Output is **always** a legal move (valid + spellable) or the greedy fallback — never an
  illegal word, never an empty response that 500s.
- Scores computed here equal Pentacles' `wordScore` for the same word.
- Secrets (`ANTHROPIC_API_KEY`) stay server-side; never shipped to a browser bundle.
- Persona affects *selection among legal words only*; it never overrides validity, scoring,
  or spellability.

### Reference (read these in the Pentacles repo for the exact contract)
- `server/src/words.rs` — `LETTER_VALUES`, `length_mult`, `word_score`, `can_spell`,
  `best_word` (the greedy solver to port), `letter_for` (the 98-tile bag).
- `server/src/reducers.rs` — `cast_word` and `agent_letters` (**the seam** you're replacing).
- `client.js` — the JS port of the engine (`bestWord`, `wordScore`, `canSpell`).
- `docs/MORNING_AFTER.md` — the SpacetimeDB integration + trusted-side-service patterns.
