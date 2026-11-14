import { describe, expect, it, spyOn } from 'bun:test';
import { BufferGeometry, Group } from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createSharedModelLoader, type VesselModelAsset } from '../src/lib/agents/vessel-model-loader';
import { OwnedDracoLoader } from '../src/lib/agents/vessel-draco-loader';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('Shared vessel model loading', () => {
  it('shares initialization, keeps overlapping loads alive, and disposes exactly once after the last settles', async () => {
    const first = deferred<VesselModelAsset>(), second = deferred<VesselModelAsset>();
    let created = 0, disposed = 0, requests = 0;
    const load = createSharedModelLoader(async () => {
      created++;
      return { load: () => ++requests === 1 ? first.promise : second.promise, dispose: () => { disposed++; } };
    });
    const a = load('/same.glb'), b = load('/same.glb');
    first.resolve({ scene: new Group() });
    const modelA = await a;
    expect(created).toBe(1);
    expect(disposed).toBe(0);
    second.resolve({ scene: new Group() });
    const modelB = await b;
    expect(modelA.scene).not.toBe(modelB.scene);
    expect(disposed).toBe(1);
    expect(requests).toBe(2);
  });

  it('releases failed loads without terminating their peers and can initialize again', async () => {
    const bad = deferred<VesselModelAsset>(), good = deferred<VesselModelAsset>();
    let disposed = 0, created = 0;
    const load = createSharedModelLoader(async () => {
      created++;
      return { load: url => url === 'bad' ? bad.promise : good.promise, dispose: () => { disposed++; } };
    });
    const failure = load('bad').catch(error => error.message), success = load('good');
    bad.reject(new Error('Missing model'));
    expect(await failure).toBe('Missing model');
    expect(disposed).toBe(0);
    good.resolve({ scene: new Group() });
    await success;
    await load('good');
    expect(created).toBe(2);
    expect(disposed).toBe(2);
  });

  it('retries failed initialization and waits for old workers to drain before creating a new pool', async () => {
    const released = deferred<void>();
    const closingStarted = deferred<void>();
    let created = 0;
    const load = createSharedModelLoader(async () => {
      if (++created === 1) throw new Error('Chunk unavailable');
      return { load: async () => ({ scene: new Group() }), dispose: () => {
        closingStarted.resolve(); return released.promise;
      } };
    });
    await expect(load('first')).rejects.toThrow('Chunk unavailable');
    const next = load('second');
    await closingStarted.promise;
    const waiting = load('third');
    await Promise.resolve();
    expect(created).toBe(2);
    released.resolve();
    await Promise.all([next, waiting]);
    expect(created).toBe(3);
  });
});

describe('Draco teardown', () => {
  it('waits for pending geometry, rejects new work after release, and tears down once', async () => {
    const decoded = deferred<BufferGeometry>();
    const decode = spyOn(DRACOLoader.prototype, 'decodeGeometry').mockImplementation(() => decoded.promise);
    const dispose = spyOn(DRACOLoader.prototype, 'dispose').mockImplementation(function () { return this; });
    try {
      const draco = new OwnedDracoLoader().setWorkerLimit(2);
      expect(draco.workerLimit).toBe(2);
      draco.preload();
      expect(draco.decoderPending).toBeNull();
      const task = draco.decodeGeometry(new ArrayBuffer(4), {});
      const released = draco.release();
      expect(draco.release()).toBe(released);
      await expect(draco.decodeGeometry(new ArrayBuffer(4), {})).rejects.toThrow('released');
      expect(dispose).not.toHaveBeenCalled();
      decoded.resolve(new BufferGeometry());
      (await task).dispose();
      await released;
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally { decode.mockRestore(); dispose.mockRestore(); }
  });

  it('also releases when decoding fails', async () => {
    const decode = spyOn(DRACOLoader.prototype, 'decodeGeometry').mockImplementation(() => Promise.reject(new Error('Bad geometry')));
    const dispose = spyOn(DRACOLoader.prototype, 'dispose').mockImplementation(function () { return this; });
    try {
      const draco = new OwnedDracoLoader();
      const task = draco.decodeGeometry(new ArrayBuffer(4), {});
      const released = draco.release();
      await expect(task).rejects.toThrow('Bad geometry');
      await released;
      expect(dispose).toHaveBeenCalledTimes(1);
    } finally { decode.mockRestore(); dispose.mockRestore(); }
  });
});
