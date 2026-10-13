#!/usr/bin/env bash
# Verify that the Rust referee is live and actually refereeing.
#
# Publishing the module is not the same as the War Table working. The module
# only referees tables that something opens, and only the feeder opens them —
# so a clean publish onto a database whose feeder is down looks exactly like
# success and produces no melees at all. This checks the whole chain.
#
# The decisive signal is `melee_trick`: nothing but `melee_close_trick` in
# server/src/reducers.rs writes that table. A row in it is proof the module
# resolved a trick itself rather than being handed totals by the feeder.
#
# Usage: bash scripts/verify-melee-deploy.sh [database-name]
set -uo pipefail

DB="${1:-${SPACETIMEDB_DB:-pentacles1}}"
ROUND_SECS="${ROUND_SECS:-75}"   # one 60s feeder round, plus slack

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

q() { spacetime sql "$DB" "$1" 2>&1; }

# `spacetime sql` prints a header, a dashed rule, then rows. Read the value in
# the first data row — never "the first number anywhere", which would happily
# read an HTTP status code out of an error message. Prints ERR on failure.
count() {
  local out
  out=$(spacetime sql "$DB" "$1" 2>&1) || { echo ERR; return 1; }
  printf '%s\n' "$out" | awk '/^-+/{ if (getline > 0) { gsub(/[^0-9]/, ""); print ($0 == "" ? "ERR" : $0) } exit }'
}
# A count that could not be read is a failure, not a zero and not a pass.
num() { [[ "$1" =~ ^[0-9]+$ ]]; }

fail=0

say "1 · Database reachable"
# `q` captures stderr, so check the TEXT before the exit status: a paused
# database fails the command AND says why, and "paused" is the actionable
# diagnosis while "cannot query" is not.
probe=$(q "SELECT count(*) AS cnt FROM zone"); probe_rc=$?
if grep -qi "paused" <<<"$probe"; then
  bad "$DB is PAUSED — unpause it at https://spacetimedb.com, then publish"
  warn "maincloud pauses idle databases; if it idled, the feeder is likely down too"
  exit 1
fi
if [ "$probe_rc" -ne 0 ]; then
  bad "cannot query $DB"; echo "$probe" | sed 's/^/      /'; exit 1
fi
ok "$DB responding"

say "2 · Schema carries the referee's and the war-results tables"
# melee_hand/melee_trick came with the server-side referee; melee_result and
# war_state with the results lifecycle. Absent means the publish did not land,
# whatever the CLI said.
for t in melee_hand melee_trick melee_result war_state; do
  if q "SELECT count(*) AS cnt FROM $t" | grep -qiE "unknown table|no such table|not found"; then
    bad "$t missing — the module was not published"; fail=1
  else
    ok "$t present"
  fi
done
[ "$fail" = 1 ] && exit 1

say "3 · Are tables opening and settling?"
# Raw melee_* rows are pruned a few minutes after each table settles, so their
# counts can FALL between two reads. Use numbers that only ever grow: the
# module's round high-water mark, and melee_result rows that settled inside
# the window (kept a week).
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
before_round=$(count "SELECT last_round_index FROM war_state")
printf '      waiting %ss for a feeder round…\n' "$ROUND_SECS"
sleep "$ROUND_SECS"
after_round=$(count "SELECT last_round_index FROM war_state")
settled=$(count "SELECT count(*) AS cnt FROM melee_result WHERE resolved_at >= '$since'")
refereed=$(count "SELECT count(*) AS cnt FROM melee_result WHERE resolved_at >= '$since' AND refereed = true AND is_void = false")
for v in "$after_round" "$settled" "$refereed"; do
  num "$v" || { bad "could not read war_state / melee_result (got '$v') — is this module published?"; exit 1; }
done
num "$before_round" || before_round=0  # war_state appears with the first table

if [ "$after_round" -gt "$before_round" ] || [ "$settled" -gt 0 ]; then
  ok "rounds are opening (round ${before_round:-?} → ${after_round:-?}, $settled table(s) settled) — pentacles-feeders is up"
else
  bad "no new round in ${ROUND_SECS}s — the Railway 'pentacles-feeders' worker is not running."
  warn "the module cannot referee a table nobody opens; check the Railway service before reading anything below as a failure of the publish"
  fail=1
fi

say "4 · Is the MODULE refereeing and recording them?"
if [ "$refereed" -gt 0 ]; then
  ok "$refereed played table(s) refereed and settled on chain into melee_result in the window"
elif [ "$settled" -gt 0 ]; then
  bad "$settled table(s) settled, but none was actually played by the module's referee (all void?)"
  fail=1
else
  warn "skipped: no table settled inside the window"
fi

say "5 · Latest results"
q "SELECT table_id, zone_id, winner_faction, winning_score, tricks_played, captured FROM melee_result WHERE resolved_at >= '$since'" | head -15

say "6 · Hands are dealt on chain (not in the feeder)"
# melee_hand is private and emptied when a table settles, so an empty table
# between rounds is normal. A refereed result with tricks proves cards were dealt.
played=$(count "SELECT count(*) AS cnt FROM melee_result WHERE resolved_at >= '$since' AND tricks_played > 0")
num "$played" || played=0
if [ "$played" -gt 0 ]; then
  ok "$played settled table(s) played tricks — the module dealt and validated real hands"
elif [ "$settled" -gt 0 ]; then
  bad "tables settled with zero tricks — seats may have been dealt no cards"
  fail=1
else
  warn "skipped: no table settled inside the window"
fi

say "6b · War history is being kept and bounded"
q "SELECT current_decan, decan_tables, season_number, last_round_index FROM war_state"
q "SELECT faction_idx, decan_points, tables_won, decan_crowns, season_crowns FROM faction_war_standing" | head -12

say "7 · Nobody is scoring from the wire any more"
# The feeder no longer calls submit_melee_result. A settled table that has trick
# rows was scored by the module from counters it banked itself.
q "SELECT trick_id, table_id, trick_number, winner_seat, counters FROM melee_trick" | head -15

if [ "$fail" = 0 ]; then
  say "PASS — the module is dealing, refereeing and settling its own tables."
else
  say "INCOMPLETE — see the ✗ lines above."
fi
exit "$fail"
