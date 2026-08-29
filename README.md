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
| `bob-kit/` | The Bob skill, MCP server, and config templates that implement sdlc-harness. Templates only; see "Installing the Bob skill" below. |
| `docs/` | Project documentation as self-contained HTML (`docs/index.html` is the entry point), plus implementation plans under `docs/superpowers/`. |
| `bob-sessions/` | Screenshots of Bob task/session summaries captured during the build, kept for hackathon submission. |

## Running the demo

1. Start the GitLab stack:
   ```bash
   cd gitlab-local
   cp .env.example .env   # set GITLAB_ROOT_PASSWORD
   docker compose up -d   # first boot takes 3-5 minutes
   ./smoke.sh              # confirms both containers are healthy
   ./manage.sh seed         # creates the demo group, user, and project
   ./manage.sh seed-issues  # seeds 12 intentionally incomplete issues for the agents to act on
   ```
   Full details, including minimum host requirements and the ports each service uses, are
   in [gitlab-local/README.md](gitlab-local/README.md). To wipe and reseed at any point,
   run `./manage.sh reset`.

2. Install the Bob skill (one-time, per machine):
   ```bash
   bash bob-kit/mcp-server/install.sh
   ```
   This builds the MCP server, merges the sdlc-harness mode and MCP registration into your
   Bob config without touching anything else you've configured, and runs a smoke test. See
   [bob-kit/README.md](bob-kit/README.md) for the manual steps if you'd rather not run the
   installer, including how to point Bob's WatsonX provider at
   `ibm/granite-3-3-8b-instruct`.

3. In Bob, switch to the `🔧 SDLC Harness` mode and say something like `govern my backlog`.
   The skill walks through a short onboarding conversation the first time, then runs the
   agents against the seeded issues. The full onboarding runbook is in
   [docs/onboarding/runbook.html](docs/onboarding/runbook.html).

## Security

This repo started from IBM's hackathon project template, which ships a few guardrails to
keep credentials out of git history:

- `.gitignore` and `.bobignore` exclude every `.env` file and anything that looks like a
  credential, key, or secret by name.
- Each part of the stack that needs credentials (`gitlab-local/`, `bob-kit/mcp-server/`,
  and the repo root) has its own `.env.example` to copy from. Copy it, fill in real values
  in the `.env` it produces, and never commit that file.
- Before pushing, check `git diff` for anything that shouldn't be there and confirm `.env`
  isn't staged (`git status`).

[Security Guidelines](docs/security.html) has the full checklist. If in doubt, ask before
pushing rather than after.
