//! Cast power, duel resolution, and room sharing for the Fourteen Pillars.
//!
//! Formulas and constants follow `spec/pillars.v1.json`; the reference
//! implementation is `tools/pillar_sim.py`, which writes the golden fixtures in
//! `spec/fixtures/cast-power.v1.json`. Arithmetic is ordered to match it.
//!
//!   live ESMSₖ = natalₖ × poolₖ / baseline
//!   Q = Matter + Substance (live)       ΔQ = charge removed by spending q
//!   I = R × ΔQ      V = E / Q      P = I × V
//!   m = clamp(|P| / powerRef, 0.25, 2.0)

use crate::pillars::{
    dignity, element_counts, modality_counts, pillar, CastMode, ChartInput, PillarSpec, ASCENDANT_ALCHEMY,
    PLANET_ALCHEMY,
};
use crate::Planet;

pub const POOL_BASELINE: f64 = 80.0;
pub const CAST_CHARGE: f64 = 10.0;
pub const POWER_REF: f64 = 0.0086;
pub const MAGNITUDE_MIN: f64 = 0.25;
pub const MAGNITUDE_MAX: f64 = 2.0;
pub const DELTA_SCALE: f64 = 1.25;
pub const ROOM_RESISTANCE_FLOOR: f64 = 0.25;
pub const EPSILON: f64 = 1e-9;
pub const TIE_TOLERANCE: f64 = 1e-12;

/// [Spirit, Essence, Matter, Substance]
pub type Esms = [f64; 4];

const SPIRIT: usize = 0;
const ESSENCE: usize = 1;
const MATTER: usize = 2;
const SUBSTANCE: usize = 3;

fn clamp(x: f64, lo: f64, hi: f64) -> f64 {
    if x < lo {
        lo
    } else if x > hi {
        hi
    } else {
        x
    }
}

