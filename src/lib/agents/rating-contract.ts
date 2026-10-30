/**
 * ============================================================================
 * Pentacles — Vessel Rating, Archetype, Alchemical Seals & Resonance Surge
 * Synchronized with planetary-agents (ASOL / PR #59 revision)
 * ============================================================================
 * 
 * Strict TypeScript contract and calculation engine for the Pentacle Vessel
 * Rating Scale (25–99), Ordered Weighted Averaging (OWA) OVR calculation,
 * relative advantage archetypes, ESMS Alchemical Seals, and live ephemeris
 * Resonance Surge ignition.
 */

import type { VesselAppearanceProfile } from './vessel-appearance-manifest';

export const SACRED_STAT_KEYS = [
  'power',
  'resonance',
  'wisdom',
  'charisma',
  'intuition',
  'adaptability',
  'vitality',
] as const;

export type SacredStatKey = (typeof SACRED_STAT_KEYS)[number];
/** Compatibility alias for rendering consumers; the seven canonical keys remain authoritative. */
export type SacredStat = SacredStatKey;

export const ESMS_KEYS = ['spirit', 'essence', 'matter', 'substance'] as const;
export type EsmsKey = (typeof ESMS_KEYS)[number];

export const SEAL_TIERS = [
  'Copper',
  'Silver',
  'Gold',
  'Astral',
  'Celestial',
] as const;

export type SealTier = (typeof SEAL_TIERS)[number];

export type SurgeType = 'inferno' | 'tempest' | 'equilibrium';
export type MonicaState = 'absent' | 'equilibrium' | 'convergent' | 'divergent';

export interface EsmsBalances {
  spirit: number;
  essence: number;
  matter: number;
  substance: number;
}

export interface VesselArchetype {
  title: string;
  primary: SacredStatKey;
  secondary: SacredStatKey;
}

export interface AlchemicalSeal {
  id: string;
  name: string;
  category: EsmsKey | 'general';
  tier: SealTier;
  description: string;
  statKey?: SacredStatKey;
  multiplier: number;
}

export interface ResonanceSurgeState {
  meter: number; // 0..100 linear p5-to-p95 ramp of normalized heat & reactivity
  active: boolean; // triggers at meter >= 70 (~6% of real sky epochs)
  surgeType: SurgeType;
  monica: number | null;
  monicaState: MonicaState;
  heat: number;
  reactivity: number;
  statBoosts: Partial<Record<SacredStatKey, number>>;
}

export interface RatedAgentPayload {
  ratingSource?: 'live';
  /** Present only for the live court; absent on explicitly selected examples. */
  ratingFeed?: {
    sourceKey: string;
    receivedAt: number;
    esmsAvailable: boolean;
    skyAvailable: boolean;
  };
  key: string;
  handle: string;
  faction: number; // 0..9 planet index
  factionName: string;
  isPlaceholder?: boolean;
  provenance?: 'historical' | 'user' | 'placeholder';
  appearance?: VesselAppearanceProfile;
  avatarModelUrl?: string;
  headMeshUrl?: string;
  ratings: Record<SacredStatKey, number>; // [25, 99] raw scale
  relativeAdvantage: Record<SacredStatKey, number>; // delta against pinned roster baseline
  ovr: number; // [25, 99] via OWA (1.6 top, 1.3 second, 1.0 rest)
  archetype: VesselArchetype;
  esms: EsmsBalances;
  seals: AlchemicalSeal[];
  surge: ResonanceSurgeState;
}

/** Pinned 71-agent roster baseline ratings and means */
export const ROSTER_BASELINE_RATINGS: Record<SacredStatKey, { mean: number; baseline: number }> = Object.freeze({
  power: { mean: 76.5, baseline: 63 },
  resonance: { mean: 67.0, baseline: 62 },
  wisdom: { mean: 68.5, baseline: 64 },
  charisma: { mean: 64.5, baseline: 61 },
  intuition: { mean: 66.0, baseline: 62 },
  adaptability: { mean: 67.5, baseline: 63 },
  vitality: { mean: 66.0, baseline: 62 },
});

