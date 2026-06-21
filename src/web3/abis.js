// ============================================================
// Pentacles — on-chain ABIs (Base Sepolia)
// ============================================================
// Human-readable ABI fragments parsed by viem. Signatures verified against the
// deployed contracts (ConstellationAMM / EsmsToken / ConstellationDeed).

import { parseAbi } from 'viem'

// EsmsToken — ERC-1155, soulbound, 18 decimals by convention (no decimals()).
export const ESMS_ABI = parseAbi([
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
])

// ConstellationAMM — the 12 constellation pools (constId == constellation id).
export const AMM_ABI = parseAbi([
  'function getReserves(uint16 constId) view returns (uint256 rA, uint256 rB)',
  'function quote(uint16 constId, uint8 inId, uint256 inAmt) view returns (uint256 outAmt)',
  'function pools(uint16) view returns (uint8 elemA, uint8 elemB, uint16 feeBps, uint256 reserveA, uint256 reserveB, uint256 totalShares, bool exists)',
  'function usedNonce(uint16 constId, address trader) view returns (uint64)',
  'function seedLiquidity(uint16 constId, uint256 amtA, uint256 amtB, uint256 minShares, (address trader, uint16 constellationId, bytes32 regionCommit, uint8 visibleStars, uint64 nonce, uint64 deadline) att, bytes sig) returns (uint256 deedId)',
  'function swap(uint16 constId, uint8 inId, uint256 inAmt, uint256 minOut, (address trader, uint16 constellationId, bytes32 regionCommit, uint8 visibleStars, uint64 nonce, uint64 deadline) att, bytes sig) returns (uint256 outAmt)',
  'function withdraw(uint256 deedId, uint256 shareBps)',
  'event PoolSeeded(uint16 indexed constId, address indexed trader, uint256 amtA, uint256 amtB, uint256 shares, uint256 deedId)',
  'event Swapped(uint16 indexed constId, address indexed trader, uint8 inId, uint256 inAmt, uint8 outId, uint256 outAmt)',
])

// EIP-712 for the visibility attestation (domain chainId 84532, verifyingContract = AMM).
export const VISIBILITY_DOMAIN = (verifyingContract) => ({
  name: 'ConstellationAMM',
  version: '1',
  chainId: 84532,
  verifyingContract,
})
export const VISIBILITY_TYPES = {
  VisibilityAttestation: [
    { name: 'trader', type: 'address' },
    { name: 'constellationId', type: 'uint16' },
    { name: 'regionCommit', type: 'bytes32' },
    { name: 'visibleStars', type: 'uint8' },
    { name: 'nonce', type: 'uint64' },
    { name: 'deadline', type: 'uint64' },
  ],
}

// ConstellationDeed — plain ERC-721 (NOT enumerable); discover deeds via the
// AMM's PoolSeeded(trader) event, then confirm ownerOf.
export const DEED_ABI = parseAbi([
  'function positionOf(uint256 id) view returns (uint16 constellationId, uint256 shares, uint64 mintedAtBlock)',
  'function ownerOf(uint256 id) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
])

// AMM custom errors → friendly text (selectors recovered by viem on revert).
export const AMM_ERROR_TEXT = {
  NoSuchPool: 'That constellation pool does not exist.',
  BadElementForPool: 'That element is not part of this pool.',
  AttestationTraderMismatch: 'The attestation was issued to a different wallet.',
  AttestationConstellationMismatch: 'The attestation is for a different constellation.',
  AttestationExpired: 'The visibility attestation expired — re-trace to refresh it.',
  AttestationBadNonce: 'Stale attestation nonce — re-trace to get a fresh one.',
  AttestationBadSigner: 'The attestation signer is not the authorized sky-feeder.',
  InsufficientOutput: 'Output below your minimum (slippage too high or pool too thin).',
  InsufficientLiquidity: 'The pool has too little liquidity for this action.',
  OffRatioDeposit: 'Seed amounts are off the current pool ratio.',
  SlippageTooHigh: 'Minted shares below your minimum.',
  NotDeedOwner: 'You do not own that Constellation Deed.',
  BadShareBps: 'Invalid withdrawal share (must be 1–10000 bps).',
  EnforcedPause: 'The AMM is paused.',
  ERC1155InsufficientBalance: 'Not enough ESMS for this action.',
}
