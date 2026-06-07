// Pentacles — your card collection, with fuse-to-level (combine).
//
// A "✦ Cards" launcher opens a modal grid of every card you own (across all
// loadouts). Tap a card, then tap a matching copy (same suit, rank, trump-ness),
// to fuse them: the stronger one levels up — with gentle-plateau diminishing
// returns — and the copy is spent. The server (`combine_cards`) is authoritative;
// the grid re-renders when the card rows echo back. Trading lives in TradePanel.

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using SpacetimeDB.Types;

public class CollectionPanel : MonoBehaviour
{
    public static CollectionPanel Instance { get; private set; }

    GameObject _modal;                 // the open overlay (null when closed)
    Transform _grid;
    bool _subscribed;
    bool _dirty;
    ulong _combineSel;                 // first-tapped card awaiting a match (0 = none)
    readonly Dictionary<ulong, CardView> _views = new();

    static readonly string[] SuitName = { "Cups", "Swords", "Pentacles", "Wands" };

    void Awake() => Instance = this;
    void Start() => BuildLauncher();

    void Update()
    {
        if (_modal != null && _dirty) { Rebuild(); _dirty = false; }
    }

    // ── Launcher ─────────────────────────────────────────────────────────────

    void BuildLauncher()
    {
        var canvas = UIKit.Canvas("CollectionLauncher", 55);
        var btn = UIKit.Button(canvas.transform, "✦ Cards", Open, 18,
            new Color(0.50f, 0.42f, 0.30f, 0.55f));
        var rt = (RectTransform)btn.transform;
        rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(0f, 0f); // bottom-left
        rt.anchoredPosition = new Vector2(24, 240);                   // above the deck strip
        btn.GetComponent<LayoutElement>().minWidth = 150;
    }

    // ── Open / close ─────────────────────────────────────────────────────────

