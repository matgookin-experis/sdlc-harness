# How Bob Was Used to Build This

This describes how the team used the IBM Bob IDE *during development* of sdlc-harness.
It's distinct from how the shipped product uses Bob at runtime, which is covered in
`PROBLEM_STATEMENT.md` and `bob-kit/skills/sdlc-harness/SKILL.md`. Every session referenced
here has a corresponding screenshot in `bob-sessions/`, captured as the build progressed
rather than reconstructed afterward.

## Planning and problem framing

The to-do list this project was built against wasn't written by hand and then handed to
Bob to execute; Bob wrote the first draft of it. The team's prompt (`bob-sessions/
teamexperis_todo_list.png`) pointed Bob at the already-drafted `PROBLEM_STATEMENT.md` and
asked it to break the project into an MVP task list "using the IBM Bob IDE," specifying a
required numbering and priority format, which is the structure `to-do.md` still follows.

`PROBLEM_STATEMENT.md` itself went through a similar loop the other direction: the team
wrote a first pass, then handed it to Bob along with the exact judging constraints (500
words, specific problem, target users, why it's creative) and asked it to tighten the
draft against them (`bob-sessions/teamexperis_problem_statement_solution.png`).

## Infrastructure

The GitLab Docker stack was built and debugged in Bob, not just scaffolded. One session
explicitly asked Bob to troubleshoot why `./manage.sh seed` wasn't working against
`gitlab-local/docker-compose.yml` (`bob-sessions/teamexperis_gitlab_container_debug.png`).
Another asked Bob to confirm, against `to-do.md`, whether Section 1 (Infrastructure) was
actually complete before moving on (`bob-sessions/teamexperis_create_weatherapp_
container.png`) rather than assuming it from memory.

## Skill authoring

The `sdlc-harness` skill scaffold (Task 17) started as its own Bob session: create a
branch off `dev`, then plan the skill scaffold specifically (`bob-sessions/
teamexperis_2b_task_17.png`). `SKILL.md` was then built up incrementally across several
follow-on sessions rather than in one shot, including a later refactor that folded a
separate `AGENT_ORCHESTRATION.md` draft directly into `SKILL.md` once it became clear the
two were describing the same thing from different angles (`git log`: `ed21619 refactor:
fold AGENT_ORCHESTRATION.md into SKILL.md`).

## MCP server and agent implementation

Sections 2A (the MCP server: GitLab client, issue/MR tools, `work-item-format`) and 2B
(the five agents, review interface, telemetry) were built through structured, per-task Bob
sessions rather than one continuous conversation. The Task 18/19 work in particular used
an explicit plan file (`docs/superpowers/plans/2025-07-14-task-18-19-onboarding-
templates.md`) built around the `subagent-driven-development` convention: each dispatched
task gets only its own step and the prior task's handoff summary, not the whole plan
re-read every time, which keeps token cost from scaling linearly with plan length. One of
these sessions (`bob-sessions/teamexperis_tasks2b18and19.png`) shows a 91.5k/270k-token
planning task for exactly this pair of tasks. A separate session
(`bob-sessions/teamexperis_agent_skill_config.png`) shows Section 3 (Tasks 27 through 31:
Bob mode definition, WatsonX config, MCP registry entry, agent orchestration design, skill
unit tests) dispatched to Bob as one batch, at 1.2M tokens sent and an API cost of 2.41 for
that session alone.

The agent design iterated rather than landing correctly on the first pass: a later commit
(`f0032a3 Tasks 20-21: agents produce a draft brief instead of templated prose`) reworked
the AC and Ambiguity agents specifically because their first version produced generic
filler text ("the system responds correctly") instead of grounding output in the actual
issue content, a change made after reviewing what the agents had actually produced.

## The weather app

The Weather Dashboard demo artifact (`weather-app/`) was built by a second team member in
a separate Bob session, using Bob's own task/subtask tracking feature rather than a single
freeform request: a six-item todo list (create `index.html`, `styles.css`, `app.js`,
`README.md`, `tests.md`, then review and validate all files), tracked and checked off
inside Bob's Tasks panel (`bob-sessions/Prasanna-weather-dashboard-session-summary.png.png`).

## watsonx.ai

The shipped skill's agents call an LLM at exactly two points: the Acceptance Criteria
agent and the Ambiguity agent, both when drafting prose grounded in an issue's text (the
Dependency, State-transition, and Coverage agents are plain deterministic code and never
call a model at all; see the per-agent-role rationale in `bob-kit/custom_modes.yaml`).
That model is `ibm/granite-3-3-8b-instruct`, wired as Bob's own provider under Settings →
Providers → WatsonX (API key, Project ID, and endpoint URL configured there, documented
for reinstallation in `bob-kit/README.md`). The 128k context window is used specifically
for the full-backlog Audit path, where Bob has to hold many issues' findings in context at
once to compile a single report; single-issue drafting doesn't need it.

## What the screenshots show

| Screenshot | What it captures |
|---|---|
| `teamexperis_create_gitlab_container.png` | Initial repo clone task |
| `teamexperis_todo_list.png` | `to-do.md` drafted by Bob from `PROBLEM_STATEMENT.md` |
| `teamexperis_problem_statement_solution.png` | Bob tightening the problem statement against the judging constraints |
| `teamexperis_gitlab_container_debug.png` | Debugging `docker-compose.yml` / `manage.sh seed` |
| `teamexperis_create_weatherapp_container.png` | Bob confirming Section 1 completion against `to-do.md` |
| `teamexperis_2b_task_17.png` | Branching and planning the skill scaffold (Task 17) |
| `teamexperis_tasks2b18and19.png` | Planning Tasks 18 and 19 (onboarding flow, work item templates) |
| `teamexperis_agent_skill_config.png` | Section 3 (Tasks 27-31) dispatched as one batch |
| `Prasanna-weather-dashboard-session-summary.png.png` | The weather-app build, tracked via Bob's Tasks panel |
