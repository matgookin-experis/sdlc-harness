#!/usr/bin/env bash
# seed-issues.sh — Seed the demo project with intentionally incomplete issues.
#
# Creates 12 issues in the weather-dashboard project that provide visible
# signal for every P0 agent and the P1 test-coverage agent:
#
#   AC  agent  → issues 1, 2, 3, 5, 6, 8, 10, 11 (no populated AC section)
#   AM  agent  → issues 2, 6, 10       (vague language / undefined "thing")
#   DEP agent  → issues 3+4, 7+8, 11+12 (semantic overlap, no links set)
#   ST  agent  → issue 5: In Progress → In Review; issue 9: Open → In Progress
#   TC  agent  → all Story/Bug issues   (no test file references anywhere)
#
# Safe to run multiple times — existing fixtures are reconciled to their expected state.
#
# Prerequisites:
#   - GitLab instance running at http://localhost:8080
#   - seed.sh already run (group + project + demo user exist)
#   - GITLAB_ROOT_PASSWORD in environment or gitlab-local/.env
#
# Usage:
#   bash seed-issues.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Read only the required value. The .env file is data, not shell code.
# shellcheck source=env.sh
. "$SCRIPT_DIR/env.sh"
require_private_env_file "$SCRIPT_DIR/.env"
load_env_value GITLAB_ROOT_PASSWORD "$SCRIPT_DIR/.env"

if [ -z "${GITLAB_ROOT_PASSWORD:-}" ]; then
  echo "ERROR: GITLAB_ROOT_PASSWORD is not set."
  echo "  Copy gitlab-local/.env.example to gitlab-local/.env and set the variable."
  exit 1
fi
if [ "$GITLAB_ROOT_PASSWORD" = "change_me_before_starting" ]; then
  echo "ERROR: GITLAB_ROOT_PASSWORD still has the placeholder value from .env.example."
  exit 1
fi
if [ "${#GITLAB_ROOT_PASSWORD}" -lt 8 ]; then
  echo "ERROR: GITLAB_ROOT_PASSWORD must contain at least 8 characters."
  exit 1
fi

GITLAB_URL="http://127.0.0.1:8080"

# Use a temp dir relative to SCRIPT_DIR so its path resolves to a real Windows
# filesystem path (not /tmp) — docker cp requires a path that Windows can resolve.
TMP_DIR="$SCRIPT_DIR/.seed-issues-tmp"
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
        cat /tmp/seed_issues_token.txt 2>/dev/null || true)
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
        'umask 077; cat > /tmp/seed_issues_revoke_token.rb; chown git:git /tmp/seed_issues_revoke_token.rb' \
        < "$TMP_DIR/revoke-token.rb" >/dev/null 2>&1; then
        run_gitlab_rails_runner /tmp/seed_issues_revoke_token.rb \
          "Revoking the issue-seed API token" 30 >/dev/null 2>&1 || cleanup_status=1
      else
        cleanup_status=1
      fi
    fi
  fi

  unset cleanup_token

  if [ "$CONTAINER_TEMP_USED" -eq 1 ]; then
    MSYS_NO_PATHCONV=1 docker exec gitlab rm -f \
      /tmp/seed_issues_runner.rb \
      /tmp/seed_issues_revoke_token.rb \
      /tmp/seed_issues_token.txt \
      >/dev/null 2>&1 || cleanup_status=1
  fi

  rm -rf "$TMP_DIR" || cleanup_status=1
  if [ "$cleanup_status" -ne 0 ]; then
    echo "ERROR: Could not fully revoke the issue-seed PAT or remove token files." >&2
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi
  exit "$status"
}

trap cleanup EXIT

# ── Wait for GitLab ───────────────────────────────────────────────────────────
echo "Waiting for GitLab to be ready..."
for i in $(seq 1 20); do
  status="000"
  status=$(curl --silent --output /dev/null --write-out "%{http_code}" \
    --connect-timeout 3 --max-time 5 "$GITLAB_URL/users/sign_in" 2>/dev/null) \
    || status="000"
  if [ "$status" = "200" ]; then
    echo "GitLab is ready."
    break
  fi
  echo "  [$i/20] HTTP $status — retrying in 10s..."
  sleep 10
  if [ "$i" -eq 20 ]; then
    echo "ERROR: GitLab did not become ready. Run ./manage.sh start first."
    exit 1
  fi
