import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hasAcceptanceCriteria } from '../src/agents/ac-agent';
import { runAmbiguityAgent } from '../src/agents/ambiguity-agent';
import { runDependencyAgent } from '../src/agents/dependency-agent';
import { runStateTransitionAgent } from '../src/agents/state-transition-agent';
import type {
  DependencyFinding,
  IssueInput,
  ProjectConfig,
} from '../src/models';
import { runAudit, scanConfiguredTestFiles } from '../src/skill/audit';
import { runCli } from '../src/skill/cli-controller';
import { createGitLabRestReaderAdapter } from '../src/skill/gitlab-reader-adapter';
import { loadGitLabRuntimeConfig } from '../src/skill/gitlab-runtime';
import type { GitLabRuntimeConfig } from '../src/skill/gitlab-runtime';
import { createGitLabRestWriterAdapter, stubWriterAdapter } from '../src/skill/gitlab-writer-adapter';
import {
  persistProjectConfig,
  validateProjectConfig,
} from '../src/skill/onboard';
import { applyFinding } from '../src/skill/review';
import { parseDecisionPayload } from '../src/skill/review-payload';

const BASE_INPUT = {
  projectUrl: 'https://gitlab.example.test/group/project',
  workItemTypes: ['Story', 'Bug'],
  workflowStates: ['Open', 'In Progress', 'In Review', 'Done'],
  transitionRules: {
    Open: ['In Progress'],
    'In Progress': ['In Review'],
    'In Review': ['Done'],
    Done: [],
  },
};

const PROJECT_CONFIG: ProjectConfig = validateProjectConfig(BASE_INPUT, false);
const BLOCKING_PROJECT_CONFIG: ProjectConfig = {
  ...PROJECT_CONFIG,
  blockingIssueLinks: true,
};

const ISSUE: IssueInput = {
  iid: 12,
  title: 'Save notification preferences',
  description: 'fix it',
  labels: ['Bug', 'Open'],
  state: 'opened',
  assignee: null,
  updatedAt: '2026-08-28T12:00:00.000Z',
};

/** Build an injectable scoped runtime without reading process environment. */
function runtime(config: ProjectConfig = PROJECT_CONFIG, root = '/tmp'): GitLabRuntimeConfig {
  return {
    host: 'https://gitlab.example.test',
    project: 'group/project',
    token: 'secret',
    projectConfig: config,
    configPath: path.join(root, '.sdlc-harness.json'),
    projectRoot: root,
  };
}

