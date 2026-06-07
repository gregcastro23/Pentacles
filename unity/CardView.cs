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

    public static CardView Build(Transform parent, Card c, Action<ulong> onClick)
    {
        var go = new GameObject($"card:{c.CardId}",
            typeof(RectTransform), typeof(Image), typeof(Button), typeof(LayoutElement), typeof(VerticalLayoutGroup));
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
        UIKit.Label(go.transform, RankName(c.Rank) + (c.IsTrump ? "  ✦" : ""), 14, FontStyle.Bold,
            c.IsTrump ? new Color(0.95f, 0.86f, 0.63f) : Color.white);
        UIKit.Label(go.transform, SuitName[suit] + (c.Inverted ? " (rev)" : ""), 10, FontStyle.Italic, sc);
        UIKit.Label(go.transform, $"ATK {c.Attack}   HP {c.Health}\nARM {c.Armour}", 11, FontStyle.Normal);

        go.GetComponent<Button>().onClick.AddListener(() => view._onClick?.Invoke(view.CardId));
        view.SetSelected(false);
        return view;
    }

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
