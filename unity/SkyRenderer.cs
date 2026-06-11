// Pentacles — AR sky renderer.
//
// Renders the live star catalogue and the horizon-anchored Pentacle overlay,
// colours zones/stars by their owning faction, and turns a tap into a star
// attack. The Pentacle is fixed to the local horizon frame; stars & planets
// drift through it as the sky turns (their alt/az is recomputed every frame).
//
// Requires: the AR camera session aligned to true North (device compass) so
// world +Z = North matches SkyMath. Attach to a GameObject; assign `origin`
// to the AR camera (or leave null to use this transform).

using System;
using System.Collections.Generic;
using SpacetimeDB.Types;
using UnityEngine;
using UnityEngine.UI;

public class SkyRenderer : MonoBehaviour
{
    public static SkyRenderer Instance { get; private set; }

    [Header("Observer (falls back to these if GPS is unavailable)")]
    public double latitude = 40.7128;
    public double longitude = -74.0060;

    [Header("Render")]
    public Transform origin;          // AR camera / player head; null → this transform
    public float skyRadius = 20f;     // distance to place sky nodes
    public GameObject starPrefab;     // null → a small sphere is created
    public Material zoneLineMaterial; // for the Pentacle outline LineRenderers
    /// The full naked-eye catalogue (~5k rows to mag 6.0) lives in the module;
    /// instantiate AR nodes only down to this magnitude so mobile framerate
    /// holds (5.0 ≈ 1,600 stars). Raise it on capable hardware for the full sky.
    public float maxRenderMagnitude = 5.0f;

    [Header("Planets (the wanderers)")]
    /// Planets share the stars' sky — one plane, one projection — but render
    /// at deliberately exaggerated sizes: they are far closer than any star,
    /// so they read much larger. Each body is the planetary agent of its
    /// current zodiac degree (the planetary-agents project).
    public float planetScale = 1f;

    static readonly Color[] FactionColor = {
        new(1.00f, 0.78f, 0.36f), // Sun
        new(0.85f, 0.86f, 0.92f), // Moon
        new(0.66f, 0.71f, 0.83f), // Mercury
        new(0.87f, 0.62f, 0.74f), // Venus
        new(0.84f, 0.32f, 0.32f), // Mars
        new(0.85f, 0.65f, 0.36f), // Jupiter
        new(0.62f, 0.60f, 0.52f), // Saturn
        new(0.40f, 0.74f, 0.80f), // Uranus
        new(0.40f, 0.46f, 0.82f), // Neptune
        new(0.56f, 0.44f, 0.66f), // Pluto
    };
    static readonly Color Neutral = new(0.55f, 0.55f, 0.62f);

    /// Per-star render state. The renderer + last tint are cached so a frame
    /// only writes a material colour when a star's owner/engageability actually
    /// changed — with a thousand-plus stars overhead that's the difference
    /// between a hot loop and a quiet one.
    class StarVis
    {
        public Transform Tr;
        public Renderer Rend;
        public Planet? TintHeld;
        public bool TintEngageable = true;
        public bool TintValid;
    }

    readonly Dictionary<uint, StarVis> _stars = new();
    readonly Dictionary<Planet, StarVis> _planets = new();
    readonly Dictionary<byte, LineRenderer> _zones = new();
    bool _gridBuilt;

    // Sun..Pluto sphere sizes — huge next to stars (0.08–0.45) on purpose.
    static readonly float[] PlanetSize = { 1.6f, 1.4f, 0.9f, 1.1f, 1.1f, 1.3f, 1.2f, 0.9f, 0.9f, 0.8f };

    /// How many stars are currently risen past the engage altitude (strikeable now).
    public int InReachCount { get; private set; }
    Text _hud;

    void Awake() { Instance = this; if (origin == null) origin = transform; }

    void Start()
    {
        // GpsService is the GPS authority when present; only self-manage as a fallback.
        if (GpsService.Instance == null && Input.location.isEnabledByUser) Input.location.Start();
        BuildHud();
    }

    void BuildHud()
    {
        var canvas = UIKit.Canvas("SkyHudCanvas", 40);
        _hud = UIKit.Label(canvas.transform, "✦ scanning the sky…", 24, FontStyle.Bold,
            new Color(0.95f, 0.90f, 0.80f), TextAnchor.UpperLeft);
        var rt = (RectTransform)_hud.transform;
        rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(0f, 1f);
        rt.anchoredPosition = new Vector2(28, -28);
        rt.sizeDelta = new Vector2(620, 36);
    }

