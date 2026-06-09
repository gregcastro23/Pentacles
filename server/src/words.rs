//! The Lettered Arcana — a Scrabble dictionary, scoring, and a greedy word-finder.
//!
//! Ported from the clockworklabs/scrabblebot bot (the `LETTER_VALUES` table and the
//! `chooseWord` greedy-longest strategy). Powers **Word Duels of the Spheres**: every
//! `card` carries a letter (drawn from the real 98-tile bag by its id), a player spells
//! a Word of Power from the letters across their collection, and a planetary agent
//! answers with its own best word from a sky-seeded rack.
//!
//! The embedded `wordlist.txt` is a curated common-word Codex so the module stays lean
//! and the duel works offline. To use the full ENABLE wordlist (the ~173k-word list
//! scrabblebot ships in `spacetimedb/wordlist.txt`), drop it in over this file — the
//! loader and every consumer below are agnostic to the list's size.

use std::collections::HashSet;
use std::sync::OnceLock;

/// Standard Scrabble tile values, indexed A=0..Z=25.
pub const LETTER_VALUES: [u8; 26] = [
    1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 5, 1, 3, 1, 1, 3, 10, 1, 1, 1, 1, 4, 4, 8, 4, 10,
];

/// The standard 98-tile Scrabble bag (no blanks): (letter, count). Sums to 98.
const BAG: [(u8, u8); 26] = [
    (b'A', 9), (b'B', 2), (b'C', 2), (b'D', 4), (b'E', 12), (b'F', 2), (b'G', 3),
    (b'H', 2), (b'I', 9), (b'J', 1), (b'K', 1), (b'L', 4), (b'M', 2), (b'N', 6),
    (b'O', 8), (b'P', 2), (b'Q', 1), (b'R', 6), (b'S', 4), (b'T', 6), (b'U', 4),
    (b'V', 2), (b'W', 2), (b'X', 1), (b'Y', 2), (b'Z', 1),
];
const BAG_TOTAL: u64 = 98;

/// A card's letter, drawn deterministically from the 98-tile bag by its id — so the
/// distribution of letters across the collection mirrors a real Scrabble bag (common
/// letters appear often, Q/Z/X/J rarely). Stable: a given card always has the same letter.
pub fn letter_for(card_id: u64) -> u8 {
    let mut n = (card_id % BAG_TOTAL) as u8;
    for (ch, count) in BAG {
        if n < count {
            return ch;
        }
        n -= count;
    }
    b'E' // unreachable (BAG sums to BAG_TOTAL), but a safe, common fallback
}

/// Reward length multiplier, matching scrabblebot: 1.0× for ≤3 letters rising to
/// 3.0× for ≥7 — long words pay off far more, the whole point of building a rack.
pub fn length_mult(len: usize) -> f32 {
    match len {
        0..=3 => 1.0,
        4 => 1.5,
        5 => 2.0,
        6 => 2.5,
        _ => 3.0,
    }
}

/// Sum of Scrabble tile values for a word (uppercase A–Z assumed; other bytes ignored).
pub fn base_score(word: &str) -> u32 {
    word.bytes()
        .filter(|b| b.is_ascii_uppercase())
        .map(|b| LETTER_VALUES[(b - b'A') as usize] as u32)
        .sum()
}

/// The reward score for a played word: base tile value × length multiplier, rounded.
pub fn word_score(word: &str) -> u32 {
    (base_score(word) as f32 * length_mult(word.len())).round() as u32
}

/// Per-letter counts of a word (uppercase A–Z), for multiset checks.
fn letter_counts(word: &str) -> [u8; 26] {
    let mut c = [0u8; 26];
    for b in word.bytes() {
        if b.is_ascii_uppercase() {
            c[(b - b'A') as usize] = c[(b - b'A') as usize].saturating_add(1);
        }
    }
    c
}

/// Can the available letters (a per-letter count, e.g. a player's whole collection)
/// spell `word`? A multiset containment check — no tile used more than it's held.
pub fn can_spell(word: &str, have: &[u8; 26]) -> bool {
    let need = letter_counts(word);
    (0..26).all(|i| need[i] <= have[i])
}

/// Is `word` in the Codex? Case-insensitive; rejects anything under two letters.
pub fn is_valid(word: &str) -> bool {
    let w = word.trim().to_ascii_uppercase();
    w.len() >= 2 && w.bytes().all(|b| b.is_ascii_uppercase()) && dict().contains(w.as_str())
}

