// ============================================================
// Pentacles — Solana cluster resolution, genesis guard & RPC failover
// ============================================================
// Two problems this solves, both of which only bite on mainnet.
//
// 1. Cluster confusion. Every Solana entry point in this repo defaulted to
//    `https://api.devnet.solana.com`, so "which network am I on?" was answered
//    by whichever env var happened to be set. Once mainnet exists that is a
//    loaded gun: a stale SOLANA_RPC_URL points a mainnet-intent worker at
//    devnet, or worse the reverse. `resolveCluster()` states the intent
//    explicitly and `assertGenesis()` proves it against the live chain before
//    anything is signed. A genesis hash cannot be spoofed by an RPC URL typo.
//
// 2. Single-point-of-failure ingestion. `connection.onLogs` over one RPC has no
//    reconnect, no backfill, and silently truncates logs on large transactions.
//    A dropped socket meant permanently missed events with no error raised.

import { Connection, PublicKey, type Logs } from "@solana/web3.js";
import bs58 from "bs58";
import { CAIP2, CHAINS, chainFor, isMainnet } from "../src/web3/chains.js";

export interface ClusterConfig {
  caip2: string;
  cluster: string;
  genesisHash: string;
  /** Primary first, then declared fallbacks. Always at least one entry. */
  endpoints: string[];
  mainnet: boolean;
}

/**
 * Resolve the target cluster from the environment.
 *
 * `SOLANA_CLUSTER` is the declaration of intent and takes precedence; it accepts
 * either a CAIP-2 id (`solana:mainnet-beta`) or a bare cluster name
 * (`mainnet-beta`, `devnet`). Absent that, the cluster is inferred from
 * SOLANA_RPC_URL's host, and absent even that it is devnet. Inference is a
 * convenience for local work — mainnet workers should always declare.
 */
