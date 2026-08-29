/** Read-only audit orchestration for Bob's drafting and review loop. */

import * as fs from 'fs';
import * as path from 'path';
import { runAcAgent } from '../agents/ac-agent';
import { runAmbiguityAgent } from '../agents/ambiguity-agent';
import { runCoverageAgent } from '../agents/coverage-agent';
import { runDependencyAgent } from '../agents/dependency-agent';
import { runStateTransitionAgent } from '../agents/state-transition-agent';
import { MR_ACTIVITY_HORIZON_DAYS } from '../models';
import type {
  AgentTag,
  AnyFinding,
  AuditFinding,
  AuditResult,
  AuditReviewGroup,
  MRInput,
} from '../models';
import { createGitLabRestReaderAdapter } from './gitlab-reader-adapter';
import type { GitLabReaderAdapter } from './gitlab-reader-adapter';
import { loadGitLabRuntimeConfig } from './gitlab-runtime';
import type { GitLabRuntimeConfig } from './gitlab-runtime';

export interface AuditOptions {
  runtimeConfig?: GitLabRuntimeConfig;
  reader?: GitLabReaderAdapter;
  rootDirectory?: string;
  now?: () => Date;
}

export interface CoverageScanLimits {
  maxFiles?: number;
  maxFileBytes?: number;
}

export const MAX_COVERAGE_SCAN_FILES = 10_000;
export const MAX_COVERAGE_FILE_BYTES = 1_048_576;

interface CoverageScanState {
  count: number;
  maxFiles: number;
  seen: Set<string>;
}

/** Escape a literal character for use in a regular expression. */
function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

/** Compile the supported *, **, and ? glob syntax against repo-relative paths. */
function globRegExp(pattern: string): RegExp {
  let source = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === '*') {
      const isDouble = pattern[index + 1] === '*';
      if (isDouble) {
        const hasSlash = pattern[index + 2] === '/';
        source += hasSlash ? '(?:.*/)?' : '.*';
        index += hasSlash ? 2 : 1;
        continue;
      }
      source += '[^/]*';
      continue;
    }
    if (character === '?') {
      source += '[^/]';
      continue;
    }
    source += escapeRegExp(character);
  }
  return new RegExp(`${source}$`);
}

/** Return true when a resolved path is inside the resolved project root. */
function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/** Read link metadata while treating only a genuinely absent path as missing. */
function lstatIfPresent(filePath: string): fs.Stats | null {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/** Recursively list bounded regular files while rejecting every encountered symlink. */
function listFiles(
  directory: string,
  root: string,
  ignored: Set<string>,
  state: CoverageScanState,
): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Coverage scan rejects symlinked path: ${absolutePath}`);
    }
    const realPath = fs.realpathSync(absolutePath);
    if (!isWithinRoot(root, realPath)) {
      throw new Error(`Coverage scan path escapes the project root: ${absolutePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...listFiles(realPath, root, ignored, state));
      continue;
    }
    if (!entry.isFile() || state.seen.has(realPath)) continue;
    state.seen.add(realPath);
    state.count += 1;
    if (state.count > state.maxFiles) {
      throw new Error(`Coverage scan exceeds the ${state.maxFiles} file limit.`);
    }
    files.push(path.relative(root, realPath).replace(/\\/g, '/'));
  }
  return files;
}

/** Return the non-glob directory prefix used to limit traversal. */
function patternRoot(pattern: string): string {
  const wildcard = pattern.search(/[?*]/);
  const prefix = wildcard < 0 ? pattern : pattern.slice(0, wildcard);
  const directory = prefix.endsWith('/') ? prefix.slice(0, -1) : path.posix.dirname(prefix);
  return directory === '.' ? '' : directory;
}

