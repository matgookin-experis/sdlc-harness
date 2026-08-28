# GitLab Local

Runs a self-hosted GitLab CE instance and a static demo site locally via Docker, with a reproducible demo environment.

## Requirements

- Docker
- Docker Compose v2+
- Python 3 (for the seed script — available on most systems)

## Quick Start

```bash
cd gitlab-local

# 1. Create your local credentials file (gitignored — never committed)
cp .env.example .env
#    Edit .env and set GITLAB_ROOT_PASSWORD to a strong password

# 2. Start the stack (first boot takes 3–5 minutes)
docker compose up -d

# 3. Verify the stack is healthy
./smoke.sh

# 4. Seed demo data (run once after first boot)
./manage.sh seed
```

Then open **http://localhost:8080** (GitLab) and **http://localhost:8081** (demo site).

## Credentials

Credentials come from your local `.env` file — set `GITLAB_ROOT_PASSWORD` there.
The same password is used for both the `root` admin and the `demo` user.

| Account    | Username | Role      |
|------------|----------|-----------|
| Admin      | `root`   | Owner     |
| Demo user  | `demo`   | Developer |

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

| Command                  | Description                             |
|--------------------------|-----------------------------------------|
| `./smoke.sh`             | Validate full stack health (exit 0 = OK)|
| `./manage.sh start`      | Start the stack                         |
| `./manage.sh stop`       | Stop the stack                          |
| `./manage.sh restart`    | Restart the stack                       |
| `./manage.sh seed`       | Seed demo users, group, and project     |
| `./manage.sh logs`       | Tail container logs                     |
| `./manage.sh status`     | Show container health                   |

The seed script is **idempotent** — safe to run multiple times, skips anything that already exists.

## Ports

| Port | Purpose                              |
|------|--------------------------------------|
| 8080 | GitLab web UI / API (host → port 80) |
| 8081 | Demo site — weather app (nginx)      |
| 2222 | Git over SSH                         |

SSH remote URL format:
```
ssh://git@localhost:2222/<namespace>/<repo>.git
```

## Data Persistence

All GitLab data is stored in named Docker volumes:

- `gitlab-config` — `/etc/gitlab`
- `gitlab-logs` — `/var/log/gitlab`
- `gitlab-data` — `/var/opt/gitlab`

## Full Reset

To wipe all data and start fresh (e.g. for a clean demo):

```bash
docker compose down -v
docker compose up -d
./manage.sh seed
```
