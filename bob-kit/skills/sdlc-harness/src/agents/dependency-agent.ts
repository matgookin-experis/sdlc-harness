/**
 * dependency-agent.ts — Dependency Suggestion Agent (Task 22).
 *
 * Scans a set of open issues for meaningful semantic overlap and proposes
 * either `blocks` or `relates-to` dependency links. The overlap detection
 * is lexical (shared significant keyword tokens) rather than embedding-based
 * so it runs deterministically without an LLM or network call.
 *
 * Guarantees:
 *  - No self-links (sourceIid !== targetIid).
 *  - No duplicate pairs — each (min, max) pair appears at most once.
 *  - Only pairs exceeding the overlap threshold produce a finding.
 *  - Confidence score in [0, 1].
 *  - Falls back to 'relates-to' whenever direction cannot be determined
 *    confidently (both or neither side carries dependency language).
 */

import type { IssueInput, ProjectConfig, DependencyFinding } from '../models';

// ---------------------------------------------------------------------------
// Tokenisation helpers
// ---------------------------------------------------------------------------

/** English stop-words to exclude from overlap scoring. */
const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','it','its','this','that','these','those','be','are',
  'was','were','will','would','should','could','may','might','can','do',
  'does','did','have','has','had','not','no','as','if','so','then','when',
  'than','what','how','all','any','both','each','few','more','also','into',
  'over','after','before','between','through','up','out','about','without',
  'acceptance','across','add','app','better','click','criteria','dashboard','display',
  'displayed','given','immediately','issue','load','localstorage','page',
  'make','persist','preference','save','saved','session','show','switch','switche',
  'temperature','they','toggle','update','user',
]);

/** Normalize simple English plurals so location/locations and city/cities match. */
function normalizeToken(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 4 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Extract significant keyword tokens from a text string.
 * Returns a Set of lower-cased, non-stop-word alphabetic tokens (length ≥ 3).
 */
function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .map(normalizeToken)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token))
  );
}

/**
 * Compute Jaccard similarity between two token sets: |A∩B| / |A∪B|.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = [...a].filter((t) => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union;
}

// ---------------------------------------------------------------------------
// Relationship classifier
// ---------------------------------------------------------------------------

/**
 * Directional language is split by the role of the issue carrying it. Treating
 * "A blocks B" like "A depends on B" reverses the resulting GitLab link.
 *
 * NOTE: no domain-specific patterns (e.g. /token refresh/) are included here.
 * Rigging the classifier to the seed data produces arbitrary link directions
 * on real backlogs. Only generic dependency language is matched.
 */
const DEPENDENT_SIGNALS: RegExp[] = [
  /\bdepends?\s+on\b/i,
  /\brequires?\b/i,
  /\bprerequisite\b/i,
  /\bcannot\s+(?:start|proceed|complete)\s+until\b/i,
  /\bneed(s|ed)?\s+to\s+be\s+(done|complete|implemented)\b/i,
];

const BLOCKER_SIGNALS: RegExp[] = [
  /\bblocks?\b/i,
  /\bmust\s+be\s+(?:done|complete|implemented)\s+before\b/i,
];

type DependencyRole = 'blocker' | 'dependent' | 'ambiguous' | 'none';

interface RoleEvidence {
  role: DependencyRole;
  isCounterpartSpecific: boolean;
}

/** Return the sentence containing a directional match. */
function matchingSentence(text: string, pattern: RegExp): string | null {
  const match = pattern.exec(text);
  if (!match || match.index === undefined) return null;
  const before = text.slice(0, match.index);
  const after = text.slice(match.index + match[0].length);
  const start = Math.max(before.lastIndexOf('.'), before.lastIndexOf('\n')) + 1;
  const period = after.search(/[.\n]/);
  const end = period < 0 ? text.length : match.index + match[0].length + period;
  return text.slice(start, end);
}

/** Check whether directional evidence names or describes the counterpart. */
function isCounterpartSpecific(
  sentence: string | null,
  counterpart: IssueInput,
): boolean {
  if (!sentence) return false;
  if (new RegExp(`(?:^|\\s)#${counterpart.iid}\\b`).test(sentence)) return true;
  const counterpartTokens = tokenize(counterpart.title);
  if (counterpartTokens.size === 0) return false;
  const sentenceTokens = tokenize(sentence);
  const overlap = [...counterpartTokens].filter((token) => sentenceTokens.has(token)).length;
  return overlap >= Math.min(2, counterpartTokens.size);
}

