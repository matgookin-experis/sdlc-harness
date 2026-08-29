import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hasAcceptanceCriteria } from '../src/agents/ac-agent';
import { runAmbiguityAgent } from '../src/agents/ambiguity-agent';
import { extractIssueRefs } from '../src/agents/coverage-agent';
import { runDependencyAgent } from '../src/agents/dependency-agent';
import { runStateTransitionAgent } from '../src/agents/state-transition-agent';
import type { IssueInput, ProjectConfig } from '../src/models';
import {
  isRelevantMergeRequest,
  referencesIssue,
  runAudit,
  scanConfiguredTestFiles,
} from '../src/skill/audit';
import { runCli } from '../src/skill/cli-controller';
import { createGitLabRestReaderAdapter } from '../src/skill/gitlab-reader-adapter';
import {
  assertProjectRelativeEndpoint,
  createGitLabRequest,
  fetchWithDeadline,
} from '../src/skill/gitlab-rest';
import type { FetchFn } from '../src/skill/gitlab-rest';
import type { GitLabRuntimeConfig } from '../src/skill/gitlab-runtime';
import { createGitLabRestWriterAdapter, stubWriterAdapter } from '../src/skill/gitlab-writer-adapter';
import { validateProjectConfig } from '../src/skill/onboard';
import { applyFinding, _resetSessionTracker } from '../src/skill/review';
import { parseDecisionPayload } from '../src/skill/review-payload';
import { resolveTelemetryPath } from '../src/skill/telemetry';

const ROOT = path.resolve(__dirname, '..');

const CONFIG: ProjectConfig = validateProjectConfig({
  projectUrl: 'https://gitlab.example.test/group/project',
  workItemTypes: ['Story', 'Bug', 'Task'],
  workflowStates: ['Open', 'In Progress', 'In Review', 'Done'],
  transitionRules: {
    Open: ['In Progress'],
    'In Progress': ['In Review'],
    'In Review': ['Done'],
    Done: [],
  },
}, false);

const ISSUE: IssueInput = {
  iid: 12,
  title: 'Save notification preferences',
  description: 'Return HTTP 409 when the supplied preferences version is stale.',
  labels: ['Bug', 'Open'],
  state: 'opened',
  assignee: null,
  updatedAt: '2026-08-28T10:00:00.000Z',
};

/** Build a deterministic runtime config for adapter tests. */
function runtime(root = '/tmp'): GitLabRuntimeConfig {
  return {
    host: 'https://gitlab.example.test',
    project: 'group/project',
    token: 'secret',
    projectConfig: CONFIG,
    configPath: path.join(root, '.sdlc-harness.json'),
    projectRoot: root,
  };
}

