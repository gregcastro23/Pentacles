//! The War Table rules — the module's own referee.
//!
//! Everything here is a Rust port of `public/arcanaTrickEngine.js`, function for
//! function and constant for constant, so the browser can predict what the server
//! will do and the server never has to trust what the browser (or the feeder)
//! claims happened. The JS engine remains the *client-side* prediction and the
//! offline practice bout; THIS file is what moves zone control.
//!
//! Parity is not aspirational: `scripts/melee-parity.test.mjs` runs the JS engine
//! and `cargo test` runs these functions over the same fixtures, and the two must
//! agree on the ladder, on power, on legality, on trick winners and on melds.
//!
//! Everything in this file is PURE — no `ReducerContext`, no table access — so it
//! is unit-testable off-chain. The reducers in `reducers.rs` are the only callers
//! that touch the database.

use crate::chart::sign_element;
use crate::types::{Planet, Suit};

// ════════════════════════════════════════════════════════════════════════════
//  Cards
// ════════════════════════════════════════════════════════════════════════════

/// A card as the trick engine sees it: identity, suit, rank, and the two flags
/// that change its behaviour. Deliberately `Copy` and free of `Identity` so the
/// rules can be exercised without a database.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct MeleeCard {
    pub card_id: u64,
    pub suit: Suit,
    /// Minor: 1..=14 (Ace..King). Major: the arcana index 0..=21.
    pub rank: u8,
    pub is_major: bool,
    /// Minted from a retrograde body — halves the card's counter value.
    pub inverted: bool,
}

/// One transiting body as the ladder sees it.
#[derive(Clone, Copy, Debug)]
pub struct SkyBody {
    pub body: Planet,
    pub sign: u8,
    pub retrograde: bool,
    /// Above the horizon. The server has no single observer, so reducers pass
    /// `true` — matching the JS default when a feeder omits the field.
    pub up: bool,
}

/// The frozen 22-Major potency ladder, 1..=100 per arcana.
pub type Ladder = [u8; 22];

/// A ladder every entry of which is the mid-rung 50 — what `potency_of` falls
/// back to card-by-card, materialised for callers that have no sky at all.
pub const NEUTRAL_LADDER: Ladder = [50; 22];

pub const EXCUSE_ARCANA: u8 = 0;
/// The three Honours (Oudlers), worth ten counters each; every other Major is 0.
pub const MAJOR_HONOURS: [u8; 3] = [0, 1, 21];

pub const HAND_SIZE: usize = 12;
pub const MAX_MAJORS_IN_HAND: usize = 3;
pub const TOTAL_TRICKS: u8 = 12;
/// Taking the last trick is worth ten counters, as in the melee rules.
pub const CLIMAX_BONUS: u16 = 10;

/// True where the arcana is a *planetary* Major; false where it is a *sign* Major.
const ARCANA_IS_PLANETARY: [bool; 22] = [
    true, true, true, true, false, false, false, false, false, false, true, false, true, false,
    false, false, true, false, false, true, true, true,
];

/// Planetary Major → the body index (0..=9) whose live dignity sets its potency.
fn planetary_body_of(arcana: u8) -> usize {
    match arcana {
        0 => 7,  // The Fool — Uranus
        1 => 2,  // The Magician — Mercury
        2 => 1,  // The High Priestess — Moon
        3 => 3,  // The Empress — Venus
        10 => 5, // Wheel of Fortune — Jupiter
        12 => 8, // The Hanged Man — Neptune
        16 => 4, // The Tower — Mars
        19 => 0, // The Sun — Sun
        20 => 9, // Judgement — Pluto
        21 => 6, // The World — Saturn
        _ => 0,
    }
}

