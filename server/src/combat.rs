//! The suit triangle + the authoritative auto-siege resolver.
//!
//! Wands → Swords → Pentacles → Wands form the Fire/Air/Earth RPS core
//! (advantage ×1.5, disadvantage ×0.66). Cups (Water) sits outside as a pure
//! support axis — never typed-advantaged, but it pads health (see chart.rs).

use crate::types::Suit;

/// Flat stat snapshot a card contributes to a side.
#[derive(Clone, Copy)]
pub struct CardStat {
    pub suit: Suit,
    pub attack: u16,
    pub health: u16,
    pub armour: u16,
}

/// Directed advantage multiplier of an attacking suit into a defending suit.
pub fn suit_multiplier(att: Suit, def: Suit) -> f32 {
    use Suit::*;
    match (att, def) {
        (Wands, Swords) | (Swords, Pentacles) | (Pentacles, Wands) => 1.5,
        (Swords, Wands) | (Pentacles, Swords) | (Wands, Pentacles) => 0.66,
        _ => 1.0, // Cups either way, mirror matchups
    }
}

fn card_strength(c: &CardStat) -> f32 {
    c.attack as f32 + c.health as f32 * 0.5 + c.armour as f32 * 0.4
}

/// The suit a side leans on most (by total strength). Defaults to Cups.
pub fn dominant_suit(cards: &[CardStat]) -> Suit {
    let mut totals = [0.0f32; 4]; // Cups, Swords, Pentacles, Wands
    for c in cards {
        let i = match c.suit {
            Suit::Cups => 0,
            Suit::Swords => 1,
            Suit::Pentacles => 2,
            Suit::Wands => 3,
        };
        totals[i] += card_strength(c);
    }
    let mut best = 0usize;
    for i in 1..4 {
        if totals[i] > totals[best] {
            best = i;
        }
    }
    [Suit::Cups, Suit::Swords, Suit::Pentacles, Suit::Wands][best]
}

/// Total effective power of a side fought into a given enemy dominant suit.
fn side_power(cards: &[CardStat], vs: Suit) -> f32 {
    cards
        .iter()
        .map(|c| card_strength(c) * suit_multiplier(c.suit, vs))
        .sum()
}

/// Resolve attacker vs defender. Returns (attacker_wins, margin).
pub fn resolve_star(attacker: &[CardStat], defender: &[CardStat]) -> (bool, f32) {
    let a_dom = dominant_suit(attacker);
    let d_dom = dominant_suit(defender);
    let ap = side_power(attacker, d_dom);
    let dp = side_power(defender, a_dom);
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
