//! The suit triangle + the authoritative auto-siege resolver.
//!
//! Wands → Swords → Pentacles → Wands form the Fire/Air/Earth RPS core
//! (advantage ×1.5, disadvantage ×0.66). Cups (Water) sits outside as a pure
//! support axis — never typed-advantaged, but it pads health (see chart.rs).

use crate::types::{Planet, Suit};

/// Flat stat snapshot a card contributes to a side.
#[derive(Clone, Copy)]
pub struct CardStat {
    pub suit: Suit,
    pub attack: u16,
    pub health: u16,
    pub armour: u16,
}

/// Faction attack multiplier — the offensive half of a doctrine (GDD §03).
/// Sun = vanguard aggressor, Mars = raw damage; the rest are neutral on attack
/// (their doctrines act elsewhere: decay, snowball, transit …).
pub fn faction_atk_mult(f: Planet) -> f32 {
    match f {
        Planet::Sun => 1.10,
        Planet::Mars => 1.20,
        _ => 1.0,
    }
}

/// Faction defense multiplier — scales a Sentinel's armour & health (GDD §03).
/// Saturn is the wall; Mars is penalised on defense (built to siege, not sit).
pub fn faction_def_mult(f: Planet) -> f32 {
    match f {
        Planet::Saturn => 1.20,
        Planet::Mars => 0.85,
        _ => 1.0,
    }
}

/// Fixed astrological relation between two factions (GDD §03). Symmetric:
/// allies share & defend, rivals clash at a bonus, everyone else is neutral.
#[derive(PartialEq, Eq, Clone, Copy, Debug)]
pub enum Relation {
    Ally,
    Rival,
    Neutral,
}

/// The standing harmony/opposition graph. Authored once, drives Venus's
/// alliance doctrine, hard non-aggression, and the rivalry combat bonus.
pub fn relation(a: Planet, b: Planet) -> Relation {
    use Planet::*;
    if a == b {
        return Relation::Neutral;
    }
    // Normalise to a single unordered pair (ascending declaration order).
    let (x, y) = if a.idx() <= b.idx() { (a, b) } else { (b, a) };
    match (x, y) {
        // Harmonies — luminaries, benefics, and higher-octave kinships.
        (Sun, Moon) | (Sun, Mercury) | (Sun, Mars) | (Sun, Jupiter)
        | (Moon, Venus) | (Moon, Neptune)
        | (Mercury, Saturn) | (Mercury, Uranus)
        | (Venus, Jupiter) | (Venus, Neptune)
        | (Mars, Jupiter) | (Mars, Pluto)
        | (Saturn, Pluto) => Relation::Ally,
        // Oppositions — light vs. limit, love vs. war, order vs. revolt.
        (Sun, Saturn)
        | (Moon, Saturn)
        | (Mercury, Neptune)
        | (Venus, Mars) | (Venus, Pluto)
        | (Saturn, Uranus) => Relation::Rival,
        _ => Relation::Neutral,
    }
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

/// Effective durability in the round loop — armour buffers health (GDD §06).
fn durability(c: &CardStat) -> f32 {
    (c.health as f32 + c.armour as f32).max(1.0)
}

/// Greedily destroy the weakest-durability living cards a damage budget can
/// afford; flips their `alive` flag and returns the kill count.
fn cull_weakest(side: &[CardStat], alive: &mut [bool], mut budget: f32) -> u32 {
    let mut order: Vec<usize> = (0..side.len()).filter(|&i| alive[i]).collect();
    order.sort_by(|&x, &y| {
        durability(&side[x])
            .partial_cmp(&durability(&side[y]))
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut killed = 0;
    for i in order {
        let d = durability(&side[i]);
        if budget >= d {
            alive[i] = false;
            budget -= d;
            killed += 1;
        } else {
            break;
        }
    }
    killed
}

/// Outcome of a round-based battle (GDD §06).
pub struct BattleOutcome {
    pub attacker_won: bool,
    pub margin: f32,
    /// Indices into `attacker` that survived — these earn XP (GDD §06).
    pub attacker_survivors: Vec<usize>,
    /// Cards destroyed across both sides — feeds Pluto attrition (GDD §03).
    pub destroyed: u32,
}

/// Round-based attrition (GDD §06). Each round both sides deal suit-scaled
/// damage simultaneously, the weakest cards that damage can afford are
/// destroyed, and the survivors heal to full. Runs until one side is wiped, or
/// a round cap is hit and the stronger remnant takes it.
pub fn simulate_battle(attacker: &[CardStat], defender: &[CardStat]) -> BattleOutcome {
    const MAX_ROUNDS: u32 = 8;
    let mut a_alive = vec![true; attacker.len()];
    let mut d_alive = vec![true; defender.len()];
    let mut destroyed = 0u32;

    for _ in 0..MAX_ROUNDS {
        let a_cards: Vec<CardStat> =
            (0..attacker.len()).filter(|&i| a_alive[i]).map(|i| attacker[i]).collect();
        let d_cards: Vec<CardStat> =
            (0..defender.len()).filter(|&i| d_alive[i]).map(|i| defender[i]).collect();
        if a_cards.is_empty() || d_cards.is_empty() {
            break;
        }
        let a_dom = dominant_suit(&a_cards);
        let d_dom = dominant_suit(&d_cards);
        // Both salvos are computed from the pre-round rosters, then applied.
        let a_dmg: f32 = a_cards.iter().map(|c| c.attack as f32 * suit_multiplier(c.suit, d_dom)).sum();
        let d_dmg: f32 = d_cards.iter().map(|c| c.attack as f32 * suit_multiplier(c.suit, a_dom)).sum();
        destroyed += cull_weakest(defender, &mut d_alive, a_dmg);
        destroyed += cull_weakest(attacker, &mut a_alive, d_dmg);
    }

    let attacker_survivors: Vec<usize> = (0..attacker.len()).filter(|&i| a_alive[i]).collect();
    let d_surv: Vec<usize> = (0..defender.len()).filter(|&i| d_alive[i]).collect();
    let a_power: f32 = attacker_survivors.iter().map(|&i| card_strength(&attacker[i])).sum();
    let d_power: f32 = d_surv.iter().map(|&i| card_strength(&defender[i])).sum();
    let attacker_won = match (attacker_survivors.is_empty(), d_surv.is_empty()) {
        (false, true) => true,               // defender wiped
        (true, _) => false,                  // attacker wiped (ties to the holder)
        (false, false) => a_power > d_power,  // round cap: the stronger remnant
    };

    BattleOutcome { attacker_won, margin: a_power - d_power, attacker_survivors, destroyed }
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
