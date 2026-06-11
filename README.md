# Pentacles

**Location-based AR MMO — claim the night sky.**

Your real birth chart decides your planetary faction, the Tarot is your arsenal,
and the visible heavens are the contested map: a sky-spanning Pentacle of eleven
capturable zones, fought over star-by-star.

> **Post-hackathon:** see [`docs/MORNING_AFTER.md`](docs/MORNING_AFTER.md) — a field guide for
> hardening the SpacetimeDB integration, the Claude/AI calls, and the database situation, grounded
> in the code as it shipped (indexing, deployable owner-token auth, fail-safe Oracle calls, prompt-
> cache verification, and wiring the web client to the live module).

```
Pentacles/
├── Pentacles_GDD.html          # the Game Design Document — open in a browser
├── pentacles.css               # GDD stylesheet
├── README.md
├── star-catalog.js             # the real sky: 5,041 naked-eye stars (web client copy)
├── sky.js                      # web client celestial math + pentacle partition
├── scripts/
│   └── make_catalog.py         # regenerates both star catalogues from HYG
├── server/                     # SpacetimeDB module — Rust (authoritative state)
│   ├── Cargo.toml
│   └── src/{lib,types,tables,chart,combat,reducers,catalog}.rs
├── unity/                      # Unity client
│   ├── CelestialPentacleConn.cs    # connection + reducer calls + FrameTick
│   ├── ChartCalculator.cs          # birth input → NatalChart (placements/asc/MC)
│   ├── SkyMath.cs                  # ecliptic ↔ equatorial ↔ horizontal ↔ world
│   ├── PentacleGrid.cs             # the eleven-zone geometry (horizon-anchored)
│   ├── SkyRenderer.cs              # AR renderer: stars + Pentacle + tap-to-attack
│   ├── FactionData.cs              # faction glyphs/colours/doctrines (GDD §03)
│   ├── OnboardingController.cs     # birth → TopFactions → CreatePlayer (flow logic)
│   ├── OnboardingUI.cs             # drop-in birth-form + faction-select screen
│   ├── UIKit.cs                    # shared programmatic-uGUI helpers
│   ├── CardView.cs                 # one Tarot card widget
│   ├── CombatPreview.cs            # client-side strike-power estimate
│   ├── DeckPanel.cs                # live hand strip + selection + card-granted toast
│   ├── BattlePanel.cs              # star-target overlay: strike + result
│   └── DuelPanel.cs                # live PvP "Lane Skirmish" duel
└── feeder/                     # real-ephemeris cron (Bun)
    ├── ephemeris.ts                # low-precision geocentric positions
    ├── push-ephemeris.ts           # pushes positions via the push_ephemeris reducer
    └── package.json
```

## Playable Web App Client

A standalone, lightweight 2D/AR-toggleable Web Client is now available in the project root to support playing the game directly in any standard desktop or mobile web browser.

### Key Features:
*   **Onboarding & Placements**: Enter date/time/location data to calculate chart placements, evaluate recommended factions by dignity score, and deterministically mint your starting deck of 40 cards.
*   **The Real Sky, Fully Mapped**: Every naked-eye star (5,041 to magnitude 6.0, from the HYG catalogue) above your observer's horizon is computed live — alt/az from your lat/lon and the sidereal clock — and projected onto the Pentacle disk (zenith at the centre, the horizon at the rim). The pentagram partitions the visible hemisphere into the 11 zones, so every star from the rising **Ascendant** (marked live on the rim, with a compass rose) to the edge of the sky belongs to exactly one zone. The sky drifts through the zones in real time; stars below the 10° engagement band render dimmed and unstrikeable, mirroring the server gate.
*   **The Wanderers — Planetary Agents in the Same Sky**: The ten bodies (real geocentric positions, the same low-precision ephemeris as `feeder/ephemeris.ts`) share the stars' plane — one projection, one disk — but at honest scale: they are far **closer** than any star, so they render much larger (faction-coloured glyph medallions with halos vs pinprick stars, which stay small until hovered and bloom under the cursor). Each planet is the **planetary agent of its associated degree** — the same agents from the `planetary-agents` project that answer in Word Duels. Its rack is seeded by its real ecliptic position, its tooltip gives sign/degree/altitude/transiting zone, and tapping its medallion opens the ✦ Words tab with that agent targeted. The dashed ecliptic is the road the agents walk.
*   **Victory Spoils**: A won siege makes the conquered star yield a fresh Arcana — suit from the star's zone, pip rank from its sky position, stats scaled by its brightness, and a Scrabble **Letter** for your Word-Duel rack (capped at 100 cards with weakest-bench replacement, like the server economy).
*   **Multi-Faction Auto-Siege Combat**: Star battles support up to all 10 factions contesting a single star simultaneously. Turn order is driven by card speeds, and bot cards automatically focus-fire on the strongest remaining faction.
*   **Astral Sign In & Profiles**: Switch between different Seeker profiles, discard characters, or export/import base64-encoded Astral Keys to transfer saves across browsers and devices.
*   **Web Audio Synth Engine**: Creates sound effects and music entirely inside the browser's native audio engine (no heavy audio files to load):
    *   Detuned low oscillators synthesize a deep space ambient drone.
    *   Sine-wave frequencies make clean chimes when selecting and fusing cards.
    *   Low pass filters and noise generators simulate combat strikes.
