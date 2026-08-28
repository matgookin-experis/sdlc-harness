/**
 * work-item-format.ts — canonical work item formatting standard.
 *
 * This tool encodes the team's formatting rules so every agent defers to
 * the same source of truth when drafting or reviewing work items.
 *
 * Exposed operations:
 *  - get-standard  : return the full formatting standard (all types)
 *  - get-template  : return the template for a specific work item type
 *  - validate-item : validate a title/description against the standard
 *                    and return a list of violations with suggested fixes
 */

import { z } from "zod";
import type { ToolDefinition, ToolContext } from "../types.js";

// ---------------------------------------------------------------------------
// The formatting standard (embedded — no network, no file read)
// ---------------------------------------------------------------------------

const WORK_ITEM_TYPES = ["Epic", "Feature", "User Story", "Bug", "Task"] as const;
type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

interface WorkItemTemplate {
  type: WorkItemType;
  titleRules: string[];
  descriptionStructure: string;
  acceptanceCriteriaFormat: string;
  example: {
    title: string;
    description: string;
  };
}

const TEMPLATES: Record<WorkItemType, WorkItemTemplate> = {
  Epic: {
    type: "Epic",
    titleRules: [
      "Noun-phrase format: describe the capability, not the action.",
      "Title case for all significant words.",
      "No verbs at the start (avoid 'Implement', 'Build', 'Create').",
      "Max 60 characters.",
    ],
    descriptionStructure:
      "## Hypothesis\n" +
      "One sentence on why this initiative matters.\n\n" +
      "## Goals\n" +
      "Bulleted list of measurable outcomes.\n\n" +
      "## Scope\n" +
      "What is included and explicitly excluded.\n\n" +
      "## Child Features\n" +
      "- [ ] Feature 1\n" +
      "- [ ] Feature 2",
    acceptanceCriteriaFormat: "Epics do not carry acceptance criteria — use Features.",
    example: {
      title: "Automated Work Item Quality Governance",
      description:
        "## Hypothesis\nTeams lose hours per sprint correcting malformed work items.\n\n" +
        "## Goals\n- Reduce missing-AC rate by 80%\n- Reduce vague descriptions flagged in review by 60%\n\n" +
        "## Scope\nIn: GitLab Issues, AC drafting, ambiguity detection.\nOut: CI/CD pipelines, code review.\n\n" +
        "## Child Features\n- [ ] Acceptance Criteria Agent\n- [ ] Ambiguity Detection Agent",
    },
  },

  Feature: {
    type: "Feature",
    titleRules: [
      "Verb-noun phrase: start with an action verb.",
      "Title case for all significant words.",
      "Examples: 'Draft Missing Acceptance Criteria', 'Flag Ambiguous Descriptions'.",
      "Max 60 characters.",
    ],
    descriptionStructure:
      "## Overview\n" +
      "One to three sentences on what this feature delivers and why.\n\n" +
      "## Scope\n" +
      "Bulleted list of what is included. Add an 'Out of scope' sub-list.\n\n" +
      "## Child Stories\n" +
      "- [ ] User Story 1\n" +
      "- [ ] User Story 2",
    acceptanceCriteriaFormat: "Features do not carry acceptance criteria — use User Stories.",
    example: {
      title: "Draft Missing Acceptance Criteria",
      description:
        "## Overview\nAutomatically detects issues without AC and proposes well-formed Given-When-Then criteria.\n\n" +
        "## Scope\n- Detect issues with empty or absent AC field\n- Draft AC from description context\n- Present draft for human approval\n\nOut of scope: auto-apply without human review.\n\n" +
        "## Child Stories\n- [ ] As a dev, I can see AC suggestions inline in Bob",
    },
  },

  "User Story": {
    type: "User Story",
    titleRules: [
      "Connextra format: 'As a <role>, I can <action> so that <benefit>'.",
      "Sentence case (only first word and proper nouns capitalised).",
      "Max 120 characters.",
    ],
    descriptionStructure:
      "**As a** <role>, **I can** <action> **so that** <benefit>.\n\n" +
      "## Acceptance Criteria\n" +
      "<Given-When-Then criteria here>",
    acceptanceCriteriaFormat:
      "Given-When-Then format, one scenario per criterion:\n\n" +
      "**Given** <precondition>\n" +
      "**When** <action>\n" +
      "**Then** <expected outcome>\n\n" +
      "Each criterion must be independently verifiable.",
    example: {
      title: "As a developer, I can see suggested AC drafted by the agent so that I spend less time writing boilerplate",
      description:
        "**As a** developer, **I can** see acceptance criteria suggestions drafted by the AC agent " +
        "**so that** I spend less time writing boilerplate and more time on implementation.\n\n" +
        "## Acceptance Criteria\n\n" +
        "**Given** an issue has no acceptance criteria\n" +
        "**When** the AC agent runs\n" +
        "**Then** a draft AC block appears as a comment on the issue\n\n" +
        "**Given** a draft AC is posted\n" +
        "**When** the developer reviews it in Bob\n" +
        "**Then** they can approve, edit, or reject the suggestion in natural language",
    },
  },

  Bug: {
    type: "Bug",
    titleRules: [
      "Format: '<Component>: <symptom observed>'.",
      "Sentence case.",
      "Describe the symptom, not the cause.",
      "Max 120 characters.",
    ],
    descriptionStructure:
      "## Steps to Reproduce\n" +
      "Numbered list of exact reproduction steps.\n\n" +
      "## Expected Behaviour\n" +
      "What should happen.\n\n" +
      "## Actual Behaviour\n" +
      "What actually happens.\n\n" +
      "## Environment\n" +
      "OS, browser, version, etc.",
    acceptanceCriteriaFormat:
      "Given-When-Then format focused on the fix:\n\n" +
      "**Given** <condition that previously triggered the bug>\n" +
      "**When** <action that triggered it>\n" +
      "**Then** <correct behaviour now expected>",
    example: {
      title: "AC Agent: draft is not posted when issue description is empty",
      description:
        "## Steps to Reproduce\n1. Create an issue with no description.\n2. Run the AC agent.\n\n" +
        "## Expected Behaviour\nThe agent posts a comment noting it cannot draft AC without a description.\n\n" +
        "## Actual Behaviour\nThe agent silently skips the issue with no feedback.\n\n" +
        "## Environment\nsdlc-harness v0.1, self-hosted GitLab CE 16.x",
    },
  },

  Task: {
    type: "Task",
    titleRules: [
      "Imperative verb phrase: start with a verb.",
      "Sentence case.",
      "Examples: 'Add rate-limit handling to gitlab-client', 'Write smoke test for issue reader'.",
      "Max 80 characters.",
    ],
    descriptionStructure:
      "One to three sentences describing the technical work to be done.\n" +
      "Include any relevant file paths, interfaces, or constraints.",
    acceptanceCriteriaFormat: "Tasks do not require formal AC — use a clear Definition of Done in the description.",
    example: {
      title: "Add pagination support to listIssues in gitlab-client",
      description:
        "Extend `GitLabClient.listIssues()` to accept `page` and `per_page` parameters " +
        "and pass them through to the GitLab API. Update the corresponding tool schema. " +
        "Verified when `npm run smoke` passes with paginated fixture data.",
    },
  },
};

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

