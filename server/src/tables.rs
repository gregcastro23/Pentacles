//! The database schema. Public tables stream to every client as the live map;
//! `natal_chart` is private to its owner. Clients never write — only reducers do.

use crate::types::*;
use spacetimedb::{Identity, ScheduleAt, Timestamp};
use crate::reducers::tick_sky;

// ── Identity & natal chart ────────────────────────────────────────────────

#[spacetimedb::table(name = player, public)]
#[derive(Clone)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub handle: String,
    pub faction: Planet,
    pub deck_seed: u64,
    pub created_at: Timestamp,
    pub last_active: Timestamp,
}

#[spacetimedb::table(name = natal_chart)] // private to owner (not public)
#[derive(Clone)]
pub struct NatalChart {
    #[primary_key]
    pub identity: Identity,
    pub birth_unix: i64,    // resolved birth instant (UTC seconds)
    pub birth_lat: f64,
    pub birth_lon: f64,
    pub time_known: bool,   // false => solar chart, noon default
    pub placements: Vec<Placement>,
    pub ascendant: u16,     // absolute zodiac arc-minutes (0..21599)
    pub midheaven: u16,
}

// ── Cards & inventory ─────────────────────────────────────────────────────

#[spacetimedb::table(name = card, public)]
#[derive(Clone)]
pub struct Card {
    #[primary_key]
    #[auto_inc]
    pub card_id: u64,
    pub owner: Identity, // add `#[index(btree)]` for scale; we iterate for now
    pub name: String,    // e.g. "Knight of Wands", or the hero's Major Arcana
    pub suit: Suit,
    pub rank: u8,        // 1..14 (Ace..King)
    pub health: u16,
    pub attack: u16,
    pub armour: u16,
    pub cooldown_ms: u16,
    pub source_body: Planet, // which placement minted it
    pub inverted: bool,      // from a retrograde body
    pub is_trump: bool,      // the single Major-Arcana hero
    pub level: u8,           // veterancy — survivors level up (GDD §06)
    pub xp: u32,             // progress toward the next level
}

#[spacetimedb::table(name = deck_slot, public)]
#[derive(Clone)]
pub struct DeckSlot {
    #[primary_key]
    #[auto_inc]
    pub slot_id: u64,
    pub owner: Identity,
    pub card_id: u64,
    pub loadout: Loadout,
}

// ── Global map state ──────────────────────────────────────────────────────

#[spacetimedb::table(name = zone, public)]
#[derive(Clone)]
pub struct Zone {
    #[primary_key]
    pub zone_id: u8,          // 0..10 (0-4 house, 5-9 spire, 10 crown)
    pub kind: ZoneKind,
    pub owner: Option<Planet>, // None = neutral
    pub control: i32,          // -1000..+1000 tug-of-war meter
    pub updated_at: Timestamp,
}

#[spacetimedb::table(name = star_node, public)]
#[derive(Clone)]
pub struct StarNode {
    #[primary_key]
    pub hip_id: u32,          // Hipparcos catalogue id
    pub name: String,
    pub ra: f64,              // equatorial — projected client-side
    pub dec: f64,
    pub magnitude: f32,       // -> node weight (brighter = worth more)
    pub held_by: Option<Planet>,
    pub region_hint: u8,      // cached current zone at the last server tick
}

/// Real-time ephemeris — one row per body, fed by `push_ephemeris`.
#[spacetimedb::table(name = ephemeris, public)]
#[derive(Clone)]
pub struct Ephemeris {
    #[primary_key]
    pub body: Planet,
    pub ra: f64,
    pub dec: f64,
    pub transiting_zone: u8,  // drives the transit capture buff
    pub tick: Timestamp,
}

// ── Coordination ──────────────────────────────────────────────────────────

/// Singleton (id = 0). Captures the module owner for authz + the season marker.
#[spacetimedb::table(name = game_config, public)]
#[derive(Clone)]
pub struct GameConfig {
    #[primary_key]
    pub id: u8,
    pub owner: Identity,
    pub season_degree: u16,   // the Great Wheel ingress marker, 0..359
    pub seeded: bool,
    pub collection_cap: u32,  // Sky-Drop collection ceiling (GDD §04)
    pub tick_count: u64,      // monotonic sky-tick counter (drives expiries)
}

/// Per-zone "death charge" feeding Pluto's attrition doctrine (GDD §03/§07).
/// Every battle that destroys cards drops a stack here; stacks expire by tick.
#[spacetimedb::table(name = attrition, public)]
#[derive(Clone)]
pub struct Attrition {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    pub zone_id: u8,
    pub amount: u32,       // cards destroyed in the feeding battle
    pub expires_tick: u64, // purged once tick_count reaches this
}

/// Live-PvP matchmaking intents, drained by `enqueue_duel`.
#[spacetimedb::table(name = duel_queue, public)]
#[derive(Clone)]
pub struct DuelQueue {
    #[primary_key]
    #[auto_inc]
    pub ticket_id: u64,
    pub zone_id: u8,
    pub seeker: Identity,
    pub enqueued_at: Timestamp,
}

/// A live 3-lane duel between two players contesting a zone.
#[spacetimedb::table(name = duel, public)]
#[derive(Clone)]
pub struct Duel {
    #[primary_key]
    #[auto_inc]
    pub duel_id: u64,
    pub zone_id: u8,
    pub player_a: Identity,
    pub player_b: Identity,
    pub faction_a: Planet,
    pub faction_b: Planet,
    pub a_cards: Vec<u64>, // 3 entries, one card per lane (0 = unset)
    pub b_cards: Vec<u64>,
    pub a_committed: bool,
    pub b_committed: bool,
    pub state: DuelState,
    pub lanes_a: u8,
    pub lanes_b: u8,
    pub winner: Option<Identity>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

// ── Scheduled tick ────────────────────────────────────────────────────────

/// Schedule table: SpacetimeDB calls `tick_sky` per row at the cadence below.
#[spacetimedb::table(name = sky_tick_timer, scheduled(tick_sky))]
#[derive(Clone)]
pub struct SkyTickTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}
