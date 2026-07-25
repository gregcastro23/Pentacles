import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js'
import { getMint, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'

export const PROGRAM_ID = new PublicKey('7MPHZUmxFcLQiqmhnfvgVtTsMRu7jHdmGzjZbKbECE5R')
export const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com'
export const MAX_EPOCH_MINT = 10_000_000_000_000_000_000n
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'
export const ELEMENTS = Object.freeze([
  Object.freeze({ id: 0, name: 'SPIRIT' }),
  Object.freeze({ id: 1, name: 'ESSENCE' }),
  Object.freeze({ id: 2, name: 'MATTER' }),
  Object.freeze({ id: 3, name: 'SUBSTANCE' }),
])

const SCRIPT_PATH = fileURLToPath(import.meta.url)
const ROOT = dirname(dirname(SCRIPT_PATH))
const WALLET_PATH = process.env.SOLANA_WALLET_PATH || join(homedir(), '.config', 'solana', 'id.json')
const DEPLOY_DIR = join(ROOT, 'target', 'deploy')
const PROGRAM_KEYPAIR_PATH = join(DEPLOY_DIR, 'pentacles_solana-keypair.json')
const GAME_AUTHORITY_DISCRIMINATOR = Buffer.from('468aacdb9ce2e474', 'hex')

export function anchorDiscriminator(name) {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8)
}

export function gameAuthorityAddress() {
  return PublicKey.findProgramAddressSync([Buffer.from('game_authority')], PROGRAM_ID)[0]
}

export function buildInitializeGameAuthorityInstruction(payer, maxEpochMint = MAX_EPOCH_MINT) {
  const cap = BigInt(maxEpochMint)
  if (cap <= 0n || cap > 0xffffffffffffffffn) {
    throw new RangeError('maxEpochMint must fit in an unsigned 64-bit integer')
  }
  const data = Buffer.alloc(16)
  anchorDiscriminator('initialize_game_authority').copy(data, 0)
  data.writeBigUInt64LE(cap, 8)
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(payer), isSigner: true, isWritable: true },
      { pubkey: gameAuthorityAddress(), isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

export function buildInitializeElementMintInstruction(payer, mint, elementId) {
  if (!ELEMENTS.some((element) => element.id === elementId)) {
    throw new RangeError('elementId must be an integer from 0 through 3')
  }
  const data = Buffer.alloc(9)
  anchorDiscriminator('initialize_element_mint').copy(data, 0)
  data.writeUInt8(elementId, 8)
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: new PublicKey(payer), isSigner: true, isWritable: true },
      { pubkey: gameAuthorityAddress(), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(mint), isSigner: true, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })
}

async function readKeypair(path) {
  const bytes = JSON.parse(await readFile(path, 'utf8'))
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error(`Invalid 64-byte Solana keypair at ${path}`)
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes))
}

async function loadOrCreateMintKeypair({ name }) {
  const path = join(DEPLOY_DIR, `pentacles-${name.toLowerCase()}-mint-keypair.json`)
  try {
    return await readKeypair(path)
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const keypair = Keypair.generate()
  await mkdir(dirname(path), { recursive: true })
  try {
    await writeFile(path, JSON.stringify(Array.from(keypair.secretKey)), {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    })
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    return readKeypair(path)
  }
  await chmod(path, 0o600)
  return keypair
}

async function upsertEnv(path, values) {
  let content = ''
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
  }

  const lines = content ? content.replace(/\n$/, '').split('\n') : []
  const pending = new Map(Object.entries(values))
  const next = lines.map((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/)
    if (!match || !pending.has(match[1])) return line
    const value = pending.get(match[1])
    pending.delete(match[1])
    return `${match[1]}=${value}`
  })
  if (pending.size) {
    if (next.length && next.at(-1) !== '') next.push('')
    next.push('# Solana Devnet deployment (managed by scripts/init-solana-devnet.mjs)')
    for (const [key, value] of pending) next.push(`${key}=${value}`)
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${next.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 })
  await chmod(path, 0o600)
}

async function configureEnvironment(payer, mints) {
  const values = {
    VITE_SPACETIMEDB_URI: 'https://maincloud.spacetimedb.com',
    VITE_SPACETIMEDB_DB: 'cookingwithcastrollc',
    SPACETIMEDB_URI: 'https://maincloud.spacetimedb.com',
    SPACETIMEDB_DB: 'cookingwithcastrollc',
    VITE_SOLANA_RPC_URL: RPC_URL,
    VITE_SOLANA_PROGRAM_ID: PROGRAM_ID.toBase58(),
    SOLANA_RPC_URL: RPC_URL,
    SOLANA_PROGRAM_ID: PROGRAM_ID.toBase58(),
    SOLANA_MINTER_SECRET_KEY: JSON.stringify(Array.from(payer.secretKey)),
  }
  for (const { name, keypair } of mints) {
    values[`VITE_SOLANA_MINT_${name}`] = keypair.publicKey.toBase58()
    values[`SOLANA_MINT_${name}`] = keypair.publicKey.toBase58()
  }
  await Promise.all([
    upsertEnv(join(ROOT, '.env'), values),
    upsertEnv(join(ROOT, '.env.local'), values),
    upsertEnv(join(ROOT, 'feeder', '.env'), values),
  ])
}