/** Read only files selected by configured testFilePatterns. */
export function scanConfiguredTestFiles(
  rootDirectory: string,
  patterns: string[],
  limits: CoverageScanLimits = {},
): Record<string, string> {
  if (!fs.existsSync(rootDirectory)) {
    throw new Error(`Coverage scan root does not exist: ${rootDirectory}`);
  }
  const rootStat = fs.lstatSync(rootDirectory);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Coverage scan root must not be a symlink: ${rootDirectory}`);
  }
  if (!rootStat.isDirectory()) throw new Error(`Coverage scan root is not a directory.`);
  const realRoot = fs.realpathSync(rootDirectory);
  const maxFiles = limits.maxFiles ?? MAX_COVERAGE_SCAN_FILES;
  const maxFileBytes = limits.maxFileBytes ?? MAX_COVERAGE_FILE_BYTES;
  if (!Number.isInteger(maxFiles) || maxFiles <= 0 ||
      !Number.isInteger(maxFileBytes) || maxFileBytes <= 0) {
    throw new Error('Coverage scan limits must be positive integers.');
  }
  const normalizedPatterns = patterns.map(
    (pattern) => pattern.replace(/\\/g, '/').replace(/^\.\/+/, ''),
  );
  if (normalizedPatterns.some(
    (pattern) => path.isAbsolute(pattern) || path.win32.isAbsolute(pattern) ||
      pattern.split('/').includes('..'),
  )) {
    throw new Error('Coverage patterns must stay within the project root.');
  }
  const matchers = normalizedPatterns.map(globRegExp);
  const explicitSegments = new Set(normalizedPatterns.flatMap((pattern) => pattern.split('/')));
  const ignored = new Set(['.git']);
  if (!explicitSegments.has('node_modules')) ignored.add('node_modules');
  if (!explicitSegments.has('dist')) ignored.add('dist');
  if (!explicitSegments.has('coverage')) ignored.add('coverage');
  const roots = new Set(normalizedPatterns.map(patternRoot));
  const contents: Record<string, string> = {};
  const candidates = new Set<string>();
  const state: CoverageScanState = { count: 0, maxFiles, seen: new Set() };
  for (const relativeRoot of roots) {
    const absoluteRoot = path.resolve(realRoot, relativeRoot);
    if (!isWithinRoot(realRoot, absoluteRoot)) {
      throw new Error(`Coverage pattern root escapes the project: ${relativeRoot}`);
    }
    const patternRootStat = lstatIfPresent(absoluteRoot);
    if (!patternRootStat) continue;
    if (patternRootStat.isSymbolicLink()) {
      throw new Error(`Coverage pattern root must not be a symlink: ${relativeRoot}`);
    }
    if (!patternRootStat.isDirectory()) continue;
    const realPatternRoot = fs.realpathSync(absoluteRoot);
    if (realPatternRoot !== absoluteRoot || !isWithinRoot(realRoot, realPatternRoot)) {
      throw new Error(`Coverage pattern root must resolve inside the project: ${relativeRoot}`);
    }
    for (const relativePath of listFiles(realPatternRoot, realRoot, ignored, state)) {
      candidates.add(relativePath);
    }
  }
  for (const relativePath of [...candidates].sort()) {
    if (!matchers.some((matcher) => matcher.test(relativePath))) continue;
    const absolutePath = path.join(realRoot, relativePath);
    const fileStat = fs.lstatSync(absolutePath);
    if (fileStat.isSymbolicLink()) {
      throw new Error(`Coverage file must not be a symlink: ${relativePath}`);
    }
    const realPath = fs.realpathSync(absolutePath);
    if (!isWithinRoot(realRoot, realPath)) {
      throw new Error(`Coverage file resolves outside the project: ${relativePath}`);
    }
    const descriptor = fs.openSync(
      realPath,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    );
    try {
      const openedStat = fs.fstatSync(descriptor);
      if (!openedStat.isFile()) throw new Error(`Coverage path is not a file: ${relativePath}`);
      if (openedStat.size > maxFileBytes) {
        throw new Error(
          `Coverage file ${relativePath} exceeds the ${maxFileBytes} byte limit.`,
        );
      }
      contents[relativePath] = fs.readFileSync(descriptor, { encoding: 'utf8' });
    } finally {
      fs.closeSync(descriptor);
    }
  }
  return contents;
}

/** Return true only for a local or exact onboarded-project issue reference. */
export function referencesIssue(
  mr: MRInput,
  issueIid: number,
  projectPath: string,
  projectUrl: string,
): boolean {
  const local = new RegExp(`(?:^|[\\s(:;,\\[{])#${issueIid}\\b`, 'i');
  const scoped = new RegExp(
    `(?:^|[^a-z0-9_./-])${escapeRegExp(projectPath)}#${issueIid}\\b`,
    'i',
  );
  const issueUrl = new RegExp(
    `${escapeRegExp(projectUrl)}/-/issues/${issueIid}(?:\\b|$)`,
    'i',
  );
  const text = `${mr.title}\n${mr.description ?? ''}`;
  return local.test(text) || scoped.test(text) || issueUrl.test(text);
}

/** Reject stale, future, unscoped, or non-actionable MR activity. */
export function isRelevantMergeRequest(
  mr: MRInput,
  issue: { iid: number; updatedAt?: string },
  projectPath: string,
  projectUrl: string,
  horizon: Date,
  now: Date,
): boolean {
  if (!referencesIssue(mr, issue.iid, projectPath, projectUrl)) return false;
  const state = mr.state.toLowerCase();
  if (state !== 'opened' && state !== 'merged') return false;
  const updatedAt = mr.updatedAt === undefined ? Number.NaN : Date.parse(mr.updatedAt);
  if (!Number.isFinite(updatedAt) || updatedAt < horizon.getTime() || updatedAt > now.getTime()) {
    return false;
  }
  if (state !== 'merged') return true;

  const mergedAt = mr.mergedAt === null || mr.mergedAt === undefined
    ? Number.NaN
    : Date.parse(mr.mergedAt);
  if (!Number.isFinite(mergedAt) || mergedAt < horizon.getTime() || mergedAt > now.getTime()) {
    return false;
  }
  if (issue.updatedAt === undefined) return true;
  const issueUpdatedAt = Date.parse(issue.updatedAt);
  return Number.isFinite(issueUpdatedAt) && mergedAt >= issueUpdatedAt;
}

/** Build a stable identifier for one finding in an audit payload. */
function findingId(finding: AnyFinding): string {
  if (finding.agent === 'DEP') {
    return `DEP:${finding.sourceIid}:${finding.targetIid}:${finding.suggestedLinkType}`;
  }
  return `${finding.agent}:${finding.issueIid}:${finding.action}`;
}

/** Return every issue affected by a finding. */
function affectedIssues(finding: AnyFinding): number[] {
  return finding.agent === 'DEP'
    ? [finding.sourceIid, finding.targetIid]
    : [finding.issueIid];
}

/** Identify ordering conflicts among findings that affect the same issue. */
function conflictReasons(findings: AnyFinding[]): string[] {
  const agents = new Set(findings.map((finding) => finding.agent));
  const reasons: string[] = [];
  if (agents.has('AC') && agents.has('AM')) {
    reasons.push('Apply AM, rerun audit, then draft and apply AC from the updated description.');
  }
  if (agents.has('DEP') && agents.has('ST')) {
    reasons.push('Dependency and workflow-state findings may imply incompatible readiness.');
  }
  return reasons;
}

/** Group finding IDs by affected issue and annotate known conflicts. */
function buildReviewGroups(findings: AuditFinding[]): AuditReviewGroup[] {
  const groups = new Map<number, AuditFinding[]>();
  for (const entry of findings) {
    for (const issueIid of affectedIssues(entry.finding)) {
      const group = groups.get(issueIid) ?? [];
      group.push(entry);
      groups.set(issueIid, group);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([issueIid, entries]) => {
      const reasons = conflictReasons(entries.map((entry) => entry.finding));
      return {
        issueIid,
        findingIds: entries.map((entry) => entry.id),
        hasConflict: reasons.length > 0,
        conflictReasons: reasons,
      };
    });
}

/** Fetch scoped data and run every configured agent without making GitLab writes. */
export async function runAudit(options: AuditOptions = {}): Promise<AuditResult> {
  const runtime = options.runtimeConfig ?? loadGitLabRuntimeConfig();
  const now = (options.now ?? (() => new Date()))();
  const horizon = new Date(
    now.getTime() - MR_ACTIVITY_HORIZON_DAYS * 24 * 60 * 60 * 1000,
  );
  const reader = options.reader ?? createGitLabRestReaderAdapter(
    globalThis.fetch,
    () => runtime,
  );
  const [issues, mergeRequests] = await Promise.all([
    reader.listOpenIssues(),
    reader.listMergeRequests(horizon.toISOString()),
  ]);
  const config = runtime.projectConfig;

  const issueFindings = await Promise.all(issues.map(async (issue): Promise<AnyFinding[]> => {
    const linkedMrs = mergeRequests.filter((mr) => isRelevantMergeRequest(
      mr,
      issue,
      runtime.project,
      config.projectUrl,
      horizon,
      now,
    ));
    const [ac, ambiguity, state] = await Promise.all([
      runAcAgent(issue, config),
      runAmbiguityAgent(issue, config),
      runStateTransitionAgent(issue, linkedMrs, config, now),
    ]);
    return [ac, ambiguity, state].filter(
      (finding): finding is Exclude<typeof finding, null> => finding !== null,
    );
  }));
  const findings: AnyFinding[] = issueFindings.flat();
  findings.push(...await runDependencyAgent(issues, config));

  const agentsRun: AgentTag[] = ['AC', 'AM', 'DEP', 'ST'];
  let coverageFilesScanned: string[] | undefined;
  if (config.coverage?.enabled) {
    const root = options.rootDirectory ?? runtime.projectRoot;
    const contents = scanConfiguredTestFiles(root, config.coverage.testFilePatterns);
    coverageFilesScanned = Object.keys(contents).sort();
    findings.push(...await runCoverageAgent(issues, contents, config));
    agentsRun.push('COV');
  }

  const auditFindings = findings.map((finding) => ({ id: findingId(finding), finding }));
  return {
    timestamp: now.toISOString(),
    scope: { provider: config.provider, projectUrl: config.projectUrl },
    agentsRun,
    issues,
    mergeRequestCount: mergeRequests.length,
    mergeRequestHorizonStart: horizon.toISOString(),
    ...(coverageFilesScanned === undefined ? {} : { coverageFilesScanned }),
    findings: auditFindings,
    reviewGroups: buildReviewGroups(auditFindings),
  };
}
