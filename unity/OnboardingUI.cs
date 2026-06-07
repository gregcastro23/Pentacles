// Pentacles — drop-in onboarding screen (programmatic uGUI).
//
// Attach to an empty GameObject in your first scene. It builds its own Canvas,
// runs the birth-form → faction-choice → CreatePlayer flow via
// OnboardingController, then fires `onComplete` (and enables `arSceneRoot`).
//
// Restyle freely, or replace with your own editor-built UI — the flow logic
// lives in OnboardingController, not here. Uses legacy UnityEngine.UI for
// zero-package compatibility; swap to TextMeshPro if you prefer.

using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Events;
using UnityEngine.EventSystems;
using UnityEngine.UI;
using SpacetimeDB.Types;

public class OnboardingUI : MonoBehaviour
{
    [Tooltip("Invoked once the player is created on the server.")]
    public UnityEvent onComplete;
    [Tooltip("Optional: enabled on success (e.g. your AR sky rig).")]
    public GameObject arSceneRoot;

    static readonly string[] SignNames =
    {
        "Aries", "Taurus", "Gemini", "Cancer", "Leo", "Virgo",
        "Libra", "Scorpio", "Sagittarius", "Capricorn", "Aquarius", "Pisces",
    };
    static readonly (string name, double lat, double lon, double off)[] Cities =
    {
        ("New York", 40.7128, -74.0060, -5), ("London", 51.5074, -0.1278, 0),
        ("Los Angeles", 34.0522, -118.2437, -8), ("Tokyo", 35.6762, 139.6503, 9),
        ("Sydney", -33.8688, 151.2093, 10), ("São Paulo", -23.5505, -46.6333, -3),
    };

    readonly OnboardingController _ctl = new();
    Font _font;
    GameObject _root, _formPanel, _factionPanel;
    InputField _handle, _date, _time, _lat, _lon, _off;
    Toggle _timeUnknown;
    Text _status;

    void Start()
    {
        _font = TryFont();
        EnsureEventSystem();
        BuildCanvas();
        BuildForm();

        _ctl.FactionsReady += ShowFactions;
        _ctl.PlayerCreated += OnCreated;
        _ctl.Error += msg => SetStatus(msg, new Color(1f, 0.5f, 0.5f));
    }

    // ── Flow ──────────────────────────────────────────────────────────────

    void OnCalculate()
    {
        if (!TryDate(_date.text, out int y, out int mo, out int d) || mo < 1 || mo > 12 || d < 1 || d > 31)
        { SetStatus("Birth date must be YYYY-MM-DD.", Color.yellow); return; }
        int hh = 12, mm = 0;
        if (_timeUnknown.isOn == false && !TryTime(_time.text, out hh, out mm))
        { SetStatus("Birth time must be HH:MM (or tick 'time unknown').", Color.yellow); return; }

        _ctl.Submit(new OnboardingController.BirthInput
        {
            handle = _handle.text,
            year = y, month = mo, day = d, hour = hh, minute = mm,
            timeKnown = !_timeUnknown.isOn,
            lat = ParseD(_lat.text), lon = ParseD(_lon.text), utcOffsetHours = ParseD(_off.text),
        });
    }

    void ShowFactions(NatalChart chart, int[] top3)
    {
        _formPanel.SetActive(false);
        if (_factionPanel != null) Destroy(_factionPanel);
        _factionPanel = Panel();

        int sunSign = 4, ascSign = (chart.Ascendant / 1800) % 12;
        foreach (var p in chart.Placements) if (p.Body == Planet.Sun) sunSign = p.Sign;

        Label(_factionPanel.transform, "Your chart favours three powers", 24, FontStyle.Bold);
        Label(_factionPanel.transform,
            $"Sun in {SignNames[sunSign]}{(chart.TimeKnown ? $"  ·  Ascendant {SignNames[ascSign]}" : "")}",
            16, FontStyle.Italic);

        foreach (int idx in top3) FactionCard(_factionPanel.transform, idx);
        _status = Label(_factionPanel.transform, "Choose your allegiance.", 14, FontStyle.Normal);
    }

    void OnChoose(int idx)
    {
        SetStatus($"Joining the {FactionData.Names[idx]}…", Color.white);
        _ctl.ChooseFaction(idx);
        StopAllCoroutines();
        StartCoroutine(JoinTimeout());
    }

    IEnumerator JoinTimeout()
    {
        yield return new WaitForSeconds(7f);
        SetStatus("Still joining… check the connection / that the faction is in your top 3.", Color.yellow);
    }

    void OnCreated()
    {
        StopAllCoroutines();
        if (arSceneRoot != null) arSceneRoot.SetActive(true);
        onComplete?.Invoke();
        if (_root != null) _root.SetActive(false);
    }

    // ── UI construction ───────────────────────────────────────────────────

