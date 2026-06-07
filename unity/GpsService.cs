using System.Collections;
using UnityEngine;

/// Captures the device's real-world location and reports it to the server, which
/// anchors the player's horizon: the hard engagement gate (resolve_star_battle)
/// only lets you strike stars currently risen above where you stand, and the AR
/// view uses the same horizon to show what's reachable.
///
/// Attach to a persistent GameObject. Requires location permission (set
/// "Location Usage Description" / the iOS & Android location permissions in the
/// player settings). The SetLocation binding appears after `spacetime generate`.
public class GpsService : MonoBehaviour
{
    [Tooltip("Seconds between location reports to the server.")]
    public float ReportInterval = 30f;

    [Tooltip("Only report when moved at least this many metres (cheap distance).")]
    public float MinMoveMetres = 25f;

    /// Last fix we have (degrees, east-positive longitude); valid once Ready.
    public double Latitude { get; private set; }
    public double Longitude { get; private set; }
    public bool Ready { get; private set; }

    double _lastSentLat, _lastSentLon;
    bool _everSent;

    void OnEnable() => StartCoroutine(Run());

    IEnumerator Run()
    {
#if UNITY_ANDROID
        if (!UnityEngine.Android.Permission.HasUserAuthorizedPermission(
                UnityEngine.Android.Permission.FineLocation))
        {
            UnityEngine.Android.Permission.RequestUserPermission(
                UnityEngine.Android.Permission.FineLocation);
            // Give the prompt a moment; the user may grant it asynchronously.
            yield return new WaitForSeconds(2f);
        }
#endif
        if (!Input.location.isEnabledByUser)
        {
            Debug.LogWarning("[GpsService] Location services disabled by the user — " +
                             "star engagement will stay gated until enabled.");
            yield break;
        }

        Input.location.Start(desiredAccuracyInMeters: 10f, updateDistanceInMeters: 10f);

        int guard = 20; // ~20s to initialise
        while (Input.location.status == LocationServiceStatus.Initializing && guard-- > 0)
            yield return new WaitForSeconds(1f);

        if (Input.location.status != LocationServiceStatus.Running)
        {
            Debug.LogWarning($"[GpsService] Location unavailable ({Input.location.status}).");
            yield break;
        }

        var wait = new WaitForSeconds(Mathf.Max(1f, ReportInterval));
        while (enabled)
        {
            var d = Input.location.lastData;
            Latitude = d.latitude;
            Longitude = d.longitude;
            Ready = true;

            if (!_everSent || MovedFar(d.latitude, d.longitude))
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
        if (Input.location.status == LocationServiceStatus.Running)
            Input.location.Stop();
    }
}
