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
│       ├── install.sh          — Builds the installed CLI runtime
│       ├── src/                — Agents, scoped GitLab adapters, CLI controller
│       └── tests/
│           ├── skill.test.ts   — Core behavior tests
│           ├── regressions.test.ts
│           └── hardening.test.ts
└── custom_modes.yaml           — Custom mode definition (merge into ~/.bob/settings/custom_modes.yaml)
```

## How to Install

### Option A — Automated (recommended)

```bash
bash bob-kit/mcp-server/install.sh
```

This installs dependencies, builds and tests the skill and MCP server, copies the compiled
skill runtime, and merges Bob configuration.

### Option B — Manual

1. **MCP server and skill runtime** — build and register from the **repository root**:
   ```bash
   npm --prefix bob-kit/skills/sdlc-harness ci
   npm --prefix bob-kit/skills/sdlc-harness run build
   npm --prefix bob-kit/mcp-server ci
   npm --prefix bob-kit/mcp-server run build
   node bob-kit/mcp-server/merge-bob-config.mjs
   ```
   Keep the final command at the repository root. Without an explicit path,
   `merge-bob-config.mjs` uses the current directory as the project root and writes that
   location into `SDLC_ENV_FILE`; running it from `bob-kit/mcp-server/` would point Bob at
   the wrong `.env`. The automated installer always supplies the absolute repository root.
2. **Rules** — copy files from `rules/` into `~/.bob/rules/`
3. **Skills** — copy the built `sdlc-harness/` folder from `skills/` into
   `~/.bob/skills/`
4. **Modes** — merge `custom_modes.yaml` into `~/.bob/settings/custom_modes.yaml`

## Credentials

The spawned MCP server reads the repository-root `.env`, not
`bob-kit/mcp-server/.env`. Create it with owner-only permissions:

```bash
install -m 600 bob-kit/mcp-server/.env.example .env
```

Set `GITLAB_HOST`, `GITLAB_PROJECT`, and `GITLAB_TOKEN`, or run
`./gitlab-local/manage.sh refresh-token` after the local GitLab seed completes to mint,
store, and verify a demo-user token without displaying it. If `.env` already exists,
merge the values instead of overwriting it and run `chmod 600 .env`.

## Model and review behavior

Bob supplies the built-in model. The skill controls when generation is invoked, not which
model runs it. Acceptance-criteria and ambiguity prose use generation; dependency,
transition, and coverage detection are deterministic. Audit itself is read-only, and every
finding enters the guarded apply/edit/skip/reject loop before any GitLab write.

## Uninstall

```bash
# Remove Bob-side assets and local build artifacts only
bash bob-kit/mcp-server/uninstall.sh

# Destructive full cleanup, including Docker volumes, .env files, and local state
./gitlab-local/manage.sh uninstall
```

Both commands prompt before removal. The Bob-only uninstaller is idempotent.

## Key documents

| Document | Purpose |
|---|---|
| [`custom_modes.yaml`](./custom_modes.yaml) | `🔧 SDLC Harness` mode — role definition, tool groups, and generation-timing guidance |
| [`mcp-server/`](./mcp-server/) | Custom Node.js MCP server — GitLab issue/MR tools, work-item-format validator |
| [`skills/sdlc-harness/SKILL.md`](./skills/sdlc-harness/SKILL.md) | Full skill spec — agents, executable audit/review flow, conflict handling, telemetry |
| [`skills/sdlc-harness/tests/`](./skills/sdlc-harness/tests/) | Jest coverage for onboarding, agents, scoped GitLab access, review, and telemetry |
