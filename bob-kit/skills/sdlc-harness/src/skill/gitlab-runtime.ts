/** Authoritative GitLab runtime configuration derived from project onboarding. */

import * as fs from 'fs';
import * as path from 'path';
import type { ProjectConfig } from '../models';
import { loadProjectConfig, resolveProjectConfigPath } from './onboard';

export interface GitLabRuntimeConfig {
  host: string;
  project: string;
  token: string;
  projectConfig: ProjectConfig;
  configPath: string;
  projectRoot: string;
}

/** Reject credential files readable by users other than their owner on POSIX. */
function assertPrivateFile(filePath: string): void {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) throw new Error(`Environment path is not a file: ${filePath}`);
  if (process.platform === 'win32') return;
  const mode = stats.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(
      `Refusing to load ${filePath}: mode ${mode.toString(8)} permits group/world access. ` +
      `Run chmod 600 on the file.`,
    );
  }
}

/** Parse a simple KEY=VALUE environment file without executing it. */
function parseEnvFile(filePath: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();
    const isQuoted = (
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith('\'') && rawValue.endsWith('\''))
    );
    values[key] = isQuoted ? rawValue.slice(1, -1) : rawValue;
  }
  return values;
}

/** Load explicitly selected or repo-local environment values. */
function loadFileValues(configPath: string): Record<string, string> {
  const explicitPath = process.env['SDLC_ENV_FILE'];
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`SDLC_ENV_FILE does not exist: ${explicitPath}`);
    }
    assertPrivateFile(explicitPath);
    return parseEnvFile(explicitPath);
  }

  const defaultPath = path.join(path.dirname(configPath), '.env');
  if (!fs.existsSync(defaultPath)) return {};
  assertPrivateFile(defaultPath);
  return parseEnvFile(defaultPath);
}

/** Normalize an environment host for strict scope comparison. */
function normaliseHost(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('GITLAB_HOST must be a valid http or https origin.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('GITLAB_HOST must use http or https.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('GITLAB_HOST must not contain credentials, query parameters, or fragments.');
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('GITLAB_HOST must be an origin without a path.');
  }
  return url.origin;
}

/** Normalize a GitLab full project path for scope comparison. */
function normaliseProject(value: string): string {
  const project = value.trim().replace(/^\/+|\/+$/g, '');
  if (project.split('/').filter(Boolean).length < 2) {
    throw new Error('GITLAB_PROJECT must contain a namespace and project path.');
  }
  return decodeURIComponent(project);
}

/** Derive the GitLab host and full project path from the onboarded URL. */
export function deriveProjectScope(config: ProjectConfig): { host: string; project: string } {
  const url = new URL(config.projectUrl);
  const project = decodeURIComponent(url.pathname.replace(/^\/+|\/+$/g, ''));
  return { host: url.origin, project };
}

/** Assert that an optional ambient scope value agrees with onboarding. */
function assertScopeMatch(
  name: string,
  value: string | undefined,
  expected: string,
  normalise: (candidate: string) => string,
): void {
  if (value === undefined || value.trim().length === 0) return;
  const actual = normalise(value);
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `${name} does not match the onboarded project scope. ` +
      `Expected "${expected}", received "${actual}".`,
    );
  }
}

/**
 * Load credentials while deriving host/project only from the validated project config.
 * Any ambient host/project value is treated as an assertion and must match.
 */
export function loadGitLabRuntimeConfig(): GitLabRuntimeConfig {
  const configPath = resolveProjectConfigPath();
  const projectConfig = loadProjectConfig(configPath);
  const scope = deriveProjectScope(projectConfig);
  const fileValues = loadFileValues(configPath);

  assertScopeMatch('GITLAB_HOST', process.env['GITLAB_HOST'], scope.host, normaliseHost);
  assertScopeMatch('GITLAB_HOST in the environment file', fileValues['GITLAB_HOST'], scope.host,
    normaliseHost);
  assertScopeMatch('GITLAB_PROJECT', process.env['GITLAB_PROJECT'], scope.project,
    normaliseProject);
  assertScopeMatch(
    'GITLAB_PROJECT in the environment file',
    fileValues['GITLAB_PROJECT'],
    scope.project,
    normaliseProject,
  );

  const token = process.env['GITLAB_TOKEN'] ?? fileValues['GITLAB_TOKEN'];
  if (!token || token.trim().length === 0) {
    throw new Error('GITLAB_TOKEN is required after project onboarding.');
  }

  return {
    host: scope.host,
    project: scope.project,
    token,
    projectConfig,
    configPath,
    projectRoot: path.dirname(configPath),
  };
}
