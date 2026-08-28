// Pentacles omnichain bridge settler.
//
// Consumes PendingMint BridgeTransfer rows, verifies the exact source-chain
// burn, performs an idempotent destination mint, then marks the transfer
// Completed through the owner-gated reducer.

import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  getAddress,
  http,
  keccak256,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { Connection, PublicKey } from "@solana/web3.js";
import { ESMS_ABI, ESMS_ORDER_PREFIX } from "../src/web3/abis.js";
import { startFeed } from "./stdb-feed";
import { cliCall } from "./spacetime-cli";
import { assertGenesis, resolveCluster } from "./solana-cluster";
import { getSolanaServiceSigner } from "./solana-signer";
import { asolEsmsMints } from "../src/web3/chains.js";

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";
const ESMS_ADDRESS = getAddress(
  process.env.ESMS_TOKEN || "0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F",
);
const BASE_RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
/**
 * Cluster is declared, not sniffed from an RPC URL. `assertGenesis` proves the
 * endpoint really serves it before the first signature of any run.
 */
const SOLANA_CLUSTER = resolveCluster();
const SOLANA_RPC = SOLANA_CLUSTER.endpoints[0];
const configuredConfirmations = Number(process.env.BRIDGE_EVM_CONFIRMATIONS || "12");
if (!Number.isSafeInteger(configuredConfirmations) || configuredConfirmations < 1) {
  throw new Error("BRIDGE_EVM_CONFIRMATIONS must be a positive integer");
}
const EVM_CONFIRMATIONS = configuredConfirmations;
const SOLANA_PROGRAM_ID = new PublicKey(
  process.env.SOLANA_PROGRAM_ID || "7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R",
);
// ASOL's ESMS mints are PDAs of its program id, identical on every cluster, so
// they are derived rather than read from four env vars that could disagree.
const SOLANA_MINTS = asolEsmsMints().map((mint) => mint.toBase58());
const EVM_HASH = /^0x[0-9a-f]{64}$/i;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const baseClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });
const solanaConnection = new Connection(SOLANA_RPC, "finalized");

export type BridgeChainName =
  | "EvmBaseSepolia"
  | "SolanaToken2022"
  | "EvmBaseMainnet"
  | "SolanaMainnetToken2022";

const SOLANA_CHAINS: ReadonlySet<string> = new Set(["SolanaToken2022", "SolanaMainnetToken2022"]);
const MAINNET_CHAINS: ReadonlySet<string> = new Set(["EvmBaseMainnet", "SolanaMainnetToken2022"]);
const KNOWN_CHAINS: ReadonlySet<string> = new Set([
  "EvmBaseSepolia",
  "SolanaToken2022",
  "EvmBaseMainnet",
  "SolanaMainnetToken2022",
]);

export interface PendingBridgeTransfer {
  burnTxHash: string;
  sourceChain: BridgeChainName;
  targetChain: BridgeChainName;
  sourceAddress: string;
  targetAddress: string;
  elementId: number;
  amount: bigint;
}

function scalar(value: any): string {
  if (value && typeof value === "object" && "tag" in value) return String(value.tag);
  return String(value ?? "");
}

export function parsePendingBridge(row: Record<string, any>): PendingBridgeTransfer {
  const sourceChain = scalar(row.source_chain) as PendingBridgeTransfer["sourceChain"];
  const targetChain = scalar(row.target_chain) as PendingBridgeTransfer["targetChain"];
  const status = scalar(row.status);
  const burnTxHash = scalar(row.burn_tx_hash);
  const sourceAddress = scalar(row.source_address);
  const targetAddress = scalar(row.target_address);
  const elementId = Number(row.element_id);
  const amount = BigInt(row.amount);
  if (status !== "PendingMint") throw new Error("bridge transfer is not pending");
  if (!KNOWN_CHAINS.has(sourceChain) || !KNOWN_CHAINS.has(targetChain)) {
    throw new Error("invalid bridge chain pair");
  }
  // A transfer must cross between an EVM and a Solana ledger, and both sides
  // must be equally real. Without the second check a Sepolia burn could mint on
  // Base mainnet — the enum alone does not prevent it.
  if (SOLANA_CHAINS.has(sourceChain) === SOLANA_CHAINS.has(targetChain)) {
    throw new Error("invalid bridge chain pair");
  }
  if (MAINNET_CHAINS.has(sourceChain) !== MAINNET_CHAINS.has(targetChain)) {
    throw new Error("bridge transfers may not cross between testnet and mainnet");
  }
  if (!Number.isInteger(elementId) || elementId < 0 || elementId > 3 || amount <= 0n) {
    throw new Error("invalid bridge element or amount");
  }
  if (amount > (1n << 64n) - 1n) {
    throw new Error("bridge amount exceeds Solana u64");
  }
  return { burnTxHash, sourceChain, targetChain, sourceAddress, targetAddress, elementId, amount };
}

