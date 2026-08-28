# Agent Orchestration Design

## The four P0 agents (+ P1 slot)

| ID | Agent | Concern |
|---|---|---|
| AC | Acceptance-criteria | Issues without Given-When-Then AC |
| AM | Ambiguity detection | Issues with vague or contradictory descriptions |
| DEP | Dependency suggestion | Issues that likely block or relate to each other |
| ST | State-transition | Issues whose GitLab state is stale relative to activity |
| TC *(P1)* | Test-coverage linkage | Issues with no linked test file or test-plan item |

---

## Conflict detection

A conflict arises when two agents produce suggestions that contradict each other
on the same issue. The two most common cases:

- DEP suggests issue A *blocks* issue B (implying A must finish first), while
  ST suggests transitioning A to Done (implying it is already complete).
- AM rewrites a description in a way that would invalidate AC drafted by AC in
  the same run.

Bob checks for overlapping `issueIid` values across all agent findings before
presenting the review. Conflicting findings are grouped and flagged:

```
⚡ CONFLICT — Issue #7 has suggestions from two agents that may contradict:

  [ST] Proposed transition: Open → In Progress
       (reason: MR !3 referencing this issue was opened 2h ago)

  [DEP] Proposed link: #7 blocks #9
       (reason: both issues describe the same auth token refresh logic)

  → apply ST first / apply DEP first / apply both / skip both
```

Bob does not auto-resolve conflicts. The user decides.

---

## Telemetry format

Every apply / edit / reject outcome is appended to `sdlc-harness-telemetry.jsonl`
in the repo root (append-only, never overwritten):

```jsonc
{
  "ts": "2025-09-01T14:32:10Z",
  "agent": "AC",
  "issueIid": 12,
  "action": "draft_ac",
  "outcome": "accepted",   // "accepted" | "edited" | "rejected"
  "editedFields": []       // populated when outcome = "edited"
}
```

`sdlc-harness-telemetry.jsonl` is gitignored and contains no issue content —
only metadata. The acceptance rate (accepted / (accepted + rejected)) is the
primary trust metric cited in the demo.

---

## Enabling the P1 test-coverage agent

TC is disabled by default (seed data has no test files). To enable:

1. Add at least one test file to `weather-app/` (e.g. `weather.test.js`).
2. Set `"testGlob": "weather-app/**/*.test.*"` in `.sdlc-harness.json`.
3. TC will be included in subsequent audit runs automatically.
