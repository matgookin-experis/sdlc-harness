# sdlc-harness MVP — Task List

## Priority Legend

- **P0** — required for the MVP demo. Nothing else matters until these work end-to-end.
- **P1** — stretch. Build only if time remains after every P0 item is solid.
- **P2** — explicitly out of scope for this demo. Listed so it isn't forgotten later, not so it gets built now.

## Scope Decisions

- **GitLab hosting:** self-hosted GitLab CE via Docker (confirmed). This is heavier than a hosted alternative — budget real time and RAM for it, and get the smoke test green before building anything on top.
- **Agent tiering:** P0 = Acceptance-criteria drafting, Ambiguity detection, Dependency suggestion, State-transition. P1 = Test-coverage linkage (hardest to seed convincingly with fake data in a live demo — hold back unless the four P0 agents and the demo loop are already solid).
- **Plumbing reuse:** the MCP server skeleton, GitLab REST client, tool-registry pattern, and Bob-config merge/install pattern from the earlier `bob-devops-kit` recreation plan are reused as engineering scaffolding (Section 2A below). Its generic skill set — `backlog-hygiene`, `work-item-optimizer`, `sprint-worker`, `hierarchy-scaffolding`, `code-review`, `formatting-compliance-audit`, `project-researcher` — and its coding-guidelines engine (`guidelines-init/search/status/validate`) solve a **different, adjacent problem** (a general-purpose GitLab coding-assistant kit). They are explicitly **out of scope (P2)** for sdlc-harness and should not be built here.

## Recommended build order (critical path)

Section 1 (infra) → Section 2A (plumbing) → Section 2B (P0 agents + onboarding + review UX) → Section 3 (config/wiring) → Section 4 (onboarding runbook + seed data) → Section 5 (demo plan). Do not start Section 2B until Section 2A's smoke test is green.

---

## 1. Infrastructure: GitLab Docker Environment

1. **GitLab container setup** `[P0]` — author a `docker-compose.yml` that spins up a GitLab CE instance with persistent volumes for config, logs, and data; document the minimum host requirements.
2. **GitLab initial configuration** `[P0]` — script the root password seed, disable sign-ups, create a dedicated `sdlc-harness-demo` group and project via the GitLab API on first boot.
3. **Demo website container** `[P0]` — add a second service to `docker-compose.yml` for a minimal static website (e.g. nginx serving a single HTML page) that represents the "project under governance."
4. **Networking & reverse proxy** `[P1]` — configure an nginx or Traefik reverse proxy so GitLab and the demo site are reachable on named local hostnames (e.g. `gitlab.local`, `demo.local`) without port clashes. Plain `localhost:<port>` links work fine for a single demo run — only build this if time allows.
5. **Security hardening** `[P0]` — confirm no credentials anywhere in source; confirm `.gitignore` coverage for env-files; confirm docs state GitLab credentials come from a runtime env-file only.
6. **Smoke-test script** `[P0]` — write a shell script that validates the full stack is healthy (GitLab readiness endpoint, demo site HTTP 200) and can be run after `docker compose up`. Gate: don't start Section 2 until this passes.

---

## 2A. Plumbing: MCP Server & GitLab Tooling

Reused engineering scaffolding only — not the adjacent generic coding-assistant kit (see Scope Decisions).

7. **MCP server package scaffold** `[P0]` — Node.js + TypeScript package (`package.json`, `tsconfig.json`, `build`/`start`/`smoke` scripts), a shared `ToolDefinition` type (description, zod args, `execute(args, ctx)`) used by every tool.
8. **GitLab REST client** `[P0]` — `gitlab-client.ts` wrapping the Issues, Merge Requests, and Labels endpoints via a PAT-based client.
9. **Env loading** `[P0]` — `env.ts` reads GitLab PAT/host/project from a configurable, gitignored env-file path; never overrides existing env vars or logs values.
10. **Tool registry + server glue** `[P0]` — `tools.ts` registry, `index.ts` (creates an `McpServer`, registers each tool, connects `StdioServerTransport`, stays silent on stderr unless a debug flag is set).
11. **GitLab issue reader/writer tools** `[P0]` — `gitlab-issue-reader` (issues, labels, state) and `gitlab-issue-writer` (create/update with duplicate detection). This is the shared read/write surface every one of the five agents calls.
12. **GitLab MR reader/writer tool** `[P0]` — needed for the state-transition agent's "MR merged → suggest In Review" trigger and for the dependency-suggestion agent to see related work.
13. **`work-item-format` tool** `[P0]` — canonical issue-formatting standard (title conventions, description structure, Given-When-Then acceptance criteria) that the agents defer to when drafting AC or rewriting descriptions.
14. **Bob global-config merge pattern** `[P0]` — reuse the MERGE-ONLY handling for `custom_modes.yaml` and `mcp.json` so installing the skill doesn't clobber an existing Bob config on the demo machine.
15. **`install.sh`** `[P1]` — idempotent installer copying skill/rules/config into `~/.bob`. Nice for repeatability across machines; for a single demo box, manual one-time install is fine.
16. **End-to-end plumbing validation** `[P0]` — `npm install && npm run build && npm run smoke`; confirm all registered tools respond before building agents on top. Gate: don't start Section 2B until this passes.

