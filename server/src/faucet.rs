//! ADR-015 Untethered Synastry Resonance Faucet Engine for Pentacles.
//!
//! Authoritative server-side implementation of the Self-Normalised Synastry
//! Resonance Faucet and Floored Elemental Sinks.
//!   - Dynamic daily yield band: [6.0000, 48.0000] ESMS (centre 24.0000, z in [0.25, 2.00])
//!   - Hard operational gas floor: 0.5000 ESMS per axis (2.0000 total floor)
//!   - Self-normalised chart baseline S̄(N) ensuring annual emission neutrality (INV-3, INV-5)
//! Across the four canonical ESMS tokens:
//!   - SPIRIT    (🝇 / 🜂 / [SPRT]) - Fire   / kinetic gas & action
//!   - ESSENCE   (🝑 / 🜄 / [ESNC]) - Water  / emotional liquidity & oracles
//!   - MATTER    (🝙 / 🜃 / [MATR]) - Earth  / material staking & territorial anchor
//!   - SUBSTANCE (🝉 / 🜁 / [SUBS]) - Air    / mental velocity & card transmutation

use crate::tables::NatalChart;
use crate::types::Planet;

/// ADR-015 Protocol Band Calibration for Pentacles:
/// Total daily grant band: [6.0000, 48.0000] ESMS (centered at 24.0000, z in [0.25, 2.00])
pub const PROTOCOL_BAND_MIN: f64 = 6.0;
pub const PROTOCOL_BAND_MAX: f64 = 48.0;
pub const PROTOCOL_BAND_CENTRE: f64 = 24.0;

/// Operational Gas Floor: guaranteed 0.5000 ESMS per axis (2.0000 ESMS total).
/// Ensures players always receive combat strike / trick gas (SPIRIT) even on zero-Fire sky days.
pub const AXIS_GAS_FLOOR: f64 = 0.5000;
pub const TOTAL_GAS_FLOOR: f64 = 2.0000;

/// Universal daily sign-in faucet budget baseline (24.0000 ESMS).
pub const DAILY_FAUCET_BUDGET: f64 = PROTOCOL_BAND_CENTRE;

/// Authoritative counter-cyclical damping parameter for MATTER (37.51% network supply glut).
pub const CURRENT_MATTER_DAMPING: f64 = 0.750;
pub const ANTI_GLUT_THRESHOLD: f64 = 0.30;
pub const ANTI_GLUT_MIN_DAMPING: f64 = 0.650;

// Pentacles Tier 2 Gameplay Reward Constants
pub const MELEE_BASE_YIELD: f64 = 5.0;
pub const MELEE_CLEAN_SWEEP_MULT: f64 = 1.50; // +50% Grand Slam
pub const MELEE_MAJORITY_MULT: f64 = 1.20;    // +20% >= 7 tricks
pub const MELEE_SUIT_ALIGN_MULT: f64 = 1.35;  // +35% matching zone triplicity
pub const MELEE_SUIT_OPPOSE_MULT: f64 = 0.75; // -25% opposite triplicity
pub const MELEE_OUDLER_BONUS: f64 = 1.50;     // +1.5000 flat bonus for Oudler climax

pub const ZONE_BOUNTY_HOUSE: f64 = 25.0;      // Zones 0..4
pub const ZONE_BOUNTY_SPIRE: f64 = 35.0;      // Zones 5..9
pub const ZONE_BOUNTY_CROWN: f64 = 50.0;      // Zone 10
pub const ZONE_FLUX_MULT: f64 = 2.50;
pub const ZONE_INGRESS_MULT: f64 = 2.00;
pub const ZONE_MAX_OVERSHOOT_BONUS: f64 = 15.0;

pub const DECAN_RETENTION_HOUSE: f64 = 100.0;
pub const DECAN_RETENTION_SPIRE: f64 = 150.0;
pub const DECAN_RETENTION_CROWN: f64 = 250.0;
pub const DECAN_CHAMPION_SOVEREIGN_TREASURY: f64 = 500.0;

/// Conserved elemental allocation payout across the 4 canonical tokens.
#[derive(Clone, Debug, PartialEq)]
pub struct FaucetAllocation {
    pub spirit: f64,
    pub essence: f64,
    pub matter: f64,
    pub substance: f64,
    pub total: f64,
    pub resonance_factor: f64,
}

impl FaucetAllocation {
    /// Convert to 10^4 fixed-point representations (e.g. 6.0000 -> 60000).
    pub fn to_fixed_points(&self) -> [u32; 4] {
        [
            (self.spirit * 10_000.0).round() as u32,
            (self.essence * 10_000.0).round() as u32,
            (self.matter * 10_000.0).round() as u32,
            (self.substance * 10_000.0).round() as u32,
        ]
    }
}