describe('coverage filesystem trust boundaries', () => {
  test('rejects a symlinked coverage root', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-cover-root-'));
    const target = path.join(directory, 'target');
    const linked = path.join(directory, 'linked');
    try {
      fs.mkdirSync(target);
      fs.symlinkSync(target, linked, 'dir');
      expect(() => scanConfiguredTestFiles(linked, ['**/*.test.ts']))
        .toThrow(/root must not be a symlink/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects a symlinked pattern root', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-cover-pattern-'));
    try {
      fs.mkdirSync(path.join(directory, 'real-tests'));
      fs.symlinkSync('real-tests', path.join(directory, 'tests'), 'dir');
      expect(() => scanConfiguredTestFiles(directory, ['tests/**/*.test.ts']))
        .toThrow(/pattern root must not be a symlink/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('rejects a symlinked file instead of silently following or skipping it', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-cover-file-'));
    try {
      fs.mkdirSync(path.join(directory, 'tests'));
      fs.writeFileSync(path.join(directory, 'outside.ts'), '// #12', 'utf8');
      fs.symlinkSync('../outside.ts', path.join(directory, 'tests', 'linked.test.ts'));
      expect(() => scanConfiguredTestFiles(directory, ['tests/**/*.test.ts']))
        .toThrow(/rejects symlinked path/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('fails closed when the scan exceeds its file cap', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-cover-count-'));
    try {
      fs.mkdirSync(path.join(directory, 'tests'));
      fs.writeFileSync(path.join(directory, 'tests', 'one.test.ts'), '// #1', 'utf8');
      fs.writeFileSync(path.join(directory, 'tests', 'two.test.ts'), '// #2', 'utf8');
      expect(() => scanConfiguredTestFiles(
        directory,
        ['tests/**/*.test.ts'],
        { maxFiles: 1 },
      )).toThrow(/1 file limit/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('fails closed before reading a test file over the byte cap', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-cover-size-'));
    try {
      fs.mkdirSync(path.join(directory, 'tests'));
      fs.writeFileSync(path.join(directory, 'tests', 'large.test.ts'), '12345', 'utf8');
      expect(() => scanConfiguredTestFiles(
        directory,
        ['tests/**/*.test.ts'],
        { maxFileBytes: 4 },
      )).toThrow(/4 byte limit/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('HTTP and reader trust boundaries', () => {
  test('enforces a deadline even when the fetch implementation ignores abort', async () => {
    const hangingFetch: FetchFn = async () => new Promise<Response>(() => undefined);
    await expect(fetchWithDeadline(
      hangingFetch,
      'https://gitlab.example.test',
      {},
      5,
    )).rejects.toThrow(/timed out after 5ms/);
  });

  test.each([
    '/../groups',
    '/issues/../../groups',
    '/issues/%2e%2e/groups',
    '/issues/%252e%252e/groups',
    '//other.example.test/issues',
    '/issues\\..\\groups',
  ])('rejects project-relative route traversal %s', (endpoint) => {
    expect(() => assertProjectRelativeEndpoint(endpoint)).toThrow();
  });

  test('does not call fetch for a traversal route', async () => {
    const fetchMock = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>();
    const request = createGitLabRequest(runtime(), fetchMock);
    await expect(request('/issues/../groups')).rejects.toThrow(/traversal/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('queries a bounded MR horizon and parses update timestamps', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      expect(url).toContain('updated_after=2026-06-01T00%3A00%3A00.000Z');
      return new Response(JSON.stringify([{
        iid: 3,
        title: 'Implement preferences',
        description: 'Closes #12',
        state: 'merged',
        merged_at: '2026-08-29T09:00:00.000Z',
        updated_at: '2026-08-29T10:00:00.000Z',
      }]), { status: 200 });
    });
    const reader = createGitLabRestReaderAdapter(fetchMock, () => runtime());
    const mergeRequests = await reader.listMergeRequests('2026-06-01T00:00:00.000Z');
    expect(mergeRequests).toEqual([{
      iid: 3,
      title: 'Implement preferences',
      description: 'Closes #12',
      state: 'merged',
      mergedAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T10:00:00.000Z',
    }]);
  });

  test('parses issue updated_at for stale-write protection', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify([{
      iid: 12,
      title: ISSUE.title,
      description: ISSUE.description,
      labels: ISSUE.labels,
      state: ISSUE.state,
      assignee: null,
      updated_at: ISSUE.updatedAt,
    }]), { status: 200 }));
    const reader = createGitLabRestReaderAdapter(fetchMock, () => runtime());
    expect(await reader.listOpenIssues()).toEqual([ISSUE]);
  });

  test('fails rather than truncating pagination beyond the configured page cap', async () => {
    let calls = 0;
    const fetchMock = jest.fn(async (): Promise<Response> => {
      calls += 1;
      return new Response('[]', {
        status: 200,
        headers: { 'x-next-page': String(calls + 1) },
      });
    });
    const reader = createGitLabRestReaderAdapter(
      fetchMock,
      () => runtime(),
      { maxPages: 2 },
    );
    await expect(reader.listOpenIssues()).rejects.toThrow(/2 page limit/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('fails rather than returning more than the configured item cap', async () => {
    const fetchMock = jest.fn(async () => new Response('[{},{}]', { status: 200 }));
    const reader = createGitLabRestReaderAdapter(
      fetchMock,
      () => runtime(),
      { maxItems: 1 },
    );
    await expect(reader.listOpenIssues()).rejects.toThrow(/1 item limit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('reference and activity freshness boundaries', () => {
  const now = new Date('2026-08-29T12:00:00.000Z');
  const horizon = new Date('2026-05-31T12:00:00.000Z');

  test('accepts local and exact-project MR references but rejects foreign references', () => {
    const base = {
      iid: 3,
      title: 'Preferences implementation',
      state: 'opened',
      updatedAt: '2026-08-29T10:00:00.000Z',
    };
    expect(referencesIssue(
      { ...base, description: 'Closes #12' },
      12,
      'group/project',
      CONFIG.projectUrl,
    )).toBe(true);
    expect(referencesIssue(
      { ...base, description: 'Closes group/project#12' },
      12,
      'group/project',
      CONFIG.projectUrl,
    )).toBe(true);
    expect(referencesIssue(
      { ...base, description: 'See https://gitlab.example.test/group/project/-/issues/12' },
      12,
      'group/project',
      CONFIG.projectUrl,
    )).toBe(true);
    expect(referencesIssue(
      { ...base, description: 'Closes other/project#12' },
      12,
      'group/project',
      CONFIG.projectUrl,
    )).toBe(false);
  });

  test('rejects merged activity older than the issue update or query horizon', () => {
    const staleAfterIssue = {
      iid: 3,
      title: 'Preferences implementation',
      description: 'Closes #12',
      state: 'merged',
      mergedAt: '2026-08-27T10:00:00.000Z',
      updatedAt: '2026-08-29T10:00:00.000Z',
    };
    const staleHorizon = {
      ...staleAfterIssue,
      mergedAt: '2026-05-01T10:00:00.000Z',
    };
    expect(isRelevantMergeRequest(
      staleAfterIssue,
      ISSUE,
      'group/project',
      CONFIG.projectUrl,
      horizon,
      now,
    )).toBe(false);
    expect(isRelevantMergeRequest(
      staleHorizon,
      { ...ISSUE, updatedAt: '2026-04-01T00:00:00.000Z' },
      'group/project',
      CONFIG.projectUrl,
      horizon,
      now,
    )).toBe(false);
  });

  test('accepts fresh merged activity newer than the issue', () => {
    expect(isRelevantMergeRequest({
      iid: 3,
      title: 'Preferences implementation',
      description: 'Closes group/project#12',
      state: 'merged',
      mergedAt: '2026-08-29T09:00:00.000Z',
      updatedAt: '2026-08-29T10:00:00.000Z',
    }, ISSUE, 'group/project', CONFIG.projectUrl, horizon, now)).toBe(true);
  });

  test('state agent ignores stale timestamped merged activity', async () => {
    const finding = await runStateTransitionAgent(ISSUE, [{
      iid: 3,
      title: 'Preferences implementation',
      description: 'Closes #12',
      state: 'merged',
      mergedAt: '2026-08-27T10:00:00.000Z',
      updatedAt: '2026-08-29T10:00:00.000Z',
    }], CONFIG, now);
    expect(finding).toBeNull();
  });

  test('audit rejects stale and foreign MR signals before state analysis', async () => {
    const issue = {
      ...ISSUE,
      description: '## Acceptance Criteria\nGiven a saved preference\nWhen loaded\nThen it appears',
    };
    const reader = {
      listOpenIssues: jest.fn(async () => [issue]),
      listMergeRequests: jest.fn(async () => [{
        iid: 1,
        title: 'Stale implementation',
        description: 'Closes #12',
        state: 'merged',
        mergedAt: '2026-08-27T10:00:00.000Z',
        updatedAt: '2026-08-29T10:00:00.000Z',
      }, {
        iid: 2,
        title: 'Foreign implementation',
        description: 'Closes other/project#12',
        state: 'merged',
        mergedAt: '2026-08-29T09:00:00.000Z',
        updatedAt: '2026-08-29T10:00:00.000Z',
      }]),
    };
    const result = await runAudit({
      runtimeConfig: runtime(),
      reader,
      now: () => now,
    });
    expect(result.findings.some((entry) => entry.finding.agent === 'ST')).toBe(false);
    expect(reader.listMergeRequests).toHaveBeenCalledWith(horizon.toISOString());
  });

  test('coverage references ignore numeric CSS colors and foreign projects', () => {
    const refs = extractIssueRefs([
      '.panel { color: #123; background-color: #123456; }',
      'const accent = "#654321";',
      '// closes other/project#12',
      '// covers group/project#7',
      '// issue 9 and #10',
    ].join('\n'), 'group/project');
    expect([...refs].sort((left, right) => left - right)).toEqual([7, 9, 10]);
  });
});

describe('agent hardening boundaries', () => {
  test('does not treat an empty AC heading as completed acceptance criteria', () => {
    expect(hasAcceptanceCriteria('## Acceptance Criteria')).toBe(false);
    expect(hasAcceptanceCriteria('## Acceptance Criteria\n\n## Notes\nStill needed.')).toBe(false);
    expect(hasAcceptanceCriteria('## Acceptance Criteria\n- The response is HTTP 200.')).toBe(true);
  });

  test.each([
    'The settings page does not work properly. The thing that saves preferences is broken. Fix it.',
    "The search doesn't work well. Make it better and faster so users can find cities more easily.",
    "The dashboard UI looks a bit cluttered. Make it look nicer and more professional.\nSome things could be aligned better and the colours don't look right.",
  ])('flags seeded ambiguity wording: %s', async (description) => {
    const finding = await runAmbiguityAgent({ ...ISSUE, description }, CONFIG);
    expect(finding).not.toBeNull();
    expect(finding?.agent).toBe('AM');
  });

  test('specificity signals do not suppress a non-testable defect phrase', async () => {
    const description =
      'The `savePreferences` function calls the /api/preferences endpoint and emits ' +
      'PreferencesError with HTTP 409, but the retry button does not work in production.';
    const finding = await runAmbiguityAgent({ ...ISSUE, description }, CONFIG);
    expect(finding).not.toBeNull();
    expect(finding?.reason).toMatch(/does not work/);
  });

  test('uses relates-to for generic one-sided dependency language', async () => {
    const first = {
      ...ISSUE,
      iid: 1,
      title: 'Preferences schema migration',
      description: 'Coordinate the preferences schema migration. This requires coordination.',
    };
    const second = {
      ...ISSUE,
      iid: 2,
      title: 'Preferences API migration',
      description: 'Coordinate the preferences API migration with the schema work.',
    };
    const findings = await runDependencyAgent([first, second], CONFIG);
    expect(findings).toHaveLength(1);
    expect(findings[0].suggestedLinkType).toBe('relates-to');
  });

  test('requires stateMapping when custom workflow concepts cannot be inferred', () => {
    const custom = {
      projectUrl: CONFIG.projectUrl,
      workItemTypes: ['Story'],
      workflowStates: ['Queued', 'Building', 'QA', 'Released'],
      transitionRules: {
        Queued: ['Building'],
        Building: ['QA'],
        QA: ['Released'],
        Released: [],
      },
    };
    expect(() => validateProjectConfig(custom, false)).toThrow(/stateMapping.open is required/);
    expect(validateProjectConfig({
      ...custom,
      stateMapping: {
        open: 'Queued',
        inProgress: 'Building',
        inReview: 'QA',
        done: 'Released',
      },
    }, false).stateMapping).toEqual({
      open: 'Queued',
      inProgress: 'Building',
      inReview: 'QA',
      done: 'Released',
    });
  });
});

describe('write and telemetry truth boundaries', () => {
  const keys = ['SDLC_PROJECT_CONFIG', 'SDLC_TELEMETRY_PATH'] as const;
  let saved: Record<string, string | undefined>;
  let directory: string;

  beforeEach(() => {
    saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-telemetry-'));
    _resetSessionTracker();
  });

  afterEach(() => {
    for (const key of keys) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      if (value !== undefined) process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('resolves default telemetry beside the selected project config', () => {
    delete process.env['SDLC_TELEMETRY_PATH'];
    process.env['SDLC_PROJECT_CONFIG'] = path.join(directory, 'project.json');
    expect(resolveTelemetryPath()).toBe(
      path.join(directory, 'sdlc-harness-telemetry.jsonl'),
    );
  });

  test('returns successful GitLab truth when telemetry persistence fails afterward', async () => {
    process.env['SDLC_TELEMETRY_PATH'] = directory;
    const result = await applyFinding({
      agent: 'ST',
      issueIid: 12,
      action: 'state_transition',
      suggestedValue: 'In Progress',
    }, { editedValue: null }, stubWriterAdapter);
    expect(result.gitlabWriteCalled).toBe(true);
    expect(result.gitlabWriteSucceeded).toBe(true);
    expect(result.telemetryRecorded).toBe(false);
    expect(result.warning).toBe(
      'GitLab write succeeded, but telemetry could not be recorded.',
    );
    expect(result.error).toBeUndefined();
  });

  test('uses add_labels/remove_labels and never replaces all labels', async () => {
    let updateBody: Record<string, unknown> = {};
    const fetchMock = jest.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) {
        return new Response(JSON.stringify({
          description: '',
          labels: ['Bug', 'Open', 'security'],
          state: 'opened',
          updated_at: '2026-08-29T10:00:00.000Z',
        }), { status: 200 });
      }
      updateBody = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response('{}', { status: 200 });
    });
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => runtime());
    const result = await adapter.applyFindingToGitLab({
      agent: 'ST',
      issueIid: 12,
      action: 'state_transition',
      suggestedValue: 'In Progress',
    }, 'In Progress');
    expect(result.written).toBe(true);
    expect(updateBody).toEqual({ add_labels: 'In Progress', remove_labels: 'Open' });
  });

  test('rejects a description write when updated_at changed but text did not', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({
      description: ISSUE.description,
      labels: ['Open'],
      state: 'opened',
      updated_at: '2026-08-29T11:00:00.000Z',
    }), { status: 200 }));
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => runtime());
    const result = await adapter.applyFindingToGitLab({
      agent: 'AM',
      issueIid: 12,
      action: 'rewrite_desc',
      suggestedValue: 'A replacement.',
      originalDescription: ISSUE.description,
      originalUpdatedAt: ISSUE.updatedAt,
    }, 'A replacement.');
    expect(result.written).toBe(false);
    expect(result.error).toMatch(/updated after audit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('preserves and validates originalUpdatedAt in CLI payloads', () => {
    const parsed = parseDecisionPayload({
      finding: {
        agent: 'AM',
        issueIid: 12,
        action: 'rewrite_desc',
        suggestedValue: 'A replacement.',
        originalDescription: ISSUE.description,
        originalUpdatedAt: ISSUE.updatedAt,
      },
    });
    expect(parsed.finding).toMatchObject({ originalUpdatedAt: ISSUE.updatedAt });
    expect(() => parseDecisionPayload({
      finding: {
        agent: 'AM',
        issueIid: 12,
        action: 'rewrite_desc',
        suggestedValue: 'A replacement.',
        originalDescription: ISSUE.description,
        originalUpdatedAt: 'not-a-timestamp',
      },
    })).toThrow(/valid timestamp/);
  });
});

describe('clean installation and CLI validation', () => {
  test('provides an installed-path build command instead of relying on committed dist', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const installer = fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8');
    const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
    expect(packageJson.scripts['install:skill']).toBe('bash ./install.sh');
    expect(installer).toContain('npm --prefix "$SKILL_DIR" ci --ignore-scripts');
    expect(installer).toContain('npm --prefix "$SKILL_DIR" run build');
    expect(skill).toContain('$HOME/.bob/skills/sdlc-harness');
  });

  test('CLI controller rejects an invalid decision before any GitLab call', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-cli-invalid-'));
    try {
      const decisionPath = path.join(directory, 'decision.json');
      fs.writeFileSync(decisionPath, JSON.stringify({
        finding: {
          agent: 'ST',
          issueIid: 12,
          action: 'rewrite_desc',
          suggestedValue: 'In Progress',
        },
      }), 'utf8');
      await expect(runCli(['apply', decisionPath], () => undefined))
        .rejects.toThrow(/invalid for agent ST/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('CLI controller handles advisory apply and reject without GitLab writes', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-cli-review-'));
    const decisionPath = path.join(directory, 'decision.json');
    const previousTelemetry = process.env['SDLC_TELEMETRY_PATH'];
    try {
      fs.writeFileSync(decisionPath, JSON.stringify({
        finding: {
          agent: 'COV',
          issueIid: 12,
          action: 'missing_coverage',
          suggestedValue: 'Add a test for #12.',
        },
      }), 'utf8');
      process.env['SDLC_TELEMETRY_PATH'] = path.join(directory, 'telemetry.jsonl');
      const applied: string[] = [];
      const rejected: string[] = [];
      expect(await runCli(['apply', decisionPath], (value) => applied.push(value))).toBe(0);
      expect(await runCli(['reject', decisionPath], (value) => rejected.push(value))).toBe(0);
      expect(JSON.parse(applied.join(''))).toMatchObject({
        gitlabWriteSucceeded: false,
        telemetryRecorded: true,
      });
      expect(JSON.parse(rejected.join(''))).toMatchObject({
        gitlabWriteSucceeded: false,
        telemetryRecorded: true,
      });
    } finally {
      if (previousTelemetry === undefined) delete process.env['SDLC_TELEMETRY_PATH'];
      if (previousTelemetry !== undefined) {
        process.env['SDLC_TELEMETRY_PATH'] = previousTelemetry;
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('CLI summary reads the explicitly scoped telemetry file', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-cli-summary-'));
    const telemetryPath = path.join(directory, 'telemetry.jsonl');
    const previousPath = process.env['SDLC_TELEMETRY_PATH'];
    try {
      fs.writeFileSync(telemetryPath, `${JSON.stringify({
        timestamp: '2026-08-29T10:00:00.000Z',
        agent: 'AC',
        issueIid: 12,
        action: 'draft_ac',
        outcome: 'accepted',
        editedFields: [],
      })}\n`, 'utf8');
      process.env['SDLC_TELEMETRY_PATH'] = telemetryPath;
      const output: string[] = [];
      expect(await runCli(['summary'], (value) => output.push(value))).toBe(0);
      expect(JSON.parse(output.join(''))).toMatchObject({
        total: 1,
        accepted: 1,
        acceptanceRate: 1,
      });
    } finally {
      if (previousPath === undefined) delete process.env['SDLC_TELEMETRY_PATH'];
      if (previousPath !== undefined) process.env['SDLC_TELEMETRY_PATH'] = previousPath;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