/// Sign Major → the sign (0=Aries) whose live occupancy sets its potency.
fn sign_of_arcana(arcana: u8) -> u8 {
    match arcana {
        4 => 0,   // The Emperor — Aries
        5 => 1,   // The Hierophant — Taurus
        6 => 2,   // The Lovers — Gemini
        7 => 3,   // The Chariot — Cancer
        8 => 4,   // Strength — Leo
        9 => 5,   // The Hermit — Virgo
        11 => 6,  // Justice — Libra
        13 => 7,  // Death — Scorpio
        14 => 8,  // Temperance — Sagittarius
        15 => 9,  // The Devil — Capricorn
        17 => 10, // The Star — Aquarius
        18 => 11, // The Moon — Pisces
        _ => 0,
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  Essential dignity (Ptolemy / Lilly, ±5)
// ════════════════════════════════════════════════════════════════════════════

/// Domiciles by body index. Mirrors `DOMICILES` in the JS engine — note these are
/// the engine's *combat* rulerships and are intentionally free of the classical
/// night/day split, so a card's power never depends on the hour.
const DOMICILES: [&[u8]; 10] = [
    &[4],     // Sun — Leo
    &[3],     // Moon — Cancer
    &[2, 5],  // Mercury — Gemini, Virgo
    &[1, 6],  // Venus — Taurus, Libra
    &[0, 7],  // Mars — Aries, Scorpio
    &[8, 11], // Jupiter — Sagittarius, Pisces
    &[9, 10], // Saturn — Capricorn, Aquarius
    &[10],    // Uranus — Aquarius
    &[11],    // Neptune — Pisces
    &[7],     // Pluto — Scorpio
];

const EXALTATIONS: [u8; 10] = [0, 1, 5, 11, 9, 3, 6, 7, 3, 4];

/// Domicile +5, exaltation +3, detriment −3, fall −5, otherwise 0.
pub fn dignity_score(body: usize, sign: u8) -> i8 {
    let b = body % 10;
    let s = sign % 12;
    if DOMICILES[b].contains(&s) {
        return 5;
    }
    if EXALTATIONS[b] == s {
        return 3;
    }
    if DOMICILES[b].iter().any(|d| (d + 6) % 12 == s) {
        return -3;
    }
    if (EXALTATIONS[b] + 6) % 12 == s {
        return -5;
    }
    0
}

/// The ruler of a sign as a body index, matching the JS `SIGN_RULERS` table.
fn sign_ruler_idx(sign: u8) -> usize {
    crate::chart::sign_ruler(sign).idx()
}

// ════════════════════════════════════════════════════════════════════════════
//  The Arcana Potency Ladder
// ════════════════════════════════════════════════════════════════════════════

/// Freeze the 22-Major potency ladder for one melee from the live sky.
///
/// Planetary Majors read their body's essential dignity, its reception by the
/// ruler of the sign it occupies, and whether it is retrograde. Sign Majors read
/// how crowded their sign is right now, plus the chart character vector when one
/// is supplied (`None` = the uniform 100/12 the JS engine defaults to).
///
/// The result is clamped to 1..=100 so no arcana can ever be worth nothing or
/// overflow the power formula.
pub fn build_arcana_ladder(bodies: &[SkyBody], sign_vector: Option<&[f32; 12]>) -> Ladder {
    let mut occupancy = [0u8; 12];
    // body index → its live position. Later entries win, as in the JS map build.
    let mut placed: [Option<SkyBody>; 10] = [None; 10];
    for b in bodies {
        let i = b.body.idx();
        let mut norm = *b;
        norm.sign %= 12;
        placed[i] = Some(norm);
        occupancy[norm.sign as usize] += 1;
    }

    let uniform = [100.0f32 / 12.0; 12];
    let char_vec = sign_vector.unwrap_or(&uniform);

    let mut ladder = [50u8; 22];
    for arcana in 0..22u8 {
        let raw: f32 = if ARCANA_IS_PLANETARY[arcana as usize] {
            let b = planetary_body_of(arcana);
            // An absent body falls back to its own domicile, direct and above the
            // horizon — the JS engine's `planetMap[b] || {…}` default.
            let p = placed[b].unwrap_or(SkyBody {
                body: Planet::from_idx(b as u8),
                sign: DOMICILES[b].first().copied().unwrap_or(0),
                retrograde: false,
                up: true,
            });
            let s = p.sign % 12;
            let dig = dignity_score(b, s) as f32;

            // Reception: in another's sign 0.5; mutual reception 1.5.
            let mut reception = 0.0f32;
            let ruler = sign_ruler_idx(s);
            if ruler != b {
                reception = 0.5;
                if let Some(other) = placed[ruler] {
                    if sign_ruler_idx(other.sign % 12) == b {
                        reception = 1.5;
                    }
                }
            }

            50.0 + 5.0 * dig + 5.0 * reception - if p.retrograde { 8.0 } else { 0.0 }
                + if p.up { 3.0 } else { 0.0 }
        } else {
            let s = sign_of_arcana(arcana) as usize;
            20.0 + 9.0 * occupancy[s] as f32 + 0.35 * char_vec[s]
        };
        ladder[arcana as usize] = raw.round().clamp(1.0, 100.0) as u8;
    }
    ladder
}

/// A Major's frozen potency, defaulting to the mid-ladder 50 for a rank that is
/// somehow out of range.
fn potency_of(card: &MeleeCard, ladder: &Ladder) -> u8 {
    if card.rank < 22 {
        ladder[card.rank as usize]
    } else {
        50
    }
}

/// Serialise a ladder as the `{"0":50,…}` JSON the `melee_table.ladder_raw`
/// column and the JS client both expect.
pub fn ladder_to_json(ladder: &Ladder) -> String {
    let mut s = String::with_capacity(200);
    s.push('{');
    for (i, v) in ladder.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push('"');
        s.push_str(&i.to_string());
        s.push_str("\":");
        s.push_str(&v.to_string());
    }
    s.push('}');
    s
}

/// Read a ladder back out of `ladder_raw`. Tolerant by design: any key it cannot
/// parse keeps the neutral 50, because a malformed ladder must degrade a melee,
/// never abort one that is already under way.
pub fn ladder_from_json(raw: &str) -> Ladder {
    let mut ladder = NEUTRAL_LADDER;
    for part in raw.trim_matches(['{', '}'].as_ref()).split(',') {
        let mut kv = part.splitn(2, ':');
        let (Some(k), Some(v)) = (kv.next(), kv.next()) else { continue };
        let key = k.trim().trim_matches('"').parse::<usize>();
        let val = v.trim().trim_matches('"').parse::<f32>();
        if let (Ok(k), Ok(v)) = (key, val) {
            if k < 22 {
                ladder[k] = v.round().clamp(1.0, 100.0) as u8;
            }
        }
    }
    ladder
}

// ════════════════════════════════════════════════════════════════════════════
//  Trick power & counters
// ════════════════════════════════════════════════════════════════════════════

/// Ace 14 > 10 13 > King 12 > Queen 11 > Knight 10 > Page 9 > 9..2 as 8..1.
pub fn minor_trick_power(rank: u8) -> u32 {
    match rank {
        1 => 14,
        10 => 13,
        14 => 12,
        13 => 11,
        12 => 10,
        11 => 9,
        2..=9 => (rank - 1) as u32,
        _ => 0,
    }
}

/// Three tiers, and the gaps between them are what make the game legible:
/// any Major beats any trump minor beats any plain minor.
pub fn card_power(card: &MeleeCard, trump: Suit, ladder: &Ladder) -> u32 {
    if card.is_major {
        return 1000 + potency_of(card, ladder) as u32 * 10 + card.rank as u32;
    }
    let rank_power = minor_trick_power(card.rank);
    if card.suit == trump {
        return 500 + rank_power;
    }
    rank_power
}

/// Aces, Tens and Kings are worth ten; the three Honours are worth ten. An
/// inverted (retrograde-minted) card is worth half.
pub fn counter_value(card: &MeleeCard) -> u16 {
    if card.is_major {
        if MAJOR_HONOURS.contains(&card.rank) {
            return if card.inverted { 5 } else { 10 };
        }
        return 0;
    }
    if matches!(card.rank, 1 | 10 | 14) {
        return if card.inverted { 5 } else { 10 };
    }
    0
}

fn is_excuse(card: &MeleeCard) -> bool {
    card.is_major && card.rank == EXCUSE_ARCANA
}

/// The play currently winning the trick, ignoring the Excuse (which never
/// competes). Returns the index into `trick`.
fn winning_index(trick: &[MeleeCard], trump: Suit, ladder: &Ladder) -> Option<usize> {
    let mut best: Option<(usize, u32)> = None;
    for (i, c) in trick.iter().enumerate() {
        if is_excuse(c) {
            continue;
        }
        let p = card_power(c, trump, ladder);
        if best.is_none_or(|(_, bp)| p > bp) {
            best = Some((i, p));
        }
    }
    best.map(|(i, _)| i)
}

// ════════════════════════════════════════════════════════════════════════════
//  Legality
// ════════════════════════════════════════════════════════════════════════════

/// Which cards in `hand` may legally be played into `trick` right now.
///
/// The rules, in the order they bite:
///   0. The Excuse (The Fool) is always legal and overrides everything.
///   1. On the lead, anything is legal.
///   2. Under an Arcana lead nothing is compelled — a minor is always a legal
///      slough — but a player who *chooses* to contest with a Major must beat the
///      Major currently winning if they hold one that can.
///   3. Under a minor lead: follow suit if you can, and beat the winner if you
///      can beat it in-suit.
///   4. Void in the led suit: Majors are permitted (and must beat if they can);
///      otherwise you must trump if you hold trump minors, over-trumping when you
///      can. Void in both, slough anything.
pub fn legal_mask(hand: &[MeleeCard], trick: &[MeleeCard], trump: Suit, ladder: &Ladder) -> Vec<bool> {
    if hand.is_empty() {
        return Vec::new();
    }
    if trick.is_empty() {
        return vec![true; hand.len()];
    }

    let first = trick[0];
    let major_lead = first.is_major;
    let led_suit = first.suit;
    let win_idx = winning_index(trick, trump, ladder);
    let winner = win_idx.map(|i| trick[i]);

    let has_led_minor = |h: &MeleeCard| !h.is_major && h.suit == led_suit;
    let holds_led = !major_lead && hand.iter().any(has_led_minor);
    let holds_trump_minor = hand.iter().any(|h| !h.is_major && h.suit == trump);

    // "Beats" for Majors compares potency first, arcana index as the tie-break —
    // exactly the ordering `card_power` produces.
    let beats_major = |c: &MeleeCard, w: &MeleeCard| {
        let (cp, wp) = (potency_of(c, ladder), potency_of(w, ladder));
        cp > wp || (cp == wp && c.rank > w.rank)
    };
    let holds_better_major = |w: &MeleeCard| {
        hand.iter()
            .any(|m| m.is_major && m.rank != EXCUSE_ARCANA && beats_major(m, w))
    };

    hand.iter()
        .map(|card| {
            if is_excuse(card) {
                return true;
            }

            // ── An Arcana was led ────────────────────────────────────────────
            if major_lead {
                if !card.is_major {
                    return true; // a minor is always a legal slough
                }
                if let Some(w) = winner.filter(|w| w.is_major) {
                    if holds_better_major(&w) && !beats_major(card, &w) {
                        return false;
                    }
                }
                return true;
            }

            // ── A minor suit was led, and we can follow ──────────────────────
            if holds_led {
                if card.is_major || card.suit != led_suit {
                    return false;
                }
                if let Some(w) = winner.filter(|w| !w.is_major && w.suit == led_suit) {
                    let wp = minor_trick_power(w.rank);
                    let holds_higher = hand
                        .iter()
                        .any(|m| has_led_minor(m) && minor_trick_power(m.rank) > wp);
                    if holds_higher && minor_trick_power(card.rank) <= wp {
                        return false;
                    }
                }
                return true;
            }

            // ── Void in the led suit ─────────────────────────────────────────
            if card.is_major {
                if let Some(w) = winner.filter(|w| w.is_major) {
                    if holds_better_major(&w) && !beats_major(card, &w) {
                        return false;
                    }
                }
                return true;
            }

            if holds_trump_minor {
                if card.suit != trump {
                    return false; // must trump, or play a Major
                }
                if let Some(w) = winner.filter(|w| !w.is_major && w.suit == trump) {
                    let wp = minor_trick_power(w.rank);
                    let holds_higher = hand
                        .iter()
                        .any(|t| !t.is_major && t.suit == trump && minor_trick_power(t.rank) > wp);
                    if holds_higher && minor_trick_power(card.rank) <= wp {
                        return false;
                    }
                }
                return true;
            }

            true // void in the led suit and in trump — slough freely
        })
        .collect()
}

/// Is this exact card a legal play from this hand right now?
pub fn is_legal_play(
    hand: &[MeleeCard],
    card_id: u64,
    trick: &[MeleeCard],
    trump: Suit,
    ladder: &Ladder,
) -> bool {
    let mask = legal_mask(hand, trick, trump, ladder);
    hand.iter()
        .zip(mask)
        .any(|(c, ok)| c.card_id == card_id && ok)
}

// ════════════════════════════════════════════════════════════════════════════
//  Trick resolution
// ════════════════════════════════════════════════════════════════════════════

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TrickOutcome {
    /// Index into the trick, in play order, of the seat that took it.
    pub winner: usize,
    /// Counters harvested, including the climax bonus on trick 12.
    pub counters: u16,
    /// The seat that played the Excuse, if any — it keeps its own card.
    pub excuse: Option<usize>,
    /// The counters on that Excuse, credited to its own player rather than to
    /// the winner. Reported separately so no caller can silently lose them: the
    /// Fool is an Honour worth ten, and a trick it sits in must still conserve.
    pub excuse_counters: u16,
}

/// Resolve a completed trick. The Excuse never competes and never counts toward
/// the pot; everything else does, and the last trick carries ten extra.
pub fn evaluate_trick(
    trick: &[MeleeCard],
    trump: Suit,
    ladder: &Ladder,
    trick_number: u8,
) -> Option<TrickOutcome> {
    if trick.is_empty() {
        return None;
    }
    let mut counters = 0u16;
    let mut excuse = None;
    let mut excuse_counters = 0u16;
    for (i, c) in trick.iter().enumerate() {
        if is_excuse(c) {
            excuse = Some(i);
            excuse_counters = counter_value(c);
            continue;
        }
        counters = counters.saturating_add(counter_value(c));
    }
    if trick_number == TOTAL_TRICKS {
        counters = counters.saturating_add(CLIMAX_BONUS);
    }
    Some(TrickOutcome {
        winner: winning_index(trick, trump, ladder).unwrap_or(0),
        counters,
        excuse,
        excuse_counters,
    })
}

// ════════════════════════════════════════════════════════════════════════════
//  Melds
// ════════════════════════════════════════════════════════════════════════════

const ALL_SUITS: [Suit; 4] = [Suit::Wands, Suit::Cups, Suit::Swords, Suit::Pentacles];

/// The three decan pips of each sign: (suit of the triplicity, the three ranks).
fn decan_trine(sign: u8) -> (Suit, [u8; 3]) {
    let base = match sign % 3 {
        0 => [2, 3, 4],   // cardinal
        1 => [5, 6, 7],   // fixed
        _ => [8, 9, 10],  // mutable
    };
    (sign_element(sign), base)
}

/// Total meld value in a starting hand. The eight canonical melds, scored once
/// each — a hand cannot claim the same meld twice.
pub fn detect_melds(hand: &[MeleeCard], trump: Suit, ladder: &Ladder) -> u16 {
    if hand.is_empty() {
        return 0;
    }
    let has = |s: Suit, r: u8| hand.iter().any(|c| !c.is_major && c.suit == s && c.rank == r);
    let mut total = 0u16;

    // 1. Marriage — King + Queen of a suit (40 in trump, else 20).
    for s in ALL_SUITS {
        if has(s, 14) && has(s, 13) {
            total += if s == trump { 40 } else { 20 };
        }
    }

    // 2. Pinochle — Queen of Swords + Knight of Pentacles.
    if has(Suit::Swords, 13) && has(Suit::Pentacles, 12) {
        total += 40;
    }

    // 3. Full Court — Page, Knight, Queen and King of one suit.
    for s in ALL_SUITS {
        if has(s, 11) && has(s, 12) && has(s, 13) && has(s, 14) {
            total += 60;
        }
    }

    // 4. Decan Trine — the three decan pips of one sign.
    for sign in 0..12u8 {
        let (suit, ranks) = decan_trine(sign);
        if ranks.iter().all(|r| has(suit, *r)) {
            total += 40;
        }
    }

    // 5. Grand Cross — the Ace of all four suits.
    if ALL_SUITS.iter().all(|s| has(*s, 1)) {
        total += 100;
    }

    let majors: Vec<&MeleeCard> = hand.iter().filter(|c| c.is_major).collect();

    // 6. Arcana Trine — any three Major Arcana.
    if majors.len() >= 3 {
        total += 50;
    }

    // 7. The Great Work — The Fool + The Magician + The World.
    if [0u8, 1, 21]
        .iter()
        .all(|r| majors.iter().any(|m| m.rank == *r))
    {
        total += 100;
    }

    // 8. Dignified Trine — three Majors each standing at potency ≥ 60.
    if majors
        .iter()
        .filter(|m| potency_of(m, ladder) >= 60)
        .count()
        >= 3
    {
        total += 75;
    }

    total
}

// ════════════════════════════════════════════════════════════════════════════
//  Deterministic dealing
// ════════════════════════════════════════════════════════════════════════════

/// The mulberry32 the JS engine uses, bit for bit, so a round dealt here and a
/// round replayed in the browser produce the identical hands.
pub struct Rng(u32);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed as u32)
    }
    pub fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b79f5);
        let s = self.0;
        let mut t = (s ^ (s >> 15)).wrapping_mul(1 | s);
        t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
    fn shuffle<T>(&mut self, xs: &mut Vec<T>) {
        for i in (1..xs.len()).rev() {
            let j = (self.next_f64() * (i + 1) as f64) as usize;
            xs.swap(i, j.min(i));
        }
    }
}

