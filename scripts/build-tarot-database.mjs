/* ============================================================
   Build Tarot Database — Canonical Alchm Sacred 7 Derivation
   ============================================================
   Generates all 78 discrete card JSON files in data/cards/ and
   compiles the unified registry at src/cards/index.js.

   Derives Sacred 7 stats (power, resonance, wisdom, charisma,
   intuition, adaptability, vitality) via the canonical Alchm
   ESMS-to-Sacred-7 matrix, planetary alchemy 4-vectors,
   essential dignity, and global affine normalization to [20, 95].
   ============================================================ */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CARDS_DIR = path.join(ROOT, "data", "cards");
const SRC_CARDS_DIR = path.join(ROOT, "src", "cards");

// Ensure directories exist
const dirs = [
  path.join(CARDS_DIR, "major"),
  path.join(CARDS_DIR, "minor", "wands"),
  path.join(CARDS_DIR, "minor", "cups"),
  path.join(CARDS_DIR, "minor", "swords"),
  path.join(CARDS_DIR, "minor", "pentacles"),
  SRC_CARDS_DIR
];

for (const dir of dirs) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── 1. Canonical Planetary Alchemy 4-Vectors ────────────────────────────────
// Authoritative mapping from AlchmAgentsSolana/lib/alchm-fbd/planetaryAlchemyMapping.ts
export const PLANETARY_ALCHEMY = {
  Sun:     { Spirit: 1, Essence: 0, Matter: 0, Substance: 0 },
  Moon:    { Spirit: 0, Essence: 1, Matter: 1, Substance: 0 },
  Mercury: { Spirit: 1, Essence: 0, Matter: 0, Substance: 1 },
  Venus:   { Spirit: 0, Essence: 1, Matter: 1, Substance: 0 },
  Mars:    { Spirit: 0, Essence: 1, Matter: 1, Substance: 0 },
  Jupiter: { Spirit: 1, Essence: 1, Matter: 0, Substance: 0 },
  Saturn:  { Spirit: 1, Essence: 0, Matter: 1, Substance: 0 },
  Uranus:  { Spirit: 0, Essence: 1, Matter: 1, Substance: 0 },
  Neptune: { Spirit: 0, Essence: 1, Matter: 0, Substance: 1 },
  Pluto:   { Spirit: 0, Essence: 1, Matter: 1, Substance: 0 }
};

const PLANET_INDICES = {
  Sun: 0, Moon: 1, Mercury: 2, Venus: 3, Mars: 4,
  Jupiter: 5, Saturn: 6, Uranus: 7, Neptune: 8, Pluto: 9
};

const SIGN_NAMES = [
  "Aries", "Taurus", "Gemini", "Cancer",
  "Leo", "Virgo", "Libra", "Scorpio",
  "Sagittarius", "Capricorn", "Aquarius", "Pisces"
];

const SIGN_ELEMENT_VECTORS = {
  Aries:       { Spirit: 1, Essence: 0, Matter: 0, Substance: 0 },
  Taurus:      { Spirit: 0, Essence: 0, Matter: 1, Substance: 0 },
  Gemini:      { Spirit: 0, Essence: 0, Matter: 0, Substance: 1 },
  Cancer:      { Spirit: 0, Essence: 1, Matter: 0, Substance: 0 },
  Leo:         { Spirit: 1, Essence: 0, Matter: 0, Substance: 0 },
  Virgo:       { Spirit: 0, Essence: 0, Matter: 1, Substance: 0 },
  Libra:       { Spirit: 0, Essence: 0, Matter: 0, Substance: 1 },
  Scorpio:     { Spirit: 0, Essence: 1, Matter: 0, Substance: 0 },
  Sagittarius: { Spirit: 1, Essence: 0, Matter: 0, Substance: 0 },
  Capricorn:   { Spirit: 0, Essence: 0, Matter: 1, Substance: 0 },
  Aquarius:    { Spirit: 0, Essence: 0, Matter: 0, Substance: 1 },
  Pisces:      { Spirit: 0, Essence: 1, Matter: 0, Substance: 0 }
};

const SIGN_MODALITY = {
  Aries: "cardinal", Taurus: "fixed", Gemini: "mutable",
  Cancer: "cardinal", Leo: "fixed", Virgo: "mutable",
  Libra: "cardinal", Scorpio: "fixed", Sagittarius: "mutable",
  Capricorn: "cardinal", Aquarius: "fixed", Pisces: "mutable"
};

// ── 2. Essential Dignity Calculation in Host Sign ───────────────────────────
// Rulerships, exaltations, detriments, falls for all 10 bodies
const DIGNITY_RULES = {
  Sun:     { domicile: [4], exaltation: [0], detriment: [10], fall: [6] },
  Moon:    { domicile: [3], exaltation: [1], detriment: [9], fall: [7] },
  Mercury: { domicile: [2, 5], exaltation: [5], detriment: [8, 11], fall: [11] },
  Venus:   { domicile: [1, 6], exaltation: [11], detriment: [0, 7], fall: [5] },
  Mars:    { domicile: [0, 7], exaltation: [9], detriment: [1, 6], fall: [3] },
  Jupiter: { domicile: [8, 11], exaltation: [3], detriment: [2, 5], fall: [9] },
  Saturn:  { domicile: [9, 10], exaltation: [6], detriment: [3, 4], fall: [0] },
  Uranus:  { domicile: [10], exaltation: [7], detriment: [4], fall: [1] },
  Neptune: { domicile: [11], exaltation: [3], detriment: [5], fall: [9] },
  Pluto:   { domicile: [7], exaltation: [0], detriment: [1], fall: [6] }
};

function getDignityMultiplier(planet, signIdx) {
  const rules = DIGNITY_RULES[planet];
  if (!rules) return 1.0;
  if (rules.exaltation.includes(signIdx)) return 1.35;
  if (rules.domicile.includes(signIdx)) return 1.25;
  if (rules.fall.includes(signIdx)) return 0.70;
  if (rules.detriment.includes(signIdx)) return 0.80;
  return 1.00; // Peregrine
}

// ── 3. Canonical ESMS → Sacred 7 Weight Matrix ──────────────────────────────
// From AlchmAgentsSolana/lib/agents/sacred-stats.ts:47
function esmsToSacred7(esms) {
  const S = esms.Spirit || 0;
  const E = esms.Essence || 0;
  const M = esms.Matter || 0;
  const Sub = esms.Substance || 0;

  return {
    power:        5 * S + 3 * M,
    resonance:    6 * E + 4 * S,
    wisdom:       5 * Sub + 3 * E,
    charisma:     5 * S + 4 * E,
    intuition:    7 * E + 3 * Sub,
    adaptability: 6 * Sub + 2 * S,
    vitality:     6 * M + 4 * S
  };
}

// ── 4. Planetary-12 Semantic Archetype Tiebreakers ─────────────────────────
// Resolves { Essence: 1, Matter: 1 } degeneracy using SACRED_STATS_METADATA axes
const PLANET_ARCHETYPE_BIAS = {
  Sun:     { power: 2.5, charisma: 3.5, vitality: 3.5 },
  Moon:    { resonance: 2.5, intuition: 3.5 },
  Mercury: { adaptability: 3.5, wisdom: 2.5 },
  Venus:   { charisma: 3.5, resonance: 2.5 },
  Mars:    { power: 3.5, vitality: 2.5 },
  Jupiter: { wisdom: 3.0, charisma: 2.5, power: 1.5 },
  Saturn:  { wisdom: 3.5, vitality: 2.5, adaptability: -1.5 },
  Uranus:  { adaptability: 4.0, intuition: 2.0 },
  Neptune: { intuition: 3.5, resonance: 3.0 },
  Pluto:   { power: 3.0, wisdom: 2.5 }
};

