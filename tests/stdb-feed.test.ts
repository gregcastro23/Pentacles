// Every reactive feed must find its table in the generated bindings. The oracle
// feed reads `oracle_request`, a PRIVATE table, so the bindings must be generated
// with --include-private; without it the feed used to crash-loop (and, after a
// "safe lookup" patch, connect and silently handle nothing).
import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import { feedTableAccessor, startFeed } from "../feeder/stdb-feed";

const FEEDER_DIR = new URL("../feeder/", import.meta.url);

/** `table:` of every startFeed({...}) call in feeder/*.ts. */
function feedTables(): { file: string; table: string }[] {
  const out: { file: string; table: string }[] = [];
  for (const file of fs.readdirSync(FEEDER_DIR).filter((f) => f.endsWith(".ts"))) {
    const src = fs.readFileSync(new URL(file, FEEDER_DIR), "utf8");
    for (const m of src.matchAll(/startFeed\(\{[\s\S]*?table:\s*"([a-z0-9_]+)"/g)) out.push({ file, table: m[1] });
  }
  return out;
}

describe("feed tables resolve against src/module_bindings", () => {
  test("every startFeed table has a generated accessor", () => {
    const found = feedTables();
    expect(found.map((f) => f.table).sort()).toEqual(expect.arrayContaining(["duel_challenge", "jing_duel", "oracle_request", "pillar_duel"]));
    for (const { file, table } of found) {
      expect({ file, table, accessor: feedTableAccessor(table) }).not.toMatchObject({ accessor: null });
    }
  });

  test("private tables are generated (bun run gen passes --include-private)", () => {
    expect(feedTableAccessor("oracle_request")).toBe("oracleRequest");
    expect(feedTableAccessor("oracle_reply")).toBe("oracleReply");
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts.gen).toContain("--include-private");
  });
});

describe("feedTableAccessor", () => {
  const known = { oracleRequest: {}, legacy_name: {} };
  test("prefers the camelCase accessor, falls back to the raw name", () => {
    expect(feedTableAccessor("oracle_request", known)).toBe("oracleRequest");
    expect(feedTableAccessor("legacy_name", known)).toBe("legacy_name");
    expect(feedTableAccessor("missing_table", known)).toBe(null);
    expect(feedTableAccessor("constructor", known)).toBe(null);
  });
});

describe("startFeed", () => {
  test("a table missing from the bindings fails at startup, before connecting", () => {
    expect(() => startFeed({
      uri: "http://127.0.0.1:1", db: "none", table: "no_such_table", query: "SELECT * FROM no_such_table",
      idField: "id", onRow: async () => {}, label: "Test", resweepMs: 0,
    })).toThrow(/table "no_such_table" is not in src\/module_bindings/);
  });
});
