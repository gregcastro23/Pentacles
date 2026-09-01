#!/usr/bin/env node
// ============================================================
// Pentacles — Deploy fresh ESMS Token ERC1967 Proxy on Base Sepolia
// ============================================================
// Deploys a new ERC1967 Proxy pointing to the verified ESMS implementation
// (0x339f17b2bee3522fd87ff37c5fbcd43b3815e98c), initializing MINTER_PRIVATE_KEY
// (0x553C2a3f193d5E7F41cF50cEB32069dbc6951931) as the initial Admin & Minter.

import { createPublicClient, createWalletClient, http, encodeDeployData, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { readFile, writeFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = dirname(dirname(SCRIPT_PATH))

const KEY = (process.env.MINTER_PRIVATE_KEY || '').trim()
if (!KEY || !/^0x[0-9a-fA-F]{64}$/.test(KEY)) {
  throw new Error('MINTER_PRIVATE_KEY environment variable is required and must be a 32-byte hex key.')
}
const RPC = (process.env.RPC || process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org').trim()
const IMPLEMENTATION = '0x339f17b2bee3522fd87ff37c5fbcd43b3815e98c'
const URI = 'https://alchmagents.eth.limo/esms/{id}.json'

const account = privateKeyToAccount(KEY)
const pub = createPublicClient({ chain: baseSepolia, transport: http(RPC) })
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) })

console.log(`Deployer Account: ${account.address}`)
console.log(`Implementation Contract: ${IMPLEMENTATION}`)

const abiJson = JSON.parse(await readFile(join(ROOT, 'contracts', 'build', 'contracts_ESMSProxy_sol_ESMSProxy.abi'), 'utf8'))
const binHex = '0x' + (await readFile(join(ROOT, 'contracts', 'build', 'contracts_ESMSProxy_sol_ESMSProxy.bin'), 'utf8')).trim()

const initAbi = parseAbi(['function initialize(string uri, address initialAdmin, address minter)'])
const initData = '0x' // empty initialization call in constructor

const deployData = encodeDeployData({
  abi: abiJson,
  bytecode: binHex,
  args: [IMPLEMENTATION, initData],
})

console.log('Sending transaction to deploy ESMS Token Proxy...')
const hash = await wallet.sendTransaction({
  data: deployData,
})

console.log(`Deploy tx submitted: ${hash}`)
console.log('Waiting for block confirmation...')

const receipt = await pub.waitForTransactionReceipt({ hash })
const newProxyAddress = receipt.contractAddress

console.log(`\n============================================================`)
console.log(`Fresh ESMS Token Proxy Deployed at: ${newProxyAddress}`)
console.log(`Initializing contract state...`)

const initTxHash = await wallet.writeContract({
  address: newProxyAddress,
  abi: initAbi,
  functionName: 'initialize',
  args: [URI, account.address, account.address],
})
await pub.waitForTransactionReceipt({ hash: initTxHash })
console.log(`Initialization complete! Tx: ${initTxHash}`)
console.log(`============================================================\n`)

const checkAbi = parseAbi([
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  'function MINTER_ROLE() view returns (bytes32)',
  'function BURNER_ROLE() view returns (bytes32)',
  'function grantRole(bytes32 role, address account)',
])

const DEFAULT_ADMIN_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000'
const MINTER_ROLE = '0x9f2fd0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6'
const BURNER_ROLE = '0x282c51f300000000000000000000000000000000000000000000000000000000'

const isAdmin = await pub.readContract({ address: newProxyAddress, abi: checkAbi, functionName: 'hasRole', args: [DEFAULT_ADMIN_ROLE, account.address] })
const isMinter = await pub.readContract({ address: newProxyAddress, abi: checkAbi, functionName: 'hasRole', args: [MINTER_ROLE, account.address] })

console.log(`Admin Check (${account.address}): ${isAdmin ? 'PASS' : 'FAIL'}`)
console.log(`Minter Check (${account.address}): ${isMinter ? 'PASS' : 'FAIL'}`)

const actualBurnerRole = await pub.readContract({ address: newProxyAddress, abi: checkAbi, functionName: 'BURNER_ROLE' }).catch(() => BURNER_ROLE)
const isBurner = await pub.readContract({ address: newProxyAddress, abi: checkAbi, functionName: 'hasRole', args: [actualBurnerRole, account.address] })

if (!isBurner) {
  console.log(`Granting BURNER_ROLE (${actualBurnerRole}) to ${account.address}...`)
  const burnerHash = await wallet.writeContract({
    address: newProxyAddress,
    abi: checkAbi,
    functionName: 'grantRole',
    args: [actualBurnerRole, account.address],
  })
  await pub.waitForTransactionReceipt({ hash: burnerHash })
  console.log(`BURNER_ROLE Granted! Tx: ${burnerHash}`)
}

async function upsertEnv(path, values) {
  let content = ''
  try { content = await readFile(path, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
  const lines = content ? content.replace(/\n$/, '').split('\n') : []
  const pending = new Map(Object.entries(values))
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/)
    if (!match || !pending.has(match[1])) return line
    const val = pending.get(match[1])
    pending.delete(match[1])
    return `${match[1]}=${val}`
  })
  if (pending.size) {
    if (next.length && next.at(-1) !== '') next.push('')
    for (const [k, v] of pending) next.push(`${k}=${v}`)
  }
  await writeFile(path, `${next.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
}

const envValues = {
  VITE_ESMS_TOKEN: newProxyAddress,
  ESMS_TOKEN: newProxyAddress,
  ESMS_SETTLEMENT_WALLET: account.address,
}

await Promise.all([
  upsertEnv(join(ROOT, '.env'), envValues),
  upsertEnv(join(ROOT, '.env.local'), envValues),
  upsertEnv(join(ROOT, 'feeder', '.env'), envValues),
])

console.log('Updated .env, .env.local, and feeder/.env with new ESMS_TOKEN address.')
