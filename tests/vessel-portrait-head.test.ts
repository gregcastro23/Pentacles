import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { attachPortraitHead, createPortraitFace, validatePortraitFace, type PortraitFaceData } from '../src/lib/agents/vessel-portrait-head';
import { HISTORICAL_PORTRAITS } from '../src/lib/agents/historical-portraits';
import { HISTORICAL_AGENTS } from '../src/alchm-chart/historical-agents.js';
import { resolveAgentAppearance } from '../src/lib/agents/vessel-appearance-manifest';
import { createVesselAvatarMesh, disposeVesselAvatar, refreshVesselFromPayload } from '../src/lib/agents/vessel-avatar-3d';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';

const data = (key = 'joan-of-arc'): PortraitFaceData => JSON.parse(readFileSync(new URL(`../public/avatars/faces/${key}.json`, import.meta.url), 'utf8'));
function fixture() {
  const avatar = new THREE.Group(), head = new THREE.Group(), eyes = new THREE.Group(), hair = new THREE.Group();
  const solid = new THREE.Group(), features = new THREE.Group(), circlet = new THREE.Group();
  solid.name = 'HeadMesh'; features.name = 'FacialFeatures'; circlet.name = 'CircletMesh';
  features.add(eyes); head.add(solid, features, circlet, hair); avatar.add(head);
  avatar.userData.headGroup = head; avatar.userData.eyesGroup = eyes; avatar.userData.silhouette = {head:hair};
  return { avatar, head, solid, features, eyes, hair, circlet };
}
const resources = (group: THREE.Group) => {
  const owned = new Set<THREE.Material | THREE.BufferGeometry>();
  group.traverse(node => {
    if (node instanceof THREE.Mesh) { owned.add(node.geometry); (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => owned.add(m)); }
  });
  return [...owned];
};