/// Deal one seat's twelve from its available cards: at most three Majors (the
/// Arcana Slots), the rest minors, shuffled deterministically. A pool smaller
/// than twelve deals what it has.
pub fn deal_hand(available: &[MeleeCard], rng: &mut Rng) -> Vec<MeleeCard> {
    let mut majors: Vec<MeleeCard> = available.iter().copied().filter(|c| c.is_major).collect();
    let mut minors: Vec<MeleeCard> = available.iter().copied().filter(|c| !c.is_major).collect();
    rng.shuffle(&mut majors);
    rng.shuffle(&mut minors);
    majors.truncate(MAX_MAJORS_IN_HAND);
    majors.extend(minors);
    majors.truncate(HAND_SIZE);
    majors
}

/// Seat order is the ascending ecliptic longitude of each faction's planet at
/// deal time — deterministic, astrological, and it rotates as the sky turns.
pub fn seat_order(factions: &[Planet], planet_lon: &[u16; 10]) -> Vec<Planet> {
    let mut out = factions.to_vec();
    out.sort_by_key(|f| (planet_lon[f.idx()], f.idx()));
    out
}

/// Whose turn it is, given the seats that held a card when the trick began, who
/// leads, and who has already played into it. `None` means the trick is full.
///
/// Pure so it can be tested: the reducer wrapper only supplies the three lists.
/// `src/alchm-chart/war-model.js::deriveTurnSeat` is the client's mirror of this,
/// and the two must agree or the UI points at the wrong player.
pub fn turn_in_rotation(expected: &[u64], leader: u64, played: &[u64]) -> Option<u64> {
    if expected.is_empty() || played.len() >= expected.len() {
        return None;
    }
    // A leader that is not in the rotation (it ran out of cards taking the last
    // trick) simply starts the walk at the top rather than stalling it.
    let start = expected.iter().position(|id| *id == leader).unwrap_or(0);
    (0..expected.len())
        .map(|k| expected[(start + k) % expected.len()])
        .find(|id| !played.contains(id))
}