/// The greedy longest playable word from a letter multiset — the scrabblebot
/// `chooseWord` strategy, used by the planetary-agent opponent. Ties on length are
/// broken by higher base tile value, so the agent plays its strongest long word.
pub fn best_word(have: &[u8; 26]) -> Option<&'static str> {
    dict()
        .iter()
        .copied()
        .filter(|w| can_spell(w, have))
        .max_by(|a, b| {
            a.len()
                .cmp(&b.len())
                .then_with(|| base_score(a).cmp(&base_score(b)))
        })
}

/// Returns the top 25 legal words that can be spelled from the rack,
/// sorted by length and score.
pub fn legal_candidates(have: &[u8; 26]) -> Vec<&'static str> {
    let mut words: Vec<&'static str> = dict()
        .iter()
        .copied()
        .filter(|w| can_spell(w, have))
        .collect();
    words.sort_by(|a, b| {
        b.len()
            .cmp(&a.len())
            .then_with(|| base_score(b).cmp(&base_score(a)))
            .then_with(|| a.cmp(b))
    });
    words.truncate(25);
    words
}

/// The Codex, parsed once from the embedded list into a set of uppercase words.
fn dict() -> &'static HashSet<&'static str> {
    static D: OnceLock<HashSet<&'static str>> = OnceLock::new();
    D.get_or_init(|| {
        include_str!("wordlist.txt")
            .lines()
            .map(|l| l.trim())
            .filter(|l| l.len() >= 2)
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_score_sums_tile_values() {
        assert_eq!(base_score("CAT"), 3 + 1 + 1); // C3 A1 T1
        assert_eq!(base_score("QUARTZ"), 10 + 1 + 1 + 1 + 1 + 10); // Q10 U1 A1 R1 T1 Z10
    }

    #[test]
    fn length_multiplier_rewards_longer_words() {
        assert_eq!(length_mult(2), 1.0);
        assert_eq!(length_mult(3), 1.0);
        assert_eq!(length_mult(4), 1.5);
        assert_eq!(length_mult(5), 2.0);
        assert_eq!(length_mult(6), 2.5);
        assert_eq!(length_mult(7), 3.0);
        assert_eq!(length_mult(9), 3.0);
    }

    #[test]
    fn word_score_applies_the_length_band() {
        assert_eq!(word_score("CAT"), 5); // 5 × 1.0
        assert_eq!(word_score("STAR"), (4f32 * 1.5).round() as u32); // 6
        assert_eq!(word_score("SPELL"), ((1 + 3 + 1 + 1 + 1) as f32 * 2.0).round() as u32); // 14
    }

    #[test]
    fn dictionary_validates_real_words_and_rejects_junk() {
        assert!(is_valid("STAR"));
        assert!(is_valid("spell")); // case-insensitive
        assert!(is_valid("TAROT"));
        assert!(!is_valid("ZZZZ"));
        assert!(!is_valid("Q")); // too short
        assert!(!is_valid("ST4R")); // non-alpha
    }

    #[test]
    fn can_spell_is_a_multiset_check() {
        let have = letter_counts("SPELLAR"); // S P E L L A R
        assert!(can_spell("SPELL", &have)); // needs two Ls, has two
        assert!(can_spell("PEAR", &have));
        assert!(!can_spell("APPLE", &have)); // needs two Ps, has one
        assert!(!can_spell("STARE", &have)); // no T
    }

    #[test]
    fn best_word_finds_the_longest_playable_word() {
        let have = letter_counts("STAREHN"); // can make EARTH, HEART, HASTE-no, STARE…
        let w = best_word(&have).expect("a word should be playable");
        assert!(is_valid(w));
        assert!(can_spell(w, &have));
        assert_eq!(w.len(), 5); // the longest the rack supports here
    }

    #[test]
    fn best_word_is_none_when_nothing_is_playable() {
        let have = [0u8; 26]; // empty rack
        assert!(best_word(&have).is_none());
    }

    #[test]
    fn letter_for_covers_the_bag_and_favors_common_letters() {
        // Every id maps to an uppercase letter.
        for id in 0..200u64 {
            let l = letter_for(id);
            assert!(l.is_ascii_uppercase(), "id {id} → non-letter {l}");
        }
        // Over a full bag cycle, E (12 tiles) must appear more often than Z (1 tile).
        let mut es = 0;
        let mut zs = 0;
        for id in 0..BAG_TOTAL {
            match letter_for(id) {
                b'E' => es += 1,
                b'Z' => zs += 1,
                _ => {}
            }
        }
        assert_eq!(es, 12);
        assert_eq!(zs, 1);
        assert!(es > zs);
    }
}