// ── 5. Triplicity Decans (Drekkana) Table ───────────────────────────────────
// Matches the user's uploaded spec sheets and planet associations exactly
const TRIPLICITY_DECANS = {
  wands: [
    // Aries: Fire
    { sign: "Aries", decan: 0, triplicitySign: "Aries", rulers: ["Mars"], degRange: [0, 10] },
    { sign: "Aries", decan: 1, triplicitySign: "Leo", rulers: ["Sun"], degRange: [10, 20] },
    { sign: "Aries", decan: 2, triplicitySign: "Sagittarius", rulers: ["Jupiter"], degRange: [20, 30] },
    // Leo: Fire
    { sign: "Leo", decan: 0, triplicitySign: "Leo", rulers: ["Sun"], degRange: [0, 10] },
    { sign: "Leo", decan: 1, triplicitySign: "Sagittarius", rulers: ["Jupiter"], degRange: [10, 20] },
    { sign: "Leo", decan: 2, triplicitySign: "Aries", rulers: ["Mars"], degRange: [20, 30] },
    // Sagittarius: Fire
    { sign: "Sagittarius", decan: 0, triplicitySign: "Sagittarius", rulers: ["Jupiter"], degRange: [0, 10] },
    { sign: "Sagittarius", decan: 1, triplicitySign: "Aries", rulers: ["Mars"], degRange: [10, 20] },
    { sign: "Sagittarius", decan: 2, triplicitySign: "Leo", rulers: ["Sun"], degRange: [20, 30] }
  ],
  cups: [
    // Cancer: Water
    { sign: "Cancer", decan: 0, triplicitySign: "Cancer", rulers: ["Moon"], degRange: [0, 10] },
    { sign: "Cancer", decan: 1, triplicitySign: "Scorpio", rulers: ["Mars", "Pluto"], degRange: [10, 20] },
    { sign: "Cancer", decan: 2, triplicitySign: "Pisces", rulers: ["Jupiter", "Neptune"], degRange: [20, 30] },
    // Scorpio: Water
    { sign: "Scorpio", decan: 0, triplicitySign: "Scorpio", rulers: ["Mars"], degRange: [0, 10] },
    { sign: "Scorpio", decan: 1, triplicitySign: "Pisces", rulers: ["Jupiter", "Neptune"], degRange: [10, 20] },
    { sign: "Scorpio", decan: 2, triplicitySign: "Cancer", rulers: ["Moon"], degRange: [20, 30] },
    // Pisces: Water
    { sign: "Pisces", decan: 0, triplicitySign: "Pisces", rulers: ["Jupiter", "Neptune"], degRange: [0, 10] },
    { sign: "Pisces", decan: 1, triplicitySign: "Cancer", rulers: ["Moon"], degRange: [10, 20] },
    { sign: "Pisces", decan: 2, triplicitySign: "Scorpio", rulers: ["Pluto"], degRange: [20, 30] }
  ],
  swords: [
    // Libra: Air
    { sign: "Libra", decan: 0, triplicitySign: "Libra", rulers: ["Venus"], degRange: [0, 10] },
    { sign: "Libra", decan: 1, triplicitySign: "Aquarius", rulers: ["Uranus"], degRange: [10, 20] },
    { sign: "Libra", decan: 2, triplicitySign: "Gemini", rulers: ["Mercury"], degRange: [20, 30] },
    // Aquarius: Air
    { sign: "Aquarius", decan: 0, triplicitySign: "Aquarius", rulers: ["Saturn", "Uranus"], degRange: [0, 10] },
    { sign: "Aquarius", decan: 1, triplicitySign: "Gemini", rulers: ["Mercury"], degRange: [10, 20] },
    { sign: "Aquarius", decan: 2, triplicitySign: "Libra", rulers: ["Venus"], degRange: [20, 30] },
    // Gemini: Air
    { sign: "Gemini", decan: 0, triplicitySign: "Gemini", rulers: ["Mercury"], degRange: [0, 10] },
    { sign: "Gemini", decan: 1, triplicitySign: "Libra", rulers: ["Venus"], degRange: [10, 20] },
    { sign: "Gemini", decan: 2, triplicitySign: "Aquarius", rulers: ["Uranus"], degRange: [20, 30] }
  ],
  pentacles: [
    // Capricorn: Earth
    { sign: "Capricorn", decan: 0, triplicitySign: "Capricorn", rulers: ["Saturn"], degRange: [0, 10] },
    { sign: "Capricorn", decan: 1, triplicitySign: "Taurus", rulers: ["Venus"], degRange: [10, 20] },
    { sign: "Capricorn", decan: 2, triplicitySign: "Virgo", rulers: ["Mercury"], degRange: [20, 30] },
    // Taurus: Earth
    { sign: "Taurus", decan: 0, triplicitySign: "Taurus", rulers: ["Venus"], degRange: [0, 10] },
    { sign: "Taurus", decan: 1, triplicitySign: "Virgo", rulers: ["Mercury"], degRange: [10, 20] },
    { sign: "Taurus", decan: 2, triplicitySign: "Capricorn", rulers: ["Saturn"], degRange: [20, 30] },
    // Virgo: Earth
    { sign: "Virgo", decan: 0, triplicitySign: "Virgo", rulers: ["Mercury"], degRange: [0, 10] },
    { sign: "Virgo", decan: 1, triplicitySign: "Capricorn", rulers: ["Saturn"], degRange: [10, 20] },
    { sign: "Virgo", decan: 2, triplicitySign: "Taurus", rulers: ["Venus"], degRange: [20, 30] }
  ]
};

// Golden Dawn Chaldean sub-rulers (kept intact for deck minting & server parity)
const CHALDEAN_CYCLE = [4, 0, 3, 2, 1, 6, 5];
const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];

const DECAN_TITLES = [
  "Dominion", "Established Strength", "Perfected Work",          // Aries (0): 2, 3, 4 Wands
  "Material Trouble", "Material Success", "Success Unfulfilled", // Taurus (1): 5, 6, 7 Pentacles
  "Shortened Force", "Despair & Cruelty", "Ruin",               // Gemini (2): 8, 9, 10 Swords
  "Love", "Abundance", "Blended Pleasure",                       // Cancer (3): 2, 3, 4 Cups
  "Strife", "Victory", "Valour",                                // Leo (4): 5, 6, 7 Wands
  "Prudence", "Material Gain", "Wealth",                         // Virgo (5): 8, 9, 10 Pentacles
  "Peace Restored", "Sorrow", "Rest from Strife",               // Libra (6): 2, 3, 4 Swords
  "Loss in Pleasure", "Pleasure", "Illusionary Success",        // Scorpio (7): 5, 6, 7 Cups
  "Swiftness", "Great Strength", "Oppression",                  // Sagittarius (8): 8, 9, 10 Wands
  "Harmonious Change", "Material Works", "Earthly Power",        // Capricorn (9): 2, 3, 4 Pentacles
  "Defeat", "Earned Success", "Unstable Effort",               // Aquarius (10): 5, 6, 7 Swords
  "Abandoned Success", "Material Happiness", "Perfected Success" // Pisces (11): 8, 9, 10 Cups
];

// Suits metadata
const SUITS = [
  {
    id: "wands",
    name: "Wands",
    element: "Fire",
    esms: 0,
    glyph: "🜂",
    color: "#db7a47",
    accent: "#f6cf83",
    audioBaseHz: 432,
    courtLetters: { 1: "A", 11: "P", 12: "N", 13: "Q", 14: "K" }
  },
  {
    id: "cups",
    name: "Cups",
    element: "Water",
    esms: 1,
    glyph: "🜄",
    color: "#5f93d8",
    accent: "#dce2f0",
    audioBaseHz: 396,
    courtLetters: { 1: "A", 11: "P", 12: "N", 13: "Q", 14: "K" }
  },
  {
    id: "swords",
    name: "Swords",
    element: "Air",
    esms: 3,
    glyph: "🜁",
    color: "#aebbd6",
    accent: "#82bbf2",
    audioBaseHz: 528,
    courtLetters: { 1: "A", 11: "P", 12: "N", 13: "Q", 14: "K" }
  },
  {
    id: "pentacles",
    name: "Pentacles",
    element: "Earth",
    esms: 2,
    glyph: "🜃",
    color: "#74ab6c",
    accent: "#f0a95e",
    audioBaseHz: 341,
    courtLetters: { 1: "A", 11: "P", 12: "N", 13: "Q", 14: "K" }
  }
];

const SUIT_ESMS_VECTORS = {
  wands:     { Spirit: 1, Essence: 0, Matter: 0, Substance: 0 },
  cups:      { Spirit: 0, Essence: 1, Matter: 0, Substance: 0 },
  swords:    { Spirit: 0, Essence: 0, Matter: 0, Substance: 1 },
  pentacles: { Spirit: 0, Essence: 0, Matter: 1, Substance: 0 }
};

