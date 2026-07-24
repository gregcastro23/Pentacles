//! The database schema. Public tables stream to every client as the live map;
//! `natal_chart` is private to its owner. Clients never write — only reducers do.

use crate::types::*;
use spacetimedb::{Identity, ScheduleAt, Timestamp};
use crate::reducers::{tick_sky, resolve_round};

// ── Identity & natal chart ────────────────────────────────────────────────

#[spacetimedb::table(accessor = player, public)]
#[derive(Clone)]
pub struct Player {
    #[primary_key]
    pub identity: Identity,
    pub handle: String,
    pub faction: Planet,
    pub deck_seed: u64,
    pub created_at: Timestamp,
    pub last_active: Timestamp,
    /// Tokens won in Word Duels of the Spheres (the Lettered-Arcana reward currency).
    #[default(0u64)]
    pub tokens: u64,
    /// Word duels won (vs a planetary agent) — the ladder.
    #[default(0u32)]
    pub word_wins: u32,
    #[default(None::<String>)]
    pub evm_address: Option<String>,
    #[default(None::<String>)]
    pub solana_pubkey: Option<String>,
}

/// An EVM binding whose holder signed a short-lived EIP-712 proof containing
/// this SpacetimeDB identity. Only the owner-authenticated verifier can write it.
#[spacetimedb::table(accessor = verified_evm_wallet, public)]
#[derive(Clone)]
pub struct VerifiedEvmWallet {
    #[primary_key]
    pub identity: Identity,
    #[unique]
    pub evm_address: String,
    pub proof_hash: String,
    pub verified_at: Timestamp,
}

/// A Solana binding whose holder signed a short-lived proof containing this
/// SpacetimeDB identity. Only the owner-authenticated verifier can write it.
#[spacetimedb::table(accessor = verified_solana_wallet, public)]
#[derive(Clone)]
pub struct VerifiedSolanaWallet {
    #[primary_key]
    pub identity: Identity,
    #[unique]
    pub solana_pubkey: String,
    pub proof_hash: String,
    pub verified_at: Timestamp,
}

#[spacetimedb::table(accessor = natal_chart)] // private to owner (not public)
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

/// PUBLIC chart projection for NPC "historical agent" players only. `natal_chart`
/// is private (per-owner RLS), so a seeded agent's chart would otherwise be
/// invisible to everyone; this mirrors it (plus a denormalized `handle`) for
/// agents that opt in via `seed_agent_player`. Real players are never written
/// here — their chart stays private. Same shape as NatalChart.
#[spacetimedb::table(accessor = agent_chart, public)]
#[derive(Clone)]
pub struct AgentChart {
    #[primary_key]
    pub identity: Identity,
    pub handle: String,       // denormalized display name (the figure)
    pub birth_unix: i64,
    pub birth_lat: f64,
    pub birth_lon: f64,
    pub time_known: bool,
    pub placements: Vec<Placement>,
    pub ascendant: u16,
    pub midheaven: u16,
    #[default(None::<Vec<u16>>)]
    pub house_cusps: Option<Vec<u16>>,
    #[default(HouseSystem::WholeSign)]
    pub house_system: HouseSystem,
    #[default(None::<Vec<u8>>)]
    pub intercepted_signs: Option<Vec<u8>>,
}

/// A player's 36-decan natal attribution — one row per placement, the raw
/// Golden Dawn Minor-Arcana card for each body by degree. PUBLIC and queryable
/// id-for-id, so any alchm surface (agents site, constellation LP) can read a
/// player's decan cards without touching the private `natal_chart`.
///
/// Distinct from the game `Card` deck: `mint_deck` elevates the chart ruler to
/// an Ace and angular / sign-ruling bodies to courts; this table is the plain
/// astrological truth (always a 2..10 pip). Mirrors the client `decanCard()` in
/// src/alchm-chart/decans.js, which mirrors `pip_rank`/`decan` in chart.rs.
#[spacetimedb::table(accessor = natal_decan, public)]
#[derive(Clone)]
pub struct NatalDecan {
    #[primary_key]
    #[auto_inc]
    pub decan_id: u64,
    #[index(btree)]
    pub owner: Identity,      // indexed: per-player lookups are O(player's placements)
    pub body: Planet,         // the placement this decan card belongs to
    pub sign: u8,             // 0..11 (Aries..Pisces)
    pub decan: u8,            // 0..2 within the sign (0–9° · 10–19° · 20–29°)
    pub abs_decan: u8,        // 0..35 across the wheel (sign*3 + decan) — title key
    pub suit: Suit,           // the sign's triplicity
    pub rank: u8,             // 2..10 — the Minor pip
    pub decan_ruler: Planet,  // Chaldean "face" ruler of the decan
    pub retrograde: bool,     // mirrors the placement
}

