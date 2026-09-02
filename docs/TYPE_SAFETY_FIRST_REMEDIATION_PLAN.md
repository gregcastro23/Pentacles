# Type-Safety-First Release Remediation Plan

## Decision

**Do not perform any SpacetimeDB production operation yet.** This plan is a
source, type, and compatibility remediation only. A production publish,
visibility change, table/column removal, data migration, or use of a destructive
publish flag requires a later, separately approved release gate.

The earlier plan correctly identified two server compile blockers and two
deleted feeder entries. It must not restore public access to private player,
wallet, inventory, or natal data merely to make a schema update convenient.
Preserving rows and exposing rows are distinct decisions.

## Findings and revised disposition

| Priority | Finding | Evidence | Required disposition before any database action |
| --- | --- | --- | --- |
| P0 | The module cannot compile as written: `claim_profile` calls the removed `bridge_transfer` table accessor. | `server/src/reducers.rs` calls `ctx.db.bridge_transfer()`, but no matching table exists in the current `server/src/tables.rs`. | Make a deliberate compatibility decision: either preserve the *exact* live legacy table definition temporarily, or remove the identity-rewrite loop. Do not choose based on compilation alone. Test the selected behavior. |
| P0 | The wallet-binding reducer uses a nonexistent `Identity::as_bytes()` method. | `bind_solana_wallet` calls `sender.as_bytes()`. | Replace it with the installed 2.6.x API only after compiling. The intended canonical wire value is `0x` plus the 32-byte big-endian representation (`to_be_byte_array()`), matching the browser's hexadecimal identity string. Add cross-language test vectors; do not rely on a visual string comparison. |
| P0 | The server is not reproducibly buildable from this repository alone. | `server/Cargo.toml` uses a path dependency outside the repository: `../../../AlchmAgentsSolana/alchm-astro-core`. | Vendor the dependency, use a reviewed pinned Git/package source, or document and provision it in the build image. The clean checkout build must be part of CI. |
| P0 | A schema compatibility change is being inferred without inspecting the deployed schema. | The candidate source makes `player`, wallet, card, deck, and natal-decan tables private, while the pre-Solana source made them public. | Obtain a read-only deployed schema snapshot and test the candidate against a disposable staging database. Do not change table visibility in production until compatibility and access behavior are proven. |
| P1 | The plan would re-expose sensitive data. | Re-adding `public` to `player`, `verified_solana_wallet`, `natal_decan`, `card`, and `deck_slot` exposes player identities, wallet bindings, inventory/deck state, and derived natal data to every subscriber. | Keep sensitive rows private. If the currently deployed schema cannot change safely, treat its existing exposure as explicitly documented temporary risk; do not worsen it or claim it is remediated. Design a separate privacy migration with public projections for only the fields that genuinely need public display. |
| P1 | EVM-era schema compatibility needs evidence, not a blanket restore. | `Player.evm_address`, `VerifiedEvmWallet`, and `BridgeTransfer` existed at `9dd825e` but are absent from the current tables module. `BridgeChain` is still used by current Solana settlement reducers. | Compare deployed table names, columns, indexes, enum tags, and access rules to the candidate. Preserve an exact deprecated definition only where the staging schema diff proves it is required to avoid a destructive migration. Remove all EVM runtime paths regardless. |
| P1 | The feeder supervisor starts two nonexistent files. | `feeder/all.ts` lists `constellation-service.ts` and `bridge-service.ts`; neither is present. | Remove both entries and their stale comments. The remaining eight entrypoints must be checked for existence and startability. |
| P1 | Generated client bindings are not a substitute for server compilation or deployed-schema validation. | `src/module_bindings/` is generated from a module schema, while the production module has not been safely rebuilt/published in this release. | Regenerate only from the successfully compiled staging module. Reject unexpected binding diffs and separately deploy any resulting frontend change. |

## Phase 0 — Freeze production state and capture evidence (read-only)

1. Record the exact commit, `spacetime --version`, `cargo --version`, and the
   `spacetimedb` crate version actually resolved in `Cargo.lock`.
