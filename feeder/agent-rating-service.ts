/** Pull ASOL's public historical roster ratings into owner-gated NPC snapshots. */
import { FIGURES } from '../scripts/agents-data';
import { normalizeApiRating, SOURCE_KEY, type AgentRatingSnapshot } from '../src/lib/agents/agent-rating-feed';
import { cliCall, resolveFeederEnv } from './spacetime-cli';

interface RosterEntry { key: string; handle: string }
interface Chart { handle: string }
interface FeedDependencies {
  charts(): Promise<Chart[]>;
  get(path: string): Promise<unknown>;
  publish(key: string, snapshot: AgentRatingSnapshot, observedAt: number): Promise<void>;
  now?: () => number;
}
export const normalizedAgentName = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/^sir\s+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function resolveRosterEntry(figure: { key: string; handle: string }, roster: RosterEntry[]): RosterEntry | undefined {
  const exact = roster.filter(r => r.key === figure.key);
  if (exact.length === 1) return exact[0];
  const named = roster.filter(r => normalizedAgentName(r.handle) === normalizedAgentName(figure.handle));
  return named.length === 1 ? named[0] : undefined;
}

export class RatingHttpError extends Error {
  constructor(public status: number) { super(`ratings HTTP ${status}`); }
}

/** One serial sweep. Failed reads never replace a stored snapshot. */
export async function syncAgentRatings(deps: FeedDependencies) {
  const charts = await deps.charts();
  const data = await deps.get('?roster=true') as any;
  if (data?.success !== true || !Array.isArray(data.agents) || data.agents.length > 500
    || data.agents.some((r: any) => !r || typeof r.key !== 'string' || !SOURCE_KEY.test(r.key)
      || typeof r.handle !== 'string' || r.handle.length > 120)) throw new Error('Invalid historical rating roster');
  const roster = data.agents as RosterEntry[];
  const handles = new Set(charts.map(c => normalizedAgentName(c.handle)));
  const result = { published: 0, partial: 0, failed: 0, unmatched: 0, rateLimited: false };
  for (const figure of FIGURES) {
    // The reducer independently derives the canonical identity and requires its public NPC chart.
    if (!handles.has(normalizedAgentName(figure.handle))) continue;
    const source = resolveRosterEntry(figure, roster);
    if (!source) { result.unmatched++; continue; }
    const observedAt = (deps.now ?? Date.now)();
    try {
      const input = await deps.get(`?agentId=${encodeURIComponent(source.key)}`);
      const snapshot = normalizeApiRating(input, source.key);
      await deps.publish(figure.key, snapshot, observedAt);
      result.published++;
      if (snapshot.esmsSource === 'unavailable' || snapshot.surge === null) result.partial++;
    } catch (error) {
      result.failed++;
      console.warn(`[agent-ratings] ${figure.key}: ${error instanceof Error ? error.message : 'sync failed'}`);
      if (error instanceof RatingHttpError && error.status === 429) { result.rateLimited = true; break; }
    }
  }
  return result;
}

async function readBoundedJson(response: Response, maxBytes: number) {
  if (!response.ok) { await response.body?.cancel(); throw new RatingHttpError(response.status); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty rating response');
  const decoder = new TextDecoder(); let size = 0; let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Rating response too large');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { await reader.cancel(); }
}

export function createRatingFeedDependencies(): FeedDependencies {
  const { uri, db, token } = resolveFeederEnv();
  // Use the frontend's Next rating route, not the FastAPI oracle endpoint.
  const source = new URL(process.env.PLANETARY_AGENTS_FRONTEND_URL || 'https://agents.alchm.kitchen');
  if (source.protocol !== 'https:' && !(source.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(source.hostname))) {
    throw new Error('Rating source must use HTTPS (HTTP is allowed for localhost)');
  }
  const endpoint = new URL('/api/agents/rating', source);
  return {
    charts: async () => {
      const { sqlOneShot } = await import('./stdb-feed');
      return await sqlOneShot(uri, db, token || undefined, 'SELECT handle FROM agent_chart', AbortSignal.timeout(10_000)) as Chart[];
    },
    get: async path => readBoundedJson(await fetch(endpoint + path, {
      signal: AbortSignal.timeout(10_000), redirect: 'error', headers: { Accept: 'application/json' },
      // Public NPC endpoint: never forward SPACETIME_TOKEN or a private wallet credential.
    }), path === '?roster=true' ? 256_000 : 64_000),
    publish: async (key, snapshot, observedAt) => {
      const args = [key, JSON.stringify(snapshot), observedAt];
      if (!token) { await cliCall(db, 'publish_agent_rating', args, uri); return; }
      const response = await fetch(`${uri}/v1/database/${encodeURIComponent(db)}/call/publish_agent_rating`, {
        method: 'POST', signal: AbortSignal.timeout(10_000), redirect: 'error',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(args),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error(`rating write HTTP ${response.status}`); }
      await response.body?.cancel();
    },
  };
}

async function main() {
  const deps = createRatingFeedDependencies();
  const configured = Number(process.env.AGENT_RATING_INTERVAL_MS ?? 120_000);
  if (!Number.isFinite(configured) || configured < 120_000 || configured > 86_400_000) throw new Error('AGENT_RATING_INTERVAL_MS must be 120000–86400000');
  const once = process.argv.includes('--once');
  for (;;) {
    try {
      const result = await syncAgentRatings(deps);
      console.info('[agent-ratings]', JSON.stringify(result));
      if (once) { if (result.failed || result.unmatched) process.exitCode = 1; return; }
    } catch (error) {
      console.error('[agent-ratings]', error instanceof Error ? error.message : 'sweep failed');
      if (once) { process.exitCode = 1; return; }
    }
    // Wait after completion, so a slow source cannot overlap sweeps or exceed the 120/min API budget.
    await Bun.sleep(configured);
  }
}
if (import.meta.main) await main();
