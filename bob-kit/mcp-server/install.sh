#!/usr/bin/env bash
# install.sh — idempotent installer for the sdlc-harness MCP server and Bob skill.
#
# What it does:
#  1. Confirms Node.js ≥18 is available.
#  2. Installs, tests, and builds both the skill runtime and MCP server.
#  3. Runs all tests — must pass before touching Bob config.
#  5. Copies bob-kit/skills/sdlc-harness/ to ~/.bob/skills/sdlc-harness/.
#  6. Copies bob-kit/rules/01-sdlc-harness.md to ~/.bob/rules/.
#  7. Merges MCP server and custom-mode configuration into ~/.bob/settings/
#     without overwriting unrelated existing config.
#
# Idempotent: re-running produces no duplicate configuration or copied files.
#
# Usage:
#   bash install.sh
#   bash install.sh /path/to/sdlc-harness   # explicit project root

set -euo pipefail

# Resolve project root (default: grandparent of this script — bob-kit/mcp-server/ → project root)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${1:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
MCP_DIR="$PROJECT_ROOT/bob-kit/mcp-server"
SKILL_SRC="$PROJECT_ROOT/bob-kit/skills/sdlc-harness"
RULE_SRC="$PROJECT_ROOT/bob-kit/rules/01-sdlc-harness.md"
MODE_SRC="$PROJECT_ROOT/bob-kit/custom_modes.yaml"
BOB_DIR="${SDLC_BOB_DIR:-$HOME/.bob}"
export SDLC_BOB_DIR="$BOB_DIR"

echo "sdlc-harness installer"
echo "======================"
echo "Project root : $PROJECT_ROOT"
echo "MCP server   : $MCP_DIR"
echo ""

# Fail before installation if the package or required Bob assets are incomplete.
for REQUIRED_PATH in "$MCP_DIR/package.json" "$SKILL_SRC" "$RULE_SRC" "$MODE_SRC"; do
  if [ ! -e "$REQUIRED_PATH" ]; then
    echo "Error: required installation input is missing: $REQUIRED_PATH" >&2
    exit 1
  fi
done

# ---------------------------------------------------------------------------
# 1. Node.js version check
# ---------------------------------------------------------------------------
if ! command -v node &>/dev/null; then
  echo "Error: node is not installed. Install Node.js ≥18 and retry." >&2
  exit 1
fi

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 18 || (major === 18 && minor >= 18) ? 0 : 1)'; then
  echo "Error: Node.js ≥18.18 required (found $(node --version))." >&2
  exit 1
fi
echo "✓ Node.js $(node --version)"

# ---------------------------------------------------------------------------
# 2. npm install
# ---------------------------------------------------------------------------
echo ""
echo "Installing dependencies..."
(cd "$SKILL_SRC" && npm install --prefer-offline 2>&1)
(cd "$MCP_DIR" && npm install --prefer-offline 2>&1)
echo "✓ npm install complete"

# ---------------------------------------------------------------------------
# 3. Build
# ---------------------------------------------------------------------------
echo ""
echo "Building TypeScript..."
(cd "$SKILL_SRC" && npm run typecheck 2>&1)
(cd "$SKILL_SRC" && npm test 2>&1)
(cd "$SKILL_SRC" && npm run build 2>&1)
(cd "$MCP_DIR" && npm run lint 2>&1)
(cd "$MCP_DIR" && npm run typecheck 2>&1)
(cd "$MCP_DIR" && npm run build 2>&1)
echo "✓ Skill tests, lint, typecheck, and build complete"

# ---------------------------------------------------------------------------
# 4. Run tests — gate: must pass before modifying Bob configuration
# ---------------------------------------------------------------------------
echo ""
echo "Running smoke tests..."
(cd "$MCP_DIR" && npm run smoke 2>&1)
echo "✓ Smoke tests passed"

echo ""
echo "Validating existing Bob configuration..."
node "$MCP_DIR/merge-bob-config.mjs" --check "$PROJECT_ROOT"
echo "✓ Bob configuration can be merged safely"

# ---------------------------------------------------------------------------
# 5. Copy skill files to ~/.bob/skills/sdlc-harness/
# ---------------------------------------------------------------------------
echo ""
echo "Installing sdlc-harness skill..."
SKILL_DEST="$BOB_DIR/skills/sdlc-harness"

mkdir -p "$SKILL_DEST"
cp "$SKILL_SRC/SKILL.md" "$SKILL_SRC/package.json" "$SKILL_SRC/package-lock.json" "$SKILL_DEST/"
cp -r "$SKILL_SRC/dist" "$SKILL_SRC/src" "$SKILL_DEST/"
echo "✓ Skill copied to $SKILL_DEST"

# ---------------------------------------------------------------------------
# 6. Copy rule file to ~/.bob/rules/
# ---------------------------------------------------------------------------
echo ""
echo "Installing project rule..."
RULE_DEST_DIR="$BOB_DIR/rules"

mkdir -p "$RULE_DEST_DIR"
cp "$RULE_SRC" "$RULE_DEST_DIR/01-sdlc-harness.md"
echo "✓ Rule copied to $RULE_DEST_DIR/01-sdlc-harness.md"

# ---------------------------------------------------------------------------
# 7. Bob config merge (MCP server + custom mode)
# ---------------------------------------------------------------------------
echo ""
echo "Merging Bob configuration..."
node "$MCP_DIR/merge-bob-config.mjs" "$PROJECT_ROOT"

echo ""
echo "=============================="
echo "Installation complete."
echo ""
echo "Next steps:"
echo "  1. Merge GitLab credentials into $PROJECT_ROOT/.env (GITLAB_HOST,"
echo "     GITLAB_PROJECT, GITLAB_TOKEN — see $MCP_DIR/.env.example)."
echo "     If that .env already exists (e.g. from an unrelated template),"
echo "     add these alongside its existing contents — do not overwrite it."
echo "  2. Restart Bob to load the sdlc-harness MCP server and mode."
echo "  3. Activate the 'SDLC Harness' mode in Bob to begin governance."
echo "  4. When the GitLab Docker instance is ready, run the live smoke test:"
echo "       SDLC_SMOKE_LIVE=true npm run smoke   (from $MCP_DIR)"
