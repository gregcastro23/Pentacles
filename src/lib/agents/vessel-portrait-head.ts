import * as THREE from 'three';
import { HISTORICAL_PORTRAITS } from './historical-portraits';
import { PORTRAIT_FACE_TRIANGLES, PORTRAIT_FACE_OVAL } from './portrait-face-topology';

export interface PortraitFaceData {
  version: number;
  sourceSha256: string;
  positions: number[];
  colors: number[];
  skin: number[];
  irises: number[];
}
type FaceLoader = (key: string) => Promise<PortraitFaceData>;
const faces = new Map<string, Promise<PortraitFaceData>>();

export function validatePortraitFace(value: unknown): PortraitFaceData {
  const data = value as PortraitFaceData;
  const array = (values: unknown, size: number, min: number, max: number) => Array.isArray(values)
    && values.length === size && values.every(v => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max);
  if (!data || data.version !== 1 || !/^[a-f0-9]{64}$/.test(data.sourceSha256)
    || !array(data.positions, 468 * 3, -1, 1) || !array(data.colors, 468 * 3, 0, 255)
    || !array(data.skin, 3, 0, 255) || !array(data.irises, 30, -1, 1)) throw new Error('Invalid portrait face asset');
  return data;
}

const loadFace: FaceLoader = key => {
  if (!Object.hasOwn(HISTORICAL_PORTRAITS, key)) return Promise.reject(new Error('Unknown historical identity'));
  let pending = faces.get(key);
  if (!pending) {
    pending = fetch(`/avatars/faces/${key}.json`).then(response => {
      if (!response.ok) throw new Error('Face asset unavailable');
      return response.json();
    }).then(validatePortraitFace).catch(error => { faces.delete(key); throw error; });
    faces.set(key, pending);
  }
  return pending;
};

const skinColor = (rgb: number[]) => new THREE.Color().setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, THREE.SRGBColorSpace);

/** One gentle, angle-limited normal pass; retain the measured silhouette and nose/lip creases. */
function softenFaceNormals(geometry: THREE.BufferGeometry) {
  const normals = geometry.getAttribute('normal');
  const original = normals.array.slice();
  const neighbors = Array.from({ length: normals.count }, () => new Set<number>());
  const indices = geometry.index!;
  for (let i = 0; i < indices.count; i += 3) {
    const triangle = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
    for (const a of triangle) for (const b of triangle) if (a !== b) neighbors[a].add(b);
  }
  const normal = new THREE.Vector3(), other = new THREE.Vector3(), sum = new THREE.Vector3();
  neighbors.forEach((adjacent, i) => {
    normal.fromArray(original, i * 3); sum.copy(normal);
    adjacent.forEach(j => {
      other.fromArray(original, j * 3);
      if (normal.dot(other) > .7) sum.addScaledVector(other, .18);
    });
    sum.normalize(); normals.setXYZ(i, sum.x, sum.y, sum.z);
  });
}

/** A lit, volumetric face and closed skull. No portrait plane, frame, UVs or image texture. */
export function createPortraitFace(data: PortraitFaceData): THREE.Group {
  validatePortraitFace(data);
  const group = new THREE.Group(); group.name = 'PortraitDerivedHead';
  const vertices = [...data.positions], indices = [...PORTRAIT_FACE_TRIANGLES];
  const colors: number[] = [];
  for (let i = 0; i < data.colors.length; i += 3) colors.push(...skinColor(data.colors.slice(i, i + 3)).toArray());
  const skin = skinColor(data.skin);
  // The estimated front surface joins three skull rings and a rear pole.
  let previous = [...PORTRAIT_FACE_OVAL];
  for (const [scale, depth] of [[1.04, -.08], [.86, -.22], [.42, -.30]]) {
    const ring: number[] = [];
    for (const index of PORTRAIT_FACE_OVAL) {
      ring.push(vertices.length / 3);
      vertices.push(data.positions[index * 3] * scale, data.positions[index * 3 + 1] * scale, depth);
      colors.push(...skin.toArray());
    }
    for (let i = 0; i < ring.length; i++) {
      const next = (i + 1) % ring.length;
      indices.push(previous[i], previous[next], ring[i], previous[next], ring[next], ring[i]);
    }
    previous = ring;
  }
  const pole = vertices.length / 3; vertices.push(0, 0, -.33); colors.push(...skin.toArray());
  previous.forEach((index, i) => indices.push(index, previous[(i + 1) % previous.length], pole));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); softenFaceNormals(geometry);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .64, metalness: 0, envMapIntensity: .7, side: THREE.DoubleSide });
  const face = new THREE.Mesh(geometry, material); face.name = 'SculptedFaceMesh'; group.add(face);
  const point = (index: number) => new THREE.Vector3().fromArray(data.positions, index * 3);
  const eyes = new THREE.Group(); eyes.name = 'PortraitFaceEyes';
  eyes.position.y = (point(33).y + point(263).y) / 2;
  group.add(eyes);
  const white = new THREE.MeshStandardMaterial({ color: '#e7dfcf', roughness: .24, envMapIntensity: .8 });
  // Clearcoat provides a corneal reflection on the existing eye meshes: no extra
  // transparent shell, transmission buffer, texture or render pass.
  const corneal = { roughness: .3, metalness: 0, clearcoat: 1, clearcoatRoughness: .08, ior: 1.38, envMapIntensity: .9 };
  const iris = new THREE.MeshPhysicalMaterial({ ...corneal, color: '#514535' });
  const pupil = new THREE.MeshPhysicalMaterial({ ...corneal, color: '#121317' });
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  for (const [outer, inner, irisOffset] of [[33, 133, 0], [263, 362, 15]]) {
    const a = point(outer), b = point(inner), center = a.clone().add(b).multiplyScalar(.5);
    const eye = new THREE.Mesh(sphere, white);
    eye.position.copy(center); eye.position.y -= eyes.position.y; eye.position.z -= .003;
    eye.scale.set(a.distanceTo(b) * .53, .019, .018); eyes.add(eye);
    const irisCenter = new THREE.Vector3().fromArray(data.irises, irisOffset);
    const irisRadius = new THREE.Vector3().fromArray(data.irises, irisOffset + 3)
      .distanceTo(new THREE.Vector3().fromArray(data.irises, irisOffset + 9)) / 2;
    const colored = new THREE.Mesh(sphere, iris);
    colored.position.copy(center); colored.position.y -= eyes.position.y;
    colored.position.z = Math.max(center.z, irisCenter.z) + .014;
    colored.scale.set(irisRadius, Math.min(.017, irisRadius), .006); eyes.add(colored);
    const dark = new THREE.Mesh(sphere, pupil); dark.position.copy(colored.position); dark.position.z += .005;
    dark.scale.set(irisRadius * .45, Math.min(.009, irisRadius * .45), .003); eyes.add(dark);
  }
  const mouth = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({ color: skin.clone().multiplyScalar(.34), roughness: .9 }));
  mouth.position.copy(point(13).add(point(14)).multiplyScalar(.5)); mouth.position.z -= .005;
  mouth.scale.set(point(61).distanceTo(point(291)) / 2, .012, .012); group.add(mouth);
  const earMaterial = new THREE.MeshStandardMaterial({ color: skin, roughness: .85 });
  for (const index of [234, 454]) {
    const ear = new THREE.Mesh(sphere, earMaterial); ear.position.copy(point(index));
    ear.position.x += Math.sign(ear.position.x) * .02; ear.position.y -= .015; ear.position.z -= .025;
    ear.scale.set(.035, .065, .035); group.add(ear);
  }
  group.userData.eyes = eyes;
  group.traverse(node => { if ((node as THREE.Mesh).isMesh) node.castShadow = node.receiveShadow = true; });
  return group;
}

