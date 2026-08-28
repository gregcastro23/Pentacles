# Zone Melee — The Arcana Trick Engine

**Revision 3** · 2026-08-28 · Part I built and tested; Part II half built

**Build status.** Part I (melee engine, dignity, sign-character) and Part II's
module side (schema, reducers, scoring, control, queue gating) and feeder side
(`feeder/war-table.ts` — claims, champions, seating, dealing, N-seat play) are
implemented and under test: 54 Rust tests, the JS engine suite, and a War Table
suite that imports the real functions. **Not yet built:** the multi-seat UI.
**Not published** — the four new tables need a schema publish, and the agents need
re-seeding, before any of it runs against prod.

**Resolved since writing.** §15 Q1 stands (live transit occupancy). The Arcana-lead
rule is settled: **Majors are permitted, never compelled** — an Arcana lead compels
nothing, and a minor is always a legal slough. There is **no PostgreSQL anywhere in
this project**; all state is SpacetimeDB, and the queue is `melee_queue` in
`server/src/tables.rs`.

**Rev 1 → 2:** Major Arcana strength is no longer the arcana numeral. It is **Arcana
Potency**, computed live — planetary Majors from the shared alchm dignity tables,
sign Majors from current sign occupancy × the player's sign-character vector. The
roster grows from 10 Majors to all **22**.

**Rev 2 → 3:** the melee stops being a private 1v1 and becomes **The War Table** — a
persistent, autonomous, 2-to-6-seat contest running in every zone on a 60-second round,
fought by the 71 historical agents, each choosing its target from its own chart. A human
queues and takes their faction's seat at the next deal.

> Part I is the melee — what the cards do. Part II is the war — who plays them, where,
> and when. Part III is the build.

---

# Part I — The Melee

## 1. What the code actually holds

Read out of the repos, not assumed.

### 1.1 The deck Pentacles mints

