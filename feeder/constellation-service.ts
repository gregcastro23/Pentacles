// Pentacles — Constellation Pool Visibility Attestor.
//
// The trusted bridge between the authoritative sky (SpacetimeDB) and the on-chain
// Constellation AMM (Base). It polls SpacetimeDB for `trace_intent` rows the module
// has produced — each one is proof that the module itself confirmed the constellation
// was risen over the trader's real horizon (the `trace_constellation` reducer gates on
// the same `altitude_deg` / `MIN_ALT_DEG` the star strikes use). For each, it signs an
// EIP-712 VisibilityAttestation with the ATTESTOR key the AMM trusts (ATTESTOR_ROLE),
// then writes it back via the owner-gated `answer_trace` reducer. The client then
// submits `seedLiquidity` from its own (Dynamic) wallet with that signature.
//
// The SpacetimeDB module is authoritative for sky truth; this service is a pure
// signer/relayer (it never holds funds or pays gas), mirroring push-ephemeris /
// oracle-service / duel-service.
//
// Usage:
//   bun run constellation-service.ts
//
// Environment:
//   ATTESTOR_PRIVATE_KEY   (required) the 0x-hex key holding ATTESTOR_ROLE on the AMM
//   AMM_CONTRACT_ADDRESS   (required) the deployed ConstellationAMM (verifyingContract)
//   ESMS_CHAIN             base | base-sepolia            (default: base-sepolia)
//   BASE_SEPOLIA_RPC_URL / BASE_RPC_URL                   (default: public RPC)
//   SPACETIMEDB_DB         (default: cookingwithcastrollc)
//   POLL_INTERVAL_MS       (default: 3000)
//   ATTESTATION_TTL_SECS   (default: 120) how long a signature stays valid
//   REGION_SALT            (default: "pentacles") salt for the location commitment

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  http,
  keccak256,
  encodeAbiParameters,
  toHex,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

const run = promisify(execFile);

function getSpacetimeCli(): string {
  if (process.env.SPACETIMEDB_CLI) return process.env.SPACETIMEDB_CLI;
  if (process.env.HOME) {
    const localBin = join(process.env.HOME, ".local", "bin", "spacetime");
    if (existsSync(localBin)) return localBin;
  }
  return "spacetime";
}
const SPACETIMEDB_CLI = getSpacetimeCli();

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? "3000");
const ATTESTATION_TTL_SECS = Number(process.env.ATTESTATION_TTL_SECS ?? "120");
const REGION_SALT = process.env.REGION_SALT ?? "pentacles";

const ATTESTOR_PRIVATE_KEY = process.env.ATTESTOR_PRIVATE_KEY as Hex | undefined;
const AMM_ADDRESS = process.env.AMM_CONTRACT_ADDRESS as Address | undefined;
const CHAIN = (process.env.ESMS_CHAIN ?? "base-sepolia") === "base" ? base : baseSepolia;
const RPC_URL =
  CHAIN.id === base.id
    ? process.env.BASE_RPC_URL ?? "https://mainnet.base.org"
    : process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

const USED_NONCE_ABI = [
  {
    type: "function",
    name: "usedNonce",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
  },
] as const;

