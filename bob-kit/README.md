# Bob Kit — SDLC Harness

Configuration templates for IBM Bob to support the SDLC Harness demo and skill development.

## Structure

```
bob-kit/
├── rules/
│   └── 01-sdlc-harness.md     — Project-specific agent behaviors
├── skills/
│   └── sdlc-harness/
│       ├── SKILL.md            — The sdlc-harness Bob skill
│       └── tests/
│           └── skill.test.ts   — Unit tests (onboarding, agents, review, telemetry)
├── mcp/
│   └── mcp.json               — GitLab MCP server config (merge into global mcp config)
├── custom_modes.yaml           — Custom mode definition (merge into ~/.bob/settings/custom_modes.yaml)
├── WATSONX_CONFIG.md           — WatsonX model selection, credential injection, demo setup checklist
└── AGENT_ORCHESTRATION.md     — Trigger model, context sharing, conflict resolution, telemetry spec
```

## How to Install

1. **Rules** — copy files from `rules/` into your workspace `.bob/rules/`
2. **Skills** — copy the `sdlc-harness/` folder from `skills/` into `~/.bob/skills/`
3. **MCP** — merge `mcp/mcp.json` into your Bob global MCP config
   (Bob IDE → Settings → MCP → "Edit Global MCP"; confirmed path: `~/.bob/settings/mcp_settings.json`)
4. **Modes** — merge `custom_modes.yaml` into `~/.bob/settings/custom_modes.yaml`

See [`WATSONX_CONFIG.md`](./WATSONX_CONFIG.md) for the WatsonX provider setup checklist.

## Key documents

| Document | Purpose |
|---|---|
| [`custom_modes.yaml`](./custom_modes.yaml) | `🔧 SDLC Harness` mode — role definition, tool groups, skill/model hints |
| [`mcp/mcp.json`](./mcp/mcp.json) | `gitlab-local` MCP server — transport, scope, `alwaysAllow`, secrets-handling notes |
| [`WATSONX_CONFIG.md`](./WATSONX_CONFIG.md) | WatsonX credential injection, model selection rationale, demo setup checklist |
| [`AGENT_ORCHESTRATION.md`](./AGENT_ORCHESTRATION.md) | How the four P0 agents are triggered, share context, and surface conflicts to the user |
| [`skills/sdlc-harness/tests/skill.test.ts`](./skills/sdlc-harness/tests/skill.test.ts) | Specification-style Jest tests for onboarding, each agent's happy path, and the override/rejection path |
