import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { PentacleArena3D, LEY_LINE_CONNECTIONS, getLeyLineRoute } from '../src/lib/agents/pentacle-arena-3d';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';
import { liveWalletSync } from '../src/lib/agents/live-wallet-sync';

describe('Pentacle arena movement and lifecycle', () => {
  it('keeps pedestal selection and badge state on the latest live payload', () => {
    const arena = new PentacleArena3D();
    arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0]);
    liveWalletSync.syncAgentRatingPayload({ ...structuredClone(FIXTURE_AGENTS[0]), ovr: 99 });
    arena.update(0);
    const registration = arena.avatarRegistry.get('isaac-newton')!;
    expect(arena.zones.get(0)!.currentAgent?.ovr).toBe(99);
    expect(arena.zones.get(0)!.currentAgent === registration.payload).toBe(true);
    arena.destroy();
    liveWalletSync.clearCache();
  });
  it('reuses one avatar root and clears its former pedestal', () => {
    const arena = new PentacleArena3D();
    const avatar = arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0])!;
    expect(arena.placeAvatarOnZone(1, FIXTURE_AGENTS[0]) === avatar).toBe(true);
    expect(arena.zones.get(0)!.avatarMesh).toBeUndefined();
    expect(arena.avatarRegistry.size).toBe(1);
    expect(arena.scene.children.filter(child => child.userData.agentId === FIXTURE_AGENTS[0].key)).toHaveLength(1);
    arena.destroy();
  });

  it('advances a parabolic ley-line trip with deterministic ticks', async () => {
    const arena = new PentacleArena3D();
    const avatar = arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0])!;
    const source = avatar.position.clone();
    const target = arena.zones.get(1)!.position;
    const completed = arena.moveAvatarToZone(FIXTURE_AGENTS[0].key, 1, 1000);
    arena.update(0.5);
    expect(arena.moveAvatarToZone(FIXTURE_AGENTS[0].key, 1, 1000) === completed).toBe(true);
    expect(arena.avatarRegistry.get(FIXTURE_AGENTS[0].key)!.targetZoneId).toBe(1);
    expect(avatar.position.x).toBeCloseTo((source.x + target.x) / 2, 5);
    expect(avatar.position.y).toBeGreaterThan(source.y + 1);
    expect(avatar.userData.animationState).toBe('travel');
    expect(arena.scene.getObjectByName(`ActiveLeyLine_${FIXTURE_AGENTS[0].key}`)).toBeDefined();
    arena.update(0.5);
    expect(await completed).toBe(true);
    expect(avatar.position.distanceTo(target)).toBeLessThan(0.00001);
    expect(avatar.userData.zoneId).toBe(1);
    expect(arena.avatarRegistry.get(FIXTURE_AGENTS[0].key)!.targetZoneId).toBeUndefined();
    expect(arena.scene.getObjectByName(`ActiveLeyLine_${FIXTURE_AGENTS[0].key}`)).toBeUndefined();
    expect(avatar.userData.animationState).toBe('idle');
    arena.destroy();
  });

  it('routes nonadjacent nodes through existing conduits and cancels retargeted trips', async () => {
    const route = getLeyLineRoute(0, 10);
    expect(route.length).toBeGreaterThan(2);
    for (let index = 1; index < route.length; index++) {
      expect(LEY_LINE_CONNECTIONS.some(([a, b]) =>
        (a === route[index - 1] && b === route[index]) || (b === route[index - 1] && a === route[index]))).toBe(true);
    }
    const arena = new PentacleArena3D();
    const avatar = arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0])!;
    const oldTrip = arena.moveAvatarToZone(FIXTURE_AGENTS[0].key, 10, 1000);
    arena.update(0.25);
    const beforeRetarget = avatar.position.clone();
    const newTrip = arena.moveAvatarToZone(FIXTURE_AGENTS[0].key, 2, 1000);
    expect(avatar.position.distanceTo(beforeRetarget)).toBeLessThan(0.00001);
    expect(await oldTrip).toBe(false);
    arena.update(1);
    expect(await newTrip).toBe(true);
    expect(avatar.position.distanceTo(arena.zones.get(2)!.position)).toBeLessThan(0.00001);
    expect(arena.avatarRegistry.size).toBe(1);
    arena.destroy();
  });

  it('assembles contest actors before clashing without changing authoritative control', async () => {
    const arena = new PentacleArena3D();
    arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0]);
    arena.placeAvatarOnZone(2, FIXTURE_AGENTS[3]);
    arena.updateZoneStatus(1, 3, 475);
    const contest = arena.animateZoneContest(1, FIXTURE_AGENTS[0].key, FIXTURE_AGENTS[3].key);
    arena.update(0.45);
    const attacker = arena.avatarRegistry.get(FIXTURE_AGENTS[0].key)!.group;
    const defender = arena.avatarRegistry.get(FIXTURE_AGENTS[3].key)!.group;
    expect(attacker.position.distanceTo(defender.position)).toBeCloseTo(2.2, 5);
    expect(attacker.userData.animationState).toBe('contest-attack');
    expect(defender.userData.animationState).toBe('contest-defend');
    expect(arena.zones.get(1)!.owner).toBe(3);
    expect(arena.zones.get(1)!.control).toBe(475);
    arena.update(1.8);
    await contest;
    expect(attacker.userData.animationState).toBe('idle');
    expect(defender.userData.animationState).toBe('idle');
    arena.destroy();
  });

  it('keeps additional melee participants alive and disposes removed resources', () => {
    const arena = new PentacleArena3D();
    const first = arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0])!;
    arena.placeAvatarOnZone(0, FIXTURE_AGENTS[1], 'challenger');
    arena.placeAvatarOnZone(0, FIXTURE_AGENTS[2]);
    expect(arena.avatarRegistry.size).toBe(3);
    expect(first.parent === arena.scene).toBe(true);
    let disposed = false;
    (first.getObjectByName('TorsoMesh') as THREE.Mesh).geometry.addEventListener('dispose', () => { disposed = true; });
    arena.removeAvatar(FIXTURE_AGENTS[0].key);
    expect(disposed).toBe(true);
    expect(first.parent).toBeNull();
    expect(arena.avatarRegistry.size).toBe(2);
    arena.destroy();
    expect(arena.avatarRegistry.size).toBe(0);
    expect(arena.scene.children).toHaveLength(0);
  });

  it('keeps access barriers visible while flux effects change', () => {
    const arena = new PentacleArena3D();
    const zone = arena.zones.get(5)!;
    arena.updateZoneBarrier(5, true);
    arena.updateZoneFlux(5, true, 750);
    expect(zone.barrierMesh!.visible).toBe(true);
    arena.updateZoneFlux(5, false, 0);
    expect(zone.barrierMesh!.visible).toBe(true);
    arena.updateZoneBarrier(5, false);
    expect(zone.barrierMesh!.visible).toBe(false);
    arena.destroy();
  });

  it('keeps one browser loop and cancels active movement on destruction', async () => {
    const originalRequest = globalThis.requestAnimationFrame;
    const originalCancel = globalThis.cancelAnimationFrame;
    let requests = 0;
    let cancelled: number | undefined;
    globalThis.requestAnimationFrame = () => ++requests;
    globalThis.cancelAnimationFrame = id => { cancelled = id; };
    try {
      const arena = new PentacleArena3D();
      arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0]);
      const movement = arena.moveAvatarToZone(FIXTURE_AGENTS[0].key, 10);
      arena.startLoop();
      arena.startLoop();
      expect(requests).toBe(1);
      arena.destroy();
      expect(cancelled).toBe(1);
      expect(await movement).toBe(false);
      arena.destroy();
      arena.startLoop();
      expect(requests).toBe(1);
    } finally {
      globalThis.requestAnimationFrame = originalRequest;
      globalThis.cancelAnimationFrame = originalCancel;
    }
  });
});
