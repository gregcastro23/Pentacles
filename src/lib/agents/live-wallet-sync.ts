/**
 * ============================================================================
 * Pentacles — Live Wallet ESMS & Rating Hydration Service
 * ============================================================================
 *
 * Synchronizes agent ESMS token balances and vessel rating payloads from:
 *   1. Planetary Agents API (/api/agents/rating?agentId=<id>)
 *   2. SpacetimeDB client tables (AgentChart / live wallet rows)
 *   3. Deterministic fixture fallbacks when offline
 *
 * When SpacetimeDB or external services push live ESMS updates, this helper
 * immediately re-evaluates Alchemical Seal tiers, updates active 3D foot ring
 * shader uniforms in-place, and refreshes open Vessel Card HUDs.
 */

import {
  type RatedAgentPayload,
  type EsmsBalances,
  type SealTier,
  type ResonanceSurgeState,
  FIXTURE_AGENTS,
  evaluateSealTier,
  SEAL_TIER_MULTIPLIERS,
} from './rating-contract';
import { updateFootRingEsmsAndSurge } from './avatar-foot-ring';

export type AgentSyncListener = (payload: RatedAgentPayload) => void;
type VesselRefresh = (avatar: any, payload: RatedAgentPayload) => void;

export interface HydrationOptions {
  baseUrl?: string;
  timeoutMs?: number;
  useFallbackFastApi?: boolean;
}

/**
 * Resolve the Planetary Agents endpoint according to priority:
 *   1. Explicit options.baseUrl
 *   2. window.Pentacles?.config?.planetaryAgentsUrl
 *   3. import.meta.env?.VITE_PA_FRONTEND_URL or process.env.PLANETARY_AGENTS_FRONTEND_URL
 *   4. Default fallback: https://agents.alchm.kitchen
 */
export function resolvePlanetaryAgentsUrl(options?: HydrationOptions): string {
  if (options?.baseUrl) {
    return options.baseUrl.replace(/\/+$/, '');
  }

  if (typeof window !== 'undefined') {
    const windowOverride = (window as any)?.Pentacles?.config?.planetaryAgentsUrl;
    if (windowOverride && typeof windowOverride === 'string') {
      return windowOverride.replace(/\/+$/, '');
    }
  }

  try {
    const viteEnv = (import.meta as any)?.env?.VITE_PA_FRONTEND_URL;
    if (viteEnv && typeof viteEnv === 'string') {
      return viteEnv.replace(/\/+$/, '');
    }
  } catch {
    // import.meta.env might be unavailable in some runtimes
  }

  if (typeof process !== 'undefined' && process.env?.PLANETARY_AGENTS_FRONTEND_URL) {
    return process.env.PLANETARY_AGENTS_FRONTEND_URL.replace(/\/+$/, '');
  }

  return 'https://agents.alchm.kitchen';
}

class LiveWalletSyncManager {
  private agentCache: Map<string, RatedAgentPayload> = new Map();
  private authoritativeAgents = new Set<string>();
  private inFlightRequests: Map<string, Promise<RatedAgentPayload>> = new Map();
  private meshRegistry: Map<string, Set<any>> = new Map();
  private vesselRegistry: Map<string, Map<any, VesselRefresh>> = new Map();
  private hudInstance: any = null;
  private listeners: Set<AgentSyncListener> = new Set();

  constructor() {
    // Prime cache with deterministic fixtures
    for (const fixture of FIXTURE_AGENTS) {
      this.agentCache.set(fixture.key, JSON.parse(JSON.stringify(fixture)));
    }
  }

  /**
   * Bind the active Vessel Card HUD instance for automatic live re-rendering
   */
  public registerHud(hud: any): void {
    this.hudInstance = hud;
  }

  /**
   * Register a 3D avatar foot ring mesh for in-place uniform updates
   */
  public registerFootRingMesh(agentKey: string, mesh: any): void {
    const meshes = this.meshRegistry.get(agentKey) ?? new Set();
    meshes.add(mesh);
    this.meshRegistry.set(agentKey, meshes);
  }

  /**
   * Unregister a foot ring mesh on avatar removal
   */
  public unregisterFootRingMesh(agentKey: string, mesh?: any): void {
    if (!mesh) this.meshRegistry.delete(agentKey);
    else {
      const meshes = this.meshRegistry.get(agentKey);
      meshes?.delete(mesh);
      if (!meshes?.size) this.meshRegistry.delete(agentKey);
    }
  }

