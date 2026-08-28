---
name: sdlc-harness
description: >
  Use when the user wants to govern work item quality, monitor a project backlog,
  onboard a project management tool (GitLab Issues, Jira, Azure DevOps), draft
  missing acceptance criteria, flag ambiguous descriptions, suggest dependency links,
  propose state transitions, or review agent suggestions for work items. Activate
  any time the user says "sdlc-harness", "/sdlc-harness", "govern my backlog",
  "check my work items", "draft acceptance criteria", "review this issue", or asks
  about work-item quality.
---

# sdlc-harness

sdlc-harness puts a team of WatsonX AI agents inside the developer's existing workflow
to govern work item quality throughout the entire SDLC, before problems reach the backlog.

## When this skill activates

- The user wants to onboard a project management tool to sdlc-harness.
- The user asks the skill to check, review, or improve one or more work items.
- An agent has produced a suggestion and the user wants to review, approve, edit, or
  reject it.
- The user asks about backlog quality, acceptance criteria, ambiguity, dependencies,
  state transitions, or test coverage linkage.

---

## Scope

This skill acts **only** on the project management project/group established
during onboarding (Phase 1). It never reads or writes issues, merge requests,
or labels in any other GitLab group or project on the same instance, even when
scanning for dependency overlap or monitoring state. If the user wants to govern
a different project, they must re-run onboarding to reconfigure scope — the skill
does not infer or expand scope on its own.

---

## Phase 1 — Onboarding (Task 18)

Check whether the project has already been onboarded by looking for a `.sdlc-harness.json`
config in the repo root.

- **Not onboarded:** Run the onboarding conversation below.
- **Already onboarded:** Load the config and proceed to Phase 3.

### Onboarding conversation

Ask the user:

1. Which GitLab project should be governed? (default: `http://localhost:8080/sdlc-harness/weather-dashboard`)
2. What work item types does the team use? (e.g. Story, Bug, Task, Epic)
3. What are the workflow states and transition rules?
4. Are there existing work item templates to follow?

Save answers to `.sdlc-harness.json` in the repo root.

---

## Phase 2 — Work Item Templates (Task 19)

<!-- TODO Task 19: Industry best-practice templates for:
     - User Story  (title convention, description structure, Given-When-Then AC)
     - Bug         (steps to reproduce, expected vs actual, severity)
     - Task        (definition of done, effort estimate placeholder)
     - Epic        (goal, child story links, success metrics)
     DELEGATE, DO NOT DUPLICATE: the canonical standard lives in the
     `work-item-format` MCP tool (Task 13). This phase should call
     that tool for title/description/AC structure rather than re-defining the
     standard inline here.
-->

_Templates not yet implemented — see Task 19. The standard itself lives in the
`work-item-format` MCP tool; this phase wires the skill to call it, not
re-author it._

---

## Phase 3 — Governance Actions

Offer the user a menu of governance actions:

- **Audit** — scan all open issues for missing acceptance criteria, ambiguous descriptions,
  broken dependency links, or stale state transitions; produce a severity-rated report
- **Draft** — for a specific issue, draft missing acceptance criteria using Given-When-Then
  format
- **Link** — suggest dependency links between related issues based on content similarity
- **Transition** — propose state transitions for issues that appear ready to move
- **Template** — apply best-practice work item templates to selected issues

### Acceptance Criteria Agent (Task 20)

<!-- TODO Task 20: Detect issues lacking AC; draft AC using description + template as context. -->

_Not yet implemented beyond Draft action above._

### Ambiguity Detection Agent (Task 21)

<!-- TODO Task 21: Flag vague language; propose concrete rewrites. -->

_Not yet implemented._

### Dependency Suggestion Agent (Task 22)

<!-- TODO Task 22: Scan open issues for semantic overlap; propose relates-to / blocks links. -->

_Not yet implemented beyond Link action above._

### State Transition Agent (Task 23)

<!-- TODO Task 23: Monitor issue state; propose next transition based on activity signals
     (e.g. MR merged → suggest "In Review"). -->

_Not yet implemented beyond Transition action above._

### Test Coverage Linkage Agent (Task 24 — P1 stretch)

<!-- TODO Task 24 (P1): Cross-reference issues with test files / test plan items;
     flag uncovered work items. Build only after P0 agents and demo loop are proven. -->

_Stretch goal — not yet implemented._

---

## Phase 4 — Human Review Interface (Task 25)

Present each proposed change to the user. Apply only on explicit approval.
Never modify work items without user confirmation.

<!-- TODO Task 25: Flesh out the full review interaction pattern:
     - Show suggestion with context (issue title, current description, proposed change)
     - Accept: apply the change via MCP tool call
     - Edit: take the developer's revised text, apply it
     - Reject: log the rejection to telemetry and discard
     All review actions happen in natural language inside Bob — no context switch required.
-->

---

## Phase 5 — Suggestion Telemetry (Task 26)

<!-- TODO Task 26: Log each agent proposal + outcome (accepted / edited / rejected) to a
     flat file or GitLab comment thread. Keep it minimal — no dashboard — but ensure
     an acceptance-rate number can be cited in the demo. -->

_Telemetry not yet implemented — see Task 26._

---

## MCP Tools available to this skill

The following MCP tools are registered by the sdlc-harness GitLab MCP server (Section 2A).
Use them when calling GitLab on the user's behalf:

| Tool | Purpose |
|------|---------|
| `gitlab-issue-reader` | Read issues, labels, and current state |
| `gitlab-issue-writer` | Create / update issues with duplicate detection |
| `gitlab-mr-reader`    | Read merge requests (used by state-transition agent) |
| `gitlab-mr-writer`    | Update MR descriptions or labels |
| `work-item-format`    | Canonical formatting standard for titles, descriptions, AC |

_Tools are not available until the MCP server (Tasks 7–16) is running and registered (Task 29)._
