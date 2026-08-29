/**
 * smoke.ts — end-to-end validation script for the sdlc-harness MCP server.
 *
 * Run with: npm run smoke
 *
 * Validates:
 *  1. work-item-format tool works without any GitLab connection (pure logic).
 *     Covers: get-standard, get-template, validate-item (positive + negative cases
 *     for every work-item type and every enforced rule).
 *  2. Config loading (fixture env vars, missing vars, env-file override).
 *  3. GitLabClient methods call the correct API endpoints (mock fetch).
 *  4. gitlab-issue-reader tool executes correctly against the mock client.
 *  5. gitlab-issue-writer: labels, milestone, assignees; add/remove labels;
 *     close, reopen, add-note; duplicate detection + force.
 *  6. gitlab-mr-reader-writer routes correctly.
 *  7. MCP transport integration via InMemoryTransport.createLinkedPair():
 *     - createServer() builds a connected server without spawning a subprocess.
 *     - listTools() reports all five tools with non-empty input schemas
 *       (the "action" field must be present in every schema).
 *     - Each tool is invoked through the MCP client (not directly via execute()).
 *     - Invalid actions return validation errors.
 *
 * Optional live GitLab checks are gated behind SDLC_SMOKE_LIVE=true.
 */

import {
  GitLabClient,
  GitLabApiError,
  GitLabRequestTimeoutError,
  MAX_GITLAB_ITEMS,
  MAX_GITLAB_PAGES,
} from "./gitlab-client.js";
import { gitlabIssueReaderTool } from "./tools/gitlab-issue-reader.js";
import { gitlabIssueWriterTool } from "./tools/gitlab-issue-writer.js";
import { gitlabMrReaderWriterTool } from "./tools/gitlab-mr-reader-writer.js";
import { workItemFormatTool } from "./tools/work-item-format.js";
import { loadConfig, mergeEnvFile, resolveEnvFilePath } from './env.js';
import type { Config } from './env.js';
import type { ToolContext } from "./types.js";
import { createServer } from "./server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

const STORY_DESCRIPTION = "**As a** developer, **I can** see AC suggestions **so that** I save time.";

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
// Test suite: work-item-format (validation for every type + every rule)
// ---------------------------------------------------------------------------