export const GLOBAL_ROSTER_MEAN = 68.0;

/** Seal stat gating thresholds */
export const SEAL_STAT_GATES: Record<SealTier, number> = Object.freeze({
  Copper: 74,
  Silver: 80,
  Gold: 86,
  Astral: 91,
  Celestial: 96,
});

/** Exact planetary-agents ESMS balance gates (0.5 – 250.0 ESMS) */
export const SEAL_ESMS_GATES: Record<SealTier, number> = Object.freeze({
  Copper: 0.5,
  Silver: 2.0,
  Gold: 10.0,
  Astral: 50.0,
  Celestial: 250.0,
});

/** Multipliers applied to contested duel/tile interactions per seal tier */
export const SEAL_TIER_MULTIPLIERS: Record<SealTier, number> = Object.freeze({
  Copper: 1.05,
  Silver: 1.10,
  Gold: 1.18,
  Astral: 1.28,
  Celestial: 1.40,
});

/** Canonical 7 Alchemical Seals mapped to Sacred Stats */
export const CANONICAL_SEAL_CATALOG: Record<
  SacredStatKey,
  { name: string; category: EsmsKey; description: string }
> = Object.freeze({
  power: {
    name: 'Crucible Finisher',
    category: 'substance',
    description: 'Channels raw material pressure into irresistible decisive force.',
  },
  intuition: {
    name: 'Astral Vision',
    category: 'spirit',
    description: 'Pierces through veil illusions with sovereign foresight.',
  },
  vitality: {
    name: 'Immovable Foundation',
    category: 'matter',
    description: 'Anchors vessel integrity against territorial disruption.',
  },
  charisma: {
    name: 'Harmonic Sovereign',
    category: 'essence',
    description: 'Commands celestial resonance to align allied forces.',
  },
  resonance: {
    name: 'Tidal Chorus',
    category: 'essence',
    description: 'Attunes with the ambient frequencies of celestial transits.',
  },
  adaptability: {
    name: 'Quicksilver Pivot',
    category: 'spirit',
    description: 'Transmutes tactical posture across shifting court elements.',
  },
  wisdom: {
    name: 'Philosopher\'s Stone',
    category: 'matter',
    description: 'Transforms accumulated experience into strategic mastery.',
  },
});

/** Canonical Vessel Archetype titles mapped by primary + secondary signature stats */
const ARCHETYPE_TITLE_MATRIX: Record<string, string> = {
  'power:vitality': 'Juggernaut Anchor',
  'power:resonance': 'Kinetic Resonator',
  'power:wisdom': 'Celestial Mechanist',
  'power:charisma': 'Dominant Commander',
  'power:intuition': 'Instinctive Striker',
  'power:adaptability': 'Dynamic Breaker',

  'resonance:intuition': 'Harmonic Seer',
  'resonance:wisdom': 'Synthesizing Sage',
  'resonance:power': 'Astral Striker',
  'resonance:charisma': 'Symphonic Virtuoso',
  'resonance:adaptability': 'Fluid Harmonizer',
  'resonance:vitality': 'Resilient Prism',

  'wisdom:power': 'Celestial Mechanist',
  'wisdom:adaptability': 'Polymath Craftsman',
  'wisdom:resonance': 'Universal Theorist',
  'wisdom:intuition': 'Illuminated Sage',
  'wisdom:charisma': 'Enlightened Statesman',
  'wisdom:vitality': 'Ancient Pillar',

  'charisma:power': 'Apex Sovereign',
  'charisma:wisdom': 'Inspiring Luminary',
  'charisma:intuition': 'Magnetic Visionary',
  'charisma:resonance': 'Resonant Herald',
  'charisma:adaptability': 'Charismatic Catalyst',
  'charisma:vitality': 'Indomitable Leader',

  'intuition:resonance': 'Reclusive Visionary',
  'intuition:wisdom': 'Mystic Oracle',
  'intuition:power': 'Prescient Ingressor',
  'intuition:charisma': 'Prophetic Guide',
  'intuition:adaptability': 'Intuitive Shifter',
  'intuition:vitality': 'Eternal Vigilant',

  'adaptability:wisdom': 'Polymath Craftsman',
  'adaptability:intuition': 'Quicksilver Weaver',
  'adaptability:power': 'Tactical Marauder',
  'adaptability:resonance': 'Harmonic Pivot',
  'adaptability:charisma': 'Diplomatic Emissary',
  'adaptability:vitality': 'Unshakable Survivor',

  'vitality:power': 'Ironbound Guardian',
  'vitality:wisdom': 'Enduring Sentinel',
  'vitality:resonance': 'Stalwart Conduit',
  'vitality:intuition': 'Steadfast Bastion',
  'vitality:charisma': 'Tenacious Champion',
  'vitality:adaptability': 'Adaptive Fortress',
};

