/**
 * onboard.ts — guided onboarding for the sdlc-harness skill (Task 18).
 *
 * This module is a pure, deterministic function with no side-effects
 * beyond returning validated config. Persistence to `.sdlc-harness.json`
 * is handled by the caller (the SKILL.md conversation flow) so that
 * unit tests can exercise validation without touching the filesystem.
 */

import type { ProjectConfig, TransitionRules, CoverageConfig } from '../models';

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

function validateUrl(url: string): string | null {
  if (!url || url.trim().length === 0) {
    return 'projectUrl is required and must not be empty.';
  }
  // Accept http:// or https:// URLs only
  if (!/^https?:\/\/.+/.test(url.trim())) {
    return 'projectUrl must be a valid http or https URL.';
  }
  return null;
}

function validateWorkItemTypes(types: string[]): string | null {
  if (!Array.isArray(types) || types.length === 0) {
    return 'workItemTypes must be a non-empty array of strings.';
  }
  if (types.some((t) => typeof t !== 'string' || t.trim().length === 0)) {
    return 'workItemTypes must not contain blank entries.';
  }
  return null;
}

function validateWorkflowStates(states: string[]): string | null {
  if (!Array.isArray(states) || states.length === 0) {
    return 'workflowStates must be a non-empty array of state names.';
  }
  return null;
}

function validateTransitionRules(
  rules: TransitionRules,
  states: string[]
): string | null {
  const stateSet = new Set(states);
  for (const [from, targets] of Object.entries(rules)) {
    if (!stateSet.has(from)) {
      return `transitionRules contains unknown source state "${from}". Valid states: ${states.join(', ')}.`;
    }
    for (const to of targets) {
      if (!stateSet.has(to)) {
        return `transitionRules[${from}] references unknown target state "${to}". Valid states: ${states.join(', ')}.`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// onboard()
// ---------------------------------------------------------------------------

/**
 * Validate onboarding input and return a typed ProjectConfig.
 *
 * This is idempotent: calling it twice with the same valid input returns the
 * same config without error. Callers are responsible for persisting the
 * returned config to `.sdlc-harness.json`.
 */
export async function onboard(input: OnboardInput): Promise<OnboardResult> {
  const urlError = validateUrl(input.projectUrl);
  if (urlError) return { ok: false as const, error: urlError };

  const typesError = validateWorkItemTypes(input.workItemTypes);
  if (typesError) return { ok: false as const, error: typesError };

  const statesError = validateWorkflowStates(input.workflowStates);
  if (statesError) return { ok: false as const, error: statesError };

  const rulesError = validateTransitionRules(
    input.transitionRules,
    input.workflowStates
  );
  if (rulesError) return { ok: false as const, error: rulesError };

  const config: ProjectConfig = {
    projectUrl: input.projectUrl.trim(),
    workItemTypes: input.workItemTypes,
    workflowStates: input.workflowStates,
    transitionRules: input.transitionRules,
    ...(input.blockingIssueLinks !== undefined
      ? { blockingIssueLinks: input.blockingIssueLinks }
      : {}),
    ...(input.coverage !== undefined ? { coverage: input.coverage } : {}),
  };

  return { ok: true as const, config };
}
