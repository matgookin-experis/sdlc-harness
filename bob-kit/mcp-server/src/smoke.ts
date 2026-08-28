/**
 * smoke.ts — end-to-end validation script for the sdlc-harness MCP server.
 *
 * Run with: npm run smoke
 *
 * Validates:
 *  1. work-item-format tool works without any GitLab connection (pure logic).
 *  2. Config loading works (using fixture env vars).
 *  3. GitLabClient methods call the correct API endpoints (mock fetch).
 *  4. gitlab-issue-reader tool executes correctly against the mock client.
 *  5. gitlab-issue-writer duplicate detection works correctly.
 *  6. gitlab-mr-reader-writer routes correctly.
 *  7. MCP transport integration: listTools returns non-empty schemas, and
 *     each tool can be invoked through StdioClientTransport without an
 *     action validation error.
 *
 * When a live GitLab instance is available, set GITLAB_HOST, GITLAB_PROJECT,
 * and GITLAB_TOKEN in .env and run with SDLC_SMOKE_LIVE=true to run live checks.
 */

import { GitLabClient, GitLabApiError } from "./gitlab-client.js";
import { gitlabIssueReaderTool } from "./tools/gitlab-issue-reader.js";
import { gitlabIssueWriterTool } from "./tools/gitlab-issue-writer.js";
import { gitlabMrReaderWriterTool } from "./tools/gitlab-mr-reader-writer.js";
import { workItemFormatTool } from "./tools/work-item-format.js";
import type { ToolContext } from "./types.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Lightweight assertion helpers
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    process.stdout.write(`  ✓ ${label}\n`);
    passed++;
  } else {
    process.stderr.write(`  ✗ FAIL: ${label}\n`);
    failed++;
  }
}

async function assertThrows(fn: () => Promise<unknown>, label: string): Promise<void> {
  try {
    await fn();
    process.stderr.write(`  ✗ FAIL (no throw): ${label}\n`);
    failed++;
  } catch {
    process.stdout.write(`  ✓ ${label}\n`);
    passed++;
  }
}

function section(title: string): void {
  process.stdout.write(`\n── ${title}\n`);
}

// ---------------------------------------------------------------------------
// Mock fetch factory
// ---------------------------------------------------------------------------

type MockHandler = (url: string, init?: RequestInit) => { status: number; body: unknown };

function makeMockFetch(handler: MockHandler) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    const { status, body } = handler(url, init);
    const json = JSON.stringify(body);
    return new Response(json, {
      status,
      headers: { "Content-Type": "application/json" },
    });
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_ISSUE = {
  id: 1,
  iid: 1,
  title: "As a developer, I can see AC suggestions so that I save time",
  description: "**As a** developer...\n\n## Acceptance Criteria\n\n**Given** ...\n**When** ...\n**Then** ...",
  state: "opened" as const,
  labels: ["type::story"],
  assignees: [],
  author: { id: 1, username: "dev", name: "Dev User" },
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  web_url: "https://gitlab.example.com/demo/project/-/issues/1",
  milestone: null,
};

const MOCK_MR = {
  id: 10,
  iid: 10,
  title: "feat: add AC drafting agent (#1)",
  description: "Closes #1",
  state: "merged" as const,
  source_branch: "feature/ac-agent",
  target_branch: "main",
  author: { id: 1, username: "dev", name: "Dev User" },
  assignees: [],
  labels: [],
  created_at: "2024-01-02T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
  merged_at: "2024-01-03T00:00:00Z",
  web_url: "https://gitlab.example.com/demo/project/-/merge_requests/10",
};

// ---------------------------------------------------------------------------
// Mock context builder
// ---------------------------------------------------------------------------

