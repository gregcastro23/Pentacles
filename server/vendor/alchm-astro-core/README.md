# alchm-astro-core (Vendored)

## Provenance & Revision Information

- **Origin Repository:** `alchm-agents-solana` (`/Users/GregCastro/ASOL/alchm-agents-solana/alchm-astro-core`)
- **Crate Version:** `0.1.0`
- **Rust Edition:** `2021` (aligned with `pentacles-server` edition 2021)
- **Vendored Date:** 2026-09-15 (Fourteen Pillars Phase 0: `pillars`, `circuit`, `spec/`, `tests/`, `tools/`)
- **Purpose:** Provides pure astrological enum definitions (`Planet`, `Suit`, `Modality`, `ZODIAC_SIGNS`) and dignity/element mappings shared between the web client, feeder companion daemons, and the SpacetimeDB server module. The `pillars` and `circuit` modules implement the Fourteen Pillars spec (`spec/pillars.v1.json`): chart tallies, hand gating, cast power, duel resolution, and room sharing.
- **Maintenance Policy:** This crate has zero runtime dependencies (`serde_json` is a dev-dependency for the parity tests only). Edit it in `alchm-agents-solana`, then copy `src/`, `spec/`, `tests/`, `tools/`, `Cargo.toml` and `.gitignore` here unchanged. `cargo test --manifest-path server/vendor/alchm-astro-core/Cargo.toml` must pass in both places; ASOL's `test/alchemical-circuit.test.ts` checks the same fixtures from TypeScript.
- **License:** MIT OR Apache-2.0
