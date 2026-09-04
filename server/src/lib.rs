//! Pentacles — SpacetimeDB server module (Rust).
//!
//! Authoritative game state for a location-based AR MMO: planetary factions,
//! natal-derived Tarot decks, the eleven-zone Celestial Pentacle, per-star
//! capture feeding a tug-of-war zone meter, and a scheduled sky tick.
//!
//! Layout (mirrors the GDD §09):
//!   types.rs    — enums + value structs (Planet, Suit, Placement, BattleLog …)
//!   tables.rs   — the database schema (players, charts, cards, map state …)
//!   chart.rs    — faction scoring + deterministic deck minting from a chart
//!   combat.rs   — environmental suit weather + auto-siege resolver
//!   reducers.rs — the only writers: create_player, resolve_star_battle,
//!                 tick_sky, enqueue_duel, push_ephemeris, init

mod catalog;
mod chart;
pub mod faucet;
mod melee;
mod combat;
mod constellations;
mod reducers;
mod tables;
mod types;
mod words;

pub use tables::*;
pub use types::*;
