// ============================================================================
// Pentacles — Planetary Faction Dossier & Lore Pages Test Suite
// ============================================================================
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load public/faction-page.js in a mock browser environment
const scriptPath = resolve(process.cwd(), "public/faction-page.js");
const scriptCode = readFileSync(scriptPath, "utf-8");

const mockWindow = {
  state: {
    leaderboard: [
      { id: 8, score: 1531 }, // #1 Neptune
      { id: 6, score: 1481 }, // #2 Saturn
      { id: 1, score: 935 },  // #3 Moon
      { id: 2, score: 895 },  // #4 Mercury
      { id: 7, score: 620 },  // #5 Uranus
      { id: 3, score: 560 },  // #6 Venus
      { id: 9, score: 325 },  // #7 Pluto
      { id: 4, score: 310 },  // #8 Mars
      { id: 0, score: 245 },  // #9 Sun
      { id: 5, score: 140 }   // #10 Jupiter
    ],
    decanVictories: { 8: 1, 6: 2 },
    map: [
      { zone_id: 0, kind: "house", owner: 4, control: 350 },
      { zone_id: 1, kind: "house", owner: 3, control: 400 },
      { zone_id: 2, kind: "house", owner: 2, control: 280 },
      { zone_id: 3, kind: "house", owner: 1, control: 500 },
      { zone_id: 4, kind: "house", owner: 0, control: 620 },
      { zone_id: 5, kind: "spire", owner: 6, control: 150 },
      { zone_id: 6, kind: "spire", owner: 8, control: 800 }
    ],
    getCurrentDecan: () => ({
      absDecan: 19,
      card: "3 of Swords",
      rank: 3,
      suit: "Swords",
      signName: "Libra",
      signGlyph: "♎",
      rulerFaction: 6, // Saturn
      rulerName: "Saturn",
      rulerGlyph: "♄",
      startDeg: 10,
      endDeg: 20,
      degInDecan: 3.5,
      progressPct: 35.1
    }),
    player: {
      handle: "AstralSeeker",
      faction: 6 // Saturn
    }
  },
  document: {
    getElementById: (id) => {
      if (!mockElements[id]) {
        mockElements[id] = {
          id,
          style: {},
          setAttribute: () => {},
          getAttribute: () => null,
          classList: {
            add: () => {},
            remove: () => {}
          },
          innerHTML: "",
          querySelectorAll: () => []
        };
      }
      return mockElements[id];
    },
    createElement: (tag) => {
      const el = {
        tagName: tag,
        style: {},
        setAttribute: () => {},
        getAttribute: () => null,
        classList: {
          add: () => {},
          remove: () => {}
        },
        innerHTML: "",
        querySelectorAll: () => []
      };
      return el;
    },
    body: {
      classList: {
        add: () => {},
        remove: () => {}
      },
      appendChild: (el) => {
        if (el.id) mockElements[el.id] = el;
      }
    },
    addEventListener: () => {},
    removeEventListener: () => {}
  }
};

const mockElements = {};

// Execute script in mock context
const fn = new Function("window", "document", "globalThis", scriptCode);
fn(mockWindow, mockWindow.document, mockWindow);

const FACTIONS = mockWindow.FACTIONS_DATA;

test("1 · All 10 Planetary Factions are registered with complete profiles", () => {
  expect(Array.isArray(FACTIONS)).toBe(true);
  expect(FACTIONS.length).toBe(10);

  const EXPECTED_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
  const EXPECTED_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];

  FACTIONS.forEach((f, idx) => {
    expect(f.id).toBe(idx);
    expect(f.name).toBe(EXPECTED_NAMES[idx]);
    expect(f.glyph).toBe(EXPECTED_GLYPHS[idx]);
    expect(typeof f.factionName).toBe("string");
    expect(f.factionName.length).toBeGreaterThan(0);
    expect(typeof f.epithet).toBe("string");
    expect(typeof f.motto).toBe("string");
    expect(typeof f.hermeticPrinciple).toBe("string");
    expect(typeof f.archetype).toBe("string");
    expect(typeof f.warDoctrine).toBe("string");
  });
});

test("2 · Astrological and astronomical attributes are complete and valid", () => {
  FACTIONS.forEach((f) => {
    const a = f.astrology;
    expect(a).toBeDefined();
    expect(typeof a.domicile).toBe("string");
    expect(typeof a.exaltation).toBe("string");
    expect(typeof a.detriment).toBe("string");
    expect(typeof a.fall).toBe("string");
    expect(typeof a.triplicity).toBe("string");
    expect(typeof a.metal).toBe("string");
    expect(typeof a.day).toBe("string");

    const s = f.astronomy;
    expect(s).toBeDefined();
    expect(typeof s.classification).toBe("string");
    expect(typeof s.distance).toBe("string");
    expect(typeof s.orbitalPeriod).toBe("string");
    expect(typeof s.radius).toBe("string");
    expect(typeof s.fact).toBe("string");
  });
});

