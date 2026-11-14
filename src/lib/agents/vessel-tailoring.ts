import * as THREE from 'three';
import type { VesselMantleStyle } from './vessel-appearance-manifest';

/** A shaped, elliptical cloth surface: each section is [height, half-width, depth]. */
export function tailoredSurface(sections: ReadonlyArray<readonly [number, number, number]>,
  folds = 0, openFront = 0): THREE.BufferGeometry {
  const segments = 32, vertices: number[] = [], uv: number[] = [], indices: number[] = [];
  sections.forEach(([y, width, depth], row) => {
    for (let column = 0; column <= segments; column++) {
      const t = column / segments, angle = openFront / 2 + t * (Math.PI * 2 - openFront);
      const pleat = 1 + Math.cos(angle * 12) * folds * (1 - row / sections.length);
      vertices.push(Math.sin(angle) * width * pleat, y, Math.cos(angle) * depth * pleat);
      uv.push(t, row / (sections.length - 1));
      if (row && column < segments) {
        const a = (row - 1) * (segments + 1) + column, b = row * (segments + 1) + column;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.name = 'TailoredClothSurface';
  return geometry;
}

export const tailoredTorso = () => tailoredSurface([
  [-.43, .24, .15], [-.27, .25, .16], [-.08, .29, .18],
  [.13, .39, .22], [.28, .43, .19], [.39, .25, .15], [.43, .17, .13],
]);

export function tailoredGarment(style: VesselMantleStyle): THREE.BufferGeometry {
  if (style === 'plate-armor-cuirass') return tailoredSurface([
    [-.5,.3,.2],[-.35,.31,.23],[-.08,.35,.26],[.12,.43,.28],[.3,.45,.22],[.44,.21,.16],
  ]);
  if (style === 'victorian-shawl') return tailoredSurface([
    [-.23,.55,.27],[-.08,.56,.29],[.08,.46,.25],[.23,.3,.19],[.38,.17,.14],
  ], .035, .25);
  if (style === 'renaissance-drape' || style === 'scholar-robe' || style === 'saffron-monk-robe') return tailoredSurface([
    [-.7,.43,.26],[-.45,.34,.22],[-.22,.3,.19],[0,.38,.24],[.24,.46,.25],[.43,.19,.15],
  ], .08, style === 'renaissance-drape' ? .65 : .12);
  if (style === 'edwardian-high-dress' || style === 'tehuana-huipil-shawl') return tailoredSurface([
    [-.48,.34,.22],[-.25,.26,.18],[-.04,.3,.2],[.16,.4,.25],[.31,.43,.22],[.44,.18,.14],
  ], .025);
  return tailoredSurface([
    [-.55,.34,.22],[-.35,.29,.19],[-.15,.29,.18],[.08,.38,.23],[.27,.44,.22],[.42,.19,.14],
  ], style === 'knit-professor-sweater' ? .025 : .01,
  style === 'enlightenment-coat' || style === 'victorian-frock-coat' ? .65 : 0);
}

export const pleatedSkirt = () => tailoredSurface([
  [-.9,.48,.3],[-.7,.46,.29],[-.45,.39,.26],[-.22,.31,.21],[0,.27,.18],
], .11);
