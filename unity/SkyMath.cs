// Pentacles — shared celestial coordinate math (pure, no Unity deps except Vector3).
//
// Frames:
//   Ecliptic   (λ, β)      — where planets/Sun/Moon are naturally computed
//   Equatorial (RA, Dec)   — what the star catalogue stores
//   Horizontal (alt, az)   — observer-local; the Pentacle is anchored here
//   World      (Vector3)   — Unity, with +Z = true North, +X = East, +Y = up
//
// Accuracy is game-grade (low-precision series), not Swiss-Ephemeris. Good to a
// fraction of a degree for the Sun/planets — plenty for an AR territory game.

using System;
using UnityEngine;

public static class SkyMath
{
    public const double Obliquity = 23.439291; // mean obliquity of the ecliptic (deg, J2000)

    public static double Deg2Rad(double d) => d * Math.PI / 180.0;
    public static double Rad2Deg(double r) => r * 180.0 / Math.PI;
    public static double Norm360(double d) { d %= 360.0; return d < 0 ? d + 360.0 : d; }

    /// Julian Day from a UTC instant.
    public static double JulianDay(DateTime utc)
    {
        int y = utc.Year, m = utc.Month;
        double d = utc.Day
            + (utc.Hour + utc.Minute / 60.0 + (utc.Second + utc.Millisecond / 1000.0) / 3600.0) / 24.0;
        if (m <= 2) { y -= 1; m += 12; }
        int a = y / 100;
        int b = 2 - a + a / 4;
        return Math.Floor(365.25 * (y + 4716)) + Math.Floor(30.6001 * (m + 1)) + d + b - 1524.5;
    }

    /// Julian centuries since J2000.0.
    public static double CenturiesSinceJ2000(double jd) => (jd - 2451545.0) / 36525.0;

    /// Greenwich Mean Sidereal Time in degrees.
    public static double GmstDeg(double jd)
    {
        double t = CenturiesSinceJ2000(jd);
        double gmst = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
            + 0.000387933 * t * t - t * t * t / 38710000.0;
        return Norm360(gmst);
    }

    /// Local apparent sidereal time in degrees (east longitude positive).
    public static double LstDeg(double jd, double eastLonDeg) => Norm360(GmstDeg(jd) + eastLonDeg);

    /// Ecliptic (deg) → equatorial (RA deg, Dec deg).
    public static void EclipticToEquatorial(double lonDeg, double latDeg, out double raDeg, out double decDeg)
    {
        double e = Deg2Rad(Obliquity), l = Deg2Rad(lonDeg), b = Deg2Rad(latDeg);
        double sinDec = Math.Sin(b) * Math.Cos(e) + Math.Cos(b) * Math.Sin(e) * Math.Sin(l);
        double dec = Math.Asin(sinDec);
        double y = Math.Sin(l) * Math.Cos(e) - Math.Tan(b) * Math.Sin(e);
        double x = Math.Cos(l);
        double ra = Math.Atan2(y, x);
        raDeg = Norm360(Rad2Deg(ra));
        decDeg = Rad2Deg(dec);
    }

    /// Equatorial (RA/Dec deg) → horizontal (alt/az deg). Az measured from North, clockwise (→East).
    public static void EquatorialToHorizontal(
        double raDeg, double decDeg, double latDeg, double lstDeg, out double altDeg, out double azDeg)
    {
        double ha = Deg2Rad(Norm360(lstDeg - raDeg)); // hour angle
        double dec = Deg2Rad(decDeg), lat = Deg2Rad(latDeg);
        double sinAlt = Math.Sin(dec) * Math.Sin(lat) + Math.Cos(dec) * Math.Cos(lat) * Math.Cos(ha);
        double alt = Math.Asin(Mathf.Clamp((float)sinAlt, -1f, 1f));
        double y = -Math.Cos(dec) * Math.Cos(lat) * Math.Sin(ha);
        double x = Math.Sin(dec) - Math.Sin(lat) * sinAlt;
        double az = Math.Atan2(y, x);
        altDeg = Rad2Deg(alt);
        azDeg = Norm360(Rad2Deg(az));
    }

    /// Horizontal (alt/az deg) → Unity world direction (+Z North, +X East, +Y up).
    public static Vector3 HorizontalToWorld(double altDeg, double azDeg)
    {
        double alt = Deg2Rad(altDeg), az = Deg2Rad(azDeg);
        float x = (float)(Math.Cos(alt) * Math.Sin(az)); // East
        float y = (float)Math.Sin(alt);                  // Up
        float z = (float)(Math.Cos(alt) * Math.Cos(az)); // North
        return new Vector3(x, y, z);
    }
}
