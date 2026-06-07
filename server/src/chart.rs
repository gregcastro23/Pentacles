//! Astrology → game: faction scoring and deterministic deck minting.
//! Pure where possible; `mint_deck` is the only fn that writes (it inserts cards).

use crate::tables::*;
use crate::types::*;
use spacetimedb::{Identity, ReducerContext, Table};

const FULL_WHEEL: u16 = 21600; // 360° * 60'
const SIGN_MINUTES: u16 = 1800; // 30° * 60' — one sign / one equal house
const OBLIQUITY_DEG: f64 = 23.439291; // mean obliquity (matches the feeder & SkyMath)

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
fn card_stats(p: &Placement, reception_boost: f32) -> (u16, u16, u16, u16) {
    let degree = p.degree() as u16; // 0..29
    let minute = p.minute() as u16; // 0..59
    let dignity_mult = 1.0 + (p.dignity as f32 + reception_boost * 2.0) * 0.08; // 0.6 .. 1.4+

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
        Planet::Moon => 2,     // The High Priestess (the Moon's trump; XVIII/The Moon is Pisces')
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

/// Calculate reception & mutual reception boosts for each planet.
/// A planet is received by another if it sits in a sign ruled by that planet.
/// If received, it gets a reception boost (+0.5).
/// If two planets are in mutual reception (sitting in each other's signs), both get a mutual reception boost (+1.5).
pub fn calculate_reception_boosts(chart: &NatalChart) -> [f32; 10] {
    let mut boosts = [0.0f32; 10];
    for p in &chart.placements {
        let ruler = sign_ruler(p.sign);
        if ruler != p.body {
            boosts[p.body.idx()] += 0.5;
        }
    }
    for i in 0..chart.placements.len() {
        for j in (i + 1)..chart.placements.len() {
            let p1 = &chart.placements[i];
            let p2 = &chart.placements[j];
            let r1 = sign_ruler(p1.sign);
            let r2 = sign_ruler(p2.sign);
            if r1 == p2.body && r2 == p1.body {
                boosts[p1.body.idx()] += 1.5;
                boosts[p2.body.idx()] += 1.5;
            }
        }
    }
    boosts
}

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

    // Add reception & mutual reception boosts
    let reception_boosts = calculate_reception_boosts(chart);
    for i in 0..10 {
        s[i] += reception_boosts[i];
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
    let reception_boosts = calculate_reception_boosts(chart);

    for p in &chart.placements {
        let reception_boost = reception_boosts[p.body.idx()];
        let (health, attack, armour, cooldown_ms) = card_stats(p, reception_boost);

        // Minor rank: the chart ruler mints the Ace; angular or sign-ruling bodies
        // are elevated to a court by dignity; everyone else is their decan pip.
        let effective_dignity = p.dignity + (reception_boost * 2.0) as i8;
        let rank = if p.body == chart_ruler {
            1 // Ace of the sign's element-suit
        } else if angular(p, chart) || sign_ruler(p.sign) == p.body {
            court_for_dignity(effective_dignity)
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
            level: 1,
            minted_at: ctx.timestamp,
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
            level: 1,
            minted_at: ctx.timestamp,
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

/// Light essential dignity of a body in a sign, from rulership alone. (The full
/// natal dignity is computed client-side; this lean version serves sky-minting.)
/// Ruler +5, detriment — the ruler of the opposite sign — -5, else peregrine 0.
fn sky_dignity(body: Planet, sign: u8) -> i8 {
    if sign_ruler(sign) == body {
        5
    } else if sign_ruler((sign + 6) % 12) == body {
        -5
    } else {
        0
    }
}

// ── Blend: natal houses × the live transiting sky ───────────────────────────
//
// The "Blend" feeds the per-round draft below: it lays the natal faction base
// (`faction_scores`) under the live sky and lets transiting bodies push it around
// by *where* they fall in your houses and *how dignified* they are there. The
// leading body of the blended vector is the round's source — and because a transit
// crossing onto an angle weighs far more than one drifting through a cadent house,
// the favoured faction can open or close from one round to the next.

/// A live transit, reduced to what the blend needs: which body, where on the
/// ecliptic (absolute zodiac arc-minutes 0..21599), and whether it's retrograde now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TransitSnapshot {
    pub body: Planet,
    pub lon_arcmin: u16,
    pub retrograde: bool,
}

/// Equatorial (RA, Dec in degrees) → ecliptic longitude in arc-minutes (0..21599).
/// Inverts the feeder's `eclipticToEquatorial(lon, 0)`, so a body the feeder placed
/// from its ecliptic longitude round-trips back to that longitude here (the
/// ephemeris row stores only RA/Dec + a horizon-frame zone, not the zodiac λ).
pub fn ecliptic_lon_arcmin(ra_deg: f64, dec_deg: f64) -> u16 {
    let e = OBLIQUITY_DEG.to_radians();
    let (ra, dec) = (ra_deg.to_radians(), dec_deg.to_radians());
    let lon = (ra.sin() * e.cos() + dec.tan() * e.sin()).atan2(ra.cos());
    let deg = lon.to_degrees().rem_euclid(360.0);
    ((deg * 60.0).round() as i64).rem_euclid(FULL_WHEEL as i64) as u16
}

/// The twelve house cusps as absolute zodiac arc-minutes — equal-house from the
/// Ascendant (cusp[0] = Ascendant, then every 30°). Robust at every latitude and
/// fully deterministic; the GDD's Placidus refinement is a future swap-in.
pub fn house_cusps(chart: &NatalChart) -> [u16; 12] {
    let mut cusps = [0u16; 12];
    for (i, c) in cusps.iter_mut().enumerate() {
        *c = (chart.ascendant + i as u16 * SIGN_MINUTES) % FULL_WHEEL;
    }
    cusps
}

/// Which house (1..12) an absolute ecliptic longitude falls in, given the cusps.
pub fn house_of(cusps: &[u16; 12], lon_arcmin: u16) -> u8 {
    let rel = (lon_arcmin + FULL_WHEEL - cusps[0]) % FULL_WHEEL;
    (rel / SIGN_MINUTES) as u8 + 1
}

/// How much a house weighs in the blend: angular houses dominate, cadent fade.
/// (Angular 1/4/7/10, succedent 2/5/8/11, cadent 3/6/9/12.)
pub fn house_salience(house: u8) -> f32 {
    match house {
        1 | 4 | 7 | 10 => 3.0,
        2 | 5 | 8 | 11 => 1.5,
        _ => 0.5,
    }
}

/// How hard transits push the natal base around. Big enough that a transit crossing
/// onto an angle can overtake the natal favourite — transits open & close factions.
const TRANSIT_WEIGHT: f32 = 2.0;

/// Blend the natal faction base with the live sky. Each transiting body lifts its
/// own faction by (house salience × its sky-dignity there), so a dignified planet
/// sitting on an angle weighs far more than one peregrine in a cadent house. The
/// result is the round's source vector. (Houses are suppressed on a solar chart —
/// `time_known == false` — so salience goes flat and only dignity modulates.)
pub fn blended_faction_vector(chart: &NatalChart, transits: &[TransitSnapshot]) -> [f32; 10] {
    let mut v = faction_scores(chart);
    let cusps = house_cusps(chart);
    for t in transits {
        let sign = ((t.lon_arcmin / SIGN_MINUTES) % 12) as u8;
        let dig = sky_dignity(t.body, sign);
        let salience = if chart.time_known {
            house_salience(house_of(&cusps, t.lon_arcmin))
        } else {
            1.0
        };
        v[t.body.idx()] += TRANSIT_WEIGHT * salience * (1.0 + 0.2 * dig as f32);
    }
    v
}

/// The transit the blend favours most — the round's source body and where it sits.
/// Restricted to bodies actually present in the live sky (we need their position).
pub fn leading_transit<'a>(
    chart: &NatalChart,
    transits: &'a [TransitSnapshot],
) -> Option<&'a TransitSnapshot> {
    let v = blended_faction_vector(chart, transits);
    transits.iter().max_by(|a, b| {
        v[a.body.idx()]
            .partial_cmp(&v[b.body.idx()])
            .unwrap_or(std::cmp::Ordering::Equal)
    })
}

// ── Draft: the successful-round reward card (the repointed Sky-Drop) ─────────
//
// Cards are gained exactly two ways: the onboarding deck (`mint_deck`), and one
// auto-drafted card at the end of a *successful* round. This is that draft — the
// old per-capture Sky-Drop, repointed. It is a pure value so the whole draft is
// deterministic and unit-testable; `reducers::draft_one` writes the row.

/// The shape of a drafted card before it's written.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct DraftSpec {
    pub suit: Suit,
    pub rank: u8, // always a pip (2..10) — never an Ace, a court (natal-reserved), or a trump (hero)
    pub health: u16,
    pub attack: u16,
    pub armour: u16,
    pub cooldown_ms: u16,
    pub source_body: Planet,
    pub inverted: bool,
}

