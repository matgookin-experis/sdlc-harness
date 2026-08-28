/**
 * gitlab-writer-adapter.ts — typed adapter boundary between the review
 * interface and the GitLab MCP tools (Tasks 25 / Section 2A).
 *
 * CONTRACT:
 * This module defines the minimal interface that the review module needs
 * in order to write back to GitLab. The concrete implementation calls the
 * `gitlab-issue-writer` MCP tool via the configured client. In unit tests
 * the adapter is replaced by a mock so no live GitLab instance is required.
 *
 * MISSING INTEGRATION NOTE:
 * The `gitlab-issue-writer` MCP tool is registered in `bob-kit/mcp-server/src/tools/`
 * and is reachable at runtime when the MCP server is running. However, calling
 * it from within the skill's TypeScript modules would require either:
 *   (a) running in-process (direct import from bob-kit/mcp-server/), or
 *   (b) calling the MCP tool over stdio/transport.
 *
 * For the unit-test layer, this adapter uses a no-op stub. For the real runtime
 * path (Bob session), the SKILL.md runtime instructions direct Bob to call the
 * `gitlab-issue-writer` MCP tool directly — no second HTTP client is needed.
 *
 * The adapter boundary is kept here so that a real integration can be wired
 * by replacing `defaultWriterAdapter` without touching the review or telemetry
 * modules.
 */

import type { AgentFinding } from '../models';

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

export interface GitLabWriteResult {
  /** True if a real or simulated write was performed. */
  written: boolean;
  /** The value that was written. */
  value: string;
}

/**
 * Adapter interface. Implementations either call the MCP tool (runtime) or
 * return a stub result (tests).
 */
export interface GitLabWriterAdapter {
  /**
   * Apply a finding by updating the relevant issue field on GitLab.
   *
   * @param finding       The original agent finding.
   * @param valueToWrite  The value to write (may differ from finding.suggestedValue
   *                      when the user edited the suggestion).
   */
  applyFindingToGitLab(
    finding: AgentFinding,
    valueToWrite: string
  ): Promise<GitLabWriteResult>;
}

// ---------------------------------------------------------------------------
// Stub adapter — for unit tests only
// ---------------------------------------------------------------------------

/**
 * Stub adapter that simulates a successful write without calling GitLab.
 * Inject this explicitly in unit tests via the `adapter` parameter of
 * `applyFinding`. Do NOT use this as the default in production code.
 *
 * @see SKILL.md §Phase 4 for the runtime integration contract.
 */
export const stubWriterAdapter: GitLabWriterAdapter = {
  async applyFindingToGitLab(
    _finding: AgentFinding,
    valueToWrite: string
  ): Promise<GitLabWriteResult> {
    return { written: true, value: valueToWrite };
  },
};

// ---------------------------------------------------------------------------
// Default adapter — refuses silent no-op writes
// ---------------------------------------------------------------------------

/**
 * The adapter used by the review module when no override is provided.
 *
 * This implementation deliberately returns `written: false` rather than
 * silently claiming success. A real write only happens when a concrete
 * adapter (e.g. one that calls `gitlab-issue-writer`) is injected at the
 * call site.  This prevents telemetry from recording `outcome: accepted`
 * for writes that never reached GitLab.
 *
 * Replace this export with a real adapter when wiring the MCP server.
 */
export const defaultWriterAdapter: GitLabWriterAdapter = {
  async applyFindingToGitLab(
    _finding: AgentFinding,
    _valueToWrite: string
  ): Promise<GitLabWriteResult> {
    // No real adapter is wired — refuse to silently succeed.
    return { written: false, value: '' };
  },
};
