/**
 * ============================================================================
 * Pentacles — 3D Articulated Vessel Avatar & Procedural Animation System
 * ============================================================================
 *
 * Renders 3D humanoid/procedural alchemical Vessel Avatars standing atop the
 * 11 Pentacle court pedestals.
 *
 * Features:
 *   1. Dual-Mode Mesh Generation (Procedural Rig fallback + GLTF loader hook)
 *   2. Articulated Vessel Hierarchy (TorsoCore, HeadCrown, Arms, AstralHalo, SealOrbiters)
 *   3. Under-Foot Resonance Ring auto-anchoring (y = 0.02) & live ESMS sync registration
 *   4. Seal Orbiters reflecting exact Alchemical Seal tiers (Copper=1 .. Celestial=5)
 *   5. Resonance Surge Corona (inferno, tempest, equilibrium dual harmonic)
 *   6. 4 Deterministic Animation States ('idle', 'surge', 'contest-attack', 'contest-defend')
 *   7. Raycasting & Click Selection picking helper
 */

import * as THREE from 'three';
import {
  type RatedAgentPayload,
  type SealTier,
  type SacredStat,
} from './rating-contract';
import {
  createFootRingMeshSync,
  FACTION_HEX_COLORS,
} from './avatar-foot-ring';
import { liveWalletSync } from './live-wallet-sync';

export type VesselAnimationState = 'idle' | 'surge' | 'contest-attack' | 'contest-defend';

export interface VesselAvatarOptions {
  zoneId?: number;
  slot?: 'owner' | 'challenger';
  footRingRadius?: number;
  loadModelAsync?: boolean;
}

export interface PickedVesselResult {
  agentId: string;
  zoneId: number | null;
  payload: RatedAgentPayload;
  avatarGroup: THREE.Group;
}

/**
 * Maps each Alchemical Seal tier to its exact orbiting shard count
 */
export function getSealShardCount(tier: SealTier): number {
  switch (tier) {
    case 'Copper':
      return 1;
    case 'Silver':
      return 2;
    case 'Gold':
      return 3;
    case 'Aether':
      return 4;
    case 'Celestial':
      return 5;
    default:
      return 1;
  }
}

/**
 * Color mapping for seal tier emissive shards
 */
export const SEAL_TIER_HEX_COLORS: Record<SealTier, string> = {
  Copper: '#c87d55',
  Silver: '#e2e8f0',
  Gold: '#f59e0b',
  Aether: '#00f0ff',
  Celestial: '#c084fc',
};

/**
 * Color mapping for Sacred 7 core gem accents
 */
export const SACRED_STAT_HEX_COLORS: Record<SacredStat, string> = {
  vitality: '#ef4444',     // Mars / Red
  resonance: '#38bdf8',    // Moon / Cyan
  precision: '#eab308',    // Sun / Gold
  synthesis: '#10b981',    // Venus / Emerald
  tempo: '#a855f7',        // Mercury / Violet
  intuition: '#6366f1',    // Jupiter / Indigo
  adaptability: '#f97316', // Saturn / Amber
};

/**
 * Asynchronous loader hook for external rigged .glb models
 */
export type GLTFModelLoader = (url: string) => Promise<THREE.Group>;
let customModelLoader: GLTFModelLoader | null = null;

export function registerCustomModelLoader(loader: GLTFModelLoader | null): void {
  customModelLoader = loader;
}

/**
 * Creates the complete 3D Vessel Avatar hierarchy for any rated agent.
 */
