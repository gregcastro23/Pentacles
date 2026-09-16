//! Holds the Rust tables and math to spec/pillars.v1.json and the golden
//! fixtures written by tools/pillar_sim.py. ASOL's lib/alchemical-circuit.ts
//! runs the same fixtures, so passing here and there means the two agree.

use alchm_astro_core::circuit::{self, Winner};
use alchm_astro_core::pillars::{self, CastMode, ChartInput, Element, Sect, PILLARS};
use alchm_astro_core::Planet;
use serde_json::Value;
use std::collections::HashMap;

fn load(rel: &str) -> Value {
    let path = format!("{}/{}", env!("CARGO_MANIFEST_DIR"), rel);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("parse {path}: {e}"))
}

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("expected number, got {v}"))
}

fn arr4(v: &Value) -> [f64; 4] {
    let a = v.as_array().expect("array of 4");
    assert_eq!(a.len(), 4);
    [num(&a[0]), num(&a[1]), num(&a[2]), num(&a[3])]
}

fn close(label: &str, got: f64, want: f64, tol: f64) {
    let scale = 1f64.max(got.abs()).max(want.abs());
    assert!((got - want).abs() <= tol * scale, "{label}: got {got:e}, want {want:e}");
}

fn close4(label: &str, got: &[f64; 4], want: &Value, tol: f64) {
    let want = arr4(want);
    for k in 0..4 {
        close(&format!("{label}[{k}]"), got[k], want[k], tol);
    }
}

fn element_name(e: Element) -> &'static str {
    e.name()
}

fn planet_name(p: Planet) -> &'static str {
    ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"][p.idx()]
}

