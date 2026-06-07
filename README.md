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
│   ├── SkyRenderer.cs              # P0 AR renderer: stars + Pentacle + tap-to-attack
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

> The crate is a faithful scaffold against the modern SpacetimeDB Rust API; if
> `spacetime build` flags a `find/update/delete` by-value vs `&ref`, adjust and
> rebuild — schema and logic are the substance.

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

### 3 · Run the ephemeris feeder

```bash
cd feeder
bun run push-ephemeris.ts          # loop (default every 15 min)
bun run push-ephemeris.ts --once   # single pass — wire to cron/Railway if you like
```

It computes all ten bodies and calls `push_ephemeris` through the `spacetime`
CLI, so it authenticates as your owner identity (the reducer is owner-gated). No
token plumbing.

## How the pieces map to the GDD

| GDD section | Where it lives |
| --- | --- |
| §02 Natal chart → faction | `unity/ChartCalculator.cs` + server `chart::faction_scores` (top-3 dignity check) |
| §04 Deck generation | `chart::mint_deck` — degree→rank, minute→health, dignity×, court/trump |
| §05 Eleven zones | `unity/PentacleGrid.cs` (geometry) + server `init` (5 houses / 5 spires / 1 crown) |
| §06 Suit triangle | `combat::suit_multiplier` (Wands→Swords→Pentacles, Cups support) |
| §07 Star → zone tug-of-war | `resolve_star_battle` + `apply_control` (signed meter, flip at ±600) |
| §08 AR & ephemeris | `unity/SkyMath.cs` + `SkyRenderer.cs` (P0) · `feeder/` + `push_ephemeris` |
| Bots (always-on war) | `tick_sky` → `bot_raid` for unmanned factions |

## Notes & accuracy

- **The chart is computed client-side** (`ChartCalculator`) and committed once;
  the server stores it immutably and never runs heavy astronomy in the module.
- Ephemeris is **game-grade** (JPL low-precision Keplerian + truncated Sun/Moon
  series) — sub-degree for the Sun/planets, ~a degree for the Moon. Plenty for
  sign/zone placement; swap in SwissEphNet / Swiss Ephemeris for production.
- The Pentacle is **fixed to the local horizon**; stars and planets drift through
  it (their alt/az is recomputed every frame). The feeder's per-planet
  `transiting_zone` is the *global* canonical transit (ecliptic-longitude→zone);
  each player's AR overlay is observer-local.
- **Clients never write state** — they call reducers, which validate and mutate
  transactionally. `natal_chart` is the one private table.
