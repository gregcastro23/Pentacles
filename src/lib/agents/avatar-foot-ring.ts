/**
 * ============================================================================
 * Pentacles — Under-Foot Procedural Resonance Ring Shader & Mesh Slice
 * ============================================================================
 *
 * Renders an alchemical procedural under-foot ring beneath avatars on the
 * Pentacle court.
 *
 * Features:
 *   1. 4 ESMS Quadrants: Color-coded segments for Spirit (Amber Gold),
 *      Essence (Celestial Cyan), Matter (Ruby Crimson), and Substance (Amethyst)
 *      whose arc fill reflects normalized ESMS token balances.
 *   2. Resonance Surge Progress Ring: Smooth 0–100 progress sweep.
 *   3. Active Resonance Surge Ignition: When `meter >= 70` (`uActive > 0.5`),
 *      ignites a pulsing procedural aura with dynamic ray displacement and
 *      plasma harmonics for inferno, tempest, or equilibrium.
 */

import type { RatedAgentPayload, EsmsBalances, ResonanceSurgeState } from './rating-contract';

export interface FootRingUniformValues {
  uTime: number;
  uMeter: number; // 0.0 .. 1.0
  uActive: number; // 0.0 or 1.0
  uSurgeType: number; // 0.0 = inferno, 1.0 = tempest, 2.0 = equilibrium
  uEsmsSpirit: number; // 0.0 .. 1.0
  uEsmsEssence: number; // 0.0 .. 1.0
  uEsmsMatter: number; // 0.0 .. 1.0
  uEsmsSubstance: number; // 0.0 .. 1.0
  uFactionColor: [number, number, number];
  uInnerRadius: number;
  uOuterRadius: number;
}

export const FOOT_RING_VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldPosition;

