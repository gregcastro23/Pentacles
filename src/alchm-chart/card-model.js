/**
 * Card Model & Presentation Contract for AlchmChart (ESM)
 * Provides Tarot Card normalization, 5-zone presentation contract,
 * and astrological visual assets for the ES module layer.
 */
import {
  SUIT_GLYPHS,
  SUIT_COLORS,
  SUIT_ART,
  rankName,
  MAJOR_NUMERALS,
  MAJOR_NAMES,
  ARCANA_NUMERALS,
  ARCANA_NAMES
} from "./deck.js";

export const SUIT_NAMES = {
  wands: "Wands",
  cups: "Cups",
  swords: "Swords",
  pentacles: "Pentacles",
  Wands: "Wands",
  Cups: "Cups",
  Swords: "Swords",
  Pentacles: "Pentacles"
};

export const SUIT_ELEMENTS = {
  wands: "Fire",
  cups: "Water",
  swords: "Air",
  pentacles: "Earth",
  Wands: "Fire",
  Cups: "Water",
  Swords: "Air",
  Pentacles: "Earth"
};

export const PLANET_NAMES = [
  "Sun", "Moon", "Mercury", "Venus", "Mars",
  "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"
];

export const PLANET_GLYPHS = [
  "☉", "☽", "☿", "♀", "♂",
  "♃", "♄", "♅", "♆", "♇"
];

export const PLANET_COLORS = [
  "#f1dba1", "#cbd0db", "#9aa7c4", "#d98fb0", "#cf4d4d",
  "#cf9a52", "#9a937c", "#5fb6c4", "#6470c8", "#8a6aa0"
];

export const SIGN_NAMES = [
  "Aries", "Taurus", "Gemini", "Cancer",
  "Leo", "Virgo", "Libra", "Scorpio",
  "Sagittarius", "Capricorn", "Aquarius", "Pisces"
];

export const SIGN_GLYPHS = [
  "♈", "♉", "♊", "♋",
  "♌", "♍", "♎", "♏",
  "♐", "♑", "♒", "♓"
];

export const rankLabel = (r) => rankName(r);

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Normalizes any card payload (raw database row, server card, deck item, or sparse mock)
 * into a consistent, robust view-model for tarot-card presentation.
 */