**Explicitly excluded (P2, different product):** `guidelines-init/search/status/validate` (coding-style guidelines engine — unrelated to work-item governance), the generic `🛠 Engineer` TDD mode and its `rules-engineer/*`, and the generic skills `backlog-hygiene`, `work-item-optimizer`, `sprint-worker`, `hierarchy-scaffolding`, `code-review`, `formatting-compliance-audit`, `project-researcher`.

---

## 2B. sdlc-harness Skill & Agents (the actual product)

done - 17. **Skill scaffold** `[P0]` — create the `SKILL.md` file for the `sdlc-harness` Bob skill with correct frontmatter (name, description, triggers) following the Bob skill authoring conventions.
mat in progress - 18. **Onboarding conversation flow** `[P0]` — define the guided conversation steps that collect project management tool type (GitLab Issues for the demo), project URL, work item types, workflow states, **and transition rules**; document the expected input/output for each step.
mat in progress - 19. **Work item template baseline** `[P0]` — author industry best-practice templates (User Story, Bug, Task, Epic) as structured prompts the skill applies when creating or reviewing work items.
20. **Acceptance criteria agent** `[P0]` — detects issues lacking acceptance criteria and drafts them using the work item description and template as context.
21. **Ambiguity detection agent** `[P0]` — flags descriptions with vague language and proposes concrete rewrites.
22. **Dependency suggestion agent** `[P0]` — scans open issues for semantic overlap and proposes `relates-to` / `blocks` links.
23. **State transition agent** `[P0]` — monitors issue state and proposes the correct next transition based on activity signals (e.g. MR merged → suggest "In Review").
24. **Test coverage linkage agent** `[P1]` — cross-references issues with test files or test plan items and flags uncovered work items. Stretch: hold back until the four P0 agents and demo loop are proven.
25. **Human review interface** `[P0]` — define the Bob interaction pattern by which a developer reviews, approves, edits, or overrides an agent suggestion in natural language without leaving Bob.
26. **Suggestion telemetry** `[P0]` — log each agent proposal plus its outcome (accepted / edited / rejected) to a flat file or a GitLab comment thread. Deliberately minimal — no dashboard — but it's the only concrete hook into the problem statement's "Measuring Success" section (backlog quality / trust / time saved) and lets the demo cite a real acceptance-rate number.

---

## 3. Agent & Skill Configuration

27. **Bob mode definition** `[P0]` — create the `sdlc-harness` custom mode in `custom_modes.yaml` with the appropriate role definition, tool permissions, and skill references.
28. **WatsonX model config** `[P0]` — document and wire the WatsonX model endpoint, API key injection pattern, and model selection rationale for each agent role.
29. **MCP server registry entry** `[P0]` — register the GitLab MCP server in the Bob configuration with correct transport, scope, and secrets-handling pattern.
30. **Agent orchestration design** `[P0]` — document how the four P0 agents (plus where the P1 test-coverage agent would slot in) are triggered (event-driven vs. scheduled poll), how they share context, and how conflicts between agent suggestions are surfaced to the user.
31. **Skill unit tests** `[P1]` — write test cases covering the onboarding flow, each agent's happy path, and the override/rejection path using mock GitLab API responses. Do one manual happy-path pass first; formalize into tests if time remains.

---

## 4. Onboarding Process

32. **Onboarding script / runbook** `[P0]` — write a step-by-step runbook a new team member follows to: start the Docker stack, open Bob, activate the `sdlc-harness` skill, and connect it to the demo GitLab project.
33. **First-run seed data** `[P0]` — create a seed script that populates the demo GitLab project with realistic but intentionally incomplete issues (missing AC, vague descriptions, broken dependencies, missing test links) so every P0 (and the P1) agent has something visible to act on.
34. **Onboarding conversation validation** `[P0]` — verify that after completing the guided onboarding the skill correctly persists project configuration (tool type, URL, templates, transition rules) and is ready to monitor.
35. **Persona & permission guide** `[P1]` — document the two demo personas (Developer, Project Lead) with the GitLab roles and Bob permissions each requires.

