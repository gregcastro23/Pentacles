# Historical agent rating feed

The `agent-ratings` feeder pulls the existing public ASOL frontend
`GET /api/agents/rating?roster=true` and `?agentId=<key>` endpoints. It publishes
bounded version-1 snapshots with `publish_agent_rating`. No producer changes or
ASOL internal API secret are required. `historical-feed-contract.ts` reexports
the rating contract but its recipe/yield stream is not the ratings endpoint.

## Data path

1. Read public `agent_chart` handles. Match only the canonical seeded `FIGURES`
   roster; resolve source IDs by exact key or a unique normalized roster name.
2. Validate the response's historical provenance, requested source key, seven
   integer 25–99 ratings and OWA overall. Project only ratings, ESMS, seals, surge,
   and chart provenance. Wallets, natal charts, arbitrary URLs and private fields
   are never copied. No credentials are sent to ASOL.
3. The owner-only reducer derives `Identity::from_claims("pentacles:agent", key)`
   and requires its public NPC chart. It validates the versioned JSON schema,
   bounded numbers/seals, timestamps and strictly increasing observations before
   inserting/updating the public `agent_rating` row. Purging an NPC removes it.
4. The court joins the snapshot to the seat's occupant identity. It refreshes the
   existing body, seals and foot ring, preserving travel, selection and territory.
   Humans remain pending; matching a historical name cannot give a human its rating.
   Live vessels do not read from or subscribe to the shared example/wallet cache.

The local OWA and archetype helpers match the producer's rating contract. Seal
awards and surge readings are preserved from the source; this feed does not
recompute natal stats, award holdings, or modify combat outcomes.

## Availability

A missing, deleted or invalid snapshot is **pending**. A source `fallback` ESMS
read is **partial**: unknown holdings are not displayed as measured zeroes and
cannot grant seals. A missing sky reading is also partial and renders without
surge effects. A provisional natal chart can still carry rated stats; it cannot
carry a Celestial seal. The inspector shows its chart provenance separately.

Snapshots older than five minutes are **stale**, with the observation time still
visible. Read/write failures leave the previous database snapshot intact; a new
partial response clears unverified holdings/seals or surge rather than pretending
they were measured. Neither failure nor reconnect promotes example values to live.

Sweeps run serially, with at least two minutes between completed sweeps. Requests
have ten-second timeouts and body limits. HTTP 429 stops that sweep. Invalid or
ambiguous agents are skipped and counted in logs. The service reports published,
partial, unmatched and failed counts; `--once` exits unsuccessfully on failures
or unmatched seeded agents.

## Production deployment

