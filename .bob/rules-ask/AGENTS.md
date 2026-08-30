# AGENTS.md — Ask mode

This file provides guidance to agents when working with code in this repository.

## Non-obvious documentation context

- **`bob-kit/` is templates, not live config.** Asking "where is the MCP server config?" leads here, but these files must be manually merged into `~/.bob/` — they are not active until installed.
- **The `sdlc-harness` skill is in `bob-kit/skills/sdlc-harness/SKILL.md`**, not in `~/.bob/skills/`. The installed copy (if present) lives outside this repo.
- **`weather-app/` has no real weather API.** All data is mock and deterministic. Questions about API keys, rate limits, or network calls do not apply.
- **`weather-app/tests.md` is a manual browser checklist.** The Bob skill and MCP server
  have automated suites under `bob-kit/`.
- **Ports:** GitLab=8080 and SSH=2222; demo-site defaults to 8081 and can be overridden
  with `DEMO_SITE_PORT`.
- **The `demo` GitLab user and `root` admin use separate passwords**
  (`GITLAB_DEMO_PASSWORD` and `GITLAB_ROOT_PASSWORD`). `manage.sh seed` provisions them.
- **`bob_sessions/` is committed** — this is unusual (most AI session data is gitignored), but it is required for hackathon submission evidence.
