#!/usr/bin/env bash
# The two SQL probes, against a database that already has the schema.
#
#   npm run test:sql
#
# invariants.sql proves what the constraints refuse; policies.sql proves what
# the policies allow and what the functions do when they are called. Each ends
# by raising its own sentinel, so the probe rolls itself back and a silent
# failure cannot read as a pass.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
DATABASE_URL="${1:-${TEST_DATABASE_URL:-}}"
if [ -z "$DATABASE_URL" ]; then
  echo "usage: scripts/prove-sql.sh <database-url>" >&2
  exit 2
fi

fail=0
for probe in invariants:ALL_INVARIANTS_HELD policies:ALL_POLICIES_HELD; do
  file="${probe%%:*}"
  sentinel="${probe##*:}"
  echo "→ $file.sql"
  output="$(psql "$DATABASE_URL" -v ON_ERROR_STOP=0 -f "$here/supabase/tests/$file.sql" 2>&1)" || true
  if echo "$output" | grep -q "$sentinel"; then
    echo "  held"
  else
    echo "$output" | grep -E "ERROR|BROKEN" || echo "$output" | tail -3
    fail=1
  fi
done

# A migration that moves data is proved on data shaped the way it was before
# it: a fresh database is brought to the migration just before, seeded by
# <name>.before.sql, migrated, and checked by <name>.after.sql, which ends by
# raising MIGRATION_HELD.
for before in "$here"/supabase/tests/migrations/*.before.sql; do
  [ -e "$before" ] || continue
  name="$(basename "$before" .before.sql)"
  echo "→ migration $name"
  probe="migration_probe_$$"
  export PGOPTIONS="--client-min-messages=warning"
  probe_url="${DATABASE_URL%/*}/$probe"
  psql "$DATABASE_URL" -q -c "create database $probe" >/dev/null
  psql "$probe_url" -v ON_ERROR_STOP=1 -q -f "$here/supabase/tests/bootstrap.sql" >/dev/null
  for migration in "$here"/supabase/migrations/*.sql; do
    [ "$(basename "$migration" .sql)" \< "$name" ] || break
    psql "$probe_url" -v ON_ERROR_STOP=1 -q -f "$migration" >/dev/null
  done
  output="$(
    psql "$probe_url" -v ON_ERROR_STOP=1 -q -f "$before" 2>&1 &&
    psql "$probe_url" -v ON_ERROR_STOP=1 -q -f "$here/supabase/migrations/$name.sql" 2>&1 &&
    psql "$probe_url" -v ON_ERROR_STOP=0 -q -f "${before%.before.sql}.after.sql" 2>&1
  )" || true
  psql "$DATABASE_URL" -q -c "drop database $probe" >/dev/null
  if echo "$output" | grep -q MIGRATION_HELD; then
    echo "  held"
  else
    echo "$output" | grep -E "ERROR|BROKEN" || echo "$output" | tail -3
    fail=1
  fi
done

exit "$fail"
