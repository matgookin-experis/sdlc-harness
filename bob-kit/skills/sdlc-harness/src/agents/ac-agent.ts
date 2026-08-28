/**
 * ac-agent.ts — Acceptance Criteria Agent (Task 20).
 *
 * Detects issues that lack acceptance criteria and proposes a specific
 * Given-When-Then draft based on the issue title and description.
 *
 * Returns null when the issue already contains usable acceptance criteria.
 * This is a pure, deterministic function — no network calls, no side effects.
 */

import type { IssueInput, ProjectConfig, AgentFinding } from '../models';

// ---------------------------------------------------------------------------
// AC detection helpers
// ---------------------------------------------------------------------------

/**
 * Patterns conclusive on their own — heading or section-marker based.
 */
const AC_HEADING_PATTERNS: RegExp[] = [
  /acceptance.criteria/i,
  /##\s*ac\b/i,
  /##\s*criteria/i,
];

/**
 * Returns true if the description contains structured multi-line GWT:
 * all three of Given / When / Then must each begin a line (optionally preceded
 * by bold markers `**`).
 *
 * This is stricter than looking for three keywords on one line, which would
 * match ordinary prose such as:
 *   "Given the deadline is tight, when we ship this, then keep scope small."
 * Real AC is structured — each clause starts its own line.
 */
function hasStructuredGWT(description: string): boolean {
  const hasGiven = /^\s*(\*\*)?given\b/im.test(description);
  const hasWhen  = /^\s*(\*\*)?when\b/im.test(description);
  const hasThen  = /^\s*(\*\*)?then\b/im.test(description);
  return hasGiven && hasWhen && hasThen;
}

/**
 * Returns true if the description already contains recognisable AC.
 *
 * Detection strategy:
 *  1. An explicit AC heading ("Acceptance Criteria", "## AC", "## Criteria") is
 *     unambiguous on its own.
 *  2. Structured multi-line GWT: Given / When / Then each start their own line
 *     (optionally bold). A prose sentence where the three words appear on a
 *     single line without structural markers does NOT qualify.
 */
export function hasAcceptanceCriteria(description: string | null): boolean {
  if (!description || description.trim().length === 0) return false;
  if (AC_HEADING_PATTERNS.some((re) => re.test(description))) return true;
  return hasStructuredGWT(description);
}

// ---------------------------------------------------------------------------
// AC drafting
// ---------------------------------------------------------------------------

/**
 * Infer the primary actor from work-item type labels.
 * Defaults to "user" when no type label is recognised.
 */
function inferActor(labels: string[]): string {
  const lower = labels.map((l) => l.toLowerCase());
  if (lower.some((l) => l.includes('bug'))) return 'tester';
  if (lower.some((l) => l.includes('task'))) return 'developer';
  if (lower.some((l) => l.includes('epic'))) return 'product owner';
  return 'user';
}

/**
 * Conjugate the leading verb of an issue title to third-person singular present
 * tense so the When line is grammatical: "When the user adds dark mode toggle…"
 *
 * A closed set of common issue-title verbs is handled explicitly; all others
 * fall through with a plain "s" appended (covers most regular English verbs).
 * "set up" is treated as a two-word verb → "sets up".
 */
function conjugateTitle(title: string): string {
  const lower = title.trim().toLowerCase();

  // Two-word verb: "set up …" → "sets up …"
  const setUpMatch = lower.match(/^set\s+up\b(.*)/);
  if (setUpMatch) return `sets up${setUpMatch[1]}`;

  // Map of base form → 3rd-person singular for verbs needing a spelling change.
  const conjugateMap: Record<string, string> = {
    add:       'adds',
    fix:       'fixes',
    build:     'builds',
    create:    'creates',
    update:    'updates',
    remove:    'removes',
    write:     'writes',
    implement: 'implements',
    delete:    'deletes',
    enable:    'enables',
    disable:   'disables',
    refactor:  'refactors',
    migrate:   'migrates',
    expose:    'exposes',
    render:    'renders',
    deploy:    'deploys',
    configure: 'configures',
    integrate: 'integrates',
    replace:   'replaces',
    improve:   'improves',
    extend:    'extends',
    extract:   'extracts',
  };

  const match = lower.match(/^(\w+)(.*)/);
  if (!match) return lower;

  const verb = match[1];
  const rest = match[2];
  const conjugated = conjugateMap[verb] ?? (verb + 's');
  return conjugated + rest;
}

/**
 * Build a minimal but concrete Given-When-Then draft from available metadata.
 *
 * The When line uses conjugateTitle() so it reads grammatically:
 *   "When the user adds dark mode toggle to the settings page."
 *
 * No subjective qualifiers ("correctly", "properly", "nicely") are used in
 * the template, to avoid triggering the ambiguity agent on the AC agent's own
 * output.
 */
function draftAC(issue: IssueInput): string {
  const actor = inferActor(issue.labels);
  const titlePhrase = conjugateTitle(issue.title);
  const desc = issue.description ?? '';

  // Extract a candidate precondition from the description (first sentence ≤120 chars)
  const firstSentence = desc.split(/[.!?]/)[0]?.trim() ?? '';
  const precondition =
    firstSentence.length > 0 && firstSentence.length <= 120
      ? firstSentence
      : `the ${actor} is authenticated and the system is operational`;

  const lines = [
    `**Acceptance Criteria**`,
    ``,
    `**Given** ${precondition}`,
    `**When** the ${actor} ${titlePhrase}`,
    `**Then** the change takes effect and is visible in the UI`,
    ``,
    `**Given** an error condition occurs`,
    `**When** the ${actor} attempts the action`,
    `**Then** the system displays a clear error message and no data is corrupted`,
  ];

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Agent entry point
// ---------------------------------------------------------------------------

/**
 * Run the acceptance-criteria agent against a single issue.
 *
 * @returns An AgentFinding with a Given-When-Then draft, or null if the issue
 *          already has usable acceptance criteria.
 */
export async function runAcAgent(
  issue: IssueInput,
  _config: ProjectConfig
): Promise<AgentFinding | null> {
  if (hasAcceptanceCriteria(issue.description)) {
    return null;
  }

  const suggestedValue = draftAC(issue);

  return {
    agent: 'AC',
    issueIid: issue.iid,
    action: 'draft_ac',
    suggestedValue,
    reason:
      'No acceptance criteria found in the issue description. ' +
      'A Given-When-Then draft has been generated from the title and description.',
  };
}
