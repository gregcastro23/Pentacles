// Cross-engine parity: server/src/melee.rs must agree with public/arcanaTrickEngine.js.
//
// The browser predicts what the module will do — it greys out illegal cards, it
// shows an Arcana ladder, it animates a trick winner — and the module is what
// actually moves zone control. The moment those two disagree the client lies to
// the player. This test is the thing that stops that: it generates a spread of
// cases, asks BOTH engines, and diffs.
//
// It drives the `#[ignore]`d Rust harness in server/src/melee.rs::parity, so a
// failure here means one of the two implementations changed alone.
//
// Run: bun scripts/melee-parity.test.mjs   (node works too)

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
await import(join(ROOT, "public/arcanaTrickEngine.js"));
const Engine = globalThis.ArcanaTrickEngine;
assert.ok(Engine, "arcanaTrickEngine.js did not attach to globalThis");

const SUIT_OF = { w: "wands", c: "cups", s: "swords", p: "pentacles" };

/** `M13`, `w5`, `c1!` → the engine's card shape. */
function card(tok, id) {
  const inverted = tok.endsWith("!");
  const t = inverted ? tok.slice(0, -1) : tok;
  if (t[0] === "M") {
    return { card_id: id, suit: "wands", rank: Number(t.slice(1)), is_major: true, inverted };
  }
  return { card_id: id, suit: SUIT_OF[t[0]], rank: Number(t.slice(1)), is_major: false, inverted };
}
const cards = (field) =>
  field.trim().split(/\s+/).filter(Boolean).map((t, i) => card(t, i + 1));

// A ladder of flat 50s: parity is about the RULES, and a shared neutral ladder
// keeps a rounding difference in one rung from masking a legality difference.
const NEUTRAL = Object.fromEntries(Array.from({ length: 22 }, (_, i) => [i, 50]));

// ── Cases ───────────────────────────────────────────────────────────────────
// Each entry is [wire line for Rust, () => the JS engine's answer as a string].

const cases = [];
const add = (line, answer) => cases.push([line, answer]);

// 1. The Arcana ladder over real sky configurations.
const SKIES = [
  [],                                                     // no sky at all
  [[0, 4, 0]],                                            // Sun in its domicile
  [[0, 10, 1]],                                           // Sun retrograde in its fall
  [[4, 0, 0], [3, 1, 0], [2, 2, 0]],                      // three dignified bodies
  Array.from({ length: 10 }, (_, b) => [b, 0, 0]),        // an Aries stellium
  Array.from({ length: 10 }, (_, b) => [b, (b * 7) % 12, b % 2]),
];
for (const sky of SKIES) {
  const wire = sky.map(([b, s, r]) => `${b}:${s}:${r}`).join(" ");
  add(`LADDER ${wire}`, () => {
    const planets = sky.map(([body, sign, retro]) => ({
      body, sign, retrograde: !!retro, up: true,
    }));
    const l = Engine.buildArcanaLadder(planets, null);
    return Array.from({ length: 22 }, (_, i) => l[i]).join(",");
  });
}

// 2. Power and counters across every rank, both suits and inversion.
for (const suit of ["w", "c", "s", "p"]) {
  for (let rank = 1; rank <= 14; rank++) {
    const tok = `${suit}${rank}`;
    add(`POWER w ${tok}`, () => String(Engine.power(card(tok, 1), "wands", NEUTRAL)));
    add(`COUNTER ${tok}`, () => String(Engine.counterValue(card(tok, 1))));
    add(`COUNTER ${tok}!`, () => String(Engine.counterValue(card(`${tok}!`, 1))));
  }
}
for (let rank = 0; rank <= 21; rank++) {
  add(`POWER w M${rank}`, () => String(Engine.power(card(`M${rank}`, 1), "wands", NEUTRAL)));
  add(`COUNTER M${rank}`, () => String(Engine.counterValue(card(`M${rank}`, 1))));
  add(`COUNTER M${rank}!`, () => String(Engine.counterValue(card(`M${rank}!`, 1))));
}

// 3. Legality — the rule set with the most branches, so the most cases.
const HANDS = [
  "c5 c9 s3 w2 M13",       // holds the led suit
  "s3 s9 w2 w14 M13",      // void in cups, holds trump
  "s3 s9 c2",              // void in cups and trump — free slough
  "M0 s9 w2",              // holds the Excuse
  "M2 M13 M21 c4",         // Major-heavy
  "c1 c10 c14 c13 c12 c11", // a full court in the led suit
  "w1 w10 w14 s2",         // trump-heavy
];
const TRICKS = [
  "",           // the lead
  "c3",         // a low minor led
  "c14",        // a King led
  "c3 c14",     // led and over-taken in suit
  "c3 w2",      // led and trumped
  "M20",        // an Arcana lead
  "M20 M21",    // an Arcana lead, over-trumped
  "c3 M13",     // a minor lead answered by a Major
];
for (const trump of ["w", "c"]) {
  for (const h of HANDS) {
    for (const t of TRICKS) {
      add(`LEGAL ${trump} | ${h} | ${t}`, () => {
        const hand = cards(h);
        const trick = cards(t).map((c, i) => ({ player: i, card: c }));
        const led = trick.length && !trick[0].card.is_major ? trick[0].card.suit : null;
        return Engine.getLegalMoves(hand, led, SUIT_OF[trump], trick, NEUTRAL)
          .map((m) => (m.legal ? "1" : "0"))
          .join("");
      });
    }
  }
}

