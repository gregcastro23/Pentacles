/**
 * Tarot Art Prompt Catalog & Blueprint Registry
 * 
 * Defines the canonical prompt specifications for all 78 Tarot cards
 * in the authentic Pamela Colman Smith ("Pixie" 1909) aesthetic,
 * fully elevated with an astral, deep-space cosmic theme for Pentacles.
 */

export const ART_STYLE_PREFIX = 
  "Tarot card art in the authentic Pamela Colman Smith Pixie style infused with a luminous deep-space cosmic astral theme.";

export const ART_STYLE_SUFFIX = 
  "Deep cosmic starfield void, glowing stellar nebulae, floating celestial bodies, bold hand-drawn black ink linework, antique vintage parchment paper texture, luminous gouache watercolor cosmic washes. Vertical tarot composition, 2:3 aspect ratio, no text, no border.";

export const CARD_PROMPT_CATALOG = [
  // ── MAJOR ARCANA (0..21) ──
  {
    id: "major-00",
    rank: 0,
    suit: "major",
    name: "The Fool",
    filename: "00-the-fool.jpg",
    relativePath: "major/00-the-fool.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana 0 The Fool: A youthful celestial wanderer in a star-embroidered tunic stands poised at the edge of a sheer crystalline asteroid precipice floating in deep space. In his left hand he holds a glowing white star-rose; over his right shoulder he balances a wooden staff bearing an embroidered cosmic satchel. A small white astral dog gambols excitedly at his heels. Above him, a brilliant white celestial sun radiates in a golden nebula sky with shimmering cosmic aurora ribbons. Distant snowy planetary peaks and rings rise in the background. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-01",
    rank: 1,
    suit: "major",
    name: "The Magician",
    filename: "01-the-magician.jpg",
    relativePath: "major/01-the-magician.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana I The Magician: A mystical magus in a white tunic and crimson mantle standing serenely before an obsidian stone altar table floating in deep space. On the table rest the four elemental implements: a living wooden wand crackling with solar fire, a golden chalice overflowing with luminous liquid starlight, an upright silver steel broadsword with swirling cosmic wind currents, and a carved golden pentacle coin radiating gravitational earth energy. His right hand raises a glowing crystal wand to the cosmos, his left points downward to the planetary core. Above his head floats an infinity symbol lemniscate of radiant golden starlight. Glowing roses and star-lilies frame the cosmic scene. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-02",
    rank: 2,
    suit: "major",
    name: "The High Priestess",
    filename: "02-the-high-priestess.jpg",
    relativePath: "major/02-the-high-priestess.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana II The High Priestess: A serene, enigmatic priestess seated between two massive interstellar temple columns—one dark matter black marked 'B', one brilliant starlight white marked 'J'. Behind her hangs a cosmic veil embroidered with ripe red pomegranate nebulae and glowing palm leaves. She wears a horned lunar crown enclosing a luminous planetary sphere, with flowing blue robes that pool like liquid starlight across the floor. In her lap rests a sacred scroll of cosmic law. At her feet glows a sharp horned crescent moon against a starry indigo void. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-03",
    rank: 3,
    suit: "major",
    name: "The Empress",
    filename: "03-the-empress.jpg",
    relativePath: "major/03-the-empress.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana III The Empress: A gracious maternal cosmic sovereign seated on plush velvet cushions atop a floating asteroid terrace amid a flourishing field of starlight wheat. She wears a magnificent crown of twelve brilliant spiral galaxies and white robes patterned with glowing pomegranates. Beside her throne rests a heart-shaped shield engraved with the Venus symbol ♀ glowing with emerald planetary radiance. In the deep space background, a waterfall of liquid starlight cascades into a shimmering cosmic river under warm amber nebulae and floating stardust particles. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-04",
    rank: 4,
    suit: "major",
    name: "The Emperor",
    filename: "04-the-emperor.jpg",
    relativePath: "major/04-the-emperor.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana IV The Emperor: A sovereign figure with starry obsidian and bronze plate armor seated upon a massive asteroid throne floating in deep cosmos. The throne is carved with ram heads glowing with red star energy. In his right hand he holds an ankh scepter glowing like a concentrated white sun; in his left a glowing planetary sphere. In the deep-space background looms the giant ringed red planet Mars and shimmering cosmic nebulae with glowing constellation lines of Aries. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-05",
    rank: 5,
    suit: "major",
    name: "The Hierophant",
    filename: "05-the-hierophant.jpg",
    relativePath: "major/05-the-hierophant.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana V The Hierophant: A solemn cosmic sage seated between two fluted interstellar columns on a temple platform in the stars. He wears a triple golden astral tiara and layered crimson vestments adorned with geometric starlight crosses, raising two fingers in cosmic blessing while holding a triple-cross scepter. At his feet cross two golden keys of celestial mysteries. Two robed initiates kneel before him in reverence beneath a glowing canopy of deep space nebulae. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-06",
    rank: 6,
    suit: "major",
    name: "The Lovers",
    filename: "06-the-lovers.jpg",
    relativePath: "major/06-the-lovers.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana VI The Lovers: Archangel Raphael with magnificent violet and golden wings emerges from a blazing solar corona in deep space, hands outstretched in celestial blessing. Below, on a lush terraformed asteroid garden, stand a man beside the Cosmic Tree of Life bearing twelve burning star-fruits, and a woman beside the Tree of Knowledge encircled by a wise glowing celestial serpent. Behind them rises a dramatic volcanic nebula peak beneath a radiant cosmic sun. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-07",
    rank: 7,
    suit: "major",
    name: "The Chariot",
    filename: "07-the-chariot.jpg",
    relativePath: "major/07-the-chariot.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana VII The Chariot: A triumphant astral prince in silver plate armor with lunar crescent pauldrons stands inside a cosmic chariot beneath a star-canopy woven from glowing constellations. He holds a wand of stellar command. Guiding the chariot are two cosmic sphinxes—one obsidian black, one radiant starlight white. In the background, a ringed celestial planet and an astral citadel drift in a sea of glowing stardust. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-08",
    rank: 8,
    suit: "major",
    name: "Strength",
    filename: "08-strength.jpg",
    relativePath: "major/08-strength.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana VIII Strength: A serene celestial maiden draped in starlight-white robes adorned with stellar garlands gently closes the jaws of a majestic, glowing golden astral lion with her bare hands. Above her head hovers a radiant golden infinity lemniscate of pure starlight. Behind them, floating asteroid crags and a stream of liquid light flow under a glowing golden-amber nebula sky with subtle cosmic dust particles. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-09",
    rank: 9,
    suit: "major",
    name: "The Hermit",
    filename: "09-the-hermit.jpg",
    relativePath: "major/09-the-hermit.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana IX The Hermit: An elderly hooded cosmic sage in gray woolen robes stands atop a solitary frozen asteroid pinnacle against the deep indigo cosmic void. In his right hand he holds aloft a golden hexagonal lantern enclosing a blazing supergiant star that casts radiant beams across the universe; in his left hand he leans upon a tall wooden pilgrim staff. Subtle orbiting star clusters and starlight filaments surround him. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-10",
    rank: 10,
    suit: "major",
    name: "Wheel of Fortune",
    filename: "10-wheel-of-fortune.jpg",
    relativePath: "major/10-wheel-of-fortune.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana X Wheel of Fortune: A massive celestial wheel carved with esoteric letters and alchemical planetary symbols floats in a swirling cosmic spiral galaxy. Atop the wheel perches a blue Sphinx holding a starlight sword; descending is the serpentine Typhon; ascending is the jackal-headed Anubis. In the four corners of deep space rest the four winged cherubim (angel, eagle, lion, bull) studying celestial tomes amidst radiant nebulae. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-11",
    rank: 11,
    suit: "major",
    name: "Justice",
    filename: "11-justice.jpg",
    relativePath: "major/11-justice.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Major Arcana XI Justice: A dignified cosmic sovereign in crimson robes and emerald mantle seated between two monolithic starlight pillars before an interstellar violet veil. In her right hand she holds an upright double-edged starlight broadsword; in her left she balances a pair of golden scales weighing miniature star clusters against dark matter spheres. Her crown is adorned with a glowing square jewel under an amber coronal halo. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-12",
    rank: 12,
    suit: "major",
    name: "The Hanged Man",
    filename: "12-the-hanged-man.jpg",
    relativePath: "major/12-the-hanged-man.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Major Arcana XII The Hanged Man: A peaceful astral figure suspended upside down by one ankle in zero gravity from a living tree of starlight rooted on a floating asteroid. His free leg is crossed behind the other in a numeral four shape. Around his head glows a brilliant golden nimbus halo of cosmic enlightenment. Beneath him swirls an immense planetary vortex and luminous blue nebula clouds. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-13",
    rank: 13,
    suit: "major",
    name: "Death",
    filename: "13-death.jpg",
    relativePath: "major/13-death.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Major Arcana XIII Death: A skeletal cosmic knight in polished obsidian armor rides a magnificent armored white celestial horse across an asteroid field during a total solar eclipse. He carries a black silk banner embroidered with a mystical glowing white supernova rose. In the deep-space background, a river of liquid starlight flows between twin planetary spires where a newborn golden star dawns on the horizon. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-14",
    rank: 14,
    suit: "major",
    name: "Temperance",
    filename: "14-temperance.jpg",
    relativePath: "major/14-temperance.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Major Arcana XIV Temperance: A magnificent winged celestial angel in white robes with fiery crimson wings stands with one foot in a pool of liquid starlight and one foot on asteroid soil. The angel pours a luminous continuous stream of living stellar water between two golden chalices across twin spiral galaxies without spilling a drop. On the angel's forehead shines a brilliant solar third-eye jewel under a glowing cosmic dawn. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-15",
    rank: 15,
    suit: "major",
    name: "The Devil",
    filename: "15-the-devil.jpg",
    relativePath: "major/15-the-devil.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Major Arcana XV The Devil: A horned, winged cosmic shadow titan perched upon a shattered obsidian asteroid throne. An inverted starlight pentagram glows upon his brow, his right hand is raised in a mocking gesture, and in his left hand he holds a burning comet torch pointed downward. Chained loosely by their necks to the pedestal are two astral beings with horns. Dark cosmic void with floating red plasma embers. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-16",
    rank: 16,
    suit: "major",
    name: "The Tower",
    filename: "16-the-tower.jpg",
    relativePath: "major/16-the-tower.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Major Arcana XVI The Tower: A tall crystalline cosmic spire floating on an asteroid struck by a ferocious bolt of celestial comet lightning. Fire, smoke, and stardust erupt from the shattered pinnacle as a golden crown is blown into the void. Two astral silhouettes tumble downward through zero gravity amidst showers of burning meteor sparks against a dark turbulent nebula sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-17",
    rank: 17,
    suit: "major",
    name: "The Star",
    filename: "17-the-star.jpg",
    relativePath: "major/17-the-star.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Major Arcana XVII The Star: A serene celestial maiden draped in a simple white linen tunic kneels on an asteroid beside a pool of liquid starlight in deep space. She pours glowing starlight from two urns—one onto the asteroid soil, nourishing glowing flora, and one into the pool, creating luminous ripples. Above her shines a giant eight-pointed radiant yellow supergiant star surrounded by seven smaller orbiting white stars against an indigo cosmic void. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-18",
    rank: 18,
    suit: "major",
    name: "The Moon",
    filename: "18-the-moon.jpg",
    relativePath: "major/18-the-moon.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Major Arcana XVIII The Moon: An enormous luminescent moon with a dreaming facial profile hangs in deep space, sending down sixteen principal rays and golden dew drops. Below on a cratered asteroid, two cosmic wolves howl up at the lunar disk. A glowing celestial crustacean crawls out of an ether pool along a path leading between twin crystalline obelisks toward distant nebula hills under a dark starry cosmos. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-19",
    rank: 19,
    suit: "major",
    name: "The Sun",
    filename: "19-the-sun.jpg",
    relativePath: "major/19-the-sun.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana XIX The Sun: A massive radiant smiling golden sun in deep space with alternating wavy and straight solar flares showering warm golden light. A joyful crowned celestial youth wearing a white tunic rides bareback upon a gentle white winged steed, holding a large billowing crimson banner. In the background, an asteroid terrace where giant golden sunflowers bloom vibrantly beneath glowing solar coronas. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-20",
    rank: 20,
    suit: "major",
    name: "Judgement",
    filename: "20-judgement.jpg",
    relativePath: "major/20-judgement.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Major Arcana XX Judgement: Archangel Gabriel with magnificent feathered wings emerges from radiant interstellar clouds, blowing a long golden trumpet bearing a white banner with a red solar cross. Below, draped astral figures rise with arms outstretched in joy and awe from floating crystalline tombs drifting on a sea of cosmic starlight, surrounded by planetary rings under a glorious celestial dawn. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-21",
    rank: 21,
    suit: "major",
    name: "The World",
    filename: "21-the-world.jpg",
    relativePath: "major/21-the-world.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} Major Arcana XXI The World: A graceful dancing celestial figure draped in a flowing violet silk sash stands within a large oval wreath of cosmic laurel stars. In each hand the dancer holds a slender wand of starlight. Surrounding the wreath in the four corners of the starry cosmic sky are the four celestial cherubim: an angel, an eagle, a winged lion, and a winged bull. Luminous starlight nebulae and planetary rings. ${ART_STYLE_SUFFIX}`
  },

  // ── MINOR ARCANA: WANDS (Fire / Solar Plasma) ──
  {
    id: "wands-01", rank: 1, suit: "wands", name: "Ace of Wands", filename: "01-ace.jpg", relativePath: "minor/wands/01-ace.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Ace of Wands: A radiant divine hand emerging from a swirling white nebula cloud holds an upright living wooden staff that crackles with solar plasma and sprouts green leaves and glowing embers. Floating golden fire sparks and luminous embers drift in zero gravity. In the deep space background, floating terracotta asteroids and a brilliant red star shine under an amber solar sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-02", rank: 2, suit: "wands", name: "Two of Wands", filename: "02-two.jpg", relativePath: "minor/wands/02-two.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Two of Wands: A noble astral traveler in a crimson cloak stands upon the stone battlement of an asteroid observatory looking out over an infinite cosmic sea of stars and orbiting planets. In his right hand he holds a miniature fiery celestial orb glowing like a star; in his left hand he rests upon a tall wooden staff fixed to the stone. A second staff stands beside him. Rich cosmic gouache. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-03", rank: 3, suit: "wands", name: "Three of Wands", filename: "03-three.jpg", relativePath: "minor/wands/03-three.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Three of Wands: A robed cosmic navigator in red and green viewed from behind stands on a high asteroid precipice, resting one hand upon one of three tall sprouting staves firmly planted in the rock, watching three solar sailing vessels voyage across a sparkling golden stellar sea beneath a radiant amber nebula. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-04", rank: 4, suit: "wands", name: "Four of Wands", filename: "04-four.jpg", relativePath: "minor/wands/04-four.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Four of Wands: Four tall wooden staves draped with luscious garlands of starlight flowers and glowing cosmic fruits form a welcoming arbor on an asteroid terrace; two figures in white raise floral bouquets in celebration before a distant crystalline dome under a bright golden nebula sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-05", rank: 5, suit: "wands", name: "Five of Wands", filename: "05-five.jpg", relativePath: "minor/wands/05-five.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Five of Wands: Five energetic youths in colorful tunics brandishing sprouting wooden wands in zero-gravity combat, crossing and parrying their staves with fiery plasma sparks in spirited competition amidst floating meteor fragments under a vibrant nebula. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-06", rank: 6, suit: "wands", name: "Six of Wands", filename: "06-six.jpg", relativePath: "minor/wands/06-six.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Six of Wands: A proud, crowned astral rider on a magnificent white celestial steed galloping along a luminous stardust path in deep space, holding a tall wooden staff crowned with a glowing golden laurel wreath; celebrating foot soldiers with staves march beside him in triumphant cosmic procession. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-07", rank: 7, suit: "wands", name: "Seven of Wands", filename: "07-seven.jpg", relativePath: "minor/wands/07-seven.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Seven of Wands: A determined astral defender in a yellow tunic standing atop a jagged asteroid ridge, wielding a stout solar staff with both hands to defend his ground against six enemy staves thrust upward from the cosmic void, under an intense orange-gold nebula. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-08", rank: 8, suit: "wands", name: "Eight of Wands", filename: "08-eight.jpg", relativePath: "minor/wands/08-eight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Eight of Wands: Eight living wooden staves with glowing green leaf sprouts speeding in swift, orderly unison through the open cosmic void, descending past orbiting moons and a spiral galaxy across an astral horizon. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-09", rank: 9, suit: "wands", name: "Nine of Wands", filename: "09-nine.jpg", relativePath: "minor/wands/09-nine.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Nine of Wands: A battle-hardened astral sentinel with a starlight bandage on his head leans firmly upon a tall staff, looking cautiously over his shoulder with eight upright staves forming a glowing defensive palisade behind him on an asteroid outpost under a dark cosmos. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-10", rank: 10, suit: "wands", name: "Ten of Wands", filename: "10-ten.jpg", relativePath: "minor/wands/10-ten.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Ten of Wands: A weary astral traveler bent forward under the heavy weight of ten long wooden staves bundled in his arms, trudging resolutely along an asteroid ridge toward a glowing domed citadel on a distant planetary horizon under a violet nebula sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-11", rank: 11, suit: "wands", name: "Page of Wands", filename: "11-page.jpg", relativePath: "minor/wands/11-page.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Page of Wands: An eager youth in a yellow tunic patterned with fiery salamanders standing on the cratered surface of a moon, holding a tall sprouting wooden staff with both hands, looking up in inspired awe at a swirling stellar nursery nebula. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-12", rank: 12, suit: "wands", name: "Knight of Wands", filename: "12-knight.jpg", relativePath: "minor/wands/12-knight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Knight of Wands: A dashing armored knight wearing a yellow cloak embroidered with salamanders, riding a spirited chestnut celestial steed rearing up on an asteroid edge, holding an upright flowering wand with fiery red helmet plumes trailing sparks against deep space. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-13", rank: 13, suit: "wands", name: "Queen of Wands", filename: "13-queen.jpg", relativePath: "minor/wands/13-queen.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Queen of Wands: A confident queen seated on a stone throne carved with lions and sunflowers on a floating asteroid, holding a flowering staff and a golden sunflower; a sleek black star-cat sits calmly at her feet before deep-space nebulae. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-14", rank: 14, suit: "wands", name: "King of Wands", filename: "14-king.jpg", relativePath: "minor/wands/14-king.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} King of Wands: An authoritative monarch on a stone throne carved with lions and biting salamanders on an asteroid overlook, wearing a flame-shaped crown and red-gold mantle, holding a living staff crowned with blossoms, an alert salamander at his feet under blazing solar flares. ${ART_STYLE_SUFFIX}`
  },

  // ── MINOR ARCANA: CUPS (Water / Liquid Starlight) ──
  {
    id: "cups-01", rank: 1, suit: "cups", name: "Ace of Cups", filename: "01-ace.jpg", relativePath: "minor/cups/01-ace.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Ace of Cups: A divine hand emerging from a luminous white nebula cloud holds an ornate golden chalice. From the chalice, five crystalline streams of liquid starlight cascade downward into a tranquil pool filled with blooming white water lilies on a floating asteroid. Above the cup hovers a pure white dove carrying a circular host stamped with a cross. Luminous ripples and sparkling droplets. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-02", rank: 2, suit: "cups", name: "Two of Cups", filename: "02-two.jpg", relativePath: "minor/cups/02-two.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Two of Cups: Two astral lovers in white and crimson robes exchange two golden chalices in sacred pledge beneath the floating winged red lion head of a caduceus, set upon a floating asteroid terrace overlooking a ringed blue planet under a calm cosmos. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-03", rank: 3, suit: "cups", name: "Three of Cups", filename: "03-three.jpg", relativePath: "minor/cups/03-three.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Three of Cups: Three joyful maidens in flowing pastel gowns dance gracefully in a circle on a garden asteroid, raising three ornate golden chalices in celebration. Ripe purple grapes and abundant harvest fruits surround their feet under a warm golden nebula sun. Expressive black ink linework. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-04", rank: 4, suit: "cups", name: "Four of Cups", filename: "04-four.jpg", relativePath: "minor/cups/04-four.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Four of Cups: A contemplative youth seated cross-legged beneath a cosmic starlight tree on an asteroid ledge, arms folded, staring down at three golden cups on the stone, ignoring a fourth glowing chalice offered out of a stardust cloud by a divine hand. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-05", rank: 5, suit: "cups", name: "Five of Cups", filename: "05-five.jpg", relativePath: "minor/cups/05-five.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Five of Cups: A cloaked figure in a heavy black mantle standing on an asteroid shore with bowed head, grieving over three overturned golden chalices spilling wine on the stone, oblivious to two upright full chalices standing behind him near an ancient bridge of starlight. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-06", rank: 6, suit: "cups", name: "Six of Cups", filename: "06-six.jpg", relativePath: "minor/cups/06-six.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Six of Cups: A gentle youth offering a golden chalice filled with glowing white star-blossoms to a younger companion on an asteroid terrace; four other flower-filled chalices stand around them overlooking Saturn-like planetary rings and soft nebula dust. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-07", rank: 7, suit: "cups", name: "Seven of Cups", filename: "07-seven.jpg", relativePath: "minor/cups/07-seven.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Seven of Cups: A dark silhouette of an astral seeker viewed from behind, marveling at seven golden chalices floating upon glowing cosmic clouds, each containing strange mystical visions: an astral castle, jewels, a laurel wreath, a winged dragon, and a glowing celestial head. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-08", rank: 8, suit: "cups", name: "Eight of Cups", filename: "08-eight.jpg", relativePath: "minor/cups/08-eight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Eight of Cups: A cloaked traveler in a crimson mantle with a walking staff hiking away into rugged asteroid mountains, leaving eight neatly stacked golden cups behind on a shore of liquid starlight under a glowing crescent moon and starry void. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-09", rank: 9, suit: "cups", name: "Nine of Cups", filename: "09-nine.jpg", relativePath: "minor/cups/09-nine.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Nine of Cups: A prosperous, jovial figure in a blue robe and red cap seated with folded arms on an asteroid bench, smiling with deep contentment before an arched stone table displaying nine gleaming golden chalices filled with starlight in an arc against a starry sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-10", rank: 10, suit: "cups", name: "Ten of Cups", filename: "10-ten.jpg", relativePath: "minor/cups/10-ten.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Ten of Cups: A loving family with arms raised in joy gazing up at a celestial rainbow arc of ten golden chalices in the cosmic sky; their children dance beside a quaint domed observatory and a stream of liquid starlight on an asteroid meadow. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-11", rank: 11, suit: "cups", name: "Page of Cups", filename: "11-page.jpg", relativePath: "minor/cups/11-page.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Page of Cups: A gentle youth in a blue floral tunic standing beside rolling waves of blue cosmic ether on an asteroid shore, gazing with affectionate curiosity at a small silvery star-fish peeking out from a golden chalice held in his hand. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-12", rank: 12, suit: "cups", name: "Knight of Cups", filename: "12-knight.jpg", relativePath: "minor/cups/12-knight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Knight of Cups: A graceful knight in polished armor with winged helmet riding a tranquil white celestial steed across a shallow stream of liquid starlight, carrying an upright golden chalice before him against a backdrop of deep space nebulae. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-13", rank: 13, suit: "cups", name: "Queen of Cups", filename: "13-queen.jpg", relativePath: "minor/cups/13-queen.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Queen of Cups: A visionary queen seated on an ornate stone sea-throne sculpted with mermaids by the edge of an interstellar ocean of liquid starlight, holding an intricate hexagonal covered chalice, gazing into the waters beneath glowing nebulae. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-14", rank: 14, suit: "cups", name: "King of Cups", filename: "14-king.jpg", relativePath: "minor/cups/14-king.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} King of Cups: A wise monarch seated on a stone throne floating upon an interstellar ocean, wearing a blue robe and fish collar, holding a golden chalice and lotus scepter as an astral ship sails and a celestial dolphin leaps in the background. ${ART_STYLE_SUFFIX}`
  },

  // ── MINOR ARCANA: SWORDS (Air / Cosmic Winds) ──
  {
    id: "swords-01", rank: 1, suit: "swords", name: "Ace of Swords", filename: "01-ace.jpg", relativePath: "minor/swords/01-ace.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Ace of Swords: A divine hand emerging from a swirling white nebula cloud firmly grasps the golden hilt of an upright starlight broadsword. The blade pierces through a golden celestial crown draped with olive branches. Swirling cosmic wind currents and falling golden stardust surround the blade over distant jagged asteroid peaks under a deep cosmos. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-02", rank: 2, suit: "swords", name: "Two of Swords", filename: "02-two.jpg", relativePath: "minor/swords/02-two.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Two of Swords: A blindfolded maiden in a pure white gown seated on a stone bench on a quiet asteroid, balancing two long crossed steel swords across her chest under a silver crescent moon and tranquil cosmic sea. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-03", rank: 3, suit: "swords", name: "Three of Swords", filename: "03-three.jpg", relativePath: "minor/swords/03-three.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Three of Swords: A brilliant crimson heart suspended in the deep cosmic void, pierced through by three long silver starlight broadswords emitting radiant energy rays against dark swirling storm nebulae with cosmic wind currents. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-04", rank: 4, suit: "swords", name: "Four of Swords", filename: "04-four.jpg", relativePath: "minor/swords/04-four.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Four of Swords: A stone sculpture effigy of an astral knight resting in peaceful meditation upon a sarcophagus tomb inside an orbital sanctuary chamber; three swords hang pointing down from the wall, one rests horizontally beneath him beside a stained-glass constellation window. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-05", rank: 5, suit: "swords", name: "Five of Swords", filename: "05-five.jpg", relativePath: "minor/swords/05-five.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Five of Swords: A smiling, victorious rogue holding three starlight swords while gathering another from the asteroid floor, looking back at two defeated opponents walking away toward a turbulent cosmic sea under wind-torn nebula clouds. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-06", rank: 6, suit: "swords", name: "Six of Swords", filename: "06-six.jpg", relativePath: "minor/swords/06-six.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Six of Swords: A slender astral ferryman guiding a wooden skiff carrying a cloaked traveler and child across a dark cosmic eddy toward a luminous stellar dawn; six upright swords stand rooted in the boat, ferrying them across space. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-07", rank: 7, suit: "swords", name: "Seven of Swords", filename: "07-seven.jpg", relativePath: "minor/swords/07-seven.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Seven of Swords: An agile astral thief on tiptoe sneaking away from an orbital expedition camp, carrying five starlight swords in his arms and looking back over his shoulder at two swords left behind stuck in the asteroid rock. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-08", rank: 8, suit: "swords", name: "Eight of Swords", filename: "08-eight.jpg", relativePath: "minor/swords/08-eight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Eight of Swords: A bound and blindfolded woman in a red gown standing trapped on an asteroid crag, encircled by a cage of eight sharp upright steel broadswords, beneath a deep space sky with a distant celestial spire. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-09", rank: 9, suit: "swords", name: "Nine of Swords", filename: "09-nine.jpg", relativePath: "minor/swords/09-nine.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Nine of Swords: A weeping figure sitting upright in an orbital chamber with face buried in hands; on the dark wall above hang nine horizontal steel broadswords pointing right, with a quilt decorated with astrological constellations and planetary glyphs. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-10", rank: 10, suit: "swords", name: "Ten of Swords", filename: "10-ten.jpg", relativePath: "minor/swords/10-ten.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Ten of Swords: A fallen figure lying on an asteroid shore draped in a crimson cloak, pierced along the spine by ten upright swords; in the background, dark storm nebulae break to reveal a golden sunrise of a new star over calm space waters. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-11", rank: 11, suit: "swords", name: "Page of Swords", filename: "11-page.jpg", relativePath: "minor/swords/11-page.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Page of Swords: An alert youth in a green tunic standing on an asteroid crag, holding an upright steel broadsword with both hands, looking warily over his shoulder as cosmic wind currents and stardust sweep across the sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-12", rank: 12, suit: "swords", name: "Knight of Swords", filename: "12-knight.jpg", relativePath: "minor/swords/12-knight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Knight of Swords: A fierce armored knight in plate armor galloping at full charge on a white celestial warhorse through solar storm winds, starlight broadsword brandished high, crimson cloak whipping violently against jagged nebula clouds. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-13", rank: 13, suit: "swords", name: "Queen of Swords", filename: "13-queen.jpg", relativePath: "minor/swords/13-queen.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Queen of Swords: A dignified, stern queen seated in profile on a carved stone throne with butterfly motifs floating high above planetary clouds, holding an upright broadsword in her right hand and gesturing with open left hand into the cosmos. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-14", rank: 14, suit: "swords", name: "King of Swords", filename: "14-king.jpg", relativePath: "minor/swords/14-king.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} King of Swords: A stern, intellectual monarch seated on an ornate stone throne decorated with cherubs and butterflies in deep space, holding an upright steel broadsword in his right hand. He wears a blue mantle, crimson robe, and a golden crown. Behind the throne, swirling cosmic wind currents and scudding clouds in a starry indigo sky. ${ART_STYLE_SUFFIX}`
  },

  // ── MINOR ARCANA: PENTACLES (Earth / Star Metal & Asteroids) ──
  {
    id: "pentacles-01", rank: 1, suit: "pentacles", name: "Ace of Pentacles", filename: "01-ace.jpg", relativePath: "minor/pentacles/01-ace.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Ace of Pentacles: A divine hand emerging from a luminous white nebula cloud holds a massive, intricately engraved golden pentacle coin with an inscribed five-pointed star. Below lies a flourishing enclosed garden with a lush archway of white lilies and red roses on an asteroid terrace, leading out to distant ringed planets under a warm amber sky. Glowing golden geomantic dust particles float softly in zero gravity. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-02", rank: 2, suit: "pentacles", name: "Two of Pentacles", filename: "02-two.jpg", relativePath: "minor/pentacles/02-two.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Two of Pentacles: A lively dancing youth in a tall red hat juggling two large golden pentacle coins enclosed within a continuous glowing green infinity loop ribbon (lemniscate); in the background, two celestial sailing ships toss upon mountainous cosmic waves under a bright starry sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-03", rank: 3, suit: "pentacles", name: "Three of Pentacles", filename: "03-three.jpg", relativePath: "minor/pentacles/03-three.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Three of Pentacles: A skilled artisan with hammer and chisel, an architect with orbital plans, and a cosmic astronomer conferring inside an asteroid observatory archway; three carved golden pentacles are set into the stone arch above against deep space. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-04", rank: 4, suit: "pentacles", name: "Four of Pentacles", filename: "04-four.jpg", relativePath: "minor/pentacles/04-four.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Four of Pentacles: A crowned figure in a crimson cloak seated on an asteroid pedestal, clutching one golden pentacle tightly to his chest, resting both feet upon two pentacles, with a fourth pentacle balanced atop his crown, before a distant orbital city skyline. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-05", rank: 5, suit: "pentacles", name: "Five of Pentacles", filename: "05-five.jpg", relativePath: "minor/pentacles/05-five.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Five of Pentacles: Two impoverished wanderers in tattered rags trudging through icy snow on a frozen comet surface, passing beneath an illuminated stained-glass observatory dome glowing brightly with five golden pentacles into the dark cosmos. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-06", rank: 6, suit: "pentacles", name: "Six of Pentacles", filename: "06-six.jpg", relativePath: "minor/pentacles/06-six.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Six of Pentacles: A generous cosmic merchant in a purple velvet robe holding a pair of golden scales in his left hand, gently bestowing golden pentacle coins with his right into the open palms of two kneeling supplicants on an asteroid terrace. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-07", rank: 7, suit: "pentacles", name: "Seven of Pentacles", filename: "07-seven.jpg", relativePath: "minor/pentacles/07-seven.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Seven of Pentacles: A patient cosmic farmer in a work tunic resting on a staff, gazing contemplatively at a lush vine bearing seven heavy glowing golden pentacles in an asteroid greenhouse under a starry sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-08", rank: 8, suit: "pentacles", name: "Eight of Pentacles", filename: "08-eight.jpg", relativePath: "minor/pentacles/08-eight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Eight of Pentacles: An industrious artisan in an apron seated on an asteroid workbench, diligently engraving an ornate pentagram into a golden coin with hammer and chisel; six finished golden pentacles are displayed on a stone pillar beside him under a starry sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-09", rank: 9, suit: "pentacles", name: "Nine of Pentacles", filename: "09-nine.jpg", relativePath: "minor/pentacles/09-nine.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Nine of Pentacles: An elegant noblewoman in a flowing golden gown standing in a lush garden on an asteroid terrace heavy with ripe purple grapes; a hooded cosmic falcon perches calmly on her gloved hand, surrounded by nine heavy golden pentacles under a starlight sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-10", rank: 10, suit: "pentacles", name: "Ten of Pentacles", filename: "10-ten.jpg", relativePath: "minor/pentacles/10-ten.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Ten of Pentacles: A multi-generational family gathered beneath a carved stone archway on an orbital estate: an elderly patriarch in an embroidered coat strokes two white celestial hounds, while a young couple and child play, with ten golden pentacles arranged in the Tree of Life pattern. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-11", rank: 11, suit: "pentacles", name: "Page of Pentacles", filename: "11-page.jpg", relativePath: "minor/pentacles/11-page.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Page of Pentacles: A studious youth in a green tunic walking across a flowering asteroid meadow, reverently holding aloft a single golden pentacle coin on his fingertips, gazing at it in deep concentration under a bright cosmos. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-12", rank: 12, suit: "pentacles", name: "Knight of Pentacles", filename: "12-knight.jpg", relativePath: "minor/pentacles/12-knight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Knight of Pentacles: A patient, armored knight mounted upon a heavy black celestial draught horse in the middle of furrowed asteroid soil, holding a single golden pentacle before him with serene, unwavering focus against an astral horizon. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-13", rank: 13, suit: "pentacles", name: "Queen of Pentacles", filename: "13-queen.jpg", relativePath: "minor/pentacles/13-queen.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Queen of Pentacles: A bountiful queen seated on a stone throne carved with goats and fruit on a garden asteroid; she cradles a large golden pentacle in her lap with maternal care as an astral hare plays in the grass at her feet under a warm nebula. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-14", rank: 14, suit: "pentacles", name: "King of Pentacles", filename: "14-king.jpg", relativePath: "minor/pentacles/14-king.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} King of Pentacles: A prosperous monarch seated on a stone throne carved with bull heads, draped in robes embroidered with ripe grapevines on an asteroid terrace; he rests his right hand on a golden scepter and his left on a heavy golden pentacle coin under glowing star clusters. ${ART_STYLE_SUFFIX}`
  }
];

export function getCardPrompt(suit, rank) {
  return CARD_PROMPT_CATALOG.find(c => c.suit === suit && c.rank === rank) || null;
}

export function getRemainingCards() {
  return CARD_PROMPT_CATALOG.filter(c => !c.shipped);
}
