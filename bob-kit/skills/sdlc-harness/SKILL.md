---
name: sdlc-harness
description: |
  Governs work item quality throughout the SDLC for a GitLab project. Onboards to the
  team's workflow, applies best-practice templates, monitors work items, drafts acceptance
  criteria, flags ambiguous descriptions, suggests dependency links, and proposes state
  transitions. Use when the user asks to govern, audit, or improve their backlog or work
  items on the local GitLab demo instance.
---

# SDLC Harness Skill

You are an SDLC governance agent. When invoked, follow this workflow.

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

Check whether the project has already been onboarded by looking for a `.sdlc-harness.json`
config in the repo root.

- **Not onboarded:** Run the onboarding conversation below.
- **Already onboarded:** Load the config and proceed to Phase 3.

### Onboarding conversation

Ask the user:

1. Which GitLab project should be governed? (default: `http://localhost:8080/sdlc-harness/weather-dashboard`)
2. What work item types does the team use? (e.g. Story, Bug, Task, Epic)
3. What are the workflow states? (e.g. Open, In Progress, In Review, Done)
4. What are the valid state transitions? (e.g. Open → In Progress, In Progress → In Review)
5. Are there existing work item templates to follow?

Save answers to `.sdlc-harness.json` in the repo root using the `ProjectConfig` schema
defined in `bob-kit/skills/sdlc-harness/src/models.ts`.

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

## Phase 3 — Agent Monitoring (Tasks 20–24)

Agents run on demand (user triggers an Audit or a targeted action) and produce
`AgentFinding` or `DependencyFinding` objects (see `src/models.ts`). Each finding
is surfaced for human review (Phase 4) before any write occurs.

### Governance action menu

When the user asks to govern issues, present these options:

- **Audit** — run all P0 agents across all open issues and compile a report
- **Draft AC** — run the AC agent on a specific issue or all issues missing AC
- **Check ambiguity** — run the ambiguity agent on a specific issue or all issues
- **Suggest links** — run the dependency agent across all open issues
- **Check transitions** — run the state-transition agent across all open issues
- **Coverage** — run the test coverage agent (only if `coverage.enabled` is true in config)

---

## Agents

| ID | Agent | Concern |
|---|---|---|
| AC | Acceptance-criteria | Issues without Given-When-Then AC |
| AM | Ambiguity detection | Issues with vague or contradictory descriptions |
| DEP | Dependency suggestion | Issues that likely block or relate to each other |
| ST | State-transition | Issues whose GitLab state is stale relative to activity |
| TC *(P1)* | Test-coverage linkage | Issues with no linked test file or test-plan item |

TC is disabled by default (seed data has no test files). To enable:
1. Add at least one test file to `weather-app/` (e.g. `weather.test.js`).
2. Set `"testGlob": "weather-app/**/*.test.*"` in `.sdlc-harness.json`.
3. TC will be included in subsequent audit runs automatically.

---

### Acceptance Criteria Agent (Task 20)

**Module:** `bob-kit/skills/sdlc-harness/src/agents/ac-agent.ts`
**Export:** `runAcAgent(issue, config) → AgentFinding | null`

**Runtime behaviour:**

1. For each issue (or the specified issue), call `runAcAgent(issue, projectConfig)`.
2. If the return value is `null`, skip — the issue already has usable acceptance criteria.
   Do **not** surface a finding. Return no finding to the user.
3. If the return value is an `AgentFinding` with `agent: 'AC'`:
   - The `suggestedValue` contains a Given-When-Then draft.
   - Proceed to Phase 4 (Human Review) for this finding.

**AC detection rules (deterministic — no LLM required):**
- Returns `null` if the description contains "Acceptance Criteria" (case-insensitive),
  structured multi-line GWT (Given / When / Then each starting their own line), or "## AC".
- Drafts a Given-When-Then skeleton from the issue title and description directly in
  `ac-agent.ts`. **Does NOT call the `work-item-format` MCP tool** — that tool
  integration is reserved for Phase 2 (Task 19) when the template standard is wired.

**Tool calls:** Uses `gitlab-issue-reader` (action: `list-issues` or `get-issue`) to
fetch issue data. **Never calls `gitlab-issue-writer` directly** — all writes go
through the review interface.

---

### Ambiguity Detection Agent (Task 21)

**Module:** `bob-kit/skills/sdlc-harness/src/agents/ambiguity-agent.ts`
**Export:** `runAmbiguityAgent(issue, config) → AgentFinding | null`

