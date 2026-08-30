# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Repository Layout

| Directory | What it is |
|---|---|
| `gitlab-local/` | Docker stack — GitLab CE + nginx demo site. All manage scripts live here. |
| `weather-app/` | The demo artefact (plain HTML/CSS/JS, no build step). Served by nginx on port 8081. |
| `bob-kit/` | Installable source and templates for the Bob skill, MCP server, rules, and mode. Run the installer; files are not used in-place. |
| `docs/` | Project documentation and implementation plans. |
| `bob_sessions/` | Bob task-session exports — committed to repo for hackathon submission, not ignored. |

## Stack

- **GitLab** runs via Docker Compose using a pinned GitLab CE image on port 8080.
- **Demo site** is `weather-app/` mounted read-only into a pinned nginx image on port 8081 by default.
- **Weather app:** plain HTML/CSS/JavaScript with no build step. The Bob skill and MCP
  server under `bob-kit/` are TypeScript projects built with Node/npm; provisioning uses
  Bash and Python 3.
- **GitLab MCP server:** the custom TypeScript server under `bob-kit/mcp-server/`, installed
  as a local stdio process.

## Key Commands

```bash
# Start, wait for host sign-in/readiness, and run the complete seed
./gitlab-local/manage.sh start

# Restart with the same readiness checks and complete seed reconciliation
./gitlab-local/manage.sh restart

# Re-run the health check on demand (start/restart/reset run it automatically)
./gitlab-local/smoke.sh

# Reconcile the complete demo seed (idempotent and safe to re-run)
./gitlab-local/manage.sh seed

# Rotate the local MCP/live-test token without displaying it
./gitlab-local/manage.sh refresh-token

# Full wipe and reseed (clean demo state) — waits for health before reseeding
./gitlab-local/manage.sh reset -y

# Destructive return to a freshly cloned state, including Bob-side cleanup
./gitlab-local/manage.sh uninstall

# Other manage.sh sub-commands include stop, logs, and status
./gitlab-local/manage.sh status
```

## Critical Gotchas

- **`.env` is gitignored and bobignored.** Create it with `install -m 600 gitlab-local/.env.example gitlab-local/.env`, then set both `GITLAB_ROOT_PASSWORD` and `GITLAB_DEMO_PASSWORD`. The seed workflow hard-fails on missing, placeholder, or overly permissive values.
- **Separate root and demo passwords.** `seed.sh` uses `GITLAB_DEMO_PASSWORD` for the non-admin `demo` account and repairs that account on repeat runs.
- **`manage.sh start` and `restart` fully provision the demo.** They wait for the host-facing GitLab sign-in page, internal readiness, and the demo site before running the complete idempotent seed. `seed` remains available for explicit reconciliation.
- **Seed scripts resolve their own location.** They may be launched from any working directory.
- **The seed workflow creates one ephemeral API token** via a bounded `gitlab-rails runner`, reuses it for the internal issue-fixture stage, revokes it on exit, and removes its owner-only temporary files. An exported administrator `GITLAB_TOKEN` skips Rails entirely.
- **Never pass multi-line or user-controlled text into an inline `python3 -c "..."` argument, and never `open()` a bash-`$PWD`-derived path from inside one, in `seed.sh`/`seed-issues.sh`.** On Windows + Git Bash, both break silently: (1) embedding a multi-line description into a single-quoted Python string literal breaks as soon as it hits a real newline — Python single-quoted strings don't span physical lines; (2) Git Bash's `pwd` yields an MSYS-style path (e.g. `/c/Users/...`) that bash itself translates transparently for shell redirects (`<file`), but a *native* Windows `python3.exe` calling `open('/c/...')` cannot resolve it and raises `FileNotFoundError` — easy to miss because a trailing `2>/dev/null || true` swallows it, silently producing empty output instead of a visible failure (this exact combination caused `seed-issues.sh` to think every already-seeded issue was new and create duplicates on every re-run). Pass values through environment variables instead (`TITLE="$title" python3 -c "import os; ...os.environ['TITLE']..."`) — no source embedding, no path translation, exact bytes preserved on any platform.
- **Weather app mock data is deterministic.** `hashString(city.toLowerCase().trim())` seeds all values — the same city always returns the same numbers. Do not expect random variation.
- **Theme key in localStorage is `sdlc-theme`** (not `theme` or app name). Use this key if writing tests against localStorage state.
- **`bob-kit/` is source, not live config.** Run its installer to build and copy the skill,
  rules, mode, and MCP registration into Bob.
- **`.sdlc-harness.json`** is written to the repo root by the onboarding CLI. It contains
  scope/workflow configuration but no credentials and remains gitignored.
- **MCP server scope is locked to the onboarded project.** The skill must not read/write issues outside the project configured in `.sdlc-harness.json`, even when scanning for dependency links.
- **`bob_sessions/` is committed** — the `.gitignore` explicitly excludes live AI session state (`.copilot/`, `.cursor/`) but the `bob_sessions/` export folder must be committed for hackathon submission.

## Bob Kit Installation (one-time, per machine)

```bash
bash bob-kit/mcp-server/install.sh
```

The installer builds and tests both TypeScript packages, copies the compiled skill and
rules, and safely merges the MCP server and custom mode into Bob's existing configuration.
Use `bash bob-kit/mcp-server/uninstall.sh` to remove only those Bob-side assets, or
`./gitlab-local/manage.sh uninstall` for the destructive full cleanup.

Bob supplies the built-in model. The skill controls when generation is invoked, not which
model runs it: acceptance-criteria and ambiguity prose use generation, while dependency,
transition, and coverage detection remain deterministic. Every finding enters the guarded
apply/edit/skip/reject review loop before any GitLab write.

## Weather App — Coding Conventions

- All weather-app JavaScript is dependency-free browser code with no modules or bundler.
  `app.js` is placed at the bottom of `<body>` — it is **not** deferred or async.
- JSDoc comments on every exported function with `@param` and `@returns` types.
- DOM references are declared as module-level `const` after the data/utility block (section 2 of `app.js`).
- CSS theming uses `data-theme` attribute on `<body>` (`light`|`dark`), driven by `applyTheme()`.
- Section separators in `app.js` use a fixed-width `/* ---… */` banner with a section number and title.
