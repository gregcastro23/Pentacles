// ============================================================
// Pentacles — Solana Token-2022 Anchor program bridge
// ============================================================
// Interacts with the pentacles_solana Anchor program:
//   Program ID: 7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R
// Provides read balance methods for ESMS Token-2022 mints (0..3)
// and burn_esms_for_jing / mint_esms_rewards transaction builders.

import { Connection, PublicKey, TransactionInstruction } from '@solana/web3.js'
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'

export const SOLANA_PROGRAM_ID = new PublicKey(
  import.meta.env.VITE_SOLANA_PROGRAM_ID || '7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R'
)

export const SOLANA_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com'

export const solanaConnection = new Connection(SOLANA_RPC_URL, 'confirmed')

// Token-2022 Mint addresses for ESMS elements 0..3 (env-overridable)
export const ELEMENT_MINTS = [
  new PublicKey(import.meta.env.VITE_SOLANA_MINT_SPIRIT || 'EsmsSpirit11111111111111111111111111111111111'),
  new PublicKey(import.meta.env.VITE_SOLANA_MINT_ESSENCE || 'EsmsEssence1111111111111111111111111111111111'),
  new PublicKey(import.meta.env.VITE_SOLANA_MINT_MATTER || 'EsmsMatter1111111111111111111111111111111111'),
  new PublicKey(import.meta.env.VITE_SOLANA_MINT_SUBSTANCE || 'EsmsSubstance1111111111111111111111111111111'),
]

export const [GAME_AUTHORITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from('game_authority')],
  SOLANA_PROGRAM_ID
)

/** Read player's Token-2022 ESMS balances across all 4 element mints. */
export async function readSolanaEsmsBalances(playerPublicKey) {
  if (!playerPublicKey) return [0n, 0n, 0n, 0n]
  const pubkey = typeof playerPublicKey === 'string' ? new PublicKey(playerPublicKey) : playerPublicKey

  const balances = await Promise.all(
    ELEMENT_MINTS.map(async (mint) => {
      try {
        const ata = getAssociatedTokenAddressSync(mint, pubkey, false, TOKEN_2022_PROGRAM_ID)
        const balance = await solanaConnection.getTokenAccountBalance(ata)
        return BigInt(balance.value.amount)
      } catch {
        return 0n
      }
    })
  )
  return balances
}

/** Build an Anchor instruction buffer for burn_esms_for_jing (Discriminator + args). */
export function buildBurnEsmsInstruction({ elementId, amount, playerPublicKey }) {
  const player = new PublicKey(playerPublicKey)
  const mint = ELEMENT_MINTS[elementId]
  if (!mint) throw new Error(`Invalid elementId ${elementId}`)

  const ata = getAssociatedTokenAddressSync(mint, player, false, TOKEN_2022_PROGRAM_ID)

  // Anchor instruction discriminator for "burn_esms_for_jing"
  const data = Buffer.alloc(8 + 1 + 8)
  const discriminator = Buffer.from([116, 219, 137, 240, 18, 143, 211, 44])
  discriminator.copy(data, 0)
  data.writeUInt8(elementId, 8)
  data.writeBigUInt64LE(BigInt(amount), 9)

  return new TransactionInstruction({
    keys: [
      { pubkey: player, isSigner: true, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: SOLANA_PROGRAM_ID,
    data,
  })
}

export default {
  SOLANA_PROGRAM_ID,
  SOLANA_RPC_URL,
  solanaConnection,
  readSolanaEsmsBalances,
  buildBurnEsmsInstruction,
}
