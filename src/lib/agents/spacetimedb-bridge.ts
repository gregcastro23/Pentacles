/**
 * ============================================================================
 * Pentacles — SpacetimeDB Client Bridge & Rust Server Reducer Alignment
 * ============================================================================
 *
 * Bridges live SpacetimeDB table subscriptions (Zone, AgentChart, MeleeTable)
 * into:
 *   1. 3D Pentacle Arena pedestals (ownership, control, flux)
 *   2. Live Wallet Sync (ESMS token balances & Alchemical Seal upgrades)
 *   3. 3D Foot Ring shaders & Vessel Card HUDs
 *
 * Includes offline/test fallback mode and 1:1 parity validator for the
 * deterministic Rust companion reducer.
 */

import { type PentacleArena3D } from './pentacle-arena-3d';
import {
  type RatedAgentPayload,
  type EsmsBalances,
  type SealTier,
  SEAL_TIER_MULTIPLIERS,
} from './rating-contract';
import { syncAgentEsmsFromSpacetime } from './live-wallet-sync';
import { resolveTileContest, type TileContestResult } from './tile-contest';

export interface SpacetimeZoneRow {
  zoneId: number;
  kind?: 'house' | 'spire' | 'crown' | number;
  owner: number | null | { tag: string; value?: any };
  control: number;
  inFlux?: boolean;
  fluxLevel?: number;
  updatedAt?: any;
}

export interface SpacetimeAgentChartRow {
  identity: string;
  handle: string;
  birthUnix?: number | bigint;
  placements?: any[];
}

export interface SpacetimeMeleeTableRow {
  tableId: number | bigint;
  zoneId: number;
  roundIndex: number | bigint;
  trumpSuit?: any;
}

export type ZoneRowListener = (row: SpacetimeZoneRow) => void;
export type AgentChartListener = (chart: SpacetimeAgentChartRow) => void;
export type MeleeTableListener = (table: SpacetimeMeleeTableRow) => void;

/**
 * Normalizes SpacetimeDB owner representation (number, null, or tagged union)
 */
export function normalizeOwnerFaction(owner: any): number | null {
  if (owner == null) return null;
  if (typeof owner === 'number') return owner;
  if (typeof owner === 'object' && 'tag' in owner) {
    const planetMap: Record<string, number> = {
      Sun: 0,
      Moon: 1,
      Mercury: 2,
      Venus: 3,
      Mars: 4,
      Jupiter: 5,
      Saturn: 6,
      Uranus: 7,
      Neptune: 8,
      Pluto: 9,
    };
    return planetMap[owner.tag] ?? null;
  }
  return null;
}

export class SpacetimeDBBridge {
  private arena: PentacleArena3D | null = null;
  private isConnected: boolean = false;
  private clientInstance: any = null;
  private zoneListeners: Set<ZoneRowListener> = new Set();
  private agentListeners: Set<AgentChartListener> = new Set();
  private meleeListeners: Set<MeleeTableListener> = new Set();

  /**
   * Attach active 3D Pentacle Court Arena for live pedestal updates
   */
  public attachArena(arena: PentacleArena3D): void {
    this.arena = arena;
  }

  /**
   * Detach arena on unmount
   */
  public detachArena(): void {
    this.arena = null;
  }

  /**
   * Connect to SpacetimeDB client instance or start in offline mock mode
   */
  public connect(client?: any): void {
    this.clientInstance = client || null;
    this.isConnected = Boolean(client);

    if (client && client.db) {
      try {
        // Subscribe to Zone table if registered in client
        if (client.db.zone && typeof client.db.zone.onUpdate === 'function') {
          client.db.zone.onUpdate((_oldRow: any, newRow: any) => {
            this.handleZoneUpdate(newRow);
          });
        }

        // Subscribe to AgentChart table
        if (client.db.agentChart && typeof client.db.agentChart.onUpdate === 'function') {
          client.db.agentChart.onUpdate((_oldRow: any, newRow: any) => {
            this.handleAgentChartUpdate(newRow);
          });
        }

        // Subscribe to MeleeTable table
        if (client.db.meleeTable && typeof client.db.meleeTable.onUpdate === 'function') {
          client.db.meleeTable.onUpdate((_oldRow: any, newRow: any) => {
            this.handleMeleeTableUpdate(newRow);
          });
        }
      } catch (err) {
        console.warn('[SpacetimeDBBridge] Error attaching live table listeners:', err);
      }
    }
  }

