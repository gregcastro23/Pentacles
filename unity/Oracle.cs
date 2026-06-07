// Pentacles — the Oracle's proactive voice and on-demand button.
//
// Scans the live tables on an interval, detects the four nudge-worthy changes
// (a planet entering a zone, the weather turning to favor you, a held zone
// slipping, a fresh reachable target), and surfaces the top one as a Toast —
// cadence-capped so it never nags, and mutable. Tips are phrased by OracleAdvisor;
// open chat + teaching come later from the Claude companion service.

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;

public class Oracle : MonoBehaviour
{
    public static Oracle Instance { get; private set; }

    [Tooltip("Seconds between background scans for nudge-worthy changes.")]
    public float ScanInterval = 5f;
    [Tooltip("Minimum seconds between proactive nudges, so the Oracle never nags.")]
    public float NudgeCooldown = 120f;

    public bool Muted { get; private set; }

    float _lastNudge = -9999f;
    bool _primed;
    readonly Dictionary<int, byte> _bodyZone = new();   // planet idx → transiting zone
    readonly Dictionary<byte, int> _zoneFavored = new(); // zone → favored suit
    readonly Dictionary<byte, bool> _zoneRisk = new();   // zone → was slipping
    readonly HashSet<uint> _favTargets = new();          // favorable reachable stars seen
    Text _muteLabel;

    void Awake() => Instance = this;

    void Start()
    {
        BuildButton();
        InvokeRepeating(nameof(Scan), 3f, ScanInterval);
    }

    // ── On-demand ────────────────────────────────────────────────────────────

    public void ShowTip() => Toast.Show(OracleAdvisor.BestTip(CelestialPentacleConn.Instance), 6f);

    public void ToggleMute()
    {
        Muted = !Muted;
        if (_muteLabel != null) _muteLabel.text = Muted ? "Unmute" : "Mute";
        Toast.Show(Muted ? "The Oracle falls silent." : "The Oracle will speak again.", 2.5f);
    }

    // ── Proactive scan ───────────────────────────────────────────────────────

    void Scan()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected) return;
        var fac = OracleAdvisor.MyFaction(conn);
        if (fac == null) return;
        int dom = OracleAdvisor.DominantSuit(conn);

        // Candidate nudges, highest priority first.
        string defense = null, weather = null, target = null, transit = null;

        foreach (var z in conn.Conn.Db.Zone.Iter())
        {
            int fav = CombatPreview.FavoredSuitForZone(conn, z.ZoneId);
            bool mine = z.Owner.HasValue && z.Owner.Value == fac.Value;

            if (_primed && _zoneFavored.TryGetValue(z.ZoneId, out int prevFav)
                && prevFav != fav && fav == dom && !mine)
                weather ??= OracleAdvisor.WeatherTip(z.ZoneId, dom);
            _zoneFavored[z.ZoneId] = fav;

            bool atRisk = mine && z.Control <= OracleAdvisor.RiskBand;
            bool wasRisk = _zoneRisk.TryGetValue(z.ZoneId, out bool pr) && pr;
            if (_primed && atRisk && !wasRisk)
                defense ??= OracleAdvisor.LosingTip(z.ZoneId, z.Control);
            _zoneRisk[z.ZoneId] = atRisk;
        }

        foreach (var e in conn.Conn.Db.Ephemeris.Iter())
        {
            int idx = (int)e.Body;
            if (_primed && _bodyZone.TryGetValue(idx, out byte prev) && prev != e.TransitingZone)
            {
                var zrow = conn.Conn.Db.Zone.ZoneId.Find(e.TransitingZone);
                bool mine = zrow != null && zrow.Owner.HasValue && zrow.Owner.Value == fac.Value;
                if (CombatPreview.FavoredSuitForZone(conn, e.TransitingZone) == dom && !mine)
                    transit ??= OracleAdvisor.TransitTip(idx, e.TransitingZone, dom);
            }
            _bodyZone[idx] = e.TransitingZone;
        }

        // A fresh favorable, reachable target (in a zone whose weather favors you).
        var current = new HashSet<uint>();
        foreach (var s in conn.Conn.Db.StarNode.Iter())
        {
            if (s.HeldBy.HasValue && s.HeldBy.Value == fac.Value) continue;
            if (CombatPreview.FavoredSuitForZone(conn, s.RegionHint) != dom) continue;
            if (!GpsService.Engageable(s.Ra, s.Dec)) continue;
            current.Add(s.HipId);
            if (_primed && !_favTargets.Contains(s.HipId))
                target ??= OracleAdvisor.TargetTip(s.Name, s.RegionHint);
        }
        _favTargets.Clear();
        _favTargets.UnionWith(current);

        _primed = true;

        if (Muted || Time.time - _lastNudge < NudgeCooldown) return;
        string msg = defense ?? weather ?? target ?? transit;
        if (msg != null) { Toast.Show(msg, 6f); _lastNudge = Time.time; }
    }

    // ── Button UI ────────────────────────────────────────────────────────────

    void BuildButton()
    {
        var canvas = UIKit.Canvas("OracleCanvas", 60);
        var row = new GameObject("OracleButtons",
            typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(ContentSizeFitter));
        row.transform.SetParent(canvas.transform, false);
        var rt = (RectTransform)row.transform;
        rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(1f, 1f);
        rt.anchoredPosition = new Vector2(-24, -24);
        var hl = row.GetComponent<HorizontalLayoutGroup>();
        hl.spacing = 8; hl.childAlignment = TextAnchor.UpperRight;
        hl.childControlWidth = hl.childControlHeight = true; hl.childForceExpandWidth = false;
        var f = row.GetComponent<ContentSizeFitter>();
        f.horizontalFit = ContentSizeFitter.FitMode.PreferredSize;
        f.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

        var ask = UIKit.Button(row.transform, "✦ Oracle", ShowTip, 18,
            new Color(0.50f, 0.40f, 0.66f, 0.50f));
        ask.GetComponent<LayoutElement>().minWidth = 150;

        var mute = UIKit.Button(row.transform, "Mute", ToggleMute, 16,
            new Color(0.30f, 0.30f, 0.40f, 0.45f));
        mute.GetComponent<LayoutElement>().minWidth = 96;
        _muteLabel = mute.GetComponentInChildren<Text>();
    }
}
