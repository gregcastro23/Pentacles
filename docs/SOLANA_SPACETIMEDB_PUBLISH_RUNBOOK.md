# Future Solana + SpacetimeDB Publish Runbook

Use this runbook **only after** every exit criterion in
[`TYPE_SAFETY_FIRST_REMEDIATION_PLAN.md`](TYPE_SAFETY_FIRST_REMEDIATION_PLAN.md)
has passed in a disposable staging database and a reviewer has approved a
specific production schema diff. It is not authorization to repair compilation,
change table visibility, or publish the current server module.

When that gate is met, use this runbook on the machine that has Rust, the
SpacetimeDB CLI, and an authenticated SpacetimeDB session. It publishes the
server half of the Solana-only migration; Vercel has already deployed the static
frontend at `https://pentacles.alchm.kitchen`.

## Scope and safety gate

Expected Git commit: the reviewed remediation commit or a descendant on `main`.

Publishing may require a schema migration. Do **not** use a destructive publish
option such as `--delete-data=on-conflict` until the current production database
has been backed up and the affected data has been reviewed. If the normal publish
reports a conflict, stop and resolve the migration deliberately. Do not make
private tables public, reintroduce EVM runtime behavior, or restore a legacy
table definition unless the reviewed compatibility matrix explicitly requires
it.

This runbook uses the production module name currently configured by the frontend:

```text
cookingwithcastrollc
```

## 1. Preflight

```sh
git fetch origin
git switch main
git pull --ff-only
git rev-parse --short HEAD
git status --short

node --version
npm ci
bun run test:all
bun run test:live

cargo --version
spacetime --version
```

The commit check must show the reviewed remediation commit or a newer reviewed
commit, and `git status --short` must be empty. `bun run test:live` must pass
against the deployed frontend before modifying the database.

The local JavaScript suite does not compile Rust. These Rust checks are mandatory:

```sh
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path server/Cargo.toml
```

Do not continue on test failure.

## 2. Inspect the current module and protect data

Before publishing, record the current module/deployment state and inspect the
live data with the authenticated SpacetimeDB CLI. At minimum, capture row
counts. Do not print or copy personal, wallet, inventory, or natal rows into
terminal logs or tickets:

```sh
spacetime sql cookingwithcastrollc 'SELECT COUNT(*) FROM player'
spacetime sql cookingwithcastrollc 'SELECT COUNT(*) FROM card'
spacetime sql cookingwithcastrollc 'SELECT COUNT(*) FROM deck_slot'
spacetime sql cookingwithcastrollc 'SELECT COUNT(*) FROM verified_solana_wallet'
spacetime sql cookingwithcastrollc 'SELECT COUNT(*) FROM natal_decan'
```

Create a backup/export using the team’s approved SpacetimeDB backup process
before publishing. Keep the timestamp, module revision, and export location with
the release record. Do not paste wallet addresses, tokens, or private profile
data into tickets or chat.

## 3. Publish the server module

Publish without destructive conflict flags first:

```sh
spacetime publish cookingwithcastrollc --project-path server
```

If the installed CLI uses a different argument order, consult `spacetime publish --help`; preserve the same database name and `server` project path.

If the command reports a schema/data conflict:

1. Stop.
2. Keep the frontend deployment in place; do not force-delete production data.
3. Review the conflict against the saved export and create an explicit migration plan.
4. Obtain approval before using any destructive migration option.

## 4. Regenerate and verify bindings

After a successful publish, regenerate TypeScript bindings from the published schema:

```sh
npm run gen
git diff --exit-code
```

`git diff --exit-code` should be clean. A generated-binding diff means the checked-in bindings do not match the published module; inspect it, commit the intended generated changes, and redeploy the frontend before continuing.

If the Unity client is in release scope, regenerate its bindings too:

```sh
spacetime generate --lang csharp --module-path server --out-dir unity/Assets/Autogen -y
```

Review and commit any intended Unity binding changes separately.

## 5. Authenticated Solana acceptance checks

Perform these checks with two different SpacetimeDB identities and two devnet Solana wallets. Use devnet assets only.

### A. Wallet binding

1. Register/sign in as identity A.
2. Connect wallet A through the live site.
3. Sign the `Pentacles Solana Wallet Binding` message.
4. Confirm `bind_solana_wallet(cluster, solana_pubkey, signature, deadline)` succeeds.
5. Confirm that replaying the same request from identity B fails: the signed message is bound to identity A and the wallet is unique.

### B. Private-table isolation

As identity B, confirm that queries/subscriptions for the following tables return only B’s rows and never A’s:

- `player`
- `verified_solana_wallet`
- `natal_chart`
- `natal_decan`
- `card`
- `deck_slot`

Also verify that public leaderboard/map behavior still works through its intended public projections. Do not make private player, wallet, inventory, or natal-decans public merely to repair a dashboard.

### C. Live inventory and deck sync

Open two sessions for identity A. Change a card loadout in session 1, then verify session 2 updates `card`/`deck_slot` state without reload. Confirm a failed reducer call rolls the optimistic UI back correctly.

### D. Solana finalized-event settlement

The repository’s `scripts/solana-settlement-e2e.test.mjs` validates RPC connectivity, parser behavior, payload encoding, and idempotency logic using fixture data. It does **not** submit a wallet-signed transaction.

For final acceptance, use an approved devnet wallet and the documented ASOL Token-2022 redemption/burn flow. Verify that the feeder/indexer:

1. waits for the required finalized commitment;
2. validates the program, mint, owner, amount, cluster, and transaction signature;
3. invokes `sync_solana_event` once;
4. rejects a replay of the same transaction signature without a second credit.

Record the test transaction signature only in the secured release record.

## 6. Final release gate

All of the following must be true before declaring the backend migration complete:

- `cargo test --manifest-path server/Cargo.toml` passes.
- The SpacetimeDB module publish succeeds without unapproved destructive data handling.
- `npm run gen` produces no unexpected binding diff.
- Wallet binding, private-table isolation, and live deck sync pass with real authenticated sessions.
- A finalized devnet transaction is indexed and is idempotent on replay.
- `bun run test:all` and `bun run test:live` pass after the backend publish.

## Rollback note

Vercel can roll back a static frontend deployment, but it does not roll back a published SpacetimeDB schema or data migration. Treat a server publish as its own release: retain the pre-publish export and stop on migration conflict rather than forcing deletion.
