// Pentacles — Unity ↔ SpacetimeDB connection manager.
//
// Generate the bindings this file needs from the module dir:
//   cd ../server && spacetime generate --lang csharp \
//       --out-dir ../unity/Assets/Autogen
//
// That emits `DbConnection`, `Reducers`, table row types (Player, Zone,
// StarNode, Card …) and the value types (NatalChart, Placement, Planet,
// Suit, BattleLog) under the `SpacetimeDB.Types` namespace.
//
// Attach to a bootstrap GameObject in your first scene.

using System.Collections.Generic;
using SpacetimeDB;
using SpacetimeDB.Types;
using UnityEngine;

public class CelestialPentacleConn : MonoBehaviour
{
    const string HOST = "wss://maincloud.spacetimedb.com";
    const string DB_NAME = "cookingwithcastrollc";
    const string TOKEN_KEY = "stdb.token";

    public static CelestialPentacleConn Instance { get; private set; }
    public DbConnection Conn { get; private set; }
    public Identity LocalIdentity { get; private set; }
    public bool IsConnected { get; private set; }

    void Awake()
    {
        Instance = this;
        DontDestroyOnLoad(gameObject);
    }

    void Start()
    {
        var builder = DbConnection.Builder()
            .WithUri(HOST)
            .WithModuleName(DB_NAME)
            .OnConnect(HandleConnect)
            .OnConnectError(HandleConnectError)
            .OnDisconnect(HandleDisconnect);

        var token = PlayerPrefs.GetString(TOKEN_KEY, "");
        if (!string.IsNullOrEmpty(token))
            builder = builder.WithToken(token);

        Conn = builder.Build();
    }

    // CRITICAL: advance the connection every frame, or no updates/callbacks arrive.
    void Update() => Conn?.FrameTick();

    void HandleConnect(DbConnection conn, Identity identity, string token)
    {
        LocalIdentity = identity;
        IsConnected = true;
        PlayerPrefs.SetString(TOKEN_KEY, token);
        Debug.Log($"[STDB] Connected as {identity}");

        // The whole sky is public state — subscribe and let it cache locally.
        conn.SubscriptionBuilder()
            .OnApplied(_ => Debug.Log("[STDB] Sky state applied"))
            .SubscribeToAllTables();

        // React to the live war.
        conn.Db.StarNode.OnUpdate += (_, oldS, newS) =>
        {
            if (!Equals(oldS.HeldBy, newS.HeldBy))
                SkyRenderer.Instance?.OnStarCaptured(newS);
        };
        conn.Db.Zone.OnUpdate += (_, _, zone) => SkyRenderer.Instance?.OnZoneChanged(zone);
        conn.Db.Card.OnInsert += (_, card) => DeckPanel.Instance?.OnCardGranted(card);
    }

    void HandleConnectError(System.Exception e) =>
        Debug.LogError($"[STDB] Connect error: {e.Message}");

    void HandleDisconnect(DbConnection _, System.Exception e)
    {
        IsConnected = false;
        Debug.LogWarning($"[STDB] Disconnected: {e?.Message}");
    }

    // ----- Reducer calls (names are PascalCase of the Rust reducer fns) -----

    // The chart is computed client-side from real birth input, then committed.
    public void CreatePlayer(string handle, NatalChart chart, Planet faction) =>
        Conn.Reducers.CreatePlayer(handle, chart, faction);

    public void AttackStar(uint hipId, List<ulong> playedCardIds) =>
        Conn.Reducers.ResolveStarBattle(hipId, new BattleLog
        {
            Model = CombatModel.AutoSiege,
            Plays = playedCardIds,
        });

    public void EnqueueDuel(byte zoneId) => Conn.Reducers.EnqueueDuel(zoneId);

    public void CommitDuel(ulong duelId, ulong lane0, ulong lane1, ulong lane2) =>
        Conn.Reducers.CommitDuel(duelId, lane0, lane1, lane2);

    // Claim a stalled duel whose opponent never committed. The binding appears
    // after you re-run `spacetime generate` for the new claim_duel_timeout reducer.
    public void ClaimDuelTimeout(ulong duelId) => Conn.Reducers.ClaimDuelTimeout(duelId);

    // Report your real-world location (private); gates which stars are engageable.
    // Binding appears after `spacetime generate` for the new set_location reducer.
    public void SetLocation(double lat, double lon) => Conn.Reducers.SetLocation(lat, lon);

    // Move a card between loadouts (Active capped at 8). Binding appears after
    // `spacetime generate` for the new set_loadout reducer.
    public void SetLoadout(ulong cardId, Loadout loadout) => Conn.Reducers.SetLoadout(cardId, loadout);

    // Fuse two copies of the same card; the kept one levels up (diminishing
    // returns). Binding appears after `spacetime generate` for combine_cards.
    public void CombineCards(ulong keepId, ulong consumeId) =>
        Conn.Reducers.CombineCards(keepId, consumeId);

    // Confirmed two-way trades: propose (stake your offer + name what you want
    // from partner), then both confirm. Bindings appear after `spacetime generate`.
    public void ProposeTrade(Identity partner, List<ulong> offer, List<ulong> request) =>
        Conn.Reducers.ProposeTrade(partner, offer, request);
    public void ConfirmTrade(ulong tradeId) => Conn.Reducers.ConfirmTrade(tradeId);
    public void CancelTrade(ulong tradeId) => Conn.Reducers.CancelTrade(tradeId);

    // Ask the Oracle a free-text question; the companion service answers via the
    // oracle_reply table. `context` is a derived summary (no birth data). Binding
    // appears after `spacetime generate` for ask_oracle.
    public void AskOracle(string question, string context, bool cacheable) =>
        Conn.Reducers.AskOracle(question, context, cacheable);
}
