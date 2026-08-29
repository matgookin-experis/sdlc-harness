import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadGitLabRuntimeConfig } from '../src/skill/gitlab-runtime';
import { loadProjectConfig, resolveProjectConfigPath } from '../src/skill/onboard';
import { resolveTelemetryPath } from '../src/skill/telemetry';

const ENVIRONMENT_KEYS = [
  'SDLC_PROJECT_CONFIG',
  'SDLC_ENV_FILE',
  'SDLC_TELEMETRY_PATH',
  'GITLAB_HOST',
  'GITLAB_PROJECT',
  'GITLAB_TOKEN',
] as const;

const LEGACY_CONFIG = {
  projectUrl: 'https://gitlab.example.test/group/project.git',
  workItemTypes: ['Story', 'Bug'],
  workflowStates: ['Open', 'In Progress', 'In Review', 'Done'],
  transitionRules: {
    Open: ['In Progress'],
    'In Progress': ['In Review'],
    'In Review': ['Done'],
    Done: [],
  },
};

describe('onboarding runtime integration', () => {
  let directory: string;
  let savedEnvironment: Record<string, string | undefined>;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-onboarding-integration-'));
    savedEnvironment = Object.fromEntries(
      ENVIRONMENT_KEYS.map((key) => [key, process.env[key]]),
    );
    for (const key of ENVIRONMENT_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENVIRONMENT_KEYS) {
      const value = savedEnvironment[key];
      if (value === undefined) delete process.env[key];
      if (value !== undefined) process.env[key] = value;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test('loads a provider-less legacy config and canonicalizes an HTTPS clone URL', () => {
    const configPath = path.join(directory, '.sdlc-harness.json');
    fs.writeFileSync(configPath, JSON.stringify(LEGACY_CONFIG), 'utf8');

    expect(loadProjectConfig(configPath)).toMatchObject({
      provider: 'gitlab',
      projectUrl: 'https://gitlab.example.test/group/project',
    });
  });

  test('rejects an explicitly unsupported provider in persisted configuration', () => {
    const configPath = path.join(directory, '.sdlc-harness.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ ...LEGACY_CONFIG, provider: 'github' }),
      'utf8',
    );

    expect(() => loadProjectConfig(configPath)).toThrow(/Only the "gitlab"/);
  });

  test('anchors runtime config and telemetry to SDLC_ENV_FILE instead of cwd', () => {
    const configPath = path.join(directory, '.sdlc-harness.json');
    const environmentPath = path.join(directory, '.env');
    fs.writeFileSync(configPath, JSON.stringify(LEGACY_CONFIG), 'utf8');
    fs.writeFileSync(
      environmentPath,
      [
        'GITLAB_HOST=https://gitlab.example.test',
        'GITLAB_PROJECT=group/project',
        'GITLAB_TOKEN=secret',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.chmodSync(environmentPath, 0o600);
    process.env['SDLC_ENV_FILE'] = environmentPath;

    const runtime = loadGitLabRuntimeConfig();

    expect(resolveProjectConfigPath()).toBe(configPath);
    expect(runtime).toMatchObject({
      host: 'https://gitlab.example.test',
      project: 'group/project',
      configPath,
      projectRoot: directory,
      projectConfig: {
        provider: 'gitlab',
        projectUrl: 'https://gitlab.example.test/group/project',
      },
    });
    expect(resolveTelemetryPath()).toBe(
      path.join(directory, 'sdlc-harness-telemetry.jsonl'),
    );
  });
});
