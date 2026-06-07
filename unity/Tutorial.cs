// Pentacles — the Oracle-narrated first-run walkthrough.
//
// On your first session (once you're registered and the deck exists), the Oracle
// narrates a short, skippable sequence: the board, your chart-deck, the rotating
// weather, your first strike, and how to ask for help. Shown once (a PlayerPrefs
// flag), and replayable from the codex.

using UnityEngine;
using UnityEngine.UI;

public class Tutorial : MonoBehaviour
{
    public static Tutorial Instance { get; private set; }
    const string DoneKey = "oracle.tutorial.done";

    static readonly string[] Steps =
    {
        "Welcome, seeker. I am the Oracle. The night above you is the board — eleven zones spun from the stars, and the ten planets are the factions at war.",
        "Your birth-chart became your deck: every card minted from a placement in your sky. No two of the same card are alike — meet them under ✦ Cards.",
        "The sky sets the weather. The sign rising over a zone favors its element's suit and weakens the opposite — and it turns in real time. Strike where the weather lifts your hand.",
        "Raise your eyes: a star must climb past ten degrees before you can take it. Tap a risen star, field your Active cards, and strike. Win, and the sky mints you a card of that very moment.",
        "I keep watch and will whisper when the wheel turns — and you may ask me anything with ✦ Oracle. The casting is yours. Go well.",
    };

    int _step;
    bool _done, _showing;
    GameObject _modal;
    Text _body, _next;

    void Awake() => Instance = this;
    void Start() => _done = PlayerPrefs.GetInt(DoneKey, 0) == 1;

    void Update()
    {
        if (_done || _showing) return;
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected) return;
        if (OracleAdvisor.MyFaction(conn) == null) return; // wait until you have a chart/deck
        Begin();
    }

    public void Replay() { _done = false; Begin(); }

    void Begin()
    {
        if (_showing) return;
        _showing = true; _step = 0;
        Build();
        Render();
    }

    void Build()
    {
        var canvas = UIKit.Canvas("TutorialCanvas", 140);
        _modal = canvas;
        var bg = UIKit.Box(canvas.transform, new Color(0.02f, 0.02f, 0.04f, 0.9f));
        UIKit.Stretch(bg.gameObject, 0);

        var card = new GameObject("Card",
            typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
        card.transform.SetParent(canvas.transform, false);
        var rt = (RectTransform)card.transform;
        rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(0.5f, 0.5f);
        rt.sizeDelta = new Vector2(820, 0);
        card.GetComponent<Image>().color = new Color(0.06f, 0.07f, 0.12f, 0.99f);
        var v = card.GetComponent<VerticalLayoutGroup>();
        v.padding = new RectOffset(30, 30, 28, 24); v.spacing = 16;
        v.childControlWidth = v.childControlHeight = true; v.childForceExpandWidth = true;
        card.GetComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;

        UIKit.Label(card.transform, "✦ The Oracle", 24, FontStyle.Bold, new Color(0.95f, 0.86f, 0.63f));
        _body = UIKit.Label(card.transform, "", 19, FontStyle.Normal, new Color(0.92f, 0.92f, 0.94f), TextAnchor.UpperLeft);

        var row = new GameObject("Row", typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(LayoutElement));
        row.transform.SetParent(card.transform, false);
        var h = row.GetComponent<HorizontalLayoutGroup>();
        h.spacing = 12; h.childControlWidth = h.childControlHeight = true; h.childForceExpandWidth = true;
        row.GetComponent<LayoutElement>().minHeight = 50;
        UIKit.Button(row.transform, "Skip", Finish, 16, new Color(0.30f, 0.30f, 0.40f, 0.5f));
        _next = UIKit.Button(row.transform, "Next", Advance, 16, new Color(0.50f, 0.42f, 0.30f, 0.6f))
            .GetComponentInChildren<Text>();
    }

    void Render()
    {
        if (_body != null) _body.text = Steps[_step];
        if (_next != null) _next.text = _step >= Steps.Length - 1 ? "Begin" : "Next";
    }

    void Advance()
    {
        if (_step >= Steps.Length - 1) { Finish(); return; }
        _step++; Render();
    }

    void Finish()
    {
        _done = true; _showing = false;
        PlayerPrefs.SetInt(DoneKey, 1); PlayerPrefs.Save();
        if (_modal != null) Destroy(_modal);
        _modal = null;
    }
}