/// Deterministic per-round draft seed: identity × round index × source body. The
/// same chart, sky snapshot, and round index always reproduce the same card.
pub fn drop_seed(owner: Identity, round_index: u64, body: Planet) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in owner.to_byte_array() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    for b in round_index.to_le_bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h ^= body.idx() as u64;
    h.wrapping_mul(0x100000001b3)
}

/// Stat multiplier for a draft: `transit_strength × natal dignity`, mapped to a
/// gentle band. Strong when a body that's well-dignified *in your chart* is also
/// prominent in today's sky; weak when neither holds. Monotonic in both, and
/// always in [0.75, 1.35] so a draft never balloons.
pub fn draft_power_mult(transit_strength: f32, natal_dignity: i8) -> f32 {
    let dignity_factor = (1.0 + 0.15 * natal_dignity as f32).max(0.25); // -5→0.25 … +5→1.75
    let raw = transit_strength.max(0.0) * dignity_factor;
    (0.75 + 0.02 * raw).clamp(0.75, 1.35)
}

/// Reverse a card's stats for a retrograde source: offense and defense swap and
/// vitality is dampened — a card that fights against its own grain.
fn invert_stats(health: u16, attack: u16, armour: u16, cooldown_ms: u16) -> (u16, u16, u16, u16) {
    (
        (health as f32 * 0.85) as u16,                 // dampened vitality
        armour,                                        // attack ← armour
        attack,                                        // armour ← attack
        (cooldown_ms as u32 * 6 / 5).min(3000) as u16, // +20% slower, capped
    )
}

