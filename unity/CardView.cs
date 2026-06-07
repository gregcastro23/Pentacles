// Pentacles — a single Tarot card widget (programmatic uGUI).

using System;
using UnityEngine;
using UnityEngine.UI;
using SpacetimeDB.Types;

public class CardView : MonoBehaviour
{
    public ulong CardId;
    public bool Selected { get; private set; }

    Image _bg;             // The inner background image
    Image _border;         // The outer container image serving as the border
    bool _isTrump;
    Color _suitColor;
    Action<ulong> _onClick;
    float _suppressClickUntil;

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
        // Outer container serves as the card border
        var go = new GameObject($"card:{c.CardId}",
            typeof(RectTransform), typeof(Image), typeof(Button), typeof(LayoutElement),
            typeof(CanvasGroup));
        go.transform.SetParent(parent, false);

        var view = go.AddComponent<CardView>();
        view.CardId = c.CardId;
        view._onClick = onClick;
        view._border = go.GetComponent<Image>();
        view._isTrump = c.IsTrump;

        int suit = (int)c.Suit;
        view._suitColor = SuitColor[suit];

        var le = go.GetComponent<LayoutElement>();
        le.minWidth = le.preferredWidth = 120;
        le.minHeight = le.preferredHeight = 184; // Slightly taller for better spacing

        // Inner container for the actual card content
        var innerGo = new GameObject("Inner", typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup));
        innerGo.transform.SetParent(go.transform, false);
        UIKit.Stretch(innerGo, 2f); // 2px border width

        view._bg = innerGo.GetComponent<Image>();
        view._bg.raycastTarget = false; // Clicks go to parent Button

        var vlg = innerGo.GetComponent<VerticalLayoutGroup>();
        vlg.padding = new RectOffset(6, 6, 8, 8);
        vlg.spacing = 2;
        vlg.childAlignment = TextAnchor.UpperCenter;
        vlg.childControlWidth = vlg.childForceExpandWidth = true;

        var sc = SuitColor[suit];

        // 1. Suit Glyph
        UIKit.Label(innerGo.transform, SuitGlyph[suit], 22, FontStyle.Bold, sc, shadow: true);

        // 2. Rank Title
        string rankLabel = c.IsTrump ? CombatPreview.MajorName(c.Rank) : RankName(c.Rank);
        UIKit.Label(innerGo.transform, rankLabel + (c.IsTrump ? "  ✦" : ""), c.IsTrump ? 11 : 13, FontStyle.Bold,
            c.IsTrump ? new Color(0.95f, 0.86f, 0.63f) : Color.white, shadow: true);

        // 3. Suit Name + rev
        UIKit.Label(innerGo.transform, SuitName[suit] + (c.Inverted ? " (rev)" : ""), 9, FontStyle.Italic, sc * 1.1f, shadow: true);

        // 4. Clean Divider
        UIKit.Divider(innerGo.transform, new Color(sc.r, sc.g, sc.b, 0.25f), 1);

        // 5. Stats Block
        UIKit.Label(innerGo.transform, $"ATK {c.Attack}   HP {c.Health}\nARM {c.Armour}", 10, FontStyle.Normal, shadow: true);

        // 6. Secondary Divider
        UIKit.Divider(innerGo.transform, new Color(sc.r, sc.g, sc.b, 0.15f), 1);

        // 7. Level or Planet Placement
        if (c.Level > 1)
        {
            UIKit.Label(innerGo.transform, $"✦ Lv {c.Level}", 10, FontStyle.Bold, new Color(0.95f, 0.86f, 0.63f), shadow: true);
        }
        else
        {
            int pIdx = (int)c.SourceBody;
            if (pIdx >= 0 && pIdx < FactionData.Glyphs.Length)
            {
                string bodyGlyph = FactionData.Glyphs[pIdx];
                string bodyName = FactionData.Names[pIdx];
                Color planetColor = FactionData.Colors[pIdx];
                UIKit.Label(innerGo.transform, $"{bodyGlyph} {bodyName}", 9, FontStyle.Bold, planetColor, shadow: true);
            }
        }

        // 8. Loadout Button (if applicable)
        if (onLoadout != null)
        {
            var lb = UIKit.Button(innerGo.transform, LoadoutLabel(loadout),
                () => onLoadout.Invoke(c.CardId), 9, LoadoutTint(loadout));
            var lle = lb.GetComponent<LayoutElement>();
            lle.minHeight = lle.preferredHeight = 24;
        }

        // Bench cards are dimmed
        go.GetComponent<CanvasGroup>().alpha = loadout == Loadout.Bench ? 0.55f : 1f;

        go.GetComponent<Button>().onClick.AddListener(() =>
        {
            if (Time.unscaledTime < view._suppressClickUntil) return;
            view._onClick?.Invoke(view.CardId);
        });

        LongPress.Attach(go, () =>
        {
            view._suppressClickUntil = Time.unscaledTime + 0.5f;
            Tooltip.ShowForCard(c);
        });

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
            _bg.color = s ? new Color(0.14f, 0.12f, 0.08f, 0.98f) : new Color(0.04f, 0.05f, 0.09f, 0.96f);
        if (_border != null)
        {
            if (s)
                _border.color = new Color(1.0f, 0.92f, 0.7f, 1.0f); // Bright active border
            else
                _border.color = _isTrump ? new Color(0.95f, 0.86f, 0.63f, 0.85f) : new Color(_suitColor.r, _suitColor.g, _suitColor.b, 0.5f);
        }
        transform.localScale = s ? Vector3.one * 1.06f : Vector3.one;
    }

    static string RankName(byte r) => r switch
    {
        1 => "Ace", 11 => "Page", 12 => "Knight", 13 => "Queen", 14 => "King", _ => r.ToString(),
    };
}