async function testWorkItemFormat(): Promise<void> {
  section("work-item-format (no network required)");
  const ctx = buildMockContext(() => ({ status: 200, body: {} }));

  // --- get-standard ---
  const all = await workItemFormatTool.execute({ action: "get-standard" }, ctx) as { standard: Record<string, unknown> };
  assert(Object.keys(all.standard).length === 5, "get-standard returns 5 types");

  const filtered = await workItemFormatTool.execute({ action: "get-standard", type: "Epic" }, ctx) as { standard: { type: string } };
  assert(filtered.standard.type === "Epic", "get-standard filtered to Epic returns Epic entry");

  // --- get-template ---
  const tmpl = await workItemFormatTool.execute({ action: "get-template", type: "User Story" }, ctx) as { template: { type: string } };
  assert(tmpl.template.type === "User Story", "get-template returns correct type");

  // --- Epic: valid ---
  const epicPass = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Epic",
    title: "Automated Work Item Quality",
    description: "## Hypothesis\nWhy it matters.\n\n## Goals\n- Goal 1\n\n## Scope\nIn: x. Out: y.\n\n## Child Features\n- [ ] Feature 1",
  }, ctx) as { valid: boolean };
  assert(epicPass.valid === true, "validate-item: Epic passes with correct title+description");

  // --- Epic: title too long (>60 chars) ---
  const epicTitleFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Epic",
    title: "A".repeat(61),
    description: "## Hypothesis\nWhy.\n\n## Goals\n- g\n\n## Scope\nIn:x.\n\n## Child Features\n- [ ] Feature 1",
  }, ctx) as { valid: boolean; violations: Array<{ field: string }> };
  assert(epicTitleFail.valid === false, "validate-item: Epic fails when title >60 chars");
  assert(epicTitleFail.violations.some(v => v.field === "title"), "Epic title-too-long violation is field=title");

  // --- Epic: missing required description sections ---
  const epicDescFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Epic",
    title: "Short Epic Title",
    description: "Just some text without the required sections.",
  }, ctx) as { valid: boolean };
  assert(epicDescFail.valid === false, "validate-item: Epic fails without required description sections");

  const epicHeadingFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Epic",
    title: "Automated Work Item Quality",
    description: "## Hypothesis details\nWhy.\n\n## Goals\n- g\n\n## Scope\nIn:x.\n\n## Child Features\n- [ ] Feature 1",
  }, ctx) as { valid: boolean };
  assert(epicHeadingFail.valid === false, "validate-item: section names must match exact headings");

  const epicEmptySectionFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Epic",
    title: "Automated Work Item Quality",
    description: "## Hypothesis\n\n## Goals\n- g\n\n## Scope\nIn:x.\n\n## Child Features\n- [ ] Feature 1",
  }, ctx) as { valid: boolean };
  assert(epicEmptySectionFail.valid === false, "validate-item: required sections must contain content");

  const epicVerbFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Epic",
    title: "Build Automated Work Item Quality",
    description: "## Hypothesis\nWhy.\n\n## Goals\n- g\n\n## Scope\nIn:x.\n\n## Child Features\n- [ ] Feature 1",
  }, ctx) as { valid: boolean };
  assert(epicVerbFail.valid === false, "validate-item: Epic rejects an action-verb title");

  // --- Feature: valid ---
  const featurePass = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Feature",
    title: "Draft Missing AC",
    description: "## Overview\nDetails.\n\n## Scope\n- item\n\n## Child Stories\n- [ ] Story 1",
  }, ctx) as { valid: boolean };
  assert(featurePass.valid === true, "validate-item: Feature passes with correct title+description");

  // --- Feature: title too long (>60 chars) ---
  const featureTitleFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Feature",
    title: "B".repeat(61),
    description: "## Overview\nDetails.\n\n## Scope\n- item\n\n## Child Stories\n- [ ] Story 1",
  }, ctx) as { valid: boolean };
  assert(featureTitleFail.valid === false, "validate-item: Feature fails when title >60 chars");

  // --- Feature: missing required description section ---
  const featureDescFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Feature",
    title: "Draft Missing AC",
    description: "## Overview\nDetails.", // missing ## Scope
  }, ctx) as { valid: boolean };
  assert(featureDescFail.valid === false, "validate-item: Feature fails without ## Scope section");

  const featureVerbFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Feature",
    title: "Missing Acceptance Criteria",
    description: "## Overview\nDetails.\n\n## Scope\n- item\n\n## Child Stories\n- [ ] Story 1",
  }, ctx) as { valid: boolean };
  assert(featureVerbFail.valid === false, "validate-item: Feature requires an action verb");

  // --- User Story: valid (complete Connextra + structured GWT AC) ---
  const storyPass = await workItemFormatTool.execute({
    action: "validate-item",
    type: "User Story",
    title: "As a developer, I can see AC suggestions so that I save time",
    description: STORY_DESCRIPTION,
    acceptanceCriteria: "**Given** I have an issue\n**When** the agent runs\n**Then** AC is drafted",
  }, ctx) as { valid: boolean };
  assert(storyPass.valid === true, "validate-item: User Story passes with valid Connextra title + structured GWT AC");

  // --- User Story: title too long (>120 chars) ---
  const storyTitleLengthFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "User Story",
    title: "As a developer, I can " + "x".repeat(110) + " so that something",
    description: STORY_DESCRIPTION,
    acceptanceCriteria: "**Given** x\n**When** y\n**Then** z",
  }, ctx) as { valid: boolean };
  assert(storyTitleLengthFail.valid === false, "validate-item: User Story fails when title >120 chars");

  // --- User Story: title missing Connextra (no "so that") ---
  const storyConnextraFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "User Story",
    title: "As a developer I want to do something",
    description: STORY_DESCRIPTION,
    acceptanceCriteria: "**Given** x\n**When** y\n**Then** z",
  }, ctx) as { valid: boolean };
  assert(storyConnextraFail.valid === false, "validate-item: User Story fails without complete Connextra (missing 'so that')");

  const storyEmptyRoleFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "User Story",
    title: "As a , I can act so that I get value",
    description: STORY_DESCRIPTION,
    acceptanceCriteria: "**Given** x\n**When** y\n**Then** z",
  }, ctx) as { valid: boolean };
  assert(storyEmptyRoleFail.valid === false, "validate-item: User Story rejects an empty role");

  const storyPunctuationFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "User Story",
    title: "As a --, I can !!! so that ???",
    description: STORY_DESCRIPTION,
    acceptanceCriteria: "**Given** x\n**When** y\n**Then** z",
  }, ctx) as { valid: boolean };
  assert(storyPunctuationFail.valid === false, "validate-item: Connextra clauses require meaningful text");

  const storyDescriptionFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "User Story",
    title: "As a developer, I can see AC suggestions so that I save time",
    description: "Plain description without a Connextra narrative.",
    acceptanceCriteria: "**Given** x\n**When** y\n**Then** z",
  }, ctx) as { valid: boolean };
  assert(storyDescriptionFail.valid === false, "validate-item: User Story requires a Connextra description");

  // --- User Story: no AC ---
  const storyNoAc = await workItemFormatTool.execute({
    action: "validate-item",
    type: "User Story",
    title: "As a developer, I can see AC suggestions so that I save time",
    description: "Some description",
  }, ctx) as { valid: boolean; violations: unknown[] };
  assert(storyNoAc.valid === false, "validate-item: User Story fails when AC is missing");
  assert(storyNoAc.violations.length > 0, "validate-item: User Story returns violations when AC missing");

  // --- User Story: AC without structured GWT (arbitrary text mentioning keywords inline) ---
  const storyBadAc = await workItemFormatTool.execute({
    action: "validate-item",
    type: "User Story",
    title: "As a developer, I can see AC suggestions so that I save time",
    description: STORY_DESCRIPTION,
    acceptanceCriteria: "The feature should work given inputs when triggered then output results.",
  }, ctx) as { valid: boolean };
  assert(storyBadAc.valid === false, "validate-item: User Story fails when AC has inline keywords (not structured lines)");

  const storyOutOfOrderAc = await workItemFormatTool.execute({
    action: "validate-item",
    type: "User Story",
    title: "As a developer, I can see AC suggestions so that I save time",
    description: STORY_DESCRIPTION,
    acceptanceCriteria: "**When** y\n**Given** x\n**Then** z",
  }, ctx) as { valid: boolean };
  assert(storyOutOfOrderAc.valid === false, "validate-item: User Story rejects out-of-order GWT criteria");

  // --- Bug: valid ---
  const bugPass = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Bug",
    title: "AC Agent: crash on empty description",
    description: "## Steps to Reproduce\n1. step\n\n## Expected Behaviour\nfoo\n\n## Actual Behaviour\nbar\n\n## Environment\nGitLab CE",
    acceptanceCriteria: "**Given** x\n**When** y\n**Then** z",
  }, ctx) as { valid: boolean };
  assert(bugPass.valid === true, "validate-item: Bug passes with correct format");

  // --- Bug: missing component prefix ---
  const bugPrefixFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Bug",
    title: "agent crashes when empty description",
    description: "## Steps to Reproduce\n1. step\n\n## Expected Behaviour\nfoo\n\n## Actual Behaviour\nbar\n\n## Environment\nGitLab CE",
    acceptanceCriteria: "**Given** x\n**When** y\n**Then** z",
  }, ctx) as { valid: boolean };
  assert(bugPrefixFail.valid === false, "validate-item: Bug fails when missing component prefix");

  // --- Bug: missing required description sections ---
  const bugDescFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Bug",
    title: "AC Agent: crash on empty description",
    description: "Just some text",
    acceptanceCriteria: "**Given** x\n**When** y\n**Then** z",
  }, ctx) as { valid: boolean };
  assert(bugDescFail.valid === false, "validate-item: Bug fails without required description sections");

  // --- Task: valid ---
  const taskPass = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Task",
    title: "Add rate-limit handling to gitlab-client",
    description: "Implement rate limit retry logic in the GitLab client.",
  }, ctx) as { valid: boolean };
  assert(taskPass.valid === true, "validate-item: Task passes with valid title+description");

  // --- Task: title too long (>80 chars) ---
  const taskTitleFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Task",
    title: "Add " + "x".repeat(80),
    description: "Some work.",
  }, ctx) as { valid: boolean };
  assert(taskTitleFail.valid === false, "validate-item: Task fails when title >80 chars");

  // --- Task: empty description ---
  const taskDescFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Task",
    title: "Add rate-limit handling",
    description: "",
  }, ctx) as { valid: boolean };
  assert(taskDescFail.valid === false, "validate-item: Task fails with empty description");

  const taskVerbFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Task",
    title: "Rate-limit handling",
    description: "Implement rate-limit handling.",
  }, ctx) as { valid: boolean };
  assert(taskVerbFail.valid === false, "validate-item: Task requires an action verb");

  const emptyTitleFail = await workItemFormatTool.execute({
    action: "validate-item",
    type: "Task",
    title: "   ",
    description: "Some work.",
  }, ctx) as { valid: boolean };
  assert(emptyTitleFail.valid === false, "validate-item: every work-item type rejects an empty title");
}