done

# ── Get or create API token ───────────────────────────────────────────────────
# The Ruby script is written to a local temp file and streamed into the container
# via stdin (docker exec -i ... < file) rather than passed as an inline quoted
# argument — see seed.sh for why: on Git Bash for Windows, an inline multi-line
# quoted argument to `gitlab-rails runner "..."` can hang or get mis-parsed
# depending on the MSYS/pwsh layer invoking bash. Streaming via stdin sidesteps
# all of that.
echo ""
echo "Creating API token..."
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
    name: 'seed-issues-token', user_id: 1, revoked: false
  ).find_each { |existing| existing.revoke! }
  token = User.find(1).personal_access_tokens.create!(
    name: 'seed-issues-token',
    scopes: [:api],
    expires_at: Date.today + 1
  )
  write_private('/tmp/seed_issues_token.txt', token.token)
rescue => e
  write_private('/tmp/seed_issues_token.txt', 'ERROR: ' + e.message)
end
RUBY
cat > "$TMP_DIR/revoke-token.rb" <<'RUBY'
PersonalAccessToken.where(
  name: 'seed-issues-token', user_id: 1, revoked: false
).find_each { |token| token.revoke! }
RUBY
CONTAINER_TEMP_USED=1
MSYS_NO_PATHCONV=1 docker exec -i gitlab sh -c \
  'umask 077; cat > /tmp/seed_issues_runner.rb; chown git:git /tmp/seed_issues_runner.rb' \
  < "$TMP_DIR/runner.rb" 2>/dev/null
PAT_CLEANUP_REQUIRED=1
run_gitlab_rails_runner /tmp/seed_issues_runner.rb "Creating the issue-seed API token"
MSYS_NO_PATHCONV=1 docker exec gitlab rm -f /tmp/seed_issues_runner.rb 2>/dev/null || true

TOKEN=$(MSYS_NO_PATHCONV=1 docker exec gitlab cat /tmp/seed_issues_token.txt 2>/dev/null || true)
MSYS_NO_PATHCONV=1 docker exec gitlab rm -f /tmp/seed_issues_token.txt 2>/dev/null || true

if [ -z "$TOKEN" ] || [[ "$TOKEN" == ERROR:* ]]; then
  echo "ERROR: Could not create API token."
  exit 1
fi
echo "Token obtained."
fi

CURL_CONFIG="$TMP_DIR/curl-token.conf"
printf 'header = "PRIVATE-TOKEN: %s"\n' "$TOKEN" > "$CURL_CONFIG"
unset TOKEN

# ── Helper: GitLab API call ───────────────────────────────────────────────────
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

