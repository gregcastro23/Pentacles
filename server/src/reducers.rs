//! Reducers — the only writers. Clients call these; they validate and mutate
//! transactionally, so the map is cheat-resistant by construction.

use crate::types::*;
use crate::{chart, combat};
use crate::tables::*;
use spacetimedb::{reducer, ReducerContext, ScheduleAt, Table, Timestamp};
use std::time::Duration;

const FLIP_THRESHOLD: i32 = 600;
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
        .iter()
        .filter(|s| s.owner == ctx.sender)
        .map(|s| s.slot_id)
        .collect();
    for sid in old_slots {
        ctx.db.deck_slot().slot_id().delete(&sid);
    }

    let asc_sign = ((chart.ascendant / 1800) % 12) as u8;
    let chart_ruler = chart::sign_ruler(asc_sign);
    let (deck_seed, _n) = chart::mint_deck(ctx, ctx.sender, &chart, chart_ruler);

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
    if ctx.db.player_location().identity().find(&ctx.sender).is_some() {
        ctx.db.player_location().identity().update(row);
    } else {
        ctx.db.player_location().insert(row);
    }
    Ok(())
}

/// Move one of your cards between loadouts. Active is capped at 8 — bench a card
/// before promoting another. Lets players curate their fielded eight.
#[reducer]
pub fn set_loadout(ctx: &ReducerContext, card_id: u64, loadout: Loadout) -> Result<(), String> {
    let card = ctx
        .db
        .card()
        .card_id()
        .find(&card_id)
        .ok_or_else(|| "no such card".to_string())?;
    if card.owner != ctx.sender {
        return Err("not your card".into());
    }
    let mut slot = ctx
        .db
        .deck_slot()
        .iter()
        .find(|s| s.owner == ctx.sender && s.card_id == card_id)
        .ok_or_else(|| "card not in your deck".to_string())?;
    if slot.loadout == loadout {
        return Ok(());
    }
    if loadout == Loadout::Active {
        let active = ctx
            .db
            .deck_slot()
            .iter()
            .filter(|s| s.owner == ctx.sender && s.loadout == Loadout::Active)
            .count();
        if active >= 8 {
            return Err("Active is full (8) — bench a card first".into());
        }
    }
    slot.loadout = loadout;
    ctx.db.deck_slot().slot_id().update(slot);
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

    // Gather the attacker's played cards (validate ownership).
    let mut attacker: Vec<combat::CardStat> = Vec::new();
    for cid in &log.plays {
        if let Some(c) = ctx.db.card().card_id().find(cid) {
            if c.owner == ctx.sender {
                attacker.push(combat::CardStat {
                    suit: c.suit,
                    attack: c.attack,
                    health: c.health,
                    armour: c.armour,
                });
            }
        }
    }
    if attacker.is_empty() {
        return Err("no valid cards played".into());
    }

    let defender = match star.held_by {
        Some(holder) => sentinel_for(ctx, holder),
        None => neutral_garrison(&star),
    };

    let favored = zone_favored_suit(ctx, star.region_hint);
    let attacker_seals = sealed_suits(ctx, player.faction);
    let defender_seals = star.held_by.map(|f| sealed_suits(ctx, f)).unwrap_or_default();
    let (won, margin) =
        combat::resolve_star(&attacker, &defender, favored, &attacker_seals, &defender_seals);
    if won {
        let prev = star.held_by;
        star.held_by = Some(player.faction);
        ctx.db.star_node().hip_id().update(star.clone());
        apply_control(
            ctx,
            star.region_hint,
            player.faction,
            combat::control_delta(star.magnitude, margin),
        );
        let _ = prev;
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
    let favored = zone_favored_suit(ctx, duel.zone_id);
    let a_seals = sealed_suits(ctx, duel.faction_a);
    let b_seals = sealed_suits(ctx, duel.faction_b);
    let mut a = 0u8;
    let mut b = 0u8;
    for lane in 0..3usize {
        let ca = ctx.db.card().card_id().find(&duel.a_cards[lane]);
        let cb = ctx.db.card().card_id().find(&duel.b_cards[lane]);
        if let (Some(x), Some(y)) = (ca, cb) {
            if lane_power(&x, favored, &a_seals) >= lane_power(&y, favored, &b_seals) { a += 1; } else { b += 1; }
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
}

fn lane_power(att: &Card, favored: Suit, sealed: &[Suit]) -> f32 {
    let s = att.attack as f32 + att.health as f32 * 0.5 + att.armour as f32 * 0.4;
    let seal = if sealed.contains(&att.suit) { combat::SEAL_BONUS } else { 1.0 };
    s * combat::element_weather(att.suit, favored) * seal
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
    true
}

/// Whole seconds between two timestamps (`later − earlier`), floored at 0.
fn elapsed_secs(later: Timestamp, earlier: Timestamp) -> i64 {
    let micros = later.to_micros_since_unix_epoch() - earlier.to_micros_since_unix_epoch();
    (micros / 1_000_000).max(0)
}

// ── Scheduled & owner feeds ───────────────────────────────────────────────

/// Fires on the schedule: decays held zones, wheels the living sky, sweeps
/// stalled duels, and lets unmanned factions raid.
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
    advance_round_clock(ctx);  // round weather: which sign is rising at the world horizon
    recompute_star_zones(ctx); // A — de-freeze the sky before bots read hints
    sweep_stale_duels(ctx);    // B — auto-resolve abandoned duels
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

/// The suit favored in a given zone right now. One world Ascendant (stored in
/// season_degree) sets the rising sign; the 12 signs rotate through the 11 zones
/// (`zone_sign = rising_sign + zone_id`), so each zone carries its own weather and
/// a contest is decided by the contested zone's element.
fn zone_favored_suit(ctx: &ReducerContext, zone_id: u8) -> Suit {
    let deg = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .map(|c| c.season_degree)
        .unwrap_or(0);
    let rising_sign = (deg / 30) % 12;
    let zone_sign = ((rising_sign + zone_id as u16) % 12) as u8;
    chart::sign_element(zone_sign)
}

/// The suits a faction currently holds a zodiac seal in: the elements of the signs
/// sitting in the zones it owns right now. The sky rotates, so the set shifts —
/// holding a zone while its sign is up grants that element's mastery, and the
/// faction's cards of that suit fight at `combat::SEAL_BONUS` wherever they contest.
fn sealed_suits(ctx: &ReducerContext, faction: Planet) -> Vec<Suit> {
    let deg = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .map(|c| c.season_degree)
        .unwrap_or(0);
    let rising = deg / 30;
    let mut suits = Vec::new();
    for z in ctx.db.zone().iter() {
        if z.owner == Some(faction) {
            let sign = ((rising + z.zone_id as u16) % 12) as u8;
            let suit = chart::sign_element(sign);
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
        if deg != cfg.season_degree {
            cfg.season_degree = deg;
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
                out.push(combat::CardStat {
                    suit: c.suit,
                    attack: c.attack,
                    health: c.health,
                    armour: c.armour,
                });
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
