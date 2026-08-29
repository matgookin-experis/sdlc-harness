# Demo Script

**Task 37.** Step-by-step facilitator script for the full internal walkthrough
(`docs/demo/narrative.md`). The 90-second video cut is Steps 5 through 9 below, marked
**[CUT]**; everything else is rehearsal-only context.

Wherever Bob's exact wording comes from deterministic code (the review-interface block,
the telemetry summary), it's quoted verbatim from `SKILL.md`. Wherever it comes from the
model actually drafting prose (the AM rewrite, the AC criteria), it's marked
**illustrative**: expect the same shape and grounding, not the same words.

## Pre-flight (do this before every take, including re-takes)

1. `cd gitlab-local && ./manage.sh reset -y` (full wipe, fresh boot, reseed). Confirms the
   backlog is in the exact seeded state every time.
2. Delete `sdlc-harness-telemetry.jsonl` in the repo root if it exists (gitignored, not
   touched by `reset`). The Beat 4 acceptance-rate numbers below assume a clean file.
3. Confirm Bob's WatsonX provider is actually active (Settings → Providers → WatsonX,
   model `ibm/granite-3-3-8b-instruct`), not a fallback provider.
4. Window layout per `docs/demo/recording-guide.md`.

## Full walkthrough

### Step 1: Open the backlog cold

**Narration:** "Here's a project that just moved onto GitLab. Twelve issues, no
governance applied yet. Let's see what's actually in there."

**On screen:** GitLab browser tab, weather-dashboard issues list. Don't open any single
issue yet, just let the list of 12 titles sit on screen for a beat.

**Fallback:** if issues are missing or the count is wrong, the reset in step 1 of
pre-flight didn't finish; re-run it and wait for its own completion message before
continuing.

### Step 2: Onboarding

**Narration:** "I'll switch Bob into SDLC Harness mode and ask it to govern this."

**Prompt (typed in Bob):**
```
govern my backlog
```

**Expected Bob response:** since no `.sdlc-harness.json` exists yet, Bob starts the
onboarding conversation from `SKILL.md` Phase 1 and asks, one at a time:
1. Which GitLab project should be governed?
2. What work item types does the team use?
3. What are the workflow states?
4. What are the valid state transitions?

**Answers to give** (matching `docs/onboarding/runbook.md` Step 9, for consistency with
the written runbook):
| Question | Answer |
|---|---|
| Project | `http://localhost:8080/sdlc-harness/weather-dashboard` |
| Work item types | Story, Bug, Task |
| Workflow states | Open, In Progress, In Review, Done |
| Transitions | Open→In Progress; In Progress→In Review or Open; In Review→Done or In Progress |

**Expected close:** Bob confirms onboarding is complete and offers the governance action
menu (Audit / Draft / Link / Transition / Template).

**Fallback:** if Bob asks a fifth question about existing templates, that's stale
`SKILL.md` on the machine (that question was removed in Task 5 of the Task 18/19 plan);
re-run `bash bob-kit/mcp-server/install.sh` to refresh the installed skill copy.

### Step 3: Full audit

**Narration:** "Let's audit the whole backlog and see what all four agents find."

**Prompt:**
```
audit
```

**Expected Bob response (illustrative wording, exact findings are deterministic):** a
compiled report roughly along these lines. Note this list is what the agents' detection
logic will actually flag, which is a few issues wider than the "headline" set
`seed-issues.sh` prints at seed time (that printout picks one clean example per agent, not
an exhaustive list):

- **Missing acceptance criteria:** issues 1, 2, 3, 5, 6, 8, 10, 11 (any issue without an
  "Acceptance Criteria" heading or structured Given/When/Then gets flagged; only 4, 7,
  9, and 12 were seeded with one).
- **Ambiguous language:** issues 2, 6, 10 (vague pronouns, "fix it," "make it better").
- **Dependency overlap:** 3↔4 (JWT/auth), 7↔8 (theme/dark mode), 11↔12 (location/city).
- **Stale state:** issue 5 (merged MR references it, still sitting in Open).

**Fallback:** if the AC list looks different from this, don't panic mid-recording; the
detection rule is simple (does the description contain an AC heading or structured GWT)
and is documented in `SKILL.md`'s AC Agent section, so any difference is almost certainly
this list being slightly stale against the current seed data, not a real bug. Move on and
narrate what's actually on screen.

### Step 4: Multiple findings on one issue

**Narration:** "Issue #2 actually has two separate problems flagged at once. Let's look at
that one first since it's the clearest example."

**Expected Bob response:** per `SKILL.md` Phase 4, when more than one agent flags the same
issue, Bob surfaces them together before presenting either individually:
```
⚠️  Multiple findings for issue #2:
  1. [AC]  Draft missing acceptance criteria
  2. [AM]  Rewrite vague description

Review them in order. Apply, edit, skip, or reject each separately.
```
This is also the demo's one deliberate conflict case: `SKILL.md` names "AM rewrites a
description in a way that would invalidate AC drafted in the same run" as a canonical
conflict, which is exactly this pair. Handling AM first, then AC, is the documented
resolution: AC's criteria get grounded in the description as it stands once the ambiguity
fix has already landed.

**Fallback:** if Bob presents them in the other order (AC before AM), that's fine too;
just handle AM's finding first regardless of presentation order, and narrate why:
"I'll fix the ambiguity before I draft criteria against it."

---

### Step 5 [CUT start]: Ambiguity agent on issue #2

**Narration:** "Issue #2 says 'fix the thing on the settings page.' The description just
says 'the thing that saves preferences is broken, fix it.' Nothing here is testable.
Let's see what Bob proposes."