    void BuildForm()
    {
        _formPanel = Panel();
        Label(_formPanel.transform, "✦ Cast Your Chart", 28, FontStyle.Bold);
        Label(_formPanel.transform, "Your birth sky becomes your faction and your deck.", 15, FontStyle.Italic);

        _handle = Field(_formPanel.transform, "Handle (display name)");
        _date = Field(_formPanel.transform, "Birth date — YYYY-MM-DD");
        _time = Field(_formPanel.transform, "Birth time — HH:MM (24h)");
        _timeUnknown = Tog(_formPanel.transform, "Birth time unknown (use noon)");

        Label(_formPanel.transform, "Birthplace", 14, FontStyle.Bold);
        var cityRow = Row(_formPanel.transform);
        foreach (var c in Cities)
        {
            var cc = c;
            Btn(cityRow.transform, c.name, () =>
            {
                _lat.text = cc.lat.ToString("0.0000");
                _lon.text = cc.lon.ToString("0.0000");
                _off.text = cc.off.ToString("0.#");
            }, 12);
        }
        _lat = Field(_formPanel.transform, "Latitude (e.g. 40.7128)", "40.7128");
        _lon = Field(_formPanel.transform, "Longitude (e.g. -74.0060)", "-74.0060");
        _off = Field(_formPanel.transform, "UTC offset hours (e.g. -5)", "-5");

        Btn(_formPanel.transform, "Calculate Chart  →", OnCalculate, 18);
        _status = Label(_formPanel.transform, "", 14, FontStyle.Normal);
    }

    void FactionCard(Transform parent, int idx)
    {
        var go = new GameObject($"faction:{FactionData.Names[idx]}", typeof(RectTransform), typeof(Image), typeof(Button), typeof(VerticalLayoutGroup), typeof(LayoutElement));
        go.transform.SetParent(parent, false);
        var col = FactionData.Colors[idx];
        go.GetComponent<Image>().color = new Color(col.r, col.g, col.b, 0.16f);
        var le = go.GetComponent<LayoutElement>(); le.minHeight = 96; le.minWidth = 520;
        var vlg = go.GetComponent<VerticalLayoutGroup>();
        vlg.padding = new RectOffset(16, 16, 12, 12); vlg.spacing = 2; vlg.childControlWidth = true; vlg.childForceExpandWidth = true;
        Label(go.transform, $"{FactionData.Glyphs[idx]}  {FactionData.Names[idx]}", 22, FontStyle.Bold, col);
        Label(go.transform, FactionData.Roles[idx], 12, FontStyle.Bold);
        Label(go.transform, FactionData.Doctrines[idx], 13, FontStyle.Normal);
        go.GetComponent<Button>().onClick.AddListener(() => OnChoose(idx));
    }

