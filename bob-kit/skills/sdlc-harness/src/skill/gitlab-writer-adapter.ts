/** Concrete project-scoped GitLab writer used by the human-review workflow. */

import type { AgentFinding, AnyFinding, DependencyFinding } from '../models';
import {
  deriveCurrentWorkflowState,
  isDirectTransition,
  resolveStateForConcept,
} from '../agents/state-transition-agent';
import { createGitLabRequest, safeGitLabError } from './gitlab-rest';
import type { FetchFn } from './gitlab-rest';
import { loadGitLabRuntimeConfig } from './gitlab-runtime';
import type { GitLabRuntimeConfig } from './gitlab-runtime';

export interface GitLabWriteResult {
  /** True only when GitLab returned a successful response. */
  written: boolean;
  /** The value that was written. */
  value: string;
  /** Safe diagnostic text. Never contains credentials. */
  error?: string;
}

export interface GitLabWriterAdapter {
  applyFindingToGitLab(
    finding: AnyFinding,
    valueToWrite: string,
  ): Promise<GitLabWriteResult>;
}

interface GitLabIssueResponse {
  description: string | null;
  labels: string[];
  state: 'opened' | 'closed';
  updated_at?: string;
}

interface GitLabIssueLinkResponse {
  link_type: 'relates_to' | 'blocks' | 'is_blocked_by';
  iid: number;
  project_id: number;
}

/** Identify dependency findings without relying on optional property presence. */
function isDependencyFinding(finding: AnyFinding): finding is DependencyFinding {
  return finding.agent === 'DEP';
}