export function createVesselAvatarMesh(
  agent: RatedAgentPayload,
  options: VesselAvatarOptions = {}
): THREE.Group {
  const root = new THREE.Group();
  root.name = `VesselAvatarRoot_${agent.key}`;

  // 1. Under-Foot Resonance Ring (anchored at y = 0.02)
  const ringRadius = options.footRingRadius ?? 1.8;
  const footRing = createFootRingMeshSync(THREE, agent, { radius: ringRadius });
  footRing.position.set(0, 0.02, 0);
  footRing.name = 'UnderFootResonanceRing';
  root.add(footRing);

  // Register foot ring with live wallet sync so ESMS updates reflect immediately
  liveWalletSync.registerFootRingMesh(agent.key, footRing);

  // 2. Articulated Procedural Vessel Rig
  const rig = new THREE.Group();
  rig.name = 'ArticulatedVesselRig';

  const factionHex = FACTION_HEX_COLORS[agent.faction] ?? '#00daf3';
  const factionColor = new THREE.Color(factionHex);
  const primaryStat = agent.archetype.primary;
  const statHex = SACRED_STAT_HEX_COLORS[primaryStat] ?? factionHex;
  const statColor = new THREE.Color(statHex);

  // --- Torso Core ---
  const torsoGroup = new THREE.Group();
  torsoGroup.name = 'TorsoCore';
  torsoGroup.position.set(0, 1.35, 0);

  const torsoGeo = new THREE.CylinderGeometry(0.32, 0.18, 0.85, 6);
  const torsoMat = new THREE.MeshStandardMaterial({
    color: factionColor,
    roughness: 0.25,
    metalness: 0.8,
    emissive: factionColor,
    emissiveIntensity: agent.surge.active ? 0.75 : 0.25,
  });
  const torsoMesh = new THREE.Mesh(torsoGeo, torsoMat);
  torsoMesh.name = 'TorsoMesh';
  torsoGroup.add(torsoMesh);

  // Internal Alchemical Core Gem
  const gemGeo = new THREE.OctahedronGeometry(0.22, 0);
  const gemMat = new THREE.MeshStandardMaterial({
    color: statColor,
    roughness: 0.1,
    metalness: 0.9,
    emissive: statColor,
    emissiveIntensity: 0.9,
  });
  const gemMesh = new THREE.Mesh(gemGeo, gemMat);
  gemMesh.position.set(0, 0.05, 0.12);
  gemMesh.name = 'CoreGemMesh';
  torsoGroup.add(gemMesh);

  // --- Head & Crown ---
  const headGroup = new THREE.Group();
  headGroup.name = 'HeadCrown';
  headGroup.position.set(0, 2.15, 0);

  const headGeo = new THREE.DodecahedronGeometry(0.26, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.2,
    metalness: 0.7,
    emissive: factionColor,
    emissiveIntensity: 0.3,
  });
  const headMesh = new THREE.Mesh(headGeo, headMat);
  headMesh.name = 'HeadMesh';
  headGroup.add(headMesh);

  // Crown circlet
  const circletGeo = new THREE.TorusGeometry(0.32, 0.03, 6, 16);
  const circletMat = new THREE.MeshStandardMaterial({
    color: statColor,
    metalness: 0.95,
    roughness: 0.15,
    emissive: statColor,
    emissiveIntensity: 0.6,
  });
  const circletMesh = new THREE.Mesh(circletGeo, circletMat);
  circletMesh.rotation.x = Math.PI / 2;
  circletMesh.position.set(0, 0.12, 0);
  circletMesh.name = 'CircletMesh';
  headGroup.add(circletMesh);

  // --- Arms ---
  const leftArm = new THREE.Group();
  leftArm.name = 'LeftArm';
  leftArm.position.set(-0.6, 1.45, 0);

  const armGeo = new THREE.CylinderGeometry(0.08, 0.06, 0.7, 6);
  const armMat = new THREE.MeshStandardMaterial({
    color: factionColor,
    roughness: 0.3,
    metalness: 0.8,
  });
  const leftArmMesh = new THREE.Mesh(armGeo, armMat);
  leftArmMesh.position.set(0, -0.3, 0);
  leftArm.add(leftArmMesh);

  const rightArm = new THREE.Group();
  rightArm.name = 'RightArm';
  rightArm.position.set(0.6, 1.45, 0);
  const rightArmMesh = new THREE.Mesh(armGeo, armMat);
  rightArmMesh.position.set(0, -0.3, 0);
  rightArm.add(rightArmMesh);

  // --- Astral Halo ---
  const haloGroup = new THREE.Group();
  haloGroup.name = 'AstralHalo';
  haloGroup.position.set(0, 2.1, -0.15);
  haloGroup.rotation.x = Math.PI / 4;

  const haloGeo = new THREE.TorusGeometry(0.75, 0.03, 8, 32);
  const haloMat = new THREE.MeshBasicMaterial({
    color: agent.surge.active ? 0xffea00 : factionColor,
    transparent: true,
    opacity: 0.85,
  });
  const haloMesh = new THREE.Mesh(haloGeo, haloMat);
  haloMesh.name = 'AstralHaloMesh';
  haloGroup.add(haloMesh);

  // --- Seal Orbiters ---
  const sealOrbitersGroup = new THREE.Group();
  sealOrbitersGroup.name = 'SealOrbiters';
  sealOrbitersGroup.position.set(0, 1.35, 0);

  let totalShardIndex = 0;
  // Calculate total shards to distribute evenly around 360 degrees
  const totalShards = agent.seals.reduce((sum, s) => sum + getSealShardCount(s.tier), 0);

  for (const seal of agent.seals) {
    const shardCount = getSealShardCount(seal.tier);
    const tierHex = SEAL_TIER_HEX_COLORS[seal.tier];
    const tierColor = new THREE.Color(tierHex);

    for (let i = 0; i < shardCount; i++) {
      const shardGeo = new THREE.OctahedronGeometry(0.09, 0);
      const shardMat = new THREE.MeshStandardMaterial({
        color: tierColor,
        roughness: 0.15,
        metalness: 0.85,
        emissive: tierColor,
        emissiveIntensity: 0.85,
      });
      const shardMesh = new THREE.Mesh(shardGeo, shardMat);
      shardMesh.name = `SealOrbiter_${seal.statKey}_${i}`;

      const angle = (2 * Math.PI * totalShardIndex) / Math.max(1, totalShards);
      const orbitRadius = 0.95;
      const yOffset = Math.sin(totalShardIndex * 1.3) * 0.15;
      shardMesh.position.set(
        orbitRadius * Math.cos(angle),
        yOffset,
        orbitRadius * Math.sin(angle)
      );

      shardMesh.userData = {
        sealTier: seal.tier,
        statKey: seal.statKey,
        shardIndex: i,
        orbitAngle: angle,
        orbitRadius,
      };

      sealOrbitersGroup.add(shardMesh);
      totalShardIndex++;
    }
  }

  // --- Ward Shield (for contest-defend stance) ---
  const wardShield = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.4, 1),
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.0,
    })
  );
  wardShield.name = 'WardShield';
  wardShield.position.set(0, 1.4, 0);
  wardShield.scale.set(0.001, 0.001, 0.001);

  // --- Surge Corona (Active Resonance Surge Pillar) ---
  let surgeCorona: THREE.Group | null = null;
  if (agent.surge.active) {
    surgeCorona = new THREE.Group();
    surgeCorona.name = 'SurgeCorona';
    surgeCorona.position.set(0, 1.4, 0);

    let coronaColor = 0xffaa00; // inferno (solar gold)
    if (agent.surge.surgeType === 'tempest') {
      coronaColor = 0x38bdf8; // tempest (cyan)
    } else if (agent.surge.surgeType === 'equilibrium') {
      coronaColor = 0x00f0ff; // equilibrium harmonic
    }

    const pillarGeo = new THREE.CylinderGeometry(0.75, 1.05, 3.4, 16, 1, true);
    const pillarMat = new THREE.MeshBasicMaterial({
      color: coronaColor,
      wireframe: true,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
    });
    const pillarMesh = new THREE.Mesh(pillarGeo, pillarMat);
    pillarMesh.name = 'SurgePillar';
    surgeCorona.add(pillarMesh);

    // Equilibrium dual-harmonic inner cylinder
    if (agent.surge.surgeType === 'equilibrium') {
      const innerGeo = new THREE.CylinderGeometry(0.55, 0.75, 3.2, 12, 1, true);
      const innerMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b, // Solar gold dual harmonic
        wireframe: true,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      });
      const innerMesh = new THREE.Mesh(innerGeo, innerMat);
      innerMesh.name = 'SurgePillarInner';
      surgeCorona.add(innerMesh);
    }
  }

  // Assemble Rig Hierarchy
  rig.add(torsoGroup);
  rig.add(headGroup);
  rig.add(leftArm);
  rig.add(rightArm);
  rig.add(haloGroup);
  rig.add(sealOrbitersGroup);
  rig.add(wardShield);
  if (surgeCorona) {
    rig.add(surgeCorona);
  }

  root.add(rig);

  // Setup Root Metadata
  root.userData = {
    agentId: agent.key,
    agentPayload: agent,
    zoneId: options.zoneId ?? null,
    slot: options.slot ?? 'owner',
    animationState: (agent.surge.active ? 'surge' : 'idle') as VesselAnimationState,
    footRing,
    rig,
    torsoGroup,
    headGroup,
    leftArm,
    rightArm,
    astralHalo: haloGroup,
    sealOrbiters: sealOrbitersGroup,
    wardShield,
    surgeCorona,
    baseTorsoY: 1.35,
  };

  // Optional asynchronous GLTF loader support
  if (options.loadModelAsync && agent.avatarModelUrl && customModelLoader) {
    customModelLoader(agent.avatarModelUrl)
      .then((gltfScene) => {
        gltfScene.name = 'ExternalGLTFModel';
        root.add(gltfScene);
        rig.visible = false; // Hide procedural rig once external mesh is ready
      })
      .catch((err) => {
        console.warn(`[VesselAvatar3D] Failed to load external GLTF for ${agent.key}:`, err);
      });
  }

  return root;
}

