// LOCAL ONLY: seed committed main, publish the changed module compatibly, verify.
// Usage: bun scripts/private-reads-local.ts seed|verify DATABASE [FIXTURE_PATH]
// Auth tokens stay in a mode-0600 /private/tmp fixture and are never logged.
import assert from "node:assert/strict";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import bs58 from "bs58";
import { DbConnection } from "../src/module_bindings";
import { normalizeWsRow } from "../src/net/ws-normalize.js";
import { normalizeSqlResult } from "../src/net/sats-json.js";

const URI = "http://127.0.0.1:3000";
const VIEWS = ["my_natal_chart", "my_star_stake", "my_trace_intent", "my_trace_attestation"];
const PRIVATE_TABLES = ["natal_chart", "star_stake", "trace_intent", "trace_attestation"];
const CON = 2; // Cassiopeia is circumpolar at the North Pole in the initial seed.
const STAR = 32349;
const [phase, database, pathArg] = process.argv.slice(2);
assert(phase === "seed" || phase === "verify", "Expected seed or verify phase");
assert(/^pentacles-private-reads-[a-z0-9-]+$/.test(database || ""), "Use a temporary pentacles-private-reads-* database");
const fixturePath = resolve(pathArg || `/private/tmp/${database}.json`);
assert(fixturePath.startsWith("/private/tmp/"), "Fixture tokens must remain under /private/tmp");

type PlayerFixture = {
  label: string; identity: string; token: string; pubkey: string;
  birthLat: number; birthLon: number; principal: string; shares: string;
  intentId: string; regionCommit: string; visibleStars: number;
  nonce: string; deadline: string; signature: string;
};
type Fixture = { database: string; uri: string; players: PlayerFixture[] };
const tokens = new Set<string>();
const connections = new Set<any>();
const subscriptions = new Set<any>();
const hex = (v: any) => String(v?.toHexString?.() ?? v?.__identity__ ?? v).toLowerCase().replace(/^0x/, "");
const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const redact = (s: unknown) => {
  let text = String(s);
  for (const token of tokens) text = text.replaceAll(token, "[redacted]");
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[redacted]");
};

async function bounded<T>(promise: Promise<T>, label: string, ms = 10000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    })]);
  } finally { clearTimeout(timer!); }
}

