# Pentacles Web3 & Solana Stack Summary

**Date:** 2026-07-24  
**Project:** Pentacles (`cookingwithcastrollc`)  
**Architecture:** Dual-Chain Omnichain Bridge (Solana Devnet + Base Sepolia EVM) anchored to SpacetimeDB Maincloud with Railway Feeder Workers.

---

## 1. Executive Summary & Stack Architecture

Pentacles implements an **omnichain location-based MMO architecture** where high-frequency game logic, star battles, zone control, and natal chart ephemeris run on **SpacetimeDB Maincloud**, while tokenized element mints and DEX liquidity trade across **Solana Devnet** (SPL Token-2022) and **Base Sepolia** (EVM ERC-1155 & AMM).

```
   ┌──────────────────────┐                    ┌──────────────────────┐
   │    Solana Devnet     │                    │     Base Sepolia     │
   │  Token-2022 Mints    │                    │  ESMS / AMM / Deeds  │
   └──────────┬───────────┘                    └──────────┬───────────┘
              │                                           │
              │  Solana-to-EVM Bridge & Event Feeders      │
              ▼                                           ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │            Railway Workers (`pentacles-feeders`)                 │
   │   • Bridge Feeder          • Ephemeris Feeder                    │
   │   • Oracle Feeder          • Constellation Attestor              │
   └──────────────────────────────┬───────────────────────────────────┘
                                  │
                                  ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │              SpacetimeDB Maincloud (`cookingwithcastrollc`)      │
   │        Authoritative WASM State, Reducers, 49 Tables            │
   └──────────────────────────────────────────────────────────────────┘
```

---

## 2. Solana Devnet Stack (Verified & Live)

### Program & Account Topology

| Resource | Address / Identifier | Status |
| --- | --- | --- |
| **Anchor Program ID** | `7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R` | Verified Slot `478648125` |
| **Upgrade Authority** | `AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5` | Active Devnet Authority |
| **GameAuthority PDA** | `4fhbhdU5yhn572eBbhrDu1axHFsYQhxF2S1oXWtb4Ns2` | Derived & Initialized |
| **Spirit Mint** | `EvkLzWbvRk9iXHcqCkMDAwjAJ85gb6UsVGcTqof8e5Wg` | SPL Token-2022 Mint |
| **Essence Mint** | `28CtdwBtjoUuMffxvZbz684ZY2TG4N4LyWWu6RETq2mo` | SPL Token-2022 Mint |
| **Matter Mint** | `HG9JbHntZrQ4x9uaMhGsMYCrLUWeJLrYNpRqWPMZryAf` | SPL Token-2022 Mint |
| **Substance Mint** | `7eC5Jj9B1BTiX92BSUUeUmdYMQFHq6cMdMLPRimC6pCD` | SPL Token-2022 Mint |

### Solana Achievements & Engineering Details

1. **SPL Token-2022 Integration**:
   - The four elemental mints (Spirit, Essence, Matter, Substance) use SPL Token-2022 extensions.
   - Initialized idempotently via `scripts/init-solana-devnet.mjs` without requiring replacement keypairs on re-runs.

2. **Lossless `u64` JSON Precision Handling**:
   - Web3 JavaScript numbers overflow at `2^53 - 1` (`9007199254740991`).
   - Built custom parser & test suite in [tests/solana-sync-service.test.ts](file:///Users/cookingwithcastro/Desktop/Spacetimedbhackathon/Pentacles/tests/solana-sync-service.test.ts) ensuring raw Solana `u64` values are serialized as unquoted JSON integers without precision loss during SpacetimeDB reducer sync.

3. **Idempotency & Replay Protection**:
   - Every on-chain Solana mint transaction is recorded in SpacetimeDB's `processed_tx` table.
   - Tested & verified with signature `5uXgdg8PkiFpv9umgQaQC9Ui1ndYwH2ZVWidQ9C2WD7zQxJuwxMJktbYPWcDy2s2csMBGiBqsQAbwZpUooibBEsA` (amount `9007199254740993`). Replay attempts yield an HTTP 530 error (`Transaction already processed`).

---

## 3. Base Sepolia EVM Stack

| Resource | Address | Purpose |
| --- | --- | --- |
| **ESMS Token** | `0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F` | ERC-1155 Soulbound Token |
| **Constellation AMM** | `0x6B4EE164320e9E5583C0F6BEe14D5BABb5ba5095` | 12-Pool Constellation DEX |
| **Constellation Deed** | `0x34eAC0fe797df2889d9dc59Cb98dCe24154BB9B6` | ERC-721 LP Ownership NFT |
| **Settlement Wallet** | `0x553C2a3f193d5E7F41cF50cEB32069dbc6951931` | Configured Bridge & Redeemer Signer |
| **Deployer Admin** | `0x554F991D030aDF539CBD2ff3D896951C6f089804` | Holds `DEFAULT_ADMIN_ROLE` on ESMS |

---

## 4. Off-Chain Feeder Infrastructure (Railway)

- **Railway Project**: `passionate-vibrancy` (`79c2e926-15f1-49a1-88ee-8c3870adcc8f`)
- **Environment**: `production` (`5d22eec1-085f-4588-904d-7f05e79dd953`)
- **Service**: `pentacles-feeders` (`3edd3365-fcbc-4425-8489-e6e0c00f5753`)
- **Status**: ● Online (`7/7 children up`)
- **Workers Supervising**:
  1. `push-ephemeris.ts` (Real-time celestial coordinate sync)
  2. `bridge-service.ts` (Omnichain Solana ↔ EVM mint/burn bridge)
  3. `oracle-service.ts` (Claude 3.5 AI companion poller)
  4. `constellation-service.ts` (DEX LP & Swap attestor)
  5. `duel-service.ts` (Planetary agents word duel engine)
  6. `stdb-feed.ts` (Reactive SpacetimeDB table subscriber)
  7. `solana-sync-service.ts` (Token-2022 event listener)

---

## 5. Verification Suite & Test Pass Status

| Test Suite | Command | Result |
| --- | --- | --- |
| **Omnichain Bridge Tests** | `bun run test:omnichain` | `PASS` (4/4 test groups) |
| **Gameplay Contract Tests** | `bun run test:gameplay` | `PASS` |
| **Production Frontend Build** | `bun run build` | `PASS` (Built in 345ms) |

---

## 6. Next Action Items & Roadmap

1. **Grant `MINTER_ROLE` on Base Sepolia**:
   - Deployer `0x554F991D030aDF539CBD2ff3D896951C6f089804` must call `grantRole(MINTER_ROLE, 0x553C2a3f193d5E7F41cF50cEB32069dbc6951931)` on `EsmsToken` (`0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F`).
2. **Top Up Base Sepolia ETH**:
   - Send ~0.01-0.05 Base Sepolia ETH to `0x553C2a3f193d5E7F41cF50cEB32069dbc6951931` for gas fees.
3. **Merge Pull Request #22**:
   - Complete review of [PR #22](https://github.com/gregcastro23/Pentacles/pull/22) (`codex/testnet-deployment-session`) and merge into `main`.
