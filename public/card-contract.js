/**
 * Pentacles Tarot Card Normalization & Presentation Contract
 * UMD module: runs seamlessly in classic browser scripts, ES modules, and Node/Bun tests.
 */
(function (root, factory) {
  const contract = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = contract;
  }
  if (typeof root === "object" && root !== null) {
    root.PentaclesCardContract = contract;
    root.normalizeTarotCard = contract.normalizeTarotCard;
  }
  if (typeof globalThis === "object" && globalThis !== null) {
    globalThis.PentaclesCardContract = contract;
    globalThis.normalizeTarotCard = contract.normalizeTarotCard;
  }
  if (typeof window === "object" && window !== null) {
    window.PentaclesCardContract = contract;
    window.normalizeTarotCard = contract.normalizeTarotCard;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SUIT_NAMES = {
    wands: "Wands",
    cups: "Cups",
    swords: "Swords",
    pentacles: "Pentacles",
    Wands: "Wands",
    Cups: "Cups",
    Swords: "Swords",
    Pentacles: "Pentacles"
  };

  const SUIT_GLYPHS = {
    wands: "🜂",
    cups: "🜄",
    swords: "🜁",
    pentacles: "🜃",
    Wands: "🜂",
    Cups: "🜄",
    Swords: "🜁",
    Pentacles: "🜃"
  };

  const SUIT_ELEMENTS = {
    wands: "Fire",
    cups: "Water",
    swords: "Air",
    pentacles: "Earth",
    Wands: "Fire",
    Cups: "Water",
    Swords: "Air",
    Pentacles: "Earth"
  };

  const SUIT_COLORS = {
    wands: "#db7a47",
    cups: "#5f93d8",
    swords: "#aebbd6",
    pentacles: "#74ab6c",
    Wands: "#db7a47",
    Cups: "#5f93d8",
    Swords: "#aebbd6",
    Pentacles: "#74ab6c"
  };

  const SUIT_ART = {
    wands: "/assets/suits/wands.jpg",
    cups: "/assets/suits/cups.jpg",
    swords: "/assets/suits/swords.jpg",
    pentacles: "/assets/suits/pentacles.jpg",
    Wands: "/assets/suits/wands.jpg",
    Cups: "/assets/suits/cups.jpg",
    Swords: "/assets/suits/swords.jpg",
    Pentacles: "/assets/suits/pentacles.jpg"
  };

  const PLANET_NAMES = [
    "Sun", "Moon", "Mercury", "Venus", "Mars",
    "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"
  ];

  const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];

  const PLANET_COLORS = [
    "#f6cf83", // Sun - Radiant Solar Gold
    "#dce2f0", // Moon - Lunar Pearl Silver
    "#82bbf2", // Mercury - Hermetic Quicksilver Cyan
    "#76e0a8", // Venus - Phosphor Emerald
    "#e26666", // Mars - Martial Vermilion
    "#f0a95e", // Jupiter - Jovian Saffron
    "#998ab0", // Saturn - Saturnine Amethyst Lead
    "#66d9e8", // Uranus - Primordial Electric Teal
    "#4e7cd9", // Neptune - Abyssal Ultramarine
    "#705988"  // Pluto - Chthonic Obsidian Violet
  ];

  const SIGN_NAMES = [
    "Aries", "Taurus", "Gemini", "Cancer",
    "Leo", "Virgo", "Libra", "Scorpio",
    "Sagittarius", "Capricorn", "Aquarius", "Pisces"
  ];

  const SIGN_GLYPHS = ["♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓"];

  const MAJOR_NAMES = [
    "The Sun", "The High Priestess", "The Magician", "The Empress", "The Tower",
    "Wheel of Fortune", "The World", "The Fool", "The Hanged Man", "Judgement"
  ];

  const MAJOR_NUMERALS = ["XIX", "II", "I", "III", "XVI", "X", "XXI", "0", "XII", "XX"];

  const ARCANA_NAMES = [
    "The Fool", "The Magician", "The High Priestess", "The Empress", "The Emperor",
    "The Hierophant", "The Lovers", "The Chariot", "Strength", "The Hermit",
    "Wheel of Fortune", "Justice", "The Hanged Man", "Death", "Temperance",
    "The Devil", "The Tower", "The Star", "The Moon", "The Sun",
    "Judgement", "The World"
  ];

  const ARCANA_NUMERALS = [
    "0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX",
    "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX",
    "XX", "XXI"
  ];

  const RANK_LABEL = { 1: "Ace", 11: "Page", 12: "Knight", 13: "Queen", 14: "King" };
  const rankLabel = function (r) {
    if (r === undefined || r === null) return "✦";
    return RANK_LABEL[r] || String(r);
  };

  const escapeHtml = function (val) {
    if (val === undefined || val === null) return "";
    return String(val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  /**
   * Normalizes any card payload (snake_case, camelCase, sparse/legacy)
   * into a consistent, robust presentation object.
   */
  function normalizeTarotCard(raw, loadout, options) {
    const c = raw || {};
    const opts = options || {};

    const cardId = Number(c.card_id !== undefined ? c.card_id : (c.cardId !== undefined ? c.cardId : (c.id !== undefined ? c.id : 0)));
    const isMajor = Boolean(c.is_major !== undefined ? c.is_major : (c.isMajor !== undefined ? c.isMajor : false));

    // Suit handling
    const rawSuit = String(c.suit || (isMajor ? "major" : "wands")).trim();
    const suitKey = (rawSuit === "major" || isMajor) ? "major" : (rawSuit.toLowerCase() || "wands");
    const suitName = isMajor ? "Major Arcana" : (SUIT_NAMES[suitKey] || "Wands");
    const suitGlyph = isMajor ? "✦" : (SUIT_GLYPHS[suitKey] || "✦");
    const suitElement = isMajor ? "Aether" : (SUIT_ELEMENTS[suitKey] || "Element");
    const suitColor = isMajor ? "#f1dba1" : (SUIT_COLORS[suitKey] || "#db7a47");
    const suitArtSrc = isMajor ? null : (SUIT_ART[suitKey] || null);

    // Planet / Source body
    let bodyIdx = 0;
    if (typeof c.source_body === "number") {
      bodyIdx = c.source_body;
    } else if (typeof c.sourceBody === "number") {
      bodyIdx = c.sourceBody;
    } else if (typeof c.source_body === "string") {
      bodyIdx = PLANET_NAMES.indexOf(c.source_body);
    } else if (typeof c.sourceBody === "string") {
      bodyIdx = PLANET_NAMES.indexOf(c.sourceBody);
    }
    if (bodyIdx < 0 || bodyIdx >= PLANET_NAMES.length) bodyIdx = 0;
    const planetName = PLANET_NAMES[bodyIdx] || "Celestial";
    const planetGlyph = PLANET_GLYPHS[bodyIdx] || "✦";
    const planetColor = PLANET_COLORS[bodyIdx] || suitColor;

    // Rank & Numerals
    const rawRank = c.rank !== undefined ? c.rank : c.rank_num;
    let rankDisplay = "✦";
    let rankCorner = "✦";
    if (isMajor) {
      if (rawRank !== undefined && ARCANA_NUMERALS[rawRank]) {
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
    // Never inferred from missing art or metadata.
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

  return {
    SUIT_NAMES,
    SUIT_GLYPHS,
    SUIT_ELEMENTS,
    SUIT_COLORS,
    SUIT_ART,
    PLANET_NAMES,
    PLANET_GLYPHS,
    PLANET_COLORS,
    SIGN_NAMES,
    SIGN_GLYPHS,
    MAJOR_NAMES,
    MAJOR_NUMERALS,
    ARCANA_NAMES,
    ARCANA_NUMERALS,
    rankLabel,
    escapeHtml,
    normalizeTarotCard
  };
});
