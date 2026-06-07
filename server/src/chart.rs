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

/// Which planet (if any) is *exalted* in this sign. Only the classical seven
/// have an agreed exaltation; the moderns (Uranus/Neptune/Pluto) exalt nowhere
/// here, so they lean on rulership + reception alone.
pub fn exalt_ruler(sign: u8) -> Option<Planet> {
    match sign % 12 {
        0 => Some(Planet::Sun),      // Sun exalted in Aries
        1 => Some(Planet::Moon),     // Moon exalted in Taurus
        3 => Some(Planet::Jupiter),  // Jupiter exalted in Cancer
        5 => Some(Planet::Mercury),  // Mercury exalted in Virgo
        6 => Some(Planet::Saturn),   // Saturn exalted in Libra
        9 => Some(Planet::Mars),     // Mars exalted in Capricorn
        11 => Some(Planet::Venus),   // Venus exalted in Pisces
        _ => None,
    }
}

/// Essential dignity of `body` sitting in `sign`, on the classical scale:
/// +5 domicile, +4 exaltation, −5 detriment, −4 fall, 0 peregrine. Derived from
/// the game's own rulership map, so it stays consistent with `sign_ruler`.
/// (Independent of the client-supplied `Placement.dignity`, which still feeds
/// `card_stats` for deck minting — this drives faction scoring only.)
pub fn essential_dignity(body: Planet, sign: u8) -> i8 {
    let opposite = (sign + 6) % 12;
    if sign_ruler(sign) == body { 5 }                       // domicile
    else if exalt_ruler(sign) == Some(body) { 4 }           // exaltation
    else if sign_ruler(opposite) == body { -5 }             // detriment (rules the opposite sign)
    else if exalt_ruler(opposite) == Some(body) { -4 }      // fall (exalted in the opposite sign)
    else { 0 }                                              // peregrine
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

/// Floor on the number of draftable options — a dignity-poor chart still gets a
/// real choice. Reception and essential dignity *widen* the set above this; the
/// floor only tops it up when the chart is sparse (GDD §02).
pub const MIN_DRAFT_CHOICES: usize = 3;

/// Weighted dignity vector → a draft weight per planet (index by `Planet::idx`).
/// This ranks the *eligible* options (see `faction_options`); it does not decide
/// eligibility — essential dignity and reception do that (GDD §02).
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
        // Presence + engine-computed essential dignity (domicile/exalt/detriment/fall).
        s[p.body.idx()] += 1.0 + essential_dignity(p.body, p.sign) as f32 * 0.4;
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

    // Reception & mutual reception — planets lift one another's dignity (GDD §02).
    add_reception(chart, &mut s);
    s
}

/// Reception: a planet sitting in another's domicile or exaltation is *received*
/// and strengthened by its host; when two planets sit in each other's dignities
/// (mutual reception, e.g. Mars in Cancer with the Moon in Aries) both gain
/// more. This is the literal "planets influence each other's dignity" (GDD §02).
fn add_reception(chart: &NatalChart, s: &mut [f32; 10]) {
    for p in &chart.placements {
        let guest = p.body;
        // The lord(s) of the sign the guest sits in: its hosts.
        for (host, welcome) in [
            (Some(sign_ruler(p.sign)), 1.5f32),  // domicile lord — the stronger host
            (exalt_ruler(p.sign), 1.0f32),       // exaltation lord
        ] {
            let Some(host) = host else { continue };
            if host == guest { continue; }                       // own dignity ≠ reception
            // The host must actually be present in the chart to receive anyone.
            let Some(hp) = chart.placements.iter().find(|q| q.body == host) else { continue };
            s[guest.idx()] += welcome;                           // guest welcomed by its host
            s[host.idx()] += welcome * 0.4;                      // host gains a little for hosting
            // Mutual reception: the host in turn sits in one of the guest's dignities.
            if sign_ruler(hp.sign) == guest || exalt_ruler(hp.sign) == Some(guest) {
                s[guest.idx()] += 1.5;                           // each direction credits its own guest
            }
        }
    }
}

