// Pentacles — client-side natal chart calculation.
//
// Birth date/time/location  ──►  NatalChart { placements[10], ascendant, midheaven }
// which is handed to `CelestialPentacleConn.CreatePlayer(handle, chart, faction)`.
//
// Uses low-precision (JPL Keplerian) planetary positions + a truncated lunar
// series. Game-grade: good to well under a degree for Sun/planets, ~a degree for
// the Moon — fine for sign/decan placement. Swap in SwissEphNet for production.
//
// Depends on the SpacetimeDB-generated types (NatalChart, Placement, Planet) and
// on SkyMath. Run `spacetime generate --lang csharp` first.

using System;
using System.Collections.Generic;
using SpacetimeDB.Types;

public static class ChartCalculator
{
    // ── Public entry point ────────────────────────────────────────────────

    /// Build a NatalChart from real birth input. `birthUtc` must already be UTC
    /// (convert from local + timezone before calling). If time is unknown, pass
    /// noon local-as-UTC and timeKnown=false (Ascendant/MC then mean little).
    public static NatalChart Build(DateTime birthUtc, double latDeg, double lonDeg, bool timeKnown)
    {
        double jd = SkyMath.JulianDay(birthUtc);
        var placements = new List<Placement>(10);

        for (int p = 0; p < 10; p++)
        {
            double lon = GeocentricEclipticLon(p, jd);
            double lonLater = GeocentricEclipticLon(p, jd + 1.0); // +1 day, for retrograde
            bool retro = SkyMath.Norm360(lonLater - lon) > 180.0; // longitude decreasing
            int sign = (int)(SkyMath.Norm360(lon) / 30.0) % 12;
            ushort arcMinutes = (ushort)Math.Round((SkyMath.Norm360(lon) - sign * 30.0) * 60.0);
            if (arcMinutes > 1799) arcMinutes = 1799;

            placements.Add(new Placement
            {
                Body = (Planet)p,
                Sign = (byte)sign,
                ArcMinutes = arcMinutes,
                Retrograde = retro,
                Dignity = (sbyte)Dignity(p, sign),
            });
        }

        double asc = 0, mc = 0;
        if (timeKnown) AscMc(jd, latDeg, lonDeg, out asc, out mc);

        return new NatalChart
        {
            BirthUnix = ((DateTimeOffset)DateTime.SpecifyKind(birthUtc, DateTimeKind.Utc)).ToUnixTimeSeconds(),
            BirthLat = latDeg,
            BirthLon = lonDeg,
            TimeKnown = timeKnown,
            Ascendant = (ushort)Math.Round(SkyMath.Norm360(asc) * 60.0), // absolute zodiac arc-minutes
            Midheaven = (ushort)Math.Round(SkyMath.Norm360(mc) * 60.0),
            Placements = placements,
        };
    }

    /// Calculate reception & mutual reception boosts for each planet.
    public static double[] CalculateReceptionBoosts(NatalChart chart)
    {
        var boosts = new double[10];
        
        // 1. Standard reception
        foreach (var p in chart.Placements)
        {
            int ruler = SignRuler(p.Sign);
            if (ruler != (int)p.Body)
            {
                boosts[(int)p.Body] += 0.5;
            }
        }
        
        // 2. Mutual reception
        for (int i = 0; i < chart.Placements.Count; i++)
        {
            for (int j = i + 1; j < chart.Placements.Count; j++)
            {
                var p1 = chart.Placements[i];
                var p2 = chart.Placements[j];
                int r1 = SignRuler(p1.Sign);
                int r2 = SignRuler(p2.Sign);
                if (r1 == (int)p2.Body && r2 == (int)p1.Body)
                {
                    boosts[(int)p1.Body] += 1.5;
                    boosts[(int)p2.Body] += 1.5;
                }
            }
        }
        
        return boosts;
    }

    /// The three highest-scoring factions to surface as the player's choice
    /// (mirrors the server's weighted dignity vector; server re-validates).
    public static int[] TopFactions(NatalChart chart)
    {
        var s = new double[10];
        int ascSign = (chart.Ascendant / 1800) % 12;
        s[SignRuler(ascSign)] += 3.0;
        foreach (var pl in chart.Placements)
        {
            s[(int)pl.Body] += 1.0 + pl.Dignity * 0.4;
            if (pl.Body == Planet.Sun) s[SignRuler(pl.Sign)] += 2.0;
            if (pl.Body == Planet.Moon) s[SignRuler(pl.Sign)] += 2.0;
        }

        // Add reception & mutual reception boosts
        var receptionBoosts = CalculateReceptionBoosts(chart);
        for (int i = 0; i < 10; i++)
        {
            s[i] += receptionBoosts[i];
        }

        var order = new List<int>();
        for (int i = 0; i < 10; i++) order.Add(i);
        order.Sort((a, b) => s[b].CompareTo(s[a]));
        return new[] { order[0], order[1], order[2] };
    }

