// Pentacles omnichain bridge settler.
//
// Consumes PendingMint BridgeTransfer rows, verifies the exact source-chain
// burn, performs an idempotent destination mint, then marks the transfer
// Completed through the owner-gated reducer.

import { createHash } from "node:crypto";
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
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import bs58 from "bs58";
import { ESMS_ABI, ESMS_ORDER_PREFIX } from "../src/web3/abis.js";
import { startFeed } from "./stdb-feed";
import { cliCall } from "./spacetime-cli";

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";
const ESMS_ADDRESS = getAddress(
  process.env.ESMS_TOKEN || "0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F",
);
const BASE_RPC = process.env.BASE_SEPOLIA_RPC || "https://sepolia.base.org";
const SOLANA_RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const configuredConfirmations = Number(process.env.BRIDGE_EVM_CONFIRMATIONS || "12");
if (!Number.isSafeInteger(configuredConfirmations) || configuredConfirmations < 1) {
  throw new Error("BRIDGE_EVM_CONFIRMATIONS must be a positive integer");
}
const EVM_CONFIRMATIONS = configuredConfirmations;
const SOLANA_PROGRAM_ID = new PublicKey(
  process.env.SOLANA_PROGRAM_ID || "7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R",
);
const SOLANA_MINTS = [
  process.env.SOLANA_MINT_SPIRIT || process.env.VITE_SOLANA_MINT_SPIRIT,
  process.env.SOLANA_MINT_ESSENCE || process.env.VITE_SOLANA_MINT_ESSENCE,
  process.env.SOLANA_MINT_MATTER || process.env.VITE_SOLANA_MINT_MATTER,
  process.env.SOLANA_MINT_SUBSTANCE || process.env.VITE_SOLANA_MINT_SUBSTANCE,
];
const EVM_HASH = /^0x[0-9a-f]{64}$/i;
const SOLANA_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const baseClient = createPublicClient({ chain: baseSepolia, transport: http(BASE_RPC) });
const solanaConnection = new Connection(SOLANA_RPC, "finalized");

export interface PendingBridgeTransfer {
  burnTxHash: string;
  sourceChain: "EvmBaseSepolia" | "SolanaToken2022";
  targetChain: "EvmBaseSepolia" | "SolanaToken2022";
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
  if (
    !["EvmBaseSepolia", "SolanaToken2022"].includes(sourceChain) ||
    !["EvmBaseSepolia", "SolanaToken2022"].includes(targetChain) ||
    sourceChain === targetChain
  ) {
    throw new Error("invalid bridge chain pair");
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

export async function verifyEvmBurn(transfer: PendingBridgeTransfer): Promise<void> {
  if (!EVM_HASH.test(transfer.burnTxHash)) throw new Error("invalid Base Sepolia burn hash");
  const receipt = await baseClient.getTransactionReceipt({ hash: transfer.burnTxHash as Hex });
  if (receipt.status !== "success") throw new Error("Base Sepolia burn transaction reverted");
  const latestBlock = await baseClient.getBlockNumber({ cacheTime: 0 });
  if (latestBlock - receipt.blockNumber + 1n < BigInt(EVM_CONFIRMATIONS)) {
    throw new Error(`Base Sepolia burn is awaiting ${EVM_CONFIRMATIONS} confirmations`);
  }
  const expectedFrom = getAddress(transfer.sourceAddress);
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== ESMS_ADDRESS.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi: ESMS_ABI, data: log.data, topics: log.topics });
      const args: any = decoded.args;
      if (
        decoded.eventName === "Redeemed" &&
        getAddress(args.from) === expectedFrom &&
        String(args.orderId).slice(2, 4).toLowerCase() === ESMS_ORDER_PREFIX.bridge &&
        exactElement(args.amounts, args.ids, transfer)
      ) {
        return;
      }
      if (
        decoded.eventName === "TransferSingle" &&
        getAddress(args.from) === expectedFrom &&
        getAddress(args.to) === zeroAddress &&
        args.id === BigInt(transfer.elementId) &&
        args.value === transfer.amount
      ) {
        return;
      }
      if (
        decoded.eventName === "TransferBatch" &&
        getAddress(args.from) === expectedFrom &&
        getAddress(args.to) === zeroAddress &&
        exactElement(args.values, args.ids, transfer)
      ) {
        return;
      }
    } catch {
      // Ignore unrelated ESMS logs.
    }
  }
  throw new Error("transaction does not contain the claimed ESMS burn");
}

