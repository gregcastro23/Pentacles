// Pentacles — shared SpacetimeDB 2.x WebSocket feed for the companion services.
//
// Replaces the old 3s HTTP /sql poll loop with a reactive subscription: the SDK
// keeps a client cache and fires onInsert as new rows arrive. Each feeder hands us
// a subscription query (e.g. "SELECT * FROM oracle_request WHERE answered = false")
// and an onRow handler; we deliver the startup backlog (onApplied) plus every later
// insert. Rows are normalized to the snake_case shape the feeders already expect, so
// each service's processX() and its HTTP answer path are unchanged.
//
// An in-flight guard (keyed by idField) prevents the same row from being processed
// twice if a reconnect re-delivers a still-unanswered backlog row. Reads flow over
// the WebSocket; writes (answer_* reducers) stay on the owner-gated HTTP path.
//
// RE-SWEEP: the subscription only fires when a row ARRIVES. A row whose processing
// failed transiently (e.g. a 429/5xx left it unanswered) used to sit until a WS
// reconnect re-delivered the backlog. Every RESWEEP_MS (default 5 min) we therefore
// run the same query as a one-shot HTTP /sql fetch and re-dispatch any row that is
// not already in flight — the same in-flight set guards both paths, and a row a
// service is deliberately holding (e.g. the oracle's rate-limit queue keeps its
// processRequest parked) stays in-flight and is never double-enqueued.
import { DbConnection } from "../src/module_bindings";
import { normalizeWsRow } from "../src/net/ws-normalize.js";

export interface FeedOptions {
  uri: string;
  db: string;
  token?: string;
  /** Table accessor name, e.g. "oracle_request". */
  table: string;
  /** Subscription SQL, e.g. "SELECT * FROM oracle_request WHERE answered = false".
   *  Also reused verbatim for the periodic one-shot /sql re-sweep. */
  query: string;
  /** Field used to de-dupe in-flight processing, e.g. "request_id". */
  idField: string;
  /** Process one (normalized, snake_case) row. */
  onRow: (row: Record<string, any>) => Promise<void>;
  /** Optional client-side filter (belt-and-suspenders alongside the query WHERE). */
  accept?: (row: Record<string, any>) => boolean;
  /** Log prefix, e.g. "Oracle". */
  label: string;
  /** Re-sweep period in ms; defaults to env RESWEEP_MS (300000). <= 0 disables. */
  resweepMs?: number;
}

// ── One-shot HTTP /sql (read-only) ──────────────────────────────────────────
//
// The pre-WebSocket poll transport, kept for point reads (constellation's
// regionCommit) and the re-sweep. Rows come back positional with a SATS schema;
// decodeSats mirrors normalizeWsRow's output shape for the value kinds the
// feeders actually consume: enum → PascalCase variant-name string (e.g. "Open",
// "Mars"), Option → value|null, Identity/ConnectionId → "0x…" hex string,
// Timestamp → micros number. Other products and primitives pass through untouched.

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Special one-field wrapper products the server emits as a positional
// single-element array; unwrapping them matches normalizeWsRow's plain values.
const WRAPPER_FIELDS = new Set(["__identity__", "__connection_id__", "__timestamp_micros_since_unix_epoch__"]);

export function decodeSats(type: any, val: any): any {
  if (type?.Sum) {
    const variants = type.Sum.variants ?? [];
    if (!Array.isArray(val)) return val;
    const [tag, payload] = val;
    const variant = variants[tag];
    const vname = (variant && (variant.name?.some ?? variant.name)) ?? String(tag);
    const isOption = variants.length === 2 && variants.some((v: any) => (v?.name?.some ?? v?.name) === "none");
    if (isOption) return vname === "none" ? null : decodeSats(variant?.algebraic_type, payload);
    // /sql schemas name sum variants lowerFirst ("open", "tectonicRoot", "mars");
    // the WS bindings — and every feeder predicate built against them, e.g.
    // jing's row.state === "Open" and COUNTER_OF[opening] — use PascalCase tags.
    // Restore the tag casing so both transports deliver the same shape.
    return upperFirst(vname);
  }
  if (type?.Product) {
    // Identity et al arrive as a positional single-element product wrapping the
    // value (e.g. ["0xc200…"]); unwrap to the plain hex string / micros number
    // normalizeWsRow delivers (constellation's regionCommit interpolates the
    // trader identity into a /sql WHERE clause, so the wrapper array breaks it).
    const els = type.Product.elements ?? [];
    const ename = els[0]?.name?.some ?? els[0]?.name;
    if (els.length === 1 && WRAPPER_FIELDS.has(ename) && Array.isArray(val) && val.length === 1) {
      return val[0];
    }
  }
  // Schema-less safety net for the same Identity shape (one-element array
  // holding a 0x-prefixed hex string).
  if (!type && Array.isArray(val) && val.length === 1 && typeof val[0] === "string" && /^0x[0-9a-fA-F]+$/.test(val[0])) {
    return val[0];
  }
  return val;
}