export function normalizeTarotCard(rawCard, loadout = "bench", options = {}) {
  const c = rawCard || {};
  const opts = options || {};

  const cardId = Number(c.card_id !== undefined ? c.card_id : (c.id !== undefined ? c.id : (c.cardId !== undefined ? c.cardId : 0)));
  const isMajor = Boolean(c.is_major || c.isMajor || false);

  // Suit normalization
  let rawSuit = String(c.suit || "").toLowerCase().trim();
  if (!rawSuit || rawSuit === "null" || rawSuit === "undefined") {
    rawSuit = isMajor ? "major" : "wands";
  }
  const suitKey = rawSuit;
  const suitName = SUIT_NAMES[suitKey] || (suitKey.charAt(0).toUpperCase() + suitKey.slice(1));
  const suitGlyph = SUIT_GLYPHS[suitKey] || "✦";
  const suitElement = SUIT_ELEMENTS[suitKey] || (isMajor ? "Astral" : "Aether");
  const suitColor = SUIT_COLORS[suitKey] || "var(--ac-gold, #f1dba1)";
  const suitArtSrc = SUIT_ART[suitKey] || `/assets/suits/${suitKey}.jpg`;

  // Planet / Celestial source body
  let bodyIdx = (c.source_body !== undefined && c.source_body !== null)
    ? Number(c.source_body)
    : ((c.sourceBody !== undefined && c.sourceBody !== null) ? Number(c.sourceBody) : (isMajor ? (Number(c.rank || 0) % 10) : 0));
  if (isNaN(bodyIdx) || bodyIdx < 0 || bodyIdx > 9) bodyIdx = 0;

  const planetName = PLANET_NAMES[bodyIdx] || "Cosmic";
  const planetGlyph = PLANET_GLYPHS[bodyIdx] || "✦";
  const planetColor = PLANET_COLORS[bodyIdx] || suitColor;

  // Rank normalization
  const rawRank = (c.rank !== undefined && c.rank !== null) ? Number(c.rank) : null;
  let rankDisplay = "";
  let rankCorner = "";
  if (isMajor) {
    if (rawRank !== null && rawRank !== undefined && ARCANA_NUMERALS[rawRank]) {
      rankDisplay = ARCANA_NUMERALS[rawRank];
      rankCorner = ARCANA_NUMERALS[rawRank];
    } else if (MAJOR_NUMERALS[bodyIdx]) {
      rankDisplay = MAJOR_NUMERALS[bodyIdx];
      rankCorner = MAJOR_NUMERALS[bodyIdx];
    } else {
      rankDisplay = "Maj";
      rankCorner = "✦";
    }
  } else {
    rankDisplay = rankLabel(rawRank);
    rankCorner = (rawRank !== undefined && rawRank !== null) ? String(rawRank) : "✦";
    if (rawRank === 1) rankCorner = "A";
    else if (rawRank === 11) rankCorner = "P";
    else if (rawRank === 12) rankCorner = "Kn";
    else if (rawRank === 13) rankCorner = "Q";
    else if (rawRank === 14) rankCorner = "K";
  }

  // Zodiac sign
  const signIdx = Number(c.sign_idx !== undefined ? c.sign_idx : (c.signIdx !== undefined ? c.signIdx : 0));
  const signName = SIGN_NAMES[signIdx] || "";
  const signGlyph = SIGN_GLYPHS[signIdx] || "✦";

  // Title & Subline
  let title = c.title;
  if (!title) {
    if (isMajor) {
      title = (rawRank !== undefined && ARCANA_NAMES[rawRank]) || MAJOR_NAMES[bodyIdx] || "Major Arcana";
    } else {
      title = `${rankLabel(rawRank)} of ${suitName}`;
    }
  }

  const subline = isMajor
    ? `Major ${rankDisplay} · ${planetName}`
    : `${signGlyph} ${signName} · ${suitElement}`;

  // Loadout
  const rawLoadout = String(loadout || c.currentLoadout || c.loadout || "bench").toLowerCase();
  const normalizedLoadout = (rawLoadout === "active" || rawLoadout === "defense") ? rawLoadout : "bench";

  // Face-down state: EXPLICIT boolean only!
  const isFaceDown = Boolean(opts.faceDown === true || c.faceDown === true);

  // Orientation
  const isInverted = Boolean(c.inverted || c.is_inverted || c.retrograde || false);

  // Stats
  const attack = (c.attack !== undefined) ? Number(c.attack) : (c.atk !== undefined ? Number(c.atk) : null);
  const health = (c.health !== undefined) ? Number(c.health) : (c.hp !== undefined ? Number(c.hp) : null);
  const armour = (c.armour !== undefined) ? Number(c.armour) : (c.arm !== undefined ? Number(c.arm) : null);
  const cooldownMs = (c.cooldown_ms !== undefined) ? Number(c.cooldown_ms) : (c.cooldownMs !== undefined ? Number(c.cooldownMs) : (c.cd !== undefined ? Number(c.cd) : null));
  const level = Number(c.level || 1);
  const letter = c.letter ? String(c.letter) : null;

  return {
    cardId,
    isMajor,
    suitKey,
    suitName,
    suitGlyph,
    suitElement,
    suitColor,
    suitArtSrc,
    bodyIdx,
    planetName,
    planetGlyph,
    planetColor,
    signIdx,
    signName,
    signGlyph,
    rank: rawRank,
    rankDisplay,
    rankCorner,
    title,
    subline,
    loadout: normalizedLoadout,
    isFaceDown,
    isInverted,
    attack,
    health,
    armour,
    cooldownMs,
    level,
    letter
  };
}

export {
  SUIT_GLYPHS,
  SUIT_COLORS,
  SUIT_ART,
  MAJOR_NAMES,
  MAJOR_NUMERALS,
  ARCANA_NAMES,
  ARCANA_NUMERALS
};
