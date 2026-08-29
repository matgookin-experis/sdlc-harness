# GitLab Local

Runs a self-hosted GitLab CE instance and a static demo site locally via Docker, with a reproducible demo environment.

## Requirements

- Docker
- Docker Compose v2+
- Python 3 (for the seed script — available on most systems)

### Minimum host requirements

| Resource | Minimum | Recommended |
|---|---|---|
| RAM | 4 GB free | 8 GB free |
| CPU | 2 cores | 4 cores |
| Disk | 10 GB free | 20 GB free |

`docker-compose.yml` is already tuned down for local/demo use (`puma['worker_processes'] = 2`,
`sidekiq['concurrency'] = 5`, `prometheus_monitoring['enable'] = false`) — GitLab CE's own
[hardware requirements](https://docs.gitlab.com/ee/install/requirements.html) recommend 8 GB+ for
a comfortable experience, but this configuration has been run successfully at the 4 GB minimum for
demo purposes. If you're on Docker Desktop (Windows/Mac), make sure its own VM resource limits
(Settings → Resources) are set at or above these values — the container can't use more memory or
CPU than Docker Desktop itself is allowed.

## Quick Start

```bash
cd gitlab-local

# 1. Create your local credentials file (gitignored — never committed)
cp .env.example .env
#    Edit .env and set GITLAB_ROOT_PASSWORD (minimum 8 characters, no '$' — see Troubleshooting)

# 2. Start the stack (first boot takes 3–5 minutes)
docker compose up -d

# 3. Verify the stack is healthy
./smoke.sh

# 4. Seed demo data (run once after first boot)
./manage.sh seed

# 5. Seed intentionally-incomplete demo issues for agent demo
./manage.sh seed-issues
```

Then open **http://localhost:8080** (GitLab) and **http://localhost:8081** (demo site).

## Credentials

Credentials come from your local `.env` file — set `GITLAB_ROOT_PASSWORD` there.
The same password is used for both the `root` admin and the `demo` user.

| Account    | Username | Role      |
|------------|----------|-----------|
| Admin      | `root`   | Owner     |
| Demo user  | `demo`   | Developer |

> **Sign in with `root` or `demo`. Do not use "Register now".**
> `seed.sh` sets `signup_enabled=false` — this is a closed demo instance. If you
> register an account anyway, GitLab creates it in a blocked state and you get
> *"Your account is pending approval from your GitLab administrator and hence
> blocked."* That is expected. Sign in as `root` instead; the blocked account can
> be ignored, or removed from **Admin → Users**.

To see the password you configured:

```bash
grep GITLAB_ROOT_PASSWORD gitlab-local/.env
```

If you never set one, GitLab generated an initial root password on first boot:

```bash
./manage.sh password
```

That file is deleted automatically 24 hours after the container's first start, so
if it is gone, set `GITLAB_ROOT_PASSWORD` in `.env` and run `./manage.sh reset -y`.

## Demo Project

After seeding, the demo project is at:

**http://localhost:8080/sdlc-harness/weather-dashboard**

It contains the **Weather Dashboard** — a self-contained mock weather app built as the
SDLC Harness demo artefact (sourced from the `dev` branch of the sdlc-harness repo):

| File | Description |
|---|---|
| `index.html` | App shell — open directly in any browser, no server needed |
| `styles.css` | All styling — dark mode, responsive, CSS custom properties |
| `app.js` | Runtime behaviour — mock data, search, theme toggle |
| `WEATHER-DASHBOARD.md` | Full docs + suggested SDLC demo changes |
| `tests.md` | Manual test checklist |

## Helper Scripts

| Command                       | Description                                           |
|-------------------------------|-------------------------------------------------------|
| `./smoke.sh`                  | Validate full stack health (exit 0 = OK)              |
| `./manage.sh start`           | Start the stack                                       |
| `./manage.sh stop`            | Stop the stack                                        |
| `./manage.sh restart`         | Restart the stack                                     |
| `./manage.sh seed`            | Seed demo users, group, and project                   |
| `./manage.sh seed-issues`     | Seed 12 intentionally-incomplete issues for agent demo|
| `./manage.sh reset [-y]`      | Full wipe + fresh boot + reseed in one command (see Full Reset below) |
| `./manage.sh logs`            | Tail container logs                                   |
| `./manage.sh status`          | Show container health                                 |

All seed scripts are **idempotent** — safe to run multiple times, skip anything that already exists.

## Ports

| Port | Purpose                              |
|------|--------------------------------------|
| 8080 | GitLab web UI / API (host → port 80) |
| 8081 | Demo site — weather app (nginx); override with `DEMO_SITE_PORT` |
| 2222 | Git over SSH                         |

SSH remote URL format:
```
ssh://git@localhost:2222/<namespace>/<repo>.git
```

## Troubleshooting

### "Your account is pending approval from your GitLab administrator"

You registered a new account instead of signing in. This is a closed instance —
sign in as `root` (see [Credentials](#credentials)). Nothing is broken.

### `./smoke.sh` reports the demo site is not up

GitLab is fine; the nginx demo site did not bind its port. Almost always a port
collision — on macOS, Docker Desktop's own helper process binds 8081 on some
installs, so the container exits immediately and never appears in
`docker compose ps`.

```bash
lsof -iTCP:8081 -sTCP:LISTEN     # find what holds the port
```

Then pick a free port in `.env` and bring the stack back up:

```bash
echo "DEMO_SITE_PORT=8082" >> .env
docker compose up -d
```

The agents, the MCP tools and every seeded issue work without the demo site — it
only serves the weather app for the demo video. `smoke.sh` treats it as optional
and still exits 0 when only GitLab is healthy.

### The password in `.env` does not work

Check for a `$` in it. Docker Compose interprets `$` as variable interpolation, so
`GITLAB_ROOT_PASSWORD=abc$123` reaches the container as `abc` followed by an empty
variable. Use a password without `$`, or escape it as `$$`. GitLab also enforces a
minimum of 8 characters — a shorter one fails during seeding with
*"Password is too short"*.

After changing the password, existing data still holds the old one. Either reset:

```bash
./manage.sh reset -y
```

or change it in place:

```bash
docker exec -it gitlab gitlab-rails runner \
  "u = User.find_by_username('root'); u.password = u.password_confirmation = ENV['NEW_PW']; u.save!"
```

### GitLab returns HTTP 502 for the first few minutes

Normal. Rails is still booting and compiling assets on first run — allow 3–5
minutes. `smoke.sh` polls for up to 300s.

---

## Data Persistence

All GitLab data is stored in named Docker volumes:

- `gitlab-config` — `/etc/gitlab`
- `gitlab-logs` — `/var/log/gitlab`
- `gitlab-data` — `/var/opt/gitlab`

## Full Reset

To wipe all data and start fresh (e.g. for a clean demo re-take):

```bash
./manage.sh reset          # prompts for confirmation
./manage.sh reset -y       # skips the confirmation prompt
```

This tears down the stack including volumes, boots fresh, waits for GitLab to report
`healthy`, then re-runs `seed` and `seed-issues` — a single idempotent command instead
of four manual steps. Equivalent to running by hand:

```bash
docker compose down -v
docker compose up -d
./manage.sh seed
./manage.sh seed-issues
```