export function bridgeClaimId(transfer: PendingBridgeTransfer): Hex {
  return keccak256(
    toHex(`pentacles-bridge:${transfer.sourceChain}:${transfer.burnTxHash.toLowerCase()}`),
  );
}

function exactElement(values: readonly bigint[], ids: readonly bigint[], transfer: PendingBridgeTransfer): boolean {
  return ids.length === 1
    && values.length === 1
    && ids[0] === BigInt(transfer.elementId)
    && values[0] === transfer.amount;
}

export function hasExactEvmBridgeBurn(
  decodedLogs: ReadonlyArray<{ eventName: string; args: any }>,
  transfer: PendingBridgeTransfer,
): boolean {
  const expectedFrom = getAddress(transfer.sourceAddress);
  const redeemedLogs = decodedLogs.filter((decoded) => decoded.eventName === "Redeemed");
  if (redeemedLogs.length) {
    return redeemedLogs.some(({ args }) =>
      getAddress(args.from) === expectedFrom
      && String(args.orderId).slice(2, 4).toLowerCase() === ESMS_ORDER_PREFIX.bridge
      && exactElement(args.amounts, args.ids, transfer)
    );
  }
  return decodedLogs.some((decoded) => {
    const args = decoded.args;
    try {
      return (
        decoded.eventName === "TransferSingle"
        && getAddress(args.from) === expectedFrom
        && getAddress(args.to) === zeroAddress
        && args.id === BigInt(transfer.elementId)
        && args.value === transfer.amount
      ) || (
        decoded.eventName === "TransferBatch"
        && getAddress(args.from) === expectedFrom
        && getAddress(args.to) === zeroAddress
        && exactElement(args.values, args.ids, transfer)
      );
    } catch {
      return false;
    }
  });
}

export async function verifyEvmBurn(transfer: PendingBridgeTransfer): Promise<void> {
  if (!EVM_HASH.test(transfer.burnTxHash)) throw new Error("invalid Base Sepolia burn hash");
  const receipt = await baseClient.getTransactionReceipt({ hash: transfer.burnTxHash as Hex });
  if (receipt.status !== "success") throw new Error("Base Sepolia burn transaction reverted");
  const latestBlock = await baseClient.getBlockNumber({ cacheTime: 0 });
  if (latestBlock - receipt.blockNumber + 1n < BigInt(EVM_CONFIRMATIONS)) {
    throw new Error(`Base Sepolia burn is awaiting ${EVM_CONFIRMATIONS} confirmations`);
  }
  const decodedLogs: Array<{ eventName: string; args: any }> = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ESMS_ADDRESS.toLowerCase()) continue;
    try {
      decodedLogs.push(decodeEventLog({ abi: ESMS_ABI, data: log.data, topics: log.topics }) as any);
    } catch {
      // Ignore unrelated ESMS logs.
    }
  }
  if (hasExactEvmBridgeBurn(decodedLogs, transfer)) return;
  throw new Error("transaction does not contain the claimed ESMS burn");
}

/**
 * Verify a Solana-source ESMS burn by its effect on the mint's supply.
 *
 * This no longer looks for `pentacles_solana::bridge_burn_esms`. That
 * instruction has been retired along with the rest of Pentacles' ESMS
 * issuance: ASOL is the sole issuer, and its mints are NonTransferable with
 * PermissionedBurn, so a burn is an `asol_program` redemption co-signed by
 * ASOL's mint authority — not a Pentacles instruction at all.
 *
 * Checking the balance delta rather than the instruction shape keeps the
 * verification structural without depending on ASOL's IDL: it confirms that the
 * claimed holder's ESMS balance for this element fell by exactly the claimed
 * amount, which is the property the bridge actually needs.
 */
