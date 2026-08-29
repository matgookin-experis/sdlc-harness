# AGENTS.md — Agent (coding) mode

This file provides guidance to agents when working with code in this repository.

## Non-obvious coding rules

- **No weather-app build step.** `weather-app/` has no `package.json`; files are served raw
  by nginx. The TypeScript packages under `bob-kit/` do have npm build and test steps.
- **Weather-app JavaScript stays dependency-free and browser-native.** Do not introduce a
  bundler or module loader.
- **`app.js` script tag is at the bottom of `<body>` — not deferred.** DOM elements are guaranteed present when the script runs; do not add `DOMContentLoaded` guards.
- **mock data is intentionally deterministic** — never replace `hashString` with `Math.random()`. Demo reproducibility depends on it.
- **GitLab seed script uses `python3` for JSON parsing** — not `jq`. If extending `seed.sh`, keep using `python3 -c "import sys,json; ..."` inline.
- **`manage.sh` uses `docker compose` (v2 plugin syntax), not `docker-compose` (v1).** Do not add a fallback.
- **Never hardcode a credential.** `seed.sh` will `exit 1` with no fallback if `GITLAB_ROOT_PASSWORD` is empty — this is intentional.
- **`add_file()` uses Python for portable base64 and JSON encoding.** Preserve that pattern
  across Linux, macOS, and Git Bash.
- **Bob kit files require installation.** Use `bob-kit/mcp-server/install.sh`; do not assume
  templates are active merely because they exist in the repository.
- **`.sdlc-harness.json`** is the gitignored, credential-free authority for project scope.
