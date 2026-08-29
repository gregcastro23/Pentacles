//! Reducers — the only writers. Clients call these; they validate and mutate
//! transactionally, so the map is cheat-resistant by construction.

use crate::tables::*;
use crate::types::*;
use crate::{catalog, chart, combat, melee, words};
use spacetimedb::{reducer, Identity, ReducerContext, ScheduleAt, Table, Timestamp};
use std::time::Duration;

const FLIP_THRESHOLD: i32 = 600;
/// Cards a player may field in direct attacks and live-duel lanes.
const ACTIVE_LIMIT: usize = 8;
/// Cards a faction may contribute to held-star sentinels.
const DEFENSE_LIMIT: usize = 8;
/// A card stops gaining from combines past this level — the bonus is already near
/// its +50% ceiling, so further copies would barely move it.
const MAX_CARD_LEVEL: u8 = 6;
/// Minimum seconds between a player's Oracle questions (gentle anti-spam / cost guard).
const ORACLE_COOLDOWN_SECS: i64 = 4;
/// A live duel stalls if an opponent never commits. After this grace window the
/// committed side may `claim_duel_timeout`, and the `tick_sky` sweep auto-resolves
/// it regardless so the board never holds a zombie duel.
const DUEL_GRACE_SECS: i64 = 120;
/// Zone swing granted to a player who wins a duel by their opponent's forfeit
/// (a flat walkover — less than a fought best-of-3, which adds a lane bonus).
const DUEL_WALKOVER: i32 = 150;
/// A deliberately-played card pushes a zone's control by its combat strength /
/// DEPLOY_DIV, capped at DEPLOY_CAP. The cap sits above the automated war
/// heartbeat (WAR_PUSH_CAP=140) so a human play can out-muscle the bots, but
/// below FLIP_THRESHOLD=600 so one card can never vault a rival zone to a full hold.
const DEPLOY_DIV: f32 = 3.0;
const DEPLOY_CAP: i32 = 180;
/// The world's canonical horizon — the shared "field of play". The sign rising
/// here sets the elemental weather for every battle, sweeping the zodiac in real
/// time so round length varies by how fast a sign rises here. (New York City.)
const REF_LAT_DEG: f64 = 40.7128;
const REF_LON_DEG: f64 = -74.0060; // east-longitude negative
const OBLIQUITY_DEG: f64 = 23.439291; // mean obliquity, matches SkyMath.Obliquity

// ── The Ascendant clock (per-round re-draft) ────────────────────────────────
/// A player's whole card collection is capped here. A draft past the cap replaces
/// only the weakest *bench* card, and only if it's stronger (Active/Sentinel/Major
/// are never culled). Also the ceiling on a single offline catch-up's mints.
const COLLECTION_CAP: usize = 100;
/// Round clock: a base round is ~15 arc-min of Ascendant ≈ 1 min real. It lengthens
/// in 25-card bands as the deck grows past 25 — the Ascendant "slows" the more you
/// carry (26–50 → +30s, 51–75 → +60s, …).
const ROUND_BASE_SECS: i64 = 60;
const ROUND_BAND_SECS: i64 = 30;
const ROUND_BAND_SIZE: usize = 25;
/// A single resolution pass never settles (and so never mints) more than one
/// collection's worth of rounds — offline catch-up tops the deck up, never floods it.
const MAX_CATCHUP_ROUNDS: u64 = COLLECTION_CAP as u64;
/// Retention windows for the append-only tables the janitor prunes (see `prune_stale`).
/// SpacetimeDB bills on live state size and every public row streams to clients, so
/// transient history is bounded: a week of battle logs, a day of answered Oracle Q&A.
/// `oracle_cache` is never pruned — it's the asset we want to keep.
const BATTLE_TTL_SECS: i64 = 7 * 24 * 3600;
const ORACLE_TTL_SECS: i64 = 24 * 3600;
/// A question/challenge the companion service never answered still ages out — after
/// a full day the asker has long moved on, and the row is pure dead weight.
const UNANSWERED_TTL_SECS: i64 = 24 * 3600;
/// A month of word-duel history — the ladder is on the player row, the rows are flavor.
const WORD_DUEL_TTL_SECS: i64 = 30 * 24 * 3600;
/// Jing duels (and their casts) after a month: resolved threads are done telling
/// their story, and an open thread nobody has touched in 30 days is abandoned.
const JING_DUEL_TTL_SECS: i64 = 30 * 24 * 3600;
/// Resolved 3-lane duels after a week (they resolve in minutes; the sweep and the
/// walkover path guarantee nothing stays Active past the grace window).
const DUEL_TTL_SECS: i64 = 7 * 24 * 3600;
/// Settled (Committed/Cancelled) trades after a week; an Open trade neither side
/// has touched in a month is abandoned and released too.
const TRADE_TTL_SECS: i64 = 7 * 24 * 3600;
const TRADE_OPEN_TTL_SECS: i64 = 30 * 24 * 3600;
/// Trace intents and their attestations after a week — the on-chain `deadline` is
/// unix-seconds scale, so a week-old attestation is unusable anyway.
const TRACE_TTL_SECS: i64 = 7 * 24 * 3600;
/// A matchmaking ticket nobody ever paired with — the seeker is gone after a day.
const DUEL_TICKET_TTL_SECS: i64 = 24 * 3600;
/// Word Duels of the Spheres: pace duels and size the (massive) token reward.
const WORD_DUEL_COOLDOWN_SECS: i64 = 20;
const TOKEN_PER_POINT: u64 = 50; // word_score × this is the base token reward
const BEAT_AGENT_BONUS: u64 = 500; // matching/beating the planetary agent's best word
const AGENT_RACK_SIZE: usize = 7; // tiles the agent draws — a standard Scrabble rack
/// Star-catalogue seeding: `init` plants the brightest stars immediately so the
/// sky is never empty, then `tick_sky` backfills the rest of the naked-eye
/// catalogue (all ~5k stars to magnitude 6.0) a batch per tick. At 10s/tick the
/// whole sky is in within ~3 minutes of first publish or upgrade.
const INIT_SEED_STARS: usize = 512;
const SEED_BATCH_PER_TICK: usize = 512;

// ── Lifecycle ─────────────────────────────────────────────────────────────

/// Runs once on first publish (and after a clear). `ctx.sender()` is the owner.
#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    if ctx.db.game_config().id().find(&0).is_none() {
        ctx.db.game_config().insert(GameConfig {
            id: 0,
            owner: ctx.sender(),
            season_degree: 0,
            ascendant_degree: 0,
            seeded: false,
            star_seed_cursor: 0,
            constellations_seeded: false,
        });
    }

    // Seed the eleven zones: 0-4 houses, 5-9 spires, 10 crown.
    for z in 0u8..11 {
        if ctx.db.zone().zone_id().find(&z).is_none() {
            let kind = if z < 5 {
                ZoneKind::House
            } else if z < 10 {
                ZoneKind::Spire
            } else {
                ZoneKind::Crown
            };
            ctx.db.zone().insert(Zone {
                zone_id: z,
                kind,
                owner: None,
                control: 0,
                updated_at: ctx.timestamp,
                in_flux: false,
                flux_level: 0,
                flux_constellation: None,
                flux_triggered_by: None,
                flux_expires_at: None,
            });
        }
    }

    // Plant the brightest stars immediately so the sky is never empty;
    // tick_sky backfills the rest of the naked-eye catalogue batch by batch.
    let cursor = seed_star_batch(ctx, 0, INIT_SEED_STARS);

    // Seed the constellation liquidity pools (small, fixed set — all at once).
    seed_constellations(ctx);

    // Seed the bright star-agent roster (chat + jings targets).
    seed_star_agents(ctx);

    // Seed the comet registry (Chiron — the first comet).
    seed_comets(ctx);

    // Seed initial Volumetric Deep Space Anomaly Caches across Cosmic Layers 1..4
    if ctx.db.deep_space_cache().iter().count() == 0 {
        ctx.db.deep_space_cache().insert(DeepSpaceCache {
            cache_id: 0,
            center_x: 10.5,
            center_y: 4.2,
            center_z: 12.8,
            esms_yield: 2500,
            encryption_status: 100,
            active_seekers: 0,
            created_at: ctx.timestamp,
        });
        ctx.db.deep_space_cache().insert(DeepSpaceCache {
            cache_id: 0,
            center_x: 145.0,
            center_y: -89.4,
            center_z: 310.2,
            esms_yield: 5000,
            encryption_status: 100,
            active_seekers: 0,
            created_at: ctx.timestamp,
        });
        ctx.db.deep_space_cache().insert(DeepSpaceCache {
            cache_id: 0,
            center_x: 2450.0,
            center_y: 1200.0,
            center_z: 4800.0,
            esms_yield: 12000,
            encryption_status: 100,
            active_seekers: 0,
            created_at: ctx.timestamp,
        });
        ctx.db.deep_space_cache().insert(DeepSpaceCache {
            cache_id: 0,
            center_x: 58000.0,
            center_y: -14000.0,
            center_z: 105000.0,
            esms_yield: 25000,
            encryption_status: 100,
            active_seekers: 0,
            created_at: ctx.timestamp,
        });
    }


    // Drive the persistent sky: tick every 10 seconds.
    ctx.db.sky_tick_timer().insert(SkyTickTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(Duration::from_secs(10).into()),
    });

    if let Some(mut cfg) = ctx.db.game_config().id().find(&0) {
        cfg.seeded = true;
        cfg.star_seed_cursor = cursor;
        cfg.constellations_seeded = true;
        ctx.db.game_config().id().update(cfg);
    }
    log::info!("Pentacles module initialised");
}

// ── Onboarding ────────────────────────────────────────────────────────────

/// Commit the chart, validate the chosen faction, mint the deck, join the war.
#[reducer]
pub fn create_player(
    ctx: &ReducerContext,
    handle: String,
    chart: NatalChart,
    faction: Planet,
) -> Result<(), String> {
    // A real player owns their identity (the caller) and runs the live round clock.
    // Their chart stays private (agent_public = false).
    register_chart(ctx, ctx.sender(), handle, chart, faction, true, false)
}

/// Admin-only: seed an NPC "historical agent" as a player under a DETERMINISTIC
/// identity derived from `agent_key` (so the same agent always maps to the same
/// row and re-seeding is idempotent). Runs the same path as `create_player`
/// minus the live round clock — agents are chart/deck/decan showcases and
/// defenders, not active round-runners. Gated on the deployer (`GameConfig.owner`).
#[reducer]
pub fn seed_agent_player(
    ctx: &ReducerContext,
    agent_key: String,
    handle: String,
    chart: NatalChart,
    faction: Planet,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("seed_agent_player: admin only".into());
    }
    // Stable, valid identity from claims (issuer, subject) — the same scheme
    // SpacetimeDB uses to mint identities from OIDC tokens.
    let owner = Identity::from_claims("pentacles:agent", &agent_key);
    // NPC agents skip the live round clock but publish their chart (agent_public).
    register_chart(ctx, owner, handle, chart, faction, false, true)
}

/// Shared onboarding: validate faction, persist the chart (houses derived
/// authoritatively), re-mint deck + decans, upsert the player. `schedule_rounds`
/// arms the live Ascendant clock (real players) or leaves it off (NPC agents).
fn register_chart(
    ctx: &ReducerContext,
    owner: Identity,
    handle: String,
    chart: NatalChart,
    faction: Planet,
    schedule_rounds: bool,
    agent_public: bool,
) -> Result<(), String> {
    // The chosen faction must be one of the chart's top-3 dignity scores.
    let scores = chart::faction_scores(&chart);
    let mut ranked: Vec<(usize, f32)> = scores.iter().copied().enumerate().collect();
    ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let top3: Vec<usize> = ranked.iter().take(3).map(|(i, _)| *i).collect();
    if !top3.contains(&faction.idx()) {
        return Err("faction not in your chart's top-3 dignities".into());
    }

    // Server owns identity — never trust a client-supplied one. House cusps,
    // system and interceptions are derived authoritatively here (Placidus, or a
    // Whole-Sign fallback), overwriting whatever the client previewed.
    let mut chart = NatalChart { identity: owner, ..chart };
    chart::populate_houses(&mut chart);
    if ctx.db.natal_chart().identity().find(&owner).is_some() {
        ctx.db.natal_chart().identity().update(chart.clone());
    } else {
        ctx.db.natal_chart().insert(chart.clone());
    }

    // NPC agents also publish a PUBLIC copy (natal_chart is private). Real players
    // never land here, so their chart stays private.
    if agent_public {
        let ac = AgentChart {
            identity: owner,
            handle: handle.clone(),
            birth_unix: chart.birth_unix,
            birth_lat: chart.birth_lat,
            birth_lon: chart.birth_lon,
            time_known: chart.time_known,
            placements: chart.placements.clone(),
            ascendant: chart.ascendant,
            midheaven: chart.midheaven,
            house_cusps: chart.house_cusps.clone(),
            house_system: chart.house_system,
            intercepted_signs: chart.intercepted_signs.clone(),
        };
        if ctx.db.agent_chart().identity().find(&owner).is_some() {
            ctx.db.agent_chart().identity().update(ac);
        } else {
            ctx.db.agent_chart().insert(ac);
        }
    }

    // Re-registering re-mints the deck from scratch — clear any prior cards and
    // slots first so we never stack duplicates.
    let old_cards: Vec<u64> = ctx.db.card().owner().filter(&owner).map(|c| c.card_id).collect();
    for cid in old_cards {
        ctx.db.card().card_id().delete(&cid);
    }
    let old_slots: Vec<u64> = ctx.db.deck_slot().owner().filter(&owner).map(|s| s.slot_id).collect();
    for sid in old_slots {
        ctx.db.deck_slot().slot_id().delete(&sid);
    }

    let asc_sign = ((chart.ascendant / 1800) % 12) as u8;
    let chart_ruler = chart::sign_ruler(asc_sign);
    let (deck_seed, _n) = chart::mint_deck(ctx, owner, &chart, chart_ruler);

    // Also persist the plain 36-decan natal attribution (public, queryable
    // id-for-id) — distinct from the game deck minted above.
    let _decans = chart::mint_decans(ctx, owner, &chart);

    // Re-registration re-mints the deck but must never wipe the token wallet / ladder / wallet bindings.
    let (tokens, word_wins, evm_address, solana_pubkey) = ctx
        .db
        .player()
        .identity()
        .find(&owner)
        .map(|p| (p.tokens, p.word_wins, p.evm_address, p.solana_pubkey))
        .unwrap_or((0, 0, None, None));
    let player = Player {
        identity: owner,
        handle,
        faction,
        deck_seed,
        created_at: ctx.timestamp,
        last_active: ctx.timestamp,
        tokens,
        word_wins,
        evm_address,
        solana_pubkey,
    };
    if ctx.db.player().identity().find(&owner).is_some() {
        ctx.db.player().identity().update(player);
    } else {
        ctx.db.player().insert(player);
    }

    if schedule_rounds {
        // Start (or restart) the player's Ascendant clock: reset the round tally and
        // arm exactly one round timer at the deck's current interval. The re-draft
        // reads the live sky through these freshly-stamped houses each round
        // (`chart::blended_faction_vector` over `live_transits`) — dignity-weighting
        // stays in scoring/minting, never combat (GDD §02).
        clear_round_timers(ctx, owner);
        let rstate = RoundState {
            identity: owner,
            round_index: 0,
            wins: 0,
            fights: 0,
            last_resolved_at: ctx.timestamp,
        };
        if ctx.db.round_state().identity().find(&owner).is_some() {
            ctx.db.round_state().identity().update(rstate);
        } else {
            ctx.db.round_state().insert(rstate);
        }
        schedule_next_round(ctx, owner);
    }
    Ok(())
}

/// Admin-only one-shot: populate `natal_decan` for every existing player from
/// their stored chart. Needed right after first deploying the `natal_decan`
/// table, since `mint_decans` otherwise runs only at registration — existing
/// players would have no rows. Idempotent: `mint_decans` clears each owner's
/// rows first, so this is safe to re-run. Gated on the deployer identity
/// (`GameConfig.owner`, stamped at `init`).
#[reducer]
pub fn backfill_decans(ctx: &ReducerContext) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("backfill_decans: admin only".into());
    }
    let charts: Vec<NatalChart> = ctx.db.natal_chart().iter().collect();
    let (mut players, mut rows) = (0usize, 0usize);
    for chart in charts {
        rows += chart::mint_decans(ctx, chart.identity, &chart);
        players += 1;
    }
    log::info!("backfill_decans: {players} players, {rows} decan rows");
    Ok(())
}

/// Admin-only: remove NPC "historical agent" players that are NOT in the supplied
/// canonical key list — used to clear stale agents left behind when an agent's
/// `agent_key` changes (the deterministic identity changes with it, so the old
/// row is orphaned). Only rows with an `agent_chart` (i.e. seeded agents) are ever
/// touched; real human players are never affected. Gated on `GameConfig.owner`.
#[reducer]
pub fn purge_stale_agents(ctx: &ReducerContext, keep_keys: Vec<String>) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("purge_stale_agents: admin only".into());
    }
    let keep: std::collections::HashSet<Identity> = keep_keys
        .iter()
        .map(|k| Identity::from_claims("pentacles:agent", k))
        .collect();
    // Agents are exactly the identities carrying an agent_chart row.
    let stale: Vec<Identity> = ctx
        .db
        .agent_chart()
        .iter()
        .map(|a| a.identity)
        .filter(|id| !keep.contains(id))
        .collect();
    let purged = stale.len();
    for id in stale {
        purge_player_fully(ctx, id);
    }
    log::info!("purge_stale_agents: removed {purged} stale agents");
    Ok(())
}

/// Delete every row an agent/player owns across the schema (cards, slots, decans,
/// charts, round state/timers, location, the player row itself).
fn purge_player_fully(ctx: &ReducerContext, id: Identity) {
    let cards: Vec<u64> = ctx.db.card().owner().filter(&id).map(|c| c.card_id).collect();
    for c in cards { ctx.db.card().card_id().delete(&c); }
    let slots: Vec<u64> = ctx.db.deck_slot().owner().filter(&id).map(|s| s.slot_id).collect();
    for s in slots { ctx.db.deck_slot().slot_id().delete(&s); }
    let decans: Vec<u64> = ctx.db.natal_decan().owner().filter(&id).map(|d| d.decan_id).collect();
    for d in decans { ctx.db.natal_decan().decan_id().delete(&d); }
    if ctx.db.agent_chart().identity().find(&id).is_some() { ctx.db.agent_chart().identity().delete(&id); }
    if ctx.db.natal_chart().identity().find(&id).is_some() { ctx.db.natal_chart().identity().delete(&id); }
    if ctx.db.round_state().identity().find(&id).is_some() { ctx.db.round_state().identity().delete(&id); }
    if ctx.db.player().identity().find(&id).is_some() { ctx.db.player().identity().delete(&id); }
    clear_round_timers(ctx, id);
}

/// GDPR Art. 17 — Right to be Forgotten / Right to Erasure reducer.
/// Deletes private NatalChart, removes verified EVM/Solana wallets, and resets
/// the Player handle to anonymized-seeker-<identity> while clearing linked wallets.
#[reducer]
pub fn delete_player_data(ctx: &ReducerContext) -> Result<(), String> {
    let sender = ctx.sender();
    if let Some(mut player) = ctx.db.player().identity().find(&sender) {
        player.handle = format!("anonymized-seeker-{}", sender);
        player.evm_address = None;
        player.solana_pubkey = None;
        ctx.db.player().identity().update(player);
    }
    if ctx.db.natal_chart().identity().find(&sender).is_some() {
        ctx.db.natal_chart().identity().delete(&sender);
    }
    if ctx.db.verified_evm_wallet().identity().find(&sender).is_some() {
        ctx.db.verified_evm_wallet().identity().delete(&sender);
    }
    if ctx.db.verified_solana_wallet().identity().find(&sender).is_some() {
        ctx.db.verified_solana_wallet().identity().delete(&sender);
    }
    Ok(())
}

/// Record the caller's real-world location (private). The horizon it anchors
/// gates which stars they can engage. East-positive longitude, like the charts.
/// Minors (under 18) have exact GPS lat/lon coarsened for privacy (NY Child Data Protection Act).
#[reducer]
pub fn set_location(ctx: &ReducerContext, lat: f64, lon: f64) -> Result<(), String> {
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return Err("lat/lon out of range".into());
    }

    let now_sec = (ctx.timestamp.to_micros_since_unix_epoch() / 1_000_000) as i64;
    let (final_lat, final_lon) = if let Some(chart) = ctx.db.natal_chart().identity().find(&ctx.sender()) {
        if chart::is_minor(chart.birth_unix, now_sec) {
            ((lat * 10.0).round() / 10.0, (lon * 10.0).round() / 10.0)
        } else {
            (lat, lon)
        }
    } else {
        (lat, lon)
    };

    let row = PlayerLocation {
        identity: ctx.sender(),
        lat: final_lat,
        lon: final_lon,
        updated_at: ctx.timestamp,
    };
    if ctx
        .db
        .player_location()
        .identity()
        .find(&ctx.sender())
        .is_some()
    {
        ctx.db.player_location().identity().update(row);
    } else {
        ctx.db.player_location().insert(row);
    }
    Ok(())
}

/// Change a card's loadout (Active, Defense, Bench) with limit validation.
#[reducer]
pub fn set_loadout(ctx: &ReducerContext, card_id: u64, loadout: Loadout) -> Result<(), String> {
    let mut slot = ctx
        .db
        .deck_slot()
        .card_id()
        .filter(&card_id)
        .find(|s| s.owner == ctx.sender())
        .ok_or_else(|| "card slot not found or not owned by you".to_string())?;

    if slot.loadout == loadout {
        return Ok(());
    }

    match loadout {
        Loadout::Active => {
            let active_count = ctx
                .db
                .deck_slot()
                .owner()
                .filter(&ctx.sender())
                .filter(|s| s.loadout == Loadout::Active)
                .count();
            if active_count >= ACTIVE_LIMIT {
                return Err(format!("cannot have more than {ACTIVE_LIMIT} active cards"));
            }
        }
        Loadout::Defense => {
            let defense_count = ctx
                .db
                .deck_slot()
                .owner()
                .filter(&ctx.sender())
                .filter(|s| s.loadout == Loadout::Defense)
                .count();
            if defense_count >= DEFENSE_LIMIT {
                return Err(format!(
                    "cannot have more than {DEFENSE_LIMIT} defense sentinel cards"
                ));
            }
        }
        Loadout::Bench => {}
    }

    slot.loadout = loadout;
    ctx.db.deck_slot().slot_id().update(slot);
    Ok(())
}

/// Play a tarot card from your Active hand onto a zone of the sky — the card
/// function the faction war was missing. It does two things through the SAME
/// systems every battle uses:
///   • OFFENSE — your faction's control on that zone rises by the card's combat
///     strength (level/element/seal-scaled), eroding and flipping a rival
///     incumbent via `apply_control` (the sole control writer).
///   • DEFENSE — the card converts into your faction's Defense sentinel pool,
///     where `sentinel_for` garrisons your held stars against rival raids.
/// The card isn't spent — it leaves your attacking hand for the garrison (the
/// offense/defense tradeoff) and can be recalled later via `set_loadout`.
#[reducer]
pub fn deploy_card(ctx: &ReducerContext, card_id: u64, zone_id: u8) -> Result<(), String> {
    if zone_id > 10 {
        return Err("no such zone".into()); // apply_control silently no-ops on a bad id
    }
    let mut player = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "register a Seeker first".to_string())?;

    let card = ctx
        .db
        .card()
        .card_id()
        .find(&card_id)
        .ok_or_else(|| "no such card".to_string())?;
    if card.owner != ctx.sender() {
        return Err("that card is not yours".into());
    }
    if !has_loadout(ctx, ctx.sender(), card_id, Loadout::Active) {
        return Err("only an Active card can be deployed".into());
    }
    if !can_access_zone(ctx, player.faction, zone_id) {
        return Err("that zone is not yet reachable — hold its approaches first".into());
    }

    // Defensive half: move the card into the faction's Defense sentinel pool,
    // honoring DEFENSE_LIMIT (mirrors set_loadout's cap).
    let mut slot = ctx
        .db
        .deck_slot()
        .card_id()
        .filter(&card_id)
        .find(|s| s.owner == ctx.sender())
        .ok_or_else(|| "card slot not found".to_string())?;
    let defense_count = ctx
        .db
        .deck_slot()
        .owner()
        .filter(&ctx.sender())
        .filter(|s| s.loadout == Loadout::Defense)
        .count();
    if defense_count >= DEFENSE_LIMIT {
        return Err(format!(
            "your garrison is full ({DEFENSE_LIMIT}) — recall a sentinel before deploying"
        ));
    }
    slot.loadout = Loadout::Defense;
    ctx.db.deck_slot().slot_id().update(slot);

    // Offense half: push your faction's control on the zone, scaled by the card's
    // real strength under the zone's favored element and your faction's seals.
    let stat = stat_of(&card);
    let favored = zone_favored_suit(ctx, zone_id);
    let seals = sealed_suits(ctx, player.faction);
    let raw = combat::card_strength(&stat)
        * combat::element_weather(stat.suit, favored)
        * combat::seal_mult(stat.suit, &seals);
    let delta = ((raw / DEPLOY_DIV) as i32).clamp(0, DEPLOY_CAP);
    apply_control(ctx, zone_id, player.faction, delta);

    player.last_active = ctx.timestamp;
    ctx.db.player().identity().update(player);
    Ok(())
}

// ── Collection: combine & trade ─────────────────────────────────────────────

/// A card's combat snapshot, scaled by its combine level.
fn stat_of(c: &Card) -> combat::CardStat {
    let m = combat::level_mult(c.level);
    combat::CardStat {
        suit: c.suit,
        attack: (c.attack as f32 * m) as u16,
        health: (c.health as f32 * m) as u16,
        armour: (c.armour as f32 * m) as u16,
    }
}

/// Fuse two copies of the same card (same suit, rank, and Major/Minor tier). The kept
/// card levels up — keeping its own minted identity — and the consumed copy is
/// spent. Gains follow a gentle plateau, so combining has diminishing returns.
#[reducer]
pub fn combine_cards(ctx: &ReducerContext, keep_id: u64, consume_id: u64) -> Result<(), String> {
    if keep_id == consume_id {
        return Err("pick two different cards".into());
    }
    let mut keep = ctx
        .db
        .card()
        .card_id()
        .find(&keep_id)
        .ok_or("no such card")?;
    let consume = ctx
        .db
        .card()
        .card_id()
        .find(&consume_id)
        .ok_or("no such card")?;
    if keep.owner != ctx.sender() || consume.owner != ctx.sender() {
        return Err("you can only combine your own cards".into());
    }
    if keep.suit != consume.suit || keep.rank != consume.rank || keep.is_major != consume.is_major {
        return Err("those aren't the same card".into());
    }
    if keep.level >= MAX_CARD_LEVEL {
        return Err("this card is already at its peak".into());
    }
    keep.level += 1;
    ctx.db.card().card_id().update(keep);
    // Spend the consumed copy and free its deck slot.
    ctx.db.card().card_id().delete(&consume_id);
    let dead: Vec<u64> = ctx
        .db
        .deck_slot()
        .card_id()
        .filter(&consume_id)
        .map(|s| s.slot_id)
        .collect();
    for sid in dead {
        ctx.db.deck_slot().slot_id().delete(&sid);
    }
    Ok(())
}