# ── Resolve project ID ────────────────────────────────────────────────────────
echo ""
echo "Resolving project ID..."
PROJECT_ID=$(api GET "projects?search=weather-dashboard" | python3 -c "
import sys, json
ps = [p for p in json.load(sys.stdin) if p['path_with_namespace'] == 'sdlc-harness/weather-dashboard']
print(ps[0]['id'] if ps else '')
" 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
  echo "ERROR: Project 'sdlc-harness/weather-dashboard' not found."
  echo "  Run './manage.sh seed' first to create the project."
  exit 1
fi
echo "  Project ID: $PROJECT_ID"

# ── Ensure required labels exist ─────────────────────────────────────────────
echo ""
echo "Ensuring labels exist..."

ensure_label() {
  local name="$1"; local color="$2"
  local exists
  exists=$(api GET "projects/$PROJECT_ID/labels?per_page=100" \
    | NAME="$name" python3 -c '
import json
import os
import sys

labels = [label for label in json.load(sys.stdin) if label["name"] == os.environ["NAME"]]
print("yes" if labels else "")
' 2>/dev/null)
  if [ -z "$exists" ]; then
    NAME="$name" COLOR="$color" python3 -c '
import json
import os
import sys

json.dump({"name": os.environ["NAME"], "color": os.environ["COLOR"]}, sys.stdout)
' | api POST "projects/$PROJECT_ID/labels" --data-binary @- > /dev/null
    echo "  Created label: $name"
  else
    echo "  Label already exists: $name"
  fi
}

ensure_label "Story"  "#428BCA"
ensure_label "Bug"    "#D9534F"
ensure_label "Task"   "#5CB85C"
ensure_label "Epic"   "#8E44AD"
ensure_label "Open"        "#1F75CB"
ensure_label "In Progress" "#FBCA04"
ensure_label "In Review"   "#D4C5F9"
ensure_label "Done"        "#0E8A16"

# ── Helper: create issue (idempotent by title) ────────────────────────────────
# Title/description are passed to python via environment variables, never
# interpolated into inline `python3 -c "..."` source and never read from a
# file path built from bash's own $PWD. Two reasons:
#  1. Descriptions are multi-line — embedding them directly into a
#     single-quoted Python string literal breaks as soon as it hits a real
#     newline (Python single-quoted strings don't span physical lines).
#  2. On Git Bash for Windows, `pwd` yields an MSYS-style path (e.g. `/c/...`).
#     Bash's own `<file` redirection understands that transparently, but a
#     *native Windows* python3.exe's own open('/c/...') does not — it silently
#     raises FileNotFoundError, which a trailing `2>/dev/null || true` then
#     swallows, making every already-created issue look "not found" and
#     seeding duplicates on every re-run.
# Environment variables sidestep both: no source-code embedding, no path
# translation, exact bytes preserved on any platform.
create_issue() {
  local title="$1"
  local description="$2"
  local type_label="$3"
  local state="${4:-opened}"   # opened | closed
  local workflow_label="${5:-Open}"
  local labels="$type_label,$workflow_label"

  # Skip if an issue with this exact title already exists
  local encoded_title
  encoded_title=$(TITLE="$title" python3 -c \
    "import os, urllib.parse; print(urllib.parse.quote(os.environ['TITLE'], safe=''))")

  local existing_json
  existing_json=$(api GET "projects/$PROJECT_ID/issues?search=${encoded_title}&per_page=100" \
    | TITLE="$title" python3 -c "
import sys, json, os
title = os.environ['TITLE']
issues = [i for i in json.load(sys.stdin) if i['title'] == title]
print(json.dumps(issues[0]) if issues else '')
" 2>/dev/null)

  if [ -n "$existing_json" ]; then
    local existing_iid
    local update_payload
    existing_iid=$(EXISTING_JSON="$existing_json" python3 -c \
      "import json,os; print(json.loads(os.environ['EXISTING_JSON'])['iid'])")
    update_payload=$(EXISTING_JSON="$existing_json" DESCRIPTION="$description" \
      LABELS="$labels" STATE="$state" python3 -c '
import json
import os

issue = json.loads(os.environ["EXISTING_JSON"])
desired_labels = [label.strip() for label in os.environ["LABELS"].split(",") if label.strip()]
payload = {}
if issue.get("description") != os.environ["DESCRIPTION"]:
    payload["description"] = os.environ["DESCRIPTION"]
if sorted(issue.get("labels", [])) != sorted(desired_labels):
    payload["labels"] = ",".join(desired_labels)
desired_state = os.environ["STATE"]
if issue.get("state") != desired_state:
    payload["state_event"] = "reopen" if desired_state == "opened" else "close"
print(json.dumps(payload, separators=(",", ":")))
')
    if [ "$update_payload" != "{}" ]; then
      api PUT "projects/$PROJECT_ID/issues/$existing_iid" \
        --data-binary "$update_payload" > /dev/null
      echo "  Reconciled #$existing_iid: $title"
    else
      echo "  Already matches (iid=$existing_iid): $title"
    fi
    return
  fi

  local iid
  iid=$(
    TITLE="$title" DESCRIPTION="$description" LABELS="$labels" python3 -c '
import json
import os
import sys

json.dump({
    "title": os.environ["TITLE"],
    "description": os.environ["DESCRIPTION"],
    "labels": os.environ["LABELS"],
}, sys.stdout)
' | api POST "projects/$PROJECT_ID/issues" --data-binary @- \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['iid'])"
  )

  if [ "$state" = "closed" ]; then
    api PUT "projects/$PROJECT_ID/issues/$iid" -d '{"state_event":"close"}' > /dev/null
  fi

  echo "  Created #$iid: $title"
}

# ── Issue definitions ─────────────────────────────────────────────────────────
echo ""
echo "Seeding demo issues..."
echo "────────────────────────────────────────────────"

# ── [AC] Issue 1 — Missing AC: vague Story ────────────────────────────────────
# Target: AC agent should detect no Given-When-Then block
create_issue \
  "Add 5-day weather forecast widget" \
  "Users should be able to see a multi-day forecast on the dashboard.

The widget should show temperature highs and lows for each day and update automatically." \
  "Story"

# ── [AM] Issue 2 — Ambiguous: vague language ─────────────────────────────────
# Target: Ambiguity agent should flag "fix it", "the thing"
create_issue \
  "Fix the thing on the settings page" \
  "The notification preference resets to its default after the settings page reloads.
The thing that saves it is broken. Fix it." \
  "Bug"

# ── [AC + DEP] Issue 3 — Missing AC + semantic overlap with Issue 4 ──────────
# Target: AC agent (no AC block) + Dependency agent (JWT overlap with #4)
create_issue \
  "Implement JWT token refresh" \
  "The app must refresh expired JWT tokens without logging the user out.

The /auth/refresh endpoint should be called automatically when a 401 response is received.
No user interaction should be required for a seamless token refresh." \
  "Story"

# ── [DEP] Issue 4 — Semantic overlap with Issue 3 ────────────────────────────
# Target: Dependency agent should propose #3 blocks #4 (has a small AC section to avoid AC flag)
create_issue \
  "Handle auth token expiry in API calls" \
  "All API calls should transparently retry after refreshing the auth token.

**Acceptance Criteria**
Given a valid session that has just expired
When the user performs an action that triggers an API call
Then the app silently refreshes the token and completes the request without prompting the user

Note: this depends on the token refresh mechanism being available." \
  "Story"

# ── [AC + ST] Issue 5 — Missing AC, stale state (MR will reference it) ───────
# Target: AC agent (no AC) + State-transition agent (linked MR is merged, issue stays open)
create_issue \
  "Deploy weather-app to staging environment" \
  "Set up a CI pipeline that builds the weather-app Docker image and deploys it to the
staging environment on every push to main." \
  "Task" \
  "opened" \
  "In Progress"

# ── [AM] Issue 6 — Vague description ─────────────────────────────────────────
# Target: Ambiguity agent — "improve" and "better" are vague quality terms with no measurable target
create_issue \
  "Improve the search feature" \
  "The search doesn't work well. Make it better and faster so users can find cities more easily." \
  "Story"

# ── [DEP] Issue 7 — Semantic overlap with Issue 8 ────────────────────────────
# Target: Dependency agent should propose relates-to link between #7 and #8
create_issue \
  "Add dark mode toggle to navigation bar" \
  "Add a button to the top navigation bar that toggles between light and dark themes.
The preference should be saved to localStorage so it persists across sessions.

**Acceptance Criteria**
Given a user on any page
When they click the dark mode toggle in the nav bar
Then the theme switches immediately and the preference is saved to localStorage" \
  "Story"

# ── [AC + DEP] Issue 8 — Missing AC + theme overlap with Issue 7 ─────────────
# Target: AC agent (no AC) + Dependency agent (localStorage + theme overlap with #7)
create_issue \
  "Persist user theme preference across page reloads" \
  "The app should remember the user's theme choice (light/dark) between visits.
On load, read the stored preference from localStorage and apply it before the first render
to avoid a flash of unstyled content." \
  "Story"

# ── [ST] Issue 9 — Open but ready for transition ─────────────────────────────
# State-transition agent: issue is Open, but description shows all work done.
# Will be referenced by a merge request created below.
create_issue \
  "Add temperature unit toggle (Celsius / Fahrenheit)" \
  "Add a toggle in the dashboard header that switches all displayed temperatures between
Celsius and Fahrenheit. The selected unit should persist in localStorage.

**Acceptance Criteria**
Given a user viewing the dashboard
When they click the C°/F° toggle
Then all temperature values update immediately and the unit is saved to localStorage" \
  "Story"

# ── [AM] Issue 10 — Vague with undefined scope ───────────────────────────────
# Ambiguity agent: "make it look nicer" is non-actionable
create_issue \
  "Clean up the UI" \
  "The dashboard UI looks a bit cluttered. Make it look nicer and more professional.
Some things could be aligned better and the colours don't look right." \
  "Task"

# ── [DEP + AC] Issue 11 — Missing AC + semantic overlap with Issue 12 ─────────
# AC agent (no AC) + Dependency agent (both touch location/geolocation)
create_issue \
  "Auto-detect user location on first load" \
  "On first load, request the browser's geolocation API to detect the user's city and
pre-populate the search field. If the user denies the permission, fall back to a default city." \
  "Story"

# ── [DEP] Issue 12 — Semantic overlap with Issue 11 ─────────────────────────
# Dependency agent: both deal with location/city resolution
create_issue \
  "Add recent locations dropdown to search" \
  "After a user searches for a city, save it to a recent searches list (up to 5 entries,
stored in localStorage). Show a dropdown with recent cities when the search field is focused.

**Acceptance Criteria**
Given a user who has previously searched for cities
When they focus the search input
Then a dropdown of up to 5 recent cities is displayed
And clicking a city loads its weather immediately" \
  "Story"

# ── Create and merge an MR referencing Issues 5 and 9 ─────────────────────────
# The MR deliberately uses non-closing references so both issues remain open.
# Issue 5 starts In Progress and advances to In Review; issue 9 starts Open and
# advances one legal edge to In Progress.
echo ""
echo "Creating merged-MR state-transition fixture..."

find_issue_iid() {
  local title="$1"
  local encoded_title

  encoded_title=$(TITLE="$title" python3 -c \
    "import os, urllib.parse; print(urllib.parse.quote(os.environ['TITLE'], safe=''))")
  api GET "projects/$PROJECT_ID/issues?search=${encoded_title}&per_page=100" \
    | TITLE="$title" python3 -c '
import json
import os
import sys

issues = [issue for issue in json.load(sys.stdin) if issue["title"] == os.environ["TITLE"]]
print(issues[0]["iid"] if issues else "")
'
}

ISSUE5_IID=$(find_issue_iid "Deploy weather-app to staging environment")
ISSUE9_IID=$(find_issue_iid "Add temperature unit toggle (Celsius / Fahrenheit)")
if [ -z "$ISSUE5_IID" ] || [ -z "$ISSUE9_IID" ]; then
  echo "ERROR: Could not resolve both state-transition fixture issues."
  exit 1
fi

BRANCH_NAME="ci-staging-deploy"
ENCODED_BRANCH=$(BRANCH_NAME="$BRANCH_NAME" python3 -c \
  "import os, urllib.parse; print(urllib.parse.quote(os.environ['BRANCH_NAME'], safe=''))")
BRANCH_EXISTS=$(api GET "projects/$PROJECT_ID/repository/branches?per_page=100" \
  | BRANCH_NAME="$BRANCH_NAME" python3 -c '
import json
import os
import sys

branches = [branch for branch in json.load(sys.stdin) if branch["name"] == os.environ["BRANCH_NAME"]]
print(branches[0]["name"] if branches else "")
')

if [ -z "$BRANCH_EXISTS" ]; then
  DEFAULT_SHA=$(api GET "projects/$PROJECT_ID/repository/branches/main" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['commit']['id'])")

  BRANCH_NAME="$BRANCH_NAME" DEFAULT_SHA="$DEFAULT_SHA" python3 -c '
import json
import os
import sys

json.dump({
    "branch": os.environ["BRANCH_NAME"],
    "ref": os.environ["DEFAULT_SHA"],
}, sys.stdout)
' | api POST "projects/$PROJECT_ID/repository/branches" --data-binary @- > /dev/null
  echo "  Created branch: $BRANCH_NAME"
fi

OPEN_MR_IID=$(api GET \
  "projects/$PROJECT_ID/merge_requests?source_branch=${ENCODED_BRANCH}&state=opened&per_page=20" \
  | python3 -c "import sys,json; mrs=json.load(sys.stdin); print(mrs[0]['iid'] if mrs else '')")
MERGED_MR_IID=$(api GET \
  "projects/$PROJECT_ID/merge_requests?source_branch=${ENCODED_BRANCH}&state=merged&per_page=20" \
  | python3 -c "import sys,json; mrs=json.load(sys.stdin); print(mrs[0]['iid'] if mrs else '')")

if [ -n "$MERGED_MR_IID" ]; then
  MERGED_AT=$(api GET "projects/$PROJECT_ID/merge_requests/$MERGED_MR_IID" \
    | python3 -c "import sys,json; print(json.load(sys.stdin).get('merged_at') or '')")
  ISSUE5_UPDATED_AT=$(api GET "projects/$PROJECT_ID/issues/$ISSUE5_IID" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['updated_at'])")
  ISSUE9_UPDATED_AT=$(api GET "projects/$PROJECT_ID/issues/$ISSUE9_IID" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['updated_at'])")
  MERGED_MR_CURRENT=$(MERGED_AT="$MERGED_AT" ISSUE5_UPDATED_AT="$ISSUE5_UPDATED_AT" \
    ISSUE9_UPDATED_AT="$ISSUE9_UPDATED_AT" python3 -c '
import datetime
import os

merged_at = os.environ["MERGED_AT"]
if not merged_at:
    print("no")
    raise SystemExit

def parse(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))

latest_issue = max(parse(os.environ["ISSUE5_UPDATED_AT"]), parse(os.environ["ISSUE9_UPDATED_AT"]))
print("yes" if parse(merged_at) >= latest_issue else "no")
' 2>/dev/null || echo "no")
  if [ "$MERGED_MR_CURRENT" != "yes" ]; then
    MERGED_MR_IID=""
  fi
fi

branch_ahead_count() {
  api GET "projects/$PROJECT_ID/repository/compare?from=main&to=${ENCODED_BRANCH}" \
    | python3 -c "import sys,json; print(len(json.load(sys.stdin)['commits']))"
}

create_fixture_commit() {
  local default_sha
  local fixture_path
  local encoded_fixture_path

  default_sha=$(api GET "projects/$PROJECT_ID/repository/branches/main" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['commit']['id'])")
  # A prior fixture merge changes main's SHA, so this path is new whenever a
  # replacement fixture MR is required and creates a guaranteed branch delta.
  fixture_path=".gitlab/fixtures/staging-deploy-${default_sha}.yml"
  encoded_fixture_path=$(FILE_PATH="$fixture_path" python3 -c \
    "import os, urllib.parse; print(urllib.parse.quote(os.environ['FILE_PATH'], safe=''))")

  BRANCH_NAME="$BRANCH_NAME" DEFAULT_SHA="$default_sha" \
    ISSUE5_IID="$ISSUE5_IID" ISSUE9_IID="$ISSUE9_IID" python3 -c '
import json
import os
import sys

content = (
    "# State-transition fixture\n"
    + "# Base main commit: {}\n".format(os.environ["DEFAULT_SHA"])
    + "# Referenced issues: #{} and #{}\n".format(
        os.environ["ISSUE5_IID"], os.environ["ISSUE9_IID"]
    )
    + "deploy-staging:\n"
    + "  stage: deploy\n"
    + "  script:\n"
    + "    - echo \"Deploy weather dashboard to staging\"\n"
    + "  environment:\n"
    + "    name: staging\n"
)
json.dump({
    "branch": os.environ["BRANCH_NAME"],
    "content": content,
    "commit_message": "Add staging deployment fixture",
}, sys.stdout)
' | api POST "projects/$PROJECT_ID/repository/files/$encoded_fixture_path" \
    --data-binary @- > /dev/null
  echo "  Created fixture commit at $fixture_path"
}

MR_IID=""
if [ -n "$OPEN_MR_IID" ]; then
  MR_IID="$OPEN_MR_IID"
  AHEAD_COUNT=$(branch_ahead_count)
  if [ "$AHEAD_COUNT" -eq 0 ]; then
    create_fixture_commit
    AHEAD_COUNT=$(branch_ahead_count)
  fi
  if [ "$AHEAD_COUNT" -le 0 ]; then
    echo "ERROR: Open fixture MR !$MR_IID has no commit that differs from main."
    exit 1
  fi
elif [ -n "$MERGED_MR_IID" ]; then
  MR_IID="$MERGED_MR_IID"
  echo "  Reusing merged MR !$MR_IID"
else
  AHEAD_COUNT=$(branch_ahead_count)
  if [ "$AHEAD_COUNT" -eq 0 ]; then
    create_fixture_commit
    AHEAD_COUNT=$(branch_ahead_count)
  fi

  if [ "$AHEAD_COUNT" -le 0 ]; then
    echo "ERROR: Fixture branch has no commit that differs from main."
    exit 1
  fi

  MR_IID=$(
    BRANCH_NAME="$BRANCH_NAME" python3 -c '
import json
import os
import sys

json.dump({
    "source_branch": os.environ["BRANCH_NAME"],
    "target_branch": "main",
    "title": "Staging deployment fixture",
}, sys.stdout)
' | api POST "projects/$PROJECT_ID/merge_requests" --data-binary @- \
      | python3 -c "import sys,json; print(json.load(sys.stdin)['iid'])"
  )
  echo "  Created MR !$MR_IID"
fi

MR_TITLE="feat: add staging deployment (#${ISSUE5_IID}, #${ISSUE9_IID})"
MR_DESCRIPTION="Adds the GitLab CI configuration for the staging deployment pipeline.

Related to #${ISSUE5_IID}
Related to #${ISSUE9_IID}"
MR_TITLE="$MR_TITLE" MR_DESCRIPTION="$MR_DESCRIPTION" python3 -c '
import json
import os
import sys

json.dump({
    "title": os.environ["MR_TITLE"],
    "description": os.environ["MR_DESCRIPTION"],
}, sys.stdout)
' | api PUT "projects/$PROJECT_ID/merge_requests/$MR_IID" --data-binary @- > /dev/null

MR_STATE=$(api GET "projects/$PROJECT_ID/merge_requests/$MR_IID" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])")
if [ "$MR_STATE" = "opened" ]; then
  MERGE_STATUS="unchecked"
  for i in $(seq 1 15); do
    MERGE_STATUS=$(api GET \
      "projects/$PROJECT_ID/merge_requests/$MR_IID?with_merge_status_recheck=true" \
      2>/dev/null | python3 -c '
import json
import sys

mr = json.load(sys.stdin)
status = mr.get("detailed_merge_status", "")
if status in ("", "unchecked"):
    status = mr.get("merge_status", status)
print(status)
' 2>/dev/null) || MERGE_STATUS="unavailable"

    if [ "$MERGE_STATUS" = "mergeable" ] \
      || [ "$MERGE_STATUS" = "can_be_merged" ]; then
      break
    fi
    if [ "$MERGE_STATUS" != "checking" ] \
      && [ "$MERGE_STATUS" != "unchecked" ] \
      && [ "$MERGE_STATUS" != "preparing" ] \
      && [ "$MERGE_STATUS" != "ci_still_running" ] \
      && [ "$MERGE_STATUS" != "unavailable" ]; then
      echo "ERROR: MR !$MR_IID is not mergeable (status: $MERGE_STATUS)."
      exit 1
    fi
    if [ "$i" -eq 15 ]; then
      echo "ERROR: MR !$MR_IID did not become mergeable (status: $MERGE_STATUS)."
      exit 1
    fi
    sleep 2
  done

  BRANCH_SHA=$(api GET "projects/$PROJECT_ID/repository/branches/$ENCODED_BRANCH" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['commit']['id'])")
  BRANCH_SHA="$BRANCH_SHA" python3 -c '
import json
import os
import sys

json.dump({
    "sha": os.environ["BRANCH_SHA"],
    "should_remove_source_branch": False,
}, sys.stdout)
' | api PUT "projects/$PROJECT_ID/merge_requests/$MR_IID/merge" \
    --data-binary @- > /dev/null
fi

MR_STATE=$(api GET "projects/$PROJECT_ID/merge_requests/$MR_IID" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['state'])")
if [ "$MR_STATE" != "merged" ]; then
  echo "ERROR: MR !$MR_IID is '$MR_STATE', expected 'merged'."
  exit 1
fi

echo "  MR !$MR_IID is merged; Issues #$ISSUE5_IID and #$ISSUE9_IID remain open"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo " Demo issues seeded!"
echo "════════════════════════════════════════"
echo ""
echo " Project URL  : http://localhost:8080/sdlc-harness/weather-dashboard"
echo ""
echo " Agent coverage:"
echo "   AC  agent  : Issues with missing acceptance criteria (1, 2, 3, 5, 6, 8, 10, 11)"
echo "   AM  agent  : Issues with vague language (2, 6, 10)"
echo "   DEP agent  : Semantic overlaps (3↔4 auth, 7↔8 themes, 11↔12 location)"
echo "   ST  agent  : #$ISSUE5_IID In Progress → In Review; #$ISSUE9_IID Open → In Progress"
echo "   TC  agent  : All Story/Bug issues have no test file references"
echo ""
echo " Run 'govern my backlog' in Bob → Audit to see all findings."
echo ""
