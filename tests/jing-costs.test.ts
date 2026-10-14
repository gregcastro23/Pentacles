// The client's Jing costs (public/astro-weather.js) match the shared table the
// module's drain_pool is tested against (tests/fixtures/jing-costs.json), so the
// agent page never allows a cast the server refuses, or refuses one it allows.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/jing-costs.json", import.meta.url), "utf8"));
const sandbox: any = { window: {} };
vm.runInNewContext(readFileSync(new URL("../public/astro-weather.js", import.meta.url), "utf8"), sandbox);
const AW = sandbox.window.AstroWeather;

type Pool = { sacred7: number[]; esms: number[] };
const starter = (): Pool => ({ sacred7: Array(7).fill(100), esms: Array(4).fill(80) });

describe("Jing costs match the shared fixture", () => {
  test("the same moves, and the server's Sacred-7 order", () => {
    expect([...AW.MOVE_ORDER].sort()).toEqual(fixture.moves.map((m: any) => m.move).sort());
    expect([...AW.SACRED7]).toEqual(fixture.sacred7_order);
  });

  for (const want of fixture.moves) {
    test(want.move, () => {
      const m = AW.JING_MOVES[want.move];
      expect(AW.SACRED7.indexOf(m.stat)).toBe(want.sacred7);
      expect(m.statCost).toBe(want.sacred7_cost);
      expect([...AW.jingEsms(m)]).toEqual(want.esms);
      expect(m.esmsCost).toBe(want.esms_cost);

      // drainJing takes exactly the listed costs from exactly the listed axes.
      const pool = starter();
      AW.drainJing(pool, want.move);
      expect(pool.sacred7).toEqual(starter().sacred7.map((v, i) => (i === want.sacred7 ? v - want.sacred7_cost : v)));
      expect(pool.esms).toEqual(starter().esms.map((v, i) => (want.esms.includes(i) ? v - want.esms_cost : v)));

      // Exactly the cost is enough; one short on any drained axis is not.
      const exact = starter();
      exact.sacred7[want.sacred7] = want.sacred7_cost;
      for (const e of want.esms) exact.esms[e] = want.esms_cost;
      expect(AW.canAffordJing(exact, want.move)).toBe(true);
      const short = structuredClone(exact);
      short.sacred7[want.sacred7] -= 1;
      expect(AW.canAffordJing(short, want.move)).toBe(false);
      for (const e of want.esms) {
        const shortE = structuredClone(exact);
        shortE.esms[e] -= 1;
        expect(AW.canAffordJing(shortE, want.move)).toBe(false);
      }
    });
  }

  test("an unknown move or a missing pool is never affordable", () => {
    expect(AW.canAffordJing(starter(), "nope")).toBe(false);
    expect(AW.canAffordJing(null, "meltdown")).toBe(false);
  });
});
