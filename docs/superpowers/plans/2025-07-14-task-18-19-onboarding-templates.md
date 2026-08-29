# Task 18 & 19 — Onboarding Flow + Work Item Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all remaining gaps in Task 18 (onboarding conversation flow) and Task 19 (work item template baseline) so both items can be marked done.

**Architecture:** Task 18 gaps are split across two layers — the `onboard.ts` validation module (missing `coverage` opt-in, missing `workItemTypes` validation, missing transition-rules cross-check) and the `SKILL.md` Phase 1 conversation prose (one dead question with no effect on the saved config, removed in Task 5). Task 19 is already fully implemented in `work-item-format.ts`; the only gaps are a placeholder comment in `SKILL.md Phase 2` and the absence of any automated test — Jest or otherwise — confirming the template contract at the MCP-tool level.

**Tech Stack:** TypeScript, Jest / ts-jest (existing test suite at `bob-kit/skills/sdlc-harness/`), Node.js ≥ 18.

---

## Execution Convention — Task Handoff & Context Efficiency

**For agentic workers dispatching a fresh subagent per task (subagent-driven-development):**

1. **End-of-task handoff summary (mandatory, Tasks 1–6).** Once a task's steps are done and its tests pass, the implementer appends a fixed-format block directly under that task's heading in this file, before moving on:

   ```markdown
   > **Handoff — Task N complete**
   > Files touched: <paths>
   > Tests: <before> → <after> passing
   > Decisions/deviations from the plan: <one line, or "none">
   > Follow-ups for the next task: <one line, or "none">
   ```

   This block is the only thing the next task's implementer (or the orchestrator) should need to read to pick up where the previous one left off — it must not require re-diffing the repo or re-reading earlier tasks in full.

2. **System context vs. per-task context (token efficiency).** The material every task shares — Goal, Architecture, Tech Stack, Current State, File Map — is given ONCE, as persistent/system-level context to the executing agent (the orchestrator's own resident context when staying in-session, or the fresh subagent's system-level briefing when dispatched). Each individual task dispatch then carries ONLY:
   - that task's own step text (already extracted, per subagent-driven-development's own convention — do not make the subagent read this file),
   - the immediately preceding task's Handoff summary (not the full plan),
   - the specific File Map rows that task touches.

   Do not re-paste the whole plan (Goal/Architecture/Current State/File Map) into every subagent's per-task prompt — it's already available as shared context, and re-sending it on every dispatch inflates token cost linearly with plan length for no benefit.

---

## Current State

### What already exists and passes

- `bob-kit/skills/sdlc-harness/src/skill/onboard.ts` — validation function, 4 passing tests
- `bob-kit/skills/sdlc-harness/src/models.ts` — `ProjectConfig`, `CoverageConfig`, `TransitionRules` types
- `bob-kit/mcp-server/src/tools/work-item-format.ts` — full templates for Epic, Feature, User Story, Bug, Task
- `bob-kit/skills/sdlc-harness/SKILL.md` — Phase 1 onboarding steps documented; Phase 2 has a `<!-- TODO Task 19 -->` comment
- All 61 existing tests pass (`npm test` in `bob-kit/skills/sdlc-harness/`)

### What is missing

**Task 18 gaps:**

| Gap | Location |
|---|---|
| `onboard()` does not validate that `workItemTypes` is a non-empty array | `onboard.ts` |
| `onboard()` does not accept or validate the optional `coverage` config | `onboard.ts` / `models.ts` |
| `transitionRules` references unknown states — error message not tested for target-state path | `onboard.ts` tests |
| `SKILL.md` Phase 1 question 5 ("Are there existing templates?") has no effect on the saved config — `onboard()`/`ProjectConfig` have no template-source field, and Phase 2 confirms the standard is never user-supplied (it lives entirely in the `work-item-format` MCP tool) | `SKILL.md` — dead question removed in Task 5 |

**Task 19 gaps:**

| Gap | Location |
|---|---|
| `SKILL.md` Phase 2 still carries a `<!-- TODO Task 19 -->` block comment | `SKILL.md` |
| No test confirms the `work-item-format` tool returns the correct template shape | `bob-kit/mcp-server/` has no test runner at all (no Jest, no Vitest) — Task 4 adds a plain `node:assert` test following the package's existing `merge-bob-config.test.mjs` convention |

