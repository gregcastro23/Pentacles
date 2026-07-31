#!/usr/bin/env node
// ============================================================
// Pentacles — Grant MINTER_ROLE on EsmsToken (Base Sepolia)
// ============================================================
// Grants MINTER_ROLE (0x9f2fd0be...) on EsmsToken (0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F)
// to the settlement wallet (0x553C2a3f193d5E7F41cF50cEB32069dbc6951931).
//
// Usage:
//   DEPLOYER_PRIVATE_KEY=0x… node scripts/grant-minter-role.mjs

import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'

const ESMS_TOKEN = (process.env.ESMS_TOKEN || '0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F').trim()
const SETTLEMENT_WALLET = (process.env.ESMS_SETTLEMENT_WALLET || '0x553C2a3f193d5E7F41cF50cEB32069dbc6951931').trim()
const RPC = (process.env.RPC || 'https://sepolia.base.org').trim()
const KEY = (process.env.DEPLOYER_PRIVATE_KEY || '').trim()

const MINTER_ROLE = '0x9f2fd0be4262f3d43734162327239b11500863478977014cf632924028c7158e'

if (!/^0x[0-9a-fA-F]{64}$/.test(KEY)) {
  console.error('Error: Set DEPLOYER_PRIVATE_KEY=0x… (64 hex characters) to run this script.')
  process.exit(1)
}

const ABI = parseAbi([
  'function grantRole(bytes32 role, address account)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
])

const account = privateKeyToAccount(KEY)
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) })
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) })

console.log(`Deployer: ${account.address}`)
console.log(`Granting MINTER_ROLE on EsmsToken (${ESMS_TOKEN}) to ${SETTLEMENT_WALLET}...`)

const alreadyGranted = await pub.readContract({
  address: ESMS_TOKEN,
  abi: ABI,
  functionName: 'hasRole',
  args: [MINTER_ROLE, SETTLEMENT_WALLET],
})

if (alreadyGranted) {
  console.log(`MINTER_ROLE is already granted to ${SETTLEMENT_WALLET}.`)
  process.exit(0)
}

const hash = await wallet.writeContract({
  address: ESMS_TOKEN,
  abi: ABI,
  functionName: 'grantRole',
  args: [MINTER_ROLE, SETTLEMENT_WALLET],
})

console.log(`Transaction sent: ${hash}`)
console.log('Waiting for transaction confirmation on Base Sepolia...')

const receipt = await pub.waitForTransactionReceipt({ hash })
console.log(`Status: ${receipt.status} (Block ${receipt.blockNumber})`)

if (receipt.status === 'success') {
  console.log('SUCCESS: MINTER_ROLE successfully granted!')
} else {
  console.error('Transaction failed.')
  process.exit(1)
}
