//! The Fourteen Alchemical Pillars, chart tallies, and hand gating.
//!
//! Mirrors `spec/pillars.v1.json`; `tests/spec_parity.rs` fails if the two drift.
//! ESMS arrays are ordered [Spirit, Essence, Matter, Substance]; signs are
//! 0 = Aries .. 11 = Pisces; planets follow `Planet` (Sun = 0 .. Pluto = 9).

use crate::{sign_modality, Modality, Planet};

/// A classical element, as carried by a zodiac sign (sign index % 4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Element {
    Fire,
    Earth,
    Air,
    Water,
}

impl Element {
    pub const ALL: [Element; 4] = [Element::Fire, Element::Earth, Element::Air, Element::Water];

    pub fn of_sign(sign: u8) -> Element {
        Self::ALL[(sign % 4) as usize]
    }

    pub fn idx(self) -> usize {
        self as usize
    }

    pub fn name(self) -> &'static str {
        match self {
            Element::Fire => "Fire",
            Element::Earth => "Earth",
            Element::Air => "Air",
            Element::Water => "Water",
        }
    }
}

/// Which sky a pillar can be cast under.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Sect {
    Diurnal,
    Nocturnal,
    Both,
}

/// Where a pillar's ESMS delta lands: on the caster, or on the opponent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum CastMode {
    SelfCast,
    Target,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PillarSpec {
    pub id: u8,
    pub key: &'static str,
    /// ±1 per principle, [Spirit, Essence, Matter, Substance].
    pub effects: [i8; 4],
    pub primary: Element,
    pub secondary: Option<Element>,
    pub sect: Sect,
    pub cast_mode: CastMode,
    pub rulers: &'static [Planet],
    /// Balance coefficient, tuned with `tools/pillar_sim.py balance`.
    pub k: f64,
    /// Protection: unlocks only when the Sun or Moon has positive dignity.
    pub requires_luminary_dignity: bool,
}

use CastMode::{SelfCast, Target};
use Element::{Air, Earth, Fire, Water};
use Planet::*;
use Sect::{Both, Diurnal, Nocturnal};

pub const PILLARS: [PillarSpec; 14] = [
    PillarSpec { id: 1, key: "Solution", effects: [-1, 1, 1, -1], primary: Water, secondary: Some(Earth), sect: Nocturnal, cast_mode: Target, rulers: &[Moon, Neptune], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 2, key: "Filtration", effects: [1, 1, -1, 1], primary: Air, secondary: Some(Water), sect: Nocturnal, cast_mode: SelfCast, rulers: &[Mercury, Saturn], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 3, key: "Evaporation", effects: [1, 1, -1, -1], primary: Air, secondary: Some(Fire), sect: Diurnal, cast_mode: SelfCast, rulers: &[Mercury, Uranus], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 4, key: "Distillation", effects: [1, 1, -1, 1], primary: Water, secondary: Some(Air), sect: Diurnal, cast_mode: SelfCast, rulers: &[Mercury, Neptune], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 5, key: "Separation", effects: [1, 1, 1, -1], primary: Fire, secondary: Some(Water), sect: Diurnal, cast_mode: Target, rulers: &[Mercury, Uranus, Pluto], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 6, key: "Rectification", effects: [1, 1, 1, 1], primary: Fire, secondary: None, sect: Diurnal, cast_mode: Target, rulers: &[Sun, Jupiter], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 7, key: "Calcination", effects: [-1, 1, 1, -1], primary: Fire, secondary: Some(Earth), sect: Diurnal, cast_mode: Target, rulers: &[Mars, Saturn], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 8, key: "Comixion", effects: [1, -1, 1, 1], primary: Earth, secondary: Some(Air), sect: Nocturnal, cast_mode: Target, rulers: &[Venus, Jupiter, Pluto], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 9, key: "Purification", effects: [1, 1, -1, -1], primary: Fire, secondary: Some(Air), sect: Diurnal, cast_mode: SelfCast, rulers: &[Mercury, Neptune, Moon], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 10, key: "Inhibition", effects: [-1, -1, 1, 1], primary: Earth, secondary: Some(Water), sect: Nocturnal, cast_mode: Target, rulers: &[Saturn, Pluto], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 11, key: "Fermentation", effects: [1, 1, 1, -1], primary: Water, secondary: Some(Fire), sect: Nocturnal, cast_mode: Target, rulers: &[Pluto, Jupiter, Mars], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 12, key: "Fixation", effects: [-1, -1, 1, 1], primary: Earth, secondary: Some(Air), sect: Diurnal, cast_mode: Target, rulers: &[Saturn, Venus], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 13, key: "Multiplication", effects: [1, 1, 1, -1], primary: Fire, secondary: Some(Water), sect: Nocturnal, cast_mode: Target, rulers: &[Jupiter, Sun, Uranus], k: 1.0, requires_luminary_dignity: false },
    PillarSpec { id: 14, key: "Protection", effects: [1, 1, 1, 1], primary: Fire, secondary: Some(Earth), sect: Both, cast_mode: Target, rulers: &[Sun, Moon, Mercury, Jupiter], k: 1.0, requires_luminary_dignity: true },
];

pub fn pillar(id: u8) -> Option<&'static PillarSpec> {
    PILLARS.iter().find(|p| p.id == id)
}

// ── Natal tables (ASOL lib/alchemizer.ts) ───────────────────────────────────

