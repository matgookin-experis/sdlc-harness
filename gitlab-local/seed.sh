#!/usr/bin/env bash
# seed.sh — Idempotent demo seed for the local GitLab instance.
# Creates a demo group, demo user, and the Weather Dashboard demo project
# sourced from the sdlc-harness dev branch.
# Safe to run multiple times — skips anything that already exists.
#
# Reads GITLAB_ROOT_PASSWORD from the environment or from .env in the
# same directory as this script. Never falls back to a hardcoded value.
set -euo pipefail

# Load .env if present and GITLAB_ROOT_PASSWORD is not already set.
# Parsed line-by-line rather than `source`-d: `source` runs the file as bash,
# so special characters in a value (e.g. a password of `Pa$$w0rd!`) get
# expanded as shell syntax (`$$` = current PID) instead of taken literally.
# Reading each line and assigning via parameter expansion avoids that —
# the value is captured as inert string data, never re-parsed as code.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -z "${GITLAB_ROOT_PASSWORD:-}" ] && [ -f "$SCRIPT_DIR/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
    esac
    key="${line%%=*}"
    value="${line#*=}"
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    export "$key=$value"
  done < "$SCRIPT_DIR/.env"
fi

if [ -z "${GITLAB_ROOT_PASSWORD:-}" ]; then
  echo "ERROR: GITLAB_ROOT_PASSWORD is not set."
  echo "  Copy gitlab-local/.env.example to gitlab-local/.env and set the variable."
  exit 1
fi

GITLAB_URL="http://localhost:8080"
ROOT_PASSWORD="$GITLAB_ROOT_PASSWORD"
DEMO_PASSWORD="$GITLAB_ROOT_PASSWORD"

# Use a temp dir relative to SCRIPT_DIR so its path resolves to a real Windows
# filesystem path (not /tmp) — docker cp requires a path that Windows can resolve.
TMP_DIR="$SCRIPT_DIR/.seed-tmp"
mkdir -p "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

# ── Wait for GitLab to be ready ──────────────────────────────────────────────
echo "Waiting for GitLab to be ready..."
for i in $(seq 1 40); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$GITLAB_URL/users/sign_in" 2>&1)
  if [ "$status" = "200" ]; then
    echo "GitLab is ready."
    break
  fi
  echo "  [$i/40] HTTP $status — retrying in 15s..."
  sleep 15
  if [ "$i" -eq 40 ]; then
    echo "ERROR: GitLab did not become ready in time. Is the container running?"
    exit 1
  fi
done

# ── Create a root API token via Rails runner (write to file inside container) -
echo ""
echo "Creating API token for root..."
# Write the Ruby script to a local temp file and stream it into the container via
# `docker exec -i ... sh -c 'cat > ...'`, redirecting from the local file with bash's
# own `<` operator. This avoids inline-shell quoting issues and does not consume the
# seed script's own stdin (which would break running this script itself via a pipe).
# Deliberately NOT using `docker cp`: on Git Bash for Windows, `docker cp`'s host-side
# source path (a POSIX path from $TMP_DIR) and its container-side dest path
# (gitlab:/tmp/...) need opposite MSYS path-translation behavior, and a single
# MSYS_NO_PATHCONV=1 applies to the whole command line — disabling translation for
# the container path also breaks translation for the host path, so docker.exe
# resolves it against the wrong root (e.g. "C:\c\Users\...") and cp silently fails.
# Piping via stdin sidesteps this: bash opens the host file itself for the
# redirect (no MSYS argv translation involved), and the only path-like text
# reaching docker.exe is embedded inside the `sh -c '...'` string, which MSYS's
# bare-absolute-path heuristic does not rewrite.
cat > "$TMP_DIR/runner.rb" <<'RUBY'
begin
  PersonalAccessToken.where(name: 'seed-script-token', user_id: 1).delete_all
  token = User.find(1).personal_access_tokens.create!(
    name: 'seed-script-token',
    scopes: [:api],
    expires_at: Date.today + 365
  )
  File.write('/tmp/seed_token.txt', token.token)
rescue => e
  File.write('/tmp/seed_token.txt', 'ERROR: ' + e.message)
