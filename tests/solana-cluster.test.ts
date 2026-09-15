import { describe, expect, test } from 'bun:test'
import { Message, MessageV0, PublicKey } from '@solana/web3.js'
import bs58 from 'bs58'
import {
  createResilientLogStream,
  geyserLogEntry,
  geyserSubscribeRequest,
  transactionLogEntry,
  type ClusterConfig,
  type LogEntry,
} from '../feeder/solana-cluster'
import { asolEsmsMints, PENTACLES_PROGRAM_ID } from '../src/web3/chains.js'

// The WebSocket and polling tiers deliver this string straight from web3.js.
const SIGNATURE = '5T1bw5onpC2XUx3wh494NudK33zKoL4NHqtkPafsBboJjBafqo5yfbhZ4isiyYdT2HuxHPgDSKdCh5Pd8LXEq4dk'

// Mirrors normalized_solana_signature in server/src/reducers.rs.
const SERVER_SIGNATURE_RULE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/

const geyserUpdate = (signature: Uint8Array, meta: Record<string, unknown> = {}) => ({
  filters: ['pentacles'],
  transaction: { slot: '1', transaction: { signature, isVote: false, meta, index: '0' } },
})

const OWNER = 'AhNRjjyhJ4dR6ZSvWyJNSpbJFbFnxhkRdUNMY31fJ3S5'
const [SPIRIT, ESSENCE] = asolEsmsMints().map((mint) => mint.toBase58())

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

    expect(entry).toEqual({
      signature: SIGNATURE,
      logs,
      err,
      meta: { preTokenBalances: [], postTokenBalances: [] },
      instructions: null,
    })
    expect(geyserLogEntry(geyserUpdate(bs58.decode(SIGNATURE)))).toEqual({
      signature: SIGNATURE,
      logs: [],
      err: null,
      meta: { preTokenBalances: [], postTokenBalances: [] },
      instructions: null,
    })
  })

  test('ignores updates without a transaction signature', () => {
    expect(geyserLogEntry({ filters: [], slot: { slot: '1' } })).toBeNull()
    expect(geyserLogEntry({ transaction: { transaction: { signature: new Uint8Array() } } })).toBeNull()
    expect(geyserLogEntry(undefined)).toBeNull()
  })
})

describe('token balances on every tier', () => {
  // Field for field what @triton-one/yellowstone-grpc 7 decodes: protobuf
  // strings are never absent, and u64s arrive as strings.
  const geyserBalance = (accountIndex: number, mint: string, amount: string) => ({
    accountIndex,
    mint,
    uiTokenAmount: { uiAmount: Number(amount) / 1e4, decimals: 4, amount, uiAmountString: '' },
    owner: OWNER,
    programId: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
  })

  test('the Geyser tier passes pre and post token balances through', () => {
    const pre = [geyserBalance(1, SPIRIT, '10000')]
    const post = [geyserBalance(1, SPIRIT, '25000')]
    const entry = geyserLogEntry(
      geyserUpdate(bs58.decode(SIGNATURE), { preTokenBalances: pre, postTokenBalances: post }),
    )

    expect(entry?.meta).toEqual({ preTokenBalances: pre, postTokenBalances: post })
  })

  test('a getTransaction response carries its balances, logs and error', () => {
    const tx = {
      slot: 9,
      meta: {
        err: null,
        logMessages: ['Program log: redeem'],
        preTokenBalances: [{ accountIndex: 2, mint: ESSENCE, owner: OWNER, uiTokenAmount: { amount: '0' } }],
        postTokenBalances: [{ accountIndex: 2, mint: ESSENCE, owner: OWNER, uiTokenAmount: { amount: '7' } }],
      },
    }

    expect(transactionLogEntry(SIGNATURE, tx)).toEqual({
      signature: SIGNATURE,
      logs: ['Program log: redeem'],
      err: null,
      meta: { preTokenBalances: tx.meta.preTokenBalances, postTokenBalances: tx.meta.postTokenBalances },
      instructions: null,
    })
    // Older nodes answer null for balances they did not record.
    expect(transactionLogEntry(SIGNATURE, { meta: { preTokenBalances: null } })?.meta).toEqual({
      preTokenBalances: [],
      postTokenBalances: [],
    })
    expect(transactionLogEntry(SIGNATURE, { meta: null })?.meta).toBeNull()
    expect(transactionLogEntry(SIGNATURE, null)).toBeNull()
  })

  test('the Geyser subscription includes every watched address', () => {
    const addresses = [PENTACLES_PROGRAM_ID, ...asolEsmsMints()]
    const request = geyserSubscribeRequest(addresses, 'confirmed')

    expect(request.transactions.pentacles.accountInclude).toEqual(addresses.map((a) => a.toBase58()))
    expect(request.transactions.pentacles.accountRequired).toEqual([])
    expect(request.commitment).toBe(1)
    expect(geyserSubscribeRequest(addresses, 'finalized').commitment).toBe(2)
  })
})