**Runtime behaviour:**

1. For each issue, call `runAmbiguityAgent(issue, projectConfig)`.
2. If the return value is `null`:
   - The description is specific enough — no finding surfaced.
   - Do NOT flag the issue. This avoids false positives on technically detailed descriptions.
3. If the return value is an `AgentFinding` with `agent: 'AM'`:
   - The `suggestedValue` is **advisory guidance only** — structured prompts that help the
     author improve their description. It is NOT verbatim replacement text and must
     **never be written directly into the issue description**.
   - The `reason` field explains which vague pattern was detected.
   - Present the guidance to the author for manual revision. Do not call `applyFinding`
     with an AM finding; if the user types `apply`, inform them the AM finding is
     advisory-only and ask them to rephrase the description themselves.

**False-positive avoidance:** The agent returns `null` for descriptions that contain ≥2
specificity signals (file paths, endpoints, inline code, URLs, class/function/method
references) AND are at least 80 characters long.

**Detected patterns:** placeholder phrases (TBD/TODO/FIXME), "the thing"/"something",
"fix it"/"it doesn't work", and "does not work" without context.
Note: subjective qualifiers ("properly", "correctly") were intentionally removed from
detection to prevent the AC agent's own output from triggering the ambiguity agent.

**Tool calls:** Reads issues via `gitlab-issue-reader`. Never writes.

---

### Dependency Suggestion Agent (Task 22)

**Module:** `bob-kit/skills/sdlc-harness/src/agents/dependency-agent.ts`
**Export:** `runDependencyAgent(issues, config) → DependencyFinding[]`

**Runtime behaviour:**

1. Fetch all open issues via `gitlab-issue-reader` (action: `list-issues`, state: `opened`).
2. Call `runDependencyAgent(issues, projectConfig)`.
3. For each `DependencyFinding` returned:
   - Fields: `sourceIid`, `targetIid`, `suggestedLinkType` (`blocks` | `relates-to`),
     `reason`, `confidence` (0–1).
   - Proceed to Phase 4 for each finding.
4. Guarantees: no self-links, no duplicate pairs, confidence in [0,1].

**Overlap detection:** Jaccard similarity on significant keyword tokens (stop-words
removed). Threshold: 0.12 for a finding; 0.25 for high-confidence boost.

**Link type and direction:**
- `blocks` — only when exactly one side carries dependency language ("depends on",
  "requires", "prerequisite", "blocks"). The side that depends on the other is the
  target; the prerequisite side is the source.
- `relates-to` — when both or neither sides carry dependency language (direction is
  ambiguous). The lower IID is always set as `sourceIid` for canonical ordering.
- Domain-specific heuristics (e.g. matching "/token refresh/") are intentionally
  excluded from `BLOCKS_SIGNALS`; they produce unreliable directions on real backlogs.

**Report-only (no write path):** `DependencyFinding` objects are **always report-only**.
The `gitlab-issue-writer` MCP tool has no native issue-links endpoint, so
`applyFinding` never writes for DEP findings (`gitlabWriteCalled` is always `false`).
Present the finding as a recommendation the team can action manually, or document it
as a comment by calling `gitlab-issue-writer` (action: `add-note`) outside the normal
review loop if the user explicitly requests it.

---

### State Transition Agent (Task 23)

**Module:** `bob-kit/skills/sdlc-harness/src/agents/state-transition-agent.ts`
**Export:** `runStateTransitionAgent(issue, mrs, config) → AgentFinding | null`

**Runtime behaviour:**

1. For each open issue, fetch related MRs via `gitlab-mr-reader-writer` (action: `list-mrs`).
   Match MRs by checking their `description` for `Closes #<iid>`, `Fixes #<iid>`, or the
   issue IID appearing in the MR title. Pass the matched MRs as the `mrs` parameter.
2. Call `runStateTransitionAgent(issue, mrs, projectConfig)`.
3. If the return value is `null`, skip — no transition warranted.
4. If the return value is an `AgentFinding` with `agent: 'ST'`:
   - The `suggestedValue` is the target state name (e.g. `'In Review'`).
   - Proceed to Phase 4.

**Signal mapping:**
- MR `state: 'merged'` → propose `'In Review'` (transitively reachable).
- MR `state: 'opened'` → propose `'In Progress'` (if valid from current state).
- No linked MRs → `null`.

