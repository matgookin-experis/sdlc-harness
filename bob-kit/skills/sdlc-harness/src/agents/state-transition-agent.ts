/** Propose one legal workflow edge based on merge-request activity. */

import { MR_ACTIVITY_HORIZON_DAYS } from '../models';
import type { AgentFinding, IssueInput, MRInput, ProjectConfig } from '../models';

export type WorkflowConcept = 'open' | 'inProgress' | 'inReview' | 'done';

type ActivitySignal = 'mr_merged' | 'mr_open' | 'none';

const STATE_ALIASES: Record<WorkflowConcept, RegExp[]> = {
  open: [/^open$/i, /^backlog$/i, /^to do$/i, /^todo$/i, /^new$/i],
  inProgress: [/^in progress$/i, /^doing$/i, /^active$/i, /^development$/i, /^wip$/i],
  inReview: [/^in review$/i, /^review$/i, /^code review$/i, /^verification$/i],
  done: [
    /^done$/i,
    /^closed$/i,
    /^complete$/i,
    /^completed$/i,
    /^resolved$/i,
    /^shipped$/i,
  ],
};

const SIGNAL_CONCEPT: Record<Exclude<ActivitySignal, 'none'>, WorkflowConcept> = {
  mr_merged: 'inReview',
  mr_open: 'inProgress',
};

/** Infer one workflow concept only when exactly one configured state matches. */
export function inferStateForConcept(
  states: string[],
  concept: WorkflowConcept,
): string | null {
  const matches = states.filter((state) => (
    STATE_ALIASES[concept].some((alias) => alias.test(state))
  ));
  return matches.length === 1 ? matches[0] : null;
}

/** Resolve a semantic workflow concept to one configured state. */
export function resolveStateForConcept(
  config: ProjectConfig,
  concept: WorkflowConcept,
): string | null {
  const explicit = config.stateMapping?.[concept];
  if (explicit) return explicit;
  return inferStateForConcept(config.workflowStates, concept);
}

/** Derive the current workflow state from labels, then GitLab opened/closed as fallback. */
export function deriveCurrentWorkflowState(
  issue: Pick<IssueInput, 'labels' | 'state'>,
  config: ProjectConfig,
): string | null {
  const labels = new Set(issue.labels.map((label) => label.toLowerCase()));
  const labelledStates = config.workflowStates.filter((state) => labels.has(state.toLowerCase()));
  if (labelledStates.length === 1) return labelledStates[0];
  if (labelledStates.length > 1) return null;

  const direct = config.workflowStates.find(
    (state) => state.toLowerCase() === issue.state.toLowerCase(),
  );
  if (direct) return direct;
  if (issue.state.toLowerCase() === 'opened') return resolveStateForConcept(config, 'open');
  if (issue.state.toLowerCase() === 'closed') return resolveStateForConcept(config, 'done');
  return null;
}

/** Return true only when the configured graph contains the exact edge. */
export function isDirectTransition(
  from: string,
  target: string,
  config: ProjectConfig,
): boolean {
  return (config.transitionRules[from] ?? []).some(
    (candidate) => candidate.toLowerCase() === target.toLowerCase(),
  );
}

/** Return true when timestamped MR activity is recent and newer than the issue. */
function isFreshActivity(mr: MRInput, issue: IssueInput, now: Date): boolean {
  const horizon = now.getTime() - MR_ACTIVITY_HORIZON_DAYS * 24 * 60 * 60 * 1000;
  if (mr.updatedAt !== undefined) {
    const updatedAt = Date.parse(mr.updatedAt);
    if (!Number.isFinite(updatedAt) || updatedAt < horizon || updatedAt > now.getTime()) {
      return false;
    }
  }
  if (mr.state.toLowerCase() !== 'merged') return true;
  if (mr.mergedAt === undefined || mr.mergedAt === null) {
    return mr.updatedAt === undefined;
  }
  const mergedAt = Date.parse(mr.mergedAt);
  if (!Number.isFinite(mergedAt) || mergedAt < horizon || mergedAt > now.getTime()) {
    return false;
  }
  if (issue.updatedAt === undefined) return true;
  const issueUpdatedAt = Date.parse(issue.updatedAt);
  return Number.isFinite(issueUpdatedAt) && mergedAt >= issueUpdatedAt;
}

/** Derive the strongest fresh activity signal from linked merge requests. */
function deriveSignal(issue: IssueInput, mrs: MRInput[], now: Date): ActivitySignal {
  const fresh = mrs.filter((mr) => isFreshActivity(mr, issue, now));
  if (fresh.some((mr) => mr.state.toLowerCase() === 'merged')) return 'mr_merged';
  if (fresh.some((mr) => mr.state.toLowerCase() === 'opened')) return 'mr_open';
  return 'none';
}

/**
 * Find the first edge on a path to the desired state. The returned transition
 * is always direct even when the desired state is several workflow steps away.
 */
function nextDirectState(
  current: string,
  desired: string,
  config: ProjectConfig,
): string | null {
  const directTargets = config.transitionRules[current] ?? [];
  const direct = directTargets.find(
    (target) => target.toLowerCase() === desired.toLowerCase(),
  );
  if (direct) return direct;

  const queue = directTargets.map((state) => ({ state, first: state }));
  const visited = new Set<string>([current.toLowerCase()]);
  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry) break;
    const key = entry.state.toLowerCase();
    if (visited.has(key)) continue;
    visited.add(key);
    if (key === desired.toLowerCase()) return entry.first;
    for (const target of config.transitionRules[entry.state] ?? []) {
      queue.push({ state: target, first: entry.first });
    }
  }
  return null;
}

/** Run the state-transition agent for one issue. */
export async function runStateTransitionAgent(
  issue: IssueInput,
  mrs: MRInput[],
  config: ProjectConfig,
  now = new Date(),
): Promise<AgentFinding | null> {
  const signal = deriveSignal(issue, mrs, now);
  if (signal === 'none') return null;

  const current = deriveCurrentWorkflowState(issue, config);
  if (!current) return null;
  const desired = resolveStateForConcept(config, SIGNAL_CONCEPT[signal]);
  if (!desired || current.toLowerCase() === desired.toLowerCase()) return null;

  const next = nextDirectState(current, desired, config);
  if (!next || !isDirectTransition(current, next, config)) return null;
  const signalDescription = signal === 'mr_merged'
    ? 'a linked merge request was merged'
    : 'a linked merge request is open';

  return {
    agent: 'ST',
    issueIid: issue.iid,
    action: 'state_transition',
    suggestedValue: next,
    reason:
      `Issue is currently "${current}" but ${signalDescription}. ` +
      `"${next}" is the next direct configured transition toward "${desired}".`,
  };
}
