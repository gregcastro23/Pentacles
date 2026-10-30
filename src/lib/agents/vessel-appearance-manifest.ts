import { HISTORICAL_AGENTS, PLANET_COLORS } from '../../alchm-chart/historical-agents.js';

export type VesselEra = 'ancient' | 'renaissance' | 'enlightenment' | 'romantic' | 'modern' | 'astral';
export type VesselCrownStyle =
  | 'newton-curls'
  | 'da-vinci-beret-beard'
  | 'dickinson-parted-bun'
  | 'sovereign-crest'
  | 'laurel-wreath'
  | 'scholar-hood'
  | 'astral-helm'
  | 'tesla-parted-mustache'
  | 'einstein-wild-halo'
  | 'curie-edwardian-updo'
  | 'kahlo-floral-braid'
  | 'shakespeare-ruff-ringlets'
  | 'darwin-naturalist-beard'
  | 'cleopatra-nemes-uraeus'
  | 'joan-battle-bob'
  | 'buddha-ushnisha-topknot';

export type VesselMantleStyle =
  | 'enlightenment-coat'
  | 'renaissance-drape'
  | 'victorian-shawl'
  | 'alchemical-vestments'
  | 'scholar-robe'
  | 'victorian-frock-coat'
  | 'knit-professor-sweater'
  | 'edwardian-high-dress'
  | 'tehuana-huipil-shawl'
  | 'elizabethan-doublet'
  | 'plate-armor-cuirass'
  | 'saffron-monk-robe';

export type VesselCollarStyle =
  | 'high-cravat'
  | 'renaissance-collar'
  | 'lace-tippet'
  | 'astral-gorget'
  | 'none'
  | 'elizabethan-ruff'
  | 'wing-collar'
  | 'plate-gorget';

export type VesselSignatureRelic =
  | 'prism-octahedron'
  | 'vitruvian-gyroscope'
  | 'herbarium-quill-lantern'
  | 'solar-astrolabe'
  | 'tesla-induction-coil'
  | 'relativity-geodesic-ring'
  | 'radium-phial-luminary'
  | 'retablo-sacred-heart'
  | 'quill-and-first-folio'
  | 'beagle-naturalist-specimen'
  | 'saintly-oriflamme-banner';

export type VesselLowerBodyStyle =
  | 'full-robe'
  | 'tunic-greaves'
  | 'trousers-boots'
  | 'armored-cuisses';

export type HeadwearAccent =
  | 'none'
  | 'feather-plume'
  | 'circlet-gem'
  | 'crown-spikes'
  | 'laurel-sprig'
  | 'coiffure-ribbon';

export type CollarPauldronAccent =
  | 'none'
  | 'winged-pauldrons'
  | 'spiked-guard'
  | 'fur-trim'
  | 'epaulette-tassels'
  | 'stole-brooch';

export type FaceAccent =
  | 'none'
  | 'wire-spectacles'
  | 'scholar-monocle'
  | 'philosopher-beard'
  | 'mystic-veil'
  | 'goatee-accent';

export type OffHandAccessory =
  | 'none'
  | 'parchment-scroll'
  | 'astral-codex'
  | 'alchemical-compass'
  | 'hourglass'
  | 'crystal-lens';

export interface VesselModularTraits {
  headwearAccent: HeadwearAccent;
  collarPauldronAccent: CollarPauldronAccent;
  faceAccent: FaceAccent;
  offHandAccessory: OffHandAccessory;
}

export const HEADWEAR_ACCENTS: readonly HeadwearAccent[] = [
  'none',
  'feather-plume',
  'circlet-gem',
  'crown-spikes',
  'laurel-sprig',
  'coiffure-ribbon',
];

export const COLLAR_PAULDRON_ACCENTS: readonly CollarPauldronAccent[] = [
  'none',
  'winged-pauldrons',
  'spiked-guard',
  'fur-trim',
  'epaulette-tassels',
  'stole-brooch',
];

export const FACE_ACCENTS: readonly FaceAccent[] = [
  'none',
  'wire-spectacles',
  'scholar-monocle',
  'philosopher-beard',
  'mystic-veil',
  'goatee-accent',
];

export const OFF_HAND_ACCESSORIES: readonly OffHandAccessory[] = [
  'none',
  'parchment-scroll',
  'astral-codex',
  'alchemical-compass',
  'hourglass',
  'crystal-lens',
];

export interface VesselAppearanceProfile {
  era: VesselEra;
  headSilhouette: {
    crownStyle: VesselCrownStyle;
    faceProportion: { jawWidth: number; browDepth: number; cranialHeight: number };
  };
  garmentSilhouette: { mantleStyle: VesselMantleStyle; collarStyle: VesselCollarStyle };
  lowerBodyStyle?: VesselLowerBodyStyle;
  signatureRelic: VesselSignatureRelic;
  modularTraits?: VesselModularTraits;
  paletteOverrides: {
    primaryGarmentHex: string;
    secondaryTrimHex: string;
    hairOrCrownHex: string;
    skinOrMaterialToneHex: string;
  };
  portraitSvgDataUri?: string;
  portraitUrl?: string;
  avatarModelUrl?: string;
  headMeshUrl?: string;
}

export const VESSEL_RELIC_LABELS: Record<VesselSignatureRelic, string> = {
  'prism-octahedron': 'Prism Octahedron',
  'vitruvian-gyroscope': 'Vitruvian Gyroscope',
  'herbarium-quill-lantern': 'Herbarium Lantern',
  'solar-astrolabe': 'Solar Astrolabe',
  'tesla-induction-coil': 'Tesla Induction Coil',
  'relativity-geodesic-ring': 'Relativity Geodesic',
  'radium-phial-luminary': 'Radium Luminary Phial',
  'retablo-sacred-heart': 'Retablo Sacred Heart',
  'quill-and-first-folio': 'Quill & First Folio',
  'beagle-naturalist-specimen': 'HMS Beagle Specimen',
  'saintly-oriflamme-banner': 'Saintly Oriflamme',
};

