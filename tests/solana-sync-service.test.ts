import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { MessageV0, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import { geyserLogEntry, transactionLogEntry, type LogEntry } from '../feeder/solana-cluster'
import {
  bridgeChainArg,
  cliReducerArgs,
  decodeAnchorEvents,
  encodeReducerArgs,
  encodeSolanaSyncBody,
  esmsEventsForTransaction,
  esmsEventsFromBalances,
  ingestionAddresses,
  isEsmsSupplyTransaction,
} from '../feeder/solana-sync-service'
import { ASOL_PROGRAM_ID, asolEsmsMints, CAIP2, PENTACLES_PROGRAM_ID } from '../src/web3/chains.js'

const OWNER = 'AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5'
const ED25519 = 'Ed25519SigVerify111111111111111111111111111'

/**
 * Instruction data for an Anchor instruction: sha256("global:<name>")[0..8],
 * then arguments. Computed fresh rather than copied from the feeder, and equal
 * to the discriminators in ASOL's generated IDL.
 */
const anchorIx = (name: string) =>
  new Uint8Array([...createHash('sha256').update(`global:${name}`).digest().subarray(0, 8), 1, 2, 3])

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

    // The chain leads the tuple so idempotency is scoped per cluster.
    expect(body).toBe(
      '[{"solanaToken2022":[]},'
      + '"5T1bw5onpC2XUx3wh494NudK33zKoL4NHqtkPafsBboJjBafqo5yfbhZ4isiyYdT2HuxHPgDSKdCh5Pd8LXEq4dk",'
      + '"AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5","mint",0,18446744073709551615]',
    )
    expect(body).not.toContain('"18446744073709551615"')
  })

  test('sends BridgeChain as a SATS-JSON sum the module can decode', () => {
    // SpacetimeDB 2.10 answers {"tag":"SolanaToken2022"} with: unknown variant
    // `tag`, expected one of `evmBaseSepolia`, `solanaToken2022`, ...
    const rust = readFileSync(new URL('../server/src/types.rs', import.meta.url), 'utf8')
    const body = /pub enum BridgeChain \{([^}]*)\}/.exec(rust)![1]
    const variants = body
      .split(',')
      .map((variant) => variant.trim())
      .filter(Boolean)
      .map((variant) => variant.charAt(0).toLowerCase() + variant.slice(1))
    expect(variants).toContain('solanaToken2022')

    for (const caip2 of [CAIP2.solanaDevnet, CAIP2.solanaMainnet]) {
      const arg = bridgeChainArg(caip2)
      expect(Object.keys(arg)).toHaveLength(1)
      expect(variants).toContain(Object.keys(arg)[0])
      expect(Object.values(arg)).toEqual([[]])
    }
    expect(bridgeChainArg(CAIP2.solanaDevnet)).toEqual({ solanaToken2022: [] })
    expect(bridgeChainArg(CAIP2.solanaMainnet)).toEqual({ solanaMainnetToken2022: [] })
  })

  test('marks the chain enum raw for the CLI fallback and leaves scalars alone', () => {
    expect(cliReducerArgs([{ solanaToken2022: [] }, 'sig', 3, 18_446_744_073_709_551_615n])).toEqual([
      { raw: '{"solanaToken2022":[]}' },
      'sig',
      3,
      18_446_744_073_709_551_615n,
    ])
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

  test('reads a burn that closes its token account, which has no post balance', () => {
    const events = esmsEventsFromBalances(
      'sig',
      {
        preTokenBalances: [{ accountIndex: 3, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '5000' } }],
        postTokenBalances: [],
      },
      0,
    )
    expect(events).toEqual([
      { signature: 'sig', eventType: 'burn', player: owner, elementId: 0, amount: 5_000n, timestamp: 0 },
    ])
  })

  test('emits one event per element when a single redeem burns several', () => {
    const [, essence, matter, substance] = asolEsmsMints().map((mint) => mint.toBase58())
    const events = esmsEventsFromBalances(
      'sig',
      {
        preTokenBalances: [
          { accountIndex: 1, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '30000' } },
          { accountIndex: 2, mint: essence, owner, uiTokenAmount: { amount: '100' } },
          { accountIndex: 3, mint: matter, owner, uiTokenAmount: { amount: '5000' } },
          { accountIndex: 4, mint: substance, owner, uiTokenAmount: { amount: '8' } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '20000' } },
          { accountIndex: 2, mint: essence, owner, uiTokenAmount: { amount: '100' } },
          { accountIndex: 4, mint: substance, owner, uiTokenAmount: { amount: '0' } },
        ],
      },
      0,
    )
    expect(events.map(({ elementId, eventType, amount }) => ({ elementId, eventType, amount }))).toEqual([
      { elementId: 0, eventType: 'burn', amount: 10_000n },
      { elementId: 2, eventType: 'burn', amount: 5_000n },
      { elementId: 3, eventType: 'burn', amount: 8n },
    ])
  })

  test('sums one wallet\'s token accounts on a mint into a single event', () => {
    // The module settles each wallet, element and direction once per signature,
    // so two events for the same tuple would lose the second.
    const other = '3F5qRPtKg8GhGNnbd3qCj6nVJxWsGxq7pvH84okYLAqf'
    const events = esmsEventsFromBalances(
      'sig',
      {
        preTokenBalances: [],
        postTokenBalances: [
          { accountIndex: 1, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '300' } },
          { accountIndex: 2, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '200' } },
          { accountIndex: 3, mint: spirit.toBase58(), owner: other, uiTokenAmount: { amount: '7' } },
        ],
      },
      0,
    )
    expect(events.map(({ player, amount }) => ({ player, amount }))).toEqual([
      { player: owner, amount: 500n },
      { player: other, amount: 7n },
    ])
  })

  test('skips an account whose owner or amount cannot be read instead of guessing', () => {
    const events = esmsEventsFromBalances(
      'sig',
      {
        preTokenBalances: [
          // Geyser leaves the amount unset rather than absent; reading it as zero
          // would turn the post balance into a phantom mint.
          { accountIndex: 1, mint: spirit.toBase58(), owner },
          { accountIndex: 2, mint: spirit.toBase58(), owner: '', uiTokenAmount: { amount: '0' } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: spirit.toBase58(), owner, uiTokenAmount: { amount: '900' } },
          { accountIndex: 2, mint: spirit.toBase58(), owner: '', uiTokenAmount: { amount: '900' } },
        ],
      },
      0,
    )
    expect(events).toEqual([])
    expect(esmsEventsFromBalances('sig', null, 0)).toEqual([])
  })
})

