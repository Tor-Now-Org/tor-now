#!/usr/bin/env bash
# Applies the bootstrap and then every migration, in order, to one database.
#
#   scripts/apply-schema.sh "postgres://..."
#
# Used by the integration tests and by CI. It is deliberately not clever: the
# migrations are applied exactly as written, so a migration that only works on
# Supabase fails here rather than silently diverging.
set -euo pipefail

DATABASE_URL="${1:-${TEST_DATABASE_URL:-}}"
if [ -z "$DATABASE_URL" ]; then
  echo "usage: scripts/apply-schema.sh <database-url>" >&2
  exit 2
fi

here="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ bootstrap"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$here/supabase/tests/bootstrap.sql"

for migration in "$here"/supabase/migrations/*.sql; do
  echo "→ $(basename "$migration")"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$migration"
done

echo "schema applied"
