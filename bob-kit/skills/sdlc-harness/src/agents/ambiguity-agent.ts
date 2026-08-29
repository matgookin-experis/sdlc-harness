import type { IssueInput, ProjectConfig, AgentFinding, DraftBrief } from '../models';

/**
 * Wording that cannot be tested against. Each pattern captures the offending
 * span so the drafter is told exactly what to replace, rather than being handed
 * a vague complaint about the description as a whole.
 *
 * "correctly" and "properly" are deliberately absent: the AC agent's own output
 * used to contain them, and flagging it created a loop where one agent's
 * suggestion tripped the other's detector.
 */
const VAGUE_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: 'placeholder', re: /\b(tbd|todo|fixme|placeholder|xxx)\b/i },
  { label: 'non-specific pronoun', re: /\b(the\s+thing|the\s+stuff|some\s+things|something|somehow|some\s+way)\b/i },
  { label: 'vague subject', re: /\b(it\s+(?:doesn'?t|does\s+not|isn'?t|is\s+not)\s+work|fix\s+it)\b/i },
  { label: 'non-testable defect', re: /\b(?:(?:does\s+not|doesn'?t)\s+work(?:\s+well)?|(?:is|are|seems?)\s+broken)\b/i },
  { label: 'unbounded improvement', re: /\bmake\s+(?:it|this|them)\s+(?:look\s+)?(?:better|faster|nicer)(?:\s+and\s+(?:better|faster|nicer|more\s+professional))*\b/i },
  { label: 'subjective presentation', re: /\b(?:looks?\s+(?:a\s+bit\s+)?cluttered|aligned\s+better|colou?rs?\s+(?:do\s+not|don'?t)\s+look\s+right)\b/i },
  { label: 'vague quantity', re: /\b(various|several\s+things|many\s+things|some\s+issues|a\s+few\s+things)\b/i },
];

const NON_EXEMPT_LABELS = new Set([
  'placeholder',
  'vague subject',
  'non-testable defect',
  'unbounded improvement',
  'subjective presentation',
]);

/**
 * Signals that an author has already been specific. Two or more of these in a
 * description of reasonable length outweighs a single loose word.
 */
const SPECIFICITY_SIGNALS = [
  /\/[a-z0-9_/-]+/,
  /`[^`]+`/,
  /https?:\/\//,
  /\bapi\b/i,
  /\bcomponent\b/i,
  /\bendpoint\b/i,
  /\bclass\b|\bfunction\b|\bmethod\b/i,
];

const MIN_SPECIFIC_LENGTH = 80;

function isConcreteEnough(description: string): boolean {
  if (description.length < MIN_SPECIFIC_LENGTH) return false;
  return SPECIFICITY_SIGNALS.filter((re) => re.test(description)).length >= 2;
}

interface Flag {
  label: string;
  phrase: string;
}

function findVaguePhrases(text: string): Flag[] {
  const flags: Flag[] = [];
  for (const { label, re } of VAGUE_PATTERNS) {
    const m = text.match(re);
    if (m) flags.push({ label, phrase: m[0] });
  }
  return flags;
}

/** Concrete anchors already present in the issue, offered to the drafter as reusable material. */
function anchors(description: string): string[] {
  const found = new Set<string>();
  for (const re of [/`([^`]+)`/g, /\/[a-z0-9_/-]{3,}/g, /\b[A-Z][a-zA-Z]+(?:Error|Exception)\b/g]) {
    for (const m of description.matchAll(re)) found.add(m[1] ?? m[0]);
  }
  return [...found];
}

function buildBrief(issue: IssueInput, flags: Flag[]): DraftBrief {
  const desc = issue.description ?? '';
  const reusable = anchors(desc);

  const unknowns = flags.map(
    (f) =>
      `"${f.phrase}" (${f.label}) has no concrete replacement in the issue. ` +
      `Ask the author what it refers to instead of choosing a value.`
  );

  return {
    task:
      'Rewrite this description so every statement can be verified. Preserve the ' +
      'author\'s intent and keep their voice — this replaces their text, so do not ' +
      'pad it, restructure it into a template, or add sections they did not ask for. ' +
      'Replace each flagged phrase with detail drawn from the issue itself. Where the ' +
      'issue does not supply that detail, leave a direct question to the author in its ' +
      'place rather than inventing a value.',
    context: {
      title: issue.title,
      description: desc,
      flaggedPhrases: flags.map((f) => `${f.phrase} (${f.label})`).join('; '),
      reusableDetail: reusable.join(', '),
    },
    unknowns,
  };
}

export async function runAmbiguityAgent(
  issue: IssueInput,
  _config: ProjectConfig
): Promise<AgentFinding | null> {
  const desc = issue.description ?? '';
  const flags = findVaguePhrases(desc);
  if (flags.length === 0) return null;
  const hasNonExemptFlag = flags.some((flag) => NON_EXEMPT_LABELS.has(flag.label));
  if (!hasNonExemptFlag && isConcreteEnough(desc)) return null;

  const summary = flags.map((f) => `"${f.phrase}"`).join(', ');

  return {
    agent: 'AM',
    issueIid: issue.iid,
    action: 'rewrite_desc',
    suggestedValue: `Description not yet rewritten for "${issue.title}".`,
    draft: buildBrief(issue, flags),
    reason: `Vague wording that cannot be tested against: ${summary}.`,
    originalDescription: issue.description,
    ...(issue.updatedAt === undefined ? {} : { originalUpdatedAt: issue.updatedAt }),
  };
}
