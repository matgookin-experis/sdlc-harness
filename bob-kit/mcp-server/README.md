# sdlc-harness MCP Server

MCP server providing GitLab tooling for the **sdlc-harness** Bob skill.
Part of the SDLC Harness IBM Hackathon project.

---

## Structure

```
mcp-server/
├── src/
│   ├── index.ts                      # Server entry point (stdio transport)
│   ├── tools.ts                      # Tool registry
│   ├── types.ts                      # Shared types (ToolDefinition, ToolContext, GitLab domain)
│   ├── env.ts                        # Safe config loading (no credential logging)
│   ├── gitlab-client.ts              # GitLab REST API client (injectable fetch)
│   ├── smoke.ts                      # End-to-end smoke test
│   └── tools/
│       ├── gitlab-issue-reader.ts    # Read issues, labels, notes
│       ├── gitlab-issue-writer.ts    # Create/update issues, duplicate detection
│       ├── gitlab-mr-reader-writer.ts# Read/write merge requests
│       └── work-item-format.ts       # Canonical formatting standard + validator
├── merge-bob-config.mjs              # MERGE-ONLY Bob config installer
├── install.sh                        # Idempotent full installer
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Prerequisites

- Node.js ≥ 18
- A GitLab instance with a Personal Access Token (`api` scope)

---

## Quick Start

### 1. Install and build

```bash
cd mcp-server
npm install
npm run build
```

### 2. Configure credentials

```bash
cp .env.example .env
# Edit .env — add GITLAB_HOST, GITLAB_PROJECT, GITLAB_TOKEN
```

The `.env` file is gitignored. **Never commit credentials.**

### 3. Run the smoke test (mock — no GitLab needed)

```bash
npm run smoke
```

### 4. Run the live smoke test (requires GitLab instance)

```bash
SDLC_SMOKE_LIVE=true npm run smoke
```

### 5. Install into Bob (merges config without overwriting)

```bash
# From the project root:
bash bob-kit/mcp-server/install.sh
# Or with an explicit path:
bash bob-kit/mcp-server/install.sh /absolute/path/to/sdlc-harness
```

---

## MCP Tools

| Tool | Description |
|---|---|
| `gitlab-issue-reader` | List/get issues, labels, and notes |
| `gitlab-issue-writer` | Create/update issues with duplicate detection |
| `gitlab-mr-reader-writer` | List/get/create/update merge requests and notes |
| `work-item-format` | Return formatting standards and validate work items |

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GITLAB_HOST` | ✅ | GitLab instance URL, e.g. `https://gitlab.example.com` |
| `GITLAB_PROJECT` | ✅ | Project path or numeric ID, e.g. `mygroup/myproject` |
| `GITLAB_TOKEN` | ✅ | Personal Access Token with `api` scope |
| `SDLC_ENV_FILE` | — | Path to env file (default: `.env` in working dir) |
| `SDLC_DEBUG` | — | Set `true` to enable verbose stderr debug output |
| `SDLC_SMOKE_LIVE` | — | Set `true` to run live GitLab checks in smoke test |

---

## Gate: Section 2A Done Criteria

Before starting Section 2B (agents), confirm this command passes:

```bash
cd mcp-server
npm install && npm run build && npm run smoke
```

When the GitLab Docker instance is available, also confirm:

```bash
SDLC_SMOKE_LIVE=true npm run smoke
```

Expected output: all checks pass, authenticated user name is printed.
