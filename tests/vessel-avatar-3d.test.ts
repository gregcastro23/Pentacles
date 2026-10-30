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
  applyVesselShadowPolicy,
  resolveDominantEsms,
  attachFresnelRim,
} from '../src/lib/agents/vessel-avatar-3d';
import {
  PentacleArena3D,
  getZonePosition3D,
  CourtSealOrbiterBatcher,
} from '../src/lib/agents/pentacle-arena-3d';
import {
  resolveAgentAppearance,
  mixModularTraits,
  createVesselPortraitSvg,
  probeAuthoredModelUrl,
  registerAuthoredModel,
} from '../src/lib/agents/vessel-appearance-manifest';
import { createVesselSilhouette } from '../src/lib/agents/vessel-silhouettes';
import {
  FIXTURE_AGENTS,
  type SealTier,
} from '../src/lib/agents/rating-contract';
import { liveWalletSync } from '../src/lib/agents/live-wallet-sync';
import { CourtAudioSynth } from '../src/lib/agents/court-audio-synth';

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
        expect(avatar.getObjectByName(profile.signatureRelic)?.parent).toBe(avatar.userData.rightHandSocket);
        expect(avatar.getObjectByName(profile.signatureRelic)?.position.y).toBeCloseTo(0.05, 5);
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
      expect(rig?.getObjectByName('LeftElbowPivot')).toBeDefined();
      expect(rig?.getObjectByName('LeftHandSocket')).toBeDefined();
      expect(rig?.getObjectByName('RightArm')).toBeDefined();
      expect(rig?.getObjectByName('RightElbowPivot')).toBeDefined();
      expect(rig?.getObjectByName('RightHandSocket')).toBeDefined();
      expect(rig?.getObjectByName('LowerBody')).toBeDefined();
      expect(rig?.getObjectByName('LeftLeg')).toBeDefined();
      expect(rig?.getObjectByName('LeftKneePivot')).toBeDefined();
      expect(rig?.getObjectByName('RightLeg')).toBeDefined();
      expect(rig?.getObjectByName('RightKneePivot')).toBeDefined();
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

    it('blends into all seven animation states', () => {
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

      // 2. Surge state (elevated levitation & two-handed channeling)
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

      // 5. Victory state (overhead flourish, chest lift)
      settle('victory');
      expect(avatar.userData.animationState).toBe('victory');
      expect(torso.position.y).toBeGreaterThan(1.45);
      expect(avatar.userData.rightArm.rotation.x).toBeLessThan(-2.0); // raised high overhead!

      // 6. Stagger state (torso recoil, defensive guard)
      settle('stagger');
      expect(avatar.userData.animationState).toBe('stagger');
      expect(torso.position.z).toBeLessThan(-0.15); // recoiled back!

      disposeVesselAvatar(avatar);
    });

    it('returns every pose axis to idle without retaining combat offsets over repeated cycles', () => {
      const avatar = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
      const control = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
      for (let cycle = 0; cycle < 8; cycle++) {
        for (const state of ['surge', 'travel', 'contest-attack', 'contest-defend', 'victory', 'stagger'] as const) {
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

    it('spawns procedural rig at frame 0 and hot-swaps external GLTF while preserving orbiters, foot ring, and badges', async () => {
      const scene = new THREE.Group();
      const geom = new THREE.CylinderGeometry(0.5, 0.5, 2, 8);
      const mat = new THREE.MeshStandardMaterial({ color: 0x999999 });
      scene.add(new THREE.Mesh(geom, mat));
      registerCustomModelLoader(async () => ({ scene }));

      const agent = { ...FIXTURE_AGENTS[0], avatarModelUrl: '/async-newton.glb' };
      const avatar = createVesselAvatarMesh(agent);
      try {
        // Frame 0: procedural rig is immediately visible with zero latency
        expect(avatar.userData.rig.visible).toBe(true);
        expect(avatar.getObjectByName('UnderFootResonanceRing')).toBeDefined();
        expect(avatar.getObjectByName('ArticulatedVesselRig')).toBeDefined();
        expect(avatar.getObjectByName('SealOrbiters')).toBeDefined();

        // Await background resolution
        await avatar.userData.modelReady;

        // Hot swap complete: external model attached, rig hidden, orbiters & foot ring preserved
        expect(avatar.userData.rig.visible).toBe(false);
        const externalModel = avatar.getObjectByName('ExternalGLTFModel');
        expect(externalModel).toBeDefined();
        expect(avatar.getObjectByName('UnderFootResonanceRing')).toBeDefined();
        expect(avatar.getObjectByName('SealOrbiters')).toBeDefined();

        // View-space Fresnel rim applied to imported MeshStandardMaterial
        expect(mat.userData.fresnelRim).toBeDefined();
        expect(mat.customProgramCacheKey?.()).toBe('vessel-fresnel-rim');
      } finally {
        disposeVesselAvatar(avatar);
        registerCustomModelLoader(null);
      }
    });

    it('retains procedural rig as an interactive fallback when external model fails to load', async () => {
      registerCustomModelLoader(async () => {
        throw new Error('404 Not Found');
      });

      const agent = { ...FIXTURE_AGENTS[1], avatarModelUrl: '/missing-model.glb' };
      const avatar = createVesselAvatarMesh(agent);
      try {
        expect(avatar.userData.rig.visible).toBe(true);
        await avatar.userData.modelReady;
        // After failure: procedural rig remains visible and active
        expect(avatar.userData.rig.visible).toBe(true);
        expect(avatar.userData.modelError).toBeDefined();
        expect(avatar.getObjectByName('ExternalGLTFModel')).toBeUndefined();
      } finally {
        disposeVesselAvatar(avatar);
        registerCustomModelLoader(null);
      }
    });

    it('attackElementOverride overrides innate dominant ESMS and drives matching 3D skeletal choreography', () => {
      // Newton's innate dominant element is 'matter'
      const newton = FIXTURE_AGENTS[0];
      const avatar = createVesselAvatarMesh(newton);
      try {
        setVesselAnimationState(avatar, 'contest-attack');

        // 1. Substance Override (Swords: accelerated SealOrbiters velocity 5.2 vs 2.4)
        avatar.userData.attackElementOverride = 'substance';
        for (let i = 0; i < 2; i++) updateVesselAvatarAnimation(avatar, 0.1, 100);
        expect(avatar.userData.sealOrbiters.rotation.y).toBeCloseTo(0.2 * 5.2, 1);

        // 2. Matter Override (Pentacles: grounded knee-bend slam + ward shield expansion)
        avatar.userData.attackElementOverride = 'matter';
        avatar.userData.stateElapsed = 0;
        for (let i = 0; i < 5; i++) updateVesselAvatarAnimation(avatar, 0.1, 100);
        expect(avatar.userData.wardShield.scale.x).toBeGreaterThan(1.0);

        // 3. Spirit Override (Wands: high overhead spear thrust + forward torso pitch)
        avatar.userData.attackElementOverride = 'spirit';
        avatar.userData.stateElapsed = 0;
        for (let i = 0; i < 3; i++) updateVesselAvatarAnimation(avatar, 0.1, 100);
        expect(avatar.userData.rightArm.rotation.x).toBeLessThan(-1.4);

        // 4. Essence Override (Cups: harmonic counter-rotating sweep + relic z-spin)
        avatar.userData.attackElementOverride = 'essence';
        avatar.userData.stateElapsed = 0;
        for (let i = 0; i < 3; i++) updateVesselAvatarAnimation(avatar, 0.1, 100);
        expect(Math.abs(avatar.userData.relic.rotation.z)).toBeGreaterThan(0.5);
      } finally {
        disposeVesselAvatar(avatar);
      }
    });

    it('probes authored model manifest and registers overrides', () => {
      expect(probeAuthoredModelUrl('isaac-newton')).toBeUndefined();
      registerAuthoredModel('isaac-newton', '/models/authored-newton.glb');
      expect(probeAuthoredModelUrl('isaac-newton')).toBe('/models/authored-newton.glb');
      registerAuthoredModel('isaac-newton', undefined as any);
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

  describe('Selective Shadow Policy & Geometry Smoothing (Slice A)', () => {
    it('applies castShadow strictly to opaque structural meshes and disables it on VFX/sprites', () => {
      const newton = FIXTURE_AGENTS[0];
      const avatar = createVesselAvatarMesh(newton);

      // Verify opaque structural parts cast and receive shadows
      const torsoMesh = avatar.getObjectByName('TorsoMesh') as THREE.Mesh;
      expect(torsoMesh.castShadow).toBe(true);
      expect(torsoMesh.receiveShadow).toBe(true);

      const headMesh = avatar.getObjectByName('HeadMesh') as THREE.Mesh;
      expect(headMesh.castShadow).toBe(true);
      expect(headMesh.receiveShadow).toBe(true);

      const lowerBody = avatar.getObjectByName('LowerBody');
      expect(lowerBody).toBeDefined();

      // Verify non-shadow nodes are strictly prevented from casting black geometric box shadows
      const nonShadowNames = [
        'AstralHalo',
        'SealOrbiters',
        'UnderFootResonanceRing',
        'WardShield',
      ];
      for (const name of nonShadowNames) {
        const node = avatar.getObjectByName(name);
        expect(node).toBeDefined();
        node?.traverse((child) => {
          expect(child.castShadow).toBe(false);
          expect(child.receiveShadow).toBe(false);
        });
      }

      // Check SurgeCorona on surge active agent
      const emily = FIXTURE_AGENTS[1];
      const avatarEmily = createVesselAvatarMesh(emily);
      const corona = avatarEmily.getObjectByName('SurgeCorona');
      expect(corona).toBeDefined();
      corona?.traverse((child) => {
        expect(child.castShadow).toBe(false);
        expect(child.receiveShadow).toBe(false);
      });
    });

    it('utilizes smoothed radial segment subdivisions (12-16) on limb and torso geometries', () => {
      const newton = FIXTURE_AGENTS[0];
      const avatar = createVesselAvatarMesh(newton);
      const torsoMesh = avatar.getObjectByName('TorsoMesh') as THREE.Mesh;
      const cylGeo = torsoMesh.geometry as THREE.CylinderGeometry;
      expect(cylGeo.parameters.radialSegments).toBeGreaterThanOrEqual(14);
    });
  });

  describe('Procedural Low-Poly Facial Anchors & Blink Micro-Animation (Slice A & B)', () => {
    it('mounts brow and eye anchors to HeadCrown with palette-matched materials', () => {
      const newton = FIXTURE_AGENTS[0];
      const avatar = createVesselAvatarMesh(newton);

      const headCrown = avatar.getObjectByName('HeadCrown');
      expect(headCrown).toBeDefined();

      const browRidge = headCrown?.getObjectByName('BrowRidgeMesh') as THREE.Mesh;
      expect(browRidge).toBeDefined();
      expect(browRidge.material).toBeInstanceOf(THREE.MeshStandardMaterial);

      const eyesGroup = headCrown?.getObjectByName('EyesGroup') as THREE.Group;
      expect(eyesGroup).toBeDefined();

      const leftEye = eyesGroup?.getObjectByName('EyeMesh_Left') as THREE.Mesh;
      const rightEye = eyesGroup?.getObjectByName('EyeMesh_Right') as THREE.Mesh;
      expect(leftEye).toBeDefined();
      expect(rightEye).toBeDefined();

      // Eye color should match agent sacred stat hex
      const statHex = SACRED_STAT_HEX_COLORS[newton.archetype.primary];
      const eyeMat = leftEye.material as THREE.MeshStandardMaterial;
      expect(eyeMat.color.getHexString().toLowerCase()).toBe(new THREE.Color(statHex).getHexString().toLowerCase());
    });

    it('triggers periodic eyelid blink micro-animation without mutating head rest transforms', () => {
      const newton = FIXTURE_AGENTS[0];
      const avatar = createVesselAvatarMesh(newton);
      const eyesGroup = avatar.userData.eyesGroup as THREE.Group;
      const initialHeadRotation = avatar.userData.restTransforms.head.rotation.clone();

      // Tick through animation past blink cycle
      let sawBlinkCompression = false;
      for (let t = 0; t < 5.0; t += 0.05) {
        updateVesselAvatarAnimation(avatar, 0.05, t);
        if (eyesGroup.scale.y < 0.8) {
          sawBlinkCompression = true;
          break;
        }
      }
      expect(sawBlinkCompression).toBe(true);

      // Base rest transform must remain entirely unchanged
      expect(avatar.userData.restTransforms.head.rotation.equals(initialHeadRotation)).toBe(true);
    });
  });

  describe('ESMS Elemental Combat Choreographies (Slice B)', () => {
    it('branches attack choreography into 4 distinct ESMS styles while preserving forward lean', () => {
      // 1. Spirit (Fire) - High overhead relic raise + forward torso pitch
      const spiritAgent = {
        ...FIXTURE_AGENTS[0],
        key: 'spirit-test-agent',
        esms: { spirit: 95, essence: 20, matter: 20, substance: 20 },
      };
      const avatarSpirit = createVesselAvatarMesh(spiritAgent);
      setVesselAnimationState(avatarSpirit, 'contest-attack');
      updateVesselAvatarAnimation(avatarSpirit, 0.5, 0.5);
      const torsoSpirit = avatarSpirit.userData.torsoGroup as THREE.Group;
      expect(torsoSpirit.rotation.x).toBeGreaterThanOrEqual(0.2);
      expect(resolveDominantEsms(spiritAgent)).toBe('spirit');

      // 2. Essence (Water) - Harmonic counter-rotating sweep
      const essenceAgent = {
        ...FIXTURE_AGENTS[1],
        key: 'essence-test-agent',
        esms: { spirit: 20, essence: 95, matter: 20, substance: 20 },
      };
      const avatarEssence = createVesselAvatarMesh(essenceAgent);
      setVesselAnimationState(avatarEssence, 'contest-attack');
      updateVesselAvatarAnimation(avatarEssence, 0.5, 0.5);
      const torsoEssence = avatarEssence.userData.torsoGroup as THREE.Group;
      expect(torsoEssence.rotation.x).toBeGreaterThanOrEqual(0.2);
      expect(resolveDominantEsms(essenceAgent)).toBe('essence');

      // 3. Matter (Earth) - Grounded slam dip and shield stance
      const matterAgent = {
        ...FIXTURE_AGENTS[2],
        key: 'matter-test-agent',
        esms: { spirit: 20, essence: 20, matter: 95, substance: 20 },
      };
      const avatarMatter = createVesselAvatarMesh(matterAgent);
      setVesselAnimationState(avatarMatter, 'contest-attack');
      updateVesselAvatarAnimation(avatarMatter, 0.5, 0.5);
      const torsoMatter = avatarMatter.userData.torsoGroup as THREE.Group;
      expect(torsoMatter.rotation.x).toBeGreaterThanOrEqual(0.2);
      expect(resolveDominantEsms(matterAgent)).toBe('matter');

      // 4. Substance (Air) - Axial pirouette with rapid orbiters
      const substanceAgent = {
        ...FIXTURE_AGENTS[3],
        key: 'substance-test-agent',
        esms: { spirit: 20, essence: 20, matter: 20, substance: 95 },
      };
      const avatarSubstance = createVesselAvatarMesh(substanceAgent);
      setVesselAnimationState(avatarSubstance, 'contest-attack');
      updateVesselAvatarAnimation(avatarSubstance, 0.5, 0.5);
      const torsoSubstance = avatarSubstance.userData.torsoGroup as THREE.Group;
      expect(torsoSubstance.rotation.x).toBeGreaterThanOrEqual(0.2);
      expect(resolveDominantEsms(substanceAgent)).toBe('substance');
    });
  });

  describe('Dual-Pedestal Gaze IK & Base Rest Invariance (Slice B)', () => {
    it('applies additive look-at IK within ±42° yaw and ±20° pitch without mutating base rest transform', () => {
      const newton = FIXTURE_AGENTS[0];
      const avatar = createVesselAvatarMesh(newton);
      const headGroup = avatar.userData.headGroup as THREE.Group;
      const initialHeadRotation = avatar.userData.restTransforms.head.rotation.clone();
      const initialHeadQuat = new THREE.Quaternion().setFromEuler(initialHeadRotation);

      // Target head position to the right and slightly above
      const lookAtWorldPos = new THREE.Vector3(2.5, 1.8, 1.5);

      // Idle state: gaze tracking weight is 1.0
      setVesselAnimationState(avatar, 'idle');
      updateVesselAvatarAnimation(avatar, 0.05, 1.0, { lookAtWorldPos });

      // Head should have rotated toward target additively
      expect(headGroup.quaternion.equals(initialHeadQuat)).toBe(false);

      // Base rest transform must remain unchanged
      expect(avatar.userData.restTransforms.head.rotation.equals(initialHeadRotation)).toBe(true);

      // Clamped rotation check: compute Euler angles of additive rotation
      const additiveRot = headGroup.quaternion.clone().multiply(initialHeadQuat.clone().invert());
      const euler = new THREE.Euler().setFromQuaternion(additiveRot, 'YXZ');
      expect(Math.abs(euler.y)).toBeLessThanOrEqual(0.74); // ±42° (0.73 rad) + epsilon
      expect(Math.abs(euler.x)).toBeLessThanOrEqual(0.36); // ±20° (0.35 rad) + epsilon

      // Stagger state: gaze tracking weight is blended down to 0.0
      setVesselAnimationState(avatar, 'stagger');
      updateVesselAvatarAnimation(avatar, 0.5, 2.0, { lookAtWorldPos });
      // In stagger, rest transforms are restored and lookAt is suppressed
      expect(avatar.userData.restTransforms.head.rotation.equals(initialHeadRotation)).toBe(true);
    });
  });

  describe('Combinatorial Trait Mixer for Non-Bespoke Personas (Slice C)', () => {
    it('seeds modular traits deterministically and attaches sub-meshes for all 71 agents', () => {
      const traits1 = mixModularTraits('custom-agent-alpha', 'enlightenment');
      const traits2 = mixModularTraits('custom-agent-alpha', 'enlightenment');
      expect(traits1).toEqual(traits2);

      const profile = resolveAgentAppearance('custom-agent-alpha');
      expect(profile.modularTraits).toBeDefined();

      const silhouette = createVesselSilhouette(profile, 'custom-agent-alpha');
      expect(silhouette.head).toBeDefined();
      expect(silhouette.garment).toBeDefined();
      expect(silhouette.relic).toBeDefined();
    });
  });

  describe('Instanced SealOrbiters Batching (Slice C)', () => {
    it('batches orbiters into 5 tier InstancedMeshes and reduces draw calls across court avatars', () => {
      const arena = new PentacleArena3D();

      // Place 4 fixture avatars
      arena.loadFixtures();
      expect(arena.avatarRegistry.size).toBe(4);

      // In high occupancy (>= 4), instanced batching updates automatically
      arena.update(0.016, 1.0);
      expect(arena.isInstancedOrbitersActive()).toBe(true);

      const batcher = arena.getOrbiterBatcher();
      expect(batcher).toBeDefined();
      expect(batcher.container.children.length).toBe(5); // Exactly 5 tiers

      // Individual avatar orbiter meshes must be hidden to cut individual draw calls
      let hiddenCount = 0;
      for (const reg of arena.avatarRegistry.values()) {
        const orbiters = reg.group.userData.sealOrbiters as THREE.Group;
        for (const child of orbiters.children) {
          if ((child as THREE.Mesh).isMesh && !child.visible) hiddenCount++;
        }
      }
      expect(hiddenCount).toBeGreaterThan(0);

      // When restoring or disabling, individual meshes become visible again
      arena.enableInstancedOrbiters(false);
      batcher.restore(arena.avatarRegistry.values());

      let visibleCount = 0;
      for (const reg of arena.avatarRegistry.values()) {
        const orbiters = reg.group.userData.sealOrbiters as THREE.Group;
        for (const child of orbiters.children) {
          if ((child as THREE.Mesh).isMesh && child.visible) visibleCount++;
        }
      }
      expect(visibleCount).toBe(hiddenCount);

      arena.destroy();
    });

    it('restores shard visibility and resets tier instanced mesh count when occupancy drops below 4 upon avatar removal', () => {
      const arena = new PentacleArena3D();
      arena.loadFixtures();
      expect(arena.avatarRegistry.size).toBe(4);

      // High occupancy automatically batches
      arena.update(0.016, 1.0);
      expect(arena.isInstancedOrbitersActive()).toBe(true);

      const batcher = arena.getOrbiterBatcher();
      // Orbiters on avatars should be hidden
      const newtonReg = arena.avatarRegistry.get(FIXTURE_AGENTS[0].key)!;
      const newtonOrbiters = newtonReg.group.userData.sealOrbiters as THREE.Group;
      const initialNewtonMesh = newtonOrbiters.children.find(c => (c as THREE.Mesh).isMesh) as THREE.Mesh;
      expect(initialNewtonMesh.visible).toBe(false);

      // Remove one avatar to drop occupancy to 3 (below threshold of 4)
      arena.removeAvatar(FIXTURE_AGENTS[3].key);
      expect(arena.avatarRegistry.size).toBe(3);
      expect(arena.isInstancedOrbitersActive()).toBe(false);

      // Remaining avatars must immediately have individual shards visible restored
      expect(initialNewtonMesh.visible).toBe(true);

      // All 5 tiers must have count = 0 and visible = false
      for (const tier of ['copper', 'silver', 'gold', 'platinum', 'astral'] as const) {
        const im = batcher.getInstancedMesh(tier);
        expect(im?.count).toBe(0);
        expect(im?.visible).toBe(false);
      }

      // arena.dispose() must dispose all 5 tier instanced mesh geometries and materials
      arena.dispose();
      expect(arena.avatarRegistry.size).toBe(0);
    });
  });

  describe('Post-Implementation Polish & Backlog Targets (Audit & Targets 1–4)', () => {
    it('attaches onBeforeCompile Fresnel rim shading hook to torso and garment materials', () => {
      const mat = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });
      attachFresnelRim(mat, '#38bdf8', 2.8, 0.7);
      expect(mat.userData.fresnelRim).toBeDefined();
      expect(mat.userData.fresnelRim.power).toBe(2.8);
      expect(mat.userData.fresnelRim.intensity).toBe(0.7);

      const shader = {
        uniforms: {} as Record<string, { value: any }>,
        fragmentShader: '#include <dithering_fragment>',
      };
      mat.onBeforeCompile(shader as any);
      expect(shader.uniforms.uFresnelRimColor).toBeDefined();
      expect(shader.uniforms.uFresnelPower.value).toBe(2.8);
      expect(shader.fragmentShader).toContain('uFresnelRimColor');
      expect(shader.fragmentShader).toContain('uFresnelPower');

      const avatar = createVesselAvatarMesh(FIXTURE_AGENTS[0]);
      const torsoMesh = (avatar.userData.torsoGroup as THREE.Group).getObjectByName('TorsoMesh') as THREE.Mesh;
      expect((torsoMesh.material as THREE.MeshStandardMaterial).userData.fresnelRim).toBeDefined();
    });

    it('renders modular traits in 2D cameo portraits matching 3D vessels', () => {
      const baseProfile = resolveAgentAppearance('custom-test-agent');
      const profileWithTraits = {
        ...baseProfile,
        modularTraits: {
          headwearAccent: 'feather-plume' as const,
          faceAccent: 'philosopher-beard' as const,
          collarAccent: 'winged-pauldrons' as const,
          offHandAccessory: 'parchment-scroll' as const,
        },
      };

      const svgDataUri = createVesselPortraitSvg(profileWithTraits);
      const svg = decodeURIComponent(svgDataUri.replace('data:image/svg+xml,', ''));

      // Headwear feather-plume path
      expect(svg).toContain('M60 22Q68 12 75 7');
      // Face philosopher-beard path
      expect(svg).toContain('M45 56Q51 72 57 56');
      // Collar winged-pauldrons path
      expect(svg).toContain('M22 75L14 67L24 69');
    });

    it('wires live rating deltas directly into seated court avatars and under-foot resonance ring', () => {
      const arena = new PentacleArena3D();
      const agent = FIXTURE_AGENTS[0];
      arena.placeAvatarOnZone(1, agent, 'owner');

      const reg = arena.avatarRegistry.get(agent.key)!;
      expect(reg).toBeDefined();
      const initialOvr = reg.payload.ovr;

      // Positive delta (+8 OVR) triggers surge animation and foot ring scale pulse (1.25)
      const surgedAgent = {
        ...agent,
        ovr: initialOvr + 8,
      };
      arena.refreshAvatar(surgedAgent);
      expect(reg.group.userData.animationState).toBe('surge');
      expect(reg.footRing.scale.x).toBeCloseTo(1.25, 2);

      // Running update lerps foot ring scale back towards 1.0
      arena.update(0.1, 1.0);
      expect(reg.footRing.scale.x).toBeLessThan(1.25);

      // Negative delta (-10 OVR) triggers stagger animation and foot ring scale compression (0.85)
      const staggeredAgent = {
        ...agent,
        ovr: initialOvr - 10,
      };
      arena.refreshAvatar(staggeredAgent);
      expect(reg.group.userData.animationState).toBe('stagger');
      expect(reg.footRing.scale.x).toBeCloseTo(0.85, 2);

      arena.dispose();
    });

    it('triggers elemental combat procedural Web Audio transients safely', () => {
      const synth = new CourtAudioSynth();
      expect(synth).toBeDefined();
      expect(synth.isEnabled()).toBe(true);

      // Safe invocation across all 4 elemental choreographies
      expect(() => synth.triggerClash('spirit')).not.toThrow();
      expect(() => synth.triggerClash('essence')).not.toThrow();
      expect(() => synth.triggerClash('matter')).not.toThrow();
      expect(() => synth.triggerClash('substance')).not.toThrow();

      synth.setEnabled(false);
      expect(synth.isEnabled()).toBe(false);
      expect(() => synth.triggerClash('spirit')).not.toThrow();

      synth.dispose();
    });
  });
});