describe('executed instructions on every tier', () => {
  const payer = new PublicKey(OWNER)
  const computeBudget = new PublicKey('ComputeBudget111111111111111111111111111111')
  const token2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')
  const relayer = new PublicKey('3F5qRPtKg8GhGNnbd3qCj6nVJxWsGxq7pvH84okYLAqf')
  const header = { numRequiredSignatures: 1, numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 2 }
  const blockhash = '11111111111111111111111111111111'

  test('Geyser resolves top-level and CPI program ids across address-table keys', () => {
    const entry = geyserLogEntry({
      filters: ['pentacles'],
      transaction: {
        slot: '1',
        transaction: {
          signature: bs58.decode(SIGNATURE),
          isVote: false,
          index: '0',
          transaction: {
            signatures: [bs58.decode(SIGNATURE)],
            message: {
              accountKeys: [payer.toBytes(), computeBudget.toBytes(), relayer.toBytes()],
              instructions: [
                { programIdIndex: 1, accounts: new Uint8Array(), data: new Uint8Array([2, 64]) },
                { programIdIndex: 2, accounts: new Uint8Array([0]), data: new Uint8Array([9]) },
              ],
            },
          },
          meta: {
            // The relayer CPIs into programs it loaded from a lookup table.
            loadedWritableAddresses: [],
            loadedReadonlyAddresses: [PENTACLES_PROGRAM_ID.toBytes(), token2022.toBytes()],
            innerInstructions: [
              {
                index: 1,
                instructions: [
                  { programIdIndex: 3, accounts: new Uint8Array(), data: new Uint8Array([7, 7]) },
                  { programIdIndex: 4, accounts: new Uint8Array(), data: new Uint8Array([8]) },
                ],
              },
            ],
            innerInstructionsNone: false,
          },
        },
      },
    })

    expect(entry?.instructions).toEqual([
      { programId: computeBudget.toBase58(), data: new Uint8Array([2, 64]) },
      { programId: relayer.toBase58(), data: new Uint8Array([9]) },
      { programId: PENTACLES_PROGRAM_ID.toBase58(), data: new Uint8Array([7, 7]) },
      { programId: token2022.toBase58(), data: new Uint8Array([8]) },
    ])
  })

  test('a Geyser update without recorded CPIs, or with a dangling index, has no instruction list', () => {
    const update = (message: object, meta: object) =>
      geyserLogEntry({
        transaction: { transaction: { signature: bs58.decode(SIGNATURE), transaction: { message }, meta } },
      })
    const message = { accountKeys: [payer.toBytes()], instructions: [{ programIdIndex: 0, data: new Uint8Array() }] }

    expect(update(message, { innerInstructions: [], innerInstructionsNone: true })?.instructions).toBeNull()
    expect(
      update({ ...message, instructions: [{ programIdIndex: 5, data: new Uint8Array() }] }, { innerInstructions: [] })
        ?.instructions,
    ).toBeNull()
    expect(update(message, { innerInstructions: [] })?.instructions).toEqual([
      { programId: payer.toBase58(), data: new Uint8Array() },
    ])
  })

  test('getTransaction resolves a v0 message, its loaded addresses and base58 CPI data', () => {
    const message = new MessageV0({
      header,
      staticAccountKeys: [payer, computeBudget, relayer],
      recentBlockhash: blockhash,
      compiledInstructions: [
        { programIdIndex: 1, accountKeyIndexes: [], data: new Uint8Array([2, 64]) },
        { programIdIndex: 2, accountKeyIndexes: [0], data: new Uint8Array([9]) },
      ],
      addressTableLookups: [],
    })
    const entry = transactionLogEntry(SIGNATURE, {
      transaction: { message },
      meta: {
        err: null,
        loadedAddresses: { writable: [token2022], readonly: [PENTACLES_PROGRAM_ID] },
        innerInstructions: [
          {
            index: 1,
            instructions: [
              { programIdIndex: 4, accounts: [], data: bs58.encode(new Uint8Array([7, 7])) },
              { programIdIndex: 3, accounts: [], data: bs58.encode(new Uint8Array([8])) },
            ],
          },
        ],
      },
    })

    expect(entry?.instructions).toEqual([
      { programId: computeBudget.toBase58(), data: new Uint8Array([2, 64]) },
      { programId: relayer.toBase58(), data: new Uint8Array([9]) },
      { programId: PENTACLES_PROGRAM_ID.toBase58(), data: new Uint8Array([7, 7]) },
      { programId: token2022.toBase58(), data: new Uint8Array([8]) },
    ])
  })

  test('getTransaction resolves a legacy message, and has no list when CPIs were not recorded', () => {
    const message = new Message({
      header,
      accountKeys: [payer.toBase58(), computeBudget.toBase58()],
      recentBlockhash: blockhash,
      instructions: [{ programIdIndex: 1, accounts: [], data: bs58.encode(new Uint8Array([3])) }],
    })

    expect(transactionLogEntry(SIGNATURE, { transaction: { message }, meta: { innerInstructions: [] } })?.instructions)
      .toEqual([{ programId: computeBudget.toBase58(), data: new Uint8Array([3]) }])
    expect(transactionLogEntry(SIGNATURE, { transaction: { message }, meta: {} })?.instructions).toBeNull()
    expect(transactionLogEntry(SIGNATURE, { transaction: { message }, meta: { innerInstructions: null } })?.instructions)
      .toBeNull()
  })
})

