// Pentacles — tiny programmatic-uGUI helper shared by the deck/battle screens.
// Legacy UnityEngine.UI for zero-package compatibility; swap to TMP if you like.

using UnityEngine;
using UnityEngine.Events;
using UnityEngine.EventSystems;
using UnityEngine.UI;

public static class UIKit
{
    static Font _font;
    public static Font Font
    {
        get
        {
            if (_font == null)
            {
                try { _font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf"); }
                catch { _font = UnityEngine.Font.CreateDynamicFontFromOSFont("Arial", 16); }
            }
            return _font;
        }
    }

    public static void EnsureEventSystem()
    {
        if (Object.FindObjectOfType<EventSystem>() == null)
            new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
    }

    public static GameObject Canvas(string name, int sort)
    {
        var go = new GameObject(name, typeof(Canvas), typeof(CanvasScaler), typeof(GraphicRaycaster));
        var c = go.GetComponent<Canvas>();
        c.renderMode = RenderMode.ScreenSpaceOverlay;
        c.sortingOrder = sort;
        var s = go.GetComponent<CanvasScaler>();
        s.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        s.referenceResolution = new Vector2(1080, 1920);
        EnsureEventSystem();
        return go;
    }

    public static Text Label(Transform p, string s, int size, FontStyle style,
        Color? col = null, TextAnchor anchor = TextAnchor.MiddleCenter, bool shadow = false)
    {
        var go = new GameObject("Label", typeof(RectTransform));
        go.transform.SetParent(p, false);
        var t = go.AddComponent<Text>();
        t.font = Font; t.text = s; t.fontSize = size; t.fontStyle = style;
        t.color = col ?? new Color(0.93f, 0.91f, 0.88f);
        t.alignment = anchor;
        t.horizontalOverflow = HorizontalWrapMode.Wrap;
        t.verticalOverflow = VerticalWrapMode.Truncate;
        t.raycastTarget = false;
        if (shadow)
        {
            var sh = go.AddComponent<Shadow>();
            sh.effectColor = new Color(0f, 0f, 0f, 0.75f);
            sh.effectDistance = new Vector2(1.5f, -1.5f);
        }
        return t;
    }

    public static Button Button(Transform p, string label, UnityAction onClick, int size = 16, Color? tint = null)
    {
        var go = new GameObject("Button", typeof(RectTransform), typeof(Image), typeof(Button), typeof(LayoutElement));
        go.transform.SetParent(p, false);
        go.GetComponent<Image>().color = tint ?? new Color(0.85f, 0.71f, 0.42f, 0.22f);
        go.GetComponent<LayoutElement>().minHeight = 44;
        var t = Label(go.transform, label, size, FontStyle.Bold, new Color(0.95f, 0.86f, 0.63f));
        Stretch(t.gameObject, 8);
        go.GetComponent<Button>().onClick.AddListener(onClick);
        return go.GetComponent<Button>();
    }

    public static Image Box(Transform p, Color col)
    {
        var go = new GameObject("Box", typeof(RectTransform), typeof(Image));
        go.transform.SetParent(p, false);
        go.GetComponent<Image>().color = col;
        return go.GetComponent<Image>();
    }

    public static Image Divider(Transform p, Color col, int height = 1)
    {
        var img = Box(p, col);
        var le = img.gameObject.AddComponent<LayoutElement>();
        le.minHeight = le.preferredHeight = height;
        return img;
    }

    public static void Stretch(GameObject go, float pad)
    {
        var rt = (RectTransform)go.transform;
        rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
        rt.offsetMin = new Vector2(pad, pad); rt.offsetMax = new Vector2(-pad, -pad);
    }
}
