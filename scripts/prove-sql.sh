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

exit "$fail"
