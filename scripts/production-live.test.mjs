import assert from "node:assert/strict";

const TARGET_URL = (process.env.TARGET_URL || "https://pentacles.alchm.kitchen").replace(/\/$/, "");

console.log(`\n=== Production Live Verification Suite ===`);
console.log(`Target: ${TARGET_URL}\n`);

async function testPageLoad() {
  console.log("▶ 1 · Testing primary application shell...");
  const res = await fetch(`${TARGET_URL}/`);
  assert.equal(res.status, 200, `Expected 200 from ${TARGET_URL}/, got ${res.status}`);
  const html = await res.text();
  assert.ok(html.includes("<!DOCTYPE html>"), "Index did not return valid HTML doctype");
  assert.ok(html.includes("pentacles") || html.includes("Pentacles"), "Index missing app branding");
  console.log("  ✓ Main application shell loaded (200 OK)");
}

async function testMandatorySecurityHeaders() {
  console.log("▶ 2 · Testing mandatory security headers & CSP...");
  const res = await fetch(`${TARGET_URL}/`);
  const headers = res.headers;

  const nosniff = headers.get("x-content-type-options");
  assert.ok(nosniff, "CRITICAL: x-content-type-options header is missing!");
  assert.equal(nosniff, "nosniff", `Expected 'nosniff', got '${nosniff}'`);
  console.log("  ✓ X-Content-Type-Options: nosniff verified");

  const frameOptions = headers.get("x-frame-options");
  assert.ok(frameOptions, "CRITICAL: x-frame-options header is missing!");
  assert.equal(frameOptions, "DENY", `Expected 'DENY', got '${frameOptions}'`);
  console.log("  ✓ X-Frame-Options: DENY verified");

  const referrerPolicy = headers.get("referrer-policy");
  assert.ok(referrerPolicy, "CRITICAL: referrer-policy header is missing!");
  assert.equal(referrerPolicy, "strict-origin-when-cross-origin", `Expected 'strict-origin-when-cross-origin', got '${referrerPolicy}'`);
  console.log("  ✓ Referrer-Policy: strict-origin-when-cross-origin verified");

  const csp = headers.get("content-security-policy");
  assert.ok(csp, "CRITICAL: Content-Security-Policy header is missing!");
  assert.ok(csp.includes("default-src"), "CSP header missing default-src directive");
  console.log("  ✓ Content-Security-Policy header verified");
}

async function testAssets() {
  console.log("▶ 3 · Testing static artwork & suit assets...");
  const suits = ["pentacles", "wands", "cups", "swords"];
  for (const suit of suits) {
    const assetUrl = `${TARGET_URL}/assets/suits/${suit}.jpg`;
    const res = await fetch(assetUrl);
    assert.equal(res.status, 200, `Asset ${assetUrl} returned status ${res.status}`);
    const type = res.headers.get("content-type") || "";
    assert.ok(type.includes("image/jpeg") || type.includes("image/"), `Expected image content-type, got ${type}`);
  }
  console.log("  ✓ All local suit artwork assets accessible (200 OK)");
}

async function testGddDoc() {
  console.log("▶ 4 · Testing GDD documentation route...");
  const res = await fetch(`${TARGET_URL}/Pentacles_GDD.html`);
  assert.equal(res.status, 200, `GDD route returned ${res.status}`);
  const html = await res.text();
  assert.ok(html.includes("Game Design Document") || html.includes("GDD") || html.includes("PENTACLES"), "GDD content invalid");
  console.log("  ✓ Pentacles GDD reachable (200 OK)");
}

async function run() {
  try {
    await testPageLoad();
    await testMandatorySecurityHeaders();
    await testAssets();
    await testGddDoc();
    console.log("\n✅ All production live verification checks passed with 100% success and ZERO 5xx errors!\n");
  } catch (err) {
    console.error("\n❌ Production verification failed:", err.message);
    process.exit(1);
  }
}

run();
