#!/usr/bin/env bash
# Brings the whole system up locally and runs the end-to-end suite against it.
#
#   scripts/e2e.sh                # everything
#   scripts/e2e.sh --grep booking # one slice
#
# Nothing here touches the deployed environment: a throwaway Postgres, the real
# API served by Node, and the built interface. The API is the same code the Edge
# Function runs — only the server around it differs.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"

PG_PORT="${E2E_PG_PORT:-55434}"
API_PORT="${E2E_API_PORT:-8787}"
WEB_PORT="${E2E_WEB_PORT:-3100}"

DATA_DIR="$(mktemp -d)/pgdata"
SOCKET_DIR="$(mktemp -d)"
API_PID=""
WEB_PID=""

cleanup() {
  [ -n "$WEB_PID" ] && kill "$WEB_PID" 2>/dev/null || true
  [ -n "$API_PID" ] && kill "$API_PID" 2>/dev/null || true
  pg_ctl -D "$DATA_DIR" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA_DIR" "$SOCKET_DIR"
}
trap cleanup EXIT

wait_for() {
  local url="$1" name="$2" tries=0
  until curl -sf -o /dev/null "$url"; do
    tries=$((tries + 1))
    if [ "$tries" -gt 120 ]; then
      echo "$name did not come up at $url" >&2
      exit 1
    fi
    sleep 1
  done
  echo "   $name is up"
}

echo "→ Postgres on $PG_PORT"
initdb -D "$DATA_DIR" -U postgres --auth=trust >/dev/null
pg_ctl -D "$DATA_DIR" -o "-p $PG_PORT -k $SOCKET_DIR -c listen_addresses=127.0.0.1" -w start >/dev/null
export TEST_DATABASE_URL="postgres://postgres@127.0.0.1:$PG_PORT/postgres"
./scripts/apply-schema.sh "$TEST_DATABASE_URL" >/dev/null
echo "   schema applied"

echo "→ building"
npm run build --workspace @tor-now/api >/dev/null

export E2E_API_URL="http://127.0.0.1:$API_PORT/api"
export E2E_BASE_URL="http://127.0.0.1:$WEB_PORT"
export NEXT_PUBLIC_API_URL="$E2E_API_URL"

echo "→ API on $API_PORT"
# Generated per run: the database it signs against is thrown away at the end,
# and a literal secret in a script is a literal secret in a repository.
SUPABASE_DB_URL="$TEST_DATABASE_URL" \
SUPABASE_JWT_SECRET="$(openssl rand -hex 32)" \
VERIFICATION_TRANSPORT=LOG \
NOTIFICATION_TRANSPORT=LOG \
PORT="$API_PORT" \
  node services/api/dist/server.mjs >/tmp/tor-now-e2e-api.log 2>&1 &
API_PID=$!
wait_for "$E2E_API_URL/health" "api"

echo "→ interface on $WEB_PORT"
npm run build --workspace @tor-now/web >/dev/null
npx --workspace @tor-now/web next start -p "$WEB_PORT" -H 127.0.0.1 \
  >/tmp/tor-now-e2e-web.log 2>&1 &
WEB_PID=$!
wait_for "$E2E_BASE_URL" "interface"

echo "→ running the suite"
npx playwright test "$@"
