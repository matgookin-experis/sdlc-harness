/**
 * onboard.ts — guided onboarding for the sdlc-harness skill (Task 18).
 *
 * Validation is deterministic. Persistence is explicit and atomic through
 * `persistProjectConfig` so the CLI cannot leave a partially written config.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { inferStateForConcept } from '../agents/state-transition-agent';
import type { WorkflowConcept } from '../agents/state-transition-agent';
import type {
  CoverageConfig,
  ProjectConfig,
  StateMapping,
  TransitionRules,
} from '../models';

// ---------------------------------------------------------------------------
// Input / output shapes
// ---------------------------------------------------------------------------

export interface OnboardInput {
  projectUrl: string;
  workItemTypes: string[];
  workflowStates: string[];
  transitionRules: TransitionRules;
  /** Enable Premium/Ultimate directional blocking issue links. Defaults to false. */
  blockingIssueLinks?: boolean;
  /** Optional explicit aliases for custom workflow state names. */
  stateMapping?: StateMapping;
  /** Optional — pass only when the user explicitly opts in to coverage tracking (Task 24). */
  coverage?: CoverageConfig;
}

export interface OnboardResult {
  ok: boolean;
  config?: ProjectConfig;
  error?: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/** Return true for a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validate and canonicalize a GitLab project URL. */
function normaliseProjectUrl(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error('projectUrl is required and must not be empty.');
  }

  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('projectUrl must be a valid http or https URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('projectUrl must use http or https.');
  }
  if (url.username || url.password) {
    throw new Error('projectUrl must not contain credentials.');
  }
  if (url.search) {
    throw new Error('projectUrl must not contain a query string.');
  }
  if (url.hash) {
    throw new Error('projectUrl must not contain a fragment.');
  }

  const segments = url.pathname.split('/').filter((segment) => segment.length > 0);
  if (segments.length < 2) {
    throw new Error('projectUrl must include a GitLab namespace and project path.');
  }
  const projectIndex = segments.length - 1;
  segments[projectIndex] = segments[projectIndex].replace(/\.git$/i, '');
  if (segments[projectIndex].length === 0) {
    throw new Error('projectUrl must include a GitLab namespace and project path.');
  }

  return `${url.origin}/${segments.join('/')}`;
}

