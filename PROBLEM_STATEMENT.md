# Problem Statement & Solution

## The Problem

Software teams universally adopt a Software Development Lifecycle (SDLC) process, yet the discipline required to maintain it consistently breaks down in practice. The culprit is not laziness, it is friction. Work items accumulate across sprints in varying formats, with missing acceptance criteria, broken dependency links, stale state transitions, and descriptions that mean different things to different contributors. This inconsistency quietly erodes the value of the SDLC: reporting becomes unreliable, traceability gaps create audit risk, and handoffs between developers, testers, and product managers require costly manual reconciliation.

Existing tools like Jira automation rules or Azure DevOps pipelines can enforce structural rules such as required fields and blocked transitions, but they cannot reason about the quality and coherence of content. A field can be filled in and still be wrong. A dependency can exist and still be misleading. No current toolchain proactively closes that gap.

## The Solution: sdlc-harness

sdlc-harness is a Bob skill that puts a team of WatsonX AI agents directly inside the developer's existing workflow to govern work item quality throughout the entire SDLC, before problems are ever committed to the backlog.

Target users are software development teams of any size who use a project management tool (Jira, Azure DevOps, GitHub Projects) and want consistent, traceable work items without adding overhead to their developers.

A developer or project lead starts a guided onboarding conversation with the sdlc-harness skill inside Bob. In minutes, with no admin configuration and no pipeline setup, the skill learns the team's project management tool, work item types, workflow states, and transition rules. Industry best-practice work item templates are applied as a baseline. From that point forward, WatsonX agents monitor the project continuously. They draft missing acceptance criteria, flag ambiguous descriptions, suggest dependency links based on related work items, verify test coverage relationships, and propose state transitions, all before a human would notice the gap. Developers review, approve, or override agent suggestions through natural language inside Bob, without switching context.

## Why It Is New

Most governance tools are reactive. They block a bad state or flag a missing field after a developer has already committed a half-formed work item. sdlc-harness works the other way. The agents act first, proposing well-formed work items that conform to the team's own agreed templates, so the developer's job is reviewing good work rather than doing rote work.

The onboarding is conversational and takes minutes, removing the traditional barrier of per-project admin setup that causes most teams to skip governance tooling entirely. The result is a living, agent-governed backlog that stays consistent, traceable, and report-ready at every point in the project lifecycle, not only at the moment a work item was first written.
