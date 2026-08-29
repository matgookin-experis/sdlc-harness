/**
 * gitlab-client.ts — GitLab REST API client for sdlc-harness.
 *
 * Design goals:
 *  - Thin wrapper: one method per API operation needed by the tools.
 *  - Testable: the class is constructed with a host + token so tests can
 *    substitute fixture responses by swapping the underlying fetch function.
 *  - No retries. Collection endpoints that are exposed as "all" results
 *    paginate internally.
 *
 * All methods throw a GitLabApiError on non-2xx responses so callers get
 * structured error info (status, message) rather than raw fetch rejections.
 */

import type {
  GitLabIssue,
  GitLabLabel,
  GitLabMR,
  GitLabNote,
  GitLabIssueLink,
  CreateIssueParams,
  UpdateIssueParams,
  CreateMRParams,
  UpdateMRParams,
} from "./types.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Maximum number of collection pages returned by one client operation. */
export const MAX_GITLAB_PAGES = 5;
/** Maximum number of collection items returned by one client operation. */
export const MAX_GITLAB_ITEMS = 500;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** Thrown when the GitLab API returns a non-2xx status. */
export class GitLabApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    message: string
  ) {
    super(`GitLab API error ${status} on ${endpoint}: ${message}`);
    this.name = "GitLabApiError";
  }
}

/** Thrown when a GitLab API request exceeds its configured deadline. */
export class GitLabRequestTimeoutError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly timeoutMs: number,
  ) {
    super(`GitLab API request timed out after ${timeoutMs}ms on ${endpoint}`);
    this.name = 'GitLabRequestTimeoutError';
  }
}

// ---------------------------------------------------------------------------
// Fetch abstraction — injectable for tests
// ---------------------------------------------------------------------------

/** Minimal fetch interface so tests can supply a mock. */
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// GitLabClient
// ---------------------------------------------------------------------------

