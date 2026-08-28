// Pentacles — feeder supervisor: one Bun process suitable as a hosted worker
// (e.g. a Railway service with `bun run all` as the start command).
//
// Spawns every companion service as a child Bun process with the parent's env,
// pipes each child's stdout/stderr through line-buffered with a [service-name]
// prefix, and restarts any child that exits with exponential backoff: 1s,
// doubling to a 60s cap, resetting to 1s once a child has stayed up 5 minutes.
// Dependency-free by design — no npm supervisor packages, just Bun.spawn.
//
// Children (each also runs standalone via the package.json scripts):
//   oracle         oracle-service.ts         Claude Oracle answers
//   duel           duel-service.ts           Word-Duel agent moves
//   jing           jing-service.ts           Jing Arena agent counters
//   constellation  constellation-service.ts  EIP-712 visibility attestor
//   bridge         bridge-service.ts         verified burn-and-mint settlement
//   ephemeris      push-ephemeris.ts         real ephemeris → push_ephemeris
//   war-table      war-table.ts              the 60s multi-seat zone melee round
//
// push-ephemeris already loops on its own timer (FEED_INTERVAL_MIN, default
// 15 min), so it is supervised like the long-running services rather than
// re-spawned on an external interval. If it crashes and sits out a backoff
// window, that's fine: the server's tick_sky has a sidereal fallback that keeps
// the sky moving whenever the feed is late.
//
// A child that exits IMMEDIATELY (e.g. oracle-service without
// ANTHROPIC_API_KEY, constellation-service without ATTESTOR_PRIVATE_KEY) is
// restarted on the same backoff schedule — it settles at one attempt per 60s,
// with the child's own error line telling you which env var is missing.
//
// SIGINT/SIGTERM: forward SIGTERM to every child, wait briefly for them to
// exit, then exit ourselves — so `railway down` / Ctrl+C never leaves orphans.
//
// HEALTH LOOP: every HEALTH_INTERVAL_MS (default 5 min; first pass ~15s after
// boot) the supervisor probes the planetary-agents and WTEN backends' /health
// and reports each — plus its own "feeders" heartbeat (all children up?) — via
// the owner-gated report_service_health reducer (HTTP bearer write, CLI
// fallback). Probe/report failures log and continue; the reducer doesn't exist
// on live DBs until the next module publish, so write errors are EXPECTED and
// must never crash the supervisor.
//
// Env knobs: everything the children read (SPACETIMEDB_URI/DB, SPACETIME_TOKEN,
// ANTHROPIC_API_KEY, …) is inherited verbatim; the supervisor itself reads
// HEALTH_INTERVAL_MS, WTEN_BACKEND_URL, and PLANETARY_AGENTS_BACKEND_URL (via
// brain.ts) for the health loop.

import { cliCall } from "./spacetime-cli";
import { BRAIN_PRIMARY_URL as PA_URL } from "./brain";

interface Service {
  name: string; // log prefix + registry key
  file: string; // entrypoint, relative to feeder/
}

const SERVICES: Service[] = [
  { name: "oracle", file: "oracle-service.ts" },
  { name: "duel", file: "duel-service.ts" },
  { name: "jing", file: "jing-service.ts" },
  { name: "constellation", file: "constellation-service.ts" },
  { name: "bridge", file: "bridge-service.ts" },
  { name: "ephemeris", file: "push-ephemeris.ts" },
  { name: "solana-sync", file: "solana-sync-service.ts" },
  { name: "historical-agents", file: "historical-agent-service.ts" },
  { name: "war-table", file: "war-table.ts" },
  { name: "indoor-spatial", file: "indoor-spatial-service.ts" },
];

const BACKOFF_MIN_MS = 1_000; // first restart delay
const BACKOFF_MAX_MS = 60_000; // cap — a persistently-crashing child retries once a minute
const HEALTHY_RESET_MS = 300_000; // 5 min up ⇒ the next crash starts from 1s again

let shuttingDown = false;
const children = new Map<string, ReturnType<typeof Bun.spawn>>(); // name → live child
const pendingRestarts = new Set<ReturnType<typeof setTimeout>>(); // timers to cancel on shutdown

function log(line: string): void {
  console.log(`[all] ${line}`);
}

