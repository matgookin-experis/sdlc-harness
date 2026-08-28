# Agent Orchestration Design

## Overview

sdlc-harness runs four P0 governance agents inside a single Bob session under
the `🔧 SDLC Harness` mode. This document covers how each agent is triggered,
how they share context within a session, and how conflicts between their
suggestions are surfaced to the user.

---

## The Four P0 Agents (+ P1 slot)

| ID | Agent | Concern |
|---|---|---|
| AC | Acceptance-criteria | Issues without Given-When-Then AC |
| AM | Ambiguity detection | Issues with vague or contradictory descriptions |
| DEP | Dependency suggestion | Issues that likely block or relate to each other |
| ST | State-transition | Issues whose GitLab state is stale relative to activity |
| TC *(P1)* | Test-coverage linkage | Issues with no linked test file or test-plan item |

---

## Trigger model

All four agents are **on-demand / user-initiated** for the MVP demo. There is no
background polling daemon. The user activates the `🔧 SDLC Harness` mode,
invokes the skill with a prompt (e.g. "audit the backlog" or "check issue #12
for missing AC"), and Bob runs the relevant agent(s) synchronously inside that
chat session.

### Why on-demand rather than event-driven?

1. **Demo constraint** — the demo is a ≤3-minute video. A background daemon adds
   setup complexity (GitLab webhook configuration, a running process outside Bob)
   with no visible payoff inside the video window.
2. **Trust** — for a first-exposure demo, showing the user explicitly triggering
   an agent and seeing it respond builds more trust than having changes appear
   "automatically."
3. **No extra infrastructure** — stdio-transport MCP + Docker is the only runtime
   dependency. An event loop would require a webhook receiver service.

### How a post-MVP event-driven model would work

When the demo is proven, the natural upgrade path is:

1. Register a GitLab system hook (or project webhook) pointing at a lightweight
   listener process (e.g. a small Express server in `gitlab-local/`).
2. The listener receives `issue` / `merge_request` events and writes them to a
   queue file or calls the MCP server directly.
3. A scheduled Bob shell session (cron or systemd timer) drains the queue,
   runs the relevant agent(s) programmatically, and posts results as GitLab
   comments — without requiring the developer to be in Bob at all.

This path is **not built for the demo** and is listed here only as design intent.

---

## Execution model within a Bob session

When the user triggers a governance action (e.g. "run a full audit"), Bob
executes the agents **sequentially by default**, collecting all findings before
presenting them:

```
User: "audit the backlog"
Bob:
  1. Fetch all open issues via gitlab-local MCP (read, alwaysAllow)
  2. Run AC agent   → findings[]
  3. Run AM agent   → findings[]
  4. Run DEP agent  → findings[]
  5. Run ST agent   → findings[]
  6. Present unified review interface (see "Human review interface" below)
```

For a **single-issue drill-down** (e.g. "check issue #7"), only the agents
relevant to that issue run.

For **long-context tasks** (dependency graph across 50+ issues), Bob may use
`spawn_subagent` to run DEP in parallel with AC+AM, merging results before
the review step. The skill's `SKILL.md` governs when subagents are spawned.

### P1 — test-coverage agent slot

TC slots in after ST in the sequential pipeline. It is disabled by default
(the seed data does not include test files for the MVP). To enable:

1. Populate `weather-app/` with at least one test file (e.g. `weather.test.js`).
2. Configure the TC agent's scan path in `.sdlc-harness.json`:
   `"testGlob": "weather-app/**/*.test.*"`.
3. The skill will include TC in subsequent audit runs automatically.

---

## Context sharing

All agents in a single audit run share one context object assembled at the
start of the run:

```jsonc
{
  "project": { "url": "…", "name": "…" },          // from .sdlc-harness.json
  "workflowStates": ["Open", "In Progress", "Done"], // from .sdlc-harness.json
  "transitionRules": { … },                          // from .sdlc-harness.json
  "issues": [ … ],                                   // fetched once via MCP
  "mergeRequests": [ … ]                             // fetched once via MCP
}
```

**Issues and MRs are fetched exactly once** per audit run and passed to every
agent. This avoids redundant API calls and ensures all agents reason over the
same snapshot (no TOCTOU skew between agents).

The shared context is assembled in Bob's working memory for the session; it is
not persisted to disk beyond the `.sdlc-harness.json` config file.

---

## Human review interface

After all agents have run, Bob presents findings in a **single unified review
loop** rather than agent-by-agent prompts. This keeps the developer in one
mental frame (reviewing suggestions) rather than switching between four separate
agent conversations.

### Presentation format (per finding)

```
──────────────────────────────────────────────────────
[AC] Issue #12 — "Add weather forecast widget"
  ⚠  No acceptance criteria found.

  Suggested AC:
    Given the user is on the dashboard
    When they view the forecast panel
    Then they see a 5-day temperature and precipitation summary

  → apply / edit / skip / reject
──────────────────────────────────────────────────────
```

### User responses

| Response | Interpretation | Action |
|---|---|---|
| "apply" / "yes" / "accept" | Approved as-is | Write to GitLab; log outcome = "accepted" |
| "edit: <new text>" | Approved with changes | Write edited version; log outcome = "edited", editedFields noted |
| "skip" | Deferred | No write; not logged (neutral, try again next run) |
| "reject" / "no" / "dismiss" | Explicitly rejected | No write; log outcome = "rejected" |

Bob does not proceed to the next finding until the user has responded. A vague
"ok" counts as "apply."

### Conflict resolution

A **conflict** arises when two agents produce suggestions that contradict each
other on the same issue — most commonly:

- DEP suggests issue A *blocks* issue B (implying A must be done first),
  while ST suggests transitioning A to "Done" (implying A is already complete).
- AM rewrites a description in a way that would invalidate existing AC drafted
  by AC in the same run.

**Detection:** Bob checks for overlapping `issueIid` values across agent finding
sets before presenting the review. If a conflict is found, the affected findings
are grouped together and flagged:

```
──────────────────────────────────────────────────────
⚡ CONFLICT — Issue #7 has suggestions from two agents that may contradict:

  [ST] Proposed transition: Open → In Progress
       (reason: MR !3 referencing this issue was opened 2h ago)

  [DEP] Proposed link: #7 blocks #9
       (reason: both issues describe the same auth token refresh logic)

  Review both before applying either. Applying ST first is recommended
  if the work is genuinely in progress; applying DEP first is recommended
  if #7 is a blocker that should not move until #9 is acknowledged.

  → apply ST first / apply DEP first / apply both / skip both
──────────────────────────────────────────────────────
```

The user decides the order or skips both. Bob does not auto-resolve conflicts.

---

## Telemetry

Every apply / edit / reject outcome is appended to `sdlc-harness-telemetry.jsonl`
in the repo root (one JSON object per line, never overwritten — append-only):

```jsonc
{
  "ts": "2025-09-01T14:32:10Z",
  "agent": "AC",
  "issueIid": 12,
  "action": "draft_ac",
  "outcome": "accepted",   // "accepted" | "edited" | "rejected"
  "editedFields": []       // populated when outcome = "edited"
}
```

The acceptance rate (accepted / (accepted + rejected)) is the primary trust
metric cited in the demo. `sdlc-harness-telemetry.jsonl` is gitignored; it
does not contain issue content, only metadata.
