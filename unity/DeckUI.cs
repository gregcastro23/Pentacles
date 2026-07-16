// Pentacles — optional IMGUI zodiac dashboard, standings leaderboard, and deck management.
//
// Attach to a GameObject in your main scene. Provides a floating button in the
// top-left to toggle a gorgeous glassmorphic HUD overlay.

using System.Collections.Generic;
using UnityEngine;
using SpacetimeDB.Types;

public class DeckUI : MonoBehaviour
{
    public static DeckUI Instance { get; private set; }

    bool _showDashboard = false;
    Vector2 _deckScrollPos = Vector2.zero;
    Vector2 _standingsScrollPos = Vector2.zero;

    // GUI Styles
    GUIStyle _windowStyle;
    GUIStyle _headerStyle;
    GUIStyle _textStyle;
    GUIStyle _boldTextStyle;
    GUIStyle _buttonActiveStyle;
    GUIStyle _buttonNormalStyle;
    GUIStyle _panelBgStyle;

    void Awake()
    {
        Instance = this;
    }

    void OnGUI()
    {
        var conn = CelestialPentacleConn.Instance;
        if (conn == null || !conn.IsConnected) return;

        InitStyles();

        // 1. Floating Toggle Button
        if (GUI.Button(new Rect(16, 16, 180, 36), _showDashboard ? "✕ Close Zodiac Dashboard" : "✦ Open Zodiac Dashboard", _showDashboard ? _buttonActiveStyle : _buttonNormalStyle))
        {
            _showDashboard = !_showDashboard;
        }

        if (!_showDashboard) return;

        // Draw a glassmorphic background dim overlay
        GUI.Box(new Rect(0, 0, Screen.width, Screen.height), "", _panelBgStyle);

        // Compute Standings and Counts dynamically
        int[] factionScores = new int[10];
        int[] factionZones = new int[10];
        foreach (var z in conn.Conn.Db.Zone.Iter())
        {
            if (z.Owner.HasValue)
            {
                int pIdx = (int)z.Owner.Value;
                int weight = z.Kind == ZoneKind.House ? 1 : (z.Kind == ZoneKind.Spire ? 2 : 3);
                factionScores[pIdx] += weight;
                factionZones[pIdx]++;
            }
        }

        // Fetch Player
        var me = conn.Conn.Db.Player.Identity.Find(conn.LocalIdentity);
        string myFactionName = me != null ? FactionData.Names[(int)me.Faction] : "None";

        // Fetch Cards and Slots
        int activeCount = 0;
        int defenseCount = 0;
        var myCards = new List<(Card card, DeckSlot slot)>();
        foreach (var slot in conn.Conn.Db.DeckSlot.Iter())
        {
            if (slot.Owner.Equals(conn.LocalIdentity))
            {
                var card = conn.Conn.Db.Card.CardId.Find(slot.CardId);
                if (card != null)
                {
                    myCards.Add((card, slot));
                    if (slot.Loadout == Loadout.Active) activeCount++;
                    if (slot.Loadout == Loadout.Defense) defenseCount++;
                }
            }
        }

        // Layout three columns/panels inside a main area
        GUILayout.BeginArea(new Rect(24, 70, Screen.width - 48, Screen.height - 94));
        GUILayout.BeginHorizontal();

        // --- PANEL 1: GREAT WHEEL & SKY STATUS ---
        GUILayout.BeginVertical(new GUIStyle(GUI.skin.box) { margin = new RectOffset(10, 10, 10, 10), padding = new RectOffset(15, 15, 15, 15) }, GUILayout.Width(300), GUILayout.ExpandHeight(true));
        GUILayout.Label("✦ THE GREAT WHEEL ✦", _headerStyle);
        GUILayout.Space(15);

        var cfg = conn.Conn.Db.GameConfig.Id.Find((byte)0);
        int seasonDeg = cfg != null ? cfg.SeasonDegree : 0;
        int activeSign = (seasonDeg / 30) % 12;
        int activeIngressZone = activeSign % 11;

        GUILayout.Label($"Season Degree: {seasonDeg}° / 360°", _boldTextStyle);
        GUILayout.Label($"Active Zodiac: {FactionData.Glyphs[activeSign % 10]} {ZodiacSignName(activeSign)}", _textStyle);
        GUILayout.Label($"Ingress Buff Zone: Zone {activeIngressZone} (2x delta)", _textStyle);
        GUILayout.Space(15);
        GUILayout.Box("", GUILayout.Height(1), GUILayout.ExpandWidth(true));
        GUILayout.Space(15);

        GUILayout.Label("✦ YOUR IDENTITY ✦", _headerStyle);
        GUILayout.Space(10);
        if (me != null)
        {
            GUILayout.Label($"Handle: {me.Handle}", _textStyle);
            GUILayout.Label($"Faction: {FactionData.Glyphs[(int)me.Faction]} {FactionData.Names[(int)me.Faction]}", _boldTextStyle);
        }
        else
        {
            GUILayout.Label("Status: Unregistered Seeker", _textStyle);
        }
        GUILayout.EndVertical();

        // --- PANEL 2: STANDINGS LEADERBOARD ---
        GUILayout.BeginVertical(new GUIStyle(GUI.skin.box) { margin = new RectOffset(10, 10, 10, 10), padding = new RectOffset(15, 15, 15, 15) }, GUILayout.Width(340), GUILayout.ExpandHeight(true));
        GUILayout.Label("✦ FACTION LEADERBOARD ✦", _headerStyle);
        GUILayout.Space(15);

        _standingsScrollPos = GUILayout.BeginScrollView(_standingsScrollPos, GUILayout.ExpandWidth(true), GUILayout.ExpandHeight(true));

        var sortedFactions = new List<int>();
        for (int i = 0; i < 10; i++) sortedFactions.Add(i);
        sortedFactions.Sort((a, b) => factionScores[b].CompareTo(factionScores[a]));

        for (int i = 0; i < sortedFactions.Count; i++)
        {
            int fIdx = sortedFactions[i];
            bool isMe = me != null && (int)me.Faction == fIdx;
            string highlight = isMe ? " ▸ " : "   ";
            string text = $"{highlight}#{i + 1}  {FactionData.Glyphs[fIdx]} {FactionData.Names[fIdx].PadRight(8)}  {factionScores[fIdx]} pts ({factionZones[fIdx]} zones)";
            
            if (isMe)
                GUILayout.Label(text, _boldTextStyle);
            else
                GUILayout.Label(text, _textStyle);
        }

        GUILayout.Space(20);
        GUILayout.Label("✦ ZONE WEATHER & LOCKS ✦", _headerStyle);
        GUILayout.Space(10);
        for (byte zId = 0; zId < 11; zId++)
        {
            var zone = conn.Conn.Db.Zone.ZoneId.Find(zId);
            string zoneName = zId < 5 ? $"House {zId}" : (zId < 10 ? $"Spire {zId}" : "Crown");
            string ownerStr = "Uncontrolled";
            if (zone != null && zone.Owner.HasValue)
            {
                int fIdx = (int)zone.Owner.Value;
                ownerStr = $"{FactionData.Glyphs[fIdx]} {FactionData.Names[fIdx]} ({zone.Control})";
            }
            
            bool hasAccess = me == null || BattlePanel.CanAccessZone(conn, me.Faction, zId);
            string lockPrefix = hasAccess ? "  " : "🔒 ";
            string weatherStr = CombatPreview.SkyWeatherForZone(conn, zId);
            
            GUILayout.Label($"{lockPrefix}{zoneName}: {ownerStr}\n    Sky: {weatherStr}", _textStyle);
            GUILayout.Space(5);
        }

        GUILayout.EndScrollView();
        GUILayout.EndVertical();

        // --- PANEL 3: DECK & SENTINEL MANAGEMENT ---
        GUILayout.BeginVertical(new GUIStyle(GUI.skin.box) { margin = new RectOffset(10, 10, 10, 10), padding = new RectOffset(15, 15, 15, 15) }, GUILayout.ExpandWidth(true), GUILayout.ExpandHeight(true));
        GUILayout.BeginHorizontal();
        GUILayout.Label("✦ DECK MANAGEMENT ✦", _headerStyle);
        GUILayout.FlexibleSpace();
        GUILayout.Label($"Active Slots: {activeCount}/8  ·  Defense Slots: {defenseCount}/8", _boldTextStyle);
        GUILayout.EndHorizontal();
        GUILayout.Space(15);

        _deckScrollPos = GUILayout.BeginScrollView(_deckScrollPos, GUILayout.ExpandWidth(true), GUILayout.ExpandHeight(true));

        foreach (var c in myCards)
        {
            GUILayout.BeginHorizontal(GUI.skin.box);
            string suitGlyph = c.card.Suit == Suit.Cups ? "♥" : (c.card.Suit == Suit.Swords ? "♠" : (c.card.Suit == Suit.Pentacles ? "♦" : "♣"));
            string cardTitle = $"{(c.card.IsMajor ? "Major - " : "")}{suitGlyph} {RankName(c.card.Rank)}";
            string statsText = $"(Atk: {c.card.Attack} / HP: {c.card.Health} / Arm: {c.card.Armour})";

            GUILayout.Label(cardTitle.PadRight(18) + statsText, _textStyle);
            GUILayout.FlexibleSpace();

            // Loadout Actions
            if (c.slot.Loadout == Loadout.Active)
            {
                GUILayout.Label("[Active]", _boldTextStyle, GUILayout.Width(70));
                if (GUILayout.Button("Bench", GUILayout.Width(70)))
                {
                    conn.SetLoadout(c.card.CardId, Loadout.Bench);
                }
            }
            else if (c.slot.Loadout == Loadout.Defense)
            {
                GUILayout.Label("[Defense]", _boldTextStyle, GUILayout.Width(70));
                if (GUILayout.Button("Bench", GUILayout.Width(70)))
                {
                    conn.SetLoadout(c.card.CardId, Loadout.Bench);
                }
            }
            else // Bench
            {
                if (GUILayout.Button("Active", GUILayout.Width(70)))
                {
                    if (activeCount < 8)
                        conn.SetLoadout(c.card.CardId, Loadout.Active);
                    else
                        Debug.LogWarning("Active slots are full (max 8)!");
                }
                if (GUILayout.Button("Defense", GUILayout.Width(70)))
                {
                    if (defenseCount < 8)
                        conn.SetLoadout(c.card.CardId, Loadout.Defense);
                    else
                        Debug.LogWarning("Defense slots are full (max 8)!");
                }
            }

            GUILayout.EndHorizontal();
        }

        GUILayout.EndScrollView();
        GUILayout.EndVertical();

        GUILayout.EndHorizontal();
        GUILayout.EndArea();
    }