**Transition validation:** Uses BFS over `config.transitionRules` to check transitive
reachability. A transition is only proposed if the target state is reachable from the
current state (directly or through intermediate states).

**NEVER automatically changes GitLab state.** All proposals go through Phase 4.

**Write path (if user accepts):** Call `gitlab-issue-writer` (action: `update-issue`)
with the appropriate `state_event` (`close` for Done, otherwise update labels to reflect
the new state).

---

### Test Coverage Linkage Agent (Task 24 — P1 stretch, disabled by default)

**Module:** `bob-kit/skills/sdlc-harness/src/agents/coverage-agent.ts`
**Export:** `runCoverageAgent(issues, testContents, config) → AgentFinding[]`

**Enabled only when** `config.coverage.enabled === true` in the project config.
Add `"coverage": { "testFilePatterns": ["**/*.test.ts"], "enabled": true }` to
`.sdlc-harness.json` to enable.

**Runtime behaviour:**

1. Read test file contents matching the configured glob patterns.
2. Call `runCoverageAgent(issues, testContents, projectConfig)`.
3. Issues with no `#<iid>` or `closes #<iid>` reference in any test file are flagged.
4. Surface each finding through Phase 4.

---

## Phase 4 — Human Review Interface (Task 25)

**Module:** `bob-kit/skills/sdlc-harness/src/skill/review.ts`
**Exports:** `applyFinding(finding, options, adapter?)`, `rejectFinding(finding)`

### Review presentation

For each `AgentFinding` or `DependencyFinding`, present to the user:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 [AGENT-TAG] Issue #<iid>: <issue title>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reason: <finding.reason>

Proposed change:
<finding.suggestedValue>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reply with:
  apply     — accept and write to GitLab
  edit <…>  — accept with your changes and write
  skip      — move on without logging
  reject    — discard and log rejection
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Decision handling

| User input | Action | Logged |
|------------|--------|--------|
| `apply` | Call `applyFinding(finding, { editedValue: null })` | ✓ `accepted` |
| `edit <text>` | Call `applyFinding(finding, { editedValue: '<text>' })` | ✓ `edited` |
| `skip` | No-op | ✗ not logged |
| `reject` | Call `rejectFinding(finding)` | ✓ `rejected` |

**Only `apply` and `edit` call the GitLab writer adapter.** `skip` and `reject` do not
modify any GitLab data.

### Conflict Detection

A conflict arises when two agents produce suggestions that contradict each other on the same
issue. The two most common cases:

- DEP suggests issue A *blocks* issue B (implying A must finish first), while ST suggests
  transitioning A to Done (implying it is already complete).
- AM rewrites a description in a way that would invalidate AC drafted by AC in the same run.

Before presenting the review, check for overlapping `issueIid` values across all agent
findings. Conflicting findings are grouped and flagged:

```
⚡ CONFLICT — Issue #7 has suggestions from two agents that may contradict:

  [ST] Proposed transition: Open → In Progress
       (reason: MR !3 referencing this issue was opened 2h ago)

  [DEP] Proposed link: #7 blocks #9
       (reason: both issues describe the same auth token refresh logic)

  → apply ST first / apply DEP first / apply both / skip both
```

Do not auto-resolve conflicts. The user decides.

When multiple agents produce findings for the **same issue IID** in the same session,
surface them one at a time in a numbered list before presenting each individually:

```
⚠️  Multiple findings for issue #<iid>:
  1. [AC]  Draft missing acceptance criteria
  2. [AM]  Rewrite vague description

Review them in order. Apply, edit, skip, or reject each separately.
```

After the user handles all findings for an issue, proceed to the next issue.

### Writer adapter contract

At runtime, `applyFinding` calls the adapter only for **writable actions**.
The `defaultWriterAdapter` (in `gitlab-writer-adapter.ts`) deliberately returns
`written: false` when no real adapter is injected, so telemetry will never record
`outcome: accepted` for writes that never reached GitLab.  Pass `stubWriterAdapter`
explicitly in unit tests.

Action-specific write semantics (for a real adapter):

| `action` | Write operation | Notes |
|---|---|---|
| `draft_ac` | Append AC text to issue description | `update-issue` |
| `state_transition` | Apply scoped label swap; GitLab has only `opened`/`closed` states | `update-issue` |
| `rewrite_desc` | **Never written** — advisory only | AM findings are guidance, not replacements |
| `missing_coverage` | **Never written** — report only | COV findings are informational |
| `dependency_link` | **Never written** by the adapter — report only | No links API; use `add-note` outside review loop if needed |

