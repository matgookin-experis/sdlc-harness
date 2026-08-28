# WatsonX Model Configuration

## Overview

sdlc-harness uses IBM WatsonX AI models via Bob's built-in WatsonX provider.
No extra SDK or HTTP client is required — Bob resolves the model and injects
credentials at inference time using the values already configured in the IDE's
WatsonX provider settings.

No model ID, endpoint URL, or API key may appear in any file in this repo.
All credential references below are **names only**; values live in the IDE's
provider settings or a gitignored `.env` file.

---

## Credential injection pattern

Bob reads WatsonX credentials from whichever of the following is populated first:

1. **IDE provider settings** — Bob IDE → Settings → Providers → WatsonX:
   fill in `API Key`, `Project ID`, and `Endpoint URL` there. This is the
   preferred approach for the demo machine (single-user, single project).

2. **Environment variables** (fallback, useful in CI or multi-project setups):

   | Variable | Purpose |
   |---|---|
   | `WATSONX_API_KEY` | IAM API key for the WatsonX instance |
   | `WATSONX_PROJECT_ID` | WatsonX project / space ID |
   | `WATSONX_URL` | WatsonX inference endpoint (region-specific) |

   These may be set in the demo machine's shell profile or in a gitignored
   `.env` file at the repo root. Never commit values.

3. **`.env` file path** — if Bob supports a `WATSONX_ENV_FILE` pointer, set
   it to the absolute path of a gitignored env file (same pattern as
   `SOPHIE_ENV_FILE` in the sophie-tools MCP server).

`.gitignore` and `.bobignore` both block `*.env*` files. Verify before
running the demo.

---

## Model selection rationale

| Agent role | Selected model | Rationale |
|---|---|---|
| **Acceptance-criteria drafting** | `ibm/granite-3-3-8b-instruct` | Instruction-following strength; 128 k context fits a full-issue thread plus template. Fast enough for interactive use (developer waiting for a draft). |
| **Ambiguity detection** | `ibm/granite-3-3-8b-instruct` | Same model; classifier-style reasoning over short description text. The 8 B parameter count keeps latency low for repeated single-issue calls. |
| **Dependency suggestion** | `ibm/granite-3-3-8b-instruct` (128 k window) | Needs to reason over many open issues simultaneously. The 128 k context window lets the full backlog (≤ 200 issues at ~300 tokens each) fit in one call. |
| **State-transition suggestion** | `ibm/granite-3-3-8b-instruct` | Lightweight signal-matching task (MR merged → suggest "In Review"). No long-context requirement; fast response is more important than recall depth. |
| **P1 — Test-coverage linkage** | `ibm/granite-3-3-8b-instruct` | Cross-referencing issue text against test-file names and assertions. 128 k window accommodates a reasonably large test suite alongside the issue backlog. |

All roles use the same model family, which simplifies the demo setup (one
model configured → all agents work). The 8B instruct variant balances
reasoning quality against inference latency for interactive governance loops.

If a larger model is available on the demo WatsonX instance, swap in
`ibm/granite-3-8b-instruct` or the latest Granite 3.x checkpoint; the
`customInstructions` in `custom_modes.yaml` reference the model by name so the
switch requires only a one-line edit there.

---

## Wiring in `custom_modes.yaml`

The `sdlc-harness` mode's `customInstructions` block already states:

```
WatsonX model in use: ibm/granite-3-3-8b-instruct via Bob's configured provider.
For long-context tasks (full-backlog audit, dependency graph) prefer
ibm/granite-3-3-8b-instruct with a 128k context window.
```

This is the only place the model name is recorded in config. Bob reads it as a
hint at inference time. To change the model for the whole skill, update that
one line — no other files need editing.

---

## Demo machine setup checklist

1. Open Bob IDE → Settings → Providers → WatsonX.
2. Enter `API Key`, `Project ID`, and the nearest region endpoint URL.
3. Set the default model to `ibm/granite-3-3-8b-instruct`.
4. Confirm no credential values appear in any committed file (`git grep` is
   your friend: `git grep -i "apikey\|api_key\|password\|token" -- "*.md" "*.json" "*.yaml"`).
5. Switch to the `🔧 SDLC Harness` mode and run the smoke prompt:
   "Activate the sdlc-harness skill and tell me which model you are using."
   Expected response: the model name from `customInstructions`, plus confirmation
   that the skill is loaded.