void main() {
  vUv = uv;
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

export const FOOT_RING_FRAGMENT_SHADER = /* glsl */ `
precision highp float;

uniform float uTime;
uniform float uMeter;          // 0.0 to 1.0
uniform float uActive;         // 0.0 or 1.0 (triggers at meter >= 70)
uniform float uSurgeType;      // 0.0 = inferno, 1.0 = tempest, 2.0 = equilibrium
uniform float uEsmsSpirit;     // 0.0 to 1.0
uniform float uEsmsEssence;    // 0.0 to 1.0
uniform float uEsmsMatter;     // 0.0 to 1.0
uniform float uEsmsSubstance;  // 0.0 to 1.0
uniform vec3  uFactionColor;
uniform float uInnerRadius;    // e.g. 0.58
uniform float uOuterRadius;    // e.g. 0.86

varying vec2 vUv;
varying vec3 vWorldPosition;

#define PI 3.141592653589793
#define TWO_PI 6.283185307179586

// Procedural pseudo-hash for flame noise
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// 2D simplex-style noise for surge flame rays
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  // Center coordinates [-1, 1]
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);

  // Early discard outside total bounding circle
  if (r > 1.05 || r < 0.38) {
    discard;
  }

  // Polar angle in [0, 2PI], zero at 12 o'clock (top)
  float angle = atan(p.x, p.y);
  if (angle < 0.0) angle += TWO_PI;

  vec4 finalColor = vec4(0.0);

  // -------------------------------------------------------------
  // 1. ESMS 4-Quadrant Outer Band [uInnerRadius .. uOuterRadius]
  // -------------------------------------------------------------
  float esmsBandMask = smoothstep(uInnerRadius - 0.015, uInnerRadius, r)
                     * smoothstep(uOuterRadius + 0.015, uOuterRadius, r);

  if (esmsBandMask > 0.001) {
    // Quadrants:
    // Q0 (0 .. PI/2): Spirit (Solar Amber Gold)
    // Q1 (PI/2 .. PI): Essence (Celestial Cyan)
    // Q2 (PI .. 3PI/2): Matter (Ruby Crimson)
    // Q3 (3PI/2 .. 2PI): Substance (Astral Amethyst)
    int qIndex = int(floor(angle / (PI * 0.5)));
    float qAngle = mod(angle, PI * 0.5) / (PI * 0.5); // [0 .. 1] inside quadrant

    // 2-degree slit between quadrants
    float slitAngle = 0.035; // rad
    float localAngle = mod(angle, PI * 0.5);
    float slitMask = smoothstep(0.0, slitAngle, localAngle) * smoothstep(PI * 0.5, PI * 0.5 - slitAngle, localAngle);

    vec3 baseColor;
    float fillLevel;

    if (qIndex == 0) {
      baseColor = vec3(1.0, 0.70, 0.12); // Spirit - Amber Gold
      fillLevel = uEsmsSpirit;
    } else if (qIndex == 1) {
      baseColor = vec3(0.0, 0.85, 0.95); // Essence - Cyan
      fillLevel = uEsmsEssence;
    } else if (qIndex == 2) {
      baseColor = vec3(0.96, 0.25, 0.35); // Matter - Crimson Ruby
      fillLevel = uEsmsMatter;
    } else {
      baseColor = vec3(0.68, 0.35, 0.98); // Substance - Amethyst
      fillLevel = uEsmsSubstance;
    }

    // Filled arc vs empty background track
    vec3 trackColor = baseColor * 0.22 + vec3(0.04, 0.05, 0.08);
    float fillMask = step(qAngle, fillLevel);
    vec3 arcColor = mix(trackColor, baseColor * (1.2 + 0.3 * sin(uTime * 2.0 + float(qIndex))), fillMask);

    // Subtle edge rim highlights
    float innerRim = smoothstep(uInnerRadius + 0.02, uInnerRadius, r);
    float outerRim = smoothstep(uOuterRadius - 0.02, uOuterRadius, r);
    arcColor += vec3(0.3) * (innerRim + outerRim);

    finalColor += vec4(arcColor * slitMask, esmsBandMask * slitMask);
  }

  // -------------------------------------------------------------
  // 2. Inner Resonance Surge Progress Ring [0.46 .. 0.54]
  // -------------------------------------------------------------
  float meterInner = 0.46;
  float meterOuter = 0.54;
  float meterMask = smoothstep(meterInner - 0.01, meterInner, r)
                  * smoothstep(meterOuter + 0.01, meterOuter, r);

  if (meterMask > 0.001) {
    float meterAngle = angle / TWO_PI; // 0..1
    float isFilled = step(meterAngle, uMeter);

    vec3 meterColor;
    if (uSurgeType < 0.5) {
      // Inferno: Solar gold to fiery orange
      meterColor = mix(vec3(1.0, 0.82, 0.2), vec3(1.0, 0.35, 0.05), meterAngle);
    } else if (uSurgeType < 1.5) {
      // Tempest: Electric cyan to violet plasma
      meterColor = mix(vec3(0.1, 0.9, 1.0), vec3(0.85, 0.2, 0.95), meterAngle);
    } else {
      // Equilibrium: Golden-iridescent harmonic
      vec3 irid1 = mix(vec3(1.0, 0.85, 0.3), vec3(0.1, 0.95, 0.85), sin(meterAngle * PI + uTime * 3.0) * 0.5 + 0.5);
      meterColor = mix(irid1, vec3(0.9, 0.4, 1.0), 0.35);
    }

    // Pulse when meter is nearing threshold (>= 70)
    if (uMeter >= 0.70) {
      float meterGlow = 0.8 + 0.4 * sin(uTime * 6.0);
      meterColor *= meterGlow;
    }

    vec3 trackBg = vec3(0.08, 0.10, 0.15);
    vec3 col = mix(trackBg, meterColor * 1.3, isFilled);
    finalColor += vec4(col, meterMask * 0.95);
  }

  // -------------------------------------------------------------
  // 3. Active Resonance Surge Procedural Aura Ignition (meter >= 70)
  // -------------------------------------------------------------
  if (uActive > 0.5) {
    // Pulsing aura radiates outside uOuterRadius [0.86 .. 1.05]
    float auraInner = uOuterRadius - 0.02;
    float pulseSpeed = (uSurgeType < 0.5) ? 5.0 : (uSurgeType < 1.5) ? 8.0 : 6.5;
    float pulse = 0.5 + 0.5 * sin(uTime * pulseSpeed);

    // Procedural flame / plasma ray oscillations
    float rayFreq = (uSurgeType < 0.5) ? 14.0 : (uSurgeType < 1.5) ? 22.0 : 18.0;
    float rayNoise = noise(vec2(angle * rayFreq, uTime * 2.5));
    float rayDisplacement = (rayNoise - 0.5) * 0.12 * (0.8 + 0.4 * pulse);

    float dynamicAuraEdge = 0.96 + rayDisplacement;
    float auraMask = smoothstep(auraInner, uOuterRadius + 0.02, r)
                   * smoothstep(dynamicAuraEdge + 0.04, dynamicAuraEdge - 0.02, r);

    if (auraMask > 0.001) {
      vec3 auraColor;
      if (uSurgeType < 0.5) {
        // Inferno: Molten solar flare + gold corona
        auraColor = mix(vec3(1.0, 0.45, 0.05), vec3(1.0, 0.95, 0.4), rayNoise);
        auraColor *= (1.4 + 0.6 * pulse);
      } else if (uSurgeType < 1.5) {
        // Tempest: Lightning corona + magenta / neon cyan
        auraColor = mix(vec3(0.0, 0.9, 1.0), vec3(1.0, 0.15, 0.85), rayNoise);
        auraColor *= (1.5 + 0.7 * pulse);
      } else {
        // Equilibrium: Prismatic iridescent golden-cyan auroral harmonic
        vec3 cGold = vec3(1.0, 0.85, 0.3);
        vec3 cCyan = vec3(0.0, 0.95, 0.9);
        vec3 cViolet = vec3(0.85, 0.3, 1.0);
        auraColor = mix(mix(cGold, cCyan, rayNoise), cViolet, 0.4 + 0.4 * sin(uTime * 4.0));
        auraColor *= (1.6 + 0.8 * pulse);
      }

      // Additive aura blend
      finalColor.rgb += auraColor * auraMask;
      finalColor.a = max(finalColor.a, auraMask * 0.85);
    }
  }

  // Core faction subtle floor glow
  float coreDisc = smoothstep(0.46, 0.38, r);
  if (coreDisc > 0.001) {
    vec3 factionDiscColor = uFactionColor * 0.25 * (0.7 + 0.3 * sin(uTime * 1.5));
    finalColor.rgb += factionDiscColor * coreDisc;
    finalColor.a = max(finalColor.a, coreDisc * 0.4);
  }

  gl_FragColor = finalColor;
}
`;

/** Faction canonical colors (0..9) matching PLANET_COLORS */
export const FACTION_HEX_COLORS: string[] = [
  '#ff9800', // 0: Sun
  '#e0e0e0', // 1: Moon
  '#00daf3', // 2: Mercury
  '#f6cf83', // 3: Venus
  '#f44336', // 4: Mars
  '#4caf50', // 5: Jupiter
  '#cd7f32', // 6: Saturn
  '#00e5ff', // 7: Uranus
  '#7986cb', // 8: Neptune
  '#9c27b0', // 9: Pluto
];

/**
 * Pure function: Convert hex color to normalized [r, g, b] in [0, 1] without Three.js dependency
 */
export function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const num = parseInt(clean, 16);
  if (Number.isNaN(num)) return [0, 0.85, 0.95];
  return [
    ((num >> 16) & 255) / 255,
    ((num >> 8) & 255) / 255,
    (num & 255) / 255,
  ];
}