/// Computes the Counter-Cyclical Anti-Glut Damping Factor (Ω_i).
/// Suppresses new generation of tokens whose global supply share exceeds 30%.
pub fn compute_anti_glut_damping(supply_shares: Option<&[u64]>) -> [f64; 4] {
    let mut damp = [1.0, 1.0, 1.0, 1.0];
    let shares = match supply_shares {
        Some(s) if s.len() == 4 => s,
        _ => {
            damp[2] = CURRENT_MATTER_DAMPING;
            return damp;
        }
    };

    let total: u64 = shares.iter().sum();
    if total == 0 {
        damp[2] = CURRENT_MATTER_DAMPING;
        return damp;
    }

    for i in 0..4 {
        let share = shares[i] as f64 / total as f64;
        if share > ANTI_GLUT_THRESHOLD {
            damp[i] = (1.0 - 2.0 * (share - 0.25)).max(ANTI_GLUT_MIN_DAMPING);
        }
    }
    damp
}

/// Derives normalized natal chart ratios [r_Spirit, r_Essence, r_Matter, r_Substance].
/// Uses Sun/Moon lights 3x weight, standard planets 1x, and Ascendant 3x if timed.
pub fn natal_elemental_ratios(chart: &NatalChart) -> [f64; 4] {
    let sign_to_esms = |sign: u8| -> usize {
        match sign % 4 {
            0 => 0, // Fire -> Spirit
            3 => 1, // Water -> Essence
            1 => 2, // Earth -> Matter
            _ => 3, // Air -> Substance
        }
    };

    let mut scores = [0.0f64; 4];

    for p in &chart.placements {
        let idx = sign_to_esms(p.sign);
        let weight = match p.body {
            Planet::Sun | Planet::Moon => 3.0,
            _ => 1.0,
        };
        scores[idx] += weight;
    }

    if chart.time_known {
        let asc_sign = ((chart.ascendant / 1800) % 12) as u8;
        let idx = sign_to_esms(asc_sign);
        scores[idx] += 3.0;
    }

    let sum: f64 = scores.iter().sum();
    if sum > 0.0 {
        [
            scores[0] / sum,
            scores[1] / sum,
            scores[2] / sum,
            scores[3] / sum,
        ]
    } else {
        [0.25, 0.25, 0.25, 0.25]
    }
}

/// Normalizes sky transit weights [w_Spirit, w_Essence, w_Matter, w_Substance].
pub fn transit_sky_weights(weights: Option<&[f64; 4]>) -> [f64; 4] {
    match weights {
        Some(w) => {
            let sum: f64 = w.iter().sum();
            if sum > 0.0 {
                [w[0] / sum, w[1] / sum, w[2] / sum, w[3] / sum]
            } else {
                [0.25, 0.25, 0.25, 0.25]
            }
        }
        None => [0.25, 0.25, 0.25, 0.25],
    }
}

/// Computes the chart's self-normalisation baseline S̄(N) under equinoctial / neutral sky (0.25 per axis).
/// Cancels chart-shape min-maxing (INV-5), guaranteeing annual emission neutrality (INV-3).
pub fn calculate_chart_baseline(natal_ratios: &[f64; 4], damping: Option<&[f64; 4]>) -> f64 {
    let default_damping = [1.0, 1.0, CURRENT_MATTER_DAMPING, 1.0];
    let omega = damping.unwrap_or(&default_damping);
    let mut baseline = 0.0f64;
    for i in 0..4 {
        baseline += natal_ratios[i] * 0.25 * omega[i];
    }
    if baseline > 0.0 {
        baseline
    } else {
        0.25
    }
}

/// Computes the instantaneous synastry resonance S(N, t), baseline S̄(N), and multiplier z.
pub fn compute_synastry_resonance(
    natal_ratios: &[f64; 4],
    transit_weights: &[f64; 4],
    damping: Option<&[f64; 4]>,
) -> (f64, f64, f64) {
    let default_damping = [1.0, 1.0, CURRENT_MATTER_DAMPING, 1.0];
    let omega = damping.unwrap_or(&default_damping);
    let mut synastry = 0.0f64;
    for i in 0..4 {
        synastry += natal_ratios[i] * transit_weights[i] * omega[i];
    }
    let baseline = calculate_chart_baseline(natal_ratios, Some(omega));
    let z = if baseline > 0.0 { synastry / baseline } else { 1.0 };
    (synastry, baseline, z)
}

