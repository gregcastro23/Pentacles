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

// ════════════════════════════════════════════════════════════════════════════
//  Houses · live-transit blend · synastry
//
//  The natal base above (faction_scores / dignities) is static. This section
//  blends it with the live sky: which natal HOUSE each transiting body lights up,
//  and a synastry comparison for matchmaking. Everything here is pure and
//  deterministic. Dignity NEVER touches combat (GDD §02) — these feed the
//  per-round re-draft and matchmaking only.
// ════════════════════════════════════════════════════════════════════════════

/// Mean obliquity of the ecliptic — kept identical to feeder/ephemeris.ts and
/// reducers.rs so the server, feeder and Unity client all bend the sky alike.
pub const OBLIQUITY_DEG: f64 = 23.439291;

/// Beyond this geographic latitude (the polar circle) Placidus is undefined; we
/// fall back to Whole Sign there rather than emit garbage cusps.
pub const POLAR_CIRCLE_DEG: f64 = 66.5;

/// Default birthplace latitude when none was supplied — New York, NY
/// (40.7128, -74.0060). Only the latitude feeds Placidus; the RAMC is recovered
/// from the chart's MC, so no longitude is needed here.
pub const DEFAULT_LAT_DEG: f64 = 40.7128;

/// Fixed-point iterations per Placidus cusp. Placidus converges in well under
/// ten; thirty is deep past convergence and keeps the result deterministic and
/// numerically identical to the Unity mirror.
const PLACIDUS_ITERS: usize = 30;

/// Natal/transit blend split: the live sky *modulates* the natal base, it never
/// overrides it. Normalised natal counts 70%, normalised transit 30%.
pub const NATAL_BLEND: f32 = 0.70;
pub const TRANSIT_BLEND: f32 = 0.30;

/// House salience: angular houses (1/4/7/10) dominate, succedent (2/5/8/11) are
/// middling, cadent (3/6/9/12) faint. Drives how strongly a transit through — or
/// a synastry overlay into — a house counts.
pub fn house_salience(house: u8) -> f32 {
    match house {
        1 | 4 | 7 | 10 => 1.0,  // angular
        2 | 5 | 8 | 11 => 0.6,  // succedent
        _ => 0.35,              // cadent (3/6/9/12) and any out-of-range guard
    }
}

// ── arc-minute / degree helpers ─────────────────────────────────────────────

/// Degrees (any sign) → absolute zodiac arc-minutes (0..21599).
fn deg_to_min(deg: f64) -> u16 {
    let d = deg.rem_euclid(360.0);
    ((d * 60.0).round() as i64).rem_euclid(FULL_WHEEL as i64) as u16
}
/// Absolute arc-minutes → degrees (0..360).
fn min_to_deg(m: u16) -> f64 {
    m as f64 / 60.0
}

// ── Part A: Placidus house bounds ───────────────────────────────────────────

/// Ecliptic longitude (deg) of the ecliptic point sharing right ascension
/// `ra_deg`. Inverse of α = atan2(sinλ·cosε, cosλ).
fn ecliptic_lon_from_ra(ra_deg: f64, eps: f64) -> f64 {
    let ra = ra_deg.to_radians();
    ra.sin().atan2(ra.cos() * eps.cos()).to_degrees().rem_euclid(360.0)
}

/// Semidiurnal arc (deg, 0..180) of an ecliptic point at geographic latitude
/// `phi` (rad). Circumpolar points clamp to 0/180 rather than going NaN.
fn semidiurnal_arc(lon_deg: f64, phi: f64, eps: f64) -> f64 {
    let lon = lon_deg.to_radians();
    let decl = (eps.sin() * lon.sin()).asin();
    let x = (-(phi.tan()) * decl.tan()).clamp(-1.0, 1.0);
    x.acos().to_degrees()
}

/// One Placidus intermediate cusp by fixed-point iteration. The cusp is the
/// ecliptic point whose hour angle from the meridian is `frac` of its own
/// semidiurnal arc; `base` is the constant meridian offset (0/60/120°).
fn placidus_cusp(ramc: f64, phi: f64, eps: f64, base: f64, frac: f64) -> f64 {
    let mut ra = (ramc + base).rem_euclid(360.0);
    for _ in 0..PLACIDUS_ITERS {
        let lon = ecliptic_lon_from_ra(ra, eps);
        let sd = semidiurnal_arc(lon, phi, eps);
        ra = (ramc + base + frac * sd).rem_euclid(360.0);
    }
    ecliptic_lon_from_ra(ra, eps)
}

