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

export const SUIT_GLYPHS = { Wands: "🜂", Cups: "🜄", Swords: "🜁", Pentacles: "🜃", wands: "🜂", cups: "🜄", swords: "🜁", pentacles: "🜃" };
export const SUIT_GLYPH_NAMES = { Wands: "Fire", Cups: "Water", Swords: "Air", Pentacles: "Earth", wands: "Fire", cups: "Water", swords: "Air", pentacles: "Earth" };
export const SUIT_COLORS = { Wands: "#db7a47", Cups: "#5f93d8", Swords: "#aebbd6", Pentacles: "#74ab6c", wands: "#db7a47", cups: "#5f93d8", swords: "#aebbd6", pentacles: "#74ab6c" };

export const SUIT_ART = {
  Swords: "/assets/suits/swords.jpg",
  Pentacles: "/assets/suits/pentacles.jpg",
  Cups: "/assets/suits/cups.jpg",
  Wands: "/assets/suits/wands.jpg",
  swords: "/assets/suits/swords.jpg",
  pentacles: "/assets/suits/pentacles.jpg",
  cups: "/assets/suits/cups.jpg",
  wands: "/assets/suits/wands.jpg"
};

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

/**
 * Deal exactly 12 cards from a pool of cards (or generate baseline cards if empty/short),
 * enforcing Pinochle/Pentacles rule: at most 3 Majors + 9 Minors.
 */
export function dealHandFromCards(sourceCards = [], seed = 12345) {
  let rngVal = (seed ^ 0x9e3779b9) >>> 0;
  const rng = () => {
    rngVal = (rngVal + 0x6d2b79f5) >>> 0;
    let t = Math.imul(rngVal ^ (rngVal >>> 15), 1 | rngVal);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const shuffle = (xs) => {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  let pool = Array.isArray(sourceCards) && sourceCards.length ? sourceCards.slice() : [];

  if (pool.length < 12) {
    const baseline = [];
    const suits = ["wands", "pentacles", "swords", "cups"];
    for (let s = 0; s < 4; s++) {
      for (let r = 1; r <= 14; r++) {
        baseline.push({
          card_id: 10000 + s * 100 + r,
          suit: suits[s],
          rank: r,
          is_major: false,
          isMajor: false,
          title: `${rankName(r)} of ${suits[s].charAt(0).toUpperCase() + suits[s].slice(1)}`,
          attack: 8 + (r === 1 ? 14 : r),
        });
      }
    }
    for (let m = 0; m < 22; m++) {
      baseline.push({
        card_id: 20000 + m,
        suit: suits[m % 4],
        rank: m,
        is_major: true,
        isMajor: true,
        title: ARCANA_NAMES[m] || `Major ${m}`,
        attack: 16 + (m % 5),
      });
    }
    pool = [...pool, ...baseline];
  }

  const normalized = pool.map((c, idx) => {
    const isMajor = !!(c.is_major || c.isMajor || c.major || c.kind === "major");
    let rank = c.rank;
    if (isMajor) {
      if (typeof rank === "string") {
        const romanIdx = ARCANA_NUMERALS.indexOf(rank);
        if (romanIdx >= 0) rank = romanIdx;
        else {
          const majorRomanIdx = MAJOR_NUMERALS.indexOf(rank);
          if (majorRomanIdx >= 0) {
            const bodyMajor = [19, 2, 1, 3, 16, 10, 21, 0, 12, 20][majorRomanIdx];
            rank = bodyMajor !== undefined ? bodyMajor : 0;
          } else {
            rank = Number(rank) || 0;
          }
        }
      } else {
        rank = Number(rank) || 0;
      }
    } else {
      rank = Number(rank) || (c.rank === "Ace" ? 1 : 10);
    }

    const rawSuit = String(c.suit || "wands").toLowerCase();
    const suit = rawSuit === "coins" ? "pentacles" : (rawSuit === "batons" ? "wands" : rawSuit);

    return {
      card_id: Number(c.card_id || c.cardId || (30000 + idx)),
      title: c.title || c.name || (isMajor ? (ARCANA_NAMES[rank] || "Major Arcana") : `${rankName(rank)} of ${suit}`),
      suit,
      rank,
      is_major: isMajor,
      isMajor: isMajor,
      attack: Number(c.attack || (isMajor ? 16 : 10)),
      played: false,
    };
  });

  const majors = shuffle(normalized.filter((c) => c.is_major)).slice(0, 3);
  const minors = shuffle(normalized.filter((c) => !c.is_major));
  const hand = [...majors, ...minors].slice(0, 12);

  while (hand.length < 12) {
    const r = (hand.length % 14) + 1;
    const s = ["wands", "pentacles", "swords", "cups"][hand.length % 4];
    hand.push({
      card_id: 40000 + hand.length,
      title: `${rankName(r)} of ${s}`,
      suit: s,
      rank: r,
      is_major: false,
      isMajor: false,
      attack: 10 + r,
      played: false,
    });
  }

  return hand;
}

const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];

export default { agentDeck, dealHandFromCards, MAJOR_NAMES, MAJOR_NUMERALS, ARCANA_NAMES, ARCANA_NUMERALS, SUIT_GLYPHS, SUIT_COLORS, SUIT_ART, rankName };