**Expected Bob response** (per the review-interface format in `SKILL.md` Phase 4, and the
Ambiguity agent's actual detection rule: flags "the thing" as a non-specific pronoun and
"fix it" as a vague subject):
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 [AM] Issue #2: Fix the thing on the settings page
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reason: Vague pronoun ("the thing") and non-specific subject ("fix it") aren't testable.

Proposed change:
The settings page fails to persist user preference changes. Saved preference values
revert after a page reload instead of being written to storage. Fix the save handler
so preference changes persist across reloads.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reply with:
  apply     — accept and write to GitLab
  edit <…>  — accept with your changes and write
  skip      — move on without logging
  reject    — discard and log rejection
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
**The proposed-change text above is illustrative.** The agent only supplies the flagged
phrases; the actual rewrite is written live by whatever model is behind Bob, grounded in
the issue's own text. Expect the same shape (a concrete, testable replacement for "the
thing"/"fix it"), not this exact wording.

**Prompt (edit, to show the edit path, not just apply):**
```
edit The settings page silently fails to save the notification preference toggle. Reloading the page always resets it to the default value instead of keeping the saved choice. Fix the save handler so the choice persists across reloads.
```

**Expected result:** Bob calls `gitlab-issue-writer` to update the issue description,
logs a telemetry entry (`agent: AM, action: rewrite_desc, outcome: edited`), and confirms.

**Fallback:** if you'd rather not compose an edit live, `apply` is a safe substitute;
just narrate "I'll accept this one as-is" instead of "let me tighten this."

### Step 6 [CUT]: Acceptance-criteria agent on the same issue

**Narration:** "Now that the description says something specific, Bob can draft real
criteria against it instead of guessing."

**Expected Bob response:** issue #2 is labeled Bug, so the AC agent's brief targets a Bug
template (`work-item-format get-template type=Bug`) and asks the drafting model to ground
2 to 4 Given-When-Then criteria in the now-updated description:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔍 [AC] Issue #2: Fix the thing on the settings page
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reason: No acceptance criteria found in the description.

Proposed change:
**Given** a user has changed the notification preference toggle
**When** they reload the settings page
**Then** the previously selected value is still shown, not reset to the default

**Given** the save handler receives a preference update
**When** the write to storage fails
**Then** the user sees an error rather than a silent no-op
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reply with:
  apply     — accept and write to GitLab
  edit <…>  — accept with your changes and write
  skip      — move on without logging
  reject    — discard and log rejection
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```
**Illustrative**, same caveat as Step 5. The second criterion above is a reasonable guess
at the agent's "no failure case described" gap-question; if the issue text (after your
Step 5 edit) doesn't support a failure-case criterion, Bob should ask about it instead of
inventing one; that's the "ask, don't guess" rule from `SKILL.md`'s AC Agent section, and
is worth narrating explicitly if it happens: "Bob's asking rather than assuming, that's
deliberate."

**Prompt:**
```
apply
```

**Expected result:** telemetry entry (`agent: AC, action: draft_ac, outcome: accepted`).

### Step 7 [CUT]: Acceptance-rate summary

**Narration:** "Let's see how that looks in the numbers Bob's been tracking."

**Prompt:**
```
how are we doing?
```

**Expected Bob response** (exact format and math from `SKILL.md`'s
`computeAcceptanceRate`, for exactly the two decisions made in Steps 5 to 6 on a clean
telemetry file):
```
Total:           2 decisions logged (failed excluded)
Accepted:        1  (50%)
Edited:          1  (50%)
Rejected:        0  (0%)
Failed:          0  (write did not reach GitLab — excluded from rates)
Acceptance rate: 50%     (accepted / total)
Approval rate:   100%    (accepted + edited) / total
```

**Narration close:** "Both suggestions were used, one as-is, one edited. That's the
number that should climb as the team starts trusting this more: not features shipped, but
suggestions accepted."

**[CUT end].** Stop the recorded segment here for the 90-second video.

**Fallback:** if telemetry shows more than 2 total decisions, the pre-flight step 2
(delete `sdlc-harness-telemetry.jsonl`) was skipped; the numbers will still be honest, just
not the clean 50/50/100% shown above. Narrate whatever the real numbers say rather than
the ones printed here.

---

### Step 8: Dependency and state-transition findings (rehearsal only, not in the cut)

**Narration:** "The other two P0 agents catch a different kind of problem: relationships
between issues, not the wording of any one issue."

**Prompt:**
```
suggest links
```

**Expected Bob response:** a `DependencyFinding` for 3↔4 and 7↔8, each with a
`relates-to` or `blocks` suggestion and a confidence score, presented as a
recommendation only (`SKILL.md`: "DependencyFinding objects are always report-only," no
native GitLab links API yet).

**Prompt:**
```
check transitions
```

**Expected Bob response:** a finding for issue #5, proposing a move to In Review because
a merged MR (`!1`, `ci-staging-deploy`) references it. Applying writes an updated label.

**Fallback:** neither of these needs to go smoothly on camera; they're rehearsal context
so the facilitator can talk about them confidently even though they're not filmed.

### Step 9: Wrap

**Narration:** "That's the loop: agents propose, a person decides, nothing reaches GitLab
without a yes. The acceptance rate is the number that tells you whether it's actually
helping."

---

## What "good" looks like at dry run (Task 40)

- Steps 1 to 7 run in one take without a fallback being needed.
- The Step 4 conflict block actually appears (if it doesn't, the multi-finding detection
  in `SKILL.md` Phase 4 needs a look before recording).
- The telemetry numbers in Step 7 come out exactly as shown, proving the pre-flight reset
  actually worked.
