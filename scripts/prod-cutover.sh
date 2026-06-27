#!/usr/bin/env bash
# ============================================================================
# Pentacles — prod cutover to SpacetimeDB 2.x  (cookingwithcastrollc)
# ============================================================================
# Backs up every table, then republishes the 2.x module over prod.
#
# SAFE BY DEFAULT. `publish` never passes --delete-data, so SpacetimeDB refuses
# to wipe: a compatible 1.x→2.x migration preserves data in place; an incompatible
# one FAILS (it asks for --delete-data) and this script stops. Wiping requires the
# separate, double-gated `force-publish`. (Verified: republishing without -c keeps
# all rows; the only way to delete data is the explicit -c path in force-publish.)
#
# Usage (run from the repo root, logged in as the db owner):
#   ./scripts/prod-cutover.sh preflight     # login, CLI 2.6, owner token, fresh wasm
#   ./scripts/prod-cutover.sh backup        # dump all tables → backups/<ts>/ (incl. private)
#   ./scripts/prod-cutover.sh publish       # non-destructive republish (data-preserving)
#   ./scripts/prod-cutover.sh verify        # WS-smoke the 2.x module post-cutover
#   ./scripts/prod-cutover.sh all           # preflight → backup → publish
#
# Destructive path — ONLY if `publish` reports the migration needs a data wipe:
#   ALLOW_DATA_LOSS=1 ./scripts/prod-cutover.sh force-publish   # DESTROYS all data
#
# AUTH: the owner token is read from SPACETIME_TOKEN, else from
# ~/.config/spacetime/cli.toml (spacetimedb_token). The token is required to back
# up PRIVATE tables (natal_chart, player_location, *_rate) — the public /sql path
# can't see them. Scheduled system tables (round_timer, sky_tick_timer) aren't
# SQL-readable and are skipped (they're re-created by the scheduler on publish).
#
# RESTORE NOTE: SpacetimeDB has no generic row-import — data is only written by
# reducers. The JSON dumps are a *safety record*. If a wipe happens, prod is
# reconstructed by republishing (init re-seeds zones/stars/constellations/agents)
# and replaying the authoritative reducers; per-player state (charts, decks, jing
# pools, minted blocks) would need manual replay from the dumps.
# ============================================================================
set -euo pipefail

DB="${SPACETIMEDB_DB:-cookingwithcastrollc}"
SERVER="${SPACETIMEDB_SERVER:-maincloud}"
URI="${SPACETIMEDB_URI:-https://maincloud.spacetimedb.com}"
WASM="${WASM_PATH:-server/target/wasm32-unknown-unknown/release/pentacles_server.wasm}"
CLI_TOML="${HOME}/.config/spacetime/cli.toml"

c_red() { printf '\033[31m%s\033[0m\n' "$*"; }
c_grn() { printf '\033[32m%s\033[0m\n' "$*"; }
c_ylw() { printf '\033[33m%s\033[0m\n' "$*"; }
die()   { c_red "✗ $*"; exit 1; }

# Resolve the owner token: explicit env wins, else the CLI's stored login token.
resolve_token() {
  if [ -n "${SPACETIME_TOKEN:-}" ]; then TOKEN="$SPACETIME_TOKEN"; TOKEN_SRC="SPACETIME_TOKEN"; return; fi
  if [ -f "$CLI_TOML" ]; then
    TOKEN="$(grep -E '^spacetimedb_token' "$CLI_TOML" 2>/dev/null | sed -E 's/^spacetimedb_token = "([^"]+)".*/\1/' || true)"
    [ -n "${TOKEN:-}" ] && TOKEN_SRC="cli.toml" && return
  fi
  TOKEN=""; TOKEN_SRC="(none)"
}

# All 36 tables — fallback if the live schema endpoint is unreachable.
FALLBACK_TABLES="player natal_chart player_location card deck_slot trade zone star_node ephemeris battle game_config duel_queue duel oracle_request oracle_reply oracle_cache oracle_rate word_duel word_rate duel_challenge round_state round_timer sky_tick_timer constellation constellation_star constellation_line trace_intent trace_attestation constellation_resolution constellation_block star_agent comet jing_duel jing_cast jing_pool jing_rate"

list_tables() {
  curl -s -m 15 "$URI/v1/database/$DB/schema?version=9" 2>/dev/null \
    | python3 -c "import sys,json; print('\n'.join(t['name'] for t in json.load(sys.stdin).get('tables',[])))" 2>/dev/null \
    || true
}

count_rows() { python3 -c "import sys,json;d=json.load(open('$1'));print(sum(len(s.get('rows',[])) for s in (d if isinstance(d,list) else [d])))" 2>/dev/null || echo '?'; }

# Light environment check (login + schema reachability + token) — no build.
check_env() {
  command -v spacetime >/dev/null || die "spacetime CLI not on PATH"
  local ver; ver="$(spacetime --version 2>/dev/null | grep -oE 'tool version [0-9.]+' | grep -oE '[0-9.]+' | head -1)"
  case "$ver" in 2.*) ;; *) die "CLI must be 2.x (run: spacetime version use 2.6.0). Got '${ver:-none}'." ;; esac
  spacetime login show >/dev/null 2>&1 || die "not logged in (run: spacetime login)"
  resolve_token
  echo "  db: $DB @ $SERVER ($URI)"
  echo "  CLI: $ver   owner token: $TOKEN_SRC"
  [ -n "$TOKEN" ] || c_ylw "  ⚠ no owner token — PRIVATE tables (natal_chart, player_location, *_rate) can't be backed up."
}