const COURT_SUB_ELEMENTS = {
  11: { element: "pentacles", stars: 1 }, // Page: Earth of Suit
  12: { element: "wands",     stars: 2 }, // Knight: Fire of Suit
  13: { element: "cups",      stars: 3 }, // Queen: Water of Suit
  14: { element: "swords",    stars: 4 }  // King: Air of Suit
};

const COURT_TITLES = {
  wands: {
    11: "Princess of the Shining Flame; The Rose of the Palace of Fire",
    12: "Prince of the Chariot of Fire",
    13: "Queen of the Thrones of Flame",
    14: "Lord of the Flame and Lightning; King of the Spirits of Fire"
  },
  cups: {
    11: "Princess of the Waters; The Lotus of the Palace of the Floods",
    12: "Prince of the Chariot of the Waters",
    13: "Queen of the Thrones of the Waters",
    14: "Lord of the Waves and the Waters; King of the Hosts of the Sea"
  },
  swords: {
    11: "Princess of the Rushing Winds; The Lotus of the Palace of Air",
    12: "Prince of the Chariot of the Winds",
    13: "Queen of the Thrones of Air",
    14: "Lord of the Wind and the Breezes; King of the Spirits of Air"
  },
  pentacles: {
    11: "Princess of the Echoing Hills; The Rose of the Palace of Earth",
    12: "Prince of the Chariot of Earth",
    13: "Queen of the Thrones of Earth",
    14: "Lord of the Wide and Fertile Land; King of the Spirits of Earth"
  }
};

const RANK_SLUGS = {
  1: "ace", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
  7: "seven", 8: "eight", 9: "nine", 10: "ten",
  11: "page", 12: "knight", 13: "queen", 14: "king"
};

const RANK_NUMERALS = {
  1: "A", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6",
  7: "7", 8: "8", 9: "9", 10: "10",
  11: "P", 12: "Kn", 13: "Q", 14: "K"
};

const MINOR_TRICK_POWER = {
  1: 14, 10: 13, 14: 12, 13: 11, 12: 10, 11: 9,
  9: 8, 8: 7, 7: 6, 6: 5, 5: 4, 4: 3, 3: 2, 2: 1
};

const COUNTER_VALUES = {
  1: 10, 10: 10, 14: 10,
  13: 0, 12: 0, 11: 0,
  9: 0, 8: 0, 7: 0, 6: 0, 5: 0, 4: 0, 3: 0, 2: 0
};

