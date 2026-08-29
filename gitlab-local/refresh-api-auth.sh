#!/usr/bin/env bash
# Create a fresh, project-scoped demo-user PAT and store it in the gitignored
# repository .env used by the MCP server and live review smoke test.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
. "$SCRIPT_DIR/env.sh"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
RUNTIME_ENV="${SDLC_ENV_FILE:-$REPO_ROOT/.env}"
TMP_DIR="$SCRIPT_DIR/.token-tmp"
TOKEN_FILE="$TMP_DIR/token"
TOKEN_ID_FILE="$TMP_DIR/token-id"
RUNNER_FILE="$TMP_DIR/runner.rb"
REVOKE_RUNNER_FILE="$TMP_DIR/revoke-token.rb"
CURL_CONFIG="$TMP_DIR/curl-token.conf"
ENV_TMP=""
CONTAINER_TEMP_USED=0
NEW_TOKEN_ACTIVE=0
TOKEN=""
TOKEN_ID=""
TOKEN_NAME="sdlc-harness-runtime-$(date +%s)-$$"

rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"
chmod 700 "$TMP_DIR"

# Remove sensitive temporary files and revoke a replacement token if the local
# credential update fails before that token becomes the installed runtime token.
cleanup() {
  local status=$?
  local cleanup_status=0
  local cleanup_token="${TOKEN:-}"
  local cleanup_config="$CURL_CONFIG"
  local revoked=0

  trap - EXIT
  set +e
  if [ "$NEW_TOKEN_ACTIVE" -eq 1 ]; then
    if [ -z "$cleanup_token" ]; then
      cleanup_token=$(MSYS_NO_PATHCONV=1 docker exec gitlab \
        cat /tmp/sdlc_harness_runtime_token 2>/dev/null || true)
    fi
    if [ -n "$cleanup_token" ] && [[ "$cleanup_token" != ERROR:* ]]; then
      if [ ! -r "$cleanup_config" ]; then
        printf 'header = "PRIVATE-TOKEN: %s"\n' "$cleanup_token" > "$cleanup_config"
        chmod 600 "$cleanup_config"
      fi
      curl --silent --show-error --fail \
        --connect-timeout 5 --max-time 30 \
        --config "$cleanup_config" --request DELETE \
        "http://127.0.0.1:8080/api/v4/personal_access_tokens/self" >/dev/null 2>&1 \
        && revoked=1
    fi
    if [ "$revoked" -eq 0 ]; then
      if MSYS_NO_PATHCONV=1 docker exec -i gitlab sh -c \
        'umask 077; cat > /tmp/sdlc_harness_revoke_token.rb; chown git:git /tmp/sdlc_harness_revoke_token.rb' \
        < "$REVOKE_RUNNER_FILE" >/dev/null 2>&1; then
        if run_gitlab_rails_runner /tmp/sdlc_harness_revoke_token.rb \
          "Revoking the failed replacement token" 30 >/dev/null 2>&1; then
          revoked=1
        else
          cleanup_status=1
        fi
      else
        cleanup_status=1
      fi
    fi
  fi
  if [ "$CONTAINER_TEMP_USED" -eq 1 ]; then
    MSYS_NO_PATHCONV=1 docker exec gitlab rm -f \
      /tmp/sdlc_harness_token_runner.rb \
      /tmp/sdlc_harness_revoke_token.rb \
      /tmp/sdlc_harness_runtime_token \
      /tmp/sdlc_harness_runtime_token_id \
      /tmp/sdlc_harness_runtime_token_name >/dev/null 2>&1 || cleanup_status=1
  fi
  if [ -n "$ENV_TMP" ]; then
    rm -f "$ENV_TMP"
  fi
  rm -rf "$TMP_DIR"
  unset cleanup_token
  if [ "$cleanup_status" -ne 0 ]; then
    echo "ERROR: Could not fully revoke the replacement token or remove temporary files." >&2
    if [ "$status" -eq 0 ]; then
      status=1
    fi
  fi
  exit "$status"
}

trap cleanup EXIT

if ! docker inspect --format='{{.State.Running}}' gitlab 2>/dev/null | grep -q true; then
  echo "ERROR: the gitlab container is not running." >&2
  exit 1
fi

cat > "$RUNNER_FILE" <<'RUBY'
def write_private(path, value)
  File.unlink(path) if File.exist?(path)
  File.open(path, File::WRONLY | File::CREAT | File::TRUNC, 0o600) do |file|
    file.write(value)
  end
end

begin
  user = User.find_by!(username: 'demo')
  raise 'Refusing to create an administrator runtime token' if user.admin?
  token_name = File.binread('/tmp/sdlc_harness_runtime_token_name')
  token = user.personal_access_tokens.create!(
    name: token_name,
    scopes: [:api],
    expires_at: Date.today + 30
  )
  write_private('/tmp/sdlc_harness_runtime_token', token.token)
  write_private('/tmp/sdlc_harness_runtime_token_id', token.id.to_s)
rescue => e
  write_private('/tmp/sdlc_harness_runtime_token', 'ERROR: ' + e.message)
end
RUBY
cat > "$REVOKE_RUNNER_FILE" <<'RUBY'
user = User.find_by!(username: 'demo')
token_name = File.binread('/tmp/sdlc_harness_runtime_token_name')
PersonalAccessToken.where(user_id: user.id, name: token_name, revoked: false)
  .find_each { |token| token.revoke! }
RUBY

