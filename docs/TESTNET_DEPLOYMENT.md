# Pentacles Testnet Deployment Runbook

This runbook records the deployment verified on **2026-07-24**. Every chain
resource below is test infrastructure: Solana **Devnet**, Base **Sepolia**,
SpacetimeDB **Maincloud**, and the Railway `production` environment used for
always-on testnet workers. It is not a mainnet release.

Never commit wallet secret keys, bearer tokens, or provider API keys. The public
addresses in this document are safe to commit.

## Verified resources

### Solana Devnet

| Resource | Address |
| --- | --- |
| Anchor program | `7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R` |
| Upgrade/deployment authority | `AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5` |
| GameAuthority PDA | `4fhbhdU5yhn572eBbhrDu1axHFsYQhxF2S1oXWtb4Ns2` |
| Spirit mint | `EvkLzWbvRk9iXHcqCkMDAwjAJ85gb6UsVGcTqof8e5Wg` |
| Essence mint | `28CtdwBtjoUuMffxvZbz684ZY2TG4N4LyWWu6RETq2mo` |
| Matter mint | `HG9JbHntZrQ4x9uaMhGsMYCrLUWeJLrYNpRqWPMZryAf` |
| Substance mint | `7eC5Jj9B1BTiX92BSUUeUmdYMQFHq6cMdMLPRimC6pCD` |

The program was last verified at deployment slot `478648125`. The same program
ID must appear in `Anchor.toml`,
`programs/pentacles-solana/src/lib.rs`, `.env`, and `.env.local`.

### SpacetimeDB Maincloud

| Resource | Value |
| --- | --- |
| Host | `https://maincloud.spacetimedb.com` |
| Database | `cookingwithcastrollc` |
| Owner identity | `0xc2007058fefb90b9ffcd33379c03d135cbecadda7b901575d9b8ed8ca06ddb52` |

The 2026-07-24 publish completed as a compatible module update. A pre-publish
backup captured 9,372 rows; the post-publish smoke found 49 tables, 11 zones,
and 8,870 stars. TypeScript bindings in `src/module_bindings` and C# bindings in
`unity/Assets/Autogen` were regenerated from that published schema during the
same release.

### Railway feeder network

| Resource | Value |
| --- | --- |
| Project | `passionate-vibrancy` (`79c2e926-15f1-49a1-88ee-8c3870adcc8f`) |
| Environment | `production` (`5d22eec1-085f-4588-904d-7f05e79dd953`) |
| Service | `pentacles-feeders` (`3edd3365-fcbc-4425-8489-e6e0c00f5753`) |
| Verified deployment | `2b08aa1f-841e-4a1a-9782-593329d7768c` |
| Build | `DOCKERFILE`, path `feeder/Dockerfile`, repository-root context |

The verified deployment reports all seven children healthy.

### Base Sepolia

| Resource | Address |
| --- | --- |
| ESMS token | `0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F` |
| Constellation AMM | `0x6B4EE164320e9E5583C0F6BEe14D5BABb5ba5095` |
| Constellation deed | `0x34eAC0fe797df2889d9dc59Cb98dCe24154BB9B6` |

**Known blocker:** the disposable Railway test signer does not hold the ESMS
contract's `MINTER_ROLE` and has no ESMS balance. Solana-to-EVM destination
minting and a complete live bridge burn-finalization test must remain disabled
until an administrator either grants that role to a funded test signer or
installs an already-authorized signer. Do not enqueue a bridge transfer merely
to test this condition; it would create a knowingly unserviceable row.

## Required environment

Start from `.env.example`. Public network values and mint addresses are already
filled in. Supply secrets only through ignored local files or the Railway
environment:

- `SPACETIME_TOKEN`: Maincloud owner bearer token.
- `SOLANA_MINTER_SECRET_KEY`: JSON byte array for the authorized Devnet signer.
- `REDEEMER_PRIVATE_KEY`: Base Sepolia signer with the required burn role.
- `MINTER_PRIVATE_KEY`: Base Sepolia signer with `MINTER_ROLE`.
- `ANTHROPIC_API_KEY` and `ATTESTOR_PRIVATE_KEY`: worker-specific server secrets.
- `AMM_CONTRACT_ADDRESS` and `ESMS_TOKEN`: public Base Sepolia contract
  addresses used by the attestor and bridge.
- `PLANETARY_AGENTS_BACKEND_URL`, `BRAIN_FALLBACK_URL`, and
  `WTEN_BACKEND_URL`: companion-service and health-probe endpoints.

Before enabling EVM settlement, derive each configured public address from its
private key and query the relevant on-chain role. Never infer authorization from
the address having gas.

## Solana release

```bash
solana config set --url devnet
test -f ~/.config/solana/id.json ||
  solana-keygen new --no-bip39-passphrase -o ~/.config/solana/id.json
solana address
solana balance
```

Fund only through the Devnet faucet. Verify the deploy keypair and source IDs:

```bash
solana-keygen pubkey target/deploy/pentacles_solana-keypair.json
rg '7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R' \
  Anchor.toml programs/pentacles-solana/src/lib.rs .env .env.local
```

With the current Anchor 0.30.1 toolchain, IDL generation encounters a
`proc_macro2` compatibility conflict, so the verified release build skips IDL:

