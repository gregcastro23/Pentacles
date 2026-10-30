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

import { type PentacleArena3D, getZoneTitle } from './pentacle-arena-3d';
import { type EsmsAudioElement } from './court-audio-synth';
import {
  type RatedAgentPayload,
  type EsmsBalances,
  type SealTier,
  SACRED_STAT_KEYS,
  computeRelativeAdvantage,
  resolveArchetype,
  type SacredStatKey,
} from './rating-contract';
import { syncAgentEsmsFromSpacetime, liveWalletSync } from './live-wallet-sync';
import { applyRatingSnapshot } from './agent-rating-feed';
import { HISTORICAL_AGENTS, PLANET_NAMES } from '../../alchm-chart/historical-agents.js';

export function suitToSuitName(suit: any): string {
  const norm = String(suit?.tag ?? suit ?? '').toLowerCase();
  if (norm.includes('wand') || norm.includes('fire')) return 'Wands';
  if (norm.includes('cup') || norm.includes('water')) return 'Cups';
  if (norm.includes('pentacle') || norm.includes('earth') || norm.includes('coin')) return 'Pentacles';
  if (norm.includes('sword') || norm.includes('air')) return 'Swords';
  return 'Wands';
}

export function suitToEsmsElement(suit: any): EsmsAudioElement {
  const norm = String(suit?.tag ?? suit ?? '').toLowerCase();
  if (norm.includes('wand') || norm.includes('fire')) return 'spirit';
  if (norm.includes('cup') || norm.includes('water')) return 'essence';
  if (norm.includes('pentacle') || norm.includes('earth') || norm.includes('coin')) return 'matter';
  if (norm.includes('sword') || norm.includes('air')) return 'substance';
  return 'spirit';
}

export interface CourtTimelineEvent {
  id: string;
  type: 'arrival' | 'contest' | 'rating';
  timestamp: number;
  zoneId: number;
  agentKey: string;
  agentHandle: string;
  faction: number;
  fromZoneId?: number;
  targetZoneId?: number;
  rivalKey?: string;
  rivalHandle?: string;
  rivalFaction?: number;
  summary: string;
  detail?: string;
  ovrBefore?: number;
  ovrAfter?: number;
  transitDelta?: number;
}

export type TimelineEventListener = (event: CourtTimelineEvent) => void;

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
  if (typeof owner === 'number') return Number.isInteger(owner) && owner >= 0 && owner < 10 ? owner : null;
  if (typeof owner === 'object') {
    if ('some' in owner) return normalizeOwnerFaction(owner.some);
    if ('none' in owner) return null;
    if (owner.tag === 'Some') return normalizeOwnerFaction(owner.value);
    if (owner.tag === 'None') return null;
    return normalizeOwnerFaction(owner.tag ?? Object.keys(owner)[0]);
  }
  const index = PLANET_NAMES.findIndex((name: string) => name.toLowerCase() === String(owner).toLowerCase());
  return index < 0 ? null : index;
}

type Row = Record<string, any>;
const TABLE_KEYS = {
  zone: 'zoneId', agent_chart: 'identity', agent_rating: 'identity', player: 'identity', melee_table: 'tableId',
  melee_seat: 'seatId', melee_play: 'playId', melee_trick: 'trickId',
  pentacle_conversion_escrow: 'conversionId', star_stake: 'stakeId',
} as const;
type TableName = keyof typeof TABLE_KEYS;

function parseAtomBigInt(val: any): bigint {
  if (typeof val === 'bigint') return val;
  const s = String(val ?? '0').trim();
  if (!/^\d+$/.test(s)) return 0n;
  return BigInt(s);
}

interface CombatBeat {
  kind: 'strike' | 'result';
  tableId: string;
  attacker: string;
  defender: string;
  element?: EsmsAudioElement;
  winningCard?: { suit?: any; rank?: number; isMajor?: boolean };
}

function identityKey(value: any): string {
  return String(value?.toHexString?.() ?? value?.__identity__ ?? value ?? '').replace(/^0x/i, '').toLowerCase();
}

function normalizeRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value,
  ]));
}

function compareIds(a: any, b: any): number {
  const left = BigInt(a ?? 0), right = BigInt(b ?? 0);
  return left < right ? -1 : left > right ? 1 : 0;
}

function nameKey(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^sir\s+/, '').replace(/[^a-z0-9]+/g, '-');
}

export class SpacetimeDBBridge {
  private arena: PentacleArena3D | null = null;
  private isConnected: boolean = false;
  private cleanup: Array<() => void> = [];
  private rows = new Map<TableName, Map<string, Row>>();
  private seenPlays = new Set<string>();
  private seenTricks = new Set<string>();
  private managedAgents = new Set<string>();
  private ready = false;
  private generation = 0;
  private activeTables = new Set<string>();
  private combatQueues = new Map<number, CombatBeat[]>();
  private busyZones = new Set<number>();
  private zoneListeners: Set<ZoneRowListener> = new Set();
  private agentListeners: Set<AgentChartListener> = new Set();
  private meleeListeners: Set<MeleeTableListener> = new Set();
  private timeline: CourtTimelineEvent[] = [];
  private timelineListeners: Set<TimelineEventListener> = new Set();

