import { afterEach, describe, it, expect } from 'bun:test';
import * as THREE from 'three';
import {
  createVesselAvatarMesh as createAvatar,
  updateVesselAvatarAnimation,
  pickVesselAvatar,
  getSealShardCount,
  SEAL_TIER_HEX_COLORS,
  SACRED_STAT_HEX_COLORS,
  registerCustomModelLoader,
  refreshVesselFromPayload,
  disposeVesselAvatar,
  setVesselAnimationState,
} from '../src/lib/agents/vessel-avatar-3d';
import {
  PentacleArena3D,
  getZonePosition3D,
} from '../src/lib/agents/pentacle-arena-3d';
import {
  FIXTURE_AGENTS,
  type SealTier,
} from '../src/lib/agents/rating-contract';
import { liveWalletSync } from '../src/lib/agents/live-wallet-sync';

const createdAvatars = new Set<THREE.Group>();
function createVesselAvatarMesh(...args: Parameters<typeof createAvatar>): THREE.Group {
  const avatar = createAvatar(...args);
  createdAvatars.add(avatar);
  return avatar;
}
afterEach(() => {
  for (const avatar of createdAvatars) disposeVesselAvatar(avatar);
  createdAvatars.clear();
  liveWalletSync.clearCache();
});

describe('3D Vessel Avatar Mesh & Procedural Animation System', () => {
  describe('Procedural Avatar Hierarchy Generation', () => {
    it('attaches each pilot likeness and held relic to the animated pivots', () => {
      for (const payload of FIXTURE_AGENTS) {
        const avatar = createVesselAvatarMesh(payload);
        const profile = avatar.userData.appearance;
        expect(avatar.getObjectByName(profile.headSilhouette.crownStyle)?.parent).toBe(avatar.userData.headGroup);
        expect(avatar.getObjectByName(profile.garmentSilhouette.mantleStyle)?.parent).toBe(avatar.userData.torsoGroup);
        expect(avatar.getObjectByName(profile.signatureRelic)?.parent).toBe(avatar.userData.rightArm);
        expect(avatar.getObjectByName(profile.signatureRelic)?.position.y).toBeCloseTo(-0.65, 5);
        disposeVesselAvatar(avatar);
      }
    });

    it('creates complete articulated vessel hierarchy with under-foot ring', () => {
      const newton = FIXTURE_AGENTS[0];
      const avatar = createVesselAvatarMesh(newton, { zoneId: 10, slot: 'owner' });

      expect(avatar).toBeInstanceOf(THREE.Group);
      expect(avatar.name).toContain('VesselAvatarRoot_isaac-newton');
      expect(avatar.userData.agentId).toBe('isaac-newton');
      expect(avatar.userData.zoneId).toBe(10);
      expect(avatar.userData.slot).toBe('owner');

      // Check Under-Foot Resonance Ring
      const footRing = avatar.getObjectByName('UnderFootResonanceRing');
      expect(footRing).toBeDefined();
      expect(footRing?.position.y).toBeCloseTo(0.02, 2);

      // Check Articulated Rig and Parts
      const rig = avatar.getObjectByName('ArticulatedVesselRig');
      expect(rig).toBeDefined();

      const torso = rig?.getObjectByName('TorsoCore');
      expect(torso).toBeDefined();
      expect(torso?.getObjectByName('CoreGemMesh')).toBeDefined();

      const head = rig?.getObjectByName('HeadCrown');
      expect(head).toBeDefined();
      expect(head?.getObjectByName('CircletMesh')).toBeDefined();

      expect(rig?.getObjectByName('LeftArm')).toBeDefined();
      expect(rig?.getObjectByName('RightArm')).toBeDefined();
      expect(rig?.getObjectByName('AstralHalo')).toBeDefined();
      expect(rig?.getObjectByName('SealOrbiters')).toBeDefined();
      expect(rig?.getObjectByName('WardShield')).toBeDefined();
    });

    it('ignites Surge Corona pillar when agent resonance surge is active', () => {
      const emily = FIXTURE_AGENTS[1]; // Surge active (tempest, meter: 86)
      const avatarEmily = createVesselAvatarMesh(emily);
      const coronaEmily = avatarEmily.getObjectByName('SurgeCorona');
      expect(coronaEmily).toBeDefined();
      expect(coronaEmily?.getObjectByName('SurgePillar')).toBeDefined();

      const newton = FIXTURE_AGENTS[0]; // Surge inactive (meter: 58)
      const avatarNewton = createVesselAvatarMesh(newton);
      expect(avatarNewton.getObjectByName('SurgeCorona')).toBeUndefined();

      const leo = FIXTURE_AGENTS[2]; // Surge active (equilibrium)
      const avatarLeo = createVesselAvatarMesh(leo);
      const coronaLeo = avatarLeo.getObjectByName('SurgeCorona');
      expect(coronaLeo).toBeDefined();
      expect(coronaLeo?.getObjectByName('SurgePillarInner')).toBeDefined(); // Dual harmonic
    });
  });

  describe('Alchemical Seal Orbiters Mapping', () => {
    it('maps seal tiers to deterministic shard counts (Copper=1 to Celestial=5)', () => {
      expect(getSealShardCount('Copper')).toBe(1);
      expect(getSealShardCount('Silver')).toBe(2);
      expect(getSealShardCount('Gold')).toBe(3);
      expect(getSealShardCount('Astral')).toBe(4);
      expect(getSealShardCount('Celestial')).toBe(5);
    });

    it('populates Seal Orbiters matching agent unlocked seal tiers', () => {
      const leo = FIXTURE_AGENTS[2]; // Leonardo da Vinci
      const avatar = createVesselAvatarMesh(leo);
      const orbitersGroup = avatar.getObjectByName('SealOrbiters') as THREE.Group;
      expect(orbitersGroup).toBeDefined();

      const expectedTotalShards = leo.seals.reduce(
        (sum, s) => sum + getSealShardCount(s.tier),
        0
      );
      expect(orbitersGroup.children.length).toBe(expectedTotalShards);

      // Verify each shard carries metadata
      orbitersGroup.children.forEach((child) => {
        expect(child.userData.sealTier).toBeDefined();
        expect(child.userData.statKey).toBeDefined();
      });
    });
  });

  describe('Procedural Animation Controller State Transitions', () => {
    it('hovers with a trailing ring pulse and faster core while travelling, then resets the ring', () => {
      const travel = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
      const idle = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
      for (let frame = 0; frame < 30; frame++) {
        updateVesselAvatarAnimation(travel, 1 / 60, 50, 'travel');
        updateVesselAvatarAnimation(idle, 1 / 60, 50, 'idle');
      }
      expect(travel.userData.torsoGroup.position.y).toBeGreaterThan(idle.userData.torsoGroup.position.y + 0.1);
      expect(Math.abs(travel.userData.coreGem.rotation.y)).toBeGreaterThan(Math.abs(idle.userData.coreGem.rotation.y) * 3);
      const ring = travel.userData.footRing;
      expect(ring.scale.y).toBeGreaterThan(1.25);
      expect(ring.position.z).toBeLessThan(-0.25);
      expect(ring.material.uniforms.uActive.value).toBe(0);
      for (let frame = 0; frame < 180; frame++) updateVesselAvatarAnimation(travel, 1 / 60, 100, 'idle');
      expect(ring.scale.x).toBeCloseTo(1, 8);
      expect(ring.scale.y).toBeCloseTo(1, 8);
      expect(ring.position.z).toBeCloseTo(0, 8);
    });

    it('blends into all five animation states', () => {
      const newton = FIXTURE_AGENTS[0];
      const avatar = createVesselAvatarMesh(newton);
      const torso = avatar.userData.torsoGroup as THREE.Group;
      const wardShield = avatar.userData.wardShield as THREE.Mesh;
      const settle = (state: any) => {
        setVesselAnimationState(avatar, state);
        for (let frame = 0; frame < 60; frame++) updateVesselAvatarAnimation(avatar, 1 / 60, 50 + frame / 60);
      };

      // 1. Idle state
      updateVesselAvatarAnimation(avatar, 0.016, 0.0, 'idle');
      expect(avatar.userData.animationState).toBe('idle');
      expect(torso.position.z).toBe(0);
      expect(wardShield.scale.x).toBeLessThan(0.01);

      // 2. Surge state (elevated levitation)
      settle('surge');
      expect(avatar.userData.animationState).toBe('surge');
      expect(torso.position.y).toBeGreaterThan(1.5); // levitation above base 1.35

      // 3. Contest-Attack state (forward lunge)
      settle('travel');
      expect(avatar.userData.animationState).toBe('travel');
      expect(torso.rotation.x).toBeGreaterThan(0.15);
      settle('contest-attack');
      expect(avatar.userData.animationState).toBe('contest-attack');
      expect(torso.rotation.x).toBeGreaterThan(0.2); // leaning forward

      // 4. Contest-Defend state (ward shield expansion)
      settle('contest-defend');
      expect(avatar.userData.animationState).toBe('contest-defend');
      expect(wardShield.scale.x).toBeGreaterThan(0.8); // expanded ward shield
      disposeVesselAvatar(avatar);
    });

    it('returns every pose axis to idle without retaining combat offsets over repeated cycles', () => {
      const avatar = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
      const control = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
      for (let cycle = 0; cycle < 8; cycle++) {
        for (const state of ['surge', 'travel', 'contest-attack', 'contest-defend'] as const) {
          setVesselAnimationState(avatar, state);
          for (let frame = 0; frame < 25; frame++) updateVesselAvatarAnimation(avatar, 1 / 60, 900 + cycle);
        }
      }
      // A direct public metadata change must reset phase just like the setter.
      avatar.userData.animationState = 'idle';
      for (let frame = 0; frame < 180; frame++) {
        updateVesselAvatarAnimation(avatar, 1 / 60, 5000 + frame);
        updateVesselAvatarAnimation(control, 1 / 60, frame);
      }
      expect(avatar.userData.stateElapsed).toBeCloseTo(3, 5);
      for (const key of ['torsoGroup', 'headGroup', 'leftArm', 'rightArm']) {
        expect(avatar.userData[key].position.distanceTo(control.userData[key].position)).toBeLessThan(0.00001);
        expect(avatar.userData[key].quaternion.angleTo(control.userData[key].quaternion)).toBeLessThan(0.00001);
      }
      expect(avatar.userData.headGroup.position.z).toBeCloseTo(0, 8);
      disposeVesselAvatar(avatar);
      disposeVesselAvatar(control);
    });

    it('starts an attack from the same local phase regardless of arena uptime', () => {
      const early = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
      const late = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
      for (let frame = 0; frame < 30; frame++) {
        updateVesselAvatarAnimation(early, 1 / 60, frame / 60, 'contest-attack');
        updateVesselAvatarAnimation(late, 1 / 60, 100000 + frame / 60, 'contest-attack');
      }
      expect(early.userData.headGroup.position.distanceTo(late.userData.headGroup.position)).toBe(0);
      expect(early.userData.stateElapsed).toBeCloseTo(0.5, 6);
      disposeVesselAvatar(early);
      disposeVesselAvatar(late);
    });
  });

  describe('Live vessel body refresh and external model ownership', () => {
    it('disposes attached badge textures and shared materials once', () => {
      const avatar = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
      const texture = new THREE.Texture();
      const material = new THREE.SpriteMaterial({ map: texture });
      let textureDisposals = 0;
      let materialDisposals = 0;
      texture.addEventListener('dispose', () => textureDisposals++);
      material.addEventListener('dispose', () => materialDisposals++);
      avatar.add(new THREE.Sprite(material), new THREE.Sprite(material));
      disposeVesselAvatar(avatar);
      disposeVesselAvatar(avatar);
      expect(textureDisposals).toBe(1);
      expect(materialDisposals).toBe(1);
    });

    it('refreshes seal geometry, corona, resting state and ring from the same payload', () => {
      const payload = structuredClone(FIXTURE_AGENTS[0]);
      const avatar = createVesselAvatarMesh(payload);
      const oldSealCount = avatar.userData.sealOrbiters.children.length;
      payload.seals[0].tier = 'Copper';
      payload.surge = { ...payload.surge, active: true, meter: 90, surgeType: 'equilibrium' };
      payload.esms.spirit = 250;
      refreshVesselFromPayload(avatar, payload);
      expect(avatar.userData.sealOrbiters.children.length).toBeLessThan(oldSealCount);
      expect(avatar.getObjectByName('SurgePillarInner')).toBeDefined();
      expect(avatar.userData.animationState).toBe('surge');
      expect(avatar.userData.footRing.material.uniforms.uActive.value).toBe(1);
      payload.surge.active = false;
      refreshVesselFromPayload(avatar, payload);
      expect(avatar.getObjectByName('SurgeCorona')).toBeUndefined();
      expect(avatar.userData.animationState).toBe('idle');
      disposeVesselAvatar(avatar);
    });

    it('normalizes and grounds an external scene, advances clips, and leaves fallback pivots alone', async () => {
      const scene = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshBasicMaterial());
      body.name = 'ExternalBody';
      body.position.set(5, 8, -3);
      scene.add(body);
      const clip = new THREE.AnimationClip('idle', 1, [new THREE.NumberKeyframeTrack('ExternalBody.rotation[y]', [0, 1], [0, 1])]);
      registerCustomModelLoader(async () => ({ scene, animations: [clip] }));
      const avatar = createVesselAvatarMesh({ ...FIXTURE_AGENTS[0], avatarModelUrl: '/test-avatar.glb' }, { loadModelAsync: true });
      try {
        await avatar.userData.modelReady;
        const bounds = new THREE.Box3().setFromObject(avatar.userData.externalModel);
        expect(bounds.min.y).toBeCloseTo(0, 6);
        expect(bounds.getSize(new THREE.Vector3()).y).toBeCloseTo(2.7, 6);
        expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(0, 6);
        const restY = avatar.userData.torsoGroup.position.y;
        updateVesselAvatarAnimation(avatar, 0.1, 500, 'surge');
        expect(avatar.userData.mixer.time).toBeCloseTo(0.1, 6);
        expect(avatar.userData.torsoGroup.position.y).toBe(restY);
        expect(body.rotation.y).toBeGreaterThan(0);
      } finally {
        disposeVesselAvatar(avatar);
        registerCustomModelLoader(null);
      }
    });

    it('keeps normalization outside root position and scale animation tracks', async () => {
      const scene = new THREE.Group();
      scene.position.set(5, 8, -3);
      scene.scale.set(2, 2, 2);
      scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial()));
      const clip = new THREE.AnimationClip('idle', 1, [
        new THREE.VectorKeyframeTrack('.position', [0, 1], [5, 8, -3, 5, 8, -3]),
        new THREE.VectorKeyframeTrack('.scale', [0, 1], [2, 2, 2, 2, 2, 2]),
      ]);
      registerCustomModelLoader(async () => ({ scene, animations: [clip] }));
      const avatar = createVesselAvatarMesh({ ...FIXTURE_AGENTS[0], avatarModelUrl: '/root-tracks.glb' }, { loadModelAsync: true });
      try {
        await avatar.userData.modelReady;
        const wrapper = avatar.userData.externalModel as THREE.Group;
        const originalWrapperScale = wrapper.scale.clone();
        updateVesselAvatarAnimation(avatar, 0.1, 0.1);
        const bounds = new THREE.Box3().setFromObject(wrapper);
        expect(scene.position.toArray()).toEqual([5, 8, -3]);
        expect(scene.scale.toArray()).toEqual([2, 2, 2]);
        expect(wrapper.scale.equals(originalWrapperScale)).toBe(true);
        expect(bounds.min.y).toBeCloseTo(0, 6);
        expect(bounds.getSize(new THREE.Vector3()).y).toBeCloseTo(2.7, 6);
        expect(bounds.getCenter(new THREE.Vector3()).x).toBeCloseTo(0, 6);
      } finally { registerCustomModelLoader(null); }
    });

    it('disposes a late model response without attaching it to a removed avatar', async () => {
      let finish!: (value: { scene: THREE.Group }) => void;
      const model = new THREE.Group();
      const geometry = new THREE.BoxGeometry(1, 2, 1);
      let disposalCount = 0;
      geometry.addEventListener('dispose', () => disposalCount++);
      model.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial()));
      registerCustomModelLoader(() => new Promise((resolve) => { finish = resolve; }));
      const avatar = createVesselAvatarMesh({ ...FIXTURE_AGENTS[0], avatarModelUrl: '/late-avatar.glb' }, { loadModelAsync: true });
      try {
        await Promise.resolve();
        disposeVesselAvatar(avatar);
        finish({ scene: model });
        await avatar.userData.modelReady;
        expect(avatar.getObjectByName('ExternalGLTFModel')).toBeUndefined();
        expect(disposalCount).toBe(1);
        disposeVesselAvatar(avatar);
        expect(disposalCount).toBe(1);
      } finally { registerCustomModelLoader(null); }
    });
  });

  describe('Dual-Avatar Pedestal Positioning Across 11 Zones', () => {
    it('offsets owner and challenger symmetrically across all 11 zones by ±1.1 units', () => {
      const arena = new PentacleArena3D();

      for (let zoneId = 0; zoneId <= 10; zoneId++) {
        const owner = FIXTURE_AGENTS[0];
        const challenger = FIXTURE_AGENTS[3];

        const ownerMesh = arena.placeAvatarOnZone(zoneId, owner, 'owner');
        const challengerMesh = arena.placeAvatarOnZone(zoneId, challenger, 'challenger');

        expect(ownerMesh).not.toBeNull();
        expect(challengerMesh).not.toBeNull();

        const zone = arena.zones.get(zoneId)!;
        const P = zone.position;

        // Distance between avatars should be ~2.2 units (±1.1 along tangent)
        const distance = ownerMesh!.position.distanceTo(challengerMesh!.position);
        expect(distance).toBeCloseTo(2.2, 1);

        // Midpoint should be approximately the zone center
        const midX = (ownerMesh!.position.x + challengerMesh!.position.x) / 2;
        const midZ = (ownerMesh!.position.z + challengerMesh!.position.z) / 2;
        expect(midX).toBeCloseTo(P.x, 1);
        expect(midZ).toBeCloseTo(P.z, 1);
      }

      arena.destroy();
    });
  });

  describe('Raycasting Selection Helper', () => {
    it('identifies clicked Vessel Avatar from child mesh hierarchy', () => {
      const scene = new THREE.Scene();
      const newton = FIXTURE_AGENTS[0];
      const avatar = createVesselAvatarMesh(newton, { zoneId: 10 });
      scene.add(avatar);

      // Mock raycaster that intersects the torso mesh
      const torsoMesh = avatar.getObjectByName('TorsoMesh')!;
      const mockRaycaster: any = {
        intersectObjects: () => [
          {
            object: torsoMesh,
            point: new THREE.Vector3(0, 1.4, 0),
          },
        ],
      };

      const picked = pickVesselAvatar(mockRaycaster, scene);
      expect(picked).not.toBeNull();
      expect(picked?.agentId).toBe('isaac-newton');
      expect(picked?.zoneId).toBe(10);
      expect(picked?.payload.key).toBe('isaac-newton');
    });
  });
});
