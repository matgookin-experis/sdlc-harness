# AGENTS.md — Plan mode

This file provides guidance to agents when working with code in this repository.

## Non-obvious architectural constraints

- **The demo GitLab project (`sdlc-harness/weather-dashboard`) is populated by `seed.sh`**, not by a git push from this repo. `weather-app/` source files are base64-encoded and uploaded via the GitLab Files REST API. Any new `weather-app/` file must also be added to `seed.sh`'s `add_file` calls or it won't appear in GitLab.
- **MCP server is the custom TypeScript package under `bob-kit/mcp-server/`.** It is built
  and registered as a local stdio server by the installer.
- **The skill scope is hard-locked at onboarding time** via `.sdlc-harness.json`. There is no multi-project mode and no runtime scope expansion — this is a deliberate constraint to prevent cross-project contamination during demo.
- **P2 items (generic coding-assistant kit features: `backlog-hygiene`, `work-item-optimizer`, etc.) are explicitly out of scope and must not be built.**
- **Agents must never modify GitLab issues without explicit user approval** (Phase 4 of the skill). Any plan that auto-applies changes violates the human-review requirement.
- **Suggestion telemetry (Task 26) must be minimal** — flat file or GitLab comment thread only. No database, no dashboard. The only metric the demo needs is an acceptance rate.
- **Section 2A plumbing is implemented and tested.** Preserve project scoping, explicit
  human approval, request deadlines, and credential handling when changing it.
- **Installation is automated but per-machine:** run `bob-kit/mcp-server/install.sh` and
  restart Bob. Never assume a repository clone is already installed.
