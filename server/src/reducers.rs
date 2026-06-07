//! Reducers — the only writers. Clients call these; they validate and mutate
//! transactionally, so the map is cheat-resistant by construction.

use crate::types::*;
use crate::{chart, combat};
use crate::tables::*;
use spacetimedb::{reducer, Identity, ReducerContext, ScheduleAt, Table};
use std::time::Duration;

const FLIP_THRESHOLD: i32 = 600;

// Sky-Drop power ceilings — strictly below the hero trump (60/40/20), so a
// won card widens the deck without inflating raw power (GDD §04).
const SKY_DROP_HP_CAP: u16 = 55;
const SKY_DROP_ATK_CAP: u16 = 38;
const SKY_DROP_ARM_CAP: u16 = 18;
const DEFAULT_COLLECTION_CAP: u32 = 60;

// Capture-amplifier knobs (GDD §07; all tunable). The transit buff rewards a
// faction for fighting under its own planet; the Crown buffs its neighbours;
// Jupiter snowballs off adjacent zones it already holds.
const CROWN_ZONE: u8 = 10;
const TRANSIT_BUFF: f32 = 1.5;
const CROWN_BUFF: f32 = 1.25;
const JUPITER_SNOWBALL: f32 = 0.15;

// Card veterancy (GDD §06): survivors of a battle earn XP and level up.
const XP_PER_SURVIVAL: u32 = 10;
const MAX_LEVEL: u8 = 10;

// Pluto attrition (GDD §03/§07): a zone's death charge lifts Pluto's capture
// power there. Each stack lives ATTRITION_TTL ticks; the bonus is capped.
const ATTRITION_TTL: u64 = 30; // ~5 min at the 10s tick
const ATTRITION_SCALE: f32 = 0.03;
const ATTRITION_MAX: f32 = 0.6;

// Venus alliance doctrine + general relations (GDD §03/§07).
const VENUS_SPILL: f32 = 0.25;     // capture control spilled to each adjacent ally
const VENUS_COALITION: f32 = 1.25; // defensive lift for zones flanking Venus
const RIVAL_ATK: f32 = 1.15;       // both sides hit harder in a rival clash

// ── Lifecycle ─────────────────────────────────────────────────────────────

