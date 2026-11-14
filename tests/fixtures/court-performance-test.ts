import * as THREE from 'three';
import { PentacleArena3D } from '../../src/lib/agents/pentacle-arena-3d';
import { ArenaNavigation } from '../../src/lib/agents/arena-navigation';
import { FIXTURE_AGENTS } from '../../src/lib/agents/rating-contract';
import { COURT_PIXEL_BUDGET, courtPixelRatio } from '../../src/lib/agents/court-resolution';
import { defaultGLTFModelLoader } from '../../src/lib/agents/vessel-model-loader';

const stage = document.querySelector<HTMLElement>('#stage')!;
const status = document.querySelector<HTMLElement>('#status')!;
const results = document.querySelector<HTMLElement>('#results')!;
const run = document.querySelector<HTMLButtonElement>('#run')!;
const stop = document.querySelector<HTMLButtonElement>('#stop')!;
const loaderCheck = document.querySelector<HTMLButtonElement>('#loader')!;
const density = document.querySelector<HTMLSelectElement>('#density')!;
const comparison = document.querySelector<HTMLSelectElement>('#comparison')!;
let arena: PentacleArena3D | undefined;
let navigation: ArenaNavigation | undefined;
let controller: AbortController | undefined;
let shadowDraws = 0;

function clearArena() {
  navigation?.destroy();
  navigation = undefined;
  arena?.destroy();
  arena?.renderer.forceContextLoss?.();
  arena = undefined;
}

function populate(count: number, maxRenderPixels: number, mergeStaticDetails = true, shadows = true) {
  clearArena();
  arena = new PentacleArena3D({ container: stage, maxRenderPixels, mergeStaticDetails });
  if (!arena.webglAvailable) throw new Error('WebGL is unavailable; no rendering sample can be collected.');
  // An explicit fixture-only density lets a 1× desktop exercise the same pixel
  // budget used on high-density devices, without changing browser settings.
  arena.renderer.setDrawingBufferSize(stage.clientWidth, stage.clientHeight,
    courtPixelRatio(stage.clientWidth, stage.clientHeight, Number(density.value) || window.devicePixelRatio,
      maxRenderPixels, arena.renderer.capabilities.maxTextureSize));
  navigation = new ArenaNavigation(arena);
  for (let i = 0; i < count; i++) {
    const agent = structuredClone(FIXTURE_AGENTS[i % FIXTURE_AGENTS.length]);
    agent.key = `benchmark-${i}`;
    agent.handle = `Example vessel ${i + 1}`;
    // Replaced owners enter the existing spectator overflow layout. This tests
    // rendering load without depending on faction-specific challenger access.
    arena.placeAvatarOnZone(i % 11, agent, 'owner');
  }
  arena.renderer.shadowMap.enabled = shadows;
  arena.scene.traverse(object => {
    if ((object as THREE.Mesh).isMesh) object.onAfterShadow = () => { shadowDraws++; };
  });
  arena.update(0);
  arena.renderer.render(arena.scene, arena.camera);
}

function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
}

function sample(signal: AbortSignal): Promise<{ intervals: number[]; cpu: number[]; update: number[]; render: number[] }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Benchmark stopped.')); return; }
    let frame = 0, start = 0, last = 0;
    const intervals: number[] = [], cpu: number[] = [], update: number[] = [], render: number[] = [];
    const abort = () => { cancelAnimationFrame(frame); reject(new Error('Benchmark stopped; partial samples discarded.')); };
    signal.addEventListener('abort', abort, { once: true });
    const tick = (now: number) => {
      if (!start) start = last = now;
      const interval = now - last;
      last = now;
      try {
        shadowDraws = 0;
        const before = performance.now();
        arena!.update(Math.min(0.1, interval / 1000));
        navigation!.update();
        const updated = performance.now();
        arena!.renderer.render(arena!.scene, arena!.camera);
        const rendered = performance.now();
        if (now - start >= 1500) {
          intervals.push(interval); cpu.push(rendered - before);
          update.push(updated - before); render.push(rendered - updated);
        }
        if (now - start >= 4500) {
          signal.removeEventListener('abort', abort);
          resolve({ intervals, cpu, update, render });
        } else frame = requestAnimationFrame(tick);
      } catch (error) {
        signal.removeEventListener('abort', abort);
        reject(error);
      }
    };
    frame = requestAnimationFrame(tick);
  });
}

