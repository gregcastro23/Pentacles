/* ============================================================
   Agent deck — on-the-fly Tarot deck from a natal chart
   ============================================================
   DOM-free, testable. Mirrors the server's `mint_deck` (server/src/chart.rs)
   so the 20 cards shown for a seeded agent match what was minted on-chain:
   each placement yields a MINOR (its decan pip — or the Ace for the chart ruler,
   or a court for angular / sign-ruling bodies) and a MAJOR (the planet's Major Arcana).

   Planet indices: Sun 0 · Moon 1 · Mercury 2 · Venus 3 · Mars 4 · Jupiter 5 ·
   Saturn 6 · Uranus 7 · Neptune 8 · Pluto 9.
   ============================================================ */
import { decanCard } from "./decans.js";

// Planet → Major Arcana (matches public/client.js MAJOR_* and server planet_major).
export const MAJOR_NAMES = ["The Sun", "The High Priestess", "The Magician", "The Empress", "The Tower", "Wheel of Fortune", "The World", "The Fool", "The Hanged Man", "Judgement"];
export const MAJOR_NUMERALS = ["XIX", "II", "I", "III", "XVI", "X", "XXI", "0", "XII", "XX"];

// 22 Major Arcana (Arcana Index 0..21)
export const ARCANA_NAMES = [
  "The Fool", "The Magician", "The High Priestess", "The Empress", "The Emperor",
  "The Hierophant", "The Lovers", "The Chariot", "Strength", "The Hermit",
  "Wheel of Fortune", "Justice", "The Hanged Man", "Death", "Temperance",
  "The Devil", "The Tower", "The Star", "The Moon", "The Sun",
  "Judgement", "The World"
];
export const ARCANA_NUMERALS = [
  "0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX",
  "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX",
  "XX", "XXI"
];

// Planet → its biased Major suit (server Planet::biased_suit).
const BIASED_SUIT = ["Wands", "Cups", "Swords", "Cups", "Wands", "Wands", "Pentacles", "Swords", "Cups", "Swords"];
// Sign → ruling planet idx (server sign_ruler).
const SIGN_RULER = [4, 3, 2, 1, 0, 2, 3, 9, 5, 6, 7, 8];

export const SUIT_GLYPHS = { Wands: "♣", Cups: "♥", Swords: "♠", Pentacles: "♦", wands: "♣", cups: "♥", swords: "♠", pentacles: "♦" };
export const SUIT_COLORS = { Wands: "#db7a47", Cups: "#5f93d8", Swords: "#aebbd6", Pentacles: "#74ab6c", wands: "#db7a47", cups: "#5f93d8", swords: "#aebbd6", pentacles: "#74ab6c" };
const RANK_LABEL = { 1: "Ace", 11: "Page", 12: "Knight", 13: "Queen", 14: "King" };
export const rankName = (r) => RANK_LABEL[r] || String(r);

const circDist = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 21600 - d); };
const courtForDignity = (d) => (d >= 5 ? 14 : d >= 3 ? 13 : d >= 1 ? 12 : 11);

/** Reception boosts (mirror server calculate_reception_boosts): a planet outside
 *  its own domicile is received (+0.5); a mutual-reception pair gets +1.5 each. */
function receptionBoosts(placements) {
  const b = Array(10).fill(0);
  for (const p of placements) if (SIGN_RULER[p.sign] !== p.body) b[p.body] += 0.5;
  for (let i = 0; i < placements.length; i++)
    for (let j = i + 1; j < placements.length; j++)
      if (SIGN_RULER[placements[i].sign] === placements[j].body && SIGN_RULER[placements[j].sign] === placements[i].body) {
        b[placements[i].body] += 1.5; b[placements[j].body] += 1.5;
      }
  return b;
}

// Sign → Sign Major Arcana index (0..21)
const SIGN_MAJOR = [4, 5, 6, 7, 8, 9, 11, 13, 14, 15, 17, 18];
const SIGN_ELEMENT_SUIT = ["Wands", "Pentacles", "Swords", "Cups", "Wands", "Pentacles", "Swords", "Cups", "Wands", "Pentacles", "Swords", "Cups"];

/**
 * The 25+ card deck (10 planetary minors + 10 planetary majors + 2 lunar node minors + 2 lunar node majors + sign majors) for a chart.
 * @param placements [{body:idx, sign:0-11, arcMin:0-1799, retrograde, dignity}]
 * @param ascMin  ascendant in absolute arc-minutes (0-21599)
 * @param mcMin   midheaven  in absolute arc-minutes
 * @param northNode {sign:0-11, arcMin:0-1799} (optional)
 * @returns [{kind, body, suit, rank, name, glyph, color, retro, ... decan info}]
 */
