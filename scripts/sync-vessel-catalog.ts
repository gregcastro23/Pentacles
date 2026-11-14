/** Offline, public roster-only projection. No ledger, wallet, sky or server imports. */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { HISTORICAL_AGENTS } from '../src/alchm-chart/historical-agents.js';
import { computeOvr, computeRelativeAdvantage, resolveArchetype, ESMS_KEYS, SACRED_STAT_KEYS } from '../src/lib/agents/rating-contract';

const source = resolve(process.argv[2] ?? '../AlchmAgentsSolana');
const fromSource = (path: string) => import(pathToFileURL(join(source, path)).href);
const { getHistoricalAgent } = await fromSource('lib/agents/historical/index.ts');
const { deriveSacredStats } = await fromSource('lib/agents/persona/derive-sacred-stats.ts');
const { rateStats } = await fromSource('lib/agents/rating/ovr-archetype.ts');
const { evaluateSeals, earnedSeals } = await fromSource('lib/agents/rating/seals-surge.ts');
const agents: Record<string, unknown> = {};
for (const canonical of HISTORICAL_AGENTS) {
  const agent = getHistoricalAgent(canonical.key);
  if (!agent) throw new Error(`Missing source agent: ${canonical.key}`);
  const stats = deriveSacredStats(agent);
  const rating = rateStats(stats);
  const esms = Object.fromEntries(ESMS_KEYS.map(key => [key, agent.consciousness.alchemicalElements[key]]));
  if (!Object.values(esms).every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0)) {
    throw new Error(`Invalid catalog elements: ${canonical.key}`);
  }
  if (!SACRED_STAT_KEYS.every(key => Number.isInteger(rating.ratings[key]) && rating.ratings[key] >= 25 && rating.ratings[key] <= 99)
    || computeOvr(rating.ratings) !== rating.ovr
    || JSON.stringify(resolveArchetype(computeRelativeAdvantage(rating.ratings))) !== JSON.stringify(rating.archetype)) {
    throw new Error(`Rating contract drift: ${canonical.key}`);
  }
  const natalChart = agent.consciousness.natalChart;
  agents[canonical.key] = {
    sourceKey: agent.id, chartPlaceholder: natalChart?.provenance === 'placeholder',
    ratings: rating.ratings, ovr: rating.ovr, archetype: rating.archetype, esms,
    seals: earnedSeals(evaluateSeals({ stats, esmsBalances: esms, natalChart })),
  };
}
const sourceFiles = [
  ...(await readdir(join(source, 'lib/agents/historical'))).filter(file => file.endsWith('.ts')).map(file => `lib/agents/historical/${file}`),
  'lib/agents/persona/derive-sacred-stats.ts', 'lib/sacred-7-stats.ts', 'lib/agents/rating/ovr-archetype.ts',
  'lib/agents/rating/seals-surge.ts', 'lib/agents/rating-contract.ts', 'lib/staking/elements.ts',
].sort();
const hash = createHash('sha256');
for (const file of sourceFiles) hash.update(file).update('\0').update(await readFile(join(source, file))).update('\0');
const catalog = { version: 1, source: 'ASOL historical roster', sourceSha256: hash.digest('hex'),
  method: 'Static natal ratings and catalog alchemical elements; baseline seals; no live sky or ledger', agents };
const output = new URL('../src/lib/agents/historical-vessel-catalog.json', import.meta.url);
await writeFile(output, JSON.stringify(catalog, null, 2) + '\n');
console.info(`Exported ${Object.keys(agents).length} canonical catalog baselines`);
