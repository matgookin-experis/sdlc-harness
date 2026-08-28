import type { IssueInput, ProjectConfig, AgentFinding, DraftBrief } from '../models';

const AC_HEADINGS = [/acceptance.criteria/i, /##\s*ac\b/i, /##\s*criteria/i];

/**
 * Real acceptance criteria are structured — each clause opens its own line.
 * Matching the three keywords anywhere would swallow ordinary prose such as
 * "Given the deadline is tight, when we ship this, then keep scope small."
 */
function hasStructuredGWT(text: string): boolean {
  return (
    /^\s*(\*\*)?given\b/im.test(text) &&
    /^\s*(\*\*)?when\b/im.test(text) &&
    /^\s*(\*\*)?then\b/im.test(text)
  );
}

export function hasAcceptanceCriteria(description: string | null): boolean {
  if (!description || !description.trim()) return false;
  return AC_HEADINGS.some((re) => re.test(description)) || hasStructuredGWT(description);
}

/** Label vocabulary shared with the work-item-format MCP tool. */
const TYPE_BY_LABEL: Array<[RegExp, string]> = [
  [/\bbug\b|\bdefect\b/i, 'Bug'],
  [/\bepic\b/i, 'Epic'],
  [/\bfeature\b/i, 'Feature'],
  [/\btask\b|\bchore\b/i, 'Task'],
];

function workItemType(labels: string[]): string {
  const joined = labels.join(' ');
  const hit = TYPE_BY_LABEL.find(([re]) => re.test(joined));
  return hit ? hit[1] : 'User Story';
}

const ACTOR_BY_TYPE: Record<string, string> = {
  Bug: 'tester',
  Task: 'developer',
  Epic: 'product owner',
};

/**
 * Gaps the drafter cannot fill from the issue alone. Each one becomes a
 * question put to the author instead of a guess.
 */
function findGaps(issue: IssueInput): string[] {
  const desc = (issue.description ?? '').trim();
  const gaps: string[] = [];

  if (!desc) {
    gaps.push('The issue has no description. Ask the author what "done" looks like before drafting.');
    return gaps;
  }
  if (desc.length < 40) {
    gaps.push('The description is a single line. Ask what the expected outcome is.');
  }
  if (!/\b(when|if|after|once|given)\b/i.test(desc)) {
    gaps.push('No trigger or precondition is stated. Ask what starts the behaviour.');
  }
  if (/\b(error|fail|invalid|reject|timeout)\b/i.test(desc) === false) {
    gaps.push('No failure case is described. Ask what should happen when it goes wrong.');
  }
  return gaps;
}

function buildBrief(issue: IssueInput): DraftBrief {
  const type = workItemType(issue.labels);
  const actor = ACTOR_BY_TYPE[type] ?? 'user';

  return {
    task:
      `Write 2-4 acceptance criteria for this ${type} in Given-When-Then form. ` +
      `Call work-item-format get-template with type "${type}" and follow the structure it returns. ` +
      `Ground every clause in the issue's own title and description — no filler such as ` +
      `"the system responds correctly" or "the change is visible in the UI", which say nothing ` +
      `and would be true of any issue.`,
    context: {
      title: issue.title,
      description: issue.description ?? '',
      workItemType: type,
      actor,
      labels: issue.labels.join(', '),
    },
    unknowns: findGaps(issue),
  };
}

/**
 * Placeholder used only when no drafter is available. It deliberately does not
 * look like finished criteria: applyFinding refuses to write any finding that
 * still carries a draft brief, so this text can never reach an issue.
 */
function undraftedPlaceholder(issue: IssueInput): string {
  return `Acceptance criteria not yet drafted for "${issue.title}".`;
}

export async function runAcAgent(
  issue: IssueInput,
  _config: ProjectConfig
): Promise<AgentFinding | null> {
  if (hasAcceptanceCriteria(issue.description)) return null;

  return {
    agent: 'AC',
    issueIid: issue.iid,
    action: 'draft_ac',
    suggestedValue: undraftedPlaceholder(issue),
    draft: buildBrief(issue),
    reason: 'No acceptance criteria found in the description.',
  };
}
