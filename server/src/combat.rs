//! Environmental combat — the *field of play* sets the parity, not the cards.
//!
//! The four suits don't counter each other. The sky's currently-rising sign
//! favors its element's suit: a Water sign lifts Cups, Fire lifts Wands, Air
//! lifts Swords, Earth lifts Pentacles. The rising sign sweeps the zodiac in
//! real time (the ascendant clock in reducers.rs), so the favored suit changes
//! round to round. Favored ×1.35, the opposing element ×0.75, the rest ×1.0.

use crate::types::Suit;

/// Flat stat snapshot a card contributes to a side.
#[derive(Clone, Copy)]
pub struct CardStat {
    pub suit: Suit,
    pub attack: u16,
    pub health: u16,
    pub armour: u16,
}

/// The suit elementally opposed to `s` (Fire↔Water, Air↔Earth).
fn opposite_suit(s: Suit) -> Suit {
    match s {
        Suit::Wands => Suit::Cups,
        Suit::Cups => Suit::Wands,
        Suit::Swords => Suit::Pentacles,
        Suit::Pentacles => Suit::Swords,
    }
}

/// Environmental affinity under the currently-favored element: the rising sign's
/// suit fights at ×1.35, its opposite at ×0.75, the perpendicular pair at ×1.0.
pub fn element_weather(suit: Suit, favored: Suit) -> f32 {
    if suit == favored {
        1.35
    } else if suit == opposite_suit(favored) {
        0.75
    } else {
        1.0
    }
}

pub fn card_strength(c: &CardStat) -> f32 {
    c.attack as f32 + c.health as f32 * 0.5 + c.armour as f32 * 0.4
}

/// Per-card multiplier from a faction's zodiac seals: a card whose suit's element
/// the faction currently masters (it holds a zone sitting in that element's sign)
/// fights a notch harder, wherever the contest is.
pub const SEAL_BONUS: f32 = 1.15;

pub fn seal_mult(suit: Suit, sealed: &[Suit]) -> f32 {
    if sealed.contains(&suit) { SEAL_BONUS } else { 1.0 }
}

/// Total effective power of a side under the favored element and its seals.
pub fn side_power(cards: &[CardStat], favored: Suit, sealed: &[Suit]) -> f32 {
    cards
        .iter()
        .map(|c| card_strength(c) * element_weather(c.suit, favored) * seal_mult(c.suit, sealed))
        .sum()
}

/// Resolve attacker vs defender under the current sky and each side's seals.
/// Returns (attacker_wins, margin).
pub fn resolve_star(
    attacker: &[CardStat],
    defender: &[CardStat],
    favored: Suit,
    attacker_seals: &[Suit],
    defender_seals: &[Suit],
) -> (bool, f32) {
    let ap = side_power(attacker, favored, attacker_seals);
    let dp = side_power(defender, favored, defender_seals);
    (ap > dp, ap - dp)
}

/// A star's pull on the zone meter, from its brightness + the win margin.
pub fn node_weight(magnitude: f32) -> f32 {
    (6.5 - magnitude).max(0.4) // 1st-mag ≈ 5.5+, faint ≈ 0.4
}

pub fn control_delta(magnitude: f32, margin: f32) -> i32 {
    let base = node_weight(magnitude) * 40.0;
    let bonus = (margin * 0.1).clamp(0.0, base);
    (base + bonus) as i32
}

/// Gentle-plateau bonus from combining copies of a card: big early gains that
/// taper to a hard +50% ceiling, so a leveled card is stronger but never runaway.
/// L1 ×1.00, L2 ≈ ×1.20, L3 ≈ ×1.32, L4 ≈ ×1.39 … → ×1.50.
pub fn level_mult(level: u8) -> f32 {
    1.0 + 0.5 * (1.0 - 0.6_f32.powi(level.max(1) as i32 - 1))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx(a: f32, b: f32) {
        assert!((a - b).abs() < 1e-3, "{a} is not ~ {b}");
    }

    #[test]
    fn level_mult_floor_then_plateaus_under_a_hard_ceiling() {
        // L1 is the freshly-minted baseline; the documented early anchors hold.
        approx(level_mult(0), 1.0);
        approx(level_mult(1), 1.0);
        approx(level_mult(2), 1.20);
        approx(level_mult(3), 1.32);
        // The bonus never exceeds +50%, at any possible level (it reaches the
        // ceiling exactly only once the f32 power underflows — never above it).
        for lvl in 0u8..=255 {
            let m = level_mult(lvl);
            assert!((1.0..=1.5).contains(&m), "level {lvl} -> {m} escaped [1.0, 1.5]");
        }
        assert!(level_mult(255) >= 1.499, "the ceiling should be all but reached");
    }

    #[test]
    fn level_mult_is_strictly_monotonic_in_the_playable_range() {
        let mut prev = level_mult(1);
        for lvl in 2u8..=20 {
            let m = level_mult(lvl);
            assert!(m > prev, "level {lvl} ({m}) did not exceed previous ({prev})");
            prev = m;
        }
    }

    #[test]
    fn weather_lifts_its_suit_and_suppresses_the_opposite() {
        approx(element_weather(Suit::Wands, Suit::Wands), 1.35); // favored
        approx(element_weather(Suit::Cups, Suit::Wands), 0.75); // Water opposes Fire
        approx(element_weather(Suit::Wands, Suit::Cups), 0.75);
        approx(element_weather(Suit::Swords, Suit::Pentacles), 0.75); // Air opposes Earth
        approx(element_weather(Suit::Pentacles, Suit::Swords), 0.75);
        approx(element_weather(Suit::Swords, Suit::Wands), 1.0); // perpendicular — untouched
        approx(element_weather(Suit::Pentacles, Suit::Wands), 1.0);
    }

    #[test]
    fn node_weight_rewards_brightness_above_a_floor() {
        assert!(node_weight(-1.5) > node_weight(1.0)); // Sirius outweighs a 1st-mag star
        approx(node_weight(1.0), 5.5);
        approx(node_weight(6.5), 0.4); // faint floor
        approx(node_weight(12.0), 0.4); // never below it
    }

    #[test]
    fn control_delta_scales_with_brightness_and_clamps_the_margin_bonus() {
        assert_eq!(control_delta(1.0, 0.0), 220); // 5.5 * 40, no margin bonus
        assert!(control_delta(1.0, 1000.0) > control_delta(1.0, 0.0)); // a bigger win helps
        assert!(control_delta(1.0, 1e9) <= 2 * 220); // but the bonus is capped to the base
    }
}
