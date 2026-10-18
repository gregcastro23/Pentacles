import { HISTORICAL_AGENTS, PLANET_COLORS } from '../../alchm-chart/historical-agents.js';

export type VesselEra = 'ancient' | 'renaissance' | 'enlightenment' | 'romantic' | 'modern' | 'astral';
export type VesselCrownStyle = 'newton-curls' | 'da-vinci-beret-beard' | 'dickinson-parted-bun' | 'sovereign-crest' | 'laurel-wreath' | 'scholar-hood' | 'astral-helm';
export type VesselMantleStyle = 'enlightenment-coat' | 'renaissance-drape' | 'victorian-shawl' | 'alchemical-vestments' | 'scholar-robe';
export type VesselCollarStyle = 'high-cravat' | 'renaissance-collar' | 'lace-tippet' | 'astral-gorget' | 'none';
export type VesselSignatureRelic = 'prism-octahedron' | 'vitruvian-gyroscope' | 'herbarium-quill-lantern' | 'solar-astrolabe';

export interface VesselAppearanceProfile {
  era: VesselEra;
  headSilhouette: {
    crownStyle: VesselCrownStyle;
    faceProportion: { jawWidth: number; browDepth: number; cranialHeight: number };
  };
  garmentSilhouette: { mantleStyle: VesselMantleStyle; collarStyle: VesselCollarStyle };
  signatureRelic: VesselSignatureRelic;
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
};