/// Whole-Sign cusps: each house is a whole sign starting at 0°, the 1st being the
/// sign `asc_min` falls in. The polar / time-unknown fallback (no interceptions).
fn whole_sign_cusps(asc_min: u16) -> [u16; 12] {
    let rising = (asc_min / 1800) % 12;
    let mut c = [0u16; 12];
    for h in 0..12u16 {
        c[h as usize] = ((rising + h) % 12) * 1800;
    }
    c
}

/// Placidus house cusps from the chart angles (A1). Returns the twelve cusps in
/// absolute arc-minutes (cusp[0]=Asc, cusp[9]=MC) and the system actually used —
/// Placidus, or Whole Sign above the polar circle where Placidus is undefined.
/// Intermediate cusps come from the RAMC, recovered from the MC longitude.
pub fn compute_house_cusps(
    asc_min: u16,
    mc_min: u16,
    lat_deg: f64,
    obliquity_deg: f64,
) -> ([u16; 12], HouseSystem) {
    if lat_deg.abs() > POLAR_CIRCLE_DEG {
        return (whole_sign_cusps(asc_min), HouseSystem::WholeSign);
    }
    let mc = min_to_deg(mc_min);
    let eps = obliquity_deg.to_radians();
    let phi = lat_deg.to_radians();
    // Recover RAMC from MC: tan(RAMC) = tan(MC)·cos ε.
    let mc_r = mc.to_radians();
    let ramc = (mc_r.sin() * eps.cos()).atan2(mc_r.cos()).to_degrees().rem_euclid(360.0);

    let c11 = placidus_cusp(ramc, phi, eps, 0.0, 1.0 / 3.0);
    let c12 = placidus_cusp(ramc, phi, eps, 0.0, 2.0 / 3.0);
    let c2 = placidus_cusp(ramc, phi, eps, 60.0, 2.0 / 3.0);
    let c3 = placidus_cusp(ramc, phi, eps, 120.0, 1.0 / 3.0);

    let half = FULL_WHEEL / 2;
    let mut c = [0u16; 12];
    c[0] = asc_min;                       // 1  Ascendant
    c[1] = deg_to_min(c2);                // 2
    c[2] = deg_to_min(c3);                // 3
    c[3] = (mc_min + half) % FULL_WHEEL;  // 4  IC (opposite MC)
    c[4] = deg_to_min(c11 + 180.0);       // 5  (opposite 11)
    c[5] = deg_to_min(c12 + 180.0);       // 6  (opposite 12)
    c[6] = (asc_min + half) % FULL_WHEEL; // 7  Descendant (opposite Asc)
    c[7] = deg_to_min(c2 + 180.0);        // 8  (opposite 2)
    c[8] = deg_to_min(c3 + 180.0);        // 9  (opposite 3)
    c[9] = mc_min;                        // 10 Midheaven
    c[10] = deg_to_min(c11);              // 11
    c[11] = deg_to_min(c12);              // 12
    (c, HouseSystem::Placidus)
}

/// Interception analysis of a cusp ring (A2): `(intercepted, duplicated)`.
/// `intercepted` = signs holding no cusp; `duplicated` = signs holding two cusps.
/// Both sorted ascending by sign index.
pub fn interceptions(cusps: &[u16; 12]) -> (Vec<u8>, Vec<u8>) {
    let mut counts = [0u8; 12];
    for &c in cusps {
        counts[((c / 1800) % 12) as usize] += 1;
    }
    let intercepted = (0..12u8).filter(|&s| counts[s as usize] == 0).collect();
    let duplicated = (0..12u8).filter(|&s| counts[s as usize] >= 2).collect();
    (intercepted, duplicated)
}

