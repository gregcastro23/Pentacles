// ============================================================
// Pentacles — Solana client (ASOL ESMS reads + StarVault custody)
// ============================================================
// Topology after the mainnet conformance pass:
//
//   ESMS       → AlchmAgentsSolana (`asol_program`) is the sole issuer on every
//                cluster. Its four Token-2022 mints are PDAs, derived here
//                rather than configured. Balances are 4-decimal.
//   StarVault  → `pentacles_solana` keeps its own USDC custody and the starUSDC
//                transfer hook. This is the only program Pentacles signs for.
//
// The retired ESMS burn builders are gone. They constructed a plain Token-2022
// `Burn` with the holder as authority, which cannot work against ASOL's mints:
// those carry PermissionedBurn, so a burn must be co-signed by ASOL's mint
// authority PDA. Burning now goes through ASOL's `redeem_for_esms` with a
// detached holder signature — see `buildRedeemAuthorizationMessage`.

import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import {
  ASOL_ESMS_DECIMALS,
  ASOL_PROGRAM_ID,
  ASOL_REDEEM_DOMAIN,
  CAIP2,
  PENTACLES_PROGRAM_ID,
  asolEsmsMint,
  asolEsmsMints,
  chainFor,
} from './chains.js'
import { assertU64 } from './esms-units.js'
import { CU_LIMITS, withComputeBudget } from './priority-fee.js'

/**
 * Cluster comes from an explicit declaration, not from sniffing an RPC URL.
 * `VITE_SOLANA_CLUSTER` accepts `devnet` or `mainnet-beta`.
 */
const declaredCluster = (import.meta.env.VITE_SOLANA_CLUSTER || 'devnet').trim()
export const SOLANA_CAIP2 = declaredCluster.includes(':')
  ? declaredCluster
  : `solana:${declaredCluster}`

export const SOLANA_CHAIN = chainFor(SOLANA_CAIP2)
export const SOLANA_RPC_URL = (
  import.meta.env.VITE_SOLANA_RPC_URL || SOLANA_CHAIN.defaultRpc
).trim()

export const solanaConnection = new Connection(SOLANA_RPC_URL, 'confirmed')

/** Pentacles' own program — StarVault custody and the starUSDC transfer hook. */
export const SOLANA_PROGRAM_ID = import.meta.env.VITE_SOLANA_PROGRAM_ID
  ? new PublicKey(import.meta.env.VITE_SOLANA_PROGRAM_ID)
  : PENTACLES_PROGRAM_ID

/** The four ESMS mints, derived from ASOL's program id. */
export const ELEMENT_MINTS = asolEsmsMints()

export const [GAME_AUTHORITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('game_authority')],
  SOLANA_PROGRAM_ID,
)

/** USDC mint for the active cluster; devnet uses the faucet mint. */
export const USDC_MINT = new PublicKey(
  import.meta.env.VITE_SOLANA_USDC_MINT ||
    (SOLANA_CAIP2 === CAIP2.solanaMainnet
      ? 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      : '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
)

// ── PDAs ────────────────────────────────────────────────────────────────────

export function starPoolPda(starId, programId = SOLANA_PROGRAM_ID) {
  const seed = Buffer.alloc(4)
  seed.writeUInt32LE(starId, 0)
  return PublicKey.findProgramAddressSync([Buffer.from('star_pool'), seed], programId)[0]
}

export function starVaultPda(starId, programId = SOLANA_PROGRAM_ID) {
  const seed = Buffer.alloc(4)
  seed.writeUInt32LE(starId, 0)
  return PublicKey.findProgramAddressSync([Buffer.from('star_vault'), seed], programId)[0]
}

export function stakePositionPda(starId, staker, programId = SOLANA_PROGRAM_ID) {
  const seed = Buffer.alloc(4)
  seed.writeUInt32LE(starId, 0)
  return PublicKey.findProgramAddressSync(
    [Buffer.from('stake'), seed, new PublicKey(staker).toBuffer()],
    programId,
  )[0]
}

// ── ESMS balances (read-only; ASOL owns supply) ─────────────────────────────

/**
 * Read a player's four ESMS balances as raw 4-decimal atoms.
 *
 * Returns BigInt atoms, never a display number — the caller decides how to
 * format. A missing associated token account reads as zero, which is the
 * correct answer, not an error.
 */
export async function readSolanaEsmsBalances(playerPublicKey) {
  if (!playerPublicKey) return [0n, 0n, 0n, 0n]
  const owner =
    typeof playerPublicKey === 'string' ? new PublicKey(playerPublicKey) : playerPublicKey

  return Promise.all(
    ELEMENT_MINTS.map(async (mint) => {
      try {
        const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID)
        const balance = await solanaConnection.getTokenAccountBalance(ata)
        return BigInt(balance.value.amount)
      } catch {
        return 0n
      }
    }),
  )
}

// ── ASOL redeem authorization ───────────────────────────────────────────────

