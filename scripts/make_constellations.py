#!/usr/bin/env python3
"""Generate the Constellation Liquidity Pool catalogue for Pentacles.

Each real constellation becomes a constant-product AMM pool over a pair of ESMS
elements. The pair is a *frozen* property of the constellation, computed here
once from the magnitude-weighted elements of its stick-figure stars — never
recomputed live (only visibility changes minute to minute).

Inputs:
  star-catalog.js   — the existing naked-eye catalogue (the source of truth for
                      each figure star's HIP id, RA/Dec and magnitude). We read
                      it directly so we never need to re-download HYG.

Outputs (both generated, both carry a DO-NOT-EDIT banner):
  constellations.js          — loaded by the web client beside star-catalog.js
  server/src/constellations.rs — `pub const CONSTELLATIONS` for the module

Star → element pipeline (mirrors the Rust module exactly):
  equatorial_to_ecliptic_min (chart.rs:514)  → ecliptic longitude
  sign = floor(lon/30) % 12
  sign_element (chart.rs:12): sign%4 → Wands/Pentacles/Swords/Cups
  ELEMENT_TO_ESMS: Wands→0 Spirit, Cups→1 Essence, Pentacles→2 Matter, Swords→3 Substance
  node_weight (combat.rs:78): max(0.4, 6.5 - mag)   (brighter = heavier)

Usage:  python3 scripts/make_constellations.py
"""

import math
import re
import sys
from pathlib import Path

OBLIQUITY_DEG = 23.439291  # mean obliquity J2000 (matches chart.rs / sky.js)

# ESMS token ids on EsmsToken.sol.
SPIRIT, ESSENCE, MATTER, SUBSTANCE = 0, 1, 2, 3
ESMS_NAMES = {SPIRIT: "Spirit", ESSENCE: "Essence", MATTER: "Matter", SUBSTANCE: "Substance"}

# Opposing dyads (used only for degenerate single-element constellations):
# Fire(Spirit) ↔ Air(Substance), Earth(Matter) ↔ Water(Essence).
OPPOSITE = {SPIRIT: SUBSTANCE, SUBSTANCE: SPIRIT, MATTER: ESSENCE, ESSENCE: MATTER}

# sign%4 → ESMS id. 0 Wands/Fire→Spirit, 1 Pentacles/Earth→Matter,
# 2 Swords/Air→Substance, 3 Cups/Water→Essence.  (mirror of sign_element)
QUAD_TO_ESMS = {0: SPIRIT, 1: MATTER, 2: SUBSTANCE, 3: ESSENCE}

DEGENERATE_FRACTION = 0.15  # 2nd element below this share of total weight → synthetic pair


