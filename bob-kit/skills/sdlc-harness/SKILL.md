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

Every live command requires a valid `.sdlc-harness.json`, or the path named by
`SDLC_PROJECT_CONFIG`. The GitLab host and full project path are derived only from
`projectUrl`. If `GITLAB_HOST` or `GITLAB_PROJECT` is present in the process environment or
selected `.env`, it must match onboarding exactly; a mismatch or missing config stops the
operation. There is no ambient-project fallback.

---

## Phase 1 — Onboarding (Task 18)

### Install the runtime

`dist/` is generated and is not committed. After copying the bob-kit skill, install and
build it at its installed location before running any command:

```bash
SDLC_HARNESS_SKILL="$HOME/.bob/skills/sdlc-harness"
npm --prefix "$SDLC_HARNESS_SKILL" run install:skill
```

`install:skill` runs the checked-in `install.sh`, which performs a clean `npm ci` and
TypeScript build relative to the installed skill directory. Re-run it after updating the
installed skill.

Check whether the project has already been onboarded by looking for a valid
`.sdlc-harness.json` config in the repo root.

- **Not onboarded:** Run the onboarding conversation below.
- **Already onboarded:** Load the config and proceed to Phase 3.

### Onboarding conversation

Ask the user:

1. Which GitLab project should be governed? (default: `http://localhost:8080/sdlc-harness/weather-dashboard`)
2. What work item types does the team use? (e.g. Story, Bug, Task, Epic)
3. What are the workflow states? (e.g. Open, In Progress, In Review, Done)
4. What are the valid state transitions? (e.g. Open → In Progress, In Progress → In Review)
5. Does the GitLab tier support blocking issue links? Leave `blockingIssueLinks` false for
   the local GitLab CE demo; enable it only for a confirmed Premium/Ultimate project.

Put the answers in an onboarding input file, then invoke the installed CLI from the project
repo root:

```bash
node "$HOME/.bob/skills/sdlc-harness/dist/src/cli.js" onboard <onboarding-input.json>
```

Example `onboarding-input.json` — match these field names and shapes exactly
(`workflowStates`, not `states`; `transitionRules` as a map of state → array of
reachable states, not an array of `{ from, to }` edges):

```json
{
  "projectUrl": "http://localhost:8080/sdlc-harness/weather-dashboard",
  "workItemTypes": ["Epic", "Feature", "User Story", "Bug", "Task"],
  "workflowStates": ["Open", "In Progress", "In Review", "Done"],
  "transitionRules": {
    "Open": ["In Progress"],
    "In Progress": ["In Review"],
    "In Review": ["Done", "In Progress"]
  },
  "blockingIssueLinks": false
}
```

Run `node ".../cli.js" onboard --help` at any time for this same example plus the
current CLI usage line.

The command validates and atomically writes `.sdlc-harness.json`. It always persists
`"provider": "gitlab"`, validates `projectUrl` with `URL`, rejects credentials, query
parameters, and fragments, and requires a namespace/project path. Names and transition
targets are trimmed and deduplicated; every transition must be a direct edge between
configured states. Common state names are inferred only when each concept resolves
unambiguously. Otherwise onboarding requires `stateMapping` entries for `open`,
`inProgress`, `inReview`, and `done`. Set `SDLC_PROJECT_CONFIG` only when the authoritative
config belongs at an explicit alternate path.

---

## Phase 2 — Work Item Templates (Task 19)

The standard lives in the `work-item-format` MCP tool, not here. Tasks 20 and 21 call
`get-template` at drafting time (see Phase 3), so the template is fetched per work-item
type rather than duplicated in this file or in the agent code.

---

## Phase 3 — Agent Monitoring (Tasks 20–24)

Run the compiled, read-only controller from the repo root:

```bash
node "$HOME/.bob/skills/sdlc-harness/dist/src/cli.js" audit
```

The controller fetches open issues and project merge requests through the scoped REST
reader, runs AC, ambiguity, dependency, and state agents, and runs coverage only when it is
enabled. It returns structured JSON containing `timestamp`, scope, issues, stable finding
IDs, and per-issue review groups with conflict reasons. Audit makes GET requests only and
never writes to GitLab. HTTP calls time out after 15 seconds. Reads fail rather than
truncate after 5 pages or 500 items, and MR queries are limited to the preceding 90 days.
Each finding is surfaced for human review before any later write.

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
| COV *(P1)* | Test-coverage linkage | Issues with no configured test-file reference |

