// ============================================================
// Pentacles — Solana Token-2022 Background Event Sync Service
// ============================================================
// Subscribes to program logs from the pentacles_solana program on Solana.
// Listens for MintEsmsRewards, BurnEsmsForJing, and StarStakeTransferred (Transfer Hook)
// events, enforcing idempotency and updating SpacetimeDB authoritatively.

import { Connection, PublicKey } from "@solana/web3.js";
import { cliCall } from "./spacetime-cli";

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";

// Program ID of the pentacles_solana Anchor program
const PROGRAM_ID = new PublicKey(
  process.env.SOLANA_PROGRAM_ID || "7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R"
);

// Solana RPC Connection (devnet / mainnet / localnet)
const connection = new Connection(
  process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
  "confirmed"
);

export interface EsmsEvent {
  signature: string;
  eventType: "mint" | "burn";
  player: string;
  elementId: number;
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

/**
 * Dispatch event to SpacetimeDB sync_solana_event reducer.
 */
async function syncToSpacetime(event: EsmsEvent): Promise<void> {
  const httpArgs = [
    event.signature,
    event.player,
    event.eventType,
    event.elementId,
    event.amount.toString(),
  ];

  try {
    if (SPACETIME_TOKEN) {
      const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/sync_solana_event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SPACETIME_TOKEN}`,
        },
        body: JSON.stringify(httpArgs),
      });
      if (res.ok) {
        console.log(`[SolanaSync] Synced ${event.eventType} (sig: ${event.signature.slice(0, 12)}...) to SpacetimeDB.`);
      } else {
        const text = await res.text().catch(() => "");
        console.warn(`[SolanaSync] sync_solana_event status ${res.status}: ${text}`);
      }
    } else {
      await cliCall(DB, "sync_solana_event", [
        event.signature,
        event.player,
        event.eventType,
        event.elementId,
        event.amount,
      ]);
      console.log(`[SolanaSync] CLI synced ${event.eventType} (sig: ${event.signature.slice(0, 12)}...).`);
    }
  } catch (err) {
    console.error(`[SolanaSync] Failed to sync ${event.signature}:`, (err as Error)?.message || err);
  }
}

/**
 * Dispatch Transfer Hook event to SpacetimeDB transfer_star_stake reducer.
 */
export async function syncTransferHookToSpacetime(event: TransferHookEvent): Promise<void> {
  const args = [
    event.signature,
    event.fromWallet,
    event.toWallet,
    Number(event.amount),
  ];

  try {
    if (SPACETIME_TOKEN) {
      const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/transfer_star_stake`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SPACETIME_TOKEN}`,
        },
        body: JSON.stringify(args),
      });
      if (res.ok) {
        console.log(`[SolanaSync] Synced StarStake Transfer (${event.fromWallet.slice(0, 8)}... -> ${event.toWallet.slice(0, 8)}...) to SpacetimeDB.`);
      }
    } else {
      await cliCall(DB, "transfer_star_stake", args);
      console.log(`[SolanaSync] CLI synced StarStake Transfer.`);
    }
  } catch (err) {
    console.error(`[SolanaSync] Failed to sync StarStake transfer ${event.signature}:`, (err as Error)?.message || err);
  }
}

/**
 * Start listening for on-chain Solana program events.
 */
export function listenToSolanaEvents(onEvent: (event: EsmsEvent) => Promise<void>) {
  console.log(`[SolanaSync] Listening for Token-2022 events on program ${PROGRAM_ID.toBase58()}...`);

  connection.onLogs(
    PROGRAM_ID,
    async (logs, _ctx) => {
      if (logs.err) return;

      for (const log of logs.logs) {
        if (log.includes("Minted") && log.includes("units of ESMS element")) {
          const match = log.match(/Minted (\d+) units of ESMS element (\d+) for ([1-9A-HJ-NP-Za-km-z]{32,44})/);
          if (match) {
            const event: EsmsEvent = {
              signature: logs.signature,
              eventType: "mint",
              player: match[3],
              elementId: parseInt(match[2], 10),
              amount: BigInt(match[1]),
              timestamp: Date.now(),
            };
            await onEvent(event);
          }
        } else if (log.includes("Burned") && log.includes("units of ESMS element")) {
          const match = log.match(/Burned (\d+) units of ESMS element (\d+) for Jing cast by ([1-9A-HJ-NP-Za-km-z]{32,44})/);
          if (match) {
            const event: EsmsEvent = {
              signature: logs.signature,
              eventType: "burn",
              player: match[3],
              elementId: parseInt(match[2], 10),
              amount: BigInt(match[1]),
              timestamp: Date.now(),
            };
            await onEvent(event);
          }
        } else if (log.includes("Intercepted starUSDC Transfer!")) {
          const match = log.match(/Amount: (\d+).*Yield shifting ([A-Za-z0-9]+) -> ([A-Za-z0-9]+)/);
          if (match) {
            const transferEvent: TransferHookEvent = {
              signature: logs.signature,
              fromWallet: match[2],
              toWallet: match[3],
              amount: BigInt(match[1]),
              timestamp: Date.now(),
            };
            await syncTransferHookToSpacetime(transferEvent);
          }
        }
      }
    },
    "confirmed"
  );
}

// Standalone execution entrypoint
if (import.meta.main) {
  listenToSolanaEvents(async (event) => {
    console.log(`[SolanaSync] Verified on-chain ${event.eventType.toUpperCase()} event:`, event);
    await syncToSpacetime(event);
  });
}
