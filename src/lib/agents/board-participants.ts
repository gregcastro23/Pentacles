import { HISTORICAL_AGENTS, PLANET_NAMES } from '../../alchm-chart/historical-agents.js';
import { normalizeOwnerFaction } from './spacetimedb-bridge';
import { applyRatingSnapshot } from './agent-rating-feed';
import { SACRED_STAT_KEYS, computeRelativeAdvantage, resolveArchetype, type RatedAgentPayload } from './rating-contract';

type Row = Record<string, any>;
export type BoardSource = 'live' | 'offline' | 'syncing';
export interface BoardParticipant {
  id: string;
  tableId: string;
  seatId: string;
  zoneId: number;
  score: number | null;
  payload: RatedAgentPayload;
}
export interface BoardTables { melee_table: Row[]; melee_seat: Row[]; agent_chart: Row[]; agent_rating: Row[] }
export const boardZoneName = (id: number) => id === 10 ? 'Crown Zenith' : `${id < 5 ? 'House' : 'Spire'} ${id}`;
const identity = (value: any): string => String(value?.toHexString?.() ?? value?.__identity__ ?? value ?? '').replace(/^0x/i, '').toLowerCase();
const field = (row: Row, snake: string, camel: string) => row[snake] ?? row[camel];
const enumName = (value: any): string => String(typeof value === 'object' && value ? value.tag ?? Object.keys(value)[0] : value ?? '').toLowerCase();
const nameKey = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^sir\s+/, '').replace(/[^a-z0-9]+/g, '-');
const historicalByName = new Map(HISTORICAL_AGENTS.map((agent: any) => [nameKey(agent.handle), agent]));
const rowId = (value: any): string | null => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
  return /^(0|[1-9][0-9]*)$/.test(String(value)) ? String(value) : null;
};
const byId = (a: string, b: string): number => BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0;

/** An avatar is an actual non-human seat at a currently active table, never a zone owner. */
export function resolveBoardParticipants(rows: BoardTables): BoardParticipant[] {
  const tables = new Map<string, Row>();
  for (const row of rows.melee_table) {
    const id = rowId(field(row, 'table_id', 'tableId'));
    const zone = field(row, 'zone_id', 'zoneId');
    if (id !== null && Number.isInteger(zone) && zone >= 0 && zone <= 10
      && ['mustering', 'seated'].includes(enumName(row.state))) tables.set(id, row);
  }
  const charts = new Map(rows.agent_chart.map(row => [identity(row.identity), row]));
  const ratings = new Map(rows.agent_rating.map(row => [identity(row.identity), row]));
  const result = new Map<string, BoardParticipant>();
  for (const seat of rows.melee_seat) {
    if (field(seat, 'is_human', 'isHuman') !== false) continue;
    const tableId = rowId(field(seat, 'table_id', 'tableId')), seatId = rowId(field(seat, 'seat_id', 'seatId'));
    if (tableId === null || seatId === null) continue;
    const table = tables.get(tableId), occupant = identity(seat.occupant);
    const chart = charts.get(occupant);
    if (!table || !occupant || typeof chart?.handle !== 'string') continue;
    const historical = historicalByName.get(nameKey(chart.handle)) as any;
    if (!historical) continue;
    const faction = normalizeOwnerFaction(seat.faction) ?? historical.faction;
    const stats = Object.fromEntries(SACRED_STAT_KEYS.map(key => [key, 25])) as RatedAgentPayload['ratings'];
    const relativeAdvantage = computeRelativeAdvantage(stats);
    let payload: RatedAgentPayload = {
      key: historical.key, handle: historical.handle, faction, factionName: PLANET_NAMES[faction],
      ratingSource: 'live', provenance: 'historical', isPlaceholder: true,
      ratings: stats, relativeAdvantage, ovr: 25, archetype: resolveArchetype(relativeAdvantage),
      esms: { spirit: 0, essence: 0, matter: 0, substance: 0 }, seals: [],
      surge: { meter: 0, active: false, surgeType: 'inferno', monica: null, monicaState: 'absent', heat: 0, reactivity: 0, statBoosts: {} },
    };
    // Identity join prevents a matching handle or agent key from borrowing another seat's rating.
    const rating = ratings.get(occupant);
    if (rating && field(rating, 'agent_key', 'agentKey') === historical.key) {
      try {
        const rated = applyRatingSnapshot(payload, field(rating, 'snapshot_json', 'snapshotJson'), Number(field(rating, 'observed_at_ms', 'observedAtMs')));
        if (rated.ratingFeed?.sourceKey === historical.key) payload = rated;
      } catch { /* Missing or invalid measurements stay pending. */ }
    }
    const id = `${tableId}:${seatId}`;
    result.set(id, { id, tableId, seatId, zoneId: field(table, 'zone_id', 'zoneId'), payload,
      score: typeof seat.score === 'number' && Number.isFinite(seat.score) ? seat.score : null });
  }
  return [...result.values()].sort((a, b) => a.zoneId - b.zoneId || byId(a.tableId, b.tableId) || byId(a.seatId, b.seatId));
}

