# Pentacles — Pending Work

**Last swept:** 2026-10-14, after the per-player views (commit `0ee4735`) and the
Jing cast fixes (PR [#73](https://github.com/gregcastro23/Pentacles/pull/73)).
Previous sweep: 2026-08-27, during the ASOL Solana mainnet conformance pass
(PR [#23](https://github.com/gregcastro23/Pentacles/pull/23)).

Everything outstanding across the project, in the order things unblock each
other. This is a living file — update the status column when an item lands, and
delete items rather than letting them rot.

## How to read the status column

| Status | Meaning |
| --- | --- |
| **Verified** | Confirmed against the code or a command run during this sweep. |
| **Recorded** | Carried from a runbook or handoff doc; the doc is the source, not a live check. |
| **Re-check** | Carried from notes that may be stale. Verify before acting — the note is older than at least one release that could have resolved it. |

Anything touching a chain or production is **Recorded** or **Re-check** by
default: this sweep read code, not on-chain state.

---

## 1. Blocking the Solana mainnet cutover

Strictly ordered — each unblocks the next. Full context in
[`SOLANA_MAINNET_CONFORMANCE.md`](SOLANA_MAINNET_CONFORMANCE.md).

| # | Item | Status | Notes |
| :-- | :-- | :-- | :-- |
| 1.1 | **ASOL `claim_mint_esms` integration** | Verified | `mintSolanaDestination` in [`feeder/bridge-service.ts`](../feeder/bridge-service.ts) fails closed by design. Needs ASOL's account layout + claim-receipt PDA seeds, and a decision on who signs — most likely an ASOL-side relayer so the mint authority never leaves ASOL. Guessing the layout yields a bridge that fails *after* the source burn settles. |
| 1.2 | **ASOL devnet cluster domain** | Verified | Only `sha256("ASOL_MAINNET_V1")` is published. Devnet's tag is unset in [`src/web3/chains.js`](../src/web3/chains.js) rather than guessed — a wrong domain fails signature verification silently. Read `ProgramConfig.cluster_domain` on chain, or get it from the ASOL repo. |
| 1.3 | ~~Publish the module schema~~ | Verified | **Done.** Prod `pentacles` runs exactly the module built from `main` at `3b01527`: the Keccak-256 of the wasm equals `st_module.program_hash` (checked 2026-10-14). The appended `BridgeChain` variants are live. |
| 1.4 | **Regenerate the Unity bindings** | Verified | The TypeScript bindings are current (`bun run gen`, which now passes `--include-private` so the feeder can read private tables). `unity/Assets/Autogen` is not: generating C# from the current module adds 85 files, changes 42 and drops 15 (removed reducers and private tables), among them the private `OracleRequest` / `OracleReply` that `unity/OraclePanel.cs` reads. A player can't read those tables, so move `OraclePanel` to the `my_oracle_request` / `my_oracle_reply` views in the same change and build it in Unity. There was no Unity editor on the dev Mac at this sweep. |
| 1.5 | **Redeploy `pentacles_solana` to devnet** | Verified | The instruction set changed (ESMS issuance removed, `unstake_star_usdc` added), so the running deployment is stale. Its 18-decimal mints are retired in place. |
| 1.6 | **Move upgrade authority to Squads v4** | Recorded | Still the plain devnet keypair `AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5`. Must be a Squads vault before any mainnet deploy. |
| 1.7 | **Provision Cloud KMS** | Verified | Set `AWS_KMS_KEY_ID` or `GCP_KMS_KEY_NAME` plus `SOLANA_SERVICE_PUBLIC_KEY`. The signer refuses an in-memory keypair on mainnet regardless of `NODE_ENV`, so this is a hard gate, not advice. |
| 1.8 | **Deploy to mainnet + initialize StarVault** | — | `initialize_game_authority` → `configure_star_vault` (Merkle root + rate ceiling) → `activate_star` per star. The rate ceiling bounds a compromised attestor's maximum claim, so pick it deliberately. |

### Also needed before mainnet

| Item | Status | Notes |
| :-- | :-- | :-- |
| **Restore the verifiable build** | Verified | A `proc_macro2` conflict forces `anchor build --no-idl`, so no IDL ships and `solana-verify` / explorer verification is degraded. |
| **Star activation Merkle tree** | Verified | `activate_star` verifies a proof, but nothing builds the tree yet. Needs a generator over the 8,870 `star_node` rows using `@openzeppelin/merkle-tree` with `uint32` leaves. The leaf hash is already pinned across Rust and JS, so the two cannot drift. |
| **starUSDC LST mint** | Verified | Not deployed. `VITE_SOLANA_STARUSDC_MINT` is blank and the UI disables receipt transfers with an explicit message rather than simulating them. The transfer hook and `ExtraAccountMetaList` instruction exist and are unused. |
| **Solana relayer endpoint** | Verified | `VITE_SOLANA_RELAYER_URL` is blank, so Solana ESMS spending is off. Needs an `/api/solana/redeem` that submits ASOL `redeem_for_esms` — the Solana analogue of the existing EVM `redeemFor` path in [`settlement/esms-redeemer.js`](../settlement/esms-redeemer.js). Until it exists, a Jing cast spends only the game-side `jing_pool`: the agent page's on-chain burn call was removed because nothing defined it. |

---

## 2. Base Sepolia / EVM

| Item | Status | Notes |
| :-- | :-- | :-- |
| **`MINTER_ROLE` on EsmsToken** | Recorded | [`TESTNET_DEPLOYMENT.md`](TESTNET_DEPLOYMENT.md) records this as a known blocker: the Railway signer holds no `MINTER_ROLE`, so Solana→EVM destination minting and a full live bridge test stay disabled. [`scripts/grant-minter-role.mjs`](../scripts/grant-minter-role.mjs) exists to grant it. **Verify the role on chain — never infer it from the address having gas.** |
| **Gas for the settlement wallet** | Recorded | ~0.01–0.05 Base Sepolia ETH to `0x553C2a3f193d5E7F41cF50cEB32069dbc6951931`. |
| **Base mainnet contracts** | — | `EvmBaseMainnet` exists in the chain enum but nothing is deployed there. ESMS, Constellation AMM and Deed are Base Sepolia only. |

---

## 3. SpacetimeDB module

| Item | Status | Notes |
| :-- | :-- | :-- |
| **`processed_tx` composite key** | Verified | Idempotency is now scoped by composing `{chain}:{hash}` into the existing `tx_hash` primary key, with a fallback lookup on the bare hash for pre-scoping rows. A genuine composite key would be cleaner but 2.x cannot re-key a table in a compatible update — revisit only if a wipe-and-reseed is on the table anyway. |
| **Oracle round trip on prod** | Re-check | The feeder answers `oracle_request` through the private-table bindings, and players read replies through `my_oracle_reply`. No question has been asked on `pentacles` yet, so the round trip is unverified there: ask one from an agent page and watch for the reply. |
| **Erode's second ESMS in `jing_cast`** | Verified | `drain_pool` charges Erode both Essence and Matter (matching `constants.ts` and `tests/fixtures/jing-costs.json`), but `JingCast.cost_esms` records only Essence. Recording both needs a schema change. |
| **Players from `pentacles1`** | Recorded | Prod moved to the `pentacles` database on 2026-10-14. Its 71 players are the seeded historical agents; the human players and cards on `pentacles1` (now paused) were not migrated. Decide whether to migrate them or treat the move as a fresh start. |
| **`GameAuthority` layout change** | Verified | The struct changed (epoch-mint fields dropped, `usdc_mint` / `star_root` / rate ceiling added). Borsh tolerates trailing bytes so an existing account still deserializes, but the devnet PDA holds meaningless values until re-initialized. Fold into 1.5. |

---

## 4. Repo hygiene

| Item | Status | Notes |
| :-- | :-- | :-- |
| **Unmerged branches** | Verified | Every branch on origin with commits outside `main` was squash-merged, apart from PRs #58 and #61 (closed unmerged), `feat/alchm-vessel-drawer` (superseded by #68 and #69), `release/v0.1.1-pre-migration` (a snapshot) and the June-era `claude/serene-turing-SJeCA` and local `claude/cool-archimedes-XgDVn`, which also has a stash. The merged branches can be deleted; the others are a keep-or-drop call. |
| **Vendor `alchm-astro-core`** | Verified | [`server/Cargo.toml`](../server/Cargo.toml) resolves it through `../../../AlchmAgentsSolana/alchm-astro-core`. Repointed this pass because the old path no longer existed and the module could not build at all — but a clean checkout on another machine still cannot build it. Vendor or publish the crate. |
| **Bundle size** | Verified | `main.js` is 735 kB and `render-dome.js` 585 kB, both over the 500 kB warning. Non-blocking; the dome already lazy-loads Three. |

---

## 5. Product / UI

| Item | Status | Notes |
| :-- | :-- | :-- |
| **Star receipt trading UI** | Verified | `trade(starId)` opens the swap panel, but liquid star receipts have no market until the starUSDC mint exists. Gated on the LST mint above. |
| **AR flux countdown** | Recorded | [`AR_FLUX_STITCH_HANDOFF.md`](AR_FLUX_STITCH_HANDOFF.md) asks for a countdown driven by `fluxExpiresAt`; not implemented. |
| **Yield claim UX** | Verified | `claimYield` now locks the position and leaves settlement to the feeder — correct, but the UI says "shortly" and shows no pending state. Once the claim feeder exists, surface `pending_essence` and the 600 s release window. |

---

## 6. Not started

Named so they are not mistaken for done. None are blocking.

- **Constellation AMM on Solana.** ASOL Phase 6 territory. Pentacles' AMM is Base Sepolia only; there is no Solana pool, deed or swap.
- **StarVault yield claim instruction.** The program accrues `accrued_cap` but has no `claim_star_yield`. Claims currently settle only through the ledger, and the on-chain cap is unspent — which is why 1.1 and the attestor design should land together.
- **Squads v4 proposal tooling.** ASOL has a runbook script; Pentacles has no equivalent.
