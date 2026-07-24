// ============================================================
// Pentacles — Base Sepolia chain config + viem public client
// ============================================================
// Single source of truth for the on-chain layer (Phases 2 & 3). Addresses
// default to the verified live testnet deployment and are env-overridable.

import { createPublicClient, http } from 'viem'
import { baseSepolia } from 'viem/chains'

export const CHAIN = baseSepolia // chainId 84532
export const RPC_URL = (import.meta.env.VITE_BASE_SEPOLIA_RPC || 'https://sepolia.base.org').trim()
export const EXPLORER = 'https://sepolia.basescan.org'

export const ADDRESSES = {
  amm: (import.meta.env.VITE_CONSTELLATION_AMM || '0x34d860Cb460ecD2595584138d22Ad6fe7DAeA3BB').trim(),
  deed: (import.meta.env.VITE_CONSTELLATION_DEED || '0x6B4EE164320e9E5583C0F6BEe14D5BABb5ba5095').trim(),
  esms: (import.meta.env.VITE_ESMS_TOKEN || '0x124ECa1bb1E106D3614A22A256f9A412FfeEAd8F').trim(),
}

// Read-only client over the public RPC (no wallet needed).
export const publicClient = createPublicClient({ chain: CHAIN, transport: http(RPC_URL) })

export const txUrl = (hash) => `${EXPLORER}/tx/${hash}`
export const addrUrl = (addr) => `${EXPLORER}/address/${addr}`
