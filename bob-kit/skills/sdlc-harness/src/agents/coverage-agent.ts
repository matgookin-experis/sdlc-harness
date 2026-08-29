/** Detect configured test files that explicitly reference audited issues. */

import type { AgentFinding, CoverageConfig, IssueInput, ProjectConfig } from '../models';

const EXPLICIT_ISSUE_REF = /\b(?:issue|closes?|fix(?:e[sd])?|resolves?)\s+#?(\d+)\b/gi;
const HASH_ISSUE_REF = /#(\d+)\b/g;
const QUALIFIED_PROJECT_SUFFIX = /([a-z0-9_.-]+(?:\/[a-z0-9_.-]+)+)$/i;
const CSS_COLOR_PROPERTY = /(?:--[\w-]*colou?r|[\w-]*colou?r|background|border|fill|stroke)\s*(?::|=)\s*["']?$/i;

/** Return the decoded full project path from a validated project URL. */
function projectPath(config: ProjectConfig): string {
  return decodeURIComponent(new URL(config.projectUrl).pathname.replace(/^\/+|\/+$/g, ''));
}

/** Distinguish numeric CSS colors such as `color: #123` from issue references. */
function isCssColor(text: string, hashIndex: number, digits: string): boolean {
  if (digits.length !== 3 && digits.length !== 6) return false;
  if (digits.length === 6) return true;
  return CSS_COLOR_PROPERTY.test(text.slice(Math.max(0, hashIndex - 80), hashIndex));
}

/**
 * Extract local issue IIDs while ignoring CSS colors and foreign qualified refs.
 * An exact onboarded project path may be supplied to accept `group/project#12`.
 */
export function extractIssueRefs(
  testContent: string,
  onboardedProject?: string,
): Set<number> {
  const refs = new Set<number>();
  for (const match of testContent.matchAll(EXPLICIT_ISSUE_REF)) {
    const iid = Number.parseInt(match[1], 10);
    if (!Number.isNaN(iid)) refs.add(iid);
  }

  for (const match of testContent.matchAll(HASH_ISSUE_REF)) {
    const hashIndex = match.index;
    const digits = match[1];
    if (hashIndex === undefined) continue;
    const prefix = testContent.slice(Math.max(0, hashIndex - 200), hashIndex);
    const qualified = prefix.match(QUALIFIED_PROJECT_SUFFIX)?.[1];
    if (qualified && (
      onboardedProject === undefined ||
      qualified.toLowerCase() !== onboardedProject.toLowerCase()
    )) {
      continue;
    }
    if (!qualified && isCssColor(testContent, hashIndex, digits)) continue;
    const iid = Number.parseInt(digits, 10);
    if (!Number.isNaN(iid)) refs.add(iid);
  }
  return refs;
}

/** Run the test-coverage linkage agent over pre-read configured files. */
export async function runCoverageAgent(
  issues: IssueInput[],
  testContents: Record<string, string>,
  config: ProjectConfig & { coverage?: CoverageConfig },
): Promise<AgentFinding[]> {
  if (!config.coverage?.enabled) return [];

  const coveredIids = new Set<number>();
  const project = projectPath(config);
  for (const content of Object.values(testContents)) {
    for (const iid of extractIssueRefs(content, project)) coveredIids.add(iid);
  }

  const findings: AgentFinding[] = [];
  for (const issue of issues) {
    if (coveredIids.has(issue.iid)) continue;
    findings.push({
      agent: 'COV',
      issueIid: issue.iid,
      action: 'missing_coverage',
      suggestedValue: `Add a test that references issue #${issue.iid}: "${issue.title}"`,
      reason:
        `No reference to issue #${issue.iid} was found in any of the ` +
        `${Object.keys(testContents).length} configured test file(s). ` +
        `This work item may lack automated test coverage.`,
    });
  }
  return findings;
}
