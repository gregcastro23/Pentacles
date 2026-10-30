//! Owner-fed public ratings for seeded NPC identities. No human wallet/chart data.
use crate::tables::*;
use serde::Deserialize;
use spacetimedb::{Identity, ReducerContext, Table};
use std::collections::BTreeMap;

const STATS: [&str; 7] = [
    "power",
    "resonance",
    "wisdom",
    "charisma",
    "intuition",
    "adaptability",
    "vitality",
];
const TIERS: [&str; 5] = ["Copper", "Silver", "Gold", "Astral", "Celestial"];
const MULTIPLIERS: [f64; 5] = [1.05, 1.10, 1.18, 1.28, 1.40];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Snapshot {
    version: u8,
    source_key: String,
    chart_placeholder: bool,
    ratings: Vec<u8>,
    esms: Vec<f64>,
    esms_source: String,
    seals: Vec<Seal>,
    surge: Option<Surge>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Seal {
    id: String,
    name: String,
    description: String,
    category: String,
    tier: String,
    stat_key: Option<String>,
    multiplier: f64,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Surge {
    meter: f64,
    active: bool,
    surge_type: String,
    monica: Option<f64>,
    monica_state: String,
    heat: f64,
    reactivity: f64,
    stat_boosts: BTreeMap<String, f64>,
}
fn valid_key(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.as_bytes()[0].is_ascii_alphanumeric()
        && s.bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
}
fn bounded(v: f64, low: f64, high: f64) -> bool {
    v.is_finite() && v >= low && v <= high
}
fn short(s: &str, max: usize) -> bool {
    !s.is_empty() && s.chars().count() <= max
}
fn validate_snapshot(json: &str) -> Result<(), String> {
    if json.len() > 32_768 {
        return Err("rating snapshot too large".into());
    }
    let p: Snapshot = serde_json::from_str(json).map_err(|_| "invalid rating snapshot schema")?;
    if p.version != 1
        || !valid_key(&p.source_key)
        || p.ratings.len() != 7
        || p.ratings.iter().any(|v| !(25..=99).contains(v))
        || p.esms.len() != 4
        || p.esms
            .iter()
            .any(|v| !bounded(*v, 0.0, 9_007_199_254_740_991.0))
        || !["database", "spacetimedb", "unavailable"].contains(&p.esms_source.as_str())
        || p.seals.len() > 32
    {
        return Err("invalid rating values".into());
    }
    if p.esms_source == "unavailable" && (p.esms.iter().any(|v| *v != 0.0) || !p.seals.is_empty()) {
        return Err("unavailable ESMS cannot grant seals".into());
    }
    for s in p.seals {
        let tier = TIERS
            .iter()
            .position(|t| *t == s.tier)
            .ok_or("invalid seal tier")?;
        if !short(&s.id, 100)
            || !short(&s.name, 120)
            || !short(&s.description, 500)
            || !["spirit", "essence", "matter", "substance", "general"]
                .contains(&s.category.as_str())
            || s.stat_key
                .as_ref()
                .is_some_and(|s| !STATS.contains(&s.as_str()))
            || s.multiplier != MULTIPLIERS[tier]
            || (p.chart_placeholder && tier == 4)
        {
            return Err("invalid seal".into());
        }
    }
    if let Some(s) = p.surge {
        if !bounded(s.meter, 0.0, 100.0)
            || !bounded(s.heat, 0.0, 1.0)
            || !bounded(s.reactivity, 0.0, 1.0)
            || !["inferno", "tempest", "equilibrium"].contains(&s.surge_type.as_str())
            || !["absent", "equilibrium", "convergent", "divergent"]
                .contains(&s.monica_state.as_str())
            || s.monica.is_some_and(|v| !bounded(v, -1e12, 1e12))
            || s.active != (s.meter >= 70.0)
            || s.stat_boosts
                .iter()
                .any(|(k, v)| !STATS.contains(&k.as_str()) || !bounded(*v, 0.0, 100.0))
        {
            return Err("invalid surge".into());
        }
    }
    Ok(())
}
fn validate_write(
    owner: Identity,
    sender: Identity,
    npc: bool,
    now: u64,
    observed: u64,
    previous: Option<u64>,
) -> Result<(), String> {
    if sender != owner {
        return Err("publish_agent_rating: admin only".into());
    }
    if !npc {
        return Err("ratings require a seeded historical agent".into());
    }
    if observed == 0
        || observed > now.saturating_add(60_000)
        || now.saturating_sub(observed) > 300_000
    {
        return Err("rating observation outside freshness window".into());
    }
    if previous.is_some_and(|at| observed <= at) {
        return Err("rating observation is not newer".into());
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn publish_agent_rating(
    ctx: &ReducerContext,
    agent_key: String,
    snapshot_json: String,
    observed_at_ms: u64,
) -> Result<(), String> {
    let cfg = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .ok_or("game not initialised")?;
    let identity = Identity::from_claims("pentacles:agent", &agent_key);
    let previous = ctx.db.agent_rating().identity().find(&identity);
    let now = (ctx.timestamp.to_micros_since_unix_epoch() / 1000).max(0) as u64;
    validate_write(
        cfg.owner,
        ctx.sender(),
        ctx.db.agent_chart().identity().find(&identity).is_some(),
        now,
        observed_at_ms,
        previous.as_ref().map(|row| row.observed_at_ms),
    )?;
    if !valid_key(&agent_key) {
        return Err("invalid agent key".into());
    }
    validate_snapshot(&snapshot_json)?;
    let row = AgentRating {
        identity,
        agent_key,
        snapshot_json,
        observed_at_ms,
        received_at_ms: now,
    };
    if previous.is_some() {
        ctx.db.agent_rating().identity().update(row);
    } else {
        ctx.db.agent_rating().insert(row);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn snapshot() -> serde_json::Value {
        serde_json::json!({"version":1,"sourceKey":"isaac-newton","chartPlaceholder":false,
            "ratings":[90,70,93,60,80,71,65],"esms":[1,2,3,4],"esmsSource":"database","seals":[],"surge":null})
    }
    #[test]
    fn accepts_ratings_with_explicitly_missing_sky() {
        assert!(validate_snapshot(&snapshot().to_string()).is_ok());
    }
    #[test]
    fn rejects_bad_values_and_private_fields() {
        for (field, value) in [
            ("ratings", serde_json::json!([100, 70, 93, 60, 80, 71, 65])),
            ("esms", serde_json::json!([-1, 2, 3, 4])),
            ("wallet", serde_json::json!("private")),
            ("version", serde_json::json!(2)),
            ("surge", serde_json::json!({})),
        ] {
            let mut p = snapshot();
            p[field] = value;
            assert!(validate_snapshot(&p.to_string()).is_err(), "{field}");
        }
        let mut p = snapshot();
        p["esmsSource"] = serde_json::json!("unavailable");
        assert!(validate_snapshot(&p.to_string()).is_err());
    }
    #[test]
    fn rejects_non_owner_human_stale_future_and_out_of_order_writes() {
        let owner = Identity::from_claims("test", "owner");
        let human = Identity::from_claims("test", "human");
        assert!(validate_write(owner, owner, true, 400_000, 399_000, Some(398_000)).is_ok());
        assert!(validate_write(owner, human, true, 400_000, 399_000, None).is_err());
        assert!(validate_write(owner, owner, false, 400_000, 399_000, None).is_err());
        for at in [0, 1, 460_001, 398_000, 397_000] {
            assert!(validate_write(owner, owner, true, 400_000, at, Some(398_000)).is_err());
        }
    }
}
