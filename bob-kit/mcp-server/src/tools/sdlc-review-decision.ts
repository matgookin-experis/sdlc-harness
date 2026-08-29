/**
 * Atomic human-review decisions for Tasks 25 and 26.
 *
 * This is the only MCP write path Bob should use for agent suggestions. It
 * delegates to the compiled skill runtime, which applies the GitLab change and
 * records telemetry together. The generic issue writer remains available for
 * ordinary issue maintenance, not review decisions.
 */

import { z } from "zod";
import type { ToolDefinition, ToolContext } from "../types.js";

const agentAction = z.enum([
  "draft_ac",
  "rewrite_desc",
  "state_transition",
  "missing_coverage",
]);

const agentTag = z.enum(["AC", "AM", "ST", "COV"]);

const argsSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("apply-agent"),
    agent: agentTag,
    issue_iid: z.number().int().min(1),
    finding_action: agentAction,
    suggested_value: z.string().min(1),
    edited_value: z.string().nullable().optional(),
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal("apply-dependency"),
    source_iid: z.number().int().min(1),
    target_iid: z.number().int().min(1),
    link_type: z.enum(["relates-to", "blocks"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal("reject-agent"),
    agent: agentTag,
    issue_iid: z.number().int().min(1),
    finding_action: agentAction,
    suggested_value: z.string().min(1),
    reason: z.string().optional(),
  }),
  z.object({
    action: z.literal("reject-dependency"),
    source_iid: z.number().int().min(1),
    target_iid: z.number().int().min(1),
    link_type: z.enum(["relates-to", "blocks"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().optional(),
  }),
  z.object({ action: z.literal("summary") }),
]);

type Args = z.infer<typeof argsSchema>;

interface ReviewRuntime {
  applyFinding(
    finding: Record<string, unknown>,
    options: { editedValue: string | null }
  ): Promise<unknown>;
  rejectFinding(finding: Record<string, unknown>): Promise<unknown>;
}

interface TelemetryRuntime {
  readTelemetry(): Promise<unknown[]>;
  computeAcceptanceRate(entries: unknown[]): unknown;
}

async function loadRuntime(): Promise<{
  review: ReviewRuntime;
  telemetry: TelemetryRuntime;
}> {
  const reviewUrl = new URL(
    "../../../skills/sdlc-harness/dist/src/skill/review.js",
    import.meta.url
  );
  const telemetryUrl = new URL(
    "../../../skills/sdlc-harness/dist/src/skill/telemetry.js",
    import.meta.url
  );
  try {
    const [review, telemetry] = await Promise.all([
      import(reviewUrl.href) as Promise<ReviewRuntime>,
      import(telemetryUrl.href) as Promise<TelemetryRuntime>,
    ]);
    return { review, telemetry };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown load error";
    throw new Error(
      `The sdlc-harness skill runtime is not built. Run the installer or npm run build in ` +
      `bob-kit/skills/sdlc-harness. (${detail})`
    );
  }
}

function agentFinding(args: Extract<Args, { action: "apply-agent" | "reject-agent" }>) {
  const expectedAction = {
    AC: "draft_ac",
    AM: "rewrite_desc",
    ST: "state_transition",
    COV: "missing_coverage",
  } as const;
  if (expectedAction[args.agent] !== args.finding_action) {
    throw new Error(
      `Agent ${args.agent} cannot perform ${args.finding_action}; expected ${expectedAction[args.agent]}.`
    );
  }
  return {
    agent: args.agent,
    issueIid: args.issue_iid,
    action: args.finding_action,
    suggestedValue: args.suggested_value,
    reason: args.reason,
  };
}

function dependencyFinding(
  args: Extract<Args, { action: "apply-dependency" | "reject-dependency" }>
) {
  return {
    agent: "DEP" as const,
    sourceIid: args.source_iid,
    targetIid: args.target_iid,
    suggestedLinkType: args.link_type,
    confidence: args.confidence,
    reason: args.reason,
  };
}

export const sdlcReviewDecisionTool: ToolDefinition<typeof argsSchema> = {
  name: "sdlc-review-decision",
  description:
    "Apply or reject an sdlc-harness agent suggestion and record telemetry atomically. " +
    "Use this instead of gitlab-issue-writer for AC, ambiguity, transition, dependency, " +
    "and coverage review decisions. action='summary' returns acceptance metrics.",
  argsSchema,

  async execute(args: Args, _context: ToolContext): Promise<unknown> {
    const { review, telemetry } = await loadRuntime();
    switch (args.action) {
      case "apply-agent":
        return review.applyFinding(agentFinding(args), {
          editedValue: args.edited_value ?? null,
        });
      case "apply-dependency":
        return review.applyFinding(dependencyFinding(args), { editedValue: null });
      case "reject-agent":
        return review.rejectFinding(agentFinding(args));
      case "reject-dependency":
        return review.rejectFinding(dependencyFinding(args));
      case "summary": {
        const entries = await telemetry.readTelemetry();
        return telemetry.computeAcceptanceRate(entries);
      }
    }
  },
};
