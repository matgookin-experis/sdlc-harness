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
]);

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
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t))
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
 * Strong "blocks" signal patterns: one issue explicitly mentions depending on,
 * requiring, or being a prerequisite of another concept.
 *
 * NOTE: no domain-specific patterns (e.g. /token refresh/) are included here.
 * Rigging the classifier to the seed data produces arbitrary link directions
 * on real backlogs. Only generic dependency language is matched.
 */
const BLOCKS_SIGNALS: RegExp[] = [
  /\bdepends?\s+on\b/i,
  /\brequires?\b/i,
  /\bprerequisite\b/i,
  /\bbefore\b.+\bcan\b/i,
  /\bneed(s|ed)?\s+to\s+be\s+(done|complete|implemented)\b/i,
  /\bblocks?\b/i,
];

/**
 * Return true if the given text contains explicit dependency language.
 */
function hasBlocksSignal(text: string): boolean {
  return BLOCKS_SIGNALS.some((re) => re.test(text));
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

/** Jaccard threshold above which issues are considered meaningfully related. */
const OVERLAP_THRESHOLD = 0.12;

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
  _config: ProjectConfig
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
      if (similarity < OVERLAP_THRESHOLD) continue;

      seenPairs.add(pairKey);

      const textA = `${a.title} ${a.description ?? ''}`;
      const textB = `${b.title} ${b.description ?? ''}`;

      const aIsDependent = hasBlocksSignal(textA);
      const bIsDependent = hasBlocksSignal(textB);

      // Determine direction:
      //   Only one side carries dependency language → that issue is the "dependent"
      //   (it requires the other, so the other blocks it: sourceIid = other, targetIid = a).
      //   Both or neither carry dependency language → direction is ambiguous → relates-to.
      let suggestedLinkType: 'blocks' | 'relates-to';
      let sourceIid: number;
      let targetIid: number;

      if (aIsDependent && !bIsDependent) {
        // A depends on B → B blocks A
        suggestedLinkType = 'blocks';
        sourceIid = b.iid;
        targetIid = a.iid;
      } else if (bIsDependent && !aIsDependent) {
        // B depends on A → A blocks B
        suggestedLinkType = 'blocks';
        sourceIid = a.iid;
        targetIid = b.iid;
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
            ? 'Dependency language detected — one issue appears to block or require the other.'
            : 'The issues address related topics and likely benefit from explicit cross-referencing.'),
        confidence,
      });
    }
  }

  return findings;
}