    // ── Planetary positions ───────────────────────────────────────────────

    // Geocentric ecliptic longitude (deg) of body index p (0 Sun .. 9 Pluto).
    static double GeocentricEclipticLon(int p, double jd)
    {
        if (p == 0) return SunLon(jd);
        if (p == 1) return MoonLon(jd);
        // Planets: heliocentric of body − heliocentric of Earth, then to ecliptic lon.
        HelioEcliptic(PlanetIdx(p), jd, out double px, out double py, out double pz);
        HelioEcliptic(2 /*Earth*/, jd, out double ex, out double ey, out double ez);
        double x = px - ex, y = py - ey;
        return SkyMath.Norm360(SkyMath.Rad2Deg(Math.Atan2(y, x)));
    }

    // Map our planet index (Mercury=2..Pluto=9) to the Keplerian element row.
    static int PlanetIdx(int p) => p switch
    {
        2 => 0, // Mercury
        3 => 1, // Venus
        4 => 3, // Mars
        5 => 4, // Jupiter
        6 => 5, // Saturn
        7 => 6, // Uranus
        8 => 7, // Neptune
        9 => 8, // Pluto
        _ => 2, // Earth (row 2) — used internally
    };

    // JPL low-precision Keplerian elements (J2000) and their per-century rates.
    // Rows: 0 Mercury,1 Venus,2 Earth/EM-Bary,3 Mars,4 Jupiter,5 Saturn,
    //       6 Uranus,7 Neptune,8 Pluto.  a(AU) e I(deg) L(deg) ϖ(deg) Ω(deg)
    static readonly double[,] El = {
        { 0.38709927, 0.20563593, 7.00497902, 252.25032350, 77.45779628, 48.33076593 },
        { 0.72333566, 0.00677672, 3.39467605, 181.97909950, 131.60246718, 76.67984255 },
        { 1.00000261, 0.01671123,-0.00001531, 100.46457166, 102.93768193, 0.0 },
        { 1.52371034, 0.09339410, 1.84969142, -4.55343205, -23.94362959, 49.55953891 },
        { 5.20288700, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909 },
        { 9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448 },
        {19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.95427630, 74.01692503 },
        {30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574 },
        {39.48211675, 0.24882730,17.14001206, 238.92903833, 224.06891629, 110.30393684 },
    };
    static readonly double[,] Rate = {
        { 0.00000037, 0.00001906,-0.00594749, 149472.67411175, 0.16047689,-0.12534081 },
        { 0.00000390,-0.00004107,-0.00078890, 58517.81538729, 0.00268329,-0.27769418 },
        { 0.00000562,-0.00004392,-0.01294668, 35999.37244981, 0.32327364, 0.0 },
        { 0.00001847, 0.00007882,-0.00813131, 19140.30268499, 0.44441088,-0.29257343 },
        {-0.00011607,-0.00013253,-0.00183714, 3034.74612775, 0.21252668, 0.20469106 },
        {-0.00125060,-0.00050991, 0.00193609, 1222.49362201,-0.41897216,-0.28867794 },
        {-0.00196176,-0.00004397,-0.00242939, 428.48202785, 0.40805281, 0.04240589 },
        { 0.00026291, 0.00005105, 0.00035372, 218.45945325,-0.32241464,-0.00508664 },
        {-0.00031596, 0.00005170, 0.00004818, 145.20780515,-0.04062942,-0.01183482 },
    };

    // Heliocentric J2000 ecliptic rectangular coords (AU) of an element row.
    static void HelioEcliptic(int row, double jd, out double x, out double y, out double z)
    {
        double t = SkyMath.CenturiesSinceJ2000(jd);
        double a = El[row, 0] + Rate[row, 0] * t;
        double e = El[row, 1] + Rate[row, 1] * t;
        double I = SkyMath.Deg2Rad(El[row, 2] + Rate[row, 2] * t);
        double L = El[row, 3] + Rate[row, 3] * t;
        double peri = El[row, 4] + Rate[row, 4] * t;
        double node = SkyMath.Deg2Rad(El[row, 5] + Rate[row, 5] * t);

        double M = SkyMath.Deg2Rad(SkyMath.Norm360(L - peri));
        double w = SkyMath.Deg2Rad(peri) - node;

        // Solve Kepler's equation for eccentric anomaly.
        double E = M;
        for (int i = 0; i < 8; i++) E -= (E - e * Math.Sin(E) - M) / (1 - e * Math.Cos(E));

        double xv = a * (Math.Cos(E) - e);
        double yv = a * (Math.Sqrt(1 - e * e) * Math.Sin(E));
        double v = Math.Atan2(yv, xv);
        double r = Math.Sqrt(xv * xv + yv * yv);

        double cosNode = Math.Cos(node), sinNode = Math.Sin(node);
        double cosI = Math.Cos(I), sinI = Math.Sin(I);
        double u = v + w;
        x = r * (cosNode * Math.Cos(u) - sinNode * Math.Sin(u) * cosI);
        y = r * (sinNode * Math.Cos(u) + cosNode * Math.Sin(u) * cosI);
        z = r * (Math.Sin(u) * sinI);
    }

