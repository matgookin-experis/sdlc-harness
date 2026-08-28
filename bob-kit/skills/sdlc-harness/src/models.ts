/**
 * models.ts — shared type contracts for sdlc-harness skill agents.
 *
 * These types are the single source of truth consumed by all five agents,
 * the review interface (Task 25), and the telemetry module (Task 26).
 * No GitLab SDK dependency — plain TypeScript interfaces only.
 */

// ---------------------------------------------------------------------------
// Project configuration (persisted by onboarding, Task 18)
// ---------------------------------------------------------------------------

export interface TransitionRules {
  [fromState: string]: string[];
}

export interface ProjectConfig {
  /** GitLab project URL, e.g. "http://localhost:8080/sdlc-harness/weather-dashboard" */
  projectUrl: string;
  /** Work item types in use, e.g. ["Story", "Bug", "Task", "Epic"] */
  workItemTypes: string[];
  /** Ordered workflow states, e.g. ["Open", "In Progress", "In Review", "Done"] */
  workflowStates: string[];
  /** Valid state transitions: { "Open": ["In Progress"], ... } */
  transitionRules: TransitionRules;
}

// ---------------------------------------------------------------------------
// Lightweight issue / MR shapes (mirror the MCP server types but without the
// full GitLab schema so agents work without importing the server package)
// ---------------------------------------------------------------------------

export interface IssueInput {
  iid: number;
  title: string;
  description: string | null;
  labels: string[];
  state: string;
  assignee: unknown | null;
}

export interface MRInput {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  mergedAt?: string | null;
}

// ---------------------------------------------------------------------------
// Agent finding types
// ---------------------------------------------------------------------------

/** Discriminator tags for each agent. */
export type AgentTag = 'AC' | 'AM' | 'DEP' | 'ST' | 'COV';

/**
 * A finding produced by any single-issue agent (AC, AM, ST, COV).
 */
/**
 * What an agent hands to the drafter. Agents detect; they do not write prose.
 *
 * `context` is everything the drafter may ground the text in. `unknowns` are
 * gaps the issue does not fill — the drafter must ask about these rather than
 * invent a plausible value, which is the failure mode that makes generated
 * work items worse than no work items.
 */
export interface DraftBrief {
  task: string;
  context: Record<string, string>;
  unknowns: string[];
}

export interface AgentFinding {
  /** Agent that produced this finding. */
  agent: AgentTag;
  /** The issue this finding relates to. */
  issueIid: number;
  /**
   * Short action label for the finding type.
   *  'draft_ac'         — AC agent drafted missing acceptance criteria
   *  'rewrite_desc'     — AM agent proposed a description rewrite
   *  'state_transition' — ST agent proposed a state change
   *  'missing_coverage' — COV agent flagged an issue with no test reference
   */
  action: 'draft_ac' | 'rewrite_desc' | 'state_transition' | 'missing_coverage';
  /** The proposed new value (AC text, rewritten description, or target state). */
  suggestedValue: string;
  /**
   * Present when the text still has to be written. The drafter replaces
   * suggestedValue with its own prose and clears this field; applyFinding
   * refuses to write a finding that still carries one.
   */
  draft?: DraftBrief;
  /** Human-readable explanation of why this finding was raised. Optional. */
  reason?: string;
}

/**
 * A dependency finding produced by the dependency agent (Task 22).
 * Separate type because it spans two issues.
 */
export interface DependencyFinding {
  agent: 'DEP';
  /** Source issue IID (the one that depends on / blocks the other). */
  sourceIid: number;
  /** Target issue IID. */
  targetIid: number;
  /** Proposed link type. */
  suggestedLinkType: 'blocks' | 'relates-to';
  /** Human-readable explanation. */
  reason?: string;
  /** Confidence score in [0,1]. */
  confidence: number;
}

/** Union of all finding types surfaced to the review interface. */
export type AnyFinding = AgentFinding | DependencyFinding;

// ---------------------------------------------------------------------------
// Review interface types (Task 25)
// ---------------------------------------------------------------------------

/**
 * Outcome of a review decision.
 *  - 'accepted' — user accepted the suggestion and it was successfully written to GitLab.
 *  - 'edited'   — user edited the suggestion and it was successfully written to GitLab.
 *  - 'rejected' — user rejected the suggestion; nothing was written.
 *  - 'failed'   — user accepted or edited the suggestion but the write to GitLab failed
 *                 (adapter returned written:false). The suggestion did NOT reach GitLab.
 *                 'failed' entries are excluded from both the numerator and denominator
 *                 of acceptance-rate statistics so they do not inflate the reported rate.
 */
export type ReviewOutcome = 'accepted' | 'edited' | 'rejected' | 'failed';

export interface ReviewOptions {
  /** Provide an edited value to apply instead of the suggestion; null means use as-is. */
  editedValue: string | null;
}

export interface ReviewResult {
  /** Whether the GitLab writer adapter was called. */
  gitlabWriteCalled: boolean;
  /** The value actually written (finding's suggestion or the edited value). */
  writtenValue?: string;
  /** Telemetry entry appended for this decision. */
  telemetryEntry: TelemetryEntry;
}

// ---------------------------------------------------------------------------
// Telemetry types (Task 26)
// ---------------------------------------------------------------------------

export interface TelemetryEntry {
  /** ISO-8601 timestamp of the decision. */
  timestamp: string;
  /** Agent that produced the finding. */
  agent: AgentTag;
  /** Issue IID the finding was about. */
  issueIid: number;
  /** The action / finding type. */
  action: string;
  /** What the user decided. */
  outcome: ReviewOutcome;
  /**
   * Fields that were edited (empty array for 'accepted' / 'rejected').
   * Only 'description' is used in the current agent set.
   */
  editedFields: string[];
}

// ---------------------------------------------------------------------------
// Test-coverage linkage types (Task 24 — P1)
// ---------------------------------------------------------------------------

export interface CoverageConfig {
  /** Glob patterns for test files to scan, e.g. ["**\/*.test.ts", "tests/**\/*.ts"] */
  testFilePatterns: string[];
  /** Whether the agent is enabled (disabled by default). */
  enabled: boolean;
}

export interface CoverageFinding extends AgentFinding {
  agent: 'COV';
  action: 'missing_coverage';
}
