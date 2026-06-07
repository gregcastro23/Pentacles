// Pentacles — confirmed two-way card trades.
//
// Opened from the collection. Two halves:
//   • Pending — open trades involving you, from your perspective ("you give /
//     you get"), with Confirm (if you're the partner) and Cancel.
//   • Propose — pick a partner, stake some of your cards (you give) and tap some
//     of theirs (you get), then Propose. Cards are public, so you can browse a
//     partner's collection. The swap commits only when both sides confirm; the
//     server re-validates ownership at commit (`propose_trade`/`confirm_trade`).

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.UI;
using SpacetimeDB;
using SpacetimeDB.Types;

public class TradePanel : MonoBehaviour
{
    public static TradePanel Instance { get; private set; }

    GameObject _modal;
    Transform _content;
    bool _subscribed, _dirty;
    Identity _partner;
    bool _hasPartner;
    readonly HashSet<ulong> _offer = new();
    readonly HashSet<ulong> _request = new();

    static readonly string[] SuitGlyph = { "♥", "♠", "♦", "♣" };
    static readonly Color Chip = new(0.20f, 0.22f, 0.30f, 0.60f);
    static readonly Color ChipSel = new(0.85f, 0.71f, 0.42f, 0.55f);
    static readonly Color PartnerSel = new(0.40f, 0.60f, 0.82f, 0.55f);

    void Awake() => Instance = this;
    void Update() { if (_modal != null && _dirty) { Rebuild(); _dirty = false; } }

    // ── Open / close ─────────────────────────────────────────────────────────