#[spacetimedb::table(accessor = player_location)] // private to owner (not public)
#[derive(Clone)]
pub struct PlayerLocation {
    #[primary_key]
    pub identity: Identity,
    pub lat: f64,           // east-positive, like the charts
    pub lon: f64,
    pub updated_at: Timestamp,
}

// ── Cards & inventory ─────────────────────────────────────────────────────

#[spacetimedb::table(accessor = card, public)]
#[derive(Clone)]
pub struct Card {
    #[primary_key]
    #[auto_inc]
    pub card_id: u64,
    #[index(btree)]
    pub owner: Identity, // indexed: per-player lookups are O(player's cards), not O(all cards)
    pub suit: Suit,
    pub rank: u8,        // Minor: 1..14 (Ace..King); Major: the arcana index 0..21
    pub health: u16,
    pub attack: u16,
    pub armour: u16,
    pub cooldown_ms: u16,
    pub source_body: Planet, // which placement minted it
    pub inverted: bool,      // from a retrograde body
    pub is_major: bool,      // a planetary Major Arcana (rank = arcana index)
    pub level: u8,            // combine level; 1 = freshly minted (gentle-plateau bonus)
    pub minted_at: Timestamp, // the sky-moment this card came into being
    /// The card's Scrabble letter (ASCII 'A'..'Z'), drawn from the 98-tile bag by id.
    /// Your collection's letters are your rack in Word Duels. 0 = unlettered (legacy
    /// rows minted before the Lettered Arcana; they simply contribute no tiles).
    #[default(0u8)]
    pub letter: u8,
}

#[spacetimedb::table(accessor = deck_slot, public)]
#[derive(Clone)]
pub struct DeckSlot {
    #[primary_key]
    #[auto_inc]
    pub slot_id: u64,
    #[index(btree)]
    pub owner: Identity,
    #[index(btree)]
    pub card_id: u64,
    #[index(btree)]
    pub loadout: Loadout, // indexed: sentinel sweeps touch only Defense slots, not every slot
}