// ════════════════════════════════════════════════════════════════════════════
//  The ten Astrological Combat Archetypes
// ════════════════════════════════════════════════════════════════════════════

/// Sort helper: indices of `hand` that are legal, ordered by ascending power.
fn legal_by_power(
    hand: &[MeleeCard],
    trick: &[MeleeCard],
    trump: Suit,
    ladder: &Ladder,
) -> Vec<usize> {
    let mask = legal_mask(hand, trick, trump, ladder);
    let mut idxs: Vec<usize> = (0..hand.len()).filter(|i| mask[*i]).collect();
    idxs.sort_by_key(|i| (card_power(&hand[*i], trump, ladder), hand[*i].card_id));
    idxs
}

/// The baseline referee brain, mirroring `GuardianAI.choose`: lead a side Ace or
/// a low probe, win with the *weakest sufficient* card, and dump zero-counter
/// junk when the trick is lost.
pub fn guardian_pick(
    hand: &[MeleeCard],
    trick: &[MeleeCard],
    trump: Suit,
    ladder: &Ladder,
) -> Option<usize> {
    let legal = legal_by_power(hand, trick, trump, ladder);
    if legal.len() <= 1 {
        return legal.first().copied().or(if hand.is_empty() { None } else { Some(0) });
    }

    if trick.is_empty() {
        // Side Aces harvest ten counters on a trick nobody expects to contest.
        if let Some(i) = legal.iter().find(|i| {
            let c = &hand[**i];
            !c.is_major && c.rank == 1 && c.suit != trump
        }) {
            return Some(*i);
        }
        // Otherwise lead the lowest probe that is neither an Ace nor a Ten.
        if let Some(i) = legal.iter().find(|i| {
            let c = &hand[**i];
            !c.is_major && c.rank != 1 && c.rank != 10
        }) {
            return Some(*i);
        }
        return legal.first().copied();
    }

    let (winners, losers) = split_winners(hand, &legal, trick, trump, ladder);
    if let Some(i) = winners.first() {
        return Some(*i); // weakest sufficient winner — `legal` is power-ascending
    }
    // Cannot win: shed the cheapest zero-counter card.
    losers
        .iter()
        .find(|i| counter_value(&hand[**i]) == 0)
        .copied()
        .or_else(|| legal.first().copied())
}

/// Partition power-ascending legal indices into those that would take the trick
/// and those that would not.
fn split_winners(
    hand: &[MeleeCard],
    legal: &[usize],
    trick: &[MeleeCard],
    trump: Suit,
    ladder: &Ladder,
) -> (Vec<usize>, Vec<usize>) {
    let high = winning_index(trick, trump, ladder)
        .map(|i| card_power(&trick[i], trump, ladder))
        .unwrap_or(0);
    legal
        .iter()
        .partition(|i| !is_excuse(&hand[**i]) && card_power(&hand[**i], trump, ladder) > high)
}

/// Counters already sitting in the pot — how much this trick is worth taking.
fn pot_points(trick: &[MeleeCard]) -> u16 {
    trick.iter().map(counter_value).sum()
}

