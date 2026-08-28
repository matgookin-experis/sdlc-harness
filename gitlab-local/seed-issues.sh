#!/usr/bin/env bash
# seed-issues.sh — Seed the demo project with intentionally incomplete issues.
#
# Creates 12 issues in the weather-dashboard project that provide visible
# signal for every P0 agent and the P1 test-coverage agent:
#
#   AC  agent  → issues 1, 3, 5, 8     (no Given-When-Then AC)
#   AM  agent  → issues 2, 6, 10       (vague language / undefined "thing")
#   DEP agent  → issues 3+4, 7+8, 11+12 (semantic overlap, no links set)
#   ST  agent  → issues 5, 9           (Open but linked MR exists or is merged)
#   TC  agent  → all Story/Bug issues   (no test file references anywhere)
#
# Safe to run multiple times — skips issues whose titles already exist.
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

# Load .env if present and GITLAB_ROOT_PASSWORD is not already set
if [ -z "${GITLAB_ROOT_PASSWORD:-}" ] && [ -f "$SCRIPT_DIR/.env" ]; then
  # shellcheck disable=SC1091
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

if [ -z "${GITLAB_ROOT_PASSWORD:-}" ]; then
  echo "ERROR: GITLAB_ROOT_PASSWORD is not set."
  echo "  Copy gitlab-local/.env.example to gitlab-local/.env and set the variable."
  exit 1
fi

GITLAB_URL="http://localhost:8080"

# ── Wait for GitLab ───────────────────────────────────────────────────────────
echo "Waiting for GitLab to be ready..."
for i in $(seq 1 20); do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$GITLAB_URL/users/sign_in" 2>&1)
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
echo ""
echo "Creating API token..."
docker exec gitlab gitlab-rails runner "
  begin
    PersonalAccessToken.where(name: 'seed-issues-token', user_id: 1).delete_all
    token = User.find(1).personal_access_tokens.create!(
      name: 'seed-issues-token',
      scopes: [:api],
      expires_at: Date.today + 365
    )
    File.write('/tmp/seed_issues_token.txt', token.token)
  rescue => e
    File.write('/tmp/seed_issues_token.txt', 'ERROR: ' + e.message)
  end
" 2>/dev/null

TOKEN=$(docker exec gitlab cat /tmp/seed_issues_token.txt 2>/dev/null || true)
docker exec gitlab rm -f /tmp/seed_issues_token.txt 2>/dev/null || true

if [ -z "$TOKEN" ] || [[ "$TOKEN" == ERROR:* ]]; then
  echo "ERROR: Could not create API token: $TOKEN"
  exit 1
fi
echo "Token obtained."

# ── Helper: GitLab API call ───────────────────────────────────────────────────
api() {
  local method="$1"; local path="$2"; shift 2
  curl -sf -X "$method" \
    -H "PRIVATE-TOKEN: $TOKEN" \
    -H "Content-Type: application/json" \
    "$GITLAB_URL/api/v4/$path" "$@"
}

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
  exists=$(api GET "projects/$PROJECT_ID/labels?per_page=100" | python3 -c "
import sys, json
ls = [l for l in json.load(sys.stdin) if l['name'] == '$(echo "$name" | sed "s/'/'\\''/g")']
print('yes' if ls else '')
" 2>/dev/null)
  if [ -z "$exists" ]; then
    api POST "projects/$PROJECT_ID/labels" \
      -d "{\"name\":\"$name\",\"color\":\"$color\"}" > /dev/null
    echo "  Created label: $name"
  else
    echo "  Label already exists: $name"
  fi
}

ensure_label "Story"  "#428BCA"
ensure_label "Bug"    "#D9534F"
ensure_label "Task"   "#5CB85C"
ensure_label "Epic"   "#8E44AD"

