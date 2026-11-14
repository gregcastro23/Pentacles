import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { mergeStaticVesselDetails } from '../src/lib/agents/vessel-static-geometry';
import { createVesselSilhouette } from '../src/lib/agents/vessel-silhouettes';
import { resolveAgentAppearance } from '../src/lib/agents/vessel-appearance-manifest';
import { HISTORICAL_AGENTS } from '../src/alchm-chart/historical-agents.js';
import { FIXTURE_AGENTS, SEAL_TIERS, SACRED_STAT_KEYS } from '../src/lib/agents/rating-contract';
import { PentacleArena3D } from '../src/lib/agents/pentacle-arena-3d';
import { createVesselAvatarMesh, disposeVesselAvatar, pickVesselAvatar, refreshVesselFromPayload,
  setVesselAnimationState, updateVesselAvatarAnimation } from '../src/lib/agents/vessel-avatar-3d';

function meshes(root: THREE.Object3D) {
  const result: THREE.Mesh[] = [];
  root.traverse(node => { if ((node as THREE.Mesh).isMesh) result.push(node as THREE.Mesh); });
  return result;
}
function triangles(root: THREE.Object3D) {
  return meshes(root).reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3, 0);
}
function dispose(root: THREE.Object3D) {
  const geometries = new Set(meshes(root).map(mesh => mesh.geometry));
  const materials = new Set(meshes(root).flatMap(mesh => Array.isArray(mesh.material) ? mesh.material : [mesh.material]));
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
}

describe('Rigid vessel detail merging', () => {
  it('preserves precise shape bounds and triangles for every canonical appearance while reducing meshes', () => {
    let before = 0, after = 0;
    for (const agent of HISTORICAL_AGENTS) {
      const profile = resolveAgentAppearance(agent.key, agent.faction, agent.title);
      const reference = createVesselSilhouette(profile, agent.key, { mergeStaticDetails: false });
      const merged = createVesselSilhouette(profile, agent.key);
      for (const key of Object.keys(reference) as (keyof typeof reference)[]) {
        const a = reference[key]!, b = merged[key]!;
        expect(b.name).toBe(a.name);
        expect(triangles(b)).toBe(triangles(a));
        const aBounds = new THREE.Box3().setFromObject(a, true);
        const bBounds = new THREE.Box3().setFromObject(b, true);
        expect(aBounds.min.distanceTo(bBounds.min)).toBeLessThan(1e-6);
        expect(aBounds.max.distanceTo(bBounds.max)).toBeLessThan(1e-6);
        before += meshes(a).length; after += meshes(b).length;
        dispose(a); dispose(b);
      }
    }
    expect(after).toBeLessThan(before * .8);
  });

  it('keeps joint boundaries, transparent details and mirrored meshes separate, and retires only unreferenced geometry', () => {
    const root = new THREE.Group(), joint = new THREE.Group();
    const material = new THREE.MeshStandardMaterial();
    const geometry = new THREE.BoxGeometry();
    let retired = 0; geometry.addEventListener('dispose', () => retired++);
    const a = new THREE.Mesh(geometry, material), b = new THREE.Mesh(geometry, material);
    a.position.x = -1; b.position.x = 1; b.rotation.y = .3; b.scale.set(1, 2, .5);
    const mirrored = new THREE.Mesh(geometry, material); mirrored.scale.x = -1;
    const separate = new THREE.Mesh(geometry, material); joint.add(separate);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(), new THREE.MeshBasicMaterial({ transparent: true, opacity: .5 }));
    root.add(a, b, joint, mirrored, glass);
    const bounds = new THREE.Box3().setFromObject(root, true);
    const count = triangles(root);
    mergeStaticVesselDetails(root);
    expect(root.children).toContain(joint);
    expect(separate.parent).toBe(joint);
    expect(glass.parent).toBe(root);
    expect(mirrored.parent).toBe(root);
    expect(root.children).not.toContain(a);
    expect(root.children).not.toContain(b);
    expect(triangles(root)).toBe(count);
    expect(new THREE.Box3().setFromObject(root, true).max.distanceTo(bounds.max)).toBeLessThan(1e-6);
    expect(retired).toBe(0); // Still owned by the unmerged details.
    dispose(root);
    expect(retired).toBe(1);
  });

  it('preserves animation, picking, live appearance refresh and per-avatar material ownership', () => {
    const payload = structuredClone(FIXTURE_AGENTS[0]);
    const merged = createVesselAvatarMesh(payload), reference = createVesselAvatarMesh(payload, { mergeStaticDetails: false });
    try {
      for (const state of ['idle', 'travel', 'contest-attack', 'victory', 'stagger'] as const) {
        for (const avatar of [merged, reference]) { setVesselAnimationState(avatar, state); updateVesselAvatarAnimation(avatar, .2, 1); }
        for (const key of ['headGroup', 'torsoGroup', 'rightHandSocket', 'leftLeg', 'relic']) {
          expect(merged.userData[key].position.equals(reference.userData[key].position)).toBe(true);
          expect(merged.userData[key].quaternion.equals(reference.userData[key].quaternion)).toBe(true);
        }
      }
      const detail = merged.getObjectByName('MergedVesselDetails') as THREE.Mesh;
      expect(detail).toBeDefined();
      const picked = pickVesselAvatar({ intersectObjects: () => [{ object: detail }] } as any, merged);
      expect(picked?.agentId).toBe(payload.key);
      expect(picked?.avatarGroup).toBe(merged);
      const referenceMaterials = new Set(meshes(reference).flatMap(m => Array.isArray(m.material) ? m.material : [m.material]));
      expect(referenceMaterials.has(detail.material as THREE.Material)).toBe(false);
      const previousGeometry = detail.geometry;
      let disposed = 0; previousGeometry.addEventListener('dispose', () => disposed++);
      payload.appearance = resolveAgentAppearance('emily-dickinson');
      refreshVesselFromPayload(merged, payload);
      refreshVesselFromPayload(reference, payload);
      expect(disposed).toBe(1);
      expect(merged.getObjectByName('MergedVesselDetails')).toBeDefined();
      expect(reference.getObjectByName('MergedVesselDetails')).toBeUndefined();
    } finally { disposeVesselAvatar(merged); disposeVesselAvatar(reference); }
  });
});

