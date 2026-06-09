//! Reducers — the only writers. Clients call these; they validate and mutate
//! transactionally, so the map is cheat-resistant by construction.

use crate::tables::*;
use crate::types::*;
use crate::{chart, combat, words};
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
/// The world's canonical horizon — the shared "field of play". The sign rising
/// here sets the elemental weather for every battle, sweeping the zodiac in real
/// time so round length varies by how fast a sign rises here. (New York City.)
const REF_LAT_DEG: f64 = 40.7128;
const REF_LON_DEG: f64 = -74.0060; // east-longitude negative
const OBLIQUITY_DEG: f64 = 23.439291; // mean obliquity, matches SkyMath.Obliquity

// ── The Ascendant clock (per-round re-draft) ────────────────────────────────
/// A player's whole card collection is capped here. A draft past the cap replaces
/// only the weakest *bench* card, and only if it's stronger (Active/Sentinel/trump
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
/// Word Duels of the Spheres: pace duels and size the (massive) token reward.
const WORD_DUEL_COOLDOWN_SECS: i64 = 20;
const TOKEN_PER_POINT: u64 = 50; // word_score × this is the base token reward
const BEAT_AGENT_BONUS: u64 = 500; // matching/beating the planetary agent's best word
const AGENT_RACK_SIZE: usize = 7; // tiles the agent draws — a standard Scrabble rack

// ── Lifecycle ─────────────────────────────────────────────────────────────

/// Runs once on first publish (and after a clear). `ctx.sender` is the owner.
#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    if ctx.db.game_config().id().find(&0).is_none() {
        ctx.db.game_config().insert(GameConfig {
            id: 0,
            owner: ctx.sender,
            season_degree: 0,
            ascendant_degree: 0,
            seeded: false,
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
            });
        }
    }

    seed_bright_stars(ctx);

    // Drive the persistent sky: tick every 10 seconds.
    ctx.db.sky_tick_timer().insert(SkyTickTimer {
        scheduled_id: 0,
        scheduled_at: ScheduleAt::Interval(Duration::from_secs(10).into()),
    });

    if let Some(mut cfg) = ctx.db.game_config().id().find(&0) {
        cfg.seeded = true;
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
    let mut chart = NatalChart { identity: ctx.sender, ..chart };
    chart::populate_houses(&mut chart);
    // Server owns identity — never trust a client-supplied one.
    let chart = NatalChart {
        identity: ctx.sender,
        ..chart
    };
    if ctx.db.natal_chart().identity().find(&ctx.sender).is_some() {
        ctx.db.natal_chart().identity().update(chart.clone());
    } else {
        ctx.db.natal_chart().insert(chart.clone());
    }

    // Re-registering re-mints the deck from scratch — clear any prior cards and
    // slots first so we never stack duplicates.
    let old_cards: Vec<u64> = ctx
        .db
        .card()
        .iter()
        .filter(|c| c.owner == ctx.sender)
        .map(|c| c.card_id)
        .collect();
    for cid in old_cards {
        ctx.db.card().card_id().delete(&cid);
    }
    let old_slots: Vec<u64> = ctx
        .db
        .deck_slot()
        .owner()
        .filter(&ctx.sender)
        .map(|s| s.slot_id)
        .collect();
    for sid in old_slots {
        ctx.db.deck_slot().slot_id().delete(&sid);
    }

    let asc_sign = ((chart.ascendant / 1800) % 12) as u8;
    let chart_ruler = chart::sign_ruler(asc_sign);
    let (deck_seed, _n) = chart::mint_deck(ctx, ctx.sender, &chart, chart_ruler);

    // Re-registration re-mints the deck but must never wipe the token wallet / ladder.
    let (tokens, word_wins) = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender)
        .map(|p| (p.tokens, p.word_wins))
        .unwrap_or((0, 0));
    let player = Player {
        identity: ctx.sender,
        handle,
        faction,
        deck_seed,
        created_at: ctx.timestamp,
        last_active: ctx.timestamp,
        tokens,
        word_wins,
    };
    if ctx.db.player().identity().find(&ctx.sender).is_some() {
        ctx.db.player().identity().update(player);
    } else {
        ctx.db.player().insert(player);
    }

    // Start (or restart, on re-registration) the player's Ascendant clock: reset the
    // round tally and arm exactly one round timer at the deck's current interval. The
    // re-draft reads the live sky through these freshly-stamped houses each round
    // (`chart::blended_faction_vector` over `live_transits`) — dignity-weighting stays
    // in scoring/minting, never combat (GDD §02).
    clear_round_timers(ctx, ctx.sender);
    let rstate = RoundState {
        identity: ctx.sender,
        round_index: 0,
        wins: 0,
        fights: 0,
        last_resolved_at: ctx.timestamp,
    };
    if ctx.db.round_state().identity().find(&ctx.sender).is_some() {
        ctx.db.round_state().identity().update(rstate);
    } else {
        ctx.db.round_state().insert(rstate);
    }
    schedule_next_round(ctx, ctx.sender);
    Ok(())
}

