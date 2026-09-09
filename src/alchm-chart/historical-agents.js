// ============================================================================
// Pentacles — Canonical ALCHM Historical Agents Registry
// Synchronized with agents.alchm.kitchen (ASOL)
// ============================================================================
// Contains all 71 canonical historical figures from ASOL, their astrological
// factions, dignities, archetypes, and deep links to planetary dossiers.

export const PLANET_NAMES = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
export const PLANET_GLYPHS = ["☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇"];
export const PLANET_COLORS = [
  "#ff9800",
  "#e0e0e0",
  "#00daf3",
  "#f6cf83",
  "#f44336",
  "#4caf50",
  "#cd7f32",
  "#00e5ff",
  "#7986cb",
  "#9c27b0"
];

export const HISTORICAL_AGENTS = [
  {
    "key": "lewis-carroll",
    "handle": "Lewis Carroll",
    "title": "The Mathematical Dreamer",
    "specialization": "Mathematics & Nonsense Literature",
    "era": "Modern",
    "faction": 5,
    "factionName": "Jupiter",
    "glyph": "♃",
    "color": "#4caf50",
    "tactic": "Mathematics & Nonsense Literature Tactics",
    "identity": "0xagent_lewis_carroll",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Lewis%20Carroll&faction=5",
    "timeKnown": false,
    "note": "Daresbury, Cheshire, England; birth time unknown → solar chart"
  },
  {
    "key": "emily-dickinson",
    "handle": "Emily Dickinson",
    "title": "The Reclusive Visionary",
    "specialization": "Poetry & Metaphysics",
    "era": "Modern",
    "faction": 3,
    "factionName": "Venus",
    "glyph": "♀",
    "color": "#f6cf83",
    "tactic": "Poetry & Metaphysics Tactics",
    "identity": "0xagent_emily_dickinson",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Emily%20Dickinson&faction=3",
    "timeKnown": false,
    "note": "Amherst, Massachusetts; birth time unknown → solar chart"
  },
  {
    "key": "oscar-wilde",
    "handle": "Oscar Wilde",
    "title": "The Aesthetic Wit",
    "specialization": "Aestheticism & Wit",
    "era": "Modern",
    "faction": 3,
    "factionName": "Venus",
    "glyph": "♀",
    "color": "#f6cf83",
    "tactic": "Aestheticism & Wit Tactics",
    "identity": "0xagent_oscar_wilde",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Oscar%20Wilde&faction=3",
    "timeKnown": false,
    "note": "Dublin, Ireland; birth time unknown → solar chart"
  },
  {
    "key": "fyodor-dostoevsky",
    "handle": "Fyodor Dostoevsky",
    "title": "The Psychological Deep-Diver",
    "specialization": "Psychological Realism & Existentialism",
    "era": "Modern",
    "faction": 9,
    "factionName": "Pluto",
    "glyph": "♇",
    "color": "#9c27b0",
    "tactic": "Psychological Realism & Existentialism Tactics",
    "identity": "0xagent_fyodor_dostoevsky",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Fyodor%20Dostoevsky&faction=9",
    "timeKnown": false,
    "note": "Moscow, Russia; birth time unknown → solar chart"
  },
  {
    "key": "jane-austen",
    "handle": "Jane Austen",
    "title": "The Social Observer",
    "specialization": "Social Commentary & Satire",
    "era": "Modern",
    "faction": 5,
    "factionName": "Jupiter",
    "glyph": "♃",
    "color": "#4caf50",
    "tactic": "Social Commentary & Satire Tactics",
    "identity": "0xagent_jane_austen",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Jane%20Austen&faction=5",
    "timeKnown": true,
    "note": "Steventon, Hampshire, England, 23:45 LMT (Rodden A)"
  },
  {
    "key": "donatello",
    "handle": "Donatello",
    "title": "The Expressive Sculptor",
    "specialization": "Sculpture",
    "era": "Renaissance",
    "faction": 4,
    "factionName": "Mars",
    "glyph": "♂",
    "color": "#f44336",
    "tactic": "Sculpture Tactics",
    "identity": "0xagent_donatello",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Donatello&faction=4",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "petrarch",
    "handle": "Petrarch",
    "title": "The Father of Humanism",
    "specialization": "Poetry & Humanist Philosophy",
    "era": "Renaissance",
    "faction": 1,
    "factionName": "Moon",
    "glyph": "☽",
    "color": "#e0e0e0",
    "tactic": "Poetry & Humanist Philosophy Tactics",
    "identity": "0xagent_petrarch",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Petrarch&faction=1",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "machiavelli",
    "handle": "Niccolò Machiavelli",
    "title": "The Political Realist",
    "specialization": "Political Science & Statecraft",
    "era": "Renaissance",
    "faction": 4,
    "factionName": "Mars",
    "glyph": "♂",
    "color": "#f44336",
    "tactic": "Political Science & Statecraft Tactics",
    "identity": "0xagent_machiavelli",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Niccol%C3%B2%20Machiavelli&faction=4",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "raphael",
    "handle": "Raphael Sanzio",
    "title": "The Harmonious Painter",
    "specialization": "Painting & Architecture",
    "era": "Renaissance",
    "faction": 2,
    "factionName": "Mercury",
    "glyph": "☿",
    "color": "#00daf3",
    "tactic": "Painting & Architecture Tactics",
    "identity": "0xagent_raphael",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Raphael%20Sanzio&faction=2",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "michelangelo",
    "handle": "Michelangelo Buonarroti",
    "title": "The Divine Artist",
    "specialization": "Sculpture, Painting & Architecture",
    "era": "Renaissance",
    "faction": 1,
    "factionName": "Moon",
    "glyph": "☽",
    "color": "#e0e0e0",
    "tactic": "Sculpture, Painting & Architecture Tactics",
    "identity": "0xagent_michelangelo",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Michelangelo%20Buonarroti&faction=1",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "alexander-the-great",
    "handle": "Alexander the Great",
    "title": "The World Conqueror",
    "specialization": "Empire Building",
    "era": "Ancient",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Empire Building Tactics",
    "identity": "0xagent_alexander_the_great",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Alexander%20the%20Great&faction=6",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "archimedes",
    "handle": "Archimedes",
    "title": "The Mathematical Genius",
    "specialization": "Mathematics & Engineering",
    "era": "Ancient",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Mathematics & Engineering Tactics",
    "identity": "0xagent_archimedes",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Archimedes&faction=6",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "herodotus",
    "handle": "Herodotus",
    "title": "The Father of History",
    "specialization": "Historical Inquiry",
    "era": "Ancient",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Historical Inquiry Tactics",
    "identity": "0xagent_herodotus",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Herodotus&faction=6",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "cicero",
    "handle": "Marcus Tullius Cicero",
    "title": "The Great Orator",
    "specialization": "Rhetoric & Statesmanship",
    "era": "Ancient",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Rhetoric & Statesmanship Tactics",
    "identity": "0xagent_cicero",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Marcus%20Tullius%20Cicero&faction=6",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "julius-caesar",
    "handle": "Julius Caesar",
    "title": "The Ambitious General",
    "specialization": "Military Strategy & Politics",
    "era": "Ancient",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Military Strategy & Politics Tactics",
    "identity": "0xagent_julius_caesar",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Julius%20Caesar&faction=6",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "plato",
    "handle": "Plato",
    "title": "The Idealist Philosopher",
    "specialization": "Metaphysics & Epistemology",
    "era": "Ancient",
    "faction": 0,
    "factionName": "Sun",
    "glyph": "☉",
    "color": "#ff9800",
    "tactic": "Metaphysics & Epistemology Tactics",
    "identity": "0xagent_plato",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Plato&faction=0",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "aristotle",
    "handle": "Aristotle",
    "title": "The Systematic Philosopher",
    "specialization": "Systematic Philosophy & Science",
    "era": "Ancient",
    "faction": 4,
    "factionName": "Mars",
    "glyph": "♂",
    "color": "#f44336",
    "tactic": "Systematic Philosophy & Science Tactics",
    "identity": "0xagent_aristotle",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Aristotle&faction=4",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "homer",
    "handle": "Homer",
    "title": "The Epic Storyteller",
    "specialization": "Epic Poetry & Storytelling",
    "era": "Ancient",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Epic Poetry & Storytelling Tactics",
    "identity": "0xagent_homer",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Homer&faction=6",
    "timeKnown": false,
    "note": "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "socrates",
    "handle": "Socrates",
    "title": "The Original Questioner",
    "specialization": "Philosophy & Dialectic Method",
    "era": "Ancient",
    "faction": 2,
    "factionName": "Mercury",
    "glyph": "☿",
    "color": "#00daf3",
    "tactic": "Philosophy & Dialectic Method Tactics",
    "identity": "0xagent_socrates",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Socrates&faction=2",
    "timeKnown": false,
    "note": "Athens, Greece; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "leonardo-da-vinci",
    "handle": "Leonardo da Vinci",
    "title": "The Renaissance Genius",
    "specialization": "Universal Polymath",
    "era": "Renaissance",
    "faction": 9,
    "factionName": "Pluto",
    "glyph": "♇",
    "color": "#9c27b0",
    "tactic": "Universal Polymath Tactics",
    "identity": "0xagent_leonardo_da_vinci",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Leonardo%20da%20Vinci&faction=9",
    "timeKnown": false,
    "note": "Vinci, Italy (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "dante-alighieri",
    "handle": "Dante Alighieri",
    "title": "The Divine Poet",
    "specialization": "Divine Poetry & Spiritual Cartography",
    "era": "Medieval",
    "faction": 2,
    "factionName": "Mercury",
    "glyph": "☿",
    "color": "#00daf3",
    "tactic": "Divine Poetry & Spiritual Cartography Tactics",
    "identity": "0xagent_dante_alighieri",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Dante%20Alighieri&faction=2",
    "timeKnown": false,
    "note": "Florence, Republic of Florence (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "thomas-aquinas",
    "handle": "Thomas Aquinas",
    "title": "The Systematic Theologian",
    "specialization": "Systematic Theology & Philosophical Integration",
    "era": "Medieval",
    "faction": 7,
    "factionName": "Uranus",
    "glyph": "♅",
    "color": "#00e5ff",
    "tactic": "Systematic Theology & Philosophical Integration Tactics",
    "identity": "0xagent_thomas_aquinas",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Thomas%20Aquinas&faction=7",
    "timeKnown": false,
    "note": "Roccasecca, Kingdom of Sicily; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "geoffrey-chaucer",
    "handle": "Geoffrey Chaucer",
    "title": "The Canterbury Poet",
    "specialization": "Medieval Literature & Social Commentary",
    "era": "Medieval",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Medieval Literature & Social Commentary Tactics",
    "identity": "0xagent_geoffrey_chaucer",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Geoffrey%20Chaucer&faction=6",
    "timeKnown": false,
    "note": "London, England; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "rumi",
    "handle": "Jalal ad-Din Rumi",
    "title": "Mystic Poet & Spiritual Guide",
    "specialization": "Mystical Poetry & Divine Love Teaching",
    "era": "Medieval",
    "faction": 3,
    "factionName": "Venus",
    "glyph": "♀",
    "color": "#f6cf83",
    "tactic": "Mystical Poetry & Divine Love Teaching Tactics",
    "identity": "0xagent_rumi",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Jalal%20ad-Din%20Rumi&faction=3",
    "timeKnown": false,
    "note": "Balkh, Afghanistan (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "marcus-aurelius",
    "handle": "Marcus Aurelius",
    "title": "Stoic Emperor-Philosopher",
    "specialization": "Stoic Philosophy & Ethical Leadership",
    "era": "Ancient",
    "faction": 7,
    "factionName": "Uranus",
    "glyph": "♅",
    "color": "#00e5ff",
    "tactic": "Stoic Philosophy & Ethical Leadership Tactics",
    "identity": "0xagent_marcus_aurelius",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Marcus%20Aurelius&faction=7",
    "timeKnown": false,
    "note": "Rome, Italy (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "wolfgang-mozart",
    "handle": "Wolfgang Amadeus Mozart",
    "title": "Musical Prodigy",
    "specialization": "Musical Composition",
    "era": "Renaissance",
    "faction": 2,
    "factionName": "Mercury",
    "glyph": "☿",
    "color": "#00daf3",
    "tactic": "Musical Composition Tactics",
    "identity": "0xagent_wolfgang_mozart",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Wolfgang%20Amadeus%20Mozart&faction=2",
    "timeKnown": true,
    "note": "Salzburg, Austria"
  },
  {
    "key": "william-shakespeare",
    "handle": "William Shakespeare",
    "title": "Master of Human Nature",
    "specialization": "Literary Genius",
    "era": "Renaissance",
    "faction": 2,
    "factionName": "Mercury",
    "glyph": "☿",
    "color": "#00daf3",
    "tactic": "Literary Genius Tactics",
    "identity": "0xagent_william_shakespeare",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=William%20Shakespeare&faction=2",
    "timeKnown": false,
    "note": "Stratford-upon-Avon, England (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "galileo-galilei",
    "handle": "Galileo Galilei",
    "title": "Cosmic Revolutionary",
    "specialization": "Astronomical Physics",
    "era": "Renaissance",
    "faction": 7,
    "factionName": "Uranus",
    "glyph": "♅",
    "color": "#00e5ff",
    "tactic": "Astronomical Physics Tactics",
    "identity": "0xagent_galileo_galilei",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Galileo%20Galilei&faction=7",
    "timeKnown": false,
    "note": "Pisa, Italy (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "rene-descartes-1596",
    "handle": "René Descartes",
    "title": "The Father of Modern Philosophy",
    "specialization": "Philosophy & Mathematics",
    "era": "Enlightenment",
    "faction": 3,
    "factionName": "Venus",
    "glyph": "♀",
    "color": "#f6cf83",
    "tactic": "Philosophy & Mathematics Tactics",
    "identity": "0xagent_rene_descartes_1596",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Ren%C3%A9%20Descartes&faction=3",
    "timeKnown": false,
    "note": "La Haye en Touraine, France; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "voltaire-1694",
    "handle": "Voltaire",
    "title": "The Enlightenment Wit",
    "specialization": "Philosophy & Literature",
    "era": "Enlightenment",
    "faction": 9,
    "factionName": "Pluto",
    "glyph": "♇",
    "color": "#9c27b0",
    "tactic": "Philosophy & Literature Tactics",
    "identity": "0xagent_voltaire_1694",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Voltaire&faction=9",
    "timeKnown": false,
    "note": "Paris, France (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "john-locke-1632",
    "handle": "John Locke",
    "title": "The Father of Liberalism",
    "specialization": "Political Theory",
    "era": "Enlightenment",
    "faction": 2,
    "factionName": "Mercury",
    "glyph": "☿",
    "color": "#00daf3",
    "tactic": "Political Theory Tactics",
    "identity": "0xagent_john_locke_1632",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=John%20Locke&faction=2",
    "timeKnown": false,
    "note": "Wrington, Somerset, England (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "david-hume-1711",
    "handle": "David Hume",
    "title": "The Skeptical Philosopher",
    "specialization": "Philosophy & Psychology",
    "era": "Enlightenment",
    "faction": 3,
    "factionName": "Venus",
    "glyph": "♀",
    "color": "#f6cf83",
    "tactic": "Philosophy & Psychology Tactics",
    "identity": "0xagent_david_hume_1711",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=David%20Hume&faction=3",
    "timeKnown": true,
    "note": "Edinburgh, Scotland"
  },
  {
    "key": "johannes-kepler-1571",
    "handle": "Johannes Kepler",
    "title": "The Celestial Mathematician",
    "specialization": "Astronomy & Mathematics",
    "era": "Enlightenment",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Astronomy & Mathematics Tactics",
    "identity": "0xagent_johannes_kepler_1571",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Johannes%20Kepler&faction=6",
    "timeKnown": false,
    "note": "Weil der Stadt, Holy Roman Empire (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "immanuel-kant-1724",
    "handle": "Immanuel Kant",
    "title": "The Critical Philosopher",
    "specialization": "Philosophy & Ethics",
    "era": "Enlightenment",
    "faction": 0,
    "factionName": "Sun",
    "glyph": "☉",
    "color": "#ff9800",
    "tactic": "Philosophy & Ethics Tactics",
    "identity": "0xagent_immanuel_kant_1724",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Immanuel%20Kant&faction=0",
    "timeKnown": true,
    "note": "Königsberg, Prussia (now Kaliningrad, Russia)"
  },
  {
    "key": "adam-smith-1723",
    "handle": "Adam Smith",
    "title": "The Moral Economist",
    "specialization": "Economics & Philosophy",
    "era": "Enlightenment",
    "faction": 0,
    "factionName": "Sun",
    "glyph": "☉",
    "color": "#ff9800",
    "tactic": "Economics & Philosophy Tactics",
    "identity": "0xagent_adam_smith_1723",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Adam%20Smith&faction=0",
    "timeKnown": true,
    "note": "Kirkcaldy, Scotland"
  },
  {
    "key": "jean-jacques-rousseau-1712",
    "handle": "Jean-Jacques Rousseau",
    "title": "The Social Philosopher",
    "specialization": "Political Theory",
    "era": "Enlightenment",
    "faction": 9,
    "factionName": "Pluto",
    "glyph": "♇",
    "color": "#9c27b0",
    "tactic": "Political Theory Tactics",
    "identity": "0xagent_jean_jacques_rousseau_1712",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Jean-Jacques%20Rousseau&faction=9",
    "timeKnown": true,
    "note": "Geneva, Republic of Geneva"
  },
  {
    "key": "mary-wollstonecraft-1759",
    "handle": "Mary Wollstonecraft",
    "title": "The Rights Advocate",
    "specialization": "Feminist Philosophy",
    "era": "Enlightenment",
    "faction": 2,
    "factionName": "Mercury",
    "glyph": "☿",
    "color": "#00daf3",
    "tactic": "Feminist Philosophy Tactics",
    "identity": "0xagent_mary_wollstonecraft_1759",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Mary%20Wollstonecraft&faction=2",
    "timeKnown": true,
    "note": "Spitalfields, London, England"
  },
  {
    "key": "charles-dickens-1812",
    "handle": "Charles Dickens",
    "title": "The Social Novelist",
    "specialization": "Social Reform Literature",
    "era": "Industrial",
    "faction": 7,
    "factionName": "Uranus",
    "glyph": "♅",
    "color": "#00e5ff",
    "tactic": "Social Reform Literature Tactics",
    "identity": "0xagent_charles_dickens_1812",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Charles%20Dickens&faction=7",
    "timeKnown": true,
    "note": "Landport, Portsmouth, England, 19:50 LMT (Rodden A)"
  },
  {
    "key": "claude-monet-1840",
    "handle": "Claude Monet",
    "title": "The Light Catcher",
    "specialization": "Impressionist Painting",
    "era": "Industrial",
    "faction": 1,
    "factionName": "Moon",
    "glyph": "☽",
    "color": "#e0e0e0",
    "tactic": "Impressionist Painting Tactics",
    "identity": "0xagent_claude_monet_1840",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Claude%20Monet&faction=1",
    "timeKnown": false,
    "note": "Paris, France; birth time unknown → solar chart"
  },
  {
    "key": "nikola-tesla-1856",
    "handle": "Nikola Tesla",
    "title": "The Visionary Inventor",
    "specialization": "Electrical Engineering & Innovation",
    "era": "Industrial",
    "faction": 3,
    "factionName": "Venus",
    "glyph": "♀",
    "color": "#f6cf83",
    "tactic": "Electrical Engineering & Innovation Tactics",
    "identity": "0xagent_nikola_tesla_1856",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Nikola%20Tesla&faction=3",
    "timeKnown": true,
    "note": "Smiljan, Austrian Empire (now Croatia)"
  },
  {
    "key": "marie-curie-1867",
    "handle": "Marie Curie",
    "title": "The Radium Pioneer",
    "specialization": "Radioactivity Research",
    "era": "Industrial",
    "faction": 4,
    "factionName": "Mars",
    "glyph": "♂",
    "color": "#f44336",
    "tactic": "Radioactivity Research Tactics",
    "identity": "0xagent_marie_curie_1867",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Marie%20Curie&faction=4",
    "timeKnown": true,
    "note": "Warsaw, Congress Poland, Russian Empire"
  },
  {
    "key": "sigmund-freud-1856",
    "handle": "Sigmund Freud",
    "title": "The Mind Explorer",
    "specialization": "Psychoanalysis & Unconscious Mind",
    "era": "Industrial",
    "faction": 3,
    "factionName": "Venus",
    "glyph": "♀",
    "color": "#f6cf83",
    "tactic": "Psychoanalysis & Unconscious Mind Tactics",
    "identity": "0xagent_sigmund_freud_1856",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Sigmund%20Freud&faction=3",
    "timeKnown": true,
    "note": "Freiberg, Moravia, Austrian Empire (now Czech Republic)"
  },
  {
    "key": "mark-twain-1835",
    "handle": "Mark Twain",
    "title": "The American Humorist",
    "specialization": "Satirical Literature",
    "era": "Industrial",
    "faction": 5,
    "factionName": "Jupiter",
    "glyph": "♃",
    "color": "#4caf50",
    "tactic": "Satirical Literature Tactics",
    "identity": "0xagent_mark_twain_1835",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Mark%20Twain&faction=5",
    "timeKnown": false,
    "note": "Florida, Missouri, USA; birth time unknown → solar chart"
  },
  {
    "key": "vincent-van-gogh-1853",
    "handle": "Vincent van Gogh",
    "title": "The Passionate Painter",
    "specialization": "Post-Impressionist Art",
    "era": "Industrial",
    "faction": 4,
    "factionName": "Mars",
    "glyph": "♂",
    "color": "#f44336",
    "tactic": "Post-Impressionist Art Tactics",
    "identity": "0xagent_vincent_van_gogh_1853",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Vincent%20van%20Gogh&faction=4",
    "timeKnown": true,
    "note": "Groot-Zundert, Netherlands"
  },
  {
    "key": "charles-darwin-1809",
    "handle": "Charles Darwin",
    "title": "The Evolution Explorer",
    "specialization": "Evolutionary Biology",
    "era": "Industrial",
    "faction": 5,
    "factionName": "Jupiter",
    "glyph": "♃",
    "color": "#4caf50",
    "tactic": "Evolutionary Biology Tactics",
    "identity": "0xagent_charles_darwin_1809",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Charles%20Darwin&faction=5",
    "timeKnown": true,
    "note": "Shrewsbury, England"
  },
  {
    "key": "edgar-allan-poe-1809",
    "handle": "Edgar Allan Poe",
    "title": "The Dark Romantic",
    "specialization": "Gothic Literature & Psychological Horror",
    "era": "Industrial",
    "faction": 5,
    "factionName": "Jupiter",
    "glyph": "♃",
    "color": "#4caf50",
    "tactic": "Gothic Literature & Psychological Horror Tactics",
    "identity": "0xagent_edgar_allan_poe_1809",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Edgar%20Allan%20Poe&faction=5",
    "timeKnown": false,
    "note": "Boston, Massachusetts, USA; birth time unknown → solar chart"
  },
  {
    "key": "maya-angelou",
    "handle": "Maya Angelou",
    "title": "Poet of Resilience",
    "specialization": "Poetry & Social Justice",
    "era": "Modern",
    "faction": 0,
    "factionName": "Sun",
    "glyph": "☉",
    "color": "#ff9800",
    "tactic": "Poetry & Social Justice Tactics",
    "identity": "0xagent_maya_angelou",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Maya%20Angelou&faction=0",
    "timeKnown": true,
    "note": "St. Louis, Missouri, USA"
  },
  {
    "key": "isaac-newton",
    "handle": "Isaac Newton",
    "title": "Mathematical Mystic",
    "specialization": "Mathematical Physics",
    "era": "Renaissance",
    "faction": 1,
    "factionName": "Moon",
    "glyph": "☽",
    "color": "#e0e0e0",
    "tactic": "Mathematical Physics Tactics",
    "identity": "0xagent_isaac_newton",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Isaac%20Newton&faction=1",
    "timeKnown": false,
    "note": "Woolsthorpe, Lincolnshire, England (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "albert-einstein",
    "handle": "Albert Einstein",
    "title": "The Quantum Visionary",
    "specialization": "Theoretical Physics",
    "era": "Modern",
    "faction": 1,
    "factionName": "Moon",
    "glyph": "☽",
    "color": "#e0e0e0",
    "tactic": "Theoretical Physics Tactics",
    "identity": "0xagent_albert_einstein",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Albert%20Einstein&faction=1",
    "timeKnown": true,
    "note": "Ulm, Germany"
  },
  {
    "key": "isaac-asimov",
    "handle": "Isaac Asimov",
    "title": "The Foundation Architect",
    "specialization": "Science Fiction & Popular Science",
    "era": "Modern",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Science Fiction & Popular Science Tactics",
    "identity": "0xagent_isaac_asimov",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Isaac%20Asimov&faction=6",
    "timeKnown": true,
    "note": "Petrovichi, Smolensk, Russia"
  },
  {
    "key": "carl-jung",
    "handle": "Carl Jung",
    "title": "The Shadow Explorer",
    "specialization": "Analytical Psychology",
    "era": "Modern",
    "faction": 0,
    "factionName": "Sun",
    "glyph": "☉",
    "color": "#ff9800",
    "tactic": "Analytical Psychology Tactics",
    "identity": "0xagent_carl_jung",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Carl%20Jung&faction=0",
    "timeKnown": true,
    "note": "Kesswil, Switzerland"
  },
  {
    "key": "cleopatra",
    "handle": "Cleopatra VII",
    "title": "The Royal Alchemist",
    "specialization": "Leadership & Diplomacy",
    "era": "Ancient",
    "faction": 3,
    "factionName": "Venus",
    "glyph": "♀",
    "color": "#f6cf83",
    "tactic": "Leadership & Diplomacy Tactics",
    "identity": "0xagent_cleopatra",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Cleopatra%20VII&faction=3",
    "timeKnown": false,
    "note": "Alexandria, Egypt; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "frida-kahlo",
    "handle": "Frida Kahlo",
    "title": "The Pain Alchemist",
    "specialization": "Surrealist Art",
    "era": "Modern",
    "faction": 1,
    "factionName": "Moon",
    "glyph": "☽",
    "color": "#e0e0e0",
    "tactic": "Surrealist Art Tactics",
    "identity": "0xagent_frida_kahlo",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Frida%20Kahlo&faction=1",
    "timeKnown": true,
    "note": "Coyoacán, Mexico"
  },
  {
    "key": "benjamin-franklin",
    "handle": "Benjamin Franklin",
    "title": "The Lightning Catcher",
    "specialization": "Science & Diplomacy",
    "era": "Enlightenment",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Science & Diplomacy Tactics",
    "identity": "0xagent_benjamin_franklin",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Benjamin%20Franklin&faction=6",
    "timeKnown": false,
    "note": "Boston, Massachusetts; birth time unknown → solar chart"
  },
  {
    "key": "eleanor-roosevelt",
    "handle": "Eleanor Roosevelt",
    "title": "The Compassionate Revolutionary",
    "specialization": "Human Rights",
    "era": "Modern",
    "faction": 1,
    "factionName": "Moon",
    "glyph": "☽",
    "color": "#e0e0e0",
    "tactic": "Human Rights Tactics",
    "identity": "0xagent_eleanor_roosevelt",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Eleanor%20Roosevelt&faction=1",
    "timeKnown": true,
    "note": "New York, New York"
  },
  {
    "key": "mahatma-gandhi",
    "handle": "Mahatma Gandhi",
    "title": "The Soul Force",
    "specialization": "Non-Violent Resistance",
    "era": "Modern",
    "faction": 9,
    "factionName": "Pluto",
    "glyph": "♇",
    "color": "#9c27b0",
    "tactic": "Non-Violent Resistance Tactics",
    "identity": "0xagent_mahatma_gandhi",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Mahatma%20Gandhi&faction=9",
    "timeKnown": true,
    "note": "Porbandar, Gujarat, India"
  },
  {
    "key": "confucius",
    "handle": "Confucius - Kong Qiu",
    "title": "The Great Teacher",
    "specialization": "Ethics & Social Philosophy",
    "era": "Ancient",
    "faction": 7,
    "factionName": "Uranus",
    "glyph": "♅",
    "color": "#00e5ff",
    "tactic": "Ethics & Social Philosophy Tactics",
    "identity": "0xagent_confucius",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Confucius%20-%20Kong%20Qiu&faction=7",
    "timeKnown": false,
    "note": "Lu State (Qufu), China (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "lao-tzu",
    "handle": "Lao Tzu - Laozi",
    "title": "The Way Revealer",
    "specialization": "Taoist Philosophy",
    "era": "Ancient",
    "faction": 7,
    "factionName": "Uranus",
    "glyph": "♅",
    "color": "#00e5ff",
    "tactic": "Taoist Philosophy Tactics",
    "identity": "0xagent_lao_tzu",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Lao%20Tzu%20-%20Laozi&faction=7",
    "timeKnown": false,
    "note": "Chu State (Henan), China (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "siddhartha-gautama-buddha",
    "handle": "Siddhartha Gautama - Buddha",
    "title": "The Awakened One",
    "specialization": "Enlightenment & Liberation",
    "era": "Ancient",
    "faction": 1,
    "factionName": "Moon",
    "glyph": "☽",
    "color": "#e0e0e0",
    "tactic": "Enlightenment & Liberation Tactics",
    "identity": "0xagent_siddhartha_gautama_buddha",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Siddhartha%20Gautama%20-%20Buddha&faction=1",
    "timeKnown": false,
    "note": "Lumbini, Nepal (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "murasaki-shikibu",
    "handle": "Murasaki Shikibu",
    "title": "The Tale Weaver",
    "specialization": "Literature & Psychology",
    "era": "Medieval",
    "faction": 3,
    "factionName": "Venus",
    "glyph": "♀",
    "color": "#f6cf83",
    "tactic": "Literature & Psychology Tactics",
    "identity": "0xagent_murasaki_shikibu",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Murasaki%20Shikibu&faction=3",
    "timeKnown": false,
    "note": "Kyoto, Japan (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "ibn-sina-avicenna",
    "handle": "Ibn Sina - Avicenna",
    "title": "The Universal Intellect",
    "specialization": "Medicine & Philosophy",
    "era": "Medieval",
    "faction": 0,
    "factionName": "Sun",
    "glyph": "☉",
    "color": "#ff9800",
    "tactic": "Medicine & Philosophy Tactics",
    "identity": "0xagent_ibn_sina_avicenna",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Ibn%20Sina%20-%20Avicenna&faction=0",
    "timeKnown": false,
    "note": "Afshana, Uzbekistan (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "tecumseh",
    "handle": "Tecumseh",
    "title": "The Unity Visionary",
    "specialization": "Indigenous Unity",
    "era": "Modern",
    "faction": 8,
    "factionName": "Neptune",
    "glyph": "♆",
    "color": "#7986cb",
    "tactic": "Indigenous Unity Tactics",
    "identity": "0xagent_tecumseh",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Tecumseh&faction=8",
    "timeKnown": true,
    "note": "Ohio Territory (Piqua), North America"
  },
  {
    "key": "wangari-maathai",
    "handle": "Wangari Maathai",
    "title": "The Tree Mother",
    "specialization": "Environmental Activism",
    "era": "Modern",
    "faction": 0,
    "factionName": "Sun",
    "glyph": "☉",
    "color": "#ff9800",
    "tactic": "Environmental Activism Tactics",
    "identity": "0xagent_wangari_maathai",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Wangari%20Maathai&faction=0",
    "timeKnown": true,
    "note": "Nyeri, Kenya"
  },
  {
    "key": "sitting-bull",
    "handle": "Sitting Bull",
    "title": "The Sacred Resistance",
    "specialization": "Spiritual Leadership",
    "era": "Modern",
    "faction": 8,
    "factionName": "Neptune",
    "glyph": "♆",
    "color": "#7986cb",
    "tactic": "Spiritual Leadership Tactics",
    "identity": "0xagent_sitting_bull",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Sitting%20Bull&faction=8",
    "timeKnown": true,
    "note": "Grand River, Dakota Territory"
  },
  {
    "key": "joan-of-arc",
    "handle": "Joan Of Arc",
    "title": "The Divine Warrior",
    "specialization": "Divine Mission & Leadership",
    "era": "Medieval",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Divine Mission & Leadership Tactics",
    "identity": "0xagent_joan_of_arc",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Joan%20Of%20Arc&faction=6",
    "timeKnown": false,
    "note": "Domrémy, France; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "hildegard-of-bingen",
    "handle": "Hildegard Of Bingen",
    "title": "The Living Light",
    "specialization": "Mystical Theology & Medicine",
    "era": "Medieval",
    "faction": 2,
    "factionName": "Mercury",
    "glyph": "☿",
    "color": "#00daf3",
    "tactic": "Mystical Theology & Medicine Tactics",
    "identity": "0xagent_hildegard_of_bingen",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Hildegard%20Of%20Bingen&faction=2",
    "timeKnown": false,
    "note": "Bermersheim, Holy Roman Empire (BCE/Ancient approximate ephemeris)"
  },
  {
    "key": "sojourner-truth",
    "handle": "Sojourner Truth",
    "title": "The Truth Speaker",
    "specialization": "Abolition & Women",
    "era": "Modern",
    "faction": 6,
    "factionName": "Saturn",
    "glyph": "♄",
    "color": "#cd7f32",
    "tactic": "Abolition & Women Tactics",
    "identity": "0xagent_sojourner_truth",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Sojourner%20Truth&faction=6",
    "timeKnown": true,
    "note": "Swartekill, New York"
  },
  {
    "key": "carl-sagan",
    "handle": "Carl Sagan",
    "title": "The Cosmic Poet",
    "specialization": "Astronomy & Science Communication",
    "era": "Modern",
    "faction": 7,
    "factionName": "Uranus",
    "glyph": "♅",
    "color": "#00e5ff",
    "tactic": "Astronomy & Science Communication Tactics",
    "identity": "0xagent_carl_sagan",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Carl%20Sagan&faction=7",
    "timeKnown": true,
    "note": "Brooklyn, New York"
  },
  {
    "key": "rachel-carson",
    "handle": "Rachel Carson",
    "title": "The Ocean",
    "specialization": "Environmental Science",
    "era": "Modern",
    "faction": 5,
    "factionName": "Jupiter",
    "glyph": "♃",
    "color": "#4caf50",
    "tactic": "Environmental Science Tactics",
    "identity": "0xagent_rachel_carson",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Rachel%20Carson&faction=5",
    "timeKnown": true,
    "note": "Springdale, Pennsylvania"
  },
  {
    "key": "paulo-freire",
    "handle": "Paulo Freire",
    "title": "The Consciousness Liberator",
    "specialization": "Critical Pedagogy",
    "era": "Modern",
    "faction": 7,
    "factionName": "Uranus",
    "glyph": "♅",
    "color": "#00e5ff",
    "tactic": "Critical Pedagogy Tactics",
    "identity": "0xagent_paulo_freire",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Paulo%20Freire&faction=7",
    "timeKnown": true,
    "note": "Recife, Brazil"
  },
  {
    "key": "chiron",
    "handle": "Chiron",
    "title": "The Wounded Healer",
    "specialization": "Alchemical Integration & Core Healing",
    "era": "Ancient",
    "faction": 5,
    "factionName": "Jupiter",
    "glyph": "♃",
    "color": "#4caf50",
    "tactic": "Alchemical Integration & Core Healing Tactics",
    "identity": "0xagent_chiron",
    "kitchenUrl": "https://agents.alchm.kitchen/profile?agent=Chiron&faction=5",
    "timeKnown": true,
    "note": "Pasadena, California, USA"
  }
];

