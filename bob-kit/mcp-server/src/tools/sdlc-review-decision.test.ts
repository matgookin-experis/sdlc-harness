import assert from "node:assert/strict"
import {
  buildReviewDecisionPayload,
  sdlcReviewDecisionArgsSchema,
} from "./sdlc-review-decision.js"
import { buildInputSchema } from "../server.js"

const inputSchema = buildInputSchema(sdlcReviewDecisionArgsSchema)
const properties = inputSchema["properties"] as Record<string, unknown>
for (const field of ["draft", "original_description", "original_updated_at", "edited_value"]) {
  assert.ok(properties[field] !== undefined, `Published schema must expose ${field}`)
}

const timestamp = "2026-08-29T10:00:00.000Z"
const descriptionArgs = sdlcReviewDecisionArgsSchema.parse({
  action: "apply-agent",
  agent: "AM",
  issue_iid: 12,
  finding_action: "rewrite_desc",
  suggested_value: "A precise replacement.",
  edited_value: "An edited replacement.",
  reason: "The original wording is ambiguous.",
  draft: {
    task: "Rewrite the description.",
    context: { description: "Fix it." },
    unknowns: [],
  },
  original_description: "Fix it.",
  original_updated_at: timestamp,
})

if (descriptionArgs.action === "summary") {
  throw new Error("Expected an apply-agent decision.")
}
assert.deepEqual(buildReviewDecisionPayload(descriptionArgs), {
  finding: {
    agent: "AM",
    issueIid: 12,
    action: "rewrite_desc",
    suggestedValue: "A precise replacement.",
    reason: "The original wording is ambiguous.",
    draft: {
      task: "Rewrite the description.",
      context: { description: "Fix it." },
      unknowns: [],
    },
    originalDescription: "Fix it.",
    originalUpdatedAt: timestamp,
  },
  editedValue: "An edited replacement.",
})

const missingOriginalDescription = sdlcReviewDecisionArgsSchema.safeParse({
  action: "apply-agent",
  agent: "AC",
  issue_iid: 12,
  finding_action: "draft_ac",
  suggested_value: "Given a saved preference...",
})
assert.equal(missingOriginalDescription.success, false)

const missingOriginalUpdatedAt = sdlcReviewDecisionArgsSchema.safeParse({
  action: "apply-agent",
  agent: "AC",
  issue_iid: 12,
  finding_action: "draft_ac",
  suggested_value: "Given a saved preference...",
  original_description: "Save the preference.",
})
assert.equal(missingOriginalUpdatedAt.success, false)

const rejectWithoutOriginalUpdatedAt = sdlcReviewDecisionArgsSchema.safeParse({
  action: "reject-agent",
  agent: "AM",
  issue_iid: 12,
  finding_action: "rewrite_desc",
  suggested_value: "A precise replacement.",
  original_description: "Fix it.",
})
assert.equal(rejectWithoutOriginalUpdatedAt.success, true)

const dependencyArgs = sdlcReviewDecisionArgsSchema.parse({
  action: "apply-dependency",
  source_iid: 12,
  target_iid: 13,
  link_type: "blocks",
  edited_value: "relates-to",
  confidence: 0.8,
})
if (dependencyArgs.action === "summary") {
  throw new Error("Expected an apply-dependency decision.")
}
assert.deepEqual(buildReviewDecisionPayload(dependencyArgs), {
  finding: {
    agent: "DEP",
    sourceIid: 12,
    targetIid: 13,
    suggestedLinkType: "blocks",
    confidence: 0.8,
  },
  editedValue: "relates-to",
})

const invalidTimestamp = sdlcReviewDecisionArgsSchema.safeParse({
  action: "reject-agent",
  agent: "AM",
  issue_iid: 12,
  finding_action: "rewrite_desc",
  suggested_value: "A precise replacement.",
  original_description: null,
  original_updated_at: "not-a-timestamp",
})
assert.equal(invalidTimestamp.success, false)

process.stdout.write("sdlc-review-decision.test.ts: all assertions passed\n")