/// Open a two-sided trade: stake your `offer` and name the `request` you want from
/// `partner`. Proposing is your confirmation; the partner confirms to commit.
#[reducer]
pub fn propose_trade(
    ctx: &ReducerContext,
    partner: Identity,
    offer: Vec<u64>,
    request: Vec<u64>,
) -> Result<(), String> {
    if partner == ctx.sender() {
        return Err("you can't trade with yourself".into());
    }
    if offer.is_empty() && request.is_empty() {
        return Err("a trade needs at least one card".into());
    }
    if has_duplicates(&offer) || has_duplicates(&request) {
        return Err("a trade can't stake the same card twice".into());
    }
    for cid in &offer {
        let c = ctx
            .db
            .card()
            .card_id()
            .find(cid)
            .ok_or("you offered a card that doesn't exist")?;
        if c.owner != ctx.sender() {
            return Err("you can only offer your own cards".into());
        }
    }
    for cid in &request {
        let c = ctx
            .db
            .card()
            .card_id()
            .find(cid)
            .ok_or("you asked for a card that doesn't exist")?;
        if c.owner != partner {
            return Err("the partner doesn't own a card you asked for".into());
        }
    }
    ctx.db.trade().insert(Trade {
        trade_id: 0,
        proposer: ctx.sender(),
        partner,
        offer,
        request,
        proposer_ok: true,
        partner_ok: false,
        state: TradeState::Open,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    Ok(())
}

/// Confirm an open trade. The proposer already confirmed by proposing; once the
/// partner confirms, ownership swaps (re-validated first) and the trade commits.
#[reducer]
pub fn confirm_trade(ctx: &ReducerContext, trade_id: u64) -> Result<(), String> {
    let mut t = ctx
        .db
        .trade()
        .trade_id()
        .find(&trade_id)
        .ok_or("no such trade")?;
    if t.state != TradeState::Open {
        return Err("this trade is already closed".into());
    }
    if ctx.sender() == t.proposer {
        t.proposer_ok = true;
    } else if ctx.sender() == t.partner {
        t.partner_ok = true;
    } else {
        return Err("this trade isn't yours".into());
    }
    t.updated_at = ctx.timestamp;

    if t.proposer_ok && t.partner_ok {
        // Re-check ownership at the moment of commit — a staked card may have moved.
        for cid in &t.offer {
            let c = ctx
                .db
                .card()
                .card_id()
                .find(cid)
                .ok_or("an offered card has gone")?;
            if c.owner != t.proposer {
                return Err("the proposer no longer holds a staked card".into());
            }
        }
        for cid in &t.request {
            let c = ctx
                .db
                .card()
                .card_id()
                .find(cid)
                .ok_or("a requested card has gone")?;
            if c.owner != t.partner {
                return Err("the partner no longer holds a staked card".into());
            }
        }
        reassign(ctx, &t.offer, t.partner);
        reassign(ctx, &t.request, t.proposer);
        t.state = TradeState::Committed;
    }
    ctx.db.trade().trade_id().update(t);
    Ok(())
}

/// Either party may call off an open trade.
#[reducer]
pub fn cancel_trade(ctx: &ReducerContext, trade_id: u64) -> Result<(), String> {
    let mut t = ctx
        .db
        .trade()
        .trade_id()
        .find(&trade_id)
        .ok_or("no such trade")?;
    if ctx.sender() != t.proposer && ctx.sender() != t.partner {
        return Err("this trade isn't yours".into());
    }
    if t.state == TradeState::Open {
        t.state = TradeState::Cancelled;
        t.updated_at = ctx.timestamp;
        ctx.db.trade().trade_id().update(t);
    }
    Ok(())
}

/// Move a set of cards to a new owner, clearing their old deck slots and landing
/// each on the recipient's Bench.
fn reassign(ctx: &ReducerContext, cards: &[u64], to: Identity) {
    for &cid in cards {
        if let Some(mut c) = ctx.db.card().card_id().find(&cid) {
            c.owner = to;
            ctx.db.card().card_id().update(c);
        }
        let dead: Vec<u64> = ctx
            .db
            .deck_slot()
            .card_id()
            .filter(&cid)
            .map(|s| s.slot_id)
            .collect();
        for sid in dead {
            ctx.db.deck_slot().slot_id().delete(&sid);
        }
        ctx.db.deck_slot().insert(DeckSlot {
            slot_id: 0,
            owner: to,
            card_id: cid,
            loadout: Loadout::Bench,
        });
    }
}

// ── Combat ────────────────────────────────────────────────────────────────

/// Re-simulate a star duel from the log + both decks; on a win, flip the star
/// and move its zone's control meter.
#[reducer]
pub fn resolve_star_battle(
    ctx: &ReducerContext,
    hip_id: u32,
    log: BattleLog,
) -> Result<(), String> {
    let player = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "register first".to_string())?;
    let mut star = ctx
        .db
        .star_node()
        .hip_id()
        .find(&hip_id)
        .ok_or_else(|| "no such star".to_string())?;

    // Hard horizon gate (GPS engagement): you can only strike a star currently
    // risen over where you stand. Anchored to the location you reported.
    let loc = ctx
        .db
        .player_location()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "set your location first (set_location)".to_string())?;
    let alt = altitude_deg(star.ra, star.dec, loc.lat, loc.lon, ctx.timestamp);
    if alt < MIN_ALT_DEG {
        return Err(format!(
            "{} is below your horizon ({alt:.0}°) — face a star that has risen",
            star.name
        ));
    }

    if !can_access_zone(ctx, player.faction, star.region_hint) {
        return Err("Zone is locked. Faction must control adjacent zones first!".into());
    }

    if log.model != CombatModel::AutoSiege {
        return Err("star strikes use Auto-Siege; use the Duel button for live Lane Skirmish".into());
    }

    // Gather the attacker's played cards (validate ownership).
    let mut attacker: Vec<combat::CardStat> = Vec::new();
    if has_duplicates(&log.plays) {
        return Err("a card can only be played once in a strike".into());
    }
    for cid in &log.plays {
        let c = ctx
            .db
            .card()
            .card_id()
            .find(cid)
            .ok_or_else(|| "card not found".to_string())?;
        if c.owner != ctx.sender() {
            return Err("you can only strike with your own cards".into());
        }
        if !has_loadout(ctx, ctx.sender(), *cid, Loadout::Active) {
            return Err("only Active cards can strike; move the card into Active first".into());
        }
        attacker.push(stat_of(&c));
    }
    if attacker.is_empty() {
        return Err("no valid cards played".into());
    }

    let mut defender = match star.held_by {
        Some(holder) => sentinel_for(ctx, holder),
        None => neutral_garrison(&star),
    };

    // Apply faction doctrines (passives)
    apply_passives(ctx, &mut attacker, player.faction, true, star.region_hint);
    if let Some(holder) = star.held_by {
        apply_passives(ctx, &mut defender, holder, false, star.region_hint);
    }

    // Apply planet transit buffs (+30% stats)
    let transit_atk = ctx
        .db
        .ephemeris()
        .body()
        .find(&player.faction)
        .map(|e| e.transiting_zone == star.region_hint)
        .unwrap_or(false);
    if transit_atk {
        for c in attacker.iter_mut() {
            c.attack = (c.attack as f32 * 1.30) as u16;
            c.health = (c.health as f32 * 1.30) as u16;
        }
    }
    if let Some(holder) = star.held_by {
        let transit_def = ctx
            .db
            .ephemeris()
            .body()
            .find(&holder)
            .map(|e| e.transiting_zone == star.region_hint)
            .unwrap_or(false);
        if transit_def {
            for c in defender.iter_mut() {
                c.attack = (c.attack as f32 * 1.30) as u16;
                c.health = (c.health as f32 * 1.30) as u16;
            }
        }
    }

    let favored = zone_favored_suit(ctx, star.region_hint);
    let attacker_seals = sealed_suits(ctx, player.faction);
    let defender_seals = star
        .held_by
        .map(|f| sealed_suits(ctx, f))
        .unwrap_or_default();
    let (won, margin) = combat::resolve_star(
        &attacker,
        &defender,
        favored,
        &attacker_seals,
        &defender_seals,
    );

    // Calculate final scores for logging
    let ap = combat::side_power(&attacker, favored, &attacker_seals);
    let dp = combat::side_power(&defender, favored, &defender_seals);
    if won {
        let prev = star.held_by;
        star.held_by = Some(player.faction);
        ctx.db.star_node().hip_id().update(star.clone());
        // Ingress double-control buff: active ingress zone corresponds to (season_degree / 30) % 12
        let cfg = ctx
            .db
            .game_config()
            .id()
            .find(&0)
            .ok_or("game_config missing")?;
        let ingress_zone = ((cfg.season_degree / 30) % 12) as u8 % 11;
        let delta = if star.region_hint == ingress_zone {
            combat::control_delta(star.magnitude, margin) * 2
        } else {
            combat::control_delta(star.magnitude, margin)
        };

        apply_control(ctx, star.region_hint, player.faction, delta);
        let _ = prev;
    }

    // Cards are no longer minted on capture; a won fight feeds this round's success
    // tally, and the Ascendant clock drafts the reward at round end.
    tally_fight(ctx, ctx.sender(), won);

    // Log the battle outcome for the client UI
    ctx.db.battle().insert(Battle {
        battle_id: 0,
        star_id: hip_id,
        attacker: ctx.sender(),
        won,
        attacker_score: ap as u32,
        defense_rating: dp as u32,
        created_at: ctx.timestamp,
    });

    let mut player = player;
    player.last_active = ctx.timestamp;
    ctx.db.player().identity().update(player);
    Ok(())
}

/// Single-card drag-and-drop instant star raid strike. Every single tarot card in
/// the player's active hand can be dropped directly onto a star to chip away at
/// its control threshold, scaling in efficiency based on suit weather alignment,
/// star magnitude resistance, and card level/stats.
#[reducer]
pub fn strike_star_single(
    ctx: &ReducerContext,
    hip_id: u32,
    card_id: u64,
) -> Result<(), String> {
    let player = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "register first".to_string())?;
    let mut star = ctx
        .db
        .star_node()
        .hip_id()
        .find(&hip_id)
        .ok_or_else(|| "no such star".to_string())?;

    let loc = ctx
        .db
        .player_location()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "set your location first (set_location)".to_string())?;
    let alt = altitude_deg(star.ra, star.dec, loc.lat, loc.lon, ctx.timestamp);
    if alt < MIN_ALT_DEG {
        return Err(format!(
            "{} is below your horizon ({alt:.0}°) — face a star that has risen",
            star.name
        ));
    }

    if !can_access_zone(ctx, player.faction, star.region_hint) {
        return Err("Zone is locked. Faction must control adjacent zones first!".into());
    }

    let card = ctx
        .db
        .card()
        .card_id()
        .find(&card_id)
        .ok_or_else(|| "card not found".to_string())?;
    if card.owner != ctx.sender() {
        return Err("you can only strike with your own cards".into());
    }
    if !has_loadout(ctx, ctx.sender(), card_id, Loadout::Active) {
        return Err("only Active cards can strike; move the card into Active first".into());
    }

    let mut attacker = vec![stat_of(&card)];
    let mut defender = match star.held_by {
        Some(holder) => sentinel_for(ctx, holder),
        None => neutral_garrison(&star),
    };

    apply_passives(ctx, &mut attacker, player.faction, true, star.region_hint);
    if let Some(holder) = star.held_by {
        apply_passives(ctx, &mut defender, holder, false, star.region_hint);
    }

    let favored = zone_favored_suit(ctx, star.region_hint);
    let attacker_seals = sealed_suits(ctx, player.faction);
    let defender_seals = star
        .held_by
        .map(|f| sealed_suits(ctx, f))
        .unwrap_or_default();

    let (won, margin) = combat::resolve_star(
        &attacker,
        &defender,
        favored,
        &attacker_seals,
        &defender_seals,
    );

    let ap = combat::side_power(&attacker, favored, &attacker_seals);
    let dp = combat::side_power(&defender, favored, &defender_seals);

    let mag_weight = combat::node_weight(star.magnitude);
    let delta = if won {
        combat::control_delta(star.magnitude, margin)
    } else {
        ((ap / (mag_weight * 1.5)) as i32).clamp(10, 100)
    };

    if won || delta >= 50 {
        star.held_by = Some(player.faction);
        ctx.db.star_node().hip_id().update(star.clone());
    }

    apply_control(ctx, star.region_hint, player.faction, delta);
    tally_fight(ctx, ctx.sender(), won);

    ctx.db.battle().insert(Battle {
        battle_id: 0,
        star_id: hip_id,
        attacker: ctx.sender(),
        won,
        attacker_score: ap as u32,
        defense_rating: dp as u32,
        created_at: ctx.timestamp,
    });

    let mut p = player;
    p.last_active = ctx.timestamp;
    ctx.db.player().identity().update(p);
    Ok(())
}

/// Queue for a live duel in a zone; pairs with anyone already waiting to spawn
/// a real 3-lane Duel both clients then drive.
#[reducer]
pub fn enqueue_duel(ctx: &ReducerContext, zone_id: u8) -> Result<(), String> {
    let me = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "register first".to_string())?;

    if !can_access_zone(ctx, me.faction, zone_id) {
        return Err("Zone is locked. Faction must control adjacent zones first!".into());
    }

    let waiting = ctx
        .db
        .duel_queue()
        .zone_id()
        .filter(&zone_id)
        .find(|t| t.seeker != ctx.sender());

    match waiting {
        Some(t) => {
            let opp = ctx
                .db
                .player()
                .identity()
                .find(&t.seeker)
                .ok_or_else(|| "opponent vanished".to_string())?;
            ctx.db.duel_queue().ticket_id().delete(&t.ticket_id);
            // Surface the pairing's synastry for matchmaking telemetry — read-only,
            // never leaked to clients and never touching the duel's resolution.
            if let (Some(my_chart), Some(opp_chart)) = (
                ctx.db.natal_chart().identity().find(&ctx.sender()),
                ctx.db.natal_chart().identity().find(&t.seeker),
            ) {
                let syn = chart::synastry(&opp_chart, &my_chart);
                log::debug!(
                    "duel synastry total {:.2} (house {:.2} aspect {:.2} element {:.2})",
                    syn.total, syn.house, syn.aspect, syn.element
                );
            }
            ctx.db.duel().insert(Duel {
                duel_id: 0,
                zone_id,
                player_a: t.seeker,
                player_b: ctx.sender(),
                faction_a: opp.faction,
                faction_b: me.faction,
                a_cards: vec![0, 0, 0],
                b_cards: vec![0, 0, 0],
                a_committed: false,
                b_committed: false,
                state: DuelState::Active,
                lanes_a: 0,
                lanes_b: 0,
                winner: None,
                created_at: ctx.timestamp,
                updated_at: ctx.timestamp,
            });
        }
        None => {
            let dup = ctx
                .db
                .duel_queue()
                .zone_id()
                .filter(&zone_id)
                .any(|t| t.seeker == ctx.sender());
            if !dup {
                ctx.db.duel_queue().insert(DuelQueue {
                    ticket_id: 0,
                    zone_id,
                    seeker: ctx.sender(),
                    enqueued_at: ctx.timestamp,
                });
            }
        }
    }
    Ok(())
}

/// Commit your three lane cards (one per lane). When both sides are in, resolve.
#[reducer]
pub fn commit_duel(
    ctx: &ReducerContext,
    duel_id: u64,
    lane0: u64,
    lane1: u64,
    lane2: u64,
) -> Result<(), String> {
    let mut duel = ctx
        .db
        .duel()
        .duel_id()
        .find(&duel_id)
        .ok_or_else(|| "no such duel".to_string())?;
    if duel.state != DuelState::Active {
        return Err("duel already resolved".into());
    }
    let is_a = duel.player_a == ctx.sender();
    let is_b = duel.player_b == ctx.sender();
    if !is_a && !is_b {
        return Err("not your duel".into());
    }
    let lane_cards = [lane0, lane1, lane2];
    if lane0 == lane1 || lane0 == lane2 || lane1 == lane2 {
        return Err("each duel lane needs a different card".into());
    }
    for cid in lane_cards {
        let c = ctx
            .db
            .card()
            .card_id()
            .find(&cid)
            .ok_or_else(|| "card not found".to_string())?;
        if c.owner != ctx.sender() {
            return Err("not your card".into());
        }
        if !has_loadout(ctx, ctx.sender(), cid, Loadout::Active) {
            return Err("duel lanes can only use Active cards".into());
        }
    }
    if is_a {
        duel.a_cards = vec![lane0, lane1, lane2];
        duel.a_committed = true;
    } else {
        duel.b_cards = vec![lane0, lane1, lane2];
        duel.b_committed = true;
    }
    duel.updated_at = ctx.timestamp;
    if duel.a_committed && duel.b_committed {
        resolve_duel(ctx, &mut duel);
    }
    ctx.db.duel().duel_id().update(duel);
    Ok(())
}

/// Lane-by-lane under environmental suit weather; best-of-3 wins and shifts the zone.
fn resolve_duel(ctx: &ReducerContext, duel: &mut Duel) {
    let favored = zone_favored_suit(ctx, duel.zone_id);
    let a_seals = sealed_suits(ctx, duel.faction_a);
    let b_seals = sealed_suits(ctx, duel.faction_b);
    let mut a = 0u8;
    let mut b = 0u8;

    let mut cards_a = Vec::new();
    let mut cards_b = Vec::new();

    for lane in 0..3 {
        if let Some(c) = ctx.db.card().card_id().find(&duel.a_cards[lane]) {
            cards_a.push(stat_of(&c));
        }
        if let Some(c) = ctx.db.card().card_id().find(&duel.b_cards[lane]) {
            cards_b.push(stat_of(&c));
        }
    }

    apply_passives(ctx, &mut cards_a, duel.faction_a, true, duel.zone_id);
    apply_passives(ctx, &mut cards_b, duel.faction_b, false, duel.zone_id);

    let transit_a = ctx
        .db
        .ephemeris()
        .body()
        .find(&duel.faction_a)
        .map(|e| e.transiting_zone == duel.zone_id)
        .unwrap_or(false);
    if transit_a {
        for c in cards_a.iter_mut() {
            c.attack = (c.attack as f32 * 1.30) as u16;
            c.health = (c.health as f32 * 1.30) as u16;
        }
    }
    let transit_b = ctx
        .db
        .ephemeris()
        .body()
        .find(&duel.faction_b)
        .map(|e| e.transiting_zone == duel.zone_id)
        .unwrap_or(false);
    if transit_b {
        for c in cards_b.iter_mut() {
            c.attack = (c.attack as f32 * 1.30) as u16;
            c.health = (c.health as f32 * 1.30) as u16;
        }
    }

    for lane in 0..3 {
        if lane < cards_a.len() && lane < cards_b.len() {
            let c_a = &cards_a[lane];
            let c_b = &cards_b[lane];
            let seal_a = if a_seals.contains(&c_a.suit) {
                combat::SEAL_BONUS
            } else {
                1.0
            };
            let seal_b = if b_seals.contains(&c_b.suit) {
                combat::SEAL_BONUS
            } else {
                1.0
            };
            let pa = (c_a.attack as f32 + c_a.health as f32 * 0.5 + c_a.armour as f32 * 0.4)
                * combat::element_weather(c_a.suit, favored)
                * seal_a;
            let pb = (c_b.attack as f32 + c_b.health as f32 * 0.5 + c_b.armour as f32 * 0.4)
                * combat::element_weather(c_b.suit, favored)
                * seal_b;
            if pa >= pb {
                a += 1;
            } else {
                b += 1;
            }
        }
    }

    duel.lanes_a = a;
    duel.lanes_b = b;
    duel.state = DuelState::Resolved;
    let (winner, faction) = if a >= b {
        (duel.player_a, duel.faction_a)
    } else {
        (duel.player_b, duel.faction_b)
    };
    duel.winner = Some(winner);
    apply_control(ctx, duel.zone_id, faction, 150 + a.max(b) as i32 * 60);
    // Both contestants fought this round; only the winner banks a win toward a draft.
    let loser = if winner == duel.player_a { duel.player_b } else { duel.player_a };
    tally_fight(ctx, winner, true);
    tally_fight(ctx, loser, false);
}
/// Claim a stalled duel: if your opponent never committed within the grace
/// window, the committed side takes the zone by walkover. Either participant may
/// call it (the no-show just hands over the win); the `tick_sky` sweep is the
/// automatic backstop if neither client ever calls this.
#[reducer]
pub fn claim_duel_timeout(ctx: &ReducerContext, duel_id: u64) -> Result<(), String> {
    let mut duel = ctx
        .db
        .duel()
        .duel_id()
        .find(&duel_id)
        .ok_or_else(|| "no such duel".to_string())?;
    if duel.state != DuelState::Active {
        return Err("duel already resolved".into());
    }
    if duel.player_a != ctx.sender() && duel.player_b != ctx.sender() {
        return Err("not your duel".into());
    }
    if elapsed_secs(ctx.timestamp, duel.updated_at) < DUEL_GRACE_SECS {
        return Err("duel is still within its grace period".into());
    }
    if !timeout_resolve(ctx, &mut duel) {
        return Err("both sides committed — the resolver will settle it".into());
    }
    ctx.db.duel().duel_id().update(duel);
    Ok(())
}

/// Scheduled backstop (driven by `tick_sky`): auto-resolve any duel left stalled
/// past the grace window so a phone that quietly drops never freezes the zone.
/// The full scan stays cheap: resolved rows are skipped on the first check, and
/// `prune_stale` bounds the table to a week of them anyway.
fn sweep_stale_duels(ctx: &ReducerContext) {
    for mut duel in ctx.db.duel().iter() {
        if duel.state != DuelState::Active {
            continue;
        }
        if elapsed_secs(ctx.timestamp, duel.updated_at) < DUEL_GRACE_SECS {
            continue;
        }
        if timeout_resolve(ctx, &mut duel) {
            ctx.db.duel().duel_id().update(duel);
        }
    }
}

/// Settle a stalled duel by forfeit. Returns false (no mutation) when it isn't
/// actually resolvable this way — i.e. both sides already committed, which is
/// `commit_duel`'s job, not a timeout's.
fn timeout_resolve(ctx: &ReducerContext, duel: &mut Duel) -> bool {
    match (duel.a_committed, duel.b_committed) {
        (true, false) => award_walkover(ctx, duel, true),
        (false, true) => award_walkover(ctx, duel, false),
        (false, false) => {
            // Nobody showed — close the duel without moving the zone meter.
            duel.lanes_a = 0;
            duel.lanes_b = 0;
            duel.winner = None;
            duel.state = DuelState::Resolved;
            duel.updated_at = ctx.timestamp;
            true
        }
        (true, true) => false,
    }
}

/// Award the committed side a walkover: a clean 3–0 and a flat zone swing.
fn award_walkover(ctx: &ReducerContext, duel: &mut Duel, a_wins: bool) -> bool {
    let (winner, faction) = if a_wins {
        duel.lanes_a = 3;
        duel.lanes_b = 0;
        (duel.player_a, duel.faction_a)
    } else {
        duel.lanes_a = 0;
        duel.lanes_b = 3;
        (duel.player_b, duel.faction_b)
    };
    duel.winner = Some(winner);
    duel.state = DuelState::Resolved;
    duel.updated_at = ctx.timestamp;
    apply_control(ctx, duel.zone_id, faction, DUEL_WALKOVER);
    // A walkover is a clean win toward the committed side's round draft.
    tally_fight(ctx, winner, true);
    true
}

/// Whole seconds between two timestamps (`later − earlier`), floored at 0.
fn elapsed_secs(later: Timestamp, earlier: Timestamp) -> i64 {
    let micros = later.to_micros_since_unix_epoch() - earlier.to_micros_since_unix_epoch();
    (micros / 1_000_000).max(0)
}

/// Bound the append-only history tables. Battle logs, answered (and abandoned)
/// Oracle Q&A, finished duels of every kind, settled trades, spent trace intents
/// and stale matchmaking tickets are transient telemetry; past their TTL they only
/// cost storage and subscription bandwidth. One global pass per `tick_sky` — each
/// scan is linear in the *retained* window (which the prune itself keeps bounded),
/// not the quadratic per-player scan #1 removed. Two tables are intentionally
/// permanent: `oracle_cache` (the answer cache is the asset we want to keep) and
/// `constellation_block` (the append-only trophy ledger of raised resolution).
fn prune_stale(ctx: &ReducerContext) {
    let now = ctx.timestamp;
    let stale_battles: Vec<u64> = ctx
        .db
        .battle()
        .iter()
        .filter(|b| elapsed_secs(now, b.created_at) > BATTLE_TTL_SECS)
        .map(|b| b.battle_id)
        .collect();
    for id in stale_battles {
        ctx.db.battle().battle_id().delete(&id);
    }

    let stale_reqs: Vec<u64> = ctx
        .db
        .oracle_request()
        .iter()
        // a question awaiting the companion service gets a full day to be answered
        .filter(|r| {
            let ttl = if r.answered { ORACLE_TTL_SECS } else { UNANSWERED_TTL_SECS };
            elapsed_secs(now, r.created_at) > ttl
        })
        .map(|r| r.request_id)
        .collect();
    for id in stale_reqs {
        ctx.db.oracle_request().request_id().delete(&id);
        ctx.db.oracle_reply().request_id().delete(&id);
    }

    let stale_challenges: Vec<u64> = ctx
        .db
        .duel_challenge()
        .iter()
        // same grace: an unanswered challenge lives a day before it ages out
        .filter(|c| {
            let ttl = if c.answered { ORACLE_TTL_SECS } else { UNANSWERED_TTL_SECS };
            elapsed_secs(now, c.created_at) > ttl
        })
        .map(|c| c.challenge_id)
        .collect();
    for id in stale_challenges {
        ctx.db.duel_challenge().challenge_id().delete(&id);
    }

    let stale_words: Vec<u64> = ctx
        .db
        .word_duel()
        .iter()
        .filter(|w| elapsed_secs(now, w.created_at) > WORD_DUEL_TTL_SECS)
        .map(|w| w.duel_id)
        .collect();
    for id in stale_words {
        ctx.db.word_duel().duel_id().delete(&id);
    }

    // Jing duels: a resolved thread ages out a month after its last touch, and an
    // open thread untouched that long is abandoned. Never an open duel inside the
    // window. Each duel takes its casts with it — that's `jing_cast`'s only pruner.
    let stale_jings: Vec<u64> = ctx
        .db
        .jing_duel()
        .iter()
        .filter(|d| elapsed_secs(now, d.updated_at) > JING_DUEL_TTL_SECS)
        .map(|d| d.duel_id)
        .collect();
    for id in stale_jings {
        let casts: Vec<u64> = ctx
            .db
            .jing_cast()
            .duel_id()
            .filter(&id)
            .map(|c| c.cast_id)
            .collect();
        for cid in casts {
            ctx.db.jing_cast().cast_id().delete(&cid);
        }
        ctx.db.jing_duel().duel_id().delete(&id);
    }

    // 3-lane duels: only resolved ones (the sweep resolves anything stalled, so
    // nothing sits Active for long). `updated_at` is stamped at resolution.
    let stale_duels: Vec<u64> = ctx
        .db
        .duel()
        .iter()
        .filter(|d| {
            d.state == DuelState::Resolved && elapsed_secs(now, d.updated_at) > DUEL_TTL_SECS
        })
        .map(|d| d.duel_id)
        .collect();
    for id in stale_duels {
        ctx.db.duel().duel_id().delete(&id);
    }

    // Trades: settled ones after a week; an Open trade neither side has touched
    // in a month is abandoned (`updated_at` moves on every confirm/state change).
    let stale_trades: Vec<u64> = ctx
        .db
        .trade()
        .iter()
        .filter(|t| {
            let ttl = if t.state == TradeState::Open { TRADE_OPEN_TTL_SECS } else { TRADE_TTL_SECS };
            elapsed_secs(now, t.updated_at) > ttl
        })
        .map(|t| t.trade_id)
        .collect();
    for id in stale_trades {
        ctx.db.trade().trade_id().delete(&id);
    }

    // Trace intents + attestations: the EIP-712 deadline has long passed by a week,
    // so both the intent and any signed attestation are spent paper.
    let stale_intents: Vec<u64> = ctx
        .db
        .trace_intent()
        .iter()
        .filter(|i| elapsed_secs(now, i.created_at) > TRACE_TTL_SECS)
        .map(|i| i.intent_id)
        .collect();
    for id in stale_intents {
        let action_keys: Vec<String> = ctx
            .db
            .horizon_action_receipt()
            .intent_id()
            .filter(&id)
            .map(|receipt| receipt.action_key.clone())
            .collect();
        for key in action_keys {
            ctx.db
                .horizon_action_receipt()
                .action_key()
                .delete(&key);
        }
        ctx.db.trace_intent().intent_id().delete(&id);
    }
    let stale_atts: Vec<u64> = ctx
        .db
        .trace_attestation()
        .iter()
        .filter(|a| elapsed_secs(now, a.created_at) > TRACE_TTL_SECS)
        .map(|a| a.intent_id)
        .collect();
    for id in stale_atts {
        ctx.db.trace_attestation().intent_id().delete(&id);
    }

    // Matchmaking tickets nobody ever paired with — the seeker is gone.
    let stale_tickets: Vec<u64> = ctx
        .db
        .duel_queue()
        .iter()
        .filter(|t| elapsed_secs(now, t.enqueued_at) > DUEL_TICKET_TTL_SECS)
        .map(|t| t.ticket_id)
        .collect();
    for id in stale_tickets {
        ctx.db.duel_queue().ticket_id().delete(&id);
    }

    // Identity-link grants that were opened but never claimed.
    let stale_grants: Vec<String> = ctx
        .db
        .claim_grant()
        .iter()
        .filter(|g| g.expires_at < now)
        .map(|g| g.code_hash.clone())
        .collect();
    for h in stale_grants {
        ctx.db.claim_grant().code_hash().delete(&h);
    }
}

fn has_duplicates(ids: &[u64]) -> bool {
    for i in 0..ids.len() {
        for j in (i + 1)..ids.len() {
            if ids[i] == ids[j] {
                return true;
            }
        }
    }
    false
}

fn has_loadout(ctx: &ReducerContext, owner: Identity, card_id: u64, loadout: Loadout) -> bool {
    ctx.db
        .deck_slot()
        .card_id()
        .filter(&card_id)
        .any(|s| s.owner == owner && s.loadout == loadout)
}

// ── Scheduled & owner feeds ───────────────────────────────────────────────

/// Fires on the schedule: decays held zones, wheels the living sky, sweeps
/// stalled duels, advances the Great Wheel, and lets unmanned factions raid.
#[reducer]
pub fn tick_sky(ctx: &ReducerContext, _timer: SkyTickTimer) {
    // 0. Drive any War Table that is mid-play.
    //
    // An all-agent table settles inside `open_melee_round`, and a human's play
    // advances the agents behind it — so what reaches here is the case neither
    // covers: a seated human who stopped playing. `melee_advance` plays for them
    // once `MELEE_TURN_GRACE_SECS` has passed and is a no-op before that, so this
    // is safe to run every tick. Collected first: the loop writes to the tables
    // it would otherwise be iterating.
    let live: Vec<u64> = ctx
        .db
        .melee_table()
        .iter()
        .filter(|t| t.state != MeleeState::Resolved)
        .map(|t| t.table_id)
        .collect();
    for table_id in live {
        melee_advance(ctx, table_id);
    }

    // 1. Decay held zones
    for mut z in ctx.db.zone().iter() {
        if z.control > 0 {
            z.control = (z.control - decay_rate(&z)).max(0);
            if z.control == 0 {
                z.owner = None;
            }
            z.updated_at = ctx.timestamp;
            ctx.db.zone().zone_id().update(z);
        }
    }

    // 2. Advance the Great Wheel season progression
    if let Some(mut cfg) = ctx.db.game_config().id().find(&0) {
        cfg.season_degree = (cfg.season_degree + 1) % 360;

        if cfg.season_degree == 0 {
            // Season Resolution: Calculate standings (House=1, Spire=2, Crown=3)
            let mut standings = [0u32; 10];
            for z in ctx.db.zone().iter() {
                if let Some(owner) = z.owner {
                    let weight = match z.kind {
                        ZoneKind::House => 1,
                        ZoneKind::Spire => 2,
                        ZoneKind::Crown => 3,
                    };
                    standings[owner.idx()] += weight;
                }
            }

            let mut champion: Option<Planet> = None;
            let mut max_score = 0;
            for i in 0..10 {
                if standings[i] > max_score {
                    max_score = standings[i];
                    champion = Some(Planet::from_idx(i as u8));
                }
            }

            // Soft Map Reset: clear stars
            for mut star in ctx.db.star_node().iter() {
                if star.held_by.is_some() {
                    star.held_by = None;
                    ctx.db.star_node().hip_id().update(star);
                }
            }

            // Soft Map Reset: set champion head-start (300 control), clear others
            for mut z in ctx.db.zone().iter() {
                if champion.is_some() && z.owner == champion {
                    z.control = 300;
                } else {
                    z.owner = None;
                    z.control = 0;
                }
                z.updated_at = ctx.timestamp;
                ctx.db.zone().zone_id().update(z);
            }

            if let Some(champ) = champion {
                log::info!("Season resolved! Champion Faction is: {:?}", champ);
            }
        } else if cfg.season_degree % 30 == 0 {
            // Sign Ingress Event
            let sign = (cfg.season_degree / 30) % 12;
            let active_zone = sign % 11;
            log::info!(
                "Zodiac Ingress: Great Wheel entered degree {}, active Ingress Buff zone is {}",
                cfg.season_degree,
                active_zone
            );
        }

        // Backfill the naked-eye star catalogue a batch per tick until the whole
        // sky is in. This is also how an already-published module picks up a
        // bigger catalogue after an upgrade — no manual call needed.
        if (cfg.star_seed_cursor as usize) < catalog::STARS.len() {
            cfg.star_seed_cursor =
                seed_star_batch(ctx, cfg.star_seed_cursor as usize, SEED_BATCH_PER_TICK);
        }

        // Seed the constellation pools on first tick after an upgrade (init seeds
        // them on a fresh publish; this covers an already-published module).
        if !cfg.constellations_seeded {
            seed_constellations(ctx);
            cfg.constellations_seeded = true;
        }

        ctx.db.game_config().id().update(cfg);
    }

    // Backfill the star-agent roster + comet registry after an upgrade (init
    // seeds them on a fresh publish; these cover an already-published module).
    if ctx.db.star_agent().iter().next().is_none() {
        seed_star_agents(ctx);
    }
    if ctx.db.comet().iter().next().is_none() {
        seed_comets(ctx);
    }

    advance_round_clock(ctx); // round weather: which sign is rising at the world horizon
    recompute_star_zones(ctx); // A — de-freeze the sky before bots read hints

    // Update planetary transit zones dynamically as the sky rotates
    let gmst = gmst_deg(ctx.timestamp);
    for mut eph in ctx.db.ephemeris().iter() {
        let zone = zone_for_lon(gmst - eph.ra);
        if zone != eph.transiting_zone {
            eph.transiting_zone = zone;
            ctx.db.ephemeris().body().update(eph);
        }
    }

    sweep_stale_duels(ctx); // B — auto-resolve abandoned duels
    prune_stale(ctx); // C — bound the append-only history tables
    agent_war(ctx); // D — continuous faction war: agents (and humans) push their zones

    // Star Staking Yield Accrual. The ephemeris-derived rate inputs (element
    // dominance, transit dignity) are the same for every stake this tick, so they
    // are computed once here instead of re-scanning the ephemeris per stake.
    let now = ctx.timestamp;
    let zone_dom: [f64; 4] = std::array::from_fn(|e| zone_dominance_for(ctx, e as u8));
    let sign_dignity: [f64; 12] = std::array::from_fn(|s| planet_dignity_for_star(s as u8, ctx));
    for mut stake in ctx.db.star_stake().iter() {
        let star = match ctx.db.star_node().hip_id().find(&stake.star_id) {
            Some(s) => s,
            None => continue,
        };
        let loc = match ctx.db.player_location().identity().find(&stake.staker) {
            Some(l) => l,
            None => continue,
        };

        let alt = altitude_deg(star.ra, star.dec, loc.lat, loc.lon, now);
        if alt <= 0.0 {
            // Below the horizon the stake earns nothing, so there is nothing to
            // record — rewriting `last_accrual_at` every tick only churned every
            // subscriber. Touch it at most once per IDLE_STAKE_TOUCH_SECS instead.
            // Accepted tradeoff (deliberate, to avoid a schema change): on rising,
            // up to that window of below-horizon time is counted at the risen rate
            // — negligible yield inflation. Cold-start stays exact for risen stars:
            // they accrue from `last_accrual_at` across any server downtime.
            if elapsed_secs(now, stake.last_accrual_at) > IDLE_STAKE_TOUCH_SECS {
                stake.last_accrual_at = now;
                ctx.db.star_stake().stake_id().update(stake);
            }
            continue;
        }

        let elapsed_secs = (now.to_micros_since_unix_epoch()
            - stake.last_accrual_at.to_micros_since_unix_epoch())
            / 1_000_000;
        if elapsed_secs <= 0 {
            continue;
        }

        // The rate itself is genuinely floating point — a product of altitude,
        // elemental dominance, chart affinity and transit dignity. It is
        // quantized to an integer here, at the boundary, and every step after
        // this one is exact.
        //
        // The previous form computed the whole accrual in f64 and finished with
        // `(gained * 1e18) as u128`. An 18-decimal amount needs ~60 bits; an
        // f64 mantissa holds 53. So the low digits of every single accrual were
        // rounding noise, and the error compounded on a column that is supposed
        // to be an exact balance.
        let rate_micro_atoms = (daily_rate_per_usdc(ctx, &stake, &star, &zone_dom, &sign_dignity)
            * (ESMS_SOLANA_ATOMS_PER_TOKEN * YIELD_RATE_SCALE) as f64)
            .max(0.0)
            .round() as u128;

        let gained_atoms = (stake.principal_usdc as u128)
            .saturating_mul(rate_micro_atoms)
            .saturating_mul(elapsed_secs as u128)
            / (USDC_UNITS_PER_TOKEN * SECONDS_PER_DAY * YIELD_RATE_SCALE);
        stake.accrued_essence = stake
            .accrued_essence
            .saturating_add(gained_atoms.saturating_mul(LEDGER_PER_SOLANA_ATOM));
        stake.last_accrual_at = now;
        ctx.db.star_stake().stake_id().update(stake);
    }
}

