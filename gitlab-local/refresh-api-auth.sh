#!/usr/bin/env bash
# Create a fresh, project-scoped demo-user PAT and store it in the gitignored
# repository .env used by the MCP server and live review smoke test.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUNTIME_ENV="${SDLC_ENV_FILE:-$REPO_ROOT/.env}"
TMP_DIR="$SCRIPT_DIR/.token-tmp"
TOKEN_FILE="$TMP_DIR/token"
RUNNER_FILE="$TMP_DIR/runner.rb"

mkdir -p "$TMP_DIR"
chmod 700 "$TMP_DIR"
trap 'rm -rf "$TMP_DIR"' EXIT

if ! docker inspect --format='{{.State.Running}}' gitlab 2>/dev/null | grep -q true; then
  echo "ERROR: the gitlab container is not running." >&2
  exit 1
fi

cat > "$RUNNER_FILE" <<'RUBY'
begin
  user = User.find_by!(username: 'demo')
  PersonalAccessToken.where(user_id: user.id, name: 'sdlc-harness-runtime').delete_all
  token = user.personal_access_tokens.create!(
    name: 'sdlc-harness-runtime',
    scopes: [:api],
    expires_at: Date.today + 30
  )
  File.write('/tmp/sdlc_harness_runtime_token', token.token)
rescue => e
  File.write('/tmp/sdlc_harness_runtime_token', 'ERROR: ' + e.message)
end
RUBY

# MSYS_NO_PATHCONV=1 prevents Git Bash on Windows from translating these /tmp/...
# container paths to Windows host paths when passed as docker exec arguments (same
# fix already applied in seed.sh for the identical pattern) — without it, GitLab's
# Rails runner fails with "The file C:/Users/.../Temp/....rb could not be found"
# because the path never reaches the container as a Linux path at all.
MSYS_NO_PATHCONV=1 docker exec -i gitlab sh -c 'cat > /tmp/sdlc_harness_token_runner.rb' < "$RUNNER_FILE"
MSYS_NO_PATHCONV=1 docker exec gitlab gitlab-rails runner /tmp/sdlc_harness_token_runner.rb >/dev/null
MSYS_NO_PATHCONV=1 docker exec gitlab rm -f /tmp/sdlc_harness_token_runner.rb
MSYS_NO_PATHCONV=1 docker exec gitlab cat /tmp/sdlc_harness_runtime_token > "$TOKEN_FILE"
MSYS_NO_PATHCONV=1 docker exec gitlab rm -f /tmp/sdlc_harness_runtime_token
chmod 600 "$TOKEN_FILE"

TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
if [ -z "$TOKEN" ] || [[ "$TOKEN" == ERROR:* ]]; then
  echo "ERROR: GitLab did not create the runtime token." >&2
  exit 1
fi

ENV_TMP="$TMP_DIR/runtime.env"
if [ -f "$RUNTIME_ENV" ]; then
  awk -F= '$1 != "GITLAB_TOKEN" { print }' "$RUNTIME_ENV" > "$ENV_TMP"
else
  : > "$ENV_TMP"
fi
# Backfill GITLAB_HOST/GITLAB_PROJECT if this .env is pre-existing (e.g. from
# an unrelated template, such as this repo's WatsonX .env.example) and never
# had them — a rotate-only token append would otherwise leave the MCP server
# permanently missing two of its three required variables.
grep -q '^GITLAB_HOST=' "$ENV_TMP" || echo 'GITLAB_HOST=http://localhost:8080' >> "$ENV_TMP"
grep -q '^GITLAB_PROJECT=' "$ENV_TMP" || echo 'GITLAB_PROJECT=sdlc-harness/weather-dashboard' >> "$ENV_TMP"
grep -q '^SDLC_DEBUG=' "$ENV_TMP" || echo 'SDLC_DEBUG=false' >> "$ENV_TMP"
printf 'GITLAB_TOKEN=%s\n' "$TOKEN" >> "$ENV_TMP"
chmod 600 "$ENV_TMP"
mv "$ENV_TMP" "$RUNTIME_ENV"
chmod 600 "$RUNTIME_ENV"

status=$(curl -sS -o /dev/null -w '%{http_code}' \
  -H "PRIVATE-TOKEN: $TOKEN" http://localhost:8080/api/v4/user)
if [ "$status" != "200" ]; then
  echo "ERROR: the new token failed GitLab authentication (HTTP $status)." >&2
  exit 1
fi

echo "Runtime GitLab token refreshed and verified in $RUNTIME_ENV (value not displayed)."
