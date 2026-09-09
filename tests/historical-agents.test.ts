import { describe, test, expect } from "bun:test";
import {
  HISTORICAL_AGENTS,
  FACTION_CHAMPIONS,
  AGENTS_BY_FACTION,
  PLANET_NAMES,
  getHistoricalAgents,
  getAgentsByFaction,
  getFactionChampion,
  getFactionChampions,
  getAgentByKey,
  getAgentByHandle,
  pickContenders,
} from "../src/alchm-chart/historical-agents.js";

describe("Canonical ALCHM Historical Agents Registry (ASOL)", () => {
  test("contains exactly 71 canonical historical figures from ASOL", () => {
    expect(HISTORICAL_AGENTS.length).toBe(71);
    expect(getHistoricalAgents().length).toBe(71);
  });

  test("contains zero placeholder agents (Hypatia, Paracelsus, Flamel, Dee)", () => {
    const handles = HISTORICAL_AGENTS.map((a) => a.handle.toLowerCase());
    const keys = HISTORICAL_AGENTS.map((a) => a.key.toLowerCase());

    expect(handles.some((h) => h.includes("hypatia"))).toBeFalse();
    expect(keys.some((k) => k.includes("hypatia"))).toBeFalse();

    expect(handles.some((h) => h.includes("paracelsus"))).toBeFalse();
    expect(keys.some((k) => k.includes("paracelsus"))).toBeFalse();

    expect(handles.some((h) => h.includes("flamel"))).toBeFalse();
    expect(keys.some((k) => k.includes("flamel"))).toBeFalse();

    expect(handles.some((h) => h.includes("john dee") || h === "dee")).toBeFalse();
    expect(keys.some((k) => k.includes("john-dee") || k === "dee")).toBeFalse();
  });

  test("every planetary faction (0..9) has assigned historical agents", () => {
    for (let f = 0; f < 10; f++) {
      const roster = getAgentsByFaction(f);
      expect(roster.length).toBeGreaterThan(0);
      for (const agent of roster) {
        expect(agent.faction).toBe(f);
        expect(agent.factionName).toBe(PLANET_NAMES[f]);
        expect(agent.kitchenUrl).toContain("agents.alchm.kitchen/profile?agent=");
        expect(agent.kitchenUrl).toContain(`faction=${f}`);
      }
    }
  });

  test("every faction champion is a verified historical agent belonging to that faction", () => {
    const champions = getFactionChampions();
    expect(champions.length).toBe(10);

    for (let f = 0; f < 10; f++) {
      const champ = getFactionChampion(f);
      expect(champ).not.toBeNull();
      expect(champ.faction).toBe(f);
      expect(champ.handle.length).toBeGreaterThan(0);
      expect(champ.title.length).toBeGreaterThan(0);
      expect(champ.tactic.length).toBeGreaterThan(0);
      expect(champ.identity).toMatch(/^0xagent_/);
    }

    // Verify key champions
    expect(getFactionChampion(0).handle).toBe("Plato");
    expect(getFactionChampion(1).handle).toBe("Albert Einstein");
    expect(getFactionChampion(2).handle).toBe("Socrates");
    expect(getFactionChampion(3).handle).toBe("Nikola Tesla");
    expect(getFactionChampion(4).handle).toBe("Aristotle");
    expect(getFactionChampion(5).handle).toBe("Chiron");
    expect(getFactionChampion(6).handle).toBe("Alexander the Great");
    expect(getFactionChampion(7).handle).toBe("Confucius - Kong Qiu");
    expect(getFactionChampion(8).handle).toBe("Tecumseh");
    expect(getFactionChampion(9).handle).toBe("Leonardo da Vinci");
  });

  test("pickContenders returns real historical agents from competing factions", () => {
    for (let zoneId = 0; zoneId < 11; zoneId++) {
      for (let myF = 0; myF < 10; myF++) {
        const contenders = pickContenders(zoneId, myF, 3);
        expect(contenders.length).toBe(3);

        // Never includes player's faction
        expect(contenders.some((c) => c.faction === myF)).toBeFalse();

        // Every contender is a valid agent
        for (const c of contenders) {
          expect(c.handle).toBeTruthy();
          expect(c.kitchenUrl).toContain("agents.alchm.kitchen/profile");
          expect(c.identity).toMatch(/^0xagent_/);
          expect(c.faction).toBeGreaterThanOrEqual(0);
          expect(c.faction).toBeLessThan(10);
        }
      }
    }
  });

  test("lookup by key and handle correctly resolves canonical agents", () => {
    const socrates = getAgentByKey("socrates");
    expect(socrates).not.toBeNull();
    expect(socrates.handle).toBe("Socrates");
    expect(socrates.faction).toBe(2);

    const einstein = getAgentByHandle("albert einstein");
    expect(einstein).not.toBeNull();
    expect(einstein.key).toBe("albert-einstein");
    expect(einstein.faction).toBe(1);

    const nonExistent = getAgentByKey("hypatia");
    expect(nonExistent).toBeNull();
  });

  test("global bridge is exposed for classic scripts", () => {
    const g = (globalThis as any).AlchmHistoricalAgents;
    expect(g).toBeDefined();
    expect(typeof g.getFactionChampions).toBe("function");
    expect(typeof g.pickContenders).toBe("function");
    expect(g.HISTORICAL_AGENTS.length).toBe(71);
  });
});