**Missing integration note:** The `gitlab-issue-writer` MCP tool does not yet expose a
native "add link" operation. Until it does, dependency links are presented as
recommendations only.  The adapter boundary in `gitlab-writer-adapter.ts` is the
documented extension point for a future real integration.

---

## Phase 5 — Suggestion Telemetry (Task 26)

**Module:** `bob-kit/skills/sdlc-harness/src/skill/telemetry.ts`
**File:** `sdlc-harness-telemetry.jsonl` (in the working directory; gitignored)

### Logged events

One JSON object is appended per **accepted**, **edited**, or **rejected** decision.
**Skip is neutral and NOT logged.**

**Schema (one object per line):**
```json
{
  "timestamp": "2025-09-01T10:00:00.000Z",
  "agent": "AC",
  "issueIid": 12,
  "action": "draft_ac",
  "outcome": "accepted",
  "editedFields": []
}
```

**Security rules:**
- Never log issue title, description, or any GitLab content.
- Never log credentials, tokens, or URLs containing auth params.
- The file is append-only; existing entries are never modified.
- The file is gitignored (`sdlc-harness-telemetry.jsonl`).

### Telemetry

Every apply / edit / reject outcome is appended to `sdlc-harness-telemetry.jsonl` in the
repo root (append-only, never overwritten). The file is gitignored and contains no issue
content — only metadata.

```jsonc
{
  "ts": "2025-09-01T14:32:10Z",
  "agent": "AC",
  "issueIid": 12,
  "action": "draft_ac",
  "outcome": "accepted",   // "accepted" | "edited" | "rejected" | "failed"
  "editedFields": []       // populated when outcome = "edited"
}
```

The acceptance rate (`accepted / (accepted + rejected)`) is the primary trust metric for the demo.
Note: `"failed"` outcomes (write attempted but adapter returned `written: false`) are excluded
from both the numerator and denominator of all rate calculations.

### Acceptance-rate summary

Call `computeAcceptanceRate(entries)` from `telemetry.ts` to get:

```
Total:           N decisions logged (failed excluded)
Accepted:        N  (N%)
Edited:          N  (N%)
Rejected:        N  (N%)
Failed:          N  (write did not reach GitLab — excluded from rates)
Acceptance rate: N%     (accepted / total)
Approval rate:   N%     (accepted + edited) / total
```

Present this summary when the user asks "how are we doing?" or at the end of an Audit.

### Environment override

Set `SDLC_TELEMETRY_PATH` env var to redirect the telemetry file (used in tests).

---

## MCP Tools available to this skill

The following MCP tools are registered by the sdlc-harness GitLab MCP server (Section 2A).
Use them when calling GitLab on the user's behalf:

| Tool | Purpose |
|------|---------|
| `gitlab-issue-reader` | Read issues, labels, and current state |
| `gitlab-issue-writer` | Create / update issues, add notes, change state |
| `gitlab-mr-reader-writer` | Read MRs (state-transition signal), write MR notes |
| `work-item-format` | Canonical formatting standard for titles, descriptions, AC |

_Tools are not available until the MCP server (Tasks 7–16) is running and registered (Task 29)._

---

## Files changed by Tasks 20–26

```
bob-kit/skills/sdlc-harness/
├── package.json                          — test runner (Jest + ts-jest)
├── tsconfig.json                         — TypeScript (commonjs, strict)
├── src/
│   ├── models.ts                         — shared types (ProjectConfig, AgentFinding, …)
│   ├── index.ts                          — barrel export
│   ├── agents/
│   │   ├── ac-agent.ts                   — Task 20: AC detection + GWT drafting
│   │   ├── ambiguity-agent.ts            — Task 21: vague-language detection + rewrite
│   │   ├── dependency-agent.ts           — Task 22: Jaccard overlap → blocks/relates-to
│   │   ├── state-transition-agent.ts     — Task 23: MR signal → state proposal (BFS)
│   │   └── coverage-agent.ts             — Task 24 (P1): test-file ref extraction
│   └── skill/
│       ├── onboard.ts                    — Task 18: config validation
│       ├── review.ts                     — Task 25: apply / reject / conflict tracking
│       ├── telemetry.ts                  — Task 26: JSONL append, acceptance-rate
│       └── gitlab-writer-adapter.ts      — adapter boundary for MCP write calls
└── tests/
    └── skill.test.ts                     — 60 tests covering Tasks 18–26
```