async function sendAndFinalizeInstruction(connection, payer, instruction, signers = []) {
  const signature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer, ...signers],
    { commitment: 'finalized' },
  )
  return signature
}

async function verifyProgramIdConsistency() {
  const expected = PROGRAM_ID.toBase58()
  const deployKeypair = await readKeypair(PROGRAM_KEYPAIR_PATH)
  if (!deployKeypair.publicKey.equals(PROGRAM_ID)) {
    throw new Error(`Deploy keypair resolves to ${deployKeypair.publicKey.toBase58()}, expected ${expected}`)
  }

  const requiredFiles = [
    [join(ROOT, 'Anchor.toml'), new RegExp(`pentacles_solana = "${expected}"`)],
    [join(ROOT, 'programs', 'pentacles-solana', 'src', 'lib.rs'), new RegExp(`declare_id!\\("${expected}"\\)`)],
  ]
  for (const [path, expectedPattern] of requiredFiles) {
    const content = await readFile(path, 'utf8')
    if (!expectedPattern.test(content)) {
      throw new Error(`${path} does not declare the deploy keypair program ID ${expected}`)
    }
  }

  for (const filename of ['.env', '.env.local']) {
    const path = join(ROOT, filename)
    try {
      const content = await readFile(path, 'utf8')
      for (const key of ['VITE_SOLANA_PROGRAM_ID', 'SOLANA_PROGRAM_ID']) {
        const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'))
        if (match && match[1] !== expected) {
          throw new Error(`${path} has ${key}=${match[1]}, expected ${expected}`)
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
  }
}

function verifyGameAuthorityAccount(data, payer) {
  if (data.length < 65 || !data.subarray(0, 8).equals(GAME_AUTHORITY_DISCRIMINATOR)) {
    throw new Error('GameAuthority PDA exists with an unexpected account layout')
  }
  const authority = new PublicKey(data.subarray(8, 40))
  if (!authority.equals(payer.publicKey)) {
    throw new Error(`GameAuthority belongs to ${authority.toBase58()}, not ${payer.publicKey.toBase58()}`)
  }
}

async function verifyMint(connection, mint, gameAuthority) {
  const info = await getMint(connection, mint, 'finalized', TOKEN_2022_PROGRAM_ID)
  if (info.decimals !== 18) throw new Error(`Mint ${mint} has ${info.decimals} decimals, expected 18`)
  if (!info.mintAuthority?.equals(gameAuthority)) {
    throw new Error(`Mint ${mint} is not controlled by the GameAuthority PDA`)
  }
}

export async function initializeDevnet({ prepareOnly = false } = {}) {
  await access(WALLET_PATH, fsConstants.R_OK)
  await verifyProgramIdConsistency()
  const payer = await readKeypair(WALLET_PATH)
  const mints = await Promise.all(
    ELEMENTS.map(async (element) => ({
      ...element,
      keypair: await loadOrCreateMintKeypair(element),
    })),
  )

  console.log(`Deployment authority: ${payer.publicKey.toBase58()}`)
  for (const { name, keypair } of mints) {
    console.log(`${name} mint: ${keypair.publicKey.toBase58()}`)
  }
  if (prepareOnly) return { payer, mints }

  const connection = new Connection(RPC_URL, 'finalized')
  const genesisHash = await connection.getGenesisHash()
  if (genesisHash !== DEVNET_GENESIS_HASH) {
    throw new Error(`RPC ${RPC_URL} is not Solana Devnet (genesis hash ${genesisHash})`)
  }
  const programInfo = await connection.getAccountInfo(PROGRAM_ID, 'finalized')
  if (!programInfo?.executable) {
    throw new Error(`Program ${PROGRAM_ID.toBase58()} is not deployed and executable on ${RPC_URL}`)
  }

  const gameAuthority = gameAuthorityAddress()
  const authorityInfo = await connection.getAccountInfo(gameAuthority, 'finalized')
  if (authorityInfo) {
    verifyGameAuthorityAccount(authorityInfo.data, payer)
    console.log(`GameAuthority already initialized: ${gameAuthority.toBase58()}`)
  } else {
    const signature = await sendAndFinalizeInstruction(
      connection,
      payer,
      buildInitializeGameAuthorityInstruction(payer.publicKey),
    )
    console.log(`GameAuthority initialized: ${signature}`)
  }

  for (const { id, name, keypair: mint } of mints) {
    if (await connection.getAccountInfo(mint.publicKey, 'finalized')) {
      await verifyMint(connection, mint.publicKey, gameAuthority)
      console.log(`${name} mint already initialized: ${mint.publicKey.toBase58()}`)
      continue
    }
    const signature = await sendAndFinalizeInstruction(
      connection,
      payer,
      buildInitializeElementMintInstruction(payer.publicKey, mint.publicKey, id),
      [mint],
    )
    await verifyMint(connection, mint.publicKey, gameAuthority)
    console.log(`${name} mint initialized: ${signature}`)
  }

  await configureEnvironment(payer, mints)
  return { payer, mints, gameAuthority }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  initializeDevnet({ prepareOnly: process.argv.includes('--prepare-only') }).catch((error) => {
    console.error(error?.stack || error)
    process.exitCode = 1
  })
}
