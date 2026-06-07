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

/// (health, attack, armour, cooldown_ms) from one placement. Stats come from the
/// birth degree/minute/dignity; the flat per-suit perks are gone (a suit's edge
/// is environmental now). Rank is decided separately by the decan/tarot rules.
fn card_stats(p: &Placement) -> (u16, u16, u16, u16) {
    let degree = p.degree() as u16; // 0..29
    let minute = p.minute() as u16; // 0..59
    let dignity_mult = 1.0 + p.dignity as f32 * 0.08; // 0.6 .. 1.4

    let health = 12 + minute * 28 / 59;
    let attack = ((6 + degree) as f32 * dignity_mult) as u16;
    let armour = 4 + if is_fixed(p.sign) { 8 } else { 0 };
    let cooldown = (3000_i32 - if is_cardinal(p.sign) { 800 } else { 0 } - degree as i32 * 20)
        .clamp(800, 3000) as u16;
    (health, attack, armour, cooldown)
}

/// Decan index (0,1,2) within a sign: 0–9° · 10–19° · 20–29°.
fn decan(degree: u8) -> u8 { (degree / 10).min(2) }

/// Minor pip number for a sign+degree (Golden Dawn decans): cardinal signs run
/// 2–4, fixed 5–7, mutable 8–10, indexed by decan.
fn pip_rank(sign: u8, degree: u8) -> u8 {
    let base = if is_cardinal(sign) { 2 } else if is_fixed(sign) { 5 } else { 8 };
    base + decan(degree)
}

/// Court (Page 11 / Knight 12 / Queen 13 / King 14) for an elevated body, by the
/// strength of its dignity.
fn court_for_dignity(dignity: i8) -> u8 {
    match dignity {
        d if d >= 5 => 14, // King — rulership
        d if d >= 3 => 13, // Queen — exaltation
        d if d >= 1 => 12, // Knight — mild dignity
        _ => 11,           // Page — peregrine / debilitated but angular
    }
}

/// Major-Arcana index (0..21) attributed to each planet — the deck's trumps.
fn planet_major(p: Planet) -> u8 {
    match p {
        Planet::Sun => 19,     // The Sun
        Planet::Moon => 18,    // The Moon
        Planet::Mercury => 1,  // The Magician
        Planet::Venus => 3,    // The Empress
        Planet::Mars => 16,    // The Tower
        Planet::Jupiter => 10, // Wheel of Fortune
        Planet::Saturn => 21,  // The World
        Planet::Uranus => 0,   // The Fool
        Planet::Neptune => 12, // The Hanged Man
        Planet::Pluto => 20,   // Judgement
    }
}

/// Trumps sit a tier above the pips (tunable). Stats still derive from the
/// placement; this is the only rank-driven scaling, reserved for Majors.
const TRUMP_MULT: f32 = 1.5;

/// Weighted dignity vector → a score per planet (index by `Planet::idx`).
pub fn faction_scores(chart: &NatalChart) -> [f32; 10] {
    let mut s = [0.0f32; 10];
    let asc_sign = ((chart.ascendant / 1800) % 12) as u8;

    // Chart ruler (Ascendant lord) ×3.
    s[sign_ruler(asc_sign).idx()] += 3.0;

    for p in &chart.placements {
        s[p.body.idx()] += 1.0 + p.dignity as f32 * 0.4;
        if angular(p, chart) {
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

/// Mint the starting deck from the chart; returns (deck_seed, card_count).
///
/// Each placement yields two cards: a Minor (its decan pip — or an Ace for the
/// chart ruler, or a court for angular & sign-ruling bodies) and the placement's
/// planetary Major trump. Minor suit = the sign's element; Major suit = the
/// planet's. Stats come from the placement; the flat per-suit perks are gone.
pub fn mint_deck(
    ctx: &ReducerContext,
    owner: Identity,
    chart: &NatalChart,
    chart_ruler: Planet,
) -> (u64, usize) {
    let seed = deck_seed(&chart.placements);
    let mut active = 0u32;
    let mut count = 0usize;

    for p in &chart.placements {
        let (health, attack, armour, cooldown_ms) = card_stats(p);

        // Minor rank: the chart ruler mints the Ace; angular or sign-ruling bodies
        // are elevated to a court by dignity; everyone else is their decan pip.
        let rank = if p.body == chart_ruler {
            1 // Ace of the sign's element-suit
        } else if angular(p, chart) || sign_ruler(p.sign) == p.body {
            court_for_dignity(p.dignity)
        } else {
            pip_rank(p.sign, p.degree())
        };

        let minor = ctx.db.card().insert(Card {
            card_id: 0,
            owner,
            suit: sign_element(p.sign),
            rank,
            health,
            attack,
            armour,
            cooldown_ms,
            source_body: p.body,
            inverted: p.retrograde,
            is_trump: false,
        });
        mint_slot(ctx, owner, minor.card_id, &mut active);
        count += 1;

        // Every placement also mints its planet's Major trump — suited by planet,
        // weather-bound, a tier above the pips.
        let major = ctx.db.card().insert(Card {
            card_id: 0,
            owner,
            suit: p.body.biased_suit(),
            rank: planet_major(p.body), // arcana index 0..21; is_trump disambiguates
            health: (health as f32 * TRUMP_MULT) as u16,
            attack: (attack as f32 * TRUMP_MULT) as u16,
            armour: (armour as f32 * TRUMP_MULT) as u16,
            cooldown_ms,
            source_body: p.body,
            inverted: p.retrograde,
            is_trump: true,
        });
        mint_slot(ctx, owner, major.card_id, &mut active);
        count += 1;
    }

    (seed, count)
}

/// First 8 cards land in the Active loadout, the rest on the Bench.
fn mint_slot(ctx: &ReducerContext, owner: Identity, card_id: u64, active: &mut u32) {
    let loadout = if *active < 8 { *active += 1; Loadout::Active } else { Loadout::Bench };
    ctx.db.deck_slot().insert(DeckSlot { slot_id: 0, owner, card_id, loadout });
}
