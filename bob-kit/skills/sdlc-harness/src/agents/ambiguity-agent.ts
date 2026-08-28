/**
 * ambiguity-agent.ts — Ambiguity Detection Agent (Task 21).
 *
 * Detects vague, subjective, placeholder, or non-testable wording in issue
 * titles and descriptions, and proposes a concrete rewrite.
 *
 * Returns null for clear, specific descriptions to avoid false positives.
 * This is a pure, deterministic function — no network calls, no side effects.
 *
 * ADVISORY ONLY: findings produced by this agent have action = 'rewrite_desc'
 * but the suggestedValue is a structured prompt rather than verbatim
 * replacement text.  The review interface must NOT write the suggestedValue
 * directly into the issue description; it should be presented to the author
 * as guidance.  This is documented in the reason field and in SKILL.md §Phase 4.
 */

import type { IssueInput, ProjectConfig, AgentFinding } from '../models';

// ---------------------------------------------------------------------------
// Vagueness detection
// ---------------------------------------------------------------------------

/**
 * Vague-language patterns. Checked against the full title+description text.
 *
 * Each entry includes a label (for the reason) and the regex to match.
 * The patterns are ordered roughly from highest to lowest signal strength.
 *
 * NOTE: "correctly" and "properly" are NOT listed here because the AC agent's
 * own output template no longer uses them.  They were removed to prevent a
 * false-positive loop where agent 20 drafts text that agent 21 immediately flags.
 */
const VAGUE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  // Placeholder phrases
  { label: 'placeholder phrase ("TBD", "TODO", "FIXME")',       re: /\b(tbd|todo|fixme|placeholder|xxx)\b/i },
  // "the thing", "the stuff", "something", "somehow"
  { label: 'non-specific pronoun ("the thing", "something")',   re: /\b(the\s+thing|the\s+stuff|something|somehow|some\s+way)\b/i },
  // "it", "this" as the sole subject near a verb
  { label: 'vague subject ("it doesn\'t work", "fix it")',      re: /\b(it\s+(doesn'?t|does\s+not|isn'?t|is\s+not)\s+work|fix\s+it\b)/i },
  // "not work" / "doesn't work" without context
  { label: 'non-testable description ("does not work")',        re: /\bdoes\s+not\s+work\b|\bdoesn'?t\s+work\b/i },
  // "various", "several", "many" with no specifics
  { label: 'vague quantity ("various", "several things")',      re: /\b(various|several\s+things|many\s+things|some\s+issues|a\s+few\s+things)\b/i },
];

/** Minimum description length to be considered adequately specific. */
const MIN_SPECIFIC_DESCRIPTION_LENGTH = 80;

/** Indicators of a concrete, specific description. */
const SPECIFICITY_SIGNALS: RegExp[] = [
  /\/[a-z0-9_/-]+/,            // file path or endpoint
  /\bapi\b/i,
  /\bcomponent\b/i,
  /\bendpoint\b/i,
  /`[^`]+`/,                    // inline code
  /https?:\/\//,                // URL
  /\bclass\b|\bfunction\b|\bmethod\b/i,
];

/**
 * Return the first matching vague pattern label, or null if none match.
 */
function detectVagueness(text: string): string | null {
  for (const { label, re } of VAGUE_PATTERNS) {
    if (re.test(text)) return label;
  }
  return null;
}

/**
 * Return true if the description shows enough specificity signals that
 * the agent should not raise a finding even if a minor vague word appears.
 */
function isConcreteEnough(description: string): boolean {
  if (description.length >= MIN_SPECIFIC_DESCRIPTION_LENGTH) {
    const signals = SPECIFICITY_SIGNALS.filter((re) => re.test(description)).length;
    if (signals >= 2) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Rewrite helper
// ---------------------------------------------------------------------------

/**
 * Generate a structured guidance prompt based on the detected vagueness.
 *
 * IMPORTANT: this is ADVISORY ONLY.  The returned text is a scaffold that
 * helps the author write a better description; it is NOT intended to replace
 * the description verbatim.  The review interface must present it as guidance
 * rather than writing it directly into the issue.
 *
 * The scaffold uses concrete nouns already present in the description
 * (code refs, file paths) so that the guidance is specific to the issue,
 * but no fill-in placeholders like "[specific action]" are used.
 */
function buildRewrite(issue: IssueInput, vagueLabel: string): string {
  const desc = issue.description ?? '';

  // Extract any concrete nouns already present in the description
  const codeRef = desc.match(/`([^`]+)`/)?.[1];
  const pathRef = desc.match(/\/[a-z0-9_/-]+/)?.[0];
  // Use a concrete reference from the description if one is available.
  // Do NOT fall back to issue.title: the title may itself contain the vague
  // language that triggered this finding, so echoing it into the suggestion
  // would repeat the problem rather than model a better phrasing.
  const anchor = codeRef ?? pathRef ?? 'this feature';

  const lines: string[] = [
    `**Advisory — vague wording detected** (${vagueLabel})`,
    ``,
    `The description needs more precision. Consider adding the following:`,
    ``,
    `**What specifically goes wrong or needs to change?**`,
    `  Describe the exact symptom or requirement for "${anchor}".`,
    ``,
    `**What is the expected outcome?**`,
    `  State the measurable, observable result.`,
    ``,
    `**What is the actual / current behaviour?**`,
    `  Describe what happens now instead.`,
    ``,
    `**Relevant context** (file paths, endpoints, error messages, environment):`,
    `  Add any paths, error codes, or configuration details that narrow the scope.`,
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Agent entry point
// ---------------------------------------------------------------------------

/**
 * Run the ambiguity-detection agent against a single issue.
 *
 * @returns An AgentFinding with advisory rewrite guidance, or null if the
 *          description is already sufficiently specific.
 *
 * NOTE: the suggestedValue is ADVISORY ONLY — see module comment above.
 */
export async function runAmbiguityAgent(
  issue: IssueInput,
  _config: ProjectConfig
): Promise<AgentFinding | null> {
  const fullText = `${issue.title} ${issue.description ?? ''}`;

  // Fast-path: if the description is specific enough, skip
  if (isConcreteEnough(issue.description ?? '')) {
    return null;
  }

  const vagueLabel = detectVagueness(fullText);
  if (!vagueLabel) return null;

  const suggestedValue = buildRewrite(issue, vagueLabel);

  return {
    agent: 'AM',
    issueIid: issue.iid,
    action: 'rewrite_desc',
    suggestedValue,
    reason:
      `Detected ${vagueLabel} in issue title or description. ` +
      `The finding is ADVISORY ONLY — the suggestedValue is guidance for the author, ` +
      `not replacement text to write verbatim into the description.`,
  };
}