/** Trim and case-insensitively deduplicate a required name list. */
function normaliseNames(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must be a non-empty array of strings.`);
  }

  const names: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error(`${field} must not contain blank entries.`);
    }
    const name = entry.trim();
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  return names;
}

/** Validate transition arrays and canonicalize every direct edge. */
function normaliseTransitionRules(value: unknown, states: string[]): TransitionRules {
  if (!isRecord(value)) {
    throw new Error('transitionRules must be an object whose values are arrays.');
  }

  const names = new Map(states.map((state) => [state.toLowerCase(), state]));
  const rules: TransitionRules = {};
  for (const [rawFrom, rawTargets] of Object.entries(value)) {
    const from = names.get(rawFrom.trim().toLowerCase());
    if (!from) {
      throw new Error(
        `transitionRules contains unknown source state "${rawFrom}". ` +
        `Valid states: ${states.join(', ')}.`,
      );
    }

    if (!Array.isArray(rawTargets)) {
      throw new Error(`transitionRules[${rawFrom}] must be an array of state names.`);
    }

    const targets = rules[from] ?? [];
    const seen = new Set(targets.map((target) => target.toLowerCase()));
    for (const rawTarget of rawTargets) {
      if (typeof rawTarget !== 'string' || rawTarget.trim().length === 0) {
        throw new Error(`transitionRules[${rawFrom}] must not contain blank entries.`);
      }
      const target = names.get(rawTarget.trim().toLowerCase());
      if (!target) {
        throw new Error(
          `transitionRules[${rawFrom}] references unknown target state "${rawTarget}". ` +
          `Valid states: ${states.join(', ')}.`,
        );
      }
      if (target === from) {
        throw new Error(`transitionRules[${rawFrom}] must not contain a self-transition.`);
      }
      if (seen.has(target.toLowerCase())) continue;
      seen.add(target.toLowerCase());
      targets.push(target);
    }
    rules[from] = targets;
  }

  return rules;
}

/** Validate optional workflow-concept mappings against configured states. */
function normaliseStateMapping(value: unknown, states: string[]): StateMapping | undefined {
  if (value !== undefined && !isRecord(value)) {
    throw new Error('stateMapping must be an object.');
  }

  const keys: WorkflowConcept[] = ['open', 'inProgress', 'inReview', 'done'];
  const source = value ?? {};
  const unknownKeys = Object.keys(source).filter(
    (key) => !keys.includes(key as keyof StateMapping),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`stateMapping contains unknown key "${unknownKeys[0]}".`);
  }
  const names = new Map(states.map((state) => [state.toLowerCase(), state]));
  const mapping: StateMapping = {};
  const seen = new Set<string>();

  for (const key of keys) {
    const rawState = source[key];
    if (rawState === undefined) {
      const inferred = inferStateForConcept(states, key);
      if (!inferred) {
        throw new Error(
          `stateMapping.${key} is required because that workflow state cannot be inferred.`,
        );
      }
      if (seen.has(inferred.toLowerCase())) {
        throw new Error('Workflow concepts must resolve to distinct states.');
      }
      seen.add(inferred.toLowerCase());
      continue;
    }
    if (typeof rawState !== 'string' || rawState.trim().length === 0) {
      throw new Error(`stateMapping.${key} must be a non-blank state name.`);
    }
    const state = names.get(rawState.trim().toLowerCase());
    if (!state) {
      throw new Error(`stateMapping.${key} must reference a configured workflow state.`);
    }
    if (seen.has(state.toLowerCase())) {
      throw new Error('stateMapping entries must reference distinct workflow states.');
    }
    seen.add(state.toLowerCase());
    mapping[key] = state;
  }

  return Object.keys(mapping).length === 0 ? undefined : mapping;
}

/** Validate and normalize optional coverage scanning configuration. */
function normaliseCoverage(value: unknown): CoverageConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || typeof value['enabled'] !== 'boolean') {
    throw new Error('coverage must contain a boolean enabled value.');
  }
  if (!Array.isArray(value['testFilePatterns'])) {
    throw new Error('coverage.testFilePatterns must be an array of strings.');
  }

  const patterns: string[] = [];
  const seen = new Set<string>();
  for (const entry of value['testFilePatterns']) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error('coverage.testFilePatterns must not contain blank entries.');
    }
    const pattern = entry.trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
    if (pattern.length === 0) {
      throw new Error('coverage.testFilePatterns must not contain blank entries.');
    }
    if (path.isAbsolute(pattern) || path.win32.isAbsolute(pattern) ||
        pattern.split('/').includes('..')) {
      throw new Error('coverage.testFilePatterns must stay within the onboarded repo.');
    }
    if (seen.has(pattern)) continue;
    seen.add(pattern);
    patterns.push(pattern);
  }

  if (value['enabled'] && patterns.length === 0) {
    throw new Error('Enabled coverage requires at least one testFilePattern.');
  }

  return { enabled: value['enabled'], testFilePatterns: patterns };
}

/** Validate unknown data and return a normalized persisted configuration. */
export function validateProjectConfig(value: unknown, requireProvider = true): ProjectConfig {
  if (!isRecord(value)) throw new Error('Project configuration must be a JSON object.');
  if (requireProvider && value['provider'] !== 'gitlab') {
    throw new Error('Project configuration provider must be "gitlab".');
  }
  if (!requireProvider && value['provider'] !== undefined && value['provider'] !== 'gitlab') {
    throw new Error('Only the "gitlab" project provider is supported.');
  }

  const workItemTypes = normaliseNames(value['workItemTypes'], 'workItemTypes');
  const workflowStates = normaliseNames(value['workflowStates'], 'workflowStates');
  const transitionRules = normaliseTransitionRules(value['transitionRules'], workflowStates);
  const stateMapping = normaliseStateMapping(value['stateMapping'], workflowStates);
  const blockingIssueLinks = value['blockingIssueLinks'];
  if (blockingIssueLinks !== undefined && typeof blockingIssueLinks !== 'boolean') {
    throw new Error('blockingIssueLinks must be a boolean when provided.');
  }
  const coverage = normaliseCoverage(value['coverage']);

  return {
    provider: 'gitlab',
    projectUrl: normaliseProjectUrl(value['projectUrl']),
    workItemTypes,
    workflowStates,
    transitionRules,
    ...(blockingIssueLinks === undefined ? {} : { blockingIssueLinks }),
    ...(stateMapping === undefined ? {} : { stateMapping }),
    ...(coverage === undefined ? {} : { coverage }),
  };
}

// ---------------------------------------------------------------------------
// onboard()
// ---------------------------------------------------------------------------

/**
 * Validate onboarding input and return a typed ProjectConfig.
 *
 * This is idempotent: calling it twice with the same valid input returns the
 * same config without error. Use `persistProjectConfig` to save the result.
 */
export async function onboard(input: OnboardInput): Promise<OnboardResult> {
  try {
    return { ok: true, config: validateProjectConfig(input, false) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid project configuration.',
    };
  }
}

/** Resolve the authoritative config path for live operations. */
export function resolveProjectConfigPath(): string {
  const configuredPath = process.env['SDLC_PROJECT_CONFIG'];
  if (configuredPath) return path.resolve(configuredPath);

  const environmentPath = process.env['SDLC_ENV_FILE'];
  if (environmentPath) {
    return path.join(path.dirname(path.resolve(environmentPath)), '.sdlc-harness.json');
  }

  return path.join(process.cwd(), '.sdlc-harness.json');
}

/** Load and validate the authoritative project configuration. */
export function loadProjectConfig(filePath = resolveProjectConfigPath()): ProjectConfig {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Project is not onboarded. Run "sdlc-harness onboard <config.json>" to create ${filePath}.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown parse error';
    throw new Error(`Invalid project configuration at ${filePath}: ${detail}`);
  }

  return validateProjectConfig(value, false);
}

/** Atomically persist a validated project configuration. */
export function persistProjectConfig(
  config: ProjectConfig,
  filePath = resolveProjectConfigPath(),
): string {
  const validated = validateProjectConfig(config);
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
    throw new Error(`Project config directory does not exist: ${directory}`);
  }

  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    throw error;
  }

  return filePath;
}
