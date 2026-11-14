import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { PentacleArena3D, getZonePosition3D } from '../src/lib/agents/pentacle-arena-3d';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';

describe('Pentacle arena HiDPI badges, PMREM lighting, hover and camera focus', () => {
  it('creates HiDPI overhead badge sprites with crisp pixel ratio and mipmapping', () => {
    const arena = new PentacleArena3D();
    const group = arena.placeAvatarOnZone(0, FIXTURE_AGENTS[0])!;
    const badge = group.getObjectByName('VesselIdentityBadge') as THREE.Sprite;
    expect(badge).toBeDefined();
    expect(badge.scale.x).toBeCloseTo(3.2);
    expect(badge.scale.y).toBeCloseTo(1.6);
    arena.destroy();
  });

  it('provides hover feedback with emissive torso highlight and foot ring boost', () => {
    const arena = new PentacleArena3D();
    const agent = FIXTURE_AGENTS[0];
    const group = arena.placeAvatarOnZone(0, agent)!;
    const torsoMesh = group.userData.torsoGroup?.getObjectByName('TorsoMesh') as THREE.Mesh;
    const footRing = group.userData.footRing as THREE.Mesh;
    const torsoMat = torsoMesh.material as THREE.MeshStandardMaterial;

    // Baseline unhovered
    arena.hoveredAgentId = null;
    arena.update(0.016);
    const baseEmissive = torsoMat.emissiveIntensity;
    expect(baseEmissive).toBeCloseTo(0.25, 2);

    // Hovered
    arena.hoveredAgentId = agent.key;
    arena.update(0.016);
    expect(torsoMat.emissiveIntensity).toBeCloseTo(0.60, 2); // 0.25 + 0.35 boost
    expect(footRing.scale.x).toBeGreaterThan(1.0);

    // Unhovered again
    arena.hoveredAgentId = null;
    arena.update(0.016);
    expect(torsoMat.emissiveIntensity).toBeCloseTo(0.25, 2);

    arena.destroy();
  });

  it('smoothly transitions camera focus to seated avatar and resets on clearSelection', () => {
    const arena = new PentacleArena3D();
    const agent = FIXTURE_AGENTS[0];
    const group = arena.placeAvatarOnZone(0, agent)!;

    const initialCameraPos = arena.camera.position.clone();
    expect(initialCameraPos.y).toBeCloseTo(26);
    expect(initialCameraPos.z).toBeCloseTo(38);

    // Select seated avatar
    arena.selectAgent(agent.key);
    expect(arena.cameraFocusTarget).toBeDefined();
    const targetPos = arena.cameraFocusTarget!.position.clone();
    expect(targetPos.y).toBeCloseTo(group.position.y + 3.8);

    // Advance camera smoothly
    arena.update(0.5);
    expect(arena.camera.position.distanceTo(initialCameraPos)).toBeGreaterThan(1.0);
    expect(arena.camera.position.distanceTo(targetPos)).toBeLessThan(initialCameraPos.distanceTo(targetPos));

    // Clear selection smoothly returns to default pose
    arena.clearSelection();
    expect(arena.cameraFocusTarget).toBeDefined();
    expect(arena.cameraFocusTarget!.position.y).toBeCloseTo(26);
    expect(arena.cameraFocusTarget!.position.z).toBeCloseTo(38);

    // Fully advance back
    for (let i = 0; i < 20; i++) arena.update(0.2);
    expect(arena.camera.position.y).toBeCloseTo(26, 1);
    expect(arena.camera.position.z).toBeCloseTo(38, 1);

    arena.destroy();
  });

  it('focuses camera on zone node when selecting unoccupied pedestal', () => {
    const arena = new PentacleArena3D();
    const zonePos = arena.zones.get(10)!.position; // Crown summit

    arena.selectZone(10);
    expect(arena.cameraFocusTarget).toBeDefined();
    expect(arena.cameraFocusTarget!.lookAt.y).toBeCloseTo(zonePos.y + 1.2);
    expect(arena.cameraFocusTarget!.position.y).toBeCloseTo(zonePos.y + 4.8);

    arena.destroy();
  });

  it('keeps the hovered foot ring boost bounded with motion off', () => {
    const arena = new PentacleArena3D();
    const agent = FIXTURE_AGENTS[0];
    const ring = arena.placeAvatarOnZone(0, agent)!.userData.footRing as THREE.Mesh;
    arena.motionEnabled = false;
    arena.hoveredAgentId = agent.key;
    // Reduced motion previously compounded 8% per update: ~101× after one second.
    for (let i = 0; i < 120; i++) arena.update(1 / 60);
    expect(ring.scale.x).toBeCloseTo(1.08, 6);
    arena.hoveredAgentId = null;
    for (let i = 0; i < 120; i++) arena.update(1 / 60);
    expect(ring.scale.x).toBeCloseTo(1, 3);
    arena.destroy();
  });

  it('applies the same hover boost at 15 and 60 updates per second', () => {
    const settle = (fps: number) => {
      const arena = new PentacleArena3D();
      const agent = FIXTURE_AGENTS[0];
      const ring = arena.placeAvatarOnZone(0, agent)!.userData.footRing as THREE.Mesh;
      arena.hoveredAgentId = agent.key;
      for (let i = 0; i < fps * 3; i++) arena.update(1 / fps);
      const scale = ring.scale.x;
      arena.destroy();
      return scale;
    };
    // Previously 1.46 at 60 fps and 1.13 at 15 fps.
    expect(settle(60)).toBeCloseTo(1.08, 3);
    expect(settle(15)).toBeCloseTo(1.08, 3);
  });

  it('renders the canonical pentacle floor outline and 3D ley-line conduits aligned to zone topology', () => {
    // Spire I sits due North (-Z) and every Spire k+5 is equidistant from adjacent Houses k and (k+4)%5
    const spire0 = getZonePosition3D(5);
    expect(spire0.x).toBeCloseTo(0, 6);
    expect(spire0.z).toBeCloseTo(-20, 6);
    for (let k = 0; k < 5; k++) {
      const spire = getZonePosition3D(k + 5);
      const houseA = getZonePosition3D(k);
      const houseB = getZonePosition3D((k + 4) % 5);
      expect(spire.distanceTo(houseA)).toBeCloseTo(spire.distanceTo(houseB), 6);
    }

    const arena = new PentacleArena3D();
    const floorGroup = arena.scene.getObjectByName('SacredPentacleFloor');
    expect(floorGroup).toBeDefined();
    for (const name of [
      'SacredPentacleHouseFills',
      'SacredPentacleSpireFills',
      'SacredPentacleCrownFill',
      'SacredPentacleOutline',
      'SacredPentacleRim',
      'SacredPentacleOuterBezel',
    ]) {
      const mesh = floorGroup?.getObjectByName(name) as THREE.Mesh | undefined;
      expect(mesh).toBeDefined();
      expect(mesh?.castShadow).toBe(false);
    }

    const starBeams = arena.scene.getObjectByName('LeyLineStarBeams') as THREE.InstancedMesh | undefined;
    const crownBeams = arena.scene.getObjectByName('LeyLineCrownBeams') as THREE.InstancedMesh | undefined;
    expect(starBeams?.isInstancedMesh).toBe(true);
    expect(starBeams?.count).toBe(15);
    expect(crownBeams?.isInstancedMesh).toBe(true);
    expect(crownBeams?.count).toBe(5);
    expect(starBeams?.castShadow).toBe(false);
    expect(crownBeams?.castShadow).toBe(false);

    // Decorative pentacle meshes never intercept raycasts
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 10, -15), new THREE.Vector3(0, -1, 0));
    expect(raycaster.intersectObject(floorGroup!, true)).toHaveLength(0);
    expect(raycaster.intersectObject(starBeams!, true)).toHaveLength(0);

    arena.destroy();
    expect(arena.scene.children).toHaveLength(0);
  });
});