  /**
   * Attach active 3D Pentacle Court Arena for live pedestal updates
   */
  public attachArena(arena: PentacleArena3D): void {
    this.arena = arena;
    for (const row of this.tableRows('zone').values()) this.handleZoneUpdate(row as SpacetimeZoneRow);
    this.reconcile();
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
    this.disconnect();
    if (!client) return;
    const generation = this.generation;
    this.isConnected = true;
    // The application facade owns subscription/reconnection and emits snake-case snapshots.
    if (typeof client.subscribe === 'function' && typeof client.subscriptionBuilder !== 'function') {
      this.ready = true;
      for (const table of Object.keys(TABLE_KEYS) as TableName[]) {
        let first = true;
        let connection = client.conn;
        const stop = client.subscribe(table, (rows: Row[]) => {
          if (generation !== this.generation) return;
          if (client.conn !== connection) { connection = client.conn; first = true; }
          if (typeof client.isApplied === 'function' && !client.isApplied(table)) { first = true; return; }
          this.replaceRows(table, rows, first);
          first = false;
        });
        if (typeof stop === 'function') this.cleanup.push(stop);
      }
      return;
    }
    // A raw SDK connection uses camelCase table accessors and (ctx, oldRow, newRow).
    const handles: Array<[TableName, any]> = [];
    for (const table of Object.keys(TABLE_KEYS) as TableName[]) {
      const camelName = table.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      const handle = client.db?.[camelName] ?? client.db?.[table];
      if (!handle) continue;
      handles.push([table, handle]);
      const insert = (_ctx: any, row: Row) => {
        if (generation === this.generation) this.upsertRow(table, row);
      };
      const update = (_ctx: any, _oldRow: Row, newRow: Row) => {
        if (generation === this.generation) this.upsertRow(table, newRow);
      };
      const remove = (_ctx: any, row: Row) => {
        if (generation !== this.generation) return;
        this.tableRows(table).delete(this.rowKey(table, normalizeRow(row)));
        this.reconcile();
      };
      for (const [event, callback] of [['Insert', insert], ['Update', update], ['Delete', remove]] as const) {
        handle[`on${event}`]?.(callback);
        this.cleanup.push(() => handle[`removeOn${event}`]?.(callback));
      }
      this.replaceRows(table, Array.from(handle.iter?.() ?? []), true);
    }
    const applied = () => {
      if (generation !== this.generation) return;
      for (const [table, handle] of handles) this.replaceRows(table, Array.from(handle.iter?.() ?? []), true);
      this.ready = true;
      for (const [table] of handles) for (const row of this.tableRows(table).values()) this.notifyRow(table, row);
      this.reconcile();
    };
    if (typeof client.subscriptionBuilder === 'function') {
      const subscription = client.subscriptionBuilder().onApplied(applied)
        .subscribe(handles.map(([table]) => `SELECT * FROM ${table}`));
      this.cleanup.push(() => subscription?.unsubscribe?.());
    } else applied();
  }

  public disconnect(): void {
    this.generation++;
    for (const stop of this.cleanup.splice(0)) stop();
    this.ready = false;
    this.isConnected = false;
    this.rows.clear();
    this.seenPlays.clear();
    this.seenTricks.clear();
    this.activeTables.clear();
    this.combatQueues.clear();
    this.busyZones.clear();
    for (const key of this.managedAgents) this.arena?.removeAvatar(key);
    this.managedAgents.clear();
    this.timeline = [];
  }

  private tableRows(table: TableName): Map<string, Row> {
    let rows = this.rows.get(table);
    if (!rows) { rows = new Map(); this.rows.set(table, rows); }
    return rows;
  }

  private rowKey(table: TableName, row: Row): string {
    const pk = TABLE_KEYS[table];
    const value = row[pk] ?? (
      table === 'pentacle_conversion_escrow' ? (row.conversion_id ?? row.conversionId) :
      table === 'star_stake' ? (row.stake_id ?? row.stakeId) :
      undefined
    );
    return table === 'agent_chart' || table === 'agent_rating' || table === 'player' ? identityKey(value) : String(value ?? '');
  }

  private replaceRows(table: TableName, incoming: Row[], initial: boolean): void {
    const rows = this.tableRows(table);
    rows.clear();
    for (const input of incoming ?? []) {
      const row = normalizeRow(input);
      const key = this.rowKey(table, row);
      rows.set(key, row);
      if (initial && table === 'melee_play') this.seenPlays.add(key);
      if (initial && table === 'melee_trick') this.seenTricks.add(key);
    }
    if (this.ready) {
      for (const row of rows.values()) this.notifyRow(table, row);
      this.reconcile();
    }
  }

