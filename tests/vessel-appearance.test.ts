import { describe, expect, it } from 'bun:test';
import { resolveAgentAppearance } from '../src/lib/agents/vessel-appearance-manifest';
import { HISTORICAL_AGENTS } from '../src/alchm-chart/historical-agents.js';
import * as THREE from 'three';
import { createVesselSilhouette } from '../src/lib/agents/vessel-silhouettes';

describe('Vessel historical appearance', () => {
  it('gives the four pilot vessels their recognizable period silhouettes and relics', () => {
    const pilots = [
      ['isaac-newton', 'enlightenment', 'newton-curls', 'enlightenment-coat', 'high-cravat', 'prism-octahedron'],
      ['leonardo-da-vinci', 'renaissance', 'da-vinci-beret-beard', 'renaissance-drape', 'renaissance-collar', 'vitruvian-gyroscope'],
      ['emily-dickinson', 'romantic', 'dickinson-parted-bun', 'victorian-shawl', 'lace-tippet', 'herbarium-quill-lantern'],
      ['user-avatar-neo', 'astral', 'sovereign-crest', 'alchemical-vestments', 'astral-gorget', 'solar-astrolabe'],
    ];
    for (const [key, era, crown, mantle, collar, relic] of pilots) {
      const appearance = resolveAgentAppearance(key);
      expect(appearance.era).toBe(era);
      expect(appearance.headSilhouette.crownStyle).toBe(crown);
      expect(appearance.garmentSilhouette).toEqual({ mantleStyle: mantle, collarStyle: collar });
      expect(appearance.signatureRelic).toBe(relic);
      expect(appearance.portraitSvgDataUri).toStartWith('data:image/svg+xml,');
    }
  });

  it('covers all 71 registry agents reproducibly and preserves their period dress family', () => {
    expect(HISTORICAL_AGENTS.length).toBe(71);
    for (const agent of HISTORICAL_AGENTS) {
      const first = resolveAgentAppearance(agent.key, agent.faction, agent.title);
      expect(resolveAgentAppearance(agent.key, agent.faction, agent.title)).toEqual(first);
      expect(first.portraitSvgDataUri).toStartWith('data:image/svg+xml,');
      expect(first.headSilhouette.faceProportion.cranialHeight).toBeGreaterThan(0.7);
    }
    expect(resolveAgentAppearance('plato').era).toBe('ancient');
    expect(resolveAgentAppearance('donatello').era).toBe('renaissance');
    expect(resolveAgentAppearance('benjamin-franklin').era).toBe('enlightenment');
    expect(resolveAgentAppearance('jane-austen').era).toBe('romantic');
    expect(resolveAgentAppearance('marie-curie-1867').era).toBe('modern');
    expect(resolveAgentAppearance('thomas-aquinas').headSilhouette.crownStyle).toBe('scholar-hood');
    expect(resolveAgentAppearance('new-user').era).toBe('astral');
  });

  it('provides visible, distinct head, shoulder and held relic attachments for every pilot', () => {
    const keys = ['isaac-newton', 'leonardo-da-vinci', 'emily-dickinson', 'user-avatar-neo'];
    const headBounds: string[] = [];
    for (const key of keys) {
      const profile = resolveAgentAppearance(key);
      const silhouette = createVesselSilhouette(profile);
      expect(silhouette.head.name).toBe(profile.headSilhouette.crownStyle);
      expect(silhouette.garment.name).toBe(profile.garmentSilhouette.mantleStyle);
      expect(silhouette.relic.name).toBe(profile.signatureRelic);
      expect(silhouette.relic.position.y).toBeCloseTo(-0.65);
      for (const part of Object.values(silhouette)) {
        const bounds = new THREE.Box3().setFromObject(part);
        expect(bounds.isEmpty()).toBe(false);
        expect(Number.isFinite(bounds.max.y)).toBe(true);
      }
      headBounds.push(new THREE.Box3().setFromObject(silhouette.head).getSize(new THREE.Vector3()).toArray().join(','));
    }
    expect(new Set(headBounds).size).toBe(4);
  });

  it('uses the fallback faction palette and isolates per-vessel customization', () => {
    const mercury = resolveAgentAppearance('custom-scholar', 2, 'Scholar');
    const mars = resolveAgentAppearance('custom-scholar', 4, 'Scholar');
    expect(mercury.paletteOverrides.secondaryTrimHex).toBe('#00daf3');
    expect(mars.paletteOverrides.secondaryTrimHex).toBe('#f44336');
    expect(mercury.paletteOverrides.primaryGarmentHex).not.toBe(mars.paletteOverrides.primaryGarmentHex);
    mercury.paletteOverrides.secondaryTrimHex = '#000000';
    mercury.headSilhouette.faceProportion.jawWidth = 5;
    expect(resolveAgentAppearance('custom-scholar', 2, 'Scholar').paletteOverrides.secondaryTrimHex).toBe('#00daf3');
    expect(resolveAgentAppearance('custom-scholar', 2, 'Scholar').headSilhouette.faceProportion.jawWidth).toBeLessThan(1.2);
  });
});
