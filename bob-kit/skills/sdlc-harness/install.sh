#!/usr/bin/env bash

set -euo pipefail

# Invoked exclusively as the "install:skill" npm lifecycle script (see
# package.json / SKILL.md), which npm always runs with cwd already set to
# this package's directory. Deliberately avoid re-deriving that path via
# BASH_SOURCE and re-passing it explicitly to npm: on Windows, if this
# script happens to run under WSL bash while npm itself is Windows-native,
# the WSL-style path (/mnt/c/...) gets silently mangled once handed back to
# Windows-native npm, pointing it at a directory with no package.json.

npm ci --ignore-scripts
npm run build

test -f dist/src/cli.js