/// Effective strength of a spec, matching combat's `card_strength` weighting — used
/// to decide cap replacement (a stronger draft displaces the weakest bench card).
pub fn spec_strength(s: &DraftSpec) -> f32 {
    s.attack as f32 + s.health as f32 * 0.5 + s.armour as f32 * 0.4
}

/// A body's essential dignity in the player's natal chart (its placement's dignity),
/// or peregrine (0) if the chart has no placement for it.
fn natal_dignity_of(chart: &NatalChart, body: Planet) -> i8 {
    chart
        .placements
        .iter()
        .find(|p| p.body == body)
        .map(|p| p.dignity)
        .unwrap_or(0)
}

/// Draft one card from the blended sky for a successful round. Pure and
/// deterministic: same (chart, transits, round_index, owner) → same `DraftSpec`.
///
/// - Source: the body the blend leads with this tick (transits can open/close it).
/// - Suit: the element of that body's transit sign.
/// - Rank: the decan pip (2..10) — never an Ace's reserved 1, a court, or a trump.
/// - Power: transit_strength (the body's blended sky prominence × the salience of
///   the house it transits) × its natal dignity, shaping the reused Sky-Drop stat
///   block, then clamped strictly below the owner's hero trump.
/// - Inversion: a retrograde source yields `inverted: true` with reversed stats.
///
/// Returns `None` only when there is no live sky to draft from.
pub fn draft_card(
    chart: &NatalChart,
    transits: &[TransitSnapshot],
    round_index: u64,
    owner: Identity,
    hero_ceiling: Option<(u16, u16, u16)>, // (attack, health, armour) of the hero trump
) -> Option<DraftSpec> {
    let v = blended_faction_vector(chart, transits);
    let lead = leading_transit(chart, transits)?;
    let body = lead.body;
    let sign = ((lead.lon_arcmin / SIGN_MINUTES) % 12) as u8;
    let degree = ((lead.lon_arcmin % SIGN_MINUTES) / 60) as u8; // 0..29
    let suit = sign_element(sign);
    let rank = pip_rank(sign, degree); // 2..10 — already a pip, never court/trump

    // Power: this body's blended prominence × the salience of the house it transits
    // × its natal dignity. The arc-minute is drawn from the deterministic drop seed,
    // NOT the wall clock (that would break reproducibility).
    let seed = drop_seed(owner, round_index, body);
    let salience = if chart.time_known {
        house_salience(house_of(&house_cusps(chart), lead.lon_arcmin))
    } else {
        1.0
    };
    let transit_strength = v[body.idx()].max(0.0) * salience;
    let power = draft_power_mult(transit_strength, natal_dignity_of(chart, body));

    let placement = Placement {
        body,
        sign,
        arc_minutes: degree as u16 * 60 + (seed % 60) as u16,
        retrograde: lead.retrograde,
        dignity: sky_dignity(body, sign),
    };
    let (h, a, ar, cd) = card_stats(&placement, 0.0); // reuse the Sky-Drop stat shaping
    let mut health = (h as f32 * power) as u16;
    let mut attack = (a as f32 * power) as u16;
    let mut armour = (ar as f32 * power) as u16;
    let mut cooldown_ms = cd;

    // Retrograde source → inverted card with reversed stats.
    let inverted = lead.retrograde;
    if inverted {
        let (ih, ia, iar, icd) = invert_stats(health, attack, armour, cooldown_ms);
        health = ih;
        attack = ia;
        armour = iar;
        cooldown_ms = icd;
    }

    // Clamp strictly below the hero trump — the draft never rivals the keystone.
    if let Some((ca, ch, car)) = hero_ceiling {
        attack = attack.min(ca.saturating_sub(1));
        health = health.min(ch.saturating_sub(1));
        armour = armour.min(car.saturating_sub(1));
    }

    Some(DraftSpec {
        suit,
        rank,
        health,
        attack,
        armour,
        cooldown_ms,
        source_body: body,
        inverted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Test helpers ────────────────────────────────────────────────────────

    fn chart_asc(asc_arcmin: u16, time_known: bool, placements: Vec<Placement>) -> NatalChart {
        NatalChart {
            identity: Identity::ZERO,
            birth_unix: 0,
            birth_lat: 0.0,
            birth_lon: 0.0,
            time_known,
            placements,
            ascendant: asc_arcmin,
            midheaven: (asc_arcmin + 5400) % FULL_WHEEL, // ~90° off — irrelevant to these tests
        }
    }

    /// Replicates the feeder's `eclipticToEquatorial(lon, 0)` for the round-trip test.
    fn ecl_to_eq(lon_deg: f64) -> (f64, f64) {
        let e = OBLIQUITY_DEG.to_radians();
        let l = lon_deg.to_radians();
        let dec = (e.sin() * l.sin()).asin();
        let ra = (l.sin() * e.cos()).atan2(l.cos());
        (ra.to_degrees().rem_euclid(360.0), dec.to_degrees())
    }

    fn circ_deg(a: f64, b: f64) -> f64 {
        let d = (a - b).rem_euclid(360.0);
        d.min(360.0 - d)
    }

    // ── Houses ────────────────────────────────────────────────────────────────

    #[test]
    fn equal_house_cusps_anchor_on_the_ascendant() {
        let chart = chart_asc(900, true, vec![]); // Asc 15° Aries
        let cusps = house_cusps(&chart);
        assert_eq!(cusps[0], 900);
        assert_eq!(cusps[3], (900 + 3 * SIGN_MINUTES) % FULL_WHEEL);
        assert_eq!(house_of(&cusps, 900), 1); // the Ascendant itself opens house 1
        assert_eq!(house_of(&cusps, 900 + 3 * SIGN_MINUTES), 4); // a quarter on is the IC/4th
        assert_eq!(house_of(&cusps, (900 + 11 * SIGN_MINUTES) % FULL_WHEEL), 12);
    }

    #[test]
    fn salience_ranks_angular_over_succedent_over_cadent() {
        for h in [1u8, 4, 7, 10] {
            assert_eq!(house_salience(h), 3.0);
        }
        for h in [2u8, 5, 8, 11] {
            assert_eq!(house_salience(h), 1.5);
        }
        for h in [3u8, 6, 9, 12] {
            assert_eq!(house_salience(h), 0.5);
        }
    }

    #[test]
    fn ecliptic_longitude_round_trips_from_equatorial() {
        for lon in [0.0, 30.0, 45.0, 90.0, 137.0, 180.0, 270.0, 359.0] {
            let (ra, dec) = ecl_to_eq(lon);
            let back = ecliptic_lon_arcmin(ra, dec) as f64 / 60.0;
            assert!(circ_deg(back, lon) < 0.05, "λ {lon}° round-tripped to {back}°");
        }
    }

    // ── Blend ─────────────────────────────────────────────────────────────────

    #[test]
    fn blend_is_deterministic() {
        let chart = chart_asc(900, true, vec![]);
        let snap = vec![
            TransitSnapshot { body: Planet::Mars, lon_arcmin: 1800, retrograde: false },
            TransitSnapshot { body: Planet::Venus, lon_arcmin: 7200, retrograde: false },
        ];
        assert_eq!(blended_faction_vector(&chart, &snap), blended_faction_vector(&chart, &snap));
    }

    #[test]
    fn transit_crossing_into_a_new_house_changes_the_leading_body() {
        // Asc 15° Aries. One Sun placement keeps the natal base off Jupiter/Saturn,
        // so the house a transit sits in decides which of them leads.
        let chart = chart_asc(
            900,
            true,
            vec![Placement { body: Planet::Sun, sign: 4, arc_minutes: 900, retrograde: false, dignity: 5 }],
        );
        // Saturn fixed in the succedent 2nd (60° = Gemini, peregrine).
        let saturn = TransitSnapshot { body: Planet::Saturn, lon_arcmin: 3600, retrograde: false };
        // Jupiter angular in the 1st (30° = Taurus, peregrine): it leads.
        let on_angle = vec![
            TransitSnapshot { body: Planet::Jupiter, lon_arcmin: 1800, retrograde: false },
            saturn,
        ];
        // Jupiter drifted to the cadent 3rd (90° = Cancer, peregrine): Saturn leads now.
        let cadent = vec![
            TransitSnapshot { body: Planet::Jupiter, lon_arcmin: 5400, retrograde: false },
            saturn,
        ];
        assert_eq!(leading_transit(&chart, &on_angle).unwrap().body, Planet::Jupiter);
        assert_eq!(leading_transit(&chart, &cadent).unwrap().body, Planet::Saturn);
    }

    // ── Draft ───────────────────────────────────────────────────────────────

    fn draft_fixture() -> (NatalChart, Vec<TransitSnapshot>) {
        let chart = chart_asc(
            900,
            true,
            vec![Placement { body: Planet::Sun, sign: 4, arc_minutes: 900, retrograde: false, dignity: 5 }],
        );
        let snap = vec![
            TransitSnapshot { body: Planet::Jupiter, lon_arcmin: 1800, retrograde: false }, // leads (angular)
            TransitSnapshot { body: Planet::Saturn, lon_arcmin: 3600, retrograde: false },
        ];
        (chart, snap)
    }

    #[test]
    fn same_inputs_draft_the_same_card() {
        let (chart, snap) = draft_fixture();
        let a = draft_card(&chart, &snap, 7, Identity::ZERO, None).unwrap();
        let b = draft_card(&chart, &snap, 7, Identity::ZERO, None).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn drop_seed_is_deterministic_and_separates_round_and_body() {
        assert_eq!(
            drop_seed(Identity::ZERO, 5, Planet::Mars),
            drop_seed(Identity::ZERO, 5, Planet::Mars),
        );
        assert_ne!(
            drop_seed(Identity::ZERO, 5, Planet::Mars),
            drop_seed(Identity::ZERO, 6, Planet::Mars),
        );
        assert_ne!(
            drop_seed(Identity::ZERO, 5, Planet::Mars),
            drop_seed(Identity::ZERO, 5, Planet::Venus),
        );
    }

    #[test]
    fn a_retrograde_source_inverts_and_reverses_the_stats() {
        let (chart, snap) = draft_fixture();
        let upright = draft_card(&chart, &snap, 3, Identity::ZERO, None).unwrap();
        // Same sky, but the leading body (Jupiter) is now retrograde.
        let mut retro_snap = snap.clone();
        retro_snap[0].retrograde = true;
        let inverted = draft_card(&chart, &retro_snap, 3, Identity::ZERO, None).unwrap();

        assert!(!upright.inverted);
        assert!(inverted.inverted);
        assert_eq!(inverted.source_body, upright.source_body); // same source, reversed effect
        assert_eq!(inverted.attack, upright.armour); // offense ↔ defense swapped
        assert_eq!(inverted.armour, upright.attack);
        assert!(inverted.health <= upright.health); // vitality dampened
        assert!(inverted.cooldown_ms >= upright.cooldown_ms); // and slower
    }

    #[test]
    fn drafted_rank_is_always_a_pip() {
        // pip_rank itself, across the whole zodiac:
        for sign in 0..12u8 {
            for deg in 0..30u8 {
                assert!((1..=10).contains(&pip_rank(sign, deg)), "{sign}/{deg} escaped 1..=10");
            }
        }
        // and as it surfaces through the draft:
        let (chart, snap) = draft_fixture();
        for round in 0..50u64 {
            let spec = draft_card(&chart, &snap, round, Identity::ZERO, None).unwrap();
            assert!((1..=10).contains(&spec.rank), "round {round} drafted rank {}", spec.rank);
        }
    }

    #[test]
    fn draft_is_clamped_strictly_below_the_hero_trump() {
        let (chart, snap) = draft_fixture();
        let natural = draft_card(&chart, &snap, 1, Identity::ZERO, None).unwrap();
        // Ceiling = the draft's own natural stats → every stat must come out strictly under.
        let ceiling = Some((natural.attack, natural.health, natural.armour));
        let clamped = draft_card(&chart, &snap, 1, Identity::ZERO, ceiling).unwrap();
        assert!(clamped.attack < natural.attack);
        assert!(clamped.health < natural.health);
        assert!(clamped.armour < natural.armour);
    }

    #[test]
    fn draft_power_rewards_dignity_and_prominence_within_a_band() {
        // Monotonic in natal dignity and in transit strength.
        assert!(draft_power_mult(10.0, 5) > draft_power_mult(10.0, -5));
        assert!(draft_power_mult(20.0, 0) >= draft_power_mult(5.0, 0));
        // Always inside the documented band.
        for ts in [0.0f32, 5.0, 50.0, 1000.0] {
            for d in [-5i8, 0, 5] {
                let m = draft_power_mult(ts, d);
                assert!((0.75..=1.35).contains(&m), "power {m} escaped [0.75, 1.35]");
            }
        }
    }
}
