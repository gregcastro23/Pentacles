// Pentacles — the eleven-zone grid, anchored to the local horizon (not the stars).
//
// The sky hemisphere is projected to a unit disk (azimuthal-equidistant from the
// zenith): r = (90 - altitude) / 90, so zenith = centre, horizon = rim. North is
// +Y on the disk; one spire locks to true North. The geometry below is the exact
// pentagram from the GDD figure (Fig. 1), normalised to that disk.
//
// Zone ids:  0-4 Arc-Houses · 5-9 Spires · 10 Crown.

using System.Collections.Generic;
using UnityEngine;

public static class PentacleGrid
{
    // Outer star points (spire tips) at r = 1, every 72° from North.
    static readonly Vector2[] T =
    {
        new(0.000f,  1.000f), new(0.951f,  0.309f), new(0.588f, -0.809f),
        new(-0.588f, -0.809f), new(-0.951f,  0.309f),
    };

    // Inner pentagon vertices (the Crown) — pentagram intersections.
    static readonly Vector2[] V =
    {
        new(0.2244f,  0.3088f), new(0.3632f, -0.118f), new(0.000f, -0.382f),
        new(-0.3632f, -0.118f), new(-0.2244f,  0.3088f),
    };

    /// Polygon (disk coords) for a zone id, for rendering the overlay.
    public static Vector2[] ZonePolygon(int zoneId)
    {
        if (zoneId == 10) return V;                                   // Crown
        if (zoneId >= 5)                                              // Spire k = [T_k, V_{k-1}, V_k]
        {
            int k = zoneId - 5;
            return new[] { T[k], V[(k + 4) % 5], V[k] };
        }
        // Arc-House k = [T_k, V_k, T_{k+1}] (outer edge rides the horizon rim).
        return new[] { T[zoneId], V[zoneId], T[(zoneId + 1) % 5] };
    }

    /// Which zone a sky direction falls in. alt/az in degrees (az from North → East).
    public static int ZoneForAltAz(double altDeg, double azDeg)
    {
        if (altDeg < 0) return -1; // below the horizon
        float r = (float)((90.0 - altDeg) / 90.0);
        float a = (float)SkyMath.Deg2Rad(azDeg);
        var p = new Vector2(r * Mathf.Sin(a), r * Mathf.Cos(a)); // +Y = North

        if (PointInPoly(p, V)) return 10;                 // Crown first (innermost)
        for (int k = 0; k < 5; k++)                        // then Spires
            if (PointInPoly(p, ZonePolygon(5 + k))) return 5 + k;
        for (int k = 0; k < 5; k++)                        // then Arc-Houses
            if (PointInPoly(p, ZonePolygon(k))) return k;

        // Numerical fallback: nearest sector by angle.
        float deg = (float)SkyMath.Norm360(azDeg);
        return Mathf.Clamp(Mathf.FloorToInt(((deg + 36f) % 360f) / 72f), 0, 4);
    }

    /// Sampled world-space ring of a zone's outline, for a LineRenderer.
    public static List<Vector3> ZoneOutlineWorld(int zoneId, int arcSamples = 10)
    {
        var poly = ZonePolygon(zoneId);
        var outRing = new List<Vector3>();
        for (int i = 0; i < poly.Length; i++)
        {
            Vector2 a = poly[i], b = poly[(i + 1) % poly.Length];
            bool bothRim = a.magnitude > 0.98f && b.magnitude > 0.98f;
            int steps = bothRim ? arcSamples : 1; // curve edges that ride the horizon
            for (int s = 0; s < steps; s++)
                outRing.Add(DiskToWorld(Vector2.Lerp(a, b, s / (float)steps)));
        }
        return outRing;
    }

    /// Disk point → Unity world direction (unit), via alt/az.
    public static Vector3 DiskToWorld(Vector2 d)
    {
        float r = Mathf.Clamp01(d.magnitude);
        double altDeg = 90.0 - r * 90.0;
        double azDeg = SkyMath.Norm360(SkyMath.Rad2Deg(Mathf.Atan2(d.x, d.y))); // from +Y(North) → +X(East)
        return SkyMath.HorizontalToWorld(altDeg, azDeg);
    }

    static bool PointInPoly(Vector2 p, Vector2[] poly)
    {
        bool inside = false;
        for (int i = 0, j = poly.Length - 1; i < poly.Length; j = i++)
        {
            if (((poly[i].y > p.y) != (poly[j].y > p.y)) &&
                (p.x < (poly[j].x - poly[i].x) * (p.y - poly[i].y) / (poly[j].y - poly[i].y) + poly[i].x))
                inside = !inside;
        }
        return inside;
    }
}