/// Runs once on first publish (and after a clear). `ctx.sender` is the owner.
#[reducer(init)]
pub fn init(ctx: &ReducerContext) {
    if ctx.db.game_config().id().find(&0).is_none() {
        ctx.db.game_config().insert(GameConfig {
            id: 0,
            owner: ctx.sender,
            season_degree: 0,
            seeded: false,
            collection_cap: DEFAULT_COLLECTION_CAP,
            tick_count: 0,
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

    seed_demo_stars(ctx);

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

    // Server owns identity — never trust a client-supplied one.
    let chart = NatalChart { identity: ctx.sender, ..chart };
    if ctx.db.natal_chart().identity().find(&ctx.sender).is_some() {
        ctx.db.natal_chart().identity().update(chart.clone());
    } else {
        ctx.db.natal_chart().insert(chart.clone());
    }

    let asc_sign = ((chart.ascendant / 1800) % 12) as u8;
    let chart_ruler = chart::sign_ruler(asc_sign);
    let (deck_seed, _n) = chart::mint_deck(ctx, ctx.sender, &chart, faction, chart_ruler);

    let player = Player {
        identity: ctx.sender,
        handle,
        faction,
        deck_seed,
        created_at: ctx.timestamp,
        last_active: ctx.timestamp,
    };
    if ctx.db.player().identity().find(&ctx.sender).is_some() {
        ctx.db.player().identity().update(player);
    } else {
        ctx.db.player().insert(player);
    }
    Ok(())
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

    // Hard non-aggression: you cannot besiege an allied faction (GDD §03).
    if let Some(h) = star.held_by {
        if combat::relation(player.faction, h) == combat::Relation::Ally {
            return Err("cannot besiege an allied faction's star".into());
        }
    }

    // Gather the attacker's played cards (validate ownership), keeping a
    // parallel id list for XP. Retrograde cards resolve as their defensive
    // variant via card_stat().
    let mut attacker: Vec<combat::CardStat> = Vec::new();
    let mut attacker_ids: Vec<u64> = Vec::new();
    for cid in &log.plays {
        if let Some(c) = ctx.db.card().card_id().find(cid) {
            if c.owner == ctx.sender {
                attacker.push(card_stat(&c));
                attacker_ids.push(c.card_id);
            }
        }
    }
    if attacker.is_empty() {
        return Err("no valid cards played".into());
    }
    // Sun/Mars press their attack doctrine (GDD §03).
    scale_attack(&mut attacker, combat::faction_atk_mult(player.faction));

    let (mut defender, holder) = match star.held_by {
        Some(h) => (sentinel_for(ctx, h), Some(h)),
        None => (neutral_garrison(&star), None),
    };
    // The holder's defensive doctrine (Saturn wall, Mars soft) shapes the wall.
    if let Some(h) = holder {
        scale_defense(&mut defender, combat::faction_def_mult(h));
        // Rivalry: opposed factions fight harder, on both sides (GDD §03).
        if combat::relation(player.faction, h) == combat::Relation::Rival {
            scale_attack(&mut attacker, RIVAL_ATK);
            scale_attack(&mut defender, RIVAL_ATK);
        }
        // Venus coalition: a zone flanking Venus territory, held by Venus or one
        // of its allies, defends behind a stiffer wall (GDD §03).
        let venus_adjacent = zone_neighbors(star.region_hint).iter().any(|n| {
            ctx.db.zone().zone_id().find(n).and_then(|z| z.owner) == Some(Planet::Venus)
        });
        if venus_adjacent
            && (h == Planet::Venus
                || combat::relation(Planet::Venus, h) == combat::Relation::Ally)
        {
            scale_defense(&mut defender, VENUS_COALITION);
        }
    }

    // Round-based attrition (GDD §06).
    let outcome = combat::simulate_battle(&attacker, &defender);
    // Survivors earn XP; the fallen (both sides) feed the zone's attrition.
    for &i in &outcome.attacker_survivors {
        grant_xp(ctx, attacker_ids[i], XP_PER_SURVIVAL);
    }
    feed_attrition(ctx, star.region_hint, outcome.destroyed);

    if outcome.attacker_won {
        star.held_by = Some(player.faction);
        ctx.db.star_node().hip_id().update(star.clone());
        // Capture pressure, amplified by transit / Crown / snowball / attrition.
        let base = combat::control_delta(star.magnitude, outcome.margin) as f32;
        let delta = (base * capture_multiplier(ctx, player.faction, star.region_hint)) as i32;
        apply_control(ctx, star.region_hint, player.faction, delta);
        // Venus alliance: spill partial control into adjacent allied zones.
        venus_spillover(ctx, star.region_hint, player.faction, delta);
        // Spoils of the capture: mint one Sky-Drop card (GDD §04).
        mint_sky_drop(
            ctx,
            ctx.sender,
            player.faction,
            player.deck_seed,
            star.region_hint,
            star.magnitude,
        );
    }

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
            // Hard non-aggression — allied factions cannot duel (GDD §03).
            if combat::relation(me.faction, opp.faction) == combat::Relation::Ally {
                return Err("cannot duel an allied faction".into());
            }
            ctx.db.duel_queue().ticket_id().delete(&t.ticket_id);
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
    for cid in [lane0, lane1, lane2] {
        let c = ctx
            .db
            .card()
            .card_id()
            .find(&cid)
            .ok_or_else(|| "card not found".to_string())?;
        if c.owner != ctx.sender {
            return Err("not your card".into());
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

/// Lane-by-lane (suit-triangle scaled); best-of-3 wins and shifts the zone.
fn resolve_duel(ctx: &ReducerContext, duel: &mut Duel) {
    let am = combat::faction_atk_mult(duel.faction_a);
    let bm = combat::faction_atk_mult(duel.faction_b);
    // Rivalry fervour lifts both sides (allied duels are blocked at enqueue).
    let (am, bm) = if combat::relation(duel.faction_a, duel.faction_b) == combat::Relation::Rival {
        (am * RIVAL_ATK, bm * RIVAL_ATK)
    } else {
        (am, bm)
    };
    let mut a = 0u8;
    let mut b = 0u8;
    let mut winners: Vec<u64> = Vec::new(); // surviving lane victors → XP
    let mut destroyed = 0u32;               // lane losers fall → attrition
    for lane in 0..3usize {
        let ca = ctx.db.card().card_id().find(&duel.a_cards[lane]);
        let cb = ctx.db.card().card_id().find(&duel.b_cards[lane]);
        if let (Some(x), Some(y)) = (ca, cb) {
            if lane_power(&x, &y, am) >= lane_power(&y, &x, bm) {
                a += 1;
                winners.push(x.card_id);
            } else {
                b += 1;
                winners.push(y.card_id);
            }
            destroyed += 1; // the losing lane card is destroyed
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
    for cid in &winners {
        grant_xp(ctx, *cid, XP_PER_SURVIVAL);
    }
    feed_attrition(ctx, duel.zone_id, destroyed);
    let base = (150 + a.max(b) as i32 * 60) as f32;
    let delta = (base * capture_multiplier(ctx, faction, duel.zone_id)) as i32;
    apply_control(ctx, duel.zone_id, faction, delta);
    venus_spillover(ctx, duel.zone_id, faction, delta);

    // Sky-Drop for the duel winner, seeded by the contested zone's brightest star.
    if let Some(wp) = ctx.db.player().identity().find(&winner) {
        let mag = ctx
            .db
            .star_node()
            .iter()
            .filter(|s| s.region_hint == duel.zone_id)
            .map(|s| s.magnitude)
            .fold(f32::INFINITY, |m, x| m.min(x));
        let mag = if mag.is_finite() { mag } else { 2.5 };
        mint_sky_drop(ctx, winner, faction, wp.deck_seed, duel.zone_id, mag);
    }
}

fn lane_power(att: &Card, def: &Card, att_atk_mult: f32) -> f32 {
    let a = card_stat(att); // bakes the retrograde defensive variant
    let d = card_stat(def);
    let s = a.attack as f32 * att_atk_mult + a.health as f32 * 0.5 + a.armour as f32 * 0.4;
    s * combat::suit_multiplier(a.suit, d.suit)
}

// ── Scheduled & owner feeds ───────────────────────────────────────────────

/// Fires on the schedule: decays held zones and lets unmanned factions raid.
#[reducer]
pub fn tick_sky(ctx: &ReducerContext, _timer: SkyTickTimer) {
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
    bot_raid(ctx);
    advance_season(ctx);
    purge_attrition(ctx);
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
    let row = Ephemeris { body, ra, dec, transiting_zone, tick: ctx.timestamp };
    if ctx.db.ephemeris().body().find(&body).is_some() {
        ctx.db.ephemeris().body().update(row);
    } else {
        ctx.db.ephemeris().insert(row);
    }
    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────

fn decay_rate(z: &Zone) -> i32 {
    match z.owner {
        Some(Planet::Saturn) => 4, // the wall holds longer
        Some(Planet::Moon) => 5,   // the tides sustain — a slower bleed
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

/// Mint one Sky-Drop card for `owner` after a capture (GDD §04 · Sky Drops).
///
/// Suit & `source_body` come from the planet transiting `zone` (else the
/// victor's faction bias); rank/tier from the star's brightness; sub-stats from
/// a deterministic battle seed. Stats are clamped strictly below the hero trump,
/// the card lands on the Bench, and the collection cap is honoured with a
/// replace-weakest-Bench-card-if-stronger overflow rule.
fn mint_sky_drop(
    ctx: &ReducerContext,
    owner: Identity,
    faction: Planet,
    player_seed: u64,
    zone: u8,
    magnitude: f32,
) {
    // Suit & source ← the planet transiting this zone, else the victor's bias.
    let (suit, source_body) = ctx
        .db
        .ephemeris()
        .iter()
        .find(|e| e.transiting_zone == zone)
        .map(|e| (e.body.biased_suit(), e.body))
        .unwrap_or((faction.biased_suit(), faction));

    // Power tier ← star brightness; pip ranks 1..10 only (never court/hero).
    let weight = combat::node_weight(magnitude); // ~0.4 (faint) .. ~8 (Sirius)
    let rank = ((weight * 1.4).round() as i32).clamp(1, 10) as u8;
    let degree = (rank as u16 - 1) * 29 / 9; // rank 1..10 → stat tier 0..29

    // Deterministic sub-roll from a battle seed (victor + zone + body + count).
    let owned = ctx.db.card().iter().filter(|c| c.owner == owner).count() as u32;
    let seed = drop_seed(player_seed, zone, source_body, magnitude, owned as u64);
    let sub = (seed % 60) as u16; // 0..59, mirrors a placement's arc-minute

    // Stats mirror the natal feel, then clamp strictly below the hero trump.
    let health =
        (12 + sub * 28 / 59 + if suit == Suit::Cups { 10 } else { 0 }).min(SKY_DROP_HP_CAP);
    let attack =
        (6 + degree + if suit == Suit::Swords { 6 } else { 0 }).min(SKY_DROP_ATK_CAP);
    let armour = (4 + if suit == Suit::Pentacles { 6 } else { 0 }).min(SKY_DROP_ARM_CAP);
    let cooldown_ms = (3000_i32
        - if suit == Suit::Wands { 600 } else { 0 }
        - degree as i32 * 20)
        .clamp(1000, 3000) as u16;
    let new_strength = card_power(attack, health, armour);

    // Collection cap: when full, replace the weakest Bench (non-trump) card —
    // but only if the drop is stronger. Active & Sentinel cards are never touched.
    let cap = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .map(|c| c.collection_cap)
        .unwrap_or(DEFAULT_COLLECTION_CAP);
    if owned >= cap {
        let mut weakest: Option<Card> = None;
        for slot in ctx.db.deck_slot().iter() {
            if slot.owner != owner || slot.loadout != Loadout::Bench {
                continue;
            }
            if let Some(c) = ctx.db.card().card_id().find(&slot.card_id) {
                if c.is_trump {
                    continue;
                }
                let replace = match &weakest {
                    Some(w) => {
                        card_power(c.attack, c.health, c.armour)
                            < card_power(w.attack, w.health, w.armour)
                    }
                    None => true,
                };
                if replace {
                    weakest = Some(c);
                }
            }
        }
        match weakest {
            Some(w) if new_strength > card_power(w.attack, w.health, w.armour) => {
                let slots: Vec<u64> = ctx
                    .db
                    .deck_slot()
                    .iter()
                    .filter(|s| s.card_id == w.card_id)
                    .map(|s| s.slot_id)
                    .collect();
                for sid in &slots {
                    ctx.db.deck_slot().slot_id().delete(sid);
                }
                ctx.db.card().card_id().delete(&w.card_id);
            }
            _ => {
                log::info!("sky-drop discarded — collection full ({} >= {})", owned, cap);
                return;
            }
        }
    }

    let card = ctx.db.card().insert(Card {
        card_id: 0,
        owner,
        name: chart::card_name(suit, rank),
        suit,
        rank,
        health,
        attack,
        armour,
        cooldown_ms,
        source_body,
        inverted: false,
        is_trump: false,
        level: 1,
        xp: 0,
    });
    ctx.db.deck_slot().insert(DeckSlot {
        slot_id: 0,
        owner,
        card_id: card.card_id,
        loadout: Loadout::Bench,
    });
    log::info!("sky-drop minted: {:?} rank {} (zone {})", suit, rank, zone);
}

/// Effective strength of a card's flat stats (mirrors `combat::card_strength`).
fn card_power(attack: u16, health: u16, armour: u16) -> f32 {
    attack as f32 + health as f32 * 0.5 + armour as f32 * 0.4
}

/// XP needed to clear the current level.
fn xp_to_next(level: u8) -> u32 {
    level as u32 * 100
}

/// Award XP to a surviving card; each level grants a small permanent stat bump
/// (GDD §06). Levels are capped to bound power creep.
fn grant_xp(ctx: &ReducerContext, card_id: u64, amount: u32) {
    if let Some(mut c) = ctx.db.card().card_id().find(&card_id) {
        c.xp = c.xp.saturating_add(amount);
        while c.level < MAX_LEVEL && c.xp >= xp_to_next(c.level) {
            c.xp -= xp_to_next(c.level);
            c.level += 1;
            c.attack = c.attack.saturating_add(1);
            c.health = c.health.saturating_add(2);
            c.armour = c.armour.saturating_add(1);
        }
        ctx.db.card().card_id().update(c);
    }
}

/// Venus alliance spillover (GDD §03/§07): a fraction of the control banked on
/// a capture flows into each adjacent zone held by a Venus ally, reinforcing it.
fn venus_spillover(ctx: &ReducerContext, zone: u8, faction: Planet, delta: i32) {
    if faction != Planet::Venus {
        return;
    }
    let spill = (delta as f32 * VENUS_SPILL) as i32;
    if spill <= 0 {
        return;
    }
    for n in zone_neighbors(zone) {
        if let Some(z) = ctx.db.zone().zone_id().find(n) {
            if let Some(owner) = z.owner {
                if combat::relation(Planet::Venus, owner) == combat::Relation::Ally {
                    apply_control(ctx, *n, owner, spill);
                }
            }
        }
    }
}

/// Record a zone's battle deaths as a Pluto attrition stack (GDD §03/§07).
fn feed_attrition(ctx: &ReducerContext, zone: u8, destroyed: u32) {
    if destroyed == 0 {
        return;
    }
    let tick = ctx.db.game_config().id().find(&0).map(|c| c.tick_count).unwrap_or(0);
    ctx.db.attrition().insert(Attrition {
        id: 0,
        zone_id: zone,
        amount: destroyed,
        expires_tick: tick + ATTRITION_TTL,
    });
}

/// Drop attrition stacks whose lifetime has elapsed (called each sky tick).
fn purge_attrition(ctx: &ReducerContext) {
    let tick = ctx.db.game_config().id().find(&0).map(|c| c.tick_count).unwrap_or(0);
    let expired: Vec<u64> = ctx
        .db
        .attrition()
        .iter()
        .filter(|a| a.expires_tick <= tick)
        .map(|a| a.id)
        .collect();
    for id in &expired {
        ctx.db.attrition().id().delete(id);
    }
}

/// Flat combat stats for a card. A retrograde card is its **defensive variant**
/// (GDD §04 · "inverted card"): half its attack is poured into armour & health.
fn card_stat(c: &Card) -> combat::CardStat {
    if c.inverted {
        let a = c.attack;
        combat::CardStat {
            suit: c.suit,
            attack: a / 2,
            health: c.health + a / 4,
            armour: c.armour + a / 2,
        }
    } else {
        combat::CardStat { suit: c.suit, attack: c.attack, health: c.health, armour: c.armour }
    }
}

/// Scale a side's attack in place by a faction multiplier (no-op at 1.0).
fn scale_attack(stats: &mut [combat::CardStat], mult: f32) {
    if (mult - 1.0).abs() < f32::EPSILON {
        return;
    }
    for c in stats.iter_mut() {
        c.attack = (c.attack as f32 * mult) as u16;
    }
}

/// Scale a side's defense (health & armour) in place by a faction multiplier.
fn scale_defense(stats: &mut [combat::CardStat], mult: f32) {
    if (mult - 1.0).abs() < f32::EPSILON {
        return;
    }
    for c in stats.iter_mut() {
        c.health = (c.health as f32 * mult) as u16;
        c.armour = (c.armour as f32 * mult) as u16;
    }
}

/// Static shared-edge adjacency for the eleven Pentacle zones (GDD §05). Outer
/// ring H0 S5 H1 S6 H2 S7 H3 S8 H4 S9, with the Crown (10) bordering every spire.
fn zone_neighbors(zone_id: u8) -> &'static [u8] {
    match zone_id {
        0 => &[9, 5],            // House 0  ← flanking spires 9 & 5
        1 => &[5, 6],            // House 1
        2 => &[6, 7],            // House 2
        3 => &[7, 8],            // House 3
        4 => &[8, 9],            // House 4
        5 => &[0, 1, 10],        // Spire 5  ← houses 0,1 & the Crown
        6 => &[1, 2, 10],        // Spire 6
        7 => &[2, 3, 10],        // Spire 7
        8 => &[3, 4, 10],        // Spire 8
        9 => &[4, 0, 10],        // Spire 9
        10 => &[5, 6, 7, 8, 9],  // Crown    ← every spire
        _ => &[],
    }
}

/// Capture amplifier for `faction` taking `zone` (GDD §07): the transit buff,
/// the Crown's dominion over its neighbours, and Jupiter's snowball.
fn capture_multiplier(ctx: &ReducerContext, faction: Planet, zone: u8) -> f32 {
    let mut m = 1.0f32;

    // Transit buff — the faction's own planet is currently over this zone.
    if let Some(eph) = ctx.db.ephemeris().body().find(&faction) {
        if eph.transiting_zone == zone {
            m *= TRANSIT_BUFF;
        }
    }

    // Crown dominion — owning the Crown amplifies its adjacent contests.
    if zone_neighbors(CROWN_ZONE).contains(&zone) {
        if let Some(crown) = ctx.db.zone().zone_id().find(&CROWN_ZONE) {
            if crown.owner == Some(faction) {
                m *= CROWN_BUFF;
            }
        }
    }

    // Jupiter snowball — momentum from each adjacent zone it already holds.
    if faction == Planet::Jupiter {
        let held = zone_neighbors(zone)
            .iter()
            .filter(|n| {
                ctx.db.zone().zone_id().find(*n).and_then(|z| z.owner) == Some(Planet::Jupiter)
            })
            .count();
        m *= 1.0 + JUPITER_SNOWBALL * held as f32;
    }

    // Pluto attrition — the zone's live death charge lifts its captures.
    if faction == Planet::Pluto {
        let charge: u32 = ctx
            .db
            .attrition()
            .iter()
            .filter(|a| a.zone_id == zone)
            .map(|a| a.amount)
            .sum();
        m *= 1.0 + (ATTRITION_SCALE * charge as f32).min(ATTRITION_MAX);
    }

    m
}

/// Turn the Great Wheel one degree per tick (GDD §07). Every 30° is a sign
/// ingress; completing 360° resolves the season and soft-resets the map —
/// holds are halved (winners keep a head-start edge), never wiped.
fn advance_season(ctx: &ReducerContext) {
    let Some(mut cfg) = ctx.db.game_config().id().find(&0) else { return };
    cfg.tick_count = cfg.tick_count.wrapping_add(1);
    let next = cfg.season_degree + 1;
    if next >= 360 {
        cfg.season_degree = 0;
        for mut z in ctx.db.zone().iter() {
            if z.control > 0 {
                z.control /= 2;
                z.updated_at = ctx.timestamp;
                ctx.db.zone().zone_id().update(z);
            }
        }
        log::info!("the Great Wheel completes — season resolved, map soft-reset");
    } else {
        cfg.season_degree = next;
        if next % 30 == 0 {
            log::info!("sign ingress at {}° — a region of the sky re-weights", next);
        }
    }
    ctx.db.game_config().id().update(cfg);
}

/// FNV-1a battle seed for a Sky-Drop's deterministic sub-roll.
fn drop_seed(player_seed: u64, zone: u8, body: Planet, magnitude: f32, count: u64) -> u64 {
    let mut h = player_seed ^ 0xcbf29ce484222325;
    for b in [zone as u64, body.idx() as u64, magnitude.to_bits() as u64, count] {
        h ^= b;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
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
                out.push(card_stat(&c));
                if out.len() >= 8 {
                    break;
                }
            }
        }
    }
    if out.is_empty() {
        // No human sentinel — fall back to a token guardian scaled to the planet.
        out.push(combat::CardStat { suit: holder.biased_suit(), attack: 18, health: 30, armour: 10 });
    }
    out
}

/// A neutral star's baseline guardian, tougher for brighter stars.
fn neutral_garrison(star: &StarNode) -> Vec<combat::CardStat> {
    let w = combat::node_weight(star.magnitude);
    let base = (10.0 + w * 6.0) as u16;
    vec![
        combat::CardStat { suit: Suit::Pentacles, attack: base / 2, health: base * 2, armour: base },
        combat::CardStat { suit: Suit::Cups, attack: base / 2, health: base * 2, armour: base / 2 },
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

/// A few bright naked-eye stars as starting objectives (real catalogue loads
/// via `push`/CLI later). region_hint spreads them across the eleven zones.
fn seed_demo_stars(ctx: &ReducerContext) {
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
