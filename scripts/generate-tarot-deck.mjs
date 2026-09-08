#!/usr/bin/env bun
/**
 * Automated Tarot Deck Art Generator Pipeline
 *
 * Reads prompts from scripts/tarot-art-prompt-catalog.mjs and generates
 * missing cards via Google Gemini API (GEMINI_API_KEY) or OpenRouter API.
 * Automatically skips existing cards on disk.
 *
 * Usage:
 *   bun scripts/generate-tarot-deck.mjs [--suit=major|wands|cups|swords|pentacles] [--limit=N]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CARD_PROMPT_CATALOG, getRemainingCards } from "./tarot-art-prompt-catalog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CARDS_DIR = path.join(ROOT, "public", "assets", "cards");

// Parse CLI flags
const args = process.argv.slice(2);
const suitFilter = args.find(a => a.startsWith("--suit="))?.split("=")[1];
const limitArg = args.find(a => a.startsWith("--limit="))?.split("=")[1];
const limit = limitArg ? parseInt(limitArg, 10) : Infinity;

console.log("\n====================================================================");
console.log("✦ PENTACLES TAROT ART GENERATION PIPELINE ✦");
console.log("====================================================================\n");

// Ensure directories exist
fs.mkdirSync(path.join(CARDS_DIR, "major"), { recursive: true });
for (const s of ["wands", "cups", "swords", "pentacles"]) {
  fs.mkdirSync(path.join(CARDS_DIR, "minor", s), { recursive: true });
}

// Find cards that still need generation
const queue = CARD_PROMPT_CATALOG.filter(c => {
  if (suitFilter && c.suit !== suitFilter) return false;
  const targetFile = c.suit === "major"
    ? path.join(CARDS_DIR, "major", c.filename)
    : path.join(CARDS_DIR, "minor", c.suit, c.filename);
  return !fs.existsSync(targetFile);
}).slice(0, limit);

console.log(`Found ${queue.length} cards queued for generation.`);

if (queue.length === 0) {
  console.log("✅ All matching cards are already present on disk!\n");
  process.exit(0);
}

console.log("\nQueue Preview:");
for (const card of queue.slice(0, 10)) {
  console.log(`  • [${card.suit.toUpperCase()} ${card.rank}] ${card.name} -> ${card.relativePath}`);
}
if (queue.length > 10) {
  console.log(`  ... and ${queue.length - 10} more cards.`);
}

console.log("\nAPI Configuration:");
const hasGemini = !!process.env.GEMINI_API_KEY;
const hasOpenRouter = !!process.env.OPENROUTER_API_KEY;

if (!hasGemini && !hasOpenRouter) {
  console.log("ℹ No GEMINI_API_KEY or OPENROUTER_API_KEY detected in environment.");
  console.log("  To execute generation, run with an API key:");
  console.log("  GEMINI_API_KEY=your_key bun scripts/generate-tarot-deck.mjs\n");
  process.exit(0);
}

// Generation runner logic
async function generateCard(card) {
  console.log(`\n🎨 Generating [${card.suit} ${card.rank}] ${card.name}...`);
  const targetPath = card.suit === "major"
    ? path.join(CARDS_DIR, "major", card.filename)
    : path.join(CARDS_DIR, "minor", card.suit, card.filename);

  if (hasGemini) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${process.env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: card.prompt }],
        parameters: { sampleCount: 1, aspectRatio: "2:3", outputMimeType: "image/jpeg" }
      })
    });
    const data = await res.json();
    if (data.predictions && data.predictions[0]?.bytesBase64Encoded) {
      fs.writeFileSync(targetPath, Buffer.from(data.predictions[0].bytesBase64Encoded, "base64"));
      console.log(`  ✓ Saved to ${targetPath}`);
      return true;
    }
    console.error("  ✗ Gemini error:", data.error?.message || data);
    return false;
  }

  return false;
}

// Execute batch
for (const card of queue) {
  const ok = await generateCard(card);
  if (!ok) {
    console.log("Stopping pipeline due to error / quota.");
    break;
  }
  // Brief delay between calls
  await new Promise(r => setTimeout(r, 2500));
}