export function resolveCluster(env: NodeJS.ProcessEnv = process.env): ClusterConfig {
  const declared = env.SOLANA_CLUSTER?.trim();
  const rpc = env.SOLANA_RPC_URL?.trim();

  let caip2: string;
  if (declared) {
    caip2 = declared.includes(":") ? declared : `solana:${declared}`;
    if (!CHAINS[caip2]) {
      throw new Error(
        `SOLANA_CLUSTER=${declared} is not a known cluster (expected solana:devnet or solana:mainnet-beta)`,
      );
    }
  } else if (rpc && /mainnet/i.test(rpc)) {
    caip2 = CAIP2.solanaMainnet;
  } else {
    caip2 = CAIP2.solanaDevnet;
  }

  const chain = chainFor(caip2);
  const fallbacks = (env.SOLANA_RPC_FALLBACKS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const endpoints = [...new Set([rpc || chain.defaultRpc, ...fallbacks])];

  return {
    caip2,
    cluster: chain.cluster,
    genesisHash: chain.genesisHash,
    endpoints,
    mainnet: isMainnet(caip2),
  };
}

/**
 * Prove the endpoint really serves the cluster we think it does.
 *
 * Call this before the first signature of any run. It is one RPC round trip and
 * it is the only check that cannot be defeated by a misconfigured URL, a
 * forgotten override, or a provider silently routing to the wrong network.
 */
export async function assertGenesis(
  connection: Connection,
  config: ClusterConfig,
): Promise<void> {
  const live = await connection.getGenesisHash();
  if (live !== config.genesisHash) {
    throw new Error(
      `Cluster mismatch: ${connection.rpcEndpoint} reports genesis ${live}, ` +
        `but ${config.caip2} requires ${config.genesisHash}. Refusing to continue.`,
    );
  }
}

/** A Connection over the primary endpoint, plus the fallbacks in order. */
export function connectionsFor(
  config: ClusterConfig,
  commitment: "processed" | "confirmed" | "finalized" = "confirmed",
): Connection[] {
  return config.endpoints.map((endpoint) => new Connection(endpoint, commitment));
}

// ── Multi-tier log ingestion ────────────────────────────────────────────────

export type StreamTier = "geyser" | "websocket" | "polling";

export interface StreamHandle {
  /** Which tier is currently delivering. Observable for the health heartbeat. */
  activeTier(): StreamTier | "down";
  stop(): Promise<void>;
}

/**
 * One SPL token balance. web3.js and Yellowstone use the same field names, but
 * protobuf has no absent string: Geyser sends `owner: ""` where web3.js omits
 * the owner.
 */
export interface TokenBalance {
  accountIndex: number;
  mint: string;
  owner?: string;
  uiTokenAmount?: { amount: string };
}

/** A transaction's SPL token balances before and after it executed. */
export interface TokenBalances {
  preTokenBalances: TokenBalance[];
  postTokenBalances: TokenBalance[];
}

/** One instruction a transaction executed, top-level or through CPI. */
export interface ExecutedInstruction {
  programId: string;
  data: Uint8Array;
}

export interface LogEntry {
  signature: string;
  logs: string[];
  err: unknown;
  /**
   * ESMS mints and burns are read from these balances, and logs carry no
   * balance, so a tier that drops them loses every ESMS event without an
   * error. Null only when the transaction has no status meta.
   */
  meta: TokenBalances | null;
  /**
   * Every instruction the transaction executed, CPIs included, which is what
   * says whether a balance moved by a claim or by a trade. Unlike logs these
   * are never truncated. Null when the node did not record inner instructions,
   * since a partial list cannot prove what ran.
   */
  instructions: ExecutedInstruction[] | null;
}

/** The RPC calls tiers 2 and 3 make. A web3.js `Connection` provides them. */
export type StreamConnection = Pick<
  Connection,
  "onLogs" | "removeOnLogsListener" | "getSignaturesForAddress" | "getTransaction"
>;

export interface StreamOptions {
  /**
   * Deliver every transaction that lists any of these accounts: a program it
   * invokes, or a mint whose supply it changes. A transaction listing several
   * is delivered once.
   */
  addresses: PublicKey[];
  config: ClusterConfig;
  onLogs(entry: LogEntry): Promise<void>;
  /** Polling cadence for the backfill tier, ms. */
  pollIntervalMs?: number;
  commitment?: "confirmed" | "finalized";
  /** Tier 1 endpoint. Defaults to SOLANA_GEYSER_ENDPOINT; blank disables tier 1. */
  geyserEndpoint?: string;
  /** Opens the tier 2 and 3 connections. Defaults to web3.js; tests pass a fake. */
  connect?(endpoint: string, commitment: "confirmed" | "finalized"): StreamConnection;
}

function tokenBalancesOf(meta: any): TokenBalances | null {
  if (!meta) return null;
  return {
    preTokenBalances: meta.preTokenBalances ?? [],
    postTokenBalances: meta.postTokenBalances ?? [],
  };
}

type CompiledInstruction = { programIdIndex: number; data: Uint8Array | string };

/**
 * Resolve compiled instructions to their program ids. Account indexes run over
 * the static keys, then the lookup-table keys loaded writable, then readonly.
 * An index that resolves to nothing makes the list unknowable, so null.
 */
function executedInstructions(
  keys: Array<string | Uint8Array | { toBase58(): string }>,
  topLevel: CompiledInstruction[],
  inner: Array<{ instructions: CompiledInstruction[] }>,
): ExecutedInstruction[] | null {
  const accounts = keys.map((key) =>
    typeof key === "string" ? key : key instanceof Uint8Array ? bs58.encode(key) : key.toBase58(),
  );
  const executed: ExecutedInstruction[] = [];
  for (const { programIdIndex, data } of [...topLevel, ...inner.flatMap((group) => group.instructions)]) {
    const programId = accounts[programIdIndex];
    if (programId === undefined) return null;
    // web3.js returns inner instruction data as base58; everything else is bytes.
    executed.push({ programId, data: typeof data === "string" ? bs58.decode(data) : data });
  }
  return executed;
}

/**
 * Convert one Yellowstone `SubscribeUpdate` into the entry the other tiers deliver.
 *
 * Geyser sends the signature as raw bytes. It must become base58, the form the
 * WebSocket and polling tiers deliver: every reducer's `normalized_solana_signature`
 * check rejects anything else, and the replay guard only dedupes a transaction
 * across tiers when the strings match.
 *
 * Returns null for updates that carry no transaction (slot updates, pings).
 */
export function geyserLogEntry(message: any): LogEntry | null {
  const tx = message?.transaction?.transaction;
  if (!tx?.signature?.length) return null;
  const compiled = tx.transaction?.message;
  const meta = tx.meta;
  return {
    signature: bs58.encode(tx.signature),
    logs: meta?.logMessages ?? [],
    err: meta?.err ?? null,
    meta: tokenBalancesOf(meta),
    instructions:
      compiled && meta && !meta.innerInstructionsNone
        ? executedInstructions(
            [
              ...(compiled.accountKeys ?? []),
              ...(meta.loadedWritableAddresses ?? []),
              ...(meta.loadedReadonlyAddresses ?? []),
            ],
            compiled.instructions ?? [],
            meta.innerInstructions ?? [],
          )
        : null,
  };
}

/** Convert a web3.js `getTransaction` response into the entry every tier delivers. */
export function transactionLogEntry(
  signature: string,
  tx: { meta?: any; transaction?: any } | null,
): LogEntry | null {
  if (!tx) return null;
  const compiled = tx.transaction?.message;
  const meta = tx.meta;
  return {
    signature,
    logs: meta?.logMessages ?? [],
    err: meta?.err ?? null,
    meta: tokenBalancesOf(meta),
    // A missing innerInstructions means the node did not record CPIs, not that
    // there were none.
    instructions:
      compiled && Array.isArray(meta?.innerInstructions)
        ? executedInstructions(
            [
              ...(compiled.staticAccountKeys ?? []),
              ...(meta.loadedAddresses?.writable ?? []),
              ...(meta.loadedAddresses?.readonly ?? []),
            ],
            compiled.compiledInstructions ?? [],
            meta.innerInstructions,
          )
        : null,
  };
}

/** The Yellowstone subscription for every transaction that lists any of `addresses`. */
export function geyserSubscribeRequest(
  addresses: PublicKey[],
  commitment: "confirmed" | "finalized",
) {
  return {
    accounts: {},
    slots: {},
    transactions: {
      pentacles: {
        // Matches a transaction that lists any one of these.
        accountInclude: addresses.map((address) => address.toBase58()),
        accountExclude: [],
        accountRequired: [],
      },
    },
    blocks: {},
    blocksMeta: {},
    entry: {},
    commitment: commitment === "finalized" ? 2 : 1,
    accountsDataSlice: [],
  };
}

/**
 * Subscribe to every transaction that lists any of `addresses`, with automatic
 * degradation.
 *
 *   Tier 1 — Yellowstone gRPC Geyser, when SOLANA_GEYSER_ENDPOINT is set and
 *            @triton-one/yellowstone-grpc is installed. Sub-slot latency.
 *   Tier 2 — WebSocket `onLogs`, one subscription per address, reconnecting
 *            across the endpoint list with exponential backoff.
 *   Tier 3 — `getSignaturesForAddress` polling. Slower, but it backfills what a
 *            dropped socket missed instead of losing it.
 *
 * Every tier delivers the transaction's token balances along with its logs.
 * Signatures already delivered are remembered so a tier change, or a
 * transaction listing several addresses, replays nothing.
 */
export async function createResilientLogStream(options: StreamOptions): Promise<StreamHandle> {
  const { addresses, config, onLogs } = options;
  const commitment = options.commitment ?? "confirmed";
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;
  const geyserEndpoint = (options.geyserEndpoint ?? process.env.SOLANA_GEYSER_ENDPOINT)?.trim();
  const connect = options.connect ?? ((endpoint: string) => new Connection(endpoint, commitment));
  if (addresses.length === 0) throw new Error("createResilientLogStream needs at least one address");

  const seen = new Set<string>();
  let tier: StreamTier | "down" = "down";
  let stopped = false;
  let poller: ReturnType<typeof setInterval> | undefined;
  let subscriptionIds: number[] = [];
  let active: StreamConnection | undefined;
  let geyserStop: (() => Promise<void>) | undefined;

  // Bound the replay-guard set. A run that has processed 50k signatures no
  // longer needs the oldest of them: they are far outside any polling window.
  const remember = (signature: string): boolean => {
    if (seen.has(signature)) return false;
    if (seen.size > 50_000) seen.clear();
    seen.add(signature);
    return true;
  };

  const deliver = async (entry: LogEntry) => {
    if (!remember(entry.signature)) return;
    await onLogs(entry);
  };

  /**
   * Fetch a transaction as an entry. `onLogs` and `getSignaturesForAddress`
   * both name a transaction without its token balances.
   */
  async function fetchEntry(connection: StreamConnection, signature: string): Promise<LogEntry | null> {
    const tx = await connection.getTransaction(signature, {
      commitment,
      maxSupportedTransactionVersion: 0,
    });
    return transactionLogEntry(signature, tx);
  }

  async function unsubscribe(): Promise<void> {
    const connection = active;
    const ids = subscriptionIds;
    active = undefined;
    subscriptionIds = [];
    await Promise.all(ids.map((id) => connection?.removeOnLogsListener(id).catch(() => {})));
  }

  async function startGeyser(): Promise<boolean> {
    const endpoint = geyserEndpoint;
    if (!endpoint) return false;
    try {
      const mod: any = await import("@triton-one/yellowstone-grpc");
      const Client = mod.default ?? mod.Client;
      const client = new Client(endpoint, process.env.SOLANA_GEYSER_X_TOKEN?.trim(), {});
      const stream = await client.subscribe();
      await new Promise<void>((resolve, reject) => {
        stream.write(
          geyserSubscribeRequest(addresses, commitment),
          (err: unknown) => (err ? reject(err) : resolve()),
        );
      });
      stream.on("data", async (message: any) => {
        const entry = geyserLogEntry(message);
        if (entry) await deliver(entry);
      });
      stream.on("error", () => {
        if (!stopped) void degrade();
      });
      geyserStop = async () => stream.end?.();
      tier = "geyser";
      console.log(`[stream] tier 1 (Yellowstone gRPC) active on ${endpoint}`);
      return true;
    } catch (err) {
      console.warn(
        `[stream] Yellowstone gRPC unavailable (${(err as Error)?.message ?? err}); falling back.`,
      );
      return false;
    }
  }

  /**
   * `onLogs` names a transaction but carries no token balances, so tier 2
   * fetches the transaction before delivering it. A transaction this node
   * cannot return yet stays unseen, and the polling tier delivers it instead.
   */
  async function onNotification(connection: StreamConnection, logs: Logs): Promise<void> {
    // A failed transaction changed no balances. Polling skips these too.
    if (logs.err || seen.has(logs.signature)) return;
    let entry: LogEntry | null;
    try {
      entry = await fetchEntry(connection, logs.signature);
    } catch (err) {
      console.warn(
        `[stream] getTransaction ${logs.signature} failed (${(err as Error)?.message ?? err}); polling will retry`,
      );
      return;
    }
    if (entry) await deliver(entry);
  }

  async function startWebsocket(): Promise<boolean> {
    for (const endpoint of config.endpoints) {
      try {
        const connection = connect(endpoint, commitment);
        active = connection;
        for (const address of addresses) {
          subscriptionIds.push(
            connection.onLogs(address, (logs) => void onNotification(connection, logs), commitment),
          );
        }
        tier = "websocket";
        console.log(
          `[stream] tier 2 (WebSocket onLogs) active on ${endpoint} for ${addresses.length} addresses`,
        );
        return true;
      } catch (err) {
        await unsubscribe();
        console.warn(`[stream] WebSocket failed on ${endpoint}: ${(err as Error)?.message ?? err}`);
      }
    }
    return false;
  }

  /**
   * Tier 3 also runs permanently alongside tier 1 and 2, not only as a
   * fallback. `onLogs` truncates the log array for transactions that exceed the
   * per-transaction log byte limit, and a socket can drop between heartbeats —
   * in both cases the event is simply never delivered and nothing errors.
   * Polling finalized signatures is what makes those recoverable.
   */
  function startPolling(): void {
    const connection = connect(config.endpoints[0], commitment);
    let polling = false;
    poller = setInterval(async () => {
      // A pass over every address can outlast the interval. Never run two.
      if (stopped || polling) return;
      polling = true;
      try {
        // Oldest first across all addresses, so events replay in chain order.
        const pending = new Map<string, number>();
        for (const address of addresses) {
          const signatures = await connection.getSignaturesForAddress(address, { limit: 50 });
          for (const { signature, slot, err } of signatures.reverse()) {
            if (!err && !seen.has(signature)) pending.set(signature, slot);
          }
        }
        const ordered = [...pending].sort(([, a], [, b]) => a - b);
        for (const [signature] of ordered) {
          if (stopped) break;
          if (seen.has(signature)) continue;
          const entry = await fetchEntry(connection, signature);
          if (entry) await deliver(entry);
        }
        if (tier === "down") {
          tier = "polling";
          console.log("[stream] tier 3 (polling backfill) is the only active tier");
        }
      } catch (err) {
        console.warn(`[stream] poll failed: ${(err as Error)?.message ?? err}`);
      } finally {
        polling = false;
      }
    }, pollIntervalMs);
  }

  async function degrade(): Promise<void> {
    tier = "down";
    await geyserStop?.().catch(() => {});
    geyserStop = undefined;
    await unsubscribe();
    for (let attempt = 0; attempt < 6 && !stopped; attempt++) {
      if (await startWebsocket()) return;
      const backoff = Math.min(30_000, 1_000 * 2 ** attempt);
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
    if (!stopped) console.warn("[stream] all push tiers down; polling backfill is carrying ingestion");
  }

  if (!(await startGeyser())) {
    if (!(await startWebsocket())) tier = "down";
  }
  startPolling();

  return {
    activeTier: () => tier,
    async stop() {
      stopped = true;
      if (poller) clearInterval(poller);
      await geyserStop?.().catch(() => {});
      await unsubscribe();
    },
  };
}

export default {
  resolveCluster,
  assertGenesis,
  connectionsFor,
  createResilientLogStream,
  geyserLogEntry,
  geyserSubscribeRequest,
  transactionLogEntry,
};
