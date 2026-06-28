// ============================================================================
// Pentacles — Generated Historical Agents Roster
// ============================================================================

export interface Figure {
  key: string;
  handle: string;
  date: Date;
  lat: number;
  lon: number;
  timeKnown: boolean;
  note?: string;
}

export const LMT = (lonDeg: number) => lonDeg / 15;
export function mk(y: number, mo: number, d: number, h: number, mi: number, offsetH: number): Date {
  const base = new Date(0);
  base.setUTCFullYear(y);
  base.setUTCMonth(mo - 1);
  base.setUTCDate(d);
  base.setUTCHours(h);
  base.setUTCMinutes(mi);
  base.setUTCSeconds(0);
  base.setUTCMilliseconds(0);
  return new Date(base.getTime() - offsetH * 3600_000);
}

export const FIGURES: Figure[] = [
  { key: "lewis-carroll", handle: "Lewis Carroll", date: mk(1832, 1, 27, 12, 0, LMT(-2.63)), lat: 53.34, lon: -2.63, timeKnown: false, note: "Daresbury, Cheshire, England; birth time unknown → solar chart" },
  { key: "emily-dickinson", handle: "Emily Dickinson", date: mk(1830, 12, 10, 12, 0, LMT(-72.52)), lat: 42.37, lon: -72.52, timeKnown: false, note: "Amherst, Massachusetts; birth time unknown → solar chart" },
  { key: "oscar-wilde", handle: "Oscar Wilde", date: mk(1854, 10, 16, 12, 0, LMT(-6.26)), lat: 53.35, lon: -6.26, timeKnown: false, note: "Dublin, Ireland; birth time unknown → solar chart" },
  { key: "fyodor-dostoevsky", handle: "Fyodor Dostoevsky", date: mk(1821, 11, 11, 12, 0, LMT(37.62)), lat: 55.75, lon: 37.62, timeKnown: false, note: "Moscow, Russia; birth time unknown → solar chart" },
  { key: "jane-austen", handle: "Jane Austen", date: mk(1775, 12, 16, 23, 45, LMT(-1.27)), lat: 51.23, lon: -1.27, timeKnown: true, note: "Steventon, Hampshire, England, 23:45 LMT (Rodden A)" },
  { key: "donatello", handle: "Donatello", date: mk(1386, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "petrarch", handle: "Petrarch", date: mk(1304, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "machiavelli", handle: "Niccolò Machiavelli", date: mk(1469, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "raphael", handle: "Raphael Sanzio", date: mk(1483, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "michelangelo", handle: "Michelangelo Buonarroti", date: mk(1475, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "alexander-the-great", handle: "Alexander the Great", date: mk(-356, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "archimedes", handle: "Archimedes", date: mk(-287, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "herodotus", handle: "Herodotus", date: mk(-484, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "cicero", handle: "Marcus Tullius Cicero", date: mk(-106, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "julius-caesar", handle: "Julius Caesar", date: mk(-100, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "plato", handle: "Plato", date: mk(-428, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "aristotle", handle: "Aristotle", date: mk(-384, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "homer", handle: "Homer", date: mk(-750, 1, 1, 12, 0, LMT(0)), lat: 0, lon: 0, timeKnown: false, note: "Unknown; birth time unknown → solar chart; location unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "socrates", handle: "Socrates", date: mk(-469, 6, 20, 12, 0, LMT(23.7275)), lat: 37.9838, lon: 23.7275, timeKnown: false, note: "Athens, Greece; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "leonardo-da-vinci", handle: "Leonardo da Vinci", date: mk(1452, 4, 15, 3, 0, LMT(11.25)), lat: 43.7833, lon: 11.25, timeKnown: false, note: "Vinci, Italy (BCE/Ancient approximate ephemeris)" },
  { key: "dante-alighieri", handle: "Dante Alighieri", date: mk(1265, 5, 21, 14, 0, LMT(11.2558)), lat: 43.7696, lon: 11.2558, timeKnown: false, note: "Florence, Republic of Florence (BCE/Ancient approximate ephemeris)" },
  { key: "thomas-aquinas", handle: "Thomas Aquinas", date: mk(1225, 1, 28, 12, 0, LMT(14.7894)), lat: 41.1171, lon: 14.7894, timeKnown: false, note: "Roccasecca, Kingdom of Sicily; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "geoffrey-chaucer", handle: "Geoffrey Chaucer", date: mk(1343, 1, 1, 12, 0, LMT(-0.1278)), lat: 51.5074, lon: -0.1278, timeKnown: false, note: "London, England; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "rumi", handle: "Jalal ad-Din Rumi", date: mk(1207, 9, 30, 6, 30, LMT(59.6168)), lat: 36.2605, lon: 59.6168, timeKnown: false, note: "Balkh, Afghanistan (BCE/Ancient approximate ephemeris)" },
  { key: "marcus-aurelius", handle: "Marcus Aurelius", date: mk(121, 4, 26, 14, 20, LMT(12.4964)), lat: 41.9028, lon: 12.4964, timeKnown: false, note: "Rome, Italy (BCE/Ancient approximate ephemeris)" },
  { key: "wolfgang-mozart", handle: "Wolfgang Amadeus Mozart", date: mk(1756, 1, 27, 20, 0, LMT(13.055)), lat: 47.8095, lon: 13.055, timeKnown: true, note: "Salzburg, Austria" },
  { key: "william-shakespeare", handle: "William Shakespeare", date: mk(1564, 4, 23, 10, 30, LMT(-1.708)), lat: 52.1919, lon: -1.708, timeKnown: false, note: "Stratford-upon-Avon, England (BCE/Ancient approximate ephemeris)" },
  { key: "galileo-galilei", handle: "Galileo Galilei", date: mk(1564, 2, 15, 15, 45, LMT(10.3064)), lat: 43.5311, lon: 10.3064, timeKnown: false, note: "Pisa, Italy (BCE/Ancient approximate ephemeris)" },
  { key: "rene-descartes-1596", handle: "René Descartes", date: mk(1596, 3, 31, 12, 0, LMT(0.3333)), lat: 46.1667, lon: 0.3333, timeKnown: false, note: "La Haye en Touraine, France; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "voltaire-1694", handle: "Voltaire", date: mk(1694, 11, 21, 15, 0, LMT(2.3522)), lat: 48.8566, lon: 2.3522, timeKnown: false, note: "Paris, France (BCE/Ancient approximate ephemeris)" },
  { key: "john-locke-1632", handle: "John Locke", date: mk(1632, 8, 29, 14, 0, LMT(-2.9981)), lat: 51.1279, lon: -2.9981, timeKnown: false, note: "Wrington, Somerset, England (BCE/Ancient approximate ephemeris)" },
  { key: "david-hume-1711", handle: "David Hume", date: mk(1711, 5, 7, 10, 0, LMT(-3.1883)), lat: 55.9533, lon: -3.1883, timeKnown: true, note: "Edinburgh, Scotland" },
  { key: "johannes-kepler-1571", handle: "Johannes Kepler", date: mk(1571, 12, 27, 14, 30, LMT(8.7044)), lat: 48.8915, lon: 8.7044, timeKnown: false, note: "Weil der Stadt, Holy Roman Empire (BCE/Ancient approximate ephemeris)" },
  { key: "immanuel-kant-1724", handle: "Immanuel Kant", date: mk(1724, 4, 22, 11, 0, LMT(20.5119)), lat: 54.7065, lon: 20.5119, timeKnown: true, note: "Königsberg, Prussia (now Kaliningrad, Russia)" },
  { key: "adam-smith-1723", handle: "Adam Smith", date: mk(1723, 6, 16, 9, 0, LMT(-3.1564)), lat: 56.072, lon: -3.1564, timeKnown: true, note: "Kirkcaldy, Scotland" },
  { key: "jean-jacques-rousseau-1712", handle: "Jean-Jacques Rousseau", date: mk(1712, 6, 28, 16, 0, LMT(6.1432)), lat: 46.2044, lon: 6.1432, timeKnown: true, note: "Geneva, Republic of Geneva" },
  { key: "mary-wollstonecraft-1759", handle: "Mary Wollstonecraft", date: mk(1759, 4, 27, 13, 0, LMT(-0.191)), lat: 51.4816, lon: -0.191, timeKnown: true, note: "Spitalfields, London, England" },
  { key: "charles-dickens-1812", handle: "Charles Dickens", date: mk(1812, 2, 7, 19, 50, LMT(-1.08)), lat: 50.8, lon: -1.08, timeKnown: true, note: "Landport, Portsmouth, England, 19:50 LMT (Rodden A)" },
  { key: "claude-monet-1840", handle: "Claude Monet", date: mk(1840, 11, 14, 12, 0, LMT(1.0993)), lat: 49.4431, lon: 1.0993, timeKnown: false, note: "Paris, France; birth time unknown → solar chart" },
  { key: "nikola-tesla-1856", handle: "Nikola Tesla", date: mk(1856, 7, 10, 0, 0, LMT(15.3)), lat: 44.5167, lon: 15.3, timeKnown: true, note: "Smiljan, Austrian Empire (now Croatia)" },
  { key: "marie-curie-1867", handle: "Marie Curie", date: mk(1867, 11, 7, 15, 0, LMT(21.0122)), lat: 52.2297, lon: 21.0122, timeKnown: true, note: "Warsaw, Congress Poland, Russian Empire" },
  { key: "sigmund-freud-1856", handle: "Sigmund Freud", date: mk(1856, 5, 6, 18, 30, LMT(17.2381)), lat: 49.6116, lon: 17.2381, timeKnown: true, note: "Freiberg, Moravia, Austrian Empire (now Czech Republic)" },
  { key: "mark-twain-1835", handle: "Mark Twain", date: mk(1835, 11, 30, 12, 0, LMT(-91.3563)), lat: 39.7095, lon: -91.3563, timeKnown: false, note: "Florida, Missouri, USA; birth time unknown → solar chart" },
  { key: "vincent-van-gogh-1853", handle: "Vincent van Gogh", date: mk(1853, 3, 30, 11, 0, LMT(5.4798)), lat: 51.4408, lon: 5.4798, timeKnown: true, note: "Groot-Zundert, Netherlands" },
  { key: "charles-darwin-1809", handle: "Charles Darwin", date: mk(1809, 2, 12, 15, 0, LMT(-2.7476)), lat: 52.7069, lon: -2.7476, timeKnown: true, note: "Shrewsbury, England" },
  { key: "edgar-allan-poe-1809", handle: "Edgar Allan Poe", date: mk(1809, 1, 19, 12, 0, LMT(-71.0589)), lat: 42.3601, lon: -71.0589, timeKnown: false, note: "Boston, Massachusetts, USA; birth time unknown → solar chart" },
  { key: "maya-angelou", handle: "Maya Angelou", date: mk(1928, 4, 4, 14, 10, -5), lat: 35.7796, lon: -78.6382, timeKnown: true, note: "St. Louis, Missouri, USA" },
  { key: "isaac-newton", handle: "Isaac Newton", date: mk(1643, 1, 4, 1, 38, LMT(-0.7514)), lat: 52.8076, lon: -0.7514, timeKnown: false, note: "Woolsthorpe, Lincolnshire, England (BCE/Ancient approximate ephemeris)" },
  { key: "albert-einstein", handle: "Albert Einstein", date: mk(1879, 3, 14, 11, 30, LMT(9.1833)), lat: 48.7833, lon: 9.1833, timeKnown: true, note: "Ulm, Germany" },
  { key: "isaac-asimov", handle: "Isaac Asimov", date: mk(1920, 1, 2, 15, 35, 3), lat: 55, lon: 32, timeKnown: true, note: "Petrovichi, Smolensk, Russia" },
  { key: "carl-jung", handle: "Carl Jung", date: mk(1875, 7, 26, 19, 32, LMT(9.3)), lat: 47.6, lon: 9.3, timeKnown: true, note: "Kesswil, Switzerland" },
  { key: "cleopatra", handle: "Cleopatra VII", date: mk(69, 1, 1, 12, 0, LMT(29.9)), lat: 31.2, lon: 29.9, timeKnown: false, note: "Alexandria, Egypt; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "frida-kahlo", handle: "Frida Kahlo", date: mk(1907, 7, 6, 8, 30, -6), lat: 19.3, lon: -99.2, timeKnown: true, note: "Coyoacán, Mexico" },
  { key: "benjamin-franklin", handle: "Benjamin Franklin", date: mk(1706, 1, 17, 12, 0, LMT(-71.0598)), lat: 42.3584, lon: -71.0598, timeKnown: false, note: "Boston, Massachusetts; birth time unknown → solar chart" },
  { key: "eleanor-roosevelt", handle: "Eleanor Roosevelt", date: mk(1884, 10, 11, 11, 0, LMT(-74.006)), lat: 40.7128, lon: -74.006, timeKnown: true, note: "New York, New York" },
  { key: "mahatma-gandhi", handle: "Mahatma Gandhi", date: mk(1869, 10, 2, 7, 30, LMT(69.6293)), lat: 21.6417, lon: 69.6293, timeKnown: true, note: "Porbandar, Gujarat, India" },
  { key: "confucius", handle: "Confucius (Kong Qiu)", date: mk(551, 9, 28, 6, 0, LMT(117.0382)), lat: 35.6097, lon: 117.0382, timeKnown: false, note: "Lu State (Qufu), China (BCE/Ancient approximate ephemeris)" },
  { key: "lao-tzu", handle: "Lao Tzu (Laozi)", date: mk(601, 4, 8, 5, 30, LMT(113.6553)), lat: 34.7578, lon: 113.6553, timeKnown: false, note: "Chu State (Henan), China (BCE/Ancient approximate ephemeris)" },
  { key: "siddhartha-gautama-buddha", handle: "Siddhartha Gautama (Buddha)", date: mk(563, 5, 15, 4, 0, LMT(83.2707)), lat: 27.5031, lon: 83.2707, timeKnown: false, note: "Lumbini, Nepal (BCE/Ancient approximate ephemeris)" },
  { key: "murasaki-shikibu", handle: "Murasaki Shikibu", date: mk(973, 10, 20, 18, 0, LMT(135.7681)), lat: 35.0116, lon: 135.7681, timeKnown: false, note: "Kyoto, Japan (BCE/Ancient approximate ephemeris)" },
  { key: "ibn-sina-avicenna", handle: "Ibn Sina (Avicenna)", date: mk(980, 8, 22, 3, 30, LMT(66.9597)), lat: 39.6539, lon: 66.9597, timeKnown: false, note: "Afshana, Uzbekistan (BCE/Ancient approximate ephemeris)" },
  { key: "tecumseh", handle: "Tecumseh", date: mk(1768, 3, 15, 5, 45, LMT(-82.8818)), lat: 40.0583, lon: -82.8818, timeKnown: true, note: "Ohio Territory (Piqua), North America" },
  { key: "wangari-maathai", handle: "Wangari Maathai", date: mk(1940, 4, 1, 14, 30, 3), lat: -0.0236, lon: 37.9062, timeKnown: true, note: "Nyeri, Kenya" },
  { key: "sitting-bull", handle: "Sitting Bull", date: mk(1831, 3, 15, 6, 30, LMT(-100.4167)), lat: 45.7833, lon: -100.4167, timeKnown: true, note: "Grand River, Dakota Territory" },
  { key: "joan-of-arc", handle: "Joan Of Arc", date: mk(1412, 1, 6, 12, 0, LMT(5.1667)), lat: 48.4444, lon: 5.1667, timeKnown: false, note: "Domrémy, France; birth time unknown → solar chart (BCE/Ancient approximate ephemeris)" },
  { key: "hildegard-of-bingen", handle: "Hildegard Of Bingen", date: mk(1098, 9, 16, 4, 30, LMT(7.8667)), lat: 49.9667, lon: 7.8667, timeKnown: false, note: "Bermersheim, Holy Roman Empire (BCE/Ancient approximate ephemeris)" },
  { key: "sojourner-truth", handle: "Sojourner Truth", date: mk(1797, 1, 15, 7, 0, LMT(-74.006)), lat: 41.927, lon: -74.006, timeKnown: true, note: "Swartekill, New York" },
  { key: "carl-sagan", handle: "Carl Sagan", date: mk(1934, 11, 9, 12, 30, -5), lat: 40.6782, lon: -73.9442, timeKnown: true, note: "Brooklyn, New York" },
  { key: "rachel-carson", handle: "Rachel Carson", date: mk(1907, 5, 27, 8, 0, -5), lat: 40.2732, lon: -79.8419, timeKnown: true, note: "Springdale, Pennsylvania" },
  { key: "paulo-freire", handle: "Paulo Freire", date: mk(1921, 9, 19, 15, 45, -2), lat: -8.0476, lon: -34.877, timeKnown: true, note: "Recife, Brazil" },
  { key: "chiron", handle: "Chiron", date: mk(1977, 11, 1, 10, 0, -8), lat: 34.1478, lon: -118.1445, timeKnown: true, note: "Pasadena, California, USA" },
];
