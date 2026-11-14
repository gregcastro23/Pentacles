import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Combine rigid, opaque sibling details in an owned procedural attachment.
 * Keep joint/group boundaries and transparent sorting intact. Call only while
 * building a silhouette, before animation and external customization begin.
 */
export function mergeStaticVesselDetails(root: THREE.Group): void {
  const retired = new Set<THREE.BufferGeometry>();
  const visit = (parent: THREE.Object3D) => {
    for (const child of [...parent.children]) visit(child);
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const child of parent.children) {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh || (mesh as THREE.SkinnedMesh).isSkinnedMesh || mesh.children.length || !mesh.visible
        || Array.isArray(mesh.material) || mesh.material.transparent || mesh.material.blending !== THREE.NormalBlending
        || mesh.geometry.drawRange.start !== 0 || mesh.geometry.drawRange.count !== Infinity
        || Object.keys(mesh.geometry.morphAttributes).length) continue;
      const attributes = Object.entries(mesh.geometry.attributes).sort(([a], [b]) => a.localeCompare(b));
      if (attributes.some(([, attr]) => (attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute)) continue;
      mesh.updateMatrix();
      // A mirrored mesh needs its own front-face winding policy.
      if (mesh.matrix.determinant() <= 0) continue;
      const layout = attributes.map(([name, attr]) => `${name}:${attr.itemSize}:${attr.normalized}:${attr.array.constructor.name}`).join(',');
      const key = `${mesh.material.uuid}|${!!mesh.geometry.index}|${layout}|${mesh.castShadow}|${mesh.receiveShadow}|${mesh.renderOrder}|${mesh.layers.mask}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(mesh);
      buckets.set(key, bucket);
    }
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      // Each mesh's local transform is baked; its animated parent stays intact.
      const pieces = meshes.map(mesh => {
        mesh.updateMatrix();
        return mesh.geometry.clone().applyMatrix4(mesh.matrix);
      });
      const geometry = mergeGeometries(pieces, false);
      pieces.forEach(piece => piece.dispose());
      if (!geometry) continue;
      const first = meshes[0];
      const merged = new THREE.Mesh(geometry, first.material);
      merged.name = 'MergedVesselDetails';
      merged.userData.sourceNames = meshes.map(mesh => mesh.name);
      merged.castShadow = first.castShadow;
      merged.receiveShadow = first.receiveShadow;
      merged.renderOrder = first.renderOrder;
      merged.layers.mask = first.layers.mask;
      for (const mesh of meshes) { retired.add(mesh.geometry); mesh.removeFromParent(); }
      parent.add(merged);
    }
  };
  visit(root);
  // A geometry can also belong to a detail that could not be merged.
  root.traverse(node => retired.delete((node as THREE.Mesh).geometry));
  retired.forEach(geometry => geometry.dispose());
}
