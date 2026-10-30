//! Owner-gated Pentacle ↔ ESMS conversion escrows, balances, and natal gates (Phase 4.5).
use crate::tables::*;
use spacetimedb::{ReducerContext, Table};

fn require_owner(ctx: &ReducerContext) -> Result<(), String> {
    let cfg = ctx
        .db
        .game_config()
        .id()
        .find(&0)
        .ok_or("game not initialised")?;
    if ctx.sender() != cfg.owner {
        return Err("admin only".into());
    }
    Ok(())
}

fn parse_atoms(raw: &[String]) -> Result<[u128; 4], String> {
    if raw.len() != 4 {
        return Err("atoms must be a 4-element vector".into());
    }
    let mut out = [0u128; 4];
    for (i, item) in raw.iter().enumerate() {
        out[i] = item
            .trim()
            .parse::<u128>()
            .map_err(|_| format!("invalid u128 atom value at index {i}"))?;
    }
    Ok(out)
}

fn format_atoms(vals: &[u128; 4]) -> Vec<String> {
    vals.iter().map(|v| v.to_string()).collect()
}

/// Formats unix epoch microseconds into an ISO-8601 UTC string (`YYYY-MM-DDTHH:MM:SS.sssZ`)
/// so lexicographical SQL filtering (`created_at < cutoff`) works deterministically.
fn micros_to_iso8601(micros: i64) -> String {
    let millis = (micros / 1_000).max(0);
    let secs = millis / 1_000;
    let ms = millis % 1_000;
    let days = secs / 86_400;
    let rem = secs % 86_400;
    let hour = rem / 3_600;
    let min = (rem % 3_600) / 60;
    let sec = rem % 60;

    // Howard Hinnant's civil_from_days algorithm
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!("{year:04}-{m:02}-{d:02}T{hour:02}:{min:02}:{sec:02}.{ms:03}Z")
}

#[spacetimedb::reducer]
pub fn commit_pentacle_gate(
    ctx: &ReducerContext,
    identity: String,
    spirit_gate: f64,
    essence_gate: f64,
    matter_gate: f64,
    substance_gate: f64,
    dominant_element: String,
) -> Result<(), String> {
    require_owner(ctx)?;
    let identity = identity.trim().to_string();
    if identity.is_empty() || identity.len() > 128 {
        return Err("invalid identity".into());
    }
    for g in [spirit_gate, essence_gate, matter_gate, substance_gate] {
        if !g.is_finite() || !(0.85..=1.0).contains(&g) {
            return Err("gate values must be finite in [0.85, 1.0]".into());
        }
    }
    if !["spirit", "essence", "matter", "substance"].contains(&dominant_element.as_str()) {
        return Err("invalid dominant_element".into());
    }
    if let Some(existing) = ctx.db.pentacle_gate().identity().find(&identity) {
        if existing.is_immutable {
            return Err("pentacle_gate is already committed and immutable".into());
        }
        ctx.db.pentacle_gate().identity().update(PentacleGate {
            identity,
            spirit_gate,
            essence_gate,
            matter_gate,
            substance_gate,
            dominant_element,
            is_immutable: true,
            updated_at: ctx.timestamp,
        });
    } else {
        ctx.db.pentacle_gate().insert(PentacleGate {
            identity,
            spirit_gate,
            essence_gate,
            matter_gate,
            substance_gate,
            dominant_element,
            is_immutable: true,
            updated_at: ctx.timestamp,
        });
    }
    Ok(())
}

#[spacetimedb::reducer]
pub fn escrow_pentacles_for_conversion(
    ctx: &ReducerContext,
    identity: String,
    conversion_id: String,
    atoms: Vec<String>,
) -> Result<(), String> {
    require_owner(ctx)?;
    let identity = identity.trim().to_string();
    let conversion_id = conversion_id.trim().to_string();
    if identity.is_empty() || conversion_id.is_empty() {
        return Err("identity and conversion_id are required".into());
    }
    if ctx
        .db
        .pentacle_conversion_escrow()
        .conversion_id()
        .find(&conversion_id)
        .is_some()
    {
        return Err("conversion_id already exists".into());
    }
    let req = parse_atoms(&atoms)?;
    if req.iter().all(|v| *v == 0) {
        return Err("escrow amount must be positive".into());
    }
    let bal = ctx
        .db
        .pentacle_balance()
        .identity()
        .find(&identity)
        .ok_or("insufficient free atoms")?;
    let mut free = parse_atoms(&bal.free_atoms)?;
    let mut bound = parse_atoms(&bal.bound_atoms)?;
    for i in 0..4 {
        if free[i] < req[i] {
            return Err("insufficient free atoms".into());
        }
        free[i] -= req[i];
        bound[i] = bound[i].saturating_add(req[i]);
    }
    ctx.db.pentacle_balance().identity().update(PentacleBalance {
        identity: identity.clone(),
        free_atoms: format_atoms(&free),
        bound_atoms: format_atoms(&bound),
        updated_at: ctx.timestamp,
    });
    ctx.db
        .pentacle_conversion_escrow()
        .insert(PentacleConversionEscrow {
            conversion_id,
            identity,
            status: "escrowed".into(),
            created_at: micros_to_iso8601(ctx.timestamp.to_micros_since_unix_epoch()),
            atoms: format_atoms(&req),
        });
    Ok(())
}

