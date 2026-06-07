// Pentacles — the Oracle's panel: tips, chat, and the Book of the Sky.
//
// Opened from the "✦ Oracle" button. Three things in one modal:
//   • an instant heuristic tip (OracleAdvisor — free, offline);
//   • free-text chat with Claude via the companion service: a question goes to
//     `ask_oracle` with a derived context summary (never birth data), and the
//     reply streams back through `oracle_reply`;
//   • the codex (OracleLore) — the browsable Book of the Sky.
//
// The text field lives outside the refreshed transcript, so an incoming reply
// never eats what you're typing.

using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using SpacetimeDB.Types;

public class OraclePanel : MonoBehaviour
{
    public static OraclePanel Instance { get; private set; }

    enum View { Chat, Codex }

    GameObject _modal;
    Transform _content;
    GameObject _inputRow;
    InputField _input;
    View _view = View.Chat;
    int _codexIndex = -1;     // -1 = chapter list
    bool _subscribed, _dirty;

    void Awake() => Instance = this;
    void Update() { if (_modal != null && _dirty) { Rebuild(); _dirty = false; } }

    // ── Open / close ─────────────────────────────────────────────────────────

    public void Open()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected) { Toast.Show("The sky isn't connected yet."); return; }
        if (_modal != null) return;
        _view = View.Chat; _codexIndex = -1;
        Build(conn);
        if (!_subscribed)
        {
            conn.Conn.Db.OracleReply.OnInsert += (_, __) => _dirty = true;
            conn.Conn.Db.OracleRequest.OnInsert += (_, __) => _dirty = true;
            _subscribed = true;
        }
        Rebuild();
    }

    public void Close()
    {
        if (_modal != null) Destroy(_modal);
        _modal = null; _content = null; _inputRow = null; _input = null;
    }

    void Build(CelestialPentacleConn conn)
    {
        var canvas = UIKit.Canvas("OracleModal", 125);
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

        // Header: title + view toggles.
        var head = new GameObject("Head", typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(LayoutElement));
        head.transform.SetParent(win.transform, false);
        var hh = head.GetComponent<HorizontalLayoutGroup>();
        hh.spacing = 8; hh.childAlignment = TextAnchor.MiddleLeft;
        hh.childControlWidth = hh.childControlHeight = true; hh.childForceExpandWidth = false;
        head.GetComponent<LayoutElement>().minHeight = 50;
        UIKit.Label(head.transform, "The Oracle", 28, FontStyle.Bold, new Color(0.95f, 0.86f, 0.63f),
            TextAnchor.MiddleLeft).gameObject.AddComponent<LayoutElement>().minWidth = 420;
        UIKit.Button(head.transform, "Ask", () => SetView(View.Chat), 16,
            new Color(0.50f, 0.42f, 0.30f, 0.5f)).GetComponent<LayoutElement>().minWidth = 130;
        UIKit.Button(head.transform, "Book of the Sky", () => SetView(View.Codex), 16,
            new Color(0.36f, 0.40f, 0.56f, 0.5f)).GetComponent<LayoutElement>().minWidth = 220;

        // Scrollable body.
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
        cv.padding = new RectOffset(14, 14, 14, 14); cv.spacing = 10;
        cv.childControlWidth = cv.childControlHeight = true;
        cv.childForceExpandWidth = true; cv.childForceExpandHeight = false;
        content.GetComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
        var sr = scroll.GetComponent<ScrollRect>();
        sr.content = crt; sr.vertical = true; sr.horizontal = false;
        sr.movementType = ScrollRect.MovementType.Clamped; sr.scrollSensitivity = 30;
        _content = content.transform;

        // Persistent input row (chat only).
        _inputRow = new GameObject("InputRow", typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(LayoutElement));
        _inputRow.transform.SetParent(win.transform, false);
        var ih = _inputRow.GetComponent<HorizontalLayoutGroup>();
        ih.spacing = 8; ih.childAlignment = TextAnchor.MiddleCenter;
        ih.childControlWidth = ih.childControlHeight = true; ih.childForceExpandWidth = false;
        _inputRow.GetComponent<LayoutElement>().minHeight = 56;
        _input = BuildInput(_inputRow.transform);
        UIKit.Button(_inputRow.transform, "Send", Send, 18, new Color(0.50f, 0.42f, 0.30f, 0.6f))
            .GetComponent<LayoutElement>().minWidth = 150;

        UIKit.Button(win.transform, "Close", Close, 18, new Color(0.30f, 0.30f, 0.40f, 0.5f))
            .GetComponent<LayoutElement>().minHeight = 48;
    }

    void SetView(View v) { _view = v; _codexIndex = -1; _dirty = true; }

    // ── Render ───────────────────────────────────────────────────────────────

    void Rebuild()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || _content == null) return;
        foreach (Transform t in _content) Destroy(t.gameObject);
        if (_inputRow != null) _inputRow.SetActive(_view == View.Chat);

        if (_view == View.Codex) { RenderCodex(); return; }

        // Chat: an instant heuristic tip, then the transcript.
        var tip = new GameObject("Tip", typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup), typeof(LayoutElement));
        tip.transform.SetParent(_content, false);
        tip.GetComponent<Image>().color = new Color(0.50f, 0.40f, 0.66f, 0.16f);
        var tv = tip.GetComponent<VerticalLayoutGroup>();
        tv.padding = new RectOffset(12, 12, 10, 10); tv.childControlWidth = tv.childControlHeight = true;
        tv.childForceExpandWidth = true;
        UIKit.Label(tip.transform, OracleAdvisor.BestTip(conn), 16, FontStyle.Bold,
            new Color(0.92f, 0.88f, 0.78f), TextAnchor.MiddleLeft);

        var me = conn.LocalIdentity;
        var mine = new List<OracleRequest>();
        foreach (var r in conn.Conn.Db.OracleRequest.Iter())
            if (r.Asker.Equals(me)) mine.Add(r);
        mine.Sort((a, b) => a.RequestId.CompareTo(b.RequestId)); // creation order
        int skip = Mathf.Max(0, mine.Count - 12);                // last 12 exchanges

        if (mine.Count == 0)
            UIKit.Label(_content, "Ask me of the rules, or of your next move. I read the same sky you do.",
                14, FontStyle.Italic, new Color(0.72f, 0.74f, 0.80f), TextAnchor.MiddleLeft);

        for (int i = skip; i < mine.Count; i++)
        {
            var req = mine[i];
            Bubble($"You: {req.Question}", new Color(0.16f, 0.18f, 0.24f, 0.9f), new Color(0.88f, 0.90f, 0.94f));
            var reply = conn.Conn.Db.OracleReply.RequestId.Find(req.RequestId);
            if (reply != null)
                Bubble($"Oracle: {reply.Text}", new Color(0.20f, 0.16f, 0.10f, 0.9f), new Color(0.95f, 0.88f, 0.72f));
            else
                Bubble("Oracle: …gazing into the sky…", new Color(0.12f, 0.12f, 0.16f, 0.8f), new Color(0.66f, 0.68f, 0.74f));
        }
    }

    void RenderCodex()
    {
        if (_codexIndex < 0)
        {
            UIKit.Label(_content, "The Book of the Sky", 22, FontStyle.Bold, new Color(0.95f, 0.86f, 0.63f), TextAnchor.MiddleLeft);
            for (int i = 0; i < OracleLore.Codex.Length; i++)
            {
                int idx = i;
                UIKit.Button(_content, $"{i + 1}.  {OracleLore.Codex[i].Title}", () => { _codexIndex = idx; _dirty = true; },
                    16, new Color(0.18f, 0.20f, 0.28f, 0.6f)).GetComponent<LayoutElement>().minHeight = 46;
            }
            UIKit.Button(_content, "↻ Replay the first-run guide", () => { Close(); Tutorial.Instance?.Replay(); },
                15, new Color(0.36f, 0.40f, 0.56f, 0.45f)).GetComponent<LayoutElement>().minHeight = 44;
            return;
        }

        var e = OracleLore.Codex[Mathf.Clamp(_codexIndex, 0, OracleLore.Codex.Length - 1)];
        UIKit.Button(_content, "‹ Back", () => { _codexIndex = -1; _dirty = true; }, 15,
            new Color(0.30f, 0.30f, 0.40f, 0.5f)).GetComponent<LayoutElement>().minHeight = 42;
        UIKit.Label(_content, e.Title, 24, FontStyle.Bold, new Color(0.95f, 0.86f, 0.63f), TextAnchor.MiddleLeft);
        UIKit.Label(_content, e.Body, 17, FontStyle.Normal, new Color(0.90f, 0.90f, 0.92f), TextAnchor.UpperLeft);
        UIKit.Label(_content, "Have a question on this? Tap Ask and put it to me directly.",
            14, FontStyle.Italic, new Color(0.72f, 0.74f, 0.80f), TextAnchor.MiddleLeft);
    }

    void Bubble(string text, Color bg, Color fg)
    {
        var go = new GameObject("Bubble", typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup), typeof(LayoutElement));
        go.transform.SetParent(_content, false);
        go.GetComponent<Image>().color = bg;
        var v = go.GetComponent<VerticalLayoutGroup>();
        v.padding = new RectOffset(12, 12, 8, 8); v.childControlWidth = v.childControlHeight = true; v.childForceExpandWidth = true;
        UIKit.Label(go.transform, text, 15, FontStyle.Normal, fg, TextAnchor.UpperLeft);
    }

    // ── Send ─────────────────────────────────────────────────────────────────

    void Send()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected || _input == null) return;
        string q = _input.text.Trim();
        if (string.IsNullOrEmpty(q)) return;
        conn.AskOracle(q, BuildContext(conn), IsCacheable(q));
        _input.text = "";
        _dirty = true;
    }

    InputField BuildInput(Transform parent)
    {
        var go = new GameObject("Input", typeof(RectTransform), typeof(Image), typeof(InputField), typeof(LayoutElement));
        go.transform.SetParent(parent, false);
        go.GetComponent<Image>().color = new Color(0.12f, 0.13f, 0.18f, 0.95f);
        var le = go.GetComponent<LayoutElement>();
        le.minHeight = 50; le.minWidth = 560; le.flexibleWidth = 1f;

        var text = UIKit.Label(go.transform, "", 16, FontStyle.Normal, Color.white, TextAnchor.MiddleLeft);
        text.supportRichText = false; UIKit.Stretch(text.gameObject, 10);
        var ph = UIKit.Label(go.transform, "Ask the Oracle…", 16, FontStyle.Italic, new Color(0.60f, 0.62f, 0.68f), TextAnchor.MiddleLeft);
        UIKit.Stretch(ph.gameObject, 10);

        var input = go.GetComponent<InputField>();
        input.textComponent = text;
        input.placeholder = ph;
        input.lineType = InputField.LineType.SingleLine;
        input.characterLimit = 500;
        return input;
    }

    // ── Context for the model (derived; never birth data) ─────────────────────

    static readonly string[] SuitName = { "Cups", "Swords", "Pentacles", "Wands" };

    static string BuildContext(CelestialPentacleConn conn)
    {
        var fac = OracleAdvisor.MyFaction(conn);
        if (fac == null) return "An unregistered seeker, not yet sworn to a faction.";
        int dom = OracleAdvisor.DominantSuit(conn);
        var seals = CombatPreview.SealedSuits(conn, fac.Value);
        int owned = 0, contested = 0;
        foreach (var z in conn.Conn.Db.Zone.Iter())
        {
            if (z.Owner.HasValue && z.Owner.Value == fac.Value) { owned++; if (z.Control <= OracleAdvisor.RiskBand) contested++; }
        }
        var sealNames = new List<string>();
        foreach (var s in seals) sealNames.Add(SuitName[s]);
        string sealStr = sealNames.Count > 0 ? string.Join("/", sealNames) : "none";
        return $"Faction {FactionData.Names[(int)fac.Value]}; deck leans {SuitName[dom]}; "
             + $"zodiac seals: {sealStr}; holds {owned} zones ({contested} slipping). "
             + "Advise in your oracle voice, briefly.";
    }

    /// Cacheable = a general rules/lore question (shareable answer). Personal,
    /// state-dependent questions are not cached, so no one gets someone else's advice.
    static bool IsCacheable(string q)
    {
        string s = " " + q.ToLowerInvariant() + " ";
        string[] personal = { "should i", " my ", " me ", " i ", "i have", "right now", " mine ", "for me", "i'm", "i am", " we ", " our " };
        foreach (var p in personal) if (s.Contains(p)) return false;
        return true;
    }
}
