/**
 * index.ts — barrel export for the sdlc-harness skill modules.
 *
 * Consumers can import from 'sdlc-harness-skill' (once published) or
 * from the individual module paths directly.
 */

// Models
export type {
  ProjectConfig,
  TransitionRules,
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
} from './models';

// Skill modules
export { onboard } from './skill/onboard';
export type { OnboardInput, OnboardResult } from './skill/onboard';

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

// Agents
export { runAcAgent, hasAcceptanceCriteria } from './agents/ac-agent';
export { runAmbiguityAgent } from './agents/ambiguity-agent';
export { runDependencyAgent } from './agents/dependency-agent';
export { runStateTransitionAgent } from './agents/state-transition-agent';
export { runCoverageAgent, extractIssueRefs } from './agents/coverage-agent';
