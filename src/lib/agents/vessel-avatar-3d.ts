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
 *   6. Seven blended, state-local procedural animation states
 *   7. Raycasting & Click Selection picking helper
 */

import * as THREE from 'three';
import {
  type RatedAgentPayload,
  type SealTier,
  type SacredStat,
  type EsmsKey,
  ESMS_KEYS,
} from './rating-contract';
import {
  createFootRingMeshSync,
  FACTION_HEX_COLORS,
  updateFootRingEsmsAndSurge,
} from './avatar-foot-ring';
import { liveWalletSync } from './live-wallet-sync';
import { resolveAgentAppearance } from './vessel-appearance-manifest';
import { createVesselSilhouette } from './vessel-silhouettes';

export type VesselAnimationState = 'idle' | 'surge' | 'travel' | 'contest-attack' | 'contest-defend' | 'victory' | 'stagger';

export interface VesselAvatarOptions {
  zoneId?: number;
  slot?: 'owner' | 'challenger';
  footRingRadius?: number;
  loadModelAsync?: boolean;
}

export interface VesselAnimationOptions {
  overrideState?: VesselAnimationState;
  lookAtWorldPos?: THREE.Vector3 | null;
}

export interface PickedVesselResult {
  agentId: string;
  zoneId: number | null;
  payload: RatedAgentPayload;
  avatarGroup: THREE.Group;
}

/**
 * Resolves the dominant ESMS element for an agent payload.
 */
export function resolveDominantEsms(payload: RatedAgentPayload): EsmsKey {
  if (payload.esms) {
    let bestKey: EsmsKey = 'spirit';
    let maxVal = -Infinity;
    for (const key of ESMS_KEYS) {
      const val = payload.esms[key];
      if (typeof val === 'number' && val > maxVal) {
        maxVal = val;
        bestKey = key;
      }
    }
    if (Number.isFinite(maxVal) && maxVal > -Infinity) return bestKey;
  }
  const stat = payload.archetype?.primary;
  switch (stat) {
    case 'power':
    case 'vitality':
      return 'spirit';
    case 'resonance':
    case 'charisma':
      return 'essence';
    case 'wisdom':
      return 'matter';
    case 'intuition':
    case 'adaptability':
      return 'substance';
    default:
      return 'spirit';
  }
}

/**
 * Injects a lightweight ~10-line onBeforeCompile Fresnel rim lighting term into
 * MeshStandardMaterial in view-space, making smoothed geometry pop against the dark arena floor.
 */