describe('Portrait-derived 3D heads', () => {
  it('ships a measured face and matching profile portrait for every canonical historical identity', () => {
    expect(Object.keys(HISTORICAL_PORTRAITS).sort()).toEqual(HISTORICAL_AGENTS.map(agent => agent.key).sort());
    const fingerprints = new Set<string>();
    for (const agent of HISTORICAL_AGENTS) {
      const url = HISTORICAL_PORTRAITS[agent.key];
      expect(resolveAgentAppearance(agent.key, agent.faction, agent.title).portraitUrl).toBe(url);
      const bytes = readFileSync(new URL(`../public${url}`, import.meta.url));
      const asset = validatePortraitFace(data(agent.key));
      expect(asset.sourceSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      fingerprints.add(JSON.stringify(asset.positions));
      const face = createPortraitFace(asset);
      const skin = face.getObjectByName('SculptedFaceMesh') as THREE.Mesh;
      const box = skin.geometry.boundingBox!;
      expect(box.max.z - box.min.z).toBeGreaterThan(.4);
      expect(skin.geometry.getAttribute('uv')).toBeUndefined();
      expect([...skin.geometry.getAttribute('normal').array].every(Number.isFinite)).toBe(true);
      const positions = skin.geometry.getAttribute('position').array;
      expect(asset.positions.every((value, i) => Math.abs(positions[i] - value) < 1e-6)).toBe(true);
      const normals = skin.geometry.getAttribute('normal');
      expect(Array.from({ length: normals.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(normals, i).length())
        .every(length => Math.abs(length - 1) < 1e-5)).toBe(true);
      face.traverse(node => {
        if (node instanceof THREE.Mesh) expect((node.material as THREE.MeshStandardMaterial).map).toBeNull();
      });
      resources(face).forEach(resource => resource.dispose());
    }
    expect(fingerprints.size).toBe(71);
  });

  it('attaches actual mesh geometry to the animated head and restores the fallback on disposal', async () => {
    const { avatar, head, solid, features, eyes, hair, circlet } = fixture();
    const attachment = attachPortraitHead(avatar, 'joan-of-arc', async () => data());
    await attachment.ready;
    expect(solid.visible || features.visible || circlet.visible).toBe(false);
    const face = head.getObjectByName('PortraitDerivedHead')!;
    head.rotation.y = Math.PI / 2;
    const nose = (face.getObjectByName('SculptedFaceMesh') as THREE.Mesh).geometry.getAttribute('position');
    const localNose = new THREE.Vector3().fromBufferAttribute(nose, 1);
    const rotatedNose = face.localToWorld(localNose.clone());
    expect(rotatedNose.x).toBeCloseTo(localNose.z);
    expect(avatar.userData.eyesGroup).not.toBe(eyes);
    expect(hair.position.z).toBeLessThan(0);
    attachment.dispose();
    expect(solid.visible && features.visible && circlet.visible).toBe(true);
    expect(head.getObjectByName('PortraitDerivedHead')).toBeUndefined();
    expect(avatar.userData.eyesGroup).toBe(eyes);
    expect(hair.position.z).toBe(0);
  });

  it('keeps the original head usable when loading or validation fails', async () => {
    for (const load of [async () => { throw new Error('404'); }, async () => ({...data(), positions:[NaN]})]) {
      const { avatar, head, solid, features } = fixture();
      const attachment = attachPortraitHead(avatar, 'joan-of-arc', load);
      await attachment.ready;
      expect(head.getObjectByName('PortraitDerivedHead')).toBeUndefined();
      expect(solid.visible && features.visible).toBe(true);
      attachment.dispose();
    }
  });

  it('rejects non-finite, incomplete and unbounded geometry before allocating the model', () => {
    const bad = data(); bad.positions[0] = Infinity;
    expect(() => createPortraitFace(bad)).toThrow('Invalid portrait face asset');
    expect(() => validatePortraitFace({...data(), irises:[]})).toThrow();
    expect(() => validatePortraitFace({...data(), skin:[900,0,0]})).toThrow();
  });

  it('does not resurrect an avatar when its face finishes loading after removal', async () => {
    for (const disposeOwner of [false, true]) {
      const { avatar, head } = fixture();
      let complete!: (face: PortraitFaceData) => void;
      const pending = new Promise<PortraitFaceData>(resolve => { complete = resolve; });
      const attachment = attachPortraitHead(avatar, 'joan-of-arc', () => pending);
      if (disposeOwner) avatar.userData.disposed = true; else attachment.dispose();
      complete(data()); await attachment.ready; attachment.dispose();
      expect(head.getObjectByName('PortraitDerivedHead')).toBeUndefined();
    }
  });

  it('releases owned GPU resources once and preserves previously hidden features', async () => {
    const { avatar, head, features } = fixture(); features.visible = false;
    const attachment = attachPortraitHead(avatar, 'joan-of-arc', async () => data());
    await attachment.ready;
    const owned = resources(head.getObjectByName('PortraitDerivedHead') as THREE.Group);
    const releases = owned.map(() => 0);
    owned.forEach((resource, i) => resource.addEventListener('dispose', () => { releases[i]++; }));
    attachment.dispose(); attachment.dispose();
    expect(releases.every(n => n === 1)).toBe(true);
    expect(features.visible).toBe(false);
  });

  it('preserves the measured face during appearance refresh and releases it through the shared avatar lifecycle', async () => {
    const payload = structuredClone(FIXTURE_AGENTS[0]);
    const avatar = createVesselAvatarMesh(payload, { loadPortraitFace: false });
    const handle = avatar.userData.portraitHead = attachPortraitHead(avatar, payload.key, async () => data(payload.key));
    await handle.ready;
    const face = avatar.getObjectByName('PortraitDerivedHead') as THREE.Group;
    const owned = resources(face); const releases = owned.map(() => 0);
    owned.forEach((resource, i) => resource.addEventListener('dispose', () => { releases[i]++; }));
    payload.appearance = resolveAgentAppearance(payload.key);
    payload.appearance.paletteOverrides.hairOrCrownHex = '#555555';
    refreshVesselFromPayload(avatar, payload);
    expect(avatar.getObjectByName('PortraitDerivedHead')).toBe(face);
    expect(avatar.userData.silhouette.head.position.z).toBeCloseTo(-.18);
    disposeVesselAvatar(avatar); disposeVesselAvatar(avatar);
    expect(releases.every(n => n === 1)).toBe(true);
  });

  it('keeps long beards visible in front of the collar after fitting and restores their authored placement', async () => {
    for (const key of ['leonardo-da-vinci', 'charles-darwin-1809']) {
      const payload = structuredClone(FIXTURE_AGENTS[0]); payload.key = key;
      payload.appearance = resolveAgentAppearance(key);
      const avatar = createVesselAvatarMesh(payload, { loadPortraitFace: false });
      const head = avatar.userData.headGroup as THREE.Group;
      const fit = avatar.getObjectByName(key === 'leonardo-da-vinci' ? 'PolymathBeardFit' : 'DarwinBeardFit')!;
      const before = fit.position.clone();
      const handle = avatar.userData.portraitHead = attachPortraitHead(avatar, key, async () => data(key));
      try {
        await handle.ready; avatar.updateMatrixWorld(true);
        const ray = new THREE.Raycaster(head.localToWorld(new THREE.Vector3(0, -.48, 4)), new THREE.Vector3(0, 0, -1));
        const hit = ray.intersectObjects([fit, avatar.userData.silhouette.garment], true)[0];
        expect(hit?.object.parent).toBe(fit);
        handle.dispose(); expect(fit.position.equals(before)).toBe(true);
      } finally { disposeVesselAvatar(avatar); }
    }
  });

  it('does not place a randomly generated beard over a measured historical likeness', async () => {
    const payload = structuredClone(FIXTURE_AGENTS[0]); payload.key = 'joan-of-arc';
    payload.appearance = resolveAgentAppearance(payload.key);
    payload.appearance.modularTraits!.faceAccent = 'philosopher-beard';
    const avatar = createVesselAvatarMesh(payload, { loadPortraitFace: false });
    const accent = avatar.getObjectByName('ProceduralFaceAccent')!;
    expect(accent.visible).toBe(true);
    const handle = avatar.userData.portraitHead = attachPortraitHead(avatar, payload.key, async () => data());
    try {
      await handle.ready; expect(accent.visible).toBe(false);
      payload.appearance.paletteOverrides.hairOrCrownHex = '#654321';
      refreshVesselFromPayload(avatar, payload);
      const refreshedAccent = avatar.getObjectByName('ProceduralFaceAccent')!;
      expect(refreshedAccent.visible).toBe(false);
      handle.dispose(); expect(refreshedAccent.visible).toBe(true);
    } finally { disposeVesselAvatar(avatar); }
  });
});
