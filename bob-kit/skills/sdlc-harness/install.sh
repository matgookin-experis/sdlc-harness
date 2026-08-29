#!/usr/bin/env bash

set -euo pipefail

SKILL_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

npm --prefix "$SKILL_DIR" ci --ignore-scripts
npm --prefix "$SKILL_DIR" run build

test -f "$SKILL_DIR/dist/src/cli.js"
