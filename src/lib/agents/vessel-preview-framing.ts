import * as THREE from 'three';

export type VesselPreviewView = 'figure' | 'detail';

/** Bounds in avatar coordinates, excluding aura/orbiters and their invisible picking shells. */
export function vesselFigureBounds(avatar: THREE.Group, view: VesselPreviewView): THREE.Box3 {
  const u = avatar.userData;
  const parts = u.externalModel ? [u.externalModel] : view === 'detail'
    ? [u.torsoGroup, u.headGroup] : [u.torsoGroup, u.headGroup, u.leftArm, u.rightArm, u.lowerBody];
  avatar.updateWorldMatrix(true, true);
  const inverse = avatar.matrixWorld.clone().invert(), transform = new THREE.Matrix4();
  const bounds = new THREE.Box3();
  for (const part of parts) part?.traverseVisible((node: THREE.Object3D) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;
    transform.multiplyMatrices(inverse, mesh.matrixWorld);
    bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(transform));
  });
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-.65, 0, -.5), new THREE.Vector3(.65, 2.7, .5));
  if (view === 'detail') bounds.min.y = Math.max(bounds.min.y, bounds.max.y - 1.15);
  else bounds.min.y = Math.min(0, bounds.min.y);
  return bounds;
}

/** Fit the figure through a full yaw rotation, including its held props, at any aspect ratio. */
export function frameVesselPreview(camera: THREE.PerspectiveCamera, bounds: THREE.Box3): void {
  const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(.1, camera.aspect));
  const radius = Math.hypot(Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x)),
    Math.max(Math.abs(bounds.min.z), Math.abs(bounds.max.z)));
  const halfHeight = (bounds.max.y - bounds.min.y) / 2;
  const distance = 1.12 * (Math.max(halfHeight / Math.tan(vertical), radius / Math.tan(horizontal)) + radius);
  const centerY = (bounds.max.y + bounds.min.y) / 2;
  camera.position.set(0, centerY + distance * .07, distance);
  camera.lookAt(0, centerY, 0);
  camera.near = .05; camera.far = Math.max(30, distance * 3);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld();
}
