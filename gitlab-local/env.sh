#!/usr/bin/env bash

# Reject credential files accessible by users other than their owner. Windows
# Git Bash is excluded because its POSIX mode bits do not represent Windows ACLs.
require_private_env_file() {
  local file="$1"
  local system
  local mode
  local permissions

  if [ ! -e "$file" ]; then
    return 0
  fi

  system="$(uname -s 2>/dev/null || true)"
  case "$system" in
    CYGWIN*|MINGW*|MSYS*) return 0 ;;
  esac

  if [ ! -r "$file" ]; then
    echo "ERROR: Cannot read $file." >&2
    return 1
  fi

  if mode=$(stat -c '%a' "$file" 2>/dev/null); then
    :
  elif mode=$(stat -f '%Lp' "$file" 2>/dev/null); then
    :
  else
    echo "ERROR: Cannot verify permissions for $file." >&2
    return 1
  fi

  if ! [[ "$mode" =~ ^[0-7]{3,4}$ ]]; then
    echo "ERROR: Cannot interpret permissions for $file (mode: $mode)." >&2
    return 1
  fi

  permissions=$((8#$mode))
  if (( (permissions & 077) != 0 )); then
    echo "ERROR: $file must not grant group/world permissions (mode: $mode)." >&2
    echo "  Fix it with: chmod 600 $file" >&2
    return 1
  fi
}

# Read one exact KEY=value entry without evaluating the file as shell code.
load_env_value() {
  local name="$1"
  local file="$2"
  local line
  local key
  local value
  local first
  local last

  if [ -n "${!name:-}" ] || [ ! -r "$file" ]; then
    return 0
  fi

  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    case "$line" in
      ''|'#'*) continue ;;
    esac

    if [[ ! "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      continue
    fi

    key="${BASH_REMATCH[1]}"
    if [ "$key" != "$name" ]; then
      continue
    fi

    value="${BASH_REMATCH[2]}"
    if [ "${#value}" -ge 2 ]; then
      first="${value:0:1}"
      last="${value: -1}"
      if { [ "$first" = '"' ] && [ "$last" = '"' ]; } \
        || { [ "$first" = "'" ] && [ "$last" = "'" ]; }; then
        value="${value:1:${#value}-2}"
      fi
    fi

    printf -v "$name" '%s' "$value"
  done < "$file"
}

# Run a Rails script inside GitLab with a container-side deadline. Using the
# container's `timeout` avoids depending on GNU coreutils being installed on
# macOS while ensuring a wedged Rails boot cannot block a seed indefinitely.
run_gitlab_rails_runner() {
  local script_path="$1"
  local purpose="${2:-GitLab Rails runner}"
  local timeout_seconds="${3:-${GITLAB_RAILS_RUNNER_TIMEOUT_SECONDS:-180}}"
  local status

  if ! [[ "$timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
    echo "ERROR: GITLAB_RAILS_RUNNER_TIMEOUT_SECONDS must be a positive integer." >&2
    return 2
  fi

  if MSYS_NO_PATHCONV=1 docker exec gitlab timeout --kill-after=10s \
    "${timeout_seconds}s" gitlab-rails runner "$script_path"; then
    return 0
  else
    status=$?
  fi

  if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then
    echo "ERROR: $purpose timed out after ${timeout_seconds}s." >&2
    echo "  Export an administrator GITLAB_TOKEN with api scope and retry." >&2
  else
    echo "ERROR: $purpose failed (exit $status)." >&2
  fi
  return "$status"
}