/// Derive and stamp the house ring onto a chart, authoritatively. Placidus when
/// the birth time is known and the latitude is sub-polar; Whole Sign (anchored on
/// the Sun's sign) otherwise. Interceptions are recorded only for a real, timed
/// Placidus chart — never for a timeless one (Part D).
pub fn populate_houses(chart: &mut NatalChart) {
    if !chart.time_known {
        // Solar chart: no reliable Ascendant. Whole-Sign houses from the Sun's
        // sign, and never an interception claim.
        let sun_sign = chart
            .placements
            .iter()
            .find(|p| p.body == Planet::Sun)
            .map(|p| p.sign)
            .unwrap_or(0);
        chart.house_cusps = whole_sign_cusps(sun_sign as u16 * 1800).to_vec();
        chart.house_system = HouseSystem::WholeSign;
        chart.intercepted_signs = Vec::new();
        return;
    }

    let lat = if chart.birth_lat == 0.0 && chart.birth_lon == 0.0 {
        DEFAULT_LAT_DEG // no birthplace supplied → New York
    } else {
        chart.birth_lat
    };
    let (cusps, system) =
        compute_house_cusps(chart.ascendant, chart.midheaven, lat, OBLIQUITY_DEG);
    chart.house_cusps = cusps.to_vec();
    chart.house_system = system;
    chart.intercepted_signs = match system {
        HouseSystem::Placidus => interceptions(&cusps).0,
        HouseSystem::WholeSign => Vec::new(),
    };
}

/// A chart's twelve cusps as a fixed array, falling back to Whole-Sign from the
/// Ascendant for charts that predate house computation or carry a malformed ring.
fn chart_cusps(chart: &NatalChart) -> [u16; 12] {
    if chart.house_cusps.len() == 12 {
        let mut c = [0u16; 12];
        c.copy_from_slice(&chart.house_cusps);
        c
    } else {
        whole_sign_cusps(chart.ascendant)
    }
}

/// Which house (1..12) an absolute-arc-minute longitude falls in (A3), honouring
/// unequal, wrapping cusp bounds. A longitude exactly on a cusp belongs to the
/// house that cusp opens.
pub fn house_of(chart: &NatalChart, abs_minutes: u16) -> u8 {
    house_of_cusps(&chart_cusps(chart), abs_minutes)
}

fn house_of_cusps(cusps: &[u16; 12], abs_minutes: u16) -> u8 {
    let lon = (abs_minutes % FULL_WHEEL) as i32;
    let full = FULL_WHEEL as i32;
    for h in 0..12 {
        let a = cusps[h] as i32;
        let b = cusps[(h + 1) % 12] as i32;
        let span = (b - a).rem_euclid(full);
        let off = (lon - a).rem_euclid(full);
        if span > 0 && off < span {
            return (h + 1) as u8;
        }
    }
    12
}

// ── Part B: live-transit modulation (the blend) ─────────────────────────────

/// Absolute ecliptic longitude (arc-minutes 0..21599) of an equatorial point. The
/// feeder publishes RA/Dec for ecliptic-latitude-zero points, so this inverse
/// recovers the longitude exactly — letting the server read the live `Ephemeris`
/// (which stores RA/Dec, not longitude) back onto the zodiac.
pub fn equatorial_to_ecliptic_min(ra_deg: f64, dec_deg: f64) -> u16 {
    let eps = OBLIQUITY_DEG.to_radians();
    let ra = ra_deg.to_radians();
    let dec = dec_deg.to_radians();
    let lon = (ra.sin() * eps.cos() + dec.tan() * eps.sin()).atan2(ra.cos());
    deg_to_min(lon.to_degrees())
}

/// A live transiting body's equatorial position — the per-body slice the blend
/// reads off the `Ephemeris` table.
#[derive(Clone, Copy, Debug)]
pub struct TransitPos {
    pub body: Planet,
    pub ra: f64,
    pub dec: f64,
}

const TRANSIT_SELF_WEIGHT: f32 = 1.0;
const TRANSIT_RULER_WEIGHT: f32 = 0.6;

/// The faction(s) a transit landing in `house` amplifies *besides itself*: the
/// ruler of the sign on that house's cusp, plus the ruler of any sign wholly
/// contained (intercepted) within the house — a latent voice a transit briefly
/// hands a microphone (resolving the intercepted-ruler open question).
fn house_rulers(chart: &NatalChart, cusps: &[u16; 12], house: u8) -> Vec<Planet> {
    let cusp_sign = ((cusps[(house - 1) as usize] / 1800) % 12) as u8;
    let mut out = vec![sign_ruler(cusp_sign)];
    for &s in &chart.intercepted_signs {
        if house_of_cusps(cusps, s as u16 * 1800 + 900) == house {
            let r = sign_ruler(s);
            if !out.contains(&r) {
                out.push(r);
            }
        }
    }
    out
}