/// If `pl` is in mutual reception with another *present* planet, return it.
pub fn mutual_reception_of(chart: &NatalChart, pl: Planet) -> Option<Planet> {
    let p = chart.placements.iter().find(|p| p.body == pl)?;
    for host in [Some(sign_ruler(p.sign)), exalt_ruler(p.sign)].into_iter().flatten() {
        if host == pl { continue; }
        if let Some(hp) = chart.placements.iter().find(|q| q.body == host) {
            if sign_ruler(hp.sign) == pl || exalt_ruler(hp.sign) == Some(pl) {
                return Some(host);
            }
        }
    }
    None
}

/// If `pl` sits in a *present* planet's domicile/exaltation, return that host.
pub fn received_by(chart: &NatalChart, pl: Planet) -> Option<Planet> {
    let p = chart.placements.iter().find(|p| p.body == pl)?;
    for host in [Some(sign_ruler(p.sign)), exalt_ruler(p.sign)].into_iter().flatten() {
        if host == pl { continue; }
        if chart.placements.iter().any(|q| q.body == host) {
            return Some(host);
        }
    }
    None
}

/// A *base* named path — the structural identity options that are always
/// eligible regardless of dignity: the chart ruler (Ascendant lord), the lords
/// of your Sun and Moon signs, and the luminaries themselves when placed (so
/// "the Moon in my chart" is always a team you can join — GDD §02).
fn base_path(chart: &NatalChart, pl: Planet) -> bool {
    let asc_sign = ((chart.ascendant / 1800) % 12) as u8;
    if sign_ruler(asc_sign) == pl {
        return true; // chart ruler
    }
    for p in &chart.placements {
        match p.body {
            Planet::Sun if sign_ruler(p.sign) == pl => return true,  // lord of your Sun sign
            Planet::Moon if sign_ruler(p.sign) == pl => return true, // lord of your Moon sign
            _ => {}
        }
    }
    // The luminaries themselves are always an option when placed.
    matches!(pl, Planet::Sun | Planet::Moon) && chart.placements.iter().any(|p| p.body == pl)
}

/// Does `pl` clear the dignity bar — in domicile/exaltation, received by a
/// present host, or in mutual reception? This is what *widens* the eligible
/// pool beyond the base paths: a planet a host welcomes becomes draftable when
/// it otherwise wouldn't be (GDD §02).
fn dignified(chart: &NatalChart, pl: Planet) -> bool {
    let essential = chart
        .placements
        .iter()
        .find(|p| p.body == pl)
        .map_or(0, |p| essential_dignity(pl, p.sign));
    essential >= 4 // domicile (+5) or exaltation (+4)
        || received_by(chart, pl).is_some()
        || mutual_reception_of(chart, pl).is_some()
}

/// One draftable faction option: the planet, its dignity-derived draft weight
/// (ranks options within the eligible set), and the dominant astrological path
/// that earned it — the "named path" surfaced to the player (GDD §02).
#[derive(Clone, Debug)]
pub struct FactionOption {
    pub planet: Planet,
    pub weight: f32,
    pub path: String,
}

/// The chart's draftable faction options — the *eligible set*, highest draft
/// weight first, each tagged with the named path that earned it. Eligibility is
/// the base named paths widened by essential dignity and reception; if that
/// leaves fewer than `MIN_DRAFT_CHOICES`, the strongest remaining planets top it
/// up so there is always a real choice (GDD §02).
pub fn faction_options(chart: &NatalChart) -> Vec<FactionOption> {
    let scores = faction_scores(chart);
    let mut eligible: Vec<Planet> = ALL_PLANETS
        .iter()
        .copied()
        .filter(|&pl| base_path(chart, pl) || dignified(chart, pl))
        .collect();

    // Floor: top up with the next strongest planets when the chart is sparse.
    if eligible.len() < MIN_DRAFT_CHOICES {
        let mut rest: Vec<Planet> = ALL_PLANETS
            .iter()
            .copied()
            .filter(|pl| !eligible.contains(pl))
            .collect();
        rest.sort_by(|a, b| scores[b.idx()].partial_cmp(&scores[a.idx()]).unwrap_or(std::cmp::Ordering::Equal));
        for pl in rest {
            if eligible.len() >= MIN_DRAFT_CHOICES {
                break;
            }
            eligible.push(pl);
        }
    }

    let mut opts: Vec<FactionOption> = eligible
        .into_iter()
        .map(|pl| FactionOption { planet: pl, weight: scores[pl.idx()], path: dominant_path(chart, pl) })
        .collect();
    opts.sort_by(|a, b| b.weight.partial_cmp(&a.weight).unwrap_or(std::cmp::Ordering::Equal));
    opts
}

