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

MAG_LIMIT = 6.0  # the naked-eye limit: "all (or close to all) visible stars"

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
    best = {}  # hip -> (mag, name, ra_deg, dec_deg)
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
            if hip in best and best[hip][0] <= mag:
                continue
            ra_deg = float(row["ra"]) * 15.0  # HYG stores RA in hours
            dec_deg = float(row["dec"])
            best[hip] = (mag, star_name(row), round(ra_deg, 4), round(dec_deg, 4))
    stars = [(hip, n, ra, dec, m) for hip, (m, n, ra, dec) in best.items()]
    stars.sort(key=lambda s: (s[4], s[0]))  # brightest first, hip tiebreak
    return stars


def write_rust(stars, path):
    lines = [
        "//! The real night sky — every naked-eye star (magnitude <= %.1f)," % MAG_LIMIT,
        "//! generated from the HYG v4.1 database by `scripts/make_catalog.py`.",
        "//! DO NOT EDIT BY HAND; re-run the script instead.",
        "//!",
        "//! Sorted brightest-first so seeding the first N rows always seeds the",
        "//! N brightest stars. Tuples are (hip, name, ra_deg, dec_deg, magnitude).",
        "",
        "pub const STARS: &[(u32, &str, f64, f64, f32)] = &[",
    ]
    for hip, name, ra, dec, mag in stars:
        esc = name.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'    ({hip}, "{esc}", {ra}, {dec}, {mag}f32),')
    lines.append("];")
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_js(stars, path):
    lines = [
        "// The real night sky — every naked-eye star (magnitude <= %.1f)," % MAG_LIMIT,
        "// generated from the HYG v4.1 database by `scripts/make_catalog.py`.",
        "// DO NOT EDIT BY HAND; re-run the script instead.",
        "//",
        "// Sorted brightest-first. Rows are [hip, name, ra_deg, dec_deg, magnitude] —",
        "// the same catalogue embedded in the server module (server/src/catalog.rs),",
        "// so the offline web client and the live module agree on the sky.",
        "const STAR_CATALOG = [",
    ]
    for hip, name, ra, dec, mag in stars:
        esc = name.replace("\\", "\\\\").replace('"', '\\"')
        lines.append(f'[{hip},"{esc}",{ra},{dec},{mag}],')
    lines.append("];")
    Path(path).write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "/tmp/hygdata.csv"
    root = Path(__file__).resolve().parent.parent
    stars = load(src)
    write_rust(stars, root / "server" / "src" / "catalog.rs")
    write_js(stars, root / "star-catalog.js")
    bands = {}
    for s in stars:
        bands[int(s[4]) if s[4] >= 0 else -1] = bands.get(int(s[4]) if s[4] >= 0 else -1, 0) + 1
    print(f"{len(stars)} stars (mag <= {MAG_LIMIT})")
    for b in sorted(bands):
        print(f"  mag {b:>2}..{b + 1}: {bands[b]}")


if __name__ == "__main__":
    main()
