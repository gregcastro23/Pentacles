//! The database schema. Public tables stream to every client as the live map;
//! `natal_chart` is private to its owner. Clients never write — only reducers do.

use crate::types::*;
use spacetimedb::{Identity, ScheduleAt, Timestamp};
use crate::reducers::{tick_sky, resolve_round};

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
    /// Twelve house cusps in absolute arc-minutes (0..21599); cusp[0]=Asc,
    /// cusp[9]=MC. Derived server-side in `create_player` (authoritative), so the
    /// client may submit it empty — it is always recomputed before persistence.
    #[default(None::<Vec<u16>>)]
    pub house_cusps: Option<Vec<u16>>,
    /// The system `house_cusps` was built under (Placidus, or a Whole-Sign fallback).
    #[default(HouseSystem::WholeSign)]
    pub house_system: HouseSystem,
    /// Signs containing no cusp (Placidus interceptions). Always empty for a
    /// Whole-Sign or time-unknown chart — interception is never claimed without
    /// a trustworthy birth time.
    #[default(None::<Vec<u8>>)]
    pub intercepted_signs: Option<Vec<u8>>,
}

#[spacetimedb::table(name = player_location)] // private to owner (not public)
#[derive(Clone)]
pub struct PlayerLocation {
    #[primary_key]
    pub identity: Identity,
    pub lat: f64,           // east-positive, like the charts
    pub lon: f64,
    pub updated_at: Timestamp,
}

// ── Cards & inventory ─────────────────────────────────────────────────────

#[spacetimedb::table(name = card, public)]
#[derive(Clone)]
pub struct Card {
    #[primary_key]
    #[auto_inc]
    pub card_id: u64,
    pub owner: Identity, // add `#[index(btree)]` for scale; we iterate for now
    pub suit: Suit,
    pub rank: u8,        // Minor: 1..14 (Ace..King); trump: the arcana index 0..21
    pub health: u16,
    pub attack: u16,
    pub armour: u16,
    pub cooldown_ms: u16,
    pub source_body: Planet, // which placement minted it
    pub inverted: bool,      // from a retrograde body
    pub is_trump: bool,      // a planetary Major-Arcana trump (rank = arcana index)
    pub level: u8,            // combine level; 1 = freshly minted (gentle-plateau bonus)
    pub minted_at: Timestamp, // the sky-moment this card came into being
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

/// A two-sided card trade: both parties stake card_ids and must confirm before
/// ownership swaps. Public so both clients can watch it resolve.
#[spacetimedb::table(name = trade, public)]
#[derive(Clone)]
pub struct Trade {
    #[primary_key]
    #[auto_inc]
    pub trade_id: u64,
    pub proposer: Identity,
    pub partner: Identity,
    pub offer: Vec<u64>,      // proposer's staked card_ids
    pub request: Vec<u64>,    // partner's staked card_ids
    pub proposer_ok: bool,
    pub partner_ok: bool,
    pub state: TradeState,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
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
    pub retrograde: bool,     // moving retrograde in the live sky → inverts a drafted card
    pub tick: Timestamp,
}

// ── Coordination ──────────────────────────────────────────────────────────

#[spacetimedb::table(name = battle, public)]
#[derive(Clone)]
pub struct Battle {
    #[primary_key]
    #[auto_inc]
    pub battle_id: u64,
    pub star_id: u32,
    pub attacker: Identity,
    pub won: bool,
    pub attacker_score: u32,
    pub defense_rating: u32,
    pub created_at: Timestamp,
}

/// Singleton (id = 0). Captures the module owner for authz + the season marker.
#[spacetimedb::table(name = game_config, public)]
#[derive(Clone)]
pub struct GameConfig {
    #[primary_key]
    pub id: u8,
    pub owner: Identity,
    pub season_degree: u16,   // the Great Wheel ingress marker, 0..359
    pub ascendant_degree: u16, // live world ascendant clock, 0..359
    pub seeded: bool,
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

// ── Oracle (Claude companion) ───────────────────────────────────────────────

/// A player's question for the Oracle. The companion service watches these,
/// asks Claude, and answers via `answer_oracle`. Public so the asker's client
/// sees the reply. `context` is a derived chart/state summary — never birth data.
#[spacetimedb::table(name = oracle_request, public)]
#[derive(Clone)]
pub struct OracleRequest {
    #[primary_key]
    #[auto_inc]
    pub request_id: u64,
    pub asker: Identity,
    pub question: String,
    pub context: String,   // derived summary the client attaches; no private birth data
    pub cacheable: bool,   // rules/lore (cacheable) vs live strategy (not)
    pub qhash: u64,        // normalized-question hash, for the answer cache
    pub answered: bool,
    pub created_at: Timestamp,
}

/// The Oracle's answer to a request (1:1 by request_id).
#[spacetimedb::table(name = oracle_reply, public)]
#[derive(Clone)]
pub struct OracleReply {
    #[primary_key]
    pub request_id: u64,
    pub asker: Identity,
    pub text: String,
    pub model: String,     // which tier answered: "haiku", "sonnet", or "cache"
    pub created_at: Timestamp,
}

/// Cache of generic Q&A (rules/lore), keyed by normalized-question hash, so a
/// repeated question is answered instantly without troubling Claude.
#[spacetimedb::table(name = oracle_cache, public)]
#[derive(Clone)]
pub struct OracleCache {
    #[primary_key]
    pub qhash: u64,
    pub question: String,
    pub text: String,
    pub model: String,
    pub created_at: Timestamp,
}

/// Per-player Oracle rate state, backing the ask cooldown (private).
#[spacetimedb::table(name = oracle_rate)]
#[derive(Clone)]
pub struct OracleRate {
    #[primary_key]
    pub identity: Identity,
    pub last_at: Timestamp,
    pub count: u32,
}

// ── The Ascendant clock (per-round re-draft) ────────────────────────────────

/// Per-player round bookkeeping for the Ascendant clock: which round we're on, plus
/// the live battle tally that decides this round's success (won ≥1 battle → a draft).
/// Public so a client can show the round counter and react to a fresh draft.
#[spacetimedb::table(name = round_state, public)]
#[derive(Clone)]
pub struct RoundState {
    #[primary_key]
    pub identity: Identity,
    pub round_index: u64,        // monotonically increasing; seeds the deterministic draft
    pub wins: u32,               // battles won since the last resolution
    pub fights: u32,             // battles fought since the last resolution
    pub last_resolved_at: Timestamp,
}

/// Per-player Ascendant clock: one self-re-arming row per player, fired by
/// `resolve_round` at an interval that lengthens as the deck grows past 25 cards.
/// One-shot `Time` schedules let each fire recompute the next interval from deck size.
#[spacetimedb::table(name = round_timer, scheduled(resolve_round))]
#[derive(Clone)]
pub struct RoundTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub player: Identity,
    pub scheduled_at: ScheduleAt,
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
