#!/usr/bin/env bash
# seed.sh — Idempotent demo seed for the local GitLab instance.
# Creates a demo group, demo user, and the Weather Dashboard demo project
# sourced from the sdlc-harness dev branch.
# Safe to run multiple times — skips anything that already exists.
#
# Reads root and demo passwords from the environment or from .env in the
# same directory as this script. Never falls back to a hardcoded value.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
. "$SCRIPT_DIR/env.sh"
require_private_env_file "$SCRIPT_DIR/.env"
load_env_value GITLAB_ROOT_PASSWORD "$SCRIPT_DIR/.env"
load_env_value GITLAB_DEMO_PASSWORD "$SCRIPT_DIR/.env"

require_password() {
  local name="$1"
  local placeholder="$2"
  local value="${!name:-}"

  if [ -z "$value" ]; then
    echo "ERROR: $name is not set."
    echo "  Copy gitlab-local/.env.example to gitlab-local/.env and set it explicitly."
    exit 1
  fi
  if [ "$value" = "$placeholder" ]; then
    echo "ERROR: $name still has the placeholder value from .env.example."
    exit 1
  fi
  if [ "${#value}" -lt 8 ]; then
    echo "ERROR: $name must contain at least 8 characters."
    exit 1
  fi
}

require_password GITLAB_ROOT_PASSWORD "change_me_before_starting"
require_password GITLAB_DEMO_PASSWORD "change_me_before_seeding"
if [ "$GITLAB_ROOT_PASSWORD" = "$GITLAB_DEMO_PASSWORD" ]; then
  echo "ERROR: GITLAB_ROOT_PASSWORD and GITLAB_DEMO_PASSWORD must be different." >&2
  exit 1
fi

GITLAB_URL="http://127.0.0.1:8080"
DEMO_PASSWORD="$GITLAB_DEMO_PASSWORD"

# Use a temp dir relative to SCRIPT_DIR so its path resolves to a real Windows
# filesystem path (not /tmp) — docker cp requires a path that Windows can resolve.
#
# It is also used to stage JSON request bodies for `api POST/PUT` calls.
# Every such body is written by python3 to a file here first and then read by
# curl via `--data-binary @file` — NEVER piped directly (`python3 ... | api
# POST ... --data-binary @-`). On Windows/Git Bash, piping a native python3.exe's
# stdout straight into curl.exe's stdin is unreliable: MSYS emulates Unix pipes
# with Win32 named pipes, and that emulation layer's flush/close semantics don't
# line up cleanly with two independent native (non-MSYS) processes on either
# end. In practice curl receives an empty body (the request may not even reach
# the server) while python3 fails its final stdout flush with `OSError: [Errno
# 22] Invalid argument`. Writing to a file first (same trick already used below
# for CURL_CONFIG) sidesteps the pipe entirely.
TMP_DIR="$SCRIPT_DIR/.seed-tmp"
umask 077
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

CONTAINER_TEMP_USED=0
PAT_CLEANUP_REQUIRED=0

cleanup() {
  local status=$?
  local cleanup_status=0
  local cleanup_token=""
  local revoke_config="${CURL_CONFIG:-}"
  local revoked=0

  trap - EXIT
  set +e

  if [ "$PAT_CLEANUP_REQUIRED" -eq 1 ]; then
    if [ -z "$revoke_config" ] || [ ! -r "$revoke_config" ]; then
      cleanup_token=$(MSYS_NO_PATHCONV=1 docker exec gitlab \
        cat /tmp/seed_token.txt 2>/dev/null || true)
      if [ -n "$cleanup_token" ] && [[ "$cleanup_token" != ERROR:* ]]; then
        revoke_config="$TMP_DIR/revoke-token.conf"
        printf 'header = "PRIVATE-TOKEN: %s"\n' "$cleanup_token" > "$revoke_config"
      fi
    fi

    if [ -n "$revoke_config" ] && [ -r "$revoke_config" ]; then
      if curl --silent --show-error --fail \
        --connect-timeout 5 --max-time 30 \
        --config "$revoke_config" --request DELETE \
        "$GITLAB_URL/api/v4/personal_access_tokens/self" >/dev/null 2>&1; then
        revoked=1
      fi
    fi

    if [ "$revoked" -eq 0 ]; then
      if MSYS_NO_PATHCONV=1 docker exec -i gitlab sh -c \
        'umask 077; cat > /tmp/seed_revoke_token.rb; chown git:git /tmp/seed_revoke_token.rb' \
        < "$TMP_DIR/revoke-token.rb" >/dev/null 2>&1; then
        run_gitlab_rails_runner /tmp/seed_revoke_token.rb \
          "Revoking the seed API token" 30 >/dev/null 2>&1 || cleanup_status=1
      else
        cleanup_status=1
      fi
    fi
  fi

  unset cleanup_token

  if [ "$CONTAINER_TEMP_USED" -eq 1 ]; then
    MSYS_NO_PATHCONV=1 docker exec gitlab rm -f \
      /tmp/seed_runner.rb \
      /tmp/seed_revoke_token.rb \
      /tmp/seed_token.txt \
      /tmp/demo_password \
      /tmp/update-demo-password.rb \
      >/dev/null 2>&1 || cleanup_status=1
  fi

  rm -rf "$TMP_DIR" || cleanup_status=1
  if [ "$cleanup_status" -ne 0 ]; then
    echo "ERROR: Could not fully revoke the seed PAT or remove token files." >&2
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi
  exit "$status"
}

