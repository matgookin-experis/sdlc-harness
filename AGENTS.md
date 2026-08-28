# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Repository Layout

| Directory | What it is |
|---|---|
| `gitlab-local/` | Docker stack — GitLab CE + nginx demo site. All manage scripts live here. |
| `weather-app/` | The demo artefact (plain HTML/CSS/JS, no build step). Served by nginx on port 8081. |
| `bob-kit/` | Bob config **templates only** — must be manually merged/installed, not used in-place. |
| `docs/` | Plans and session notes. |
| `bob-sessions/` | Bob task-session exports — committed to repo for hackathon submission, not ignored. |

## Stack

- **GitLab** runs via Docker Compose (`gitlab/gitlab-ce:latest`) on port 8080.
- **Demo site** is `weather-app/` mounted read-only into `nginx:alpine` on port 8081.
- **No Node/npm/Python build** anywhere in the repo — the weather app is plain files opened directly in a browser.
- **GitLab MCP server** uses the official `mcp/gitlab` Docker image run via `docker run --network host` (not a local process).

## Key Commands

```bash
# Start the full stack (first boot takes 3–5 minutes)
cd gitlab-local && docker compose up -d

# Validate stack health (polls until HTTP 200/302 or 300 s timeout)
./gitlab-local/smoke.sh

# Seed / reset demo data (idempotent — safe to re-run)
./gitlab-local/manage.sh seed

# Full wipe and reseed (clean demo state)
cd gitlab-local && docker compose down -v && docker compose up -d && ./manage.sh seed

# Other manage.sh sub-commands: start | stop | restart | logs | status | password
./gitlab-local/manage.sh status
```

## Critical Gotchas

- **`.env` is gitignored and bobignored.** Copy `gitlab-local/.env.example` → `gitlab-local/.env` and set `GITLAB_ROOT_PASSWORD`. The seed script reads this file; it will hard-fail with no fallback if the variable is absent.
- **Same password for root and demo user.** `seed.sh` sets both the `root` admin and the `demo` developer account to `$GITLAB_ROOT_PASSWORD`.
- **`seed.sh` must be run from inside the `sdlc-harness` repo.** It resolves `../weather-app` relative to its own directory — running it from an arbitrary path will fail.
- **`seed.sh` creates an ephemeral API token** via `gitlab-rails runner` and writes it to `/tmp/seed_token.txt` inside the container, then deletes it. Do not store or reuse this token.
- **Weather app mock data is deterministic.** `hashString(city.toLowerCase().trim())` seeds all values — the same city always returns the same numbers. Do not expect random variation.
- **Theme key in localStorage is `sdlc-theme`** (not `theme` or app name). Use this key if writing tests against localStorage state.
- **`bob-kit/` is a template, not a live config.** Files there must be manually merged into `~/.bob/settings/custom_modes.yaml`, `~/.bob/skills/`, and the Bob global MCP config. They are not auto-loaded.
- **`.sdlc-harness.json`** is written to the repo root by the skill's onboarding phase (Phase 1). Check for this file to determine if a project has been onboarded.
- **MCP server scope is locked to the onboarded project.** The skill must not read/write issues outside the project configured in `.sdlc-harness.json`, even when scanning for dependency links.
- **`bob-sessions/` is committed** — the `.gitignore` explicitly excludes live AI session state (`.copilot/`, `.cursor/`) but the `bob-sessions/` export folder must be committed for hackathon submission.

## Bob Kit Installation (one-time, per machine)

```bash
cp -r bob-kit/rules/. .bob/rules/              # workspace rules
cp -r bob-kit/skills/sdlc-harness ~/.bob/skills/  # global skill
# MCP: merge bob-kit/mcp/mcp.json into Bob IDE → Settings → MCP → Edit Global MCP
# Modes: merge bob-kit/custom_modes.yaml into ~/.bob/settings/custom_modes.yaml
```

## Weather App — Coding Conventions

- All JS is vanilla ES5-compatible (no modules, no bundler). `app.js` is placed at the bottom of `<body>` — it is **not** deferred or async.
- JSDoc comments on every exported function with `@param` and `@returns` types.
- DOM references are declared as module-level `const` after the data/utility block (section 2 of `app.js`).
- CSS theming uses `data-theme` attribute on `<body>` (`light`|`dark`), driven by `applyTheme()`.
- Section separators in `app.js` use a fixed-width `/* ---… */` banner with a section number and title.
