// Pentacles — client-side strike-power preview.
//
// Mirrors server combat.rs so the battle panel can show an honest estimate
// before you commit. The server is authoritative — this is feedback only.
//
// Combat is environmental: the suits don't counter each other. The sky's
// currently-rising sign favors its element's suit (×1.35), suppresses the
// opposite element (×0.75), and leaves the perpendicular pair at ×1.0. Which
// suit is favored sweeps the zodiac in real time — read it from the live
// ascendant the server stores in game_config.season_degree.
//
// Suit codes: 0 Cups · 1 Swords · 2 Pentacles · 3 Wands.

using System.Collections.Generic;
using SpacetimeDB.Types;

public static class CombatPreview
{
    // Element of a sign (0 Aries..11 Pisces) → favored suit code. Mirrors server
    // chart::sign_element: Fire→Wands, Earth→Pentacles, Air→Swords, Water→Cups.
    public static int FavoredSuit(int sign)
    {
        switch (((sign % 4) + 4) % 4)
        {
            case 0: return 3;  // Fire  → Wands
            case 1: return 2;  // Earth → Pentacles
            case 2: return 1;  // Air   → Swords
            default: return 0; // Water → Cups
        }
    }

    /// Favored suit for the live sky, from game_config.season_degree (the world
    /// ascendant the server advances each tick). Falls back to 0° (Aries) if absent.
    public static int FavoredSuitNow(CelestialPentacleConn conn)
    {
        var cfg = conn?.Conn?.Db.GameConfig.Id.Find((byte)0);
        int deg = cfg != null ? cfg.SeasonDegree : 0;
        return FavoredSuit((deg / 30) % 12);
    }

    // Elemental opposite: Wands↔Cups (Fire↔Water), Swords↔Pentacles (Air↔Earth).
    static int Opposite(int suit) => suit switch
    {
        3 => 0, 0 => 3,
        1 => 2, 2 => 1,
        _ => suit,
    };

    /// The rising sign's element favors its suit (×1.35), suppresses the opposite
    /// (×0.75); the perpendicular pair is unaffected. Matches combat::element_weather.
    public static float ElementWeather(int suit, int favored)
    {
        if (suit == favored) return 1.35f;
        if (suit == Opposite(favored)) return 0.75f;
        return 1f;
    }

    static float Strength(Card c) => c.Attack + c.Health * 0.5f + c.Armour * 0.4f;

    /// Estimated strike power under the current sky weather.
    public static int StrikePower(List<Card> cards, int favoredSuit)
    {
        float p = 0;
        foreach (var c in cards) p += Strength(c) * ElementWeather((int)c.Suit, favoredSuit);
        return (int)p;
    }

    // ── Display ───────────────────────────────────────────────────────────

    static readonly string[] SignGlyphs =
        { "♈", "♉", "♊", "♋", "♌", "♍", "♎", "♏", "♐", "♑", "♒", "♓" };
    static readonly string[] SignNames =
        { "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
          "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces" };
    static readonly string[] ElementByMod4 = { "Fire", "Earth", "Air", "Water" };
    static readonly string[] SuitNames = { "Cups", "Swords", "Pentacles", "Wands" };

    /// e.g. "♉ Taurus — Earth favors Pentacles", describing the live round.
    public static string SkyWeather(CelestialPentacleConn conn)
    {
        var cfg = conn?.Conn?.Db.GameConfig.Id.Find((byte)0);
        int deg = cfg != null ? cfg.SeasonDegree : 0;
        int sign = (deg / 30) % 12;
        return $"{SignGlyphs[sign]} {SignNames[sign]} — {ElementByMod4[sign % 4]} favors {SuitNames[FavoredSuit(sign)]}";
    }
}