trap cleanup EXIT

# ── Wait for GitLab to be ready ──────────────────────────────────────────────
echo "Waiting for GitLab to be ready..."
for i in $(seq 1 40); do
  status="000"
  status=$(curl --silent --output /dev/null --write-out "%{http_code}" \
    --connect-timeout 3 --max-time 5 "$GITLAB_URL/users/sign_in" 2>/dev/null) \
    || status="000"
  if [ "$status" = "200" ]; then
    echo "GitLab is ready."
    break
  fi
  echo "  [$i/40] HTTP $status — retrying in 10s..."
  sleep 10
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
if [ -n "${GITLAB_TOKEN:-}" ]; then
  # Booting the Rails console costs a lot of memory and several minutes on a cold
  # or resource-starved container, and it is the step most likely to hang. A token
  # supplied by the caller skips it entirely. Create one in the GitLab UI under
  # User settings -> Access tokens, with the `api` scope.
  TOKEN="$GITLAB_TOKEN"
  echo "Using GITLAB_TOKEN from the environment (skipping Rails console)."
else

cat > "$TMP_DIR/runner.rb" <<'RUBY'
def write_private(path, value)
  File.unlink(path) if File.exist?(path)
  File.open(path, File::WRONLY | File::CREAT | File::TRUNC, 0o600) do |file|
    file.write(value)
  end
end

begin
  PersonalAccessToken.where(
    name: 'seed-script-token', user_id: 1, revoked: false
  ).find_each { |existing| existing.revoke! }
  token = User.find(1).personal_access_tokens.create!(
    name: 'seed-script-token',
    scopes: [:api],
    expires_at: Date.today + 1
  )
  write_private('/tmp/seed_token.txt', token.token)
rescue => e
  write_private('/tmp/seed_token.txt', 'ERROR: ' + e.message)
end
RUBY
cat > "$TMP_DIR/revoke-token.rb" <<'RUBY'
PersonalAccessToken.where(
  name: 'seed-script-token', user_id: 1, revoked: false
).find_each { |token| token.revoke! }
RUBY
# MSYS_NO_PATHCONV=1 prevents Git Bash on Windows from translating /tmp/... container
# paths to Windows paths when passed as arguments to docker exec.
CONTAINER_TEMP_USED=1
MSYS_NO_PATHCONV=1 docker exec -i gitlab sh -c \
  'umask 077; cat > /tmp/seed_runner.rb; chown git:git /tmp/seed_runner.rb' \
  < "$TMP_DIR/runner.rb" 2>/dev/null
PAT_CLEANUP_REQUIRED=1
run_gitlab_rails_runner /tmp/seed_runner.rb "Creating the seed API token"
MSYS_NO_PATHCONV=1 docker exec gitlab rm -f /tmp/seed_runner.rb 2>/dev/null || true

TOKEN=$(MSYS_NO_PATHCONV=1 docker exec gitlab cat /tmp/seed_token.txt 2>/dev/null || true)
MSYS_NO_PATHCONV=1 docker exec gitlab rm -f /tmp/seed_token.txt 2>/dev/null || true

if [ -z "$TOKEN" ] || [[ "$TOKEN" == ERROR:* ]]; then
  echo "ERROR: Could not create API token."
  echo "  Make sure GitLab is fully started and try again."
  exit 1
