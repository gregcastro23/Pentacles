import { describe, expect, test } from 'bun:test'
import bs58 from 'bs58'
import { geyserLogEntry } from '../feeder/solana-cluster'

// The WebSocket and polling tiers deliver this string straight from web3.js.
const SIGNATURE = '5T1bw5onpC2XUx3wh494NudK33zKoL4NHqtkPafsBboJjBafqo5yfbhZ4isiyYdT2HuxHPgDSKdCh5Pd8LXEq4dk'

// Mirrors normalized_solana_signature in server/src/reducers.rs.
const SERVER_SIGNATURE_RULE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/

const geyserUpdate = (signature: Uint8Array, meta: Record<string, unknown> = {}) => ({
  filters: ['pentacles'],
  transaction: { slot: '1', transaction: { signature, isVote: false, meta, index: '0' } },
})

describe('Geyser tier signature encoding', () => {
  test('delivers the same base58 signature as the WebSocket and polling tiers', () => {
    const bytes = bs58.decode(SIGNATURE)
    expect(bytes.length).toBe(64)

    const entry = geyserLogEntry(geyserUpdate(bytes))

    // Identical strings are what let the replay guard dedupe a tx across tiers.
    expect(entry?.signature).toBe(SIGNATURE)
    expect(entry?.signature).toMatch(SERVER_SIGNATURE_RULE)
  })

  test('never emits base64, which the server rejects', () => {
    const bytes = new Uint8Array(64).map((_, i) => (i * 37 + 251) % 256)
    const base64 = Buffer.from(bytes).toString('base64')
    expect(base64).not.toMatch(SERVER_SIGNATURE_RULE)

    const entry = geyserLogEntry(geyserUpdate(bytes))
    expect(entry?.signature).not.toBe(base64)
    expect(entry?.signature).toMatch(SERVER_SIGNATURE_RULE)
    expect(Array.from(bs58.decode(entry!.signature))).toEqual(Array.from(bytes))
  })

  test('carries logs and the error through', () => {
    const logs = ['Program 11111111111111111111111111111111 invoke [1]']
    const err = { err: new Uint8Array([1]) }
    const entry = geyserLogEntry(geyserUpdate(bs58.decode(SIGNATURE), { logMessages: logs, err }))

    expect(entry).toEqual({ signature: SIGNATURE, logs, err })
    expect(geyserLogEntry(geyserUpdate(bs58.decode(SIGNATURE)))).toEqual({
      signature: SIGNATURE,
      logs: [],
      err: null,
    })
  })

  test('ignores updates without a transaction signature', () => {
    expect(geyserLogEntry({ filters: [], slot: { slot: '1' } })).toBeNull()
    expect(geyserLogEntry({ transaction: { transaction: { signature: new Uint8Array() } } })).toBeNull()
    expect(geyserLogEntry(undefined)).toBeNull()
  })
})