/// A two-sided card trade: both parties stake card_ids and must confirm before
/// ownership swaps. Public so both clients can watch it resolve.
#[spacetimedb::table(accessor = trade, public)]
#[derive(Clone)]
pub struct Trade {
    #[primary_key]
    #[auto_inc]
    pub trade_id: u64,
    #[index(btree)]
    pub proposer: Identity,
    #[index(btree)]
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

#[spacetimedb::table(accessor = zone, public)]
#[derive(Clone)]
pub struct Zone {
    #[primary_key]
    pub zone_id: u8,          // 0..10 (0-4 house, 5-9 spire, 10 crown)
    pub kind: ZoneKind,
    pub owner: Option<Planet>, // None = neutral
    pub control: i32,          // -1000..+1000 tug-of-war meter
    pub updated_at: Timestamp,
}

#[spacetimedb::table(accessor = star_node, public)]
#[derive(Clone)]
pub struct StarNode {
    #[primary_key]
    pub hip_id: u32,          // Hipparcos catalogue id
    pub name: String,
    pub ra: f64,              // equatorial — projected client-side
    pub dec: f64,
    pub magnitude: f32,       // -> node weight (brighter = worth more)
    pub constellation: String, // e.g. "Orion", "Canis Major"
    pub zodiac_sign: String,   // e.g. "Gemini", "Aries"
    pub ecliptic_deg: u8,      // 0..29°
    pub ecliptic_min: u8,      // 0..59'
    pub ecliptic_sec: u8,      // 0..59"
    pub refracted_alt: f32,    // live apparent altitude on horizon
    pub azimuth: f32,          // live azimuth heading (0..360°)
    pub horizon_state: String, // ON_HORIZON_BAND | ABOVE_HORIZON | BELOW_HORIZON
    pub held_by: Option<Planet>,
    pub region_hint: u8,      // cached current zone at the last server tick
}

/// Real-time ephemeris — one row per body, fed by `push_ephemeris`.
#[spacetimedb::table(accessor = ephemeris, public)]
#[derive(Clone)]
pub struct Ephemeris {
    #[primary_key]
    pub body: Planet,
    pub ra: f64,
    pub dec: f64,
    pub transiting_zone: u8,  // drives the transit capture buff
    pub tick: Timestamp,
    /// moving retrograde in the live sky → inverts a drafted card
    #[default(false)]
    pub retrograde: bool,
}

// ── Coordination ──────────────────────────────────────────────────────────

#[spacetimedb::table(accessor = battle, public)]
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
#[spacetimedb::table(accessor = game_config, public)]
#[derive(Clone)]
pub struct GameConfig {
    #[primary_key]
    pub id: u8,
    pub owner: Identity,
    pub season_degree: u16,   // the Great Wheel ingress marker, 0..359
    pub ascendant_degree: u16, // live world ascendant clock, 0..359
    pub seeded: bool,
    /// How far into `catalog::STARS` seeding has progressed. `init` seeds the
    /// brightest batch; `tick_sky` backfills the rest of the naked-eye sky in
    /// gentle batches (and an already-published module catches up the same way
    /// after an upgrade — `#[default]` keeps the publish non-destructive).
    #[default(0u32)]
    pub star_seed_cursor: u32,
    /// Whether the constellation-pool catalogue has been seeded. `init` seeds it;
    /// `tick_sky` backfills after an upgrade. `#[default]` keeps publishes non-destructive.
    #[default(false)]
    pub constellations_seeded: bool,
}

/// Live-PvP matchmaking intents, drained by `enqueue_duel`.
#[spacetimedb::table(accessor = duel_queue, public)]
#[derive(Clone)]
pub struct DuelQueue {
    #[primary_key]
    #[auto_inc]
    pub ticket_id: u64,
    #[index(btree)]
    pub zone_id: u8, // indexed: matchmaking probes only this zone's tickets
    pub seeker: Identity,
    pub enqueued_at: Timestamp,
}

/// A live 3-lane duel between two players contesting a zone.
#[spacetimedb::table(accessor = duel, public)]
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
#[spacetimedb::table(accessor = oracle_request, public)]
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
#[spacetimedb::table(accessor = oracle_reply, public)]
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
#[spacetimedb::table(accessor = oracle_cache, public)]
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
#[spacetimedb::table(accessor = oracle_rate)]
#[derive(Clone)]
pub struct OracleRate {
    #[primary_key]
    pub identity: Identity,
    pub last_at: Timestamp,
    pub count: u32,
}

// ── Word Duels of the Spheres (the Lettered Arcana) ─────────────────────────

/// A completed word duel: the player's Word of Power vs a planetary agent's best
/// word, the token reward, and the verdict. Public so clients can show the result
/// and a token/word-win ladder.
#[spacetimedb::table(accessor = word_duel, public)]
#[derive(Clone)]
pub struct WordDuel {
    #[primary_key]
    #[auto_inc]
    pub duel_id: u64,
    #[index(btree)]
    pub player: Identity,
    pub opponent: Planet,     // the planetary agent the player challenged
    pub player_word: String,
    pub player_score: u32,
    pub agent_word: String,   // the agent's best word (empty if its rack made none)
    pub agent_score: u32,
    pub won: bool,            // player_score >= agent_score
    pub tokens_awarded: u64,
    pub created_at: Timestamp,
    #[default(None::<String>)]
    pub agent_rationale: Option<String>, // characterful explanation
}

/// Per-player word-duel rate state, backing the duel cooldown (private). Stops token
/// farming by re-casting the same word in a tight loop.
#[spacetimedb::table(accessor = word_rate)]
#[derive(Clone)]
pub struct WordRate {
    #[primary_key]
    pub identity: Identity,
    pub last_at: Timestamp,
    pub plays: u32,
}

#[spacetimedb::table(accessor = duel_challenge, public)]
#[derive(Clone)]
pub struct DuelChallenge {
    #[primary_key]
    #[auto_inc]
    pub challenge_id: u64,
    #[index(btree)]
    pub player: Identity,
    pub opponent: Planet,
    pub player_word: String,
    pub player_score: u32,
    pub agent_rack: String,  // e.g. "AEIONRS"
    pub candidates: String,  // JSON string array of valid words
    pub answered: bool,
    pub created_at: Timestamp,
}

// ── The Ascendant clock (per-round re-draft) ────────────────────────────────

/// Per-player round bookkeeping for the Ascendant clock: which round we're on, plus
/// the live battle tally that decides this round's success (won ≥1 battle → a draft).
/// Public so a client can show the round counter and react to a fresh draft.
#[spacetimedb::table(accessor = round_state, public)]
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
#[spacetimedb::table(accessor = round_timer, scheduled(resolve_round))]
#[derive(Clone)]
pub struct RoundTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    #[index(btree)]
    pub player: Identity, // indexed: re-register clears one player's clocks, not a full scan
    pub scheduled_at: ScheduleAt,
}