  private upsertRow(table: TableName, input: Row): void {
    const row = normalizeRow(input);
    const key = this.rowKey(table, row);
    this.tableRows(table).set(key, row);
    if (!this.ready && table === 'melee_play') this.seenPlays.add(key);
    if (!this.ready && table === 'melee_trick') this.seenTricks.add(key);
    if (this.ready) {
      this.notifyRow(table, row);
      this.reconcile();
    }
  }

  private notifyRow(table: TableName, row: Row): void {
    if (table === 'zone') this.handleZoneUpdate(row as SpacetimeZoneRow);
    if (table === 'agent_chart') for (const listener of this.agentListeners) listener(row as SpacetimeAgentChartRow);
    if (table === 'melee_table') for (const listener of this.meleeListeners) listener(row as SpacetimeMeleeTableRow);
    if (table === 'pentacle_conversion_escrow') this.handleConversionEscrowUpdate(row);
    if (table === 'star_stake') this.handleStarStakeUpdate(row);
  }

  private payloadForSeat(seat: Row): RatedAgentPayload | null {
    const identity = identityKey(seat.occupant);
    const chart = this.tableRows('agent_chart').get(identity) ?? this.tableRows('player').get(identity);
    if (!chart && !seat.isHuman) return null;
    const handle = chart?.handle ?? `Seeker ${identity.slice(-6)}`;
    const historical = !seat.isHuman && HISTORICAL_AGENTS.find((agent: any) => nameKey(agent.handle) === nameKey(handle));
    const key = historical?.key ?? `seeker-${identity}`;
    const faction = normalizeOwnerFaction(seat.faction) ?? historical?.faction ?? 0;
    // A chart provides identity/natal data, not ratings or holdings. Keep missing ratings explicit.
    const ratings = Object.fromEntries(SACRED_STAT_KEYS.map((stat) => [stat, 25])) as Record<SacredStatKey, number>;
    const relativeAdvantage = computeRelativeAdvantage(ratings);
    const base: RatedAgentPayload = {
      ratingSource: 'live', key, handle, faction, factionName: PLANET_NAMES[faction], isPlaceholder: true,
      provenance: historical ? 'historical' : 'user', ratings, relativeAdvantage, ovr: 25,
      archetype: resolveArchetype(relativeAdvantage), esms: { spirit: 0, essence: 0, matter: 0, substance: 0 },
      seals: [], surge: { meter: 0, active: false, surgeType: 'inferno', monica: null,
        monicaState: 'absent', heat: 0, reactivity: 0, statBoosts: {} },
    };
    // Ratings join by the actual occupant identity, never by a user-controlled human handle.
    const rating = !seat.isHuman && this.tableRows('agent_chart').has(identity)
      ? this.tableRows('agent_rating').get(identity) : undefined;
    if (rating && historical && rating.agentKey === historical.key) {
      try { return applyRatingSnapshot(base, rating.snapshotJson, Number(rating.observedAtMs)); }
      catch { /* Malformed/unsupported snapshots stay explicitly pending. */ }
    }
    return base;
  }

