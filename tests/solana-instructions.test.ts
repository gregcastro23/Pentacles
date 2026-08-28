import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { PublicKey } from '@solana/web3.js'
import { decodeAnchorEvents } from '../feeder/solana-sync-service'
import { PENTACLES_PROGRAM_ID } from '../src/web3/chains.js'

describe('Anchor event discriminator and field order pinning', () => {
  const discriminator = (name: string) =>
    createHash('sha256').update(`event:${name}`).digest().subarray(0, 8)

  const ASOL_PROGRAM_ID = '5QheuqaicKvPPRFEoEXwaE5xaFp7gauvJCfsjpQv8WzD'

  test('pinned discriminators match Anchor sha256("event:<Name>")[0..8]', () => {
    expect(Array.from(discriminator('StarStaked'))).toEqual([196, 97, 37, 231, 187, 111, 123, 3])
    expect(Array.from(discriminator('StarUnstaked'))).toEqual([162, 83, 72, 193, 72, 117, 207, 119])
    expect(Array.from(discriminator('StarActivated'))).toEqual([242, 179, 139, 209, 85, 255, 232, 202])
    expect(Array.from(discriminator('StarStakeTransferred'))).toEqual([204, 122, 16, 230, 79, 217, 84, 82])
  })

  test('StarActivated Borsh layout order: [star_id: u32, timestamp: i64]', () => {
    const starId = 677
    const timestamp = 1_700_000_000n

    const buf = Buffer.alloc(12)
    buf.writeUInt32LE(starId, 0)
    buf.writeBigInt64LE(timestamp, 4)

    const payload = Buffer.concat([discriminator('StarActivated'), buf])
    const logs = [
      `Program ${PENTACLES_PROGRAM_ID.toBase58()} invoke [1]`,
      `Program data: ${payload.toString('base64')}`,
      `Program ${PENTACLES_PROGRAM_ID.toBase58()} success`,
    ]

    const events = decodeAnchorEvents(logs, PENTACLES_PROGRAM_ID)
    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('StarActivated')
    expect(events[0].data.u32()).toBe(starId)
    expect(events[0].data.i64()).toBe(timestamp)
  })

  test('StarStaked Borsh layout order: [staker: Pubkey, star_id: u32, principal_usdc: u64, position_principal: u64, pool_principal: u64, timestamp: i64]', () => {
    const staker = new PublicKey('AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5')
    const starId = 677
    const principalUsdc = 10_000_000n
    const positionPrincipal = 10_000_000n
    const poolPrincipal = 50_000_000n
    const timestamp = 1_700_000_000n

    const buf = Buffer.alloc(68)
    staker.toBuffer().copy(buf, 0)
    buf.writeUInt32LE(starId, 32)
    buf.writeBigUInt64LE(principalUsdc, 36)
    buf.writeBigUInt64LE(positionPrincipal, 44)
    buf.writeBigUInt64LE(poolPrincipal, 52)
    buf.writeBigInt64LE(timestamp, 60)

    const payload = Buffer.concat([discriminator('StarStaked'), buf])
    const logs = [
      `Program ${PENTACLES_PROGRAM_ID.toBase58()} invoke [1]`,
      `Program data: ${payload.toString('base64')}`,
      `Program ${PENTACLES_PROGRAM_ID.toBase58()} success`,
    ]

    const events = decodeAnchorEvents(logs, PENTACLES_PROGRAM_ID)
    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('StarStaked')
    expect(events[0].data.pubkey()).toBe(staker.toBase58())
    expect(events[0].data.u32()).toBe(starId)
    expect(events[0].data.u64()).toBe(principalUsdc)
    expect(events[0].data.u64()).toBe(positionPrincipal)
    expect(events[0].data.u64()).toBe(poolPrincipal)
    expect(events[0].data.i64()).toBe(timestamp)
  })

  test('StarUnstaked Borsh layout order: [staker: Pubkey, star_id: u32, principal_usdc: u64, position_principal: u64, accrued_cap: u64, pool_delta: u64, timestamp: i64]', () => {
    const staker = new PublicKey('AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5')
    const starId = 677
    const principalUsdc = 5_000_000n
    const positionPrincipal = 5_000_000n
    const accruedCap = 120_000n
    const poolDelta = 5_000_000n
    const timestamp = 1_700_000_000n

    const buf = Buffer.alloc(76)
    staker.toBuffer().copy(buf, 0)
    buf.writeUInt32LE(starId, 32)
    buf.writeBigUInt64LE(principalUsdc, 36)
    buf.writeBigUInt64LE(positionPrincipal, 44)
    buf.writeBigUInt64LE(accruedCap, 52)
    buf.writeBigUInt64LE(poolDelta, 60)
    buf.writeBigInt64LE(timestamp, 68)

    const payload = Buffer.concat([discriminator('StarUnstaked'), buf])
    const logs = [
      `Program ${PENTACLES_PROGRAM_ID.toBase58()} invoke [1]`,
      `Program data: ${payload.toString('base64')}`,
      `Program ${PENTACLES_PROGRAM_ID.toBase58()} success`,
    ]

    const events = decodeAnchorEvents(logs, PENTACLES_PROGRAM_ID)
    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('StarUnstaked')
    expect(events[0].data.pubkey()).toBe(staker.toBase58())
    expect(events[0].data.u32()).toBe(starId)
    expect(events[0].data.u64()).toBe(principalUsdc)
    expect(events[0].data.u64()).toBe(positionPrincipal)
    expect(events[0].data.u64()).toBe(accruedCap)
    expect(events[0].data.u64()).toBe(poolDelta)
    expect(events[0].data.i64()).toBe(timestamp)
  })

  test('StarStakeTransferred Borsh layout order: [from_wallet: Pubkey, to_wallet: Pubkey, token_amount: u64, timestamp: i64]', () => {
    const fromWallet = new PublicKey('11111111111111111111111111111111')
    const toWallet = new PublicKey('AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5')
    const tokenAmount = 250_000n
    const timestamp = 1_700_000_000n

    const buf = Buffer.alloc(80)
    fromWallet.toBuffer().copy(buf, 0)
    toWallet.toBuffer().copy(buf, 32)
    buf.writeBigUInt64LE(tokenAmount, 64)
    buf.writeBigInt64LE(timestamp, 72)

    const payload = Buffer.concat([discriminator('StarStakeTransferred'), buf])
    const logs = [
      `Program ${PENTACLES_PROGRAM_ID.toBase58()} invoke [1]`,
      `Program data: ${payload.toString('base64')}`,
      `Program ${PENTACLES_PROGRAM_ID.toBase58()} success`,
    ]

    const events = decodeAnchorEvents(logs, PENTACLES_PROGRAM_ID)
    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('StarStakeTransferred')
    expect(events[0].data.pubkey()).toBe(fromWallet.toBase58())
    expect(events[0].data.pubkey()).toBe(toWallet.toBase58())
    expect(events[0].data.u64()).toBe(tokenAmount)
    expect(events[0].data.i64()).toBe(timestamp)
  })

  test('regression: ASOL-emitted StarStaked payload is ignored by Pentacles feeder', () => {
    const staker = new PublicKey('AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5')
    const asolPayload = Buffer.concat([
      discriminator('StarStaked'),
      staker.toBuffer(),
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(677); return b })(),
      (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(10_000_000n); return b })(),
    ])

    const logs = [
      `Program ${ASOL_PROGRAM_ID} invoke [1]`,
      `Program data: ${asolPayload.toString('base64')}`,
      `Program ${ASOL_PROGRAM_ID} success`,
    ]

    const events = decodeAnchorEvents(logs, PENTACLES_PROGRAM_ID)
    expect(events).toHaveLength(0)
  })

  test('regression: Pentacles StarStaked inside a multi-program CPI transaction is properly attributed', () => {
    const staker = new PublicKey('AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5')
    const pentaclesPayload = Buffer.concat([
      discriminator('StarStaked'),
      staker.toBuffer(),
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(677); return b })(),
      (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(10_000_000n); return b })(),
      (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(10_000_000n); return b })(),
      (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(50_000_000n); return b })(),
      (() => { const b = Buffer.alloc(8); b.writeBigInt64LE(1_700_000_000n); return b })(),
    ])

    const logs = [
      'Program SomeRouter1111111111111111111111111111111111 invoke [1]',
      `Program ${PENTACLES_PROGRAM_ID.toBase58()} invoke [2]`,
      `Program data: ${pentaclesPayload.toString('base64')}`,
      `Program ${PENTACLES_PROGRAM_ID.toBase58()} success`,
      'Program SomeRouter1111111111111111111111111111111111 success',
    ]

    const events = decodeAnchorEvents(logs, PENTACLES_PROGRAM_ID)
    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('StarStaked')
    expect(events[0].data.pubkey()).toBe(staker.toBase58())
    expect(events[0].data.u32()).toBe(677)
    expect(events[0].data.u64()).toBe(10_000_000n)
  })
})