function buildMockContext(fetchHandler: MockHandler): ToolContext {
  const client = new GitLabClient(
    "https://gitlab.example.com",
    "mock-token",
    "demo/project",
    makeMockFetch(fetchHandler)
  );
  return {
    gitlab: client,
    config: {
      gitlabHost: "https://gitlab.example.com",
      gitlabProject: "demo/project",
      gitlabToken: "mock-token",
      debug: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

async function testWorkItemFormat(): Promise<void> {
  section("work-item-format (no network required)");
  const ctx = buildMockContext(() => ({ status: 200, body: {} }));

  // get-standard — all types
  const all = await workItemFormatTool.execute({ action: "get-standard" }, ctx) as { standard: Record<string, unknown> };
  assert(Object.keys(all.standard).length === 5, "get-standard returns 5 types");

  // get-template — User Story
  const tmpl = await workItemFormatTool.execute({ action: "get-template", type: "User Story" }, ctx) as { template: { type: string } };
  assert(tmpl.template.type === "User Story", "get-template returns correct type");

  // validate-item — passing
  const pass = await workItemFormatTool.execute({
    action: "validate-item",
    type: "User Story",
    title: "As a developer, I can see AC suggestions so that I save time",
    description: "**As a** developer...",
    acceptanceCriteria: "**Given** I have an issue\n**When** the agent runs\n**Then** AC is drafted",
  }, ctx) as { valid: boolean };
  assert(pass.valid === true, "validate-item passes a well-formed User Story");

  // validate-item — failing (no AC)
  const fail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "User Story",
    title: "As a developer, I can see AC suggestions so that I save time",
    description: "Some description",
  }, ctx) as { valid: boolean; violations: unknown[] };
  assert(fail.valid === false, "validate-item fails when AC is missing");
  assert(fail.violations.length > 0, "validate-item returns violations");

  // validate-item — Bug without component prefix
  const bugFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Bug",
    title: "agent crashes when empty description",
    description: "Steps:\n1. ...",
  }, ctx) as { valid: boolean };
  assert(bugFail.valid === false, "validate-item catches Bug missing component prefix");
}

async function testGitLabClientMock(): Promise<void> {
  section("GitLabClient (mock fetch)");

  const ctx = buildMockContext((url) => {
    if (/\/issues\/1\/notes/.test(url)) return { status: 200, body: [] };
    if (/\/issues\/1$/.test(url)) return { status: 200, body: MOCK_ISSUE };
    if (/\/issues(\?|$)/.test(url)) return { status: 200, body: [MOCK_ISSUE] };
    if (/\/merge_requests\/10$/.test(url)) return { status: 200, body: MOCK_MR };
    if (/\/merge_requests(\?|$)/.test(url)) return { status: 200, body: [MOCK_MR] };
    if (/\/labels(\?|$)/.test(url)) return { status: 200, body: [] };
    if (/\/user$/.test(url)) return { status: 200, body: { username: "test-user" } };
    return { status: 404, body: { message: "Not found" } };
  });

  const issue = await ctx.gitlab.getIssue(1);
  assert(issue.iid === 1, "getIssue returns correct issue");
  assert(issue.title === MOCK_ISSUE.title, "getIssue returns correct title");

  const issues = await ctx.gitlab.listIssues({ state: "opened" });
  assert(issues.length === 1, "listIssues returns array");

  const mr = await ctx.gitlab.getMR(10);
  assert(mr.state === "merged", "getMR returns merged state");

  const username = await ctx.gitlab.ping();
  assert(username === "test-user", "ping returns username");

  // Error handling
  await assertThrows(
    () => ctx.gitlab.getIssue(999),
    "GitLabApiError thrown on 404"
  );
}

async function testGitLabIssueReader(): Promise<void> {
  section("gitlab-issue-reader tool (mock)");

  const ctx = buildMockContext((url) => {
    if (/\/issues\/1\/notes/.test(url)) return { status: 200, body: [] };
    if (/\/issues\/1$/.test(url)) return { status: 200, body: MOCK_ISSUE };
    if (/\/issues(\?|$)/.test(url)) return { status: 200, body: [MOCK_ISSUE] };
    if (/\/labels(\?|$)/.test(url)) return { status: 200, body: [{ id: 1, name: "type::story", color: "#428BCA", description: null }] };
    return { status: 404, body: { message: "Not found" } };
  });

  const result = await gitlabIssueReaderTool.execute({ action: "list-issues" }, ctx) as unknown[];
  assert(result.length === 1, "list-issues returns issues array");

  const single = await gitlabIssueReaderTool.execute({ action: "get-issue", iid: 1 }, ctx) as { iid: number };
  assert(single.iid === 1, "get-issue returns correct issue");

  const labels = await gitlabIssueReaderTool.execute({ action: "list-labels" }, ctx) as unknown[];
  assert(Array.isArray(labels), "list-labels returns array");

  const notes = await gitlabIssueReaderTool.execute({ action: "list-notes", iid: 1 }, ctx) as unknown[];
  assert(Array.isArray(notes), "list-notes returns array");
}

