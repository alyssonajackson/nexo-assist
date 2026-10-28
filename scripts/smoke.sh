#!/usr/bin/env bash
# Smoke test for the docker compose stack: pnpm smoke (after `docker compose up --build -d`).
# Waits for the services, then checks init, health endpoints and that the web app renders.
# Exits non-zero with a clear message on the first check that does not pass in time.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

TIMEOUT="${SMOKE_TIMEOUT:-180}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
TICKETS_URL="${TICKETS_URL:-http://localhost:4000}"
deadline=$((SECONDS + TIMEOUT))

fail() {
  echo "smoke: FAIL - $1" >&2
  echo "smoke: see the logs with: docker compose logs ${2:-}" >&2
  exit 1
}

# wait_for <description> <service for logs> <command...>: retries the command until it passes.
wait_for() {
  local what="$1" service="$2"
  shift 2
  until "$@" >/dev/null 2>&1; do
    ((SECONDS < deadline)) || fail "$what (gave up after ${TIMEOUT}s)" "$service"
    sleep 2
  done
  echo "smoke: ok - $what"
}

state() { docker compose ps -a --format '{{.State}} {{.ExitCode}} {{.Health}}' "$1" 2>/dev/null; }
is_running() { [[ "$(state "$1")" == running* ]]; }
has_exited() { [[ "$(state "$1")" == exited* ]]; }
is_healthy() { [[ "$(state "$1")" == *" healthy" ]]; }
http_ok() { curl -fsS --max-time 5 "$1" | grep -q "$2"; }

[[ -n "$(docker compose ps -a -q 2>/dev/null)" ]] || fail "the stack is not up; run: docker compose up --build -d"

wait_for "mongo is healthy" mongo is_healthy mongo
wait_for "cognito is running" cognito is_running cognito
wait_for "elasticmq is running" elasticmq is_running elasticmq

# init is one-shot: wait for it to exit, then require exit code 0.
wait_for "init finished" init has_exited init
[[ "$(state init)" == "exited 0"* ]] || fail "init exited with $(state init | cut -d' ' -f2)" init
echo "smoke: ok - init exited 0"

wait_for "tickets is healthy" tickets is_healthy tickets
wait_for "tickets /health" tickets http_ok "$TICKETS_URL/health" '"ok":true'
wait_for "web /api/health" web http_ok "$WEB_URL/api/health" '"ok":true'
wait_for "web root renders" web http_ok "$WEB_URL/" '<html'

echo "smoke: all checks passed"