# ── Helper: create issue (idempotent by title) ────────────────────────────────
create_issue() {
  local title="$1"
  local description="$2"
  local labels="$3"
  local state="${4:-opened}"   # opened | closed

  # Skip if an issue with this exact title already exists
  local existing
  existing=$(api GET "projects/$PROJECT_ID/issues?search=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$title', safe=''))")&per_page=100" \
    | python3 -c "
import sys, json
issues = [i for i in json.load(sys.stdin) if i['title'] == '''$title''']
print(issues[0]['iid'] if issues else '')
" 2>/dev/null || true)

  if [ -n "$existing" ]; then
    echo "  Skipping (already exists, iid=$existing): $title"
    return
  fi

  local iid
  iid=$(api POST "projects/$PROJECT_ID/issues" \
    -d "{\"title\":$(python3 -c "import json; print(json.dumps('$title'))"),
        \"description\":$(python3 -c "import json; print(json.dumps('$description'))"),
        \"labels\":\"$labels\"}" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['iid'])")

  if [ "$state" = "closed" ]; then
    api PUT "projects/$PROJECT_ID/issues/$iid" -d '{"state_event":"close"}' > /dev/null
  fi

  echo "  Created #$iid: $title"
  echo "$iid"
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
  "The settings page does not work properly. The thing that saves preferences is broken. Fix it." \
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
# Target: AC agent (no AC) + State-transition agent (MR !1 will close this issue but it stays open)
create_issue \
  "Deploy weather-app to staging environment" \
  "Set up a CI pipeline that builds the weather-app Docker image and deploys it to the
staging environment on every push to main." \
  "Task"

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

# ── Create a merge request referencing Issues 5 and 9 ─────────────────────────
# This gives the State-transition agent its "MR merged → propose In Review" signal.
echo ""
echo "Creating demo merge requests..."

# Check if 'ci-staging-deploy' branch exists
BRANCH_EXISTS=$(api GET "projects/$PROJECT_ID/repository/branches/ci-staging-deploy" \
  2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || true)

if [ -z "$BRANCH_EXISTS" ]; then
  # Get the default branch SHA to base the new branch on
  DEFAULT_SHA=$(api GET "projects/$PROJECT_ID/repository/branches/main" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['commit']['id'])")

  api POST "projects/$PROJECT_ID/repository/branches" \
    -d "{\"branch\":\"ci-staging-deploy\",\"ref\":\"$DEFAULT_SHA\"}" > /dev/null
  echo "  Created branch: ci-staging-deploy"
fi

# Check if an MR for this branch already exists
MR_EXISTS=$(api GET "projects/$PROJECT_ID/merge_requests?source_branch=ci-staging-deploy&per_page=5" \
  | python3 -c "import sys,json; mrs=json.load(sys.stdin); print(mrs[0]['iid'] if mrs else '')" 2>/dev/null || true)

if [ -z "$MR_EXISTS" ]; then
  # Find the iid of Issue 5 (Deploy weather-app to staging environment)
  ISSUE5_IID=$(api GET "projects/$PROJECT_ID/issues?search=Deploy+weather-app+to+staging+environment&per_page=20" \
    | python3 -c "
import sys, json
issues = [i for i in json.load(sys.stdin) if 'Deploy weather-app to staging environment' in i['title']]
print(issues[0]['iid'] if issues else '5')
" 2>/dev/null || echo "5")

  MR_IID=$(api POST "projects/$PROJECT_ID/merge_requests" \
    -d "{
      \"source_branch\": \"ci-staging-deploy\",
      \"target_branch\": \"main\",
      \"title\": \"feat: add CI pipeline for staging deploy\",
      \"description\": \"Adds the GitLab CI configuration for the staging deployment pipeline.\n\nCloses #${ISSUE5_IID}\",
      \"state\": \"opened\"
    }" | python3 -c "import sys,json; print(json.load(sys.stdin)['iid'])")
  echo "  Created MR !$MR_IID referencing Issue #$ISSUE5_IID (staging deploy)"
else
  echo "  MR for ci-staging-deploy already exists (!$MR_EXISTS) — skipping"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════"
echo " Demo issues seeded!"
echo "════════════════════════════════════════"
echo ""
echo " Project URL  : $GITLAB_URL/sdlc-harness/weather-dashboard"
echo ""
echo " Agent coverage:"
echo "   AC  agent  : Issues with missing acceptance criteria (1, 3, 5, 8, 11)"
echo "   AM  agent  : Issues with vague language (2, 6, 10)"
echo "   DEP agent  : Semantic overlaps (3↔4 auth, 7↔8 themes, 11↔12 location)"
echo "   ST  agent  : Stale-state issues (5 — has an open MR referencing it)"
echo "   TC  agent  : All Story/Bug issues have no test file references"
echo ""
echo " Run 'govern my backlog' in Bob → Audit to see all findings."
echo ""
