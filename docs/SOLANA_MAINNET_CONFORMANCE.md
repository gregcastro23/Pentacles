# Pentacles → Solana Mainnet Conformance

**Status:** prep complete, not deployed. Nothing in this pass touches a live
cluster or the production SpacetimeDB module. Every cutover step below is a
separate, deliberate act.

**Branch:** `feat/solana-mainnet-conformance`

This records how Pentacles was brought in line with the AlchmAgentsSolana (ASOL)
mainnet standard, what changed, and what is still open.

---

## 1. The decision that shaped everything

**ASOL is the sole ESMS issuer on Solana.** Pentacles no longer mints, burns or
slashes ESMS; `asol_program`'s four Token-2022 mints are the only ESMS on any
Solana cluster.

This was not primarily a tidiness decision. Pentacles issued ESMS at **18
decimals** against Token-2022's `u64` amount field:

```
(2^64 - 1) / 10^18  ≈  18.45
```

A single token account could hold at most ~18.45 ESMS, ever. The bridge already
rejected any transfer above `u64::MAX`, so bridging more than ~18.45 ESMS from
the 18-decimal ERC-1155 on Base was impossible by construction — a ceiling that
would have surfaced on the first serious mainnet transfer. ASOL issues at **4
decimals**, where the same `u64` holds over 10^15 whole tokens.

The extensions mattered too. ASOL's mints carry `NonTransferable`,
`PermissionedBurn`, `PermanentDelegate` and `MetadataPointer`. Pentacles' carried
none — so `slash_cheater` described the game authority as a Permanent Delegate on
mints that had no such extension, and would have failed on any real attempt.

---

## 2. Unit boundary

Pentacles' authoritative ledger stays at **18 decimals**, matching the Base
ERC-1155 whose `uint256` balances have no practical ceiling. Solana is 4
decimals. Everything crossing between them goes through
[`src/web3/esms-units.js`](../src/web3/esms-units.js), with the module-side
equivalents in `server/src/reducers.rs`.

| Direction | Factor | Exactness |
| --- | --- | --- |
| 4-dp atoms → 18-dp ledger | × 10^14 | always exact (widening) |
| 18-dp ledger → 4-dp atoms | ÷ 10^14 | **not** always exact |

Narrowing discards 14 digits, so one wei of ESMS is simply not representable on
Solana. Two functions, deliberately distinct:

- `toSolanaAtomsExact` — refuses a value with any remainder. Use on settlement
  paths where a partial transfer would desynchronise the ledgers.
- `splitForSolana` — returns `{ atoms, dust }` so a caller can leave the
  remainder credited. Use where carrying it forward is correct.

There is no third option that silently truncates. `confirm_yield_claim` uses the
split form: the sub-atom remainder returns to `accrued_essence` rather than being
written off as claimed.

**No JS numbers cross this boundary.** `toBigIntStrict` rejects a `number`
argument even when it is a safe integer — accepting one is what lets a stray
coercion upstream go unnoticed until a balance is wrong.

---

#### Solana program (`programs/pentacles-solana/src/lib.rs`)

Retired: `initialize_element_mint`, `mint_esms_rewards`, `bridge_mint_esms`,
`burn_esms_for_jing`, `bridge_burn_esms`, `slash_cheater`, and the
`BridgeMintReceipt` account.

Added / fixed (Hardened via Phase 5 StarVault Review):

- **`unstake_star_usdc`.** The previous program had **no withdrawal path at
  all** — USDC transferred into a star vault was permanently unrecoverable on
  chain. It is unconditional: no pause flag, no admin gate.
- **Infallible saturating checkpoint (P1).** `checkpoint_position` is infallible,
  using `saturating_mul` and `saturating_add` and clamping `u128` narrowing to
  `u64::MAX`. An accounting overflow cannot brick or hold user withdrawals hostage.
  Enforced by rate ceiling `MAX_RATE_ATOMS_PER_USDC_DAY = 1_000_000_0000` (100k ESMS/USDC/day).
- **Forward-only yield accumulator (P2).** `GameAuthority` maintains a global
  `yield_index: u128` and `index_updated_at: i64`. `configure_star_vault` settles
  the index to `now` at the old rate before updating the rate ceiling. `StakePosition`
  stores `index_snapshot: u128`, making rate changes forward-only by construction
  without per-position sweeps.
- **Authority rotation & rent reclamation.** Added `set_game_authority` (gated on
  current authority, rejecting default pubkey) and `close_stake_position` (gated on
  `principal == 0 && accrued_cap == 0`, closing account to staker).
- **Token-2022 mint extension validation (P4).** `validate_vault_usdc_mint` passes
  classic SPL Token through and parses Token-2022 TLV regions from byte 166,
  rejecting `TransferFeeConfig` (1), `PermanentDelegate` (12), and `TransferHook` (14).
- **Proof depth bound (P7).** `activate_star` enforces `proof.len() <= MAX_STAR_PROOF_DEPTH` (32).
- **Real state.** `GameAuthority`, `StarPool`, `StakePosition` replace an
  instruction that transferred USDC and only logged the amount.
