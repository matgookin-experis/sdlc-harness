# AGENTS.md — Plan mode

This file provides guidance to agents when working with code in this repository.

## Non-obvious architectural constraints

- **The demo GitLab project (`sdlc-harness/weather-dashboard`) is populated by `seed.sh`**, not by a git push from this repo. `weather-app/` source files are base64-encoded and uploaded via the GitLab Files REST API. Any new `weather-app/` file must also be added to `seed.sh`'s `add_file` calls or it won't appear in GitLab.
- **MCP server is the official `mcp/gitlab` Docker image** (pulled, not built locally). It runs with `--network host` so it can reach `localhost:8080`. Adding custom MCP tools means a separate custom server, not modifying this image.
- **The skill scope is hard-locked at onboarding time** via `.sdlc-harness.json`. There is no multi-project mode and no runtime scope expansion — this is a deliberate constraint to prevent cross-project contamination during demo.
- **P0 / P1 / P2 priorities** are defined in `to-do.md` (Section: Priority Legend) and must be respected. P2 items (generic coding-assistant kit features: `backlog-hygiene`, `work-item-optimizer`, etc.) are explicitly out of scope and must not be built.
- **Agents must never modify GitLab issues without explicit user approval** (Phase 4 of the skill). Any plan that auto-applies changes violates the human-review requirement.
- **Suggestion telemetry (Task 26) must be minimal** — flat file or GitLab comment thread only. No database, no dashboard. The only metric the demo needs is an acceptance rate.
- **Section 2A plumbing (MCP server TypeScript package) is not yet built.** Plans that depend on `gitlab-issue-reader`, `gitlab-issue-writer`, etc. must account for Tasks 7–16 being incomplete.
- **`bob-kit/` install is manual and per-machine** — there is no automated installer yet (Task 15 is P1). Plans must not assume the kit is already installed on a target machine.
