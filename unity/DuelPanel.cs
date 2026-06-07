// Pentacles — live PvP duel UI ("Lane Skirmish").
//
// When two players queue for the same zone the server spawns a `duel` row; this
// panel opens on both phones, lets each assign one card per lane, commits via
// `commit_duel`, and shows the resolved best-of-3 outcome.

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using SpacetimeDB;
using SpacetimeDB.Types;

public class DuelPanel : MonoBehaviour
{
    public static DuelPanel Instance { get; private set; }

    GameObject _canvas;
    Transform _handContent;
    Text _title, _vs, _status;
    readonly Text[] _laneLabels = new Text[3];
    Button _commit;

    ulong _duelId;
    bool _amA, _resolvedShown, _built, _subscribed;
    readonly ulong[] _lanes = { 0, 0, 0 };
    readonly Dictionary<ulong, CardView> _hand = new();

    void Awake() => Instance = this;

    void Update()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected) return;
        if (!_built) { Build(); _built = true; }
        if (!_subscribed)
        {
            conn.Conn.Db.Duel.OnInsert += (_, d) => OnDuel(d);
            conn.Conn.Db.Duel.OnUpdate += (_, __, d) => OnDuel(d);
            _subscribed = true;
        }
    }

    void OnDuel(Duel d)
    {
        var me = CelestialPentacleConn.Instance.LocalIdentity;
        if (!d.PlayerA.Equals(me) && !d.PlayerB.Equals(me)) return;
        if (d.State == DuelState.Active && !_canvas.activeSelf) Open(d);
        else if (d.DuelId == _duelId && d.State == DuelState.Resolved && !_resolvedShown) ShowResult(d);
    }

    void Open(Duel d)
    {
        var me = CelestialPentacleConn.Instance.LocalIdentity;
        _duelId = d.DuelId; _amA = d.PlayerA.Equals(me); _resolvedShown = false;
        _lanes[0] = _lanes[1] = _lanes[2] = 0;

        int myF = (int)(_amA ? d.FactionA : d.FactionB);
        int opF = (int)(_amA ? d.FactionB : d.FactionA);
        _title.text = $"⚔ Live Duel — Zone {d.ZoneId}";
        _vs.text = $"{FactionData.Glyphs[myF]} {FactionData.Names[myF]}   vs   {FactionData.Glyphs[opF]} {FactionData.Names[opF]}\n"
                 + $"Sky: {CombatPreview.SkyWeather(CelestialPentacleConn.Instance)}";
        _status.text = "Assign one card to each lane, then commit.";
        _status.color = Color.white;

        BuildHand();
        RefreshLanes();
        _canvas.SetActive(true);
    }

    void BuildHand()
    {
        foreach (Transform t in _handContent) Destroy(t.gameObject);
        _hand.Clear();
        var conn = CelestialPentacleConn.Instance;
        var me = conn.LocalIdentity;
        foreach (var s in conn.Conn.Db.DeckSlot.Iter())
        {
            if (!s.Owner.Equals(me) || s.Loadout != Loadout.Active) continue;
            var c = conn.Conn.Db.Card.CardId.Find(s.CardId);
            if (c == null) continue;
            _hand[c.CardId] = CardView.Build(_handContent, c, TapCard);
        }
    }

    void TapCard(ulong id)
    {
        int at = System.Array.IndexOf(_lanes, id);
        if (at >= 0) _lanes[at] = 0;
        else { int slot = System.Array.IndexOf(_lanes, 0UL); if (slot < 0) return; _lanes[slot] = id; }
        RefreshLanes();
    }

    void RefreshLanes()
    {
        var conn = CelestialPentacleConn.Instance;
        string[] roman = { "I", "II", "III" };
        for (int i = 0; i < 3; i++)
        {
            string label = "—";
            if (_lanes[i] != 0)
            {
                var c = conn.Conn.Db.Card.CardId.Find(_lanes[i]);
                if (c != null) label = $"{SuitGlyph((int)c.Suit)} {RankName(c.Rank)}";
            }
            _laneLabels[i].text = $"Lane {roman[i]}:   {label}";
        }
        foreach (var kv in _hand) kv.Value.SetSelected(System.Array.IndexOf(_lanes, kv.Key) >= 0);
        _commit.interactable = _lanes[0] != 0 && _lanes[1] != 0 && _lanes[2] != 0;
    }

    void OnCommit()
    {
        if (_lanes[0] == 0 || _lanes[1] == 0 || _lanes[2] == 0) return;
        CelestialPentacleConn.Instance.CommitDuel(_duelId, _lanes[0], _lanes[1], _lanes[2]);
        _status.text = "Committed — waiting for your opponent…";
        _status.color = new Color(0.7f, 0.8f, 1f);
        _commit.interactable = false;
    }

    // Opponent gone quiet? Claim the zone. The server enforces the grace window
    // and only awards a side that actually committed; the resolved Duel row then
    // flows back through OnDuel → ShowResult.
    void OnClaimTimeout()
    {
        if (_duelId == 0) return;
        CelestialPentacleConn.Instance.ClaimDuelTimeout(_duelId);
        _status.text = "Claiming the zone — valid once your opponent's grace lapses…";
        _status.color = new Color(0.85f, 0.78f, 0.5f);
    }

    void ShowResult(Duel d)
    {
        _resolvedShown = true;
        var me = CelestialPentacleConn.Instance.LocalIdentity;
        int my = _amA ? d.LanesA : d.LanesB;
        int op = _amA ? d.LanesB : d.LanesA;
        bool won = d.Winner.HasValue && d.Winner.Value.Equals(me);
        _status.text = won
            ? $"★ VICTORY  ·  {my}–{op} lanes — the zone shifts to you!"
            : $"Defeated  ·  {my}–{op} lanes";
        _status.color = won ? new Color(0.45f, 0.85f, 0.5f) : new Color(0.9f, 0.5f, 0.5f);
        DeckPanel.Instance?.ClearSelection();
    }

    // ── UI construction ───────────────────────────────────────────────────

    void Build()
    {
        _canvas = UIKit.Canvas("DuelCanvas", 90);
        var dim = UIKit.Box(_canvas.transform, new Color(0, 0, 0, 0.6f));
        UIKit.Stretch(dim.gameObject, 0);

        var panel = new GameObject("Duel",
            typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
        panel.transform.SetParent(_canvas.transform, false);
        var rt = (RectTransform)panel.transform;
        rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(0.5f, 0.5f);
        panel.GetComponent<Image>().color = new Color(0.04f, 0.05f, 0.09f, 0.98f);
        var v = panel.GetComponent<VerticalLayoutGroup>();
        v.padding = new RectOffset(28, 28, 24, 24); v.spacing = 8;
        v.childAlignment = TextAnchor.UpperCenter; v.childControlWidth = v.childForceExpandWidth = true;
        var f = panel.GetComponent<ContentSizeFitter>();
        f.horizontalFit = ContentSizeFitter.FitMode.PreferredSize;
        f.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

        _title = UIKit.Label(panel.transform, "", 22, FontStyle.Bold);
        _title.gameObject.AddComponent<LayoutElement>().minWidth = 720;
        _vs = UIKit.Label(panel.transform, "", 16, FontStyle.Italic);
        for (int i = 0; i < 3; i++) _laneLabels[i] = UIKit.Label(panel.transform, "Lane", 15, FontStyle.Bold);

        var scroller = new GameObject("Hand",
            typeof(RectTransform), typeof(Image), typeof(ScrollRect), typeof(RectMask2D), typeof(LayoutElement));
        scroller.transform.SetParent(panel.transform, false);
        scroller.GetComponent<Image>().color = new Color(1, 1, 1, 0.03f);
        scroller.GetComponent<LayoutElement>().minHeight = 200;
        var content = new GameObject("HandContent",
            typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(ContentSizeFitter));
        content.transform.SetParent(scroller.transform, false);
        var crt = (RectTransform)content.transform;
        crt.anchorMin = crt.anchorMax = crt.pivot = new Vector2(0f, 0.5f);
        var hh = content.GetComponent<HorizontalLayoutGroup>();
        hh.spacing = 8; hh.padding = new RectOffset(10, 10, 10, 10);
        hh.childControlWidth = hh.childControlHeight = true;
        var cf = content.GetComponent<ContentSizeFitter>();
        cf.horizontalFit = ContentSizeFitter.FitMode.PreferredSize;
        cf.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
        var sr = scroller.GetComponent<ScrollRect>();
        sr.content = crt; sr.horizontal = true; sr.vertical = false; sr.movementType = ScrollRect.MovementType.Clamped;
        _handContent = content.transform;

        _status = UIKit.Label(panel.transform, "", 15, FontStyle.Normal);
        var row = new GameObject("Row", typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(LayoutElement));
        row.transform.SetParent(panel.transform, false);
        var hl = row.GetComponent<HorizontalLayoutGroup>();
        hl.spacing = 10; hl.childForceExpandWidth = hl.childControlWidth = true;
        row.GetComponent<LayoutElement>().minHeight = 48;
        _commit = UIKit.Button(row.transform, "Commit Lanes", OnCommit, 18, new Color(0.40f, 0.46f, 0.82f, 0.34f));
        UIKit.Button(row.transform, "Claim (AFK)", OnClaimTimeout, 14, new Color(0.62f, 0.48f, 0.22f, 0.34f));
        UIKit.Button(row.transform, "Close", () => _canvas.SetActive(false), 16);

        _canvas.SetActive(false);
    }

    static string SuitGlyph(int s) => new[] { "♥", "♠", "♦", "♣" }[s];
    static string RankName(byte r) => r switch
    { 1 => "Ace", 11 => "Page", 12 => "Knight", 13 => "Queen", 14 => "King", _ => r.ToString() };
}
