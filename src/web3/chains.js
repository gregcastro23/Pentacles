// ============================================================
// Pentacles — CAIP-2 chain registry & Solana cluster identity
// ============================================================
// One source of truth for "which chain is this?", shared by the Vite client,
// the Bun feeders and the deploy scripts. Deliberately env-free and
// side-effect-free: callers resolve their own env (import.meta.env in the
// browser, process.env in Bun) and pass the result in. That keeps this module
// importable from every runtime without a build-time branch.
//
// Chain identity is CAIP-2 (`namespace:reference`) to match the AlchmAgentsSolana
// (ASOL) ledger, whose every claim and redemption carries an immutable target
// chain. Pentacles' own `BridgeChain` enum predates that model and names
// testnets directly; `bridgeChainToCaip2()` maps the legacy variants forward so
// the two ledgers can be reconciled without a lossy rename.

import { Buffer } from 'buffer'
import { PublicKey } from '@solana/web3.js'

// ── CAIP-2 chain ids ────────────────────────────────────────────────────────

export const CAIP2 = Object.freeze({
  baseSepolia: 'eip155:84532',
  baseMainnet: 'eip155:8453',
  solanaDevnet: 'solana:devnet',
  solanaMainnet: 'solana:mainnet-beta',
})

/** Every chain Pentacles settles on, keyed by CAIP-2 id. */
export const CHAINS = Object.freeze({
  [CAIP2.baseSepolia]: Object.freeze({
    caip2: CAIP2.baseSepolia,
    namespace: 'eip155',
    name: 'Base Sepolia',
    evmChainId: 84532,
    testnet: true,
    explorer: 'https://sepolia.basescan.org',
    defaultRpc: 'https://sepolia.base.org',
  }),
  [CAIP2.baseMainnet]: Object.freeze({
    caip2: CAIP2.baseMainnet,
    namespace: 'eip155',
    name: 'Base',
    evmChainId: 8453,
    testnet: false,
    explorer: 'https://basescan.org',
    defaultRpc: 'https://mainnet.base.org',
  }),
  [CAIP2.solanaDevnet]: Object.freeze({
    caip2: CAIP2.solanaDevnet,
    namespace: 'solana',
    name: 'Solana Devnet',
    cluster: 'devnet',
    testnet: true,
    // `solana genesis-hash --url devnet`. The deploy guard compares the live
    // cluster against this so a mainnet-shaped command can never land on the
    // wrong network (or the reverse) merely because an RPC URL was edited.
    genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
    explorer: 'https://explorer.solana.com',
    explorerQuery: '?cluster=devnet',
    defaultRpc: 'https://api.devnet.solana.com',
  }),
  [CAIP2.solanaMainnet]: Object.freeze({
    caip2: CAIP2.solanaMainnet,
    namespace: 'solana',
    name: 'Solana Mainnet-Beta',
    cluster: 'mainnet-beta',
    testnet: false,
    genesisHash: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
    explorer: 'https://explorer.solana.com',
    explorerQuery: '',
    defaultRpc: 'https://api.mainnet-beta.solana.com',
  }),
})

/** Look up a chain by CAIP-2 id. Throws on an unknown id rather than guessing. */
export function chainFor(caip2) {
  const chain = CHAINS[caip2]
  if (!chain) throw new Error(`Unknown chain id ${caip2}`)
  return chain
}

/** True when the chain settles real value. Drives every production guard. */
export function isMainnet(caip2) {
  return !chainFor(caip2).testnet
}

/** Explorer URL for a transaction on any registered chain. */
export function txUrl(caip2, hash) {
  const chain = chainFor(caip2)
  return chain.namespace === 'solana'
    ? `${chain.explorer}/tx/${hash}${chain.explorerQuery}`
    : `${chain.explorer}/tx/${hash}`
}

/** Explorer URL for an address on any registered chain. */
export function addrUrl(caip2, address) {
  const chain = chainFor(caip2)
  return chain.namespace === 'solana'
    ? `${chain.explorer}/address/${address}${chain.explorerQuery}`
    : `${chain.explorer}/address/${address}`
}

// ── Legacy BridgeChain interop ──────────────────────────────────────────────
//
// `server/src/types.rs` declares `BridgeChain { EvmBaseSepolia, SolanaToken2022 }`.
// Those two variants hardcode a testnet in their names and carry no cluster, so
// they cannot express "Solana mainnet". The module keeps them (SpacetimeDB 2.x
// cannot rename or drop) and gains explicit mainnet variants; these maps are the
// bridge between the enum and CAIP-2 for as long as both exist.

export const BRIDGE_CHAIN_TO_CAIP2 = Object.freeze({
  EvmBaseSepolia: CAIP2.baseSepolia,
  EvmBaseMainnet: CAIP2.baseMainnet,
  SolanaToken2022: CAIP2.solanaDevnet,
  SolanaMainnetToken2022: CAIP2.solanaMainnet,
})

export const CAIP2_TO_BRIDGE_CHAIN = Object.freeze(
  Object.fromEntries(Object.entries(BRIDGE_CHAIN_TO_CAIP2).map(([k, v]) => [v, k])),
)

/**
 * Map a `BridgeChain` enum variant to its CAIP-2 id.
 *
 * `SolanaToken2022` is the pre-mainnet variant and resolves to devnet: at the
 * time it was written devnet was the only Solana cluster Pentacles settled on,
 * so every historical row bearing it IS a devnet row. Reading it as anything
 * else would retroactively relabel settled history.
 */
export function bridgeChainToCaip2(variant) {
  const caip2 = BRIDGE_CHAIN_TO_CAIP2[variant]
  if (!caip2) throw new Error(`Unknown BridgeChain variant ${variant}`)
  return caip2
}