def ecliptic_sign(ra_deg, dec_deg):
    """RA/Dec (deg) → zodiac sign index 0..11. Port of equatorial_to_ecliptic_min."""
    eps = math.radians(OBLIQUITY_DEG)
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    lon = math.atan2(math.sin(ra) * math.cos(eps) + math.tan(dec) * math.sin(eps), math.cos(ra))
    lon_deg = math.degrees(lon) % 360.0
    return int(lon_deg // 30.0) % 12


def star_esms(ra_deg, dec_deg):
    return QUAD_TO_ESMS[ecliptic_sign(ra_deg, dec_deg) % 4]


def node_weight(mag):
    return max(0.4, 6.5 - mag)


# ── The curated figures ──────────────────────────────────────────────────────
# ~12 iconic, all-hemisphere constellations (Orion guaranteed). Edges reference
# stars by their catalogue name (proper name where the catalogue has one, else
# the "Greek Abbr" Bayer form the generator produces, e.g. "Gamma Cas"). The
# resolver reports any miss with suggestions so names can be corrected fast.
FIGURES = [
    ("Ori", "Orion", [
        ("Betelgeuse", "Bellatrix"), ("Bellatrix", "Mintaka"), ("Mintaka", "Alnilam"),
        ("Alnilam", "Alnitak"), ("Alnitak", "Betelgeuse"), ("Saiph", "Alnitak"),
        ("Rigel", "Mintaka"), ("Saiph", "Rigel"),
    ]),
    ("UMa", "Ursa Major", [
        ("Dubhe", "Merak"), ("Merak", "Phecda"), ("Phecda", "Megrez"), ("Megrez", "Dubhe"),
        ("Megrez", "Alioth"), ("Alioth", "Mizar"), ("Mizar", "Alkaid"),
    ]),
    ("Cas", "Cassiopeia", [
        ("Caph", "Schedar"), ("Schedar", "Cih"), ("Cih", "Ruchbah"),
        ("Ruchbah", "Segin"),
    ]),
    ("Cyg", "Cygnus", [
        ("Deneb", "Sadr"), ("Sadr", "Gienah"), ("Sadr", "Fawaris"), ("Sadr", "Albireo"),
    ]),
    ("Lyr", "Lyra", [
        ("Vega", "Sulafat"), ("Sulafat", "Sheliak"), ("Sheliak", "Vega"),
    ]),
    ("Sco", "Scorpius", [
        ("Acrab", "Dschubba"), ("Dschubba", "Fang"), ("Dschubba", "Antares"),
        ("Antares", "Larawag"), ("Larawag", "Xamidimura"), ("Xamidimura", "Sargas"),
        ("Sargas", "Shaula"), ("Shaula", "Lesath"),
    ]),
    ("Leo", "Leo", [
        ("Regulus", "Algieba"), ("Algieba", "Adhafera"), ("Adhafera", "Rasalas"),
        ("Regulus", "Chertan"), ("Chertan", "Denebola"), ("Denebola", "Zosma"),
        ("Zosma", "Chertan"), ("Zosma", "Algieba"),
    ]),
    ("Tau", "Taurus", [
        ("Aldebaran", "Elnath"), ("Aldebaran", "Tianguan"),
    ]),
    ("Gem", "Gemini", [
        ("Castor", "Pollux"), ("Pollux", "Wasat"), ("Wasat", "Alhena"),
        ("Castor", "Mebsuta"), ("Mebsuta", "Alhena"),
    ]),
    ("CMa", "Canis Major", [
        ("Mirzam", "Sirius"), ("Sirius", "Wezen"), ("Wezen", "Adhara"),
        ("Wezen", "Aludra"), ("Adhara", "Furud"),
    ]),
    ("Boo", "Bootes", [
        ("Arcturus", "Izar"), ("Izar", "Seginus"), ("Seginus", "Nekkar"),
        ("Nekkar", "Delta Boo"), ("Arcturus", "Muphrid"), ("Muphrid", "Seginus"),
    ]),
    ("Cru", "Crux", [
        ("Acrux", "Gacrux"), ("Mimosa", "Imai"),
    ]),
]


def parse_catalog(js_path):
    """Read star-catalog.js → {name_lower: (hip, ra, dec, mag)} and hip index."""
    text = Path(js_path).read_text(encoding="utf-8")
    by_name, by_hip = {}, {}
    row = re.compile(r'\[(\d+),"((?:[^"\\]|\\.)*)",(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\]')
    for m in row.finditer(text):
        hip = int(m.group(1))
        name = m.group(2).replace('\\"', '"').replace("\\\\", "\\")
        ra, dec, mag = float(m.group(3)), float(m.group(4)), float(m.group(5))
        rec = (hip, ra, dec, mag, name)
        by_name[name.lower()] = rec
        by_hip[hip] = rec
    return by_name, by_hip


def suggest(token, by_name):
    """Best-effort candidate names for a missed token (share a word / abbr)."""
    parts = token.lower().split()
    hits = []
    for low, rec in by_name.items():
        if any(p in low for p in parts):
            hits.append(rec[4])
    return sorted(set(hits))[:8]


def build(by_name):
    misses = []
    constellations = []
    for cid, (abbr, name, edges) in enumerate(FIGURES):
        members = {}          # hip -> rec
        lines = []            # (hipA, hipB)
        for a, b in edges:
            ra_ = by_name.get(a.lower())
            rb_ = by_name.get(b.lower())
            for tok, rec in ((a, ra_), (b, rb_)):
                if rec is None:
                    misses.append((abbr, tok, suggest(tok, by_name)))
            if ra_ is None or rb_ is None:
                continue
            members[ra_[0]] = ra_
            members[rb_[0]] = rb_
            lines.append((ra_[0], rb_[0]))
        if not members:
            continue
        # element histogram (magnitude-weighted) over the figure's stars
        weights = [0.0, 0.0, 0.0, 0.0]
        for hip, (h, ra, dec, mag, nm) in members.items():
            weights[star_esms(ra, dec)] += node_weight(mag)
        total = sum(weights)
        order = sorted(range(4), key=lambda i: (-weights[i], i))
        top1, top2 = order[0], order[1]
        if weights[top2] < DEGENERATE_FRACTION * total:
            elem_a, elem_b, degenerate = top1, OPPOSITE[top1], True
        else:
            elem_a, elem_b, degenerate = top1, top2, False
        elem_a, elem_b = sorted((elem_a, elem_b))  # canonical pool identity
        fee_bps = max(30, min(300, round(300 - 6.0 * total)))
        member_count = len(members)
        visible_threshold = min(member_count, max(3, math.ceil(0.4 * member_count)))
        constellations.append({
            "id": cid, "abbr": abbr, "name": name,
            "elem_a": elem_a, "elem_b": elem_b, "degenerate": degenerate,
            "fee_bps": fee_bps, "visible_threshold": visible_threshold,
            "members": sorted(members.keys()), "lines": lines,
        })
    return constellations, misses


def write_js(cons, path):
    out = [
        "// Constellation liquidity pools — generated by scripts/make_constellations.py",
        "// DO NOT EDIT BY HAND; re-run the script instead.",
        "//",
        "// Each real constellation is a constant-product AMM pool over a pair of ESMS",
        "// elements (0=Spirit,1=Essence,2=Matter,3=Substance). `pair` is frozen here;",
        "// only horizon visibility changes live. Mirrors server/src/constellations.rs.",
        "const CONSTELLATIONS = [",
    ]
    for c in cons:
        members = ",".join(str(h) for h in c["members"])
        lines = ",".join(f"[{a},{b}]" for a, b in c["lines"])
        out.append(
            f'  {{id:{c["id"]},abbr:"{c["abbr"]}",name:"{c["name"]}",'
            f'pair:[{c["elem_a"]},{c["elem_b"]}],degenerate:{str(c["degenerate"]).lower()},'
            f'feeBps:{c["fee_bps"]},visibleThreshold:{c["visible_threshold"]},'
            f'members:[{members}],lines:[{lines}]}},'
        )
    out.append("];")
    out.append('if (typeof module !== "undefined") module.exports = { CONSTELLATIONS };')
    Path(path).write_text("\n".join(out) + "\n", encoding="utf-8")


def write_rust(cons, path):
    out = [
        "//! Constellation liquidity pools — generated by scripts/make_constellations.py",
        "//! DO NOT EDIT BY HAND; re-run the script instead.",
        "//!",
        "//! Each real constellation is a constant-product AMM pool over a pair of ESMS",
        "//! elements (0=Spirit,1=Essence,2=Matter,3=Substance). `pair` is frozen here;",
        "//! only horizon visibility changes live. Mirrors constellations.js.",
        "",
        "pub struct ConstellationDef {",
        "    pub id: u16,",
        "    pub abbr: &'static str,",
        "    pub name: &'static str,",
        "    pub elem_a: u8,",
        "    pub elem_b: u8,",
        "    pub degenerate: bool,",
        "    pub fee_bps: u16,",
        "    pub visible_threshold: u16,",
        "    pub members: &'static [u32],",
        "    pub lines: &'static [(u32, u32)],",
        "}",
        "",
        "pub const CONSTELLATIONS: &[ConstellationDef] = &[",
    ]
    for c in cons:
        members = ", ".join(str(h) for h in c["members"])
        lines = ", ".join(f"({a}, {b})" for a, b in c["lines"])
        out.append(
            f'    ConstellationDef {{ id: {c["id"]}, abbr: "{c["abbr"]}", name: "{c["name"]}", '
            f'elem_a: {c["elem_a"]}, elem_b: {c["elem_b"]}, degenerate: {str(c["degenerate"]).lower()}, '
            f'fee_bps: {c["fee_bps"]}, visible_threshold: {c["visible_threshold"]}, '
            f'members: &[{members}], lines: &[{lines}] }},'
        )
    out.append("];")
    Path(path).write_text("\n".join(out) + "\n", encoding="utf-8")


def main():
    root = Path(__file__).resolve().parent.parent
    by_name, by_hip = parse_catalog(root / "public" / "star-catalog.js")
    cons, misses = build(by_name)

    if misses:
        print("UNRESOLVED figure stars (fix names in FIGURES, then re-run):", file=sys.stderr)
        for abbr, tok, cands in misses:
            cand = ("  candidates: " + ", ".join(cands)) if cands else "  (no candidates)"
            print(f"  [{abbr}] {tok!r}\n{cand}", file=sys.stderr)
        print(f"\n{len(misses)} unresolved — outputs NOT written.", file=sys.stderr)
        sys.exit(1)

    write_js(cons, root / "public" / "constellations.js")
    write_rust(cons, root / "server" / "src" / "constellations.rs")
    print(f"{len(cons)} constellations written.")
    for c in cons:
        pa, pb = ESMS_NAMES[c["elem_a"]], ESMS_NAMES[c["elem_b"]]
        flag = " (synthetic)" if c["degenerate"] else ""
        print(f"  {c['name']:<13} {pa}↔{pb}{flag:<12} "
              f"{len(c['members'])} stars, {len(c['lines'])} lines, "
              f"fee {c['fee_bps']}bps, vis≥{c['visible_threshold']}")


if __name__ == "__main__":
    main()