async function cli(args: string[]) {
  const child = Bun.spawn(["perl", "-e", "alarm 20; exec @ARGV", "spacetime", ...args, "-s", "local", "--no-config"], {
    stdout: "pipe", stderr: "pipe", stdin: "ignore",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  assert.equal(code, 0, `Local spacetime ${args[0]} failed: ${redact(stderr || stdout)}`);
  return stdout;
}

async function ownerCall(reducer: string, args: (string | number | bigint)[]) {
  await cli(["call", database, reducer, ...args.map(String)]);
}

async function ownerRows(table: string): Promise<any[]> {
  const raw = await cli(["sql", "--format", "json", database, `SELECT * FROM ${table}`]);
  const data = JSON.parse(raw);
  // CLI releases may emit normalized objects or the endpoint's SATS schema/rows.
  if (Array.isArray(data) && (!data.length || (data[0] && !data[0].schema && !data[0].rows))) return data;
  return normalizeSqlResult(data);
}

async function freshIdentity() {
  const response = await fetch(`${URI}/v1/identity`, { method: "POST", signal: AbortSignal.timeout(10000) });
  assert(response.ok, `Local identity creation failed (${response.status})`);
  const data = await response.json() as { identity: string; token: string };
  assert(data.identity && data.token, "Local identity response was incomplete");
  tokens.add(data.token);
  return data;
}

async function connect(player: { identity: string; token: string }) {
  tokens.add(player.token);
  return bounded(new Promise<any>((resolveConnection, reject) => {
    let conn: any;
    conn = DbConnection.builder().withUri(URI).withDatabaseName(database).withToken(player.token)
      .onConnect((connected, identity) => {
        assert.equal(hex(identity), hex(player.identity), "Connection must retain the fixture's identity");
        connections.add(connected);
        resolveConnection(connected);
      })
      .onConnectError((_ctx, err) => reject(new Error(redact(err?.message || "Local connection failed"))))
      .build();
    connections.add(conn);
  }), "Local connection");
}

function chartFor(conn: any, p: { birthLat: number; birthLon: number }) {
  return {
    identity: conn.identity, birthUnix: 0n, birthLat: p.birthLat, birthLon: p.birthLon,
    timeKnown: false, placements: [], ascendant: 0, midheaven: 0,
    houseCusps: undefined, houseSystem: { tag: "WholeSign" }, interceptedSigns: undefined,
  };
}

async function createPlayer(conn: any, p: { label: string; birthLat: number; birthLon: number }) {
  await bounded(conn.reducers.createPlayer({
    handle: `Local private ${p.label}`, chart: chartFor(conn, p), faction: { tag: "Sun" },
  }), "create_player");
}

async function bindWallet(conn: any, identity: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicBytes = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const pubkey = bs58.encode(publicBytes);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);
  const message = [
    "Pentacles Solana Wallet Binding", "Domain: pentacles.alchm.kitchen", "Cluster: devnet",
    `Identity: 0x${hex(identity)}`, `Pubkey: ${pubkey}`, `Deadline: ${deadline}`,
  ].join("\n");
  const proof = bs58.encode(sign(null, Buffer.from(message), privateKey));
  await bounded(conn.reducers.bindSolanaWallet({
    cluster: "devnet", solanaPubkey: pubkey, signatureB58: proof, deadlineSecs: deadline,
  }), "bind_solana_wallet");
  return pubkey;
}

async function recordStake(p: PlayerFixture, principal = p.principal, shares = p.shares) {
  await ownerCall("record_star_stake", [
    JSON.stringify({ solanaToken2022: {} }), JSON.stringify(bs58.encode(randomBytes(64))),
    JSON.stringify(p.pubkey), STAR, principal, shares,
  ]);
}

async function requestAndAnswerTrace(conn: any, p: PlayerFixture, nonce = p.nonce) {
  await bounded(conn.reducers.traceConstellation({ constellationId: CON, solanaPubkey: p.pubkey }), "trace_constellation");
  const rows = (await ownerRows("trace_intent")).filter((r) => hex(r.trader) === hex(p.identity));
  rows.sort((a, b) => BigInt(a.intent_id) < BigInt(b.intent_id) ? 1 : -1);
  const intent = rows[0];
  assert(intent, "Owner must see the new trace intent");
  const intentId = String(intent.intent_id);
  await ownerCall("answer_trace", [
    intentId, JSON.stringify(p.regionCommit), p.visibleStars, nonce, p.deadline, JSON.stringify(p.signature),
  ]);
  return intentId;
}

async function seed() {
  const fixture: Fixture = { database, uri: URI, players: [] };
  for (const [i, label] of ["A", "B"].entries()) {
    const identity = await freshIdentity();
    const conn = await connect(identity);
    const p: PlayerFixture = {
      label, ...identity, pubkey: "", birthLat: 1 + i, birthLon: -3 - i,
      principal: String(1234500 + i), shares: String(770001 + i), intentId: "",
      regionCommit: `local-private-${label}`, visibleStars: 3 + i,
      nonce: (9007199254740993n + BigInt(i)).toString(),
      deadline: String(Math.floor(Date.now() / 1000) + 600), signature: bs58.encode(randomBytes(64)),
    };
    await createPlayer(conn, p);
    p.pubkey = await bindWallet(conn, p.identity);
    await recordStake(p);
    await bounded(conn.reducers.setLocation({ lat: 90, lon: 0 }), "set_location");
    p.intentId = await requestAndAnswerTrace(conn, p);
    fixture.players.push(p);
  }
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await chmod(fixturePath, 0o600);
  console.log(`Seeded two real player identities with distinct rows in all four private tables. Fixture: ${fixturePath}`);
}

async function subscribeViews(conn: any) {
  await bounded(new Promise<void>((resolveApplied, reject) => {
    const subscription = conn.subscriptionBuilder().onApplied(() => resolveApplied())
      .onError((_ctx: any, err: any) => reject(new Error(redact(err?.message || "Local view subscription failed"))))
      .subscribe(VIEWS.map((view) => `SELECT * FROM ${view}`));
    subscriptions.add(subscription);
  }), "Four player views applying");
}

const viewRows = (conn: any, view: string) => [...conn.db[camel(view)].iter()].map(normalizeWsRow);
function ownRows(conn: any, p: PlayerFixture, count = 1) {
  const chart = viewRows(conn, VIEWS[0]);
  assert.equal(chart.length, 1, `${p.label} must see only one natal chart`);
  assert.equal(hex(chart[0].identity), hex(p.identity));
  assert.equal(chart[0].birth_lat, p.birthLat);
  assert.equal(chart[0].birth_lon, p.birthLon);
  const stakes = viewRows(conn, VIEWS[1]);
  assert.equal(stakes.length, count, `${p.label} stake row count`);
  for (const row of stakes) assert.equal(hex(row.staker), hex(p.identity));
  assert(stakes.some((row) => String(row.principal_usdc) === p.principal && String(row.shares) === p.shares));
  const intents = viewRows(conn, VIEWS[2]);
  assert.equal(intents.length, count, `${p.label} intent row count`);
  for (const row of intents) assert.equal(hex(row.trader), hex(p.identity));
  assert(intents.some((row) => String(row.intent_id) === p.intentId && row.solana_pubkey === p.pubkey && row.attested));
  const replies = viewRows(conn, VIEWS[3]);
  assert.equal(replies.length, count, `${p.label} attestation row count`);
  for (const row of replies) assert.equal(hex(row.trader), hex(p.identity));
  const reply = replies.find((row) => String(row.intent_id) === p.intentId);
  assert(reply, `${p.label} attestation must answer its own fixture intent`);
  assert.equal(reply.constellation_id, CON);
  assert.equal(reply.region_commit, p.regionCommit);
  assert.equal(reply.visible_stars, p.visibleStars);
  assert.equal(String(reply.nonce), p.nonce);
  assert.equal(String(reply.deadline), p.deadline);
  assert.equal(reply.signature, p.signature);
}
function emptyRows(conn: any) {
  for (const view of VIEWS) assert.equal(viewRows(conn, view).length, 0, `Fresh third identity must see zero ${view} rows`);
}

async function eventually(check: () => void) {
  const deadline = Date.now() + 10000;
  while (true) {
    try { check(); return; } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((r) => setTimeout(r, 20)); // Cache check only; never resubscribe.
    }
  }
}

