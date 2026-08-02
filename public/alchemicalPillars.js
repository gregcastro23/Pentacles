// public/alchemicalPillars.js
// Pentacles — 14 Alchemical Pillars & Thermodynamic Kalchm Engine

(function(global) {
  'use strict';

  /**
   * The 14 Alchemical Pillars representing elemental transformations
   * Derived from WTEN & AAE ESMS Kalchm specifications
   */
  const ALCHEMICAL_PILLARS = [
    {
      id: 1,
      name: "Solution",
      description: "Dissolves solid matter into liquid essence, expanding Spirit & Water affinity.",
      effects: { Spirit: -1, Essence: 1, Matter: 1, Substance: -1 },
      primaryElement: "Water",
      secondaryElement: "Earth",
      tarotKeywords: ["Cups", "Queen of Cups", "2 of Cups"],
      sigil: "🜔",
      color: "#5f93d8"
    },
    {
      id: 2,
      name: "Filtration",
      description: "Separates dense impurities, purifying volatile Spirit & Air.",
      effects: { Spirit: 1, Essence: 1, Matter: -1, Substance: 1 },
      primaryElement: "Air",
      secondaryElement: "Water",
      tarotKeywords: ["Swords", "8 of Pentacles", "Temperance"],
      sigil: "🜕",
      color: "#aebbd6"
    },
    {
      id: 3,
      name: "Evaporation",
      description: "Thermal vaporisation liberating Essence & Spirit into atmospheric voltage.",
      effects: { Spirit: 1, Essence: 1, Matter: -1, Substance: -1 },
      primaryElement: "Air",
      secondaryElement: "Fire",
      tarotKeywords: ["Wands", "6 of Swords", "8 of Wands"],
      sigil: "🜖",
      color: "#f0a04b"
    },
    {
      id: 4,
      name: "Distillation",
      description: "Cycles of vapor and condensation producing hyper-pure Quintessence.",
      effects: { Spirit: 1, Essence: 1, Matter: -1, Substance: 1 },
      primaryElement: "Water",
      secondaryElement: "Air",
      tarotKeywords: ["Temperance", "The Star", "Ace of Cups"],
      sigil: "🜗",
      color: "#67d8d6"
    },
    {
      id: 5,
      name: "Separation",
      description: "Breaks complex compounds into raw elemental component forces.",
      effects: { Spirit: 1, Essence: 1, Matter: 1, Substance: -1 },
      primaryElement: "Fire",
      secondaryElement: "Water",
      tarotKeywords: ["2 of Swords", "The Tower", "Swords"],
      sigil: "🜘",
      color: "#e85f5f"
    },
    {
      id: 6,
      name: "Rectification",
      description: "Harmonious balancing and elevation of all four elemental vectors.",
      effects: { Spirit: 1, Essence: 1, Matter: 1, Substance: 1 },
      primaryElement: "Fire",
      secondaryElement: "Air",
      tarotKeywords: ["The World", "The Star", "The Sun"],
      sigil: "🜙",
      color: "#f6cf83"
    },
    {
      id: 7,
      name: "Calcination",
      description: "Intense heat reducing matter to purified alchemical ash and salt.",
      effects: { Spirit: -1, Essence: 1, Matter: 1, Substance: -1 },
      primaryElement: "Fire",
      secondaryElement: "Earth",
      tarotKeywords: ["Tower", "King of Wands", "Wands"],
      sigil: "🜂",
      color: "#db7a47"
    },
    {
      id: 8,
      name: "Comixion",
      description: "Intimate melding of earthly matter and volatile air currents.",
      effects: { Spirit: 1, Essence: -1, Matter: 1, Substance: 1 },
      primaryElement: "Earth",
      secondaryElement: "Air",
      tarotKeywords: ["3 of Cups", "10 of Pentacles", "Pentacles"],
      sigil: "🜃",
      color: "#74ab6c"
    },
    {
      id: 9,
      name: "Purification",
      description: "Exorcises dense slag, concentrating ethereal Spirit & Essence.",
      effects: { Spirit: 1, Essence: 1, Matter: -1, Substance: -1 },
      primaryElement: "Fire",
      secondaryElement: "Air",
      tarotKeywords: ["The Hermit", "Temperance", "Judgement"],
      sigil: "🜄",
      color: "#e6b3eb"
    },
    {
      id: 10,
      name: "Inhibition",
      description: "Crystalline cooling restraining chaotic reactions into solid structure.",
      effects: { Spirit: -1, Essence: -1, Matter: 1, Substance: 1 },
      primaryElement: "Earth",
      secondaryElement: "Water",
      tarotKeywords: ["4 of Pentacles", "The Hanged Man", "The Devil"],
      sigil: "🜅",
      color: "#5b8c85"
    },
    {
      id: 11,
      name: "Fermentation",
      description: "Organic micro-enzymatic transformation generating living Spirit.",
      effects: { Spirit: 1, Essence: 1, Matter: 1, Substance: -1 },
      primaryElement: "Water",
      secondaryElement: "Fire",
      tarotKeywords: ["Death", "Wheel of Fortune", "7 of Cups"],
      sigil: "🜆",
      color: "#a47bd6"
    },
    {
      id: 12,
      name: "Fixation",
      description: "Anchors volatile ethereal vapors into unshakeable physical form.",
      effects: { Spirit: -1, Essence: -1, Matter: 1, Substance: 1 },
      primaryElement: "Earth",
      secondaryElement: "Air",
      tarotKeywords: ["4 of Pentacles", "King of Pentacles", "The Emperor"],
      sigil: "🜇",
      color: "#8b9c66"
    },
    {
      id: 13,
      name: "Multiplication",
      description: "Exponential amplification of alchemical potency and yield.",
      effects: { Spirit: 1, Essence: 1, Matter: 1, Substance: -1 },
      primaryElement: "Fire",
      secondaryElement: "Water",
      tarotKeywords: ["The Sun", "3 of Wands", "Magician"],
      sigil: "🜈",
      color: "#ffc947"
    },
    {
      id: 14,
      name: "Protection",
      description: "Master culmination sealing and safeguarding the Great Work.",
      effects: { Spirit: 1, Essence: 1, Matter: 1, Substance: 1 },
      primaryElement: "Fire",
      secondaryElement: "Earth",
      tarotKeywords: ["The World", "The Magician", "High Priestess"],
      sigil: "🜉",
      color: "#ffd700"
    }
  ];

  /** Base ESMS values per tarot suit */
  const SUIT_ESMS = {
    wands: { Spirit: 4, Essence: 2, Matter: 1, Substance: 0, element: "Fire" },
    cups: { Spirit: 1, Essence: 4, Matter: 2, Substance: 1, element: "Water" },
    swords: { Spirit: 3, Essence: 1, Matter: 0, Substance: 4, element: "Air" },
    pentacles: { Spirit: 0, Essence: 1, Matter: 4, Substance: 3, element: "Earth" }
  };

  /**
   * Evaluates cards in the Manifold vessel and resolves the matching Alchemical Pillar
   */
  function resolveAlchemicalPillar(cards) {
    if (!cards || cards.length === 0) return ALCHEMICAL_PILLARS[0]; // default solution

    // Aggregate suit & element weights
    const elementScores = { Fire: 0, Water: 0, Air: 0, Earth: 0 };
    let hasMajor = false;
    let maxRank = 0;
    let minRank = 99;

    cards.forEach(c => {
      const suitKey = (c.suit || 'pentacles').toLowerCase();
      const baseEsms = SUIT_ESMS[suitKey] || SUIT_ESMS.pentacles;
      elementScores[baseEsms.element] += (c.rank || 5);

      if (c.is_major) hasMajor = true;
      if (c.rank > maxRank) maxRank = c.rank;
      if (c.rank < minRank) minRank = c.rank;
    });

    // Determine dominant & secondary elements
    const sortedElements = Object.keys(elementScores).sort((a, b) => elementScores[b] - elementScores[a]);
    const domElement = sortedElements[0];
    const secElement = sortedElements[1];

    // Card count & spread rules
    const count = cards.length;
    const rankSpread = maxRank - minRank;

    let pillarId = 1;

    if (hasMajor && count >= 3) {
      pillarId = 14; // Protection
    } else if (domElement === "Fire" && secElement === "Water") {
      pillarId = count >= 3 ? 13 : 5; // Multiplication or Separation
    } else if (domElement === "Fire" && secElement === "Earth") {
      pillarId = 7; // Calcination
    } else if (domElement === "Water" && secElement === "Air") {
      pillarId = 4; // Distillation
    } else if (domElement === "Water" && secElement === "Earth") {
      pillarId = 1; // Solution
    } else if (domElement === "Air" && secElement === "Fire") {
      pillarId = 3; // Evaporation
    } else if (domElement === "Air" && secElement === "Water") {
      pillarId = 2; // Filtration
    } else if (domElement === "Earth" && secElement === "Air") {
      pillarId = rankSpread > 5 ? 8 : 12; // Comixion or Fixation
    } else if (domElement === "Earth" && secElement === "Water") {
      pillarId = 10; // Inhibition
    } else if (domElement === "Water" && secElement === "Fire") {
      pillarId = 11; // Fermentation
    } else if (domElement === "Fire") {
      pillarId = rankSpread === 0 ? 6 : 9; // Rectification or Purification
    } else {
      pillarId = (count % 14) + 1;
    }

    return ALCHEMICAL_PILLARS.find(p => p.id === pillarId) || ALCHEMICAL_PILLARS[0];
  }

  /**
   * Calculates how well the combination of cards & resolved pillar match the character of the target zone/planet
   */
  function calculateZoneCharacterAlignment(cards, pillar, targetZoneInfo) {
    if (!cards || cards.length === 0 || !targetZoneInfo) {
      return {
        multiplier: 1.0,
        rating: "Neutral Alchemy",
        favoredSuit: targetZoneInfo?.targetSuit || "pentacles",
        zoneElement: "Earth",
        matchingCardsCount: 0
      };
    }

    const suitToElement = {
      wands: "Fire",
      cups: "Water",
      swords: "Air",
      pentacles: "Earth"
    };

    const complementaryElements = {
      Fire: "Air",
      Air: "Fire",
      Water: "Earth",
      Earth: "Water"
    };

    const favoredSuit = (targetZoneInfo.targetSuit || "pentacles").toLowerCase();
    const zoneElement = suitToElement[favoredSuit] || "Earth";
    const compElement = complementaryElements[zoneElement];

    let alignmentMult = 1.0;
    let matchingCardsCount = 0;
    let compCardsCount = 0;

    cards.forEach(c => {
      const cardSuit = (c.suit || "pentacles").toLowerCase();
      const cardElem = suitToElement[cardSuit] || "Earth";

      if (cardSuit === favoredSuit || cardElem === zoneElement) {
        matchingCardsCount++;
        alignmentMult += 0.25;
      } else if (cardElem === compElement) {
        compCardsCount++;
        alignmentMult += 0.10;
      }

      if (c.is_major) {
        alignmentMult += 0.15;
      }
    });

    // Pillar element synergy with Zone character
    if (pillar) {
      if (pillar.primaryElement === zoneElement) {
        alignmentMult += 0.35;
      } else if (pillar.secondaryElement === zoneElement) {
        alignmentMult += 0.20;
      } else if (pillar.primaryElement === compElement) {
        alignmentMult += 0.15;
      }
    }

    // Pure elemental resonance bonus if all cards match favored suit
    if (cards.length > 0 && matchingCardsCount === cards.length) {
      alignmentMult += 0.40;
    }

    const finalMultiplier = Number(Math.min(2.5, Math.max(0.8, alignmentMult)).toFixed(2));

    let rating = "Neutral Alchemy";
    if (finalMultiplier >= 2.0) {
      rating = "✦✦✦ Resonant Master Alignment";
    } else if (finalMultiplier >= 1.5) {
      rating = "✦✦ Harmonious Elemental Affinity";
    } else if (finalMultiplier >= 1.15) {
      rating = "✦ Favorable Synergy";
    } else if (finalMultiplier >= 0.95) {
      rating = "Neutral Alchemy";
    } else {
      rating = "Dissonant Vector";
    }

    return {
      multiplier: finalMultiplier,
      rating,
      favoredSuit,
      zoneElement,
      matchingCardsCount,
      compCardsCount
    };
  }

  /**
   * Calculates Kalchm thermodynamic quantities and Pentacles Yield
   */
  function calculateReactionThermodynamics(cards, pillar, targetZoneInfo) {
    if (!cards || cards.length === 0) {
      return {
        pillar: ALCHEMICAL_PILLARS[0],
        esms: { Spirit: 0, Essence: 0, Matter: 0, Substance: 0 },
        thermodynamics: { heat: 0, entropy: 0, reactivity: 0, freeEnergy: 0 },
        zoneAlignment: { multiplier: 1.0, rating: "Neutral Alchemy", favoredSuit: "pentacles", zoneElement: "Earth", matchingCardsCount: 0 },
        pentaclesYield: 0
      };
    }

    // 1. Calculate raw ESMS totals from cards
    let rawSpirit = 0, rawEssence = 0, rawMatter = 0, rawSubstance = 0;
    cards.forEach(c => {
      const suitKey = (c.suit || 'pentacles').toLowerCase();
      const base = SUIT_ESMS[suitKey] || SUIT_ESMS.pentacles;
      const rankMult = (c.rank || 5) / 5;
      const majorBonus = c.is_major ? 2.0 : 1.0;

      rawSpirit += Math.round(base.Spirit * rankMult * majorBonus);
      rawEssence += Math.round(base.Essence * rankMult * majorBonus);
      rawMatter += Math.round(base.Matter * rankMult * majorBonus);
      rawSubstance += Math.round(base.Substance * rankMult * majorBonus);
    });

    // 2. Apply Pillar transformation multipliers
    const pFx = pillar.effects;
    const transformedSpirit = Math.max(1, rawSpirit + (pFx.Spirit * 3));
    const transformedEssence = Math.max(1, rawEssence + (pFx.Essence * 3));
    const transformedMatter = Math.max(1, rawMatter + (pFx.Matter * 3));
    const transformedSubstance = Math.max(1, rawSubstance + (pFx.Substance * 3));

    // 3. Kalchm Thermodynamic equations
    const cardCount = cards.length;
    const heat = Math.round((transformedSpirit * 4.5 + transformedEssence * 3.2) * (1 + cardCount * 0.25));
    const entropy = Math.round(Math.abs(transformedSpirit - transformedMatter) * 2.8 + cardCount * 5);
    const reactivity = Number(((heat / (entropy + 8)) * (1.0 + (pillar.id % 5) * 0.15)).toFixed(2));
    const freeEnergy = Math.round(heat - (0.45 * entropy * (1 + reactivity)));

    // 4. Zone Character Alignment matching
    const zoneAlignment = calculateZoneCharacterAlignment(cards, pillar, targetZoneInfo);

    // 5. Pentacles Yield calculation
    // Base power + thermodynamic amplification + pillar synergy * zone character alignment multiplier
    const basePower = cards.reduce((acc, c) => acc + (c.effectiveAtk || c.attack || c.rank || 5), 0);
    const comboMult = 1.0 + (cardCount * 0.35); // 1.35x, 1.7x, 2.05x, 2.4x
    const rawYield = (basePower + (heat * 0.8) + (reactivity * 25)) * comboMult;
    const pentaclesYield = Math.max(15, Math.round(rawYield * zoneAlignment.multiplier));

    return {
      pillar,
      esms: {
        Spirit: transformedSpirit,
        Essence: transformedEssence,
        Matter: transformedMatter,
        Substance: transformedSubstance
      },
      thermodynamics: {
        heat,
        entropy,
        reactivity,
        freeEnergy
      },
      zoneAlignment,
      pentaclesYield
    };
  }

  // Export to global scope
  global.AlchemicalEngine = {
    ALCHEMICAL_PILLARS,
    SUIT_ESMS,
    resolveAlchemicalPillar,
    calculateZoneCharacterAlignment,
    calculateReactionThermodynamics,
    resolveReaction: function(cards, targetZoneInfo) {
      const pillar = resolveAlchemicalPillar(cards);
      return calculateReactionThermodynamics(cards, pillar, targetZoneInfo);
    }
  };

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));
