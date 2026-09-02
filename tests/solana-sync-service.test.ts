import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  decodeAnchorEvents,
  encodeReducerArgs,
  encodeSolanaSyncBody,
  esmsEventsFromBalances,
} from '../feeder/solana-sync-service'
import { asolEsmsMints } from '../src/web3/chains.js'

describe('Solana sync reducer encoding', () => {
  test('encodes u64 amounts as unquoted JSON integers without precision loss', () => {
    const body = encodeSolanaSyncBody({
      signature: '5T1bw5onpC2XUx3wh494NudK33zKoL4NHqtkPafsBboJjBafqo5yfbhZ4isiyYdT2HuxHPgDSKdCh5Pd8LXEq4dk',
      eventType: 'mint',
      player: 'AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5',
      elementId: 0,
      amount: 18_446_744_073_709_551_615n,
      timestamp: 0,
    })

    // The chain tag now leads the tuple so idempotency is scoped per cluster.
    expect(body).toBe(
      '[{"tag":"SolanaToken2022"},'
      + '"5T1bw5onpC2XUx3wh494NudK33zKoL4NHqtkPafsBboJjBafqo5yfbhZ4isiyYdT2HuxHPgDSKdCh5Pd8LXEq4dk",'
      + '"AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5","mint",0,18446744073709551615]',
    )
    expect(body).not.toContain('"18446744073709551615"')
  })

  test('rejects amounts outside the Solana u64 range', () => {
    const event = {
      signature: 'signature',
      eventType: 'burn' as const,
      player: 'player',
      elementId: 3,
      amount: -1n,
      timestamp: 0,
    }

    expect(() => encodeSolanaSyncBody(event)).toThrow(/fit in u64/)
    expect(() => encodeSolanaSyncBody({ ...event, amount: 1n << 64n })).toThrow(/fit in u64/)
  })

  test('refuses an unsafe JS integer instead of silently truncating it', () => {
    // The transfer-hook path used to pass Number(amount) here.
    expect(() => encodeReducerArgs([2 ** 53])).toThrow(/not a safe integer/)
    expect(encodeReducerArgs([9007199254740993n])).toBe('[9007199254740993]')
  })
})

describe('Anchor event decoding', () => {
  const discriminator = (name: string) =>
    createHash('sha256').update(`event:${name}`).digest().subarray(0, 8)

  test('event discriminators match a freshly computed hash', () => {
    // Pinned in the feeder so decoding stays synchronous; if the event is ever
    // renamed in the program this is what catches it.
    expect(Array.from(discriminator('StarStaked'))).toEqual([196, 97, 37, 231, 187, 111, 123, 3])
    expect(Array.from(discriminator('StarUnstaked'))).toEqual([162, 83, 72, 193, 72, 117, 207, 119])
    expect(Array.from(discriminator('StarStakeTransferred'))).toEqual([204, 122, 16, 230, 79, 217, 84, 82])
  })

  test('decodes a StarStaked event out of a Program data log line', () => {
    const staker = asolEsmsMints()[0] // any valid 32-byte key
    const payload = Buffer.concat([
      discriminator('StarStaked'),
      staker.toBuffer(),
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(677); return b })(),
      (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(10_000_000n); return b })(),
    ])
    const events = decodeAnchorEvents([
      'Program log: something unrelated',
      `Program data: ${payload.toString('base64')}`,
    ])
    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('StarStaked')
    expect(events[0].data.pubkey()).toBe(staker.toBase58())
    expect(events[0].data.u32()).toBe(677)
    expect(events[0].data.u64()).toBe(10_000_000n)
  })

  test('decodes a StarUnstaked event out of a Program data log line', () => {
    const staker = asolEsmsMints()[0]
    const payload = Buffer.concat([
      discriminator('StarUnstaked'),
      staker.toBuffer(),
      (() => { const b = Buffer.alloc(4); b.writeUInt32LE(677); return b })(),
      (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(5_000_000n); return b })(),
      (() => { const b = Buffer.alloc(8); b.writeBigUInt64LE(5_000_000n); return b })(),
    ])
    const events = decodeAnchorEvents([
      'Program log: something unrelated',
      `Program data: ${payload.toString('base64')}`,
    ])
    expect(events).toHaveLength(1)
    expect(events[0].name).toBe('StarUnstaked')
    expect(events[0].data.pubkey()).toBe(staker.toBase58())
    expect(events[0].data.u32()).toBe(677)
    expect(events[0].data.u64()).toBe(5_000_000n) // principal_usdc
    expect(events[0].data.u64()).toBe(5_000_000n) // position_principal
  })

  test('ignores log lines that are not events', () => {
    expect(decodeAnchorEvents(['Program log: Minted 5 units of ESMS element 0'])).toEqual([])
    expect(decodeAnchorEvents(['Program data: not-valid-base64!!'])).toEqual([])
  })
})

describe('ESMS supply changes from Token-2022 balance deltas', () => {
  const [spirit] = asolEsmsMints()
  const owner = 'AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5'

  test('reads a mint as a positive delta and a burn as a negative one', () => {
    const mint = esmsEventsFromBalances(
      'sig',
      {
        preTokenBalances: [{ accountIndex: 1, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '10000' } }],
        postTokenBalances: [{ accountIndex: 1, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '25000' } }],
      },
      0,
    )
    expect(mint).toEqual([
      { signature: 'sig', eventType: 'mint', player: owner, elementId: 0, amount: 15_000n, timestamp: 0 },
    ])

    const burn = esmsEventsFromBalances(
      'sig',
      {
        preTokenBalances: [{ accountIndex: 1, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '25000' } }],
        postTokenBalances: [{ accountIndex: 1, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '0' } }],
      },
      0,
    )
    expect(burn[0]).toMatchObject({ eventType: 'burn', amount: 25_000n })
  })

  test('treats an account absent from preTokenBalances as opening at zero', () => {
    const events = esmsEventsFromBalances(
      'sig',
      {
        preTokenBalances: [],
        postTokenBalances: [{ accountIndex: 4, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '5000' } }],
      },
      0,
    )
    expect(events[0]).toMatchObject({ eventType: 'mint', amount: 5_000n })
  })

  test('ignores mints that are not ASOL ESMS and unchanged balances', () => {
    expect(
      esmsEventsFromBalances(
        'sig',
        {
          preTokenBalances: [{ accountIndex: 1, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '7' } }],
          postTokenBalances: [
            { accountIndex: 1, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '7' } },
            { accountIndex: 2, mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', owner, uiTokenAmount: { amount: '900' } },
          ],
        },
        0,
      ),
    ).toEqual([])
  })

  test('preserves amounts above 2^53 exactly', () => {
    const events = esmsEventsFromBalances(
      'sig',
      {
        preTokenBalances: [],
        postTokenBalances: [
          { accountIndex: 1, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '9007199254740993' } },
        ],
      },
      0,
    )
    expect(events[0].amount).toBe(9007199254740993n)
  })
})
