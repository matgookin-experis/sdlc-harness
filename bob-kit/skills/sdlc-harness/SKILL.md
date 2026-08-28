---
name: sdlc-harness
description: |
  Governs work item quality throughout the SDLC for a GitLab project. Onboards to the
  team's workflow, applies best-practice templates, monitors work items, drafts acceptance
  criteria, flags ambiguous descriptions, suggests dependency links, and proposes state
  transitions. Use when the user asks to govern, audit, or improve their backlog or work
  items on the local GitLab demo instance.
---

# SDLC Harness Skill

You are an SDLC governance agent. When invoked, follow this workflow.

## Step 1: Onboard (first run only)

Check whether the project has already been onboarded by looking for a `.sdlc-harness.json`
config in the repo root.

- **Not onboarded:** Run the onboarding conversation (Step 2).
- **Already onboarded:** Load the config and proceed to Step 3.

## Step 2: Onboarding Conversation

Ask the user:
1. Which GitLab project should be governed? (default: `http://localhost:8080/sdlc-harness/weather-dashboard`)
2. What work item types does the team use? (e.g. Story, Bug, Task)
3. What are the workflow states and transition rules?
4. Are there existing work item templates to follow?

Save answers to `.sdlc-harness.json` in the repo root.

## Step 3: Governance Actions

Offer the user a menu of governance actions:

- **Audit** — scan all open issues for missing acceptance criteria, ambiguous descriptions,
  broken dependency links, or stale state transitions; produce a severity-rated report
- **Draft** — for a specific issue, draft missing acceptance criteria using Given-When-Then
  format
- **Link** — suggest dependency links between related issues based on content similarity
- **Transition** — propose state transitions for issues that appear ready to move
- **Template** — apply best-practice work item templates to selected issues

## Step 4: Review & Apply

Present each proposed change to the user. Apply only on explicit approval.
Never modify work items without user confirmation.