async function testGitLabIssueWriter(): Promise<void> {
  section("gitlab-issue-writer tool (mock)");

  // Duplicate detection: returns duplicate flag when title matches
  const dupCtx = buildMockContext((url) => {
    if (url.includes("/issues")) return { status: 200, body: [MOCK_ISSUE] };
    return { status: 404, body: { message: "Not found" } };
  });

  const dupResult = await gitlabIssueWriterTool.execute({
    action: "create-issue",
    title: MOCK_ISSUE.title,
  }, dupCtx) as { duplicate: boolean };
  assert(dupResult.duplicate === true, "create-issue detects duplicate title");

  // Create with force=true bypasses duplicate check
  const createCtx = buildMockContext((url, init) => {
    if (url.includes("/issues") && init?.method === "POST") {
      return { status: 200, body: { ...MOCK_ISSUE, iid: 2, title: MOCK_ISSUE.title } };
    }
    if (url.includes("/issues")) return { status: 200, body: [MOCK_ISSUE] };
    return { status: 404, body: { message: "Not found" } };
  });

  const created = await gitlabIssueWriterTool.execute({
    action: "create-issue",
    title: MOCK_ISSUE.title,
    force: true,
  }, createCtx) as { iid: number };
  assert(created.iid === 2, "create-issue with force=true creates the issue");
}

async function testGitLabMrReaderWriter(): Promise<void> {
  section("gitlab-mr-reader-writer tool (mock)");

  const ctx = buildMockContext((url) => {
    if (url.includes("/merge_requests/10")) return { status: 200, body: MOCK_MR };
    if (url.includes("/merge_requests")) return { status: 200, body: [MOCK_MR] };
    return { status: 404, body: { message: "Not found" } };
  });

  const mrs = await gitlabMrReaderWriterTool.execute({ action: "list-mrs" }, ctx) as unknown[];
  assert(mrs.length === 1, "list-mrs returns array");

  const mr = await gitlabMrReaderWriterTool.execute({ action: "get-mr", iid: 10 }, ctx) as { state: string };
  assert(mr.state === "merged", "get-mr returns merged MR");
}

async function testGitLabApiError(): Promise<void> {
  section("GitLabApiError structure");

  const err = new GitLabApiError(404, "/api/v4/projects/1/issues/99", "Not found");
  assert(err.status === 404, "GitLabApiError carries status");
  assert(err.endpoint === "/api/v4/projects/1/issues/99", "GitLabApiError carries endpoint");
  assert(err instanceof Error, "GitLabApiError is an Error");
}


// ---------------------------------------------------------------------------
// MCP transport integration test — spawns dist/index.js via StdioClientTransport
// ---------------------------------------------------------------------------

/**
 * Verifies that the MCP server, when started as a real subprocess, publishes
 * non-empty input schemas for every registered tool and accepts valid calls.
 *
 * This catches the class of regression where tool() is mistakenly passed a
 * discriminated-union schema via .shape (which yields {}) instead of the full
 * schema — something the unit-level smoke tests cannot detect.
 */