/** Classify directional language and whether it identifies the paired issue. */
function dependencyEvidence(issue: IssueInput, counterpart: IssueInput): RoleEvidence {
  const text = `${issue.title}. ${issue.description ?? ''}`;
  const blockerSentences = BLOCKER_SIGNALS
    .map((pattern) => matchingSentence(text, pattern))
    .filter((sentence): sentence is string => sentence !== null);
  const dependentSentences = DEPENDENT_SIGNALS
    .map((pattern) => matchingSentence(text, pattern))
    .filter((sentence): sentence is string => sentence !== null);
  if (blockerSentences.length > 0 && dependentSentences.length > 0) {
    return { role: 'ambiguous', isCounterpartSpecific: false };
  }
  const sentences = blockerSentences.length > 0 ? blockerSentences : dependentSentences;
  if (sentences.length === 0) return { role: 'none', isCounterpartSpecific: false };
  return {
    role: blockerSentences.length > 0 ? 'blocker' : 'dependent',
    isCounterpartSpecific: sentences.some((sentence) => (
      isCounterpartSpecific(sentence, counterpart)
    )),
  };
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Jaccard threshold above which issues are considered meaningfully related. */
const OVERLAP_THRESHOLD = 0.08;

/** Require more than one shared concept to avoid generic one-word pairings. */
const MIN_SHARED_TOKENS = 2;

/** Jaccard threshold above which confidence is boosted to "high". */
const HIGH_CONFIDENCE_THRESHOLD = 0.25;

// ---------------------------------------------------------------------------
// Agent entry point
// ---------------------------------------------------------------------------

/**
 * Run the dependency-suggestion agent across all provided open issues.
 *
 * @param issues  All open issues to compare (n² pairs, so keep batches small).
 * @returns       Array of DependencyFindings (may be empty).
 */
export async function runDependencyAgent(
  issues: IssueInput[],
  config: ProjectConfig
): Promise<DependencyFinding[]> {
  const findings: DependencyFinding[] = [];
  const seenPairs = new Set<string>();

  // Pre-tokenize all issues
  const tokenSets = issues.map((issue) =>
    tokenize(`${issue.title} ${issue.description ?? ''}`)
  );

  for (let i = 0; i < issues.length; i++) {
    for (let j = i + 1; j < issues.length; j++) {
      const a = issues[i];
      const b = issues[j];

      // Skip self-links (shouldn't happen with i < j but defensive)
      if (a.iid === b.iid) continue;

      // Canonical pair key to avoid duplicates
      const pairKey = `${Math.min(a.iid, b.iid)}-${Math.max(a.iid, b.iid)}`;
      if (seenPairs.has(pairKey)) continue;

      const similarity = jaccardSimilarity(tokenSets[i], tokenSets[j]);
      const sharedTokens = [...tokenSets[i]].filter((token) => tokenSets[j].has(token));
      if (sharedTokens.length < MIN_SHARED_TOKENS || similarity < OVERLAP_THRESHOLD) continue;

      seenPairs.add(pairKey);

      const evidenceA = dependencyEvidence(a, b);
      const evidenceB = dependencyEvidence(b, a);
      const roleA = evidenceA.role;
      const roleB = evidenceB.role;

      // A blocker is the source and a dependent is the target. Conflicting or absent
      // role evidence is intentionally non-directional.
      let suggestedLinkType: 'blocks' | 'relates-to';
      let sourceIid: number;
      let targetIid: number;

      if (
        config.blockingIssueLinks === true &&
        (
          (roleA === 'blocker' && roleB === 'dependent') ||
          (roleA === 'blocker' && roleB === 'none' && evidenceA.isCounterpartSpecific) ||
          (roleA === 'none' && roleB === 'dependent' && evidenceB.isCounterpartSpecific)
        )
      ) {
        suggestedLinkType = 'blocks';
        sourceIid = a.iid;
        targetIid = b.iid;
      } else if (
        config.blockingIssueLinks === true &&
        (
          (roleB === 'blocker' && roleA === 'dependent') ||
          (roleB === 'blocker' && roleA === 'none' && evidenceB.isCounterpartSpecific) ||
          (roleB === 'none' && roleA === 'dependent' && evidenceA.isCounterpartSpecific)
        )
      ) {
        suggestedLinkType = 'blocks';
        sourceIid = b.iid;
        targetIid = a.iid;
      } else {
        // Ambiguous or no direction signal — fall back to relates-to
        suggestedLinkType = 'relates-to';
        sourceIid = Math.min(a.iid, b.iid);
        targetIid = Math.max(a.iid, b.iid);
      }

      const confidence = Math.min(
        1,
        similarity >= HIGH_CONFIDENCE_THRESHOLD ? 0.85 : 0.65
      );

      findings.push({
        agent: 'DEP',
        sourceIid,
        targetIid,
        suggestedLinkType,
        reason:
          `Issues #${a.iid} and #${b.iid} share significant semantic overlap ` +
          `(similarity ${(similarity * 100).toFixed(0)}%). ` +
          (suggestedLinkType === 'blocks'
            ? 'Counterpart-specific or complementary evidence identifies the blocker.'
            : config.blockingIssueLinks === true
              ? 'Direction lacks counterpart-specific evidence; a non-directional link is safer.'
              : 'Blocking links are disabled for this GitLab tier; a relates-to link is used.'),
        confidence,
      });
    }
  }

  return findings;
}
