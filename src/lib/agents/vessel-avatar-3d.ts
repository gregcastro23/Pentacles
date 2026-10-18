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
 *   6. Five blended, state-local procedural animation states
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
  updateFootRingEsmsAndSurge,
} from './avatar-foot-ring';
import { liveWalletSync } from './live-wallet-sync';
import { resolveAgentAppearance } from './vessel-appearance-manifest';
import { createVesselSilhouette } from './vessel-silhouettes';

export type VesselAnimationState = 'idle' | 'surge' | 'travel' | 'contest-attack' | 'contest-defend';

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
  power: '#ef4444',        // Mars / Red
  resonance: '#38bdf8',    // Moon / Cyan
  wisdom: '#eab308',       // Sun / Gold
  charisma: '#10b981',     // Venus / Emerald
  intuition: '#6366f1',    // Jupiter / Indigo
  adaptability: '#a855f7', // Mercury / Violet
  vitality: '#f97316',     // Saturn / Amber
};

/**
 * Asynchronous loader hook for external rigged .glb models
 */
export interface VesselModelAsset {
  scene: THREE.Group;
  animations?: THREE.AnimationClip[];
}
/** Each load must return a scene owned by that avatar (clone shared skeletons in the adapter). */
export type GLTFModelLoader = (url: string) => Promise<VesselModelAsset>;
let customModelLoader: GLTFModelLoader | null = null;

export function registerCustomModelLoader(loader: GLTFModelLoader | null): void {
  customModelLoader = loader;
}

/**
 * Creates the complete 3D Vessel Avatar hierarchy for any rated agent.
 */
export function createVesselAvatarMesh(
  payload: RatedAgentPayload,
  options: VesselAvatarOptions = {}
): THREE.Group {
  // Ring sync mutates its stored snapshot; rendering owns that snapshot, never caller state.
  const agent = JSON.parse(JSON.stringify(payload)) as RatedAgentPayload;
  const root = new THREE.Group();
  root.name = `VesselAvatarRoot_${agent.key}`;
  const appearance = agent.appearance ?? resolveAgentAppearance(agent.key, agent.faction, agent.archetype);

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
    color: appearance.paletteOverrides.skinOrMaterialToneHex,
    roughness: 0.2,
    metalness: 0.7,
    emissive: factionColor,
    emissiveIntensity: 0.3,
  });
  const headMesh = new THREE.Mesh(headGeo, headMat);
  headMesh.name = 'HeadMesh';
  headMesh.scale.set(appearance.headSilhouette.faceProportion.jawWidth, appearance.headSilhouette.faceProportion.cranialHeight, appearance.headSilhouette.faceProportion.browDepth);
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

  const silhouette = createVesselSilhouette(appearance);
  headGroup.add(silhouette.head);
  torsoGroup.add(silhouette.garment);
  rightArm.add(silhouette.relic);

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
        restY: yOffset,
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
    footRingRest: { position: footRing.position.clone(), scale: footRing.scale.clone() },
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
    coreGem: gemMesh,
    circlet: circletMesh,
    relic: silhouette.relic,
    silhouette,
    appearance,
    appearanceSignature: JSON.stringify(appearance),
    sealSignature: JSON.stringify(agent.seals),
    coronaType: agent.surge.active ? agent.surge.surgeType : null,
    stateElapsed: 0,
    activeAnimationState: agent.surge.active ? 'surge' : 'idle',
    modelLoadVersion: 0,
    loadModelAsync: options.loadModelAsync ?? false,
    disposed: false,
  };
  captureRestTransforms(root);
  liveWalletSync.registerVesselAvatar(agent.key, root, refreshVesselFromPayload, agent);
  const currentPayload = root.userData.agentPayload as RatedAgentPayload;
  loadExternalModel(root, currentPayload.avatarModelUrl ?? root.userData.appearance.avatarModelUrl);

  return root;
}

/**
 * Skeletal / Procedural Animation Controller
 * Deterministically updates the avatar's limbs, orbiters, core bob, and surge corona.
 */
interface RestTransform {
  object: THREE.Object3D;
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: THREE.Vector3;
}

