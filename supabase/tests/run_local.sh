#!/usr/bin/env bash
# Apply supabase/migrations/*.sql to a throwaway LOCAL Postgres (16+) and run
# the RLS/RPC smoke tests. Needs initdb/pg_ctl/psql on PATH or PG_BIN set.
# Usage: supabase/tests/run_local.sh            (creates + destroys a temp cluster)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PG_BIN="${PG_BIN:-$(dirname "$(command -v initdb 2>/dev/null || echo /usr/lib/postgresql/16/bin/initdb)")}"
WORK="$(mktemp -d)"
PORT="${PORT:-5498}"
cleanup() { "$PG_BIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
"$PG_BIN/initdb" -D "$WORK/data" -U postgres -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$WORK/data" -o "-p $PORT -k $WORK -c listen_addresses=" -l "$WORK/log" start >/dev/null
PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q)
"${PSQL[@]}" -f "$HERE/local_supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "applying $(basename "$f")"
  # pg_net is a Supabase-only extension; skip it locally.
  grep -v 'create extension if not exists pg_net' "$f" | "${PSQL[@]}" -f -
done
"${PSQL[@]}" -f "$HERE/rls_smoke_test.sql"
# Further *_test.sql files run after the smoke test and reuse its fixtures.
for t in "$HERE"/*_test.sql; do
  [ "$(basename "$t")" = "rls_smoke_test.sql" ] && continue
  echo "running $(basename "$t")"
  "${PSQL[@]}" -f "$t"
done
echo "local migration + RLS smoke test: OK"