export async function verifySolanaBurn(transfer: PendingBridgeTransfer): Promise<void> {
  if (!SOLANA_SIGNATURE.test(transfer.burnTxHash)) throw new Error("invalid Solana burn signature");
  const tx = await solanaConnection.getTransaction(transfer.burnTxHash, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.meta?.err) throw new Error("Solana burn transaction is missing or failed");

  const mintValue = SOLANA_MINTS[transfer.elementId];
  if (!mintValue) throw new Error(`Solana ESMS mint ${transfer.elementId} is not configured`);

  const before = new Map(
    (tx.meta?.preTokenBalances ?? []).map((entry) => [entry.accountIndex, entry]),
  );
  const burned = (tx.meta?.postTokenBalances ?? []).some((post) => {
    if (post.mint !== mintValue || post.owner !== transfer.sourceAddress) return false;
    const prior = BigInt(before.get(post.accountIndex)?.uiTokenAmount.amount ?? "0");
    return prior - BigInt(post.uiTokenAmount.amount) === transfer.amount;
  });
  if (!burned) {
    throw new Error("transaction does not contain the claimed ESMS burn for this holder");
  }
}

function evmMinter() {
  const key = process.env.MINTER_PRIVATE_KEY as Hex | undefined;
  if (!key) throw new Error("MINTER_PRIVATE_KEY is not configured");
  return privateKeyToAccount(key);
}

async function findEvmClaimTransaction(
  transfer: PendingBridgeTransfer,
  to: Address,
  claimId: Hex,
): Promise<Hex | null> {
  const event = ESMS_ABI.find((item: any) => item.type === "event" && item.name === "ClaimExecuted") as any;
  const latest = await baseClient.getBlockNumber({ cacheTime: 0 });
  const finalBlock = latest >= BigInt(EVM_CONFIRMATIONS - 1)
    ? latest - BigInt(EVM_CONFIRMATIONS - 1)
    : 0n;
  const floor = finalBlock > 50_000n ? finalBlock - 50_000n : 0n;
  for (let toBlock = finalBlock; toBlock >= floor;) {
    const fromBlock = toBlock > floor + 1_999n ? toBlock - 1_999n : floor;
    const logs = await baseClient.getLogs({
      address: ESMS_ADDRESS,
      event,
      args: { to, claimId },
      fromBlock,
      toBlock,
    });
    for (const log of [...logs].reverse()) {
      try {
        const decoded: any = decodeEventLog({ abi: ESMS_ABI, data: log.data, topics: log.topics });
        if (
          decoded.eventName === "ClaimExecuted"
          && getAddress(decoded.args.to) === to
          && decoded.args.claimId.toLowerCase() === claimId.toLowerCase()
          && exactElement(decoded.args.amounts, decoded.args.ids, transfer)
        ) {
          return log.transactionHash;
        }
      } catch {
        // Keep scanning.
      }
    }
    if (fromBlock === floor) break;
    toBlock = fromBlock - 1n;
  }
  return null;
}

export async function mintEvmDestination(transfer: PendingBridgeTransfer): Promise<string> {
  const to = getAddress(transfer.targetAddress);
  const claimId = bridgeClaimId(transfer);
  if (await baseClient.readContract({
    address: ESMS_ADDRESS,
    abi: ESMS_ABI,
    functionName: "claimed",
    args: [claimId],
  })) {
    const existing = await findEvmClaimTransaction(transfer, to, claimId);
    if (!existing) throw new Error("existing EVM bridge mint could not be reconciled");
    return existing;
  }
  const account = evmMinter();
  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(BASE_RPC),
  });
  const hash = await walletClient.writeContract({
    address: ESMS_ADDRESS,
    abi: ESMS_ABI,
    functionName: "claimMint",
    args: [to, claimId, [BigInt(transfer.elementId)], [transfer.amount]],
  });
  const receipt = await baseClient.waitForTransactionReceipt({
    hash,
    confirmations: EVM_CONFIRMATIONS,
    timeout: 120_000,
  });
  if (receipt.status !== "success") throw new Error("EVM bridge mint reverted");
  const exactMint = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== ESMS_ADDRESS.toLowerCase()) return false;
    try {
      const decoded: any = decodeEventLog({ abi: ESMS_ABI, data: log.data, topics: log.topics });
      return decoded.eventName === "ClaimExecuted"
        && getAddress(decoded.args.to) === to
        && decoded.args.claimId.toLowerCase() === claimId.toLowerCase()
        && exactElement(decoded.args.amounts, decoded.args.ids, transfer);
    } catch {
      return false;
    }
  });
  if (!exactMint) throw new Error("EVM receipt did not contain the exact bridge mint");
  return hash;
}

/**
 * Resolve the Solana service signer.
 *
 * Cloud KMS where configured, an in-memory keypair only on a testnet cluster.
 * The previous implementation read a raw 64-byte secret out of the environment
 * unconditionally, which put the key in the Railway variable store, in
 * `railway variables` output, and in every forked worker's heap.
 */
async function solanaSigner() {
  return getSolanaServiceSigner({ caip2: SOLANA_CLUSTER.caip2 });
}


