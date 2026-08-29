/**
 * types.ts — shared type contracts for the sdlc-harness MCP server.
 *
 * Every tool is described by a ToolDefinition<TArgs>. The Zod schema
 * (argsSchema) both validates incoming arguments at runtime and generates
 * the JSON-Schema description that the MCP SDK publishes to the host.
 *
 * Context (ToolContext) gives each tool access to the GitLab client and
 * the resolved configuration without importing singletons directly.
 */

import { z, ZodTypeAny } from "zod";
import type { GitLabClient } from "./gitlab-client.js";
import type { Config } from "./env.js";

// ---------------------------------------------------------------------------
// Tool definition contract
// ---------------------------------------------------------------------------

/**
 * A single MCP tool.
 *
 * @template TSchema  Zod schema that validates the tool's input arguments.
 */
export interface ToolDefinition<TSchema extends ZodTypeAny = ZodTypeAny> {
  /** Unique tool name exposed to the MCP host (e.g. "gitlab-issue-reader"). */
  name: string;

  /** Human-readable description shown to the agent/host. */
  description: string;

  /** Zod schema — validates + types the incoming arguments object. */
  argsSchema: TSchema;

  /**
   * Execute the tool.
   *
   * @param args     Validated arguments (inferred from argsSchema).
   * @param context  Shared dependencies — GitLab client, resolved config.
   * @returns        Plain JSON-serialisable value returned to the host.
   */
  execute(args: z.infer<TSchema>, context: ToolContext): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Tool execution context
// ---------------------------------------------------------------------------

/** Shared dependencies injected into every tool's execute() call. */
export interface ToolContext {
  /** Configured GitLab REST client. */
  gitlab: GitLabClient;

  /** Resolved runtime configuration (host, project, etc.). */
  config: Config;
}

// ---------------------------------------------------------------------------
// GitLab domain types (minimal surface — only what the tools need)
// ---------------------------------------------------------------------------

export interface GitLabLabel {
  id: number;
  name: string;
  color: string;
  description: string | null;
}

export interface GitLabUser {
  id: number;
  username: string;
  name: string;
}

export interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: "opened" | "closed";
  labels: string[];
  assignees: GitLabUser[];
  author: GitLabUser;
  created_at: string;
  updated_at: string;
  web_url: string;
  milestone: { id: number; title: string } | null;
}

export interface GitLabMR {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: "opened" | "closed" | "merged" | "locked";
  source_branch: string;
  target_branch: string;
  author: GitLabUser;
  assignees: GitLabUser[];
  labels: string[];
  created_at: string;
  updated_at: string;
  merged_at: string | null;
  web_url: string;
  references?: { full: string };
}

export interface GitLabNote {
  id: number;
  body: string;
  author: GitLabUser;
  created_at: string;
  system: boolean;
}

/** A relationship between two GitLab issues. */
export interface GitLabIssueLink {
  source_issue: GitLabIssue;
  target_issue: GitLabIssue;
  link_type: "relates_to" | "blocks" | "is_blocked_by";
}

export interface CreateIssueParams {
  title: string;
  description?: string;
  /** Comma-separated label names — GitLab's create-issue labels field. */
  labels?: string[];
  assignee_id?: number;
  milestone_id?: number;
}

export interface UpdateIssueParams {
  title?: string;
  description?: string;
  /** Comma-separated label names for the update API. */
  labels?: string;
  /** Comma-separated label names to add atomically. */
  add_labels?: string;
  /** Comma-separated label names to remove atomically. */
  remove_labels?: string;
  state_event?: "close" | "reopen";
  assignee_id?: number;
  milestone_id?: number;
}

export interface CreateMRParams {
  source_branch: string;
  target_branch: string;
  title: string;
  description?: string;
  labels?: string;
  assignee_id?: number;
  remove_source_branch?: boolean;
}

export interface UpdateMRParams {
  title?: string;
  description?: string;
  state_event?: "close" | "reopen";
  labels?: string;
  assignee_id?: number;
}