// ── 6. 22 Major Arcana Metadata ─────────────────────────────────────────────
const MAJOR_ARCANA = [
  {
    rank: 0, numeral: "0", name: "The Fool", slug: "the-fool",
    family: "planetary", planet: "Uranus", planetIndex: 7, biasedSuit: "Swords",
    element: "Air", esms: 3, hebrewLetter: "Aleph (א)",
    treeOfLifePath: "11th Path (Kether to Chokmah)", goldenDawnTitle: "The Spirit of Aether",
    isHonour: true, counterValue: 10, glyph: "♅", suitGlyph: "✦",
    primaryColor: "#66d9e8", accentColor: "#f1dba1", frameStyle: "celestial-aether",
    audioFrequencyHz: 432, scrabbleLetter: "O",
    keywords: ["Beginnings", "Innocence", "Spontaneity", "Free Spirit", "The Leap"],
    upright: "Infinite potential, trusting the journey, stepping off the cliff into pure cosmic manifestation.",
    reversed: "Recklessness, fear of taking a risk, hesitation, erratic impulses.",
    description: "The zero point of the cosmos; the pilgrim carrying the bundle of memory, poised at the edge of the boundless abyss."
  },
  {
    rank: 1, numeral: "I", name: "The Magician", slug: "the-magician",
    family: "planetary", planet: "Mercury", planetIndex: 2, biasedSuit: "Swords",
    element: "Air", esms: 3, hebrewLetter: "Beth (ב)",
    treeOfLifePath: "12th Path (Kether to Binah)", goldenDawnTitle: "The Magus of Power",
    isHonour: true, counterValue: 10, glyph: "☿", suitGlyph: "✦",
    primaryColor: "#82bbf2", accentColor: "#f6cf83", frameStyle: "hermetic-gold",
    audioFrequencyHz: 528, scrabbleLetter: "M",
    keywords: ["Willpower", "Creation", "Manifestation", "Alchemy", "Mastery"],
    upright: "As above, so below. Conscious direction of celestial currents into the four material elements.",
    reversed: "Trickery, illusion, latent capability, fragmented focus, manipulation.",
    description: "The conduit standing at the altar of the four hallows: wand, cup, sword, and pentacle."
  },
  {
    rank: 2, numeral: "II", name: "The High Priestess", slug: "the-high-priestess",
    family: "planetary", planet: "Moon", planetIndex: 1, biasedSuit: "Cups",
    element: "Water", esms: 1, hebrewLetter: "Gimel (ג)",
    treeOfLifePath: "13th Path (Kether to Tiphereth)", goldenDawnTitle: "The Priestess of the Silver Star",
    isHonour: false, counterValue: 0, glyph: "☽", suitGlyph: "✦",
    primaryColor: "#dce2f0", accentColor: "#5f93d8", frameStyle: "lunar-veil",
    audioFrequencyHz: 416, scrabbleLetter: "P",
    keywords: ["Intuition", "Mystery", "Subconscious", "The Veil", "Inner Knowing"],
    upright: "Sitting between the pillars Boaz and Jachin, guarding the scrolls of hidden astrological wisdom.",
    reversed: "Secrets withheld, disconnect from intuition, superficiality, cognitive fog.",
    description: "The silent oracle seated before the pomegranate tapestry, bathed in perpetual lunar radiance."
  },
  {
    rank: 3, numeral: "III", name: "The Empress", slug: "the-empress",
    family: "planetary", planet: "Venus", planetIndex: 3, biasedSuit: "Cups",
    element: "Water", esms: 1, hebrewLetter: "Daleth (ד)",
    treeOfLifePath: "14th Path (Chokmah to Binah)", goldenDawnTitle: "The Daughter of the Mighty Ones",
    isHonour: false, counterValue: 0, glyph: "♀", suitGlyph: "✦",
    primaryColor: "#76e0a8", accentColor: "#f6cf83", frameStyle: "emerald-luxuria",
    audioFrequencyHz: 440, scrabbleLetter: "E",
    keywords: ["Fertility", "Abundance", "Nature", "Nurture", "Grace"],
    upright: "Rich organic proliferation, maternal cosmic grace, the living garden of creation in full bloom.",
    reversed: "Overindulgence, creative block, smothering control, depletion.",
    description: "Crowned with twelve stars, seated amid fields of ripe grain and flowing rivers of pure essence."
  },
  {
    rank: 4, numeral: "IV", name: "The Emperor", slug: "the-emperor",
    family: "sign", zodiacSign: "Aries", signIndex: 0, signRuler: "Mars", biasedSuit: "Wands",
    element: "Fire", esms: 0, hebrewLetter: "Heh (ה)",
    treeOfLifePath: "15th Path (Chokmah to Tiphereth)", goldenDawnTitle: "Sun of the Morning, Chief Among the Mighty",
    isHonour: false, counterValue: 0, glyph: "♈", suitGlyph: "✦",
    primaryColor: "#e26666", accentColor: "#db7a47", frameStyle: "martial-granite",
    audioFrequencyHz: 396, scrabbleLetter: "R",
    keywords: ["Authority", "Structure", "Sovereignty", "Stability", "Foundation"],
    upright: "Steadfast rule, martial organization, establishing firm boundaries and sovereign domains.",
    reversed: "Tyranny, rigidity, loss of control, stubborn unyielding dogmatism.",
    description: "Enthroned upon stone carved with ram heads, holding the globe of temporal and astral authority."
  },
  {
    rank: 5, numeral: "V", name: "The Hierophant", slug: "the-hierophant",
    family: "sign", zodiacSign: "Taurus", signIndex: 1, signRuler: "Venus", biasedSuit: "Pentacles",
    element: "Earth", esms: 2, hebrewLetter: "Vav (ו)",
    treeOfLifePath: "16th Path (Chokmah to Chesed)", goldenDawnTitle: "The Magus of the Eternal Gods",
    isHonour: false, counterValue: 0, glyph: "♉", suitGlyph: "✦",
    primaryColor: "#74ab6c", accentColor: "#f0a95e", frameStyle: "hieratic-sanctuary",
    audioFrequencyHz: 341, scrabbleLetter: "H",
    keywords: ["Tradition", "Spiritual Law", "Orthodoxy", "Initiation", "Guidance"],
    upright: "The bridge between esoteric knowledge and community discipline; transmission of lineage truth.",
    reversed: "Dogmatism, hypocrisy, rebellion against outmoded traditions, spiritual rigidity.",
    description: "Bearing the triple-tiered papal staff, imparting sacred mysteries to knelt acolytes."
  },
  {
    rank: 6, numeral: "VI", name: "The Lovers", slug: "the-lovers",
    family: "sign", zodiacSign: "Gemini", signIndex: 2, signRuler: "Mercury", biasedSuit: "Swords",
    element: "Air", esms: 3, hebrewLetter: "Zain (ז)",
    treeOfLifePath: "17th Path (Binah to Tiphereth)", goldenDawnTitle: "The Children of the Voice; The Oracle of the Mighty Gods",
    isHonour: false, counterValue: 0, glyph: "♊", suitGlyph: "✦",
    primaryColor: "#aebbd6", accentColor: "#db7a47", frameStyle: "alchemical-conjunction",
    audioFrequencyHz: 480, scrabbleLetter: "L",
    keywords: ["Union", "Harmony", "Duality", "Alignment", "Choice"],
    upright: "Alchemical marriage of sulfur and mercury; moral alignment and harmonic attraction.",
    reversed: "Discord, inner conflict, poor choices, misalignment of purpose, codependency.",
    description: "The two seekers beneath the outspread wings of Raphael, bathed in the warmth of the solar tree."
  },
  {
    rank: 7, numeral: "VII", name: "The Chariot", slug: "the-chariot",
    family: "sign", zodiacSign: "Cancer", signIndex: 3, signRuler: "Moon", biasedSuit: "Cups",
    element: "Water", esms: 1, hebrewLetter: "Cheth (ח)",
    treeOfLifePath: "18th Path (Binah to Geburah)", goldenDawnTitle: "The Child of the Powers of the Waters; The Lord of the Triumph of Light",
    isHonour: false, counterValue: 0, glyph: "♋", suitGlyph: "✦",
    primaryColor: "#5f93d8", accentColor: "#cbd0db", frameStyle: "star-canopy",
    audioFrequencyHz: 466, scrabbleLetter: "C",
    keywords: ["Triumph", "Direction", "Will", "Momentum", "Self-Mastery"],
    upright: "Steering opposing forces through unwavering internal discipline, driving forward toward victory.",
    reversed: "Loss of control, derailment, reckless aggression, being swept away by emotional tides.",
    description: "The armored prince under a starry azure baldachin, reigning in black and white sphinxes with the mind alone."
  },
  {
    rank: 8, numeral: "VIII", name: "Strength", slug: "strength",
    family: "sign", zodiacSign: "Leo", signIndex: 4, signRuler: "Sun", biasedSuit: "Wands",
    element: "Fire", esms: 0, hebrewLetter: "Teth (ט)",
    treeOfLifePath: "19th Path (Chesed to Geburah)", goldenDawnTitle: "The Daughter of the Flaming Sword",
    isHonour: false, counterValue: 0, glyph: "♌", suitGlyph: "✦",
    primaryColor: "#f0a95e", accentColor: "#db7a47", frameStyle: "solar-leonic",
    audioFrequencyHz: 540, scrabbleLetter: "S",
    keywords: ["Courage", "Gentle Force", "Patience", "Compassion", "Taming the Beast"],
    upright: "Subtle mastery of primal passions; true power exerted through patience, grace, and inner calm.",
    reversed: "Self-doubt, brute force, weakness of spirit, unchecked anger, raw vulnerability.",
    description: "The maiden crowned with the lemniscate, gently closing the jaws of the fiery red lion."
  },
  {
    rank: 9, numeral: "IX", name: "The Hermit", slug: "the-hermit",
    family: "sign", zodiacSign: "Virgo", signIndex: 5, signRuler: "Mercury", biasedSuit: "Pentacles",
    element: "Earth", esms: 2, hebrewLetter: "Yod (י)",
    treeOfLifePath: "20th Path (Chesed to Tiphereth)", goldenDawnTitle: "The Magus of the Voice of Power, The Prophet of the Gods",
    isHonour: false, counterValue: 0, glyph: "♍", suitGlyph: "✦",
    primaryColor: "#74ab6c", accentColor: "#9aa7c4", frameStyle: "cloistered-lantern",
    audioFrequencyHz: 405, scrabbleLetter: "I",
    keywords: ["Introspection", "Solitude", "Wisdom", "The Lantern", "Guidance"],
    upright: "Retreating to solitary heights to discern truth; carrying the lantern of cosmic illumination.",
    reversed: "Isolation, loneliness, withdrawal from community, arrogance of hidden knowledge.",
    description: "The hooded sage atop the icy peak, lifting high the six-pointed star of wisdom to guide seekers below."
  },
  {
    rank: 10, numeral: "X", name: "Wheel of Fortune", slug: "wheel-of-fortune",
    family: "planetary", planet: "Jupiter", planetIndex: 5, biasedSuit: "Wands",
    element: "Fire", esms: 0, hebrewLetter: "Kaph (כ)",
    treeOfLifePath: "21st Path (Chesed to Netzach)", goldenDawnTitle: "The Lord of the Forces of Life",
    isHonour: false, counterValue: 0, glyph: "♃", suitGlyph: "✦",
    primaryColor: "#f0a95e", accentColor: "#5f93d8", frameStyle: "karmic-zodiac",
    audioFrequencyHz: 494, scrabbleLetter: "W",
    keywords: ["Cycles", "Destiny", "Karma", "Turning Tide", "Fortune"],
    upright: "The inevitable revolutions of cosmic fate; change, rising luck, and seasonal transition.",
    reversed: "Bad turn of luck, resistance to change, breaking cycles, clinging to static illusions.",
    description: "The eight-spoked wheel inscribed with TARO and Hebrew tetragrammaton, flanked by Hermanubis and Typhon."
  },
  {
    rank: 11, numeral: "XI", name: "Justice", slug: "justice",
    family: "sign", zodiacSign: "Libra", signIndex: 6, signRuler: "Venus", biasedSuit: "Swords",
    element: "Air", esms: 3, hebrewLetter: "Lamed (ל)",
    treeOfLifePath: "22nd Path (Geburah to Tiphereth)", goldenDawnTitle: "The Daughter of the Lords of Truth; The Ruler of the Balance",
    isHonour: false, counterValue: 0, glyph: "♎", suitGlyph: "✦",
    primaryColor: "#aebbd6", accentColor: "#f6cf83", frameStyle: "equinoctial-scales",
    audioFrequencyHz: 432, scrabbleLetter: "J",
    keywords: ["Truth", "Fairness", "Equilibrium", "Cause & Effect", "Law"],
    upright: "Impartial clarity, absolute truth, weighing intentions upon the celestial balance.",
    reversed: "Injustice, dishonesty, unaccountability, corruption, prejudice.",
    description: "Seated between stone pillars, holding aloft the double-edged sword of discernment and golden scales."
  },
  {
    rank: 12, numeral: "XII", name: "The Hanged Man", slug: "the-hanged-man",
    family: "planetary", planet: "Neptune", planetIndex: 8, biasedSuit: "Cups",
    element: "Water", esms: 1, hebrewLetter: "Mem (מ)",
    treeOfLifePath: "23rd Path (Geburah to Hod)", goldenDawnTitle: "The Spirit of the Mighty Waters",
    isHonour: false, counterValue: 0, glyph: "♆", suitGlyph: "✦",
    primaryColor: "#4e7cd9", accentColor: "#82bbf2", frameStyle: "mystic-suspension",
    audioFrequencyHz: 360, scrabbleLetter: "U",
    keywords: ["Surrender", "New Perspective", "Suspension", "Enlightenment", "Sacrifice"],
    upright: "Reversal of worldly perception; willful surrender producing profound spiritual illumination.",
    reversed: "Martyrdom complex, stalling, needless sacrifice, resistance to letting go.",
    description: "Suspended upside down from the living wood of the World Tree, a golden halo glowing around the serene head."
  },
  {
    rank: 13, numeral: "XIII", name: "Death", slug: "death",
    family: "sign", zodiacSign: "Scorpio", signIndex: 7, signRuler: "Pluto", biasedSuit: "Cups",
    element: "Water", esms: 1, hebrewLetter: "Nun (נ)",
    treeOfLifePath: "24th Path (Tiphereth to Netzach)", goldenDawnTitle: "The Child of the Great Transformers; The Lord of the Gate of Death",
    isHonour: false, counterValue: 0, glyph: "♏", suitGlyph: "✦",
    primaryColor: "#5f93d8", accentColor: "#705988", frameStyle: "chthonic-transmutation",
    audioFrequencyHz: 312, scrabbleLetter: "D",
    keywords: ["Transformation", "Endings", "Metamorphosis", "Transition", "Rebirth"],
    upright: "The necessary clearing of the dead wood so that fresh shoots may rise; total irreversible transformation.",
    reversed: "Fear of change, stagnation, decay, dragging out the inevitable, holding onto ghosts.",
    description: "The skeletal knight on a pale horse carrying the black banner of the Mystic Rose before a rising golden sun."
  },
  {
    rank: 14, numeral: "XIV", name: "Temperance", slug: "temperance",
    family: "sign", zodiacSign: "Sagittarius", signIndex: 8, signRuler: "Jupiter", biasedSuit: "Wands",
    element: "Fire", esms: 0, hebrewLetter: "Samekh (ס)",
    treeOfLifePath: "25th Path (Tiphereth to Yesod)", goldenDawnTitle: "The Daughter of the Reconcilers; The Bringer-Forth of Life",
    isHonour: false, counterValue: 0, glyph: "♐", suitGlyph: "✦",
    primaryColor: "#db7a47", accentColor: "#76e0a8", frameStyle: "angelic-synthesis",
    audioFrequencyHz: 450, scrabbleLetter: "T",
    keywords: ["Alchemy", "Balance", "Moderation", "Integration", "Patience"],
    upright: "Continuous blending of opposites; pouring the water of life between gold and silver vessels.",
    reversed: "Imbalance, excess, conflicting elements, haste, discordant combinations.",
    description: "The winged solar angel with one foot on water and one on land, pouring liquid light in an endless stream."
  },
  {
    rank: 15, numeral: "XV", name: "The Devil", slug: "the-devil",
    family: "sign", zodiacSign: "Capricorn", signIndex: 9, signRuler: "Saturn", biasedSuit: "Pentacles",
    element: "Earth", esms: 2, hebrewLetter: "Ayin (ע)",
    treeOfLifePath: "26th Path (Tiphereth to Hod)", goldenDawnTitle: "The Lord of the Gates of Matter; The Child of the Forces of Time",
    isHonour: false, counterValue: 0, glyph: "♑", suitGlyph: "✦",
    primaryColor: "#74ab6c", accentColor: "#cf4d4d", frameStyle: "obsidian-chains",
    audioFrequencyHz: 288, scrabbleLetter: "B",
    keywords: ["Attachment", "Illusion of Bondage", "Materialism", "Shadow Self", "Instinct"],
    upright: "Enthrallment to the material world; loose chains that can be removed as soon as consciousness awakens.",
    reversed: "Breaking free from addiction, release of fear, confronting the shadow, reclamation of sovereignty.",
    description: "The goat-headed Baphomet seated on the stone cube, holding the inverted torch over captive souls."
  },
  {
    rank: 16, numeral: "XVI", name: "The Tower", slug: "the-tower",
    family: "planetary", planet: "Mars", planetIndex: 4, biasedSuit: "Wands",
    element: "Fire", esms: 0, hebrewLetter: "Peh (פ)",
    treeOfLifePath: "27th Path (Netzach to Hod)", goldenDawnTitle: "The Lord of the Hosts of the Mighty",
    isHonour: false, counterValue: 0, glyph: "♂", suitGlyph: "✦",
    primaryColor: "#e26666", accentColor: "#f6cf83", frameStyle: "fulgurite-citadel",
    audioFrequencyHz: 588, scrabbleLetter: "K",
    keywords: ["Sudden Upheaval", "Shattering Falsehood", "Revelation", "Catharsis", "Awakening"],
    upright: "The sudden bolt of cosmic lightning that topples brittle falsehoods; instant radical liberation.",
    reversed: "Disaster narrowly avoided, delaying inevitable breakdown, fear of personal collapse.",
    description: "A stone crown struck by lightning from heaven, fire bursting from windows as false idols tumble into the dark."
  },
  {
    rank: 17, numeral: "XVII", name: "The Star", slug: "the-star",
    family: "sign", zodiacSign: "Aquarius", signIndex: 10, signRuler: "Uranus", biasedSuit: "Swords",
    element: "Air", esms: 3, hebrewLetter: "Tzaddi (צ)",
    treeOfLifePath: "28th Path (Netzach to Yesod)", goldenDawnTitle: "The Daughter of the Firmament; The Dweller between the Waters",
    isHonour: false, counterValue: 0, glyph: "♒", suitGlyph: "✦",
    primaryColor: "#66d9e8", accentColor: "#dce2f0", frameStyle: "astral-dew",
    audioFrequencyHz: 672, scrabbleLetter: "A",
    keywords: ["Hope", "Inspiration", "Serenity", "Faith", "Cosmic Blessing"],
    upright: "Unclouded hope and divine inspiration after the storm; pouring pure stellar vitality back into the earth.",
    reversed: "Despair, loss of faith, discouragement, cynicism, disconnection from hope.",
    description: "The maiden under the great eight-pointed star, pouring celestial waters upon pool and fertile soil."
  },
  {
    rank: 18, numeral: "XVIII", name: "The Moon", slug: "the-moon",
    family: "sign", zodiacSign: "Pisces", signIndex: 11, signRuler: "Neptune", biasedSuit: "Cups",
    element: "Water", esms: 1, hebrewLetter: "Qoph (ק)",
    treeOfLifePath: "29th Path (Netzach to Malkuth)", goldenDawnTitle: "The Ruler of Flux and Reflux; The Child of the Sons of the Mighty",
    isHonour: false, counterValue: 0, glyph: "♓", suitGlyph: "✦",
    primaryColor: "#5f93d8", accentColor: "#998ab0", frameStyle: "nocturnal-tides",
    audioFrequencyHz: 384, scrabbleLetter: "N",
    keywords: ["Illusion", "Dreams", "Wild Instincts", "Uncertainty", "The Abyss"],
    upright: "Navigating nocturnal landscapes of the psyche; primal instincts rising as the lobster crawls from the pool.",
    reversed: "Dispelling deception, waking from nightmare, release of irrational anxiety.",
    description: "A path between twin watchtowers, a dog and wolf baying at the crescent orb shedding drops of light."
  },
  {
    rank: 19, numeral: "XIX", name: "The Sun", slug: "the-sun",
    family: "planetary", planet: "Sun", planetIndex: 0, biasedSuit: "Wands",
    element: "Fire", esms: 0, hebrewLetter: "Resh (ר)",
    treeOfLifePath: "30th Path (Hod to Yesod)", goldenDawnTitle: "The Lord of the Fire of the World",
    isHonour: false, counterValue: 0, glyph: "☉", suitGlyph: "✦",
    primaryColor: "#f6cf83", accentColor: "#db7a47", frameStyle: "radiant-helios",
    audioFrequencyHz: 528, scrabbleLetter: "S",
    keywords: ["Vitality", "Joy", "Clarity", "Warmth", "Solar Victory"],
    upright: "Total conscious radiance, uninhibited warmth, the triumph of solar light and absolute vitality.",
    reversed: "Temporary clouds, dampened enthusiasm, unrealistic optimism, ego burn.",
    description: "The joyous child riding a white horse beneath sunflowers, under the golden face of the radiant Sun."
  },
  {
    rank: 20, numeral: "XX", name: "Judgement", slug: "judgement",
    family: "planetary", planet: "Pluto", planetIndex: 9, biasedSuit: "Swords",
    element: "Fire", esms: 0, hebrewLetter: "Shin (ש)",
    treeOfLifePath: "31st Path (Hod to Malkuth)", goldenDawnTitle: "The Spirit of the Primal Fire",
    isHonour: false, counterValue: 0, glyph: "♇", suitGlyph: "✦",
    primaryColor: "#705988", accentColor: "#e26666", frameStyle: "apocalyptic-trumpet",
    audioFrequencyHz: 639, scrabbleLetter: "Y",
    keywords: ["Awakening", "Resurrection", "Reckoning", "Higher Calling", "Absolution"],
    upright: "Hearing the celestial horn; stepping out of the tomb of past self into spiritual rebirth.",
    reversed: "Harsh self-criticism, ignoring the inner call, denial of past errors, spiritual paralysis.",
    description: "Archangel Gabriel sounding the great golden horn over mountains as souls rise with outstretched arms."
  },
  {
    rank: 21, numeral: "XXI", name: "The World", slug: "the-world",
    family: "planetary", planet: "Saturn", planetIndex: 6, biasedSuit: "Pentacles",
    element: "Earth", esms: 2, hebrewLetter: "Tav (ת)",
    treeOfLifePath: "32nd Path (Yesod to Malkuth)", goldenDawnTitle: "The Great One of the Night of Time",
    isHonour: true, counterValue: 10, glyph: "♄", suitGlyph: "✦",
    primaryColor: "#998ab0", accentColor: "#74ab6c", frameStyle: "ouroboric-wreath",
    audioFrequencyHz: 741, scrabbleLetter: "Z",
    keywords: ["Completion", "Wholeness", "Integration", "Cosmic Dance", "Fulfillment"],
    upright: "Total integration of the four worlds and elements; triumphant completion of the Great Work.",
    reversed: "Unfinished journey, delays in closure, seeking shortcuts to mastery, hesitation at the finish line.",
    description: "The cosmic dancer dancing within the laurel wreath, surrounded by the four living creatures of the zodiac."
  }
];