fi
echo "Token obtained."
fi

CURL_CONFIG="$TMP_DIR/curl-token.conf"
printf 'header = "PRIVATE-TOKEN: %s"\n' "$TOKEN" > "$CURL_CONFIG"

# ── Helper: call GitLab API ───────────────────────────────────────────────────
api() {
  local method="$1"; local path="$2"; shift 2
  curl --silent --show-error --fail \
    --connect-timeout 5 --max-time 60 \
    --config "$CURL_CONFIG" \
    --request "$method" \
    -H "Content-Type: application/json" \
    "$@" "$GITLAB_URL/api/v4/$path"
}

if [ -n "${GITLAB_TOKEN:-}" ]; then
  TOKEN_IS_ADMIN=$(api GET "user" \
    | python3 -c "import sys,json; print(str(json.load(sys.stdin).get('is_admin', False)).lower())")
  TOKEN_HAS_API_SCOPE=$(api GET "personal_access_tokens/self" \
    | python3 -c "import sys,json; print(str('api' in json.load(sys.stdin).get('scopes', [])).lower())")
  if [ "$TOKEN_IS_ADMIN" != "true" ] || [ "$TOKEN_HAS_API_SCOPE" != "true" ]; then
    echo "ERROR: GITLAB_TOKEN must belong to a GitLab administrator and include api scope." >&2
    exit 1
  fi
fi

# ── 0. Disable public sign-up ─────────────────────────────────────────────────
# This is a closed demo instance — only root and the seeded 'demo' user should
# ever be able to log in. NOTE: gitlab_rails['gitlab_signup_enabled'] in
# docker-compose.yml only seeds this on a genuinely first-ever boot (a fresh
# volume) — omnibus deliberately does not re-apply ApplicationSetting-backed
# config on every reconfigure, so it never overwrites changes made via the
# Admin UI. On an already-provisioned instance that line is a no-op, so it is
# enforced here too via the API, which works regardless of volume age.
echo "Disabling public sign-up..."
api PUT "application/settings" -d '{"signup_enabled":false}' > /dev/null
echo "  signup_enabled=false"

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
  USER_PAYLOAD="$TMP_DIR/create-user.json"
  DEMO_PASSWORD="$DEMO_PASSWORD" python3 -c '
import json
import os
import sys

json.dump({
    "name": "Demo User",
    "username": "demo",
    "email": "demo@example.com",
    "password": os.environ["DEMO_PASSWORD"],
    "skip_confirmation": True,
}, sys.stdout)
' > "$USER_PAYLOAD"
  USER_ID=$(api POST "users" --data-binary @"$USER_PAYLOAD" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
  echo "  Created user 'demo' (id=$USER_ID)"
else
  echo "  User 'demo' already exists (id=$USER_ID)"

  if [ -n "${GITLAB_TOKEN:-}" ]; then
    echo "  Existing demo password unchanged (Rails-free token path)"
  else
    # The Users API forces a password change after an administrator resets a
    # password. Update through bounded Rails execution so the repeatable demo
    # login remains usable without allowing a stuck runner to hang forever.
    cat > "$TMP_DIR/update-demo-password.rb" <<'RUBY'
password = File.binread('/tmp/demo_password')
File.delete('/tmp/demo_password')
user = User.find_by!(username: 'demo')
user.password = password
user.password_confirmation = password
user.password_automatically_set = false
user.save!
RUBY
    MSYS_NO_PATHCONV=1 docker exec -i gitlab sh -c \
      'umask 077; cat > /tmp/update-demo-password.rb; chown git:git /tmp/update-demo-password.rb' \
      < "$TMP_DIR/update-demo-password.rb" 2>/dev/null
    printf '%s' "$DEMO_PASSWORD" | MSYS_NO_PATHCONV=1 docker exec -i gitlab sh -c \
      'umask 077; cat > /tmp/demo_password; chown git:git /tmp/demo_password'
    run_gitlab_rails_runner /tmp/update-demo-password.rb \
      "Synchronizing the demo-user password"
    MSYS_NO_PATHCONV=1 docker exec gitlab rm -f \
      /tmp/demo_password /tmp/update-demo-password.rb 2>/dev/null || true
    echo "  Synchronized the configured demo-user password"
  fi
fi

# Repair a persisted account that was blocked, deactivated, or left pending.
USER_STATE=$(api GET "users/$USER_ID" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('state',''))")
case "$USER_STATE" in
  active) ;;
  blocked_pending_approval)
    api POST "users/$USER_ID/approve" > /dev/null
    echo "  Approved pending demo user"
    ;;
  blocked)
    api POST "users/$USER_ID/unblock" > /dev/null
    echo "  Unblocked demo user"
    ;;
  deactivated)
    api POST "users/$USER_ID/activate" > /dev/null
    echo "  Reactivated demo user"
    ;;
  banned)
    api POST "users/$USER_ID/unban" > /dev/null
    echo "  Unbanned demo user"
    ;;
  *)
    echo "ERROR: Demo user has unsupported state '$USER_STATE'."
    exit 1
    ;;
