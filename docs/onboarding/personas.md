# Persona & Permission Guide

**Task 35 — P1**

Documents the two demo personas used during SDLC Harness demonstrations, with the
exact GitLab roles and Bob permissions each one requires.

---

## Overview

The demo uses two personas to show that sdlc-harness governs work-item quality for
individual contributors and project leads without needing elevated GitLab access.

| Persona | GitLab account | GitLab role | Bob mode |
|---|---|---|---|
| Developer | `demo` | Developer | `🔧 SDLC Harness` |
| Project Lead | `root` | Owner | `🔧 SDLC Harness` |

Both personas use the same Bob mode and the same skill. The difference is in what
they can write back to GitLab — the Developer persona is the primary demo persona;
the Project Lead persona is used to show that the same tool works at a higher
privilege level (e.g. bulk-closing stale issues, modifying milestone assignments).

---

## Persona 1 — Developer

### Profile

A mid-level software engineer working on the Weather Dashboard project. They use Bob
throughout their development workflow and rely on sdlc-harness to flag quality
problems before work items reach a sprint.

### GitLab role

`Developer` — the minimum role required for the MCP tools to function.

| Capability | Allowed? | Reason |
|---|---|---|
| Read all issues | ✅ | Developer has read access to the project |
| Create issues | ✅ | Developer can create issues |
| Update issue description / labels | ✅ | Developer can edit issues they are assigned to; Reporter cannot |
| Close issues | ✅ | Developer can close issues |
| Create merge requests | ✅ | Developer can create MRs from branches |
| Add comments / notes | ✅ | Developer can comment |
| Manage labels (create new) | ❌ | Requires Maintainer — not needed for the demo |
| Configure milestones | ❌ | Requires Maintainer |

The `demo` user is assigned the Developer role in the `sdlc-harness` group by `seed.sh`.

### Bob permissions

The `🔧 SDLC Harness` mode gives this persona access to:

| Group | What it enables |
|---|---|
| `read` | Read files in the workspace (loads `.sdlc-harness.json`, reads telemetry) |
| `edit` | Write files in the workspace (persists config, appends telemetry) |
| `execute` | Run shell commands (smoke tests, seed scripts) |
| `mcp` | Call all registered MCP servers (`sdlc-harness` GitLab tools) |
| `skill` | Activate the `sdlc-harness` skill |
| `todo` | Use `update_todo_list` to track multi-step governance runs |
| `subagent` | Spawn subagents for parallel issue analysis |
| `mode` | Switch modes if needed |

No additional Bob configuration is required for the Developer persona beyond the
standard installation described in the runbook.

### What they demo

- Trigger an **Audit** against the seeded project
- Review AC-agent findings and **accept** a draft for a specific issue
- Review an AM-agent finding, **edit** the proposed rewrite, and apply it
- **Reject** a DEP-agent dependency suggestion with a comment

---

## Persona 2 — Project Lead

### Profile

A technical lead or engineering manager responsible for backlog quality and sprint
planning. They use sdlc-harness to monitor the full backlog in bulk and act on
state-transition suggestions across multiple issues at once.

### GitLab role

`Owner` — the `root` account is already Owner of the `sdlc-harness` group.
In a real deployment this persona would typically be `Maintainer` (the minimum
role needed for label management and milestone configuration).

| Capability | Allowed? | Reason |
|---|---|---|
| All Developer capabilities | ✅ | Superset |
| Create / manage labels | ✅ | Maintainer+ |
| Create / manage milestones | ✅ | Maintainer+ |
| Manage group members | ✅ | Owner only |
| Delete issues | ✅ | Owner only |
| Access project settings | ✅ | Maintainer+ |

### Bob permissions

Same `🔧 SDLC Harness` mode and the same permission groups as the Developer persona.
The elevated capability comes from the GitLab role, not from Bob.

### What they demo

- Switch to `root` credentials in `bob-kit/mcp-server/.env` (swap `GITLAB_TOKEN`
  for a `root` PAT) and confirm the same skill works without reconfiguration.
- Trigger a **bulk Transition audit** and apply state moves to multiple issues in one session.
- Show the telemetry acceptance rate after several accept/edit/reject decisions.

---

## Setting up the demo user token

For the **Developer persona** demo:

1. Log into GitLab as `demo` at **http://localhost:8080**.
2. Go to **User → Edit profile → Access Tokens**.
3. Create a token named `sdlc-harness-mcp-demo` with `api` scope.
4. Copy the token into `bob-kit/mcp-server/.env` as `GITLAB_TOKEN`.
5. Restart the MCP server (or restart Bob) to pick up the new token.
6. Run the live smoke test:
   ```bash
   cd bob-kit/mcp-server
   SDLC_SMOKE_LIVE=true npm run smoke
   ```

For the **Project Lead persona** demo, repeat the same steps while logged in as `root`.

---

## Switching personas during the demo

To switch between personas mid-demo without re-running onboarding:

1. Update `GITLAB_TOKEN` in `bob-kit/mcp-server/.env`.
2. Restart Bob (the MCP server process is restarted automatically).
3. The `.sdlc-harness.json` config is shared — no re-onboarding needed.
4. Run one quick `audit` call to confirm the new token works before presenting.

---

## Minimum role reference

| Action the skill performs | Minimum GitLab role |
|---|---|
| List issues | Reporter |
| Read issue descriptions and labels | Reporter |
| Add a comment (telemetry note) | Reporter |
| Update issue description or labels | Developer |
| Create a new issue | Developer |
| Close an issue | Developer |
| Create a merge request | Developer |
| Create a new label | Maintainer |
| Manage milestones | Maintainer |

For the P0 demo, **Developer** is sufficient. The only action that requires a higher
role is creating labels — and the `seed-issues.sh` script creates all required labels
as `root`, so the Developer persona never needs to create new ones during the demo.