| Fact | Source |
| :-- | :-- |
| Minor ranks run **1–14** — Ace, 2–10, **Page (11)**, **Knight (12)**, Queen (13), King (14) | [`tables.rs:159`](../server/src/tables.rs), [`client.js:57`](../public/client.js#L57) |
| Majors are `is_major: true` with `rank` = arcana index **0..21**; only **ten** are minted | [`planet_major()` chart.rs:128](../server/src/chart.rs#L128) |
| **Majors carry a suit too** — the planet's `biased_suit` | [`chart.rs:150`](../server/src/chart.rs#L150) |
| Pips 2–10 come from Golden Dawn **decans**; all 36 are reachable | [`chart.rs:100`](../server/src/chart.rs#L100), [`decans.js`](../src/alchm-chart/decans.js) |
| **Ace is reserved for the chart ruler**; courts 11–14 come from dignity | [`chart.rs:118`](../server/src/chart.rs#L118) |
| A fresh player holds **20 cards** — 10 minor + 10 major — **all `loadout: "active"`** | [`client.js:805`](../public/client.js#L805) |
| Zone trump already exists as `SIGN_SUITS[zone_id % 12]` | [`client.js:1115`](../public/client.js#L1115) |
| `state.planets[i]` = `{ body, eclLon, sign, ra, dec, alt, az, x, y, zone, up }` — **live sign and horizon state, but no retrograde** | [`computePlanets()` sky.js:344](../public/sky.js#L344) |

### 1.2 The shared dignity system — ASOL and WTEN

**WTEN is the documented source of truth.** [`dignityScales.ts`](../../../WhatToEatNext-master/src/utils/dignityScales.ts)
defines `DIGNITY_ESMS_SCALE` on the traditional Ptolemy/Lilly points, applied as
`1 + score/100`:

| Dignity | WTEN score | Multiplier |
| :-- | --: | --: |
| Domicile | **+10** | 1.10 |
| Exaltation | +7 | 1.07 |
| Neutral | 0 | 1.00 |
| Detriment | −7 | 0.93 |
| Fall | **−10** | 0.90 |

The rulership / exaltation / fall tables live in
[`getPlanetaryDignityInfo()` astrologyUtils.ts:1238](../../../WhatToEatNext-master/src/utils/astrologyUtils.ts).
The file carries an explicit note that **Domicile outranks Exaltation**, and that the
reverse ordering was a bug it corrected.

**ASOL's table disagrees.** [`planetary_dignity()` constants.rs:140](../../../AlchmAgentsSolana/pa-rust-backend/src/astro/constants.rs)
returns i32 on a ±3 scale and systematically ranks **Exaltation above Domicile** — Sun
`leo 1 / aries 2`, Moon `cancer 1 / taurus 2`, Venus `libra 1 / pisces 2`. That is the
ordering WTEN calls a bug. It is applied as `max(0.5, 1 + 0.15·d)` at
[`alchemy.rs:319`](../../../AlchmAgentsSolana/pa-rust-backend/src/astro/alchemy.rs).

**Pentacles already agrees with WTEN.** [`client.js:363`](../public/client.js#L363) uses
Rulership 5 · Exaltation 3 · Detriment −3 · Fall −5 on a ±5 scale, and
`types.rs:116` documents `dignity: i8` as "−5 fall .. +5 rulership". Its
`draft_power_mult` at [`chart.rs:828`](../server/src/chart.rs#L828) uses
`max(0.25, 1 + 0.15·d)` — ASOL's *coefficient* over WTEN's *ordering*.

> **Decision.** This plan takes the **classification and ordering** from WTEN (shared,
> canonical) and keeps Pentacles' existing ±5 numeric scale, which already conforms.
> ASOL's inverted table is a real divergence but reconciling it is a separate job —
> it touches ESMS output, not this game. Filed, not fixed here.

The one thing genuinely *not* inherited is the gain. WTEN's ±10% and ASOL's ±15% are
**percentage nudges** tuned for ESMS composition; they are far too flat to rank
twenty-two cards. §2.3 states its own gain explicitly rather than pretending otherwise.

### 1.3 Sign character — ASOL's vector calculator

[`CharacterVectorCalculator.calculateSignVectors()`](../../../AlchmAgentsSolana/lib/astrological-character-vectors.ts)
turns placements into a **percentage per sign, summing to 100** — exactly the "sign
character of that player's chart". Weights:

| Body | Weight | Dignity multiplier |
| :-- | --: | --: |
| Sun | 25 | ×1.5 |
| Moon | 20 | ×1.4 |
| Ascendant | 20 | ×1.3 |
| Mercury | 12 | ×1.3 |
| Venus | 10 | ×1.3 |
| Mars | 8 | ×1.3 |
| Jupiter | 3 | ×1.2 |
| Saturn | 2 | ×1.2 |

The multiplier applies only in domicile or exaltation. Uranus, Neptune and Pluto carry
weight 0 — generational bodies do not shape personal character.

### 1.4 The 22-card attribution partitions cleanly

Your table and `planet_major()` **agree on all ten planetary Majors** — no change needed
there. The twelve sign Majors are exactly the complement of the ten planetary arcana
indices: `{4,5,6,7,8,9,11,13,14,15,17,18}`. No overlap, no gap.

**So arcana index alone tells you which family a Major belongs to** — the single fact the
whole potency system hangs on.

| # | Major | Ruler | Family |
| :-- | :-- | :-- | :-- |
| 0 | The Fool | Uranus | planetary |
| I | The Magician | Mercury | planetary |
| II | The High Priestess | Moon | planetary |
| III | The Empress | Venus | planetary |
| IV | The Emperor | Aries | **sign** |
| V | The Hierophant | Taurus | **sign** |
| VI | The Lovers | Gemini | **sign** |
| VII | The Chariot | Cancer | **sign** |
| VIII | Strength | Leo | **sign** |
| IX | The Hermit | Virgo | **sign** |
| X | Wheel of Fortune | Jupiter | planetary |
| XI | Justice | Libra | **sign** |
| XII | The Hanged Man | Neptune | planetary |
| XIII | Death | Scorpio | **sign** |
| XIV | Temperance | Sagittarius | **sign** |
| XV | The Devil | Capricorn | **sign** |
| XVI | The Tower | Mars | planetary |
| XVII | The Star | Aquarius | **sign** |
| XVIII | The Moon | Pisces | **sign** |
| XIX | The Sun | Sun | planetary |
| XX | Judgement | Pluto | planetary |
| XXI | The World | Saturn | planetary |

(Golden Dawn / RWS numbering — VIII Strength, XI Justice — matching the deck's existing
names.)

### 1.5 Three gaps this opens

1. **The twelve sign Majors have no mint path.** `planet_major()` mints one Major per
   placement; nothing mints The Emperor. Fixed in §12.
2. **Major names are indexed by planet, not by arcana.** `MAJOR_NAMES[bodyIdx]` in
   [`createCard()` client.js:826](../public/client.js#L826) and again in
   `synthesizeRewardCardsFromPlayed`. A sign Major would render under its ruler's name.
   Needs an arcana-indexed `ARCANA_NAMES[0..21]`.
3. **No live retrograde.** `computePlanets()` returns no direction of motion, and
   potency needs it. Fixed with a six-line helper in §12.

**No schema migration is required.** `Card.rank` is already a `u8` holding arcana
0..21 and `is_major` already disambiguates — the twelve new Majors fit the shipped table
exactly. That matters, given SpacetimeDB 2.x cannot rename or drop a column.

---

## 2. Rules

### 2.1 The Full Arcana Ladder — 14 minor ranks

Pinochle's inversion — **the 10 outranks the King** — preserved. Page and Knight slot in
below the Queen; pips 9..2 descend beneath.

| Card | stored `rank` | trick power | counter |
| :-- | --: | --: | --: |
| **Ace** | 1 | 14 | **★ 10** |
| **10** | 10 | 13 | **★ 10** |
| **King** | 14 | 12 | **★ 10** |
| Queen | 13 | 11 | 0 |
| Knight *(the Jack)* | 12 | 10 | 0 |
| Page | 11 | 9 | 0 |
| 9 · 8 · 7 · 6 · 5 · 4 · 3 · 2 | 9..2 | 8..1 | 0 |

Restricted to the six Pinochle ranks the order is **identical**, so the five-rule filter
is untouched.

### 2.2 Majors are the universal suitless trump (Atouts)

Majors are true suitless Atouts (Trumps); `biased_suit` remains metadata for visual styling and Alchemical ESMS yield.

- **Any Major beats any Minor**, whatever the suits.
- **Majors are legal only when void in the led Minor suit (or when a Major is led)**, killing the degenerate trick-1 World steal while adhering to canonical trick-taking.
- **Majors are never compelled, only permitted.** When void in the led Minor suit, a player holding a Zone Trump minor must trump, but may freely choose to play any Major instead; a player void in both led suit and trump minors may freely slough an off-suit minor without burning a Major.
- **Standard Majors are worth 0 counters.** The three **Honours** — The Fool (0), The Magician (I), The World (XXI) — are worth **10** each.
- **The Excuse:** The Fool is legal at any time (overriding all filter rules), never wins, is never captured, and banks its 10 into your own pile.

Potency changes exactly one thing: **how two Majors resolve against each other.**

### 2.3 Arcana Potency — the live ladder

Both families produce a score on the same **0–100** scale, so any two Majors compare
directly. **Ties break on the higher arcana index**, so the old rule survives as the
tiebreaker and resolution is always total.

#### Planetary Majors — the sky's own strength

```
potency = clamp(1, 100,
            50
          +  5 × dignity        // ±5, WTEN ordering, planet in its CURRENT transit sign
          +  5 × reception      // 0 · +0.5 received · +1.5 mutual
          −  8 × retrograde     // 0 or 1
          +  3 × aboveHorizon   // 0 or 1
          )
```

- `dignity` — Domicile +5 · Exaltation +3 · Neutral 0 · Detriment −3 · Fall −5, from the
  shared WTEN tables against `state.planets[i].sign`. **Live, not natal:** the Tower is
  strong while Mars transits Aries and weak while it drags through Cancer.
- `reception` — the existing [`calculateReceptionBoosts()`](../public/client.js#L397),
  fed the live planet array instead of the natal chart.
- `retrograde` — a reversed planet is a reversed card.
- `aboveHorizon` — `planets[i].up`. A planet under the world pushes less.

Practical range **17 … 86**.

#### Sign Majors — the sky met by the self

```
occupancy = number of the ten transiting bodies currently in that sign   (0..10)
character = the player's SignCharacterVector[sign]                       (0..100 %)

potency = clamp(1, 100, 20 + 9 × occupancy + 0.35 × character)
```

Practical range **20 … 80**. A four-body Aries stellium puts The Emperor near 56 before
character; an Aries-heavy native pushes it past 68.

> **The design statement.** Planetary Majors read the world alone. Sign Majors read the
> world **through** the player — the same Emperor is a different card in two people's
> hands. That asymmetry is the point, and the UI should say so out loud.

#### Snapshot, don't recompute

The ladder is computed **once, in `createMelee()`**, and frozen into melee state as
`arcanaLadder[arcanaIndex] = potency`. Card power must not shift between trick 3 and
trick 4 because a planet crossed a cusp. It also makes the engine testable: inject a
fixed ladder and every assertion is deterministic.

**Interpretation flagged:** "placements currently in that sign" is read as **live transit
occupancy**, which keeps it non-redundant with the natal character term. If you meant the
player's own natal placements, say so — it's a one-line change and the rest holds.

### 2.4 Melds

Declared from hand before trick 1, scoring into the counter pot.

| Meld | Composition | Value |
| :-- | :-- | --: |
| **Marriage** | King + Queen of a suit | 20 · **40 in trump** |
| **Pinochle** | Queen of Swords + Knight of Pentacles | 40 |
| **Decan Trine** | the three decan pips of one sign | 40 |
| **Full Court** | Page + Knight + Queen + King of one suit | 60 |
| **Arcana Trine** | any three Majors | 50 |
| **Grand Cross** | the Ace of all four suits | 100 |
| **The Great Work** | Fool + Magician + World | 100 |
| **Dignified Trine** *(new)* | three Majors each at potency ≥ 60 | 75 |

**Pinochle translates exactly:** `SUIT_GLYPHS` at [client.js:19](../public/client.js#L19)
already maps swords → ♠ and pentacles → ♦, so the classic Q♠ + J♦ *is* Queen of Swords
+ Knight of Pentacles. **Decan Trine reuses `decans.js` verbatim** and is only formable
from pips 2–10 — the meld that makes the middle of the deck matter.

**Dignified Trine** is new in rev 2: it can only be held when the sky is currently
favouring three of your Majors, so it comes and goes with the transits.

### 2.5 The legality filter

When a Minor suit is led:
1. **Must Follow Suit** — hold the led Minor suit → must play a Minor of that suit. (Majors are not legal).
2. **Must Win** — following suit → beat the high card if a Minor can.
3. **Must Trump** — void in led Minor suit → must play a Zone Trump minor if held, OR play any Major.
4. **Must Over-Trump** — beat the highest trump if a Minor can; a higher-potency Major always may.
5. **Sloughing** — void in led Minor suit and void in Zone Trump minors → may freely discard any Minor (even if holding Majors, as Majors are never compelled).

When a Major is led (Arcana Lead):
- Players holding Majors must follow with a Major (and over-trump with higher potency if possible).
- Players void in Majors may slough any Minor.

The Excuse (*The Fool*, 0):
- Overrides all rules 1–5, always legal at any time, never wins, never captured, banks 10 counters.

### 2.6 Resolution

**Score** = counters captured + melds declared + **10 for the final trick**. The gate
breaks on the **margin**, not a threshold: beat the Guardian's score plus its handicap.

| Zone | Guardian handicap |
| :-- | --: |
| House — 0–4 | +0 |
| Spire — 5–9 | +20 |
| Crown — 10 | +40 |
| Planetary Alignment | +10 × planet index |

**Ties hold the gate.** Reward *size* is still alchemy: feed the captured pile to
`AlchemicalEngine.resolveReaction()` and let `pentaclesYield` scale tokens, control delta
and spoils — keeping the Pillars/ESMS/Kalchm telemetry meaningful and
`synthesizeRewardCardsFromPlayed(playedCards, targetZoneId, pentaclesYield)` unchanged.

Two currencies: **counters decide who wins, alchemical yield decides how much.**

---

## 3. The deal

**Twelve cards a side, twelve tricks**, dealt by a deterministic shuffle seeded on
`(zone_id, sky-tick)`.

**Player hand** — from the Active loadout: up to **9 minors + at most 3 Majors**. Below
twelve active cards, deal `N = min(12, activeCount)` to both sides and play N tricks;
fewer than six blocks the challenge.

With sign Majors minted, a typical collection grows from 20 cards to **25–28** (10 minors
+ 10 planetary Majors + 5–8 sign Majors for the signs the chart occupies). The 3-Major
cap keeps the melee from drowning in Arcana.

**Guardian hand** — minted from the zone itself: the zone's sign gives its three decan
pips, its ruler the Ace or court, its planet the Major, through the existing
[`agentDeck()`](../src/alchm-chart/deck.js) path. **The Guardian plays the zone's own
cards** — Zone 1, Taurus, opens on 5·6·7 of Pentacles, and holds **The Hierophant**, its
own sign Major, whose potency rises as bodies transit Taurus.

> **Emergent, and deliberate.** Trump is the zone's element and your minors' suits come
> from your chart, so a Fire-heavy chart walks into an Earth zone void in trump. Your
> chart decides which zones are hard; Majors are the counterweight — and now *which*
> Majors are strong depends on tonight's sky. Surface both in the UI.

---

---

# Part II — The War

The melee above is the contest. This part is who fights it, where they choose to fight,
and on what clock. **Everything here is new in rev 3.**

## 4. What already exists

Two things you asked for are **already true in the code** and need no work.

| Already true | Where |
| :-- | :-- |
| **Agents already belong to their best faction.** `topFaction()` picks the *highest*-scoring body from a mirror of `chart::faction_scores`; the reducer's top-3 gate then accepts it. | [`seed-agents.ts:117`](../scripts/seed-agents.ts#L117), [`register_chart` reducers.rs:258](../server/src/reducers.rs#L258) |
| **An autonomous war loop already runs**, every 10s inside `tick_sky`: each faction pushes control in the zone its planet transits and raids a star through Auto-Siege. | [`agent_war()` reducers.rs:2823](../server/src/reducers.rs#L2823) |

And a strategic ladder is already enforced: [`can_access_zone()`](../server/src/reducers.rs#L2506)
gates **Spires behind owning an adjacent House**, and the **Crown behind owning ≥2 Spires**.
That is what makes a war *progress* rather than thrash, and rev 3 builds directly on it.

**The gap.** Agents currently reach `agent_war` only as a per-faction **headcount and summed
deck power**. No agent picks a target, and no agent plays a card. Rev 3 is exactly that gap.

## 5. Roster reality — measured, not assumed

Computed by running `bun run scripts/seed-agents.ts --dry` over all 71 figures.

| Saturn | Mercury | Venus | Uranus | Sun | Moon | Mars | Pluto | Jupiter | Neptune |
| --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| **15** | 10 | 9 | 8 | 8 | 6 | 5 | 4 | 4 | **2** |

Two facts fall straight out of this, and both change the design:

1. **Every faction is represented** — no empty side, so all ten can contest from round one.
2. **The spread is 15 : 2.** Saturn can seat all eleven zones with four in reserve; Neptune
   has two agents in the world. **Any rotation rule that benches agents must be
   roster-relative**, or Neptune disappears from the war whenever it rests. §7 handles it.

That Saturn leads is a feature, not a flaw — the Greater Malefic, lord of boundaries, opening
as the dominant power is exactly right.

**43 of the 71 charts are time-unknown solar charts** with the Ascendant a 0° Aries
placeholder. `faction_scores` already suppresses the chart-ruler ×3 and the angular bonus for
these. **The sign-character port must do the same** — ASOL's calculator weights the Ascendant
at 20, and applying that to a placeholder would give three-fifths of the roster a phantom
Aries affinity. This is a majority of agents, not an edge case.

## 6. The War Table — 2 to 6 seats

**One seat per faction**, filled by that faction's champion for this zone. Seats are the
factions mustering there this round: minimum 2, capped at the **six highest claims**.

- **Fewer than two factions muster** → the **Zone Guardian** takes a seat, playing the zone's
  own decan deck (§3). The Guardian is now the neutral defender rather than the sole
  opponent — a lone human always has someone across the table.
- **Hand size stays 12 regardless of seat count.** A trick is N cards, the melee is always
  12 tricks, and a human's experience is identical at two seats or six.
- **Duplicate cards are canonical.** Each seat draws from its own collection, so two agents
  can both hold the King of Wands. Real Pinochle's 48-card deck has duplicates too, and the
  rule is already written: **first played wins**.
- **Seat order** is the ascending ecliptic longitude of each faction's planet at deal time —
  deterministic, astrological, and it rotates as the sky turns.
- **First lead** goes to the zone's current owner if seated, otherwise the highest claim.
  Thereafter the trick winner leads, as always.

### The engine needs no structural change

`getLegalMoves(hand, ledSuit, trumpSuit, currentTrick, ladder)` and
`evaluateTrick(currentTrick, trumpSuit, ladder)` already take `currentTrick` as an **array**.
Must-win, must-over-trump and trick resolution all scan it. They generalise from 2 seats to 6
with **no signature change** — only `createMelee` grows a seat manifest. The rev-2 design pays
for itself here.

### Scoring and what it does to the zone

Each seat scores its own counters + melds + the final-trick 10. With N seats the pot scales
with N, so the control delta is normalised to a **zero-sum share around the mean**:

```
share_i = score_i / Σ score
delta_i = round(ZONE_SWING × (share_i − 1/N))     // average performance moves nothing
winner  += ZONE_SWING × 0.25
```

Total swing per zone per round is therefore bounded no matter how many seats are filled. At
`ZONE_SWING ≈ 120` against the existing 0–1000 control meter, a zone flips after roughly five
to ten minutes of sustained dominance — a war you can watch turn without it thrashing.
`apply_control()` then applies flux ×2.5 and the AR multiplier as it already does.

> **Don't double-count.** For any zone that ran a table this round, **skip `agent_war`'s blind
> per-faction push** — the melee replaced it. Keep the star-raid half untouched; it is a
> different mechanic on different objects.

## 7. Zone Claim — how an agent chooses where to fight

Every muster, each agent scores all eleven zones and goes to its best legal one. Zone *n* has
sign `n % 12`, so a zone has a sign, an element and a trump suit — everything a chart can be
compared against.

```
access = can_access_zone(faction, zone)              // hard gate: 0 or 1

claim  = access × clamp(0, 100,
           35 × signAffinity      // agent's signVector[zoneSign] / 100, Asc suppressed on solar charts
         +  4 × dignity(factionPlanet, zoneSign)     // ±5 → ±20
         + 20 × trumpDepth        // share of the agent's Active minors in the zone's suit
         + 15 × opportunity       // 0..1, see below
         −  8 × rest )            // 0 or 1
```

- **signAffinity** — the agent's own sign-character vector from `sign-character.js`. A chart
  that is 34% Aries has a real claim on Zone 0. *This is the module rev 2 introduced for
  Arcana Potency, now doing double duty.*
- **dignity** — the faction planet's essential dignity in the zone's sign, from `dignity.js`.
  Mars-faction champions are strong in Aries and Scorpio, weak in Cancer. *Also rev 2's module.*
- **trumpDepth** — can this agent actually field trump here? Ties target selection directly to
  the melee it is about to play, rather than being decorative astrology.
- **opportunity** — `+0.4` zone in flux · `+0.3` control below 200 · `+0.3` held by a rival.
- **access** — the hard gate. Houses are always reachable; a Spire needs an adjacent House; the
  Crown needs two Spires. **This is what gives the war a shape**: factions must build outward
  from Houses, and the Crown is a late-game prize nobody can rush.

### Champions, and one seat each

Per faction per zone, the highest claim takes the seat; an agent holds **at most one seat per
round**. Assignment is a greedy sweep over all `(agent, zone)` claims in descending order —
deterministic, and it naturally sends the strongest claims to the most contested zones first.

**Rest, roster-relative.** An agent that was seated last round rests one round, so the roster
visibly cycles rather than the same eleven playing forever. **Rest is waived when a faction has
fewer agents than zones it can legally reach** — so Saturn's fifteen rotate and Neptune's two
play every single round. Thin factions are worn but ever-present; deep ones are fresh but
diluted. The 15 : 2 spread stops being a balance problem and becomes flavour.

**A human never costs an agent its rest.** When a queued human takes a faction's seat, the
champion yields — benched, not beaten — and keeps its claim for the next muster.

## 8. The round loop

A 60-second round, everywhere, continuously.

| Phase | Window | What happens |
| :-- | :-- | :-- |
| **Muster** | 0–10s | Claims computed, champions chosen, the seat manifest published. **The human queue opens.** |
| **Seating** | 10–15s | Queued humans claim their faction's seat; the agent champion yields. Seats lock at the deal. |
| **Deal** | 15s | Hands dealt from each seat's Active loadout — 12 cards, ≤3 Majors. **Arcana Ladder frozen.** Melds declared. |
| **Play** | 15–55s | Twelve tricks of N cards. Agents play instantly. |
| **Resolve** | 55–60s | Scores, control deltas, spoils, results written. The next muster begins immediately. |

**A table with a human seat runs a 120-second round** — Play extends to 115s and that zone
resolves a beat later. Twelve tricks in 40s is ~3.3s each, fine for an agent and hostile to a
person; agent-only tables keep the 60s cadence, so the world never waits on an empty seat.

**Human turn timer.** Roughly 8s a trick, then auto-play. `getLegalMoves` already returns the
legal set with reasons, so the timeout picks a legal card by definition — a human can be idle
or disconnected and the melee still completes correctly.

**Queueing.** `join_melee_queue(zone_id)` seats you for your Player's faction. If your faction
cannot legally reach that zone, the queue **rejects with the reason** — which is the right way
to teach `can_access_zone` to a player: you are told you must take a House before you can
reach that Spire.

## 9. Where it runs, and what that costs

The loop runs in the **feeder daemon** — extending
[`feeder/historical-agent-service.ts`](../feeder/historical-agent-service.ts), already deployed
on Railway under the `pentacles-feeders` supervisor, already subscribed to `zone`,
`agent_chart` and `ephemeris`, and already calling reducers through the owner Bearer token.
The trick engine stays in JS and is the *same file* the browser runs, so there is exactly one
implementation of the rules.

### Schema — additive only

SpacetimeDB 2.x cannot rename or drop a column, but **adding tables is a compatible update**.
Nothing below touches an existing column.

| Table | Holds |
| :-- | :-- |
| `melee_table` | `table_id`, `zone_id`, `round_index`, `trump_suit`, `state`, `seat_count`, `opened_at`, `deal_at`, `resolve_at` |
| `melee_seat` | `seat_id`, `table_id` (indexed), `faction`, `occupant`, `is_human`, `claim`, `counters`, `melds_value`, `score` |
| `melee_queue` | `identity` (PK), `zone_id`, `faction`, `queued_at` |
| `agent_rest` | `identity` (PK), `rested_at_round` |

| Reducer | Gate |
| :-- | :-- |
| `open_melee_round(round_index, manifest)` | owner-gated — the feeder |
| `submit_melee_result(table_id, seat_scores)` | owner-gated — the feeder |
| `join_melee_queue(zone_id)` · `leave_melee_queue()` | player-callable |
| `play_melee_card(table_id, card_id)` | player-callable |

Owner-gating follows the established `answer_oracle` trusted-bridge pattern already in
`reducers.rs`.

### The trust boundary — stated plainly

**The feeder is the referee. The client is not trusted; the feeder is.** A human's
`play_melee_card` is recorded on chain, but it is the feeder that validates it against
`getLegalMoves` and computes the result the module records.

The honest consequence: **a compromised feeder could fabricate melee results.** Zone control is
in-game state, not a token balance, so the blast radius is bounded — but it is a real
limitation, not an oversight. The path off it, when it matters, is porting `getLegalMoves` and
`evaluateTrick` to Rust and validating each play in the reducer. That is a second
implementation to keep in sync, which is exactly why it is not v1.

**If the feeder dies**, the war stops advancing and zones simply hold. `agent_war`'s 10s tick
keeps running independently, so the world does not freeze — it falls back to the coarse
per-faction push it does today. That is a good failure mode and worth keeping deliberately.

## 10. One coupling rev 2 created

Rev 2 mints the twelve sign Majors **client-side** in `mintFromChart()`. Agents' cards live in
the on-chain `card` table, minted by [`mint_deck` in chart.rs](../server/src/chart.rs#L213) —
so as written, **agents would hold only the ten planetary Majors while humans hold up to
twenty-two**. The Emperor would never appear in an agent's hand.

`mint_deck` therefore needs the same sign-Major pass: for each distinct sign a placement
occupies, mint that sign's Major once — `rank` = arcana index, `source_body` = the sign's
ruler, `suit` = the sign's element, `is_major: true`. Still no schema change; `Card.rank` is
already a `u8` over 0..21. Agents re-mint by re-running `seed-agents.ts`, which is idempotent
by design.

## 11. A fourth dignity table

While measuring the roster: [`seed-agents.ts:52`](../scripts/seed-agents.ts#L52) carries **its
own** `dignityScore()` — exaltation **+4**, fall **−4**, and `EXALT_SIGN` **null for Uranus,
Neptune and Pluto**, which WTEN does give exaltations. That makes four diverging
implementations across the family: WTEN's canonical ±10/±7, ASOL's inverted ±3, the Pentacles
client's ±5, and this one.

Every agent's stored `dignity` — and therefore every faction assignment — was computed from
this fourth table. Consolidating onto `dignity.js` (Part III) means **re-seeding the agents**,
and a handful may change faction. That is correct rather than alarming, but it should be a
deliberate step with the before/after diff printed, not a silent side effect of a refactor.


---

# Part III — Building it

## 12. File by file

### [NEW] `src/alchm-chart/dignity.js`

The one dignity function, ending the current three-way duplication between
[`client.js:363`](../public/client.js#L363), [`sky_dignity()` chart.rs:332](../server/src/chart.rs#L332)
and ASOL. DOM-free ES module beside `decans.js` and `math.js`.

- `RULERSHIPS`, `EXALTATIONS`, `FALLS`, `DETRIMENTS` — ported from WTEN's
  `getPlanetaryDignityInfo`, verbatim.
- `dignityType(body, sign)` → `"Domicile" | "Exaltation" | "Neutral" | "Detriment" | "Fall"`
- `dignityScore(body, sign)` → ±5 on Pentacles' scale
- `esmsScale(body, sign)` → WTEN's ±10/±7, for anything crossing into ESMS

### [NEW] `src/alchm-chart/sign-character.js`

Port of ASOL's `CharacterVectorCalculator`, trimmed to the vector itself — the
interaction-style half is not needed here.

- `PLANETARY_WEIGHTS` — the table in §1.3, verbatim
- `signVector(placements, ascSign)` → `Float64Array(12)`, percentages summing to 100
- `dominantSigns(vector, n)` · `elementalDistribution(vector)`

Reusable by My Pentacles and faction war, which currently have no character read.

### [MODIFY] `public/sky.js`

Add `isRetrograde(body, jd)` — compare `geocentricEclipticLon(body, jd)` against
`geocentricEclipticLon(body, jd - 1)`, handling the 0°/360° wrap. Set `retrograde` on
each record from `computePlanets()`. Six lines, and it lights up the `inverted` field the
card model has always carried.

### [NEW] `public/arcanaTrickEngine.js`

**Classic IIFE, not an ES module** — `client.js` and `app.js` are classic scripts, so an
`export` is a runtime error. Same `(function(global){…})(typeof window !== 'undefined' ? window : global)`
shape as `alchemicalPillars.js`, added to `index.html` **before** `client.js` at line 463.
A node test can then `await import()` it for the side effect and read
`globalThis.ArcanaTrickEngine`.

- `ARCANA_NAMES[0..21]`, `ARCANA_NUMERALS[0..21]`, `ARCANA_FAMILY[0..21]`,
  `ARCANA_RULER[0..21]` — the §1.4 table as data
- `TRICK_POWER`, `COUNTER_VALUE`, `MAJOR_HONOURS`, `EXCUSE_ARCANA = 0`
- `buildArcanaLadder(planets, signVector)` → `{ [arcana]: potency }`, the §2.3 formulas
- `power(card, trumpSuit, ladder)` · `counterValue(card)`
- `getLegalMoves(hand, ledSuit, trumpSuit, currentTrick, ladder)` → `[{ card, legal, reason }]`
  for **every** card, so the UI can dim illegals *and say why*
- `evaluateTrick(currentTrick, trumpSuit, ladder)` — winner, captured pile, counters, Excuse
- `detectMelds(hand, trumpSuit, ladder)` — the eight melds
- `GuardianAI.choose(hand, trickState, ladder)` — leads high trump, side Aces and low
  probes; **spends its weakest sufficient Major** rather than its highest; holds Majors
  for counter-rich tricks; sloughs junk
- `createMelee(targetType, targetId, playerHand, zoneData, sky)` → melee state with the
  ladder frozen in

### [MODIFY] `public/client.js`

- **`ARCANA_NAMES` / `ARCANA_NUMERALS` indexed by arcana**, replacing the planet-indexed
  `MAJOR_NAMES` for title derivation. `createCard()` must title a Major as
  `ARCANA_NAMES[rank]`, not `MAJOR_NAMES[bodyIdx]` — otherwise every sign Major renders
  under its ruler's name. Keep `MAJOR_NAMES` exported for existing callers.
- **`mintFromChart()` mints sign Majors**: for each distinct sign occupied by a placement,
  mint the sign's Major once — `rank` = its arcana index, `source_body` = the sign's ruler,
  `suit` = `SIGN_SUITS[sign]`, `is_major: true`. No schema change.
- `generateProceduralRitual()` — emit `type: 'melee'` with the melee state and its frozen
  `arcanaLadder`.
- **`isObsoleteRitual()` must retire `type === 'manifold'`** and any ritual lacking
  `melee`. This is the existing localStorage hatch at
  [client.js:1107](../public/client.js#L1107); without it, returning players resurrect the
  four-slot vessel.
- New `playCardIntoMelee(cardId, targetType, targetId)` — validate via `getLegalMoves()`,
  play, run the Guardian, resolve, advance, settle on trick N. Alias `playCardIntoRitual`
  to it.
- **Cards are not consumed.** See §15.

### [MODIFY] `public/app.js`

- Rework `updateActiveRitualPanel()` into the Trick Stage: zone name, Guardian title,
  trump badge, `TRICK n / 12`, live scoreboard, meld strip.
- Keep the **Singularity WebGL core** where it is —
  [`initSingularityShaderCanvas` app.js:2532](../public/app.js#L2532) — Guardian slot
  above, player slot below, led-suit badge and pot beside it.
- **The Arcana Ladder panel** — this is the new UI surface rev 2 requires. List the
  Majors in your hand by potency with the *reason* attached: `THE TOWER · 71 · Mars
  domicile in Aries` · `THE EMPEROR · 56 · 4 bodies in Aries, your 34% sign`. Without it
  the ranking is invisible and the mechanic is noise.
- Action banner spells the binding rule: `YOUR TURN — MUST FOLLOW SWORDS (BEAT 10)`.
- Hand renders rank name, arcana numeral, potency, and the **★ 10** counter badge; gold
  glow on legal, dimmed with the `reason` string on illegal.

### [MODIFY] `public/client.css`

`.melee-arena`, `.trick-card-slot`, `.arcana-card`, `.arcana-card.legal` / `.illegal`,
`.arcana-card.major`, `.potency-meter`, `.arcana-ladder`, `.trump-badge`,
`.pot-counter-badge`, `.meld-chip`, `.climax-banner`, `.trick-winner-glow`.

### [MODIFY] `index.html` · `package.json`

Script tag before `client.js`; `"test:melee"` and a `"test:all"` chaining the three
node suites.

---

### [MODIFY] `feeder/historical-agent-service.ts`  ·  the war loop

The daemon already runs on Railway under `pentacles-feeders`, already subscribes to `zone`,
`agent_chart` and `ephemeris`, and already calls reducers with the owner token. It grows the
round loop beside its existing flux sweep.

- `computeClaims(agents, zones, sky)` → the §7 formula for every `(agent, zone)` pair
- `chooseChampions(claims, rest)` → greedy descending sweep; one seat per agent, one seat per
  faction per zone, `can_access_zone` as a hard gate
- `runRound(roundIndex)` → `open_melee_round` · wait out Seating · deal · play · resolve ·
  `submit_melee_result`
- `refereePlay(tableId, identity, cardId)` → validate against `getLegalMoves`, or auto-play on
  the turn timer
- Reuse `arcanaTrickEngine.js` **unchanged** — the browser and the daemon run the same file, so
  the rules cannot drift

### [MODIFY] `server/src/tables.rs` · `server/src/reducers.rs`

The four additive tables and five reducers in §9. Also:

- **`mint_deck` gains the sign-Major pass** (§10) so agents hold all 22 Majors, not 10.
- **`agent_war` skips its blind per-faction push** for any zone that ran a table this round;
  the star raid is untouched.

### [MODIFY] `src/alchm-chart/war-model.js` · `faction-war.js` · [NEW] `melee-table.js`

`war-model.js` already builds zones, standings, rosters and a diffed event ticker, and
`faction-war.js` already renders Sky Board / Standings / Detail / Ticker. Extend rather than
replace:

- `buildTables(meleeTableRows, meleeSeatRows)` → per-zone seat manifest with claims
- `roundClock(table, now)` → phase and seconds remaining, for the Muster / Seating / Play beat
- Zone Detail gains the live seat list, each seat's claim and score, and a trick feed
- **Join Queue** button per zone; a faction that cannot reach the zone shows the reason from
  `can_access_zone` rather than a dead control
- `melee-table.js` renders the table itself — the Trick Stage of §12, now with N seats around
  the Singularity core instead of one opposite

### [MODIFY] `scripts/seed-agents.ts`

Drop its private `dignityScore()` (§11) and import `dignity.js`, so the fourth table stops
existing. **Re-seeding is required** after this — print a before/after faction diff so any
figure that changes side is a deliberate, visible outcome.

## 13. Integration hazards

1. **The live-net interception.** `window.playCardIntoRitual` at
   [app.js:2429](../public/app.js#L2429) short-circuits `targetType === "zone"` to
   `deployCardLive()` whenever the net is live — the ritual engine is never reached. The
   melee must be entered through the overlay (`showRitualOverlay` → `playCardIntoMelee`),
   leaving the map-drag deploy path alone, or the shipped faction-war deploy breaks.
2. **`card-synthesis.test.mjs` regex-asserts three exact shapes** — `mintSlot`'s active
   loadout, the `synthesizeRewardCardsFromPlayed(playedCards, targetZoneId, pentaclesYield)`
   signature, and the reward `deck.push` line. All must survive verbatim.
3. **`gameplay-contract.test.mjs` asserts the body of `renderActiveHand()`** — the
   `.filter(d => d.loadout === "active")` chain — plus five handler names and the
   `ondragover`/`ondrop` attributes on `#ritual-hud-overlay`. Extend around it.
4. **Duplicate definitions.** `allowRitualDrop` and `handleRitualDrop` are each defined
   *and* assigned to `window` twice in `app.js` — near 905/911 and again at 2925. Don't
   add a third.
5. **Potency must never be read from live state mid-melee.** Every call site takes the
   frozen `ladder` argument. A single `state.planets` read inside `evaluateTrick` would
   make a melee non-reproducible and quietly break the seeded tests.

---
6. **The feeder is the referee, and it is trusted.** `play_melee_card` is recorded on chain but
   validated off it. A compromised feeder can fabricate results; the blast radius is zone
   control, not token balances. Do not describe this as validated play in the UI.
7. **Don't double-count zone control.** `agent_war` pushes every faction every 10s. If a melee
   also pushes the same zone in the same window, control inflates and zones flip in seconds.
   Gate the blind push on "no table ran here this round."
8. **`RoundState` / `RoundTimer` already exist and mean something else** — the per-player
   Ascendant clock that paces deck re-drafts. `DuelRound` / `RoundParticipant` are a *third*
   round concept for word-duel yield. The war round must not be called `Round`; `melee_table`
   carries its own `round_index`.
9. **Solar charts.** 43 of 71 agents have a placeholder Ascendant. The sign-character port must
   suppress the Ascendant's weight-20 term for them, exactly as `faction_scores` already does,
   or three-fifths of the roster gains a phantom Aries claim.
10. **Re-seeding changes factions.** Consolidating the fourth dignity table (§11) alters stored
    dignities, so some agents change side. Correct, but make it an explicit step with a printed
    diff — never a silent side effect.

## 14. Tests

### [NEW] `scripts/arcana-trick-engine.test.mjs`

Repo convention is `scripts/*.test.mjs` under node; `tests/` is `bun test` for TypeScript.

- **Ladder** — all fourteen minor ranks ordered; 10 > King; Page < Knight < Queen.
- **Superset guarantee** — restricted to `A/10/K/Q/Knight/9`, the order equals the
  original Pinochle spec exactly.
- **Counters** — 10 for A/10/K; 0 for the other eleven ranks; 0 for standard Majors;
  10 for each Honour.
- **Filter** — must-follow, must-win, must-trump, must-over-trump, slough-only-when-void.
- **Majors** — beat any minor; never compelled except as the only card of the led suit.
- **Excuse** — always legal, never wins, never captured, banks its 10.
- **Melds** — all eight; trump Marriage 40 vs plain 20; Decan Trine agrees with
  `decans.js` for all twelve signs.
- **Trick & climax** — trump beats non-trump, highest led suit wins, first-played breaks
  ties, final trick +10.
- **Full melee** — player vs `GuardianAI` to completion; every play legal, all tricks
  resolved, counters conserved (captured + Excuse = dealt), a winner declared.
- **Real-hand smoke** — deal from a chart-minted collection and assert at least one legal
  move at every turn, including a chart void in trump.

**Potency, new in rev 2:**

- **Dignity table parity** — `dignity.js` agrees with WTEN's `getPlanetaryDignityInfo`
  for all 10 × 12 planet/sign pairs, and **Domicile scores above Exaltation** in every
  case. This is the test that pins the ASOL divergence so it can't drift back in.
- **Both families land in 1..100** across every reachable input.
- **Monotonicity** — potency rises with dignity, with reception, with occupancy and with
  character; falls with retrograde and below the horizon.
- **Determinism** — the same `(planets, signVector)` always yields the same ladder.
- **Ties break on arcana index**, and resolution is total: no two Majors ever compare equal.
- **Snapshot integrity** — mutating `state.planets` mid-melee does not change any card's
  power.
- **Sign-character parity** — `signVector()` sums to 100 and matches ASOL's calculator on
  a shared fixture.
- **Family partition** — the ten planetary and twelve sign arcana indices are disjoint
  and cover 0..21.

### [MODIFY] `scripts/gameplay-contract.test.mjs`

Add the melee overlay contract; leave the existing five assertions intact.

---

### [NEW] `scripts/war-table.test.mjs`

- **Seats** — a table forms with 2..6 seats; a 7th faction is dropped by lowest claim; fewer
  than two factions seats the Zone Guardian.
- **Engine generalisation** — `getLegalMoves` and `evaluateTrick` give identical results at 2,
  3, 4, 5 and 6 seats for the same led suit and trump; the filter binds the same way.
- **Duplicates** — two seats holding the same card resolve by **first played**.
- **Twelve tricks at every seat count**, every play legal, counters conserved.
- **Control is zero-sum** — Σ delta over a table is the winner bonus alone, at every N. A seat
  scoring exactly the mean moves the zone by zero.
- **Claim** — rises with sign affinity, dignity, trump depth and opportunity; **zero when
  `can_access_zone` is false**, at any other score.
- **Access ladder** — a faction holding no House cannot claim a Spire; holding one adjacent
  House it can; the Crown needs two Spires.
- **Champions** — one seat per agent per round; one seat per faction per zone; deterministic
  for a fixed claim set.
- **Rest is roster-relative** — with the measured 15 : 2 spread, Saturn's champions rotate
  across rounds while **both Neptune agents are seated every round**.
- **Solar charts** — an agent with `time_known: false` gets no Ascendant contribution to its
  sign vector, and its Aries claim is not inflated.
- **Queue** — joining seats the human at the next deal and yields the agent champion without
  charging it rest; a faction that cannot reach the zone is rejected **with the reason**.
- **Turn timer** — a seat that never plays completes the melee legally by auto-play.
- **Roster fixture** — all ten factions are represented across the 71 agents, so no side is
  ever unfillable.

## 15. Open questions

1. **"Placements currently in that sign"** — read as **live transit occupancy** (§2.3), so
   it doesn't duplicate the natal character term. Confirm, or say if you meant natal.
2. **Card stakes.** Non-destructive — cards return, spoils are new. Or Guardian-captured
   cards lost *on defeat only*. Or lost whenever captured. **Recommend non-destructive
   for v1**: twelve cards a melee against a 25-card collection is brutal.
3. **Should a debilitated Major fall below the minors?** Currently no — Majors trump
   universally and potency only orders them against each other, which is what your §1
   rule 1 says. Letting a potency-under-25 Major be beaten by an Ace would be dramatic and
   would make the sky genuinely dangerous. **Recommend not in v1**; it is a one-line change
   later.
4. **Two-phase play.** True Pinochle plays loose while a stock remains. **Recommend
   staying with one phase.**
5. **Do agents keep their spoils?** A melee win synthesises cards. If agents bank them, the
   71 decks drift apart over weeks — some agents become genuinely formidable, which is good
   drama and unbounded growth. **Recommend a cap** (say 40 cards, weakest dropped) so the war
   stays legible and a human is never facing a 300-card agent.
6. **Re-seed timing.** Consolidating the fourth dignity table (§11) will move some agents
   between factions. **Recommend doing it before the war ships**, so the roster settles once
   rather than shifting under a live war.

---

## 16. Verification

```
node scripts/arcana-trick-engine.test.mjs
node scripts/gameplay-contract.test.mjs
node scripts/card-synthesis.test.mjs
```

**Manual** — `bun --bun run dev` (check the port first), then challenge a Zone Gate:

- Trump badge matches `SIGN_SUITS[zone_id % 12]`; the Singularity core still renders.
- All 22 Majors are reachable: the ten planetary ones plus a sign Major for each sign the
  chart occupies, each titled from `ARCANA_NAMES`, **not** its ruler's name.
- The Arcana Ladder panel shows each Major's potency **and its reason**; a retrograde
  planet visibly drops its Major.
- Two Majors in one trick resolve by potency, not numeral — verify with a case where the
  lower numeral has the higher potency.
- Reload mid-melee: the frozen ladder survives, and a saved `manifold` ritual is retired
  by `isObsoleteRitual` rather than resurrected.
- Melds detected before trick 1; a trump Marriage reads 40, a plain one 20; Dignified
  Trine appears only when the sky supports it.
- Illegal cards dim **with a reason**; a Major is offered but never forced; The Fool banks
  10 without taking the trick.
- Trick 12 pays +10; the margin breaks the gate; a tie holds it.
- With the net live, dragging a card onto a zone on the map still runs the **deploy** path.