// ── Scheduled tick ────────────────────────────────────────────────────────

/// Schedule table: SpacetimeDB calls `tick_sky` per row at the cadence below.
#[spacetimedb::table(accessor = sky_tick_timer, scheduled(tick_sky))]
#[derive(Clone)]
pub struct SkyTickTimer {
    #[primary_key]
    #[auto_inc]
    pub scheduled_id: u64,
    pub scheduled_at: ScheduleAt,
}

// ── Constellation liquidity pools (the Web3 sky DEX) ────────────────────────
//
// Each real constellation is a constant-product AMM pool over a *pair* of ESMS
// elements (0=Spirit,1=Essence,2=Matter,3=Substance). The pair, fee and member
// set are frozen properties baked at generation time (see constellations.rs);
// only *visibility* changes minute to minute. A pool may be traced/seeded/swapped
// only while ≥ `visible_threshold` of its stars are above the trader's horizon —
// the same hard horizon gate `resolve_star_battle` uses for star strikes.

/// A constellation pool's frozen metadata, seeded from `constellations::CONSTELLATIONS`.
#[spacetimedb::table(accessor = constellation, public)]
#[derive(Clone)]
pub struct Constellation {
    #[primary_key]
    pub constellation_id: u16,
    pub abbr: String,            // IAU 3-letter (e.g. "Ori")
    pub name: String,            // display name (e.g. "Orion")
    pub elem_a: u8,              // ESMS id of the pool's first token
    pub elem_b: u8,              // ESMS id of the pool's second token
    pub degenerate: bool,        // true => single-element figure paired with its opposite
    pub fee_bps: u16,            // swap fee tier (brighter/bigger figures trade cheaper)
    pub member_count: u16,
    pub visible_threshold: u16,  // min member stars above MIN_ALT to trade the pool
}

/// One member star of a constellation figure (indexed for per-figure visibility sweeps).
#[spacetimedb::table(accessor = constellation_star, public)]
#[derive(Clone)]
pub struct ConstellationStar {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub constellation_id: u16,
    pub hip_id: u32,
}

/// One stick-figure line segment of a constellation (a HIP-id pair), for the
/// client to draw and the data model to expose.
#[spacetimedb::table(accessor = constellation_line, public)]
#[derive(Clone)]
pub struct ConstellationLine {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub constellation_id: u16,
    pub hip_a: u32,
    pub hip_b: u32,
}

/// A trader's request to trace a constellation right now. The reducer
/// `trace_constellation` only inserts this once it has authoritatively confirmed
/// the figure is risen over the trader's location. The attestor service watches
/// for `attested == false` rows, re-verifies, signs the EIP-712 attestation, and
/// writes a `trace_attestation`. Public so the trader's client sees the result.
#[spacetimedb::table(accessor = trace_intent, public)]
#[derive(Clone)]
pub struct TraceIntent {
    #[primary_key]
    #[auto_inc]
    pub intent_id: u64,
    #[index(btree)]
    pub trader: Identity,     // the SpacetimeDB player who traced
    pub evm_address: String,  // their EVM wallet (0x-hex) — the on-chain attestation subject
    pub constellation_id: u16,
    pub visible_stars: u16,   // member stars above the horizon at request time
    pub attested: bool,       // flipped true once the attestor has signed
    pub created_at: Timestamp,
}