COV is disabled by default. To enable, set:

```json
{
  "coverage": {
    "enabled": true,
    "testFilePatterns": ["weather-app/**/*.test.*"]
  }
}
```

Enabled coverage requires at least one nonblank repo-relative pattern. Only files matching
`testFilePatterns` are read, and COV is then included in audit output automatically. The
scanner supports `*`, `**`, and `?`; `.git`, `node_modules`, `dist`, and `coverage` are
skipped unless the configured patterns name those directories explicitly. Pattern roots and
files must be real, non-symlinked paths under the project root. A scan fails closed after
10,000 files or when a matched file exceeds 1 MiB.

---

### Acceptance Criteria Agent (Task 20)

**Module:** `bob-kit/skills/sdlc-harness/src/agents/ac-agent.ts`
**Export:** `runAcAgent(issue, config) → AgentFinding | null`

The agent finds the issues that need criteria. **You write the criteria.** It returns a
`draft` brief, never finished prose — `suggestedValue` holds a placeholder, and
`applyFinding` throws if you try to apply a finding that still carries a brief.

**Runtime behaviour:**

1. Call `runAcAgent(issue, projectConfig)` for each issue in scope.
2. `null` means the issue already has usable criteria. Skip it silently.
3. Otherwise you get a finding with `draft: { task, context, unknowns }`:
   - Call `work-item-format` with `action: "get-template"` and
     `type: draft.context.workItemType`, and follow the structure it returns. That tool is
     the single source of truth for format — do not invent your own layout here.
   - Write 2–4 Given-When-Then criteria grounded in `draft.context.title` and
     `draft.context.description`. Cover the main path and at least one failure case.
   - If `draft.unknowns` is non-empty, those are gaps the issue does not fill. Put a
     direct question to the author in place of each gap. Do not choose a plausible value.
   - Replace `suggestedValue` with what you wrote, delete the `draft` field, then take the
     finding to Phase 4.

**Write criteria that could only belong to this issue.** Anything that would read the same
on an unrelated ticket is filler and should be rewritten — "the system responds correctly",
"the change takes effect and is visible in the UI", "no data is corrupted". If the issue
genuinely does not say enough to write a specific criterion, ask; a question is more useful
to the author than a sentence that asserts nothing.

**Detection rules (deterministic, no model needed):** returns `null` when the description
contains a populated "Acceptance Criteria", `## AC`, or `## Criteria` section, or structured
Given/When/Then where each clause opens its own line. An empty heading and three keywords in
one line of prose do not count.

**Tool calls:** use the audit CLI to fetch scoped issues. Use `work-item-format` for the
template while drafting. Never call a GitLab writer directly; writes go through Phase 4.

---

### Ambiguity Detection Agent (Task 21)

**Module:** `bob-kit/skills/sdlc-harness/src/agents/ambiguity-agent.ts`
**Export:** `runAmbiguityAgent(issue, config) → AgentFinding | null`

Same split as Task 20: the agent locates the vague wording, **you write the replacement.**
The finding carries a `draft` brief and a placeholder `suggestedValue`.

**Runtime behaviour:**

1. Call `runAmbiguityAgent(issue, projectConfig)` for each issue in scope.
2. `null` means the description is already specific. Do not flag it.
3. Otherwise:
   - `draft.context.flaggedPhrases` lists the exact spans that cannot be tested against.
     Replace each one. Leave the rest of the description alone.
   - `draft.context.reusableDetail` holds concrete material already in the issue — file
     paths, code references, error names. Prefer these over anything you supply yourself.
   - `draft.unknowns` lists flagged phrases with no replacement available in the issue.
     Write a question to the author in place of each. Never fill one with a guess.
   - Replace `suggestedValue` with the rewritten description, delete `draft`, then take the
     finding to Phase 4.

**This replaces the author's text, so keep their voice.** Rewrite what is vague and nothing
else. Do not expand a two-line bug report into a templated form with headings they did not
ask for, and do not add scope the author never mentioned. The result should read like the
same person wrote it on a better day.

Approving an AM finding **writes to the issue description**. That is deliberate — a rewrite
nobody can apply is not governance.

**False-positive avoidance:** a description at least 80 characters long with two or more
specificity signals may suppress soft wording findings. It never suppresses placeholders,
non-testable defect phrases, unbounded improvement requests, or subjective presentation
requests.