A dedicated Railway service, [pentacles-agent-ratings](https://railway.com/project/79c2e926-15f1-49a1-88ee-8c3870adcc8f/service/18b9b0b7-2134-4bce-9414-d043f11d2a77),
was deployed to the `production` environment on 2026-10-23. It runs only the
rating feeder against Maincloud `asol`. The existing `pentacles-feeders` service
was left unchanged; its configuration still targets the separate, paused
`pentacles` database.

- Project: `79c2e926-15f1-49a1-88ee-8c3870adcc8f` (`passionate-vibrancy`).
- Environment: `5d22eec1-085f-4588-904d-7f05e79dd953` (`production`).
- Service: `18b9b0b7-2134-4bce-9414-d043f11d2a77`.
- Successful deployment: `7d46be49-e619-41b9-9182-4795cde166b6`.

The deployed `asol` module already contained `agent_rating` and
`publish_agent_rating`, so activation did not republish the module. A fresh
binding generation matched the checked-in bindings after the existing enum
patch. For future schema changes, publish the module and ship matching client
bindings before deploying the feeder.

The service has an explicit owner `SPACETIME_TOKEN` in Railway variables, plus:

```dotenv
SPACETIMEDB_URI=https://maincloud.spacetimedb.com
SPACETIMEDB_DB=asol
PLANETARY_AGENTS_FRONTEND_URL=https://agents.alchm.kitchen
AGENT_RATING_INTERVAL_MS=120000
NODE_ENV=production
```

The source is the Next frontend, not `PLANETARY_AGENTS_BACKEND_URL` (the oracle
API). HTTPS is required except on localhost. The dedicated image bundles
`feeder/agent-rating-service.ts` and starts it directly. It requires no public
domain. `feeder/railway.agent-ratings.toml` selects its Dockerfile and an `ALWAYS`
restart policy. The standard `feeder/all.ts` supervisor also includes this
service; do not point both workers at `asol`.

### Releasing the dedicated worker

Deploy a minimal staging directory containing only the dedicated Dockerfile's
`COPY` inputs. Keep credentials in Railway variables, outside the build context.
The following prepares that directory from the repository root:

```sh
rating_release_dir=$(mktemp -d /tmp/pentacles-agent-ratings.XXXXXX)
mkdir -p "$rating_release_dir/feeder" "$rating_release_dir/scripts" \
  "$rating_release_dir/src/lib/agents" "$rating_release_dir/src/net"
cp package.json bun.lock "$rating_release_dir/"
cp feeder/agent-rating-service.ts feeder/spacetime-cli.ts feeder/stdb-feed.ts \
  "$rating_release_dir/feeder/"
cp scripts/agents-data.ts "$rating_release_dir/scripts/"
cp src/lib/agents/agent-rating-feed.ts src/lib/agents/rating-contract.ts \
  "$rating_release_dir/src/lib/agents/"
cp -R src/module_bindings "$rating_release_dir/src/"
cp src/net/ws-normalize.js "$rating_release_dir/src/net/"
cp feeder/Dockerfile.agent-ratings "$rating_release_dir/feeder/"
cp feeder/Dockerfile.agent-ratings "$rating_release_dir/Dockerfile"
cp feeder/railway.agent-ratings.toml "$rating_release_dir/railway.toml"
cd "$rating_release_dir"
RAILWAY_CALLER=skill:use-railway@1.2.0 \
RAILWAY_AGENT_SESSION=pentacles-agent-ratings-release \
railway up --project 79c2e926-15f1-49a1-88ee-8c3870adcc8f \
  --environment 5d22eec1-085f-4588-904d-7f05e79dd953 \
  --service 18b9b0b7-2134-4bce-9414-d043f11d2a77 --detach
```

Run `railway up` from the staging directory itself. Supplying that directory as
an upload path while running from the application root previously selected the
frontend Railpack build instead. The root `Dockerfile` also makes detection
unambiguous. Check deployment status and bounded runtime logs after upload.

For a controlled first sweep from the repository root:

```sh
bun run feeder/agent-rating-service.ts --once
```

That command writes ratings to the configured database. In development without
a token it uses the logged-in SpacetimeDB CLI identity and the configured server;
production requires an explicit database and owner token. Inspect
`SELECT * FROM agent_rating` and open a live seated NPC in the court. Fully
available readings show **Live rating**; upstream ledger/sky outages show
**Partial live rating**. This is an NPC integration; player-owned ratings need a
separate consent-aware private projection.

### Activation checks

On 2026-10-24 the dedicated deployment was still `SUCCESS`, with eight recent
consecutive sweeps each reporting 71 published, 71 partial, zero failures, zero
unmatched agents and no rate limiting. The delay is 120 seconds after each
completed sweep, so starts are slightly more than two minutes apart.

The 2026-10-24 database read-back confirmed all 71 rows were fresh (the oldest
was 69 seconds old at the check). All were
partial because ESMS ledger readings were unavailable; sky readings were present
for all 71. The database had no melee tables or seats, so there was no live
seated avatar on which to confirm a badge. Activation did not create gameplay
records to manufacture that check.

Client verification also found that generated SDK table accessors use camelCase
(`agentRating`) while subscription SQL uses snake_case (`agent_rating`). The
application now resolves both names when attaching change listeners and reading
the cache, with a regression test for initial snapshots and updates. This client
fix is local and must ship with the next frontend release; deploying the worker
does not publish the web client.

An anonymous WebSocket check on 2026-10-24 received 71 normalized, fresh rating
rows through the corrected application client, with the subscription marked
applied. The final check imported the restored repository sources directly.
It retained no identity token and invoked no gameplay reducers.

## Verification

- `bun run test:ratings`: API normalization, invalid payloads, degraded readings,
  roster matching, feeder writes/failures, cache isolation, in-place updates,
  human identity separation, deletion, reconnect and generated SDK table naming.
- `bun run test:court` and `bun run test:feeder`: existing court/feeder regressions.
- `cargo test --manifest-path server/Cargo.toml`: schema bounds and owner/NPC,
  freshness and ordering guards alongside server tests.
- `bun run gen`: regenerate bindings after server changes.
- `/tests/fixtures/court-rating-test.html`: local synthetic subscription harness
  with pending/current/partial/stale/deleted rating controls and no game writes.

Activation validation: `test:ratings` passed 10 tests; `test:court` passed 103
with one existing skip. The isolated worker bundle passed a local `--once`
smoke test covering its public API read, authenticated reducer write, canonical
identity and clean exit. The 2026-10-24 frontend rebuild after the SDK accessor
fix passed after restoring iCloud-evicted files, producing both `index.html` and
`observatory.html`. Existing mixed Three.js import and chunk-size warnings remain.