    // Geocentric Sun longitude (deg) — low precision (Meeus 25.x truncated).
    static double SunLon(double jd)
    {
        double t = SkyMath.CenturiesSinceJ2000(jd);
        double L0 = SkyMath.Norm360(280.46646 + 36000.76983 * t + 0.0003032 * t * t);
        double M = SkyMath.Deg2Rad(SkyMath.Norm360(357.52911 + 35999.05029 * t - 0.0001537 * t * t));
        double c = (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.Sin(M)
                 + (0.019993 - 0.000101 * t) * Math.Sin(2 * M)
                 + 0.000289 * Math.Sin(3 * M);
        return SkyMath.Norm360(L0 + c);
    }

    // Geocentric Moon longitude (deg) — truncated ELP (main periodic terms).
    static double MoonLon(double jd)
    {
        double t = SkyMath.CenturiesSinceJ2000(jd);
        double Lp = 218.3164477 + 481267.88123421 * t;          // mean longitude
        double D = 297.8501921 + 445267.1114034 * t;            // mean elongation
        double M = 357.5291092 + 35999.0502909 * t;             // Sun mean anomaly
        double Mp = 134.9633964 + 477198.8675055 * t;           // Moon mean anomaly
        double F = 93.2720950 + 483202.0175233 * t;             // argument of latitude
        double d = SkyMath.Deg2Rad(D), m = SkyMath.Deg2Rad(M), mp = SkyMath.Deg2Rad(Mp), f = SkyMath.Deg2Rad(F);
        double lon = Lp
            + 6.288774 * Math.Sin(mp)
            + 1.274027 * Math.Sin(2 * d - mp)
            + 0.658314 * Math.Sin(2 * d)
            + 0.213618 * Math.Sin(2 * mp)
            - 0.185116 * Math.Sin(m)
            - 0.114332 * Math.Sin(2 * f)
            + 0.058793 * Math.Sin(2 * d - 2 * mp)
            + 0.057066 * Math.Sin(2 * d - m - mp)
            + 0.053322 * Math.Sin(2 * d + mp)
            + 0.045758 * Math.Sin(2 * d - m);
        return SkyMath.Norm360(lon);
    }

    // ── Ascendant & Midheaven ─────────────────────────────────────────────

    static void AscMc(double jd, double latDeg, double lonDeg, out double ascDeg, out double mcDeg)
    {
        double ramc = SkyMath.Deg2Rad(SkyMath.LstDeg(jd, lonDeg)); // right ascension of MC
        double e = SkyMath.Deg2Rad(SkyMath.Obliquity);
        double lat = SkyMath.Deg2Rad(latDeg);

        // MC: ecliptic point on the meridian (tan λ = tan RAMC / cos ε).
        mcDeg = SkyMath.Norm360(SkyMath.Rad2Deg(Math.Atan2(Math.Sin(ramc), Math.Cos(e) * Math.Cos(ramc))));

        // Ascendant: ecliptic point rising on the eastern horizon (Meeus).
        double asc = Math.Atan2(
            Math.Cos(ramc),
            -(Math.Sin(e) * Math.Tan(lat) + Math.Cos(e) * Math.Sin(ramc)));
        ascDeg = SkyMath.Norm360(SkyMath.Rad2Deg(asc));
    }

    // ── Dignities ─────────────────────────────────────────────────────────

    // -5 fall .. +5 rulership, by (planet, sign). 0 = peregrine.
    static int Dignity(int planet, int sign)
    {
        if (SignRuler(sign) == planet) return 5;             // rulership
        if (Exaltation(planet) == sign) return 4;            // exaltation
        if (SignRuler((sign + 6) % 12) == planet) return -5; // detriment (opposite sign's rulership)
        if (Exaltation(planet) >= 0 && (Exaltation(planet) + 6) % 12 == sign) return -4; // fall
        return 0;
    }

    static int SignRuler(int sign) => sign % 12 switch
    {
        0 => 4, 1 => 3, 2 => 2, 3 => 1, 4 => 0, 5 => 2,
        6 => 3, 7 => 9, 8 => 5, 9 => 6, 10 => 7, _ => 8,
    };

    static int Exaltation(int planet) => planet switch
    {
        0 => 0,   // Sun — Aries
        1 => 1,   // Moon — Taurus
        2 => 5,   // Mercury — Virgo
        3 => 11,  // Venus — Pisces
        4 => 9,   // Mars — Capricorn
        5 => 3,   // Jupiter — Cancer
        6 => 6,   // Saturn — Libra
        _ => -1,  // outer planets: no classical exaltation
    };
}
