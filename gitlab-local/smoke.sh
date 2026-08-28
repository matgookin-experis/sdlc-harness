#!/usr/bin/env bash
# smoke.sh — Validates that the full stack is healthy after `docker compose up`.
# Exits 0 only if both services return the expected HTTP responses.
# Run from any directory — it resolves its own path.
set -euo pipefail

GITLAB_URL="http://localhost:8080"
DEMO_SITE_URL="http://localhost:8081"

# How long (seconds) to wait for each service before giving up
TIMEOUT=300
INTERVAL=5

pass() { echo "  ✓  $1"; }
fail() { echo "  ✗  $1"; exit 1; }

wait_for() {
  local name="$1"
  local url="$2"
  local deadline=$(( $(date +%s) + TIMEOUT ))

  echo "Waiting for $name ($url)..."
  while true; do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null || echo "000")
    if [ "$code" = "200" ] || [ "$code" = "302" ]; then
      pass "$name returned HTTP $code"
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      fail "$name did not become healthy within ${TIMEOUT}s (last HTTP code: $code)"
    fi
    echo "    HTTP $code — retrying in ${INTERVAL}s..."
    sleep "$INTERVAL"
  done
}

echo ""
echo "════════════════════════════════════════"
echo " SDLC Harness — stack smoke test"
echo "════════════════════════════════════════"
echo ""

# 1. GitLab — the sign-in page (or redirect) confirms the Rails stack is up
wait_for "GitLab" "$GITLAB_URL/users/sign_in"

# 2. Demo site — nginx serving the weather app
wait_for "Demo site (weather app)" "$DEMO_SITE_URL"

echo ""
echo "════════════════════════════════════════"
echo " All checks passed — stack is healthy."
echo "════════════════════════════════════════"
echo ""
