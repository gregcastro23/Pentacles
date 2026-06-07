// Pentacles — a single Tarot card widget (programmatic uGUI).

using System;
using UnityEngine;
using UnityEngine.UI;
using SpacetimeDB.Types;

public class CardView : MonoBehaviour
{
    public ulong CardId;
    public bool Selected { get; private set; }

    Image _bg;
    Action<ulong> _onClick;

    static readonly string[] SuitGlyph = { "♥", "♠", "♦", "♣" };          // Cups, Swords, Pentacles, Wands
    static readonly string[] SuitName = { "Cups", "Swords", "Pentacles", "Wands" };
    static readonly Color[] SuitColor =
    {
        new(0.37f, 0.58f, 0.85f), new(0.68f, 0.73f, 0.84f),
        new(0.45f, 0.67f, 0.42f), new(0.86f, 0.48f, 0.28f),
    };

    /// Plain card (no loadout chip) — used by the duel hand, which is Active-only.
    public static CardView Build(Transform parent, Card c, Action<ulong> onClick) =>
        Build(parent, c, Loadout.Active, onClick, null);

    /// Full card. When `onLoadout` is non-null a loadout chip is shown — tapping it
    /// cycles the card's loadout (Active → Defense → Bench).
    public static CardView Build(Transform parent, Card c, Loadout loadout,
        Action<ulong> onClick, Action<ulong> onLoadout)
    {
        var go = new GameObject($"card:{c.CardId}",
            typeof(RectTransform), typeof(Image), typeof(Button), typeof(LayoutElement),
            typeof(VerticalLayoutGroup), typeof(CanvasGroup));
        go.transform.SetParent(parent, false);

        var view = go.AddComponent<CardView>();
        view.CardId = c.CardId;
        view._onClick = onClick;
        view._bg = go.GetComponent<Image>();

        var le = go.GetComponent<LayoutElement>();
        le.minWidth = le.preferredWidth = 120;
        le.minHeight = le.preferredHeight = 172;

        var vlg = go.GetComponent<VerticalLayoutGroup>();
        vlg.padding = new RectOffset(8, 8, 8, 8); vlg.spacing = 1;
        vlg.childAlignment = TextAnchor.UpperCenter;
        vlg.childControlWidth = vlg.childForceExpandWidth = true;

        int suit = (int)c.Suit;
        var sc = SuitColor[suit];
        UIKit.Label(go.transform, SuitGlyph[suit], 30, FontStyle.Bold, sc);
        // Trumps show their Major-Arcana name (rank holds the arcana index); pips/courts
        // show their rank name.
        string rankLabel = c.IsTrump ? CombatPreview.MajorName(c.Rank) : RankName(c.Rank);
        UIKit.Label(go.transform, rankLabel + (c.IsTrump ? "  ✦" : ""), c.IsTrump ? 12 : 14, FontStyle.Bold,
            c.IsTrump ? new Color(0.95f, 0.86f, 0.63f) : Color.white);
        UIKit.Label(go.transform, SuitName[suit] + (c.Inverted ? " (rev)" : ""), 10, FontStyle.Italic, sc);
        UIKit.Label(go.transform, $"ATK {c.Attack}   HP {c.Health}\nARM {c.Armour}", 11, FontStyle.Normal);
        // A leveled card (fused from copies) shows its tier; the level scales its
        // power in every siege & duel. Binding `c.Level` appears after generate.
        if (c.Level > 1)
            UIKit.Label(go.transform, $"✦ Lv {c.Level}", 11, FontStyle.Bold, new Color(0.95f, 0.86f, 0.63f));

        if (onLoadout != null)
        {
            var lb = UIKit.Button(go.transform, LoadoutLabel(loadout),
                () => onLoadout.Invoke(c.CardId), 10, LoadoutTint(loadout));
            var lle = lb.GetComponent<LayoutElement>();
            lle.minHeight = lle.preferredHeight = 26;
        }

        // Bench cards read as dimmed; Active/Defense at full strength.
        go.GetComponent<CanvasGroup>().alpha = loadout == Loadout.Bench ? 0.55f : 1f;

        go.GetComponent<Button>().onClick.AddListener(() => view._onClick?.Invoke(view.CardId));
        view.SetSelected(false);
        return view;
    }

    static string LoadoutLabel(Loadout l) => l switch
    {
        Loadout.Active => "Active", Loadout.Defense => "Defense", _ => "Bench",
    };

    static Color LoadoutTint(Loadout l) => l switch
    {
        Loadout.Active => new Color(0.85f, 0.71f, 0.42f, 0.30f),  // gold
        Loadout.Defense => new Color(0.40f, 0.60f, 0.82f, 0.30f), // blue
        _ => new Color(0.45f, 0.45f, 0.50f, 0.25f),               // gray (Bench)
    };

    public void SetSelected(bool s)
    {
        Selected = s;
        if (_bg != null)
            _bg.color = s ? new Color(0.18f, 0.15f, 0.07f, 0.98f) : new Color(0.06f, 0.07f, 0.11f, 0.95f);
        transform.localScale = s ? Vector3.one * 1.06f : Vector3.one;
    }

    static string RankName(byte r) => r switch
    {
        1 => "Ace", 11 => "Page", 12 => "Knight", 13 => "Queen", 14 => "King", _ => r.ToString(),
    };
}
