// ============================================================================
// Pentacles — Interactive Tree of Life Meld Map & Rules Codex
// ============================================================================

(function () {
  const SEPHIROTH = [
    { id: 1, name: "Kether", title: "The Crown", x: 200, y: 45, pip: "Aces (1)", color: "#ffffff", stroke: "#e6c35c", planet: "Primum Mobile", glyph: "☉" },
    { id: 2, name: "Chokmah", title: "Wisdom", x: 320, y: 115, pip: "Twos (2)", color: "#9ca3af", stroke: "#cbd5e1", planet: "Uranus / Zodiac", glyph: "♅" },
    { id: 3, name: "Binah", title: "Understanding", x: 80, y: 115, pip: "Threes (3)", color: "#1e1b4b", stroke: "#6366f1", planet: "Saturn", glyph: "♄" },
    { id: 4, name: "Chesed", title: "Mercy", x: 320, y: 235, pip: "Fours (4)", color: "#1e3a8a", stroke: "#3b82f6", planet: "Jupiter", glyph: "♃" },
    { id: 5, name: "Geburah", title: "Strength", x: 80, y: 235, pip: "Fives (5)", color: "#7f1d1d", stroke: "#ef4444", planet: "Mars", glyph: "♂" },
    { id: 6, name: "Tiphareth", title: "Beauty & Harmony", x: 200, y: 310, pip: "Sixes (6)", color: "#ca8a04", stroke: "#facc15", planet: "Sun", glyph: "☉" },
    { id: 7, name: "Netzach", title: "Victory", x: 320, y: 430, pip: "Sevens (7)", color: "#14532d", stroke: "#22c55e", planet: "Venus", glyph: "♀" },
    { id: 8, name: "Hod", title: "Splendor", x: 80, y: 430, pip: "Eights (8)", color: "#7c2d12", stroke: "#f97316", planet: "Mercury", glyph: "☿" },
    { id: 9, name: "Yesod", title: "Foundation", x: 200, y: 520, pip: "Nines (9)", color: "#581c87", stroke: "#a855f7", planet: "Moon", glyph: "☽" },
    { id: 10, name: "Malkuth", title: "The Kingdom", x: 200, y: 630, pip: "Tens (10)", color: "#1c1917", stroke: "#d97706", planet: "Earth", glyph: "♁" }
  ];

  const PATHS = [
    { id: 11, from: 1, to: 2, major: 0, name: "The Fool", letter: "Aleph (א)", title: "Path 11: Kether → Chokmah" },
    { id: 12, from: 1, to: 3, major: 1, name: "The Magician", letter: "Beth (ב)", title: "Path 12: Kether → Binah" },
    { id: 13, from: 1, to: 6, major: 2, name: "The High Priestess", letter: "Gimel (ג)", title: "Path 13: Kether → Tiphareth (Middle Pillar)" },
    { id: 14, from: 2, to: 3, major: 3, name: "The Empress", letter: "Daleth (ד)", title: "Path 14: Chokmah ↔ Binah (Supernal Veil)" },
    { id: 15, from: 2, to: 6, major: 4, name: "The Emperor", letter: "Heh (ה)", title: "Path 15: Chokmah → Tiphareth" },
    { id: 16, from: 2, to: 4, major: 5, name: "The Hierophant", letter: "Vav (ו)", title: "Path 16: Chokmah → Chesed (Right Pillar)" },
    { id: 17, from: 3, to: 6, major: 6, name: "The Lovers", letter: "Zayin (ז)", title: "Path 17: Binah → Tiphareth" },
    { id: 18, from: 3, to: 5, major: 7, name: "The Chariot", letter: "Cheth (ח)", title: "Path 18: Binah → Geburah (Left Pillar)" },
    { id: 19, from: 4, to: 5, major: 8, name: "Strength", letter: "Teth (ט)", title: "Path 19: Chesed ↔ Geburah (Ethical Veil)" },
    { id: 20, from: 4, to: 6, major: 9, name: "The Hermit", letter: "Yod (י)", title: "Path 20: Chesed → Tiphareth" },
    { id: 21, from: 4, to: 7, major: 10, name: "Wheel of Fortune", letter: "Kaph (כ)", title: "Path 21: Chesed → Netzach (Right Pillar)" },
    { id: 22, from: 5, to: 6, major: 11, name: "Justice", letter: "Lamed (ל)", title: "Path 22: Geburah → Tiphareth" },
    { id: 23, from: 5, to: 8, major: 12, name: "The Hanged Man", letter: "Mem (מ)", title: "Path 23: Geburah → Hod (Left Pillar)" },
    { id: 24, from: 6, to: 7, major: 13, name: "Death", letter: "Nun (נ)", title: "Path 24: Tiphareth → Netzach" },
    { id: 25, from: 6, to: 9, major: 14, name: "Temperance", letter: "Samekh (ס)", title: "Path 25: Tiphareth → Yesod (Middle Pillar)" },
    { id: 26, from: 6, to: 8, major: 15, name: "The Devil", letter: "Ayin (ע)", title: "Path 26: Tiphareth → Hod" },
    { id: 27, from: 7, to: 8, major: 16, name: "The Tower", letter: "Peh (פ)", title: "Path 27: Netzach ↔ Hod (Astral Veil)" },
    { id: 28, from: 7, to: 9, major: 17, name: "The Star", letter: "Tzaddi (צ)", title: "Path 28: Netzach → Yesod" },
    { id: 29, from: 7, to: 10, major: 18, name: "The Moon", letter: "Qoph (ק)", title: "Path 29: Netzach → Malkuth" },
    { id: 30, from: 8, to: 9, major: 19, name: "The Sun", letter: "Resh (ר)", title: "Path 30: Hod → Yesod" },
    { id: 31, from: 8, to: 10, major: 20, name: "Judgement", letter: "Shin (ש)", title: "Path 31: Hod → Malkuth" },
    { id: 32, from: 9, to: 10, major: 21, name: "The World", letter: "Tav (ת)", title: "Path 32: Yesod → Malkuth (Middle Pillar)" }
  ];

  const MELDS_CATALOG = [
    // ── Tier 1: Tree of Life Major Alignments ─────────────────────────────
    {
      id: "the_great_work",
      category: "tree",
      name: "The Great Work",
      points: 100,
      composition: "The Fool (0) + The Magician (I) + The World (XXI)",
      sephiroth: [1, 2, 3, 9, 10],
      paths: [11, 12, 32],
      summary: "Alpha, Catalyst, and Omega. Symbolizes the total transmuted completion of spiritual consciousness.",
      tips: "Requires 3 Major slots in your loadout. Stacks with Arcana Trine (+50) for a massive +150 starting advantage."
    },
    {
      id: "the_middle_pillar",
      category: "tree",
      name: "The Middle Pillar",
      points: 90,
      composition: "The High Priestess (II) + Temperance (XIV) + The World (XXI)",
      sephiroth: [1, 6, 9, 10],
      paths: [13, 25, 32],
      summary: "The direct vertical axis of Equilibrium and Divine Ascent: Kether down through Tiphareth and Yesod to Malkuth.",
      tips: "Combines intuitive perception (II), alchemical synthesis (XIV), and material completion (XXI). Stacks with Arcana Trine."
    },
    {
      id: "the_three_mothers",
      category: "tree",
      name: "The Three Mothers (Tria Prima)",
      points: 90,
      composition: "The Fool (0 / Air) + The Hanged Man (XII / Water) + Judgement (XX / Fire)",
      sephiroth: [1, 2, 5, 8, 10],
      paths: [11, 23, 31],
      summary: "The three primordial Mother Letters of the Sepher Yetzirah (Aleph, Mem, Shin) governing Air, Water, and Fire.",
      tips: "Represents pure elemental potential prior to material condensation. Stacks with Arcana Trine."
    },
    {
      id: "the_three_veils",
      category: "tree",
      name: "The Three Veils (Horizontal Bridges)",
      points: 85,
      composition: "The Empress (III) + Strength (VIII) + The Tower (XVI)",
      sephiroth: [2, 3, 4, 5, 7, 8],
      paths: [14, 19, 27],
      summary: "The three horizontal rungs binding the Pillar of Mercy to the Pillar of Severity across the Supernal, Moral, and Astral realms.",
      tips: "Spans Path 14 (Abyss), Path 19 (Paroketh), and Path 27 (Astral Veil). Massive territorial control driver."
    },
    {
      id: "the_supernal_triad",
      category: "tree",
      name: "The Supernal Triad",
      points: 75,
      composition: "The Fool (0) + The Magician (I) + The High Priestess (II)",
      sephiroth: [1, 2, 3, 6],
      paths: [11, 12, 13],
      summary: "The divine trinity crowning the Tree of Life above the Abyss: Pure Void (0), Conscious Will (I), and Memory (II).",
      tips: "All three cards emerge directly from Kether. Stacks with Arcana Trine for +125 pts."
    },
    {
      id: "dignified_trine",
      category: "tree",
      name: "Dignified Trine",
      points: 75,
      composition: "Any three Majors each standing at live Potency ≥ 60",
      sephiroth: [1, 6, 10],
      paths: [],
      summary: "Dynamic astrological dignity: triggered when celestial planetary transits elevate three of your Majors on the Arcana Ladder.",
      tips: "Check the Live Arcana Ladder before queueing! When your faction's planets are exalted, this meld triggers reliably."
    },
    {
      id: "arcana_trine",
      category: "tree",
      name: "Arcana Trine",
      points: 50,
      composition: "Any three Major Arcana held in hand",
      sephiroth: [1, 6, 10],
      paths: [],
      summary: "Holding the maximum allowable 3 Major Arcana in your starting 12-card hand.",
      tips: "Always activates when you hold any 3 Majors, automatically stacking with any specific Major triad meld."
    },

    // ── Tier 2: Sephiric & Number Alignments ─────────────────────────────
    {
      id: "grand_cross",
      category: "sephiric",
      name: "Grand Cross",
      points: 100,
      composition: "Ace of Wands + Ace of Cups + Ace of Swords + Ace of Pentacles",
      sephiroth: [1],
      paths: [],
      summary: "The Four Aces of Kether uniting all four elemental realms (Atziluth, Briah, Yetzirah, Assiah).",
      tips: "Holding all four Aces gives you unrivaled early power. Aces bank 10 counters in trick play!"
    },
    {
      id: "quartet_worlds",
      category: "sephiric",
      name: "Quartet of the Four Worlds",
      points: 80,
      composition: "All four suits of any rank (2 through 14; e.g. Four 10s, Four Kings, Four 7s)",
      sephiroth: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      paths: [],
      summary: "Simultaneous manifestation of a single Sephiric frequency across Fire, Water, Air, and Earth.",
      tips: "Four Tens manifests the Malkuth Quadrivium; Four Kings establishes Sovereign Command."
    },
    {
      id: "the_solar_heart",
      category: "sephiric",
      name: "The Solar Heart (Tiphareth Triad)",
      points: 60,
      composition: "Three 6s across any suits (e.g. 6 of Wands + 6 of Cups + 6 of Pentacles)",
      sephiroth: [6],
      paths: [13, 15, 17, 20, 22, 24, 25, 26],
      summary: "Tiphareth (6), the solar heart of the Tree, radiating harmony and equilibrium to all Sephiroth.",
      tips: "Pips 6 represent beauty, balance, and solar vitality."
    },
    {
      id: "pillar_of_severity",
      category: "sephiric",
      name: "Pillar of Severity (Form & Law)",
      points: 50,
      composition: "Ranks 3 (Binah) + 5 (Geburah) + 8 (Hod) in the SAME suit",
      sephiroth: [3, 5, 8],
      paths: [18, 23],
      summary: "The left pillar of Form, Karmic Law, and Discernment across a single elemental suit.",
      tips: "Swords (Air) or Pentacles (Earth) are favored for severity loadouts."
    },
    {
      id: "pillar_of_mercy",
      category: "sephiric",
      name: "Pillar of Mercy (Force & Grace)",
      points: 50,
      composition: "Ranks 2 (Chokmah) + 4 (Chesed) + 7 (Netzach) in the SAME suit",
      sephiroth: [2, 4, 7],
      paths: [16, 21],
      summary: "The right pillar of Dynamic Force, Wisdom, and Victorious Expansion.",
      tips: "Wands (Fire) or Cups (Water) synergize naturally with the Pillar of Mercy."
    },

    // ── Tier 3: Court Hierarchies & Partnerships ────────────────────────
    {
      id: "full_court",
      category: "court",
      name: "Full Court",
      points: 60,
      composition: "Page (11) + Knight (12) + Queen (13) + King (14) of one suit",
      sephiroth: [],
      paths: [],
      summary: "Complete court hierarchy in a single element. Represents sovereign feudal command.",
      tips: "Banks substantial trick points (King=10, Queen=10, Knight=10, Page=10)."
    },
    {
      id: "marriage_trump",
      category: "court",
      name: "Royal Marriage (Trump)",
      points: 40,
      composition: "King (14) + Queen (13) of the zone's Trump suit",
      sephiroth: [],
      paths: [],
      summary: "Sovereign union ruling over the contested zone's favored elemental weather.",
      tips: "Worth double the plain marriage (40 vs 20). Essential in zone conquest."
    },
    {
      id: "marriage_plain",
      category: "court",
      name: "Off-Suit Marriage",
      points: 20,
      composition: "King (14) + Queen (13) of any non-trump suit",
      sephiroth: [],
      paths: [],
      summary: "Diplomatic court alliance between off-suit rulers.",
      tips: "Easy to form when running pairs of court cards in your loadout."
    },
    {
      id: "pinochle",
      category: "court",
      name: "Pinochle",
      points: 40,
      composition: "Queen of Swords (13) + Knight of Pentacles (12)",
      sephiroth: [],
      paths: [],
      summary: "Classic cross-suit alliance of Air (Mental discernment) and Earth (Material stamina).",
      tips: "Direct translation of the classic Q♠ + J♦ partnership."
    },

    // ── Tier 4: Decans & Elemental Cadence ───────────────────────────────
    {
      id: "decan_trine",
      category: "astral",
      name: "Decan Trine",
      points: 40,
      composition: "The three decan pips of one zodiac sign (Cardinal 2·3·4, Fixed 5·6·7, Mutable 8·9·10)",
      sephiroth: [2, 3, 4, 5, 6, 7, 8, 9, 10],
      paths: [],
      summary: "The 36 decans of Egyptian-Chaldean astrology dividing each sign into three 10-day faces.",
      tips: "Aries: 2·3·4 Wands; Taurus: 5·6·7 Pentacles; Gemini: 8·9·10 Swords; Cancer: 2·3·4 Cups, etc."
    },
    {
      id: "lightning_flash",
      category: "astral",
      name: "The Lightning Flash (Minor Cadence)",
      points: 50,
      composition: "4 consecutive ranks (within Sephiroth pips 1..10) in the same suit",
      sephiroth: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      paths: [],
      summary: "The zig-zagging descent of divine creative force down consecutive Sephiroth.",
      tips: "e.g. 3·4·5·6 or 7·8·9·10. Heavy synergy with Decan Trines."
    }
  ];

  let currentTab = "tree";
  let activeMeldId = "the_middle_pillar";

  function renderTreeSvg(selectedMeld) {
    const activeNodes = selectedMeld ? selectedMeld.sephiroth || [] : [];
    const activePaths = selectedMeld ? selectedMeld.paths || [] : [];

    // Draw paths (lines)
    const pathsSvg = PATHS.map((p) => {
      const fromNode = SEPHIROTH.find((s) => s.id === p.from);
      const toNode = SEPHIROTH.find((s) => s.id === p.to);
      if (!fromNode || !toNode) return "";
      const isLit = activePaths.includes(p.id);
      const strokeColor = isLit ? "#ffd700" : "rgba(255, 255, 255, 0.12)";
      const strokeWidth = isLit ? 3.5 : 1.2;
      const glow = isLit ? `filter="url(#glow)"` : "";
      return `
        <line x1="${fromNode.x}" y1="${fromNode.y}" x2="${toNode.x}" y2="${toNode.y}" 
              stroke="${strokeColor}" stroke-width="${strokeWidth}" stroke-linecap="round" ${glow} 
              data-path="${p.id}" class="tol-path ${isLit ? 'lit' : ''}" />
        ${isLit ? `<circle cx="${(fromNode.x + toNode.x) / 2}" cy="${(fromNode.y + toNode.y) / 2}" r="4" fill="#ffd700" />` : ''}
      `;
    }).join("");

    // Draw Sephiroth (circles)
    const nodesSvg = SEPHIROTH.map((s) => {
      const isLit = activeNodes.includes(s.id);
      const r = isLit ? 26 : 22;
      const strokeW = isLit ? 3 : 1.5;
      const strokeCol = isLit ? "#ffd700" : s.stroke;
      const fillCol = isLit ? "rgba(250, 204, 21, 0.25)" : "rgba(15, 23, 42, 0.85)";
      const textCol = isLit ? "#ffffff" : "#e2e8f0";
      return `
        <g class="tol-node ${isLit ? 'lit' : ''}" transform="translate(${s.x}, ${s.y})" data-node="${s.id}">
          <circle r="${r + 4}" fill="none" stroke="${isLit ? 'rgba(250, 204, 21, 0.4)' : 'transparent'}" stroke-width="1.5" class="pulse-ring" />
          <circle r="${r}" fill="${fillCol}" stroke="${strokeCol}" stroke-width="${strokeW}" />
          <text text-anchor="middle" dy="-3" fill="${textCol}" font-size="10" font-weight="bold" font-family="'Space Grotesk', sans-serif">${s.id}</text>
          <text text-anchor="middle" dy="9" fill="${isLit ? '#ffd700' : 'rgba(216, 180, 106, 0.8)'}" font-size="7.5" font-family="'Cinzel', serif">${s.name}</text>
        </g>
      `;
    }).join("");

    return `
      <svg viewBox="0 0 400 680" class="tol-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>
        <!-- Background Tree Pillars Guides -->
        <line x1="80" y1="90" x2="80" y2="455" stroke="rgba(239, 68, 68, 0.15)" stroke-dasharray="3,3" stroke-width="1" />
        <line x1="200" y1="20" x2="200" y2="655" stroke="rgba(250, 204, 21, 0.2)" stroke-dasharray="3,3" stroke-width="1" />
        <line x1="320" y1="90" x2="320" y2="455" stroke="rgba(59, 130, 246, 0.15)" stroke-dasharray="3,3" stroke-width="1" />
        
        <!-- Pillar Labels -->
        <text x="80" y="30" text-anchor="middle" fill="rgba(239, 68, 68, 0.6)" font-size="7.5" letter-spacing="1">SEVERITY</text>
        <text x="200" y="15" text-anchor="middle" fill="rgba(250, 204, 21, 0.8)" font-size="7.5" letter-spacing="1">MIDDLE PILLAR</text>
        <text x="320" y="30" text-anchor="middle" fill="rgba(59, 130, 246, 0.6)" font-size="7.5" letter-spacing="1">MERCY</text>

        <!-- Paths & Nodes -->
        ${pathsSvg}
        ${nodesSvg}
      </svg>
    `;
  }

  function renderMeldDetails(meld) {
    if (!meld) return `<div class="mm-empty">Select a Meld to view sacred geometry &amp; composition</div>`;
    return `
      <div class="mm-detail-card">
        <div class="mm-detail-header">
          <div style="display:flex; align-items:center; gap:8px;">
            <span class="mm-cat-badge mm-cat-${meld.category}">${meld.category.toUpperCase()}</span>
            <h3 class="mm-detail-title">${meld.name}</h3>
          </div>
          <div class="mm-pts-tag">+${meld.points} PTS</div>
        </div>
        
        <div class="mm-formula-box">
          <span class="mm-formula-lbl">REQUIRED COMPOSITION:</span>
          <div class="mm-formula-val">${meld.composition}</div>
        </div>

        <p class="mm-detail-summary">${meld.summary}</p>

        <div class="mm-tip-box">
          <b style="color:var(--gold-bright);">✦ Strategy &amp; Mechanics:</b> ${meld.tips}
        </div>
      </div>
    `;
  }

  function renderMeldList(category) {
    const list = category === "all" ? MELDS_CATALOG : MELDS_CATALOG.filter((m) => m.category === category);
    return list.map((m) => {
      const isSel = m.id === activeMeldId;
      return `
        <div class="mm-list-item ${isSel ? 'active' : ''}" onclick="MeldMapUI.selectMeld('${m.id}')">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <b class="mm-item-name">${m.name}</b>
            <span class="mm-item-pts">+${m.points}</span>
          </div>
          <div class="mm-item-comp">${m.composition}</div>
        </div>
      `;
    }).join("");
  }

  function renderRulesView() {
    return `
      <div class="mm-rules-scroller">
        <div class="mm-rule-section">
          <h4>⚔️ 1. The Deal &amp; Melds Phase (Pre-Trick 1)</h4>
          <p>
            In Pentacles 12-trick Melee War Tables, Melds are evaluated automatically <b>before Trick 1 is led</b>.
            Your starting hand (12 cards: up to 9 Minors and ≤3 Major Arcana) is analyzed for canonical and sacred Qabalistic combinations.
          </p>
          <div class="mm-rule-callout">
            <b>Crucial Rule:</b> Declaring a meld <u>never</u> discards or spends your cards. You retain all 12 cards in hand to play in the 12 battle tricks!
          </div>
        </div>

        <div class="mm-rule-section">
          <h4>⚖️ 2. Total Score Formulation</h4>
          <p>Every seat's authoritative round score is calculated in SpacetimeDB:</p>
          <div class="mm-math-formula">
            <b>Final Score</b> = Trick Counters Banked + Starting Melds Value + (Final Trick Winner ? 10 : 0)
          </div>
          <p>
            Melds provide an upfront point foundation that counts 1:1 toward your total table standing.
            A strong starting meld can overcome Guardian zone handicaps (+20 Spire, +40 Crown) before a single card is placed on the table!
          </p>
        </div>

        <div class="mm-rule-section">
          <h4>🗺️ 3. Territorial Zone Control Swings</h4>
          <p>
            In multi-seat tables (2..6 contenders), zone control is zero-sum around the table mean:
          </p>
          <div class="mm-math-formula">
            <b>Zone Control Delta</b> = (Your Score Share - 1 / N) × 120 + (Winner Bonus ? 30 : 0)
          </div>
          <p>
            High melds massively expand your share of the table's points, inflicting crushing territorial flips on rival factions and conquering contested zones.
          </p>
        </div>

        <div class="mm-rule-section">
          <h4>💎 4. Blockchain &amp; ESMS Token Yields (Tier 2 Faucet)</h4>
          <p>
            Round winners earn on-chain ESMS tokens via the authoritative faucet engine:
          </p>
          <div class="mm-math-formula">
            <b>Winner Yield</b> = 5.0000 ESMS × (1.0 + Score / 100) × Weather Alignment + Oudler Climax Bonus
          </div>
          <p>
            Every 100 points in melds doubles the baseline multiplier! Furthermore, achieving <b>Score ≥ 70</b> triggers the <b>+20% Majority Multiplier</b>.
            Yield is split into the four canonical tokens (<b>SPIRIT, ESSENCE, MATTER, SUBSTANCE</b>) based on your Natal Chart and live sky transits.
          </p>
        </div>

        <div class="mm-rule-section">
          <h4>☀️ 5. Chaldean Decan Lord Dignity (+25 Bonus)</h4>
          <p>
            When the transit Sun is passing through a decan ruled by your planetary faction, all contenders of that faction gain an additional 
            <b>+25 Chaldean Melds Dignity</b> bonus automatically applied to their starting melds value!
          </p>
        </div>
      </div>
    `;
  }

  function updateUI() {
    const container = document.getElementById("meld-map-content");
    if (!container) return;

    const selMeld = MELDS_CATALOG.find((m) => m.id === activeMeldId) || MELDS_CATALOG[0];

    if (currentTab === "rules") {
      container.innerHTML = `
        <div class="mm-layout-rules">
          ${renderRulesView()}
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="mm-layout">
        <!-- Left: Tree of Life Visual Map -->
        <div class="mm-tree-pane">
          <div class="mm-tree-header">
            <span style="font-size:11px; font-weight:bold; color:var(--gold-bright); letter-spacing:1px; text-transform:uppercase;">Tree of Life (Otz Chiim)</span>
            <span style="font-size:10px; color:var(--dim);">10 Sephiroth · 22 Paths</span>
          </div>
          <div class="mm-svg-wrap">
            ${renderTreeSvg(selMeld)}
          </div>
          <div style="font-size:9.5px; color:var(--dim); text-align:center; padding-top:6px;">
            Gold nodes &amp; paths illuminate cards in the selected Meld
          </div>
        </div>

        <!-- Right: Meld Catalog & Breakdown -->
        <div class="mm-catalog-pane">
          <div class="mm-tabs">
            <button class="mm-tab-btn ${currentTab === 'tree' ? 'active' : ''}" onclick="MeldMapUI.setTab('tree')">🌟 Tree Alignments</button>
            <button class="mm-tab-btn ${currentTab === 'sephiric' ? 'active' : ''}" onclick="MeldMapUI.setTab('sephiric')">🏛️ Sephiric &amp; Numbers</button>
            <button class="mm-tab-btn ${currentTab === 'court' ? 'active' : ''}" onclick="MeldMapUI.setTab('court')">👑 Court Pairs</button>
            <button class="mm-tab-btn ${currentTab === 'astral' ? 'active' : ''}" onclick="MeldMapUI.setTab('astral')">♈ Decans &amp; Cadence</button>
            <button class="mm-tab-btn ${currentTab === 'all' ? 'active' : ''}" onclick="MeldMapUI.setTab('all')">✦ All Melds</button>
            <button class="mm-tab-btn mm-tab-rules ${currentTab === 'rules' ? 'active' : ''}" onclick="MeldMapUI.setTab('rules')">📖 Rules &amp; Math</button>
          </div>

          <div class="mm-catalog-split">
            <div class="mm-list-container">
              ${renderMeldList(currentTab)}
            </div>
            <div class="mm-detail-container">
              ${renderMeldDetails(selMeld)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  const api = {
    open(meldId) {
      if (meldId) activeMeldId = meldId;
      const modal = typeof document !== "undefined" ? document.getElementById("meld-map-modal") : null;
      if (modal) modal.style.display = "flex";
      updateUI();
    },
    close() {
      const modal = typeof document !== "undefined" ? document.getElementById("meld-map-modal") : null;
      if (modal) modal.style.display = "none";
    },
    setTab(tab) {
      currentTab = tab;
      const first = MELDS_CATALOG.find((m) => tab === "all" || m.category === tab);
      if (first) activeMeldId = first.id;
      updateUI();
    },
    selectMeld(id) {
      activeMeldId = id;
      updateUI();
    },
    MELDS_CATALOG,
    SEPHIROTH,
    PATHS
  };

  if (typeof window !== "undefined") window.MeldMapUI = api;
  if (typeof globalThis !== "undefined") globalThis.MeldMapUI = api;
})();