CONTAINER_TEMP_USED=1
MSYS_NO_PATHCONV=1 docker exec gitlab rm -f \
  /tmp/sdlc_harness_runtime_token \
  /tmp/sdlc_harness_runtime_token_id \
  /tmp/sdlc_harness_runtime_token_name
printf '%s' "$TOKEN_NAME" | MSYS_NO_PATHCONV=1 docker exec -i gitlab sh -c \
  'umask 077; cat > /tmp/sdlc_harness_runtime_token_name; chown git:git /tmp/sdlc_harness_runtime_token_name'
MSYS_NO_PATHCONV=1 docker exec -i gitlab sh -c \
  'umask 077; cat > /tmp/sdlc_harness_token_runner.rb; chown git:git /tmp/sdlc_harness_token_runner.rb' \
  < "$RUNNER_FILE"
NEW_TOKEN_ACTIVE=1
run_gitlab_rails_runner /tmp/sdlc_harness_token_runner.rb \
  "Creating the MCP runtime API token" >/dev/null

MSYS_NO_PATHCONV=1 docker exec gitlab cat /tmp/sdlc_harness_runtime_token > "$TOKEN_FILE"
MSYS_NO_PATHCONV=1 docker exec gitlab cat /tmp/sdlc_harness_runtime_token_id > "$TOKEN_ID_FILE"
chmod 600 "$TOKEN_FILE" "$TOKEN_ID_FILE"

TOKEN="$(tr -d '\r\n' < "$TOKEN_FILE")"
TOKEN_ID="$(tr -d '\r\n' < "$TOKEN_ID_FILE")"
if [ -z "$TOKEN" ] || [[ "$TOKEN" == ERROR:* ]] || ! [[ "$TOKEN_ID" =~ ^[0-9]+$ ]]; then
  echo "ERROR: GitLab did not create a valid runtime token." >&2
  exit 1
fi

printf 'header = "PRIVATE-TOKEN: %s"\n' "$TOKEN" > "$CURL_CONFIG"
chmod 600 "$CURL_CONFIG"

status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 5 --max-time 30 --config "$CURL_CONFIG" \
  http://127.0.0.1:8080/api/v4/user)
if [ "$status" != "200" ]; then
  echo "ERROR: the new token failed GitLab authentication (HTTP $status)." >&2
  exit 1
fi

if [ -L "$RUNTIME_ENV" ]; then
  echo "ERROR: Refusing to replace symbolic-link credential file $RUNTIME_ENV." >&2
  exit 1
fi
RUNTIME_DIR="$(dirname "$RUNTIME_ENV")"
if [ ! -d "$RUNTIME_DIR" ]; then
  echo "ERROR: Credential directory does not exist: $RUNTIME_DIR" >&2
  exit 1
fi
ENV_TMP=$(mktemp "$RUNTIME_DIR/.sdlc-env.XXXXXX")
chmod 600 "$ENV_TMP"
if [ -f "$RUNTIME_ENV" ]; then
  # Rewrite GITLAB_TOKEN in place and collapse accidental duplicates.
  awk -F= '
    NR == FNR { token=$0; next }
    $1 == "GITLAB_TOKEN" {
      if (!found) { print "GITLAB_TOKEN=" token; found=1 }
      next
    }
    { print }
    END { if (!found) print "GITLAB_TOKEN=" token }
  ' "$TOKEN_FILE" "$RUNTIME_ENV" > "$ENV_TMP"
else
  {
    printf 'GITLAB_TOKEN='
    cat "$TOKEN_FILE"
    printf '\n'
  } > "$ENV_TMP"
fi
grep -q '^GITLAB_HOST=' "$ENV_TMP" || echo 'GITLAB_HOST=http://localhost:8080' >> "$ENV_TMP"
grep -q '^GITLAB_PROJECT=' "$ENV_TMP" || echo 'GITLAB_PROJECT=sdlc-harness/weather-dashboard' >> "$ENV_TMP"
grep -q '^SDLC_DEBUG=' "$ENV_TMP" || echo 'SDLC_DEBUG=false' >> "$ENV_TMP"
if mv "$ENV_TMP" "$RUNTIME_ENV"; then
  ENV_TMP=""
  NEW_TOKEN_ACTIVE=0
else
  echo "ERROR: Could not atomically replace $RUNTIME_ENV." >&2
  exit 1
fi

# The replacement is installed and verified. Revoke older runtime tokens via
# the API so another Rails boot is not required and a failed rotation never
# destroys the last usable credential.
OLD_TOKEN_IDS=$(curl --silent --show-error --fail \
  --connect-timeout 5 --max-time 30 --config "$CURL_CONFIG" \
  "http://127.0.0.1:8080/api/v4/personal_access_tokens?search=sdlc-harness-runtime&state=active&per_page=100" \
  | TOKEN_ID="$TOKEN_ID" python3 -c '
import json
import os
import sys

current_id = int(os.environ["TOKEN_ID"])
print(" ".join(str(token["id"]) for token in json.load(sys.stdin) if token["id"] != current_id))
')
for old_token_id in $OLD_TOKEN_IDS; do
  curl --silent --show-error --fail \
    --connect-timeout 5 --max-time 30 --config "$CURL_CONFIG" \
    --request DELETE \
    "http://127.0.0.1:8080/api/v4/personal_access_tokens/$old_token_id" >/dev/null
done

echo "Runtime GitLab token refreshed and verified in $RUNTIME_ENV (value not displayed)."
