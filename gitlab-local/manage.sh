#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

usage() {
  echo "Usage: $0 {start|stop|restart|seed|seed-issues|password|logs|status}"
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
