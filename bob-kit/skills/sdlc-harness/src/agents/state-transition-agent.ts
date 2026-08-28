/**
 * state-transition-agent.ts — State Transition Agent (Task 23).
 *
 * Correlates an issue's current state with merge-request activity and the
 * project's configured transition rules, then proposes a valid next state.
 *
 * Rules:
 *  - Only proposes a transition allowed by `config.transitionRules`.
 *  - Never proposes the same state the issue is already in.
 *  - Never writes to GitLab — proposals only.
 *  - Returns null when no signal or no valid transition is found.
 *
 * Signal mapping:
 *  - MR state "merged"  → propose "In Review" (work landed, awaiting review)
 *  - MR state "opened"  → propose "In Progress" (active development)
 *  - No linked MRs      → no signal, return null
 *
 * The agent normalises GitLab's "opened" state to "Open" for comparison
 * against the project's configured workflow states.
 */

import type { IssueInput, MRInput, ProjectConfig, AgentFinding } from '../models';

// ---------------------------------------------------------------------------
// State normalisation
// ---------------------------------------------------------------------------

/**
 * Map GitLab API state strings to the canonical configured state names.
 * GitLab uses "opened"/"closed"; the project config may use "Open"/"Done".
 */
function normaliseState(gitlabState: string, configStates: string[]): string {
  const lower = gitlabState.toLowerCase();

  // Direct case-insensitive match first
  const direct = configStates.find((s) => s.toLowerCase() === lower);
  if (direct) return direct;

  // Common alias map
  if (lower === 'opened') {
    return configStates.find((s) => /^open$/i.test(s)) ?? gitlabState;
  }
  if (lower === 'closed') {
    return configStates.find((s) => /^(done|closed|complete)/i.test(s)) ?? gitlabState;
  }

  return gitlabState;
}

// ---------------------------------------------------------------------------
// MR → activity signal
// ---------------------------------------------------------------------------

type ActivitySignal = 'mr_merged' | 'mr_open' | 'none';

/**
 * Derive the strongest activity signal from the provided MR list.
 * "merged" beats "opened" because it represents completed work.
 */
function deriveSignal(mrs: MRInput[]): ActivitySignal {
  if (mrs.some((mr) => mr.state === 'merged')) return 'mr_merged';
  if (mrs.some((mr) => mr.state === 'opened')) return 'mr_open';
  return 'none';
}

// ---------------------------------------------------------------------------
// Target state resolution
// ---------------------------------------------------------------------------

/** Signal → preferred next state (canonical name as used in config). */
const SIGNAL_TARGET: Record<ActivitySignal, string | null> = {
  mr_merged: 'In Review',
  mr_open: 'In Progress',
  none: null,
};

/**
 * BFS reachability: check if `target` state is reachable from `from` state
 * by following the configured transition rules (direct or multi-hop).
 */
function isReachable(from: string, target: string, rules: ProjectConfig['transitionRules']): boolean {
  const visited = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.toLowerCase() === target.toLowerCase()) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of rules[current] ?? []) {
      queue.push(next);
    }
  }
  return false;
}

/**
 * Return the next valid state for an issue given a signal, or null if no
 * transition makes sense. Checks direct or transitive reachability.
 */
function resolveNextState(
  currentState: string,
  signal: ActivitySignal,
  config: ProjectConfig
): string | null {
  const preferredTarget = SIGNAL_TARGET[signal];
  if (!preferredTarget) return null;

  // Check if the issue is already in the preferred target state
  if (currentState.toLowerCase() === preferredTarget.toLowerCase()) return null;

  // Find the canonical name for the preferred target in the configured states
  const canonicalTarget = config.workflowStates.find(
    (s) => s.toLowerCase() === preferredTarget.toLowerCase()
  );

  if (!canonicalTarget) return null;

  // Allow the transition if the target is directly OR transitively reachable
  const reachable = isReachable(currentState, canonicalTarget, config.transitionRules);
  if (reachable) return canonicalTarget;

  // Not reachable via rules — don't propose a transition
  return null;
}

// ---------------------------------------------------------------------------
// Agent entry point
// ---------------------------------------------------------------------------

/**
 * Run the state-transition agent for a single issue.
 *
 * @param issue   The issue to evaluate.
 * @param mrs     All MRs linked or related to this issue (caller responsibility).
 * @param config  Project configuration with transition rules.
 * @returns       AgentFinding proposing a state transition, or null.
 */
export async function runStateTransitionAgent(
  issue: IssueInput,
  mrs: MRInput[],
  config: ProjectConfig
): Promise<AgentFinding | null> {
  const signal = deriveSignal(mrs);
  if (signal === 'none') return null;

  const currentNorm = normaliseState(issue.state, config.workflowStates);
  const nextState = resolveNextState(currentNorm, signal, config);

  if (!nextState) return null;

  const signalDesc =
    signal === 'mr_merged'
      ? 'a linked merge request was merged'
      : 'a linked merge request is open and in progress';

  return {
    agent: 'ST',
    issueIid: issue.iid,
    action: 'state_transition',
    suggestedValue: nextState,
    reason:
      `Issue is currently "${currentNorm}" but ${signalDesc}. ` +
      `Transitioning to "${nextState}" reflects the current activity and is ` +
      `a valid move under the configured transition rules.`,
  };
}