/**
 * Convert surge type to numeric uniform (0.0 = inferno, 1.0 = tempest, 2.0 = equilibrium)
 */
export function surgeTypeToUniform(type: string): number {
  if (type === 'equilibrium') return 2.0;
  if (type === 'tempest') return 1.0;
  return 0.0;
}

/**
 * Pure function: derive exact foot ring shader uniform values from a RatedAgentPayload.
 * Completely deterministic and unit-testable without WebGL context.
 */
export function deriveFootRingUniforms(
  payload: RatedAgentPayload,
  timeSeconds = 0
): FootRingUniformValues {
  const uMeter = Math.max(0, Math.min(1.0, payload.surge.meter / 100));
  const uActive = payload.surge.active ? 1.0 : 0.0;
  const uSurgeType = surgeTypeToUniform(payload.surge.surgeType);

  // Exact planetary-agents ESMS gate scale (250.0 is Celestial tier gate)
  const ESMS_MAX = 250.0;
  const uEsmsSpirit = Math.max(0.08, Math.min(1.0, payload.esms.spirit / ESMS_MAX));
  const uEsmsEssence = Math.max(0.08, Math.min(1.0, payload.esms.essence / ESMS_MAX));
  const uEsmsMatter = Math.max(0.08, Math.min(1.0, payload.esms.matter / ESMS_MAX));
  const uEsmsSubstance = Math.max(0.08, Math.min(1.0, payload.esms.substance / ESMS_MAX));

  const hexColor = FACTION_HEX_COLORS[payload.faction] || '#00daf3';
  const uFactionColor = hexToRgb01(hexColor);

  return {
    uTime: timeSeconds,
    uMeter,
    uActive,
    uSurgeType,
    uEsmsSpirit,
    uEsmsEssence,
    uEsmsMatter,
    uEsmsSubstance,
    uFactionColor,
    uInnerRadius: 0.58,
    uOuterRadius: 0.86,
  };
}

/**
 * Create a procedural Three.js ShaderMaterial for the Foot Ring synchronously
 * when a THREE instance is supplied.
 */
