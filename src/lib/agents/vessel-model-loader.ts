import type { AnimationClip, Group } from 'three';

export interface VesselModelAsset {
  scene: Group;
  animations?: AnimationClip[];
}
/** Return a scene owned by this avatar, even when loading the same URL twice. */
export type GLTFModelLoader = (url: string) => Promise<VesselModelAsset>;

interface ModelBackend {
  load: GLTFModelLoader;
  dispose(): void | Promise<void>;
}

/** Overlapping loads share initialization and workers, never decoded scenes. */
export function createSharedModelLoader(createBackend: () => Promise<ModelBackend>): GLTFModelLoader {
  let batch: { ready: Promise<ModelBackend>; active: number } | undefined;
  let closing: Promise<void> | undefined;
  return async url => {
    // Avoid starting a second worker pool while failed-parser tasks drain.
    while (closing) await closing;
    const current = batch ??= { ready: Promise.resolve().then(createBackend), active: 0 };
    current.active++;
    let backend: ModelBackend | undefined;
    try {
      backend = await current.ready;
      return await backend.load(url);
    } finally {
      if (--current.active === 0) {
        batch = undefined; // A later load gets a fresh, usable decoder.
        const released = closing = Promise.resolve().then(() => backend?.dispose());
        try { await released; }
        finally { if (closing === released) closing = undefined; }
      }
    }
  };
}

export const defaultGLTFModelLoader = createSharedModelLoader(async () => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  let draco: import('./vessel-draco-loader').OwnedDracoLoader | undefined;
  // Use Three's bundled decoder URLs: Vite emits version-matched static assets.
  // No CDN request or decoder preload is needed for uncompressed models.
  try {
    const { OwnedDracoLoader } = await import('./vessel-draco-loader');
    draco = new OwnedDracoLoader().setWorkerLimit(2);
    loader.setDRACOLoader(draco);
  } catch {
    // Plain GLTF remains available if the optional decoder chunk cannot load.
    // Draco assets fail through the avatar's existing procedural fallback.
  }
  return {
    load: async url => {
      const gltf = await loader.loadAsync(url);
      return { scene: gltf.scene, animations: gltf.animations };
    },
    dispose: () => draco?.release(),
  };
});