#[test]
fn pillar_table_matches_spec() {
    let spec = load("spec/pillars.v1.json");
    let pillars = spec["pillars"].as_array().unwrap();
    assert_eq!(pillars.len(), PILLARS.len());
    for (json, rust) in pillars.iter().zip(PILLARS.iter()) {
        let key = json["key"].as_str().unwrap();
        assert_eq!(json["id"].as_u64().unwrap() as u8, rust.id, "{key} id");
        assert_eq!(key, rust.key);
        let effects: Vec<i8> = json["effects"].as_array().unwrap().iter().map(|v| v.as_i64().unwrap() as i8).collect();
        assert_eq!(effects, rust.effects.to_vec(), "{key} effects");
        assert_eq!(json["primary"].as_str().unwrap(), element_name(rust.primary), "{key} primary");
        assert_eq!(json["secondary"].as_str(), rust.secondary.map(element_name), "{key} secondary");
        let sect = match rust.sect {
            Sect::Diurnal => "diurnal",
            Sect::Nocturnal => "nocturnal",
            Sect::Both => "both",
        };
        assert_eq!(json["sect"].as_str().unwrap(), sect, "{key} sect");
        let mode = match rust.cast_mode {
            CastMode::SelfCast => "self",
            CastMode::Target => "target",
        };
        assert_eq!(json["castMode"].as_str().unwrap(), mode, "{key} castMode");
        let rulers: Vec<&str> = json["rulers"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        let rust_rulers: Vec<&str> = rust.rulers.iter().map(|p| planet_name(*p)).collect();
        assert_eq!(rulers, rust_rulers, "{key} rulers");
        assert_eq!(num(&json["k"]), rust.k, "{key} k");
        assert_eq!(json["requiresLuminaryDignity"].as_bool().unwrap(), rust.requires_luminary_dignity, "{key} luminary");
    }
}

#[test]
fn natal_tables_and_constants_match_spec() {
    let spec = load("spec/pillars.v1.json");
    let signs: Vec<&str> = spec["conventions"]["signOrder"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    for (i, planet) in spec["natal"]["planets"].as_array().unwrap().iter().enumerate() {
        let name = planet["planet"].as_str().unwrap();
        assert_eq!(arr4(&planet["alchemy"]), pillars::PLANET_ALCHEMY[i], "{name} alchemy");
        for (s, sign) in signs.iter().enumerate() {
            let want = planet["dignity"].get(*sign).and_then(Value::as_i64).unwrap_or(0) as i8;
            assert_eq!(pillars::PLANET_DIGNITY[i][s], want, "{name} dignity in {sign}");
        }
    }
    assert_eq!(arr4(&spec["natal"]["ascendantAlchemy"]), pillars::ASCENDANT_ALCHEMY);

    let c = &spec["constants"];
    assert_eq!(num(&c["poolBaseline"]), circuit::POOL_BASELINE);
    assert_eq!(num(&c["castCharge"]), circuit::CAST_CHARGE);
    assert_eq!(num(&c["powerRef"]), circuit::POWER_REF);
    assert_eq!(num(&c["magnitudeMin"]), circuit::MAGNITUDE_MIN);
    assert_eq!(num(&c["magnitudeMax"]), circuit::MAGNITUDE_MAX);
    assert_eq!(num(&c["deltaScale"]), circuit::DELTA_SCALE);
    assert_eq!(c["minPrimaryPlacements"].as_u64().unwrap() as u32, pillars::MIN_PRIMARY_PLACEMENTS);
    assert_eq!(c["minHand"].as_u64().unwrap() as usize, pillars::MIN_HAND);
    assert_eq!(num(&c["roomResistanceFloor"]), circuit::ROOM_RESISTANCE_FLOOR);
    assert_eq!(num(&c["epsilon"]), circuit::EPSILON);
    assert_eq!(num(&c["tieTolerance"]), circuit::TIE_TOLERANCE);
}

struct Fixtures {
    doc: Value,
    charts: HashMap<String, ChartInput>,
    tol: f64,
}

fn fixtures() -> Fixtures {
    let doc = load("spec/fixtures/cast-power.v1.json");
    let charts = doc["charts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            let signs: Vec<u8> = c["signs"].as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as u8).collect();
            let chart = ChartInput {
                signs: signs.try_into().expect("ten signs"),
                ascendant_sign: c["ascendantSign"].as_u64().unwrap() as u8,
                time_known: c["timeKnown"].as_bool().unwrap(),
            };
            (c["id"].as_str().unwrap().to_string(), chart)
        })
        .collect();
    let tol = num(&doc["tolerance"]);
    Fixtures { doc, charts, tol }
}

fn ids(v: &Value) -> Vec<u8> {
    v.as_array().unwrap().iter().map(|x| x.as_u64().unwrap() as u8).collect()
}

#[test]
fn circuit_states_match_fixtures() {
    let fx = fixtures();
    let states = fx.doc["states"].as_array().unwrap();
    assert!(!states.is_empty());
    for (i, s) in states.iter().enumerate() {
        let chart = &fx.charts[s["chart"].as_str().unwrap()];
        let pools = arr4(&s["pools"]);
        let want = &s["expected"];
        let got = circuit::circuit_state(chart, &pools, circuit::CAST_CHARGE);
        let tag = format!("state {i} ({})", s["chart"]);

        let ec = &want["elementCounts"];
        assert_eq!(
            got.element_counts,
            ["Fire", "Earth", "Air", "Water"].map(|e| ec[e].as_u64().unwrap() as u32),
            "{tag} element counts"
        );
        let mc = &want["modalityCounts"];
        assert_eq!(
            got.modality_counts,
            ["Cardinal", "Fixed", "Mutable"].map(|m| mc[m].as_u64().unwrap() as u32),
            "{tag} modality counts"
        );
        assert_eq!(got.bodies as u64, want["bodies"].as_u64().unwrap(), "{tag} bodies");
        close4(&format!("{tag} natalEsms"), &got.natal_esms, &want["natalEsms"], fx.tol);
        close4(&format!("{tag} liveEsms"), &got.live_esms, &want["liveEsms"], fx.tol);
        for (field, value) in [
            ("heat", got.thermo.heat),
            ("entropy", got.thermo.entropy),
            ("reactivity", got.thermo.reactivity),
            ("energy", got.thermo.energy),
            ("charge", got.charge),
            ("chargeSpent", got.charge_spent),
            ("current", got.current),
            ("voltage", got.voltage),
            ("power", got.power),
            ("potency", got.potency),
            ("magnitude", got.magnitude),
        ] {
            close(&format!("{tag} {field}"), value, num(&want[field]), fx.tol);
        }
        assert_eq!(got.can_cast, want["canCast"].as_bool().unwrap(), "{tag} canCast");
        assert_eq!(pillars::hand(chart, Sect::Diurnal), ids(&want["handDiurnal"]), "{tag} diurnal hand");
        assert_eq!(pillars::hand(chart, Sect::Nocturnal), ids(&want["handNocturnal"]), "{tag} nocturnal hand");
    }
}

#[test]
fn duels_match_fixtures() {
    let fx = fixtures();
    let duels = fx.doc["duels"].as_array().unwrap();
    assert!(!duels.is_empty());
    for (i, d) in duels.iter().enumerate() {
        let (a, b, want) = (&d["a"], &d["b"], &d["expected"]);
        let got = circuit::resolve_duel(
            &fx.charts[a["chart"].as_str().unwrap()],
            &arr4(&a["pools"]),
            a["pillar"].as_u64().unwrap() as u8,
            &fx.charts[b["chart"].as_str().unwrap()],
            &arr4(&b["pools"]),
            b["pillar"].as_u64().unwrap() as u8,
            circuit::CAST_CHARGE,
        )
        .unwrap_or_else(|e| panic!("duel {i}: {e:?}"));
        let tag = format!("duel {i}");
        close(&format!("{tag} magnitudeA"), got.magnitude_a, num(&want["magnitudeA"]), fx.tol);
        close(&format!("{tag} magnitudeB"), got.magnitude_b, num(&want["magnitudeB"]), fx.tol);
        close4(&format!("{tag} deltaA"), &got.delta_a, &want["deltaA"], fx.tol);
        close4(&format!("{tag} deltaB"), &got.delta_b, &want["deltaB"], fx.tol);
        close4(&format!("{tag} poolsA"), &got.pools_a, &want["poolsA"], fx.tol);
        close4(&format!("{tag} poolsB"), &got.pools_b, &want["poolsB"], fx.tol);
        close(&format!("{tag} ratioA"), got.ratio_a, num(&want["ratioA"]), fx.tol);
        close(&format!("{tag} ratioB"), got.ratio_b, num(&want["ratioB"]), fx.tol);
        let winner = match got.winner {
            Winner::A => "a",
            Winner::B => "b",
            Winner::Draw => "draw",
        };
        assert_eq!(winner, want["winner"].as_str().unwrap(), "{tag} winner");
    }
}

#[test]
fn rooms_match_fixtures() {
    let fx = fixtures();
    for (i, room) in fx.doc["rooms"].as_array().unwrap().iter().enumerate() {
        let receivers: Vec<ChartInput> =
            room["receivers"].as_array().unwrap().iter().map(|id| fx.charts[id.as_str().unwrap()]).collect();
        let got = circuit::room_shares(num(&room["magnitude"]), &receivers);
        let want = room["expected"].as_array().unwrap();
        assert_eq!(got.len(), want.len());
        let mut share_sum = 0.0;
        for (j, (g, w)) in got.iter().zip(want).enumerate() {
            let tag = format!("room {i} receiver {j}");
            close(&format!("{tag} share"), g.share, num(&w["share"]), fx.tol);
            close(&format!("{tag} real"), g.real, num(&w["real"]), fx.tol);
            close(&format!("{tag} kick"), g.kick, num(&w["kick"]), fx.tol);
            close(&format!("{tag} tension"), g.tension, num(&w["tension"]), fx.tol);
            share_sum += g.share;
        }
        close(&format!("room {i} shares sum to 1"), share_sum, 1.0, 1e-12);
    }
}

#[test]
fn cast_delta_never_exceeds_the_charge_spent() {
    for p in PILLARS.iter() {
        for m in [circuit::MAGNITUDE_MIN, 1.0, circuit::MAGNITUDE_MAX] {
            let d = circuit::cast_delta(p, m, circuit::CAST_CHARGE);
            let total: f64 = d.iter().map(|x| x.abs()).sum();
            assert!(total <= circuit::CAST_CHARGE + 1e-12, "{} at m={m} delivers {total}", p.key);
        }
    }
}

#[test]
fn every_chart_holds_at_least_the_minimum_hand() {
    let fx = fixtures();
    for (id, chart) in &fx.charts {
        for sky in [Sect::Diurnal, Sect::Nocturnal] {
            assert!(pillars::hand(chart, sky).len() >= pillars::MIN_HAND, "{id} {sky:?}");
        }
    }
}