// ── 7. Unified Derivation Pipeline (Pass 1: Raw Scores) ────────────────────
const cardRawList = [];

// 7a. Process 22 Major Arcana
for (const card of MAJOR_ARCANA) {
  let v = { Spirit: 0, Essence: 0, Matter: 0, Substance: 0 };
  let primaryPlanet = card.planet;

  if (card.family === "planetary") {
    const eBase = SUIT_ESMS_VECTORS[card.biasedSuit.toLowerCase()] || { Spirit: 0, Essence: 0, Matter: 0, Substance: 0 };
    const pAlchemy = PLANETARY_ALCHEMY[card.planet];
    v = {
      Spirit:    eBase.Spirit    + 2.0 * pAlchemy.Spirit,
      Essence:   eBase.Essence   + 2.0 * pAlchemy.Essence,
      Matter:    eBase.Matter    + 2.0 * pAlchemy.Matter,
      Substance: eBase.Substance + 2.0 * pAlchemy.Substance
    };
  } else {
    // Sign Major
    const signElement = SIGN_ELEMENT_VECTORS[card.zodiacSign];
    primaryPlanet = card.signRuler;
    const pAlchemy = PLANETARY_ALCHEMY[card.signRuler];
    v = {
      Spirit:    signElement.Spirit    + 1.0 * pAlchemy.Spirit,
      Essence:   signElement.Essence   + 1.0 * pAlchemy.Essence,
      Matter:    signElement.Matter    + 1.0 * pAlchemy.Matter,
      Substance: signElement.Substance + 1.0 * pAlchemy.Substance
    };
  }

  // Canonical matrix
  const raw = esmsToSacred7(v);

  // Modality
  if (card.zodiacSign) {
    const mod = SIGN_MODALITY[card.zodiacSign];
    if (mod === "cardinal") { raw.power += 1.5; raw.vitality += 1.0; }
    else if (mod === "fixed") { raw.resonance += 1.5; raw.wisdom += 1.5; }
    else if (mod === "mutable") { raw.adaptability += 2.0; raw.intuition += 1.0; }
  }

  // Planetary-12 tiebreaker
  if (primaryPlanet && PLANET_ARCHETYPE_BIAS[primaryPlanet]) {
    for (const [stat, val] of Object.entries(PLANET_ARCHETYPE_BIAS[primaryPlanet])) {
      raw[stat] += val;
    }
  }

  cardRawList.push({
    isMajor: true,
    cardDef: card,
    rawStats: raw
  });
}

