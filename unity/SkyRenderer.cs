// Pentacles — AR sky renderer (roadmap P0).
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

    readonly Dictionary<uint, Transform> _stars = new();
    readonly Dictionary<byte, LineRenderer> _zones = new();
    bool _gridBuilt;

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
        HandleTap(conn, lst);
    }

    // ── Stars ─────────────────────────────────────────────────────────────

    void RefreshStars(CelestialPentacleConn conn, double lst)
    {
        int inReach = 0;
        foreach (var s in conn.Conn.Db.StarNode.Iter())
        {
            if (!_stars.TryGetValue(s.HipId, out var tr))
            {
                tr = CreateStar(s);
                _stars[s.HipId] = tr;
            }
            SkyMath.EquatorialToHorizontal(s.Ra, s.Dec, latitude, lst, out double alt, out double az);
            bool up = alt > 0;
            tr.gameObject.SetActive(up);
            if (up) tr.position = origin.position + SkyMath.HorizontalToWorld(alt, az) * skyRadius;
            // Risen past the engage altitude → full colour and strikeable; merely above
            // the horizon → dimmed (visible, but the server won't let you strike it yet).
            bool engageable = up && alt >= GpsService.MinEngageAltDeg;
            if (engageable) inReach++;
            Tint(tr, s.HeldBy, engageable);
        }

        InReachCount = inReach;
        if (_hud != null)
            _hud.text = inReach > 0
                ? $"✦ {inReach} star{(inReach == 1 ? "" : "s")} overhead — tap to strike"
                : "✦ no stars high enough yet — wait for one to rise";
    }

    Transform CreateStar(StarNode s)
    {
        var go = starPrefab != null
            ? Instantiate(starPrefab)
            : GameObject.CreatePrimitive(PrimitiveType.Sphere);
        go.name = $"star:{s.Name}";
        float size = Mathf.Lerp(0.45f, 0.12f, Mathf.InverseLerp(-1.5f, 4f, s.Magnitude));
        go.transform.localScale = Vector3.one * size;
        return go.transform;
    }

    void Tint(Transform tr, Planet? heldBy, bool engageable)
    {
        var rend = tr.GetComponent<Renderer>();
        if (rend == null) return;
        Color c = heldBy.HasValue ? FactionColor[(int)heldBy.Value] : Color.white;
        rend.material.color = engageable ? c : c * 0.3f;
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
        if (_stars.TryGetValue(s.HipId, out var tr)) Tint(tr, s.HeldBy, GpsService.Engageable(s.Ra, s.Dec));
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

    void HandleTap(CelestialPentacleConn conn, double lst)
    {
        bool tapped = Input.GetMouseButtonDown(0)
            || (Input.touchCount > 0 && Input.GetTouch(0).phase == TouchPhase.Began);
        if (!tapped) return;

        Vector2 sp = Input.touchCount > 0 ? Input.GetTouch(0).position : (Vector2)Input.mousePosition;
        Ray ray = Camera.main.ScreenPointToRay(sp);

        uint best = 0; float bestDot = 0.985f; bool found = false;
        foreach (var kv in _stars)
        {
            if (!kv.Value.gameObject.activeSelf) continue;
            float d = Vector3.Dot(ray.direction, (kv.Value.position - ray.origin).normalized);
            if (d > bestDot) { bestDot = d; best = kv.Key; found = true; }
        }
        if (!found) return;

        // Open the battle overlay so the player picks their strike; fall back to
        // an immediate all-active attack if the overlay isn't in the scene.
        var star = conn.Conn.Db.StarNode.HipId.Find(best);
        if (star != null && BattlePanel.Instance != null) BattlePanel.Instance.OpenFor(star);
        else conn.AttackStar(best, ActiveDeckCardIds(conn));
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
