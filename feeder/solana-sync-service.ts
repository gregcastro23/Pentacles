// ============================================================
// Pentacles — Solana event sync
// ============================================================
// Two ingestion paths, both structural:
//
//   StarVault  → Anchor events emitted by `pentacles_solana`, decoded from the
//                `Program data:` log line as discriminator + Borsh.
//   ESMS       → Token-2022 balance deltas on ASOL's four mints, read from a
//                transaction's pre/post token balances, and credited only when
//                the transaction's ASOL instructions are claims or redeems.
//
// Both replace regex over `msg!` strings. The previous implementation matched
// patterns like /Minted (\d+) units of ESMS element (\d+) for (...)/ against log
// text, so rewording a log line broke ingestion silently — no error, no test
// failure, just events that stopped arriving. It also parsed the transfer-hook
// event out of a `msg!` line even though the program was already emitting a
// typed event right beside it.

import { Connection, PublicKey } from "@solana/web3.js";
import { cliCall, type CliArg } from "./spacetime-cli";
import {
  assertGenesis,
  createResilientLogStream,
  resolveCluster,
  type ExecutedInstruction,
  type TokenBalance,
} from "./solana-cluster";
import {
  ASOL_PROGRAM_ID,
  asolEsmsMints,
  caip2ToBridgeChain,
  PENTACLES_PROGRAM_ID,
} from "../src/web3/chains.js";

if (process.env.NODE_ENV === "production") {
  if (!process.env.SPACETIMEDB_DB) {
    throw new Error("SPACETIMEDB_DB must be explicitly set in production environments.");
  }
  if (!process.env.SPACETIME_TOKEN) {
    throw new Error("SPACETIME_TOKEN must be set in production environments.");
  }
}

const DB = process.env.SPACETIMEDB_DB ?? "pentacles1";
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";

const cluster = resolveCluster();
const PROGRAM_ID = process.env.SOLANA_PROGRAM_ID
  ? new PublicKey(process.env.SOLANA_PROGRAM_ID)
  : PENTACLES_PROGRAM_ID;
const ESMS_MINTS = asolEsmsMints();
const ESMS_MINT_INDEX = new Map(ESMS_MINTS.map((mint, id) => [mint.toBase58(), id]));

/**
 * `BridgeChain` as a reducer argument. SpacetimeDB decodes a sum type from
 * SATS-JSON `{ "<variant>": <payload> }`, with the variant name in lowerCamel
 * and `[]` as a unit variant's payload. The feeder used to send
 * `{ "tag": "SolanaToken2022" }`, which the module rejects as unknown variant
 * `tag`, so every Solana sync reducer call failed to decode.
 */
export function bridgeChainArg(caip2: string): Record<string, []> {
  const variant: string = caip2ToBridgeChain(caip2);
  return { [variant.charAt(0).toLowerCase() + variant.slice(1)]: [] };
}

/**
 * The `BridgeChain` naming this cluster. It is passed to every reducer so
 * idempotency is scoped per cluster — a base58 signature is valid on devnet
 * and mainnet alike, and an unscoped key lets one block the other.
 */
const BRIDGE_CHAIN = bridgeChainArg(cluster.caip2);

const MAX_U64 = (1n << 64n) - 1n;

export interface EsmsEvent {
  signature: string;
  eventType: "mint" | "burn";
  player: string;
  elementId: number;
  /** ASOL's 4-decimal atoms. Always BigInt — never widened through Number. */
  amount: bigint;
  timestamp: number;
}

export interface TransferHookEvent {
  signature: string;
  fromWallet: string;
  toWallet: string;
  amount: bigint;
  timestamp: number;
}

export interface StarStakeEvent {
  signature: string;
  staker: string;
  starId: number;
  principalUsdc: bigint;
  shares: bigint;
  timestamp: number;
}

export interface StarUnstakeEvent {
  signature: string;
  staker: string;
  starId: number;
  principalUsdc: bigint;
  positionPrincipal: bigint;
  timestamp: number;
}

// ── Lossless reducer argument encoding ──────────────────────────────────────