  private reconcile(): void {
    if (!this.ready || !this.arena) return;
    const latest = new Map<number, Row>();
    for (const table of this.tableRows('melee_table').values()) {
      const previous = latest.get(table.zoneId);
      if (!previous || compareIds(previous.tableId, table.tableId) < 0) latest.set(table.zoneId, table);
    }
    const activeTables = new Set([...latest.values()].map((table) => String(table.tableId)));
    this.activeTables = activeTables;
    const desired = new Map<string, { payload: RatedAgentPayload; zoneId: number; slot: 'owner' | 'challenger' }>();
    const seatAgents = new Map<string, string>();
    const seats = [...this.tableRows('melee_seat').values()].sort((a, b) => compareIds(a.seatId, b.seatId));
    for (const seat of seats) {
      const table = this.tableRows('melee_table').get(String(seat.tableId));
      if (!table || !activeTables.has(String(table.tableId))) continue;
      const payload = this.payloadForSeat(seat);
      if (!payload) continue;
      seatAgents.set(String(seat.seatId), payload.key);
      const sameZone = [...desired.values()].some((value) => value.zoneId === table.zoneId);
      const owner = this.arena.zones.get(table.zoneId)?.owner;
      const slot = !sameZone || owner === payload.faction ? 'owner' : 'challenger';
      // If a retained seat briefly exists in two rounds, the newer table wins.
      desired.set(payload.key, { payload, zoneId: table.zoneId, slot });
    }
    for (const key of this.managedAgents) if (!desired.has(key)) this.arena.removeAvatar(key);
    this.managedAgents = new Set(desired.keys());
    for (const [key, target] of desired) {
      const registered = this.arena.avatarRegistry.get(key);
      if (!registered) {
        this.arena.placeAvatarOnZone(target.zoneId, target.payload, target.slot);
        this.recordTimelineEvent({
          type: 'arrival',
          zoneId: target.zoneId,
          agentKey: target.payload.key,
          agentHandle: target.payload.handle,
          faction: target.payload.faction,
          targetZoneId: target.zoneId,
          summary: `${target.payload.handle} arrived at ${getZoneTitle(target.zoneId)}`,
          detail: `Took ${target.slot} position in ${getZoneTitle(target.zoneId)}`,
        });
      } else {
        if (JSON.stringify(registered.payload) !== JSON.stringify(target.payload)) {
          const oldOvr = registered.payload.ovr;
          const newOvr = target.payload.ovr;
          const transitDelta = newOvr - oldOvr;
          this.arena.refreshAvatar(target.payload);
          if (transitDelta !== 0) {
            this.recordTimelineEvent({
              type: 'rating',
              zoneId: target.zoneId,
              agentKey: target.payload.key,
              agentHandle: target.payload.handle,
              faction: target.payload.faction,
              ovrBefore: oldOvr,
              ovrAfter: newOvr,
              transitDelta,
              summary: transitDelta > 0
                ? `${target.payload.handle} rating surged +${transitDelta} (OVR ${newOvr})`
                : `${target.payload.handle} rating staggered ${transitDelta} (OVR ${newOvr})`,
              detail: `Alchemical rating shift in ${getZoneTitle(target.zoneId)}`,
            });
          }
        }
        const currentZoneId = registered.targetZoneId ?? registered.group.userData.zoneId;
        if (currentZoneId !== target.zoneId) {
          void this.arena.moveAvatarToZone(key, target.zoneId, 900, target.slot);
          this.recordTimelineEvent({
            type: 'arrival',
            zoneId: target.zoneId,
            fromZoneId: currentZoneId,
            targetZoneId: target.zoneId,
            agentKey: target.payload.key,
            agentHandle: target.payload.handle,
            faction: target.payload.faction,
            summary: `${target.payload.handle} deployed to ${getZoneTitle(target.zoneId)}`,
            detail: `Relocated from ${getZoneTitle(currentZoneId)} to ${getZoneTitle(target.zoneId)}`,
          });
        }
      }
    }
    this.dispatchCombat(seatAgents, activeTables);
  }

