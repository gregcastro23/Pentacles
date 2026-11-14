import * as THREE from 'three';

/**
 * Immutable procedural vessel geometry shared across avatars.
 *
 * Every vessel uses the same torso, limb, halo, ward and seal-shard shapes;
 * colors and proportions live on per-avatar materials and transforms. A lease
 * set per owner keeps the shared buffer alive while any vessel uses it. The
 * final release disposes it, freeing GPU buffers in every renderer that
 * uploaded it. Never mutate a leased geometry in place: clone it first.
 */
interface SharedEntry {
  geometry: THREE.BufferGeometry;
  leases: number;
}

const entries = new Map<string, SharedEntry>();
const sharedGeometries = new WeakSet<THREE.BufferGeometry>();

export function leaseVesselGeometry<T extends THREE.BufferGeometry>(
  owner: Set<string>,
  key: string,
  create: () => T,
): T {
  let entry = entries.get(key);
  if (!entry) {
    const geometry = create();
    geometry.name = `SharedVesselGeometry_${key}`;
    entry = { geometry, leases: 0 };
    entries.set(key, entry);
    sharedGeometries.add(geometry);
  }
  // One lease per owner, however many meshes in that owner reuse the shape.
  if (!owner.has(key)) {
    owner.add(key);
    entry.leases++;
  }
  return entry.geometry as T;
}

export function releaseVesselGeometries(owner: Set<string>): void {
  for (const key of owner) {
    const entry = entries.get(key);
    if (!entry) continue;
    entry.leases--;
    if (entry.leases <= 0) {
      entries.delete(key);
      sharedGeometries.delete(entry.geometry);
      entry.geometry.dispose();
    }
  }
  owner.clear();
}

/** Owned-hierarchy disposal must skip geometry that other vessels may still draw. */
export function isSharedVesselGeometry(geometry: THREE.BufferGeometry | undefined): boolean {
  return !!geometry && sharedGeometries.has(geometry);
}

/** Local diagnostics and tests: live shared shapes and total owner leases. */
export function sharedVesselGeometryStats(): { geometries: number; leases: number } {
  let leases = 0;
  for (const entry of entries.values()) leases += entry.leases;
  return { geometries: entries.size, leases };
}