/// Owner-gated real-ephemeris feed. A trusted off-module job computes precise
/// positions (Swiss-Ephemeris-grade) and pushes them here.
#[reducer]
pub fn push_ephemeris(
    ctx: &ReducerContext,
    body_idx: u8,
    ra: f64,
    dec: f64,
    transiting_zone: u8,
    retrograde: bool,
) -> Result<(), String> {
    let cfg = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .ok_or_else(|| "not initialised".to_string())?;
    if ctx.sender() != cfg.owner {
        return Err("owner-only reducer".into());
    }
    let body = Planet::from_idx(body_idx);
    let row = Ephemeris {
        body,
        ra,
        dec,
        transiting_zone,
        retrograde,
        tick: ctx.timestamp,
    };
    if ctx.db.ephemeris().body().find(&body).is_some() {
        ctx.db.ephemeris().body().update(row);
    } else {
        ctx.db.ephemeris().insert(row);
    }
    Ok(())
}

// ── The Ascendant clock: per-round re-draft ─────────────────────────────────

/// The round interval (seconds) for a deck of `n` cards: the ~1-min base up to 25
/// cards, then +30s per additional 25-card band (26–50 → 90s, 51–75 → 120s, …).
fn round_interval_secs(n: usize) -> i64 {
    let bands_past = n.saturating_sub(1) / ROUND_BAND_SIZE;
    ROUND_BASE_SECS + ROUND_BAND_SECS * bands_past as i64
}

/// How many rounds one resolution pass should settle: at least one, at most a full
/// collection's worth (the offline catch-up cap), from elapsed/interval.
fn catchup_rounds(elapsed_secs: i64, interval_secs: i64, cap: u64) -> u64 {
    let i = interval_secs.max(1);
    ((elapsed_secs.max(0) / i) as u64).max(1).min(cap)
}

/// Auto-battle verdict for a round with no live result (offline/idle): the blended
/// active deck simply has to out-muscle the round's challenge.
fn auto_battle_win(deck_power: f32, challenge: f32) -> bool {
    deck_power >= challenge
}

/// At the cap, a draft only earns a slot by beating the weakest cullable bench card.
fn should_replace(new_strength: f32, weakest: Option<f32>) -> bool {
    match weakest {
        Some(w) => new_strength > w,
        None => false, // nothing cullable (all Active/Sentinel/Major) → discard the draft
    }
}

/// The weakest of a set of (card_id, strength) bench candidates.
fn pick_weakest(candidates: &[(u64, f32)]) -> Option<(u64, f32)> {
    candidates.iter().copied().reduce(|a, b| if b.1 < a.1 { b } else { a })
}

/// The round's challenge to beat in an auto-battle — scales with how much you're
/// already carrying, so a hoarded collection must earn each new card.
fn sky_challenge(deck_size: usize) -> f32 {
    40.0 + 6.0 * deck_size as f32
}

/// Number of cards a player owns (their whole collection, across all loadouts).
fn deck_size(ctx: &ReducerContext, owner: Identity) -> usize {
    ctx.db.card().owner().filter(&owner).count()
}

/// Tally a fought battle into the player's current round (a win drives success).
/// Upserts the round_state so it also covers players registered before this clock.
fn tally_fight(ctx: &ReducerContext, who: Identity, won: bool) {
    if let Some(mut rs) = ctx.db.round_state().identity().find(&who) {
        rs.fights += 1;
        if won {
            rs.wins += 1;
        }
        ctx.db.round_state().identity().update(rs);
    } else {
        ctx.db.round_state().insert(RoundState {
            identity: who,
            round_index: 0,
            wins: if won { 1 } else { 0 },
            fights: 1,
            last_resolved_at: ctx.timestamp,
        });
    }
}

/// Which bodies are retrograde in the live sky right now, indexed by `Planet::idx`
/// — the inversion signal for a drafted card (the blend's `TransitPos` drops it).
fn retrograde_flags(ctx: &ReducerContext) -> [bool; 10] {
    let mut retro = [false; 10];
    for e in ctx.db.ephemeris().iter() {
        retro[e.body.idx()] = e.retrograde;
    }
    retro
}

/// The owner's hero ceiling: the strongest stats among their Major Arcana, so a draft
/// can be clamped strictly below the keystone. None if they hold no Major.
fn hero_ceiling(ctx: &ReducerContext, owner: Identity) -> Option<(u16, u16, u16)> {
    let mut best: Option<(u16, u16, u16)> = None;
    for c in ctx.db.card().owner().filter(&owner).filter(|c| c.is_major) {
        best = Some(match best {
            Some((a, h, ar)) => (a.max(c.attack), h.max(c.health), ar.max(c.armour)),
            None => (c.attack, c.health, c.armour),
        });
    }
    best
}

/// Blended strength of the owner's Active loadout under the live ascendant weather —
/// the deck power an offline/idle round auto-battles with.
fn active_deck_power(ctx: &ReducerContext, owner: Identity) -> f32 {
    let asc_sign = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .map(|c| (c.ascendant_degree / 30 % 12) as u8)
        .unwrap_or(0);
    let favored = chart::sign_element(asc_sign);
    let mut power = 0.0f32;
    for slot in ctx
        .db
        .deck_slot()
        .owner()
        .filter(&owner)
        .filter(|s| s.loadout == Loadout::Active)
    {
        if let Some(c) = ctx.db.card().card_id().find(&slot.card_id) {
            let s = stat_of(&c);
            let strength = s.attack as f32 + s.health as f32 * 0.5 + s.armour as f32 * 0.4;
            power += strength * combat::element_weather(s.suit, favored);
        }
    }
    power
}

/// Mint one drafted card for a successful round, honoring the collection cap. Below
/// cap the card lands on the bench; at cap it replaces the weakest bench card, and
/// only if stronger — Active/Sentinel/Major cards are never culled.
fn draft_one(ctx: &ReducerContext, owner: Identity, chart_row: &NatalChart, round_index: u64) {
    let sky = live_transits(ctx);
    if sky.is_empty() {
        return; // the sky hasn't been seeded yet — nothing to draft from
    }
    let retro = retrograde_flags(ctx);
    let Some(spec) =
        chart::draft_card(chart_row, &sky, &retro, round_index, owner, hero_ceiling(ctx, owner))
    else {
        return;
    };

    if deck_size(ctx, owner) >= COLLECTION_CAP {
        // Only bench, non-Major cards are cullable.
        let candidates: Vec<(u64, f32)> = ctx
            .db
            .deck_slot()
            .owner()
            .filter(&owner)
            .filter(|s| s.loadout == Loadout::Bench)
            .filter_map(|s| ctx.db.card().card_id().find(&s.card_id))
            .filter(|c| !c.is_major)
            .map(|c| {
                let st = stat_of(&c);
                (c.card_id, st.attack as f32 + st.health as f32 * 0.5 + st.armour as f32 * 0.4)
            })
            .collect();
        let weakest = pick_weakest(&candidates);
        if !should_replace(chart::spec_strength(&spec), weakest.map(|(_, s)| s)) {
            return; // not worth a slot (or nothing cullable) → discard the draft
        }
        delete_card_and_slots(ctx, weakest.unwrap().0);
    }

    write_draft(ctx, owner, &spec);
}

/// Delete a card and free every deck slot pointing at it.
fn delete_card_and_slots(ctx: &ReducerContext, card_id: u64) {
    ctx.db.card().card_id().delete(&card_id);
    let dead: Vec<u64> = ctx
        .db
        .deck_slot()
        .card_id()
        .filter(&card_id)
        .map(|s| s.slot_id)
        .collect();
    for sid in dead {
        ctx.db.deck_slot().slot_id().delete(&sid);
    }
}

/// Write a drafted card to the bench.
fn write_draft(ctx: &ReducerContext, owner: Identity, spec: &chart::DraftSpec) {
    let mut card = ctx.db.card().insert(Card {
        card_id: 0,
        owner,
        suit: spec.suit,
        rank: spec.rank,
        health: spec.health,
        attack: spec.attack,
        armour: spec.armour,
        cooldown_ms: spec.cooldown_ms,
        source_body: spec.source_body,
        inverted: spec.inverted,
        is_major: false,
        level: 1,
        minted_at: ctx.timestamp,
        letter: 0,
    });
    let card_id = card.card_id;
    card.letter = crate::words::letter_for(card_id); // a letter accrues every match
    ctx.db.card().card_id().update(card);
    ctx.db.deck_slot().insert(DeckSlot {
        slot_id: 0,
        owner,
        card_id,
        loadout: Loadout::Bench,
    });
}

/// Remove every round timer for a player (used on re-register so clocks never stack).
fn clear_round_timers(ctx: &ReducerContext, player: Identity) {
    let ids: Vec<u64> = ctx
        .db
        .round_timer()
        .player()
        .filter(&player)
        .map(|t| t.scheduled_id)
        .collect();
    for id in ids {
        ctx.db.round_timer().scheduled_id().delete(&id);
    }
}

/// (Re)arm the player's round timer at the next interval for their *current* deck
/// size. One-shot `Time` schedules re-arm themselves, so the interval tracks the deck
/// as it grows — this is how the clock "slows" past 25 cards.
fn schedule_next_round(ctx: &ReducerContext, player: Identity) {
    let secs = round_interval_secs(deck_size(ctx, player));
    let next = Timestamp::from_micros_since_unix_epoch(
        ctx.timestamp.to_micros_since_unix_epoch() + secs * 1_000_000,
    );
    ctx.db.round_timer().insert(RoundTimer {
        scheduled_id: 0,
        player,
        scheduled_at: ScheduleAt::Time(next),
    });
}

/// The Ascendant clock, scheduled per player. Resolve the elapsed round(s) — one in
/// normal pacing, a catch-up batch (capped at one collection) after any gap — draft
/// a card for each success, then re-arm at the next deck-scaled interval. Keeps
/// pacing server-side whether or not the player is connected.
///
/// Success: the most recent round honors any live result (won ≥1 battle); a round
/// with no live play (offline/idle, and every catch-up round) falls to the auto-battle.
#[reducer]
pub fn resolve_round(ctx: &ReducerContext, timer: RoundTimer) {
    // Scheduled reducers must be driven only by the scheduler, never a client.
    if ctx.sender() != ctx.database_identity() {
        return;
    }
    let player_id = timer.player;
    // Drop the fired one-shot row defensively (Time schedules are one-shot anyway).
    ctx.db.round_timer().scheduled_id().delete(&timer.scheduled_id);

    // Player gone (never registered / cleared) → let the clock stop.
    if ctx.db.player().identity().find(&player_id).is_none() {
        clear_round_timers(ctx, player_id);
        return;
    }

    let mut rs = ctx.db.round_state().identity().find(&player_id).unwrap_or_else(|| {
        let fresh = RoundState {
            identity: player_id,
            round_index: 0,
            wins: 0,
            fights: 0,
            last_resolved_at: ctx.timestamp,
        };
        ctx.db.round_state().insert(fresh.clone());
        fresh
    });

    let interval = round_interval_secs(deck_size(ctx, player_id));
    let due = catchup_rounds(
        elapsed_secs(ctx.timestamp, rs.last_resolved_at),
        interval,
        MAX_CATCHUP_ROUNDS,
    );
    let chart_row = ctx.db.natal_chart().identity().find(&player_id);

    for i in 0..due {
        // The most recent round (i == 0) honors any live result; catch-up rounds had
        // no live play, so they fall to the auto-battle.
        let (fights, wins) = if i == 0 { (rs.fights, rs.wins) } else { (0, 0) };
        let success = if fights > 0 {
            wins > 0
        } else {
            auto_battle_win(active_deck_power(ctx, player_id), sky_challenge(deck_size(ctx, player_id)))
        };
        rs.round_index += 1;
        if success {
            if let Some(ref chart_row) = chart_row {
                draft_one(ctx, player_id, chart_row, rs.round_index);
            }
        }
    }

    rs.wins = 0;
    rs.fights = 0;
    rs.last_resolved_at = ctx.timestamp;
    ctx.db.round_state().identity().update(rs);

    // Exactly one timer survives, re-armed at the (possibly new) interval.
    clear_round_timers(ctx, player_id);
    schedule_next_round(ctx, player_id);
}

// ── Oracle (Claude companion) ───────────────────────────────────────────────

/// Normalized FNV-1a hash of a question (trimmed, whitespace-collapsed,
/// lowercased) for the answer cache, so trivially-different phrasings of the same
/// rules question hit the same entry.
fn question_hash(q: &str) -> u64 {
    let norm = q
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();
    let mut h: u64 = 0xcbf29ce484222325;
    for b in norm.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Ask the Oracle a free-text question. Rate-limited per player. A cacheable
/// (rules/lore) question already seen is answered instantly from the cache;
/// otherwise it is queued for the companion service. `context` is a derived
/// chart/state summary the client attaches — never private birth data.
#[reducer]
pub fn ask_oracle(
    ctx: &ReducerContext,
    question: String,
    context: String,
    cacheable: bool,
) -> Result<(), String> {
    let q = question.trim();
    if q.is_empty() {
        return Err("ask the Oracle something".into());
    }
    if q.len() > 500 {
        return Err("that question is too long for the Oracle".into());
    }

    // Per-player cooldown — a rejected attempt does not reset the clock.
    if let Some(rate) = ctx.db.oracle_rate().identity().find(&ctx.sender()) {
        if elapsed_secs(ctx.timestamp, rate.last_at) < ORACLE_COOLDOWN_SECS {
            return Err("the Oracle is still considering your last question".into());
        }
        ctx.db.oracle_rate().identity().update(OracleRate {
            identity: ctx.sender(),
            last_at: ctx.timestamp,
            count: rate.count + 1,
        });
    } else {
        ctx.db.oracle_rate().insert(OracleRate {
            identity: ctx.sender(),
            last_at: ctx.timestamp,
            count: 1,
        });
    }

    let qhash = question_hash(q);

    // Cache hit (rules/lore only): answer immediately, no service round-trip.
    if cacheable {
        if let Some(hit) = ctx.db.oracle_cache().qhash().find(&qhash) {
            let req = ctx.db.oracle_request().insert(OracleRequest {
                request_id: 0,
                asker: ctx.sender(),
                question: q.to_string(),
                context,
                cacheable,
                qhash,
                answered: true,
                created_at: ctx.timestamp,
            });
            ctx.db.oracle_reply().insert(OracleReply {
                request_id: req.request_id,
                asker: ctx.sender(),
                text: hit.text,
                model: "cache".into(),
                created_at: ctx.timestamp,
            });
            return Ok(());
        }
    }

    // Miss: queue for the companion service to answer via `answer_oracle`.
    ctx.db.oracle_request().insert(OracleRequest {
        request_id: 0,
        asker: ctx.sender(),
        question: q.to_string(),
        context,
        cacheable,
        qhash,
        answered: false,
        created_at: ctx.timestamp,
    });
    Ok(())
}

/// The companion service (authenticated as the module owner) returns Claude's
/// answer. Owner-gated. Writes the reply, marks the request answered, and — when
/// the question was cacheable — populates the shared cache.
#[reducer]
pub fn answer_oracle(
    ctx: &ReducerContext,
    request_id: u64,
    text: String,
    model: String,
) -> Result<(), String> {
    let cfg = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .ok_or_else(|| "not initialised".to_string())?;
    if ctx.sender() != cfg.owner {
        return Err("owner-only reducer".into());
    }
    let mut req = ctx
        .db
        .oracle_request()
        .request_id()
        .find(&request_id)
        .ok_or_else(|| "no such request".to_string())?;
    if req.answered {
        return Ok(()); // idempotent — already answered
    }
    req.answered = true;
    let cacheable = req.cacheable;
    let qhash = req.qhash;
    let question = req.question.clone();
    let asker = req.asker;
    ctx.db.oracle_request().request_id().update(req);

    ctx.db.oracle_reply().insert(OracleReply {
        request_id,
        asker,
        text: text.clone(),
        model: model.clone(),
        created_at: ctx.timestamp,
    });

    // Only a genuine answer seeds the shared cache — never a fallback the companion
    // service wrote because the question errored/was refused (`model == "error"`),
    // which would otherwise pin that fallback as everyone's answer to the question.
    if cacheable && model != "error" {
        let entry = OracleCache {
            qhash,
            question,
            text,
            model,
            created_at: ctx.timestamp,
        };
        if ctx.db.oracle_cache().qhash().find(&qhash).is_some() {
            ctx.db.oracle_cache().qhash().update(entry);
        } else {
            ctx.db.oracle_cache().insert(entry);
        }
    }
    Ok(())
}

// ── Word Duels of the Spheres (the Lettered Arcana) ─────────────────────────

/// Tally the letters across a player's whole collection — their rack. Index-backed by
/// `card.owner`, so it's O(this player's cards). Unlettered legacy cards (letter 0)
/// contribute nothing.
fn player_letters(ctx: &ReducerContext, owner: Identity) -> [u8; 26] {
    let mut have = [0u8; 26];
    for c in ctx.db.card().owner().filter(&owner) {
        if c.letter.is_ascii_uppercase() {
            let i = (c.letter - b'A') as usize;
            have[i] = have[i].saturating_add(1);
        }
    }
    have
}

/// A planetary agent's rack for a duel: `AGENT_RACK_SIZE` tiles drawn deterministically
/// from the live sky, so the same tick poses the same challenge. Seeded by the agent's
/// faction, the zone its planet is transiting, and the world Ascendant — the hand shifts
/// as the heavens turn. (Seam: a future planetary-agents service can swap this for a
/// richer, model-driven hand without touching the duel reducer.)
fn agent_letters(ctx: &ReducerContext, agent: Planet) -> [u8; 26] {
    let zone = ctx
        .db
        .ephemeris()
        .body()
        .find(&agent)
        .map(|e| e.transiting_zone as u64)
        .unwrap_or(0);
    let season = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .map(|c| c.ascendant_degree as u64)
        .unwrap_or(0);
    let mut s = (agent.idx() as u64)
        .wrapping_add(zone << 8)
        .wrapping_add(season << 16)
        .wrapping_add(0x9E37_79B9_7F4A_7C15); // odd splitmix constant so seed 0 isn't degenerate
    let mut have = [0u8; 26];
    for _ in 0..AGENT_RACK_SIZE {
        // xorshift64 step → a fresh tile each draw
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        let l = words::letter_for(s);
        have[(l - b'A') as usize] += 1;
    }
    have
}

/// Cast a Word of Power in a duel against a planetary agent. The word must be a real
/// word in the Codex, spellable from the letters across your collection; the agent
/// answers with its best word from a sky-seeded rack. Beat (or match) it to win the
/// big bonus — and either way the word itself pays tokens. Cooldown-paced so the
/// wallet can't be farmed by re-casting in a tight loop.
#[reducer]
pub fn cast_word(ctx: &ReducerContext, word: String, opponent: Planet) -> Result<(), String> {
    if ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender())
        .is_none()
    {
        return Err("register a Seeker first".into());
    }

    let w = word.trim().to_ascii_uppercase();
    if w.len() < 2 {
        return Err("a Word of Power needs at least two letters".into());
    }
    if !w.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err("a Word of Power is letters only".into());
    }
    if !words::is_valid(&w) {
        return Err("that word is not in the Codex".into());
    }

    // Per-player cooldown — a rejected cast above never starts the clock.
    if let Some(rate) = ctx.db.word_rate().identity().find(&ctx.sender()) {
        if elapsed_secs(ctx.timestamp, rate.last_at) < WORD_DUEL_COOLDOWN_SECS {
            return Err("the spheres still echo your last word — wait a moment".into());
        }
    }

    // You must hold the letters across your lettered Arcana.
    let have = player_letters(ctx, ctx.sender());
    if !words::can_spell(&w, &have) {
        return Err("your Arcana don't hold the letters for that word".into());
    }

    // Start/refresh the cooldown only now the cast is valid.
    if let Some(mut rate) = ctx.db.word_rate().identity().find(&ctx.sender()) {
        rate.last_at = ctx.timestamp;
        rate.plays += 1;
        ctx.db.word_rate().identity().update(rate);
    } else {
        ctx.db.word_rate().insert(WordRate {
            identity: ctx.sender(),
            last_at: ctx.timestamp,
            plays: 1,
        });
    }

    let player_score = words::word_score(&w);

    // Get the agent's rack and format it as a uppercase letter string.
    let agent_rack = agent_letters(ctx, opponent);
    let mut rack_str = String::new();
    for i in 0..26 {
        for _ in 0..agent_rack[i] {
            rack_str.push((b'A' + i as u8) as char);
        }
    }

    // Precompute legal candidate words and format manually as a JSON array of strings
    // to avoid extra dependency overhead.
    let cands = words::legal_candidates(&agent_rack);
    let mut cands_json = String::from("[");
    for (idx, c) in cands.iter().enumerate() {
        if idx > 0 {
            cands_json.push_str(", ");
        }
        cands_json.push('"');
        cands_json.push_str(c);
        cands_json.push('"');
    }
    cands_json.push(']');

    ctx.db.duel_challenge().insert(DuelChallenge {
        challenge_id: 0,
        player: ctx.sender(),
        opponent,
        player_word: w,
        player_score,
        agent_rack: rack_str,
        candidates: cands_json,
        answered: false,
        created_at: ctx.timestamp,
    });
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────

/// Snapshot the live sky as transit positions for the natal/transit blend. The
/// `Ephemeris` table stores RA/Dec; `chart` maps each back onto the zodiac and
/// through the player's own houses.
fn live_transits(ctx: &ReducerContext) -> Vec<chart::TransitPos> {
    ctx.db
        .ephemeris()
        .iter()
        .map(|e| chart::TransitPos { body: e.body, ra: e.ra, dec: e.dec })
        .collect()
}

fn faction_owns_zone(ctx: &ReducerContext, faction: Planet, zone_id: u8) -> bool {
    ctx.db
        .zone()
        .zone_id()
        .find(&zone_id)
        .map(|z| z.owner == Some(faction))
        .unwrap_or(false)
}

fn can_access_zone(ctx: &ReducerContext, faction: Planet, zone_id: u8) -> bool {
    if zone_id < 5 {
        true
    } else if zone_id < 10 {
        let spire_idx = zone_id - 5;
        let house_a = spire_idx;
        let house_b = (spire_idx + 4) % 5;
        faction_owns_zone(ctx, faction, house_a) || faction_owns_zone(ctx, faction, house_b)
    } else {
        let mut owned_spires = 0;
        for spire_id in 5..10 {
            if faction_owns_zone(ctx, faction, spire_id) {
                owned_spires += 1;
            }
        }
        owned_spires >= 2
    }
}

fn zone_center_ha(zone_id: u8) -> f64 {
    (zone_id as f64 + 0.5) * (360.0 / 11.0)
}

fn zone_favored_suit(ctx: &ReducerContext, zone_id: u8) -> Suit {
    let gmst = gmst_deg(ctx.timestamp);
    let ha = zone_center_ha(zone_id);
    let zodiac_lon = (gmst - ha).rem_euclid(360.0);
    let sign = (zodiac_lon / 30.0) % 12.0;
    chart::sign_element(sign as u8)
}

fn adjacent_zones(zone_id: u8) -> &'static [u8] {
    match zone_id {
        0 => &[5, 6],
        1 => &[6, 7],
        2 => &[7, 8],
        3 => &[8, 9],
        4 => &[9, 5],
        5 => &[10, 4, 0],
        6 => &[10, 0, 1],
        7 => &[10, 1, 2],
        8 => &[10, 2, 3],
        9 => &[10, 3, 4],
        10 => &[5, 6, 7, 8, 9],
        _ => &[],
    }
}

fn apply_passives(
    ctx: &ReducerContext,
    cards: &mut [combat::CardStat],
    faction: Planet,
    is_attacker: bool,
    zone_id: u8,
) {
    match faction {
        Planet::Mars => {
            if is_attacker {
                for c in cards.iter_mut() {
                    c.attack = (c.attack as f32 * 1.25) as u16;
                }
            } else {
                for c in cards.iter_mut() {
                    c.armour = (c.armour as f32 * 0.75) as u16;
                }
            }
        }
        Planet::Saturn => {
            if !is_attacker {
                for c in cards.iter_mut() {
                    c.health = (c.health as f32 * 1.30) as u16;
                    c.armour = (c.armour as f32 * 1.30) as u16;
                }
            }
        }
        Planet::Jupiter => {
            let mut jup_adj_count = 0f32;
            for &adj in adjacent_zones(zone_id) {
                if let Some(z) = ctx.db.zone().zone_id().find(&adj) {
                    if z.owner == Some(Planet::Jupiter) {
                        jup_adj_count += 1.0;
                    }
                }
            }
            if jup_adj_count > 0.0 {
                let multiplier = 1.0 + jup_adj_count * 0.15;
                for c in cards.iter_mut() {
                    c.attack = (c.attack as f32 * multiplier) as u16;
                    c.health = (c.health as f32 * multiplier) as u16;
                }
            }
        }
        _ => {}
    }
}

fn decay_rate(z: &Zone) -> i32 {
    match z.owner {
        Some(Planet::Saturn) => 4, // the wall holds longer
        _ => 8,
    }
}

fn get_ar_multiplier(ctx: &ReducerContext, zone_id: u8, actor: Identity) -> f32 {
    let mut mult = 1.0f32;
    for cap in ctx.db.ar_constellation_capture().player().filter(&actor) {
        if cap.zone_id == zone_id && cap.expires_at > ctx.timestamp {
            let score_bonus = (cap.precision_score as f32 / 100.0) * 1.5;
            mult = mult.max(3.5 + score_bonus);
        }
    }
    mult
}

/// Single-meter tug-of-war: positive `control` = the current `owner`'s hold.
fn apply_control(ctx: &ReducerContext, zone_id: u8, attacker: Planet, delta: i32) {
    if let Some(mut z) = ctx.db.zone().zone_id().find(&zone_id) {
        // Expiry check on zone flux
        if z.in_flux {
            if let Some(exp) = z.flux_expires_at {
                if ctx.timestamp >= exp {
                    z.in_flux = false;
                    z.flux_level = 0;
                    z.flux_expires_at = None;
                }
            }
        }

        let flux_mult = if z.in_flux { 2.5f32 } else { 1.0f32 };
        let ar_mult = get_ar_multiplier(ctx, zone_id, ctx.sender());
        let effective_delta = ((delta as f32) * flux_mult * ar_mult) as i32;

        match z.owner {
            None => {
                z.owner = Some(attacker);
                z.control = effective_delta.clamp(0, 1000);
            }
            Some(o) if o == attacker => {
                z.control = (z.control + effective_delta).clamp(0, 1000);
            }
            Some(_) => {
                z.control -= effective_delta;
                if z.control <= 0 {
                    z.owner = Some(attacker);
                    z.control = (-z.control).clamp(0, FLIP_THRESHOLD);
                }
            }
        }
        z.updated_at = ctx.timestamp;
        ctx.db.zone().zone_id().update(z);
    }
}


/// Canonical zone bucket: a 0..360° angle mapped into the eleven zones exactly
/// the way the feeder maps a planet's ecliptic longitude
/// (`min(10, floor(lon/360 * 11))`), so stars and planets share one zone basis.
fn zone_for_lon(lon_deg: f64) -> u8 {
    let l = lon_deg.rem_euclid(360.0);
    ((l / 360.0) * 11.0).floor().clamp(0.0, 10.0) as u8
}

/// Greenwich Mean Sidereal Time in degrees, 0..360. Matches the client's
/// `SkyMath.GmstDeg` so the server's sky and a player's chart share one clock.
fn gmst_deg(ts: Timestamp) -> f64 {
    let unix_secs = ts.to_micros_since_unix_epoch() as f64 / 1_000_000.0;
    let jd = unix_secs / 86_400.0 + 2_440_587.5; // Unix epoch → Julian Day
    let d = jd - 2_451_545.0; // days since J2000.0
    let t = d / 36_525.0; // Julian centuries
    (280.460_618_37 + 360.985_647_366_29 * d + 0.000_387_933 * t * t - t * t * t / 38_710_000.0)
        .rem_euclid(360.0)
}

/// Ecliptic longitude (deg, 0..360) rising on the eastern horizon at the world's
/// reference location *now* — the Ascendant that drives the round clock. Same
/// formula as the client's `ChartCalculator.AscMc`, evaluated at New York: the
/// shared "field of play" everyone fights under, sweeping the zodiac in real time
/// (fast through Aries ≈ 1h10m, slow through Virgo ≈ 2h45m at this latitude).
fn ascendant_deg(ts: Timestamp) -> f64 {
    let ramc = (gmst_deg(ts) + REF_LON_DEG).rem_euclid(360.0).to_radians();
    let e = OBLIQUITY_DEG.to_radians();
    let lat = REF_LAT_DEG.to_radians();
    let asc = ramc
        .cos()
        .atan2(-(e.sin() * lat.tan() + e.cos() * ramc.sin()));
    asc.to_degrees().rem_euclid(360.0)
}

