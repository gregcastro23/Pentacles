import { describe, it, expect } from 'bun:test';
import * as THREE from 'three';
import {
  createVesselAvatarMesh,
  updateVesselAvatarAnimation,
  pickVesselAvatar,
  getSealShardCount,
  SEAL_TIER_HEX_COLORS,
  SACRED_STAT_HEX_COLORS,
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

describe('3D Vessel Avatar Mesh & Procedural Animation System', () => {
  describe('Procedural Avatar Hierarchy Generation', () => {
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
      expect(getSealShardCount('Aether')).toBe(4);
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
    it('executes deterministic transforms for all 4 animation states', () => {
      const newton = FIXTURE_AGENTS[0];
      const avatar = createVesselAvatarMesh(newton);
      const torso = avatar.userData.torsoGroup as THREE.Group;
      const wardShield = avatar.userData.wardShield as THREE.Mesh;

      // 1. Idle state
      updateVesselAvatarAnimation(avatar, 0.016, 0.0, 'idle');
      expect(avatar.userData.animationState).toBe('idle');
      expect(torso.position.z).toBe(0);
      expect(wardShield.scale.x).toBeLessThan(0.01);

      // 2. Surge state (elevated levitation)
      updateVesselAvatarAnimation(avatar, 0.016, 0.0, 'surge');
      expect(avatar.userData.animationState).toBe('surge');
      expect(torso.position.y).toBeGreaterThan(1.5); // levitation above base 1.35

      // 3. Contest-Attack state (forward lunge)
      updateVesselAvatarAnimation(avatar, 0.016, 0.5, 'contest-attack');
      expect(avatar.userData.animationState).toBe('contest-attack');
      expect(torso.rotation.x).toBeGreaterThan(0.2); // leaning forward

      // 4. Contest-Defend state (ward shield expansion)
      updateVesselAvatarAnimation(avatar, 0.016, 1.0, 'contest-defend');
      expect(avatar.userData.animationState).toBe('contest-defend');
      expect(wardShield.scale.x).toBeGreaterThan(0.8); // expanded ward shield
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
