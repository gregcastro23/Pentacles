# Pentacles

**Location-based AR MMO — claim the night sky.**

Your real birth chart decides your planetary faction, the Tarot is your arsenal,
and the visible heavens are the contested map: a sky-spanning Pentacle of eleven
capturable zones, fought over star-by-star.

```
Pentacles/
├── Pentacles_GDD.html          # the Game Design Document — open in a browser
├── pentacles.css               # GDD stylesheet
├── README.md
├── server/                     # SpacetimeDB module — Rust (authoritative state)
│   ├── Cargo.toml
│   └── src/{lib,types,tables,chart,combat,reducers}.rs
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
spacetime publish cookingwithcastrollc   # runs `init` (seeds 11 zones + 8 stars)
spacetime logs cookingwithcastrollc -f
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

It computes all ten bodies and calls `push_ephemeris` through the `spacetime`
CLI, so it authenticates as your owner identity (the reducer is owner-gated). No
token plumbing.

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
| §08 AR & ephemeris | `unity/SkyMath.cs` + `SkyRenderer.cs` · `feeder/` + `push_ephemeris` |
| GPS engagement | `unity/GpsService.cs` (single GPS authority, with editor fallback) → `set_location` (private `player_location`); `resolve_star_battle` gates on `altitude_deg ≥ 10°`. `SkyRenderer` dims the 0–10° band and `BattlePanel` disables Strike with the reason, so the AR view matches the gate |
| Deck curation | `set_loadout` (Active capped at 8) via a per-card loadout chip in `DeckPanel`/`CardView` (Active → Defense → Bench); `create_player` is idempotent — re-registering clears the old deck before re-minting |
| Zodiac seals (territory) | `sealed_suits` — a faction masters the elements of the signs sitting in the zones it holds; its cards of those suits fight at `combat::SEAL_BONUS` (×1.15) in sieges & duels. Derived from zone ownership + the rotating sky, so it shifts as the wheel turns |
| Card individuality & economy | Every `card` is a unique instance: starter cards are minted from your natal placements (`mint_deck`), and **any capture mints a fresh card from the live sky at that instant** (`chart::mint_from_sky` — its source body is the most-dignified transiting planet; its arc-minute is the literal second of minting). Copies of the same card **combine** to `level` up with gentle-plateau diminishing returns (`combat::level_mult`, ×1.0→×1.5 ceiling, applied in every siege & duel); cards move between players by **confirmed two-way trades** (`propose_trade` / `confirm_trade` / `cancel_trade`, both sides stake & re-validated at commit) |
| Bots (always-on war) | `tick_sky` → `bot_raid` for unmanned factions |
| Oracle (advisor) | client-side heuristic `OracleAdvisor` + `Oracle` — proactive nudges (Toast, cadence-capped + mutable) on transits / favorable weather / a slipping zone / a fresh target, and an on-demand tip. In-world oracle voice; reads only public tables + your local chart |
| Oracle (chat agent) | `ask_oracle` (per-player cooldown; instant answer from `oracle_cache` on a repeat rules question, else queued) → a `feeder/`-style companion service reads `oracle_request`, asks Claude (tiered Haiku/Sonnet), and returns it via owner-gated `answer_oracle` → `oracle_reply` (caching generic answers for everyone). Only a derived chart/state summary is sent — never birth data. Built end-to-end: `feeder/oracle-service.ts` is the companion service (tiered Haiku/Sonnet, prompt-cached) |

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