    public void Open()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected) { Toast.Show("The sky isn't connected yet."); return; }
        if (_modal != null) return;
        Build(conn);
        if (!_subscribed)
        {
            conn.Conn.Db.Card.OnInsert += (_, __) => _dirty = true;
            conn.Conn.Db.Card.OnUpdate += (_, __, ___) => _dirty = true;
            conn.Conn.Db.Card.OnDelete += (_, __) => _dirty = true;
            _subscribed = true;
        }
        Rebuild();
    }

    public void Close()
    {
        if (_modal != null) Destroy(_modal);
        _modal = null;
        _grid = null;
        _combineSel = 0;
        _views.Clear();
    }

    void Build(CelestialPentacleConn conn)
    {
        var canvas = UIKit.Canvas("CollectionModal", 120);
        _modal = canvas;

        // Backdrop — dims the game and closes on a tap outside the window.
        var bg = new GameObject("Backdrop", typeof(RectTransform), typeof(Image), typeof(Button));
        bg.transform.SetParent(canvas.transform, false);
        bg.GetComponent<Image>().color = new Color(0.02f, 0.02f, 0.04f, 0.86f);
        UIKit.Stretch(bg, 0);
        bg.GetComponent<Button>().onClick.AddListener(Close);

        // Window.
        var win = new GameObject("Window", typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup));
        win.transform.SetParent(canvas.transform, false);
        var wrt = (RectTransform)win.transform;
        wrt.anchorMin = wrt.anchorMax = wrt.pivot = new Vector2(0.5f, 0.5f);
        wrt.sizeDelta = new Vector2(940, 1560);
        win.GetComponent<Image>().color = new Color(0.05f, 0.06f, 0.10f, 0.98f);
        var wv = win.GetComponent<VerticalLayoutGroup>();
        wv.padding = new RectOffset(24, 24, 24, 24); wv.spacing = 12;
        wv.childControlWidth = wv.childControlHeight = true;
        wv.childForceExpandWidth = true; wv.childForceExpandHeight = false;

        UIKit.Label(win.transform, "Your Collection", 30, FontStyle.Bold, new Color(0.95f, 0.86f, 0.63f));
        UIKit.Label(win.transform,
            "Tap a card, then a matching copy, to fuse them — the stronger one levels up (diminishing returns). Dimmed cards sit on your Bench.",
            15, FontStyle.Italic, new Color(0.75f, 0.77f, 0.82f));

        // Scrollable grid.
        var scroll = new GameObject("Scroll",
            typeof(RectTransform), typeof(Image), typeof(ScrollRect), typeof(RectMask2D), typeof(LayoutElement));
        scroll.transform.SetParent(win.transform, false);
        scroll.GetComponent<Image>().color = new Color(0f, 0f, 0f, 0.18f);
        scroll.GetComponent<LayoutElement>().flexibleHeight = 1f;

        var content = new GameObject("Grid",
            typeof(RectTransform), typeof(GridLayoutGroup), typeof(ContentSizeFitter));
        content.transform.SetParent(scroll.transform, false);
        var grt = (RectTransform)content.transform;
        grt.anchorMin = new Vector2(0f, 1f); grt.anchorMax = new Vector2(1f, 1f); grt.pivot = new Vector2(0.5f, 1f);
        var grid = content.GetComponent<GridLayoutGroup>();
        grid.cellSize = new Vector2(120, 196); grid.spacing = new Vector2(10, 10);
        grid.padding = new RectOffset(12, 12, 12, 12);
        grid.constraint = GridLayoutGroup.Constraint.FixedColumnCount; grid.constraintCount = 6;
        content.GetComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;

        var sr = scroll.GetComponent<ScrollRect>();
        sr.content = grt; sr.vertical = true; sr.horizontal = false;
        sr.movementType = ScrollRect.MovementType.Clamped; sr.scrollSensitivity = 30;
        _grid = content.transform;

        // Footer.
        var row = new GameObject("Footer",
            typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(LayoutElement));
        row.transform.SetParent(win.transform, false);
        var rh = row.GetComponent<HorizontalLayoutGroup>();
        rh.spacing = 12; rh.childAlignment = TextAnchor.MiddleCenter;
        rh.childControlWidth = rh.childControlHeight = true; rh.childForceExpandWidth = true;
        row.GetComponent<LayoutElement>().minHeight = 52;
        UIKit.Button(row.transform, "Close", Close, 18, new Color(0.30f, 0.30f, 0.40f, 0.5f));
    }

    // ── Render ───────────────────────────────────────────────────────────────

    void Rebuild()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || _grid == null) return;

        foreach (Transform t in _grid) Destroy(t.gameObject);
        _views.Clear();

        var me = conn.LocalIdentity;
        var mine = new List<Card>();
        foreach (var c in conn.Conn.Db.Card.Iter())
            if (c.Owner.Equals(me)) mine.Add(c);

        // Group identical cards together (suit → trump → rank), higher levels first.
        mine.Sort((a, b) =>
        {
            int s = ((int)a.Suit).CompareTo((int)b.Suit); if (s != 0) return s;
            int t = a.IsTrump.CompareTo(b.IsTrump); if (t != 0) return t;
            int r = a.Rank.CompareTo(b.Rank); if (r != 0) return r;
            return b.Level.CompareTo(a.Level);
        });

        foreach (var c in mine)
        {
            var v = CardView.Build(_grid, c, SlotLoadout(conn, c.CardId), OnCardTap, null);
            v.SetSelected(_combineSel == c.CardId);
            _views[c.CardId] = v;
        }
        if (mine.Count == 0)
            UIKit.Label(_grid, "No cards yet — capture a star to mint one from the sky.",
                16, FontStyle.Italic, new Color(0.75f, 0.77f, 0.82f));
    }

    // ── Combine ──────────────────────────────────────────────────────────────

    void OnCardTap(ulong id)
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null) return;
        var tapped = conn.Conn.Db.Card.CardId.Find(id);
        if (tapped == null) return;

        if (_combineSel == 0)                          // first pick
        {
            _combineSel = id;
            Highlight();
            Toast.Show($"Pick another {Name(tapped)} to fuse — or tap it again to cancel.", 3f);
            return;
        }
        if (_combineSel == id)                         // tapped the same card → cancel
        {
            _combineSel = 0;
            Highlight();
            return;
        }

        var first = conn.Conn.Db.Card.CardId.Find(_combineSel);
        if (first == null) { _combineSel = id; Highlight(); return; }

        if (first.Suit != tapped.Suit || first.Rank != tapped.Rank || first.IsTrump != tapped.IsTrump)
        {
            Toast.Show("Those aren't the same card — pick a matching copy.", 3f);
            _combineSel = id;                          // re-anchor to the new pick
            Highlight();
            return;
        }

        // A match — fuse. Keep the stronger card (higher level, then attack) so the
        // level accumulates on one instance; spend the other.
        var keep = ChooseKeep(first, tapped);
        var consume = keep.CardId == first.CardId ? tapped : first;
        conn.CombineCards(keep.CardId, consume.CardId);
        Toast.Show($"You fuse two {Name(tapped)} — it grows stronger.", 3.5f);
        _combineSel = 0;
        // The grid refreshes when the card update/delete echoes back.
    }

    void Highlight()
    {
        foreach (var kv in _views) kv.Value.SetSelected(kv.Key == _combineSel);
    }

    static Card ChooseKeep(Card a, Card b)
    {
        if (a.Level != b.Level) return a.Level > b.Level ? a : b;
        return a.Attack >= b.Attack ? a : b;
    }

    static Loadout SlotLoadout(CelestialPentacleConn conn, ulong cardId)
    {
        foreach (var s in conn.Conn.Db.DeckSlot.Iter())
            if (s.CardId == cardId) return s.Loadout;
        return Loadout.Bench;
    }

    static string Name(Card c) =>
        c.IsTrump ? CombatPreview.MajorName(c.Rank) : $"{Rank(c.Rank)} of {SuitName[(int)c.Suit]}";

    static string Rank(byte r) => r switch
    {
        1 => "Ace", 11 => "Page", 12 => "Knight", 13 => "Queen", 14 => "King", _ => r.ToString(),
    };
}
