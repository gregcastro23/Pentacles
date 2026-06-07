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
pub enum CombatModel { LaneSkirmish, SpreadDuel, AutoSiege }

/// Lifecycle of a live 3-lane duel.
#[derive(SpacetimeType, Clone, Copy, PartialEq, Eq, Debug)]
pub enum DuelState { Active, Resolved }

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

    /// The Major-Arcana hero trump attributed to this faction (Golden Dawn
    /// planetary attributions — GDD §04). Minted as the deck's one `is_trump`.
    pub fn hero_trump(self) -> &'static str {
        match self {
            Planet::Sun => "The Sun",
            Planet::Moon => "The High Priestess",
            Planet::Mercury => "The Magician",
            Planet::Venus => "The Empress",
            Planet::Mars => "The Tower",
            Planet::Jupiter => "Wheel of Fortune",
            Planet::Saturn => "The World",
            Planet::Uranus => "The Fool",
            Planet::Neptune => "The Hanged Man",
            Planet::Pluto => "Judgement",
        }
    }

    /// Map a 0..9 index back to a planet (for machine feeds / CLI calls).
    pub fn from_idx(i: u8) -> Planet {
        ALL_PLANETS[(i as usize).min(9)]
    }
}
