// Pentacles — faction display data (GDD §03). Pure data, no scene deps.

using UnityEngine;

public static class FactionData
{
    public static readonly string[] Names =
    {
        "Sun", "Moon", "Mercury", "Venus", "Mars",
        "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto",
    };

    public static readonly string[] Glyphs =
    { "☉", "☽", "☿", "♀", "♂", "♃", "♄", "♅", "♆", "♇" };

    public static readonly string[] Roles =
    {
        "Sovereignty · Wands", "Tides · Cups", "Cunning · Swords", "Harmony · Cups",
        "War · Wands", "Expansion · Wands", "Dominion · Pentacles", "Disruption · Swords",
        "Illusion · Cups", "Transformation · Swords",
    };

    public static readonly string[] Doctrines =
    {
        "Solar pressure. Wands-biased cards thrive when fire weather opens.",
        "Lunar tide. Cups-biased cards reward patient weather and seal timing.",
        "Quicksilver timing. Swords-biased cards excel when air signs rise.",
        "Harmonic growth. Cups-biased cards turn water weather into staying power.",
        "Raw damage. Highest base attack, weak on defense — built to siege.",
        "Snowball. Each held zone buffs adjacent contests.",
        "The wall. Strongest defense; captured Saturn zones are hardest to retake.",
        "Disruptive angle. Swords-biased cards punish openings in air weather.",
        "Veiled patience. Cups-biased cards hold value through shifting seals.",
        "Deep pressure. Swords-biased cards scale through levels, seals, and transit.",
    };

    public static readonly Color[] Colors =
    {
        new(1.00f, 0.78f, 0.36f), new(0.85f, 0.86f, 0.92f), new(0.66f, 0.71f, 0.83f),
        new(0.87f, 0.62f, 0.74f), new(0.84f, 0.32f, 0.32f), new(0.85f, 0.65f, 0.36f),
        new(0.62f, 0.60f, 0.52f), new(0.40f, 0.74f, 0.80f), new(0.40f, 0.46f, 0.82f),
        new(0.56f, 0.44f, 0.66f),
    };
}
