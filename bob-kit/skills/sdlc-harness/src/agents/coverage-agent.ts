/**
 * coverage-agent.ts — Test Coverage Linkage Agent (Task 24 — P1 stretch).
 *
 * Finds explicit issue references (e.g. "#12", "issue 12") in configured
 * test files and flags work items that have no test reference.
 *
 * DISABLED BY DEFAULT: the agent only runs when `config.coverage.enabled`
 * is true. Callers must opt-in via the project configuration.
 *
 * This is a pure, deterministic function — it operates on pre-read file
 * content strings rather than performing filesystem I/O, so it is fully
 * unit-testable without mocking the FS.
 */

import type { IssueInput, ProjectConfig, CoverageConfig, AgentFinding } from '../models';

// ---------------------------------------------------------------------------
// Reference extraction
// ---------------------------------------------------------------------------

/**
 * Patterns that indicate an issue reference inside test content.
 *  - `#12`           — GitLab short-ref
 *  - `issue 12`      — prose reference
 *  - `closes #12`    — commit/MR keyword
 *  - `fixes #12`
 *  - `resolves #12`
 */
const ISSUE_REF_PATTERN = /(?:#|(?:issue|closes|fixes|resolves)\s+#?)(\d+)/gi;

/**
 * Extract all issue IIDs referenced in the given test file content.
 */
export function extractIssueRefs(testContent: string): Set<number> {
  const refs = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = ISSUE_REF_PATTERN.exec(testContent)) !== null) {
    const iid = parseInt(match[1], 10);
    if (!isNaN(iid)) refs.add(iid);
  }
  return refs;
}

// ---------------------------------------------------------------------------
// Agent entry point
// ---------------------------------------------------------------------------

/**
 * Run the test-coverage linkage agent.
 *
 * @param issues        Open issues to check for test coverage.
 * @param testContents  Pre-read content of all test files (key = file path).
 * @param config        Project config. The agent exits immediately if
 *                      `config.coverage` is absent or disabled.
 * @returns             Array of AgentFindings for uncovered issues, or [] if
 *                      the agent is disabled or all issues have references.
 */
export async function runCoverageAgent(
  issues: IssueInput[],
  testContents: Record<string, string>,
  config: ProjectConfig & { coverage?: CoverageConfig }
): Promise<AgentFinding[]> {
  // Disabled by default — opt-in required
  if (!config.coverage?.enabled) return [];

  // Build the union of all referenced IIDs across all test files
  const coveredIids = new Set<number>();
  for (const content of Object.values(testContents)) {
    for (const iid of extractIssueRefs(content)) {
      coveredIids.add(iid);
    }
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