// 7b. Process 56 Minor Arcana
for (const suit of SUITS) {
  const eSuit = SUIT_ESMS_VECTORS[suit.id];

  for (let rank = 1; rank <= 14; rank++) {
    let v = { Spirit: 0, Essence: 0, Matter: 0, Substance: 0 };
    let primaryPlanet = null;
    let modality = null;
    let triplicityData = null;
    let chaldeanInfo = null;

    if (rank === 1) {
      // Ace: pure elemental axis, ruler term = 0, root doubled
      v = {
        Spirit:    2.0 * eSuit.Spirit,
        Essence:   2.0 * eSuit.Essence,
        Matter:    2.0 * eSuit.Matter,
        Substance: 2.0 * eSuit.Substance
      };
      // Elemental archetype emphasis
      if (suit.id === "wands") primaryPlanet = "Sun";
      else if (suit.id === "cups") primaryPlanet = "Moon";
      else if (suit.id === "swords") primaryPlanet = "Mercury";
      else if (suit.id === "pentacles") primaryPlanet = "Saturn";
    } else if (rank >= 2 && rank <= 10) {
      // Pips 2–10: Decan cards
      const pipIdx = rank - 2; // 0..8
      triplicityData = TRIPLICITY_DECANS[suit.id][pipIdx];
      const hostSignIdx = SIGN_NAMES.indexOf(triplicityData.sign);
      modality = SIGN_MODALITY[triplicityData.sign];

      // Handle dual rulers (e.g. ["Mars", "Pluto"])
      let pAlchemyBlend = { Spirit: 0, Essence: 0, Matter: 0, Substance: 0 };
      const weight = 1.0 / triplicityData.rulers.length;

      for (const r of triplicityData.rulers) {
        const dig = getDignityMultiplier(r, hostSignIdx);
        const pa = PLANETARY_ALCHEMY[r];
        pAlchemyBlend.Spirit    += weight * dig * pa.Spirit;
        pAlchemyBlend.Essence   += weight * dig * pa.Essence;
        pAlchemyBlend.Matter    += weight * dig * pa.Matter;
        pAlchemyBlend.Substance += weight * dig * pa.Substance;
      }

      primaryPlanet = triplicityData.rulers[0];

      v = {
        Spirit:    1.0 * eSuit.Spirit    + 0.85 * pAlchemyBlend.Spirit,
        Essence:   1.0 * eSuit.Essence   + 0.85 * pAlchemyBlend.Essence,
        Matter:    1.0 * eSuit.Matter    + 0.85 * pAlchemyBlend.Matter,
        Substance: 1.0 * eSuit.Substance + 0.85 * pAlchemyBlend.Substance
      };

      // Golden Dawn Chaldean info for preservation
      let s = 0;
      let decIdx = 0;
      if (rank >= 2 && rank <= 4) {
        decIdx = rank - 2;
        s = suit.id === "wands" ? 0 : suit.id === "pentacles" ? 9 : suit.id === "swords" ? 6 : 3;
      } else if (rank >= 5 && rank <= 7) {
        decIdx = rank - 5;
        s = suit.id === "wands" ? 4 : suit.id === "pentacles" ? 1 : suit.id === "swords" ? 10 : 7;
      } else {
        decIdx = rank - 8;
        s = suit.id === "wands" ? 8 : suit.id === "pentacles" ? 5 : suit.id === "swords" ? 2 : 11;
      }
      const absDecan = s * 3 + decIdx;
      chaldeanInfo = {
        title: DECAN_TITLES[absDecan],
        sign: SIGN_NAMES[s],
        signIndex: s,
        decan: decIdx,
        decanRange: [decIdx * 10, decIdx * 10 + 10],
        rulerIndex: CHALDEAN_CYCLE[absDecan % 7],
        ruler: PLANET_NAMES[CHALDEAN_CYCLE[absDecan % 7]]
      };
    } else {
      // Court cards 11..14
      const courtMeta = COURT_SUB_ELEMENTS[rank];
      const eSub = SUIT_ESMS_VECTORS[courtMeta.element];
      const magnitude = 1.0 + 0.15 * courtMeta.stars;

      v = {
        Spirit:    1.0 * eSuit.Spirit    + 0.8 * magnitude * eSub.Spirit,
        Essence:   1.0 * eSuit.Essence   + 0.8 * magnitude * eSub.Essence,
        Matter:    1.0 * eSuit.Matter    + 0.8 * magnitude * eSub.Matter,
        Substance: 1.0 * eSuit.Substance + 0.8 * magnitude * eSub.Substance
      };

      // Court archetypes
      if (rank === 11) primaryPlanet = "Moon";      // Page / scout: receptive, intuitive
      else if (rank === 12) primaryPlanet = "Mars"; // Knight / charge: dynamic impetus
      else if (rank === 13) primaryPlanet = "Venus";// Queen / sovereign: magnetic coherence
      else if (rank === 14) primaryPlanet = "Sun";  // King / authority: solar agency
    }

    // Canonical matrix
    const raw = esmsToSacred7(v);

    // Modality shift
    if (modality === "cardinal") { raw.power += 1.5; raw.vitality += 1.0; }
    else if (modality === "fixed") { raw.resonance += 1.5; raw.wisdom += 1.5; }
    else if (modality === "mutable") { raw.adaptability += 2.0; raw.intuition += 1.0; }

    // Planetary-12 tiebreaker
    if (primaryPlanet && PLANET_ARCHETYPE_BIAS[primaryPlanet]) {
      for (const [stat, val] of Object.entries(PLANET_ARCHETYPE_BIAS[primaryPlanet])) {
        raw[stat] += val;
      }
    }

    cardRawList.push({
      isMajor: false,
      suit,
      rank,
      triplicityData,
      chaldeanInfo,
      rawStats: raw
    });
  }
}

