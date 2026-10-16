/**
 * ============================================================================
 * Pentacles — Deterministic Tile-Contest Resolution Engine
 * ============================================================================
 *
 * Compares two vessels (challenger and defender) contesting the same Pentacle
 * zone node (House, Spire, or Crown Zenith) using:
 *   1. OVR (Ordered Weighted Average)
 *   2. Zone-Specific Sacred 7 Stat Affinity
 *   3. Active Resonance Surge Stat Boosts & Momentum Surge
 *   4. ESMS Alchemical Seal Tier Multipliers (Copper -> Celestial)
 *   5. Resulting Zone Control Delta (-1000 .. +1000 tug-of-war)
 */

import {
  type RatedAgentPayload,
  type SacredStatKey,
  type SealTier,
  SACRED_STAT_KEYS,
  SEAL_TIER_MULTIPLIERS,
} from './rating-contract';

export type ZoneKind = 'house' | 'spire' | 'crown';

export interface TileContestOptions {
  zoneCurrentControl?: number; // -1000 .. +1000 (positive = defender, negative = challenger)
  zoneInFlux?: boolean;
}

export interface TileContestResult {
  winner: 'challenger' | 'defender' | 'draw';
  winnerKey: string;
  loserKey: string;
  challengerScore: number;
  defenderScore: number;
  margin: number;
  controlDelta: number;
  newZoneControl: number;
  challengerSurgeIgnited: boolean;
  defenderSurgeIgnited: boolean;
  log: string[];
}

/** Zone stat affinity weights */
export const ZONE_STAT_WEIGHTS: Record<ZoneKind, Record<SacredStatKey, number>> = {
  house: {
    power: 1.3,
    vitality: 1.3,
    adaptability: 1.1,
    resonance: 0.9,
    wisdom: 0.9,
    charisma: 0.8,
    intuition: 0.9,
  },
  spire: {
    resonance: 1.3,
    intuition: 1.3,
    wisdom: 1.1,
    adaptability: 1.1,
    power: 0.9,
    vitality: 0.8,
    charisma: 0.9,
  },
  crown: {
    wisdom: 1.4,
    charisma: 1.3,
    power: 1.1,
    resonance: 1.1,
    intuition: 1.0,
    adaptability: 1.0,
    vitality: 0.9,
  },
};

/**
 * Compute the Effective Contest Rating (ECR) for an avatar on a given zone.
 */
export function computeEffectiveContestRating(
  agent: RatedAgentPayload,
  zoneKind: ZoneKind
): { rating: number; weightedStatSum: number; sealBonus: number; surgeBonus: number } {
  const weights = ZONE_STAT_WEIGHTS[zoneKind];
  let totalWeightedStat = 0;
  let totalWeight = 0;

  // 1. Calculate effective stats with active Resonance Surge boosts
  for (const key of SACRED_STAT_KEYS) {
    const raw = agent.ratings[key] ?? 25;
    const boost = agent.surge.active ? (agent.surge.statBoosts[key] ?? 0) : 0;
    const effectiveStat = raw + boost;
    const w = weights[key] ?? 1.0;

    totalWeightedStat += effectiveStat * w;
    totalWeight += w;
  }

  const weightedStatAverage = totalWeightedStat / totalWeight;

  // 2. Alchemical Seal Multipliers
  let sealBonusPercent = 0;
  for (const s of agent.seals) {
    const mult = SEAL_TIER_MULTIPLIERS[s.tier] || 1.0;
    sealBonusPercent += (mult - 1.0) * 0.45;
  }
  // Cap max seal contribution to +35%
  sealBonusPercent = Math.min(0.35, sealBonusPercent);

  // 3. Resonance Surge Momentum (equilibrium grants +12%, inferno/tempest grant +8%)
  let surgeBonus = 0.0;
  if (agent.surge.active) {
    surgeBonus = agent.surge.surgeType === 'equilibrium' ? 0.12 : 0.08;
  }

  // 4. Composite ECR (40% baseline OVR, 60% zone-weighted stats) * multipliers
  const baseComposite = agent.ovr * 0.4 + weightedStatAverage * 0.6;
  const finalRating = baseComposite * (1.0 + sealBonusPercent + surgeBonus);

  return {
    rating: Math.round(finalRating * 10) / 10,
    weightedStatSum: Math.round(weightedStatAverage * 10) / 10,
    sealBonus: Math.round(sealBonusPercent * 100) / 100,
    surgeBonus,
  };
}

/**
 * Resolve a deterministic tile contest between two avatars on a Pentacle zone.
 */