// Re-emit a child's stream line-by-line with its service prefix. Buffering on
// newlines keeps interleaved children from shredding each other's output; a
// trailing partial line is flushed when the stream closes.
async function pipePrefixed(
  stream: ReadableStream<Uint8Array>,
  prefix: string,
  sink: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        sink(`[${prefix}] ${buf.slice(0, nl)}`);
        buf = buf.slice(nl + 1);
      }
    }
  } catch {
    /* stream torn down mid-read on child exit — nothing to do */
  }
  if (buf) sink(`[${prefix}] ${buf}`);
}

// Start one service and keep it alive forever (until shutdown). The backoff
// state lives in this closure, per service.
function supervise(svc: Service): void {
  let backoffMs = BACKOFF_MIN_MS;

  const start = (): void => {
    if (shuttingDown) return;
    const startedAt = Date.now();
    const child = Bun.spawn(["bun", "run", svc.file], {
      cwd: import.meta.dir, // feeder/ — children resolve ./stdb-feed etc. from here
      env: { ...process.env }, // inherit tokens/keys/URIs verbatim
      stdout: "pipe",
      stderr: "pipe",
    });
    children.set(svc.name, child);
    log(`${svc.name} started (pid ${child.pid}).`);
    // Fire-and-forget: these resolve when the child's streams close.
    pipePrefixed(child.stdout as ReadableStream<Uint8Array>, svc.name, (l) => console.log(l));
    pipePrefixed(child.stderr as ReadableStream<Uint8Array>, svc.name, (l) => console.error(l));

    child.exited.then((code) => {
      children.delete(svc.name);
      if (shuttingDown) return; // shutdown() is already reaping — don't restart
      const uptimeMs = Date.now() - startedAt;
      if (uptimeMs >= HEALTHY_RESET_MS) backoffMs = BACKOFF_MIN_MS; // was healthy — start fresh
      log(
        `${svc.name} exited (code ${code}) after ${(uptimeMs / 1000).toFixed(1)}s — ` +
          `restarting in ${backoffMs / 1000}s.`,
      );
      const timer = setTimeout(() => {
        pendingRestarts.delete(timer);
        start();
      }, backoffMs);
      pendingRestarts.add(timer);
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
    });
  };

  start();
}

// ── Health probes + heartbeat ────────────────────────────────────────────────

const DB = process.env.SPACETIMEDB_DB ?? "cookingwithcastrollc";
const SPACETIMEDB_URI = (process.env.SPACETIMEDB_URI ?? "https://maincloud.spacetimedb.com").replace(/\/+$/, "");
const SPACETIME_TOKEN = process.env.SPACETIME_TOKEN || "";
const WTEN_URL = (
  process.env.WTEN_BACKEND_URL ?? "https://whattoeatnext-production.up.railway.app"
).replace(/\/+$/, "");

const rawHealthMs = Number(process.env.HEALTH_INTERVAL_MS ?? "300000");
const HEALTH_INTERVAL_MS = Number.isFinite(rawHealthMs) && rawHealthMs >= 1_000 ? rawHealthMs : 300_000;
const PROBE_TIMEOUT_MS = 10_000;

const healthTimers: ReturnType<typeof setTimeout>[] = []; // first-shot + interval, cleared on shutdown