// ── 8. Global Affine Normalization to [20, 95] ──────────────────────────────
let globalMin = Infinity;
let globalMax = -Infinity;

for (const item of cardRawList) {
  for (const v of Object.values(item.rawStats)) {
    if (v < globalMin) globalMin = v;
    if (v > globalMax) globalMax = v;
  }
}

function normalizeToBand(val) {
  const normalized = 20 + ((val - globalMin) / (globalMax - globalMin)) * (95 - 20);
  return Math.round(normalized);
}

for (const item of cardRawList) {
  item.normalizedStats = {
    power:        normalizeToBand(item.rawStats.power),
    resonance:    normalizeToBand(item.rawStats.resonance),
    wisdom:       normalizeToBand(item.rawStats.wisdom),
    charisma:     normalizeToBand(item.rawStats.charisma),
    intuition:    normalizeToBand(item.rawStats.intuition),
    adaptability: normalizeToBand(item.rawStats.adaptability),
    vitality:     normalizeToBand(item.rawStats.vitality)
  };
}

// ── 9. Write 78 JSON Card Files ─────────────────────────────────────────────
const allCards = [];

for (const item of cardRawList) {
  if (item.isMajor) {
    const card = item.cardDef;
    const cardData = {
      id: `major-${String(card.rank).padStart(2, "0")}`,
      slug: card.slug,
      name: card.name,
      arcana: "major",
      numeral: card.numeral,
      rank: card.rank,
      suit: "major",
      symbolism: {
        goldenDawnTitle: card.goldenDawnTitle,
        element: card.element,
        esms: card.esms,
        planetaryBody: card.planet || null,
        planetIndex: card.planetIndex !== undefined ? card.planetIndex : null,
        zodiacSign: card.zodiacSign || null,
        signIndex: card.signIndex !== undefined ? card.signIndex : null,
        decan: null,
        decanRange: null,
        chaldeanRuler: null,
        chaldeanRulerIndex: null,
        triplicitySign: card.zodiacSign || null,
        triplicityRuler: card.planet || card.signRuler || null,
        triplicityRulerIndex: card.planet ? PLANET_INDICES[card.planet] : (card.signRuler ? PLANET_INDICES[card.signRuler] : null),
        hebrewLetter: card.hebrewLetter || null,
        treeOfLifePath: card.treeOfLifePath || null
      },
      styling: {
        glyph: card.glyph,
        suitGlyph: card.suitGlyph,
        primaryColor: card.primaryColor,
        accentColor: card.accentColor,
        frameStyle: card.frameStyle,
        artAsset: `/assets/cards/major/${String(card.rank).padStart(2, "0")}-${card.slug}.jpg`,
        fallbackArt: `/assets/suits/${card.biasedSuit.toLowerCase()}.jpg`,
        audioFrequencyHz: card.audioFrequencyHz
      },
      sacredStats: item.normalizedStats,
      scrabbleLetter: card.scrabbleLetter,
      trickEngine: {
        trickPower: 1000 + (card.rank * 10),
        counterValue: card.counterValue,
        isHonour: card.isHonour,
        family: card.family,
        biasedSuit: card.biasedSuit,
        eligibleMelds: card.isHonour ? ["grand-cross", "the-trio", "celestial-honours"] : ["celestial-triumph"]
      },
      lore: {
        keywords: card.keywords,
        upright: card.upright,
        reversed: card.reversed,
        description: card.description
      }
    };

    const filename = path.join(CARDS_DIR, "major", `${String(card.rank).padStart(2, "0")}-${card.slug}.json`);
    fs.writeFileSync(filename, JSON.stringify(cardData, null, 2), "utf8");
    allCards.push(cardData);
  } else {
    // Minor Arcana
    const { suit, rank, triplicityData, chaldeanInfo } = item;
    const rankSlug = RANK_SLUGS[rank];
    const rankBadge = RANK_NUMERALS[rank];
    const cardId = `${suit.id}-${String(rank).padStart(2, "0")}`;
    const cardSlug = `${rankSlug}-of-${suit.id}`;
    const cardName = `${rankSlug.charAt(0).toUpperCase() + rankSlug.slice(1)} of ${suit.name}`;

    let goldenDawnTitle = "";
    let zodiacSign = null;
    let signIndex = null;
    let decan = null;
    let decanRange = null;
    let chaldeanRuler = null;
    let chaldeanRulerIndex = null;

    let triplicitySign = null;
    let triplicityRuler = null;
    let triplicityRulerIndex = null;

    let keywords = [];
    let upright = "";
    let reversed = "";
    let description = "";

    if (rank === 1) {
      goldenDawnTitle = `The Root of the Powers of ${suit.element}`;
      keywords = ["Origin", "Seed of Power", "Pure Potential", "Elemental Emergence"];
      upright = `The pristine primal spark of ${suit.element}; the root of elemental consciousness.`;
      reversed = `Blocked inspiration, wasted potential, ungrounded creative force.`;
      description = `A celestial hand emerges from the clouds bearing the living emblem of ${suit.element}.`;
      triplicityRuler = suit.id === "wands" ? "Sun" : (suit.id === "cups" ? "Moon" : (suit.id === "swords" ? "Mercury" : "Saturn"));
      triplicityRulerIndex = PLANET_INDICES[triplicityRuler];
    } else if (rank >= 2 && rank <= 10) {
      goldenDawnTitle = `Lord of ${chaldeanInfo.title}`;
      zodiacSign = chaldeanInfo.sign;
      signIndex = chaldeanInfo.signIndex;
      decan = chaldeanInfo.decan;
      decanRange = chaldeanInfo.decanRange;
      chaldeanRuler = chaldeanInfo.ruler;
      chaldeanRulerIndex = chaldeanInfo.rulerIndex;

      triplicitySign = triplicityData.triplicitySign;
      triplicityRuler = triplicityData.rulers.join(" & ");
      triplicityRulerIndex = PLANET_INDICES[triplicityData.rulers[0]];

      keywords = [chaldeanInfo.title, zodiacSign, triplicityRuler, `Decan ${decan + 1}`];
      upright = `${chaldeanInfo.title} expressed through ${suit.element}, attuned to ${triplicityRuler} in ${triplicitySign}.`;
      reversed = `Imbalance in ${chaldeanInfo.title}; tension between ${triplicityRuler} and ${zodiacSign}.`;
      description = `The ${rank} of ${suit.name} governs the ${decan + 1} decan of ${zodiacSign} (${decanRange[0]}°–${decanRange[1]}°), ruled by ${triplicityRuler}.`;
    } else {
      goldenDawnTitle = COURT_TITLES[suit.id][rank];
      const courtName = rank === 11 ? "Page" : rank === 12 ? "Knight" : rank === 13 ? "Queen" : "King";
      keywords = [courtName, suit.element, "Court Archetype", "Herald"];
      upright = `Mature embodiment of ${courtName} wielding ${suit.element} consciousness.`;
      reversed = `Misdirection of ${courtName}'s temperament; emotional or tactical friction.`;
      description = `${goldenDawnTitle}. Embodies the royal governance of ${suit.element}.`;
    }

    const counterVal = COUNTER_VALUES[rank] || 0;
    const trickPower = MINOR_TRICK_POWER[rank] || 0;

    const cardData = {
      id: cardId,
      slug: cardSlug,
      name: cardName,
      arcana: "minor",
      numeral: rankBadge,
      rank: rank,
      suit: suit.id,
      symbolism: {
        goldenDawnTitle,
        element: suit.element,
        esms: suit.esms,
        planetaryBody: chaldeanRuler || triplicityRuler,
        planetIndex: chaldeanRulerIndex !== null ? chaldeanRulerIndex : triplicityRulerIndex,
        zodiacSign,
        signIndex,
        decan,
        decanRange,
        chaldeanRuler,
        chaldeanRulerIndex,
        triplicitySign,
        triplicityRuler,
        triplicityRulerIndex,
        hebrewLetter: null,
        treeOfLifePath: null
      },
      styling: {
        glyph: suit.glyph,
        suitGlyph: suit.glyph,
        primaryColor: suit.color,
        accentColor: suit.accent,
        frameStyle: `${suit.id}-${rank <= 10 ? "pip" : "court"}`,
        artAsset: `/assets/cards/minor/${suit.id}/${String(rank).padStart(2, "0")}-${rankSlug}.jpg`,
        fallbackArt: `/assets/suits/${suit.id}.jpg`,
        audioFrequencyHz: suit.audioBaseHz + (rank * 12)
      },
      sacredStats: item.normalizedStats,
      scrabbleLetter: suit.courtLetters[rank] || String.fromCharCode(65 + ((rank * 3) % 26)),
      trickEngine: {
        trickPower,
        counterValue: counterVal,
        isHonour: false,
        family: "minor",
        biasedSuit: suit.name,
        eligibleMelds: rank >= 11 ? ["marriage", "royal-court"] : (rank === 1 ? ["royal-ace"] : ["run", "flush"])
      },
      lore: {
        keywords,
        upright,
        reversed,
        description
      }
    };

    const filename = path.join(CARDS_DIR, "minor", suit.id, `${String(rank).padStart(2, "0")}-${rankSlug}.json`);
    fs.writeFileSync(filename, JSON.stringify(cardData, null, 2), "utf8");
    allCards.push(cardData);
  }
}

