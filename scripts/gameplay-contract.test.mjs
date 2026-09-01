import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const syntax = spawnSync(process.execPath, ["--check", new URL("../public/app.js", import.meta.url).pathname], { encoding: "utf8" });
assert.equal(syntax.status, 0, `app.js must parse so onboarding handlers can register:\n${syntax.stderr}`);

const ritualOverlay = html.match(/<div id="ritual-hud-overlay"[^>]*>/)?.[0] || "";
assert.match(ritualOverlay, /ondragover="allowRitualDrop\(event\)"/, "the visible ritual must accept dragged cards");
assert.match(ritualOverlay, /ondrop="handleRitualDrop\(event\)"/, "the visible ritual must play a dropped card");

for (const handler of [
  "allowRitualDrop",
  "handleRitualDrop",
  "handleCardDragStart",
  "handleCardDragEnd",
]) {
  assert.match(app, new RegExp(`window\\.${handler}\\s*=`), `${handler} must be available to markup`);
}

assert.match(app, /window\.activeRitualTarget/, "ritual drops must resolve the selected zone or planet");
assert.match(app, /dataTransfer\.getData\("text\/plain"\)[\s\S]{0,160}(draggingCardId|draggedCardId)/, "drops need a drag-state fallback");
assert.match(
  app,
  /function renderActiveHand\(\)[\s\S]*?\(state\.deck \|\| \[\]\)[\s\S]*?\.filter\(d => d\.loadout === "active"\)[\s\S]*?state\.collection\.find\(c => c\.card_id === d\.card_id\)/,
  "Tarot Hand must render only cards accepted by the ritual engine's Active Hand rule",
);

console.log("PASS gameplay drag/drop contracts");