/**
 * Clamp a stat value onto integer scale [25, 99].
 */
export function clampStat(val: number): number {
  if (Number.isNaN(val) || !Number.isFinite(val)) return 25;
  return Math.max(25, Math.min(99, Math.round(val)));
}

/**
 * Compute Overall (OVR) via Ordered Weighted Averaging (OWA).
 * Weights: top stat 1.6, second stat 1.3, remaining five stats 1.0 (mean of rest * 1.0).
 * Normalized by divisor 3.9 (1.6 + 1.3 + 1.0 = 3.9). Supports custom divisor via options.
 */
export function computeOvr(
  ratings: Record<SacredStatKey, number>,
  options?: { divisor?: number }
): number {
  const sorted = SACRED_STAT_KEYS
    .map((k) => clampStat(ratings[k] ?? 25))
    .sort((a, b) => b - a);

  const top1 = sorted[0];
  const top2 = sorted[1];
  const restAvg = sorted.slice(2).reduce((sum, v) => sum + v, 0) / 5;

  const divisor = options?.divisor ?? 3.9;
  const restVal = divisor === 7.9 ? restAvg * 5 : restAvg;
  const weightedSum = (top1 * 1.6) + (top2 * 1.3) + (restVal * 1.0);

  return clampStat(Math.round(weightedSum / divisor));
}

/**
 * Compute relative advantage delta against pinned roster baseline.
 */
export function computeRelativeAdvantage(
  ratings: Record<SacredStatKey, number>
): Record<SacredStatKey, number> {
  const res: Partial<Record<SacredStatKey, number>> = {};
  for (const key of SACRED_STAT_KEYS) {
    const raw = clampStat(ratings[key] ?? 25);
    const base = ROSTER_BASELINE_RATINGS[key]?.baseline ?? 62;
    res[key] = Math.round((raw - base) * 10) / 10;
  }
  return res as Record<SacredStatKey, number>;
}

/**
 * Resolve Archetype title and signature primary/secondary stats based on
 * relative advantage over baseline.
 */
export function resolveArchetype(
  relativeAdvantage: Record<SacredStatKey, number>
): VesselArchetype {
  const sorted = [...SACRED_STAT_KEYS].sort((a, b) => {
    const delta = (relativeAdvantage[b] ?? 0) - (relativeAdvantage[a] ?? 0);
    if (delta !== 0) return delta;
    return SACRED_STAT_KEYS.indexOf(a) - SACRED_STAT_KEYS.indexOf(b);
  });

  const primary = sorted[0];
  const secondary = sorted[1];
  const key = `${primary}:${secondary}`;
  const title = ARCHETYPE_TITLE_MATRIX[key] || `${capitalize(primary)}-${capitalize(secondary)} Specialist`;

  return { title, primary, secondary };
}

/**
 * Compute mean-aligned rating for a specific stat to prevent high-mean stats (like power)
 * from unlocking seals disproportionately.
 */