**Detected patterns:** placeholders (TBD/TODO/FIXME/XXX), non-specific pronouns
("the thing", "some things", "something"), non-testable defects ("doesn't work well",
"is broken"), unbounded requests ("make it better and faster"), and bounded subjective UI
phrases ("make it look nicer", "aligned better", "colours don't look right").

**Tool calls:** use the audit CLI. The agent never writes directly.

---

### Dependency Suggestion Agent (Task 22)

**Module:** `bob-kit/skills/sdlc-harness/src/agents/dependency-agent.ts`
**Export:** `runDependencyAgent(issues, config) → DependencyFinding[]`

**Runtime behaviour:**

1. Run the audit CLI, which fetches open issues inside the onboarded scope.
2. It calls `runDependencyAgent(issues, projectConfig)`.
3. For each `DependencyFinding` returned:
   - Fields: `sourceIid`, `targetIid`, `suggestedLinkType` (`blocks` | `relates-to`),
     `reason`, `confidence` (0–1).
   - Proceed to Phase 4 for each finding.
4. Guarantees: no self-links, no duplicate pairs, confidence in [0,1].

**Overlap detection:** Jaccard similarity on significant keyword tokens (stop-words
removed). A finding requires at least two shared tokens and 0.08 similarity; confidence is
boosted at 0.25.

**Link type and direction:**
- `blocks` — only when `blockingIssueLinks` is true. "A blocks B" makes A the source and B
  the target; "A depends on B" makes B the source and A the target, but only when the
  directional sentence identifies the counterpart or both issues provide complementary
  blocker/dependent evidence.
- `relates-to` — when blocking links are disabled, evidence is generic, neither role is
  stated, both issues claim the same role, or one issue contains conflicting directional
  language. The lower IID is the source.
- Domain-specific heuristics (e.g. matching "/token refresh/") are intentionally
  excluded; they produce unreliable directions on real backlogs.

**Write path (after approval):** put the reviewed finding and optional edited link type in
a decision JSON file under `.bob-scratch/decisions/` (gitignored scratch directory, created
on demand) and run `.../cli.js apply <decision.json>`. The scoped adapter maps `relates-to`
to GitLab's `relates_to`. It validates and applies the edited link type, not the original
suggestion. Never create the relationship before approval.

The audit does not fan out an additional link-list request for every issue. GitLab's issue
links API rejects duplicate links; that response is surfaced as a failed write and no
additional relationship is created.

---

### State Transition Agent (Task 23)

**Module:** `bob-kit/skills/sdlc-harness/src/agents/state-transition-agent.ts`
**Export:** `runStateTransitionAgent(issue, mrs, config) → AgentFinding | null`

**Runtime behaviour:**

1. The audit CLI fetches only recently updated project MRs and accepts local `#<iid>`, the
   exact onboarded `group/project#<iid>`, or its exact issue URL. Foreign project references
   are ignored.
2. Call `runStateTransitionAgent(issue, mrs, projectConfig)`.
3. If the return value is `null`, skip — no transition warranted.
4. If the return value is an `AgentFinding` with `agent: 'ST'`:
   - The `suggestedValue` is the target state name (e.g. `'In Review'`).
   - Proceed to Phase 4.

**Signal mapping:**
- MR `state: 'merged'` → move one direct edge toward the configured review state.
- MR `state: 'opened'` → move one direct edge toward the configured in-progress state.
- No linked MRs → `null`.

Merged activity is ignored when it predates the query horizon or the issue's `updated_at`.

**Transition validation:** Current workflow state comes from configured state labels, with
GitLab opened/closed used only when no workflow label is present. Common names such as
Open/Backlog, In Progress/Doing, and In Review/Review resolve automatically; custom names
can use `stateMapping`. Path search may identify the direction of travel, but the proposed
and applied state is always exactly one configured edge. For example, a merged MR moves
Backlog to Doing first, then a later audit can move Doing to Review. Illegal jumps fail.

**NEVER automatically changes GitLab state.** All proposals go through Phase 4.

**Write path (if user accepts):** the review CLI reloads the issue, derives its current
state from labels, and verifies the chosen target is still a direct configured edge before
using GitLab's native `remove_labels` and `add_labels` parameters. Done closes the issue;
moving away from Done reopens it.

---

### Test Coverage Linkage Agent (Task 24 — P1 stretch, disabled by default)

**Module:** `bob-kit/skills/sdlc-harness/src/agents/coverage-agent.ts`
**Export:** `runCoverageAgent(issues, testContents, config) → AgentFinding[]`