  private dispatchCombat(seatAgents: Map<string, string>, activeTables: Set<string>): void {
    if (!this.arena) return;
    const plays = [...this.tableRows('melee_play').values()].sort((a, b) => compareIds(a.playId, b.playId));
    for (const play of plays) {
      const key = String(play.playId);
      if (this.seenPlays.has(key)) continue;
      if (!activeTables.has(String(play.tableId))) { this.seenPlays.add(key); continue; }
      const table = this.tableRows('melee_table').get(String(play.tableId));
      const attacker = seatAgents.get(String(play.seatId));
      const rival = [...seatAgents.entries()].find(([seatId, agent]) => agent !== attacker &&
        String(this.tableRows('melee_seat').get(seatId)?.tableId) === String(play.tableId));
      if (!table || !attacker || !rival) continue;
      this.seenPlays.add(key);
      const element = play.suit != null ? suitToEsmsElement(play.suit) : undefined;
      this.enqueueCombat(table.zoneId, {
        kind: 'strike',
        tableId: String(play.tableId),
        attacker,
        defender: rival[1],
        element,
      });
      const attackerPayload = this.arena.avatarRegistry.get(attacker)?.payload;
      const defenderPayload = this.arena.avatarRegistry.get(rival[1])?.payload;
      const attackerHandle = attackerPayload?.handle ?? attacker;
      const defenderHandle = defenderPayload?.handle ?? rival[1];
      const zoneTitle = getZoneTitle(table.zoneId);
      this.recordTimelineEvent({
        type: 'contest',
        zoneId: table.zoneId,
        agentKey: attacker,
        agentHandle: attackerHandle,
        faction: attackerPayload?.faction ?? 0,
        rivalKey: rival[1],
        rivalHandle: defenderHandle,
        rivalFaction: defenderPayload?.faction ?? 0,
        summary: `${attackerHandle} engaged ${defenderHandle} in ${zoneTitle}`,
        detail: `Card strike in round ${Number(table.roundIndex ?? 1) + 1} contesting territory control`,
      });
    }
    const tricks = [...this.tableRows('melee_trick').values()].sort((a, b) => compareIds(a.trickId, b.trickId));
    for (const trick of tricks) {
      const key = String(trick.trickId);
      if (this.seenTricks.has(key)) continue;
      if (!activeTables.has(String(trick.tableId))) { this.seenTricks.add(key); continue; }
      const table = this.tableRows('melee_table').get(String(trick.tableId));
      const winner = seatAgents.get(String(trick.winnerSeat));
      const lastRival = [...plays].reverse().find((play) => String(play.tableId) === String(trick.tableId) &&
        String(play.trickNumber) === String(trick.trickNumber) && String(play.seatId) !== String(trick.winnerSeat));
      const rival = lastRival && seatAgents.get(String(lastRival.seatId));
      if (!table || !winner || !rival) continue;
      this.seenTricks.add(key);
      const winningPlay = [...plays].find((play) => String(play.tableId) === String(trick.tableId) &&
        String(play.trickNumber) === String(trick.trickNumber) && String(play.seatId) === String(trick.winnerSeat));
      const rawSuit = winningPlay?.suit ?? trick.ledSuit;
      const element = rawSuit != null ? suitToEsmsElement(rawSuit) : undefined;
      const suitName = rawSuit != null ? suitToSuitName(rawSuit) : undefined;
      this.enqueueCombat(table.zoneId, {
        kind: 'result',
        tableId: String(trick.tableId),
        attacker: winner,
        defender: rival,
        element,
        winningCard: winningPlay ? { suit: winningPlay.suit, rank: winningPlay.rank, isMajor: winningPlay.isMajor } : undefined,
      });
      const winnerPayload = this.arena.avatarRegistry.get(winner)?.payload;
      const rivalPayload = this.arena.avatarRegistry.get(rival)?.payload;
      const winnerHandle = winnerPayload?.handle ?? winner;
      const rivalHandle = rivalPayload?.handle ?? rival;
      this.recordTimelineEvent({
        type: 'contest',
        zoneId: table.zoneId,
        agentKey: winner,
        agentHandle: winnerHandle,
        faction: winnerPayload?.faction ?? 0,
        rivalKey: rival,
        rivalHandle: rivalHandle,
        rivalFaction: rivalPayload?.faction ?? 0,
        summary: suitName
          ? `${winnerHandle} triumphed over ${rivalHandle} in trick ${trick.trickNumber} (${suitName})`
          : `${winnerHandle} triumphed over ${rivalHandle} in trick ${trick.trickNumber}`,
        detail: element
          ? `Secured trick momentum for ${getZoneTitle(table.zoneId)} with ${element.toUpperCase()} elemental clash`
          : `Secured trick momentum for ${getZoneTitle(table.zoneId)}`,
      });
    }
  }

  private enqueueCombat(zoneId: number, beat: CombatBeat): void {
    const queue = this.combatQueues.get(zoneId) ?? [];
    queue.push(beat);
    this.combatQueues.set(zoneId, queue);
    this.playNextCombat(zoneId);
  }

  private playNextCombat(zoneId: number): void {
    if (!this.arena || this.busyZones.has(zoneId)) return;
    const queue = this.combatQueues.get(zoneId);
    let beat = queue?.shift();
    while (beat && (!this.activeTables.has(beat.tableId) ||
      !this.arena.avatarRegistry.has(beat.attacker) || !this.arena.avatarRegistry.has(beat.defender))) beat = queue?.shift();
    if (!beat) { this.combatQueues.delete(zoneId); return; }
    this.busyZones.add(zoneId);
    const generation = this.generation;
    const finished = () => {
      if (generation !== this.generation) return;
      this.busyZones.delete(zoneId);
      this.playNextCombat(zoneId);
    };
    // Snapshot batches often contain several plays. Let each visual beat finish before the next.
    const animation = beat.kind === 'result'
      ? (beat.element !== undefined ? this.arena.animateTrickOutcome(zoneId, beat.attacker, beat.defender, beat.element) : this.arena.animateTrickOutcome(zoneId, beat.attacker, beat.defender))
      : (beat.element !== undefined ? this.arena.animateZoneContest(zoneId, beat.attacker, beat.defender, beat.element) : this.arena.animateZoneContest(zoneId, beat.attacker, beat.defender));
    animation.then(finished, finished);
  }

