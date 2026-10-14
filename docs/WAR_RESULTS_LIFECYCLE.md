# War results — what is kept, for how long, and how to ship it

The War Table used to keep every row it ever wrote (≈160 per six-seat table,
up to 11 tables a minute) and never recorded who won. The feeder's
"decan ledger" made results up when a table *opened* and kept them on
container disk. This is what replaced that.

## The data, by tier

| Tier | Table | Kept | Written by |
| --- | --- | --- | --- |
| Hot | `melee_table`, `melee_seat`, `melee_play`, `melee_trick` | 3 min after settle (newest table per zone always kept) | the referee, during play |
| Hot | `melee_hand` (private) | until settle | `open_melee_round`; read per player via the `my_melee_hand` view |
| Warm | `melee_result` | 7 days | `melee_settle`, in the same transaction |
| Warm | `agent_melee_turn` | 1 day | the referee (ASOL handoffs) |
| Warm | `battle` | agent raids 1 h, everything 7 days | `agent_war`, star battles |
| Permanent | `melee_career` | forever | `melee_settle` |
| Permanent | `faction_war_standing` | forever (10 rows) | `melee_settle`, decan/season rollovers |
| Permanent | `war_epoch` | forever (36 decans + ~8.8k seasons a year) | `tick_sky` |
| — | `war_state` (public), `war_prune_state` (private) | singletons | the war clock / the pruner |
| Archive | Postgres: `war_melee_result`, `war_melee_seat`, `war_epoch_history`, `war_agent_turn`, `war_rating` | forever | the indoor-spatial feeder ([below](#off-chain-archive)) |

Rules the results follow:

- **Void tables.** A table where no trick resolved, or every seat scored zero,
  is recorded with `is_void = true`. It moves no control, pays no ESMS and
  counts as nobody's win.
- **One push per table.** Control moves as a single net push by the winner,
  so seat order cannot change the outcome. `captured` means the winner took
  the zone from a rival faction. Claiming a neutral zone does not count and
  earns no bonus. When the shares net out in a seated holder's favour, the
  push is applied as the holder, using the holder's own AR multiplier.
- **Decans.** The Sun's decan is computed from the ephemeris Sun's true
  ecliptic longitude, and only Sun rows under 6 hours old count. The next
  decan (or the one after) crowns the decan that just ended. Any other
  reading is held as `war_state.pending_decan` and changes nothing unless the
  same reading persists for 2 hours. One stray or out-of-order push never
  crowns anyone or moves the clock backwards. A confirmed forward jump, such
  as the far side of a feeder outage, crowns the old decan first. The
  champion is the faction with the most decan points: a won table's score,
  plus 50 when it captured the zone. If nobody scored, there is no champion.
- **Void tables and the agent push.** A void table does not suppress
  `agent_war` at its zone, so a zone whose tables keep voiding still moves.
- **Seasons.** Every Great Wheel wrap (360 sky ticks, about an hour) writes a
  `war_epoch` row before the soft reset.

`prune_war_history` runs every 5 s on its own schedule, so a slow prune can
never roll back `tick_sky`.

On first deploy it drains the never-pruned backlog. It walks `opened_at` in
1-hour windows, purging at most 100 tables (6,000 rows) per call, and logs
`War Table backlog drained` when it reaches the present. After that it purges
settled tables 3 minutes after they resolve.

## Rollout order

The module change is a **compatible** publish: new tables, new indexes and a
new view, with no column added to any existing table. It was verified by
publishing the previous module and then this one on a local server. Ship in
this order:

1. **Publish the module.** Watch the logs for `War Table backlog drained`.
   Whole-table `melee_*` subscribers receive delete batches until then.
2. **Regenerate the bindings** (`bun run gen`; already done in this change)
   and deploy the **feeder**. The ledger endpoints now read `melee_result`,
   `faction_war_standing`, `war_epoch` and `war_state`. They need the new
   tables, so they will error against an old module.
3. **Deploy the client.** It subscribes to `my_melee_hand`,
   `faction_war_standing` and `war_state`. Against an old module those are
   unknown, and the subscription-recovery path in `src/net/spacetime.js` drops
   them with a warning. The leaderboard then shows zones and stars only, flagged
   "War Table standings not synced".

Verify with `bash scripts/verify-melee-deploy.sh <db>`. It now counts things
that only grow: the `war_state.last_round_index` high-water mark, and
`melee_result` rows settled inside the window.

## Off-chain archive

`feeder/war-archive.ts` copies every `melee_result` (with one row per seat),
every `war_epoch`, and the ASOL `agent_melee_turn` audit rows into Postgres,
where nothing is pruned. It runs inside the indoor-spatial feeder and is off
unless `WAR_ARCHIVE_DATABASE_URL` is set.

How it stays complete:

- **Cursors live in Postgres,** in `war_archive_cursor`, and each one moves in
  the same transaction as the rows it covers. A crash or redeploy resumes at
  the last commit. The overlap is absorbed by primary keys.
- **Results are read by `resolved_at`,** never by `table_id`: ids are assigned
  when a table opens, so a human table can settle after higher-numbered ones.
  While catching up, the archive reads closed 1-hour windows. A window counts
  as closed once it ended 10 minutes ago. At the head it reads
  `resolved_at >= cursor` every 15 s, with the cursor 60 s behind the newest
  row, so a table settled within the last minute is never skipped.
  A new table reaches the archive within one poll.
- **Turns** are archived once their window closed 30 minutes ago. A turn row
  stops changing within about 10 minutes of its table opening. ASOL or the
  fallback decides it within seconds. A turn still open when its stalled table
  is settled (at 10 minutes) stays unresolved, and is archived with
  `resolved_at` null.
- **Epochs** are read by `epoch_id`. The cursor also stores the cursor row's
  `settled_at`, so a reset database (whose ids restart at 1) is detected and
  re-read from the start.
- **Keyed by database identity,** not name, and every key includes the row's own
  timestamp (`opened_us`, `settled_at`, `requested_at`). Wiping and re-publishing
  `pentacles1` therefore never collides with archived rows, whether or not it
  keeps its identity. Reads go to `/v1/database/<identity>/sql`, the same id the
  rows are filed under. A database re-created under the same name is therefore
  never read under the old label. The name is re-resolved every minute.
- **First run** backfills what the chain still holds: 8 days of results and 2
  days of turns. If the feeder is down longer than the chain keeps rows (7 days
  for results, 1 day for turns), rows from the gap are pruned before they can be
  archived. The archive logs a warning naming the cutoff.
- **Two containers during a redeploy** are safe: writes for a source take a
  Postgres advisory lock.

### Turning it on (Railway)

1. Add a Postgres service to the `passionate-vibrancy` project.
2. On `pentacles-feeders`, set
   `WAR_ARCHIVE_DATABASE_URL=${{Postgres.DATABASE_URL}}` and redeploy. The
   schema is created on start.
3. Within a minute the logs show `[war-archive] archived N result(s)`.
   `GET /api/v1/war/archive/status` shows cursor positions, row counts and the
   newest archived result.

Optional knobs: `WAR_ARCHIVE_POLL_MS` (default 15000) and `WAR_ARCHIVE_ELO_K`
(default 24).

### Reading it

HTTP, on the feeder's public port (rate-limited, read-only):

- `/api/v1/war/archive/status`
- `/api/v1/war/archive/win-rates?by=faction|zone|trump|seats|seat|all&days=30`
  returns win rate against `par_rate` (1 / seats) per group.
- `/api/v1/war/archive/ratings?limit=50&humans=0|1` is the Elo leaderboard.

SQL views, for psql: `war_faction_win_rate` (faction × zone × trump suit ×
seat count), `war_seat_win_rate` (does seat order matter?), `war_daily`
(volume, void rate, captures, ESMS paid, ASOL fallback count) and
`war_leaderboard`. `war_melee_result.winner_esms` is the chain's 10⁴ fixed
point; `war_daily.esms_paid` is already in ESMS.

The views are redefined, with `CREATE OR REPLACE`, only when their
definitions change in code. Grants and views you build on top of them survive
restarts. To rename or retype a view's column, drop that view by hand before
deploying. If a view cannot be updated, the archive logs it and keeps
archiving. For example:

```sql
-- Factions that win well above par at six-seat tables, last 30 days
SELECT s.faction, count(*) AS seats, avg(s.is_winner::int) AS win_rate
FROM war_melee_seat s
JOIN war_melee_result r USING (source_db, table_id, opened_us)
WHERE NOT r.is_void AND r.seat_count = 6 AND r.resolved_at > now() - interval '30 days'
GROUP BY s.faction ORDER BY win_rate DESC;
```

Ratings use multi-player Elo: every pair of seats at a table counts as one
game, won by the higher score, weighted K/(N−1). Void and one-seat tables are
not rated. Each seat stores `rating_before` and `rating_after`. To replay all
ratings in settle order, for example after changing K, run:

```bash
WAR_ARCHIVE_DATABASE_URL=… bun run feeder/war-archive.ts rebuild-ratings
```

Size, including indexes: about 3 KB per six-seat table, plus about 0.45 KB per
ASOL turn. At the module's maximum pace (about 16k tables a day) results alone
take roughly 50 MB a day, or 17 GB a year. Each ASOL seat adds up to 12 turns
per table.

The public endpoints use their own two-connection pool, a 5 s statement
timeout and a 30 s answer cache, so traffic cannot starve the archiver.

## What the web client reads

- **Leaderboard** (`src/net/dashboards.js`, scored by `src/net/live-standings.js`).
  While live it subscribes to `zone`, `star_node`, `faction_war_standing` and
  `war_state` and scores from those rows alone: zones held, stars held, 50 per
  decan crown, plus `decan_points` while `war_state.current_decan` is the
  client's own Sun decan. When the module's clock lags the Sun, the board holds
  those points back and the decan banner says so. The feeder's decan ledger
  only supplies `decanHistory` and `recentRounds`. The faction dossier pages
  read the same board through `window.Pentacles.liveStandings`.
- **Local simulation.** While live, `public/client.js` plays no autonomous
  rounds, `recordRoundResult` records nothing, and a decan crossing moves the
  local clock without crowning anyone: the module does that. Practice melees
  (`faction-war.js`) move no zone control and record no round. Offline, both
  run as before.
- **Settlement panel** (`melee-table.js`). Once a table resolves it reads that
  table's `melee_result` row with one `SELECT … WHERE table_id = N`, never a
  subscription. It shows each seat's final score and control delta, the zone
  before and after, the capture, and the ESMS paid. A void table, a practice
  table or a row it cannot read is labelled as such; nothing is made up.

## Not done here

- **Unity bindings.** `unity/Assets/Autogen` was not regenerated.
