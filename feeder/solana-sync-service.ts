// ============================================================
// Pentacles — Solana event sync
// ============================================================
// Two ingestion paths, both structural:
//
//   StarVault  → Anchor events emitted by `pentacles_solana`, decoded from the
//                `Program data:` log line as discriminator + Borsh.
//   ESMS       → Token-2022 balance deltas on ASOL's four mints, read from a
//                transaction's pre/post token balances.
//
// Both replace regex over `msg!` strings. The previous implementation matched
// patterns like /Minted (\d+) units of ESMS element (\d+) for (...)/ against log
// text, so rewording a log line broke ingestion silently — no error, no test
// failure, just events that stopped arriving. It also parsed the transfer-hook
// event out of a `msg!` line even though the program was already emitting a
// typed event right beside it.

import { Connection, PublicKey } from "@solana/web3.js";
import { cliCall } from "./spacetime-cli";
import { assertGenesis, createResilientLogStream, resolveCluster } from "./solana-cluster";
import { asolEsmsMints, PENTACLES_PROGRAM_ID } from "../src/web3/chains.js";

if (process.env.NODE_ENV === "production") {
  if (!process.env.SPACETIMEDB_DB) {
    throw new Error("SPACETIMEDB_DB must be explicitly set in production environments.");
  }
  if (!process.env.SPACETIME_TOKEN) {
    throw new Error("SPACETIME_TOKEN must be set in production environments.");
  }
}

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";

const cluster = resolveCluster();
const PROGRAM_ID = process.env.SOLANA_PROGRAM_ID
  ? new PublicKey(process.env.SOLANA_PROGRAM_ID)
  : PENTACLES_PROGRAM_ID;
const ESMS_MINTS = asolEsmsMints();
const ESMS_MINT_INDEX = new Map(ESMS_MINTS.map((mint, id) => [mint.toBase58(), id]));

/**
 * The `BridgeChain` variant naming this cluster. It is passed to every reducer
 * so idempotency is scoped per cluster — a base58 signature is valid on devnet
 * and mainnet alike, and an unscoped key lets one block the other.
 */
const BRIDGE_CHAIN =
  cluster.caip2 === "solana:mainnet-beta" ? "SolanaMainnetToken2022" : "SolanaToken2022";

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
    { tag: BRIDGE_CHAIN },
    event.signature,
    event.player,
    event.eventType,
    event.elementId,
    event.amount,
  ]);
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
  await cliCall(DB, name, args as unknown[]);
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

/**
 * Derive ESMS mint/burn events from a transaction's token balance deltas.
 *
 * ASOL owns ESMS issuance, and Pentacles has no IDL for its events. Balance
 * deltas are the structural alternative: the runtime reports pre- and
 * post-balances for every token account a transaction touched, so a supply
 * change is observable without knowing the instruction that caused it.
 */
export function esmsEventsFromBalances(
  signature: string,
  meta: {
    preTokenBalances?: Array<{ accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }> | null;
    postTokenBalances?: Array<{ accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }> | null;
  } | null | undefined,
  timestamp: number,
): EsmsEvent[] {
  if (!meta?.postTokenBalances?.length) return [];
  const before = new Map(
    (meta.preTokenBalances ?? []).map((entry) => [entry.accountIndex, entry]),
  );

  const events: EsmsEvent[] = [];
  for (const post of meta.postTokenBalances) {
    const elementId = ESMS_MINT_INDEX.get(post.mint);
    if (elementId === undefined || !post.owner) continue;
    const priorAmount = BigInt(before.get(post.accountIndex)?.uiTokenAmount.amount ?? "0");
    const delta = BigInt(post.uiTokenAmount.amount) - priorAmount;
    if (delta === 0n) continue;
    events.push({
      signature,
      eventType: delta > 0n ? "mint" : "burn",
      player: post.owner,
      elementId,
      amount: delta > 0n ? delta : -delta,
      timestamp,
    });
  }
  return events;
}

// ── Dispatch ────────────────────────────────────────────────────────────────

export async function syncEsmsEvent(event: EsmsEvent): Promise<void> {
  await callReducer("sync_solana_event", [
    { tag: BRIDGE_CHAIN },
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
    { tag: BRIDGE_CHAIN },
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
    { tag: BRIDGE_CHAIN },
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

  for (const event of esmsEventsFromBalances(entry.signature, entry.meta, timestamp)) {
    try {
      await syncEsmsEvent(event);
    } catch (err) {
      console.error(`[SolanaSync] ESMS sync failed:`, (err as Error)?.message ?? err);
    }
  }
}

export async function main(): Promise<void> {
  console.log(
    `[SolanaSync] cluster ${cluster.caip2} · pentacles ${PROGRAM_ID.toBase58()} · ${ESMS_MINTS.length} ASOL mints`,
  );

  // Prove the endpoint serves the cluster we declared before ingesting anything
  // attributed to it. Mislabelled events are worse than missing ones.
  await assertGenesis(new Connection(cluster.endpoints[0], "confirmed"), cluster);

  const stream = await createResilientLogStream({
    programId: PROGRAM_ID,
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