const pilotDefinitions: Record<string, VesselAppearanceProfile> = {
  'isaac-newton': {
    era: 'enlightenment',
    headSilhouette: { crownStyle: 'newton-curls', faceProportion: { jawWidth: 0.86, browDepth: 1.14, cranialHeight: 1.08 } },
    garmentSilhouette: { mantleStyle: 'enlightenment-coat', collarStyle: 'high-cravat' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'prism-octahedron',
    paletteOverrides: { primaryGarmentHex: '#481f32', secondaryTrimHex: '#d8c4a0', hairOrCrownHex: '#d6c9b5', skinOrMaterialToneHex: '#e8c7a5' },
    portraitUrl: '/avatars/newton.png',
  },
  'leonardo-da-vinci': {
    era: 'renaissance',
    headSilhouette: { crownStyle: 'da-vinci-beret-beard', faceProportion: { jawWidth: 1.04, browDepth: 1.16, cranialHeight: 1.04 } },
    garmentSilhouette: { mantleStyle: 'renaissance-drape', collarStyle: 'renaissance-collar' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'vitruvian-gyroscope',
    paletteOverrides: { primaryGarmentHex: '#302b68', secondaryTrimHex: '#deb968', hairOrCrownHex: '#c6bba6', skinOrMaterialToneHex: '#d6af8a' },
    portraitUrl: '/avatars/leonardo-da-vinci.png',
  },
  'emily-dickinson': {
    era: 'romantic',
    headSilhouette: { crownStyle: 'dickinson-parted-bun', faceProportion: { jawWidth: 0.8, browDepth: 0.88, cranialHeight: 1.16 } },
    garmentSilhouette: { mantleStyle: 'victorian-shawl', collarStyle: 'lace-tippet' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'herbarium-quill-lantern',
    paletteOverrides: { primaryGarmentHex: '#ece6d8', secondaryTrimHex: '#bfcfbd', hairOrCrownHex: '#653a2c', skinOrMaterialToneHex: '#e6bea2' },
    portraitUrl: '/avatars/emily-dickinson.png',
  },
  'user-avatar-neo': {
    era: 'astral',
    headSilhouette: { crownStyle: 'sovereign-crest', faceProportion: { jawWidth: 1.02, browDepth: 1.1, cranialHeight: 1.1 } },
    garmentSilhouette: { mantleStyle: 'alchemical-vestments', collarStyle: 'astral-gorget' },
    lowerBodyStyle: 'armored-cuisses',
    signatureRelic: 'solar-astrolabe',
    paletteOverrides: { primaryGarmentHex: '#171b2c', secondaryTrimHex: '#efc45c', hairOrCrownHex: '#e5bd66', skinOrMaterialToneHex: '#a4bcc7' },
  },
  'nikola-tesla-1856': {
    era: 'modern',
    headSilhouette: { crownStyle: 'tesla-parted-mustache', faceProportion: { jawWidth: 0.84, browDepth: 1.15, cranialHeight: 1.06 } },
    garmentSilhouette: { mantleStyle: 'victorian-frock-coat', collarStyle: 'wing-collar' },
    lowerBodyStyle: 'trousers-boots',
    signatureRelic: 'tesla-induction-coil',
    paletteOverrides: { primaryGarmentHex: '#141824', secondaryTrimHex: '#00e5ff', hairOrCrownHex: '#1b1a1c', skinOrMaterialToneHex: '#e8cbb0' },
    portraitUrl: '/avatars/tesla.png',
  },
  'marie-curie-1867': {
    era: 'modern',
    headSilhouette: { crownStyle: 'curie-edwardian-updo', faceProportion: { jawWidth: 0.82, browDepth: 0.94, cranialHeight: 1.12 } },
    garmentSilhouette: { mantleStyle: 'edwardian-high-dress', collarStyle: 'lace-tippet' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'radium-phial-luminary',
    paletteOverrides: { primaryGarmentHex: '#1b1d28', secondaryTrimHex: '#4bf0a5', hairOrCrownHex: '#524036', skinOrMaterialToneHex: '#e5be9e' },
    portraitUrl: '/avatars/curie.png',
  },
  'albert-einstein': {
    era: 'modern',
    headSilhouette: { crownStyle: 'einstein-wild-halo', faceProportion: { jawWidth: 0.96, browDepth: 1.14, cranialHeight: 1.1 } },
    garmentSilhouette: { mantleStyle: 'knit-professor-sweater', collarStyle: 'wing-collar' },
    lowerBodyStyle: 'trousers-boots',
    signatureRelic: 'relativity-geodesic-ring',
    paletteOverrides: { primaryGarmentHex: '#383028', secondaryTrimHex: '#f6cf83', hairOrCrownHex: '#e8eaed', skinOrMaterialToneHex: '#dfb798' },
    portraitUrl: '/avatars/albert-einstein.png',
  },
  'frida-kahlo': {
    era: 'modern',
    headSilhouette: { crownStyle: 'kahlo-floral-braid', faceProportion: { jawWidth: 0.88, browDepth: 1.02, cranialHeight: 1.06 } },
    garmentSilhouette: { mantleStyle: 'tehuana-huipil-shawl', collarStyle: 'none' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'retablo-sacred-heart',
    paletteOverrides: { primaryGarmentHex: '#7f1932', secondaryTrimHex: '#f59e0b', hairOrCrownHex: '#171415', skinOrMaterialToneHex: '#c7926b' },
    portraitUrl: '/avatars/frida.png',
  },
  'william-shakespeare': {
    era: 'renaissance',
    headSilhouette: { crownStyle: 'shakespeare-ruff-ringlets', faceProportion: { jawWidth: 0.92, browDepth: 1.1, cranialHeight: 1.06 } },
    garmentSilhouette: { mantleStyle: 'elizabethan-doublet', collarStyle: 'elizabethan-ruff' },
    lowerBodyStyle: 'trousers-boots',
    signatureRelic: 'quill-and-first-folio',
    paletteOverrides: { primaryGarmentHex: '#2b1b36', secondaryTrimHex: '#deb968', hairOrCrownHex: '#69412a', skinOrMaterialToneHex: '#e2be9b' },
    portraitUrl: '/avatars/shakespeare.png',
  },
  'charles-darwin-1809': {
    era: 'romantic',
    headSilhouette: { crownStyle: 'darwin-naturalist-beard', faceProportion: { jawWidth: 1.06, browDepth: 1.22, cranialHeight: 1.04 } },
    garmentSilhouette: { mantleStyle: 'enlightenment-coat', collarStyle: 'high-cravat' },
    lowerBodyStyle: 'trousers-boots',
    signatureRelic: 'beagle-naturalist-specimen',
    paletteOverrides: { primaryGarmentHex: '#2e3528', secondaryTrimHex: '#8cb369', hairOrCrownHex: '#d2d5d8', skinOrMaterialToneHex: '#dfb99c' },
    portraitUrl: '/avatars/darwin.png',
  },
  'cleopatra': {
    era: 'ancient',
    headSilhouette: { crownStyle: 'cleopatra-nemes-uraeus', faceProportion: { jawWidth: 0.85, browDepth: 1.05, cranialHeight: 1.08 } },
    garmentSilhouette: { mantleStyle: 'scholar-robe', collarStyle: 'astral-gorget' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'solar-astrolabe',
    paletteOverrides: { primaryGarmentHex: '#0f293b', secondaryTrimHex: '#ffd700', hairOrCrownHex: '#111116', skinOrMaterialToneHex: '#c2946c' },
    portraitUrl: '/avatars/cleopatra.png',
  },
  'joan-of-arc': {
    era: 'renaissance',
    headSilhouette: { crownStyle: 'joan-battle-bob', faceProportion: { jawWidth: 0.9, browDepth: 1.05, cranialHeight: 1.05 } },
    garmentSilhouette: { mantleStyle: 'plate-armor-cuirass', collarStyle: 'plate-gorget' },
    lowerBodyStyle: 'armored-cuisses',
    signatureRelic: 'saintly-oriflamme-banner',
    paletteOverrides: { primaryGarmentHex: '#252936', secondaryTrimHex: '#93c5fd', hairOrCrownHex: '#4d3324', skinOrMaterialToneHex: '#e2bf9f' },
    portraitUrl: '/avatars/joan-of-arc.png',
  },
  'siddhartha-gautama-buddha': {
    era: 'ancient',
    headSilhouette: { crownStyle: 'buddha-ushnisha-topknot', faceProportion: { jawWidth: 0.92, browDepth: 0.95, cranialHeight: 1.15 } },
    garmentSilhouette: { mantleStyle: 'saffron-monk-robe', collarStyle: 'none' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'solar-astrolabe',
    paletteOverrides: { primaryGarmentHex: '#d97706', secondaryTrimHex: '#fef08a', hairOrCrownHex: '#1e1b2e', skinOrMaterialToneHex: '#c59567' },
    portraitUrl: '/avatars/siddhartha-gautama-buddha.png',
  },
  'socrates': {
    era: 'ancient',
    headSilhouette: { crownStyle: 'scholar-hood', faceProportion: { jawWidth: 1.08, browDepth: 1.18, cranialHeight: 1.02 } },
    garmentSilhouette: { mantleStyle: 'scholar-robe', collarStyle: 'none' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'solar-astrolabe',
    paletteOverrides: { primaryGarmentHex: '#1e293b', secondaryTrimHex: '#00daf3', hairOrCrownHex: '#c7cbd1', skinOrMaterialToneHex: '#d8af88' },
    portraitUrl: '/avatars/socrates.png',
  },
  'plato': {
    era: 'ancient',
    headSilhouette: { crownStyle: 'laurel-wreath', faceProportion: { jawWidth: 0.94, browDepth: 1.12, cranialHeight: 1.14 } },
    garmentSilhouette: { mantleStyle: 'scholar-robe', collarStyle: 'none' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'solar-astrolabe',
    paletteOverrides: { primaryGarmentHex: '#3b2210', secondaryTrimHex: '#ff9800', hairOrCrownHex: '#e5e7eb', skinOrMaterialToneHex: '#dfb892' },
    portraitUrl: '/avatars/plato.png',
  },
  'aristotle': {
    era: 'ancient',
    headSilhouette: { crownStyle: 'laurel-wreath', faceProportion: { jawWidth: 0.98, browDepth: 1.1, cranialHeight: 1.08 } },
    garmentSilhouette: { mantleStyle: 'scholar-robe', collarStyle: 'none' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'vitruvian-gyroscope',
    paletteOverrides: { primaryGarmentHex: '#2e1218', secondaryTrimHex: '#f44336', hairOrCrownHex: '#9ca3af', skinOrMaterialToneHex: '#dbaf84' },
    portraitUrl: '/avatars/aristotle.png',
  },
  'marcus-aurelius': {
    era: 'ancient',
    headSilhouette: { crownStyle: 'laurel-wreath', faceProportion: { jawWidth: 1.02, browDepth: 1.15, cranialHeight: 1.08 } },
    garmentSilhouette: { mantleStyle: 'plate-armor-cuirass', collarStyle: 'plate-gorget' },
    lowerBodyStyle: 'armored-cuisses',
    signatureRelic: 'solar-astrolabe',
    paletteOverrides: { primaryGarmentHex: '#3b1042', secondaryTrimHex: '#00e5ff', hairOrCrownHex: '#423329', skinOrMaterialToneHex: '#d9ad84' },
    portraitUrl: '/avatars/marcus-aurelius.png',
  },
  'alexander-the-great': {
    era: 'ancient',
    headSilhouette: { crownStyle: 'sovereign-crest', faceProportion: { jawWidth: 0.95, browDepth: 1.08, cranialHeight: 1.1 } },
    garmentSilhouette: { mantleStyle: 'plate-armor-cuirass', collarStyle: 'plate-gorget' },
    lowerBodyStyle: 'armored-cuisses',
    signatureRelic: 'solar-astrolabe',
    paletteOverrides: { primaryGarmentHex: '#181b22', secondaryTrimHex: '#cd7f32', hairOrCrownHex: '#e0a94b', skinOrMaterialToneHex: '#e0b896' },
    portraitUrl: '/avatars/alexander-the-great.png',
  },
  'galileo-galilei': {
    era: 'renaissance',
    headSilhouette: { crownStyle: 'da-vinci-beret-beard', faceProportion: { jawWidth: 0.98, browDepth: 1.16, cranialHeight: 1.06 } },
    garmentSilhouette: { mantleStyle: 'renaissance-drape', collarStyle: 'renaissance-collar' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'prism-octahedron',
    paletteOverrides: { primaryGarmentHex: '#10223b', secondaryTrimHex: '#00e5ff', hairOrCrownHex: '#d4d8de', skinOrMaterialToneHex: '#d8b08e' },
    portraitUrl: '/avatars/galileo-galilei.png',
  },
  'dante-alighieri': {
    era: 'renaissance',
    headSilhouette: { crownStyle: 'laurel-wreath', faceProportion: { jawWidth: 0.88, browDepth: 1.22, cranialHeight: 1.08 } },
    garmentSilhouette: { mantleStyle: 'scholar-robe', collarStyle: 'renaissance-collar' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'quill-and-first-folio',
    paletteOverrides: { primaryGarmentHex: '#6b1818', secondaryTrimHex: '#00daf3', hairOrCrownHex: '#1c1917', skinOrMaterialToneHex: '#dbaf88' },
    portraitUrl: '/avatars/dante-alighieri.png',
  },
  'vincent-van-gogh-1853': {
    era: 'modern',
    headSilhouette: { crownStyle: 'darwin-naturalist-beard', faceProportion: { jawWidth: 0.88, browDepth: 1.18, cranialHeight: 1.06 } },
    garmentSilhouette: { mantleStyle: 'victorian-frock-coat', collarStyle: 'high-cravat' },
    lowerBodyStyle: 'trousers-boots',
    signatureRelic: 'retablo-sacred-heart',
    paletteOverrides: { primaryGarmentHex: '#192b45', secondaryTrimHex: '#ff9800', hairOrCrownHex: '#b45309', skinOrMaterialToneHex: '#deb896' },
    portraitUrl: '/avatars/vincent-van-gogh.png',
  },
  'edgar-allan-poe-1809': {
    era: 'romantic',
    headSilhouette: { crownStyle: 'tesla-parted-mustache', faceProportion: { jawWidth: 0.86, browDepth: 1.2, cranialHeight: 1.12 } },
    garmentSilhouette: { mantleStyle: 'enlightenment-coat', collarStyle: 'high-cravat' },
    lowerBodyStyle: 'trousers-boots',
    signatureRelic: 'quill-and-first-folio',
    paletteOverrides: { primaryGarmentHex: '#13111c', secondaryTrimHex: '#9c27b0', hairOrCrownHex: '#18181b', skinOrMaterialToneHex: '#ecd7c7' },
    portraitUrl: '/avatars/edgar-allan-poe.png',
  },
  'thomas-aquinas': {
    era: 'renaissance',
    headSilhouette: { crownStyle: 'scholar-hood', faceProportion: { jawWidth: 1.04, browDepth: 1.1, cranialHeight: 1.08 } },
    garmentSilhouette: { mantleStyle: 'scholar-robe', collarStyle: 'none' },
    lowerBodyStyle: 'full-robe',
    signatureRelic: 'solar-astrolabe',
    paletteOverrides: { primaryGarmentHex: '#181c2e', secondaryTrimHex: '#00e5ff', hairOrCrownHex: '#3b322a', skinOrMaterialToneHex: '#dbc3a7' },
    portraitUrl: '/avatars/thomas-aquinas.png',
  },
};

function safeHex(value: string): string {
  return /^#[\da-f]{6}$/i.test(value) ? value : '#d8b46a';
}

/** A self-contained cameo: matching period silhouettes without network or raster assets. */
export function createVesselPortraitSvg(profile: VesselAppearanceProfile): string {
  const palette = profile.paletteOverrides;
  const cloth = safeHex(palette.primaryGarmentHex);
  const trim = safeHex(palette.secondaryTrimHex);
  const hair = safeHex(palette.hairOrCrownHex);
  const skin = safeHex(palette.skinOrMaterialToneHex);
  const style = profile.headSilhouette.crownStyle;

  const silhouette: Record<VesselCrownStyle, string> = {
    'newton-curls': `<path d="M37 51Q28 40 33 27Q38 13 51 18Q66 11 72 28L75 59L65 66L62 36L43 34L43 66L31 60Z" fill="${hair}"/>${[32, 39, 46, 53, 60].map((y, i) => `<circle cx="${34 - (i % 2)}" cy="${y}" r="6" fill="${hair}"/><circle cx="70" cy="${y}" r="6" fill="${hair}"/>`).join('')}`,
    'da-vinci-beret-beard': `<path d="M32 32Q27 15 49 13Q68 10 76 25L69 34Z" fill="${cloth}"/><path d="M34 31L70 29" stroke="${trim}" stroke-width="4"/><path d="M38 47Q50 59 65 46L62 67L51 79L40 65Z" fill="${hair}"/><path d="M40 52L45 67M49 56L51 72M58 53L57 66" stroke="${trim}" stroke-width="1"/>`,
    'dickinson-parted-bun': `<circle cx="70" cy="40" r="11" fill="${hair}"/><path d="M33 40Q28 18 49 18Q69 17 68 41L60 35L51 24L40 37Z" fill="${hair}"/><path d="M50 20L50 31" stroke="${skin}" stroke-width="2"/>`,
    'sovereign-crest': `<path d="M32 33L28 18L42 24L51 8L60 24L74 18L69 36Z" fill="${hair}"/><path d="M35 31L67 31" stroke="${trim}" stroke-width="4"/><path d="M51 15L55 26L51 32L47 26Z" fill="#e6fbff"/>`,
    'laurel-wreath': `<path d="M34 47Q22 26 47 17M65 47Q79 27 55 17" fill="none" stroke="${hair}" stroke-width="5"/>${[0, 1, 2, 3].map((i) => `<ellipse cx="${31 + i * 4}" cy="${37 - i * 6}" rx="6" ry="3" fill="${trim}" transform="rotate(-35 ${31 + i * 4} ${37 - i * 6})"/><ellipse cx="${69 - i * 4}" cy="${37 - i * 6}" rx="6" ry="3" fill="${trim}" transform="rotate(35 ${69 - i * 4} ${37 - i * 6})"/>`).join('')}`,
    'scholar-hood': `<path d="M27 63L27 33Q29 13 50 12Q73 16 75 36L74 65L63 57L65 34L49 24L36 36L38 58Z" fill="${cloth}" stroke="${trim}" stroke-width="2"/>`,
    'astral-helm': `<path d="M31 42L32 23L50 10L69 23L71 43L63 49L62 32L50 23L40 33L39 49Z" fill="${hair}" stroke="${trim}" stroke-width="2"/><path d="M50 13L50 25" stroke="#e6fbff" stroke-width="3"/>`,
    'tesla-parted-mustache': `<path d="M32 36Q30 19 49 19Q68 18 69 36L64 30L51 22L37 30Z" fill="${hair}"/><path d="M50 21L50 34" stroke="${hair}" stroke-width="2"/><path d="M42 55Q49 53 51 55Q53 53 60 55Q56 59 51 56Q46 59 42 55Z" fill="${hair}"/>`,
    'einstein-wild-halo': `<circle cx="34" cy="30" r="10" fill="${hair}"/><circle cx="44" cy="20" r="11" fill="${hair}"/><circle cx="58" cy="20" r="11" fill="${hair}"/><circle cx="68" cy="30" r="10" fill="${hair}"/><circle cx="28" cy="42" r="8" fill="${hair}"/><circle cx="74" cy="42" r="8" fill="${hair}"/><path d="M33 36Q40 25 51 25Q62 25 69 36L61 31L51 28L41 31Z" fill="${hair}"/><path d="M43 40L49 42M59 40L53 42M42 56Q51 54 60 56" stroke="${hair}" stroke-width="1.8" fill="none"/>`,
    'curie-edwardian-updo': `<circle cx="51" cy="24" r="13" fill="${hair}"/><path d="M33 39Q32 23 51 21Q70 23 69 39L63 34L51 29L39 34Z" fill="${hair}"/><path d="M44 19L58 19" stroke="${trim}" stroke-width="2.5"/><circle cx="58" cy="19" r="2.5" fill="${trim}"/>`,
    'kahlo-floral-braid': `<path d="M33 35Q32 19 51 18Q70 19 69 35L61 31L51 24L41 31Z" fill="${hair}"/><circle cx="38" cy="20" r="5.5" fill="#f43f5e"/><circle cx="46" cy="16" r="6" fill="#f59e0b"/><circle cx="56" cy="16" r="6" fill="#e11d48"/><circle cx="64" cy="20" r="5.5" fill="#f59e0b"/><path d="M43 42Q51 46 59 42" stroke="${hair}" stroke-width="2.6" fill="none"/>`,
    'shakespeare-ruff-ringlets': `<path d="M33 46Q30 22 51 21Q72 22 69 46L63 42L62 33Q51 28 40 33L39 42Z" fill="${hair}"/><circle cx="34" cy="46" r="4.5" fill="${hair}"/><circle cx="68" cy="46" r="4.5" fill="${hair}"/><path d="M46 54Q51 52 56 54M49 57L51 64L53 57" stroke="${hair}" stroke-width="1.8" fill="none"/>`,
    'darwin-naturalist-beard': `<path d="M35 34Q33 18 51 18Q69 18 67 34L61 30L51 24L41 30Z" fill="${hair}"/><path d="M43 38L49 41M59 38L53 41" stroke="${hair}" stroke-width="2.5"/><path d="M35 48Q51 68 67 48L64 74L51 84L38 74Z" fill="${hair}"/>`,
    'cleopatra-nemes-uraeus': `<path d="M30 24L51 12L72 24L74 65L66 69L64 36L38 36L36 69L28 65Z" fill="#1e3a8a"/><path d="M32 23L70 23M34 31L68 31" stroke="${trim}" stroke-width="3"/><path d="M51 12L51 6L54 8L51 10" stroke="${trim}" stroke-width="2" fill="none"/>`,
    'joan-battle-bob': `<path d="M31 28Q31 16 51 16Q71 16 71 28L72 58L63 56L63 36L39 36L39 56L30 58Z" fill="${hair}"/><circle cx="51" cy="18" r="3" fill="${trim}"/><path d="M34 22L68 22" stroke="${trim}" stroke-width="2"/>`,
    'buddha-ushnisha-topknot': `<circle cx="51" cy="14" r="7.5" fill="${hair}"/><circle cx="51" cy="8" r="2.5" fill="${trim}"/><path d="M34 36Q33 21 51 20Q69 21 68 36L60 32L51 25L42 32Z" fill="${hair}"/><circle cx="51" cy="38" r="2.2" fill="${trim}"/>`,
  };

  const collar = profile.garmentSilhouette.collarStyle === 'lace-tippet'
    ? `<path d="M27 70L44 61L51 69L59 61L76 70L61 80L51 73L40 80Z" fill="#fff9ec" stroke="${trim}"/>`
    : profile.garmentSilhouette.collarStyle === 'high-cravat'
      ? '<path d="M43 60L61 60L57 69L61 81L49 78L43 69Z" fill="#fff9ec"/>'
      : profile.garmentSilhouette.collarStyle === 'elizabethan-ruff'
        ? `<ellipse cx="51" cy="66" rx="20" ry="7" fill="#fffef5" stroke="${trim}" stroke-width="1.8"/><path d="M33 66L69 66M35 63L67 69M35 69L67 63" stroke="#e4e0ce" stroke-width="1"/>`
        : profile.garmentSilhouette.collarStyle === 'wing-collar'
          ? `<path d="M38 61L46 66L44 76L51 81L58 76L56 66L64 61L51 65Z" fill="#fff9ec" stroke="${trim}" stroke-width="1.2"/>`
          : profile.garmentSilhouette.collarStyle === 'plate-gorget'
            ? `<path d="M35 60L51 67L67 60L64 74L51 78L38 74Z" fill="#b0c4de" stroke="${trim}" stroke-width="1.8"/>`
            : `<path d="M36 64L51 72L66 64" fill="none" stroke="${trim}" stroke-width="5"/>`;

  const relic = profile.signatureRelic === 'prism-octahedron'
    ? '<path d="M80 71L87 81L80 91L73 81Z" fill="#a6ecff" stroke="#ffffff"/><path d="M87 81L96 75M87 81L97 81M87 81L96 87" stroke="#d8b46a"/>'
    : profile.signatureRelic === 'herbarium-quill-lantern'
      ? `<path d="M79 71L87 76L86 88L74 88L73 76Z" fill="${trim}"/><path d="M79 84L81 75M80 81L75 78M80 79L85 77" stroke="#3b6d53" stroke-width="2"/>`
      : profile.signatureRelic === 'tesla-induction-coil'
        ? `<ellipse cx="81" cy="80" rx="9" ry="4" fill="none" stroke="#e09268" stroke-width="2.5"/><ellipse cx="81" cy="86" rx="10" ry="4" fill="none" stroke="#e09268" stroke-width="2.5"/><path d="M81 72L81 88" stroke="${trim}" stroke-width="3"/><path d="M73 75L78 78L71 83L77 87" stroke="#00e5ff" stroke-width="1.5" fill="none"/><path d="M89 74L84 79L91 82L86 87" stroke="#c055ff" stroke-width="1.5" fill="none"/>`
        : profile.signatureRelic === 'relativity-geodesic-ring'
          ? `<g fill="none" stroke="${trim}" stroke-width="1.8"><ellipse cx="81" cy="81" rx="11" ry="5" transform="rotate(-30 81 81)"/><ellipse cx="81" cy="81" rx="11" ry="5" transform="rotate(45 81 81)"/><circle cx="81" cy="81" r="3.5" fill="#ffd700"/><circle cx="72" cy="76" r="1.8" fill="#ffffff"/></g>`
          : profile.signatureRelic === 'radium-phial-luminary'
            ? `<path d="M78 72L84 72L84 77L89 88L73 88L78 77Z" fill="#10b981" stroke="#ffffff" stroke-width="1.5"/><circle cx="81" cy="83" r="2.5" fill="#a7f3d0"/><path d="M75 70L87 70" stroke="${trim}" stroke-width="2"/>`
            : profile.signatureRelic === 'retablo-sacred-heart'
              ? `<path d="M81 75Q87 69 91 74Q94 81 81 90Q68 81 71 74Q75 69 81 75Z" fill="#ef4444" stroke="${trim}" stroke-width="1.5"/><path d="M81 68L81 73M78 70L84 70" stroke="${trim}" stroke-width="1.8"/>`
              : profile.signatureRelic === 'quill-and-first-folio'
                ? `<rect x="73" y="74" width="16" height="15" rx="2" fill="#78350f" stroke="${trim}" stroke-width="1.5"/><path d="M71 90L91 70" stroke="#fef08a" stroke-width="2.2"/><circle cx="91" cy="70" r="1.5" fill="#ffffff"/>`
                : profile.signatureRelic === 'beagle-naturalist-specimen'
                  ? `<path d="M81 70Q90 76 90 84Q90 91 81 91Q72 91 72 84Q72 76 81 70Z" fill="#f59e0b" stroke="#ffffff" stroke-width="1.5"/><path d="M81 75L81 87M81 80L85 77M81 83L77 81" stroke="#374151" stroke-width="1.5"/>`
                  : profile.signatureRelic === 'saintly-oriflamme-banner'
                    ? `<path d="M75 66L75 92" stroke="${trim}" stroke-width="2.5"/><path d="M76 68L92 73L76 79Z" fill="#3b82f6" stroke="${trim}" stroke-width="1.5"/><circle cx="82" cy="73" r="2" fill="#ffd700"/>`
                    : `<g fill="none" stroke="${trim}" stroke-width="2"><circle cx="81" cy="81" r="10"/><ellipse cx="81" cy="81" rx="4" ry="10"/><path d="M70 81L92 81M81 70L81 92"/></g>`;

  const headwearAccent = profile.modularTraits?.headwearAccent;
  const headwearAccentSvg = headwearAccent === 'feather-plume'
    ? `<path d="M60 22Q68 12 75 7Q74 15 65 24Z" fill="${trim}" stroke="${cloth}" stroke-width="0.8"/><path d="M60 22Q68 12 75 7" stroke="#ffffff" stroke-width="0.8"/>`
    : headwearAccent === 'circlet-gem'
      ? `<path d="M38 31Q51 34 64 31" stroke="${trim}" stroke-width="1.8" fill="none"/><circle cx="51" cy="33" r="2.2" fill="#38bdf8" stroke="${trim}" stroke-width="0.8"/>`
      : headwearAccent === 'crown-spikes'
        ? `<path d="M43 25L46 17L51 22L56 17L59 25Z" fill="${trim}" stroke="#ffffff" stroke-width="0.5"/>`
        : headwearAccent === 'laurel-sprig'
          ? `<path d="M36 29Q43 26 51 28" stroke="${trim}" stroke-width="1.2" fill="none"/><ellipse cx="40" cy="26" rx="2.4" ry="1.2" fill="${trim}" transform="rotate(-20 40 26)"/><ellipse cx="46" cy="25" rx="2.4" ry="1.2" fill="${trim}" transform="rotate(-10 46 25)"/>`
          : headwearAccent === 'coiffure-ribbon'
            ? `<path d="M63 26Q70 24 68 31Q66 38 61 31Z" fill="${trim}"/><path d="M65 31L71 41M65 31L67 43" stroke="${trim}" stroke-width="1.2"/>`
            : '';

  const faceAccent = profile.modularTraits?.faceAccent;
  const faceAccentSvg = faceAccent === 'wire-spectacles'
    ? `<circle cx="47" cy="44" r="3.2" fill="none" stroke="${trim}" stroke-width="1.2"/><circle cx="55" cy="44" r="3.2" fill="none" stroke="${trim}" stroke-width="1.2"/><path d="M50.2 44L51.8 44" stroke="${trim}" stroke-width="1.2"/>`
    : faceAccent === 'scholar-monocle'
      ? `<circle cx="55" cy="44" r="3.6" fill="none" stroke="${trim}" stroke-width="1.4"/><path d="M58.6 44L61 53" stroke="${trim}" stroke-width="0.8"/>`
      : faceAccent === 'philosopher-beard'
        ? `<path d="M45 56Q51 72 57 56L55 68L51 76L47 68Z" fill="${hair}" stroke="${trim}" stroke-width="0.6"/>`
        : faceAccent === 'mystic-veil'
          ? `<path d="M40 48Q51 51 62 48L60 62Q51 66 42 62Z" fill="${cloth}" fill-opacity="0.6" stroke="${trim}" stroke-width="0.8"/>`
          : faceAccent === 'goatee-accent'
            ? `<path d="M49 57L53 57L51 64Z" fill="${hair}" stroke="${trim}" stroke-width="0.5"/>`
            : '';

  const collarAccent = profile.modularTraits?.collarAccent;
  const collarAccentSvg = collarAccent === 'winged-pauldrons'
    ? `<path d="M22 75L14 67L24 69L28 77Z" fill="${trim}" stroke="#ffffff" stroke-width="0.5"/><path d="M80 75L88 67L78 69L74 77Z" fill="${trim}" stroke="#ffffff" stroke-width="0.5"/>`
    : collarAccent === 'spiked-guard'
      ? `<path d="M20 74L16 68L22 70L21 64L25 71Z" fill="${trim}"/><path d="M82 74L86 68L80 70L81 64L77 71Z" fill="${trim}"/>`
      : collarAccent === 'fur-trim'
        ? `<path d="M30 67Q51 76 72 67Q75 73 70 78Q51 86 32 78Q27 73 30 67Z" fill="#e5e7eb" stroke="${trim}" stroke-width="0.8"/>`
        : collarAccent === 'epaulette-tassels'
          ? `<path d="M19 74L29 71L27 76L17 79Z" fill="${trim}"/><path d="M18 79L18 85M21 78L21 86M24 77L24 85" stroke="${trim}" stroke-width="1.2"/><path d="M83 74L73 71L75 76L85 79Z" fill="${trim}"/><path d="M84 79L84 85M81 78L81 86M78 77L78 85" stroke="${trim}" stroke-width="1.2"/>`
          : collarAccent === 'stole-brooch'
            ? `<circle cx="51" cy="67" r="3" fill="${trim}" stroke="#ffffff" stroke-width="0.8"/><path d="M48 70L46 88M54 70L56 88" stroke="${trim}" stroke-width="2"/>`
            : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 104" role="img"><rect width="104" height="104" rx="52" fill="#111827"/><circle cx="52" cy="52" r="46" fill="#1d2839" stroke="${trim}" stroke-width="1.5"/><path d="M17 101L23 78Q29 66 44 64L59 64Q76 67 84 80L91 103Z" fill="${cloth}" stroke="${trim}" stroke-width="2"/><ellipse cx="51" cy="41" rx="16" ry="22" fill="${skin}"/><path d="M46 44L48 44M58 44L60 44M51 48L50 53L54 53M47 59Q52 62 57 58" stroke="#695044" stroke-width="1.4" fill="none"/>${faceAccentSvg}${silhouette[style]}${collar}${collarAccentSvg}${headwearAccentSvg}${relic}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function withPortrait(profile: VesselAppearanceProfile): VesselAppearanceProfile {
  return { ...profile, portraitSvgDataUri: createVesselPortraitSvg(profile) };
}

const registry = new Map(HISTORICAL_AGENTS.map((agent) => [agent.key, agent]));
const romanticAgents = new Set([
  'lewis-carroll', 'oscar-wilde', 'fyodor-dostoevsky', 'jane-austen',
  'charles-dickens-1812', 'edgar-allan-poe-1809', 'mark-twain-1835',
]);

function periodFor(agentId: string): VesselEra {
  if (romanticAgents.has(agentId)) return 'romantic';
  if (agentId === 'wolfgang-mozart') return 'enlightenment';
  const sourceEra = registry.get(agentId)?.era.toLowerCase();
  switch (sourceEra) {
    case 'ancient': return 'ancient';
    case 'medieval':
    case 'renaissance': return 'renaissance';
    case 'enlightenment': return 'enlightenment';
    case 'industrial':
    case 'modern': return 'modern';
    default: return 'astral';
  }
}

function seedFor(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function factionGarment(hex: string, seed: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  const dim = 0.22 + (seed % 15) / 100;
  return `#${[16, 8, 0].map((shift) => Math.round(((value >> shift) & 255) * dim + 13).toString(16).padStart(2, '0')).join('')}`;
}

export function mixModularTraits(agentId: string, era?: VesselEra, seed?: number): VesselModularTraits {
  const s = seed ?? seedFor(`${agentId}|modular_traits`);
  let headwear: HeadwearAccent = HEADWEAR_ACCENTS[s % HEADWEAR_ACCENTS.length];
  let collarPauldron: CollarPauldronAccent = COLLAR_PAULDRON_ACCENTS[(s >>> 3) % COLLAR_PAULDRON_ACCENTS.length];
  let face: FaceAccent = FACE_ACCENTS[(s >>> 6) % FACE_ACCENTS.length];
  let offHand: OffHandAccessory = OFF_HAND_ACCESSORIES[(s >>> 9) % OFF_HAND_ACCESSORIES.length];

  if (/spectacle|optics|scholar|mathematician|scribe|poet/i.test(agentId)) {
    if ((s % 2) === 0) face = 'wire-spectacles';
  } else if (/monocle|wit|critic|aristocrat/i.test(agentId)) {
    face = 'scholar-monocle';
  } else if (/philosopher|sage|hermit|prophet/i.test(agentId)) {
    face = 'philosopher-beard';
  } else if (/mystic|alchemist|oracle|priestess/i.test(agentId)) {
    face = 'mystic-veil';
  }

  if (/warrior|emperor|caesar|knight|conqueror/i.test(agentId)) {
    collarPauldron = 'winged-pauldrons';
    headwear = 'crown-spikes';
  } else if (/diplomat|statesman|chancellor/i.test(agentId)) {
    collarPauldron = 'fur-trim';
  }

  if (/writer|author|dramatist|poet/i.test(agentId)) {
    if (offHand === 'none') offHand = 'parchment-scroll';
  } else if (/astronom|cosmol|navigator|astrolog/i.test(agentId)) {
    if (offHand === 'none') offHand = 'alchemical-compass';
  } else if (/scholar|historian|philosopher/i.test(agentId)) {
    if (offHand === 'none') offHand = 'astral-codex';
  }

  return {
    headwearAccent: headwear,
    collarPauldronAccent: collarPauldron,
    faceAccent: face,
    offHandAccessory: offHand,
  };
}

function deriveAppearance(agentId: string, faction?: number, archetype?: string | { title: string }): VesselAppearanceProfile {
  const agent = registry.get(agentId);
  const era = periodFor(agentId);
  const factionId = faction ?? agent?.faction ?? 0;
  const title = typeof archetype === 'string' ? archetype : archetype?.title ?? agent?.title ?? 'Astral Vessel';
  const seed = seedFor(`${agentId}|${factionId}|${era}|${title}`);
  const trim = PLANET_COLORS[factionId] ?? PLANET_COLORS[0];
  const medieval = agent?.era === 'Medieval';

  // Intelligent crown style derivation based on persona, era and specialization
  let crownStyle: VesselCrownStyle = 'astral-helm';
  if (era === 'ancient') {
    crownStyle = /king|emperor|caesar|alexander/i.test(agentId) ? 'laurel-wreath'
      : /buddha|siddhartha/i.test(agentId) ? 'buddha-ushnisha-topknot'
        : /cleopatra/i.test(agentId) ? 'cleopatra-nemes-uraeus'
          : /philosophy|socrates|plato|aristotle/i.test(title + agentId) ? 'laurel-wreath'
            : 'scholar-hood';
  } else if (era === 'renaissance' || medieval) {
    crownStyle = /joan/i.test(agentId) ? 'joan-battle-bob'
      : /shakespeare/i.test(agentId) ? 'shakespeare-ruff-ringlets'
        : /da-vinci|leonardo|artist|sculpt/i.test(title + agentId) ? 'da-vinci-beret-beard'
          : 'scholar-hood';
  } else if (era === 'enlightenment') {
    crownStyle = 'newton-curls';
  } else if (era === 'romantic') {
    crownStyle = /poet|dickinson/i.test(agentId + title) ? 'dickinson-parted-bun'
      : /darwin/i.test(agentId) ? 'darwin-naturalist-beard'
        : 'scholar-hood';
  } else if (era === 'modern') {
    crownStyle = /curie|angelou|roosevelt|maathai|kahlo/i.test(agentId)
      ? (agentId === 'frida-kahlo' ? 'kahlo-floral-braid' : 'curie-edwardian-updo')
      : /einstein/i.test(agentId)
        ? 'einstein-wild-halo'
        : 'tesla-parted-mustache';
  } else if (era === 'astral') {
    crownStyle = /sovereign|solar|crown|lead/i.test(title) ? 'sovereign-crest' : 'astral-helm';
  }

  // Intelligent garment style derivation
  let mantleStyle: VesselMantleStyle = 'alchemical-vestments';
  if (era === 'ancient') {
    mantleStyle = /buddha/i.test(agentId) ? 'saffron-monk-robe' : 'scholar-robe';
  } else if (era === 'renaissance' || medieval) {
    mantleStyle = /joan/i.test(agentId) ? 'plate-armor-cuirass'
      : /shakespeare/i.test(agentId) ? 'elizabethan-doublet'
        : medieval ? 'scholar-robe' : 'renaissance-drape';
  } else if (era === 'enlightenment') {
    mantleStyle = 'enlightenment-coat';
  } else if (era === 'romantic') {
    mantleStyle = /dickinson/i.test(agentId) ? 'victorian-shawl' : 'enlightenment-coat';
  } else if (era === 'modern') {
    mantleStyle = /curie/i.test(agentId) ? 'edwardian-high-dress'
      : /kahlo/i.test(agentId) ? 'tehuana-huipil-shawl'
        : /einstein/i.test(agentId) ? 'knit-professor-sweater'
          : 'victorian-frock-coat';
  }

  // Collar style
  let collarStyle: VesselCollarStyle = 'none';
  if (era === 'enlightenment') {
    collarStyle = 'high-cravat';
  } else if (era === 'renaissance') {
    collarStyle = /shakespeare/i.test(agentId) ? 'elizabethan-ruff'
      : /joan/i.test(agentId) ? 'plate-gorget'
        : !medieval ? 'renaissance-collar' : 'none';
  } else if (era === 'romantic') {
    collarStyle = /dickinson/i.test(agentId) ? 'lace-tippet' : 'high-cravat';
  } else if (era === 'modern') {
    collarStyle = /curie/i.test(agentId) ? 'lace-tippet'
      : /kahlo/i.test(agentId) ? 'none'
        : 'wing-collar';
  } else if (era === 'astral') {
    collarStyle = 'astral-gorget';
  }

  // Signature relic
  let signatureRelic: VesselSignatureRelic = 'solar-astrolabe';
  if (/tesla|electric|energy/i.test(title + agentId)) {
    signatureRelic = 'tesla-induction-coil';
  } else if (/einstein|relativity|space|physics/i.test(title + agentId)) {
    signatureRelic = 'relativity-geodesic-ring';
  } else if (/curie|radium|chem/i.test(title + agentId)) {
    signatureRelic = 'radium-phial-luminary';
  } else if (/kahlo|heart|paint/i.test(title + agentId)) {
    signatureRelic = 'retablo-sacred-heart';
  } else if (/shakespeare|playwright|poet|writer|liter/i.test(title + agentId)) {
    signatureRelic = /dickinson|quill.*lantern/i.test(agentId) ? 'herbarium-quill-lantern' : 'quill-and-first-folio';
  } else if (/darwin|natural|biol|evolution/i.test(title + agentId)) {
    signatureRelic = 'beagle-naturalist-specimen';
  } else if (/joan|knight|battle|war/i.test(title + agentId)) {
    signatureRelic = 'saintly-oriflamme-banner';
  } else if (/math|prism|optic/i.test(title + agentId)) {
    signatureRelic = 'prism-octahedron';
  } else if (/art|invent|polymath|leonardo/i.test(title + agentId)) {
    signatureRelic = 'vitruvian-gyroscope';
  } else if (/poet|botan|mystic/i.test(title)) {
    signatureRelic = 'herbarium-quill-lantern';
  }

  const lowerBodyStyle: VesselLowerBodyStyle = mantleStyle === 'plate-armor-cuirass' ? 'armored-cuisses'
    : (mantleStyle === 'victorian-frock-coat' || mantleStyle === 'enlightenment-coat' || mantleStyle === 'knit-professor-sweater' || mantleStyle === 'elizabethan-doublet') ? 'trousers-boots'
    : (era === 'ancient' && mantleStyle !== 'saffron-monk-robe' && mantleStyle !== 'scholar-robe') ? 'tunic-greaves'
    : mantleStyle === 'alchemical-vestments' ? 'armored-cuisses'
    : 'full-robe';

  const modularTraits = mixModularTraits(agentId, era, seed);

  return withPortrait({
    era,
    headSilhouette: {
      crownStyle,
      faceProportion: { jawWidth: 0.84 + (seed % 23) / 100, browDepth: 0.9 + ((seed >>> 5) % 25) / 100, cranialHeight: 0.96 + ((seed >>> 10) % 20) / 100 },
    },
    garmentSilhouette: { mantleStyle, collarStyle },
    lowerBodyStyle,
    signatureRelic,
    modularTraits,
    paletteOverrides: {
      primaryGarmentHex: factionGarment(trim, seed),
      secondaryTrimHex: trim,
      hairOrCrownHex: era === 'enlightenment' ? '#cec4b6' : ['#b9c5ca', '#c6b58a', '#848c9d'][seed % 3],
      skinOrMaterialToneHex: ['#b4c8ce', '#c6c3ad', '#acb5ca'][seed % 3],
    },
  });
}

/** All 71 registry entries plus the custom pilot; generated entries are period-inspired vessels. */
export const VESSEL_APPEARANCE_MANIFEST: Record<string, VesselAppearanceProfile> = Object.fromEntries([
  ...HISTORICAL_AGENTS.map((agent) => [agent.key, deriveAppearance(agent.key)]),
  ...Object.entries(pilotDefinitions).map(([key, profile]) => {
    const withTraits = {
      ...profile,
      modularTraits: profile.modularTraits ?? mixModularTraits(key, profile.era),
    };
    return [key, withPortrait(withTraits)];
  }),
]);

/** Resolve independent profile values, so one vessel's customization cannot mutate another. */
export function resolveAgentAppearance(
  agentId: string,
  faction?: number,
  archetype?: string | { title: string },
): VesselAppearanceProfile {
  const profile = Object.hasOwn(pilotDefinitions, agentId)
    ? VESSEL_APPEARANCE_MANIFEST[agentId]
    : faction === undefined && archetype === undefined && Object.hasOwn(VESSEL_APPEARANCE_MANIFEST, agentId)
      ? VESSEL_APPEARANCE_MANIFEST[agentId]
      : deriveAppearance(agentId, faction, archetype);
  if (!profile.modularTraits) {
    profile.modularTraits = mixModularTraits(agentId, profile.era);
  }
  return structuredClone(profile);
}

/**
 * Non-blocking manifest probe that checks if an authored .glb model is configured for the agent.
 */
export function probeAuthoredModelUrl(agentId: string): string | undefined {
  return VESSEL_APPEARANCE_MANIFEST[agentId]?.avatarModelUrl;
}

/**
 * Register or override an authored .glb model asset URL for an agent profile.
 */
export function registerAuthoredModel(agentId: string, modelUrl: string): void {
  if (VESSEL_APPEARANCE_MANIFEST[agentId]) {
    VESSEL_APPEARANCE_MANIFEST[agentId].avatarModelUrl = modelUrl;
  }
  if (pilotDefinitions[agentId]) {
    pilotDefinitions[agentId].avatarModelUrl = modelUrl;
  }
}
