// Pentacles — the Oracle's authored knowledge.
//
// Two bodies of in-world text, both client-side and free (no service):
//   • Codex — the "Book of the Sky", ordered chapters the OraclePanel browses.
//   • Concept — short blurbs keyed by id, shown as long-press tooltips with an
//     "ask the Oracle" escalation to live chat.
// Keep the voice consistent: a wry, encouraging astrologer-oracle.

using System.Collections.Generic;

public static class OracleLore
{
    public struct Entry
    {
        public string Title;
        public string Body;
        public Entry(string title, string body) { Title = title; Body = body; }
    }

    /// The Book of the Sky — read top to bottom, it teaches the whole game.
    public static readonly Entry[] Codex =
    {
        new("The Wheel & the Weather",
            "The sky is the field of play. The sign rising over the world sweeps the zodiac in real time, and each zone carries its own sign a step further round the wheel. That sign's element favors one suit (×1.35) and suppresses its opposite (×0.75). Read a zone's weather before you strike — the same cards win or lose by where and when you play them."),

        new("The Four Suits",
            "Cups are Water, Swords are Air, Pentacles are Earth, Wands are Fire. The suits do not counter one another — there is no rock-paper-scissors here. Their strength is environmental: the rising element lifts its suit wherever the contest falls. Fire and Water oppose; Air and Earth oppose."),

        new("Reading a Card",
            "Every card was minted from a moment in the sky. Pips (2–10) come from the decans of a sign; courts (Page→King) are bodies dignified enough to be elevated; an Ace is your chart ruler. Trumps are the planetary Majors, a tier above the pips. A card's attack, health and armour come from the birth degree, minute and dignity that bore it; 'reversed' marks a retrograde origin."),

        new("Eleven Zones",
            "The Pentacle holds eleven zones: five Houses, five Spires, and the Crown. Each is a tug-of-war: winning battles there pushes a single control meter toward you, and when it crosses the threshold the zone flips to your faction. Hold a zone and it slowly decays unless you defend it."),

        new("Zodiac Seals",
            "Hold a zone while a sign sits in it and you master that sign's element — a zodiac seal. Your cards of that suit then fight a notch harder (×1.15) everywhere, in every siege and duel, for as long as you hold the seal. As the wheel turns, the sign in a zone changes, so seals shift beneath you."),

        new("Stars & Sieges",
            "Stars are the prizes. A star must be risen — past ten degrees of altitude over your real horizon — before you can engage it. Strike with your Active cards; a brighter star resists harder but pulls its zone further when taken. Defenders are the holding faction's Defense cards, or a neutral garrison."),

        new("Cards of the Moment",
            "No two cards are truly alike. Your starting deck is minted from your own natal chart; thereafter, every capture mints a fresh card from the live sky at that very instant — its source the most dignified planet then aloft, its finest detail drawn from the second of its birth. A four of Wands won under a strong Mars is not the four your neighbor holds."),

        new("Fusing & Leveling",
            "Two copies of the same card may be fused. The stronger keeps its identity and levels up; the other is spent. The gain is generous at first and then plateaus — there is a ceiling, so a leveled card is mightier but never runs away with the game. Fuse where it counts."),

        new("Trading",
            "Cards pass between players by confirmed two-way trade. Stake what you offer, name what you want, and propose; nothing moves until both of you confirm. The sky keeps everyone honest — ownership is re-checked at the moment of the swap."),

        new("The Oracle",
            "I am the Oracle — your astrologer at the edge of the board. I read the same sky you do, and I will tell you where it leans: which zone to take, what slips from your grasp, when the weather turns to your suit. Ask me of the rules or of your next move. I advise; the casting is always yours."),
    };

    /// Short blurbs for long-press tooltips. Keep each to a sentence or two.
    public static readonly Dictionary<string, string> Concept = new()
    {
        ["suit"] = "Suits are elemental: Cups/Water, Swords/Air, Pentacles/Earth, Wands/Fire. They don't counter each other — the rising sky decides which is strong.",
        ["weather"] = "A zone's weather is the element of the sign sitting in it now. It lifts that suit ×1.35 and suppresses the opposite ×0.75. It rotates as the wheel turns.",
        ["decan"] = "Each sign splits into three decans (0–9°, 10–19°, 20–29°). A pip card's rank comes from the decan of the degree that minted it.",
        ["dignity"] = "Dignity is how at-home a planet is in its sign — rulership down to fall. It elevates a card's rank and sharpens its stats.",
        ["seal"] = "Hold a zone while a sign sits in it and you seal that element: your cards of its suit fight ×1.15 everywhere, until the wheel moves the sign on.",
        ["control"] = "Each zone is one tug-of-war meter. Win battles to push it your way; cross the threshold and the zone flips to you. Held zones slowly decay.",
        ["trump"] = "Trumps are the planetary Major Arcana — a tier above the pips, suited by their planet and bound to the weather.",
        ["level"] = "Fusing copies of a card levels it up. The bonus is big at first, then plateaus to a ceiling — strong, never runaway.",
        ["mint"] = "Every card carries the moment it was born — your chart for the starters, the live sky for those won in battle. It's what makes each one unique.",
        ["engage"] = "A star must be risen past 10° over your real horizon before you can strike it. Below that it's out of reach — wait for it to climb.",
        ["zone"] = "Eleven zones: five Houses, five Spires, the Crown. Each carries its own sign and its own tug-of-war.",
        ["oracle"] = "That's me. I read the live sky and your chart to advise your next move — tap to ask, or open the Book of the Sky.",
    };

    public static string Tip(string key) => Concept.TryGetValue(key, out var v) ? v : null;
}
