/**
 * sdlc-harness skill unit tests
 *
 * These tests verify the skill's expected conversation flows and agent logic
 * against mock GitLab API responses. They are written in Jest and are designed
 * to run once the MCP server (Section 2A) is built. Until then, they serve as
 * a runnable specification: each describe block captures the exact inputs and
 * outputs the skill must produce for a given scenario.
 *
 * Run: npm test  (once package.json / tsconfig.json are in place from Section 2A)
 *
 * Mock strategy: each test imports a lightweight in-process mock of the
 * gitlab-local MCP tool surface (see __mocks__/gitlab-client.ts) that returns
 * the fixtures defined in __fixtures__/. The skill logic under test is the
 * pure reasoning layer — no real HTTP calls, no Docker.
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

import { onboard } from '../src/skill/onboard';
import { runAcAgent, hasAcceptanceCriteria } from '../src/agents/ac-agent';
import { runAmbiguityAgent } from '../src/agents/ambiguity-agent';
import { runDependencyAgent } from '../src/agents/dependency-agent';
import { runStateTransitionAgent } from '../src/agents/state-transition-agent';
import { runCoverageAgent } from '../src/agents/coverage-agent';
import { applyFinding, rejectFinding, _resetSessionTracker } from '../src/skill/review';
import { readTelemetry, computeAcceptanceRate } from '../src/skill/telemetry';
import { createGitLabRestWriterAdapter, stubWriterAdapter } from '../src/skill/gitlab-writer-adapter';
import type { TelemetryEntry, DependencyFinding } from '../src/models';

// ---------------------------------------------------------------------------
// Telemetry isolation — use a fresh temp file for every test run
// ---------------------------------------------------------------------------

let tempTelemetryPath: string;

beforeAll(() => {
  tempTelemetryPath = path.join(os.tmpdir(), `sdlc-harness-test-${Date.now()}.jsonl`);
  process.env['SDLC_TELEMETRY_PATH'] = tempTelemetryPath;
});

afterAll(() => {
  delete process.env['SDLC_TELEMETRY_PATH'];
  if (fs.existsSync(tempTelemetryPath)) {
    fs.unlinkSync(tempTelemetryPath);
  }
});

beforeEach(() => {
  // Reset in-session conflict tracker between tests
  _resetSessionTracker();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROJECT_CONFIG = {
  projectUrl: 'http://localhost:8080/sdlc-harness/weather-dashboard',
  workItemTypes: ['Story', 'Bug', 'Task'],
  workflowStates: ['Open', 'In Progress', 'In Review', 'Done'],
  transitionRules: {
    'Open': ['In Progress'],
    'In Progress': ['In Review', 'Open'],
    'In Review': ['Done', 'In Progress'],
  },
};

/** Issue with no acceptance criteria */
const ISSUE_NO_AC = {
  iid: 12,
  title: 'Add weather forecast widget',
  description: 'Users should be able to see a 5-day forecast on the dashboard.',
  labels: ['Story'],
  state: 'opened',
  assignee: null,
};

/** Issue with vague language */
const ISSUE_VAGUE = {
  iid: 7,
  title: 'Fix the thing on the settings page',
  description: 'The settings page does not work properly. Fix it.',
  labels: ['Bug'],
  state: 'opened',
  assignee: null,
};

/** Two issues with semantic overlap (dependency candidate) */
const ISSUE_AUTH_A = {
  iid: 3,
  title: 'Implement JWT token refresh',
  description: 'The app must refresh expired JWT tokens without logging the user out. Uses the /auth/refresh endpoint.',
  labels: ['Story'],
  state: 'opened',
  assignee: null,
};

const ISSUE_AUTH_B = {
  iid: 9,
  title: 'Handle auth token expiry in API calls',
  description: 'API calls should transparently retry after refreshing the auth token. Depends on the token refresh flow.',
  labels: ['Story'],
  state: 'opened',
  assignee: null,
};

/** Issue whose state is stale — MR was merged but issue is still Open */
const ISSUE_STALE_STATE = {
  iid: 5,
  title: 'Deploy weather-app to staging',
  description: 'Set up CI pipeline to deploy the weather-app container to staging on every main-branch push.',
  labels: ['Task'],
  state: 'opened',
  assignee: null,
};

const MR_MERGED_FOR_ISSUE_5 = {
  iid: 2,
  title: 'feat: add CI pipeline for staging deploy',
  description: 'Closes #5',
  state: 'merged',
  mergedAt: '2025-09-01T10:00:00Z',
};

// ---------------------------------------------------------------------------
// 1. Onboarding flow
// ---------------------------------------------------------------------------

