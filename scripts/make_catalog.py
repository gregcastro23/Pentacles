#!/usr/bin/env python3
"""Generate the Pentacles star catalogue from the HYG database.

The whole point of the game is the real sky: every naked-eye star (mag <= 6.0),
from the ascendant on the eastern horizon all the way to the edge of the sky,
becomes a capturable node grouped into pentacle zones. This script turns the
HYG v4.1 dataset into the two embedded catalogues the game ships:

  server/src/catalog.rs   - seeded into the `star_node` table by the module
  star-catalog.js         - the web client's local copy of the same catalogue

Usage:
  curl -sL -o /tmp/hygdata.csv \
    https://raw.githubusercontent.com/astronexus/HYG-Database/main/hyg/CURRENT/hygdata_v41.csv
  python3 scripts/make_catalog.py /tmp/hygdata.csv

Both outputs are sorted brightest-first, so "the first N rows" is always "the N
brightest stars" — the server seeds in that order.
"""

import csv
import sys
from pathlib import Path

MAG_LIMIT = 6.5  # a touch past the naked-eye limit (~6.0) for a denser sky

GREEK = {
    "Alp": "Alpha", "Bet": "Beta", "Gam": "Gamma", "Del": "Delta",
    "Eps": "Epsilon", "Zet": "Zeta", "Eta": "Eta", "The": "Theta",
    "Iot": "Iota", "Kap": "Kappa", "Lam": "Lambda", "Mu": "Mu",
    "Nu": "Nu", "Xi": "Xi", "Omi": "Omicron", "Pi": "Pi",
    "Rho": "Rho", "Sig": "Sigma", "Tau": "Tau", "Ups": "Upsilon",
    "Phi": "Phi", "Chi": "Chi", "Psi": "Psi", "Ome": "Omega",
}


def star_name(row):
    """Best display name: proper name > Bayer+constellation > Flamsteed > HIP."""
    proper = row["proper"].strip()
    if proper:
        return proper
    bayer, flam, con = row["bayer"].strip(), row["flam"].strip(), row["con"].strip()
    if bayer and con:
        # "Alp-2" -> "Alpha-2"; keep any numeric superscript suffix.
        parts = bayer.split("-", 1)
        greek = GREEK.get(parts[0], parts[0])
        if len(parts) == 2:
            greek = f"{greek}-{parts[1]}"
        return f"{greek} {con}"
    if flam and con:
        return f"{flam} {con}"
    return f"HIP {row['hip']}"


def load(path):
    best = {}  # hip -> dict of attributes
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            hip = row["hip"].strip()
            mag = row["mag"].strip()
            if not hip or not mag:
                continue
            hip, mag = int(float(hip)), float(mag)
            if mag > MAG_LIMIT:
                continue
            # Binary components can share a HIP id - keep the brightest.
            if hip in best and best[hip]["mag"] <= mag:
                continue

            ra_deg = round(float(row["ra"]) * 15.0, 4)  # HYG stores RA in hours
            dec_deg = round(float(row["dec"]), 4)

            hd = int(row["hd"]) if row["hd"].strip() else None
            hr = int(row["hr"]) if row["hr"].strip() else None
            proper = row["proper"].strip()
            bayer = row["bayer"].strip()
            flam = int(row["flam"]) if row["flam"].strip() else None
            con = row["con"].strip()
            dist = round(float(row["dist"]), 2) if row["dist"].strip() else None
            spect = row["spect"].strip()
            absmag = round(float(row["absmag"]), 2) if row["absmag"].strip() else None
            ci = round(float(row["ci"]), 3) if row["ci"].strip() else None
            lum = round(float(row["lum"]), 2) if row["lum"].strip() else None

            best[hip] = {
                "hip": hip,
                "name": star_name(row),
                "ra": ra_deg,
                "dec": dec_deg,
                "mag": mag,
                "hd": hd,
                "hr": hr,
                "proper": proper,
                "bayer": bayer,
                "flam": flam,
                "con": con,
                "dist": dist,
                "spect": spect,
                "absmag": absmag,
                "ci": ci,
                "lum": lum,
            }

    stars = list(best.values())
    stars.sort(key=lambda s: (s["mag"], s["hip"]))  # brightest first, hip tiebreak
    return stars


def write_rust(stars, path):
    lines = [
        "//! The real night sky — every naked-eye star (magnitude <= %.1f)," % MAG_LIMIT,
        "//! generated from the HYG v4.1 database by `scripts/make_catalog.py`.",
        "//! DO NOT EDIT BY HAND; re-run the script instead.",
        "//!",
        "//! Sorted brightest-first so seeding the first N rows always seeds the",
        "//! N brightest stars. Tuples are (hip, name, ra_deg, dec_deg, magnitude, constellation).",
        "",
        "pub const STARS: &[(u32, &str, f64, f64, f32, &str)] = &[",
    ]
    for s in stars:
        esc = s["name"].replace("\\", "\\\\").replace('"', '\\"')
        con_esc = s["con"].replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'    ({s["hip"]}, "{esc}", {s["ra"]}, {s["dec"]}, {s["mag"]}f32, "{con_esc}"),')
    lines.append("];")
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_js(stars, path):
    import json
    lines = [
        "// The real night sky — every naked-eye star (magnitude <= %.1f)," % MAG_LIMIT,
        "// generated from the HYG v4.1 database by `scripts/make_catalog.py`.",
        "// DO NOT EDIT BY HAND; re-run the script instead.",
        "//",
        "// Sorted brightest-first. Rows are:",
        "// [hip, name, ra_deg, dec_deg, magnitude, hd, hr, proper, bayer, flam, con, dist_pc, spect, absmag, ci, lum]",
        "const STAR_CATALOG = [",
    ]
    for s in stars:
        row = [
            s["hip"], s["name"], s["ra"], s["dec"], s["mag"],
            s["hd"], s["hr"], s["proper"], s["bayer"], s["flam"],
            s["con"], s["dist"], s["spect"], s["absmag"], s["ci"], s["lum"]
        ]
        lines.append(json.dumps(row, separators=(',', ':')) + ",")
    lines.append("];")
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/hygdata.csv"
    root = Path(__file__).resolve().parent.parent
    stars = load(src)
    write_rust(stars, root / "server" / "src" / "catalog.rs")
    write_js(stars, root / "public" / "star-catalog.js")
    bands = {}
    for s in stars:
        m = s["mag"]
        b = int(m) if m >= 0 else -1
        bands[b] = bands.get(b, 0) + 1
    print(f"{len(stars)} stars (mag <= {MAG_LIMIT})")
    for b in sorted(bands):
        print(f"  mag {b:>2}..{b + 1}: {bands[b]}")


if __name__ == "__main__":
    main()