/// Altitude (degrees, −90..90) of an equatorial point (`ra`,`dec` in degrees)
/// seen from (`lat`,`lon` in degrees, east-positive) at `ts`. Shares the GMST
/// clock with the rest of the sky, so it agrees with the client's `SkyMath`.
fn altitude_deg(ra: f64, dec: f64, lat: f64, lon: f64, ts: Timestamp) -> f64 {
    let lst = (gmst_deg(ts) + lon).rem_euclid(360.0); // local sidereal time, deg
    let ha = (lst - ra).to_radians(); // hour angle
    let (dec_r, lat_r) = (dec.to_radians(), lat.to_radians());
    let sin_alt = dec_r.sin() * lat_r.sin() + dec_r.cos() * lat_r.cos() * ha.cos();
    sin_alt.clamp(-1.0, 1.0).asin().to_degrees()
}

/// A star must clear this altitude over your horizon before you may engage it.
const MIN_ALT_DEG: f64 = 10.0;

/// The suits a faction currently holds a zodiac seal in: the elements of the signs
/// sitting in the zones it owns right now. The sky rotates, so the set shifts —
/// holding a zone while its sign is up grants that element's mastery, and the
/// faction's cards of that suit fight at `combat::SEAL_BONUS` wherever they contest.
fn sealed_suits(ctx: &ReducerContext, faction: Planet) -> Vec<Suit> {
    let mut suits = Vec::new();
    for z in ctx.db.zone().iter() {
        if z.owner == Some(faction) {
            let suit = zone_favored_suit(ctx, z.zone_id);
            if !suits.contains(&suit) {
                suits.push(suit);
            }
        }
    }
    suits
}

/// Advance the round clock: store the world Ascendant's whole degree. Each 30°
/// crossing is a new sign — a new favored element, a new round, of a length set
/// by how fast that sign rises at the reference horizon.
fn advance_round_clock(ctx: &ReducerContext) {
    if let Some(mut cfg) = ctx.db.game_config().id().find(&0) {
        let deg = (ascendant_deg(ctx.timestamp).floor() as i64).rem_euclid(360) as u16;
        if deg != cfg.ascendant_degree {
            cfg.ascendant_degree = deg;
            ctx.db.game_config().id().update(cfg);
        }
    }
}

/// Living sky (A): recompute each star's `region_hint` from its RA and the
/// current sidereal time, so the catalogue wheels through the zones once per
/// sidereal day instead of sitting frozen on its seed hint. A star's zone is its
/// hour angle from the prime meridian (`GMST − RA`), bucketed canonically.
/// Writes only rows whose zone actually changed (≈ one cross per star / ~2 h).
fn recompute_star_zones(ctx: &ReducerContext) {
    let gmst = gmst_deg(ctx.timestamp);
    for mut s in ctx.db.star_node().iter() {
        let zone = zone_for_lon(gmst - s.ra);
        if zone != s.region_hint {
            s.region_hint = zone;
            ctx.db.star_node().hip_id().update(s);
        }
    }
}

/// Collect up to 8 Defense-loadout cards from members of the holding faction.
/// Walks only Defense slots (indexed), not every slot of every player; the first
/// 8 belonging to the holder's members win, and an empty garrison still falls
/// back to the token guardian — same selection as the old full-table scan.
fn sentinel_for(ctx: &ReducerContext, holder: Planet) -> Vec<combat::CardStat> {
    let mut out = Vec::new();
    for slot in ctx.db.deck_slot().loadout().filter(&Loadout::Defense) {
        if let Some(owner) = ctx.db.player().identity().find(&slot.owner) {
            if owner.faction != holder {
                continue;
            }
            if let Some(c) = ctx.db.card().card_id().find(&slot.card_id) {
                out.push(stat_of(&c));
                if out.len() >= DEFENSE_LIMIT {
                    break;
                }
            }
        }
    }
    if out.is_empty() {
        // No human sentinel — fall back to a token guardian scaled to the planet.
        out.push(combat::CardStat {
            suit: holder.biased_suit(),
            attack: 18,
            health: 30,
            armour: 10,
        });
    }
    out
}

/// A neutral star's baseline guardian, tougher for brighter stars.
fn neutral_garrison(star: &StarNode) -> Vec<combat::CardStat> {
    let w = combat::node_weight(star.magnitude);
    let base = (10.0 + w * 6.0) as u16;
    vec![
        combat::CardStat {
            suit: Suit::Pentacles,
            attack: base / 2,
            health: base * 2,
            armour: base,
        },
        combat::CardStat {
            suit: Suit::Cups,
            attack: base / 2,
            health: base * 2,
            armour: base / 2,
        },
    ]
}

/// Keep the war alive: any faction with zero human players raids one star in
/// the zone its planet is transiting.
// ── Continuous faction war ───────────────────────────────────────────────────
// Three tiers of agency push every tick, so the sky is never idle:
//   • PLANETARY AGENT (baseline): each planet is itself an agent — it pushes
//     control into the zone it currently transits, every tick, with no players
//     needed. This is the always-on heartbeat of the war.
//   • HISTORICAL AGENTS (amplify): people with birthcharts (Einstein, Chiron's
//     discovery chart, …) who joined this faction add their active-deck power.
//   • HUMANS (tip the scales): real players who join the faction add the same way,
//     plus a presence bonus — joining a faction always strengthens its push.
// The faction-strength tally below treats historical agents and humans uniformly
// (both are `player` rows); the planetary baseline is applied to all ten factions.
const WAR_PLANET_BASE: i32 = 12; // the planetary agent's own per-tick push
const WAR_PER_PLAYER: i32 = 6; // presence bonus per joined agent/human
const WAR_POWER_DIV: f32 = 8.0; // active-deck-power → control units
const WAR_PUSH_CAP: i32 = 140; // per-tick ceiling (cf. 4–8 decay, ~150 duel swing)

fn agent_war(ctx: &ReducerContext) {
    // Tally per-faction joined agents/humans and their combined offensive power.
    let mut count = [0u32; 10];
    let mut power = [0.0f32; 10];
    for p in ctx.db.player().iter() {
        let i = p.faction.idx();
        count[i] += 1;
        power[i] += active_deck_power(ctx, p.identity);
    }

    let gmst = gmst_deg(ctx.timestamp);
    // Prefer the real transit zone from the (feeder-fed) ephemeris; when that's
    // absent the planetary agent still roams — its zone rotates with sidereal
    // time, offset per planet, so the war never stalls if the feeder is down.
    let mut zones = [0u8; 10];
    for fac in ALL_PLANETS {
        let i = fac.idx();
        zones[i] = ctx
            .db
            .ephemeris()
            .body()
            .find(&fac)
            .map(|e| e.transiting_zone)
            .unwrap_or_else(|| zone_for_lon(gmst + i as f64 * 36.0));
    }

    // Each planet (and its faction) attempts to raid one star in its transiting zone,
    // subject to zone accessibility and Auto-Siege combat resolution vs Sentinels.
    let mut targets: [Option<StarNode>; 10] = Default::default();
    let mut missing = ALL_PLANETS.len();
    for s in ctx.db.star_node().iter() {
        for fac in ALL_PLANETS {
            let i = fac.idx();
            if targets[i].is_none()
                && s.region_hint == zones[i]
                && s.held_by != Some(fac)
                && can_access_zone(ctx, fac, s.region_hint)
            {
                targets[i] = Some(s.clone());
                missing -= 1;
            }
        }
        if missing == 0 {
            break;
        }
    }

    for fac in ALL_PLANETS {
        let i = fac.idx();
        // A zone that just settled a melee has already had its control moved, by a
        // bounded zero-sum split. Pushing it again here would double-count and flip
        // zones in seconds — the coarse per-faction push stands down.
        if zone_ran_melee(ctx, zones[i]) {
            continue;
        }
        // Planetary baseline always applies; joined agents/humans amplify on top.
        let push_power = (WAR_PLANET_BASE
            + WAR_PER_PLAYER * count[i] as i32
            + (power[i] / WAR_POWER_DIV) as i32)
            .clamp(WAR_PLANET_BASE, WAR_PUSH_CAP);

        if let Some(mut s) = targets[i].take() {
            let faction_agent_id =
                Identity::from_claims("pentacles:faction", &format!("{:?}", fac).to_lowercase());

            let mut attacker = vec![combat::CardStat {
                suit: fac.biased_suit(),
                attack: (WAR_PLANET_BASE + (power[i] / WAR_POWER_DIV) as i32) as u16,
                health: (WAR_PLANET_BASE * 2 + WAR_PER_PLAYER * count[i] as i32) as u16,
                armour: (WAR_PLANET_BASE / 2) as u16,
            }];

            let mut defender = match s.held_by {
                Some(holder) => sentinel_for(ctx, holder),
                None => neutral_garrison(&s),
            };

            apply_passives(ctx, &mut attacker, fac, true, s.region_hint);
            if let Some(holder) = s.held_by {
                apply_passives(ctx, &mut defender, holder, false, s.region_hint);
            }

            let favored = zone_favored_suit(ctx, s.region_hint);
            let attacker_seals = sealed_suits(ctx, fac);
            let defender_seals = s.held_by.map(|f| sealed_suits(ctx, f)).unwrap_or_default();

            let (won, margin) = combat::resolve_star(
                &attacker,
                &defender,
                favored,
                &attacker_seals,
                &defender_seals,
            );

            let ap = combat::side_power(&attacker, favored, &attacker_seals);
            let dp = combat::side_power(&defender, favored, &defender_seals);

            if won {
                s.held_by = Some(fac);
                ctx.db.star_node().hip_id().update(s.clone());
                let c_delta = combat::control_delta(s.magnitude, margin);
                apply_control(ctx, zones[i], fac, c_delta);
            } else {
                apply_control(ctx, zones[i], fac, push_power / 2);
            }

            ctx.db.battle().insert(Battle {
                battle_id: 0,
                star_id: s.hip_id,
                attacker: faction_agent_id,
                won,
                attacker_score: ap as u32,
                defense_rating: dp as u32,
                created_at: ctx.timestamp,
            });
        } else {
            apply_control(ctx, zones[i], fac, push_power);
        }
    }
}

// ════════════════════════════════════════════════════════════════════════════
//  The War Table — multi-seat zone melee
//
//  The feeder daemon (feeder/historical-agent-service.ts) is the referee: it
//  computes Zone Claims, seats champions, plays the twelve tricks with the shared
//  JS engine (public/arcanaTrickEngine.js) and submits the result. Both of its
//  writes are owner-gated, the same trusted-bridge pattern `answer_oracle` and
//  `report_service_health` use.
//
//  What the module owns — and therefore what a bad feeder cannot forge:
//    · scoring        (`seat_score`, derived here from counters + melds + climax)
//    · control        (`melee_control_deltas`, zero-sum and bounded)
//    · zone access    (`can_access_zone`, enforced on every human queue join)
//  What it does NOT own: whether a played card was legal. That is validated off
//  chain. See docs/ZONE_MELEE_ARCANA_TRICK_PLAN.md §9 for the trust boundary.
// ════════════════════════════════════════════════════════════════════════════

/// Total control a single melee may move at a zone, before flux/AR multipliers.
const ZONE_SWING: i32 = 120;
/// Flat bonus on top of the winner's share.
const ZONE_SWING_WINNER_BONUS: i32 = 30; // ZONE_SWING * 0.25
/// Winning the final trick is worth ten counters, as in the melee rules.
const FINAL_TRICK_BONUS: u16 = 10;
/// A zone that ran a table this recently is left alone by `agent_war`'s blind push.
const MELEE_PUSH_SUPPRESSION_MICROS: i64 = 90_000_000; // 90s > the 60s round

/// A seat's score: trick counters + melds declared + the final-trick climax.
/// Derived here so the feeder cannot simply assert a score.
fn seat_score(counters: u16, melds_value: u16, took_final_trick: bool) -> u16 {
    counters
        .saturating_add(melds_value)
        .saturating_add(if took_final_trick { FINAL_TRICK_BONUS } else { 0 })
}

/// Control deltas for one table, as zero-sum shares around the mean.
///
/// A seat that scores exactly the table average moves the zone by nothing; the
/// swing is bounded by `ZONE_SWING` no matter how many seats are filled, so a
/// six-seat table cannot shove a zone three times harder than a two-seat one.
/// The winner takes a flat bonus on top — the only non-zero-sum term.
fn melee_control_deltas(scores: &[u16], zone_swing: i32) -> Vec<i32> {
    let n = scores.len();
    if n == 0 {
        return Vec::new();
    }
    let total: u32 = scores.iter().map(|s| *s as u32).sum();
    let mut out = vec![0i32; n];
    if total > 0 {
        let mean = 1.0f32 / n as f32;
        for (i, s) in scores.iter().enumerate() {
            let share = *s as f32 / total as f32;
            out[i] = ((share - mean) * zone_swing as f32).round() as i32;
        }
    }
    // Winner. On a tie the earliest seat takes it — the same "first played wins"
    // tie-break the trick engine uses, so the two can never disagree.
    let mut best = 0usize;
    for i in 1..n {
        if scores[i] > scores[best] {
            best = i;
        }
    }
    // Rounding each share independently leaves a residual of a point or two. Park
    // it on the winner so the non-bonus half of the split is EXACTLY zero-sum —
    // otherwise every round leaks a little control into the world and zones drift
    // upward on their own over a few hours of play.
    let residual: i32 = -out.iter().sum::<i32>();
    out[best] += residual + ZONE_SWING_WINNER_BONUS;
    out
}

/// Did this zone already resolve a melee in the current window? `agent_war`'s
/// coarse per-faction push must stand down when it did, or control is applied
/// twice and zones flip in seconds.
fn zone_ran_melee(ctx: &ReducerContext, zone_id: u8) -> bool {
    let now = ctx.timestamp.to_micros_since_unix_epoch();
    ctx.db.melee_table().zone_id().filter(&zone_id).any(|t| match t.state {
        MeleeState::Resolved => t
            .resolved_at
            .map(|r| now - r.to_micros_since_unix_epoch() < MELEE_PUSH_SUPPRESSION_MICROS)
            .unwrap_or(false),
        // A table still mustering or mid-play owns the zone this round.
        _ => true,
    })
}


// ── The referee ─────────────────────────────────────────────────────────────
//
// Everything below turns the module from the War Table's *scorekeeper* into its
// *referee*. It used to be that the feeder dealt, played and scored twelve tricks
// in JavaScript and reported the totals; the module checked the arithmetic and
// moved control. A feeder that lied about who harvested what was believed.
//
// Now the module deals the hands (`melee_hand`), freezes the ladder from its own
// `ephemeris`, validates every play against `melee::legal_mask`, resolves each
// trick as its last card lands (`melee_trick`), and settles the table itself at
// trick twelve. The feeder's remaining job is to decide WHO sits down.
//
// `crate::melee` holds the rules, ported function-for-function from
// public/arcanaTrickEngine.js and unit-tested against the same fixtures. This
// section is only the plumbing between those rules and the tables.

/// How long a human seat may sit on its turn before the module plays for it.
/// Without this one absent player freezes a six-seat table forever.
const MELEE_TURN_GRACE_SECS: i64 = 45;

/// Hard ceiling on plays the referee will make in one call. Twelve tricks at six
/// seats is 72; anything past that means the state machine is not converging and
/// we would rather stop than spin inside a reducer.
const MELEE_MAX_STEPS: usize = 96;

/// The live sky as the ladder reads it. `up` is true for every body: the server
/// has no single observer, which is exactly the default the JS engine uses when
/// a feeder omits the field.
fn melee_sky(ctx: &ReducerContext) -> Vec<melee::SkyBody> {
    ctx.db
        .ephemeris()
        .iter()
        .map(|e| melee::SkyBody {
            body: e.body,
            // 1800 arc-minutes to a sign — the SIGN_MINUTES of chart.rs.
            sign: ((chart::equatorial_to_ecliptic_min(e.ra, e.dec) / 1800) % 12) as u8,
            retrograde: e.retrograde,
            up: true,
        })
        .collect()
}

/// Ecliptic longitude per faction, in arc-minutes — what `seat_order` sorts on.
fn melee_longitudes(ctx: &ReducerContext) -> [u16; 10] {
    let mut lon = [0u16; 10];
    for e in ctx.db.ephemeris().iter() {
        lon[e.body.idx()] = chart::equatorial_to_ecliptic_min(e.ra, e.dec);
    }
    lon
}

/// The pool a seat is dealt from: its Active loadout first, then Bench, then the
/// whole collection. A player who never assigned a loadout still gets a hand —
/// the on-chain twin of the client's four-tier fallback.
fn melee_deal_pool(ctx: &ReducerContext, owner: Identity) -> Vec<melee::MeleeCard> {
    let as_cards = |cards: Vec<Card>| -> Vec<melee::MeleeCard> {
        cards
            .into_iter()
            .map(|c| melee::MeleeCard {
                card_id: c.card_id,
                suit: c.suit,
                rank: c.rank,
                is_major: c.is_major,
                inverted: c.inverted,
            })
            .collect()
    };
    let owned: Vec<Card> = ctx.db.card().owner().filter(&owner).collect();
    if owned.is_empty() {
        return Vec::new();
    }
    let in_loadout = |l: Loadout| -> Vec<Card> {
        let ids: Vec<u64> = ctx
            .db
            .deck_slot()
            .owner()
            .filter(&owner)
            .filter(|d| d.loadout == l)
            .map(|d| d.card_id)
            .collect();
        owned.iter().filter(|c| ids.contains(&c.card_id)).cloned().collect()
    };

    let active = in_loadout(Loadout::Active);
    if active.len() >= melee::HAND_SIZE {
        return as_cards(active);
    }
    let mut pool = active;
    for c in in_loadout(Loadout::Bench) {
        if !pool.iter().any(|p| p.card_id == c.card_id) {
            pool.push(c);
        }
    }
    if pool.len() >= melee::HAND_SIZE {
        return as_cards(pool);
    }
    for c in owned {
        if !pool.iter().any(|p| p.card_id == c.card_id) {
            pool.push(c);
        }
    }
    as_cards(pool)
}

/// Every seat at a table in play order. `seat_id` ascends in insertion order, and
/// `open_melee_round` inserts in ecliptic order, so this IS the turn rotation.
fn melee_seats(ctx: &ReducerContext, table_id: u64) -> Vec<MeleeSeat> {
    let mut seats: Vec<MeleeSeat> = ctx.db.melee_seat().table_id().filter(&table_id).collect();
    seats.sort_by_key(|s| s.seat_id);
    seats
}

/// A seat's unplayed cards.
fn melee_hand_of(ctx: &ReducerContext, seat_id: u64) -> Vec<melee::MeleeCard> {
    ctx.db
        .melee_hand()
        .seat_id()
        .filter(&seat_id)
        .filter(|h| !h.played)
        .map(|h| melee::MeleeCard {
            card_id: h.card_id,
            suit: h.suit,
            rank: h.rank,
            is_major: h.is_major,
            inverted: h.inverted,
        })
        .collect()
}

/// The trick now in progress: its number, and the cards already in it in play
/// order. Derived from resolved `melee_trick` rows rather than from a play count,
/// so a short trick (a seat that ran out of cards) cannot skew the arithmetic.
fn melee_open_trick(ctx: &ReducerContext, table_id: u64) -> (u8, Vec<MeleePlay>) {
    let resolved = ctx.db.melee_trick().table_id().filter(&table_id).count() as u8;
    let trick_no = resolved + 1;
    let mut plays: Vec<MeleePlay> = ctx
        .db
        .melee_play()
        .table_id()
        .filter(&table_id)
        .filter(|p| p.trick_number == trick_no)
        .collect();
    plays.sort_by_key(|p| p.play_id);
    (trick_no, plays)
}

/// Who leads the current trick: seat one on trick 1, thereafter whoever took the
/// trick before.
fn melee_leader(ctx: &ReducerContext, table_id: u64, seats: &[MeleeSeat], trick_no: u8) -> u64 {
    let first = seats.first().map(|s| s.seat_id).unwrap_or(0);
    if trick_no <= 1 {
        return first;
    }
    ctx.db
        .melee_trick()
        .table_id()
        .filter(&table_id)
        .find(|t| t.trick_number == trick_no - 1)
        .map(|t| t.winner_seat)
        .unwrap_or(first)
}

/// Seats that held a card when this trick began: those still holding one, plus
/// those that have already played into it. A seat dealt short simply drops out of
/// the rotation instead of stalling the table.
fn melee_expected_seats(
    ctx: &ReducerContext,
    seats: &[MeleeSeat],
    trick_plays: &[MeleePlay],
) -> Vec<u64> {
    seats
        .iter()
        .filter(|s| {
            trick_plays.iter().any(|p| p.seat_id == s.seat_id)
                || !melee_hand_of(ctx, s.seat_id).is_empty()
        })
        .map(|s| s.seat_id)
        .collect()
}

/// The seat whose turn it is, or `None` when the trick is complete.
fn melee_turn(
    ctx: &ReducerContext,
    seats: &[MeleeSeat],
    leader_seat: u64,
    trick_plays: &[MeleePlay],
) -> Option<u64> {
    let expected = melee_expected_seats(ctx, seats, trick_plays);
    let played: Vec<u64> = trick_plays.iter().map(|p| p.seat_id).collect();
    melee::turn_in_rotation(&expected, leader_seat, &played)
}

/// The cards on the table, in play order, as the rules see them. Inversion is
/// irrelevant to trick POWER, which is all this feeds.
fn melee_trick_cards(plays: &[MeleePlay]) -> Vec<melee::MeleeCard> {
    plays
        .iter()
        .map(|p| melee::MeleeCard {
            card_id: p.card_id,
            suit: p.suit,
            rank: p.rank,
            is_major: p.is_major,
            inverted: false,
        })
        .collect()
}

/// Commit one validated play: spend the card from the seat's hand and record it.
fn melee_commit_play(
    ctx: &ReducerContext,
    table_id: u64,
    seat_id: u64,
    trick_number: u8,
    card: &melee::MeleeCard,
) {
    if let Some(mut row) = ctx
        .db
        .melee_hand()
        .seat_id()
        .filter(&seat_id)
        .find(|h| h.card_id == card.card_id && !h.played)
    {
        row.played = true;
        ctx.db.melee_hand().hand_id().update(row);
    }
    ctx.db.melee_play().insert(MeleePlay {
        play_id: 0,
        table_id,
        trick_number,
        seat_id,
        card_id: card.card_id,
        is_major: card.is_major,
        rank: card.rank,
        suit: card.suit,
        played_at: ctx.timestamp,
    });
}

/// Close a completed trick: bank its counters on the winner, hand the Excuse its
/// own Honour back, and write the row the client animates from.
fn melee_close_trick(
    ctx: &ReducerContext,
    table: &MeleeTable,
    trick_no: u8,
    leader_seat: u64,
    plays: &[MeleePlay],
    ladder: &melee::Ladder,
) {
    // Counter values must come from the DEALT cards, since inversion halves them
    // and `melee_play` does not carry the flag.
    let cards: Vec<melee::MeleeCard> = plays
        .iter()
        .map(|p| {
            ctx.db
                .melee_hand()
                .seat_id()
                .filter(&p.seat_id)
                .find(|h| h.card_id == p.card_id)
                .map(|h| melee::MeleeCard {
                    card_id: h.card_id,
                    suit: h.suit,
                    rank: h.rank,
                    is_major: h.is_major,
                    inverted: h.inverted,
                })
                .unwrap_or(melee::MeleeCard {
                    card_id: p.card_id,
                    suit: p.suit,
                    rank: p.rank,
                    is_major: p.is_major,
                    inverted: false,
                })
        })
        .collect();

    let Some(out) = melee::evaluate_trick(&cards, table.trump_suit, ladder, trick_no) else {
        return;
    };
    let winner_seat = plays[out.winner].seat_id;

    let credit = |seat_id: u64, counters: u16| {
        if counters == 0 {
            return;
        }
        if let Some(mut seat) = ctx.db.melee_seat().seat_id().find(&seat_id) {
            seat.counters = seat.counters.saturating_add(counters);
            ctx.db.melee_seat().seat_id().update(seat);
        }
    };
    credit(winner_seat, out.counters);
    let excuse_seat = out.excuse.map(|i| plays[i].seat_id);
    if let Some(e) = excuse_seat {
        credit(e, out.excuse_counters);
    }

    ctx.db.melee_trick().insert(MeleeTrick {
        trick_id: 0,
        table_id: table.table_id,
        trick_number: trick_no,
        leader_seat,
        led_suit: (!cards[0].is_major).then_some(cards[0].suit),
        winner_seat,
        counters: out.counters,
        excuse_seat,
        resolved_at: ctx.timestamp,
    });
}

/// Settle a refereed table: score every seat from the counters it actually
/// harvested, move zone control, and close the row. No feeder report involved.
fn melee_settle(ctx: &ReducerContext, table_id: u64) {
    let Some(mut table) = ctx.db.melee_table().table_id().find(&table_id) else {
        return;
    };
    if table.state == MeleeState::Resolved {
        return;
    }
    let mut seats = melee_seats(ctx, table_id);
    let mut scores: Vec<u16> = Vec::with_capacity(seats.len());
    for seat in seats.iter_mut() {
        // The climax ten is already banked inside the last trick's counters, so
        // `took_final_trick` is false here — passing it again would pay it twice.
        seat.score = seat_score(seat.counters, seat.melds_value, false);
        scores.push(seat.score);
        ctx.db.melee_seat().seat_id().update(seat.clone());
    }

    for (seat, delta) in seats.iter().zip(melee_control_deltas(&scores, ZONE_SWING)) {
        if delta != 0 {
            apply_control(ctx, table.zone_id, seat.faction, delta);
        }
    }

    table.state = MeleeState::Resolved;
    table.resolved_at = Some(ctx.timestamp);
    ctx.db.melee_table().table_id().update(table);
}

/// Drive a table forward: play every autonomous seat that is on turn, close each
/// trick as it fills, and settle at twelve. Stops the moment a human is on turn —
/// unless that human has sat past `MELEE_TURN_GRACE_SECS`, in which case the
/// module plays their weakest legal card so the table cannot deadlock.
///
/// Returns how many cards it played. A pure state-machine advance: it takes no
/// input, so calling it twice is harmless and calling it from anywhere is safe.
fn melee_advance(ctx: &ReducerContext, table_id: u64) -> usize {
    let mut played = 0usize;
    for _ in 0..MELEE_MAX_STEPS {
        let Some(table) = ctx.db.melee_table().table_id().find(&table_id) else {
            break;
        };
        if table.state == MeleeState::Resolved {
            break;
        }
        let ladder = melee::ladder_from_json(&table.ladder_raw);
        let seats = melee_seats(ctx, table_id);
        if seats.is_empty() {
            break;
        }
        let (trick_no, trick_plays) = melee_open_trick(ctx, table_id);
        if trick_no > melee::TOTAL_TRICKS {
            melee_settle(ctx, table_id);
            break;
        }
        let leader = melee_leader(ctx, table_id, &seats, trick_no);

        match melee_turn(ctx, &seats, leader, &trick_plays) {
            // The trick is full — close it and loop round for the next one.
            None => {
                if trick_plays.is_empty() {
                    // No seat holds a card and none has played: there is nothing
                    // left to referee. Settle rather than break, or the row sits
                    // Seated forever and `zone_ran_melee` keeps skipping the zone.
                    melee_settle(ctx, table_id);
                    break;
                }
                melee_close_trick(ctx, &table, trick_no, leader, &trick_plays, &ladder);
                if trick_no >= melee::TOTAL_TRICKS {
                    melee_settle(ctx, table_id);
                    break;
                }
            }
            Some(seat_id) => {
                let Some(seat) = seats.iter().find(|s| s.seat_id == seat_id) else { break };
                // A human keeps their turn until the grace window closes.
                if seat.is_human {
                    let since = trick_plays
                        .last()
                        .map(|p| p.played_at)
                        .unwrap_or(table.opened_at);
                    let waited = ctx
                        .timestamp
                        .duration_since(since)
                        .map(|d| d.as_secs() as i64)
                        .unwrap_or(0);
                    if waited < MELEE_TURN_GRACE_SECS {
                        break;
                    }
                }
                let hand = melee_hand_of(ctx, seat_id);
                if hand.is_empty() {
                    break;
                }
                let cards = melee_trick_cards(&trick_plays);
                // A timed-out human sheds their cheapest legal card; an agent
                // plays its faction's doctrine.
                let pick = if seat.is_human {
                    melee::guardian_pick(&hand, &cards, table.trump_suit, &ladder)
                } else {
                    melee::archetype_pick(
                        seat.faction,
                        &hand,
                        &cards,
                        table.trump_suit,
                        &ladder,
                        trick_no,
                    )
                };
                let Some(i) = pick else { break };
                melee_commit_play(ctx, table_id, seat_id, trick_no, &hand[i]);
                played += 1;
            }
        }
    }
    played
}

/// Nudge a table forward. Callable by anyone: it accepts no game input and can
/// only apply the module's own rules, so a spectator's client keeping the war
/// moving is a feature, not a hole.
#[reducer]
pub fn advance_melee(ctx: &ReducerContext, table_id: u64) -> Result<(), String> {
    if ctx.db.melee_table().table_id().find(&table_id).is_none() {
        return Err("advance_melee: table not found".into());
    }
    melee_advance(ctx, table_id);
    Ok(())
}