/// Choose a play for an autonomous seat according to its faction's doctrine.
///
/// Each archetype expresses a *preference*; when the preference has nothing to
/// say the seat falls back to `guardian_pick`. Every branch here selects from
/// `legal_mask` output only, so a doctrine can never produce an illegal play —
/// the filter, not the doctrine, is authoritative.
pub fn archetype_pick(
    faction: Planet,
    hand: &[MeleeCard],
    trick: &[MeleeCard],
    trump: Suit,
    ladder: &Ladder,
    trick_number: u8,
) -> Option<usize> {
    let legal = legal_by_power(hand, trick, trump, ladder);
    if legal.len() <= 1 {
        return legal.first().copied().or(if hand.is_empty() { None } else { Some(0) });
    }
    let is_lead = trick.is_empty();
    let pot = pot_points(trick);
    let (winners, _) = split_winners(hand, &legal, trick, trump, ladder);
    let strongest_winner = winners.last().copied();
    let weakest_winner = winners.first().copied();
    let strongest_legal = legal.last().copied();

    let chosen = match faction {
        // Sun · Radiance — lead dignified trumps, sweep a fat pot with the top card.
        Planet::Sun => {
            if is_lead {
                legal
                    .iter()
                    .rev()
                    .find(|i| hand[**i].is_major || hand[**i].suit == trump)
                    .copied()
            } else if pot >= 10 {
                strongest_winner
            } else {
                None
            }
        }
        // Moon · Tides — commit only when the pot is worth the tide.
        Planet::Moon => {
            if !is_lead && pot >= 10 {
                weakest_winner
            } else {
                None
            }
        }
        // Mercury · Quicksilver — cunning probe leads, minimum sufficient wins.
        Planet::Mercury => {
            if is_lead {
                legal
                    .iter()
                    .find(|i| {
                        let c = &hand[**i];
                        !c.is_major && (2..=9).contains(&c.rank)
                    })
                    .copied()
            } else {
                weakest_winner
            }
        }
        // Venus · Concord — lead the highest off-suit court, keeping trump intact.
        Planet::Venus => {
            if is_lead {
                legal
                    .iter()
                    .rev()
                    .find(|i| !hand[**i].is_major && hand[**i].suit != trump)
                    .copied()
            } else {
                None
            }
        }
        // Mars · Onslaught — always the strongest card available.
        Planet::Mars => {
            if is_lead {
                strongest_legal
            } else {
                strongest_winner
            }
        }
        // Jupiter · Expansion — deploy Majors early to seize the table.
        Planet::Jupiter => {
            if is_lead {
                legal
                    .iter()
                    .rev()
                    .find(|i| hand[**i].is_major && hand[**i].rank != EXCUSE_ARCANA)
                    .copied()
            } else {
                None
            }
        }
        // Saturn · Endurance — hoard through trick 9, then strike for the climax.
        Planet::Saturn => {
            if trick_number >= 10 {
                strongest_winner
            } else if is_lead {
                legal.iter().find(|i| !hand[**i].is_major).copied()
            } else if pot < 10 || winners.is_empty() {
                legal.iter().find(|i| counter_value(&hand[**i]) == 0).copied()
            } else {
                None
            }
        }
        // Uranus · Upheaval — spend the Excuse where it costs nothing.
        Planet::Uranus => {
            if !is_lead && pot == 0 {
                legal.iter().find(|i| is_excuse(&hand[**i])).copied()
            } else {
                None
            }
        }
        // Neptune · Dissolution — slough away and let rivals burn each other's trumps.
        Planet::Neptune => {
            if !is_lead && pot < 10 && !winners.is_empty() {
                legal.iter().find(|i| counter_value(&hand[**i]) == 0).copied()
            } else {
                None
            }
        }
        // Pluto · Transformation — dormant, then converts the endgame.
        Planet::Pluto => {
            if trick_number >= 8 {
                strongest_winner
            } else {
                None
            }
        }
    };

    chosen.or_else(|| guardian_pick(hand, trick, trump, ladder))
}

// ════════════════════════════════════════════════════════════════════════════
//  Tests
// ════════════════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════════════════
//  Cross-engine parity harness
// ════════════════════════════════════════════════════════════════════════════
//
// The browser predicts what this module will do, and the two must not drift. The
// harness below reads a case file, answers every case, and prints the answers;
// `scripts/melee-parity.test.mjs` generates that file, runs the JS engine over
// the same cases, and diffs. It is `#[ignore]`d so a plain `cargo test` skips it
// — the JS side drives it, and only it knows where the case file is.
//
// The wire format is deliberately not JSON: a line per case, and a card is
// `M<rank>` for a Major or `<suit-initial><rank>` for a minor, with a trailing
// `!` for inverted. Two tiny parsers beat one dependency.
//
// Answers go to a FILE rather than stdout because `spacetime generate` rejects a
// module containing any stdout print macro — it cannot tell test code from reducer
// code, and such a print inside a WASM reducer would silently vanish. The file is
// also sturdier: the JS side reads exactly what Rust wrote, with no cargo chatter
// to filter out of the middle of it.
#[cfg(test)]
mod parity {
    use super::*;

    fn suit_of(c: char) -> Suit {
        match c {
            'c' => Suit::Cups,
            's' => Suit::Swords,
            'p' => Suit::Pentacles,
            _ => Suit::Wands,
        }
    }

    fn parse_card(tok: &str) -> MeleeCard {
        let inverted = tok.ends_with('!');
        let t = tok.trim_end_matches('!');
        if let Some(rank) = t.strip_prefix('M') {
            return MeleeCard {
                card_id: 0,
                suit: Suit::Wands,
                rank: rank.parse().unwrap_or(0),
                is_major: true,
                inverted,
            };
        }
        let (head, rank) = t.split_at(1);
        MeleeCard {
            card_id: 0,
            suit: suit_of(head.chars().next().unwrap_or('w')),
            rank: rank.parse().unwrap_or(0),
            is_major: false,
            inverted,
        }
    }

    fn parse_cards(field: &str) -> Vec<MeleeCard> {
        field
            .split_whitespace()
            .filter(|t| !t.is_empty())
            .enumerate()
            .map(|(i, t)| MeleeCard { card_id: i as u64 + 1, ..parse_card(t) })
            .collect()
    }

    /// Driven by `scripts/melee-parity.test.mjs`, which sets both env vars.
    #[test]
    #[ignore = "driven by scripts/melee-parity.test.mjs"]
    fn answer_parity_cases() {
        let path = std::env::var("MELEE_PARITY_INPUT")
            .expect("set MELEE_PARITY_INPUT to the case file");
        let out_path = std::env::var("MELEE_PARITY_OUTPUT")
            .expect("set MELEE_PARITY_OUTPUT to the answer file");
        let body = std::fs::read_to_string(&path).expect("case file unreadable");

        let mut answers = String::new();
        for line in body.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let fields: Vec<&str> = line.split('|').map(str::trim).collect();
            let mut head = fields[0].split_whitespace();
            let kind = head.next().unwrap_or("");

            let out = match kind {
                "LADDER" => {
                    let bodies: Vec<SkyBody> = head
                        .map(|t| {
                            let parts: Vec<&str> = t.split(':').collect();
                            SkyBody {
                                body: Planet::from_idx(parts[0].parse().unwrap_or(0)),
                                sign: parts[1].parse().unwrap_or(0),
                                retrograde: parts.get(2).is_some_and(|r| *r == "1"),
                                up: true,
                            }
                        })
                        .collect();
                    let l = build_arcana_ladder(&bodies, None);
                    l.iter().map(|v| v.to_string()).collect::<Vec<_>>().join(",")
                }
                "POWER" => {
                    let trump = suit_of(head.next().unwrap_or("w").chars().next().unwrap());
                    let card = parse_card(head.next().unwrap_or("w2"));
                    card_power(&card, trump, &NEUTRAL_LADDER).to_string()
                }
                "COUNTER" => counter_value(&parse_card(head.next().unwrap_or("w2"))).to_string(),
                "LEGAL" => {
                    let trump = suit_of(head.next().unwrap_or("w").chars().next().unwrap());
                    let hand = parse_cards(fields[1]);
                    let trick = parse_cards(fields.get(2).copied().unwrap_or(""));
                    legal_mask(&hand, &trick, trump, &NEUTRAL_LADDER)
                        .iter()
                        .map(|b| if *b { "1" } else { "0" })
                        .collect::<Vec<_>>()
                        .join("")
                }
                "TRICK" => {
                    let trump = suit_of(head.next().unwrap_or("w").chars().next().unwrap());
                    let no: u8 = head.next().unwrap_or("1").parse().unwrap_or(1);
                    let trick = parse_cards(fields[1]);
                    match evaluate_trick(&trick, trump, &NEUTRAL_LADDER, no) {
                        Some(o) => format!("{},{},{}", o.winner, o.counters, o.excuse_counters),
                        None => "none".to_string(),
                    }
                }
                "MELDS" => {
                    let trump = suit_of(head.next().unwrap_or("w").chars().next().unwrap());
                    detect_melds(&parse_cards(fields[1]), trump, &NEUTRAL_LADDER).to_string()
                }
                other => format!("UNKNOWN:{other}"),
            };
            answers.push_str(&out);
            answers.push('\n');
        }
        std::fs::write(&out_path, answers).expect("could not write the answer file");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn minor(card_id: u64, suit: Suit, rank: u8) -> MeleeCard {
        MeleeCard { card_id, suit, rank, is_major: false, inverted: false }
    }
    fn major(card_id: u64, rank: u8) -> MeleeCard {
        MeleeCard { card_id, suit: Suit::Wands, rank, is_major: true, inverted: false }
    }