async function verify() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
  assert.equal(fixture.database, database);
  assert.equal(fixture.uri, URI, "Fixture must belong to this loopback server");
  assert.equal(fixture.players.length, 2);
  fixture.players.forEach((p) => tokens.add(p.token));
  const third = await freshIdentity();
  const identities = [...fixture.players, third];
  const clients = await Promise.all(identities.map(connect));
  await Promise.all(clients.map(subscribeViews));
  fixture.players.forEach((p, i) => ownRows(clients[i], p));
  emptyRows(clients[2]);
  console.log("Compatible migration retained both players' fixtures; each player sees only their own four views, and a third identity sees none.");

  for (const identity of identities) {
    for (const table of PRIVATE_TABLES) {
      const response = await fetch(`${URI}/v1/database/${database}/sql`, {
        method: "POST", headers: { Authorization: `Bearer ${identity.token}`, "Content-Type": "text/plain" },
        body: `SELECT * FROM ${table}`, signal: AbortSignal.timeout(10000),
      });
      const body = await response.text();
      assert(!response.ok, `Player HTTP /sql must refuse private ${table}`);
      assert(/private|no such table|not found/i.test(body), `Expected a private-table refusal for ${table} (${response.status})`);
    }
  }
  console.log("All 12 player HTTP /sql reads of the four raw private tables were refused.");

  const a = fixture.players[0];
  a.birthLat += 10;
  await createPlayer(clients[0], a);
  await recordStake(a, "2220000", "3330000");
  const newIntentId = await requestAndAnswerTrace(clients[0], a, "9007199254741999");
  await eventually(() => {
    ownRows(clients[0], a, 2);
    const replies = viewRows(clients[0], VIEWS[3]);
    assert(replies.some((row) => String(row.intent_id) === newIntentId && String(row.nonce) === "9007199254741999"));
    ownRows(clients[1], fixture.players[1]);
    emptyRows(clients[2]);
  });
  console.log("One held subscription delivered A's changed chart, second stake, second intent and attestation; B and the third identity received no foreign rows.");
}

try {
  if (phase === "seed") await seed();
  else await verify();
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : error));
  process.exitCode = 1;
} finally {
  for (const subscription of subscriptions) { try { subscription.unsubscribe(); } catch {} }
  for (const conn of connections) { try { conn.disconnect(); } catch {} }
}
