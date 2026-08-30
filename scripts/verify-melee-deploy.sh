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

DB="${1:-${SPACETIMEDB_DB:-cookingwithcastrollc}}"
ROUND_SECS="${ROUND_SECS:-75}"   # one 60s feeder round, plus slack

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad()  { printf '  \033[31m✗\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

q() { spacetime sql "$DB" "$1" 2>&1; }

# `spacetime sql` prints a table; pull the first integer out of it.
count() { q "$1" | grep -oE '[0-9]+' | head -1; }

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

say "2 · Schema carries the referee's tables"
# These two are what the move to a server-side referee added. Absent means the
# publish did not land, whatever the CLI said.
for t in melee_hand melee_trick; do
  if q "SELECT count(*) AS cnt FROM $t" | grep -qiE "unknown table|no such table|not found"; then
    bad "$t missing — the module was not published"; fail=1
  else
    ok "$t present"
  fi
done
[ "$fail" = 1 ] && exit 1

say "3 · Is anything opening rounds?"
before_tables=$(count "SELECT count(*) AS cnt FROM melee_table")
before_tricks=$(count "SELECT count(*) AS cnt FROM melee_trick")
echo "      melee_table=$before_tables  melee_trick=$before_tricks"
printf '      waiting %ss for a feeder round…\n' "$ROUND_SECS"
sleep "$ROUND_SECS"
after_tables=$(count "SELECT count(*) AS cnt FROM melee_table")
after_tricks=$(count "SELECT count(*) AS cnt FROM melee_trick")

if [ "$after_tables" -gt "$before_tables" ]; then
  ok "feeder opened $((after_tables - before_tables)) table(s) — pentacles-feeders is up"
else
  bad "no new tables in ${ROUND_SECS}s — the Railway 'pentacles-feeders' worker is not running."
  warn "the module cannot referee a table nobody opens; check the Railway service before reading anything below as a failure of the publish"
  fail=1
fi

say "4 · Is the MODULE refereeing them?"
if [ "$after_tricks" -gt "$before_tricks" ]; then
  ok "$((after_tricks - before_tricks)) trick(s) resolved on chain — the Rust referee is live"
else
  if [ "$after_tables" -gt "$before_tables" ]; then
    bad "tables opened but no tricks resolved — seats may have been dealt no cards"
    fail=1
  else
    warn "skipped: no round ran to referee"
  fi
fi

say "5 · Latest tables"
q "SELECT table_id, zone_id, state, seat_count FROM melee_table" | head -15

say "6 · Hands are dealt on chain (not in the feeder)"
dealt=$(count "SELECT count(*) AS cnt FROM melee_hand")
if [ "${dealt:-0}" -gt 0 ]; then
  ok "$dealt dealt card(s) recorded — play validation has something to check against"
else
  bad "melee_hand is empty; play_melee_card will refuse every human play"
  fail=1
fi

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