export function resolveTileContest(
  zoneId: number,
  zoneKind: ZoneKind,
  challenger: RatedAgentPayload,
  defender: RatedAgentPayload,
  options: TileContestOptions = {}
): TileContestResult {
  const currentControl = options.zoneCurrentControl ?? 0;
  const log: string[] = [];

  const cEval = computeEffectiveContestRating(challenger, zoneKind);
  const dEval = computeEffectiveContestRating(defender, zoneKind);

  log.push(
    `[Contest] Zone ${zoneId} (${zoneKind.toUpperCase()}): ${challenger.handle} (${challenger.factionName}) challenges ${defender.handle} (${defender.factionName})`
  );

  if (challenger.surge.active) {
    log.push(`⚡ Challenger ${challenger.handle} SURGE ACTIVE (${challenger.surge.surgeType}, +${(cEval.surgeBonus * 100).toFixed(0)}% momentum, +${challenger.surge.statBoosts[challenger.archetype.primary]}/${challenger.archetype.primary})`);
  }
  if (defender.surge.active) {
    log.push(`⚡ Defender ${defender.handle} SURGE ACTIVE (${defender.surge.surgeType}, +${(dEval.surgeBonus * 100).toFixed(0)}% momentum, +${defender.surge.statBoosts[defender.archetype.primary]}/${defender.archetype.primary})`);
  }

  const margin = Math.round((cEval.rating - dEval.rating) * 10) / 10;
  let winner: 'challenger' | 'defender' | 'draw' = 'draw';
  let winnerKey = '';
  let loserKey = '';

  // Base control swing
  let controlDelta = 120 + Math.min(480, Math.round(Math.abs(margin) * 14));

  if (margin > 0.5) {
    winner = 'challenger';
    winnerKey = challenger.key;
    loserKey = defender.key;
    log.push(`🏆 Challenger ${challenger.handle} prevails by margin +${margin} (ECR ${cEval.rating} vs ${dEval.rating})`);
  } else if (margin < -0.5) {
    winner = 'defender';
    winnerKey = defender.key;
    loserKey = challenger.key;
    log.push(`🛡️ Defender ${defender.handle} holds position by margin +${Math.abs(margin)} (ECR ${dEval.rating} vs ${cEval.rating})`);
  } else {
    winner = 'draw';
    winnerKey = challenger.key;
    loserKey = defender.key;
    controlDelta = 40;
    log.push(`⚔️ Duel results in a standoff (ECR ${cEval.rating} vs ${dEval.rating})`);
  }

  // Calculate resulting zone control (-1000 .. +1000)
  // Positive = defender's faction advantage, negative = challenger's faction advantage
  let newZoneControl: number;
  if (winner === 'challenger') {
    newZoneControl = Math.max(-1000, currentControl - controlDelta);
  } else if (winner === 'defender') {
    newZoneControl = Math.min(1000, currentControl + controlDelta);
  } else {
    newZoneControl = currentControl;
  }

  log.push(`📊 Zone ${zoneId} control shifted from ${currentControl} to ${newZoneControl} (delta ${controlDelta})`);

  return {
    winner,
    winnerKey,
    loserKey,
    challengerScore: cEval.rating,
    defenderScore: dEval.rating,
    margin,
    controlDelta,
    newZoneControl,
    challengerSurgeIgnited: challenger.surge.active,
    defenderSurgeIgnited: defender.surge.active,
    log,
  };
}

/**
 * Rust companion reducer code proposal for SpacetimeDB server/src/melee.rs
 */
export const RUST_SPACETIMEDB_CONTEST_REDUCER_PROPOSAL = `
// ── SpacetimeDB Server Companion: Vessel Rating Zone Contest Resolution ─────
// Placed in server/src/melee.rs or server/src/reducers.rs

#[spacetimedb::reducer]
pub fn resolve_avatar_zone_contest(
    ctx: &ReducerContext,
    zone_id: u8,
    challenger_identity: Identity,
    defender_identity: Identity,
    challenger_ovr: u8,
    defender_ovr: u8,
    challenger_surge_active: bool,
    defender_surge_active: bool,
) -> Result<(), String> {
    let mut zone = ctx.db.zone().zone_id().find(&zone_id)
        .ok_or_else(|| format!("Zone {} not found", zone_id))?;

    let c_boost = if challenger_surge_active { 8 } else { 0 };
    let d_boost = if defender_surge_active { 8 } else { 0 };

    let c_score = (challenger_ovr as i32) + c_boost;
    let d_score = (defender_ovr as i32) + d_boost;
    let delta = (c_score - d_score) * 14;

    if delta > 0 {
        zone.control = (zone.control - delta.clamp(120, 600)).max(-1000);
    } else {
        zone.control = (zone.control + delta.abs().clamp(120, 600)).min(1000);
    }

    zone.updated_at = ctx.timestamp;
    ctx.db.zone().zone_id().update(zone);
    Ok(())
}
`;
