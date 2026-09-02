# Type-Safety-First Remediation Walkthrough

This document records the exact state of the source-level remediation, the strengthened cross-language test contracts, and the mandatory next verification gates for the authenticated build environment.

---

## 1. Summary of Changes in Working Tree

### Build Reproducibility & Rust Type Safety
- **Vendored `alchm-astro-core`:** Vendored into [`server/vendor/alchm-astro-core/`](file:///Users/GregCastro/Pentacles/server/vendor/alchm-astro-core), pinned to `edition = "2021"`, updated [`server/Cargo.toml`](file:///Users/GregCastro/Pentacles/server/Cargo.toml) to `path = "vendor/alchm-astro-core"`, and added provenance documentation ([`README.md`](file:///Users/GregCastro/Pentacles/server/vendor/alchm-astro-core/README.md)) and [`LICENSE`](file:///Users/GregCastro/Pentacles/server/vendor/alchm-astro-core/LICENSE).
- **Pinned Rust Toolchain:** Created canonical root [`rust-toolchain.toml`](file:///Users/GregCastro/Pentacles/rust-toolchain.toml) pinning `channel = "1.82.0"`, target `wasm32-unknown-unknown`, and components `rustfmt`/`clippy`.
- **Repaired `claim_profile`:** Removed the invalid `ctx.db.bridge_transfer()` loop in [`server/src/reducers.rs:6170`](file:///Users/GregCastro/Pentacles/server/src/reducers.rs#L6170).
- **Repaired `bind_solana_wallet`:** Replaced nonexistent `sender.as_bytes()` with canonical `&sender.to_be_byte_array()` formatted with `hex_bytes` in [`server/src/reducers.rs:6304`](file:///Users/GregCastro/Pentacles/server/src/reducers.rs#L6304).
- **Pure Challenge Formatter:** Extracted pure helper `format_wallet_binding_message` in [`server/src/reducers.rs:6360`](file:///Users/GregCastro/Pentacles/server/src/reducers.rs#L6360) used by both the reducer and test suite.

### Strengthened Cross-Language Test Contract (Rust ↔ JS)
- **Versioned Test Vector Fixture:** Created [`tests/fixtures/wallet-binding-vectors.json`](file:///Users/GregCastro/Pentacles/tests/fixtures/wallet-binding-vectors.json) with `version: "1.0.0"`, domain, deterministic test pubkey, and an array of test vectors.
- **Fixed Ed25519 Cryptographic Signatures & Failure Modes:** Fixture includes both valid devnet/mainnet-beta test cases and comprehensive failure vectors:
  - `altered_message_tampered_cluster`: Signature verification failure when challenge message is tampered.
  - `invalid_pubkey_not_base58`: Base58 decoding failure on malformed pubkey string.
  - `invalid_pubkey_wrong_length_31_bytes`: Rejection of non-32-byte public keys.
  - `invalid_signature_wrong_length_63_bytes`: Rejection of non-64-byte signatures.
  - `unsupported_cluster_testnet`: Rejection of unsupported clusters.
  - `expired_deadline`: Rejection when deadline is in the past.
  - `overlong_deadline`: Rejection when deadline is > 900s in the future.
- **Typed Rust Fixture Tests:** Defined `WalletBindingFixture` and `WalletBindingVector` deserialization structs in [`server/src/reducers.rs`](file:///Users/GregCastro/Pentacles/server/src/reducers.rs) and iteratively tested every vector for identity representation, challenge string generation, and Ed25519 signature verification / failure modes.
- **Comprehensive JS/TS Fixture Tests:** Updated [`scripts/dryrun-solana.test.mjs`](file:///Users/GregCastro/Pentacles/scripts/dryrun-solana.test.mjs) to iterate all vectors and verify cryptographic validity and failure behavior against Node.js `crypto` and `bs58`.

### Feeder Supervisor & Health Checks
- **Cleaned Supervised Services:** Removed `constellation-service.ts` and `bridge-service.ts` from `SERVICES` in [`feeder/all.ts`](file:///Users/GregCastro/Pentacles/feeder/all.ts#L54-L65).
- **Guarded Execution:** Added `if (import.meta.main)` to [`feeder/all.ts`](file:///Users/GregCastro/Pentacles/feeder/all.ts#L280-L292).
- **Created Health Assertion Test:** Created [`tests/feeder-services.test.ts`](file:///Users/GregCastro/Pentacles/tests/feeder-services.test.ts) verifying all 8 active companion services exist on disk and match the registry.
- **Integrated `test:all`:** Added `test:feeder` to [`package.json`](file:///Users/GregCastro/Pentacles/package.json#L22-L26).

---

## 2. Test Verification (JavaScript / TypeScript / Bun)

```text
bun test tests/feeder-services.test.ts   → 3 pass, 0 fail (12ms)
bun run test:solana                      → 32 pass, 0 fail (62ms) + 4 dryrun pass (Shared Fixture Validated)
bun run test:client                      → 100% pass (gameplay, war table, chart math)
bun run test:smoke                       → 100% pass (production assets and DOM bridges)
bun run test:all                         → 100% green
bun run build                            → Built client bundle in 279ms
git diff --check                         → 100% clean (0 errors)
```

---

## 3. Exact Gate on the Authenticated Machine

Execute the following sequential commands on the machine equipped with `rustup`, `cargo`, and authenticated SpacetimeDB CLI:

### 1. Toolchain & Lockfile Generation
```sh
rustup show
rustup toolchain install 1.82.0 --component rustfmt --component clippy --target wasm32-unknown-unknown

cargo generate-lockfile --manifest-path server/Cargo.toml
cargo metadata --locked --manifest-path server/Cargo.toml --format-version 1 > server/cargo-metadata.json
cargo tree --locked --manifest-path server/Cargo.toml
```

### 2. Rust Quality Gates & Tests
```sh
cargo fmt --manifest-path server/Cargo.toml -- --check
cargo clippy --locked --manifest-path server/Cargo.toml --all-targets -- -D warnings
cargo test --locked --manifest-path server/Cargo.toml
```

### 3. Toolchain & SDK Compatibility Check
```sh
spacetime --version
npm ls spacetimedb
cargo tree --locked --manifest-path server/Cargo.toml -p spacetimedb
```

### 4. Client Bindings & Build Verification
```sh
npm ci
bun run test:all
bun run build
npm run gen
git diff --check
git diff -- src/module_bindings
```

### 5. Staging-Only Backend Verification (Zero Production Actions)
```sh
# Verify syntax options
spacetime describe --help

# Capture deployed schema read-only snapshot
spacetime describe --server maincloud --json cookingwithcastrollc > schema-deployed.json

# Publish ONLY to disposable staging database without destructive flags
# Perform private table access checks across two distinct identities
# Validate 8 feeder companions in staging
```
