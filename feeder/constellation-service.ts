// Pentacles — Constellation Pool Visibility Attestor.
//
// The trusted bridge between the authoritative sky (SpacetimeDB) and the on-chain
// Constellation AMM (Base). It subscribes over WebSocket (plus a periodic /sql
// re-sweep) for `trace_intent` rows the module
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
//                          (this feeder's signing key, granted at deploy via ATTESTOR_ADDRESS)
//   AMM_CONTRACT_ADDRESS   (required) the deployed ConstellationAMM (verifyingContract);
//                          canonical Base-Sepolia deploy (12 pools, ids match constellations.rs):
//                          0x6B4EE164320e9E5583C0F6BEe14D5BABb5ba5095
//   ESMS_CHAIN             base | base-sepolia            (default: base-sepolia)
//   BASE_SEPOLIA_RPC_URL / BASE_RPC_URL                   (default: public RPC)
//   SPACETIMEDB_DB         (default: cookingwithcastrollc)
//   RESWEEP_MS             (default: 300000) un-attested-row re-sweep period
//   ATTESTATION_TTL_SECS   (default: 120) how long a signature stays valid
//   REGION_SALT            (default: "pentacles") salt for the location commitment

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
import { startFeed, sqlOneShot } from "./stdb-feed";
import { cliCall } from "./spacetime-cli";

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const ATTESTATION_TTL_SECS = Number(process.env.ATTESTATION_TTL_SECS ?? "120");
const REGION_SALT = process.env.REGION_SALT ?? "pentacles";
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";

const ATTESTOR_PRIVATE_KEY = (process.env.ATTESTOR_PRIVATE_KEY || '').trim() as Hex;
if (!ATTESTOR_PRIVATE_KEY || !/^0x[0-9a-fA-F]{64}$/.test(ATTESTOR_PRIVATE_KEY)) {
  throw new Error("ATTESTOR_PRIVATE_KEY environment variable is required and must be a 32-byte hex key.");
}
const AMM_ADDRESS = (process.env.AMM_CONTRACT_ADDRESS || "0x6B4EE164320e9E5583C0F6BEe14D5BABb5ba5095") as Address;
// The 12-pool ConstellationAMM (one pool per real constellation in `constellations.rs`) is
// deployed on Base Sepolia by AlchmAgentsETH's Deploy.s.sol. (AlchmAgentsETH also runs a
// separate 6-element-pair AMM on Arc for its own staking page — that is NOT this attestor's
// pool set, so we stay on Base.) The EIP-712 domain's chainId must match the deployed AMM.
const CHAIN = (process.env.ESMS_CHAIN ?? "base-sepolia") === "base" ? base : baseSepolia;
const RPC_URL =
  CHAIN.id === base.id
    ? process.env.BASE_RPC_URL ?? "https://mainnet.base.org"
    : process.env.BASE_SEPOLIA_RPC_URL ?? "https://sepolia.base.org";

// usedNonce is keyed per-(constellation, trader): `mapping(uint16 => mapping(address => uint64))`
// in ConstellationAMM. Must match exactly — a single-arg `usedNonce(address)` read reverts and
// would silently fall back to nonce 0, producing AttestationBadNonce on the trader's 2nd trade.
const USED_NONCE_ABI = [
  {
    type: "function",
    name: "usedNonce",
    stateMutability: "view",
    inputs: [
      { name: "constId", type: "uint16" },
      { name: "trader", type: "address" },
    ],
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

// ── SpacetimeDB plumbing — one-shot HTTP /sql reads still used by regionCommit ─
// (the trace_intent trigger arrives over the WebSocket feed — see main() — and
// the SATS decode now lives in stdb-feed.ts, shared with every feeder's re-sweep).

function parseValue(val: unknown): string {
  if (val == null) return "";
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    return typeof obj.__identity__ === "string" ? obj.__identity__ : JSON.stringify(val);
  }
  return String(val);
}

const sql = (query: string) => sqlOneShot(SPACETIMEDB_URI, DB, SPACETIME_TOKEN || undefined, query);

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

async function nextNonce(constId: number, evm: Address): Promise<bigint> {
  if (!AMM_ADDRESS) return 0n;
  try {
    return (await publicClient.readContract({
      address: AMM_ADDRESS,
      abi: USED_NONCE_ABI,
      functionName: "usedNonce",
      args: [constId, evm],
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
  if (SPACETIME_TOKEN) {
    const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/answer_trace`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SPACETIME_TOKEN}`,
      },
      body: JSON.stringify([
        Number(intentId),
        region,
        visibleStars,
        nonce.toString(),
        deadline,
        signature
      ]),
    });
    if (!res.ok) {
      throw new Error(`HTTP answer_trace failed: ${await res.text().catch(() => "")}`);
    }
  } else {
    // cliCall JSON-encodes the hex strings (String params) and passes the
    // numeric args (u64 id/nonce included) as bare literals.
    await cliCall(DB, "answer_trace", [
      Number(intentId),
      region,
      visibleStars,
      nonce,
      deadline,
      signature,
    ]);
  }
}

// ── Main loop ────────────────────────────────────────────────────────────────

const account = ATTESTOR_PRIVATE_KEY ? privateKeyToAccount(ATTESTOR_PRIVATE_KEY) : null;

async function processIntent(row: Record<string, any>): Promise<void> {
  // Rows arrive normalized from the WS feed; parseValue is value-shape tolerant.
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

  const nonce = await nextNonce(constellationId, evm);
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
  console.log(`  TTL:        ${ATTESTATION_TTL_SECS}s, transport: WebSocket subscription + periodic /sql re-sweep\n`);

  // React to new un-attested trace intents the module produces (plus startup backlog).
  startFeed({
    uri: SPACETIMEDB_URI,
    db: DB,
    token: SPACETIME_TOKEN || undefined,
    table: "trace_intent",
    query: "SELECT * FROM trace_intent WHERE attested = false",
    idField: "intent_id",
    accept: (r) => r.attested === false,
    label: "constellation",
    onRow: processIntent,
  });
}

main();