export function computeMeanAlignedRating(
  statKey: SacredStatKey,
  rawRating: number
): number {
  const statMean = ROSTER_BASELINE_RATINGS[statKey]?.mean ?? GLOBAL_ROSTER_MEAN;
  return rawRating - statMean + GLOBAL_ROSTER_MEAN;
}

/**
 * Evaluate seal tier given raw stat level, total ESMS holding, and provenance.
 * Uses mean-aligned stat evaluation.
 * Placeholder charts are strictly barred from Celestial.
 */
export function evaluateSealTier(
  statKey: SacredStatKey,
  rawStatScore: number,
  esmsBalance: number,
  isPlaceholder = false
): SealTier | null {
  const alignedScore = computeMeanAlignedRating(statKey, rawStatScore);

  const tiers: SealTier[] = ['Celestial', 'Astral', 'Gold', 'Silver', 'Copper'];
  for (const tier of tiers) {
    if (tier === 'Celestial' && isPlaceholder) continue;
    if (alignedScore >= SEAL_STAT_GATES[tier] && esmsBalance >= SEAL_ESMS_GATES[tier]) {
      return tier;
    }
  }
  return null;
}

/**
 * Determine monica state from telemetry monica value.
 */
export function determineMonicaState(monica: number | null | undefined): MonicaState {
  if (monica === null || monica === undefined) return 'absent';
  if (Math.abs(monica - 1.618) < 0.001) return 'equilibrium';
  if (monica > 0) return 'convergent';
  return 'divergent';
}

/**
 * Compute live resonance surge state from pre-computed telemetry inputs.
 * Never re-derives raw Kalchm thermodynamics; consumes meter, heat, reactivity, monica.
 */
export function evaluateSurgeState(
  meter: number,
  heat: number,
  reactivity: number,
  primaryStat: SacredStatKey,
  secondaryStat: SacredStatKey,
  monica: number | null = null
): ResonanceSurgeState {
  const clampedMeter = Math.max(0, Math.min(100, Math.round(meter)));
  const active = clampedMeter >= 70;
  const monicaState = determineMonicaState(monica);

  let surgeType: SurgeType;
  if (active && monicaState === 'equilibrium') {
    surgeType = 'equilibrium';
  } else if (heat >= reactivity) {
    surgeType = 'inferno';
  } else {
    surgeType = 'tempest';
  }

  const statBoosts: Partial<Record<SacredStatKey, number>> = {};
  if (active) {
    if (surgeType === 'equilibrium') {
      // Equilibrium applies both inferno and tempest boosts in harmony (+16 primary, +12 secondary, +8 all)
      for (const key of SACRED_STAT_KEYS) {
        if (key === primaryStat) {
          statBoosts[key] = 16;
        } else if (key === secondaryStat) {
          statBoosts[key] = 12;
        } else {
          statBoosts[key] = 8;
        }
      }
    } else {
      // Inferno or Tempest: primary receives +12, secondary receives +8, others receive +4
      for (const key of SACRED_STAT_KEYS) {
        if (key === primaryStat) {
          statBoosts[key] = 12;
        } else if (key === secondaryStat) {
          statBoosts[key] = 8;
        } else {
          statBoosts[key] = 4;
        }
      }
    }
  }

  return {
    meter: clampedMeter,
    active,
    surgeType,
    monica,
    monicaState,
    heat,
    reactivity,
    statBoosts,
  };
}

/**
 * Generate canonical seal object for an agent based on stat key and tier.
 */