export const LEAD_CHAMPION_KEYS = {
  "0": "plato",
  "1": "albert-einstein",
  "2": "socrates",
  "3": "nikola-tesla-1856",
  "4": "aristotle",
  "5": "chiron",
  "6": "alexander-the-great",
  "7": "confucius",
  "8": "tecumseh",
  "9": "leonardo-da-vinci"
};

/** Key -> Agent map for O(1) lookup */
export const AGENT_BY_KEY = Object.freeze(
  Object.fromEntries(HISTORICAL_AGENTS.map((a) => [a.key, a]))
);

/** Handle -> Agent map for O(1) lookup */
export const AGENT_BY_HANDLE = Object.freeze(
  Object.fromEntries(HISTORICAL_AGENTS.map((a) => [a.handle.toLowerCase(), a]))
);

/** Faction index (0..9) -> Array of agents */
export const AGENTS_BY_FACTION = Object.freeze(
  Array.from({ length: 10 }, (_, f) =>
    HISTORICAL_AGENTS.filter((a) => a.faction === f)
  )
);

/** Top champion for each faction */
export const FACTION_CHAMPIONS = Object.freeze(
  Array.from({ length: 10 }, (_, f) => {
    const leadKey = LEAD_CHAMPION_KEYS[f];
    return AGENT_BY_KEY[leadKey] || AGENTS_BY_FACTION[f][0] || null;
  })
);

