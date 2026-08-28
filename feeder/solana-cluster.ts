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

import { Connection, PublicKey } from "@solana/web3.js";
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

export interface StreamOptions {
  programId: PublicKey;
  config: ClusterConfig;
  onLogs(entry: { signature: string; logs: string[]; err: unknown }): Promise<void>;
  /** Polling cadence for the backfill tier, ms. */
  pollIntervalMs?: number;
  commitment?: "confirmed" | "finalized";
}

/**
 * Subscribe to a program's logs with automatic degradation.
 *
 *   Tier 1 — Yellowstone gRPC Geyser, when SOLANA_GEYSER_ENDPOINT is set and
 *            @triton-one/yellowstone-grpc is installed. Sub-slot latency.
 *   Tier 2 — WebSocket `onLogs`, reconnecting across the endpoint list with
 *            exponential backoff.
 *   Tier 3 — `getSignaturesForAddress` polling. Slower, but it backfills what a
 *            dropped socket missed instead of losing it.
 *
 * Signatures already delivered are remembered so a tier change replays nothing.
 */
export async function createResilientLogStream(options: StreamOptions): Promise<StreamHandle> {
  const { programId, config, onLogs } = options;
  const commitment = options.commitment ?? "confirmed";
  const pollIntervalMs = options.pollIntervalMs ?? 15_000;

  const seen = new Set<string>();
  let tier: StreamTier | "down" = "down";
  let stopped = false;
  let poller: ReturnType<typeof setInterval> | undefined;
  let subscriptionId: number | undefined;
  let active: Connection | undefined;
  let geyserStop: (() => Promise<void>) | undefined;

  // Bound the replay-guard set. A run that has processed 50k signatures no
  // longer needs the oldest of them: they are far outside any polling window.
  const remember = (signature: string): boolean => {
    if (seen.has(signature)) return false;
    if (seen.size > 50_000) seen.clear();
    seen.add(signature);
    return true;
  };

  const deliver = async (entry: { signature: string; logs: string[]; err: unknown }) => {
    if (!remember(entry.signature)) return;
    await onLogs(entry);
  };

  async function startGeyser(): Promise<boolean> {
    const endpoint = process.env.SOLANA_GEYSER_ENDPOINT?.trim();
    if (!endpoint) return false;
    try {
      const mod: any = await import("@triton-one/yellowstone-grpc");
      const Client = mod.default ?? mod.Client;
      const client = new Client(endpoint, process.env.SOLANA_GEYSER_X_TOKEN?.trim(), {});
      const stream = await client.subscribe();
      await new Promise<void>((resolve, reject) => {
        stream.write(
          {
            accounts: {},
            slots: {},
            transactions: {
              pentacles: {
                accountInclude: [programId.toBase58()],
                accountExclude: [],
                accountRequired: [],
              },
            },
            blocks: {},
            blocksMeta: {},
            entry: {},
            commitment: commitment === "finalized" ? 2 : 1,
            accountsDataSlice: [],
          },
          (err: unknown) => (err ? reject(err) : resolve()),
        );
      });
      stream.on("data", async (message: any) => {
        const tx = message?.transaction?.transaction;
        if (!tx) return;
        const signature = Buffer.from(tx.signature ?? []).toString("base64");
        const logs: string[] = tx.meta?.logMessages ?? [];
        await deliver({ signature, logs, err: tx.meta?.err ?? null });
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

  async function startWebsocket(): Promise<boolean> {
    for (const endpoint of config.endpoints) {
      try {
        const connection = new Connection(endpoint, commitment);
        subscriptionId = connection.onLogs(
          programId,
          async (logs) => {
            await deliver({ signature: logs.signature, logs: logs.logs, err: logs.err });
          },
          commitment,
        );
        active = connection;
        tier = "websocket";
        console.log(`[stream] tier 2 (WebSocket onLogs) active on ${endpoint}`);
        return true;
      } catch (err) {
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
    const connection = new Connection(config.endpoints[0], commitment);
    poller = setInterval(async () => {
      if (stopped) return;
      try {
        const signatures = await connection.getSignaturesForAddress(programId, { limit: 50 });
        for (const entry of signatures.reverse()) {
          if (entry.err || seen.has(entry.signature)) continue;
          const tx = await connection.getTransaction(entry.signature, {
            commitment: commitment === "finalized" ? "finalized" : "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          if (!tx) continue;
          await deliver({
            signature: entry.signature,
            logs: tx.meta?.logMessages ?? [],
            err: tx.meta?.err ?? null,
          });
        }
        if (tier === "down") {
          tier = "polling";
          console.log("[stream] tier 3 (polling backfill) is the only active tier");
        }
      } catch (err) {
        console.warn(`[stream] poll failed: ${(err as Error)?.message ?? err}`);
      }
    }, pollIntervalMs);
  }

  async function degrade(): Promise<void> {
    tier = "down";
    await geyserStop?.().catch(() => {});
    geyserStop = undefined;
    if (active && subscriptionId !== undefined) {
      await active.removeOnLogsListener(subscriptionId).catch(() => {});
      subscriptionId = undefined;
    }
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
      if (active && subscriptionId !== undefined) {
        await active.removeOnLogsListener(subscriptionId).catch(() => {});
      }
    },
  };
}

export default { resolveCluster, assertGenesis, connectionsFor, createResilientLogStream };