/// Open a round at one zone and seat its champions. Owner-gated: the feeder.
///
/// A human already queued for this zone takes their faction's seat, displacing the
/// agent champion — who is benched, not beaten, and is charged no rest.
#[reducer]
pub fn open_melee_round(
    ctx: &ReducerContext,
    zone_id: u8,
    round_index: u64,
    ladder_raw: String,
    seats: Vec<SeatSpec>,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("open_melee_round: admin only".into());
    }
    if zone_id > 10 {
        return Err("open_melee_round: zone_id must be 0..=10".into());
    }
    // 2..6 seats. Below two the caller should have seated the Zone Guardian; above
    // six it should have dropped the lowest claims before calling.
    if seats.len() < 2 || seats.len() > 6 {
        return Err(format!("open_melee_round: seat_count {} outside 2..=6", seats.len()));
    }
    // One seat per faction — the invariant the whole champion system rests on.
    for (i, a) in seats.iter().enumerate() {
        if seats.iter().skip(i + 1).any(|b| b.faction == a.faction) {
            return Err(format!("open_melee_round: {:?} seated twice", a.faction));
        }
    }

    // The module freezes its OWN ladder from its OWN ephemeris. The caller's
    // `ladder_raw` is a fallback for a cold database with no sky yet — a feeder
    // must not be able to decide what the Majors are worth this round.
    let sky = melee_sky(ctx);
    let ladder = if sky.is_empty() {
        melee::ladder_from_json(&ladder_raw)
    } else {
        melee::build_arcana_ladder(&sky, None)
    };
    let trump_suit = chart::sign_element(zone_id % 12);

    // Seat in ascending ecliptic longitude, so `seat_id` order IS turn order and
    // nothing downstream has to trust the caller's ordering.
    let lon = melee_longitudes(ctx);
    let order = melee::seat_order(&seats.iter().map(|s| s.faction).collect::<Vec<_>>(), &lon);
    let mut seats: Vec<SeatSpec> = order
        .iter()
        .filter_map(|f| seats.iter().find(|s| s.faction == *f).cloned())
        .collect();

    let table = ctx.db.melee_table().insert(MeleeTable {
        table_id: 0,
        zone_id,
        round_index,
        trump_suit,
        state: MeleeState::Seated,
        seat_count: seats.len() as u8,
        ladder_raw: melee::ladder_to_json(&ladder),
        opened_at: ctx.timestamp,
        resolved_at: None,
    });

    for spec in seats.drain(..) {
        // A queued human of this faction claims the seat at the deal.
        let claimant = ctx
            .db
            .melee_queue()
            .zone_id()
            .filter(&zone_id)
            .find(|q| q.faction == spec.faction);
        let (occupant, is_human) = match claimant {
            Some(q) => {
                ctx.db.melee_queue().identity().delete(&q.identity);
                (q.identity, true)
            }
            None => (spec.occupant, false),
        };
        // Deal the twelve on chain, from a seed that replays: same table, same
        // seat, same round → same hand, in Rust or in the browser.
        let pool = melee_deal_pool(ctx, occupant);
        let mut rng = melee::Rng::new(
            table
                .table_id
                .wrapping_mul(0x9E37_79B9)
                .wrapping_add(round_index)
                .wrapping_add(spec.faction.idx() as u64),
        );
        let hand = melee::deal_hand(&pool, &mut rng);
        let melds = melee::detect_melds(&hand, trump_suit, &ladder);

        let seat = ctx.db.melee_seat().insert(MeleeSeat {
            seat_id: 0,
            table_id: table.table_id,
            occupant,
            faction: spec.faction,
            is_human,
            claim: spec.claim,
            counters: 0,
            melds_value: melds,
            score: 0,
        });
        for c in &hand {
            ctx.db.melee_hand().insert(MeleeHand {
                hand_id: 0,
                table_id: table.table_id,
                seat_id: seat.seat_id,
                card_id: c.card_id,
                suit: c.suit,
                rank: c.rank,
                is_major: c.is_major,
                inverted: c.inverted,
                played: false,
            });
        }
        // Only the agent that actually plays is charged rest. A benched champion
        // keeps its claim for the next muster.
        if !is_human && ctx.db.agent_chart().identity().find(&occupant).is_some() {
            let rest = AgentRest { identity: occupant, rested_at_round: round_index };
            if ctx.db.agent_rest().identity().find(&occupant).is_some() {
                ctx.db.agent_rest().identity().update(rest);
            } else {
                ctx.db.agent_rest().insert(rest);
            }
        }
    }

    // Play it. An all-agent table runs to settlement inside this call; a table
    // with a human stops the moment that human is on turn.
    melee_advance(ctx, table.table_id);
    Ok(())
}

/// Settle a played table: score each seat, move zone control, close the row.
/// Owner-gated: the feeder.
#[reducer]
pub fn submit_melee_result(
    ctx: &ReducerContext,
    table_id: u64,
    results: Vec<SeatResult>,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("submit_melee_result: admin only".into());
    }
    let mut table = ctx
        .db
        .melee_table()
        .table_id()
        .find(&table_id)
        .ok_or("submit_melee_result: no such table")?;
    // The module now referees its own tables (`melee_advance` → `melee_settle`),
    // so a feeder report for a table that already played out on chain is stale,
    // not hostile. Accept it as a no-op rather than erroring, and keep the hard
    // refusal for a genuine double-submit of a table the module never played.
    let refereed = ctx.db.melee_trick().table_id().filter(&table_id).count() > 0;
    if refereed {
        return Ok(());
    }
    if table.state == MeleeState::Resolved {
        return Err("submit_melee_result: table already resolved".into());
    }
    // Exactly one seat takes the final trick.
    if results.iter().filter(|r| r.took_final_trick).count() > 1 {
        return Err("submit_melee_result: more than one seat took the final trick".into());
    }

    let mut seats: Vec<MeleeSeat> = ctx.db.melee_seat().table_id().filter(&table_id).collect();
    seats.sort_by_key(|s| s.seat_id);

    // Score every seat HERE, from counters + melds + climax. The feeder reports the
    // components; the module owns the arithmetic.
    let mut scores: Vec<u16> = Vec::with_capacity(seats.len());
    for seat in seats.iter_mut() {
        let r = results.iter().find(|r| r.seat_id == seat.seat_id);
        let (counters, melds, final_trick) =
            r.map(|r| (r.counters, r.melds_value, r.took_final_trick)).unwrap_or((0, 0, false));
        seat.counters = counters;
        seat.melds_value = melds;
        seat.score = seat_score(counters, melds, final_trick);
        scores.push(seat.score);
        ctx.db.melee_seat().seat_id().update(seat.clone());
    }

    // Bounded, zero-sum control. `apply_control` then layers flux ×2.5 and AR on top.
    for (seat, delta) in seats.iter().zip(melee_control_deltas(&scores, ZONE_SWING)) {
        if delta != 0 {
            apply_control(ctx, table.zone_id, seat.faction, delta);
        }
    }

    table.state = MeleeState::Resolved;
    table.resolved_at = Some(ctx.timestamp);
    ctx.db.melee_table().table_id().update(table);
    Ok(())
}

/// Play a card from your dealt hand into the live trick. Player-callable.
///
/// Every check that matters is against `melee_hand` — the twelve the module dealt
/// this seat — not against the sender's collection. Before hands lived on chain
/// this reducer could only ask "do you own this card?", so a player could spend
/// anything they held, in any order, as often as the play count allowed. Now the
/// card must be in the hand, unspent, on this seat's turn, and legal under the
/// same `legal_mask` the agent seats obey.
///
/// A play that fills the trick closes it here, and a play that fills trick twelve
/// settles the table here. The client never has to ask for either.
#[reducer]
pub fn play_melee_card(
    ctx: &ReducerContext,
    table_id: u64,
    card_id: u64,
    trick_number: u8,
) -> Result<(), String> {
    let table = ctx
        .db
        .melee_table()
        .table_id()
        .find(&table_id)
        .ok_or("play_melee_card: table not found")?;
    if table.state == MeleeState::Resolved {
        return Err("play_melee_card: table already resolved".into());
    }

    let seats = melee_seats(ctx, table_id);
    let seat = seats
        .iter()
        .find(|s| s.occupant == ctx.sender() && s.is_human)
        .ok_or("play_melee_card: sender is not a seated human player at this table")?;

    let (expected_trick, trick_plays) = melee_open_trick(ctx, table_id);
    if expected_trick > melee::TOTAL_TRICKS {
        return Err("play_melee_card: all twelve tricks are played".into());
    }
    if trick_number != expected_trick {
        return Err(format!(
            "play_melee_card: invalid trick_number {trick_number}, expected {expected_trick}"
        ));
    }

    let leader = melee_leader(ctx, table_id, &seats, expected_trick);
    match melee_turn(ctx, &seats, leader, &trick_plays) {
        Some(on_turn) if on_turn == seat.seat_id => {}
        Some(_) => return Err("play_melee_card: not your turn".into()),
        None => return Err("play_melee_card: the trick is already full".into()),
    }

    // The hand is the authority: in it, and not yet spent.
    let hand = melee_hand_of(ctx, seat.seat_id);
    let card = hand
        .iter()
        .find(|c| c.card_id == card_id)
        .copied()
        .ok_or("play_melee_card: that card is not in your dealt hand")?;

    let ladder = melee::ladder_from_json(&table.ladder_raw);
    let on_table = melee_trick_cards(&trick_plays);
    if !melee::is_legal_play(&hand, card_id, &on_table, table.trump_suit, &ladder) {
        return Err("play_melee_card: illegal play — follow suit, trump, or beat the winner".into());
    }

    melee_commit_play(ctx, table_id, seat.seat_id, expected_trick, &card);

    // Close the trick if that filled it, then let the agent seats answer.
    let (_, filled) = melee_open_trick(ctx, table_id);
    if melee_turn(ctx, &seats, leader, &filled).is_none() {
        melee_close_trick(ctx, &table, expected_trick, leader, &filled, &ladder);
        if expected_trick >= melee::TOTAL_TRICKS {
            melee_settle(ctx, table_id);
            return Ok(());
        }
    }
    melee_advance(ctx, table_id);
    Ok(())
}

/// Record a card play at a War Table. Owner-gated (the feeder referee).
#[reducer]
pub fn record_melee_play(
    ctx: &ReducerContext,
    table_id: u64,
    trick_number: u8,
    seat_id: u64,
    card_id: u64,
    is_major: bool,
    rank: u8,
    suit: Suit,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("record_melee_play: admin only".into());
    }
    ctx.db.melee_play().insert(MeleePlay {
        play_id: 0,
        table_id,
        trick_number,
        seat_id,
        card_id,
        is_major,
        rank,
        suit,
        played_at: ctx.timestamp,
    });
    Ok(())
}

/// Queue for your faction's seat at a zone. Player-callable.
///
/// This is where `can_access_zone` meets a human: a faction that holds no adjacent
/// House cannot reach a Spire, and the refusal says so rather than failing silently.
#[reducer]
pub fn join_melee_queue(ctx: &ReducerContext, zone_id: u8) -> Result<(), String> {
    if zone_id > 10 {
        return Err("join_melee_queue: zone_id must be 0..=10".into());
    }
    let player = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or("join_melee_queue: register a Seeker first")?;

    if !can_access_zone(ctx, player.faction, zone_id) {
        return Err(if zone_id == 10 {
            "The Crown is sealed to your faction — hold two Spires first.".into()
        } else {
            format!(
                "Spire {} is out of reach — {:?} must hold an adjacent House first.",
                zone_id - 5,
                player.faction
            )
        });
    }
    // Already seated somewhere this round? Then there is nothing to queue for.
    if ctx.db.melee_seat().occupant().filter(&ctx.sender()).next().is_some() {
        return Err("join_melee_queue: you are already seated at a table".into());
    }

    let row = MeleeQueue {
        identity: ctx.sender(),
        zone_id,
        faction: player.faction,
        queued_at: ctx.timestamp,
    };
    // One queue slot per player: re-queueing moves you rather than stacking.
    if ctx.db.melee_queue().identity().find(&ctx.sender()).is_some() {
        ctx.db.melee_queue().identity().update(row);
    } else {
        ctx.db.melee_queue().insert(row);
    }
    Ok(())
}

/// Leave the queue. Player-callable, idempotent.
#[reducer]
pub fn leave_melee_queue(ctx: &ReducerContext) -> Result<(), String> {
    ctx.db.melee_queue().identity().delete(&ctx.sender());
    Ok(())
}

fn compute_ecliptic(ra_deg: f64, dec_deg: f64) -> (&'static str, u8, u8, u8) {
    let ra_rad = ra_deg.to_radians();
    let dec_rad = dec_deg.to_radians();
    let eps_rad = 23.4392911f64.to_radians();

    let sin_dec = dec_rad.sin();
    let cos_dec = dec_rad.cos();
    let sin_eps = eps_rad.sin();
    let cos_eps = eps_rad.cos();
    let sin_ra = ra_rad.sin();
    let cos_ra = ra_rad.cos();

    let y = sin_ra * cos_eps + (sin_dec / cos_dec.max(0.000001)) * sin_eps;
    let x = cos_ra;
    let mut lambda_deg = y.atan2(x).to_degrees();
    if lambda_deg < 0.0 {
        lambda_deg += 360.0;
    }

    let signs = [
        "Aries", "Taurus", "Gemini", "Cancer",
        "Leo", "Virgo", "Libra", "Scorpio",
        "Sagittarius", "Capricorn", "Aquarius", "Pisces"
    ];

    let sign_idx = ((lambda_deg / 30.0).floor() as usize) % 12;
    let sign_name = signs[sign_idx];

    let rem_deg = lambda_deg % 30.0;
    let deg = rem_deg.floor() as u8;
    let rem_min = (rem_deg - (deg as f64)) * 60.0;
    let min = rem_min.floor() as u8;
    let sec = (((rem_min - (min as f64)) * 60.0).round() as u8).min(59);

    (sign_name, deg, min, sec)
}

fn expand_constellation(code: &str) -> String {
    match code.trim() {
        "And" => "Andromeda", "Ant" => "Antlia", "Aps" => "Apus", "Aql" => "Aquila",
        "Aqr" => "Aquarius", "Ara" => "Ara", "Ari" => "Aries", "Aur" => "Auriga",
        "Boo" => "Boötes", "Cae" => "Caelum", "Cam" => "Camelopardalis", "Cap" => "Capricornus",
        "Car" => "Carina", "Cas" => "Cassiopeia", "Cen" => "Centaurus", "Cep" => "Cepheus",
        "Cet" => "Cetus", "Cha" => "Chamaeleon", "Cir" => "Circinus", "CMa" => "Canis Major",
        "CMi" => "Canis Minor", "Cnc" => "Cancer", "Col" => "Columba", "Com" => "Coma Berenices",
        "CrA" => "Corona Australis", "Boreal" => "Corona Borealis", "Crv" => "Corvus", "Crt" => "Crater",
        "Cru" => "Crux", "CVn" => "Canes Venatici", "Cyg" => "Cygnus", "Del" => "Delphinus",
        "Dor" => "Dorado", "Dra" => "Draco", "Equ" => "Equuleus", "Eri" => "Eridanus",
        "For" => "Fornax", "Gem" => "Gemini", "Gru" => "Grus", "Her" => "Hercules",
        "Hor" => "Horologium", "Hya" => "Hydra", "Hyi" => "Hydrus", "Ind" => "Indus",
        "Lac" => "Lacerta", "Leo" => "Leo", "LMi" => "Leo Minor", "Lep" => "Lepus",
        "Lib" => "Libra", "Lup" => "Lupus", "Lyn" => "Lynx", "Lyr" => "Lyra",
        "Men" => "Mensa", "Mic" => "Microscopium", "Mon" => "Monoceros", "Mus" => "Musca",
        "Nor" => "Norma", "Oct" => "Octans", "Ophiuchus" => "Ophiuchus", "Oph" => "Ophiuchus",
        "Ori" => "Orion", "Pav" => "Pavo", "Peg" => "Pegasus", "Per" => "Perseus",
        "Phe" => "Phoenix", "Pic" => "Pictor", "Psc" => "Pisces", "PsA" => "Piscis Austrinus",
        "Pup" => "Puppis", "Pyx" => "Pyxis", "Ret" => "Reticulum", "Scl" => "Sculptor",
        "Sco" => "Scorpius", "Sct" => "Scutum", "Ser" => "Serpens", "Sex" => "Sextans",
        "Tau" => "Taurus", "Tel" => "Telescopium", "Tri" => "Triangulum", "TrA" => "Triangulum Australe",
        "Tuc" => "Tucana", "UMa" => "Ursa Major", "UMi" => "Ursa Minor", "Vel" => "Vela",
        "Vir" => "Virgo", "Vol" => "Volans", "Vul" => "Vulpecula",
        _ => code,
    }.to_string()
}

/// Seed a slice of the embedded star catalogue (`catalog::STARS`, the full
/// naked-eye sky to magnitude 6.5, sorted brightest-first) into `star_node`.
fn seed_star_batch(ctx: &ReducerContext, start: usize, count: usize) -> u32 {
    let end = (start + count).min(catalog::STARS.len());
    if start >= end {
        return catalog::STARS.len() as u32;
    }
    let gmst = gmst_deg(ctx.timestamp);
    for &(hip_id, name, ra, dec, magnitude, con_abbrev) in &catalog::STARS[start..end] {
        if ctx.db.star_node().hip_id().find(&hip_id).is_none() {
            let (z_sign, z_deg, z_min, z_sec) = compute_ecliptic(ra, dec);
            let con_name = expand_constellation(con_abbrev);
            ctx.db.star_node().insert(StarNode {
                hip_id,
                name: name.to_string(),
                ra,
                dec,
                magnitude,
                constellation: con_name,
                zodiac_sign: z_sign.to_string(),
                ecliptic_deg: z_deg,
                ecliptic_min: z_min,
                ecliptic_sec: z_sec,
                refracted_alt: 0.0,
                azimuth: 0.0,
                horizon_state: "BELOW_HORIZON".to_string(),
                held_by: None,
                region_hint: zone_for_lon(gmst - ra),
            });
        }
    }
    if end == catalog::STARS.len() {
        log::info!("star catalogue fully seeded: {} stars", end);
    }
    end as u32
}

fn normalized_evm_tx_hash(raw: &str, field: &str) -> Result<String, String> {
    let hash = raw.trim().to_ascii_lowercase();
    if hash.len() != 66
        || !hash.starts_with("0x")
        || !hash[2..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(format!("{field} must be a 0x-prefixed 32-byte transaction hash"));
    }
    Ok(hash)
}

fn normalized_solana_signature(raw: &str, field: &str) -> Result<String, String> {
    let signature = raw.trim();
    if !(64..=88).contains(&signature.len())
        || !signature.bytes().all(|b| {
            matches!(b, b'1'..=b'9' | b'A'..=b'H' | b'J'..=b'N' | b'P'..=b'Z' | b'a'..=b'k' | b'm'..=b'z')
        })
    {
        return Err(format!("{field} must be a base58 Solana transaction signature"));
    }
    Ok(signature.to_string())
}

/// Scope a transaction hash to the chain it settled on.
///
/// `processed_tx` is keyed on `tx_hash` alone, which was safe only while a
/// single Solana cluster existed. A base58 signature is valid on devnet and
/// mainnet alike, so once both are live an unscoped key lets a devnet
/// transaction permanently block the mainnet one that happens to collide — and,
/// worse, lets a devnet replay be mistaken for a settled mainnet transfer.
///
/// The key is composed rather than the column being re-keyed because
/// SpacetimeDB 2.x cannot change a primary key in a compatible update.
fn processed_key(chain: &str, hash: &str) -> String {
    format!("{chain}:{hash}")
}

/// Reject a transaction that has already been processed on this chain.
///
/// Both the scoped key and the bare hash are checked. The bare lookup covers
/// rows written before scoping existed: those are all devnet, and dropping the
/// check would silently reopen every one of them to replay.
fn ensure_unprocessed(ctx: &ReducerContext, chain: &str, hash: &str) -> Result<(), String> {
    let scoped = processed_key(chain, hash);
    if ctx.db.processed_tx().tx_hash().find(scoped).is_some()
        || ctx
            .db
            .processed_tx()
            .tx_hash()
            .find(hash.to_string())
            .is_some()
    {
        return Err("Transaction already processed".into());
    }
    Ok(())
}

fn record_processed(ctx: &ReducerContext, hash: String, chain: &str, event_type: &str) {
    ctx.db.processed_tx().insert(ProcessedTx {
        tx_hash: processed_key(chain, &hash),
        chain: chain.to_string(),
        event_type: event_type.to_string(),
        processed_at: ctx.timestamp,
    });
}

fn ensure_horizon_action_unspent(
    ctx: &ReducerContext,
    intent_id: u64,
    action: &str,
) -> Result<String, String> {
    let key = format!("{intent_id}:{action}");
    if ctx
        .db
        .horizon_action_receipt()
        .action_key()
        .find(&key)
        .is_some()
    {
        return Err("Horizon attestation action already consumed".into());
    }
    Ok(key)
}

fn record_horizon_action(
    ctx: &ReducerContext,
    action_key: String,
    intent_id: u64,
    tx_hash: String,
) {
    ctx.db
        .horizon_action_receipt()
        .insert(HorizonActionReceipt {
            action_key,
            intent_id,
            tx_hash,
            processed_at: ctx.timestamp,
        });
}

/// Bind a StarDex mutation to an unexpired, feeder-written EIP-712 horizon
/// attestation whose subject is the caller's bound EVM wallet.
fn verified_stardex_player(
    ctx: &ReducerContext,
    horizon_intent_id: u64,
    expected_constellation: Option<&str>,
) -> Result<Player, String> {
    let player = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "player profile not found".to_string())?;
    let bound_evm = player
        .evm_address
        .as_deref()
        .map(str::trim)
        .filter(|address| !address.is_empty())
        .ok_or_else(|| "No EVM address bound to player profile".to_string())?
        .to_ascii_lowercase();
    let verified_binding = ctx
        .db
        .verified_evm_wallet()
        .identity()
        .find(&ctx.sender())
        .filter(|binding| binding.evm_address.eq_ignore_ascii_case(&bound_evm))
        .ok_or_else(|| "EVM wallet ownership has not been verified".to_string())?;
    if verified_binding.proof_hash.is_empty() {
        return Err("EVM wallet ownership proof is invalid".into());
    }
    let intent = ctx
        .db
        .trace_intent()
        .intent_id()
        .find(&horizon_intent_id)
        .ok_or_else(|| "horizon trace intent not found".to_string())?;
    if intent.trader != ctx.sender() {
        return Err("horizon attestation belongs to a different player".into());
    }
    if intent.evm_address.trim().to_ascii_lowercase() != bound_evm {
        return Err("bound EVM address does not match the horizon attestation trader".into());
    }
    if !intent.attested {
        return Err("horizon trace has not been attested".into());
    }
    let attestation = ctx
        .db
        .trace_attestation()
        .intent_id()
        .find(&horizon_intent_id)
        .ok_or_else(|| "verified horizon attestation not found".to_string())?;
    if attestation.trader != ctx.sender() || attestation.constellation_id != intent.constellation_id {
        return Err("horizon attestation identity mismatch".into());
    }
    let signature = attestation.signature.trim();
    if signature.len() != 132
        || !signature.starts_with("0x")
        || !signature[2..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("horizon attestation has an invalid EIP-712 signature".into());
    }
    let now = (ctx.timestamp.to_micros_since_unix_epoch() / 1_000_000).max(0) as u64;
    if attestation.deadline < now {
        return Err("horizon attestation expired".into());
    }
    if let Some(name) = expected_constellation {
        let constellation = ctx
            .db
            .constellation()
            .iter()
            .find(|row| row.name.eq_ignore_ascii_case(name))
            .ok_or_else(|| format!("Constellation {name} not found in StarDex"))?;
        if constellation.constellation_id != intent.constellation_id {
            return Err("horizon attestation is for a different constellation".into());
        }
    }
    Ok(player)
}

/// Recomputes and updates observer horizon coordinates for all stars in SpacetimeDB.
#[spacetimedb::reducer]
pub fn sync_stardex_ephemeris(
    ctx: &ReducerContext,
    tx_hash: String,
    horizon_intent_id: u64,
    lat: f64,
    lon: f64,
    elev_m: f64,
) -> Result<(), String> {
    let hash = normalized_evm_tx_hash(&tx_hash, "tx_hash")?;
    ensure_unprocessed(ctx, "evm_base_sepolia", &hash)?;
    verified_stardex_player(ctx, horizon_intent_id, None)?;
    let action_key =
        ensure_horizon_action_unspent(ctx, horizon_intent_id, "sync_stardex_ephemeris")?;
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return Err("lat/lon out of range".into());
    }
    let gmst = gmst_deg(ctx.timestamp);
    let lst_deg = ((gmst + lon) % 360.0 + 360.0) % 360.0;
    let lat_rad = lat.to_radians();

    let dip_deg = 0.0293 * elev_m.max(0.0).sqrt();

    for mut star in ctx.db.star_node().iter() {
        let ha_deg = ((lst_deg - star.ra) % 360.0 + 360.0) % 360.0;
        let ha_rad = ha_deg.to_radians();
        let dec_rad = star.dec.to_radians();

        let sin_alt = dec_rad.sin() * lat_rad.sin() + dec_rad.cos() * lat_rad.cos() * ha_rad.cos();
        let true_alt_rad = sin_alt.max(-1.0).min(1.0).asin();
        let true_alt_deg = true_alt_rad.to_degrees();

        // Atmospheric refraction calculation
        let ref_arcmin = if true_alt_deg > -0.5 {
            1.02 / (true_alt_deg + 10.3 / (true_alt_deg + 5.11)).to_radians().tan()
        } else {
            0.0
        };
        let apparent_alt_deg = true_alt_deg + (ref_arcmin / 60.0) - dip_deg;

        let y = -ha_rad.sin();
        let x = dec_rad.cos() * lat_rad.sin() * ha_rad.cos() - dec_rad.sin() * lat_rad.cos();
        let mut az_deg = y.atan2(x).to_degrees();
        if az_deg < 0.0 {
            az_deg += 360.0;
        }

        let state_str = if apparent_alt_deg >= 0.0 && apparent_alt_deg <= 15.0 {
            "ON_HORIZON_BAND"
        } else if apparent_alt_deg > 15.0 {
            "ABOVE_HORIZON"
        } else {
            "BELOW_HORIZON"
        };

        star.refracted_alt = apparent_alt_deg as f32;
        star.azimuth = az_deg as f32;
        star.horizon_state = state_str.to_string();

        ctx.db.star_node().hip_id().update(star);
    }

    record_horizon_action(ctx, action_key, horizon_intent_id, hash.clone());
    record_processed(ctx, hash, "evm_base_sepolia", "sync_stardex_ephemeris");
    Ok(())
}

/// Allows a player to claim/siege a star node when it sits on the horizon band.
#[spacetimedb::reducer]
pub fn siege_horizon_star(ctx: &ReducerContext, star_id: u32) -> Result<(), String> {
    let player = ctx.db.player().identity().find(&ctx.sender()).ok_or("player not found")?;
    let mut star = ctx.db.star_node().hip_id().find(&star_id).ok_or("star not found")?;

    if star.horizon_state != "ON_HORIZON_BAND" && star.refracted_alt < 0.0 {
        return Err(format!("Star {} is not currently on the horizon encounter band", star.name));
    }

    star.held_by = Some(player.faction);
    ctx.db.star_node().hip_id().update(star);
    log::info!("Player {} ({:?}) conquered horizon star node {}", player.handle, player.faction, star_id);
    Ok(())
}

/// Claims bonus token rewards when a player's faction holds all stars in a constellation on the horizon.
#[spacetimedb::reducer]
pub fn stardex_claim_constellation(
    ctx: &ReducerContext,
    tx_hash: String,
    horizon_intent_id: u64,
    constellation_name: String,
) -> Result<(), String> {
    let hash = normalized_evm_tx_hash(&tx_hash, "tx_hash")?;
    ensure_unprocessed(ctx, "evm_base_sepolia", &hash)?;
    let mut player = verified_stardex_player(ctx, horizon_intent_id, Some(&constellation_name))?;
    let action_key = ensure_horizon_action_unspent(
        ctx,
        horizon_intent_id,
        &format!(
            "stardex_claim_constellation:{}",
            constellation_name.trim().to_ascii_lowercase()
        ),
    )?;
    let mut total_count = 0;
    let mut held_count = 0;

    for star in ctx.db.star_node().iter() {
        if star.constellation.eq_ignore_ascii_case(&constellation_name) {
            total_count += 1;
            if star.held_by == Some(player.faction) {
                held_count += 1;
            }
        }
    }

    if total_count == 0 {
        return Err(format!("Constellation {} not found in StarDex", constellation_name));
    }

    if held_count < total_count {
        return Err(format!("Faction {:?} holds {}/{} stars in {}", player.faction, held_count, total_count, constellation_name));
    }

    // Award bonus tokens
    let bonus = (total_count as u64) * 250;
    player.tokens += bonus;
    ctx.db.player().identity().update(player.clone());
    record_horizon_action(ctx, action_key, horizon_intent_id, hash.clone());
    record_processed(ctx, hash, "evm_base_sepolia", "stardex_claim_constellation");
    log::info!("Player {} claimed StarDex constellation bonus: +{} tokens for {}", player.handle, bonus, constellation_name);
    Ok(())
}

/// Fortifies a claimed StarDex node by increasing its capture weight.
#[spacetimedb::reducer]
pub fn stardex_fortify_node(
    ctx: &ReducerContext,
    tx_hash: String,
    horizon_intent_id: u64,
    star_id: u32,
    energy_amount: u32,
) -> Result<(), String> {
    let hash = normalized_evm_tx_hash(&tx_hash, "tx_hash")?;
    ensure_unprocessed(ctx, "evm_base_sepolia", &hash)?;
    let mut star = ctx.db.star_node().hip_id().find(&star_id).ok_or("star node not found")?;
    let player = verified_stardex_player(ctx, horizon_intent_id, Some(&star.constellation))?;
    let action_key = ensure_horizon_action_unspent(
        ctx,
        horizon_intent_id,
        &format!("stardex_fortify_node:{star_id}"),
    )?;

    if star.held_by != Some(player.faction) {
        return Err("Cannot fortify a star node held by an opposing faction".to_string());
    }
    if energy_amount == 0 {
        return Err("energy_amount must be greater than zero".into());
    }

    // Fortify node weight (make magnitude brighter/stronger for capture math)
    star.magnitude = (star.magnitude - (energy_amount as f32 * 0.05)).max(-2.0);
    ctx.db.star_node().hip_id().update(star);
    record_horizon_action(ctx, action_key, horizon_intent_id, hash.clone());
    record_processed(ctx, hash, "evm_base_sepolia", "stardex_fortify_node");
    log::info!("Player {} fortified StarDex node {} (+{} energy)", player.handle, star_id, energy_amount);
    Ok(())
}

/// Seed the constellation liquidity-pool catalogue (a small, frozen set of ~12
/// figures) from the generated `constellations::CONSTELLATIONS`. Idempotent — each
/// row is inserted only if absent — so it is safe to call on init and as an
/// upgrade backfill from `tick_sky`.
fn seed_constellations(ctx: &ReducerContext) {
    for c in crate::constellations::CONSTELLATIONS {
        if ctx.db.constellation().constellation_id().find(&c.id).is_some() {
            continue;
        }
        ctx.db.constellation().insert(Constellation {
            constellation_id: c.id,
            abbr: c.abbr.to_string(),
            name: c.name.to_string(),
            elem_a: c.elem_a,
            elem_b: c.elem_b,
            degenerate: c.degenerate,
            fee_bps: c.fee_bps,
            member_count: c.members.len() as u16,
            visible_threshold: c.visible_threshold,
        });
        for &hip in c.members {
            ctx.db.constellation_star().insert(ConstellationStar {
                id: 0,
                constellation_id: c.id,
                hip_id: hip,
            });
        }
        for &(a, b) in c.lines {
            ctx.db.constellation_line().insert(ConstellationLine {
                id: 0,
                constellation_id: c.id,
                hip_a: a,
                hip_b: b,
            });
        }
    }
    log::info!(
        "constellation pools seeded: {} figures",
        crate::constellations::CONSTELLATIONS.len()
    );
}

// ── Constellation liquidity pools (trace → attest → settle) ──────────────────

/// Trace a constellation to open/seed its pool. Hard horizon gate (the same one
/// `resolve_star_battle` uses for star strikes): the figure must be risen — at
/// least `visible_threshold` of its member stars above `MIN_ALT_DEG` over the
/// location you reported. On success this records a `trace_intent`; the attestor
/// service signs it and the client submits the on-chain `seedLiquidity`.
#[reducer]
pub fn trace_constellation(
    ctx: &ReducerContext,
    constellation_id: u16,
    evm_address: String,
) -> Result<(), String> {
    // The on-chain attestation is bound to this EVM wallet; the trader must submit
    // `seedLiquidity` from it (the AMM checks `att.trader == msg.sender`).
    // Authoritatively check the player's bound EVM address from their Player record first.
    let bound_evm = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender())
        .and_then(|p| p.evm_address);
    let evm = match bound_evm {
        Some(addr) if !addr.trim().is_empty() => addr.trim().to_lowercase(),
        _ => evm_address.trim().to_lowercase(),
    };
    if evm.len() != 42 || !evm.starts_with("0x") || !evm[2..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("evm_address must be a 0x-prefixed 20-byte hex address".into());
    }
    let loc = ctx
        .db
        .player_location()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "set your location first (set_location)".to_string())?;
    let con = ctx
        .db
        .constellation()
        .constellation_id()
        .find(&constellation_id)
        .ok_or_else(|| "no such constellation".to_string())?;

    let mut visible: u16 = 0;
    for cs in ctx
        .db
        .constellation_star()
        .constellation_id()
        .filter(&constellation_id)
    {
        if let Some(star) = ctx.db.star_node().hip_id().find(&cs.hip_id) {
            if altitude_deg(star.ra, star.dec, loc.lat, loc.lon, ctx.timestamp) >= MIN_ALT_DEG {
                visible += 1;
            }
        }
    }
    if visible < con.visible_threshold {
        return Err(format!(
            "{} is below your horizon ({}/{} stars risen) — trace it once it climbs",
            con.name, visible, con.visible_threshold
        ));
    }

    ctx.db.trace_intent().insert(TraceIntent {
        intent_id: 0,
        trader: ctx.sender(),
        evm_address: evm,
        constellation_id,
        visible_stars: visible,
        attested: false,
        created_at: ctx.timestamp,
    });
    Ok(())
}

