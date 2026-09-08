// ============================================================
// Pentacles: My Pentacles & Star-Dex Unit Test Suite
// ============================================================
import assert from "node:assert";

if (typeof globalThis.document === "undefined") {
  globalThis.document = {
    createElement: (tag) => {
      const el = {
        tagName: tag.toUpperCase(),
        classList: {
          _c: new Set(),
          add(...c) { c.forEach(x => this._c.add(x)); this._sync(); },
          remove(...c) { c.forEach(x => this._c.delete(x)); this._sync(); },
          contains(c) { return this._c.has(c); },
          _sync() { el.className = Array.from(this._c).join(" "); }
        },
        style: {},
        dataset: {},
        setAttribute(k, v) {
          if (k === "class") {
            this.className = String(v);
            this.classList._c = new Set(String(v).split(/\s+/).filter(Boolean));
          }
        },
        getAttribute(k) {
          if (k === "class") return this.className;
          return null;
        },
        addEventListener: () => {},
        removeEventListener: () => {},
        appendChild(child) {
          this.children.push(child);
          this.childNodes.push(child);
          return child;
        },
        replaceChildren(...nodes) {
          this.children = [...nodes];
          this.childNodes = [...nodes];
        },
        children: [],
        childNodes: [],
        className: "",
        textContent: ""
      };
      return el;
    },
    createTextNode: (txt) => ({ textContent: String(txt) })
  };
}

import MyPentacles, { MyPentaclesInstance, MyCodex, create } from "../src/alchm-chart/my-pentacles.js";

console.log("▶ Testing Section 1: My Pentacles Instance & Factory");
assert.strictEqual(typeof create, "function", "create should be a function");
assert.strictEqual(typeof MyPentacles.create, "function", "MyPentacles.create should be a function");
assert.strictEqual(MyPentacles, MyCodex, "MyCodex should be identical alias to MyPentacles");

const fakeEl = {
  classList: {
    add: () => {},
    remove: () => {},
  },
  appendChild: () => {},
  replaceChildren: () => {},
};

const fakeChart = {
  time_known: true,
  ascendant: 7 * 1800 + 14 * 60, // Scorpio 14°
  midheaven: 4 * 1800 + 2 * 60,  // Leo 2°
  placements: [
    { body: "Sun", sign: 4, arc_minutes: 22 * 60, retrograde: false, dignity: 0 },
    { body: "Moon", sign: 3, arc_minutes: 3 * 60, retrograde: false, dignity: 5 },
    { body: "Mercury", sign: 5, arc_minutes: 5 * 60, retrograde: false, dignity: 5 },
    { body: "Venus", sign: 6, arc_minutes: 22 * 60, retrograde: false, dignity: 5 },
    { body: "Mars", sign: 7, arc_minutes: 19 * 60, retrograde: true, dignity: 5 },
    { body: "Jupiter", sign: 9, arc_minutes: 29 * 60, retrograde: false, dignity: 5 },
    { body: "Saturn", sign: 11, arc_minutes: 18 * 60, retrograde: true, dignity: 0 },
    { body: "Uranus", sign: 10, arc_minutes: 14 * 60, retrograde: true, dignity: 0 },
    { body: "Neptune", sign: 11, arc_minutes: 8 * 60, retrograde: false, dignity: 4 },
    { body: "Pluto", sign: 7, arc_minutes: 26 * 60, retrograde: false, dignity: 5 },
  ],
};

const fakeState = {
  player: {
    handle: "Castro",
    faction: 9, // Pluto
    tokens: 3000,
    word_wins: 10,
    chart: fakeChart,
  },
  collection: [
    { card_id: 1, suit: "cups", rank: 1, source_body: 1, attack: 10, health: 20, armour: 5, level: 1, letter: "A", title: "Ace of Cups" },
    { card_id: 2, suit: "wands", rank: 2, source_body: 0, attack: 12, health: 18, armour: 4, level: 1, letter: "B", title: "Two of Wands" },
    { card_id: 3, suit: "pentacles", rank: 3, source_body: 9, attack: 15, health: 25, armour: 8, level: 2, letter: "C", title: "Three of Pentacles" },
  ],
  deck: [
    { card_id: 1, loadout: "active" },
    { card_id: 2, loadout: "defense" },
    { card_id: 3, loadout: "bench" },
  ],
  save() { this.saved = true; },
};

const inst = MyPentacles.create({
  el: fakeEl,
  state: fakeState,
});

assert.ok(inst instanceof MyPentaclesInstance, "inst should be instance of MyPentaclesInstance");
assert.strictEqual(inst.deckFilter, "all", "default filter should be 'all'");
console.log("  ✓ My Pentacles instantiation and aliases verified");

console.log("▶ Testing Section 2: Deck Loadout Mutation");
inst._setCardLoadout(3, "active");
const updatedSlot = fakeState.deck.find(d => d.card_id === 3);
assert.strictEqual(updatedSlot.loadout, "active", "Slot 3 should now have active loadout");
assert.strictEqual(fakeState.saved, true, "state.save() should have been called on loadout mutation");
console.log("  ✓ Loadout assignment and persistence verified");

console.log("▶ Testing Section 3: Active Limit Guard (Max 8 cards)");
// Fill with 8 active cards
fakeState.deck = Array.from({ length: 8 }, (_, i) => ({ card_id: 100 + i, loadout: "active" }));
fakeState.deck.push({ card_id: 999, loadout: "bench" });
inst._setCardLoadout(999, "active");
const rejectedSlot = fakeState.deck.find(d => d.card_id === 999);
assert.strictEqual(rejectedSlot.loadout, "bench", "Slot 999 should remain bench due to 8 card active cap");
console.log("  ✓ Max 8 active card limit guard verified");

console.log("▶ Testing Section 4: 3D Flippable Card Inspector (Front Art / Back Stats)");
assert.strictEqual(inst.inspectorFlipped, false, "inspectorFlipped should default to false (front art side)");

const modalEl = inst._cardInspectorModal(fakeState.collection[0], fakeState.deck, fakeState.collection);
assert.strictEqual(modalEl.className, "mc-inspector-overlay", "Should return inspector overlay");
assert.strictEqual(modalEl.children.length, 1, "Overlay should contain flipper container");

const flipperContainer = modalEl.children[0];
assert.strictEqual(flipperContainer.className, "mc-inspector-flipper-container", "Should contain flipper container");

const flipper = flipperContainer.children[0];
assert.ok(flipper.className.includes("mc-inspector-flipper"), "Should contain mc-inspector-flipper element");
assert.ok(!flipper.className.includes("is-flipped"), "Default state should not have is-flipped class");

// Test front and back sides
assert.strictEqual(flipper.children.length, 2, "Flipper should contain exactly 2 sides (front and back)");
const frontSide = flipper.children[0];
const backSide = flipper.children[1];
assert.ok(frontSide.className.includes("mc-inspector-side--front"), "First child must be front side");
assert.ok(backSide.className.includes("mc-inspector-side--back"), "Second child must be back side");

// Flip state
inst.inspectorFlipped = true;
const flippedModalEl = inst._cardInspectorModal(fakeState.collection[0], fakeState.deck, fakeState.collection);
const flippedFlipper = flippedModalEl.children[0].children[0];
assert.ok(flippedFlipper.className.includes("is-flipped"), "Flipped flipper must have is-flipped class");
console.log("  ✓ 3D Card flipper front art and back stats verified");

console.log("ALL My Pentacles tests passed with 100% success!");