/// The signed EIP-712 VisibilityAttestation the client submits with `seedLiquidity`/
/// `swap`. Written by the attestor service (owner-gated `answer_trace`). All fields
/// mirror the on-chain struct exactly; `region_commit` and `signature` are 0x-hex.
#[spacetimedb::table(accessor = trace_attestation, public)]
#[derive(Clone)]
pub struct TraceAttestation {
    #[primary_key]
    pub intent_id: u64,       // 1:1 with the trace_intent it answers
    #[index(btree)]
    pub trader: Identity,
    pub constellation_id: u16,
    pub region_commit: String, // 0x-hex bytes32: keccak(latBucket,lonBucket,salt)
    pub visible_stars: u8,
    pub nonce: u64,            // must equal the AMM's usedNonce[trader] at submit
    pub deadline: u64,         // unix seconds; the AMM rejects after this
    pub signature: String,     // 0x-hex 65-byte ECDSA sig over the typed struct
    pub created_at: Timestamp,
}

// ── Constellation resolution: "mint blocks by adding stars" ─────────────────
// A constellation's resolution rises as members are added at runtime via
// `add_star_to_constellation`. Each added star mints a ConstellationBlock — the
// authoritative trophy of raising a figure's resolution (optionally stamped with
// the on-chain ConstellationDeed block when the richer pool is later seeded).

/// Per-constellation runtime resolution state (one row per figure).
#[spacetimedb::table(accessor = constellation_resolution, public)]
#[derive(Clone)]
pub struct ConstellationResolution {
    #[primary_key]
    pub constellation_id: u16,
    pub baseline_members: u16,  // member_count at seed time
    pub added_members: u16,     // stars added at runtime
    pub resolution_level: u16,  // = added_members / STARS_PER_BLOCK
    pub updated_at: Timestamp,
}

/// One minted block: a star added to a figure, raising its resolution. Append-only.
#[spacetimedb::table(accessor = constellation_block, public)]
#[derive(Clone)]
pub struct ConstellationBlock {
    #[primary_key]
    #[auto_inc]
    pub block_id: u64,
    #[index(btree)]
    pub constellation_id: u16,
    pub minter: Identity,
    pub hip_id: u32,            // the star that was added
    pub level_after: u16,
    #[default(None::<u64>)]
    pub onchain_block: Option<u64>, // ConstellationDeed.mintedAtBlock, if seeded on-chain
    pub created_at: Timestamp,
}

// ── Star agents: bright catalogue stars promoted to interactive agents ───────

/// A bright catalogue star promoted to an agent (chat + jings), keyed by the same
/// hip_id as its StarNode — no new identity space, no Planet-enum growth.
#[spacetimedb::table(accessor = star_agent, public)]
#[derive(Clone)]
pub struct StarAgent {
    #[primary_key]
    pub hip_id: u32,           // 1:1 with star_node
    pub display_name: String,  // "Sirius", "Vega", "Polaris" …
    pub element: u8,           // dominant ESMS id 0..3
    pub composition: Vec<u16>, // [fire,water,earth,air] % for the Jing ≥30 gate
    pub specialty: String,     // flavour for the chat voice
    pub active: bool,
}

// ── Comets: a category of their own (NOT planets) ───────────────────────────
// Chiron is classified as both a minor planet AND a comet (95P/Chiron), so it
// joins as the game's first comet — its own kind, kept out of the ten-faction
// `Planet` enum (which is a primary-key type; growing it would force a
// destructive migration). New rows = new comets; the client reads the osculating
// elements to place each comet on the ecliptic.
#[spacetimedb::table(accessor = comet, public)]
#[derive(Clone)]
pub struct Comet {
    #[primary_key]
    pub comet_id: u16,         // 0 = Chiron
    pub name: String,
    pub designation: String,   // e.g. "2060 Chiron · 95P/Chiron"
    pub element: u8,           // dominant ESMS id 0..3
    pub composition: Vec<u16>, // [fire,water,earth,air] % for the Jing ≥30 gate
    pub specialty: String,
    // Osculating Keplerian elements (epoch ~J2000) — the authoritative orbit.
    pub semi_major_au: f64,
    pub eccentricity: f64,
    pub inclination_deg: f64,
    pub mean_long_deg: f64,    // L at epoch
    pub long_peri_deg: f64,    // ϖ
    pub long_node_deg: f64,    // Ω
    pub mean_long_rate: f64,   // deg per Julian century (the fast element)
    pub active: bool,
}

