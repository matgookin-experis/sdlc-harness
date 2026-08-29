/**
 * index.ts — barrel export for the sdlc-harness skill modules.
 *
 * Consumers can import from 'sdlc-harness-skill' (once published) or
 * from the individual module paths directly.
 */

// Models
export { MR_ACTIVITY_HORIZON_DAYS } from './models';
export type {
  ProjectConfig,
  TransitionRules,
  StateMapping,
  IssueInput,
  MRInput,
  AgentTag,
  AgentFinding,
  DependencyFinding,
  AnyFinding,
  ReviewOutcome,
  ReviewOptions,
  ReviewResult,
  TelemetryEntry,
  CoverageConfig,
  CoverageFinding,
  AuditFinding,
  AuditReviewGroup,
  AuditResult,
} from './models';

// Skill modules
export {
  onboard,
  validateProjectConfig,
  loadProjectConfig,
  persistProjectConfig,
  resolveProjectConfigPath,
} from './skill/onboard';
export type { OnboardInput, OnboardResult } from './skill/onboard';

export {
  isRelevantMergeRequest,
  MAX_COVERAGE_FILE_BYTES,
  MAX_COVERAGE_SCAN_FILES,
  referencesIssue,
  runAudit,
  scanConfiguredTestFiles,
} from './skill/audit';
export type { AuditOptions, CoverageScanLimits } from './skill/audit';

export {
  createGitLabRestReaderAdapter,
  defaultReaderAdapter,
  MAX_GITLAB_ITEMS,
  MAX_GITLAB_PAGES,
} from './skill/gitlab-reader-adapter';
export type {
  GitLabReaderAdapter,
  GitLabReaderLimits,
} from './skill/gitlab-reader-adapter';

export {
  assertProjectRelativeEndpoint,
  createGitLabRequest,
  fetchWithDeadline,
  GITLAB_HTTP_TIMEOUT_MS,
  safeGitLabError,
} from './skill/gitlab-rest';
export type { FetchFn } from './skill/gitlab-rest';

export { deriveProjectScope, loadGitLabRuntimeConfig } from './skill/gitlab-runtime';
export type { GitLabRuntimeConfig } from './skill/gitlab-runtime';

export { applyFinding, rejectFinding, _resetSessionTracker } from './skill/review';

export {
  appendTelemetry,
  readTelemetry,
  computeAcceptanceRate,
  resolveTelemetryPath,
} from './skill/telemetry';
export type { AcceptanceRateSummary } from './skill/telemetry';

export {
  defaultWriterAdapter,
  stubWriterAdapter,
} from './skill/gitlab-writer-adapter';
export type {
  GitLabWriterAdapter,
  GitLabWriteResult,
} from './skill/gitlab-writer-adapter';

export { parseDecisionPayload, parseFinding } from './skill/review-payload';
export type { DecisionPayload } from './skill/review-payload';

export { runCli } from './skill/cli-controller';
export type { OutputWriter } from './skill/cli-controller';

// Agents
export { runAcAgent, hasAcceptanceCriteria } from './agents/ac-agent';
export { runAmbiguityAgent } from './agents/ambiguity-agent';
export { runDependencyAgent } from './agents/dependency-agent';
export {
  runStateTransitionAgent,
  deriveCurrentWorkflowState,
  isDirectTransition,
  inferStateForConcept,
  resolveStateForConcept,
} from './agents/state-transition-agent';
export type { WorkflowConcept } from './agents/state-transition-agent';
export { runCoverageAgent, extractIssueRefs } from './agents/coverage-agent';
