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
scanning for dependency overlap (Task 22) or monitoring state (Task 23). If the
user wants to govern a different project, they must re-run onboarding to
reconfigure scope — the skill does not infer or expand scope on its own.

---

## Phase 1 — Onboarding (Task 18)

<!-- TODO Task 18: Guided conversation that collects:
     - Project management tool type (GitLab Issues | Jira | Azure DevOps | GitHub Projects)
     - Project URL / project identifier
     - Work item types in use (User Story, Bug, Task, Epic, …)
     - Workflow states and their meaning
     - Transition rules (which state changes are valid and what triggers them)
     Persist these as skill configuration so agents can reference them at runtime.
-->

_Onboarding flow not yet implemented — see Task 18._

---

## Phase 2 — Work Item Templates (Task 19)

<!-- TODO Task 19: Industry best-practice templates for:
     - User Story  (title convention, description structure, Given-When-Then AC)
     - Bug         (steps to reproduce, expected vs actual, severity)
     - Task        (definition of done, effort estimate placeholder)
     - Epic        (goal, child story links, success metrics)
     The skill applies these templates when creating or reviewing work items.
     DELEGATE, DO NOT DUPLICATE: the canonical standard already lives in the
     `work-item-format` MCP tool (Section 2A, Task 13). This phase should call
     that tool for title/description/AC structure rather than re-defining the
     standard inline here — keep the skill and the tool as a single source of
     truth.
-->

_Templates not yet implemented — see Task 19. The standard itself lives in the
`work-item-format` MCP tool; this phase wires the skill to call it, not
re-author it._

---

## Phase 3 — Agent Monitoring

Agents run continuously (or on demand — see Task 30 for the orchestration design) and produce
suggestions. Each suggestion is logged for telemetry (Task 26) before being surfaced for review.

### Acceptance Criteria Agent (Task 20)

<!-- TODO Task 20: Detect issues lacking AC; draft AC using description + template as context. -->

_Not yet implemented._

### Ambiguity Detection Agent (Task 21)

<!-- TODO Task 21: Flag vague language; propose concrete rewrites. -->

_Not yet implemented._

### Dependency Suggestion Agent (Task 22)

<!-- TODO Task 22: Scan open issues for semantic overlap; propose relates-to / blocks links. -->

_Not yet implemented._

### State Transition Agent (Task 23)

<!-- TODO Task 23: Monitor issue state; propose next transition based on activity signals
     (e.g. MR merged → suggest "In Review"). -->

_Not yet implemented._

### Test Coverage Linkage Agent (Task 24 — P1 stretch)

<!-- TODO Task 24 (P1): Cross-reference issues with test files / test plan items;
     flag uncovered work items. Build only after P0 agents and demo loop are proven. -->

_Stretch goal — not yet implemented._

---

## Phase 4 — Human Review Interface (Task 25)

<!-- TODO Task 25: Define the Bob interaction pattern for reviewing an agent suggestion:
     - Show the suggestion with context (issue title, current description, proposed change)
     - Accept: apply the change via MCP tool call
     - Edit: take the developer's revised text, apply it
     - Reject: log the rejection to telemetry and discard
     All review actions happen in natural language inside Bob — no context switch required.
-->

_Review interface not yet implemented — see Task 25._

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