---

## File Map

| File | Change |
|---|---|
| `bob-kit/skills/sdlc-harness/src/skill/onboard.ts` | Add `workItemTypes` validation (it already has the function but it only checks array length, not emptiness of each string); accept optional `coverage` field; wire it through to `ProjectConfig` |
| `bob-kit/skills/sdlc-harness/src/models.ts` | Add optional `coverage?: CoverageConfig` to `ProjectConfig` |
| `bob-kit/skills/sdlc-harness/tests/skill.test.ts` | Add onboarding tests: missing workItemTypes, unknown transition-rule target state, coverage field round-trips |
| `bob-kit/skills/sdlc-harness/SKILL.md` | Remove dead Phase 1 question 5 ("existing templates?"); remove `<!-- TODO Task 19 -->` comment and clean up Phase 2 prose |
| `bob-kit/mcp-server/src/tools/work-item-format.test.ts` | New file — plain `node:assert` tests (no Jest in this package) confirming `get-template` shape for all 5 types; compiled by `tsc` alongside the tool it tests |
| `bob-kit/mcp-server/package.json` | Add a `test:templates` script to run the compiled test file |

---

## Task 1 — Add `coverage` opt-in to `ProjectConfig`

**Files:**
- Modify: `bob-kit/skills/sdlc-harness/src/models.ts`

- [ ] **Step 1: Add `coverage` field to `ProjectConfig`**

  Open `bob-kit/skills/sdlc-harness/src/models.ts`. After the `transitionRules` line, add the optional field:

  ```typescript
  export interface ProjectConfig {
    /** GitLab project URL, e.g. "http://localhost:8080/sdlc-harness/weather-dashboard" */
    projectUrl: string;
    /** Work item types in use, e.g. ["Story", "Bug", "Task", "Epic"] */
    workItemTypes: string[];
    /** Ordered workflow states, e.g. ["Open", "In Progress", "In Review", "Done"] */
    workflowStates: string[];
    /** Valid state transitions: { "Open": ["In Progress"], ... } */
    transitionRules: TransitionRules;
    /** Optional test-coverage linkage config (Task 24 — P1, disabled by default). */
    coverage?: CoverageConfig;
  }
  ```

  `CoverageConfig` is already defined in the same file — no import needed.

- [ ] **Step 2: Run tests to confirm no regression**

  ```
  npm test
  ```
  (from `bob-kit/skills/sdlc-harness/`)

  Expected: all 61 tests still pass (the field is optional so no existing callers break).

---

## Task 2 — Harden `onboard.ts` validation

**Files:**
- Modify: `bob-kit/skills/sdlc-harness/src/skill/onboard.ts`

The current `validateWorkItemTypes` checks `Array.isArray && length > 0` but does not filter blank strings. The current `OnboardInput` has no `coverage` field.

- [ ] **Step 1: Add `coverage` to `OnboardInput` and thread it through**

  Replace the `OnboardInput` interface and the `onboard()` function body in `onboard.ts`:

  ```typescript
  import type { ProjectConfig, TransitionRules, CoverageConfig } from '../models';

  export interface OnboardInput {
    projectUrl: string;
    workItemTypes: string[];
    workflowStates: string[];
    transitionRules: TransitionRules;
    /** Optional — pass only when the user explicitly opts in to coverage tracking (Task 24). */
    coverage?: CoverageConfig;
  }
  ```

  In the `onboard()` function body, after building the `config` object, include the field:

  ```typescript
  const config: ProjectConfig = {
    projectUrl: input.projectUrl.trim(),
    workItemTypes: input.workItemTypes,
    workflowStates: input.workflowStates,
    transitionRules: input.transitionRules,
    ...(input.coverage !== undefined ? { coverage: input.coverage } : {}),
  };
  ```