/// ADR-015 Floored Elemental Allocation Formula with operational gas floors and exact 10^4 residual pass.
/// Guarantees that:
/// 1. Every axis receives AT LEAST AXIS_GAS_FLOOR (0.5000 ESMS).
/// 2. Discretionary pool (total_yield - 2.0000) is distributed via r_i * w_i * omega_i.
/// 3. Sum of all four axes is EXACTLY equal to total_yield (residual added to dominant axis).
pub fn allocate_floored_yield(
    total_yield: f64,
    natal_ratios: &[f64; 4],
    transit_weights: &[f64; 4],
    damping: Option<&[f64; 4]>,
) -> FaucetAllocation {
    let r = natal_ratios;
    let w = transit_weights;
    let default_damping = [1.0, 1.0, CURRENT_MATTER_DAMPING, 1.0];
    let omega = damping.unwrap_or(&default_damping);

    let effective_total = total_yield.max(TOTAL_GAS_FLOOR);
    let discretionary = (effective_total - TOTAL_GAS_FLOOR).max(0.0);

    let mut unnormalized = [0.0f64; 4];
    for i in 0..4 {
        unnormalized[i] = r[i] * w[i] * omega[i];
    }
    let total_weight: f64 = unnormalized.iter().sum();

    let mut quantized = [AXIS_GAS_FLOOR; 4];
    if total_weight > 0.0 && discretionary > 0.0 {
        for i in 0..4 {
            let share = (discretionary * unnormalized[i]) / total_weight;
            let axis_raw = AXIS_GAS_FLOOR + share;
            quantized[i] = (axis_raw * 10_000.0).floor() / 10_000.0;
        }
    } else if discretionary > 0.0 {
        let per_axis_disc = (discretionary / 4.0 * 10_000.0).floor() / 10_000.0;
        for i in 0..4 {
            quantized[i] = AXIS_GAS_FLOOR + per_axis_disc;
        }
    }

    let subtotal: f64 = quantized.iter().sum();
    let diff = ((effective_total - subtotal) * 10_000.0).round() / 10_000.0;

    // Assign residual micro-fraction to dominant axis
    let mut dominant_idx = 0;
    for i in 1..4 {
        if unnormalized[i] > unnormalized[dominant_idx] {
            dominant_idx = i;
        }
    }
    quantized[dominant_idx] = ((quantized[dominant_idx] + diff) * 10_000.0).round() / 10_000.0;

    FaucetAllocation {
        spirit: quantized[0],
        essence: quantized[1],
        matter: quantized[2],
        substance: quantized[3],
        total: ((quantized[0] + quantized[1] + quantized[2] + quantized[3]) * 10_000.0).round() / 10_000.0,
        resonance_factor: 1.0,
    }
}

/// Backwards-compatible alias for allocate_floored_yield
pub fn allocate_conserved_yield(
    total_yield: f64,
    natal_ratios: &[f64; 4],
    transit_weights: &[f64; 4],
    damping: Option<&[f64; 4]>,
) -> FaucetAllocation {
    allocate_floored_yield(total_yield, natal_ratios, transit_weights, damping)
}

/// Computes the ADR-015 Untethered Daily Sign-In Faucet yield for a player.
/// Dynamically scales total grant in [6.0000, 48.0000] based on self-normalised synastry resonance z.
pub fn compute_daily_sign_in_yield(
    chart: &NatalChart,
    sky_weights: Option<&[f64; 4]>,
    supply_shares: Option<&[u64]>,
) -> FaucetAllocation {
    let r = natal_elemental_ratios(chart);
    let w = transit_sky_weights(sky_weights);
    let omega = compute_anti_glut_damping(supply_shares);

    let (_s, _base, z) = compute_synastry_resonance(&r, &w, Some(&omega));
    let untethered_raw = PROTOCOL_BAND_CENTRE * z;
    let clamped_total = untethered_raw.clamp(PROTOCOL_BAND_MIN, PROTOCOL_BAND_MAX);
    let quantized_total = (clamped_total * 10_000.0).round() / 10_000.0;

    let mut alloc = allocate_floored_yield(quantized_total, &r, &w, Some(&omega));
    alloc.resonance_factor = (z * 10_000.0).round() / 10_000.0;
    alloc
}

