/**
 * gitlab-issue-reader.ts — read GitLab issues, labels, and state.
 *
 * Exposed operations (controlled via the "action" discriminator):
 *  - list-issues   : list issues with optional filters
 *  - get-issue     : fetch a single issue by IID
 *  - list-labels   : fetch all project labels
 *  - list-notes    : fetch comments/notes on an issue
 */

import { z } from "zod";
import type { ToolDefinition, ToolContext } from "../types.js";

const argsSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list-issues"),
    state: z.enum(["opened", "closed", "all"]).optional().describe(
      "Filter by issue state. Defaults to 'opened'."
    ),
    labels: z.string().optional().describe(
      "Comma-separated label names to filter by."
    ),
    assignee: z.string().optional().describe(
      "Filter by assignee username."
    ),
    milestone: z.string().optional().describe(
      "Filter by milestone title."
    ),
    search: z.string().optional().describe(
      "Full-text search across title and description."
    ),
    page: z.number().int().min(1).optional().describe(
      "Page number (1-based). Defaults to 1."
    ),
    per_page: z.number().int().min(1).max(100).optional().describe(
      "Results per page. Defaults to 50, max 100."
    ),
  }),
  z.object({
    action: z.literal("get-issue"),
    iid: z.number().int().min(1).describe(
      "Project-scoped issue IID."
    ),
  }),
  z.object({
    action: z.literal("list-labels"),
  }),
  z.object({
    action: z.literal("list-notes"),
    iid: z.number().int().min(1).describe(
      "Project-scoped issue IID to list notes for."
    ),
  }),
]);

type Args = z.infer<typeof argsSchema>;

export const gitlabIssueReaderTool: ToolDefinition<typeof argsSchema> = {
  name: "gitlab-issue-reader",
  description:
    "Read GitLab issues, labels, and notes (comments) for the configured project. " +
    "Use action='list-issues' to search/filter issues, 'get-issue' to fetch a single " +
    "issue by IID, 'list-labels' to fetch all project labels, and 'list-notes' to " +
    "fetch comments on an issue.",
  argsSchema,

  async execute(args: Args, context: ToolContext): Promise<unknown> {
    const { gitlab } = context;

    switch (args.action) {
      case "list-issues":
        return gitlab.listIssues({
          state: args.state ?? "opened",
          labels: args.labels,
          assignee_username: args.assignee,
          milestone: args.milestone,
          search: args.search,
          page: args.page,
          per_page: args.per_page,
        });

      case "get-issue":
        return gitlab.getIssue(args.iid);

      case "list-labels":
        return gitlab.listLabels();

      case "list-notes":
        return gitlab.listIssueNotes(args.iid);
    }
  },
};