end
RUBY
# MSYS_NO_PATHCONV=1 prevents Git Bash on Windows from translating /tmp/... container
# paths to Windows paths when passed as arguments to docker exec.
MSYS_NO_PATHCONV=1 docker exec -i gitlab sh -c 'cat > /tmp/runner.rb' < "$TMP_DIR/runner.rb" 2>/dev/null
MSYS_NO_PATHCONV=1 docker exec gitlab gitlab-rails runner /tmp/runner.rb 2>/dev/null
MSYS_NO_PATHCONV=1 docker exec gitlab rm -f /tmp/runner.rb 2>/dev/null || true

TOKEN=$(MSYS_NO_PATHCONV=1 docker exec gitlab cat /tmp/seed_token.txt 2>/dev/null || true)
MSYS_NO_PATHCONV=1 docker exec gitlab rm -f /tmp/seed_token.txt 2>/dev/null || true

if [ -z "$TOKEN" ] || [[ "$TOKEN" == ERROR:* ]]; then
  echo "ERROR: Could not create API token: $TOKEN"
  echo "  Make sure GitLab is fully started and try again."
  exit 1
fi
echo "Token obtained."

# ── Helper: call GitLab API ───────────────────────────────────────────────────
api() {
  local method="$1"; local path="$2"; shift 2
  curl -sf -X "$method" \
    -H "PRIVATE-TOKEN: $TOKEN" \
    -H "Content-Type: application/json" \
    "$GITLAB_URL/api/v4/$path" "$@"
}