/// Each planet's base ESMS contribution, [Spirit, Essence, Matter, Substance].
pub const PLANET_ALCHEMY: [[f64; 4]; 10] = [
    [1.0, 0.0, 0.0, 0.0], // Sun
    [0.0, 1.0, 1.0, 0.0], // Moon
    [1.0, 0.0, 0.0, 1.0], // Mercury
    [0.0, 1.0, 1.0, 0.0], // Venus
    [0.0, 1.0, 1.0, 0.0], // Mars
    [1.0, 1.0, 0.0, 0.0], // Jupiter
    [1.0, 0.0, 1.0, 0.0], // Saturn
    [0.0, 1.0, 1.0, 0.0], // Uranus
    [0.0, 1.0, 0.0, 1.0], // Neptune
    [0.0, 1.0, 1.0, 0.0], // Pluto
];

/// The Ascendant counts toward element and modality tallies but carries no ESMS.
pub const ASCENDANT_ALCHEMY: [f64; 4] = [0.0, 0.0, 0.0, 0.0];

/// Dignity of each planet in each sign (Aries..Pisces); 0 where unlisted.
pub const PLANET_DIGNITY: [[i8; 12]; 10] = [
    [2, 0, 0, 0, 1, 0, -2, 0, 0, 0, -1, 0],   // Sun
    [0, 2, 0, 1, 0, 0, 0, -2, 0, -1, 0, 0],   // Moon
    [0, 0, 1, 0, 0, 3, 0, 0, 1, 0, 0, -3],    // Mercury
    [-1, 1, 0, 0, 0, -2, 1, -1, 0, 0, 0, 2],  // Venus
    [1, -1, 0, -2, 0, 0, -1, 1, 0, 2, 0, 0],  // Mars
    [0, 0, -1, 2, 0, -1, 0, 0, 1, -2, 0, 1],  // Jupiter
    [-2, 0, 0, -1, -1, 0, 2, 0, 0, 1, 1, 0],  // Saturn
    [0, -3, 0, 0, 0, 0, 0, 2, 0, 0, 1, 0],    // Uranus
    [0, 0, 0, 2, 0, -1, 0, 0, 0, -2, 0, 1],   // Neptune
    [0, -1, 0, 0, 2, 0, 0, 1, 0, 0, -2, 0],   // Pluto
];

pub fn dignity(planet: Planet, sign: u8) -> i8 {
    PLANET_DIGNITY[planet.idx()][(sign % 12) as usize]
}

// ── Chart tallies ───────────────────────────────────────────────────────────

/// The minimum a chart needs for pillar math: ten planet signs and an Ascendant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ChartInput {
    /// Sign of each planet, indexed by `Planet`.
    pub signs: [u8; 10],
    pub ascendant_sign: u8,
    /// A time-unknown chart's Ascendant is a noon placeholder, so it is not counted.
    pub time_known: bool,
}

impl ChartInput {
    pub fn counted_signs(&self) -> impl Iterator<Item = u8> + '_ {
        self.signs.iter().copied().chain(self.time_known.then_some(self.ascendant_sign))
    }

    pub fn bodies(&self) -> usize {
        if self.time_known { 11 } else { 10 }
    }
}

/// Placements per element, indexed by `Element`.
pub fn element_counts(chart: &ChartInput) -> [u32; 4] {
    let mut counts = [0u32; 4];
    for sign in chart.counted_signs() {
        counts[Element::of_sign(sign).idx()] += 1;
    }
    counts
}

/// Placements per modality, [Cardinal, Fixed, Mutable].
pub fn modality_counts(chart: &ChartInput) -> [u32; 3] {
    let mut counts = [0u32; 3];
    for sign in chart.counted_signs() {
        let i = match sign_modality(sign) {
            Modality::Cardinal => 0,
            Modality::Fixed => 1,
            Modality::Mutable => 2,
        };
        counts[i] += 1;
    }
    counts
}

// ── Hand ────────────────────────────────────────────────────────────────────

/// A pillar needs this many placements in its primary element to unlock.
pub const MIN_PRIMARY_PLACEMENTS: u32 = 2;
/// Every caster holds at least this many pillars, topped up from their strongest element.
pub const MIN_HAND: usize = 2;

/// Pillar ids (ascending) the chart may cast under `sky` (Diurnal or Nocturnal).
pub fn hand(chart: &ChartInput, sky: Sect) -> Vec<u8> {
    let counts = element_counts(chart);
    let luminary = dignity(Sun, chart.signs[Sun.idx()]) > 0 || dignity(Moon, chart.signs[Moon.idx()]) > 0;
    let eligible = |p: &PillarSpec| {
        (p.sect == sky || p.sect == Both) && (!p.requires_luminary_dignity || luminary)
    };

    let mut ids: Vec<u8> = PILLARS
        .iter()
        .filter(|p| eligible(p) && counts[p.primary.idx()] >= MIN_PRIMARY_PLACEMENTS)
        .map(|p| p.id)
        .collect();

    if ids.len() < MIN_HAND {
        let mut rest: Vec<&PillarSpec> = PILLARS.iter().filter(|p| eligible(p) && !ids.contains(&p.id)).collect();
        rest.sort_by_key(|p| (std::cmp::Reverse(counts[p.primary.idx()]), p.id));
        for p in rest {
            if ids.len() >= MIN_HAND {
                break;
            }
            ids.push(p.id);
        }
    }
    ids.sort_unstable();
    ids
}