/// Owner-gated: the attestor service closes a trace intent by recording the signed
/// EIP-712 VisibilityAttestation the client submits on-chain. Mirrors the
/// `answer_oracle` / `answer_duel` trusted-bridge pattern.
#[reducer]
pub fn answer_trace(
    ctx: &ReducerContext,
    intent_id: u64,
    region_commit: String,
    visible_stars: u8,
    nonce: u64,
    deadline: u64,
    signature: String,
) -> Result<(), String> {
    let cfg = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .ok_or_else(|| "not initialised".to_string())?;
    if ctx.sender() != cfg.owner {
        return Err("owner-only reducer".into());
    }
    let mut intent = ctx
        .db
        .trace_intent()
        .intent_id()
        .find(&intent_id)
        .ok_or_else(|| "no such trace intent".to_string())?;
    if intent.attested {
        return Err("trace already attested".into());
    }
    ctx.db.trace_attestation().insert(TraceAttestation {
        intent_id,
        trader: intent.trader,
        constellation_id: intent.constellation_id,
        region_commit,
        visible_stars,
        nonce,
        deadline,
        signature,
        created_at: ctx.timestamp,
    });
    intent.attested = true;
    ctx.db.trace_intent().intent_id().update(intent);
    Ok(())
}

/// Owner-gated reducer called by the companion worker to close a word duel challenge,
/// committing the agent's move, comparing scores, awarding tokens, and inserting the final WordDuel record.
#[reducer]
pub fn answer_duel(
    ctx: &ReducerContext,
    challenge_id: u64,
    agent_word: String,
    agent_rationale: String,
    agent_score: u32,
) -> Result<(), String> {
    let cfg = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .ok_or_else(|| "not initialised".to_string())?;
    if ctx.sender() != cfg.owner {
        return Err("owner-only reducer".into());
    }

    let mut challenge = ctx
        .db
        .duel_challenge()
        .challenge_id()
        .find(&challenge_id)
        .ok_or_else(|| "no such challenge".to_string())?;
    if challenge.answered {
        return Ok(()); // idempotent
    }

    let player = ctx
        .db
        .player()
        .identity()
        .find(&challenge.player)
        .ok_or_else(|| "no such player".to_string())?;

    challenge.answered = true;
    ctx.db.duel_challenge().challenge_id().update(challenge.clone());

    let won = challenge.player_score >= agent_score;
    let tokens = challenge.player_score as u64 * TOKEN_PER_POINT + if won { BEAT_AGENT_BONUS } else { 0 };

    let mut p = player;
    p.tokens = p.tokens.saturating_add(tokens);
    if won {
        p.word_wins += 1;
    }
    p.last_active = ctx.timestamp;
    ctx.db.player().identity().update(p);

    ctx.db.word_duel().insert(WordDuel {
        duel_id: 0,
        player: challenge.player,
        opponent: challenge.opponent,
        player_word: challenge.player_word,
        player_score: challenge.player_score,
        agent_word,
        agent_score,
        agent_rationale: Some(agent_rationale),
        won,
        tokens_awarded: tokens,
        created_at: ctx.timestamp,
    });

    let player_el = match challenge.opponent {
        Planet::Sun | Planet::Mars => 0,     // Fire
        Planet::Moon | Planet::Uranus | Planet::Neptune => 1, // Water
        Planet::Venus | Planet::Saturn | Planet::Pluto => 2,  // Earth
        Planet::Mercury | Planet::Jupiter => 3, // Air
    };
    let _ = record_round_play(ctx, challenge.player, player_el, challenge.player_score);
    let agent_identity = Identity::from_claims("pentacles:agent", &format!("{:?}", challenge.opponent).to_lowercase());
    let _ = record_round_play(ctx, agent_identity, player_el, agent_score);

    Ok(())
}

// ── Constellation resolution: "mint blocks by adding stars" ─────────────────

const STARS_PER_BLOCK: u16 = 1;

/// Add a real catalogue star to a constellation, raising its resolution and
/// minting a ConstellationBlock. Horizon-gated exactly like `trace_constellation`:
/// the star must be risen over the caller's reported location.
#[reducer]
pub fn add_star_to_constellation(
    ctx: &ReducerContext,
    constellation_id: u16,
    hip_id: u32,
) -> Result<(), String> {
    ctx.db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "register first".to_string())?;
    let loc = ctx
        .db
        .player_location()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "set your location first (set_location)".to_string())?;
    let mut con = ctx
        .db
        .constellation()
        .constellation_id()
        .find(&constellation_id)
        .ok_or_else(|| "no such constellation".to_string())?;
    let star = ctx
        .db
        .star_node()
        .hip_id()
        .find(&hip_id)
        .ok_or_else(|| "no such star (wait for it to seed)".to_string())?;

    let alt = altitude_deg(star.ra, star.dec, loc.lat, loc.lon, ctx.timestamp);
    if alt < MIN_ALT_DEG {
        return Err(format!(
            "{} is below your horizon ({alt:.0}°) — add a star that has risen",
            star.name
        ));
    }
    for cs in ctx
        .db
        .constellation_star()
        .constellation_id()
        .filter(&constellation_id)
    {
        if cs.hip_id == hip_id {
            return Err(format!("{} is already part of {}", star.name, con.name));
        }
    }

    let baseline = con.member_count;
    ctx.db.constellation_star().insert(ConstellationStar {
        id: 0,
        constellation_id,
        hip_id,
    });
    con.member_count = con.member_count.saturating_add(1);
    ctx.db.constellation().constellation_id().update(con.clone());

    let level = if let Some(mut r) = ctx
        .db
        .constellation_resolution()
        .constellation_id()
        .find(&constellation_id)
    {
        r.added_members = r.added_members.saturating_add(1);
        r.resolution_level = r.added_members / STARS_PER_BLOCK;
        r.updated_at = ctx.timestamp;
        let lvl = r.resolution_level;
        ctx.db.constellation_resolution().constellation_id().update(r);
        lvl
    } else {
        let lvl = 1 / STARS_PER_BLOCK;
        ctx.db.constellation_resolution().insert(ConstellationResolution {
            constellation_id,
            baseline_members: baseline,
            added_members: 1,
            resolution_level: lvl,
            updated_at: ctx.timestamp,
        });
        lvl
    };

    ctx.db.constellation_block().insert(ConstellationBlock {
        block_id: 0,
        constellation_id,
        minter: ctx.sender(),
        hip_id,
        level_after: level,
        onchain_block: None,
        created_at: ctx.timestamp,
    });
    Ok(())
}

// ── Star agents ──────────────────────────────────────────────────────────────

/// The bright catalogue stars promoted to agents. (hip, name, dominant ESMS id,
/// [fire,water,earth,air]% composition, flavour). ESMS ids: 0=Spirit/Fire,
/// 1=Essence/Water, 2=Matter/Earth, 3=Substance/Air.
const STAR_AGENTS: &[(u32, &str, u8, [u16; 4], &str)] = &[
    (32349, "Sirius", 1, [15, 55, 15, 15], "the brightest oracle — sharp, brilliant counsel"),
    (91262, "Vega", 3, [15, 15, 15, 55], "the harp-star — art, signal, clarity"),
    (11767, "Polaris", 2, [15, 15, 55, 15], "the fixed pole — constancy and direction"),
    (69673, "Arcturus", 0, [55, 15, 15, 15], "guardian of the Bear — bold momentum"),
    (24608, "Capella", 0, [55, 15, 15, 15], "the she-goat — nurture through fire"),
    (24436, "Rigel", 3, [15, 15, 15, 55], "Orion's blue foot — cold, far-seeing power"),
    (37279, "Procyon", 1, [15, 55, 15, 15], "herald before the Dog — swift intuition"),
    (27989, "Betelgeuse", 0, [55, 15, 15, 15], "the red shoulder — volatile, dramatic force"),
    (21421, "Aldebaran", 2, [15, 15, 55, 15], "the Bull's eye — steadfast, watchful"),
    (80763, "Antares", 0, [55, 15, 15, 15], "heart of the Scorpion — intense, transformative"),
    (65474, "Spica", 2, [15, 15, 55, 15], "the wheat-ear — fertile, exacting craft"),
    (49669, "Regulus", 0, [55, 15, 15, 15], "the little king — royal, commanding"),
    (97649, "Altair", 3, [15, 15, 15, 55], "the flying eagle — quick, decisive"),
    (102098, "Deneb", 3, [15, 15, 15, 55], "the Swan's tail — distant, luminous vision"),
];

/// Seed the comet registry. Chiron (2060 Chiron / 95P/Chiron) is the first comet
/// — classified as both a minor planet and a comet, it joins as its own kind.
/// Idempotent; safe on init and as an upgrade backfill from `tick_sky`.
fn seed_comets(ctx: &ReducerContext) {
    // (id, name, designation, element, [fire,water,earth,air], specialty, a, e, i, L, peri, node, L_rate)
    const COMETS: &[(u16, &str, &str, u8, [u16; 4], &str, f64, f64, f64, f64, f64, f64, f64)] = &[(
        0,
        "Chiron",
        "2060 Chiron · 95P/Chiron",
        1, // Essence/Water — the wounded-healer
        [15, 55, 15, 15],
        "the wounded healer — the bridge-comet between Saturn and Uranus",
        13.7088, 0.3816, 6.928, 217.10, 188.60, 209.40, 714.06,
    )];
    for &(id, name, desig, element, comp, specialty, a, e, i, l, peri, node, rate) in COMETS {
        if ctx.db.comet().comet_id().find(&id).is_some() {
            continue;
        }
        ctx.db.comet().insert(Comet {
            comet_id: id,
            name: name.to_string(),
            designation: desig.to_string(),
            element,
            composition: comp.to_vec(),
            specialty: specialty.to_string(),
            semi_major_au: a,
            eccentricity: e,
            inclination_deg: i,
            mean_long_deg: l,
            long_peri_deg: peri,
            long_node_deg: node,
            mean_long_rate: rate,
            active: true,
        });
    }
}

/// Seed the star-agent roster. Idempotent (insert-if-absent), so safe on init and
/// as an upgrade backfill from `tick_sky`.
fn seed_star_agents(ctx: &ReducerContext) {
    for &(hip, name, element, comp, specialty) in STAR_AGENTS {
        if ctx.db.star_agent().hip_id().find(&hip).is_some() {
            continue;
        }
        ctx.db.star_agent().insert(StarAgent {
            hip_id: hip,
            display_name: name.to_string(),
            element,
            composition: comp.to_vec(),
            specialty: specialty.to_string(),
            active: true,
        });
    }
}

// ── The Jing Arena (cast → counter → resolve) ───────────────────────────────

const JING_PRIMARY: u16 = 15; // Sacred-7 drain per cast (constants.ts)
const JING_SECONDARY: u16 = 10; // ESMS drain per cast
const JING_COOLDOWN_SECS: i64 = 6;

/// Lazily create the caller's Sacred-7 + ESMS pools.
fn ensure_jing_pool(ctx: &ReducerContext, who: Identity) -> JingPool {
    if let Some(p) = ctx.db.jing_pool().identity().find(&who) {
        return p;
    }
    let p = JingPool {
        identity: who,
        sacred7: vec![100, 100, 100, 100, 100, 100, 100],
        esms: vec![80, 80, 80, 80],
        updated_at: ctx.timestamp,
    };
    ctx.db.jing_pool().insert(p.clone());
    p
}

fn drain_pool(pool: &mut JingPool, mv: JingMove) -> Result<(), String> {
    let s = mv.sacred7();
    let e = mv.esms() as usize;
    if s >= pool.sacred7.len() || e >= pool.esms.len() {
        return Err("pool not ready".into());
    }
    if pool.sacred7[s] < JING_PRIMARY || pool.esms[e] < JING_SECONDARY {
        return Err("that pool is too depleted to cast this Jing".into());
    }
    pool.sacred7[s] -= JING_PRIMARY;
    pool.esms[e] -= JING_SECONDARY;
    Ok(())
}

/// Open a Jing duel: declare a move, pay its cost, target a player OR an agent.
#[reducer]
pub fn cast_jing(
    ctx: &ReducerContext,
    mv: JingMove,
    target_player: Option<Identity>,
    target_agent: Option<Planet>,
) -> Result<(), String> {
    ctx.db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "register first".to_string())?;
    if target_player.is_some() == target_agent.is_some() {
        return Err("cast at exactly one target (a player or an agent)".into());
    }
    if let Some(rate) = ctx.db.jing_rate().identity().find(&ctx.sender()) {
        if elapsed_secs(ctx.timestamp, rate.last_at) < JING_COOLDOWN_SECS {
            return Err("steady — your last Jing still echoes".into());
        }
        ctx.db.jing_rate().identity().update(JingRate {
            identity: ctx.sender(),
            last_at: ctx.timestamp,
            casts: rate.casts + 1,
        });
    } else {
        ctx.db.jing_rate().insert(JingRate {
            identity: ctx.sender(),
            last_at: ctx.timestamp,
            casts: 1,
        });
    }

    let mut pool = ensure_jing_pool(ctx, ctx.sender());
    drain_pool(&mut pool, mv)?;
    pool.updated_at = ctx.timestamp;
    ctx.db.jing_pool().identity().update(pool);

    let duel = ctx.db.jing_duel().insert(JingDuel {
        duel_id: 0,
        initiator: ctx.sender(),
        target_player,
        target_agent,
        opening_move: mv,
        state: JingState::Open,
        winner_is_initiator: None,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    ctx.db.jing_cast().insert(JingCast {
        cast_id: 0,
        duel_id: duel.duel_id,
        caster: ctx.sender(),
        caster_agent: None,
        mv,
        cost_sacred7: mv.sacred7() as u8,
        cost_esms: mv.esms(),
        deflects: None,
        voice: String::new(),
        created_at: ctx.timestamp,
    });
    Ok(())
}

/// The targeted player counters an open duel with a move that deflects the last
/// cast. A valid counter wins the thread.
#[reducer]
pub fn counter_jing(ctx: &ReducerContext, duel_id: u64, mv: JingMove) -> Result<(), String> {
    ctx.db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "register first".to_string())?;
    let mut duel = ctx
        .db
        .jing_duel()
        .duel_id()
        .find(&duel_id)
        .ok_or_else(|| "no such duel".to_string())?;
    if duel.state == JingState::Resolved {
        return Err("that duel is already resolved".into());
    }
    if duel.target_player != Some(ctx.sender()) {
        return Err("you are not the target of this duel".into());
    }
    let last = ctx
        .db
        .jing_cast()
        .duel_id()
        .filter(&duel_id)
        .max_by_key(|c| c.cast_id)
        .ok_or_else(|| "duel has no casts".to_string())?;
    if !last.mv.countered_by().contains(&mv) {
        return Err(format!("{:?} does not counter {:?}", mv, last.mv));
    }

    let mut pool = ensure_jing_pool(ctx, ctx.sender());
    drain_pool(&mut pool, mv)?;
    pool.updated_at = ctx.timestamp;
    ctx.db.jing_pool().identity().update(pool);

    ctx.db.jing_cast().insert(JingCast {
        cast_id: 0,
        duel_id,
        caster: ctx.sender(),
        caster_agent: None,
        mv,
        cost_sacred7: mv.sacred7() as u8,
        cost_esms: mv.esms(),
        deflects: Some(last.mv),
        voice: String::new(),
        created_at: ctx.timestamp,
    });
    duel.state = JingState::Resolved;
    duel.winner_is_initiator = Some(false); // the counter-er (target) prevails
    duel.updated_at = ctx.timestamp;
    ctx.db.jing_duel().duel_id().update(duel.clone());

    let _ = record_round_play(ctx, duel.initiator, duel.opening_move.esms(), 10);
    let _ = record_round_play(ctx, ctx.sender(), mv.esms(), 10);

    Ok(())
}

/// Owner-gated: the planetary-agents service answers an agent-targeted duel with
/// the agent's move + voice, resolving the thread (mirrors answer_oracle).
#[reducer]
pub fn answer_jing(
    ctx: &ReducerContext,
    duel_id: u64,
    agent_move: JingMove,
    voice: String,
) -> Result<(), String> {
    let cfg = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .ok_or_else(|| "not initialised".to_string())?;
    if ctx.sender() != cfg.owner {
        return Err("owner-only reducer".into());
    }
    let mut duel = ctx
        .db
        .jing_duel()
        .duel_id()
        .find(&duel_id)
        .ok_or_else(|| "no such duel".to_string())?;
    if duel.state == JingState::Resolved {
        return Ok(());
    }
    let opening = duel.opening_move;
    ctx.db.jing_cast().insert(JingCast {
        cast_id: 0,
        duel_id,
        caster: ctx.sender(), // the owner answers on the agent's behalf
        caster_agent: duel.target_agent,
        mv: agent_move,
        cost_sacred7: agent_move.sacred7() as u8,
        cost_esms: agent_move.esms(),
        deflects: Some(opening),
        voice,
        created_at: ctx.timestamp,
    });
    duel.winner_is_initiator = JingMove::resolve(opening, agent_move);
    duel.state = JingState::Resolved;
    duel.updated_at = ctx.timestamp;
    ctx.db.jing_duel().duel_id().update(duel.clone());

    let op_el = agent_move.esms(); // 0..3
    let _ = record_round_play(ctx, duel.initiator, duel.opening_move.esms(), 10);
    let agent_identity = Identity::from_claims("pentacles:agent", &format!("{:?}", duel.target_agent.unwrap()).to_lowercase());
    let _ = record_round_play(ctx, agent_identity, op_el, 10);

    Ok(())
}

// ── Star Staking Reducers ──────────────────────────────────────────────────

/// Mirror a confirmed on-chain `StarStaked` event into the ledger.
///
/// Owner-gated and keyed on the staking transaction. Previously any client
/// could call this with a principal of its choosing, and the accrual tick would
/// then pay yield on capital that was never deposited — the ledger simply
/// believed whatever the app said. Nothing minted from `accrued_essence` yet,
/// so no value was at risk on devnet, but wiring a mainnet claim feeder to that
/// number would have turned it directly into an unbounded mint.
///
/// The staker is resolved from the verified on-chain wallet rather than from
/// `ctx.sender()`, because the caller is now the feeder, not the staker.
#[reducer]
pub fn record_star_stake(
    ctx: &ReducerContext,
    chain: BridgeChain,
    tx_hash: String,
    staker_pubkey: String,
    star_id: u32,
    principal_usdc: u64,
    shares: u128,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("record_star_stake: admin/feeder only".into());
    }
    if !chain.is_solana() {
        return Err("record_star_stake: chain must be a Solana cluster".into());
    }
    if principal_usdc == 0 {
        return Err("principal_usdc must be greater than zero".into());
    }

    let hash = normalized_solana_signature(&tx_hash, "tx_hash")?;
    ensure_unprocessed(ctx, chain.chain_key(), &hash)?;

    let staker = ctx
        .db
        .player()
        .iter()
        .find(|row| row.solana_pubkey.as_deref() == Some(staker_pubkey.trim()))
        .ok_or_else(|| "no player bound to the staking wallet".to_string())?;
    if !ctx
        .db
        .verified_solana_wallet()
        .identity()
        .find(&staker.identity)
        .is_some_and(|binding| binding.solana_pubkey == staker_pubkey.trim())
    {
        return Err("staking wallet ownership has not been verified".into());
    }

    let star = ctx.db.star_node().hip_id().find(&star_id).ok_or("no such star")?;
    let element = esms_id_for_star(star.ra, star.dec);

    // upsert pool
    let mut pool = ctx.db.star_stake_pool().star_id().find(&star_id)
        .unwrap_or(StarStakePool { star_id, total_principal_usdc: 0, total_shares: 0 });
    pool.total_principal_usdc += principal_usdc;
    pool.total_shares += shares;
    if ctx.db.star_stake_pool().star_id().find(&star_id).is_some() {
        ctx.db.star_stake_pool().star_id().update(pool);
    } else {
        ctx.db.star_stake_pool().insert(pool);
    }

    ctx.db.star_stake().insert(StarStake {
        stake_id: 0,
        staker: staker.identity,
        star_id,
        element,
        principal_usdc,
        shares,
        accrued_essence: 0,
        claimed_essence: 0,
        pending_essence: 0,
        claim_nonce: 0,
        staked_at: ctx.timestamp,
        last_accrual_at: ctx.timestamp,
    });
    record_processed(ctx, hash, chain.chain_key(), "star_stake");
    Ok(())
}

// Called after a confirmed on-chain unstake. Removes shares/principal.
#[reducer]
pub fn record_star_unstake(ctx: &ReducerContext, stake_id: u64) -> Result<(), String> {
    let s = ctx.db.star_stake().stake_id().find(&stake_id).ok_or("no stake")?;
    if s.staker != ctx.sender() {
        return Err("not your stake".into());
    }
    if let Some(mut pool) = ctx.db.star_stake_pool().star_id().find(&s.star_id) {
        pool.total_principal_usdc = pool.total_principal_usdc.saturating_sub(s.principal_usdc);
        pool.total_shares = pool.total_shares.saturating_sub(s.shares);
        ctx.db.star_stake_pool().star_id().update(pool);
    }
    ctx.db.star_stake().stake_id().delete(&stake_id);
    Ok(())
}

/// Two-Phase Commit Phase 1: Lock accrued_essence into pending_essence and assign a claim_nonce.
/// Eliminates yield claim double-spend race conditions.
#[reducer]
pub fn request_yield_claim(
    ctx: &ReducerContext,
    stake_id: u64,
) -> Result<(), String> {
    let mut s = ctx.db.star_stake().stake_id().find(&stake_id).ok_or("no stake found")?;
    if s.staker != ctx.sender() {
        return Err("not your stake position".into());
    }
    if s.pending_essence > 0 {
        return Err("Yield claim already pending for this position".into());
    }
    if s.accrued_essence == 0 {
        return Err("No accrued essence available to claim".into());
    }

    let nonce = (stake_id << 16) | 1;
    s.pending_essence = s.accrued_essence;
    s.accrued_essence = 0;
    s.claim_nonce = nonce;

    ctx.db.star_stake().stake_id().update(s);
    Ok(())
}

/// Two-Phase Commit Phase 2: settle a locked claim against a confirmed on-chain
/// ESMS mint.
///
/// Owner-gated: this reducer is the ledger's record that value left the chain,
/// and it previously accepted any caller with any string for `tx_hash` —
/// including the literal placeholder the UI was sending. A claim could be
/// marked settled without a mint ever happening.
///
/// The hash is validated for shape and scoped to its cluster, so a devnet
/// signature cannot settle a mainnet claim.
#[reducer]
pub fn confirm_yield_claim(
    ctx: &ReducerContext,
    chain: BridgeChain,
    tx_hash: String,
    stake_id: u64,
    claim_nonce: u64,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("confirm_yield_claim: admin/feeder only".into());
    }
    if !chain.is_solana() {
        return Err("confirm_yield_claim: chain must be a Solana cluster".into());
    }

    let hash = normalized_solana_signature(&tx_hash, "tx_hash")?;
    ensure_unprocessed(ctx, chain.chain_key(), &hash)?;

    let mut s = ctx.db.star_stake().stake_id().find(&stake_id).ok_or("no stake found")?;
    if s.claim_nonce != claim_nonce || s.pending_essence == 0 {
        return Err("Claim nonce mismatch or no claim pending".into());
    }

    // The settled amount must be representable in the 4-decimal atoms the
    // Solana mint actually moved. Any sub-atom remainder stays credited as
    // accrued yield rather than being written off as claimed.
    let (_atoms, dust) = ledger_to_solana_atoms(s.pending_essence)?;
    let settled = s.pending_essence - dust;

    s.claimed_essence += settled;
    s.accrued_essence += dust;
    s.pending_essence = 0;
    s.claim_nonce = 0;

    record_processed(ctx, hash, chain.chain_key(), "claim_yield");
    ctx.db.star_stake().stake_id().update(s);
    Ok(())
}

/// How long a two-phase claim may stay locked before anyone may release it.
const YIELD_CLAIM_LOCK_SECS: i64 = 600;

/// Revert a pending claim back into accrued yield once its lock has expired.
///
/// Two gates the documented behaviour was missing entirely: the 10-minute
/// staleness window it claimed to enforce, and any caller restriction at all.
/// Without them, one player could cancel another's in-flight claim at the exact
/// moment the feeder was minting against it — releasing the pending balance
/// while the mint still landed, and paying the same yield twice.
#[reducer]
pub fn cancel_stale_claim(ctx: &ReducerContext, stake_id: u64) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    let mut s = ctx.db.star_stake().stake_id().find(&stake_id).ok_or("no stake found")?;
    if s.staker != ctx.sender() && ctx.sender() != cfg.owner {
        return Err("not your stake".into());
    }
    if s.pending_essence == 0 {
        return Ok(());
    }
    // The lock starts when the claim was requested; `last_accrual_at` is stamped
    // by the tick, so the request time is tracked by the accrual clock. The
    // owner may release immediately to unstick a failed settlement.
    if ctx.sender() != cfg.owner && elapsed_secs(ctx.timestamp, s.last_accrual_at) < YIELD_CLAIM_LOCK_SECS {
        return Err("claim is still within its settlement window".into());
    }
    s.accrued_essence += s.pending_essence;
    s.pending_essence = 0;
    s.claim_nonce = 0;
    ctx.db.star_stake().stake_id().update(s);
    Ok(())
}

// ── Star Staking Math Helpers ────────────────────────────────────────────────

const BASE_DAILY_RATE: f64 = 0.0006;
/// How stale a below-horizon stake's `last_accrual_at` may grow before the tick
/// touches it anyway. A set stake earns nothing, so stamping it every 10s was pure
/// subscription churn — this caps the idle rewrite rate at once per 10 minutes.
const IDLE_STAKE_TOUCH_SECS: i64 = 600;

fn ra_dec_to_ecliptic_longitude(ra: f64, dec: f64) -> f64 {
    let ra_deg = if ra.abs() <= 24.0 { ra * 15.0 } else { ra };
    let ra_rad = ra_deg.rem_euclid(360.0).to_radians();
    let dec_rad = dec.to_radians();
    let obliquity_rad = (23.43928_f64).to_radians();

    let lon_rad = (ra_rad.sin() * obliquity_rad.cos() + dec_rad.tan() * obliquity_rad.sin())
        .atan2(ra_rad.cos());
    lon_rad.to_degrees().rem_euclid(360.0)
}

fn esms_id_for_star(ra: f64, dec: f64) -> u8 {
    let longitude = ra_dec_to_ecliptic_longitude(ra, dec);
    let sign = (longitude / 30.0) as u8 % 12;
    match sign {
        0 | 4 | 8 => 0,  // Fire -> Spirit
        3 | 7 | 11 => 1, // Water -> Essence
        1 | 5 | 9 => 2,  // Earth -> Matter
        2 | 6 | 10 => 3, // Air -> Substance
        _ => 0,
    }
}

fn planet_has_element_affinity(planet: Planet, element: u8) -> bool {
    match planet {
        Planet::Sun => element == 0,
        Planet::Moon => element == 1,
        Planet::Mercury => element == 3 || element == 2,
        Planet::Venus => element == 1 || element == 2,
        Planet::Mars => element == 0 || element == 1,
        Planet::Jupiter => element == 3 || element == 0,
        Planet::Saturn => element == 3 || element == 2,
        Planet::Uranus => element == 1 || element == 3,
        Planet::Neptune => element == 1,
        Planet::Pluto => element == 2 || element == 1,
    }
}

fn planet_dignity_for_sign(planet: Planet, sign: u8) -> i8 {
    match planet {
        Planet::Sun => match sign {
            4 => 1,
            0 => 2,
            10 => -1,
            6 => -2,
            _ => 0,
        },
        Planet::Moon => match sign {
            3 => 1,
            1 => 2,
            9 => -1,
            7 => -2,
            _ => 0,
        },
        Planet::Mercury => match sign {
            2 => 1,
            5 => 3,
            8 => 1,
            11 => -3,
            _ => 0,
        },
        Planet::Venus => match sign {
            6 => 1,
            1 => 1,
            11 => 2,
            0 => -1,
            7 => -1,
            5 => -2,
            _ => 0,
        },
        Planet::Mars => match sign {
            0 => 1,
            7 => 1,
            9 => 2,
            1 => -1,
            6 => -1,
            3 => -2,
            _ => 0,
        },
        Planet::Jupiter => match sign {
            11 => 1,
            8 => 1,
            3 => 2,
            2 => -1,
            5 => -1,
            9 => -2,
            _ => 0,
        },
        Planet::Saturn => match sign {
            10 => 1,
            9 => 1,
            6 => 2,
            3 => -1,
            4 => -1,
            0 => -2,
            _ => 0,
        },
        Planet::Uranus => match sign {
            10 => 1,
            7 => 2,
            1 => -3,
            _ => 0,
        },
        Planet::Neptune => match sign {
            11 => 1,
            3 => 2,
            5 => -1,
            9 => -2,
            _ => 0,
        },
        Planet::Pluto => match sign {
            7 => 1,
            4 => 2,
            1 => -1,
            10 => -2,
            _ => 0,
        },
    }
}

fn zone_dominance_for(ctx: &ReducerContext, element: u8) -> f64 {
    let mut score = 0.0;
    let mut total = 0.0;
    for eph in ctx.db.ephemeris().iter() {
        let longitude = ra_dec_to_ecliptic_longitude(eph.ra, eph.dec);
        let sign = (longitude / 30.0) as u8 % 12;
        let sign_element = match sign {
            0 | 4 | 8 => 0,  // Fire
            3 | 7 | 11 => 1, // Water
            1 | 5 | 9 => 2,  // Earth
            2 | 6 | 10 => 3, // Air
            _ => 0,
        };
        let weight = 1.0;
        total += weight;
        if sign_element == element {
            score += weight;
        }
        if planet_has_element_affinity(eph.body, element) {
            score += weight * 0.5;
        }
    }
    if total > 0.0 {
        let share = score / total;
        let val: f64 = 0.5 + share * 1.5;
        val.clamp(0.5, 2.0)
    } else {
        1.0
    }
}