/// Record the caller's real-world location (private). The horizon it anchors
/// gates which stars they can engage. East-positive longitude, like the charts.
#[reducer]
pub fn set_location(ctx: &ReducerContext, lat: f64, lon: f64) -> Result<(), String> {
    if !(-90.0..=90.0).contains(&lat) || !(-180.0..=180.0).contains(&lon) {
        return Err("lat/lon out of range".into());
    }
    let row = PlayerLocation {
        identity: ctx.sender,
        lat,
        lon,
        updated_at: ctx.timestamp,
    };
    if ctx
        .db
        .player_location()
        .identity()
        .find(&ctx.sender)
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
        .find(|s| s.owner == ctx.sender)
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
                .filter(&ctx.sender)
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
                .filter(&ctx.sender)
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

/// Fuse two copies of the same card (same suit, rank, and trump-ness). The kept
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
    if keep.owner != ctx.sender || consume.owner != ctx.sender {
        return Err("you can only combine your own cards".into());
    }
    if keep.suit != consume.suit || keep.rank != consume.rank || keep.is_trump != consume.is_trump {
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
    if partner == ctx.sender {
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
        if c.owner != ctx.sender {
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
        proposer: ctx.sender,
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
    if ctx.sender == t.proposer {
        t.proposer_ok = true;
    } else if ctx.sender == t.partner {
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
    if ctx.sender != t.proposer && ctx.sender != t.partner {
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
        .find(&ctx.sender)
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
        .find(&ctx.sender)
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
        if c.owner != ctx.sender {
            return Err("you can only strike with your own cards".into());
        }
        if !has_loadout(ctx, ctx.sender, *cid, Loadout::Active) {
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
    let ap = attacker
        .iter()
        .map(|c| {
            let base = c.attack as f32 + c.health as f32 * 0.5 + c.armour as f32 * 0.4;
            let mult = combat::element_weather(c.suit, favored);
            let seal = if attacker_seals.contains(&c.suit) {
                combat::SEAL_BONUS
            } else {
                1.0
            };
            base * mult * seal
        })
        .sum::<f32>();
    let dp = defender
        .iter()
        .map(|c| {
            let base = c.attack as f32 + c.health as f32 * 0.5 + c.armour as f32 * 0.4;
            let mult = combat::element_weather(c.suit, favored);
            let seal = if defender_seals.contains(&c.suit) {
                combat::SEAL_BONUS
            } else {
                1.0
            };
            base * mult * seal
        })
        .sum::<f32>();
    if won {
        let prev = star.held_by;
        star.held_by = Some(player.faction);
        ctx.db.star_node().hip_id().update(star.clone());
        // Ingress double-control buff: active ingress zone corresponds to (season_degree / 30) % 12
        let cfg = ctx.db.game_config().id().find(&0).unwrap();
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
    tally_fight(ctx, ctx.sender, won);

    // Log the battle outcome for the client UI
    ctx.db.battle().insert(Battle {
        battle_id: 0,
        star_id: hip_id,
        attacker: ctx.sender,
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

/// Queue for a live duel in a zone; pairs with anyone already waiting to spawn
/// a real 3-lane Duel both clients then drive.
#[reducer]
pub fn enqueue_duel(ctx: &ReducerContext, zone_id: u8) -> Result<(), String> {
    let me = ctx
        .db
        .player()
        .identity()
        .find(&ctx.sender)
        .ok_or_else(|| "register first".to_string())?;

    if !can_access_zone(ctx, me.faction, zone_id) {
        return Err("Zone is locked. Faction must control adjacent zones first!".into());
    }

    let waiting = ctx
        .db
        .duel_queue()
        .iter()
        .find(|t| t.zone_id == zone_id && t.seeker != ctx.sender);

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
                ctx.db.natal_chart().identity().find(&ctx.sender),
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
                player_b: ctx.sender,
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
                .iter()
                .any(|t| t.zone_id == zone_id && t.seeker == ctx.sender);
            if !dup {
                ctx.db.duel_queue().insert(DuelQueue {
                    ticket_id: 0,
                    zone_id,
                    seeker: ctx.sender,
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
    let is_a = duel.player_a == ctx.sender;
    let is_b = duel.player_b == ctx.sender;
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
        if c.owner != ctx.sender {
            return Err("not your card".into());
        }
        if !has_loadout(ctx, ctx.sender, cid, Loadout::Active) {
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
    if duel.player_a != ctx.sender && duel.player_b != ctx.sender {
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

/// Bound the append-only history tables. `battle` and answered `oracle_request` /
/// `oracle_reply` rows are transient telemetry; past their TTL they only cost storage
/// and subscription bandwidth. One global pass per `tick_sky` — linear in the *retained*
/// window (which the prune itself keeps bounded), not the quadratic per-player scan #1
/// removed. `oracle_cache` is never touched — it's the asset we want to keep.
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
        // never drop a question still awaiting the companion service
        .filter(|r| r.answered && elapsed_secs(now, r.created_at) > ORACLE_TTL_SECS)
        .map(|r| r.request_id)
        .collect();
    for id in stale_reqs {
        ctx.db.oracle_request().request_id().delete(&id);
        ctx.db.oracle_reply().request_id().delete(&id);
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

        ctx.db.game_config().id().update(cfg);
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
    bot_raid(ctx);
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
    if ctx.sender != cfg.owner {
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
        None => false, // nothing cullable (all Active/Sentinel/trump) → discard the draft
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

/// The owner's hero ceiling: the strongest stats among their trump cards, so a draft
/// can be clamped strictly below the keystone. None if they hold no trump.
fn hero_ceiling(ctx: &ReducerContext, owner: Identity) -> Option<(u16, u16, u16)> {
    let mut best: Option<(u16, u16, u16)> = None;
    for c in ctx.db.card().owner().filter(&owner).filter(|c| c.is_trump) {
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
/// only if stronger — Active/Sentinel/trump cards are never culled.
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
        // Only bench, non-trump cards are cullable.
        let candidates: Vec<(u64, f32)> = ctx
            .db
            .deck_slot()
            .owner()
            .filter(&owner)
            .filter(|s| s.loadout == Loadout::Bench)
            .filter_map(|s| ctx.db.card().card_id().find(&s.card_id))
            .filter(|c| !c.is_trump)
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
        is_trump: false,
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
        .iter()
        .filter(|t| t.player == player)
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
    if ctx.sender != ctx.identity() {
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
    if let Some(rate) = ctx.db.oracle_rate().identity().find(&ctx.sender) {
        if elapsed_secs(ctx.timestamp, rate.last_at) < ORACLE_COOLDOWN_SECS {
            return Err("the Oracle is still considering your last question".into());
        }
        ctx.db.oracle_rate().identity().update(OracleRate {
            identity: ctx.sender,
            last_at: ctx.timestamp,
            count: rate.count + 1,
        });
    } else {
        ctx.db.oracle_rate().insert(OracleRate {
            identity: ctx.sender,
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
                asker: ctx.sender,
                question: q.to_string(),
                context,
                cacheable,
                qhash,
                answered: true,
                created_at: ctx.timestamp,
            });
            ctx.db.oracle_reply().insert(OracleReply {
                request_id: req.request_id,
                asker: ctx.sender,
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
        asker: ctx.sender,
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
    if ctx.sender != cfg.owner {
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
        .find(&ctx.sender)
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
    if let Some(rate) = ctx.db.word_rate().identity().find(&ctx.sender) {
        if elapsed_secs(ctx.timestamp, rate.last_at) < WORD_DUEL_COOLDOWN_SECS {
            return Err("the spheres still echo your last word — wait a moment".into());
        }
    }

    // You must hold the letters across your lettered Arcana.
    let have = player_letters(ctx, ctx.sender);
    if !words::can_spell(&w, &have) {
        return Err("your Arcana don't hold the letters for that word".into());
    }

    // Start/refresh the cooldown only now the cast is valid.
    if let Some(mut rate) = ctx.db.word_rate().identity().find(&ctx.sender) {
        rate.last_at = ctx.timestamp;
        rate.plays += 1;
        ctx.db.word_rate().identity().update(rate);
    } else {
        ctx.db.word_rate().insert(WordRate {
            identity: ctx.sender,
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
        player: ctx.sender,
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

/// Single-meter tug-of-war: positive `control` = the current `owner`'s hold.
fn apply_control(ctx: &ReducerContext, zone_id: u8, attacker: Planet, delta: i32) {
    if let Some(mut z) = ctx.db.zone().zone_id().find(&zone_id) {
        match z.owner {
            None => {
                z.owner = Some(attacker);
                z.control = delta.clamp(0, 1000);
            }
            Some(o) if o == attacker => {
                z.control = (z.control + delta).clamp(0, 1000);
            }
            Some(_) => {
                z.control -= delta;
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
fn sentinel_for(ctx: &ReducerContext, holder: Planet) -> Vec<combat::CardStat> {
    let mut out = Vec::new();
    for slot in ctx.db.deck_slot().iter() {
        if slot.loadout != Loadout::Defense {
            continue;
        }
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
fn bot_raid(ctx: &ReducerContext) {
    let mut counts = [0u32; 10];
    for p in ctx.db.player().iter() {
        counts[p.faction.idx()] += 1;
    }
    let mut raids = 0;
    for fac in ALL_PLANETS {
        if raids >= 2 {
            break;
        }
        if counts[fac.idx()] != 0 {
            continue;
        }
        if let Some(eph) = ctx.db.ephemeris().body().find(&fac) {
            let target = ctx
                .db
                .star_node()
                .iter()
                .find(|s| s.region_hint == eph.transiting_zone && s.held_by != Some(fac));
            if let Some(mut s) = target {
                s.held_by = Some(fac);
                let zone = s.region_hint;
                ctx.db.star_node().hip_id().update(s);
                apply_control(ctx, zone, fac, 60);
                raids += 1;
            }
        }
    }
}

/// Bright naked-eye stars as starting objectives. `region_hint` spreads them
/// across the eleven zones until the first scheduled sky tick recomputes it.
fn seed_bright_stars(ctx: &ReducerContext) {
    let stars: [(u32, &str, f64, f64, f32, u8); 8] = [
        (32349, "Sirius", 101.287, -16.716, -1.46, 0),
        (30438, "Canopus", 95.988, -52.696, -0.74, 1),
        (69673, "Arcturus", 213.915, 19.182, -0.05, 2),
        (91262, "Vega", 279.234, 38.784, 0.03, 3),
        (24608, "Capella", 79.172, 45.998, 0.08, 4),
        (24436, "Rigel", 78.634, -8.202, 0.13, 5),
        (37279, "Procyon", 114.825, 5.225, 0.34, 6),
        (11767, "Polaris", 37.954, 89.264, 1.98, 10),
    ];
    for (hip_id, name, ra, dec, magnitude, region_hint) in stars {
        if ctx.db.star_node().hip_id().find(&hip_id).is_none() {
            ctx.db.star_node().insert(StarNode {
                hip_id,
                name: name.to_string(),
                ra,
                dec,
                magnitude,
                held_by: None,
                region_hint,
            });
        }
    }
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
    if ctx.sender != cfg.owner {
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

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        auto_battle_win, catchup_rounds, has_duplicates, pick_weakest, question_hash,
        round_interval_secs, should_replace, COLLECTION_CAP, MAX_CATCHUP_ROUNDS, ROUND_BASE_SECS,
    };

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
        // Nothing cullable (all Active/Sentinel/trump) → never replace.
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
}