- [ ] **Step 2: Tighten `validateWorkItemTypes` to reject blank strings**

  Replace the function:

  ```typescript
  function validateWorkItemTypes(types: string[]): string | null {
    if (!Array.isArray(types) || types.length === 0) {
      return 'workItemTypes must be a non-empty array of strings.';
    }
    if (types.some((t) => typeof t !== 'string' || t.trim().length === 0)) {
      return 'workItemTypes must not contain blank entries.';
    }
    return null;
  }
  ```

- [ ] **Step 3: Run tests — confirm still passing**

  ```
  npm test
  ```

  Expected: all 61 pass.

---

## Task 3 — Extend onboarding tests

**Files:**
- Modify: `bob-kit/skills/sdlc-harness/tests/skill.test.ts`

Add these test cases inside the existing `describe('Onboarding flow', ...)` block, after the last existing test.

- [ ] **Step 1: Write failing test — blank workItemType entry**

  ```typescript
  test('returns validation error when workItemTypes contains a blank string', async () => {
    const result = await onboard({
      projectUrl: PROJECT_CONFIG.projectUrl,
      workItemTypes: ['Story', ''],
      workflowStates: PROJECT_CONFIG.workflowStates,
      transitionRules: PROJECT_CONFIG.transitionRules,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/workItemTypes/i);
  });
  ```

  Run: `npm test -- --testNamePattern "blank workItemType"`

  Expected: FAIL (function currently does not reject blank entries — Task 2 Step 2 adds this).

- [ ] **Step 2: Write failing test — transition rule references unknown target state**

  ```typescript
  test('returns validation error when transitionRules target is not a known state', async () => {
    const result = await onboard({
      projectUrl: PROJECT_CONFIG.projectUrl,
      workItemTypes: PROJECT_CONFIG.workItemTypes,
      workflowStates: ['Open', 'In Progress'],
      transitionRules: { 'Open': ['In Progress', 'Closed'] }, // "Closed" is not in workflowStates
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Closed/);
  });
  ```

  Run: `npm test -- --testNamePattern "transition rule"`

  Expected: PASS — this path already exists in `validateTransitionRules` but was untested.

- [ ] **Step 3: Write failing test — coverage field round-trips**

  ```typescript
  test('persists coverage config when provided', async () => {
    const result = await onboard({
      projectUrl: PROJECT_CONFIG.projectUrl,
      workItemTypes: PROJECT_CONFIG.workItemTypes,
      workflowStates: PROJECT_CONFIG.workflowStates,
      transitionRules: PROJECT_CONFIG.transitionRules,
      coverage: { testFilePatterns: ['**/*.test.ts'], enabled: true },
    });

    expect(result.ok).toBe(true);
    expect(result.config?.coverage).toEqual({
      testFilePatterns: ['**/*.test.ts'],
      enabled: true,
    });
  });

  test('config has no coverage key when not provided', async () => {
    const result = await onboard({
      projectUrl: PROJECT_CONFIG.projectUrl,
      workItemTypes: PROJECT_CONFIG.workItemTypes,
      workflowStates: PROJECT_CONFIG.workflowStates,
      transitionRules: PROJECT_CONFIG.transitionRules,
    });

    expect(result.ok).toBe(true);
    expect(result.config?.coverage).toBeUndefined();
  });
  ```

  Run: `npm test -- --testNamePattern "coverage"`

  Expected: FAIL until Task 2 is complete.

- [ ] **Step 4: Complete Task 2 (harden `onboard.ts`), then run all tests**

  ```
  npm test
  ```

  Expected: all 65 tests pass (61 existing + 4 new).

- [ ] **Step 5: Commit**

  ```
  git add bob-kit/skills/sdlc-harness/src/models.ts
  git add bob-kit/skills/sdlc-harness/src/skill/onboard.ts
  git add bob-kit/skills/sdlc-harness/tests/skill.test.ts
  git commit -m "feat(task-18): coverage opt-in in ProjectConfig, tighten workItemTypes validation"
  ```

---

## Task 4 — Work item template tests (Task 19 evidence)

