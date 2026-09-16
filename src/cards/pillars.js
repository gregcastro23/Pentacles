/**
 * The Fourteen Alchemical Pillars — Client Runtime
 * Derived from spec/pillars.v1.json (Zero drift).
 */

export const PILLAR_SPEC_VERSION = "1.0.0";
export const PILLAR_CONSTANTS = Object.freeze({
  "poolBaseline": 80,
  "castCharge": 10,
  "powerRef": 0.0086,
  "magnitudeMin": 0.25,
  "magnitudeMax": 2.0,
  "deltaScale": 1.25,
  "minPrimaryPlacements": 2,
  "minHand": 2,
  "roomResistanceFloor": 0.25,
  "epsilon": 1e-09,
  "tieTolerance": 1e-12
});
export const PILLARS = Object.freeze([
  {
    "id": 1,
    "key": "Solution",
    "name": "Solution",
    "effects": [
      -1,
      1,
      1,
      -1
    ],
    "primary": "Water",
    "secondary": "Earth",
    "sect": "nocturnal",
    "castMode": "target",
    "rulers": [
      "Moon",
      "Neptune"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 2,
    "key": "Filtration",
    "name": "Filtration",
    "effects": [
      1,
      1,
      -1,
      1
    ],
    "primary": "Air",
    "secondary": "Water",
    "sect": "nocturnal",
    "castMode": "self",
    "rulers": [
      "Mercury",
      "Saturn"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 3,
    "key": "Evaporation",
    "name": "Evaporation",
    "effects": [
      1,
      1,
      -1,
      -1
    ],
    "primary": "Air",
    "secondary": "Fire",
    "sect": "diurnal",
    "castMode": "self",
    "rulers": [
      "Mercury",
      "Uranus"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 4,
    "key": "Distillation",
    "name": "Distillation",
    "effects": [
      1,
      1,
      -1,
      1
    ],
    "primary": "Water",
    "secondary": "Air",
    "sect": "diurnal",
    "castMode": "self",
    "rulers": [
      "Mercury",
      "Neptune"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 5,
    "key": "Separation",
    "name": "Separation",
    "effects": [
      1,
      1,
      1,
      -1
    ],
    "primary": "Fire",
    "secondary": "Water",
    "sect": "diurnal",
    "castMode": "target",
    "rulers": [
      "Mercury",
      "Uranus",
      "Pluto"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 6,
    "key": "Rectification",
    "name": "Rectification",
    "effects": [
      1,
      1,
      1,
      1
    ],
    "primary": "Fire",
    "secondary": null,
    "sect": "diurnal",
    "castMode": "target",
    "rulers": [
      "Sun",
      "Jupiter"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 7,
    "key": "Calcination",
    "name": "Calcination",
    "effects": [
      -1,
      1,
      1,
      -1
    ],
    "primary": "Fire",
    "secondary": "Earth",
    "sect": "diurnal",
    "castMode": "target",
    "rulers": [
      "Mars",
      "Saturn"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 8,
    "key": "Comixion",
    "name": "Comixion",
    "effects": [
      1,
      -1,
      1,
      1
    ],
    "primary": "Earth",
    "secondary": "Air",
    "sect": "nocturnal",
    "castMode": "target",
    "rulers": [
      "Venus",
      "Jupiter",
      "Pluto"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 9,
    "key": "Purification",
    "name": "Purification",
    "effects": [
      1,
      1,
      -1,
      -1
    ],
    "primary": "Fire",
    "secondary": "Air",
    "sect": "diurnal",
    "castMode": "self",
    "rulers": [
      "Mercury",
      "Neptune",
      "Moon"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 10,
    "key": "Inhibition",
    "name": "Inhibition",
    "effects": [
      -1,
      -1,
      1,
      1
    ],
    "primary": "Earth",
    "secondary": "Water",
    "sect": "nocturnal",
    "castMode": "target",
    "rulers": [
      "Saturn",
      "Pluto"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 11,
    "key": "Fermentation",
    "name": "Fermentation",
    "effects": [
      1,
      1,
      1,
      -1
    ],
    "primary": "Water",
    "secondary": "Fire",
    "sect": "nocturnal",
    "castMode": "target",
    "rulers": [
      "Pluto",
      "Jupiter",
      "Mars"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 12,
    "key": "Fixation",
    "name": "Fixation",
    "effects": [
      -1,
      -1,
      1,
      1
    ],
    "primary": "Earth",
    "secondary": "Air",
    "sect": "diurnal",
    "castMode": "target",
    "rulers": [
      "Saturn",
      "Venus"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 13,
    "key": "Multiplication",
    "name": "Multiplication",
    "effects": [
      1,
      1,
      1,
      -1
    ],
    "primary": "Fire",
    "secondary": "Water",
    "sect": "nocturnal",
    "castMode": "target",
    "rulers": [
      "Jupiter",
      "Sun",
      "Uranus"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": false
  },
  {
    "id": 14,
    "key": "Protection",
    "name": "Protection",
    "effects": [
      1,
      1,
      1,
      1
    ],
    "primary": "Fire",
    "secondary": "Earth",
    "sect": "both",
    "castMode": "target",
    "rulers": [
      "Sun",
      "Moon",
      "Mercury",
      "Jupiter"
    ],
    "k": 1.0,
    "requiresLuminaryDignity": true
  }
]);

export const PILLARS_BY_ID = Object.freeze(
  Object.fromEntries(PILLARS.map(p => [p.id, p]))
);

export const PILLARS_BY_KEY = Object.freeze(
  Object.fromEntries(PILLARS.map(p => [p.key, p]))
);

/**
 * Elemental color schemes for UI rendering.
 */
export const ELEMENT_THEMES = Object.freeze({
  Fire: {
    primary: '#ff5722',
    gradient: 'linear-gradient(135deg, #ff5722, #ff9800)',
    badge: 'rgba(255, 87, 34, 0.2)',
    border: '#ff5722',
    glow: 'rgba(255, 87, 34, 0.4)',
  },
  Water: {
    primary: '#03a9f4',
    gradient: 'linear-gradient(135deg, #0288d1, #00bcd4)',
    badge: 'rgba(3, 169, 244, 0.2)',
    border: '#03a9f4',
    glow: 'rgba(3, 169, 244, 0.4)',
  },
  Air: {
    primary: '#e040fb',
    gradient: 'linear-gradient(135deg, #7c4dff, #e040fb)',
    badge: 'rgba(224, 64, 251, 0.2)',
    border: '#e040fb',
    glow: 'rgba(224, 64, 251, 0.4)',
  },
  Earth: {
    primary: '#4caf50',
    gradient: 'linear-gradient(135deg, #2e7d32, #8bc34a)',
    badge: 'rgba(76, 175, 80, 0.2)',
    border: '#4caf50',
    glow: 'rgba(76, 175, 80, 0.4)',
  },
});

/**
 * Compute the P = IV live power metrics for an alchemical state using
 * the canonical circuit and thermodynamics formulas from alchm-astro-core.
 */
export function computePillarCircuitPower(natalEsms, pools, elementCounts = { Fire: 3, Earth: 2, Air: 2, Water: 3 }, q = 10) {
  const live = [
    (natalEsms[0] * pools[0]) / 80.0,
    (natalEsms[1] * pools[1]) / 80.0,
    (natalEsms[2] * pools[2]) / 80.0,
    (natalEsms[3] * pools[3]) / 80.0,
  ];

  const fire = (typeof elementCounts.Fire === "number" ? elementCounts.Fire : elementCounts[0]) || 0;
  const earth = (typeof elementCounts.Earth === "number" ? elementCounts.Earth : elementCounts[1]) || 0;
  const air = (typeof elementCounts.Air === "number" ? elementCounts.Air : elementCounts[2]) || 0;
  const water = (typeof elementCounts.Water === "number" ? elementCounts.Water : elementCounts[3]) || 0;

  const s = live[0], e = live[1], m = live[2], b = live[3];
  const EPSILON = 1e-6;

  // Classical Alchemical Thermodynamics
  const heatDen = b + e + m + water + air + earth;
  const heat = (s * s + fire * fire) / Math.max(EPSILON, heatDen * heatDen);

  const entDen = e + m + earth + water;
  const entropy = (s * s + b * b + fire * fire + air * air) / Math.max(EPSILON, entDen * entDen);

  const reaDen = m + earth;
  const reactivity = (s * s + b * b + e * e + fire * fire + air * air + water * water) / Math.max(EPSILON, reaDen * reaDen);

  const energy = heat - entropy * reactivity;

  // Circuit variables
  const charge = m + b; // Q
  const drain = pools[2] + pools[3]; // Matter + Substance pool total
  const qMatter = drain > 0 ? (q * pools[2]) / drain : 0;
  const qSubstance = drain > 0 ? (q * pools[3]) / drain : 0;
  const chargeSpent = (natalEsms[2] * qMatter) / 80.0 + (natalEsms[3] * qSubstance) / 80.0; // ΔQ

  const current = reactivity * chargeSpent; // I = R * ΔQ
  const voltage = charge > EPSILON ? energy / charge : 0; // V = E / Q
  const power = current * voltage; // P = I * V
  const potency = reactivity * Math.abs(energy);
  const magnitude = Math.min(2.0, Math.max(0.25, Math.abs(power) / 0.0086));

  return {
    heat,
    entropy,
    reactivity,
    energy,
    charge,
    chargeSpent,
    current,
    voltage,
    power,
    potency,
    magnitude,
    canCast: drain >= q,
  };
}

/**
 * Filter legal hand based on element count, sky sect, and luminary dignity.
 * Topping up guarantees at least minHand (2) playable cards without discarding
 * already eligible primary qualifiers.
 */
export function getLegalHand(elementCounts, sky = "diurnal", luminaryDignity = false) {
  const minHand = 2;
  const skyLower = sky.toLowerCase();

  const getCount = (elem) => {
    if (typeof elementCounts[elem] === "number") return elementCounts[elem];
    const elemMap = { Fire: 0, Earth: 1, Air: 2, Water: 3 };
    const idx = elemMap[elem];
    return idx !== undefined && typeof elementCounts[idx] === "number" ? elementCounts[idx] : 0;
  };

  const isEligible = (p) => {
    const sectOk = p.sect === "both" || p.sect === skyLower;
    const dignityOk = !p.requiresLuminaryDignity || luminaryDignity;
    return sectOk && dignityOk;
  };

  // Primary qualification: eligible pillars whose primary element count >= 2
  const primaryQualifiers = PILLARS.filter(p => isEligible(p) && getCount(p.primary) >= 2);
  const selectedIds = new Set(primaryQualifiers.map(p => p.id));
  const hand = [...primaryQualifiers];

  // If under minHand (2), top up from remaining eligible pillars sorted by primary element count descending, then id
  if (hand.length < minHand) {
    const remaining = PILLARS
      .filter(p => isEligible(p) && !selectedIds.has(p.id))
      .sort((a, b) => {
        const diff = getCount(b.primary) - getCount(a.primary);
        return diff !== 0 ? diff : a.id - b.id;
      });

    for (const p of remaining) {
      if (hand.length >= minHand) break;
      hand.push(p);
      selectedIds.add(p.id);
    }
  }

  hand.sort((a, b) => a.id - b.id);
  return hand;
}