fn chart_affinity_for(chart: &NatalChart, element: u8) -> f64 {
    let mut element_scores = [0.0; 4];
    for p in &chart.placements {
        let el = match p.sign % 4 {
            0 => 0, // Fire
            1 => 2, // Earth
            2 => 3, // Air
            _ => 1, // Water
        };
        let weight = match p.body {
            Planet::Sun | Planet::Moon => 3.0,
            _ => 1.0,
        };
        element_scores[el as usize] += weight;
    }
    
    if chart.time_known {
        let asc_sign = ((chart.ascendant / 1800) % 12) as u8;
        let asc_el = match asc_sign % 4 {
            0 => 0,
            1 => 2,
            2 => 3,
            _ => 1,
        };
        element_scores[asc_el as usize] += 3.0;
    }

    let total_score: f64 = element_scores.iter().sum();
    let score = if total_score > 0.0 {
        element_scores[element as usize] / total_score * 100.0
    } else {
        25.0
    };

    let mut dominant_el = 0;
    for i in 1..4 {
        if element_scores[i] > element_scores[dominant_el] {
            dominant_el = i;
        }
    }

    let mut affinity = 0.75;
    if dominant_el == element as usize {
        affinity += 0.5;
    }
    affinity += (score / 100.0).clamp(0.0, 1.0) * 0.5;
    affinity += 0.25; // Monica constant 0.5 * 0.5

    affinity.clamp(0.5, 2.5)
}

fn planet_dignity_for_star(star_sign: u8, ctx: &ReducerContext) -> f64 {
    let mut bonus = 0;
    for eph in ctx.db.ephemeris().iter() {
        let longitude = ra_dec_to_ecliptic_longitude(eph.ra, eph.dec);
        let sign = (longitude / 30.0) as u8 % 12;
        if sign == star_sign {
            let dignity = planet_dignity_for_sign(eph.body, star_sign);
            bonus += dignity.abs() as i32;
        }
    }
    (1.0 + bonus as f64 * 0.1).clamp(1.0, 2.0)
}

/// The staker's daily ESMS rate per USDC. The ephemeris-derived factors are the
/// same for every stake in a tick, so `tick_sky` precomputes them once and passes
/// them in: `zone_dom` indexed by ESMS element (0..3), `sign_dignity` by the
/// star's zodiac sign (0..11). Only the chart affinity is per-staker.
fn daily_rate_per_usdc(
    ctx: &ReducerContext,
    stake: &StarStake,
    star: &StarNode,
    zone_dom: &[f64; 4],
    sign_dignity: &[f64; 12],
) -> f64 {
    let star_longitude = ra_dec_to_ecliptic_longitude(star.ra, star.dec);
    let star_sign = (star_longitude / 30.0) as usize % 12;
    let chart = match ctx.db.natal_chart().identity().find(&stake.staker) {
        Some(c) => c,
        None => return BASE_DAILY_RATE, // default rate if no natal chart found
    };
    let chart_affinity = chart_affinity_for(&chart, stake.element);
    // `element` is frozen at stake time from `esms_id_for_star` (always 0..3);
    // `.min(3)` just guards the table lookup.
    BASE_DAILY_RATE * zone_dom[(stake.element as usize).min(3)] * chart_affinity * sign_dignity[star_sign]
}

// ── Round Tracking & Yield Distribution Reducer Helpers ──────────────────────

fn record_round_play(
    ctx: &ReducerContext,
    identity: Identity,
    element: u8,
    weight: u32,
) -> Result<(), String> {
    let mut round = match ctx.db.duel_round().iter().next() {
        Some(r) => r,
        None => {
            let new_round = DuelRound {
                round_id: 1,
                plays_count: 0,
                target_plays: 3, // complete round every 3 plays
                created_at: ctx.timestamp,
            };
            ctx.db.duel_round().insert(new_round.clone());
            new_round
        }
    };

    ctx.db.round_participant().insert(RoundParticipant {
        id: 0,
        round_id: round.round_id,
        identity,
        element,
        weight,
    });

    round.plays_count += 1;

    if round.plays_count >= round.target_plays {
        let participants: Vec<RoundParticipant> = ctx.db.round_participant()
            .round_id()
            .filter(&round.round_id)
            .collect();

        let mut total_weight = [0u32; 4];
        for p in &participants {
            if p.element < 4 {
                total_weight[p.element as usize] += p.weight;
            }
        }

        const ELEMENT_POOL: u32 = 100;

        for p in &participants {
            if p.element >= 4 { continue; }
            let tw = total_weight[p.element as usize];
            if tw > 0 {
                let share = (p.weight as f64 / tw as f64 * ELEMENT_POOL as f64) as u16;
                if share > 0 {
                    let mut pool = match ctx.db.jing_pool().identity().find(&p.identity) {
                        Some(pl) => pl,
                        None => {
                            let new_pool = JingPool {
                                identity: p.identity,
                                sacred7: vec![100; 7],
                                esms: vec![0; 4],
                                updated_at: ctx.timestamp,
                            };
                            ctx.db.jing_pool().insert(new_pool.clone());
                            new_pool
                        }
                    };
                    
                    if pool.esms.len() < 4 {
                        pool.esms.resize(4, 0);
                    }
                    pool.esms[p.element as usize] = pool.esms[p.element as usize].saturating_add(share);
                    pool.updated_at = ctx.timestamp;
                    ctx.db.jing_pool().identity().update(pool);
                }
            }
        }

        for p in &participants {
            ctx.db.round_participant().id().delete(&p.id);
        }

        // Reset the singleton round in place. Do NOT bump round_id here — it is the
        // primary key, and the `update()` below targets the row by that key; bumping
        // it made the update hit a nonexistent row and panic (error 15) on every
        // round completion (i.e. every 3rd play). Participants of the finished round
        // were just deleted, so reusing the same round_id starts a clean round.
        round.plays_count = 0;
        round.created_at = ctx.timestamp;
    }

    ctx.db.duel_round().round_id().update(round);
    Ok(())
}

// ── Admin Agent Operations (System driving NPC agents) ──────────────────────

#[reducer]
pub fn admin_agent_record_star_stake(
    ctx: &ReducerContext,
    agent_key: String,
    star_id: u32,
    principal_usdc: u64,
    shares: u128,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("admin only".into());
    }
    let agent_identity = Identity::from_claims("pentacles:agent", &agent_key);
    
    let star = ctx.db.star_node().hip_id().find(&star_id).ok_or("no such star")?;
    let element = esms_id_for_star(star.ra, star.dec);
    
    // upsert pool
    let mut pool = ctx.db.star_stake_pool().star_id().find(&star_id)
        .unwrap_or(StarStakePool { star_id, total_principal_usdc: 0, total_shares: 0 });
    pool.total_principal_usdc += principal_usdc;
    pool.total_shares += shares;
    if ctx.db.star_stake_pool().star_id().find(&star_id).is_some() {
        ctx.db.star_stake_pool().star_id().update(pool);
    } else {
        ctx.db.star_stake_pool().insert(pool);
    }

    ctx.db.star_stake().insert(StarStake {
        stake_id: 0,
        staker: agent_identity,
        star_id,
        element,
        principal_usdc,
        shares,
        accrued_essence: 0,
        claimed_essence: 0,
        pending_essence: 0,
        claim_nonce: 0,
        staked_at: ctx.timestamp,
        last_accrual_at: ctx.timestamp,
    });
    Ok(())
}

#[reducer]
pub fn admin_agent_record_star_unstake(
    ctx: &ReducerContext,
    agent_key: String,
    stake_id: u64,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("admin only".into());
    }
    let agent_identity = Identity::from_claims("pentacles:agent", &agent_key);
    
    let s = ctx.db.star_stake().stake_id().find(&stake_id).ok_or("no stake")?;
    if s.staker != agent_identity {
        return Err("not agent's stake".into());
    }
    if let Some(mut pool) = ctx.db.star_stake_pool().star_id().find(&s.star_id) {
        pool.total_principal_usdc = pool.total_principal_usdc.saturating_sub(s.principal_usdc);
        pool.total_shares = pool.total_shares.saturating_sub(s.shares);
        ctx.db.star_stake_pool().star_id().update(pool);
    }
    ctx.db.star_stake().stake_id().delete(&stake_id);
    Ok(())
}

#[reducer]
pub fn admin_agent_resolve_star_battle(
    ctx: &ReducerContext,
    agent_key: String,
    hip_id: u32,
    log: BattleLog,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("admin only".into());
    }
    let agent_identity = Identity::from_claims("pentacles:agent", &agent_key);

    let player = ctx.db.player().identity().find(&agent_identity).ok_or("register agent first")?;
    let mut star = ctx.db.star_node().hip_id().find(&hip_id).ok_or("no such star")?;

    if !can_access_zone(ctx, player.faction, star.region_hint) {
        return Err("Zone is locked.".into());
    }
    if log.model != CombatModel::AutoSiege {
        return Err("star strikes use Auto-Siege".into());
    }

    let mut attacker: Vec<combat::CardStat> = Vec::new();
    for cid in &log.plays {
        let c = ctx.db.card().card_id().find(cid).ok_or("card not found")?;
        if c.owner != agent_identity {
            return Err("not agent's card".into());
        }
        attacker.push(stat_of(&c));
    }
    if attacker.is_empty() {
        return Err("no valid cards played".into());
    }

    let defender = match star.held_by {
        Some(holder) => sentinel_for(ctx, holder),
        None => neutral_garrison(&star),
    };

    let region_hint = star.region_hint;
    let weather = zone_favored_suit(ctx, region_hint);
    let attacker_seals = sealed_suits(ctx, player.faction);
    let defender_seals = star
        .held_by
        .map(|f| sealed_suits(ctx, f))
        .unwrap_or_default();
    let ap = combat::side_power(&attacker, weather, &attacker_seals);
    let dp = combat::side_power(&defender, weather, &defender_seals);
    let (won, margin) = combat::resolve_star(
        &attacker,
        &defender,
        weather,
        &attacker_seals,
        &defender_seals,
    );
    if won {
        star.held_by = Some(player.faction);
        ctx.db.star_node().hip_id().update(star.clone());
        let delta = combat::control_delta(star.magnitude, margin);
        apply_control(ctx, region_hint, player.faction, delta);
    }
    ctx.db.battle().insert(Battle {
        battle_id: 0,
        star_id: hip_id,
        attacker: agent_identity,
        won,
        attacker_score: ap as u32,
        defense_rating: dp as u32,
        created_at: ctx.timestamp,
    });
    Ok(())
}

#[reducer]
pub fn admin_agent_cast_jing(
    ctx: &ReducerContext,
    agent_key: String,
    mv: JingMove,
    target_player: Option<Identity>,
    target_agent: Option<Planet>,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("admin only".into());
    }
    let agent_identity = Identity::from_claims("pentacles:agent", &agent_key);

    let duel = ctx.db.jing_duel().insert(JingDuel {
        duel_id: 0,
        initiator: agent_identity,
        target_player,
        target_agent,
        opening_move: mv,
        state: JingState::Open,
        winner_is_initiator: None,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    ctx.db.jing_cast().insert(JingCast {
        cast_id: 0,
        duel_id: duel.duel_id,
        caster: agent_identity,
        caster_agent: None,
        mv,
        cost_sacred7: mv.sacred7() as u8,
        cost_esms: mv.esms(),
        deflects: None,
        voice: String::new(),
        created_at: ctx.timestamp,
    });
    Ok(())
}

#[reducer]
pub fn admin_agent_counter_jing(
    ctx: &ReducerContext,
    agent_key: String,
    duel_id: u64,
    mv: JingMove,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("admin only".into());
    }
    let agent_identity = Identity::from_claims("pentacles:agent", &agent_key);

    let mut duel = ctx.db.jing_duel().duel_id().find(&duel_id).ok_or("no such duel")?;
    if duel.state == JingState::Resolved {
        return Err("already resolved".into());
    }
    if duel.target_player != Some(agent_identity) {
        return Err("not target".into());
    }
    let last = ctx.db.jing_cast().duel_id().filter(&duel_id).max_by_key(|c| c.cast_id).ok_or("no casts")?;
    if !last.mv.countered_by().contains(&mv) {
        return Err("invalid counter".into());
    }

    ctx.db.jing_cast().insert(JingCast {
        cast_id: 0,
        duel_id,
        caster: agent_identity,
        caster_agent: None,
        mv,
        cost_sacred7: mv.sacred7() as u8,
        cost_esms: mv.esms(),
        deflects: Some(last.mv),
        voice: String::new(),
        created_at: ctx.timestamp,
    });
    duel.state = JingState::Resolved;
    duel.winner_is_initiator = Some(false);
    duel.updated_at = ctx.timestamp;
    ctx.db.jing_duel().duel_id().update(duel.clone());

    let _ = record_round_play(ctx, duel.initiator, duel.opening_move.esms(), 10);
    let _ = record_round_play(ctx, agent_identity, mv.esms(), 10);

    Ok(())
}

#[reducer]
pub fn admin_agent_cast_word(
    ctx: &ReducerContext,
    agent_key: String,
    word: String,
    opponent: Planet,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("admin only".into());
    }
    let agent_identity = Identity::from_claims("pentacles:agent", &agent_key);

    let w = word.trim().to_ascii_uppercase();
    if w.len() < 2 { return Err("too short".into()); }
    if !words::is_valid(&w) { return Err("not in codex".into()); }

    let player_score = words::word_score(&w);
    let agent_rack = agent_letters(ctx, opponent);
    let mut rack_str = String::new();
    for i in 0..26 {
        for _ in 0..agent_rack[i] {
            rack_str.push((b'A' + i as u8) as char);
        }
    }

    let cands = words::legal_candidates(&agent_rack);
    let mut cands_json = String::from("[");
    for (idx, c) in cands.iter().enumerate() {
        if idx > 0 { cands_json.push_str(", "); }
        cands_json.push('"');
        cands_json.push_str(c);
        cands_json.push('"');
    }
    cands_json.push(']');

    ctx.db.duel_challenge().insert(DuelChallenge {
        challenge_id: 0,
        player: agent_identity,
        opponent,
        player_word: w,
        player_score,
        agent_rack: rack_str,
        candidates: cands_json,
        answered: false,
        created_at: ctx.timestamp,
    });
    Ok(())
}

// ── Service health (the Observatory's cross-service heartbeat) ──────────────

/// `service_status.detail` is truncated (never rejected) past this many chars —
/// a verbose probe message must never block a heartbeat.
const SERVICE_DETAIL_MAX: usize = 200;

/// A companion service (authenticated as the module owner) reports its own — or a
/// probed sibling's — health. Owner-gated exactly like `answer_oracle`. Upserts
/// the row keyed by service name and stamps `updated_at` from the reducer
/// context, so staleness is measured on the module's clock, not the caller's.
#[reducer]
pub fn report_service_health(
    ctx: &ReducerContext,
    service: String,
    healthy: bool,
    detail: String,
    latency_ms: u32,
) -> Result<(), String> {
    let cfg = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .ok_or_else(|| "not initialised".to_string())?;
    if ctx.sender() != cfg.owner {
        return Err("owner-only reducer".into());
    }
    let service = service.trim().to_string();
    if service.is_empty() {
        return Err("service name required".into());
    }
    let mut detail = detail;
    if detail.chars().count() > SERVICE_DETAIL_MAX {
        detail = detail.chars().take(SERVICE_DETAIL_MAX).collect();
    }
    let row = ServiceStatus {
        service: service.clone(),
        healthy,
        detail,
        latency_ms,
        updated_at: ctx.timestamp,
    };
    if ctx.db.service_status().service().find(&service).is_some() {
        ctx.db.service_status().service().update(row);
    } else {
        ctx.db.service_status().insert(row);
    }
    Ok(())
}

// ── Identity linking: claim an anonymous profile after Google sign-in ────────
/// A link grant lives this long before `claim_profile` must consume it.
const CLAIM_GRANT_TTL_SECS: i64 = 600;

/// Step 1 — called by the OLD (anonymous) identity while still connected with
/// its token: stage a single-use grant keyed by sha256(code). The raw code
/// never leaves the client until step 2, so nothing in this call lets a
/// bystander claim the profile.
#[reducer]
pub fn open_identity_link(ctx: &ReducerContext, code_hash: String) -> Result<(), String> {
    let code_hash = code_hash.trim().to_lowercase();
    if code_hash.len() != 64 || !code_hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("code_hash must be a hex sha256".into());
    }
    let who = ctx.sender();
    if ctx.db.player().identity().find(&who).is_none() {
        return Err("No profile to link — register first.".into());
    }
    // Single live grant per identity: replace any earlier one.
    let stale: Vec<String> = ctx
        .db
        .claim_grant()
        .old_identity()
        .filter(&who)
        .map(|g| g.code_hash.clone())
        .collect();
    for h in stale {
        ctx.db.claim_grant().code_hash().delete(&h);
    }
    let now_us = ctx.timestamp.to_micros_since_unix_epoch();
    ctx.db.claim_grant().insert(ClaimGrant {
        code_hash,
        old_identity: who,
        created_at: ctx.timestamp,
        expires_at: Timestamp::from_micros_since_unix_epoch(
            now_us + CLAIM_GRANT_TTL_SECS * 1_000_000,
        ),
    });
    Ok(())
}

/// Step 2 — called by the NEW (OIDC) identity: consume the grant and move every
/// identity-keyed row from the old anonymous identity to the caller, so the
/// player keeps their chart, cards, loadout, pools, stakes, history and trophies
/// under the signed-in identity. The new identity must not already have a
/// profile (no merging). Deliberately left untouched: `battle` / classic `duel`
/// logs (historical), and `trace_intent`/`trace_attestation` (EVM-addressed,
/// TTL-pruned spent paper).
#[reducer]
pub fn claim_profile(ctx: &ReducerContext, code: String) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(code.trim().as_bytes());
    let hash = format!("{:x}", hasher.finalize());

    let Some(grant) = ctx.db.claim_grant().code_hash().find(&hash) else {
        return Err("Invalid or already-used link code.".into());
    };
    ctx.db.claim_grant().code_hash().delete(&grant.code_hash); // single-use
    if grant.expires_at < ctx.timestamp {
        return Err("Link code expired — sign in and try again.".into());
    }
    let old = grant.old_identity;
    let new = ctx.sender();
    if old == new {
        return Err("Already linked.".into());
    }
    if ctx.db.player().identity().find(&new).is_some() {
        return Err("This signed-in account already has a profile.".into());
    }
    let Some(player) = ctx.db.player().identity().find(&old) else {
        return Err("The original profile no longer exists.".into());
    };

    // The anchor row moves first; the grant is already burned, so a mid-flight
    // failure can never leave the profile claimable twice.
    ctx.db.player().identity().delete(&old);
    let mut p = player;
    p.identity = new;
    p.last_active = ctx.timestamp;
    ctx.db.player().insert(p);

    // PK-on-identity rows: delete + reinsert under the new identity.
    if let Some(mut r) = ctx.db.natal_chart().identity().find(&old) {
        ctx.db.natal_chart().identity().delete(&old);
        r.identity = new;
        ctx.db.natal_chart().insert(r);
    }
    if let Some(mut r) = ctx.db.player_location().identity().find(&old) {
        ctx.db.player_location().identity().delete(&old);
        r.identity = new;
        ctx.db.player_location().insert(r);
    }
    if let Some(mut r) = ctx.db.round_state().identity().find(&old) {
        ctx.db.round_state().identity().delete(&old);
        r.identity = new;
        ctx.db.round_state().insert(r);
    }
    if let Some(mut r) = ctx.db.jing_pool().identity().find(&old) {
        ctx.db.jing_pool().identity().delete(&old);
        r.identity = new;
        ctx.db.jing_pool().insert(r);
    }
    if let Some(mut r) = ctx.db.verified_evm_wallet().identity().find(&old) {
        ctx.db.verified_evm_wallet().identity().delete(&old);
        r.identity = new;
        ctx.db.verified_evm_wallet().insert(r);
    }
    if let Some(mut r) = ctx.db.verified_solana_wallet().identity().find(&old) {
        ctx.db.verified_solana_wallet().identity().delete(&old);
        r.identity = new;
        ctx.db.verified_solana_wallet().insert(r);
    }
    // Rate/cooldown rows move too — linking must not reset anti-spam clocks.
    if let Some(mut r) = ctx.db.oracle_rate().identity().find(&old) {
        ctx.db.oracle_rate().identity().delete(&old);
        r.identity = new;
        ctx.db.oracle_rate().insert(r);
    }
    if let Some(mut r) = ctx.db.word_rate().identity().find(&old) {
        ctx.db.word_rate().identity().delete(&old);
        r.identity = new;
        ctx.db.word_rate().insert(r);
    }
    if let Some(mut r) = ctx.db.jing_rate().identity().find(&old) {
        ctx.db.jing_rate().identity().delete(&old);
        r.identity = new;
        ctx.db.jing_rate().insert(r);
    }

    // Identity-indexed columns: rewrite in place via each table's PK update.
    for mut c in ctx.db.card().owner().filter(&old).collect::<Vec<_>>() {
        c.owner = new;
        ctx.db.card().card_id().update(c);
    }
    for mut s in ctx.db.deck_slot().owner().filter(&old).collect::<Vec<_>>() {
        s.owner = new;
        ctx.db.deck_slot().slot_id().update(s);
    }
    for mut d in ctx.db.natal_decan().owner().filter(&old).collect::<Vec<_>>() {
        d.owner = new;
        ctx.db.natal_decan().decan_id().update(d);
    }
    for mut t in ctx.db.round_timer().player().filter(&old).collect::<Vec<_>>() {
        t.player = new;
        ctx.db.round_timer().scheduled_id().update(t);
    }
    for mut s in ctx.db.star_stake().staker().filter(&old).collect::<Vec<_>>() {
        s.staker = new;
        ctx.db.star_stake().stake_id().update(s);
    }
    for mut w in ctx.db.word_duel().player().filter(&old).collect::<Vec<_>>() {
        w.player = new;
        ctx.db.word_duel().duel_id().update(w);
    }
    for mut c in ctx.db.duel_challenge().player().filter(&old).collect::<Vec<_>>() {
        c.player = new;
        ctx.db.duel_challenge().challenge_id().update(c);
    }
    for mut t in ctx.db.trade().proposer().filter(&old).collect::<Vec<_>>() {
        t.proposer = new;
        ctx.db.trade().trade_id().update(t);
    }
    for mut t in ctx.db.trade().partner().filter(&old).collect::<Vec<_>>() {
        t.partner = new;
        ctx.db.trade().trade_id().update(t);
    }
    for mut j in ctx.db.jing_duel().initiator().filter(&old).collect::<Vec<_>>() {
        j.initiator = new;
        ctx.db.jing_duel().duel_id().update(j);
    }
    for mut transfer in ctx
        .db
        .bridge_transfer()
        .player()
        .filter(&old)
        .collect::<Vec<_>>()
    {
        transfer.player = new;
        ctx.db
            .bridge_transfer()
            .burn_tx_hash()
            .update(transfer);
    }

    // Small / TTL-pruned tables without an identity index: linear rewrite.
    for mut j in ctx
        .db
        .jing_duel()
        .iter()
        .filter(|j| j.target_player == Some(old))
        .collect::<Vec<_>>()
    {
        j.target_player = Some(new);
        ctx.db.jing_duel().duel_id().update(j);
    }
    for mut c in ctx
        .db
        .jing_cast()
        .iter()
        .filter(|c| c.caster == old)
        .collect::<Vec<_>>()
    {
        c.caster = new;
        ctx.db.jing_cast().cast_id().update(c);
    }
    for mut q in ctx
        .db
        .duel_queue()
        .iter()
        .filter(|q| q.seeker == old)
        .collect::<Vec<_>>()
    {
        q.seeker = new;
        ctx.db.duel_queue().ticket_id().update(q);
    }
    for mut r in ctx
        .db
        .oracle_request()
        .iter()
        .filter(|r| r.asker == old)
        .collect::<Vec<_>>()
    {
        r.asker = new;
        ctx.db.oracle_request().request_id().update(r);
    }
    for mut r in ctx
        .db
        .oracle_reply()
        .iter()
        .filter(|r| r.asker == old)
        .collect::<Vec<_>>()
    {
        r.asker = new;
        ctx.db.oracle_reply().request_id().update(r);
    }
    for mut rp in ctx
        .db
        .round_participant()
        .iter()
        .filter(|p| p.identity == old)
        .collect::<Vec<_>>()
    {
        rp.identity = new;
        ctx.db.round_participant().id().update(rp);
    }
    // The trophy ledger follows the player (append-only, permanent).
    for mut b in ctx
        .db
        .constellation_block()
        .iter()
        .filter(|b| b.minter == old)
        .collect::<Vec<_>>()
    {
        b.minter = new;
        ctx.db.constellation_block().block_id().update(b);
    }

    log::info!("claim_profile: migrated profile {old} -> {new}");
    Ok(())
}

/// Bind an EVM or Solana wallet to the player's SpacetimeDB profile.
#[reducer]
pub fn bind_wallet_address(
    ctx: &ReducerContext,
    evm_address: Option<String>,
    solana_pubkey: Option<String>,
) -> Result<(), String> {
    let mut player = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "player profile not found — register first (create_player)".to_string())?;

    let now_sec = (ctx.timestamp.to_micros_since_unix_epoch() / 1_000_000) as i64;
    if let Some(chart) = ctx.db.natal_chart().identity().find(&ctx.sender()) {
        if chart::is_minor(chart.birth_unix, now_sec) {
            return Err("Minor age restriction: Web3 / Token-2022 wallet binding requires verified parental consent under NY SAFE Kids Act".into());
        }
    }

    if let Some(ref evm) = evm_address {
        let clean_evm = evm.trim().to_lowercase();
        if clean_evm.len() != 42 || !clean_evm.starts_with("0x") || !clean_evm[2..].bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("evm_address must be a 0x-prefixed 20-byte hex address".into());
        }
        if player.evm_address.as_deref() != Some(clean_evm.as_str()) {
            ctx.db
                .verified_evm_wallet()
                .identity()
                .delete(&ctx.sender());
        }
        player.evm_address = Some(clean_evm);
    }

    if let Some(ref sol) = solana_pubkey {
        let clean_sol = sol.trim().to_string();
        if clean_sol.len() < 32 || clean_sol.len() > 44 {
            return Err("invalid solana_pubkey format".into());
        }
        if player.solana_pubkey.as_deref() != Some(clean_sol.as_str()) {
            ctx.db
                .verified_solana_wallet()
                .identity()
                .delete(&ctx.sender());
        }
        player.solana_pubkey = Some(clean_sol);
    }

    ctx.db.player().identity().update(player);
    Ok(())
}

/// Owner-authenticated callback after the HTTP verifier recovers the holder's
/// EIP-712 WalletBinding signature.
#[reducer]
pub fn verify_evm_wallet_binding(
    ctx: &ReducerContext,
    player_identity: Identity,
    evm_address: String,
    proof_hash: String,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("verify_evm_wallet_binding: admin/verifier only".into());
    }
    let address = evm_address.trim().to_ascii_lowercase();
    if address.len() != 42
        || !address.starts_with("0x")
        || !address[2..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("evm_address must be a 0x-prefixed 20-byte hex address".into());
    }
    let proof = normalized_evm_tx_hash(&proof_hash, "proof_hash")?;
    let player = ctx
        .db
        .player()
        .identity()
        .find(&player_identity)
        .ok_or_else(|| "player profile not found".to_string())?;
    if !player
        .evm_address
        .as_deref()
        .is_some_and(|bound| bound.eq_ignore_ascii_case(&address))
    {
        return Err("verified wallet does not match the player's current binding".into());
    }
    if ctx
        .db
        .verified_evm_wallet()
        .evm_address()
        .find(&address)
        .is_some_and(|existing| existing.identity != player_identity)
    {
        return Err("EVM wallet is already verified for another player".into());
    }
    let row = VerifiedEvmWallet {
        identity: player_identity,
        evm_address: address,
        proof_hash: proof,
        verified_at: ctx.timestamp,
    };
    if ctx
        .db
        .verified_evm_wallet()
        .identity()
        .find(&player_identity)
        .is_some()
    {
        ctx.db.verified_evm_wallet().identity().update(row);
    } else {
        ctx.db.verified_evm_wallet().insert(row);
    }
    Ok(())
}

/// Owner-authenticated callback after the HTTP verifier validates the holder's
/// Ed25519 Solana WalletBinding signature.
#[reducer]
pub fn verify_solana_wallet_binding(
    ctx: &ReducerContext,
    player_identity: Identity,
    solana_pubkey: String,
    proof_hash: String,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("verify_solana_wallet_binding: admin/verifier only".into());
    }
    let pubkey = solana_pubkey.trim().to_string();
    if !(32..=44).contains(&pubkey.len())
        || !pubkey.bytes().all(|b| {
            matches!(b, b'1'..=b'9' | b'A'..=b'H' | b'J'..=b'N' | b'P'..=b'Z' | b'a'..=b'k' | b'm'..=b'z')
        })
    {
        return Err("solana_pubkey must be a base58 public key".into());
    }
    let proof = normalized_evm_tx_hash(&proof_hash, "proof_hash")?;
    let player = ctx
        .db
        .player()
        .identity()
        .find(&player_identity)
        .ok_or_else(|| "player profile not found".to_string())?;
    if player.solana_pubkey.as_deref() != Some(pubkey.as_str()) {
        return Err("verified wallet does not match the player's current binding".into());
    }
    if ctx
        .db
        .verified_solana_wallet()
        .solana_pubkey()
        .find(&pubkey)
        .is_some_and(|existing| existing.identity != player_identity)
    {
        return Err("Solana wallet is already verified for another player".into());
    }
    let row = VerifiedSolanaWallet {
        identity: player_identity,
        solana_pubkey: pubkey,
        proof_hash: proof,
        verified_at: ctx.timestamp,
    };
    if ctx
        .db
        .verified_solana_wallet()
        .identity()
        .find(&player_identity)
        .is_some()
    {
        ctx.db.verified_solana_wallet().identity().update(row);
    } else {
        ctx.db.verified_solana_wallet().insert(row);
    }
    Ok(())
}

fn parse_bridge_chain(value: &str, field: &str) -> Result<BridgeChain, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "evm_base_sepolia" => Ok(BridgeChain::EvmBaseSepolia),
        "solana_token_2022" => Ok(BridgeChain::SolanaToken2022),
        _ => Err(format!("{field} is not a supported bridge chain")),
    }
}

struct ValidatedBridgeRequest {
    source: BridgeChain,
    target: BridgeChain,
    source_name: String,
    target_name: String,
    evm: String,
    solana: String,
}

fn validate_bridge_request(
    ctx: &ReducerContext,
    source_chain: &str,
    target_chain: &str,
    element_id: u8,
    amount: u128,
) -> Result<ValidatedBridgeRequest, String> {
    if element_id > 3 {
        return Err("element_id must be between 0 and 3".into());
    }
    if amount == 0 {
        return Err("amount must be greater than zero".into());
    }
    if amount > u64::MAX as u128 {
        return Err("amount exceeds the Solana Token-2022 u64 range".into());
    }
    let source_name = source_chain.trim().to_ascii_lowercase();
    let target_name = target_chain.trim().to_ascii_lowercase();
    let source = parse_bridge_chain(&source_name, "source_chain")?;
    let target = parse_bridge_chain(&target_name, "target_chain")?;
    let supported_pair = matches!(
        (source, target),
        (BridgeChain::EvmBaseSepolia, BridgeChain::SolanaToken2022)
            | (BridgeChain::SolanaToken2022, BridgeChain::EvmBaseSepolia)
    );
    if !supported_pair {
        return Err("source_chain and target_chain must be opposite supported chains".into());
    }

    let player = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "player profile not found".to_string())?;
    let evm = player
        .evm_address
        .as_deref()
        .map(str::trim)
        .filter(|address| !address.is_empty())
        .ok_or_else(|| "bind an EVM wallet before bridging".to_string())?
        .to_ascii_lowercase();
    if evm.len() != 42
        || !evm.starts_with("0x")
        || !evm[2..].bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("bound EVM address is invalid".into());
    }
    let solana = player
        .solana_pubkey
        .as_deref()
        .map(str::trim)
        .filter(|address| !address.is_empty())
        .ok_or_else(|| "bind a Solana wallet before bridging".to_string())?
        .to_string();
    if !ctx
        .db
        .verified_evm_wallet()
        .identity()
        .find(&ctx.sender())
        .is_some_and(|binding| binding.evm_address.eq_ignore_ascii_case(&evm))
    {
        return Err("verify the bound EVM wallet before bridging".into());
    }
    if !ctx
        .db
        .verified_solana_wallet()
        .identity()
        .find(&ctx.sender())
        .is_some_and(|binding| binding.solana_pubkey == solana)
    {
        return Err("verify the bound Solana wallet before bridging".into());
    }

    Ok(ValidatedBridgeRequest {
        source,
        target,
        source_name,
        target_name,
        evm,
        solana,
    })
}