interface ValidationViolation {
  field: "title" | "description" | "acceptanceCriteria";
  rule: string;
  suggestion?: string;
}

function validateItem(
  type: WorkItemType,
  title: string,
  description?: string,
  acceptanceCriteria?: string
): ValidationViolation[] {
  const template = TEMPLATES[type];
  const violations: ValidationViolation[] = [];

  // --- Title checks ---
  if (title.length > 120) {
    violations.push({
      field: "title",
      rule: "Title exceeds 120 characters.",
      suggestion: "Shorten to the core action/outcome.",
    });
  }
  if (type === "User Story" && !title.toLowerCase().startsWith("as a")) {
    violations.push({
      field: "title",
      rule: "User Story titles must follow Connextra format: 'As a <role>, I can...'.",
      suggestion: `Rewrite as: "${template.example.title}"`,
    });
  }
  if (type === "Bug" && !title.includes(":")) {
    violations.push({
      field: "title",
      rule: "Bug titles must follow '<Component>: <symptom>' format.",
      suggestion: `Example: "${template.example.title}"`,
    });
  }

  // --- Description checks ---
  if (!description || description.trim().length === 0) {
    violations.push({
      field: "description",
      rule: "Description is empty.",
      suggestion: `Use the ${type} template:\n${template.descriptionStructure}`,
    });
  }

  // --- Acceptance criteria checks (User Story and Bug only) ---
  if (type === "User Story" || type === "Bug") {
    if (!acceptanceCriteria || acceptanceCriteria.trim().length === 0) {
      violations.push({
        field: "acceptanceCriteria",
        rule: "Acceptance criteria are required for User Stories and Bugs.",
        suggestion: `Use Given-When-Then format:\n${template.acceptanceCriteriaFormat}`,
      });
    } else {
      const hasGiven = /given/i.test(acceptanceCriteria);
      const hasWhen = /when/i.test(acceptanceCriteria);
      const hasThen = /then/i.test(acceptanceCriteria);
      if (!hasGiven || !hasWhen || !hasThen) {
        violations.push({
          field: "acceptanceCriteria",
          rule: "Acceptance criteria must use Given-When-Then structure.",
          suggestion: `Example:\n${template.acceptanceCriteriaFormat}`,
        });
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Tool schema
// ---------------------------------------------------------------------------

const argsSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("get-standard"),
    type: z.enum(WORK_ITEM_TYPES).optional().describe(
      "Return standard for a specific type only. Omit for the full standard."
    ),
  }),
  z.object({
    action: z.literal("get-template"),
    type: z.enum(WORK_ITEM_TYPES).describe("Work item type to get the template for."),
  }),
  z.object({
    action: z.literal("validate-item"),
    type: z.enum(WORK_ITEM_TYPES).describe("Work item type to validate against."),
    title: z.string().describe("Issue title to validate."),
    description: z.string().optional().describe("Issue description to validate."),
    acceptanceCriteria: z.string().optional().describe(
      "Acceptance criteria to validate (relevant for User Story and Bug)."
    ),
  }),
]);

type Args = z.infer<typeof argsSchema>;

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export const workItemFormatTool: ToolDefinition<typeof argsSchema> = {
  name: "work-item-format",
  description:
    "Return and validate work item formatting standards. " +
    "action='get-standard' returns the full formatting standard (optionally filtered to one type). " +
    "action='get-template' returns the template (structure + example) for a specific type. " +
    "action='validate-item' checks a title/description/AC against the standard and returns violations with fixes.",
  argsSchema,

  // Context is not needed (all data is embedded) but must match the signature
  async execute(args: Args, _context: ToolContext): Promise<unknown> {
    switch (args.action) {
      case "get-standard": {
        if (args.type) {
          return { standard: TEMPLATES[args.type] };
        }
        return { standard: TEMPLATES };
      }

      case "get-template": {
        return { template: TEMPLATES[args.type] };
      }

      case "validate-item": {
        const violations = validateItem(
          args.type,
          args.title,
          args.description,
          args.acceptanceCriteria
        );
        return {
          valid: violations.length === 0,
          violations,
          template: TEMPLATES[args.type],
        };
      }
    }
  },
};
