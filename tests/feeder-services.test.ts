import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SERVICES } from "../feeder/all";

describe("Feeder supervisor SERVICES registry", () => {
  const EXPECTED_SERVICES = [
    { name: "oracle", file: "oracle-service.ts" },
    { name: "duel", file: "duel-service.ts" },
    { name: "jing", file: "jing-service.ts" },
    { name: "ephemeris", file: "push-ephemeris.ts" },
    { name: "solana-sync", file: "solana-sync-service.ts" },
    { name: "historical-agents", file: "historical-agent-service.ts" },
    { name: "war-table", file: "war-table.ts" },
    { name: "indoor-spatial", file: "indoor-spatial-service.ts" },
  ];

  test("contains exactly the 8 active supervised companion services", () => {
    expect(SERVICES.length).toBe(8);
    expect(SERVICES).toEqual(EXPECTED_SERVICES);
  });

  test("contains no references to deprecated constellation or bridge services", () => {
    const names = SERVICES.map((s) => s.name);
    expect(names).not.toContain("constellation");
    expect(names).not.toContain("bridge");
  });

  test("every registered service entrypoint exists on disk in the feeder/ directory", () => {
    const feederDir = join(import.meta.dir, "..", "feeder");
    for (const svc of SERVICES) {
      const filePath = join(feederDir, svc.file);
      expect(existsSync(filePath)).toBe(true);
    }
  });
});