**Enabled only when** `config.coverage.enabled === true` in the project config.
Add `"coverage": { "testFilePatterns": ["**/*.test.ts"], "enabled": true }` to
`.sdlc-harness.json` to enable.

**Runtime behaviour:**

1. The audit controller reads only bounded, non-symlinked files matching configured
   `testFilePatterns`.
2. Call `runCoverageAgent(issues, testContents, projectConfig)`.
3. Issues with no local or exact-project reference in any test file are flagged. Numeric
   CSS colors and foreign `group/project#iid` references do not count.
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
| `apply` | Call `sdlc-review-decision` with `apply-agent` or `apply-dependency` | ✓ `accepted` |
| `edit <text>` | Call `sdlc-review-decision` with `apply-agent` and `edited_value` | ✓ `edited` |
| `skip` | No-op | ✗ not logged |
| `reject` | Call `sdlc-review-decision` with `reject-agent` or `reject-dependency` | ✓ `rejected` |

**Only `apply` and `edit` call the GitLab writer adapter.** `skip` and `reject` do not
modify any GitLab data.

Use the compiled bridge for review decisions. Write the decision payload under the project's
gitignored `.bob-scratch/decisions/` directory (created on demand) rather than the project
root, so scratch review files don't accumulate there:

```bash
node "$HOME/.bob/skills/sdlc-harness/dist/src/cli.js" apply .bob-scratch/decisions/<decision>.json
node "$HOME/.bob/skills/sdlc-harness/dist/src/cli.js" reject .bob-scratch/decisions/<decision>.json
```

The CLI runtime-validates the finding discriminator, agent/action pairing, issue IDs,
confidence, link type, edited value, draft shape, and required stale-write metadata.
Description findings carry `originalDescription` and, when GitLab supplied it,
`originalUpdatedAt`. Immediately before writing, the adapter reloads the issue and requires
both values to match. This closes ordinary stale-review windows, but GitLab's issue update
API has no compare-and-swap precondition, so a narrow race between the final GET and PUT is
unavoidable.

### Conflict Detection

A conflict arises when two agents produce suggestions that contradict each other on the same
issue. The two most common cases:

- DEP suggests issue A *blocks* issue B (implying A must finish first), while ST suggests
  transitioning A to Done (implying it is already complete).
- AM rewrites a description in a way that would invalidate AC drafted by AC in the same run.

For an AC+AM conflict, apply AM first, rerun audit, then draft and apply AC from the updated
description. Never apply the original AC finding after AM.

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

