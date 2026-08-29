/**
 * tools.ts — tool registry for the sdlc-harness MCP server.
 *
 * All tools are registered here. index.ts imports this registry and
 * hands each entry to the MCP SDK to mount as a callable tool.
 *
 * To add a new tool: create its module under src/tools/, export a
 * ToolDefinition from it, then add it to the TOOLS array below.
 */

import type { ToolDefinition } from "./types.js";
import { gitlabIssueReaderTool } from "./tools/gitlab-issue-reader.js";
import { gitlabIssueWriterTool } from "./tools/gitlab-issue-writer.js";
import { gitlabMrReaderWriterTool } from "./tools/gitlab-mr-reader-writer.js";
import { workItemFormatTool } from "./tools/work-item-format.js";
import { sdlcReviewDecisionTool } from "./tools/sdlc-review-decision.js";

/**
 * The complete list of tools exposed by this MCP server.
 * Order here determines the order they appear in tool listings.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TOOLS: ToolDefinition<any>[] = [
  gitlabIssueReaderTool,
  gitlabIssueWriterTool,
  gitlabMrReaderWriterTool,
  workItemFormatTool,
  sdlcReviewDecisionTool,
];