  /**
   * Handles incoming Zone row update from SpacetimeDB
   */
  public handleZoneUpdate(row: SpacetimeZoneRow): void {
    const ownerFaction = normalizeOwnerFaction(row.owner);

    // Update 3D arena if attached
    if (this.arena) {
      this.arena.updateZoneStatus(row.zoneId, ownerFaction, row.control);
    }

    // Notify registered listeners
    for (const listener of this.zoneListeners) {
      try {
        listener(row);
      } catch (err) {
        console.error('[SpacetimeDBBridge] Zone listener error:', err);
      }
    }
  }

  /**
   * Handles incoming AgentChart update from SpacetimeDB
   */
  public handleAgentChartUpdate(chart: SpacetimeAgentChartRow): void {
    for (const listener of this.agentListeners) {
      try {
        listener(chart);
      } catch (err) {
        console.error('[SpacetimeDBBridge] Agent listener error:', err);
      }
    }
  }

  /**
   * Handles incoming MeleeTable update from SpacetimeDB
   */
  public handleMeleeTableUpdate(table: SpacetimeMeleeTableRow): void {
    for (const listener of this.meleeListeners) {
      try {
        listener(table);
      } catch (err) {
        console.error('[SpacetimeDBBridge] Melee listener error:', err);
      }
    }
  }

  /**
   * Push live ESMS balance delta for an agent directly into live wallet sync
   */
  public handleAgentEsmsUpdate(
    agentId: string,
    balances: EsmsBalances
  ): RatedAgentPayload | null {
    return syncAgentEsmsFromSpacetime(agentId, balances);
  }

  /**
   * Listen to Zone table row updates
   */
  public onZoneUpdate(listener: ZoneRowListener): () => void {
    this.zoneListeners.add(listener);
    return () => this.zoneListeners.delete(listener);
  }

  /**
   * Listen to AgentChart row updates
   */
  public onAgentChartUpdate(listener: AgentChartListener): () => void {
    this.agentListeners.add(listener);
    return () => this.agentListeners.delete(listener);
  }

  /**
   * Listen to MeleeTable row updates
   */
  public onMeleeTableUpdate(listener: MeleeTableListener): () => void {
    this.meleeListeners.add(listener);
    return () => this.meleeListeners.delete(listener);
  }

  public isOnline(): boolean {
    return this.isConnected;
  }
}

export const spacetimedbBridge = new SpacetimeDBBridge();

// ════════════════════════════════════════════════════════════════════════════
//  Rust Companion Server Module: Deterministic Vessel Zone Contest Reducer
// ════════════════════════════════════════════════════════════════════════════

