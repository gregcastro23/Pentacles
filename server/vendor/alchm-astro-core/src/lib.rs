//! Astrological & alchemical shared library core.
//!
//! Provides the core definitions, tables, and lookup rules shared between the
//! web backend (Axum/Next.js) and the game backend (SpacetimeDB).

/// Faction representation (the ten astrological bodies).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Planet {
    Sun = 0,
    Moon = 1,
    Mercury = 2,
    Venus = 3,
    Mars = 4,
    Jupiter = 5,
    Saturn = 6,
    Uranus = 7,
    Neptune = 8,
    Pluto = 9,
}

impl Planet {
    pub fn idx(self) -> usize {
        self as usize
    }

    pub fn from_idx(idx: usize) -> Option<Self> {
        match idx {
            0 => Some(Self::Sun),
            1 => Some(Self::Moon),
            2 => Some(Self::Mercury),
            3 => Some(Self::Venus),
            4 => Some(Self::Mars),
            5 => Some(Self::Jupiter),
            6 => Some(Self::Saturn),
            7 => Some(Self::Uranus),
            8 => Some(Self::Neptune),
            9 => Some(Self::Pluto),
            _ => None,
        }
    }
}

/// The four minor arcana elements (suits).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Suit {
    Wands,      // Fire
    Cups,       // Water
    Swords,     // Air
    Pentacles,  // Earth
}

/// Traditional zodiac signs in order starting at 0 = Aries.
pub const ZODIAC_SIGNS: [&str; 12] = [
    "Aries", "Taurus", "Gemini", "Cancer",
    "Leo", "Virgo", "Libra", "Scorpio",
    "Sagittarius", "Capricorn", "Aquarius", "Pisces"
];

/// Modality types for zodiac signs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Modality {
    Cardinal,
    Fixed,
    Mutable,
}

/// Sign index (0 = Aries) to element suit.
pub fn sign_element(sign: u8) -> Suit {
    match sign % 4 {
        0 => Suit::Wands,
        1 => Suit::Pentacles,
        2 => Suit::Swords,
        _ => Suit::Cups,
    }
}

/// Traditional rulership mapping.
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

/// Get modality of a zodiac sign index.
pub fn sign_modality(sign: u8) -> Modality {
    match sign % 12 {
        0 | 3 | 6 | 9 => Modality::Cardinal,
        1 | 4 | 7 | 10 => Modality::Fixed,
        _ => Modality::Mutable,
    }
}