run.onclick = async () => {
  controller = new AbortController();
  run.disabled = loaderCheck.disabled = density.disabled = comparison.disabled = true;
  stop.disabled = false;
  results.replaceChildren();
  try {
    for (const count of [4, 12, 24]) {
      for (const optimized of [false, true]) {
        const details = comparison.value === 'details';
        const shadows = comparison.value === 'shadows';
        const budget = shadows || details || optimized ? COURT_PIXEL_BUDGET : Number.MAX_SAFE_INTEGER;
        const label = shadows ? optimized ? 'Shadows off (diagnostic)' : 'Shadows on'
          : details ? optimized ? 'Merged details' : 'Unmerged reference' : optimized ? '2 MP' : 'DPR-only reference';
        status.textContent = `Sampling ${count} vessels · ${label}…`;
        populate(count, budget, !details || optimized, !shadows || !optimized);
        const measured = await sample(controller.signal);
        const info = arena!.renderer.info;
        const canvas = arena!.renderer.domElement;
        const pair = (values: number[]) => `${percentile(values, .5).toFixed(1)} / ${percentile(values, .95).toFixed(1)} ms`;
        const row = document.createElement('tr');
        for (const value of [count, label, `${canvas.width} × ${canvas.height}`, pair(measured.intervals), pair(measured.cpu),
          pair(measured.update), pair(measured.render), `${info.render.calls} (${shadowDraws})`, info.render.triangles.toLocaleString(), `${info.memory.geometries} geometries / ${info.memory.textures} textures`]) {
          const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell);
        }
        results.append(row);
      }
    }
    status.textContent = 'Complete: six warm samples. Compare pixel count and frame timing separately; this is one browser/device, not a universal FPS guarantee.';
  } catch (error) { status.textContent = (error as Error).message; }
  finally { controller = undefined; run.disabled = loaderCheck.disabled = density.disabled = comparison.disabled = false; stop.disabled = true; }
};
stop.onclick = () => controller?.abort();
document.addEventListener('visibilitychange', () => { if (document.hidden) controller?.abort(); });
window.addEventListener('resize', () => {
  if (controller) controller.abort();
  arena?.resize(stage.clientWidth, stage.clientHeight);
  navigation?.resize();
  if (arena) arena.renderer.render(arena.scene, arena.camera);
});
window.addEventListener('pagehide', () => { controller?.abort(); clearArena(); });

loaderCheck.onclick = async () => {
  loaderCheck.disabled = run.disabled = true;
  const output = document.querySelector<HTMLElement>('#loader-status')!;
  const bytes = new Uint8Array(new Float32Array([0, 0, 0, 1, 0, 0, 0, 2, 0]).buffer);
  const gltf = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${btoa(String.fromCharCode(...bytes))}` }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: bytes.length }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 2, 0] }] };
  const url = `data:model/gltf+json,${encodeURIComponent(JSON.stringify(gltf))}`;
  const loaded: THREE.Group[] = [];
  try {
    const pair = await Promise.all([defaultGLTFModelLoader(url), defaultGLTFModelLoader(url)]);
    loaded.push(...pair.map(asset => asset.scene));
    if (pair[0].scene === pair[1].scene) throw new Error('Model scenes unexpectedly share ownership.');
    let failed = false;
    try { await defaultGLTFModelLoader('data:model/gltf+json,invalid'); } catch { failed = true; }
    if (!failed) throw new Error('Invalid GLTF should fail.');
    loaded.push((await defaultGLTFModelLoader(url)).scene);
    output.textContent = 'Passed: concurrent loads own separate scenes; malformed GLTF fails; the next load succeeds. No external model or CDN request.';
  } catch (error) { output.textContent = `Failed: ${(error as Error).message}`; }
  finally {
    for (const scene of loaded) scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose();
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) material.dispose();
    });
    loaderCheck.disabled = run.disabled = false;
  }
};

try { populate(4, COURT_PIXEL_BUDGET); status.textContent = 'Ready. Results remain on this page only.'; }
catch (error) { status.textContent = (error as Error).message; }
run.disabled = loaderCheck.disabled = false;
run.textContent = 'Run 4 / 12 / 24 comparison';