/**
 * Encode a reducer argument tuple, emitting u64 values as unquoted JSON
 * integers.
 *
 * SpacetimeDB's SATS decoder wants an unquoted integer for u64, and
 * JSON.stringify refuses BigInt outright — so the arguments are assembled by
 * hand. Routing the value through Number instead would silently corrupt
 * anything above 2^53, which for 4-decimal ESMS is any amount over ~900 billion
 * tokens, and for 6-decimal USDC any amount over ~9 billion.
 */
export function encodeReducerArgs(args: ReadonlyArray<unknown>): string {
  const encoded = args.map((value) => {
    if (typeof value === "bigint") {
      if (value < 0n || value > MAX_U64) {
        throw new RangeError(`reducer argument ${value} does not fit in u64`);
      }
      return value.toString();
    }
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      throw new RangeError(`reducer argument ${value} is not a safe integer; pass a BigInt`);
    }
    return JSON.stringify(value);
  });
  return `[${encoded.join(",")}]`;
}

/** Kept for the existing regression suite, which pins the u64 encoding. */
export function encodeSolanaSyncBody(event: EsmsEvent): string {
  if (event.amount < 0n || event.amount > MAX_U64) {
    throw new RangeError("Solana event amount must fit in u64");
  }
  return encodeReducerArgs([
    BRIDGE_CHAIN,
    event.signature,
    event.player,
    event.eventType,
    event.elementId,
    event.amount,
  ]);
}

/**
 * Reducer arguments for the `spacetime call` fallback. The CLI forwards a value
 * verbatim only when it is marked raw, and the chain enum is already SATS-JSON.
 */
export function cliReducerArgs(args: ReadonlyArray<unknown>): CliArg[] {
  return args.map((value) =>
    typeof value === "object" && value !== null ? { raw: JSON.stringify(value) } : (value as CliArg),
  );
}

async function callReducer(name: string, args: ReadonlyArray<unknown>): Promise<void> {
  if (SPACETIME_TOKEN) {
    const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SPACETIME_TOKEN}`,
      },
      body: encodeReducerArgs(args),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${name} status ${res.status}: ${text}`);
    }
    return;
  }
  await cliCall(DB, name, cliReducerArgs(args));
}

// ── Anchor event decoding ───────────────────────────────────────────────────

/** sha256("event:<Name>")[0..8], pinned in tests/solana-instructions.test.ts. */
const EVENT_DISCRIMINATORS: Record<string, number[]> = {
  StarStaked: [196, 97, 37, 231, 187, 111, 123, 3],
  StarUnstaked: [162, 83, 72, 193, 72, 117, 207, 119],
  StarActivated: [242, 179, 139, 209, 85, 255, 232, 202],
  StarStakeTransferred: [204, 122, 16, 230, 79, 217, 84, 82],
};

/** Minimal Borsh cursor for the fixed-width event layouts above. */
class BorshReader {
  private offset = 0;
  constructor(private readonly buffer: Buffer) {}
  pubkey(): string {
    const key = new PublicKey(this.buffer.subarray(this.offset, this.offset + 32));
    this.offset += 32;
    return key.toBase58();
  }
  u32(): number {
    const value = this.buffer.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }
  u64(): bigint {
    const value = this.buffer.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }
  i64(): bigint {
    const value = this.buffer.readBigInt64LE(this.offset);
    this.offset += 8;
    return value;
  }
}

/**
 * Decode Anchor events emitted by `expectedProgramId` from a transaction's log lines.
 *
 * Scopes by program ID: parses the Solana `Program <id> invoke` / `Program <id> success`
 * frame stack so that same-named events with identical Anchor discriminators emitted by
 * other programs (such as ASOL) on the same cluster are never decoded into Pentacles state.
 */
