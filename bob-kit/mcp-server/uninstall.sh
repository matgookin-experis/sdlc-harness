#!/usr/bin/env bash
# uninstall.sh — reverses install.sh: removes the sdlc-harness MCP server
# registration and custom mode from Bob's global config, deletes the copied
# skill and rule files, and clears the local build artifacts (node_modules,
# dist) for both the skill and the MCP server.
#
# Scope: mirrors install.sh exactly — if install.sh created it, this removes
# it. It does NOT touch .env files, the GitLab Docker stack, or anything else
# in gitlab-local/; those are gitlab-local/manage.sh's domain, not this
# script's. See gitlab-local/manage.sh's `uninstall` verb for the full
# "reset as if freshly cloned" command that also covers that layer (and
# calls this script for the Bob/MCP side).
#
# Idempotent: safe to re-run. Entries/files that are already gone are a
# no-op, not an error.
#
# Usage:
#   bash uninstall.sh [-y|--yes]
#   bash uninstall.sh /path/to/sdlc-harness [-y|--yes]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Parse args: an optional leading project-root path, plus -y/--yes anywhere.
PROJECT_ROOT_ARG=""
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) ASSUME_YES=1 ;;
    *) PROJECT_ROOT_ARG="$arg" ;;
  esac
done

PROJECT_ROOT="${PROJECT_ROOT_ARG:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
MCP_DIR="$SCRIPT_DIR"
SKILL_DIR="$PROJECT_ROOT/bob-kit/skills/sdlc-harness"
BOB_DIR="${SDLC_BOB_DIR:-$HOME/.bob}"
export SDLC_BOB_DIR="$BOB_DIR"

echo "sdlc-harness uninstaller"
echo "========================"
echo "Project root : $PROJECT_ROOT"
echo "Bob dir      : $BOB_DIR"
echo ""
echo "This will remove:"
echo "  - $MCP_DIR/node_modules, $MCP_DIR/dist"
echo "  - $SKILL_DIR/node_modules, $SKILL_DIR/dist"
echo "  - the sdlc-harness entry in $BOB_DIR/settings/mcp.json"
echo "  - the sdlc-harness mode in $BOB_DIR/settings/custom_modes.yaml"
echo "  - $BOB_DIR/skills/sdlc-harness/"
echo "  - $BOB_DIR/rules/01-sdlc-harness.md"
echo ""
echo "It will NOT touch .env files, GitLab's Docker stack, or anything in"
echo "gitlab-local/ — see gitlab-local/manage.sh's uninstall verb for that."
echo ""

if [ "$ASSUME_YES" -ne 1 ]; then
  read -r -p "Continue? [y/N] " confirm
  case "$confirm" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

echo ""
echo "Removing Bob global config entries..."
# Runs before the build-artifact removal below on purpose: merge-bob-config.mjs
# imports the `yaml` package from this package's own node_modules, so deleting
# node_modules first would break this exact step.
if command -v node &>/dev/null; then
  node "$MCP_DIR/merge-bob-config.mjs" --uninstall
  echo "✓ sdlc-harness entries removed from mcp.json / custom_modes.yaml"
else
  echo "  node not found — skipping mcp.json/custom_modes.yaml cleanup." >&2
  echo "  (Node.js is required for this step; the rest of the uninstall still ran.)" >&2
fi

echo ""
echo "Removing installed skill and rule files..."
rm -rf "$BOB_DIR/skills/sdlc-harness"
rm -f "$BOB_DIR/rules/01-sdlc-harness.md"
echo "✓ Skill and rule files removed"

echo ""
echo "Removing build artifacts..."
rm -rf "$MCP_DIR/node_modules" "$MCP_DIR/dist"
rm -rf "$SKILL_DIR/node_modules" "$SKILL_DIR/dist"
echo "✓ Build artifacts removed"

echo ""
echo "=============================="
echo "Uninstall complete."
echo ""
echo "Restart Bob to fully unload the sdlc-harness mode and MCP server."
