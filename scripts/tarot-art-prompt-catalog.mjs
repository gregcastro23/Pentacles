/**
 * Tarot Art Prompt Catalog & Blueprint Registry
 * 
 * Defines the canonical prompt specifications for all 78 Tarot cards
 * in the authentic Pamela Colman Smith ("Pixie" 1909) aesthetic
 * with modern elemental and celestial alchemical flair.
 */

export const ART_STYLE_PREFIX = 
  "Tarot card art in the authentic Pamela Colman Smith Pixie style with an elemental modern spin.";

export const ART_STYLE_SUFFIX = 
  "Bold hand-drawn black ink linework, antique vintage parchment paper texture, rich gouache watercolor washes. Vertical tarot composition, 2:3 aspect ratio, no text, no border.";

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
    prompt: `${ART_STYLE_PREFIX} The Fool (Major Arcana 0): A young wanderer in a floral-embroidered tunic stands poised at the edge of a jagged seaside cliff. In his left hand he holds a delicate white rose; over his right shoulder he balances a wooden staff bearing an embroidered satchel. A small white dog gambols excitedly at his heels. Above him, a brilliant white celestial sun shines in a golden-yellow sky with soft cosmic aurora ribbons. Distant snowy mountains rise in the background. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-01",
    rank: 1,
    suit: "major",
    name: "The Magician",
    filename: "01-the-magician.jpg",
    relativePath: "major/01-the-magician.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} The Magician (Major Arcana I): A mystical magus in a white tunic and deep red mantle standing serenely before a stone altar table. On the table rest the four elemental implements: a sprouting wooden wand with burning embers, a golden chalice overflowing with luminous blue water, an upright silver steel sword with wind currents, and a carved golden pentacle coin radiating earth energy. His right hand raises a glowing quartz wand to heaven, his left hand points down to the ground. Above his head floats an infinity symbol lemniscate of radiant golden starlight. Red roses and white lilies frame the scene. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-02",
    rank: 2,
    suit: "major",
    name: "The High Priestess",
    filename: "02-the-high-priestess.jpg",
    relativePath: "major/02-the-high-priestess.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} The High Priestess (Major Arcana II): A serene, enigmatic priestess seated between two massive temple pillars—one black marked with letter 'B', one white marked with letter 'J'. Behind her hangs a veil embroidered with ripe red pomegranates and green palm leaves. She wears a horned lunar crown with a full sphere and flowing blue robes that pool like living water. In her lap rests a scroll inscribed 'TORA'. At her feet rests a glowing horned crescent moon. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-03",
    rank: 3,
    suit: "major",
    name: "The Empress",
    filename: "03-the-empress.jpg",
    relativePath: "major/03-the-empress.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} The Empress (Major Arcana III): A gracious maternal queen seated on plush patterned cushions amid a flourishing field of golden wheat. She wears a crown of twelve brilliant six-pointed stars and a white robe patterned with red pomegranates. Beside her stone throne rests a heart-shaped shield engraved with the Venus symbol ♀. A crystal waterfall cascades into a tranquil blue stream in the background under warm amber sunlight with gentle floating celestial pollen particles. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-04",
    rank: 4,
    suit: "major",
    name: "The Emperor",
    filename: "04-the-emperor.jpg",
    relativePath: "major/04-the-emperor.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} The Emperor (Major Arcana IV): A stern, bearded sovereign in crimson robes and iron armor seated upon a massive cubic stone throne carved with four ram heads. In his right hand he holds an ankh scepter, in his left a golden orb radiating solar heat. In the background rise jagged terracotta mountain crags under a fiery orange-red sky with subtle glowing Martian embers. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-05",
    rank: 5,
    suit: "major",
    name: "The Hierophant",
    filename: "05-the-hierophant.jpg",
    relativePath: "major/05-the-hierophant.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} The Hierophant (Major Arcana V): A solemn spiritual pontiff seated between two fluted gray stone columns. He wears a triple golden papal tiara and layered crimson and white ceremonial vestments, raising two fingers in sacred blessing while holding a triple cross scepter. At his feet cross two golden celestial keys. Two priests in floral robes kneel before him in devotion. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-06",
    rank: 6,
    suit: "major",
    name: "The Lovers",
    filename: "06-the-lovers.jpg",
    relativePath: "major/06-the-lovers.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} The Lovers (Major Arcana VI): Archangel Raphael with magnificent violet and golden wings emerges from a golden cloud, hands outstretched in blessing. Below in a lush paradisiacal meadow stand a man beside the Tree of Life with twelve burning fruits, and a woman beside the Tree of Knowledge encircled by a wise serpent. Behind them rises a towering volcanic red mountain beneath a radiant sun. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-07",
    rank: 7,
    suit: "major",
    name: "The Chariot",
    filename: "07-the-chariot.jpg",
    relativePath: "major/07-the-chariot.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} The Chariot (Major Arcana VII): A triumphant young prince in silver plate armor with lunar shoulder pauldrons stands inside a square stone chariot beneath a starry blue fabric canopy. He holds a glowing wand of command. In front rest two sphinxes—one black, one white. In the background across a blue river rises a fortified walled city. Glowing starlight accents. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-08",
    rank: 8,
    suit: "major",
    name: "Strength",
    filename: "08-strength.jpg",
    relativePath: "major/08-strength.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Strength (Major Arcana VIII): A serene maiden draped in white robes adorned with floral garlands gently closes the jaws of a majestic, muscular golden lion with her bare hands. Above her head hovers a glowing golden infinity symbol lemniscate. Soft rolling green hills and a gentle stream lie under a warm golden-yellow sky with subtle sunbeam particles. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-09",
    rank: 9,
    suit: "major",
    name: "The Hermit",
    filename: "09-the-hermit.jpg",
    relativePath: "major/09-the-hermit.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} The Hermit (Major Arcana IX): An elderly hooded sage in gray woolen robes stands atop a lonely snow-capped mountain pinnacle against a deep twilight sky. In his right hand he holds aloft a golden six-sided lantern enclosing a brilliant glowing six-pointed star that casts beams of illumination; in his left hand he leans upon a tall wooden pilgrim staff. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-10",
    rank: 10,
    suit: "major",
    name: "Wheel of Fortune",
    filename: "10-wheel-of-fortune.jpg",
    relativePath: "major/10-wheel-of-fortune.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Wheel of Fortune (Major Arcana X): A massive celestial wheel carved with esoteric letters and alchemical symbols floats in blue clouds. Atop sits a blue Sphinx holding a sword; descending is a serpentine Typhon; ascending is the jackal-headed Anubis. In the four corners of the sky rest the four winged creatures (angel, eagle, lion, bull) studying sacred books, bathed in cosmic stardust. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-11",
    rank: 11,
    suit: "major",
    name: "Justice",
    filename: "11-justice.jpg",
    relativePath: "major/11-justice.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Justice (Major Arcana XI): A dignified queen in crimson robes and green mantle seated between two pale stone pillars before a purple veil. In her right hand she holds an upright double-edged steel sword with an edge glint; in her left she balances a pair of golden scales of equilibrium. A square golden jewel adorns her crown under a soft amber-gold atmosphere. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-12",
    rank: 12,
    suit: "major",
    name: "The Hanged Man",
    filename: "12-the-hanged-man.jpg",
    relativePath: "major/12-the-hanged-man.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} The Hanged Man (Major Arcana XII): A peaceful figure suspended upside down by one ankle from a living wooden T-cross shaped like a gallows with green leaf sprouts. His free leg is crossed behind the other in a numeral four shape. His arms are crossed behind his back. Around his head glows a bright golden nimbus halo of illumination and celestial calm. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-13",
    rank: 13,
    suit: "major",
    name: "Death",
    filename: "13-death.jpg",
    relativePath: "major/13-death.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Death (Major Arcana XIII): A skeletal knight in polished black armor rides a magnificent armored white horse across a battlefield. He carries a black silk banner embroidered with a mystical white five-petaled rose. On the ground a king has fallen, while a bishop and maiden pray. In the distance a river flows between two towers where a brilliant golden sun dawns on the horizon. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-14",
    rank: 14,
    suit: "major",
    name: "Temperance",
    filename: "14-temperance.jpg",
    relativePath: "major/14-temperance.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Temperance (Major Arcana XIV): A magnificent winged angel in white robes with fiery crimson wings stands with one foot in crystal water and one foot on green earth. The angel pours a luminous stream of living water between two golden chalices without spilling a drop. On the angel's forehead shines a golden solar disk; in the background a winding path leads between mountains to a glowing crown in the sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-15",
    rank: 15,
    suit: "major",
    name: "The Devil",
    filename: "15-the-devil.jpg",
    relativePath: "major/15-the-devil.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} The Devil (Major Arcana XV): A horned, winged satyr deity perched upon a black stone pedestal. An inverted pentagram glows on his brow, his right hand is raised in a mocking gesture, and in his left hand he holds a burning torch pointed downward. Chained loosely by their necks to the altar stand a horned man and woman with tails. Dark cavern background with glowing embers. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-16",
    rank: 16,
    suit: "major",
    name: "The Tower",
    filename: "16-the-tower.jpg",
    relativePath: "major/16-the-tower.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} The Tower (Major Arcana XVI): A tall stone fortress tower atop a jagged mountain peak struck by a fierce jagged bolt of celestial lightning. Fire and smoke erupt from the shattered top as a golden crown is knocked into the air. Two figures tumble downward into the stormy void amidst showers of falling golden sparks under a dark turbulent sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-17",
    rank: 17,
    suit: "major",
    name: "The Star",
    filename: "17-the-star.jpg",
    relativePath: "major/17-the-star.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} The Star (Major Arcana XVII): A serene maiden wearing a simple light linen tunic kneels beside a pool of blue water under a deep twilight sky. She pours water from two terracotta jugs—one onto the earth, nourishing lush green grass, and one into the pool, creating luminous ripples. Above her shines a giant eight-pointed radiant yellow star surrounded by seven smaller white stars. An ibis bird rests in a tree. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-18",
    rank: 18,
    suit: "major",
    name: "The Moon",
    filename: "18-the-moon.jpg",
    relativePath: "major/18-the-moon.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} The Moon (Major Arcana XVIII): A large full moon with a dreaming facial profile in a circular disk sends down sixteen principal rays and golden drops of dew. Below, a domestic dog and a wild wolf bay up at the moon. A crayfish crawls up out of a green pool along a path leading between two stone towers into distant hills under a dark indigo starry night sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-19",
    rank: 19,
    suit: "major",
    name: "The Sun",
    filename: "19-the-sun.jpg",
    relativePath: "major/19-the-sun.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} The Sun (Major Arcana XIX): A massive radiant smiling golden sun in the sky with alternating wavy and straight rays showering warm golden light. A joyful crowned youth wearing a simple white tunic with a red feather in their hair rides bareback upon a gentle white horse, holding a large billowing crimson banner. In the background, a gray stone wall over which tall bright golden sunflowers bloom vibrantly. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-20",
    rank: 20,
    suit: "major",
    name: "Judgement",
    filename: "20-judgement.jpg",
    relativePath: "major/20-judgement.jpg",
    shipped: false,
    prompt: `${ART_STYLE_PREFIX} Judgement (Major Arcana XX): Archangel Gabriel with feathered wings emerges from radiant clouds, blowing a long golden trumpet bearing a white banner with a red solar cross. Below, draped figures of a man, woman, and child rise with arms outstretched in joy and awe from floating stone tombs on a calm blue sea, surrounded by snowy mountains under a glowing celestial dawn. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "major-21",
    rank: 21,
    suit: "major",
    name: "The World",
    filename: "21-the-world.jpg",
    relativePath: "major/21-the-world.jpg",
    shipped: true,
    prompt: `${ART_STYLE_PREFIX} The World (Major Arcana XXI): A graceful dancing figure draped in a flowing violet silk sash stands within a large oval green laurel wreath tied with red ribbons. In each hand the dancer holds a slender wooden wand. Surrounding the wreath in the four corners of the starry cosmic sky are the four celestial cherubim: an angel, an eagle, a winged lion, and a winged bull. Luminous starlight nebulae. ${ART_STYLE_SUFFIX}`
  },

  // ── MINOR ARCANA: WANDS (Fire) ──
  {
    id: "wands-01", rank: 1, suit: "wands", name: "Ace of Wands", filename: "01-ace.jpg", relativePath: "minor/wands/01-ace.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Ace of Wands: A radiant divine hand emerging from a swirling white cloud holds an upright living wooden staff that sprouts green leaves and glowing solar fire embers. Sparkling golden fire sparks and luminous embers float gently around the wand. In the distance, rolling green and terracotta hills, a winding blue river, and a small medieval castle crowning a hill under a clear warm golden-amber sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-02", rank: 2, suit: "wands", name: "Two of Wands", filename: "02-two.jpg", relativePath: "minor/wands/02-two.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Two of Wands: A noble robed figure in a crimson cloak stands upon the stone battlement of a castle looking out over a wide blue sea and mountainous coastline. In his right hand he holds a miniature fiery celestial orb that glows like a miniature star; in his left hand he rests upon a tall wooden staff fixed to the stone wall. A second staff stands beside him. Rich gouache colors. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-03", rank: 3, suit: "wands", name: "Three of Wands", filename: "03-three.jpg", relativePath: "minor/wands/03-three.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Three of Wands: A noble merchant in red and green robes viewed from behind stands on a high clifftop, resting one hand upon one of three tall sprouting wooden staves firmly planted in the earth, gazing outward across a sparkling golden ocean where three sailing ships journey under a radiant amber sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-04", rank: 4, suit: "wands", name: "Four of Wands", filename: "04-four.jpg", relativePath: "minor/wands/04-four.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Four of Wands: Four tall wooden staves draped with luscious garlands of flowers, vines, and ripe fruits form a welcoming triumphal arbor; two figures in white gowns raise floral bouquets in celebration before a distant moat and stone castle under a joyful bright golden sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-05", rank: 5, suit: "wands", name: "Five of Wands", filename: "05-five.jpg", relativePath: "minor/wands/05-five.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Five of Wands: Five energetic youths in colorful medieval doublets brandishing sprouting wooden wands in mock tournament combat, crossing and parrying their staves in spirited competition under a clear summer sky with small sparks of fiery zeal. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-06", rank: 6, suit: "wands", name: "Six of Wands", filename: "06-six.jpg", relativePath: "minor/wands/06-six.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Six of Wands: A proud, crowned cavalry officer in green riding a caparisoned white horse, holding a tall wooden staff crowned with a vibrant green laurel wreath tied with fluttering silk ribbons; celebrating foot soldiers with wands march beside him in triumphant procession. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-07", rank: 7, suit: "wands", name: "Seven of Wands", filename: "07-seven.jpg", relativePath: "minor/wands/07-seven.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Seven of Wands: A determined defender in a yellow tunic standing atop a craggy rock ridge, holding a stout wooden wand with both hands to defend his ground against six enemy staves thrust upward from below, under an intense orange-gold sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-08", rank: 8, suit: "wands", name: "Eight of Wands", filename: "08-eight.jpg", relativePath: "minor/wands/08-eight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Eight of Wands: Eight living wooden staves with green leaf sprouts flying in swift, orderly unison through an open golden-blue sky, descending across a peaceful landscape with a winding river and distant blue mountains. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-09", rank: 9, suit: "wands", name: "Nine of Wands", filename: "09-nine.jpg", relativePath: "minor/wands/09-nine.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Nine of Wands: A vigilant, battle-hardened sentinel with a white bandage on his head leans firmly upon a tall staff, looking cautiously over his shoulder with eight upright staves forming a defensive palisade behind him. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-10", rank: 10, suit: "wands", name: "Ten of Wands", filename: "10-ten.jpg", relativePath: "minor/wands/10-ten.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Ten of Wands: A strong, weary laborer bent forward under the heavy weight of ten long, heavy wooden staves bundled in his arms, trudging resolutely toward a distant fortified manor on a green hill under a warm afternoon sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-11", rank: 11, suit: "wands", name: "Page of Wands", filename: "11-page.jpg", relativePath: "minor/wands/11-page.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Page of Wands: An eager, imaginative youth in a yellow tunic patterned with fiery salamanders and a feathered cap standing in a sunlit desert landscape, holding a tall sprouting wooden staff with both hands, looking up in inspired contemplation. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-12", rank: 12, suit: "wands", name: "Knight of Wands", filename: "12-knight.jpg", relativePath: "minor/wands/12-knight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Knight of Wands: A dashing armored knight wearing a yellow cloak embroidered with salamanders, riding a spirited chestnut horse rearing up on its hind legs across desert sand dunes, holding an upright flowering wand with fiery red helmet plumes fluttering in the wind. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-13", rank: 13, suit: "wands", name: "Queen of Wands", filename: "13-queen.jpg", relativePath: "minor/wands/13-queen.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Queen of Wands: A confident, radiant queen seated on a stone throne carved with lions and sunflowers, holding a flowering staff in one hand and a golden sunflower in the other; a sleek black cat sits calmly at her feet before desert mountains. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "wands-14", rank: 14, suit: "wands", name: "King of Wands", filename: "14-king.jpg", relativePath: "minor/wands/14-king.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} King of Wands: An authoritative, mature monarch seated on a stone throne carved with lions and biting salamanders, wearing a flame-shaped crown and red-and-gold mantle, holding a living staff crowned with blossoms, an alert salamander at his feet. ${ART_STYLE_SUFFIX}`
  },

  // ── MINOR ARCANA: CUPS (Water) ──
  {
    id: "cups-01", rank: 1, suit: "cups", name: "Ace of Cups", filename: "01-ace.jpg", relativePath: "minor/cups/01-ace.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Ace of Cups: A divine hand emerging from a luminous white cloud holds an ornate golden chalice in palm. From the chalice, five crystalline streams of water cascade downward into a tranquil pond filled with blooming white water lilies. Above the cup hovers a pure white dove carrying a circular communion host stamped with a cross. Luminous watery ripples and sparkling droplets. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-02", rank: 2, suit: "cups", name: "Two of Cups", filename: "02-two.jpg", relativePath: "minor/cups/02-two.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Two of Cups: A handsome youth and a lovely maiden in white and red garments exchange two golden chalices in sacred pledge beneath the floating winged red lion head of a caduceus, set against green rolling hills and a distant cottage under a clear sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-03", rank: 3, suit: "cups", name: "Three of Cups", filename: "03-three.jpg", relativePath: "minor/cups/03-three.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Three of Cups: Three joyful maidens in flowing pastel gowns (pink, golden, and white) dance gracefully in a circle in a lush garden orchard, raising three ornate golden chalices in celebration. Ripe purple grapes, pumpkins, and abundant harvest fruits surround their feet under a warm golden sun. Expressive black ink linework. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-04", rank: 4, suit: "cups", name: "Four of Cups", filename: "04-four.jpg", relativePath: "minor/cups/04-four.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Four of Cups: A contemplative young man seated cross-legged under a green tree on a grassy hill with arms folded, staring down at three golden cups on the lawn, ignoring a fourth glowing chalice offered out of a cloud by a divine hand. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-05", rank: 5, suit: "cups", name: "Five of Cups", filename: "05-five.jpg", relativePath: "minor/cups/05-five.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Five of Cups: A cloaked figure in a heavy black mantle standing on a riverbank with bowed head, grieving over three overturned golden chalices spilling wine on the ground, oblivious to two upright full chalices standing behind him near an ancient stone bridge. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-06", rank: 6, suit: "cups", name: "Six of Cups", filename: "06-six.jpg", relativePath: "minor/cups/06-six.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Six of Cups: A gentle boy in medieval costume offering a golden chalice filled with white star-shaped blossoms to a younger girl in a fairytale village courtyard; four other flower-filled chalices stand around them, with an older guard walking in the background. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-07", rank: 7, suit: "cups", name: "Seven of Cups", filename: "07-seven.jpg", relativePath: "minor/cups/07-seven.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Seven of Cups: A dark silhouette of a seeker viewed from behind, marveling at seven golden chalices floating upon fluffy white clouds, each containing strange mystical visions: a castle, jewels, a laurel wreath, a winged dragon, and a glowing face. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-08", rank: 8, suit: "cups", name: "Eight of Cups", filename: "08-eight.jpg", relativePath: "minor/cups/08-eight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Eight of Cups: A cloaked pilgrim in a crimson mantle leaning upon a walking staff, hiking away into dark rocky mountains and leaving eight neatly stacked golden cups behind on a riverbank under a crescent moon. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-09", rank: 9, suit: "cups", name: "Nine of Cups", filename: "09-nine.jpg", relativePath: "minor/cups/09-nine.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Nine of Cups: A prosperous, jovial merchant in a blue robe and red cap seated with folded arms on a wooden bench, smiling with deep contentment before an arched wooden table displaying nine gleaming golden chalices in an arc. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-10", rank: 10, suit: "cups", name: "Ten of Cups", filename: "10-ten.jpg", relativePath: "minor/cups/10-ten.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Ten of Cups: A loving husband and wife with arms raised in joy gazing up at a celestial rainbow of ten golden cups in the sky; their two happy children dance beside a quaint country cottage and winding river. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-11", rank: 11, suit: "cups", name: "Page of Cups", filename: "11-page.jpg", relativePath: "minor/cups/11-page.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Page of Cups: A gentle, artistic youth in a blue floral doublet and beret standing beside rolling blue waves, gazing with affectionate curiosity at a small silvery fish looking out from a golden cup held in his hand. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-12", rank: 12, suit: "cups", name: "Knight of Cups", filename: "12-knight.jpg", relativePath: "minor/cups/12-knight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Knight of Cups: A graceful, romantic knight in polished armor with winged helmet and tunic embroidered with fish, riding a tranquil white palfrey across a shallow stream, carrying an upright golden chalice before him. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-13", rank: 13, suit: "cups", name: "Queen of Cups", filename: "13-queen.jpg", relativePath: "minor/cups/13-queen.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Queen of Cups: A dreamy, crowned queen seated upon an ornate stone sea-throne sculpted with mermaids and scallops by the edge of the ocean, holding an intricate hexagonal covered chalice with cherub handles, gazing into the waters. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "cups-14", rank: 14, suit: "cups", name: "King of Cups", filename: "14-king.jpg", relativePath: "minor/cups/14-king.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} King of Cups: A wise, bearded king seated on a stone throne floating on the open sea, wearing a blue robe and fish collar, holding a golden chalice and a lotus scepter as a ship sails and a dolphin leaps in the background. ${ART_STYLE_SUFFIX}`
  },

  // ── MINOR ARCANA: SWORDS (Air) ──
  {
    id: "swords-01", rank: 1, suit: "swords", name: "Ace of Swords", filename: "01-ace.jpg", relativePath: "minor/swords/01-ace.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Ace of Swords: A powerful divine hand emerging from a swirling white cloud firmly grasps the golden hilt of an upright, double-edged steel broadsword. The blade pierces through a golden celestial crown draped with olive and palm branches. Wisps of swirling storm wind and falling golden dew yods surround the blade. Distant jagged blue mountain peaks under a cool crisp sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-02", rank: 2, suit: "swords", name: "Two of Swords", filename: "02-two.jpg", relativePath: "minor/swords/02-two.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Two of Swords: A blindfolded maiden in a pure white gown seated on a stone bench by a calm sea with reef rocks, balancing two long crossed steel swords across her chest under a silver crescent moon in a quiet night sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-03", rank: 3, suit: "swords", name: "Three of Swords", filename: "03-three.jpg", relativePath: "minor/swords/03-three.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Three of Swords: A brilliant crimson heart suspended in midair pierced through by three long silver steel swords, set against dark gray storm clouds pouring heavy diagonal sheets of rain with subtle lightning flashes. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-04", rank: 4, suit: "swords", name: "Four of Swords", filename: "04-four.jpg", relativePath: "minor/swords/04-four.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Four of Swords: A stone sculpture effigy of a knight resting peacefully in prayer upon a sarcophagus tomb inside a quiet cathedral sanctuary; three swords hang pointing down from the wall, one rests horizontally beneath him beside a stained glass window. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-05", rank: 5, suit: "swords", name: "Five of Swords", filename: "05-five.jpg", relativePath: "minor/swords/05-five.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Five of Swords: A smiling, victorious rogue holding three steel swords in his arms while picking up another from the grass, looking back at two defeated opponents walking away in despair toward a choppy gray ocean under ragged wind-torn clouds. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-06", rank: 6, suit: "swords", name: "Six of Swords", filename: "06-six.jpg", relativePath: "minor/swords/06-six.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Six of Swords: A slender ferryman poling a wooden punt carrying a huddled cloaked woman and child; six upright swords stand rooted in the boat, ferrying them from choppy water toward a calm, sunny shoreline under soft clouds. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-07", rank: 7, suit: "swords", name: "Seven of Swords", filename: "07-seven.jpg", relativePath: "minor/swords/07-seven.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Seven of Swords: A nimble thief on tiptoe sneaking away from a military camp of pitched tents, carrying five swords in his arms and looking back over his shoulder at two swords left behind stuck in the ground. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-08", rank: 8, suit: "swords", name: "Eight of Swords", filename: "08-eight.jpg", relativePath: "minor/swords/08-eight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Eight of Swords: A bound and blindfolded woman in a red gown standing trapped in wet marshy sand, encircled by a cage of eight sharp upright steel swords, beneath a gray sky with a castle perched high on distant cliffs. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-09", rank: 9, suit: "swords", name: "Nine of Swords", filename: "09-nine.jpg", relativePath: "minor/swords/09-nine.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Nine of Swords: A weeping woman sitting upright in bed with her face buried in her hands; on the dark wall above her hang nine horizontal steel swords pointing to the right, with a quilt decorated with astrological roses and planets. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-10", rank: 10, suit: "swords", name: "Ten of Swords", filename: "10-ten.jpg", relativePath: "minor/swords/10-ten.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Ten of Swords: A fallen figure lying face down on a beach draped in a red cloak, pierced by ten upright swords along the spine; in the background, dark storm clouds break to reveal a golden sunrise horizon over calm waters. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-11", rank: 11, suit: "swords", name: "Page of Swords", filename: "11-page.jpg", relativePath: "minor/swords/11-page.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Page of Swords: An alert, agile youth in a green tunic standing on a rocky hillock, holding an upright steel broadsword with both hands, looking warily over his shoulder as a flock of birds flies through wind-swept clouds. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-12", rank: 12, suit: "swords", name: "Knight of Swords", filename: "12-knight.jpg", relativePath: "minor/swords/12-knight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Knight of Swords: A fierce armored knight in plate armor galloping at full charge on a white warhorse through storm winds, broadsword brandished high, red cloak whipping violently against jagged storm clouds. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-13", rank: 13, suit: "swords", name: "Queen of Swords", filename: "13-queen.jpg", relativePath: "minor/swords/13-queen.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Queen of Swords: A dignified, stern queen seated in profile on a carved stone throne with butterfly motifs high in the clouds, holding an upright broadsword in her right hand and gesturing with an open left hand, looking out with piercing wisdom. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "swords-14", rank: 14, suit: "swords", name: "King of Swords", filename: "14-king.jpg", relativePath: "minor/swords/14-king.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} King of Swords: A stern, intellectual monarch seated on an ornate stone throne decorated with cherubs and butterflies, holding an upright steel broadsword in his right hand. He wears a blue mantle, crimson robe, and a golden crown. Behind the throne, swirling wind currents, two swallows in flight, and scudding storm clouds in a pale blue sky. ${ART_STYLE_SUFFIX}`
  },

  // ── MINOR ARCANA: PENTACLES (Earth) ──
  {
    id: "pentacles-01", rank: 1, suit: "pentacles", name: "Ace of Pentacles", filename: "01-ace.jpg", relativePath: "minor/pentacles/01-ace.jpg", shipped: true,
    prompt: `${ART_STYLE_PREFIX} Ace of Pentacles: A divine hand emerging from a luminous white cloud holds a massive, intricately engraved golden pentacle coin with an inscribed five-pointed star. Below lies a flourishing, enclosed garden with a lush archway of white lilies and red roses, leading out to distant blue mountains under a warm yellow-amber sky. Glowing golden geomantic dust particles float softly in the air. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-02", rank: 2, suit: "pentacles", name: "Two of Pentacles", filename: "02-two.jpg", relativePath: "minor/pentacles/02-two.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Two of Pentacles: A lively dancing youth in a tall red hat juggling two large golden pentacle coins enclosed within a continuous green infinity loop ribbon (lemniscate); in the background, two sailing ships toss upon mountainous ocean waves under a bright sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-03", rank: 3, suit: "pentacles", name: "Three of Pentacles", filename: "03-three.jpg", relativePath: "minor/pentacles/03-three.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Three of Pentacles: A skilled stone mason in a leather apron holding a hammer and chisel inside a gothic monastery archway, conferring with an architect holding parchment plans and a tonsured monk; three carved golden pentacles are set into the stone arch above. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-04", rank: 4, suit: "pentacles", name: "Four of Pentacles", filename: "04-four.jpg", relativePath: "minor/pentacles/04-four.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Four of Pentacles: A crowned figure in a dark red cloak seated on a stone pillar, clutching one golden pentacle tightly to his chest, resting both feet upon two pentacles, with a fourth pentacle balanced atop his crown, before a distant city skyline. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-05", rank: 5, suit: "pentacles", name: "Five of Pentacles", filename: "05-five.jpg", relativePath: "minor/pentacles/05-five.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Five of Pentacles: Two impoverished wanderers in tattered rags trudging through deep snow in a night blizzard, passing beneath an illuminated stained-glass church window glowing brightly with five golden pentacles. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-06", rank: 6, suit: "pentacles", name: "Six of Pentacles", filename: "06-six.jpg", relativePath: "minor/pentacles/06-six.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Six of Pentacles: A generous merchant in a rich purple velvet robe holding a pair of golden scales in his left hand, gently bestowing golden coins with his right hand into the open palms of two kneeling supplicants on a stone floor. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-07", rank: 7, suit: "pentacles", name: "Seven of Pentacles", filename: "07-seven.jpg", relativePath: "minor/pentacles/07-seven.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Seven of Pentacles: A patient farmer in a work tunic resting on his hoe, gazing contemplatively at a lush green vine bearing seven heavy golden pentacles in a flourishing vineyard under a tranquil sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-08", rank: 8, suit: "pentacles", name: "Eight of Pentacles", filename: "08-eight.jpg", relativePath: "minor/pentacles/08-eight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Eight of Pentacles: An industrious artisan in an apron seated on a wooden bench, diligently engraving an ornate pentagram into a golden coin with a hammer and chisel; six finished golden pentacles are displayed on a wooden pillar beside him. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-09", rank: 9, suit: "pentacles", name: "Nine of Pentacles", filename: "09-nine.jpg", relativePath: "minor/pentacles/09-nine.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Nine of Pentacles: An elegant noblewoman in a flowing golden gown adorned with flowers standing in a lush vineyard heavy with ripe purple grapes; a hooded falcon perches calmly on her gloved hand, surrounded by nine heavy golden pentacles. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-10", rank: 10, suit: "pentacles", name: "Ten of Pentacles", filename: "10-ten.jpg", relativePath: "minor/pentacles/10-ten.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Ten of Pentacles: A multi-generational family gathered beneath an ancient stone manor archway: an elderly patriarch in an embroidered coat strokes two white hounds, while a young couple and child play, with ten golden pentacles arranged in the Tree of Life pattern. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-11", rank: 11, suit: "pentacles", name: "Page of Pentacles", filename: "11-page.jpg", relativePath: "minor/pentacles/11-page.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Page of Pentacles: A studious youth in a green tunic and red chaperon walking through a flowering meadow, reverently holding aloft a single golden pentacle on his fingertips, gazing at it in deep, earnest concentration under a bright sky. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-12", rank: 12, suit: "pentacles", name: "Knight of Pentacles", filename: "12-knight.jpg", relativePath: "minor/pentacles/12-knight.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Knight of Pentacles: A patient, armored knight mounted upon a heavy, calm black draught horse in the middle of freshly ploughed brown fields, holding a single golden pentacle before him with serene, unwavering focus. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-13", rank: 13, suit: "pentacles", name: "Queen of Pentacles", filename: "13-queen.jpg", relativePath: "minor/pentacles/13-queen.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} Queen of Pentacles: A bountiful queen seated on a stone throne carved with goats and fruit in a lush summer garden; she cradles a large golden pentacle in her lap with maternal care as a wild brown hare plays in the grass at her feet. ${ART_STYLE_SUFFIX}`
  },
  {
    id: "pentacles-14", rank: 14, suit: "pentacles", name: "King of Pentacles", filename: "14-king.jpg", relativePath: "minor/pentacles/14-king.jpg", shipped: false,
    prompt: `${ART_STYLE_PREFIX} King of Pentacles: A prosperous monarch seated on a stone throne carved with bull heads, draped in robes embroidered with ripe grapevines; he rests his right hand on a golden scepter and his left on a heavy golden pentacle in a castle courtyard overflowing with flowers. ${ART_STYLE_SUFFIX}`
  }
];

export function getCardPrompt(suit, rank) {
  return CARD_PROMPT_CATALOG.find(c => c.suit === suit && c.rank === rank) || null;
}

export function getRemainingCards() {
  return CARD_PROMPT_CATALOG.filter(c => !c.shipped);
}

