#!/usr/bin/env python3
"""Reference implementation and simulation harness for spec/pillars.v1.json.

Every number in spec/fixtures/cast-power.v1.json is written by this script. The
Rust crate (src/pillars.rs, src/circuit.rs) and ASOL's lib/alchemical-circuit.ts
must reproduce them, so arithmetic here is spelled out in the same order they use
(x*x rather than x**2, left-to-right sums).

  python3 tools/pillar_sim.py calibrate   # median |P| at baseline pools
  python3 tools/pillar_sim.py balance     # receiver direction + duel win rates
  python3 tools/pillar_sim.py fixtures    # regenerate golden fixtures

calibrate/balance/fixtures draw real charts from pyephem (pip install ephem).
Balance accepts overrides, e.g. --sect Fixation=diurnal,Filtration=nocturnal
"""
import argparse
import json
import math
import random
import statistics
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC_PATH = ROOT / "spec" / "pillars.v1.json"
FIXTURE_PATH = ROOT / "spec" / "fixtures" / "cast-power.v1.json"

SPEC = json.loads(SPEC_PATH.read_text())
C = SPEC["constants"]
SIGNS = SPEC["conventions"]["signOrder"]
ELEMENTS = ["Fire", "Earth", "Air", "Water"]  # sign index % 4
MODALITIES = ["Cardinal", "Fixed", "Mutable"]  # sign index % 3
PILLARS = SPEC["pillars"]
BY_ID = {p["id"]: p for p in PILLARS}
ALCHEMY = [p["alchemy"] for p in SPEC["natal"]["planets"]]
DIGNITY = [[p["dignity"].get(s, 0) for s in SIGNS] for p in SPEC["natal"]["planets"]]
ASC_ALCHEMY = SPEC["natal"]["ascendantAlchemy"]
EPS = C["epsilon"]


# ── Chart tallies ───────────────────────────────────────────────────────────

def counted_signs(chart):
    signs = list(chart["signs"])
    if chart["timeKnown"]:
        signs.append(chart["ascendantSign"])
    return signs


def element_counts(chart):
    counts = {e: 0 for e in ELEMENTS}
    for s in counted_signs(chart):
        counts[ELEMENTS[s % 4]] += 1
    return counts


def modality_counts(chart):
    counts = {m: 0 for m in MODALITIES}
    for s in counted_signs(chart):
        counts[MODALITIES[s % 3]] += 1
    return counts


def natal_esms(chart):
    esms = [0.0, 0.0, 0.0, 0.0]
    for planet, sign in enumerate(chart["signs"]):
        mult = 1.0 + 0.1 * abs(DIGNITY[planet][sign])
        for k in range(4):
            esms[k] = esms[k] + ALCHEMY[planet][k] * mult
    if chart["timeKnown"]:
        for k in range(4):
            esms[k] = esms[k] + ASC_ALCHEMY[k] * 1.0
    return esms


# ── Thermodynamics and circuit ──────────────────────────────────────────────

def thermo(esms, counts):
    s, e, m, b = esms
    fire, earth, air, water = (float(counts[x]) for x in ELEMENTS)
    heat_den = b + e + m + water + air + earth
    heat = (s * s + fire * fire) / max(heat_den * heat_den, EPS)
    ent_den = e + m + earth + water
    entropy = (s * s + b * b + fire * fire + air * air) / max(ent_den * ent_den, EPS)
    rea_den = m + earth
    reactivity = (s * s + b * b + e * e + fire * fire + air * air + water * water) / max(rea_den * rea_den, EPS)
    energy = heat - entropy * reactivity
    return heat, entropy, reactivity, energy


def clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def circuit_state(chart, pools, q=None):
    q = C["castCharge"] if q is None else q
    base = C["poolBaseline"]
    counts = element_counts(chart)
    natal = natal_esms(chart)
    live = [natal[k] * pools[k] / base for k in range(4)]
    heat, entropy, reactivity, energy = thermo(live, counts)
    charge = live[2] + live[3]
    drain = pools[2] + pools[3]
    if drain > 0:
        q_matter = q * pools[2] / drain
        q_substance = q * pools[3] / drain
    else:
        q_matter = q_substance = 0.0
    charge_spent = natal[2] * q_matter / base + natal[3] * q_substance / base
    current = reactivity * charge_spent
    voltage = energy / charge if charge > EPS else 0.0
    power = current * voltage
    return {
        "elementCounts": counts,
        "modalityCounts": modality_counts(chart),
        "bodies": len(counted_signs(chart)),
        "natalEsms": natal,
        "liveEsms": live,
        "heat": heat,
        "entropy": entropy,
        "reactivity": reactivity,
        "energy": energy,
        "charge": charge,
        "chargeSpent": charge_spent,
        "current": current,
        "voltage": voltage,
        "power": power,
        "potency": reactivity * abs(energy),
        "magnitude": clamp(abs(power) / C["powerRef"], C["magnitudeMin"], C["magnitudeMax"]),
        "canCast": drain >= q,
    }