2. On the authenticated machine, capture the deployed module schema, table
   access rules, indexes, enum definitions, and row counts using read-only CLI
   commands or the approved admin console. Store the capture in the secured
   release record; do not copy player, wallet, deck, or natal records into a
   ticket.
3. Confirm the intended target database name from the checked-in frontend
   configuration. Do not assume that a name found in prior notes is still the
   target.
4. Create or identify a disposable staging database. It must not contain
   production credentials or production user records unless the approved backup
   and privacy process explicitly permits that.
5. Verify a restore path and a backup policy before scheduling any future
   production publish. This is preparation only, not authorization to publish.

**Exit criterion:** there is a reviewable before-schema and a non-production
target for proving the migration. No production module or data has changed.

## Phase 1 — Make the server compile reproducibly

### 1. Resolve the external Rust dependency

Choose one reviewed approach:

- vendor `alchm-astro-core` into this repository or a locked workspace;
- pin it to an immutable reviewed Git revision; or
- provision it in the canonical build environment and enforce that in CI.

Do not accept a local developer-specific absolute or parent-directory dependency
as release evidence. Commit the lockfile changes that make the choice
reproducible.

### 2. Repair source-level type errors

1. Replace the invalid `Identity::as_bytes()` call with a small canonical
   identity-format helper that uses the exact resolved SpacetimeDB 2.6.x API.
   Its output must be `0x` followed by 64 lowercase hexadecimal characters from
   the identity's big-endian byte representation.
2. Keep the JavaScript wallet message and Rust message in one documented,
   byte-for-byte contract. Normalize the cluster in exactly one specified way;
   include domain, identity, public key, and deadline in the same order and
   with no trailing newline.
3. Resolve the `bridge_transfer` compile break only after the Phase 2
   compatibility decision. If the legacy table is retained temporarily, retain
   its exact schema and test whether `claim_profile` must continue to rewrite
   old ownership rows. If it is not retained, remove the loop and explicitly
   document that legacy bridge records are immutable historical data rather
   than silently leaving them attached to an old identity.
4. Preserve no EVM behavior: no EVM wallet binding, RPC, contracts, bridges,
   client UI, or serverless API is to be reintroduced. A deprecated schema
   field, if strictly needed for no-drop compatibility, must have no runtime
   read/write path and a recorded removal criterion.

### 3. Add deterministic tests before moving on

Add Rust tests that cover:

- a fixed identity-to-hex test vector matching the TypeScript SDK/browser
  representation;
- valid Ed25519 wallet-binding signatures;
- invalid signature, invalid 32-byte public key, invalid 64-byte signature,
  expired deadline, overlong deadline, unsupported cluster, and a wallet
  already bound to another identity;
- message bytes produced by Rust and JavaScript for the same fixed inputs;
- the selected `claim_profile` legacy-transfer behavior.

Run, with no ignored failures:

```sh
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path server/Cargo.toml
bun run test:solana
bun run test:client
bun run test:smoke
bun run test:all
```

**Exit criterion:** a clean checkout on the authenticated build machine compiles
and passes Rust plus JavaScript tests. This is still not permission to publish.

## Phase 2 — Establish a schema compatibility contract

1. Generate the candidate module schema from the compiled server and compare it
   field-for-field with the Phase 0 deployed schema.
2. Classify every difference as one of: additive-compatible, value-preserving
   migration required, access-control change, index/key change, enum tag risk,
   or destructive removal. Include table names, fields, defaults, primary and
   unique keys, indexes, and enum discriminants.
3. Preserve legacy `Player.evm_address`, `VerifiedEvmWallet`, or
   `BridgeTransfer` only if the comparison proves that omitting it would drop or
   invalidate live data. Any retained definition must match the deployed shape
   exactly, including table accessor, primary/unique/index annotations,
   defaults, and enum tags. Mark it `deprecated` in source and give it a tracked
   removal release.
4. Do **not** change a table to `public` just to preserve it. If an access-rule
   change itself is not safely migratable, stop the privacy migration at this
   point and retain the current deployed access temporarily while removing
   unnecessary client subscriptions. Record the residual exposure plainly.