    public void Open()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected) { Toast.Show("The sky isn't connected yet."); return; }
        if (_modal != null) return;
        Build(conn);
        if (!_subscribed)
        {
            conn.Conn.Db.Trade.OnInsert += (_, __) => _dirty = true;
            conn.Conn.Db.Trade.OnUpdate += (_, __, ___) => _dirty = true;
            conn.Conn.Db.Trade.OnDelete += (_, __) => _dirty = true;
            conn.Conn.Db.Card.OnUpdate += (_, __, ___) => _dirty = true;
            conn.Conn.Db.Card.OnDelete += (_, __) => _dirty = true;
            _subscribed = true;
        }
        Rebuild();
    }

    public void Close()
    {
        if (_modal != null) Destroy(_modal);
        _modal = null; _content = null;
        _hasPartner = false; _offer.Clear(); _request.Clear();
    }

    void Build(CelestialPentacleConn conn)
    {
        var canvas = UIKit.Canvas("TradeModal", 130);
        _modal = canvas;

        var bg = new GameObject("Backdrop", typeof(RectTransform), typeof(Image), typeof(Button));
        bg.transform.SetParent(canvas.transform, false);
        bg.GetComponent<Image>().color = new Color(0.02f, 0.02f, 0.04f, 0.86f);
        UIKit.Stretch(bg, 0);
        bg.GetComponent<Button>().onClick.AddListener(Close);

        var win = new GameObject("Window", typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup));
        win.transform.SetParent(canvas.transform, false);
        var wrt = (RectTransform)win.transform;
        wrt.anchorMin = wrt.anchorMax = wrt.pivot = new Vector2(0.5f, 0.5f);
        wrt.sizeDelta = new Vector2(960, 1640);
        win.GetComponent<Image>().color = new Color(0.05f, 0.06f, 0.10f, 0.98f);
        var wv = win.GetComponent<VerticalLayoutGroup>();
        wv.padding = new RectOffset(24, 24, 24, 24); wv.spacing = 10;
        wv.childControlWidth = wv.childControlHeight = true;
        wv.childForceExpandWidth = true; wv.childForceExpandHeight = false;

        UIKit.Label(win.transform, "Trades", 30, FontStyle.Bold, new Color(0.95f, 0.86f, 0.63f));

        var scroll = new GameObject("Scroll",
            typeof(RectTransform), typeof(Image), typeof(ScrollRect), typeof(RectMask2D), typeof(LayoutElement));
        scroll.transform.SetParent(win.transform, false);
        scroll.GetComponent<Image>().color = new Color(0f, 0f, 0f, 0.18f);
        scroll.GetComponent<LayoutElement>().flexibleHeight = 1f;

        var content = new GameObject("Content",
            typeof(RectTransform), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
        content.transform.SetParent(scroll.transform, false);
        var crt = (RectTransform)content.transform;
        crt.anchorMin = new Vector2(0f, 1f); crt.anchorMax = new Vector2(1f, 1f); crt.pivot = new Vector2(0.5f, 1f);
        var cv = content.GetComponent<VerticalLayoutGroup>();
        cv.padding = new RectOffset(12, 12, 12, 12); cv.spacing = 8;
        cv.childControlWidth = cv.childControlHeight = true;
        cv.childForceExpandWidth = true; cv.childForceExpandHeight = false;
        content.GetComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
        var sr = scroll.GetComponent<ScrollRect>();
        sr.content = crt; sr.vertical = true; sr.horizontal = false;
        sr.movementType = ScrollRect.MovementType.Clamped; sr.scrollSensitivity = 30;
        _content = content.transform;

        UIKit.Button(win.transform, "Close", Close, 18, new Color(0.30f, 0.30f, 0.40f, 0.5f))
            .GetComponent<LayoutElement>().minHeight = 50;
    }

    // ── Render ───────────────────────────────────────────────────────────────

    void Rebuild()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || _content == null) return;
        foreach (Transform t in _content) Destroy(t.gameObject);
        var me = conn.LocalIdentity;

        // Pending trades involving me.
        Header("Pending");
        int pending = 0;
        foreach (var tr in conn.Conn.Db.Trade.Iter())
        {
            if (tr.State != TradeState.Open) continue;
            bool iAmProposer = tr.Proposer.Equals(me);
            if (!iAmProposer && !tr.Partner.Equals(me)) continue;
            PendingRow(conn, tr, iAmProposer);
            pending++;
        }
        if (pending == 0)
            UIKit.Label(_content, "No open trades.", 14, FontStyle.Italic, new Color(0.70f, 0.72f, 0.78f));

        // Propose a new trade.
        Header("Propose a trade");

        UIKit.Label(_content, "Partner", 15, FontStyle.Bold);
        var partners = Strip();
        int others = 0;
        foreach (var p in conn.Conn.Db.Player.Iter())
        {
            if (p.Identity.Equals(me)) continue;
            others++;
            bool sel = _hasPartner && _partner.Equals(p.Identity);
            var pid = p.Identity;
            ChipBtn(partners, p.Handle, sel ? PartnerSel : Chip, () => { _partner = pid; _hasPartner = true; _request.Clear(); _dirty = true; });
        }
        if (others == 0) UIKit.Label(partners, "(no other players yet)", 12, FontStyle.Italic);

        UIKit.Label(_content, "You give", 15, FontStyle.Bold);
        var mineStrip = Strip();
        int mineCount = 0;
        foreach (var c in conn.Conn.Db.Card.Iter())
            if (c.Owner.Equals(me))
            {
                mineCount++;
                var id = c.CardId;
                ChipBtn(mineStrip, ChipLabel(c), _offer.Contains(id) ? ChipSel : Chip, () => Toggle(_offer, id));
            }
        if (mineCount == 0) UIKit.Label(mineStrip, "(you hold no cards)", 12, FontStyle.Italic);

        UIKit.Label(_content, "You get", 15, FontStyle.Bold);
        var theirStrip = Strip();
        if (!_hasPartner)
        {
            UIKit.Label(theirStrip, "Pick a partner first.", 12, FontStyle.Italic, new Color(0.70f, 0.72f, 0.78f));
        }
        else
        {
            int theirCount = 0;
            foreach (var c in conn.Conn.Db.Card.Iter())
                if (c.Owner.Equals(_partner))
                {
                    theirCount++;
                    var id = c.CardId;
                    ChipBtn(theirStrip, ChipLabel(c), _request.Contains(id) ? ChipSel : Chip, () => Toggle(_request, id));
                }
            if (theirCount == 0) UIKit.Label(theirStrip, "(they hold no cards)", 12, FontStyle.Italic);
        }

        UIKit.Button(_content, "Propose Trade", DoPropose, 18, new Color(0.50f, 0.42f, 0.30f, 0.6f))
            .GetComponent<LayoutElement>().minHeight = 48;
    }

    void PendingRow(CelestialPentacleConn conn, Trade tr, bool iAmProposer)
    {
        var row = Section();
        UIKit.Label(row, $"You ⇄ {Handle(conn, iAmProposer ? tr.Partner : tr.Proposer)}",
            15, FontStyle.Bold, new Color(0.95f, 0.86f, 0.63f), TextAnchor.MiddleLeft);
        // From my perspective I give my staked side and get the other's.
        var iGive = iAmProposer ? tr.Offer : tr.Request;
        var iGet = iAmProposer ? tr.Request : tr.Offer;
        UIKit.Label(row, "You give: " + Names(conn, iGive), 13, FontStyle.Normal,
            new Color(0.86f, 0.60f, 0.50f), TextAnchor.MiddleLeft);
        UIKit.Label(row, "You get: " + Names(conn, iGet), 13, FontStyle.Normal,
            new Color(0.52f, 0.78f, 0.55f), TextAnchor.MiddleLeft);

        var btns = Strip();
        var id = tr.TradeId;
        if (!iAmProposer)
            ChipBtn(btns, "Confirm", new Color(0.30f, 0.55f, 0.35f, 0.65f),
                () => { conn.ConfirmTrade(id); Toast.Show("Trade confirmed."); });
        else
            UIKit.Label(btns, "Awaiting their confirm…", 12, FontStyle.Italic, new Color(0.70f, 0.72f, 0.78f));
        ChipBtn(btns, "Cancel", new Color(0.55f, 0.30f, 0.30f, 0.55f),
            () => { conn.CancelTrade(id); Toast.Show("Trade cancelled."); });
    }

    void DoPropose()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null) return;
        if (!_hasPartner) { Toast.Show("Pick a partner to trade with."); return; }
        if (_offer.Count == 0 && _request.Count == 0) { Toast.Show("Stake at least one card."); return; }
        conn.ProposeTrade(_partner, new List<ulong>(_offer), new List<ulong>(_request));
        Toast.Show("Trade proposed — waiting for them to confirm.", 3.5f);
        _offer.Clear(); _request.Clear();
        _dirty = true;
    }

    void Toggle(HashSet<ulong> set, ulong id) { if (!set.Remove(id)) set.Add(id); _dirty = true; }

    // ── Small builders ───────────────────────────────────────────────────────

    void Header(string s) => UIKit.Label(_content, s, 20, FontStyle.Bold, new Color(0.78f, 0.74f, 0.62f));

    Transform Section()
    {
        var go = new GameObject("Sec",
            typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup), typeof(LayoutElement));
        go.transform.SetParent(_content, false);
        go.GetComponent<Image>().color = new Color(1f, 1f, 1f, 0.04f);
        var v = go.GetComponent<VerticalLayoutGroup>();
        v.padding = new RectOffset(12, 12, 10, 10); v.spacing = 4;
        v.childControlWidth = v.childControlHeight = true; v.childForceExpandWidth = true;
        return go.transform;
    }

    /// A wrapping row of chips (a grid that grows downward).
    Transform Strip()
    {
        var go = new GameObject("Strip",
            typeof(RectTransform), typeof(GridLayoutGroup), typeof(ContentSizeFitter));
        go.transform.SetParent(_content, false);
        var g = go.GetComponent<GridLayoutGroup>();
        g.cellSize = new Vector2(168, 40); g.spacing = new Vector2(6, 6);
        g.constraint = GridLayoutGroup.Constraint.FixedColumnCount; g.constraintCount = 5;
        go.GetComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
        return go.transform;
    }

    void ChipBtn(Transform parent, string label, Color tint, UnityAction onClick) =>
        UIKit.Button(parent, label, onClick, 12, tint);

    string ChipLabel(Card c)
    {
        string n = c.IsTrump ? CombatPreview.MajorName(c.Rank) : $"{Rank(c.Rank)} {SuitGlyph[(int)c.Suit]}";
        return c.Level > 1 ? $"{n} ✦{c.Level}" : n;
    }

    string Names(CelestialPentacleConn conn, List<ulong> ids)
    {
        if (ids == null || ids.Count == 0) return "(nothing)";
        var parts = new List<string>();
        foreach (var id in ids)
        {
            var c = conn.Conn.Db.Card.CardId.Find(id);
            parts.Add(c != null ? ChipLabel(c) : $"#{id}");
        }
        return string.Join(", ", parts);
    }

    string Handle(CelestialPentacleConn conn, Identity id)
    {
        var p = conn.Conn.Db.Player.Identity.Find(id);
        return p != null ? p.Handle : "someone";
    }

    static string Rank(byte r) => r switch
    {
        1 => "Ace", 11 => "Page", 12 => "Knight", 13 => "Queen", 14 => "King", _ => r.ToString(),
    };
}
