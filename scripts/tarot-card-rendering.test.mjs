import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const ROOT = process.cwd();

console.log("▶ 1 · Testing Tarot Card Normalization Contract...");

const contractCode = fs.readFileSync(`${ROOT}/public/card-contract.js`, "utf8");
const contractContext = vm.createContext({
  globalThis: {},
  console,
  Math,
  String,
  Number,
  Boolean,
  Array,
  Object
});
vm.runInContext(contractCode, contractContext);
const contract = contractContext.PentaclesCardContract || contractContext.globalThis.PentaclesCardContract;
const { normalizeTarotCard, SUIT_ART } = contract;

assert.ok(typeof normalizeTarotCard === "function", "normalizeTarotCard must be exported");

// Test normal minor card (face up by default)
const normalMinor = normalizeTarotCard({
  card_id: 101,
  suit: "cups",
  rank: 5,
  attack: 12,
  health: 24,
  armour: 4,
  source_body: 1
}, "active");

assert.equal(normalMinor.cardId, 101);
assert.equal(normalMinor.suitKey, "cups");
assert.equal(normalMinor.suitName, "Cups");
assert.equal(normalMinor.isFaceDown, false, "Cards must be face-up by default");
assert.equal(normalMinor.loadout, "active");
assert.equal(normalMinor.suitArtSrc, "/assets/suits/cups.jpg");
assert.equal(normalMinor.attack, 12);
assert.equal(normalMinor.health, 24);
assert.equal(normalMinor.armour, 4);

// Test explicit faceDown: true
const faceDownCard = normalizeTarotCard({
  card_id: 102,
  suit: "swords",
  rank: 7,
  faceDown: true
});
assert.equal(faceDownCard.isFaceDown, true, "Card must be face-down when explicit faceDown: true");

// Test explicit options.faceDown
const faceDownByOption = normalizeTarotCard({
  card_id: 103,
  suit: "wands",
  rank: 8
}, "bench", { faceDown: true });
assert.equal(faceDownByOption.isFaceDown, true, "Options.faceDown must be respected");

// Missing art or metadata must NEVER infer face-down
const missingArtCard = normalizeTarotCard({
  card_id: 104,
  suit: "custom_missing"
});
assert.equal(missingArtCard.isFaceDown, false, "Missing art must NEVER infer face-down state");

// Test Major Arcana normalization
const majorCard = normalizeTarotCard({
  card_id: 201,
  is_major: true,
  rank: 0,
  source_body: 7
});
assert.equal(majorCard.isMajor, true);
assert.equal(majorCard.title, "The Fool");
assert.equal(majorCard.suitKey, "major");
assert.equal(majorCard.isFaceDown, false);

// Test sparse / camelCase payload normalization
const sparseCard = normalizeTarotCard({
  cardId: 301,
  atk: 15,
  hp: 35,
  arm: 5,
  cd: 800,
  currentLoadout: "defense",
  retrograde: true
});
assert.equal(sparseCard.cardId, 301);
assert.equal(sparseCard.attack, 15);
assert.equal(sparseCard.health, 35);
assert.equal(sparseCard.armour, 5);
assert.equal(sparseCard.cooldownMs, 800);
assert.equal(sparseCard.loadout, "defense");
assert.equal(sparseCard.isInverted, true);
assert.equal(sparseCard.isFaceDown, false);

console.log("  ✓ Card normalization contract passed 100%");

console.log("▶ 2 · Testing buildCardHTML in app.js...");

const appCode = fs.readFileSync(`${ROOT}/public/app.js`, "utf8");

// Setup minimal mock browser environment for app.js
const mockDom = {
  selectedCards: new Set(),
  deck: [],
  collection: []
};

const appVmContext = vm.createContext({
  window: {
    state: mockDom,
    PentaclesCardContract: contract,
    normalizeTarotCard: contract.normalizeTarotCard,
    addEventListener: () => {},
    removeEventListener: () => {}
  },
  document: {
    getElementById: (id) => ({
      getContext: () => ({
        clearRect: () => {},
        beginPath: () => {},
        arc: () => {},
        fill: () => {},
        stroke: () => {},
        fillText: () => {},
        measureText: () => ({ width: 10 })
      }),
      width: 800,
      height: 600,
      style: {},
      addEventListener: () => {},
      classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false }
    }),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener: () => {}
  },
  state: mockDom,
  console,
  Math,
  String,
  Number,
  Boolean,
  Array,
  Object,
  Set,
  Map,
  requestAnimationFrame: (cb) => setTimeout(cb, 16),
  cancelAnimationFrame: () => {},
  setTimeout: () => {},
  clearTimeout: () => {},
  setInterval: () => {},
  clearInterval: () => {},
  PentaclesCardContract: contract
});

const skyCode = fs.readFileSync(`${ROOT}/public/sky.js`, "utf8");
const clientCode = fs.readFileSync(`${ROOT}/public/client.js`, "utf8");

// Wrap app.js to extract buildCardHTML
const extractScript = `
${contractCode}
${skyCode}
${clientCode}
${appCode}
globalThis.testBuildCardHTML = buildCardHTML;
`;

vm.runInContext(extractScript, appVmContext);
const buildCardHTML = appVmContext.testBuildCardHTML;
assert.ok(typeof buildCardHTML === "function", "buildCardHTML must be defined in app.js");

// Case 1: Normal active card (face-up)
const activeHtml = buildCardHTML({
  card_id: 501,
  suit: "cups",
  rank: 6,
  attack: 21,
  health: 31,
  armour: 12,
  title: "Six of Cups"
}, "active", false);

