/* ============================================================
   Pentacles — The Arcana Trick Engine
   ============================================================
   Pinochle's trick-taking spine across the full 78-card Tarot deck
   (14 Minor ranks + 22 Major Arcana).

   DOM-free classic IIFE module attached to window.ArcanaTrickEngine /
   globalThis.ArcanaTrickEngine for universal browser + server/feeder execution.
   ============================================================ */
(function(global) {
  "use strict";

  // ── 22 Major Arcana Metadata ────────────────────────────────────────────────
  const ARCANA_NAMES = [
    "The Fool",          // 0
    "The Magician",      // I
    "The High Priestess",// II
    "The Empress",       // III
    "The Emperor",       // IV
    "The Hierophant",    // V
    "The Lovers",        // VI
    "The Chariot",       // VII
    "Strength",          // VIII
    "The Hermit",        // IX
    "Wheel of Fortune",  // X
    "Justice",           // XI
    "The Hanged Man",    // XII
    "Death",             // XIII
    "Temperance",        // XIV
    "The Devil",         // XV
    "The Tower",         // XVI
    "The Star",          // XVII
    "The Moon",          // XVIII
    "The Sun",           // XIX
    "Judgement",         // XX
    "The World"          // XXI
  ];

  const ARCANA_NUMERALS = [
    "0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX",
    "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX",
    "XX", "XXI"
  ];

  // Family classification: 10 Planetary Majors vs 12 Sign Majors
  const ARCANA_FAMILY = [
    "planetary", "planetary", "planetary", "planetary", "sign",
    "sign",      "sign",      "sign",      "sign",      "sign",
    "planetary", "sign",      "planetary", "sign",      "sign",
    "sign",      "planetary", "sign",      "sign",      "planetary",
    "planetary", "planetary"
  ];

  // Ruling planet index (0..9) for planetary majors, or sign index (0..11) for sign majors
  const ARCANA_RULER = [
    7, 2, 1, 3, 0, 1, 2, 3, 4, 5, 5, 6, 8, 7, 8, 9, 4, 10, 11, 0, 9, 6
  ];

  // The 3 Honours (Oudlers) worth 10 counters each; other Majors are 0 counters
  const MAJOR_HONOURS = [0, 1, 21]; // The Fool, The Magician, The World
  const EXCUSE_ARCANA = 0;          // The Fool (0)

  // ── Minor Ranks & Counter Values ──────────────────────────────────────────
  // Ladder power: Ace 14 > 10 13 > King 12 > Queen 11 > Knight 10 > Page 9 > 9..2 (8..1)
  const MINOR_TRICK_POWER = {
    1:  14, // Ace (chart ruler)
    10: 13, // 10 (outranks King)
    14: 12, // King
    13: 11, // Queen
    12: 10, // Knight (Jack)
    11: 9,  // Page
    9:  8,
    8:  7,
    7:  6,
    6:  5,
    5:  4,
    4:  3,
    3:  2,
    2:  1
  };

  const COUNTER_VALUES = {
    1:  10, // Ace
    10: 10, // 10
    14: 10, // King
    13: 0,  // Queen
    12: 0,  // Knight
    11: 0,  // Page
    9:  0,
    8:  0,
    7:  0,
    6:  0,
    5:  0,
    4:  0,
    3:  0,
    2:  0
  };

  // ── Essential Dignity Scoring (Ptolemy / Lilly ±5 Scale) ──────────────────
  const SIGN_RULERS = [4, 3, 2, 1, 0, 2, 3, 9, 5, 6, 7, 8];
  const DOMICILES = [
    [4], [3], [2, 5], [1, 6], [0, 7], [8, 11], [9, 10], [10], [11], [7]
  ];
  const EXALTATIONS = [0, 1, 5, 11, 9, 3, 6, 7, 3, 4];
  const DETRIMENTS = DOMICILES.map(signs => signs.map(s => (s + 6) % 12));
  const FALLS = EXALTATIONS.map(s => s !== null ? (s + 6) % 12 : null);

  function getDignityScore(body, sign) {
    const b = ((Number(body) | 0) % 10 + 10) % 10;
    const s = ((Number(sign) | 0) % 12 + 12) % 12;
    if (DOMICILES[b] && DOMICILES[b].includes(s)) return 5;
    if (EXALTATIONS[b] === s) return 3;
    if (DETRIMENTS[b] && DETRIMENTS[b].includes(s)) return -3;
    if (FALLS[b] === s) return -5;
    return 0;
  }

  function getDignityType(body, sign) {
    const b = ((Number(body) | 0) % 10 + 10) % 10;
    const s = ((Number(sign) | 0) % 12 + 12) % 12;
    if (DOMICILES[b] && DOMICILES[b].includes(s)) return "Domicile";
    if (EXALTATIONS[b] === s) return "Exaltation";
    if (DETRIMENTS[b] && DETRIMENTS[b].includes(s)) return "Detriment";
    if (FALLS[b] === s) return "Fall";
    return "Neutral";
  }

  // ── Arcana Potency Calculator (1..100) ────────────────────────────────────
  /**
   * Computes the live 22-Major Potency ladder frozen for a melee.
   * @param {Array<{body:number, sign:number, retrograde?:boolean, up?:boolean}>} planets
   * @param {Float64Array|Array<number>|null} signVector
   * @returns {Object<number, number>} Map of arcana index 0..21 → potency 1..100
   */
  function buildArcanaLadder(planets = [], signVector = null) {
    const ladder = {};

    // Count live transit occupancy per sign (0..10 bodies)
    const occupancy = new Array(12).fill(0);
    const planetMap = {};
    for (const p of planets) {
      if (p && p.body !== undefined) {
        const b = Number(p.body);
        const s = ((Number(p.sign) % 12) + 12) % 12;
        planetMap[b] = p;
        if (b < 10) occupancy[s]++;
      }
    }

    // Default uniform sign vector if not provided
    const charVec = signVector && signVector.length === 12
      ? signVector
      : new Array(12).fill(100 / 12);

    for (let arcana = 0; arcana < 22; arcana++) {
      const family = ARCANA_FAMILY[arcana];

      if (family === "planetary") {
        // Find transiting body index
        // Mapping: 0:7(Uranus), 1:2(Merc), 2:1(Moon), 3:3(Venus), 10:5(Jup), 12:8(Nept), 16:4(Mars), 19:0(Sun), 20:9(Pluto), 21:6(Saturn)
        const planetBodyByArcana = {
          0: 7, 1: 2, 2: 1, 3: 3, 10: 5, 12: 8, 16: 4, 19: 0, 20: 9, 21: 6
        };
        const b = planetBodyByArcana[arcana] !== undefined ? planetBodyByArcana[arcana] : 0;
        const p = planetMap[b] || { body: b, sign: DOMICILES[b]?.[0] || 0, retrograde: false, up: true };
        const s = ((Number(p.sign) % 12) + 12) % 12;

        const dig = getDignityScore(b, s);
        const isRetro = !!p.retrograde;
        const isUp = p.up !== false;
        // Reception: received = 0.5, mutual = 1.5
        let reception = 0;
        const rulerOfSign = SIGN_RULERS[s];
        if (rulerOfSign !== b) {
          reception = 0.5;
          const otherPlanet = planetMap[rulerOfSign];
          if (otherPlanet) {
            const otherSign = ((Number(otherPlanet.sign) % 12) + 12) % 12;
            if (SIGN_RULERS[otherSign] === b) reception = 1.5;
          }
        }

        let raw = 50 + (5 * dig) + (5 * reception) - (isRetro ? 8 : 0) + (isUp ? 3 : 0);
        ladder[arcana] = Math.max(1, Math.min(100, Math.round(raw)));
      } else {
        // Sign Major (IV:0 Aries .. XVIII:11 Pisces)
        const signByArcana = {
          4: 0,  // Emperor: Aries
          5: 1,  // Hierophant: Taurus
          6: 2,  // Lovers: Gemini
          7: 3,  // Chariot: Cancer
          8: 4,  // Strength: Leo
          9: 5,  // Hermit: Virgo
          11: 6, // Justice: Libra
          13: 7, // Death: Scorpio
          14: 8, // Temperance: Sagittarius
          15: 9, // Devil: Capricorn
          17: 10,// Star: Aquarius
          18: 11 // Moon: Pisces
        };
        const s = signByArcana[arcana] !== undefined ? signByArcana[arcana] : 0;
        const occ = occupancy[s] || 0;
        const charVal = Number(charVec[s]) || 0;

        let raw = 20 + (9 * occ) + (0.35 * charVal);
        ladder[arcana] = Math.max(1, Math.min(100, Math.round(raw)));
      }
    }

    return ladder;
  }

  // ── Trick Power & Counter Value Helpers ────────────────────────────────────
  /** A Major's frozen Arcana Potency, defaulting to the mid-ladder 50. */
  function potencyOf(card, ladder = {}) {
    const i = Number(card && card.rank);
    return ladder[i] !== undefined ? ladder[i] : 50;
  }

  function power(card, trumpSuit, ladder = {}) {
    if (!card) return 0;
    if (card.is_major) {
      const arcanaIdx = Number(card.rank);
      const potency = ladder[arcanaIdx] !== undefined ? ladder[arcanaIdx] : 50;
      // Majors are the Supreme category: 1000 base + potency * 10 + arcana index for tie-break
      return 1000 + (potency * 10) + arcanaIdx;
    }

    const rankPower = MINOR_TRICK_POWER[card.rank] || 0;
    if (trumpSuit && card.suit && card.suit.toLowerCase() === trumpSuit.toLowerCase()) {
      return 500 + rankPower; // Trump Minor beats any non-trump minor
    }
    return rankPower;
  }

  function counterValue(card) {
    if (!card) return 0;
    if (card.is_major) {
      const arcanaIdx = Number(card.rank);
      if (MAJOR_HONOURS.includes(arcanaIdx)) {
        return card.inverted ? 5 : 10;
      }
      return 0;
    }
    const val = COUNTER_VALUES[card.rank] || 0;
    if (val > 0 && card.inverted) return 5;
    return val;
  }

  // ── Legality Filter (Strict Priority Rules) ────────────────────────────────
  /**
   * Evaluates the legal moves for a player's hand given the trick state.
   * @param {Array<Object>} hand        Cards in the player's active hand
   * @param {string|null} ledSuit       Suit of the first card in the trick (or null if lead)
   * @param {string} trumpSuit          Dominant Zone Trump minor suit
   * @param {Array<Object>} currentTrick Cards played so far in this trick [{ player, card, order }]
   * @param {Object} ladder             Frozen Arcana Potency ladder
   * @returns {Array<{card:Object, legal:boolean, reason?:string}>}
   */
  function getLegalMoves(hand = [], ledSuit = null, trumpSuit = "wands", currentTrick = [], ladder = {}) {
    if (!Array.isArray(hand) || hand.length === 0) return [];
    trumpSuit = (trumpSuit || "wands").toLowerCase();

    // 1. The Lead: any card in hand is legal
    if (!currentTrick || currentTrick.length === 0) {
      return hand.map(card => ({ card, legal: true }));
    }

    const firstPlay = currentTrick[0].card;
    const isMajorLead = !!firstPlay.is_major;
    const actualLedSuit = isMajorLead ? null : (ledSuit || firstPlay.suit || "").toLowerCase();

    // Find the current winning play in the trick
    let highestPower = -1;
    let winningCard = null;
    for (const play of currentTrick) {
      const pwr = power(play.card, trumpSuit, ladder);
      // The Fool (0) never has trick-taking power
      if (play.card.is_major && Number(play.card.rank) === EXCUSE_ARCANA) continue;
      if (pwr > highestPower) {
        highestPower = pwr;
        winningCard = play.card;
      }
    }

    // Partition hand into minors and majors
    const minors = hand.filter(c => !c.is_major);
    const majors = hand.filter(c => c.is_major);
    const ledMinors = actualLedSuit ? minors.filter(c => c.suit && c.suit.toLowerCase() === actualLedSuit) : [];
    const trumpMinors = minors.filter(c => c.suit && c.suit.toLowerCase() === trumpSuit);

    return hand.map(card => {
      // The Fool (0) is The Excuse: ALWAYS legal at any time, overriding all rules
      if (card.is_major && Number(card.rank) === EXCUSE_ARCANA) {
        return { card, legal: true };
      }

      // ── SCENARIO 1: A Major Arcana was led (Arcana Lead) ─────────────────
      // No minor belongs to the Arcana category, so every player is void in the
      // led "suit" by definition. Nothing is compelled here:
      //   · A minor is ALWAYS a legal slough. Forcing a trump minor would burn
      //     trump on a trick no minor can win, and forcing a Major would strip
      //     a player's Arcana onto a zero-counter trick — the exact failure the
      //     "permitted, never compelled" rule exists to prevent.
      //   · A player who CHOOSES to contest with a Major must contest properly:
      //     beat the Major currently winning, if they hold one that can.
      if (isMajorLead) {
        if (!card.is_major) return { card, legal: true };

        if (winningCard && winningCard.is_major) {
          const winPotency = potencyOf(winningCard, ladder);
          const winRank = Number(winningCard.rank);
          const beats = (pot, rank) => pot > winPotency || (pot === winPotency && rank > winRank);
          const canBeat = beats(potencyOf(card, ladder), Number(card.rank));
          // The Excuse can never win a trick, so it is never a Major that
          // "could have beaten" the winner — mirrors the minor-led branch below.
          const hasHigher = majors.some(m => {
            if (Number(m.rank) === EXCUSE_ARCANA) return false;
            return beats(potencyOf(m, ladder), Number(m.rank));
          });
          if (hasHigher && !canBeat) {
            return { card, legal: false, reason: `Must beat ${winningCard.title || 'high Major'}` };
          }
        }
        return { card, legal: true };
      }

      // ── SCENARIO 2: A Minor Suit was led ─────────────────────────────────
      const cSuit = card.suit ? card.suit.toLowerCase() : "";

      // Rule 1: Must Follow Suit (Minors only)
      if (ledMinors.length > 0) {
        // Holding minors of led suit -> MUST play a Minor of led suit! Majors are NOT legal.
        if (card.is_major) {
          return { card, legal: false, reason: `Must follow led suit (${actualLedSuit})` };
        }
        if (cSuit !== actualLedSuit) {
          return { card, legal: false, reason: `Must follow led suit (${actualLedSuit})` };
        }

        // Rule 2: Must Win (Upcard Rule) if following suit and winning card is of led suit
        if (winningCard && !winningCard.is_major && winningCard.suit && winningCard.suit.toLowerCase() === actualLedSuit) {
          const cardRankPower = MINOR_TRICK_POWER[card.rank] || 0;
          const winRankPower = MINOR_TRICK_POWER[winningCard.rank] || 0;
          const hasHigherMinor = ledMinors.some(m => (MINOR_TRICK_POWER[m.rank] || 0) > winRankPower);
          if (hasHigherMinor && cardRankPower <= winRankPower) {
            return { card, legal: false, reason: `Must beat ${winningCard.title || 'high card'}` };
          }
        }
        return { card, legal: true };
      }

      // ── Void in led Minor suit ───────────────────────────────────────────
      // Rule 3: Must Trump if player holds Trump minors, OR may play any Major
      if (card.is_major) {
        // Majors are universal trumps, permitted at any time when void in led suit
        if (winningCard && winningCard.is_major) {
          const cardPotency = potencyOf(card, ladder);
          const winPotency = potencyOf(winningCard, ladder);
          const canBeat = cardPotency > winPotency || (cardPotency === winPotency && Number(card.rank) > Number(winningCard.rank));
          const hasHigherMajor = majors.some(m => {
            if (Number(m.rank) === EXCUSE_ARCANA) return false;
            return potencyOf(m, ladder) > winPotency
              || (potencyOf(m, ladder) === winPotency && Number(m.rank) > Number(winningCard.rank));
          });
          if (hasHigherMajor && !canBeat) {
            return { card, legal: false, reason: `Must beat ${winningCard.title || 'high Major'}` };
          }
        }
        return { card, legal: true };
      }

      // Minor Card when void in led suit:
      if (trumpMinors.length > 0) {
        // Holding trump minors
        if (cSuit === trumpSuit) {
          // Rule 4: Must Over-Trump if winning card is also a trump minor
          if (winningCard && !winningCard.is_major && winningCard.suit && winningCard.suit.toLowerCase() === trumpSuit) {
            const cardRankPower = MINOR_TRICK_POWER[card.rank] || 0;
            const winRankPower = MINOR_TRICK_POWER[winningCard.rank] || 0;
            const hasHigherTrump = trumpMinors.some(t => (MINOR_TRICK_POWER[t.rank] || 0) > winRankPower);
            if (hasHigherTrump && cardRankPower <= winRankPower) {
              return { card, legal: false, reason: `Must beat ${winningCard.title || 'high Trump'}` };
            }
          }
          return { card, legal: true };
        } else {
          // Non-trump minor when player holds trump minors: only legal if player also holds majors, but since trump is required when holding trump minors:
          return { card, legal: false, reason: `Must play Trump (${trumpSuit}) or Major Arcana` };
        }
      }

      // Rule 5: Sloughing — void in led suit and void in trump minors -> free to discard any minor!
      return { card, legal: true };
    });
  }

  // ── Trick Evaluation ───────────────────────────────────────────────────────
  /**
   * Resolves the winner and harvested counters of a completed trick.
   * @param {Array<{player:string|number, card:Object, order?:number}>} currentTrick
   * @param {string} trumpSuit
   * @param {Object} ladder
   * @param {number} trickNumber (1..12)
   * @returns {{winner:string|number, winningCard:Object, capturedCards:Array<Object>, counters:number, excusePlayer?:string|number}}
   */
  function evaluateTrick(currentTrick = [], trumpSuit = "wands", ladder = {}, trickNumber = 1) {
    if (!Array.isArray(currentTrick) || currentTrick.length === 0) {
      return { winner: null, winningCard: null, capturedCards: [], counters: 0 };
    }
    trumpSuit = (trumpSuit || "wands").toLowerCase();

    let winningIndex = 0;
    let highestPwr = -1;
    let excusePlayer = null;
    const capturedCards = [];
    let counters = 0;

    for (let i = 0; i < currentTrick.length; i++) {
      const play = currentTrick[i];
      const card = play.card;

      // Handle The Fool (0) / The Excuse
      if (card.is_major && Number(card.rank) === EXCUSE_ARCANA) {
        excusePlayer = play.player;
        continue; // Does not compete for trick power, goes to owner
      }

      capturedCards.push(card);
      counters += counterValue(card);

      const pwr = power(card, trumpSuit, ladder);
      if (pwr > highestPwr) {
        highestPwr = pwr;
        winningIndex = i;
      }
    }

    const winnerPlay = currentTrick[winningIndex];
    const winner = winnerPlay ? winnerPlay.player : currentTrick[0].player;
    const winningCard = winnerPlay ? winnerPlay.card : currentTrick[0].card;

    // Final Trick Climax Bonus (+10 points on trick 12)
    if (trickNumber === 12) {
      counters += 10;
    }

    return {
      winner,
      winningCard,
      capturedCards,
      counters,
      excusePlayer,
      climaxBonus: trickNumber === 12 ? 10 : 0
    };
  }

  // ── Melds Detection ────────────────────────────────────────────────────────
  /**
   * Detects the 8 canonical Tarot Melds from a player's starting hand.
   * @param {Array<Object>} hand
   * @param {string} trumpSuit
   * @param {Object} ladder
   * @returns {Array<{id:string, name:string, cards:Array<Object>, value:number}>}
   */
  function detectMelds(hand = [], trumpSuit = "wands", ladder = {}) {
    const melds = [];
    if (!Array.isArray(hand) || hand.length === 0) return melds;
    trumpSuit = (trumpSuit || "wands").toLowerCase();

    const minors = hand.filter(c => !c.is_major);
    const majors = hand.filter(c => c.is_major);

    // Group minors by suit
    const suitMap = { wands: [], cups: [], swords: [], pentacles: [] };
    for (const c of minors) {
      const s = c.suit ? c.suit.toLowerCase() : "wands";
      if (suitMap[s]) suitMap[s].push(c);
    }

    // 1. Marriage: King (14) + Queen (13) of a suit (20 pts, 40 in Trump)
    for (const s of Object.keys(suitMap)) {
      const kings = suitMap[s].filter(c => Number(c.rank) === 14);
      const queens = suitMap[s].filter(c => Number(c.rank) === 13);
      if (kings.length > 0 && queens.length > 0) {
        const isTrump = s === trumpSuit;
        melds.push({
          id: `marriage_${s}`,
          name: isTrump ? `Royal Marriage in ${s.toUpperCase()} (Trump)` : `Marriage in ${s.toUpperCase()}`,
          cards: [kings[0], queens[0]],
          value: isTrump ? 40 : 20
        });
      }
    }

    // 2. Pinochle: Queen of Swords + Knight of Pentacles (40 pts)
    const swordQueens = (suitMap.swords || []).filter(c => Number(c.rank) === 13);
    const pentKnights = (suitMap.pentacles || []).filter(c => Number(c.rank) === 12);
    if (swordQueens.length > 0 && pentKnights.length > 0) {
      melds.push({
        id: "pinochle",
        name: "Pinochle (Queen of Swords + Knight of Pentacles)",
        cards: [swordQueens[0], pentKnights[0]],
        value: 40
      });
    }

    // 3. Full Court: Page (11) + Knight (12) + Queen (13) + King (14) of one suit (60 pts)
    for (const s of Object.keys(suitMap)) {
      const pages = suitMap[s].filter(c => Number(c.rank) === 11);
      const knights = suitMap[s].filter(c => Number(c.rank) === 12);
      const queens = suitMap[s].filter(c => Number(c.rank) === 13);
      const kings = suitMap[s].filter(c => Number(c.rank) === 14);
      if (pages.length > 0 && knights.length > 0 && queens.length > 0 && kings.length > 0) {
        melds.push({
          id: `full_court_${s}`,
          name: `Full Court of ${s.toUpperCase()}`,
          cards: [pages[0], knights[0], queens[0], kings[0]],
          value: 60
        });
      }
    }

    // 4. Decan Trine: The 3 decan pips of one sign (40 pts)
    // Signs 0..11: Cardinal (2,3,4), Fixed (5,6,7), Mutable (8,9,10)
    // Suit triplicity: 0:wands, 1:pentacles, 2:swords, 3:cups
    const DECAN_TRINES = [
      { sign: "Aries", suit: "wands", ranks: [2, 3, 4] },
      { sign: "Taurus", suit: "pentacles", ranks: [5, 6, 7] },
      { sign: "Gemini", suit: "swords", ranks: [8, 9, 10] },
      { sign: "Cancer", suit: "cups", ranks: [2, 3, 4] },
      { sign: "Leo", suit: "wands", ranks: [5, 6, 7] },
      { sign: "Virgo", suit: "pentacles", ranks: [8, 9, 10] },
      { sign: "Libra", suit: "swords", ranks: [2, 3, 4] },
      { sign: "Scorpio", suit: "cups", ranks: [5, 6, 7] },
      { sign: "Sagittarius", suit: "wands", ranks: [8, 9, 10] },
      { sign: "Capricorn", suit: "pentacles", ranks: [2, 3, 4] },
      { sign: "Aquarius", suit: "swords", ranks: [5, 6, 7] },
      { sign: "Pisces", suit: "cups", ranks: [8, 9, 10] }
    ];

    for (const dt of DECAN_TRINES) {
      const inSuit = suitMap[dt.suit] || [];
      const c1 = inSuit.find(c => Number(c.rank) === dt.ranks[0]);
      const c2 = inSuit.find(c => Number(c.rank) === dt.ranks[1]);
      const c3 = inSuit.find(c => Number(c.rank) === dt.ranks[2]);
      if (c1 && c2 && c3) {
        melds.push({
          id: `decan_trine_${dt.sign.toLowerCase()}`,
          name: `Decan Trine of ${dt.sign} (${dt.ranks.join('·')} ${dt.suit.toUpperCase()})`,
          cards: [c1, c2, c3],
          value: 40
        });
      }
    }

    // 5. Grand Cross: The Ace (1) of all four suits (100 pts)
    const aceW = (suitMap.wands || []).find(c => Number(c.rank) === 1);
    const aceC = (suitMap.cups || []).find(c => Number(c.rank) === 1);
    const aceS = (suitMap.swords || []).find(c => Number(c.rank) === 1);
    const aceP = (suitMap.pentacles || []).find(c => Number(c.rank) === 1);
    if (aceW && aceC && aceS && aceP) {
      melds.push({
        id: "grand_cross",
        name: "Grand Cross (Aces of all 4 Elemental Suits)",
        cards: [aceW, aceC, aceS, aceP],
        value: 100
      });
    }

    // 6. Arcana Trine: Any three Major Arcana (50 pts)
    if (majors.length >= 3) {
      melds.push({
        id: "arcana_trine",
        name: "Arcana Trine (Three Major Arcana)",
        cards: majors.slice(0, 3),
        value: 50
      });
    }

    // 7. The Great Work: The Fool (0) + The Magician (I) + The World (XXI) (100 pts)
    const fool = majors.find(c => Number(c.rank) === 0);
    const magician = majors.find(c => Number(c.rank) === 1);
    const world = majors.find(c => Number(c.rank) === 21);
    if (fool && magician && world) {
      melds.push({
        id: "the_great_work",
        name: "The Great Work (The Fool + The Magician + The World)",
        cards: [fool, magician, world],
        value: 100
      });
    }

    // 8. Dignified Trine: Three Majors each at Potency >= 60 (75 pts)
    const dignifiedMajors = majors.filter(c => {
      const pot = ladder[Number(c.rank)] !== undefined ? ladder[Number(c.rank)] : 50;
      return pot >= 60;
    });
    if (dignifiedMajors.length >= 3) {
      melds.push({
        id: "dignified_trine",
        name: "Dignified Trine (Three Majors with Potency ≥ 60)",
        cards: dignifiedMajors.slice(0, 3),
        value: 75
      });
    }

    return melds;
  }

  // ── Guardian / Agent AI ───────────────────────────────────────────────────
  const GuardianAI = {
    /**
     * Chooses the optimal legal card to play from an agent's hand.
     */
    choose(hand, ledSuit, trumpSuit, currentTrick = [], ladder = {}) {
      const legalOptions = getLegalMoves(hand, ledSuit, trumpSuit, currentTrick, ladder)
        .filter(opt => opt.legal)
        .map(opt => opt.card);

      if (legalOptions.length === 0) return hand[0] || null;
      if (legalOptions.length === 1) return legalOptions[0];

      // Leading: currentTrick is empty
      if (currentTrick.length === 0) {
        // If holding Side Aces (non-trump Ace = 10 pts), lead them to harvest
        const sideAces = legalOptions.filter(c => !c.is_major && Number(c.rank) === 1 && c.suit.toLowerCase() !== trumpSuit.toLowerCase());
        if (sideAces.length > 0) return sideAces[0];

        // If strong in Trumps, lead Trump Ace / 10 to strip trumps
        const trumpCounters = legalOptions.filter(c => !c.is_major && (Number(c.rank) === 1 || Number(c.rank) === 10) && c.suit.toLowerCase() === trumpSuit.toLowerCase());
        if (trumpCounters.length > 0 && Math.random() < 0.6) return trumpCounters[0];

        // Otherwise lead a low probe card (9, Page, 2..5)
        const lowProbes = legalOptions.filter(c => !c.is_major && Number(c.rank) <= 11 && Number(c.rank) !== 1 && Number(c.rank) !== 10);
        if (lowProbes.length > 0) {
          lowProbes.sort((a, b) => (MINOR_TRICK_POWER[a.rank] || 0) - (MINOR_TRICK_POWER[b.rank] || 0));
          return lowProbes[0];
        }

        // Return lowest power card
        legalOptions.sort((a, b) => power(a, trumpSuit, ladder) - power(b, trumpSuit, ladder));
        return legalOptions[0];
      }

      // Following
      // Determine current highest power on table
      let highestPower = -1;
      let potPoints = 0;
      for (const p of currentTrick) {
        if (!p.card.is_major || Number(p.card.rank) !== EXCUSE_ARCANA) {
          const pwr = power(p.card, trumpSuit, ladder);
          if (pwr > highestPower) highestPower = pwr;
        }
        potPoints += counterValue(p.card);
      }

      const winningMoves = legalOptions.filter(c => {
        if (c.is_major && Number(c.rank) === EXCUSE_ARCANA) return false;
        return power(c, trumpSuit, ladder) > highestPower;
      });

      if (winningMoves.length > 0) {
        // If winning, spend the WEAKEST sufficient winning card to conserve power
        winningMoves.sort((a, b) => power(a, trumpSuit, ladder) - power(b, trumpSuit, ladder));
        return winningMoves[0];
      }

      // Cannot win trick: dump lowest 0-point junk
      const zeroPointers = legalOptions.filter(c => counterValue(c) === 0 && (!c.is_major || Number(c.rank) === EXCUSE_ARCANA));
      if (zeroPointers.length > 0) {
        zeroPointers.sort((a, b) => power(a, trumpSuit, ladder) - power(b, trumpSuit, ladder));
        return zeroPointers[0];
      }

      // Must discard a counter: discard lowest value
      legalOptions.sort((a, b) => power(a, trumpSuit, ladder) - power(b, trumpSuit, ladder));
      return legalOptions[0];
    }
  };

  // ── Melee State Generator ──────────────────────────────────────────────────
  function createMelee(targetType, targetId, playerHand = [], zoneData = {}, sky = {}) {
    const zoneId = targetType === "zone" ? Number(targetId) : (zoneData.zone_id || 0);
    const signIdx = zoneId % 12;
    const SIGN_SUITS = ["wands", "pentacles", "swords", "cups", "wands", "pentacles", "swords", "cups", "wands", "pentacles", "swords", "cups"];
    const trumpSuit = SIGN_SUITS[signIdx] || "wands";

    const planets = sky.planets || [];
    const signVector = sky.signVector || null;
    const arcanaLadder = buildArcanaLadder(planets, signVector);

    // Limit player hand to 12 cards (up to 9 minors + at most 3 majors)
    const pMinors = playerHand.filter(c => !c.is_major);
    const pMajors = playerHand.filter(c => c.is_major);
    const chosenMinors = pMinors.slice(0, 9);
    const chosenMajors = pMajors.slice(0, 3);
    let hand = [...chosenMinors, ...chosenMajors];
    if (hand.length < 12 && pMinors.length > 9) {
      hand = [...hand, ...pMinors.slice(9, 12 - hand.length)];
    }

    // Guardian Deck: synthesized from the zone's decans and planetary ruler
    const guardianHand = [];
    const decanRanks = [2 + (signIdx % 3) * 3, 3 + (signIdx % 3) * 3, 4 + (signIdx % 3) * 3];
    for (let i = 0; i < 12; i++) {
      const isMaj = i === 11;
      const rank = isMaj ? (signIdx + 4) % 22 : (i < 3 ? decanRanks[i] : (i === 3 ? 1 : (i < 7 ? 10 + (i - 4) : 9)));
      guardianHand.push({
        card_id: 90000000 + i,
        suit: isMaj ? trumpSuit : (i % 2 === 0 ? trumpSuit : SIGN_SUITS[(signIdx + i) % 12]),
        rank: rank,
        is_major: isMaj,
        title: isMaj ? ARCANA_NAMES[rank] : `Guardian ${rank} of ${trumpSuit}`
      });
    }

    const playerMelds = detectMelds(hand, trumpSuit, arcanaLadder);
    const guardianMelds = detectMelds(guardianHand, trumpSuit, arcanaLadder);

    const playerMeldScore = playerMelds.reduce((sum, m) => sum + m.value, 0);
    const guardianMeldScore = guardianMelds.reduce((sum, m) => sum + m.value, 0);

    const HANDICAPS = [0, 0, 0, 0, 0, 20, 20, 20, 20, 20, 40]; // 0-4 Houses, 5-9 Spires, 10 Crown
    const guardianHandicap = targetType === "planet" ? (10 * targetId) : (HANDICAPS[zoneId] || 0);

    return {
      targetType,
      targetId,
      zoneId,
      trumpSuit,
      arcanaLadder,
      trickNumber: 1,
      totalTricks: 12,
      leader: "player",
      currentTurn: "player",
      ledSuit: null,
      currentTrick: [],
      playerHand: hand,
      guardianHand,
      playerMelds,
      guardianMelds,
      playerScore: playerMeldScore,
      guardianScore: guardianMeldScore + guardianHandicap,
      guardianHandicap,
      playerTricksWon: 0,
      guardianTricksWon: 0,
      playerHarvestPile: [],
      guardianHarvestPile: [],
      excuseSpent: { player: false, guardian: false },
      log: [`Melee commenced in Zone ${zoneId} (${trumpSuit.toUpperCase()} Trump). Guardian handicap: +${guardianHandicap} pts.`],
      status: "active",
      outcome: null
    };
  }

  // ── Zone Access & Claim Functions ──────────────────────────────────────────
  function canAccessZone(zoneId, faction, zoneOwners) {
    if (zoneId < 0 || zoneId > 10) return false;
    const owns = (z) => zoneOwners && zoneOwners[z] === faction;
    if (zoneId < 5) return true;
    if (zoneId < 10) {
      const spireIdx = zoneId - 5;
      return owns(spireIdx) || owns((spireIdx + 4) % 5);
    }
    let ownedSpires = 0;
    for (let s = 5; s < 10; s++) {
      if (owns(s)) ownedSpires++;
    }
    return ownedSpires >= 2;
  }

  const SIGN_SUITS_LIST = ["wands", "pentacles", "swords", "cups", "wands", "pentacles", "swords", "cups", "wands", "pentacles", "swords", "cups"];
  const zoneSign = (zoneId) => ((zoneId % 12) + 12) % 12;
  const zoneTrump = (zoneId) => SIGN_SUITS_LIST[zoneSign(zoneId)];

  function opportunity(zone, faction) {
    let o = 0;
    if (!zone) return 0;
    if (zone.inFlux) o += 0.4;
    if (zone.control < 200) o += 0.3;
    if (zone.owner !== null && zone.owner !== faction) o += 0.3;
    return o;
  }

  function trumpDepth(activeCards = [], zoneId = 0) {
    const minors = (activeCards || []).filter((c) => !c.is_major);
    if (!minors.length) return 0;
    const trump = zoneTrump(zoneId);
    return minors.filter((c) => (c.suit || "").toLowerCase() === trump).length / minors.length;
  }

  function computeClaim(agent, zoneId, zone, zoneOwners) {
    if (!agent || !canAccessZone(zoneId, agent.faction, zoneOwners)) return 0;
    const sign = zoneSign(zoneId);
    const signVec = agent.signVector || [];
    const raw =
      35 * ((signVec[sign] ?? 0) / 100) +
      4 * getDignityScore(agent.faction, sign) +
      20 * trumpDepth(agent.active, zoneId) +
      15 * opportunity(zone, agent.faction) -
      8 * (agent.rested ? 1 : 0);
    return Math.max(0, Math.min(100, Math.round(raw)));
  }

  function restIsWaived(rosterSize, reachableZones) {
    return rosterSize <= reachableZones;
  }

  function chooseChampions(agents = [], zones = [], zoneOwners = []) {
    const claims = [];
    for (const agent of agents) {
      for (const z of zones) {
        const claim = computeClaim(agent, z.zoneId, z, zoneOwners);
        if (claim > 0) claims.push({ agent, zoneId: z.zoneId, claim });
      }
    }
    claims.sort((a, b) => b.claim - a.claim || a.agent.identity.localeCompare(b.agent.identity));

    const seated = new Set();
    const byZone = new Map();
    for (const c of claims) {
      if (seated.has(c.agent.identity)) continue;
      const seats = byZone.get(c.zoneId) ?? [];
      if (seats.length >= 6) continue;
      if (seats.some((s) => s.faction === c.agent.faction)) continue;
      seats.push({ faction: c.agent.faction, occupant: c.agent.identity, handle: c.agent.handle, claim: c.claim });
      byZone.set(c.zoneId, seats);
      seated.add(c.agent.identity);
    }

    const plans = [];
    for (const [zoneId, seats] of [...byZone.entries()].sort((a, b) => a[0] - b[0])) {
      if (seats.length < 2) continue;
      plans.push({ zoneId, trumpSuit: zoneTrump(zoneId), seats });
    }
    return plans;
  }

  function seatOrder(factions = [], planetLon = []) {
    return [...factions].sort((a, b) => (planetLon[a] ?? 0) - (planetLon[b] ?? 0) || a - b);
  }

  // ── 10 Astrological Combat Archetypes ──────────────────────────────────────
  function archetypeMovePicker(faction, hand, ledSuit, trick = [], ladder = {}, trickNumber = 1) {
    const trumpSuit = (trick.length > 0 && trick[0].card && trick[0].card.suit) || "wands";
    const legalOptions = getLegalMoves(hand, ledSuit, trumpSuit, trick, ladder)
      .filter((m) => m.legal)
      .map((m) => m.card);

    if (!legalOptions.length) return (hand && hand[0]) ?? null;
    if (legalOptions.length === 1) return legalOptions[0];

    const isLead = trick.length === 0;

    let potPoints = 0;
    let highestPower = -1;
    for (const p of trick) {
      if (!p.card.is_major || Number(p.card.rank) !== EXCUSE_ARCANA) {
        const pwr = power(p.card, trumpSuit, ladder);
        if (pwr > highestPower) highestPower = pwr;
      }
      potPoints += counterValue(p.card);
    }

    const winningMoves = legalOptions.filter((c) => {
      if (c.is_major && Number(c.rank) === EXCUSE_ARCANA) return false;
      return power(c, trumpSuit, ladder) > highestPower;
    });

    switch (faction) {
      case 0: { // 0: Sun (Radiance)
        if (isLead) {
          const trumps = legalOptions.filter(
            (c) => (c.suit || "").toLowerCase() === trumpSuit.toLowerCase() || c.is_major
          );
          if (trumps.length > 0) {
            trumps.sort((a, b) => power(b, trumpSuit, ladder) - power(a, trumpSuit, ladder));
            return trumps[0];
          }
        } else if (potPoints >= 10 && winningMoves.length > 0) {
          winningMoves.sort((a, b) => power(b, trumpSuit, ladder) - power(a, trumpSuit, ladder));
          return winningMoves[0];
        }
        break;
      }
      case 1: { // 1: Moon (Tides)
        if (!isLead) {
          if (potPoints >= 10 && winningMoves.length > 0) {
            winningMoves.sort((a, b) => power(a, trumpSuit, ladder) - power(b, trumpSuit, ladder));
            return winningMoves[0];
          }
        }
        break;
      }
      case 2: { // 2: Mercury (Quicksilver)
        if (isLead) {
          const probes = legalOptions.filter((c) => !c.is_major && Number(c.rank) <= 9 && Number(c.rank) >= 2);
          if (probes.length > 0) {
            probes.sort((a, b) => (MINOR_TRICK_POWER[a.rank] || 0) - (MINOR_TRICK_POWER[b.rank] || 0));
            return probes[0];
          }
        } else if (winningMoves.length > 0) {
          winningMoves.sort((a, b) => power(a, trumpSuit, ladder) - power(b, trumpSuit, ladder));
          return winningMoves[0];
        }
        break;
      }
      case 3: { // 3: Venus (Concord)
        if (isLead) {
          const sideMinors = legalOptions.filter(
            (c) => !c.is_major && (c.suit || "").toLowerCase() !== trumpSuit.toLowerCase()
          );
          if (sideMinors.length > 0) {
            sideMinors.sort((a, b) => (MINOR_TRICK_POWER[b.rank] || 0) - (MINOR_TRICK_POWER[a.rank] || 0));
            return sideMinors[0];
          }
        }
        break;
      }
      case 4: { // 4: Mars (Onslaught)
        if (isLead) {
          legalOptions.sort((a, b) => power(b, trumpSuit, ladder) - power(a, trumpSuit, ladder));
          return legalOptions[0];
        } else if (winningMoves.length > 0) {
          winningMoves.sort((a, b) => power(b, trumpSuit, ladder) - power(a, trumpSuit, ladder));
          return winningMoves[0];
        }
        break;
      }
      case 5: { // 5: Jupiter (Expansion)
        if (isLead) {
          const majors = legalOptions.filter((c) => c.is_major && Number(c.rank) !== EXCUSE_ARCANA);
          if (majors.length > 0) {
            majors.sort((a, b) => power(b, trumpSuit, ladder) - power(a, trumpSuit, ladder));
            return majors[0];
          }
        }
        break;
      }
      case 6: { // 6: Saturn (Endurance)
        if (trickNumber < 10) {
          if (isLead) {
            const lowCards = legalOptions.filter((c) => !c.is_major);
            if (lowCards.length > 0) {
              lowCards.sort((a, b) => power(a, trumpSuit, ladder) - power(b, trumpSuit, ladder));
              return lowCards[0];
            }
          } else {
            if (potPoints < 10 || winningMoves.length === 0) {
              const junk = legalOptions.filter((c) => counterValue(c) === 0);
              if (junk.length > 0) {
                junk.sort((a, b) => power(a, trumpSuit, ladder) - power(b, trumpSuit, ladder));
                return junk[0];
              }
            }
          }
        } else if (winningMoves.length > 0) {
          winningMoves.sort((a, b) => power(b, trumpSuit, ladder) - power(a, trumpSuit, ladder));
          return winningMoves[0];
        }
        break;
      }
      case 7: { // 7: Uranus (Upheaval)
        const excuse = legalOptions.find((c) => c.is_major && Number(c.rank) === EXCUSE_ARCANA);
        if (excuse && potPoints === 0 && !isLead) {
          return excuse;
        }
        break;
      }
      case 8: { // 8: Neptune (Dissolution)
        if (!isLead && winningMoves.length > 0 && potPoints < 10) {
          const sloughs = legalOptions.filter((c) => counterValue(c) === 0);
          if (sloughs.length > 0) {
            sloughs.sort((a, b) => power(a, trumpSuit, ladder) - power(b, trumpSuit, ladder));
            return sloughs[0];
          }
        }
        break;
      }
      case 9: { // 9: Pluto (Transformation)
        if (trickNumber >= 8 && winningMoves.length > 0) {
          winningMoves.sort((a, b) => power(b, trumpSuit, ladder) - power(a, trumpSuit, ladder));
          return winningMoves[0];
        }
        break;
      }
    }

    return GuardianAI.choose(hand, ledSuit, trumpSuit, trick, ladder);
  }

  // ── Multi-Seat Melee Resolver ──────────────────────────────────────────────
  function playMelee(hands, order, trumpSuit, ladder, movePicker, onPlay) {
    const live = new Map(order.map((f) => [f, [...(hands.get ? hands.get(f) ?? [] : hands[f] ?? [])]]));
    const counters = new Map(order.map((f) => [f, 0]));
    const melds = new Map(order.map((f) => [f, 0]));
    const seatPlays = new Map(order.map((f) => [f, []]));

    for (const f of order) {
      const detected = detectMelds(live.get(f) ?? [], trumpSuit, ladder) ?? [];
      melds.set(f, detected.reduce((a, m) => a + (m.value || 0), 0));
    }

    const tricks = Math.max(...order.map((f) => (live.get(f) ?? []).length));
    let leader = 0;
    let finalTrickWinner = order[0];

    const picker = movePicker || archetypeMovePicker;

    for (let t = 1; t <= tricks; t++) {
      const trick = [];
      let ledSuit = null;
      for (let k = 0; k < order.length; k++) {
        const f = order[(leader + k) % order.length];
        const hand = live.get(f) ?? [];
        if (!hand.length) continue;
        const proposed = picker(f, hand, ledSuit, trick, ladder, t);
        const card = proposed || GuardianAI.choose(hand, ledSuit, trumpSuit, trick, ladder);
        const legal = getLegalMoves(hand, ledSuit, trumpSuit, trick, ladder);
        const chosen = legal.find((m) => m.legal && m.card.card_id === card?.card_id)?.card
          ?? legal.find((m) => m.legal)?.card;
        if (!chosen) continue;
        live.set(f, hand.filter((c) => c.card_id !== chosen.card_id));
        if (trick.length === 0 && !chosen.is_major) ledSuit = (chosen.suit || "").toLowerCase();
        trick.push({ player: f, card: chosen });
        seatPlays.get(f)?.push({ trickNumber: t, card: chosen });
        if (onPlay) onPlay({ trickNumber: t, faction: f, card: chosen });
      }
      if (!trick.length) break;

      const res = evaluateTrick(trick, trumpSuit, ladder, t);
      const winner = res.winner ?? trick[0].player;
      const gained = (res.counters || 0) - (res.climaxBonus || 0);
      counters.set(winner, (counters.get(winner) ?? 0) + gained);
      if (res.excusePlayer !== null && res.excusePlayer !== undefined) {
        const ex = res.excusePlayer;
        counters.set(ex, (counters.get(ex) ?? 0) + counterValue({ is_major: true, rank: 0 }));
      }
      leader = order.indexOf(winner) >= 0 ? order.indexOf(winner) : leader;
      finalTrickWinner = winner;
    }

    return order.map((f) => ({
      faction: f,
      occupant: "",
      counters: counters.get(f) ?? 0,
      meldsValue: melds.get(f) ?? 0,
      tookFinalTrick: f === finalTrickWinner,
      plays: seatPlays.get(f) ?? [],
      score: (counters.get(f) ?? 0) + (melds.get(f) ?? 0) + (f === finalTrickWinner ? 10 : 0)
    }));
  }

  // ── Export to Global / Window ──────────────────────────────────────────────
  const ArcanaTrickEngine = {
    ARCANA_NAMES,
    ARCANA_NUMERALS,
    ARCANA_FAMILY,
    ARCANA_RULER,
    MAJOR_HONOURS,
    EXCUSE_ARCANA,
    MINOR_TRICK_POWER,
    COUNTER_VALUES,
    SIGN_RULERS,
    DOMICILES,
    EXALTATIONS,
    getDignityScore,
    getDignityType,
    buildArcanaLadder,
    power,
    counterValue,
    getLegalMoves,
    evaluateTrick,
    detectMelds,
    GuardianAI,
    createMelee,
    canAccessZone,
    zoneSign,
    zoneTrump,
    opportunity,
    trumpDepth,
    computeClaim,
    restIsWaived,
    chooseChampions,
    seatOrder,
    archetypeMovePicker,
    playMelee
  };

  if (typeof window !== "undefined") {
    window.ArcanaTrickEngine = ArcanaTrickEngine;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.ArcanaTrickEngine = ArcanaTrickEngine;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = ArcanaTrickEngine;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : global));
