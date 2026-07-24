import { describe, expect, test } from 'bun:test'
import { Keypair, SystemProgram } from '@solana/web3.js'
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import {
  ELEMENTS,
  MAX_EPOCH_MINT,
  PROGRAM_ID,
  anchorDiscriminator,
  buildInitializeElementMintInstruction,
  buildInitializeGameAuthorityInstruction,
  gameAuthorityAddress,
} from '../scripts/init-solana-devnet.mjs'

describe('pentacles-solana Devnet initialization', () => {
  const payer = Keypair.generate().publicKey
  const initializeGameAuthorityDiscriminator = 'fc25eef894507ae1'
  const initializeElementMintDiscriminator = '3a041c9c6f32988a'

  test('uses the deployed program ID and stable GameAuthority PDA', () => {
    expect(PROGRAM_ID.toBase58()).toBe('7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R')
    expect(gameAuthorityAddress().toBase58()).toBe('4fhbhdU5yhn572eBbhrDu1axHFsYQhxF2S1oXWtb4Ns2')
  })

  test('encodes initialize_game_authority with the expected Anchor discriminator', () => {
    const instruction = buildInitializeGameAuthorityInstruction(payer)
    expect(anchorDiscriminator('initialize_game_authority').toString('hex')).toBe(
      initializeGameAuthorityDiscriminator,
    )
    expect(instruction.data.subarray(0, 8).toString('hex')).toBe(
      initializeGameAuthorityDiscriminator,
    )
    expect(instruction.data.readBigUInt64LE(8)).toBe(MAX_EPOCH_MINT)
    expect(instruction.keys.map(({ pubkey, isSigner, isWritable }) => [
      pubkey.toBase58(),
      isSigner,
      isWritable,
    ])).toEqual([
      [payer.toBase58(), true, true],
      [gameAuthorityAddress().toBase58(), false, true],
      [SystemProgram.programId.toBase58(), false, false],
    ])
  })

  test('encodes one Token-2022 mint initialization per element', () => {
    for (const { id } of ELEMENTS) {
      const mint = Keypair.generate().publicKey
      const instruction = buildInitializeElementMintInstruction(payer, mint, id)
      expect(instruction.data.subarray(0, 8).toString('hex')).toBe(
        initializeElementMintDiscriminator,
      )
      expect(instruction.data.readUInt8(8)).toBe(id)
      expect(instruction.keys[2].pubkey.equals(mint)).toBe(true)
      expect(instruction.keys[2].isSigner).toBe(true)
      expect(instruction.keys[3].pubkey.equals(TOKEN_2022_PROGRAM_ID)).toBe(true)
    }
  })

  test('rejects invalid element IDs and u64 caps before a transaction is built', () => {
    const mint = Keypair.generate().publicKey
    expect(() => buildInitializeElementMintInstruction(payer, mint, 4)).toThrow(/0 through 3/)
    expect(() => buildInitializeGameAuthorityInstruction(payer, 1n << 64n)).toThrow(/unsigned 64-bit/)
  })
})
