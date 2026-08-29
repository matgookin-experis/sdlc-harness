#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=env.sh
. "$SCRIPT_DIR/env.sh"
cd "$SCRIPT_DIR"

usage() {
  echo "Usage: $0 {start|stop|restart|seed|refresh-token|reset|uninstall|password|logs|status}"
  exit 1
}

# `seed.sh` is the sole public entry point and invokes the internal issue-fixture
# stage with the same API token, avoiding a second Rails boot.
seed_demo() {
  echo "Seeding the complete demo environment..."
  bash "$SCRIPT_DIR/seed.sh"
}

case "${1:-}" in
  start)
    require_private_env_file "$SCRIPT_DIR/.env"
    echo "Starting GitLab..."
    docker compose up -d
    # Block until the stack is verifiably ready (or fails) instead of handing
    # control back immediately — smoke.sh polls the sign-in page for up to
    # 300s and exits non-zero if GitLab never comes up.
    bash "$SCRIPT_DIR/smoke.sh"
    seed_demo
    ;;
  stop)
    echo "Stopping GitLab..."
    docker compose down
    ;;
  restart)
    require_private_env_file "$SCRIPT_DIR/.env"
    echo "Restarting GitLab..."
    docker compose restart
    bash "$SCRIPT_DIR/smoke.sh"
    seed_demo
    ;;
  seed)
    require_private_env_file "$SCRIPT_DIR/.env"
    seed_demo
    ;;
  refresh-token)
    echo "Refreshing the local MCP/API token..."
    bash "$SCRIPT_DIR/refresh-api-auth.sh"
    ;;
  reset)
    require_private_env_file "$SCRIPT_DIR/.env"
    # Idempotent full reset: wipe all GitLab data, boot fresh, wait for health,
    # reseed group/user/project + demo issues. Same commands as the "Full
    # Reset" section in README.md, wrapped into one so demo re-takes are cheap.
    if [ "${2:-}" != "-y" ] && [ "${2:-}" != "--yes" ]; then
      read -r -p "This will DELETE all GitLab data (volumes) and reseed from scratch. Continue? [y/N] " confirm
      case "$confirm" in
        y|Y|yes|YES) ;;
        *) echo "Aborted."; exit 1 ;;
      esac
    fi
    echo "Tearing down (including volumes)..."
    docker compose down -v
    echo "Starting fresh..."
    docker compose up -d
    # Poll the sign-in page, not the container healthcheck. Docker reports
    # "healthy" as soon as the container's own check passes, which happens well
    # before Rails can answer an API call — seeding against that gap is how you
    # end up with a running GitLab and no group, project or issues. Reuses
    # smoke.sh's wait loop (same one "start" uses) instead of a second,
    # drifted copy of the same polling logic.
    bash "$SCRIPT_DIR/smoke.sh"
    echo "Reseeding..."
    # A token inherited from the pre-reset database is invalid after volumes
    # are deleted, so force fresh bootstrap credentials for this seed.
    (
      unset GITLAB_TOKEN
      seed_demo
    )
    echo "Refreshing the MCP runtime token..."
    bash "$SCRIPT_DIR/refresh-api-auth.sh"
    if [ -n "${GITLAB_TOKEN:-}" ]; then
      echo "WARNING: Unset the exported GITLAB_TOKEN; it belonged to the deleted GitLab data."
    fi
    echo "Restart or reconnect Bob so its MCP process loads the refreshed token."
    echo ""
    echo "Reset complete — stack is back to a known, fully-seeded state."
    ;;
  uninstall)
    # Full "reset as if freshly cloned": broader and more destructive than
    # `reset`. `reset` keeps everything installed and reseeds; this tears
    # down the Docker stack (containers + volumes), deletes every generated
    # .env/state file, and calls bob-kit/mcp-server/uninstall.sh for the
    # Bob-side cleanup (build artifacts, global MCP/mode registration, skill,
    # rule). Leaves you at a genuine blank slate, not a reseeded one.
    if [ "${2:-}" != "-y" ] && [ "${2:-}" != "--yes" ]; then
      read -r -p "This will DELETE all GitLab data, .env files, .sdlc-harness.json, telemetry, build artifacts, and the sdlc-harness Bob/MCP registration. Continue? [y/N] " confirm
      case "$confirm" in
        y|Y|yes|YES) ;;
        *) echo "Aborted."; exit 1 ;;
      esac
    fi
    REPO_ROOT="$(dirname "$SCRIPT_DIR")"
    echo "Tearing down Docker stack (including volumes)..."
    docker compose down -v
    echo "Removing local .env/state files..."
    rm -f "$SCRIPT_DIR/.env" "$REPO_ROOT/.env" "$REPO_ROOT/.sdlc-harness.json" \
          "$REPO_ROOT/sdlc-harness-telemetry.jsonl" \
          "$REPO_ROOT/bob-kit/mcp-server/.env"
    echo "Removing Bob/MCP registration and build artifacts..."
    bash "$REPO_ROOT/bob-kit/mcp-server/uninstall.sh" "$REPO_ROOT" -y
    echo ""
    echo "Uninstall complete — repo is back to a freshly-cloned state."
    echo "To set up again: install -m 600 .env.example .env, set both passwords,"
    echo "./manage.sh start, then bash bob-kit/mcp-server/install.sh."
    ;;
  password)
    echo "Initial root password:"
    docker exec gitlab grep 'Password:' /etc/gitlab/initial_root_password 2>/dev/null \
      || echo "Password file not found — it may have been deleted after 24h, or GitLab is not running."
    ;;
  logs)
    docker compose logs -f
    ;;
  status)
    docker compose ps
    echo ""
    docker inspect --format='Health: {{.State.Health.Status}}' gitlab 2>/dev/null || true
    ;;
  *)
    usage
    ;;
esac