- **`activate_star`** with OpenZeppelin `StandardMerkleTree` proof over a `uint32`
  star id. The leaf hash is pinned against a value computed in JS
  (`star_leaf_matches_openzeppelin_standard_merkle_tree`) so the two languages
  cannot drift.
- **Typed events** (`emit!`) replacing `msg!` strings, with applied pool delta in
  `StarUnstaked` to make saturating clamps observable.
- All accrual arithmetic in checked/saturating `u128`.

11 Rust unit tests, all passing.

### SpacetimeDB module (`server/`)

- **`BridgeChain`** gained `EvmBaseMainnet` and `SolanaMainnetToken2022`.
  Existing variants are untouched and keep their ordinals — `SolanaToken2022`
  still means *devnet*, because every settled row carrying it is a devnet row.
  Relabelling it would retroactively move history onto a chain it never touched.
- **Chain-scoped idempotency.** `processed_tx` is keyed on `tx_hash` alone, which
  was safe only while one Solana cluster existed; a base58 signature is valid on
  both. `ensure_unprocessed` now composes `{chain}:{hash}` *and* still checks the
  bare hash, so pre-existing devnet rows stay protected against replay. The
  primary key itself is unchanged — SpacetimeDB 2.x cannot re-key a table in a
  compatible update.
- **Precision leak fixed.** The yield accrual ended in `(gained * 1e18) as u128`
  — an 18-decimal value needs ~60 bits and an f64 mantissa holds 53, so the low
  digits of *every* accrual were rounding noise, compounding on a column that is
  meant to be an exact balance. The rate is genuinely floating point
  (altitude × dominance × affinity × dignity), so it is now quantized to an
  integer at that boundary and every step after is exact `u128`.
- **Auth gates.** Three reducers were callable by anyone:

  | Reducer | Was | Now |
  | --- | --- | --- |
  | `record_star_stake` | client declared its own principal and shares | owner-gated, keyed on the staking signature, staker resolved from the verified wallet |
  | `confirm_yield_claim` | any caller, any string as `tx_hash` | owner-gated, validated signature, chain-scoped |
  | `cancel_stale_claim` | no caller check, no staleness check despite the doc comment | stake owner or module owner, 600 s lock enforced |

  Nothing minted from `accrued_essence`, so no value was at risk on devnet. The
  exposure was structural: wiring a mainnet claim feeder to that number turns a
  self-declared principal directly into an unbounded mint.

### Off-chain hardening

| Area | File |
| --- | --- |
| CAIP-2 chain registry, ASOL constants, PDA derivation | `src/web3/chains.js` |
| Lossless 18↔4 decimal boundary | `src/web3/esms-units.js` |
| Profiled CU limits + 65th-percentile priority fees | `src/web3/priority-fee.js` |
| Cloud KMS signer (AWS/GCP) with mainnet guard | `feeder/solana-signer.ts` |
| Cluster resolution, genesis guard, 3-tier ingestion | `feeder/solana-cluster.ts` |
| Structural event decoding, program-ID scoping, balance-delta ESMS reads | `feeder/solana-sync-service.ts` |
| Event discriminators and Borsh layout pinning | `tests/solana-instructions.test.ts` |

Notes worth keeping in mind:

- **ESMS mint addresses are derived, not configured.** They are PDAs at
  `[b"esms_mint", &[element_id]]` of ASOL's program id, identical on every
  cluster. Verified against the four addresses in the ASOL Phase 4 runbook.
- **The cluster is declared, then proven.** `SOLANA_CLUSTER` states intent;
  `assertGenesis` compares the live genesis hash before the first signature. An
  RPC URL typo cannot silently redirect settlement.
- **Polling runs permanently**, not only as a fallback. `onLogs` truncates the
  log array on transactions that exceed the per-transaction log byte limit, and
  a socket can drop between heartbeats — in both cases nothing errors and the
  event is simply never delivered.
- **The signer refuses an in-memory keypair on mainnet**, independent of
  `NODE_ENV`. What makes a hot key dangerous is the cluster it settles on.
- **Feeder event scoping by program ID (P3).** `decodeAnchorEvents` parses the
  Solana log frame stack (`Program <id> invoke` / `Program <id> success`), preventing
  cross-program event collisions on shared clusters when same-named Anchor events
  are emitted.

### Client

`buildBurnEsmsInstruction` / `buildBridgeBurnEsmsInstruction` are gone. They
built a plain Token-2022 `Burn` with the holder as authority, which ASOL's
`PermissionedBurn` mints reject — that call would have *failed on chain*, not
merely been unauthorised. Burning now builds an `ASOL_ESMS_REDEEM_V1` detached
authorization for a relayer to submit.

Three fake-settlement paths in `src/web3/pools-ui.js` were removed:

- `stake` called `record_star_stake` with **four arguments to a three-argument
  reducer** and a client-chosen principal. It now sends the real
  `stake_star_usdc` transaction.
