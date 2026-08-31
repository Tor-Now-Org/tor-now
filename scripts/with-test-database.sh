#!/usr/bin/env bash
# Starts a throwaway Postgres, applies the schema, runs the command it is given
# with TEST_DATABASE_URL pointing at it, and takes the cluster down again.
#
#   scripts/with-test-database.sh npm test
#
# CI provides its own Postgres and calls apply-schema.sh directly; this is for a
# laptop, where nobody wants a permanent database for one test run.
set -euo pipefail

PORT="${PGPORT_TEST:-55433}"
DATA_DIR="$(mktemp -d)/pgdata"
SOCKET_DIR="$(mktemp -d)"

cleanup() {
  pg_ctl -D "$DATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR" "$SOCKET_DIR"
}
trap cleanup EXIT

echo "→ starting a throwaway Postgres on port $PORT"
initdb -D "$DATA_DIR" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DATA_DIR" -o "-p $PORT -k $SOCKET_DIR -c listen_addresses=127.0.0.1" -w start >/dev/null

export TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
"$(dirname "$0")/apply-schema.sh" "$TEST_DATABASE_URL"

echo "→ running: $*"
"$@"