  /** A refresh callback keeps this service independent of the Three.js avatar module. */
  public registerVesselAvatar(agentKey: string, avatar: any, refresh: VesselRefresh, payload?: RatedAgentPayload): void {
    const vessels = this.vesselRegistry.get(agentKey) ?? new Map();
    vessels.set(avatar, refresh);
    this.vesselRegistry.set(agentKey, vessels);
    const cached = this.agentCache.get(agentKey);
    if (cached && this.authoritativeAgents.has(agentKey)) refresh(avatar, cached);
    else if (payload) this.agentCache.set(agentKey, JSON.parse(JSON.stringify(payload)));
  }

  public unregisterVesselAvatar(agentKey: string, avatar: any): void {
    const vessels = this.vesselRegistry.get(agentKey);
    vessels?.delete(avatar);
    if (!vessels?.size) this.vesselRegistry.delete(agentKey);
  }

  /** Apply an authoritative rating/Surge payload to both body and ring in one dispatch. */
  public syncAgentRatingPayload(payload: RatedAgentPayload): RatedAgentPayload {
    const agent = JSON.parse(JSON.stringify(payload)) as RatedAgentPayload;
    this.agentCache.set(agent.key, agent);
    this.authoritativeAgents.add(agent.key);
    this.publishAgent(agent);
    return agent;
  }

  private publishAgent(agent: RatedAgentPayload): void {
    for (const mesh of this.meshRegistry.get(agent.key) ?? []) {
      updateFootRingEsmsAndSurge(mesh, agent.esms, agent.surge);
    }
    for (const [avatar, refresh] of this.vesselRegistry.get(agent.key) ?? []) {
      refresh(avatar, agent);
    }
    if (this.hudInstance?.refreshAgentPayload) this.hudInstance.refreshAgentPayload(agent);
    else if (this.hudInstance?.updateAgentEsms) this.hudInstance.updateAgentEsms(agent.key, agent.esms);
    for (const listener of this.listeners) {
      try { listener(agent); } catch { /* Isolate listener failures. */ }
    }
  }

  /**
   * Subscribe to agent state synchronization events
   */
  public onAgentSync(listener: AgentSyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Hydrate an agent's rating payload with in-flight deduplication and configurable timeout
   */
  public fetchAgentRatingPayload(
    agentId: string,
    options: HydrationOptions = {}
  ): Promise<RatedAgentPayload> {
    const cached = this.agentCache.get(agentId);
    if (cached) return Promise.resolve(cached);

    // Deduplicate in-flight requests for the same agentId
    const existing = this.inFlightRequests.get(agentId);
    if (existing) {
      return existing;
    }

    const fetchPromise = this.executeFetchWithTimeout(agentId, options)
      .finally(() => {
        this.inFlightRequests.delete(agentId);
      });

    this.inFlightRequests.set(agentId, fetchPromise);
    return fetchPromise;
  }

  /**
   * Batch hydrate ratings for multiple agents simultaneously with deduplication
   */
  public async hydrateRosterRatings(
    agentIds: string[],
    options: HydrationOptions = {}
  ): Promise<Record<string, RatedAgentPayload>> {
    const uniqueIds = Array.from(new Set(agentIds));
    const results = await Promise.all(
      uniqueIds.map(async (id) => {
        const payload = await this.fetchAgentRatingPayload(id, options);
        return [id, payload] as const;
      })
    );

    const record: Record<string, RatedAgentPayload> = {};
    for (const [id, payload] of results) {
      record[id] = payload;
    }
    return record;
  }

  private async executeFetchWithTimeout(
    agentId: string,
    options: HydrationOptions
  ): Promise<RatedAgentPayload> {
    const baseUrl = resolvePlanetaryAgentsUrl(options);
    const timeoutMs = options.timeoutMs ?? 4500;

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

    try {
      const url = `${baseUrl}/api/agents/rating?agentId=${encodeURIComponent(agentId)}`;
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller?.signal,
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.key) {
          this.agentCache.set(data.key, data);
          this.authoritativeAgents.add(data.key);
          return data;
        }
      }

      // Optional secondary fallback to FastAPI backend if requested
      if (options.useFallbackFastApi && baseUrl !== 'https://api.agents.alchm.kitchen') {
        const altUrl = `https://api.agents.alchm.kitchen/api/agents/rating?agentId=${encodeURIComponent(agentId)}`;
        const altRes = await fetch(altUrl, {
          headers: { Accept: 'application/json' },
          signal: controller?.signal,
        });
        if (altRes.ok) {
          const altData = await altRes.json();
          if (altData && altData.key) {
            this.agentCache.set(altData.key, altData);
            this.authoritativeAgents.add(altData.key);
            return altData;
          }
        }
      }
    } catch {
      // Timeout or network offline fallback
    } finally {
      if (timer) clearTimeout(timer);
    }

