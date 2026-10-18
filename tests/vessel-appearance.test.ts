import { describe, expect, it } from 'bun:test';
import { resolveAgentAppearance } from '../src/lib/agents/vessel-appearance-manifest';
import { HISTORICAL_AGENTS } from '../src/alchm-chart/historical-agents.js';
import * as THREE from 'three';
import { createVesselSilhouette } from '../src/lib/agents/vessel-silhouettes';

describe('Vessel historical appearance', () => {
  it('gives the pilot vessels their recognizable period silhouettes and relics', () => {
    const pilots = [
      ['isaac-newton', 'enlightenment', 'newton-curls', 'enlightenment-coat', 'high-cravat', 'prism-octahedron'],
      ['leonardo-da-vinci', 'renaissance', 'da-vinci-beret-beard', 'renaissance-drape', 'renaissance-collar', 'vitruvian-gyroscope'],
      ['emily-dickinson', 'romantic', 'dickinson-parted-bun', 'victorian-shawl', 'lace-tippet', 'herbarium-quill-lantern'],
      ['user-avatar-neo', 'astral', 'sovereign-crest', 'alchemical-vestments', 'astral-gorget', 'solar-astrolabe'],
      ['nikola-tesla-1856', 'modern', 'tesla-parted-mustache', 'victorian-frock-coat', 'wing-collar', 'tesla-induction-coil'],
      ['marie-curie-1867', 'modern', 'curie-edwardian-updo', 'edwardian-high-dress', 'lace-tippet', 'radium-phial-luminary'],
      ['albert-einstein', 'modern', 'einstein-wild-halo', 'knit-professor-sweater', 'wing-collar', 'relativity-geodesic-ring'],
      ['frida-kahlo', 'modern', 'kahlo-floral-braid', 'tehuana-huipil-shawl', 'none', 'retablo-sacred-heart'],
      ['william-shakespeare', 'renaissance', 'shakespeare-ruff-ringlets', 'elizabethan-doublet', 'elizabethan-ruff', 'quill-and-first-folio'],
      ['charles-darwin-1809', 'romantic', 'darwin-naturalist-beard', 'enlightenment-coat', 'high-cravat', 'beagle-naturalist-specimen'],
      ['cleopatra', 'ancient', 'cleopatra-nemes-uraeus', 'scholar-robe', 'astral-gorget', 'solar-astrolabe'],
      ['joan-of-arc', 'renaissance', 'joan-battle-bob', 'plate-armor-cuirass', 'plate-gorget', 'saintly-oriflamme-banner'],
      ['siddhartha-gautama-buddha', 'ancient', 'buddha-ushnisha-topknot', 'saffron-monk-robe', 'none', 'solar-astrolabe'],
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
    const keys = [
      'isaac-newton',
      'leonardo-da-vinci',
      'emily-dickinson',
      'user-avatar-neo',
      'nikola-tesla-1856',
      'marie-curie-1867',
      'albert-einstein',
      'frida-kahlo',
      'william-shakespeare',
      'charles-darwin-1809',
      'cleopatra',
      'joan-of-arc',
      'siddhartha-gautama-buddha',
    ];
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
    expect(new Set(headBounds).size).toBe(keys.length);
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

  it('renders cameo SVG portraits and era/relic subtitles in VesselCardHUD header', () => {
    const { VesselCardHUD } = require('../src/lib/agents/player-card-hud');
    const { FIXTURE_AGENTS } = require('../src/lib/agents/rating-contract');
    const hud = new VesselCardHUD();
    const pilots = [
      { key: 'isaac-newton', era: 'Enlightenment', relic: 'Prism Octahedron' },
      { key: 'leonardo-da-vinci', era: 'Renaissance', relic: 'Vitruvian Gyroscope' },
      { key: 'emily-dickinson', era: 'Romantic', relic: 'Herbarium Lantern' },
      { key: 'user-avatar-neo', era: 'Astral', relic: 'Solar Astrolabe' },
    ];
    for (const pilot of pilots) {
      const payload = FIXTURE_AGENTS.find((a: any) => a.key === pilot.key)!;
      hud.show(payload);
      const html = (hud as any).container.innerHTML;
      expect(html).toContain('pk-vessel-portrait');
      expect(html).toContain('data:image/svg+xml,');
      expect(html).toContain(`${pilot.era} · ${pilot.relic}`);
    }
    hud.destroy();
  });
});
