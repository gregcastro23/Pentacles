// Pentacles — minimal deck hand stub.
//
// Just enough to compile + log granted cards. Replace with your hand/loadout UI;
// SkyRenderer reads the active deck straight from the synced `card` table, so the
// attack path already works without this.

using SpacetimeDB.Types;
using UnityEngine;

public class DeckUI : MonoBehaviour
{
    public static DeckUI Instance { get; private set; }

    void Awake() => Instance = this;

    public void OnCardGranted(Card card)
    {
        Debug.Log($"[Deck] +{(card.IsTrump ? "TRUMP " : "")}{card.Suit} rank {card.Rank} " +
                  $"(atk {card.Attack} / hp {card.Health})");
    }
}