describe('Canonical seal orbiter batching', () => {
  it('draws every canonical tier with matching colors instead of merely hiding source shards', () => {
    const arena = new PentacleArena3D();
    try {
      for (const [index, tier] of SEAL_TIERS.entries()) {
        const payload = structuredClone(FIXTURE_AGENTS[0]);
        payload.key = `tier-${tier}`;
        payload.seals = [{ ...payload.seals[0], tier }];
        arena.placeAvatarOnZone(index, payload);
      }
      arena.update(.016, 1);
      const expected = new Map(SEAL_TIERS.map(tier => [tier, 0]));
      for (const reg of arena.avatarRegistry.values()) {
        for (const shard of reg.group.userData.sealOrbiters.children as THREE.Mesh[]) {
          expected.set(shard.userData.sealTier, expected.get(shard.userData.sealTier)! + 1);
          const batch = arena.getOrbiterBatcher().getInstancedMesh(shard.userData.sealTier)!;
          expect((batch.material as THREE.MeshStandardMaterial).color.equals((shard.material as THREE.MeshStandardMaterial).color)).toBe(true);
          expect(shard.visible).toBe(false);
        }
      }
      for (const tier of SEAL_TIERS) {
        expect(expected.get(tier)!).toBeGreaterThan(0);
        expect(arena.getOrbiterBatcher().getActiveCount(tier)).toBe(expected.get(tier)!);
      }
      expect([...expected.values()].reduce((a, b) => a + b)).toBeGreaterThan(0);
    } finally { arena.destroy(); }
  });

  it('grows past 120 shards, follows transforms, refreshes bounds, and preserves unknown/hidden-source fallbacks', () => {
    const arena = new PentacleArena3D();
    try {
      for (let i = 0; i < 5; i++) {
        const payload = structuredClone(FIXTURE_AGENTS[0]); payload.key = `capacity-${i}`;
        payload.seals = SACRED_STAT_KEYS.map(statKey => ({ ...payload.seals[0], statKey, tier: 'Celestial' }));
        arena.placeAvatarOnZone(i, payload);
      }
      arena.update(.016, 1);
      const batcher = arena.getOrbiterBatcher();
      const im = batcher.getInstancedMesh('Celestial')!;
      expect(im.count).toBe(175);
      expect(im.instanceMatrix.count).toBeGreaterThanOrEqual(175);
      const first = arena.avatarRegistry.get('capacity-0')!.group;
      const shard = first.userData.sealOrbiters.children[0] as THREE.Mesh;
      first.position.x += 40;
      batcher.container.position.x = 3;
      batcher.update(arena.avatarRegistry.values());
      const matrix = new THREE.Matrix4(); im.getMatrixAt(0, matrix);
      const world = new THREE.Matrix4().multiplyMatrices(batcher.container.matrixWorld, matrix);
      expect(new THREE.Vector3().setFromMatrixPosition(world).distanceTo(shard.getWorldPosition(new THREE.Vector3()))).toBeLessThan(1e-5);
      expect(im.boundingSphere!.containsPoint(new THREE.Vector3().setFromMatrixPosition(matrix))).toBe(true);
      shard.userData.sealTier = 'unknown';
      batcher.update(arena.avatarRegistry.values());
      expect(shard.visible).toBe(true);
      expect(im.count).toBe(174);
      first.visible = false;
      batcher.update(arena.avatarRegistry.values());
      expect(im.count).toBe(140);
      arena.removeAvatar('capacity-0'); arena.removeAvatar('capacity-1');
      expect(batcher.getActiveCount('Celestial')).toBe(0);
      for (const reg of arena.avatarRegistry.values()) {
        expect(reg.group.userData.sealOrbiters.children.every((child: THREE.Mesh) => child.visible)).toBe(true);
      }
    } finally { arena.destroy(); }
  });
});