export function decodeAnchorEvents(
  logs: string[],
  expectedProgramId: PublicKey | string = PROGRAM_ID,
): Array<{ name: string; data: BorshReader; programId?: string }> {
  const targetId = typeof expectedProgramId === "string" ? expectedProgramId : expectedProgramId.toBase58();
  const events: Array<{ name: string; data: BorshReader; programId?: string }> = [];
  const programStack: string[] = [];

  for (const rawLine of logs) {
    const line = rawLine.trim();

    const invokeMatch = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[\d+\]$/.exec(line);
    if (invokeMatch) {
      programStack.push(invokeMatch[1]);
      continue;
    }

    const returnMatch = /^Program ([1-9A-HJ-NP-Za-km-z]+) (success|failed:)/.exec(line);
    if (returnMatch) {
      if (programStack.length > 0) {
        const top = programStack[programStack.length - 1];
        if (top === returnMatch[1]) {
          programStack.pop();
        } else {
          const idx = programStack.lastIndexOf(returnMatch[1]);
          if (idx !== -1) {
            programStack.splice(idx);
          } else {
            programStack.pop();
          }
        }
      }
      continue;
    }

    const match = /^Program data: (.+)$/.exec(line);
    if (!match) continue;

    // Attribute line to the active invoking program if stack is present.
    const currentProgram = programStack.length > 0 ? programStack[programStack.length - 1] : targetId;
    if (currentProgram !== targetId) {
      continue;
    }

    let payload: Buffer;
    try {
      payload = Buffer.from(match[1], "base64");
    } catch {
      continue;
    }
    if (payload.length < 8) continue;
    const discriminator = Array.from(payload.subarray(0, 8));
    for (const [name, expected] of Object.entries(EVENT_DISCRIMINATORS)) {
      if (expected.every((byte, index) => byte === discriminator[index])) {
        events.push({ name, data: new BorshReader(payload.subarray(8)), programId: currentProgram });
        break;
      }
    }
  }
  return events;
}

// ── ESMS supply changes, read from Token-2022 balances ──────────────────────

/** Raw atoms in a token balance, or null when the amount is not a u64 string. */
function balanceAtoms(balance: TokenBalance): bigint | null {
  const amount = balance.uiTokenAmount?.amount;
  return typeof amount === "string" && /^\d+$/.test(amount) ? BigInt(amount) : null;
}

/**
 * Derive ESMS mint/burn events from a transaction's token balance deltas.
 *
 * ASOL owns ESMS issuance, and Pentacles has no IDL for its events. Balance
 * deltas are the structural alternative: the runtime reports pre- and
 * post-balances for every token account a transaction touched, so a supply
 * change is observable without knowing the instruction that caused it. ASOL's
 * mints are NonTransferable, so a balance on them moves only by a mint or a
 * burn.
 *
 * Emits at most one event per wallet, element and direction. A single ASOL
 * redeem burns up to all four elements under one signature, and
 * `sync_solana_event` settles each of those tuples once.
 */
export function esmsEventsFromBalances(
  signature: string,
  meta: {
    preTokenBalances?: TokenBalance[] | null;
    postTokenBalances?: TokenBalance[] | null;
  } | null | undefined,
  timestamp: number,
): EsmsEvent[] {
  if (!meta) return [];

  // Balances per token account. An account the transaction opened has no pre
  // entry, and one it closed (a burn, then close) has no post entry; either
  // missing side is zero. An unreadable amount is null and skips the account.
  const accounts = new Map<number, { mint: string; owner?: string; pre: bigint | null; post: bigint | null }>();
  const read = (balances: TokenBalance[] | null | undefined, side: "pre" | "post") => {
    for (const balance of balances ?? []) {
      if (!ESMS_MINT_INDEX.has(balance.mint)) continue;
      const account = accounts.get(balance.accountIndex) ?? { mint: balance.mint, pre: 0n, post: 0n };
      account[side] = balanceAtoms(balance);
      account.owner = balance.owner || account.owner;
      accounts.set(balance.accountIndex, account);
    }
  };
  read(meta.preTokenBalances, "pre");
  read(meta.postTokenBalances, "post");

  const events = new Map<string, EsmsEvent>();
  for (const { mint, owner, pre, post } of accounts.values()) {
    if (pre === null || post === null || !owner || pre === post) continue;
    const elementId = ESMS_MINT_INDEX.get(mint)!;
    const eventType = post > pre ? "mint" : "burn";
    const amount = post > pre ? post - pre : pre - post;
    const key = `${owner}:${elementId}:${eventType}`;
    const event = events.get(key);
    if (event) event.amount += amount;
    else events.set(key, { signature, eventType, player: owner, elementId, amount, timestamp });
  }
  return [...events.values()];
}