export const RUST_VESSEL_CONTEST_MODULE = `
//! SpacetimeDB Server Module — Vessel Rating Zone Contest Reducer
//! Integer-scaled deterministic contest math matching Pentacles TypeScript specification.

use spacetimedb::{Identity, ReducerContext, Timestamp};
use crate::tables::Zone;

pub const OWA_WEIGHT_PRIMARY: i32 = 1600;   // 1.6x scaled by 1000
pub const OWA_WEIGHT_SECONDARY: i32 = 1300; // 1.3x scaled by 1000
pub const OWA_WEIGHT_TERTIARY: i32 = 1000;  // 1.0x scaled by 1000
pub const OWA_WEIGHT_SUM: i32 = 3900;

pub const SEAL_MULT_COPPER: i32 = 1000;    // 1.00x
pub const SEAL_MULT_SILVER: i32 = 1050;    // 1.05x
pub const SEAL_MULT_GOLD: i32 = 1100;      // 1.10x
pub const SEAL_MULT_AETHER: i32 = 1160;    // 1.16x
pub const SEAL_MULT_CELESTIAL: i32 = 1250; // 1.25x

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SealTier {
    Copper,
    Silver,
    Gold,
    Aether,
    Celestial,
}

impl SealTier {
    pub fn multiplier_scale_1000(&self) -> i32 {
        match self {
            SealTier::Copper => SEAL_MULT_COPPER,
            SealTier::Silver => SEAL_MULT_SILVER,
            SealTier::Gold => SEAL_MULT_GOLD,
            SealTier::Aether => SEAL_MULT_AETHER,
            SealTier::Celestial => SEAL_MULT_CELESTIAL,
        }
    }
}

pub struct VesselCombatant {
    pub identity: Identity,
    pub ovr: u8,
    pub primary_stat: u8,
    pub secondary_stat: u8,
    pub tertiary_stat: u8,
    pub surge_active: bool,
    pub is_equilibrium: bool,
    pub highest_seal_tier: SealTier,
}

pub fn evaluate_vessel_combat_rating_scaled(vessel: &VesselCombatant) -> i32 {
    // 1. OWA weighted effective core rating: (primary * 1.6 + sec * 1.3 + tert * 1.0) / 3.9
    let owa_num = (vessel.primary_stat as i32 * OWA_WEIGHT_PRIMARY)
        + (vessel.secondary_stat as i32 * OWA_WEIGHT_SECONDARY)
        + (vessel.tertiary_stat as i32 * OWA_WEIGHT_TERTIARY);
    let owa_rating = owa_num / OWA_WEIGHT_SUM;

    // 2. Base blend: 60% OWA + 40% OVR
    let base = (owa_rating * 60 + (vessel.ovr as i32) * 40) / 100;

    // 3. Seal multiplier
    let with_seal = (base * vessel.highest_seal_tier.multiplier_scale_1000()) / 1000;

    // 4. Resonance Surge momentum boost (+12% or +18% equilibrium)
    let surge_mult = if vessel.surge_active {
        if vessel.is_equilibrium { 1180 } else { 1120 }
    } else {
        1000
    };

    (with_seal * surge_mult) / 1000
}

#[spacetimedb::reducer]
pub fn resolve_vessel_zone_contest(
    ctx: &ReducerContext,
    zone_id: u8,
    challenger: VesselCombatant,
    defender: VesselCombatant,
) -> Result<(), String> {
    let mut zone = ctx.db.zone().zone_id().find(&zone_id)
        .ok_or_else(|| format!("Zone {} not found", zone_id))?;

    let c_rating = evaluate_vessel_combat_rating_scaled(&challenger);
    let d_rating = evaluate_vessel_combat_rating_scaled(&defender);
    let margin = c_rating - d_rating;

    // Base control swing: 120 + clamp(abs(margin) * 14, 0, 480)
    let delta = 120 + (margin.abs() * 14).min(480);

    if margin > 0 {
        // Challenger pushes control toward negative bound
        zone.control = (zone.control - delta).max(-1000);
    } else if margin < 0 {
        // Defender holds position toward positive bound
        zone.control = (zone.control + delta).min(1000);
    }

    zone.updated_at = ctx.timestamp;
    ctx.db.zone().zone_id().update(zone);
    Ok(())
}
`;

/**
 * TypeScript Integer-Scaled Simulation of the Rust Reducer
 * Allows unit testing 1:1 parity between TypeScript and Rust integer math.
 */
export function simulateRustVesselCombatRating(vessel: {
  ovr: number;
  primaryStat: number;
  secondaryStat: number;
  tertiaryStat: number;
  surgeActive: boolean;
  isEquilibrium: boolean;
  sealTier: SealTier;
}): number {
  const OWA_PRIMARY = 1600;
  const OWA_SECONDARY = 1300;
  const OWA_TERTIARY = 1000;
  const OWA_SUM = 3900;

  const owaNum =
    vessel.primaryStat * OWA_PRIMARY +
    vessel.secondaryStat * OWA_SECONDARY +
    vessel.tertiaryStat * OWA_TERTIARY;
  const owaRating = Math.floor(owaNum / OWA_SUM);

  const base = Math.floor((owaRating * 60 + vessel.ovr * 40) / 100);

  const sealMultipliers: Record<SealTier, number> = {
    Copper: 1000,
    Silver: 1050,
    Gold: 1100,
    Aether: 1160,
    Celestial: 1250,
  };
  const sealMult = sealMultipliers[vessel.sealTier];
  const withSeal = Math.floor((base * sealMult) / 1000);

  const surgeMult = vessel.surgeActive
    ? vessel.isEquilibrium
      ? 1180
      : 1120
    : 1000;

  return Math.floor((withSeal * surgeMult) / 1000);
}
