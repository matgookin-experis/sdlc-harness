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

docker exec -i gitlab sh -c 'cat > /tmp/sdlc_harness_token_runner.rb' < "$RUNNER_FILE"
docker exec gitlab gitlab-rails runner /tmp/sdlc_harness_token_runner.rb >/dev/null
docker exec gitlab rm -f /tmp/sdlc_harness_token_runner.rb
docker exec gitlab cat /tmp/sdlc_harness_runtime_token > "$TOKEN_FILE"
docker exec gitlab rm -f /tmp/sdlc_harness_runtime_token
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
  {
    echo 'GITLAB_HOST=http://localhost:8080'
    echo 'GITLAB_PROJECT=sdlc-harness/weather-dashboard'
    echo 'SDLC_DEBUG=false'
  } > "$ENV_TMP"
fi
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
