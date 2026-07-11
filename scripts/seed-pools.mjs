#!/usr/bin/env node
// ============================================================
// Pentacles — one-time admin seeding of the 12 constellation pools
// ============================================================
// Calls ConstellationAMM.seedInitial(constId, amtA, amtB, minShares) — the
// ADMIN_ROLE-only path that opens each pool with VIRTUAL reserves: it needs no
// attestation and burns no ESMS (the AMM mints/burns soulbound ESMS only at
// the swap/withdraw edges). Idempotent: pools with reserves are skipped.
//
// Usage:
//   DEPLOYER_PRIVATE_KEY=0x… node scripts/seed-pools.mjs
//   (optionally AMM=0x…, RPC=https://…, AMOUNT=1000 to override defaults)
//
// The deployer key must hold ADMIN_ROLE on the AMM (the Base Sepolia deployer
// 0x554F991D030aDF539CBD2ff3D896951C6f089804 does). Never commit the key.

import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const AMM = (process.env.AMM || '0x6B4EE164320e9E5583C0F6BEe14D5BABb5ba5095').trim()
const RPC = (process.env.RPC || 'https://sepolia.base.org').trim()
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '').trim()
// Symmetric 1:1 seeds across all pools — globally arbitrage-consistent starting
// prices; the market moves them from there.
const AMOUNT = parseUnits(process.env.AMOUNT || '1000', 18)

if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) {
  console.error('Set DEPLOYER_PRIVATE_KEY (0x-hex, ADMIN_ROLE holder on the AMM).')
  process.exit(1)
}

const ABI = parseAbi([
  'function pools(uint16) view returns (uint8 elemA, uint8 elemB, uint16 feeBps, uint256 reserveA, uint256 reserveB, uint256 totalShares, bool exists)',
  'function seedInitial(uint16 constId, uint256 amtA, uint256 amtB, uint256 minShares) returns (uint256 deedId)',
])

const account = privateKeyToAccount(KEY)
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) })
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) })

console.log(`Seeder: ${account.address} → AMM ${AMM} (${formatUnits(AMOUNT, 18)} per side)`)

let seeded = 0, skipped = 0
for (let id = 0; id < 12; id++) {
  const [elemA, elemB, feeBps, reserveA, , , exists] = await pub.readContract({
    address: AMM, abi: ABI, functionName: 'pools', args: [id],
  })
  if (!exists) { console.log(`pool ${id}: does not exist — skipping`); skipped++; continue }
  if (reserveA > 0n) { console.log(`pool ${id}: already seeded — skipping`); skipped++; continue }
  const hash = await wallet.writeContract({
    address: AMM, abi: ABI, functionName: 'seedInitial',
    args: [id, AMOUNT, AMOUNT, 0n],
  })
  const receipt = await pub.waitForTransactionReceipt({ hash })
  console.log(`pool ${id} (elem ${elemA}/${elemB}, ${feeBps} bps): seeded — ${receipt.status} ${hash}`)
  if (receipt.status !== 'success') process.exit(1)
  seeded++
}
console.log(`Done: ${seeded} seeded, ${skipped} skipped.`)
