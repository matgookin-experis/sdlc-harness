/**
 * review.ts — Human Review Interface (Task 25).
 *
 * Provides the `applyFinding` and `rejectFinding` functions that implement
 * the accept / accept-with-edit / reject decision loop.
 *
 * Contract:
 *  - `applyFinding(finding, { editedValue: null })` → attempts to write the
 *    original suggestion to GitLab.
 *    - If the write succeeds (adapter returns written:true): logs outcome = 'accepted'.
 *    - If the write fails  (adapter returns written:false): logs outcome = 'failed'.
 *  - `applyFinding(finding, { editedValue: '...' })` → attempts to write the
 *    edited value to GitLab.
 *    - If the write succeeds: logs outcome = 'edited'.
 *    - If the write fails:    logs outcome = 'failed'.
 *  - For non-writable findings (advisory-only or report-only), the user intent
 *    ('accepted' / 'edited') is logged directly because no write is attempted.
 *  - `rejectFinding(finding)` → does NOT write to GitLab; logs outcome = 'rejected'.
 *  - Skip is NOT handled here — skip is neutral and must not be logged.
 *
 * Finding types accepted:
 *  - AgentFinding (AC, AM, ST, COV agents) — written via the GitLab writer adapter.
 *  - DependencyFinding (DEP agent) — written through GitLab's issue-links API.
 *
 * Action-specific write behaviour:
 *  - 'draft_ac'         — appends the AC text to the issue description.
 *  - 'state_transition' — the suggested state must be applied via a scoped label
 *                         swap; the adapter receives the target state name.
 *  - 'dependency_link'  — creates the proposed blocks / relates-to link.
 *  - 'missing_coverage' — report-only advisory; never written to GitLab.
 *  - 'rewrite_desc'     — replaces the description once the drafter has written it.
 *
 * Conflict detection:
 *  When `applyFinding` is called for an issue that already has a pending
 *  decision in the current session (tracked in memory), it logs a warning but
 *  still proceeds. For the full conflict-surfacing UX the SKILL.md runtime
 *  instructions direct Bob to detect multiple findings on the same issue and
 *  present them to the user before calling these functions.
 *
 * Writer:
 *  The module uses `defaultWriterAdapter` by default. Pass an explicit adapter
 *  (e.g. the stub) in tests to avoid live GitLab calls.
 */

import type { AgentFinding, AnyFinding, DependencyFinding, ReviewOptions, ReviewResult, TelemetryEntry } from '../models';
import type { GitLabWriterAdapter } from './gitlab-writer-adapter';
import { defaultWriterAdapter } from './gitlab-writer-adapter';
import { appendTelemetry } from './telemetry';

// ---------------------------------------------------------------------------
// In-session conflict tracking
// ---------------------------------------------------------------------------

/** Tracks which issue IIDs have already had a decision applied in this session. */
const _appliedInSession = new Set<number>();