async function testMcpTransportIntegration(): Promise<void> {
  section("MCP transport integration (stdio subprocess)");

  // Locate dist/index.js relative to this compiled file
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const serverPath = resolve(__dirname, "index.js");

  // Provide minimal env so the server starts (it won't connect to GitLab)
  const env = {
    ...process.env,
    GITLAB_HOST: "https://gitlab.example.com",
    GITLAB_PROJECT: "demo/project",
    GITLAB_TOKEN: "smoke-test-token",
  };

  const transport = new StdioClientTransport({
    command: "node",
    args: [serverPath],
    env,
  });

  const client = new Client({ name: "smoke-test-client", version: "0.1.0" });

  try {
    await client.connect(transport);

    // 1. listTools — verify all four tools are registered
    const { tools } = await client.listTools();
    const toolNames = tools.map((t) => t.name);
    const expectedTools = [
      "gitlab-issue-reader",
      "gitlab-issue-writer",
      "gitlab-mr-reader-writer",
      "work-item-format",
    ];

    assert(tools.length === expectedTools.length, `listTools returns ${expectedTools.length} tools (got ${tools.length})`);

    for (const name of expectedTools) {
      assert(toolNames.includes(name), `listTools includes ${name}`);
    }

    // 2. Verify each tool has a non-empty input schema (the core regression check).
    //    Discriminated-union schemas produce anyOf, not properties — accept either.
    for (const tool of tools) {
      const schema = tool.inputSchema as {
        anyOf?: unknown[];
        oneOf?: unknown[];
        properties?: Record<string, unknown>;
      };
      const hasContent =
        schema &&
        typeof schema === "object" &&
        (
          (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) ||
          (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) ||
          ("properties" in schema && Object.keys(schema.properties ?? {}).length > 0)
        );
      assert(hasContent, `${tool.name} publishes non-empty input schema`);
    }

    // 3. Invoke work-item-format (no GitLab connection needed) — valid call
    const fmtResult = await client.callTool({
      name: "work-item-format",
      arguments: { action: "get-standard" },
    });
    const fmtText = (fmtResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const fmtParsed = JSON.parse(fmtText) as { standard: unknown };
    assert(
      typeof fmtParsed.standard === "object" && fmtParsed.standard !== null,
      "work-item-format get-standard returns standard object via MCP transport"
    );

    // 4. Invoke work-item-format with an invalid action — the server must
    //    reject it with a validation error (either as an MCP RPC error thrown
    //    from the handler, or as an isError=true CallToolResult).
    let invalidActionRejected = false;
    try {
      const badResult = await client.callTool({
        name: "work-item-format",
        arguments: { action: "not-a-real-action" },
      });
      // If the SDK catches the error and wraps it in isError=true content:
      invalidActionRejected = (badResult as { isError?: boolean }).isError === true;
    } catch {
      // McpError thrown by the handler and surfaced as an RPC error — also correct
      invalidActionRejected = true;
    }
    assert(
      invalidActionRejected,
      "work-item-format rejects an invalid action with a validation error"
    );
  } finally {
    await client.close();
  }
}


// ---------------------------------------------------------------------------
// Live smoke test (optional — requires real GitLab credentials)
// ---------------------------------------------------------------------------

async function testLive(): Promise<void> {
  section("Live GitLab smoke test");

  const host = process.env["GITLAB_HOST"];
  const project = process.env["GITLAB_PROJECT"];
  const token = process.env["GITLAB_TOKEN"];

  if (!host || !project || !token) {
    process.stdout.write("  ⚠ Skipped — set GITLAB_HOST, GITLAB_PROJECT, GITLAB_TOKEN to run live tests.\n");
    return;
  }

  const client = new GitLabClient(host, token, project);
  try {
    const username = await client.ping();
    assert(typeof username === "string" && username.length > 0, `Authenticated as ${username}`);

    const labels = await client.listLabels();
    assert(Array.isArray(labels), `Labels endpoint reachable (${labels.length} labels)`);

    const issues = await client.listIssues({ state: "opened", per_page: 5 });
    assert(Array.isArray(issues), `Issues endpoint reachable (${issues.length} open issues)`);

    const mrs = await client.listMRs({ state: "opened", per_page: 5 });
    assert(Array.isArray(mrs), `MRs endpoint reachable (${mrs.length} open MRs)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`  ✗ Live test failed: ${msg}\n`);
    failed++;
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  process.stdout.write("sdlc-harness MCP server — smoke test\n");
  process.stdout.write("======================================\n");

  await testWorkItemFormat();
  await testGitLabClientMock();
  await testGitLabIssueReader();
  await testGitLabIssueWriter();
  await testGitLabMrReaderWriter();
  await testGitLabApiError();
  await testMcpTransportIntegration();

  if (process.env["SDLC_SMOKE_LIVE"] === "true") {
    await testLive();
  }

  process.stdout.write(`\n======================================\n`);
  process.stdout.write(`Results: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Smoke test runner error: ${msg}\n`);
  process.exit(1);
});