describe('ESMS ingestion from the stream', () => {
  test('watches the Pentacles program and every ASOL ESMS mint', () => {
    // ASOL mints and burns never invoke Pentacles, so watching the program
    // alone delivered none of them.
    const watched = ingestionAddresses().map((address) => address.toBase58())
    expect(watched).toContain(PENTACLES_PROGRAM_ID.toBase58())
    for (const mint of asolEsmsMints()) expect(watched).toContain(mint.toBase58())
    expect(new Set(watched).size).toBe(watched.length)
  })

  // One ASOL transaction as each tier delivers it: an Ed25519 check, then the
  // named ASOL instruction, burning 1.0 Spirit and all 0.5 Matter.
  function bothTiers(instruction: string) {
    const signature = bs58.encode(new Uint8Array(64).fill(7))
    const [spirit, , matter] = asolEsmsMints().map((mint) => mint.toBase58())
    const rpcBalance = (accountIndex: number, mint: string, amount: string) => ({
      accountIndex,
      mint,
      owner: OWNER,
      programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
      uiTokenAmount: { amount, decimals: 4, uiAmount: Number(amount) / 1e4, uiAmountString: '' },
    })
    const keys = [new PublicKey(OWNER), new PublicKey(ED25519), ASOL_PROGRAM_ID]
    const compiled = [
      { programIdIndex: 1, data: new Uint8Array([1, 0]) },
      { programIdIndex: 2, data: anchorIx(instruction) },
    ]
    const meta = {
      err: null,
      logMessages: [],
      preTokenBalances: [rpcBalance(3, spirit, '30000'), rpcBalance(4, matter, '5000')],
      postTokenBalances: [rpcBalance(3, spirit, '20000')],
      innerInstructions: [],
    }

    const fromGeyser = geyserLogEntry({
      filters: ['pentacles'],
      transaction: {
        slot: '1',
        transaction: {
          signature: bs58.decode(signature),
          isVote: false,
          index: '0',
          transaction: {
            signatures: [bs58.decode(signature)],
            message: {
              accountKeys: keys.map((key) => key.toBytes()),
              instructions: compiled.map((ix) => ({ ...ix, accounts: new Uint8Array() })),
            },
          },
          meta: { ...meta, innerInstructionsNone: false, loadedWritableAddresses: [], loadedReadonlyAddresses: [] },
        },
      },
    })!
    const fromRpc = transactionLogEntry(signature, {
      transaction: {
        message: new MessageV0({
          header: { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 2 },
          staticAccountKeys: keys,
          recentBlockhash: '11111111111111111111111111111111',
          compiledInstructions: compiled.map((ix) => ({ ...ix, accountKeyIndexes: [] })),
          addressTableLookups: [],
        }),
      },
      meta: { ...meta, loadedAddresses: { writable: [], readonly: [] } },
    })!
    return { signature, fromGeyser, fromRpc }
  }

  const bodies = (entry: LogEntry) => esmsEventsForTransaction(entry, 0).map(encodeSolanaSyncBody)

  test('the Geyser and RPC tiers produce the same sync_solana_event calls for one redeem', () => {
    const { signature, fromGeyser, fromRpc } = bothTiers('redeem_for_esms')

    expect(bodies(fromGeyser)).toEqual([
      `[{"solanaToken2022":[]},"${signature}","${OWNER}","burn",0,10000]`,
      `[{"solanaToken2022":[]},"${signature}","${OWNER}","burn",2,5000]`,
    ])
    expect(bodies(fromRpc)).toEqual(bodies(fromGeyser))
  })

  test('neither tier produces calls when the same balances moved through the AMM', () => {
    const { fromGeyser, fromRpc } = bothTiers('add_liquidity')

    expect(esmsEventsFromBalances(fromGeyser.signature, fromGeyser.meta, 0)).toHaveLength(2)
    expect(bodies(fromGeyser)).toEqual([])
    expect(bodies(fromRpc)).toEqual([])
  })
})

