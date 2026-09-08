#!/usr/bin/env node
// Environment and Toolchain Diagnostics for Pentacles.
// Reports developer environment readiness and hints for missing toolchains.
// Never fails CI — always exits 0.

import { execSync } from "node:child_process";

function probe(cmd) {
  try {
    const out = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" });
    return out.trim();
  } catch {
    return null;
  }
}

console.log("==================================================");
console.log("✦ Pentacles Developer Environment Readiness Check ✦");
console.log("==================================================");

const tools = [
  {
    name: "Node.js",
    cmd: "node -v",
    required: true,
    hint: "Install via https://nodejs.org or nvm/fnm",
  },
  {
    name: "Bun",
    cmd: "bun -v",
    required: true,
    hint: "curl -fsSL https://bun.sh/install | bash",
  },
  {
    name: "Rust / Cargo",
    cmd: "cargo --version",
    required: false,
    purpose: "Needed for server/ module compilation & melee engine parity tests",
    hint: "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh",
  },
  {
    name: "SpacetimeDB CLI",
    cmd: "spacetime --version",
    required: false,
    purpose: "Needed for `bun run gen` client bindings generation & migrations",
    hint: "curl -sSf https://install.spacetimedb.com | sh",
  },
  {
    name: "Solana CLI",
    cmd: "solana --version",
    required: false,
    purpose: "Needed for on-chain program deployment and keypair management",
    hint: "sh -c \"$(curl -sSfL https://release.anza.xyz/stable/install)\"",
  },
];

let allRequiredPresent = true;

for (const tool of tools) {
  const version = probe(tool.cmd);
  if (version) {
    console.log(`  ✓ ${tool.name.padEnd(18)} : ${version}`);
  } else if (tool.required) {
    allRequiredPresent = false;
    console.log(`  ✗ ${tool.name.padEnd(18)} : NOT FOUND (Required)`);
    console.log(`    → Install: ${tool.hint}`);
  } else {
    console.log(`  ⚠ ${tool.name.padEnd(18)} : NOT FOUND (Optional)`);
    if (tool.purpose) console.log(`    → Purpose: ${tool.purpose}`);
    console.log(`    → Install: ${tool.hint}`);
  }
}

console.log("--------------------------------------------------");
if (allRequiredPresent) {
  console.log("Status: Core web runtime is ready for development & testing.");
} else {
  console.log("Status: Missing core runtime dependencies.");
}
console.log("==================================================\n");

process.exit(0);
