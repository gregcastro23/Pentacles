import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { BufferGeometry } from 'three';

/** Decoder lifetime includes primitives still pending after a parser error. */
export class OwnedDracoLoader extends DRACOLoader {
  private pending = new Set<Promise<BufferGeometry>>();
  private closing?: Promise<void>;

  // Avoid speculative initialization before any geometry is requested.
  preload() { return this; }

  decodeGeometry(...args: Parameters<DRACOLoader['decodeGeometry']>): Promise<BufferGeometry> {
    if (this.closing) return Promise.reject(new Error('Model decoder has been released.'));
    const task = Promise.resolve().then(() => super.decodeGeometry(...args));
    this.pending.add(task);
    void task.then(() => this.pending.delete(task), () => this.pending.delete(task));
    return task;
  }

  release(): Promise<void> {
    // A parser may reject before another primitive finishes decoding. Let
    // those tasks settle before terminating their workers or revoking URLs.
    return this.closing ??= Promise.allSettled([...this.pending]).then(() => { this.dispose(); });
  }
}