    // Fall back to matching deterministic fixture or clone
    const matched = FIXTURE_AGENTS.find(
      (f) => f.key === agentId || f.handle.toLowerCase() === agentId.toLowerCase()
    );
    if (matched) {
      const clone = JSON.parse(JSON.stringify(matched));
      this.agentCache.set(clone.key, clone);
      return clone;
    }

    // Default fixture fallback
    const fallback = JSON.parse(JSON.stringify(FIXTURE_AGENTS[0]));
    fallback.key = agentId;
    this.agentCache.set(agentId, fallback);
    return fallback;
  }

  /**
   * Live SpacetimeDB ESMS update handler:
   *   1. Updates agent's ESMS balances
   *   2. Re-evaluates Alchemical Seal tiers
   *   3. Updates 3D foot ring uniforms in-place
   *   4. Refreshes open Vessel Card HUD
   */
  public syncAgentEsmsFromSpacetime(
    agentId: string,
    esmsBalances: EsmsBalances,
    surge?: ResonanceSurgeState
  ): RatedAgentPayload | null {
    let agent = this.agentCache.get(agentId);
    if (!agent) {
      const fixture = FIXTURE_AGENTS.find((f) => f.key === agentId);
      if (fixture) {
        agent = JSON.parse(JSON.stringify(fixture));
        this.agentCache.set(agentId, agent!);
      }
    }

    if (!agent) return null;
    this.authoritativeAgents.add(agentId);

    // 1. Update balances
    agent.esms = { ...esmsBalances };
    if (surge) agent.surge = { ...surge, statBoosts: { ...surge.statBoosts } };

    // 2. Re-evaluate Alchemical Seal tiers against updated holdings
    const isPlaceholder = Boolean(agent.isPlaceholder);
    const updatedSeals = agent.seals.map((seal) => {
      const statKey = seal.statKey;
      if (!statKey) return seal;

      const rawRating = agent.ratings[statKey] ?? 25;
      const primaryHolding = esmsBalances[seal.category as keyof EsmsBalances] ?? esmsBalances.spirit;

      const newTier: SealTier | null = evaluateSealTier(
        statKey,
        rawRating,
        primaryHolding,
        isPlaceholder
      );

      if (newTier && newTier !== seal.tier) {
        return {
          ...seal,
          tier: newTier,
          multiplier: SEAL_TIER_MULTIPLIERS[newTier] || seal.multiplier,
        };
      }
      return seal;
    });

    agent.seals = updatedSeals;

    this.publishAgent(agent);

    return agent;
  }

  /**
   * Get currently cached payload for an agent
   */
  public getCachedAgent(agentKey: string): RatedAgentPayload | undefined {
    return this.agentCache.get(agentKey);
  }

  /**
   * Clear cache (useful for test resets)
   */
  public clearCache(): void {
    this.agentCache.clear();
    this.authoritativeAgents.clear();
    for (const fixture of FIXTURE_AGENTS) {
      this.agentCache.set(fixture.key, JSON.parse(JSON.stringify(fixture)));
    }
    this.inFlightRequests.clear();
  }
}

export const liveWalletSync = new LiveWalletSyncManager();

/**
 * Global bridge helper for SpacetimeDB table listeners
 */
export function syncAgentEsmsFromSpacetime(
  agentId: string,
  esmsBalances: EsmsBalances,
  surge?: ResonanceSurgeState
): RatedAgentPayload | null {
  return liveWalletSync.syncAgentEsmsFromSpacetime(agentId, esmsBalances, surge);
}

export function syncAgentRatingPayload(payload: RatedAgentPayload): RatedAgentPayload {
  return liveWalletSync.syncAgentRatingPayload(payload);
}

/**
 * Global batch hydration helper
 */
export function hydrateRosterRatings(
  agentIds: string[],
  options?: HydrationOptions
): Promise<Record<string, RatedAgentPayload>> {
  return liveWalletSync.hydrateRosterRatings(agentIds, options);
}
