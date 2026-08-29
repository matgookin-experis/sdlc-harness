/** Runtime validation for untrusted CLI review payloads. */

import type { AgentFinding, AnyFinding, DependencyFinding, DraftBrief } from '../models';

export interface DecisionPayload {
  finding: AnyFinding;
  editedValue: string | null;
}

export type DecisionOperation = 'apply' | 'reject';

/** Return true for a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Read a positive GitLab IID. */
function positiveIid(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value as number;
}

/** Validate an optional string property. */
function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${field} must be a string.`);
  return value;
}

/** Validate a drafter brief when one is present. */
function parseDraft(value: unknown): DraftBrief | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('finding.draft must be an object.');
  if (typeof value['task'] !== 'string' || value['task'].trim().length === 0) {
    throw new Error('finding.draft.task must be a non-blank string.');
  }
  if (!isRecord(value['context'])) throw new Error('finding.draft.context must be an object.');
  const context: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value['context'])) {
    if (typeof entry !== 'string') {
      throw new Error('finding.draft.context values must be strings.');
    }
    context[key] = entry;
  }
  if (!Array.isArray(value['unknowns']) || value['unknowns'].some(
    (entry) => typeof entry !== 'string',
  )) {
    throw new Error('finding.draft.unknowns must be an array of strings.');
  }
  return {
    task: value['task'],
    context,
    unknowns: value['unknowns'] as string[],
  };
}

/** Validate a dependency finding and its directional link type. */
function parseDependencyFinding(value: Record<string, unknown>): DependencyFinding {
  const sourceIid = positiveIid(value['sourceIid'], 'finding.sourceIid');
  const targetIid = positiveIid(value['targetIid'], 'finding.targetIid');
  if (sourceIid === targetIid) throw new Error('Dependency findings must not self-link.');
  const linkType = value['suggestedLinkType'];
  if (linkType !== 'blocks' && linkType !== 'relates-to') {
    throw new Error('finding.suggestedLinkType must be "blocks" or "relates-to".');
  }
  const confidence = value['confidence'];
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) ||
      confidence < 0 || confidence > 1) {
    throw new Error('finding.confidence must be a number between 0 and 1.');
  }
  const reason = optionalString(value['reason'], 'finding.reason');
  return {
    agent: 'DEP',
    sourceIid,
    targetIid,
    suggestedLinkType: linkType,
    confidence,
    ...(reason === undefined ? {} : { reason }),
  };
}

/** Validate a single-issue finding and its agent/action pairing. */
function parseAgentFinding(value: Record<string, unknown>): AgentFinding {
  const validPairs: Record<string, AgentFinding['action']> = {
    AC: 'draft_ac',
    AM: 'rewrite_desc',
    ST: 'state_transition',
    COV: 'missing_coverage',
  };
  const agent = value['agent'];
  if (typeof agent !== 'string' || !Object.hasOwn(validPairs, agent)) {
    throw new Error('finding.agent is invalid.');
  }
  const action = value['action'];
  if (action !== validPairs[agent]) {
    throw new Error(`finding.action is invalid for agent ${agent}.`);
  }
  if (typeof value['suggestedValue'] !== 'string' ||
      value['suggestedValue'].trim().length === 0) {
    throw new Error('finding.suggestedValue must be a non-blank string.');
  }
  const reason = optionalString(value['reason'], 'finding.reason');
  const draft = parseDraft(value['draft']);

  const finding: AgentFinding = {
    agent: agent as AgentFinding['agent'],
    issueIid: positiveIid(value['issueIid'], 'finding.issueIid'),
    action: action as AgentFinding['action'],
    suggestedValue: value['suggestedValue'],
    ...(reason === undefined ? {} : { reason }),
    ...(draft === undefined ? {} : { draft }),
  };

  if (action === 'draft_ac' || action === 'rewrite_desc') {
    if (!Object.hasOwn(value, 'originalDescription')) {
      throw new Error('Description findings must carry finding.originalDescription.');
    }
    const original = value['originalDescription'];
    if (original !== null && typeof original !== 'string') {
      throw new Error('finding.originalDescription must be a string or null.');
    }
    finding.originalDescription = original as string | null;
    const originalUpdatedAt = value['originalUpdatedAt'];
    if (originalUpdatedAt !== undefined) {
      if (typeof originalUpdatedAt !== 'string' ||
          !Number.isFinite(Date.parse(originalUpdatedAt))) {
        throw new Error('finding.originalUpdatedAt must be a valid timestamp.');
      }
      finding.originalUpdatedAt = originalUpdatedAt;
    }
  }
  return finding;
}

/** Validate an unknown finding object. */
export function parseFinding(value: unknown): AnyFinding {
  if (!isRecord(value)) throw new Error('finding must be an object.');
  if (value['agent'] === 'DEP') return parseDependencyFinding(value);
  return parseAgentFinding(value);
}

/** Validate an apply/reject decision payload read from JSON. */
export function parseDecisionPayload(
  value: unknown,
  operation: DecisionOperation = 'apply',
): DecisionPayload {
  if (!isRecord(value)) throw new Error('Decision payload must be a JSON object.');
  const editedValue = value['editedValue'] ?? null;
  if (editedValue !== null && typeof editedValue !== 'string') {
    throw new Error('editedValue must be a string or null.');
  }
  if (typeof editedValue === 'string' && editedValue.trim().length === 0) {
    throw new Error('editedValue must not be blank.');
  }

  const finding = parseFinding(value['finding']);
  if (operation === 'apply' && finding.agent !== 'DEP' &&
      (finding.action === 'draft_ac' || finding.action === 'rewrite_desc') &&
      finding.originalUpdatedAt === undefined) {
    throw new Error('Description apply decisions must carry finding.originalUpdatedAt.');
  }
  if (finding.agent === 'DEP' && editedValue !== null &&
      editedValue !== 'blocks' && editedValue !== 'relates-to') {
    throw new Error('Edited dependency link type must be "blocks" or "relates-to".');
  }
  return { finding, editedValue };
}