export function createFootRingMaterialSync(threeInstance: any, payload: RatedAgentPayload): any {
  const initial = deriveFootRingUniforms(payload, 0);

  return new threeInstance.ShaderMaterial({
    vertexShader: FOOT_RING_VERTEX_SHADER,
    fragmentShader: FOOT_RING_FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: initial.uTime },
      uMeter: { value: initial.uMeter },
      uActive: { value: initial.uActive },
      uSurgeType: { value: initial.uSurgeType },
      uEsmsSpirit: { value: initial.uEsmsSpirit },
      uEsmsEssence: { value: initial.uEsmsEssence },
      uEsmsMatter: { value: initial.uEsmsMatter },
      uEsmsSubstance: { value: initial.uEsmsSubstance },
      uFactionColor: { value: new threeInstance.Vector3(...initial.uFactionColor) },
      uInnerRadius: { value: initial.uInnerRadius },
      uOuterRadius: { value: initial.uOuterRadius },
    },
    transparent: true,
    side: threeInstance.DoubleSide,
    depthWrite: false,
    blending: threeInstance.NormalBlending,
  });
}

/**
 * Create a procedural mesh for the avatar foot ring synchronously.
 */
export function createFootRingMeshSync(
  threeInstance: any,
  payload: RatedAgentPayload,
  options: { radius?: number } = {}
): any {
  const radius = options.radius ?? 2.2;
  const geometry = new threeInstance.PlaneGeometry(radius * 2, radius * 2);
  const material = createFootRingMaterialSync(threeInstance, payload);

  const mesh = new threeInstance.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2; // Flat on court ground
  mesh.position.y = 0.05; // Slightly above node floor to avoid z-fighting
  mesh.name = `foot_ring_${payload.key}`;
  mesh.userData = { agentPayload: payload };

  return mesh;
}

/**
 * Create a procedural Three.js ShaderMaterial for the Foot Ring asynchronously.
 */
export async function createFootRingMaterial(payload: RatedAgentPayload): Promise<any> {
  const THREE = await import('three');
  return createFootRingMaterialSync(THREE, payload);
}

/**
 * Create a procedural mesh for the avatar foot ring asynchronously.
 */
export async function createFootRingMesh(
  payload: RatedAgentPayload,
  options: { radius?: number } = {}
): Promise<any> {
  const THREE = await import('three');
  return createFootRingMeshSync(THREE, payload, options);
}

/**
 * Update dynamic uniforms of an active Foot Ring mesh per frame or on state sync.
 */
export function updateFootRing(
  mesh: any,
  payload: RatedAgentPayload,
  timeSeconds: number
): void {
  if (!mesh?.material?.uniforms) return;

  const uniforms = mesh.material.uniforms;
  const values = deriveFootRingUniforms(payload, timeSeconds);

  uniforms.uTime.value = values.uTime;
  uniforms.uMeter.value = values.uMeter;
  uniforms.uActive.value = values.uActive;
  uniforms.uSurgeType.value = values.uSurgeType;
  uniforms.uEsmsSpirit.value = values.uEsmsSpirit;
  uniforms.uEsmsEssence.value = values.uEsmsEssence;
  uniforms.uEsmsMatter.value = values.uEsmsMatter;
  uniforms.uEsmsSubstance.value = values.uEsmsSubstance;

  if (uniforms.uFactionColor?.value?.set) {
    uniforms.uFactionColor.value.set(...values.uFactionColor);
  }
  mesh.userData.agentPayload = payload;
}

/**
 * In-place update of ESMS token balances and Resonance Surge state without recreating
 * geometry or material. Used by SpacetimeDB table subscribers and live wallet feeds.
 */
export function updateFootRingEsmsAndSurge(
  mesh: any,
  esmsBalances: EsmsBalances,
  surgeState: ResonanceSurgeState
): void {
  if (!mesh?.material?.uniforms) return;

  const uniforms = mesh.material.uniforms;
  const ESMS_MAX = 250.0;

  uniforms.uMeter.value = Math.max(0, Math.min(1.0, surgeState.meter / 100));
  uniforms.uActive.value = surgeState.active ? 1.0 : 0.0;
  uniforms.uSurgeType.value = surgeTypeToUniform(surgeState.surgeType);

  uniforms.uEsmsSpirit.value = Math.max(0.08, Math.min(1.0, esmsBalances.spirit / ESMS_MAX));
  uniforms.uEsmsEssence.value = Math.max(0.08, Math.min(1.0, esmsBalances.essence / ESMS_MAX));
  uniforms.uEsmsMatter.value = Math.max(0.08, Math.min(1.0, esmsBalances.matter / ESMS_MAX));
  uniforms.uEsmsSubstance.value = Math.max(0.08, Math.min(1.0, esmsBalances.substance / ESMS_MAX));

  if (mesh.userData?.agentPayload) {
    mesh.userData.agentPayload.esms = { ...esmsBalances };
    mesh.userData.agentPayload.surge = { ...surgeState };
  }
}
