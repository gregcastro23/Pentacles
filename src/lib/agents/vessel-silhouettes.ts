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
  const copper = new THREE.MeshStandardMaterial({ color: '#c87d55', roughness: 0.25, metalness: 0.85, emissive: '#6e3820', emissiveIntensity: 0.2 });
  const electricCyan = new THREE.MeshBasicMaterial({ color: '#00e5ff', transparent: true, opacity: 0.9 });
  const electricViolet = new THREE.MeshBasicMaterial({ color: '#c055ff', transparent: true, opacity: 0.9 });
  const radiumGlow = new THREE.MeshBasicMaterial({ color: '#4bf0a5', transparent: true, opacity: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.3, metalness: 0.85, emissive: '#d97706', emissiveIntensity: 0.25 });
  const steel = new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.3, metalness: 0.9, emissive: '#334155', emissiveIntensity: 0.1 });
  const heartRed = new THREE.MeshStandardMaterial({ color: '#e11d48', roughness: 0.4, metalness: 0.4, emissive: '#9f1239', emissiveIntensity: 0.3 });

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
        const angle = 0.45 + (i * (Math.PI * 2 - 0.9)) / 9;
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
    case 'tesla-parted-mustache': {
      const cap = mesh(head, 'TeslaHair', new THREE.SphereGeometry(0.28, 8, 5), hair, 0, 0.08, -0.02);
      cap.scale.set(0.96, 0.75, 1.15);
      const part = mesh(head, 'PartLine', new THREE.BoxGeometry(0.02, 0.24, 0.45), trim, -0.06, 0.16, -0.01);
      part.rotation.z = 0.18;
      const mustache = mesh(head, 'TeslaMustache', new THREE.BoxGeometry(0.22, 0.05, 0.06), hair, 0, -0.25, 0.3);
      mustache.rotation.z = 0;
      break;
    }
    case 'einstein-wild-halo': {
      for (const [x, y, z, r] of [
        [-0.26, 0.16, -0.05, 0.16],
        [0.26, 0.16, -0.05, 0.16],
        [0, 0.26, -0.08, 0.2],
        [-0.2, 0.28, 0, 0.15],
        [0.2, 0.28, 0, 0.15],
        [-0.3, -0.02, 0.02, 0.14],
        [0.3, -0.02, 0.02, 0.14],
        [0, 0.12, -0.2, 0.18],
      ]) {
        mesh(head, 'EinsteinHairPuff', new THREE.SphereGeometry(r, 6, 5), hair, x, y, z);
      }
      mesh(head, 'EinsteinBrow', new THREE.BoxGeometry(0.34, 0.04, 0.08), hair, 0, -0.08, 0.28);
      break;
    }
    case 'curie-edwardian-updo': {
      const updo = mesh(head, 'EdwardianUpdo', new THREE.SphereGeometry(0.23, 8, 6), hair, 0, 0.25, -0.08);
      updo.scale.set(1.15, 0.9, 1.05);
      const sweep = mesh(head, 'FrontPompadour', new THREE.SphereGeometry(0.27, 8, 5), hair, 0, 0.14, 0.08);
      sweep.scale.set(1.0, 0.65, 1.2);
      const pin = mesh(head, 'HairPin', new THREE.CylinderGeometry(0.01, 0.01, 0.42, 5), trim, 0.05, 0.28, -0.06);
      pin.rotation.z = Math.PI / 4;
      break;
    }
    case 'kahlo-floral-braid': {
      band(head, 'CrownBraid', 0.28, 0.045, 0.18, hair);
      const flowerColors = ['#e11d48', '#f59e0b', '#ec4899', '#f97316', '#e11d48'];
      for (let i = 0; i < 5; i++) {
        const fx = -0.2 + i * 0.1;
        const flowerMat = new THREE.MeshStandardMaterial({ color: flowerColors[i], roughness: 0.5 });
        mesh(head, 'FridaFlower', new THREE.SphereGeometry(0.065, 5, 4), flowerMat, fx, 0.24 - Math.abs(fx) * 0.08, 0.2);
      }
      mesh(head, 'FridaUnibrow', new THREE.BoxGeometry(0.3, 0.035, 0.05), hair, 0, -0.07, 0.3);
      break;
    }
    case 'shakespeare-ruff-ringlets': {
      const pate = mesh(head, 'NobleForehead', new THREE.SphereGeometry(0.24, 8, 5), linen, 0, 0.12, 0.05);
      pate.scale.set(1.0, 0.8, 1.1);
      mesh(head, 'SideCurlL', new THREE.SphereGeometry(0.12, 6, 5), hair, -0.26, 0.02, -0.02).scale.y = 1.6;
      mesh(head, 'SideCurlR', new THREE.SphereGeometry(0.12, 6, 5), hair, 0.26, 0.02, -0.02).scale.y = 1.6;
      mesh(head, 'VanDykeGoatee', new THREE.ConeGeometry(0.08, 0.24, 5), hair, 0, -0.34, 0.22).rotation.z = Math.PI;
      break;
    }
    case 'darwin-naturalist-beard': {
      mesh(head, 'NaturalistBrow', new THREE.BoxGeometry(0.36, 0.06, 0.1), hair, 0, -0.06, 0.28);
      const beard = mesh(head, 'DarwinBeard', new THREE.ConeGeometry(0.3, 0.82, 8), hair, 0, -0.4, 0.14);
      beard.rotation.z = Math.PI;
      beard.scale.z = 0.75;
      for (const side of [-1, 1]) mesh(head, 'Sideburn', new THREE.BoxGeometry(0.08, 0.36, 0.1), hair, side * 0.26, -0.14, 0.06);
      break;
    }
    case 'cleopatra-nemes-uraeus': {
      const nemesTop = mesh(head, 'NemesCap', new THREE.SphereGeometry(0.35, 8, 6), cloth, 0, 0.12, -0.04);
      nemesTop.scale.set(1.1, 0.8, 1.15);
      for (const side of [-1, 1]) {
        const flap = mesh(head, 'NemesFlap', new THREE.BoxGeometry(0.11, 0.72, 0.14), cloth, side * 0.31, -0.24, 0.04);
        flap.rotation.z = side * 0.08;
        mesh(flap, 'FlapBand', new THREE.BoxGeometry(0.12, 0.09, 0.15), trim, 0, -0.24, 0);
      }
      const uraeus = mesh(head, 'GoldenUraeus', new THREE.CylinderGeometry(0.02, 0.03, 0.2, 5), gold, 0, 0.24, 0.31);
      uraeus.rotation.x = -0.35;
      break;
    }
    case 'joan-battle-bob': {
      const coif = mesh(head, 'ChainmailCoif', new THREE.SphereGeometry(0.32, 8, 6), steel, 0, 0.06, -0.02);
      coif.scale.set(1.05, 1.15, 1.05);
      band(head, 'CoifBrow', 0.3, 0.025, 0.08, gold);
      for (const side of [-1, 1]) mesh(head, 'BobHair', new THREE.BoxGeometry(0.09, 0.4, 0.18), hair, side * 0.25, -0.16, 0.02);
      break;
    }
    case 'buddha-ushnisha-topknot': {
      mesh(head, 'Ushnisha', new THREE.SphereGeometry(0.15, 8, 6), hair, 0, 0.33, 0);
      mesh(head, 'UrnaJewel', new THREE.OctahedronGeometry(0.04), gold, 0, 0.02, 0.3);
      mesh(head, 'HairCap', new THREE.SphereGeometry(0.3, 10, 6), hair, 0, 0.08, 0).scale.set(1.02, 0.88, 1.04);
      break;
    }
  }

  switch (profile.garmentSilhouette.mantleStyle) {
    case 'enlightenment-coat': {
      mesh(garment, 'CoatBody', new THREE.CylinderGeometry(0.37, 0.32, 0.84, 8, 1, true, Math.PI / 3, (Math.PI * 4) / 3), cloth);
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
    case 'victorian-frock-coat': {
      mesh(garment, 'FrockCoat', new THREE.CylinderGeometry(0.36, 0.44, 1.1, 8, 1, true), cloth, 0, -0.18);
      for (const side of [-1, 1]) {
        const lapel = mesh(garment, 'FrockLapel', new THREE.BoxGeometry(0.08, 0.6, 0.05), trim, side * 0.14, 0.12, 0.34);
        lapel.rotation.z = side * -0.22;
      }
      break;
    }
    case 'knit-professor-sweater': {
      const sweater = mesh(garment, 'KnitSweater', new THREE.CylinderGeometry(0.4, 0.38, 0.95, 8), cloth, 0, -0.1);
      sweater.scale.set(1.05, 1, 0.95);
      band(garment, 'SweaterWaist', 0.38, 0.03, -0.55, trim);
      break;
    }
    case 'edwardian-high-dress': {
      mesh(garment, 'HighDressBodice', new THREE.CylinderGeometry(0.34, 0.3, 0.75, 8), cloth, 0, 0.02);
      mesh(garment, 'HighDressSkirt', new THREE.CylinderGeometry(0.32, 0.52, 0.95, 8), cloth, 0, -0.55);
      mesh(garment, 'PleatedBib', new THREE.BoxGeometry(0.18, 0.55, 0.03), linen, 0, 0.08, 0.31);
      break;
    }
    case 'tehuana-huipil-shawl': {
      const huipil = mesh(garment, 'HuipilBox', new THREE.BoxGeometry(0.72, 0.85, 0.42), cloth, 0, -0.08);
      mesh(garment, 'HuipilEmbroidery', new THREE.BoxGeometry(0.32, 0.4, 0.04), gold, 0, 0.08, 0.23);
      const rebozo = mesh(garment, 'RebozoSash', new THREE.BoxGeometry(0.18, 1.15, 0.08), trim, -0.12, -0.15, 0.26);
      rebozo.rotation.z = -0.35;
      break;
    }
    case 'elizabethan-doublet': {
      mesh(garment, 'DoubletTorso', new THREE.CylinderGeometry(0.38, 0.3, 0.85, 8), cloth, 0, -0.05);
      for (const side of [-1, 1]) {
        const wing = mesh(garment, 'ShoulderRoll', new THREE.TorusGeometry(0.18, 0.045, 5, 12), trim, side * 0.38, 0.26, 0);
        wing.rotation.y = Math.PI / 2;
      }
      break;
    }
    case 'plate-armor-cuirass': {
      const breastplate = mesh(garment, 'SteelCuirass', new THREE.CylinderGeometry(0.4, 0.32, 0.88, 7), steel, 0, -0.04);
      breastplate.scale.set(1.08, 1, 0.9);
      for (const side of [-1, 1]) {
        mesh(garment, 'Pauldron', new THREE.SphereGeometry(0.19, 6, 5), steel, side * 0.42, 0.28, 0).scale.set(1.2, 0.6, 1);
      }
      mesh(garment, 'FleurDeLis', new THREE.OctahedronGeometry(0.08), gold, 0, 0.12, 0.34);
      break;
    }
    case 'saffron-monk-robe': {
      const kasaya = mesh(garment, 'KasayaRobe', new THREE.CylinderGeometry(0.38, 0.54, 1.18, 8, 1, true, 0, (Math.PI * 5) / 3), cloth, 0, -0.2);
      kasaya.rotation.y = 0.4;
      mesh(garment, 'BareShoulderWrap', new THREE.BoxGeometry(0.14, 0.95, 0.08), gold, 0.14, 0.05, 0.32).rotation.z = 0.55;
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
    case 'elizabethan-ruff':
      band(collar, 'CartwheelRuff', 0.34, 0.08, 0.43, linen);
      band(collar, 'RuffTrim', 0.35, 0.02, 0.43, trim);
      break;
    case 'wing-collar':
      band(collar, 'WingNeck', 0.2, 0.05, 0.44, linen);
      mesh(collar, 'NarrowTie', new THREE.BoxGeometry(0.06, 0.38, 0.03), cloth, 0, 0.22, 0.31);
      break;
    case 'plate-gorget':
      band(collar, 'SteelGorget', 0.28, 0.07, 0.42, steel);
      break;
    case 'astral-gorget':
      band(collar, 'AstralGorget', 0.27, 0.065, 0.4, trim);
      break;
    case 'none':
      break;
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
        pointer.rotation.z = (axis * Math.PI) / 2;
      }
      break;
    }
    case 'tesla-induction-coil': {
      mesh(relic, 'CoilCore', new THREE.CylinderGeometry(0.06, 0.06, 0.55, 8), copper, 0, 0, 0);
      mesh(relic, 'ToroidUpper', new THREE.TorusGeometry(0.22, 0.035, 6, 20), copper, 0, 0.22, 0).rotation.x = Math.PI / 2;
      mesh(relic, 'ToroidLower', new THREE.TorusGeometry(0.25, 0.04, 6, 20), copper, 0, -0.18, 0).rotation.x = Math.PI / 2;
      mesh(relic, 'DischargeTop', new THREE.SphereGeometry(0.08, 6, 5), electricCyan, 0, 0.32, 0);
      const spark1 = mesh(relic, 'ElectricSpark1', new THREE.OctahedronGeometry(0.07), electricCyan, 0.16, 0.24, 0.1);
      spark1.scale.set(0.5, 1.5, 0.5);
      const spark2 = mesh(relic, 'ElectricSpark2', new THREE.OctahedronGeometry(0.06), electricViolet, -0.15, -0.08, 0.12);
      spark2.scale.set(0.6, 1.4, 0.6);
      break;
    }
    case 'relativity-geodesic-ring': {
      mesh(relic, 'SingularityCore', new THREE.SphereGeometry(0.09, 8, 6), gold, 0, 0, 0);
      for (let i = 0; i < 2; i++) {
        const geodesic = mesh(relic, 'GeodesicRing', new THREE.TorusGeometry(0.26 - i * 0.04, 0.016, 5, 24), glow);
        geodesic.rotation.set(i === 0 ? Math.PI / 3 : -Math.PI / 4, i === 1 ? Math.PI / 2 : 0.4, 0);
      }
      mesh(relic, 'PhotonParticle', new THREE.SphereGeometry(0.04, 5, 4), electricCyan, 0.22, 0.14, 0);
      break;
    }
    case 'radium-phial-luminary': {
      const phialGlass = new THREE.MeshPhysicalMaterial({ color: '#caffea', transmission: 0.7, transparent: true, opacity: 0.85, roughness: 0.08, thickness: 0.25 });
      mesh(relic, 'PhialBody', new THREE.CylinderGeometry(0.09, 0.13, 0.38, 8), phialGlass, 0, -0.04, 0);
      mesh(relic, 'RadiumGlow', new THREE.CylinderGeometry(0.07, 0.11, 0.26, 8), radiumGlow, 0, -0.08, 0);
      mesh(relic, 'PhialStopper', new THREE.CylinderGeometry(0.05, 0.06, 0.09, 6), gold, 0, 0.18, 0);
      break;
    }
    case 'retablo-sacred-heart': {
      mesh(relic, 'SacredHeart', new THREE.SphereGeometry(0.14, 7, 6), heartRed, 0, 0, 0).scale.set(1.1, 1.3, 0.85);
      mesh(relic, 'HeartCross', new THREE.BoxGeometry(0.04, 0.22, 0.04), gold, 0, 0.2, 0);
      mesh(relic, 'HeartCrossBar', new THREE.BoxGeometry(0.14, 0.04, 0.04), gold, 0, 0.22, 0);
      for (let a = 0; a < 6; a++) {
        const rayAngle = (a * Math.PI * 2) / 6;
        const ray = mesh(relic, 'RetabloRay', new THREE.ConeGeometry(0.03, 0.16, 4), gold, Math.sin(rayAngle) * 0.22, Math.cos(rayAngle) * 0.22, 0);
        ray.rotation.z = -rayAngle;
      }
      break;
    }
    case 'quill-and-first-folio': {
      const folio = mesh(relic, 'FolioBook', new THREE.BoxGeometry(0.32, 0.44, 0.09), cloth, 0, -0.06, 0);
      folio.rotation.y = 0.25;
      mesh(relic, 'FolioTrim', new THREE.BoxGeometry(0.33, 0.03, 0.1), gold, 0, 0.14, 0);
      const quill = mesh(relic, 'GooseQuill', new THREE.ConeGeometry(0.035, 0.55, 4), linen, 0.06, 0.16, 0.08);
      quill.rotation.z = -0.55;
      break;
    }
    case 'beagle-naturalist-specimen': {
      const amber = new THREE.MeshPhysicalMaterial({ color: '#f59e0b', transmission: 0.6, transparent: true, opacity: 0.85, roughness: 0.15 });
      mesh(relic, 'AmberSpecimen', new THREE.SphereGeometry(0.16, 8, 6), amber, 0, 0, 0).scale.set(1, 1.35, 0.8);
      mesh(relic, 'FossilStem', new THREE.CylinderGeometry(0.015, 0.015, 0.28, 4), trim, 0, 0, 0);
      for (const side of [-1, 1]) {
        mesh(relic, 'FossilBranch', new THREE.BoxGeometry(0.08, 0.02, 0.02), trim, side * 0.05, side * 0.04, 0);
      }
      break;
    }
    case 'saintly-oriflamme-banner': {
      mesh(relic, 'LanceShaft', new THREE.CylinderGeometry(0.02, 0.02, 1.1, 6), steel, 0, 0.1, 0);
      mesh(relic, 'SpearHead', new THREE.ConeGeometry(0.06, 0.22, 4), gold, 0, 0.68, 0);
      const pennant = mesh(relic, 'SwallowtailBanner', new THREE.BoxGeometry(0.42, 0.28, 0.02), cloth, 0.22, 0.46, 0);
      mesh(pennant, 'BannerLily', new THREE.OctahedronGeometry(0.06), gold, 0, 0, 0.02);
      break;
    }
  }
  return { head, garment, relic };
}

