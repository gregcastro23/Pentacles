// Pentacles — shared `spacetime` CLI resolution + owner-gated write fallback.
//
// Every feeder writes through owner-gated reducers. The PRIMARY write path is
// HTTP: POST /v1/database/{DB}/call/<reducer> with `Authorization: Bearer
// SPACETIME_TOKEN`. When the token is blank (local dev), each service falls
// back to shelling out to the `spacetime` CLI, which authenticates as your
// logged-in owner identity instead. This module centralizes the two pieces of
// that fallback that used to be copy-pasted into all five services:
//
//   • locating the binary (SPACETIMEDB_CLI env → ~/.local/bin/spacetime → PATH)
//   • the `spacetime call DB reducer -- ...args` invocation itself, with a
//     LOUD once-per-process warning so a production deploy that forgot the
//     token is impossible to miss in the logs (per-write failures still log
//     normally at each call site).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { join } from "node:path";

const run = promisify(execFile);

export function getSpacetimeCli(): string {
  if (process.env.SPACETIMEDB_CLI) return process.env.SPACETIMEDB_CLI;
  if (process.env.HOME) {
    const localBin = join(process.env.HOME, ".local", "bin", "spacetime");
    if (existsSync(localBin)) return localBin;
  }
  return "spacetime";
}

export const SPACETIMEDB_CLI = getSpacetimeCli();

let warnedCliFallback = false;

// One reducer argument for the CLI fallback. Encoding is explicit at this
// boundary because the CLI's own string handling is unsafe: an arg aimed at a
// String param that does not already start AND end with '"' gets quote-WRAPPED
// verbatim — WITHOUT escaping — so any value containing a double quote or a
// newline (oracle prose answers, raw /health JSON bodies used as
// report_service_health detail) produced invalid JSON → HTTP 400 on every
// write, and with the 5-min re-sweep that meant a recurring re-billed Claude
// call in CLI-fallback mode.
//
//   string          → JSON.stringify'd here. A JSON-encoded string starts/ends
//                     with '"', so the CLI passes it through untouched and the
//                     server decodes exactly the intended string — quotes,
//                     newlines and all.
//   number|boolean|bigint → String(v): a bare JSON literal the CLI forwards as-is.
//   { raw: string } → passed VERBATIM. For pre-encoded SATS-JSON values whose
//                     param type is NOT String (e.g. jing's sum '{"meltdown":[]}');
//                     the CLI forwards non-quote-delimited args untouched for such
//                     types, and the server must see them byte-identical. Never
//                     wrap a plain prose string in {raw}.
export type CliArg = string | number | boolean | bigint | { raw: string };

function encodeCliArg(arg: CliArg): string {
  if (typeof arg === "object" && arg !== null) return arg.raw;
  if (typeof arg === "string") return JSON.stringify(arg);
  return String(arg);
}

// Owner-gated reducer call via the CLI fallback. Throws on a non-zero exit,
// exactly like the HTTP path throws on a non-OK status — call sites treat both
// identically. (The HTTP bearer path builds a JSON body itself and never goes
// through this encoding.)
export async function cliCall(db: string, reducer: string, args: CliArg[]): Promise<void> {
  if (!warnedCliFallback) {
    warnedCliFallback = true;
    console.warn(
      "SPACETIME_TOKEN not set — falling back to the spacetime CLI for writes; " +
        "set the token for production.",
    );
  }
  await run(SPACETIMEDB_CLI, ["call", db, reducer, "--", ...args.map(encodeCliArg)]);
}