    void InitStyles()
    {
        if (_windowStyle != null) return;

        // Colors
        Color gold = new Color(0.85f, 0.71f, 0.42f);
        Color textColor = new Color(0.85f, 0.86f, 0.92f);
        Color darkBg = new Color(0.04f, 0.05f, 0.09f, 0.95f);

        _panelBgStyle = new GUIStyle(GUI.skin.box);
        _panelBgStyle.normal.background = MakeTex(2, 2, new Color(0, 0, 0, 0.4f));

        _windowStyle = new GUIStyle(GUI.skin.window);
        _windowStyle.normal.background = MakeTex(2, 2, darkBg);
        _windowStyle.normal.textColor = textColor;

        _headerStyle = new GUIStyle(GUI.skin.label)
        {
            fontSize = 17,
            fontStyle = FontStyle.Bold,
            alignment = TextAnchor.MiddleCenter
        };
        _headerStyle.normal.textColor = gold;

        _textStyle = new GUIStyle(GUI.skin.label)
        {
            fontSize = 14,
            alignment = TextAnchor.MiddleLeft
        };
        _textStyle.normal.textColor = textColor;

        _boldTextStyle = new GUIStyle(_textStyle)
        {
            fontStyle = FontStyle.Bold
        };
        _boldTextStyle.normal.textColor = gold;

        _buttonNormalStyle = new GUIStyle(GUI.skin.button)
        {
            fontSize = 13,
            fontStyle = FontStyle.Bold
        };
        _buttonNormalStyle.normal.textColor = textColor;
        _buttonNormalStyle.normal.background = MakeTex(2, 2, new Color(0.12f, 0.14f, 0.22f, 0.9f));

        _buttonActiveStyle = new GUIStyle(_buttonNormalStyle);
        _buttonActiveStyle.normal.textColor = gold;
        _buttonActiveStyle.normal.background = MakeTex(2, 2, new Color(0.25f, 0.22f, 0.15f, 0.95f));
    }

    Texture2D MakeTex(int width, int height, Color col)
    {
        Color[] pix = new Color[width * height];
        for (int i = 0; i < pix.Length; i++) pix[i] = col;
        Texture2D result = new Texture2D(width, height);
        result.SetPixels(pix);
        result.Apply();
        return result;
    }

    static string ZodiacSignName(int sign) => sign switch
    {
        0 => "Aries", 1 => "Taurus", 2 => "Gemini", 3 => "Cancer", 4 => "Leo", 5 => "Virgo",
        6 => "Libra", 7 => "Scorpio", 8 => "Sagittarius", 9 => "Capricorn", 10 => "Aquarius", _ => "Pisces"
    };

    static string RankName(byte r) => r switch
    { 1 => "Ace", 11 => "Page", 12 => "Knight", 13 => "Queen", 14 => "King", _ => r.ToString() };
}