/** Reset the session tracker — used in tests to isolate runs. */
export function _resetSessionTracker(): void {
  _appliedInSession.clear();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type guard — true when the finding is a DependencyFinding. */
function isDependencyFinding(f: AnyFinding): f is DependencyFinding {
  return (f as DependencyFinding).sourceIid !== undefined;
}

/**
 * Derive the set of fields that were modified from the finding action.
 * Used for telemetry when the user edits the suggestion.
 */
function editedFieldsFor(finding: AnyFinding): string[] {
  if (isDependencyFinding(finding)) return [];
  switch ((finding as AgentFinding).action) {
    case 'draft_ac':         return ['description'];
    case 'rewrite_desc':     return ['description'];
    case 'state_transition': return ['state'];
    case 'missing_coverage': return [];
    default:                 return [];
  }
}

/**
 * Returns true when the finding's action allows a write to GitLab.
 * Coverage findings remain report-only. All other accepted findings have a
 * concrete GitLab write path, including dependency links.
 */
function isWritable(finding: AnyFinding): boolean {
  if (isDependencyFinding(finding)) return true;
  const action = (finding as AgentFinding).action;
  return action === 'draft_ac' || action === 'rewrite_desc' || action === 'state_transition';
}

// ---------------------------------------------------------------------------
// applyFinding
// ---------------------------------------------------------------------------

/**
 * Apply an agent finding — with or without an edit — and log the outcome.
 *
 * Accepts both AgentFinding and DependencyFinding (AnyFinding).
 * Coverage findings are advisory-only; all other findings are written.
 *
 * @param finding   The original agent finding to act on.
 * @param options   `editedValue` is null for a straight accept; a non-null
 *                  string means the user provided an edited value.
 * @param adapter   GitLab writer adapter (defaults to defaultWriterAdapter).
 */
export async function applyFinding(
  finding: AnyFinding,
  options: ReviewOptions,
  adapter: GitLabWriterAdapter = defaultWriterAdapter
): Promise<ReviewResult> {
  // Agents hand over a brief, not prose. If the brief is still attached the drafter
  // never ran and suggestedValue is a placeholder; writing it would put filler on the
  // issue and log it as a success. An edited value means a human supplied the text.
  if (
    !isDependencyFinding(finding) &&
    (finding as AgentFinding).draft &&
    options.editedValue === null
  ) {
    const iid = (finding as AgentFinding).issueIid;
    throw new Error(
      `Finding for issue #${iid} has not been drafted. Replace suggestedValue with the ` +
        `drafted text and clear the draft field before applying.`
    );
  }

  // User's intent — resolved against writeResult.written below for writable findings.
  const userIntent: 'accepted' | 'edited' =
    options.editedValue !== null ? 'edited' : 'accepted';

  // Resolve the issue IID for conflict tracking and telemetry
  const issueIid = isDependencyFinding(finding)
    ? finding.sourceIid
    : (finding as AgentFinding).issueIid;

  // Conflict detection (in-session)
  if (_appliedInSession.has(issueIid)) {
    process.stderr.write(
      `[sdlc-harness] Warning: a decision was already applied to issue #${issueIid} this session.\n`
    );
  }

  // Attempt the write only for writable actions; reconcile outcome against the result.
  let gitlabWriteCalled = false;
  let writtenValue: string | undefined;
  let writeError: string | undefined;
  let outcome: 'accepted' | 'edited' | 'failed';

  if (isWritable(finding)) {
    const valueToWrite = options.editedValue ?? (
      isDependencyFinding(finding)
        ? finding.suggestedLinkType
        : (finding as AgentFinding).suggestedValue
    );
    const writeResult = await adapter.applyFindingToGitLab(
      finding,
      valueToWrite
    );
    gitlabWriteCalled = writeResult.written;
    if (writeResult.written) {
      // Write reached GitLab — honour the user's intent.
      outcome = userIntent;
      writtenValue = writeResult.value;
    } else {
      // Write did NOT reach GitLab — record as 'failed' so the acceptance-rate
      // denominator is not inflated by writes that never happened.
      outcome = 'failed';
      writeError = writeResult.error;
    }
  } else {
    // Non-writable findings (advisory / report-only / dependency): no write is
    // attempted, so the user's intent is the outcome directly.
    outcome = userIntent;
  }

  _appliedInSession.add(issueIid);

  // Build telemetry entry — derive editedFields from the finding action.
  const agentTag = isDependencyFinding(finding) ? finding.agent : (finding as AgentFinding).agent;
  const action   = isDependencyFinding(finding)
    ? 'dependency_link'
    : (finding as AgentFinding).action;

  const telemetryEntry: TelemetryEntry = {
    timestamp: new Date().toISOString(),
    agent: agentTag,
    issueIid,
    action,
    outcome,
    // editedFields is meaningful only when the write actually landed.
    editedFields: outcome === 'edited' ? editedFieldsFor(finding) : [],
  };

  await appendTelemetry(telemetryEntry);

  return {
    gitlabWriteCalled,
    writtenValue,
    error: writeError,
    telemetryEntry,
  };
}

// ---------------------------------------------------------------------------
// rejectFinding
// ---------------------------------------------------------------------------

/**
 * Reject an agent finding — does NOT write to GitLab, logs the rejection.
 *
 * @param finding   The finding to reject (AgentFinding or DependencyFinding).
 */
export async function rejectFinding(
  finding: AnyFinding
): Promise<ReviewResult> {
  const issueIid = isDependencyFinding(finding)
    ? finding.sourceIid
    : (finding as AgentFinding).issueIid;
  const agentTag = isDependencyFinding(finding) ? finding.agent : (finding as AgentFinding).agent;
  const action   = isDependencyFinding(finding)
    ? 'dependency_link'
    : (finding as AgentFinding).action;

  const telemetryEntry: TelemetryEntry = {
    timestamp: new Date().toISOString(),
    agent: agentTag,
    issueIid,
    action,
    outcome: 'rejected',
    editedFields: [],
  };

  await appendTelemetry(telemetryEntry);

  return {
    gitlabWriteCalled: false,
    telemetryEntry,
  };
}
