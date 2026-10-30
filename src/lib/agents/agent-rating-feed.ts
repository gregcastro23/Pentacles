/** Public NPC-only wire contract shared by the feeder and the court. */
import {
  SACRED_STAT_KEYS, ESMS_KEYS, SEAL_TIERS, SEAL_TIER_MULTIPLIERS,
  computeOvr, computeRelativeAdvantage, resolveArchetype,
  type RatedAgentPayload, type AlchemicalSeal, type ResonanceSurgeState,
} from './rating-contract';

export const RATING_MAX_AGE_MS = 5 * 60_000;
export const RATING_MAX_BYTES = 32_768;
export const SOURCE_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/;
export interface AgentRatingSnapshot {
  version: 1;
  sourceKey: string;
  chartPlaceholder: boolean;
  ratings: number[];
  esms: number[];
  esmsSource: 'database' | 'spacetimedb' | 'unavailable';
  seals: AlchemicalSeal[];
  surge: ResonanceSurgeState | null;
}
const record = (v: any): v is Record<string, any> => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: any, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const short = (v: any, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
const stat = (v: any) => SACRED_STAT_KEYS.includes(v);
function requireValue(ok: boolean, message: string): asserts ok {
  if (!ok) throw new Error(`Invalid agent rating: ${message}`);
}
function sealsFrom(value: any): AlchemicalSeal[] {
  requireValue(Array.isArray(value) && value.length <= 32, 'seals');
  return value.map((s: any) => {
    requireValue(record(s) && short(s.id, 100) && short(s.name, 120) && short(s.description, 500)
      && [...ESMS_KEYS, 'general'].includes(s.category) && SEAL_TIERS.includes(s.tier)
      && (s.statKey === undefined || stat(s.statKey))
      && s.multiplier === SEAL_TIER_MULTIPLIERS[s.tier as keyof typeof SEAL_TIER_MULTIPLIERS], 'seal');
    return { id: s.id, name: s.name, description: s.description, category: s.category,
      tier: s.tier, multiplier: s.multiplier, ...(s.statKey ? { statKey: s.statKey } : {}) };
  });
}
function surgeFrom(s: any): ResonanceSurgeState | null {
  if (s === null) return null;
  requireValue(record(s) && finite(s.meter, 0, 100) && typeof s.active === 'boolean'
    && s.active === (s.meter >= 70) && ['inferno', 'tempest', 'equilibrium'].includes(s.surgeType)
    && (s.monica === null || finite(s.monica, -1e12, 1e12))
    && ['absent', 'equilibrium', 'convergent', 'divergent'].includes(s.monicaState)
    && finite(s.heat, 0, 1) && finite(s.reactivity, 0, 1) && record(s.statBoosts)
    && Object.entries(s.statBoosts).every(([key, value]) => stat(key) && finite(value, 0, 100)), 'surge');
  return { meter: s.meter, active: s.active, surgeType: s.surgeType, monica: s.monica,
    monicaState: s.monicaState, heat: s.heat, reactivity: s.reactivity, statBoosts: { ...s.statBoosts } };
}

/** Strict, bounded projection: never copy wallet, natal, appearance URLs or arbitrary fields. */
export function normalizeApiRating(input: unknown, expectedKey: string): AgentRatingSnapshot {
  const p = input as any;
  requireValue(record(p) && p.key === expectedKey && SOURCE_KEY.test(expectedKey)
    && ['historical', 'placeholder'].includes(p.provenance) && typeof p.isPlaceholder === 'boolean', 'historical identity');
  requireValue(record(p.ratings) && record(p.esms), 'stats and balances');
  const ratings = SACRED_STAT_KEYS.map(k => p.ratings[k]);
  requireValue(ratings.every(v => Number.isInteger(v) && finite(v, 25, 99)), '25–99 ratings');
  requireValue(p.ovr === computeOvr(p.ratings), 'OWA overall');
  requireValue(['database', 'spacetimedb', 'fallback'].includes(p.esmsSource), 'ESMS source');
  const esmsAvailable = p.esmsSource !== 'fallback' && !p.degraded?.esms;
  const snapshot: AgentRatingSnapshot = {
    version: 1, sourceKey: expectedKey, chartPlaceholder: p.isPlaceholder, ratings,
    esms: esmsAvailable ? ESMS_KEYS.map(k => p.esms[k]) : [0, 0, 0, 0],
    esmsSource: esmsAvailable ? p.esmsSource : 'unavailable',
    seals: esmsAvailable ? sealsFrom(p.seals) : [],
    surge: p.degraded?.sky ? null : surgeFrom(p.surge),
  };
  return parseRatingSnapshot(JSON.stringify(snapshot));
}

export function parseRatingSnapshot(json: string): AgentRatingSnapshot {
  requireValue(typeof json === 'string' && new TextEncoder().encode(json).length <= RATING_MAX_BYTES, 'size');
  const p = JSON.parse(json);
  requireValue(record(p) && p.version === 1 && typeof p.sourceKey === 'string' && SOURCE_KEY.test(p.sourceKey)
    && typeof p.chartPlaceholder === 'boolean', 'snapshot version/identity');
  requireValue(Array.isArray(p.ratings) && p.ratings.length === 7
    && p.ratings.every((v: any) => Number.isInteger(v) && finite(v, 25, 99)), 'ratings');
  requireValue(Array.isArray(p.esms) && p.esms.length === 4
    && p.esms.every((v: any) => finite(v, 0, Number.MAX_SAFE_INTEGER)), 'balances');
  requireValue(['database', 'spacetimedb', 'unavailable'].includes(p.esmsSource), 'ESMS source');
  const seals = sealsFrom(p.seals);
  requireValue(!p.chartPlaceholder || seals.every(s => s.tier !== 'Celestial'), 'placeholder Celestial seal');
  requireValue(p.esmsSource !== 'unavailable' || (p.esms.every((v: number) => v === 0) && !seals.length), 'unavailable holdings');
  return { version: 1, sourceKey: p.sourceKey, chartPlaceholder: p.chartPlaceholder,
    ratings: [...p.ratings], esms: [...p.esms], esmsSource: p.esmsSource, seals, surge: surgeFrom(p.surge) };
}

export function applyRatingSnapshot(base: RatedAgentPayload, json: string, receivedAt: number): RatedAgentPayload {
  if (!Number.isSafeInteger(receivedAt) || receivedAt <= 0 || receivedAt > Date.now() + 60_000) throw new Error('Invalid rating timestamp');
  const p = parseRatingSnapshot(json);
  const ratings = Object.fromEntries(SACRED_STAT_KEYS.map((key, i) => [key, p.ratings[i]])) as RatedAgentPayload['ratings'];
  const relativeAdvantage = computeRelativeAdvantage(ratings);
  return { ...base, isPlaceholder: p.chartPlaceholder, ratings, relativeAdvantage,
    ovr: computeOvr(ratings), archetype: resolveArchetype(relativeAdvantage),
    esms: Object.fromEntries(ESMS_KEYS.map((key, i) => [key, p.esms[i]])) as RatedAgentPayload['esms'],
    seals: p.seals, surge: p.surge ?? { meter: 0, active: false, surgeType: 'inferno', monica: null,
      monicaState: 'absent', heat: 0, reactivity: 0, statBoosts: {} },
    ratingFeed: { sourceKey: p.sourceKey, receivedAt, esmsAvailable: p.esmsSource !== 'unavailable', skyAvailable: p.surge !== null } };
}

export function ratingFeedStatus(p: RatedAgentPayload, now = Date.now()): 'pending' | 'current' | 'partial' | 'stale' | 'example' {
  if (!p.ratingFeed) return p.ratingSource === 'live' || p.isPlaceholder ? 'pending' : 'example';
  if (now - p.ratingFeed.receivedAt > RATING_MAX_AGE_MS) return 'stale';
  return p.ratingFeed.esmsAvailable && p.ratingFeed.skyAvailable ? 'current' : 'partial';
}