// ── The Jing Arena (cast → counter → resolve) ───────────────────────────────

/// A standalone Jing duel thread. Public so both sides watch it resolve. Exactly
/// one of `target_player` / `target_agent` is set (agent duels are answered by the
/// owner-gated `answer_jing`, mirroring answer_oracle/answer_trace).
#[spacetimedb::table(accessor = jing_duel, public)]
#[derive(Clone)]
pub struct JingDuel {
    #[primary_key]
    #[auto_inc]
    pub duel_id: u64,
    #[index(btree)]
    pub initiator: Identity,
    pub target_player: Option<Identity>,
    pub target_agent: Option<Planet>,
    pub opening_move: JingMove,
    pub state: JingState,
    #[default(None::<bool>)]
    pub winner_is_initiator: Option<bool>, // None until resolved (or a draw)
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}

/// One cast in a duel thread (cast or counter). Append-only; pruned by `prune_stale`
/// alongside its parent `jing_duel` when the duel ages out.
#[spacetimedb::table(accessor = jing_cast, public)]
#[derive(Clone)]
pub struct JingCast {
    #[primary_key]
    #[auto_inc]
    pub cast_id: u64,
    #[index(btree)]
    pub duel_id: u64,
    pub caster: Identity,          // ZERO identity = the agent (via answer_jing)
    pub caster_agent: Option<Planet>,
    pub mv: JingMove,
    pub cost_sacred7: u8,          // Sacred-7 stat index drained
    pub cost_esms: u8,            // ESMS id drained
    pub deflects: Option<JingMove>, // what this cast counters in the thread
    pub voice: String,            // characterful line (agent casts)
    pub created_at: Timestamp,
}

/// The player's Sacred-7 + ESMS consciousness pools a Jing cast drains
/// (game-side, mirrored — ESMS on-chain is soulbound and never burned here).
/// Public so the agent page can surface the authoritative pool when live.
#[spacetimedb::table(accessor = jing_pool, public)]
#[derive(Clone)]
pub struct JingPool {
    #[primary_key]
    pub identity: Identity,
    pub sacred7: Vec<u16>,        // 7 stats
    pub esms: Vec<u16>,          // 4 element pools
    pub updated_at: Timestamp,
}

/// Per-player Jing cast cooldown (private). Stops spam-draining.
#[spacetimedb::table(accessor = jing_rate)]
#[derive(Clone)]
pub struct JingRate {
    #[primary_key]
    pub identity: Identity,
    pub last_at: Timestamp,
    pub casts: u32,
}

// ── Star Staking & Yield Accrual (EIP-712 Arc gateway integration) ───────────

/// One staker's position on one star. Mirrors the on-chain StarVault stake.
#[spacetimedb::table(accessor = star_stake, public)]
#[derive(Clone)]
pub struct StarStake {
    #[primary_key]
    #[auto_inc]
    pub stake_id: u64,
    #[index(btree)]
    pub staker: Identity,
    #[index(btree)]
    pub star_id: u32,            // Hipparcos hip_id (FK → star_node)
    pub element: u8,             // 0..3, the star's ESMS id (frozen at stake time)
    pub principal_usdc: u64,     // 6-dp USDC mirrored from the on-chain stake
    pub shares: u128,            // pool shares (pro-rata)
    pub accrued_essence: u128,   // 18-dp ESMS accrued and not yet claimed
    pub claimed_essence: u128,   // 18-dp ESMS already settled on-chain
    #[default(0u128)]
    pub pending_essence: u128,   // 18-dp ESMS locked in a two-phase yield claim
    #[default(0u64)]
    pub claim_nonce: u64,        // Unique claim nonce assigned during request_yield_claim
    pub staked_at: Timestamp,
    pub last_accrual_at: Timestamp,
}

