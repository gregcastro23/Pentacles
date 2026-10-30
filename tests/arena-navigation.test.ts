import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { ArenaNavigation, courtFrameDistance } from '../src/lib/agents/arena-navigation';
import { PentacleArena3D } from '../src/lib/agents/pentacle-arena-3d';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';

describe('Court inspection', () => {
  it('keeps orbit targets aligned with automatic focus and lets manual navigation take over', () => {
    const arena = new PentacleArena3D();
    const document = new EventTarget();
    Object.assign(arena.renderer.domElement, {
      style: {}, ownerDocument: document, getRootNode: () => document,
    });
    const navigation = new ArenaNavigation(arena);
    try {
      arena.selectZone(0);
      arena.update(0.1);
      navigation.update();
      const expected = arena.cameraLookAt.sub(arena.camera.position).normalize();
      expect(arena.camera.getWorldDirection(new THREE.Vector3()).distanceTo(expected)).toBeLessThan(1e-6);
      navigation.overview();
      const overview = arena.camera.position.clone();
      for (let i = 0; i < 20; i++) { arena.update(0.1); navigation.update(); }
      expect(arena.cameraFocusTarget).toBeNull();
      expect(arena.camera.position.distanceTo(overview)).toBeLessThan(1e-6);
      arena.selectZone(1);
      navigation.controls.dispatchEvent({ type: 'start' });
      expect(arena.cameraFocusTarget).toBeNull();
      arena.selectZone(2);
      navigation.zoom(0.8);
      expect(arena.cameraFocusTarget).toBeNull();
    } finally { navigation.destroy(); arena.destroy(); }
  });

  it('fits the full court inside portrait and landscape viewports', () => {
    for (const aspect of [0.45, 0.8, 1, 1.8, 3]) {
      const radius = 29;
      const distance = courtFrameDistance(aspect, radius);
      const vertical = THREE.MathUtils.degToRad(22.5);
      const horizontal = Math.atan(Math.tan(vertical) * aspect);
      expect(Math.asin(radius / distance)).toBeLessThan(vertical);
      expect(Math.asin(radius / distance)).toBeLessThan(horizontal);
    }
  });

  it('keeps inspection on a moving agent and returns to its territory when removed', async () => {
    const seenAgents: string[] = [], seenZones: number[] = [];
    const arena = new PentacleArena3D({ onSelectAgent: a => seenAgents.push(a.key), onSelectZone: id => seenZones.push(id) });
    const agent = FIXTURE_AGENTS[0];
    const body = arena.placeAvatarOnZone(0, agent)!;
    expect(arena.selectAgent('missing')).toBe(false);
    expect(arena.selectZone(11)).toBe(false);
    expect(arena.selectAgent(agent.key)).toBe(true);
    expect(seenAgents).toEqual([agent.key]);
    const trip = arena.moveAvatarToZone(agent.key, 1, 1000);
    arena.update(0.5);
    const marker = arena.scene.getObjectByName('CourtSelection')!;
    expect(marker.position.x).toBeCloseTo(body.position.x);
    expect(marker.position.y).toBeCloseTo(body.position.y + 0.06);
    arena.update(0.5);
    await trip;
    expect(arena.selection).toEqual({ agentId: agent.key, zoneId: 1 });
    arena.removeAvatar(agent.key);
    expect(arena.selection).toEqual({ zoneId: 1 });
    expect(seenZones).toEqual([1]);
    arena.clearSelection();
    expect(marker.visible).toBe(false);
    arena.destroy();
  });

  it('preserves a usable camera when a hidden container reports zero size', () => {
    const arena = new PentacleArena3D();
    const aspect = arena.camera.aspect;
    arena.resize(0, 0);
    arena.resize(300, Number.NaN);
    expect(arena.camera.aspect).toBe(aspect);
    arena.resize(300, 600);
    expect(arena.camera.aspect).toBe(0.5);
    arena.destroy();
  });

  it('applies live movement and finishes contests with motion disabled', async () => {
    const arena = new PentacleArena3D();
    const first = FIXTURE_AGENTS[0], second = FIXTURE_AGENTS[1];
    arena.placeAvatarOnZone(0, first);
    arena.placeAvatarOnZone(0, second, 'challenger');
    arena.motionEnabled = false;
    const move = arena.moveAvatarToZone(first.key, 1, 900);
    arena.update(0.016);
    expect(await move).toBe(true);
    expect(arena.avatarRegistry.get(first.key)!.zoneId).toBe(1);
    const contest = arena.animateZoneContest(1, first.key, second.key);
    arena.update(0.016);
    await contest;
    expect(arena.avatarRegistry.get(second.key)!.zoneId).toBe(1);
    expect(arena.avatarRegistry.get(first.key)!.group.userData.animationState).toBe('idle');
    arena.destroy();
  });

  it('does not select a territory after dragging the camera', () => {
    const selected: number[] = [];
    const arena = new PentacleArena3D({ onSelectZone: id => selected.push(id) });
    const handlers = new Map<string, Function>();
    arena.renderer.domElement.addEventListener = ((name: string, fn: Function) => handlers.set(name, fn)) as any;
    (arena as any).bindEvents();
    arena.scene.updateMatrixWorld(true);
    arena.camera.updateMatrixWorld(true);
    const center = arena.zones.get(10)!.position.clone().project(arena.camera);
    const clientX = (center.x + 1) * 400, clientY = (1 - center.y) * 300;
    handlers.get('pointerdown')!({ clientX: clientX - 40, clientY });
    handlers.get('pointermove')!({ clientX, clientY });
    handlers.get('pointerup')!({ clientX, clientY });
    handlers.get('click')!({ clientX, clientY, button: 0 });
    expect(selected).toEqual([]);
    handlers.get('pointerdown')!({ clientX, clientY });
    handlers.get('pointerup')!({ clientX, clientY });
    handlers.get('click')!({ clientX, clientY, button: 0 });
    expect(selected).toEqual([10]);
    arena.destroy();
  });
});