/**
 * Skeletal / Procedural Animation Controller
 * Deterministically updates the avatar's limbs, orbiters, core bob, and surge corona.
 */
export function updateVesselAvatarAnimation(
  avatarGroup: THREE.Group,
  deltaSec: number,
  elapsedSec: number,
  overrideState?: VesselAnimationState
): void {
  const u = avatarGroup.userData;
  if (!u || !u.rig) return;

  const state: VesselAnimationState = overrideState ?? u.animationState ?? 'idle';
  u.animationState = state;

  const torso = u.torsoGroup as THREE.Group | undefined;
  const head = u.headGroup as THREE.Group | undefined;
  const leftArm = u.leftArm as THREE.Group | undefined;
  const rightArm = u.rightArm as THREE.Group | undefined;
  const orbiters = u.sealOrbiters as THREE.Group | undefined;
  const halo = u.astralHalo as THREE.Group | undefined;
  const wardShield = u.wardShield as THREE.Mesh | undefined;
  const corona = u.surgeCorona as THREE.Group | undefined;
  const baseY = u.baseTorsoY ?? 1.35;

  // 1. Seal Orbiters Rotation & Floating
  if (orbiters) {
    let spinSpeed = 0.9;
    if (state === 'surge') spinSpeed = 3.5;
    else if (state === 'contest-attack') spinSpeed = 2.4;
    else if (state === 'contest-defend') spinSpeed = 1.6;

    orbiters.rotation.y += deltaSec * spinSpeed;

    // Gentle vertical bob for each individual shard
    orbiters.children.forEach((child, idx) => {
      child.position.y = Math.sin(elapsedSec * 2.5 + idx * 0.8) * 0.12;
      child.rotation.x += deltaSec * 1.5;
      child.rotation.z += deltaSec * 1.2;
    });
  }

  // 2. Astral Halo Rotation
  if (halo) {
    halo.rotation.z += deltaSec * 0.75;
  }

  // 3. State-Specific Body Poses & Trajectories
  switch (state) {
    case 'idle': {
      // Subtle breathing bob
      if (torso) {
        torso.position.y = baseY + Math.sin(elapsedSec * 2.0) * 0.04;
        torso.rotation.set(0, 0, 0);
        torso.position.z = 0;
      }
      if (head) {
        head.position.y = 2.15 + Math.sin(elapsedSec * 2.0) * 0.04;
        head.rotation.y = Math.sin(elapsedSec * 0.8) * 0.12;
      }
      if (leftArm) {
        leftArm.rotation.x = Math.sin(elapsedSec * 2.0) * 0.08;
        leftArm.rotation.z = 0;
      }
      if (rightArm) {
        rightArm.rotation.x = -Math.sin(elapsedSec * 2.0) * 0.08;
        rightArm.rotation.z = 0;
      }
      if (wardShield) {
        wardShield.scale.set(0.001, 0.001, 0.001);
        (wardShield.material as THREE.MeshBasicMaterial).opacity = 0;
      }
      break;
    }

    case 'surge': {
      // Elevated levitation height and rapid oscillation
      if (torso) {
        torso.position.y = baseY + 0.35 + Math.sin(elapsedSec * 4.2) * 0.09;
        torso.rotation.y = Math.sin(elapsedSec * 3.0) * 0.15;
        torso.position.z = 0;
      }
      if (head) {
        head.position.y = 2.5 + Math.sin(elapsedSec * 4.2) * 0.09;
        head.rotation.x = -0.15; // Tilted slightly upward
      }
      if (leftArm) {
        leftArm.rotation.z = 0.45 + Math.sin(elapsedSec * 3.5) * 0.1;
        leftArm.rotation.x = -0.2;
      }
      if (rightArm) {
        rightArm.rotation.z = -0.45 - Math.sin(elapsedSec * 3.5) * 0.1;
        rightArm.rotation.x = -0.2;
      }
      if (wardShield) {
        wardShield.scale.set(0.001, 0.001, 0.001);
        (wardShield.material as THREE.MeshBasicMaterial).opacity = 0;
      }
      break;
    }

    case 'contest-attack': {
      // Forward lunge toward target vector with arm thrust
      const lungeFactor = Math.abs(Math.sin(elapsedSec * 3.5));
      if (torso) {
        torso.position.y = baseY - 0.1;
        torso.position.z = lungeFactor * 0.6;
        torso.rotation.x = 0.28;
      }
      if (head) {
        head.position.y = 2.05;
        head.position.z = lungeFactor * 0.65;
        head.rotation.x = 0.1;
      }
      if (rightArm) {
        // Thrust right arm forward
        rightArm.rotation.x = -1.35;
        rightArm.rotation.z = -0.15;
      }
      if (leftArm) {
        // Draw left arm back
        leftArm.rotation.x = 0.65;
        leftArm.rotation.z = 0.2;
      }
      if (wardShield) {
        wardShield.scale.set(0.001, 0.001, 0.001);
        (wardShield.material as THREE.MeshBasicMaterial).opacity = 0;
      }
      break;
    }

    case 'contest-defend': {
      // Guard stance with expanding octahedral ward shield
      if (torso) {
        torso.position.y = baseY - 0.18;
        torso.position.z = -0.15;
        torso.rotation.x = -0.12;
      }
      if (head) {
        head.position.y = 1.98;
        head.position.z = -0.12;
        head.rotation.x = -0.18;
      }
      if (leftArm && rightArm) {
        // Crossed defensive arm brace
        leftArm.rotation.x = -0.95;
        leftArm.rotation.z = -0.55;
        rightArm.rotation.x = -0.95;
        rightArm.rotation.z = 0.55;
      }
      if (wardShield) {
        const pulse = 1.0 + Math.sin(elapsedSec * 6.0) * 0.12;
        wardShield.scale.set(pulse, pulse, pulse);
        (wardShield.material as THREE.MeshBasicMaterial).opacity = 0.65;
        wardShield.rotation.y += deltaSec * 1.5;
        wardShield.rotation.x += deltaSec * 0.8;
      }
      break;
    }
  }

  // 4. Surge Corona Pulsing
  if (corona) {
    corona.rotation.y -= deltaSec * 1.8;
    const pulseScale = 1.0 + Math.sin(elapsedSec * 5.0) * 0.08;
    corona.scale.set(pulseScale, 1.0, pulseScale);
  }
}

/**
 * Raycasting Helper: Intersects scene objects and identifies the clicked Vessel Avatar
 */
export function pickVesselAvatar(
  raycaster: THREE.Raycaster,
  sceneOrGroup: THREE.Object3D
): PickedVesselResult | null {
  const intersects = raycaster.intersectObjects(sceneOrGroup.children, true);

  for (const hit of intersects) {
    let curr: THREE.Object3D | null = hit.object;
    while (curr) {
      if (curr.userData && curr.userData.agentId) {
        return {
          agentId: curr.userData.agentId,
          zoneId: curr.userData.zoneId ?? null,
          payload: curr.userData.agentPayload,
          avatarGroup: curr as THREE.Group,
        };
      }
      curr = curr.parent;
    }
  }

  return null;
}