// 4. Trick resolution, including the Excuse and the trick-12 climax.
const COMPLETED = [
  "c3 c14 c5",
  "c3 w2 c14",
  "c1 w2 M0",
  "M20 M21 c5",
  "w1 w10 w14",
  "c1 c10 c14 M0",
  "M0 c3",
];
for (const trump of ["w", "c"]) {
  for (const no of [1, 11, 12]) {
    for (const t of COMPLETED) {
      add(`TRICK ${trump} ${no} | ${t}`, () => {
        const trick = cards(t).map((c, i) => ({ player: i, card: c }));
        const o = Engine.evaluateTrick(trick, SUIT_OF[trump], NEUTRAL, no);
        // The JS engine folds the Excuse's own counters nowhere; Rust reports
        // them separately so a caller cannot drop them. Derive the JS figure the
        // same way — from the Excuse card itself — and compare like for like.
        const excuseCard = trick.find((p) => p.card.is_major && Number(p.card.rank) === 0);
        const excuseCounters = excuseCard ? Engine.counterValue(excuseCard.card) : 0;
        return `${o.winner},${o.counters},${excuseCounters}`;
      });
    }
  }
}

// 5. Melds — every one of the eight, plus the trump-doubling of a marriage.
const MELD_HANDS = [
  "c14 c13",                       // marriage
  "w14 w13",                       // marriage in trump
  "s13 p12",                       // pinochle
  "c11 c12 c13 c14",               // full court
  "w2 w3 w4",                      // decan trine of Aries
  "p5 p6 p7",                      // decan trine of Taurus
  "w1 c1 s1 p1",                   // grand cross
  "M2 M13 M21",                    // arcana trine
  "M0 M1 M21",                     // the great work
  "w14 w13 w11 w12 w1 c1 s1 p1 M0 M1 M21",  // several at once
];
for (const trump of ["w", "c"]) {
  for (const h of MELD_HANDS) {
    add(`MELDS ${trump} | ${h}`, () =>
      String(
        Engine.detectMelds(cards(h), SUIT_OF[trump], NEUTRAL).reduce((n, m) => n + m.value, 0),
      ),
    );
  }
}

// ── Ask Rust ────────────────────────────────────────────────────────────────

if (process.env.PENTACLES_SKIP_PARITY === "1" || process.env.SKIP_RUST === "1") {
  console.log("  ✦ PENTACLES_SKIP_PARITY=1 set — skipping Rust engine parity comparison");
  process.exit(0);
}

const dir = mkdtempSync(join(tmpdir(), "melee-parity-"));
const inFile = join(dir, "cases.txt");
const outFile = join(dir, "answers.txt");
writeFileSync(inFile, cases.map(([line]) => line).join("\n"), "utf8");

console.log(`▶ ${cases.length} cases → server/src/melee.rs`);
try {
  execFileSync(
    "cargo",
    ["test", "--manifest-path", "server/Cargo.toml", "--lib", "parity::", "--", "--ignored"],
    {
      cwd: ROOT,
      env: { ...process.env, MELEE_PARITY_INPUT: inFile, MELEE_PARITY_OUTPUT: outFile },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
} catch (err) {
  if (err.code === "ENOENT") {
    if (process.env.CI && process.env.PENTACLES_SKIP_PARITY !== "1") {
      console.error("  ✗ cargo not found in CI environment — cannot verify Rust engine parity");
      process.exit(1);
    }
    console.warn("  ⚠ cargo not found in local environment — set PENTACLES_SKIP_PARITY=1 or install Rust for parity comparison");
    process.exit(0);
  }
  console.error(err.stdout || "");
  console.error(err.stderr || "");
  throw new Error("the Rust parity harness did not run — see output above");
}

const rustAnswers = readFileSync(outFile, "utf8").split("\n").filter((l) => l.length > 0);

assert.equal(
  rustAnswers.length,
  cases.length,
  `Rust answered ${rustAnswers.length} of ${cases.length} cases`,
);

// ── Diff ────────────────────────────────────────────────────────────────────

const mismatches = [];
cases.forEach(([line, answer], i) => {
  const js = String(answer());
  if (js !== rustAnswers[i]) mismatches.push({ line, js, rust: rustAnswers[i] });
});

if (mismatches.length) {
  console.error(`\n✗ ${mismatches.length} of ${cases.length} cases disagree:\n`);
  for (const m of mismatches.slice(0, 25)) {
    console.error(`  ${m.line}`);
    console.error(`    js   ${m.js}`);
    console.error(`    rust ${m.rust}\n`);
  }
  if (mismatches.length > 25) console.error(`  …and ${mismatches.length - 25} more.\n`);
  process.exit(1);
}

const kinds = cases.reduce((acc, [l]) => {
  const k = l.split(" ")[0];
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});
for (const [k, n] of Object.entries(kinds)) console.log(`  ✓ ${k.padEnd(8)} ${n} cases agree`);
console.log(`\nALL ${cases.length} cases agree — the Rust referee and the JS engine are in parity.`);
