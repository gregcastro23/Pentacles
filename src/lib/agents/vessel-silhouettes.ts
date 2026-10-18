import * as THREE from 'three';
import type { VesselAppearanceProfile } from './vessel-appearance-manifest';

export interface VesselSilhouette {
  head: THREE.Group;
  garment: THREE.Group;
  relic: THREE.Group;
}

/** Build readable period outlines around the existing head, torso and hand pivots. */
export function createVesselSilhouette(profile: VesselAppearanceProfile): VesselSilhouette {
  const palette = profile.paletteOverrides;
  const cloth = new THREE.MeshStandardMaterial({ color: palette.primaryGarmentHex, roughness: 0.8, metalness: 0.1, side: THREE.DoubleSide });
  const trim = new THREE.MeshStandardMaterial({ color: palette.secondaryTrimHex, roughness: 0.35, metalness: 0.7, emissive: palette.secondaryTrimHex, emissiveIntensity: 0.14 });
  const hair = new THREE.MeshStandardMaterial({ color: palette.hairOrCrownHex, roughness: 0.85, metalness: 0.08 });
  const linen = new THREE.MeshStandardMaterial({ color: '#fff4df', roughness: 0.9 });
  const glow = new THREE.MeshBasicMaterial({ color: palette.secondaryTrimHex, transparent: true, opacity: 0.8 });

  const head = new THREE.Group();
  head.name = profile.headSilhouette.crownStyle;
  head.userData.crownStyle = profile.headSilhouette.crownStyle;
  const garment = new THREE.Group();
  garment.name = profile.garmentSilhouette.mantleStyle;
  garment.userData.mantleStyle = profile.garmentSilhouette.mantleStyle;
  garment.userData.collarStyle = profile.garmentSilhouette.collarStyle;
  const relic = new THREE.Group();
  relic.name = profile.signatureRelic;
  relic.userData.signatureRelic = profile.signatureRelic;
  relic.position.set(0, -0.65, 0.15);

  function mesh(parent: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
    const result = new THREE.Mesh(geometry, material);
    result.name = name;
    result.position.set(x, y, z);
    parent.add(result);
    return result;
  }

  function band(parent: THREE.Group, name: string, radius: number, tube: number, y: number, material: THREE.Material): THREE.Mesh {
    const result = mesh(parent, name, new THREE.TorusGeometry(radius, tube, 5, 20), material, 0, y);
    result.rotation.x = Math.PI / 2;
    return result;
  }

  switch (profile.headSilhouette.crownStyle) {
    case 'newton-curls': {
      const back = mesh(head, 'WigBack', new THREE.SphereGeometry(0.29, 8, 6), hair, 0, -0.06, -0.12);
      back.scale.set(1.15, 1.4, 0.8);
      for (const side of [-1, 1]) {
        for (let curl = 0; curl < 5; curl++) {
          const puff = mesh(head, 'BaroqueCurl', new THREE.SphereGeometry(0.105, 6, 5), hair, side * (0.27 + (curl % 2) * 0.02), 0.22 - curl * 0.135, 0.015);
          puff.scale.set(0.95, 1.14, 1);
        }
      }
      break;
    }
    case 'da-vinci-beret-beard': {
      const cap = mesh(head, 'VelvetBeret', new THREE.SphereGeometry(0.41, 10, 5), cloth, 0.035, 0.24, -0.015);
      cap.scale.set(1.08, 0.32, 0.95);
      cap.rotation.z = -0.12;
      band(head, 'BeretBand', 0.3, 0.035, 0.19, trim);
      const beard = mesh(head, 'PolymathBeard', new THREE.ConeGeometry(0.255, 0.68, 7), hair, 0, -0.35, 0.105);
      beard.rotation.z = Math.PI;
      beard.scale.z = 0.67;
      for (const side of [-1, 1]) mesh(head, 'LongSideHair', new THREE.SphereGeometry(0.14, 6, 5), hair, side * 0.245, -0.12, -0.03).scale.y = 1.8;
      break;
    }
    case 'dickinson-parted-bun': {
      for (const side of [-1, 1]) {
        const part = mesh(head, 'CenterPartHair', new THREE.SphereGeometry(0.18, 8, 5), hair, side * 0.135, 0.15, -0.03);
        part.scale.set(0.92, 0.7, 1.3);
        part.rotation.z = side * 0.32;
      }
      mesh(head, 'ChignonBun', new THREE.SphereGeometry(0.19, 8, 6), hair, 0, -0.03, -0.3).scale.set(1.05, 0.9, 0.9);
      const pin = mesh(head, 'BunPin', new THREE.CylinderGeometry(0.015, 0.015, 0.46, 5), trim, 0, -0.02, -0.31);
      pin.rotation.z = Math.PI / 2;
      break;
    }
    case 'sovereign-crest': {
      band(head, 'CrestBand', 0.3, 0.05, 0.14, trim);
      for (const x of [-0.24, 0, 0.24]) {
        const spike = mesh(head, 'SovereignRay', new THREE.ConeGeometry(0.09, x === 0 ? 0.5 : 0.32, 4), trim, x, x === 0 ? 0.39 : 0.3);
        spike.rotation.z = -x * 1.4;
      }
      mesh(head, 'CrestJewel', new THREE.OctahedronGeometry(0.09), glow, 0, 0.19, 0.29);
      break;
    }
    case 'laurel-wreath': {
      band(head, 'LaurelVine', 0.3, 0.025, 0.11, hair);
      for (let i = 0; i < 10; i++) {
        const angle = 0.45 + i * (Math.PI * 2 - 0.9) / 9;
        const leaf = mesh(head, 'LaurelLeaf', new THREE.SphereGeometry(0.075, 5, 4), trim, Math.sin(angle) * 0.3, 0.15, Math.cos(angle) * 0.3);
        leaf.scale.set(0.55, 0.4, 1.6);
        leaf.rotation.y = angle + 0.5;
      }
      break;
    }
    case 'scholar-hood': {
      const hood = mesh(head, 'ScholarCowl', new THREE.SphereGeometry(0.35, 9, 6, 0.55, Math.PI * 2 - 1.1), cloth, 0, 0, -0.045);
      hood.rotation.y = Math.PI / 2;
      hood.scale.set(1.1, 1.22, 1);
      band(head, 'HoodSeam', 0.31, 0.025, -0.23, trim);
      break;
    }
    case 'astral-helm': {
      const helm = mesh(head, 'FacetedHelm', new THREE.SphereGeometry(0.32, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 0.1, -0.015);
      helm.scale.y = 0.85;
      for (const side of [-1, 1]) mesh(head, 'HelmCheek', new THREE.BoxGeometry(0.065, 0.26, 0.26), trim, side * 0.275, -0.03, -0.04);
      mesh(head, 'HelmStar', new THREE.OctahedronGeometry(0.08), glow, 0, 0.19, 0.27);
      break;
    }
  }

  switch (profile.garmentSilhouette.mantleStyle) {
    case 'enlightenment-coat': {
      mesh(garment, 'CoatBody', new THREE.CylinderGeometry(0.37, 0.32, 0.84, 8, 1, true, Math.PI / 3, Math.PI * 4 / 3), cloth);
      for (const side of [-1, 1]) {
        const tail = mesh(garment, 'CoatTail', new THREE.BoxGeometry(0.29, 0.62, 0.15), cloth, side * 0.2, -0.52, -0.13);
        tail.rotation.z = side * 0.14;
        const lapel = mesh(garment, 'CoatLapel', new THREE.BoxGeometry(0.09, 0.55, 0.04), trim, side * 0.15, 0.13, 0.3);
        lapel.rotation.z = side * -0.25;
      }
      break;
    }
    case 'renaissance-drape': {
      const drape = mesh(garment, 'TuscanDrape', new THREE.CylinderGeometry(0.48, 0.63, 1.12, 8, 1, true, 0.45, Math.PI * 1.7), cloth, 0, -0.16, -0.1);
      drape.rotation.z = 0.12;
      const sash = mesh(garment, 'DiagonalSash', new THREE.BoxGeometry(0.13, 0.94, 0.075), trim, 0, 0.05, 0.33);
      sash.rotation.z = -0.68;
      break;
    }
    case 'victorian-shawl': {
      mesh(garment, 'PearlShawl', new THREE.CylinderGeometry(0.24, 0.68, 0.5, 10, 1, true), cloth, 0, 0.13);
      mesh(garment, 'VictorianSkirt', new THREE.CylinderGeometry(0.32, 0.48, 0.82, 9), cloth, 0, -0.47, -0.04);
      band(garment, 'ShawlEdge', 0.67, 0.023, -0.12, trim);
      mesh(garment, 'ShawlClasp', new THREE.OctahedronGeometry(0.07), trim, 0, 0.17, 0.37);
      break;
    }
    case 'alchemical-vestments': {
      mesh(garment, 'AstralTabard', new THREE.CylinderGeometry(0.39, 0.49, 1.05, 6, 1, true), cloth, 0, -0.15);
      for (const side of [-1, 1]) {
        const shoulder = mesh(garment, 'CrestShoulder', new THREE.OctahedronGeometry(0.22), trim, side * 0.43, 0.25);
        shoulder.scale.set(1.15, 0.6, 1);
        mesh(garment, 'TabardTrim', new THREE.BoxGeometry(0.035, 0.95, 0.045), trim, side * 0.19, -0.16, 0.39);
      }
      break;
    }
    case 'scholar-robe': {
      mesh(garment, 'ScholarRobe', new THREE.CylinderGeometry(0.38, 0.57, 1.22, 8, 1, true), cloth, 0, -0.2);
      for (const side of [-1, 1]) mesh(garment, 'RobeStole', new THREE.BoxGeometry(0.11, 1.08, 0.045), trim, side * 0.19, -0.12, 0.35);
      break;
    }
  }

  const collar = new THREE.Group();
  collar.name = profile.garmentSilhouette.collarStyle;
  collar.userData.collarStyle = profile.garmentSilhouette.collarStyle;
  garment.add(collar);
  switch (profile.garmentSilhouette.collarStyle) {
    case 'high-cravat':
      band(collar, 'CravatNeck', 0.19, 0.07, 0.44, linen);
      mesh(collar, 'CravatFall', new THREE.ConeGeometry(0.13, 0.32, 4), linen, 0, 0.26, 0.29).rotation.z = Math.PI;
      break;
    case 'renaissance-collar':
      band(collar, 'RenaissanceCollar', 0.26, 0.075, 0.4, linen);
      break;
    case 'lace-tippet':
      band(collar, 'HighLaceCollar', 0.18, 0.075, 0.45, linen);
      for (const side of [-1, 1]) {
        const tip = mesh(collar, 'LaceTippet', new THREE.ConeGeometry(0.2, 0.4, 3), linen, side * 0.2, 0.23, 0.3);
        tip.rotation.z = Math.PI + side * 0.4;
        tip.scale.z = 0.3;
      }
      break;
    case 'astral-gorget':
      band(collar, 'AstralGorget', 0.27, 0.065, 0.4, trim);
      break;
    case 'none': break;
  }

  switch (profile.signatureRelic) {
    case 'prism-octahedron': {
      const glass = new THREE.MeshPhysicalMaterial({ color: '#b4edff', transmission: 0.65, transparent: true, opacity: 0.8, roughness: 0.05, metalness: 0.05, thickness: 0.3, emissive: '#8acfe8', emissiveIntensity: 0.3 });
      mesh(relic, 'RefractivePrism', new THREE.OctahedronGeometry(0.25), glass);
      for (const [i, color] of ['#ff6b79', '#f7d369', '#69daf7'].entries()) {
        const ray = mesh(relic, 'SplitLightRay', new THREE.CylinderGeometry(0.012, 0.012, 0.42, 4), new THREE.MeshBasicMaterial({ color }), 0.33, (i - 1) * 0.095);
        ray.rotation.z = -Math.PI / 2 + (i - 1) * 0.3;
      }
      break;
    }
    case 'vitruvian-gyroscope': {
      for (let axis = 0; axis < 3; axis++) {
        const ring = mesh(relic, 'VitruvianRing', new THREE.TorusGeometry(0.25 - axis * 0.025, 0.018, 5, 20), trim);
        ring.rotation.set(axis === 1 ? Math.PI / 2 : 0, axis === 2 ? Math.PI / 2 : 0, Math.PI / 5);
      }
      mesh(relic, 'GyroscopePolyhedron', new THREE.IcosahedronGeometry(0.1), glow);
      break;
    }
    case 'herbarium-quill-lantern': {
      mesh(relic, 'BotanicalScroll', new THREE.CylinderGeometry(0.07, 0.07, 0.42, 6), linen, -0.13, 0, 0);
      mesh(relic, 'LanternFrame', new THREE.CylinderGeometry(0.17, 0.15, 0.34, 6, 1, true), trim, 0.12, -0.06);
      mesh(relic, 'LanternLight', new THREE.OctahedronGeometry(0.13), glow, 0.12, -0.06);
      band(relic, 'LanternRoof', 0.16, 0.025, 0.12, trim).position.x = 0.12;
      const stem = mesh(relic, 'HerbariumQuill', new THREE.CylinderGeometry(0.012, 0.012, 0.58, 4), trim, -0.12, 0.13, 0.08);
      stem.rotation.z = -0.27;
      for (const side of [-1, 1]) {
        const leaf = mesh(relic, 'BotanicalLeaf', new THREE.SphereGeometry(0.09, 5, 4), new THREE.MeshStandardMaterial({ color: '#90c99a', emissive: '#508f64', emissiveIntensity: 0.3 }), -0.1 + side * 0.05, 0.24, 0.08);
        leaf.scale.set(0.5, 1.4, 0.3);
        leaf.rotation.z = side * 0.55;
      }
      break;
    }
    case 'solar-astrolabe': {
      mesh(relic, 'AstrolabeRim', new THREE.TorusGeometry(0.27, 0.025, 5, 24), trim);
      const inner = mesh(relic, 'AstrolabeEcliptic', new THREE.TorusGeometry(0.19, 0.018, 5, 20), trim);
      inner.rotation.y = Math.PI / 3;
      mesh(relic, 'AstrolabeSun', new THREE.OctahedronGeometry(0.085), glow);
      for (let axis = 0; axis < 2; axis++) {
        const pointer = mesh(relic, 'AstrolabePointer', new THREE.CylinderGeometry(0.012, 0.012, 0.51, 4), trim);
        pointer.rotation.z = axis * Math.PI / 2;
      }
      break;
    }
  }
  return { head, garment, relic };
}