5. For the later privacy release, create narrow public projections for gameplay
   or leaderboard data (for example, a display handle and aggregate score), not
   public copies of wallet bindings, card inventory, deck slots, or natal data.

**Exit criterion:** a signed-off compatibility matrix states that the staging
publish is non-destructive, or an explicit migration design exists. “It built”
is not a schema-safety result.

## Phase 3 — Repair and validate the feeder supervisor

1. Remove `constellation-service.ts` and `bridge-service.ts` from `SERVICES` in
   `feeder/all.ts`, plus comments that describe them as active workers.
2. Add a test that validates every `SERVICES` entry resolves to an existing
   feeder entrypoint. Assert the expected eight names:
   `oracle`, `duel`, `jing`, `ephemeris`, `solana-sync`, `historical-agents`,
   `war-table`, and `indoor-spatial`.
3. Run the supervisor in a non-production environment with intentionally
   missing optional credentials and confirm it reports a clear service failure
   rather than a file-not-found restart loop. Then run it with required test
   credentials and verify all eight workers stay healthy for at least one health
   interval.
4. Treat a Railway `8/8` observation as a deployment acceptance check, not as
   proof that the TypeScript file edit is correct.

**Exit criterion:** no registered worker references a deleted file, and the
non-production health check reports eight expected workers without restart
loops.

## Phase 4 — Prove the candidate in staging

Only after Phases 1–3 succeed:

1. Publish the compiled module to the disposable staging database with no
   destructive or conflict-bypass option.
2. Regenerate bindings from that published staging module:

   ```sh
   npm run gen
   git diff --check
   git diff -- src/module_bindings
   ```

   Review and commit intended binding changes before a frontend deployment.
3. Test two authenticated identities. Each must see only its own private
   `player`, `verified_solana_wallet`, `natal_chart`, `natal_decan`, `card`, and
   `deck_slot` records. Verify any required public projections contain only the
   intentionally public fields.
4. Run the real wallet-binding flow using devnet wallets, including the
   cross-identity replay/uniqueness rejection. Test live card/deck updates and
   optimistic rollback through the generated bindings.
5. Perform the existing fixture tests and, separately, a controlled devnet
   finalized-event test. The latter must show exactly-once `sync_solana_event`
   handling on replay; fixture-only tests cannot establish that property.

**Exit criterion:** staging proves the compiled module, generated bindings,
access controls, wallet protocol, and feeder behavior together.

## Phase 5 — Separate approval for production database work

This phase is deliberately outside the present repair authorization. It may be
scheduled only when every prior exit criterion is met and a reviewer approves a
specific schema diff and backup/rollback record.

The future runbook must require:

1. a verified backup/export and documented restoration owner;
2. a normal, non-destructive publish attempt first;
3. an immediate stop on schema conflict — never use a data-deletion or
   conflict-bypass flag as an improvised fix;
4. post-publish binding regeneration, authenticated private-data isolation,
   Solana wallet binding, card/deck synchronization, and finalized devnet
   idempotency checks;
5. a frontend release only after its bindings correspond to the published
   module.

Vercel deployment status is not evidence about the SpacetimeDB module: it
deploys the frontend and does not compile or publish `server/`.

## CI release gates to add

The build pipeline should fail on all of the following:

```sh
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path server/Cargo.toml
bun run test:all
bun run build
```

In addition, make the pipeline build from a clean checkout, verify the external
astro-core dependency is resolvable, generate bindings in a controlled staging
job, and fail when generated bindings differ unexpectedly. Keep production
SpacetimeDB credentials out of CI jobs that run pull-request tests.

## Explicit non-goals of this remediation

- No production database write, publish, migration, deletion, or access-rule
  change.
- No EVM/Base/Sepolia restoration.
- No claim that private data is protected until the deployed module and
  authenticated two-identity test demonstrate it.
- No reliance on Vercel frontend tests as proof of Rust compilation or database
  compatibility.