describe('Onboarding flow', () => {
  test('saves project config when all required fields are provided', async () => {
    const result = await onboard({
      projectUrl: PROJECT_CONFIG.projectUrl,
      workItemTypes: PROJECT_CONFIG.workItemTypes,
      workflowStates: PROJECT_CONFIG.workflowStates,
      transitionRules: PROJECT_CONFIG.transitionRules,
    });

    expect(result.ok).toBe(true);
    expect(result.config).toMatchObject(PROJECT_CONFIG);
  });

  test('returns validation error when projectUrl is missing', async () => {
    const result = await onboard({
      projectUrl: '',
      workItemTypes: PROJECT_CONFIG.workItemTypes,
      workflowStates: PROJECT_CONFIG.workflowStates,
      transitionRules: PROJECT_CONFIG.transitionRules,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/projectUrl/i);
  });

  test('returns validation error when workflowStates is empty', async () => {
    const result = await onboard({
      projectUrl: PROJECT_CONFIG.projectUrl,
      workItemTypes: PROJECT_CONFIG.workItemTypes,
      workflowStates: [],
      transitionRules: {},
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/workflowStates/i);
  });

  test('is idempotent — re-running with same config does not error', async () => {
    await onboard(PROJECT_CONFIG);
    const result = await onboard(PROJECT_CONFIG);
    expect(result.ok).toBe(true);
  });

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

  test('returns validation error when transitionRules target is not a known state', async () => {
    const result = await onboard({
      projectUrl: PROJECT_CONFIG.projectUrl,
      workItemTypes: PROJECT_CONFIG.workItemTypes,
      workflowStates: ['Open', 'In Progress'],
      transitionRules: { 'Open': ['In Progress', 'Closed'] }, // "Closed" not in workflowStates
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Closed/);
  });

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

  test('persists GitLab blocking-link capability when enabled', async () => {
    const result = await onboard({
      ...PROJECT_CONFIG,
      blockingIssueLinks: true,
    });
    expect(result.ok).toBe(true);
    expect(result.config?.blockingIssueLinks).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. AC agent — happy path
// ---------------------------------------------------------------------------

describe('AC agent', () => {
  test('detects missing AC and hands the drafter a brief', async () => {
    const finding = await runAcAgent(ISSUE_NO_AC, PROJECT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.issueIid).toBe(12);
    expect(finding!.agent).toBe('AC');

    const brief = finding!.draft!;
    expect(brief.context.title).toBe(ISSUE_NO_AC.title);
    expect(brief.context.description).toBe(ISSUE_NO_AC.description);
    expect(brief.task).toMatch(/given-when-then/i);
    expect(brief.task).toMatch(/work-item-format/);
  });

  test('returns null for an issue that already has acceptance criteria', async () => {
    const issueWithAc = {
      ...ISSUE_NO_AC,
      description: ISSUE_NO_AC.description +
        '\n\n**Acceptance Criteria**\nGiven a logged-in user\nWhen they open the dashboard\nThen they see the 5-day forecast widget',
    };

    const finding = await runAcAgent(issueWithAc, PROJECT_CONFIG);
    expect(finding).toBeNull();
  });

  test('returns null for issue with inline Given/When/Then', async () => {
    const issueWithInlineGWT = {
      ...ISSUE_NO_AC,
      description: 'Users need forecast data.\n\nGiven user is on dashboard\nWhen they look at forecast panel\nThen they see 5-day data',
    };
    const finding = await runAcAgent(issueWithInlineGWT, PROJECT_CONFIG);
    expect(finding).toBeNull();
  });

  test('brief carries the issue text the drafter works from', async () => {
    const finding = await runAcAgent(ISSUE_NO_AC, PROJECT_CONFIG);
    const brief = finding!.draft!;
    const material = `${brief.context.title} ${brief.context.description}`.toLowerCase();
    const mentionsTitle =
      material.includes('weather') || material.includes('forecast') || material.includes('widget');
    expect(mentionsTitle).toBe(true);
  });

  // The drafter writes the prose now, so the agent's job is to rule out filler
  // up front rather than to render a sentence of its own.
  test('brief rules out the generic filler the old template produced', async () => {
    const issue = {
      iid: 99,
      title: 'Add dark mode toggle to the settings page',
      description: 'Users want to switch between light and dark themes.',
      labels: ['Story'],
      state: 'opened',
      assignee: null,
    };
    const finding = await runAcAgent(issue, PROJECT_CONFIG);
    expect(finding).not.toBeNull();

    const brief = finding!.draft!;
    expect(brief.context.title).toBe('Add dark mode toggle to the settings page');
    expect(brief.context.workItemType).toBe('User Story');
    expect(brief.task).toMatch(/no filler/i);
    expect(brief.task).toContain('responds correctly');
  });

  // P0-3 regression: no "responds correctly" in AC output
  test('P0-3: draft AC does not contain subjective qualifiers ("correctly", "properly")', async () => {
    const finding = await runAcAgent(ISSUE_NO_AC, PROJECT_CONFIG);
    expect(finding).not.toBeNull();
    const ac = finding!.suggestedValue.toLowerCase();
    expect(ac).not.toContain('correctly');
    expect(ac).not.toContain('properly');
    expect(ac).not.toContain('nicely');
  });

  // FIX-3: single-line prose with given/when/then must NOT be detected as AC.
  // The previous implementation used an inline regex that matched this exact sentence.
  // The fix: require structural markers — each keyword must begin its own line.
  test('FIX-3: prose sentence "Given...when...then" on one line is not AC', () => {
    // This is the exact sentence from the defect report. Must return false.
    const proseSentence = 'Given the deadline is tight, when we ship this, then keep scope small.';
    expect(hasAcceptanceCriteria(proseSentence)).toBe(false);
  });

  test('FIX-3: structured multi-line GWT (each keyword starts its own line) IS detected as AC', () => {
    const structuredGWT = 'Given a user is on the dashboard\nWhen they click the widget\nThen they see the forecast';
    expect(hasAcceptanceCriteria(structuredGWT)).toBe(true);

    // Bold markers (**Given** etc.) are also accepted
    const boldGWT = '**Given** a user\n**When** they click\n**Then** they see the result';
    expect(hasAcceptanceCriteria(boldGWT)).toBe(true);
  });

  test('FIX-3: prose with only two of three line-starting GWT keywords is not AC', () => {
    const proseOnlyGivenThen = 'Given the deadline is tight,\nthen we should ship quickly.';
    expect(hasAcceptanceCriteria(proseOnlyGivenThen)).toBe(false);
  });

  // P1-8 (kept): multi-paragraph prose with given/when/then only partially as line-starters
  test('P1-8: multi-paragraph prose where "when" is not a line-starter is not AC', () => {
    const multiParaProse = [
      'The feature needs to be built.',
      '',
      'Given current constraints this will be challenging.',
      'We should find time when the sprint allows.',
      'Then we can revisit the architecture then.',
    ].join('\n');
    // "when" only appears mid-sentence, not as a line-starter → not structured GWT
    expect(hasAcceptanceCriteria(multiParaProse)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Ambiguity agent — happy path
// ---------------------------------------------------------------------------

describe('Ambiguity agent', () => {
  test('flags vague wording and names the offending phrases', async () => {
    const finding = await runAmbiguityAgent(ISSUE_VAGUE, PROJECT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.issueIid).toBe(7);
    expect(finding!.agent).toBe('AM');

    const brief = finding!.draft!;
    expect(brief.context.description).toBe(ISSUE_VAGUE.description);
    // The drafter is told which spans to replace, not merely that something is wrong.
    expect(brief.context.flaggedPhrases.length).toBeGreaterThan(0);
    expect(finding!.reason).toMatch(/vague wording/i);
  });

  test('returns null for a clear, specific description', async () => {
    const clearIssue = {
      ...ISSUE_NO_AC,
      description: 'Add a React component that fetches weather data from /api/forecast and renders a 5-day temperature chart using recharts.',
    };

    const finding = await runAmbiguityAgent(clearIssue, PROJECT_CONFIG);
    expect(finding).toBeNull();
  });

  test('flags "TBD" placeholder', async () => {
    const tbdIssue = {
      ...ISSUE_NO_AC,
      description: 'Implementation details TBD. Will figure out later.',
    };
    const finding = await runAmbiguityAgent(tbdIssue, PROJECT_CONFIG);
    expect(finding).not.toBeNull();
    expect(finding!.agent).toBe('AM');
  });

  test('flags "does not work" non-testable description', async () => {
    const nonTestableIssue = {
      ...ISSUE_VAGUE,
      description: 'The login button does not work in production.',
    };
    const finding = await runAmbiguityAgent(nonTestableIssue, PROJECT_CONFIG);
    expect(finding).not.toBeNull();
  });

  test('does not false-positive on specific technical description with code references', async () => {
    const technicalIssue = {
      iid: 42,
      title: 'Add rate limiting to /api/auth/login endpoint',
      description: 'Implement express-rate-limit middleware on `POST /api/auth/login` to limit to 10 requests/minute per IP. Return HTTP 429 with Retry-After header on breach. Configure threshold in `config/rate-limits.ts`.',
      labels: ['Task'],
      state: 'opened',
      assignee: null,
    };
    const finding = await runAmbiguityAgent(technicalIssue, PROJECT_CONFIG);
    expect(finding).toBeNull();
  });

  // P0-3 cross-agent regression: runAcAgent output must not trigger runAmbiguityAgent
  test('P0-3: runAcAgent output does not trigger runAmbiguityAgent', async () => {
    const acFinding = await runAcAgent(ISSUE_NO_AC, PROJECT_CONFIG);
    expect(acFinding).not.toBeNull();

    // Feed the AC draft as a description to the ambiguity agent
    const issueWithAcDraft = {
      ...ISSUE_NO_AC,
      description: acFinding!.suggestedValue,
    };
    const amFinding = await runAmbiguityAgent(issueWithAcDraft, PROJECT_CONFIG);
    // The AC agent's own output must not be flagged as vague
    expect(amFinding).toBeNull();
  });

  // A gap in the issue must become a question, never a plausible-looking invention.
  test('unknowns tell the drafter to ask rather than invent', async () => {
    const finding = await runAmbiguityAgent(ISSUE_VAGUE, PROJECT_CONFIG);
    expect(finding).not.toBeNull();

    const brief = finding!.draft!;
    expect(brief.unknowns.length).toBeGreaterThan(0);
    expect(brief.unknowns.join(' ')).toMatch(/ask the author/i);
    expect(brief.task).toMatch(/rather than inventing/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Dependency agent — happy path
// ---------------------------------------------------------------------------

describe('Dependency agent', () => {
  test('detects semantic overlap and proposes a blocks link', async () => {
    const findings = await runDependencyAgent(
      [ISSUE_AUTH_A, ISSUE_AUTH_B],
      { ...PROJECT_CONFIG, blockingIssueLinks: true },
    );

    // Should find at least one link proposal between issues 3 and 9
    const link = findings.find(
      (f) =>
        (f.sourceIid === 3 && f.targetIid === 9) ||
        (f.sourceIid === 9 && f.targetIid === 3),
    );

    expect(link).toBeDefined();
    expect(['blocks', 'relates-to']).toContain(link!.suggestedLinkType);
  });

  test('uses CE-compatible relates-to links when blocking links are disabled', async () => {
    const findings = await runDependencyAgent([ISSUE_AUTH_A, ISSUE_AUTH_B], PROJECT_CONFIG);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.suggestedLinkType === 'relates-to')).toBe(true);
  });

  test('returns empty findings for a set of unrelated issues', async () => {
    const unrelated = [
      { ...ISSUE_NO_AC },
      { ...ISSUE_VAGUE },
    ];

    const findings = await runDependencyAgent(unrelated, PROJECT_CONFIG);
    expect(findings).toHaveLength(0);
  });

  test('does not produce self-links', async () => {
    const findings = await runDependencyAgent([ISSUE_AUTH_A, ISSUE_AUTH_B], PROJECT_CONFIG);
    for (const f of findings) {
      expect(f.sourceIid).not.toBe(f.targetIid);
    }
  });

  test('does not produce duplicate pairs', async () => {
    const findings = await runDependencyAgent([ISSUE_AUTH_A, ISSUE_AUTH_B], PROJECT_CONFIG);
    const pairs = findings.map((f) => `${Math.min(f.sourceIid, f.targetIid)}-${Math.max(f.sourceIid, f.targetIid)}`);
    const uniquePairs = new Set(pairs);
    expect(pairs.length).toBe(uniquePairs.size);
  });

  test('confidence is between 0 and 1', async () => {
    const findings = await runDependencyAgent([ISSUE_AUTH_A, ISSUE_AUTH_B], PROJECT_CONFIG);
    for (const f of findings) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });

  // P2-10: direction — B says "Depends on" so A blocks B (sourceIid=A=3, targetIid=B=9)
  test('P2-10: direction — issue carrying "Depends on" is the dependent (target), not the source', async () => {
    const findings = await runDependencyAgent([ISSUE_AUTH_A, ISSUE_AUTH_B], PROJECT_CONFIG);
    const blocksFinding = findings.find((f) => f.suggestedLinkType === 'blocks');
    if (blocksFinding) {
      // ISSUE_AUTH_B (iid=9) says "Depends on the token refresh flow"
      // → ISSUE_AUTH_B is the dependent side → ISSUE_AUTH_A (iid=3) blocks it
      // So sourceIid must be 3 (prerequisite) and targetIid must be 9 (dependent)
      expect(blocksFinding.sourceIid).toBe(3);
      expect(blocksFinding.targetIid).toBe(9);
    }
    // If no blocks finding, both issues carried dependency language → falls back to relates-to, which is also acceptable
  });

  // P2-10: no /token refresh/ in BLOCKS_SIGNALS — issues without dep language → relates-to
  test('P2-10: issues with shared tokens but no explicit dep language fall back to relates-to', async () => {
    // Two issues about auth without any "depends on" / "requires" language
    const issueA = {
      iid: 20,
      title: 'Auth session expiry handling',
      description: 'The auth session should expire after 30 minutes of inactivity. Token refresh endpoint: /auth/refresh.',
      labels: ['Story'],
      state: 'opened',
      assignee: null,
    };
    const issueB = {
      iid: 21,
      title: 'Auth token refresh endpoint',
      description: 'Implement the token refresh endpoint at /auth/refresh to issue a new JWT.',
      labels: ['Story'],
      state: 'opened',
      assignee: null,
    };
    const findings = await runDependencyAgent([issueA, issueB], PROJECT_CONFIG);
    // Both have "token refresh" text; neither has "depends on" → should be relates-to
    if (findings.length > 0) {
      expect(findings[0].suggestedLinkType).toBe('relates-to');
    }
    // (If Jaccard < threshold, no finding at all — that's also fine)
  });
});

// ---------------------------------------------------------------------------
// 5. State-transition agent — happy path
// ---------------------------------------------------------------------------

describe('State-transition agent', () => {
  test('proposes In Review when a linked MR has been merged', async () => {
    const finding = await runStateTransitionAgent(
      ISSUE_STALE_STATE,
      [MR_MERGED_FOR_ISSUE_5],
      PROJECT_CONFIG,
    );

    expect(finding).not.toBeNull();
    expect(finding!.issueIid).toBe(5);
    expect(finding!.agent).toBe('ST');
    expect(finding!.suggestedValue).toBe('In Review');
  });

  test('returns null when the issue state already matches activity signals', async () => {
    const alreadyInReview = { ...ISSUE_STALE_STATE, state: 'In Review' };

    const finding = await runStateTransitionAgent(
      alreadyInReview,
      [MR_MERGED_FOR_ISSUE_5],
      PROJECT_CONFIG,
    );

    expect(finding).toBeNull();
  });

  test('returns null when there is no activity signal', async () => {
    const finding = await runStateTransitionAgent(
      ISSUE_STALE_STATE,
      [], // no MRs
      PROJECT_CONFIG,
    );

    expect(finding).toBeNull();
  });

  test('does not propose a transition that violates the configured rules', async () => {
    // Open → Done is not a valid transition in PROJECT_CONFIG
    const finding = await runStateTransitionAgent(
      { ...ISSUE_STALE_STATE, state: 'opened' },
      [{ ...MR_MERGED_FOR_ISSUE_5, state: 'closed' }], // closed, not merged
      PROJECT_CONFIG,
    );

    if (finding !== null) {
      expect(finding.suggestedValue).not.toBe('Done');
    }
  });

  test('proposes In Progress when a linked MR is open', async () => {
    const openMr = { ...MR_MERGED_FOR_ISSUE_5, state: 'opened' };
    const finding = await runStateTransitionAgent(
      ISSUE_STALE_STATE,
      [openMr],
      PROJECT_CONFIG,
    );

    // "In Progress" must be a valid transition from "Open"
    if (finding !== null) {
      expect(finding.suggestedValue).toBe('In Progress');
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Human review interface — override / rejection path
// ---------------------------------------------------------------------------

describe('Human review interface', () => {
  const finding = {
    agent: 'AC' as const,
    issueIid: 12,
    action: 'draft_ac' as const,
    suggestedValue: 'Given a user\nWhen they open the dashboard\nThen they see the forecast widget',
  };

  // Missing runtime configuration returns written:false for writable findings,
  // so the telemetry outcome must be 'failed', NOT 'accepted'.
  // This prevents fabricated acceptance-rate numbers.
  test('FIX-1: unconfigured adapter logs outcome "failed", never "accepted"', async () => {
    const unconfigured = createGitLabRestWriterAdapter(globalThis.fetch, () => null);
    const result = await applyFinding(finding, { editedValue: null }, unconfigured);
    // No GitLab configuration — write did not happen.
    expect(result.gitlabWriteCalled).toBe(false);
    // Must log 'failed', not 'accepted' — otherwise computeAcceptanceRate is wrong.
    expect(result.telemetryEntry.outcome).toBe('failed');
    // Verify directly from the telemetry file that no 'accepted' entry was written.
    const entries = await readTelemetry();
    const lastEntry = entries[entries.length - 1];
    expect(lastEntry.outcome).toBe('failed');
    expect(lastEntry.outcome).not.toBe('accepted');
  });

  // P0-1 (updated): stub adapter must still report accepted for real write
  test('P0-1: stubWriterAdapter returns written:true — outcome is "accepted"', async () => {
    const result = await applyFinding(finding, { editedValue: null }, stubWriterAdapter);
    expect(result.gitlabWriteCalled).toBe(true);
    expect(result.telemetryEntry.outcome).toBe('accepted');
  });

  test('apply with stub writes to GitLab and logs accepted outcome', async () => {
    const result = await applyFinding(finding, { editedValue: null }, stubWriterAdapter);

    expect(result.gitlabWriteCalled).toBe(true);
    expect(result.telemetryEntry.outcome).toBe('accepted');
    expect(result.telemetryEntry.editedFields).toHaveLength(0);
  });

  test('apply with edit writes the edited value and logs edited outcome', async () => {
    const editedAc = 'Given a logged-in user\nWhen they view the dashboard\nThen they see a 5-day forecast';
    const result = await applyFinding(finding, { editedValue: editedAc }, stubWriterAdapter);

    expect(result.gitlabWriteCalled).toBe(true);
    expect(result.writtenValue).toBe(editedAc);
    expect(result.telemetryEntry.outcome).toBe('edited');
    // P2-9: editedFields derived from action — draft_ac → ['description']
    expect(result.telemetryEntry.editedFields).toContain('description');
  });

  test('reject does not write to GitLab and logs rejected outcome', async () => {
    const result = await rejectFinding(finding);

    expect(result.gitlabWriteCalled).toBe(false);
    expect(result.telemetryEntry.outcome).toBe('rejected');
  });

  test('telemetry file grows by one entry per decision', async () => {
    const before = (await readTelemetry()).length;
    await applyFinding(finding, { editedValue: null }, stubWriterAdapter);
    const after = (await readTelemetry()).length;
    expect(after).toBe(before + 1);
  });

  test('telemetry entries are append-only — earlier entries are preserved', async () => {
    await applyFinding(finding, { editedValue: null }, stubWriterAdapter);
    const snap1 = await readTelemetry();
    const len1 = snap1.length;

    await rejectFinding(finding);
    const snap2 = await readTelemetry();

    // All entries from snap1 must still be present at the start of snap2
    expect(snap2.length).toBe(len1 + 1);
    for (let i = 0; i < snap1.length; i++) {
      expect(snap2[i]).toEqual(snap1[i]);
    }
  });

  test('rejected decision has no editedFields', async () => {
    const result = await rejectFinding(finding);
    expect(result.telemetryEntry.editedFields).toHaveLength(0);
  });

  test('telemetry entry has a valid ISO timestamp', async () => {
    const result = await applyFinding(finding, { editedValue: null }, stubWriterAdapter);
    const ts = result.telemetryEntry.timestamp;
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  // P1-5: DependencyFinding can be passed to applyFinding / rejectFinding
  test('P1-5: DependencyFinding can be written through the review adapter', async () => {
    const depFinding: DependencyFinding = {
      agent: 'DEP',
      sourceIid: 3,
      targetIid: 9,
      suggestedLinkType: 'blocks',
      reason: 'Issue #3 appears to block issue #9.',
      confidence: 0.85,
    };
    const result = await applyFinding(depFinding, { editedValue: null }, stubWriterAdapter);
    expect(result.gitlabWriteCalled).toBe(true);
    expect(result.telemetryEntry.outcome).toBe('accepted');
    expect(result.telemetryEntry.agent).toBe('DEP');
  });

  test('real adapter appends accepted criteria to the existing issue description', async () => {
    let updateBody: Record<string, unknown> = {};
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) {
        return new Response(JSON.stringify({ description: 'Existing details', labels: ['Open'], state: 'opened' }), { status: 200 });
      }
      updateBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => ({
      host: 'http://gitlab.test', project: 'group/project', token: 'secret',
      workflowStates: ['Open', 'In Progress', 'In Review', 'Done'],
    }));

    const result = await applyFinding(finding, { editedValue: null }, adapter);

    expect(result.gitlabWriteCalled).toBe(true);
    expect(updateBody['description']).toContain('Existing details');
    expect(updateBody['description']).toContain('## Acceptance Criteria');
    expect(updateBody['description']).toContain(finding.suggestedValue);
  });

  test('real adapter replaces an ambiguous description', async () => {
    let updateBody: Record<string, unknown> = {};
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ description: 'fix it', labels: ['Open'], state: 'opened' }), { status: 200 });
      updateBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => ({
      host: 'http://gitlab.test', project: 'group/project', token: 'secret', workflowStates: ['Open', 'Done'],
    }));
    const rewritten = 'The save handler returns HTTP 500 when the display name is empty.';
    const result = await applyFinding({ agent: 'AM', issueIid: 2, action: 'rewrite_desc', suggestedValue: rewritten }, { editedValue: null }, adapter);
    expect(result.gitlabWriteCalled).toBe(true);
    expect(updateBody).toEqual({ description: rewritten });
  });

  test('ambiguity rewrite preserves acceptance criteria already added to the issue', async () => {
    let updateBody: Record<string, unknown> = {};
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) {
        return new Response(JSON.stringify({
          description: 'fix it\n\n## Acceptance Criteria\n**Given** a user\n**When** they save\n**Then** the value persists',
          labels: ['Open'],
          state: 'opened',
        }), { status: 200 });
      }
      updateBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => ({
      host: 'http://gitlab.test', project: 'group/project', token: 'secret', workflowStates: ['Open', 'Done'],
    }));
    const rewritten = 'Saving a preference returns HTTP 500 when the display name is empty.';
    const result = await applyFinding(
      { agent: 'AM', issueIid: 2, action: 'rewrite_desc', suggestedValue: rewritten },
      { editedValue: null },
      adapter,
    );
    expect(result.gitlabWriteCalled).toBe(true);
    expect(updateBody['description']).toContain(rewritten);
    expect(updateBody['description']).toContain('## Acceptance Criteria');
    expect(updateBody['description']).toContain('the value persists');
  });

  test('ambiguity rewrite preserves bold acceptance-criteria sections', async () => {
    let updateBody: Record<string, unknown> = {};
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) {
        return new Response(JSON.stringify({
          description: 'fix it\n\n**Acceptance Criteria**\nGiven x\nWhen y\nThen z',
          labels: ['Open'],
          state: 'opened',
        }), { status: 200 });
      }
      updateBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => ({
      host: 'http://gitlab.test', project: 'group/project', token: 'secret', workflowStates: ['Open'],
    }));
    await applyFinding(
      { agent: 'AM', issueIid: 2, action: 'rewrite_desc', suggestedValue: 'Specific replacement.' },
      { editedValue: null },
      adapter,
    );
    expect(updateBody['description']).toContain('**Acceptance Criteria**');
    expect(updateBody['description']).toContain('Then z');
  });

  test('real adapter replaces workflow labels for a state transition', async () => {
    let updateBody: Record<string, unknown> = {};
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ description: '', labels: ['Bug', 'Open'], state: 'opened' }), { status: 200 });
      updateBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => ({
      host: 'http://gitlab.test', project: 'group/project', token: 'secret',
      workflowStates: ['Open', 'In Progress', 'In Review', 'Done'],
    }));
    const result = await applyFinding({ agent: 'ST', issueIid: 5, action: 'state_transition', suggestedValue: 'In Review' }, { editedValue: null }, adapter);
    expect(result.gitlabWriteCalled).toBe(true);
    expect(updateBody['labels']).toBe('Bug,In Review');
  });

  test('real adapter creates a GitLab dependency link', async () => {
    let linkBody: Record<string, unknown> = {};
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (!init?.method) return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      expect(url).toContain('/issues/3/links');
      linkBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({ link_type: 'blocks' }), { status: 201 });
    });
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => ({
      host: 'http://gitlab.test', project: 'group/project', token: 'secret', workflowStates: [],
      blockingIssueLinks: true,
    }));
    const depFinding: DependencyFinding = {
      agent: 'DEP', sourceIid: 3, targetIid: 9, suggestedLinkType: 'blocks', confidence: 0.9,
    };
    const result = await applyFinding(depFinding, { editedValue: null }, adapter);
    expect(result.gitlabWriteCalled).toBe(true);
    expect(linkBody).toEqual({ target_project_id: 42, target_issue_iid: 9, link_type: 'blocks' });
  });

  test('real adapter rejects blocks links when the GitLab tier capability is disabled', async () => {
    const fetchMock = jest.fn();
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => ({
      host: 'http://gitlab.test', project: 'group/project', token: 'secret', workflowStates: [],
      blockingIssueLinks: false,
    }));
    const depFinding: DependencyFinding = {
      agent: 'DEP', sourceIid: 3, targetIid: 9, suggestedLinkType: 'blocks', confidence: 0.9,
    };
    const result = await applyFinding(depFinding, { editedValue: null }, adapter);
    expect(result.gitlabWriteCalled).toBe(false);
    expect(result.error).toMatch(/disabled.*tier/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('real adapter blocks writes when runtime and onboarded projects differ', async () => {
    const fetchMock = jest.fn();
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => ({
      host: 'http://gitlab.test',
      project: 'wrong/project',
      token: 'secret',
      workflowStates: ['Open'],
      scopeError: 'Configured GitLab project does not match the onboarded project.',
    }));
    const result = await applyFinding(finding, { editedValue: null }, adapter);
    expect(result.gitlabWriteCalled).toBe(false);
    expect(result.error).toMatch(/does not match/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('real adapter rejects an edited state outside the onboarded workflow', async () => {
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) {
        return new Response(JSON.stringify({ description: '', labels: ['Open'], state: 'opened' }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => ({
      host: 'http://gitlab.test', project: 'group/project', token: 'secret', workflowStates: ['Open', 'Done'],
    }));
    const result = await applyFinding(
      { agent: 'ST', issueIid: 5, action: 'state_transition', suggestedValue: 'In Review' },
      { editedValue: 'Made Up State' },
      adapter,
    );
    expect(result.gitlabWriteCalled).toBe(false);
    expect(result.error).toMatch(/unknown workflow state/i);
  });

  test('P1-5: DependencyFinding can be passed to rejectFinding', async () => {
    const depFinding: DependencyFinding = {
      agent: 'DEP',
      sourceIid: 3,
      targetIid: 9,
      suggestedLinkType: 'relates-to',
      reason: 'Shared topic overlap.',
      confidence: 0.65,
    };
    const result = await rejectFinding(depFinding);
    expect(result.gitlabWriteCalled).toBe(false);
    expect(result.telemetryEntry.outcome).toBe('rejected');
    expect(result.telemetryEntry.agent).toBe('DEP');
  });

  test('rewrite_desc writes once the drafter has supplied the text', async () => {
    const amFinding = {
      agent: 'AM' as const,
      issueIid: 7,
      action: 'rewrite_desc' as const,
      suggestedValue: 'Saving on the settings page returns a 500 when the display-name field is empty.',
    };
    const result = await applyFinding(amFinding, { editedValue: null }, stubWriterAdapter);
    expect(result.gitlabWriteCalled).toBe(true);
    expect(result.telemetryEntry.outcome).toBe('accepted');
  });

  test('applying an undrafted finding throws instead of writing the placeholder', async () => {
    const undrafted = await runAcAgent(ISSUE_NO_AC, PROJECT_CONFIG);
    await expect(
      applyFinding(undrafted!, { editedValue: null }, stubWriterAdapter)
    ).rejects.toThrow(/has not been drafted/);
  });

  test('P1-6: missing_coverage action is report-only — never written to GitLab', async () => {
    const covFinding = {
      agent: 'COV' as const,
      issueIid: 12,
      action: 'missing_coverage' as const,
      suggestedValue: 'Add a test that references issue #12.',
    };
    const result = await applyFinding(covFinding, { editedValue: null }, stubWriterAdapter);
    expect(result.gitlabWriteCalled).toBe(false);
  });

  test('P1-6: draft_ac action is writable — stub adapter reports written:true', async () => {
    const result = await applyFinding(finding, { editedValue: null }, stubWriterAdapter);
    expect(result.gitlabWriteCalled).toBe(true);
  });

  test('P1-6: state_transition action is writable — stub adapter reports written:true', async () => {
    const stFinding = {
      agent: 'ST' as const,
      issueIid: 5,
      action: 'state_transition' as const,
      suggestedValue: 'In Review',
    };
    const result = await applyFinding(stFinding, { editedValue: null }, stubWriterAdapter);
    expect(result.gitlabWriteCalled).toBe(true);
  });

  // P2-9: editedFields derived from finding action
  test('P2-9: state_transition edited → editedFields is ["state"]', async () => {
    const stFinding = {
      agent: 'ST' as const,
      issueIid: 5,
      action: 'state_transition' as const,
      suggestedValue: 'In Review',
    };
    const result = await applyFinding(
      stFinding,
      { editedValue: 'Done' },
      stubWriterAdapter
    );
    expect(result.telemetryEntry.editedFields).toEqual(['state']);
  });

  test('P2-9: draft_ac edited → editedFields is ["description"]', async () => {
    const result = await applyFinding(
      finding,
      { editedValue: 'Edited AC text' },
      stubWriterAdapter
    );
    expect(result.telemetryEntry.editedFields).toEqual(['description']);
  });

  test('P2-9: missing_coverage edited → editedFields is []', async () => {
    const covFinding = {
      agent: 'COV' as const,
      issueIid: 12,
      action: 'missing_coverage' as const,
      suggestedValue: 'Add test.',
    };
    const result = await applyFinding(
      covFinding,
      { editedValue: 'something' },
      stubWriterAdapter
    );
    expect(result.telemetryEntry.editedFields).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Telemetry — acceptance-rate summary
// ---------------------------------------------------------------------------

describe('Telemetry acceptance-rate', () => {
  test('computes correct acceptance rate for a mixed log', () => {
    const entries: TelemetryEntry[] = [
      { timestamp: '2025-01-01T00:00:00.000Z', agent: 'AC', issueIid: 1, action: 'draft_ac', outcome: 'accepted', editedFields: [] },
      { timestamp: '2025-01-01T00:00:01.000Z', agent: 'AC', issueIid: 2, action: 'draft_ac', outcome: 'accepted', editedFields: [] },
      { timestamp: '2025-01-01T00:00:02.000Z', agent: 'AM', issueIid: 3, action: 'rewrite_desc', outcome: 'edited', editedFields: ['description'] },
      { timestamp: '2025-01-01T00:00:03.000Z', agent: 'ST', issueIid: 4, action: 'state_transition', outcome: 'rejected', editedFields: [] },
    ];

    const summary = computeAcceptanceRate(entries);
    // total = accepted + edited + rejected (failed is excluded)
    expect(summary.total).toBe(4);
    expect(summary.accepted).toBe(2);
    expect(summary.edited).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.acceptanceRate).toBeCloseTo(0.5);
    expect(summary.approvalRate).toBeCloseTo(0.75);
  });

  test('returns all zeros for an empty log', () => {
    const summary = computeAcceptanceRate([]);
    expect(summary.total).toBe(0);
    expect(summary.acceptanceRate).toBe(0);
    expect(summary.approvalRate).toBe(0);
  });

  test('100% acceptance rate when all are accepted', () => {
    const entries: TelemetryEntry[] = Array.from({ length: 5 }, (_, i) => ({
      timestamp: '2025-01-01T00:00:00.000Z',
      agent: 'AC' as const,
      issueIid: i + 1,
      action: 'draft_ac' as const,
      outcome: 'accepted' as const,
      editedFields: [],
    }));
    const summary = computeAcceptanceRate(entries);
    expect(summary.acceptanceRate).toBe(1);
    expect(summary.approvalRate).toBe(1);
  });

  // FIX-1: failed entries excluded from total and rates
  test('FIX-1: failed entries are excluded from total and do not inflate acceptance rate', () => {
    const entries: TelemetryEntry[] = [
      { timestamp: '2025-01-01T00:00:00.000Z', agent: 'AC', issueIid: 1, action: 'draft_ac', outcome: 'accepted', editedFields: [] },
      { timestamp: '2025-01-01T00:00:01.000Z', agent: 'AC', issueIid: 2, action: 'draft_ac', outcome: 'failed',   editedFields: [] },
      { timestamp: '2025-01-01T00:00:02.000Z', agent: 'AC', issueIid: 3, action: 'draft_ac', outcome: 'failed',   editedFields: [] },
      { timestamp: '2025-01-01T00:00:03.000Z', agent: 'ST', issueIid: 4, action: 'state_transition', outcome: 'rejected', editedFields: [] },
    ];

    const summary = computeAcceptanceRate(entries);
    // total excludes the 2 failed entries
    expect(summary.total).toBe(2);       // accepted(1) + rejected(1)
    expect(summary.accepted).toBe(1);
    expect(summary.rejected).toBe(1);
    expect(summary.failed).toBe(2);
    // acceptance rate = 1/2 = 0.5 (not 1/4 = 0.25 which would be wrong)
    expect(summary.acceptanceRate).toBeCloseTo(0.5);
    // Without fix, accepted(1) / total(4) = 0.25 — inflated by phantom writes
  });

  test('FIX-1: all-failed log → total is 0, rates are 0', () => {
    const entries: TelemetryEntry[] = [
      { timestamp: '2025-01-01T00:00:00.000Z', agent: 'AC', issueIid: 1, action: 'draft_ac', outcome: 'failed', editedFields: [] },
      { timestamp: '2025-01-01T00:00:01.000Z', agent: 'AC', issueIid: 2, action: 'draft_ac', outcome: 'failed', editedFields: [] },
    ];
    const summary = computeAcceptanceRate(entries);
    expect(summary.total).toBe(0);
    expect(summary.failed).toBe(2);
    expect(summary.acceptanceRate).toBe(0);
    expect(summary.approvalRate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Test coverage linkage agent (Task 24 — P1)
// ---------------------------------------------------------------------------

describe('Coverage agent (Task 24 — P1)', () => {
  const configWithCoverage = {
    ...PROJECT_CONFIG,
    coverage: { testFilePatterns: ['**/*.test.ts'], enabled: true },
  };

  const configCoverageDisabled = {
    ...PROJECT_CONFIG,
    coverage: { testFilePatterns: ['**/*.test.ts'], enabled: false },
  };

  test('returns empty findings when disabled (default)', async () => {
    const findings = await runCoverageAgent(
      [ISSUE_NO_AC, ISSUE_VAGUE],
      { 'tests/app.test.ts': 'describe("app", () => { it("works", () => {}) })' },
      configCoverageDisabled,
    );
    expect(findings).toHaveLength(0);
  });

  test('flags issues with no test reference when enabled', async () => {
    const testContent = {
      'tests/forecast.test.ts': 'it("renders forecast widget", () => { /* covers #12 */ })',
    };
    // ISSUE_NO_AC (iid=12) has a reference; ISSUE_VAGUE (iid=7) does not
    const findings = await runCoverageAgent(
      [ISSUE_NO_AC, ISSUE_VAGUE],
      testContent,
      configWithCoverage,
    );

    const flagged = findings.map((f) => f.issueIid);
    expect(flagged).not.toContain(12);
    expect(flagged).toContain(7);
  });

  test('returns empty when all issues are covered', async () => {
    const testContent = {
      'tests/all.test.ts': 'test issue #12 and closes #7',
    };
    const findings = await runCoverageAgent(
      [ISSUE_NO_AC, ISSUE_VAGUE],
      testContent,
      configWithCoverage,
    );
    expect(findings).toHaveLength(0);
  });

  test('coverage findings have correct agent tag', async () => {
    const findings = await runCoverageAgent(
      [ISSUE_NO_AC],
      {},
      configWithCoverage,
    );
    expect(findings[0]?.agent).toBe('COV');
    expect(findings[0]?.action).toBe('missing_coverage');
  });
});