/// Per-star aggregate (shared pool).
#[spacetimedb::table(accessor = star_stake_pool, public)]
#[derive(Clone)]
pub struct StarStakePool {
    #[primary_key]
    pub star_id: u32,
    pub total_principal_usdc: u64,
    pub total_shares: u128,
}

// ── Round Tracking & Yield Distribution ──────────────────────────────────────

/// Tracker for duel rounds.
#[spacetimedb::table(accessor = duel_round, public)]
#[derive(Clone)]
pub struct DuelRound {
    #[primary_key]
    pub round_id: u64,
    pub plays_count: u32,
    pub target_plays: u32,
    pub created_at: Timestamp,
}

/// Contributions within the current active round.
#[spacetimedb::table(accessor = round_participant, public)]
#[derive(Clone)]
pub struct RoundParticipant {
    #[primary_key]
    #[auto_inc]
    pub id: u64,
    #[index(btree)]
    pub round_id: u64, // indexed: round settlement reads only its own round's plays
    pub identity: Identity,
    pub element: u8,             // 0..3 (Spirit, Essence, Matter, Substance)
    pub weight: u32,             // Word score or Jing weight
}

// ── Service health (the Observatory's cross-service heartbeat) ──────────────

/// One heartbeat row per companion service, upserted by the owner-gated
/// `report_service_health` (the `answer_oracle` trusted-bridge pattern). The
/// table stays a handful of rows — one per service, updated in place — so it
/// never grows and needs no pruning. Note a dead service can't report its own
/// death: it simply stops upserting, and the client flags the row STALE by
/// `updated_at` age — staleness IS the signal.
#[spacetimedb::table(accessor = service_status, public)]
#[derive(Clone)]
pub struct ServiceStatus {
    #[primary_key]
    pub service: String,      // e.g. "planetary-agents", "wten", "feeders"
    pub healthy: bool,
    pub detail: String,       // short human text, e.g. "db connected" or "HTTP 503"
    pub latency_ms: u32,      // probe round-trip; 0 for self-reports
    pub updated_at: Timestamp,
}


// ── Identity linking (Google sign-in claim flow) ─────────────────────────────

/// A short-lived, single-use grant that lets a signed-in (OIDC) identity claim
/// the profile of the anonymous identity that opened it. The client generates a
/// random one-time code, calls `open_identity_link(sha256(code))` while still
/// connected with the OLD anonymous token, then reconnects with the OIDC token
/// and calls `claim_profile(code)`. Private: only the module reads codes. One
/// grant per old identity; grants are deleted on claim and pruned on expiry.
#[spacetimedb::table(accessor = claim_grant)]
#[derive(Clone)]
pub struct ClaimGrant {
    #[primary_key]
    pub code_hash: String, // lowercase hex sha256 of the client's one-time code
    #[index(btree)]
    pub old_identity: Identity,
    pub created_at: Timestamp,
    pub expires_at: Timestamp,
}

// ── RPC Log Idempotency ───────────────────────────────────────────────────────

/// Prevents double-processing of on-chain event logs (replays).
#[spacetimedb::table(accessor = processed_tx, public)]
#[derive(Clone)]
pub struct ProcessedTx {
    #[primary_key]
    pub tx_hash: String,        // 0x-hex EVM tx hash or base58 Solana signature
    pub chain: String,          // "evm_base_sepolia" | "solana_token_2022"
    pub event_type: String,     // "mint" | "burn" | "stake"
    pub processed_at: Timestamp,
}

/// A claimed source-chain burn waiting for the feeder/attestor to verify it and
/// mint the equivalent ESMS on the destination chain.
#[spacetimedb::table(accessor = bridge_transfer, public)]
#[derive(Clone)]
pub struct BridgeTransfer {
    #[primary_key]
    pub burn_tx_hash: String,
    #[index(btree)]
    pub player: Identity,
    pub source_chain: BridgeChain,
    pub target_chain: BridgeChain,
    pub source_address: String,
    pub target_address: String,
    pub element_id: u8,
    pub amount: u128,
    pub status: BridgeStatus,
    #[default(None::<String>)]
    pub destination_tx_hash: Option<String>,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
}
