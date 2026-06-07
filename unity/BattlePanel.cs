// Pentacles — star-target battle overlay.
//
// Opened by SkyRenderer when you tap a star. Shows the target + holder, an
// honest strike-power estimate from your selected cards, fires
// ResolveStarBattle, and reads the resulting `battle` row to show the outcome.

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using SpacetimeDB;
using SpacetimeDB.Types;

public class BattlePanel : MonoBehaviour
{
    public static BattlePanel Instance { get; private set; }

    GameObject _canvas, _panel;
    Text _title, _info, _result;
    Button _attack;
    uint _targetHip;
    byte _targetZone;
    bool _awaiting;

    void Awake() => Instance = this;
    void Start() { Build(); _canvas.SetActive(false); }

    void Build()
    {
        _canvas = UIKit.Canvas("BattleCanvas", 80);
        var dim = UIKit.Box(_canvas.transform, new Color(0, 0, 0, 0.55f));
        UIKit.Stretch(dim.gameObject, 0);

        _panel = new GameObject("Battle",
            typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
        _panel.transform.SetParent(_canvas.transform, false);
        var rt = (RectTransform)_panel.transform;
        rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(0.5f, 0.5f);
        _panel.GetComponent<Image>().color = new Color(0.04f, 0.05f, 0.09f, 0.98f);
        var v = _panel.GetComponent<VerticalLayoutGroup>();
        v.padding = new RectOffset(28, 28, 24, 24); v.spacing = 10;
        v.childAlignment = TextAnchor.UpperCenter; v.childControlWidth = v.childForceExpandWidth = true;
        var f = _panel.GetComponent<ContentSizeFitter>();
        f.horizontalFit = ContentSizeFitter.FitMode.PreferredSize;
        f.verticalFit = ContentSizeFitter.FitMode.PreferredSize;

        _title = UIKit.Label(_panel.transform, "", 22, FontStyle.Bold);
        _title.gameObject.AddComponent<LayoutElement>().minWidth = 560;
        _info = UIKit.Label(_panel.transform, "", 15, FontStyle.Normal);
        _result = UIKit.Label(_panel.transform, "", 17, FontStyle.Bold);

        var row = new GameObject("Row", typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(LayoutElement));
        row.transform.SetParent(_panel.transform, false);
        var hl = row.GetComponent<HorizontalLayoutGroup>();
        hl.spacing = 10; hl.childForceExpandWidth = hl.childControlWidth = true;
        row.GetComponent<LayoutElement>().minHeight = 48;
        _attack = UIKit.Button(row.transform, "Strike", OnAttack, 18, new Color(0.84f, 0.32f, 0.32f, 0.32f));
        UIKit.Button(row.transform, "⚔ Duel", OnQueueDuel, 16, new Color(0.40f, 0.46f, 0.82f, 0.32f));
        UIKit.Button(row.transform, "Cancel", Hide, 16);
    }

    public void OpenFor(StarNode star)
    {
        _targetHip = star.HipId; _targetZone = star.RegionHint; _awaiting = false; _result.text = "";
        var conn = CelestialPentacleConn.Instance;
        var cards = GatherCards(conn);
        string holder = star.HeldBy.HasValue ? FactionData.Names[(int)star.HeldBy.Value] : "uncontrolled";
        int power = CombatPreview.StrikePower(cards, star.HeldBy);

        _title.text = $"✦ {star.Name}";
        _info.text = $"Held by: {holder}\nYour strike: {cards.Count} card(s) · power ≈ {power}\n" +
                     "Tap cards in your hand to choose the strike.";
        _attack.interactable = cards.Count > 0;
        _canvas.SetActive(true);
    }

    List<Card> GatherCards(CelestialPentacleConn conn)
    {
        var ids = DeckPanel.Instance != null ? DeckPanel.Instance.StrikeCards(conn) : ActiveIds(conn);
        var list = new List<Card>();
        foreach (var id in ids)
        {
            var c = conn.Conn.Db.Card.CardId.Find(id);
            if (c != null) list.Add(c);
        }
        return list;
    }

    static List<ulong> ActiveIds(CelestialPentacleConn conn)
    {
        var ids = new List<ulong>();
        var me = conn.LocalIdentity;
        foreach (var s in conn.Conn.Db.DeckSlot.Iter())
            if (s.Owner.Equals(me) && s.Loadout == Loadout.Active) ids.Add(s.CardId);
        return ids;
    }

    void OnAttack()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null) return;
        var ids = new List<ulong>();
        foreach (var c in GatherCards(conn)) ids.Add(c.CardId);
        if (ids.Count == 0) return;

        _awaiting = true;
        _result.text = "Resolving…"; _result.color = Color.white;
        conn.Conn.Db.Battle.OnInsert += OnBattle;
        conn.AttackStar(_targetHip, ids);
    }

    void OnQueueDuel()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null) return;
        conn.EnqueueDuel(_targetZone);
        _result.text = "Queued for a live duel in this zone — waiting for an opponent…";
        _result.color = new Color(0.7f, 0.8f, 1f);
    }

    void OnBattle(EventContext ctx, Battle b)
    {
        var conn = CelestialPentacleConn.Instance;
        if (!_awaiting || b.StarId != _targetHip || !b.Attacker.Equals(conn.LocalIdentity)) return;
        conn.Conn.Db.Battle.OnInsert -= OnBattle;
        _awaiting = false;

        if (b.Won)
        {
            _result.text = $"★ CAPTURED  ·  {b.AttackerScore} vs {b.DefenseRating}";
            _result.color = new Color(0.45f, 0.85f, 0.5f);
            DeckPanel.Instance?.ClearSelection();
        }
        else
        {
            _result.text = $"Repelled  ·  {b.AttackerScore} vs {b.DefenseRating}";
            _result.color = new Color(0.9f, 0.5f, 0.5f);
        }
    }

    public void Hide()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn != null) conn.Conn.Db.Battle.OnInsert -= OnBattle;
        _awaiting = false;
        if (_canvas != null) _canvas.SetActive(false);
    }
}
