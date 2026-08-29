/** Read-only GitLab adapter permanently scoped by onboarding configuration. */

import type { IssueInput, MRInput } from '../models';
import {
  assertProjectRelativeEndpoint,
  fetchWithDeadline,
  GITLAB_HTTP_TIMEOUT_MS,
  safeGitLabError,
} from './gitlab-rest';
import type { FetchFn } from './gitlab-rest';
import { loadGitLabRuntimeConfig } from './gitlab-runtime';
import type { GitLabRuntimeConfig } from './gitlab-runtime';

export const MAX_GITLAB_PAGES = 5;
export const MAX_GITLAB_ITEMS = 500;

export interface GitLabReaderLimits {
  timeoutMs?: number;
  maxPages?: number;
  maxItems?: number;
}

interface ResolvedReaderLimits {
  timeoutMs: number;
  maxPages: number;
  maxItems: number;
}

export interface GitLabReaderAdapter {
  listOpenIssues(): Promise<IssueInput[]>;
  listMergeRequests(updatedAfter: string): Promise<MRInput[]>;
}

/** Return true for a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Require a parseable ISO timestamp from GitLab. */
function timestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error(`GitLab returned an invalid ${field} timestamp.`);
  }
  return value;
}

/** Convert one GitLab issue response into the agent input contract. */
function parseIssue(value: unknown): IssueInput {
  if (!isRecord(value) || !Number.isInteger(value['iid']) ||
      typeof value['title'] !== 'string' || typeof value['state'] !== 'string' ||
      !Array.isArray(value['labels']) || value['labels'].some(
        (label) => typeof label !== 'string',
      )) {
    throw new Error('GitLab returned an invalid issue payload.');
  }
  const description = value['description'];
  if (description !== null && typeof description !== 'string') {
    throw new Error('GitLab returned an invalid issue description.');
  }
  return {
    iid: value['iid'] as number,
    title: value['title'],
    description,
    labels: value['labels'] as string[],
    state: value['state'],
    assignee: value['assignee'] ?? null,
    updatedAt: timestamp(value['updated_at'], 'issue updated_at'),
  };
}

/** Convert one GitLab merge-request response into the agent input contract. */
function parseMergeRequest(value: unknown): MRInput {
  if (!isRecord(value) || !Number.isInteger(value['iid']) ||
      typeof value['title'] !== 'string' || typeof value['state'] !== 'string') {
    throw new Error('GitLab returned an invalid merge-request payload.');
  }
  const description = value['description'];
  const mergedAt = value['merged_at'];
  if (description !== null && typeof description !== 'string') {
    throw new Error('GitLab returned an invalid merge-request description.');
  }
  if (mergedAt !== undefined && mergedAt !== null && typeof mergedAt !== 'string') {
    throw new Error('GitLab returned an invalid merge-request merged_at value.');
  }
  if (typeof mergedAt === 'string') timestamp(mergedAt, 'merge-request merged_at');
  return {
    iid: value['iid'] as number,
    title: value['title'],
    description,
    state: value['state'],
    updatedAt: timestamp(value['updated_at'], 'merge-request updated_at'),
    ...(mergedAt === undefined ? {} : { mergedAt: mergedAt as string | null }),
  };
}

/** Validate finite read limits once when constructing the adapter. */
function resolveLimits(limits: GitLabReaderLimits): ResolvedReaderLimits {
  const resolved = {
    timeoutMs: limits.timeoutMs ?? GITLAB_HTTP_TIMEOUT_MS,
    maxPages: limits.maxPages ?? MAX_GITLAB_PAGES,
    maxItems: limits.maxItems ?? MAX_GITLAB_ITEMS,
  };
  if (!Number.isFinite(resolved.timeoutMs) || resolved.timeoutMs <= 0 ||
      !Number.isInteger(resolved.maxPages) || resolved.maxPages <= 0 ||
      !Number.isInteger(resolved.maxItems) || resolved.maxItems <= 0) {
    throw new Error('GitLab reader limits must be positive finite values.');
  }
  return resolved;
}

/** Fetch bounded pages of one project-relative GitLab collection using GET only. */
async function listPages(
  endpoint: string,
  config: GitLabRuntimeConfig,
  fetchFn: FetchFn,
  limits: ResolvedReaderLimits,
): Promise<unknown[]> {
  assertProjectRelativeEndpoint(endpoint);
  const project = encodeURIComponent(config.project);
  const baseUrl = `${config.host}/api/v4/projects/${project}`;
  const values: unknown[] = [];
  let page = 1;

  for (let requestCount = 0; requestCount < limits.maxPages; requestCount += 1) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const result = await fetchWithDeadline(
      fetchFn,
      `${baseUrl}${endpoint}${separator}per_page=100&page=${page}`,
      {
        method: 'GET',
        redirect: 'error',
        headers: { 'PRIVATE-TOKEN': config.token },
      },
      limits.timeoutMs,
      async (response): Promise<{ payload: unknown; next: string | undefined }> => {
        if (!response.ok) {
          throw new Error(
            `GitLab returned HTTP ${response.status} for read endpoint ${endpoint}.`,
          );
        }
        return {
          payload: await response.json() as unknown,
          next: response.headers.get('x-next-page')?.trim(),
        };
      },
    );
    const { payload } = result;
    if (!Array.isArray(payload)) throw new Error('GitLab collection response must be an array.');
    if (payload.length > 100) throw new Error('GitLab returned more than 100 items in one page.');
    if (values.length + payload.length > limits.maxItems) {
      throw new Error(`GitLab read exceeds the ${limits.maxItems} item limit.`);
    }
    values.push(...payload);

    const { next } = result;
    if (!next) return values;
    if (!/^[1-9]\d*$/.test(next)) {
      throw new Error('GitLab returned an invalid pagination header.');
    }
    const nextPage = Number.parseInt(next, 10);
    if (!Number.isInteger(nextPage) || nextPage !== page + 1) {
      throw new Error('GitLab returned an invalid pagination header.');
    }
    if (requestCount + 1 >= limits.maxPages) {
      throw new Error(`GitLab read exceeds the ${limits.maxPages} page limit.`);
    }
    page = nextPage;
  }

  throw new Error(`GitLab read exceeds the ${limits.maxPages} page limit.`);
}

/** Create a scoped adapter exposing only bounded read methods used by audit. */
export function createGitLabRestReaderAdapter(
  fetchFn: FetchFn = globalThis.fetch as FetchFn,
  configLoader: () => GitLabRuntimeConfig = loadGitLabRuntimeConfig,
  requestedLimits: GitLabReaderLimits = {},
): GitLabReaderAdapter {
  const limits = resolveLimits(requestedLimits);
  return {
    async listOpenIssues(): Promise<IssueInput[]> {
      try {
        const values = await listPages('/issues?state=opened', configLoader(), fetchFn, limits);
        return values.map(parseIssue);
      } catch (error) {
        throw new Error(safeGitLabError(error));
      }
    },
    async listMergeRequests(updatedAfter: string): Promise<MRInput[]> {
      try {
        const horizon = timestamp(updatedAfter, 'updated_after');
        const endpoint =
          `/merge_requests?scope=all&state=all&order_by=updated_at&sort=desc&updated_after=${encodeURIComponent(horizon)}`;
        const values = await listPages(endpoint, configLoader(), fetchFn, limits);
        return values.map(parseMergeRequest);
      } catch (error) {
        throw new Error(safeGitLabError(error));
      }
    },
  };
}

/** Production read-only adapter. */
export const defaultReaderAdapter = createGitLabRestReaderAdapter();