/// Dignity-weighted natal ESMS: each planet adds its alchemy × (1 + 0.1·|dignity|).
pub fn natal_esms(chart: &ChartInput) -> Esms {
    let mut esms = [0.0; 4];
    for (i, &sign) in chart.signs.iter().enumerate() {
        let planet = Planet::from_idx(i).expect("ten planets");
        let mult = 1.0 + 0.1 * (dignity(planet, sign).abs() as f64);
        for k in 0..4 {
            esms[k] = esms[k] + PLANET_ALCHEMY[i][k] * mult;
        }
    }
    if chart.time_known {
        for k in 0..4 {
            esms[k] = esms[k] + ASCENDANT_ALCHEMY[k] * 1.0;
        }
    }
    esms
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Thermo {
    pub heat: f64,
    pub entropy: f64,
    pub reactivity: f64,
    /// Greg's Energy: heat − entropy × reactivity.
    pub energy: f64,
}

/// WhatToEatNext's alchemize formulas over ESMS and element counts [Fire, Earth, Air, Water].
pub fn thermo(esms: &Esms, counts: &[u32; 4]) -> Thermo {
    let (s, e, m, b) = (esms[SPIRIT], esms[ESSENCE], esms[MATTER], esms[SUBSTANCE]);
    let (fire, earth, air, water) = (counts[0] as f64, counts[1] as f64, counts[2] as f64, counts[3] as f64);
    let heat_den = b + e + m + water + air + earth;
    let heat = (s * s + fire * fire) / (heat_den * heat_den).max(EPSILON);
    let ent_den = e + m + earth + water;
    let entropy = (s * s + b * b + fire * fire + air * air) / (ent_den * ent_den).max(EPSILON);
    let rea_den = m + earth;
    let reactivity =
        (s * s + b * b + e * e + fire * fire + air * air + water * water) / (rea_den * rea_den).max(EPSILON);
    Thermo { heat, entropy, reactivity, energy: heat - entropy * reactivity }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CircuitState {
    pub element_counts: [u32; 4],
    pub modality_counts: [u32; 3],
    pub bodies: usize,
    pub natal_esms: Esms,
    pub live_esms: Esms,
    pub thermo: Thermo,
    /// Q: live Matter + Substance.
    pub charge: f64,
    /// ΔQ: live charge removed by spending `q` pool units.
    pub charge_spent: f64,
    pub current: f64,
    pub voltage: f64,
    pub power: f64,
    /// R × |E| — what duel resolution compares before and after.
    pub potency: f64,
    pub magnitude: f64,
    /// MATTER + SUBSTANCE pools cover the cast charge.
    pub can_cast: bool,
}

pub fn circuit_state(chart: &ChartInput, pools: &Esms, q: f64) -> CircuitState {
    let counts = element_counts(chart);
    let natal = natal_esms(chart);
    let mut live = [0.0; 4];
    for k in 0..4 {
        live[k] = natal[k] * pools[k] / POOL_BASELINE;
    }
    let t = thermo(&live, &counts);
    let charge = live[MATTER] + live[SUBSTANCE];
    let drain = pools[MATTER] + pools[SUBSTANCE];
    let (q_matter, q_substance) =
        if drain > 0.0 { (q * pools[MATTER] / drain, q * pools[SUBSTANCE] / drain) } else { (0.0, 0.0) };
    let charge_spent = natal[MATTER] * q_matter / POOL_BASELINE + natal[SUBSTANCE] * q_substance / POOL_BASELINE;
    let current = t.reactivity * charge_spent;
    let voltage = if charge > EPSILON { t.energy / charge } else { 0.0 };
    let power = current * voltage;
    CircuitState {
        element_counts: counts,
        modality_counts: modality_counts(chart),
        bodies: chart.bodies(),
        natal_esms: natal,
        live_esms: live,
        thermo: t,
        charge,
        charge_spent,
        current,
        voltage,
        power,
        potency: t.reactivity * t.energy.abs(),
        magnitude: clamp(power.abs() / POWER_REF, MAGNITUDE_MIN, MAGNITUDE_MAX),
        can_cast: drain >= q,
    }
}

pub fn potency(chart: &ChartInput, pools: &Esms) -> f64 {
    circuit_state(chart, pools, CAST_CHARGE).potency
}

/// Spend `q` from MATTER and SUBSTANCE in proportion to their balances.
pub fn pay(pools: &Esms, q: f64) -> Esms {
    let drain = pools[MATTER] + pools[SUBSTANCE];
    let mut out = *pools;
    if drain > 0.0 {
        out[MATTER] = pools[MATTER] - q * pools[MATTER] / drain;
        out[SUBSTANCE] = pools[SUBSTANCE] - q * pools[SUBSTANCE] / drain;
    }
    out
}

/// The pool-unit delta a pillar delivers, scaled down so Σ|Δ| never exceeds `q`.
pub fn cast_delta(p: &PillarSpec, magnitude: f64, q: f64) -> Esms {
    let mut raw = [0.0; 4];
    for k in 0..4 {
        raw[k] = p.effects[k] as f64 * p.k * magnitude * DELTA_SCALE;
    }
    let total = raw[0].abs() + raw[1].abs() + raw[2].abs() + raw[3].abs();
    if total > q {
        let scale = q / total;
        for v in raw.iter_mut() {
            *v = *v * scale;
        }
    }
    raw
}

pub fn apply_delta(pools: &Esms, delta: &Esms) -> Esms {
    let mut out = [0.0; 4];
    for k in 0..4 {
        out[k] = f64::max(0.0, pools[k] + delta[k]);
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Winner {
    A,
    B,
    Draw,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DuelOutcome {
    pub magnitude_a: f64,
    pub magnitude_b: f64,
    pub delta_a: Esms,
    pub delta_b: Esms,
    pub pools_a: Esms,
    pub pools_b: Esms,
    /// Potency after the exchange ÷ potency before.
    pub ratio_a: f64,
    pub ratio_b: f64,
    pub winner: Winner,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DuelError {
    UnknownPillar(u8),
    CannotCast,
}

/// Both casters pay `q`, both casts land (self-cast on the caster, target on the
/// opponent), and whoever keeps the larger share of their potency wins.
pub fn resolve_duel(
    a: &ChartInput,
    a_pools: &Esms,
    a_pillar: u8,
    b: &ChartInput,
    b_pools: &Esms,
    b_pillar: u8,
    q: f64,
) -> Result<DuelOutcome, DuelError> {
    let pa = pillar(a_pillar).ok_or(DuelError::UnknownPillar(a_pillar))?;
    let pb = pillar(b_pillar).ok_or(DuelError::UnknownPillar(b_pillar))?;
    let sa = circuit_state(a, a_pools, q);
    let sb = circuit_state(b, b_pools, q);
    if !(sa.can_cast && sb.can_cast) {
        return Err(DuelError::CannotCast);
    }

    let mut a_after = pay(a_pools, q);
    let mut b_after = pay(b_pools, q);
    let delta_a = cast_delta(pa, sa.magnitude, q);
    let delta_b = cast_delta(pb, sb.magnitude, q);
    match pa.cast_mode {
        CastMode::SelfCast => a_after = apply_delta(&a_after, &delta_a),
        CastMode::Target => b_after = apply_delta(&b_after, &delta_a),
    }
    match pb.cast_mode {
        CastMode::SelfCast => b_after = apply_delta(&b_after, &delta_b),
        CastMode::Target => a_after = apply_delta(&a_after, &delta_b),
    }

    let ratio_a = potency(a, &a_after) / sa.potency.max(EPSILON);
    let ratio_b = potency(b, &b_after) / sb.potency.max(EPSILON);
    let diff = ratio_a - ratio_b;
    let winner = if diff > TIE_TOLERANCE {
        Winner::A
    } else if diff < -TIE_TOLERANCE {
        Winner::B
    } else {
        Winner::Draw
    };
    Ok(DuelOutcome {
        magnitude_a: sa.magnitude,
        magnitude_b: sb.magnitude,
        delta_a,
        delta_b,
        pools_a: a_after,
        pools_b: b_after,
        ratio_a,
        ratio_b,
        winner,
    })
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoomShare {
    /// Fraction of the caster's magnitude this receiver draws (admittance-weighted).
    pub share: f64,
    /// Lands as the ESMS delta.
    pub real: f64,
    /// Cardinal kick: a counter-cast bonus for one reply window.
    pub kick: f64,
    /// Fixed tension: accumulates toward a forced reply.
    pub tension: f64,
}

/// Split one cast of `magnitude` across receivers so the total delivered is conserved.
pub fn room_shares(magnitude: f64, receivers: &[ChartInput]) -> Vec<RoomShare> {
    let parts: Vec<(f64, f64, f64, f64, f64)> = receivers
        .iter()
        .map(|chart| {
            let counts = modality_counts(chart);
            let n = chart.bodies() as f64;
            let (cardinal, fixed, mutable) = (counts[0] as f64 / n, counts[1] as f64 / n, counts[2] as f64 / n);
            let r = ROOM_RESISTANCE_FLOOR + mutable;
            let x = cardinal - fixed;
            let z = (r * r + x * x).sqrt();
            (cardinal, fixed, r, z, 1.0 / z)
        })
        .collect();
    let mut total_y = 0.0;
    for part in &parts {
        total_y = total_y + part.4;
    }
    parts
        .iter()
        .map(|&(cardinal, fixed, r, z, y)| {
            let share = y / total_y;
            RoomShare {
                share,
                real: magnitude * share * r / z,
                kick: magnitude * share * cardinal / z,
                tension: magnitude * share * fixed / z,
            }
        })
        .collect()
}