*   **Persistence & Bot Activity**: Saves all state (profile, deck, levels, map captures) in `localStorage`. Runs a background loop that decays controlled zones and triggers periodic bot attacks to simulate an active sky.

### Run Locally (Bun)

Start the lightweight static file server from the root directory:
```bash
# Serves the playable client at http://localhost:8080/ (and /client.html)
bun --bun run serve.ts  # Or serve via your preferred static file server
```

### Deploy to Vercel

The web client deploys directly as a static project (`vercel.json` rewrites `/`
to `client.html`, so the root URL serves the playable client; the design doc
stays at `/Pentacles_GDD.html`):
```bash
# Deploy to Vercel production
vercel --prod
```

---

## SpacetimeDB — Maincloud

| Key | Value |
| --- | --- |
| Database (module) name | `cookingwithcastrollc` |
| Owner identity | `c2007058fefb90b9ffcd33379c03d135cbecadda7b901575d9b8ed8ca06ddb52` |
| Host | `wss://maincloud.spacetimedb.com` |
| CLI tested against | `spacetime` v2.4.1 |

### 1 · Deploy the backend

```bash
cd server
# Match Cargo.toml's spacetimedb version to your CLI. Cleanest:
#   spacetime init --lang rust .     # then keep these src/*.rs files
spacetime login                      # you're already logged in as the owner
spacetime build
spacetime publish cookingwithcastrollc   # runs `init` (seeds 11 zones + the brightest stars)
spacetime logs cookingwithcastrollc -f
```

**The full sky seeds itself.** `init` plants the brightest 512 stars immediately;
`tick_sky` then backfills the rest of the embedded naked-eye catalogue
(`server/src/catalog.rs` — **5,041 stars to magnitude 6.0**, generated from the
HYG database) a batch per 10-second tick, so the whole sky is in within ~3
minutes. An already-published module catches up the same way after an upgrade —
the `star_seed_cursor` on `game_config` tracks progress and existing captures
are never touched. To regenerate the catalogue (both the Rust and web copies):

```bash
curl -sL -o /tmp/hygdata.csv \
  https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv
python3 scripts/make_catalog.py /tmp/hygdata.csv
```

The Rust module is compile-tested against the generated bindings in this repo;
if you add new schema or reducers, publish and regenerate the C# bindings before
opening the Unity project.

> After adding tables/reducers (e.g. the live-duel set: `duel` table +
> `commit_duel` and the rewritten `enqueue_duel`), re-run `spacetime build &&
> spacetime publish cookingwithcastrollc`, then `spacetime generate` again so the
> C# bindings pick up the new table and reducers.

### 2 · Generate the Unity bindings

```bash
spacetime generate --lang csharp --out-dir ../unity/Assets/Autogen
```

Drop the `unity/*.cs` scripts into your Unity (AR Foundation) project. Wiring:

- **`CelestialPentacleConn`** on a bootstrap object — connects to
  `cookingwithcastrollc`, subscribes to the sky, calls reducers (`FrameTick`
  every `Update`).
- **`ChartCalculator.Build(birthUtc, lat, lon, timeKnown)`** turns real birth
  input into the `NatalChart` you pass to `CreatePlayer`. `TopFactions(chart)`
  gives the three choices to surface (server re-validates the pick).