  /**
   * Directly dispatch a confirmed trick outcome for live table melee choreography
   */
  public dispatchTrickResolution(
    zoneOrOptions: number | {
      zoneId?: number;
      winnerKey?: string;
      winnerAgentId?: string;
      rivalKey?: string;
      loserAgentId?: string;
      suit?: 'wands' | 'cups' | 'swords' | 'pentacles' | string;
      winningSuit?: 'wands' | 'cups' | 'swords' | 'pentacles' | string;
      trickNumber?: number;
    },
    winnerKeyArg?: string,
    rivalKeyArg?: string,
    suitArg: 'wands' | 'cups' | 'swords' | 'pentacles' | string = 'wands',
    trickNumberArg = 1
  ): Promise<void> {
    let zoneId: number;
    let winnerKey: string;
    let rivalKey: string;
    let suit: string;
    let trickNumber: number;

    if (typeof zoneOrOptions === 'object' && zoneOrOptions !== null) {
      zoneId = Number(zoneOrOptions.zoneId ?? 0);
      winnerKey = String(zoneOrOptions.winnerKey ?? zoneOrOptions.winnerAgentId ?? '');
      rivalKey = String(zoneOrOptions.rivalKey ?? zoneOrOptions.loserAgentId ?? '');
      suit = String(zoneOrOptions.suit ?? zoneOrOptions.winningSuit ?? 'wands');
      trickNumber = Number(zoneOrOptions.trickNumber ?? 1);
    } else {
      zoneId = Number(zoneOrOptions);
      winnerKey = String(winnerKeyArg ?? '');
      rivalKey = String(rivalKeyArg ?? '');
      suit = String(suitArg ?? 'wands');
      trickNumber = Number(trickNumberArg ?? 1);
    }

    const element = suitToEsmsElement(suit);
    const suitName = suitToSuitName(suit);
    const winner = this.arena?.avatarRegistry.get(winnerKey)?.payload;
    const rival = this.arena?.avatarRegistry.get(rivalKey)?.payload;
    const winnerHandle = winner?.handle ?? winnerKey;
    const rivalHandle = rival?.handle ?? rivalKey;
    this.recordTimelineEvent({
      type: 'contest',
      zoneId,
      agentKey: winnerKey,
      agentHandle: winnerHandle,
      faction: winner?.faction ?? 0,
      rivalKey,
      rivalHandle,
      rivalFaction: rival?.faction ?? 0,
      summary: `${winnerHandle} triumphed over ${rivalHandle} in trick ${trickNumber} (${suitName})`,
      detail: `Secured trick momentum for ${getZoneTitle(zoneId)} with ${element.toUpperCase()} elemental clash`,
    });

    if (!this.arena) return Promise.resolve();

    const winnerReg = this.arena.avatarRegistry.get(winnerKey);
    const rivalReg = this.arena.avatarRegistry.get(rivalKey);

    if (winnerReg && rivalReg && winnerReg.zoneId === zoneId && rivalReg.zoneId === zoneId &&
        !this.arena.travels.has(winnerKey) && !this.arena.travels.has(rivalKey)) {
      return this.arena.animateTrickOutcome(zoneId, winnerKey, rivalKey, element);
    }

    return this.arena.animateZoneContest(zoneId, winnerKey, rivalKey, element);
  }

  /**
   * Handle incoming Pentacle ↔ ESMS conversion escrow updates from SpacetimeDB
   */
  public handleConversionEscrowUpdate(row: Row): void {
    const status = String(row.status ?? '').toLowerCase();
    if (status !== 'settled') return;
    const conversionId = String(row.conversionId ?? row.conversion_id ?? row.escrowId ?? 'unknown');
    const identity = identityKey(row.identity ?? row.agentId);
    const rawAtoms = row.atoms ?? [];

    const spiritAtoms = parseAtomBigInt(rawAtoms[0] ?? row.spiritAtoms);
    const essenceAtoms = parseAtomBigInt(rawAtoms[1] ?? row.essenceAtoms);
    const matterAtoms = parseAtomBigInt(rawAtoms[2] ?? row.matterAtoms);
    const substanceAtoms = parseAtomBigInt(rawAtoms[3] ?? row.substanceAtoms);

    const formatAtom = (val: bigint) => {
      if (val >= 10n ** 10n) {
        return (Number(val / 10n ** 14n) / 10000).toFixed(4);
      }
      return (Number(val) / 10000).toFixed(4);
    };

    const atomsSummary = `Spirit: ${formatAtom(spiritAtoms)}, Essence: ${formatAtom(essenceAtoms)}, Matter: ${formatAtom(matterAtoms)}, Substance: ${formatAtom(substanceAtoms)}`;

    let matchedAgent: RatedAgentPayload | null = null;
    let agentKey = identity;
    if (this.arena) {
      for (const [key, reg] of this.arena.avatarRegistry) {
        if (identityKey(reg.payload.key) === identity || key === identity) {
          matchedAgent = reg.payload;
          agentKey = key;
          break;
        }
      }
    }
    if (!matchedAgent) {
      for (const [key, cached] of liveWalletSync.getCachedAgents()) {
        if (identityKey(key) === identity || key === identity) {
          matchedAgent = cached;
          agentKey = key;
          break;
        }
      }
    }

    const agentHandle = matchedAgent?.handle ?? (identity.length > 12 ? `Wallet ${identity.slice(0, 6)}...${identity.slice(-4)}` : (identity || 'Unknown'));
    const faction = matchedAgent?.faction ?? 0;

    this.recordTimelineEvent({
      type: 'rating',
      agentKey,
      agentHandle,
      faction,
      summary: `Pentacle conversion ${conversionId} settled on Solana`,
      detail: `Settled Token-2022 conversion escrow with ${atomsSummary}`,
    });

    const toTokens = (val: bigint) => (val >= 10n ** 10n ? Number(val / 10n ** 14n) / 10000 : Number(val) / 10000);
    const esmsBalances: EsmsBalances = {
      spirit: toTokens(spiritAtoms),
      essence: toTokens(essenceAtoms),
      matter: toTokens(matterAtoms),
      substance: toTokens(substanceAtoms),
    };

    if (agentKey) {
      const updated = liveWalletSync.syncAgentEsmsFromSpacetime(agentKey, esmsBalances);
      if (updated && this.arena?.avatarRegistry.has(agentKey)) {
        this.arena.refreshAvatar(updated);
      }
    }
  }

