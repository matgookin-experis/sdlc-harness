#!/usr/bin/env bash
# install.sh — idempotent installer for the sdlc-harness MCP server.
#
# What it does:
#  1. Confirms Node.js ≥18 is available.
#  2. Runs npm install in the mcp-server directory.
#  3. Runs npm run build to compile TypeScript.
#  4. Runs the merge-bob-config script to register the MCP server and
#     custom mode in ~/.bob without overwriting unrelated config.
#  5. Runs npm run smoke to verify the build is healthy.
#
# Usage:
#   bash install.sh
#   bash install.sh /path/to/sdlc-harness   # explicit project root

set -euo pipefail

# Resolve project root (default: parent of this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${1:-$SCRIPT_DIR}"
MCP_DIR="$PROJECT_ROOT/mcp-server"

echo "sdlc-harness installer"
echo "======================"
echo "Project root : $PROJECT_ROOT"
echo "MCP server   : $MCP_DIR"
echo ""

# ---------------------------------------------------------------------------
# 1. Node.js version check
# ---------------------------------------------------------------------------
if ! command -v node &>/dev/null; then
  echo "Error: node is not installed. Install Node.js ≥18 and retry." >&2
  exit 1
fi

NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Error: Node.js ≥18 required (found $(node --version))." >&2
  exit 1
fi
echo "✓ Node.js $(node --version)"

# ---------------------------------------------------------------------------
# 2. npm install
# ---------------------------------------------------------------------------
echo ""
echo "Installing dependencies..."
(cd "$MCP_DIR" && npm install --prefer-offline 2>&1)
echo "✓ npm install complete"

# ---------------------------------------------------------------------------
# 3. Build
# ---------------------------------------------------------------------------
echo ""
echo "Building TypeScript..."
(cd "$MCP_DIR" && npm run build 2>&1)
echo "✓ Build complete"

# ---------------------------------------------------------------------------
# 4. Bob config merge
# ---------------------------------------------------------------------------
echo ""
echo "Merging Bob configuration..."
node "$MCP_DIR/merge-bob-config.mjs" "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# 5. Smoke test
# ---------------------------------------------------------------------------
echo ""
echo "Running smoke test..."
(cd "$MCP_DIR" && npm run smoke 2>&1)
echo "✓ Smoke test passed"

echo ""
echo "=============================="
echo "Installation complete."
echo ""
echo "Next steps:"
echo "  1. Copy .env.example to .env and fill in your GitLab credentials."
echo "  2. Restart Bob to load the new MCP server and sdlc-harness mode."
echo "  3. When the GitLab Docker instance is ready, run:"
echo "     SDLC_SMOKE_LIVE=true npm run smoke"
echo "     (from the mcp-server directory)"