describe('configuration validation and persistence regressions', () => {
  test('stores provider and canonicalizes trimmed duplicate names and transition targets', () => {
    const config = validateProjectConfig({
      ...BASE_INPUT,
      workItemTypes: [' Story ', 'story', ' Bug '],
      workflowStates: [' Open ', 'open', ' In Progress ', 'In Review', ' Done '],
      transitionRules: {
        ' Open ': [' In Progress ', 'in progress'],
        'In Progress': [' In Review '],
        'In Review': [' Done '],
        Done: [],
      },
    }, false);

    expect(config.provider).toBe('gitlab');
    expect(config.workItemTypes).toEqual(['Story', 'Bug']);
    expect(config.workflowStates).toEqual(['Open', 'In Progress', 'In Review', 'Done']);
    expect(config.transitionRules.Open).toEqual(['In Progress']);
  });

  test.each([
    'https://user:secret@gitlab.example.test/group/project',
    'https://gitlab.example.test/group/project?private_token=secret',
    'https://gitlab.example.test/group/project#fragment',
    'https://gitlab.example.test/project-only',
    'file:///group/project',
  ])('rejects unsafe or unscoped project URL %s', (projectUrl) => {
    expect(() => validateProjectConfig({ ...BASE_INPUT, projectUrl }, false)).toThrow();
  });

  test('rejects non-array transition targets at runtime', () => {
    expect(() => validateProjectConfig({
      ...BASE_INPUT,
      transitionRules: { Open: 'In Progress' },
    }, false)).toThrow(/must be an array/);
  });

  test('rejects enabled coverage without a safe nonblank pattern', () => {
    expect(() => validateProjectConfig({
      ...BASE_INPUT,
      coverage: { enabled: true, testFilePatterns: [] },
    }, false)).toThrow(/at least one/);
    expect(() => validateProjectConfig({
      ...BASE_INPUT,
      coverage: { enabled: true, testFilePatterns: ['../outside.test.ts'] },
    }, false)).toThrow(/within the onboarded repo/);
  });

  test('trims and deduplicates enabled coverage patterns', () => {
    const config = validateProjectConfig({
      ...BASE_INPUT,
      coverage: {
        enabled: true,
        testFilePatterns: [' tests/**/*.test.ts ', 'tests/**/*.test.ts'],
      },
    }, false);
    expect(config.coverage?.testFilePatterns).toEqual(['tests/**/*.test.ts']);
  });

  test('persists a validated config atomically with restrictive permissions', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-onboard-'));
    const configPath = path.join(directory, '.sdlc-harness.json');
    try {
      expect(persistProjectConfig(PROJECT_CONFIG, configPath)).toBe(configPath);
      const persisted = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ProjectConfig;
      expect(persisted).toEqual(PROJECT_CONFIG);
      expect(fs.statSync(configPath).mode & 0o777).toBe(0o600);
      expect(fs.readdirSync(directory)).toEqual(['.sdlc-harness.json']);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('onboard CLI controller writes the authoritative config and returns structured JSON', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-onboard-cli-'));
    const inputPath = path.join(directory, 'onboarding.json');
    const configPath = path.join(directory, '.sdlc-harness.json');
    const previousPath = process.env['SDLC_PROJECT_CONFIG'];
    try {
      fs.writeFileSync(inputPath, JSON.stringify(BASE_INPUT), 'utf8');
      process.env['SDLC_PROJECT_CONFIG'] = configPath;
      const output: string[] = [];
      const exitCode = await runCli(['onboard', inputPath], (value) => output.push(value));
      const result = JSON.parse(output.join('')) as {
        ok: boolean;
        configPath: string;
        config: ProjectConfig;
      };

      expect(exitCode).toBe(0);
      expect(result).toMatchObject({ ok: true, configPath });
      expect(result.config.provider).toBe('gitlab');
      expect(JSON.parse(fs.readFileSync(configPath, 'utf8'))).toEqual(result.config);
    } finally {
      if (previousPath === undefined) delete process.env['SDLC_PROJECT_CONFIG'];
      if (previousPath !== undefined) process.env['SDLC_PROJECT_CONFIG'] = previousPath;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('authoritative project scope regressions', () => {
  const keys = [
    'SDLC_PROJECT_CONFIG',
    'SDLC_ENV_FILE',
    'GITLAB_HOST',
    'GITLAB_PROJECT',
    'GITLAB_TOKEN',
  ] as const;
  let saved: Record<string, string | undefined>;
  let directory: string;

  beforeEach(() => {
    saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-scope-'));
    const envPath = path.join(directory, '.env');
    fs.writeFileSync(envPath, '', 'utf8');
    fs.chmodSync(envPath, 0o600);
    process.env['SDLC_ENV_FILE'] = envPath;
    process.env['GITLAB_TOKEN'] = 'secret';
  });

  afterEach(() => {
    for (const key of keys) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      if (value !== undefined) process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('fails closed without onboarding even when ambient project variables exist', () => {
    process.env['SDLC_PROJECT_CONFIG'] = path.join(directory, 'missing.json');
    process.env['GITLAB_HOST'] = 'https://gitlab.example.test';
    process.env['GITLAB_PROJECT'] = 'group/project';
    expect(() => loadGitLabRuntimeConfig()).toThrow(/not onboarded/);
  });

  test('derives host and project from the explicit validated config', () => {
    const configPath = path.join(directory, 'project.json');
    persistProjectConfig(PROJECT_CONFIG, configPath);
    process.env['SDLC_PROJECT_CONFIG'] = configPath;
    process.env['GITLAB_HOST'] = 'https://gitlab.example.test/';
    process.env['GITLAB_PROJECT'] = '/group/project/';

    const loaded = loadGitLabRuntimeConfig();
    expect(loaded.host).toBe('https://gitlab.example.test');
    expect(loaded.project).toBe('group/project');
    expect(loaded.configPath).toBe(configPath);
  });

  test('fails closed when an ambient host or project disagrees with onboarding', () => {
    const configPath = path.join(directory, 'project.json');
    persistProjectConfig(PROJECT_CONFIG, configPath);
    process.env['SDLC_PROJECT_CONFIG'] = configPath;
    process.env['GITLAB_HOST'] = 'https://other.example.test';
    expect(() => loadGitLabRuntimeConfig()).toThrow(/does not match/);

    process.env['GITLAB_HOST'] = 'https://gitlab.example.test';
    process.env['GITLAB_PROJECT'] = 'group/other';
    expect(() => loadGitLabRuntimeConfig()).toThrow(/does not match/);
  });

  test('fails closed when a selected environment file disagrees with onboarding', () => {
    const configPath = path.join(directory, 'project.json');
    persistProjectConfig(PROJECT_CONFIG, configPath);
    process.env['SDLC_PROJECT_CONFIG'] = configPath;
    fs.writeFileSync(
      process.env['SDLC_ENV_FILE'] as string,
      'GITLAB_HOST=https://other.example.test\nGITLAB_TOKEN=secret\n',
      'utf8',
    );
    fs.chmodSync(process.env['SDLC_ENV_FILE'] as string, 0o600);
    delete process.env['GITLAB_TOKEN'];
    expect(() => loadGitLabRuntimeConfig()).toThrow(/does not match/);
  });

  test('rejects a group-readable credentials file on POSIX', () => {
    if (process.platform === 'win32') return;
    const configPath = path.join(directory, 'project.json');
    persistProjectConfig(PROJECT_CONFIG, configPath);
    process.env['SDLC_PROJECT_CONFIG'] = configPath;
    fs.chmodSync(process.env['SDLC_ENV_FILE'] as string, 0o640);

    expect(() => loadGitLabRuntimeConfig()).toThrow(/group\/world access/);
  });

  test('scoped reader uses GET only and the project derived from runtime config', async () => {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      expect(init?.redirect).toBe('error');
      if (url.includes('/issues?')) return new Response(JSON.stringify([]), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const reader = createGitLabRestReaderAdapter(fetchMock, () => runtime());

    await reader.listOpenIssues();
    await reader.listMergeRequests('2026-01-01T00:00:00.000Z');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(call[0]).toContain('/api/v4/projects/group%2Fproject/');
    }
    expect(fetchMock.mock.calls[1][0]).toContain('scope=all');
  });
});

describe('agent correctness regressions', () => {
  test('does not mistake prose about missing acceptance criteria for an AC heading', () => {
    expect(hasAcceptanceCriteria('Acceptance criteria are missing and must be written.')).toBe(false);
    expect(hasAcceptanceCriteria('## Acceptance Criteria\n- **Given** a user')).toBe(true);
  });

  test('flags placeholders before specificity exemptions', async () => {
    const description =
      'The `savePreferences` function calls the /api/preferences endpoint and returns ' +
      'HTTP 409 for stale versions. The retry policy is TBD before implementation.';
    const finding = await runAmbiguityAgent({ ...ISSUE, description }, PROJECT_CONFIG);
    expect(finding).not.toBeNull();
    expect(finding?.reason).toContain('TBD');
  });

  test('does not create a rewrite finding from vague wording in the title alone', async () => {
    const finding = await runAmbiguityAgent({
      ...ISSUE,
      title: 'Fix it',
      description: 'Return HTTP 409 when the supplied preferences version is stale.',
    }, PROJECT_CONFIG);
    expect(finding).toBeNull();
  });

  test('distinguishes A blocks B from A depends on B', async () => {
    const blocker = {
      ...ISSUE,
      iid: 1,
      title: 'Build preferences schema',
      description: 'The preferences schema blocks preferences API implementation.',
    };
    const dependent = {
      ...ISSUE,
      iid: 2,
      title: 'Implement preferences API',
      description: 'The preferences API depends on the preferences schema.',
    };
    const findings = await runDependencyAgent([blocker, dependent], BLOCKING_PROJECT_CONFIG);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      sourceIid: 1,
      targetIid: 2,
      suggestedLinkType: 'blocks',
    });
  });

  test('uses relates-to when both issues claim to block the other', async () => {
    const first = {
      ...ISSUE,
      iid: 1,
      title: 'Preferences schema migration',
      description: 'Preferences schema migration blocks preferences API rollout.',
    };
    const second = {
      ...ISSUE,
      iid: 2,
      title: 'Preferences API rollout',
      description: 'Preferences API rollout blocks preferences schema migration.',
    };
    const findings = await runDependencyAgent([first, second], PROJECT_CONFIG);
    expect(findings).toHaveLength(1);
    expect(findings[0].suggestedLinkType).toBe('relates-to');
  });

  test('finds only the intended dependency pairs in the seeded demo scenarios', async () => {
    const issue = (
      iid: number,
      title: string,
      description: string,
    ): IssueInput => ({ ...ISSUE, iid, title, description });
    const issues = [
      issue(3, 'Implement JWT token refresh',
        'The app must refresh expired JWT tokens through the /auth/refresh endpoint.'),
      issue(4, 'Handle auth token expiry in API calls',
        'API calls retry after auth token refresh. This depends on the token refresh mechanism.'),
      issue(7, 'Add dark mode toggle to navigation bar',
        'The navigation bar switches between light and dark themes.'),
      issue(8, 'Persist user theme preference across page reloads',
        'Remember the light or dark theme between visits and apply the stored theme.'),
      issue(9, 'Add temperature unit toggle',
        'Switch displayed temperatures between Celsius and Fahrenheit.'),
      issue(11, 'Auto-detect user location on first load',
        'Use browser geolocation to detect the user city and populate the location field.'),
      issue(12, 'Add recent locations dropdown to search',
        'Show recent cities in a location dropdown when the search field is focused.'),
    ];

    const findings = await runDependencyAgent(issues, PROJECT_CONFIG);
    const pairs = findings.map((finding) => [
      Math.min(finding.sourceIid, finding.targetIid),
      Math.max(finding.sourceIid, finding.targetIid),
    ].join('-'));

    expect(pairs).toEqual(['3-4', '7-8', '11-12']);
    expect(findings[0]).toMatchObject({
      sourceIid: 3,
      targetIid: 4,
      suggestedLinkType: 'relates-to',
    });
  });

  test('uses labels and advances custom states one direct edge at a time', async () => {
    const custom = validateProjectConfig({
      ...BASE_INPUT,
      workflowStates: ['Backlog', 'Doing', 'Review', 'Shipped'],
      transitionRules: {
        Backlog: ['Doing'],
        Doing: ['Review'],
        Review: ['Shipped'],
        Shipped: [],
      },
      stateMapping: {
        open: 'Backlog',
        inProgress: 'Doing',
        inReview: 'Review',
        done: 'Shipped',
      },
    }, false);
    const mergedMr = {
      iid: 4,
      title: 'Implement preferences API',
      description: 'Closes #12',
      state: 'merged',
    };

    const fromBacklog = await runStateTransitionAgent(
      { ...ISSUE, labels: ['Bug', 'Backlog'], state: 'opened' },
      [mergedMr],
      custom,
    );
    const fromDoing = await runStateTransitionAgent(
      { ...ISSUE, labels: ['Bug', 'Doing'], state: 'opened' },
      [mergedMr],
      custom,
    );
    expect(fromBacklog?.suggestedValue).toBe('Doing');
    expect(fromDoing?.suggestedValue).toBe('Review');
  });

  test('advances Open to In Progress, then In Progress to In Review', async () => {
    const mergedMr = {
      iid: 4,
      title: 'Implement preferences API',
      description: 'Closes #12',
      state: 'merged',
    };
    const first = await runStateTransitionAgent(
      { ...ISSUE, labels: ['Open'] },
      [mergedMr],
      PROJECT_CONFIG,
    );
    const second = await runStateTransitionAgent(
      { ...ISSUE, labels: ['In Progress'] },
      [mergedMr],
      PROJECT_CONFIG,
    );
    expect(first?.suggestedValue).toBe('In Progress');
    expect(second?.suggestedValue).toBe('In Review');
  });
});

describe('review safety regressions', () => {
  const dependency: DependencyFinding = {
    agent: 'DEP',
    sourceIid: 1,
    targetIid: 2,
    suggestedLinkType: 'blocks',
    confidence: 0.9,
  };

  test('applies an edited dependency link type rather than the original', async () => {
    let body: Record<string, unknown> = {};
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/issues/1/links?')) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (!init?.method) return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      body = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response(JSON.stringify({}), { status: 201 });
    });
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => runtime());
    const result = await adapter.applyFindingToGitLab(dependency, 'relates-to');
    expect(result).toMatchObject({ written: true, value: 'relates-to' });
    expect(body['link_type']).toBe('relates_to');
  });

  test('treats an existing matching dependency link as an idempotent success', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (!url.includes('/issues/1/links?')) {
        return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      }
      return new Response(JSON.stringify([{
        link_type: 'blocks',
        project_id: 42,
        iid: 2,
      }]), { status: 200 });
    });
    const adapter = createGitLabRestWriterAdapter(
      fetchMock,
      () => runtime(BLOCKING_PROJECT_CONFIG),
    );

    const result = await adapter.applyFindingToGitLab(dependency, 'blocks');

    expect(result).toMatchObject({ written: true, value: 'blocks' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('does not treat the inverse blocking direction as an idempotent match', async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (!url.includes('/issues/1/links?')) {
        return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      }
      return new Response(JSON.stringify([{
        link_type: 'is_blocked_by',
        project_id: 42,
        iid: 2,
      }]), { status: 200 });
    });
    const adapter = createGitLabRestWriterAdapter(
      fetchMock,
      () => runtime(BLOCKING_PROJECT_CONFIG),
    );

    const result = await adapter.applyFindingToGitLab(dependency, 'blocks');

    expect(result.written).toBe(false);
    expect(result.error).toMatch(/already linked/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('ignores a matching IID from another project when checking existing links', async () => {
    let body: Record<string, unknown> = {};
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/issues/1/links?')) {
        return new Response(JSON.stringify([{
          link_type: 'blocks',
          project_id: 99,
          iid: 2,
        }]), { status: 200 });
      }
      if (!init?.method) return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      body = JSON.parse(init.body as string) as Record<string, unknown>;
      return new Response('{}', { status: 201 });
    });
    const adapter = createGitLabRestWriterAdapter(
      fetchMock,
      () => runtime(BLOCKING_PROJECT_CONFIG),
    );

    const result = await adapter.applyFindingToGitLab(dependency, 'blocks');

    expect(result).toMatchObject({ written: true, value: 'blocks' });
    expect(body).toMatchObject({ target_project_id: 42, target_issue_iid: 2 });
  });

  test('rejects invalid edited dependency link types before calling an adapter', async () => {
    const adapter = { applyFindingToGitLab: jest.fn() };
    await expect(applyFinding(
      dependency,
      { editedValue: 'depends-on' },
      adapter,
    )).rejects.toThrow(/link type/);
    expect(adapter.applyFindingToGitLab).not.toHaveBeenCalled();
  });

  test('prevents stale description replacement without issuing a PUT', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({
      description: 'A teammate changed this description.',
      labels: ['Open'],
      state: 'opened',
    }), { status: 200 }));
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => runtime());
    const result = await adapter.applyFindingToGitLab({
      agent: 'AM',
      issueIid: 12,
      action: 'rewrite_desc',
      suggestedValue: 'Specific replacement.',
      originalDescription: 'fix it',
    }, 'Specific replacement.');

    expect(result.written).toBe(false);
    expect(result.error).toMatch(/changed after audit/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('prevents a description write when the audit timestamp is omitted', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({
      description: 'fix it',
      labels: ['Open'],
      state: 'opened',
      updated_at: ISSUE.updatedAt,
    }), { status: 200 }));
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => runtime());
    const result = await adapter.applyFindingToGitLab({
      agent: 'AM',
      issueIid: 12,
      action: 'rewrite_desc',
      suggestedValue: 'Specific replacement.',
      originalDescription: 'fix it',
    }, 'Specific replacement.');

    expect(result.written).toBe(false);
    expect(result.error).toMatch(/originalUpdatedAt/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('rejects indirect and unknown state edits without issuing a PUT', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({
      description: '',
      labels: ['Open'],
      state: 'opened',
    }), { status: 200 }));
    const adapter = createGitLabRestWriterAdapter(fetchMock, () => runtime());
    const finding = {
      agent: 'ST' as const,
      issueIid: 12,
      action: 'state_transition' as const,
      suggestedValue: 'In Review',
    };

    const indirect = await adapter.applyFindingToGitLab(finding, 'In Review');
    const unknown = await adapter.applyFindingToGitLab(finding, 'Unconfigured');
    expect(indirect.written).toBe(false);
    expect(indirect.error).toMatch(/not a direct configured edge/);
    expect(unknown.written).toBe(false);
    expect(unknown.error).toMatch(/not configured/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('runtime payload validation rejects malformed action, stale-unsafe, and link values', () => {
    expect(() => parseDecisionPayload({
      finding: { agent: 'AC', issueIid: 1, action: 'state_transition', suggestedValue: 'Open' },
    })).toThrow(/invalid for agent/);
    expect(() => parseDecisionPayload({
      finding: { agent: 'AM', issueIid: 1, action: 'rewrite_desc', suggestedValue: 'Specific' },
    })).toThrow(/originalDescription/);
    expect(() => parseDecisionPayload({
      finding: {
        agent: 'AM',
        issueIid: 1,
        action: 'rewrite_desc',
        suggestedValue: 'Specific',
        originalDescription: 'Vague',
      },
    })).toThrow(/originalUpdatedAt/);
    expect(() => parseDecisionPayload({
      finding: dependency,
      editedValue: 'depends-on',
    })).toThrow(/link type/);
  });

  test('runtime payload validation accepts a safe edited dependency decision', () => {
    expect(parseDecisionPayload({
      finding: dependency,
      editedValue: 'relates-to',
    })).toEqual({ finding: dependency, editedValue: 'relates-to' });
  });

  test('description findings cannot bypass freshness metadata with a stub', async () => {
    await expect(applyFinding({
      agent: 'AM',
      issueIid: 12,
      action: 'rewrite_desc',
      suggestedValue: 'Specific replacement.',
    }, { editedValue: null }, stubWriterAdapter)).rejects.toThrow(/originalDescription/);
  });

  test('CLI fails telemetry-only apply and reject decisions when persistence fails', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-review-telemetry-'));
    const decisionPath = path.join(directory, 'decision.json');
    const previousPath = process.env['SDLC_TELEMETRY_PATH'];
    try {
      fs.writeFileSync(decisionPath, JSON.stringify({
        finding: {
          agent: 'COV',
          issueIid: 12,
          action: 'missing_coverage',
          suggestedValue: 'Add a test for #12.',
        },
      }), 'utf8');
      process.env['SDLC_TELEMETRY_PATH'] = directory;

      await expect(runCli(['apply', decisionPath], () => undefined))
        .rejects.toThrow(/Telemetry could not be recorded/);
      await expect(runCli(['reject', decisionPath], () => undefined))
        .rejects.toThrow(/Telemetry could not be recorded/);
    } finally {
      if (previousPath === undefined) delete process.env['SDLC_TELEMETRY_PATH'];
      if (previousPath !== undefined) process.env['SDLC_TELEMETRY_PATH'] = previousPath;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('coverage scan and audit controller regressions', () => {
  test('reads only files selected by configured testFilePatterns', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-coverage-'));
    try {
      fs.mkdirSync(path.join(directory, 'tests'));
      fs.writeFileSync(path.join(directory, 'tests', 'covered.test.ts'), '// covers #12', 'utf8');
      fs.writeFileSync(path.join(directory, 'ignored.test.js'), '// covers #99', 'utf8');
      const contents = scanConfiguredTestFiles(directory, ['tests/**/*.test.ts']);
      expect(contents).toEqual({ 'tests/covered.test.ts': '// covers #12' });
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('runs a read-only structured audit, includes configured coverage, and groups conflicts', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-audit-'));
    try {
      fs.mkdirSync(path.join(directory, 'tests'));
      fs.writeFileSync(path.join(directory, 'tests', 'preferences.test.ts'), '// no issue ref', 'utf8');
      fs.writeFileSync(path.join(directory, 'ignored.txt'), '// covers #12', 'utf8');
      const config = validateProjectConfig({
        ...BASE_INPUT,
        coverage: { enabled: true, testFilePatterns: ['tests/**/*.test.ts'] },
      }, false);
      const reader = {
        listOpenIssues: jest.fn(async () => [ISSUE]),
        listMergeRequests: jest.fn(async () => [{
          iid: 3,
          title: 'Implement preferences',
          description: 'Closes #12',
          state: 'merged',
          mergedAt: '2026-08-29T10:00:00.000Z',
          updatedAt: '2026-08-29T11:00:00.000Z',
        }]),
      };
      const result = await runAudit({
        runtimeConfig: runtime(config, directory),
        reader,
        rootDirectory: directory,
        now: () => new Date('2026-08-29T12:00:00.000Z'),
      });

      expect(reader.listOpenIssues).toHaveBeenCalledTimes(1);
      expect(reader.listMergeRequests).toHaveBeenCalledTimes(1);
      expect(reader.listMergeRequests).toHaveBeenCalledWith('2026-05-31T12:00:00.000Z');
      expect(result.timestamp).toBe('2026-08-29T12:00:00.000Z');
      expect(result.mergeRequestHorizonStart).toBe('2026-05-31T12:00:00.000Z');
      expect(result.scope).toEqual({
        provider: 'gitlab',
        projectUrl: 'https://gitlab.example.test/group/project',
      });
      expect(result.agentsRun).toEqual(['AC', 'AM', 'DEP', 'ST', 'COV']);
      expect(result.coverageFilesScanned).toEqual(['tests/preferences.test.ts']);
      expect(result.findings.map((entry) => entry.finding.agent)).toEqual([
        'AC', 'AM', 'ST', 'COV',
      ]);
      expect(result.findings.find((entry) => entry.finding.agent === 'ST')?.finding)
        .toMatchObject({ suggestedValue: 'In Progress' });
      expect(result.reviewGroups).toEqual([expect.objectContaining({
        issueIid: 12,
        hasConflict: true,
        conflictReasons: [
          'Apply AM, rerun audit, then draft and apply AC from the updated description.',
        ],
      })]);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('omits coverage entirely when it is not configured', async () => {
    const reader = {
      listOpenIssues: jest.fn(async () => []),
      listMergeRequests: jest.fn(async () => []),
    };
    const result = await runAudit({
      runtimeConfig: runtime(PROJECT_CONFIG, '/path/that/does/not/exist'),
      reader,
    });
    expect(result.agentsRun).toEqual(['AC', 'AM', 'DEP', 'ST']);
    expect(result.coverageFilesScanned).toBeUndefined();
    expect(result.findings).toEqual([]);
  });
});
