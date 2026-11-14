import { describe, expect, it } from 'bun:test';
import catalog from '../src/lib/agents/historical-vessel-catalog.json';
import { HISTORICAL_AGENTS } from '../src/alchm-chart/historical-agents.js';
import { presentVesselInspector } from '../src/lib/agents/vessel-inspector-presentation';
import { presentVessel } from '../src/lib/agents/vessel-presentation';
import { applyRatingSnapshot, ratingFeedStatus } from '../src/lib/agents/agent-rating-feed';
import { FIXTURE_AGENTS, SACRED_STAT_KEYS, ESMS_KEYS, computeOvr, computeRelativeAdvantage, resolveArchetype } from '../src/lib/agents/rating-contract';

const pending = (key = 'joan-of-arc') => ({ ...structuredClone(FIXTURE_AGENTS[0]), key,
  ratingSource: 'live' as const, provenance: 'historical' as const, isPlaceholder: true });

describe('Historical catalog inspector fallback', () => {
  it('provides the upstream 25–99 baseline, archetype, elements and seals for all 71 canonical identities', () => {
    expect(Object.keys(catalog.agents).sort()).toEqual(HISTORICAL_AGENTS.map(a => a.key).sort());
    expect(catalog.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    for (const agent of HISTORICAL_AGENTS) {
      const baseline = catalog.agents[agent.key as keyof typeof catalog.agents];
      const view = presentVesselInspector(pending(agent.key));
      expect(view.sourceLabel).toBe('Catalog baseline');
      expect(view.ratings).toEqual(baseline.ratings);
      expect(SACRED_STAT_KEYS.every(k => Number.isInteger(view.ratings![k]) && view.ratings![k] >= 25 && view.ratings![k] <= 99)).toBe(true);
      expect(view.ovr).toBe(String(computeOvr(baseline.ratings)));
      expect(view.archetype).toBe(resolveArchetype(computeRelativeAdvantage(baseline.ratings)).title);
      expect(ESMS_KEYS.every(k => Number.isFinite(view.esms![k]) && view.esms![k] >= 0)).toBe(true);
      expect(view.seals).toEqual(baseline.seals);
      expect(view.seals!.every(seal => seal.tier === 'Copper')).toBe(true);
      expect(view.surge).toBeNull();
    }
    const joan = presentVesselInspector(pending());
    expect(joan.ovr).toBe('81'); expect(joan.archetype).toBe('Apex Sovereign');
    expect(joan.esms?.spirit).toBe(.91);
  });

  it('never modifies game payloads, awards live seals, or borrows examples or human holdings', () => {
    const payload = pending(), before = structuredClone(payload);
    const view = presentVesselInspector(payload);
    expect(payload).toEqual(before);
    expect(ratingFeedStatus(payload)).toBe('pending');
    expect(presentVessel(payload).esms).toBeNull();
    expect(view.baselineNote).toContain('not verified wallet holdings');
    expect(Object.isFrozen(view.ratings)).toBe(true); expect(Object.isFrozen(view.esms)).toBe(true);
    expect(Object.isFrozen(view.seals)).toBe(true);
    for (const key of ['unknown', 'constructor', '__proto__', 'user-avatar-neo']) {
      expect(presentVesselInspector(pending(key)).ratings).toBeNull();
    }
    expect(presentVesselInspector({ ...payload, provenance: 'user' }).ratings).toBeNull();
    expect(presentVesselInspector(FIXTURE_AGENTS[0]).sourceLabel).toBe('Example ratings');
    expect(presentVesselInspector(FIXTURE_AGENTS[0]).catalogElements).toBe(false);
  });

  it('uses live stats immediately, falls back only for missing sections, and preserves measured zero and stale readings', () => {
    const payload = pending(), now = Date.now();
    const snapshot = { version: 1, sourceKey: payload.key, chartPlaceholder: true,
      ratings: [75,76,77,78,79,80,81], esms: [0,0,0,0], esmsSource: 'unavailable', seals: [], surge: null };
    const partial = applyRatingSnapshot(payload, JSON.stringify(snapshot), now);
    const mixed = presentVesselInspector(partial, now);
    expect(mixed.sourceLabel).toBe('Partial live rating');
    expect(mixed.ratings?.power).toBe(75); expect(mixed.catalogRatings).toBe(false);
    expect(mixed.catalogElements).toBe(true); expect(mixed.esms?.spirit).toBe(.91);
    const measured = applyRatingSnapshot(payload, JSON.stringify({ ...snapshot, esmsSource: 'database',
      surge: { meter: 20, active: false, surgeType: 'inferno', monica: null, monicaState: 'absent', heat: .2, reactivity: .1, statBoosts: {} } }), now);
    for (const age of [0, 360_000]) {
      const view = presentVesselInspector(measured, now + age);
      expect(view.sourceLabel).toBe(age ? 'Stale rating' : 'Live rating');
      expect(view.esms).toEqual({ spirit:0, essence:0, matter:0, substance:0 });
      expect(view.seals).toEqual([]); expect(view.catalogElements).toBe(false);
      expect(view.surge?.meter).toBe(20);
    }
    expect(presentVesselInspector(payload).catalogRatings).toBe(true);
  });
});
