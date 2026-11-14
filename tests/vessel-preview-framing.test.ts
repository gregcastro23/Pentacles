import { describe, expect, it } from 'bun:test';
import * as THREE from 'three';
import { frameVesselPreview, vesselFigureBounds } from '../src/lib/agents/vessel-preview-framing';
import { createVesselAvatarMesh, disposeVesselAvatar } from '../src/lib/agents/vessel-avatar-3d';
import { resolveAgentAppearance } from '../src/lib/agents/vessel-appearance-manifest';
import { HISTORICAL_AGENTS } from '../src/alchm-chart/historical-agents.js';
import { FIXTURE_AGENTS } from '../src/lib/agents/rating-contract';
import { attachPortraitHead } from '../src/lib/agents/vessel-portrait-head';
import { readFileSync } from 'node:fs';

describe('Full-detail model inspection framing', () => {
  it('keeps all 71 portrait-derived heads, figures and held props within narrow and wide viewports through a full turn', async () => {
    for (const agent of HISTORICAL_AGENTS) {
      const payload = structuredClone(FIXTURE_AGENTS[0]);
      payload.key = agent.key; payload.appearance = resolveAgentAppearance(agent.key, agent.faction, agent.title);
      const avatar = createVesselAvatarMesh(payload, { loadPortraitFace: false });
      avatar.userData.portraitHead = attachPortraitHead(avatar, agent.key,
        async () => JSON.parse(readFileSync(new URL(`../public/avatars/faces/${agent.key}.json`, import.meta.url), 'utf8')));
      await avatar.userData.portraitHead.ready;
      try {
        const bounds = vesselFigureBounds(avatar, 'figure');
        for (const aspect of [.6, 1, 1.8]) {
          const camera = new THREE.PerspectiveCamera(36, aspect, .1, 30);
          frameVesselPreview(camera, bounds);
          let maxScreen = 0;
          for (let step = 0; step < 8; step++) {
            const turn = new THREE.Matrix4().makeRotationY(step * Math.PI / 4);
            for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
              const projected = new THREE.Vector3(x, y, z).applyMatrix4(turn).project(camera);
              maxScreen = Math.max(maxScreen, Math.abs(projected.x), Math.abs(projected.y), Math.abs(projected.z));
            }
          }
          expect(maxScreen).toBeLessThan(1);
        }
      } finally { disposeVesselAvatar(avatar); }
    }
  });

  it('frames face and attire more closely without including remote aura or hidden geometry', () => {
    const avatar = createVesselAvatarMesh(structuredClone(FIXTURE_AGENTS[0]));
    try {
      const full = vesselFigureBounds(avatar, 'figure');
      const detail = vesselFigureBounds(avatar, 'detail');
      expect(detail.max.y).toBeCloseTo(full.max.y);
      expect(detail.min.y).toBeGreaterThan(full.min.y + .5);
      const camera = new THREE.PerspectiveCamera(36, 1, .1, 30);
      frameVesselPreview(camera, full); const fullDistance = camera.position.z;
      frameVesselPreview(camera, detail); expect(camera.position.z).toBeLessThan(fullDistance);
      const unused = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100)); unused.visible = false;
      avatar.userData.headGroup.add(unused);
      avatar.userData.astralHalo.position.set(100, 100, 100);
      expect(vesselFigureBounds(avatar, 'figure').equals(full)).toBe(true);
    } finally { disposeVesselAvatar(avatar); }
  });

  it('measures local geometry independently of board scale, position and turn', () => {
    const avatar = createVesselAvatarMesh(structuredClone(FIXTURE_AGENTS[1]));
    try {
      const before = vesselFigureBounds(avatar, 'figure');
      avatar.position.set(50, -200, 70); avatar.rotation.set(.4, .8, .2); avatar.scale.setScalar(27);
      const after = vesselFigureBounds(avatar, 'figure');
      expect(after.min.distanceTo(before.min)).toBeLessThan(1e-6);
      expect(after.max.distanceTo(before.max)).toBeLessThan(1e-6);
    } finally { disposeVesselAvatar(avatar); }
  });
});