function captureRestTransforms(avatar: THREE.Group): void {
  const u = avatar.userData;
  const previous = u.restTransforms as Record<string, RestTransform> | undefined;
  const pivots = { torso: u.torsoGroup, coreGem: u.coreGem, head: u.headGroup,
    circlet: u.circlet, leftArm: u.leftArm, rightArm: u.rightArm, halo: u.astralHalo,
    ward: u.wardShield, corona: u.surgeCorona, relic: u.relic };
  u.restTransforms = Object.fromEntries(Object.entries(pivots).filter(([, object]) => object).map(([key, object]) => {
    // Refreshes must never capture an already animated pose as the new rest pose.
    const rest = previous?.[key];
    return [key, rest?.object === object ? rest : { object, position: object.position.clone(),
      rotation: object.rotation.clone(), scale: object.scale.clone() }];
  }));
}

export function setVesselAnimationState(avatar: THREE.Group, state: VesselAnimationState): void {
  const u = avatar.userData;
  if (u.disposed) return;
  u.animationState = state;
  if (u.activeAnimationState !== state) {
    u.activeAnimationState = state;
    u.stateElapsed = 0;
    selectModelAction(avatar, state);
  }
}

export function updateVesselAvatarAnimation(
  avatarGroup: THREE.Group,
  deltaSec: number,
  _elapsedSec: number,
  overrideState?: VesselAnimationState
): void {
  const u = avatarGroup.userData;
  if (!u?.rig || u.disposed) return;
  const dt = Number.isFinite(deltaSec) ? Math.max(0, Math.min(deltaSec, 0.1)) : 0;
  setVesselAnimationState(avatarGroup, overrideState ?? u.animationState ?? 'idle');
  u.stateElapsed += dt;
  const t = u.stateElapsed;
  const state = u.animationState as VesselAnimationState;
  const alpha = 1 - Math.exp(-16 * dt);
  const ringRest = u.footRingRest as { position: THREE.Vector3; scale: THREE.Vector3 };
  const ringPosition = ringRest.position.clone();
  const ringScale = ringRest.scale.clone();
  if (state === 'travel') {
    // Stretch/pulse behind the heading without changing live ESMS or Surge uniforms.
    const pulse = Math.sin(t * 10) * 0.045;
    ringScale.x *= 1.08 + pulse;
    ringScale.y *= 1.35 + pulse;
    ringPosition.z -= 0.32;
  }
  u.footRing.position.lerp(ringPosition, alpha);
  u.footRing.scale.lerp(ringScale, alpha);
  if (u.externalModel) {
    // External clip tracks own the loaded hierarchy. Do not animate hidden fallback pivots.
    (u.mixer as THREE.AnimationMixer | undefined)?.update(dt);
    return;
  }

  const rest = u.restTransforms as Record<string, RestTransform>;
  const targets = Object.fromEntries(Object.entries(rest).map(([key, r]) => [key, {
    position: r.position.clone(), rotation: r.rotation.clone(), scale: r.scale.clone(),
  }]));
  const { torso, coreGem, head, circlet, leftArm, rightArm, halo, ward, corona, relic } = targets;
  const breath = Math.sin(t * 2) * 0.04;
  torso.position.y += breath;
  head.position.y += breath;
  head.rotation.y += Math.sin(t * 0.8) * 0.12;
  leftArm.rotation.x += Math.sin(t * 2) * 0.08;
  rightArm.rotation.x -= Math.sin(t * 2) * 0.08;
  let wardOpacity = 0;
  if (state === 'surge') {
    const lift = 0.35 + Math.sin(t * 4.2) * 0.09;
    torso.position.y = rest.torso.position.y + lift;
    head.position.y = rest.head.position.y + lift;
    torso.rotation.y += Math.sin(t * 3) * 0.15;
    head.rotation.x -= 0.15;
    leftArm.rotation.set(-0.2, 0, 0.45 + Math.sin(t * 3.5) * 0.1);
    rightArm.rotation.set(-0.8, 0, -0.65 - Math.sin(t * 3.5) * 0.1);
  } else if (state === 'travel') {
    const hover = 0.16 + Math.sin(t * 6) * 0.04;
    torso.position.y += hover;
    head.position.y += hover;
    leftArm.position.y += hover;
    rightArm.position.y += hover;
    torso.rotation.x += 0.18;
    head.rotation.x -= 0.08;
    leftArm.rotation.x += 0.55;
    rightArm.rotation.x += 0.55;
    leftArm.rotation.z += 0.15;
    rightArm.rotation.z -= 0.15;
  } else if (state === 'contest-attack') {
    const lunge = Math.sin(Math.min(t / 0.75, 1) * Math.PI);
    torso.position.y -= 0.1;
    torso.position.z += lunge * 0.6;
    torso.rotation.x += 0.28;
    head.position.y = rest.head.position.y - 0.1;
    head.position.z += lunge * 0.65;
    head.rotation.x += 0.1;
    rightArm.position.z += lunge * 0.4;
    rightArm.rotation.set(-1.35, 0, -0.15);
    leftArm.rotation.set(0.65, 0, 0.2);
  } else if (state === 'contest-defend') {
    torso.position.y -= 0.18;
    torso.position.z -= 0.15;
    torso.rotation.x -= 0.12;
    head.position.y = rest.head.position.y - 0.17;
    head.position.z -= 0.12;
    head.rotation.x -= 0.18;
    leftArm.rotation.set(-0.95, 0, -0.55);
    rightArm.rotation.set(-0.95, 0, 0.55);
    ward.scale.setScalar(1 + Math.sin(t * 6) * 0.12);
    ward.rotation.y += t * 1.5;
    ward.rotation.x += t * 0.8;
    wardOpacity = 0.65;
  }
  halo.rotation.z += t * 0.75;
  coreGem.rotation.y += t * (state === 'travel' ? 3.2 : 0.45);
  circlet.rotation.z += Math.sin(t) * 0.04;
  if (relic) relic.rotation.y += Math.sin(t * 1.3) * 0.1;
  if (corona) {
    corona.rotation.y -= t * 1.8;
    const pulse = 1 + Math.sin(t * 5) * 0.08;
    corona.scale.x *= pulse;
    corona.scale.z *= pulse;
  }
  const targetQuaternion = new THREE.Quaternion();
  for (const [key, pose] of Object.entries(targets)) {
    const object = rest[key].object;
    object.position.lerp(pose.position, alpha);
    object.scale.lerp(pose.scale, alpha);
    object.quaternion.slerp(targetQuaternion.setFromEuler(pose.rotation), alpha);
  }
  const material = u.wardShield.material as THREE.MeshBasicMaterial;
  material.opacity = THREE.MathUtils.lerp(material.opacity, wardOpacity, alpha);
  const orbiters = u.sealOrbiters as THREE.Group;
  orbiters.rotation.y = t * (state === 'surge' ? 3.5 : state === 'contest-attack' ? 2.4 : 0.9);
  orbiters.children.forEach((child, i) => {
    child.position.y = (child.userData.restY ?? 0) + Math.sin(t * 2.5 + i * 0.8) * 0.12;
    child.rotation.set(t * 1.5, 0, t * 1.2);
  });
}

