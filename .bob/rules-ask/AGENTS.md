# AGENTS.md — Ask mode

This file provides guidance to agents when working with code in this repository.

## Non-obvious documentation context

- **`bob-kit/` is templates, not live config.** Asking "where is the MCP server config?" leads here, but these files must be manually merged into `~/.bob/` — they are not active until installed.
- **The `sdlc-harness` skill is in `bob-kit/skills/sdlc-harness/SKILL.md`**, not in `~/.bob/skills/`. The installed copy (if present) lives outside this repo.
- **`weather-app/` has no real weather API.** All data is mock and deterministic. Questions about API keys, rate limits, or network calls do not apply.
- **`tests.md` is a manual checklist**, not an automated test suite. There is no test runner. "How do I run tests?" means opening `index.html` in a browser and going through that checklist.
- **Ports**: GitLab=8080, demo-site=8081, SSH=2222. These are fixed in `docker-compose.yml`.
- **The `demo` GitLab user and the `root` admin share the same password** (`$GITLAB_ROOT_PASSWORD` from `.env`). This is by design for demo simplicity.
- **`bob-sessions/` is committed** — this is unusual (most AI session data is gitignored), but it is required for hackathon submission evidence.
- **`to-do.md`** is the canonical task tracker for this project, not GitHub Issues or any external tracker.