    void Update()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected) return;

        if (GpsService.TryLocation(out double glat, out double glon))
        {
            latitude = glat; longitude = glon;
        }
        else if (Input.location.status == LocationServiceStatus.Running)
        {
            latitude = Input.location.lastData.latitude;
            longitude = Input.location.lastData.longitude;
        }

        double jd = SkyMath.JulianDay(DateTime.UtcNow);
        double lst = SkyMath.LstDeg(jd, longitude);

        if (!_gridBuilt) { BuildPentacle(); _gridBuilt = true; }
        RefreshStars(conn, lst);
        RefreshPlanets(conn, lst);
        HandleTap(conn, lst);
    }

    // ── Planets ───────────────────────────────────────────────────────────

    /// The ten wanderers from the live `ephemeris` feed, in the same sky as
    /// the stars (same shell, same alt/az), just much larger — they're closer.
    /// They are display-only here — taps still pick stars (`PickStar` walks
    /// `_stars`), so a giant Jupiter never eats a strike meant for a star.
    void RefreshPlanets(CelestialPentacleConn conn, double lst)
    {
        foreach (var e in conn.Conn.Db.Ephemeris.Iter())
        {
            if (!_planets.TryGetValue(e.Body, out var vis))
            {
                var go = GameObject.CreatePrimitive(PrimitiveType.Sphere);
                go.name = $"planet:{e.Body}";
                go.transform.localScale = Vector3.one * PlanetSize[(int)e.Body] * planetScale;
                vis = new StarVis { Tr = go.transform, Rend = go.GetComponent<Renderer>() };
                if (vis.Rend != null) vis.Rend.material.color = FactionColor[(int)e.Body];
                _planets[e.Body] = vis;
            }
            SkyMath.EquatorialToHorizontal(e.Ra, e.Dec, latitude, lst, out double alt, out double az);
            bool up = alt > 0;
            if (vis.Tr.gameObject.activeSelf != up) vis.Tr.gameObject.SetActive(up);
            if (up) vis.Tr.position = origin.position
                + SkyMath.HorizontalToWorld(alt, az) * skyRadius;
        }
    }

    // ── Stars ─────────────────────────────────────────────────────────────

    void RefreshStars(CelestialPentacleConn conn, double lst)
    {
        int inReach = 0;
        foreach (var s in conn.Conn.Db.StarNode.Iter())
        {
            // The module holds the whole naked-eye sky; only instantiate nodes
            // down to the render cap (fainter stars stay data-only).
            if (s.Magnitude > maxRenderMagnitude) continue;

            if (!_stars.TryGetValue(s.HipId, out var vis))
            {
                vis = CreateStar(s);
                _stars[s.HipId] = vis;
            }
            SkyMath.EquatorialToHorizontal(s.Ra, s.Dec, latitude, lst, out double alt, out double az);
            bool up = alt > 0;
            if (vis.Tr.gameObject.activeSelf != up) vis.Tr.gameObject.SetActive(up);
            if (!up) continue;
            vis.Tr.position = origin.position + SkyMath.HorizontalToWorld(alt, az) * skyRadius;
            // Risen past the engage altitude → full colour and strikeable; merely above
            // the horizon → dimmed (visible, but the server won't let you strike it yet).
            bool engageable = alt >= GpsService.MinEngageAltDeg;
            if (engageable) inReach++;
            Tint(vis, s.HeldBy, engageable);
        }

        InReachCount = inReach;
        if (_hud != null)
            _hud.text = inReach > 0
                ? $"✦ {inReach} star{(inReach == 1 ? "" : "s")} overhead — tap to strike"
                : "✦ no stars high enough yet — wait for one to rise";
    }

    StarVis CreateStar(StarNode s)
    {
        var go = starPrefab != null
            ? Instantiate(starPrefab)
            : GameObject.CreatePrimitive(PrimitiveType.Sphere);
        go.name = $"star:{s.Name}";
        float size = Mathf.Lerp(0.45f, 0.08f, Mathf.InverseLerp(-1.5f, 6f, s.Magnitude));
        go.transform.localScale = Vector3.one * size;
        return new StarVis { Tr = go.transform, Rend = go.GetComponent<Renderer>() };
    }

    static void Tint(StarVis vis, Planet? heldBy, bool engageable)
    {
        if (vis.Rend == null) return;
        // Only touch the material when the state actually changed.
        if (vis.TintValid && Nullable.Equals(vis.TintHeld, heldBy) && vis.TintEngageable == engageable) return;
        vis.TintHeld = heldBy;
        vis.TintEngageable = engageable;
        vis.TintValid = true;
        Color c = heldBy.HasValue ? FactionColor[(int)heldBy.Value] : Color.white;
        vis.Rend.material.color = engageable ? c : c * 0.3f;
    }

    // ── Pentacle overlay ──────────────────────────────────────────────────

    void BuildPentacle()
    {
        for (byte z = 0; z < 11; z++)
        {
            var go = new GameObject($"zone:{z}");
            go.transform.SetParent(origin, false);
            var lr = go.AddComponent<LineRenderer>();
            lr.useWorldSpace = true;
            lr.loop = true;
            lr.widthMultiplier = 0.06f;
            lr.material = zoneLineMaterial != null
                ? zoneLineMaterial
                : new Material(Shader.Find("Sprites/Default"));

            var ring = PentacleGrid.ZoneOutlineWorld(z);
            lr.positionCount = ring.Count;
            for (int i = 0; i < ring.Count; i++)
                lr.SetPosition(i, origin.position + ring[i] * skyRadius);

            _zones[z] = lr;
        }
        // Colour from current ownership.
        foreach (var zone in CelestialPentacleConn.Instance.Conn.Db.Zone.Iter()) OnZoneChanged(zone);
    }

    // ── Live callbacks (wired from CelestialPentacleConn) ─────────────────

    public void OnStarCaptured(StarNode s)
    {
        if (_stars.TryGetValue(s.HipId, out var vis)) Tint(vis, s.HeldBy, GpsService.Engageable(s.Ra, s.Dec));
    }

    public void OnZoneChanged(Zone zone)
    {
        if (_zones.TryGetValue(zone.ZoneId, out var lr))
        {
            var c = zone.Owner.HasValue ? FactionColor[(int)zone.Owner.Value] : Neutral;
            c.a = 0.85f;
            lr.startColor = lr.endColor = c;
        }
    }

    // ── Interaction ───────────────────────────────────────────────────────
    //
    // A quick tap on a star strikes it; a long press reveals what it is (and why
    // you can or can't engage it yet) without striking. Stars are world-space, so
    // this is its own press/hold/release path rather than the uGUI LongPress used
    // by cards.

    uint _pressStar;          // star under the active press (0 = none)
    float _pressStartedAt;
    bool _pressHeld;          // the long-press tooltip already fired this press
    const float HoldSeconds = 0.5f;

    void HandleTap(CelestialPentacleConn conn, double lst)
    {
        bool down = Input.GetMouseButtonDown(0)
            || (Input.touchCount > 0 && Input.GetTouch(0).phase == TouchPhase.Began);
        bool holding = Input.GetMouseButton(0)
            || (Input.touchCount > 0 && (Input.GetTouch(0).phase == TouchPhase.Stationary
                                         || Input.GetTouch(0).phase == TouchPhase.Moved));
        bool up = Input.GetMouseButtonUp(0)
            || (Input.touchCount > 0 && Input.GetTouch(0).phase == TouchPhase.Ended);

        if (down)
        {
            _pressStar = PickStar();
            _pressStartedAt = Time.unscaledTime;
            _pressHeld = false;
            return;
        }

        // Held long enough over a star → reveal it; the release then strikes nothing.
        if (holding && _pressStar != 0 && !_pressHeld && Time.unscaledTime - _pressStartedAt >= HoldSeconds)
        {
            _pressHeld = true;
            ShowStarTooltip(conn, _pressStar, lst);
            return;
        }

        if (up)
        {
            uint star = _pressStar;
            bool wasHeld = _pressHeld;
            _pressStar = 0; _pressHeld = false;
            if (star == 0 || wasHeld) return; // empty tap, or a long-press already handled

            // Short tap → open the battle overlay (or fall back to an all-active strike).
            var node = conn.Conn.Db.StarNode.HipId.Find(star);
            if (node != null && BattlePanel.Instance != null) BattlePanel.Instance.OpenFor(node);
            else conn.AttackStar(star, ActiveDeckCardIds(conn));
        }
    }

    /// The star the screen-point ray passes closest to (0 if none within tolerance).
    uint PickStar()
    {
        if (Camera.main == null) return 0;
        Vector2 sp = Input.touchCount > 0 ? Input.GetTouch(0).position : (Vector2)Input.mousePosition;
        Ray ray = Camera.main.ScreenPointToRay(sp);
        uint best = 0; float bestDot = 0.985f;
        foreach (var kv in _stars)
        {
            var tr = kv.Value.Tr;
            if (!tr.gameObject.activeSelf) continue;
            float d = Vector3.Dot(ray.direction, (tr.position - ray.origin).normalized);
            if (d > bestDot) { bestDot = d; best = kv.Key; }
        }
        return best;
    }

    void ShowStarTooltip(CelestialPentacleConn conn, uint hipId, double lst)
    {
        var s = conn.Conn.Db.StarNode.HipId.Find(hipId);
        if (s == null) return;
        SkyMath.EquatorialToHorizontal(s.Ra, s.Dec, latitude, lst, out double alt, out _);
        string held = s.HeldBy.HasValue ? $"Held by {FactionData.Names[(int)s.HeldBy.Value]}." : "Unclaimed.";
        string reach = alt >= GpsService.MinEngageAltDeg
            ? "Risen and strikeable now."
            : alt > 0
                ? $"Only {alt:F0}° up — it must clear {GpsService.MinEngageAltDeg:F0}° before you can strike."
                : "Below your horizon — out of reach.";
        string bright = s.Magnitude <= 1.5f
            ? "A bright star: it resists hard but pulls its zone far when taken."
            : "A fainter star: an easier capture.";
        Tooltip.Show(s.Name, $"{held} {reach} {bright} {OracleLore.Tip("engage")}");
    }

    // Loadout lives on deck_slot (not card) in the Rust schema.
    static List<ulong> ActiveDeckCardIds(CelestialPentacleConn conn)
    {
        var ids = new List<ulong>();
        var me = conn.LocalIdentity;
        foreach (var s in conn.Conn.Db.DeckSlot.Iter())
            if (s.Owner.Equals(me) && s.Loadout == Loadout.Active) ids.Add(s.CardId);
        return ids;
    }
}
