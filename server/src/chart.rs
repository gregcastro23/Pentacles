//! Astrology → game: faction scoring and deterministic deck minting.
//! Pure where possible; `mint_deck` is the only fn that writes (it inserts cards).

use crate::tables::*;
use crate::types::*;
use spacetimedb::{Identity, ReducerContext, Table};

const FULL_WHEEL: u16 = 21600; // 360° * 60'

/// Sign (0=Aries) → suit of its triplicity.
pub fn sign_element(sign: u8) -> Suit {
    match sign % 4 {
        0 => Suit::Wands,      // Fire
        1 => Suit::Pentacles,  // Earth
        2 => Suit::Swords,     // Air
        _ => Suit::Cups,       // Water
    }
}

/// Traditional/modern rulerships (outer planets rule the modern signs).
pub fn sign_ruler(sign: u8) -> Planet {
    match sign % 12 {
        0 => Planet::Mars,     // Aries
        1 => Planet::Venus,    // Taurus
        2 => Planet::Mercury,  // Gemini
        3 => Planet::Moon,     // Cancer
        4 => Planet::Sun,      // Leo
        5 => Planet::Mercury,  // Virgo
        6 => Planet::Venus,    // Libra
        7 => Planet::Pluto,    // Scorpio
        8 => Planet::Jupiter,  // Sagittarius
        9 => Planet::Saturn,   // Capricorn
        10 => Planet::Uranus,  // Aquarius
        _ => Planet::Neptune,  // Pisces
    }
}

fn is_fixed(sign: u8) -> bool { matches!(sign % 12, 1 | 4 | 7 | 10) }
fn is_cardinal(sign: u8) -> bool { matches!(sign % 12, 0 | 3 | 6 | 9) }

fn circ_dist(a: u16, b: u16) -> u16 {
    let d = (a as i32 - b as i32).unsigned_abs() as u16;
    d.min(FULL_WHEEL - d)
}

/// A placement is "angular" if it sits within 10° of the Ascendant or Midheaven.
fn angular(p: &Placement, chart: &NatalChart) -> bool {
    circ_dist(p.abs_minutes(), chart.ascendant) < 600
        || circ_dist(p.abs_minutes(), chart.midheaven) < 600
}

/// Deterministic deck key (FNV-1a over the placements).
fn deck_seed(placements: &[Placement]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for p in placements {
        for b in [
            p.body.idx() as u8, p.sign,
            (p.arc_minutes >> 8) as u8, p.arc_minutes as u8,
            p.retrograde as u8, p.dignity as u8,
        ] {
            h ^= b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    }
    h
}

/// (health, attack, armour, cooldown_ms, rank) from one placement.
fn card_stats(p: &Placement, suit: Suit) -> (u16, u16, u16, u16, u8) {
    let degree = p.degree() as u16; // 0..29
    let minute = p.minute() as u16; // 0..59
    let dignity_mult = 1.0 + p.dignity as f32 * 0.08; // 0.6 .. 1.4

    let health = 12 + minute * 28 / 59 + if suit == Suit::Cups { 10 } else { 0 };
    let attack = ((6 + degree) as f32 * dignity_mult) as u16
        + if suit == Suit::Swords { 6 } else { 0 };
    let armour = 4
        + if is_fixed(p.sign) { 8 } else { 0 }
        + if suit == Suit::Pentacles { 6 } else { 0 };
    let cooldown = (3000_i32
        - if is_cardinal(p.sign) { 800 } else { 0 }
        - if suit == Suit::Wands { 600 } else { 0 }
        - degree as i32 * 20)
        .clamp(800, 3000) as u16;
    let rank = (1 + degree * 13 / 29) as u8; // 1..14
    (health, attack, armour, cooldown, rank)
}

/// Weighted dignity vector → a score per planet (index by `Planet::idx`).
pub fn faction_scores(chart: &NatalChart) -> [f32; 10] {
    let mut s = [0.0f32; 10];
    let asc_sign = ((chart.ascendant / 1800) % 12) as u8;

    // Chart ruler (Ascendant lord) ×3.
    s[sign_ruler(asc_sign).idx()] += 3.0;

    // Stellium: 3+ bodies sharing a sign each lend extra weight (GDD §02).
    let mut sign_counts = [0u8; 12];
    for p in &chart.placements {
        sign_counts[(p.sign % 12) as usize] += 1;
    }

    for p in &chart.placements {
        s[p.body.idx()] += 1.0 + p.dignity as f32 * 0.4;
        if angular(p, chart) {
            s[p.body.idx()] += 1.5;
        }
        if sign_counts[(p.sign % 12) as usize] >= 3 {
            s[p.body.idx()] += 1.5;
        }
        // Sun & Moon sign rulers ×2.
        if p.body == Planet::Sun {
            s[sign_ruler(p.sign).idx()] += 2.0;
        }
        if p.body == Planet::Moon {
            s[sign_ruler(p.sign).idx()] += 2.0;
        }
    }
    s
}

/// Human-readable rank label (Ace, Two … Page, Knight, Queen, King).
pub fn rank_label(rank: u8) -> &'static str {
    match rank {
        1 => "Ace", 2 => "Two", 3 => "Three", 4 => "Four", 5 => "Five",
        6 => "Six", 7 => "Seven", 8 => "Eight", 9 => "Nine", 10 => "Ten",
        11 => "Page", 12 => "Knight", 13 => "Queen", 14 => "King", _ => "Ace",
    }
}

/// A Minor-Arcana card's display name, e.g. "Knight of Wands".
pub fn card_name(suit: Suit, rank: u8) -> String {
    format!("{} of {:?}", rank_label(rank), suit)
}

/// Mint the starting deck from the chart; returns (deck_seed, card_count).
pub fn mint_deck(
    ctx: &ReducerContext,
    owner: Identity,
    chart: &NatalChart,
    faction: Planet,
    chart_ruler: Planet,
) -> (u64, usize) {
    let seed = deck_seed(&chart.placements);
    let mut active = 0u32;

    for p in &chart.placements {
        let suit = sign_element(p.sign);
        let (health, attack, armour, cooldown_ms, mut rank) = card_stats(p, suit);

        // Court cards (Page–King = 11..14) are reserved for angular & ruling bodies.
        if angular(p, chart) || p.body == chart_ruler {
            rank = 11 + (rank % 4);
        }

        let card = ctx.db.card().insert(Card {
            card_id: 0,
            owner,
            name: card_name(suit, rank),
            suit,
            rank,
            health,
            attack,
            armour,
            cooldown_ms,
            source_body: p.body,
            inverted: p.retrograde,
            is_trump: false,
        });

        let loadout = if active < 8 { active += 1; Loadout::Active } else { Loadout::Bench };
        ctx.db.deck_slot().insert(DeckSlot { slot_id: 0, owner, card_id: card.card_id, loadout });
    }

    // The single Major-Arcana hero trump, attributed to the faction's planet.
    let hero = ctx.db.card().insert(Card {
        card_id: 0,
        owner,
        name: faction.hero_trump().to_string(),
        suit: faction.biased_suit(),
        rank: 14,
        health: 60,
        attack: 40,
        armour: 20,
        cooldown_ms: 1500,
        source_body: faction,
        inverted: false,
        is_trump: true,
    });
    ctx.db.deck_slot().insert(DeckSlot {
        slot_id: 0,
        owner,
        card_id: hero.card_id,
        loadout: Loadout::Active,
    });

    (seed, chart.placements.len() + 1)
}