export async function sqlOneShot(
  uri: string,
  db: string,
  token: string | undefined,
  query: string,
): Promise<Array<Record<string, any>>> {
  const headers: Record<string, string> = { "Content-Type": "text/plain" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${uri}/v1/database/${db}/sql`, {
    method: "POST",
    headers,
    body: query,
  });
  if (!res.ok) throw new Error(`sql ${res.status}: ${await res.text().catch(() => "")}`);
  const json: any = await res.json();
  const stmt = Array.isArray(json) ? json[json.length - 1] : json;
  const els = stmt?.schema?.elements ?? [];
  const cols = els.map((e: any, i: number) => (typeof e?.name === "string" ? e.name : e?.name?.some ?? `col${i}`));
  const types = els.map((e: any) => e?.algebraic_type);
  return (stmt?.rows ?? []).map((row: any[]) => {
    const o: Record<string, any> = {};
    row.forEach((v, i) => (o[cols[i] ?? `col${i}`] = decodeSats(types[i], v)));
    return o;
  });
}

// ── Reactive feed + re-sweep ────────────────────────────────────────────────

export function startFeed(opts: FeedOptions): void {
  const { label } = opts;
  const inFlight = new Set<string>();

  // Re-sweep TOCTOU guard: a row that completes (answered) DURING the /sql round
  // trip has already left inFlight by the time the stale snapshot row is
  // dispatched, so the in-flight set alone would let it re-run onRow — one
  // duplicate billed brain/Claude call. Recording each id for a short grace
  // window after it finishes closes that gap. 60s comfortably covers the /sql
  // round trip while staying well under RESWEEP_MS (default 5 min), so a row
  // whose processing genuinely failed is still retried on the next sweep.
  const DONE_GRACE_MS = 60_000;
  const recentlyDone = new Map<string, number>(); // id → finished-at ms

  // Route one already-normalized row through accept → in-flight dedupe → onRow.
  // Returns true if the row was actually dispatched (used by the re-sweep to log
  // only when it picked something up). The accept/dedupe/add sequence is fully
  // synchronous, so a WS insert and a re-sweep hit racing on the same id can
  // never both pass the guard.
  const dispatch = (row: Record<string, any>): boolean => {
    if (opts.accept && !opts.accept(row)) return false;
    const id = String(row[opts.idField]);
    if (inFlight.has(id)) return false;
    const doneAt = recentlyDone.get(id);
    if (doneAt !== undefined && Date.now() - doneAt < DONE_GRACE_MS) return false;
    inFlight.add(id);
    (async () => {
      try {
        await opts.onRow(row);
      } catch (err) {
        console.error(`[${label}] onRow error for ${opts.idField}=${id}:`, (err as Error).message);
      } finally {
        inFlight.delete(id);
        recentlyDone.set(id, Date.now());
        // Opportunistic prune so the map can't grow without bound.
        const cutoff = Date.now() - DONE_GRACE_MS;
        for (const [k, t] of recentlyDone) if (t <= cutoff) recentlyDone.delete(k);
      }
    })();
    return true;
  };

  // WS rows arrive in SDK shape (camelCase keys, tagged enums) — normalize first.
  const handle = (raw: any) => { dispatch(normalizeWsRow(raw)); };

  let reconnecting = false;
  const scheduleReconnect = () => {
    if (reconnecting) return;
    reconnecting = true;
    setTimeout(() => { reconnecting = false; connect(); }, 3000);
  };

  const connect = () => {
    try {
      let builder = DbConnection.builder()
        .withUri(opts.uri)
        .withDatabaseName(opts.db)
        .onConnect((conn: any) => {
          console.log(`[${label}] WebSocket connected; subscribing.`);
          // Fire on every new row entering the subscribed (filtered) set.
          conn.db[opts.table].onInsert((_ctx: any, row: any) => { handle(row); });
          conn
            .subscriptionBuilder()
            .onApplied(() => {
              const rows = [...conn.db[opts.table].iter()];
              if (rows.length) console.log(`[${label}] backlog: ${rows.length} pending row(s).`);
              for (const r of rows) handle(r);
            })
            .onError((ctx: any) => {
              console.error(`[${label}] subscription error:`, ctx?.event ?? "unknown");
            })
            .subscribe([opts.query]);
        })
        .onConnectError((_ctx: any, err: any) => {
          console.error(`[${label}] connect error:`, err?.message ?? err);
          scheduleReconnect();
        })
        .onDisconnect((_ctx: any, err: any) => {
          console.warn(`[${label}] disconnected${err ? ": " + err.message : ""}; reconnecting…`);
          scheduleReconnect();
        });
      if (opts.token) builder = builder.withToken(opts.token);
      builder.build();
    } catch (err) {
      console.error(`[${label}] failed to build connection:`, (err as Error).message);
      scheduleReconnect();
    }
  };

  connect();

  // Periodic re-sweep: catch rows a transient failure left behind without waiting
  // for a WS reconnect. One-shot /sql of the SAME query; anything already in
  // flight (including rows a service is holding in its own queue) is skipped.
  const resweepMs = opts.resweepMs ?? Number(process.env.RESWEEP_MS ?? "300000");
  if (resweepMs > 0) {
    setInterval(async () => {
      try {
        const rows = await sqlOneShot(opts.uri, opts.db, opts.token, opts.query);
        let picked = 0;
        for (const row of rows) if (dispatch(row)) picked++;
        if (picked) console.log(`[${label}] re-sweep: re-dispatched ${picked} stale row(s).`);
      } catch (err) {
        // Read-only + retried in RESWEEP_MS anyway — warn, never crash the feed.
        console.warn(`[${label}] re-sweep failed:`, (err as Error).message);
      }
    }, resweepMs);
  }
}
