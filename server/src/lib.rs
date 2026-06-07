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
//!   combat.rs   — the suit triangle + auto-siege resolver
//!   reducers.rs — the only writers: create_player, resolve_star_battle,
//!                 tick_sky, enqueue_duel, push_ephemeris, init
//!
//! NOTE: this is a faithful scaffold against the modern SpacetimeDB Rust API.
//! Run `spacetime build` and adjust any method signatures that drifted in your
//! installed version (find/update/delete arg-by-ref vs by-value is the usual one).

mod chart;
mod combat;
mod reducers;
mod tables;
mod types;

pub use tables::*;
pub use types::*;