const ASOL_PROGRAM = ASOL_PROGRAM_ID.toBase58();

/**
 * ASOL's instructions that issue or redeem ESMS, by Anchor discriminator
 * (sha256("global:<name>")[0..8], as in ASOL's IDL). Pinned in
 * tests/solana-sync-service.test.ts.
 */
const ESMS_SUPPLY_INSTRUCTIONS: Record<string, number[]> = {
  claim_mint_esms: [194, 59, 120, 134, 151, 157, 193, 239],
  claim_star_yield: [171, 89, 21, 11, 39, 79, 237, 123],
  redeem_esms: [182, 20, 159, 192, 104, 83, 177, 113],
  redeem_for_esms: [86, 175, 194, 240, 164, 243, 199, 163],
};

/**
 * Whether a transaction's ESMS balance changes are issuance or redemption.
 *
 * ASOL's AMM moves ESMS balances with the same mint and burn calls: `swap_esms`
 * burns the input element and mints the output, `add_liquidity` burns both
 * sides and `withdraw_liquidity` mints them back. Balance deltas cannot tell
 * those trades from a claim or a redeem, and crediting them would let a player
 * farm jing by trading back and forth. So every ASOL instruction in the
 * transaction, top-level or CPI, must be a claim or a redeem. Only ASOL can
 * mint or burn ESMS, so a transaction with no ASOL instruction, or with an
 * unknown instruction list, does not qualify either.
 */
export function isEsmsSupplyTransaction(instructions: ExecutedInstruction[] | null | undefined): boolean {
  const asol = (instructions ?? []).filter((instruction) => instruction.programId === ASOL_PROGRAM);
  return (
    asol.length > 0 &&
    asol.every(({ data }) =>
      Object.values(ESMS_SUPPLY_INSTRUCTIONS).some((discriminator) =>
        discriminator.every((byte, index) => data[index] === byte),
      ),
    )
  );
}