---

## 5. Demo Plan

> **Note on length:** the hackathon deliverable is a **≤3-minute video** with **at least 90 seconds** of on-screen solution demo, so the "under 15 minutes" walkthrough below is for internal rehearsal only — item 41 in Section 6 is the actual cut-down submission version.

Mat - In Progress 36. **Demo narrative** `[P0]` — write a concise story arc (≤ 1 page) that takes an observer from "blank project" to "agent-governed backlog," highlighting the four P0 agent actions (and the acceptance-rate number from telemetry, if ready). Draft the full internal walkthrough first, then mark which ~1–2 agent actions are strong enough to carry the 90-second cut-down.
Mat - In Progress 37. **Demo script** `[P0]` — produce a step-by-step facilitator script with exact Bob prompts, expected agent responses, narration lines for each beat, and fallback notes for each step.
38. **Demo reset procedure** `[P1]` — write an idempotent script that tears down and re-seeds the GitLab project to a known state so the demo can be repeated cleanly (also makes re-takes of the video cheap).
Mat - In Progress 39. **Screen recording guide** `[P0]` — window layout, font sizes, and recording settings (resolution, cursor highlighting) so both the Bob chat pane and the GitLab browser view are legible on camera. Required now — it directly feeds the video deliverable in Section 6, not just an optional live demo.
40. **Demo review & dry run** `[P0]` — schedule and execute a full end-to-end dry run of the *long* walkthrough, capture issues, and update the demo script accordingly. Non-negotiable — always do this before recording the video.

---

## 6. Hackathon Submission Deliverables

The four required deliverables. All are `[P0]` — the MVP isn't "done" until these are produced and checked against their stated constraints, not just when the product works.

41. **Record & publish the demo video** `[P0]` — record a ≤3-minute video following the demo script (item 37), timed so judges get: a brief intro to the problem (aim for ≤60–75s), then **at least 90 seconds** of the actual solution running on screen. Narrate every beat. Explicitly show Bob on screen driving the interaction (chat pane visible, not just the GitLab UI) — judges must be able to see Bob being used, not just its output. Depends on items 36/37/39/40. Upload to a publicly accessible URL (YouTube unlisted/public, Loom, etc.) and confirm the link opens in a private/incognito window before submitting.
42. **Finalize the written problem & solution statement** `[P0]` — edit `PROBLEM_STATEMENT.md` (already drafted, ~480 words) down to fit the **500-word hard cap**, while explicitly retaining: the specific problem/challenge, what the solution is, target users, how they interact with it, and why it's creative/unique/"a new way judges haven't seen before." Re-verify the word count after any edit.
43. **Write the "How Bob was used to build this" statement** `[P0]` — new short document (e.g. `BOB_USAGE.md`) giving specific, concrete details on where and how the team used Bob *during development* (skill authoring sessions, MCP tool scaffolding, agent design/iteration, code review) — distinct from how the shipped product itself uses Bob at runtime. Explicitly describe any use of watsonx.ai / watsonx Orchestrate (e.g. the WatsonX model wired in item 28) with specifics, not just a name-drop.
44. **Capture Bob task-session summary screenshots** `[P0]` — throughout the build, capture screenshots of Bob's task/session summaries showing Bob-assisted work (skill authoring, agent implementation, config wiring, debugging sessions). Save them into a repo folder (e.g. `docs/bob-sessions/`) as the build progresses — don't try to reconstruct these retroactively at submission time.
45. **Organize & publish the code repository** `[P0]` — ensure all code, config, and docs (including items 43–44) are committed to a GitHub/GitLab/Bitbucket repo with a README explaining what's included and how to run it; confirm repo visibility matches submission requirements (public or explicitly shared with judges).
46. **Final submission checklist** `[P0]` — before submitting, verify all four deliverables against their exact constraints: video is ≤3 min, publicly accessible, and shows ≥90s of on-screen solution + Bob visibly in use; written statement is ≤500 words; Bob-usage statement is specific (not generic) and covers watsonx if applicable; repo is organized, accessible, and contains the session screenshots.

---

## 7. Documentation Migration

47. **Migrate all documentation to HTML/JavaScript** `[P1]` — convert every Markdown documentation file in the repo (`README.md`, `PROBLEM_STATEMENT.md`, `SECURITY.MD`, `to-do.md`, etc.) to self-contained HTML/JavaScript pages. No Markdown files should be used for documentation going forward; all human-readable docs must be delivered as HTML (with optional JS for navigation/interactivity). Store migrated docs under a `docs/` folder with a root `index.html` as the entry point.