/// Live-transit modulation vector (B2), indexed by `Planet::idx`. Each transiting
/// body amplifies its own faction and the ruler(s) of the natal house it lights
/// up, scaled by that house's salience (angular strongest). With no birth time
/// there are no trustworthy houses, so it degrades to sign level (Part D): the
/// body amplifies its own faction and the ruler of the sign it occupies, with no
/// house weighting and no interception claims.
///
/// This is the *transit* half only — bounded into the natal base by `blend`, so
/// the sky modulates the chart and never overrides it.
pub fn transit_modulation(chart: &NatalChart, sky: &[TransitPos]) -> [f32; 10] {
    let mut m = [0.0f32; 10];
    let cusps = chart_cusps(chart);
    for t in sky {
        let lon = equatorial_to_ecliptic_min(t.ra, t.dec);
        if chart.time_known {
            let house = house_of_cusps(&cusps, lon);
            let sal = house_salience(house);
            m[t.body.idx()] += sal * TRANSIT_SELF_WEIGHT;
            for ruler in house_rulers(chart, &cusps, house) {
                m[ruler.idx()] += sal * TRANSIT_RULER_WEIGHT;
            }
        } else {
            let sign = ((lon / 1800) % 12) as u8;
            m[t.body.idx()] += TRANSIT_SELF_WEIGHT;
            m[sign_ruler(sign).idx()] += TRANSIT_RULER_WEIGHT;
        }
    }
    m
}

/// Sum-normalise a faction vector to a probability-like shape (sums to 1). An
/// all-zero vector is returned unchanged.
fn normalize(v: &[f32; 10]) -> [f32; 10] {
    let sum: f32 = v.iter().sum();
    if sum <= 0.0 {
        return *v;
    }
    let mut o = [0.0f32; 10];
    for i in 0..10 {
        o[i] = v[i] / sum;
    }
    o
}

/// Blend a natal base with a transit vector under the fixed split. Both are
/// sum-normalised first, so the transit can shift at most `TRANSIT_BLEND` of the
/// weight: it modulates, it never overrides.
pub fn blend(natal: &[f32; 10], transit: &[f32; 10]) -> [f32; 10] {
    let n = normalize(natal);
    let t = normalize(transit);
    let mut o = [0.0f32; 10];
    for i in 0..10 {
        o[i] = NATAL_BLEND * n[i] + TRANSIT_BLEND * t[i];
    }
    o
}

/// The faction weighting that feeds the per-round re-draft (B3): the natal dignity
/// base (`faction_scores`) modulated by the live sky read through *this* player's
/// houses. Pure and deterministic for a given chart + sky snapshot.
pub fn blended_faction_vector(chart: &NatalChart, sky: &[TransitPos]) -> [f32; 10] {
    let natal = faction_scores(chart);
    let transit = transit_modulation(chart, sky);
    blend(&natal, &transit)
}

// ── Part C: synastry / matching ─────────────────────────────────────────────

/// A synastry pairing score with an explainable component breakdown. Each field
/// is the *weighted* contribution, so `total == house + aspect + element`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SynastryScore {
    pub total: f32,
    pub house: f32,   // house overlays (each chart's planets in the other's houses)
    pub aspect: f32,  // planet-to-planet aspects across the two charts
    pub element: f32, // same-sign / same-element resonance, body by body
}

// Synastry weights. With both birth times known, house overlays dominate; when
// either chart is timeless the house term is suppressed entirely (Part D / C2)
// and the differential terms carry the pairing.
const SYN_HOUSE_W: f32 = 1.0;
const SYN_ASPECT_W: f32 = 0.5;
const SYN_ELEMENT_W: f32 = 0.5;
const SYN_ASPECT_W_NOTIME: f32 = 1.0;
const SYN_ELEMENT_W_NOTIME: f32 = 1.0;

