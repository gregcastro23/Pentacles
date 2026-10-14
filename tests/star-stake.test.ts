import { describe, expect, mock, test } from 'bun:test';
import { STAR_STAKE_VIEW, readClaimableStarStake } from '../src/net/star-stake.js';
import { tables } from '../src/module_bindings';

const ME = '0x' + 'ab'.repeat(32);
const OTHER = '0x' + 'cd'.repeat(32);
const stake = { stake_id: '42', staker: ME, accrued_essence: '1000000000000000000', pending_essence: '0' };

class FakeClient {
  isLive = true;
  identity: string | null = ME;
  rows: any[] = [stake];
  applied = false;
  applyAfterMs: number | null = 5;
  subscribed: string[] = [];
  listeners = new Set<(rows: any[]) => void>();
  isApplied(table: string) { return table === STAR_STAKE_VIEW && this.applied; }
  subscribe(table: string, cb: (rows: any[]) => void) {
    this.subscribed.push(table);
    this.listeners.add(cb);
    if (this.applied) cb([...this.rows]);
    else {
      queueMicrotask(() => this.listeners.has(cb) && cb([]));
      if (this.applyAfterMs !== null) setTimeout(() => {
        this.applied = true;
        for (const l of this.listeners) l([...this.rows]);
      }, this.applyAfterMs);
    }
    return () => { this.listeners.delete(cb); };
  }
}

describe('readClaimableStarStake', () => {
  test('waits for the view to apply and returns the row used by the claim action', async () => {
    const c = new FakeClient();
    expect(await readClaimableStarStake(c, { timeoutMs: 500 })).toEqual(stake);
    expect(c.subscribed).toEqual([STAR_STAKE_VIEW]);
    expect(c.listeners.size).toBe(0);
  });

  test('skips another player, zero yield, and an already pending claim', async () => {
    const c = new FakeClient();
    c.applied = true;
    c.rows = [
      { ...stake, stake_id: '1', staker: OTHER },
      { ...stake, stake_id: '2', accrued_essence: 0n },
      { ...stake, stake_id: '3', pending_essence: 1n },
      { ...stake, stake_id: '4', accrued_essence: 1n },
      { ...stake, stake_id: '5', accrued_essence: 2n },
    ];
    expect((await readClaimableStarStake(c))?.stake_id).toBe('4');
    expect(c.listeners.size).toBe(0); // synchronous replay released the listener
  });

  test('matches normalized staker identity and keeps u128 precision', async () => {
    const c = new FakeClient();
    c.applied = true;
    c.rows = [{ ...stake, staker: { __identity__: ME.slice(2).toUpperCase() }, accrued_essence: '340282366920938463463374607431768211455' }];
    expect((await readClaimableStarStake(c))?.accrued_essence).toBe('340282366920938463463374607431768211455');
  });

  test('an applied view with no claimable stake returns null', async () => {
    const c = new FakeClient();
    c.applied = true;
    c.rows = [];
    expect(await readClaimableStarStake(c)).toBeNull();
    c.rows = [{ ...stake, pending_essence: 5n }, { ...stake, accrued_essence: 0n }];
    expect(await readClaimableStarStake(c)).toBeNull();
  });

  test('a module missing the view returns null at the deadline and unsubscribes', async () => {
    const c = new FakeClient();
    c.applyAfterMs = null;
    expect(await readClaimableStarStake(c, { timeoutMs: 20 })).toBeNull();
    expect(c.listeners.size).toBe(0);
  });

  test('null, offline, or unidentified clients never subscribe', async () => {
    expect(await readClaimableStarStake(null)).toBeNull();
    const c = new FakeClient();
    c.isLive = false;
    expect(await readClaimableStarStake(c)).toBeNull();
    c.isLive = true;
    c.identity = null;
    expect(await readClaimableStarStake(c)).toBeNull();
    expect(c.subscribed).toEqual([]);
  });

  test('the view is available to the WebSocket generated bindings', () => {
    expect(Object.hasOwn(tables, 'myStarStake')).toBe(true);
  });
});

// Exercise the actual UI action; chain/browser setup is irrelevant to locking
// a ledger claim, so mock only those setup dependencies and keep the reader real.
mock.module('@solana/web3.js', () => ({
  PublicKey: class {}, Transaction: class {}, ComputeBudgetProgram: {},
}));
mock.module('@solana/spl-token', () => ({
  createTransferCheckedWithTransferHookInstruction() {},
  getAssociatedTokenAddressSync() {},
  TOKEN_2022_PROGRAM_ID: {},
}));
mock.module('../src/web3/wallet.js', () => ({
  wallet: { solanaAddress: 'connected-wallet', address: null },
}));
mock.module('../src/web3/solana.js', () => ({
  buildStakeStarInstruction() {},
  buildUnstakeStarInstruction() {},
  prepareStarVaultTransaction() {},
  readSolanaEsmsBalances: async () => [],
  solanaConnection: {},
}));
mock.module('../src/net/spacetime.js', () => ({ default: {} }));

const originalWindow = globalThis.window;
globalThis.window = {} as Window & typeof globalThis;
const { claimYield } = await import('../src/web3/pools-ui.js');
globalThis.window = originalWindow;

describe('claimYield', () => {
  test('reads the caller view and sends the exact u64 stake ID without SQL', async () => {
    const previousWindow = globalThis.window;
    const previousDocument = globalThis.document;
    try {
      const c = new FakeClient();
      c.applied = true;
      c.rows = [{ ...stake, stake_id: '9007199254740993' }];
      const calls: any[] = [];
      const queries: string[] = [];
      const messages: string[] = [];
      const client = Object.assign(c, {
        conn: { reducers: {
          async requestYieldClaim(args: { stakeId: bigint }) { calls.push(args); },
        } },
        async query(sql: string) { queries.push(sql); throw new Error('private SQL forbidden'); },
      });
      globalThis.window = {
        Pentacles: { net: client },
        toast: (message: string) => messages.push(message),
      } as unknown as Window & typeof globalThis;
      globalThis.document = { getElementById: () => null } as unknown as Document;

      await claimYield();
      // The successful action starts an async UI refresh; let that complete
      // before returning the browser globals to another test.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(calls).toEqual([{ stakeId: 9007199254740993n }]);
      expect(queries).toEqual([]);
      expect(c.subscribed).toEqual([STAR_STAKE_VIEW]);
      expect(c.listeners.size).toBe(0);
      expect(messages).toContain('Yield locked. The attestor will mint and settle it shortly.');
    } finally {
      globalThis.window = previousWindow;
      globalThis.document = previousDocument;
    }
  });
});
