// Pentacles — contextual tooltip popups, woven from the Oracle's lore.
//
// A self-creating layer (like Toast) that shows an authored blurb on demand —
// e.g. long-press a card to learn what it is — with an "Ask the Oracle ›" button
// that escalates to live chat. Tap the backdrop or Close to dismiss.

using UnityEngine;
using UnityEngine.UI;
using SpacetimeDB.Types;

public class Tooltip : MonoBehaviour
{
    static Tooltip _instance;
    GameObject _current;

    static void Ensure()
    {
        if (_instance != null) return;
        var go = new GameObject("Tooltip");
        DontDestroyOnLoad(go);
        _instance = go.AddComponent<Tooltip>();
    }

    /// Show an authored blurb for a concept id (from OracleLore.Concept).
    public static void ShowConcept(string title, string conceptKey) =>
        Show(title, OracleLore.Tip(conceptKey) ?? "");

    public static void ShowForCard(Card c) => Show(CardTitle(c), CardBody(c));

    public static void Show(string title, string body)
    {
        if (string.IsNullOrEmpty(body)) return;
        Ensure();
        _instance.Spawn(title, body);
    }

    void Spawn(string title, string body)
    {
        if (_current != null) Destroy(_current);
        var canvas = UIKit.Canvas("TooltipCanvas", 150);
        _current = canvas;

        var bg = new GameObject("Backdrop", typeof(RectTransform), typeof(Image), typeof(Button));
        bg.transform.SetParent(canvas.transform, false);
        bg.GetComponent<Image>().color = new Color(0.01f, 0.01f, 0.02f, 0.55f);
        UIKit.Stretch(bg, 0);
        bg.GetComponent<Button>().onClick.AddListener(Dismiss);

        var card = new GameObject("Card",
            typeof(RectTransform), typeof(Image), typeof(VerticalLayoutGroup), typeof(ContentSizeFitter));
        card.transform.SetParent(canvas.transform, false);
        var rt = (RectTransform)card.transform;
        rt.anchorMin = rt.anchorMax = rt.pivot = new Vector2(0.5f, 0.5f);
        rt.sizeDelta = new Vector2(760, 0);
        card.GetComponent<Image>().color = new Color(0.06f, 0.07f, 0.11f, 0.99f);
        var v = card.GetComponent<VerticalLayoutGroup>();
        v.padding = new RectOffset(24, 24, 20, 20); v.spacing = 12;
        v.childControlWidth = v.childControlHeight = true; v.childForceExpandWidth = true;
        var f = card.GetComponent<ContentSizeFitter>();
        f.verticalFit = ContentSizeFitter.FitMode.PreferredSize;
        f.horizontalFit = ContentSizeFitter.FitMode.Unconstrained;

        UIKit.Label(card.transform, title, 22, FontStyle.Bold, new Color(0.95f, 0.86f, 0.63f), TextAnchor.MiddleLeft);
        UIKit.Label(card.transform, body, 17, FontStyle.Normal, new Color(0.90f, 0.90f, 0.92f), TextAnchor.UpperLeft);

        var row = new GameObject("Row", typeof(RectTransform), typeof(HorizontalLayoutGroup), typeof(LayoutElement));
        row.transform.SetParent(card.transform, false);
        var h = row.GetComponent<HorizontalLayoutGroup>();
        h.spacing = 10; h.childControlWidth = h.childControlHeight = true; h.childForceExpandWidth = true;
        row.GetComponent<LayoutElement>().minHeight = 46;
        UIKit.Button(row.transform, "Ask the Oracle ›", () => { Dismiss(); OraclePanel.Instance?.Open(); }, 15,
            new Color(0.50f, 0.40f, 0.66f, 0.5f));
        UIKit.Button(row.transform, "Close", Dismiss, 15, new Color(0.30f, 0.30f, 0.40f, 0.5f));
    }

    void Dismiss()
    {
        if (_current != null) Destroy(_current);
        _current = null;
    }

    // ── Card descriptions, woven from the lore ───────────────────────────────

    static readonly string[] SuitName = { "Cups", "Swords", "Pentacles", "Wands" };
    static readonly string[] Element = { "Water", "Air", "Earth", "Fire" };

    static string CardTitle(Card c) =>
        c.IsTrump ? CombatPreview.MajorName(c.Rank) + "  ✦" : $"{Rank(c.Rank)} of {SuitName[(int)c.Suit]}";

    static string CardBody(Card c)
    {
        string what = c.IsTrump
            ? "A planetary trump — a Major Arcana a tier above the pips, suited by its planet."
            : c.Rank == 1 ? "An Ace — your chart ruler's card, the root of its suit."
            : c.Rank >= 11 ? "A court card — a body dignified enough to be elevated."
            : "A pip — its rank drawn from the decan of the degree that minted it.";
        string elem = $" Its suit is {SuitName[(int)c.Suit]} ({Element[(int)c.Suit]}); the sky lifts it when that element rises.";
        string body = what + elem + " " + OracleLore.Tip("mint");
        if (c.Inverted) body += " It was born retrograde — read it reversed.";
        if (c.Level > 1) body += " " + OracleLore.Tip("level");
        return body;
    }

    static string Rank(byte r) => r switch
    {
        1 => "Ace", 11 => "Page", 12 => "Knight", 13 => "Queen", 14 => "King", _ => r.ToString(),
    };
}
