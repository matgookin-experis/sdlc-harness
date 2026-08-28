# Bob Kit — SDLC Harness

Configuration templates and MCP server source for IBM Bob to support the SDLC Harness demo and skill development.

## Structure

```
bob-kit/
├── mcp-server/                — Custom MCP server (GitLab tooling for the sdlc-harness skill)
│   ├── src/                   — TypeScript source
│   ├── install.sh             — Idempotent full installer
│   ├── merge-bob-config.mjs   — MERGE-ONLY Bob config installer
│   └── .env.example           — Credentials template
├── rules/
│   └── 01-sdlc-harness.md     — Project-specific agent behaviors
├── skills/
│   └── sdlc-harness/
│       ├── SKILL.md            — The sdlc-harness Bob skill
│       └── tests/
│           └── skill.test.ts   — Unit tests (onboarding, agents, review, telemetry)
└── custom_modes.yaml           — Custom mode definition (merge into ~/.bob/settings/custom_modes.yaml)
```

## How to Install

### Option A — Automated (recommended)

```bash
bash bob-kit/mcp-server/install.sh
```

This installs dependencies, builds the TypeScript MCP server, merges Bob config, and runs the smoke test.

### Option B — Manual

1. **MCP server** — build and register:
   ```bash
   cd bob-kit/mcp-server && npm install && npm run build
   ```
   Then merge `mcp-server/` entry into Bob's global MCP config via `node bob-kit/mcp-server/merge-bob-config.mjs`.
2. **Rules** — copy files from `rules/` into your workspace `.bob/rules/`
3. **Skills** — copy the `sdlc-harness/` folder from `skills/` into `~/.bob/skills/`
4. **Modes** — merge `custom_modes.yaml` into `~/.bob/settings/custom_modes.yaml`
5. **WatsonX** — Bob IDE → Settings → Providers → WatsonX; set API Key, Project ID, Endpoint URL,
   and default model to `ibm/granite-3-3-8b-instruct`.

## Key documents

| Document | Purpose |
|---|---|
| [`custom_modes.yaml`](./custom_modes.yaml) | `🔧 SDLC Harness` mode — role definition, tool groups, skill/model hints |
| [`mcp-server/`](./mcp-server/) | Custom Node.js MCP server — GitLab issue/MR tools, work-item-format validator |
| [`skills/sdlc-harness/SKILL.md`](./skills/sdlc-harness/SKILL.md) | Full skill spec — agents, conflict detection, telemetry format, TC enablement |
| [`skills/sdlc-harness/tests/skill.test.ts`](./skills/sdlc-harness/tests/skill.test.ts) | Jest tests covering onboarding, each agent's happy path, and the override/rejection path |
