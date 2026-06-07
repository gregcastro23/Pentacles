// Pentacles — lightweight on-screen notices.
//
// A self-creating toast layer: anything can call Toast.Show("…") without wiring
// a component in the scene. Used to surface the feedback that would otherwise be
// invisible — the Active-loadout cap, the GPS fallback, etc.

using System.Collections;
using UnityEngine;
using UnityEngine.UI;

public class Toast : MonoBehaviour
{
    static Toast _instance;
    Transform _stack;

    /// Flash a transient message near the top of the screen.
    public static void Show(string message, float seconds = 3f)
    {
        if (string.IsNullOrEmpty(message)) return;
        Ensure();
        _instance.Spawn(message, seconds);
    }

    static void Ensure()
    {
        if (_instance != null) return;
        var go = new GameObject("Toast");
        DontDestroyOnLoad(go);
        _instance = go.AddComponent<Toast>();
        _instance.Build();
    }

    void Build()
    {
        var canvas = UIKit.Canvas("ToastCanvas", 200); // above the gameplay canvases
        var stack = new GameObject("ToastStack",
            typeof(RectTransform), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
        stack.transform.SetParent(canvas.transform, false);
        var rt = (RectTransform)stack.transform;
        rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(0.5f, 1f);
        rt.anchoredPosition = new Vector2(0, -140);
        var vlg = stack.GetComponent<VerticalLayoutGroup>();
        vlg.spacing = 8; vlg.childAlignment = TextAnchor.UpperCenter;
        vlg.childControlWidth = vlg.childControlHeight = true;
        vlg.childForceExpandWidth = vlg.childForceExpandHeight = false;
        var f = stack.GetComponent<ContentSizeFitter>();
        f.horizontalFit = ContentSizeFitter.FitMode.PreferredSize;
        f.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
        _stack = stack.transform;
    }

    void Spawn(string message, float seconds)
    {
        var go = new GameObject("Notice",
            typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup),
            typeof(ContentSizeFitter), typeof(CanvasGroup), typeof(LayoutElement));
        go.transform.SetParent(_stack, false);
        go.GetComponent<Image>().color = new Color(0.05f, 0.06f, 0.10f, 0.92f);

        var vlg = go.GetComponent<VerticalLayoutGroup>();
        vlg.padding = new RectOffset(20, 20, 12, 12);
        vlg.childAlignment = TextAnchor.MiddleCenter;
        vlg.childControlWidth = vlg.childControlHeight = true;
        vlg.childForceExpandWidth = true;

        var f = go.GetComponent<ContentSizeFitter>();
        f.horizontalFit = ContentSizeFitter.FitMode.Unconstrained;
        f.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
        go.GetComponent<LayoutElement>().preferredWidth = 780; // wrap long messages

        UIKit.Label(go.transform, message, 22, FontStyle.Bold);

        StartCoroutine(Life(go.GetComponent<CanvasGroup>(), go, seconds));
    }

    IEnumerator Life(CanvasGroup cg, GameObject go, float seconds)
    {
        cg.alpha = 0f;
        for (float t = 0; t < 0.18f; t += Time.deltaTime) { cg.alpha = t / 0.18f; yield return null; }
        cg.alpha = 1f;
        yield return new WaitForSeconds(seconds);
        for (float t = 0; t < 0.5f; t += Time.deltaTime) { cg.alpha = 1f - t / 0.5f; yield return null; }
        Destroy(go);
    }
}
