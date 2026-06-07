// Pentacles — live hand strip.
//
// Renders the player's deck (joined from deck_slot + card), live-updates as
// cards are minted, and tracks which cards are selected for the next strike.
// BattlePanel reads StrikeCards() when you attack a star.

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using SpacetimeDB.Types;

public class DeckPanel : MonoBehaviour
{
    public static DeckPanel Instance { get; private set; }

    readonly HashSet<ulong> _selected = new();
    readonly Dictionary<ulong, CardView> _views = new();
    Transform _content;
    bool _built;
    bool _dirty = true;

    void Awake() => Instance = this;

    void Update()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected) return;
        if (!_built) { Build(conn); _built = true; }
        if (_dirty) { Refresh(conn); _dirty = false; }
    }

    void Build(CelestialPentacleConn conn)
    {
        var canvas = UIKit.Canvas("DeckCanvas", 50);

        var root = new GameObject("DeckStrip",
            typeof(RectTransform), typeof(Image), typeof(ScrollRect), typeof(RectMask2D));
        root.transform.SetParent(canvas.transform, false);
        var rrt = (RectTransform)root.transform;
        rrt.anchorMin = rrt.anchorMax = new Vector2(0.5f, 0f);
        rrt.pivot = new Vector2(0.5f, 0f);
        rrt.sizeDelta = new Vector2(1040, 212);
        rrt.anchoredPosition = new Vector2(0, 12);
        root.GetComponent<Image>().color = new Color(0.02f, 0.03f, 0.06f, 0.6f);

        var content = new GameObject("Content",
            typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(ContentSizeFitter));
        content.transform.SetParent(root.transform, false);
        var crt = (RectTransform)content.transform;
        crt.anchorMin = crt.anchorMax = crt.pivot = new Vector2(0f, 0.5f);
        var h = content.GetComponent<HorizontalLayoutGroup>();
        h.spacing = 8; h.padding = new RectOffset(12, 12, 12, 12);
        h.childControlWidth = h.childControlHeight = true;
        h.childAlignment = TextAnchor.MiddleLeft;
        var f = content.GetComponent<ContentSizeFitter>();
        f.horizontalFit = ContentSizeFitter.FitMode.PreferredSize;
        f.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

        var sr = root.GetComponent<ScrollRect>();
        sr.content = crt; sr.horizontal = true; sr.vertical = false;
        sr.movementType = ScrollRect.MovementType.Clamped; sr.scrollSensitivity = 24;
        _content = content.transform;

        conn.Conn.Db.Card.OnInsert += (_, __) => _dirty = true;
        conn.Conn.Db.Card.OnUpdate += (_, __, ___) => _dirty = true;
        conn.Conn.Db.Card.OnDelete += (_, __) => _dirty = true;
        conn.Conn.Db.DeckSlot.OnInsert += (_, __) => _dirty = true;
        conn.Conn.Db.DeckSlot.OnUpdate += (_, __, ___) => _dirty = true;
        conn.Conn.Db.DeckSlot.OnDelete += (_, __) => _dirty = true;
    }

    void Refresh(CelestialPentacleConn conn)
    {
        var me = conn.LocalIdentity;
        var slots = new List<DeckSlot>();
        foreach (var s in conn.Conn.Db.DeckSlot.Iter())
            if (s.Owner.Equals(me)) slots.Add(s);
        slots.Sort((a, b) => a.Loadout.CompareTo(b.Loadout)); // Active first

        foreach (Transform t in _content) Destroy(t.gameObject);
        _views.Clear();
        var selectable = new HashSet<ulong>();

        foreach (var s in slots)
        {
            var c = conn.Conn.Db.Card.CardId.Find(s.CardId);
            if (c == null) continue;
            if (s.Loadout == Loadout.Active) selectable.Add(c.CardId);
            var v = CardView.Build(_content, c, s.Loadout, Toggle, CycleLoadout);
            v.SetSelected(_selected.Contains(c.CardId));
            _views[c.CardId] = v;
        }
        _selected.RemoveWhere(id => !selectable.Contains(id));
        HighlightSelection();
    }

    void Toggle(ulong id)
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn != null && !IsActive(conn, id))
        {
            Toast.Show("Only Active cards can be selected for a strike.");
            return;
        }
        if (!_selected.Remove(id)) _selected.Add(id);
        if (_views.TryGetValue(id, out var v)) v.SetSelected(_selected.Contains(id));
    }

    /// Cycle a card's loadout: Active → Defense → Bench → Active. The server caps
    /// Active at 8, so we refuse to overfill it here (it enforces it authoritatively).
    void CycleLoadout(ulong id)
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected) return;

        DeckSlot slot = null;
        foreach (var s in conn.Conn.Db.DeckSlot.Iter())
            if (s.Owner.Equals(conn.LocalIdentity) && s.CardId == id) { slot = s; break; }
        if (slot == null) return;

        var next = slot.Loadout switch
        {
            Loadout.Active => Loadout.Defense,
            Loadout.Defense => Loadout.Bench,
            _ => Loadout.Active,
        };
        if (next == Loadout.Active && ActiveCount(conn) >= 8)
        {
            Toast.Show("Active is full (8) — bench a card before fielding another.");
            return;
        }
        conn.SetLoadout(id, next);
        // The strip re-renders when the slot update echoes back (DeckSlot.OnUpdate).
    }

    static int ActiveCount(CelestialPentacleConn conn)
    {
        int n = 0;
        var me = conn.LocalIdentity;
        foreach (var s in conn.Conn.Db.DeckSlot.Iter())
            if (s.Owner.Equals(me) && s.Loadout == Loadout.Active) n++;
        return n;
    }

    /// Cards to play in a strike: the current selection, or all Active if none picked.
    public List<ulong> StrikeCards(CelestialPentacleConn conn)
    {
        _selected.RemoveWhere(id => !IsActive(conn, id));
        if (_selected.Count > 0) return new List<ulong>(_selected);
        var ids = new List<ulong>();
        var me = conn.LocalIdentity;
        foreach (var s in conn.Conn.Db.DeckSlot.Iter())
            if (s.Owner.Equals(me) && s.Loadout == Loadout.Active) ids.Add(s.CardId);
        return ids;
    }

    public void ClearSelection()
    {
        _selected.Clear();
        HighlightSelection();
    }

    void HighlightSelection()
    {
        foreach (var kv in _views) kv.Value.SetSelected(_selected.Contains(kv.Key));
    }

    static bool IsActive(CelestialPentacleConn conn, ulong cardId)
    {
        var me = conn.LocalIdentity;
        foreach (var s in conn.Conn.Db.DeckSlot.Iter())
            if (s.Owner.Equals(me) && s.CardId == cardId) return s.Loadout == Loadout.Active;
        return false;
    }

    /// Announce a freshly minted or received card. The strip itself re-renders via
    /// the Card.OnInsert handler wired in Build().
    public void OnCardGranted(Card card)
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !card.Owner.Equals(conn.LocalIdentity)) return;
        Toast.Show($"+ {CardName(card)} joined your collection.", 3.5f);
        Debug.Log($"[Deck] +{(card.IsTrump ? "TRUMP " : "")}{card.Suit} rank {card.Rank} " +
                  $"(atk {card.Attack} / hp {card.Health})");
    }

    static string CardName(Card c) =>
        c.IsTrump ? CombatPreview.MajorName(c.Rank) : $"{RankName(c.Rank)} of {c.Suit}";

    static string RankName(byte r) => r switch
    {
        1 => "Ace", 11 => "Page", 12 => "Knight", 13 => "Queen", 14 => "King", _ => r.ToString(),
    };
}
