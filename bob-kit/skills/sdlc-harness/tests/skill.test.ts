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

import { onboard } from '../src/skill/onboard';
import { runAcAgent } from '../src/agents/ac-agent';
import { runAmbiguityAgent } from '../src/agents/ambiguity-agent';
import { runDependencyAgent } from '../src/agents/dependency-agent';
import { runStateTransitionAgent } from '../src/agents/state-transition-agent';
import { applyFinding, rejectFinding } from '../src/skill/review';
import { readTelemetry } from '../src/skill/telemetry';

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
});

// ---------------------------------------------------------------------------
// 2. AC agent — happy path
// ---------------------------------------------------------------------------

describe('AC agent', () => {
  test('detects missing AC and returns a Given-When-Then draft', async () => {
    const finding = await runAcAgent(ISSUE_NO_AC, PROJECT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.issueIid).toBe(12);
    expect(finding!.agent).toBe('AC');

    const ac = finding!.suggestedValue as string;
    expect(ac.toLowerCase()).toContain('given');
    expect(ac.toLowerCase()).toContain('when');
    expect(ac.toLowerCase()).toContain('then');
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
});

// ---------------------------------------------------------------------------
// 3. Ambiguity agent — happy path
// ---------------------------------------------------------------------------

describe('Ambiguity agent', () => {
  test('flags vague language and proposes a concrete rewrite', async () => {
    const finding = await runAmbiguityAgent(ISSUE_VAGUE, PROJECT_CONFIG);

    expect(finding).not.toBeNull();
    expect(finding!.issueIid).toBe(7);
    expect(finding!.agent).toBe('AM');

    const rewrite = finding!.suggestedValue as string;
    // The rewrite should name the specific component, not "the thing"
    expect(rewrite.toLowerCase()).not.toContain('the thing');
    // Must be more specific than the original
    expect(rewrite.length).toBeGreaterThan(ISSUE_VAGUE.description.length);
  });

  test('returns null for a clear, specific description', async () => {
    const clearIssue = {
      ...ISSUE_NO_AC,
      description: 'Add a React component that fetches weather data from /api/forecast and renders a 5-day temperature chart using recharts.',
    };

    const finding = await runAmbiguityAgent(clearIssue, PROJECT_CONFIG);
    expect(finding).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Dependency agent — happy path
// ---------------------------------------------------------------------------

describe('Dependency agent', () => {
  test('detects semantic overlap and proposes a blocks link', async () => {
    const findings = await runDependencyAgent([ISSUE_AUTH_A, ISSUE_AUTH_B], PROJECT_CONFIG);

    // Should find at least one link proposal between issues 3 and 9
    const link = findings.find(
      (f) =>
        (f.sourceIid === 3 && f.targetIid === 9) ||
        (f.sourceIid === 9 && f.targetIid === 3),
    );

    expect(link).toBeDefined();
    expect(['blocks', 'relates-to']).toContain(link!.suggestedLinkType);
  });

  test('returns empty findings for a set of unrelated issues', async () => {
    const unrelated = [
      { ...ISSUE_NO_AC },
      { ...ISSUE_VAGUE },
    ];

    const findings = await runDependencyAgent(unrelated, PROJECT_CONFIG);
    expect(findings).toHaveLength(0);
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
});

// ---------------------------------------------------------------------------
// 6. Human review interface — override / rejection path
// ---------------------------------------------------------------------------

describe('Human review interface', () => {
  const finding = {
    agent: 'AC' as const,
    issueIid: 12,
    action: 'draft_ac',
    suggestedValue: 'Given a user\nWhen they open the dashboard\nThen they see the forecast widget',
  };

  test('apply writes to GitLab and logs accepted outcome', async () => {
    const result = await applyFinding(finding, { editedValue: null });

    expect(result.gitlabWriteCalled).toBe(true);
    expect(result.telemetryEntry.outcome).toBe('accepted');
    expect(result.telemetryEntry.editedFields).toHaveLength(0);
  });

  test('apply with edit writes the edited value and logs edited outcome', async () => {
    const editedAc = 'Given a logged-in user\nWhen they view the dashboard\nThen they see a 5-day forecast';
    const result = await applyFinding(finding, { editedValue: editedAc });

    expect(result.gitlabWriteCalled).toBe(true);
    expect(result.writtenValue).toBe(editedAc);
    expect(result.telemetryEntry.outcome).toBe('edited');
    expect(result.telemetryEntry.editedFields).toContain('description');
  });

  test('reject does not write to GitLab and logs rejected outcome', async () => {
    const result = await rejectFinding(finding);

    expect(result.gitlabWriteCalled).toBe(false);
    expect(result.telemetryEntry.outcome).toBe('rejected');
  });

  test('telemetry file grows by one entry per decision', async () => {
    const before = (await readTelemetry()).length;
    await applyFinding(finding, { editedValue: null });
    const after = (await readTelemetry()).length;
    expect(after).toBe(before + 1);
  });
});