// EIP-712 — must match ConstellationAMM.ATTESTATION_TYPEHASH and its domain exactly.
const EIP712_TYPES = {
  VisibilityAttestation: [
    { name: "trader", type: "address" },
    { name: "constellationId", type: "uint16" },
    { name: "regionCommit", type: "bytes32" },
    { name: "visibleStars", type: "uint8" },
    { name: "nonce", type: "uint64" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

// ── SpacetimeDB CLI plumbing (shared shape with duel-service.ts) ─────────────

function parseTable(output: string): Array<Record<string, string>> {
  const lines = output.split("\n").map((l) => l.trimEnd());
  const separatorIndex = lines.findIndex((l) => {
    const t = l.trim();
    return t.length > 0 && /^[-\+]+$/.test(t);
  });
  if (separatorIndex === -1) return [];
  const separatorLine = lines[separatorIndex];
  const boundaries: number[] = [];
  for (let i = 0; i < separatorLine.length; i++) {
    if (separatorLine[i] === "+") boundaries.push(i);
  }
  const headerLine = lines[separatorIndex - 1];
  if (!headerLine) return [];
  const colRanges: { start: number; end: number }[] = [];
  let start = 0;
  for (const b of boundaries) {
    colRanges.push({ start, end: b });
    start = b + 1;
  }
  colRanges.push({ start, end: headerLine.length });
  const headers = colRanges.map((r) => headerLine.substring(r.start, r.end).trim());
  const rows: Array<Record<string, string>> = [];
  for (let i = separatorIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const row: Record<string, string> = {};
    colRanges.forEach((r, idx) => {
      row[headers[idx]] = line.substring(r.start, r.end).trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseValue(val: string): string {
  const t = (val ?? "").trim();
  if (t.startsWith('"') && t.endsWith('"')) {
    try {
      return JSON.parse(t);
    } catch {
      return t.slice(1, -1);
    }
  }
  return t;
}

async function sql(query: string): Promise<Array<Record<string, string>>> {
  const { stdout } = await run(SPACETIMEDB_CLI, ["sql", DB, query]);
  return parseTable(stdout);
}

// ── Region commitment ────────────────────────────────────────────────────────
//
// Coarse (≈1°) location bucket, hashed with a salt: proves a *place* backed the
// trade (so "different cities back different pools" is verifiable) without putting
// exact GPS on chain. Best-effort — if the private location can't be read, fall
// back to a salted commitment of the trader identity so signing never wedges.

async function regionCommit(traderIdentity: string): Promise<Hex> {
  let latBucket = 0;
  let lonBucket = 0;
  try {
    const rows = await sql(
      `SELECT identity, lat, lon FROM player_location WHERE identity = ${traderIdentity}`,
    );
    if (rows[0]) {
      latBucket = Math.round(Number(parseValue(rows[0].lat)));
      lonBucket = Math.round(Number(parseValue(rows[0].lon)));
    }
  } catch {
    /* private table unreadable in this context — fall through to identity commit */
  }
  return keccak256(
    encodeAbiParameters(
      [{ type: "int256" }, { type: "int256" }, { type: "bytes32" }],
      [BigInt(latBucket), BigInt(lonBucket), keccak256(toHex(`${REGION_SALT}:${traderIdentity}`))],
    ),
  );
}

// ── On-chain nonce ───────────────────────────────────────────────────────────

const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) });

async function nextNonce(evm: Address): Promise<bigint> {
  if (!AMM_ADDRESS) return 0n;
  try {
    return (await publicClient.readContract({
      address: AMM_ADDRESS,
      abi: USED_NONCE_ABI,
      functionName: "usedNonce",
      args: [evm],
    })) as bigint;
  } catch (err) {
    console.warn(`[constellation] usedNonce read failed, defaulting to 0:`, (err as Error).message);
    return 0n;
  }
}

// ── answer_trace (owner-gated) ───────────────────────────────────────────────

async function answerTrace(
  intentId: string,
  region: Hex,
  visibleStars: number,
  nonce: bigint,
  deadline: number,
  signature: Hex,
): Promise<void> {
  await run(SPACETIMEDB_CLI, [
    "call",
    DB,
    "answer_trace",
    "--",
    intentId,
    region,
    String(visibleStars),
    nonce.toString(),
    String(deadline),
    signature,
  ]);
}

// ── Main loop ────────────────────────────────────────────────────────────────

const account = ATTESTOR_PRIVATE_KEY ? privateKeyToAccount(ATTESTOR_PRIVATE_KEY) : null;

async function processIntent(row: Record<string, string>): Promise<void> {
  const intentId = parseValue(row.intent_id);
  const trader = parseValue(row.trader);
  const constellationId = Number(parseValue(row.constellation_id));
  const visibleStars = Math.max(0, Math.min(255, Number(parseValue(row.visible_stars))));

  let evm: Address;
  try {
    evm = getAddress(parseValue(row.evm_address)); // checksums + validates
  } catch {
    console.error(`[constellation] intent #${intentId}: bad evm_address, skipping`);
    return;
  }

  const nonce = await nextNonce(evm);
  const region = await regionCommit(trader);
  const deadline = Math.floor(Date.now() / 1000) + ATTESTATION_TTL_SECS;

  const signature = (await account!.signTypedData({
    domain: {
      name: "ConstellationAMM",
      version: "1",
      chainId: CHAIN.id,
      verifyingContract: AMM_ADDRESS!,
    },
    types: EIP712_TYPES,
    primaryType: "VisibilityAttestation",
    message: {
      trader: evm,
      constellationId,
      regionCommit: region,
      visibleStars,
      nonce,
      deadline: BigInt(deadline),
    },
  })) as Hex;

  await answerTrace(intentId, region, visibleStars, nonce, deadline, signature);
  console.log(
    `[constellation] attested intent #${intentId} — constellation ${constellationId}, ` +
      `${visibleStars} stars up, ${evm}, nonce ${nonce}, expires in ${ATTESTATION_TTL_SECS}s`,
  );
}

async function checkPending(): Promise<void> {
  try {
    const rows = await sql(
      "SELECT intent_id, trader, evm_address, constellation_id, visible_stars FROM trace_intent WHERE attested = false",
    );
    if (rows.length === 0) return;
    console.log(`[constellation] ${rows.length} pending trace(s).`);
    for (const row of rows) {
      try {
        await processIntent(row);
      } catch (err) {
        console.error(`[constellation] failed to attest intent #${parseValue(row.intent_id)}:`, (err as Error).message.split("\n")[0]);
      }
    }
  } catch (err) {
    console.error("[constellation] poll error:", (err as Error).message.split("\n")[0]);
  }
}

function main(): void {
  if (!account || !AMM_ADDRESS) {
    console.error(
      "constellation-service requires ATTESTOR_PRIVATE_KEY and AMM_CONTRACT_ADDRESS. Aborting.",
    );
    process.exit(1);
  }
  console.log("Pentacles Constellation Visibility Attestor starting.");
  console.log(`  Database:   ${DB}`);
  console.log(`  Chain:      ${CHAIN.name} (${CHAIN.id})`);
  console.log(`  AMM:        ${AMM_ADDRESS}`);
  console.log(`  Attestor:   ${account.address}`);
  console.log(`  TTL:        ${ATTESTATION_TTL_SECS}s, poll ${POLL_INTERVAL_MS}ms\n`);

  const loop = async () => {
    await checkPending();
    setTimeout(loop, POLL_INTERVAL_MS);
  };
  loop();
}

main();