describe('only ASOL claims and redeems credit ESMS', () => {
  const asol = ASOL_PROGRAM_ID.toBase58()
  const at = (programId: string, name: string) => ({ programId, data: anchorIx(name) })
  const tokenCpi = { programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', data: new Uint8Array([7]) }
  const computeBudget = { programId: 'ComputeBudget111111111111111111111111111111', data: new Uint8Array([2]) }
  const relayer = '3F5qRPtKg8GhGNnbd3qCj6nVJxWsGxq7pvH84okYLAqf'

  test('claims and redeems qualify, top-level or through CPI', () => {
    for (const name of ['claim_mint_esms', 'claim_star_yield', 'redeem_esms', 'redeem_for_esms']) {
      expect(isEsmsSupplyTransaction([computeBudget, at(asol, name), tokenCpi])).toBe(true)
    }
    // A relayer program submitting a redeem, which ASOL then executes as a CPI.
    expect(isEsmsSupplyTransaction([at(relayer, 'relay'), at(asol, 'redeem_for_esms'), tokenCpi])).toBe(true)
  })

  test('AMM trades never qualify, alone or beside a claim or redeem', () => {
    for (const name of ['swap_esms', 'add_liquidity', 'withdraw_liquidity']) {
      expect(isEsmsSupplyTransaction([at(asol, name), tokenCpi])).toBe(false)
      expect(isEsmsSupplyTransaction([at(asol, 'redeem_esms'), at(asol, name)])).toBe(false)
      expect(isEsmsSupplyTransaction([at(asol, 'claim_mint_esms'), at(relayer, 'x'), at(asol, name)])).toBe(false)
    }
  })

  test('fails closed without an ASOL instruction or a complete instruction list', () => {
    expect(isEsmsSupplyTransaction(null)).toBe(false)
    expect(isEsmsSupplyTransaction([])).toBe(false)
    expect(isEsmsSupplyTransaction([tokenCpi])).toBe(false)
    // Another program reusing a claim discriminator is still not ASOL.
    expect(isEsmsSupplyTransaction([at(relayer, 'claim_mint_esms')])).toBe(false)
    expect(isEsmsSupplyTransaction([{ programId: asol, data: anchorIx('redeem_esms').subarray(0, 7) }])).toBe(false)
  })

  test('a swap is not credited even though its balances look like a burn and a mint', () => {
    const [spirit, essence] = asolEsmsMints().map((mint) => mint.toBase58())
    const balance = (accountIndex: number, mint: string, amount: string) => ({
      accountIndex, mint, owner: OWNER, uiTokenAmount: { amount },
    })
    const swap = {
      signature: 'sig',
      meta: {
        preTokenBalances: [balance(1, spirit, '30000'), balance(2, essence, '0')],
        postTokenBalances: [balance(1, spirit, '20000'), balance(2, essence, '9970')],
      },
    }

    expect(esmsEventsFromBalances(swap.signature, swap.meta, 0).map((event) => event.eventType)).toEqual([
      'burn',
      'mint',
    ])
    expect(esmsEventsForTransaction({ ...swap, instructions: [at(asol, 'swap_esms'), tokenCpi] }, 0)).toEqual([])
    expect(esmsEventsForTransaction({ ...swap, instructions: null }, 0)).toEqual([])
    expect(esmsEventsForTransaction({ ...swap, instructions: [at(asol, 'claim_mint_esms')] }, 0)).toHaveLength(2)
  })
})