    // ── Ladder ──────────────────────────────────────────────────────────────

    /// Every rung is inside 1..=100 whatever the sky does, including an empty one.
    #[test]
    fn ladder_is_always_in_range() {
        for bodies in [
            vec![],
            crate::types::ALL_PLANETS
                .iter()
                .map(|p| SkyBody { body: *p, sign: 7, retrograde: true, up: false })
                .collect(),
        ] {
            let l = build_arcana_ladder(&bodies, None);
            assert!(l.iter().all(|v| (1..=100).contains(v)), "ladder out of range: {l:?}");
        }
    }

    /// A dignified, direct body outranks the same body retrograde in its fall.
    #[test]
    fn dignity_and_retrograde_move_a_planetary_rung() {
        // XIX The Sun reads the Sun. Domicile Leo (4) vs fall Aquarius (10).
        let strong = build_arcana_ladder(
            &[SkyBody { body: Planet::Sun, sign: 4, retrograde: false, up: true }],
            None,
        );
        let weak = build_arcana_ladder(
            &[SkyBody { body: Planet::Sun, sign: 10, retrograde: true, up: true }],
            None,
        );
        assert!(strong[19] > weak[19], "{} !> {}", strong[19], weak[19]);
    }

    /// A crowded sign lifts its Sign Major; that is the whole point of the rung.
    #[test]
    fn occupancy_lifts_a_sign_rung() {
        let empty = build_arcana_ladder(&[], None);
        let stellium: Vec<SkyBody> = crate::types::ALL_PLANETS
            .iter()
            .map(|p| SkyBody { body: *p, sign: 0, retrograde: false, up: true })
            .collect();
        let crowded = build_arcana_ladder(&stellium, None);
        // IV The Emperor reads Aries.
        assert!(crowded[4] > empty[4]);
    }

    /// `ladder_raw` survives the round trip the client and the feeder both make.
    #[test]
    fn ladder_json_round_trips() {
        let l = build_arcana_ladder(
            &[SkyBody { body: Planet::Mars, sign: 0, retrograde: false, up: true }],
            None,
        );
        assert_eq!(ladder_from_json(&ladder_to_json(&l)), l);
        // Garbage degrades to neutral rather than exploding.
        assert_eq!(ladder_from_json("not json at all"), NEUTRAL_LADDER);
    }

    // ── Power & counters ────────────────────────────────────────────────────

    /// The three tiers never overlap: Major > trump minor > plain minor.
    #[test]
    fn power_tiers_never_overlap() {
        let l = NEUTRAL_LADDER;
        let weakest_major = card_power(&major(1, 0), Suit::Wands, &l);
        let strongest_trump = card_power(&minor(2, Suit::Wands, 1), Suit::Wands, &l);
        let strongest_plain = card_power(&minor(3, Suit::Cups, 1), Suit::Wands, &l);
        assert!(weakest_major > strongest_trump);
        assert!(strongest_trump > strongest_plain);
    }

    /// Seventy counters live in a deal, and inversion halves a card's worth.
    #[test]
    fn counters_match_the_engine() {
        assert_eq!(counter_value(&minor(1, Suit::Cups, 1)), 10);
        assert_eq!(counter_value(&minor(2, Suit::Cups, 10)), 10);
        assert_eq!(counter_value(&minor(3, Suit::Cups, 14)), 10);
        assert_eq!(counter_value(&minor(4, Suit::Cups, 13)), 0);
        assert_eq!(counter_value(&major(5, 21)), 10, "The World is an Honour");
        assert_eq!(counter_value(&major(6, 13)), 0, "Death is not");
        let inv = MeleeCard { inverted: true, ..minor(7, Suit::Cups, 1) };
        assert_eq!(counter_value(&inv), 5);
    }

    // ── Legality ────────────────────────────────────────────────────────────

    /// Holding the led suit compels following it — Majors included.
    #[test]
    fn must_follow_the_led_minor_suit() {
        let hand = vec![minor(1, Suit::Cups, 5), minor(2, Suit::Swords, 9), major(3, 13)];
        let trick = vec![minor(9, Suit::Cups, 3)];
        let mask = legal_mask(&hand, &trick, Suit::Wands, &NEUTRAL_LADDER);
        assert_eq!(mask, vec![true, false, false]);
    }

    /// Void in the led suit but holding trump: you must trump, or play a Major.
    #[test]
    fn void_in_led_suit_must_trump_or_go_major() {
        let hand = vec![minor(1, Suit::Wands, 5), minor(2, Suit::Swords, 9), major(3, 13)];
        let trick = vec![minor(9, Suit::Cups, 3)];
        let mask = legal_mask(&hand, &trick, Suit::Wands, &NEUTRAL_LADDER);
        assert_eq!(mask, vec![true, false, true]);
    }

    /// An Arcana lead compels nothing: a minor is always a legal slough, and a
    /// Major that cannot beat the winner is still legal *while the hand holds no
    /// Major that could*. Contesting properly is only required when it is possible.
    #[test]
    fn arcana_lead_compels_nothing() {
        let trick = vec![major(9, 20)];

        // Nothing in hand beats XX, so the low Major may be spent freely.
        let hopeless = vec![minor(1, Suit::Cups, 5), minor(2, Suit::Wands, 9), major(3, 13)];
        assert_eq!(
            legal_mask(&hopeless, &trick, Suit::Wands, &NEUTRAL_LADDER),
            vec![true, true, true],
            "minors slough; a losing Major is free when nothing better is held"
        );

        // Add XXI, which ties on potency and wins on index: now the low Major is
        // an under-contest and is refused, while the minors still slough.
        let armed = vec![minor(1, Suit::Cups, 5), minor(2, Suit::Wands, 9), major(3, 13), major(4, 21)];
        assert_eq!(
            legal_mask(&armed, &trick, Suit::Wands, &NEUTRAL_LADDER),
            vec![true, true, false, true],
            "holding a beater compels contesting with it"
        );
    }