  /**
   * Handle incoming Star Stake updates from SpacetimeDB
   */
  public handleStarStakeUpdate(row: Row): void {
    const stakeId = String(row.stakeId ?? row.stake_id ?? '0');
    const stakerKey = identityKey(row.staker ?? row.stakerIdentity);
    const starId = String(row.starId ?? row.star_id ?? '0');
    const principalRaw = parseAtomBigInt(row.usdcPrincipalMicros ?? row.principalUsdc ?? row.principal_usdc ?? 0);
    const principalUsdc = (Number(principalRaw) / 1e6).toFixed(2);
    const claimedRaw = parseAtomBigInt(row.claimedEssenceAtoms ?? row.claimedEssence ?? row.claimed_essence ?? 0);
    const elementId = Number(row.element ?? 0);
    const elementNames = ['Spirit', 'Essence', 'Matter', 'Substance'];
    const elementName = elementNames[elementId] ?? 'Spirit';

    let matchedAgent: RatedAgentPayload | null = null;
    let agentKey = stakerKey;
    if (this.arena) {
      for (const [key, reg] of this.arena.avatarRegistry) {
        if (identityKey(reg.payload.key) === stakerKey || key === stakerKey) {
          matchedAgent = reg.payload;
          agentKey = key;
          break;
        }
      }
    }

    const agentHandle = matchedAgent?.handle ?? (stakerKey.length > 12 ? `Staker ${stakerKey.slice(0, 6)}...${stakerKey.slice(-4)}` : (stakerKey || 'Staker'));
    const faction = matchedAgent?.faction ?? elementId;

    this.recordTimelineEvent({
      type: 'rating',
      agentKey,
      agentHandle,
      faction,
      summary: `Star stake #${stakeId} updated for star ${starId}`,
      detail: `Principal: ${principalUsdc} USDC | Claimed: ${(claimedRaw / 10n ** 14n).toString()} atoms (${elementName})`,
    });
  }

  /**
   * Directly dispatch a confirmed Pentacle ↔ ESMS conversion escrow settlement on Solana
   */
  public dispatchConversionSettlement(
    conversionOrOptions: string | {
      conversionId?: string;
      escrowId?: string;
      identity?: string;
      agentId?: string;
      atoms?: Array<string | number | bigint>;
      spiritAtoms?: string | number | bigint;
      essenceAtoms?: string | number | bigint;
      matterAtoms?: string | number | bigint;
      substanceAtoms?: string | number | bigint;
      status?: 'settled' | 'escrowed' | 'refunded' | string;
    },
    identityArg?: string,
    atomsArg?: Array<string | number | bigint>,
    statusArg: 'settled' | 'escrowed' | 'refunded' | string = 'settled'
  ): void {
    if (typeof conversionOrOptions === 'object' && conversionOrOptions !== null) {
      const opts = conversionOrOptions;
      const conversionId = String(opts.conversionId ?? opts.escrowId ?? 'conversion-live');
      const identity = String(opts.identity ?? opts.agentId ?? '');
      const atoms = opts.atoms
        ? opts.atoms.map(String)
        : [
            String(opts.spiritAtoms ?? 0),
            String(opts.essenceAtoms ?? 0),
            String(opts.matterAtoms ?? 0),
            String(opts.substanceAtoms ?? 0),
          ];
      const status = String(opts.status ?? 'settled');
      this.handleConversionEscrowUpdate({
        conversionId,
        identity,
        atoms,
        spiritAtoms: opts.spiritAtoms,
        essenceAtoms: opts.essenceAtoms,
        matterAtoms: opts.matterAtoms,
        substanceAtoms: opts.substanceAtoms,
        status,
      });
    } else {
      const conversionId = String(conversionOrOptions);
      const identity = String(identityArg ?? '');
      const atoms = (atomsArg ?? []).map(String);
      const status = String(statusArg ?? 'settled');
      this.handleConversionEscrowUpdate({
        conversionId,
        identity,
        atoms,
        status,
      });
    }
  }

