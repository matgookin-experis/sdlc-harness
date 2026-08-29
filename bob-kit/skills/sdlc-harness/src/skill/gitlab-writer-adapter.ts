/**
 * Concrete GitLab writer used by the human-review workflow.
 *
 * It reads the same GITLAB_HOST / GITLAB_PROJECT / GITLAB_TOKEN settings as
 * the MCP server. All writes remain locked to that configured project.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { AnyFinding, DependencyFinding, ProjectConfig } from '../models';

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
    valueToWrite: string
  ): Promise<GitLabWriteResult>;
}

interface RuntimeConfig {
  host: string;
  project: string;
  token: string;
  workflowStates: string[];
}

interface GitLabIssueResponse {
  description: string | null;
  labels: string[];
  state: 'opened' | 'closed';
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function isDependencyFinding(finding: AnyFinding): finding is DependencyFinding {
  return (finding as DependencyFinding).sourceIid !== undefined;
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function findEnvFile(): string | null {
  const candidates = [
    process.env['SDLC_ENV_FILE'],
    path.join(process.cwd(), 'bob-kit', 'mcp-server', '.env'),
    path.join(process.cwd(), '.env'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function loadWorkflowStates(): string[] {
  const configPath = process.env['SDLC_PROJECT_CONFIG'] ??
    path.join(process.cwd(), '.sdlc-harness.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ProjectConfig;
    return Array.isArray(config.workflowStates) ? config.workflowStates : [];
  } catch {
    return ['Open', 'In Progress', 'In Review', 'Done'];
  }
}

function loadRuntimeConfig(): RuntimeConfig | null {
  const filePath = findEnvFile();
  const fileValues = filePath ? parseEnvFile(filePath) : {};
  const host = process.env['GITLAB_HOST'] ?? fileValues['GITLAB_HOST'];
  const project = process.env['GITLAB_PROJECT'] ?? fileValues['GITLAB_PROJECT'];
  const token = process.env['GITLAB_TOKEN'] ?? fileValues['GITLAB_TOKEN'];
  if (!host || !project || !token) return null;
  return {
    host: host.replace(/\/$/, ''),
    project,
    token,
    workflowStates: loadWorkflowStates(),
  };
}

function acceptanceCriteriaDescription(current: string | null, criteria: string): string {
  const base = (current ?? '').trimEnd();
  const heading = /^#{1,6}\s+(acceptance criteria|ac|criteria)\s*$/im.test(criteria)
    ? ''
    : '## Acceptance Criteria\n';
  return `${base}${base ? '\n\n' : ''}${heading}${criteria.trim()}`;
}

function safeError(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/PRIVATE-TOKEN[^\s]*/gi, '[credential]')
    : 'GitLab write failed';
}

/** Create a real adapter. The injectable fetch/config hooks keep it testable. */
export function createGitLabRestWriterAdapter(
  fetchFn: FetchFn = globalThis.fetch as FetchFn,
  configLoader: () => RuntimeConfig | null = loadRuntimeConfig
): GitLabWriterAdapter {
  return {
    async applyFindingToGitLab(
      finding: AnyFinding,
      valueToWrite: string
    ): Promise<GitLabWriteResult> {
      const config = configLoader();
      if (!config) {
        return {
          written: false,
          value: '',
          error: 'GitLab is not configured. Set GITLAB_HOST, GITLAB_PROJECT, and GITLAB_TOKEN.',
        };
      }

      const project = encodeURIComponent(config.project);
      const baseUrl = `${config.host}/api/v4/projects/${project}`;
      const request = async <T>(endpoint: string, init: RequestInit = {}): Promise<T> => {
        const response = await fetchFn(`${baseUrl}${endpoint}`, {
          ...init,
          headers: {
            'PRIVATE-TOKEN': config.token,
            'Content-Type': 'application/json',
            ...(init.headers as Record<string, string> | undefined),
          },
        });
        if (!response.ok) {
          let detail = response.statusText;
          try {
            const body = await response.json() as { message?: string | Record<string, string[]> };
            if (typeof body.message === 'string') detail = body.message;
            else if (body.message) detail = JSON.stringify(body.message);
          } catch {
            // Keep the status text when GitLab returns a non-JSON error.
          }
          throw new Error(`GitLab returned HTTP ${response.status} for ${endpoint}: ${detail}`);
        }
        return response.json() as Promise<T>;
      };

      try {
        if (isDependencyFinding(finding)) {
          const projectDetails = await request<{ id: number }>('');
          await request(`/issues/${finding.sourceIid}/links`, {
            method: 'POST',
            body: JSON.stringify({
              target_project_id: projectDetails.id,
              target_issue_iid: finding.targetIid,
              link_type: finding.suggestedLinkType === 'relates-to' ? 'relates_to' : 'blocks',
            }),
          });
          return { written: true, value: valueToWrite };
        }

        const issue = await request<GitLabIssueResponse>(`/issues/${finding.issueIid}`);
        let body: Record<string, unknown>;

        switch (finding.action) {
          case 'draft_ac':
            body = { description: acceptanceCriteriaDescription(issue.description, valueToWrite) };
            break;
          case 'rewrite_desc':
            body = { description: valueToWrite };
            break;
          case 'state_transition': {
            const workflowNames = new Set(config.workflowStates.map((state) => state.toLowerCase()));
            const labels = issue.labels.filter((label) => !workflowNames.has(label.toLowerCase()));
            labels.push(valueToWrite);
            body = { labels: labels.join(',') };
            if (/^(done|closed|complete(?:d)?)$/i.test(valueToWrite)) body['state_event'] = 'close';
            else if (issue.state === 'closed') body['state_event'] = 'reopen';
            break;
          }
          case 'missing_coverage':
            return { written: false, value: '', error: 'Coverage findings are advisory only.' };
        }

        await request(`/issues/${finding.issueIid}`, {
          method: 'PUT',
          body: JSON.stringify(body),
        });
        return { written: true, value: valueToWrite };
      } catch (error) {
        return { written: false, value: '', error: safeError(error) };
      }
    },
  };
}

/** Stub used only by isolated unit tests. */
export const stubWriterAdapter: GitLabWriterAdapter = {
  async applyFindingToGitLab(
    _finding: AnyFinding,
    valueToWrite: string
  ): Promise<GitLabWriteResult> {
    return { written: true, value: valueToWrite };
  },
};

/** Production default: performs real project-scoped GitLab writes. */
export const defaultWriterAdapter = createGitLabRestWriterAdapter();