    /// The Excuse is legal in every position, including ones nothing else is.
    #[test]
    fn the_excuse_is_always_legal() {
        let hand = vec![major(1, EXCUSE_ARCANA), minor(2, Suit::Swords, 9)];
        let trick = vec![minor(9, Suit::Cups, 3)];
        let mask = legal_mask(&hand, &trick, Suit::Wands, &NEUTRAL_LADDER);
        assert!(mask[0], "The Fool overrides every rule");
    }

    /// Leading is unconstrained.
    #[test]
    fn every_card_leads() {
        let hand = vec![minor(1, Suit::Cups, 5), major(2, 13)];
        assert_eq!(legal_mask(&hand, &[], Suit::Wands, &NEUTRAL_LADDER), vec![true, true]);
    }

    // ── Trick resolution ────────────────────────────────────────────────────

    /// Trump beats rank; the Excuse never wins and never adds to the pot.
    #[test]
    fn trump_takes_it_and_the_excuse_abstains() {
        let trick = vec![
            minor(1, Suit::Cups, 1),    // Ace of Cups, led, 10 counters
            minor(2, Suit::Wands, 2),   // a trump deuce
            major(3, EXCUSE_ARCANA),    // The Fool
        ];
        let o = evaluate_trick(&trick, Suit::Wands, &NEUTRAL_LADDER, 1).unwrap();
        assert_eq!(o.winner, 1, "the trump deuce takes the Ace");
        assert_eq!(o.counters, 10);
        assert_eq!(o.excuse, Some(2));
        assert_eq!(o.excuse_counters, 10, "the Fool keeps its own Honour");
    }

    /// The last trick carries ten extra counters, and only the last.
    #[test]
    fn the_climax_pays_only_on_trick_twelve() {
        let trick = vec![minor(1, Suit::Cups, 2), minor(2, Suit::Cups, 3)];
        assert_eq!(evaluate_trick(&trick, Suit::Wands, &NEUTRAL_LADDER, 11).unwrap().counters, 0);
        assert_eq!(evaluate_trick(&trick, Suit::Wands, &NEUTRAL_LADDER, 12).unwrap().counters, 10);
    }

    /// A Major outranks every minor whatever the trump.
    #[test]
    fn a_major_beats_any_minor() {
        let trick = vec![minor(1, Suit::Wands, 1), major(2, 13)];
        assert_eq!(evaluate_trick(&trick, Suit::Wands, &NEUTRAL_LADDER, 1).unwrap().winner, 1);
    }

    // ── Melds ───────────────────────────────────────────────────────────────

    /// A marriage is worth double in trump, and the Great Work stacks with the
    /// Arcana Trine it contains.
    #[test]
    fn melds_score_as_the_engine_scores_them() {
        let plain = vec![minor(1, Suit::Cups, 14), minor(2, Suit::Cups, 13)];
        assert_eq!(detect_melds(&plain, Suit::Wands, &NEUTRAL_LADDER), 20);
        assert_eq!(detect_melds(&plain, Suit::Cups, &NEUTRAL_LADDER), 40);

        let great_work = vec![major(1, 0), major(2, 1), major(3, 21)];
        // Arcana Trine 50 + The Great Work 100. Potency 50 < 60, so no Dignified Trine.
        assert_eq!(detect_melds(&great_work, Suit::Wands, &NEUTRAL_LADDER), 150);
    }

    /// Three Majors standing at 60+ add the Dignified Trine on top.
    #[test]
    fn dignified_trine_needs_potency() {
        let hand = vec![major(1, 2), major(2, 3), major(3, 4)];
        let mut high = NEUTRAL_LADDER;
        for r in [2usize, 3, 4] {
            high[r] = 60;
        }
        assert_eq!(detect_melds(&hand, Suit::Wands, &NEUTRAL_LADDER), 50);
        assert_eq!(detect_melds(&hand, Suit::Wands, &high), 125);
    }

    /// The Grand Cross wants all four Aces and nothing less.
    #[test]
    fn grand_cross_needs_all_four_aces() {
        let three = vec![
            minor(1, Suit::Wands, 1),
            minor(2, Suit::Cups, 1),
            minor(3, Suit::Swords, 1),
        ];
        assert_eq!(detect_melds(&three, Suit::Pentacles, &NEUTRAL_LADDER), 0);
        let mut four = three.clone();
        four.push(minor(4, Suit::Pentacles, 1));
        assert_eq!(detect_melds(&four, Suit::Pentacles, &NEUTRAL_LADDER), 100);
    }

    // ── Dealing ─────────────────────────────────────────────────────────────

    /// Twelve cards, at most three Majors, and the same seed deals the same hand.
    #[test]
    fn the_deal_is_bounded_and_reproducible() {
        let mut pool: Vec<MeleeCard> = (0..9u64).map(|i| major(i, (i % 22) as u8)).collect();
        pool.extend((10..40u64).map(|i| minor(i, Suit::Cups, (i % 14 + 1) as u8)));

        let a = deal_hand(&pool, &mut Rng::new(7));
        let b = deal_hand(&pool, &mut Rng::new(7));
        let c = deal_hand(&pool, &mut Rng::new(8));
        assert_eq!(a.len(), HAND_SIZE);
        assert!(a.iter().filter(|c| c.is_major).count() <= MAX_MAJORS_IN_HAND);
        assert_eq!(a, b, "same seed, same hand");
        assert_ne!(a, c, "a different seed deals differently");
    }

    /// A pool smaller than twelve deals what it has rather than inventing cards.
    #[test]
    fn a_short_pool_deals_short() {
        let pool = vec![minor(1, Suit::Cups, 2), minor(2, Suit::Cups, 3)];
        assert_eq!(deal_hand(&pool, &mut Rng::new(1)).len(), 2);
    }

    /// Seats run in ascending ecliptic longitude, faction index breaking ties.
    #[test]
    fn seats_run_in_ecliptic_order() {
        let mut lon = [0u16; 10];
        lon[Planet::Mars.idx()] = 300;
        lon[Planet::Saturn.idx()] = 100;
        lon[Planet::Mercury.idx()] = 200;
        assert_eq!(
            seat_order(&[Planet::Mars, Planet::Saturn, Planet::Mercury], &lon),
            vec![Planet::Saturn, Planet::Mercury, Planet::Mars]
        );
        assert_eq!(
            seat_order(&[Planet::Mars, Planet::Saturn, Planet::Mercury], &[0; 10]),
            vec![Planet::Mercury, Planet::Mars, Planet::Saturn],
            "ties fall back to faction index"
        );
    }