- **`SkyRenderer`** on the AR camera rig (align the AR session to true North) —
  renders the live `star_node` catalogue, draws the horizon-anchored Pentacle,
  colours zones/stars by faction, and turns a tap into `ResolveStarBattle`.
- **`OnboardingUI`** on an empty object in your first scene — builds the birth
  form, computes the chart + the three faction choices, and calls `CreatePlayer`.
  Wire its `onComplete` (or assign `arSceneRoot`) to reveal the AR rig on success.
  Flow logic is in `OnboardingController` if you'd rather use your own UI.
- **`DeckPanel`** + **`BattlePanel`** on the AR rig — `DeckPanel` shows the live
  hand (from `deck_slot` + `card`) and tracks selection; tapping a star opens
  `BattlePanel`, which previews strike power, fires `ResolveStarBattle`, and reads
  the `battle` row to show CAPTURED / repelled with the real score vs defense.
- **`DuelPanel`** on the AR rig — the "⚔ Duel" button on a star queues a live
  duel for its zone; when a second player queues the same zone the server spawns
  a `duel`, both phones open this panel, assign one card per lane, and
  `commit_duel` resolves best-of-3 to swing the zone.
- **`Oracle`** on the AR rig — the in-world advisor. It surfaces cadence-capped
  nudges (a planet entering a favorable zone, the weather turning to your suit, a
  held zone slipping, a fresh reachable target) as toasts, with a Mute toggle —
  pure client-side heuristics, no service required. The top-right "✦ Oracle"
  button opens:
- **`OraclePanel`** + **`OracleLore`** on the AR rig — tips + chat + codex. An
  instant heuristic tip, a free-text chat with Claude (a question → `ask_oracle`
  with a derived context summary, never birth data; the reply streams back via
  `oracle_reply`), and the browsable "Book of the Sky". Tips + codex work offline;
  chat needs the companion service running to answer.
