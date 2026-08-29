/** Shared scoped GitLab REST request helper. */

import type { GitLabRuntimeConfig } from './gitlab-runtime';

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export const GITLAB_HTTP_TIMEOUT_MS = 15_000;

/** Remove credential-shaped data from an error returned to a caller. */
export function safeGitLabError(error: unknown): string {
  if (!(error instanceof Error)) return 'GitLab request failed';
  return error.message
    .replace(/PRIVATE-TOKEN[^\s]*/gi, '[credential]')
    .replace(/GITLAB_TOKEN[^\s]*/gi, '[credential]');
}

/** Reject absolute, authority-changing, or traversal-capable project routes. */
export function assertProjectRelativeEndpoint(endpoint: string): void {
  if (endpoint === '') return;
  if (!endpoint.startsWith('/') || endpoint.startsWith('//') || endpoint.includes('\\') ||
      endpoint.includes('#')) {
    throw new Error('GitLab API endpoint must be a safe project-relative route.');
  }
  const rawPath = endpoint.split('?', 1)[0];
  for (const rawSegment of rawPath.split('/')) {
    if (rawSegment.includes('%')) {
      throw new Error('GitLab API endpoint path must not contain encoded segments.');
    }
    let segment: string;
    try {
      segment = decodeURIComponent(rawSegment);
    } catch {
      throw new Error('GitLab API endpoint contains invalid path encoding.');
    }
    if (segment === '.' || segment === '..' || segment.includes('/') ||
        segment.includes('\\') || /%(?:2e|2f|5c)/i.test(segment)) {
      throw new Error('GitLab API endpoint must not contain route traversal.');
    }
  }
}

/** Fetch and consume a response within a finite deadline while preserving cancellation. */
export function fetchWithDeadline(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs?: number,
): Promise<Response>;
export function fetchWithDeadline<TValue>(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  consume: (response: Response) => Promise<TValue>,
): Promise<TValue>;
export async function fetchWithDeadline<TValue>(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs = GITLAB_HTTP_TIMEOUT_MS,
  consume?: (response: Response) => Promise<TValue>,
): Promise<Response | TValue> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('GitLab HTTP timeout must be a positive finite number.');
  }
  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = (): void => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) controller.abort(callerSignal.reason);
  if (!callerSignal?.aborted) {
    callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  }
  let rejectDeadline: ((reason: Error) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  const timer = setTimeout(() => {
    rejectDeadline?.(new Error(`GitLab request timed out after ${timeoutMs}ms.`));
    controller.abort();
  }, timeoutMs);

  try {
    return await Promise.race([
      (async (): Promise<Response | TValue> => {
        const response = await fetchFn(url, { ...init, signal: controller.signal });
        if (consume) return consume(response);
        const bufferedResponse = response.clone();
        await response.arrayBuffer();
        return bufferedResponse;
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

/** Create a request function permanently scoped to one onboarded GitLab project. */
export function createGitLabRequest(
  config: GitLabRuntimeConfig,
  fetchFn: FetchFn,
  timeoutMs = GITLAB_HTTP_TIMEOUT_MS,
): <TValue>(endpoint: string, init?: RequestInit) => Promise<TValue> {
  const project = encodeURIComponent(config.project);
  const baseUrl = `${config.host}/api/v4/projects/${project}`;

  return async <TValue>(endpoint: string, init: RequestInit = {}): Promise<TValue> => {
    assertProjectRelativeEndpoint(endpoint);
    return fetchWithDeadline(
      fetchFn,
      `${baseUrl}${endpoint}`,
      {
        ...init,
        redirect: 'error',
        headers: {
          'PRIVATE-TOKEN': config.token,
          'Content-Type': 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
      },
      timeoutMs,
      async (response): Promise<TValue> => {
        if (!response.ok) {
          let detail = response.statusText;
          try {
            const body = await response.json() as {
              message?: string | Record<string, string[]>;
            };
            if (typeof body.message === 'string') detail = body.message;
            if (body.message && typeof body.message !== 'string') {
              detail = JSON.stringify(body.message);
            }
          } catch {
            // Keep the status text when GitLab returns a non-JSON error.
          }
          throw new Error(`GitLab returned HTTP ${response.status} for ${endpoint}: ${detail}`);
        }
        return response.json() as Promise<TValue>;
      },
    );
  };
}