```bash
# Optional dry preparation: reads the deployment wallet, creates any missing
# local mint keypairs, and prints public addresses without RPC or env writes.
bun scripts/init-solana-devnet.mjs --prepare-only

anchor build --no-idl
anchor deploy --provider.cluster devnet
bun scripts/init-solana-devnet.mjs
```

The initializer is idempotent. Run it a second time and confirm it reports the
existing GameAuthority and all four mints rather than creating replacements.

```bash
solana program show \
  7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R --url devnet
bun test tests/pentacles-solana.test.ts
```

## SpacetimeDB release and binding sync

Authenticate as the database owner and use the safe cutover workflow:

```bash
spacetime list
./scripts/prod-cutover.sh preflight
./scripts/prod-cutover.sh backup
./scripts/prod-cutover.sh publish
./scripts/prod-cutover.sh verify
```

The cutover script deliberately omits `--delete-data`. If a schema change is
incompatible, it stops instead of wiping Maincloud. The explicit
`spacetime publish -y --delete-data=on-conflict cookingwithcastrollc` command
used during the verified session is acceptable only after a reviewed backup and
when data loss has been explicitly authorized.

After every schema publish, regenerate both clients from the repository root:

```bash
bun run gen
spacetime generate --lang csharp --module-path server \
  --out-dir unity/Assets/Autogen -y
git diff -- src/module_bindings unity/Assets/Autogen
```

## Railway feeder release

The Dockerfile copies root bindings and feeder sources, so deploy from the
repository root. Persist the builder selection before uploading:

```bash
railway status
railway variable set --service pentacles-feeders --environment production \
  SPACETIMEDB_URI=https://maincloud.spacetimedb.com \
  SPACETIMEDB_DB=cookingwithcastrollc \
  SOLANA_RPC_URL=https://api.devnet.solana.com \
  SOLANA_PROGRAM_ID=7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R \
  SOLANA_MINT_SPIRIT=EvkLzWbvRk9iXHcqCkMDAwjAJ85gb6UsVGcTqof8e5Wg \
  SOLANA_MINT_ESSENCE=28CtdwBtjoUuMffxvZbz684ZY2TG4N4LyWWu6RETq2mo \
  SOLANA_MINT_MATTER=HG9JbHntZrQ4x9uaMhGsMYCrLUWeJLrYNpRqWPMZryAf \
  SOLANA_MINT_SUBSTANCE=7eC5Jj9B1BTiX92BSUUeUmdYMQFHq6cMdMLPRimC6pCD \
  AMM_CONTRACT_ADDRESS=0x6B4EE164320e9E5583C0F6BEe14D5BABb5ba5095 \
  ESMS_TOKEN=0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F
railway environment edit --environment production \
  --service-config pentacles-feeders \
  build.builder DOCKERFILE
railway environment edit --environment production \
  --service-config pentacles-feeders \
  build.dockerfilePath feeder/Dockerfile
railway up --service pentacles-feeders --environment production \
  --detach -m "Deploy Pentacles testnet feeders"
```

Set secret values from exported shell variables or another non-logging secret
source, never as literal command-line text. Do not install `MINTER_PRIVATE_KEY`
until its derived address passes the Base Sepolia role check.

Poll until the newest deployment is `SUCCESS`, then inspect bounded logs:

```bash
railway deployment list --service pentacles-feeders \
  --environment production --limit 3 --json
railway logs --service pentacles-feeders \
  --environment production --lines 160
```

Acceptance requires:

- `supervising 7 feeders`
- `Listening for Token-2022 events`
- `feeders 7/7 children up`
- no repeating authentication, reducer, or child-restart errors

## End-to-end verification

Run the local contract and regression suite:

```bash
bun run test:omnichain
bun run test:gameplay
bun run build
```

The omnichain command includes the lossless Solana `u64` regression. A live
mint must use an amount above JavaScript's safe-integer limit so accidental
`Number` conversion is detectable. The verified post-deploy transaction was:

```text
signature: 5uXgdg8PkiFpv9umgQaQC9Ui1ndYwH2ZVWidQ9C2WD7zQxJuwxMJktbYPWcDy2s2csMBGiBqsQAbwZpUooibBEsA
amount:    9007199254740993
chain:     solana_token_2022
event:     mint
```

The verified release observed the following row in Maincloud `processed_tx` at
`2026-07-24T22:14:51.961144+00:00`:

```bash
spacetime sql cookingwithcastrollc \
  "SELECT * FROM processed_tx WHERE tx_hash = '5uXgdg8PkiFpv9umgQaQC9Ui1ndYwH2ZVWidQ9C2WD7zQxJuwxMJktbYPWcDy2s2csMBGiBqsQAbwZpUooibBEsA'"
```

An authenticated replay of the exact same `sync_solana_event` call returned
HTTP 530 with `Transaction already processed`. That observed rejection is the
idempotency proof. The `jing_pool.updated_at` value matched the processed
transaction timestamp, confirming table synchronization.

Use the named package scripts above rather than raw `bun test` for the complete
suite. Bun's broad discovery also executes the Node-oriented
`gameplay-contract.test.mjs` under Bun, where its `process.execPath --check`
probe has different semantics. `bun run test:gameplay` deliberately runs that
harness with Node. The production build currently emits non-blocking warnings
for missing optional DEX UI exports and large chunks; a successful exit remains
the release gate.

Do not mark the dual-chain bridge smoke complete until the Base Sepolia role
blocker above is resolved and both the source burn and destination mint have
finalized on their respective explorers.