export function agentDeck(placements, ascMin = 0, mcMin = 0, northNode = null) {
  const ascSign = ((Math.floor(ascMin / 1800) % 12) + 12) % 12;
  const rulerBody = SIGN_RULER[ascSign];
  const rb = receptionBoosts(placements);
  const cards = [];

  // 1. 10 Planetary Minors + 10 Planetary Majors
  for (const p of placements) {
    const dc = decanCard(p.sign, p.arcMin / 60); // {rank(pip 2-10), suit, title, ruler, range, esms}
    const absMin = p.sign * 1800 + p.arcMin;
    const angular = circDist(absMin, ascMin) < 600 || circDist(absMin, mcMin) < 600;
    const eff = p.dignity + rb[p.body] * 2;

    let rank, role;
    if (p.body === rulerBody) { rank = 1; role = "chart ruler"; }
    else if (angular || SIGN_RULER[p.sign] === p.body) { rank = courtForDignity(eff); role = angular ? "angular" : "sign ruler"; }
    else { rank = dc.rank; role = "decan pip"; }

    cards.push({
      kind: "minor", body: p.body, suit: dc.suit, rank,
      name: `${rankName(rank)} of ${dc.suit}`,
      glyph: SUIT_GLYPHS[dc.suit], color: SUIT_COLORS[dc.suit],
      retro: !!p.retrograde, role, sign: p.sign, deg: p.arcMin / 60,
      decan: dc.range, decanRuler: dc.ruler, lord: dc.title, esms: dc.esms,
      attack: 10 + (p.dignity || 0) * 2, health: 20 + (p.dignity || 0) * 3, armour: 2, level: 1
    });
    cards.push({
      kind: "major", body: p.body, suit: BIASED_SUIT[p.body], rank: MAJOR_NUMERALS[p.body],
      name: MAJOR_NAMES[p.body], glyph: SUIT_GLYPHS[BIASED_SUIT[p.body]], color: SUIT_COLORS[BIASED_SUIT[p.body]],
      major: true, retro: !!p.retrograde,
      attack: 15 + (p.dignity || 0) * 3, health: 30 + (p.dignity || 0) * 4, armour: 4, level: 1
    });
  }

  // 2. Lunar Nodes (North Node ☊ and South Node ☋)
  const moon = placements.find((p) => Number(p.body) === 1);
  const nNodeSign = northNode ? Number(northNode.sign) : (moon ? (Number(moon.sign) + 3) % 12 : 0);
  const nNodeArcMin = northNode ? Number(northNode.arcMin || northNode.arc_minutes || 900) : (moon ? Number(moon.arcMin || 900) : 900);
  const sNodeSign = (nNodeSign + 6) % 12;

  // North Node Minor (Destiny Decan)
  const nndc = decanCard(nNodeSign, nNodeArcMin / 60);
  cards.push({
    kind: "minor", body: 1, suit: nndc.suit, rank: nndc.rank,
    name: `☊ North Node · ${rankName(nndc.rank)} of ${nndc.suit}`,
    glyph: "☊", color: "var(--ac-gold-bright)",
    retro: false, role: "north node", node: "north", sign: nNodeSign, deg: nNodeArcMin / 60,
    decan: nndc.range, decanRuler: nndc.ruler, lord: nndc.title, esms: nndc.esms,
    attack: 14, health: 26, armour: 3, level: 1
  });

  // North Node Major (Destiny Arcana: The Star XVII)
  cards.push({
    kind: "major", body: 1, suit: "Cups", rank: "XVII",
    name: "The Star · Caput Draconis (☊)", glyph: "☊", color: "var(--ac-gold-bright)",
    major: true, retro: false, role: "destiny major", node: "north",
    attack: 18, health: 36, armour: 5, level: 1
  });

  // South Node Minor (Karmic Decan)
  const sndc = decanCard(sNodeSign, nNodeArcMin / 60);
  cards.push({
    kind: "minor", body: 1, suit: sndc.suit, rank: sndc.rank,
    name: `☋ South Node · ${rankName(sndc.rank)} of ${sndc.suit}`,
    glyph: "☋", color: "#aebbd6",
    retro: false, role: "south node", node: "south", sign: sNodeSign, deg: nNodeArcMin / 60,
    decan: sndc.range, decanRuler: sndc.ruler, lord: sndc.title, esms: sndc.esms,
    attack: 12, health: 24, armour: 3, level: 1
  });

  // South Node Major (Karma Arcana: The Moon XVIII)
  cards.push({
    kind: "major", body: 1, suit: "Cups", rank: "XVIII",
    name: "The Moon · Cauda Draconis (☋)", glyph: "☋", color: "#aebbd6",
    major: true, retro: false, role: "karma major", node: "south",
    attack: 16, health: 34, armour: 4, level: 1
  });

  // 3. Occupied Sign Majors (Ensuring >= 25 cards total)
  const occupiedSigns = [...new Set(placements.map((p) => p.sign % 12))];
  if (!occupiedSigns.includes(ascSign)) occupiedSigns.push(ascSign);

  for (const s of occupiedSigns) {
    if (cards.length >= 28) break;
    const arcanaIdx = SIGN_MAJOR[s];
    const suit = SIGN_ELEMENT_SUIT[s];
    const ruler = SIGN_RULER[s];
    cards.push({
      kind: "major", body: ruler, suit, rank: ARCANA_NUMERALS[arcanaIdx] || "major",
      name: `${ARCANA_NAMES[arcanaIdx]} (${SIGN_GLYPHS[s] || "✦"})`,
      glyph: SUIT_GLYPHS[suit], color: SUIT_COLORS[suit],
      major: true, retro: false, role: "sign major", sign: s,
      attack: 16, health: 32, armour: 4, level: 1
    });
  }

  return cards;
}

const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];

export default { agentDeck, MAJOR_NAMES, MAJOR_NUMERALS, ARCANA_NAMES, ARCANA_NUMERALS, SUIT_GLYPHS, SUIT_COLORS, rankName };
