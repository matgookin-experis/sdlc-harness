#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

usage() {
  echo "Usage: $0 {start|stop|restart|seed|seed-issues|refresh-token|reset|password|logs|status}"
  exit 1
}

case "${1:-}" in
  start)
    echo "Starting GitLab..."
    docker compose up -d
    echo "GitLab starting — check status with: $0 status"
    ;;
  stop)
    echo "Stopping GitLab..."
    docker compose down
    ;;
  restart)
    echo "Restarting GitLab..."
    docker compose restart
    ;;
  seed)
    echo "Running demo seed..."
    bash "$SCRIPT_DIR/seed.sh"
    ;;
  seed-issues)
    echo "Seeding demo issues..."
    bash "$SCRIPT_DIR/seed-issues.sh"
    ;;
  refresh-token)
    echo "Refreshing the local MCP/API token..."
    bash "$SCRIPT_DIR/refresh-api-auth.sh"
    ;;
  reset)
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
    # end up with a running GitLab and no group, project or issues.
    echo "Waiting for GitLab to answer HTTP..."
    for i in $(seq 1 40); do
      status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
        "http://localhost:8080/users/sign_in" 2>/dev/null || echo "000")
      if [ "$status" = "200" ]; then
        echo "GitLab is serving."
        break
      fi
      echo "  [$i/40] HTTP $status — retrying in 15s..."
      sleep 15
      if [ "$i" -eq 40 ]; then
        echo "ERROR: GitLab did not start serving within 10 minutes."
        exit 1
      fi
    done
    echo "Reseeding..."
    bash "$SCRIPT_DIR/seed.sh"
    bash "$SCRIPT_DIR/seed-issues.sh"
    echo ""
    echo "Reset complete — stack is back to a known, fully-seeded state."
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