// ── 10. Compile src/cards/index.js Registry Module ──────────────────────────
const indexModuleContent = `/* ============================================================
   Pentacles Tarot Cards Registry
   ============================================================
   Auto-generated registry of all 78 Tarot cards.
   Source of truth: data/cards/
   ============================================================ */

export const ALL_CARDS = ${JSON.stringify(allCards, null, 2)};

export const CARDS_BY_ID = Object.freeze(
  Object.fromEntries(ALL_CARDS.map(c => [c.id, c]))
);

export const CARDS_BY_SLUG = Object.freeze(
  Object.fromEntries(ALL_CARDS.map(c => [c.slug, c]))
);

export const MAJOR_ARCANA = Object.freeze(
  ALL_CARDS.filter(c => c.arcana === "major").sort((a, b) => a.rank - b.rank)
);

export const MINOR_ARCANA = Object.freeze({
  wands: ALL_CARDS.filter(c => c.suit === "wands").sort((a, b) => a.rank - b.rank),
  cups: ALL_CARDS.filter(c => c.suit === "cups").sort((a, b) => a.rank - b.rank),
  swords: ALL_CARDS.filter(c => c.suit === "swords").sort((a, b) => a.rank - b.rank),
  pentacles: ALL_CARDS.filter(c => c.suit === "pentacles").sort((a, b) => a.rank - b.rank)
});

/**
 * Lookup a card by its ID (e.g. 'major-00', 'wands-01', 'cups-14').
 * @param {string} id
 * @returns {object|null}
 */
export function getCardById(id) {
  if (!id) return null;
  return CARDS_BY_ID[String(id).toLowerCase().trim()] || null;
}

/**
 * Lookup a card by its URL slug (e.g. 'the-fool', 'ace-of-wands', 'king-of-pentacles').
 * @param {string} slug
 * @returns {object|null}
 */
export function getCardBySlug(slug) {
  if (!slug) return null;
  return CARDS_BY_SLUG[String(slug).toLowerCase().trim()] || null;
}

/**
 * Lookup a card by suit and rank.
 * @param {string} suit 'major' | 'wands' | 'cups' | 'swords' | 'pentacles'
 * @param {number} rank 0..21 for major, 1..14 for minor
 * @returns {object|null}
 */
export function getCard(suit, rank) {
  const s = String(suit || "").toLowerCase().trim();
  const r = Number(rank);
  if (s === "major") {
    return MAJOR_ARCANA[r] || null;
  }
  const suitList = MINOR_ARCANA[s];
  if (!suitList) return null;
  return suitList.find(c => c.rank === r) || null;
}

/**
 * Lookup a Major Arcana by its arcana index (0..21).
 * @param {number} arcanaIndex
 * @returns {object|null}
 */
export function getMajorArcana(arcanaIndex) {
  const idx = Number(arcanaIndex);
  return MAJOR_ARCANA[idx] || null;
}

/**
 * Lookup a Minor Decan Pip card by zodiac sign index (0..11) and decan index (0..2).
 * @param {number} signIndex 0=Aries .. 11=Pisces
 * @param {number} decanIndex 0..2 (0-10 deg, 10-20 deg, 20-30 deg)
 * @returns {object|null}
 */
export function getDecanPip(signIndex, decanIndex) {
  const s = ((Number(signIndex) % 12) + 12) % 12;
  const d = Math.max(0, Math.min(2, Number(decanIndex) || 0));
  return ALL_CARDS.find(
    c => c.arcana === "minor" &&
         c.symbolism &&
         c.symbolism.signIndex === s &&
         c.symbolism.decan === d
  ) || null;
}

/**
 * Get all 22 Major Arcana cards.
 * @returns {Array<object>}
 */
export function getAllMajors() {
  return MAJOR_ARCANA;
}

/**
 * Get all Minor Arcana cards, optionally filtered by suit.
 * @param {string} [suit] 'wands' | 'cups' | 'swords' | 'pentacles'
 * @returns {Array<object>}
 */
export function getAllMinors(suit) {
  if (suit) {
    const s = String(suit).toLowerCase().trim();
    return MINOR_ARCANA[s] || [];
  }
  return [...MINOR_ARCANA.wands, ...MINOR_ARCANA.cups, ...MINOR_ARCANA.swords, ...MINOR_ARCANA.pentacles];
}

/**
 * Get all 78 Tarot cards.
 * @returns {Array<object>}
 */
export function getAllCards() {
  return ALL_CARDS;
}

export default {
  ALL_CARDS,
  CARDS_BY_ID,
  CARDS_BY_SLUG,
  MAJOR_ARCANA,
  MINOR_ARCANA,
  getCardById,
  getCardBySlug,
  getCard,
  getMajorArcana,
  getDecanPip,
  getAllMajors,
  getAllMinors,
  getAllCards
};
`;

fs.writeFileSync(path.join(SRC_CARDS_DIR, "index.js"), indexModuleContent, "utf8");

console.log(`✓ Successfully derived and generated all ${allCards.length} Tarot cards with canonical Alchm Sacred 7 stats!`);
console.log(`  Global Raw Bounds: [${globalMin.toFixed(2)}, ${globalMax.toFixed(2)}] → Target Band [20, 95]`);
