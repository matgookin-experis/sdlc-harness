# Onboarding Conversation Validation

**Task 34 — P0**

Verifies that after a user completes the guided onboarding conversation the skill correctly
persists all project configuration and is ready for agent monitoring.

---

## What onboarding must persist

After the user answers all four onboarding questions, the skill must write a
`.sdlc-harness.json` file to the repository root with this schema:

```jsonc
{
  "projectUrl":      "http://localhost:8080/sdlc-harness/weather-dashboard",
  "workItemTypes":   ["Story", "Bug", "Task"],
  "workflowStates":  ["Open", "In Progress", "In Review", "Done"],
  "transitionRules": {
    "Open":       ["In Progress"],
    "In Progress": ["In Review", "Open"],
    "In Review":  ["Done", "In Progress"]
  }
}
```

All four top-level fields are required. The skill must reject (with an actionable error message)
any configuration where `projectUrl` is empty or `workflowStates` is an empty array.

---

## Validation checklist

Run through this checklist after completing the onboarding conversation with Bob.

### 1. Config file created

```bash
cat .sdlc-harness.json
```

Expected: valid JSON containing `projectUrl`, `workItemTypes`, `workflowStates`,
and `transitionRules` matching the values you provided.

**Fail condition:** file does not exist, or is empty, or is not valid JSON.

---

### 2. All four required fields are present

| Field | Type | Requirement |
|---|---|---|
| `projectUrl` | string | Non-empty URL |
| `workItemTypes` | string[] | At least one entry |
| `workflowStates` | string[] | At least two entries |
| `transitionRules` | object | At least one key; each key is a valid `workflowState` |

**Check:**

```bash
python3 -c "
import json, sys
c = json.load(open('.sdlc-harness.json'))
assert c.get('projectUrl'), 'projectUrl missing or empty'
assert c.get('workItemTypes'), 'workItemTypes missing or empty'
assert len(c.get('workflowStates', [])) >= 2, 'workflowStates needs at least 2 entries'
assert c.get('transitionRules'), 'transitionRules missing or empty'
print('OK — all required fields present')
"
```

---

### 3. Idempotent re-run does not error

Re-run the onboarding with the same values (or say `re-onboard` in Bob):

Expected: Bob detects the existing config, reports "already onboarded", and either
skips or offers to overwrite — it does **not** crash or duplicate the file content.

---

### 4. Skill enters monitoring-ready state

After successful onboarding, Bob must offer the governance action menu without
requiring the user to re-enter any configuration:

```
✅ Onboarding complete. Governing: sdlc-harness/weather-dashboard

What would you like to do?
  • Audit
  • Draft
  • Link
  • Transition
  • Template
```

**Fail condition:** Bob asks for the project URL again on the next message, or
throws an error about missing config when the user types `audit`.

---

### 5. Validation errors are actionable

Test that the skill rejects invalid input before writing the config file:

**Test A — missing projectUrl:**

In the onboarding conversation, leave the project URL blank and press Enter.

Expected: Bob replies with an error naming `projectUrl` as the missing field and
prompts the user to re-enter it. The config file is **not** written.

**Test B — empty workflowStates:**

Provide a project URL but enter an empty list for workflow states.

Expected: Bob replies with an error naming `workflowStates` and prompts re-entry.

---

### 6. Config survives Bob restart

After onboarding completes:

1. Close and reopen Bob.
2. Switch to `🔧 SDLC Harness` mode.
3. Type `audit`.

Expected: Bob loads `.sdlc-harness.json` automatically and proceeds to the audit
without asking onboarding questions again.

**Fail condition:** Bob starts the onboarding conversation again from scratch.

---

### 7. MCP server is reachable using the persisted config

After onboarding, trigger an action that requires a live GitLab call (e.g. `audit`
or `Draft for issue #1`). Bob must successfully reach the GitLab API using the
`projectUrl` from `.sdlc-harness.json`.

**Check:**

- Bob lists at least one open issue from the seeded project.
- No "Unauthorized" or "Not Found" errors appear.

If this step fails, check `GITLAB_TOKEN` in `bob-kit/mcp-server/.env` and confirm
the MCP server live smoke test passes:

```bash
cd bob-kit/mcp-server
SDLC_SMOKE_LIVE=true npm run smoke
```

---

## Acceptance criteria (for Task 34)

All seven checks above must pass on a clean machine after following the onboarding
runbook (`docs/onboarding/runbook.md`).

| Check | Pass condition |
|---|---|
| 1. Config file created | `.sdlc-harness.json` exists and is valid JSON |
| 2. All required fields present | Script above exits 0 |
| 3. Idempotent re-run | No error, no duplicate |
| 4. Monitoring-ready state | Governance menu offered without re-prompting |
| 5. Validation errors actionable | Error names the offending field; file not written |
| 6. Config survives Bob restart | Audit works without re-onboarding |
| 7. MCP server reachable | At least one live issue returned; no auth errors |