const pilotDefinitions: Record<string, VesselAppearanceProfile> = {
  'isaac-newton': {
    era: 'enlightenment',
    headSilhouette: { crownStyle: 'newton-curls', faceProportion: { jawWidth: 0.86, browDepth: 1.14, cranialHeight: 1.08 } },
    garmentSilhouette: { mantleStyle: 'enlightenment-coat', collarStyle: 'high-cravat' },
    signatureRelic: 'prism-octahedron',
    paletteOverrides: { primaryGarmentHex: '#481f32', secondaryTrimHex: '#d8c4a0', hairOrCrownHex: '#d6c9b5', skinOrMaterialToneHex: '#e8c7a5' },
  },
  'leonardo-da-vinci': {
    era: 'renaissance',
    headSilhouette: { crownStyle: 'da-vinci-beret-beard', faceProportion: { jawWidth: 1.04, browDepth: 1.16, cranialHeight: 1.04 } },
    garmentSilhouette: { mantleStyle: 'renaissance-drape', collarStyle: 'renaissance-collar' },
    signatureRelic: 'vitruvian-gyroscope',
    paletteOverrides: { primaryGarmentHex: '#302b68', secondaryTrimHex: '#deb968', hairOrCrownHex: '#c6bba6', skinOrMaterialToneHex: '#d6af8a' },
  },
  'emily-dickinson': {
    era: 'romantic',
    headSilhouette: { crownStyle: 'dickinson-parted-bun', faceProportion: { jawWidth: 0.8, browDepth: 0.88, cranialHeight: 1.16 } },
    garmentSilhouette: { mantleStyle: 'victorian-shawl', collarStyle: 'lace-tippet' },
    signatureRelic: 'herbarium-quill-lantern',
    paletteOverrides: { primaryGarmentHex: '#ece6d8', secondaryTrimHex: '#bfcfbd', hairOrCrownHex: '#653a2c', skinOrMaterialToneHex: '#e6bea2' },
  },
  'user-avatar-neo': {
    era: 'astral',
    headSilhouette: { crownStyle: 'sovereign-crest', faceProportion: { jawWidth: 1.02, browDepth: 1.1, cranialHeight: 1.1 } },
    garmentSilhouette: { mantleStyle: 'alchemical-vestments', collarStyle: 'astral-gorget' },
    signatureRelic: 'solar-astrolabe',
    paletteOverrides: { primaryGarmentHex: '#171b2c', secondaryTrimHex: '#efc45c', hairOrCrownHex: '#e5bd66', skinOrMaterialToneHex: '#a4bcc7' },
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
    'newton-curls': `<path d="M37 51Q28 40 33 27Q38 13 51 18Q66 11 72 28L75 59L65 66L62 36L43 34L43 66L31 60Z" fill="${hair}"/>${[32, 39, 46, 53, 60].map((y, i) => `<circle cx="${34 - i % 2}" cy="${y}" r="6" fill="${hair}"/><circle cx="70" cy="${y}" r="6" fill="${hair}"/>`).join('')}`,
    'da-vinci-beret-beard': `<path d="M32 32Q27 15 49 13Q68 10 76 25L69 34Z" fill="${cloth}"/><path d="M34 31L70 29" stroke="${trim}" stroke-width="4"/><path d="M38 47Q50 59 65 46L62 67L51 79L40 65Z" fill="${hair}"/><path d="M40 52L45 67M49 56L51 72M58 53L57 66" stroke="${trim}" stroke-width="1"/>`,
    'dickinson-parted-bun': `<circle cx="70" cy="40" r="11" fill="${hair}"/><path d="M33 40Q28 18 49 18Q69 17 68 41L60 35L51 24L40 37Z" fill="${hair}"/><path d="M50 20L50 31" stroke="${skin}" stroke-width="2"/>`,
    'sovereign-crest': `<path d="M32 33L28 18L42 24L51 8L60 24L74 18L69 36Z" fill="${hair}"/><path d="M35 31L67 31" stroke="${trim}" stroke-width="4"/><path d="M51 15L55 26L51 32L47 26Z" fill="#e6fbff"/>`,
    'laurel-wreath': `<path d="M34 47Q22 26 47 17M65 47Q79 27 55 17" fill="none" stroke="${hair}" stroke-width="5"/>${[0, 1, 2, 3].map((i) => `<ellipse cx="${31 + i * 4}" cy="${37 - i * 6}" rx="6" ry="3" fill="${trim}" transform="rotate(-35 ${31 + i * 4} ${37 - i * 6})"/><ellipse cx="${69 - i * 4}" cy="${37 - i * 6}" rx="6" ry="3" fill="${trim}" transform="rotate(35 ${69 - i * 4} ${37 - i * 6})"/>`).join('')}`,
    'scholar-hood': `<path d="M27 63L27 33Q29 13 50 12Q73 16 75 36L74 65L63 57L65 34L49 24L36 36L38 58Z" fill="${cloth}" stroke="${trim}" stroke-width="2"/>`,
    'astral-helm': `<path d="M31 42L32 23L50 10L69 23L71 43L63 49L62 32L50 23L40 33L39 49Z" fill="${hair}" stroke="${trim}" stroke-width="2"/><path d="M50 13L50 25" stroke="#e6fbff" stroke-width="3"/>`,
  };
  const collar = profile.garmentSilhouette.collarStyle === 'lace-tippet'
    ? `<path d="M27 70L44 61L51 69L59 61L76 70L61 80L51 73L40 80Z" fill="#fff9ec" stroke="${trim}"/>`
    : profile.garmentSilhouette.collarStyle === 'high-cravat'
      ? '<path d="M43 60L61 60L57 69L61 81L49 78L43 69Z" fill="#fff9ec"/>'
      : `<path d="M36 64L51 72L66 64" fill="none" stroke="${trim}" stroke-width="5"/>`;
  const relic = profile.signatureRelic === 'prism-octahedron'
    ? '<path d="M80 71L87 81L80 91L73 81Z" fill="#a6ecff" stroke="#ffffff"/><path d="M87 81L96 75M87 81L97 81M87 81L96 87" stroke="#d8b46a"/>'
    : profile.signatureRelic === 'herbarium-quill-lantern'
      ? `<path d="M79 71L87 76L86 88L74 88L73 76Z" fill="${trim}"/><path d="M79 84L81 75M80 81L75 78M80 79L85 77" stroke="#3b6d53" stroke-width="2"/>`
      : `<g fill="none" stroke="${trim}" stroke-width="2"><circle cx="81" cy="81" r="10"/><ellipse cx="81" cy="81" rx="4" ry="10"/><path d="M70 81L92 81M81 70L81 92"/></g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 104" role="img"><rect width="104" height="104" rx="52" fill="#111827"/><circle cx="52" cy="52" r="46" fill="#1d2839" stroke="${trim}" stroke-width="1.5"/><path d="M17 101L23 78Q29 66 44 64L59 64Q76 67 84 80L91 103Z" fill="${cloth}" stroke="${trim}" stroke-width="2"/><ellipse cx="51" cy="41" rx="16" ry="22" fill="${skin}"/><path d="M46 44L48 44M58 44L60 44M51 48L50 53L54 53M47 59Q52 62 57 58" stroke="#695044" stroke-width="1.4" fill="none"/>${silhouette[style]}${collar}${relic}</svg>`;
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
    // The schema has no medieval category; retain its hood/robe dress vocabulary below.
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

function deriveAppearance(agentId: string, faction?: number, archetype?: string | { title: string }): VesselAppearanceProfile {
  const agent = registry.get(agentId);
  const era = periodFor(agentId);
  const factionId = faction ?? agent?.faction ?? 0;
  const title = typeof archetype === 'string' ? archetype : archetype?.title ?? agent?.title ?? 'Astral Vessel';
  const seed = seedFor(`${agentId}|${factionId}|${era}|${title}`);
  const trim = PLANET_COLORS[factionId] ?? PLANET_COLORS[0];
  const medieval = agent?.era === 'Medieval';
  const crownStyle: VesselCrownStyle = era === 'ancient' ? 'laurel-wreath'
    : medieval || era === 'renaissance' ? 'scholar-hood'
      : era === 'enlightenment' ? 'newton-curls'
        : era === 'astral' && /sovereign|solar|crown|lead/i.test(title) ? 'sovereign-crest'
          : era === 'romantic' ? 'scholar-hood' : 'astral-helm';
  const mantleStyle: VesselMantleStyle = medieval || era === 'ancient' ? 'scholar-robe'
    : era === 'renaissance' ? 'renaissance-drape'
      : era === 'enlightenment' || era === 'romantic' ? 'enlightenment-coat' : 'alchemical-vestments';
  const collarStyle: VesselCollarStyle = era === 'enlightenment' || era === 'romantic' ? 'high-cravat'
    : era === 'renaissance' && !medieval ? 'renaissance-collar'
      : era === 'ancient' || medieval ? 'none' : 'astral-gorget';
  const relics: VesselSignatureRelic[] = ['prism-octahedron', 'vitruvian-gyroscope', 'herbarium-quill-lantern', 'solar-astrolabe'];
  const signatureRelic: VesselSignatureRelic = /poet|botan|liter|love|mystic/i.test(title) ? 'herbarium-quill-lantern'
    : /math|science|physic/i.test(title) ? 'prism-octahedron'
      : /art|invent|engineer|polymath/i.test(title) ? 'vitruvian-gyroscope' : relics[seed % relics.length];
  return withPortrait({
    era,
    headSilhouette: {
      crownStyle,
      faceProportion: { jawWidth: 0.84 + (seed % 23) / 100, browDepth: 0.9 + ((seed >>> 5) % 25) / 100, cranialHeight: 0.96 + ((seed >>> 10) % 20) / 100 },
    },
    garmentSilhouette: { mantleStyle, collarStyle },
    signatureRelic,
    paletteOverrides: {
      primaryGarmentHex: factionGarment(trim, seed),
      secondaryTrimHex: trim,
      hairOrCrownHex: era === 'enlightenment' ? '#cec4b6' : ['#b9c5ca', '#c6b58a', '#848c9d'][seed % 3],
      // Unauthored agents use astral material tones rather than invented portrait skin colors.
      skinOrMaterialToneHex: ['#b4c8ce', '#c6c3ad', '#acb5ca'][seed % 3],
    },
  });
}

/** All 71 registry entries plus the custom pilot; generated entries are period-inspired vessels. */
export const VESSEL_APPEARANCE_MANIFEST: Record<string, VesselAppearanceProfile> = Object.fromEntries(
  [
    ...HISTORICAL_AGENTS.map((agent) => [agent.key, deriveAppearance(agent.key)]),
    ...Object.entries(pilotDefinitions).map(([key, profile]) => [key, withPortrait(profile)]),
  ],
);

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
  return structuredClone(profile);
}
