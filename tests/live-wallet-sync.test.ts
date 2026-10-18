import { afterEach, beforeEach, describe, it, expect } from 'bun:test';
import {
  liveWalletSync,
  syncAgentEsmsFromSpacetime,
  syncAgentRatingPayload,
} from '../src/lib/agents/live-wallet-sync';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';
import { createVesselAvatarMesh as createAvatar, disposeVesselAvatar } from '../src/lib/agents/vessel-avatar-3d';

const createdAvatars = new Set<ReturnType<typeof createAvatar>>();
function createVesselAvatarMesh(...args: Parameters<typeof createAvatar>): ReturnType<typeof createAvatar> {
  const avatar = createAvatar(...args);
  createdAvatars.add(avatar);
  return avatar;
}
beforeEach(() => liveWalletSync.clearCache());
afterEach(() => {
  for (const avatar of createdAvatars) disposeVesselAvatar(avatar);
  createdAvatars.clear();
  liveWalletSync.clearCache();
});

describe('Live Wallet ESMS & Rating Hydration Service', () => {
  it('hydrates known fixture agents from local cache when offline', async () => {
    const newton = await liveWalletSync.fetchAgentRatingPayload('isaac-newton');
    expect(newton).toBeDefined();
    expect(newton.key).toBe('isaac-newton');
    expect(newton.ovr).toBe(94);
    expect(newton.seals.length).toBeGreaterThan(0);
  });

  it('updates live agent ESMS balances and upgrades seal tiers', () => {
    // Start with Neo (user-avatar-neo) who has Gold Harmonic Sovereign (charisma raw 88)
    // Charisma raw 88 - mean 64.5 + 68.0 = 91.5 (qualifies for Astral >= 91)
    // Initial essence is 32.0 (< 50.0 Astral gate -> Gold).
    // When essence updates to 65.0 (>= 50.0 Astral gate), Harmonic Sovereign upgrades to Astral!
    const neoBefore = liveWalletSync.getCachedAgent('user-avatar-neo')!;
    const sealBefore = neoBefore.seals.find((s) => s.statKey === 'charisma')!;
    expect(sealBefore.tier).toBe('Gold');

    // Push new ESMS balances with essence = 65.0 (>= 50.0 Astral gate)
    const updated = syncAgentEsmsFromSpacetime('user-avatar-neo', {
      spirit: 45.0,
      essence: 65.0,
      matter: 28.0,
      substance: 52.0,
    });

    expect(updated).toBeDefined();
    expect(updated!.esms.essence).toBe(65.0);

    const sealAfter = updated!.seals.find((s) => s.statKey === 'charisma')!;
    expect(sealAfter.tier).toBe('Astral');
  });

  it('updates registered 3D foot ring mesh uniforms in-place', () => {
    const mockMesh: any = {
      material: {
        uniforms: {
          uMeter: { value: 0 },
          uActive: { value: 0 },
          uSurgeType: { value: 0 },
          uEsmsSpirit: { value: 0 },
          uEsmsEssence: { value: 0 },
          uEsmsMatter: { value: 0 },
          uEsmsSubstance: { value: 0 },
        },
      },
      userData: {},
    };

    liveWalletSync.registerFootRingMesh('isaac-newton', mockMesh);

    syncAgentEsmsFromSpacetime('isaac-newton', {
      spirit: 250.0,
      essence: 250.0,
      matter: 250.0,
      substance: 250.0,
    });

    expect(mockMesh.material.uniforms.uEsmsSpirit.value).toBe(1.0);
    expect(mockMesh.material.uniforms.uEsmsSubstance.value).toBe(1.0);

    liveWalletSync.unregisterFootRingMesh('isaac-newton');
  });

  it('notifies registered listeners on live synchronization', () => {
    let notifiedKey = '';
    const unsubscribe = liveWalletSync.onAgentSync((agent) => {
      notifiedKey = agent.key;
    });

    syncAgentEsmsFromSpacetime('emily-dickinson', {
      spirit: 220.0,
      essence: 350.0,
      matter: 95.0,
      substance: 190.0,
    });

    expect(notifiedKey).toBe('emily-dickinson');
    unsubscribe();
  });

  it('refreshes the body and foot ring together when live balances and Surge change', () => {
    const payload = structuredClone(FIXTURE_AGENTS[3]);
    const avatar = createVesselAvatarMesh(payload);
    const beforeCount = avatar.userData.sealOrbiters.children.length;
    const surge = { ...payload.surge, active: true, meter: 85, surgeType: 'tempest' as const };
    const updated = syncAgentEsmsFromSpacetime(payload.key, { ...payload.esms, essence: 65 }, surge)!;
    expect(updated.seals.find((seal) => seal.statKey === 'charisma')?.tier).toBe('Astral');
    expect(avatar.userData.agentPayload).toEqual(updated);
    expect(avatar.userData.agentPayload).not.toBe(updated);
    expect(avatar.userData.sealOrbiters.children.length).toBeGreaterThan(beforeCount);
    expect(avatar.getObjectByName('SurgeCorona')).toBeDefined();
    expect(avatar.userData.animationState).toBe('surge');
    expect(avatar.userData.footRing.material.uniforms.uActive.value).toBe(1);
    syncAgentRatingPayload({ ...updated, surge: { ...surge, active: false, meter: 20 } });
    expect(avatar.getObjectByName('SurgeCorona')).toBeUndefined();
    expect(avatar.userData.animationState).toBe('idle');
    expect(avatar.userData.footRing.material.uniforms.uActive.value).toBe(0);
    disposeVesselAvatar(avatar);
    liveWalletSync.clearCache();
  });

  it('unregisters only the removed vessel when another view of the same agent is live', () => {
    const first = createVesselAvatarMesh(structuredClone(FIXTURE_AGENTS[0]));
    const second = createVesselAvatarMesh(structuredClone(FIXTURE_AGENTS[0]));
    disposeVesselAvatar(first);
    const payload = { ...structuredClone(FIXTURE_AGENTS[0]), surge: { ...FIXTURE_AGENTS[0].surge, active: true, meter: 99 } };
    syncAgentRatingPayload(payload);
    expect(second.getObjectByName('SurgeCorona')).toBeDefined();
    expect(second.userData.footRing.material.uniforms.uActive.value).toBe(1);
    expect(first.userData.disposed).toBe(true);
    disposeVesselAvatar(second);
    liveWalletSync.clearCache();
  });

  it('owns its payload and never mutates caller or shared fixture data during wallet refresh', () => {
    const fixtureSnapshot = structuredClone(FIXTURE_AGENTS[0]);
    const caller = structuredClone(FIXTURE_AGENTS[0]);
    const fixtureAvatar = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
    const callerAvatar = createVesselAvatarMesh(caller);
    const surge = { ...caller.surge, active: true, meter: 98 };
    syncAgentEsmsFromSpacetime(caller.key, { spirit: 250, essence: 250, matter: 250, substance: 250 }, surge);
    expect(FIXTURE_AGENTS[0]).toEqual(fixtureSnapshot);
    expect(caller).toEqual(fixtureSnapshot);
    expect(fixtureAvatar.userData.agentPayload.surge.active).toBe(true);
    expect(callerAvatar.userData.agentPayload.surge.active).toBe(true);
    const refreshed = structuredClone(caller);
    liveWalletSync.syncAgentRatingPayload(refreshed);
    syncAgentEsmsFromSpacetime(caller.key, { spirit: 25, essence: 25, matter: 25, substance: 25 }, surge);
    expect(refreshed).toEqual(caller);
    expect(FIXTURE_AGENTS[0]).toEqual(fixtureSnapshot);
  });

  it('hydrates a stale second view from authoritative cache and preserves it through the next wallet update', () => {
    const stale = structuredClone(FIXTURE_AGENTS[0]);
    const first = createVesselAvatarMesh(stale);
    const authoritative = {
      ...structuredClone(stale),
      ovr: 98,
      ratings: { ...stale.ratings, power: 99 },
      surge: { ...stale.surge, active: true, meter: 95 },
    };
    syncAgentRatingPayload(authoritative);
    const second = createVesselAvatarMesh(stale);
    expect(second.userData.agentPayload.ovr).toBe(98);
    expect(second.userData.animationState).toBe('surge');
    expect(second.userData.footRing.material.uniforms.uActive.value).toBe(1);
    expect(liveWalletSync.getCachedAgent(stale.key)?.surge.active).toBe(true);
    syncAgentEsmsFromSpacetime(stale.key, { ...stale.esms, spirit: 200 });
    for (const avatar of [first, second]) {
      expect(avatar.userData.agentPayload.ovr).toBe(98);
      expect(avatar.userData.agentPayload.ratings.power).toBe(99);
      expect(avatar.userData.agentPayload.surge.active).toBe(true);
      expect(avatar.userData.animationState).toBe('surge');
    }
    expect(stale.surge.active).toBe(false);
  });

  describe('Endpoint Resolution and Batch Hydration', () => {
    it('resolves base URL in correct priority order', () => {
      const { resolvePlanetaryAgentsUrl } = require('../src/lib/agents/live-wallet-sync');

      // 1. Explicit options.baseUrl takes highest priority
      expect(resolvePlanetaryAgentsUrl({ baseUrl: 'https://my-custom-domain.org/' })).toBe(
        'https://my-custom-domain.org'
      );

      // 2. window override when no options.baseUrl
      const originalWindow = (globalThis as any).window;
      try {
        (globalThis as any).window = {
          Pentacles: {
            config: {
              planetaryAgentsUrl: 'https://window-config.alchm.kitchen/',
            },
          },
        };
        expect(resolvePlanetaryAgentsUrl()).toBe('https://window-config.alchm.kitchen');
      } finally {
        (globalThis as any).window = originalWindow;
      }

      // 3. Default fallback
      expect(resolvePlanetaryAgentsUrl()).toBe('https://agents.alchm.kitchen');
    });

    it('deduplicates in-flight requests for the same agentId', async () => {
      // Clear cache so fetch goes through executeFetchWithTimeout
      liveWalletSync.clearCache();

      // Trigger two concurrent fetches for an uncached agent
      const p1 = liveWalletSync.fetchAgentRatingPayload('uncached-agent-alpha', { timeoutMs: 50 });
      const p2 = liveWalletSync.fetchAgentRatingPayload('uncached-agent-alpha', { timeoutMs: 50 });

      // Both should be the exact same in-flight promise reference
      expect(p1).toBe(p2);

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1.key).toBe('uncached-agent-alpha');
      expect(res2.key).toBe('uncached-agent-alpha');
    });

    it('falls back to deterministic fixture on network timeout', async () => {
      // Test very short timeout with non-routable endpoint
      const res = await liveWalletSync.fetchAgentRatingPayload('emily-dickinson', {
        baseUrl: 'http://10.255.255.1:9999',
        timeoutMs: 30,
      });

      expect(res).toBeDefined();
      expect(res.key).toBe('emily-dickinson');
      expect(res.archetype.title).toBe('Reclusive Visionary');
    });

    it('hydrates multiple agents in batch via hydrateRosterRatings', async () => {
      const rosterKeys = ['isaac-newton', 'leonardo-da-vinci', 'emily-dickinson', 'user-avatar-neo'];
      const batchResult = await liveWalletSync.hydrateRosterRatings(rosterKeys);

      for (const key of rosterKeys) {
        expect(batchResult[key]).toBeDefined();
        expect(batchResult[key].key).toBe(key);
      }
    });
  });
});
