/**
 * gitlab-issue-writer.ts — create and update GitLab issues.
 *
 * Exposed operations (controlled via the "action" discriminator):
 *  - create-issue    : create a new issue, with duplicate detection
 *  - update-issue    : update fields on an existing issue
 *  - close-issue     : close an issue by IID
 *  - reopen-issue    : reopen a closed issue
 *  - add-note        : post a comment on an issue
 *  - create-link     : create a relates-to / blocks relationship
 *
 * Duplicate detection (create-issue):
 *  Before creating, the tool searches for open issues with the same title
 *  (case-insensitive exact match). If a duplicate is found it is returned
 *  with a `duplicate` flag set to true and NO new issue is created. The
 *  caller must explicitly pass `force: true` to bypass this check.
 *
 *  Duplicate detection follows all matching result pages before creating.
 */

import { z } from "zod";
import type { ToolDefinition, ToolContext, GitLabIssue } from "../types.js";

const argsSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create-issue"),
    title: z.string().min(1).describe("Issue title."),
    description: z.string().optional().describe("Issue description (Markdown)."),
    labels: z.array(z.string()).optional().describe("Label names to apply."),
    milestone_id: z.number().int().optional().describe("Milestone ID to assign."),
    assignee_id: z.number().int().min(1).optional().describe("Assignee user ID."),
    force: z.boolean().optional().describe(
      "Set true to create even if a duplicate title is found. Default false."
    ),
  }),
  z.object({
    action: z.literal("update-issue"),
    iid: z.number().int().min(1).describe("Project-scoped issue IID to update."),
    title: z.string().optional().describe("New title."),
    description: z.string().optional().describe("New description (Markdown)."),
    labels: z.array(z.string()).optional().describe(
      "Replacement label list. Replaces ALL existing labels."
    ),
    add_labels: z.array(z.string()).optional().describe(
      "Labels to ADD without touching existing ones."
    ),
    remove_labels: z.array(z.string()).optional().describe(
      "Labels to REMOVE without touching others."
    ),
    milestone_id: z.number().int().min(0).optional().describe(
      "Milestone ID to assign. Pass 0 to remove the milestone."
    ),
    assignee_id: z.number().int().min(0).optional().describe(
      "Replacement assignee user ID. Pass 0 to clear the assignee."
    ),
  }),
  z.object({
    action: z.literal("close-issue"),
    iid: z.number().int().min(1).describe("Project-scoped issue IID to close."),
  }),
  z.object({
    action: z.literal("reopen-issue"),
    iid: z.number().int().min(1).describe("Project-scoped issue IID to reopen."),
  }),
  z.object({
    action: z.literal("add-note"),
    iid: z.number().int().min(1).describe("Project-scoped issue IID to comment on."),
    body: z.string().min(1).describe("Comment body (Markdown)."),
  }),
  z.object({
    action: z.literal("create-link"),
    source_iid: z.number().int().min(1).describe("IID of the prerequisite/source issue."),
    target_iid: z.number().int().min(1).describe("IID of the related/dependent issue."),
    link_type: z.enum(["relates-to", "blocks"]).describe("Relationship to create."),
  }),
]);

type Args = z.infer<typeof argsSchema>;

// ---------------------------------------------------------------------------
// Duplicate detection helper
// ---------------------------------------------------------------------------

interface DuplicateCheckResult {
  isDuplicate: boolean;
  existing?: GitLabIssue;
}

async function checkDuplicate(
  title: string,
  context: ToolContext
): Promise<DuplicateCheckResult> {
  const normalised = title.trim().toLowerCase();
  const perPage = 100;

  for (let page = 1; ; page += 1) {
    const candidates = await context.gitlab.listIssues({
      state: "opened",
      search: title,
      page,
      per_page: perPage,
    });
    const match = candidates.find(
      (issue) => issue.title.trim().toLowerCase() === normalised
    );

    if (match) {
      return { isDuplicate: true, existing: match };
    }
    if (candidates.length < perPage) {
      return { isDuplicate: false };
    }
  }
}

// ---------------------------------------------------------------------------
// Label merge helper
// ---------------------------------------------------------------------------

async function resolveLabels(
  iid: number,
  opts: {
    labels?: string[];
    add_labels?: string[];
    remove_labels?: string[];
  },
  context: ToolContext
): Promise<string | undefined> {
  if (opts.labels !== undefined) {
    // Full replacement
    return opts.labels.join(",");
  }

  if (opts.add_labels?.length || opts.remove_labels?.length) {
    // Partial update — fetch current labels
    const issue = await context.gitlab.getIssue(iid);
    const current = new Set(issue.labels);
    for (const l of opts.add_labels ?? []) current.add(l);
    for (const l of opts.remove_labels ?? []) current.delete(l);
    return [...current].join(",");
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const gitlabIssueWriterTool: ToolDefinition<typeof argsSchema> = {
  name: "gitlab-issue-writer",
  description:
    "Create and update GitLab issues for the configured project. " +
    "action='create-issue' creates a new issue with duplicate detection (pass force=true to bypass). " +
    "action='update-issue' patches title, description, labels, milestone, or assignees on an existing issue. " +
    "action='close-issue' / 'reopen-issue' change issue state. " +
    "action='add-note' posts a comment. " +
    "action='create-link' creates a relates-to or blocks issue relationship.",
  argsSchema,

  async execute(args: Args, context: ToolContext): Promise<unknown> {
    const { gitlab } = context;

    switch (args.action) {
      case "create-issue": {
        // Duplicate check unless forced
        if (!args.force) {
          const check = await checkDuplicate(args.title, context);
          if (check.isDuplicate) {
            return {
              duplicate: true,
              message: `An open issue with this title already exists (IID #${check.existing!.iid}). Pass force=true to create anyway.`,
              existing: check.existing,
            };
          }
        }

        return gitlab.createIssue({
          title: args.title,
          description: args.description,
          labels: args.labels,
          milestone_id: args.milestone_id,
          assignee_id: args.assignee_id,
        });
      }

      case "update-issue": {
        const labelString = await resolveLabels(
          args.iid,
          {
            labels: args.labels,
            add_labels: args.add_labels,
            remove_labels: args.remove_labels,
          },
          context
        );

        return gitlab.updateIssue(args.iid, {
          title: args.title,
          description: args.description,
          labels: labelString,
          milestone_id: args.milestone_id,
          assignee_id: args.assignee_id,
        });
      }

      case "close-issue":
        return gitlab.updateIssue(args.iid, { state_event: "close" });

      case "reopen-issue":
        return gitlab.updateIssue(args.iid, { state_event: "reopen" });

      case "add-note":
        return gitlab.createIssueNote(args.iid, args.body);

      case "create-link":
        return gitlab.createIssueLink(
          args.source_iid,
          args.target_iid,
          args.link_type === "relates-to" ? "relates_to" : "blocks"
        );
    }
  },
};
