#!/usr/bin/env bash
# smoke.sh — Validates that the full stack is healthy after `docker compose up`.
# Exits 0 only if both services return the expected HTTP responses.
# Run from any directory — it resolves its own path.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
. "$SCRIPT_DIR/env.sh"
require_private_env_file "$SCRIPT_DIR/.env"
load_env_value DEMO_SITE_PORT "$SCRIPT_DIR/.env"

DEMO_SITE_PORT="${DEMO_SITE_PORT:-8081}"
if ! [[ "$DEMO_SITE_PORT" =~ ^[0-9]+$ ]] \
  || [ "$DEMO_SITE_PORT" -lt 1 ] \
  || [ "$DEMO_SITE_PORT" -gt 65535 ]; then
  echo "ERROR: DEMO_SITE_PORT must be an integer from 1 to 65535."
  exit 1
fi

GITLAB_URL="http://127.0.0.1:8080"
DEMO_SITE_URL="http://127.0.0.1:${DEMO_SITE_PORT}"

# GitLab is the stack. First boot compiles assets, so it gets a long budget.
TIMEOUT=300
# The demo site is a static nginx container — if it is coming up at all it is
# up in seconds. A long budget here only means a long wait before reporting a
# port collision, which is the usual cause.
DEMO_TIMEOUT=30
INTERVAL=5

pass() { echo "  ✓  $1"; }
fail() { echo "  ✗  $1"; exit 1; }

# wait_for <name> <url> <timeout>
wait_for() {
  local name="$1"
  local url="$2"
  local timeout="$3"
  local deadline=$(( $(date +%s) + timeout ))
  local code

  echo "Waiting for $name ($url)..."
  while true; do
    code="000"
    code=$(curl --silent --output /dev/null --write-out "%{http_code}" \
      --connect-timeout 3 --max-time 5 "$url" 2>/dev/null) || code="000"
    if [ "$code" = "200" ]; then
      pass "$name returned HTTP $code"
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      fail "$name did not become healthy within ${timeout}s (last HTTP code: $code)"
    fi
    echo "    HTTP $code — retrying in ${INTERVAL}s..."
    sleep "$INTERVAL"
  done
}

# GitLab does not expose /-/readiness through public nginx in every supported
# version. Probe it inside the container after the host-facing page responds.
wait_for_gitlab_readiness() {
  local deadline=$(( $(date +%s) + TIMEOUT ))

  echo "Waiting for GitLab internal readiness..."
  while true; do
    if docker exec gitlab sh -c \
      'curl -fsS --connect-timeout 3 --max-time 5 "http://127.0.0.1/-/readiness?all=1" >/dev/null || curl -fsS --connect-timeout 3 --max-time 5 "http://127.0.0.1:8080/-/readiness?all=1" >/dev/null' \
      >/dev/null 2>&1; then
      pass "GitLab internal readiness returned HTTP 200"
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      fail "GitLab internal readiness did not pass within ${TIMEOUT}s"
    fi
    echo "    not ready — retrying in ${INTERVAL}s..."
    sleep "$INTERVAL"
  done
}

echo ""
echo "════════════════════════════════════════"
echo " SDLC Harness — stack smoke test"
echo "════════════════════════════════════════"
echo ""

# The host-facing sign-in page proves Rails and Workhorse are serving. GitLab's
# readiness endpoint is restricted to allowlisted monitoring addresses and can
# return 404 to the Docker host even while the application is healthy.
wait_for "GitLab sign-in" "$GITLAB_URL/users/sign_in" "$TIMEOUT"
wait_for_gitlab_readiness
wait_for "Demo site (weather app)" "$DEMO_SITE_URL" "$DEMO_TIMEOUT"

echo ""
echo "════════════════════════════════════════"
echo " All checks passed — GitLab and the demo site are healthy."
echo "════════════════════════════════════════"
echo ""
