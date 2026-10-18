/**
 * ============================================================================
 * Pentacles — Vessel Rating, 3D Court, Under-Foot Ring & HUD Subsystem
 * ============================================================================
 */

import { FIXTURE_AGENTS, type RatedAgentPayload } from './rating-contract';
import { PentacleArena3D } from './pentacle-arena-3d';
import { VesselCardHUD } from './player-card-hud';
import { liveWalletSync } from './live-wallet-sync';
import { SpacetimeDBBridge } from './spacetimedb-bridge';

export * from './rating-contract';
export * from './avatar-foot-ring';
export * from './vessel-avatar-3d';
export * from './vessel-appearance-manifest';
export * from './vessel-silhouettes';
export * from './pentacle-arena-3d';
export * from './player-card-hud';
export * from './tile-contest';
export * from './live-wallet-sync';
export * from './spacetimedb-bridge';

export interface PentacleVesselDemoInstance {
  arena: PentacleArena3D;
  hud: VesselCardHUD;
  bridge: SpacetimeDBBridge;
  destroy: () => void;
}

export interface PentacleVesselDemoOptions {
  /** The standard Pentacles networking facade, or a raw SDK connection. */
  client?: any;
  /** Explicitly enable the four pilot vessels instead of live seat hydration. */
  fixtures?: boolean;
}

/**
 * Interactive demo initializer:
 * Spawns the 11-zone 3D arena, places the 4 reference fixture agents:
 *   - isaac-newton on Crown 10 (owner)
 *   - leonardo-da-vinci on Spire 5 (owner)
 *   - emily-dickinson on Spire 6 (in active Resonance Surge)
 *   - user-avatar-neo on House 0 (challenger)
 * Binds live wallet sync, HUD, and SpacetimeDB bridge.
 */
export function mountPentacleVesselDemo(
  container?: HTMLElement | string,
  options: PentacleVesselDemoOptions = {}
): PentacleVesselDemoInstance {
  let targetContainer: HTMLElement;

  if (typeof container === 'string') {
    const el = document.querySelector<HTMLElement>(container);
    if (!el) {
      throw new Error(`[Pentacles] Container element '${container}' not found in DOM`);
    }
    targetContainer = el;
  } else if (typeof HTMLElement !== 'undefined' && container instanceof HTMLElement) {
    targetContainer = container;
  } else if (typeof document !== 'undefined') {
    targetContainer = document.createElement('div');
    targetContainer.id = 'pentacle-vessel-demo-container';
    targetContainer.style.width = '100%';
    targetContainer.style.height = '100%';
    targetContainer.style.position = 'relative';
    if (document.body) {
      document.body.appendChild(targetContainer);
    }
  } else {
    // Headless / SSR dummy
    targetContainer = {} as any;
  }

  // 1. Initialize Vessel Card HUD
  const hud = new VesselCardHUD();
  liveWalletSync.registerHud(hud);

  // 2. Initialize 3D Pentacle Court Arena
  const arena = new PentacleArena3D({
    container: targetContainer,
    autoStartLoop: typeof requestAnimationFrame === 'function',
    onSelectAgent: (agent: RatedAgentPayload) => {
      hud.show(agent);
    },
    onSelectZone: (zoneId: number) => {
      const zone = arena.zones.get(zoneId);
      if (zone?.currentAgent) {
        hud.show(zone.currentAgent);
      }
    },
  });

  // Each mounted arena owns its listeners and can unmount independently.
  const bridge = new SpacetimeDBBridge();
  const client = options.client ?? (typeof window !== 'undefined' ? (window as any).Pentacles?.net : null);
  const fixtures = options.fixtures ?? !client;
  bridge.attachArena(arena);
  if (!fixtures && client) bridge.connect(client);

  // Offline/demo mode places the four pilots; live mode hydrates authoritative seats.
  if (fixtures) {
    hud.setRoster(FIXTURE_AGENTS);
    // Isaac Newton on Crown 10 (Apex Summit)
    arena.placeAvatarOnZone(10, FIXTURE_AGENTS[0], 'owner');
    // Leonardo da Vinci on Spire 5 (Spire I)
    arena.placeAvatarOnZone(5, FIXTURE_AGENTS[2], 'owner');
    // Emily Dickinson on Spire 6 (Spire II - Active Resonance Surge!)
    arena.placeAvatarOnZone(6, FIXTURE_AGENTS[1], 'owner');
    // User Avatar Neo contesting House 0 (House I)
    arena.placeAvatarOnZone(0, FIXTURE_AGENTS[3], 'challenger');

    // Set initial zone ownership and tug-of-war meter
    arena.updateZoneStatus(10, 5, 450); // Jupiter held
    arena.updateZoneStatus(5, 6, 750);  // Saturn held
    arena.updateZoneStatus(6, 3, 900);  // Venus held
    arena.updateZoneStatus(0, 0, 600);  // Sun held
  }

  return {
    arena,
    hud,
    bridge,
    destroy: () => {
      bridge.disconnect();
      bridge.detachArena();
      arena.destroy();
      hud.destroy();
    },
  };
}
