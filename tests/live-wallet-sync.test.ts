import { describe, it, expect } from 'bun:test';
import {
  liveWalletSync,
  syncAgentEsmsFromSpacetime,
} from '../src/lib/agents/live-wallet-sync';

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
    // Charisma raw 88 - mean 64.5 + 68.0 = 91.5 (qualifies for Aether >= 91)
    // Initial essence is 32.0 (< 50.0 Aether gate -> Gold).
    // When essence updates to 65.0 (>= 50.0 Aether gate), Harmonic Sovereign upgrades to Aether!
    const neoBefore = liveWalletSync.getCachedAgent('user-avatar-neo')!;
    const sealBefore = neoBefore.seals.find((s) => s.statKey === 'charisma')!;
    expect(sealBefore.tier).toBe('Gold');

    // Push new ESMS balances with essence = 65.0 (>= 50.0 Aether gate)
    const updated = syncAgentEsmsFromSpacetime('user-avatar-neo', {
      spirit: 45.0,
      essence: 65.0,
      matter: 28.0,
      substance: 52.0,
    });

    expect(updated).toBeDefined();
    expect(updated!.esms.essence).toBe(65.0);

    const sealAfter = updated!.seals.find((s) => s.statKey === 'charisma')!;
    expect(sealAfter.tier).toBe('Aether');
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