/** The ESMS events a delivered transaction settles: its balance deltas, if it is a claim or a redeem. */
export function esmsEventsForTransaction(
  entry: {
    signature: string;
    meta?: Parameters<typeof esmsEventsFromBalances>[1];
    instructions?: ExecutedInstruction[] | null;
  },
  timestamp: number,
): EsmsEvent[] {
  if (!isEsmsSupplyTransaction(entry.instructions)) return [];
  return esmsEventsFromBalances(entry.signature, entry.meta, timestamp);
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export async function syncEsmsEvent(event: EsmsEvent): Promise<void> {
  await callReducer("sync_solana_event", [
    BRIDGE_CHAIN,
    event.signature,
    event.player,
    event.eventType,
    event.elementId,
    event.amount,
  ]);
  console.log(
    `[SolanaSync] ${event.eventType} ${event.amount} atoms of element ${event.elementId} (${event.signature.slice(0, 12)}…)`,
  );
}

export async function syncTransferHookToSpacetime(event: TransferHookEvent): Promise<void> {
  // `token_amount` used to be coerced to a JS number on its way out. This file
  // already had a lossless encoder for the mint/burn path; the transfer-hook
  // path simply did not use it, so a u64 was pushed through a double on the way
  // to a reducer that expects exact units.
  await callReducer("transfer_star_stake", [
    event.signature,
    event.fromWallet,
    event.toWallet,
    event.amount,
  ]);
  console.log(
    `[SolanaSync] star stake transfer ${event.fromWallet.slice(0, 8)}… → ${event.toWallet.slice(0, 8)}…`,
  );
}

export async function syncStarStake(event: StarStakeEvent): Promise<void> {
  await callReducer("record_star_stake", [
    BRIDGE_CHAIN,
    event.signature,
    event.staker,
    event.starId,
    event.principalUsdc,
    event.shares,
  ]);
  console.log(
    `[SolanaSync] star ${event.starId} staked ${event.principalUsdc} USDC units by ${event.staker.slice(0, 8)}…`,
  );
}

export async function syncStarUnstake(event: StarUnstakeEvent): Promise<void> {
  await callReducer("record_star_unstake", [
    BRIDGE_CHAIN,
    event.signature,
    event.staker,
    event.starId,
    event.principalUsdc,
    event.positionPrincipal,
  ]);
  console.log(
    `[SolanaSync] star ${event.starId} unstaked ${event.principalUsdc} USDC units by ${event.staker.slice(0, 8)}… (remaining: ${event.positionPrincipal})`,
  );
}

/** Route one transaction's logs and balances into the ledger. */
export async function handleTransaction(entry: {
  signature: string;
  logs: string[];
  meta?: Parameters<typeof esmsEventsFromBalances>[1];
  instructions?: ExecutedInstruction[] | null;
}): Promise<void> {
  const timestamp = Date.now();

  for (const { name, data } of decodeAnchorEvents(entry.logs)) {
    try {
      if (name === "StarStaked") {
        const staker = data.pubkey();
        const starId = data.u32();
        const principalUsdc = data.u64();
        await syncStarStake({
          signature: entry.signature,
          staker,
          starId,
          principalUsdc,
          shares: principalUsdc,
          timestamp,
        });
      } else if (name === "StarStakeTransferred") {
        await syncTransferHookToSpacetime({
          signature: entry.signature,
          fromWallet: data.pubkey(),
          toWallet: data.pubkey(),
          amount: data.u64(),
          timestamp,
        });
      } else if (name === "StarUnstaked") {
        const staker = data.pubkey();
        const starId = data.u32();
        const principalUsdc = data.u64();
        const positionPrincipal = data.u64();
        await syncStarUnstake({
          signature: entry.signature,
          staker,
          starId,
          principalUsdc,
          positionPrincipal,
          timestamp,
        });
      }
    } catch (err) {
      console.error(`[SolanaSync] ${name} sync failed:`, (err as Error)?.message ?? err);
    }
  }

  if (!entry.instructions && esmsEventsFromBalances(entry.signature, entry.meta, timestamp).length) {
    // AMM trades are skipped routinely; an unrecorded instruction list is not
    // routine, and it silently withholds real claims and redeems.
    console.warn(
      `[SolanaSync] ${entry.signature} changed ESMS balances, but the node did not record its instructions; not credited`,
    );
  }
  for (const event of esmsEventsForTransaction(entry, timestamp)) {
    try {
      await syncEsmsEvent(event);
    } catch (err) {
      console.error(`[SolanaSync] ESMS sync failed:`, (err as Error)?.message ?? err);
    }
  }
}

/**
 * Every account the ingestion stream watches.
 *
 * The Pentacles program emits the StarVault events. ESMS supply changes are
 * watched on ASOL's four mints instead of on any program: a Token-2022 mint or
 * burn writes the mint's supply, so every transaction that changes it lists the
 * mint, whichever program or relayer submitted it. Watching the Pentacles
 * program alone saw none of them.
 */
export function ingestionAddresses(): PublicKey[] {
  return [PROGRAM_ID, ...ESMS_MINTS];
}

export async function main(): Promise<void> {
  console.log(
    `[SolanaSync] cluster ${cluster.caip2} · pentacles ${PROGRAM_ID.toBase58()} · ${ESMS_MINTS.length} ASOL mints`,
  );

  // Prove the endpoint serves the cluster we declared before ingesting anything
  // attributed to it. Mislabelled events are worse than missing ones.
  await assertGenesis(new Connection(cluster.endpoints[0], "confirmed"), cluster);

  const stream = await createResilientLogStream({
    addresses: ingestionAddresses(),
    config: cluster,
    onLogs: async (entry) => {
      if (entry.err) return;
      await handleTransaction(entry);
    },
  });

  setInterval(() => {
    const tier = stream.activeTier();
    if (tier === "down") console.warn("[SolanaSync] all ingestion tiers are down");
  }, 60_000);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[SolanaSync] fatal:", (err as Error)?.message ?? err);
    process.exit(1);
  });
}