const emptyTables = (): BoardTables => ({ melee_table: [], melee_seat: [], agent_chart: [], agent_rating: [] });
const required = ['melee_table', 'melee_seat', 'agent_chart'] as const;
/** Subscription-only positions. No fabricated offline participants or ownership-based fallback. */
export class BoardParticipantFeed {
  private rows = emptyTables();
  private applied = new Set<string>();
  private stops: Array<() => void> = [];
  private destroyed = false;
  private connection: any;
  constructor(private client: any, private changed: (participants: BoardParticipant[], source: BoardSource) => void) {
    this.connection = client?.conn;
    this.publish();
    if (!client) return;
    const stop = client.onStatus?.(() => { this.reset(); this.publish(); });
    if (stop) this.stops.push(stop);
    for (const table of [...required, 'agent_rating'] as const) {
      this.stops.push(client.subscribe(table, (rows: Row[]) => {
        if (this.destroyed) return;
        if (this.connection !== client.conn) this.reset();
        if (!client.isLive) { this.reset(); this.publish(); return; }
        if (client.isApplied && !client.isApplied(table)) {
          this.applied.delete(table); this.rows[table] = []; this.publish(); return;
        }
        this.rows[table] = rows; this.applied.add(table); this.publish();
      }));
    }
  }
  private reset(): void { this.rows = emptyTables(); this.applied.clear(); this.connection = this.client?.conn; }
  private publish(): void {
    if (this.destroyed) return;
    const source: BoardSource = !this.client?.isLive ? 'offline' : required.every(t => this.applied.has(t)) ? 'live' : 'syncing';
    this.changed(source === 'live' ? resolveBoardParticipants(this.rows) : [], source);
  }
  destroy(): void { this.destroyed = true; this.stops.splice(0).forEach(stop => stop?.()); }
}

/** Match SVG xMidYMid meet, including rectangular map containers. */
export function boardViewport(width: number, height: number) {
  const size = Math.min(width, height);
  return { size, left: (width - size) / 2, top: (height - size) / 2, unit: size / 600 };
}

/** Seat positions inside the real pentagram polygons, projected by the sky camera. */
export function boardSeatDirections(zoneId: number, count: number): Array<{ alt: number; az: number }> {
  if (!Number.isInteger(zoneId) || zoneId < 0 || zoneId > 10 || !Number.isInteger(count) || count < 1) return [];
  const polar = (r: number, az: number) => [r * Math.sin(az * Math.PI / 180), r * Math.cos(az * Math.PI / 180)];
  const tips = Array.from({ length: 5 }, (_, i) => polar(1, i * 72));
  const inner = Array.from({ length: 5 }, (_, i) => polar(0.381966, i * 72 + 36));
  const polygon = zoneId >= 5 && zoneId < 10 ? [tips[zoneId - 5], inner[(zoneId - 1) % 5], inner[zoneId - 5]]
    : zoneId < 5 ? [inner[zoneId], tips[zoneId], tips[(zoneId + 1) % 5]] : inner;
  let points: number[][];
  if (zoneId === 10) points = count === 1 ? [[0, 0]] : Array.from({ length: count }, (_, i) => polar(.23, i * 360 / count));
  else {
    const weights = count === 1 ? [[1/3,1/3,1/3]] : count === 2 ? [[.3,.58,.12],[.3,.12,.58]]
      : count === 3 ? [[.68,.16,.16],[.16,.68,.16],[.16,.16,.68]]
      : [[.7,.15,.15],[.4,.515,.085],[.4,.085,.515],[.08,.82,.1],[.08,.46,.46],[.08,.1,.82]];
    // The server permits at most six seats per table. Additional seats still get
    // distinct interior positions if a future schema raises that limit.
    points = Array.from({ length: count }, (_, i) => {
      const w = weights[i] ?? [0.2 + 0.4 * (i % 3) / 3, 0.1 + 0.3 * ((i * .618034) % 1)];
      const bary = w.length === 3 ? w : [w[0], w[1], 1 - w[0] - w[1]];
      return [0,1].map(axis => polygon.reduce((sum, p, index) => sum + p[axis] * bary[index], 0));
    });
  }
  return points.map(([x,y]) => ({ alt: 90 * (1 - Math.hypot(x,y)), az: (Math.atan2(x,y) * 180 / Math.PI + 360) % 360 }));
}