// ---------------------------------------------------------------------------
// Test suite: config loading
// ---------------------------------------------------------------------------

async function testConfigLoading(): Promise<void> {
  section("Config loading");
  const keys = ["GITLAB_HOST", "GITLAB_PROJECT", "GITLAB_TOKEN", "SDLC_ENV_FILE"] as const;
  const original = new Map(keys.map((key) => [key, process.env[key]]));
  const tempDir = mkdtempSync(join(tmpdir(), "sdlc-env-test-"));
  const envPath = join(tempDir, ".env");
  const insecureEnvPath = join(tempDir, 'insecure.env');
  const symlinkTargetPath = join(tempDir, 'symlink-target.env');
  const symlinkEnvPath = join(tempDir, 'symlink.env');

  try {
    delete process.env['SDLC_ENV_FILE'];
    const canonicalEnvPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '.env',
    );
    assert(
      resolveEnvFilePath() === canonicalEnvPath,
      'Default credentials path is the repository-root .env',
    );

    writeFileSync(
      envPath,
      "GITLAB_HOST=https://file.example.com/\n" +
        "GITLAB_PROJECT=file/project\n" +
        "GITLAB_TOKEN=file-token\n",
      { mode: 0o600 },
    );
    chmodSync(envPath, 0o600);
    for (const key of keys) delete process.env[key];
    process.env["SDLC_ENV_FILE"] = envPath;

    const fileConfig = loadConfig();
    assert(fileConfig.gitlabHost === "https://file.example.com", "Config loads from the selected env file");
    assert(fileConfig.gitlabProject === "file/project", "Env file project value is loaded");

    delete process.env['GITLAB_HOST'];
    delete process.env['GITLAB_PROJECT'];
    delete process.env['GITLAB_TOKEN'];
    const liveConfig = loadLiveConfig();
    assert(
      liveConfig.gitlabHost === 'https://file.example.com',
      'Live smoke configuration loads the selected credentials file',
    );

    process.env["GITLAB_HOST"] = "https://existing.example.com";
    process.env["GITLAB_PROJECT"] = "existing/project";
    process.env["GITLAB_TOKEN"] = "existing-token";
    const existingConfig = loadConfig();
    assert(existingConfig.gitlabHost === "https://existing.example.com", "Existing env values win over env file");
    assert(existingConfig.gitlabProject === "existing/project", "Existing project env value is preserved");

    if (process.platform !== 'win32') {
      writeFileSync(
        symlinkTargetPath,
        'GITLAB_HOST=https://symlink.example.com\n' +
          'GITLAB_PROJECT=symlink/project\n' +
          'GITLAB_TOKEN=symlink-file-token\n',
        { mode: 0o600 },
      );
      chmodSync(symlinkTargetPath, 0o600);
      symlinkSync(symlinkTargetPath, symlinkEnvPath);
      delete process.env['GITLAB_HOST'];
      delete process.env['GITLAB_PROJECT'];
      delete process.env['GITLAB_TOKEN'];
      process.env['SDLC_ENV_FILE'] = symlinkEnvPath;

      let symlinkMessage = '';
      try {
        loadConfig();
      } catch (error) {
        symlinkMessage = error instanceof Error ? error.message : String(error);
      }
      assert(
        symlinkMessage.includes('symbolic links are not allowed'),
        'Credential-file symbolic links are rejected',
      );
      assert(
        !symlinkMessage.includes('symlink-file-token'),
        'Credentials-file symlink errors do not expose values',
      );

      writeFileSync(
        insecureEnvPath,
        'GITLAB_HOST=https://insecure.example.com\n' +
          'GITLAB_PROJECT=insecure/project\n' +
          'GITLAB_TOKEN=insecure-file-token\n',
        { mode: 0o600 },
      );
      chmodSync(insecureEnvPath, 0o644);
      delete process.env['GITLAB_HOST'];
      delete process.env['GITLAB_PROJECT'];
      delete process.env['GITLAB_TOKEN'];
      process.env['SDLC_ENV_FILE'] = insecureEnvPath;

      let insecureMessage = '';
      try {
        loadConfig();
      } catch (error) {
        insecureMessage = error instanceof Error ? error.message : String(error);
      }
      assert(
        insecureMessage.includes('mode 644') && insecureMessage.includes('chmod 600'),
        'Group/world-readable credentials files are rejected with remediation',
      );
      assert(
        !insecureMessage.includes('insecure-file-token'),
        'Credentials-file permission errors do not expose values',
      );
    }

    delete process.env["GITLAB_HOST"];
    delete process.env["GITLAB_PROJECT"];
    delete process.env["GITLAB_TOKEN"];
    process.env["SDLC_ENV_FILE"] = join(tempDir, "missing.env");

    let caughtMsg = "";
    try {
      loadConfig();
    } catch (error) {
      caughtMsg = error instanceof Error ? error.message : String(error);
    }
    assert(caughtMsg.includes("Missing required"), "Missing variables produce a descriptive error");
    assert(!caughtMsg.includes("existing-token"), "Error message does not log credential values");

    let liveError = '';
    try {
      loadLiveConfig();
    } catch (error) {
      liveError = error instanceof Error ? error.message : String(error);
    }
    assert(
      liveError.includes('Live smoke requested') && liveError.includes('Missing required'),
      'Live smoke fails clearly when requested credentials are absent',
    );
  } finally {
    for (const key of keys) {
      const value = original.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Test suite: GitLabClient (mock fetch)
// ---------------------------------------------------------------------------

async function testGitLabClientMock(): Promise<void> {
  section("GitLabClient (mock fetch)");

  let mrListUrl = '';
  const ctx = buildMockContext((url) => {
    if (/\/issues\/1\/notes/.test(url)) return { status: 200, body: [] };
    if (/\/issues\/1$/.test(url)) return { status: 200, body: MOCK_ISSUE };
    if (/\/issues(\?|$)/.test(url)) return { status: 200, body: [MOCK_ISSUE] };
    if (/\/merge_requests\/10$/.test(url)) return { status: 200, body: MOCK_MR };
    if (/\/merge_requests(\?|$)/.test(url)) {
      mrListUrl = url;
      return { status: 200, body: [MOCK_MR] };
    }
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

  const mrs = await ctx.gitlab.listMRs({ state: 'all' });
  assert(mrs.length === 1, 'listMRs returns an array');
  assert(
    new URL(mrListUrl).searchParams.get('scope') === 'all',
    'listMRs includes scope=all for project-wide results',
  );

  const username = await ctx.gitlab.ping();
  assert(username === "test-user", "ping returns username");

  await assertThrows(
    () => ctx.gitlab.getIssue(999),
    "GitLabApiError thrown on 404"
  );

  let redirectMode: RequestInit['redirect'];
  let redirectToken: string | null = null;
  const redirectClient = new GitLabClient(
    'https://gitlab.example.com',
    'mock-token',
    'demo/project',
    async (_url, init): Promise<Response> => {
      redirectMode = init?.redirect;
      redirectToken = new Headers(init?.headers).get('PRIVATE-TOKEN');
      return new Response(JSON.stringify({ username: 'test-user' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );
  await redirectClient.ping();
  assert(
    redirectMode === 'error',
    'authenticated requests reject redirects before PRIVATE-TOKEN can be forwarded',
  );
  assert(
    redirectToken === 'mock-token',
    'authenticated requests retain the PRIVATE-TOKEN header',
  );

  const timeoutClient = new GitLabClient(
    'https://gitlab.example.com',
    'mock-token',
    'demo/project',
    (_url, init): Promise<Response> => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error('Missing request timeout signal.'));
        return;
      }
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    10,
  );
  let timeoutError: unknown;
  try {
    await timeoutClient.ping();
  } catch (error) {
    timeoutError = error;
  }
  assert(
    timeoutError instanceof GitLabRequestTimeoutError,
    'request deadline throws GitLabRequestTimeoutError',
  );
  assert(
    timeoutError instanceof Error && timeoutError.message.includes('10ms'),
    'request timeout error states the configured deadline',
  );

  const bodyTimeoutClient = new GitLabClient(
    'https://gitlab.example.com',
    'mock-token',
    'demo/project',
    async (_url, init): Promise<Response> => {
      const signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller): void {
          controller.enqueue(new TextEncoder().encode('{"username":'));
          signal?.addEventListener('abort', () => {
            controller.error(new Error('Body read aborted.'));
          }, { once: true });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    10,
  );
  let bodyTimeoutError: unknown;
  try {
    await bodyTimeoutClient.ping();
  } catch (error) {
    bodyTimeoutError = error;
  }
  assert(
    bodyTimeoutError instanceof GitLabRequestTimeoutError,
    'request deadline remains active while the response body is consumed',
  );
}

// ---------------------------------------------------------------------------
// Test suite: GitLabClient pagination (mock fetch)
// ---------------------------------------------------------------------------

async function testGitLabClientPagination(): Promise<void> {
  section('GitLabClient pagination (mock fetch)');

  const firstLabels = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    name: `label-${index + 1}`,
    color: '#000000',
    description: null,
  }));
  const lastLabel = {
    id: 101,
    name: 'label-101',
    color: '#000000',
    description: null,
  };
  const firstNotes = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    body: `note-${index + 1}`,
    author: { id: 1, username: 'dev', name: 'Dev User' },
    created_at: '2024-01-01T00:00:00Z',
    system: false,
  }));
  const lastNote = {
    id: 101,
    body: 'note-101',
    author: { id: 1, username: 'dev', name: 'Dev User' },
    created_at: '2024-01-01T00:00:00Z',
    system: false,
  };
  const requestedUrls: string[] = [];
  const ctx = buildMockContext((url) => {
    requestedUrls.push(url);
    const parsed = new URL(url);
    const isFirstPage = parsed.searchParams.get('page') === '1';

    if (parsed.pathname.endsWith('/labels')) {
      return { status: 200, body: isFirstPage ? firstLabels : [lastLabel] };
    }
    if (parsed.pathname.endsWith('/issues/1/notes')) {
      return { status: 200, body: isFirstPage ? firstNotes : [lastNote] };
    }
    if (parsed.pathname.endsWith('/merge_requests/10/notes')) {
      return { status: 200, body: isFirstPage ? firstNotes : [lastNote] };
    }
    return { status: 404, body: { message: 'Not found' } };
  });

  const labels = await ctx.gitlab.listLabels();
  const issueNotes = await ctx.gitlab.listIssueNotes(1);
  const mrNotes = await ctx.gitlab.listMRNotes(10);
  assert(labels.length === 101, 'listLabels returns results beyond the first 100');
  assert(issueNotes.length === 101, 'listIssueNotes returns results beyond the first 100');
  assert(mrNotes.length === 101, 'listMRNotes returns results beyond the first 100');

  for (const suffix of ['/labels', '/issues/1/notes', '/merge_requests/10/notes']) {
    const pages = requestedUrls
      .filter((url) => new URL(url).pathname.endsWith(suffix))
      .map((url) => new URL(url).searchParams.get('page'));
    assert(pages.join(',') === '1,2', `${suffix} requests every result page`);
  }

  let pageLimitCalls = 0;
  const pageLimitClient = new GitLabClient(
    'https://gitlab.example.com',
    'mock-token',
    'demo/project',
    async (): Promise<Response> => {
      pageLimitCalls += 1;
      return new Response(JSON.stringify(firstLabels), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  );
  let pageLimitError: unknown;
  try {
    await pageLimitClient.listLabels();
  } catch (error) {
    pageLimitError = error;
  }
  assert(
    pageLimitError instanceof Error &&
      pageLimitError.message.includes(`${MAX_GITLAB_PAGES} page limit`),
    'pagination fails closed at the page limit',
  );
  assert(
    pageLimitCalls === MAX_GITLAB_PAGES,
    'pagination does not request a page beyond the page limit',
  );

  const oversizedPage = Array.from({ length: MAX_GITLAB_ITEMS + 1 }, (_, index) => ({
    id: index + 1,
    name: `oversized-label-${index + 1}`,
    color: '#000000',
    description: null,
  }));
  const itemLimitClient = new GitLabClient(
    'https://gitlab.example.com',
    'mock-token',
    'demo/project',
    makeMockFetch(() => ({ status: 200, body: oversizedPage })),
  );
  let itemLimitError: unknown;
  try {
    await itemLimitClient.listLabels();
  } catch (error) {
    itemLimitError = error;
  }
  assert(
    itemLimitError instanceof Error &&
      itemLimitError.message.includes(`${MAX_GITLAB_ITEMS} item limit`),
    'pagination fails closed at the item limit',
  );

  const paginationTimeoutMs = 200;
  let paginationCalls = 0;
  const paginationTimeoutClient = new GitLabClient(
    'https://gitlab.example.com',
    'mock-token',
    'demo/project',
    async (_url, init): Promise<Response> => {
      paginationCalls += 1;
      if (paginationCalls === 1) {
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 75));
        return new Response(JSON.stringify(firstLabels), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error('Missing pagination timeout signal.'));
          return;
        }
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    paginationTimeoutMs,
  );
  let paginationTimeoutError: unknown;
  try {
    await paginationTimeoutClient.listLabels();
  } catch (error) {
    paginationTimeoutError = error;
  }
  assert(
    paginationCalls === 2,
    'pagination reaches the second page before the overall deadline',
  );
  assert(
    paginationTimeoutError instanceof GitLabRequestTimeoutError &&
      paginationTimeoutError.timeoutMs === paginationTimeoutMs,
    'pagination reports the configured overall deadline for later pages',
  );
}

// ---------------------------------------------------------------------------
// Test suite: gitlab-issue-reader
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Test suite: gitlab-issue-writer
// ---------------------------------------------------------------------------

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

  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    ...MOCK_ISSUE,
    id: index + 100,
    iid: index + 100,
    title: `Different issue ${index}`,
  }));
  const pagedCtx = buildMockContext((url) => {
    const page = new URL(url).searchParams.get("page");
    return page === "1"
      ? { status: 200, body: firstPage }
      : { status: 200, body: [MOCK_ISSUE] };
  });
  const pagedDuplicate = await gitlabIssueWriterTool.execute({
    action: "create-issue",
    title: MOCK_ISSUE.title,
  }, pagedCtx) as { duplicate: boolean };
  assert(pagedDuplicate.duplicate === true, "create-issue finds duplicates after the first result page");

  // Create with force=true bypasses duplicate check; verify labels, milestone, assignees
  let capturedBody: unknown;
  const createCtx = buildMockContext((url, init) => {
    if (url.includes("/issues") && init?.method === "POST") {
      capturedBody = init.body ? JSON.parse(init.body as string) : null;
      return { status: 200, body: { ...MOCK_ISSUE, iid: 2, title: MOCK_ISSUE.title } };
    }
    if (url.includes("/issues")) return { status: 200, body: [MOCK_ISSUE] };
    return { status: 404, body: { message: "Not found" } };
  });

  const created = await gitlabIssueWriterTool.execute({
    action: "create-issue",
    title: MOCK_ISSUE.title,
    labels: ["bug", "priority::high"],
    milestone_id: 5,
    assignee_id: 10,
    force: true,
  }, createCtx) as { iid: number };
  assert(created.iid === 2, "create-issue with force=true creates the issue");
  const body = capturedBody as Record<string, unknown>;
  assert(body["labels"] === "bug,priority::high", "create-issue sends labels as comma-separated string");
  assert(body["milestone_id"] === 5, "create-issue sends milestone_id");
  assert(body["assignee_id"] === 10, "create-issue sends the GitLab CE assignee_id");

  // update-issue: labels replacement
  let updateBody: unknown;
  const updateCtx = buildMockContext((url, init) => {
    if (url.includes("/issues/1") && init?.method === "PUT") {
      updateBody = init.body ? JSON.parse(init.body as string) : null;
      return { status: 200, body: MOCK_ISSUE };
    }
    if (url.includes("/issues/1")) return { status: 200, body: MOCK_ISSUE };
    return { status: 404, body: { message: "Not found" } };
  });

  await gitlabIssueWriterTool.execute({
    action: "update-issue",
    iid: 1,
    labels: ["type::story", "status::in-progress"],
    milestone_id: 3,
    assignee_id: 42,
  }, updateCtx);
  const ub = updateBody as Record<string, unknown>;
  assert(ub["labels"] === "type::story,status::in-progress", "update-issue sends labels as comma-separated string");
  assert(ub["milestone_id"] === 3, "update-issue sends milestone_id");
  assert(ub["assignee_id"] === 42, "update-issue sends the GitLab CE assignee_id");

  await gitlabIssueWriterTool.execute({
    action: "update-issue",
    iid: 1,
    assignee_id: 0,
  }, updateCtx);
  assert((updateBody as Record<string, unknown>)["assignee_id"] === 0, "update-issue sends assignee_id=0 to clear the assignee");

  await gitlabIssueWriterTool.execute({
    action: "update-issue",
    iid: 1,
    milestone_id: 0,
  }, updateCtx);
  assert((updateBody as Record<string, unknown>)["milestone_id"] === 0, "update-issue sends milestone_id=0 to remove a milestone");

  // add-label / remove-label: partial update
  let addRemoveBody: unknown;
  let labelReadCount = 0;
  const addRemoveCtx = buildMockContext((url, init) => {
    if (url.includes("/issues/1") && init?.method === "PUT") {
      addRemoveBody = init.body ? JSON.parse(init.body as string) : null;
      return { status: 200, body: MOCK_ISSUE };
    }
    if (url.includes("/issues/1")) {
      labelReadCount += 1;
      return { status: 200, body: MOCK_ISSUE };
    }
    return { status: 404, body: { message: "Not found" } };
  });
  await gitlabIssueWriterTool.execute({
    action: "update-issue",
    iid: 1,
    add_labels: ["new-label"],
    remove_labels: ["type::story"],
  }, addRemoveCtx);
  const arb = addRemoveBody as Record<string, unknown>;
  assert(arb['add_labels'] === 'new-label', 'add_labels uses GitLab native label addition');
  assert(
    arb['remove_labels'] === 'type::story',
    'remove_labels uses GitLab native label removal',
  );
  assert(arb['labels'] === undefined, 'partial label updates do not replace all labels');
  assert(labelReadCount === 0, 'partial label updates do not race through a read-modify-write');

  const conflictingLabels = gitlabIssueWriterTool.argsSchema.safeParse({
    action: 'update-issue',
    iid: 1,
    labels: ['replacement'],
    add_labels: ['addition'],
    remove_labels: ['removal'],
  });
  assert(
    conflictingLabels.success === false,
    'update-issue rejects labels replacement combined with add/remove operations',
  );

  // close-issue
  let closeBody: unknown;
  const closeCtx = buildMockContext((url, init) => {
    if (url.includes("/issues/1") && init?.method === "PUT") {
      closeBody = init.body ? JSON.parse(init.body as string) : null;
      return { status: 200, body: { ...MOCK_ISSUE, state: "closed" } };
    }
    return { status: 404, body: { message: "Not found" } };
  });
  await gitlabIssueWriterTool.execute({ action: "close-issue", iid: 1 }, closeCtx);
  assert((closeBody as Record<string, unknown>)["state_event"] === "close", "close-issue sends state_event=close");

  // reopen-issue
  let reopenBody: unknown;
  const reopenCtx = buildMockContext((url, init) => {
    if (url.includes("/issues/1") && init?.method === "PUT") {
      reopenBody = init.body ? JSON.parse(init.body as string) : null;
      return { status: 200, body: MOCK_ISSUE };
    }
    return { status: 404, body: { message: "Not found" } };
  });
  await gitlabIssueWriterTool.execute({ action: "reopen-issue", iid: 1 }, reopenCtx);
  assert((reopenBody as Record<string, unknown>)["state_event"] === "reopen", "reopen-issue sends state_event=reopen");

  // add-note
  let noteBody: unknown;
  const noteCtx = buildMockContext((url, init) => {
    if (url.includes("/issues/1/notes") && init?.method === "POST") {
      noteBody = init.body ? JSON.parse(init.body as string) : null;
      return { status: 200, body: { id: 99, body: "hello", author: { id: 1, username: "dev", name: "Dev" }, created_at: "", system: false } };
    }
    return { status: 404, body: { message: "Not found" } };
  });
  await gitlabIssueWriterTool.execute({ action: "add-note", iid: 1, body: "hello" }, noteCtx);
  assert((noteBody as Record<string, unknown>)["body"] === "hello", "add-note sends correct body");

  // create-link
  let linkBody: unknown;
  const linkCtx = buildMockContext((url, init) => {
    if (/\/projects\/demo%2Fproject$/.test(url) && !init?.method) {
      return { status: 200, body: { id: 42 } };
    }
    if (url.includes("/issues/1/links") && init?.method === "POST") {
      linkBody = init.body ? JSON.parse(init.body as string) : null;
      return { status: 201, body: { link_type: "blocks" } };
    }
    return { status: 404, body: { message: "Not found" } };
  });
  await gitlabIssueWriterTool.execute({
    action: "create-link",
    source_iid: 1,
    target_iid: 2,
    link_type: "blocks",
  }, linkCtx);
  const parsedLinkBody = linkBody as Record<string, unknown>;
  assert(parsedLinkBody["target_project_id"] === 42, "create-link stays scoped to the configured project");
  assert(parsedLinkBody["target_issue_iid"] === 2, "create-link sends the target IID");
  assert(parsedLinkBody["link_type"] === "blocks", "create-link maps the relationship type");
}