test("3 · Tarot associations include Major Arcana and Minor Arcana Decan cards", () => {
  FACTIONS.forEach((f) => {
    const t = f.tarot;
    expect(t).toBeDefined();
    expect(t.major).toBeDefined();
    expect(typeof t.major.name).toBe("string");
    expect(typeof t.major.number).toBe("string");
    expect(typeof t.major.archetype).toBe("string");
    expect(typeof t.major.gameEffect).toBe("string");

    expect(Array.isArray(t.decans)).toBe(true);
    expect(t.decans.length).toBeGreaterThan(0);

    t.decans.forEach((d) => {
      expect(typeof d.card).toBe("string");
      expect(typeof d.degrees).toBe("string");
      expect(typeof d.sign).toBe("string");
      expect(typeof d.suit).toBe("string");
      expect(typeof d.meaning).toBe("string");
    });
  });

  // Verify Saturn owns 3 of Swords (from user screenshot active decan)
  const saturn = FACTIONS[6];
  expect(saturn.name).toBe("Saturn");
  expect(saturn.tarot.major.name).toBe("The World");
  expect(saturn.tarot.decans.some((d) => d.card === "3 of Swords")).toBe(true);
});

test("4 · Historical Agent roster is populated across factions", () => {
  let totalAgents = 0;
  FACTIONS.forEach((f) => {
    expect(Array.isArray(f.agents)).toBe(true);
    expect(f.agents.length).toBeGreaterThanOrEqual(3);
    totalAgents += f.agents.length;

    f.agents.forEach((ag) => {
      expect(typeof ag.handle).toBe("string");
      expect(ag.handle.length).toBeGreaterThan(0);
      expect(typeof ag.year).toBe("string");
      expect(typeof ag.role).toBe("string");
      expect(typeof ag.trait).toBe("string");
      expect(typeof ag.note).toBe("string");
    });
  });

  expect(totalAgents).toBeGreaterThanOrEqual(50);

  // Check specific historical figure assignments
  const saturnAgents = FACTIONS[6].agents.map((a) => a.handle);
  expect(saturnAgents).toContain("Isaac Newton");
  expect(saturnAgents).toContain("Joan of Arc");
  expect(saturnAgents).toContain("Benjamin Franklin");

  const sunAgents = FACTIONS[0].agents.map((a) => a.handle);
  expect(sunAgents).toContain("Plato");
  expect(sunAgents).toContain("Immanuel Kant");
  expect(sunAgents).toContain("Carl Jung");

  const moonAgents = FACTIONS[1].agents.map((a) => a.handle);
  expect(moonAgents).toContain("Albert Einstein");
  expect(moonAgents).toContain("Michelangelo Buonarroti");

  const mercuryAgents = FACTIONS[2].agents.map((a) => a.handle);
  expect(mercuryAgents).toContain("William Shakespeare");
  expect(mercuryAgents).toContain("Hypatia of Alexandria");

  const plutoAgents = FACTIONS[9].agents.map((a) => a.handle);
  expect(plutoAgents).toContain("Leonardo da Vinci");
  expect(plutoAgents).toContain("Fyodor Dostoevsky");
});

test("5 · openFactionPage mounts and renders HTML properly", () => {
  mockWindow.openFactionPage(6); // Open Saturn

  const ov = mockElements["faction-page-overlay"];
  expect(ov).toBeDefined();
  expect(ov.style.display).toBe("flex");
  expect(ov.innerHTML).toContain("Saturnine Citadel");
  expect(ov.innerHTML).toContain("Keepers of the Great Threshold");
  expect(ov.innerHTML).toContain("War Table Archetype: Endurance");

  // Tab switching: tarot
  mockWindow.setFactionTab("tarot");
  expect(ov.innerHTML).toContain("3 of Swords");
  expect(ov.innerHTML).toContain("The World");
  expect(ov.innerHTML).toContain("XXI");

  // Tab switching: planet
  mockWindow.setFactionTab("planet");
  expect(ov.innerHTML).toContain("Essential Dignities");
  expect(ov.innerHTML).toContain("Astronomical Profile");

  // Tab switching: agents
  mockWindow.setFactionTab("agents");
  expect(ov.innerHTML).toContain("Isaac Newton");

  // Switching faction
  mockWindow.switchFactionPage(0); // Switch to Sun
  expect(ov.innerHTML).toContain("Solar Dominion");
  expect(ov.innerHTML).toContain("The Sovereign Illuminators");

  // Closing
  mockWindow.closeFactionPage();
  expect(ov.style.display).toBe("none");
});