/**
 * Build the exact message `asol_program.redeem_for_esms` verifies via Ed25519
 * precompile introspection.
 *
 * The holder signs this detached; a relayer submits it and pays the fee, so a
 * player spends ESMS without ever holding SOL. Field order and widths are
 * consensus-critical — the program re-serializes the same layout and compares
 * bytes, so any drift here fails verification rather than misbehaving quietly.
 *
 * Layout: domain tag ‖ program id ‖ cluster domain ‖ holder ‖ order id ‖
 *         4 × u64 amounts (LE) ‖ deadline (u64 LE)
 */
export function buildRedeemAuthorizationMessage({
  programId = ASOL_PROGRAM_ID,
  clusterDomain,
  holder,
  orderId,
  amounts,
  deadline,
}) {
  if (!(clusterDomain instanceof Uint8Array) || clusterDomain.length !== 32) {
    throw new Error('clusterDomain must be 32 bytes')
  }
  if (!Array.isArray(amounts) || amounts.length !== 4) {
    throw new Error('amounts must hold one value per ESMS element')
  }
  const orderBytes = typeof orderId === 'string' ? Buffer.from(orderId.replace(/^0x/, ''), 'hex') : Buffer.from(orderId)
  if (orderBytes.length !== 32) throw new Error('orderId must be 32 bytes')

  const domain = Buffer.from(ASOL_REDEEM_DOMAIN, 'utf8')
  const parts = [
    domain,
    new PublicKey(programId).toBuffer(),
    Buffer.from(clusterDomain),
    new PublicKey(holder).toBuffer(),
    orderBytes,
  ]
  const amountBytes = Buffer.alloc(8 * 4)
  amounts.forEach((amount, index) => {
    amountBytes.writeBigUInt64LE(assertU64(amount, `amounts[${index}]`), index * 8)
  })
  parts.push(amountBytes)

  const deadlineBytes = Buffer.alloc(8)
  deadlineBytes.writeBigUInt64LE(assertU64(deadline, 'deadline'), 0)
  parts.push(deadlineBytes)

  return Buffer.concat(parts)
}

// ── StarVault instructions ──────────────────────────────────────────────────
//
// Anchor discriminators are sha256("global:<name>")[0..8]. They are pinned here
// so the builders stay synchronous (WebCrypto's digest is async), and asserted
// against a fresh hash in tests/solana-instructions.test.ts.

export const IX_DISCRIMINATORS = Object.freeze({
  stakeStarUsdc: [255, 243, 10, 7, 55, 159, 208, 102],
  unstakeStarUsdc: [16, 232, 109, 102, 172, 142, 51, 151],
  activateStar: [82, 216, 86, 203, 195, 1, 48, 98],
})

function starVaultKeys({ staker, starId, usdcMint }) {
  const owner = new PublicKey(staker)
  const mint = usdcMint ? new PublicKey(usdcMint) : USDC_MINT
  return {
    mint,
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: GAME_AUTHORITY_PDA, isSigner: false, isWritable: true },
      { pubkey: starPoolPda(starId), isSigner: false, isWritable: true },
      { pubkey: stakePositionPda(starId, owner), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      {
        pubkey: getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: starVaultPda(starId), isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
  }
}

function encodeStarVaultData(discriminator, starId, amount) {
  const data = Buffer.alloc(8 + 4 + 8)
  Buffer.from(discriminator).copy(data, 0)
  data.writeUInt32LE(starId, 8)
  data.writeBigUInt64LE(assertU64(amount, 'amount'), 12)
  return data
}

/** Stake 6-decimal USDC units into a star vault. */
export function buildStakeStarInstruction({ staker, starId, amount, usdcMint }) {
  const { keys } = starVaultKeys({ staker, starId, usdcMint })
  return new TransactionInstruction({
    programId: SOLANA_PROGRAM_ID,
    keys: [...keys, { pubkey: new PublicKey('11111111111111111111111111111111'), isSigner: false, isWritable: false }],
    data: encodeStarVaultData(IX_DISCRIMINATORS.stakeStarUsdc, starId, amount),
  })
}

/** Withdraw staked USDC. Always available — no pause, no admin gate. */
export function buildUnstakeStarInstruction({ staker, starId, amount, usdcMint }) {
  const { keys } = starVaultKeys({ staker, starId, usdcMint })
  return new TransactionInstruction({
    programId: SOLANA_PROGRAM_ID,
    keys,
    data: encodeStarVaultData(IX_DISCRIMINATORS.unstakeStarUsdc, starId, amount),
  })
}

/**
 * Wrap StarVault instructions with an honest compute budget and a priority fee
 * priced off recent activity. Every send path goes through this — a mainnet
 * transaction bidding zero simply never lands.
 */
export async function prepareStarVaultTransaction(instructions, { units } = {}) {
  return withComputeBudget(solanaConnection, instructions, {
    units: units ?? CU_LIMITS.stakeStar,
  })
}

export default {
  SOLANA_CAIP2,
  SOLANA_PROGRAM_ID,
  SOLANA_RPC_URL,
  ASOL_PROGRAM_ID,
  ASOL_ESMS_DECIMALS,
  ELEMENT_MINTS,
  solanaConnection,
  asolEsmsMint,
  readSolanaEsmsBalances,
  buildRedeemAuthorizationMessage,
  buildStakeStarInstruction,
  buildUnstakeStarInstruction,
  prepareStarVaultTransaction,
  starPoolPda,
  starVaultPda,
  stakePositionPda,
}
