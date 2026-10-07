/* ============================================================
   PENTACLES — Planetary Faction Dossier & Lore Pages
   ============================================================
   The full-screen pop-out dossier for each of the 10 Planetary Factions
   (Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn, Uranus, Neptune, Pluto).

   Displays:
     • Live Faction Standings, score, decan victories, and zones controlled
     • Faction doctrine, tactical War Table archetype, and Hermetic principle
     • Astronomical & Astrological profile (dignities, rulerships, metal, color)
     • Tarot Card associations (Major Arcana signature card + Chaldean Decan Minors)
     • Sworn Historical Agent members (full roster with birth years, chart keys, traits)

   Wires seamlessly to Faction Standings leaderboard clicks, decan banner,
   and the global Pentacles API.
   ============================================================ */

(function (root) {
  "use strict";

  // ── CONSTANTS & PALETTES ──────────────────────────────────────────────────
  const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
  const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
  const PLANET_COLORS = [
    "#f6cf83", // Sun
    "#dce2f0", // Moon
    "#82bbf2", // Mercury
    "#76e0a8", // Venus
    "#e26666", // Mars
    "#f0a95e", // Jupiter
    "#998ab0", // Saturn
    "#66d9e8", // Uranus
    "#4e7cd9", // Neptune
    "#705988"  // Pluto
  ];

  const SUIT_GLYPHS = { Wands: "🜂", Cups: "🜄", Swords: "🜁", Pentacles: "🜃" };
  const SUIT_COLORS = { Wands: "#db7a47", Cups: "#5f93d8", Swords: "#aebbd6", Pentacles: "#74ab6c" };

  // ── FACTION COMPREHENSIVE DATA CATALOG ─────────────────────────────────────
  const FACTIONS_DATA = [
    {
      id: 0,
      name: "Sun",
      glyph: "☉",
      factionName: "Solar Dominion",
      epithet: "The Sovereign Illuminators",
      motto: "The Light reveals all forms; sovereign will commands the cosmos.",
      color: "#f6cf83",
      accent: "#e8b84b",
      element: "Fire",
      elementGlyph: "🜂",
      hermeticPrinciple: "Principle of Mentalism & Sovereign Center",
      archetype: "Radiance",
      tacticSummary: "Sweeps high counters, commands table initiative, and leads dignified trumps.",
      warDoctrine: "Solar commanders control the tempo of the table through undeniable presence. When playing in active zones, Solar agents open with heavy counters to force early folds from opposing factions, maintaining initiative until the crowning trick.",
      astrology: {
        domicile: "Leo (♌)",
        exaltation: "Aries (♈)",
        detriment: "Aquarius (♒)",
        fall: "Libra (♎)",
        triplicity: "Fire (Diurnal)",
        day: "Sunday",
        metal: "Pure Gold",
        gemstone: "Ruby & Diamond",
        bodyType: "Diurnal Luminary / Central Star"
      },
      astronomy: {
        classification: "Yellow Dwarf Star (Spectral Type G2V)",
        distance: "1.00 AU (149,597,870 km)",
        orbitalPeriod: "Solar Year (365.25 days transit)",
        radius: "696,340 km (109 × Earth)",
        surfaceTemp: "5,778 K (9,940 °F)",
        fact: "Generates 99.86% of the total mass in the solar system, holding all celestial orbits within its gravitational well."
      },
      tarot: {
        major: {
          number: "XIX",
          name: "The Sun",
          title: "Lord of the Fire of the World",
          archetype: "Supreme Illumination, Vitality, Awakening & Self-Mastery",
          gameEffect: "Radiant Aura: Grants +25% bonus power to fire-suited tricks and secures table initiative on ties.",
          flavor: "Two celestial twins dance beneath a golden disc of thirty-six rays, celebrating the triumph of conscious light over obscurity."
        },
        decans: [
          { card: "3 of Wands", degrees: "10°–20° Aries", sign: "Aries", suit: "Wands", meaning: "Established Strength & Enterprise", desc: "The visionary watcher oversees ships setting sail under golden skies." },
          { card: "5 of Wands", degrees: "0°–10° Leo", sign: "Leo", suit: "Wands", meaning: "Strife & The Golden Contest", desc: "Five youth engage in playful yet rigorous combat for planetary renown." },
          { card: "7 of Cups", degrees: "20°–30° Scorpio", sign: "Scorpio", suit: "Cups", meaning: "Illusionary Success & Vision", desc: "Seven chalices offer jewels and dragons, demanding discerning clarity." },
          { card: "3 of Pentacles", degrees: "10°–20° Capricorn", sign: "Capricorn", suit: "Pentacles", meaning: "Material Works & Sacred Architecture", desc: "The master builder erects enduring pillars within the cathedral sanctuary." },
          { card: "6 of Swords", degrees: "10°–20° Aquarius", sign: "Aquarius", suit: "Swords", meaning: "Earned Passage Across Waters", desc: "The ferryman steers the seeker toward serene shores of understanding." }
        ]
      },
      agents: [
        { handle: "Nicolas Flamel", year: "c. 1330", role: "Vanguard Champion", trait: "Solar Transmutation", note: "Master Alchemist of Paris; discovered the Red Stone and the immortal catalyst." },
        { handle: "Plato", year: "428 BCE", role: "Philosopher Architect", trait: "Allegory of the Cave", note: "Classical Athens; envisioned the Sun as the supreme metaphor for the Good and ultimate truth." },
        { handle: "Immanuel Kant", year: "1724", role: "Epistemic Sovereign", trait: "Categorical Imperative", note: "Königsberg, Prussia; illuminated synthetic a priori judgment and moral law as immutable stars." },
        { handle: "Adam Smith", year: "1723", role: "Systemic Economist", trait: "Moral Sentiment", note: "Kirkcaldy, Scotland; analyzed how enlightened human enterprise coordinates universal prosperity." },
        { handle: "Maya Angelou", year: "1928", role: "Sovereign Bard", trait: "Phenomenal Will", note: "St. Louis, USA; poet of unshakable grace, resilience, and transcendent oratorical power." },
        { handle: "Carl Jung", year: "1875", role: "Psychic Cartographer", trait: "Archetypal Synthesis", note: "Kesswil, Switzerland; mapped the Solar Hero myth and collective unconscious." },
        { handle: "Ibn Sina (Avicenna)", year: "980", role: "Universal Polymath", trait: "Canon of Light", note: "Afshana, Uzbekistan; organized medieval medicine, astronomy, and transcendent metaphysics." },
        { handle: "Wangari Maathai", year: "1940", role: "Living Canopy", trait: "Green Belt Command", note: "Nyeri, Kenya; Nobel Peace Laureate whose tree-planting restored living light across continents." }
      ]
    },
    {
      id: 1,
      name: "Moon",
      glyph: "☽",
      factionName: "Lunar Coven",
      epithet: "Keepers of the Silver Veil",
      motto: "Everything flows in cycles; through intuitive depths we govern the tides.",
      color: "#dce2f0",
      accent: "#cbd0db",
      element: "Water",
      elementGlyph: "🜄",
      hermeticPrinciple: "Principle of Rhythm & Cyclic Flux",
      archetype: "Tides",
      tacticSummary: "Intuitive flow — hoards stamina and commits overwhelming surges when the pot points crest.",
      warDoctrine: "The Lunar Coven plays patient, ebb-and-flow combat. They yield contested frontline spires when opposition is fierce, only to flood the table with accumulated trick momentum when the tide turns in their favor.",
      astrology: {
        domicile: "Cancer (♋)",
        exaltation: "Taurus (♉)",
        detriment: "Capricorn (♑)",
        fall: "Scorpio (♏)",
        triplicity: "Water (Nocturnal)",
        day: "Monday",
        metal: "Pure Silver",
        gemstone: "Pearl & Moonstone",
        bodyType: "Nocturnal Luminary / Earth's Natural Satellite"
      },
      astronomy: {
        classification: "Planetary-mass Natural Satellite",
        distance: "384,400 km (0.00257 AU)",
        orbitalPeriod: "27.32 days (Sidereal) / 29.53 days (Synodic phase)",
        radius: "1,737.4 km (0.273 × Earth)",
        surfaceTemp: "-130 °C to +120 °C",
        fact: "Locked in synchronous rotation with Earth, perpetually shielding its mysterious far side from terrestrial eyes."
      },
      tarot: {
        major: {
          number: "II",
          name: "The High Priestess",
          title: "Lady of the Silver Star",
          archetype: "Sacred Intuition, The Unseen Portal, Wisdom of the Unconscious",
          gameEffect: "Veil of Isis: Reverses opponent meld bonuses on contested water zones and cancels first hostile lead.",
          flavor: "Seated between the obsidian and marble pillars of Boaz and Jachin, she holds the scroll of esoteric law."
        },
        decans: [
          { card: "2 of Cups", degrees: "0°–10° Cancer", sign: "Cancer", suit: "Cups", meaning: "Love & Harmonic Mirroring", desc: "Two chalices pledged under the winged caduceus, creating mutual resonance." },
          { card: "6 of Pentacles", degrees: "10°–20° Taurus", sign: "Taurus", suit: "Pentacles", meaning: "Material Success & Equitable Flow", desc: "The benefactor dispenses balanced weights to those in need." },
          { card: "4 of Swords", degrees: "20°–30° Libra", sign: "Libra", suit: "Swords", meaning: "Rest from Strife & Sanctuary", desc: "The silent effigy rests in prayer while three swords hang in tranquil suspension." },
          { card: "9 of Swords", degrees: "10°–20° Gemini", sign: "Gemini", suit: "Swords", meaning: "The Night Watch & Dawn Awakening", desc: "The sleeper rises from nightmares to greet the incoming dawn." },
          { card: "8 of Cups", degrees: "0°–10° Pisces", sign: "Pisces", suit: "Cups", meaning: "Seeking Deeper Springs", desc: "The wanderer turns away from stacked cups to ascend moonlit mountains." }
        ]
      },
      agents: [
        { handle: "Galileo Galilei", year: "1564", role: "Lunar Vanguard", trait: "Tidal Geometry", note: "Pisa, Italy; first astronomer to train optics on lunar seas, craters, and terminator shadows." },
        { handle: "Albert Einstein", year: "1879", role: "Relativistic Seer", trait: "Spacetime Curvature", note: "Ulm, Germany; recognized that celestial mass curves the invisible fabric of the cosmos." },
        { handle: "Michelangelo Buonarroti", year: "1475", role: "Divine Sculptor", trait: "Pietà & Marble Soul", note: "Caprese, Italy; carved translucent marble with the tender, nocturnal gravity of the soul." },
        { handle: "Petrarch", year: "1304", role: "Humanist Father", trait: "Laura's Sonnets", note: "Arezzo, Italy; gave voice to introspective lyrical love and the inner landscape of memory." },
        { handle: "Jean-Jacques Rousseau", year: "1712", role: "Philosopher of Solitude", trait: "Reveries of the Solitary", note: "Geneva; celebrated communion with wild nature, innate conscience, and genuine emotion." },
        { handle: "Claude Monet", year: "1840", role: "Impressionist Master", trait: "Water Lily Reflections", note: "Paris, France; captured the shimmering, transient play of light on rippling water." },
        { handle: "Frida Kahlo", year: "1907", role: "Mythic Painter", trait: "Roots of Introspection", note: "Coyoacán, Mexico; wove self-portraits steeped in lunar blood, pain, and mythic resilience." },
        { handle: "Eleanor Roosevelt", year: "1884", role: "Global Diplomat", trait: "Universal Declaration", note: "New York; quiet moral compass who shepherded human rights across global divides." },
        { handle: "Siddhartha Gautama", year: "563 BCE", role: "The Awakened", trait: "The Middle Way", note: "Lumbini, Nepal; attained enlightenment beneath the Bodhi tree during the full lunar moon." }
      ]
    },
    {
      id: 2,
      name: "Mercury",
      glyph: "☿",
      factionName: "Hermetic Syndicate",
      epithet: "The Quicksilver Messengers",
      motto: "Nothing rests; language, intellect, and velocity bridge all horizons.",
      color: "#82bbf2",
      accent: "#9aa7c4",
      element: "Air",
      elementGlyph: "🜁",
      hermeticPrinciple: "Principle of Vibration & Information",
      archetype: "Quicksilver",
      tacticSummary: "Cunning probe leads; wins with minimum sufficient power and rapidly rotates table position.",
      warDoctrine: "The Hermetic Syndicate never wastes raw force. Their card leads are probing tests, designed to strip high opposing counters with minimal expenditure, executing sudden lane-swaps through sheer linguistic and cipher superiority.",
      astrology: {
        domicile: "Gemini (♊) & Virgo (♍)",
        exaltation: "Virgo (♍)",
        detriment: "Sagittarius (♐) & Pisces (♓)",
        fall: "Pisces (♓)",
        triplicity: "Air & Earth (Mixed)",
        day: "Wednesday",
        metal: "Quicksilver (Hydrargyrum)",
        gemstone: "Agate & Opal",
        bodyType: "Inner Winged Planet / Swiftest Messenger"
      },
      astronomy: {
        classification: "Terrestrial Planet / Swiftest Orbital Body",
        distance: "0.387 AU (57.9M km from Sun)",
        orbitalPeriod: "87.97 Earth days",
        radius: "2,439.7 km (0.383 × Earth)",
        surfaceTemp: "-180 °C to +430 °C",
        fact: "Locked in a 3:2 spin-orbit resonance: rotates three times on its axis for every two orbits around the Sun."
      },
      tarot: {
        major: {
          number: "I",
          name: "The Magician",
          title: "Magus of Power & Eloquence",
          archetype: "Will Directed, Elemental Conduit, Cunning Execution",
          gameEffect: "Caduceus Shift: Enables swapping a bench card mid-round and raises letter token values by +1.",
          flavor: "With one hand pointed to heaven and one to earth, he channels the four elemental tools atop his altar."
        },
        decans: [
          { card: "8 of Swords", degrees: "0°–10° Gemini", sign: "Gemini", suit: "Swords", meaning: "Shortened Force & Mental Labyrinth", desc: "A bound figure stands amid eight swords, awaiting the realization that the bonds are loose." },
          { card: "5 of Pentacles", degrees: "0°–10° Taurus", sign: "Taurus", suit: "Pentacles", meaning: "Material Trouble & Trial of Will", desc: "Two figures walk through blizzard outside a warm stained-glass sanctuary." },
          { card: "7 of Wands", degrees: "20°–30° Leo", sign: "Leo", suit: "Wands", meaning: "Valour & Defending the Summit", desc: "A solitary champion holds high ground against six thrusting staves." },
          { card: "3 of Swords", degrees: "10°–20° Libra", sign: "Libra", suit: "Swords", meaning: "Piercing Truth & Sorrow", desc: "Three blades pierce a crimson heart beneath rainclouds, purging delusions." },
          { card: "8 of Wands", degrees: "0°–10° Sagittarius", sign: "Sagittarius", suit: "Wands", meaning: "Swiftness & Electric Flight", desc: "Eight winged staves streak across clear skies toward immediate resolution." }
        ]
      },
      agents: [
        { handle: "Hypatia of Alexandria", year: "c. 360", role: "Hermetic Analytics", trait: "Neoplatonic Geometry", note: "Alexandria; mathematician and astronomer who perfected the astrolabe and hydrometer." },
        { handle: "William Shakespeare", year: "1564", role: "Master of Language", trait: "The Globe Theater", note: "Stratford-upon-Avon; immortal dramatist whose lexicon shaped the architecture of consciousness." },
        { handle: "Jane Austen", year: "1775", role: "Social Cartographer", trait: "Irony & Persuasion", note: "Steventon, England; sharp observer of human folly, wit, and moral dignity." },
        { handle: "Wolfgang Amadeus Mozart", year: "1756", role: "Lightning Prodigy", trait: "Symphonic Velocity", note: "Salzburg, Austria; transcribed celestial music directly from the sphere of Mercury without revision." },
        { handle: "Socrates", year: "469 BCE", role: "Dialectic Inquirer", trait: "Socratic Elenchus", note: "Athens; used precision questioning to dismantle hollow pride and reveal unexamined truths." },
        { handle: "Dante Alighieri", year: "1265", role: "Cosmic Poet", trait: "Terza Rima Cartography", note: "Florence; navigated the three realms with poetic meter and scholastic precision." },
        { handle: "Raphael Sanzio", year: "1483", role: "Harmonic Draughtsman", trait: "School of Athens", note: "Urbino, Italy; harmonized ancient philosophy and Renaissance perspective into visual perfection." },
        { handle: "John Locke", year: "1632", role: "Empiricist Architect", trait: "Tabula Rasa", note: "Somerset, England; grounded knowledge in direct sensory experience and civil liberty." },
        { handle: "Mary Wollstonecraft", year: "1759", role: "Advocate of Reason", trait: "Vindication of Rights", note: "London; argued that rational education is the universal birthright of all minds." },
        { handle: "Hildegard of Bingen", year: "1098", role: "Ecstatic Polymath", trait: "Lingua Ignota", note: "Holy Roman Empire; mystic, herbalist, and inventor of an esoteric sacred script." }
      ]
    },
    {
      id: 3,
      name: "Venus",
      glyph: "♀",
      factionName: "Concordian Enclave",
      epithet: "Phosphor of the Morning Star",
      motto: "In beauty and reciprocal harmony lies the invincible cohesion of all worlds.",
      color: "#76e0a8",
      accent: "#d98fb0",
      element: "Earth / Air",
      elementGlyph: "🜃",
      hermeticPrinciple: "Principle of Polarity & Harmonic Synthesis",
      archetype: "Concord",
      tacticSummary: "Harmonious synergy; leads off-suit court pairs without breaking melds; maximizes diplomatic bonuses.",
      warDoctrine: "The Concordian Enclave thrives on pairing and synergy. They specialize in multi-suit melds, turning otherwise weak cards into devastating coordinated strikes through court card combinations and diplomatic influence.",
      astrology: {
        domicile: "Taurus (♉) & Libra (♎)",
        exaltation: "Pisces (♓)",
        detriment: "Scorpio (♏) & Aries (♈)",
        fall: "Virgo (♍)",
        triplicity: "Earth & Air",
        day: "Friday",
        metal: "Refined Copper",
        gemstone: "Emerald & Rose Quartz",
        bodyType: "Morning & Evening Star (Phosphorus / Hesperus)"
      },
      astronomy: {
        classification: "Terrestrial Planet / Twin of Earth",
        distance: "0.723 AU (108.2M km from Sun)",
        orbitalPeriod: "224.7 Earth days",
        radius: "6,051.8 km (0.949 × Earth)",
        surfaceTemp: "465 °C (869 °F)",
        fact: "The brightest natural object in the night sky after the Moon, enveloped in permanent clouds of sulfuric reflective haze."
      },
      tarot: {
        major: {
          number: "III",
          name: "The Empress",
          title: "Daughter of the Mighty Ones",
          archetype: "Fertility, Creative Abundance, Sensual Harmony, Maternal Grace",
          gameEffect: "Living Garden: Grants +100 bonus points on meld combinations and shields friendly garrisons from attrition.",
          flavor: "Robed in pomegranates and crowned with twelve stars, she holds a copper scepter beside a waterfall of life."
        },
        decans: [
          { card: "4 of Wands", degrees: "20°–30° Aries", sign: "Aries", suit: "Wands", meaning: "Perfected Work & The Wedding Bower", desc: "Four flower-wreathed staves celebrate safe arrival and peaceful homecoming." },
          { card: "6 of Wands", degrees: "10°–20° Leo", sign: "Leo", suit: "Wands", meaning: "Victory & The Laurel Garland", desc: "A crowned horseman rides in triumph surrounded by cheering companions." },
          { card: "2 of Swords", degrees: "0°–10° Libra", sign: "Libra", suit: "Swords", meaning: "Peace Restored & Poise of Blades", desc: "A blindfolded figure balances two crossed swords over quiet coastal waters." },
          { card: "4 of Pentacles", degrees: "20°–30° Capricorn", sign: "Capricorn", suit: "Pentacles", meaning: "Earthly Power & Conserved Legacy", desc: "A seated monarch preserves his treasure beneath crown and feet." },
          { card: "7 of Pentacles", degrees: "20°–30° Taurus", sign: "Taurus", suit: "Pentacles", meaning: "Patient Growth & Unhurried Fruit", desc: "The gardener leans upon his spade, surveying the steady maturation of the vines." }
        ]
      },
      agents: [
        { handle: "John Dee", year: "1527", role: "Hermetic Diplomat", trait: "Enochian Harmony", note: "London; royal astrologer who sought the celestial language of angels and unified statecraft." },
        { handle: "Emily Dickinson", year: "1830", role: "Introspective Poet", trait: "Infinite Interior", note: "Amherst, USA; wove botanical mysteries, quiet love, and eternity into slant rhyme." },
        { handle: "Oscar Wilde", year: "1854", role: "Supreme Aesthete", trait: "The Art of Beauty", note: "Dublin; champion of aesthetic purity, sparkling wit, and art for art's sake." },
        { handle: "Cleopatra VII", year: "69 BCE", role: "Dynastic Queen", trait: "Nile Allure & Sovereign State", note: "Alexandria, Egypt; diplomat whose charisma and intellect united Mediterranean empires." },
        { handle: "Jalal ad-Din Rumi", year: "1207", role: "Ecstatic Mystic", trait: "The Flute of Union", note: "Balkh; Sufi poet whose verses dissolve all dualities in the ecstatic tavern of love." },
        { handle: "René Descartes", year: "1596", role: "Mathematical Philosopher", trait: "The Geometry of Harmony", note: "France; united algebra with geometry, seeking the elegant mathematical concord of reality." },
        { handle: "David Hume", year: "1711", role: "Gentle Skeptic", trait: "Passions & Sympathy", note: "Edinburgh; showed that moral sympathy and human affection, not cold logic, anchor life." },
        { handle: "Nikola Tesla", year: "1856", role: "Resonant Harmonizer", trait: "Radiant Energy", note: "Smiljan; envisioned a wireless globe vibrating in harmony with the Earth's electrical field." },
        { handle: "Sigmund Freud", year: "1856", role: "Architect of Desire", trait: "Eros & Unconscious Drive", note: "Vienna; brought the subterranean energies of Eros and love into analytical light." },
        { handle: "Murasaki Shikibu", year: "973", role: "Court Chronicler", trait: "Mono no Aware", note: "Kyoto, Japan; captured the bittersweet pathos of beauty, seasonal transience, and courtly grace." }
      ]
    },
    {
      id: 4,
      name: "Mars",
      glyph: "♂",
      factionName: "Martial Phalanx",
      epithet: "The Crimson Vanguard",
      motto: "Iron will, kinetic courage, and decisive impact forge destiny.",
      color: "#e26666",
      accent: "#cf4d4d",
      element: "Fire",
      elementGlyph: "🜂",
      hermeticPrinciple: "Principle of Cause and Effect & Kinetic Will",
      archetype: "Onslaught",
      tacticSummary: "Aggressive attack leads, direct siege pressure, immediate over-trumping, and armour-shredding assaults.",
      warDoctrine: "The Phalanx believes the only true defense is relentless offense. They rush open zones, challenge neutral custodians with raw attack stats, and play trumps early to break opponent control before they can fortify.",
      astrology: {
        domicile: "Aries (♈) & Scorpio (♏)",
        exaltation: "Capricorn (♑)",
        detriment: "Libra (♎) & Taurus (♉)",
        fall: "Cancer (♋)",
        triplicity: "Fire (Nocturnal)",
        day: "Tuesday",
        metal: "Meteoric Iron",
        gemstone: "Garnet, Ruby & Bloodstone",
        bodyType: "Outer Warrior Planet / The Red Planet"
      },
      astronomy: {
        classification: "Terrestrial Planet / Red Planet",
        distance: "1.524 AU (227.9M km from Sun)",
        orbitalPeriod: "686.97 Earth days (1.88 years)",
        radius: "3,389.5 km (0.532 × Earth)",
        surfaceTemp: "-140 °C to +20 °C",
        fact: "Home to Olympus Mons, the largest volcano in the solar system, standing three times higher than Mount Everest."
      },
      tarot: {
        major: {
          number: "XVI",
          name: "The Tower",
          title: "Lord of the Hosts of the Mighty",
          archetype: "Cataclysmic Breakthrough, Shattering False Fortresses, Liberation",
          gameEffect: "Breaching Strike: Destroys up to 150 points of hostile zone control upon taking a contested trick.",
          flavor: "A bolt of divine lightning strikes the crown of an arrogant stone citadel, casting down old dogmas."
        },
        decans: [
          { card: "2 of Wands", degrees: "0°–10° Aries", sign: "Aries", suit: "Wands", meaning: "Dominion & The Sovereign Grasp", desc: "A lord in scarlet robes looks out from battlements with the globe in his hand." },
          { card: "6 of Cups", degrees: "10°–20° Scorpio", sign: "Scorpio", suit: "Cups", meaning: "Pleasure & Martial Nostalgia", desc: "A boy offers a chalice of white blossoms to a maiden in the castle courtyard." },
          { card: "2 of Pentacles", degrees: "0°–10° Capricorn", sign: "Capricorn", suit: "Pentacles", meaning: "Harmonious Change in Motion", desc: "A figure dances on shifting shores, looping two coins within the infinite lemniscate." },
          { card: "10 of Cups", degrees: "20°–30° Pisces", sign: "Pisces", suit: "Cups", meaning: "Triumphant Peace after Battle", desc: "Ten golden cups arch as a rainbow over a joyful family upon their homeland." },
          { card: "9 of Wands", degrees: "10°–20° Sagittarius", sign: "Sagittarius", suit: "Wands", meaning: "Great Strength & The Unbroken Guard", desc: "The wounded warrior leans upon his staff, ever vigilant against the next charge." }
        ]
      },
      agents: [
        { handle: "Paracelsus", year: "1493", role: "Elemental Bombardier", trait: "Martian Elementals", note: "Einsiedeln, Switzerland; revolutionized medicine through iron salts, bold dosages, and chemical warfare on disease." },
        { handle: "Aristotle", year: "384 BCE", role: "Dialectic Warrior", trait: "The Iron Syllogism", note: "Stagira, Greece; tutor to Alexander the Great; forged the rigorous, unyielding weapons of classical logic." },
        { handle: "Niccolò Machiavelli", year: "1469", role: "Vanguard Realist", trait: "The Virtù of the Prince", note: "Florence; rejected hollow illusions, analyzing power, arms, and tactical audacity." },
        { handle: "Marie Curie", year: "1867", role: "Atomic Pioneer", trait: "Radioactive Courage", note: "Warsaw; endured lethal radiation to discover Radium and pioneer wartime mobile X-ray units." },
        { handle: "Donatello", year: "1386", role: "Bronze Striker", trait: "The St. George Stance", note: "Florence; carved warriors in tense, coiled readiness, redefining Renaissance martial stature." }
      ]
    },
    {
      id: 5,
      name: "Jupiter",
      glyph: "♃",
      factionName: "Jovian Ascendancy",
      epithet: "Lords of the Golden Wheel",
      motto: "Expansion is the natural law of the cosmos; fortune favors the generous.",
      color: "#f0a95e",
      accent: "#cf9a52",
      element: "Fire / Water",
      elementGlyph: "🜂",
      hermeticPrinciple: "Principle of Generative Expansion & Abundance",
      archetype: "Expansion",
      tacticSummary: "Bold early Major Arcana deployment to build table momentum and multiply total score.",
      warDoctrine: "The Jovian Ascendancy believes in abundance and rapid snowballing. They open with high-value Majors to seize control of multiple zones simultaneously, relying on multiplier scores to overwhelm conservative opponents.",
      astrology: {
        domicile: "Sagittarius (♐) & Pisces (♓)",
        exaltation: "Cancer (♋)",
        detriment: "Gemini (♊) & Virgo (♍)",
        fall: "Capricorn (♑)",
        triplicity: "Fire & Water",
        day: "Thursday",
        metal: "Pure Tin",
        gemstone: "Sapphire, Lapis Lazuli & Topaz",
        bodyType: "Greater Benefic / King of the Gas Giants"
      },
      astronomy: {
        classification: "Gas Giant / King of the Solar System",
        distance: "5.204 AU (778.5M km from Sun)",
        orbitalPeriod: "11.86 Earth years",
        radius: "69,911 km (10.97 × Earth)",
        surfaceTemp: "-110 °C at cloud tops",
        fact: "The Great Red Spot is an anticyclonic storm larger than Earth that has raged continuously for over 350 years."
      },
      tarot: {
        major: {
          number: "X",
          name: "Wheel of Fortune",
          title: "Lord of the Forces of Life",
          archetype: "Cyclic Karma, Sovereign Luck, Grand Expansion, Cosmic Turn",
          gameEffect: "Fortune's Boon: Multiplies zone victory point harvest by 1.5× and guarantees lucky draws from the rack.",
          flavor: "The Sphinx sits atop the turning wheel while Hermanubis ascends and Typhon descends in endless balance."
        },
        decans: [
          { card: "8 of Wands", degrees: "0°–10° Sagittarius", sign: "Sagittarius", suit: "Wands", meaning: "Swiftness & Projectiles of Fortune", desc: "Eight arrows of light surge through the expanse, accelerating toward targets." },
          { card: "10 of Wands", degrees: "20°–30° Sagittarius", sign: "Sagittarius", suit: "Wands", meaning: "The Sovereign Burden & Grand Scale", desc: "A bearer carries a bundle of ten staves toward a thriving walled city." },
          { card: "3 of Cups", degrees: "10°–20° Cancer", sign: "Cancer", suit: "Cups", meaning: "Abundance & Communal Celebration", desc: "Three maidens lift chalices in harvest dance under autumn vines." },
          { card: "9 of Pentacles", degrees: "10°–20° Virgo", sign: "Virgo", suit: "Pentacles", meaning: "Material Gain & Falcon of Solitude", desc: "A noblewoman in silk surveys heavy grape arbors with a hooded falcon upon her wrist." },
          { card: "6 of Swords", degrees: "10°–20° Aquarius", sign: "Aquarius", suit: "Swords", meaning: "Earned Journey to Wider Horizons", desc: "The boat crosses troubled shoals toward expansive philosophical clarity." }
        ]
      },
      agents: [
        { handle: "Lewis Carroll", year: "1832", role: "Logician of Paradox", trait: "Wonderland Expansion", note: "Cheshire, England; expanded the bounds of language and geometry through delightful, infinite nonsense." },
        { handle: "Mark Twain", year: "1835", role: "River Sage", trait: "Mississippi Horizons", note: "Missouri, USA; captured the sprawling, untamed humor and expansive heart of frontier humanity." },
        { handle: "Vincent van Gogh", year: "1853", role: "Ecstatic Visionary", trait: "Starry Night Swirl", note: "Zundert, Netherlands; expanded painting into swirling cosmic spirals of living color and empathy." },
        { handle: "Charles Darwin", year: "1809", role: "Evolutionary Master", trait: "The Tree of Life", note: "Shrewsbury, England; revealed the magnificent, branching abundance of all organic evolution." },
        { handle: "Edgar Allan Poe", year: "1809", role: "Gothic Cosmologist", trait: "Eureka & Cosmic Pulse", note: "Boston, USA; wrote 'Eureka', prophesying the expanding and contracting universe." },
        { handle: "Rachel Carson", year: "1907", role: "Ecological Prophet", trait: "The Sea Around Us", note: "Springdale, USA; celebrated the vast interconnected bounty of marine biology and terrestrial life." },
        { handle: "Chiron", year: "1977", role: "Centaur Guide", trait: "The Wounded Mentor", note: "Pasadena, USA; the astronomical bridge between Saturn's structure and Uranus's awakening." }
      ]
    },
    {
      id: 6,
      name: "Saturn",
      glyph: "♄",
      factionName: "Saturnine Citadel",
      epithet: "Keepers of the Great Threshold",
      motto: "Time tests all structures; endurance, discipline, and boundaries conquer the abyss.",
      color: "#998ab0",
      accent: "#9a937c",
      element: "Earth / Air",
      elementGlyph: "🜃",
      hermeticPrinciple: "Principle of Rhythm & Unyielding Boundary",
      archetype: "Endurance",
      tacticSummary: "Defensive hoarding; stores high Majors for the final-trick climax; highest zone defense resilience.",
      warDoctrine: "The Saturnine Citadel is built to withstand sieges. They garrison zones with fortified resilience, absorbing opposing charges while hoarding high-rank court cards and Majors for an unstoppable climax in the 12th trick.",
      astrology: {
        domicile: "Capricorn (♑) & Aquarius (♒)",
        exaltation: "Libra (♎)",
        detriment: "Cancer (♋) & Leo (♌)",
        fall: "Aries (♈)",
        triplicity: "Earth & Air",
        day: "Saturday",
        metal: "Ancient Lead",
        gemstone: "Onyx, Jet & Obsidian",
        bodyType: "Greater Malefic / Master of Time and Rings"
      },
      astronomy: {
        classification: "Gas Giant / Ringed Master of the Outer Solar System",
        distance: "9.582 AU (1.43B km from Sun)",
        orbitalPeriod: "29.46 Earth years",
        radius: "58,232 km (9.14 × Earth)",
        surfaceTemp: "-140 °C",
        fact: "Possesses a ring system stretching 282,000 km across yet less than 100 meters thick, composed of billions of ice fragments."
      },
      tarot: {
        major: {
          number: "XXI",
          name: "The World",
          title: "The Great One of the Night of Time",
          archetype: "Cosmic Completion, Synthesis, Final Culmination, The Threshold Closed",
          gameEffect: "Final Lock: Locks down trick 12 and prevents any enemy faction from stealing zone control on round close.",
          flavor: "A dancing dancer surrounded by the green laurel wreath and the four living creatures of the cardinal signs."
        },
        decans: [
          { card: "3 of Swords", degrees: "10°–20° Libra", sign: "Libra", suit: "Swords", meaning: "Sorrow & Severing Clarity", desc: "Three swords pierce a heart beneath rain, burning away romantic illusion with cold truth." },
          { card: "7 of Pentacles", degrees: "20°–30° Taurus", sign: "Taurus", suit: "Pentacles", meaning: "Success Unfulfilled & Prudence", desc: "The farmer rests upon his staff, waiting through long winters for the grapes to ripen." },
          { card: "8 of Pentacles", degrees: "20°–30° Virgo", sign: "Virgo", suit: "Pentacles", meaning: "Apprenticeship & Daily Mastery", desc: "The craftsman chisels stone coin after stone coin with tireless monastic devotion." },
          { card: "5 of Swords", degrees: "0°–10° Aquarius", sign: "Aquarius", suit: "Swords", meaning: "Strategic Retreat & Lord of Loss", desc: "A smiling victor collects five swords while the defeated walk slowly toward stormy seas." },
          { card: "10 of Swords", degrees: "20°–30° Gemini", sign: "Gemini", suit: "Swords", meaning: "Ruin Transcended & Dawn After Dark", desc: "Ten swords pin the past to the earth, while gold light breaks across the distant mountains." }
        ]
      },
      agents: [
        { handle: "Isaac Newton", year: "1643", role: "Saturnine Vanguard", trait: "Gravitational Hoard", note: "Woolsthorpe, England; formulated the universal laws of gravitation, calculus, and celestial mechanics." },
        { handle: "Alexander the Great", year: "356 BCE", role: "Empire Builder", trait: "The Gordian Knot", note: "Macedon; united the ancient world to the Indus, testing the limits of mortal kingship." },
        { handle: "Archimedes", year: "287 BCE", role: "Master Engineer", trait: "The Archimedean Lever", note: "Syracuse; mathematician who calculated pi and designed siege machinery that held Roman fleets at bay." },
        { handle: "Herodotus", year: "484 BCE", role: "Father of History", trait: "The Written Record", note: "Halicarnassus; preserved the memories and wars of humanity against the erosion of time." },
        { handle: "Marcus Tullius Cicero", year: "106 BCE", role: "Roman Stoic", trait: "De Re Publica", note: "Arpinum, Rome; defender of the rule of law, virtue, and republican institutions." },
        { handle: "Julius Caesar", year: "100 BCE", role: "Calendar Architect", trait: "Crossing the Rubicon", note: "Rome; re-engineered the solar calendar and laid the stone foundations of imperial Rome." },
        { handle: "Homer", year: "750 BCE", role: "Blind Bard", trait: "The Epic Hex构建", note: "Ionia; carved the monumental Trojan saga and the Odyssey into Western memory." },
        { handle: "Geoffrey Chaucer", year: "1343", role: "Pilgrim Chronicler", trait: "Canterbury Architecture", note: "London; captured the diverse social strata of medieval England in enduring vernacular verse." },
        { handle: "Johannes Kepler", year: "1571", role: "Elliptical Prophet", trait: "Harmonices Mundi", note: "Weil der Stadt; derived the three laws of planetary motion from Brahe's rigorous data." },
        { handle: "Isaac Asimov", year: "1920", role: "Psychohistorian", trait: "The Foundation Plan", note: "Russia / USA; conceived the Seldon Plan to navigate thousands of years of galactic collapse." },
        { handle: "Benjamin Franklin", year: "1706", role: "Civic Polymath", trait: "Poor Richard's Prudence", note: "Boston, USA; printer, inventor, diplomat, and architect of constitutional foundations." },
        { handle: "Joan of Arc", year: "1412", role: "Maid of Orléans", trait: "Iron Martyrdom", note: "Domrémy, France; peasant girl whose unyielding faith lifted the Siege of Orléans." },
        { handle: "Sojourner Truth", year: "1797", role: "Voice of Iron Truth", trait: "Ain't I a Woman?", note: "New York; escaped enslavement and stood as an immovable pillar for emancipation and suffrage." }
      ]
    },
    {
      id: 7,
      name: "Uranus",
      glyph: "♅",
      factionName: "Uranian Prometheans",
      epithet: "Breakers of the Spheres",
      motto: "The Universe is Mental; sudden illumination rewrites the code of reality.",
      color: "#66d9e8",
      accent: "#5fb6c4",
      element: "Air / Aether",
      elementGlyph: "🜁",
      hermeticPrinciple: "Principle of Mentalism & Transcendent Innovation",
      archetype: "Upheaval",
      tacticSummary: "Unpredictable plays, tactical Excuse / cross-suit disruption, shattering entrenched lines.",
      warDoctrine: "The Prometheans disdain orthodoxy. They deploy unconventional card ranks, cross-suit leads, and the Fool's Excuse to shatter predictable opponent strategies and overturn fortified positions in a single stroke.",
      astrology: {
        domicile: "Aquarius (♒) [Modern]",
        exaltation: "Scorpio (♏)",
        detriment: "Leo (♌)",
        fall: "Taurus (♉)",
        triplicity: "Air / Electric Aether",
        day: "Wednesday (Electric Cycle)",
        metal: "Uranium & Platinum",
        gemstone: "Aquamarine & Blue Tourmaline",
        bodyType: "Ice Giant tilted 97.8° on its side"
      },
      astronomy: {
        classification: "Ice Giant / Tilted Outlier",
        distance: "19.22 AU (2.87B km from Sun)",
        orbitalPeriod: "84.02 Earth years",
        radius: "25,362 km (4.01 × Earth)",
        surfaceTemp: "-224 °C (Coldest atmosphere)",
        fact: "Rotates on its side with an axial tilt of 97.8°, causing 42 years of continuous sunlight followed by 42 years of darkness at its poles."
      },
      tarot: {
        major: {
          number: "0",
          name: "The Fool",
          title: "Spirit of Aether",
          archetype: "Cosmic Spark, Divine Innocence, The Zero Point, Infinite Potential",
          gameEffect: "The Electric Excuse: May be played to any trick to evade capture penalties or completely redirect suit requirements.",
          flavor: "A youth stands upon the cliff edge with a white rose in hand and a dog leaping beside him into the sunlit abyss."
        },
        decans: [
          { card: "7 of Swords", degrees: "20°–30° Aquarius", sign: "Aquarius", suit: "Swords", meaning: "Tactical Infiltration & Unorthodox Plan", desc: "A figure slips away from the camp carrying five swords while two remain planted." },
          { card: "Ace of Swords", degrees: "Root of Air", sign: "Air Trine", suit: "Swords", meaning: "The Lightning Bolt of Truth", desc: "A hand emerges from clouds holding an upright blade crowned with olive and palm." },
          { card: "King of Swords", degrees: "Fixed Air", sign: "Aquarius", suit: "Swords", meaning: "Architect of Absolute Law", desc: "A seated sovereign commands judgment with drawn vertical blade." }
        ]
      },
      agents: [
        { handle: "Ada Lovelace", year: "1815", role: "Algorithmic Enchantress", trait: "The First Algorithm", note: "London; envisioned the Analytical Engine calculating music, graphics, and transcendent symbols." },
        { handle: "Carl Sagan", year: "1934", role: "Cosmic Prophet", trait: "The Pale Blue Dot", note: "Brooklyn, USA; ignited billions of minds to see Earth as a lonely speck in the cosmic dark." },
        { handle: "Marcus Aurelius", year: "121", role: "Stoic Emperor", trait: "Meditations in the Camp", note: "Rome; ruled an empire while reminding himself that all worldly glory is transient smoke." },
        { handle: "Thomas Aquinas", year: "1225", role: "Scholastic Synthesizer", trait: "Summa Theologiae", note: "Sicily; boldly synthesized Christian theology with Aristotelian pagan philosophy." },
        { handle: "Charles Dickens", year: "1812", role: "Social Upheaval Bard", trait: "A Tale of Two Cities", note: "Portsmouth, England; held a mirror to industrial poverty and revolutionary fever." },
        { handle: "Confucius", year: "551 BCE", role: "Virtue Reformer", trait: "The Ren & Li Mandate", note: "Lu State, China; transformed chaotic feudal warring states into a civilization grounded in ethical virtue." },
        { handle: "Lao Tzu", year: "601 BCE", role: "Master of the Tao", trait: "Wu Wei Non-Action", note: "Henan, China; author of the Tao Te Ching; taught that the softest water overcomes the hardest rock." },
        { handle: "Paulo Freire", year: "1921", role: "Critical Liberator", trait: "Pedagogy of Hope", note: "Recife, Brazil; broke the culture of silence through education as the practice of freedom." }
      ]
    },
    {
      id: 8,
      name: "Neptune",
      glyph: "♆",
      factionName: "Neptunian Mystics",
      epithet: "Voyagers of the Abyssal Void",
      motto: "Forms dissolve so essence may reunite; beyond the veil lies the boundless sea.",
      color: "#4e7cd9",
      accent: "#6470c8",
      element: "Water",
      elementGlyph: "🜄",
      hermeticPrinciple: "Principle of Oceanic Dissolution & Mysticism",
      archetype: "Dissolution",
      tacticSummary: "Evasive sloughing; lets rivals exhaust trumps against each other, then claims the wreckage.",
      warDoctrine: "The Neptunian Mystics win by disappearing. They yield early clashes, allowing aggressive factions to deplete their high trumps fighting each other, before surfacing from the mist to capture depleted zones with minimal resistance.",
      astrology: {
        domicile: "Pisces (♓) [Modern]",
        exaltation: "Cancer (♋) & Leo (♌)",
        detriment: "Virgo (♍)",
        fall: "Capricorn (♑)",
        triplicity: "Water (Subconscious)",
        day: "Monday / Deep Tide",
        metal: "Neptunium & Liquid Silver",
        gemstone: "Amethyst & Celestite",
        bodyType: "Furthest Ice Giant / Master of Blue Storms"
      },
      astronomy: {
        classification: "Ice Giant / Outermost Giant Planet",
        distance: "30.07 AU (4.50B km from Sun)",
        orbitalPeriod: "164.8 Earth years",
        radius: "24,622 km (3.86 × Earth)",
        surfaceTemp: "-218 °C",
        fact: "Possesses the fastest winds in the solar system, whipping through upper methane clouds at up to 2,100 km/h."
      },
      tarot: {
        major: {
          number: "XII",
          name: "The Hanged Man",
          title: "Lord of the Waters of Grace",
          archetype: "Surrender of Ego, Inverted Perspective, Mystic Stillness, Suspension in Void",
          gameEffect: "Mist of Oblivion: Shrouds trick score values until reveal and turns opponent over-trumps into neutral discards.",
          flavor: "Suspended by one foot from the living T-cross of wood, his head glowing with a halo of serene insight."
        },
        decans: [
          { card: "9 of Cups", degrees: "10°–20° Pisces", sign: "Pisces", suit: "Cups", meaning: "Material Happiness & The Wish Card", desc: "A merchant sits before an arched display of nine overflowing chalices in contentment." },
          { card: "10 of Cups", degrees: "20°–30° Pisces", sign: "Pisces", suit: "Cups", meaning: "Perpetual Ocean of Concord", desc: "A family gazes up at ten celestial cups spanning the clearing after the tempest." },
          { card: "King of Cups", degrees: "Mutable Water", sign: "Pisces", suit: "Cups", meaning: "Sovereign of Subconscious Depths", desc: "A crowned king floats upon a stone throne above a turbulent, living sea." }
        ]
      },
      agents: [
        { handle: "Mary Shelley", year: "1797", role: "Mystic Galvanist", trait: "Frankenstein's Vision", note: "London; dreamed the modern Prometheus, wedding gothic sublime with scientific Hubris." },
        { handle: "Tecumseh", year: "1768", role: "Shawnee Prophet", trait: "The Great Confederacy", note: "Ohio Territory; visionary orator who sought to unite all indigenous nations as one indivisible tide." },
        { handle: "Sitting Bull", year: "1831", role: "Lakota Holy Man", trait: "Sun Dance Vision", note: "Dakota Territory; Hunkpapa Lakota holy man who stood immovable for the sacred lands of the Black Hills." }
      ]
    },
    {
      id: 9,
      name: "Pluto",
      glyph: "♇",
      factionName: "Chthonic Dynasty",
      epithet: "Transmuters of the Underworld",
      motto: "Out of darkness arises rebirth; nothing is destroyed that cannot be transmuted.",
      color: "#705988",
      accent: "#8a6aa0",
      element: "Water / Subterranean Fire",
      elementGlyph: "🜄",
      hermeticPrinciple: "Principle of Gender & Inevitable Transmutation",
      archetype: "Transformation",
      tacticSummary: "Endgame transformation sweeps once trumps are depleted; highest clutch comeback potential.",
      warDoctrine: "The Chthonic Dynasty lurks in the graveyard of the table. Their cards grow stronger as cards are burned and tricks are lost, executing devastating resurrection sweeps in the late tricks that reverse deficit scores into victory.",
      astrology: {
        domicile: "Scorpio (♏) [Modern]",
        exaltation: "Aries (♈) & Pisces (♓)",
        detriment: "Taurus (♉)",
        fall: "Libra (♎)",
        triplicity: "Water & Underworld Fire",
        day: "Tuesday (Eclipse Cycle)",
        metal: "Plutonium & Volcanic Obsidian",
        gemstone: "Black Diamond & Garnet",
        bodyType: "Kuiper Belt Dwarf Planet / Lord of the Underworld"
      },
      astronomy: {
        classification: "Kuiper Belt Dwarf Planet",
        distance: "39.48 AU (5.91B km from Sun)",
        orbitalPeriod: "248.0 Earth years",
        radius: "1,188.3 km (0.187 × Earth)",
        surfaceTemp: "-230 °C",
        fact: "Features Sputnik Planitia, a heart-shaped glacier of nitrogen and methane ice that continually churns and renews its surface."
      },
      tarot: {
        major: {
          number: "XX",
          name: "Judgement",
          title: "The Spirit of the Primal Fire",
          archetype: "Resurrection, The Final Trumpet, Irrevocable Awakening, Transmutation",
          gameEffect: "Chthonic Reckoning: Revives fallen discard cards back to hand and steals 50% of the trick pot on final trick.",
          flavor: "The archangel sounds the golden trumpet from the heavens as figures rise liberated from their stone tombs."
        },
        decans: [
          { card: "5 of Cups", degrees: "0°–10° Scorpio", sign: "Scorpio", suit: "Cups", meaning: "Loss & The Two Full Cups", desc: "A cloaked figure mourns three spilled cups, yet two remain standing behind him." },
          { card: "Death (XIII)", degrees: "Fixed Water", sign: "Scorpio", suit: "Major", meaning: "The Scythe of Transmutation", desc: "The black-armored knight carries the white mystic rose as old kings perish and the sun rises." },
          { card: "Queen of Cups", degrees: "Deep Underworld", sign: "Scorpio", suit: "Cups", meaning: "Keeper of the Subterranean Chalice", desc: "The queen contemplates a closed, ornate pyx by the edge of ancient waters." }
        ]
      },
      agents: [
        { handle: "Leonardo da Vinci", year: "1452", role: "Universal Magus", trait: "The Vitruvian Mystery", note: "Vinci, Italy; dissected corpses in torchlight to map the divine anatomy of resurrection and light." },
        { handle: "Fyodor Dostoevsky", year: "1821", role: "Chronicler of the Abyss", trait: "Resurrection from the Dead House", note: "Moscow; survived execution to delve into the deepest psychology of sin, guilt, and divine grace." },
        { handle: "Voltaire", year: "1694", role: "Searing Satirist", trait: "Candide's Garden", note: "Paris; struck down superstition and ecclesiastical tyranny with incandescent wit." },
        { handle: "Mahatma Gandhi", year: "1869", role: "Transmuter of Empire", trait: "Satyagraha Soul Force", note: "Porbandar, India; transmuted political violence through nonviolent soul force and fasting." }
      ]
    }
  ];

  // ── CONTROLLER STATE ──────────────────────────────────────────────────────
  let activeFactionId = 0;
  let activeTab = "overview"; // 'overview' | 'planet' | 'tarot' | 'agents'
  let agentSearchQuery = "";
  let escHandler = null;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── LIVE GAME STATE HELPERS ───────────────────────────────────────────────
  function getLiveStanding(factionId) {
    const st = window.state;
    if (!st || !Array.isArray(st.leaderboard)) {
      return { rank: factionId + 1, score: 0, decanWins: 0, isCurrentDecanRuler: false, zonesHeld: [] };
    }
    const idx = st.leaderboard.findIndex((item) => item.id === factionId);
    const item = idx >= 0 ? st.leaderboard[idx] : { score: 0, decanWins: 0 };
    const decanWins = (st.decanVictories && st.decanVictories[factionId]) || item.decanWins || 0;

    let isCurrentDecanRuler = false;
    let currentDecanInfo = null;
    if (typeof st.getCurrentDecan === "function") {
      try {
        currentDecanInfo = st.getCurrentDecan();
        if (currentDecanInfo && currentDecanInfo.rulerFaction === factionId) {
          isCurrentDecanRuler = true;
        }
      } catch (e) {}
    }

    const zonesHeld = [];
    if (Array.isArray(st.map)) {
      st.map.forEach((z) => {
        if (z.owner === factionId) {
          const kindName = z.kind === "house" ? `House ${z.zone_id}` : (z.kind === "spire" ? `Spire ${z.zone_id}` : "The Crown");
          zonesHeld.push({ zoneId: z.zone_id, name: kindName, control: z.control });
        }
      });
    }

    return {
      rank: idx >= 0 ? idx + 1 : 10,
      score: item.score || 0,
      decanWins,
      isCurrentDecanRuler,
      currentDecanInfo,
      zonesHeld
    };
  }

  function isPlayerFaction(factionId) {
    try {
      const p = window.state && window.state.player;
      return p && p.faction === factionId;
    } catch {
      return false;
    }
  }

  // ── VIEW RENDERING ────────────────────────────────────────────────────────
  function renderFactionPage() {
    const ov = document.getElementById("faction-page-overlay");
    if (!ov) return;

    const data = FACTIONS_DATA[activeFactionId] || FACTIONS_DATA[0];
    const live = getLiveStanding(activeFactionId);
    const isPlayer = isPlayerFaction(activeFactionId);

    ov.innerHTML = `
      <div class="faction-window" style="--faction-color: ${data.color}; --faction-accent: ${data.accent};">
        <!-- Close Button -->
        <button class="faction-close-btn" onclick="closeFactionPage()" title="Close Dossier (Esc)" aria-label="Close">✕</button>

        <!-- Top Planetary Selector Ribbon -->
        <header class="faction-ribbon" role="tablist" aria-label="Planetary Factions">
          ${FACTIONS_DATA.map((f) => {
            const fLive = getLiveStanding(f.id);
            const activeClass = f.id === activeFactionId ? "active" : "";
            const decanCrown = fLive.isCurrentDecanRuler ? `<span class="ribbon-decan-crown" title="Active 10-day Decan Lord">👑</span>` : "";
            return `
              <button
                type="button"
                role="tab"
                aria-selected="${f.id === activeFactionId}"
                class="faction-ribbon-btn ${activeClass}"
                style="--btn-col: ${f.color};"
                onclick="switchFactionPage(${f.id})"
                title="${f.name} · #${fLive.rank} (${fLive.score} pts)"
              >
                <span class="ribbon-glyph">${f.glyph}</span>
                <span class="ribbon-name">${f.name}</span>
                <span class="ribbon-rank">#${fLive.rank}</span>
                ${decanCrown}
              </button>
            `;
          }).join("")}
        </header>

        <!-- Faction Hero Banner -->
        <div class="faction-hero">
          <div class="faction-crest" style="border-color: ${data.color}; box-shadow: 0 0 35px ${data.color}33;">
            <div class="faction-crest-glyph" style="color: ${data.color};">${data.glyph}</div>
            <div class="faction-crest-element" title="Element: ${data.element}">${data.elementGlyph}</div>
          </div>

          <div class="faction-hero-text">
            <div class="faction-eyebrow">
              <span>PLANETARY FACTION #${activeFactionId}</span>
              ${isPlayer ? `<span class="faction-allegiance-badge">★ YOUR ALLEGIANCE</span>` : ""}
              ${live.isCurrentDecanRuler ? `<span class="faction-decan-lord-badge">👑 ACTIVE DECAN LORD</span>` : ""}
            </div>
            <h1 class="faction-title">
              <span class="faction-glyph-inline">${data.glyph}</span>
              ${data.factionName}
            </h1>
            <p class="faction-epithet">✦ ${data.epithet} ✦</p>
            <p class="faction-motto">“${esc(data.motto)}”</p>
          </div>

          <!-- Live Standings Card -->
          <div class="faction-standings-card">
            <div class="f-stat-item">
              <div class="f-stat-label">CURRENT RANK</div>
              <div class="f-stat-value gold">#${live.rank} <span class="f-stat-sub">/ 10</span></div>
            </div>
            <div class="f-stat-item">
              <div class="f-stat-label">WAR SCORE</div>
              <div class="f-stat-value">${live.score.toLocaleString()} <span class="f-stat-sub">pts</span></div>
            </div>
            <div class="f-stat-item">
              <div class="f-stat-label">DECAN WINS</div>
              <div class="f-stat-value crown">${live.decanWins} <span class="f-stat-sub">👑 crowns</span></div>
            </div>
            <div class="f-stat-item">
              <div class="f-stat-label">ZONES HELD</div>
              <div class="f-stat-value">${live.zonesHeld.length} <span class="f-stat-sub">zones</span></div>
            </div>
          </div>
        </div>

        <!-- Section Navigation Tabs -->
        <nav class="faction-subtabs" role="tablist">
          <button class="faction-tab-btn ${activeTab === 'overview' ? 'active' : ''}" onclick="setFactionTab('overview')">
            ✦ Doctrine & Strategy
          </button>
          <button class="faction-tab-btn ${activeTab === 'planet' ? 'active' : ''}" onclick="setFactionTab('planet')">
            🪐 Planet & Astrology
          </button>
          <button class="faction-tab-btn ${activeTab === 'tarot' ? 'active' : ''}" onclick="setFactionTab('tarot')">
            🎴 Tarot Correspondences
          </button>
          <button class="faction-tab-btn ${activeTab === 'agents' ? 'active' : ''}" onclick="setFactionTab('agents')">
            👥 Sworn Historical Agents (${data.agents.length})
          </button>
        </nav>

        <!-- Tab Body Content -->
        <div class="faction-content-pane">
          ${renderTabContent(data, live)}
        </div>
      </div>
    `;

    // Wire search handler if on agents tab
    if (activeTab === "agents") {
      const inp = document.getElementById("agent-roster-search");
      if (inp) {
        inp.value = agentSearchQuery;
        inp.oninput = (e) => {
          agentSearchQuery = e.target.value.toLowerCase().trim();
          filterAgentCards();
        };
      }
    }
  }

  function renderTabContent(data, live) {
    if (activeTab === "overview") {
      return renderOverviewTab(data, live);
    } else if (activeTab === "planet") {
      return renderPlanetTab(data);
    } else if (activeTab === "tarot") {
      return renderTarotTab(data, live);
    } else if (activeTab === "agents") {
      return renderAgentsTab(data);
    }
    return "";
  }

  // ── TAB: OVERVIEW & DOCTRINE ──────────────────────────────────────────────
  function renderOverviewTab(data, live) {
    const controlledZonesHtml = live.zonesHeld.length > 0
      ? live.zonesHeld.map((z) => `
          <div class="zone-pill" style="border-color: ${data.color}66; background: ${data.color}14;">
            <span class="zp-name">${z.name}</span>
            <span class="zp-ctrl" style="color:${data.color};">${z.control} / 1000 ctrl</span>
          </div>
        `).join("")
      : `<div class="f-dim-note">Currently contesting frontiers; no exclusive zone holds claimed this round.</div>`;

    return `
      <div class="f-grid-two-col">
        <!-- Left: Doctrine & Archetype -->
        <div class="f-card-panel">
          <h3 class="f-panel-title">⚔ War Table Archetype: ${data.archetype}</h3>
          <div class="f-tactic-badge" style="background: ${data.color}22; color: ${data.color}; border: 1px solid ${data.color}55;">
            ${data.tacticSummary}
          </div>
          <p class="f-body-p" style="margin-top: 14px;">${data.warDoctrine}</p>

          <h4 class="f-subhead" style="margin-top: 20px;">✦ Hermetic Principle</h4>
          <p class="f-principle-box">
            <b>${data.hermeticPrinciple}</b><br>
            <span style="font-style: italic; color: var(--dim); margin-top: 4px; display:inline-block;">“${esc(data.motto)}”</span>
          </p>

          <h4 class="f-subhead" style="margin-top: 18px;">✦ Combat Synergies</h4>
          <ul class="f-list-bullets">
            <li><b>Elemental Affinity:</b> Favored in all <b>${data.element}</b> zones (${data.elementGlyph}) with natural meld amplifications.</li>
            <li><b>Signature Card:</b> Summons <b>${data.tarot.major.name} (${data.tarot.major.number})</b> to dominate key trick resolutions.</li>
            <li><b>Decan Lordship:</b> Commands <b>${data.tarot.decans.length}</b> Minor Arcana decan rounds, earning the Chaldean +25 Melds bonus during solar alignment.</li>
          </ul>
        </div>

        <!-- Right: Current War Board Status -->
        <div class="f-card-panel">
          <h3 class="f-panel-title">🏰 Live Territory & Deployment</h3>

          <div style="margin-bottom: 16px;">
            <div class="f-subhead" style="margin-bottom: 8px;">Zones Currently Controlled</div>
            <div class="f-zones-wrap">
              ${controlledZonesHtml}
            </div>
          </div>

          <div style="margin-top: 20px;">
            <div class="f-subhead" style="margin-bottom: 8px;">10-Day Solar Decan Status</div>
            ${live.isCurrentDecanRuler ? `
              <div class="decan-status-box active" style="border-color: ${data.color}; background: ${data.color}15;">
                <div style="font-size: 13px; font-weight: bold; color: ${data.color};">👑 FACTION IS CURRENT SOLAR DECAN LORD</div>
                <div style="font-size: 11px; color: var(--text); margin-top: 4px;">
                  The Sun is transiting ${live.currentDecanInfo ? live.currentDecanInfo.card : 'your decan'}. All ${data.name} contenders gain the <b>+25 Chaldean Melds Dignity bonus</b> in live Melee War Tables.
                </div>
              </div>
            ` : `
              <div class="decan-status-box" style="border-color: var(--line); background: rgba(10,14,24,0.6);">
                <div style="font-size: 12px; color: var(--dim);">Awaiting Solar Transit Decan</div>
                <div style="font-size: 10.5px; color: var(--faint); margin-top: 4px;">
                  Active Decan ruler gains crown victories and seasonal points upon transit completion.
                </div>
              </div>
            `}
          </div>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line);">
            <div class="f-subhead" style="margin-bottom: 6px;">Sworn Historical Cadre</div>
            <div style="font-size: 12px; color: var(--dim);">
              <b>${data.agents.length} legendary historical agents</b> are natal-bound to ${data.name}, defending zones and participating in autonomous Melee Manifold battles.
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── TAB: PLANET & ASTROLOGY ───────────────────────────────────────────────
  function renderPlanetTab(data) {
    const a = data.astrology;
    const s = data.astronomy;

    return `
      <div class="f-grid-two-col">
        <!-- Astrological Essential Dignities -->
        <div class="f-card-panel">
          <h3 class="f-panel-title">✦ Essential Dignities & Correspondences</h3>
          <div class="f-dignity-table">
            <div class="dignity-row">
              <span class="dignity-tag domicile">Domicile (Rulership)</span>
              <span class="dignity-val">${a.domicile}</span>
            </div>
            <div class="dignity-row">
              <span class="dignity-tag exaltation">Exaltation (+3)</span>
              <span class="dignity-val">${a.exaltation}</span>
            </div>
            <div class="dignity-row">
              <span class="dignity-tag detriment">Detriment (-3)</span>
              <span class="dignity-val">${a.detriment}</span>
            </div>
            <div class="dignity-row">
              <span class="dignity-tag fall">Fall (-5)</span>
              <span class="dignity-val">${a.fall}</span>
            </div>
            <div class="dignity-row">
              <span class="dignity-tag neutral">Triplicity & Nature</span>
              <span class="dignity-val">${a.triplicity}</span>
            </div>
          </div>

          <h4 class="f-subhead" style="margin-top: 20px;">✦ Hermetic Correspondences</h4>
          <div class="f-corr-grid">
            <div class="corr-box">
              <span class="corr-k">Sacred Metal</span>
              <span class="corr-v">${a.metal}</span>
            </div>
            <div class="corr-box">
              <span class="corr-k">Day of Week</span>
              <span class="corr-v">${a.day}</span>
            </div>
            <div class="corr-box">
              <span class="corr-k">Gemstone</span>
              <span class="corr-v">${a.gemstone}</span>
            </div>
            <div class="corr-box">
              <span class="corr-k">Classification</span>
              <span class="corr-v">${a.bodyType}</span>
            </div>
          </div>
        </div>

        <!-- Astronomical Science & Physical Coordinates -->
        <div class="f-card-panel">
          <h3 class="f-panel-title">🔭 Astronomical Profile</h3>
          <div class="f-astro-specs">
            <div class="spec-line">
              <span class="spec-label">Body Class</span>
              <span class="spec-data">${s.classification}</span>
            </div>
            <div class="spec-line">
              <span class="spec-label">Mean Distance</span>
              <span class="spec-data">${s.distance}</span>
            </div>
            <div class="spec-line">
              <span class="spec-label">Orbital Period</span>
              <span class="spec-data">${s.orbitalPeriod}</span>
            </div>
            <div class="spec-line">
              <span class="spec-label">Mean Radius</span>
              <span class="spec-data">${s.radius}</span>
            </div>
            <div class="spec-line">
              <span class="spec-label">Effective Temp</span>
              <span class="spec-data">${s.surfaceTemp}</span>
            </div>
          </div>

          <div class="f-fact-callout" style="border-left-color: ${data.color};">
            <div style="font-weight: bold; color: var(--gold-bright); font-size: 11px; margin-bottom: 4px;">CELESTIAL FACT</div>
            <div style="font-size: 12px; color: var(--text); line-height: 1.5;">${s.fact}</div>
          </div>
        </div>
      </div>
    `;
  }

  // ── TAB: TAROT CORRESPONDENCES ────────────────────────────────────────────
  function renderTarotTab(data, live) {
    const maj = data.tarot.major;
    const decans = data.tarot.decans;

    return `
      <div class="tarot-tab-container">
        <!-- Major Arcana Showcase Banner -->
        <div class="major-showcase-card" style="border-color: ${data.color}88; background: radial-gradient(circle at 80% 20%, ${data.color}1a, rgba(14,17,29,0.95));">
          <div class="major-card-graphic" style="border-color: ${data.color};">
            <div class="major-numeral">${maj.number}</div>
            <div class="major-card-glyph" style="color: ${data.color};">${data.glyph}</div>
            <div class="major-card-name">${maj.name}</div>
          </div>

          <div class="major-card-info">
            <div class="major-eyebrow">MAJOR ARCANA SIGNATURE CARD · ${maj.number}</div>
            <h2 class="major-title" style="color: ${data.color};">${maj.name}</h2>
            <div class="major-subtitle">✦ ${maj.title} ✦</div>
            <p class="major-archetype-desc">${maj.archetype}</p>

            <div class="major-game-power" style="border-color: ${data.color}44; background: ${data.color}11;">
              <span class="mg-badge">COMBAT PASSIVE</span>
              <span class="mg-text"><b>${maj.gameEffect}</b></span>
            </div>

            <p class="major-flavor-quote">“${maj.flavor}”</p>
          </div>
        </div>

        <!-- Minor Arcana Decan Cards Grid -->
        <div style="margin-top: 26px;">
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px;">
            <h3 class="f-panel-title" style="margin: 0;">🎴 Ruled Minor Arcana & 10-Day Decans</h3>
            <span style="font-size: 11px; color: var(--dim);">Chaldean Decan Lord Association</span>
          </div>

          <div class="decans-grid">
            ${decans.map((d) => {
              const suitCol = SUIT_COLORS[d.suit] || "var(--gold)";
              const suitGlyph = SUIT_GLYPHS[d.suit] || "✦";
              const isCurrent = live.currentDecanInfo && live.currentDecanInfo.card === d.card;

              return `
                <div class="decan-card ${isCurrent ? 'is-active-now' : ''}" style="--suit-col: ${suitCol};">
                  ${isCurrent ? `<div class="decan-active-flag">👑 CURRENT ROUND</div>` : ""}
                  <div class="decan-header">
                    <span class="decan-card-title">${d.card}</span>
                    <span class="decan-suit-glyph" style="color: ${suitCol};">${suitGlyph}</span>
                  </div>
                  <div class="decan-coords">${d.degrees}</div>
                  <div class="decan-meaning" style="color: ${suitCol};">${d.meaning}</div>
                  <p class="decan-desc">${d.desc}</p>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      </div>
    `;
  }

  // ── TAB: HISTORICAL AGENTS ────────────────────────────────────────────────
  function renderAgentsTab(data) {
    return `
      <div>
        <div class="agents-controls-bar">
          <div>
            <h3 class="f-panel-title" style="margin: 0;">Sworn Historical Agents</h3>
            <div style="font-size: 11px; color: var(--dim); margin-top: 2px;">
              Historical figures whose natal charts align with ${data.name}'s dominion.
            </div>
          </div>
          <div class="agents-search-wrapper">
            <span class="agents-search-icon">🔍</span>
            <input
              type="text"
              id="agent-roster-search"
              class="agents-search-input"
              placeholder="Search historical agents..."
              autocomplete="off"
            />
          </div>
        </div>

        <div id="agents-grid-container" class="agents-grid">
          ${data.agents.map((ag) => renderAgentCard(ag, data)).join("")}
        </div>
      </div>
    `;
  }

  function renderAgentCard(ag, data) {
    return `
      <div class="agent-roster-card" data-agent-name="${esc(ag.handle.toLowerCase())}" data-agent-trait="${esc(ag.trait.toLowerCase())}" style="border-left-color: ${data.color};">
        <div class="arc-header">
          <div>
            <div class="arc-handle">${esc(ag.handle)}</div>
            <div class="arc-year">Circa ${esc(ag.year)} · ${esc(ag.role)}</div>
          </div>
          <span class="arc-glyph" style="color:${data.color};">${data.glyph}</span>
        </div>

        <div class="arc-trait-pill" style="background: ${data.color}18; color: ${data.color}; border: 1px solid ${data.color}44;">
          ⚡ ${esc(ag.trait)}
        </div>

        <p class="arc-note">${esc(ag.note)}</p>

        <div class="arc-footer">
          <span class="arc-status-badge">✦ Sworn Guardian</span>
          <button class="btn arc-inspect-btn" onclick="openAgentDossierDirectly('${esc(ag.handle)}')">Inspect Chart ↗</button>
        </div>
      </div>
    `;
  }

  function filterAgentCards() {
    const cards = document.querySelectorAll(".agent-roster-card");
    cards.forEach((c) => {
      const name = c.getAttribute("data-agent-name") || "";
      const trait = c.getAttribute("data-agent-trait") || "";
      const matches = !agentSearchQuery || name.includes(agentSearchQuery) || trait.includes(agentSearchQuery);
      c.style.display = matches ? "flex" : "none";
    });
  }

  // ── PUBLIC ACTIONS ────────────────────────────────────────────────────────
  function openFactionPage(factionId) {
    let id = Number(factionId);
    if (!Number.isFinite(id) || id < 0 || id >= FACTIONS_DATA.length) {
      id = 0;
    }
    activeFactionId = id;
    activeTab = "overview";
    agentSearchQuery = "";

    let ov = document.getElementById("faction-page-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "faction-page-overlay";
      ov.className = "overlay-fullscreen faction-page-overlay";
      ov.setAttribute("role", "dialog");
      ov.setAttribute("aria-modal", "true");
      ov.setAttribute("aria-label", "Planetary Faction Dossier");
      ov.onclick = (e) => {
        if (e.target === ov) closeFactionPage();
      };
      document.body.appendChild(ov);
    }

    ov.style.display = "flex";
    document.body.classList.add("faction-modal-open");
    renderFactionPage();

    if (!escHandler) {
      escHandler = (e) => {
        if (e.key === "Escape") {
          closeFactionPage();
        } else if (e.key === "ArrowLeft") {
          switchFactionPage((activeFactionId + 9) % 10);
        } else if (e.key === "ArrowRight") {
          switchFactionPage((activeFactionId + 1) % 10);
        }
      };
      document.addEventListener("keydown", escHandler);
    }
  }

  function closeFactionPage() {
    const ov = document.getElementById("faction-page-overlay");
    if (ov) {
      ov.style.display = "none";
      ov.innerHTML = "";
    }
    document.body.classList.remove("faction-modal-open");
    if (escHandler) {
      document.removeEventListener("keydown", escHandler);
      escHandler = null;
    }
  }

  function switchFactionPage(newFactionId) {
    activeFactionId = (newFactionId + 10) % 10;
    renderFactionPage();
  }

  function setFactionTab(tabName) {
    activeTab = tabName;
    renderFactionPage();
  }

  function openAgentDossierDirectly(handle) {
    // If agent page supports planet opening, bridge it
    closeFactionPage();
    if (typeof window.openPlanetAgentPage === "function") {
      window.openPlanetAgentPage(activeFactionId);
    } else if (window.toast) {
      window.toast(`Inspecting historical agent: ${handle}`, { type: "info" });
    }
  }

  // ── EXPORTS ───────────────────────────────────────────────────────────────
  root.FACTIONS_DATA = FACTIONS_DATA;
  root.openFactionPage = openFactionPage;
  root.closeFactionPage = closeFactionPage;
  root.switchFactionPage = switchFactionPage;
  root.setFactionTab = setFactionTab;
  root.openAgentDossierDirectly = openAgentDossierDirectly;

  const Pentacles = (root.Pentacles = root.Pentacles || {});
  Pentacles.openFactionPage = openFactionPage;
  Pentacles.closeFactionPage = closeFactionPage;
  Pentacles.factionsData = FACTIONS_DATA;

})(typeof window !== "undefined" ? window : globalThis);