assert.ok(!activeHtml.includes("web-card-back"), "Face-up card must NOT render .web-card-back");
assert.ok(!activeHtml.includes("face-down"), "Face-up card must NOT have .face-down class");
assert.ok(activeHtml.includes("Six of Cups"), "Front title must be present");
assert.ok(activeHtml.includes("web-card-chip"), "Active chip must be present on card front");
assert.ok(activeHtml.includes("Active"), "Chip text must say Active");
assert.ok(activeHtml.includes("21"), "Attack stat must be visible");
assert.ok(activeHtml.includes("31"), "Health stat must be visible");
assert.ok(activeHtml.includes("12"), "Armour stat must be visible");
assert.ok(activeHtml.includes("web-card-art"), "Art stage must be present");
assert.ok(activeHtml.includes("/assets/suits/cups.jpg"), "Local suit art image must be referenced");

// Case 2: Explicit faceDown: true
const faceDownHtml = buildCardHTML({
  card_id: 502,
  suit: "swords",
  rank: 10,
  faceDown: true
}, "bench", false);

assert.ok(faceDownHtml.includes("web-card-back"), "Explicit faceDown: true card MUST render .web-card-back");
assert.ok(faceDownHtml.includes("face-down"), "Explicit faceDown: true card MUST have .face-down class");

// Case 3: Local suit asset verification on disk
for (const suit of ["wands", "cups", "swords", "pentacles"]) {
  const assetPath = `${ROOT}/public/assets/suits/${suit}.jpg`;
  assert.ok(fs.existsSync(assetPath), `Suit asset must exist on disk: ${assetPath}`);
  const stats = fs.statSync(assetPath);
  assert.ok(stats.size > 10000, `Suit asset ${suit}.jpg must not be empty (size: ${stats.size})`);
}

// Case 4: Minor card with missing / failed asset fallback
const fallbackHtml = buildCardHTML({
  card_id: 503,
  suit: "wands",
  rank: 4,
  attack: 10
}, "active", false);
assert.ok(fallbackHtml.includes("onerror"), "Image must have an onerror fallback handler");
assert.ok(fallbackHtml.includes("web-card-art-fallback"), "High quality fallback container must be present");
assert.ok(fallbackHtml.includes("🜂"), "Fallback must include elemental fire glyph");

// Case 5: Major Arcana card
const majorHtml = buildCardHTML({
  card_id: 601,
  is_major: true,
  rank: 1,
  source_body: 2,
  title: "The Magician"
}, "active", false);

assert.ok(majorHtml.includes("major"), "Major card must have major class");
assert.ok(majorHtml.includes("major-art"), "Major card must render major-art stage");
assert.ok(majorHtml.includes("web-card-major-sigil"), "Major card must render astral sigil");
assert.ok(majorHtml.includes("sigil-ring"), "Major card must render celestial sigil rings");
assert.ok(majorHtml.includes("The Magician"), "Major card title must be present");
assert.ok(!majorHtml.includes("web-card-back"), "Major card must be face-up");

// Case 6: Inverted card
const invertedHtml = buildCardHTML({
  card_id: 701,
  suit: "pentacles",
  rank: 8,
  inverted: true,
  title: "Eight of Pentacles"
}, "defense", false);

assert.ok(invertedHtml.includes("inverted"), "Inverted card must have inverted class");
assert.ok(invertedHtml.includes("Eight of Pentacles"), "Inverted card must keep title readable");
assert.ok(invertedHtml.includes("(rev)"), "Inverted card subtitle should indicate reversal");
assert.ok(invertedHtml.includes("Defense"), "Defense chip must be present");

// Case 7: Sparse / legacy payload
const sparseHtml = buildCardHTML({
  id: 801
}, "bench", false);
assert.ok(!sparseHtml.includes("NaN"), "Sparse card must not render NaN");
assert.ok(sparseHtml.includes("web-card"), "Sparse card must render valid card container");

console.log("  ✓ buildCardHTML tests passed 100%");

console.log("▶ 3 · Testing CSS rules in client.css...");

const cssCode = fs.readFileSync(`${ROOT}/public/client.css`, "utf8");

// Assert true 2:3 aspect ratio
assert.match(cssCode, /aspect-ratio:\s*var\(--card-aspect,\s*2\s*\/\s*3\)/, ".web-card must use aspect-ratio: 2 / 3");

// Assert .web-card-back is hidden by default and displayed ONLY when face-down
assert.match(cssCode, /\.web-card-back\s*\{[^}]*display:\s*none/, ".web-card-back must be display: none by default");
assert.match(cssCode, /\.web-card\.face-down\s+\.web-card-back\s*\{[^}]*display:\s*block/, ".web-card.face-down must display .web-card-back");
assert.match(cssCode, /\.web-card\.face-down\s*>\s*\*:\s*not\(\.web-card-back\)\s*\{[^}]*visibility:\s*hidden/, ".web-card.face-down must hide all front elements");

// Assert 2-column grid and grid-auto-rows for tarot hand
assert.match(cssCode, /\.tarot-hand-grid\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, "Desktop hand grid must use 2-column portrait grid");
assert.match(cssCode, /\.tarot-hand-grid\s*\{[^}]*grid-auto-rows:\s*minmax\(195px,\s*auto\)/, "Desktop hand grid must enforce min-height rows to prevent card overlap");

// Assert mobile responsive 2-column rule
assert.match(cssCode, /@media\s*\(max-width:\s*600px\)[\s\S]*?\.tarot-hand-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, "Mobile media query must support 2 compact columns");

// Assert prefers-reduced-motion
assert.match(cssCode, /@media\s*\(prefers-reduced-motion:\s*reduce\)/, "client.css must support prefers-reduced-motion");

console.log("  ✓ CSS geometry and visibility rules validated 100%");

console.log("\nALL Tarot Card Rendering tests passed with 100% success!");
process.exit(0);