// Owner-gated write, mirroring how oracle-service builds its answerOracle call:
// HTTP POST /v1/database/{DB}/call/report_service_health with the bearer token
// (positional JSON array args), spacetime CLI fallback when the token is blank.
// detail is truncated server-side at 200 chars; pre-trim to keep logs/CLI tidy.
async function reportServiceHealth(
  service: string,
  healthy: boolean,
  detail: string,
  latencyMs: number,
): Promise<void> {
  detail = detail.slice(0, 200);
  latencyMs = Math.max(0, Math.min(0xffffffff, Math.round(latencyMs))); // u32 clamp
  if (SPACETIME_TOKEN) {
    const res = await fetch(`${SPACETIMEDB_URI}/v1/database/${DB}/call/report_service_health`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SPACETIME_TOKEN}`,
      },
      body: JSON.stringify([service, healthy, detail, latencyMs]),
    });
    if (!res.ok) {
      throw new Error(`HTTP report_service_health failed: ${res.status} ${await res.text().catch(() => "")}`);
    }
  } else {
    // cliCall JSON-encodes the strings — detail is often a raw /health JSON
    // body full of double quotes — and passes bool/number as bare literals.
    await cliCall(DB, "report_service_health", [service, healthy, detail, latencyMs]);
  }
}

// GET {base}/health, timing the round trip. Never throws — a down backend is a
// result ({healthy:false}), not an error.
async function probeHealth(base: string): Promise<{ healthy: boolean; detail: string; latencyMs: number }> {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    const latencyMs = Date.now() - t0;
    if (!res.ok) return { healthy: false, detail: `HTTP ${res.status}`, latencyMs };
    return { healthy: true, detail: (await res.text().catch(() => "ok")).slice(0, 200), latencyMs };
  } catch (err) {
    const msg = ((err as Error)?.message || String(err)).split("\n")[0];
    return { healthy: false, detail: msg, latencyMs: Date.now() - t0 };
  }
}

// Supervisor self-report: healthy iff every child process is currently live
// (a missing child is sitting out a restart backoff window).
function feedersHeartbeat(): { healthy: boolean; detail: string } {
  const down = SERVICES.filter((s) => !children.has(s.name)).map((s) => s.name);
  const up = SERVICES.length - down.length;
  return down.length === 0
    ? { healthy: true, detail: `${up}/${SERVICES.length} children up` }
    : { healthy: false, detail: `${up}/${SERVICES.length} up; backoff: ${down.join(", ")}` };
}

async function healthPass(): Promise<void> {
  if (shuttingDown) return;
  const [pa, wten] = await Promise.all([probeHealth(PA_URL), probeHealth(WTEN_URL)]);
  const feeders = feedersHeartbeat();
  log(
    `health: planetary-agents ${pa.healthy ? "ok" : "DOWN"} ${pa.latencyMs}ms; ` +
      `wten ${wten.healthy ? "ok" : "DOWN"} ${wten.latencyMs}ms; feeders ${feeders.detail}.`,
  );
  const reports: Array<[string, boolean, string, number]> = [
    ["planetary-agents", pa.healthy, pa.detail, pa.latencyMs],
    ["wten", wten.healthy, wten.detail, wten.latencyMs],
    ["feeders", feeders.healthy, feeders.detail, 0],
  ];
  for (const [service, healthy, detail, latencyMs] of reports) {
    try {
      await reportServiceHealth(service, healthy, detail, latencyMs);
    } catch (err) {
      // report_service_health is live on prod, so a failure here is a real
      // (usually transient) write problem — e.g. a maincloud outage. Log and
      // carry on; never crash. Persistent repeats deserve investigation.
      log(
        `health report "${service}" not written (${((err as Error).message || String(err)).split("\n")[0]}) — ` +
          `transient unless it repeats.`,
      );
    }
  }
}

// First pass ~15s after boot (sooner if the interval itself is shorter, so a
// short test interval still fires promptly), then every HEALTH_INTERVAL_MS.
function startHealthLoop(): void {
  const first = setTimeout(() => {
    void healthPass();
    const every = setInterval(() => void healthPass(), HEALTH_INTERVAL_MS);
    healthTimers.push(every);
  }, Math.min(15_000, HEALTH_INTERVAL_MS));
  healthTimers.push(first);
  log(
    `health loop: every ${HEALTH_INTERVAL_MS / 1000}s → ${PA_URL}/health, ${WTEN_URL}/health, ` +
      `self-heartbeat "feeders" (reports via report_service_health on ${DB}).`,
  );
}

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return; // double-signal (e.g. two Ctrl+C) — first one wins
  shuttingDown = true;
  log(`${signal} received — stopping ${children.size} child(ren)…`);
  for (const timer of pendingRestarts) clearTimeout(timer);
  for (const timer of healthTimers) clearTimeout(timer); // clearTimeout clears intervals too
  const exits: Promise<unknown>[] = [];
  for (const [name, child] of children) {
    try {
      child.kill("SIGTERM");
      exits.push(child.exited);
    } catch (err) {
      log(`failed to signal ${name}: ${(err as Error).message}`);
    }
  }
  // Wait for the children, but never longer than 5s — a wedged child must not
  // be able to hold the whole worker hostage during a redeploy.
  await Promise.race([Promise.allSettled(exits), Bun.sleep(5_000)]);
  log("children stopped; exiting.");
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

log(
  `supervising ${SERVICES.length} feeders → db=${DB} ` +
    `(writes: ${SPACETIME_TOKEN ? "HTTP bearer token" : "spacetime CLI fallback"}).`,
);
for (const svc of SERVICES) supervise(svc);
startHealthLoop();