/// Aspect orb (degrees) and per-aspect weights. Harmonious aspects bind harder;
/// the hard aspects still register a connection, just a tenser one.
const SYN_ORB_DEG: f64 = 6.0;
const SYN_ASPECTS: [(f64, f32); 5] = [
    (0.0, 1.0),   // conjunction
    (60.0, 0.5),  // sextile
    (90.0, 0.3),  // square
    (120.0, 0.8), // trine
    (180.0, 0.5), // opposition
];
const SYN_SAME_SIGN_W: f32 = 1.0;
const SYN_SAME_ELEMENT_W: f32 = 0.4;

/// House overlay: how strongly `src`'s planets land in `dst`'s houses, by house
/// salience. (The caller gates on birth time; this stays pure.)
fn house_overlay(src: &NatalChart, dst: &NatalChart) -> f32 {
    src.placements
        .iter()
        .map(|p| house_salience(house_of(dst, p.abs_minutes())))
        .sum()
}

/// Cross-chart planet-to-planet aspects within orb, weighted by aspect and by how
/// tight the orb is (exact = full weight, edge-of-orb → 0).
fn aspect_resonance(a: &NatalChart, b: &NatalChart) -> f32 {
    let mut s = 0.0f32;
    for pa in &a.placements {
        for pb in &b.placements {
            let sep = circ_dist(pa.abs_minutes(), pb.abs_minutes()) as f64 / 60.0; // deg, 0..180
            for (angle, w) in SYN_ASPECTS {
                let orb = (sep - angle).abs();
                if orb <= SYN_ORB_DEG {
                    s += w * (1.0 - (orb / SYN_ORB_DEG) as f32);
                }
            }
        }
    }
    s
}

/// Same-body element resonance: for each planet present in both charts, full
/// credit when the placements share a sign, partial when they share an element.
fn element_resonance(a: &NatalChart, b: &NatalChart) -> f32 {
    let mut s = 0.0f32;
    for pa in &a.placements {
        if let Some(pb) = b.placements.iter().find(|p| p.body == pa.body) {
            if pa.sign == pb.sign {
                s += SYN_SAME_SIGN_W;
            } else if sign_element(pa.sign) == sign_element(pb.sign) {
                s += SYN_SAME_ELEMENT_W;
            }
        }
    }
    s
}

/// Synastry between two charts for matchmaking (C1). Combines house overlays (the
/// dominant term when both birth times are known) with placement differentials
/// (cross-chart aspects + element resonance). When either chart lacks a birth time
/// the house term is zeroed — a noon chart's cusps are not to be trusted (C2 /
/// Part D) — and the differentials carry the score. The returned breakdown is
/// post-weight, so `total == house + aspect + element`.
pub fn synastry(a: &NatalChart, b: &NatalChart) -> SynastryScore {
    let both_timed = a.time_known && b.time_known;

    let raw_house = if both_timed {
        house_overlay(a, b) + house_overlay(b, a)
    } else {
        0.0
    };
    let raw_aspect = aspect_resonance(a, b);
    let raw_element = element_resonance(a, b);

    let (house_w, aspect_w, element_w) = if both_timed {
        (SYN_HOUSE_W, SYN_ASPECT_W, SYN_ELEMENT_W)
    } else {
        (0.0, SYN_ASPECT_W_NOTIME, SYN_ELEMENT_W_NOTIME)
    };

    let house = house_w * raw_house;
    let aspect = aspect_w * raw_aspect;
    let element = element_w * raw_element;
    SynastryScore {
        total: house + aspect + element,
        house,
        aspect,
        element,
    }
}