/** Append criteria under a heading unless the drafted value already has one. */
function acceptanceCriteriaDescription(current: string | null, criteria: string): string {
  const base = (current ?? '').trimEnd();
  const hasHeading = /^\s{0,3}(?:#{1,6}\s+|\*\*\s*)?(?:acceptance criteria|ac|criteria)(?:\s*\*\*)?\s*:?\s*$/im
    .test(criteria);
  const heading = hasHeading ? '' : '## Acceptance Criteria\n';
  return `${base}${base ? '\n\n' : ''}${heading}${criteria.trim()}`;
}

/** Extract an existing acceptance-criteria section so rewrites cannot discard it. */
function extractAcceptanceCriteria(description: string | null): string | null {
  if (!description) return null;
  const heading = /^\s*(?:(#{1,6})\s+|\*\*)(acceptance criteria|ac|criteria)(?:\*\*)?\s*$/im.exec(description);
  if (!heading || heading.index === undefined) return null;

  const level = heading[1]?.length ?? 6;
  const afterHeading = heading.index + heading[0].length;
  const remainder = description.slice(afterHeading);
  const nextHeading = new RegExp(`^\\s*#{1,${level}}\\s+`, 'm').exec(remainder);
  const end = nextHeading?.index === undefined
    ? description.length
    : afterHeading + nextHeading.index;
  return description.slice(heading.index, end).trim();
}

/** Replace prose while retaining any existing acceptance-criteria section. */
function ambiguityRewriteDescription(current: string | null, rewrite: string): string {
  const replacement = rewrite.trim();
  if (/^\s{0,3}(?:#{1,6}\s+|\*\*\s*)?(?:acceptance criteria|ac|criteria)(?:\s*\*\*)?\s*:?\s*$/im
    .test(replacement)) {
    return replacement;
  }
  const existingCriteria = extractAcceptanceCriteria(current);
  return existingCriteria
    ? `${replacement}\n\n${existingCriteria}`
    : replacement;
}

/** Return a configured state using case-insensitive input matching. */
function canonicalState(value: string, config: GitLabRuntimeConfig): string | null {
  return config.projectConfig.workflowStates.find(
    (state) => state.toLowerCase() === value.trim().toLowerCase(),
  ) ?? null;
}

/** Ensure a description finding was produced from the current GitLab value. */
function assertFreshDescription(finding: AgentFinding, issue: GitLabIssueResponse): void {
  if (!Object.hasOwn(finding, 'originalDescription')) {
    throw new Error('Description finding is missing its originalDescription audit value.');
  }
  if (finding.originalDescription !== issue.description) {
    throw new Error(
      `Issue #${finding.issueIid} description changed after audit; rerun the audit before writing.`,
    );
  }
  if (issue.updated_at !== undefined && finding.originalUpdatedAt === undefined) {
    throw new Error(
      `Issue #${finding.issueIid} finding is missing its originalUpdatedAt audit value.`,
    );
  }
  if (finding.originalUpdatedAt !== undefined &&
      finding.originalUpdatedAt !== issue.updated_at) {
    throw new Error(
      `Issue #${finding.issueIid} was updated after audit; rerun the audit before writing.`,
    );
  }
}

/** Create a real adapter. Injectable fetch/config hooks keep it deterministic in tests. */
export function createGitLabRestWriterAdapter(
  fetchFn: FetchFn = globalThis.fetch as FetchFn,
  configLoader: () => GitLabRuntimeConfig = loadGitLabRuntimeConfig,
): GitLabWriterAdapter {
  return {
    async applyFindingToGitLab(
      finding: AnyFinding,
      valueToWrite: string,
    ): Promise<GitLabWriteResult> {
      try {
        const config = configLoader();
        const request = createGitLabRequest(config, fetchFn);

        if (isDependencyFinding(finding)) {
          if (valueToWrite !== 'blocks' && valueToWrite !== 'relates-to') {
            throw new Error('Dependency link type must be "blocks" or "relates-to".');
          }
          if (valueToWrite === 'blocks' &&
              config.projectConfig.blockingIssueLinks !== true) {
            throw new Error(
              'Blocking issue links are disabled for this GitLab tier. ' +
              'Use relates-to or set blockingIssueLinks=true after confirming Premium/Ultimate support.',
            );
          }
          const desiredType = valueToWrite === 'relates-to' ? 'relates_to' : 'blocks';
          const projectDetails = await request<{ id: number }>('');
          const existingLinks = await request<GitLabIssueLinkResponse[]>(
            `/issues/${finding.sourceIid}/links?per_page=100`,
          );
          const existing = existingLinks.find((link) => (
            link.project_id === projectDetails.id && link.iid === finding.targetIid
          ));
          if (existing) {
            if (existing.link_type === desiredType) {
              return { written: true, value: valueToWrite };
            }
            throw new Error(
              `Issues #${finding.sourceIid} and #${finding.targetIid} are already linked ` +
              `as ${existing.link_type}; review the existing relationship manually.`,
            );
          }
          await request(`/issues/${finding.sourceIid}/links`, {
            method: 'POST',
            body: JSON.stringify({
              target_project_id: projectDetails.id,
              target_issue_iid: finding.targetIid,
              link_type: desiredType,
            }),
          });
          return { written: true, value: valueToWrite };
        }

        const issue = await request<GitLabIssueResponse>(`/issues/${finding.issueIid}`);
        let body: Record<string, unknown>;
        let writtenValue = valueToWrite;

        switch (finding.action) {
          case 'draft_ac':
            assertFreshDescription(finding, issue);
            body = {
              description: acceptanceCriteriaDescription(issue.description, valueToWrite),
            };
            break;
          case 'rewrite_desc':
            assertFreshDescription(finding, issue);
            body = { description: ambiguityRewriteDescription(issue.description, valueToWrite) };
            break;
          case 'state_transition': {
            const target = canonicalState(valueToWrite, config);
            if (!target) {
              throw new Error(
                `Unknown workflow state "${valueToWrite}": it is not configured for this project.`,
              );
            }
            const current = deriveCurrentWorkflowState(issue, config.projectConfig);
            if (!current) {
              throw new Error('Current workflow state is missing or ambiguous in issue labels.');
            }
            if (!isDirectTransition(current, target, config.projectConfig)) {
              throw new Error(
                `State transition "${current}" -> "${target}" is not a direct configured edge.`,
              );
            }

            const workflowNames = new Set(
              config.projectConfig.workflowStates.map((state) => state.toLowerCase()),
            );
            const labelsToRemove = issue.labels.filter(
              (label) => workflowNames.has(label.toLowerCase()),
            );
            body = {
              add_labels: target,
              ...(labelsToRemove.length === 0
                ? {}
                : { remove_labels: labelsToRemove.join(',') }),
            };
            const done = resolveStateForConcept(config.projectConfig, 'done');
            const isDone = done
              ? target.toLowerCase() === done.toLowerCase()
              : /^(done|closed|complete(?:d)?)$/i.test(target);
            if (isDone) body['state_event'] = 'close';
            if (!isDone && issue.state === 'closed') body['state_event'] = 'reopen';
            writtenValue = target;
            break;
          }
          case 'missing_coverage':
            return { written: false, value: '', error: 'Coverage findings are advisory only.' };
        }

        await request(`/issues/${finding.issueIid}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        return { written: true, value: writtenValue };
      } catch (error) {
        return { written: false, value: '', error: safeGitLabError(error) };
      }
    },
  };
}

/** Stub used only by isolated unit tests. */
export const stubWriterAdapter: GitLabWriterAdapter = {
  async applyFindingToGitLab(
    _finding: AnyFinding,
    valueToWrite: string,
  ): Promise<GitLabWriteResult> {
    return { written: true, value: valueToWrite };
  },
};

/** Production default: performs real project-scoped GitLab writes. */
export const defaultWriterAdapter = createGitLabRestWriterAdapter();