    // ── Archetypes ──────────────────────────────────────────────────────────

    /// No doctrine can ever pick an illegal card — the filter outranks the AI.
    #[test]
    fn no_archetype_can_play_illegally() {
        let hand = vec![
            minor(1, Suit::Cups, 5),
            minor(2, Suit::Swords, 9),
            minor(3, Suit::Wands, 14),
            major(4, 13),
            major(5, EXCUSE_ARCANA),
        ];
        let trick = vec![minor(9, Suit::Cups, 3)];
        let mask = legal_mask(&hand, &trick, Suit::Wands, &NEUTRAL_LADDER);
        for p in crate::types::ALL_PLANETS {
            for t in 1..=12u8 {
                let i = archetype_pick(p, &hand, &trick, Suit::Wands, &NEUTRAL_LADDER, t)
                    .expect("a non-empty hand always has a play");
                assert!(mask[i], "{p:?} picked an illegal card at trick {t}");
            }
        }
    }

    /// Mars takes the strongest card it holds; Mercury spends the weakest that
    /// still wins. The two doctrines must not agree.
    #[test]
    fn mars_overpowers_where_mercury_economises() {
        // Void in Cups, holding two winning trumps.
        let hand = vec![minor(1, Suit::Wands, 2), minor(2, Suit::Wands, 1)];
        let trick = vec![minor(9, Suit::Cups, 14)];
        let mars = archetype_pick(Planet::Mars, &hand, &trick, Suit::Wands, &NEUTRAL_LADDER, 1);
        let merc = archetype_pick(Planet::Mercury, &hand, &trick, Suit::Wands, &NEUTRAL_LADDER, 1);
        assert_eq!(mars, Some(1), "Mars spends the Ace");
        assert_eq!(merc, Some(0), "Mercury spends the deuce");
    }

    /// Saturn hoards its Majors early and strikes with them at the climax.
    #[test]
    fn saturn_hoards_then_strikes() {
        let hand = vec![minor(1, Suit::Wands, 2), major(2, 20)];
        let trick = vec![minor(9, Suit::Cups, 14)];
        let early = archetype_pick(Planet::Saturn, &hand, &trick, Suit::Wands, &NEUTRAL_LADDER, 2);
        let late = archetype_pick(Planet::Saturn, &hand, &trick, Suit::Wands, &NEUTRAL_LADDER, 11);
        assert_eq!(early, Some(0), "trick 2 — spend the deuce");
        assert_eq!(late, Some(1), "trick 11 — spend the Major");
    }

    // ── Turn rotation ───────────────────────────────────────────────────────

    /// The walk starts at the leader, wraps, and stops when the trick is full.
    #[test]
    fn the_turn_walks_from_the_leader_and_wraps() {
        let seats = [10u64, 20, 30];
        assert_eq!(turn_in_rotation(&seats, 10, &[]), Some(10));
        assert_eq!(turn_in_rotation(&seats, 10, &[10]), Some(20));
        assert_eq!(turn_in_rotation(&seats, 30, &[30]), Some(10), "wraps past the last seat");
        assert_eq!(turn_in_rotation(&seats, 30, &[30, 10]), Some(20));
        assert_eq!(turn_in_rotation(&seats, 30, &[30, 10, 20]), None, "a full trick has no turn");
    }

    /// A seat outside the rotation cannot hold up the table, whether it is the
    /// leader (it spent its last card taking the previous trick) or nobody at all.
    #[test]
    fn a_rotation_without_the_leader_still_moves() {
        assert_eq!(turn_in_rotation(&[20, 30], 10, &[]), Some(20));
        assert_eq!(turn_in_rotation(&[], 10, &[]), None);
        assert_eq!(turn_in_rotation(&[10], 10, &[10]), None);
    }

    /// Every seat plays exactly once per trick, in a stable order, from any
    /// leader — the property the whole trick loop rests on.
    #[test]
    fn a_rotation_seats_everyone_exactly_once() {
        for n in 2..=6u64 {
            let seats: Vec<u64> = (1..=n).collect();
            for leader in 1..=n {
                let mut played: Vec<u64> = Vec::new();
                while let Some(next) = turn_in_rotation(&seats, leader, &played) {
                    assert!(!played.contains(&next), "seat {next} played twice");
                    played.push(next);
                    assert!(played.len() <= seats.len(), "the rotation overran");
                }
                assert_eq!(played.len(), seats.len(), "{n} seats: not everyone played");
                assert_eq!(played[0], leader, "the leader goes first");
            }
        }
    }

    /// Twelve tricks resolve, counters are conserved, and exactly one seat takes
    /// the climax — at every seat count the table supports.
    #[test]
    fn a_full_melee_resolves_at_every_seat_count() {
        for seats in 2..=6usize {
            let ladder = NEUTRAL_LADDER;
            let trump = Suit::Wands;
            let mut hands: Vec<Vec<MeleeCard>> = (0..seats)
                .map(|s| {
                    let mut pool: Vec<MeleeCard> = (0..12u64)
                        .map(|i| {
                            let id = (s as u64 + 1) * 100 + i;
                            if i < 2 {
                                major(id, ((s as u64 * 3 + i) % 22) as u8)
                            } else {
                                minor(
                                    id,
                                    ALL_SUITS[(i as usize + s) % 4],
                                    ((i + s as u64) % 14 + 1) as u8,
                                )
                            }
                        })
                        .collect();
                    pool.truncate(12);
                    pool
                })
                .collect();

            let dealt: u16 = hands.iter().flatten().map(counter_value).sum();
            let mut harvested = vec![0u16; seats];
            let mut leader = 0usize;
            let mut climax_takers = 0;

            for trick_no in 1..=12u8 {
                let mut trick: Vec<MeleeCard> = Vec::with_capacity(seats);
                let mut order: Vec<usize> = Vec::with_capacity(seats);
                for k in 0..seats {
                    let seat = (leader + k) % seats;
                    let mask = legal_mask(&hands[seat], &trick, trump, &ladder);
                    let pick = archetype_pick(
                        Planet::from_idx(seat as u8),
                        &hands[seat],
                        &trick,
                        trump,
                        &ladder,
                        trick_no,
                    )
                    .expect("a live hand always has a play");
                    assert!(mask[pick], "seat {seat} played illegally on trick {trick_no}");
                    trick.push(hands[seat].remove(pick));
                    order.push(seat);
                }
                let out = evaluate_trick(&trick, trump, &ladder, trick_no).unwrap();
                let winner = order[out.winner];
                harvested[winner] += out.counters;
                if let Some(e) = out.excuse {
                    harvested[order[e]] += out.excuse_counters;
                }
                if trick_no == 12 {
                    climax_takers += 1;
                }
                leader = winner;
            }

            assert!(hands.iter().all(|h| h.is_empty()), "{seats} seats: cards left over");
            assert_eq!(
                harvested.iter().sum::<u16>(),
                dealt + CLIMAX_BONUS,
                "{seats} seats: counters are not conserved"
            );
            assert_eq!(climax_takers, 1, "{seats} seats: the climax is taken exactly once");
        }
    }
}
