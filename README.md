# sdlc-harness

IBM Hackathon project. sdlc-harness is a Bob skill that governs work item quality on a
GitLab backlog throughout the SDLC: it drafts missing acceptance criteria, flags vague
descriptions, suggests dependency links, and proposes state transitions, all surfaced to
a developer for review inside Bob before anything gets written back to GitLab. See
[Problem Statement & Solution](docs/problem-statement.html) for the full problem/solution
writeup and [How Bob Was Used to Build This](docs/bob-usage.html) for how Bob was used to
build this project. Documentation lives under `docs/` as self-contained HTML; start at
[docs/index.html](docs/index.html).

The repo is self-contained: a Docker Compose stack runs a real GitLab CE instance plus a
small demo web app ("Weather Dashboard") to govern, and a Bob skill/MCP server pair does
the governance work.

## Repository layout

| Directory | What it is |
|---|---|
| `gitlab-local/` | Docker stack (GitLab CE + nginx demo site) and all the scripts to start, seed, and reset it. |
| `weather-app/` | The demo artefact under governance — plain HTML/CSS/JS, no build step. |
| `bob-kit/` | Installable source and templates for the Bob skill, MCP server, rules, and mode. See "Installing the Bob skill" below. |
| `docs/` | Project documentation as self-contained HTML (`docs/index.html` is the entry point). |
| `bob-sessions/` | Screenshots of Bob task/session summaries captured during the build, kept for hackathon submission. |

## Running the demo

> **Windows users:** run every command below in **Git Bash** (installed with Git for
> Windows), not WSL or PowerShell. If you also have WSL installed, plain `bash` may
> resolve to `C:\Windows\System32\bash.exe` (the WSL launcher) instead of Git Bash —
> check with `where bash`; Git Bash's path should contain `Program Files\Git`. If it
> resolves to WSL, invoke Git Bash explicitly, e.g.
> `"C:\Program Files\Git\bin\bash.exe" bob-kit/mcp-server/install.sh`. WSL is a separate
> Linux environment with its own PATH, so tools installed on your Windows host (Node.js,
> Docker Desktop) may appear "not installed" there even when they're present on Windows.

1. Start the GitLab stack:
   ```bash
   install -m 600 gitlab-local/.env.example gitlab-local/.env
   # Set distinct GITLAB_ROOT_PASSWORD and GITLAB_DEMO_PASSWORD values.
   ./gitlab-local/manage.sh start
   ```
   `start` waits for the host-facing GitLab sign-in page, internal readiness, and the
   demo site, then runs the complete idempotent seed. `restart` performs the same checks
   and seed reconciliation. Use `./gitlab-local/manage.sh seed` to reconcile explicitly.
   Full details, including minimum host requirements and the ports each service uses, are
   in [gitlab-local/README.md](gitlab-local/README.md). To wipe and reseed at any point,
   run `./gitlab-local/manage.sh reset`.

2. Install the Bob skill (one-time, per machine):
   ```bash
   bash bob-kit/mcp-server/install.sh
   ```
   This builds and tests the skill and MCP server, merges the sdlc-harness mode and MCP
   registration without touching unrelated Bob configuration, and runs a smoke test. See
   [bob-kit/README.md](bob-kit/README.md) for the manual steps if you'd rather not run the
   installer.

   Bob uses its built-in model; there is no provider or model setup for this skill. The
   skill controls when generation is invoked, not which model runs it. It invokes
   generation for acceptance-criteria and ambiguity prose (and full-audit summarization),
   while dependency, transition, and coverage detection are deterministic.

3. Give the MCP server your GitLab credentials. It's a `stdio` server that Bob spawns
   itself (no separate process to run) — but it exits immediately if these are missing,
   which shows up in Bob as `Disconnected` with no further explanation. Add the following
   to the **repository-root** `.env` (a different file from `gitlab-local/.env` used in
   step 1). Create it with owner-only permissions, or merge these values into an existing
   file and run `chmod 600 .env`:
   ```bash
   install -m 600 bob-kit/mcp-server/.env.example .env
   ```
   ```dotenv
   GITLAB_HOST=http://localhost:8080
   GITLAB_PROJECT=sdlc-harness/weather-dashboard
   GITLAB_TOKEN=<from ./gitlab-local/manage.sh refresh-token, or a GitLab PAT>
   ```
   `./gitlab-local/manage.sh refresh-token` can mint, store, and verify the demo user's
   token without displaying it.
   Then restart Bob (or reconnect the `sdlc-harness` server from Bob's MCP settings panel).

4. In Bob, switch to the `🔧 SDLC Harness` mode and say something like `govern my backlog`.
   The skill walks through a short onboarding conversation the first time, then runs the
   agents against the seeded issues. Audits are read-only; each finding then enters an
   apply/edit/skip/reject review loop, and only apply or edit can write through the guarded
   review runtime. The full onboarding runbook is in
   [docs/onboarding/runbook.html](docs/onboarding/runbook.html).

## Maintenance

- Rotate the local API token with `./gitlab-local/manage.sh refresh-token`.
- Remove only the installed Bob skill, rule, mode, MCP registration, and build artifacts
  with `bash bob-kit/mcp-server/uninstall.sh`.
- Return the whole demo to a freshly cloned state with
  `./gitlab-local/manage.sh uninstall`; this also deletes Docker volumes, local `.env`
  files, onboarding state, and telemetry, so it prompts before proceeding.

## Security

This repo started from IBM's hackathon project template, which ships a few guardrails to
keep credentials out of git history:

- `.gitignore` and `.bobignore` exclude every `.env` file and anything that looks like a
  credential, key, or secret by name.
- Each part of the stack that needs credentials has an `.env.example`. Create local
  `.env` files with mode `0600` (`install -m 600 ...`) and never commit them. The GitLab
  root and demo accounts must use separate passwords.
- Before pushing, check `git diff` for anything that shouldn't be there and confirm `.env`
  isn't staged (`git status`).

[Security Guidelines](docs/security.html) has the full checklist. If in doubt, ask before
pushing rather than after.