The templates are embedded in `work-item-format.ts`. There are currently no automated tests against the MCP tool itself. `bob-kit/mcp-server/package.json` has no `jest`/`vitest` devDependency and no `test` script — confirmed by reading it, not assumed — so this task does **not** use Jest syntax. It follows the test convention the package already uses in `merge-bob-config.test.mjs`: plain `node:assert/strict` functions, called directly at the bottom of the file, executed with `node` against the compiled output. Exit code non-zero (an uncaught `AssertionError`) is the failure signal, same as that file.

Because `work-item-format.ts` is TypeScript under `src/tools/` (unlike `merge-bob-config.mjs`, which is plain JS in the package root and needs no build step), the test file is written in TypeScript, colocated with the tool, and picked up by the existing `tsc` build (`src/**/*` → `dist/**/*`) automatically — no new build configuration needed.

**Files:**
- Create: `bob-kit/mcp-server/src/tools/work-item-format.test.ts`
- Modify: `bob-kit/mcp-server/package.json` (add a `test:templates` script)

- [ ] **Step 1: Create `work-item-format.test.ts`**

  ```typescript
  // bob-kit/mcp-server/src/tools/work-item-format.test.ts
  //
  // Plain node:assert test — this package has no Jest/Vitest (see merge-bob-config.test.mjs
  // for the established pattern). Compiled by `npm run build` alongside the tool it tests,
  // then run directly: `node dist/tools/work-item-format.test.js`.

  import assert from 'node:assert/strict';
  import { workItemFormatTool } from './work-item-format.js';
  import type { ToolContext } from '../types.js';

  // ToolContext (gitlab client, config) is not needed by this tool — it has no
  // dependencies beyond the embedded template data — so an empty stand-in is safe here.
  const ctx = {} as unknown as ToolContext;

  const TYPES = ['Epic', 'Feature', 'User Story', 'Bug', 'Task'] as const;

  interface TemplateResult {
    template: {
      type: string;
      titleRules: string[];
      descriptionStructure: string;
      acceptanceCriteriaFormat: string;
      example: { title: string; description: string };
    };
  }

  /**
   * Verify every work item type returns a well-formed template.
   * @returns Resolves once all types have been checked.
   */
  async function testAllTypesReturnWellFormedTemplates(): Promise<void> {
    for (const type of TYPES) {
      const result = (await workItemFormatTool.execute(
        { action: 'get-template', type },
        ctx
      )) as TemplateResult;
      const { template } = result;

      assert.equal(template.type, type);
      assert.ok(Array.isArray(template.titleRules), `${type}: titleRules must be an array`);
      assert.ok(template.titleRules.length > 0, `${type}: titleRules must not be empty`);
      assert.equal(typeof template.descriptionStructure, 'string');
      assert.ok(template.descriptionStructure.length > 0, `${type}: descriptionStructure must not be empty`);
      assert.equal(typeof template.acceptanceCriteriaFormat, 'string');
      assert.equal(typeof template.example.title, 'string');
      assert.equal(typeof template.example.description, 'string');
    }
  }

  /**
   * User Story template must document the Connextra title convention.
   * @returns Resolves once the assertion has run.
   */
  async function testUserStoryIncludesConnextraRule(): Promise<void> {
    const result = (await workItemFormatTool.execute(
      { action: 'get-template', type: 'User Story' },
      ctx
    )) as TemplateResult;
    const hasConnextra = result.template.titleRules.some((r) => /connextra/i.test(r));
    assert.ok(hasConnextra, 'User Story titleRules must mention Connextra format');
  }

  /**
   * Bug template description structure must include the Steps to Reproduce section.
   * @returns Resolves once the assertion has run.
   */
  async function testBugIncludesStepsToReproduce(): Promise<void> {
    const result = (await workItemFormatTool.execute(
      { action: 'get-template', type: 'Bug' },
      ctx
    )) as TemplateResult;
    assert.ok(result.template.descriptionStructure.includes('## Steps to Reproduce'));
  }

  /**
   * User Story acceptance criteria format must document Given-When-Then.
   * @returns Resolves once the assertion has run.
   */
  async function testUserStoryAcFormatIncludesGwt(): Promise<void> {
    const result = (await workItemFormatTool.execute(
      { action: 'get-template', type: 'User Story' },
      ctx
    )) as TemplateResult;
    assert.match(result.template.acceptanceCriteriaFormat, /given[\s\S]*when[\s\S]*then/i);
  }

  await testAllTypesReturnWellFormedTemplates();
  await testUserStoryIncludesConnextraRule();
  await testBugIncludesStepsToReproduce();
  await testUserStoryAcFormatIncludesGwt();

  console.log('work-item-format.test.ts: all assertions passed');
  ```