Review them in order. When AC and AM are both accepted, apply the AM rewrite first and
then append AC. The writer also preserves an existing AC section as a safety net.
```

After the user handles all findings for an issue, proceed to the next issue.

### Writer adapter contract

At runtime, `applyFinding` calls the adapter only for **writable actions**.
The `defaultWriterAdapter` (in `gitlab-writer-adapter.ts`) is the real scoped REST adapter.
It returns `written: false` when onboarding, scope checks, validation, freshness checks, or
the GitLab request fails, so telemetry never records `accepted` for a write that did not
land. Pass `stubWriterAdapter` explicitly only in isolated unit tests.

Action-specific write semantics (for a real adapter):

| `action` | Write operation | Notes |
|---|---|---|
| `draft_ac` | Append drafted AC to issue description | Refused when undrafted or stale |
| `state_transition` | Use `add_labels`/`remove_labels` for workflow labels only | Preserves unrelated labels |
| `rewrite_desc` | Replace issue prose while preserving an existing AC section | Refused when undrafted or stale |
| `missing_coverage` | **Never written** — report only | COV findings are informational |
| `dependency_link` | Create a GitLab issue link | `create-link`; maps `relates-to` to GitLab's `relates_to` |

The `sdlc-review-decision` MCP tool is the interactive review path. It delegates to the
compiled review runtime, so the GitLab write and telemetry outcome stay together. Do not
use `gitlab-issue-writer` directly for an agent review decision. The CLI bridge
(`npm run review -- apply <decision.json>`) provides the same behaviour for terminal use.
Both entry points use the real scoped adapter and record `accepted` or `edited` only after
GitLab confirms the write. Failed writes are recorded as `failed`. A telemetry failure is
returned as `telemetryRecorded: false` plus a warning and never changes a successful
`gitlabWriteSucceeded` result.

---

## Phase 5 — Suggestion Telemetry (Task 26)

**Module:** `bob-kit/skills/sdlc-harness/src/skill/telemetry.ts`
**File:** `sdlc-harness-telemetry.jsonl` beside the selected project config (gitignored)

### Logged events

One JSON object is appended per **accepted**, **edited**, **rejected**, or **failed**
decision. **Skip is neutral and NOT logged.**

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

Every apply / edit / reject outcome is appended to the selected project's telemetry file
(append-only, never overwritten). The file contains no issue content, only metadata.

```jsonc
{
  "timestamp": "2025-09-01T14:32:10.000Z",
  "agent": "AC",
  "issueIid": 12,
  "action": "draft_ac",
  "outcome": "accepted",   // "accepted" | "edited" | "rejected" | "failed"
  "editedFields": []       // populated when outcome = "edited"
}
```

The acceptance rate is consistently defined as
`accepted / (accepted + edited + rejected)`. `failed` outcomes are excluded from both the
numerator and denominator because the requested write did not complete.

### Acceptance-rate summary

Call `computeAcceptanceRate(entries)` from `telemetry.ts` to get:

```
Total:           N decisions logged (failed excluded)
Accepted:        N  (N%)
Edited:          N  (N%)
Rejected:        N  (N%)
Failed:          N  (write did not reach GitLab — excluded from rates)
Acceptance rate: N%     (accepted / total)
```

Present this summary when the user asks "how are we doing?" or at the end of an Audit.

### Environment override

Set `SDLC_TELEMETRY_PATH` to explicitly redirect the telemetry file (used in tests).

---

## Runtime boundaries

The built CLI owns the authoritative live audit and review runtime so its scope checks cannot
be skipped. `audit` is read-only, `apply` is the only CLI command that mutates GitLab, and
`reject` and `summary` do not contact GitLab. The `sdlc-review-decision` MCP tool is the
interactive review entry point and must delegate to the same compiled apply/reject runtime.
Do not use the generic GitLab writer for an agent review decision.

The MCP server exposes these related tools:

| Tool | Purpose |
|------|---------|
| `gitlab-issue-reader` | Ordinary issue reads outside the harness audit |
| `gitlab-issue-writer` | Ordinary issue maintenance, not review decisions |
| `sdlc-review-decision` | Apply/reject agent findings and report telemetry metrics |
| `gitlab-mr-reader-writer` | Ordinary MR reads and notes outside the harness audit |
| `work-item-format` | Canonical formatting standard for titles, descriptions, AC |

_Tools are not available until the MCP server (Tasks 7–16) is running and registered (Task 29)._
Use `work-item-format` only to draft text from an audit finding; it does not select or mutate
the GitLab project.

---

## Files changed by Tasks 20–26

```
bob-kit/skills/sdlc-harness/
├── install.sh                             — clean installed-skill dependency/build step
├── package.json                          — test runner (Jest + ts-jest)
├── tsconfig.json                         — TypeScript (commonjs, strict)
├── src/
│   ├── cli.ts                            — onboard / audit / review / summary commands
│   ├── models.ts                         — shared types (ProjectConfig, AgentFinding, …)
│   ├── index.ts                          — barrel export
│   ├── agents/
│   │   ├── ac-agent.ts                   — Task 20: AC detection + GWT drafting
│   │   ├── ambiguity-agent.ts            — Task 21: vague-language detection + rewrite
│   │   ├── dependency-agent.ts           — Task 22: Jaccard overlap → blocks/relates-to
│   │   ├── state-transition-agent.ts     — Task 23: MR signal → direct state edge
│   │   └── coverage-agent.ts             — Task 24 (P1): test-file ref extraction
│   └── skill/
│       ├── audit.ts                      — scoped read-only audit controller
│       ├── cli-controller.ts             — testable command dispatch
│       ├── gitlab-reader-adapter.ts      — project-scoped GitLab reads
│       ├── gitlab-rest.ts                — scoped request and redirect guard
│       ├── gitlab-runtime.ts             — config / environment scope enforcement
│       ├── onboard.ts                    — Task 18: validation + atomic persistence
│       ├── review-payload.ts             — untrusted CLI payload validation
│       ├── review.ts                     — Task 25: apply / reject / conflict tracking
│       ├── telemetry.ts                  — Task 26: JSONL append, acceptance-rate
│       └── gitlab-writer-adapter.ts      — scoped, guarded GitLab writes
└── tests/
    ├── hardening.test.ts                 — filesystem, HTTP, scope, and concurrency bounds
    ├── skill.test.ts                     — core behavior tests
    └── regressions.test.ts               — audited-gap regression tests
```