/// Computes War Table melee round win payout based on score and performance.
pub fn compute_melee_round_yield(
    score: u16,
    clean_sweep: bool,
    favored_suit_match: Option<bool>,
    oudler_climax: bool,
    chart: &NatalChart,
    sky_weights: Option<&[f64; 4]>,
) -> FaucetAllocation {
    let score_mult = 1.0 + (score as f64 / 100.0);
    let sweep_mult = if clean_sweep {
        MELEE_CLEAN_SWEEP_MULT
    } else if score >= 70 {
        MELEE_MAJORITY_MULT
    } else {
        1.0
    };
    let weather_mult = match favored_suit_match {
        Some(true) => MELEE_SUIT_ALIGN_MULT,
        Some(false) => MELEE_SUIT_OPPOSE_MULT,
        None => 1.0,
    };
    let oudler_flat = if oudler_climax { MELEE_OUDLER_BONUS } else { 0.0 };

    let raw_yield = (MELEE_BASE_YIELD * score_mult * sweep_mult * weather_mult) + oudler_flat;
    let total_yield = ((raw_yield * 10_000.0).round()) / 10_000.0;

    let r = natal_elemental_ratios(chart);
    let w = transit_sky_weights(sky_weights);
    allocate_floored_yield(total_yield, &r, &w, None)
}

/// Computes the bounty for capturing a contested zone upon flipping the control meter.
pub fn compute_zone_capture_yield(
    zone_id: u8,
    in_flux: bool,
    is_ingress: bool,
    overshoot_control: i32,
    chart: &NatalChart,
    sky_weights: Option<&[f64; 4]>,
) -> FaucetAllocation {
    let base_bounty = match zone_id {
        0..=4 => ZONE_BOUNTY_HOUSE,
        5..=9 => ZONE_BOUNTY_SPIRE,
        _ => ZONE_BOUNTY_CROWN,
    };

    let flux_mult = if in_flux { ZONE_FLUX_MULT } else { 1.0 };
    let ingress_mult = if is_ingress { ZONE_INGRESS_MULT } else { 1.0 };
    let overshoot_bonus = ((overshoot_control.max(0) as f64 / 100.0) * 1.50).min(ZONE_MAX_OVERSHOOT_BONUS);

    let raw_yield = (base_bounty * flux_mult * ingress_mult) + overshoot_bonus;
    let total_yield = ((raw_yield * 10_000.0).round()) / 10_000.0;

    let r = natal_elemental_ratios(chart);
    let w = transit_sky_weights(sky_weights);
    allocate_conserved_yield(total_yield, &r, &w, None)
}

/// Computes 10-day decan cycle zone retention dividend at solar 10° boundary crossing.
pub fn compute_decan_retention_dividend(
    zone_id: u8,
    control: i32,
    has_seal: bool,
    suit_resonance: bool,
    chart: &NatalChart,
    sky_weights: Option<&[f64; 4]>,
) -> FaucetAllocation {
    let base_dividend = match zone_id {
        0..=4 => DECAN_RETENTION_HOUSE,
        5..=9 => DECAN_RETENTION_SPIRE,
        _ => DECAN_RETENTION_CROWN,
    };

    let control_ratio = (control.max(0).min(1000) as f64 / 500.0).max(0.20);
    let seal_mult = if has_seal { 1.15 } else { 1.0 };
    let suit_mult = if suit_resonance { 1.25 } else { 1.0 };

    let raw_yield = base_dividend * control_ratio * seal_mult * suit_mult;
    let total_yield = ((raw_yield * 10_000.0).round()) / 10_000.0;

    let r = natal_elemental_ratios(chart);
    let w = transit_sky_weights(sky_weights);
    allocate_conserved_yield(total_yield, &r, &w, None)
}

/// Computes StarVault USDC continuous accrual rate with Golden Minute Ascendant burst.
pub fn compute_star_staking_accrual_rate(
    star_element: u8,
    is_above_horizon: bool,
    ascendant_orb_minutes: f64,
    chart: &NatalChart,
    sky_weights: Option<&[f64; 4]>,
) -> f64 {
    if !is_above_horizon {
        return 0.0;
    }

    let elem_idx = (star_element as usize).min(3);
    let r = natal_elemental_ratios(chart);
    let w = transit_sky_weights(sky_weights);
    let omega = compute_anti_glut_damping(None);

    let mut unnormalized = [0.0f64; 4];
    for i in 0..4 {
        unnormalized[i] = r[i] * w[i] * omega[i];
    }
    let total_weight: f64 = unnormalized.iter().sum();
    let elem_share = if total_weight > 0.0 {
        unnormalized[elem_idx] / total_weight
    } else {
        0.25
    };

    const BASE_DAILY_RATE: f64 = 0.0001; // Base continuous accrual coefficient
    let base_rate = BASE_DAILY_RATE * elem_share;

    // Ascendant Burst: ±2 arc-minutes orb gives 2.0x burst multiplier
    if ascendant_orb_minutes.abs() <= 2.0 {
        base_rate * 2.0
    } else {
        base_rate
    }
}