# Build the module from current source so the published wasm matches the tree.
ensure_wasm() {
  echo "  building module from current source…"
  ( cd server && spacetime build >/dev/null 2>&1 ) || die "spacetime build failed — fix the server before cutover"
  [ -f "$WASM" ] || die "wasm not found at $WASM after build"
  echo "  wasm: $WASM ($(wc -c < "$WASM" | tr -d ' ') bytes)"
}

preflight() {
  c_ylw "── preflight ──────────────────────────────────────────────"
  check_env
  ensure_wasm
  local n; n="$(list_tables | grep -c . || true)"
  echo "  live schema reachable: ${n:-0} tables"
  c_grn "✓ preflight OK"
}

backup() {
  c_ylw "── backup ─────────────────────────────────────────────────"
  check_env
  local ts dir; ts="$(date +%Y%m%d-%H%M%S)"; dir="backups/${DB}-${ts}"; mkdir -p "$dir"
  c_ylw "  → $dir"
  local tables; tables="$(list_tables)"; [ -n "$tables" ] || tables="$FALLBACK_TABLES"
  echo "$tables" > "$dir/_tables.txt"
  local total=0 skipped=0 failed=0 tmp; tmp="$(mktemp)"
  for t in $tables; do
    local code
    code="$(curl -s -m 60 -o "$tmp" -w '%{http_code}' -X POST "$URI/v1/database/$DB/sql" \
      -H "Content-Type: text/plain" ${TOKEN:+-H "Authorization: Bearer $TOKEN"} \
      --data "SELECT * FROM $t" 2>/dev/null || echo "000")"
    if [ "$code" = "200" ]; then
      mv "$tmp" "$dir/${t}.json"; tmp="$(mktemp)"
      local rows; rows="$(count_rows "$dir/${t}.json")"
      printf "  %-26s %s rows\n" "$t" "$rows"
      [ "$rows" != '?' ] && total=$((total + rows))
    elif grep -qiE 'no such table|marked private' "$tmp" 2>/dev/null; then
      # Scheduled/system table not exposed to SQL — expected, not a failure.
      printf "  %-26s skipped (not SQL-readable)\n" "$t"; skipped=$((skipped + 1))
    else
      mv "$tmp" "$dir/${t}.error.txt"; tmp="$(mktemp)"
      c_ylw "  $t  HTTP $code — $(head -c 120 "$dir/${t}.error.txt")"; failed=$((failed + 1))
    fi
  done
  rm -f "$tmp"
  c_grn "✓ backup complete: $dir  (~$total rows; $skipped skipped, $failed failed)"
  [ "$failed" -eq 0 ] || c_ylw "  ⚠ $failed table(s) errored — inspect *.error.txt before cutover."
  printf '%s\n' "$dir"
}

publish() {
  c_ylw "── publish (non-destructive) ──────────────────────────────"
  ensure_wasm
  c_ylw "  No --delete-data: a data-destroying migration FAILS here instead of wiping."
  echo
  # --yes skips only the non-destructive prompts (non-local server / break-clients /
  # automatic migration). Data deletion is NOT in the set and -c is absent, so a
  # breaking migration still aborts safely.
  if spacetime publish --server "$SERVER" --bin-path "$WASM" --yes=remote,break-clients,migrate "$DB"; then
    c_grn "✓ published — module is now 2.x and data was preserved."
    c_grn "  next: ./scripts/prod-cutover.sh verify"
  else
    c_red "✗ publish did NOT complete."
    c_ylw "  If it asked for --delete-data, the 1.x→2.x migration is NOT data-preserving."
    c_ylw "  Confirm your backups, then (only then):"
    c_ylw "      ALLOW_DATA_LOSS=1 ./scripts/prod-cutover.sh force-publish"
    return 1
  fi
}

force_publish() {
  [ "${ALLOW_DATA_LOSS:-0}" = "1" ] || die "force-publish requires ALLOW_DATA_LOSS=1 (this DESTROYS all data in $DB)"
  c_red "── force-publish (DESTRUCTIVE: wipes ALL data in $DB) ──────"
  ensure_wasm
  printf "Type the database name (%s) to confirm the wipe: " "$DB"
  read -r confirm
  [ "$confirm" = "$DB" ] || die "confirmation mismatch — aborted"
  spacetime publish --server "$SERVER" --bin-path "$WASM" --delete-data --yes=all "$DB"
  c_grn "✓ force-published (data wiped; init re-seeds zones/stars/constellations/agents)."
}

verify() {
  c_ylw "── verify (WS smoke against $DB) ──────────────────────────"
  command -v bun >/dev/null || die "bun not found (needed for the WS smoke)"
  SMOKE_URI="$URI" SMOKE_DB="$DB" bun run scripts/ws-smoke.ts
}

case "${1:-help}" in
  preflight)     preflight ;;
  backup)        backup ;;
  publish)       publish ;;
  force-publish) force_publish ;;
  verify)        verify ;;
  all)           preflight; backup; publish ;;
  *) sed -n '2,46p' "$0" | sed 's/^# \{0,1\}//' ;;
esac