# ── 1. Create demo group ──────────────────────────────────────────────────────
echo ""
echo "Setting up demo group..."
GROUP_ID=$(api GET "groups?search=sdlc-harness" | python3 -c "
import sys, json
g = [x for x in json.load(sys.stdin) if x['path'] == 'sdlc-harness']
print(g[0]['id'] if g else '')
" 2>/dev/null)
if [ -z "$GROUP_ID" ]; then
  GROUP_ID=$(api POST "groups" -d '{
    "name": "SDLC Harness",
    "path": "sdlc-harness",
    "visibility": "internal",
    "description": "IBM Hackathon - SDLC Harness demo group"
  }' | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  echo "  Created group 'SDLC Harness' (id=$GROUP_ID)"
else
  echo "  Group 'SDLC Harness' already exists (id=$GROUP_ID)"
fi

# ── 2. Create demo user ───────────────────────────────────────────────────────
echo ""
echo "Setting up demo user..."
USER_ID=$(api GET "users?username=demo" | python3 -c "
import sys, json
u = json.load(sys.stdin)
print(u[0]['id'] if u else '')
" 2>/dev/null)
if [ -z "$USER_ID" ]; then
  USER_ID=$(api POST "users" -d "{
    \"name\": \"Demo User\",
    \"username\": \"demo\",
    \"email\": \"demo@example.com\",
    \"password\": \"${DEMO_PASSWORD}\",
    \"skip_confirmation\": true
  }" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  echo "  Created user 'demo' (id=$USER_ID)"
else
  echo "  User 'demo' already exists (id=$USER_ID)"
fi

# Add demo user to group as Developer
MEMBER=$(api GET "groups/$GROUP_ID/members/$USER_ID" 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || true)
if [ -z "$MEMBER" ]; then
  api POST "groups/$GROUP_ID/members" \
    -d "{\"user_id\":$USER_ID,\"access_level\":30}" > /dev/null
  echo "  Added 'demo' to group as Developer"
fi

# ── 3. Create the Weather Dashboard project ───────────────────────────────────
echo ""
echo "Setting up Weather Dashboard project..."
PROJECT_ID=$(api GET "groups/$GROUP_ID/projects?search=weather-dashboard" | python3 -c "
import sys, json
p = [x for x in json.load(sys.stdin) if x['path'] == 'weather-dashboard']
print(p[0]['id'] if p else '')
" 2>/dev/null)
if [ -z "$PROJECT_ID" ]; then
  PROJECT_ID=$(api POST "projects" -d "{
    \"name\": \"Weather Dashboard\",
    \"path\": \"weather-dashboard\",
    \"namespace_id\": $GROUP_ID,
    \"visibility\": \"internal\",
    \"initialize_with_readme\": false,
    \"description\": \"SDLC Harness demo app - a deterministic mock weather dashboard\"
  }" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  echo "  Created project 'weather-dashboard' (id=$PROJECT_ID)"
else
  echo "  Project 'weather-dashboard' already exists (id=$PROJECT_ID)"
fi

# ── 4. Push project files ─────────────────────────────────────────────────────
echo ""
echo "Adding project files..."

# Helper: encode a file's content as base64, then post it to the GitLab files API.
# Skips silently if the file already exists on the default branch.
add_file() {
  local file_path="$1"
  local src_file="$2"
  local commit_msg="$3"

  local encoded_path
  encoded_path=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$file_path', safe=''))")

  # Check if the file already exists
  local exists
  exists=$(api GET "projects/$PROJECT_ID/repository/files/${encoded_path}?ref=main" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('file_name',''))" 2>/dev/null || true)

  if [ -z "$exists" ]; then
    local content_b64
    content_b64=$(base64 -w0 < "$src_file")
    api POST "projects/$PROJECT_ID/repository/files/${encoded_path}" \
      -d "{\"branch\":\"main\",\"content\":\"${content_b64}\",\"commit_message\":\"${commit_msg}\",\"encoding\":\"base64\"}" \
      > /dev/null
    echo "  Added $file_path"
  else
    echo "  $file_path already exists, skipping"
  fi
}

# gitlab-local/ lives inside the sdlc-harness repo.
# Weather app source files are at ../weather-app/ relative to this script.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
WEATHER_DIR="$REPO_ROOT/weather-app"

if [ ! -d "$WEATHER_DIR" ]; then
  echo "ERROR: weather-app directory not found at $WEATHER_DIR"
  echo "  Make sure you are running this script from inside the sdlc-harness repo."
  exit 1
fi

cp "$WEATHER_DIR/index.html"           "$TMP_DIR/index.html"
cp "$WEATHER_DIR/styles.css"           "$TMP_DIR/styles.css"
cp "$WEATHER_DIR/app.js"               "$TMP_DIR/app.js"
cp "$WEATHER_DIR/tests.md"             "$TMP_DIR/tests.md"
cp "$WEATHER_DIR/WEATHER-DASHBOARD.md" "$TMP_DIR/WEATHER-DASHBOARD.md"

# Also write a README pointing to the weather dashboard docs
cat > "$TMP_DIR/README.md" <<'EOF'
# Weather Dashboard — SDLC Harness Demo

A minimal, self-contained web application built to demonstrate an end-to-end SDLC
workflow using the **SDLC Harness** project.

## Quick Start

Open `index.html` directly in any modern browser — no server or build step needed.

## Files

| File | Description |
|---|---|
| `index.html` | Application shell |
| `styles.css` | All styling — CSS custom properties, dark mode, responsive |
| `app.js` | All runtime behaviour — mock data, search, theme toggle |
| `WEATHER-DASHBOARD.md` | Full project documentation |
| `tests.md` | Manual test checklist |

## SDLC Demo

See [WEATHER-DASHBOARD.md](WEATHER-DASHBOARD.md) for suggested changes to walk through
branching, committing, reviewing, and linking back to work items.

---

*SDLC Harness · IBM Hackathon Demo*
EOF

add_file "README.md"            "$TMP_DIR/README.md"            "Add README"
add_file "index.html"           "$TMP_DIR/index.html"           "Add Weather Dashboard HTML"
add_file "styles.css"           "$TMP_DIR/styles.css"           "Add Weather Dashboard styles"
add_file "app.js"               "$TMP_DIR/app.js"               "Add Weather Dashboard JavaScript"
add_file "tests.md"             "$TMP_DIR/tests.md"             "Add manual test checklist"
add_file "WEATHER-DASHBOARD.md" "$TMP_DIR/WEATHER-DASHBOARD.md" "Add Weather Dashboard documentation"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo " Demo seed complete!"
echo "════════════════════════════════════════"
echo ""
echo " GitLab URL  : $GITLAB_URL"
echo ""
echo " Root login"
echo "   Username  : root"
echo "   Password  : $ROOT_PASSWORD"
echo ""
echo " Demo user login"
echo "   Username  : demo"
echo "   Password  : $DEMO_PASSWORD"
echo ""
echo " Demo project"
echo "   URL       : $GITLAB_URL/sdlc-harness/weather-dashboard"
echo ""