/// The planets eligible to be drafted — the base named paths widened by dignity
/// and reception (GDD §02).
pub fn eligible_factions(chart: &NatalChart) -> Vec<Planet> {
    faction_options(chart).into_iter().map(|o| o.planet).collect()
}

/// The single strongest astrological reason `pl` is an option, in priority
/// order — what the draft UI shows beside the planet (GDD §02).
fn dominant_path(chart: &NatalChart, pl: Planet) -> String {
    let asc_sign = ((chart.ascendant / 1800) % 12) as u8;
    if sign_ruler(asc_sign) == pl {
        return "Chart ruler — lord of your Ascendant".into();
    }
    let mut sun_sign = None;
    let mut moon_sign = None;
    for p in &chart.placements {
        match p.body {
            Planet::Sun => sun_sign = Some(p.sign),
            Planet::Moon => moon_sign = Some(p.sign),
            _ => {}
        }
    }
    if sun_sign.map(sign_ruler) == Some(pl) {
        return "Lord of your Sun sign".into();
    }
    if moon_sign.map(sign_ruler) == Some(pl) {
        return "Lord of your Moon sign".into();
    }
    if let Some(p) = chart.placements.iter().find(|p| p.body == pl) {
        if let Some(other) = mutual_reception_of(chart, pl) {
            return format!("Mutual reception with {:?}", other);
        }
        match essential_dignity(pl, p.sign) {
            5 => return "In domicile — ruling its own sign".into(),
            4 => return "Exalted in its sign".into(),
            _ => {}
        }
        if let Some(host) = received_by(chart, pl) {
            return format!("Received by {:?}", host);
        }
        if matches!(pl, Planet::Sun | Planet::Moon) {
            return format!("Your {pl:?} — a luminary in your chart");
        }
        if angular(p, chart) {
            return "Angular — on an axis of the chart".into();
        }
        if chart.placements.iter().filter(|q| q.sign % 12 == p.sign % 12).count() >= 3 {
            return "Part of a stellium".into();
        }
        return format!("{:?} placed in your chart", pl);
    }
    format!("{:?}", pl)
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
            level: 1,
            xp: 0,
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
        level: 1,
        xp: 0,
    });
    ctx.db.deck_slot().insert(DeckSlot {
        slot_id: 0,
        owner,
        card_id: hero.card_id,
        loadout: Loadout::Active,
    });

    (seed, chart.placements.len() + 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use spacetimedb::Identity;

    fn pl(body: Planet, sign: u8) -> Placement {
        Placement { body, sign, arc_minutes: 15 * 60, retrograde: false, dignity: 0 }
    }

    fn chart(placements: Vec<Placement>, asc_sign: u8) -> NatalChart {
        NatalChart {
            identity: Identity::ZERO,
            birth_unix: 0,
            birth_lat: 0.0,
            birth_lon: 0.0,
            time_known: true,
            placements,
            ascendant: asc_sign as u16 * 1800 + 900, // mid-sign
            midheaven: 0,
        }
    }

    #[test]
    fn essential_dignity_classical() {
        assert_eq!(essential_dignity(Planet::Sun, 4), 5);     // Leo — domicile
        assert_eq!(essential_dignity(Planet::Sun, 0), 4);     // Aries — exaltation
        assert_eq!(essential_dignity(Planet::Sun, 10), -5);   // Aquarius — detriment (opp Leo)
        assert_eq!(essential_dignity(Planet::Sun, 6), -4);    // Libra — fall (opp Aries)
        assert_eq!(essential_dignity(Planet::Jupiter, 3), 4); // Jupiter exalted in Cancer
        assert_eq!(essential_dignity(Planet::Mars, 0), 5);    // Mars rules Aries
        assert_eq!(essential_dignity(Planet::Mercury, 0), 0); // peregrine
    }

    #[test]
    fn reception_lifts_the_received_planet() {
        // Mars in Cancer (the Moon's domicile). With the Moon present, Mars is
        // received; with no Moon there is no host, so no lift.
        let with_moon = chart(vec![pl(Planet::Mars, 3), pl(Planet::Moon, 2)], 2);
        let without = chart(vec![pl(Planet::Mars, 3)], 2);
        let a = faction_scores(&with_moon)[Planet::Mars.idx()];
        let b = faction_scores(&without)[Planet::Mars.idx()];
        assert!(a > b, "reception should lift Mars: {a} !> {b}");
        assert_eq!(received_by(&with_moon, Planet::Mars), Some(Planet::Moon));
        assert_eq!(mutual_reception_of(&with_moon, Planet::Mars), None);
    }

    #[test]
    fn mutual_reception_is_symmetric_and_boosts() {
        // Mars in Cancer + Moon in Aries — each sits in the other's domicile.
        let c = chart(vec![pl(Planet::Mars, 3), pl(Planet::Moon, 0)], 8); // Asc Sagittarius → ruler Jupiter
        assert_eq!(mutual_reception_of(&c, Planet::Mars), Some(Planet::Moon));
        assert_eq!(mutual_reception_of(&c, Planet::Moon), Some(Planet::Mars));
        let s = faction_scores(&c);
        let solo = faction_scores(&chart(vec![pl(Planet::Mars, 3)], 8));
        assert!(s[Planet::Mars.idx()] > solo[Planet::Mars.idx()], "mutual reception should lift Mars");
    }

    #[test]
    fn options_are_ranked_paths_and_dignity_qualify() {
        // Asc Cancer → chart ruler Moon; Moon in Taurus (exalted); Jupiter exalted
        // in Cancer (the worked example). Venus is the lord of the Moon sign but
        // is not itself placed — it should still be eligible as a named path.
        let c = chart(
            vec![pl(Planet::Sun, 3), pl(Planet::Moon, 1), pl(Planet::Jupiter, 3)],
            3,
        );
        let opts = faction_options(&c);
        for w in opts.windows(2) {
            assert!(w[0].weight >= w[1].weight, "options must be sorted by weight");
        }
        let eligible = eligible_factions(&c);
        assert!(eligible.len() >= MIN_DRAFT_CHOICES, "must offer at least the floor of choices");
        assert!(eligible.contains(&Planet::Jupiter), "Jupiter-in-Cancer (exalted) should qualify: {eligible:?}");
        assert!(eligible.contains(&Planet::Venus), "lord of the Moon sign should be a named path: {eligible:?}");
        // A peregrine, non-path body is not eligible just for being a planet.
        assert!(!eligible.contains(&Planet::Saturn), "undignified non-path Saturn should not qualify: {eligible:?}");
    }

    #[test]
    fn reception_widens_eligibility() {
        // Three distinct base paths keep the floor inert: Asc Aries → Mars,
        // Sun in Taurus → Venus, Moon in Gemini → Mercury.
        let base = vec![pl(Planet::Sun, 1), pl(Planet::Moon, 2)];

        // Saturn in Sagittarius is peregrine with no host present → not eligible.
        let mut no_host = base.clone();
        no_host.push(pl(Planet::Saturn, 8));
        assert!(
            !eligible_factions(&chart(no_host, 0)).contains(&Planet::Saturn),
            "unreceived Saturn should stay out of the draft",
        );

        // Add Jupiter (Sagittarius' lord): Saturn is now received and is drafted —
        // reception has widened the eligible set.
        let mut with_host = base;
        with_host.push(pl(Planet::Saturn, 8));
        with_host.push(pl(Planet::Jupiter, 11));
        let c = chart(with_host, 0);
        assert_eq!(received_by(&c, Planet::Saturn), Some(Planet::Jupiter));
        assert!(
            eligible_factions(&c).contains(&Planet::Saturn),
            "reception by Jupiter should widen eligibility to include Saturn",
        );
    }
}
