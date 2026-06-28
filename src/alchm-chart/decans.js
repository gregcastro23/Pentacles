/* ============================================================
   AlchmChart — decans → Minor Arcana (Golden Dawn)
   ============================================================
   DOM-free, dependency-free. Every 10° decan of the zodiac maps to one
   Minor Arcana pip (2–10): the SUIT is the sign's triplicity and the RANK
   is the decan number (cardinal 2–4, fixed 5–7, mutable 8–10). This is the
   same scheme the server mints the game deck from — see `pip_rank`/`decan`
   in server/src/chart.rs — kept in sync here so the chart can name a
   placement's card without a round-trip.

   Each decan also carries a planetary sub-ruler in Chaldean order (the
   "faces"), starting at Mars for Aries 0–10°, plus the traditional
   "Lord of…" title.

   Planet indices match the rest of the chart (Sun 0 · Moon 1 · Mercury 2 ·
   Venus 3 · Mars 4 · Jupiter 5 · Saturn 6 · Uranus 7 · Neptune 8 · Pluto 9).
   ESMS index matches math.js (Spirit/Fire 0 · Essence/Water 1 ·
   Matter/Earth 2 · Substance/Air 3).
   ============================================================ */

// Suit by triplicity (sign % 4) — Fire/Earth/Air/Water — mirrors sign_element().
const SUITS = ["Wands", "Pentacles", "Swords", "Cups"];
// Suit → ESMS id, for elemental coloring in the UI.
const ESMS_OF_SUIT = { Wands: 0, Cups: 1, Pentacles: 2, Swords: 3 };
// Rank base by modality (sign % 3): cardinal 2 · fixed 5 · mutable 8.
const RANK_BASE = [2, 5, 8];
// Chaldean "faces" cycle as planet indices, starting at Mars (Aries 0–10°):
// Mars · Sun · Venus · Mercury · Moon · Saturn · Jupiter.
const CHALDEAN = [4, 0, 3, 2, 1, 6, 5];

// Traditional "Lord of…" titles, indexed by absolute decan (sign*3 + decan),
// Aries 0–10° = 0 … Pisces 20–30° = 35.
const TITLES = [
  "Dominion", "Established Strength", "Perfected Work",          // Aries  — 2·3·4 Wands
  "Material Trouble", "Material Success", "Success Unfulfilled", // Taurus — 5·6·7 Pentacles
  "Shortened Force", "Despair & Cruelty", "Ruin",               // Gemini — 8·9·10 Swords
  "Love", "Abundance", "Blended Pleasure",                       // Cancer — 2·3·4 Cups
  "Strife", "Victory", "Valour",                                // Leo    — 5·6·7 Wands
  "Prudence", "Material Gain", "Wealth",                         // Virgo  — 8·9·10 Pentacles
  "Peace Restored", "Sorrow", "Rest from Strife",               // Libra  — 2·3·4 Swords
  "Loss in Pleasure", "Pleasure", "Illusionary Success",        // Scorpio— 5·6·7 Cups
  "Swiftness", "Great Strength", "Oppression",                  // Sagittarius — 8·9·10 Wands
  "Harmonious Change", "Material Works", "Earthly Power",        // Capricorn — 2·3·4 Pentacles
  "Defeat", "Earned Success", "Unstable Effort",               // Aquarius — 5·6·7 Swords
  "Abandoned Success", "Material Happiness", "Perfected Success",// Pisces — 8·9·10 Cups
];

/**
 * The Minor Arcana decan card for a placement.
 * @param {number} sign       0–11 (Aries=0 … Pisces=11)
 * @param {number} degInSign  degree within the sign, 0–30
 * @returns {{sign:number, decanIndex:number, rank:number, suit:string,
 *   card:string, title:string, esms:number, ruler:number, range:[number,number]}}
 */
export function decanCard(sign, degInSign) {
  const s = (((sign | 0) % 12) + 12) % 12;
  const deg = Math.max(0, Math.min(29.999, Number(degInSign) || 0));
  const decanIndex = Math.min(2, Math.floor(deg / 10));
  const absDecan = s * 3 + decanIndex;
  const suit = SUITS[s % 4];
  const rank = RANK_BASE[s % 3] + decanIndex;
  return {
    sign: s,
    decanIndex,
    rank,
    suit,
    card: `${rank} of ${suit}`,
    title: TITLES[absDecan],
    esms: ESMS_OF_SUIT[suit],
    ruler: CHALDEAN[absDecan % 7],
    range: [decanIndex * 10, decanIndex * 10 + 10],
  };
}

/** Decan cards for an array of chart positions (each needs {sign, degInSign}). */
export function decanCardsFor(positions) {
  return (positions || []).map((p) => ({ pos: p, card: decanCard(p.sign, p.degInSign) }));
}

export default { decanCard, decanCardsFor };