    void BuildCanvas()
    {
        _root = new GameObject("OnboardingCanvas", typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        var canvas = _root.GetComponent<Canvas>();
        canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        var scaler = _root.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(1080, 1920);
        var bg = new GameObject("BG", typeof(Image));
        bg.transform.SetParent(_root.transform, false);
        bg.GetComponent<Image>().color = new Color(0.024f, 0.027f, 0.055f, 0.97f);
        Stretch(bg, 0);
    }

    GameObject Panel()
    {
        var go = new GameObject("Panel", typeof(RectTransform), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
        go.transform.SetParent(_root.transform, false);
        var rt = (RectTransform)go.transform;
        rt.anchorMin = new Vector2(0.5f, 0.5f); rt.anchorMax = new Vector2(0.5f, 0.5f); rt.pivot = new Vector2(0.5f, 0.5f);
        var vlg = go.GetComponent<VerticalLayoutGroup>();
        vlg.spacing = 10; vlg.padding = new RectOffset(32, 32, 32, 32);
        vlg.childAlignment = TextAnchor.UpperCenter; vlg.childControlWidth = true; vlg.childControlHeight = true;
        var fitter = go.GetComponent<ContentSizeFitter>();
        fitter.horizontalFit = ContentSizeFitter.FitMode.PreferredSize;
        fitter.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
        return go;
    }

    // ── Widget helpers ────────────────────────────────────────────────────

    Text Label(Transform parent, string s, int size, FontStyle style, Color? color = null)
    {
        var go = new GameObject("Label", typeof(RectTransform));
        go.transform.SetParent(parent, false);
        var t = go.AddComponent<Text>();
        t.font = _font; t.text = s; t.fontSize = size; t.fontStyle = style;
        t.color = color ?? new Color(0.93f, 0.91f, 0.88f);
        t.alignment = TextAnchor.MiddleCenter; t.horizontalOverflow = HorizontalWrapMode.Wrap;
        var le = go.AddComponent<LayoutElement>(); le.minWidth = 520; le.preferredWidth = 520;
        return t;
    }

    InputField Field(Transform parent, string placeholder, string initial = "")
    {
        var go = new GameObject("Field", typeof(RectTransform), typeof(Image), typeof(InputField), typeof(LayoutElement));
        go.transform.SetParent(parent, false);
        go.GetComponent<Image>().color = new Color(1, 1, 1, 0.06f);
        var le = go.GetComponent<LayoutElement>(); le.minHeight = 44; le.minWidth = 520;
        var input = go.GetComponent<InputField>();
        var text = MakeText(go.transform, "", false);
        var ph = MakeText(go.transform, placeholder, true);
        input.textComponent = text; input.placeholder = ph; input.text = initial;
        return input;
    }

    Text MakeText(Transform parent, string s, bool placeholder)
    {
        var go = new GameObject(placeholder ? "Placeholder" : "Text", typeof(RectTransform));
        go.transform.SetParent(parent, false);
        var t = go.AddComponent<Text>();
        t.font = _font; t.text = s; t.fontSize = 16; t.supportRichText = false;
        t.alignment = TextAnchor.MiddleLeft;
        t.color = placeholder ? new Color(1, 1, 1, 0.35f) : Color.white;
        if (placeholder) t.fontStyle = FontStyle.Italic;
        Stretch(go, 10);
        return t;
    }

    Toggle Tog(Transform parent, string label)
    {
        var go = new GameObject("Toggle", typeof(RectTransform), typeof(Toggle), typeof(LayoutElement));
        go.transform.SetParent(parent, false);
        go.GetComponent<LayoutElement>().minHeight = 32;
        var toggle = go.GetComponent<Toggle>();
        var box = new GameObject("Box", typeof(RectTransform), typeof(Image));
        box.transform.SetParent(go.transform, false);
        var brt = (RectTransform)box.transform; brt.anchorMin = new Vector2(0, 0.5f); brt.anchorMax = new Vector2(0, 0.5f);
        brt.sizeDelta = new Vector2(22, 22); brt.anchoredPosition = new Vector2(14, 0);
        box.GetComponent<Image>().color = new Color(1, 1, 1, 0.12f);
        var check = new GameObject("Check", typeof(RectTransform), typeof(Image));
        check.transform.SetParent(box.transform, false); Stretch(check, 4);
        check.GetComponent<Image>().color = new Color(0.85f, 0.71f, 0.42f);
        toggle.graphic = check.GetComponent<Image>(); toggle.targetGraphic = box.GetComponent<Image>(); toggle.isOn = false;
        var t = MakeText(go.transform, label, false); ((RectTransform)t.transform).offsetMin = new Vector2(44, 0);
        return toggle;
    }

    Button Btn(Transform parent, string label, UnityAction onClick, int size)
    {
        var go = new GameObject("Button", typeof(RectTransform), typeof(Image), typeof(Button), typeof(LayoutElement));
        go.transform.SetParent(parent, false);
        go.GetComponent<Image>().color = new Color(0.85f, 0.71f, 0.42f, 0.22f);
        var le = go.GetComponent<LayoutElement>(); le.minHeight = 40; le.preferredHeight = 40;
        var t = MakeText(go.transform, label, false); t.alignment = TextAnchor.MiddleCenter; t.fontSize = size;
        t.color = new Color(0.95f, 0.86f, 0.63f);
        go.GetComponent<Button>().onClick.AddListener(onClick);
        return go.GetComponent<Button>();
    }

    GameObject Row(Transform parent)
    {
        var go = new GameObject("Row", typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(LayoutElement));
        go.transform.SetParent(parent, false);
        var h = go.GetComponent<HorizontalLayoutGroup>();
        h.spacing = 6; h.childForceExpandWidth = true; h.childControlWidth = true; h.childControlHeight = true;
        go.GetComponent<LayoutElement>().minHeight = 34;
        return go;
    }

    void SetStatus(string s, Color c) { if (_status != null) { _status.text = s; _status.color = c; } }

    static void Stretch(GameObject go, float pad)
    {
        var rt = (RectTransform)go.transform;
        rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
        rt.offsetMin = new Vector2(pad, pad); rt.offsetMax = new Vector2(-pad, -pad);
    }

    static bool TryDate(string s, out int y, out int mo, out int d)
    {
        y = mo = d = 0;
        var p = (s ?? "").Split('-');
        return p.Length == 3 && int.TryParse(p[0], out y) && int.TryParse(p[1], out mo) && int.TryParse(p[2], out d);
    }

    static bool TryTime(string s, out int h, out int m)
    {
        h = m = 0;
        var p = (s ?? "").Split(':');
        return p.Length == 2 && int.TryParse(p[0], out h) && int.TryParse(p[1], out m);
    }

    static double ParseD(string s) =>
        double.TryParse(s, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var d) ? d : 0;

    Font TryFont()
    {
        try { return Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); }
        catch { return Font.CreateDynamicFontFromOSFont("Arial", 16); }
    }

    static void EnsureEventSystem()
    {
        if (FindObjectOfType<EventSystem>() == null)
            new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
    }
}
