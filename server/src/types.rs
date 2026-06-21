//! Value types shared across tables and reducers.

use spacetimedb::SpacetimeType;

/// The ten planetary factions.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Planet {
    Sun, Moon, Mercury, Venus, Mars,
    Jupiter, Saturn, Uranus, Neptune, Pluto,
}

/// The four Minor-Arcana suits (elementally typed).
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Suit { Cups, Swords, Pentacles, Wands }

/// Zone geometry class within the Pentacle.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ZoneKind { House, Spire, Crown }

/// Where a card currently sits for its owner.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Loadout { Active, Defense, Bench }

/// Combat model in play (season-level switch; resolver serves all three).
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum CombatModel { LaneSkirmish, AutoSiege }

/// House-division system a chart's cusps were derived under. Placidus is the
/// default; Whole Sign is the graceful fallback above the polar circle and for
/// time-unknown (solar) charts, where an unequal system can't be trusted.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum HouseSystem { Placidus, WholeSign }

/// Lifecycle of a live 3-lane duel.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum DuelState { Active, Resolved }

/// Lifecycle of a two-sided card trade.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum TradeState { Open, Committed, Cancelled }

/// One natal placement, packed to the arc-minute.
#[derive(SpacetimeType, Clone, Debug)]
pub struct Placement {
    pub body: Planet,
    pub sign: u8,          // 0..11 (Aries..Pisces)
    pub arc_minutes: u16,  // 0..1799 within the sign (degree*60 + minute)
    pub retrograde: bool,
    pub dignity: i8,       // -5 fall .. +5 rulership
}

impl Placement {
    /// 0..29 — whole degree within the sign.
    pub fn degree(&self) -> u8 { (self.arc_minutes / 60) as u8 }
    /// 0..59 — arc-minute within the degree.
    pub fn minute(&self) -> u8 { (self.arc_minutes % 60) as u8 }
    /// Absolute zodiac longitude in arc-minutes (0..21599).
    pub fn abs_minutes(&self) -> u16 { self.sign as u16 * 1800 + self.arc_minutes }
}

/// Client-submitted record of a duel, re-simulated authoritatively on the server.
#[derive(SpacetimeType, Clone, Debug)]
pub struct BattleLog {
    pub model: CombatModel,
    pub plays: Vec<u64>, // attacker card_ids, in the order they were played
}

pub const ALL_PLANETS: [Planet; 10] = [
    Planet::Sun, Planet::Moon, Planet::Mercury, Planet::Venus, Planet::Mars,
    Planet::Jupiter, Planet::Saturn, Planet::Uranus, Planet::Neptune, Planet::Pluto,
];

impl Planet {
    pub fn idx(self) -> usize {
        match self {
            Planet::Sun => 0, Planet::Moon => 1, Planet::Mercury => 2, Planet::Venus => 3,
            Planet::Mars => 4, Planet::Jupiter => 5, Planet::Saturn => 6, Planet::Uranus => 7,
            Planet::Neptune => 8, Planet::Pluto => 9,
        }
    }

    /// The suit a faction's deck generation is biased toward (GDD §03).
    pub fn biased_suit(self) -> Suit {
        match self {
            Planet::Sun | Planet::Mars | Planet::Jupiter => Suit::Wands,
            Planet::Moon | Planet::Venus | Planet::Neptune => Suit::Cups,
            Planet::Mercury | Planet::Uranus | Planet::Pluto => Suit::Swords,
            Planet::Saturn => Suit::Pentacles,
        }
    }

    /// Map a 0..9 index back to a planet (for machine feeds / CLI calls).
    pub fn from_idx(i: u8) -> Planet {
        ALL_PLANETS[(i as usize).min(9)]
    }
}

// ── The Jing Arena — elemental duel moves ───────────────────────────────────
// Ported from the planetary_agents "Jing" metagame. The five moves map onto the
// four ESMS elements (0=Spirit/Fire, 1=Essence/Water, 2=Matter/Earth,
// 3=Substance/Air); Erode is the Water·Earth compound. A cast drains a Sacred-7
// stat + an ESMS pool; moves beat each other on a fixed counter graph.

/// The five elemental Jing moves.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum JingMove { Meltdown, Freeze, TectonicRoot, Vacuum, Erode }

/// Lifecycle of a standalone cast→counter Jing duel thread.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum JingState { Open, Countered, Resolved }

impl JingMove {
    /// Stable index (also the order shown to the client).
    pub fn idx(self) -> usize {
        match self {
            JingMove::Meltdown => 0, JingMove::Freeze => 1, JingMove::TectonicRoot => 2,
            JingMove::Vacuum => 3, JingMove::Erode => 4,
        }
    }
    /// Primary ESMS element id drained (0=Spirit,1=Essence,2=Matter,3=Substance).
    pub fn esms(self) -> u8 {
        match self {
            JingMove::Meltdown => 0, JingMove::Freeze => 1, JingMove::TectonicRoot => 2,
            JingMove::Vacuum => 3, JingMove::Erode => 1,
        }
    }
    /// Sacred-7 stat index drained: [power,resonance,wisdom,charisma,intuition,adaptability,vitality].
    pub fn sacred7(self) -> usize {
        match self {
            JingMove::Meltdown => 6,      // vitality
            JingMove::Freeze => 5,        // adaptability
            JingMove::TectonicRoot => 2,  // wisdom
            JingMove::Vacuum => 3,        // charisma
            JingMove::Erode => 4,         // intuition
        }
    }
    /// The moves that beat `self` (the counter graph from constants.ts).
    pub fn countered_by(self) -> &'static [JingMove] {
        match self {
            JingMove::Meltdown => &[JingMove::Vacuum],
            JingMove::Freeze => &[JingMove::Meltdown],
            JingMove::TectonicRoot => &[JingMove::Erode],
            JingMove::Vacuum => &[JingMove::Freeze],
            JingMove::Erode => &[JingMove::Vacuum],
        }
    }
    /// Resolve initiator vs responder → Some(true) initiator wins, Some(false)
    /// responder wins, None = draw (neither counters the other).
    pub fn resolve(initiator: JingMove, responder: JingMove) -> Option<bool> {
        let resp_beats_init = initiator.countered_by().contains(&responder);
        let init_beats_resp = responder.countered_by().contains(&initiator);
        if init_beats_resp && !resp_beats_init { Some(true) }
        else if resp_beats_init && !init_beats_resp { Some(false) }
        else { None }
    }
}