/**
 * Mint the Solana destination side of a bridge transfer.
 *
 * NOT YET WIRED, and deliberately failing closed rather than approximating.
 *
 * This previously built `pentacles_solana::bridge_mint_esms`. That instruction
 * is retired: ASOL is the sole ESMS issuer, so the destination mint is an
 * `asol_program` claim signed by ASOL's service authority — an authority
 * Pentacles' feeder does not hold and should not hold.
 *
 * Completing this needs two things that do not exist here yet:
 *
 *   1. ASOL's `claim_mint_esms` account layout and claim-receipt PDA seeds, so
 *      the instruction can be built and its idempotency reconciled.
 *   2. A decision on who signs it — most likely an ASOL-side relayer endpoint
 *      that Pentacles calls, keeping ASOL's mint authority inside ASOL.
 *
 * Guessing either would produce a bridge that fails on chain with an opaque
 * error after the source burn has already settled, which is strictly worse than
 * refusing to start. EVM-destination transfers are unaffected.
 */
export async function mintSolanaDestination(transfer: PendingBridgeTransfer): Promise<string> {
  const claimId = bridgeClaimId(transfer);
  throw new Error(
    `Solana destination minting is not wired to asol_program yet (claim ${claimId.slice(0, 10)}…, ` +
      `element ${transfer.elementId}, amount ${transfer.amount}). ` +
      "Pentacles no longer issues ESMS; see docs/SOLANA_MAINNET_CONFORMANCE.md.",
  );
}

async function completeBridge(burnTxHash: string, destinationTxHash: string): Promise<void> {
  const args = [burnTxHash, destinationTxHash];
  if (SPACETIME_TOKEN) {
    const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/complete_esms_bridge`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SPACETIME_TOKEN}`,
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`complete_esms_bridge failed: ${await res.text().catch(() => "")}`);
  } else {
    await cliCall(DB, "complete_esms_bridge", args);
  }
}

export function createBridgeProcessor(overrides: {
  verifyEvmBurn?: typeof verifyEvmBurn;
  verifySolanaBurn?: typeof verifySolanaBurn;
  mintEvmDestination?: typeof mintEvmDestination;
  mintSolanaDestination?: typeof mintSolanaDestination;
  completeBridge?: typeof completeBridge;
} = {}) {
  const deps = {
    verifyEvmBurn,
    verifySolanaBurn,
    mintEvmDestination,
    mintSolanaDestination,
    completeBridge,
    ...overrides,
  };
  return async function processBridge(row: Record<string, any>): Promise<void> {
    const transfer = parsePendingBridge(row);
    // Dispatch on which family the chain belongs to, not on one hardcoded
    // variant name — otherwise a mainnet row silently takes the Solana branch.
    if (SOLANA_CHAINS.has(transfer.sourceChain)) await deps.verifySolanaBurn(transfer);
    else await deps.verifyEvmBurn(transfer);
    const destinationTxHash = SOLANA_CHAINS.has(transfer.targetChain)
      ? await deps.mintSolanaDestination(transfer)
      : await deps.mintEvmDestination(transfer);
    await deps.completeBridge(transfer.burnTxHash, destinationTxHash);
    console.log(
      `[bridge] ${transfer.burnTxHash.slice(0, 12)}… settled on ${transfer.targetChain}: ${destinationTxHash}`,
    );
  };
}

export const processBridgeTransfer = createBridgeProcessor();

async function main(): Promise<void> {
  console.log(`Pentacles omnichain bridge settler starting on ${SOLANA_CLUSTER.caip2}.`);

  // Prove the RPC serves the cluster we declared, and that a signer exists,
  // before consuming the first pending row. Both failures are configuration
  // errors, and both are far cheaper to hit at startup than midway through a
  // settlement whose source burn has already finalized.
  await assertGenesis(new Connection(SOLANA_RPC, "finalized"), SOLANA_CLUSTER);
  const signer = await solanaSigner();
  console.log(`[bridge] Solana signer ${signer.publicKey.toBase58()} via ${signer.provider}.`);

  startFeed({
    uri: SPACETIMEDB_URI,
    db: DB,
    token: SPACETIME_TOKEN || undefined,
    table: "bridge_transfer",
    query: "SELECT * FROM bridge_transfer",
    idField: "burn_tx_hash",
    accept: (row) => scalar(row.status) === "PendingMint",
    label: "bridge",
    onRow: processBridgeTransfer,
  });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("[bridge] fatal:", (err as Error)?.message ?? err);
    process.exit(1);
  });
}