/** Map a CAIP-2 id back to the `BridgeChain` variant the module expects. */
export function caip2ToBridgeChain(caip2) {
  const variant = CAIP2_TO_BRIDGE_CHAIN[caip2]
  if (!variant) throw new Error(`No BridgeChain variant for ${caip2}`)
  return variant
}

/** The `processed_tx.chain` string for a chain — the module's idempotency key half. */
export function processedTxChain(caip2) {
  return caip2.replace(/[:-]/g, '_')
}

// ── AlchmAgentsSolana (ASOL) — the ESMS issuer ──────────────────────────────
//
// Pentacles does not mint ESMS on Solana. `asol_program` is the sole issuer for
// all four elements on every Solana cluster; Pentacles holds game state, burns
// through ASOL's permissioned path, and runs its own StarVault in USDC.

export const ASOL_PROGRAM_ID = new PublicKey('5QheuqaicKvPPRFEoEXwaE5xaFp7gauvJCfsjpQv8WzD')

/** Squads v4, the multisig that holds ASOL's upgrade and service authorities. */
export const SQUADS_V4_PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pcf')

/**
 * ESMS lives on the mint account at 4 decimals — 10^4 raw atoms per whole
 * token. Token-2022 balances are u64, so this is not a cosmetic choice: at the
 * 18 decimals Pentacles previously used, a single token account could hold at
 * most (2^64-1)/10^18 ≈ 18.45 ESMS, and any bridge transfer above that was
 * unrepresentable. Never derive this from a JSON metadata field — the mint is
 * the source of truth and the JSON only mirrors it.
 */
export const ASOL_ESMS_DECIMALS = 4
export const ASOL_ESMS_ATOMS_PER_TOKEN = 10n ** BigInt(ASOL_ESMS_DECIMALS)

/** Element ids, fixed by the ASOL program and shared with the EVM ERC-1155 ids. */
export const ELEMENT_IDS = Object.freeze({ spirit: 0, essence: 1, matter: 2, substance: 3 })
export const ELEMENT_NAMES = Object.freeze(['Spirit', 'Essence', 'Matter', 'Substance'])

/** The detached-signature challenge domain `redeem_for_esms` verifies against. */
export const ASOL_REDEEM_DOMAIN = 'ASOL_ESMS_REDEEM_V1'

/**
 * ASOL binds every redeem authorization to a 32-byte cluster domain held in its
 * `ProgramConfig`, so a signature harvested on one cluster cannot be replayed
 * on another.
 *
 * Only the mainnet value is known from the ASOL Phase 7 runbook
 * (`sha256("ASOL_MAINNET_V1")`). The devnet deployment's tag is not published,
 * so it is left unset deliberately rather than guessed — a wrong domain
 * produces a signature that fails on-chain verification with no useful error.
 * Supply it via config, or read `ProgramConfig.cluster_domain` on chain.
 */
export const ASOL_CLUSTER_DOMAINS = Object.freeze({
  [CAIP2.solanaMainnet]: '992d8961206c925c44c003870eac1b9def922ccf52c5032f6c6d02b3bf9ad105',
  [CAIP2.solanaDevnet]: null,
})

/** 32-byte cluster domain for a Solana cluster, or an explicit hex override. */
export function asolClusterDomain(caip2, override) {
  const hex = (override || ASOL_CLUSTER_DOMAINS[caip2] || '').replace(/^0x/, '').trim()
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      `No ASOL cluster domain configured for ${caip2}. ` +
        'Set it from ProgramConfig.cluster_domain — a guessed value silently fails verification.',
    )
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'))
}

/**
 * ASOL's ESMS mints are PDAs at `[b"esms_mint", &[element_id]]`, so they are
 * derivable rather than configured. Deriving beats hardcoding twice over: the
 * addresses are identical on every cluster (a PDA depends only on the program
 * id), and a typo in an env var becomes impossible.
 *
 * Verified against the four addresses recorded in the ASOL Phase 4 runbook.
 */
export function asolEsmsMint(elementId, programId = ASOL_PROGRAM_ID) {
  if (!Number.isInteger(elementId) || elementId < 0 || elementId > 3) {
    throw new Error(`Invalid ESMS element id ${elementId}`)
  }
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('esms_mint'), Buffer.from([elementId])],
    programId,
  )
  return pda
}

/** All four ESMS mints, indexed by element id. */
export function asolEsmsMints(programId = ASOL_PROGRAM_ID) {
  return [0, 1, 2, 3].map((id) => asolEsmsMint(id, programId))
}

/** ASOL's `ProgramConfig` PDA — holds the attestor, pauser and cluster domain. */
export function asolProgramConfig(programId = ASOL_PROGRAM_ID) {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from('program_authority')], programId)
  return pda
}

// ── Pentacles' own Solana program ───────────────────────────────────────────

/**
 * `pentacles_solana` keeps game-side custody only: the StarVault USDC pool and
 * the starUSDC transfer hook. Its ESMS mint/burn instructions are retired in
 * favour of ASOL — see docs/SOLANA_MAINNET_CONFORMANCE.md.
 */
export const PENTACLES_PROGRAM_ID = new PublicKey('7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R')

export default {
  CAIP2,
  CHAINS,
  chainFor,
  isMainnet,
  txUrl,
  addrUrl,
  bridgeChainToCaip2,
  caip2ToBridgeChain,
  processedTxChain,
  ASOL_PROGRAM_ID,
  ASOL_ESMS_DECIMALS,
  ASOL_ESMS_ATOMS_PER_TOKEN,
  ASOL_REDEEM_DOMAIN,
  asolEsmsMint,
  asolEsmsMints,
  asolProgramConfig,
  PENTACLES_PROGRAM_ID,
}