export function attachFresnelRim(
  material: THREE.MeshStandardMaterial,
  rimColor: THREE.Color | string = '#60a5fa',
  power = 2.8,
  intensity = 0.65
): THREE.MeshStandardMaterial {
  const color = rimColor instanceof THREE.Color ? rimColor : new THREE.Color(rimColor);
  material.userData.fresnelRim = { color, power, intensity };
  material.customProgramCacheKey = () => 'vessel-fresnel-rim';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFresnelRimColor = { value: color };
    shader.uniforms.uFresnelPower = { value: power };
    shader.uniforms.uFresnelIntensity = { value: intensity };

    shader.fragmentShader = `uniform vec3 uFresnelRimColor;\nuniform float uFresnelPower;\nuniform float uFresnelIntensity;\n` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       float fRim = pow(1.0 - clamp(dot(normalize(vNormal), normalize(-vViewPosition)), 0.0, 1.0), uFresnelPower);
       gl_FragColor.rgb += uFresnelRimColor * (fRim * uFresnelIntensity);`
    );
  };
  return material;
}

export const NON_SHADOW_NODE_NAMES: ReadonlySet<string> = new Set([
  'AstralHalo',
  'AstralHaloMesh',
  'SealOrbiters',
  'SurgeCorona',
  'SurgePillar',
  'SurgePillarInner',
  'UnderFootResonanceRing',
  'VesselBadgeSprite',
  'VesselIdentityBadge',
  'WardShield',
]);

/**
 * Selective shadow policy: Enforces castShadow and receiveShadow strictly on
 * opaque structural geometry (!material.transparent && normalBlending), avoiding
 * the "black box" aura bug caused by shadow mapping on transparent or additive VFX.
 */
export function applyVesselShadowPolicy(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (NON_SHADOW_NODE_NAMES.has(node.name) || node.name.startsWith('SealOrbiter_')) {
      node.castShadow = false;
      node.receiveShadow = false;
      return;
    }
    if ((node as THREE.Mesh).isMesh) {
      const mesh = node as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const isOpaque = mats.every(
        (m) => m && !m.transparent && m.blending === THREE.NormalBlending
      );
      mesh.castShadow = isOpaque;
      mesh.receiveShadow = isOpaque;
    }
  });
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
    case 'Astral':
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
  Astral: '#00f0ff',
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

/** Built-in fallback loader for rigged .glb / .gltf assets using Three.js dynamic import */
async function defaultGLTFModelLoader(url: string): Promise<VesselModelAsset> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  try {
    const { DRACOLoader } = await import('three/addons/loaders/DRACOLoader.js');
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);
  } catch {
    // DRACOLoader optional fallback
  }
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
      undefined,
      (err) => reject(err)
    );
  });
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
  if (agent.ratingSource !== 'live') liveWalletSync.registerFootRingMesh(agent.key, footRing);

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

  const torsoGeo = new THREE.CylinderGeometry(0.32, 0.18, 0.85, 14);
  const torsoMat = new THREE.MeshStandardMaterial({
    color: factionColor,
    roughness: 0.25,
    metalness: 0.8,
    emissive: factionColor,
    emissiveIntensity: agent.surge.active ? 0.75 : 0.25,
  });
  attachFresnelRim(torsoMat, factionColor, 2.5, 0.75);
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
  const circletGeo = new THREE.TorusGeometry(0.32, 0.03, 10, 24);
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

  // --- Facial Features (Brow Ridge & Low-Poly Almond Eyes) ---
  const facialFeatures = new THREE.Group();
  facialFeatures.name = 'FacialFeatures';

  const browGeo = new THREE.BoxGeometry(0.24, 0.035, 0.06);
  const browMat = new THREE.MeshStandardMaterial({
    color: appearance.paletteOverrides.hairOrCrownHex,
    roughness: 0.85,
    metalness: 0.1,
  });
  const browMesh = new THREE.Mesh(browGeo, browMat);
  browMesh.name = 'BrowRidgeMesh';
  browMesh.position.set(0, 0.08, 0.22);
  facialFeatures.add(browMesh);

  const eyesGroup = new THREE.Group();
  eyesGroup.name = 'EyesGroup';
  eyesGroup.position.set(0, 0.01, 0.23);

  const eyeGeo = new THREE.BoxGeometry(0.045, 0.025, 0.03);
  const eyeMat = new THREE.MeshStandardMaterial({
    color: statColor,
    roughness: 0.1,
    metalness: 0.9,
    emissive: statColor,
    emissiveIntensity: 0.75,
  });

  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.name = 'EyeMesh_Left';
  leftEye.position.set(-0.075, 0, 0);
  eyesGroup.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.name = 'EyeMesh_Right';
  rightEye.position.set(0.075, 0, 0);
  eyesGroup.add(rightEye);

  facialFeatures.add(eyesGroup);
  headGroup.add(facialFeatures);

  // --- Two-Bone Articulated Arms ---
  const upperArmGeo = new THREE.CylinderGeometry(0.08, 0.065, 0.36, 14);
  const elbowJointGeo = new THREE.SphereGeometry(0.065, 12, 10);
  const forearmGeo = new THREE.CylinderGeometry(0.065, 0.055, 0.34, 14);
  const handSocketGeo = new THREE.SphereGeometry(0.055, 12, 10);
  const armMat = new THREE.MeshStandardMaterial({
    color: factionColor,
    roughness: 0.3,
    metalness: 0.8,
  });

  // Left Arm (Shoulder Pivot -> UpperArm -> ElbowPivot -> Forearm -> HandSocket)
  const leftArm = new THREE.Group();
  leftArm.name = 'LeftArm';
  leftArm.position.set(-0.6, 1.45, 0);

  const leftUpperArm = new THREE.Group();
  leftUpperArm.name = 'LeftUpperArm';
  const leftUpperArmMesh = new THREE.Mesh(upperArmGeo, armMat);
  leftUpperArmMesh.position.set(0, -0.18, 0);
  leftUpperArm.add(leftUpperArmMesh);
  leftArm.add(leftUpperArm);

  const leftElbow = new THREE.Group();
  leftElbow.name = 'LeftElbowPivot';
  leftElbow.position.set(0, -0.36, 0);
  const leftElbowMesh = new THREE.Mesh(elbowJointGeo, armMat);
  leftElbow.add(leftElbowMesh);

  const leftForearm = new THREE.Group();
  leftForearm.name = 'LeftForearm';
  const leftForearmMesh = new THREE.Mesh(forearmGeo, armMat);
  leftForearmMesh.position.set(0, -0.17, 0);
  leftForearm.add(leftForearmMesh);

  const leftHandSocket = new THREE.Group();
  leftHandSocket.name = 'LeftHandSocket';
  leftHandSocket.position.set(0, -0.34, 0);
  const leftHandMesh = new THREE.Mesh(handSocketGeo, armMat);
  leftHandSocket.add(leftHandMesh);
  leftForearm.add(leftHandSocket);
  leftElbow.add(leftForearm);
  leftArm.add(leftElbow);

  // Right Arm (Shoulder Pivot -> UpperArm -> ElbowPivot -> Forearm -> HandSocket)
  const rightArm = new THREE.Group();
  rightArm.name = 'RightArm';
  rightArm.position.set(0.6, 1.45, 0);

  const rightUpperArm = new THREE.Group();
  rightUpperArm.name = 'RightUpperArm';
  const rightUpperArmMesh = new THREE.Mesh(upperArmGeo, armMat);
  rightUpperArmMesh.position.set(0, -0.18, 0);
  rightUpperArm.add(rightUpperArmMesh);
  rightArm.add(rightUpperArm);

  const rightElbow = new THREE.Group();
  rightElbow.name = 'RightElbowPivot';
  rightElbow.position.set(0, -0.36, 0);
  const rightElbowMesh = new THREE.Mesh(elbowJointGeo, armMat);
  rightElbow.add(rightElbowMesh);

  const rightForearm = new THREE.Group();
  rightForearm.name = 'RightForearm';
  const rightForearmMesh = new THREE.Mesh(forearmGeo, armMat);
  rightForearmMesh.position.set(0, -0.17, 0);
  rightForearm.add(rightForearmMesh);

  const rightHandSocket = new THREE.Group();
  rightHandSocket.name = 'RightHandSocket';
  rightHandSocket.position.set(0, -0.34, 0);
  const rightHandMesh = new THREE.Mesh(handSocketGeo, armMat);
  rightHandSocket.add(rightHandMesh);
  rightForearm.add(rightHandSocket);
  rightElbow.add(rightForearm);
  rightArm.add(rightElbow);

  const silhouette = createVesselSilhouette(appearance, agent.key);
  headGroup.add(silhouette.head);
  silhouette.garment.traverse((child) => {
    if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material instanceof THREE.MeshStandardMaterial) {
      attachFresnelRim((child as THREE.Mesh).material as THREE.MeshStandardMaterial, factionColor, 2.8, 0.6);
    }
  });
  torsoGroup.add(silhouette.garment);
  silhouette.relic.position.set(0, 0.05, 0.12);
  rightHandSocket.add(silhouette.relic);
  if (silhouette.offHand) {
    silhouette.offHand.position.set(0, 0.05, 0.12);
    leftHandSocket.add(silhouette.offHand);
  }

  // --- Articulated Lower Body ---
  const lowerBodyStyle = appearance.lowerBodyStyle ?? 'full-robe';
  const lowerBody = new THREE.Group();
  lowerBody.name = 'LowerBody';
  lowerBody.position.set(0, 0.95, 0);

  const garmentHex = appearance.paletteOverrides.primaryGarmentHex;
  const skinHex = appearance.paletteOverrides.skinOrMaterialToneHex;
  const clothMat = new THREE.MeshStandardMaterial({ color: garmentHex, roughness: 0.8, metalness: 0.1 });
  attachFresnelRim(clothMat, factionColor, 2.8, 0.6);
  const steelMat = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.3, metalness: 0.9, emissive: '#334155', emissiveIntensity: 0.1 });
  const goldMat = new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.3, metalness: 0.85, emissive: '#d97706', emissiveIntensity: 0.2 });
  const leatherMat = new THREE.MeshStandardMaterial({ color: '#1e1b18', roughness: 0.7, metalness: 0.2 });
  const skinMat = new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.6, metalness: 0.1 });

  const thighMat = lowerBodyStyle === 'armored-cuisses' ? steelMat : lowerBodyStyle === 'tunic-greaves' ? skinMat : clothMat;
  const kneeMat = lowerBodyStyle === 'armored-cuisses' ? goldMat : lowerBodyStyle === 'tunic-greaves' ? goldMat : clothMat;
  const calfMat = lowerBodyStyle === 'armored-cuisses' ? steelMat : lowerBodyStyle === 'tunic-greaves' ? goldMat : clothMat;
  const bootMat = lowerBodyStyle === 'armored-cuisses' ? steelMat : leatherMat;

  const thighGeo = new THREE.CylinderGeometry(0.09, 0.075, 0.44, 14);
  const kneeGeo = new THREE.SphereGeometry(0.075, 12, 10);
  const calfGeo = new THREE.CylinderGeometry(0.075, 0.06, 0.42, 14);
  const bootGeo = new THREE.BoxGeometry(0.12, 0.08, 0.22);

  // Left Leg: hipPivot -> thigh -> kneePivot -> calf -> boot
  const leftLeg = new THREE.Group();
  leftLeg.name = 'LeftLeg';
  leftLeg.position.set(-0.16, 0, 0);

  const leftThigh = new THREE.Group();
  leftThigh.name = 'LeftThigh';
  const leftThighMesh = new THREE.Mesh(thighGeo, thighMat);
  leftThighMesh.position.set(0, -0.22, 0);
  leftThigh.add(leftThighMesh);
  leftLeg.add(leftThigh);

  const leftKnee = new THREE.Group();
  leftKnee.name = 'LeftKneePivot';
  leftKnee.position.set(0, -0.44, 0);
  const leftKneeMesh = new THREE.Mesh(kneeGeo, kneeMat);
  leftKnee.add(leftKneeMesh);

  const leftCalf = new THREE.Group();
  leftCalf.name = 'LeftCalf';
  const leftCalfMesh = new THREE.Mesh(calfGeo, calfMat);
  leftCalfMesh.position.set(0, -0.21, 0);
  leftCalf.add(leftCalfMesh);

  const leftBoot = new THREE.Group();
  leftBoot.name = 'LeftBoot';
  leftBoot.position.set(0, -0.42, 0.04);
  const leftBootMesh = new THREE.Mesh(bootGeo, bootMat);
  leftBoot.add(leftBootMesh);
  leftCalf.add(leftBoot);
  leftKnee.add(leftCalf);
  leftLeg.add(leftKnee);
  lowerBody.add(leftLeg);

  // Right Leg: hipPivot -> thigh -> kneePivot -> calf -> boot
  const rightLeg = new THREE.Group();
  rightLeg.name = 'RightLeg';
  rightLeg.position.set(0.16, 0, 0);

  const rightThigh = new THREE.Group();
  rightThigh.name = 'RightThigh';
  const rightThighMesh = new THREE.Mesh(thighGeo, thighMat);
  rightThighMesh.position.set(0, -0.22, 0);
  rightThigh.add(rightThighMesh);
  rightLeg.add(rightThigh);

  const rightKnee = new THREE.Group();
  rightKnee.name = 'RightKneePivot';
  rightKnee.position.set(0, -0.44, 0);
  const rightKneeMesh = new THREE.Mesh(kneeGeo, kneeMat);
  rightKnee.add(rightKneeMesh);

  const rightCalf = new THREE.Group();
  rightCalf.name = 'RightCalf';
  const rightCalfMesh = new THREE.Mesh(calfGeo, calfMat);
  rightCalfMesh.position.set(0, -0.21, 0);
  rightCalf.add(rightCalfMesh);

  const rightBoot = new THREE.Group();
  rightBoot.name = 'RightBoot';
  rightBoot.position.set(0, -0.42, 0.04);
  const rightBootMesh = new THREE.Mesh(bootGeo, bootMat);
  rightBoot.add(rightBootMesh);
  rightCalf.add(rightBoot);
  rightKnee.add(rightCalf);
  rightLeg.add(rightKnee);
  lowerBody.add(rightLeg);

  if (lowerBodyStyle === 'full-robe') {
    const robeSkirtGeo = new THREE.CylinderGeometry(0.36, 0.52, 0.9, 16, 1, true);
    const robeSkirtMesh = new THREE.Mesh(robeSkirtGeo, clothMat);
    robeSkirtMesh.name = 'RobeSkirtDrape';
    robeSkirtMesh.position.set(0, -0.45, 0);
    lowerBody.add(robeSkirtMesh);
  }

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
  rig.add(lowerBody);
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
    leftUpperArm,
    leftElbow,
    leftForearm,
    leftHandSocket,
    rightArm,
    rightUpperArm,
    rightElbow,
    rightForearm,
    rightHandSocket,
    lowerBody,
    leftLeg,
    leftThigh,
    leftKnee,
    leftCalf,
    leftBoot,
    rightLeg,
    rightThigh,
    rightKnee,
    rightCalf,
    rightBoot,
    astralHalo: haloGroup,
    sealOrbiters: sealOrbitersGroup,
    wardShield,
    surgeCorona,
    baseTorsoY: 1.35,
    coreGem: gemMesh,
    circlet: circletMesh,
    relic: silhouette.relic,
    offHand: silhouette.offHand,
    silhouette,
    appearance,
    appearanceSignature: JSON.stringify(appearance),
    sealSignature: JSON.stringify(agent.seals),
    dominantElement: resolveDominantEsms(agent),
    facialFeatures,
    eyesGroup,
    browMesh,
    leftEye,
    rightEye,
    blinkTimer: 0,
    nextBlink: 2.5 + ((agent.key.charCodeAt(0) || 65) % 20) * 0.1,
    coronaType: agent.surge.active ? agent.surge.surgeType : null,
    stateElapsed: 0,
    activeAnimationState: agent.surge.active ? 'surge' : 'idle',
    modelLoadVersion: 0,
    loadModelAsync: options.loadModelAsync ?? Boolean(agent.avatarModelUrl ?? appearance.avatarModelUrl),
    disposed: false,
  };
  captureRestTransforms(root);
  applyVesselShadowPolicy(root);
  if (agent.ratingSource !== 'live') liveWalletSync.registerVesselAvatar(agent.key, root, refreshVesselFromPayload, agent);
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
  const pivots = {
    torso: u.torsoGroup,
    coreGem: u.coreGem,
    head: u.headGroup,
    circlet: u.circlet,
    leftArm: u.leftArm,
    leftElbow: u.leftElbow,
    rightArm: u.rightArm,
    rightElbow: u.rightElbow,
    lowerBody: u.lowerBody,
    leftLeg: u.leftLeg,
    leftKnee: u.leftKnee,
    rightLeg: u.rightLeg,
    rightKnee: u.rightKnee,
    halo: u.astralHalo,
    ward: u.wardShield,
    corona: u.surgeCorona,
    relic: u.relic,
  };
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
  stateOrOptions?: VesselAnimationState | VesselAnimationOptions
): void {
  const u = avatarGroup.userData;
  if (!u?.rig || u.disposed) return;
  const dt = Number.isFinite(deltaSec) ? Math.max(0, Math.min(deltaSec, 0.1)) : 0;
  const overrideState = typeof stateOrOptions === 'string' ? stateOrOptions : stateOrOptions?.overrideState;
  const lookAtWorldPos = typeof stateOrOptions === 'object' ? stateOrOptions?.lookAtWorldPos : null;

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
  } else if (state === 'victory') {
    ringScale.multiplyScalar(1.14 + Math.sin(t * 8) * 0.08);
  } else if (state === 'stagger') {
    ringScale.x *= 1 + Math.sin(t * 16) * 0.06;
    ringScale.y *= 1 + Math.cos(t * 16) * 0.06;
    ringPosition.z -= 0.16;
  }
  u.footRing.position.lerp(ringPosition, alpha);
  u.footRing.scale.lerp(ringScale, alpha);
  if (u.externalModel) {
    // External clip tracks own the loaded hierarchy. Do not animate hidden fallback pivots.
    (u.mixer as THREE.AnimationMixer | undefined)?.update(dt);
    return;
  }

  // Periodic eyelid blink controller
  if (u.eyesGroup) {
    u.blinkTimer = (u.blinkTimer ?? 0) + dt;
    if (!u.nextBlink) u.nextBlink = 3.0 + (u.agentId ? (u.agentId.charCodeAt(0) % 20) * 0.1 : 1.0);
    if (u.blinkTimer >= u.nextBlink) {
      const blinkPhase = (u.blinkTimer - u.nextBlink) / 0.16;
      if (blinkPhase >= 1.0) {
        u.eyesGroup.scale.y = 1.0;
        u.blinkTimer = 0;
        u.nextBlink = 3.0 + Math.random() * 2.5;
      } else {
        u.eyesGroup.scale.y = Math.max(0.08, Math.abs(Math.cos(blinkPhase * Math.PI)));
      }
    } else {
      u.eyesGroup.scale.y = 1.0;
    }
  }

  const rest = u.restTransforms as Record<string, RestTransform>;
  const targets = Object.fromEntries(Object.entries(rest).map(([key, r]) => [key, {
    position: r.position.clone(), rotation: r.rotation.clone(), scale: r.scale.clone(),
  }]));
  const {
    torso, coreGem, head, circlet,
    leftArm, leftElbow, rightArm, rightElbow,
    leftLeg, leftKnee, rightLeg, rightKnee,
    halo, ward, corona, relic,
  } = targets;

  const breath = Math.sin(t * 2) * 0.04;
  torso.position.y += breath;
  head.position.y += breath;
  head.rotation.y += Math.sin(t * 0.8) * 0.12;
  leftArm.rotation.x += Math.sin(t * 2) * 0.08;
  rightArm.rotation.x -= Math.sin(t * 2) * 0.08;
  if (leftElbow) leftElbow.rotation.x = -0.35 + Math.sin(t * 2) * 0.04;
  if (rightElbow) rightElbow.rotation.x = -0.45 + Math.sin(t * 2) * 0.04;
  if (leftLeg) leftLeg.rotation.z = -0.04 + Math.sin(t * 1) * 0.02;
  if (rightLeg) rightLeg.rotation.z = 0.04 - Math.sin(t * 1) * 0.02;

  let wardOpacity = 0;
  if (state === 'surge') {
    const lift = 0.35 + Math.sin(t * 4.2) * 0.09;
    torso.position.y = rest.torso.position.y + lift;
    head.position.y = rest.head.position.y + lift;
    torso.rotation.y += Math.sin(t * 3) * 0.15;
    head.rotation.x -= 0.15;

    // Two-handed channeling pose towards center
    leftArm.rotation.set(-0.85, 0.35, 0.6);
    if (leftElbow) leftElbow.rotation.set(-1.1, -0.4, 0);
    rightArm.rotation.set(-0.85, -0.35, -0.6);
    if (rightElbow) rightElbow.rotation.set(-1.1, 0.4, 0);

    // Relic elevates and centers between both hands
    if (relic) {
      relic.position.set(-0.18, 0.14, 0.22);
      relic.rotation.y += t * 3.5;
    }

    if (leftLeg) {
      leftLeg.rotation.set(0.1, 0, -0.15);
      if (leftKnee) leftKnee.rotation.x = 0.2;
    }
    if (rightLeg) {
      rightLeg.rotation.set(0.1, 0, 0.15);
      if (rightKnee) rightKnee.rotation.x = 0.2;
    }
  } else if (state === 'travel') {
    const hover = 0.16 + Math.sin(t * 6) * 0.04;
    torso.position.y += hover;
    head.position.y += hover;
    leftArm.position.y += hover;
    rightArm.position.y += hover;
    torso.rotation.x += 0.18;
    head.rotation.x -= 0.08;
    leftArm.rotation.set(0.55, 0, 0.15);
    if (leftElbow) leftElbow.rotation.set(-0.55, 0, 0);
    rightArm.rotation.set(0.55, 0, -0.15);
    if (rightElbow) rightElbow.rotation.set(-0.55, 0, 0);

    if (leftLeg) {
      leftLeg.rotation.x = -0.35 + Math.sin(t * 6) * 0.25;
      if (leftKnee) leftKnee.rotation.x = 0.45;
    }
    if (rightLeg) {
      rightLeg.rotation.x = 0.25 - Math.sin(t * 6) * 0.25;
      if (rightKnee) rightKnee.rotation.x = 0.2;
    }
  } else if (state === 'contest-attack') {
    const dominant: EsmsKey = (u.attackElementOverride as EsmsKey) ?? (u.dominantElement as EsmsKey) ?? 'spirit';
    const lunge = Math.sin(Math.min(t / 0.75, 1) * Math.PI);

    if (dominant === 'spirit') {
      // spirit (Wands / Fire): High overhead right-arm relic raise followed by a sharp forward spear-thrust and torso pitch (+0.28 rad), pulsing SurgeCorona vertically
      torso.position.y -= 0.1;
      torso.position.z += lunge * 0.65;
      torso.rotation.x += 0.28;

      head.position.y = rest.head.position.y - 0.1;
      head.position.z += lunge * 0.7;
      head.rotation.x += 0.12;

      const raisePhase = Math.max(0, 1 - (t / 0.35));
      rightArm.position.z += lunge * 0.45;
      rightArm.rotation.set(-1.45 - raisePhase * 0.9, 0, -0.1);
      if (rightElbow) rightElbow.rotation.set(-0.25, 0, 0);

      leftArm.rotation.set(0.75, 0, 0.25);
      if (leftElbow) leftElbow.rotation.set(-0.95, 0, 0);

      if (leftLeg) {
        leftLeg.rotation.x = 0.35;
        if (leftKnee) leftKnee.rotation.x = 0.15;
      }
      if (rightLeg) {
        rightLeg.rotation.x = -0.45;
        if (rightKnee) rightKnee.rotation.x = 0.7;
      }

      if (corona) {
        corona.scale.y = 1.0 + lunge * 0.45;
      }
    } else if (dominant === 'essence') {
      // essence (Cups / Water): Dual-arm counter-rotating harmonic sweep with figure-eight torso sway and expanded ripple
      const sweep = Math.sin(t * 8);
      torso.position.z += lunge * 0.4;
      torso.rotation.x += 0.25;
      torso.rotation.y += sweep * 0.24;
      torso.rotation.z += Math.cos(t * 4) * 0.12;

      head.position.z += lunge * 0.45;
      head.rotation.y -= sweep * 0.18;

      leftArm.rotation.set(-0.8 + Math.cos(t * 6) * 0.5, 0.4, 0.4);
      if (leftElbow) leftElbow.rotation.set(-0.6, 0, 0);
      rightArm.rotation.set(-0.8 - Math.sin(t * 6) * 0.5, -0.4, -0.4);
      if (rightElbow) rightElbow.rotation.set(-0.6, 0, 0);

      if (relic) relic.rotation.z += t * 6.0;

      if (leftLeg) leftLeg.rotation.z = -0.15 + sweep * 0.1;
      if (rightLeg) rightLeg.rotation.z = 0.15 - sweep * 0.1;

      ringScale.multiplyScalar(1.0 + lunge * 0.25);
    } else if (dominant === 'matter') {
      // matter (Pentacles / Earth): Heavy two-handed overhead lift into grounded knee-bend slam and shield-stance guard
      const liftPhase = Math.sin(Math.min(t / 0.4, 1) * (Math.PI / 2));
      const slamPhase = t > 0.4 ? Math.sin(Math.min((t - 0.4) / 0.35, 1) * Math.PI) : 0;

      torso.position.y -= slamPhase * 0.28;
      torso.position.z += (liftPhase * 0.2) + (slamPhase * 0.4);
      torso.rotation.x += 0.28 + slamPhase * 0.12;

      head.position.y -= slamPhase * 0.28;
      head.rotation.x += slamPhase * 0.2;

      const armPitch = -2.2 * liftPhase + (slamPhase * 1.6);
      leftArm.rotation.set(armPitch, 0.2, 0.25);
      if (leftElbow) leftElbow.rotation.set(-0.8, 0, 0);
      rightArm.rotation.set(armPitch, -0.2, -0.25);
      if (rightElbow) rightElbow.rotation.set(-0.8, 0, 0);

      if (leftLeg) {
        leftLeg.rotation.x = slamPhase * 0.3;
        if (leftKnee) leftKnee.rotation.x = slamPhase * 0.75;
      }
      if (rightLeg) {
        rightLeg.rotation.x = slamPhase * 0.3;
        if (rightKnee) rightKnee.rotation.x = slamPhase * 0.75;
      }
      ward.scale.setScalar(1 + slamPhase * 0.35);
      wardOpacity = slamPhase * 0.45;
    } else {
      // substance (Swords / Air): Rapid 360° axial pirouette with outward horizontal relic slash and accelerated SealOrbiters velocity
      const spinProgress = Math.min(t / 0.75, 1);
      const spinAngle = spinProgress * Math.PI * 2;
      torso.rotation.y += spinAngle;
      torso.rotation.x += 0.28;
      torso.position.z += lunge * 0.55;

      head.position.y = rest.head.position.y - 0.05;
      head.position.z += lunge * 0.6;
      head.rotation.y += Math.sin(spinAngle) * 0.25;

      rightArm.position.z += lunge * 0.4;
      rightArm.rotation.set(-1.2, -lunge * 1.4, 0.5);
      if (rightElbow) rightElbow.rotation.set(-0.3, 0, 0);
      leftArm.rotation.set(0.6, 0, 0.35);
      if (leftElbow) leftElbow.rotation.set(-0.8, 0, 0);

      if (leftLeg) leftLeg.rotation.y = Math.sin(spinAngle) * 0.2;
      if (rightLeg) rightLeg.rotation.y = -Math.sin(spinAngle) * 0.2;
    }
  } else if (state === 'contest-defend') {
    torso.position.y -= 0.18;
    torso.position.z -= 0.15;
    torso.rotation.x -= 0.12;
    head.position.y = rest.head.position.y - 0.17;
    head.position.z -= 0.12;
    head.rotation.x -= 0.18;
    leftArm.rotation.set(-1.05, 0, -0.5);
    if (leftElbow) leftElbow.rotation.set(-1.45, 0, 0);
    rightArm.rotation.set(-1.05, 0, 0.5);
    if (rightElbow) rightElbow.rotation.set(-1.45, 0, 0);

    if (leftLeg) {
      leftLeg.rotation.set(-0.2, 0, -0.2);
      if (leftKnee) leftKnee.rotation.x = 0.45;
    }
    if (rightLeg) {
      rightLeg.rotation.set(-0.2, 0, 0.2);
      if (rightKnee) rightKnee.rotation.x = 0.45;
    }

    ward.scale.setScalar(1 + Math.sin(t * 6) * 0.12);
    ward.rotation.y += t * 1.5;
    ward.rotation.x += t * 0.8;
    wardOpacity = 0.65;
  } else if (state === 'victory') {
    torso.position.y += 0.22 + Math.sin(t * 3) * 0.05;
    torso.rotation.x -= 0.12;
    head.position.y += 0.22;
    head.rotation.x += 0.2;

    // Right arm relic flourish high overhead
    rightArm.rotation.set(-2.7, 0, -0.25);
    if (rightElbow) rightElbow.rotation.set(-0.35, 0, 0);

    // Left arm raised in triumphant fist
    leftArm.rotation.set(-2.0, 0, 0.55);
    if (leftElbow) leftElbow.rotation.set(-1.25, 0, 0);

    // Relic rapid orbital flourish
    if (relic) {
      relic.rotation.y += t * 5.0;
      relic.rotation.z += t * 2.5;
    }

    if (leftLeg) {
      leftLeg.rotation.set(0, 0, -0.08);
      if (leftKnee) leftKnee.rotation.x = 0;
    }
    if (rightLeg) {
      rightLeg.rotation.set(0, 0, 0.08);
      if (rightKnee) rightKnee.rotation.x = 0;
    }
  } else if (state === 'stagger') {
    torso.position.y -= 0.14;
    torso.position.z -= 0.28;
    torso.rotation.x -= 0.26;
    torso.rotation.z += Math.sin(t * 14) * 0.05;

    head.position.y -= 0.16;
    head.position.z -= 0.26;
    head.rotation.x -= 0.34;

    // Defensive forearm recoil guard
    leftArm.rotation.set(-1.15, 0, 0.65);
    if (leftElbow) leftElbow.rotation.set(-1.45, 0, 0);
    rightArm.rotation.set(-0.95, 0, -0.55);
    if (rightElbow) rightElbow.rotation.set(-1.3, 0, 0);

    // Knee buckle
    if (leftLeg) {
      leftLeg.rotation.set(-0.32, 0, -0.1);
      if (leftKnee) leftKnee.rotation.x = 0.65;
    }
    if (rightLeg) {
      rightLeg.rotation.set(-0.2, 0, 0.1);
      if (rightKnee) rightKnee.rotation.x = 0.45;
    }
  }

  halo.rotation.z += t * 0.75;
  coreGem.rotation.y += t * (state === 'travel' ? 3.2 : 0.45);
  circlet.rotation.z += Math.sin(t) * 0.04;
  if (relic && state !== 'surge' && state !== 'victory') relic.rotation.y += Math.sin(t * 1.3) * 0.1;
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

  // Additive Gaze IK: Look at rival avatar's head without mutating cached rest transforms
  if (lookAtWorldPos && u.headGroup) {
    let gazeWeight = 1.0;
    if (state === 'stagger' || state === 'victory') {
      gazeWeight = 0.0;
    } else if (state === 'travel') {
      gazeWeight = 0.15;
    } else if (state === 'contest-attack') {
      gazeWeight = 0.8;
    } else if (state === 'surge') {
      gazeWeight = 0.7;
    } else if (state === 'contest-defend') {
      gazeWeight = 1.0;
    } else {
      gazeWeight = 1.0;
    }

    if (gazeWeight > 0.01) {
      const headWorldPos = new THREE.Vector3();
      u.headGroup.getWorldPosition(headWorldPos);
      const toTargetWorld = lookAtWorldPos.clone().sub(headWorldPos);

      // Convert world direction into avatar's local coordinate frame
      const avatarWorldQuat = new THREE.Quaternion();
      avatarGroup.getWorldQuaternion(avatarWorldQuat);
      const invAvatarQuat = avatarWorldQuat.clone().invert();
      const localToTarget = toTargetWorld.clone().applyQuaternion(invAvatarQuat);

      // In avatar space, Z+ is forward, X+ is right, Y+ is up
      const rawYaw = Math.atan2(localToTarget.x, localToTarget.z);
      const distXZ = Math.hypot(localToTarget.x, localToTarget.z);
      const rawPitch = -Math.atan2(localToTarget.y, Math.max(0.001, distXZ));

      // Clamp yaw to ±42° (0.73 rad) and pitch to ±20° (0.35 rad)
      const clampedYaw = THREE.MathUtils.clamp(rawYaw, -0.73, 0.73) * gazeWeight;
      const clampedPitch = THREE.MathUtils.clamp(rawPitch, -0.35, 0.35) * gazeWeight;

      const additiveEuler = new THREE.Euler(clampedPitch, clampedYaw, 0, 'YXZ');
      const additiveQuat = new THREE.Quaternion().setFromEuler(additiveEuler);

      u.headGroup.quaternion.multiply(additiveQuat);
    }
  }

  const material = u.wardShield.material as THREE.MeshBasicMaterial;
  material.opacity = THREE.MathUtils.lerp(material.opacity, wardOpacity, alpha);
  const orbiters = u.sealOrbiters as THREE.Group;
  const dominantElement: EsmsKey = (u.attackElementOverride as EsmsKey) ?? (u.dominantElement as EsmsKey) ?? 'spirit';
  const orbitSpeed = state === 'victory' ? 4.2 : state === 'surge' ? 3.5 : state === 'contest-attack' ? (dominantElement === 'substance' ? 5.2 : 2.4) : 0.9;
  orbiters.rotation.y = t * orbitSpeed;
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
    idle: ['idle', 'breathe'],
    surge: ['surge', 'cast', 'raise', 'channel'],
    travel: ['travel', 'walk', 'run'],
    'contest-attack': ['contestattack', 'attack', 'strike'],
    'contest-defend': ['contestdefend', 'defend', 'guard'],
    victory: ['victory', 'cheer', 'celebrate', 'win'],
    stagger: ['stagger', 'hit', 'damage', 'hurt', 'recoil'],
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
  if (!url) return;
  const loader = customModelLoader ?? defaultGLTFModelLoader;
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
    applyVesselShadowPolicy(wrapper);
    const factionHex = FACTION_HEX_COLORS[u.agentPayload?.faction ?? 0] ?? '#00daf3';
    wrapper.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        const mat = mesh.material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => {
            if (m instanceof THREE.MeshStandardMaterial) {
              attachFresnelRim(m, factionHex, 2.8, 0.65);
            }
          });
        } else if (mat instanceof THREE.MeshStandardMaterial) {
          attachFresnelRim(mat, factionHex, 2.8, 0.65);
        }
      }
    });
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
      if (u.rig) u.rig.visible = true;
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
  if (torsoMaterial.userData.fresnelRim) {
    torsoMaterial.userData.fresnelRim.color.copy(factionColor);
  }
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
    const silhouette = createVesselSilhouette(appearance, agent.key);
    u.headGroup.add(silhouette.head);
    silhouette.garment.traverse((child) => {
      if ((child as THREE.Mesh).isMesh && (child as THREE.Mesh).material instanceof THREE.MeshStandardMaterial) {
        attachFresnelRim((child as THREE.Mesh).material as THREE.MeshStandardMaterial, factionColor, 2.8, 0.6);
      }
    });
    u.torsoGroup.add(silhouette.garment);
    silhouette.relic.position.set(0, 0.05, 0.12);
    const parentSocket = u.rightHandSocket ?? u.rightArm;
    parentSocket.add(silhouette.relic);
    if (silhouette.offHand) {
      silhouette.offHand.position.set(0, 0.05, 0.12);
      const leftSocket = u.leftHandSocket ?? u.leftArm;
      leftSocket.add(silhouette.offHand);
    }
    u.silhouette = silhouette;
    u.relic = silhouette.relic;
    u.offHand = silhouette.offHand;
    u.appearance = appearance;
    u.appearanceSignature = appearanceSignature;
    const head = u.headGroup.getObjectByName('HeadMesh') as THREE.Mesh;
    (head.material as THREE.MeshStandardMaterial).color.set(appearance.paletteOverrides.skinOrMaterialToneHex);
    const proportions = appearance.headSilhouette.faceProportion;
    head.scale.set(proportions.jawWidth, proportions.cranialHeight, proportions.browDepth);
  }
  u.dominantElement = resolveDominantEsms(agent);
  if (u.browMesh) {
    (u.browMesh.material as THREE.MeshStandardMaterial).color.set(appearance.paletteOverrides.hairOrCrownHex);
  }
  if (u.leftEye && u.rightEye) {
    (u.leftEye.material as THREE.MeshStandardMaterial).color.copy(statColor);
    (u.leftEye.material as THREE.MeshStandardMaterial).emissive.copy(statColor);
    (u.rightEye.material as THREE.MeshStandardMaterial).color.copy(statColor);
    (u.rightEye.material as THREE.MeshStandardMaterial).emissive.copy(statColor);
  }
  captureRestTransforms(avatar);
  applyVesselShadowPolicy(avatar);
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
