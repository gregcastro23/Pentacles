import { describe, expect, test } from 'bun:test'
import { encodeSolanaSyncBody } from '../feeder/solana-sync-service'

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

    expect(body).toBe(
      '["5T1bw5onpC2XUx3wh494NudK33zKoL4NHqtkPafsBboJjBafqo5yfbhZ4isiyYdT2HuxHPgDSKdCh5Pd8LXEq4dk",'
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
})