#[spacetimedb::reducer]
pub fn settle_pentacle_conversion(
    ctx: &ReducerContext,
    conversion_id: String,
) -> Result<(), String> {
    require_owner(ctx)?;
    let conversion_id = conversion_id.trim().to_string();
    let mut escrow = ctx
        .db
        .pentacle_conversion_escrow()
        .conversion_id()
        .find(&conversion_id)
        .ok_or("escrow not found")?;
    if escrow.status == "settled" {
        return Ok(());
    }
    if escrow.status != "escrowed" {
        return Err(format!("cannot settle escrow in status {}", escrow.status));
    }
    let req = parse_atoms(&escrow.atoms)?;
    if let Some(bal) = ctx.db.pentacle_balance().identity().find(&escrow.identity) {
        let free = parse_atoms(&bal.free_atoms)?;
        let mut bound = parse_atoms(&bal.bound_atoms)?;
        for i in 0..4 {
            bound[i] = bound[i].saturating_sub(req[i]);
        }
        ctx.db.pentacle_balance().identity().update(PentacleBalance {
            identity: escrow.identity.clone(),
            free_atoms: format_atoms(&free),
            bound_atoms: format_atoms(&bound),
            updated_at: ctx.timestamp,
        });
    }
    escrow.status = "settled".into();
    ctx.db
        .pentacle_conversion_escrow()
        .conversion_id()
        .update(escrow);
    Ok(())
}

#[spacetimedb::reducer]
pub fn refund_pentacle_conversion(
    ctx: &ReducerContext,
    conversion_id: String,
) -> Result<(), String> {
    require_owner(ctx)?;
    let conversion_id = conversion_id.trim().to_string();
    let mut escrow = ctx
        .db
        .pentacle_conversion_escrow()
        .conversion_id()
        .find(&conversion_id)
        .ok_or("escrow not found")?;
    if escrow.status == "refunded" {
        return Ok(());
    }
    if escrow.status != "escrowed" {
        return Err(format!("cannot refund escrow in status {}", escrow.status));
    }
    let req = parse_atoms(&escrow.atoms)?;
    let bal = ctx
        .db
        .pentacle_balance()
        .identity()
        .find(&escrow.identity)
        .ok_or("balance row missing for escrow refund")?;
    let mut free = parse_atoms(&bal.free_atoms)?;
    let mut bound = parse_atoms(&bal.bound_atoms)?;
    for i in 0..4 {
        bound[i] = bound[i].saturating_sub(req[i]);
        free[i] = free[i].saturating_add(req[i]);
    }
    ctx.db.pentacle_balance().identity().update(PentacleBalance {
        identity: escrow.identity.clone(),
        free_atoms: format_atoms(&free),
        bound_atoms: format_atoms(&bound),
        updated_at: ctx.timestamp,
    });
    escrow.status = "refunded".into();
    ctx.db
        .pentacle_conversion_escrow()
        .conversion_id()
        .update(escrow);
    Ok(())
}

#[spacetimedb::reducer]
pub fn credit_pentacles_from_conversion(
    ctx: &ReducerContext,
    identity: String,
    conversion_id: String,
    atoms: Vec<String>,
) -> Result<(), String> {
    require_owner(ctx)?;
    let identity = identity.trim().to_string();
    let conversion_id = conversion_id.trim().to_string();
    if identity.is_empty() || conversion_id.is_empty() {
        return Err("identity and conversion_id are required".into());
    }
    if ctx
        .db
        .pentacle_conversion_escrow()
        .conversion_id()
        .find(&conversion_id)
        .is_some()
    {
        return Err("conversion_id already credited".into());
    }
    let add = parse_atoms(&atoms)?;
    if add.iter().all(|v| *v == 0) {
        return Err("credit amount must be positive".into());
    }
    if let Some(bal) = ctx.db.pentacle_balance().identity().find(&identity) {
        let mut free = parse_atoms(&bal.free_atoms)?;
        let bound = parse_atoms(&bal.bound_atoms)?;
        for i in 0..4 {
            free[i] = free[i].saturating_add(add[i]);
        }
        ctx.db.pentacle_balance().identity().update(PentacleBalance {
            identity: identity.clone(),
            free_atoms: format_atoms(&free),
            bound_atoms: format_atoms(&bound),
            updated_at: ctx.timestamp,
        });
    } else {
        ctx.db.pentacle_balance().insert(PentacleBalance {
            identity: identity.clone(),
            free_atoms: format_atoms(&add),
            bound_atoms: format_atoms(&[0, 0, 0, 0]),
            updated_at: ctx.timestamp,
        });
    }
    ctx.db
        .pentacle_conversion_escrow()
        .insert(PentacleConversionEscrow {
            conversion_id,
            identity,
            status: "settled".into(),
            created_at: micros_to_iso8601(ctx.timestamp.to_micros_since_unix_epoch()),
            atoms: format_atoms(&add),
        });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_formats_four_element_atoms() {
        let raw = vec![
            "10000".to_string(),
            "0".to_string(),
            "250".to_string(),
            "99".to_string(),
        ];
        let parsed = parse_atoms(&raw).unwrap();
        assert_eq!(parsed, [10_000, 0, 250, 99]);
        assert_eq!(format_atoms(&parsed), raw);
        assert!(parse_atoms(&["1".to_string()]).is_err());
        assert!(parse_atoms(&[
            "-1".to_string(),
            "0".to_string(),
            "0".to_string(),
            "0".to_string()
        ])
        .is_err());
    }

    #[test]
    fn formats_micros_to_iso8601_utc() {
        // 2026-10-22T06:00:00.123Z -> 1792648800123000 micros
        let iso = micros_to_iso8601(1_792_648_800_123_000);
        assert_eq!(iso, "2026-10-22T06:00:00.123Z");
    }
}
