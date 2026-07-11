// ============================================================
// Pentacles — the 98-tile letter bag (single client source of truth)
// ============================================================
// Mirrors server/src/words.rs::letter_for exactly — a card's letter is derived
// deterministically from its card_id, and the server validates cast_word
// against the same mapping. Any tuning must change words.rs and this file
// together (public/client.js keeps its own copy for the classic script path).

export const LETTER_BAG = [
  ['A', 9], ['B', 2], ['C', 2], ['D', 4], ['E', 12], ['F', 2], ['G', 3], ['H', 2], ['I', 9],
  ['J', 1], ['K', 1], ['L', 4], ['M', 2], ['N', 6], ['O', 8], ['P', 2], ['Q', 1], ['R', 6],
  ['S', 4], ['T', 6], ['U', 4], ['V', 2], ['W', 2], ['X', 1], ['Y', 2], ['Z', 1],
]

export function letterFor(cardId) {
  let n = ((cardId % 98) + 98) % 98
  for (const [ch, c] of LETTER_BAG) {
    if (n < c) return ch
    n -= c
  }
  return 'E'
}
