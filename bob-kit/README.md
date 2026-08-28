# Bob Kit — SDLC Harness

Configuration templates for IBM Bob to support the SDLC Harness demo and skill development.

## Structure

```
bob-kit/
├── rules/                  — Workspace rules (merged into .bob/rules/)
│   └── 01-sdlc-harness.md  — Project-specific agent behaviors
├── skills/
│   └── sdlc-harness/       — The sdlc-harness Bob skill
│       └── SKILL.md
├── mcp/
│   └── mcp.json            — MCP server config template (merge into global mcp config)
└── custom_modes.yaml       — Custom mode definitions (merge into ~/.bob/settings/custom_modes.yaml)
```

## How to Install

1. **Rules** — copy files from `rules/` into your workspace `.bob/rules/`
2. **Skills** — copy folders from `skills/` into `~/.bob/skills/`
3. **MCP** — merge `mcp/mcp.json` into your Bob global MCP config
4. **Modes** — merge `custom_modes.yaml` into `~/.bob/settings/custom_modes.yaml`
