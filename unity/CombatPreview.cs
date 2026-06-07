// Pentacles — client-side strike-power preview.
//
// Mirrors server combat.rs so the battle panel can show an honest estimate
// before you commit. The server is authoritative — this is feedback only.
// Suit codes: 0 Cups · 1 Swords · 2 Pentacles · 3 Wands.

using System.Collections.Generic;
using SpacetimeDB.Types;

public static class CombatPreview
{
    /// Wands→Swords→Pentacles→Wands advantage ×1.5, reverse ×0.66; Cups neutral.
    public static float SuitMultiplier(int att, int def)
    {
        if ((att == 3 && def == 1) || (att == 1 && def == 2) || (att == 2 && def == 3)) return 1.5f;
        if ((att == 1 && def == 3) || (att == 2 && def == 1) || (att == 3 && def == 2)) return 0.66f;
        return 1f;
    }

    static float Strength(Card c) => c.Attack + c.Health * 0.5f + c.Armour * 0.4f;

    /// Estimated strike power against a star's holder (or neutral if uncontrolled).
    public static int StrikePower(List<Card> cards, Planet? holder)
    {
        int defSuit = holder.HasValue ? BiasedSuit((int)holder.Value) : 0; // vs holder's suit
        float p = 0;
        foreach (var c in cards) p += Strength(c) * SuitMultiplier((int)c.Suit, defSuit);
        return (int)p;
    }

    // Matches server Planet::biased_suit (Sun..Pluto → suit code).
    static int BiasedSuit(int planet) => new[] { 3, 0, 1, 0, 3, 3, 2, 1, 0, 1 }[planet];
}