// ── The stream, over a fake RPC ─────────────────────────────────────────────

const CONFIG: ClusterConfig = {
  caip2: 'solana:devnet',
  cluster: 'devnet',
  genesisHash: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  endpoints: ['http://rpc.invalid'],
  mainnet: false,
}

const sig = (n: number) => bs58.encode(new Uint8Array(64).fill(n))

const balanceTx = (amount: string) => ({
  meta: {
    err: null,
    logMessages: [],
    preTokenBalances: [],
    postTokenBalances: [{ accountIndex: 1, mint: SPIRIT, owner: OWNER, uiTokenAmount: { amount } }],
  },
})

type Signatures = Record<string, Array<{ signature: string; slot: number; err: unknown }>>

/** A web3.js Connection stand-in that never touches the network. */
function fakeRpc(transactions: Record<string, unknown>, signatures: Signatures = {}) {
  const listeners = new Map<number, { address: string; callback: (logs: unknown) => void }>()
  const fetched: string[] = []
  let nextId = 0
  return {
    listeners,
    fetched,
    notify(address: PublicKey, signature: string, err: unknown = null) {
      for (const listener of listeners.values()) {
        if (listener.address === address.toBase58()) listener.callback({ signature, logs: [], err })
      }
    },
    onLogs(address: PublicKey, callback: (logs: unknown) => void) {
      listeners.set(nextId, { address: address.toBase58(), callback })
      return nextId++
    },
    async removeOnLogsListener(id: number) {
      listeners.delete(id)
    },
    async getSignaturesForAddress(address: PublicKey) {
      return [...(signatures[address.toBase58()] ?? [])]
    },
    async getTransaction(signature: string) {
      fetched.push(signature)
      return transactions[signature] ?? null
    },
  }
}