/** Dispose an owned hierarchy, including badge maps, once per shared resource. */
function disposeObjectResources(object: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((node) => {
    const drawable = node as THREE.Mesh;
    if (drawable.geometry) geometries.add(drawable.geometry);
    const nodeMaterials = Array.isArray(drawable.material) ? drawable.material : [drawable.material];
    for (const material of nodeMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if ((value as THREE.Texture)?.isTexture) textures.add(value as THREE.Texture);
      for (const uniform of Object.values((material as THREE.ShaderMaterial).uniforms ?? {})) {
        if ((uniform.value as THREE.Texture)?.isTexture) textures.add(uniform.value);
      }
    }
    const skeleton = (node as THREE.SkinnedMesh).skeleton;
    if (skeleton?.boneTexture) textures.add(skeleton.boneTexture);
  });
  textures.forEach((texture) => texture.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  object.removeFromParent();
}

function selectModelAction(avatar: THREE.Group, state: VesselAnimationState): void {
  const u = avatar.userData;
  if (!u.mixer) return;
  const clips = (u.modelAnimations ?? []) as THREE.AnimationClip[];
  const aliases: Record<VesselAnimationState, string[]> = {
    idle: ['idle', 'breathe'], surge: ['surge', 'cast', 'raise'], travel: ['travel', 'walk', 'run'],
    'contest-attack': ['contestattack', 'attack', 'strike'], 'contest-defend': ['contestdefend', 'defend', 'guard'],
  };
  const findClip = (names: string[]) => clips.find((clip) => names.some((name) => clip.name.toLowerCase().replace(/[^a-z]/g, '').includes(name)));
  const clip = findClip(aliases[state]) ?? findClip(aliases.idle) ?? clips[0];
  if (!clip) return;
  const action = (u.mixer as THREE.AnimationMixer).clipAction(clip);
  if (u.modelAction === action) return;
  u.modelAction?.fadeOut(0.18);
  action.reset().fadeIn(0.18).play();
  u.modelAction = action;
}

function clearExternalModel(avatar: THREE.Group): void {
  const u = avatar.userData;
  if (u.mixer) {
    u.mixer.stopAllAction();
    u.mixer.uncacheRoot(u.modelScene);
  }
  if (u.externalModel) disposeObjectResources(u.externalModel);
  u.externalModel = null;
  u.modelScene = null;
  u.mixer = null;
  u.modelAction = null;
  u.modelAnimations = [];
  u.rig.visible = true;
}

function loadExternalModel(avatar: THREE.Group, url?: string): void {
  const u = avatar.userData;
  if (!u.loadModelAsync || u.disposed || u.modelLoadUrl === (url ?? null)) return;
  u.modelLoadUrl = url ?? null;
  const generation = ++u.modelLoadVersion;
  clearExternalModel(avatar);
  if (!url || !customModelLoader) return;
  const loader = customModelLoader;
  u.modelReady = Promise.resolve().then(() => loader(url)).then((asset) => {
    if (!asset?.scene?.isObject3D) throw new Error('The model adapter must return { scene, animations? }.');
    if (u.disposed || generation !== u.modelLoadVersion) {
      disposeObjectResources(asset.scene);
      return;
    }
    const scene = asset.scene;
    scene.removeFromParent();
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(scene);
    const height = bounds.getSize(new THREE.Vector3()).y;
    if (!Number.isFinite(height) || height <= 0) {
      disposeObjectResources(scene);
      throw new Error('The external avatar needs non-empty, finite model bounds.');
    }
    // Clips may bind the scene root's position/scale. Keep normalization outside that hierarchy.
    const scale = 2.7 / height;
    const center = bounds.getCenter(new THREE.Vector3());
    const wrapper = new THREE.Group();
    wrapper.name = 'ExternalGLTFModel';
    wrapper.scale.setScalar(scale);
    wrapper.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    wrapper.add(scene);
    avatar.add(wrapper);
    u.externalModel = wrapper;
    u.modelScene = scene;
    u.modelAnimations = asset.animations ?? [];
    u.mixer = new THREE.AnimationMixer(scene);
    u.rig.visible = false;
    selectModelAction(avatar, u.animationState);
  }).catch((error) => {
    if (!u.disposed && generation === u.modelLoadVersion) {
      u.modelError = error;
      console.warn(`[VesselAvatar3D] Failed to load external model for ${u.agentId}:`, error);
    }
  });
}

function rebuildSealOrbiters(avatar: THREE.Group, agent: RatedAgentPayload): void {
  const group = avatar.userData.sealOrbiters as THREE.Group;
  for (const child of [...group.children]) disposeObjectResources(child);
  const total = agent.seals.reduce((sum, seal) => sum + getSealShardCount(seal.tier), 0);
  let index = 0;
  for (const seal of agent.seals) {
    for (let shardIndex = 0; shardIndex < getSealShardCount(seal.tier); shardIndex++) {
      const color = SEAL_TIER_HEX_COLORS[seal.tier];
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.85, metalness: 0.85, roughness: 0.15,
      }));
      const angle = Math.PI * 2 * index / Math.max(1, total);
      const restY = Math.sin(index * 1.3) * 0.15;
      shard.name = `SealOrbiter_${seal.statKey}_${shardIndex}`;
      shard.position.set(Math.cos(angle) * 0.95, restY, Math.sin(angle) * 0.95);
      shard.userData = { sealTier: seal.tier, statKey: seal.statKey, shardIndex, orbitAngle: angle, orbitRadius: 0.95, restY };
      group.add(shard);
      index++;
    }
  }
}

