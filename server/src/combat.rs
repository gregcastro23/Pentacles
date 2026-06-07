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

fn card_strength(c: &CardStat) -> f32 {
    c.attack as f32 + c.health as f32 * 0.5 + c.armour as f32 * 0.4
}

/// Total effective power of a side under the favored element.
fn side_power(cards: &[CardStat], favored: Suit) -> f32 {
    cards
        .iter()
        .map(|c| card_strength(c) * element_weather(c.suit, favored))
        .sum()
}

/// Resolve attacker vs defender under the current sky. Returns (attacker_wins, margin).
pub fn resolve_star(attacker: &[CardStat], defender: &[CardStat], favored: Suit) -> (bool, f32) {
    let ap = side_power(attacker, favored);
    let dp = side_power(defender, favored);
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
