/**
 * Guarded human-review decisions for Tasks 25 and 26.
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

const draftBrief = z.object({
  task: z.string().min(1),
  context: z.record(z.string()),
  unknowns: z.array(z.string()),
});

const originalUpdatedAt = z.string().refine(
  (value) => Number.isFinite(Date.parse(value)),
  "Must be a valid timestamp."
);

const baseArgsSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("apply-agent"),
    agent: agentTag,
    issue_iid: z.number().int().min(1),
    finding_action: agentAction,
    suggested_value: z.string().min(1),
    edited_value: z.string().nullable().optional(),
    reason: z.string().optional(),
    draft: draftBrief.optional(),
    original_description: z.string().nullable().optional(),
    original_updated_at: originalUpdatedAt.optional(),
  }),
  z.object({
    action: z.literal("apply-dependency"),
    source_iid: z.number().int().min(1),
    target_iid: z.number().int().min(1),
    link_type: z.enum(["relates-to", "blocks"]),
    edited_value: z.enum(["relates-to", "blocks"]).nullable().optional(),
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
    draft: draftBrief.optional(),
    original_description: z.string().nullable().optional(),
    original_updated_at: originalUpdatedAt.optional(),
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

export const sdlcReviewDecisionArgsSchema = baseArgsSchema.superRefine((args, context) => {
  const changesDescription =
    (args.action === "apply-agent" || args.action === "reject-agent") &&
    (args.finding_action === "draft_ac" || args.finding_action === "rewrite_desc");
  if (
    changesDescription &&
    !Object.hasOwn(args, "original_description")
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Description findings must carry original_description.",
      path: ["original_description"],
    });
  }
  if (args.action === "apply-agent" && changesDescription && args.original_updated_at === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Description apply decisions must carry original_updated_at.",
      path: ["original_updated_at"],
    });
  }
});

type Args = z.infer<typeof sdlcReviewDecisionArgsSchema>;
type DecisionArgs = Exclude<Args, { action: "summary" }>;

interface DecisionPayload {
  finding: Record<string, unknown>;
  editedValue: string | null;
}

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

interface ReviewPayloadRuntime {
  parseDecisionPayload(value: unknown, operation: "apply" | "reject"): DecisionPayload;
}

async function loadRuntime(): Promise<{
  review: ReviewRuntime;
  reviewPayload: ReviewPayloadRuntime;
  telemetry: TelemetryRuntime;
}> {
  const reviewUrl = new URL(
    "../../../skills/sdlc-harness/dist/src/skill/review.js",
    import.meta.url
  );
  const reviewPayloadUrl = new URL(
    "../../../skills/sdlc-harness/dist/src/skill/review-payload.js",
    import.meta.url
  );
  const telemetryUrl = new URL(
    "../../../skills/sdlc-harness/dist/src/skill/telemetry.js",
    import.meta.url
  );
  try {
    const [review, reviewPayload, telemetry] = await Promise.all([
      import(reviewUrl.href) as Promise<ReviewRuntime>,
      import(reviewPayloadUrl.href) as Promise<ReviewPayloadRuntime>,
      import(telemetryUrl.href) as Promise<TelemetryRuntime>,
    ]);
    return { review, reviewPayload, telemetry };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown load error";
    throw new Error(
      `The sdlc-harness skill runtime is not built. Run the installer or npm run build in ` +
      `bob-kit/skills/sdlc-harness. (${detail})`
    );
  }
}

function agentFinding(
  args: Extract<Args, { action: "apply-agent" | "reject-agent" }>
): Record<string, unknown> {
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
  const finding: Record<string, unknown> = {
    agent: args.agent,
    issueIid: args.issue_iid,
    action: args.finding_action,
    suggestedValue: args.suggested_value,
  };
  if (args.reason !== undefined) finding.reason = args.reason;
  if (args.draft !== undefined) finding.draft = args.draft;
  if (Object.hasOwn(args, "original_description")) {
    finding.originalDescription = args.original_description;
  }
  if (args.original_updated_at !== undefined) {
    finding.originalUpdatedAt = args.original_updated_at;
  }
  return finding;
}

function dependencyFinding(
  args: Extract<Args, { action: "apply-dependency" | "reject-dependency" }>
): Record<string, unknown> {
  const finding: Record<string, unknown> = {
    agent: "DEP" as const,
    sourceIid: args.source_iid,
    targetIid: args.target_iid,
    suggestedLinkType: args.link_type,
    confidence: args.confidence,
  };
  if (args.reason !== undefined) finding.reason = args.reason;
  return finding;
}

/** Convert MCP arguments to the decision payload validated by the shared skill runtime. */
export function buildReviewDecisionPayload(args: DecisionArgs): DecisionPayload {
  switch (args.action) {
    case "apply-agent":
      return {
        finding: agentFinding(args),
        editedValue: args.edited_value ?? null,
      };
    case "apply-dependency":
      return {
        finding: dependencyFinding(args),
        editedValue: args.edited_value ?? null,
      };
    case "reject-agent":
      return { finding: agentFinding(args), editedValue: null };
    case "reject-dependency":
      return { finding: dependencyFinding(args), editedValue: null };
  }
}

export const sdlcReviewDecisionTool: ToolDefinition<typeof sdlcReviewDecisionArgsSchema> = {
  name: "sdlc-review-decision",
  description:
    "Apply or reject an sdlc-harness agent suggestion and record its telemetry. " +
    "Use this instead of gitlab-issue-writer for AC, ambiguity, transition, dependency, " +
    "and coverage review decisions. action='summary' returns acceptance metrics.",
  argsSchema: sdlcReviewDecisionArgsSchema,

  async execute(args: Args, _context: ToolContext): Promise<unknown> {
    const { review, reviewPayload, telemetry } = await loadRuntime();
    if (args.action === "summary") {
      const entries = await telemetry.readTelemetry();
      return telemetry.computeAcceptanceRate(entries);
    }

    const rejects = args.action === "reject-agent" || args.action === "reject-dependency";
    const payload = reviewPayload.parseDecisionPayload(
      buildReviewDecisionPayload(args),
      rejects ? "reject" : "apply"
    );
    if (rejects) {
      return review.rejectFinding(payload.finding);
    }
    return review.applyFinding(payload.finding, { editedValue: payload.editedValue });
  },
};