- `claimYield` called `confirm_yield_claim` with `'sol_claim_tx_' + Date.now()`
  as the transaction hash and a hardcoded stake id of `1` — settling whichever
  position happened to be first in the table. It now locks the caller's own
  position and leaves settlement to the feeder.
- `transfer` called `transfer_star_stake` with a fabricated hash, a hardcoded
  amount of `1000`, and a literal placeholder sender when no wallet was
  connected. It now sends a real starUSDC transfer so the hook fires.

`unstake` is new — there was no way to withdraw.

### Repo

`server/Cargo.toml` pointed `alchm-astro-core` at
`EthGlobalHackathon/AlchmAgentsETH-main/`, a directory that no longer exists.
**The module could not build at all.** Repointed to
`../../../AlchmAgentsSolana/alchm-astro-core`.

---

## 4. Verification

| Suite | Result |
| --- | --- |
| `cargo test` (Solana program) | 11 passed |
| `cargo check` (SpacetimeDB module) | clean |
| `bun test tests/` | 36 passed |
| `bun run test:omnichain` | 5 groups passed |
| `bun run test:gameplay` | passed |
| `bun scripts/dryrun-star-staking.test.mjs` | 4 passed |
| `bun run build` | passed |

---

## 5. Open items

Ordered by what blocks what. These are the Solana-specific ones;
[`PENDING.md`](PENDING.md) tracks all outstanding Pentacles work, including the
EVM, module and hygiene items this pass did not touch.

1. **ASOL claim/redeem integration.** `mintSolanaDestination` fails closed with
   an explicit error. ASOL Phase 5 introduced a second ESMS mint path:
   `claim_star_yield`, whose replay protection is a per-position `claim_nonce`
   rather than a receipt PDA (unlike `claim_mint_esms`). Any feeder reconciling
   ASOL mints must handle both. Until ASOL PR 3 ships, there are no ASOL events
   to reconcile against — only Token-2022 balance deltas, which carry no star id,
   position, or nonce.

2. **Feeder discriminator collision with ASOL (P3).** Solved on the Pentacles side
   by parsing the Solana `Program <id> invoke` / `success` frame stack in
   `decodeAnchorEvents`. Once ASOL deploys PR 3, both programs emit same-named
   events (`StarStaked`, `StarUnstaked`, `StarActivated`) with byte-identical
   Anchor discriminators; program-ID scoping ensures the feeder only processes
   Pentacles' events.

3. **Shared P1 & P2 remediations.** Note that P1 (fallible withdrawal checkpoint)
   and P2 (retroactive rate increases) were shared findings across both Pentacles
   and ASOL, fixed in parallel in both codebases via infallible saturating accruals
   and global accumulator indices.

4. **ASOL devnet cluster domain.** Only the mainnet value
   (`sha256("ASOL_MAINNET_V1")`) is published. Devnet's is unset rather than
   guessed: a wrong domain yields a signature that fails verification with no
   useful error.

5. **Module schema publish.** The `BridgeChain` variants and the reducer
   signature changes need a publish. Run `./scripts/prod-cutover.sh preflight`
   and `backup` first. Variants were **appended** so existing tags keep their
   ordinals, but confirm 2.x treats it as a compatible update before touching
   production — this pass deliberately did not.

6. **Devnet redeploy.** The program's instruction set changed, so the running
   devnet deployment is stale. Its 18-decimal mints are retired in place. Regenerate
   bindings (`bun run gen`) after publishing the module.

7. **Squads v4 upgrade authority.** Still a plain devnet keypair
   (`AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5`). Must move to a Squads vault
   before any mainnet deploy.

8. **Verifiable build.** `anchor build --no-idl` is used because of a
   `proc_macro2` conflict, so no IDL is published and `solana-verify` /
   explorer verification is degraded. Resolve before mainnet.

9. **`alchm-astro-core` still resolves through an absolute-ish path outside the
   repo.** A clean checkout on another machine cannot build the module. Vendor or
   publish it.

10. **starUSDC LST mint** is not deployed. Receipt transfers are disabled with an
    explicit message rather than simulated.

11. **Untracked duplicate.** `public/star-pokedex-ui 2.js` is a Finder-copy
    artifact sitting next to a modified `public/star-pokedex-ui.js`. Unrelated to
    this work, but resolve it before cutting a release branch.

---

## 6. Cutover order

```
1. Publish the module        (preflight → backup → publish → verify)
2. bun run gen               (regenerate TS + C# bindings)
3. anchor build && deploy to devnet, re-run the suites live
4. Wire ASOL claim/redeem (open item 1), then re-run the bridge end to end
5. Move upgrade authority to a Squads v4 vault
6. Provision Cloud KMS; set SOLANA_CLUSTER=mainnet-beta
7. Deploy to mainnet, verify the build, initialize the StarVault
```

Step 6 is where the guards start biting: the signer refuses to start on mainnet
without a KMS key, and `assertGenesis` refuses to start if the RPC does not
actually serve mainnet-beta. Both failures are loud and happen before the first
signature.
