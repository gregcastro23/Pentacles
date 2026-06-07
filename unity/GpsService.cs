using System;
using System.Collections;
using UnityEngine;

/// The single source of truth for the player's real-world location. It reports
/// the fix to the server (set_location), which anchors the player's horizon: the
/// hard engagement gate (resolve_star_battle) only lets you strike stars risen at
/// least MinEngageAltDeg above where you stand, and the AR view uses the same
/// horizon to show what's reachable.
///
/// Attach to a persistent GameObject. Needs location permission (set the iOS
/// "Location Usage Description" and the Android location permissions in Player
/// Settings). When device GPS is unavailable (editor, denied permission) it falls
/// back to the serialized coordinates and still reports them, so the game stays
/// playable and testable. The SetLocation binding appears after `spacetime generate`.
public class GpsService : MonoBehaviour
{
    public static GpsService Instance { get; private set; }

    /// A star must clear this altitude over your horizon before you may engage it.
    /// Mirrors server MIN_ALT_DEG so the client preview agrees with the gate.
    public const double MinEngageAltDeg = 10.0;

    [Tooltip("Seconds between location reports to the server.")]
    public float ReportInterval = 30f;

    [Tooltip("Only report when moved at least this many metres (cheap distance).")]
    public float MinMoveMetres = 25f;

    [Header("Fallback when device GPS is unavailable (editor / denied permission)")]
    public double FallbackLatitude = 40.7128;
    public double FallbackLongitude = -74.0060;

    /// Latest fix (degrees, east-positive longitude); valid once Ready.
    public double Latitude { get; private set; }
    public double Longitude { get; private set; }
    public bool Ready { get; private set; }

    double _lastSentLat, _lastSentLon;
    bool _everSent;
    bool _usingDevice;

    void Awake() => Instance = this;
    void OnEnable() => StartCoroutine(Run());

    IEnumerator Run()
    {
        // Start from the fallback so we always have a usable location.
        Latitude = FallbackLatitude;
        Longitude = FallbackLongitude;
        _usingDevice = false;

#if UNITY_ANDROID
        if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(
                UnityEngine.Android.Permission.FineLocation))
        {
            UnityEngine.Android.Permission.RequestUserPermission(
                UnityEngine.Android.Permission.FineLocation);
            yield return new WaitForSeconds(2f); // the user may grant it asynchronously
        }
#endif

        if (Input.location.isEnabledByUser)
        {
            Input.location.Start(desiredAccuracyInMeters: 10f, updateDistanceInMeters: 10f);
            int guard = 20; // ~20s to initialise
            while (Input.location.status == LocationServiceStatus.Initializing && guard-- > 0)
                yield return new WaitForSeconds(1f);
            _usingDevice = Input.location.status == LocationServiceStatus.Running;
            if (!_usingDevice)
            {
                Debug.LogWarning($"[GpsService] Device location unavailable ({Input.location.status}); using fallback.");
                Toast.Show("No GPS fix — using a default location. Enable location to play your real sky.", 5f);
            }
        }
        else
        {
            Debug.LogWarning("[GpsService] Location services disabled by the user — using fallback coordinates.");
            Toast.Show("Location is off — using a default location. Enable it to play your real sky.", 5f);
        }

        Ready = true;

        var wait = new WaitForSeconds(Mathf.Max(1f, ReportInterval));
        while (enabled)
        {
            if (_usingDevice && Input.location.status == LocationServiceStatus.Running)
            {
                var d = Input.location.lastData;
                Latitude = d.latitude;
                Longitude = d.longitude;
            }

            if (!_everSent || MovedFar(Latitude, Longitude))
                Report();

            yield return wait;
        }
    }

    /// Cheap equirectangular metres between the last sent fix and a new one.
    bool MovedFar(double lat, double lon)
    {
        const double MetresPerDeg = 111_320.0;
        double dLat = (lat - _lastSentLat) * MetresPerDeg;
        double dLon = (lon - _lastSentLon) * MetresPerDeg * Mathf.Cos((float)(lat * Mathf.Deg2Rad));
        return dLat * dLat + dLon * dLon >= MinMoveMetres * MinMoveMetres;
    }

    void Report()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected)
            return;
        conn.SetLocation(Latitude, Longitude);
        _lastSentLat = Latitude;
        _lastSentLon = Longitude;
        _everSent = true;
    }

    void OnDisable()
    {
        if (_usingDevice && Input.location.status == LocationServiceStatus.Running)
            Input.location.Stop();
    }

    // ── Shared engagement helpers ────────────────────────────────────────────

    /// The player's location if a fix is ready (device or fallback).
    public static bool TryLocation(out double lat, out double lon)
    {
        if (Instance != null && Instance.Ready)
        {
            lat = Instance.Latitude;
            lon = Instance.Longitude;
            return true;
        }
        lat = 0; lon = 0;
        return false;
    }

    /// Current altitude (deg) of an equatorial point for the player, or NaN when
    /// there's no usable fix yet (no GpsService in the scene, or not ready).
    public static double Altitude(double raDeg, double decDeg)
    {
        if (Instance == null || !Instance.Ready)
            return double.NaN;
        double jd = SkyMath.JulianDay(DateTime.UtcNow);
        double lst = SkyMath.LstDeg(jd, Instance.Longitude);
        SkyMath.EquatorialToHorizontal(raDeg, decDeg, Instance.Latitude, lst, out double alt, out _);
        return alt;
    }

    /// Whether the player may engage a star at (ra, dec) right now — risen past
    /// the engage altitude. Mirrors the server's hard gate.
    public static bool Engageable(double raDeg, double decDeg)
    {
        double a = Altitude(raDeg, decDeg);
        return !double.IsNaN(a) && a >= MinEngageAltDeg;
    }
}