def potency(chart, pools):
    return circuit_state(chart, pools)["potency"]


def pay(pools, q):
    drain = pools[2] + pools[3]
    out = list(pools)
    if drain > 0:
        out[2] = pools[2] - q * pools[2] / drain
        out[3] = pools[3] - q * pools[3] / drain
    return out


def cast_delta(pillar, magnitude, q):
    raw = [pillar["effects"][k] * pillar["k"] * magnitude * C["deltaScale"] for k in range(4)]
    total = abs(raw[0]) + abs(raw[1]) + abs(raw[2]) + abs(raw[3])
    if total > q:
        scale = q / total
        raw = [raw[k] * scale for k in range(4)]
    return raw


def apply_delta(pools, delta):
    return [max(0.0, pools[k] + delta[k]) for k in range(4)]


# ── Hand ────────────────────────────────────────────────────────────────────

def hand(chart, sect):
    counts = element_counts(chart)
    luminary = DIGNITY[0][chart["signs"][0]] > 0 or DIGNITY[1][chart["signs"][1]] > 0

    def eligible(p):
        in_sect = p["sect"] == sect or p["sect"] == "both"
        return in_sect and (not p["requiresLuminaryDignity"] or luminary)

    ids = [p["id"] for p in PILLARS if eligible(p) and counts[p["primary"]] >= C["minPrimaryPlacements"]]
    if len(ids) < C["minHand"]:
        rest = sorted((p for p in PILLARS if eligible(p) and p["id"] not in ids),
                      key=lambda p: (-counts[p["primary"]], p["id"]))
        for p in rest:
            if len(ids) >= C["minHand"]:
                break
            ids.append(p["id"])
    return sorted(ids)


# ── Duel and room ───────────────────────────────────────────────────────────

def resolve_duel(a_chart, a_pools, a_pillar_id, b_chart, b_pools, b_pillar_id, q=None):
    q = C["castCharge"] if q is None else q
    sa, sb = circuit_state(a_chart, a_pools, q), circuit_state(b_chart, b_pools, q)
    if not (sa["canCast"] and sb["canCast"]):
        raise ValueError("both casters need MATTER + SUBSTANCE >= castCharge")
    pa, pb = BY_ID[a_pillar_id], BY_ID[b_pillar_id]
    a_after, b_after = pay(a_pools, q), pay(b_pools, q)
    delta_a = cast_delta(pa, sa["magnitude"], q)
    delta_b = cast_delta(pb, sb["magnitude"], q)
    if pa["castMode"] == "self":
        a_after = apply_delta(a_after, delta_a)
    else:
        b_after = apply_delta(b_after, delta_a)
    if pb["castMode"] == "self":
        b_after = apply_delta(b_after, delta_b)
    else:
        a_after = apply_delta(a_after, delta_b)
    ratio_a = potency(a_chart, a_after) / max(sa["potency"], EPS)
    ratio_b = potency(b_chart, b_after) / max(sb["potency"], EPS)
    diff = ratio_a - ratio_b
    winner = "a" if diff > C["tieTolerance"] else "b" if diff < -C["tieTolerance"] else "draw"
    return {
        "magnitudeA": sa["magnitude"], "magnitudeB": sb["magnitude"],
        "deltaA": delta_a, "deltaB": delta_b,
        "poolsA": a_after, "poolsB": b_after,
        "ratioA": ratio_a, "ratioB": ratio_b, "winner": winner,
    }


def room_shares(magnitude, receiver_charts):
    floor = C["roomResistanceFloor"]
    parts = []
    for chart in receiver_charts:
        counts = modality_counts(chart)
        n = float(len(counted_signs(chart)))
        cardinal, fixed, mutable = counts["Cardinal"] / n, counts["Fixed"] / n, counts["Mutable"] / n
        r = floor + mutable
        x = cardinal - fixed
        z = math.sqrt(r * r + x * x)
        parts.append((cardinal, fixed, r, z, 1.0 / z))
    total_y = 0.0
    for part in parts:
        total_y = total_y + part[4]
    out = []
    for cardinal, fixed, r, z, y in parts:
        share = y / total_y
        out.append({
            "share": share,
            "real": magnitude * share * r / z,
            "kick": magnitude * share * cardinal / z,
            "tension": magnitude * share * fixed / z,
        })
    return out