// ---------------------------------------------------------------------------
// Test suite: gitlab-mr-reader-writer
// ---------------------------------------------------------------------------

async function testGitLabMrReaderWriter(): Promise<void> {
  section("gitlab-mr-reader-writer tool (mock)");

  let requestBody: Record<string, unknown> = {};
  const ctx = buildMockContext((url, init) => {
    if (init?.body) {
      requestBody = JSON.parse(init.body as string) as Record<string, unknown>;
    }
    if (url.includes("/merge_requests/10/notes") && init?.method === "POST") {
      return { status: 200, body: { id: 1, body: requestBody["body"] } };
    }
    if (url.includes("/merge_requests/10/notes")) return { status: 200, body: [] };
    if (url.includes("/merge_requests/10") && init?.method === "PUT") {
      return { status: 200, body: { ...MOCK_MR, ...requestBody } };
    }
    if (url.includes("/merge_requests/10")) return { status: 200, body: MOCK_MR };
    if (url.includes("/merge_requests") && init?.method === "POST") {
      return { status: 201, body: { ...MOCK_MR, ...requestBody } };
    }
    if (url.includes("/merge_requests")) return { status: 200, body: [MOCK_MR] };
    return { status: 404, body: { message: "Not found" } };
  });

  const mrs = await gitlabMrReaderWriterTool.execute({ action: "list-mrs" }, ctx) as unknown[];
  assert(mrs.length === 1, "list-mrs returns array");

  const mr = await gitlabMrReaderWriterTool.execute({ action: "get-mr", iid: 10 }, ctx) as { state: string };
  assert(mr.state === "merged", "get-mr returns merged MR");

  await gitlabMrReaderWriterTool.execute({
    action: "create-mr",
    source_branch: "feature/test",
    target_branch: "main",
    title: "feat: test MR writer",
    assignee_id: 42,
  }, ctx);
  assert(requestBody["source_branch"] === "feature/test", "create-mr sends source branch");
  assert(requestBody["remove_source_branch"] === true, "create-mr defaults remove_source_branch to true");
  assert(requestBody["assignee_id"] === 42, "create-mr sends assignee_id");

  await gitlabMrReaderWriterTool.execute({
    action: "update-mr",
    iid: 10,
    title: "feat: updated MR",
    assignee_id: 7,
  }, ctx);
  assert(requestBody["title"] === "feat: updated MR", "update-mr sends title");
  assert(requestBody["assignee_id"] === 7, "update-mr sends assignee_id");

  await gitlabMrReaderWriterTool.execute({ action: "close-mr", iid: 10 }, ctx);
  assert(requestBody["state_event"] === "close", "close-mr sends state_event=close");

  const notes = await gitlabMrReaderWriterTool.execute({
    action: "list-notes",
    iid: 10,
  }, ctx) as unknown[];
  assert(Array.isArray(notes), "list-notes returns an array");

  await gitlabMrReaderWriterTool.execute({
    action: "add-note",
    iid: 10,
    body: "MR review note",
  }, ctx);
  assert(requestBody["body"] === "MR review note", "add-note sends the MR note body");
}

