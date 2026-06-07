// Pentacles — onboarding flow logic (UI-agnostic).
//
// Birth input ──► ChartCalculator.Build ──► TopFactions (3 choices) ──► CreatePlayer.
// Raises events the UI subscribes to; the server re-validates the faction pick.

using System;
using SpacetimeDB;
using SpacetimeDB.Types;
using UnityEngine;

public class OnboardingController
{
    public struct BirthInput
    {
        public string handle;
        public int year, month, day, hour, minute;
        public bool timeKnown;
        public double lat, lon, utcOffsetHours;
    }

    /// (chart, top-3 faction indices) — show these as the player's choice.
    public event Action<NatalChart, int[]> FactionsReady;
    public event Action PlayerCreated;
    public event Action<string> Error;

    NatalChart _chart;
    string _handle;
    bool _watching;

    /// Step 1 — compute the chart and surface the three faction choices.
    public void Submit(BirthInput b)
    {
        try
        {
            // Treat the entered wall-clock as UTC, then apply the birth-place offset.
            int h = b.timeKnown ? b.hour : 12;
            int mi = b.timeKnown ? b.minute : 0;
            var local = new DateTime(b.year, b.month, b.day, h, mi, 0, DateTimeKind.Utc);
            var utc = local.AddHours(-b.utcOffsetHours);

            _chart = ChartCalculator.Build(utc, b.lat, b.lon, b.timeKnown);
            _handle = string.IsNullOrWhiteSpace(b.handle) ? "Seeker" : b.handle.Trim();
            FactionsReady?.Invoke(_chart, ChartCalculator.TopFactions(_chart));
        }
        catch (Exception e)
        {
            Error?.Invoke($"Couldn't read that birth data: {e.Message}");
        }
    }

    /// Step 2 — commit the chosen faction. Confirms when the player row lands.
    public void ChooseFaction(int factionIdx)
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected)
        {
            Error?.Invoke("Not connected to SpacetimeDB yet.");
            return;
        }
        if (!_watching)
        {
            conn.Conn.Db.Player.OnInsert += OnPlayerInserted;
            conn.Conn.Db.Player.OnUpdate += OnPlayerUpdated;
            _watching = true;
        }
        conn.CreatePlayer(_handle, _chart, (Planet)factionIdx);
    }

    void OnPlayerInserted(EventContext ctx, Player p) => CompleteIfMine(p);

    void OnPlayerUpdated(EventContext ctx, Player oldP, Player newP) => CompleteIfMine(newP);

    void CompleteIfMine(Player p)
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !p.Identity.Equals(conn.LocalIdentity)) return;
        conn.Conn.Db.Player.OnInsert -= OnPlayerInserted;
        conn.Conn.Db.Player.OnUpdate -= OnPlayerUpdated;
        _watching = false;
        PlayerCreated?.Invoke();
    }

    public NatalChart Chart => _chart;
}