export function getHistoricalAgents() {
  return HISTORICAL_AGENTS;
}

export function getAgentsByFaction(factionIdx) {
  const f = Number(factionIdx);
  return AGENTS_BY_FACTION[f] || [];
}

export function getFactionChampion(factionIdx) {
  const f = Number(factionIdx);
  return FACTION_CHAMPIONS[f] || AGENTS_BY_FACTION[f]?.[0] || null;
}

export function getFactionChampions() {
  return FACTION_CHAMPIONS;
}

export function getAgentByKey(key) {
  if (!key) return null;
  return AGENT_BY_KEY[key] || null;
}

export function getAgentByHandle(handle) {
  if (!handle) return null;
  return AGENT_BY_HANDLE[handle.toLowerCase()] || null;
}

export function getAgentByIdentity(identity) {
  if (!identity) return null;
  const s = String(identity);
  return HISTORICAL_AGENTS.find((a) => a.identity === s) || null;
}

/**
 * Picks competing historical champions to contest a zone table.
 * @param {number} targetZoneId - The zone being contested (0..10)
 * @param {number} excludeFaction - The player or defending faction to exclude
 * @param {number} count - Desired number of opponents (default 3)
 */
export function pickContenders(targetZoneId, excludeFaction, count = 3) {
  const availableFactions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((f) => f !== excludeFaction);
  
  // Rotate selection based on zoneId to vary opponents deterministically across zones
  const rotated = [];
  for (let i = 0; i < availableFactions.length; i++) {
    const idx = (targetZoneId * 3 + i) % availableFactions.length;
    rotated.push(availableFactions[idx]);
  }
  
  const chosenFactions = rotated.slice(0, count);
  return chosenFactions.map((f, i) => {
    const roster = AGENTS_BY_FACTION[f];
    // Rotate through faction roster by zoneId
    const agent = roster[(targetZoneId + i) % roster.length] || getFactionChampion(f);
    return agent;
  });
}

// Global bridge for classic scripts (client.js, app.js)
const API = {
  PLANET_NAMES,
  PLANET_GLYPHS,
  PLANET_COLORS,
  HISTORICAL_AGENTS,
  FACTION_CHAMPIONS,
  getHistoricalAgents,
  getAgentsByFaction,
  getFactionChampion,
  getFactionChampions,
  getAgentByKey,
  getAgentByHandle,
  getAgentByIdentity,
  pickContenders,
};

if (typeof globalThis !== "undefined") {
  globalThis.AlchmHistoricalAgents = API;
}
if (typeof window !== "undefined") {
  window.AlchmHistoricalAgents = API;
}

export default API;