# ── Chart sampling (pyephem) ────────────────────────────────────────────────

def sample_charts(n, seed, time_unknown_share=0.0):
    import ephem  # only needed for sampling

    rng = random.Random(seed)
    bodies = [ephem.Sun, ephem.Moon, ephem.Mercury, ephem.Venus, ephem.Mars,
              ephem.Jupiter, ephem.Saturn, ephem.Uranus, ephem.Neptune, ephem.Pluto]
    eps = math.radians(23.439)
    charts = []
    for i in range(n):
        t = ephem.Date(ephem.Date("1945/1/1") + rng.random() * 65 * 365.25)
        lat = rng.uniform(-45, 60)
        observer = ephem.Observer()
        observer.date, observer.lat, observer.lon = t, str(lat), str(rng.uniform(-180, 180))
        signs = [int(math.degrees(ephem.Ecliptic(b(t), epoch=t).lon) // 30) % 12 for b in bodies]
        ramc = float(observer.sidereal_time())
        asc = math.degrees(math.atan2(math.cos(ramc),
                                      -(math.sin(ramc) * math.cos(eps) + math.tan(math.radians(lat)) * math.sin(eps)))) % 360
        charts.append({
            "id": f"c{i + 1:02d}",
            "signs": signs,
            "ascendantSign": int(asc // 30) % 12,
            "timeKnown": rng.random() >= time_unknown_share,
        })
    return charts


BASELINE = [80.0, 80.0, 80.0, 80.0]


# ── Commands ────────────────────────────────────────────────────────────────

def cmd_calibrate(args):
    charts = sample_charts(args.n, args.seed)
    powers = [abs(circuit_state(c, BASELINE)["power"]) for c in charts]
    energies = [circuit_state(c, BASELINE)["energy"] for c in charts]
    print(f"N={len(charts)} charts at baseline pools, q={C['castCharge']}")
    print(f"median |P| = {statistics.median(powers):.6f}   (spec powerRef = {C['powerRef']})")
    print(f"energy < 0 in {100 * sum(e < 0 for e in energies) / len(energies):.1f}% of charts")


def apply_overrides(args):
    if args.sect:
        for item in args.sect.split(","):
            key, value = item.split("=")
            next(p for p in PILLARS if p["key"] == key)["sect"] = value
    if args.mode:
        for item in args.mode.split(","):
            key, value = item.split("=")
            next(p for p in PILLARS if p["key"] == key)["castMode"] = value


def cmd_balance(args):
    apply_overrides(args)
    rng = random.Random(args.seed + 1)
    charts = sample_charts(args.n, args.seed)
    q = C["castCharge"]

    print(f"N={len(charts)} charts, {args.duels} duels per sect, baseline pools, q={q}\n")
    print("Receiver potency rises when the pillar lands (m = 1):")
    for p in PILLARS:
        rises = 0
        for c in charts:
            after = apply_delta(BASELINE, cast_delta(p, 1.0, q))
            rises += potency(c, after) > potency(c, BASELINE)
        share = rises / len(charts)
        implied = "self" if share > 0.5 else "target"
        flag = "" if implied == p["castMode"] else "   <-- spec says " + p["castMode"]
        print(f"  {p['key']:15} {100 * share:5.1f}%  implies {implied}{flag}")

    for sect in ("diurnal", "nocturnal"):
        primaries = Counter(p["primary"] for p in PILLARS if p["sect"] == sect)
        print(f"\n{sect}: primary elements {dict(primaries)}")
        sizes = [len(hand(c, sect)) for c in charts]
        floored = sum(1 for c in charts if len([p for p in PILLARS if (p['sect'] in (sect, 'both')) and element_counts(c)[p['primary']] >= C['minPrimaryPlacements']]) < C["minHand"])
        print(f"  hand mean {statistics.mean(sizes):.2f}, min {min(sizes)}, needed floor {100 * floored / len(charts):.1f}%")
        wins, best, draws = defaultdict(lambda: [0, 0]), Counter(), 0
        for _ in range(args.duels):
            a, b = rng.sample(charts, 2)
            ha, hb = hand(a, sect), hand(b, sect)
            pb = rng.choice(hb)
            pa = rng.choice(ha)
            result = resolve_duel(a, BASELINE, pa, b, BASELINE, pb)["winner"]
            draws += result == "draw"
            wins[pa][0] += result == "a"
            wins[pa][1] += 1
            scored = [(resolve_duel(a, BASELINE, x, b, BASELINE, pb)["winner"] == "a", rng.random(), x) for x in ha]
            best[max(scored)[2]] += 1
        ordered = sorted(wins.items(), key=lambda kv: -kv[1][0] / kv[1][1])
        print(f"  draws {100 * draws / args.duels:.1f}%")
        print("  random-pick win%: " + ", ".join(f"{BY_ID[i]['key']} {100 * w / n:.0f}" for i, (w, n) in ordered))
        total = sum(best.values())
        print("  best-response share%: " + ", ".join(f"{BY_ID[i]['key']} {100 * v / total:.0f}" for i, v in best.most_common()))


def cmd_fixtures(args):
    rng = random.Random(args.seed)
    charts = sample_charts(24, args.seed, time_unknown_share=0.25)
    # Edge chart: no Earth placements at all, to exercise the (Matter + Earth) denominator.
    charts.append({"id": "c25", "signs": [0, 3, 2, 4, 6, 8, 10, 11, 7, 0], "ascendantSign": 3, "timeKnown": True})
    # Floor chart: Air-heavy, no luminary dignity, so the nocturnal hand is topped up to minHand.
    charts.append({"id": "c26", "signs": [2, 6, 2, 10, 0, 4, 6, 10, 5, 11], "ascendantSign": 2, "timeKnown": True})
    by_id = {c["id"]: c for c in charts}

    states = []
    pool_sets = [BASELINE]
    for _ in range(3):
        pool_sets.append([float(rng.randint(5, 160)) for _ in range(4)])
    pool_sets.append([0.0, 40.0, 0.0, 0.0])  # cannot cast, zero charge
    pool_sets.append([120.0, 0.0, 3.0, 4.0])  # cannot cast, tiny charge
    for c in charts:
        for pools in (pool_sets[0], rng.choice(pool_sets[1:4])):
            states.append({"chart": c["id"], "pools": pools})
    states.append({"chart": "c01", "pools": pool_sets[4]})
    states.append({"chart": "c02", "pools": pool_sets[5]})
    for s in states:
        chart = by_id[s["chart"]]
        s["expected"] = circuit_state(chart, s["pools"])
        s["expected"]["handDiurnal"] = hand(chart, "diurnal")
        s["expected"]["handNocturnal"] = hand(chart, "nocturnal")

    duels = []
    castable = [s for s in states if s["expected"]["canCast"]]
    while len(duels) < 30:
        sa, sb = rng.sample(castable, 2)
        if sa["chart"] == sb["chart"]:
            continue
        sect = rng.choice(["diurnal", "nocturnal"])
        pa = rng.choice(sa["expected"]["handDiurnal" if sect == "diurnal" else "handNocturnal"])
        pb = rng.choice(sb["expected"]["handDiurnal" if sect == "diurnal" else "handNocturnal"])
        duels.append({
            "a": {"chart": sa["chart"], "pools": sa["pools"], "pillar": pa},
            "b": {"chart": sb["chart"], "pools": sb["pools"], "pillar": pb},
            "expected": resolve_duel(by_id[sa["chart"]], sa["pools"], pa, by_id[sb["chart"]], sb["pools"], pb),
        })

    rooms = []
    for size in (1, 2, 3, 5, 8):
        ids = [c["id"] for c in rng.sample(charts, size)]
        magnitude = round(rng.uniform(C["magnitudeMin"], C["magnitudeMax"]), 4)
        rooms.append({"magnitude": magnitude, "receivers": ids,
                      "expected": room_shares(magnitude, [by_id[i] for i in ids])})

    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_text(json.dumps({
        "version": "1.0.0",
        "specVersion": SPEC["version"],
        "generator": f"python3 tools/pillar_sim.py fixtures --seed {args.seed}",
        "tolerance": 1e-9,
        "charts": charts,
        "states": states,
        "duels": duels,
        "rooms": rooms,
    }, indent=1) + "\n")
    print(f"wrote {FIXTURE_PATH.relative_to(ROOT)}: {len(charts)} charts, {len(states)} states, {len(duels)} duels, {len(rooms)} rooms")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("calibrate", "balance", "fixtures"):
        p = sub.add_parser(name)
        p.add_argument("--seed", type=int, default=20260915)
        p.add_argument("--n", type=int, default=3000 if name == "calibrate" else 1500)
        p.add_argument("--duels", type=int, default=20000)
        p.add_argument("--sect", default="", help="Key=diurnal|nocturnal|both,...")
        p.add_argument("--mode", default="", help="Key=self|target,...")
    args = parser.parse_args()
    {"calibrate": cmd_calibrate, "balance": cmd_balance, "fixtures": cmd_fixtures}[args.cmd](args)


if __name__ == "__main__":
    main()
