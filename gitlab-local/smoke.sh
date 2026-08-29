#!/usr/bin/env bash
# smoke.sh — Validates that the full stack is healthy after `docker compose up`.
# Exits 0 only if both services return the expected HTTP responses.
# Run from any directory — it resolves its own path.
set -euo pipefail

# Ports match docker-compose.yml; DEMO_SITE_PORT is overridable in .env.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/.env" ] && . "$SCRIPT_DIR/.env"

GITLAB_URL="http://localhost:8080"
DEMO_SITE_URL="http://localhost:${DEMO_SITE_PORT:-8081}"

# GitLab is the stack. First boot compiles assets, so it gets a long budget.
TIMEOUT=300
# The demo site is a static nginx container — if it is coming up at all it is
# up in seconds. A long budget here only means a long wait before reporting a
# port collision, which is the usual cause.
DEMO_TIMEOUT=30
INTERVAL=5

pass() { echo "  ✓  $1"; }
warn() { echo "  !  $1"; }
fail() { echo "  ✗  $1"; exit 1; }

# wait_for <name> <url> <timeout> <required|optional>
# Returns non-zero instead of exiting when the service is optional, so one
# missing convenience container cannot make a healthy stack look broken.
wait_for() {
  local name="$1"
  local url="$2"
  local timeout="$3"
  local requirement="${4:-required}"
  local deadline=$(( $(date +%s) + timeout ))

  echo "Waiting for $name ($url)..."
  while true; do
    local code
    # curl already prints 000 on failure via %{http_code}; the old `|| echo "000"`
    # appended a second one, which is where "HTTP 000000" came from.
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$url" 2>/dev/null)
    [ -z "$code" ] && code="000"
    if [ "$code" = "200" ] || [ "$code" = "302" ]; then
      pass "$name returned HTTP $code"
      return 0
    fi
    if [ "$(date +%s)" -ge "$deadline" ]; then
      if [ "$requirement" = "optional" ]; then
        warn "$name did not respond within ${timeout}s (last HTTP code: $code)"
        return 1
      fi
      fail "$name did not become healthy within ${timeout}s (last HTTP code: $code)"
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

# 1. GitLab — the sign-in page (or redirect) confirms the Rails stack is up.
# Required: without this nothing else in the demo works.
wait_for "GitLab" "$GITLAB_URL/users/sign_in" "$TIMEOUT" required

# 2. Demo site — nginx serving the weather app. Optional: it is the project
# under governance in the demo video, but the agents never touch it, so a
# port collision here must not fail the health check.
demo_ok=0
wait_for "Demo site (weather app)" "$DEMO_SITE_URL" "$DEMO_TIMEOUT" optional || demo_ok=1

echo ""
echo "════════════════════════════════════════"
if [ "$demo_ok" -eq 0 ]; then
  echo " All checks passed — stack is healthy."
else
  echo " GitLab is healthy. Demo site is not up."
  echo ""
  echo " The agents and the MCP tools do not need it — the demo site only"
  echo " serves the weather app for the video. The usual cause is that"
  echo " port ${DEMO_SITE_PORT:-8081} is already taken. Check with:"
  echo ""
  echo "   lsof -iTCP:${DEMO_SITE_PORT:-8081} -sTCP:LISTEN"
  echo ""
  echo " Then set DEMO_SITE_PORT to a free port in gitlab-local/.env and"
  echo " run: docker compose up -d"
fi
echo "════════════════════════════════════════"
echo ""