function rebuildCorona(avatar: THREE.Group, agent: RatedAgentPayload): void {
  const u = avatar.userData;
  if (u.surgeCorona) disposeObjectResources(u.surgeCorona);
  u.surgeCorona = null;
  if (!agent.surge.active) return;
  const corona = new THREE.Group();
  corona.name = 'SurgeCorona';
  corona.position.y = 1.4;
  const color = agent.surge.surgeType === 'tempest' ? 0x38bdf8 : agent.surge.surgeType === 'equilibrium' ? 0x00f0ff : 0xffaa00;
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.05, 3.4, 16, 1, true),
    new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  pillar.name = 'SurgePillar';
  corona.add(pillar);
  if (agent.surge.surgeType === 'equilibrium') {
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 3.2, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: true, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    inner.name = 'SurgePillarInner';
    corona.add(inner);
  }
  u.rig.add(corona);
  u.surgeCorona = corona;
}

/** Refresh live ratings, body effects, likeness and ring without replacing the placed root. */
export function refreshVesselFromPayload(avatar: THREE.Group, payload: RatedAgentPayload): void {
  const u = avatar.userData;
  if (u.disposed || u.agentId !== payload.key) return;
  const agent = JSON.parse(JSON.stringify(payload)) as RatedAgentPayload;
  u.agentPayload = agent;
  u.footRing.userData.agentPayload = agent;
  updateFootRingEsmsAndSurge(u.footRing, agent.esms, agent.surge);
  const seals = JSON.stringify(agent.seals);
  if (seals !== u.sealSignature) {
    rebuildSealOrbiters(avatar, agent);
    u.sealSignature = seals;
  }
  const coronaType = agent.surge.active ? agent.surge.surgeType : null;
  if (coronaType !== u.coronaType) {
    rebuildCorona(avatar, agent);
    u.coronaType = coronaType;
  }
  const factionColor = new THREE.Color(FACTION_HEX_COLORS[agent.faction] ?? '#00daf3');
  const statColor = new THREE.Color(SACRED_STAT_HEX_COLORS[agent.archetype.primary]);
  const torsoMaterial = (u.torsoGroup.getObjectByName('TorsoMesh') as THREE.Mesh).material as THREE.MeshStandardMaterial;
  torsoMaterial.color.copy(factionColor);
  torsoMaterial.emissive.copy(factionColor);
  torsoMaterial.emissiveIntensity = agent.surge.active ? 0.75 : 0.25;
  for (const mesh of [u.coreGem, u.circlet]) {
    mesh.material.color.copy(statColor);
    mesh.material.emissive.copy(statColor);
  }
  u.astralHalo.children[0].material.color.copy(agent.surge.active ? new THREE.Color(0xffea00) : factionColor);
  const appearance = agent.appearance ?? resolveAgentAppearance(agent.key, agent.faction, agent.archetype);
  const appearanceSignature = JSON.stringify(appearance);
  if (appearanceSignature !== u.appearanceSignature) {
    const previousSilhouette = new THREE.Group();
    previousSilhouette.add(...Object.values(u.silhouette) as THREE.Group[]);
    disposeObjectResources(previousSilhouette);
    const silhouette = createVesselSilhouette(appearance);
    u.headGroup.add(silhouette.head);
    u.torsoGroup.add(silhouette.garment);
    u.rightArm.add(silhouette.relic);
    u.silhouette = silhouette;
    u.relic = silhouette.relic;
    u.appearance = appearance;
    u.appearanceSignature = appearanceSignature;
    const head = u.headGroup.getObjectByName('HeadMesh') as THREE.Mesh;
    (head.material as THREE.MeshStandardMaterial).color.set(appearance.paletteOverrides.skinOrMaterialToneHex);
    const proportions = appearance.headSilhouette.faceProportion;
    head.scale.set(proportions.jawWidth, proportions.cranialHeight, proportions.browDepth);
  }
  captureRestTransforms(avatar);
  if (u.animationState === 'idle' || u.animationState === 'surge') {
    setVesselAnimationState(avatar, agent.surge.active ? 'surge' : 'idle');
  }
  loadExternalModel(avatar, agent.avatarModelUrl ?? appearance.avatarModelUrl);
}

export function disposeVesselAvatar(avatar: THREE.Group): void {
  const u = avatar.userData;
  if (u.disposed) return;
  u.disposed = true;
  u.modelLoadVersion++;
  if (u.mixer) {
    u.mixer.stopAllAction();
    u.mixer.uncacheRoot(u.modelScene);
  }
  liveWalletSync.unregisterFootRingMesh(u.agentId, u.footRing);
  liveWalletSync.unregisterVesselAvatar(u.agentId, avatar);
  disposeObjectResources(avatar);
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
