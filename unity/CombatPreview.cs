// Pentacles — client-side strike-power preview.
//
// Mirrors server combat.rs so the battle panel can show an honest estimate
// before you commit. The server is authoritative — this is feedback only.
//
// Combat is environmental: the suits don't counter each other. The sky's
// currently-rising sign favors its element's suit (×1.35), suppresses the
// opposite element (×0.75), and leaves the perpendicular pair at ×1.0. Which
// suit is favored sweeps the zodiac in real time — read it from the live
// ascendant the server stores in game_config.ascendant_degree.
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

    /// Favored suit for the live sky, from game_config.ascendant_degree (the world
    /// ascendant the server advances each tick). Falls back to 0° (Aries) if absent.
    public static int FavoredSuitNow(CelestialPentacleConn conn)
    {
        var cfg = conn?.Conn?.Db.GameConfig.Id.Find((byte)0);
        int deg = cfg != null ? cfg.AscendantDegree : 0;
        return FavoredSuit((deg / 30) % 12);
    }

    /// The sign currently in a zone: the 12 signs rotate through the 11 zones based on local sidereal time.
    public static int ZoneSign(CelestialPentacleConn conn, int zoneId)
    {
        double jd = SkyMath.JulianDay(System.DateTime.UtcNow);
        double gmst = SkyMath.GmstDeg(jd);
        double ha = (zoneId + 0.5) * (360.0 / 11.0);
        double zodiacLon = SkyMath.Norm360(gmst - ha);
        return (int)(zodiacLon / 30.0) % 12;
    }

    /// Favored suit in a given zone right now (mirrors server zone_favored_suit).
    public static int FavoredSuitForZone(CelestialPentacleConn conn, int zoneId) =>
        FavoredSuit(ZoneSign(conn, zoneId));

    /// Descriptors of the dynamic weather sign for a specific zone.
    public static string SkyWeatherForZone(CelestialPentacleConn conn, int zoneId)
    {
        int sign = ZoneSign(conn, zoneId);
        return $"{SignGlyphs[sign]} {SignNames[sign]} — {ElementByMod4[sign % 4]} favors {SuitNames[FavoredSuit(sign)]}";
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

    // A card whose suit's element its faction currently masters (it holds a zone
    // sitting in that sign) fights at this bonus. Mirrors combat::SEAL_BONUS.
    public const float SealBonus = 1.15f;

    /// Suit codes a faction currently holds a zodiac seal in — the elements of the
    /// signs sitting in the zones it owns right now. Mirrors server sealed_suits.
    public static HashSet<int> SealedSuits(CelestialPentacleConn conn, Planet faction)
    {
        var suits = new HashSet<int>();
        if (conn?.Conn == null) return suits;
        foreach (var z in conn.Conn.Db.Zone.Iter())
            if (z.Owner.HasValue && z.Owner.Value == faction)
                suits.Add(FavoredSuit(ZoneSign(conn, z.ZoneId)));
        return suits;
    }

    /// Estimated strike power under the current sky weather.
    public static int StrikePower(List<Card> cards, int favoredSuit) =>
        StrikePower(cards, favoredSuit, null);

    /// Estimated strike power under the sky weather and the attacker's element seals.
    public static int StrikePower(List<Card> cards, int favoredSuit, HashSet<int> sealedSuits)
    {
        float p = 0;
        foreach (var c in cards)
        {
            float seal = sealedSuits != null && sealedSuits.Contains((int)c.Suit) ? SealBonus : 1f;
            p += Strength(c) * ElementWeather((int)c.Suit, favoredSuit) * seal;
        }
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

    /// e.g. "♉ Taurus — Earth favors Pentacles", describing a zone's live weather.
    public static string SkyWeather(CelestialPentacleConn conn, int zoneId)
    {
        int sign = ZoneSign(conn, zoneId);
        return $"{SignGlyphs[sign]} {SignNames[sign]} — {ElementByMod4[sign % 4]} favors {SuitNames[FavoredSuit(sign)]}";
    }

    // Major-Arcana names by arcana index (0..21). A trump card stores its index
    // in Card.rank (disambiguated by Card.is_trump).
    static readonly string[] MajorNames =
    {
        "The Fool", "The Magician", "The High Priestess", "The Empress", "The Emperor",
        "The Hierophant", "The Lovers", "The Chariot", "Strength", "The Hermit",
        "Wheel of Fortune", "Justice", "The Hanged Man", "Death", "Temperance",
        "The Devil", "The Tower", "The Star", "The Moon", "The Sun", "Judgement", "The World",
    };

    /// Display name for a trump card (its rank is the Major-Arcana index).
    public static string MajorName(int arcanaIndex) =>
        arcanaIndex >= 0 && arcanaIndex < MajorNames.Length ? MajorNames[arcanaIndex] : "Trump";
}