// ---------------------------------------------------------------------------
// Test suite: GitLabApiError structure
// ---------------------------------------------------------------------------

async function testGitLabApiError(): Promise<void> {
  section("GitLabApiError structure");

  const err = new GitLabApiError(404, "/api/v4/projects/1/issues/99", "Not found");
  assert(err.status === 404, "GitLabApiError carries status");
  assert(err.endpoint === "/api/v4/projects/1/issues/99", "GitLabApiError carries endpoint");
  assert(err instanceof Error, "GitLabApiError is an Error");
}

// ---------------------------------------------------------------------------
// MCP transport integration — uses InMemoryTransport.createLinkedPair()
// ---------------------------------------------------------------------------

/**
 * Verifies that createServer() + InMemoryTransport produces a working MCP
 * server without spawning a subprocess, and that:
 *  - listTools() returns all five tools
 *  - every tool has a non-empty input schema containing the "action" field
 *  - tools can be invoked through the MCP client (not by calling execute() directly)
 *  - invalid actions produce validation errors (not silent failures)
 */
async function testMcpTransportIntegration(): Promise<void> {
  section("MCP transport integration (InMemoryTransport — no subprocess)");

  // Build mock context for the server (tools that need GitLab will use mock fetch)
  const serverContext = buildMockContext((url) => {
    if (/\/issues\/1\/notes/.test(url)) return { status: 200, body: [] };
    if (/\/issues\/1$/.test(url)) return { status: 200, body: MOCK_ISSUE };
    if (/\/issues(\?|$)/.test(url)) return { status: 200, body: [MOCK_ISSUE] };
    if (/\/merge_requests\/10$/.test(url)) return { status: 200, body: MOCK_MR };
    if (/\/merge_requests(\?|$)/.test(url)) return { status: 200, body: [MOCK_MR] };
    if (/\/labels(\?|$)/.test(url)) return { status: 200, body: [] };
    if (/\/user$/.test(url)) return { status: 200, body: { username: "test-user" } };
    return { status: 404, body: { message: "Not found" } };
  });

  const server = createServer(serverContext);
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();

  const mcpClient = new Client({ name: "smoke-test-client", version: "0.1.0" });

  try {
    await Promise.all([
      server.connect(serverTransport),
      mcpClient.connect(clientTransport),
    ]);

    // 1. listTools — all five tools present
    const { tools } = await mcpClient.listTools();
    const toolNames = tools.map((t) => t.name);
    const expectedTools = [
      "gitlab-issue-reader",
      "gitlab-issue-writer",
      "gitlab-mr-reader-writer",
      "work-item-format",
      "sdlc-review-decision",
    ];
    assert(tools.length === expectedTools.length, `listTools reports ${expectedTools.length} tools (got ${tools.length})`);
    for (const name of expectedTools) {
      assert(toolNames.includes(name), `listTools includes ${name}`);
    }

    // 2. Every tool exposes Bob-compatible top-level properties. The server's
    // Zod schema still enforces action-specific required fields at call time.
    for (const tool of tools) {
      const schema = tool.inputSchema as {
        type?: string;
        properties?: Record<string, { enum?: string[] }>;
        required?: string[];
      };
      assert(schema.type === "object", `${tool.name} publishes an object input schema`);
      assert(Object.keys(schema.properties ?? {}).length > 1, `${tool.name} publishes top-level parameters for Bob`);
      assert((schema.properties?.["action"]?.enum?.length ?? 0) > 0, `${tool.name} publishes allowed actions`);
      assert(schema.required?.includes("action") === true, `${tool.name} requires action`);
    }

    const writerSchema = tools.find((tool) => tool.name === "gitlab-issue-writer")?.inputSchema as {
      properties?: Record<string, unknown>;
    };
    assert(writerSchema.properties?.["iid"] !== undefined, "writer schema exposes iid");
    assert(writerSchema.properties?.["source_iid"] !== undefined, "writer schema exposes source_iid");
    assert(writerSchema.properties?.["target_iid"] !== undefined, "writer schema exposes target_iid");

    // 3. Invoke work-item-format through the MCP client (get-standard)
    const fmtResult = await mcpClient.callTool({
      name: "work-item-format",
      arguments: { action: "get-standard" },
    });
    const fmtText = (fmtResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const fmtParsed = JSON.parse(fmtText) as { standard: unknown };
    assert(
      typeof fmtParsed.standard === "object" && fmtParsed.standard !== null,
      "work-item-format get-standard returns standard object via MCP transport"
    );

    // Review runtime bridge — proves the fifth tool can load the compiled skill
    // and return telemetry through the same MCP transport Bob uses.
    const reviewTmp = mkdtempSync(join(tmpdir(), "sdlc-review-mcp-"));
    const oldTelemetryPath = process.env["SDLC_TELEMETRY_PATH"];
    process.env["SDLC_TELEMETRY_PATH"] = join(reviewTmp, "telemetry.jsonl");
    try {
      const reviewResult = await mcpClient.callTool({
        name: "sdlc-review-decision",
        arguments: { action: "summary" },
      });
      const reviewText = (reviewResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
      const reviewParsed = JSON.parse(reviewText) as { total?: number; acceptanceRate?: number };
      assert(
        reviewParsed.total === 0 && reviewParsed.acceptanceRate === 0,
        "sdlc-review-decision loads the skill runtime and returns telemetry summary"
      );
    } finally {
      if (oldTelemetryPath === undefined) delete process.env["SDLC_TELEMETRY_PATH"];
      else process.env["SDLC_TELEMETRY_PATH"] = oldTelemetryPath;
      rmSync(reviewTmp, { recursive: true, force: true });
    }

    // 4. Invoke work-item-format validate-item through the MCP client
    const validateResult = await mcpClient.callTool({
      name: "work-item-format",
      arguments: {
        action: "validate-item",
        type: "User Story",
        title: "As a developer, I can see AC suggestions so that I save time",
        description: STORY_DESCRIPTION,
        acceptanceCriteria: "**Given** x\n**When** y\n**Then** z",
      },
    });
    const vText = (validateResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const vParsed = JSON.parse(vText) as { valid: boolean };
    assert(vParsed.valid === true, "validate-item through MCP transport passes a valid User Story");

    // 5. Invoke gitlab-issue-reader list-issues through MCP client
    const readerResult = await mcpClient.callTool({
      name: "gitlab-issue-reader",
      arguments: { action: "list-issues" },
    });
    const readerText = (readerResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const readerParsed = JSON.parse(readerText);
    assert(Array.isArray(readerParsed), "gitlab-issue-reader list-issues returns array via MCP transport");

    // 6. Invoke gitlab-issue-writer create-issue (duplicate detection path) through MCP client
    const writerResult = await mcpClient.callTool({
      name: "gitlab-issue-writer",
      arguments: { action: "create-issue", title: MOCK_ISSUE.title },
    });
    const writerText = (writerResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const writerParsed = JSON.parse(writerText) as { duplicate: boolean };
    assert(writerParsed.duplicate === true, "gitlab-issue-writer duplicate detection works via MCP transport");

    // 7. Invoke gitlab-mr-reader-writer list-mrs through MCP client
    const mrResult = await mcpClient.callTool({
      name: "gitlab-mr-reader-writer",
      arguments: { action: "list-mrs" },
    });
    const mrText = (mrResult.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const mrParsed = JSON.parse(mrText);
    assert(Array.isArray(mrParsed), "gitlab-mr-reader-writer list-mrs returns array via MCP transport");

    // 8. Invalid action produces a validation error (not silent failure)
    let invalidActionRejected = false;
    try {
      const badResult = await mcpClient.callTool({
        name: "work-item-format",
        arguments: { action: "not-a-real-action" },
      });
      invalidActionRejected = (badResult as { isError?: boolean }).isError === true;
    } catch {
      invalidActionRejected = true;
    }
    assert(invalidActionRejected, "work-item-format rejects an invalid action with a validation error via MCP transport");

  } finally {
    await mcpClient.close();
  }
}

// ---------------------------------------------------------------------------
// MCP stdio integration — starts the compiled production entry point
// ---------------------------------------------------------------------------

/**
 * Verify the compiled entry point and stdio framing used by Bob.
 */
async function testMcpStdioIntegration(): Promise<void> {
  section("MCP stdio integration (compiled subprocess)");
  const serverPath = resolve(dirname(fileURLToPath(import.meta.url)), "index.js");
  const tempDir = mkdtempSync(join(tmpdir(), 'sdlc-mcp-stdio-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: {
      ...getDefaultEnvironment(),
      GITLAB_HOST: "https://gitlab.example.com",
      GITLAB_PROJECT: "demo/project",
      GITLAB_TOKEN: "smoke-test-token",
      SDLC_ENV_FILE: join(tempDir, '.env.missing'),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "stdio-smoke-test-client", version: "0.1.0" });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert(tools.length === 5, "compiled stdio server publishes all five tools");
    const result = await client.callTool({
      name: "work-item-format",
      arguments: { action: "get-template", type: "Task" },
    });
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    const parsed = JSON.parse(text) as { template?: { type?: string } };
    assert(parsed.template?.type === "Task", "compiled stdio server executes a tool call");
  } finally {
    await client.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Live smoke test (optional — requires real GitLab credentials)
// ---------------------------------------------------------------------------

/**
 * Load credentials for a requested live smoke run and add actionable context to errors.
 * @returns Validated GitLab configuration.
 */
function loadLiveConfig(): Config {
  try {
    return loadConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Live smoke requested but credentials could not be loaded: ${message}`);
  }
}

async function testLive(): Promise<void> {
  section("Live GitLab smoke test");

  try {
    const config = loadLiveConfig();
    const client = new GitLabClient(
      config.gitlabHost,
      config.gitlabToken,
      config.gitlabProject,
    );
    const username = await client.ping();
    assert(typeof username === "string" && username.length > 0, `Authenticated as ${username}`);

    const labelsResult = await client.listLabels();
    assert(Array.isArray(labelsResult), `Labels endpoint reachable (${labelsResult.length} labels)`);

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
  // Best-effort merge of the repository-root .env into process.env so
  // SDLC_SMOKE_LIVE and the GitLab credentials can come from .env alone —
  // matches the installed MCP configuration. Never overrides values already
  // set in the shell; testLive() reports an actionable error when requested
  // credentials are absent.
  mergeEnvFile();

  process.stdout.write("sdlc-harness MCP server — smoke test\n");
  process.stdout.write("======================================\n");

  await testWorkItemFormat();
  await testConfigLoading();
  await testGitLabClientMock();
  await testGitLabClientPagination();
  await testGitLabIssueReader();
  await testGitLabIssueWriter();
  await testGitLabMrReaderWriter();
  await testGitLabApiError();
  await testMcpTransportIntegration();
  await testMcpStdioIntegration();

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
