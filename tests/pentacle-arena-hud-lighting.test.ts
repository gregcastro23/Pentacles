import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { PentacleArena3D } from '../src/lib/agents/pentacle-arena-3d';
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
});