export class GitLabClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly fetch: FetchFn;
  private readonly requestTimeoutMs: number;

  /**
   * @param host        GitLab host, e.g. "https://gitlab.example.com". No trailing slash.
   * @param token       Personal Access Token with `api` scope.
   * @param projectPath Project path or numeric ID, e.g. "mygroup/myproject".
   * @param fetchFn     Optional fetch override — defaults to global fetch (Node ≥18).
   * @param requestTimeoutMs Maximum request or paginated-operation duration in milliseconds.
   */
  constructor(
    host: string,
    token: string,
    public readonly projectPath: string,
    fetchFn?: FetchFn,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new Error('GitLab request timeout must be a positive, finite number.');
    }

    this.baseUrl = `${host}/api/v4`;
    this.headers = {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    };
    // Node 18+ ships with global fetch; tests can inject a mock
    this.fetch = fetchFn ?? (globalThis.fetch as FetchFn);
    this.requestTimeoutMs = requestTimeoutMs;
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** URL-encode a project path (slashes → %2F) for use in API endpoints. */
  private encodedProject(): string {
    return encodeURIComponent(this.projectPath);
  }

  /** Build a full API URL for a project-scoped path. */
  private projectUrl(path: string): string {
    return `${this.baseUrl}/projects/${this.encodedProject()}${path}`;
  }

  /**
   * Execute an API request and return the parsed JSON body.
   * Throws GitLabApiError on non-2xx responses.
   */
  private async request<T>(
    url: string,
    options: RequestInit = {},
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    const controller = new AbortController();
    let rejectDeadline: ((reason: GitLabRequestTimeoutError) => void) | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      rejectDeadline = reject;
    });
    const timer = setTimeout(() => {
      rejectDeadline?.(new GitLabRequestTimeoutError(url, timeoutMs));
      controller.abort();
    }, timeoutMs);

    try {
      return await Promise.race([
        (async (): Promise<T> => {
          const response = await this.fetch(url, {
            ...options,
            headers: {
              ...this.headers,
              ...(options.headers as Record<string, string> | undefined),
            },
            redirect: 'error',
            signal: controller.signal,
          });

          if (!response.ok) {
            let message = response.statusText;
            try {
              const body = (await response.json()) as { message?: string; error?: string };
              message = body.message ?? body.error ?? message;
            } catch {
              // Ignore JSON parse errors on error responses
            }
            throw new GitLabApiError(response.status, url, message);
          }

          // 204 No Content has no body
          if (response.status === 204) {
            return undefined as unknown as T;
          }

          return (await response.json()) as T;
        })(),
        deadline,
      ]);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new GitLabRequestTimeoutError(url, timeoutMs);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetch every page from a project-scoped collection endpoint.
   * @param path Project-relative API path.
   * @param params Query parameters shared by every page.
   * @returns All items in API order.
   */
  private async requestAllPages<TItem>(
    path: string,
    params: Record<string, string> = {},
  ): Promise<TItem[]> {
    const items: TItem[] = [];
    const perPage = 100;
    const startedAt = performance.now();

    for (let page = 1; page <= MAX_GITLAB_PAGES; page += 1) {
      const query = new URLSearchParams({
        ...params,
        page: String(page),
        per_page: String(perPage),
      });
      const url = this.projectUrl(`${path}?${query.toString()}`);
      const remainingTimeoutMs = this.requestTimeoutMs - (performance.now() - startedAt);
      if (remainingTimeoutMs <= 0) {
        throw new GitLabRequestTimeoutError(url, this.requestTimeoutMs);
      }
      let batch: TItem[];
      try {
        batch = await this.request<TItem[]>(url, {}, remainingTimeoutMs);
      } catch (error) {
        if (error instanceof GitLabRequestTimeoutError) {
          throw new GitLabRequestTimeoutError(url, this.requestTimeoutMs);
        }
        throw error;
      }
      if (performance.now() - startedAt >= this.requestTimeoutMs) {
        throw new GitLabRequestTimeoutError(url, this.requestTimeoutMs);
      }
      if (!Array.isArray(batch)) {
        throw new Error(`GitLab API returned a non-array collection on ${path}.`);
      }
      if (items.length + batch.length > MAX_GITLAB_ITEMS) {
        throw new Error(
          `GitLab pagination exceeds the ${MAX_GITLAB_ITEMS} item limit on ${path}.`,
        );
      }
      items.push(...batch);

      if (batch.length < perPage) {
        return items;
      }
      if (page === MAX_GITLAB_PAGES) {
        throw new Error(
          `GitLab pagination exceeds the ${MAX_GITLAB_PAGES} page limit on ${path}.`,
        );
      }
    }

    throw new Error(`GitLab pagination exceeds the ${MAX_GITLAB_PAGES} page limit on ${path}.`);
  }

  // -------------------------------------------------------------------------
  // Labels
  // -------------------------------------------------------------------------

  /**
   * List all labels for the project.
   */
  async listLabels(): Promise<GitLabLabel[]> {
    return this.requestAllPages<GitLabLabel>('/labels');
  }

  // -------------------------------------------------------------------------
  // Issues
  // -------------------------------------------------------------------------

  /**
   * List issues for the project.
   *
   * @param params  Optional filters: state, labels, assignee_username, milestone.
   */
  async listIssues(
    params: {
      state?: "opened" | "closed" | "all";
      labels?: string;
      assignee_username?: string;
      milestone?: string;
      search?: string;
      page?: number;
      per_page?: number;
    } = {}
  ): Promise<GitLabIssue[]> {
    const query = new URLSearchParams();
    if (params.state) query.set("state", params.state);
    if (params.labels) query.set("labels", params.labels);
    if (params.assignee_username) query.set("assignee_username", params.assignee_username);
    if (params.milestone) query.set("milestone", params.milestone);
    if (params.search) query.set("search", params.search);
    query.set("page", String(params.page ?? 1));
    query.set("per_page", String(params.per_page ?? 50));

    const url = this.projectUrl(`/issues?${query.toString()}`);
    return this.request<GitLabIssue[]>(url);
  }

  /**
   * Get a single issue by its project-scoped IID.
   */
  async getIssue(iid: number): Promise<GitLabIssue> {
    const url = this.projectUrl(`/issues/${iid}`);
    return this.request<GitLabIssue>(url);
  }

  /**
   * Create a new issue.
   *
   * GitLab's create-issue API accepts labels as a comma-separated string.
   * We convert the string[] from CreateIssueParams here before serialising.
   */
  async createIssue(params: CreateIssueParams): Promise<GitLabIssue> {
    const url = this.projectUrl("/issues");
    const body: Record<string, unknown> = {
      title: params.title,
    };
    if (params.description !== undefined) body["description"] = params.description;
    if (params.labels !== undefined) body["labels"] = params.labels.join(",");
    if (params.assignee_id !== undefined) body["assignee_id"] = params.assignee_id;
    if (params.milestone_id !== undefined) body["milestone_id"] = params.milestone_id;
    return this.request<GitLabIssue>(url, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  /**
   * Update an existing issue.
   */
  async updateIssue(iid: number, params: UpdateIssueParams): Promise<GitLabIssue> {
    const url = this.projectUrl(`/issues/${iid}`);
    return this.request<GitLabIssue>(url, {
      method: "PUT",
      body: JSON.stringify(params),
    });
  }

  /**
   * List notes (comments) on an issue.
   */
  async listIssueNotes(iid: number): Promise<GitLabNote[]> {
    return this.requestAllPages<GitLabNote>(`/issues/${iid}/notes`, { sort: 'asc' });
  }

  /**
   * Add a comment to an issue.
   */
  async createIssueNote(iid: number, body: string): Promise<GitLabNote> {
    const url = this.projectUrl(`/issues/${iid}/notes`);
    return this.request<GitLabNote>(url, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  /**
   * Create a relationship between two issues in the configured project.
   * GitLab accepts either a numeric project ID or a URL-encoded project path
   * for target_project_id, so the configured project path keeps this scoped.
   */
  async createIssueLink(
    sourceIid: number,
    targetIid: number,
    linkType: "relates_to" | "blocks"
  ): Promise<GitLabIssueLink> {
    const project = await this.request<{ id: number }>(this.projectUrl(""));
    const url = this.projectUrl(`/issues/${sourceIid}/links`);
    return this.request<GitLabIssueLink>(url, {
      method: "POST",
      body: JSON.stringify({
        target_project_id: project.id,
        target_issue_iid: targetIid,
        link_type: linkType,
      }),
    });
  }

  // -------------------------------------------------------------------------
  // Merge Requests
  // -------------------------------------------------------------------------

  /**
   * List merge requests.
   */
  async listMRs(
    params: {
      state?: "opened" | "closed" | "merged" | "all";
      labels?: string;
      source_branch?: string;
      target_branch?: string;
      page?: number;
      per_page?: number;
    } = {}
  ): Promise<GitLabMR[]> {
    const query = new URLSearchParams();
    query.set('scope', 'all');
    if (params.state) query.set("state", params.state);
    if (params.labels) query.set("labels", params.labels);
    if (params.source_branch) query.set("source_branch", params.source_branch);
    if (params.target_branch) query.set("target_branch", params.target_branch);
    query.set("page", String(params.page ?? 1));
    query.set("per_page", String(params.per_page ?? 50));

    const url = this.projectUrl(`/merge_requests?${query.toString()}`);
    return this.request<GitLabMR[]>(url);
  }

  /**
   * Get a single MR by project-scoped IID.
   */
  async getMR(iid: number): Promise<GitLabMR> {
    const url = this.projectUrl(`/merge_requests/${iid}`);
    return this.request<GitLabMR>(url);
  }

  /**
   * Create a new merge request.
   */
  async createMR(params: CreateMRParams): Promise<GitLabMR> {
    const url = this.projectUrl("/merge_requests");
    return this.request<GitLabMR>(url, {
      method: "POST",
      body: JSON.stringify(params),
    });
  }

  /**
   * Update an existing merge request.
   */
  async updateMR(iid: number, params: UpdateMRParams): Promise<GitLabMR> {
    const url = this.projectUrl(`/merge_requests/${iid}`);
    return this.request<GitLabMR>(url, {
      method: "PUT",
      body: JSON.stringify(params),
    });
  }

  /**
   * List notes (comments) on a merge request.
   */
  async listMRNotes(iid: number): Promise<GitLabNote[]> {
    return this.requestAllPages<GitLabNote>(`/merge_requests/${iid}/notes`, {
      sort: 'asc',
    });
  }

  /**
   * Add a comment to a merge request.
   */
  async createMRNote(iid: number, body: string): Promise<GitLabNote> {
    const url = this.projectUrl(`/merge_requests/${iid}/notes`);
    return this.request<GitLabNote>(url, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  // -------------------------------------------------------------------------
  // Health check — used by the smoke test
  // -------------------------------------------------------------------------

  /**
   * Verify the client can reach the GitLab instance and authenticate.
   * Returns the authenticated user's username on success.
   * Throws GitLabApiError on failure.
   */
  async ping(): Promise<string> {
    const url = `${this.baseUrl}/user`;
    const user = await this.request<{ username: string }>(url);
    return user.username;
  }
}