export function buildCanonicalSeal(
  statKey: SacredStatKey,
  tier: SealTier
): AlchemicalSeal {
  const catalog = CANONICAL_SEAL_CATALOG[statKey];
  return {
    id: `seal-${statKey}`,
    name: catalog.name,
    category: catalog.category,
    tier,
    description: catalog.description,
    statKey,
    multiplier: SEAL_TIER_MULTIPLIERS[tier],
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ============================================================================
// Deterministic Fixture Data (3 Historical Vessels + 1 Custom User Vessel)
// ============================================================================

export const FIXTURE_AGENTS: RatedAgentPayload[] = [
  {
    key: 'isaac-newton',
    handle: 'Sir Isaac Newton',
    faction: 6, // Saturn
    factionName: 'Saturn',
    isPlaceholder: false,
    provenance: 'historical',
    ratings: {
      power: 84,
      resonance: 82,
      wisdom: 98,
      charisma: 72,
      intuition: 89,
      adaptability: 76,
      vitality: 88,
    },
    relativeAdvantage: {
      power: 21.0,
      resonance: 20.0,
      wisdom: 34.0,
      charisma: 11.0,
      intuition: 27.0,
      adaptability: 13.0,
      vitality: 26.0,
    },
    ovr: 94,
    archetype: {
      title: 'Celestial Mechanist',
      primary: 'wisdom',
      secondary: 'power',
    },
    esms: {
      spirit: 180.5,
      essence: 265.0,
      matter: 310.2,
      substance: 420.0,
    },
    seals: [
      {
        id: 'seal-wisdom',
        name: 'Philosopher\'s Stone',
        category: 'matter',
        tier: 'Celestial',
        description: 'Transforms accumulated experience into strategic mastery.',
        statKey: 'wisdom',
        multiplier: SEAL_TIER_MULTIPLIERS.Celestial,
      },
      {
        id: 'seal-intuition',
        name: 'Astral Vision',
        category: 'spirit',
        tier: 'Gold',
        description: 'Pierces through veil illusions with sovereign foresight.',
        statKey: 'intuition',
        multiplier: SEAL_TIER_MULTIPLIERS.Gold,
      },
      {
        id: 'seal-vitality',
        name: 'Immovable Foundation',
        category: 'matter',
        tier: 'Astral',
        description: 'Anchors vessel integrity against territorial disruption.',
        statKey: 'vitality',
        multiplier: SEAL_TIER_MULTIPLIERS.Astral,
      },
    ],
    surge: {
      meter: 58,
      active: false,
      surgeType: 'inferno',
      monica: null,
      monicaState: 'absent',
      heat: 0.62,
      reactivity: 0.44,
      statBoosts: {},
    },
  },
  {
    key: 'emily-dickinson',
    handle: 'Emily Dickinson',
    faction: 3, // Venus
    factionName: 'Venus',
    isPlaceholder: false,
    provenance: 'historical',
    ratings: {
      power: 68,
      resonance: 92,
      wisdom: 86,
      charisma: 78,
      intuition: 97,
      adaptability: 84,
      vitality: 75,
    },
    relativeAdvantage: {
      power: 5.0,
      resonance: 30.0,
      wisdom: 22.0,
      charisma: 17.0,
      intuition: 35.0,
      adaptability: 21.0,
      vitality: 13.0,
    },
    ovr: 88,
    archetype: {
      title: 'Reclusive Visionary',
      primary: 'intuition',
      secondary: 'resonance',
    },
    esms: {
      spirit: 220.0,
      essence: 340.5,
      matter: 95.0,
      substance: 190.0,
    },
    seals: [
      {
        id: 'seal-intuition',
        name: 'Astral Vision',
        category: 'spirit',
        tier: 'Celestial',
        description: 'Pierces through veil illusions with sovereign foresight.',
        statKey: 'intuition',
        multiplier: SEAL_TIER_MULTIPLIERS.Celestial,
      },
      {
        id: 'seal-resonance',
        name: 'Tidal Chorus',
        category: 'essence',
        tier: 'Astral',
        description: 'Attunes with the ambient frequencies of celestial transits.',
        statKey: 'resonance',
        multiplier: SEAL_TIER_MULTIPLIERS.Astral,
      },
    ],
    surge: {
      meter: 86,
      active: true,
      surgeType: 'tempest',
      monica: null,
      monicaState: 'absent',
      heat: 0.54,
      reactivity: 0.92,
      statBoosts: {
        intuition: 12,
        resonance: 8,
        power: 4,
        wisdom: 4,
        charisma: 4,
        adaptability: 4,
        vitality: 4,
      },
    },
  },
  {
    key: 'leonardo-da-vinci',
    handle: 'Leonardo da Vinci',
    faction: 5, // Jupiter
    factionName: 'Jupiter',
    isPlaceholder: false,
    provenance: 'historical',
    ratings: {
      power: 82,
      resonance: 94,
      wisdom: 96,
      charisma: 88,
      intuition: 93,
      adaptability: 98,
      vitality: 80,
    },
    relativeAdvantage: {
      power: 19.0,
      resonance: 32.0,
      wisdom: 32.0,
      charisma: 27.0,
      intuition: 31.0,
      adaptability: 35.0,
      vitality: 18.0,
    },
    ovr: 96,
    archetype: {
      title: 'Polymath Craftsman',
      primary: 'adaptability',
      secondary: 'wisdom',
    },
    esms: {
      spirit: 310.0,
      essence: 290.0,
      matter: 270.0,
      substance: 380.0,
    },
    seals: [
      {
        id: 'seal-adaptability',
        name: 'Quicksilver Pivot',
        category: 'spirit',
        tier: 'Celestial',
        description: 'Transmutes tactical posture across shifting court elements.',
        statKey: 'adaptability',
        multiplier: SEAL_TIER_MULTIPLIERS.Celestial,
      },
      {
        id: 'seal-wisdom',
        name: 'Philosopher\'s Stone',
        category: 'matter',
        tier: 'Celestial',
        description: 'Transforms accumulated experience into strategic mastery.',
        statKey: 'wisdom',
        multiplier: SEAL_TIER_MULTIPLIERS.Celestial,
      },
    ],
    surge: {
      meter: 78,
      active: true,
      surgeType: 'equilibrium',
      monica: 1.618,
      monicaState: 'equilibrium',
      heat: 0.74,
      reactivity: 0.74,
      statBoosts: {
        adaptability: 16,
        wisdom: 12,
        power: 8,
        resonance: 8,
        charisma: 8,
        intuition: 8,
        vitality: 8,
      },
    },
  },
  {
    key: 'user-avatar-neo',
    handle: 'Starfarer Neo',
    faction: 0, // Sun
    factionName: 'Sun',
    isPlaceholder: false,
    provenance: 'user',
    ratings: {
      power: 80,
      resonance: 76,
      wisdom: 79,
      charisma: 88,
      intuition: 82,
      adaptability: 84,
      vitality: 78,
    },
    relativeAdvantage: {
      power: 17.0,
      resonance: 14.0,
      wisdom: 15.0,
      charisma: 27.0,
      intuition: 20.0,
      adaptability: 21.0,
      vitality: 16.0,
    },
    ovr: 83,
    archetype: {
      title: 'Apex Sovereign',
      primary: 'charisma',
      secondary: 'adaptability',
    },
    esms: {
      spirit: 45.0,
      essence: 32.0,
      matter: 28.0,
      substance: 52.0,
    },
    seals: [
      {
        id: 'seal-charisma',
        name: 'Harmonic Sovereign',
        category: 'essence',
        tier: 'Gold',
        description: 'Commands celestial resonance to align allied forces.',
        statKey: 'charisma',
        multiplier: SEAL_TIER_MULTIPLIERS.Gold,
      },
      {
        id: 'seal-adaptability',
        name: 'Quicksilver Pivot',
        category: 'spirit',
        tier: 'Silver',
        description: 'Transmutes tactical posture across shifting court elements.',
        statKey: 'adaptability',
        multiplier: SEAL_TIER_MULTIPLIERS.Silver,
      },
    ],
    surge: {
      meter: 42,
      active: false,
      surgeType: 'inferno',
      monica: 0.45,
      monicaState: 'convergent',
      heat: 0.48,
      reactivity: 0.36,
      statBoosts: {},
    },
  },
];
