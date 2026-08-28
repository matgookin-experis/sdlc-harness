# AGENTS.md — Agent (coding) mode

This file provides guidance to agents when working with code in this repository.

## Non-obvious coding rules

- **No build step.** `weather-app/` has no `package.json`. Do not add one, do not introduce a bundler. Files are served raw by nginx.
- **JS must stay ES5-compatible.** No arrow functions in event handlers, no `class`, no template literals (existing code uses them sparingly inside JSDoc only — be consistent). No ES modules (`import`/`export`).
- **`app.js` script tag is at the bottom of `<body>` — not deferred.** DOM elements are guaranteed present when the script runs; do not add `DOMContentLoaded` guards.
- **mock data is intentionally deterministic** — never replace `hashString` with `Math.random()`. Demo reproducibility depends on it.
- **GitLab seed script uses `python3` for JSON parsing** — not `jq`. If extending `seed.sh`, keep using `python3 -c "import sys,json; ..."` inline.
- **`manage.sh` uses `docker compose` (v2 plugin syntax), not `docker-compose` (v1).** Do not add a fallback.
- **Never hardcode a credential.** `seed.sh` will `exit 1` with no fallback if `GITLAB_ROOT_PASSWORD` is empty — this is intentional.
- **`add_file()` in `seed.sh` uses `base64 -w0`** (GNU coreutils flag). On macOS the flag differs; note this if writing cross-platform helpers.
- **Bob kit files in `bob-kit/` are never auto-loaded** — they require manual merge. Do not write code that reads from `bob-kit/` at runtime.
- **`.sdlc-harness.json`** (written to repo root by onboarding) must be gitignored if it can contain credentials; check `.gitignore` before adding new config files.
