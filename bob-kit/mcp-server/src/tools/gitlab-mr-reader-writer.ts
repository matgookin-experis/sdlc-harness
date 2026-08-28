/**
 * gitlab-mr-reader-writer.ts — read and update GitLab Merge Requests.
 *
 * Exposed operations (controlled via the "action" discriminator):
 *  - list-mrs   : list merge requests with optional filters
 *  - get-mr     : fetch a single MR by IID
 *  - create-mr  : open a new merge request
 *  - update-mr  : update title, description, labels, or assignee
 *  - close-mr   : close (abandon) an open MR
 *  - list-notes : list notes/comments on an MR
 *  - add-note   : post a comment on an MR
 *
 * The state-transition agent uses this tool to detect when an MR is merged
 * ("state" = "merged" on get-mr) and propose the next issue transition.
 */

import { z } from "zod";
import type { ToolDefinition, ToolContext } from "../types.js";

const argsSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list-mrs"),
    state: z.enum(["opened", "closed", "merged", "all"]).optional().describe(
      "Filter by MR state. Defaults to 'opened'."
    ),
    source_branch: z.string().optional().describe(
      "Filter by source branch name."
    ),
    target_branch: z.string().optional().describe(
      "Filter by target branch name."
    ),
    labels: z.string().optional().describe(
      "Comma-separated label names to filter by."
    ),
    page: z.number().int().min(1).optional().describe("Page number (1-based)."),
    per_page: z.number().int().min(1).max(100).optional().describe(
      "Results per page. Defaults to 50."
    ),
  }),
  z.object({
    action: z.literal("get-mr"),
    iid: z.number().int().min(1).describe("Project-scoped MR IID."),
  }),
  z.object({
    action: z.literal("create-mr"),
    source_branch: z.string().min(1).describe("Source branch name."),
    target_branch: z.string().min(1).describe("Target branch name."),
    title: z.string().min(1).describe("MR title (Conventional Commits recommended)."),
    description: z.string().optional().describe("MR description (Markdown)."),
    labels: z.string().optional().describe("Comma-separated labels to apply."),
    remove_source_branch: z.boolean().optional().describe(
      "Delete source branch after merge. Defaults to true."
    ),
  }),
  z.object({
    action: z.literal("update-mr"),
    iid: z.number().int().min(1).describe("Project-scoped MR IID to update."),
    title: z.string().optional().describe("New title."),
    description: z.string().optional().describe("New description (Markdown)."),
    labels: z.string().optional().describe(
      "Replacement comma-separated label list."
    ),
  }),
  z.object({
    action: z.literal("close-mr"),
    iid: z.number().int().min(1).describe("Project-scoped MR IID to close."),
  }),
  z.object({
    action: z.literal("list-notes"),
    iid: z.number().int().min(1).describe("Project-scoped MR IID."),
  }),
  z.object({
    action: z.literal("add-note"),
    iid: z.number().int().min(1).describe("Project-scoped MR IID."),
    body: z.string().min(1).describe("Comment body (Markdown)."),
  }),
]);

type Args = z.infer<typeof argsSchema>;

export const gitlabMrReaderWriterTool: ToolDefinition<typeof argsSchema> = {
  name: "gitlab-mr-reader-writer",
  description:
    "Read and manage GitLab Merge Requests for the configured project. " +
    "action='list-mrs' lists MRs with optional state/branch/label filters. " +
    "action='get-mr' fetches a single MR by IID (check .state for 'merged' to trigger state transitions). " +
    "action='create-mr' opens a new MR. " +
    "action='update-mr' patches title, description, or labels. " +
    "action='close-mr' abandons an open MR. " +
    "action='list-notes' / 'add-note' read and write MR comments.",
  argsSchema,

  async execute(args: Args, context: ToolContext): Promise<unknown> {
    const { gitlab } = context;

    switch (args.action) {
      case "list-mrs":
        return gitlab.listMRs({
          state: args.state ?? "opened",
          source_branch: args.source_branch,
          target_branch: args.target_branch,
          labels: args.labels,
          page: args.page,
          per_page: args.per_page,
        });

      case "get-mr":
        return gitlab.getMR(args.iid);

      case "create-mr":
        return gitlab.createMR({
          source_branch: args.source_branch,
          target_branch: args.target_branch,
          title: args.title,
          description: args.description,
          labels: args.labels,
          remove_source_branch: args.remove_source_branch ?? true,
        });

      case "update-mr":
        return gitlab.updateMR(args.iid, {
          title: args.title,
          description: args.description,
          labels: args.labels,
        });

      case "close-mr":
        return gitlab.updateMR(args.iid, { state_event: "close" });

      case "list-notes":
        return gitlab.listMRNotes(args.iid);

      case "add-note":
        return gitlab.createMRNote(args.iid, args.body);
    }
  },
};