  /**
   * Directly dispatch a star staking position update on Solana
   */
  public dispatchStarStakeUpdate(
    stakeOrOptions: string | number | {
      stakeId?: string | number;
      staker?: string;
      stakerIdentity?: string;
      starId?: string | number;
      principalUsdc?: string | number | bigint;
      usdcPrincipalMicros?: string | number | bigint;
      claimedEssence?: string | number | bigint;
      claimedEssenceAtoms?: string | number | bigint;
      element?: number;
    },
    stakerArg?: string,
    starIdArg?: string | number,
    principalUsdcArg?: string | number | bigint,
    claimedEssenceArg: string | number | bigint = 0n,
    elementArg = 0
  ): void {
    if (typeof stakeOrOptions === 'object' && stakeOrOptions !== null) {
      const opts = stakeOrOptions;
      this.handleStarStakeUpdate({
        stakeId: opts.stakeId ?? 0,
        staker: opts.staker ?? opts.stakerIdentity ?? '',
        starId: opts.starId ?? 0,
        principalUsdc: String(opts.usdcPrincipalMicros ?? opts.principalUsdc ?? 0),
        claimedEssence: String(opts.claimedEssenceAtoms ?? opts.claimedEssence ?? 0),
        element: opts.element ?? 0,
      });
    } else {
      this.handleStarStakeUpdate({
        stakeId: stakeOrOptions,
        staker: stakerArg ?? '',
        starId: starIdArg ?? 0,
        principalUsdc: String(principalUsdcArg ?? 0),
        claimedEssence: String(claimedEssenceArg ?? 0),
        element: elementArg,
      });
    }
  }

  /**
   * Handles incoming Zone row update from SpacetimeDB
   */
  public handleZoneUpdate(row: SpacetimeZoneRow): void {
    this.tableRows('zone').set(String(row.zoneId), row);
    const ownerFaction = normalizeOwnerFaction(row.owner);

    // Update 3D arena if attached
    if (this.arena) {
      this.arena.updateZoneStatus(row.zoneId, ownerFaction, row.control, row.inFlux, row.fluxLevel);
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
    this.tableRows('agent_chart').set(identityKey(chart.identity), chart);
    this.reconcile();
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
    this.tableRows('melee_table').set(String(table.tableId), table);
    this.reconcile();
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

  public getTimeline(): CourtTimelineEvent[] {
    return [...this.timeline];
  }

  public onTimelineEvent(listener: TimelineEventListener): () => void {
    this.timelineListeners.add(listener);
    return () => this.timelineListeners.delete(listener);
  }

  public recordTimelineEvent(
    event: Omit<CourtTimelineEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number }
  ): CourtTimelineEvent {
    const fullEvent: CourtTimelineEvent = {
      id: event.id ?? `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: event.timestamp ?? Date.now(),
      ...event,
    };
    this.timeline.unshift(fullEvent);
    if (this.timeline.length > 50) this.timeline.pop();
    for (const listener of this.timelineListeners) {
      try {
        listener(fullEvent);
      } catch (err) {
        console.error('[SpacetimeDBBridge] Timeline listener error:', err);
      }
    }
    return fullEvent;
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
pub const SEAL_MULT_ASTRAL: i32 = 1160;    // 1.16x
pub const SEAL_MULT_CELESTIAL: i32 = 1250; // 1.25x

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SealTier {
    Copper,
    Silver,
    Gold,
    Astral,
    Celestial,
}

impl SealTier {
    pub fn multiplier_scale_1000(&self) -> i32 {
        match self {
            SealTier::Copper => SEAL_MULT_COPPER,
            SealTier::Silver => SEAL_MULT_SILVER,
            SealTier::Gold => SEAL_MULT_GOLD,
            SealTier::Astral => SEAL_MULT_ASTRAL,
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
    Astral: 1160,
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

export let spacetimeCourtBridge: SpacetimeDBBridge | null = null;

export function setGlobalSpacetimeCourtBridge(bridge: SpacetimeDBBridge | null): void {
  spacetimeCourtBridge = bridge;
  if (typeof window !== 'undefined') {
    (window as any).spacetimeCourtBridge = bridge;
    (window as any).__pentacleCourtBridge = bridge;
  }
}

export default {
  get current() {
    return spacetimeCourtBridge;
  },
  dispatchTrickResolution(...args: any[]) {
    return (spacetimeCourtBridge?.dispatchTrickResolution as any)?.(...args);
  },
  dispatchConversionSettlement(...args: any[]) {
    return (spacetimeCourtBridge?.dispatchConversionSettlement as any)?.(...args);
  },
  dispatchStarStakeUpdate(...args: any[]) {
    return (spacetimeCourtBridge?.dispatchStarStakeUpdate as any)?.(...args);
  },
};