/// Preflight every reducer-side bridge requirement that can be checked before
/// the source burn exists, preventing an irreversible burn with no mint record.
#[reducer]
pub fn assert_esms_bridge_ready(
    ctx: &ReducerContext,
    source_chain: String,
    target_chain: String,
    element_id: u8,
    amount: u128,
) -> Result<(), String> {
    validate_bridge_request(ctx, &source_chain, &target_chain, element_id, amount)?;
    Ok(())
}

/// Register a claimed source-chain ESMS burn for feeder verification and a
/// pending mint on the other supported chain. Both wallet bindings are captured
/// from the caller's Player row, so the destination cannot be redirected.
#[reducer]
pub fn bridge_esms_crosschain(
    ctx: &ReducerContext,
    burn_tx_hash: String,
    source_chain: String,
    target_chain: String,
    element_id: u8,
    amount: u128,
) -> Result<(), String> {
    let ValidatedBridgeRequest {
        source,
        target,
        source_name,
        target_name,
        evm,
        solana,
    } = validate_bridge_request(ctx, &source_chain, &target_chain, element_id, amount)?;
    let hash = if source == BridgeChain::EvmBaseSepolia {
        normalized_evm_tx_hash(&burn_tx_hash, "burn_tx_hash")?
    } else {
        normalized_solana_signature(&burn_tx_hash, "burn_tx_hash")?
    };
    if ctx
        .db
        .bridge_transfer()
        .burn_tx_hash()
        .find(&hash)
        .is_some()
    {
        return Err("Bridge burn transaction already registered".into());
    }
    ensure_unprocessed(ctx, source.chain_key(), &hash)?;
    let (source_address, target_address) = if source == BridgeChain::EvmBaseSepolia {
        (evm, solana)
    } else {
        (solana, evm)
    };

    ctx.db.bridge_transfer().insert(BridgeTransfer {
        burn_tx_hash: hash.clone(),
        player: ctx.sender(),
        source_chain: source,
        target_chain: target,
        source_address,
        target_address,
        element_id,
        amount,
        status: BridgeStatus::PendingMint,
        destination_tx_hash: None,
        created_at: ctx.timestamp,
        updated_at: ctx.timestamp,
    });
    record_processed(
        ctx,
        hash,
        &source_name,
        &format!("bridge_burn_to_{target_name}"),
    );
    Ok(())
}

/// Owner-only bridge feeder acknowledgement after it verifies the source burn
/// and observes the exact destination mint.
#[reducer]
pub fn complete_esms_bridge(
    ctx: &ReducerContext,
    burn_tx_hash: String,
    destination_tx_hash: String,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("complete_esms_bridge: admin/feeder only".into());
    }
    let mut transfer = ctx
        .db
        .bridge_transfer()
        .burn_tx_hash()
        .find(&burn_tx_hash)
        .ok_or_else(|| "bridge transfer not found".to_string())?;
    let destination_hash = if transfer.target_chain.is_solana() {
        normalized_solana_signature(&destination_tx_hash, "destination_tx_hash")?
    } else {
        normalized_evm_tx_hash(&destination_tx_hash, "destination_tx_hash")?
    };
    if transfer.status == BridgeStatus::Completed {
        return if transfer.destination_tx_hash.as_deref() == Some(destination_hash.as_str()) {
            Ok(())
        } else {
            Err("bridge transfer already completed with a different destination transaction".into())
        };
    }
    ensure_unprocessed(ctx, transfer.target_chain.chain_key(), &destination_hash)?;
    transfer.status = BridgeStatus::Completed;
    transfer.destination_tx_hash = Some(destination_hash.clone());
    transfer.updated_at = ctx.timestamp;
    ctx.db
        .bridge_transfer()
        .burn_tx_hash()
        .update(transfer.clone());
    record_processed(
        ctx,
        destination_hash,
        transfer.target_chain.chain_key(),
        "bridge_destination_mint",
    );
    Ok(())
}

/// The module ledger counts ESMS in 18-decimal base units, matching the Base
/// ERC-1155 whose uint256 balances have no practical ceiling.
const ESMS_BASE_UNITS: u128 = 1_000_000_000_000_000_000;

/// AlchmAgentsSolana issues ESMS as Token-2022 mints at 4 decimals. Token-2022
/// amounts are u64, which is why the scale differs at all: at 18 decimals a
/// single token account tops out near 18.45 ESMS.
const ESMS_SOLANA_DECIMALS: u32 = 4;

/// 10^4 — Solana atoms in one whole ESMS.
const ESMS_SOLANA_ATOMS_PER_TOKEN: u128 = 10_000;

/// USDC is 6-decimal, and the yield rate is quoted per whole USDC per day.
const USDC_UNITS_PER_TOKEN: u128 = 1_000_000;
const SECONDS_PER_DAY: u128 = 86_400;

/// Fixed-point scale applied to the yield rate before it becomes an integer.
///
/// Quantizing straight to whole atoms per USDC-day would be far too coarse: the
/// base rate is 0.0006 ESMS, i.e. 6 atoms, so a modifier moving it to 4.2 atoms
/// would round to 4 and lose 5% of the yield. A further 10^6 keeps the
/// quantization error near one part per million while every subsequent
/// operation stays integer.
const YIELD_RATE_SCALE: u128 = 1_000_000;

/// 10^14 — the exact factor between one Solana atom and one ledger base unit.
const LEDGER_PER_SOLANA_ATOM: u128 = 100_000_000_000_000;

/// Widen 4-decimal Solana atoms to the 18-decimal ledger. Always exact.
fn solana_atoms_to_ledger(atoms: u64) -> Result<u128, String> {
    (atoms as u128)
        .checked_mul(LEDGER_PER_SOLANA_ATOM)
        .ok_or_else(|| "ESMS amount overflows the ledger".to_string())
}

/// Narrow an 18-decimal ledger amount to 4-decimal Solana atoms, returning the
/// remainder that is not representable there.
///
/// Callers must do something deliberate with the remainder — leave it credited,
/// or refuse the operation. Discarding it silently leaks value on every
/// crossing, and 14 digits is a lot of room to leak into.
fn ledger_to_solana_atoms(amount: u128) -> Result<(u64, u128), String> {
    let atoms = amount / LEDGER_PER_SOLANA_ATOM;
    let dust = amount % LEDGER_PER_SOLANA_ATOM;
    let atoms = u64::try_from(atoms)
        .map_err(|_| "ESMS amount exceeds the Token-2022 u64 range".to_string())?;
    Ok((atoms, dust))
}

fn esms_game_units(amount: u128) -> u16 {
    let whole = if amount >= ESMS_BASE_UNITS {
        amount / ESMS_BASE_UNITS
    } else {
        amount
    };
    whole.min(u16::MAX as u128) as u16
}

fn apply_esms_event_to_jing_pool(
    ctx: &ReducerContext,
    player: &Player,
    event_type: &str,
    element_id: u8,
    amount: u128,
) -> Result<(), String> {
    if element_id > 3 {
        return Err("element_id must be between 0 and 3".into());
    }
    if event_type != "mint" && event_type != "burn" {
        return Err("event_type must be mint or burn".into());
    }
    let units = esms_game_units(amount);
    let mut pool = ctx
        .db
        .jing_pool()
        .identity()
        .find(&player.identity)
        .unwrap_or_else(|| JingPool {
            identity: player.identity,
            sacred7: vec![100, 100, 100, 100, 100, 100, 100],
            esms: vec![50, 50, 50, 50],
            updated_at: ctx.timestamp,
        });
    if pool.esms.len() < 4 {
        pool.esms.resize(4, 0);
    }
    let credit = if event_type == "burn" {
        units.saturating_mul(2)
    } else {
        units
    };
    pool.esms[element_id as usize] = pool.esms[element_id as usize].saturating_add(credit);
    pool.updated_at = ctx.timestamp;
    if ctx.db.jing_pool().identity().find(&player.identity).is_some() {
        ctx.db.jing_pool().identity().update(pool);
    } else {
        ctx.db.jing_pool().insert(pool);
    }
    Ok(())
}

/// Feeder sync for a confirmed Base Sepolia Redeemed/mint event.
#[reducer]
pub fn sync_evm_event(
    ctx: &ReducerContext,
    tx_hash: String,
    player_address: String,
    event_type: String,
    element_id: u8,
    amount: String,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("sync_evm_event: admin/feeder only".into());
    }
    let hash = normalized_evm_tx_hash(&tx_hash, "tx_hash")?;
    ensure_unprocessed(ctx, "evm_base_sepolia", &hash)?;
    let address = player_address.trim().to_ascii_lowercase();
    let player = ctx
        .db
        .player()
        .iter()
        .find(|row| {
            row.evm_address
                .as_deref()
                .is_some_and(|bound| bound.trim().eq_ignore_ascii_case(&address))
        })
        .ok_or_else(|| "no player bound to EVM event address".to_string())?;
    if !ctx
        .db
        .verified_evm_wallet()
        .identity()
        .find(&player.identity)
        .is_some_and(|binding| binding.evm_address.eq_ignore_ascii_case(&address))
    {
        return Err("EVM event wallet ownership has not been verified".into());
    }
    let parsed_amount = amount
        .trim()
        .parse::<u128>()
        .map_err(|_| "amount must be an unsigned integer string".to_string())?;
    if parsed_amount == 0 {
        return Err("amount must be greater than zero".into());
    }
    apply_esms_event_to_jing_pool(ctx, &player, &event_type, element_id, parsed_amount)?;
    record_processed(ctx, hash, "evm_base_sepolia", &event_type);
    Ok(())
}

/// Feeder sync: translate an ESMS Token-2022 mint/burn observed on Solana into
/// a SpacetimeDB state update.
///
/// `chain` names the cluster the feeder observed, and is not cosmetic: it scopes
/// idempotency so a devnet signature can never be mistaken for the mainnet one
/// it collides with, and vice versa. It must be a Solana variant.
///
/// `amount` arrives in ASOL's 4-decimal atoms — the scale of the Token-2022
/// mints `asol_program` issues — and is widened here to the module's 18-decimal
/// ledger. Widening is exact; see `solana_atoms_to_ledger`.
#[reducer]
pub fn sync_solana_event(
    ctx: &ReducerContext,
    chain: BridgeChain,
    tx_hash: String,
    player_pubkey: String,
    event_type: String,
    element_id: u8,
    amount: u64,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("sync_solana_event: admin/feeder only".into());
    }
    if !chain.is_solana() {
        return Err("sync_solana_event: chain must be a Solana cluster".into());
    }

    let hash = normalized_solana_signature(&tx_hash, "tx_hash")?;
    ensure_unprocessed(ctx, chain.chain_key(), &hash)?;
    let player = ctx
        .db
        .player()
        .iter()
        .find(|row| row.solana_pubkey.as_deref() == Some(player_pubkey.trim()))
        .ok_or_else(|| "no player bound to Solana event address".to_string())?;
    if !ctx
        .db
        .verified_solana_wallet()
        .identity()
        .find(&player.identity)
        .is_some_and(|binding| binding.solana_pubkey == player_pubkey.trim())
    {
        return Err("Solana event wallet ownership has not been verified".into());
    }
    let ledger_amount = solana_atoms_to_ledger(amount)?;
    apply_esms_event_to_jing_pool(ctx, &player, &event_type, element_id, ledger_amount)?;
    record_processed(ctx, hash, chain.chain_key(), &event_type);
    Ok(())
}

/// Re-attributes a StarStake position from a seller's Solana wallet to a buyer's Solana wallet
/// upon receiving a Transfer Hook `StarStakeTransferred` event.
#[reducer]
pub fn transfer_star_stake(
    ctx: &ReducerContext,
    tx_hash: String,
    from_solana_pubkey: String,
    to_solana_pubkey: String,
    token_amount: u64,
) -> Result<(), String> {
    let cfg = ctx.db.game_config().id().find(&0).ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("transfer_star_stake: admin/feeder only".into());
    }

    let hash = tx_hash.trim().to_string();
    if hash.is_empty() {
        return Err("tx_hash cannot be empty".into());
    }

    // Idempotency check — reject replayed transfer events
    if ctx.db.processed_tx().tx_hash().find(&hash).is_some() {
        return Err("Transaction already processed".into());
    }

    let from_pubkey = from_solana_pubkey.trim();
    let to_pubkey = to_solana_pubkey.trim();

    let from_player = ctx.db.player().iter().find(|p| p.solana_pubkey.as_deref() == Some(from_pubkey));
    let to_player = ctx.db.player().iter().find(|p| p.solana_pubkey.as_deref() == Some(to_pubkey));

    if let (Some(seller), Some(buyer)) = (from_player, to_player) {
        let mut stake_opt = ctx.db.star_stake().iter().find(|s| s.staker == seller.identity);
        if let Some(mut seller_stake) = stake_opt {
            let transfer_usdc = token_amount.min(seller_stake.principal_usdc);
            seller_stake.principal_usdc = seller_stake.principal_usdc.saturating_sub(transfer_usdc);

            let star_id = seller_stake.star_id;
            let element = seller_stake.element;

            ctx.db.star_stake().stake_id().update(seller_stake);

            // Add or update buyer's stake position
            let buyer_stake_opt = ctx.db.star_stake().iter().find(|s| s.staker == buyer.identity && s.star_id == star_id);
            if let Some(mut buyer_stake) = buyer_stake_opt {
                buyer_stake.principal_usdc += transfer_usdc;
                ctx.db.star_stake().stake_id().update(buyer_stake);
            } else {
                ctx.db.star_stake().insert(StarStake {
                    stake_id: 0,
                    staker: buyer.identity,
                    star_id,
                    element,
                    principal_usdc: transfer_usdc,
                    shares: (transfer_usdc as u128) * 1_000_000,
                    accrued_essence: 0,
                    claimed_essence: 0,
                    pending_essence: 0,
                    claim_nonce: 0,
                    staked_at: ctx.timestamp,
                    last_accrual_at: ctx.timestamp,
                });
            }
        }
    }

    ctx.db.processed_tx().insert(ProcessedTx {
        tx_hash: hash,
        chain: "solana_token_2022".to_string(),
        event_type: "transfer_star_stake".to_string(),
        processed_at: ctx.timestamp,
    });

    Ok(())
}

// ── Zone Flux & Human AR Constellation Advantage ───────────────────────────


/// Trigger or update Zone Flux state. Historical ALCHM agents and planetary transits call
/// this to make a zone volatile and competitive ("setting the table").
#[reducer]
pub fn trigger_zone_flux(
    ctx: &ReducerContext,
    zone_id: u8,
    constellation_id: u16,
    intensity: u8,
    duration_secs: u64,
) -> Result<(), String> {
    if zone_id > 10 {
        return Err("invalid zone id".into());
    }
    let mut z = ctx
        .db
        .zone()
        .zone_id()
        .find(&zone_id)
        .ok_or_else(|| "zone not found".to_string())?;

    let constellation = ctx
        .db
        .constellation()
        .constellation_id()
        .find(&constellation_id)
        .ok_or_else(|| "constellation not found".to_string())?;

    let dur_micros = duration_secs as i64 * 1_000_000;
    let expires = Timestamp::from_micros_since_unix_epoch(
        ctx.timestamp.to_micros_since_unix_epoch() + dur_micros,
    );

    z.in_flux = true;
    z.flux_level = intensity.clamp(1, 100);
    z.flux_constellation = Some(constellation_id);
    z.flux_triggered_by = Some(ctx.sender());
    z.flux_expires_at = Some(expires);
    z.updated_at = ctx.timestamp;

    ctx.db.zone().zone_id().update(z);
    log::info!(
        "Zone {} entered FLUX (intensity {}, constellation {}, expires in {}s)",
        zone_id,
        intensity,
        constellation.name,
        duration_secs
    );
    Ok(())
}

/// Human player AR camera capture reducer. When a human points their camera at the
/// constellation in question and aligns it, this verifies horizon visibility, records high-value
/// optical telemetry data, awards ESMS tokens, and grants a 4x Meta Advantage multiplier.
#[reducer]
pub fn capture_ar_constellation(
    ctx: &ReducerContext,
    constellation_id: u16,
    zone_id: u8,
    precision_score: u8,
    azimuth_deg: u32,
    altitude_deg_val: i32,
) -> Result<(), String> {
    if zone_id > 10 {
        return Err("invalid zone id".into());
    }
    if precision_score < 70 {
        return Err("AR alignment precision too low (must be >= 70%)".into());
    }

    // Verify player is registered
    let mut player = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "register a Seeker first".to_string())?;

    // Check if player is a historical agent (AgentChart row exists for this identity)
    let is_agent = ctx.db.agent_chart().identity().find(&ctx.sender()).is_some();
    if is_agent {
        return Err("Only human Seekers may capture AR Constellations".into());
    }

    let loc = ctx
        .db
        .player_location()
        .identity()
        .find(&ctx.sender())
        .ok_or_else(|| "set your location first (set_location)".to_string())?;

    let con = ctx
        .db
        .constellation()
        .constellation_id()
        .find(&constellation_id)
        .ok_or_else(|| "no such constellation".to_string())?;

    // Verify star visibility above MIN_ALT_DEG
    let mut visible: u16 = 0;
    for cs in ctx
        .db
        .constellation_star()
        .constellation_id()
        .filter(&constellation_id)
    {
        if let Some(star) = ctx.db.star_node().hip_id().find(&cs.hip_id) {
            if altitude_deg(star.ra, star.dec, loc.lat, loc.lon, ctx.timestamp) >= MIN_ALT_DEG {
                visible += 1;
            }
        }
    }

    if visible < con.visible_threshold {
        return Err(format!(
            "Constellation {} is below your horizon ({}/{} stars visible)",
            con.name, visible, con.visible_threshold
        ));
    }

    // Calculate valuable telemetry harvest: precision 70..100 maps to 1,050..1,500 tokens
    let tokens_harvested = (precision_score as u64) * 15;
    player.tokens += tokens_harvested;
    player.last_active = ctx.timestamp;
    ctx.db.player().identity().update(player.clone());

    // Capture valid for 1 hour (3600s)
    let expires = Timestamp::from_micros_since_unix_epoch(
        ctx.timestamp.to_micros_since_unix_epoch() + 3600 * 1_000_000,
    );

    ctx.db.ar_constellation_capture().insert(ArConstellationCapture {
        capture_id: 0,
        player: ctx.sender(),
        constellation_id,
        zone_id,
        precision_score,
        azimuth_deg,
        altitude_deg: altitude_deg_val,
        tokens_harvested,
        captured_at: ctx.timestamp,
        expires_at: expires,
    });

    // Immediate human influence surge: push +400 control for human's faction
    apply_control(ctx, zone_id, player.faction, 400);

    log::info!(
        "Human player {:?} executed AR Capture for {} in Zone {} (precision {}%, harvested {} tokens)",
        ctx.sender(),
        con.name,
        zone_id,
        precision_score,
        tokens_harvested
    );

    Ok(())
}

/// Updates player's Indoor/Outdoor environment state, Z-axis parsec depth, 3D Cartesian vectors,
/// and active cosmic layer (1: Ephemeris, 2: Bound, 3: Arm, 4: Deep Field).
#[reducer]
pub fn update_seeker_environment(
    ctx: &ReducerContext,
    is_indoor: bool,
    x: f64,
    y: f64,
    z: f64,
    active_layer: u8,
) -> Result<(), String> {
    if active_layer < 1 || active_layer > 4 {
        return Err("active_layer must be between 1 and 4".into());
    }

    if let Some(mut existing) = ctx.db.seeker_state().player().find(&ctx.sender()) {
        existing.is_indoor = is_indoor;
        existing.x = x;
        existing.y = y;
        existing.z = z;
        existing.active_layer = active_layer;
        existing.last_updated = ctx.timestamp;
        ctx.db.seeker_state().player().update(existing);
    } else {
        ctx.db.seeker_state().insert(SeekerState {
            player: ctx.sender(),
            is_indoor,
            x,
            y,
            z,
            active_layer,
            last_updated: ctx.timestamp,
        });
    }

    Ok(())
}

/// Reducer triggered when an indoor player aligns their volumetric reticle with a Deep Space Cache.
/// Verifies Cartesian 3D proximity, updates multiplayer active seekers, decrypts cache, and awards ESMS yield.
#[reducer]
pub fn lock_anomaly(
    ctx: &ReducerContext,
    cache_id: u64,
    x: f64,
    y: f64,
    z: f64,
) -> Result<(), String> {
    let mut cache = ctx
        .db
        .deep_space_cache()
        .cache_id()
        .find(&cache_id)
        .ok_or_else(|| "deep space cache node not found".to_string())?;

    // Spatial Euclidean distance check in parsecs
    let dx = cache.center_x - x;
    let dy = cache.center_y - y;
    let dz = cache.center_z - z;
    let dist_sq = dx * dx + dy * dy + dz * dz;

    // Tolerance limit: within 15 parsecs volumetric lock
    if dist_sq > 225.0 {
        return Err(format!(
            "spatial alignment vector too far from anomaly cache (dist: {:.2} pc)",
            dist_sq.sqrt()
        ));
    }

    // Increment active seekers anchored to this node
    cache.active_seekers += 1;
    if cache.encryption_status > 10 {
        cache.encryption_status -= 10;
    } else {
        cache.encryption_status = 0;
    }
    ctx.db.deep_space_cache().cache_id().update(cache.clone());

    // Award ESMS tokens if fully decrypted
    if cache.encryption_status == 0 {
        if let Some(mut player) = ctx.db.player().identity().find(&ctx.sender()) {
            let reward = cache.esms_yield as u64;
            player.tokens += reward;
            player.last_active = ctx.timestamp;
            ctx.db.player().identity().update(player);
            log::info!(
                "Seeker {:?} unlocked DeepSpaceCache {} (rewarded {} ESMS tokens)",
                ctx.sender(),
                cache_id,
                reward
            );
        }
    }

    Ok(())
}



#[cfg(test)]

mod tests {
    use super::{
        auto_battle_win, catchup_rounds, compute_ecliptic, expand_constellation, has_duplicates,
        melee_control_deltas, pick_weakest, question_hash, round_interval_secs, seat_score,
        should_replace, COLLECTION_CAP, MAX_CATCHUP_ROUNDS, ROUND_BASE_SECS, ZONE_SWING,
        ZONE_SWING_WINNER_BONUS,
    };

    // ── The War Table ───────────────────────────────────────────────────────

    /// A seat's score is owned by the module, not the feeder: counters + melds,
    /// plus ten for the final trick and nothing for anyone else.
    #[test]
    fn seat_score_adds_melds_and_the_final_trick_climax() {
        assert_eq!(seat_score(40, 20, false), 60);
        assert_eq!(seat_score(40, 20, true), 70, "the final trick is worth ten");
        assert_eq!(seat_score(0, 0, false), 0);
        // Saturating: a bad feeder cannot wrap a seat into a tiny score.
        assert_eq!(seat_score(u16::MAX, 500, true), u16::MAX);
    }

    /// The swing is bounded and zero-sum around the mean at EVERY seat count.
    /// Without this a six-seat table would shove a zone three times harder than a
    /// two-seat one purely because more counters were dealt into it.
    #[test]
    fn control_deltas_are_zero_sum_around_the_mean_at_every_seat_count() {
        for n in 2..=6usize {
            let equal = vec![50u16; n];
            let d = melee_control_deltas(&equal, ZONE_SWING);
            let sum: i32 = d.iter().sum();
            assert_eq!(
                sum, ZONE_SWING_WINNER_BONUS,
                "n={n}: an all-square table must move only by the winner bonus"
            );
            for (i, v) in d.iter().enumerate() {
                let expect = if i == 0 { ZONE_SWING_WINNER_BONUS } else { 0 };
                assert_eq!(*v, expect, "n={n}: seat {i} scored the mean and must not move");
            }
        }
    }

    /// A dominant seat pushes, a weak seat is pushed back, and the total stays
    /// bounded however large the pot got.
    #[test]
    fn control_deltas_stay_bounded_however_large_the_pot() {
        for scores in [
            vec![100u16, 20],
            vec![900, 30, 30, 30],
            vec![250, 250, 10, 10, 10, 10],
        ] {
            let d = melee_control_deltas(&scores, ZONE_SWING);
            let sum: i32 = d.iter().sum();
            assert_eq!(sum, ZONE_SWING_WINNER_BONUS, "zero-sum but for the bonus: {scores:?}");
            for v in &d {
                assert!(
                    v.abs() <= ZONE_SWING + ZONE_SWING_WINNER_BONUS,
                    "a single seat moved {v}, past the bounded swing: {scores:?}"
                );
            }
            assert!(d[0] > 0, "the top seat must push: {scores:?}");
            assert!(d[d.len() - 1] < 0, "the bottom seat must be pushed back: {scores:?}");
        }
    }

    /// A scoreless table is a real outcome — it must not panic or divide by zero.
    #[test]
    fn control_deltas_survive_a_scoreless_table() {
        assert_eq!(melee_control_deltas(&[0, 0, 0], ZONE_SWING), vec![ZONE_SWING_WINNER_BONUS, 0, 0]);
        assert!(melee_control_deltas(&[], ZONE_SWING).is_empty());
    }

    /// Ties go to the earliest seat — the same "first played wins" rule the trick
    /// engine uses, so the two can never disagree about who won.
    #[test]
    fn control_delta_ties_break_to_the_earliest_seat() {
        let d = melee_control_deltas(&[70, 70, 10], ZONE_SWING);
        assert!(d[0] > d[1], "seat 0 was dealt first and takes the tie");
    }

    // ── The Ascendant clock ──────────────────────────────────────────────────

    #[test]
    fn round_interval_lengthens_in_bands_past_25_cards() {
        assert_eq!(round_interval_secs(1), ROUND_BASE_SECS); // 60
        assert_eq!(round_interval_secs(20), 60); // a fresh deck is still the base round
        assert_eq!(round_interval_secs(25), 60); // exactly 25 → still the base
        assert_eq!(round_interval_secs(26), 90); // the first band past 25
        assert_eq!(round_interval_secs(50), 90);
        assert_eq!(round_interval_secs(51), 120);
        assert_eq!(round_interval_secs(75), 120);
        assert_eq!(round_interval_secs(100), 150);
        // Monotonic non-decreasing in deck size.
        let mut prev = round_interval_secs(0);
        for n in 1..=300usize {
            let cur = round_interval_secs(n);
            assert!(cur >= prev, "interval dipped at {n}: {cur} < {prev}");
            prev = cur;
        }
    }

    #[test]
    fn catchup_resolves_at_least_one_round_and_at_most_one_cap() {
        assert_eq!(catchup_rounds(0, 60, MAX_CATCHUP_ROUNDS), 1); // never zero
        assert_eq!(catchup_rounds(59, 60, MAX_CATCHUP_ROUNDS), 1);
        assert_eq!(catchup_rounds(60, 60, MAX_CATCHUP_ROUNDS), 1);
        assert_eq!(catchup_rounds(600, 60, MAX_CATCHUP_ROUNDS), 10);
        assert_eq!(catchup_rounds(-5, 60, MAX_CATCHUP_ROUNDS), 1); // clock skew floors at one
        // A long absence tops up at most a full collection's worth — never floods.
        assert_eq!(catchup_rounds(1_000_000_000, 60, MAX_CATCHUP_ROUNDS), COLLECTION_CAP as u64);
        assert!(catchup_rounds(i64::MAX, 1, MAX_CATCHUP_ROUNDS) <= COLLECTION_CAP as u64);
    }

    #[test]
    fn auto_battle_needs_to_meet_the_challenge() {
        assert!(auto_battle_win(100.0, 80.0));
        assert!(auto_battle_win(80.0, 80.0)); // a tie holds the line
        assert!(!auto_battle_win(79.9, 80.0));
    }

    #[test]
    fn cap_replacement_prefers_the_stronger_card_over_the_weakest_bench() {
        // A stronger draft displaces the weakest bench card; a weaker one is discarded.
        let bench = [(10u64, 12.0f32), (11, 5.0), (12, 30.0)];
        let weakest = pick_weakest(&bench);
        assert_eq!(weakest, Some((11, 5.0)));
        assert!(should_replace(6.0, weakest.map(|(_, s)| s))); // 6 > 5 → replace
        assert!(!should_replace(4.0, weakest.map(|(_, s)| s))); // 4 < 5 → discard
        // Nothing cullable (all Active/Sentinel/Major) → never replace.
        assert_eq!(pick_weakest(&[]), None);
        assert!(!should_replace(9999.0, None));
    }

    #[test]
    fn hash_ignores_case_and_collapses_whitespace() {
        // Trivially-different phrasings of the same question share a cache entry.
        assert_eq!(
            question_hash("  What   is  a  Seal? "),
            question_hash("what is a seal?"),
        );
    }

    #[test]
    fn hash_distinguishes_different_questions() {
        assert_ne!(
            question_hash("what is a seal?"),
            question_hash("what is a spire?"),
        );
    }

    #[test]
    fn hash_of_blank_is_the_fnv_offset_basis() {
        // Whitespace-only normalizes to empty → the bare FNV-1a offset basis.
        assert_eq!(question_hash(""), 0xcbf29ce484222325);
        assert_eq!(question_hash("   \t \n"), 0xcbf29ce484222325);
    }

    #[test]
    fn hash_keeps_punctuation_significant() {
        // Current behavior: punctuation is not stripped, so these differ.
        assert_ne!(
            question_hash("what is a seal"),
            question_hash("what is a seal?"),
        );
    }

    #[test]
    fn duplicate_card_ids_are_detected_for_authoritative_validation() {
        assert!(!has_duplicates(&[]));
        assert!(!has_duplicates(&[1, 2, 3]));
        assert!(has_duplicates(&[1, 2, 1]));
        assert!(has_duplicates(&[7, 7]));
    }

    #[test]
    fn ecliptic_coordinates_compute_correct_zodiac_sign_and_degrees() {
        // Aldebaran: RA 68.98 deg, DEC 16.51 deg -> Gemini ~8 deg (ecliptic lon 68.5 deg)
        let (sign, deg, min, _sec) = compute_ecliptic(68.98, 16.51);
        assert_eq!(sign, "Gemini");
        assert!(deg >= 7 && deg <= 10);
        assert!(min <= 59);

        // Regulus: RA 152.09 deg, DEC 11.97 deg -> Leo ~29 deg
        let (sign_reg, _deg_reg, _, _) = compute_ecliptic(152.09, 11.97);
        assert_eq!(sign_reg, "Leo");
    }

    #[test]
    fn constellation_abbreviations_expand_properly() {
        assert_eq!(expand_constellation("Ori"), "Orion");
        assert_eq!(expand_constellation("CMa"), "Canis Major");
        assert_eq!(expand_constellation("Boo"), "Boötes");
    }
}