async function until(condition: () => boolean, what: string) {
  const deadline = Date.now() + 2_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

async function openStream(rpc: ReturnType<typeof fakeRpc>, addresses: PublicKey[], pollIntervalMs = 60_000) {
  const delivered: LogEntry[] = []
  const stream = await createResilientLogStream({
    addresses,
    config: CONFIG,
    pollIntervalMs,
    geyserEndpoint: '',
    connect: () => rpc as any,
    onLogs: async (entry) => {
      delivered.push(entry)
    },
  })
  return { stream, delivered }
}

describe('multi-address log stream', () => {
  const [spiritMint, essenceMint] = asolEsmsMints()
  const addresses = [PENTACLES_PROGRAM_ID, spiritMint, essenceMint]

  test('the WebSocket tier subscribes to every address and delivers balances it fetched', async () => {
    const rpc = fakeRpc({ [sig(1)]: balanceTx('5000') })
    const { stream, delivered } = await openStream(rpc, addresses)
    try {
      expect(stream.activeTier()).toBe('websocket')
      expect([...rpc.listeners.values()].map((l) => l.address)).toEqual(addresses.map((a) => a.toBase58()))

      // An ASOL mint never invokes Pentacles; it reaches the stream through its mint.
      rpc.notify(spiritMint, sig(1))
      await until(() => delivered.length === 1, 'the mint notification')

      expect(delivered[0].signature).toBe(sig(1))
      expect(delivered[0].meta?.postTokenBalances).toEqual(balanceTx('5000').meta.postTokenBalances)
    } finally {
      await stream.stop()
    }
    expect(rpc.listeners.size).toBe(0)
  })

  test('a transaction listing several watched addresses is delivered once', async () => {
    const rpc = fakeRpc({ [sig(2)]: balanceTx('9') })
    const { stream, delivered } = await openStream(rpc, addresses)
    try {
      rpc.notify(PENTACLES_PROGRAM_ID, sig(2))
      rpc.notify(spiritMint, sig(2))
      await until(() => delivered.length === 1, 'the first delivery')
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(delivered).toHaveLength(1)
      // Whichever subscription wins, the entry still carries the balances.
      expect(delivered[0].meta?.postTokenBalances).toHaveLength(1)
    } finally {
      await stream.stop()
    }
  })

  test('failed transactions are not fetched', async () => {
    const rpc = fakeRpc({ [sig(3)]: balanceTx('1') })
    const { stream, delivered } = await openStream(rpc, addresses)
    try {
      rpc.notify(spiritMint, sig(3), { InstructionError: [0, 'Custom'] })
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(rpc.fetched).toEqual([])
      expect(delivered).toEqual([])
    } finally {
      await stream.stop()
    }
  })

  test('polling covers every address, oldest slot first, with balances', async () => {
    const rpc = fakeRpc(
      { [sig(4)]: balanceTx('40'), [sig(5)]: balanceTx('50'), [sig(6)]: balanceTx('60') },
      {
        // getSignaturesForAddress answers newest first.
        [PENTACLES_PROGRAM_ID.toBase58()]: [{ signature: sig(6), slot: 30, err: null }],
        [spiritMint.toBase58()]: [
          { signature: sig(5), slot: 20, err: null },
          { signature: sig(7), slot: 15, err: { InstructionError: [0, 'Custom'] } },
          { signature: sig(4), slot: 10, err: null },
        ],
        [essenceMint.toBase58()]: [{ signature: sig(6), slot: 30, err: null }],
      },
    )
    const { stream, delivered } = await openStream(rpc, addresses, 5)
    try {
      await until(() => delivered.length === 3, 'a polling pass')

      expect(delivered.map((entry) => entry.signature)).toEqual([sig(4), sig(5), sig(6)])
      expect(delivered.map((entry) => entry.meta?.postTokenBalances[0].uiTokenAmount?.amount)).toEqual([
        '40',
        '50',
        '60',
      ])
      // sig(6) is listed under two addresses and fetched once; the failure never is.
      expect(rpc.fetched.filter((s) => s === sig(6))).toHaveLength(1)
      expect(rpc.fetched).not.toContain(sig(7))

      // Later passes find nothing new to deliver.
      const fetchedAfterFirstPass = rpc.fetched.length
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(delivered).toHaveLength(3)
      expect(rpc.fetched.length).toBe(fetchedAfterFirstPass)
    } finally {
      await stream.stop()
    }
  })

  test('a transaction the node cannot return yet is backfilled by polling, not dropped', async () => {
    const transactions: Record<string, unknown> = {}
    const rpc = fakeRpc(transactions, {
      [spiritMint.toBase58()]: [{ signature: sig(8), slot: 40, err: null }],
    })
    const { stream, delivered } = await openStream(rpc, addresses, 100)
    try {
      rpc.notify(spiritMint, sig(8))
      await until(() => rpc.fetched.includes(sig(8)), 'the WebSocket fetch')
      await new Promise((resolve) => setTimeout(resolve, 10))
      expect(delivered).toEqual([])

      // The node catches up; the next polling pass must still deliver it.
      transactions[sig(8)] = balanceTx('80')
      await until(() => delivered.length === 1, 'the polling backfill')

      expect(delivered[0].signature).toBe(sig(8))
      expect(delivered[0].meta?.postTokenBalances[0].uiTokenAmount?.amount).toBe('80')
    } finally {
      await stream.stop()
    }
  })
})
