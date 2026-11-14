import * as THREE from 'three';

/** Shared portrait lighting: directional shape, cool separation and a restrained warm bounce. */
export function createVesselStudioLights(): THREE.Group {
  const lights = new THREE.Group();
  lights.add(new THREE.HemisphereLight(0xe6eeff, 0x35415a, 1.15));
  for (const [color, intensity, position] of [
    [0xffeddb, 3.1, [-3, 5, 4]],
    [0xa9d5ff, 1.6, [3, 3, -2]],
    [0xffb99b, .45, [-3, 1, -2]],
  ] as const) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(...position); lights.add(light);
  }
  return lights;
}

/** Local softboxes reflected by metal/crystal; baked once, with no shadow passes or downloads. */
export function createVesselStudioEnvironment(renderer: THREE.WebGLRenderer): THREE.WebGLRenderTarget | undefined {
  const studio = new THREE.Scene();
  studio.background = new THREE.Color(0x536174);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const materials: THREE.MeshBasicMaterial[] = [];
  const panel = (color: number, position: [number, number, number], size: [number, number]) => {
    const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }); materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position); mesh.scale.set(size[0], size[1], 1); mesh.lookAt(0, 0, 0); studio.add(mesh);
  };
  panel(0xffebd1, [-3, 3, 4], [4, 5]);
  panel(0xb7d9ff, [4, 1, 1], [2, 5]);
  panel(0xffffff, [0, 5, -2], [3, 3]);
  const generator = new THREE.PMREMGenerator(renderer);
  try { return generator.fromScene(studio, .04, .1, 20, { size: 64 }); }
  catch { return undefined; } // Direct lighting remains available on constrained contexts.
  finally { generator.dispose(); geometry.dispose(); materials.forEach(material => material.dispose()); }
}