export async function verifySolanaBurn(transfer: PendingBridgeTransfer): Promise<void> {
  if (!SOLANA_SIGNATURE.test(transfer.burnTxHash)) throw new Error("invalid Solana burn signature");
  const tx = await solanaConnection.getTransaction(transfer.burnTxHash, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.meta?.err) throw new Error("Solana burn transaction is missing or failed");
  const mintValue = SOLANA_MINTS[transfer.elementId];
  if (!mintValue) throw new Error(`Solana ESMS mint ${transfer.elementId} is not configured`);
  const data = Buffer.alloc(1 + 8);
  data.writeUInt8(transfer.elementId, 0);
  data.writeBigUInt64LE(transfer.amount, 1);
  const exactInstruction = compiledInstructionMatches(tx, "bridge_burn_esms", data, {
    0: new PublicKey(transfer.sourceAddress),
    1: new PublicKey(mintValue),
  });
  const expected = `Bridge burned ${transfer.amount} units of ESMS element ${transfer.elementId} by ${transfer.sourceAddress}.`;
  if (!exactInstruction || !tx.meta?.logMessages?.some((line) => line.includes(expected))) {
    throw new Error("transaction does not contain the claimed Token-2022 burn");
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

function solanaMinter(): Keypair {
  const raw = process.env.SOLANA_MINTER_SECRET_KEY;
  if (!raw) throw new Error("SOLANA_MINTER_SECRET_KEY is not configured");
  const bytes = JSON.parse(raw);
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error("SOLANA_MINTER_SECRET_KEY must be a JSON array of 64 bytes");
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function anchorDiscriminator(name: string): Buffer {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function compiledInstructionMatches(
  tx: any,
  instructionName: string,
  expectedData: Buffer,
  expectedAccounts: Record<number, PublicKey>,
): boolean {
  const message = tx.transaction.message;
  const accountKeys = typeof message.getAccountKeys === "function"
    ? message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses })
    : null;
  const staticKeys = message.staticAccountKeys ?? message.accountKeys ?? [];
  const keyAt = (index: number): PublicKey | undefined =>
    accountKeys?.get?.(index) ?? staticKeys[index];
  const instructions = message.compiledInstructions ?? message.instructions ?? [];
  const discriminator = anchorDiscriminator(instructionName);
  return instructions.some((instruction: any) => {
    const program = keyAt(instruction.programIdIndex);
    if (!program?.equals(SOLANA_PROGRAM_ID)) return false;
    const data = typeof instruction.data === "string"
      ? Buffer.from(bs58.decode(instruction.data))
      : Buffer.from(instruction.data);
    if (
      data.length !== discriminator.length + expectedData.length
      || !data.subarray(0, discriminator.length).equals(discriminator)
      || !data.subarray(discriminator.length).equals(expectedData)
    ) {
      return false;
    }
    const indexes: number[] = instruction.accountKeyIndexes ?? instruction.accounts ?? [];
    return Object.entries(expectedAccounts).every(([position, expected]) =>
      keyAt(indexes[Number(position)])?.equals(expected),
    );
  });
}

async function isExactSolanaMint(signature: string, transfer: PendingBridgeTransfer, claimId: Hex): Promise<boolean> {
  const tx = await solanaConnection.getTransaction(signature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx || tx.meta?.err) return false;
  const mintValue = SOLANA_MINTS[transfer.elementId];
  if (!mintValue) return false;
  const claimBytes = Buffer.from(claimId.slice(2), "hex");
  const [receiptPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bridge_mint"), claimBytes],
    SOLANA_PROGRAM_ID,
  );
  const data = Buffer.alloc(1 + 8 + 32);
  data.writeUInt8(transfer.elementId, 0);
  data.writeBigUInt64LE(transfer.amount, 1);
  claimBytes.copy(data, 9);
  const exactInstruction = compiledInstructionMatches(tx, "bridge_mint_esms", data, {
    2: receiptPda,
    3: new PublicKey(mintValue),
    5: new PublicKey(transfer.targetAddress),
  });
  const expected =
    `Bridge minted ${transfer.amount} units of ESMS element ${transfer.elementId} `
    + `for ${transfer.targetAddress} claim ${claimId.slice(2)}.`;
  return exactInstruction && !!tx.meta?.logMessages?.some((line) => line.includes(expected));
}

export async function mintSolanaDestination(transfer: PendingBridgeTransfer): Promise<string> {
  const authority = solanaMinter();
  const recipient = new PublicKey(transfer.targetAddress);
  const mintValue = SOLANA_MINTS[transfer.elementId];
  if (!mintValue) throw new Error(`Solana ESMS mint ${transfer.elementId} is not configured`);
  const mint = new PublicKey(mintValue);
  const claimId = bridgeClaimId(transfer);
  const claimBytes = Buffer.from(claimId.slice(2), "hex");
  const [gameAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("game_authority")],
    SOLANA_PROGRAM_ID,
  );
  const [receiptPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("bridge_mint"), claimBytes],
    SOLANA_PROGRAM_ID,
  );
  if (await solanaConnection.getAccountInfo(receiptPda, "finalized")) {
    const signatures = await solanaConnection.getSignaturesForAddress(receiptPda, { limit: 10 });
    for (const existing of signatures) {
      if (await isExactSolanaMint(existing.signature, transfer, claimId)) return existing.signature;
    }
    throw new Error("existing Solana bridge mint could not be reconciled");
  }
  const ata = getAssociatedTokenAddressSync(
    mint,
    recipient,
    false,
    TOKEN_2022_PROGRAM_ID,
  );
  const data = Buffer.alloc(8 + 1 + 8 + 32);
  anchorDiscriminator("bridge_mint_esms").copy(data, 0);
  data.writeUInt8(transfer.elementId, 8);
  data.writeBigUInt64LE(transfer.amount, 9);
  claimBytes.copy(data, 17);
  const mintInstruction = new TransactionInstruction({
    programId: SOLANA_PROGRAM_ID,
    keys: [
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: gameAuthority, isSigner: false, isWritable: true },
      { pubkey: receiptPda, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
  const transaction = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(
      authority.publicKey,
      ata,
      recipient,
      mint,
      TOKEN_2022_PROGRAM_ID,
    ),
    mintInstruction,
  );
  const signature = await sendAndConfirmTransaction(solanaConnection, transaction, [authority], {
    commitment: "finalized",
  });
  if (!(await isExactSolanaMint(signature, transfer, claimId))) {
    throw new Error("Solana receipt did not contain the exact bridge mint");
  }
  return signature;
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
    if (transfer.sourceChain === "EvmBaseSepolia") await deps.verifyEvmBurn(transfer);
    else await deps.verifySolanaBurn(transfer);
    const destinationTxHash = transfer.targetChain === "EvmBaseSepolia"
      ? await deps.mintEvmDestination(transfer)
      : await deps.mintSolanaDestination(transfer);
    await deps.completeBridge(transfer.burnTxHash, destinationTxHash);
    console.log(
      `[bridge] ${transfer.burnTxHash.slice(0, 12)}… settled on ${transfer.targetChain}: ${destinationTxHash}`,
    );
  };
}

export const processBridgeTransfer = createBridgeProcessor();

function main(): void {
  console.log("Pentacles omnichain bridge settler starting.");
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

if (import.meta.main) main();