- **`Tutorial`** on the AR rig — an Oracle-narrated first-run walkthrough (the
  board → your chart-deck → the rotating weather → your first strike), shown once
  and replayable from the codex. **`LongPress`** + **`Tooltip`** add contextual
  help: long-press a card — or a star in the sky — to read what it is (and, for a
  star, why you can or can't strike it yet), with an "Ask the Oracle ›" escalation
  to chat.
- **`CollectionPanel`** on the AR rig — a "✦ Cards" launcher opens your whole
  collection; tap a card then a matching copy to **fuse** them (`combine_cards`),
  leveling it up. Card widgets show a card's `✦ Lv`. A "Trade ⇄" button opens:
- **`TradePanel`** on the AR rig — confirmed two-way trades. See your open trades
  (you give / you get) with Confirm + Cancel, or propose one: pick a partner,
  stake some of your cards and tap some of theirs (cards are public), and
  `propose_trade`; the swap commits only when both sides confirm.

### 3 · Run the ephemeris feeder

```bash
cd feeder
bun run push-ephemeris.ts          # loop (default every 15 min)
bun run push-ephemeris.ts --once   # single pass — wire to cron/Railway if you like
```

It computes all ten bodies — position plus an apparent-**retrograde** flag (ecliptic
longitude vs a day earlier; this drives a drafted card's inversion) — and calls
`push_ephemeris` through the `spacetime` CLI, so it authenticates as your owner
identity (the reducer is owner-gated). No token plumbing.

### 4 · Run the Oracle service (Claude chat)

```bash
cd feeder
bun add @anthropic-ai/sdk                        # once
ANTHROPIC_API_KEY=sk-ant-... bun run oracle-service.ts
```

It polls `oracle_request` for unanswered questions, asks Claude (Haiku 4.5 for
cacheable rules/lore, Sonnet 4.6 for live strategy; the rules system prompt is
prompt-cached), and writes the reply back through the owner-gated `answer_oracle`
— same `spacetime`-CLI owner auth as the feeder. It sees only the derived context
summary the client attached, never birth data. The heuristic Oracle, tips, codex,
and tutorial all work without it; this powers only the free-text chat.

## How the pieces map to the GDD

| GDD section | Where it lives |
| --- | --- |
| §02 Natal chart → faction | `unity/ChartCalculator.cs` + server `chart::faction_scores` (top-3 dignity check) |
| §04 Deck generation | `chart::mint_deck` — decan→pip (cardinal 2–4 / fixed 5–7 / mutable 8–10), chart-ruler→Ace, angular/ruling→court by dignity, plus each planet's Major trump; stats from degree/minute/dignity |
| §05 Eleven zones | `unity/PentacleGrid.cs` (geometry) + server `init` (5 houses / 5 spires / 1 crown) |
| §06 Suits (environmental) | `combat::element_weather` — a zone's element favors its suit (×1.35 / opposite ×0.75); no card-vs-card counters |
| Round weather (the Great Wheel) | `tick_sky` → `advance_round_clock` advances the world Ascendant (NYC) in `game_config.season_degree`; `zone_favored_suit` rotates the 12 signs through the 11 zones so each carries its own live element |
| §07 Star → zone tug-of-war | `resolve_star_battle` + `apply_control` (signed meter, flip at ±600) |
| §08 AR & ephemeris | `unity/SkyMath.cs` + `SkyRenderer.cs` · `feeder/` + `push_ephemeris` · the full naked-eye star catalogue `server/src/catalog.rs` (5,041 stars, HYG-derived, regenerate with `scripts/make_catalog.py`), mirrored to the web client as `star-catalog.js` + `sky.js` |
| GPS engagement | `unity/GpsService.cs` (single GPS authority, with editor fallback) → `set_location` (private `player_location`); `resolve_star_battle` gates on `altitude_deg ≥ 10°`. `SkyRenderer` dims the 0–10° band and `BattlePanel` disables Strike with the reason, so the AR view matches the gate |
| Deck curation | `set_loadout` (Active capped at 8) via a per-card loadout chip in `DeckPanel`/`CardView` (Active → Defense → Bench); `create_player` is idempotent — re-registering clears the old deck before re-minting |
| Zodiac seals (territory) | `sealed_suits` — a faction masters the elements of the signs sitting in the zones it holds; its cards of those suits fight at `combat::SEAL_BONUS` (×1.15) in sieges & duels. Derived from zone ownership + the rotating sky, so it shifts as the wheel turns |
| Card individuality & economy | Every `card` is a unique instance, gained **exactly two ways**: the onboarding deck minted from your natal placements (`mint_deck`), and **one auto-drafted card at the end of a successful round** (the Ascendant clock, below). There is no independent capture Sky-Drop — a won battle feeds the round's success tally, not an instant mint. Copies of the same card **combine** to `level` up with gentle-plateau diminishing returns (`combat::level_mult`, ×1.0→×1.5 ceiling, applied in every siege & duel); cards move between players by **confirmed two-way trades** (`propose_trade` / `confirm_trade` / `cancel_trade`, both sides stake & re-validated at commit) |
| Blend (natal × transits) | `chart::compute_house_cusps` lays Placidus house cusps (Whole-Sign fallback above the polar circle / for a timeless chart), `house_of` / `house_salience` weight them; `chart::transit_modulation` lifts each transiting body's faction (and its house ruler) by that house's salience, and `chart::blend` folds it into the natal `faction_scores` at a fixed 70 / 30 split (`blended_faction_vector`) — so a transit crossing onto an angle can open or close a faction round to round without ever overriding the chart. `equatorial_to_ecliptic_min` recovers each transit's zodiac λ from its stored RA/Dec; `synastry` reuses the same houses for matchmaking telemetry |
| Per-round re-draft (Ascendant clock) | A scheduled per-player reducer `resolve_round` (table `round_timer`) paces rounds — ~1 min real, lengthening in 25-card bands past 25 (`round_interval_secs`). A round is **successful** if you won ≥1 battle (`round_state` tally); offline/idle rounds auto-battle the blended active deck vs the round's challenge. On success it drafts one card via `chart::draft_card`: leading body of the blended vector → its transit sign's suit, a **pip rank only** (never court/hero), power = transit_strength × natal dignity clamped strictly below the hero trump, **inverted with reversed stats** if the source is retrograde, deterministic on `drop_seed(identity, round, body)`. Lands on the Bench; at `COLLECTION_CAP` (100) it replaces only the weakest **Bench** card if stronger (Active/Sentinel/trump untouched). Keeps pacing server-side while away, catch-up capped at one cap's worth |
| Bots (always-on war) | `tick_sky` → `bot_raid` for unmanned factions |
| Oracle (advisor) | client-side heuristic `OracleAdvisor` + `Oracle` — proactive nudges (Toast, cadence-capped + mutable) on transits / favorable weather / a slipping zone / a fresh target, and an on-demand tip. In-world oracle voice; reads only public tables + your local chart |
| Oracle (chat agent) | `ask_oracle` (per-player cooldown; instant answer from `oracle_cache` on a repeat rules question, else queued) → a `feeder/`-style companion service reads `oracle_request`, asks Claude (tiered Haiku/Sonnet), and returns it via owner-gated `answer_oracle` → `oracle_reply` (caching generic answers for everyone). Only a derived chart/state summary is sent — never birth data. Built end-to-end: `feeder/oracle-service.ts` is the companion service (tiered Haiku/Sonnet, prompt-cached) |
| The Lettered Arcana / Word Duels | Every `card` carries a `letter` drawn from the real 98-tile Scrabble bag by its id (`words::letter_for`), stamped at every mint (onboarding deck + the per-round draft — so a tile accrues every match). Your collection is your rack. `cast_word(word, opponent)` validates a Word of Power against the embedded Codex (`words.rs`; curated `wordlist.txt`, swap in full ENABLE at deploy) and your letters, the chosen **planetary agent** answers with its best word from a sky-seeded rack (`best_word` — the scrabblebot `chooseWord` solver), and you win `word_score × 50` tokens (+500 for beating it) into `player.tokens`. Recorded in `word_duel`; cooldown via `word_rate`. Ported from `clockworklabs/scrabblebot`; `agent_letters` is the seam to drive opponents from the `planetary-agents` project |

## Playable Web Client (Non-AR & AR Gyroscope)

A lightweight web client (`client.html`) is provided in the project root to play and test the game's core loops in any standard desktop or mobile web browser.

### How to Run:
1. Start a static server from the project root:
   ```bash
   python3 -m http.server 8080
   ```
2. Navigate to **[http://localhost:8080/client.html](http://localhost:8080/client.html)**.
3. Complete the onboarding screen with your birth details to generate deterministic local chart placements, recommended factions, and the 20-card starter deck shape used by the server.

### Key Features:
- **Interactive 2D Pentacle Map**: A clickable vector representation of the 11 houses, spires, and zenith crown containing magnitude-weighted stars.
- **Auto-Siege Resolver**: JS client-side mirror of the shipped auto-resolve loop using environmental suit weather, zodiac seal bonuses, cups healing, and the same gentle card-level curve.
- **Word Duels of the Spheres (✦ Words tab)**: The Lettered Arcana — every card carries a Scrabble letter, so your collection is your rack. Spell a Word of Power and a planetary agent answers with its best word (the ported scrabblebot solver) over the shared `wordlist.txt` Codex; match or beat it for massive tokens. A JS mirror of the server `cast_word` reducer (same scoring, same dictionary), so it plays offline today and can call the reducer once the web client is wired to the live module.
- **AR View Mode**: Integrates `navigator.mediaDevices.getUserMedia` for a camera backdrop and `deviceorientation` to rotate the celestial grid in real-time.
- **Synthesized Audio**: Leverages the browser Web Audio API to play ambient cosmic drones, card flip chimes, and combat explosion sfx.
- **Local Persistence & Bots**: Syncs state directly to browser `localStorage`. Runs a background simulation that decays controlled zones and triggers periodic bot attacks to keep the map contested.

## Notes & accuracy

- **The chart is computed client-side** (`ChartCalculator`) and committed once;
  the server stores it immutably and never runs heavy astronomy in the module.
- Ephemeris is **game-grade** (JPL low-precision Keplerian + truncated Sun/Moon
  series) — sub-degree for the Sun/planets, ~a degree for the Moon. Plenty for
  sign/zone placement; swap in SwissEphNet / Swiss Ephemeris for production.
- The Pentacle is **fixed to the local horizon**; stars and planets drift through
  it (their alt/az is recomputed every frame). The feeder seeds each planet's
  latest RA/Dec, and `tick_sky` maps those bodies into the shared rotating zone
  frame for transit buffs and bot raids; each player's AR overlay is observer-local.
- **Clients never write state** — they call reducers, which validate and mutate
  transactionally. `natal_chart` is the one private table.
