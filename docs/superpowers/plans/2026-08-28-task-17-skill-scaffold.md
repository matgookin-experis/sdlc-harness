# sdlc-harness Skill Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the `SKILL.md` file for the `sdlc-harness` Bob skill with correct frontmatter (name, description, triggers) following Bob skill authoring conventions — this is Task 17 (P0) from `to-do.md`.

**Architecture:** A single workspace-scoped Bob skill lives at `.bob/skills/sdlc-harness/SKILL.md`. The frontmatter declares the skill name and a description written as a trigger phrase so Bob auto-activates it when a developer asks to govern their backlog or manage work item quality. The body contains a concise procedural outline of the skill's phases (onboarding, agent monitoring, review UX) which later tasks (18–26) will flesh out into full instructions.

**Tech Stack:** Markdown only (Bob skill SKILL.md format); no code dependencies.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `.bob/skills/sdlc-harness/SKILL.md` | The Bob skill entry point — frontmatter + procedural body scaffold |
| Create | `docs/superpowers/plans/2026-08-28-task-17-skill-scaffold.md` | This plan (already created) |

---

## Task 1: Create the `.bob/skills/sdlc-harness/` directory and `SKILL.md`

**Files:**
- Create: `.bob/skills/sdlc-harness/SKILL.md`

### Background — Bob skill name rules

- The skill name is the **directory name** that contains `SKILL.md`.
- Must match `^[a-z0-9]+(-[a-z0-9]+)*$` — lowercase, digits, single dashes. Anything else silently skips the skill.
- `sdlc-harness` is valid (lowercase letters and a single dash).
- Workspace scope (`.bob/skills/`) means the skill is only available in this repository.

### Background — critical frontmatter fields

```
name:        must match the directory name exactly
description: the trigger phrase Bob uses for auto-activation — write it as
             "Use when the user wants to…" or "Activate when…" with concrete phrases
```

The `description` is the single most important field. A vague description means the skill never auto-activates.

- [ ] **Step 1: Create the skill directory**

```powershell
New-Item -ItemType Directory -Force -Path ".bob/skills/sdlc-harness"
```

Expected output: a new directory at `.bob/skills/sdlc-harness/`.

- [ ] **Step 2: Write `SKILL.md`**

Create `.bob/skills/sdlc-harness/SKILL.md` with the content below. The body is intentionally a scaffold — it names every phase the full skill will cover (Tasks 18–26) so later contributors know exactly where to expand each section without having to reverse-engineer intent.

```markdown
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
```

- [ ] **Step 3: Verify the file was written**

```powershell
Get-Content ".bob/skills/sdlc-harness/SKILL.md" | Select-Object -First 10
```

Expected: the first 10 lines show the `---` frontmatter block and `name: sdlc-harness`.

- [ ] **Step 4: Validate the skill name against the Bob naming rule**

The name `sdlc-harness` must match `^[a-z0-9]+(-[a-z0-9]+)*$`.

Manual check:
- All lowercase? ✅ (`s`, `d`, `l`, `c`, `h`, `a`, `r`, `n`, `e`, `s`)
- Only letters, digits, single dashes? ✅ (one dash between `sdlc` and `harness`)
- No leading/trailing/doubled dashes? ✅
- Length ≤ 64 chars? ✅ (12 chars)

No automated script needed — this is a one-time visual check.

- [ ] **Step 5: Stage and commit**

```powershell
git add .bob/skills/sdlc-harness/SKILL.md
git add docs/superpowers/plans/2026-08-28-task-17-skill-scaffold.md
git commit -m "Scaffold sdlc-harness Bob skill SKILL.md

- Creates .bob/skills/sdlc-harness/SKILL.md with correct frontmatter
  (name, multi-line description with concrete trigger phrases)
- Body is a phase-by-phase scaffold referencing Tasks 18-26 for later
  contributors to expand each section
- Includes MCP tool reference table for the tools from Section 2A
- Adds implementation plan to docs/superpowers/plans/"
```

---

## Self-Review

### Spec coverage (to-do.md Task 17)

> _"create the `SKILL.md` file for the `sdlc-harness` Bob skill with correct frontmatter (name, description, triggers) following the Bob skill authoring conventions."_

| Requirement | Covered? |
|-------------|----------|
| `SKILL.md` file created | ✅ Task 1, Step 2 |
| `name` frontmatter field | ✅ `name: sdlc-harness` |
| `description` frontmatter field | ✅ multi-line trigger phrase block |
| Trigger phrases | ✅ "sdlc-harness", "/sdlc-harness", "govern my backlog", "check my work items", "draft acceptance criteria", "review this issue" |
| Bob skill authoring conventions (name regex, dir structure) | ✅ validated in Step 4 |
| Workspace scope (`.bob/skills/`) | ✅ |
| Project/data scope boundary (prevents cross-project drift once agents run) | ✅ `## Scope` section |
| Phase 2 delegates to `work-item-format` tool instead of duplicating the standard | ✅ TODO Task 19 comment |

### Placeholder scan

The body contains intentional `<!-- TODO Task N -->` scaffolding comments — these are **not** the forbidden "TBD" or "fill in details" anti-patterns. Each one names the exact to-do task number responsible for filling in that section, making them actionable tracking markers, not vague deferrals.

### No type-consistency issues

This is a Markdown-only deliverable with no code types or method signatures to cross-check.
