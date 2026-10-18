import { describe, it, expect } from 'bun:test';
import {
  deriveFootRingUniforms,
  updateFootRingEsmsAndSurge,
  surgeTypeToUniform,
  FOOT_RING_VERTEX_SHADER,
  FOOT_RING_FRAGMENT_SHADER,
} from '../src/lib/agents/avatar-foot-ring';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';
import { getOvrTierClass, getSealTierClass } from '../src/lib/agents/player-card-hud';

describe('Under-Foot Resonance Ring Shader & HUD Helpers', () => {
  describe('Shader Uniform Derivation & Surge Harmonics', () => {
    it('normalizes surge meter from [0, 100] to [0.0, 1.0]', () => {
      const newton = FIXTURE_AGENTS[0]; // meter: 58, inferno, inactive
      const uniformsNewton = deriveFootRingUniforms(newton, 0);
      expect(uniformsNewton.uMeter).toBeCloseTo(0.58, 2);
      expect(uniformsNewton.uActive).toBe(0.0);
      expect(uniformsNewton.uSurgeType).toBe(0.0); // inferno

      const emily = FIXTURE_AGENTS[1]; // meter: 86, tempest, active
      const uniformsEmily = deriveFootRingUniforms(emily, 10.5);
      expect(uniformsEmily.uMeter).toBeCloseTo(0.86, 2);
      expect(uniformsEmily.uActive).toBe(1.0);
      expect(uniformsEmily.uSurgeType).toBe(1.0); // tempest
      expect(uniformsEmily.uTime).toBe(10.5);
    });

    it('supports equilibrium surge type as uniform 2.0', () => {
      expect(surgeTypeToUniform('inferno')).toBe(0.0);
      expect(surgeTypeToUniform('tempest')).toBe(1.0);
      expect(surgeTypeToUniform('equilibrium')).toBe(2.0);

      const leo = FIXTURE_AGENTS[2]; // equilibrium active
      const uniformsLeo = deriveFootRingUniforms(leo, 5.0);
      expect(uniformsLeo.uSurgeType).toBe(2.0);
      expect(uniformsLeo.uActive).toBe(1.0);
    });

    it('normalizes 4 ESMS balances on Celestial gate scale', () => {
      const newton = FIXTURE_AGENTS[0];
      const u = deriveFootRingUniforms(newton, 0);
      expect(u.uEsmsSpirit).toBeCloseTo(180.5 / 250.0, 2);
      expect(u.uEsmsEssence).toBe(1.0); // capped at 1.0 (265.0 > 250.0)
      expect(u.uEsmsMatter).toBe(1.0);
      expect(u.uEsmsSubstance).toBe(1.0);
    });

    it('maps faction colors accurately to normalized RGB floats', () => {
      const neo = FIXTURE_AGENTS[3]; // Faction 0: Sun (#ff9800)
      const u = deriveFootRingUniforms(neo, 0);
      expect(u.uFactionColor[0]).toBeGreaterThan(0.9);
      expect(u.uFactionColor[1]).toBeGreaterThan(0.5);
    });

    it('ensures GLSL shader sources contain required uniform bindings and techniques', () => {
      expect(FOOT_RING_VERTEX_SHADER).toContain('varying vec2 vUv');
      expect(FOOT_RING_FRAGMENT_SHADER).toContain('uniform float uMeter');
      expect(FOOT_RING_FRAGMENT_SHADER).toContain('uniform float uActive');
      expect(FOOT_RING_FRAGMENT_SHADER).toContain('uniform float uSurgeType');
      expect(FOOT_RING_FRAGMENT_SHADER).toContain('uniform float uEsmsSpirit');
      expect(FOOT_RING_FRAGMENT_SHADER).toContain('uActive > 0.5'); // aura ignition gate
    });

    it('updates uniforms in-place via updateFootRingEsmsAndSurge without geometry recreation', () => {
      const mockMesh: any = {
        material: {
          uniforms: {
            uMeter: { value: 0 },
            uActive: { value: 0 },
            uSurgeType: { value: 0 },
            uEsmsSpirit: { value: 0 },
            uEsmsEssence: { value: 0 },
            uEsmsMatter: { value: 0 },
            uEsmsSubstance: { value: 0 },
          },
        },
        userData: { agentPayload: { esms: {}, surge: {} } },
      };

      const newBalances = { spirit: 50.0, essence: 100.0, matter: 150.0, substance: 250.0 };
      const newSurge = {
        meter: 92,
        active: true,
        surgeType: 'equilibrium' as const,
        monica: 1.618,
        monicaState: 'equilibrium' as const,
        heat: 0.9,
        reactivity: 0.9,
        statBoosts: { wisdom: 16 },
      };

      updateFootRingEsmsAndSurge(mockMesh, newBalances, newSurge);

      expect(mockMesh.material.uniforms.uMeter.value).toBeCloseTo(0.92, 2);
      expect(mockMesh.material.uniforms.uActive.value).toBe(1.0);
      expect(mockMesh.material.uniforms.uSurgeType.value).toBe(2.0);
      expect(mockMesh.material.uniforms.uEsmsSpirit.value).toBeCloseTo(50.0 / 250.0, 2);
      expect(mockMesh.material.uniforms.uEsmsSubstance.value).toBe(1.0);
    });
  });

  describe('Vessel Card HUD Tier Resolution', () => {
    it('resolves OVR tier classes correctly without sports trademarks', () => {
      expect(getOvrTierClass(98)).toBe('tier-celestial');
      expect(getOvrTierClass(96)).toBe('tier-celestial');
      expect(getOvrTierClass(94)).toBe('tier-astral');
      expect(getOvrTierClass(91)).toBe('tier-astral');
      expect(getOvrTierClass(88)).toBe('tier-gold');
      expect(getOvrTierClass(82)).toBe('tier-silver');
      expect(getOvrTierClass(75)).toBe('tier-copper');
    });

    it('resolves Seal tier classes correctly with Copper and Astral', () => {
      expect(getSealTierClass('Celestial')).toBe('tier-celestial');
      expect(getSealTierClass('Astral')).toBe('tier-astral');
      expect(getSealTierClass('Gold')).toBe('tier-gold');
      expect(getSealTierClass('Silver')).toBe('tier-silver');
      expect(getSealTierClass('Copper')).toBe('tier-copper');
    });
  });
});