esac
api PUT "users/$USER_ID" --data '{"external":false,"admin":false}' > /dev/null

# Enforce Developer access on every run instead of only creating membership.
MEMBER_LEVEL=$(api GET "groups/$GROUP_ID/members/$USER_ID" 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_level',''))" 2>/dev/null || true)
if [ -z "$MEMBER_LEVEL" ]; then
  MEMBER_PAYLOAD="$TMP_DIR/add-member.json"
  USER_ID="$USER_ID" python3 -c '
import json
import os
import sys

json.dump({"user_id": int(os.environ["USER_ID"]), "access_level": 30}, sys.stdout)
' > "$MEMBER_PAYLOAD"
  api POST "groups/$GROUP_ID/members" --data-binary @"$MEMBER_PAYLOAD" > /dev/null
  echo "  Added 'demo' to group as Developer"
elif [ "$MEMBER_LEVEL" != "30" ]; then
  api PUT "groups/$GROUP_ID/members/$USER_ID" \
    --data '{"access_level":30}' > /dev/null
  echo "  Restored 'demo' group role to Developer"
else
  echo "  Demo user has Developer access"
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
  PROJECT_PAYLOAD="$TMP_DIR/create-project.json"
  GROUP_ID="$GROUP_ID" python3 -c '
import json
import os
import sys

json.dump({
    "name": "Weather Dashboard",
    "path": "weather-dashboard",
    "namespace_id": int(os.environ["GROUP_ID"]),
    "visibility": "internal",
    "initialize_with_readme": False,
    "description": "SDLC Harness demo app - a deterministic mock weather dashboard",
}, sys.stdout)
' > "$PROJECT_PAYLOAD"
  PROJECT_ID=$(api POST "projects" --data-binary @"$PROJECT_PAYLOAD" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
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
  encoded_path=$(FILE_PATH="$file_path" python3 -c \
    "import os, urllib.parse; print(urllib.parse.quote(os.environ['FILE_PATH'], safe=''))")

  # Check if the file already exists
  local exists
  exists=$(api GET "projects/$PROJECT_ID/repository/files/${encoded_path}?ref=main" 2>/dev/null \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('file_name',''))" 2>/dev/null || true)

  if [ -z "$exists" ]; then
    local payload_file="$TMP_DIR/add-file.json"
    COMMIT_MSG="$commit_msg" python3 -c '
import base64
import json
import os
import sys

content = base64.b64encode(sys.stdin.buffer.read()).decode("ascii")
json.dump({
    "branch": "main",
    "content": content,
    "commit_message": os.environ["COMMIT_MSG"],
    "encoding": "base64",
}, sys.stdout)
' < "$src_file" > "$payload_file"
    api POST "projects/$PROJECT_ID/repository/files/${encoded_path}" \
      --data-binary @"$payload_file" > /dev/null
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

# Reuse this script's token for the issue fixtures. This keeps `seed.sh` as the
# single seed entry point and avoids a second Rails boot on every invocation.
echo ""
echo "Seeding issue fixtures..."
GITLAB_TOKEN="$TOKEN" bash "$SCRIPT_DIR/seed-issues.sh"
unset TOKEN

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo " Demo seed complete!"
echo "════════════════════════════════════════"
echo ""
echo " GitLab URL  : http://localhost:8080"
echo ""
echo " Root login"
echo "   Username  : root"
echo " Demo user login"
echo "   Username  : demo"
echo ""
echo " Root and demo passwords are configured separately in gitlab-local/.env."
echo " Passwords are deliberately not printed."
echo ""
echo " Demo project"
echo "   URL       : http://localhost:8080/sdlc-harness/weather-dashboard"
echo ""