- [ ] **Step 2: Add a `test:templates` script**

  In `bob-kit/mcp-server/package.json`, add alongside `test:config`:

  ```json
  "test:templates": "node dist/tools/work-item-format.test.js",
  ```

- [ ] **Step 3: Build and run**

  ```
  npm run build
  npm run test:templates
  ```
  (from `bob-kit/mcp-server/`)

  Expected: exits 0; last line printed is `work-item-format.test.ts: all assertions passed`. A thrown `AssertionError` (non-zero exit) means a real template regression, not a flaky test — this is exercising the actual `work-item-format.ts` module, not a proxy.

- [ ] **Step 4: Commit**

  ```
  git add bob-kit/mcp-server/src/tools/work-item-format.test.ts
  git add bob-kit/mcp-server/package.json
  git commit -m "test(task-19): work-item-format template contract tests"
  ```

---

## Task 5 — Remove dead onboarding question and the Phase 2 TODO comment

**Files:**
- Modify: `bob-kit/skills/sdlc-harness/SKILL.md`

- [ ] **Step 1: Remove Phase 1 question 5 ("Are there existing templates?")**

  This question's answer is never read anywhere — `onboard()`/`OnboardInput`/`ProjectConfig` have no
  template-source field, and Phase 2 already states the format standard is never user-supplied (it
  lives entirely in the `work-item-format` MCP tool, called at drafting time). The question implies a
  customization path that doesn't exist, so remove it rather than wire it to something unrelated.

  Find this in `SKILL.md`'s "Onboarding conversation" list:

  ```markdown
  1. Which GitLab project should be governed? (default: `http://localhost:8080/sdlc-harness/weather-dashboard`)
  2. What work item types does the team use? (e.g. Story, Bug, Task, Epic)
  3. What are the workflow states? (e.g. Open, In Progress, In Review, Done)
  4. What are the valid state transitions? (e.g. Open → In Progress, In Progress → In Review)
  5. Are there existing work item templates to follow?
  ```

  Replace it with (item 5 deleted, 1–4 unchanged):

  ```markdown
  1. Which GitLab project should be governed? (default: `http://localhost:8080/sdlc-harness/weather-dashboard`)
  2. What work item types does the team use? (e.g. Story, Bug, Task, Epic)
  3. What are the workflow states? (e.g. Open, In Progress, In Review, Done)
  4. What are the valid state transitions? (e.g. Open → In Progress, In Progress → In Review)
  ```

- [ ] **Step 2: Confirm Phase 1 reads correctly**

  Open `SKILL.md` and visually confirm the onboarding conversation list now ends at item 4 and the
  paragraph below it ("Save answers to `.sdlc-harness.json` ...") still reads coherently.

- [ ] **Step 3: Replace the TODO comment block**

  Find this block in `SKILL.md` (Phase 2):

  ```markdown
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
  ```

  Replace it with nothing — delete those lines entirely. The paragraph that follows already describes the delegation correctly and is the only text that needs to stay.

  The Phase 2 section should read:

  ```markdown
  ## Phase 2 — Work Item Templates (Task 19)

  The standard lives in the `work-item-format` MCP tool, not here. Tasks 20 and 21 call
  `get-template` at drafting time (see Phase 3), so the template is fetched per work-item
  type rather than duplicated in this file or in the agent code.
  ```

- [ ] **Step 4: Confirm the file reads correctly**

  Open `SKILL.md` and visually confirm Phase 2 no longer contains the comment block and the surrounding text is coherent.

- [ ] **Step 5: Commit**

  ```
  git add bob-kit/skills/sdlc-harness/SKILL.md
  git commit -m "docs(task-18,19): remove dead onboarding question 5 and Phase 2 TODO placeholder"
  ```

---

## Task 6 — Final validation and mark tasks done

- [ ] **Step 1: Run the skill package's test suite**

  ```
  npm test
  ```
  (from `bob-kit/skills/sdlc-harness/`)

  Expected: all 65 tests pass (61 original + 4 onboarding tests from Task 3).

- [ ] **Step 2: Run the mcp-server template contract test**

  ```
  npm run build
  npm run test:templates
  ```
  (from `bob-kit/mcp-server/`)

  Expected: exits 0; last line printed is `work-item-format.test.ts: all assertions passed`. This is a
  separate Node process, not part of the skill package's Jest run — the two packages have independent
  test runners and neither total rolls into the other.

- [ ] **Step 3: Run typecheck**

  ```
  npm run typecheck
  ```
  (from `bob-kit/skills/sdlc-harness/`, then again from `bob-kit/mcp-server/`)

  Expected: exits 0 with no errors in both packages.

- [ ] **Step 4: Update `to-do.md`**

  `to-do.md` marks a completed item by replacing its status prefix with `done -`, matching item 17's
  existing format (`done - 17. **Skill scaffold** ...`). Items 18 and 19 currently carry a
  `mat in progress -` prefix. Apply this exact replacement:

  ```diff
  -mat in progress - 18. **Onboarding conversation flow** `[P0]` — define the guided conversation steps that collect project management tool type (GitLab Issues for the demo), project URL, work item types, workflow states, **and transition rules**; document the expected input/output for each step.
  -mat in progress - 19. **Work item template baseline** `[P0]` — author industry best-practice templates (User Story, Bug, Task, Epic) as structured prompts the skill applies when creating or reviewing work items.
  +done - 18. **Onboarding conversation flow** `[P0]` — define the guided conversation steps that collect project management tool type (GitLab Issues for the demo), project URL, work item types, workflow states, **and transition rules**; document the expected input/output for each step.
  +done - 19. **Work item template baseline** `[P0]` — author industry best-practice templates (User Story, Bug, Task, Epic) as structured prompts the skill applies when creating or reviewing work items.
  ```

  Only the status prefix changes — the rest of each line is untouched.

- [ ] **Step 5: Final commit**

  ```
  git add to-do.md
  git commit -m "chore: mark tasks 18 and 19 done"
  ```

- [ ] **Step 6: Re-install reminder (manual, not scripted)**

  Per `AGENTS.md`, `bob-kit/` is templates only — editing `bob-kit/skills/sdlc-harness/SKILL.md` and its
  `src/` here does not change anything a live Bob install is actually running. Tell whoever owns the
  local install to re-run:
  ```
  cp -r bob-kit/skills/sdlc-harness ~/.bob/skills/
  ```
  so the Phase 1/Phase 2 SKILL.md edits and the `onboard.ts` changes take effect.

---

## Self-Review

### Spec coverage

| Requirement | Task |
|---|---|
| Onboarding conversation flow — input/output for each step documented | Already in SKILL.md Phase 1; dead question 5 (no effect on saved config) removed in Task 5 |
| Onboarding persists `ProjectConfig` to `.sdlc-harness.json` | Caller responsibility (documented in `onboard.ts` JSDoc); no code change needed |
| Optional `coverage` field accepted by onboarding | Task 1 + Task 2 |
| `workItemTypes` validation rejects blank entries | Task 2 |
| Transition-rule target-state error path tested | Task 3 |
| Work item templates defined for User Story, Bug, Task, Epic, Feature | Already in `work-item-format.ts`; Task 4 adds a real `node:assert` test that calls the tool directly and proves the contract (not a proxy test against an unrelated module) |
| SKILL.md TODO comment removed | Task 5 |
| SKILL.md dead onboarding question removed | Task 5 |

### No placeholders — confirmed

All steps include exact code, exact commands, and exact expected output.

### Type consistency

- `CoverageConfig` is imported from `'../models'` in `onboard.ts` — matches the definition in `models.ts`.
- `OnboardInput.coverage` is typed as `CoverageConfig | undefined` — matches `ProjectConfig.coverage?: CoverageConfig`.
- No new exports added to `index.ts` are needed; `onboard` and `OnboardInput` are already exported.
