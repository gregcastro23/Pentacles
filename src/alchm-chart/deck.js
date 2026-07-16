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
// Planet → its biased Major suit (server Planet::biased_suit).
const BIASED_SUIT = ["Wands", "Cups", "Swords", "Cups", "Wands", "Wands", "Pentacles", "Swords", "Cups", "Swords"];
// Sign → ruling planet idx (server sign_ruler).
const SIGN_RULER = [4, 3, 2, 1, 0, 2, 3, 9, 5, 6, 7, 8];

export const SUIT_GLYPHS = { Wands: "♣", Cups: "♥", Swords: "♠", Pentacles: "♦" };
export const SUIT_COLORS = { Wands: "#db7a47", Cups: "#5f93d8", Swords: "#aebbd6", Pentacles: "#74ab6c" };
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

/**
 * The 20-card deck (10 minor + 10 major) for a chart.
 * @param placements [{body:idx, sign:0-11, arcMin:0-1799, retrograde, dignity}]
 * @param ascMin  ascendant in absolute arc-minutes (0-21599)
 * @param mcMin   midheaven  in absolute arc-minutes
 * @returns [{kind, body, suit, rank, name, glyph, color, retro, ... decan info}]
 */
export function agentDeck(placements, ascMin = 0, mcMin = 0) {
  const rulerBody = SIGN_RULER[((Math.floor(ascMin / 1800) % 12) + 12) % 12];
  const rb = receptionBoosts(placements);
  const cards = [];
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
    });
    cards.push({
      kind: "major", body: p.body, suit: BIASED_SUIT[p.body], rank: MAJOR_NUMERALS[p.body],
      name: MAJOR_NAMES[p.body], glyph: SUIT_GLYPHS[BIASED_SUIT[p.body]], color: SUIT_COLORS[BIASED_SUIT[p.body]],
      major: true, retro: !!p.retrograde,
    });
  }
  return cards;
}

export default { agentDeck, MAJOR_NAMES, MAJOR_NUMERALS, SUIT_GLYPHS, SUIT_COLORS, rankName };