/// Mint one card from the live sky at this instant — a card with its own natal
/// moment, granted to the victor of a capture. Its source body is the planet now
/// most dignified in the sky; stats and rank follow the starter-deck rules, with
/// the arc-minute taken from the very second of minting so no two moments mint
/// alike. Lands on the Bench. Returns the new card_id, or None if the sky has not
/// been seeded yet (no ephemeris).
pub fn mint_from_sky(ctx: &ReducerContext, owner: Identity) -> Option<u64> {
    let cfg = ctx.db.game_config().id().find(&0u8)?;
    let rising = ((cfg.season_degree / 30) % 12) as u8;
    let degree_in_sign = (cfg.season_degree % 30) as u8; // 0..29

    // The card's source: the transiting planet now strongest in its zone-sign.
    let mut best: Option<(Planet, u8, i8)> = None;
    for e in ctx.db.ephemeris().iter() {
        let sign = (rising + e.transiting_zone) % 12;
        let dig = sky_dignity(e.body, sign);
        let better = match best {
            Some((_, _, bd)) => dig > bd,
            None => true,
        };
        if better {
            best = Some((e.body, sign, dig));
        }
    }
    let (body, sign, dignity) = best?;

    // The minute-of-arc is the literal second of birth.
    let second = (ctx.timestamp.to_micros_since_unix_epoch() / 1_000_000).rem_euclid(60) as u16;
    let p = Placement {
        body,
        sign,
        arc_minutes: degree_in_sign as u16 * 60 + second,
        retrograde: false,
        dignity,
    };
    let (health, attack, armour, cooldown_ms) = card_stats(&p, 0.0);

    let card = ctx.db.card().insert(Card {
        card_id: 0,
        owner,
        suit: sign_element(sign),
        rank: pip_rank(sign, p.degree()),
        health,
        attack,
        armour,
        cooldown_ms,
        source_body: body,
        inverted: false,
        is_trump: false,
        level: 1,
        minted_at: ctx.timestamp,
    });
    ctx.db.deck_slot().insert(DeckSlot {
        slot_id: 0,
        owner,
        card_id: card.card_id,
        loadout: Loadout::Bench,
    });
    Some(card.card_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use spacetimedb::Identity;

    fn pl(body: Planet, sign: u8, deg: u8) -> Placement {
        Placement { body, sign, arc_minutes: deg as u16 * 60, retrograde: false, dignity: 0 }
    }

    /// Build a chart and run the authoritative house derivation over it.
    fn chart(asc: u16, mc: u16, lat: f64, lon: f64, time_known: bool, placements: Vec<Placement>) -> NatalChart {
        let mut c = NatalChart {
            identity: Identity::ZERO,
            birth_unix: 0,
            birth_lat: lat,
            birth_lon: lon,
            time_known,
            placements,
            ascendant: asc,
            midheaven: mc,
            house_cusps: Vec::new(),
            house_system: HouseSystem::Placidus,
            intercepted_signs: Vec::new(),
        };
        populate_houses(&mut c);
        c
    }

    fn approx(a: f32, b: f32) {
        assert!((a - b).abs() < 1e-4, "{a} is not ~ {b}");
    }

    // ── Part A: Placidus / interception ────────────────────────────────────

    // Sign indices: 0 Ari … 2 Gem … 5 Vir … 8 Sag … 11 Pis.
    const GEMINI: u8 = 2;
    const VIRGO: u8 = 5;
    const SAGITTARIUS: u8 = 8;
    const PISCES: u8 = 11;

    /// The Brooklyn acceptance chart: 1991-06-23, 10:24 EDT, (40.678, -73.944),
    /// Asc ≈ 0° Virgo. Derived from the birth instant (GMST → RAMC → Asc/MC):
    /// Asc = 9060 arc-min (1°00' Vir), MC = 3339 arc-min (25°39' Tau).
    fn brooklyn() -> NatalChart {
        chart(9060, 3339, 40.678, -73.944, true, vec![])
    }

    #[test]
    fn brooklyn_intercepts_sagittarius_and_gemini_and_duplicates_virgo_and_pisces() {
        let c = brooklyn();
        assert_eq!(c.house_system, HouseSystem::Placidus);
        let cusps = chart_cusps(&c);
        let (intercepted, duplicated) = interceptions(&cusps);
        assert_eq!(intercepted, vec![GEMINI, SAGITTARIUS], "intercepted signs");
        assert_eq!(duplicated, vec![VIRGO, PISCES], "duplicated signs");
        // The persisted column matches, and time-known so it is non-empty.
        assert_eq!(c.intercepted_signs, vec![GEMINI, SAGITTARIUS]);
    }

    #[test]
    fn cusp_zero_is_asc_and_cusp_nine_is_mc() {
        let cusps = chart_cusps(&brooklyn());
        assert_eq!(cusps[0], 9060); // Asc
        assert_eq!(cusps[9], 3339); // MC
    }

    /// Shared cross-language test vector — these exact arc-minute cusps must also
    /// be reproduced by `unity/ChartCalculator.cs` (see its `BrooklynCusps`).
    #[test]
    fn brooklyn_matches_shared_cusp_vector() {
        let cusps = chart_cusps(&brooklyn());
        let expected: [u16; 12] =
            [9060, 10450, 12148, 14139, 16234, 18171, 19860, 21250, 1348, 3339, 5434, 7371];
        for h in 0..12 {
            let d = (cusps[h] as i32 - expected[h] as i32).rem_euclid(FULL_WHEEL as i32);
            let d = d.min(FULL_WHEEL as i32 - d);
            assert!(d <= 2, "cusp {} = {} arc-min, expected {} (Δ {})", h + 1, cusps[h], expected[h], d);
        }
    }

    #[test]
    fn house_of_round_trips_every_cusp() {
        let c = brooklyn();
        let cusps = chart_cusps(&c);
        for h in 0..12 {
            assert_eq!(house_of(&c, cusps[h]), (h + 1) as u8, "cusp {} did not round-trip", h + 1);
        }
    }

    #[test]
    fn house_of_honours_unequal_wrapping_spans() {
        let c = brooklyn();
        let cusps = chart_cusps(&c);
        // A point one arc-minute past each cusp sits in that same house.
        for h in 0..12 {
            let nudged = (cusps[h] + 1) % FULL_WHEEL;
            // unless the next cusp is only one minute away (not the case here)
            assert_eq!(house_of(&c, nudged), (h + 1) as u8);
        }
        // Cusp 9 wraps past 360° (Pisces→Aries): 1348 arc-min is in Aries, house 9.
        assert_eq!(cusps[8], 1348);
        assert_eq!(house_of(&c, 1348), 9);
    }

    #[test]
    fn polar_latitude_falls_back_to_whole_sign_without_panic() {
        let c = chart(9060, 3339, 80.0, 10.0, true, vec![]);
        assert_eq!(c.house_system, HouseSystem::WholeSign);
        assert!(c.intercepted_signs.is_empty());
        let cusps = chart_cusps(&c);
        assert_eq!(cusps[0], VIRGO as u16 * 1800); // Whole-Sign 1st = 0° of Asc's sign
        // And transit modulation over the fallback ring must not panic.
        let _ = transit_modulation(&c, &[TransitPos { body: Planet::Mars, ra: 200.0, dec: -10.0 }]);
    }

    #[test]
    fn time_unknown_chart_is_whole_sign_from_the_sun_with_no_interceptions() {
        // Sun in Cancer (sign 3). No birth time → Whole-Sign houses from the Sun.
        let c = chart(0, 0, 40.7, -74.0, false, vec![pl(Planet::Sun, 3, 10)]);
        assert_eq!(c.house_system, HouseSystem::WholeSign);
        assert!(c.intercepted_signs.is_empty());
        assert_eq!(chart_cusps(&c)[0], 3 * 1800); // Cancer 0°
    }

    // ── Part B: transit modulation / blend ─────────────────────────────────

    #[test]
    fn equatorial_to_ecliptic_recovers_longitude() {
        // Ecliptic points (β=0) round-trip back through the inverse transform.
        assert_eq!(equatorial_to_ecliptic_min(0.0, 0.0), 0);
        assert_eq!(equatorial_to_ecliptic_min(90.0, OBLIQUITY_DEG), 5400); // Cancer 0°
        assert_eq!(equatorial_to_ecliptic_min(180.0, 0.0), 10800); // Libra 0°
        assert_eq!(equatorial_to_ecliptic_min(270.0, -OBLIQUITY_DEG), 16200); // Capricorn 0°
    }

    #[test]
    fn house_salience_ranks_angular_over_succedent_over_cadent() {
        for &h in &[1u8, 4, 7, 10] { approx(house_salience(h), 1.0); }
        for &h in &[2u8, 5, 8, 11] { approx(house_salience(h), 0.6); }
        for &h in &[3u8, 6, 9, 12] { approx(house_salience(h), 0.35); }
    }

    #[test]
    fn transit_modulation_amplifies_the_body_and_its_house_ruler() {
        let c = brooklyn();
        // 10° Virgo (abs 9600') sits inside house 1 (the Ascendant's house —
        // angular, full salience), whose cusp is in Virgo → ruled by Mercury.
        // Build RA/Dec from the forward transform of λ=160° (β=0).
        let lon = 160.0_f64.to_radians();
        let eps = OBLIQUITY_DEG.to_radians();
        let ra = (lon.sin() * eps.cos()).atan2(lon.cos()).to_degrees().rem_euclid(360.0);
        let dec = (eps.sin() * lon.sin()).asin().to_degrees();
        let m = transit_modulation(&c, &[TransitPos { body: Planet::Mars, ra, dec }]);
        // The transiting body (Mars) and the house ruler (Mercury) are both lifted.
        assert!(m[Planet::Mars.idx()] > 0.0, "transiting body amplified");
        assert!(m[Planet::Mercury.idx()] > 0.0, "house ruler amplified");
        // Angular house → full salience on both terms.
        approx(m[Planet::Mars.idx()], TRANSIT_SELF_WEIGHT); // 1.0
        approx(m[Planet::Mercury.idx()], TRANSIT_RULER_WEIGHT); // 0.6
    }

    #[test]
    fn blend_bounds_transit_to_its_share() {
        let mut natal = [0.0f32; 10];
        natal[Planet::Sun.idx()] = 10.0; // natal all on the Sun
        let mut transit = [0.0f32; 10];
        transit[Planet::Pluto.idx()] = 5.0; // transit all on Pluto
        let b = blend(&natal, &transit);
        approx(b[Planet::Sun.idx()], NATAL_BLEND); // 0.70
        approx(b[Planet::Pluto.idx()], TRANSIT_BLEND); // 0.30 — capped
        approx(b.iter().sum::<f32>(), 1.0);
    }

    #[test]
    fn blended_vector_is_deterministic_and_does_not_panic_on_empty_sky() {
        let c = brooklyn();
        let a = blended_faction_vector(&c, &[]);
        let b = blended_faction_vector(&c, &[]);
        assert_eq!(a, b);
        // Empty sky → transit contributes nothing; only the natal share remains.
        approx(a.iter().sum::<f32>(), NATAL_BLEND);
    }

    // ── Part C/D: synastry & degradation ───────────────────────────────────

    #[test]
    fn synastry_zeroes_house_weight_when_a_chart_lacks_a_birth_time() {
        let a = chart(9060, 3339, 40.678, -73.944, true,
            vec![pl(Planet::Sun, 2, 5), pl(Planet::Moon, 6, 12)]);
        let timeless = chart(0, 0, 40.7, -74.0, false,
            vec![pl(Planet::Sun, 2, 7), pl(Planet::Moon, 9, 1)]);
        let s = synastry(&a, &timeless);
        assert_eq!(s.house, 0.0, "house term must be suppressed");
        approx(s.total, s.aspect + s.element);
        // The timeless chart's transit modulation must also stay panic-free.
        let _ = transit_modulation(&timeless, &[TransitPos { body: Planet::Venus, ra: 120.0, dec: 5.0 }]);
    }

    #[test]
    fn synastry_house_overlay_dominates_when_both_are_timed() {
        let a = chart(9060, 3339, 40.678, -73.944, true,
            vec![pl(Planet::Sun, 5, 10), pl(Planet::Moon, 1, 3), pl(Planet::Mars, 8, 20)]);
        let b = chart(3000, 12000, 51.5, -0.12, true,
            vec![pl(Planet::Sun, 9, 2), pl(Planet::Moon, 4, 25), pl(Planet::Mars, 0, 14)]);
        let s = synastry(&a, &b);
        assert!(s.house > 0.0);
        assert!(s.house >= s.aspect, "house ({}) should dominate aspect ({})", s.house, s.aspect);
        assert!(s.house >= s.element, "house ({}) should dominate element ({})", s.house, s.element);
        approx(s.total, s.house + s.aspect + s.element);
    }

    #[test]
    fn synastry_rewards_shared_signs_and_aspects() {
        // Two charts with the Sun in the same sign & degree → conjunction + same
        // sign both fire. Symmetric, so the score is order-independent here.
        let a = chart(0, 16200, 40.0, -74.0, true, vec![pl(Planet::Sun, 4, 15)]);
        let b = chart(0, 16200, 40.0, -74.0, true, vec![pl(Planet::Sun, 4, 15)]);
        let s = synastry(&a, &b);
        assert!(s.element > 0.0, "same-sign Suns resonate");
        assert!(s.aspect > 0.0, "conjunct Suns aspect");
        assert_eq!(synastry(&a, &b), synastry(&b, &a));
    }
}