function disposeFace(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  group.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => materials.add(material));
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose());
}

/** Progressively replace the geometric fallback with an offline portrait-derived face. */
export function attachPortraitHead(avatar: THREE.Group, key: string, load: FaceLoader = loadFace) {
  const head = avatar.userData.headGroup as THREE.Group;
  const hidden = ['HeadMesh', 'FacialFeatures', 'CircletMesh'].map(name => head.getObjectByName(name)).filter(Boolean)
    .map(node => ({ node: node!, visible: node!.visible }));
  const oldEyes = avatar.userData.eyesGroup;
  let hair: THREE.Group | undefined, hairPosition: THREE.Vector3 | undefined;
  let faceData: PortraitFaceData | undefined;
  const fitted = new Map<THREE.Object3D, THREE.Vector3>();
  const hiddenAccents = new Map<THREE.Object3D, boolean>();
  const restoreHair = () => {
    if (hair && hairPosition) hair.position.copy(hairPosition);
    fitted.forEach((position, detail) => detail.position.copy(position)); fitted.clear();
    hiddenAccents.forEach((visible, detail) => { detail.visible = visible; }); hiddenAccents.clear();
  };
  let disposed = false, group: THREE.Group | undefined;
  const sync = () => {
    if (!group || disposed) return;
    const nextHair = avatar.userData.silhouette?.head as THREE.Group | undefined;
    if (nextHair === hair) return;
    restoreHair();
    hair = nextHair; hairPosition = hair?.position.clone();
    // Existing authored hair/headgear sits behind the measured forehead/eyes.
    if (hair && faceData) {
      hair.position.z -= .18;
      const point = (index: number) => new THREE.Vector3().fromArray(faceData!.positions, index * 3);
      hair.traverse(detail => {
        // Seeded fantasy accents (including random beards) must not override the
        // portrait likeness. Character-specific authored facial hair remains.
        if (detail.userData.portraitFallbackOnly) {
          hiddenAccents.set(detail, detail.visible); detail.visible = false;
        }
        const fit = detail.userData.portraitFaceFit;
        if (!fit) return;
        const target = fit.kind === 'beard' ? point(17).add(new THREE.Vector3(0, -.02, .06))
          : fit.kind === 'mustache' ? point(2).add(point(0)).multiplyScalar(.5).add(new THREE.Vector3(0, 0, .025))
          : fit.kind === 'brow' ? point(105).add(point(334)).multiplyScalar(.5).add(new THREE.Vector3(0, 0, .025))
          : new THREE.Vector3(0, (point(33).y + point(263).y) / 2, point(6).z + .045);
        fitted.set(detail, detail.position.clone());
        detail.position.add(target.sub(new THREE.Vector3().fromArray(fit.anchor)));
        detail.position.z += .18;
      });
    }
  };
  const ready = Promise.resolve().then(() => load(key)).then(data => {
    if (disposed || avatar.userData.disposed) return;
    group = createPortraitFace(data);
    faceData = data;
    hidden.forEach(({ node }) => { node.visible = false; });
    sync();
    avatar.userData.eyesGroup = group.userData.eyes;
    head.add(group);
  }).catch(() => { /* The original sculpted rig remains usable if a face asset cannot load. */ });
  return {
    ready,
    sync,
    dispose() {
      if (disposed) return; disposed = true;
      if (group) { group.removeFromParent(); disposeFace(group); }
      hidden.forEach(({ node, visible }) => { node.visible = visible; });
      restoreHair();
      avatar.userData.eyesGroup = oldEyes;
    },
  };
}
