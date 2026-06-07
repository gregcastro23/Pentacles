// Pentacles — the Oracle's heuristic brain (client-side, no LLM).
//
// Pure reads over the live public tables + your local chart produce tactical
// advice in the in-world astrologer voice: which zone to turn to, what's slipping,
// what's ripe. The Claude companion service (Phase C) handles only open chat and
// teaching — everything here is instant, offline, and free.

using System.Collections.Generic;
using SpacetimeDB.Types;

public static class OracleAdvisor
{
    // Suit codes: 0 Cups · 1 Swords · 2 Pentacles · 3 Wands.
    public static readonly string[] SuitName = { "Cups", "Swords", "Pentacles", "Wands" };
    public static readonly string[] ElementBySuit = { "Water", "Air", "Earth", "Fire" };

    /// A held zone at or below this control is read as "slipping".
    public const int RiskBand = 200;

    public static Planet? MyFaction(CelestialPentacleConn conn) =>
        conn?.Conn?.Db.Player.Identity.Find(conn.LocalIdentity)?.Faction;

    /// Suit counts [Cups, Swords, Pentacles, Wands] across the player's whole deck.
    public static int[] DeckSuits(CelestialPentacleConn conn)
    {
        var counts = new int[4];
        if (conn?.Conn == null) return counts;
        var me = conn.LocalIdentity;
        foreach (var s in conn.Conn.Db.DeckSlot.Iter())
        {
            if (!s.Owner.Equals(me)) continue;
            var c = conn.Conn.Db.Card.CardId.Find(s.CardId);
            if (c != null) counts[(int)c.Suit]++;
        }
        return counts;
    }

    /// The suit the deck leans on (ties resolve to the lowest code).
    public static int DominantSuit(CelestialPentacleConn conn)
    {
        var s = DeckSuits(conn);
        int best = 0;
        for (int i = 1; i < 4; i++) if (s[i] > s[best]) best = i;
        return best;
    }

    /// Friendly name for a zone: 5 Houses, 5 Spires, 1 Crown (matches the GDD).
    public static string ZoneLabel(byte zoneId)
    {
        if (zoneId == 10) return "the Crown";
        if (zoneId >= 5) return $"Spire {zoneId - 4}";
        return $"House {zoneId + 1}";
    }

    /// Is there a star in this zone the player could strike right now — not already
    /// theirs and currently risen past the engage altitude?
    public static bool ReachableTargetInZone(CelestialPentacleConn conn, byte zoneId, Planet fac)
    {
        if (conn?.Conn == null) return false;
        foreach (var s in conn.Conn.Db.StarNode.Iter())
            if (s.RegionHint == zoneId
                && !(s.HeldBy.HasValue && s.HeldBy.Value == fac)
                && GpsService.Engageable(s.Ra, s.Dec))
                return true;
        return false;
    }

    // ── On-demand tip ────────────────────────────────────────────────────────

    /// The single best thing to do now, in the oracle's voice. Defense first, then
    /// a favorable takeable zone, then encouragement.
    public static string BestTip(CelestialPentacleConn conn)
    {
        var fac = MyFaction(conn);
        if (conn?.Conn == null || fac == null)
            return "✦ The sky is still forming. Cast your chart, seeker, and I will read it for you.";

        int dom = DominantSuit(conn);
        var seals = CombatPreview.SealedSuits(conn, fac.Value);

        // 1) Defense — the most-slipping held zone.
        Zone risk = null;
        foreach (var z in conn.Conn.Db.Zone.Iter())
            if (z.Owner.HasValue && z.Owner.Value == fac.Value && z.Control <= RiskBand
                && (risk == null || z.Control < risk.Control))
                risk = z;
        if (risk != null)
            return LosingTip(risk.ZoneId, risk.Control);

        // 2) Offense — the most favorable takeable zone.
        Zone best = null; int bestScore = int.MinValue;
        foreach (var z in conn.Conn.Db.Zone.Iter())
        {
            if (z.Owner.HasValue && z.Owner.Value == fac.Value) continue; // already mine
            int favored = CombatPreview.FavoredSuitForZone(conn, z.ZoneId);
            int score = 0;
            if (favored == dom) score += 3;
            if (seals.Contains(favored)) score += 2;
            if (ReachableTargetInZone(conn, z.ZoneId, fac.Value)) score += 2;
            if (!z.Owner.HasValue) score += 1; // neutral is easier than enemy-held
            if (score > bestScore) { bestScore = score; best = z; }
        }
        if (best != null && bestScore > 0)
        {
            int favored = CombatPreview.FavoredSuitForZone(conn, best.ZoneId);
            string why = favored == dom
                ? $"its sky favors your {SuitName[dom]}"
                : "the moment leans your way";
            string tgt = ReachableTargetInZone(conn, best.ZoneId, fac.Value)
                ? " A star stands risen and ready."
                : " No star is high enough there yet — bide until one rises.";
            return $"✦ Turn to {ZoneLabel(best.ZoneId)} — {why}.{tgt}";
        }

        // 3) Encouragement / teaching hook.
        return $"✦ The wheel still turns. Watch for {ElementBySuit[dom]} skies — they lift your {SuitName[dom]}. Long-press any card, zone, or star to ask me of it.";
    }

    // ── Nudge phrasings (used by Oracle.cs on a state change) ─────────────────

    public static string WeatherTip(byte zoneId, int suit) =>
        $"✦ {ElementBySuit[suit]} skies gather over {ZoneLabel(zoneId)} — your {SuitName[suit]} are favored there now. Strike while it holds.";

    public static string LosingTip(byte zoneId, int control) =>
        $"✦ Your grip on {ZoneLabel(zoneId)} loosens (control {control}). Rally there, or the wheel hands it away.";

    public static string TransitTip(int bodyIdx, byte zoneId, int suit) =>
        $"✦ {FactionData.Names[bodyIdx]} crosses into {ZoneLabel(zoneId)}; the sky there turns to your {SuitName[suit]}. An opening.";

    public static string TargetTip(string starName, byte zoneId) =>
        $"✦ {starName} rises over {ZoneLabel(zoneId)}, ripe and within reach. Take it before it sets.";
}
