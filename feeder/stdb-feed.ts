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
// twice if a reconnect re-delivers an still-unanswered backlog row. Reads flow over
// the WebSocket; writes (answer_* reducers) stay on the owner-gated HTTP path.
import { DbConnection } from "../src/module_bindings";
import { normalizeWsRow } from "../src/net/ws-normalize.js";

export interface FeedOptions {
  uri: string;
  db: string;
  token?: string;
  /** Table accessor name, e.g. "oracle_request". */
  table: string;
  /** Subscription SQL, e.g. "SELECT * FROM oracle_request WHERE answered = false". */
  query: string;
  /** Field used to de-dupe in-flight processing, e.g. "request_id". */
  idField: string;
  /** Process one (normalized, snake_case) row. */
  onRow: (row: Record<string, any>) => Promise<void>;
  /** Optional client-side filter (belt-and-suspenders alongside the query WHERE). */
  accept?: (row: Record<string, any>) => boolean;
  /** Log prefix, e.g. "Oracle". */
  label: string;
}

export function startFeed(opts: FeedOptions): void {
  const { label } = opts;
  const inFlight = new Set<string>();

  const handle = async (raw: any) => {
    const row = normalizeWsRow(raw);
    if (opts.accept && !opts.accept(row)) return;
    const id = String(row[opts.idField]);
    if (inFlight.has(id)) return;
    inFlight.add(id);
    try {
      await opts.onRow(row);
    } catch (err) {
      console.error(`[${label}] onRow error for ${opts.idField}=${id}:`, (err as Error).message);
    } finally {
      inFlight.delete(id);
    }
  };

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
}
