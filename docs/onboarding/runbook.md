# SDLC Harness — New Team Member Onboarding Runbook

> **Time to complete:** 20–30 minutes on a machine that already has Docker and Node.js.  
> **Prerequisite checklist** — confirm before you start:
> - [ ] Docker (Engine ≥ 24) and Docker Compose v2+ are installed and the daemon is running.
> - [ ] Node.js ≥ 18 is installed (`node --version`).
> - [ ] You have cloned the `sdlc-harness` repository and are in its root directory.
> - [ ] You have IBM Bob installed and can open it.

---

## Step 1 — Create your local credentials file

The `.env` files are gitignored and must be created locally. Copy the examples:

```bash
cp gitlab-local/.env.example gitlab-local/.env
```

Open `gitlab-local/.env` and set `GITLAB_ROOT_PASSWORD` to a strong password of your choice.
This password is used for the GitLab `root` admin account and the `demo` user — the only
credential you need to remember for the local instance.

> ⚠️ Do not commit `.env` files. The `.gitignore` already covers them; this is a double-check.

---

## Step 2 — Start the Docker stack

From the `gitlab-local/` directory:

```bash
cd gitlab-local
./manage.sh start
```

GitLab CE takes **3–5 minutes** to initialise on first boot. You can monitor progress:

```bash
./manage.sh logs          # follow all container logs (Ctrl+C to stop)
./manage.sh status        # check container health
```

Wait until `manage.sh status` shows `healthy` for the `gitlab` container, or until you can
open **http://localhost:8080** in a browser and see the GitLab login page.

---

## Step 3 — Verify the stack is healthy

Run the smoke test (from `gitlab-local/`):

```bash
./smoke.sh
```

Expected output:

```
✓ GitLab HTTP 200  (http://localhost:8080/users/sign_in)
✓ Demo site HTTP 200  (http://localhost:8081)
All checks passed.
```

**Do not continue until smoke.sh exits 0.** If it fails, check `./manage.sh logs` for errors.

---

## Step 4 — Seed demo data

Still from `gitlab-local/`:

```bash
./manage.sh seed
```

This creates:
- A `SDLC Harness` GitLab group at `/sdlc-harness`
- A `demo` user (Developer role)
- The `weather-dashboard` project with source files pushed

Then seed the intentionally-incomplete demo issues:

```bash
./manage.sh seed-issues
```

This populates the `weather-dashboard` project with 10–12 issues that have missing acceptance
criteria, vague descriptions, broken dependency links, and missing test coverage — exactly the
signal each P0 agent needs to act on in the demo.

At the end you will see a summary with the project URL and credentials. Make a note of them.

---

## Step 5 — Install and build the MCP server

From the **project root** (`sdlc-harness/`):

```bash
bash bob-kit/mcp-server/install.sh
```

This:
1. Checks Node.js ≥ 18
2. Runs `npm install` and `npm run build` in `bob-kit/mcp-server/`
3. Merges the `sdlc-harness` MCP server entry into `~/.bob/mcp.json` without overwriting
   any other servers you have configured
4. Merges the `🔧 SDLC Harness` mode into `~/.bob/settings/custom_modes.yaml`
5. Runs the mock smoke test to confirm the build is healthy

Expected output ends with:

```
✓ Smoke test passed
==============================
Installation complete.
```

---

## Step 6 — Configure MCP server credentials

Copy the MCP server env example and fill in your GitLab credentials:

```bash
cp bob-kit/mcp-server/.env.example bob-kit/mcp-server/.env
```

Open `bob-kit/mcp-server/.env` and set:

| Variable | Value |
|---|---|
| `GITLAB_HOST` | `http://localhost:8080` |
| `GITLAB_PROJECT` | `sdlc-harness/weather-dashboard` |
| `GITLAB_TOKEN` | A Personal Access Token (see below) |

**Creating a Personal Access Token:**

1. Log into GitLab at **http://localhost:8080** as `root` (password from Step 1).
2. Go to **User → Edit profile → Access Tokens**.
3. Create a token named `sdlc-harness-mcp` with `api` scope and any expiry you like.
4. Copy the token value into `GITLAB_TOKEN` in your `.env`.

---

## Step 7 — Run the live smoke test

Confirm the MCP server can reach GitLab:

```bash
cd bob-kit/mcp-server
SDLC_SMOKE_LIVE=true npm run smoke
```

Expected output: all checks pass and your GitLab username is printed.

If this step fails, check `GITLAB_TOKEN` and `GITLAB_HOST` in your `.env`.

---

## Step 8 — Open Bob and activate the sdlc-harness skill

1. Restart Bob so it picks up the newly merged config (close and reopen, or use the reload
   command if your IDE supports it).
2. In the Bob mode selector (bottom-left of the chat pane), choose **🔧 SDLC Harness**.
3. Type the following to activate the skill and start onboarding:

   ```
   govern my backlog
   ```

   Bob will detect that the project has not been onboarded yet and start the guided
   onboarding conversation (Task 18 / Phase 1 of the skill).

---

## Step 9 — Complete the onboarding conversation

Bob will ask four questions. Use the values below for the demo project:

| Question | Answer |
|---|---|
| Which GitLab project should be governed? | `http://localhost:8080/sdlc-harness/weather-dashboard` |
| What work item types does the team use? | `Story, Bug, Task` |
| What are the workflow states? | `Open, In Progress, In Review, Done` |
| What are the transition rules? | Open→In Progress; In Progress→In Review or Open; In Review→Done or In Progress |

Bob will save this configuration to `.sdlc-harness.json` in the repo root and confirm it is
ready to monitor.

---

## Step 10 — Verify the skill is ready

After onboarding, Bob should print a confirmation summary and offer the governance action menu:

```
✅ Onboarding complete. Governing: sdlc-harness/weather-dashboard

What would you like to do?
  • Audit  — scan all open issues for quality problems
  • Draft  — draft AC for a specific issue
  • Link   — suggest dependency links
  • Transition — propose state moves
  • Template — apply work-item templates
```

Type `audit` to confirm the agents can reach the seeded issues and produce findings.

---

## Quick Reference

| Resource | URL / path |
|---|---|
| GitLab web UI | http://localhost:8080 |
| Demo project  | http://localhost:8080/sdlc-harness/weather-dashboard |
| Demo site     | http://localhost:8081 |
| Root login    | `root` / your `GITLAB_ROOT_PASSWORD` |
| Demo login    | `demo` / your `GITLAB_ROOT_PASSWORD` |
| MCP server credentials | `bob-kit/mcp-server/.env` |
| Telemetry log | `sdlc-harness-telemetry.jsonl` (repo root, gitignored) |

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `smoke.sh` fails with HTTP 502 | GitLab is still starting — wait 2 min and retry |
| `seed.sh` fails with "Could not create API token" | GitLab is not fully up — wait and retry |
| `install.sh` fails: "node is not installed" | Install Node.js ≥ 18 (`nvm install 18` or package manager) |
| Bob doesn't show `🔧 SDLC Harness` mode | Restart Bob; check `~/.bob/settings/custom_modes.yaml` contains `sdlc-harness` |
| MCP live smoke fails: "Unauthorized" | Check `GITLAB_TOKEN` in `bob-kit/mcp-server/.env`; recreate the PAT if expired |
| `.sdlc-harness.json` not created after onboarding | The skill config persistence requires the onboarding flow to complete all four questions |
