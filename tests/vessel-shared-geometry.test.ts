import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import {
  createVesselAvatarMesh,
  disposeVesselAvatar,
  refreshVesselFromPayload,
  setVesselAnimationState,
  updateVesselAvatarAnimation,
} from '../src/lib/agents/vessel-avatar-3d';
import { PentacleArena3D } from '../src/lib/agents/pentacle-arena-3d';
import { FIXTURE_AGENTS, type SealTier } from '../src/lib/agents/rating-contract';
import {
  isSharedVesselGeometry,
  leaseVesselGeometry,
  releaseVesselGeometries,
  sharedVesselGeometryStats,
} from '../src/lib/agents/vessel-shared-geometry';

const geometries = (root: THREE.Object3D) => {
  const found = new Set<THREE.BufferGeometry>();
  root.traverse(node => { const mesh = node as THREE.Mesh; if (mesh.isMesh) found.add(mesh.geometry); });
  return found;
};

describe('Shared procedural vessel geometry', () => {
  it('leases once per owner and disposes on the final release', () => {
    const a = new Set<string>(), b = new Set<string>();
    let disposals = 0;
    const create = () => { const g = new THREE.BoxGeometry(); g.addEventListener('dispose', () => disposals++); return g; };
    const first = leaseVesselGeometry(a, 'probe', create);
    expect(leaseVesselGeometry(a, 'probe', create)).toBe(first);
    expect(leaseVesselGeometry(b, 'probe', create)).toBe(first);
    expect(isSharedVesselGeometry(first)).toBe(true);
    releaseVesselGeometries(a);
    releaseVesselGeometries(a); // Releasing an emptied owner is harmless.
    expect(disposals).toBe(0);
    releaseVesselGeometries(b);
    expect(disposals).toBe(1);
    expect(isSharedVesselGeometry(first)).toBe(false);
    // A later owner receives a fresh, undisposed shape.
    const c = new Set<string>();
    expect(leaseVesselGeometry(c, 'probe', create) === first).toBe(false);
    releaseVesselGeometries(c);
  });

  it('reuses rig shapes across vessels while keeping materials avatar-owned', () => {
    const before = sharedVesselGeometryStats();
    const newton = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
    const dickinson = createVesselAvatarMesh(FIXTURE_AGENTS[1]);
    const torsoA = newton.getObjectByName('TorsoMesh') as THREE.Mesh;
    const torsoB = dickinson.getObjectByName('TorsoMesh') as THREE.Mesh;
    expect(torsoA.geometry).toBe(torsoB.geometry);
    expect(torsoA.material === torsoB.material).toBe(false);
    // All seal shards on one vessel draw the same octahedron.
    const shards = (newton.userData.sealOrbiters as THREE.Group).children as THREE.Mesh[];
    expect(new Set(shards.map(shard => shard.geometry)).size).toBe(1);
    const sharedA = [...geometries(newton)].filter(isSharedVesselGeometry);
    expect(sharedA.length).toBeGreaterThanOrEqual(17);
    disposeVesselAvatar(newton);
    expect(torsoB.geometry.attributes.position.count).toBeGreaterThan(0);
    expect(isSharedVesselGeometry(torsoB.geometry)).toBe(true);
    disposeVesselAvatar(dickinson);
    expect(sharedVesselGeometryStats()).toEqual(before);
  });

  it('keeps shared shards and corona leased through refresh, then releases them', () => {
    const before = sharedVesselGeometryStats();
    const payload = structuredClone(FIXTURE_AGENTS[0]);
    const avatar = createVesselAvatarMesh(payload);
    const tiers: SealTier[] = ['Celestial', 'Astral'];
    payload.seals = payload.seals.slice(0, 2).map((seal, index) => ({ ...seal, tier: tiers[index] }));
    payload.surge = { ...payload.surge, active: true, surgeType: 'equilibrium' };
    refreshVesselFromPayload(avatar, payload);
    const shards = (avatar.userData.sealOrbiters as THREE.Group).children as THREE.Mesh[];
    expect(shards).toHaveLength(9);
    expect(shards.every(shard => isSharedVesselGeometry(shard.geometry))).toBe(true);
    const corona = avatar.userData.surgeCorona as THREE.Group;
    expect(corona.children).toHaveLength(2);
    corona.children.forEach(child => expect(isSharedVesselGeometry((child as THREE.Mesh).geometry)).toBe(true));
    disposeVesselAvatar(avatar);
    disposeVesselAvatar(avatar);
    expect(sharedVesselGeometryStats()).toEqual(before);
  });

  it('frees every shared shape when an arena is destroyed', () => {
    const before = sharedVesselGeometryStats();
    const arena = new PentacleArena3D();
    for (let i = 0; i < 12; i++) {
      const agent = structuredClone(FIXTURE_AGENTS[i % FIXTURE_AGENTS.length]);
      agent.key = `shared-${i}`;
      arena.placeAvatarOnZone(i % 11, agent);
    }
    const all = new Set<THREE.BufferGeometry>();
    arena.scene.traverse(node => { const mesh = node as THREE.Mesh; if (mesh.isMesh) all.add(mesh.geometry); });
    const shared = [...all].filter(isSharedVesselGeometry);
    // Twelve vessels draw from one small set of rig shapes rather than 12 copies.
    expect(shared.length).toBeLessThanOrEqual(sharedVesselGeometryStats().geometries);
    expect(sharedVesselGeometryStats().leases - before.leases).toBeGreaterThan(shared.length);
    arena.destroy();
    expect(sharedVesselGeometryStats()).toEqual(before);
  });
});

describe('Ward shield draw policy', () => {
  it('skips the transparent ward until a defensive pose fades it in', () => {
    const avatar = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
    const ward = avatar.userData.wardShield as THREE.Mesh;
    const material = ward.material as THREE.MeshBasicMaterial;
    expect(ward.visible).toBe(false);
    updateVesselAvatarAnimation(avatar, 1 / 60, 0);
    expect(ward.visible).toBe(false);
    setVesselAnimationState(avatar, 'contest-defend');
    updateVesselAvatarAnimation(avatar, 1 / 60, 0);
    expect(ward.visible).toBe(true);
    for (let i = 0; i < 30; i++) updateVesselAvatarAnimation(avatar, 1 / 60, 0);
    expect(material.opacity).toBeGreaterThan(0.5);
    setVesselAnimationState(avatar, 'idle');
    for (let i = 0; i < 120; i++) updateVesselAvatarAnimation(avatar, 1 / 60, 0);
    expect(material.opacity).toBe(0);
    expect(ward.visible).toBe(false);
    disposeVesselAvatar(avatar);
  });
});

