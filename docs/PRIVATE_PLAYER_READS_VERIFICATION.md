# Private player reads — local verification

Verified on October 14, 2026 with SpacetimeDB 2.10.0. The baseline was committed
`main`, `d9313cadb43b480d3f00b22750e5cbd4c843ebba`. The updated module included the
pre-existing uncommitted Oracle/Jing fixes and the four new views. Existing work
was preserved; no maincloud publish or deployment was performed.

The new views are `my_natal_chart`, `my_star_stake`, `my_trace_intent`, and
`my_trace_attestation`. They use the existing identity primary-key BTree index,
`staker` index, and two `trader` indexes. No table fields, types, or access levels
changed for this task.

## Results

The baseline was published to the local database
`pentacles-private-reads-20261014-2` at `http://127.0.0.1:3000`. Two real player
identities registered distinct charts, signed wallet ownership proofs, received
owner-recorded stake positions, and traced Cassiopeia with owner-recorded
attestations before the module was updated.

Publishing the updated module with `-s local --delete-data=never` succeeded. The
migration plan created only the two existing Oracle indexes and seven views
(the existing Oracle/Jing views plus these four). The database identity remained
`c20000f5fb5ff00866ce868b680c7b9b981f04d558d314cb4eb3f4b305629c33`.

The verifier confirmed:

- Both players retained their exact pre-migration fixture values, including
  attestation nonces above JavaScript's safe integer range.
- Each player saw one own row in each of the four views. A fresh third identity
  saw zero rows in every view.
- All 12 HTTP `/sql` reads of the four underlying private tables, across the
  three player tokens, were refused.
- One held subscription per connection delivered A's changed chart and second
  stake, intent, and attestation. B still saw only its original rows; the third
  identity still saw none.

`bun run gen`, `bun run test:client`, `bun run test:feeder`, and
`cargo test --manifest-path server/Cargo.toml` passed. The view tests passed 49
tests, including 24 new tests for natal charts, stake claims, and traces. Feeder
tests passed 39 with 9 environment-dependent Postgres tests skipped. Rust tests
passed 121 with one intentionally ignored parity case.

An additional `bun run build` attempt stalled before Vite produced build output
and was stopped. The browser production bundle build was not verified.

## Repeat the check

Run from the repository root, with an isolated local server listening on port
3000. The CLI default is maincloud; every database command below explicitly
selects `-s local`. Keep commands under timeouts and run them unsandboxed for the
iCloud-backed checkout. Separate scratch targets prevent baseline/current
artifact reuse.

```sh
spacetime start --listen-addr 127.0.0.1:3000 --in-memory --non-interactive
```

In a second terminal:

```sh
scratch=$(mktemp -d /private/tmp/pentacles-private-reads.XXXXXX)
db=pentacles-private-reads-$(date +%s)
git -c core.fsmonitor=false archive d9313cadb43b480d3f00b22750e5cbd4c843ebba server | tar -x -C "$scratch"
CARGO_TARGET_DIR="$scratch/main-target" cargo build --manifest-path "$scratch/server/Cargo.toml" --target wasm32-unknown-unknown --release --locked
CARGO_TARGET_DIR="$scratch/current-target" cargo build --manifest-path server/Cargo.toml --target wasm32-unknown-unknown --release --locked
spacetime publish -s local --no-config --delete-data=never --yes=skip-login,migrate --bin-path "$scratch/main-target/wasm32-unknown-unknown/release/pentacles_server.wasm" "$db"
bun scripts/private-reads-local.ts seed "$db"
spacetime publish -s local --no-config --delete-data=never --yes=skip-login,migrate --bin-path "$scratch/current-target/wasm32-unknown-unknown/release/pentacles_server.wasm" "$db"
bun scripts/private-reads-local.ts verify "$db"
```

The verifier fixes its URI to loopback, rejects non-test database names, and
keeps credentials in a mode-0600 `/private/tmp` fixture. Verification mutates
player A, so repeat with a fresh database. Stop the temporary server and remove
the fixture after testing. Git commands may also need
`-c core.fsmonitor=false` to avoid the checkout's stalled filesystem monitor.
